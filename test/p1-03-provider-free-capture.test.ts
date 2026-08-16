import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";

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

const EFFECT_KEYS = Object.freeze([
  "account",
  "broker",
  "credential",
  "fill",
  "financialEffect",
  "network",
  "order",
  "portfolio",
  "position",
  "provider",
  "spending",
  "subscription",
] as const);
const RECEIPT_KEYS = Object.freeze([
  "captureId",
  "contentType",
  "duplicate",
  "effects",
  "issuerId",
  "publishedAtMs",
  "rawSha256",
  "rawSizeBytes",
  "recordId",
  "resourceId",
  "retrievedAtMs",
  "revisionId",
  "sourceId",
] as const);
const SNAPSHOT_KEYS = Object.freeze([
  "effects",
  "entitlementMode",
  "receipts",
  "retainedBytes",
  "totalUniqueCaptures",
  "uniqueRetainedDigests",
] as const);

function sortedOwnStringKeys(value: object): string[] {
  const ownKeys = Reflect.ownKeys(value);
  const symbolKeys = ownKeys.filter((key): key is symbol => typeof key === "symbol");
  assert.deepEqual(symbolKeys, [], "surface must not expose symbol keys");
  const stringKeys = ownKeys.filter((key): key is string => typeof key === "string");
  const nonEnumerableKeys = stringKeys.filter(
    (key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true,
  );
  assert.deepEqual(nonEnumerableKeys, [], "surface must not expose non-enumerable keys");
  return stringKeys.sort();
}

function assertZeroEffects(value: typeof P1_03_EFFECTS_ZERO): void {
  assert.deepEqual(sortedOwnStringKeys(value), [...EFFECT_KEYS]);
  assert.equal(value.network, 0);
  assert.equal(value.provider, 0);
  assert.equal(value.credential, 0);
  assert.equal(value.account, 0);
  assert.equal(value.subscription, 0);
  assert.equal(value.spending, 0);
  assert.equal(value.broker, 0);
  assert.equal(value.order, 0);
  assert.equal(value.portfolio, 0);
  assert.equal(value.position, 0);
  assert.equal(value.fill, 0);
  assert.equal(value.financialEffect, 0);
  assert.equal(Object.isFrozen(value), true);
}

function assertReceiptSurface(receipt: ReturnType<ReturnType<typeof session>["capture"]>): void {
  assert.deepEqual(sortedOwnStringKeys(receipt), [...RECEIPT_KEYS]);
  assertZeroEffects(receipt.effects);
  assert.equal(Object.isFrozen(receipt), true);
}

function assertSnapshotSurface(snapshot: ReturnType<ReturnType<typeof session>["snapshot"]>): void {
  assert.deepEqual(sortedOwnStringKeys(snapshot), [...SNAPSHOT_KEYS]);
  assertZeroEffects(snapshot.effects);
  for (const receipt of snapshot.receipts) assertReceiptSurface(receipt);
  assert.equal(Object.isFrozen(snapshot), true);
}

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
    assertReceiptSurface(receipt);
  }
  assertSnapshotSurface(capture.snapshot());
  assert.deepEqual(Reflect.ownKeys(capture), ["kind"]);
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
  const entry: P103AllowlistEntry = {
    sourceId: "sec",
    issuerId: "issuer-a",
    resourceId: "filings",
  };
  const value = fixture("sec", "filings", "revision-1", bytes);
  const originalRequest = request(value);
  const input = {
    entitlementMode: "provider-free-local-fixture" as const,
    allowlist: [entry],
    fixtures: [value],
  };
  const baseline = createProviderFreeCaptureSession({
    entitlementMode: "provider-free-local-fixture",
    allowlist: [{ ...entry }],
    fixtures: [{ ...value, bytes: [...bytes] }],
  });
  const baselineReceipt = baseline.capture(originalRequest);
  const baselineRaw = baseline.readRaw(baselineReceipt.rawSha256);
  const baselineSnapshot = canonicalJson(baseline.snapshot() as unknown as JsonValue);
  const capture = createProviderFreeCaptureSession(input);
  bytes[0] = 255;
  (entry as { sourceId: string }).sourceId = "fmp";
  (entry as { issuerId: string }).issuerId = "changed";
  (entry as { resourceId: string }).resourceId = "changed";
  (value as { sourceId: string }).sourceId = "fmp";
  (value as { issuerId: string }).issuerId = "changed";
  (value as { resourceId: string }).resourceId = "changed";
  (value as { recordId: string }).recordId = "changed";
  (value as { revisionId: string }).revisionId = "changed";
  (value as { publishedAtMs: number | null }).publishedAtMs = null;
  (value as { retrievedAtMs: number }).retrievedAtMs = 1;
  (value as { contentType: string }).contentType = "changed/changed";
  const receipt = capture.capture(originalRequest);
  const firstRead = capture.readRaw(receipt.rawSha256);
  assert.deepEqual(receipt, baselineReceipt);
  assert.deepEqual(firstRead, baselineRaw);
  assert.equal(canonicalJson(capture.snapshot() as unknown as JsonValue), baselineSnapshot);
  assert.equal(capture.snapshot().retainedBytes, 3);
  assert.equal(capture.snapshot().uniqueRetainedDigests, 1);
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
  assert.equal(P1_03_LIMITS.maxAllowlistEntries, 32);
  const entries = Array.from({ length: 32 }, (_, index) => ({
    sourceId: "sec" as const,
    issuerId: `issuer-${index}`,
    resourceId: "filings",
  }));
  assert.equal(entries.length, 32);
  assert.doesNotThrow(() =>
    createProviderFreeCaptureSession({
      entitlementMode: "provider-free-local-fixture",
      allowlist: entries,
      fixtures: [{ ...fixture("sec", "filings"), issuerId: "issuer-0" }],
    }),
  );
  const entriesOneOver = [
    ...entries,
    { sourceId: "fmp" as const, issuerId: "one-over", resourceId: "x" },
  ];
  assert.equal(entriesOneOver.length, 33);
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
        allowlist: entriesOneOver,
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

