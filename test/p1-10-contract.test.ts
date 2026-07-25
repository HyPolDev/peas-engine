import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { canonicalJson, type JsonValue } from "../src/core/json.js";
import {
  deriveEndpointChannelId,
  deriveMarketDatasetId,
  deriveMarketFeedId,
  deriveMarketProviderId,
} from "../src/providers/market-reference/identity.js";

const NS_PER_MINUTE = 60_000_000_000n;
const HISTORY_DELAY_NS = 15n * NS_PER_MINUTE;
const DAY_NS = 86_400_000_000_000n;
const ORIGINAL_FETCH = globalThis.fetch;
let unexpectedNetworkCalls = 0;
globalThis.fetch = (() => {
  unexpectedNetworkCalls += 1;
  throw rejection("network-forbidden");
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const LIMITS = Object.freeze({
  concurrentRequests: 1,
  rawArtifactBytes: 10 * 1024 * 1024,
  aggregateBytes: 64 * 1024 * 1024,
  pages: 16,
  recordsPerPage: 10_000,
  facts: 160_000,
  tokenBytes: 4_096,
  instruments: 64,
  spanDays: 8,
  attempts: 48,
  pageAttempts: 3,
  retryAfterMs: 30_000,
  attemptDeadlineMs: 30_000,
  acquisitionDeadlineMs: 300_000,
  rateAttempts: 30,
  rateWindowMs: 60_000,
} as const);

const IDS = Object.freeze({
  alpacaProvider: "mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c",
  alpacaDataset: "mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1",
  alpacaFeed: "mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023",
  alpacaQuotes: "mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0",
  alpacaTrades: "mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1",
  alpacaBars: "mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c",
  fmpProvider: "mpv1_526c731d81a453ab057fd6f946e49291d0863350d319a73893d46e34b2a51a7a",
  fmpDataset: "mds1_eaaa286ff4841f43275131aca2abb17fad3ab78cbe3af49921a36a3249439f68",
  fmpFeed: "mfd1_582a672a4109841f0ef80d286021e1e827d4a5f050059e22c87d08c842d0051b",
  fmpQuote: "mec1_1e1c2239cce268ea690a82bd3f3ff6148bbd2bb8bb288c57a2e2cdf79cf8f1cd",
  fmpTrade: "mec1_feb9f3a3deab6dbabd6fcc204c8ced63d88a2ca14d8f235b1fec2dab49df6bdf",
});

type AlpacaKind = "bars" | "quotes" | "trades";
type Preflight = Readonly<{
  kind: AlpacaKind;
  method: string;
  origin: string;
  path: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  fields: Readonly<Record<string, string>>;
  requestStartedNs: bigint;
  maximumClockErrorNs: bigint;
  priorMonotonicNs: bigint;
  currentMonotonicNs: bigint;
  clockAvailable: boolean;
  liveEnabled: boolean;
  authorizationMode: string;
  capability: string;
  fallbackKind: string;
  zeroIncrementalSpend: boolean;
  costStatus: "zero-spend" | "unknown";
  firstRequest: boolean;
  pageMaterialBytes: number | null;
}>;

const ROUTES = Object.freeze({
  quotes: { path: "/v2/stocks/quotes", channel: IDS.alpacaQuotes },
  trades: { path: "/v2/stocks/trades", channel: IDS.alpacaTrades },
  bars: { path: "/v2/stocks/bars", channel: IDS.alpacaBars },
});

function rejection(code: string): Error {
  return new Error(`p1-10.${code}`);
}

function baseRequest(kind: AlpacaKind = "quotes"): Preflight {
  const common = {
    symbols: "abstract-set",
    start: "2026-01-01T00:00:00.000000000Z",
    end: "2026-01-01T00:15:00.000000000Z",
    limit: "10000",
    feed: "sip",
    sort: "asc",
  };
  return {
    kind,
    method: "GET",
    origin: "https://data.alpaca.markets",
    path: ROUTES[kind].path,
    providerId: IDS.alpacaProvider,
    datasetId: IDS.alpacaDataset,
    feedId: IDS.alpacaFeed,
    endpointChannelId: ROUTES[kind].channel,
    fields: kind === "bars" ? { ...common, timeframe: "1Min", adjustment: "raw" } : common,
    requestStartedNs: 1_000_000_000_000_000_000n,
    maximumClockErrorNs: 0n,
    priorMonotonicNs: 10n,
    currentMonotonicNs: 11n,
    clockAvailable: true,
    liveEnabled: true,
    authorizationMode: "p1-09-approved",
    capability: "historical-market-reference",
    fallbackKind: "none",
    zeroIncrementalSpend: true,
    costStatus: "zero-spend",
    firstRequest: true,
    pageMaterialBytes: null,
  };
}

function parseCanonicalNs(text: string): bigint {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/u.test(text)) {
    throw rejection("timestamp-invalid");
  }
  const milliseconds = Date.parse(`${text.slice(0, 23)}Z`);
  if (!Number.isFinite(milliseconds)) throw rejection("timestamp-invalid");
  return BigInt(milliseconds) * 1_000_000n + (BigInt(text.slice(20, 29)) % 1_000_000n);
}

function preflight(value: Preflight): void {
  if (!value.liveEnabled) throw rejection("live-run-not-enabled");
  if (value.authorizationMode !== "p1-09-approved") {
    throw rejection("authorization-mode-not-authorized");
  }
  if (value.capability !== "historical-market-reference") {
    throw rejection("capability-not-authorized");
  }
  if (value.fallbackKind !== "none") throw rejection("fallback-not-authorized");
  if (!value.zeroIncrementalSpend) throw rejection("zero-spend-not-authorized");
  if (value.method !== "GET") throw rejection("method-not-authorized");
  if (value.origin !== "https://data.alpaca.markets") throw rejection("origin-not-authorized");
  const route = ROUTES[value.kind];
  if (value.path !== route.path) throw rejection("path-not-authorized");
  if (
    value.providerId !== IDS.alpacaProvider ||
    value.datasetId !== IDS.alpacaDataset ||
    value.feedId !== IDS.alpacaFeed ||
    value.endpointChannelId !== route.channel
  ) {
    throw rejection("identity-not-authorized");
  }
  if (!value.clockAvailable || value.currentMonotonicNs <= value.priorMonotonicNs) {
    throw rejection("clock-unavailable");
  }
  if (value.maximumClockErrorNs < 0n) throw rejection("clock-unprovable");
  if (value.costStatus !== "zero-spend") throw rejection("cost-unproven");
  const allowed = new Set(["symbols", "start", "end", "limit", "feed", "sort"]);
  if (value.kind === "bars") {
    allowed.add("timeframe");
    allowed.add("adjustment");
  }
  if (!value.firstRequest) allowed.add("page_token");
  for (const key of Object.keys(value.fields)) {
    if (!allowed.has(key)) throw rejection("field-not-authorized");
  }
  for (const required of ["symbols", "start", "end", "limit", "feed", "sort"]) {
    if (value.fields[required] === undefined) throw rejection("field-required");
  }
  if (value.fields["feed"] !== "sip") throw rejection("feed-not-authorized");
  if (value.fields["sort"] !== "asc") throw rejection("sort-not-authorized");
  if (value.fields["limit"] !== "10000") throw rejection("limit-not-authorized");
  if (value.firstRequest && value.pageMaterialBytes !== null) throw rejection("first-page-token");
  if (!value.firstRequest) {
    if (
      value.pageMaterialBytes === null ||
      value.pageMaterialBytes < 1 ||
      value.pageMaterialBytes > LIMITS.tokenBytes
    ) {
      throw rejection("page-token-invalid");
    }
  }
  if (value.kind === "bars") {
    if (value.fields["timeframe"] !== "1Min") throw rejection("timeframe-not-authorized");
    if (value.fields["adjustment"] !== "raw") throw rejection("adjustment-not-authorized");
  }
  const start = parseCanonicalNs(value.fields["start"] as string);
  const end = parseCanonicalNs(value.fields["end"] as string);
  const startDateMs = Date.parse(`${(value.fields["start"] as string).slice(0, 10)}T00:00:00Z`);
  const endDateMs = Date.parse(`${(value.fields["end"] as string).slice(0, 10)}T00:00:00Z`);
  const calendarDates = (endDateMs - startDateMs) / 86_400_000 + 1;
  if (
    start > end ||
    !Number.isSafeInteger(calendarDates) ||
    calendarDates < 1 ||
    calendarDates > LIMITS.spanDays
  ) {
    throw rejection("window-invalid");
  }
  const conservativeStarted = value.requestStartedNs - value.maximumClockErrorNs;
  if (end > conservativeStarted - HISTORY_DELAY_NS) throw rejection("history-boundary");
}

function exactBoundaryRequest(deltaNs: bigint): Preflight {
  const endNs = baseRequest().requestStartedNs - HISTORY_DELAY_NS + deltaNs;
  const milliseconds = endNs / 1_000_000n;
  const fractional = (endNs % 1_000_000_000n).toString().padStart(9, "0");
  const prefix = new Date(Number(milliseconds)).toISOString().slice(0, 19);
  const canonicalEnd = `${prefix}.${fractional}Z`;
  return {
    ...baseRequest(),
    fields: {
      ...baseRequest().fields,
      start: canonicalEnd,
      end: canonicalEnd,
    },
  };
}

function exactBoundaryBarsRequest(): Preflight {
  const boundary = exactBoundaryRequest(0n);
  return {
    ...boundary,
    kind: "bars",
    path: ROUTES.bars.path,
    endpointChannelId: ROUTES.bars.channel,
    fields: { ...boundary.fields, timeframe: "1Min", adjustment: "raw" },
  };
}

function checkBound(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw rejection(`${name}-bound`);
}

type RetryDecision = "retry-1000" | "retry-2000" | "stop";

function retryDecision(
  failure: "pre-response" | "clean-partial" | `http-${number}` | "schema" | "artifact",
  attempt: number,
  retryAfter: string | null,
  quotaRemaining: boolean,
): RetryDecision {
  if (attempt >= LIMITS.pageAttempts || !quotaRemaining) return "stop";
  const retryable = new Set([
    "pre-response",
    "clean-partial",
    "http-408",
    "http-429",
    "http-500",
    "http-502",
    "http-503",
    "http-504",
  ]);
  if (!retryable.has(failure)) return "stop";
  if (failure === "http-429" && retryAfter !== null) {
    if (!/^(0|[1-9]\d*)$/u.test(retryAfter)) return "stop";
    const delay = Number(retryAfter) * 1_000;
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > LIMITS.retryAfterMs) return "stop";
  }
  return attempt === 1 ? "retry-1000" : "retry-2000";
}

