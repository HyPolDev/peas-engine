import assert from "node:assert/strict";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { computeContentHash, computeEventHash, type StoredEvent } from "../src/core/event.js";
import { cloneJson, type JsonValue } from "../src/core/json.js";
import {
  type AggregateCheckpoint,
  type AggregatePage,
  computeAggregateCheckpointHash,
  computeRunCursorHash,
  DeterministicProcessor,
  type OutputPage,
  type ProcessingCommit,
  type ProcessingStore,
  type RunCursor,
  type RunRegistration,
  verifyProcessingCommit,
} from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { captureScenario, makeManifest } from "./scenario.js";

class CapturingStore implements ProcessingStore<EarningsClusterState> {
  readonly #delegate: InMemoryProcessingStore<EarningsClusterState>;
  lastCommit: ProcessingCommit<EarningsClusterState> | undefined;

  constructor(eventLog: CapturedEventLog) {
    this.#delegate = new InMemoryProcessingStore(eventLog);
  }

  async ensureRun(registration: RunRegistration): Promise<void> {
    await this.#delegate.ensureRun(registration);
  }

  async loadCursor(runId: string): Promise<RunCursor | undefined> {
    return this.#delegate.loadCursor(runId);
  }

  async loadAggregate(
    runId: string,
    aggregateId: string,
  ): Promise<AggregateCheckpoint<EarningsClusterState> | undefined> {
    return this.#delegate.loadAggregate(runId, aggregateId);
  }

  async commit(value: ProcessingCommit<EarningsClusterState>): Promise<void> {
    this.lastCommit = cloneJson(
      value as unknown as JsonValue,
    ) as ProcessingCommit<EarningsClusterState>;
    await this.#delegate.commit(value);
  }

  async readOutputsAfter(runId: string, sequence: string, limit: number): Promise<OutputPage> {
    return this.#delegate.readOutputsAfter(runId, sequence, limit);
  }

  async readAggregatesAfter(
    runId: string,
    aggregateId: string,
    limit: number,
  ): Promise<AggregatePage<EarningsClusterState>> {
    return this.#delegate.readAggregatesAfter(runId, aggregateId, limit);
  }
}

type MutableCommit = {
  cursor: Record<string, JsonValue>;
  aggregate: Record<string, JsonValue>;
  outputs: Array<Record<string, JsonValue>>;
};

function mutableCommit(value: ProcessingCommit<EarningsClusterState>): MutableCommit {
  return cloneJson(value as unknown as JsonValue) as unknown as MutableCommit;
}

function sealedCursor(value: MutableCommit): void {
  const cursor = value.cursor as unknown as Omit<RunCursor, "cursorHash">;
  const { cursorHash: _ignored, ...withoutHash } = cursor as RunCursor;
  value.cursor["cursorHash"] = computeRunCursorHash(withoutHash);
}

function sealedAggregate(value: MutableCommit): void {
  const checkpoint = value.aggregate as unknown as AggregateCheckpoint<EarningsClusterState>;
  const { checkpointHash: _ignored, ...withoutHash } = checkpoint;
  value.aggregate["checkpointHash"] = computeAggregateCheckpointHash(withoutHash);
}

test("processing commit verification rejects independently corrupted cursor, state, and outputs", async () => {
  const scenario = await captureScenario();
  const first = scenario.events[0];
  assert.ok(first);
  const eventLog = new CapturedEventLog([first]);
  const store = new CapturingStore(eventLog);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest: scenario.manifest,
  });
  await processor.process(first);
  const commit = store.lastCommit;
  assert.ok(commit);
  const registration = processor.registration;

  const assertMutation = (mutate: (value: MutableCommit) => void, expected: RegExp): void => {
    const value = mutableCommit(commit);
    mutate(value);
    assert.throws(
      () =>
        verifyProcessingCommit(
          value as unknown as ProcessingCommit<EarningsClusterState>,
          registration,
        ),
      expected,
    );
  };

  assertMutation((value) => {
    value.cursor["cursorHash"] = "0".repeat(64);
  }, /cursor hash mismatch/u);
  assertMutation((value) => {
    value.cursor["manifestHash"] = "0".repeat(64);
    sealedCursor(value);
  }, /immutable run manifest/u);
  assertMutation((value) => {
    value.cursor["processedPosition"] = "99";
    sealedCursor(value);
  }, /input event/u);
  assertMutation((value) => {
    value.aggregate["checkpointHash"] = "0".repeat(64);
  }, /checkpoint hash mismatch/u);
  assertMutation((value) => {
    value.aggregate["runId"] = "wrong-run";
    sealedAggregate(value);
  }, /input event or run/u);
  assertMutation((value) => {
    const state = value.aggregate["state"];
    if (state === null || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("Aggregate state is missing");
    }
    (state as Record<string, JsonValue>)["rejectionCount"] = 999;
  }, /state hash mismatch/u);
  assertMutation((value) => {
    const output = value.outputs[0];
    if (output === undefined) throw new Error("Decision output is missing");
    output["runId"] = "wrong-run";
  }, /Output metadata/u);
  assertMutation((value) => {
    const output = value.outputs[0];
    if (output === undefined) throw new Error("Decision output is missing");
    output["bodyHash"] = "0".repeat(64);
  }, /Output body hash/u);
  assertMutation((value) => {
    const output = value.outputs[0];
    if (output === undefined) throw new Error("Decision output is missing");
    output["outputId"] = "0".repeat(64);
  }, /Output ID integrity/u);
});