test("surface assertions reject symbol and non-enumerable escape hatches", () => {
  const symbolSurface = { visible: 0 };
  Object.defineProperty(symbolSurface, Symbol("hidden-effect"), {
    enumerable: true,
    value: 1,
  });
  assert.throws(() => sortedOwnStringKeys(symbolSurface), /surface must not expose symbol keys/u);

  const nonEnumerableSurface = { visible: 0 };
  Object.defineProperty(nonEnumerableSurface, "hiddenEffect", {
    enumerable: false,
    value: 1,
  });
  assert.throws(
    () => sortedOwnStringKeys(nonEnumerableSurface),
    /surface must not expose non-enumerable keys/u,
  );
});

type SourceToken = Readonly<{ kind: SyntaxKind; text: string; value: string }>;

type SourceBoundaryScan = Readonly<{
  callableSurfaces: ReadonlySet<string>;
  constructorSurfaces: ReadonlySet<string>;
  dynamicImportSpecifiers: readonly string[];
  exportSpecifiers: readonly string[];
  identifierSurfaces: ReadonlyMap<string, number>;
  moduleSpecifiers: readonly string[];
  requireSpecifiers: readonly string[];
  sensitiveStringSurfaces: ReadonlySet<string>;
}>;

function callableSurfaceBefore(tokens: readonly SourceToken[], openParenIndex: number): string {
  let cursor = openParenIndex - 1;
  const parts: string[] = [];

  if (tokens[cursor]?.kind === SyntaxKind.QuestionDotToken) cursor -= 1;
  while (cursor >= 0) {
    const token = tokens[cursor];
    if (
      token?.kind === SyntaxKind.Identifier ||
      token?.kind === SyntaxKind.PrivateIdentifier ||
      token?.kind === SyntaxKind.RequireKeyword
    ) {
      parts.unshift(token.text);
      cursor -= 1;
      continue;
    }
    if (token?.kind === SyntaxKind.DotToken || token?.kind === SyntaxKind.QuestionDotToken) {
      parts.unshift(".");
      cursor -= 1;
      continue;
    }
    if (token?.kind === SyntaxKind.CloseBracketToken) {
      const property = tokens[cursor - 1];
      const openingBracket = tokens[cursor - 2];
      if (
        openingBracket?.kind !== SyntaxKind.OpenBracketToken ||
        (property?.kind !== SyntaxKind.Identifier && property?.kind !== SyntaxKind.StringLiteral)
      ) {
        break;
      }
      parts.unshift(property.kind === SyntaxKind.StringLiteral ? property.value : property.text);
      parts.unshift(".");
      cursor -= 3;
      if (tokens[cursor]?.kind === SyntaxKind.QuestionDotToken) cursor -= 1;
      continue;
    }
    break;
  }

  return parts.join("");
}

