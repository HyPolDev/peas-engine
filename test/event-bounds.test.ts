import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import test from "node:test";

import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { ManualClock } from "../src/core/clock.js";
import {
  EVENT_PAYLOAD_LIMITS,
  type EventDraft,
  validateEventDraft,
  validateStoredEvent,
} from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import {
  assertJsonWithinLimits,
  canonicalJson,
  type JsonLimits,
  type JsonObject,
} from "../src/core/json.js";

const NOW_MS = 1_900_000_000_000;
const migrations = loadMigrations(join(process.cwd(), "migrations"));

function limits(overrides: Partial<JsonLimits> = {}): JsonLimits {
  return {
    maxDepth: 4,
    maxNodes: 16,
    maxArrayLength: 4,
    maxObjectKeys: 4,
    maxStringBytes: 8,
    maxCanonicalBytes: 64,
    ...overrides,
  };
}

function draft(payload: JsonObject, recordId = "bounded-event"): EventDraft {
  return {
    envelopeVersion: 2,
    type: "provider.normalized",
    schemaVersion: 1,
    source: "bounds-test",
    subject: "bounds:test",
    occurredAtMs: NOW_MS,
    correlationId: recordId,
    provider: {
      provider: "bounds-provider",
      recordId,
      revisionId: "1",
      artifactHash: canonicalHash("peas/event-bounds-artifact/v1", { recordId }),
    },
    payload,
  };
}

function overDepthPayload(): JsonObject {
  let value: JsonObject = { leaf: true };
  for (let depth = 0; depth < EVENT_PAYLOAD_LIMITS.maxDepth; depth += 1) {
    value = { child: value };
  }
  return value;
}

test("iterative JSON budgets enforce every resource dimension before canonicalization", () => {
  assert.deepEqual(assertJsonWithinLimits({ a: ["é", 1] }, limits()), {
    nodes: 4,
    maxDepth: 3,
    canonicalBytes: 14,
  });

  assert.throws(
    () => assertJsonWithinLimits({ a: { b: { c: true } } }, limits({ maxDepth: 3 })),
    /depth limit/u,
  );
  assert.throws(
    () => assertJsonWithinLimits([1, 2, 3], limits({ maxNodes: 3 })),
    /node JSON limit/u,
  );
  assert.throws(
    () => assertJsonWithinLimits([1, 2, 3], limits({ maxArrayLength: 2 })),
    /item array limit/u,
  );
  assert.throws(
    () => assertJsonWithinLimits({ a: 1, b: 2, c: 3 }, limits({ maxObjectKeys: 2 })),
    /key object limit/u,
  );
  assert.throws(
    () => assertJsonWithinLimits("ééé", limits({ maxStringBytes: 4 })),
    /byte string limit/u,
  );
  assert.throws(
    () => assertJsonWithinLimits({ x: "\u0000" }, limits({ maxCanonicalBytes: 12 })),
    /canonical JSON limit/u,
  );

  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  assert.throws(() => assertJsonWithinLimits(cyclic, limits()), /cyclic JSON reference/u);
});

test("UTF-8 string and canonical byte boundaries are exact for ASCII, CJK, and emoji", () => {
  const cases = [
    { label: "ASCII", unit: "a", repeats: 8 },
    { label: "CJK", unit: "界", repeats: 4 },
    { label: "emoji", unit: "🧪", repeats: 4 },
  ] as const;

  for (const { label, unit, repeats } of cases) {
    const exact = unit.repeat(repeats);
    const stringBytes = Buffer.byteLength(exact, "utf8");
    const canonicalBytes = Buffer.byteLength(JSON.stringify(exact), "utf8");
    assert.doesNotThrow(
      () =>
        assertJsonWithinLimits(
          exact,
          limits({ maxStringBytes: stringBytes, maxCanonicalBytes: canonicalBytes }),
        ),
      `${label} exact boundary`,
    );
    assert.throws(
      () =>
        assertJsonWithinLimits(
          `${exact}${unit}`,
          limits({ maxStringBytes: stringBytes, maxCanonicalBytes: canonicalBytes + 16 }),
        ),
      /byte string limit/u,
      `${label} string one-over boundary`,
    );
    assert.throws(
      () =>
        assertJsonWithinLimits(
          exact,
          limits({ maxStringBytes: stringBytes, maxCanonicalBytes: canonicalBytes - 1 }),
        ),
      /canonical JSON limit/u,
      `${label} canonical one-under boundary`,
    );
    assert.doesNotThrow(
      () =>
        assertJsonWithinLimits(
          { [exact]: true },
          limits({ maxStringBytes: stringBytes, maxCanonicalBytes: canonicalBytes + 16 }),
        ),
      `${label} key exact boundary`,
    );
    assert.throws(
      () =>
        assertJsonWithinLimits(
          { [`${exact}${unit}`]: true },
          limits({ maxStringBytes: stringBytes, maxCanonicalBytes: canonicalBytes + 32 }),
        ),
      /key exceeds .*byte string limit/u,
      `${label} key one-over boundary`,
    );
  }
});

