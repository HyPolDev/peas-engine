import type { EventLog, StoredEvent } from "./event.js";
import { verifyStoredEvent } from "./event.js";
import { canonicalHash, hashParts } from "./hash.js";
import {
  assertJson,
  canonicalJson,
  cloneJson,
  deepFreezeJson,
  type JsonObject,
  type JsonValue,
} from "./json.js";

export type RunKind = "live" | "replay" | "shadow" | "research" | "paper";

export type RunIdentities = Readonly<{
  extractorVersion: string;
  featureSetId: string | null;
  modelId: string | null;
  promptId: string | null;
  datasetId: string | null;
}>;

export type RunBehavior<TConfig extends JsonObject = JsonObject> = Readonly<{
  reducerName: string;
  reducerVersion: string;
  buildDigest: string;
  schemaRegistryDigest: string;
  configuration: TConfig;
  identities: RunIdentities;
}>;

export type RunManifest<TConfig extends JsonObject = JsonObject> = Readonly<{
  manifestVersion: 2;
  runId: string;
  kind: RunKind;
  effectsAllowed: boolean;
  canonicalizationVersion: "peas-json-v1";
  behavior: RunBehavior<TConfig>;
}>;

export type RunRegistration<TConfig extends JsonObject = JsonObject> = Readonly<{
  manifest: RunManifest<TConfig>;
  manifestHash: string;
  behaviorHash: string;
}>;

export type DecisionDraft = Readonly<{
  type: string;
  payload: JsonObject;
}>;

export type JobDraft = Readonly<{
  jobId: string;
  type: string;
  dedupeKey: string;
  notBeforeLogicalMs: number;
  inputBundleHash: string;
  payload: JsonObject;
}>;

export type OutboxDraft = Readonly<{
  messageId: string;
  topic: string;
  dedupeKey: string;
  payload: JsonObject;
}>;

export type Transition<TState extends JsonObject> = Readonly<{
  state: TState;
  decisions: readonly DecisionDraft[];
  jobs: readonly JobDraft[];
  outbox: readonly OutboxDraft[];
}>;

export type ReducerContext<TConfig extends JsonObject> = Readonly<{
  nowMs: number;
  runId: string;
  behaviorHash: string;
  identities: Readonly<RunIdentities>;
  config: Readonly<TConfig>;
  configHash: string;
}>;

export interface Reducer<TState extends JsonObject, TConfig extends JsonObject> {
  readonly name: string;
  readonly version: string;
  route(event: Readonly<StoredEvent>): string;
  parseState(value: unknown): TState;
  initialState(aggregateId: string, config: Readonly<TConfig>): TState;
  apply(
    state: Readonly<TState>,
    event: Readonly<StoredEvent>,
    context: ReducerContext<TConfig>,
  ): Transition<TState>;
}

export type OutputCategory = "decision" | "job" | "outbox";

export type ImmutableOutput = Readonly<{
  outputId: string;
  runId: string;
  inputEventId: string;
  inputPosition: string;
  aggregateId: string;
  category: OutputCategory;
  ordinal: number;
  dedupeKey: string | null;
  notBeforeLogicalMs: number | null;
  body: JsonObject;
  bodyHash: string;
}>;

export type StoredOutput = ImmutableOutput & Readonly<{ sequence: string }>;

export type RunCursor = Readonly<{
  runId: string;
  manifestHash: string;
  behaviorHash: string;
  processedPosition: string;
  logicalAtMs: number;
  lastEventHash: string;
  stateHead: string;
  decisionHead: string;
  cursorHash: string;
}>;

export type AggregateCheckpoint<TState extends JsonObject> = Readonly<{
  runId: string;
  aggregateId: string;
  version: string;
  lastInputPosition: string;
  state: TState;
  stateHash: string;
  checkpointHash: string;
}>;

export type ProcessingCommit<TState extends JsonObject> = Readonly<{
  expectedPosition: string;
  event: StoredEvent;
  cursor: RunCursor;
  aggregate: AggregateCheckpoint<TState>;
  outputs: readonly ImmutableOutput[];
}>;

