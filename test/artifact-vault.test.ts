import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { DurableArtifactStore } from "../src/adapters/artifacts/durable-artifact-store.js";
import {
  artifactRuntimePaths,
  configuredPeasRuntimeRoot,
} from "../src/adapters/artifacts/runtime-root.js";
import { SqliteArtifactRepository } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import type { WriterFence } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import type {
  PersistedReconciliationState,
  ReconciliationPhase,
} from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { deriveObservationId, sanitizeRequestIdentity } from "../src/artifacts/identity.js";
import { ArtifactVaultError } from "../src/artifacts/errors.js";
import {
  assertSafeByteAddition,
  createPersistedRetrievalAttempt,
  persistedRetrievalAttemptId,
  validateRetrievalAttempt,
} from "../src/artifacts/validation.js";
import type {
  ArtifactVaultConfig,
  ReconciliationReport,
  RetrievalAttempt,
  StoreArtifactRequest,
} from "../src/artifacts/artifact-store.js";
import { ManualClock } from "../src/core/clock.js";
import { canonicalHash } from "../src/core/hash.js";
import type { JsonValue } from "../src/core/json.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const artifactWorkerPath = join(process.cwd(), "test", "fixtures", "artifact-vault-worker.mjs");
const reconciliationWorkerPath = join(
  process.cwd(),
  "test",
  "fixtures",
  "artifact-reconciliation-worker.mjs",
);
const artifactReadWorkerPath = join(process.cwd(), "test", "fixtures", "artifact-read-worker.mjs");

type Harness = Readonly<{
  root: string;
  database: ReturnType<typeof openSqliteDatabase>;
  repository: SqliteArtifactRepository;
  clock: ManualClock;
  store: DurableArtifactStore;
}>;

function vaultConfig(
  runtimeRoot: string,
  overrides: Partial<ArtifactVaultConfig> = {},
): ArtifactVaultConfig {
  return {
    runtimeRootMode: "ci-temporary",
    runtimeRoot,
    maxArtifactBytes: 1_024,
    maxVaultBytes: 4_096,
    maxConcurrentWrites: 2,
    streamHighWaterMarkBytes: 17,
    stageExpiryMs: 1_000,
    writerLeaseBehavior: "fail",
    writerLeaseWaitMs: 0,
    writerLeaseDurationMs: 30_000,
    writerLeaseRenewalMs: 10_000,
    ...overrides,
  };
}

async function harness(
  context: test.TestContext,
  overrides: Partial<ArtifactVaultConfig> = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "peas-artifact-vault-"));
  const paths = artifactRuntimePaths(root);
  mkdirSync(paths.databaseDirectory);
  const database = openSqliteDatabase(paths.databasePath, migrations);
  const repository = new SqliteArtifactRepository(database);
  const clock = new ManualClock(1_800_000_000_000);
  const store = await DurableArtifactStore.open({
    repository,
    clock,
    config: vaultConfig(root, overrides),
  });
  context.after(async () => {
    await store.close();
    if (database.open) database.close();
    const prefix = join(tmpdir(), "peas-artifact-vault-");
    if (!root.startsWith(prefix)) throw new Error("Unsafe artifact test cleanup path");
    rmSync(root, { recursive: true, force: true });
  });
  return { root, database, repository, clock, store };
}

function request(attemptId: string, bytes: Buffer): StoreArtifactRequest {
  return {
    attempt: {
      attemptId,
      provider: "fixture-provider",
      recordId: `record-${attemptId}`,
      revisionId: "1",
      startedAtMs: 1_800_000_000_000,
      request: sanitizeRequestIdentity({
        method: "get",
        origin: "https://example.test",
        path: `/secret/${attemptId}?api_key=never-store`,
        routeLabel: "fixture.artifact",
      }),
    },
    response: {
      statusCode: 200,
      etag: '"fixture"',
      lastModified: null,
      mediaType: "application/octet-stream",
      contentEncoding: "gzip",
      declaredContentLength: bytes.length,
      transportDecoded: true,
    },
    entityBytes: Readable.from([bytes]),
  };
}

async function consume(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

function activeFence(
  database: ReturnType<typeof openSqliteDatabase>,
  clock: ManualClock,
): WriterFence {
  const row = database
    .prepare("SELECT owner_token, generation FROM artifact_writer_fence WHERE singleton = 1")
    .get() as { owner_token: string; generation: bigint };
  return {
    ownerToken: row.owner_token,
    generation: Number(row.generation),
    nowMs: () => clock.nowMs(),
  };
}

function waitForWorkerMessage(
  child: ChildProcess,
  expectedType: "ready" | "staged" | "checkpoint" | "result",
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Artifact worker timed out before ${expectedType}`));
    }, 5_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onMessage = (message: unknown): void => {
      if (typeof message !== "object" || message === null || !("type" in message)) return;
      const actualType = (message as { type: unknown }).type;
      if (actualType !== expectedType) {
        if (actualType !== "result") return;
        cleanup();
        reject(new Error(`Artifact worker failed before ${expectedType}`));
        return;
      }
      cleanup();
      resolve(message as Record<string, unknown>);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(
        new Error(`Artifact worker exited early (code=${String(code)}, signal=${String(signal)})`),
      );
    };
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForWorkerExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
}

function processFixture(
  context: test.TestContext,
  name: string,
): { root: string; databasePath: string } {
  const root = mkdtempSync(join(tmpdir(), `peas-artifact-${name}-`));
  context.after(() => {
    const prefix = join(tmpdir(), `peas-artifact-${name}-`);
    if (!root.startsWith(prefix)) throw new Error("Unsafe process fixture cleanup path");
    rmSync(root, { recursive: true, force: true });
  });
  const paths = artifactRuntimePaths(root);
  mkdirSync(paths.databaseDirectory);
  const databasePath = paths.databasePath;
  const database = openSqliteDatabase(databasePath, migrations);
  database.close();
  return { root, databasePath };
}

test("stores entity bytes, separates evidence, deduplicates, and reads verified snapshots", async (context) => {
  const { root, database, store } = await harness(context);
  const bytes = Buffer.from([0, 255, 1, 2, 3, 0]);
  const first = await store.store(request("attempt-one", bytes));
  const second = await store.store(request("attempt-two", bytes));

  assert.equal(first.disposition, "created");
  assert.equal(second.disposition, "deduplicated");
  assert.equal(first.artifact.digest, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(
    (database.prepare("SELECT count(*) count FROM artifact_blobs").get() as { count: bigint })
      .count,
    1n,
  );

  assert.deepEqual(await store.getAttempt("attempt-one"), await store.getAttempt("attempt-one"));
  assert.equal(await store.getAttempt("missing-attempt"), undefined);
  assert.deepEqual(await store.getObservation(first.observation.observationId), first.observation);
  assert.equal(await store.getObservation("missing-observation"), undefined);
  const firstPage = await store.readObservations(first.artifact.digest, "0", 1);
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.hasMore, true);
  const secondPage = await store.readObservations(first.artifact.digest, firstPage.nextSequence, 1);
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.hasMore, false);
  assert.equal((await store.stat(first.artifact.digest))?.sizeBytes, bytes.length);
  assert.equal(await store.stat("0".repeat(64)), undefined);
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_retrieval_attempts").get() as {
        count: bigint;
      }
    ).count,
    2n,
  );
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_install_intents").get() as {
        count: bigint;
      }
    ).count,
    2n,
  );
  for (const state of ["content-installed", "evidence-committed", "stage-cleaned"])
    assert.equal(
      (
        database
          .prepare("SELECT count(*) count FROM artifact_install_transitions WHERE state = ?")
          .get(state) as { count: bigint }
      ).count,
      2n,
    );
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_observations").get() as {
        count: bigint;
      }
    ).count,
    2n,
  );
  assert.equal(
    (
      database
        .prepare(
          "SELECT count(*) count FROM artifact_retrieval_outcomes WHERE outcome = 'succeeded'",
        )
        .get() as { count: bigint }
    ).count,
    2n,
  );

  const verified = await store.read(first.artifact.digest);
  assert.deepEqual(await consume(verified.stream), bytes);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(readdirSync(join(root, "artifacts", "snapshots")), []);
});

test("verified reads acknowledge destroy with one terminal close", async (context) => {
  const { store } = await harness(context);
  const stored = await store.store(
    request("verified-destroy-close", Buffer.from("close contract")),
  );
  const verified = await store.read(stored.artifact.digest);
  let closeCount = 0;
  verified.stream.on("close", () => {
    closeCount += 1;
  });
  const closed = once(verified.stream, "close");
  verified.stream.destroy();
  await closed;
  assert.equal(verified.stream.destroyed, true);
  assert.equal(verified.stream.closed, true);
  assert.equal(closeCount, 1);
});

test("does not persist raw paths or query secrets", async (context) => {
  const { database, store } = await harness(context);
  await store.store(request("sensitive-attempt", Buffer.from("entity")));
  const serialized = database.serialize();
  assert.equal(serialized.includes("api_key"), false);
  assert.equal(serialized.includes("/secret/"), false);
  assert.equal(serialized.includes("never-store"), false);
});

test("persistence boundary rejects unsafe strings without leaking sentinel secrets", async (context) => {
  const { database, store } = await harness(context);
  const sentinel = "SENTINEL_SECRET_7f3b";
  const base = request("safe-attempt", Buffer.from("entity"));
  const attempts = ["provider", "recordId", "revisionId"] as const;
  for (const field of attempts) {
    const unsafe = {
      ...base,
      attempt: {
        ...base.attempt,
        attemptId: `unsafe-${field}`,
        [field]: `https://user:${sentinel}@example.test/?token=${sentinel}`,
      },
    };
    await assert.rejects(() => store.store(unsafe));
  }
  for (const field of ["etag", "lastModified", "mediaType", "contentEncoding"] as const) {
    const unsafe = {
      ...base,
      attempt: { ...base.attempt, attemptId: `unsafe-${field}` },
      response: { ...base.response, [field]: `Bearer ${sentinel}\r\nCookie: ${sentinel}` },
    };
    await assert.rejects(() => store.store(unsafe));
  }
  assert.equal(database.serialize().includes(sentinel), false);
});

