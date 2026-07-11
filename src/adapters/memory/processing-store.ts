import type { EventLog } from "../../core/event.js";
import { validateStoredEvent, verifyStoredEvent } from "../../core/event.js";
import { canonicalHash } from "../../core/hash.js";
import { canonicalJson, cloneJson, type JsonObject, type JsonValue } from "../../core/json.js";
import {
  type AggregateCheckpoint,
  type AggregatePage,
  computeAggregateCheckpointHash,
  computeOutputDedupeIdentity,
  computeRunCursorHash,
  createGenesisRunCursor,
  type OutputPage,
  type ProcessingCommit,
  type ProcessingStore,
  type RunCursor,
  type RunRegistration,
  type StoredOutput,
  validateAggregateId,
  validateCommittedAggregateCheckpoint,
  validateProcessingCommit,
  validateRunCursor,
  validateRunRegistration,
  validateStoredOutput,
  verifyProcessingTransition,
} from "../../core/processor.js";

function copy<T>(value: T): T {
  return cloneJson(value as unknown as JsonValue) as T;
}

export class InMemoryProcessingStore<TState extends JsonObject> implements ProcessingStore<TState> {
  readonly #eventLog: EventLog;
  readonly #runs = new Map<string, RunRegistration>();
  readonly #cursors = new Map<string, RunCursor>();
  readonly #aggregates = new Map<string, Map<string, AggregateCheckpoint<TState>>>();
  readonly #outputs: StoredOutput[] = [];
  readonly #dedupeKeys = new Map<string, string>();
  readonly #dispatchableJobs = new Set<string>();
  readonly #dispatchableOutbox = new Set<string>();

  constructor(eventLog: EventLog) {
    this.#eventLog = eventLog;
  }

  async ensureRun(registration: RunRegistration): Promise<void> {
    const verified = validateRunRegistration(registration);
    const existing = this.#runs.get(verified.manifest.runId);
    if (existing !== undefined) {
      if (canonicalJson(existing as unknown as JsonValue) !== canonicalJson(verified)) {
        throw new Error(`Run ${verified.manifest.runId} is already registered differently`);
      }
      return;
    }
    this.#runs.set(verified.manifest.runId, copy(verified));
  }

  async loadCursor(runId: string): Promise<RunCursor | undefined> {
    const stored = this.#cursors.get(runId);
    if (stored === undefined) return undefined;
    const cursor = validateRunCursor(stored);
    const { cursorHash, ...withoutHash } = cursor;
    if (cursorHash !== computeRunCursorHash(withoutHash)) {
      throw new Error("Run cursor hash mismatch on audit read");
    }
    return copy(cursor);
  }

  async loadAggregate(
    runId: string,
    aggregateId: string,
  ): Promise<AggregateCheckpoint<TState> | undefined> {
    validateAggregateId(aggregateId);
    const stored = this.#aggregates.get(runId)?.get(aggregateId);
    if (stored === undefined) return undefined;
    const aggregate = validateCommittedAggregateCheckpoint<TState>(stored);
    this.#verifyAggregate(aggregate);
    return copy(aggregate);
  }