export type OutputPage = Readonly<{
  outputs: readonly StoredOutput[];
  nextSequence: string;
  hasMore: boolean;
}>;

export type AggregatePage<TState extends JsonObject> = Readonly<{
  aggregates: readonly AggregateCheckpoint<TState>[];
  nextAggregateId: string;
  hasMore: boolean;
}>;

export interface ProcessingStore<TState extends JsonObject> {
  ensureRun(registration: RunRegistration): Promise<void>;
  loadCursor(runId: string): Promise<RunCursor | undefined>;
  loadAggregate(
    runId: string,
    aggregateId: string,
  ): Promise<AggregateCheckpoint<TState> | undefined>;
  commit(value: ProcessingCommit<TState>): Promise<void>;
  readOutputsAfter(runId: string, sequence: string, limit: number): Promise<OutputPage>;
  readAggregatesAfter(
    runId: string,
    aggregateId: string,
    limit: number,
  ): Promise<AggregatePage<TState>>;
}

const runKinds = new Set<RunKind>(["live", "replay", "shadow", "research", "paper"]);

export function assertRunEffectPolicy(manifest: RunManifest): void {
  if (!runKinds.has(manifest.kind)) throw new TypeError(`Unsupported run kind ${manifest.kind}`);
  if (typeof manifest.effectsAllowed !== "boolean") {
    throw new TypeError("Run effectsAllowed must be a boolean");
  }
  if (manifest.effectsAllowed && manifest.kind !== "live") {
    throw new Error(`Run kind ${manifest.kind} cannot dispatch external effects`);
  }
}

export function deriveJobId(runId: string, dedupeKey: string, payload: JsonObject): string {
  return canonicalHash("peas/job-id/v2", {
    runId,
    dedupeKey,
    payloadHash: canonicalHash("peas/job-payload/v2", payload),
  });
}

export function deriveMessageId(runId: string, dedupeKey: string, payload: JsonObject): string {
  return canonicalHash("peas/message-id/v2", {
    runId,
    dedupeKey,
    payloadHash: canonicalHash("peas/outbox-payload/v2", payload),
  });
}

export function computeRunCursorHash(cursor: Omit<RunCursor, "cursorHash">): string {
  return canonicalHash("peas/run-cursor/v2", cursor);
}

export function computeAggregateCheckpointHash<TState extends JsonObject>(
  checkpoint: Omit<AggregateCheckpoint<TState>, "checkpointHash">,
): string {
  return canonicalHash("peas/aggregate-checkpoint/v2", {
    runId: checkpoint.runId,
    aggregateId: checkpoint.aggregateId,
    version: checkpoint.version,
    lastInputPosition: checkpoint.lastInputPosition,
    stateHash: checkpoint.stateHash,
  });
}

