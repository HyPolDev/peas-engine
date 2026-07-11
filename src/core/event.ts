import { z } from "zod";

import type { Clock } from "./clock.js";
import { canonicalHash } from "./hash.js";
import {
  assertJson,
  assertJsonWithinLimits,
  assertSchemaPrototypeSafety,
  cloneJson,
  inertJsonSnapshot,
  parseJsonWithinLimits,
  type JsonLimits,
  type JsonObject,
  type JsonValue,
} from "./json.js";

export type ProviderIdentity = Readonly<{
  provider: string;
  recordId: string;
  revisionId: string;
  artifactHash: string;
}>;

/** Untrusted adapter input. Durable capture assigns all local identity and time fields. */
export type EventDraft<TPayload extends JsonObject = JsonObject> = Readonly<{
  envelopeVersion: 2;
  type: string;
  schemaVersion: number;
  source: string;
  subject: string;
  occurredAtMs: number | null;
  correlationId: string;
  causationId?: string;
  provider: ProviderIdentity;
  payload: TPayload;
}>;

export type CapturedEvent<TPayload extends JsonObject = JsonObject> = EventDraft<TPayload> &
  Readonly<{
    eventId: string;
    streamVersion: string;
    receivedAtMs: number;
    logicalAtMs: number;
  }>;

export type StoredEvent<TPayload extends JsonObject = JsonObject> = CapturedEvent<TPayload> &
  Readonly<{
    position: string;
    contentHash: string;
    previousEventHash: string;
    eventHash: string;
  }>;

export type AppendResult = Readonly<{
  event: StoredEvent;
  disposition: "appended" | "redelivery";
}>;

export type EventPage = Readonly<{
  events: readonly StoredEvent[];
  nextPosition: string;
  hasMore: boolean;
}>;

export interface EventLog {
  append(event: EventDraft): Promise<AppendResult>;
  get(position: string): Promise<StoredEvent | undefined>;
  readAfter(position: string, limit: number): Promise<EventPage>;
}

export type CaptureDependencies = Readonly<{ clock: Clock }>;

/** Hard capture-boundary budgets for normalized, untrusted provider data. */
export const EVENT_PAYLOAD_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 50_000,
  maxArrayLength: 10_000,
  maxObjectKeys: 10_000,
  maxStringBytes: 256 * 1_024,
  maxCanonicalBytes: 1_024 * 1_024,
}) satisfies JsonLimits;
const EVENT_ENVELOPE_LIMITS = Object.freeze({
  maxDepth: EVENT_PAYLOAD_LIMITS.maxDepth + 1,
  maxNodes: EVENT_PAYLOAD_LIMITS.maxNodes + 32,
  maxArrayLength: EVENT_PAYLOAD_LIMITS.maxArrayLength,
  maxObjectKeys: EVENT_PAYLOAD_LIMITS.maxObjectKeys,
  maxStringBytes: EVENT_PAYLOAD_LIMITS.maxStringBytes,
  maxCanonicalBytes: EVENT_PAYLOAD_LIMITS.maxCanonicalBytes + 16_384,
}) satisfies JsonLimits;
export const EVENT_SERIALIZED_LIMIT_BYTES = EVENT_ENVELOPE_LIMITS.maxCanonicalBytes;

const identifier = z.string().min(1).max(512);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const epochMs = z.number().int().nonnegative().safe();
const positiveDecimal = z.string().regex(/^[1-9]\d*$/u);
const jsonObjectSchema = z.custom<JsonObject>(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === null,
  "Expected an inert JSON object",
);
const EVENT_SCHEMA_FIELDS = Object.freeze([
  "envelopeVersion",
  "type",
  "schemaVersion",
  "source",
  "subject",
  "occurredAtMs",
  "correlationId",
  "causationId",
  "provider",
  "recordId",
  "revisionId",
  "artifactHash",
  "payload",
  "eventId",
  "streamVersion",
  "receivedAtMs",
  "logicalAtMs",
  "position",
  "contentHash",
  "previousEventHash",
  "eventHash",
]);
const providerIdentitySchema = z
  .object({
    provider: identifier,
    recordId: identifier,
    revisionId: identifier,
    artifactHash: hash,
  })
  .strict();
const eventDraftSchema = z
  .object({
    envelopeVersion: z.literal(2),
    type: identifier,
    schemaVersion: z.number().int().positive().safe(),
    source: identifier,
    subject: identifier,
    occurredAtMs: epochMs.nullable(),
    correlationId: identifier,
    causationId: identifier.optional(),
    provider: providerIdentitySchema,
    payload: jsonObjectSchema,
  })
  .strict();
const capturedEventSchema = eventDraftSchema
  .extend({
    eventId: hash,
    streamVersion: positiveDecimal,
    receivedAtMs: epochMs,
    logicalAtMs: epochMs,
  })
  .strict();
const storedEventSchema = capturedEventSchema
  .extend({
    position: positiveDecimal,
    contentHash: hash,
    previousEventHash: hash,
    eventHash: hash,
  })
  .strict();