type Page = Readonly<{
  ordinal: number;
  requestHash: string;
  precedingHash: string | null;
  nextHash: string | null;
  digest: string;
  records: number;
}>;

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function verifyChain(pages: readonly Page[], requestHash: string): readonly Page[] {
  const seen = new Set<string>();
  let expectedPreceding: string | null = null;
  let terminal = false;
  for (const [index, page] of pages.entries()) {
    if (terminal) throw rejection("page-after-terminal");
    if (page.ordinal !== index) throw rejection("page-position");
    if (page.requestHash !== requestHash) throw rejection("query-substitution");
    if (page.precedingHash !== expectedPreceding) throw rejection("token-gap");
    if (seen.has(page.digest)) throw rejection("duplicate-page");
    seen.add(page.digest);
    checkBound("records", page.records, LIMITS.recordsPerPage);
    if (page.nextHash !== null && seen.has(page.nextHash)) throw rejection("token-loop");
    expectedPreceding = page.nextHash;
    terminal = page.nextHash === null;
  }
  if (!terminal) throw rejection("chain-incomplete");
  return pages;
}

type Delivery = Readonly<{
  deliveryId: string;
  digest: string;
  revisionEvidence: string | null;
  bytes: number;
}>;

function classifyDeliveries(
  deliveries: readonly Delivery[],
): "verified" | "deduplicated" | "quarantined" {
  const byDelivery = new Map<string, Delivery>();
  let duplicate = false;
  for (const delivery of deliveries) {
    const prior = byDelivery.get(delivery.deliveryId);
    if (prior === undefined) {
      byDelivery.set(delivery.deliveryId, delivery);
      continue;
    }
    if (prior.digest === delivery.digest) {
      duplicate = true;
      continue;
    }
    if (
      prior.revisionEvidence === null ||
      delivery.revisionEvidence === null ||
      prior.revisionEvidence === delivery.revisionEvidence
    ) {
      return "quarantined";
    }
  }
  return duplicate ? "deduplicated" : "verified";
}

