import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, link, mkdir, open, readdir, rm, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type {
  ArtifactDigest,
  ArtifactMetadata,
  ArtifactObservation,
  ArtifactPage,
  ArtifactStore,
  ArtifactVaultConfig,
  IncidentKind,
  IntegrityIncident,
  ReconciliationReport,
  ReconciliationBudget,
  RetrievalAttempt,
  StoreArtifactRequest,
  StoreArtifactResult,
  VerifiedArtifactRead,
} from "../../artifacts/artifact-store.js";
import { ArtifactVaultError } from "../../artifacts/errors.js";
import { deriveIncidentId, deriveObservationId } from "../../artifacts/identity.js";
import {
  assertArtifactDigest,
  assertSafeByteAddition,
  createPersistedRetrievalAttempt,
  validateHttpResponseMetadata,
  persistedRetrievalAttemptId,
  validateRetrievalAttempt,
  validateVaultConfig,
} from "../../artifacts/validation.js";
import type { Clock } from "../../core/clock.js";
import { canonicalHash } from "../../core/hash.js";
import type { JsonValue } from "../../core/json.js";
import type { SqliteArtifactRepository } from "./sqlite-artifact-repository.js";
import { VaultWriterLease } from "./writer-lease.js";

type Paths = Readonly<{
  root: string;
  content: string;
  staging: string;
  snapshots: string;
  quarantine: string;
  locks: string;
  device: number;
}>;

class Semaphore {
  readonly #limit: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.#active >= this.#limit)
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#active += 1;
    return () => {
      this.#active -= 1;
      this.#waiting.shift()?.();
    };
  }
}

