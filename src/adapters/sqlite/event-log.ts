import type { SqliteDatabase } from "./database.js";

import {
  assertPageLimit,
  computeContentHash,
  computeEventHash,
  deriveEventId,
  draftFromStored,
  providerKey,
  type AppendResult,
  type CaptureDependencies,
  type CapturedEvent,
  type EventDraft,
  type EventLog,
  type EventPage,
  type StoredEvent,
  validateEventDraft,
  verifyStoredEvent,
} from "../../core/event.js";
import { assertJson, canonicalJson, cloneJson, type JsonValue } from "../../core/json.js";

type EventRow = {
  position: bigint;
  event_id: string;
  provider_key: string;
  provider: string;
  provider_record_id: string;
  provider_revision_id: string;
  artifact_hash: string;
  source: string;
  subject: string;
  stream_version: bigint;
  received_at_ms: bigint;
  logical_at_ms: bigint;
  event_json: string;
  content_hash: string;
  previous_event_hash: string;
  event_hash: string;
};

const EVENT_COLUMNS = `position, event_id, provider_key, provider, provider_record_id,
  provider_revision_id, artifact_hash, source, subject, stream_version,
  received_at_ms, logical_at_ms, event_json, content_hash, previous_event_hash, event_hash`;

function parseStoredEvent(serialized: string): StoredEvent {
  const value: unknown = JSON.parse(serialized);
  assertJson(value);
  const event = value as StoredEvent;
  verifyStoredEvent(event);
  return event;
}

function eventFromRow(row: EventRow): StoredEvent {
  const event = parseStoredEvent(row.event_json);
  if (canonicalJson(event as unknown as JsonValue) !== row.event_json) {
    throw new Error(`Event JSON is not canonically encoded at position ${row.position}`);
  }
  if (
    event.position !== row.position.toString() ||
    event.eventId !== row.event_id ||
    providerKey(event.provider) !== row.provider_key ||
    event.provider.provider !== row.provider ||
    event.provider.recordId !== row.provider_record_id ||
    event.provider.revisionId !== row.provider_revision_id ||
    event.provider.artifactHash !== row.artifact_hash ||
    event.source !== row.source ||
    event.subject !== row.subject ||
    event.streamVersion !== row.stream_version.toString() ||
    event.receivedAtMs !== safeNumber(row.received_at_ms, "Event received time") ||
    event.logicalAtMs !== safeNumber(row.logical_at_ms, "Event logical time") ||
    event.contentHash !== row.content_hash ||
    event.previousEventHash !== row.previous_event_hash ||
    event.eventHash !== row.event_hash
  ) {
    throw new Error(`Event relational columns mismatch at position ${row.position}`);
  }
  return event;
}

