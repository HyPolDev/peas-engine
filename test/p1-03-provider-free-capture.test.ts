import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson, type JsonValue } from "../src/core/json.js";
import {
  P1_03_EFFECTS_ZERO,
  P1_03_LIMITS,
  P103CaptureContractError,
  type P103AllowlistEntry,
  type P103CaptureRequest,
  type P103Fixture,
  type P103ReasonCode,
} from "../src/adapters/read-only-capture/contracts.js";
import { createProviderFreeCaptureSession } from "../src/adapters/read-only-capture/provider-free.js";

const allowlist = Object.freeze([
  { sourceId: "sec", issuerId: "issuer-a", resourceId: "filings" },
  { sourceId: "fmp", issuerId: "issuer-a", resourceId: "calendar" },
  { sourceId: "issuer-ir", issuerId: "synthetic-nvda", resourceId: "rss" },
] as const);

function fixture(
  sourceId: P103Fixture["sourceId"],
  resourceId: string,
  revisionId = "revision-1",
  bytes: readonly number[] = [1, 2, 3],
): P103Fixture {
  return {
    sourceId,
    issuerId: sourceId === "issuer-ir" ? "synthetic-nvda" : "issuer-a",
    resourceId,
    recordId: `${sourceId}-record`,
    revisionId,
    publishedAtMs: 1_800_000_000_000,
    retrievedAtMs: 1_800_000_000_100,
    contentType: "application/octet-stream",
    bytes,
  };
}

function request(value: P103Fixture): P103CaptureRequest {
  return {
    sourceId: value.sourceId,
    issuerId: value.issuerId,
    resourceId: value.resourceId,
    recordId: value.recordId,
    revisionId: value.revisionId,
  };
}

function session(
  fixtures: readonly P103Fixture[] = [
    fixture("sec", "filings"),
    fixture("fmp", "calendar"),
    fixture("issuer-ir", "rss"),
  ],
) {
  return createProviderFreeCaptureSession({
    entitlementMode: "provider-free-local-fixture",
    allowlist,
    fixtures,
  });
}

function rejects(reasonCode: P103ReasonCode): (error: unknown) => boolean {
  return (error) => error instanceof P103CaptureContractError && error.reasonCode === reasonCode;
}

test("captures all three closed source lanes with deterministic provenance and zero effects", () => {
  const fixtures = [
    fixture("sec", "filings"),
    fixture("fmp", "calendar"),
    fixture("issuer-ir", "rss"),
  ];
  const capture = session(fixtures);
  const receipts = fixtures.map((value) => capture.capture(request(value)));
  assert.deepEqual(
    receipts.map((value) => value.sourceId),
    ["sec", "fmp", "issuer-ir"],
  );
  for (const receipt of receipts) {
    assert.match(receipt.captureId, /^[a-f0-9]{64}$/u);
    assert.match(receipt.rawSha256, /^[a-f0-9]{64}$/u);
    assert.equal(receipt.duplicate, false);
    assert.deepEqual(receipt.effects, P1_03_EFFECTS_ZERO);
    assert.equal(Object.isFrozen(receipt), true);
  }
  assert.deepEqual(capture.snapshot().effects, P1_03_EFFECTS_ZERO);
});

test("closed allowlist and fixture identity fail before lookup", () => {
  const capture = session();
  const unknown = request(fixture("sec", "filings"));
  assert.throws(
    () => capture.capture({ ...unknown, issuerId: "issuer-not-allowed" }),
    rejects("p1-03.capture-not-allowlisted"),
  );
  assert.throws(
    () => capture.capture({ ...unknown, recordId: "missing-record" }),
    rejects("p1-03.fixture-missing"),
  );
  assert.throws(
    () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: [fixture("fmp", "calendar")],
      }),
    rejects("p1-03.fixture-not-allowlisted"),
  );
});

test("exact duplicates retain once and corrections remain distinct", () => {
  const initial = fixture("sec", "filings", "revision-1", [1, 2, 3]);
  const correction = fixture("sec", "filings", "revision-2", [1, 2, 4]);
  const capture = session([initial, correction]);
  const first = capture.capture(request(initial));
  const duplicate = capture.capture(request(initial));
  const corrected = capture.capture(request(correction));
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.captureId, first.captureId);
  assert.notEqual(corrected.captureId, first.captureId);
  assert.deepEqual(capture.snapshot(), {
    entitlementMode: "provider-free-local-fixture",
    receipts: [first, corrected].sort((left, right) =>
      left.captureId.localeCompare(right.captureId),
    ),
    totalUniqueCaptures: 2,
    uniqueRetainedDigests: 2,
    retainedBytes: 6,
    effects: P1_03_EFFECTS_ZERO,
  });
});