function requiredObject(value: JsonValue | undefined, label: string): JsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function verifyProcessingCommit<TState extends JsonObject>(
  value: ProcessingCommit<TState>,
  registration: RunRegistration,
): void {
  const { cursorHash, ...cursorWithoutHash } = value.cursor;
  if (cursorHash !== computeRunCursorHash(cursorWithoutHash)) {
    throw new Error("Run cursor hash mismatch in commit");
  }
  if (
    value.cursor.runId !== registration.manifest.runId ||
    value.cursor.manifestHash !== registration.manifestHash ||
    value.cursor.behaviorHash !== registration.behaviorHash
  ) {
    throw new Error("Commit cursor does not match its immutable run manifest");
  }
  if (
    value.cursor.processedPosition !== value.event.position ||
    value.cursor.logicalAtMs !== value.event.logicalAtMs ||
    value.cursor.lastEventHash !== value.event.eventHash
  ) {
    throw new Error("Commit cursor does not match its input event");
  }

  const { checkpointHash, ...checkpointWithoutHash } = value.aggregate;
  if (checkpointHash !== computeAggregateCheckpointHash(checkpointWithoutHash)) {
    throw new Error("Aggregate checkpoint hash mismatch in commit");
  }
  if (
    value.aggregate.runId !== value.cursor.runId ||
    value.aggregate.lastInputPosition !== value.event.position
  ) {
    throw new Error("Aggregate checkpoint does not match its input event or run");
  }
  const expectedStateHash = canonicalHash(
    `peas/state/${registration.manifest.behavior.reducerName}/${registration.manifest.behavior.reducerVersion}`,
    value.aggregate.state,
  );
  if (value.aggregate.stateHash !== expectedStateHash) {
    throw new Error("Aggregate state hash mismatch in commit");
  }

  for (const output of value.outputs) {
    if (
      output.runId !== value.cursor.runId ||
      output.inputEventId !== value.event.eventId ||
      output.inputPosition !== value.event.position ||
      output.aggregateId !== value.aggregate.aggregateId
    ) {
      throw new Error("Output metadata does not match its input event, aggregate, or run");
    }
    const expectedBodyHash = canonicalHash(`peas/output-body/${output.category}/v2`, output.body);
    if (output.bodyHash !== expectedBodyHash) throw new Error("Output body hash mismatch");
    const expectedOutputId = canonicalHash("peas/output-id/v2", {
      runId: output.runId,
      manifestHash: registration.manifestHash,
      inputEventHash: value.event.eventHash,
      aggregateId: output.aggregateId,
      category: output.category,
      ordinal: output.ordinal,
      bodyHash: output.bodyHash,
    });
    if (output.outputId !== expectedOutputId) throw new Error("Output ID integrity mismatch");

    const payload = requiredObject(output.body["payload"], "Output payload");
    if (output.category === "decision") {
      requiredString(output.body["type"], "Decision type");
      if (output.dedupeKey !== null || output.notBeforeLogicalMs !== null) {
        throw new Error("Decision output has operational delivery metadata");
      }
      continue;
    }
    const bodyDedupeKey = requiredString(output.body["dedupeKey"], "Output dedupe key");
    if (bodyDedupeKey !== output.dedupeKey) throw new Error("Output dedupe metadata mismatch");
    if (output.category === "job") {
      requiredString(output.body["type"], "Job type");
      const bodyJobId = requiredString(output.body["jobId"], "Job ID");
      if (bodyJobId !== deriveJobId(output.runId, bodyDedupeKey, payload)) {
        throw new Error("Job ID integrity mismatch");
      }
      if (output.body["notBeforeLogicalMs"] !== output.notBeforeLogicalMs) {
        throw new Error("Job not-before metadata mismatch");
      }
      assertHash(
        requiredString(output.body["inputBundleHash"], "Input bundle hash"),
        "Input bundle hash",
      );
      continue;
    }
    requiredString(output.body["topic"], "Outbox topic");
    const bodyMessageId = requiredString(output.body["messageId"], "Message ID");
    if (bodyMessageId !== deriveMessageId(output.runId, bodyDedupeKey, payload)) {
      throw new Error("Message ID integrity mismatch");
    }
    if (output.notBeforeLogicalMs !== null) {
      throw new Error("Outbox output has unexpected not-before metadata");
    }
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} cannot be empty`);
}

function assertHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest`);
}

function assertLogicalMs(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function assertPageLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new RangeError("Page limit must be an integer between 1 and 10,000");
  }
}

