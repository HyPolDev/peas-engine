import type { SqliteDatabase } from "./database.js";
import { readVerifiedStoredEventAt } from "./event-log.js";

import { canonicalHash } from "../../core/hash.js";
import { assertJson, canonicalJson, type JsonObject, type JsonValue } from "../../core/json.js";
import {
  computeAggregateCheckpointHash,
  computeRunCursorHash,
  assertRunEffectPolicy,
  type AggregateCheckpoint,
  type AggregatePage,
  type OutputPage,
  type ProcessingCommit,
  type ProcessingStore,
  type RunCursor,
  type RunRegistration,
  type StoredOutput,
  verifyProcessingCommit,
} from "../../core/processor.js";

type RunRow = {
  run_id: string;
  run_kind: string;
  effects_allowed: bigint;
  manifest_json: string;
  manifest_hash: string;
  behavior_hash: string;
};

type CursorRow = {
  run_id: string;
  manifest_hash: string;
  behavior_hash: string;
  processed_position: bigint;
  logical_at_ms: bigint;
  last_event_hash: string;
  state_head: string;
  decision_head: string;
  cursor_hash: string;
};

type AggregateRow = {
  run_id: string;
  aggregate_id: string;
  version: bigint;
  last_input_position: bigint;
  state_json: string;
  state_hash: string;
  checkpoint_hash: string;
};

type OutputRow = {
  sequence: bigint;
  output_id: string;
  run_id: string;
  input_event_id: string;
  input_position: bigint;
  aggregate_id: string;
  category: "decision" | "job" | "outbox";
  ordinal: bigint;
  dedupe_key: string | null;
  not_before_logical_ms: bigint | null;
  body_json: string;
  body_hash: string;
  envelope_hash: string;
};

type PositionRow = { processed_position: bigint };
type SequenceRow = { sequence: bigint | null };
type LeaseStateRow = {
  output_id: string;
  fencing_token: bigint;
  attempt_count: bigint;
};

export type ClaimedIntent = Readonly<{
  outputId: string;
  body: JsonObject;
  bodyHash: string;
  fencingToken: number;
  attempt: number;
}>;

function safeNumber(value: bigint, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new RangeError(`${label} exceeds JavaScript safe integers`);
  return number;
}

function parseJson(serialized: string): JsonValue {
  const value: unknown = JSON.parse(serialized);
  assertJson(value);
  return value;
}

function parseJsonObject(serialized: string, label: string): JsonObject {
  const value = parseJson(serialized);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new RangeError("Page or claim limit must be an integer between 1 and 10,000");
  }
}