async function ensurePlainDirectory(path: string): Promise<void> {
  const resolved = resolve(path);
  const ancestors: string[] = [];
  let cursor = resolved;
  for (;;) {
    ancestors.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const ancestor of ancestors.reverse()) {
    try {
      const info = await lstat(ancestor);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new ArtifactVaultError(
          "unsafe-filesystem-object",
          "Vault path contains an unsafe filesystem object",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "Vault path contains an unsafe filesystem object",
    );
  }
}

async function assertTrustedPath(root: string, path: string, device: number): Promise<void> {
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`))
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "Vault path escaped its configured root",
    );
  let cursor = root;
  for (const part of rel.split(sep).filter(Boolean).slice(0, -1)) {
    cursor = join(cursor, part);
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== device)
      throw new ArtifactVaultError(
        "unsafe-filesystem-object",
        "Vault ancestor is not a trusted same-volume directory",
      );
  }
}

function safeChild(root: string, ...parts: readonly string[]): string {
  const child = resolve(root, ...parts);
  const rel = relative(resolve(root), child);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "Vault path escaped its configured root",
    );
  }
  return child;
}

async function hashFile(path: string): Promise<{ digest: string; sizeBytes: number }> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Artifact content is not a regular file");
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const buffer = Buffer.allocUnsafe(64 * 1_024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      sizeBytes = assertSafeByteAddition(sizeBytes, bytesRead);
      position += bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error("Artifact changed during verification");
    return { digest: hash.digest("hex"), sizeBytes };
  } finally {
    await handle.close();
  }
}

export class DurableArtifactStore implements ArtifactStore {
  readonly #repository: SqliteArtifactRepository;
  readonly #clock: Clock;
  readonly #config: ArtifactVaultConfig;
  readonly #paths: Paths;
  readonly #semaphore: Semaphore;
  readonly #lease: VaultWriterLease;
  #reservedBytes = 0;

  private constructor(
    repository: SqliteArtifactRepository,
    clock: Clock,
    config: ArtifactVaultConfig,
    paths: Paths,
    lease: VaultWriterLease,
  ) {
    this.#repository = repository;
    this.#clock = clock;
    this.#config = config;
    this.#paths = paths;
    this.#semaphore = new Semaphore(config.maxConcurrentWrites);
    this.#lease = lease;
  }

  static async open(dependencies: {
    repository: SqliteArtifactRepository;
    clock: Clock;
    config: ArtifactVaultConfig;
  }): Promise<DurableArtifactStore> {
    const config = validateVaultConfig(dependencies.config);
    await ensurePlainDirectory(resolve(config.runtimeRoot));
    const root = resolve(config.runtimeRoot, "artifacts");
    const paths: Omit<Paths, "device"> = {
      root,
      content: join(root, "sha256"),
      staging: join(root, "staging"),
      snapshots: join(root, "snapshots"),
      quarantine: join(root, "quarantine"),
      locks: join(root, "locks"),
    };
    for (const path of Object.values(paths)) await ensurePlainDirectory(path);
    const device = (await lstat(root)).dev;
    const trustedPaths = { ...paths, device };
    const lease = await VaultWriterLease.acquire({
      path: join(paths.locks, "writer.lock"),
      behavior: config.writerLeaseBehavior,
      waitMs: config.writerLeaseWaitMs,
      durationMs: config.writerLeaseDurationMs,
      renewalMs: config.writerLeaseRenewalMs,
      repository: dependencies.repository,
      clock: dependencies.clock,
    });
    return new DurableArtifactStore(
      dependencies.repository,
      dependencies.clock,
      config,
      trustedPaths,
      lease,
    );
  }

  async close(): Promise<void> {
    await this.#lease.release();
  }

  async store(request: StoreArtifactRequest): Promise<StoreArtifactResult> {
    const attemptDraft = validateRetrievalAttempt(request.attempt);
    const response = validateHttpResponseMetadata(request.response);
    const release = await this.#semaphore.acquire();
    const existingAttempt = this.#repository.getAttempt(attemptDraft.attemptId);
    if (existingAttempt !== undefined) {
      try {
        const completed = this.#repository.getCompletedResult(attemptDraft.attemptId);
        if (completed === undefined) {
          throw new ArtifactVaultError(
            "artifact-integrity-failure",
            "Attempt identity is already incomplete or terminal",
          );
        }
        const immutableDraft = (({ stagingId: _staging, recordedAtMs: _recorded, ...draft }) =>
          draft)(existingAttempt);
        if (
          canonicalHash(
            "peas/artifact-redelivery-attempt/v1",
            immutableDraft as unknown as JsonValue,
          ) !==
            canonicalHash(
              "peas/artifact-redelivery-attempt/v1",
              attemptDraft as unknown as JsonValue,
            ) ||
          canonicalHash(
            "peas/artifact-redelivery-response/v1",
            completed.observation.response as unknown as JsonValue,
          ) !==
            canonicalHash("peas/artifact-redelivery-response/v1", response as unknown as JsonValue)
        ) {
          throw new ArtifactVaultError(
            "artifact-integrity-failure",
            "Attempt identity conflicts with committed metadata",
          );
        }
        const hash = createHash("sha256");
        let sizeBytes = 0;
        for await (const value of request.entityBytes) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
          sizeBytes = assertSafeByteAddition(sizeBytes, chunk.byteLength);
          if (sizeBytes > this.#config.maxArtifactBytes)
            throw new ArtifactVaultError(
              "artifact-too-large",
              "Artifact exceeds configured byte limit",
            );
          hash.update(chunk);
        }
        if (
          sizeBytes !== completed.artifact.sizeBytes ||
          hash.digest("hex") !== completed.artifact.digest
        ) {
          throw new ArtifactVaultError(
            "artifact-integrity-failure",
            "Attempt identity conflicts with committed content",
          );
        }
        return completed;
      } finally {
        release();
      }
    }
    const stagingId = randomUUID();
    const stagePath = safeChild(this.#paths.staging, `${stagingId}.part`);
    await assertTrustedPath(this.#paths.root, stagePath, this.#paths.device);
    const attempt: RetrievalAttempt = createPersistedRetrievalAttempt(
      attemptDraft,
      stagingId,
      this.#clock.nowMs(),
    );
    let reserved = 0;
    try {
      await this.#lease.renewAndAssert();
      this.#repository.recordAttempt(attempt, this.#lease.fence());
      const handle = await open(stagePath, "wx", 0o600);
      const hash = createHash("sha256");
      let sizeBytes = 0;
      try {
        for await (const value of request.entityBytes) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
          sizeBytes = assertSafeByteAddition(sizeBytes, chunk.byteLength);
          if (sizeBytes > this.#config.maxArtifactBytes) {
            throw new ArtifactVaultError(
              "artifact-too-large",
              "Artifact exceeds configured byte limit",
            );
          }
          if (
            this.#committedBytes() + this.#reservedBytes + chunk.byteLength >
            this.#config.maxVaultBytes
          ) {
            throw new ArtifactVaultError("vault-quota-exceeded", "Artifact vault quota exceeded");
          }
          this.#reservedBytes += chunk.byteLength;
          reserved += chunk.byteLength;
          hash.update(chunk);
          await handle.write(chunk);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }

      const digest = hash.digest("hex");
      const finalPath = await this.#contentPath(digest, true);
      await this.#lease.renewAndAssert();
      let converged = false;
      try {
        await link(stagePath, finalPath);
        await rm(stagePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const winner = await hashFile(finalPath);
        if (winner.digest !== digest || winner.sizeBytes !== sizeBytes) {
          await this.#incident(
            "conflicting-destination",
            stagingId,
            digest,
            sizeBytes,
            winner.sizeBytes,
          );
          throw new ArtifactVaultError(
            "artifact-integrity-failure",
            "Existing artifact destination failed verification",
          );
        }
        converged = true;
        await rm(stagePath, { force: true });
      }
      const installed = await hashFile(finalPath);
      if (installed.digest !== digest || installed.sizeBytes !== sizeBytes) {
        await this.#incident("digest-mismatch", stagingId, digest, sizeBytes, installed.sizeBytes);
        throw new ArtifactVaultError(
          "artifact-integrity-failure",
          "Installed artifact failed verification",
        );
      }
      const committedAtMs = this.#clock.nowMs();
      const artifact: ArtifactMetadata = {
        digest,
        algorithm: "sha256",
        sizeBytes,
        committedAtMs,
        provenance: "retrieval",
      };
      const observationWithoutHash = {
        observationId: deriveObservationId(attemptDraft, digest, response),
        attemptId: attemptDraft.attemptId,
        artifactDigest: digest,
        provider: attemptDraft.provider,
        recordId: attemptDraft.recordId,
        revisionId: attemptDraft.revisionId,
        retrievedAtMs: committedAtMs,
        request: attemptDraft.request,
        response,
      };
      const observation: ArtifactObservation = {
        ...observationWithoutHash,
        observationHash: canonicalHash(
          "peas/artifact-observation/v1",
          observationWithoutHash as unknown as JsonValue,
        ),
      };
      await this.#lease.renewAndAssert();
      const disposition = this.#repository.commitSuccess(
        artifact,
        observation,
        response,
        this.#lease.fence(),
      );
      return { artifact, observation, disposition: converged ? "deduplicated" : disposition };
    } catch (error) {
      try {
        await this.#lease.renewAndAssert();
        await rm(stagePath, { force: true }).catch(() => undefined);
        this.#repository.finishAttempt(
          {
            attemptId: attemptDraft.attemptId,
            outcome: error instanceof Error && error.name === "AbortError" ? "abandoned" : "failed",
            completedAtMs: this.#clock.nowMs(),
            reasonCode: error instanceof ArtifactVaultError ? error.code : "write-failed",
            detailHash: canonicalHash("peas/artifact-error/v1", {
              name: error instanceof Error ? error.name : "unknown",
            }),
          },
          this.#lease.fence(),
        );
      } catch {
        // A committed success is terminal, and a stale writer must not mutate evidence or staging.
      }
      throw error;
    } finally {
      this.#reservedBytes -= reserved;
      release();
    }
  }

  async stat(digest: ArtifactDigest): Promise<ArtifactMetadata | undefined> {
    assertArtifactDigest(digest);
    return this.#repository.stat(digest);
  }

  async read(digest: ArtifactDigest): Promise<VerifiedArtifactRead> {
    assertArtifactDigest(digest);
    const artifact = this.#repository.stat(digest);
    if (artifact === undefined)
      throw new ArtifactVaultError("artifact-not-found", "Artifact does not exist");
    const source = await this.#contentPath(digest, false, false);
    const snapshotId = randomUUID();
    const snapshotPath = safeChild(this.#paths.snapshots, `${snapshotId}.verified`);
    await assertTrustedPath(this.#paths.root, snapshotPath, this.#paths.device);
    let sourceHandle: FileHandle;
    try {
      sourceHandle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      await this.#incident("missing-content", null, digest, artifact.sizeBytes, null);
      throw new ArtifactVaultError(
        "artifact-integrity-failure",
        "Committed artifact content is missing",
        { cause: error },
      );
    }
    const snapshotHandle = await open(snapshotPath, "wx+", 0o600);
    try {
      const sourceInfo = await sourceHandle.stat();
      if (!sourceInfo.isFile()) throw new Error("Artifact content is not a regular file");
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(this.#config.streamHighWaterMarkBytes);
      let sizeBytes = 0;
      let position = 0;
      for (;;) {
        const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        sizeBytes = assertSafeByteAddition(sizeBytes, bytesRead);
        if (sizeBytes > artifact.sizeBytes) {
          throw new ArtifactVaultError(
            "artifact-integrity-failure",
            "Artifact exceeded committed size during snapshot verification",
          );
        }
        hash.update(chunk);
        await snapshotHandle.write(chunk);
        position += bytesRead;
      }
      await snapshotHandle.sync();
      const digestRead = hash.digest("hex");
      if (digestRead !== artifact.digest || sizeBytes !== artifact.sizeBytes) {
        throw new ArtifactVaultError(
          "artifact-integrity-failure",
          "Artifact failed snapshot verification",
        );
      }
      await sourceHandle.close();
      const stream = snapshotHandle.createReadStream({ start: 0, autoClose: true });
      const cleanup = (): void => {
        void rm(snapshotPath, { force: true });
      };
      stream.once("end", cleanup);
      stream.once("close", cleanup);
      stream.once("error", cleanup);
      return { artifact, stream };
    } catch (error) {
      await sourceHandle.close().catch(() => undefined);
      await snapshotHandle.close().catch(() => undefined);
      await rm(snapshotPath, { force: true }).catch(() => undefined);
      await this.#incident("snapshot-verification-failure", null, digest, artifact.sizeBytes, null);
      await this.#quarantine(source, digest);
      throw error;
    }
  }

  async getAttempt(id: string): Promise<RetrievalAttempt | undefined> {
    return this.#repository.getAttempt(persistedRetrievalAttemptId(id));
  }
  async getObservation(id: string): Promise<ArtifactObservation | undefined> {
    return this.#repository.getObservation(id);
  }
  async readObservations(
    digest: ArtifactDigest,
    afterSequence: string,
    limit: number,
  ): Promise<ArtifactPage<ArtifactObservation>> {
    assertArtifactDigest(digest);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
      throw new RangeError("Invalid page limit");
    return this.#repository.readObservations(digest, afterSequence, limit);
  }

  async reconcile(budget: Partial<ReconciliationBudget> = {}): Promise<ReconciliationReport> {
    await this.#lease.renewAndAssert();
    this.#repository.verifyAllEvidence();
    const maxItems = budget.maxItems ?? 1_000;
    const maxElapsedMs = budget.maxElapsedMs ?? 1_000;
    if (
      !Number.isSafeInteger(maxItems) ||
      maxItems < 1 ||
      !Number.isSafeInteger(maxElapsedMs) ||
      maxElapsedMs < 1
    )
      throw new RangeError("Invalid reconciliation budget");
    const started = Date.now();
    let processed = 0;
    const report = {
      validArtifacts: 0,
      adoptedOrphans: 0,
      abandonedStages: 0,
      expiredStages: 0,
      quarantinedObjects: 0,
      missingArtifacts: 0,
      incidents: [] as string[],
      continuationCursor: null as string | null,
    };
    const exhausted = (): boolean => processed >= maxItems || Date.now() - started >= maxElapsedMs;
    const continueLater = (): ReconciliationReport => ({
      ...report,
      continuationCursor: "restart-v1",
    });
    for (const name of await readdir(this.#paths.snapshots)) {
      if (exhausted()) return continueLater();
      await this.#lease.renewAndAssert();
      await rm(safeChild(this.#paths.snapshots, name), { force: true });
      processed += 1;
    }
    const openAttempts = new Map(
      this.#repository.listOpenAttempts().map((attempt) => [attempt.stagingId, attempt]),
    );
    for (const name of await readdir(this.#paths.staging)) {
      if (exhausted()) return continueLater();
      processed += 1;
      const stagingId = name.endsWith(".part") ? name.slice(0, -5) : null;
      const attempt = stagingId === null ? undefined : openAttempts.get(stagingId);
      const path = safeChild(this.#paths.staging, name);
      if (attempt === undefined) {
        const id = await this.#incident("invalid-orphan", stagingId, null, null, null);
        report.incidents.push(id);
        await this.#quarantine(path, id);
        report.quarantinedObjects += 1;
        continue;
      }
      const age = this.#clock.nowMs() - attempt.recordedAtMs;
      if (age >= this.#config.stageExpiryMs) {
        await this.#lease.renewAndAssert();
        this.#repository.finishAttempt(
          {
            attemptId: attempt.attemptId,
            outcome: "expired",
            completedAtMs: this.#clock.nowMs(),
            reasonCode: "stage-expired",
            detailHash: null,
          },
          this.#lease.fence(),
        );
        const id = await this.#incident("expired-stage", stagingId, null, null, null);
        report.incidents.push(id);
        await this.#quarantine(path, id);
        report.expiredStages += 1;
        report.quarantinedObjects += 1;
        openAttempts.delete(attempt.stagingId);
      }
    }
    for (const attempt of openAttempts.values()) {
      if (exhausted()) return continueLater();
      processed += 1;
      if (this.#clock.nowMs() - attempt.recordedAtMs >= this.#config.stageExpiryMs) {
        await this.#lease.renewAndAssert();
        this.#repository.finishAttempt(
          {
            attemptId: attempt.attemptId,
            outcome: "expired",
            completedAtMs: this.#clock.nowMs(),
            reasonCode: "stage-missing",
            detailHash: null,
          },
          this.#lease.fence(),
        );
        report.expiredStages += 1;
      }
    }
    for (const first of await readdir(this.#paths.content)) {
      if (exhausted()) return continueLater();
      processed += 1;
      const firstPath = safeChild(this.#paths.content, first);
      if (!(await lstat(firstPath)).isDirectory()) {
        await this.#quarantine(firstPath, randomUUID());
        report.quarantinedObjects += 1;
        continue;
      }
      for (const second of await readdir(firstPath)) {
        if (exhausted()) return continueLater();
        processed += 1;
        const secondPath = safeChild(firstPath, second);
        if (!(await lstat(secondPath)).isDirectory()) {
          await this.#quarantine(secondPath, randomUUID());
          report.quarantinedObjects += 1;
          continue;
        }
        for (const name of await readdir(secondPath)) {
          if (exhausted()) return continueLater();
          processed += 1;
          const path = safeChild(secondPath, name);
          try {
            assertArtifactDigest(name);
            const verified = await hashFile(path);
            if (verified.digest !== name) throw new Error("digest mismatch");
            const existing = this.#repository.stat(name);
            if (existing === undefined) {
              await this.#lease.renewAndAssert();
              this.#repository.adoptArtifact(
                {
                  digest: name,
                  algorithm: "sha256",
                  sizeBytes: verified.sizeBytes,
                  committedAtMs: this.#clock.nowMs(),
                  provenance: "recovered-orphan",
                },
                this.#lease.fence(),
              );
              report.adoptedOrphans += 1;
            } else if (existing.sizeBytes !== verified.sizeBytes) throw new Error("size mismatch");
            else report.validArtifacts += 1;
          } catch {
            const id = await this.#incident(
              "invalid-orphan",
              null,
              /^[0-9a-f]{64}$/u.test(name) ? name : null,
              null,
              null,
            );
            report.incidents.push(id);
            await this.#quarantine(path, id);
            report.quarantinedObjects += 1;
          }
        }
      }
    }
    for (const artifact of this.#repository.listArtifacts()) {
      if (exhausted()) return continueLater();
      processed += 1;
      const path = await this.#contentPath(artifact.digest, false, false);
      try {
        await stat(path);
      } catch {
        const id = await this.#incident(
          "missing-content",
          null,
          artifact.digest,
          artifact.sizeBytes,
          null,
        );
        report.incidents.push(id);
        report.missingArtifacts += 1;
      }
    }
    return report;
  }

  #committedBytes(): number {
    return this.#repository
      .listArtifacts()
      .reduce((total, artifact) => assertSafeByteAddition(total, artifact.sizeBytes), 0);
  }

  async #contentPath(digest: string, create: boolean, requireExisting = true): Promise<string> {
    assertArtifactDigest(digest);
    const first = safeChild(this.#paths.content, digest.slice(0, 2));
    const second = safeChild(first, digest.slice(2, 4));
    if (create) {
      await ensurePlainDirectory(first);
      await ensurePlainDirectory(second);
    }
    const path = safeChild(second, digest);
    await assertTrustedPath(this.#paths.root, path, this.#paths.device);
    if (requireExisting && !create) await lstat(path);
    return path;
  }

  async #incident(
    kind: IncidentKind,
    stagingId: string | null,
    claimedDigest: string | null,
    expected: number | null,
    actual: number | null,
  ): Promise<string> {
    await this.#lease.renewAndAssert();
    const recordedAtMs = this.#clock.nowMs();
    const seed = {
      kind,
      recordedAtMs,
      stagingId,
      claimedDigest,
      detailHash: null,
      nonce: randomUUID(),
    };
    const incident: IntegrityIncident = {
      incidentId: deriveIncidentId(seed),
      kind,
      recordedAtMs,
      stagingId,
      claimedDigest,
      expectedSizeBytes: expected,
      actualSizeBytes: actual,
      detailHash: null,
    };
    this.#repository.recordIncident(incident, this.#lease.fence());
    return incident.incidentId;
  }

  async #quarantine(path: string, token: string): Promise<void> {
    await this.#lease.renewAndAssert();
    const target = safeChild(this.#paths.quarantine, `${token}.quarantined`);
    await assertTrustedPath(this.#paths.root, target, this.#paths.device);
    await link(path, target)
      .then(async () => rm(path))
      .catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
}