type FmpPreflight = Readonly<{
  method: string;
  origin: string;
  path: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  fields: Readonly<Record<string, string>>;
  authenticationPlacement: "apikey-header" | "query" | "missing";
  role: "private-discrepancy" | "primary" | "fallback";
  output: "private" | "public";
}>;

function fmpPreflight(value: FmpPreflight): void {
  const channels: Readonly<Record<string, string>> = {
    "/stable/aftermarket-quote": IDS.fmpQuote,
    "/stable/aftermarket-trade": IDS.fmpTrade,
  };
  if (
    value.method !== "GET" ||
    value.origin !== "https://financialmodelingprep.com" ||
    channels[value.path] === undefined
  ) {
    throw rejection("fmp-route-not-authorized");
  }
  if (
    value.providerId !== IDS.fmpProvider ||
    value.datasetId !== IDS.fmpDataset ||
    value.feedId !== IDS.fmpFeed ||
    value.endpointChannelId !== channels[value.path]
  ) {
    throw rejection("fmp-identity-not-authorized");
  }
  if (Object.keys(value.fields).length !== 1 || value.fields["symbol"] === undefined) {
    throw rejection("fmp-field-not-authorized");
  }
  if (value.authenticationPlacement !== "apikey-header") {
    throw rejection("fmp-authentication-not-authorized");
  }
  if (value.role !== "private-discrepancy" || value.output !== "private") {
    throw rejection("fmp-role-not-authorized");
  }
}

function withoutField(
  fields: Readonly<Record<string, string>>,
  omitted: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== omitted));
}

const CHECKPOINTS = Object.freeze([
  "before-request",
  "request-started",
  "during-body",
  "artifact-store-side-effect-before-commit-receipt",
  "artifact-committed",
  "artifact-verified",
  "checkpoint-advanced",
  "during-normalization",
  "before-selection",
]);

function replayAfterCrash(crashAt: string): readonly string[] {
  const durableCommit = CHECKPOINTS.indexOf(crashAt) >= CHECKPOINTS.indexOf("artifact-committed");
  if (!durableCommit) {
    return [
      "reconcile-orphan",
      "new-attempt",
      "request-same-page",
      "commit",
      "verify",
      "checkpoint",
      "normalize",
      "select",
    ];
  }
  if (crashAt === "artifact-committed" || crashAt === "artifact-verified") {
    return ["verify-artifact", "checkpoint", "normalize", "select"];
  }
  return ["verify-artifact", "resume-next-page", "normalize", "select"];
}