function scanSourceBoundary(relative: string, source: string): SourceBoundaryScan {
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  const tokens: SourceToken[] = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    tokens.push({ kind, text: scanner.getTokenText(), value: scanner.getTokenValue() });
  }
  assert.ok(tokens.length > 0, `${relative} must produce tokens`);

  const moduleSpecifiers: string[] = [];
  const dynamicImportSpecifiers: string[] = [];
  const exportSpecifiers: string[] = [];
  const requireSpecifiers: string[] = [];
  const callableSurfaces = new Set<string>();
  const constructorSurfaces = new Set<string>();
  const identifierSurfaces = new Map<string, number>();
  const sensitiveStringSurfaces = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    assert.ok(token);
    if (token.kind === SyntaxKind.Identifier || token.kind === SyntaxKind.RequireKeyword) {
      identifierSurfaces.set(token.text, (identifierSurfaces.get(token.text) ?? 0) + 1);
    }
    if (
      token.kind === SyntaxKind.StringLiteral &&
      (token.value === "fetch" || token.value === "require")
    ) {
      sensitiveStringSurfaces.add(token.value);
    }

    if (token.kind === SyntaxKind.ImportKeyword) {
      if (tokens[index + 1]?.kind === SyntaxKind.OpenParenToken) {
        const specifier = tokens[index + 2];
        assert.equal(specifier?.kind, SyntaxKind.StringLiteral, `${relative}: dynamic import`);
        dynamicImportSpecifiers.push(specifier?.value ?? "");
      } else {
        const declarationSpecifiers: string[] = [];
        for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
          const candidate = tokens[cursor];
          if (candidate?.kind === SyntaxKind.SemicolonToken) break;
          if (candidate?.kind === SyntaxKind.StringLiteral) {
            declarationSpecifiers.push(candidate.value);
          }
        }
        assert.equal(declarationSpecifiers.length, 1, `${relative}: import declaration`);
        moduleSpecifiers.push(declarationSpecifiers[0] ?? "");
      }
    }

    if (token.kind === SyntaxKind.ExportKeyword) {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const candidate = tokens[cursor];
        if (candidate?.kind === SyntaxKind.SemicolonToken) break;
        if (candidate?.kind !== SyntaxKind.FromKeyword) continue;
        const specifier = tokens[cursor + 1];
        assert.equal(specifier?.kind, SyntaxKind.StringLiteral, `${relative}: export-from`);
        exportSpecifiers.push(specifier?.value ?? "");
        break;
      }
    }

    if (token.kind === SyntaxKind.NewKeyword) {
      const target = tokens[index + 1];
      assert.equal(target?.kind, SyntaxKind.Identifier, `${relative}: constructor target`);
      constructorSurfaces.add(target?.text ?? "");
    }

    if (token.kind === SyntaxKind.OpenParenToken) {
      const callableSurface = callableSurfaceBefore(tokens, index);
      if (callableSurface.length > 0) callableSurfaces.add(callableSurface);
      if (callableSurface.split(".").at(-1) === "require") {
        const specifier = tokens[index + 1];
        assert.equal(specifier?.kind, SyntaxKind.StringLiteral, `${relative}: require call`);
        requireSpecifiers.push(specifier?.value ?? "");
      }
    }
  }

  return {
    callableSurfaces,
    constructorSurfaces,
    dynamicImportSpecifiers,
    exportSpecifiers,
    identifierSurfaces,
    moduleSpecifiers,
    requireSpecifiers,
    sensitiveStringSurfaces,
  };
}

