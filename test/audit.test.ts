import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import {
  applyMigrations,
  loadMigrations,
  openSqliteDatabase,
  type SqliteDatabase,
} from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import { draftFromStored, type EventDraft, type StoredEvent } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, cloneJson, type JsonObject, type JsonValue } from "../src/core/json.js";
import { DeterministicProcessor } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { BASE_TIME_MS, FISCAL_PERIOD, captureScenario, makeManifest } from "./scenario.js";

const migrationDirectory = join(process.cwd(), "migrations");

function temporaryDatabase(context: test.TestContext): Readonly<{
  database: SqliteDatabase;
  path: string;
}> {
  const directory = mkdtempSync(join(tmpdir(), "peas-engine-audit-"));
  context.after(() => {
    const prefix = join(tmpdir(), "peas-engine-audit-");
    if (!directory.startsWith(prefix)) throw new Error("Unsafe audit cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    database: openSqliteDatabase(
      join(directory, "kernel.sqlite"),
      loadMigrations(migrationDirectory),
    ),
    path: directory,
  };
}

async function importCaptured(
  database: SqliteDatabase,
  events: readonly StoredEvent[],
): Promise<Readonly<{ clock: ManualClock; eventLog: SqliteEventLog }>> {
  const clock = new ManualClock(0);
  const eventLog = new SqliteEventLog(database, { clock });
  for (const expected of events) {
    clock.advanceTo(expected.receivedAtMs);
    const result = await eventLog.append(draftFromStored(expected));
    assert.equal(result.disposition, "appended");
    assert.equal(canonicalJson(result.event), canonicalJson(expected));
  }
  return { clock, eventLog };
}

test("tampered events and aggregate checkpoints fail closed before reduction", async (context) => {
  const scenario = await captureScenario();
  const capturedLog = new CapturedEventLog(scenario.events);
  const memoryStore = new InMemoryProcessingStore<EarningsClusterState>(capturedLog);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: memoryStore,
    eventLog: capturedLog,
    manifest: scenario.manifest,
  });
  const first = scenario.events[0];
  assert.ok(first);
  const tampered = cloneJson(first as unknown as JsonValue) as StoredEvent;
  const tamperedPayload = tampered.payload as Record<string, JsonValue>;
  tamperedPayload["issuerCik"] = "9999999999";
  await assert.rejects(() => processor.process(tampered), /Content hash mismatch/u);
  assert.throws(() => new CapturedEventLog([tampered]), /Content hash mismatch/u);

  const tamperedEventHash: StoredEvent = { ...first, eventHash: "0".repeat(64) };
  await assert.rejects(() => processor.process(tamperedEventHash), /Event hash mismatch/u);
  assert.throws(() => new CapturedEventLog([tamperedEventHash]), /Event hash mismatch/u);

  const { database } = temporaryDatabase(context);
  const imported = await importCaptured(database, scenario.events);
  const sqliteStore = new SqliteProcessingStore<EarningsClusterState>(database);
  const sqliteProcessor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: sqliteStore,
    eventLog: imported.eventLog,
    manifest: scenario.manifest,
  });
  const persistedFirst = await imported.eventLog.get("1");
  const persistedSecond = await imported.eventLog.get("2");
  assert.ok(persistedFirst);
  assert.ok(persistedSecond);
  await sqliteProcessor.process(persistedFirst);
  database.prepare("UPDATE aggregate_checkpoints SET state_json = '{}' ").run();
  await assert.rejects(() => sqliteProcessor.process(persistedSecond));
  database.close();
});