test("grammar-valid external identifiers are irreversibly hashed before persistence", async (context) => {
  const { database, store } = await harness(context);
  const sentinel = "OpaqueSecretToken_7f3b.Valid-But-Sensitive";
  const value = request(sentinel, Buffer.from("entity"));
  await store.store({
    ...value,
    attempt: {
      ...value.attempt,
      provider: sentinel,
      recordId: sentinel,
      revisionId: sentinel,
    },
  });
  const serialized = database.serialize();
  assert.equal(serialized.includes(sentinel), false);
  assert.notEqual(persistedRetrievalAttemptId(sentinel), sentinel);
  assert.equal(
    (await store.getAttempt(sentinel))?.attemptId,
    persistedRetrievalAttemptId(sentinel),
  );
});

test("direct repository writes reject raw or prefix-forged external identities without leakage", async (context) => {
  const { database, repository, clock } = await harness(context);
  const sentinel = "RepositoryBypassSecret_91ab.Valid";
  const rawAttempt = {
    attemptId: sentinel,
    provider: sentinel,
    recordId: sentinel,
    revisionId: sentinel,
    stagingId: "raw-repository-stage",
    startedAtMs: clock.nowMs(),
    recordedAtMs: clock.nowMs(),
    request: sanitizeRequestIdentity({
      method: "GET",
      origin: "https://example.test",
      path: "/repository-boundary",
      routeLabel: "fixture.repository-boundary",
    }),
  } as unknown as RetrievalAttempt;
  let message = "";
  assert.throws(
    () => repository.recordAttempt(rawAttempt, activeFence(database, clock)),
    (error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
      return /not derived at the vault boundary/u.test(message);
    },
  );
  assert.equal(message.includes(sentinel), false);
  assert.equal(database.serialize().includes(sentinel), false);
  assert.throws(
    () =>
      database
        .prepare(`INSERT INTO artifact_retrieval_attempts (
          attempt_id, staging_id, provider, provider_record_id, provider_revision_id,
          started_at_ms, recorded_at_ms, request_method, request_origin, request_path_hash,
          request_route_label, request_identity_hash, attempt_json, attempt_hash
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 'GET', 'https://example.test', ?, 'fixture', ?, '{}', ?)`)
        .run(
          `att1_${"a".repeat(64)}`,
          "forged-prefix-stage",
          `prv1_${"b".repeat(64)}`,
          `rec1_${"c".repeat(64)}`,
          `bad1_${"f".repeat(64)}`,
          "d".repeat(64),
          "e".repeat(64),
          "f".repeat(64),
        ),
    /constraint/u,
  );
});

test("exact redelivery returns the committed result without fabricating evidence", async (context) => {
  const { database, store } = await harness(context);
  const bytes = Buffer.from("redelivered entity");
  const first = await store.store(request("same-attempt", bytes));
  const replay = await store.store(request("same-attempt", bytes));
  assert.deepEqual(replay.artifact, first.artifact);
  assert.deepEqual(replay.observation, first.observation);
  assert.equal(replay.disposition, "deduplicated");
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_observations").get() as {
        count: bigint;
      }
    ).count,
    1n,
  );
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_retrieval_outcomes").get() as {
        count: bigint;
      }
    ).count,
    1n,
  );
});

test("exact redelivery verifies the joined terminal outcome before retry decisions", async (context) => {
  const { database, store } = await harness(context);
  const replay = request("forged-outcome-replay", Buffer.from("entity"));
  await store.store(replay);
  database.exec("DROP TRIGGER artifact_outcomes_no_update");
  database
    .prepare("UPDATE artifact_retrieval_outcomes SET outcome = 'failed' WHERE attempt_id = ?")
    .run(persistedRetrievalAttemptId("forged-outcome-replay"));
  await assert.rejects(() => store.store(replay), /outcome relational mismatch/u);
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_observations").get() as {
        count: bigint;
      }
    ).count,
    1n,
  );
});

test("attempt identity rejects metadata, content, and incomplete replay conflicts", async (context) => {
  const { database, repository, store, clock } = await harness(context);
  const original = request("conflict-attempt", Buffer.from("original"));
  await store.store(original);
  await assert.rejects(
    () => store.store({ ...request("conflict-attempt", Buffer.from("originaL")) }),
    /conflicts/u,
  );
  const changedMetadata = request("conflict-attempt", Buffer.from("original"));
  await assert.rejects(
    () =>
      store.store({ ...changedMetadata, attempt: { ...changedMetadata.attempt, revisionId: "2" } }),
    /conflicts/u,
  );
  repository.recordAttempt(
    createPersistedRetrievalAttempt(
      validateRetrievalAttempt(request("incomplete-attempt", Buffer.alloc(0)).attempt),
      "incomplete-stage",
      clock.nowMs(),
    ),
    activeFence(database, clock),
  );
  await assert.rejects(
    () => store.store(request("incomplete-attempt", Buffer.alloc(0))),
    /incomplete or terminal/u,
  );
});

test("rejects oversized streams with a terminal outcome and no artifact", async (context) => {
  const { database, store } = await harness(context, { maxArtifactBytes: 3 });
  await assert.rejects(() => store.store(request("oversized", Buffer.from("four"))), /byte limit/u);
  assert.equal(
    (database.prepare("SELECT count(*) count FROM artifact_blobs").get() as { count: bigint })
      .count,
    0n,
  );
  assert.equal(
    (
      database.prepare("SELECT outcome FROM artifact_retrieval_outcomes").get() as {
        outcome: string;
      }
    ).outcome,
    "failed",
  );
});

test("enforces the global vault quota independently of the artifact limit", async (context) => {
  const { database, store } = await harness(context, {
    maxArtifactBytes: 4,
    maxVaultBytes: 4,
  });
  await store.store(request("quota-one", Buffer.from("123")));
  await assert.rejects(() => store.store(request("quota-two", Buffer.from("45"))), /quota/u);
  assert.equal(
    (
      database
        .prepare("SELECT count(*) count FROM artifact_retrieval_outcomes WHERE outcome = 'failed'")
        .get() as { count: bigint }
    ).count,
    1n,
  );
});