test("source boundary scan exposes export-from, optional, computed, and string canaries", () => {
  const scan = scanSourceBoundary(
    "boundary-canary.ts",
    [
      'export { readFile } from "node:fs";',
      'export * from "node:https";',
      'fetch?.("https://forbidden.invalid");',
      'globalThis?.["fetch"]?.("https://forbidden.invalid");',
      'require?.("node:path");',
      'globalThis["require"]("node:fs");',
    ].join("\n"),
  );
  assert.deepEqual([...scan.exportSpecifiers].sort(), ["node:fs", "node:https"]);
  assert.deepEqual([...scan.requireSpecifiers].sort(), ["node:fs", "node:path"]);
  assert.deepEqual([...scan.sensitiveStringSurfaces].sort(), ["fetch", "require"]);
  assert.equal(scan.callableSurfaces.has("fetch"), true);
  assert.equal(scan.callableSurfaces.has("globalThis.fetch"), true);
  assert.equal(scan.callableSurfaces.has("require"), true);
  assert.equal(scan.callableSurfaces.has("globalThis.require"), true);
});

test("production sources satisfy closed import, callable, and prohibited-effect allowlists", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(testDir, "../..");
  const sourceRecords = await Promise.all(
    [
      "src/adapters/read-only-capture/contracts.ts",
      "src/adapters/read-only-capture/provider-free.ts",
    ].map(async (relative) => ({
      relative,
      source: await readFile(path.join(repositoryRoot, relative), "utf8"),
    })),
  );
  const moduleSpecifiers: string[] = [];
  const dynamicImportSpecifiers: string[] = [];
  const exportSpecifiers: string[] = [];
  const requireSpecifiers: string[] = [];
  const callableSurfaces = new Set<string>();
  const constructorSurfaces = new Set<string>();
  const identifierSurfaces = new Map<string, number>();
  const sensitiveStringSurfaces = new Set<string>();

  for (const { relative, source } of sourceRecords) {
    const scan = scanSourceBoundary(relative, source);
    moduleSpecifiers.push(...scan.moduleSpecifiers);
    dynamicImportSpecifiers.push(...scan.dynamicImportSpecifiers);
    exportSpecifiers.push(...scan.exportSpecifiers);
    requireSpecifiers.push(...scan.requireSpecifiers);
    for (const surface of scan.callableSurfaces) callableSurfaces.add(surface);
    for (const surface of scan.constructorSurfaces) constructorSurfaces.add(surface);
    for (const surface of scan.sensitiveStringSurfaces) sensitiveStringSurfaces.add(surface);
    for (const [identifier, count] of scan.identifierSurfaces) {
      identifierSurfaces.set(identifier, (identifierSurfaces.get(identifier) ?? 0) + count);
    }
  }

  assert.deepEqual(moduleSpecifiers.sort(), [
    "../../core/hash.js",
    "../../core/json.js",
    "./contracts.js",
    "node:crypto",
  ]);
  assert.deepEqual(dynamicImportSpecifiers, []);
  assert.deepEqual(exportSpecifiers, []);
  assert.deepEqual(requireSpecifiers, []);
  assert.deepEqual([...sensitiveStringSurfaces], []);
  assert.deepEqual([...constructorSurfaces].sort(), [
    "Map",
    "P103CaptureContractError",
    "ProviderFreeCaptureSessionV1",
    "Set",
  ]);
  assert.deepEqual([...callableSurfaces].sort(), [
    ".#allowlist.has",
    ".#rawByDigest.has",
    ".#receipts.values",
    ".digest",
    ".sort",
    ".update",
    "Array.isArray",
    "Buffer.byteLength",
    "Number.isInteger",
    "Number.isSafeInteger",
    "Object.freeze",
    "Object.keys",
    "P103CaptureContractError",
    "P1_03_SOURCE_IDS.includes",
    "ProviderFreeCaptureSessionV1",
    "SHA256.test",
    "actual.some",
    "allowlist.add",
    "allowlist.has",
    "allowlistKey",
    "canonicalHash",
    "capture",
    "createHash",
    "createProviderFreeCaptureSession",
    "detachAllowlistEntry",
    "detachFixture",
    "detachRequest",
    "digest",
    "exactFields",
    "fail",
    "fixtureKey",
    "fixtures.has",
    "freezeReceipt",
    "inertJsonSnapshot",
    "plannedDigests.add",
    "plannedDigests.has",
    "readRaw",
    "requiredString",
    "snapshot",
    "sourceId",
    "timestamp",
    "value.bytes.map",
  ]);

  for (const forbiddenIdentifier of [
    "Bun",
    "Deno",
    "SharedWorker",
    "WebSocket",
    "Worker",
    "clearImmediate",
    "clearInterval",
    "clearTimeout",
    "fetch",
    "process",
    "queueMicrotask",
    "require",
    "secret",
    "setImmediate",
    "setInterval",
    "setTimeout",
    "token",
  ]) {
    assert.equal(identifierSurfaces.has(forbiddenIdentifier), false, forbiddenIdentifier);
  }

  const joined = sourceRecords.map(({ source }) => source).join("\n");
  assert.doesNotMatch(joined, /https?:\/\//u);
  assert.doesNotMatch(joined, /PEAS_(?:ALPACA|FMP)|ALPACA_(?:API|SECRET)|FMP_API/u);
  assert.doesNotMatch(
    joined,
    /(?:market-acquisition|providers?\/|credentials?\/|secrets?\/|sqlite|postgres|mysql|redis)/iu,
  );

  const contracts = sourceRecords.find(({ relative }) => relative.endsWith("contracts.ts"));
  assert.ok(contracts);
  const effectsDeclaration = contracts.source.match(
    /export const P1_03_EFFECTS_ZERO = Object\.freeze\(\{(?<body>[\s\S]*?)\}\s+as const\);/u,
  );
  const effectsBody = effectsDeclaration?.groups?.["body"];
  assert.ok(effectsBody);
  const literalEffects = [...effectsBody.matchAll(/^\s*(\w+):\s*(\d+),?$/gmu)]
    .map((match) => {
      const key = match[1];
      const value = match[2];
      assert.ok(key);
      assert.ok(value);
      return [key, Number(value)] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(
    literalEffects,
    EFFECT_KEYS.map((key) => [key, 0] as const),
  );
  for (const effectKey of EFFECT_KEYS) {
    assert.equal(identifierSurfaces.get(effectKey), 1, effectKey);
  }
  for (const prohibitedSurface of ["broker", "order", "portfolio", "position", "fill"]) {
    assert.equal(RECEIPT_KEYS.includes(prohibitedSurface as never), false);
    assert.equal(SNAPSHOT_KEYS.includes(prohibitedSurface as never), false);
  }
});

test("documented constructor, capture, readRaw, and snapshot matrix makes zero network attempts", () => {
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
    const executedPaths = new Set<string>();
    const coveredReasons = new Set<P103ReasonCode>();
    const runPath = (name: string, operation: () => void): void => {
      assert.equal(executedPaths.has(name), false, `duplicate matrix path: ${name}`);
      operation();
      executedPaths.add(name);
      assert.equal(attempts, 0, `network attempt in matrix path: ${name}`);
    };
    const rejectPath = (
      name: string,
      reasonCode: P103ReasonCode,
      operation: () => unknown,
    ): void => {
      runPath(name, () => assert.throws(operation, rejects(reasonCode)));
      coveredReasons.add(reasonCode);
    };
    const typeErrorPath = (name: string, operation: () => unknown): void => {
      runPath(name, () => assert.throws(operation, TypeError));
    };

    let threeSourceSession: ReturnType<typeof session> | undefined;
    const threeFixtures = [
      fixture("sec", "filings"),
      fixture("fmp", "calendar"),
      fixture("issuer-ir", "rss"),
    ];
    const firstFixture = threeFixtures[0];
    assert.ok(firstFixture);
    runPath("constructor.success.closed-three-source-session", () => {
      threeSourceSession = session(threeFixtures);
      assert.deepEqual(Reflect.ownKeys(threeSourceSession), ["kind"]);
      assertSnapshotSurface(threeSourceSession.snapshot());
    });
    assert.ok(threeSourceSession);

    const capturedReceipts: ReturnType<ReturnType<typeof session>["capture"]>[] = [];
    for (const value of threeFixtures) {
      runPath(`capture.success.new.${value.sourceId}`, () => {
        const receipt = threeSourceSession?.capture(request(value));
        assert.ok(receipt);
        assertReceiptSurface(receipt);
        capturedReceipts.push(receipt);
      });
    }
    runPath("capture.success.duplicate", () => {
      const duplicate = threeSourceSession?.capture(request(firstFixture));
      assert.ok(duplicate);
      assert.equal(duplicate.duplicate, true);
      assertReceiptSurface(duplicate);
    });
    runPath("snapshot.success.populated", () => {
      const value = threeSourceSession?.snapshot();
      assert.ok(value);
      assertSnapshotSurface(value);
      assert.equal(value.totalUniqueCaptures, 3);
    });
    runPath("readRaw.success.known-copy", () => {
      const value = threeSourceSession?.readRaw(capturedReceipts[0]?.rawSha256 ?? "");
      assert.deepEqual(value, Uint8Array.from([1, 2, 3]));
      assert.ok(value);
      value[0] = 99;
      assert.deepEqual(
        threeSourceSession?.readRaw(capturedReceipts[0]?.rawSha256 ?? ""),
        Uint8Array.from([1, 2, 3]),
      );
    });
    runPath("readRaw.success.unknown-digest", () => {
      assert.equal(threeSourceSession?.readRaw("0".repeat(64)), undefined);
    });

    runPath("capture.success.correction", () => {
      const initial = fixture("sec", "filings", "revision-1", [1, 2, 3]);
      const correction = fixture("sec", "filings", "revision-2", [1, 2, 4]);
      const capture = session([initial, correction]);
      const first = capture.capture(request(initial));
      const second = capture.capture(request(correction));
      assert.notEqual(first.captureId, second.captureId);
      assertReceiptSurface(first);
      assertReceiptSurface(second);
      assertSnapshotSurface(capture.snapshot());
    });
    runPath("capture.success.shared-digest", () => {
      const initial = fixture("sec", "filings", "revision-1", [1, 2, 3]);
      const correction = fixture("sec", "filings", "revision-2", [1, 2, 3]);
      const capture = session([initial, correction]);
      assertReceiptSurface(capture.capture(request(initial)));
      assertReceiptSurface(capture.capture(request(correction)));
      const value = capture.snapshot();
      assertSnapshotSurface(value);
      assert.equal(value.uniqueRetainedDigests, 1);
    });
    runPath("constructor.success.null-published-at", () => {
      const value = { ...fixture("sec", "filings"), publishedAtMs: null };
      const capture = session([value]);
      assertReceiptSurface(capture.capture(request(value)));
    });

    const exactEntries = Array.from({ length: 32 }, (_, index) => ({
      sourceId: "sec" as const,
      issuerId: `matrix-issuer-${index}`,
      resourceId: "filings",
    }));
    runPath("constructor.success.allowlist-count-exact-32", () => {
      const capture = createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: exactEntries,
        fixtures: [{ ...fixture("sec", "filings"), issuerId: "matrix-issuer-0" }],
      });
      assertSnapshotSurface(capture.snapshot());
    });
    const exactFixtures = Array.from({ length: 64 }, (_, index) =>
      fixture("sec", "filings", `matrix-fixture-${index}`, [index]),
    );
    runPath("constructor.success.fixture-count-exact-64", () => {
      assertSnapshotSurface(session(exactFixtures).snapshot());
    });
    const exactBytesFixture = fixture(
      "sec",
      "filings",
      "matrix-bytes",
      new Array(2_097_152).fill(0),
    );
    runPath("constructor.success.fixture-bytes-exact-2097152", () => {
      assertSnapshotSurface(session([exactBytesFixture]).snapshot());
    });
    const exactRetainedFixtures = Array.from({ length: 4 }, (_, index) =>
      fixture("sec", "filings", `matrix-retained-${index}`, new Array(2_097_152).fill(index)),
    );
    runPath("constructor.success.retained-bytes-exact-8388608", () => {
      assertSnapshotSurface(session(exactRetainedFixtures).snapshot());
    });
    const exactString = "x".repeat(512);
    runPath("constructor.success.string-bytes-exact-512", () => {
      const capture = createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [{ sourceId: "sec", issuerId: exactString, resourceId: "filings" }],
        fixtures: [{ ...fixture("sec", "filings"), issuerId: exactString }],
      });
      assertSnapshotSurface(capture.snapshot());
    });

    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    rejectPath("constructor.reject.snapshot-cycle", "p1-03.input-invalid", () =>
      createProviderFreeCaptureSession(cyclic as never),
    );
    rejectPath("constructor.reject.top-level-fields", "p1-03.input-invalid", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: [fixture("sec", "filings")],
        extra: true,
      } as never),
    );
    rejectPath("constructor.reject.entitlement", "p1-03.input-invalid", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "live-provider",
        allowlist: [allowlist[0]],
        fixtures: [fixture("sec", "filings")],
      } as never),
    );
    rejectPath("constructor.reject.allowlist-not-array", "p1-03.input-invalid", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: {},
        fixtures: [fixture("sec", "filings")],
      } as never),
    );
    rejectPath("constructor.reject.allowlist-empty", "p1-03.input-invalid", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [],
        fixtures: [fixture("sec", "filings")],
      }),
    );
    rejectPath("constructor.reject.allowlist-count-33", "p1-03.allowlist-limit", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [
          ...exactEntries,
          { sourceId: "fmp", issuerId: "matrix-one-over", resourceId: "calendar" },
        ],
        fixtures: [fixture("sec", "filings")],
      }),
    );
    rejectPath("constructor.reject.fixtures-not-array", "p1-03.input-invalid", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: {},
      } as never),
    );
    rejectPath("constructor.reject.fixtures-empty", "p1-03.input-invalid", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: [],
      }),
    );
    rejectPath("constructor.reject.fixture-count-65", "p1-03.fixture-limit", () =>
      session([...exactFixtures, fixture("sec", "filings", "matrix-fixture-over", [0])]),
    );
    rejectPath("constructor.reject.allowlist-entry-fields", "p1-03.input-invalid", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [{ ...allowlist[0], extra: true }],
        fixtures: [fixture("sec", "filings")],
      } as never),
    );
    rejectPath("constructor.reject.source", "p1-03.source-invalid", () =>
      session([{ ...fixture("sec", "filings"), sourceId: "unknown" as "sec" }]),
    );
    rejectPath("constructor.reject.string-empty", "p1-03.string-limit", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [{ sourceId: "sec", issuerId: "", resourceId: "filings" }],
        fixtures: [fixture("sec", "filings")],
      }),
    );
    rejectPath("constructor.reject.string-bytes-513", "p1-03.string-limit", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [{ sourceId: "sec", issuerId: `${exactString}x`, resourceId: "filings" }],
        fixtures: [fixture("sec", "filings")],
      }),
    );
    rejectPath("constructor.reject.duplicate-allowlist", "p1-03.duplicate-allowlist-entry", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0], allowlist[0]],
        fixtures: [fixture("sec", "filings")],
      }),
    );
    rejectPath("constructor.reject.fixture-fields", "p1-03.input-invalid", () =>
      session([{ ...fixture("sec", "filings"), extra: true } as never]),
    );
    rejectPath("constructor.reject.fixture-bytes-not-array", "p1-03.input-invalid", () =>
      session([{ ...fixture("sec", "filings"), bytes: {} as never }]),
    );
    rejectPath("constructor.reject.fixture-byte-invalid", "p1-03.input-invalid", () =>
      session([{ ...fixture("sec", "filings"), bytes: [256] }]),
    );
    rejectPath("constructor.reject.fixture-bytes-2097153", "p1-03.fixture-byte-limit", () =>
      session([fixture("sec", "filings", "matrix-bytes-over", new Array(2_097_153).fill(0))]),
    );
    rejectPath("constructor.reject.timestamp-negative", "p1-03.timestamp-invalid", () =>
      session([{ ...fixture("sec", "filings"), retrievedAtMs: -1 }]),
    );
    rejectPath("constructor.reject.fixture-not-allowlisted", "p1-03.fixture-not-allowlisted", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: [fixture("fmp", "calendar")],
      }),
    );
    const duplicateFixture = fixture("sec", "filings");
    rejectPath("constructor.reject.duplicate-fixture", "p1-03.duplicate-fixture-identity", () =>
      createProviderFreeCaptureSession({
        entitlementMode: "provider-free-local-fixture",
        allowlist: [allowlist[0]],
        fixtures: [duplicateFixture, duplicateFixture],
      }),
    );
    rejectPath("constructor.reject.retained-bytes-8388609", "p1-03.retained-byte-limit", () =>
      session([...exactRetainedFixtures, fixture("sec", "filings", "matrix-retained-over", [0])]),
    );

    const requestCycle = request(fixture("sec", "filings")) as P103CaptureRequest &
      Record<string, unknown>;
    requestCycle["self"] = requestCycle;
    rejectPath("capture.reject.snapshot-cycle", "p1-03.input-invalid", () =>
      threeSourceSession?.capture(requestCycle),
    );
    rejectPath("capture.reject.request-fields", "p1-03.input-invalid", () =>
      threeSourceSession?.capture({
        ...request(fixture("sec", "filings")),
        extra: true,
      } as never),
    );
    rejectPath("capture.reject.source", "p1-03.source-invalid", () =>
      threeSourceSession?.capture({
        ...request(fixture("sec", "filings")),
        sourceId: "unknown" as "sec",
      }),
    );
    rejectPath("capture.reject.string-empty", "p1-03.string-limit", () =>
      threeSourceSession?.capture({ ...request(fixture("sec", "filings")), issuerId: "" }),
    );
    rejectPath("capture.reject.string-bytes-513", "p1-03.string-limit", () =>
      threeSourceSession?.capture({
        ...request(fixture("sec", "filings")),
        issuerId: `${exactString}x`,
      }),
    );
    rejectPath("capture.reject.not-allowlisted", "p1-03.capture-not-allowlisted", () =>
      threeSourceSession?.capture({
        ...request(fixture("sec", "filings")),
        issuerId: "blocked",
      }),
    );
    rejectPath("capture.reject.fixture-missing", "p1-03.fixture-missing", () =>
      threeSourceSession?.capture({
        ...request(fixture("sec", "filings")),
        recordId: "missing",
      }),
    );
    rejectPath("readRaw.reject.digest-format", "p1-03.digest-invalid", () =>
      threeSourceSession?.readRaw("not-a-digest"),
    );
    rejectPath("readRaw.reject.digest-type", "p1-03.digest-invalid", () =>
      threeSourceSession?.readRaw(1 as never),
    );
    typeErrorPath("capture.reject.forged-receiver", () =>
      threeSourceSession?.capture.call({}, request(fixture("sec", "filings"))),
    );
    typeErrorPath("readRaw.reject.forged-receiver", () =>
      threeSourceSession?.readRaw.call({}, "0".repeat(64)),
    );
    typeErrorPath("snapshot.reject.forged-receiver", () => threeSourceSession?.snapshot.call({}));

    assert.deepEqual([...coveredReasons].sort(), [
      "p1-03.allowlist-limit",
      "p1-03.capture-not-allowlisted",
      "p1-03.digest-invalid",
      "p1-03.duplicate-allowlist-entry",
      "p1-03.duplicate-fixture-identity",
      "p1-03.fixture-byte-limit",
      "p1-03.fixture-limit",
      "p1-03.fixture-missing",
      "p1-03.fixture-not-allowlisted",
      "p1-03.input-invalid",
      "p1-03.retained-byte-limit",
      "p1-03.source-invalid",
      "p1-03.string-limit",
      "p1-03.timestamp-invalid",
    ] satisfies readonly P103ReasonCode[]);
    assert.equal(executedPaths.size, 50);
    const invariantUnreachablePaths = Object.freeze([
      "capture.retained-byte-limit is invariant-unreachable because construction preaccounts every unique fixture digest before exposing a session",
    ]);
    assert.deepEqual(invariantUnreachablePaths, [
      "capture.retained-byte-limit is invariant-unreachable because construction preaccounts every unique fixture digest before exposing a session",
    ]);
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