test("run manifests namespace outputs and effects are data-enforced", async (context) => {
  const scenario = await captureScenario();
  const { database } = temporaryDatabase(context);
  const { eventLog } = await importCaptured(database, scenario.events);
  const store = new SqliteProcessingStore<EarningsClusterState>(database);

  const replayManifest = makeManifest("replay-a", "replay", false);
  const shadowManifest = makeManifest("shadow-b", "shadow", false);
  const liveManifest = makeManifest("live-c", "live", true);
  for (const manifest of [replayManifest, shadowManifest, liveManifest]) {
    const processor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store,
      eventLog,
      manifest,
    });
    await processor.processAvailable(3);
  }

  const outputCounts = database
    .prepare("SELECT run_id, count(*) AS count FROM processing_outputs GROUP BY run_id")
    .all() as { run_id: string; count: bigint }[];
  assert.deepEqual(outputCounts.map((row) => row.run_id).sort(), [
    "live-c",
    "replay-a",
    "shadow-b",
  ]);
  assert.equal(
    (
      database
        .prepare(
          `SELECT count(*) AS count FROM jobs j
           JOIN processing_outputs o ON o.output_id = j.output_id
           WHERE o.run_id IN ('replay-a', 'shadow-b')`,
        )
        .get() as { count: bigint }
    ).count,
    0n,
  );

  const now = scenario.events.at(-1)?.logicalAtMs ?? BASE_TIME_MS;
  const firstClaims = await store.claimJobs("live-c", "worker-a", now, 1_000, 100);
  assert.ok(firstClaims.length > 0);
  const reclaimed = await store.claimJobs("live-c", "worker-b", now + 1_001, 1_000, 100);
  const first = firstClaims[0];
  assert.ok(first);
  const same = reclaimed.find((claim) => claim.outputId === first.outputId);
  assert.ok(same);
  assert.ok(same.fencingToken > first.fencingToken);
  await assert.rejects(() =>
    store.renewJob(first.outputId, "worker-a", first.fencingToken, now + 5_000),
  );
  await store.completeJob(same.outputId, "worker-b", same.fencingToken, "ambiguous", "unknown");
  const afterAmbiguous = await store.claimJobs("live-c", "worker-c", now + 5_000, 1_000, 100);
  assert.equal(
    afterAmbiguous.some((claim) => claim.outputId === same.outputId),
    false,
  );
  database.close();
});

test("trusted ingress allocates identity and versions, while provider redelivery is stable", async () => {
  const scenario = await captureScenario();
  const clock = new ManualClock(BASE_TIME_MS);
  const log = new InMemoryEventLog({ clock });
  const drafts = Array.from({ length: 25 }, (_, index) => {
    const artifactHash = canonicalHash("peas/concurrent-artifact/v2", { index });
    const payload = {
      ...(scenario.firstDraft.payload as JsonObject),
      artifactHash,
    };
    return {
      ...scenario.firstDraft,
      provider: {
        ...scenario.firstDraft.provider,
        recordId: `concurrent-${index}`,
        artifactHash,
      },
      payload,
    } satisfies EventDraft;
  });
  const results = await Promise.all(drafts.map((draft) => log.append(draft)));
  assert.deepEqual(
    results.map((result) => result.event.streamVersion),
    Array.from({ length: 25 }, (_, index) => String(index + 1)),
  );
  assert.equal(new Set(results.map((result) => result.event.eventId)).size, 25);

  clock.advanceBy(86_400_000);
  const redelivery = await log.append(drafts[0] as EventDraft);
  assert.equal(redelivery.disposition, "redelivery");
  assert.equal(redelivery.event.receivedAtMs, BASE_TIME_MS);

  const changed = cloneJson(drafts[0] as unknown as JsonValue) as EventDraft;
  const changedArtifact = canonicalHash("peas/concurrent-artifact/v2", { changed: true });
  (changed.provider as { artifactHash: string }).artifactHash = changedArtifact;
  (changed.payload as Record<string, JsonValue>)["artifactHash"] = changedArtifact;
  await assert.rejects(() => log.append(changed), /changed content without a new revision/u);

  const firstPage = await log.readAfter("0", 7);
  assert.equal(firstPage.events.length, 7);
  assert.equal(firstPage.hasMore, true);
  const secondPage = await log.readAfter(firstPage.nextPosition, 7);
  assert.equal(secondPage.events[0]?.position, "8");
});