test("a second writer process boundary is explicit", async (context) => {
  const { root, repository, clock } = await harness(context);
  await assert.rejects(
    () =>
      DurableArtifactStore.open({
        repository,
        clock,
        config: {
          runtimeRootMode: "ci-temporary",
          runtimeRoot: root,
          maxArtifactBytes: 1,
          maxVaultBytes: 1,
          maxConcurrentWrites: 1,
          streamHighWaterMarkBytes: 1,
          stageExpiryMs: 1,
          writerLeaseBehavior: "fail",
          writerLeaseWaitMs: 0,
          writerLeaseDurationMs: 30_000,
          writerLeaseRenewalMs: 10_000,
        },
      }),
    /lease/u,
  );
});

test("expired takeover fences a still-live stale writer before install and SQLite commit", async (context) => {
  const {
    root,
    repository,
    clock,
    database,
    store: stale,
  } = await harness(context, {
    writerLeaseDurationMs: 10,
    writerLeaseRenewalMs: 5,
  });
  let resume!: () => void;
  let staged!: () => void;
  const stagedPromise = new Promise<void>((resolve) => {
    staged = resolve;
  });
  const resumePromise = new Promise<void>((resolve) => {
    resume = resolve;
  });
  async function* paused(): AsyncGenerator<Buffer> {
    yield Buffer.from("stale");
    staged();
    await resumePromise;
  }
  const staleRequest = {
    ...request("stale-writer", Buffer.alloc(0)),
    entityBytes: Readable.from(paused()),
  };
  const pending = stale.store(staleRequest);
  await stagedPromise;
  clock.advanceBy(11);
  database
    .prepare(
      "UPDATE artifact_writer_fence SET generation = generation + 1, owner_token = 'live-takeover', expires_at_ms = ? WHERE singleton = 1",
    )
    .run(clock.nowMs() + 10);
  rmSync(join(root, "artifacts", "locks", "writer.lock"), { force: true });
  resume();
  await assert.rejects(() => pending, /lease was lost/u);
  assert.equal(
    (
      database
        .prepare("SELECT count(*) count FROM artifact_retrieval_outcomes WHERE attempt_id = ?")
        .get(persistedRetrievalAttemptId("stale-writer")) as { count: bigint }
    ).count,
    0n,
  );
  assert.equal(readdirSync(join(root, "artifacts", "staging")).length, 1);
  writeFileSync(join(root, "artifacts", "staging", "stale-reconcile.part"), "partial");
  writeFileSync(join(root, "artifacts", "snapshots", "stale-reconcile.verified"), "partial");
  const databaseBefore = database.serialize();
  const stagingBefore = readdirSync(join(root, "artifacts", "staging")).sort();
  const snapshotsBefore = readdirSync(join(root, "artifacts", "snapshots")).sort();
  const quarantineBefore = readdirSync(join(root, "artifacts", "quarantine")).sort();
  await assert.rejects(() => stale.reconcile(), /lease was lost/u);
  assert.deepEqual(database.serialize(), databaseBefore);
  assert.deepEqual(readdirSync(join(root, "artifacts", "staging")).sort(), stagingBefore);
  assert.deepEqual(readdirSync(join(root, "artifacts", "snapshots")).sort(), snapshotsBefore);
  assert.deepEqual(readdirSync(join(root, "artifacts", "quarantine")).sort(), quarantineBefore);
  database
    .prepare("UPDATE artifact_writer_fence SET expires_at_ms = ? WHERE singleton = 1")
    .run(clock.nowMs());
  const winner = await DurableArtifactStore.open({
    repository,
    clock,
    config: {
      runtimeRootMode: "ci-temporary",
      runtimeRoot: root,
      maxArtifactBytes: 1_024,
      maxVaultBytes: 4_096,
      maxConcurrentWrites: 1,
      streamHighWaterMarkBytes: 17,
      stageExpiryMs: 1_000,
      writerLeaseBehavior: "fail",
      writerLeaseWaitMs: 0,
      writerLeaseDurationMs: 10,
      writerLeaseRenewalMs: 5,
    },
  });
  context.after(() => winner.close());
  const staleDigest = createHash("sha256").update("stale").digest("hex");
  assert.equal(
    existsSync(
      join(
        root,
        "artifacts",
        "sha256",
        staleDigest.slice(0, 2),
        staleDigest.slice(2, 4),
        staleDigest,
      ),
    ),
    false,
  );
  assert.equal(
    (
      database
        .prepare("SELECT count(*) count FROM artifact_observations WHERE attempt_id = ?")
        .get(persistedRetrievalAttemptId("stale-writer")) as { count: bigint }
    ).count,
    0n,
  );
  const committed = await winner.store(request("winner", Buffer.from("winner")));
  assert.equal(committed.observation.attemptId, persistedRetrievalAttemptId("winner"));
});

test("transaction mutations evaluate lease expiry from a fresh clock reading", async (context) => {
  const { database, repository, clock } = await harness(context);
  const bytes = Buffer.from("paused-before-transaction");
  const raw = request("expired-before-commit", bytes);
  const draft = { ...raw, attempt: validateRetrievalAttempt(raw.attempt) };
  const fence = activeFence(database, clock);
  repository.recordAttempt(
    createPersistedRetrievalAttempt(draft.attempt, "expired-before-commit-stage", clock.nowMs()),
    fence,
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  const artifact = {
    digest,
    algorithm: "sha256" as const,
    sizeBytes: bytes.length,
    committedAtMs: clock.nowMs(),
    provenance: "retrieval" as const,
  };
  const observationWithoutHash = {
    observationId: deriveObservationId(draft.attempt, digest, draft.response),
    attemptId: draft.attempt.attemptId,
    artifactDigest: digest,
    provider: draft.attempt.provider,
    recordId: draft.attempt.recordId,
    revisionId: draft.attempt.revisionId,
    retrievedAtMs: clock.nowMs(),
    request: draft.attempt.request,
    response: draft.response,
  };
  const observation = {
    ...observationWithoutHash,
    observationHash: canonicalHash(
      "peas/artifact-observation/v1",
      observationWithoutHash as unknown as JsonValue,
    ),
  };
  clock.advanceBy(30_001);
  assert.throws(
    () => repository.commitSuccess(artifact, observation, draft.response, fence),
    /lease was lost/u,
  );
  assert.equal(
    (database.prepare("SELECT count(*) count FROM artifact_blobs").get() as { count: bigint })
      .count,
    0n,
  );
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_retrieval_outcomes").get() as {
        count: bigint;
      }
    ).count,
    0n,
  );
});

test("successful evidence commit is atomic when observation insertion aborts", async (context) => {
  const { database, store } = await harness(context);
  database.exec(`CREATE TRIGGER artifact_test_reject_observation
    BEFORE INSERT ON artifact_observations BEGIN SELECT RAISE(ABORT, 'synthetic observation failure'); END`);
  await assert.rejects(
    () => store.store(request("atomic-success", Buffer.from("atomic"))),
    /synthetic observation failure/u,
  );
  assert.equal(
    (database.prepare("SELECT count(*) count FROM artifact_blobs").get() as { count: bigint })
      .count,
    0n,
  );
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_observations").get() as {
        count: bigint;
      }
    ).count,
    0n,
  );
  const outcomes = database
    .prepare("SELECT outcome FROM artifact_retrieval_outcomes")
    .all() as Array<{ outcome: string }>;
  assert.deepEqual(outcomes, [{ outcome: "failed" }]);
});

