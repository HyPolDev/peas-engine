import {
  computeContentHash,
  computeEventHash,
  type AppendResult,
  type CapturedEvent,
  type EventLog,
  type NewEvent,
  type StoredEvent,
  validateNewEvent,
} from "../../core/event.js";
import { canonicalJson, cloneJson, type JsonValue } from "../../core/json.js";

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

export class InMemoryEventLog implements EventLog {
  readonly #events: StoredEvent[] = [];
  readonly #eventIds = new Map<string, StoredEvent>();
  readonly #dedupeKeys = new Map<string, StoredEvent>();
  readonly #streamVersions = new Map<string, number>();

  append(value: NewEvent): AppendResult {
    const input = validateNewEvent(value);
    const duplicateById = this.#eventIds.get(input.eventId);
    const dedupeIdentity = input.dedupeKey ? `${input.source}\u0000${input.dedupeKey}` : undefined;
    const duplicateByDedupe = dedupeIdentity ? this.#dedupeKeys.get(dedupeIdentity) : undefined;
    const duplicate = duplicateById ?? duplicateByDedupe;
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

    const latestStreamVersion = this.#streamVersions.get(input.subject) ?? 0;
    if (input.streamVersion !== latestStreamVersion + 1) {
      throw new Error(
        `Expected stream version ${latestStreamVersion + 1} for ${input.subject}, received ${input.streamVersion}`,
      );
    }

    const previous = this.#events.at(-1);
    const captured: CapturedEvent = {
      ...input,
      logicalAtMs: Math.max(previous?.logicalAtMs ?? 0, input.observedAtMs),
    };
    const contentHash = computeContentHash(captured);
    const withoutEventHash = {
      ...captured,
      position: String(this.#events.length + 1),
      contentHash,
      previousEventHash: previous?.eventHash ?? "0".repeat(64),
    };
    const stored: StoredEvent = {
      ...withoutEventHash,
      eventHash: computeEventHash(withoutEventHash),
    };
    const immutable = cloneJson(stored as unknown as JsonValue) as StoredEvent;

    this.#events.push(immutable);
    this.#eventIds.set(immutable.eventId, immutable);
    if (dedupeIdentity !== undefined) this.#dedupeKeys.set(dedupeIdentity, immutable);
    this.#streamVersions.set(immutable.subject, immutable.streamVersion);
    return { event: cloneJson(immutable as unknown as JsonValue) as StoredEvent, appended: true };
  }

  readAll(): readonly StoredEvent[] {
    return this.#events.map((event) => cloneJson(event as unknown as JsonValue) as StoredEvent);
  }
}
