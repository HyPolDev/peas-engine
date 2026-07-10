import type { EventLog } from "../../core/event.js";
import { canonicalHash } from "../../core/hash.js";
import { canonicalJson, cloneJson, type JsonObject, type JsonValue } from "../../core/json.js";
import {
  computeAggregateCheckpointHash,
  computeRunCursorHash,
  assertRunEffectPolicy,
  verifyProcessingCommit,
  type AggregateCheckpoint,
  type AggregatePage,
  type OutputPage,
  type ProcessingCommit,
  type ProcessingStore,
  type RunCursor,
  type RunRegistration,
  type StoredOutput,
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
    assertRunEffectPolicy(registration.manifest);
    const existing = this.#runs.get(registration.manifest.runId);
    if (existing !== undefined) {
      if (canonicalJson(existing as unknown as JsonValue) !== canonicalJson(registration)) {
        throw new Error(`Run ${registration.manifest.runId} is already registered differently`);
      }
      return;
    }
    this.#runs.set(registration.manifest.runId, copy(registration));
  }

  async loadCursor(runId: string): Promise<RunCursor | undefined> {
    const cursor = this.#cursors.get(runId);
    if (cursor === undefined) return undefined;
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
    const aggregate = this.#aggregates.get(runId)?.get(aggregateId);
    if (aggregate === undefined) return undefined;
    this.#verifyAggregate(aggregate);
    return copy(aggregate);
  }

  async commit(value: ProcessingCommit<TState>): Promise<void> {
    const persistedEvent = await this.#eventLog.get(value.event.position);
    if (
      persistedEvent === undefined ||
      persistedEvent.eventId !== value.event.eventId ||
      persistedEvent.eventHash !== value.event.eventHash ||
      canonicalJson(persistedEvent as unknown as JsonValue) !==
        canonicalJson(value.event as unknown as JsonValue)
    ) {
      throw new Error(`Event ${value.event.position} is not the exact persisted event`);
    }

    const currentPosition = this.#cursors.get(value.cursor.runId)?.processedPosition ?? "0";
    if (currentPosition !== value.expectedPosition) {
      throw new Error(
        `Cursor concurrency conflict: expected ${value.expectedPosition}, found ${currentPosition}`,
      );
    }
    const registration = this.#runs.get(value.cursor.runId);
    if (registration === undefined) throw new Error(`Run ${value.cursor.runId} is not registered`);
    verifyProcessingCommit(value, registration);

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
        const key = `${output.runId}\u0000${output.category}\u0000${output.dedupeKey}`;
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
        const expected = canonicalHash(`peas/output-body/${output.category}/v2`, output.body);
        if (output.bodyHash !== expected)
          throw new Error(`Output body hash mismatch on audit read`);
        return copy(output);
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