test("distinct capture identities sharing exact raw bytes retain one private digest copy", () => {
  const initial = fixture("sec", "filings", "revision-1", [1, 2, 3]);
  const sameRawCorrection = fixture("sec", "filings", "revision-2", [1, 2, 3]);
  const capture = session([initial, sameRawCorrection]);
  capture.capture(request(initial));
  capture.capture(request(sameRawCorrection));
  assert.equal(capture.snapshot().totalUniqueCaptures, 2);
  assert.equal(capture.snapshot().uniqueRetainedDigests, 1);
  assert.equal(capture.snapshot().retainedBytes, 3);
});

test("construction and read boundaries isolate caller mutation", () => {
  const bytes = [10, 20, 30];
  const entry = { sourceId: "sec", issuerId: "issuer-a", resourceId: "filings" } as const;
  const value = fixture("sec", "filings", "revision-1", bytes);
  const input = {
    entitlementMode: "provider-free-local-fixture" as const,
    allowlist: [entry],
    fixtures: [value],
  };
  const capture = createProviderFreeCaptureSession(input);
  bytes[0] = 255;
  (input.allowlist as P103AllowlistEntry[])[0] = {
    sourceId: "fmp",
    issuerId: "changed",
    resourceId: "changed",
  };
  const receipt = capture.capture(request(value));
  const firstRead = capture.readRaw(receipt.rawSha256);
  assert.deepEqual(firstRead, Uint8Array.from([10, 20, 30]));
  assert.ok(firstRead);
  firstRead[0] = 99;
  assert.deepEqual(capture.readRaw(receipt.rawSha256), Uint8Array.from([10, 20, 30]));
});

test("construction and capture order permutations produce byte-identical snapshots", () => {
  const fixtures = [
    fixture("sec", "filings"),
    fixture("fmp", "calendar"),
    fixture("issuer-ir", "rss"),
  ];
  const left = session(fixtures);
  for (const value of fixtures) left.capture(request(value));
  const right = createProviderFreeCaptureSession({
    entitlementMode: "provider-free-local-fixture",
    allowlist: [...allowlist].reverse(),
    fixtures: [...fixtures].reverse(),
  });
  for (const value of [...fixtures].reverse()) right.capture(request(value));
  assert.equal(
    canonicalJson(left.snapshot() as unknown as JsonValue),
    canonicalJson(right.snapshot() as unknown as JsonValue),
  );
});

test("exact and one-over count, byte, retained-byte, and string bounds fail closed", () => {
  const entries = Array.from({ length: P1_03_LIMITS.maxAllowlistEntries }, (_, index) => ({
    sourceId: "sec" as const,
    issuerId: `issuer-${index}`,
    resourceId: "filings",
  }));
  const exactFixture = fixture(
    "sec",
    "filings",
    "revision-exact",
    new Array(P1_03_LIMITS.maxFixtureBytes).fill(0),
  );
  assert.doesNotThrow(() =>
    createProviderFreeCaptureSession({
      entitlementMode: "provider-free-local-fixture",
      allowlist: [allowlist[0]],
      fixtures: [exactFixture],
    }),
  );
  assert.throws(
    () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [...entries, { sourceId: "fmp", issuerId: "one-over", resourceId: "x" }],
        fixtures: [fixture("sec", "filings")],
      }),
    rejects("p1-03.allowlist-limit"),
  );
  assert.throws(
    () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: [
          fixture(
            "sec",
            "filings",
            "revision-over",
            new Array(P1_03_LIMITS.maxFixtureBytes + 1).fill(0),
          ),
        ],
      }),
    rejects("p1-03.fixture-byte-limit"),
  );
  const sixtyFour = Array.from({ length: P1_03_LIMITS.maxFixtures }, (_, index) =>
    fixture("sec", "filings", `revision-${index}`, [index]),
  );
  assert.doesNotThrow(() =>
    createProviderFreeCaptureSession({
      entitlementMode: "provider-free-local-fixture",
      allowlist: [allowlist[0]],
      fixtures: sixtyFour,
    }),
  );
  assert.throws(
    () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: [...sixtyFour, fixture("sec", "filings", "revision-over", [0])],
      }),
    rejects("p1-03.fixture-limit"),
  );
  const retainedExact = Array.from({ length: 4 }, (_, index) =>
    fixture("sec", "filings", `retained-${index}`, new Array(2_097_152).fill(index)),
  );
  assert.doesNotThrow(() =>
    createProviderFreeCaptureSession({
      entitlementMode: "provider-free-local-fixture",
      allowlist: [allowlist[0]],
      fixtures: retainedExact,
    }),
  );
  assert.throws(
    () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: [...retainedExact, fixture("sec", "filings", "retained-over", [0])],
      }),
    rejects("p1-03.retained-byte-limit"),
  );
  const exactString = "x".repeat(P1_03_LIMITS.maxStringBytes);
  assert.doesNotThrow(() =>
    createProviderFreeCaptureSession({
      entitlementMode: "provider-free-local-fixture",
      allowlist: [{ sourceId: "sec", issuerId: exactString, resourceId: "filings" }],
      fixtures: [{ ...fixture("sec", "filings"), issuerId: exactString }],
    }),
  );
  assert.throws(
    () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [{ sourceId: "sec", issuerId: `${exactString}x`, resourceId: "filings" }],
        fixtures: [fixture("sec", "filings")],
      }),
    rejects("p1-03.string-limit"),
  );
});

