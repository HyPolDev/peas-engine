import {
  assertPageLimit,
  type AppendResult,
  type EventDraft,
  type EventLog,
  type EventPage,
  type StoredEvent,
  verifyStoredEvent,
} from "../../core/event.js";
import { cloneJson, type JsonValue } from "../../core/json.js";

function copyEvent(event: StoredEvent): StoredEvent {
  return cloneJson(event as unknown as JsonValue) as StoredEvent;
}

/** Read-only event log for replaying an already captured and verified stream. */
export class CapturedEventLog implements EventLog {
  readonly #events: readonly StoredEvent[];

  constructor(events: readonly StoredEvent[]) {
    let previousHash = "0".repeat(64);
    let expectedPosition = 1n;
    for (const event of events) {
      if (event.position !== expectedPosition.toString()) {
        throw new Error(`Captured stream position gap at ${event.position}`);
      }
      verifyStoredEvent(event, previousHash);
      previousHash = event.eventHash;
      expectedPosition += 1n;
    }
    this.#events = events.map(copyEvent);
  }

  async append(_event: EventDraft): Promise<AppendResult> {
    throw new Error("A captured replay log is read-only");
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
    const selected = this.#events.slice(Number(cursor), Number(cursor) + limit).map(copyEvent);
    const nextPosition = selected.at(-1)?.position ?? position;
    return {
      events: selected,
      nextPosition,
      hasMore: BigInt(nextPosition) < BigInt(this.#events.length),
    };
  }
}
