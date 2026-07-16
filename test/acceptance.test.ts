import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import type { StoredEvent } from "../src/core/event.js";
import { assertJson, canonicalJson } from "../src/core/json.js";
import { DeterministicProcessor } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { captureScenario } from "./scenario.js";

type Golden = {
  reducerVersion: "3.0.0";
  stateSchemaVersion: 4;
  eventCount: number;
  eventHead: string;
  stateHead: string;
  decisionHead: string;
  aggregateCount: number;
  outputCount: number;
  rejectionCount: number;
  maxAggregateBytes: number;
};

const fixtureDirectory = join(process.cwd(), "fixtures");
const historicalCapture = "earnings-cluster.v2.captured.ndjson";
const historicalGolden = "earnings-cluster.v2.golden.json";
const currentCapture = "earnings-cluster.pr2b-reducer-3.0-state-4.captured.ndjson";
const currentGolden = "earnings-cluster.pr2b-reducer-3.0-state-4.golden.json";
const historicalCaptureSha256 = "0803d3b49d42e5f91391755b361c9b02e6ea35ab378239e7f5a8b0851f0ddc2f";
const historicalGoldenSha256 = "9dcdaabbca76f73bee9539957136bc6d539168e65fe9c3b667e34a63d0169ff2";

function readCapturedFixture(name: string): readonly StoredEvent[] {
  return readFileSync(join(fixtureDirectory, name), "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const value: unknown = JSON.parse(line);
      assertJson(value);
      return value as StoredEvent;
    });
}

function readGolden(): Golden {
  return JSON.parse(readFileSync(join(fixtureDirectory, currentGolden), "utf8")) as Golden;
}

test("frozen reducer-2.2 RC.2 evidence remains byte-identical historical evidence", () => {
  const captureBytes = readFileSync(join(fixtureDirectory, historicalCapture));
  const goldenBytes = readFileSync(join(fixtureDirectory, historicalGolden));
  assert.equal(createHash("sha256").update(captureBytes).digest("hex"), historicalCaptureSha256);
  assert.equal(createHash("sha256").update(goldenBytes).digest("hex"), historicalGoldenSha256);
  new CapturedEventLog(readCapturedFixture(historicalCapture));
});

test("reducer-3.0 PR 2B capture and paged replay produce identical audited results", async () => {
  const scenario = await captureScenario();
  const replayLog = new CapturedEventLog(scenario.events);
  const replayStore = new InMemoryProcessingStore<EarningsClusterState>(replayLog);
  const replay = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: replayStore,
    eventLog: replayLog,
    manifest: scenario.manifest,
  });
  await replay.processAvailable(2);
  const replaySnapshot = await replay.snapshot(2);

  assert.deepEqual(replaySnapshot, scenario.snapshot);

  const fixture = readCapturedFixture(currentCapture);
  new CapturedEventLog(fixture);
  assert.deepEqual(
    fixture.map((event) => canonicalJson(event)),
    scenario.events.map((event) => canonicalJson(event)),
  );

  const golden = readGolden();
  const rejectionCount = scenario.snapshot.aggregates.reduce(
    (sum, aggregate) => sum + aggregate.state.rejectionCount,
    0,
  );
  const maxAggregateBytes = Math.max(
    ...scenario.snapshot.aggregates.map((aggregate) =>
      Buffer.byteLength(canonicalJson(aggregate.state), "utf8"),
    ),
  );
  assert.equal(golden.reducerVersion, "3.0.0");
  assert.equal(golden.stateSchemaVersion, 4);
  assert.equal(golden.eventCount, scenario.events.length);
  assert.equal(scenario.manifest.behavior.reducerVersion, golden.reducerVersion);
  assert.equal(
    scenario.snapshot.aggregates.every((aggregate) => aggregate.state.schemaVersion === 4),
    true,
  );
  assert.equal(scenario.events.at(-1)?.eventHash, golden.eventHead);
  assert.equal(scenario.snapshot.cursor.stateHead, golden.stateHead);
  assert.equal(scenario.snapshot.cursor.decisionHead, golden.decisionHead);
  assert.equal(scenario.snapshot.aggregates.length, golden.aggregateCount);
  assert.equal(scenario.snapshot.outputs.length, golden.outputCount);
  assert.equal(rejectionCount, golden.rejectionCount);
  assert.equal(maxAggregateBytes, golden.maxAggregateBytes);
});