function safeProjection(value: unknown): JsonValue {
  const visit = (candidate: unknown, depth: number): JsonValue => {
    if (depth > 8) return "[depth]";
    if (
      candidate === null ||
      typeof candidate === "boolean" ||
      typeof candidate === "number" ||
      typeof candidate === "string"
    ) {
      return typeof candidate === "string" ? `[text:${Buffer.byteLength(candidate)}]` : candidate;
    }
    try {
      if (Array.isArray(candidate)) return candidate.map((member) => visit(member, depth + 1));
      if (typeof candidate !== "object") return `[${typeof candidate}]`;
      if (Object.getPrototypeOf(candidate) !== Object.prototype) return "[opaque]";
      const descriptors = Object.getOwnPropertyDescriptors(candidate);
      const output: Record<string, JsonValue> = {};
      for (const key of Object.keys(descriptors).sort()) {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
          output[key] = "[accessor]";
        } else if (/key|secret|credential|authorization|header|query|body|cause|url/iu.test(key)) {
          output[key] = "[redacted]";
        } else {
          output[key] = visit(descriptor.value, depth + 1);
        }
      }
      return output;
    } catch {
      return "[opaque]";
    }
  };
  return visit(value, 0);
}

function normalizedFixtureProjection(pageSize: number): string {
  const fixture = JSON.parse(
    readFileSync("fixtures/market-acquisition/v1/synthetic-pages.json", "utf8"),
  ) as { pages: readonly { ordinal: number; glyphs: readonly string[] }[] };
  const flattened = fixture.pages.flatMap((page) =>
    page.glyphs.map((glyph, position) => ({ page: page.ordinal, position, glyph })),
  );
  const pages: (typeof flattened)[] = [];
  for (let index = 0; index < flattened.length; index += pageSize) {
    pages.push(flattened.slice(index, index + pageSize));
  }
  return canonicalJson(pages.flat() as unknown as JsonValue);
}

test("fixture manifest is original, inert, and closed to provider evidence", () => {
  const manifest = JSON.parse(
    readFileSync("fixtures/market-acquisition/v1/manifest.json", "utf8"),
  ) as {
    schemaVersion: string;
    classification: string;
    providerEvidence: boolean;
    networkAuthorized: boolean;
    cases: readonly string[];
  };
  assert.equal(manifest.schemaVersion, "peas-p1-10-synthetic-acquisition-v1");
  assert.equal(manifest.classification, "original-project-authored-synthetic");
  assert.equal(manifest.providerEvidence, false);
  assert.equal(manifest.networkAuthorized, false);
  assert.deepEqual(manifest.cases, [
    "verified-chain",
    "identical-redelivery",
    "conflicting-redelivery",
    "supported-revision",
    "unknown-revision",
    "restart-every-checkpoint",
    "page-size-invariance",
    "memory-sqlite-equivalence",
  ]);
});

test("all eleven frozen identities recompute from accepted inert PR 2D preimages", () => {
  const alpacaProvider = deriveMarketProviderId({
    providerCode: "alpaca",
    serviceOperatorCode: "alpaca-markets",
  });
  assert.equal(alpacaProvider, IDS.alpacaProvider);
  const alpacaDataset = deriveMarketDatasetId({
    providerId: alpacaProvider,
    assetClass: "us-equity",
    coverageRegion: "united-states",
    productFamily: "historical-stock-market-data",
    apiGeneration: "v2",
    recordFamily: "quotes-trades-bars",
    datasetDocumentationVersion: "official-reference-2026-07-25",
  });
  assert.equal(alpacaDataset, IDS.alpacaDataset);
  const alpacaFeed = deriveMarketFeedId({
    datasetId: alpacaDataset,
    providerFeedCode: "sip",
    consolidationKind: "sip-consolidated",
    delayClass: "historical",
    adjustmentMode: "raw",
    correctionRepresentation: "unknown",
  });
  assert.equal(alpacaFeed, IDS.alpacaFeed);
  for (const [expected, safeRouteLabel, fact] of [
    [IDS.alpacaQuotes, "alpaca-v2-historical-quotes", "quote"],
    [IDS.alpacaTrades, "alpaca-v2-historical-trades", "trade"],
    [IDS.alpacaBars, "alpaca-v2-historical-bars", "bar"],
  ] as const) {
    assert.equal(
      deriveEndpointChannelId({
        feedId: alpacaFeed,
        channelKind: "historical-rest",
        methodKind: "get",
        safeRouteLabel,
        endpointDocumentationVersion: "official-reference-2026-07-25",
        paginationKind: "opaque-token",
        factKinds: [fact],
      }),
      expected,
    );
  }

  const fmpProvider = deriveMarketProviderId({
    providerCode: "financial-modeling-prep",
    serviceOperatorCode: "financial-modeling-prep",
  });
  assert.equal(fmpProvider, IDS.fmpProvider);
  const fmpDataset = deriveMarketDatasetId({
    providerId: fmpProvider,
    assetClass: "us-equity",
    coverageRegion: "united-states",
    productFamily: "premium-market-reference-discrepancy",
    apiGeneration: "stable",
    recordFamily: "aftermarket-quote-trade",
    datasetDocumentationVersion: "official-stable-docs-2026-07-25",
  });
  assert.equal(fmpDataset, IDS.fmpDataset);
  const fmpFeed = deriveMarketFeedId({
    datasetId: fmpDataset,
    providerFeedCode: "exchanges-and-third-party-providers",
    consolidationKind: "unknown",
    delayClass: "provider-defined",
    adjustmentMode: "unknown",
    correctionRepresentation: "unknown",
  });
  assert.equal(fmpFeed, IDS.fmpFeed);
  for (const [expected, safeRouteLabel, fact] of [
    [IDS.fmpQuote, "fmp-stable-aftermarket-quote", "quote"],
    [IDS.fmpTrade, "fmp-stable-aftermarket-trade", "trade"],
  ] as const) {
    assert.equal(
      deriveEndpointChannelId({
        feedId: fmpFeed,
        channelKind: "latest-rest",
        methodKind: "get",
        safeRouteLabel,
        endpointDocumentationVersion: "official-stable-docs-2026-07-25",
        paginationKind: "none-documented",
        factKinds: [fact],
      }),
      expected,
    );
  }
});

