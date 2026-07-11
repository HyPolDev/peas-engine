import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  applyMigrations,
  loadMigrations,
  openSqliteDatabase,
  type SqliteDatabase,
} from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import type { EventDraft, StoredEvent } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import type { JsonObject } from "../src/core/json.js";
import { DeterministicProcessor, type Reducer, type RunManifest } from "../src/core/processor.js";

const migrationDirectory = join(process.cwd(), "migrations");
const migrations = loadMigrations(migrationDirectory);
const OUTPUT_PAGINATION_INDEX = "processing_outputs_run_sequence";
const BASE_TIME_MS = 1_800_000_000_000;

type CounterState = JsonObject & { count: number };

const counterReducer: Reducer<CounterState, JsonObject> = {
  name: "pagination-counter",
  version: "1.0.0",
  route: () => "pagination-counter",
  parseState: (value: unknown): CounterState => {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof (value as { count?: unknown }).count !== "number"
    ) {
      throw new TypeError("Invalid pagination counter state");
    }
    return value as CounterState;
  },
  initialState: () => ({ count: 0 }),
  apply: (state, event) => {
    const eventOrdinal = event.payload["ordinal"];
    if (typeof eventOrdinal !== "number") throw new TypeError("Missing event ordinal");
    const count = state.count + 1;
    return {
      state: { count },
      decisions: [
        {
          type: "pagination-counted",
          payload: { count, eventOrdinal },
        },
      ],
      jobs: [],
      outbox: [],
    };
  },
};

function manifestFor(runId: string): RunManifest<JsonObject> {
  return {
    manifestVersion: 2,
    runId,
    kind: "replay",
    effectsAllowed: false,
    canonicalizationVersion: "peas-json-v1",
    behavior: {
      reducerName: counterReducer.name,
      reducerVersion: counterReducer.version,
      buildDigest: canonicalHash("peas/output-pagination/build/v1", { version: 1 }),
      schemaRegistryDigest: canonicalHash("peas/output-pagination/schema/v1", { version: 1 }),
      configuration: {},
      identities: {
        extractorVersion: "output-pagination-v1",
        featureSetId: null,
        modelId: null,
        promptId: null,
        datasetId: null,
      },
    },
  };
}

