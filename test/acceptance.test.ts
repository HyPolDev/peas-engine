import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { validateNewEvent, verifyEventStream, type NewEvent } from "../src/core/event.js";
import { canonicalJson } from "../src/core/json.js";
import { DeterministicProcessor, type ProcessingStore } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterConfig,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";

type Golden = {
  eventHead: string;
  stateHash: string;
  decisionHead: string;
  outputCount: number;
};

const fixtureDirectory = join(process.cwd(), "fixtures");

function readFixture(): readonly NewEvent[] {
  return readFileSync(join(fixtureDirectory, "earnings-cluster.v1.ndjson"), "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => validateNewEvent(JSON.parse(line)));
}

function readGolden(): Golden {
  return JSON.parse(
    readFileSync(join(fixtureDirectory, "earnings-cluster.v1.golden.json"), "utf8"),
  ) as Golden;
}

function processor(store: ProcessingStore<EarningsClusterState>) {
  return new DeterministicProcessor<EarningsClusterState, EarningsClusterConfig>({
    reducer: new EarningsClusterReducer(),
    store,
    configuration: { clusterWindowMs: 600_000 },
  });
}

test("captured live-style processing and replay produce identical audited results", () => {
  const fixture = readFixture();
  const eventLog = new InMemoryEventLog();
  const liveStore = new InMemoryProcessingStore<EarningsClusterState>();
  const live = processor(liveStore);

  for (const input of fixture) {
    const result = eventLog.append(input);
    assert.equal(result.appended, true);
    live.process(result.event);
  }

  const captured = eventLog.readAll();
  verifyEventStream(captured);
  const liveSnapshot = live.snapshot();

  const replayStore = new InMemoryProcessingStore<EarningsClusterState>();
  const replay = processor(replayStore);
  replay.processAll(captured);
  const replaySnapshot = replay.snapshot();

  assert.equal(
    canonicalJson(replaySnapshot.checkpoint.state),
    canonicalJson(liveSnapshot.checkpoint.state),
  );
  assert.equal(replaySnapshot.checkpoint.stateHash, liveSnapshot.checkpoint.stateHash);
  assert.equal(replaySnapshot.checkpoint.decisionHead, liveSnapshot.checkpoint.decisionHead);
  assert.deepEqual(replaySnapshot.outputs, liveSnapshot.outputs);

  const golden = readGolden();
  assert.equal(captured.at(-1)?.eventHash, golden.eventHead);
  assert.equal(liveSnapshot.checkpoint.stateHash, golden.stateHash);
  assert.equal(liveSnapshot.checkpoint.decisionHead, golden.decisionHead);
  assert.equal(liveSnapshot.outputs.length, golden.outputCount);
});

test("reprocessing and recapturing the same event are idempotent", () => {
  const [first] = readFixture();
  assert.ok(first);
  const eventLog = new InMemoryEventLog();
  const store = new InMemoryProcessingStore<EarningsClusterState>();
  const live = processor(store);

  const initialAppend = eventLog.append(first);
  live.process(initialAppend.event);
  const initialSnapshot = live.snapshot();

  const duplicateAppend = eventLog.append(first);
  assert.equal(duplicateAppend.appended, false);
  live.process(duplicateAppend.event);
  assert.deepEqual(live.snapshot(), initialSnapshot);
});

test("SQLite persists an atomic, restartable, and immutable live-style transcript", (context) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "peas-engine-test-"));
  context.after(() => {
    const expectedPrefix = join(tmpdir(), "peas-engine-test-");
    if (!temporaryDirectory.startsWith(expectedPrefix)) {
      throw new Error("Refusing to remove a directory outside the PEAS test prefix");
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const filename = join(temporaryDirectory, "kernel.sqlite");
  const migration = readFileSync(join(process.cwd(), "migrations", "001_initial.sql"), "utf8");
  const fixture = readFixture();

  let database = openSqliteDatabase(filename, migration);
  let eventLog = new SqliteEventLog(database);
  let store = new SqliteProcessingStore<EarningsClusterState>(database, "earnings-cluster/default");
  let live = processor(store);

  for (const input of fixture.slice(0, 3)) {
    const result = eventLog.append(input);
    live.process(result.event);
  }
  database.close();

  database = openSqliteDatabase(filename, migration);
  eventLog = new SqliteEventLog(database);
  store = new SqliteProcessingStore<EarningsClusterState>(database, "earnings-cluster/default");
  live = processor(store);
  for (const input of fixture.slice(3)) {
    const result = eventLog.append(input);
    live.process(result.event);
  }

  const captured = eventLog.readAll();
  const sqliteSnapshot = live.snapshot();
  const replayStore = new InMemoryProcessingStore<EarningsClusterState>();
  const replay = processor(replayStore);
  replay.processAll(captured);

  assert.deepEqual(sqliteSnapshot, replay.snapshot());
  assert.equal(
    (database.prepare("SELECT count(*) AS count FROM events").get() as { count: bigint }).count,
    6n,
  );
  assert.equal(
    (
      database.prepare("SELECT count(*) AS count FROM processing_outputs").get() as {
        count: bigint;
      }
    ).count,
    10n,
  );
  assert.equal(
    (database.prepare("SELECT count(*) AS count FROM jobs").get() as { count: bigint }).count,
    2n,
  );
  assert.equal(
    (database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: bigint }).count,
    2n,
  );
  assert.throws(() => database.prepare("UPDATE events SET source = 'tampered'").run());
  assert.throws(() =>
    database.prepare("DELETE FROM processing_outputs WHERE category = 'decision'").run(),
  );
  database.close();
});

test("SQLite rolls back outputs and checkpoints together on a constraint failure", () => {
  const migration = readFileSync(join(process.cwd(), "migrations", "001_initial.sql"), "utf8");
  const database = openSqliteDatabase(":memory:", migration);
  const [input] = readFixture();
  assert.ok(input);
  const event = new SqliteEventLog(database).append(input).event;
  const store = new SqliteProcessingStore<EarningsClusterState>(database, "atomicity-test");
  const initialState = new EarningsClusterReducer().initialState({ clusterWindowMs: 600_000 });
  const jobBody = {
    type: "test.job",
    dedupeKey: "same-key",
    notBeforeLogicalMs: event.logicalAtMs,
    payload: {},
  } as const;

  assert.throws(() =>
    store.commit({
      expectedPosition: "0",
      event,
      checkpoint: {
        manifestHash: "manifest",
        processedPosition: event.position,
        logicalAtMs: event.logicalAtMs,
        state: initialState,
        stateHash: "state",
        decisionHead: "decisions",
      },
      outputs: [
        {
          outputId: "job-output-1",
          inputEventId: event.eventId,
          inputPosition: event.position,
          category: "job",
          ordinal: 0,
          body: jobBody,
          bodyHash: "body-1",
        },
        {
          outputId: "job-output-2",
          inputEventId: event.eventId,
          inputPosition: event.position,
          category: "job",
          ordinal: 1,
          body: jobBody,
          bodyHash: "body-2",
        },
      ],
    }),
  );

  assert.equal(store.loadCheckpoint(), undefined);
  assert.equal(store.readOutputs().length, 0);
  assert.equal(
    (database.prepare("SELECT count(*) AS count FROM jobs").get() as { count: bigint }).count,
    0n,
  );
  database.close();
});