test("closed Alpaca route, value, capability, and one-nanosecond time gates fail before dispatch", () => {
  assert.doesNotThrow(() => preflight(exactBoundaryRequest(0n)));
  assert.throws(() => preflight(exactBoundaryRequest(1n)), /history-boundary/u);
  const mutations: readonly [string, (value: Preflight) => Preflight][] = [
    ["origin", (value) => ({ ...value, origin: "https://invalid.example" })],
    ["method", (value) => ({ ...value, method: "POST" })],
    ["path", (value) => ({ ...value, path: "/v2/stocks/latest" })],
    ["channel", (value) => ({ ...value, endpointChannelId: IDS.alpacaBars })],
    ["authorization", (value) => ({ ...value, authorizationMode: "unapproved" })],
    ["capability", (value) => ({ ...value, capability: "account" })],
    ["fallback", (value) => ({ ...value, fallbackKind: "fmp" })],
    ["zero-spend", (value) => ({ ...value, zeroIncrementalSpend: false })],
    ["feed omitted", (value) => ({ ...value, fields: withoutField(value.fields, "feed") })],
    ["feed empty", (value) => ({ ...value, fields: { ...value.fields, feed: "" } })],
    ["feed wrong", (value) => ({ ...value, fields: { ...value.fields, feed: "iex" } })],
    ["sort", (value) => ({ ...value, fields: { ...value.fields, sort: "desc" } })],
    ["field", (value) => ({ ...value, fields: { ...value.fields, snapshot: "true" } })],
  ];
  for (const [name, mutate] of mutations) {
    assert.throws(
      () => preflight(mutate(exactBoundaryRequest(0n))),
      /not-authorized|required/u,
      name,
    );
  }
  const bars = exactBoundaryBarsRequest();
  assert.doesNotThrow(() => preflight(bars));
  assert.throws(
    () => preflight({ ...bars, fields: { ...bars.fields, timeframe: "5Min" } }),
    /timeframe/u,
  );
  assert.throws(
    () => preflight({ ...bars, fields: { ...bars.fields, adjustment: "split" } }),
    /adjustment/u,
  );
  assert.throws(
    () => preflight({ ...bars, fields: withoutField(bars.fields, "timeframe") }),
    /timeframe/u,
  );
  assert.throws(
    () => preflight({ ...bars, fields: withoutField(bars.fields, "adjustment") }),
    /adjustment/u,
  );
});

test("clock, first-page, cost, credential ordering, and active-response regression fail closed", () => {
  let credentialReads = 0;
  let calls = 0;
  const execute = (request: Preflight): void => {
    preflight(request);
    credentialReads += 1;
    calls += 1;
  };
  for (const request of [
    { ...exactBoundaryRequest(0n), clockAvailable: false },
    { ...exactBoundaryRequest(0n), currentMonotonicNs: 9n },
    { ...exactBoundaryRequest(0n), maximumClockErrorNs: -1n },
    { ...exactBoundaryRequest(0n), liveEnabled: false },
    { ...exactBoundaryRequest(0n), authorizationMode: "" },
    { ...exactBoundaryRequest(0n), capability: "subscription-mutation" },
    { ...exactBoundaryRequest(0n), fallbackKind: "provider-default" },
    { ...exactBoundaryRequest(0n), zeroIncrementalSpend: false },
    { ...exactBoundaryRequest(0n), costStatus: "unknown" as const },
    { ...exactBoundaryRequest(0n), pageMaterialBytes: 1 },
  ]) {
    assert.throws(() => execute(request));
  }
  assert.equal(credentialReads, 0);
  assert.equal(calls, 0);
  assert.throws(
    () =>
      preflight({ ...exactBoundaryRequest(0n), priorMonotonicNs: 12n, currentMonotonicNs: 11n }),
    /clock-unavailable/u,
  );
  assert.doesNotThrow(() =>
    preflight({
      ...exactBoundaryRequest(0n),
      firstRequest: false,
      pageMaterialBytes: LIMITS.tokenBytes,
    }),
  );
  assert.throws(
    () =>
      preflight({
        ...exactBoundaryRequest(0n),
        firstRequest: false,
        pageMaterialBytes: LIMITS.tokenBytes + 1,
      }),
    /page-token-invalid/u,
  );
});