test("processor construction and page boundaries reject invalid runtime contracts", async () => {
  const emptyLog = new CapturedEventLog([]);
  const store = new InMemoryProcessingStore<EarningsClusterState>(emptyLog);
  const reducer = new EarningsClusterReducer();
  const base = makeManifest("processor-validation", "research", false);

  assert.throws(
    () =>
      new DeterministicProcessor({
        reducer,
        store,
        eventLog: emptyLog,
        manifest: { ...base, behavior: { ...base.behavior, reducerName: "wrong" } },
      }),
    /reducer name/u,
  );
  assert.throws(
    () =>
      new DeterministicProcessor({
        reducer,
        store,
        eventLog: emptyLog,
        manifest: { ...base, behavior: { ...base.behavior, reducerVersion: "wrong" } },
      }),
    /reducer version/u,
  );
  assert.throws(
    () =>
      new DeterministicProcessor({
        reducer,
        store,
        eventLog: emptyLog,
        manifest: {
          ...base,
          behavior: {
            ...base.behavior,
            identities: { ...base.behavior.identities, extractorVersion: "" },
          },
        },
      }),
    /Extractor version/u,
  );

  const processor = new DeterministicProcessor({
    reducer,
    store,
    eventLog: emptyLog,
    manifest: base,
  });
  assert.equal(processor.registration.manifest.runId, base.runId);
  await assert.rejects(() => processor.snapshot(0), /Page limit/u);
  await assert.rejects(() => processor.processAvailable(10_001), /Page limit/u);
});

test("processor rejects position gaps and a validly rehashed logical-clock regression", async () => {
  const scenario = await captureScenario();
  const first = scenario.events[0];
  const second = scenario.events[1];
  assert.ok(first);
  assert.ok(second);

  const gapLog = new CapturedEventLog(scenario.events.slice(0, 2));
  const gapProcessor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: new InMemoryProcessingStore<EarningsClusterState>(gapLog),
    eventLog: gapLog,
    manifest: makeManifest("processor-gap", "research", false),
  });
  await assert.rejects(() => gapProcessor.process(second), /Non-contiguous/u);

  const regressedCaptured = {
    ...second,
    logicalAtMs: first.logicalAtMs - 1,
  };
  const contentHash = computeContentHash(regressedCaptured);
  const withoutEventHash = {
    ...regressedCaptured,
    contentHash,
    previousEventHash: first.eventHash,
  };
  const regressed: StoredEvent = {
    ...withoutEventHash,
    eventHash: computeEventHash(withoutEventHash),
  };
  const regressionLog = new CapturedEventLog([first, regressed]);
  const regressionProcessor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: new InMemoryProcessingStore<EarningsClusterState>(regressionLog),
    eventLog: regressionLog,
    manifest: makeManifest("processor-regression", "research", false),
  });
  await regressionProcessor.process(first);
  await assert.rejects(() => regressionProcessor.process(regressed), /Logical clock regression/u);
  const cursor = await regressionProcessor.process(first);
  assert.equal(cursor.processedPosition, "1");
});

test("processor verifies older envelopes before returning an idempotent cursor", async () => {
  const scenario = await captureScenario();
  const first = scenario.events[0];
  const second = scenario.events[1];
  assert.ok(first);
  assert.ok(second);

  const eventLog = new CapturedEventLog([first, second]);
  const store = new InMemoryProcessingStore<EarningsClusterState>(eventLog);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest: makeManifest("processor-idempotency-integrity", "research", false),
  });
  await processor.process(first);
  const processed = await processor.process(second);
  const before = await processor.snapshot();

  const hashTampered: StoredEvent = { ...first, eventHash: "0".repeat(64) };
  await assert.rejects(() => processor.process(hashTampered), /Event hash mismatch/u);

  const contentTampered: StoredEvent = {
    ...first,
    payload: { ...first.payload, auditTamper: true },
  };
  await assert.rejects(() => processor.process(contentTampered), /Content hash mismatch/u);

  const wrongPredecessorWithoutHash = {
    ...second,
    previousEventHash: "f".repeat(64),
  };
  const wrongPredecessor: StoredEvent = {
    ...wrongPredecessorWithoutHash,
    eventHash: computeEventHash(wrongPredecessorWithoutHash),
  };
  await assert.rejects(() => processor.process(wrongPredecessor), /Event chain mismatch/u);

  const rehashedContent = {
    ...first,
    payload: { ...first.payload, internallyValidButUnpersisted: true },
  };
  const rehashedContentHash = computeContentHash(rehashedContent);
  const rehashedWithoutEventHash = {
    ...rehashedContent,
    contentHash: rehashedContentHash,
  };
  const rehashedButUnpersisted: StoredEvent = {
    ...rehashedWithoutEventHash,
    eventHash: computeEventHash(rehashedWithoutEventHash),
  };
  await assert.rejects(
    () => processor.process(rehashedButUnpersisted),
    /not the exact persisted event/u,
  );

  assert.deepEqual(await processor.process(first), processed);
  assert.deepEqual(await processor.process(second), processed);
  assert.deepEqual(await processor.snapshot(), before);
});
