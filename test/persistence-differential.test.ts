import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import { draftFromStored, type StoredEvent } from "../src/core/event.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { DeterministicProcessor, type RunManifest } from "../src/core/processor.js";
import {
  type EarningsClusterConfig,
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { captureScenario } from "./scenario.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const pageSizes = [1, 2, 7, 1_000] as const;

function temporaryDatabasePath(context: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "peas-persistence-differential-"));
  context.after(() => {
    const safePrefix = join(tmpdir(), "peas-persistence-differential-");
    if (!directory.startsWith(safePrefix)) throw new Error("Unsafe differential cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, "kernel.sqlite");
}

async function readAllEvents(
  eventLog: CapturedEventLog | SqliteEventLog,
  pageSize: number,
): Promise<readonly StoredEvent[]> {
  const events: StoredEvent[] = [];
  let position = "0";
  while (true) {
    const page = await eventLog.readAfter(position, pageSize);
    events.push(...page.events);
    position = page.nextPosition;
    if (!page.hasMore) return events;
  }
}

async function memorySnapshot(
  events: readonly StoredEvent[],
  manifest: RunManifest<EarningsClusterConfig>,
  pageSize: number,
) {
  const eventLog = new CapturedEventLog(events);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: new InMemoryProcessingStore<EarningsClusterState>(eventLog),
    eventLog,
    manifest,
  });
  await processor.processAvailable(pageSize);
  return {
    events: await readAllEvents(eventLog, pageSize),
    snapshot: await processor.snapshot(pageSize),
  };
}

async function sqliteSnapshotWithReopen(
  databasePath: string,
  events: readonly StoredEvent[],
  manifest: RunManifest<EarningsClusterConfig>,
  pageSize: number,
) {
  for (const expected of events) {
    const database = openSqliteDatabase(databasePath, migrations);
    try {
      const clock = new ManualClock(expected.receivedAtMs);
      const eventLog = new SqliteEventLog(database, { clock });
      const appended = await eventLog.append(draftFromStored(expected));
      assert.equal(appended.disposition, "appended");
      assert.equal(
        canonicalJson(appended.event as unknown as JsonValue),
        canonicalJson(expected as unknown as JsonValue),
        `capture diverged at event position ${expected.position}`,
      );
      const processor = new DeterministicProcessor({
        reducer: new EarningsClusterReducer(),
        store: new SqliteProcessingStore<EarningsClusterState>(database),
        eventLog,
        manifest,
      });
      await processor.processAvailable(pageSize);
    } finally {
      database.close();
    }
  }

  const database = openSqliteDatabase(databasePath, migrations);
  try {
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    const eventLog = new SqliteEventLog(database, { clock: new ManualClock(0) });
    const processor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: new SqliteProcessingStore<EarningsClusterState>(database),
      eventLog,
      manifest,
    });
    return {
      events: await readAllEvents(eventLog, pageSize),
      snapshot: await processor.snapshot(pageSize),
    };
  } finally {
    database.close();
  }
}

function canonical(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

test("memory and SQLite remain byte-identical across paging and per-event reopen", async (context) => {
  const captured = await captureScenario();

  for (const pageSize of pageSizes) {
    await context.test(`page size ${pageSize}`, async (subcontext) => {
      const databasePath = temporaryDatabasePath(subcontext);
      const memory = await memorySnapshot(captured.events, captured.manifest, pageSize);
      const sqlite = await sqliteSnapshotWithReopen(
        databasePath,
        captured.events,
        captured.manifest,
        pageSize,
      );

      assert.equal(canonical(sqlite.events), canonical(memory.events));
      assert.equal(canonical(sqlite.snapshot), canonical(memory.snapshot));
      assert.equal(sqlite.snapshot.cursor.lastEventHash, memory.snapshot.cursor.lastEventHash);
      assert.equal(sqlite.snapshot.cursor.stateHead, memory.snapshot.cursor.stateHead);
      assert.equal(sqlite.snapshot.cursor.decisionHead, memory.snapshot.cursor.decisionHead);
    });
  }
});
