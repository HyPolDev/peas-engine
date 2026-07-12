import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Dir } from "node:fs";
import { lstat, link, open, opendir, rm, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

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
  RetrievalAttemptOutcome,
  StoreArtifactRequest,
  StoreArtifactResult,
  VerifiedArtifactRead,
} from "../../artifacts/artifact-store.js";
import { ArtifactVaultError } from "../../artifacts/errors.js";
import {
  deriveIncidentId,
  deriveObservationId,
  deriveReconciliationActionKey,
} from "../../artifacts/identity.js";
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
import type { ReconciliationPhase } from "./sqlite-artifact-repository.js";
import type { ReconciliationActionPlan } from "./sqlite-artifact-repository.js";
import { VaultWriterLease } from "./writer-lease.js";
import { artifactRuntimePaths, configuredPeasRuntimeRoot } from "./runtime-root.js";
import {
  assertTrustedPath,
  ensurePlainDirectory,
  filesystemIdentity,
  hashTrustedFile as hashFile,
  safeChild,
  syncDirectory,
} from "./trusted-filesystem.js";

type Paths = Readonly<{
  root: string;
  content: string;
  staging: string;
  snapshots: string;
  quarantine: string;
  locks: string;
  device: number;
}>;

export type ArtifactFaultBoundary = (checkpoint: string) => void | Promise<void>;
const NOOP_FAULT_BOUNDARY: ArtifactFaultBoundary = () => undefined;

const MAX_RECONCILIATION_DIRECTORY_ENTRIES = 256;

async function boundedDirectoryEntries(
  path: string,
  expectedDevice: number,
): Promise<readonly string[]> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== expectedDevice)
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "Reconciliation directory is not a trusted same-volume directory",
    );
  let directory: Dir;
  try {
    directory = await opendir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const names: string[] = [];
  try {
    for (;;) {
      const entry = await directory.read();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > MAX_RECONCILIATION_DIRECTORY_ENTRIES)
        throw new ArtifactVaultError(
          "unsafe-filesystem-object",
          "Vault directory exceeds the audited reconciliation fanout",
        );
    }
  } finally {
    try {
      await directory.close();
    } catch {
      // The primary enumeration error remains authoritative.
    }
  }
  return names.sort();
}

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

export class DurableArtifactStore implements ArtifactStore {
  readonly #repository: SqliteArtifactRepository;
  readonly #clock: Clock;
  readonly #config: ArtifactVaultConfig;
  readonly #paths: Paths;
  readonly #semaphore: Semaphore;
  readonly #lease: VaultWriterLease;
  readonly #faultBoundary: ArtifactFaultBoundary;
  #reservedBytes = 0;

  private constructor(
    repository: SqliteArtifactRepository,
    clock: Clock,
    config: ArtifactVaultConfig,
    paths: Paths,
    lease: VaultWriterLease,
    faultBoundary: ArtifactFaultBoundary,
  ) {
    this.#repository = repository;
    this.#clock = clock;
    this.#config = config;
    this.#paths = paths;
    this.#semaphore = new Semaphore(config.maxConcurrentWrites);
    this.#lease = lease;
    this.#faultBoundary = faultBoundary;
  }