test("a separate-process stale writer cannot append outcomes or mutate staging after takeover", async (context) => {
  const { root, databasePath } = processFixture(context, "takeover");
  const child = fork(artifactWorkerPath, [databasePath, root, "1800000000000"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  await waitForWorkerMessage(child, "staged");
  const database = openSqliteDatabase(databasePath, migrations);
  try {
    database
      .prepare(
        "UPDATE artifact_writer_fence SET generation = generation + 1, owner_token = 'parent-takeover', expires_at_ms = ? WHERE singleton = 1",
      )
      .run(1_800_000_030_000);
    rmSync(join(root, "artifacts", "locks", "writer.lock"), { force: true });
    const stagingBefore = readdirSync(join(root, "artifacts", "staging")).sort();
    child.send({ type: "resume" });
    const result = await waitForWorkerMessage(child, "result");
    assert.equal(result["status"], "rejected");
    assert.match(String(result["message"]), /lease was lost/u);
    assert.equal(
      (
        database
          .prepare("SELECT count(*) count FROM artifact_retrieval_outcomes WHERE attempt_id = ?")
          .get(persistedRetrievalAttemptId("cross-process-stale")) as { count: bigint }
      ).count,
      0n,
    );
    assert.deepEqual(readdirSync(join(root, "artifacts", "staging")).sort(), stagingBefore);
  } finally {
    database.close();
    child.send({ type: "close" });
    await waitForWorkerExit(child);
  }
});

test("hard-killed staged writer leaves only recoverable evidence for fenced reconciliation", async (context) => {
  const { root, databasePath } = processFixture(context, "hard-kill");
  const child = fork(artifactWorkerPath, [databasePath, root, "1800000000000"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  await waitForWorkerMessage(child, "staged");
  child.kill("SIGKILL");
  await waitForWorkerExit(child);
  const database = openSqliteDatabase(databasePath, migrations);
  const repository = new SqliteArtifactRepository(database);
  const clock = new ManualClock(1_800_000_030_001);
  const recovered = await DurableArtifactStore.open({
    repository,
    clock,
    config: vaultConfig(root),
  });
  try {
    assert.equal(
      (
        database.prepare("SELECT count(*) count FROM artifact_retrieval_outcomes").get() as {
          count: bigint;
        }
      ).count,
      0n,
    );
    assert.equal(readdirSync(join(root, "artifacts", "staging")).length, 1);
    const report = await recovered.reconcile();
    assert.equal(report.expiredStages, 1);
    assert.equal(
      (
        database
          .prepare("SELECT outcome FROM artifact_retrieval_outcomes WHERE attempt_id = ?")
          .get(persistedRetrievalAttemptId("cross-process-stale")) as { outcome: string }
      ).outcome,
      "expired",
    );
  } finally {
    await recovered.close();
    database.close();
  }
});

test("hard kill after install intent converges from durable intent without fabricated evidence", async (context) => {
  const { root, databasePath } = processFixture(context, "install-intent-kill");
  const child = fork(
    artifactWorkerPath,
    [databasePath, root, "1800000000000", "install-intent-commit"],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  await waitForWorkerMessage(child, "staged");
  child.send({ type: "resume" });
  const checkpoint = await waitForWorkerMessage(child, "checkpoint");
  assert.equal(checkpoint["checkpoint"], "install-intent-commit");
  child.kill("SIGKILL");
  await waitForWorkerExit(child);

  const database = openSqliteDatabase(databasePath, migrations);
  const recovered = await DurableArtifactStore.open({
    repository: new SqliteArtifactRepository(database),
    clock: new ManualClock(1_800_000_030_001),
    config: vaultConfig(root),
  });
  try {
    const report = await recovered.reconcile();
    assert.equal(report.continuationCursor, null);
    for (const table of [
      "artifact_install_intents",
      "artifact_blobs",
      "artifact_retrieval_outcomes",
      "artifact_observations",
    ])
      assert.equal(
        (database.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: bigint }).count,
        1n,
      );
    assert.equal(
      (
        database
          .prepare(
            "SELECT count(*) count FROM artifact_install_transitions WHERE state = 'evidence-committed'",
          )
          .get() as { count: bigint }
      ).count,
      1n,
    );
  } finally {
    await recovered.close();
    database.close();
  }
});

test("store and lease hard-kill boundary matrix converges with exact evidence", {
  skip:
    process.env["PEAS_SKIP_HARD_KILL_MATRIX"] === "1"
      ? "runs as a separate non-instrumented process-kill gate"
      : false,
}, async (context) => {
  const boundaries = [
    "lease-file-installation",
    "lease-sqlite-claim",
    "lease-record-sync",
    "vault-directory-created:root",
    "vault-directory-created:content",
    "vault-directory-created:staging",
    "vault-directory-created:snapshots",
    "vault-directory-created:quarantine",
    "vault-directory-created:locks",
    "lease-sqlite-renewal",
    "lease-file-renewal",
    "attempt-commit",
    "stage-create",
    "stage-sync-close",
    "install-intent-commit",
    "content-link",
    "content-sync",
    "content-installed-transition",
    "success-intent-transaction",
    "stage-removal",
    "stage-cleaned-transition",
    "failure-abort-transaction",
  ].filter(
    (boundary) =>
      process.env["PEAS_TEST_BOUNDARY"] === undefined ||
      process.env["PEAS_TEST_BOUNDARY"] === boundary,
  );
  const afterStageSync = new Set<string>([
    "stage-sync-close",
    "install-intent-commit",
    "content-link",
    "content-sync",
    "content-installed-transition",
    "success-intent-transaction",
    "stage-removal",
    "stage-cleaned-transition",
    "failure-abort-transaction",
  ]);
  const successful = new Set<string>([
    "install-intent-commit",
    "content-link",
    "content-sync",
    "content-installed-transition",
    "success-intent-transaction",
    "stage-removal",
    "stage-cleaned-transition",
  ]);
  const intentPrepared = new Set<string>([...successful, "failure-abort-transaction"]);

  for (const boundary of boundaries) {
    const fixture = processFixture(context, `store-boundary-${boundary.replaceAll(":", "-")}`);
    const child = fork(
      artifactWorkerPath,
      [fixture.databasePath, fixture.root, "1800000000000", boundary],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    if (afterStageSync.has(boundary)) {
      await waitForWorkerMessage(child, "staged");
      child.send({ type: "resume" });
    }
    const checkpoint = await waitForWorkerMessage(child, "checkpoint");
    assert.equal(checkpoint["checkpoint"], boundary);
    child.kill("SIGKILL");
    await waitForWorkerExit(child);

    const database = openSqliteDatabase(fixture.databasePath, migrations);
    const recovered = await DurableArtifactStore.open({
      repository: new SqliteArtifactRepository(database),
      clock: new ManualClock(1_800_000_030_001),
      config: vaultConfig(fixture.root),
    });
    try {
      await recovered.reconcile();
      const count = (table: string): bigint =>
        (database.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: bigint }).count;
      assert.equal(count("artifact_observations"), successful.has(boundary) ? 1n : 0n, boundary);
      assert.equal(count("artifact_blobs"), successful.has(boundary) ? 1n : 0n, boundary);
      assert.equal(
        count("artifact_install_intents"),
        intentPrepared.has(boundary) ? 1n : 0n,
        boundary,
      );
      await recovered.close();
      const secondRestart = await DurableArtifactStore.open({
        repository: new SqliteArtifactRepository(database),
        clock: new ManualClock(1_800_000_060_002),
        config: vaultConfig(fixture.root),
      });
      try {
        assert.equal((await secondRestart.reconcile()).continuationCursor, null);
      } finally {
        await secondRestart.close();
      }
    } finally {
      await recovered.close();
      database.close();
    }
  }
});

test("reconciliation hard-kill boundary matrix replays one deterministic action", {
  skip:
    process.env["PEAS_SKIP_HARD_KILL_MATRIX"] === "1"
      ? "runs as a separate non-instrumented process-kill gate"
      : false,
}, async (context) => {
  const boundaries = [
    "reconciliation-call-opened",
    "reconciliation-action-plan-commit",
    "quarantine-link",
    "quarantine-sync",
    "quarantine-source-removal",
    "reconciliation-action-application-commit",
    "reconciliation-call-receipt-commit",
    "reconciliation-terminal-receipt-commit",
  ].filter(
    (boundary) =>
      process.env["PEAS_TEST_BOUNDARY"] === undefined ||
      process.env["PEAS_TEST_BOUNDARY"] === boundary,
  );
  for (const boundary of boundaries) {
    const fixture = processFixture(context, `reconcile-boundary-${boundary}`);
    const seedDatabase = openSqliteDatabase(fixture.databasePath, migrations);
    const seedStore = await DurableArtifactStore.open({
      repository: new SqliteArtifactRepository(seedDatabase),
      clock: new ManualClock(1_800_000_000_000),
      config: vaultConfig(fixture.root),
    });
    await seedStore.close();
    seedDatabase.close();
    writeFileSync(join(fixture.root, "artifacts", "staging", "hard-kill-orphan.part"), "orphan");

    const child = fork(
      reconciliationWorkerPath,
      [fixture.databasePath, fixture.root, "1800000030001", boundary],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    await waitForWorkerMessage(child, "ready");
    child.send({
      type: "reconcile",
      cursor: null,
      maxItems: boundary === "reconciliation-call-receipt-commit" ? 1 : 1_000,
      maxBytes: 1_048_576,
    });
    const checkpoint = await waitForWorkerMessage(child, "checkpoint");
    assert.equal(checkpoint["checkpoint"], boundary);
    child.kill("SIGKILL");
    await waitForWorkerExit(child);

    const database = openSqliteDatabase(fixture.databasePath, migrations);
    const recovered = await DurableArtifactStore.open({
      repository: new SqliteArtifactRepository(database),
      clock: new ManualClock(1_800_000_060_002),
      config: vaultConfig(fixture.root),
    });
    try {
      await recovered.reconcile();
      for (const table of [
        "artifact_reconciliation_action_plans",
        "artifact_reconciliation_action_applications",
        "artifact_integrity_incidents",
        "artifact_quarantine_receipts",
      ])
        assert.equal(
          (database.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: bigint })
            .count,
          1n,
          `${boundary}:${table}`,
        );
      assert.equal(readdirSync(join(fixture.root, "artifacts", "quarantine")).length, 1);
      assert.equal(readdirSync(join(fixture.root, "artifacts", "staging")).length, 0);
      await recovered.close();
      const secondRestart = await DurableArtifactStore.open({
        repository: new SqliteArtifactRepository(database),
        clock: new ManualClock(1_800_000_090_003),
        config: vaultConfig(fixture.root),
      });
      try {
        assert.equal((await secondRestart.reconcile()).continuationCursor, null);
      } finally {
        await secondRestart.close();
      }
    } finally {
      await recovered.close();
      database.close();
    }
  }
});

test("verified-read hard-kill boundaries leave only recoverable snapshots", {
  skip:
    process.env["PEAS_SKIP_HARD_KILL_MATRIX"] === "1"
      ? "runs as a separate non-instrumented process-kill gate"
      : false,
}, async (context) => {
  for (const boundary of [
    "snapshot-create",
    "snapshot-sync",
    "snapshot-verification-complete",
    "snapshot-removal",
  ]) {
    const fixture = processFixture(context, `read-boundary-${boundary}`);
    const database = openSqliteDatabase(fixture.databasePath, migrations);
    const seed = await DurableArtifactStore.open({
      repository: new SqliteArtifactRepository(database),
      clock: new ManualClock(1_800_000_000_000),
      config: vaultConfig(fixture.root),
    });
    const stored = await seed.store(request(`read-${boundary}`, Buffer.from("verified read")));
    await seed.close();
    database.close();
    if (boundary === "snapshot-removal") {
      const content = join(
        fixture.root,
        "artifacts",
        "sha256",
        stored.artifact.digest.slice(0, 2),
        stored.artifact.digest.slice(2, 4),
        stored.artifact.digest,
      );
      writeFileSync(content, "corrupt read");
    }

    const child = fork(
      artifactReadWorkerPath,
      [fixture.databasePath, fixture.root, "1800000030001", stored.artifact.digest, boundary],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    await waitForWorkerMessage(child, "ready");
    const checkpoint = await waitForWorkerMessage(child, "checkpoint");
    assert.equal(checkpoint["checkpoint"], boundary);
    child.kill("SIGKILL");
    await waitForWorkerExit(child);

    const recoveredDatabase = openSqliteDatabase(fixture.databasePath, migrations);
    const recovered = await DurableArtifactStore.open({
      repository: new SqliteArtifactRepository(recoveredDatabase),
      clock: new ManualClock(1_800_000_060_002),
      config: vaultConfig(fixture.root),
    });
    try {
      await recovered.reconcile();
      assert.deepEqual(readdirSync(join(fixture.root, "artifacts", "snapshots")), []);
      await recovered.close();
      const secondRestart = await DurableArtifactStore.open({
        repository: new SqliteArtifactRepository(recoveredDatabase),
        clock: new ManualClock(1_800_000_090_003),
        config: vaultConfig(fixture.root),
      });
      try {
        assert.equal((await secondRestart.reconcile()).continuationCursor, null);
      } finally {
        await secondRestart.close();
      }
    } finally {
      await recovered.close();
      recoveredDatabase.close();
    }
  }
});

test("hard kill after cursor advancement resumes from the durable generation", async (context) => {
  const { root, databasePath } = processFixture(context, "cursor-kill");
  const child = fork(reconciliationWorkerPath, [databasePath, root, "1800000000000"], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  await waitForWorkerMessage(child, "ready");
  child.send({ type: "reconcile", cursor: null });
  const result = await waitForWorkerMessage(child, "result");
  const cursor = String(result["cursor"]);
  assert.match(cursor, /^rc1_[0-9a-f]{64}$/u);
  child.kill("SIGKILL");
  await waitForWorkerExit(child);

  const database = openSqliteDatabase(databasePath, migrations);
  const before = database.prepare("SELECT generation FROM artifact_reconciliation_state").get() as {
    generation: bigint;
  };
  const clock = new ManualClock(1_800_000_030_001);
  const recovered = await DurableArtifactStore.open({
    repository: new SqliteArtifactRepository(database),
    clock,
    config: vaultConfig(root),
  });
  try {
    const resumed = await recovered.reconcile({
      cursor: null,
      maxItems: 1,
      maxElapsedMs: 10_000,
      maxBytes: 1_024,
    });
    assert.notEqual(resumed.continuationCursor, cursor);
    const after = database
      .prepare("SELECT generation FROM artifact_reconciliation_state")
      .get() as {
      generation: bigint;
    };
    assert.ok(after.generation > before.generation);
  } finally {
    await recovered.close();
    database.close();
  }
});

test("reconciliation adopts valid orphans without fabricating observations", async (context) => {
  const { root, database, store } = await harness(context);
  const bytes = Buffer.from("recovered entity");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const path = join(root, "artifacts", "sha256", digest.slice(0, 2), digest.slice(2, 4), digest);
  const directory = join(root, "artifacts", "sha256", digest.slice(0, 2), digest.slice(2, 4));
  const { mkdirSync } = await import("node:fs");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, bytes);

  const report = await store.reconcile();
  assert.equal(report.adoptedOrphans, 1);
  assert.equal((await store.stat(digest))?.provenance, "recovered-orphan");
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_observations").get() as {
        count: bigint;
      }
    ).count,
    0n,
  );
});

test("invalid orphans are quarantined without false artifact metadata", async (context) => {
  const { root, database, store } = await harness(context);
  const claimed = "a".repeat(64);
  const directory = join(root, "artifacts", "sha256", "aa", "aa");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, claimed), "wrong bytes");

  const report = await store.reconcile();
  assert.equal(report.quarantinedObjects, 1);
  assert.equal(
    (database.prepare("SELECT count(*) count FROM artifact_blobs").get() as { count: bigint })
      .count,
    0n,
  );
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_integrity_incidents").get() as {
        count: bigint;
      }
    ).count,
    1n,
  );
  assert.equal(existsSync(join(directory, claimed)), false);
  for (const table of [
    "artifact_reconciliation_action_plans",
    "artifact_reconciliation_action_applications",
    "artifact_quarantine_receipts",
  ])
    assert.equal(
      (database.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: bigint }).count,
      1n,
    );
  assert.match(
    readdirSync(join(root, "artifacts", "quarantine"))[0] ?? "",
    /^q1_[0-9a-f]{64}\.quarantined$/u,
  );
});

