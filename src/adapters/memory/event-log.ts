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
} from "../../core/event.js";
import { canonicalJson, cloneJson, type JsonValue } from "../../core/json.js";

function copyEvent(event: StoredEvent): StoredEvent {
  return cloneJson(event as unknown as JsonValue) as StoredEvent;
}

function assertTrustedTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Trusted receipt time must be a non-negative safe integer");
  }
}

export class InMemoryEventLog implements EventLog {
  readonly #clock: CaptureDependencies["clock"];
  readonly #events: StoredEvent[] = [];
  readonly #providerEvents = new Map<string, StoredEvent>();
  readonly #streamVersions = new Map<string, bigint>();

  constructor(dependencies: CaptureDependencies) {
    this.#clock = dependencies.clock;
  }

  async append(value: EventDraft): Promise<AppendResult> {
    const input = validateEventDraft(value);
    const identityKey = providerKey(input.provider);
    const existing = this.#providerEvents.get(identityKey);
    if (existing !== undefined) {
      if (existing.provider.artifactHash !== input.provider.artifactHash) {
        throw new Error(
          `Provider record ${input.provider.provider}/${input.provider.recordId}/${input.provider.revisionId} changed content without a new revision`,
        );
      }
      if (
        canonicalJson(draftFromStored(existing) as unknown as JsonValue) !== canonicalJson(input)
      ) {
        throw new Error(`Provider redelivery metadata conflicts for ${input.provider.recordId}`);
      }
      return { event: copyEvent(existing), disposition: "redelivery" };
    }

    const receivedAtMs = this.#clock.nowMs();
    assertTrustedTime(receivedAtMs);
    const previous = this.#events.at(-1);
    const streamVersion = (this.#streamVersions.get(input.subject) ?? 0n) + 1n;
    const captured: CapturedEvent = {
      ...input,
      eventId: deriveEventId(input.provider),
      streamVersion: streamVersion.toString(),
      receivedAtMs,
      logicalAtMs: Math.max(previous?.logicalAtMs ?? 0, receivedAtMs),
    };
    const contentHash = computeContentHash(captured);
    const withoutEventHash = {
      ...captured,
      position: String(this.#events.length + 1),
      contentHash,
      previousEventHash: previous?.eventHash ?? "0".repeat(64),
    };
    const event: StoredEvent = {
      ...withoutEventHash,
      eventHash: computeEventHash(withoutEventHash),
    };
    const immutable = copyEvent(event);
    this.#events.push(immutable);
    this.#providerEvents.set(identityKey, immutable);
    this.#streamVersions.set(input.subject, streamVersion);
    return { event: copyEvent(immutable), disposition: "appended" };
  }

  async get(position: string): Promise<StoredEvent | undefined> {
    const numeric = BigInt(position);
    if (numeric < 1n || numeric > BigInt(this.#events.length)) return undefined;
    const event = this.#events[Number(numeric - 1n)];
    return event ? copyEvent(event) : undefined;
  }

  async readAfter(position: string, limit: number): Promise<EventPage> {
    assertPageLimit(limit);
    const cursor = BigInt(position);
    if (cursor < 0n) throw new RangeError("Event cursor cannot be negative");
    const start = Number(cursor);
    const selected = this.#events.slice(start, start + limit).map(copyEvent);
    const nextPosition = selected.at(-1)?.position ?? position;
    return {
      events: selected,
      nextPosition,
      hasMore: BigInt(nextPosition) < BigInt(this.#events.length),
    };
  }
}
