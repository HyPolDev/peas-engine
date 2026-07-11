import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import test from "node:test";

import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { ManualClock } from "../src/core/clock.js";
import {
  EVENT_SERIALIZED_LIMIT_BYTES,
  type EventDraft,
  validateEventDraft,
  validateEventDraftJson,
  validateStoredEventJson,
} from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import {
  assertJsonWithinLimits,
  canonicalJson,
  type JsonLimits,
  type JsonObject,
  parseJsonWithinLimits,
} from "../src/core/json.js";

const NOW_MS = 1_900_000_000_000;

function draft(payload: JsonObject = { accepted: true }): EventDraft {
  return {
    envelopeVersion: 2,
    type: "provider.normalized",
    schemaVersion: 1,
    source: "inert-json-test",
    subject: "inert:test",
    occurredAtMs: NOW_MS,
    correlationId: "inert-json",
    provider: {
      provider: "test-provider",
      recordId: "inert-json",
      revisionId: "1",
      artifactHash: canonicalHash("peas/inert-json-artifact/v1", { fixture: "inert" }),
    },
    payload,
  };
}

function limits(overrides: Partial<JsonLimits> = {}): JsonLimits {
  return {
    maxDepth: 8,
    maxNodes: 64,
    maxArrayLength: 16,
    maxObjectKeys: 16,
    maxStringBytes: 64,
    maxCanonicalBytes: 256,
    ...overrides,
  };
}

test("event validation rejects hidden accessors without invoking their behavior", () => {
  let payloadReads = 0;
  const hiddenPayload = { ...draft() } as Record<string, unknown>;
  Object.defineProperty(hiddenPayload, "payload", {
    configurable: true,
    enumerable: false,
    get() {
      payloadReads += 1;
      return { accepted: payloadReads === 1 };
    },
  });
  assert.throws(() => validateEventDraft(hiddenPayload), /accessor property/u);
  assert.equal(payloadReads, 0);

  let behaviorReads = 0;
  const hiddenBehavior = { ...draft() } as Record<string, unknown>;
  Object.defineProperty(hiddenBehavior, "behavior", {
    enumerable: false,
    get() {
      behaviorReads += 1;
      return { effectsAllowed: true };
    },
  });
  assert.throws(() => validateEventDraft(hiddenBehavior), /accessor property/u);
  assert.equal(behaviorReads, 0);
});

test("schema validation rejects inherited required fields without invoking prototype behavior", () => {
  const candidate = { ...draft() } as Record<string, unknown>;
  delete candidate["payload"];
  let inheritedReads = 0;
  Object.defineProperty(Object.prototype, "payload", {
    configurable: true,
    get() {
      inheritedReads += 1;
      return { inherited: true };
    },
  });
  try {
    assert.throws(
      () => validateEventDraft(candidate),
      /Object\.prototype contains schema field payload/u,
    );
    assert.equal(inheritedReads, 0);
  } finally {
    delete (Object.prototype as Record<string, unknown>)["payload"];
  }
});

test("inert JSON rejects non-enumerable data, symbols, and Proxies before active behavior", () => {
  const hiddenData = { ...draft() } as Record<string, unknown>;
  Object.defineProperty(hiddenData, "hidden", { enumerable: false, value: true });
  assert.throws(() => validateEventDraft(hiddenData), /non-enumerable property/u);
  assert.throws(
    () => canonicalJson(hiddenData as unknown as JsonObject),
    /non-enumerable property/u,
  );

  const symbolData = { ...draft() } as Record<PropertyKey, unknown>;
  Object.defineProperty(symbolData, Symbol("hidden"), { enumerable: true, value: true });
  assert.throws(() => validateEventDraft(symbolData), /symbol properties/u);

  let ownKeyTraps = 0;
  const proxied = new Proxy(draft(), {
    ownKeys(target) {
      ownKeyTraps += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.throws(() => validateEventDraft(proxied), /cannot be a Proxy/u);
  assert.equal(ownKeyTraps, 0, "Proxy traps must not run during rejection");
});

test("event payloads reject __proto__ explicitly before Zod normalization", () => {
  const payload = JSON.parse('{"__proto__":{"polluted":true},"accepted":true}') as JsonObject;
  assert.equal(Object.hasOwn(payload, "__proto__"), true);
  assert.throws(() => validateEventDraft(draft(payload)), /forbidden JSON key __proto__/u);

  const serialized = JSON.stringify({ ...draft(), payload });
  assert.throws(() => validateEventDraftJson(serialized), /forbidden JSON key __proto__/u);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
});

test("object key budgets are enforced before key sorting", () => {
  const sortDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "sort");
  assert.ok(sortDescriptor);
  let sortCalls = 0;
  Object.defineProperty(Array.prototype, "sort", {
    ...sortDescriptor,
    value(this: unknown[], ...arguments_: unknown[]) {
      sortCalls += 1;
      return Reflect.apply(
        sortDescriptor.value as (...values: unknown[]) => unknown,
        this,
        arguments_,
      );
    },
  });

  let thrown: unknown;
  try {
    try {
      assertJsonWithinLimits({ b: 2, a: 1 }, limits({ maxObjectKeys: 1 }));
    } catch (error) {
      thrown = error;
    }
  } finally {
    Object.defineProperty(Array.prototype, "sort", sortDescriptor);
  }

  assert.match(String(thrown), /1-key object limit/u);
  assert.equal(sortCalls, 0);
});

test("serialized byte budgets reject hostile input before JSON.parse", () => {
  const exact = '{"a":1}';
  assert.deepEqual(
    parseJsonWithinLimits(
      exact,
      limits({ maxCanonicalBytes: Buffer.byteLength(exact, "utf8") }),
      "$.fixture",
    ),
    { a: 1 },
  );

  const syntacticallyInvalidAndOversized = `${" ".repeat(9)}{`;
  assert.throws(
    () =>
      parseJsonWithinLimits(
        syntacticallyInvalidAndOversized,
        limits({ maxCanonicalBytes: 8 }),
        "$.fixture",
      ),
    /8-byte serialized JSON limit/u,
  );

  const hostileEvent = `${" ".repeat(EVENT_SERIALIZED_LIMIT_BYTES + 1)}{`;
  assert.throws(
    () => validateStoredEventJson(hostileEvent),
    new RegExp(`${EVENT_SERIALIZED_LIMIT_BYTES}-byte serialized JSON limit`, "u"),
  );
});

test("SQLite event reads preflight hostile serialized rows before parsing", async () => {
  const database = openSqliteDatabase(
    ":memory:",
    loadMigrations(join(process.cwd(), "migrations")),
  );
  const eventLog = new SqliteEventLog(database, { clock: new ManualClock(NOW_MS) });
  try {
    const appended = await eventLog.append(draft());
    const hostileEvent = `${" ".repeat(EVENT_SERIALIZED_LIMIT_BYTES + 1)}{`;
    database.exec("DROP TRIGGER events_no_update");
    database
      .prepare("UPDATE events SET event_json = ? WHERE position = ?")
      .run(hostileEvent, BigInt(appended.event.position));

    await assert.rejects(
      () => eventLog.get(appended.event.position),
      new RegExp(`${EVENT_SERIALIZED_LIMIT_BYTES}-byte serialized JSON limit`, "u"),
    );
  } finally {
    database.close();
  }
});