test("terminal reconciliation is recoverable and a new run is explicit", async (context) => {
  const { store } = await harness(context);
  const terminal = await store.reconcile();
  assert.equal(terminal.continuationCursor, null);
  assert.match(terminal.runId, /^rr1_[0-9a-f]{64}$/u);
  assert.deepEqual(await store.reconcile(), terminal);

  const next = await store.reconcile({
    startNew: true,
    completedRunId: terminal.runId,
    maxItems: 1,
    maxElapsedMs: 10_000,
    maxBytes: 1_024,
  });
  assert.notEqual(next.runId, terminal.runId);
  assert.match(next.continuationCursor ?? "", /^rc1_[0-9a-f]{64}$/u);
  await assert.rejects(
    () => store.reconcile({ maxItems: 1, maxElapsedMs: 10_000, maxBytes: 1_024 }),
    /requires its continuation cursor/u,
  );
});

test("same-clock incidents and quarantine objects remain distinct", async (context) => {
  const { root, database, store } = await harness(context);
  const directory = join(root, "artifacts", "staging");
  writeFileSync(join(directory, "collision-one.part"), "one");
  writeFileSync(join(directory, "collision-two.part"), "two");
  const report = await store.reconcile();
  assert.equal(new Set(report.incidents).size, 2);
  assert.equal(readdirSync(join(root, "artifacts", "quarantine")).length, 2);
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_integrity_incidents").get() as {
        count: bigint;
      }
    ).count,
    2n,
  );
});