test("invalid schemas, duplicates, timestamps, sources, bytes, and digests reject atomically", () => {
  assert.throws(
    () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0], allowlist[0]],
        fixtures: [fixture("sec", "filings")],
      }),
    rejects("p1-03.duplicate-allowlist-entry"),
  );
  const duplicateFixture = fixture("sec", "filings");
  assert.throws(
    () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: [duplicateFixture, duplicateFixture],
      }),
    rejects("p1-03.duplicate-fixture-identity"),
  );
  assert.throws(
    () => session([{ ...duplicateFixture, retrievedAtMs: -1 }]),
    rejects("p1-03.timestamp-invalid"),
  );
  assert.throws(
    () => session([{ ...duplicateFixture, sourceId: "unknown" as "sec" }]),
    rejects("p1-03.source-invalid"),
  );
  assert.throws(
    () => session([{ ...duplicateFixture, bytes: [256] }]),
    rejects("p1-03.input-invalid"),
  );
  assert.throws(() => session().readRaw("not-a-digest"), rejects("p1-03.digest-invalid"));
  assert.throws(
    () =>
      session().capture({ ...request(duplicateFixture), extra: "forbidden" } as P103CaptureRequest),
    rejects("p1-03.input-invalid"),
  );
});

test("session receiver is branded by private state", () => {
  const capture = session();
  assert.throws(() => capture.capture.call({}, request(fixture("sec", "filings"))), TypeError);
  assert.throws(() => capture.snapshot.call({}), TypeError);
  assert.throws(() => capture.readRaw.call({}, "0".repeat(64)), TypeError);
});

test("production sources contain no transport, credential, persistence, or provider endpoint surface", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(testDir, "../..");
  const sources = await Promise.all(
    [
      "src/adapters/read-only-capture/contracts.ts",
      "src/adapters/read-only-capture/provider-free.ts",
    ].map((relative) => readFile(path.join(repositoryRoot, relative), "utf8")),
  );
  const joined = sources.join("\n");
  const forbidden = [
    /from\s+["']node:(?:fs|http|https|http2|net|tls|dns|dgram|child_process|worker_threads)["']/u,
    /\bfetch\s*\(/u,
    /\bWebSocket\b/u,
    /\bprocess\.env\b/u,
    /https?:\/\//u,
    /PEAS_(?:ALPACA|FMP)|ALPACA_(?:API|SECRET)|FMP_API/u,
    /market-acquisition|providers\/(?:sec|fmp|ir)/u,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(joined, pattern);
});

test("all success and rejection paths make zero global fetch or WebSocket attempts", () => {
  let attempts = 0;
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const webSocketDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: () => {
      attempts += 1;
      throw new Error("network forbidden");
    },
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: class ForbiddenWebSocket {
      constructor() {
        attempts += 1;
        throw new Error("network forbidden");
      }
    },
  });
  try {
    const capture = session();
    const value = fixture("sec", "filings");
    const receipt = capture.capture(request(value));
    capture.capture(request(value));
    capture.readRaw(receipt.rawSha256);
    capture.snapshot();
    assert.throws(
      () => capture.capture({ ...request(value), issuerId: "blocked" }),
      rejects("p1-03.capture-not-allowlisted"),
    );
    assert.equal(attempts, 0);
  } finally {
    if (fetchDescriptor === undefined) delete (globalThis as { fetch?: unknown }).fetch;
    else Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    if (webSocketDescriptor === undefined) {
      delete (globalThis as { WebSocket?: unknown }).WebSocket;
    } else {
      Object.defineProperty(globalThis, "WebSocket", webSocketDescriptor);
    }
  }
});
