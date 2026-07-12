import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { createHash } from "node:crypto";
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
import { defaultPeasRuntimeRoot } from "../src/adapters/artifacts/runtime-root.js";
import { SqliteArtifactRepository } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import type { WriterFence } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { deriveObservationId, sanitizeRequestIdentity } from "../src/artifacts/identity.js";
import {
  assertSafeByteAddition,
  persistedRetrievalAttemptId,
  validateRetrievalAttempt,
} from "../src/artifacts/validation.js";
import type {
  ArtifactVaultConfig,
  ReconciliationReport,
  StoreArtifactRequest,
} from "../src/artifacts/artifact-store.js";
import { ManualClock } from "../src/core/clock.js";
import { canonicalHash } from "../src/core/hash.js";
import type { JsonValue } from "../src/core/json.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const artifactWorkerPath = join(process.cwd(), "test", "fixtures", "artifact-vault-worker.mjs");

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
  const database = openSqliteDatabase(join(root, "vault.sqlite"), migrations);
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
  expectedType: "staged" | "result",
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onMessage = (message: unknown): void => {
      if (typeof message !== "object" || message === null || !("type" in message)) return;
      if ((message as { type: unknown }).type !== expectedType) return;
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
  const databasePath = join(root, "vault.sqlite");
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
    {
      ...validateRetrievalAttempt(request("incomplete-attempt", Buffer.alloc(0)).attempt),
      stagingId: "incomplete-stage",
      recordedAtMs: clock.nowMs(),
    },
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
    { ...draft.attempt, stagingId: "expired-before-commit-stage", recordedAtMs: clock.nowMs() },
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
    {
      attemptId: "expired-attempt",
      stagingId: "expired-stage",
      provider: "fixture",
      recordId: "record",
      revisionId: "1",
      startedAtMs: clock.nowMs(),
      recordedAtMs: clock.nowMs(),
      request: requestIdentity,
    },
    activeFence(database, clock),
  );
  writeFileSync(join(root, "artifacts", "staging", "expired-stage.part"), "partial");
  writeFileSync(join(root, "artifacts", "staging", "unowned.part"), "partial");
  writeFileSync(join(root, "artifacts", "snapshots", "abandoned.verified"), "partial");
  clock.advanceBy(1_000);

  const report = await store.reconcile();
  assert.equal(report.expiredStages, 1);
  assert.equal(report.quarantinedObjects, 2);
  assert.equal(
    (
      database
        .prepare("SELECT outcome FROM artifact_retrieval_outcomes WHERE attempt_id = ?")
        .get("expired-attempt") as { outcome: string }
    ).outcome,
    "expired",
  );
  assert.deepEqual(readdirSync(join(root, "artifacts", "snapshots")), []);
});

test("reconciliation obeys item budgets and converges across restart cursors", async (context) => {
  const { root, store } = await harness(context);
  for (let index = 0; index < 7; index += 1)
    writeFileSync(join(root, "artifacts", "staging", `budget-${index}.part`), "partial");
  let calls = 0;
  let report: ReconciliationReport;
  do {
    report = await store.reconcile({ maxItems: 2, maxElapsedMs: 10_000 });
    calls += 1;
    assert.equal(calls < 10, true);
  } while (report.continuationCursor !== null);
  assert.equal(calls >= 4, true);
  assert.deepEqual(readdirSync(join(root, "artifacts", "staging")), []);
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

test("runtime roots follow the binding Windows and Linux policy", () => {
  assert.equal(
    defaultPeasRuntimeRoot("win32", { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }),
    "C:\\Users\\test\\AppData\\Local\\peas-engine",
  );
  assert.equal(
    defaultPeasRuntimeRoot("linux", { XDG_DATA_HOME: "/srv/data" }),
    process.platform === "win32" ? "C:\\srv\\data\\peas-engine" : "/srv/data/peas-engine",
  );
  assert.throws(() => defaultPeasRuntimeRoot("win32", {}), /LOCALAPPDATA/u);
  assert.throws(() => defaultPeasRuntimeRoot("darwin", {}), /configure/u);
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
