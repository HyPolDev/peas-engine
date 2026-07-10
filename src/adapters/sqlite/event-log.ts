import type { SqliteDatabase } from "./database.js";

import {
  computeContentHash,
  computeEventHash,
  type AppendResult,
  type CapturedEvent,
  type EventLog,
  type NewEvent,
  type StoredEvent,
  validateNewEvent,
  verifyEventStream,
} from "../../core/event.js";
import { assertJson, canonicalJson, cloneJson, type JsonValue } from "../../core/json.js";

type EventRow = {
  event_json: string;
};

type HeadRow = {
  position: bigint;
  logical_at_ms: bigint;
  event_hash: string;
};

type VersionRow = {
  stream_version: bigint;
};

function parseStoredEvent(serialized: string): StoredEvent {
  const value: unknown = JSON.parse(serialized);
  assertJson(value);
  return value as StoredEvent;
}

function newEventFromStored(event: StoredEvent): NewEvent {
  const value: Record<string, JsonValue> = {
    envelopeVersion: event.envelopeVersion,
    eventId: event.eventId,
    type: event.type,
    schemaVersion: event.schemaVersion,
    source: event.source,
    subject: event.subject,
    streamVersion: event.streamVersion,
    occurredAtMs: event.occurredAtMs,
    observedAtMs: event.observedAtMs,
    correlationId: event.correlationId,
    payload: event.payload,
  };
  if (event.causationId !== undefined) value["causationId"] = event.causationId;
  if (event.dedupeKey !== undefined) value["dedupeKey"] = event.dedupeKey;
  return value as NewEvent;
}

function safeNumber(value: bigint, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new RangeError(`${label} exceeds JavaScript safe integers`);
  return number;
}

export class SqliteEventLog implements EventLog {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  append(value: NewEvent): AppendResult {
    const input = validateNewEvent(value);
    return this.#database.transaction(() => this.#appendInTransaction(input)).immediate();
  }

  readAll(): readonly StoredEvent[] {
    const rows = this.#database
      .prepare("SELECT event_json FROM events ORDER BY position")
      .all() as EventRow[];
    const events = rows.map((row) => parseStoredEvent(row.event_json));
    verifyEventStream(events);
    return events;
  }

  #appendInTransaction(input: NewEvent): AppendResult {
    const duplicate = this.#findDuplicate(input);
    if (duplicate !== undefined) {
      if (
        canonicalJson(newEventFromStored(duplicate) as unknown as JsonValue) !==
        canonicalJson(input)
      ) {
        throw new Error(`Conflicting duplicate event ${input.eventId}`);
      }
      return {
        event: cloneJson(duplicate as unknown as JsonValue) as StoredEvent,
        appended: false,
      };
    }

    const versionRow = this.#database
      .prepare(
        "SELECT stream_version FROM events WHERE subject = ? ORDER BY stream_version DESC LIMIT 1",
      )
      .get(input.subject) as VersionRow | undefined;
    const latestStreamVersion = versionRow
      ? safeNumber(versionRow.stream_version, "Stream version")
      : 0;
    if (input.streamVersion !== latestStreamVersion + 1) {
      throw new Error(
        `Expected stream version ${latestStreamVersion + 1} for ${input.subject}, received ${input.streamVersion}`,
      );
    }

    const head = this.#database
      .prepare(
        "SELECT position, logical_at_ms, event_hash FROM events ORDER BY position DESC LIMIT 1",
      )
      .get() as HeadRow | undefined;
    const position = (head?.position ?? 0n) + 1n;
    const previousLogicalAtMs = head ? safeNumber(head.logical_at_ms, "Logical time") : 0;
    const captured: CapturedEvent = {
      ...input,
      logicalAtMs: Math.max(previousLogicalAtMs, input.observedAtMs),
    };
    const contentHash = computeContentHash(captured);
    const withoutEventHash = {
      ...captured,
      position: position.toString(),
      contentHash,
      previousEventHash: head?.event_hash ?? "0".repeat(64),
    };
    const event: StoredEvent = {
      ...withoutEventHash,
      eventHash: computeEventHash(withoutEventHash),
    };

    this.#database
      .prepare(
        `INSERT INTO events (
          position, event_id, source, dedupe_key, subject, stream_version, logical_at_ms,
          event_json, content_hash, previous_event_hash, event_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        position,
        event.eventId,
        event.source,
        event.dedupeKey ?? null,
        event.subject,
        BigInt(event.streamVersion),
        BigInt(event.logicalAtMs),
        canonicalJson(event as unknown as JsonValue),
        event.contentHash,
        event.previousEventHash,
        event.eventHash,
      );
    return { event: cloneJson(event as unknown as JsonValue) as StoredEvent, appended: true };
  }

  #findDuplicate(input: NewEvent): StoredEvent | undefined {
    const byId = this.#database
      .prepare("SELECT event_json FROM events WHERE event_id = ?")
      .get(input.eventId) as EventRow | undefined;
    if (byId !== undefined) return parseStoredEvent(byId.event_json);
    if (input.dedupeKey === undefined) return undefined;
    const byDedupe = this.#database
      .prepare("SELECT event_json FROM events WHERE source = ? AND dedupe_key = ?")
      .get(input.source, input.dedupeKey) as EventRow | undefined;
    return byDedupe ? parseStoredEvent(byDedupe.event_json) : undefined;
  }
}
