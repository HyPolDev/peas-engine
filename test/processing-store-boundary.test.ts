import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import { draftFromStored, type EventLog, type StoredEvent } from "../src/core/event.js";
import { canonicalHash, hashParts } from "../src/core/hash.js";
import { canonicalJson, cloneJson, type JsonObject, type JsonValue } from "../src/core/json.js";
import {
  type AggregateCheckpoint,
  type AggregatePage,
  computeAggregateCheckpointHash,
  computeOutputDedupeIdentity,
  computeRunCursorHash,
  createGenesisRunCursor,
  DeterministicProcessor,
  deriveJobId,
  deriveRunRegistration,
  type OutputPage,
  type ProcessingCommit,
  type ProcessingStore,
  type Reducer,
  type RunCursor,
  type RunManifest,
  type RunRegistration,
  validateAggregateCheckpoint,
  validateRunManifest,
  verifyProcessingCommit,
  verifyProcessingTransition,
} from "../src/core/processor.js";
import {
  type EarningsClusterConfig,
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { captureScenario, makeManifest } from "./scenario.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));

class CommitCapturingStore implements ProcessingStore<EarningsClusterState> {
  readonly #delegate: InMemoryProcessingStore<EarningsClusterState>;
  readonly commits: ProcessingCommit<EarningsClusterState>[] = [];

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
    this.commits.push(
      cloneJson(value as unknown as JsonValue) as ProcessingCommit<EarningsClusterState>,
    );
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

function mutableObject(value: JsonValue | undefined, label: string): Record<string, JsonValue> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, JsonValue>;
}

function invalidManifests(
  base: RunManifest<EarningsClusterConfig>,
): readonly Record<string, JsonValue>[] {
  const mutate = (change: (manifest: Record<string, JsonValue>) => void) => {
    const manifest = cloneJson(base as unknown as JsonValue) as Record<string, JsonValue>;
    change(manifest);
    return manifest;
  };
  return [
    mutate((manifest) => {
      manifest["manifestVersion"] = 99;
    }),
    mutate((manifest) => {
      manifest["canonicalizationVersion"] = "not-peas";
    }),
    mutate((manifest) => {
      manifest["unsupportedField"] = true;
    }),
    mutate((manifest) => {
      mutableObject(manifest["behavior"], "behavior")["unsupportedField"] = true;
    }),
    mutate((manifest) => {
      const behavior = mutableObject(manifest["behavior"], "behavior");
      mutableObject(behavior["identities"], "identities")["unsupportedField"] = true;
    }),
    mutate((manifest) => {
      let configuration: JsonObject = { terminal: true };
      for (let depth = 0; depth < 32; depth += 1) configuration = { next: configuration };
      mutableObject(manifest["behavior"], "behavior")["configuration"] = configuration;
    }),
  ];
}

function uncheckedRegistration(manifest: Record<string, JsonValue>): RunRegistration {
  return {
    manifest: manifest as unknown as RunManifest,
    manifestHash: canonicalHash("peas/run-manifest/v2", manifest),
    behaviorHash: canonicalHash(
      "peas/run-behavior/v2",
      mutableObject(manifest["behavior"], "behavior"),
    ),
  };
}

async function assertStrictRegistrationBoundary(
  store: ProcessingStore<EarningsClusterState>,
): Promise<void> {
  const base = makeManifest("strict-registration", "research", false);
  let accessorCalls = 0;
  const accessorManifest = { ...base } as Record<string, unknown>;
  Object.defineProperty(accessorManifest, "behavior", {
    enumerable: true,
    get: () => {
      accessorCalls += 1;
      return base.behavior;
    },
  });
  assert.throws(() => validateRunManifest(accessorManifest), /accessor property/u);
  assert.equal(accessorCalls, 0);

  let hiddenBehaviorCalls = 0;
  const hiddenBehaviorManifest = { ...base } as Record<string, unknown>;
  Object.defineProperty(hiddenBehaviorManifest, "behavior", {
    enumerable: false,
    get: () => {
      hiddenBehaviorCalls += 1;
      return base.behavior;
    },
  });
  assert.throws(
    () => validateRunManifest(hiddenBehaviorManifest),
    /non-enumerable|accessor property/u,
  );
  assert.equal(hiddenBehaviorCalls, 0);

  const inheritedBehaviorManifest = { ...base } as Record<string, unknown>;
  delete inheritedBehaviorManifest["behavior"];
  let inheritedBehaviorReads = 0;
  Object.defineProperty(Object.prototype, "behavior", {
    configurable: true,
    get() {
      inheritedBehaviorReads += 1;
      return base.behavior;
    },
  });
  try {
    assert.throws(
      () => validateRunManifest(inheritedBehaviorManifest),
      /Object\.prototype contains schema field behavior/u,
    );
    assert.equal(inheritedBehaviorReads, 0);
  } finally {
    delete (Object.prototype as Record<string, unknown>)["behavior"];
  }

  let proxyReads = 0;
  const proxyManifest = new Proxy(base, {
    get: (target, property, receiver) => {
      proxyReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.throws(() => validateRunManifest(proxyManifest), /cannot be a Proxy/u);
  assert.equal(proxyReads, 0);

  for (const invalid of invalidManifests(base)) {
    assert.throws(() => validateRunManifest(invalid));
    assert.throws(
      () =>
        new DeterministicProcessor({
          reducer: new EarningsClusterReducer(),
          store,
          eventLog: new CapturedEventLog([]),
          manifest: invalid as unknown as RunManifest<EarningsClusterConfig>,
        }),
    );
    await assert.rejects(() => store.ensureRun(uncheckedRegistration(invalid)));
  }

  let pathologicalConfiguration: JsonObject = { terminal: true };
  for (let depth = 0; depth < 10_000; depth += 1) {
    pathologicalConfiguration = { next: pathologicalConfiguration };
  }
  const pathologicalManifest = {
    ...base,
    behavior: { ...base.behavior, configuration: pathologicalConfiguration },
  } as unknown as RunManifest;
  assert.throws(() => validateRunManifest(pathologicalManifest), /depth limit/u);
  await assert.rejects(
    () =>
      store.ensureRun({
        manifest: pathologicalManifest,
        manifestHash: "0".repeat(64),
        behaviorHash: "0".repeat(64),
      }),
    /depth limit/u,
  );

  const valid = deriveRunRegistration(base);
  let registrationAccessorCalls = 0;
  const accessorRegistration = { ...valid } as Record<string, unknown>;
  Object.defineProperty(accessorRegistration, "manifest", {
    enumerable: true,
    get: () => {
      registrationAccessorCalls += 1;
      return valid.manifest;
    },
  });
  await assert.rejects(
    () => store.ensureRun(accessorRegistration as unknown as RunRegistration),
    /accessor property/u,
  );
  assert.equal(registrationAccessorCalls, 0);

  let registrationProxyReads = 0;
  const proxyRegistration = new Proxy(valid, {
    get: (target, property, receiver) => {
      registrationProxyReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  await assert.rejects(() => store.ensureRun(proxyRegistration), /cannot be a Proxy/u);
  assert.equal(registrationProxyReads, 0);

  await assert.rejects(
    () => store.ensureRun({ ...valid, manifestHash: "0".repeat(64) }),
    /Run manifest hash mismatch/u,
  );
  await assert.rejects(
    () => store.ensureRun({ ...valid, behaviorHash: "f".repeat(64) }),
    /Run behavior hash mismatch/u,
  );
  await store.ensureRun(valid);
}

async function captureFirstTwoCommits(
  events: readonly StoredEvent[],
  manifest: RunManifest<EarningsClusterConfig>,
): Promise<
  readonly [ProcessingCommit<EarningsClusterState>, ProcessingCommit<EarningsClusterState>]
> {
  const eventLog = new CapturedEventLog(events);
  const store = new CommitCapturingStore(eventLog);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest,
  });
  const first = events[0];
  const second = events[1];
  assert.ok(first);
  assert.ok(second);
  await processor.process(first);
  await processor.process(second);
  const firstCommit = store.commits[0];
  const secondCommit = store.commits[1];
  assert.ok(firstCommit);
  assert.ok(secondCommit);
  return [firstCommit, secondCommit];
}

function skippedCommit(
  template: ProcessingCommit<EarningsClusterState>,
  event: StoredEvent,
  registration: RunRegistration,
): ProcessingCommit<EarningsClusterState> {
  const { checkpointHash: _checkpointHash, ...templateAggregate } = template.aggregate;
  const aggregateWithoutHash = {
    ...templateAggregate,
    version: "1",
    lastInputPosition: event.position,
  } satisfies Omit<AggregateCheckpoint<EarningsClusterState>, "checkpointHash">;
  const aggregate = {
    ...aggregateWithoutHash,
    checkpointHash: computeAggregateCheckpointHash(aggregateWithoutHash),
  };
  const genesis = createGenesisRunCursor(registration);
  const cursorWithoutHash = {
    runId: registration.manifest.runId,
    manifestHash: registration.manifestHash,
    behaviorHash: registration.behaviorHash,
    processedPosition: event.position,
    logicalAtMs: event.logicalAtMs,
    lastEventHash: event.eventHash,
    stateHead: hashParts(
      "peas/state-head/step/v2",
      genesis.stateHead,
      event.eventHash,
      aggregate.aggregateId,
      aggregate.stateHash,
    ),
    decisionHead: hashParts(
      "peas/decision-head/step/v2",
      genesis.decisionHead,
      event.eventHash,
      canonicalJson([]),
    ),
  } satisfies Omit<RunCursor, "cursorHash">;
  return {
    expectedPosition: "0",
    event,
    cursor: { ...cursorWithoutHash, cursorHash: computeRunCursorHash(cursorWithoutHash) },
    aggregate,
    outputs: [],
  };
}

function resealCursor(cursor: RunCursor, changes: Partial<RunCursor>): RunCursor {
  const { cursorHash: _cursorHash, ...withoutHash } = { ...cursor, ...changes };
  return { ...withoutHash, cursorHash: computeRunCursorHash(withoutHash) };
}

type MutableAdversarialCommit = {
  expectedPosition: string;
  event: StoredEvent;
  cursor: Record<string, JsonValue>;
  aggregate: Record<string, JsonValue>;
  outputs: Array<Record<string, JsonValue>>;
};

function stringValue(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function mutableAdversarialCommit(
  value: ProcessingCommit<EarningsClusterState>,
): MutableAdversarialCommit {
  return cloneJson(value as unknown as JsonValue) as unknown as MutableAdversarialCommit;
}

function resealAdversarialCommit(
  value: MutableAdversarialCommit,
  registration: RunRegistration,
): ProcessingCommit<EarningsClusterState> {
  const aggregateState = value.aggregate["state"];
  if (aggregateState === undefined) throw new Error("Aggregate state is missing");
  const aggregateId = stringValue(value.aggregate["aggregateId"], "Aggregate ID");
  const stateHash = canonicalHash(
    `peas/state/${registration.manifest.behavior.reducerName}/${registration.manifest.behavior.reducerVersion}`,
    aggregateState,
  );
  value.aggregate["stateHash"] = stateHash;
  const { checkpointHash: _checkpointHash, ...aggregateWithoutHash } = value.aggregate;
  value.aggregate["checkpointHash"] = computeAggregateCheckpointHash(
    aggregateWithoutHash as unknown as Omit<
      AggregateCheckpoint<EarningsClusterState>,
      "checkpointHash"
    >,
  );

  for (const output of value.outputs) {
    const category = stringValue(output["category"], "Output category");
    const body = mutableObject(output["body"], "Output body");
    const bodyHash = canonicalHash(`peas/output-body/${category}/v2`, body);
    output["bodyHash"] = bodyHash;
    output["outputId"] = canonicalHash("peas/output-id/v2", {
      runId: stringValue(output["runId"], "Output run ID"),
      manifestHash: registration.manifestHash,
      inputEventHash: value.event.eventHash,
      aggregateId: stringValue(output["aggregateId"], "Output aggregate ID"),
      category,
      ordinal: output["ordinal"] ?? null,
      bodyHash,
    });
  }

  const genesis = createGenesisRunCursor(registration);
  value.cursor["stateHead"] = hashParts(
    "peas/state-head/step/v2",
    genesis.stateHead,
    value.event.eventHash,
    aggregateId,
    stateHash,
  );
  const semanticOutputs = value.outputs.map((output) => ({
    category: output["category"] ?? null,
    ordinal: output["ordinal"] ?? null,
    body: output["body"] ?? null,
    bodyHash: output["bodyHash"] ?? null,
  }));
  value.cursor["decisionHead"] = hashParts(
    "peas/decision-head/step/v2",
    genesis.decisionHead,
    value.event.eventHash,
    canonicalJson(semanticOutputs),
  );
  const { cursorHash: _cursorHash, ...cursorWithoutHash } = value.cursor;
  value.cursor["cursorHash"] = computeRunCursorHash(
    cursorWithoutHash as unknown as Omit<RunCursor, "cursorHash">,
  );
  return value as unknown as ProcessingCommit<EarningsClusterState>;
}

async function memoryBoundaryState(
  store: ProcessingStore<EarningsClusterState>,
  runId: string,
  aggregateId: string,
): Promise<string> {
  return canonicalJson({
    cursor: (await store.loadCursor(runId)) ?? null,
    aggregate: (await store.loadAggregate(runId, aggregateId)) ?? null,
    outputs: await store.readOutputsAfter(runId, "0", 100),
  });
}

function sqliteBoundaryRows(database: ReturnType<typeof openSqliteDatabase>): Readonly<object> {
  return {
    cursors: database.prepare("SELECT * FROM run_cursors ORDER BY run_id").all(),
    aggregates: database
      .prepare("SELECT * FROM aggregate_checkpoints ORDER BY run_id, aggregate_id")
      .all(),
    outputs: database.prepare("SELECT * FROM processing_outputs ORDER BY sequence").all(),
    jobs: database.prepare("SELECT * FROM jobs ORDER BY output_id").all(),
    outbox: database.prepare("SELECT * FROM outbox ORDER BY output_id").all(),
  };
}

test("strict V2 manifests and recomputed registration hashes are enforced by both stores", async () => {
  await assertStrictRegistrationBoundary(
    new InMemoryProcessingStore<EarningsClusterState>(new CapturedEventLog([])),
  );

  const database = openSqliteDatabase(":memory:", migrations);
  try {
    const store = new SqliteProcessingStore<EarningsClusterState>(database);
    await assertStrictRegistrationBoundary(store);
    const rows = database.prepare("SELECT count(*) AS count FROM run_manifests").get() as {
      count: bigint;
    };
    assert.equal(rows.count, 1n);
  } finally {
    database.close();
  }
});

test("SQLite rejects a corrupted non-boolean effects flag even if constraints are bypassed", async () => {
  const database = openSqliteDatabase(":memory:", migrations);
  try {
    const store = new SqliteProcessingStore<EarningsClusterState>(database);
    const registration = deriveRunRegistration(
      makeManifest("corrupt-effects-column", "live", true),
    );
    await store.ensureRun(registration);

    database.exec("DROP TRIGGER run_manifests_no_update");
    database.exec("PRAGMA ignore_check_constraints = ON");
    database
      .prepare("UPDATE run_manifests SET effects_allowed = 2 WHERE run_id = ?")
      .run(registration.manifest.runId);

    await assert.rejects(
      () => store.ensureRun(registration),
      /Stored run effects-allowed column is invalid/u,
    );
  } finally {
    database.close();
  }
});

test("processor rejects pathological initial aggregate state before hashing or committing", async () => {
  const scenario = await captureScenario();
  const event = scenario.events[0];
  assert.ok(event);
  const eventLog = new CapturedEventLog([event]);
  const store = new InMemoryProcessingStore<JsonObject>(eventLog);
  const manifest = makeManifest("pathological-initial-state", "research", false);
  let parseStateCalls = 0;
  const reducer: Reducer<JsonObject, EarningsClusterConfig> = {
    name: manifest.behavior.reducerName,
    version: manifest.behavior.reducerVersion,
    route: () => "pathological-aggregate",
    parseState: (value) => {
      parseStateCalls += 1;
      return value as JsonObject;
    },
    initialState: () => {
      let state: JsonObject = { terminal: true };
      for (let depth = 0; depth < 10_000; depth += 1) state = { next: state };
      return state;
    },
    apply: () => {
      throw new Error("Pathological genesis must be rejected before apply");
    },
  };
  const processor = new DeterministicProcessor({ reducer, store, eventLog, manifest });

  await assert.rejects(() => processor.process(event), /depth limit/u);
  assert.equal(parseStateCalls, 0, "raw state must be bounded before reducer parsing");
  assert.equal(await store.loadCursor(manifest.runId), undefined);
  assert.equal(await store.loadAggregate(manifest.runId, "pathological-aggregate"), undefined);
  assert.deepEqual(await store.readOutputsAfter(manifest.runId, "0", 100), {
    outputs: [],
    nextSequence: "0",
    hasMore: false,
  });
});

test("processing transition verification binds every cursor-continuity field", async () => {
  const scenario = await captureScenario();
  const manifest = makeManifest("transition-contract", "research", false);
  const registration = deriveRunRegistration(manifest);
  const [first, second] = await captureFirstTwoCommits(scenario.events, manifest);
  const genesis = createGenesisRunCursor(registration);
  assert.doesNotThrow(() => verifyProcessingTransition(first, registration, genesis));
  assert.doesNotThrow(() => verifyProcessingTransition(second, registration, first.cursor));

  assert.throws(
    () =>
      verifyProcessingTransition({ ...second, expectedPosition: "0" }, registration, first.cursor),
    /expected position/u,
  );
  assert.throws(
    () =>
      verifyProcessingTransition(
        second,
        registration,
        resealCursor(first.cursor, { lastEventHash: "f".repeat(64) }),
      ),
    /Event chain mismatch/u,
  );
  assert.throws(
    () =>
      verifyProcessingTransition(
        second,
        registration,
        resealCursor(first.cursor, { logicalAtMs: second.event.logicalAtMs + 1 }),
      ),
    /Logical clock regression/u,
  );
  assert.throws(
    () =>
      verifyProcessingTransition(
        {
          ...second,
          cursor: resealCursor(second.cursor, { stateHead: "0".repeat(64) }),
        },
        registration,
        first.cursor,
      ),
    /state head/u,
  );
  assert.throws(
    () =>
      verifyProcessingTransition(
        {
          ...second,
          cursor: resealCursor(second.cursor, { decisionHead: "0".repeat(64) }),
        },
        registration,
        first.cursor,
      ),
    /decision head/u,
  );
});

test("processing schemas reject inherited required fields without invoking prototype behavior", async () => {
  const scenario = await captureScenario();
  const manifest = makeManifest("inherited-commit-field", "research", false);
  const registration = deriveRunRegistration(manifest);
  const [template] = await captureFirstTwoCommits(scenario.events, manifest);
  const candidate = cloneJson(template as unknown as JsonValue) as unknown as Record<
    string,
    unknown
  >;
  delete candidate["outputs"];
  let inheritedReads = 0;
  Object.defineProperty(Object.prototype, "outputs", {
    configurable: true,
    get() {
      inheritedReads += 1;
      return template.outputs;
    },
  });
  try {
    assert.throws(
      () =>
        verifyProcessingCommit(
          candidate as unknown as ProcessingCommit<EarningsClusterState>,
          registration,
        ),
      /Object\.prototype contains schema field outputs/u,
    );
    assert.equal(inheritedReads, 0);
  } finally {
    delete (Object.prototype as Record<string, unknown>)["outputs"];
  }
});

test("aggregate checkpoint shape permits only exact genesis or committed position pairs", async () => {
  const scenario = await captureScenario();
  const manifest = makeManifest("checkpoint-position-pairs", "research", false);
  const [template] = await captureFirstTwoCommits(scenario.events, manifest);
  assert.throws(
    () => validateAggregateCheckpoint({ ...template.aggregate, version: "0" }),
    /exact 0\/0 genesis or positive\/positive/u,
  );
  assert.throws(
    () => validateAggregateCheckpoint({ ...template.aggregate, lastInputPosition: "0" }),
    /exact 0\/0 genesis or positive\/positive/u,
  );
  assert.doesNotThrow(() =>
    validateAggregateCheckpoint({
      ...template.aggregate,
      version: "0",
      lastInputPosition: "0",
    }),
  );
});

test("a self-consistent skipped commit fails atomically in memory and SQLite", async () => {
  const scenario = await captureScenario();
  const third = scenario.events[2];
  assert.ok(third);
  const manifest = makeManifest("skipped-store-commit", "research", false);
  const registration = deriveRunRegistration(manifest);
  const [template] = await captureFirstTwoCommits(scenario.events, manifest);
  const skipped = skippedCommit(template, third, registration);
  assert.doesNotThrow(() => verifyProcessingCommit(skipped, registration));

  const memoryStore = new InMemoryProcessingStore<EarningsClusterState>(
    new CapturedEventLog(scenario.events),
  );
  await memoryStore.ensureRun(registration);
  const memoryBefore = {
    cursor: await memoryStore.loadCursor(manifest.runId),
    aggregate: await memoryStore.loadAggregate(manifest.runId, skipped.aggregate.aggregateId),
    outputs: await memoryStore.readOutputsAfter(manifest.runId, "0", 100),
  };
  await assert.rejects(() => memoryStore.commit(skipped), /Non-contiguous processing position/u);
  assert.deepEqual(
    {
      cursor: await memoryStore.loadCursor(manifest.runId),
      aggregate: await memoryStore.loadAggregate(manifest.runId, skipped.aggregate.aggregateId),
      outputs: await memoryStore.readOutputsAfter(manifest.runId, "0", 100),
    },
    memoryBefore,
  );

  const database = openSqliteDatabase(":memory:", migrations);
  try {
    const first = scenario.events[0];
    assert.ok(first);
    const clock = new ManualClock(first.receivedAtMs);
    const eventLog = new SqliteEventLog(database, { clock });
    for (const event of scenario.events) {
      clock.advanceTo(event.receivedAtMs);
      const appended = await eventLog.append(draftFromStored(event));
      assert.deepEqual(appended.event, event);
    }
    const store = new SqliteProcessingStore<EarningsClusterState>(database);
    await store.ensureRun(registration);
    const counts = () =>
      database
        .prepare(
          `SELECT
             (SELECT count(*) FROM run_cursors) AS cursors,
             (SELECT count(*) FROM aggregate_checkpoints) AS aggregates,
             (SELECT count(*) FROM processing_outputs) AS outputs,
             (SELECT count(*) FROM jobs) AS jobs,
             (SELECT count(*) FROM outbox) AS outbox`,
        )
        .get();
    const before = counts();
    await assert.rejects(() => store.commit(skipped), /Non-contiguous processing position/u);
    assert.deepEqual(counts(), before);
    assert.equal(await store.loadCursor(manifest.runId), undefined);
    assert.equal(
      await store.loadAggregate(manifest.runId, skipped.aggregate.aggregateId),
      undefined,
    );
  } finally {
    database.close();
  }
});

test("the memory store rejects an identical malformed event returned by a custom event log", async () => {
  const scenario = await captureScenario();
  const manifest = makeManifest("malformed-memory-event", "research", false);
  const registration = deriveRunRegistration(manifest);
  const [template] = await captureFirstTwoCommits(scenario.events, manifest);

  for (const [name, mutate] of [
    [
      "unsupported envelope version",
      (event: Record<string, unknown>) => {
        event["envelopeVersion"] = 99;
      },
    ],
    [
      "malformed content hash",
      (event: Record<string, unknown>) => {
        event["contentHash"] = "not-a-hash";
      },
    ],
  ] as const) {
    const malformed = cloneJson(
      template as unknown as JsonValue,
    ) as ProcessingCommit<EarningsClusterState>;
    mutate(malformed.event as unknown as Record<string, unknown>);
    const eventLog: EventLog = {
      append: async () => {
        throw new Error("append is not used by this regression");
      },
      get: async () => malformed.event,
      readAfter: async (position) => ({ events: [], nextPosition: position, hasMore: false }),
    };
    const store = new InMemoryProcessingStore<EarningsClusterState>(eventLog);
    await store.ensureRun(registration);

    await assert.rejects(() => store.commit(malformed), name);
    assert.equal(await store.loadCursor(manifest.runId), undefined, name);
    assert.equal(
      await store.loadAggregate(manifest.runId, template.aggregate.aggregateId),
      undefined,
      name,
    );
    assert.deepEqual(await store.readOutputsAfter(manifest.runId, "0", 100), {
      outputs: [],
      nextSequence: "0",
      hasMore: false,
    });
  }
});

test("adversarial output transcripts and aggregate envelopes fail atomically in both stores", async () => {
  const scenario = await captureScenario();
  const manifest = makeManifest("adversarial-processing-commit", "research", false);
  const registration = deriveRunRegistration(manifest);
  const [template] = await captureFirstTwoCommits(scenario.events, manifest);

  const nestedObject = (additionalDepth: number): JsonObject => {
    let value: JsonObject = { leaf: true };
    for (let depth = 0; depth < additionalDepth; depth += 1) value = { next: value };
    return value;
  };
  const findOutputs = (
    value: MutableAdversarialCommit,
    category: string,
  ): Array<Record<string, JsonValue>> =>
    value.outputs.filter((output) => output["category"] === category);

  const invalidCases: readonly Readonly<{
    name: string;
    expected: RegExp;
    reseal?: boolean;
    mutate(value: MutableAdversarialCommit): void;
  }>[] = [
    {
      name: "unknown commit envelope field",
      expected: /unrecognized|Unrecognized/u,
      mutate: (value) => {
        (value as unknown as Record<string, JsonValue>)["unsupportedCommitField"] = true;
      },
    },
    {
      name: "identical duplicate output ID",
      expected: /Duplicate output ID/u,
      mutate: (value) => {
        const output = value.outputs.at(-1);
        if (output === undefined) throw new Error("Output fixture is empty");
        value.outputs.push(cloneJson(output as unknown as JsonValue) as Record<string, JsonValue>);
      },
    },
    {
      name: "unsupported category",
      expected: /Unsupported output category/u,
      mutate: (value) => {
        const output = value.outputs[0];
        if (output === undefined) throw new Error("Decision fixture is missing");
        output["category"] = "unknown";
      },
    },
    {
      name: "unknown cursor envelope field",
      expected: /unrecognized|Unrecognized/u,
      mutate: (value) => {
        value.cursor["unsupportedCursorField"] = true;
      },
    },
    {
      name: "unknown aggregate envelope field",
      expected: /unrecognized|Unrecognized/u,
      mutate: (value) => {
        value.aggregate["unsupportedAggregateField"] = true;
      },
    },
    {
      name: "unknown output envelope field",
      expected: /unrecognized|Unrecognized/u,
      mutate: (value) => {
        const output = value.outputs[0];
        if (output === undefined) throw new Error("Output fixture is missing");
        output["unsupportedOutputField"] = true;
      },
    },
    {
      name: "unknown job body field",
      expected: /unrecognized|Unrecognized/u,
      mutate: (value) => {
        const job = value.outputs.find((output) => output["category"] === "job");
        if (job === undefined) throw new Error("Job fixture is missing");
        mutableObject(job["body"], "Job body")["unsupportedBodyField"] = true;
      },
    },
    {
      name: "category reorder",
      expected: /canonical decision, job, outbox category order/u,
      mutate: (value) => {
        const first = value.outputs[0];
        const second = value.outputs[1];
        if (first === undefined || second === undefined) throw new Error("Output fixtures missing");
        value.outputs[0] = second;
        value.outputs[1] = first;
      },
    },
    {
      name: "ordinal reorder",
      expected: /Non-contiguous job output ordinal/u,
      mutate: (value) => {
        const jobs = findOutputs(value, "job");
        const first = jobs[0];
        const second = jobs[1];
        if (first === undefined || second === undefined) throw new Error("Job fixtures missing");
        const firstIndex = value.outputs.indexOf(first);
        const secondIndex = value.outputs.indexOf(second);
        value.outputs[firstIndex] = second;
        value.outputs[secondIndex] = first;
      },
    },
    {
      name: "ordinal gap",
      expected: /Non-contiguous job output ordinal/u,
      mutate: (value) => {
        const job = findOutputs(value, "job")[1];
        if (job === undefined) throw new Error("Second job fixture missing");
        job["ordinal"] = 7;
      },
    },
    {
      name: "duplicate ordinal",
      expected: /Non-contiguous job output ordinal/u,
      mutate: (value) => {
        const job = findOutputs(value, "job")[1];
        if (job === undefined) throw new Error("Second job fixture missing");
        job["ordinal"] = 0;
      },
    },
    {
      name: "negative ordinal",
      expected: /non-negative safe integer|greater than or equal to 0|Too small/u,
      mutate: (value) => {
        const job = findOutputs(value, "job")[0];
        if (job === undefined) throw new Error("Job fixture missing");
        job["ordinal"] = -1;
      },
    },
    {
      name: "unsafe ordinal",
      expected: /safe integer/u,
      reseal: false,
      mutate: (value) => {
        const job = findOutputs(value, "job")[0];
        if (job === undefined) throw new Error("Job fixture missing");
        job["ordinal"] = Number.MAX_SAFE_INTEGER + 1;
      },
    },
    {
      name: "duplicate category dedupe identity",
      expected: /Duplicate job dedupe key/u,
      mutate: (value) => {
        const jobs = findOutputs(value, "job");
        const first = jobs[0];
        const second = jobs[1];
        if (first === undefined || second === undefined) throw new Error("Job fixtures missing");
        const dedupeKey = stringValue(first["dedupeKey"], "First job dedupe key");
        second["dedupeKey"] = dedupeKey;
        const body = mutableObject(second["body"], "Second job body");
        const payload = mutableObject(body["payload"], "Second job payload");
        body["dedupeKey"] = dedupeKey;
        body["jobId"] = deriveJobId(manifest.runId, dedupeKey, payload);
      },
    },
    {
      name: "negative job not-before time",
      expected: /Job not-before time must be a non-negative safe integer|Too small/u,
      mutate: (value) => {
        const job = findOutputs(value, "job")[0];
        if (job === undefined) throw new Error("Job fixture missing");
        job["notBeforeLogicalMs"] = -1;
        mutableObject(job["body"], "Job body")["notBeforeLogicalMs"] = -1;
      },
    },
    {
      name: "empty aggregate ID",
      expected: /Aggregate ID must be a non-empty string|Too small/u,
      mutate: (value) => {
        value.aggregate["aggregateId"] = "";
        for (const output of value.outputs) output["aggregateId"] = "";
      },
    },
    ...["unicode-\u{10000}", "unicode-\uE000", "space id", "nul\u0000id"].map((aggregateId) => ({
      name: `non-portable aggregate ID ${JSON.stringify(aggregateId)}`,
      expected: /portable ASCII identifier alphabet/u,
      mutate: (value: MutableAdversarialCommit) => {
        value.aggregate["aggregateId"] = aggregateId;
        for (const output of value.outputs) output["aggregateId"] = aggregateId;
      },
    })),
    {
      name: "non-object aggregate state",
      expected: /Aggregate state must be a JSON object|expected record|inert JSON object/u,
      mutate: (value) => {
        value.aggregate["state"] = [];
      },
    },
    ...["01", "+1", " 1"].map((version) => ({
      name: `non-canonical aggregate version ${JSON.stringify(version)}`,
      expected: /canonical positive decimal integer|Invalid string/u,
      mutate: (value: MutableAdversarialCommit) => {
        value.aggregate["version"] = version;
      },
    })),
    {
      name: "aggregate state beyond shared persisted depth budget",
      expected: /depth limit/u,
      mutate: (value) => {
        value.aggregate["state"] = nestedObject(64);
      },
    },
    {
      name: "output body beyond shared persisted depth budget",
      expected: /depth limit/u,
      mutate: (value) => {
        const decision = findOutputs(value, "decision")[0];
        if (decision === undefined) throw new Error("Decision fixture missing");
        mutableObject(decision["body"], "Decision body")["payload"] = nestedObject(64);
      },
    },
  ];

  const memoryStore = new InMemoryProcessingStore<EarningsClusterState>(
    new CapturedEventLog([template.event]),
  );
  await memoryStore.ensureRun(registration);

  const database = openSqliteDatabase(":memory:", migrations);
  try {
    const clock = new ManualClock(template.event.receivedAtMs);
    const eventLog = new SqliteEventLog(database, { clock });
    const appended = await eventLog.append(draftFromStored(template.event));
    assert.deepEqual(appended.event, template.event);
    const sqliteStore = new SqliteProcessingStore<EarningsClusterState>(database);
    await sqliteStore.ensureRun(registration);

    let hiddenOutputReads = 0;
    const hiddenOutputCommit = { ...template } as Record<string, unknown>;
    Object.defineProperty(hiddenOutputCommit, "outputs", {
      enumerable: false,
      get: () => {
        hiddenOutputReads += 1;
        return hiddenOutputReads === 1 ? [] : template.outputs;
      },
    });
    await assert.rejects(
      () =>
        memoryStore.commit(hiddenOutputCommit as unknown as ProcessingCommit<EarningsClusterState>),
      /non-enumerable|accessor property/u,
    );
    await assert.rejects(
      () =>
        sqliteStore.commit(hiddenOutputCommit as unknown as ProcessingCommit<EarningsClusterState>),
      /non-enumerable|accessor property/u,
    );
    assert.equal(hiddenOutputReads, 0);

    let commitAccessorCalls = 0;
    const accessorCommit = { ...template } as Record<string, unknown>;
    Object.defineProperty(accessorCommit, "event", {
      enumerable: true,
      get: () => {
        commitAccessorCalls += 1;
        return template.event;
      },
    });
    await assert.rejects(
      () => memoryStore.commit(accessorCommit as unknown as ProcessingCommit<EarningsClusterState>),
      /accessor property/u,
    );
    await assert.rejects(
      () => sqliteStore.commit(accessorCommit as unknown as ProcessingCommit<EarningsClusterState>),
      /accessor property/u,
    );
    assert.equal(commitAccessorCalls, 0);

    let commitProxyReads = 0;
    const proxyCommit = new Proxy(template, {
      get: (target, property, receiver) => {
        commitProxyReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    await assert.rejects(() => memoryStore.commit(proxyCommit), /cannot be a Proxy/u);
    await assert.rejects(() => sqliteStore.commit(proxyCommit), /cannot be a Proxy/u);
    assert.equal(commitProxyReads, 0);

    for (const nonportableCursor of ["unicode-\u{10000}", "unicode-\uE000", "nul\u0000id"]) {
      await assert.rejects(
        () => memoryStore.readAggregatesAfter(manifest.runId, nonportableCursor, 1),
        /portable ASCII identifier alphabet/u,
      );
      await assert.rejects(
        () => sqliteStore.readAggregatesAfter(manifest.runId, nonportableCursor, 1),
        /portable ASCII identifier alphabet/u,
      );
      await assert.rejects(
        () => memoryStore.loadAggregate(manifest.runId, nonportableCursor),
        /portable ASCII identifier alphabet/u,
      );
      await assert.rejects(
        () => sqliteStore.loadAggregate(manifest.runId, nonportableCursor),
        /portable ASCII identifier alphabet/u,
      );
    }

    for (const invalidCase of invalidCases) {
      const mutable = mutableAdversarialCommit(template);
      invalidCase.mutate(mutable);
      const invalid =
        invalidCase.reseal === false
          ? (mutable as unknown as ProcessingCommit<EarningsClusterState>)
          : resealAdversarialCommit(mutable, registration);
      assert.throws(
        () => verifyProcessingCommit(invalid, registration),
        invalidCase.expected,
        invalidCase.name,
      );

      const memoryBefore = await memoryBoundaryState(
        memoryStore,
        manifest.runId,
        template.aggregate.aggregateId,
      );
      await assert.rejects(
        () => memoryStore.commit(invalid),
        invalidCase.expected,
        invalidCase.name,
      );
      assert.equal(
        await memoryBoundaryState(memoryStore, manifest.runId, template.aggregate.aggregateId),
        memoryBefore,
        `${invalidCase.name} mutated the in-memory store`,
      );

      const sqliteBefore = sqliteBoundaryRows(database);
      await assert.rejects(
        () => sqliteStore.commit(invalid),
        invalidCase.expected,
        invalidCase.name,
      );
      assert.deepEqual(
        sqliteBoundaryRows(database),
        sqliteBefore,
        `${invalidCase.name} mutated SQLite rows`,
      );
    }

    const rowsBeforeTriggerProbe = sqliteBoundaryRows(database);
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO processing_outputs (
              sequence, output_id, run_id, input_event_id, input_position, aggregate_id,
              category, ordinal, dedupe_key, not_before_logical_ms,
              body_json, body_hash, envelope_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            1n,
            "forged-negative-not-before",
            manifest.runId,
            template.event.eventId,
            BigInt(template.event.position),
            template.aggregate.aggregateId,
            "job",
            0n,
            "forged-dedupe",
            -1n,
            "{}",
            "forged-body-hash",
            "forged-envelope-hash",
          ),
      /job not-before time is not a non-negative safe integer/u,
    );
    assert.deepEqual(sqliteBoundaryRows(database), rowsBeforeTriggerProbe);
  } finally {
    database.close();
  }
});

test("canonical tuple dedupe identities cannot collide across memory or SQLite runs", async () => {
  const oldIdentity = (runId: string, category: string, dedupeKey: string): string =>
    `${runId}\u0000${category}\u0000${dedupeKey}`;
  const left = { runId: "a", category: "job" as const, dedupeKey: "b\u0000job\u0000c" };
  const right = { runId: "a\u0000job\u0000b", category: "job" as const, dedupeKey: "c" };
  assert.equal(
    oldIdentity(left.runId, left.category, left.dedupeKey),
    oldIdentity(right.runId, right.category, right.dedupeKey),
  );
  assert.notEqual(
    computeOutputDedupeIdentity(left.runId, left.category, left.dedupeKey),
    computeOutputDedupeIdentity(right.runId, right.category, right.dedupeKey),
  );

  const scenario = await captureScenario();
  const leftManifest = makeManifest(left.runId, "research", false);
  const rightManifest = makeManifest(right.runId, "research", false);
  const leftRegistration = deriveRunRegistration(leftManifest);
  const rightRegistration = deriveRunRegistration(rightManifest);
  const [leftTemplate] = await captureFirstTwoCommits(scenario.events, leftManifest);
  const [rightTemplate] = await captureFirstTwoCommits(scenario.events, rightManifest);
  const withDedupe = (
    template: ProcessingCommit<EarningsClusterState>,
    registration: RunRegistration,
    dedupeKey: string,
  ): ProcessingCommit<EarningsClusterState> => {
    const mutable = mutableAdversarialCommit(template);
    const job = mutable.outputs.find((output) => output["category"] === "job");
    if (job === undefined) throw new Error("Job fixture is missing");
    job["dedupeKey"] = dedupeKey;
    const body = mutableObject(job["body"], "Job body");
    const payload = mutableObject(body["payload"], "Job payload");
    body["dedupeKey"] = dedupeKey;
    body["jobId"] = deriveJobId(registration.manifest.runId, dedupeKey, payload);
    return resealAdversarialCommit(mutable, registration);
  };
  const leftCommit = withDedupe(leftTemplate, leftRegistration, left.dedupeKey);
  const rightCommit = withDedupe(rightTemplate, rightRegistration, right.dedupeKey);

  const memoryStore = new InMemoryProcessingStore<EarningsClusterState>(
    new CapturedEventLog(scenario.events),
  );
  await memoryStore.ensureRun(leftRegistration);
  await memoryStore.ensureRun(rightRegistration);
  await memoryStore.commit(leftCommit);
  await memoryStore.commit(rightCommit);
  assert.ok((await memoryStore.readOutputsAfter(left.runId, "0", 100)).outputs.length > 0);
  assert.ok((await memoryStore.readOutputsAfter(right.runId, "0", 100)).outputs.length > 0);

  const database = openSqliteDatabase(":memory:", migrations);
  try {
    const first = scenario.events[0];
    assert.ok(first);
    const eventLog = new SqliteEventLog(database, {
      clock: new ManualClock(first.receivedAtMs),
    });
    const appended = await eventLog.append(draftFromStored(first));
    assert.deepEqual(appended.event, first);
    const sqliteStore = new SqliteProcessingStore<EarningsClusterState>(database);
    await sqliteStore.ensureRun(leftRegistration);
    await sqliteStore.ensureRun(rightRegistration);
    await sqliteStore.commit(leftCommit);
    await sqliteStore.commit(rightCommit);
    assert.equal(
      canonicalJson(
        (await sqliteStore.readOutputsAfter(left.runId, "0", 100)) as unknown as JsonValue,
      ),
      canonicalJson(
        (await memoryStore.readOutputsAfter(left.runId, "0", 100)) as unknown as JsonValue,
      ),
    );
    assert.equal(
      canonicalJson(
        (await sqliteStore.readOutputsAfter(right.runId, "0", 100)) as unknown as JsonValue,
      ),
      canonicalJson(
        (await memoryStore.readOutputsAfter(right.runId, "0", 100)) as unknown as JsonValue,
      ),
    );
  } finally {
    database.close();
  }
});

test("SQLite audit reads and claims reject a self-consistently forged negative job time", async () => {
  const scenario = await captureScenario();
  const manifest = makeManifest("negative-job-audit-read", "live", true);
  const registration = deriveRunRegistration(manifest);
  const [template] = await captureFirstTwoCommits(scenario.events, manifest);
  const mutable = mutableAdversarialCommit(template);
  const job = mutable.outputs.find((output) => output["category"] === "job");
  if (job === undefined) throw new Error("Job fixture missing");
  job["notBeforeLogicalMs"] = -1;
  mutableObject(job["body"], "Job body")["notBeforeLogicalMs"] = -1;
  const forged = resealAdversarialCommit(mutable, registration);
  const forgedJob = forged.outputs.find((output) => output.category === "job");
  assert.ok(forgedJob);

  const database = openSqliteDatabase(":memory:", migrations);
  try {
    const clock = new ManualClock(template.event.receivedAtMs);
    const eventLog = new SqliteEventLog(database, { clock });
    const appended = await eventLog.append(draftFromStored(template.event));
    assert.deepEqual(appended.event, template.event);
    const store = new SqliteProcessingStore<EarningsClusterState>(database);
    await store.ensureRun(registration);

    database.exec("DROP TRIGGER processing_outputs_validate_insert");
    const sequence = 1n;
    const envelopeHash = canonicalHash("peas/output-relational-envelope/v2", {
      sequence: sequence.toString(),
      outputId: forgedJob.outputId,
      runId: forgedJob.runId,
      inputEventId: forgedJob.inputEventId,
      inputPosition: forgedJob.inputPosition,
      aggregateId: forgedJob.aggregateId,
      category: forgedJob.category,
      ordinal: forgedJob.ordinal.toString(),
      dedupeKey: forgedJob.dedupeKey,
      notBeforeLogicalMs: "-1",
      bodyHash: forgedJob.bodyHash,
    });
    database
      .prepare(
        `INSERT INTO processing_outputs (
          sequence, output_id, run_id, input_event_id, input_position, aggregate_id,
          category, ordinal, dedupe_key, not_before_logical_ms,
          body_json, body_hash, envelope_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sequence,
        forgedJob.outputId,
        forgedJob.runId,
        forgedJob.inputEventId,
        BigInt(forgedJob.inputPosition),
        forgedJob.aggregateId,
        forgedJob.category,
        BigInt(forgedJob.ordinal),
        forgedJob.dedupeKey,
        -1n,
        canonicalJson(forgedJob.body),
        forgedJob.bodyHash,
        envelopeHash,
      );
    database.prepare("INSERT INTO jobs (output_id) VALUES (?)").run(forgedJob.outputId);

    await assert.rejects(
      () => store.readOutputsAfter(manifest.runId, "0", 100),
      /Output not-before time must be a non-negative safe integer/u,
    );
    await assert.rejects(
      () => store.claimJobs(manifest.runId, "audit-worker", template.event.logicalAtMs, 1_000, 100),
      /Output not-before time must be a non-negative safe integer/u,
    );
    const delivery = database
      .prepare("SELECT status, fencing_token, attempt_count FROM jobs WHERE output_id = ?")
      .get(forgedJob.outputId);
    assert.deepEqual(delivery, { status: "pending", fencing_token: 0n, attempt_count: 0n });
  } finally {
    database.close();
  }
});