test("canonical evidence reads fail closed on relational-only forgery", async (context) => {
  const { database, store } = await harness(context);
  const stored = await store.store(request("forgery-attempt", Buffer.from("entity")));
  database.exec(
    "DROP TRIGGER artifact_attempts_no_update; DROP TRIGGER artifact_observations_no_update; DROP TRIGGER artifact_blobs_no_update;",
  );
  database.pragma("ignore_check_constraints = ON");
  const originalProvider = (
    database.prepare("SELECT provider FROM artifact_retrieval_attempts").get() as {
      provider: string;
    }
  ).provider;
  database.prepare("UPDATE artifact_retrieval_attempts SET provider = 'forged'").run();
  await assert.rejects(() => store.getAttempt("forgery-attempt"), /relational mismatch/u);
  database.prepare("UPDATE artifact_retrieval_attempts SET provider = ?").run(originalProvider);
  database.prepare("UPDATE artifact_observations SET etag = 'forged'").run();
  await assert.rejects(
    () => store.getObservation(stored.observation.observationId),
    /relational mismatch/u,
  );
  database.prepare("UPDATE artifact_observations SET etag = '\"fixture\"'").run();
  database.prepare("UPDATE artifact_blobs SET size_bytes = size_bytes + 1").run();
  await assert.rejects(() => store.stat(stored.artifact.digest), /relational mismatch/u);
  await assert.rejects(() => store.reconcile(), /relational mismatch/u);
});

test("tampered and missing committed content fails before consumer bytes", async (context) => {
  const { root, database, store } = await harness(context);
  const stored = await store.store(request("tampered-read", Buffer.from("original")));
  const path = join(
    root,
    "artifacts",
    "sha256",
    stored.artifact.digest.slice(0, 2),
    stored.artifact.digest.slice(2, 4),
    stored.artifact.digest,
  );
  writeFileSync(path, "modified");
  await assert.rejects(() => store.read(stored.artifact.digest), /verification/u);
  assert.equal(existsSync(path), false);
  assert.equal(
    (
      database.prepare("SELECT count(*) count FROM artifact_integrity_incidents").get() as {
        count: bigint;
      }
    ).count,
    1n,
  );

  const missing = await store.store(request("missing-read", Buffer.from("another")));
  const missingPath = join(
    root,
    "artifacts",
    "sha256",
    missing.artifact.digest.slice(0, 2),
    missing.artifact.digest.slice(2, 4),
    missing.artifact.digest,
  );
  rmSync(missingPath);
  await assert.rejects(() => store.read(missing.artifact.digest), /missing/u);
  const report = await store.reconcile();
  assert.equal(report.missingArtifacts >= 1, true);
});

test("oversized corrupt reads stop after one bounded chunk", async (context) => {
  const { root, store } = await harness(context, { streamHighWaterMarkBytes: 8 });
  const stored = await store.store(request("bounded-read", Buffer.from("tiny")));
  const path = join(
    root,
    "artifacts",
    "sha256",
    stored.artifact.digest.slice(0, 2),
    stored.artifact.digest.slice(2, 4),
    stored.artifact.digest,
  );
  writeFileSync(path, Buffer.alloc(1_024 * 1_024, 7));
  await assert.rejects(() => store.read(stored.artifact.digest), /exceeded committed size/u);
  assert.deepEqual(readdirSync(join(root, "artifacts", "snapshots")), []);
  const quarantined = readdirSync(join(root, "artifacts", "quarantine"));
  assert.equal(quarantined.length, 1);
});

test("reconciliation expires attempts and quarantines unowned stages", async (context) => {
  const { root, repository, clock, database, store } = await harness(context);
  const requestIdentity = sanitizeRequestIdentity({
    method: "GET",
    origin: "https://example.test",
    path: "/stage",
    routeLabel: "fixture.stage",
  });
  repository.recordAttempt(
    createPersistedRetrievalAttempt(
      validateRetrievalAttempt({
        attemptId: "expired-attempt",
        provider: "fixture",
        recordId: "record",
        revisionId: "1",
        startedAtMs: clock.nowMs(),
        request: requestIdentity,
      }),
      "expired-stage",
      clock.nowMs(),
    ),
    activeFence(database, clock),
  );
  writeFileSync(join(root, "artifacts", "staging", "expired-stage.part"), "partial");
  writeFileSync(join(root, "artifacts", "staging", "unowned.part"), "partial");
  writeFileSync(join(root, "artifacts", "snapshots", "abandoned.verified"), "partial");
  clock.advanceBy(1_000);

  const report = await store.reconcile();
  repository.finishAttempt(
    {
      attemptId: persistedRetrievalAttemptId("expired-attempt"),
      outcome: "expired",
      completedAtMs: clock.nowMs() + 1,
      reasonCode: "stage-expired",
      detailHash: null,
    },
    activeFence(database, clock),
  );
  assert.equal(report.expiredStages, 1);
  assert.equal(report.quarantinedObjects, 2);
  assert.equal(
    (
      database
        .prepare("SELECT outcome FROM artifact_retrieval_outcomes WHERE attempt_id = ?")
        .get(persistedRetrievalAttemptId("expired-attempt")) as { outcome: string }
    ).outcome,
    "expired",
  );
  assert.equal(
    (
      database
        .prepare("SELECT count(*) count FROM artifact_retrieval_outcomes WHERE attempt_id = ?")
        .get(persistedRetrievalAttemptId("expired-attempt")) as { count: bigint }
    ).count,
    1n,
  );
  assert.deepEqual(readdirSync(join(root, "artifacts", "snapshots")), []);
});

test("reconciliation obeys item budgets and converges across restart cursors", async (context) => {
  const { root, store } = await harness(context);
  for (let index = 0; index < 7; index += 1)
    writeFileSync(join(root, "artifacts", "staging", `budget-${index}.part`), "partial");
  let calls = 0;
  let report: ReconciliationReport;
  let cursor: string | null = null;
  do {
    report = await store.reconcile({ cursor, maxItems: 2, maxElapsedMs: 10_000 });
    cursor = report.continuationCursor;
    calls += 1;
    assert.equal(calls < 30, true);
  } while (report.continuationCursor !== null);
  assert.equal(calls >= 4, true);
  assert.deepEqual(readdirSync(join(root, "artifacts", "staging")), []);
});