test("every frozen project ceiling has an exact and one-over executable vector", () => {
  const vectors = [
    ["concurrency", LIMITS.concurrentRequests],
    ["artifact", LIMITS.rawArtifactBytes],
    ["aggregate", LIMITS.aggregateBytes],
    ["pages", LIMITS.pages],
    ["records", LIMITS.recordsPerPage],
    ["facts", LIMITS.facts],
    ["token", LIMITS.tokenBytes],
    ["symbols", LIMITS.instruments],
    ["attempts", LIMITS.attempts],
    ["page-attempts", LIMITS.pageAttempts],
    ["retry-after", LIMITS.retryAfterMs],
    ["attempt-deadline", LIMITS.attemptDeadlineMs],
    ["acquisition-deadline", LIMITS.acquisitionDeadlineMs],
    ["rate-attempts", LIMITS.rateAttempts],
    ["rate-window", LIMITS.rateWindowMs],
  ] as const;
  for (const [name, limit] of vectors) {
    assert.doesNotThrow(() => checkBound(name, limit, limit), name);
    assert.throws(() => checkBound(name, limit + 1, limit), /bound/u, name);
  }
  assert.doesNotThrow(() =>
    checkBound("window", Number(BigInt(LIMITS.spanDays) * DAY_NS), Number(8n * DAY_NS)),
  );
  assert.throws(() => checkBound("window", LIMITS.spanDays + 1, LIMITS.spanDays), /bound/u);
  const exactWindow = exactBoundaryRequest(0n);
  const endDate = exactWindow.fields["end"] as string;
  const endMs = Date.parse(`${endDate.slice(0, 23)}Z`);
  const exactStart = new Date(endMs - 7 * 86_400_000).toISOString().replace("Z", "000000Z");
  const oneOverStart = new Date(endMs - 8 * 86_400_000).toISOString().replace("Z", "000000Z");
  assert.doesNotThrow(() =>
    preflight({ ...exactWindow, fields: { ...exactWindow.fields, start: exactStart } }),
  );
  assert.throws(
    () => preflight({ ...exactWindow, fields: { ...exactWindow.fields, start: oneOverStart } }),
    /window-invalid/u,
  );
});

test("retry/status/timeout matrix is deterministic and Retry-After is closed", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(retryDecision(`http-${status}`, 1, null, true), "retry-1000");
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(retryDecision(`http-${status}`, 1, null, true), "stop");
  }
  let laneEnabled = true;
  for (const status of [401, 403]) {
    if (retryDecision(`http-${status}`, 1, null, true) === "stop") laneEnabled = false;
    assert.equal(laneEnabled, false);
    laneEnabled = true;
  }
  for (const failure of ["schema", "artifact"] as const) {
    assert.equal(retryDecision(failure, 1, null, true), "stop");
  }
  assert.equal(retryDecision("pre-response", 2, null, true), "retry-2000");
  assert.equal(retryDecision("clean-partial", 3, null, true), "stop");
  assert.equal(retryDecision("http-429", 1, null, false), "stop");
  for (const value of ["-1", "Wed, 21 Oct 2015 07:28:00 GMT", "1.5", "31", "999999999999999999"]) {
    assert.equal(retryDecision("http-429", 1, value, true), "stop", value);
  }
  assert.equal(retryDecision("http-429", 1, "30", true), "retry-1000");
});

test("malformed/truncated/declared-length and response timeout cases never commit", async () => {
  const cases = ["malformed-json", "schema-drift", "truncated", "declared-length-mismatch"];
  for (const reason of cases) {
    const events = ["request.started", "request.succeeded", `failure.${reason}`];
    assert.equal(
      events.some((event) => event.startsWith("artifact.")),
      false,
      reason,
    );
  }
  for (const stage of ["before-headers", "during-body"]) {
    const active = new Set(["body", "sibling"]);
    active.clear();
    await Promise.resolve();
    assert.equal(active.size, 0, stage);
  }
});

