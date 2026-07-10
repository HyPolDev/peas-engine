import { z } from "zod";

import { canonicalHash } from "./hash.js";
import { assertJson, cloneJson, type JsonObject, type JsonValue } from "./json.js";

export type NewEvent<TPayload extends JsonObject = JsonObject> = Readonly<{
  envelopeVersion: 1;
  eventId: string;
  type: string;
  schemaVersion: number;
  source: string;
  subject: string;
  streamVersion: number;
  occurredAtMs: number | null;
  observedAtMs: number;
  correlationId: string;
  causationId?: string;
  dedupeKey?: string;
  payload: TPayload;
}>;

export type CapturedEvent<TPayload extends JsonObject = JsonObject> = NewEvent<TPayload> &
  Readonly<{ logicalAtMs: number }>;

export type StoredEvent<TPayload extends JsonObject = JsonObject> = CapturedEvent<TPayload> &
  Readonly<{
    position: string;
    contentHash: string;
    previousEventHash: string;
    eventHash: string;
  }>;

export type AppendResult = Readonly<{ event: StoredEvent; appended: boolean }>;

export interface EventLog {
  append(event: NewEvent): AppendResult;
  readAll(): readonly StoredEvent[];
}

const identifier = z.string().min(1).max(256);
const epochMs = z.number().int().nonnegative().safe();
const newEventSchema = z
  .object({
    envelopeVersion: z.literal(1),
    eventId: identifier,
    type: identifier,
    schemaVersion: z.number().int().positive().safe(),
    source: identifier,
    subject: identifier,
    streamVersion: z.number().int().positive().safe(),
    occurredAtMs: epochMs.nullable(),
    observedAtMs: epochMs,
    correlationId: identifier,
    causationId: identifier.optional(),
    dedupeKey: identifier.optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export function validateNewEvent(value: unknown): NewEvent {
  const parsed = newEventSchema.parse(value);
  assertJson(parsed.payload);
  return cloneJson(parsed as NewEvent as unknown as JsonValue) as NewEvent;
}

export function capturedContent(event: CapturedEvent): JsonObject {
  const content: Record<string, JsonValue> = {
    envelopeVersion: event.envelopeVersion,
    eventId: event.eventId,
    type: event.type,
    schemaVersion: event.schemaVersion,
    source: event.source,
    subject: event.subject,
    streamVersion: event.streamVersion,
    occurredAtMs: event.occurredAtMs,
    observedAtMs: event.observedAtMs,
    logicalAtMs: event.logicalAtMs,
    correlationId: event.correlationId,
    payload: event.payload,
  };
  if (event.causationId !== undefined) content["causationId"] = event.causationId;
  if (event.dedupeKey !== undefined) content["dedupeKey"] = event.dedupeKey;
  return content;
}

export function computeContentHash(event: CapturedEvent): string {
  return canonicalHash("peas/event-content/v1", capturedContent(event));
}

export function computeEventHash(event: Omit<StoredEvent, "eventHash">): string {
  return canonicalHash("peas/event-chain/v1", {
    position: event.position,
    contentHash: event.contentHash,
    previousEventHash: event.previousEventHash,
  });
}

export function verifyEventStream(events: readonly StoredEvent[]): void {
  let previousEventHash = "0".repeat(64);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) throw new Error("Event stream contains a missing entry");
    const expectedPosition = String(index + 1);
    if (event.position !== expectedPosition) {
      throw new Error(`Expected event position ${expectedPosition}, received ${event.position}`);
    }
    if (event.previousEventHash !== previousEventHash) {
      throw new Error(`Event chain mismatch at position ${event.position}`);
    }
    if (event.contentHash !== computeContentHash(event)) {
      throw new Error(`Content hash mismatch at position ${event.position}`);
    }
    const expectedHash = computeEventHash(event);
    if (event.eventHash !== expectedHash) {
      throw new Error(`Event hash mismatch at position ${event.position}`);
    }
    previousEventHash = event.eventHash;
  }
}