export function readVerifiedStoredEventAt(
  database: SqliteDatabase,
  position: bigint,
): StoredEvent | undefined {
  const row = database
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE position = ?`)
    .get(position) as EventRow | undefined;
  return row === undefined ? undefined : eventFromRow(row);
}

function safeNumber(value: bigint, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new RangeError(`${label} exceeds JavaScript safe integers`);
  return number;
}

function assertTrustedTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Trusted receipt time must be a non-negative safe integer");
  }
}

function copyEvent(event: StoredEvent): StoredEvent {
  return cloneJson(event as unknown as JsonValue) as StoredEvent;
}

export class SqliteEventLog implements EventLog {
  readonly #database: SqliteDatabase;
  readonly #clock: CaptureDependencies["clock"];

  constructor(database: SqliteDatabase, dependencies: CaptureDependencies) {
    this.#database = database;
    this.#clock = dependencies.clock;
  }

  async append(value: EventDraft): Promise<AppendResult> {
    const input = validateEventDraft(value);
    return this.#database.transaction(() => this.#appendInTransaction(input)).immediate();
  }

  async get(position: string): Promise<StoredEvent | undefined> {
    const event = readVerifiedStoredEventAt(this.#database, BigInt(position));
    return event === undefined ? undefined : copyEvent(event);
  }

  async readAfter(position: string, limit: number): Promise<EventPage> {
    assertPageLimit(limit);
    const cursor = BigInt(position);
    if (cursor < 0n) throw new RangeError("Event cursor cannot be negative");
    let previousHash = "0".repeat(64);
    if (cursor > 0n) {
      const previous = readVerifiedStoredEventAt(this.#database, cursor);
      if (previous === undefined) throw new Error(`Event cursor ${position} does not exist`);
      previousHash = previous.eventHash;
    }
    const rows = this.#database
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE position > ? ORDER BY position LIMIT ?`)
      .all(cursor, BigInt(limit + 1)) as EventRow[];
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map(eventFromRow);
    for (const event of events) {
      verifyStoredEvent(event, previousHash);
      previousHash = event.eventHash;
    }
    return {
      events: events.map(copyEvent),
      nextPosition: events.at(-1)?.position ?? position,
      hasMore,
    };
  }

  #appendInTransaction(input: EventDraft): AppendResult {
    const identityKey = providerKey(input.provider);
    const duplicateRow = this.#database
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE provider_key = ?`)
      .get(identityKey) as EventRow | undefined;
    if (duplicateRow !== undefined) {
      const duplicate = eventFromRow(duplicateRow);
      if (duplicate.provider.artifactHash !== input.provider.artifactHash) {
        throw new Error(
          `Provider record ${input.provider.provider}/${input.provider.recordId}/${input.provider.revisionId} changed content without a new revision`,
        );
      }
      if (
        canonicalJson(draftFromStored(duplicate) as unknown as JsonValue) !== canonicalJson(input)
      ) {
        throw new Error(`Provider redelivery metadata conflicts for ${input.provider.recordId}`);
      }
      return { event: copyEvent(duplicate), disposition: "redelivery" };
    }

    const versionRow = this.#database
      .prepare(
        `SELECT ${EVENT_COLUMNS}
         FROM events WHERE subject = ? ORDER BY stream_version DESC LIMIT 1`,
      )
      .get(input.subject) as EventRow | undefined;
    const versionEvent = versionRow === undefined ? undefined : eventFromRow(versionRow);
    const streamVersion = BigInt(versionEvent?.streamVersion ?? "0") + 1n;
    const headRow = this.#database
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events ORDER BY position DESC LIMIT 1`)
      .get() as EventRow | undefined;
    const head = headRow === undefined ? undefined : eventFromRow(headRow);
    const receivedAtMs = this.#clock.nowMs();
    assertTrustedTime(receivedAtMs);
    const previousLogicalAtMs = head?.logicalAtMs ?? 0;
    const captured: CapturedEvent = {
      ...input,
      eventId: deriveEventId(input.provider),
      streamVersion: streamVersion.toString(),
      receivedAtMs,
      logicalAtMs: Math.max(previousLogicalAtMs, receivedAtMs),
    };
    const position = BigInt(head?.position ?? "0") + 1n;
    const contentHash = computeContentHash(captured);
    const withoutEventHash = {
      ...captured,
      position: position.toString(),
      contentHash,
      previousEventHash: head?.eventHash ?? "0".repeat(64),
    };
    const event: StoredEvent = {
      ...withoutEventHash,
      eventHash: computeEventHash(withoutEventHash),
    };
    this.#database
      .prepare(
        `INSERT INTO events (
          position, event_id, provider_key, provider, provider_record_id,
          provider_revision_id, artifact_hash, source, subject, stream_version,
          received_at_ms, logical_at_ms, event_json, content_hash,
          previous_event_hash, event_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        position,
        event.eventId,
        identityKey,
        event.provider.provider,
        event.provider.recordId,
        event.provider.revisionId,
        event.provider.artifactHash,
        event.source,
        event.subject,
        streamVersion,
        BigInt(event.receivedAtMs),
        BigInt(event.logicalAtMs),
        canonicalJson(event as unknown as JsonValue),
        event.contentHash,
        event.previousEventHash,
        event.eventHash,
      );
    return { event: copyEvent(event), disposition: "appended" };
  }
}
