import type { StoredEvent } from "./event.js";
import { canonicalHash, hashParts } from "./hash.js";
import {
  assertJson,
  canonicalJson,
  cloneJson,
  deepFreezeJson,
  type JsonObject,
  type JsonValue,
} from "./json.js";

export type DecisionDraft = Readonly<{
  type: string;
  payload: JsonObject;
}>;

export type JobDraft = Readonly<{
  type: string;
  dedupeKey: string;
  notBeforeLogicalMs: number;
  payload: JsonObject;
}>;

export type OutboxDraft = Readonly<{
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
  config: Readonly<TConfig>;
  configHash: string;
}>;

export interface Reducer<TState extends JsonObject, TConfig extends JsonObject> {
  readonly name: string;
  readonly version: string;
  initialState(config: Readonly<TConfig>): TState;
  apply(
    state: Readonly<TState>,
    event: Readonly<StoredEvent>,
    context: ReducerContext<TConfig>,
  ): Transition<TState>;
}

export type RunManifest<TConfig extends JsonObject = JsonObject> = Readonly<{
  manifestVersion: 1;
  reducerName: string;
  reducerVersion: string;
  canonicalizationVersion: "peas-json-v1";
  configuration: TConfig;
}>;

export type OutputCategory = "decision" | "job" | "outbox";

export type ImmutableOutput = Readonly<{
  outputId: string;
  inputEventId: string;
  inputPosition: string;
  category: OutputCategory;
  ordinal: number;
  body: JsonObject;
  bodyHash: string;
}>;

export type Checkpoint<TState extends JsonObject> = Readonly<{
  manifestHash: string;
  processedPosition: string;
  logicalAtMs: number;
  state: TState;
  stateHash: string;
  decisionHead: string;
}>;

export type ProcessingCommit<TState extends JsonObject> = Readonly<{
  expectedPosition: string;
  event: StoredEvent;
  checkpoint: Checkpoint<TState>;
  outputs: readonly ImmutableOutput[];
}>;

export interface ProcessingStore<TState extends JsonObject> {
  loadCheckpoint(): Checkpoint<TState> | undefined;
  commit(value: ProcessingCommit<TState>): void;
  readOutputs(): readonly ImmutableOutput[];
}

function assertNonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} cannot be empty`);
}

function assertLogicalMs(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function outputBody(
  category: OutputCategory,
  draft: DecisionDraft | JobDraft | OutboxDraft,
): JsonObject {
  if (category === "decision") {
    const decision = draft as DecisionDraft;
    assertNonEmpty(decision.type, "Decision type");
    return { type: decision.type, payload: decision.payload };
  }
  if (category === "job") {
    const job = draft as JobDraft;
    assertNonEmpty(job.type, "Job type");
    assertNonEmpty(job.dedupeKey, "Job dedupe key");
    assertLogicalMs(job.notBeforeLogicalMs, "Job not-before time");
    return {
      type: job.type,
      dedupeKey: job.dedupeKey,
      notBeforeLogicalMs: job.notBeforeLogicalMs,
      payload: job.payload,
    };
  }

  const outbox = draft as OutboxDraft;
  assertNonEmpty(outbox.topic, "Outbox topic");
  assertNonEmpty(outbox.dedupeKey, "Outbox dedupe key");
  return { topic: outbox.topic, dedupeKey: outbox.dedupeKey, payload: outbox.payload };
}

export class DeterministicProcessor<TState extends JsonObject, TConfig extends JsonObject> {
  readonly #reducer: Reducer<TState, TConfig>;
  readonly #store: ProcessingStore<TState>;
  readonly #manifest: RunManifest<TConfig>;
  readonly #manifestHash: string;
  readonly #configHash: string;

  constructor(options: {
    reducer: Reducer<TState, TConfig>;
    store: ProcessingStore<TState>;
    configuration: TConfig;
  }) {
    this.#reducer = options.reducer;
    this.#store = options.store;
    assertJson(options.configuration);
    this.#manifest = {
      manifestVersion: 1,
      reducerName: options.reducer.name,
      reducerVersion: options.reducer.version,
      canonicalizationVersion: "peas-json-v1",
      configuration: cloneJson(options.configuration),
    };
    this.#manifestHash = canonicalHash("peas/run-manifest/v1", this.#manifest);
    this.#configHash = canonicalHash("peas/reducer-config/v1", options.configuration);
  }

  get manifest(): RunManifest<TConfig> {
    return cloneJson(this.#manifest as unknown as JsonValue) as RunManifest<TConfig>;
  }

  process(event: StoredEvent): Checkpoint<TState> {
    const previous = this.#store.loadCheckpoint() ?? this.#genesis();
    if (previous.manifestHash !== this.#manifestHash) {
      throw new Error("Run manifest does not match the stored checkpoint");
    }

    const currentPosition = BigInt(event.position);
    const previousPosition = BigInt(previous.processedPosition);
    if (currentPosition <= previousPosition) return previous;
    if (currentPosition !== previousPosition + 1n) {
      throw new Error(
        `Non-contiguous processing position: expected ${previousPosition + 1n}, received ${currentPosition}`,
      );
    }
    if (event.logicalAtMs < previous.logicalAtMs) {
      throw new Error(`Logical clock regression at event position ${event.position}`);
    }

    const stateForReducer = deepFreezeJson(cloneJson(previous.state));
    const transition = this.#reducer.apply(stateForReducer, event, {
      nowMs: event.logicalAtMs,
      config: deepFreezeJson(cloneJson(this.#manifest.configuration)),
      configHash: this.#configHash,
    });
    assertJson(transition.state);
    const nextState = cloneJson(transition.state);
    const outputs = this.#materialize(event, transition);
    const stateHash = canonicalHash(
      `peas/state/${this.#reducer.name}/${this.#reducer.version}`,
      nextState,
    );
    const decisionHead = hashParts(
      "peas/decision-head/step/v1",
      previous.decisionHead,
      event.eventHash,
      canonicalJson(outputs as unknown as JsonValue),
    );
    const checkpoint: Checkpoint<TState> = {
      manifestHash: this.#manifestHash,
      processedPosition: event.position,
      logicalAtMs: event.logicalAtMs,
      state: nextState,
      stateHash,
      decisionHead,
    };

    this.#store.commit({
      expectedPosition: previous.processedPosition,
      event,
      checkpoint,
      outputs,
    });
    return checkpoint;
  }

  processAll(events: readonly StoredEvent[]): Checkpoint<TState> {
    let checkpoint = this.#store.loadCheckpoint() ?? this.#genesis();
    for (const event of events) checkpoint = this.process(event);
    return checkpoint;
  }

  snapshot(): Readonly<{ checkpoint: Checkpoint<TState>; outputs: readonly ImmutableOutput[] }> {
    return {
      checkpoint: this.#store.loadCheckpoint() ?? this.#genesis(),
      outputs: this.#store.readOutputs(),
    };
  }

  #genesis(): Checkpoint<TState> {
    const initialState = cloneJson(this.#reducer.initialState(this.#manifest.configuration));
    return {
      manifestHash: this.#manifestHash,
      processedPosition: "0",
      logicalAtMs: 0,
      state: initialState,
      stateHash: canonicalHash(
        `peas/state/${this.#reducer.name}/${this.#reducer.version}`,
        initialState,
      ),
      decisionHead: hashParts("peas/decision-head/genesis/v1", this.#manifestHash),
    };
  }

  #materialize(event: StoredEvent, transition: Transition<TState>): readonly ImmutableOutput[] {
    const groups: readonly [OutputCategory, readonly (DecisionDraft | JobDraft | OutboxDraft)[]][] =
      [
        ["decision", transition.decisions],
        ["job", transition.jobs],
        ["outbox", transition.outbox],
      ];
    const outputs: ImmutableOutput[] = [];

    for (const [category, drafts] of groups) {
      for (let ordinal = 0; ordinal < drafts.length; ordinal += 1) {
        const draft = drafts[ordinal];
        if (draft === undefined)
          throw new Error(`Missing ${category} output at ordinal ${ordinal}`);
        const body = outputBody(category, draft);
        assertJson(body);
        const bodyHash = canonicalHash(`peas/output-body/${category}/v1`, body);
        const outputId = canonicalHash("peas/output-id/v1", {
          reducerName: this.#reducer.name,
          reducerVersion: this.#reducer.version,
          inputEventHash: event.eventHash,
          category,
          ordinal,
          bodyHash,
        });
        outputs.push({
          outputId,
          inputEventId: event.eventId,
          inputPosition: event.position,
          category,
          ordinal,
          body: cloneJson(body),
          bodyHash,
        });
      }
    }
    return outputs;
  }
}
