import assert from "node:assert/strict";
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
  eventHead: string;
  stateHead: string;
  decisionHead: string;
  aggregateCount: number;
  outputCount: number;
  rejectionCount: number;
  maxAggregateBytes: number;
};

const fixtureDirectory = join(process.cwd(), "fixtures");

function readCapturedFixture(): readonly StoredEvent[] {
  return readFileSync(join(fixtureDirectory, "earnings-cluster.v2.captured.ndjson"), "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const value: unknown = JSON.parse(line);
      assertJson(value);
      return value as StoredEvent;
    });
}

function readGolden(): Golden {
  return JSON.parse(
    readFileSync(join(fixtureDirectory, "earnings-cluster.v2.golden.json"), "utf8"),
  ) as Golden;
}

test("captured live-style processing and paged replay produce identical audited results", async () => {
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

  const fixture = readCapturedFixture();
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
    ...scenario.snapshot.aggregates.map((aggregate) => canonicalJson(aggregate.state).length),
  );
  assert.equal(scenario.events.at(-1)?.eventHash, golden.eventHead);
  assert.equal(scenario.snapshot.cursor.stateHead, golden.stateHead);
  assert.equal(scenario.snapshot.cursor.decisionHead, golden.decisionHead);
  assert.equal(scenario.snapshot.aggregates.length, golden.aggregateCount);
  assert.equal(scenario.snapshot.outputs.length, golden.outputCount);
  assert.equal(rejectionCount, golden.rejectionCount);
  assert.equal(maxAggregateBytes, golden.maxAggregateBytes);
});