test("accessor and Proxy backed values cannot change after budget validation", () => {
  let accessorReads = 0;
  const accessorValue: Record<string, unknown> = {};
  Object.defineProperty(accessorValue, "unstable", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return accessorReads === 1 ? "small" : overDepthPayload();
    },
  });
  const accessorDraft = draft({ nested: accessorValue as JsonObject }, "accessor-json");
  assert.throws(() => validateEventDraft(accessorDraft), /accessor property/u);
  assert.throws(() => canonicalJson(accessorDraft.payload), /accessor property/u);
  assert.equal(accessorReads, 0, "validation must inspect descriptors without invoking getters");

  const proxied = new Proxy({ stable: true }, {});
  const proxyDraft = draft({ nested: proxied }, "proxy-json");
  assert.throws(() => validateEventDraft(proxyDraft), /cannot be a Proxy/u);
  assert.throws(() => canonicalJson(proxyDraft.payload), /cannot be a Proxy/u);

  let envelopeAccessorReads = 0;
  const accessorEnvelope = { ...draft({ stable: true }, "accessor-envelope") } as Record<
    string,
    unknown
  >;
  Object.defineProperty(accessorEnvelope, "payload", {
    enumerable: true,
    get: () => {
      envelopeAccessorReads += 1;
      return { stable: true };
    },
  });
  assert.throws(() => validateEventDraft(accessorEnvelope), /accessor property/u);
  assert.equal(envelopeAccessorReads, 0, "envelope getters must not run before validation");

  let envelopeProxyReads = 0;
  const proxyEnvelope = new Proxy(draft({ stable: true }, "proxy-envelope"), {
    get: (target, property, receiver) => {
      envelopeProxyReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.throws(() => validateEventDraft(proxyEnvelope), /cannot be a Proxy/u);
  assert.equal(envelopeProxyReads, 0, "envelope Proxy traps must not run before validation");
});

test("memory and SQLite capture reject over-depth and oversized event drafts atomically", async () => {
  const clock = new ManualClock(NOW_MS);
  const memory = new InMemoryEventLog({ clock });
  const database = openSqliteDatabase(":memory:", migrations);
  const sqlite = new SqliteEventLog(database, { clock });
  const oversizedChunks = Array.from({ length: 5 }, () =>
    "x".repeat(EVENT_PAYLOAD_LIMITS.maxStringBytes),
  );
  const cases: readonly (readonly [string, EventDraft])[] = [
    ["depth", draft(overDepthPayload(), "over-depth")],
    ["canonical bytes", draft({ chunks: oversizedChunks }, "over-bytes")],
  ];

  try {
    for (const [label, event] of cases) {
      await assert.rejects(() => memory.append(event), `memory ${label}`);
      await assert.rejects(() => sqlite.append(event), `SQLite ${label}`);
    }
    assert.equal((await memory.readAfter("0", 10)).events.length, 0);
    assert.equal((await sqlite.readAfter("0", 10)).events.length, 0);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    database.close();
  }
});

test("stored-envelope validation applies payload budgets before hash verification", async () => {
  const eventLog = new InMemoryEventLog({ clock: new ManualClock(NOW_MS) });
  const captured = await eventLog.append(draft({ accepted: true }, "stored-bounds"));
  const oversized = structuredClone(captured.event) as unknown as Record<string, unknown>;
  oversized["payload"] = overDepthPayload();

  assert.throws(() => validateEventDraft(draft(overDepthPayload(), "draft-bounds")), /depth/u);
  assert.throws(() => validateStoredEvent(oversized), /depth/u);
});

test("SQLite reads budget hostile stored depth before recursive canonicalization", async () => {
  const clock = new ManualClock(NOW_MS);
  const database = openSqliteDatabase(":memory:", migrations);
  const eventLog = new SqliteEventLog(database, { clock });
  try {
    const captured = await eventLog.append(draft({ accepted: true }, "stored-sqlite-depth"));
    const serialized = canonicalJson(captured.event);
    const originalPayload = canonicalJson(captured.event.payload);
    const hostilePayload = `${'{"child":'.repeat(10_000)}null${"}".repeat(10_000)}`;
    const corrupted = serialized.replace(
      `"payload":${originalPayload}`,
      `"payload":${hostilePayload}`,
    );
    assert.notEqual(corrupted, serialized);
    database.exec("DROP TRIGGER events_no_update");
    database.prepare("UPDATE events SET event_json = ? WHERE position = 1").run(corrupted);

    await assert.rejects(() => eventLog.get("1"), /depth limit/u);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    database.close();
  }
});
