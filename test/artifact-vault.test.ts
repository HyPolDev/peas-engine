import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { DurableArtifactStore } from "../src/adapters/artifacts/durable-artifact-store.js";
import { defaultPeasRuntimeRoot } from "../src/adapters/artifacts/runtime-root.js";
import { SqliteArtifactRepository } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { sanitizeRequestIdentity } from "../src/artifacts/identity.js";
import { assertSafeByteAddition } from "../src/artifacts/validation.js";
import type { ArtifactVaultConfig, StoreArtifactRequest } from "../src/artifacts/artifact-store.js";
import { ManualClock } from "../src/core/clock.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));

type Harness = Readonly<{
  root: string;
  database: ReturnType<typeof openSqliteDatabase>;
  repository: SqliteArtifactRepository;
  clock: ManualClock;
  store: DurableArtifactStore;
}>;

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
    config: {
      runtimeRoot: root,
      maxArtifactBytes: 1_024,
      maxVaultBytes: 4_096,
      maxConcurrentWrites: 2,
      streamHighWaterMarkBytes: 17,
      stageExpiryMs: 1_000,
      writerLeaseBehavior: "fail",
      writerLeaseWaitMs: 0,
      ...overrides,
    },
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
        },
      }),
    /lease/u,
  );
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

test("reconciliation expires attempts and quarantines unowned stages", async (context) => {
  const { root, repository, clock, database, store } = await harness(context);
  const requestIdentity = sanitizeRequestIdentity({
    method: "GET",
    origin: "https://example.test",
    path: "/stage",
    routeLabel: "fixture.stage",
  });
  repository.recordAttempt({
    attemptId: "expired-attempt",
    stagingId: "expired-stage",
    provider: "fixture",
    recordId: "record",
    revisionId: "1",
    startedAtMs: clock.nowMs(),
    recordedAtMs: clock.nowMs(),
    request: requestIdentity,
  });
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

test("immutable artifact evidence rejects updates and deletes", async (context) => {
  const { database, store } = await harness(context);
  await store.store(request("immutable", Buffer.from("entity")));
  for (const table of [
    "artifact_retrieval_attempts",
    "artifact_retrieval_outcomes",
    "artifact_blobs",
    "artifact_observations",
  ]) {
    assert.throws(() => database.prepare(`DELETE FROM ${table}`).run(), /immutable/u);
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