function assertTime(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function computeOutputEnvelopeHash(row: Omit<OutputRow, "body_json" | "envelope_hash">): string {
  return canonicalHash("peas/output-relational-envelope/v2", {
    sequence: row.sequence.toString(),
    outputId: row.output_id,
    runId: row.run_id,
    inputEventId: row.input_event_id,
    inputPosition: row.input_position.toString(),
    aggregateId: row.aggregate_id,
    category: row.category,
    ordinal: row.ordinal.toString(),
    dedupeKey: row.dedupe_key,
    notBeforeLogicalMs: row.not_before_logical_ms?.toString() ?? null,
    bodyHash: row.body_hash,
  });
}

export class SqliteProcessingStore<TState extends JsonObject> implements ProcessingStore<TState> {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  async ensureRun(registration: RunRegistration): Promise<void> {
    assertRunEffectPolicy(registration.manifest);
    this.#database
      .transaction(() => {
        const existing = this.#runRow(registration.manifest.runId);
        const manifestJson = canonicalJson(registration.manifest);
        if (existing !== undefined) {
          if (
            existing.manifest_json !== manifestJson ||
            existing.manifest_hash !== registration.manifestHash ||
            existing.behavior_hash !== registration.behaviorHash ||
            existing.run_kind !== registration.manifest.kind ||
            existing.effects_allowed !== BigInt(registration.manifest.effectsAllowed ? 1 : 0)
          ) {
            throw new Error(`Run ${registration.manifest.runId} is already registered differently`);
          }
          return;
        }
        this.#database
          .prepare(
            `INSERT INTO run_manifests (
              run_id, run_kind, effects_allowed, manifest_json, manifest_hash, behavior_hash
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            registration.manifest.runId,
            registration.manifest.kind,
            BigInt(registration.manifest.effectsAllowed ? 1 : 0),
            manifestJson,
            registration.manifestHash,
            registration.behaviorHash,
          );
      })
      .immediate();
  }

  async loadCursor(runId: string): Promise<RunCursor | undefined> {
    const row = this.#database
      .prepare(
        `SELECT run_id, manifest_hash, behavior_hash, processed_position, logical_at_ms,
                last_event_hash, state_head, decision_head, cursor_hash
         FROM run_cursors WHERE run_id = ?`,
      )
      .get(runId) as CursorRow | undefined;
    if (row === undefined) return undefined;
    const cursor: RunCursor = {
      runId: row.run_id,
      manifestHash: row.manifest_hash,
      behaviorHash: row.behavior_hash,
      processedPosition: row.processed_position.toString(),
      logicalAtMs: safeNumber(row.logical_at_ms, "Cursor logical time"),
      lastEventHash: row.last_event_hash,
      stateHead: row.state_head,
      decisionHead: row.decision_head,
      cursorHash: row.cursor_hash,
    };
    const { cursorHash, ...withoutHash } = cursor;
    if (cursorHash !== computeRunCursorHash(withoutHash))
      throw new Error("Run cursor hash mismatch");
    return cursor;
  }

  async loadAggregate(
    runId: string,
    aggregateId: string,
  ): Promise<AggregateCheckpoint<TState> | undefined> {
    const row = this.#database
      .prepare(
        `SELECT run_id, aggregate_id, version, last_input_position, state_json,
                state_hash, checkpoint_hash
         FROM aggregate_checkpoints WHERE run_id = ? AND aggregate_id = ?`,
      )
      .get(runId, aggregateId) as AggregateRow | undefined;
    return row ? this.#aggregateFromRow(row) : undefined;
  }

  async commit(value: ProcessingCommit<TState>): Promise<void> {
    this.#database.transaction(() => this.#commitInTransaction(value)).immediate();
  }

  async readOutputsAfter(runId: string, sequence: string, limit: number): Promise<OutputPage> {
    assertLimit(limit);
    const rows = this.#database
      .prepare(
        `SELECT sequence, output_id, run_id, input_event_id, input_position, aggregate_id,
                category, ordinal, dedupe_key, not_before_logical_ms, body_json, body_hash,
                envelope_hash
         FROM processing_outputs
         WHERE run_id = ? AND sequence > ?
         ORDER BY sequence
         LIMIT ?`,
      )
      .all(runId, BigInt(sequence), BigInt(limit + 1)) as OutputRow[];
    const hasMore = rows.length > limit;
    const outputs = rows.slice(0, limit).map((row) => this.#outputFromRow(row));
    return {
      outputs,
      nextSequence: outputs.at(-1)?.sequence ?? sequence,
      hasMore,
    };
  }

  async readAggregatesAfter(
    runId: string,
    aggregateId: string,
    limit: number,
  ): Promise<AggregatePage<TState>> {
    assertLimit(limit);
    const rows = this.#database
      .prepare(
        `SELECT run_id, aggregate_id, version, last_input_position, state_json,
                state_hash, checkpoint_hash
         FROM aggregate_checkpoints
         WHERE run_id = ? AND aggregate_id > ?
         ORDER BY aggregate_id
         LIMIT ?`,
      )
      .all(runId, aggregateId, BigInt(limit + 1)) as AggregateRow[];
    const hasMore = rows.length > limit;
    const aggregates = rows.slice(0, limit).map((row) => this.#aggregateFromRow(row));
    return {
      aggregates,
      nextAggregateId: aggregates.at(-1)?.aggregateId ?? aggregateId,
      hasMore,
    };
  }

  async claimJobs(
    runId: string,
    workerId: string,
    nowMs: number,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ClaimedIntent[]> {
    return this.#claim("job", runId, workerId, nowMs, leaseMs, limit);
  }

  async claimOutbox(
    runId: string,
    workerId: string,
    nowMs: number,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ClaimedIntent[]> {
    return this.#claim("outbox", runId, workerId, nowMs, leaseMs, limit);
  }

  async renewJob(
    outputId: string,
    workerId: string,
    fencingToken: number,
    leaseExpiresAtMs: number,
  ): Promise<void> {
    this.#renew("jobs", outputId, workerId, fencingToken, leaseExpiresAtMs);
  }

  async renewOutbox(
    outputId: string,
    workerId: string,
    fencingToken: number,
    leaseExpiresAtMs: number,
  ): Promise<void> {
    this.#renew("outbox", outputId, workerId, fencingToken, leaseExpiresAtMs);
  }

  async completeJob(
    outputId: string,
    workerId: string,
    fencingToken: number,
    status: "succeeded" | "failed" | "ambiguous",
    error: string | null,
  ): Promise<void> {
    this.#complete("jobs", outputId, workerId, fencingToken, status, error);
  }

  async completeOutbox(
    outputId: string,
    workerId: string,
    fencingToken: number,
    status: "published" | "failed" | "ambiguous",
    error: string | null,
  ): Promise<void> {
    this.#complete("outbox", outputId, workerId, fencingToken, status, error);
  }

  #commitInTransaction(value: ProcessingCommit<TState>): void {
    const persistedEvent = readVerifiedStoredEventAt(this.#database, BigInt(value.event.position));
    if (
      persistedEvent === undefined ||
      canonicalJson(persistedEvent as unknown as JsonValue) !==
        canonicalJson(value.event as unknown as JsonValue)
    ) {
      throw new Error(`Event ${value.event.position} is not the exact persisted event`);
    }
    const current = this.#database
      .prepare("SELECT processed_position FROM run_cursors WHERE run_id = ?")
      .get(value.cursor.runId) as PositionRow | undefined;
    const currentPosition = current?.processed_position.toString() ?? "0";
    if (currentPosition !== value.expectedPosition) {
      throw new Error(
        `Cursor concurrency conflict: expected ${value.expectedPosition}, found ${currentPosition}`,
      );
    }
    const run = this.#runRow(value.cursor.runId);
    if (run === undefined) throw new Error(`Run ${value.cursor.runId} is not registered`);
    const manifest = parseJsonObject(
      run.manifest_json,
      "Stored run manifest",
    ) as RunRegistration["manifest"];
    verifyProcessingCommit(value, {
      manifest,
      manifestHash: run.manifest_hash,
      behaviorHash: run.behavior_hash,
    });

    const priorAggregate = this.#database
      .prepare("SELECT version FROM aggregate_checkpoints WHERE run_id = ? AND aggregate_id = ?")
      .get(value.aggregate.runId, value.aggregate.aggregateId) as { version: bigint } | undefined;
    const expectedAggregateVersion = (priorAggregate?.version ?? 0n) + 1n;
    if (BigInt(value.aggregate.version) !== expectedAggregateVersion) {
      throw new Error("Aggregate version concurrency conflict");
    }

    const insertOutput = this.#database.prepare(
      `INSERT INTO processing_outputs (
        sequence, output_id, run_id, input_event_id, input_position, aggregate_id, category,
        ordinal, dedupe_key, not_before_logical_ms, body_json, body_hash, envelope_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertJob = this.#database.prepare("INSERT INTO jobs (output_id) VALUES (?)");
    const insertOutbox = this.#database.prepare("INSERT INTO outbox (output_id) VALUES (?)");
    let sequence =
      (
        this.#database.prepare("SELECT max(sequence) AS sequence FROM processing_outputs").get() as
          | SequenceRow
          | undefined
      )?.sequence ?? 0n;
    for (const output of value.outputs) {
      if (output.runId !== value.cursor.runId) throw new Error("Output run ID mismatch");
      sequence += 1n;
      const relationalEnvelope = {
        sequence,
        output_id: output.outputId,
        run_id: output.runId,
        input_event_id: output.inputEventId,
        input_position: BigInt(output.inputPosition),
        aggregate_id: output.aggregateId,
        category: output.category,
        ordinal: BigInt(output.ordinal),
        dedupe_key: output.dedupeKey,
        not_before_logical_ms:
          output.notBeforeLogicalMs === null ? null : BigInt(output.notBeforeLogicalMs),
        body_hash: output.bodyHash,
      } satisfies Omit<OutputRow, "body_json" | "envelope_hash">;
      insertOutput.run(
        sequence,
        output.outputId,
        output.runId,
        output.inputEventId,
        BigInt(output.inputPosition),
        output.aggregateId,
        output.category,
        BigInt(output.ordinal),
        output.dedupeKey,
        output.notBeforeLogicalMs === null ? null : BigInt(output.notBeforeLogicalMs),
        canonicalJson(output.body),
        output.bodyHash,
        computeOutputEnvelopeHash(relationalEnvelope),
      );
      if (run.effects_allowed === 1n) {
        if (output.category === "job") insertJob.run(output.outputId);
        if (output.category === "outbox") insertOutbox.run(output.outputId);
      }
    }

    this.#database
      .prepare(
        `INSERT INTO aggregate_checkpoints (
          run_id, aggregate_id, version, last_input_position,
          state_json, state_hash, checkpoint_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, aggregate_id) DO UPDATE SET
          version = excluded.version,
          last_input_position = excluded.last_input_position,
          state_json = excluded.state_json,
          state_hash = excluded.state_hash,
          checkpoint_hash = excluded.checkpoint_hash`,
      )
      .run(
        value.aggregate.runId,
        value.aggregate.aggregateId,
        BigInt(value.aggregate.version),
        BigInt(value.aggregate.lastInputPosition),
        canonicalJson(value.aggregate.state),
        value.aggregate.stateHash,
        value.aggregate.checkpointHash,
      );
    this.#database
      .prepare(
        `INSERT INTO run_cursors (
          run_id, manifest_hash, behavior_hash, processed_position, logical_at_ms,
          last_event_hash, state_head, decision_head, cursor_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          manifest_hash = excluded.manifest_hash,
          behavior_hash = excluded.behavior_hash,
          processed_position = excluded.processed_position,
          logical_at_ms = excluded.logical_at_ms,
          last_event_hash = excluded.last_event_hash,
          state_head = excluded.state_head,
          decision_head = excluded.decision_head,
          cursor_hash = excluded.cursor_hash`,
      )
      .run(
        value.cursor.runId,
        value.cursor.manifestHash,
        value.cursor.behaviorHash,
        BigInt(value.cursor.processedPosition),
        BigInt(value.cursor.logicalAtMs),
        value.cursor.lastEventHash,
        value.cursor.stateHead,
        value.cursor.decisionHead,
        value.cursor.cursorHash,
      );
  }

  #runRow(runId: string): RunRow | undefined {
    const row = this.#database
      .prepare(
        `SELECT run_id, run_kind, effects_allowed, manifest_json, manifest_hash, behavior_hash
         FROM run_manifests WHERE run_id = ?`,
      )
      .get(runId) as RunRow | undefined;
    if (row === undefined) return undefined;
    const manifest = parseJsonObject(row.manifest_json, "Stored run manifest");
    const behaviorValue = manifest["behavior"];
    if (
      behaviorValue === null ||
      typeof behaviorValue !== "object" ||
      Array.isArray(behaviorValue)
    ) {
      throw new Error("Stored run behavior is malformed");
    }
    const behavior = behaviorValue as JsonObject;
    if (canonicalJson(manifest) !== row.manifest_json) {
      throw new Error("Stored run manifest is not canonically encoded");
    }
    if (canonicalHash("peas/run-manifest/v2", manifest) !== row.manifest_hash) {
      throw new Error("Stored run manifest hash mismatch");
    }
    if (canonicalHash("peas/run-behavior/v2", behavior) !== row.behavior_hash) {
      throw new Error("Stored run behavior hash mismatch");
    }
    if (
      manifest["runId"] !== row.run_id ||
      manifest["kind"] !== row.run_kind ||
      manifest["effectsAllowed"] !== (row.effects_allowed === 1n)
    ) {
      throw new Error("Stored run manifest columns mismatch");
    }
    return row;
  }

  #aggregateFromRow(row: AggregateRow): AggregateCheckpoint<TState> {
    const state = parseJsonObject(row.state_json, "Stored aggregate state") as TState;
    const checkpoint: AggregateCheckpoint<TState> = {
      runId: row.run_id,
      aggregateId: row.aggregate_id,
      version: row.version.toString(),
      lastInputPosition: row.last_input_position.toString(),
      state,
      stateHash: row.state_hash,
      checkpointHash: row.checkpoint_hash,
    };
    const run = this.#runRow(row.run_id);
    if (run === undefined) throw new Error(`Run ${row.run_id} is not registered`);
    const manifest = parseJsonObject(run.manifest_json, "Stored run manifest");
    const behaviorValue = manifest["behavior"];
    if (
      behaviorValue === null ||
      typeof behaviorValue !== "object" ||
      Array.isArray(behaviorValue)
    ) {
      throw new Error("Stored run behavior is malformed");
    }
    const behavior = behaviorValue as JsonObject;
    const reducerName = behavior["reducerName"];
    const reducerVersion = behavior["reducerVersion"];
    if (typeof reducerName !== "string" || typeof reducerVersion !== "string") {
      throw new Error("Stored reducer identity is malformed");
    }
    const expectedStateHash = canonicalHash(
      `peas/state/${reducerName}/${reducerVersion}`,
      checkpoint.state,
    );
    if (checkpoint.stateHash !== expectedStateHash) {
      throw new Error(`Aggregate state hash mismatch for ${checkpoint.aggregateId}`);
    }
    const { checkpointHash, ...withoutHash } = checkpoint;
    if (checkpointHash !== computeAggregateCheckpointHash(withoutHash)) {
      throw new Error(`Aggregate checkpoint hash mismatch for ${checkpoint.aggregateId}`);
    }
    return checkpoint;
  }

  #outputFromRow(row: OutputRow): StoredOutput {
    if (row.sequence < 1n) throw new Error("Output sequence is invalid on audit read");
    const expectedEnvelopeHash = computeOutputEnvelopeHash(row);
    if (row.envelope_hash !== expectedEnvelopeHash) {
      throw new Error("Output relational envelope hash mismatch on audit read");
    }
    const body = parseJsonObject(row.body_json, "Stored output body");
    if (canonicalJson(body) !== row.body_json) {
      throw new Error("Output body is not canonically encoded on audit read");
    }
    const expectedBodyHash = canonicalHash(`peas/output-body/${row.category}/v2`, body);
    if (row.body_hash !== expectedBodyHash)
      throw new Error("Output body hash mismatch on audit read");
    const run = this.#runRow(row.run_id);
    if (run === undefined) throw new Error(`Run ${row.run_id} is not registered`);
    const event = readVerifiedStoredEventAt(this.#database, row.input_position);
    if (event === undefined) throw new Error(`Missing input event ${row.input_position}`);
    if (row.input_event_id !== event.eventId) {
      throw new Error("Output input event ID/position mismatch on audit read");
    }
    const ordinal = safeNumber(row.ordinal, "Output ordinal");
    const expectedOutputId = canonicalHash("peas/output-id/v2", {
      runId: row.run_id,
      manifestHash: run.manifest_hash,
      inputEventHash: event.eventHash,
      aggregateId: row.aggregate_id,
      category: row.category,
      ordinal,
      bodyHash: row.body_hash,
    });
    if (row.output_id !== expectedOutputId) throw new Error("Output ID mismatch on audit read");
    const bodyDedupeKey = body["dedupeKey"];
    const bodyNotBefore = body["notBeforeLogicalMs"];
    if (row.category === "decision") {
      if (row.dedupe_key !== null || row.not_before_logical_ms !== null) {
        throw new Error("Decision delivery columns mismatch on audit read");
      }
    } else {
      if (typeof bodyDedupeKey !== "string" || bodyDedupeKey !== row.dedupe_key) {
        throw new Error("Output dedupe column mismatch on audit read");
      }
      if (row.category === "job") {
        const relationalNotBefore =
          row.not_before_logical_ms === null
            ? null
            : safeNumber(row.not_before_logical_ms, "Output not-before time");
        if (bodyNotBefore !== relationalNotBefore) {
          throw new Error("Job not-before column mismatch on audit read");
        }
      } else if (row.not_before_logical_ms !== null || bodyNotBefore !== undefined) {
        throw new Error("Outbox not-before column mismatch on audit read");
      }
    }
    return {
      sequence: row.sequence.toString(),
      outputId: row.output_id,
      runId: row.run_id,
      inputEventId: row.input_event_id,
      inputPosition: row.input_position.toString(),
      aggregateId: row.aggregate_id,
      category: row.category,
      ordinal,
      dedupeKey: row.dedupe_key,
      notBeforeLogicalMs:
        row.not_before_logical_ms === null
          ? null
          : safeNumber(row.not_before_logical_ms, "Output not-before time"),
      body,
      bodyHash: row.body_hash,
    };
  }

  #claim(
    category: "job" | "outbox",
    runId: string,
    workerId: string,
    nowMs: number,
    leaseMs: number,
    limit: number,
  ): readonly ClaimedIntent[] {
    assertTime(nowMs, "Claim time");
    assertTime(leaseMs, "Lease duration");
    assertLimit(limit);
    if (workerId.length === 0) throw new TypeError("Worker ID cannot be empty");
    const table = category === "job" ? "jobs" : "outbox";
    const dueExpression =
      category === "job"
        ? "json_extract(o.body_json, '$.notBeforeLogicalMs')"
        : "CAST(0 AS INTEGER)";
    const leaseExpiresAtMs = nowMs + leaseMs;
    if (!Number.isSafeInteger(leaseExpiresAtMs)) throw new RangeError("Lease expiry overflow");
    return this.#database
      .transaction(() => {
        const candidates = this.#database
          .prepare(
            `SELECT o.sequence, o.output_id, o.run_id, o.input_event_id, o.input_position,
                    o.aggregate_id, o.category, o.ordinal, o.dedupe_key,
                    o.not_before_logical_ms, o.body_json, o.body_hash, o.envelope_hash
             FROM ${table} d
             JOIN processing_outputs o ON o.output_id = d.output_id
             JOIN run_manifests r ON r.run_id = o.run_id
             WHERE o.run_id = ?
               AND r.effects_allowed = 1
               AND r.run_kind = 'live'
               AND ${dueExpression} <= ?
               AND (d.status = 'pending' OR (d.status = 'leased' AND d.lease_expires_at_ms <= ?))
             ORDER BY ${dueExpression}, o.output_id
             LIMIT ?`,
          )
          .all(runId, BigInt(nowMs), BigInt(nowMs), BigInt(limit)) as OutputRow[];
        const claims: ClaimedIntent[] = [];
        for (const candidate of candidates) {
          const output = this.#outputFromRow(candidate);
          if (output.category !== category) {
            throw new Error(`Dispatch table/category mismatch for ${output.outputId}`);
          }
          this.#database
            .prepare(
              `UPDATE ${table}
               SET status = 'leased', lease_owner = ?, lease_expires_at_ms = ?,
                   fencing_token = fencing_token + 1, attempt_count = attempt_count + 1
               WHERE output_id = ?`,
            )
            .run(workerId, BigInt(leaseExpiresAtMs), output.outputId);
          const row = this.#database
            .prepare(
              `SELECT output_id, fencing_token, attempt_count
               FROM ${table} WHERE output_id = ?`,
            )
            .get(output.outputId) as LeaseStateRow;
          claims.push({
            outputId: row.output_id,
            body: output.body,
            bodyHash: output.bodyHash,
            fencingToken: safeNumber(row.fencing_token, "Fencing token"),
            attempt: safeNumber(row.attempt_count, "Attempt count"),
          });
        }
        return claims;
      })
      .immediate();
  }

  #renew(
    table: "jobs" | "outbox",
    outputId: string,
    workerId: string,
    fencingToken: number,
    leaseExpiresAtMs: number,
  ): void {
    assertTime(fencingToken, "Fencing token");
    assertTime(leaseExpiresAtMs, "Lease expiry");
    const result = this.#database
      .prepare(
        `UPDATE ${table} SET lease_expires_at_ms = ?
         WHERE output_id = ? AND status = 'leased' AND lease_owner = ? AND fencing_token = ?`,
      )
      .run(BigInt(leaseExpiresAtMs), outputId, workerId, BigInt(fencingToken));
    if (result.changes !== 1) throw new Error("Lease renewal rejected by fencing guard");
  }

  #complete(
    table: "jobs" | "outbox",
    outputId: string,
    workerId: string,
    fencingToken: number,
    status: string,
    error: string | null,
  ): void {
    assertTime(fencingToken, "Fencing token");
    const result = this.#database
      .prepare(
        `UPDATE ${table}
         SET status = ?, lease_owner = NULL, lease_expires_at_ms = NULL, last_error = ?
         WHERE output_id = ? AND status = 'leased' AND lease_owner = ? AND fencing_token = ?`,
      )
      .run(status, error, outputId, workerId, BigInt(fencingToken));
    if (result.changes !== 1) throw new Error("Intent completion rejected by fencing guard");
  }
}