  static async open(dependencies: {
    repository: SqliteArtifactRepository;
    clock: Clock;
    config: ArtifactVaultConfig;
    faultBoundary?: ArtifactFaultBoundary;
  }): Promise<DurableArtifactStore> {
    const config = validateVaultConfig(dependencies.config);
    if (
      config.runtimeRootMode === "configured" &&
      resolve(config.runtimeRoot) !== configuredPeasRuntimeRoot()
    ) {
      throw new ArtifactVaultError(
        "unsafe-filesystem-object",
        "Configured vault root must equal PEAS_RUNTIME_ROOT",
      );
    }
    const runtimePaths = artifactRuntimePaths(config.runtimeRoot);
    await ensurePlainDirectory(runtimePaths.runtimeRoot);
    await ensurePlainDirectory(runtimePaths.databaseDirectory);
    const repositoryPath = resolve(dependencies.repository.databasePath());
    if (repositoryPath !== resolve(runtimePaths.databasePath)) {
      throw new ArtifactVaultError(
        "unsafe-filesystem-object",
        "SQLite database, WAL, and artifact vault must share PEAS_RUNTIME_ROOT",
      );
    }
    const root = runtimePaths.artifactsRoot;
    const paths: Omit<Paths, "device"> = {
      root,
      content: runtimePaths.content,
      staging: runtimePaths.staging,
      snapshots: runtimePaths.snapshots,
      quarantine: runtimePaths.quarantine,
      locks: runtimePaths.locks,
    };
    for (const [name, path] of Object.entries(paths)) {
      await ensurePlainDirectory(path);
      await dependencies.faultBoundary?.(`vault-directory-created:${name}`);
    }
    const runtimeDevice = (await lstat(runtimePaths.runtimeRoot)).dev;
    const databaseDevice = (await lstat(runtimePaths.databaseDirectory)).dev;
    const device = (await lstat(root)).dev;
    if (runtimeDevice !== databaseDevice || runtimeDevice !== device) {
      throw new ArtifactVaultError(
        "unsafe-filesystem-object",
        "SQLite and artifact paths must remain on the configured runtime volume",
      );
    }
    const trustedPaths = { ...paths, device };
    const lease = await VaultWriterLease.acquire({
      path: join(paths.locks, "writer.lock"),
      behavior: config.writerLeaseBehavior,
      waitMs: config.writerLeaseWaitMs,
      durationMs: config.writerLeaseDurationMs,
      renewalMs: config.writerLeaseRenewalMs,
      repository: dependencies.repository,
      clock: dependencies.clock,
      ...(dependencies.faultBoundary === undefined
        ? {}
        : { faultBoundary: dependencies.faultBoundary }),
    });
    return new DurableArtifactStore(
      dependencies.repository,
      dependencies.clock,
      config,
      trustedPaths,
      lease,
      dependencies.faultBoundary ?? NOOP_FAULT_BOUNDARY,
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
    let installIntentId: string | null = null;
    try {
      await this.#lease.renewAndAssert();
      this.#repository.recordAttempt(attempt, this.#lease.fence());
      await this.#checkpoint("attempt-commit");
      const handle = await open(stagePath, "wx", 0o600);
      await this.#checkpoint("stage-create");
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
      await this.#checkpoint("stage-sync-close");

      const digest = hash.digest("hex");
      const finalPath = await this.#contentPath(digest, true);
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
      let disposition: "new-content" | "preexisting-verified" = "new-content";
      try {
        const existing = await hashFile(finalPath);
        if (existing.digest !== digest || existing.sizeBytes !== sizeBytes) {
          throw new ArtifactVaultError(
            "artifact-integrity-failure",
            "Existing artifact destination failed verification",
          );
        }
        disposition = "preexisting-verified";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await this.#lease.renewAndAssert();
      const intent = this.#repository.prepareInstallIntent(
        {
          attempt,
          artifact,
          observation,
          response,
          disposition,
          createdAtMs: committedAtMs,
        },
        this.#lease.fence(),
      );
      installIntentId = intent.intentId;
      await this.#checkpoint("install-intent-commit");
      try {
        if (disposition === "new-content") {
          await link(stagePath, finalPath);
          await this.#checkpoint("content-link");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const winner = await hashFile(finalPath, Number.MAX_SAFE_INTEGER, 2);
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
      }
      const installed = await hashFile(finalPath, Number.MAX_SAFE_INTEGER, 2);
      if (installed.digest !== digest || installed.sizeBytes !== sizeBytes) {
        await this.#incident("digest-mismatch", stagingId, digest, sizeBytes, installed.sizeBytes);
        throw new ArtifactVaultError(
          "artifact-integrity-failure",
          "Installed artifact failed verification",
        );
      }
      const contentHandle = await open(finalPath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
      try {
        await contentHandle.sync();
      } finally {
        await contentHandle.close();
      }
      await syncDirectory(dirname(finalPath));
      await this.#checkpoint("content-sync");
      await this.#lease.renewAndAssert();
      this.#repository.markIntentContentInstalled(intent.intentId, this.#lease.fence());
      await this.#checkpoint("content-installed-transition");
      const committed = this.#repository.commitIntentSuccess(intent.intentId, this.#lease.fence());
      await this.#checkpoint("success-intent-transaction");
      try {
        await this.#lease.renewAndAssert();
        await rm(stagePath, { force: true });
        await this.#checkpoint("stage-removal");
        this.#repository.markIntentStageCleaned(intent.intentId, this.#lease.fence());
        await this.#checkpoint("stage-cleaned-transition");
      } catch {
        // Committed evidence is authoritative; reconciliation will replay stage cleanup.
      }
      return committed;
    } catch (error) {
      try {
        await this.#lease.renewAndAssert();
        const outcome = {
          attemptId: attemptDraft.attemptId,
          outcome: error instanceof Error && error.name === "AbortError" ? "abandoned" : "failed",
          completedAtMs: this.#clock.nowMs(),
          reasonCode: error instanceof ArtifactVaultError ? error.code : "write-failed",
          detailHash: canonicalHash("peas/artifact-error/v1", {
            name: error instanceof Error ? error.name : "unknown",
          }),
        } as const;
        if (installIntentId === null) {
          try {
            await rm(stagePath, { force: true });
          } catch {
            // The terminal outcome remains authoritative.
          }
          this.#repository.finishAttempt(outcome, this.#lease.fence());
        } else {
          this.#repository.abortIntent(installIntentId, outcome, this.#lease.fence());
          await this.#checkpoint("failure-abort-transaction");
        }
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
    await this.#checkpoint("snapshot-create");
    try {
      const sourceInfo = await sourceHandle.stat();
      if (!sourceInfo.isFile() || sourceInfo.nlink !== 1)
        throw new Error("Artifact content is not a trusted single-owner regular file");
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
      await this.#checkpoint("snapshot-sync");
      const digestRead = hash.digest("hex");
      if (digestRead !== artifact.digest || sizeBytes !== artifact.sizeBytes) {
        throw new ArtifactVaultError(
          "artifact-integrity-failure",
          "Artifact failed snapshot verification",
        );
      }
      await this.#checkpoint("snapshot-verification-complete");
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
      try {
        await sourceHandle.close();
      } catch {
        // Preserve the verification failure.
      }
      try {
        await snapshotHandle.close();
      } catch {
        // Preserve the verification failure.
      }
      try {
        await rm(snapshotPath, { force: true });
      } catch {
        // Preserve the verification failure.
      }
      await this.#checkpoint("snapshot-removal");
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
    const maxItems = budget.maxItems ?? 1_000;
    const maxElapsedMs = budget.maxElapsedMs ?? 1_000;
    const maxBytes = budget.maxBytes ?? this.#config.maxArtifactBytes * Math.max(1, maxItems);
    const requestedCursor = budget.cursor ?? null;
    const startNew = budget.startNew ?? false;
    const completedRunId = budget.completedRunId ?? null;
    if (
      !Number.isSafeInteger(maxItems) ||
      maxItems < 1 ||
      !Number.isSafeInteger(maxElapsedMs) ||
      maxElapsedMs < 1 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < this.#config.maxArtifactBytes
    )
      throw new RangeError("Invalid reconciliation budget");
    const started = Date.now();
    let processed = 0;
    let bytesHashed = 0;
    let rowsVisited = 0;
    let directoryEntriesRead = 0;
    let persistedRowsVisited = 0;
    let persistedItems = 0;
    let persistedBytesHashed = 0;
    let persistedDirectoryEntries = 0;
    await this.#lease.renewAndAssert();
    const opened = this.#repository.openReconciliationCall(
      requestedCursor,
      startNew,
      completedRunId,
      this.#lease.fence(),
    );
    await this.#checkpoint("reconciliation-call-opened");
    if (opened.kind === "receipt") return opened.report;
    let state = opened.state;
    const report = {
      runId: state.runId,
      validArtifacts: 0,
      adoptedOrphans: 0,
      abandonedStages: 0,
      expiredStages: 0,
      quarantinedObjects: 0,
      missingArtifacts: 0,
      incidents: [] as string[],
      continuationCursor: null as string | null,
      rowsVisited: 0,
      directoryEntriesRead: 0,
      bytesHashed: 0,
      elapsedMs: 0,
    };
    const result = (cursor: string | null): ReconciliationReport => ({
      ...report,
      continuationCursor: cursor,
      rowsVisited,
      directoryEntriesRead,
      bytesHashed,
      elapsedMs: Date.now() - started,
    });
    const exhausted = (): boolean =>
      processed >= maxItems ||
      Date.now() - started >= maxElapsedMs ||
      maxBytes - bytesHashed < this.#config.maxArtifactBytes;
    const advance = async (
      phase: ReconciliationPhase,
      shard: number,
      afterKey: string,
    ): Promise<void> => {
      await this.#lease.renewAndAssert();
      state = this.#repository.advanceReconciliationState(
        state,
        {
          phase,
          shard,
          afterKey,
          rowsVisited: rowsVisited - persistedRowsVisited,
          itemsProcessed: processed - persistedItems,
          bytesHashed: bytesHashed - persistedBytesHashed,
          directoryEntriesRead: directoryEntriesRead - persistedDirectoryEntries,
        },
        this.#lease.fence(),
      );
      persistedRowsVisited = rowsVisited;
      persistedItems = processed;
      persistedBytesHashed = bytesHashed;
      persistedDirectoryEntries = directoryEntriesRead;
    };
    const planAction = async (
      input: Parameters<SqliteArtifactRepository["planReconciliationAction"]>[1],
    ): Promise<ReconciliationActionPlan> => {
      await this.#lease.renewAndAssert();
      const planned = this.#repository.planReconciliationAction(state, input, this.#lease.fence());
      state = planned.state;
      await this.#checkpoint("reconciliation-action-plan-commit");
      return planned.plan;
    };
    const applyAction = async (
      plan: ReconciliationActionPlan,
      phase: ReconciliationPhase,
      shard: number,
      afterKey: string,
      application: Parameters<SqliteArtifactRepository["applyReconciliationAction"]>[3],
    ): Promise<void> => {
      await this.#lease.renewAndAssert();
      state = this.#repository.applyReconciliationAction(
        state,
        plan.actionKey,
        {
          phase,
          shard,
          afterKey,
          rowsVisited: rowsVisited - persistedRowsVisited,
          itemsProcessed: processed - persistedItems,
          bytesHashed: bytesHashed - persistedBytesHashed,
          directoryEntriesRead: directoryEntriesRead - persistedDirectoryEntries,
        },
        application,
        this.#lease.fence(),
      );
      await this.#checkpoint("reconciliation-action-application-commit");
      persistedRowsVisited = rowsVisited;
      persistedItems = processed;
      persistedBytesHashed = bytesHashed;
      persistedDirectoryEntries = directoryEntriesRead;
    };
    const evidenceNext: Record<string, ReconciliationPhase> = {
      attempts: "outcomes",
      outcomes: "blobs",
      blobs: "observations",
      observations: "incidents",
      incidents: "install-intents",
    };
    while (!exhausted()) {
      if (state.phase in evidenceNext) {
        const remaining = maxItems - processed;
        const page = this.#repository.verifyEvidencePage(
          state.phase as "attempts" | "outcomes" | "blobs" | "observations" | "incidents",
          state.afterKey,
          remaining,
        );
        rowsVisited += page.visited;
        processed += Math.max(1, page.visited);
        await advance(
          page.done ? (evidenceNext[state.phase] as ReconciliationPhase) : state.phase,
          0,
          page.done ? "" : page.lastKey,
        );
        continue;
      }
      const pending = this.#repository.readPendingReconciliationAction(state);
      if (pending !== undefined) {
        const payload = pending.payload as unknown as {
          next: { phase: ReconciliationPhase; shard: number; afterKey: string };
        };
        let application: Parameters<SqliteArtifactRepository["applyReconciliationAction"]>[3] = {
          resultingIdentity: null,
          resultingDigest: null,
          resultingSizeBytes: null,
        };
        if (pending.actionKind === "quarantine") {
          if (pending.sourceRelativePath === null)
            throw new Error("Pending quarantine source is missing");
          const source = safeChild(this.#paths.root, pending.sourceRelativePath);
          const replayed = await this.#replayQuarantine(pending, source);
          application = {
            resultingIdentity: replayed.identity,
            resultingDigest: replayed.digest,
            resultingSizeBytes: replayed.sizeBytes,
          };
          report.quarantinedObjects += 1;
        } else if (pending.actionKind === "remove-snapshot") {
          if (pending.sourceRelativePath === null)
            throw new Error("Pending snapshot source is missing");
          const source = safeChild(this.#paths.root, pending.sourceRelativePath);
          await this.#lease.renewAndAssert();
          await rm(source, { force: true });
          await syncDirectory(dirname(source));
        } else if (pending.actionKind === "adopt-orphan") {
          if (pending.sourceRelativePath === null)
            throw new Error("Pending orphan source is missing");
          const source = safeChild(this.#paths.root, pending.sourceRelativePath);
          const verified = await hashFile(source);
          if (
            verified.digest !== pending.expectedDigest ||
            verified.sizeBytes !== pending.expectedSizeBytes
          )
            throw new ArtifactVaultError(
              "artifact-integrity-failure",
              "Orphan bytes changed after reconciliation planning",
            );
          bytesHashed += verified.sizeBytes;
          application = {
            resultingIdentity: await filesystemIdentity(source),
            resultingDigest: verified.digest,
            resultingSizeBytes: verified.sizeBytes,
          };
          report.adoptedOrphans += 1;
        }
        if (pending.incident !== null) {
          report.incidents.push(pending.incident.incidentId);
          if (pending.incident.kind === "missing-content") report.missingArtifacts += 1;
          if (pending.incident.kind === "expired-stage") report.expiredStages += 1;
          if (pending.incident.kind === "abandoned-stage") report.abandonedStages += 1;
        }
        processed += 1;
        await applyAction(
          pending,
          payload.next.phase,
          payload.next.shard,
          payload.next.afterKey,
          application,
        );
        continue;
      }
      if (state.phase === "install-intents") {
        const intents = this.#repository.readPendingIntentPage(state.afterKey, 1);
        const intent = intents[0];
        rowsVisited += intents.length;
        if (intent === undefined) {
          await advance("snapshots", 0, "");
          processed += 1;
          continue;
        }
        const stagePath = safeChild(this.#paths.staging, `${intent.stagingId}.part`);
        const contentPath = await this.#contentPath(intent.digest, true, false);
        const verify = async (path: string): Promise<boolean> => {
          try {
            const value = await hashFile(path, Number.MAX_SAFE_INTEGER, 2);
            bytesHashed += value.sizeBytes;
            return value.digest === intent.digest && value.sizeBytes === intent.sizeBytes;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw error;
          }
        };
        const contentPresent = await verify(contentPath);
        const stagePresent = await verify(stagePath);
        if (!contentPresent && !stagePresent) {
          await this.#lease.renewAndAssert();
          this.#repository.abortIntent(
            intent.intentId,
            {
              attemptId: intent.attemptId,
              outcome: "expired",
              completedAtMs: this.#clock.nowMs(),
              reasonCode: "install-content-missing",
              detailHash: null,
            } as RetrievalAttemptOutcome,
            this.#lease.fence(),
          );
        } else {
          if (!contentPresent) {
            await this.#lease.renewAndAssert();
            await assertTrustedPath(this.#paths.root, contentPath, this.#paths.device);
            await link(stagePath, contentPath);
          }
          await this.#lease.renewAndAssert();
          this.#repository.markIntentContentInstalled(intent.intentId, this.#lease.fence());
          this.#repository.commitIntentSuccess(intent.intentId, this.#lease.fence());
          await this.#lease.renewAndAssert();
          await rm(stagePath, { force: true });
          this.#repository.markIntentStageCleaned(intent.intentId, this.#lease.fence());
        }
        await advance("install-intents", 0, intent.intentId);
        processed += 1;
        continue;
      }
      if (state.phase === "snapshots" || state.phase === "staging") {
        const root = state.phase === "snapshots" ? this.#paths.snapshots : this.#paths.staging;
        const names = await boundedDirectoryEntries(root, this.#paths.device);
        directoryEntriesRead += names.length;
        const name = names.find((candidate) => candidate > state.afterKey);
        if (name === undefined) {
          await advance(state.phase === "snapshots" ? "staging" : "open-attempts", 0, "");
          processed += 1;
          continue;
        }
        const path = safeChild(root, name);
        if (state.phase === "snapshots") {
          await planAction({
            actionKind: "remove-snapshot",
            sourceRelativePath: relative(this.#paths.root, path),
            sourceIdentity: await filesystemIdentity(path),
            expectedDigest: null,
            expectedSizeBytes: null,
            incident: null,
            identity: { name },
            payload: {
              next: { phase: "snapshots", shard: 0, afterKey: name },
            },
            recordedAtMs: this.#clock.nowMs(),
          });
          continue;
        } else {
          const stagingId = name.endsWith(".part") ? name.slice(0, -5) : null;
          const attempt =
            stagingId === null ? undefined : this.#repository.getAttemptByStagingId(stagingId);
          if (attempt === undefined) {
            const verified = await hashFile(path);
            bytesHashed += verified.sizeBytes;
            await planAction({
              actionKind: "quarantine",
              sourceRelativePath: relative(this.#paths.root, path),
              sourceIdentity: await filesystemIdentity(path),
              expectedDigest: verified.digest,
              expectedSizeBytes: verified.sizeBytes,
              incident: {
                kind: "invalid-orphan",
                stagingId,
                claimedDigest: null,
                expectedSizeBytes: null,
                actualSizeBytes: verified.sizeBytes,
                detailHash: null,
                facts: { name, stagingId, digest: verified.digest, sizeBytes: verified.sizeBytes },
              },
              identity: { name, stagingId, digest: verified.digest, sizeBytes: verified.sizeBytes },
              payload: {
                next: { phase: "staging", shard: 0, afterKey: name },
              },
              recordedAtMs: this.#clock.nowMs(),
            });
            continue;
          } else if (this.#repository.getOutcome(attempt.attemptId) !== undefined) {
            const verified = await hashFile(path);
            bytesHashed += verified.sizeBytes;
            const outcome = this.#repository.getOutcome(attempt.attemptId);
            await planAction({
              actionKind: "quarantine",
              sourceRelativePath: relative(this.#paths.root, path),
              sourceIdentity: await filesystemIdentity(path),
              expectedDigest: verified.digest,
              expectedSizeBytes: verified.sizeBytes,
              incident: {
                kind: "abandoned-stage",
                stagingId,
                claimedDigest: null,
                expectedSizeBytes: null,
                actualSizeBytes: verified.sizeBytes,
                detailHash: outcome?.detailHash ?? null,
                facts: {
                  stagingId,
                  attemptId: attempt.attemptId,
                  outcome: outcome?.outcome ?? "unknown",
                  digest: verified.digest,
                  sizeBytes: verified.sizeBytes,
                },
              },
              identity: {
                stagingId,
                attemptId: attempt.attemptId,
                outcome: outcome?.outcome ?? "unknown",
                digest: verified.digest,
              },
              payload: {
                next: { phase: "staging", shard: 0, afterKey: name },
              },
              recordedAtMs: this.#clock.nowMs(),
            });
            continue;
          } else if (this.#clock.nowMs() - attempt.recordedAtMs >= this.#config.stageExpiryMs) {
            const verified = await hashFile(path);
            bytesHashed += verified.sizeBytes;
            const outcome: RetrievalAttemptOutcome = {
              attemptId: attempt.attemptId,
              outcome: "expired",
              completedAtMs: this.#clock.nowMs(),
              reasonCode: "stage-expired",
              detailHash: null,
            };
            await planAction({
              actionKind: "quarantine",
              sourceRelativePath: relative(this.#paths.root, path),
              sourceIdentity: await filesystemIdentity(path),
              expectedDigest: verified.digest,
              expectedSizeBytes: verified.sizeBytes,
              incident: {
                kind: "expired-stage",
                stagingId,
                claimedDigest: null,
                expectedSizeBytes: null,
                actualSizeBytes: verified.sizeBytes,
                detailHash: null,
                facts: { stagingId, digest: verified.digest, sizeBytes: verified.sizeBytes },
              },
              identity: { stagingId, attemptId: attempt.attemptId, digest: verified.digest },
              payload: {
                outcome: outcome as unknown as JsonValue,
                next: { phase: "staging", shard: 0, afterKey: name },
              },
              recordedAtMs: outcome.completedAtMs,
            });
            continue;
          }
        }
        await advance(state.phase, 0, name);
        processed += 1;
        continue;
      }
      if (state.phase === "open-attempts") {
        const attempts = this.#repository.readOpenAttemptsPage(state.afterKey, 1);
        const attempt = attempts[0];
        rowsVisited += attempts.length;
        if (attempt === undefined) {
          await advance("content", 0, "");
        } else {
          const stagePath = safeChild(this.#paths.staging, `${attempt.stagingId}.part`);
          let present = true;
          try {
            await lstat(stagePath);
          } catch {
            present = false;
          }
          if (
            !present &&
            this.#clock.nowMs() - attempt.recordedAtMs >= this.#config.stageExpiryMs
          ) {
            const outcome: RetrievalAttemptOutcome = {
              attemptId: attempt.attemptId,
              outcome: "expired",
              completedAtMs: this.#clock.nowMs(),
              reasonCode: "stage-missing",
              detailHash: null,
            };
            await planAction({
              actionKind: "expire-attempt",
              sourceRelativePath: relative(this.#paths.root, stagePath),
              sourceIdentity: null,
              expectedDigest: null,
              expectedSizeBytes: null,
              incident: null,
              identity: { attemptId: attempt.attemptId, reasonCode: outcome.reasonCode },
              payload: {
                outcome: outcome as unknown as JsonValue,
                next: { phase: "open-attempts", shard: 0, afterKey: attempt.attemptId },
              },
              recordedAtMs: outcome.completedAtMs,
            });
            const pendingPlan = this.#repository.readPendingReconciliationAction(state);
            if (pendingPlan === undefined)
              throw new Error("Expired-attempt plan was not persisted");
            processed += 1;
            await applyAction(pendingPlan, "open-attempts", 0, attempt.attemptId, {
              resultingIdentity: null,
              resultingDigest: null,
              resultingSizeBytes: null,
            });
            report.expiredStages += 1;
            continue;
          }
          await advance("open-attempts", 0, attempt.attemptId);
        }
        processed += 1;
        continue;
      }
      if (state.phase === "content") {
        const leaf = await this.#nextContentLeaf(state.shard);
        directoryEntriesRead += leaf.entriesRead;
        if (leaf.done) {
          await advance("missing-content", 0, "");
          processed += 1;
          continue;
        }
        if (leaf.shard !== state.shard) {
          await advance("content", leaf.shard, "");
          processed += 1;
          continue;
        }
        const name = leaf.names.find((candidate) => candidate > state.afterKey);
        if (name === undefined) {
          await advance("content", state.shard + 1, "");
          processed += 1;
          continue;
        }
        const path = safeChild(leaf.path, name);
        try {
          assertArtifactDigest(name);
          const verified = await hashFile(
            path,
            Math.min(this.#config.maxArtifactBytes, maxBytes - bytesHashed),
          );
          bytesHashed += verified.sizeBytes;
          if (verified.digest !== name) throw new Error("digest mismatch");
          const existing = this.#repository.stat(name);
          if (existing === undefined) {
            const artifact: ArtifactMetadata = {
              digest: name,
              algorithm: "sha256",
              sizeBytes: verified.sizeBytes,
              committedAtMs: this.#clock.nowMs(),
              provenance: "recovered-orphan",
            };
            await planAction({
              actionKind: "adopt-orphan",
              sourceRelativePath: relative(this.#paths.root, path),
              sourceIdentity: await filesystemIdentity(path),
              expectedDigest: verified.digest,
              expectedSizeBytes: verified.sizeBytes,
              incident: null,
              identity: { digest: verified.digest, sizeBytes: verified.sizeBytes },
              payload: {
                artifact: artifact as unknown as JsonValue,
                next: { phase: "content", shard: state.shard, afterKey: name },
              },
              recordedAtMs: artifact.committedAtMs,
            });
            continue;
          } else if (existing.sizeBytes !== verified.sizeBytes) throw new Error("size mismatch");
          else report.validArtifacts += 1;
        } catch (error) {
          if (state.pendingActionKey !== null) throw error;
          const verified = await hashFile(path);
          bytesHashed += verified.sizeBytes;
          const claimedDigest = /^[0-9a-f]{64}$/u.test(name) ? name : null;
          await planAction({
            actionKind: "quarantine",
            sourceRelativePath: relative(this.#paths.root, path),
            sourceIdentity: await filesystemIdentity(path),
            expectedDigest: verified.digest,
            expectedSizeBytes: verified.sizeBytes,
            incident: {
              kind: "invalid-orphan",
              stagingId: null,
              claimedDigest,
              expectedSizeBytes: null,
              actualSizeBytes: verified.sizeBytes,
              detailHash: null,
              facts: {
                name,
                claimedDigest,
                actualDigest: verified.digest,
                sizeBytes: verified.sizeBytes,
              },
            },
            identity: { name, digest: verified.digest, sizeBytes: verified.sizeBytes },
            payload: {
              next: { phase: "content", shard: state.shard, afterKey: name },
            },
            recordedAtMs: this.#clock.nowMs(),
          });
          continue;
        }
        await advance("content", state.shard, name);
        processed += 1;
        continue;
      }
      const artifacts = this.#repository.readArtifactsPage(state.afterKey, 1);
      const artifact = artifacts[0];
      rowsVisited += artifacts.length;
      if (artifact === undefined) {
        const terminal = result(null);
        this.#repository.commitReconciliationReceipt(state, terminal, true, this.#lease.fence());
        await this.#checkpoint("reconciliation-terminal-receipt-commit");
        return terminal;
      }
      const path = await this.#contentPath(artifact.digest, false, false);
      try {
        await stat(path);
      } catch {
        await planAction({
          actionKind: "record-missing-content",
          sourceRelativePath: relative(this.#paths.root, path),
          sourceIdentity: null,
          expectedDigest: artifact.digest,
          expectedSizeBytes: artifact.sizeBytes,
          incident: {
            kind: "missing-content",
            stagingId: null,
            claimedDigest: artifact.digest,
            expectedSizeBytes: artifact.sizeBytes,
            actualSizeBytes: null,
            detailHash: null,
            facts: { digest: artifact.digest, expectedSizeBytes: artifact.sizeBytes },
          },
          identity: { digest: artifact.digest, expectedSizeBytes: artifact.sizeBytes },
          payload: {
            next: { phase: "missing-content", shard: 0, afterKey: artifact.digest },
          },
          recordedAtMs: this.#clock.nowMs(),
        });
        continue;
      }
      await advance("missing-content", 0, artifact.digest);
      processed += 1;
    }
    const partial = result(state.cursorToken);
    this.#repository.commitReconciliationReceipt(state, partial, false, this.#lease.fence());
    await this.#checkpoint("reconciliation-call-receipt-commit");
    return partial;
  }

  async #nextContentLeaf(startShard: number): Promise<
    Readonly<{
      done: boolean;
      shard: number;
      path: string;
      names: readonly string[];
      entriesRead: number;
    }>
  > {
    const firstNames = await boundedDirectoryEntries(this.#paths.content, this.#paths.device);
    for (const name of firstNames)
      if (!/^[0-9a-f]{2}$/u.test(name))
        throw new ArtifactVaultError(
          "unsafe-filesystem-object",
          "Artifact content root contains an invalid shard",
        );
    const minimumFirst = Math.floor(startShard / 256);
    const first = firstNames.find((name) => Number.parseInt(name, 16) >= minimumFirst);
    if (first === undefined)
      return {
        done: true,
        shard: 65536,
        path: this.#paths.content,
        names: [],
        entriesRead: firstNames.length,
      };
    const firstValue = Number.parseInt(first, 16);
    const firstPath = safeChild(this.#paths.content, first);
    const secondNames = await boundedDirectoryEntries(firstPath, this.#paths.device);
    for (const name of secondNames)
      if (!/^[0-9a-f]{2}$/u.test(name))
        throw new ArtifactVaultError(
          "unsafe-filesystem-object",
          "Artifact content shard contains an invalid shard",
        );
    const minimumSecond = firstValue === minimumFirst ? startShard % 256 : 0;
    const second = secondNames.find((name) => Number.parseInt(name, 16) >= minimumSecond);
    if (second === undefined)
      return {
        done: false,
        shard: (firstValue + 1) * 256,
        path: firstPath,
        names: [],
        entriesRead: firstNames.length + secondNames.length,
      };
    const shard = firstValue * 256 + Number.parseInt(second, 16);
    const path = safeChild(firstPath, second);
    const names = await boundedDirectoryEntries(path, this.#paths.device);
    return {
      done: false,
      shard,
      path,
      names,
      entriesRead: firstNames.length + secondNames.length + names.length,
    };
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
    const facts = {
      kind,
      stagingId,
      claimedDigest,
      expectedSizeBytes: expected,
      actualSizeBytes: actual,
      detailHash: null,
    };
    const actionKey = deriveReconciliationActionKey(facts);
    const incident: IntegrityIncident = {
      incidentId: deriveIncidentId({ actionKey, kind, facts }),
      actionKey: null,
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

  async #checkpoint(name: string): Promise<void> {
    await this.#faultBoundary(name);
  }

  async #replayQuarantine(
    plan: ReconciliationActionPlan,
    sourcePath: string,
  ): Promise<Readonly<{ identity: JsonValue; digest: string; sizeBytes: number }>> {
    if (plan.quarantineName === null || plan.sourceIdentity === null)
      throw new Error("Quarantine plan is incomplete");
    const target = safeChild(this.#paths.quarantine, plan.quarantineName);
    await assertTrustedPath(this.#paths.root, sourcePath, this.#paths.device);
    await assertTrustedPath(this.#paths.root, target, this.#paths.device);
    const readIdentity = async (path: string): Promise<JsonValue | null> => {
      try {
        return await filesystemIdentity(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    };
    let sourceIdentity = await readIdentity(sourcePath);
    let targetIdentity = await readIdentity(target);
    const planned = plan.sourceIdentity as Record<string, JsonValue>;
    const matchesPlan = (candidate: JsonValue): boolean => {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate))
        return false;
      const record = candidate as Record<string, JsonValue>;
      return (
        record["device"] === planned["device"] &&
        record["inode"] === planned["inode"] &&
        record["mode"] === planned["mode"] &&
        record["sizeBytes"] === planned["sizeBytes"] &&
        record["modifiedAtMs"] === planned["modifiedAtMs"] &&
        record["isFile"] === true &&
        record["isSymbolicLink"] === false
      );
    };
    if (sourceIdentity !== null && !matchesPlan(sourceIdentity))
      throw new ArtifactVaultError(
        "unsafe-filesystem-object",
        "Quarantine source identity changed after planning",
      );
    if (targetIdentity !== null && !matchesPlan(targetIdentity))
      throw new ArtifactVaultError(
        "artifact-integrity-failure",
        "Deterministic quarantine destination conflicts with its plan",
      );
    if (sourceIdentity === null && targetIdentity === null)
      throw new ArtifactVaultError(
        "artifact-integrity-failure",
        "Planned quarantine source and destination are both missing",
      );
    if (targetIdentity === null) {
      await this.#lease.renewAndAssert();
      await link(sourcePath, target);
      await this.#checkpoint("quarantine-link");
      targetIdentity = await filesystemIdentity(target);
    }
    const targetHandle = await open(target, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
    try {
      await targetHandle.sync();
    } finally {
      await targetHandle.close();
    }
    await syncDirectory(this.#paths.quarantine);
    await this.#checkpoint("quarantine-sync");
    if (sourceIdentity !== null) {
      await this.#lease.renewAndAssert();
      await rm(sourcePath);
      await syncDirectory(dirname(sourcePath));
      await this.#checkpoint("quarantine-source-removal");
      sourceIdentity = null;
    }
    const verified = await hashFile(target);
    if (
      (plan.expectedDigest !== null && verified.digest !== plan.expectedDigest) ||
      (plan.expectedSizeBytes !== null && verified.sizeBytes !== plan.expectedSizeBytes)
    )
      throw new ArtifactVaultError(
        "artifact-integrity-failure",
        "Quarantine target bytes differ from the durable plan",
      );
    return {
      identity: await filesystemIdentity(target),
      digest: verified.digest,
      sizeBytes: verified.sizeBytes,
    };
  }

  async #quarantine(path: string, token: string): Promise<void> {
    await this.#lease.renewAndAssert();
    const target = safeChild(this.#paths.quarantine, `${token}.quarantined`);
    await assertTrustedPath(this.#paths.root, target, this.#paths.device);
    try {
      await link(path, target);
      await rm(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