function temporaryDatabase(context: test.TestContext): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "peas-output-pagination-"));
  const database = openSqliteDatabase(join(directory, "kernel.sqlite"), migrations);
  context.after(() => {
    if (database.open) database.close();
    const prefix = join(tmpdir(), "peas-output-pagination-");
    if (!directory.startsWith(prefix)) throw new Error("Unsafe SQLite test cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

async function captureEvents(eventLog: SqliteEventLog): Promise<readonly StoredEvent[]> {
  const events: StoredEvent[] = [];
  for (let ordinal = 1; ordinal <= 9; ordinal += 1) {
    const artifactHash = canonicalHash("peas/output-pagination/artifact/v1", { ordinal });
    const draft: EventDraft = {
      envelopeVersion: 2,
      type: "pagination.observed",
      schemaVersion: 1,
      source: "fixture:output-pagination",
      subject: "pagination:counter",
      occurredAtMs: BASE_TIME_MS + ordinal,
      correlationId: "output-pagination",
      provider: {
        provider: "fixture",
        recordId: `pagination-${ordinal}`,
        revisionId: "1",
        artifactHash,
      },
      payload: { ordinal },
    };
    events.push((await eventLog.append(draft)).event);
  }
  return events;
}

function schemaSnapshot(database: Database.Database): string {
  return JSON.stringify({
    schema: database
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
      )
      .all(),
    ledger: database
      .prepare(
        `SELECT CAST(version AS TEXT) AS version, name, checksum
         FROM schema_migrations ORDER BY version`,
      )
      .all(),
  });
}

test("migration 002 adds the immutable per-run output pagination index", () => {
  assert.deepEqual(
    migrations.slice(0, 2).map(({ version, name }) => ({ version, name })),
    [
      { version: 1, name: "001_kernel_contracts_v2.sql" },
      { version: 2, name: "002_processing_outputs_run_sequence.sql" },
    ],
  );

  const database = new Database(":memory:");
  database.defaultSafeIntegers(true);
  const baseline = migrations[0];
  const pagination = migrations[1];
  assert.ok(baseline);
  assert.ok(pagination);

  applyMigrations(database, [baseline]);
  const beforeUpgrade = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(OUTPUT_PAGINATION_INDEX);
  assert.equal(beforeUpgrade, undefined);

  applyMigrations(database, migrations);
  const indexColumns = database
    .prepare(`PRAGMA index_info('${OUTPUT_PAGINATION_INDEX}')`)
    .all() as { seqno: bigint; name: string }[];
  assert.deepEqual(
    indexColumns.sort((left, right) => Number(left.seqno - right.seqno)).map(({ name }) => name),
    ["run_id", "sequence"],
  );

  const beforeDivergence = schemaSnapshot(database);
  assert.throws(
    () =>
      applyMigrations(
        database,
        migrations.map((migration) =>
          migration.version === pagination.version
            ? { ...pagination, sql: `${pagination.sql}\n-- divergent repository history` }
            : migration,
        ),
      ),
    /diverges at applied position 2/iu,
  );
  assert.equal(schemaSnapshot(database), beforeDivergence);
  database.close();
});

test("late output pages remain exact for interleaved runs and use the matching index", async (context) => {
  const database = temporaryDatabase(context);
  const eventLog = new SqliteEventLog(database, { clock: new ManualClock(BASE_TIME_MS) });
  const events = await captureEvents(eventLog);
  const store = new SqliteProcessingStore<CounterState>(database);
  const runA = new DeterministicProcessor({
    reducer: counterReducer,
    store,
    eventLog,
    manifest: manifestFor("pagination-run-a"),
  });
  const runB = new DeterministicProcessor({
    reducer: counterReducer,
    store,
    eventLog,
    manifest: manifestFor("pagination-run-b"),
  });

  for (const event of events) {
    await runA.process(event);
    await runB.process(event);
  }

  const allRunA = await store.readOutputsAfter("pagination-run-a", "0", 100);
  const allRunB = await store.readOutputsAfter("pagination-run-b", "0", 100);
  assert.deepEqual(
    allRunA.outputs.map(({ sequence }) => sequence),
    ["1", "3", "5", "7", "9", "11", "13", "15", "17"],
  );
  assert.deepEqual(
    allRunB.outputs.map(({ sequence }) => sequence),
    ["2", "4", "6", "8", "10", "12", "14", "16", "18"],
  );

  const latePage = await store.readOutputsAfter("pagination-run-a", "9", 3);
  assert.deepEqual(
    latePage.outputs.map(({ sequence, inputPosition, body }) => ({
      sequence,
      inputPosition,
      body,
    })),
    [
      {
        sequence: "11",
        inputPosition: "6",
        body: { type: "pagination-counted", payload: { count: 6, eventOrdinal: 6 } },
      },
      {
        sequence: "13",
        inputPosition: "7",
        body: { type: "pagination-counted", payload: { count: 7, eventOrdinal: 7 } },
      },
      {
        sequence: "15",
        inputPosition: "8",
        body: { type: "pagination-counted", payload: { count: 8, eventOrdinal: 8 } },
      },
    ],
  );
  assert.equal(latePage.nextSequence, "15");
  assert.equal(latePage.hasMore, true);

  const finalPage = await store.readOutputsAfter("pagination-run-a", latePage.nextSequence, 3);
  assert.deepEqual(
    finalPage.outputs.map(({ sequence, inputPosition, body }) => ({
      sequence,
      inputPosition,
      body,
    })),
    [
      {
        sequence: "17",
        inputPosition: "9",
        body: { type: "pagination-counted", payload: { count: 9, eventOrdinal: 9 } },
      },
    ],
  );
  assert.equal(finalPage.nextSequence, "17");
  assert.equal(finalPage.hasMore, false);

  const queryPlan = database
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT sequence, output_id, run_id, input_event_id, input_position, aggregate_id,
              category, ordinal, dedupe_key, not_before_logical_ms, body_json, body_hash,
              envelope_hash
       FROM processing_outputs
       WHERE run_id = ? AND sequence > ?
       ORDER BY sequence
       LIMIT ?`,
    )
    .all("pagination-run-a", 9n, 4n) as { detail: string }[];
  assert.equal(
    queryPlan.some(({ detail }) => detail.includes(OUTPUT_PAGINATION_INDEX)),
    true,
    `Expected SQLite to select ${OUTPUT_PAGINATION_INDEX}: ${JSON.stringify(
      queryPlan.map(({ detail }) => detail),
    )}`,
  );
});