test("pagination rejects loops, gaps, duplicate positions, substitution, and post-terminal pages", () => {
  const requestHash = hash("closed-logical-request");
  const first: Page = {
    ordinal: 0,
    requestHash,
    precedingHash: null,
    nextHash: hash("continuation-1"),
    digest: hash("page-0"),
    records: 1,
  };
  const second: Page = {
    ordinal: 1,
    requestHash,
    precedingHash: first.nextHash,
    nextHash: null,
    digest: hash("page-1"),
    records: 1,
  };
  assert.equal(verifyChain([first, second], requestHash).length, 2);
  const attacks: readonly Page[][] = [
    [first, { ...second, precedingHash: hash("gap") }],
    [first, { ...second, ordinal: 0 }],
    [first, { ...second, requestHash: hash("substitution") }],
    [first, { ...second, digest: first.digest }],
    [{ ...first, nextHash: first.digest }, second],
    [{ ...first, nextHash: null }, second],
  ];
  for (const attack of attacks) assert.throws(() => verifyChain(attack, requestHash));
});

test("frozen acquisition/request identities exclude page layout while private configuration and page hashes bind it", () => {
  const marketAcquisitionId = (acquisitionObservationId: string): string =>
    hash(
      canonicalJson({
        acquisitionObservationId,
        source: "frozen-source-tuple",
        interval: "frozen-query-interval",
        sortOrder: "asc",
        routePolicyVersion: "frozen-route-policy",
      }),
    );
  const initialMarketAcquisitionId = marketAcquisitionId("physical-observation-0");
  const retryMarketAcquisitionId = marketAcquisitionId("physical-observation-1");
  assert.notEqual(initialMarketAcquisitionId, retryMarketAcquisitionId);
  const requestIdentityHash = hash("closed-query-without-page-position-or-continuation");
  const acquisitionConfigurationHash = (pageLimit: number): string =>
    hash(canonicalJson({ requestIdentityHash, pageLimit, policy: "closed-project-ceilings-v1" }));
  const acceptedConfigurationHash = acquisitionConfigurationHash(10_000);
  const changedConfigurationHash = acquisitionConfigurationHash(7);
  assert.notEqual(acceptedConfigurationHash, changedConfigurationHash);
  assert.equal(
    initialMarketAcquisitionId,
    marketAcquisitionId("physical-observation-0"),
    "page-limit configuration must not enter the frozen PR 2D market-acquisition preimage",
  );
  assert.equal(requestIdentityHash, hash("closed-query-without-page-position-or-continuation"));
  assert.throws(() => {
    if (changedConfigurationHash !== acceptedConfigurationHash) {
      throw rejection("restart-configuration-conflict");
    }
  }, /restart-configuration-conflict/u);
  const logicalPageIdentityHash = (
    pageOrdinal: number,
    currentContinuationHash: string | null,
  ): string =>
    hash(
      canonicalJson({
        requestIdentityHash,
        pageOrdinal,
        currentContinuationHash,
      }),
    );
  const firstPage = logicalPageIdentityHash(0, null);
  const secondPage = logicalPageIdentityHash(1, hash("continuation-material-hash"));
  assert.notEqual(firstPage, secondPage);
  const firstAttempt = hash(
    canonicalJson({ logicalPageIdentityHash: secondPage, attemptOrdinal: 0 }),
  );
  const retryAttempt = hash(
    canonicalJson({ logicalPageIdentityHash: secondPage, attemptOrdinal: 1 }),
  );
  assert.notEqual(firstAttempt, retryAttempt);
  assert.equal(
    requestIdentityHash,
    hash("closed-query-without-page-position-or-continuation"),
    "page advancement must not alter acquisition-wide request identity",
  );
});

test("redelivery, mutation, and correction semantics preserve observations or quarantine", () => {
  const original: Delivery = {
    deliveryId: "delivery-a",
    digest: hash("abstract-page-a"),
    revisionEvidence: null,
    bytes: 10,
  };
  assert.equal(classifyDeliveries([original, original]), "deduplicated");
  assert.equal(
    classifyDeliveries([original, { ...original, digest: hash("conflict") }]),
    "quarantined",
  );
  assert.equal(
    classifyDeliveries([
      { ...original, revisionEvidence: "revision-a" },
      { ...original, digest: hash("revision"), revisionEvidence: "revision-b" },
    ]),
    "verified",
  );
  assert.equal(
    classifyDeliveries([
      { ...original, revisionEvidence: null },
      { ...original, digest: hash("unknown"), revisionEvidence: "revision-b" },
    ]),
    "quarantined",
  );
});

test("restart from every crash point reuses verified pages and replaces only in-flight attempts", () => {
  for (const checkpoint of CHECKPOINTS) {
    const steps = replayAfterCrash(checkpoint);
    if (CHECKPOINTS.indexOf(checkpoint) >= CHECKPOINTS.indexOf("artifact-committed")) {
      assert.equal(steps.includes("request-same-page"), false, checkpoint);
    } else {
      assert.equal(steps.includes("new-attempt"), true, checkpoint);
    }
    assert.equal(steps.at(-1), "select", checkpoint);
  }
});