  async commit(value: ProcessingCommit<TState>): Promise<void> {
    value = validateProcessingCommit<TState>(value);
    const storedEvent = await this.#eventLog.get(value.event.position);
    if (storedEvent === undefined) {
      throw new Error(`Event ${value.event.position} is not the exact persisted event`);
    }
    const persistedEvent = validateStoredEvent(storedEvent);
    verifyStoredEvent(persistedEvent);
    if (
      persistedEvent.eventId !== value.event.eventId ||
      persistedEvent.eventHash !== value.event.eventHash ||
      canonicalJson(persistedEvent as unknown as JsonValue) !==
        canonicalJson(value.event as unknown as JsonValue)
    ) {
      throw new Error(`Event ${value.event.position} is not the exact persisted event`);
    }

    const registration = this.#runs.get(value.cursor.runId);
    if (registration === undefined) throw new Error(`Run ${value.cursor.runId} is not registered`);
    const previous = this.#cursors.get(value.cursor.runId) ?? createGenesisRunCursor(registration);
    if (previous.processedPosition !== value.expectedPosition) {
      throw new Error(
        `Cursor concurrency conflict: expected ${value.expectedPosition}, found ${previous.processedPosition}`,
      );
    }
    value = verifyProcessingTransition(value, registration, previous);

    const priorAggregate = this.#aggregates
      .get(value.cursor.runId)
      ?.get(value.aggregate.aggregateId);
    const expectedAggregateVersion = (BigInt(priorAggregate?.version ?? "0") + 1n).toString();
    if (value.aggregate.version !== expectedAggregateVersion) {
      throw new Error("Aggregate version concurrency conflict");
    }

    const pendingOutputs: StoredOutput[] = [];
    const mutablePendingDedupe: [string, string][] = [];
    for (const output of value.outputs) {
      if (output.runId !== value.cursor.runId) throw new Error("Output run ID mismatch");
      const expectedBodyHash = canonicalHash(`peas/output-body/${output.category}/v2`, output.body);
      if (output.bodyHash !== expectedBodyHash) throw new Error(`Output body hash mismatch`);
      if (output.dedupeKey !== null) {
        if (output.category === "decision") {
          throw new Error("Decision output cannot have a dedupe key");
        }
        const key = computeOutputDedupeIdentity(output.runId, output.category, output.dedupeKey);
        const existing =
          this.#dedupeKeys.get(key) ??
          mutablePendingDedupe.find(([candidate]) => candidate === key)?.[1];
        if (existing !== undefined && existing !== output.outputId) {
          throw new Error(`Run-scoped output dedupe conflict for ${output.dedupeKey}`);
        }
        mutablePendingDedupe.push([key, output.outputId]);
      }
      const stored: StoredOutput = {
        ...copy(output),
        sequence: String(this.#outputs.length + pendingOutputs.length + 1),
      };
      pendingOutputs.push(stored);
    }

    const runAggregates = this.#aggregates.get(value.cursor.runId) ?? new Map();
    runAggregates.set(value.aggregate.aggregateId, copy(value.aggregate));
    this.#aggregates.set(value.cursor.runId, runAggregates);
    this.#outputs.push(...pendingOutputs);
    for (const [key, outputId] of mutablePendingDedupe) this.#dedupeKeys.set(key, outputId);
    if (registration.manifest.effectsAllowed) {
      for (const output of value.outputs) {
        if (output.category === "job") this.#dispatchableJobs.add(output.outputId);
        if (output.category === "outbox") this.#dispatchableOutbox.add(output.outputId);
      }
    }
    this.#cursors.set(value.cursor.runId, copy(value.cursor));
  }

  async readOutputsAfter(runId: string, sequence: string, limit: number): Promise<OutputPage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError("Output page limit is invalid");
    }
    const cursor = BigInt(sequence);
    const selected = this.#outputs
      .filter((output) => output.runId === runId && BigInt(output.sequence) > cursor)
      .slice(0, limit)
      .map((output) => {
        const validated = validateStoredOutput(output);
        const expected = canonicalHash(`peas/output-body/${validated.category}/v2`, validated.body);
        if (validated.bodyHash !== expected)
          throw new Error(`Output body hash mismatch on audit read`);
        return copy(validated);
      });
    const nextSequence = selected.at(-1)?.sequence ?? sequence;
    const hasMore = this.#outputs.some(
      (output) => output.runId === runId && BigInt(output.sequence) > BigInt(nextSequence),
    );
    return { outputs: selected, nextSequence, hasMore };
  }

  async readAggregatesAfter(
    runId: string,
    aggregateId: string,
    limit: number,
  ): Promise<AggregatePage<TState>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError("Aggregate page limit is invalid");
    }
    if (aggregateId.length > 0) validateAggregateId(aggregateId);
    const values = [...(this.#aggregates.get(runId)?.values() ?? [])]
      .filter((aggregate) => aggregate.aggregateId > aggregateId)
      .sort((left, right) => (left.aggregateId < right.aggregateId ? -1 : 1));
    const selected = values.slice(0, limit).map((aggregate) => {
      this.#verifyAggregate(aggregate);
      return copy(aggregate);
    });
    return {
      aggregates: selected,
      nextAggregateId: selected.at(-1)?.aggregateId ?? aggregateId,
      hasMore: values.length > selected.length,
    };
  }

  dispatchableCounts(runId: string): Readonly<{ jobs: number; outbox: number }> {
    const outputsForRun = new Set(
      this.#outputs.filter((output) => output.runId === runId).map((output) => output.outputId),
    );
    return {
      jobs: [...this.#dispatchableJobs].filter((id) => outputsForRun.has(id)).length,
      outbox: [...this.#dispatchableOutbox].filter((id) => outputsForRun.has(id)).length,
    };
  }

  #verifyAggregate(aggregate: AggregateCheckpoint<TState>): void {
    aggregate = validateCommittedAggregateCheckpoint<TState>(aggregate);
    const registration = this.#runs.get(aggregate.runId);
    if (registration === undefined) throw new Error(`Run ${aggregate.runId} is not registered`);
    const expectedStateHash = canonicalHash(
      `peas/state/${registration.manifest.behavior.reducerName}/${registration.manifest.behavior.reducerVersion}`,
      aggregate.state,
    );
    if (aggregate.stateHash !== expectedStateHash) {
      throw new Error(`Aggregate state hash mismatch for ${aggregate.aggregateId}`);
    }
    const { checkpointHash, ...withoutHash } = aggregate;
    if (checkpointHash !== computeAggregateCheckpointHash(withoutHash)) {
      throw new Error(`Aggregate checkpoint hash mismatch for ${aggregate.aggregateId}`);
    }
  }
}