test("one-item reconciliation bounds database rows, bytes, elapsed time, and memory", async (context) => {
  const { database, repository, clock, store } = await harness(context);
  const fence = activeFence(database, clock);
  for (let index = 0; index < 100; index += 1) {
    repository.recordAttempt(
      createPersistedRetrievalAttempt(
        validateRetrievalAttempt(request(`bounded-row-${index}`, Buffer.alloc(0)).attempt),
        `bounded-row-stage-${index}`,
        clock.nowMs(),
      ),
      fence,
    );
  }
  const heapBefore = process.memoryUsage().heapUsed;
  const first = await store.reconcile({ maxItems: 1, maxElapsedMs: 10_000, maxBytes: 1_024 });
  const heapDelta = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  assert.equal(first.rowsVisited, 1);
  assert.equal(first.directoryEntriesRead, 0);
  assert.equal(first.bytesHashed, 0);
  assert.equal(first.continuationCursor === null, false);
  assert.equal(
    (
      database
        .prepare("SELECT items_processed FROM artifact_reconciliation_state WHERE singleton = 1")
        .get() as { items_processed: bigint }
    ).items_processed,
    1n,
  );
  assert.equal(first.elapsedMs < 1_000, true);
  assert.equal(heapDelta < 16 * 1_024 * 1_024, true);
  const timed = await store.reconcile({
    cursor: first.continuationCursor,
    maxItems: 1,
    maxElapsedMs: 1,
    maxBytes: 1_024,
  });
  assert.equal(timed.rowsVisited <= 1, true);
  assert.equal(timed.elapsedMs < 1_000, true);
});

test("one-item directory reconciliation has a fixed enumeration bound", async (context) => {
  const { root, store } = await harness(context);
  const toStaging = await store.reconcile({ maxItems: 7, maxElapsedMs: 10_000, maxBytes: 7_168 });
  assert.ok(toStaging.continuationCursor);
  for (let index = 0; index < 50; index += 1)
    writeFileSync(join(root, "artifacts", "staging", `bounded-dir-${index}.part`), "x");
  const directoryPage = await store.reconcile({
    cursor: toStaging.continuationCursor,
    maxItems: 1,
    maxElapsedMs: 10_000,
    maxBytes: 1_024,
  });
  assert.equal(directoryPage.directoryEntriesRead, 50);
  assert.equal(directoryPage.quarantinedObjects, 0);
  const applied = await store.reconcile({
    cursor: directoryPage.continuationCursor,
    maxItems: 1,
    maxElapsedMs: 10_000,
    maxBytes: 1_024,
  });
  assert.equal(applied.quarantinedObjects, 1);
});

test("reconciliation rejects stale, tampered, and generation-mismatched cursors", async (context) => {
  const { database, repository, clock, store } = await harness(context);
  const first = await store.reconcile({ maxItems: 1, maxElapsedMs: 10_000, maxBytes: 1_024 });
  assert.ok(first.continuationCursor);
  const tampered = `${first.continuationCursor.slice(0, -1)}${first.continuationCursor.endsWith("0") ? "1" : "0"}`;
  await assert.rejects(
    () => store.reconcile({ cursor: tampered, maxItems: 1, maxElapsedMs: 10_000, maxBytes: 1_024 }),
    /cursor is stale or invalid/u,
  );
  const second = await store.reconcile({
    cursor: first.continuationCursor,
    maxItems: 1,
    maxElapsedMs: 10_000,
    maxBytes: 1_024,
  });
  const retried = await store.reconcile({
    cursor: first.continuationCursor,
    maxItems: 1,
    maxElapsedMs: 10_000,
    maxBytes: 1_024,
  });
  assert.deepEqual(retried, second);
  database.pragma("ignore_check_constraints = ON");
  database.prepare("UPDATE artifact_reconciliation_state SET generation = generation + 1").run();
  await assert.rejects(
    () =>
      store.reconcile({
        cursor: second.continuationCursor,
        maxItems: 1,
        maxElapsedMs: 10_000,
        maxBytes: 1_024,
      }),
    /relational mismatch/u,
  );

  database.prepare("UPDATE artifact_reconciliation_state SET generation = generation - 1").run();
  const row = database.prepare("SELECT * FROM artifact_reconciliation_state").get() as {
    generation: bigint;
    phase: ReconciliationPhase;
    shard: bigint;
    after_key: string;
    cursor_token: string;
  };
  const forged = {
    generation: Number(row.generation) - 1,
    phase: row.phase,
    shard: Number(row.shard),
    afterKey: row.after_key,
    cursorToken: row.cursor_token,
  } satisfies PersistedReconciliationState;
  assert.throws(
    () =>
      repository.advanceReconciliationState(
        forged,
        { phase: forged.phase, shard: forged.shard, afterKey: forged.afterKey },
        activeFence(database, clock),
      ),
    /generation was lost/u,
  );
});

test("failed filesystem handling never advances the durable reconciliation cursor", async (context) => {
  const { root, database, store } = await harness(context);
  const toStaging = await store.reconcile({ maxItems: 7, maxElapsedMs: 10_000, maxBytes: 7_168 });
  assert.ok(toStaging.continuationCursor);
  writeFileSync(join(root, "artifacts", "staging", "cursor-action-failure.part"), "partial");
  const quarantine = join(root, "artifacts", "quarantine");
  const replacement = join(root, "replacement-quarantine");
  mkdirSync(replacement);
  rmSync(quarantine, { recursive: true });
  symlinkSync(replacement, quarantine, process.platform === "win32" ? "junction" : "dir");
  const planned = await store.reconcile({
    cursor: toStaging.continuationCursor,
    maxItems: 1,
    maxElapsedMs: 10_000,
    maxBytes: 1_024,
  });
  await assert.rejects(
    () =>
      store.reconcile({
        cursor: planned.continuationCursor,
        maxItems: 1,
        maxElapsedMs: 10_000,
        maxBytes: 1_024,
      }),
    /trusted same-volume directory/u,
  );
  const state = database
    .prepare(
      "SELECT cursor_token, after_key, pending_action_key FROM artifact_reconciliation_state",
    )
    .get() as {
    cursor_token: string;
    after_key: string;
    pending_action_key: string | null;
  };
  assert.equal(state.cursor_token, planned.continuationCursor);
  assert.equal(state.after_key, "");
  assert.match(state.pending_action_key ?? "", /^act1_[0-9a-f]{64}$/u);
});

test("reconciliation fails closed on directory replacement and fanout overflow without cursor advance", async (context) => {
  const { root, database, store } = await harness(context);
  const toStaging = await store.reconcile({ maxItems: 7, maxElapsedMs: 10_000, maxBytes: 7_168 });
  assert.ok(toStaging.continuationCursor);
  const staging = join(root, "artifacts", "staging");
  const replacement = join(root, "replacement-staging");
  mkdirSync(replacement);
  rmSync(staging, { recursive: true });
  symlinkSync(replacement, staging, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    () =>
      store.reconcile({
        cursor: toStaging.continuationCursor,
        maxItems: 1,
        maxElapsedMs: 10_000,
        maxBytes: 1_024,
      }),
    /trusted same-volume directory/u,
  );
  const unchanged = database
    .prepare("SELECT cursor_token FROM artifact_reconciliation_state")
    .get() as { cursor_token: string };
  assert.equal(unchanged.cursor_token, toStaging.continuationCursor);

  rmSync(staging);
  mkdirSync(staging);
  for (let index = 0; index <= 256; index += 1)
    writeFileSync(join(staging, `overflow-${index}.part`), "x");
  await assert.rejects(
    () =>
      store.reconcile({
        cursor: toStaging.continuationCursor,
        maxItems: 1,
        maxElapsedMs: 10_000,
        maxBytes: 1_024,
      }),
    /fanout/u,
  );
  assert.equal(readdirSync(staging).length, 257);
  const stillUnchanged = database
    .prepare("SELECT cursor_token FROM artifact_reconciliation_state")
    .get() as { cursor_token: string };
  assert.equal(stillUnchanged.cursor_token, toStaging.continuationCursor);
});

