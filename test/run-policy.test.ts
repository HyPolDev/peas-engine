import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import { draftFromStored } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import {
  DeterministicProcessor,
  type ProcessingStore,
  type RunKind,
  type RunManifest,
  type RunRegistration,
} from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterConfig,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { captureScenario, makeManifest } from "./scenario.js";

const kinds: readonly RunKind[] = ["live", "replay", "shadow", "research", "paper"];
const migrations = loadMigrations(join(process.cwd(), "migrations"));

function registration(
  manifest: RunManifest<EarningsClusterConfig>,
): RunRegistration<EarningsClusterConfig> {
  return {
    manifest,
    manifestHash: canonicalHash("peas/run-manifest/v2", manifest),
    behaviorHash: canonicalHash("peas/run-behavior/v2", manifest.behavior),
  };
}

async function assertMatrix(
  label: string,
  store: ProcessingStore<EarningsClusterState>,
): Promise<void> {
  for (const kind of kinds) {
    for (const effectsAllowed of [false, true]) {
      const runId = `${label}-${kind}-${effectsAllowed ? "effects" : "dry"}`;
      const manifest = makeManifest(runId, kind, effectsAllowed);
      const operation = store.ensureRun(registration(manifest));
      if (kind === "live" || !effectsAllowed) {
        await operation;
      } else {
        await assert.rejects(operation, new RegExp(`Run kind ${kind} cannot dispatch`, "u"));
        assert.throws(
          () =>
            new DeterministicProcessor({
              reducer: new EarningsClusterReducer(),
              store,
              eventLog: new CapturedEventLog([]),
              manifest,
            }),
          new RegExp(`Run kind ${kind} cannot dispatch`, "u"),
        );
      }
    }
  }
}

test("all run kinds enforce the effect policy in memory and SQLite", async () => {
  const emptyLog = new CapturedEventLog([]);
  await assertMatrix("memory", new InMemoryProcessingStore(emptyLog));

  const database = openSqliteDatabase(":memory:", migrations);
  try {
    await assertMatrix("sqlite", new SqliteProcessingStore(database));
  } finally {
    database.close();
  }
});

test("only a live effects-enabled run creates dispatchable rows in either store", async () => {
  const scenario = await captureScenario();
  const firstEvent = scenario.events[0];
  assert.ok(firstEvent);

  const memoryLog = new CapturedEventLog([firstEvent]);
  const memoryStore = new InMemoryProcessingStore<EarningsClusterState>(memoryLog);
  for (const kind of kinds) {
    const manifest = makeManifest(`memory-dispatch-${kind}`, kind, false);
    const processor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: memoryStore,
      eventLog: memoryLog,
      manifest,
    });
    await processor.processAvailable(1);
    assert.deepEqual(memoryStore.dispatchableCounts(manifest.runId), { jobs: 0, outbox: 0 });
  }
  const liveManifest = makeManifest("memory-dispatch-live-effects", "live", true);
  await new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: memoryStore,
    eventLog: memoryLog,
    manifest: liveManifest,
  }).processAvailable(1);
  assert.ok(memoryStore.dispatchableCounts(liveManifest.runId).jobs > 0);
  assert.ok(memoryStore.dispatchableCounts(liveManifest.runId).outbox > 0);

  const database = openSqliteDatabase(":memory:", migrations);
  try {
    const clock = new ManualClock(firstEvent.receivedAtMs);
    const sqliteLog = new SqliteEventLog(database, { clock });
    const appended = await sqliteLog.append(draftFromStored(firstEvent));
    assert.equal(appended.disposition, "appended");
    const sqliteStore = new SqliteProcessingStore<EarningsClusterState>(database);
    for (const kind of kinds) {
      const manifest = makeManifest(`sqlite-dispatch-${kind}`, kind, false);
      await new DeterministicProcessor({
        reducer: new EarningsClusterReducer(),
        store: sqliteStore,
        eventLog: sqliteLog,
        manifest,
      }).processAvailable(1);
    }
    const sqliteLive = makeManifest("sqlite-dispatch-live-effects", "live", true);
    await new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: sqliteStore,
      eventLog: sqliteLog,
      manifest: sqliteLive,
    }).processAvailable(1);

    const counts = database
      .prepare(
        `SELECT o.run_id, count(*) AS count
         FROM jobs j JOIN processing_outputs o ON o.output_id = j.output_id
         GROUP BY o.run_id`,
      )
      .all() as { run_id: string; count: bigint }[];
    assert.deepEqual(
      counts.map((row) => row.run_id),
      [sqliteLive.runId],
    );
    assert.ok((counts[0]?.count ?? 0n) > 0n);
  } finally {
    database.close();
  }
});