function parseEventDraft(value: unknown): EventDraft {
  assertSchemaPrototypeSafety(EVENT_SCHEMA_FIELDS);
  const parsed = eventDraftSchema.parse(inertJsonSnapshot(value as JsonValue));
  assertJsonWithinLimits(parsed.payload, EVENT_PAYLOAD_LIMITS, "$.payload");
  return cloneJson(parsed as EventDraft as unknown as JsonValue) as EventDraft;
}

function parseStoredEvent(value: unknown): StoredEvent {
  assertSchemaPrototypeSafety(EVENT_SCHEMA_FIELDS);
  const parsed = storedEventSchema.parse(inertJsonSnapshot(value as JsonValue));
  assertJsonWithinLimits(parsed.payload, EVENT_PAYLOAD_LIMITS, "$.payload");
  assertJson(parsed);
  return cloneJson(parsed as StoredEvent as unknown as JsonValue) as StoredEvent;
}

export function validateEventDraft(value: unknown): EventDraft {
  assertJsonWithinLimits(value, EVENT_ENVELOPE_LIMITS, "$.event");
  return parseEventDraft(value);
}

/** Bounds a serialized draft before parsing and applies the complete capture-boundary schema. */
export function validateEventDraftJson(serialized: string): EventDraft {
  return parseEventDraft(parseJsonWithinLimits(serialized, EVENT_ENVELOPE_LIMITS, "$.event"));
}

/** Strictly validates the complete durable envelope before any hash or chain checks. */
export function validateStoredEvent(value: unknown): StoredEvent {
  assertJsonWithinLimits(value, EVENT_ENVELOPE_LIMITS, "$.event");
  return parseStoredEvent(value);
}

/** Bounds serialized durable input before parsing, schema validation, or hash verification. */
export function validateStoredEventJson(serialized: string): StoredEvent {
  return parseStoredEvent(parseJsonWithinLimits(serialized, EVENT_ENVELOPE_LIMITS, "$.event"));
}

export function providerKey(identity: ProviderIdentity): string {
  return canonicalHash("peas/provider-identity/v1", {
    provider: identity.provider,
    recordId: identity.recordId,
    revisionId: identity.revisionId,
  });
}

export function deriveEventId(identity: ProviderIdentity): string {
  return canonicalHash("peas/local-event-id/v2", {
    provider: identity.provider,
    recordId: identity.recordId,
    revisionId: identity.revisionId,
    artifactHash: identity.artifactHash,
  });
}

export function draftFromStored(event: StoredEvent): EventDraft {
  const draft: Record<string, JsonValue> = {
    envelopeVersion: event.envelopeVersion,
    type: event.type,
    schemaVersion: event.schemaVersion,
    source: event.source,
    subject: event.subject,
    occurredAtMs: event.occurredAtMs,
    correlationId: event.correlationId,
    provider: event.provider,
    payload: event.payload,
  };
  if (event.causationId !== undefined) draft["causationId"] = event.causationId;
  return draft as EventDraft;
}

export function capturedContent(event: CapturedEvent): JsonObject {
  const content: Record<string, JsonValue> = {
    ...draftFromStored(event as StoredEvent),
    eventId: event.eventId,
    streamVersion: event.streamVersion,
    receivedAtMs: event.receivedAtMs,
    logicalAtMs: event.logicalAtMs,
  };
  return content;
}

export function computeContentHash(event: CapturedEvent): string {
  return canonicalHash("peas/event-content/v2", capturedContent(event));
}

export function computeEventHash(event: Omit<StoredEvent, "eventHash">): string {
  return canonicalHash("peas/event-chain/v2", {
    position: event.position,
    contentHash: event.contentHash,
    previousEventHash: event.previousEventHash,
  });
}

export function verifyStoredEvent(event: StoredEvent, expectedPreviousHash?: string): void {
  const validated = validateStoredEvent(event);
  if (expectedPreviousHash !== undefined && validated.previousEventHash !== expectedPreviousHash) {
    throw new Error(`Event chain mismatch at position ${validated.position}`);
  }
  if (validated.eventId !== deriveEventId(validated.provider)) {
    throw new Error(`Event ID mismatch at position ${validated.position}`);
  }
  if (validated.contentHash !== computeContentHash(validated)) {
    throw new Error(`Content hash mismatch at position ${validated.position}`);
  }
  if (validated.eventHash !== computeEventHash(validated)) {
    throw new Error(`Event hash mismatch at position ${validated.position}`);
  }
}

export function verifyEventPage(events: readonly StoredEvent[], previousHash: string): string {
  let expectedPreviousHash = previousHash;
  for (const event of events) {
    verifyStoredEvent(event, expectedPreviousHash);
    expectedPreviousHash = event.eventHash;
  }
  return expectedPreviousHash;
}

export function assertPageLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new RangeError("Page limit must be an integer between 1 and 10,000");
  }
}