test("immutable artifact evidence rejects updates and deletes", async (context) => {
  const { root, database, store } = await harness(context);
  await store.store(request("immutable", Buffer.from("entity")));
  writeFileSync(join(root, "artifacts", "staging", "immutable-incident.part"), "partial");
  await store.reconcile();
  for (const table of [
    "artifact_retrieval_attempts",
    "artifact_retrieval_outcomes",
    "artifact_blobs",
    "artifact_observations",
    "artifact_integrity_incidents",
  ]) {
    assert.throws(() => database.prepare(`DELETE FROM ${table}`).run(), /immutable/u);
    assert.throws(() => database.prepare(`UPDATE ${table} SET rowid = rowid`).run(), /immutable/u);
  }
});

test("runtime roots require explicit local absolute configuration", () => {
  assert.equal(
    configuredPeasRuntimeRoot("win32", { PEAS_RUNTIME_ROOT: "G:\\PEAS_RUNTIME\\peas-engine" }),
    "G:\\PEAS_RUNTIME\\peas-engine",
  );
  assert.equal(
    configuredPeasRuntimeRoot("linux", { PEAS_RUNTIME_ROOT: "/srv/peas-engine" }),
    "/srv/peas-engine",
  );
  assert.throws(() => configuredPeasRuntimeRoot("win32", {}), /PEAS_RUNTIME_ROOT/u);
  assert.throws(
    () => configuredPeasRuntimeRoot("win32", { PEAS_RUNTIME_ROOT: "\\\\server\\share" }),
    /local drive path/u,
  );
  assert.throws(
    () => configuredPeasRuntimeRoot("linux", { PEAS_RUNTIME_ROOT: "relative/path" }),
    /absolute/u,
  );
  assert.throws(
    () => configuredPeasRuntimeRoot("darwin", { PEAS_RUNTIME_ROOT: "/srv/peas-engine" }),
    /unsupported/u,
  );
  const layout = artifactRuntimePaths(rootForCurrentPlatform());
  assert.equal(layout.databasePath, join(layout.runtimeRoot, "sqlite", "peas.sqlite"));
  for (const path of [
    layout.databasePath,
    layout.artifactsRoot,
    layout.content,
    layout.staging,
    layout.snapshots,
    layout.quarantine,
    layout.locks,
  ]) {
    assert.equal(
      path.startsWith(`${layout.runtimeRoot}${process.platform === "win32" ? "\\" : "/"}`),
      true,
    );
  }
  assert.throws(
    () =>
      sanitizeRequestIdentity({
        method: "GET",
        origin: "https://user:secret@example.test/path",
        path: "/",
        routeLabel: "fixture",
      }),
    /origin/u,
  );
  assert.throws(() => assertSafeByteAddition(Number.MAX_SAFE_INTEGER, 1), /overflow/u);
});

function rootForCurrentPlatform(): string {
  return process.platform === "win32"
    ? "C:\\synthetic-peas-runtime"
    : "/tmp/synthetic-peas-runtime";
}

test("vault refuses a SQLite database outside its configured runtime root", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "peas-artifact-layout-"));
  const database = openSqliteDatabase(join(root, "outside.sqlite"), migrations);
  context.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  await assert.rejects(
    () =>
      DurableArtifactStore.open({
        repository: new SqliteArtifactRepository(database),
        clock: new ManualClock(1_800_000_000_000),
        config: vaultConfig(join(root, "runtime")),
      }),
    /SQLite database, WAL, and artifact vault must share/u,
  );
});

test("real platform ancestor links cannot redirect staging outside the vault", async (context) => {
  const { root, store } = await harness(context);
  const staging = join(root, "artifacts", "staging");
  const escapeTarget = join(root, "escape-target");
  mkdirSync(escapeTarget);
  rmSync(staging, { recursive: true });
  try {
    symlinkSync(escapeTarget, staging, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    assert.fail(
      `platform runner cannot create required ${process.platform === "win32" ? "junction" : "symlink"}: ${String(error)}`,
    );
  }
  await assert.rejects(
    () => store.store(request("link-escape", Buffer.from("entity"))),
    /unsafe|trusted/u,
  );
  assert.deepEqual(readdirSync(escapeTarget), []);
});

test("hard links from outside the trusted tree never become readable artifact content", async (context) => {
  const { root, store } = await harness(context);
  const result = await store.store(request("hard-link-content", Buffer.from("owned bytes")));
  const content = join(
    root,
    "artifacts",
    "sha256",
    result.artifact.digest.slice(0, 2),
    result.artifact.digest.slice(2, 4),
    result.artifact.digest,
  );
  const outside = join(root, "outside-hard-link");
  const { linkSync } = await import("node:fs");
  linkSync(content, outside);
  await assert.rejects(() => store.read(result.artifact.digest), /single-owner regular file/u);
  assert.equal(existsSync(outside), true);
});

test("junctions or symlinks above existing and missing runtime roots fail before target mutation", async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), "peas-artifact-ancestor-"));
  context.after(() => {
    const prefix = join(tmpdir(), "peas-artifact-ancestor-");
    if (!fixture.startsWith(prefix)) throw new Error("Unsafe ancestor test cleanup path");
    rmSync(fixture, { recursive: true, force: true });
  });
  for (const exists of [true, false]) {
    for (const depth of [0, 1, 2]) {
      const name = `${exists ? "existing" : "missing"}-${depth}`;
      const target = join(fixture, `${name}-target`);
      const linkedParent = join(fixture, `${name}-link`);
      mkdirSync(target);
      symlinkSync(target, linkedParent, process.platform === "win32" ? "junction" : "dir");
      const suffix = Array.from({ length: depth + 1 }, (_, index) => `level-${index}`);
      const targetRuntime = join(target, ...suffix);
      const runtimeRoot = join(linkedParent, ...suffix);
      if (exists) mkdirSync(targetRuntime, { recursive: true });
      const database = openSqliteDatabase(join(fixture, `${name}.sqlite`), migrations);
      const repository = new SqliteArtifactRepository(database);
      try {
        await assert.rejects(
          () =>
            DurableArtifactStore.open({
              repository,
              clock: new ManualClock(1_800_000_000_000),
              config: vaultConfig(runtimeRoot),
            }),
          /unsafe filesystem object/u,
        );
        assert.equal(existsSync(join(targetRuntime, "artifacts")), false);
      } finally {
        database.close();
      }
    }
  }
});

test("a runtime-root junction or symlink is rejected as a redirected root", async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), "peas-artifact-root-link-"));
  const target = join(fixture, "target");
  const linkedRoot = join(fixture, "linked-root");
  mkdirSync(target);
  symlinkSync(target, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  if (process.platform === "win32") {
    const details = execFileSync("fsutil", ["reparsepoint", "query", linkedRoot], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.match(details, /0xa0000003/iu);
  }
  const database = openSqliteDatabase(join(fixture, "outside.sqlite"), migrations);
  context.after(() => {
    database.close();
    rmSync(fixture, { recursive: true, force: true });
  });
  await assert.rejects(
    () =>
      DurableArtifactStore.open({
        repository: new SqliteArtifactRepository(database),
        clock: new ManualClock(1_800_000_000_000),
        config: vaultConfig(linkedRoot),
      }),
    /unsafe filesystem object/u,
  );
  assert.equal(existsSync(join(target, "artifacts")), false);
});

test("Linux file symlinks cannot replace committed content", {
  skip: process.platform !== "linux" ? "Linux platform evidence" : false,
}, async (context) => {
  const { root, store } = await harness(context);
  const result = await store.store(request("linux-file-symlink", Buffer.from("trusted")));
  const content = join(
    root,
    "artifacts",
    "sha256",
    result.artifact.digest.slice(0, 2),
    result.artifact.digest.slice(2, 4),
    result.artifact.digest,
  );
  const outside = join(root, "synthetic-outside-file");
  writeFileSync(outside, "outside");
  rmSync(content);
  symlinkSync(outside, content, "file");
  await assert.rejects(
    () => store.read(result.artifact.digest),
    (error: unknown) =>
      error instanceof ArtifactVaultError &&
      error.code === "artifact-integrity-failure" &&
      error.message === "Committed artifact content is missing",
  );
});