function outputBody(
  category: OutputCategory,
  draft: DecisionDraft | JobDraft | OutboxDraft,
  runId: string,
): Readonly<{
  body: JsonObject;
  dedupeKey: string | null;
  notBeforeLogicalMs: number | null;
}> {
  if (category === "decision") {
    const decision = draft as DecisionDraft;
    assertNonEmpty(decision.type, "Decision type");
    return {
      body: { type: decision.type, payload: decision.payload },
      dedupeKey: null,
      notBeforeLogicalMs: null,
    };
  }
  if (category === "job") {
    const job = draft as JobDraft;
    assertNonEmpty(job.type, "Job type");
    assertNonEmpty(job.dedupeKey, "Job dedupe key");
    assertHash(job.inputBundleHash, "Job input bundle hash");
    assertLogicalMs(job.notBeforeLogicalMs, "Job not-before time");
    const expectedJobId = deriveJobId(runId, job.dedupeKey, job.payload);
    if (job.jobId !== expectedJobId) throw new Error(`Invalid deterministic job ID ${job.jobId}`);
    return {
      body: {
        jobId: job.jobId,
        type: job.type,
        dedupeKey: job.dedupeKey,
        notBeforeLogicalMs: job.notBeforeLogicalMs,
        inputBundleHash: job.inputBundleHash,
        payload: job.payload,
      },
      dedupeKey: job.dedupeKey,
      notBeforeLogicalMs: job.notBeforeLogicalMs,
    };
  }

  const outbox = draft as OutboxDraft;
  assertNonEmpty(outbox.topic, "Outbox topic");
  assertNonEmpty(outbox.dedupeKey, "Outbox dedupe key");
  const expectedMessageId = deriveMessageId(runId, outbox.dedupeKey, outbox.payload);
  if (outbox.messageId !== expectedMessageId) {
    throw new Error(`Invalid deterministic message ID ${outbox.messageId}`);
  }
  return {
    body: {
      messageId: outbox.messageId,
      topic: outbox.topic,
      dedupeKey: outbox.dedupeKey,
      payload: outbox.payload,
    },
    dedupeKey: outbox.dedupeKey,
    notBeforeLogicalMs: null,
  };
}

export class DeterministicProcessor<TState extends JsonObject, TConfig extends JsonObject> {
  readonly #reducer: Reducer<TState, TConfig>;
  readonly #store: ProcessingStore<TState>;
  readonly #eventLog: EventLog;
  readonly #registration: RunRegistration<TConfig>;
  readonly #configHash: string;
  #initialized = false;