test("migration ledger rejects changed history and output audit reads verify hashes", async (context) => {
  const migrations = loadMigrations(migrationDirectory);
  const { database } = temporaryDatabase(context);
  assert.equal(
    (database.prepare("SELECT count(*) AS count FROM schema_migrations").get() as { count: bigint })
      .count,
    BigInt(migrations.length),
  );
  const firstMigration = migrations[0];
  assert.ok(firstMigration);
  assert.throws(() =>
    applyMigrations(database, [{ ...firstMigration, sql: `${firstMigration.sql}\n-- changed` }]),
  );
  assert.throws(() => applyMigrations(database, []), /history\/file count mismatch/u);
  assert.throws(() => database.prepare("UPDATE schema_migrations SET checksum = 'forged'").run());

  const scenario = await captureScenario();
  const imported = await importCaptured(database, scenario.events);
  const store = new SqliteProcessingStore<EarningsClusterState>(database);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog: imported.eventLog,
    manifest: scenario.manifest,
  });
  const first = await imported.eventLog.get("1");
  assert.ok(first);
  await processor.process(first);
  database.exec("DROP TRIGGER processing_outputs_no_update");
  database.prepare("UPDATE processing_outputs SET body_json = '{}' WHERE sequence = 1").run();
  await assert.rejects(() => store.readOutputsAfter(scenario.manifest.runId, "0", 100));
  database.close();
});

test("malformed and stale results are quarantined while all three analysis branches succeed", async () => {
  const scenario = await captureScenario();
  assert.equal(scenario.snapshot.cursor.processedPosition, String(scenario.events.length));
  const totalRejections = scenario.snapshot.aggregates.reduce(
    (sum, aggregate) => sum + aggregate.state.rejectionCount,
    0,
  );
  assert.equal(totalRejections, 2);
  const main = scenario.snapshot.aggregates.find((aggregate) => aggregate.state.cluster !== null);
  assert.ok(main?.state.cluster);
  assert.equal(main.state.cluster.status, "finalized");
  assert.equal(main.state.cluster.sources.length, 3);
  assert.equal(main.state.cluster.analysisBranches.length, 3);
  assert.equal(
    main.state.cluster.analysisBranches.every((branch) => branch.status === "succeeded"),
    true,
  );
});

test("per-cluster checkpoints stay bounded under a 300-cluster scale budget", async () => {
  const clock = new ManualClock(BASE_TIME_MS);
  const eventLog = new InMemoryEventLog({ clock });
  const store = new InMemoryProcessingStore<EarningsClusterState>(eventLog);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest: makeManifest("scale-budget", "research", false),
  });
  const started = performance.now();
  for (let index = 0; index < 300; index += 1) {
    const issuerCik = String(index + 1).padStart(10, "0");
    const artifactHash = canonicalHash("peas/scale-artifact/v2", { index });
    const payload: JsonObject = {
      issuerCik,
      fiscalPeriod: FISCAL_PERIOD,
      sourceKind: "issuer_release",
      artifactHash,
      publishedAtMs: clock.nowMs(),
      timestampConfidence: "exact",
      originalTimestamp: null,
    };
    const draft: EventDraft = {
      envelopeVersion: 2,
      type: "earnings.source.observed",
      schemaVersion: 1,
      source: "scale-test",
      subject: `earnings:${issuerCik}:${FISCAL_PERIOD}`,
      occurredAtMs: clock.nowMs(),
      correlationId: `scale-${index}`,
      provider: {
        provider: "scale",
        recordId: `record-${index}`,
        revisionId: "1",
        artifactHash,
      },
      payload,
    };
    const appended = await eventLog.append(draft);
    await processor.process(appended.event);
    clock.advanceBy(1);
  }
  const elapsedMs = performance.now() - started;
  const snapshot = await processor.snapshot(50);
  const maxCheckpointBytes = Math.max(
    ...snapshot.aggregates.map((aggregate) => canonicalJson(aggregate.state).length),
  );
  assert.equal(snapshot.aggregates.length, 300);
  assert.ok(maxCheckpointBytes < 32_000, `checkpoint budget exceeded: ${maxCheckpointBytes}`);
  assert.ok(elapsedMs < 15_000, `processing latency budget exceeded: ${elapsedMs.toFixed(0)}ms`);
});
