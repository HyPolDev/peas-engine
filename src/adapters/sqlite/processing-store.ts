import type { SqliteDatabase } from "./database.js";

import {
  assertJson,
  canonicalJson,
  cloneJson,
  type JsonObject,
  type JsonValue,
} from "../../core/json.js";
import type {
  Checkpoint,
  ImmutableOutput,
  ProcessingCommit,
  ProcessingStore,
} from "../../core/processor.js";

type CheckpointRow = {
  manifest_hash: string;
  processed_position: bigint;
  logical_at_ms: bigint;
  state_json: string;
  state_hash: string;
  decision_head: string;
};

type OutputRow = {
  output_id: string;
  input_event_id: string;
  input_position: bigint;
  category: "decision" | "job" | "outbox";
  ordinal: bigint;
  body_json: string;
  body_hash: string;
};

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

function requiredString(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Output field ${key} must be a non-empty string`);
  }
  return value;
}

function requiredInteger(object: JsonObject, key: string): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Output field ${key} must be a non-negative safe integer`);
  }
  return value;
}

function requiredObject(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Output field ${key} must be a JSON object`);
  }
  return value as JsonObject;
}

export class SqliteProcessingStore<TState extends JsonObject> implements ProcessingStore<TState> {
  readonly #database: SqliteDatabase;
  readonly #processorKey: string;

  constructor(database: SqliteDatabase, processorKey: string) {
    if (processorKey.length === 0) throw new TypeError("Processor key cannot be empty");
    this.#database = database;
    this.#processorKey = processorKey;
  }

  loadCheckpoint(): Checkpoint<TState> | undefined {
    const row = this.#database
      .prepare(
        `SELECT manifest_hash, processed_position, logical_at_ms, state_json, state_hash, decision_head
         FROM processor_checkpoints WHERE processor_key = ?`,
      )
      .get(this.#processorKey) as CheckpointRow | undefined;
    if (row === undefined) return undefined;
    const state = parseJsonObject(row.state_json, "Stored processor state");
    return {
      manifestHash: row.manifest_hash,
      processedPosition: row.processed_position.toString(),
      logicalAtMs: safeNumber(row.logical_at_ms, "Checkpoint logical time"),
      state: cloneJson(state) as TState,
      stateHash: row.state_hash,
      decisionHead: row.decision_head,
    };
  }

  readOutputs(): readonly ImmutableOutput[] {
    const rows = this.#database
      .prepare(
        `SELECT output_id, input_event_id, input_position, category, ordinal, body_json, body_hash
         FROM processing_outputs
         WHERE processor_key = ?
         ORDER BY input_position,
           CASE category WHEN 'decision' THEN 1 WHEN 'job' THEN 2 ELSE 3 END,
           ordinal`,
      )
      .all(this.#processorKey) as OutputRow[];
    return rows.map((row) => {
      const body = parseJsonObject(row.body_json, "Stored output body");
      return {
        outputId: row.output_id,
        inputEventId: row.input_event_id,
        inputPosition: row.input_position.toString(),
        category: row.category,
        ordinal: safeNumber(row.ordinal, "Output ordinal"),
        body,
        bodyHash: row.body_hash,
      };
    });
  }

  commit(value: ProcessingCommit<TState>): void {
    this.#database.transaction(() => this.#commitInTransaction(value)).immediate();
  }

  #commitInTransaction(value: ProcessingCommit<TState>): void {
    const current = this.#database
      .prepare("SELECT processed_position FROM processor_checkpoints WHERE processor_key = ?")
      .get(this.#processorKey) as Pick<CheckpointRow, "processed_position"> | undefined;
    const currentPosition = current?.processed_position.toString() ?? "0";
    if (currentPosition !== value.expectedPosition) {
      throw new Error(
        `Checkpoint concurrency conflict: expected ${value.expectedPosition}, found ${currentPosition}`,
      );
    }
    if (value.checkpoint.processedPosition !== value.event.position) {
      throw new Error("Checkpoint position must equal the processed event position");
    }

    const insertOutput = this.#database.prepare(
      `INSERT INTO processing_outputs (
        output_id, processor_key, input_event_id, input_position, category, ordinal,
        body_json, body_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertJob = this.#database.prepare(
      `INSERT INTO jobs (
        job_id, processor_key, job_type, dedupe_key, not_before_logical_ms, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertOutbox = this.#database.prepare(
      `INSERT INTO outbox (outbox_id, processor_key, topic, dedupe_key, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const output of value.outputs) {
      insertOutput.run(
        output.outputId,
        this.#processorKey,
        output.inputEventId,
        BigInt(output.inputPosition),
        output.category,
        BigInt(output.ordinal),
        canonicalJson(output.body),
        output.bodyHash,
      );
      if (output.category === "job") {
        insertJob.run(
          output.outputId,
          this.#processorKey,
          requiredString(output.body, "type"),
          requiredString(output.body, "dedupeKey"),
          BigInt(requiredInteger(output.body, "notBeforeLogicalMs")),
          canonicalJson(requiredObject(output.body, "payload")),
        );
      } else if (output.category === "outbox") {
        insertOutbox.run(
          output.outputId,
          this.#processorKey,
          requiredString(output.body, "topic"),
          requiredString(output.body, "dedupeKey"),
          canonicalJson(requiredObject(output.body, "payload")),
        );
      }
    }

    this.#database
      .prepare(
        `INSERT INTO processor_checkpoints (
          processor_key, manifest_hash, processed_position, logical_at_ms,
          state_json, state_hash, decision_head
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(processor_key) DO UPDATE SET
          manifest_hash = excluded.manifest_hash,
          processed_position = excluded.processed_position,
          logical_at_ms = excluded.logical_at_ms,
          state_json = excluded.state_json,
          state_hash = excluded.state_hash,
          decision_head = excluded.decision_head`,
      )
      .run(
        this.#processorKey,
        value.checkpoint.manifestHash,
        BigInt(value.checkpoint.processedPosition),
        BigInt(value.checkpoint.logicalAtMs),
        canonicalJson(value.checkpoint.state),
        value.checkpoint.stateHash,
        value.checkpoint.decisionHead,
      );
  }
}