  constructor(options: {
    reducer: Reducer<TState, TConfig>;
    store: ProcessingStore<TState>;
    eventLog: EventLog;
    manifest: RunManifest<TConfig>;
  }) {
    this.#reducer = options.reducer;
    this.#store = options.store;
    this.#eventLog = options.eventLog;
    assertJson(options.manifest);
    assertRunEffectPolicy(options.manifest);
    if (options.manifest.behavior.reducerName !== options.reducer.name) {
      throw new Error("Manifest reducer name does not match the reducer");
    }
    if (options.manifest.behavior.reducerVersion !== options.reducer.version) {
      throw new Error("Manifest reducer version does not match the reducer");
    }
    assertNonEmpty(options.manifest.runId, "Run ID");
    assertNonEmpty(options.manifest.behavior.identities.extractorVersion, "Extractor version");
    for (const [name, identity] of Object.entries(options.manifest.behavior.identities)) {
      if (identity !== null) assertNonEmpty(identity, `Run identity ${name}`);
    }
    assertHash(options.manifest.behavior.buildDigest, "Build digest");
    assertHash(options.manifest.behavior.schemaRegistryDigest, "Schema registry digest");
    const manifest = cloneJson(options.manifest as unknown as JsonValue) as RunManifest<TConfig>;
    this.#registration = {
      manifest,
      manifestHash: canonicalHash("peas/run-manifest/v2", manifest),
      behaviorHash: canonicalHash("peas/run-behavior/v2", manifest.behavior),
    };
    this.#configHash = canonicalHash("peas/reducer-config/v2", manifest.behavior.configuration);
  }

  get registration(): RunRegistration<TConfig> {
    return cloneJson(this.#registration as unknown as JsonValue) as RunRegistration<TConfig>;
  }

  async process(event: StoredEvent): Promise<RunCursor> {
    await this.#initialize();
    const previous =
      (await this.#store.loadCursor(this.#registration.manifest.runId)) ?? this.#genesis();
    this.#verifyCursor(previous);
    verifyStoredEvent(event);

    const currentPosition = BigInt(event.position);
    const previousPosition = BigInt(previous.processedPosition);
    if (currentPosition <= previousPosition) {
      const expectedPreviousHash = await this.#persistedPredecessorHash(currentPosition);
      await this.#verifyExactPersistedEvent(event, expectedPreviousHash);
      await this.#verifyProcessedSuffix(currentPosition, event.eventHash, previous);
      return previous;
    }
    if (currentPosition !== previousPosition + 1n) {
      throw new Error(
        `Non-contiguous processing position: expected ${previousPosition + 1n}, received ${currentPosition}`,
      );
    }
    await this.#verifyExactPersistedEvent(event, previous.lastEventHash);
    if (event.logicalAtMs < previous.logicalAtMs) {
      throw new Error(`Logical clock regression at event position ${event.position}`);
    }

    const aggregateId = this.#reducer.route(event);
    assertNonEmpty(aggregateId, "Aggregate ID");
    const priorAggregate =
      (await this.#store.loadAggregate(this.#registration.manifest.runId, aggregateId)) ??
      this.#aggregateGenesis(aggregateId);
    const parsedPriorState = this.#verifyAggregate(priorAggregate);
    const transition = this.#reducer.apply(deepFreezeJson(cloneJson(parsedPriorState)), event, {
      nowMs: event.logicalAtMs,
      runId: this.#registration.manifest.runId,
      behaviorHash: this.#registration.behaviorHash,
      identities: deepFreezeJson(
        cloneJson(this.#registration.manifest.behavior.identities as unknown as JsonValue),
      ) as Readonly<RunIdentities>,
      config: deepFreezeJson(cloneJson(this.#registration.manifest.behavior.configuration)),
      configHash: this.#configHash,
    });
    const nextState = this.#reducer.parseState(transition.state);
    assertJson(nextState);
    const canonicalState = cloneJson(nextState);
    const stateHash = canonicalHash(
      `peas/state/${this.#reducer.name}/${this.#reducer.version}`,
      canonicalState,
    );
    const aggregateWithoutHash = {
      runId: this.#registration.manifest.runId,
      aggregateId,
      version: (BigInt(priorAggregate.version) + 1n).toString(),
      lastInputPosition: event.position,
      state: canonicalState,
      stateHash,
    } satisfies Omit<AggregateCheckpoint<TState>, "checkpointHash">;
    const aggregate: AggregateCheckpoint<TState> = {
      ...aggregateWithoutHash,
      checkpointHash: computeAggregateCheckpointHash(aggregateWithoutHash),
    };
    const outputs = this.#materialize(event, aggregateId, transition);
    const semanticOutputs = outputs.map(({ category, ordinal, body, bodyHash }) => ({
      category,
      ordinal,
      body,
      bodyHash,
    }));
    const cursorWithoutHash = {
      runId: this.#registration.manifest.runId,
      manifestHash: this.#registration.manifestHash,
      behaviorHash: this.#registration.behaviorHash,
      processedPosition: event.position,
      logicalAtMs: event.logicalAtMs,
      lastEventHash: event.eventHash,
      stateHead: hashParts(
        "peas/state-head/step/v2",
        previous.stateHead,
        event.eventHash,
        aggregateId,
        aggregate.stateHash,
      ),
      decisionHead: hashParts(
        "peas/decision-head/step/v2",
        previous.decisionHead,
        event.eventHash,
        canonicalJson(semanticOutputs as unknown as JsonValue),
      ),
    } satisfies Omit<RunCursor, "cursorHash">;
    const cursor: RunCursor = {
      ...cursorWithoutHash,
      cursorHash: computeRunCursorHash(cursorWithoutHash),
    };

    await this.#store.commit({
      expectedPosition: previous.processedPosition,
      event,
      cursor,
      aggregate,
      outputs,
    });
    return cursor;
  }

  async #persistedPredecessorHash(position: bigint): Promise<string> {
    if (position === 1n) return "0".repeat(64);
    const predecessorPosition = (position - 1n).toString();
    const predecessor = await this.#eventLog.get(predecessorPosition);
    if (predecessor === undefined) {
      throw new Error(`Persisted event predecessor ${predecessorPosition} does not exist`);
    }
    if (predecessor.position !== predecessorPosition) {
      throw new Error(`Event log returned the wrong predecessor for position ${position}`);
    }
    verifyStoredEvent(predecessor);
    return predecessor.eventHash;
  }

  async #verifyExactPersistedEvent(
    event: StoredEvent,
    expectedPreviousHash: string,
  ): Promise<void> {
    verifyStoredEvent(event, expectedPreviousHash);
    const persisted = await this.#eventLog.get(event.position);
    if (persisted === undefined) {
      throw new Error(`Event ${event.position} is not persisted`);
    }
    verifyStoredEvent(persisted, expectedPreviousHash);
    if (
      canonicalJson(persisted as unknown as JsonValue) !==
      canonicalJson(event as unknown as JsonValue)
    ) {
      throw new Error(`Event ${event.position} is not the exact persisted event`);
    }
  }

  async #verifyProcessedSuffix(
    startPosition: bigint,
    startEventHash: string,
    cursor: RunCursor,
  ): Promise<void> {
    const cursorPosition = BigInt(cursor.processedPosition);
    let position = startPosition;
    let eventHash = startEventHash;
    while (position < cursorPosition) {
      const remaining = cursorPosition - position;
      const limit = Number(remaining < 1_000n ? remaining : 1_000n);
      const page = await this.#eventLog.readAfter(position.toString(), limit);
      if (page.events.length === 0) {
        throw new Error(`Persisted event chain ends before cursor position ${cursorPosition}`);
      }
      for (const event of page.events) {
        const expectedPosition = position + 1n;
        if (event.position !== expectedPosition.toString()) {
          throw new Error(
            `Persisted event chain position mismatch: expected ${expectedPosition}, received ${event.position}`,
          );
        }
        verifyStoredEvent(event, eventHash);
        position = expectedPosition;
        eventHash = event.eventHash;
      }
      if (page.nextPosition !== position.toString()) {
        throw new Error(`Persisted event page cursor mismatch after position ${position}`);
      }
    }
    if (position !== cursorPosition || eventHash !== cursor.lastEventHash) {
      throw new Error(
        `Persisted event chain does not match cursor head at position ${cursorPosition}`,
      );
    }
  }

  async processAvailable(pageSize = 1_000): Promise<RunCursor> {
    assertPageLimit(pageSize);
    await this.#initialize();
    let cursor =
      (await this.#store.loadCursor(this.#registration.manifest.runId)) ?? this.#genesis();
    while (true) {
      const page = await this.#eventLog.readAfter(cursor.processedPosition, pageSize);
      for (const event of page.events) cursor = await this.process(event);
      if (!page.hasMore) return cursor;
    }
  }

  async snapshot(pageSize = 1_000): Promise<
    Readonly<{
      cursor: RunCursor;
      outputs: readonly StoredOutput[];
      aggregates: readonly AggregateCheckpoint<TState>[];
    }>
  > {
    assertPageLimit(pageSize);
    await this.#initialize();
    const cursor =
      (await this.#store.loadCursor(this.#registration.manifest.runId)) ?? this.#genesis();
    const outputs: StoredOutput[] = [];
    let outputCursor = "0";
    while (true) {
      const page = await this.#store.readOutputsAfter(
        this.#registration.manifest.runId,
        outputCursor,
        pageSize,
      );
      outputs.push(...page.outputs);
      outputCursor = page.nextSequence;
      if (!page.hasMore) break;
    }
    const aggregates: AggregateCheckpoint<TState>[] = [];
    let aggregateCursor = "";
    while (true) {
      const page = await this.#store.readAggregatesAfter(
        this.#registration.manifest.runId,
        aggregateCursor,
        pageSize,
      );
      aggregates.push(...page.aggregates);
      aggregateCursor = page.nextAggregateId;
      if (!page.hasMore) break;
    }
    return { cursor, outputs, aggregates };
  }

  async #initialize(): Promise<void> {
    if (this.#initialized) return;
    await this.#store.ensureRun(this.#registration);
    this.#initialized = true;
  }

  #genesis(): RunCursor {
    const withoutHash = {
      runId: this.#registration.manifest.runId,
      manifestHash: this.#registration.manifestHash,
      behaviorHash: this.#registration.behaviorHash,
      processedPosition: "0",
      logicalAtMs: 0,
      lastEventHash: "0".repeat(64),
      stateHead: hashParts("peas/state-head/genesis/v2", this.#registration.behaviorHash),
      decisionHead: hashParts("peas/decision-head/genesis/v2", this.#registration.behaviorHash),
    } satisfies Omit<RunCursor, "cursorHash">;
    return { ...withoutHash, cursorHash: computeRunCursorHash(withoutHash) };
  }

  #aggregateGenesis(aggregateId: string): AggregateCheckpoint<TState> {
    const state = this.#reducer.parseState(
      this.#reducer.initialState(aggregateId, this.#registration.manifest.behavior.configuration),
    );
    const stateHash = canonicalHash(
      `peas/state/${this.#reducer.name}/${this.#reducer.version}`,
      state,
    );
    const withoutHash = {
      runId: this.#registration.manifest.runId,
      aggregateId,
      version: "0",
      lastInputPosition: "0",
      state,
      stateHash,
    } satisfies Omit<AggregateCheckpoint<TState>, "checkpointHash">;
    return { ...withoutHash, checkpointHash: computeAggregateCheckpointHash(withoutHash) };
  }

  #verifyCursor(cursor: RunCursor): void {
    if (cursor.runId !== this.#registration.manifest.runId)
      throw new Error("Run cursor ID mismatch");
    if (cursor.manifestHash !== this.#registration.manifestHash) {
      throw new Error("Run manifest does not match the stored cursor");
    }
    if (cursor.behaviorHash !== this.#registration.behaviorHash) {
      throw new Error("Run behavior does not match the stored cursor");
    }
    const { cursorHash, ...withoutHash } = cursor;
    if (cursorHash !== computeRunCursorHash(withoutHash))
      throw new Error("Run cursor hash mismatch");
  }

  #verifyAggregate(checkpoint: AggregateCheckpoint<TState>): TState {
    const state = this.#reducer.parseState(checkpoint.state);
    const expectedStateHash = canonicalHash(
      `peas/state/${this.#reducer.name}/${this.#reducer.version}`,
      state,
    );
    if (checkpoint.stateHash !== expectedStateHash) {
      throw new Error(`Aggregate state hash mismatch for ${checkpoint.aggregateId}`);
    }
    const { checkpointHash, ...withoutHash } = checkpoint;
    if (checkpointHash !== computeAggregateCheckpointHash(withoutHash)) {
      throw new Error(`Aggregate checkpoint hash mismatch for ${checkpoint.aggregateId}`);
    }
    return state;
  }

  #materialize(
    event: StoredEvent,
    aggregateId: string,
    transition: Transition<TState>,
  ): readonly ImmutableOutput[] {
    const groups: readonly [OutputCategory, readonly (DecisionDraft | JobDraft | OutboxDraft)[]][] =
      [
        ["decision", transition.decisions],
        ["job", transition.jobs],
        ["outbox", transition.outbox],
      ];
    const outputs: ImmutableOutput[] = [];
    const dedupe = new Set<string>();

    for (const [category, drafts] of groups) {
      for (let ordinal = 0; ordinal < drafts.length; ordinal += 1) {
        const draft = drafts[ordinal];
        if (draft === undefined)
          throw new Error(`Missing ${category} output at ordinal ${ordinal}`);
        const materialized = outputBody(category, draft, this.#registration.manifest.runId);
        assertJson(materialized.body);
        if (materialized.dedupeKey !== null) {
          const identity = `${category}\u0000${materialized.dedupeKey}`;
          if (dedupe.has(identity))
            throw new Error(`Duplicate ${category} dedupe key in transition`);
          dedupe.add(identity);
        }
        const bodyHash = canonicalHash(`peas/output-body/${category}/v2`, materialized.body);
        const outputId = canonicalHash("peas/output-id/v2", {
          runId: this.#registration.manifest.runId,
          manifestHash: this.#registration.manifestHash,
          inputEventHash: event.eventHash,
          aggregateId,
          category,
          ordinal,
          bodyHash,
        });
        outputs.push({
          outputId,
          runId: this.#registration.manifest.runId,
          inputEventId: event.eventId,
          inputPosition: event.position,
          aggregateId,
          category,
          ordinal,
          dedupeKey: materialized.dedupeKey,
          notBeforeLogicalMs: materialized.notBeforeLogicalMs,
          body: cloneJson(materialized.body),
          bodyHash,
        });
      }
    }
    return outputs;
  }
}