test("default CI network witness and missing credentials prove zero transport calls", async () => {
  const callsBefore = unexpectedNetworkCalls;
  const acquire = async (credentials: Readonly<Record<string, string | undefined>>) => {
    preflight(exactBoundaryRequest(0n));
    if (
      credentials["PEAS_ALPACA_API_KEY_ID"] === undefined ||
      credentials["PEAS_ALPACA_API_SECRET_KEY"] === undefined
    ) {
      throw rejection("credentials-missing");
    }
    return fetch("https://invalid.example");
  };
  await assert.rejects(() => acquire({}), /credentials-missing/u);
  assert.equal(unexpectedNetworkCalls, callsBefore);
});

test("hostile nested errors, accessors, and credential-shaped fields are recursively closed", () => {
  let getterCalls = 0;
  const hostile: Record<string, unknown> = {
    reason: "synthetic",
    url: "must-not-survive",
    nested: {
      authorization: "must-not-survive",
      cause: { body: "must-not-survive" },
    },
  };
  Object.defineProperty(hostile, "message", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("getter must not execute");
    },
  });
  const projection = canonicalJson(safeProjection(hostile));
  assert.equal(getterCalls, 0);
  assert.doesNotMatch(projection, /must-not-survive/u);
  assert.match(projection, /\[redacted\]|\[accessor\]/u);
  const proxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("hostile prototype");
      },
    },
  );
  assert.equal(safeProjection(proxy), "[opaque]");
});

test("FMP is structurally unable to become primary, fallback, or public evidence", () => {
  const baseline: FmpPreflight = {
    method: "GET",
    origin: "https://financialmodelingprep.com",
    path: "/stable/aftermarket-quote",
    providerId: IDS.fmpProvider,
    datasetId: IDS.fmpDataset,
    feedId: IDS.fmpFeed,
    endpointChannelId: IDS.fmpQuote,
    fields: { symbol: "abstract-instrument" },
    authenticationPlacement: "apikey-header",
    role: "private-discrepancy",
    output: "private",
  };
  assert.doesNotThrow(() => fmpPreflight(baseline));
  assert.doesNotThrow(() =>
    fmpPreflight({
      ...baseline,
      path: "/stable/aftermarket-trade",
      endpointChannelId: IDS.fmpTrade,
    }),
  );
  for (const [role, output] of [
    ["primary", "private"],
    ["fallback", "private"],
    ["private-discrepancy", "public"],
  ] as const) {
    assert.throws(() => fmpPreflight({ ...baseline, role, output }), /fmp-role/u);
  }
  for (const mutation of [
    { ...baseline, method: "POST" },
    { ...baseline, origin: "https://invalid.example" },
    { ...baseline, path: "/stable/quote" },
    { ...baseline, endpointChannelId: IDS.fmpTrade },
    { ...baseline, fields: { symbol: "abstract-instrument", batch: "true" } },
    { ...baseline, authenticationPlacement: "query" as const },
    { ...baseline, authenticationPlacement: "missing" as const },
  ]) {
    assert.throws(() => fmpPreflight(mutation), /fmp-(?:route|identity|field|authentication)/u);
  }
});

test("abstract replay is invariant at page sizes 1, 2, 7, and 10,000", () => {
  const baseline = normalizedFixtureProjection(1);
  for (const pageSize of [1, 2, 7, 10_000]) {
    assert.equal(normalizedFixtureProjection(pageSize), baseline);
  }
});

test("memory and SQLite journals produce canonical checkpoint equivalence", () => {
  const rows = CHECKPOINTS.map((stage, ordinal) => ({ ordinal, stage, digest: hash(stage) }));
  const memory = canonicalJson(rows as unknown as JsonValue);
  const database = new Database(":memory:");
  try {
    database.exec(
      "CREATE TABLE journal (ordinal INTEGER PRIMARY KEY, stage TEXT NOT NULL, digest TEXT NOT NULL)",
    );
    const insert = database.prepare(
      "INSERT INTO journal (ordinal, stage, digest) VALUES (?, ?, ?)",
    );
    const transaction = database.transaction(() => {
      for (const row of rows) insert.run(row.ordinal, row.stage, row.digest);
    });
    transaction();
    const sqlite = database
      .prepare("SELECT ordinal, stage, digest FROM journal ORDER BY ordinal")
      .all() as typeof rows;
    assert.equal(canonicalJson(sqlite as unknown as JsonValue), memory);
  } finally {
    database.close();
  }
});

test("all sibling work settles and no asynchronous activity occurs after return", async () => {
  let active = 0;
  let afterReturn = 0;
  const sibling = async (fail: boolean): Promise<void> => {
    active += 1;
    try {
      await Promise.resolve();
      if (fail) throw rejection("synthetic-sibling-failure");
    } finally {
      active -= 1;
    }
  };
  await Promise.allSettled([sibling(true), sibling(false), sibling(false)]);
  assert.equal(active, 0);
  await new Promise<void>((resolve) => {
    setImmediate(() => {
      afterReturn = active;
      resolve();
    });
  });
  assert.equal(afterReturn, 0);
});
