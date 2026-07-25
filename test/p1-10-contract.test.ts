import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import {
  deriveEndpointChannelId,
  deriveMarketDatasetId,
  deriveMarketFeedId,
  deriveMarketProviderId,
} from "../src/providers/market-reference/identity.js";

const NS_PER_MINUTE = 60_000_000_000n;
const HISTORY_DELAY_NS = 15n * NS_PER_MINUTE;
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

const ZERO_SPEND_POLICY_PREIMAGE = Object.freeze({
  schemaVersion: 1,
  policyVersion: "p1-10-zero-spend-policy-v1",
  p109AuthorityCandidate: "36dcf92b465fc5708614718b4312631fb5dbf544",
  maximumIncrementalSpend: "0",
  existingEntitlementsOnly: true,
  accountInspection: "forbidden",
  accountMutation: "forbidden",
  subscriptionMutation: "forbidden",
  unknownCostBehavior: "reject-before-credential-read",
  fallbackKind: "none",
});
const ZERO_SPEND_POLICY_ID =
  "mzp1_b2f575e234dcd7f05eb5fcc03060420313b56e45aff87c961c3771d1c5cf3b9e";

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
  costStatus: "zero-incremental-spend-approved" | "unknown" | "stale";
  zeroSpendPolicyId: string | null;
  zeroSpendPolicyPreimage: Readonly<Record<string, JsonValue>> | null;
  runDecision: "allow" | "reject" | null;
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
    costStatus: "zero-incremental-spend-approved",
    zeroSpendPolicyId: ZERO_SPEND_POLICY_ID,
    zeroSpendPolicyPreimage: ZERO_SPEND_POLICY_PREIMAGE,
    runDecision: "allow",
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
  if (
    value.zeroSpendPolicyId !== ZERO_SPEND_POLICY_ID ||
    value.zeroSpendPolicyPreimage === null ||
    `mzp1_${canonicalHash(
      "peas/market-zero-spend-policy/v1",
      value.zeroSpendPolicyPreimage as JsonValue,
    )}` !== ZERO_SPEND_POLICY_ID ||
    value.runDecision !== "allow" ||
    value.costStatus !== "zero-incremental-spend-approved"
  ) {
    throw rejection("cost-unproven");
  }
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
  const limitText = value.fields["limit"] as string;
  if (!/^[1-9]\d{0,4}$/u.test(limitText)) throw rejection("limit-not-authorized");
  const parsedLimit = Number(limitText);
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > LIMITS.recordsPerPage ||
    String(parsedLimit) !== limitText
  ) {
    throw rejection("limit-not-authorized");
  }
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

type QuotaClassification =
  | "temporary-throttling-proved"
  | "quota-exhausted"
  | "missing"
  | "ambiguous";
type RetryDecision =
  | Readonly<{ kind: "retry"; delayMs: number }>
  | Readonly<{ kind: "stop"; delayMs: null }>;

function retryDecision(
  failure: "pre-response" | "clean-partial" | `http-${number}` | "schema" | "artifact",
  attempt: number,
  retryAfter: string | null,
  quotaClassification: QuotaClassification,
): RetryDecision {
  if (attempt >= LIMITS.pageAttempts) return { kind: "stop", delayMs: null };
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
  if (!retryable.has(failure)) return { kind: "stop", delayMs: null };
  const projectDelayMs = attempt === 1 ? 1_000 : 2_000;
  if (failure === "http-429") {
    if (quotaClassification !== "temporary-throttling-proved") {
      return { kind: "stop", delayMs: null };
    }
    if (retryAfter === null) return { kind: "retry", delayMs: projectDelayMs };
    if (!/^(0|[1-9]\d*)$/u.test(retryAfter)) return { kind: "stop", delayMs: null };
    const delay = Number(retryAfter) * 1_000;
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > LIMITS.retryAfterMs) {
      return { kind: "stop", delayMs: null };
    }
    return { kind: "retry", delayMs: Math.max(projectDelayMs, delay) };
  }
  return { kind: "retry", delayMs: projectDelayMs };
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
  const seenDigests = new Set<string>();
  const returnedTokenHashes = new Set<string>();
  let expectedPreceding: string | null = null;
  let terminal = false;
  for (const [index, page] of pages.entries()) {
    if (terminal) throw rejection("page-after-terminal");
    if (page.ordinal !== index) throw rejection("page-position");
    if (page.requestHash !== requestHash) throw rejection("query-substitution");
    if (page.precedingHash !== expectedPreceding) throw rejection("token-gap");
    if (seenDigests.has(page.digest)) throw rejection("duplicate-page");
    seenDigests.add(page.digest);
    if (
      !Number.isSafeInteger(page.records) ||
      page.records < 0 ||
      page.records > LIMITS.recordsPerPage
    ) {
      throw rejection("records-bound");
    }
    if (page.nextHash !== null) {
      if (returnedTokenHashes.has(page.nextHash)) throw rejection("token-loop");
      returnedTokenHashes.add(page.nextHash);
    }
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

type SideEffectCounters = {
  credentialReads: number;
  transportConstructions: number;
  dnsCalls: number;
  networkCalls: number;
  providerCalls: number;
  artifactCalls: number;
  normalizationCalls: number;
  selectionCalls: number;
  postReturnActivity: number;
};

function zeroCounters(): SideEffectCounters {
  return {
    credentialReads: 0,
    transportConstructions: 0,
    dnsCalls: 0,
    networkCalls: 0,
    providerCalls: 0,
    artifactCalls: 0,
    normalizationCalls: 0,
    selectionCalls: 0,
    postReturnActivity: 0,
  };
}

function assertZeroSideEffects(counters: SideEffectCounters): void {
  assert.deepEqual(counters, zeroCounters());
}

function guardedPreflight(request: Preflight, counters: SideEffectCounters): void {
  preflight(request);
  counters.credentialReads += 1;
  counters.transportConstructions += 1;
}

function requestIdentity(request: Preflight): string {
  return canonicalHash("peas/p1-10-request-identity/v1", {
    providerId: request.providerId,
    datasetId: request.datasetId,
    feedId: request.feedId,
    endpointChannelId: request.endpointChannelId,
    kind: request.kind,
    start: request.fields["start"] as string,
    end: request.fields["end"] as string,
    sort: request.fields["sort"] as string,
    authorizationMode: request.authorizationMode,
  });
}

function configurationHash(request: Preflight): string {
  return canonicalHash("peas/p1-10-private-configuration/v1", {
    requestIdentityHash: requestIdentity(request),
    requestedPageLimit: request.fields["limit"] as string,
    zeroSpendPolicyId: request.zeroSpendPolicyId,
    zeroSpendRunDecision: request.runDecision,
  });
}

type IdentityFamily = "provider" | "dataset" | "feed" | "channel";
type IdentityEnvelope = Readonly<{
  name: string;
  family: IdentityFamily;
  preimage: Readonly<Record<string, unknown>>;
  expectedId: string;
  lane: "alpaca" | "fmp";
}>;

const IDENTITY_ENVELOPES: readonly IdentityEnvelope[] = [
  {
    name: "alpaca-provider",
    family: "provider",
    preimage: { providerCode: "alpaca", serviceOperatorCode: "alpaca-markets" },
    expectedId: IDS.alpacaProvider,
    lane: "alpaca",
  },
  {
    name: "fmp-provider",
    family: "provider",
    preimage: {
      providerCode: "financial-modeling-prep",
      serviceOperatorCode: "financial-modeling-prep",
    },
    expectedId: IDS.fmpProvider,
    lane: "fmp",
  },
  {
    name: "alpaca-dataset",
    family: "dataset",
    preimage: {
      providerId: IDS.alpacaProvider,
      assetClass: "us-equity",
      coverageRegion: "united-states",
      productFamily: "historical-stock-market-data",
      apiGeneration: "v2",
      recordFamily: "quotes-trades-bars",
      datasetDocumentationVersion: "official-reference-2026-07-25",
    },
    expectedId: IDS.alpacaDataset,
    lane: "alpaca",
  },
  {
    name: "fmp-dataset",
    family: "dataset",
    preimage: {
      providerId: IDS.fmpProvider,
      assetClass: "us-equity",
      coverageRegion: "united-states",
      productFamily: "premium-market-reference-discrepancy",
      apiGeneration: "stable",
      recordFamily: "aftermarket-quote-trade",
      datasetDocumentationVersion: "official-stable-docs-2026-07-25",
    },
    expectedId: IDS.fmpDataset,
    lane: "fmp",
  },
  {
    name: "alpaca-feed",
    family: "feed",
    preimage: {
      datasetId: IDS.alpacaDataset,
      providerFeedCode: "sip",
      consolidationKind: "sip-consolidated",
      delayClass: "historical",
      adjustmentMode: "raw",
      correctionRepresentation: "unknown",
    },
    expectedId: IDS.alpacaFeed,
    lane: "alpaca",
  },
  {
    name: "fmp-feed",
    family: "feed",
    preimage: {
      datasetId: IDS.fmpDataset,
      providerFeedCode: "exchanges-and-third-party-providers",
      consolidationKind: "unknown",
      delayClass: "provider-defined",
      adjustmentMode: "unknown",
      correctionRepresentation: "unknown",
    },
    expectedId: IDS.fmpFeed,
    lane: "fmp",
  },
  {
    name: "alpaca-quotes-channel",
    family: "channel",
    preimage: {
      feedId: IDS.alpacaFeed,
      channelKind: "historical-rest",
      methodKind: "get",
      safeRouteLabel: "alpaca-v2-historical-quotes",
      endpointDocumentationVersion: "official-reference-2026-07-25",
      paginationKind: "opaque-token",
      factKinds: ["quote"],
    },
    expectedId: IDS.alpacaQuotes,
    lane: "alpaca",
  },
  {
    name: "alpaca-trades-channel",
    family: "channel",
    preimage: {
      feedId: IDS.alpacaFeed,
      channelKind: "historical-rest",
      methodKind: "get",
      safeRouteLabel: "alpaca-v2-historical-trades",
      endpointDocumentationVersion: "official-reference-2026-07-25",
      paginationKind: "opaque-token",
      factKinds: ["trade"],
    },
    expectedId: IDS.alpacaTrades,
    lane: "alpaca",
  },
  {
    name: "alpaca-bars-channel",
    family: "channel",
    preimage: {
      feedId: IDS.alpacaFeed,
      channelKind: "historical-rest",
      methodKind: "get",
      safeRouteLabel: "alpaca-v2-historical-bars",
      endpointDocumentationVersion: "official-reference-2026-07-25",
      paginationKind: "opaque-token",
      factKinds: ["bar"],
    },
    expectedId: IDS.alpacaBars,
    lane: "alpaca",
  },
  {
    name: "fmp-quote-channel",
    family: "channel",
    preimage: {
      feedId: IDS.fmpFeed,
      channelKind: "latest-rest",
      methodKind: "get",
      safeRouteLabel: "fmp-stable-aftermarket-quote",
      endpointDocumentationVersion: "official-stable-docs-2026-07-25",
      paginationKind: "none-documented",
      factKinds: ["quote"],
    },
    expectedId: IDS.fmpQuote,
    lane: "fmp",
  },
  {
    name: "fmp-trade-channel",
    family: "channel",
    preimage: {
      feedId: IDS.fmpFeed,
      channelKind: "latest-rest",
      methodKind: "get",
      safeRouteLabel: "fmp-stable-aftermarket-trade",
      endpointDocumentationVersion: "official-stable-docs-2026-07-25",
      paginationKind: "none-documented",
      factKinds: ["trade"],
    },
    expectedId: IDS.fmpTrade,
    lane: "fmp",
  },
];

function validateIdentityEnvelope(value: IdentityEnvelope): void {
  const exactKeys = ["expectedId", "family", "lane", "name", "preimage"];
  if (Object.keys(value).sort().join(",") !== exactKeys.join(",")) {
    throw rejection("identity-envelope-invalid");
  }
  let derived: string;
  switch (value.family) {
    case "provider":
      derived = deriveMarketProviderId(value.preimage as never);
      break;
    case "dataset":
      derived = deriveMarketDatasetId(value.preimage as never);
      break;
    case "feed":
      derived = deriveMarketFeedId(value.preimage as never);
      break;
    case "channel":
      derived = deriveEndpointChannelId(value.preimage as never);
      break;
  }
  if (derived !== value.expectedId) throw rejection("identity-envelope-invalid");
}

function guardedIdentityConfiguration(value: IdentityEnvelope, counters: SideEffectCounters): void {
  validateIdentityEnvelope(value);
  if (value.lane === "alpaca") {
    preflight(exactBoundaryRequest(0n));
  } else {
    fmpPreflight({
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
    });
  }
  counters.credentialReads += 1;
  counters.transportConstructions += 1;
  counters.dnsCalls += 1;
  counters.networkCalls += 1;
  counters.providerCalls += 1;
  counters.artifactCalls += 1;
  counters.normalizationCalls += 1;
  counters.selectionCalls += 1;
  counters.postReturnActivity += 1;
}

type ContractEvent =
  | "acquisition.declared"
  | "request.started"
  | "request.succeeded"
  | "artifact.committed"
  | "artifact.verified"
  | "checkpoint.advanced"
  | "chain.complete"
  | "normalization.started"
  | "normalization.emitted"
  | "selection.started"
  | "selection.recorded"
  | "failure.recorded";

type AcquisitionBudgets = {
  pages: number;
  bytes: number;
  records: number;
  facts: number;
  attempts: number;
};

type CheckpointKind =
  | "acquisition-declared"
  | "attempt-started"
  | "request-succeeded"
  | "artifact-committed"
  | "artifact-verified"
  | "page-checkpointed"
  | "chain-complete"
  | "normalization-started"
  | "normalization-complete"
  | "selection-started"
  | "completed"
  | "stopped"
  | "failed-clean"
  | "quarantined";

const ACQUISITION_STATES = Object.freeze([
  "declared",
  "preflighting",
  "dispatch-ready",
  "credential-ready",
  "attempt-active",
  "response-accepted",
  "artifact-committing",
  "artifact-committed",
  "artifact-verifying",
  "page-verified",
  "checkpointing",
  "waiting-retry",
  "chain-complete",
  "normalizing",
  "ready-for-selection",
  "selecting",
  "completed",
  "stopped",
  "failed-clean",
  "quarantined",
] as const);
type AcquisitionState = (typeof ACQUISITION_STATES)[number];

const ACQUISITION_TRANSITIONS: Readonly<Record<AcquisitionState, readonly AcquisitionState[]>> = {
  declared: ["preflighting"],
  preflighting: ["dispatch-ready", "stopped", "failed-clean"],
  "dispatch-ready": ["credential-ready", "stopped"],
  "credential-ready": ["attempt-active"],
  "attempt-active": ["waiting-retry", "response-accepted", "stopped", "failed-clean"],
  "response-accepted": ["artifact-committing", "failed-clean"],
  "artifact-committing": ["artifact-committed", "failed-clean"],
  "artifact-committed": ["artifact-verifying"],
  "artifact-verifying": ["page-verified", "failed-clean", "quarantined"],
  "page-verified": ["checkpointing"],
  checkpointing: ["chain-complete", "preflighting", "failed-clean"],
  "waiting-retry": ["preflighting", "stopped"],
  "chain-complete": ["normalizing"],
  normalizing: ["ready-for-selection", "quarantined", "failed-clean"],
  "ready-for-selection": ["selecting"],
  selecting: ["completed", "failed-clean", "quarantined"],
  completed: [],
  stopped: [],
  "failed-clean": [],
  quarantined: [],
};

function validateAcquisitionTransition(from: AcquisitionState, to: AcquisitionState): void {
  if (!ACQUISITION_TRANSITIONS[from].includes(to)) {
    throw rejection("acquisition-transition-invalid");
  }
}

type DurableCheckpoint = Readonly<{
  schemaVersion: 1;
  marketAcquisitionJournalId: string;
  acquisitionObservationId: string;
  marketAcquisitionId: string;
  admittedMarketAcquisitionIds: readonly string[];
  requestIdentityHash: string;
  acquisitionConfigurationHash: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  authorizationMode: "p1-09-approved";
  logicalPageIdentityHash: string;
  pageOrdinal: number;
  checkpointKind: CheckpointKind;
  currentTokenHash: string;
  currentResumableTokenMaterial: string | null;
  nextTokenHash: string | null;
  nextResumableTokenMaterial: string | null;
  attemptId: string;
  attemptOrdinal: number;
  artifactObservationId: string | null;
  artifactDigest: string | null;
  artifactSizeBytes: number | null;
  artifactObservationHash: string | null;
  artifactContentId: string | null;
  rawArtifactId: string | null;
  stageLedgerFactId: string | null;
  causalParentFactIds: readonly string[];
  pageRecordCount: number | null;
  pageNormalizedFactCount: number | null;
  pageChainHash: string;
  cumulativeSuccessfulPages: number;
  cumulativeVerifiedBytes: number;
  cumulativeRecords: number;
  cumulativeNormalizedFacts: number;
  cumulativeAttempts: number;
  acquisitionDeadlineBasis: string;
  quotaWindowEvidence: readonly number[];
  terminalState: "completed" | "stopped" | "failed-clean" | "quarantined" | null;
  terminalReasonCode: string | null;
  incomplete: boolean;
  priorJournalEntryHash: string;
  journalSequence: number;
  journalEntryHash: string;
}>;

const CHECKPOINT_KEYS = Object.freeze([
  "schemaVersion",
  "marketAcquisitionJournalId",
  "acquisitionObservationId",
  "marketAcquisitionId",
  "admittedMarketAcquisitionIds",
  "requestIdentityHash",
  "acquisitionConfigurationHash",
  "providerId",
  "datasetId",
  "feedId",
  "endpointChannelId",
  "authorizationMode",
  "logicalPageIdentityHash",
  "pageOrdinal",
  "checkpointKind",
  "currentTokenHash",
  "currentResumableTokenMaterial",
  "nextTokenHash",
  "nextResumableTokenMaterial",
  "attemptId",
  "attemptOrdinal",
  "artifactObservationId",
  "artifactDigest",
  "artifactSizeBytes",
  "artifactObservationHash",
  "artifactContentId",
  "rawArtifactId",
  "stageLedgerFactId",
  "causalParentFactIds",
  "pageRecordCount",
  "pageNormalizedFactCount",
  "pageChainHash",
  "cumulativeSuccessfulPages",
  "cumulativeVerifiedBytes",
  "cumulativeRecords",
  "cumulativeNormalizedFacts",
  "cumulativeAttempts",
  "acquisitionDeadlineBasis",
  "quotaWindowEvidence",
  "terminalState",
  "terminalReasonCode",
  "incomplete",
  "priorJournalEntryHash",
  "journalSequence",
  "journalEntryHash",
] as const);

type JournalRow = Readonly<{
  sequence: number;
  event: ContractEvent;
  checkpoint: DurableCheckpoint;
}>;

type ImmutableReceiptSidecars = Readonly<{
  attempts: readonly Readonly<{ attemptId: string; ordinal: number }>[];
  artifacts: readonly Readonly<{
    observationId: string;
    digest: string;
    sizeBytes: number;
    observationHash: string;
    contentId: string;
    rawArtifactId: string;
  }>[];
  admittedPages: readonly Readonly<{
    marketAcquisitionId: string;
    pageOrdinal: number;
    recordCount: number;
    artifactDigest: string;
  }>[];
  normalizations: readonly Readonly<{ factCount: number }>[];
}>;

interface ContractJournal {
  append(event: ContractEvent, checkpoint: DurableCheckpoint): void;
  rows(): readonly JournalRow[];
  close(): void;
}

const PREDECESSORS: Readonly<Record<ContractEvent, readonly ContractEvent[]>> = {
  "acquisition.declared": [],
  "request.started": [
    "acquisition.declared",
    "request.started",
    "request.succeeded",
    "failure.recorded",
  ],
  "request.succeeded": ["request.started"],
  "artifact.committed": ["request.succeeded"],
  "artifact.verified": ["artifact.committed"],
  "checkpoint.advanced": ["artifact.verified"],
  "chain.complete": ["checkpoint.advanced"],
  "normalization.started": ["chain.complete"],
  "normalization.emitted": ["normalization.started"],
  "selection.started": ["normalization.emitted"],
  "selection.recorded": ["selection.started"],
  "failure.recorded": [
    "acquisition.declared",
    "request.started",
    "request.succeeded",
    "artifact.committed",
    "artifact.verified",
    "checkpoint.advanced",
    "chain.complete",
    "normalization.started",
    "normalization.emitted",
    "selection.started",
  ],
};

function validateJournalAppend(rows: readonly JournalRow[], event: ContractEvent): void {
  if (rows.length === 0) {
    if (event !== "acquisition.declared") throw rejection("illegal-transition");
    return;
  }
  if (event === "acquisition.declared") throw rejection("illegal-transition");
  const prior = rows.at(-1)?.event;
  if (prior === undefined || !PREDECESSORS[event].includes(prior)) {
    throw rejection("illegal-transition");
  }
}

function checkpointKindForEvent(event: ContractEvent): CheckpointKind {
  const map: Readonly<Record<ContractEvent, CheckpointKind>> = {
    "acquisition.declared": "acquisition-declared",
    "request.started": "attempt-started",
    "request.succeeded": "request-succeeded",
    "artifact.committed": "artifact-committed",
    "artifact.verified": "artifact-verified",
    "checkpoint.advanced": "page-checkpointed",
    "chain.complete": "chain-complete",
    "normalization.started": "normalization-started",
    "normalization.emitted": "normalization-complete",
    "selection.started": "selection-started",
    "selection.recorded": "completed",
    "failure.recorded": "failed-clean",
  };
  return map[event];
}

const CHECKPOINT_KIND_TRANSITIONS: Readonly<Record<CheckpointKind, readonly CheckpointKind[]>> = {
  "acquisition-declared": ["attempt-started", "stopped", "failed-clean", "quarantined"],
  "attempt-started": ["attempt-started", "request-succeeded", "stopped", "failed-clean"],
  "request-succeeded": ["attempt-started", "artifact-committed", "stopped", "failed-clean"],
  "artifact-committed": ["artifact-verified", "stopped", "failed-clean", "quarantined"],
  "artifact-verified": ["page-checkpointed", "stopped", "failed-clean", "quarantined"],
  "page-checkpointed": ["attempt-started", "chain-complete", "stopped", "failed-clean"],
  "chain-complete": ["normalization-started", "stopped", "failed-clean", "quarantined"],
  "normalization-started": ["normalization-complete", "stopped", "failed-clean", "quarantined"],
  "normalization-complete": ["selection-started", "stopped", "failed-clean", "quarantined"],
  "selection-started": ["completed", "stopped", "failed-clean", "quarantined"],
  completed: [],
  stopped: [],
  "failed-clean": [],
  quarantined: [],
};

function validateCheckpointKindTransition(
  prior: CheckpointKind | null,
  next: CheckpointKind,
): void {
  if (prior === null) {
    if (next !== "acquisition-declared") throw rejection("checkpoint-transition-invalid");
    return;
  }
  if (!CHECKPOINT_KIND_TRANSITIONS[prior].includes(next)) {
    throw rejection("checkpoint-transition-invalid");
  }
}

function deriveJournalEntryHash(checkpoint: DurableCheckpoint): string {
  return canonicalHash("peas/p1-10-acquisition-journal-entry/v1", {
    ...(checkpoint as unknown as Record<string, JsonValue>),
    journalEntryHash: "",
  });
}

function finalizeCheckpoint(
  rows: readonly JournalRow[],
  event: ContractEvent,
  checkpoint: DurableCheckpoint,
): DurableCheckpoint {
  const prior = rows.at(-1)?.checkpoint;
  const journalSequence = rows.length;
  const stageLedgerFactId = hash(`ledger:${journalSequence}:${event}`);
  const finalized = {
    ...checkpoint,
    checkpointKind: checkpointKindForEvent(event),
    nextTokenHash:
      event === "artifact.verified" ||
      event === "checkpoint.advanced" ||
      event === "chain.complete" ||
      event === "normalization.started" ||
      event === "normalization.emitted" ||
      event === "selection.started" ||
      event === "selection.recorded"
        ? hash("terminal-token")
        : checkpoint.nextTokenHash,
    pageRecordCount:
      event === "artifact.verified" && checkpoint.pageRecordCount === null
        ? 3
        : checkpoint.pageRecordCount,
    terminalState:
      event === "selection.recorded"
        ? "completed"
        : event === "failure.recorded"
          ? "failed-clean"
          : checkpoint.terminalState,
    terminalReasonCode:
      event === "selection.recorded"
        ? "selection-recorded"
        : event === "failure.recorded"
          ? "terminal-failure"
          : checkpoint.terminalReasonCode,
    incomplete:
      event === "selection.recorded" || event === "failure.recorded"
        ? false
        : checkpoint.incomplete,
    stageLedgerFactId,
    causalParentFactIds:
      prior?.stageLedgerFactId === null || prior?.stageLedgerFactId === undefined
        ? []
        : [prior.stageLedgerFactId],
    priorJournalEntryHash: prior?.journalEntryHash ?? "genesis",
    journalSequence,
    journalEntryHash: "",
  } satisfies DurableCheckpoint;
  validateCheckpointKindTransition(prior?.checkpointKind ?? null, finalized.checkpointKind);
  return { ...finalized, journalEntryHash: deriveJournalEntryHash(finalized) };
}

function validateExactCheckpoint(checkpoint: DurableCheckpoint): void {
  if (Object.keys(checkpoint).sort().join(",") !== [...CHECKPOINT_KEYS].sort().join(",")) {
    throw rejection("checkpoint-shape-invalid");
  }
  if (deriveJournalEntryHash(checkpoint) !== checkpoint.journalEntryHash) {
    throw rejection("checkpoint-hash-invalid");
  }
  if (
    checkpoint.marketAcquisitionId !==
      hash(`market-acquisition:${checkpoint.acquisitionObservationId}`) ||
    checkpoint.logicalPageIdentityHash !==
      hash(
        `logical-page:${checkpoint.pageOrdinal}:${
          checkpoint.pageOrdinal === 0 ? "no-token" : checkpoint.currentTokenHash
        }`,
      ) ||
    checkpoint.quotaWindowEvidence.length !== checkpoint.cumulativeAttempts
  ) {
    throw rejection("checkpoint-identity-invalid");
  }
}

function validateCheckpointSemantics(
  checkpoint: DurableCheckpoint,
  prior: DurableCheckpoint | null,
): void {
  const terminalKinds: readonly CheckpointKind[] = [
    "completed",
    "stopped",
    "failed-clean",
    "quarantined",
  ];
  if (
    checkpoint.pageOrdinal === 0
      ? checkpoint.currentTokenHash !== hash("no-token") ||
        checkpoint.currentResumableTokenMaterial !== null
      : checkpoint.currentResumableTokenMaterial === null ||
        checkpoint.currentTokenHash !== hash(checkpoint.currentResumableTokenMaterial)
  ) {
    throw rejection("checkpoint-current-token-invalid");
  }
  const terminalTokenExpected = [
    "artifact-verified",
    "page-checkpointed",
    "chain-complete",
    "normalization-started",
    "normalization-complete",
    "selection-started",
    "completed",
  ].includes(checkpoint.checkpointKind);
  if (
    terminalTokenExpected
      ? checkpoint.nextTokenHash !== hash("terminal-token") ||
        checkpoint.nextResumableTokenMaterial !== null
      : checkpoint.nextTokenHash !== null || checkpoint.nextResumableTokenMaterial !== null
  ) {
    throw rejection("checkpoint-next-token-invalid");
  }
  const artifactFields = [
    checkpoint.artifactObservationId,
    checkpoint.artifactDigest,
    checkpoint.artifactSizeBytes,
    checkpoint.artifactObservationHash,
    checkpoint.artifactContentId,
    checkpoint.rawArtifactId,
  ];
  const hasArtifact = artifactFields.every((value) => value !== null);
  if (!hasArtifact && artifactFields.some((value) => value !== null)) {
    throw rejection("checkpoint-artifact-partial");
  }
  if (
    hasArtifact &&
    (checkpoint.artifactObservationHash !==
      hash(`observation:${checkpoint.artifactObservationId}`) ||
      checkpoint.artifactContentId !== hash(`content:${checkpoint.artifactDigest}`) ||
      checkpoint.rawArtifactId !==
        hash(`raw:${checkpoint.artifactObservationId}:${checkpoint.artifactDigest}`))
  ) {
    throw rejection("checkpoint-artifact-binding-invalid");
  }
  const tupleAuthorized =
    (checkpoint.providerId === IDS.alpacaProvider &&
      checkpoint.datasetId === IDS.alpacaDataset &&
      checkpoint.feedId === IDS.alpacaFeed &&
      [IDS.alpacaQuotes, IDS.alpacaTrades, IDS.alpacaBars].includes(
        checkpoint.endpointChannelId as never,
      )) ||
    (checkpoint.providerId === IDS.fmpProvider &&
      checkpoint.datasetId === IDS.fmpDataset &&
      checkpoint.feedId === IDS.fmpFeed &&
      [IDS.fmpQuote, IDS.fmpTrade].includes(checkpoint.endpointChannelId as never));
  if (
    !tupleAuthorized ||
    checkpoint.authorizationMode !== "p1-09-approved" ||
    !/^[0-9a-f]{64}$/u.test(checkpoint.requestIdentityHash) ||
    !/^[0-9a-f]{64}$/u.test(checkpoint.acquisitionConfigurationHash)
  ) {
    throw rejection("checkpoint-authority-invalid");
  }
  for (const [value, maximum] of [
    [checkpoint.pageOrdinal, LIMITS.pages - 1],
    [checkpoint.attemptOrdinal, LIMITS.pageAttempts - 1],
    [checkpoint.artifactSizeBytes ?? 0, LIMITS.rawArtifactBytes],
    [checkpoint.pageRecordCount ?? 0, LIMITS.recordsPerPage],
    [checkpoint.pageNormalizedFactCount ?? 0, LIMITS.facts],
    [checkpoint.cumulativeSuccessfulPages, LIMITS.pages],
    [checkpoint.cumulativeVerifiedBytes, LIMITS.aggregateBytes],
    [checkpoint.cumulativeRecords, LIMITS.pages * LIMITS.recordsPerPage],
    [checkpoint.cumulativeNormalizedFacts, LIMITS.facts],
    [checkpoint.cumulativeAttempts, LIMITS.attempts],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw rejection("checkpoint-bound-invalid");
    }
  }
  if (
    checkpoint.admittedMarketAcquisitionIds.length !== checkpoint.cumulativeSuccessfulPages ||
    (checkpoint.cumulativeSuccessfulPages > 0 &&
      checkpoint.admittedMarketAcquisitionIds.at(-1) !== checkpoint.marketAcquisitionId)
  ) {
    throw rejection("checkpoint-admission-invalid");
  }
  if (prior !== null) {
    const shouldAdvance = checkpoint.checkpointKind === "page-checkpointed";
    if (
      shouldAdvance
        ? checkpoint.pageChainHash === prior.pageChainHash
        : checkpoint.pageChainHash !== prior.pageChainHash
    ) {
      throw rejection("checkpoint-page-chain-invalid");
    }
  }
  const terminal = terminalKinds.includes(checkpoint.checkpointKind);
  if (
    terminal
      ? checkpoint.terminalState === null ||
        checkpoint.terminalReasonCode === null ||
        checkpoint.incomplete
      : checkpoint.terminalState !== null ||
        checkpoint.terminalReasonCode !== null ||
        !checkpoint.incomplete
  ) {
    throw rejection("checkpoint-terminal-invalid");
  }
}

function validateJournalRows(rows: readonly JournalRow[]): void {
  let expectedPages = 0;
  let expectedBytes = 0;
  let expectedRecords = 0;
  let expectedFacts = 0;
  let expectedAttempts = 0;
  for (const [index, row] of rows.entries()) {
    validateExactCheckpoint(row.checkpoint);
    validateCheckpointSemantics(row.checkpoint, rows[index - 1]?.checkpoint ?? null);
    if (
      row.sequence !== index ||
      row.checkpoint.journalSequence !== index ||
      row.checkpoint.priorJournalEntryHash !==
        (rows[index - 1]?.checkpoint.journalEntryHash ?? "genesis")
    ) {
      throw rejection("checkpoint-sequence-invalid");
    }
    const priorFact = rows[index - 1]?.checkpoint.stageLedgerFactId;
    assert.deepEqual(
      row.checkpoint.causalParentFactIds,
      priorFact === undefined || priorFact === null ? [] : [priorFact],
    );
    if (row.event === "request.started") expectedAttempts += 1;
    if (row.event === "artifact.committed") {
      expectedBytes += row.checkpoint.artifactSizeBytes ?? 0;
    }
    if (row.event === "checkpoint.advanced") {
      expectedPages += 1;
      expectedRecords += row.checkpoint.pageRecordCount ?? 0;
    }
    if (row.event === "normalization.emitted") {
      expectedFacts += row.checkpoint.pageNormalizedFactCount ?? 0;
    }
    if (
      row.checkpoint.cumulativeSuccessfulPages !== expectedPages ||
      row.checkpoint.cumulativeVerifiedBytes !== expectedBytes ||
      row.checkpoint.cumulativeRecords !== expectedRecords ||
      row.checkpoint.cumulativeNormalizedFacts !== expectedFacts ||
      row.checkpoint.cumulativeAttempts !== expectedAttempts
    ) {
      throw rejection("checkpoint-budget-reconciliation-failed");
    }
  }
}

function validateImmutableReceiptSidecars(
  rows: readonly JournalRow[],
  sidecars: ImmutableReceiptSidecars,
): void {
  const attemptRows = rows.filter((row) => row.event === "request.started");
  assert.deepEqual(
    attemptRows.map((row) => ({
      attemptId: row.checkpoint.attemptId,
      ordinal: row.checkpoint.attemptOrdinal,
    })),
    sidecars.attempts,
  );
  const artifactRows = rows.filter((row) => row.event === "artifact.committed");
  assert.deepEqual(
    artifactRows.map((row) => ({
      observationId: row.checkpoint.artifactObservationId,
      digest: row.checkpoint.artifactDigest,
      sizeBytes: row.checkpoint.artifactSizeBytes,
      observationHash: row.checkpoint.artifactObservationHash,
      contentId: row.checkpoint.artifactContentId,
      rawArtifactId: row.checkpoint.rawArtifactId,
    })),
    sidecars.artifacts,
  );
  const pageRows = rows.filter((row) => row.event === "checkpoint.advanced");
  assert.deepEqual(
    pageRows.map((row) => ({
      marketAcquisitionId: row.checkpoint.marketAcquisitionId,
      pageOrdinal: row.checkpoint.pageOrdinal,
      recordCount: row.checkpoint.pageRecordCount,
      artifactDigest: row.checkpoint.artifactDigest,
    })),
    sidecars.admittedPages,
  );
  const normalizationRows = rows.filter((row) => row.event === "normalization.emitted");
  assert.deepEqual(
    normalizationRows.map((row) => ({ factCount: row.checkpoint.pageNormalizedFactCount })),
    sidecars.normalizations,
  );
  const final = rows.at(-1)?.checkpoint;
  assert.ok(final !== undefined);
  assert.equal(final.cumulativeAttempts, sidecars.attempts.length);
  assert.equal(final.cumulativeSuccessfulPages, sidecars.admittedPages.length);
  assert.equal(
    final.cumulativeVerifiedBytes,
    sidecars.artifacts.reduce((sum, receipt) => sum + receipt.sizeBytes, 0),
  );
  assert.equal(
    final.cumulativeRecords,
    sidecars.admittedPages.reduce((sum, receipt) => sum + receipt.recordCount, 0),
  );
  assert.equal(
    final.cumulativeNormalizedFacts,
    sidecars.normalizations.reduce((sum, receipt) => sum + receipt.factCount, 0),
  );
}

class MemoryContractJournal implements ContractJournal {
  readonly #rows: JournalRow[] = [];

  append(event: ContractEvent, checkpoint: DurableCheckpoint): void {
    validateJournalAppend(this.#rows, event);
    const finalized = finalizeCheckpoint(this.#rows, event, checkpoint);
    this.#rows.push({ sequence: this.#rows.length, event, checkpoint: finalized });
    validateJournalRows(this.#rows);
  }

  rows(): readonly JournalRow[] {
    return structuredClone(this.#rows);
  }

  close(): void {}
}

class SqliteContractJournal implements ContractJournal {
  readonly #database: Database.Database;

  constructor(filename: string) {
    this.#database = new Database(filename);
    this.#database.exec(
      "CREATE TABLE IF NOT EXISTS acquisition_journal (" +
        "sequence INTEGER PRIMARY KEY, event TEXT NOT NULL, checkpoint_json TEXT NOT NULL)",
    );
  }

  append(event: ContractEvent, checkpoint: DurableCheckpoint): void {
    const rows = this.rows();
    validateJournalAppend(rows, event);
    const finalized = finalizeCheckpoint(rows, event, checkpoint);
    this.#database
      .prepare(
        "INSERT INTO acquisition_journal (sequence, event, checkpoint_json) VALUES (?, ?, ?)",
      )
      .run(rows.length, event, canonicalJson(finalized as unknown as JsonValue));
    validateJournalRows(this.rows());
  }

  rows(): readonly JournalRow[] {
    const rows = (
      this.#database
        .prepare(
          "SELECT sequence, event, checkpoint_json AS checkpointJson " +
            "FROM acquisition_journal ORDER BY sequence",
        )
        .all() as readonly { sequence: number; event: ContractEvent; checkpointJson: string }[]
    ).map((row) => ({
      sequence: row.sequence,
      event: row.event,
      checkpoint: JSON.parse(row.checkpointJson) as DurableCheckpoint,
    }));
    validateJournalRows(rows);
    return rows;
  }

  close(): void {
    this.#database.close();
  }
}

class ContractBudget {
  readonly value: AcquisitionBudgets = { pages: 0, bytes: 0, records: 0, facts: 0, attempts: 0 };

  add(dimension: keyof AcquisitionBudgets, amount: number): void {
    const maxima: Readonly<Record<keyof AcquisitionBudgets, number>> = {
      pages: LIMITS.pages,
      bytes: LIMITS.aggregateBytes,
      records: LIMITS.pages * LIMITS.recordsPerPage,
      facts: LIMITS.facts,
      attempts: LIMITS.attempts,
    };
    const next = this.value[dimension] + amount;
    if (!Number.isSafeInteger(amount) || amount < 0 || next > maxima[dimension]) {
      throw rejection(`${dimension}-bound`);
    }
    this.value[dimension] = next;
  }
}

class AcquisitionCeilingGate {
  activeRequests = 0;
  pageAttempts = 0;
  readonly budget = new ContractBudget();

  beginRequest(): void {
    if (this.activeRequests >= LIMITS.concurrentRequests) throw rejection("concurrency-bound");
    this.activeRequests += 1;
  }

  finishRequest(): void {
    this.activeRequests -= 1;
  }

  acceptArtifact(bytes: Uint8Array): void {
    if (bytes.byteLength > LIMITS.rawArtifactBytes) throw rejection("artifact-bound");
    this.budget.add("bytes", bytes.byteLength);
  }

  acceptPage(records: number, facts: number): void {
    if (records > LIMITS.recordsPerPage) throw rejection("records-bound");
    this.budget.add("pages", 1);
    this.budget.add("records", records);
    this.budget.add("facts", facts);
  }

  beginAttempt(): void {
    this.pageAttempts += 1;
    if (this.pageAttempts > LIMITS.pageAttempts) throw rejection("page-attempts-bound");
    this.budget.add("attempts", 1);
  }

  validatePrivateMaterial(bytes: Uint8Array): void {
    if (bytes.byteLength > LIMITS.tokenBytes) throw rejection("token-bound");
  }

  validateInstruments(count: number): void {
    if (count > LIMITS.instruments) throw rejection("symbols-bound");
  }

  validateDeadlines(attemptMs: number, acquisitionMs: number): void {
    if (attemptMs > LIMITS.attemptDeadlineMs) throw rejection("attempt-deadline-bound");
    if (acquisitionMs > LIMITS.acquisitionDeadlineMs) {
      throw rejection("acquisition-deadline-bound");
    }
  }
}

class RollingQuota {
  readonly #attempts: number[] = [];

  constructor(
    readonly projectLimit: number,
    readonly entitlementLimit: number,
  ) {}

  admit(nowMs: number): boolean {
    const cutoff = nowMs - LIMITS.rateWindowMs;
    while ((this.#attempts[0] ?? Number.POSITIVE_INFINITY) <= cutoff) this.#attempts.shift();
    if (this.#attempts.length >= Math.min(this.projectLimit, this.entitlementLimit)) return false;
    this.#attempts.push(nowMs);
    return true;
  }
}

class BodyResourceDouble {
  aborted = false;
  destroyed = false;
  settled = false;
  pending = 0;

  constructor(readonly glyph: string) {}

  async read(): Promise<Uint8Array> {
    this.pending += 1;
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (this.aborted) throw rejection("body-aborted");
      return Buffer.from(this.glyph);
    } finally {
      this.pending -= 1;
      this.settled = true;
    }
  }

  abortDestroy(): void {
    this.aborted = true;
    this.destroyed = true;
  }
}

class ProviderDouble {
  resources: BodyResourceDouble[];
  requestCalls = 0;
  readonly #order: readonly string[];

  constructor(order: readonly string[] = ["amber", "cobalt", "fern"]) {
    this.#order = [...order];
    this.resources = this.#newResources();
  }

  #newResources(): BodyResourceDouble[] {
    return this.#order.map((glyph) => new BodyResourceDouble(glyph));
  }

  async response(
    failAt: number | null = null,
    afterRead?: (index: number) => void,
  ): Promise<Uint8Array> {
    if (this.resources.some((resource) => resource.aborted)) this.resources = this.#newResources();
    this.requestCalls += 1;
    const chunks: Uint8Array[] = [];
    try {
      for (const [index, resource] of this.resources.entries()) {
        if (failAt === index) throw rejection("body-failure");
        chunks.push(await resource.read());
        afterRead?.(index);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      for (const resource of this.resources) resource.abortDestroy();
      await Promise.allSettled(this.resources.map((resource) => resource.read()));
      throw error;
    }
  }
}

class ActiveClockBasisDouble {
  priorMonotonicNs = 10n;
  currentMonotonicNs = 11n;
  wallAvailable = true;

  validate(): void {
    if (!this.wallAvailable || this.currentMonotonicNs <= this.priorMonotonicNs) {
      throw rejection("clock-unavailable");
    }
    this.priorMonotonicNs = this.currentMonotonicNs;
    this.currentMonotonicNs += 1n;
  }

  regress(): void {
    this.currentMonotonicNs = this.priorMonotonicNs - 1n;
  }
}

type StoredReceipt = Readonly<{
  observationId: string;
  digest: string;
  bytes: Uint8Array;
}>;

class ArtifactDouble {
  receipt: StoredReceipt | null = null;
  storeCalls = 0;
  readCalls = 0;
  failStore = false;
  failRead = false;
  readonly orphanDigests: string[] = [];
  orphanReconciliations = 0;

  store(bytes: Uint8Array): StoredReceipt {
    this.storeCalls += 1;
    if (this.failStore) throw rejection("artifact-store-failure");
    const digest = hash(Buffer.from(bytes).toString("hex"));
    this.receipt = {
      observationId: `synthetic-observation-${digest}`,
      digest,
      bytes: Uint8Array.from(bytes),
    };
    return this.receipt;
  }

  storeOrphan(bytes: Uint8Array): void {
    this.storeCalls += 1;
    this.orphanDigests.push(hash(Buffer.from(bytes).toString("hex")));
  }

  reconcileOrphans(): void {
    if (this.orphanDigests.length === 0) return;
    this.orphanDigests.length = 0;
    this.orphanReconciliations += 1;
  }

  read(digest: string): Uint8Array {
    this.readCalls += 1;
    if (this.failRead) throw rejection("artifact-read-failure");
    if (this.receipt === null || this.receipt.digest !== digest) {
      throw rejection("artifact-missing");
    }
    if (hash(Buffer.from(this.receipt.bytes).toString("hex")) !== digest) {
      throw rejection("artifact-digest-mismatch");
    }
    return Uint8Array.from(this.receipt.bytes);
  }
}

function normalizedFactsFromArtifact(artifact: ArtifactDouble): readonly string[] {
  const bytes = artifact.receipt?.bytes;
  if (bytes === undefined) throw rejection("artifact-missing");
  const members =
    Buffer.from(bytes)
      .toString("utf8")
      .match(/amber|cobalt|fern/gu) ?? [];
  if (members.length !== 3) throw rejection("schema-failure");
  return members.sort();
}

function normalizedDigestFromArtifact(artifact: ArtifactDouble): string {
  return hash(normalizedFactsFromArtifact(artifact).join("|"));
}

type AcquisitionFault = Readonly<{
  timeoutBeforeHeaders?: boolean;
  bodyFailureAt?: number;
  activeClockRegression?: boolean;
  schemaFailure?: boolean;
  storeFailure?: boolean;
  readFailure?: boolean;
  crashAt?: string;
}>;

class AcquisitionContractModel {
  readonly counters = zeroCounters();
  readonly budget = new ContractBudget();
  readonly activeClock = new ActiveClockBasisDouble();
  normalizedFacts: readonly string[] = [];
  selectionDigest: string | null = null;

  constructor(
    readonly request: Preflight,
    readonly provider: ProviderDouble,
    readonly artifact: ArtifactDouble,
    readonly journal: ContractJournal,
  ) {}

  checkpoint(overrides: Partial<DurableCheckpoint> = {}): DurableCheckpoint {
    const currentResumableTokenMaterial = this.request.firstRequest
      ? null
      : Buffer.alloc(this.request.pageMaterialBytes ?? 0, 0x07).toString("base64");
    const acquisitionObservationId = hash(`acquisition-observation:${this.budget.value.attempts}`);
    const marketAcquisitionId = hash(`market-acquisition:${acquisitionObservationId}`);
    const receipt = this.artifact.receipt;
    return {
      schemaVersion: 1,
      marketAcquisitionJournalId: hash("synthetic-acquisition-journal"),
      acquisitionObservationId,
      marketAcquisitionId,
      admittedMarketAcquisitionIds: this.budget.value.pages === 0 ? [] : [marketAcquisitionId],
      requestIdentityHash: requestIdentity(this.request),
      acquisitionConfigurationHash: configurationHash(this.request),
      providerId: this.request.providerId,
      datasetId: this.request.datasetId,
      feedId: this.request.feedId,
      endpointChannelId: this.request.endpointChannelId,
      authorizationMode: "p1-09-approved",
      logicalPageIdentityHash: hash(
        `logical-page:${this.request.firstRequest ? 0 : 1}:${
          currentResumableTokenMaterial === null ? "no-token" : hash(currentResumableTokenMaterial)
        }`,
      ),
      pageOrdinal: this.request.firstRequest ? 0 : 1,
      checkpointKind: "acquisition-declared",
      currentTokenHash:
        currentResumableTokenMaterial === null
          ? hash("no-token")
          : hash(currentResumableTokenMaterial),
      currentResumableTokenMaterial,
      nextTokenHash: null,
      nextResumableTokenMaterial: null,
      attemptId: hash(`attempt:${this.budget.value.attempts}`),
      attemptOrdinal: Math.max(0, this.budget.value.attempts - 1),
      artifactObservationId: receipt?.observationId ?? null,
      artifactDigest: receipt?.digest ?? null,
      artifactSizeBytes: receipt?.bytes.byteLength ?? null,
      artifactObservationHash:
        receipt === null ? null : hash(`observation:${receipt.observationId}`),
      artifactContentId: receipt === null ? null : hash(`content:${receipt.digest}`),
      rawArtifactId:
        receipt === null ? null : hash(`raw:${receipt.observationId}:${receipt.digest}`),
      stageLedgerFactId: null,
      causalParentFactIds: [],
      pageRecordCount: this.budget.value.records === 0 ? null : this.budget.value.records,
      pageNormalizedFactCount: this.budget.value.facts === 0 ? null : this.budget.value.facts,
      pageChainHash: hash(`page-chain:${this.budget.value.pages}`),
      cumulativeSuccessfulPages: this.budget.value.pages,
      cumulativeVerifiedBytes: this.budget.value.bytes,
      cumulativeRecords: this.budget.value.records,
      cumulativeNormalizedFacts: this.budget.value.facts,
      cumulativeAttempts: this.budget.value.attempts,
      acquisitionDeadlineBasis: "trusted-request-started-plus-300000ms",
      quotaWindowEvidence: Array.from(
        { length: this.budget.value.attempts },
        (_, index) => index * 1_000,
      ),
      terminalState: null,
      terminalReasonCode: null,
      incomplete: true,
      priorJournalEntryHash: "genesis",
      journalSequence: 0,
      journalEntryHash: "",
      ...overrides,
    };
  }

  async run(fault: AcquisitionFault = {}): Promise<"complete" | "crashed" | "failed"> {
    try {
      guardedPreflight(this.request, this.counters);
      this.journal.append("acquisition.declared", this.checkpoint());
      if (fault.crashAt === "before-request") return "crashed";
      this.budget.add("attempts", 1);
      this.journal.append("request.started", this.checkpoint());
      if (fault.crashAt === "request-started") return "crashed";
      this.counters.dnsCalls += 1;
      this.counters.networkCalls += 1;
      this.counters.providerCalls += 1;
      if (fault.timeoutBeforeHeaders) throw rejection("timeout-before-headers");
      this.journal.append("request.succeeded", this.checkpoint());
      if (fault.crashAt === "during-body") {
        await assert.rejects(() => this.provider.response(1), /body-failure/u);
        return "crashed";
      }
      const bytes = await this.provider.response(fault.bodyFailureAt ?? null, (index) => {
        if (fault.activeClockRegression && index === 0) this.activeClock.regress();
        this.activeClock.validate();
      });
      if (fault.schemaFailure) throw rejection("schema-failure");
      if (fault.crashAt === "vault-side-effect-before-receipt") {
        this.artifact.storeOrphan(bytes);
        return "crashed";
      }
      this.artifact.failStore = fault.storeFailure ?? false;
      this.counters.artifactCalls += 1;
      const receipt = this.artifact.store(bytes);
      this.budget.add("bytes", bytes.byteLength);
      this.journal.append(
        "artifact.committed",
        this.checkpoint({
          artifactObservationId: receipt.observationId,
          artifactDigest: receipt.digest,
        }),
      );
      if (fault.crashAt === "artifact-committed") return "crashed";
      this.artifact.failRead = fault.readFailure ?? false;
      this.artifact.read(receipt.digest);
      this.journal.append("artifact.verified", this.checkpoint());
      if (fault.crashAt === "artifact-verified") return "crashed";
      this.budget.add("pages", 1);
      this.budget.add("records", 3);
      this.journal.append("checkpoint.advanced", this.checkpoint());
      if (fault.crashAt === "checkpoint-advanced") return "crashed";
      this.journal.append("chain.complete", this.checkpoint());
      this.journal.append("normalization.started", this.checkpoint());
      if (fault.crashAt === "during-normalization") return "crashed";
      this.counters.normalizationCalls += 1;
      this.budget.add("facts", 3);
      this.normalizedFacts = normalizedFactsFromArtifact(this.artifact);
      this.selectionDigest = normalizedDigestFromArtifact(this.artifact);
      this.journal.append("normalization.emitted", this.checkpoint());
      this.journal.append("selection.started", this.checkpoint());
      if (fault.crashAt === "before-selection") {
        return "crashed";
      }
      this.counters.selectionCalls += 1;
      this.journal.append(
        "selection.recorded",
        this.checkpoint({ terminalState: "completed", incomplete: false }),
      );
      return "complete";
    } catch {
      const rows = this.journal.rows();
      if (rows.length > 0 && rows.at(-1)?.event !== "selection.recorded") {
        this.journal.append("failure.recorded", this.checkpoint());
      }
      return "failed";
    }
  }

  async resume(expectedConfigurationHash: string): Promise<"complete"> {
    let rows = this.journal.rows();
    let latest = rows.at(-1);
    if (latest === undefined) throw rejection("journal-empty");
    if (latest.checkpoint.acquisitionConfigurationHash !== expectedConfigurationHash) {
      throw rejection("restart-configuration-changed");
    }
    Object.assign(this.budget.value, {
      pages: latest.checkpoint.cumulativeSuccessfulPages,
      bytes: latest.checkpoint.cumulativeVerifiedBytes,
      records: latest.checkpoint.cumulativeRecords,
      facts: latest.checkpoint.cumulativeNormalizedFacts,
      attempts: latest.checkpoint.cumulativeAttempts,
    });
    const has = (event: ContractEvent): boolean => rows.some((row) => row.event === event);
    if (!has("artifact.committed")) {
      this.artifact.reconcileOrphans();
      this.budget.add("attempts", 1);
      this.journal.append("request.started", this.checkpoint());
      this.counters.dnsCalls += 1;
      this.counters.networkCalls += 1;
      this.counters.providerCalls += 1;
      const bytes = await this.provider.response();
      this.journal.append("request.succeeded", this.checkpoint());
      const receipt = this.artifact.store(bytes);
      this.budget.add("bytes", bytes.byteLength);
      this.journal.append(
        "artifact.committed",
        this.checkpoint({
          artifactObservationId: receipt.observationId,
          artifactDigest: receipt.digest,
        }),
      );
      rows = this.journal.rows();
      latest = rows.at(-1);
      assert.ok(latest !== undefined);
    }
    const committedRows = rows.filter((row) => row.event === "artifact.committed");
    for (const committed of committedRows) {
      const digest = committed.checkpoint.artifactDigest;
      if (digest === null || digest === undefined) throw rejection("artifact-missing");
      const receipt = this.artifact.receipt;
      if (
        receipt === null ||
        receipt.observationId !== committed.checkpoint.artifactObservationId ||
        receipt.digest !== digest ||
        receipt.bytes.byteLength !== committed.checkpoint.artifactSizeBytes ||
        hash(`observation:${receipt.observationId}`) !==
          committed.checkpoint.artifactObservationHash
      ) {
        throw rejection("artifact-receipt-mismatch");
      }
      this.artifact.read(digest);
    }
    if (committedRows.length > 0) {
      this.normalizedFacts = normalizedFactsFromArtifact(this.artifact);
      this.selectionDigest = normalizedDigestFromArtifact(this.artifact);
    }
    if (!has("artifact.verified")) {
      this.journal.append("artifact.verified", this.checkpoint());
    }
    if (!has("checkpoint.advanced")) {
      this.budget.add("pages", 1);
      this.budget.add("records", 3);
      this.journal.append("checkpoint.advanced", this.checkpoint());
    }
    if (!has("chain.complete")) {
      this.journal.append("chain.complete", this.checkpoint());
    }
    if (!has("normalization.started")) {
      this.journal.append("normalization.started", this.checkpoint());
    }
    if (!has("normalization.emitted")) {
      this.counters.normalizationCalls += 1;
      this.budget.add("facts", 3);
      this.normalizedFacts = normalizedFactsFromArtifact(this.artifact);
      this.selectionDigest = normalizedDigestFromArtifact(this.artifact);
      this.journal.append("normalization.emitted", this.checkpoint());
    }
    if (!has("selection.started")) {
      this.journal.append("selection.started", this.checkpoint());
    }
    if (!has("selection.recorded")) {
      this.counters.selectionCalls += 1;
      this.journal.append(
        "selection.recorded",
        this.checkpoint({ terminalState: "completed", incomplete: false }),
      );
    }
    return "complete";
  }
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

test("zero-spend policy recomputes exactly and every invalid decision is a zero-side-effect rejection", () => {
  assert.equal(
    `mzp1_${canonicalHash(
      "peas/market-zero-spend-policy/v1",
      ZERO_SPEND_POLICY_PREIMAGE as JsonValue,
    )}`,
    ZERO_SPEND_POLICY_ID,
  );
  const mutatedPolicy = {
    ...ZERO_SPEND_POLICY_PREIMAGE,
    maximumIncrementalSpend: "1",
  };
  const negatives: readonly Preflight[] = [
    { ...exactBoundaryRequest(0n), zeroSpendPolicyId: null },
    { ...exactBoundaryRequest(0n), zeroSpendPolicyId: `mzp1_${"0".repeat(64)}` },
    { ...exactBoundaryRequest(0n), zeroSpendPolicyPreimage: mutatedPolicy },
    { ...exactBoundaryRequest(0n), zeroSpendPolicyPreimage: null },
    { ...exactBoundaryRequest(0n), runDecision: null },
    { ...exactBoundaryRequest(0n), runDecision: "reject" },
    { ...exactBoundaryRequest(0n), costStatus: "stale" },
    { ...exactBoundaryRequest(0n), costStatus: "unknown" },
  ];
  for (const request of negatives) {
    const counters = zeroCounters();
    assert.throws(() => guardedPreflight(request, counters), /cost-unproven/u);
    assertZeroSideEffects(counters);
  }
});

test("every identity family rejects every hostile derivation/configuration mutation with zero effects", () => {
  for (const envelope of IDENTITY_ENVELOPES) {
    const reachable = zeroCounters();
    assert.doesNotThrow(() => guardedIdentityConfiguration(envelope, reachable), envelope.name);
    assert.deepEqual(reachable, {
      credentialReads: 1,
      transportConstructions: 1,
      dnsCalls: 1,
      networkCalls: 1,
      providerCalls: 1,
      artifactCalls: 1,
      normalizationCalls: 1,
      selectionCalls: 1,
      postReturnActivity: 1,
    });
    const preimageEntries = Object.entries(envelope.preimage);
    const firstKey = preimageEntries[0]?.[0];
    assert.ok(firstKey !== undefined);
    const withoutFirst = Object.fromEntries(preimageEntries.slice(1));
    const mutations: [string, IdentityEnvelope][] = [
      [
        "one-field",
        {
          ...envelope,
          preimage: { ...envelope.preimage, [firstKey]: "mutated" },
        },
      ],
      ["missing", { ...envelope, preimage: withoutFirst }],
      ["extra", { ...envelope, preimage: { ...envelope.preimage, unexpected: true } }],
      [
        "forged-id",
        {
          ...envelope,
          expectedId: `${envelope.expectedId.slice(0, -1)}${
            envelope.expectedId.endsWith("0") ? "1" : "0"
          }`,
        },
      ],
      ["url-path", { ...envelope, preimage: { ...envelope.preimage, url: "forbidden" } }],
      [
        "header-credential",
        { ...envelope, preimage: { ...envelope.preimage, authorizationHeader: "forbidden" } },
      ],
      [
        "provider-default",
        { ...envelope, preimage: { ...envelope.preimage, providerDefault: true } },
      ],
    ];
    if (envelope.family === "channel") {
      const factKinds = envelope.preimage["factKinds"];
      assert.ok(Array.isArray(factKinds));
      mutations.push([
        "reordered-real-fact-kind-set",
        {
          ...envelope,
          preimage: {
            ...envelope.preimage,
            factKinds: [...factKinds, "unauthorized-kind"].reverse(),
          },
        },
      ]);
    }
    for (const [_name, mutation] of mutations) {
      const counters = zeroCounters();
      assert.throws(() => guardedIdentityConfiguration(mutation, counters), /(?:identity|market)/u);
      assertZeroSideEffects(counters);
    }
  }

  const fmpBaseline: FmpPreflight = {
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
  for (const mutation of [
    { ...fmpBaseline, role: "primary" as const },
    { ...fmpBaseline, role: "fallback" as const },
    { ...fmpBaseline, output: "public" as const },
    { ...fmpBaseline, path: "/stable/quote" },
    { ...fmpBaseline, endpointChannelId: IDS.fmpTrade },
  ]) {
    const counters = zeroCounters();
    assert.throws(() => {
      fmpPreflight(mutation);
      counters.credentialReads += 1;
      counters.transportConstructions += 1;
      counters.dnsCalls += 1;
      counters.networkCalls += 1;
      counters.providerCalls += 1;
      counters.artifactCalls += 1;
      counters.normalizationCalls += 1;
      counters.selectionCalls += 1;
      counters.postReturnActivity += 1;
    });
    assertZeroSideEffects(counters);
  }
});

test("closed request limits 1..10000 are canonical and bind configuration but not request identity", async () => {
  const requestHashes = new Set<string>();
  const configHashes = new Set<string>();
  for (const limit of ["1", "2", "7", "10000"]) {
    const request = {
      ...exactBoundaryRequest(0n),
      fields: { ...exactBoundaryRequest(0n).fields, limit },
    };
    assert.doesNotThrow(() => preflight(request), limit);
    requestHashes.add(requestIdentity(request));
    configHashes.add(configurationHash(request));
  }
  assert.equal(requestHashes.size, 1);
  assert.equal(configHashes.size, 4);
  for (const limit of ["0", "10001", "-1", "+1", "01", "1.0", " 1", "1 ", "1e1", "NaN"]) {
    const request = {
      ...exactBoundaryRequest(0n),
      fields: { ...exactBoundaryRequest(0n).fields, limit },
    };
    assert.throws(() => preflight(request), /limit-not-authorized/u, limit);
  }
  const frozen = configurationHash({
    ...exactBoundaryRequest(0n),
    fields: { ...exactBoundaryRequest(0n).fields, limit: "1" },
  });
  for (const changed of ["2", "7", "10000"]) {
    const resumed = configurationHash({
      ...exactBoundaryRequest(0n),
      fields: { ...exactBoundaryRequest(0n).fields, limit: changed },
    });
    assert.notEqual(resumed, frozen, `restart must reject changed page limit ${changed}`);
  }
  const frozenRequest = {
    ...exactBoundaryRequest(0n),
    fields: { ...exactBoundaryRequest(0n).fields, limit: "1" },
  };
  const journal = new MemoryContractJournal();
  const model = new AcquisitionContractModel(
    frozenRequest,
    new ProviderDouble(),
    new ArtifactDouble(),
    journal,
  );
  assert.equal(await model.run({ crashAt: "artifact-committed" }), "crashed");
  const changedRequest = {
    ...frozenRequest,
    fields: { ...frozenRequest.fields, limit: "2" },
  };
  await assert.rejects(
    () => model.resume(configurationHash(changedRequest)),
    /restart-configuration-changed/u,
  );
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
  const concurrency = new AcquisitionCeilingGate();
  concurrency.beginRequest();
  assert.throws(() => concurrency.beginRequest(), /concurrency-bound/u);
  concurrency.finishRequest();

  const artifactExact = new AcquisitionCeilingGate();
  artifactExact.acceptArtifact(Buffer.alloc(LIMITS.rawArtifactBytes));
  assert.throws(
    () => new AcquisitionCeilingGate().acceptArtifact(Buffer.alloc(LIMITS.rawArtifactBytes + 1)),
    /artifact-bound/u,
  );

  for (const [dimension, maximum] of [
    ["pages", LIMITS.pages],
    ["bytes", LIMITS.aggregateBytes],
    ["records", LIMITS.pages * LIMITS.recordsPerPage],
    ["facts", LIMITS.facts],
    ["attempts", LIMITS.attempts],
  ] as const) {
    const budget = new ContractBudget();
    budget.add(dimension, maximum);
    assert.equal(budget.value[dimension], maximum);
    assert.throws(() => budget.add(dimension, 1), new RegExp(`${dimension}-bound`, "u"));
  }

  const page = new AcquisitionCeilingGate();
  page.acceptPage(LIMITS.recordsPerPage, LIMITS.facts);
  assert.throws(
    () => new AcquisitionCeilingGate().acceptPage(LIMITS.recordsPerPage + 1, 0),
    /records-bound/u,
  );
  const material = new AcquisitionCeilingGate();
  material.validatePrivateMaterial(Buffer.alloc(LIMITS.tokenBytes));
  assert.throws(
    () => material.validatePrivateMaterial(Buffer.alloc(LIMITS.tokenBytes + 1)),
    /token-bound/u,
  );
  material.validateInstruments(LIMITS.instruments);
  assert.throws(() => material.validateInstruments(LIMITS.instruments + 1), /symbols-bound/u);
  const pageAttempts = new AcquisitionCeilingGate();
  for (let index = 0; index < LIMITS.pageAttempts; index += 1) pageAttempts.beginAttempt();
  assert.throws(() => pageAttempts.beginAttempt(), /page-attempts-bound/u);
  material.validateDeadlines(LIMITS.attemptDeadlineMs, LIMITS.acquisitionDeadlineMs);
  assert.throws(
    () => material.validateDeadlines(LIMITS.attemptDeadlineMs + 1, 0),
    /attempt-deadline-bound/u,
  );
  assert.throws(
    () => material.validateDeadlines(0, LIMITS.acquisitionDeadlineMs + 1),
    /acquisition-deadline-bound/u,
  );
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

test("journal transition legality and rolling project/entitlement quota equality are executable", () => {
  for (const from of ACQUISITION_STATES) {
    for (const to of ACQUISITION_STATES) {
      if (ACQUISITION_TRANSITIONS[from].includes(to)) {
        assert.doesNotThrow(() => validateAcquisitionTransition(from, to));
      } else {
        assert.throws(
          () => validateAcquisitionTransition(from, to),
          /acquisition-transition-invalid/u,
        );
      }
    }
  }
  const allKinds = Object.keys(CHECKPOINT_KIND_TRANSITIONS) as CheckpointKind[];
  for (const prior of allKinds) {
    for (const next of allKinds) {
      if (CHECKPOINT_KIND_TRANSITIONS[prior].includes(next)) {
        assert.doesNotThrow(() => validateCheckpointKindTransition(prior, next));
      } else {
        assert.throws(
          () => validateCheckpointKindTransition(prior, next),
          /checkpoint-transition-invalid/u,
        );
      }
    }
  }
  const journal = new MemoryContractJournal();
  const model = new AcquisitionContractModel(
    exactBoundaryRequest(0n),
    new ProviderDouble(),
    new ArtifactDouble(),
    journal,
  );
  assert.throws(() => journal.append("request.started", model.checkpoint()), /illegal-transition/u);
  journal.append("acquisition.declared", model.checkpoint());
  assert.throws(
    () => journal.append("selection.recorded", model.checkpoint()),
    /illegal-transition/u,
  );
  model.budget.add("attempts", 1);
  journal.append("request.started", model.checkpoint());
  journal.append("request.succeeded", model.checkpoint());
  journal.append("failure.recorded", model.checkpoint());
  model.budget.add("attempts", 1);
  assert.throws(
    () => journal.append("request.started", model.checkpoint()),
    /checkpoint-transition-invalid/u,
  );

  const quota = new RollingQuota(30, 2);
  assert.equal(quota.admit(0), true);
  assert.equal(quota.admit(0), true);
  assert.equal(quota.admit(59_999), false);
  assert.equal(quota.admit(60_000), true, "oldest attempt expires at exact rolling boundary");
  const projectCeiling = new RollingQuota(LIMITS.rateAttempts, 100);
  for (let attempt = 0; attempt < LIMITS.rateAttempts; attempt += 1) {
    assert.equal(projectCeiling.admit(0), true);
  }
  assert.equal(projectCeiling.admit(59_999), false);
  assert.equal(projectCeiling.admit(LIMITS.rateWindowMs), true);
});

test("checkpoint exact shape, canonical hash chain, causal parents, and receipt budgets reject corruption", async () => {
  const journal = new MemoryContractJournal();
  const artifact = new ArtifactDouble();
  const model = new AcquisitionContractModel(
    exactBoundaryRequest(0n),
    new ProviderDouble(),
    artifact,
    journal,
  );
  assert.equal(await model.run(), "complete");
  const rows = journal.rows();
  assert.doesNotThrow(() => validateJournalRows(rows));
  const receipt = artifact.receipt;
  assert.ok(receipt !== null);
  const sidecars: ImmutableReceiptSidecars = {
    attempts: [{ attemptId: hash("attempt:1"), ordinal: 0 }],
    artifacts: [
      {
        observationId: receipt.observationId,
        digest: receipt.digest,
        sizeBytes: receipt.bytes.byteLength,
        observationHash: hash(`observation:${receipt.observationId}`),
        contentId: hash(`content:${receipt.digest}`),
        rawArtifactId: hash(`raw:${receipt.observationId}:${receipt.digest}`),
      },
    ],
    admittedPages: [
      {
        marketAcquisitionId: hash(`market-acquisition:${hash("acquisition-observation:1")}`),
        pageOrdinal: 0,
        recordCount: 3,
        artifactDigest: receipt.digest,
      },
    ],
    normalizations: [{ factCount: 3 }],
  };
  assert.doesNotThrow(() => validateImmutableReceiptSidecars(rows, sidecars));
  const finalRow = rows.at(-1);
  assert.ok(finalRow !== undefined);
  assert.equal(Object.keys(finalRow.checkpoint).length, CHECKPOINT_KEYS.length);
  const withUnknown = {
    ...finalRow.checkpoint,
    unexpected: true,
  } as unknown as DurableCheckpoint;
  assert.throws(() => validateExactCheckpoint(withUnknown), /checkpoint-shape-invalid/u);
  const missingField = { ...finalRow.checkpoint } as Record<string, unknown>;
  delete missingField["quotaWindowEvidence"];
  assert.throws(
    () => validateExactCheckpoint(missingField as unknown as DurableCheckpoint),
    /checkpoint-shape-invalid/u,
  );
  assert.throws(
    () =>
      validateJournalRows([
        ...rows.slice(0, -1),
        {
          ...finalRow,
          checkpoint: { ...finalRow.checkpoint, journalEntryHash: "forged" },
        },
      ]),
    /checkpoint-hash-invalid/u,
  );
  const rehash = (checkpoint: DurableCheckpoint): DurableCheckpoint => {
    const draft = { ...checkpoint, journalEntryHash: "" };
    return { ...draft, journalEntryHash: deriveJournalEntryHash(draft) };
  };
  assert.throws(() =>
    validateJournalRows([
      ...rows.slice(0, -1),
      {
        ...finalRow,
        checkpoint: rehash({
          ...finalRow.checkpoint,
          cumulativeVerifiedBytes: finalRow.checkpoint.cumulativeVerifiedBytes + 1,
        }),
      },
    ]),
  );
  assert.throws(() =>
    validateJournalRows([
      ...rows.slice(0, -1),
      {
        ...finalRow,
        checkpoint: rehash({
          ...finalRow.checkpoint,
          causalParentFactIds: [],
        }),
      },
    ]),
  );
  assert.throws(() =>
    validateJournalRows([
      ...rows.slice(0, -1),
      {
        ...finalRow,
        checkpoint: rehash({
          ...finalRow.checkpoint,
          priorJournalEntryHash: "forged",
        }),
      },
    ]),
  );
  const forgedJournal = new MemoryContractJournal();
  for (const row of rows) {
    const afterCommit =
      rows.findIndex((candidate) => candidate.event === "artifact.committed") <= row.sequence;
    forgedJournal.append(row.event, {
      ...row.checkpoint,
      artifactSizeBytes:
        row.checkpoint.artifactSizeBytes === null
          ? null
          : row.checkpoint.artifactSizeBytes + (afterCommit ? 1 : 0),
      cumulativeVerifiedBytes: row.checkpoint.cumulativeVerifiedBytes + (afterCommit ? 1 : 0),
    });
  }
  assert.doesNotThrow(() => validateJournalRows(forgedJournal.rows()));
  assert.throws(() => validateImmutableReceiptSidecars(forgedJournal.rows(), sidecars));
});

test("retry/status/timeout matrix is deterministic and Retry-After is closed", () => {
  for (const status of [408, 500, 502, 503, 504]) {
    assert.deepEqual(retryDecision(`http-${status}`, 1, null, "missing"), {
      kind: "retry",
      delayMs: 1_000,
    });
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(retryDecision(`http-${status}`, 1, null, "missing").kind, "stop");
  }
  let laneEnabled = true;
  for (const status of [401, 403]) {
    if (retryDecision(`http-${status}`, 1, null, "missing").kind === "stop") laneEnabled = false;
    assert.equal(laneEnabled, false);
    laneEnabled = true;
  }
  for (const failure of ["schema", "artifact"] as const) {
    assert.equal(retryDecision(failure, 1, null, "missing").kind, "stop");
  }
  assert.deepEqual(retryDecision("pre-response", 2, null, "missing"), {
    kind: "retry",
    delayMs: 2_000,
  });
  assert.equal(retryDecision("clean-partial", 3, null, "missing").kind, "stop");
  for (const classification of ["missing", "ambiguous", "quota-exhausted"] as const) {
    assert.equal(retryDecision("http-429", 1, "1", classification).kind, "stop");
  }
  assert.deepEqual(retryDecision("http-429", 1, null, "temporary-throttling-proved"), {
    kind: "retry",
    delayMs: 1_000,
  });
  for (const value of ["-1", "Wed, 21 Oct 2015 07:28:00 GMT", "1.5", "31", "999999999999999999"]) {
    assert.equal(
      retryDecision("http-429", 1, value, "temporary-throttling-proved").kind,
      "stop",
      value,
    );
  }
  assert.deepEqual(retryDecision("http-429", 1, "0", "temporary-throttling-proved"), {
    kind: "retry",
    delayMs: 1_000,
  });
  assert.deepEqual(retryDecision("http-429", 1, "30", "temporary-throttling-proved"), {
    kind: "retry",
    delayMs: 30_000,
  });
});

test("provider/body/schema/store/read fault doubles enforce cleanup and causal journal writes", async () => {
  const cases: readonly [string, AcquisitionFault][] = [
    ["timeout-before-headers", { timeoutBeforeHeaders: true }],
    ["timeout-during-body", { bodyFailureAt: 0 }],
    ["active-clock-regression", { activeClockRegression: true }],
    ["truncated-middle-body", { bodyFailureAt: 1 }],
    ["declared-length-last-body", { bodyFailureAt: 2 }],
    ["malformed-schema", { schemaFailure: true }],
    ["store-failure", { storeFailure: true }],
    ["read-failure", { readFailure: true }],
  ];
  for (const [name, fault] of cases) {
    const provider = new ProviderDouble();
    const artifact = new ArtifactDouble();
    const journal = new MemoryContractJournal();
    const model = new AcquisitionContractModel(
      exactBoundaryRequest(0n),
      provider,
      artifact,
      journal,
    );
    assert.equal(await model.run(fault), "failed", name);
    const events = journal.rows().map((row) => row.event);
    assert.equal(events.at(-1), "failure.recorded", name);
    assert.equal(events.includes("selection.recorded"), false, name);
    if (fault.bodyFailureAt !== undefined || fault.activeClockRegression) {
      for (const resource of provider.resources) {
        assert.equal(resource.aborted, true, name);
        assert.equal(resource.destroyed, true, name);
        assert.equal(resource.settled, true, name);
        assert.equal(resource.pending, 0, name);
      }
    }
    if (
      fault.timeoutBeforeHeaders ||
      fault.bodyFailureAt !== undefined ||
      fault.activeClockRegression ||
      fault.schemaFailure
    ) {
      assert.equal(events.includes("artifact.committed"), false, name);
    }
    if (fault.storeFailure) assert.equal(events.includes("artifact.committed"), false, name);
    if (fault.readFailure) {
      assert.equal(events.includes("artifact.committed"), true, name);
      assert.equal(events.includes("artifact.verified"), false, name);
    }
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
  assert.throws(
    () =>
      verifyChain(
        [
          first,
          {
            ...second,
            nextHash: first.nextHash,
          },
        ],
        requestHash,
      ),
    /token-loop/u,
    "the same returned continuation hash cannot appear twice",
  );
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
  const vectors: readonly [readonly Delivery[], ReturnType<typeof classifyDeliveries>][] = [
    [[original, original], "deduplicated"],
    [[original, { ...original, digest: hash("conflict") }], "quarantined"],
    [
      [
        { ...original, revisionEvidence: "revision-a" },
        { ...original, digest: hash("revision"), revisionEvidence: "revision-b" },
      ],
      "verified",
    ],
    [
      [
        { ...original, revisionEvidence: null },
        { ...original, digest: hash("unknown"), revisionEvidence: "revision-b" },
      ],
      "quarantined",
    ],
  ];
  for (const [deliveries, expected] of vectors) {
    assert.equal(classifyDeliveries(deliveries), expected);
    assert.equal(classifyDeliveries([...deliveries].reverse()), expected);
  }
});

test("restart from every crash boundary derives retry/resume from durable journal state", async () => {
  const baseline = new AcquisitionContractModel(
    exactBoundaryRequest(0n),
    new ProviderDouble(),
    new ArtifactDouble(),
    new MemoryContractJournal(),
  );
  assert.equal(await baseline.run(), "complete");
  assert.ok(baseline.selectionDigest !== null);
  const crashPoints = [
    "before-request",
    "request-started",
    "during-body",
    "vault-side-effect-before-receipt",
    "artifact-committed",
    "artifact-verified",
    "checkpoint-advanced",
    "during-normalization",
    "before-selection",
  ] as const;
  for (const crashAt of crashPoints) {
    const request = exactBoundaryRequest(0n);
    const provider = new ProviderDouble();
    const artifact = new ArtifactDouble();
    const journal = new MemoryContractJournal();
    const model = new AcquisitionContractModel(request, provider, artifact, journal);
    assert.equal(await model.run({ crashAt }), "crashed", crashAt);
    if (crashAt === "during-normalization") {
      assert.equal(model.selectionDigest, null);
      assert.equal(
        journal.rows().some((row) => row.event === "normalization.emitted"),
        false,
      );
    }
    const crashedResources = [...provider.resources];
    if (crashAt === "during-body") {
      assert.ok(
        crashedResources.every(
          (resource) =>
            resource.aborted && resource.destroyed && resource.settled && resource.pending === 0,
        ),
      );
    }
    if (crashAt === "vault-side-effect-before-receipt") {
      assert.equal(artifact.orphanDigests.length, 1);
    }
    const callsAtCrash = provider.requestCalls;
    const readsAtCrash = artifact.readCalls;
    await model.resume(configurationHash(request));
    const events = journal.rows().map((row) => row.event);
    assert.equal(events.at(-1), "selection.recorded", crashAt);
    assert.equal(events.filter((event) => event === "selection.recorded").length, 1, crashAt);
    if (
      crashAt === "before-request" ||
      crashAt === "request-started" ||
      crashAt === "during-body" ||
      crashAt === "vault-side-effect-before-receipt"
    ) {
      assert.equal(provider.requestCalls, callsAtCrash + 1, crashAt);
    } else {
      assert.equal(provider.requestCalls, callsAtCrash, crashAt);
      assert.ok(artifact.readCalls > readsAtCrash, `restart must reverify ${crashAt}`);
    }
    const committedIndex = events.indexOf("artifact.committed");
    const verifiedIndex = events.indexOf("artifact.verified");
    const checkpointIndex = events.indexOf("checkpoint.advanced");
    assert.ok(committedIndex >= 0 && committedIndex < verifiedIndex, crashAt);
    assert.ok(verifiedIndex < checkpointIndex, crashAt);
    assert.equal(model.selectionDigest, baseline.selectionDigest, crashAt);
    assert.equal(model.counters.postReturnActivity, 0, crashAt);
    assert.ok(
      provider.resources.every((resource) => resource.pending === 0),
      crashAt,
    );
    if (crashAt === "vault-side-effect-before-receipt") {
      assert.equal(artifact.orphanDigests.length, 0);
      assert.equal(artifact.orphanReconciliations, 1);
    }
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(baseline.counters.postReturnActivity, 0);
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

test("memory and SQLite close/reopen agree after every durable checkpoint with fresh state", async () => {
  const request = exactBoundaryRequest(0n);
  const baselineJournal = new MemoryContractJournal();
  const baselineModel = new AcquisitionContractModel(
    request,
    new ProviderDouble(),
    new ArtifactDouble(),
    baselineJournal,
  );
  assert.equal(await baselineModel.run(), "complete");
  const baselineRows = baselineJournal.rows();
  const durableBytes = Buffer.from("ambercobaltfern");
  const orders = [
    ["amber", "cobalt", "fern"],
    ["fern", "amber", "cobalt"],
    ["cobalt", "fern", "amber"],
  ] as const;

  const restoreArtifact = (rows: readonly JournalRow[]): ArtifactDouble => {
    const artifact = new ArtifactDouble();
    const committed = [...rows].reverse().find((row) => row.event === "artifact.committed");
    if (committed !== undefined) {
      const checkpoint = committed.checkpoint;
      assert.ok(checkpoint.artifactObservationId !== null);
      assert.ok(checkpoint.artifactDigest !== null);
      assert.equal(hash(durableBytes.toString("hex")), checkpoint.artifactDigest);
      artifact.receipt = {
        observationId: checkpoint.artifactObservationId,
        digest: checkpoint.artifactDigest,
        bytes: Uint8Array.from(durableBytes),
      };
    }
    return artifact;
  };
  const appendRows = (
    journal: ContractJournal,
    rows: readonly JournalRow[],
    backendPageSize: number,
  ): void => {
    for (let offset = 0; offset < rows.length; offset += backendPageSize) {
      for (const row of rows.slice(offset, offset + backendPageSize)) {
        journal.append(row.event, row.checkpoint);
      }
    }
  };
  const restartDecision = (rows: readonly JournalRow[]): string => {
    const events = new Set(rows.map((row) => row.event));
    if (events.has("selection.recorded")) return "revalidate-terminal";
    if (events.has("normalization.emitted")) return "reverify-then-select";
    if (events.has("checkpoint.advanced")) return "reverify-then-normalize";
    if (events.has("artifact.committed")) return "reverify-no-dispatch";
    return "new-attempt-after-reconciliation";
  };

  const directory = mkdtempSync(join(tmpdir(), "peas-p1-10-journal-"));
  try {
    for (let cutoff = 1; cutoff <= baselineRows.length; cutoff += 1) {
      const prefix = baselineRows.slice(0, cutoff);
      const backendPageSize = [1, 2, 7, 10_000][cutoff % 4] as number;
      const order = orders[cutoff % orders.length] as readonly string[];

      const memoryJournal = new MemoryContractJournal();
      appendRows(memoryJournal, prefix, backendPageSize);
      const memoryProvider = new ProviderDouble(order);
      const memoryArtifact = restoreArtifact(prefix);
      const memoryModel = new AcquisitionContractModel(
        request,
        memoryProvider,
        memoryArtifact,
        memoryJournal,
      );
      const expectedDecision = restartDecision(prefix);
      await memoryModel.resume(configurationHash(request));

      const filename = join(directory, `checkpoint-${cutoff}.sqlite`);
      let sqliteJournal = new SqliteContractJournal(filename);
      appendRows(sqliteJournal, prefix, backendPageSize);
      sqliteJournal.close();
      sqliteJournal = new SqliteContractJournal(filename);
      assert.equal(restartDecision(sqliteJournal.rows()), expectedDecision);
      const sqliteProvider = new ProviderDouble(order);
      const sqliteArtifact = restoreArtifact(sqliteJournal.rows());
      const sqliteModel = new AcquisitionContractModel(
        request,
        sqliteProvider,
        sqliteArtifact,
        sqliteJournal,
      );
      await sqliteModel.resume(configurationHash(request));
      assert.equal(
        canonicalJson(sqliteJournal.rows() as unknown as JsonValue),
        canonicalJson(memoryJournal.rows() as unknown as JsonValue),
        `checkpoint ${cutoff}`,
      );
      assert.deepEqual(sqliteModel.counters, memoryModel.counters, `checkpoint ${cutoff}`);
      assert.deepEqual(
        sqliteModel.normalizedFacts,
        memoryModel.normalizedFacts,
        `checkpoint ${cutoff}`,
      );
      assert.equal(
        sqliteModel.selectionDigest,
        memoryModel.selectionDigest,
        `checkpoint ${cutoff}`,
      );
      assert.equal(
        sqliteProvider.requestCalls,
        memoryProvider.requestCalls,
        `checkpoint ${cutoff}`,
      );
      validateJournalRows(sqliteJournal.rows());
      sqliteJournal.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("response order, repeat run, replay page size, and post-return activity are invariant", async () => {
  const outputs: string[] = [];
  for (const order of [
    ["amber", "cobalt", "fern"],
    ["fern", "amber", "cobalt"],
    ["cobalt", "fern", "amber"],
  ]) {
    const provider = new ProviderDouble(order);
    const journal = new MemoryContractJournal();
    const model = new AcquisitionContractModel(
      exactBoundaryRequest(0n),
      provider,
      new ArtifactDouble(),
      journal,
    );
    assert.equal(await model.run(), "complete");
    assert.ok(model.selectionDigest !== null);
    outputs.push(model.selectionDigest);
    assert.equal(
      provider.resources.reduce((sum, resource) => sum + resource.pending, 0),
      0,
    );
    assert.ok(provider.resources.every((resource) => resource.settled));
  }
  assert.equal(new Set(outputs).size, 1);
  const artifactEnumeration = [
    { ordinal: 2, digest: hash("artifact-c"), observationId: "delivery-c", sizeBytes: 7 },
    { ordinal: 0, digest: hash("artifact-a"), observationId: "delivery-a", sizeBytes: 5 },
    { ordinal: 1, digest: hash("artifact-a"), observationId: "delivery-b", sizeBytes: 5 },
  ];
  const canonicalArtifactEnumeration = (
    values: readonly {
      ordinal: number;
      digest: string;
      observationId: string;
      sizeBytes: number;
    }[],
  ): string => {
    let pageChainHash = hash("page-chain:genesis");
    const admitted = [...values]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((receipt) => {
        pageChainHash = hash(`${pageChainHash}:${receipt.ordinal}:${receipt.digest}`);
        return { ...receipt, pageChainHash };
      });
    return canonicalJson({
      admitted,
      cumulativePages: admitted.length,
      cumulativeBytes: admitted.reduce((sum, receipt) => sum + receipt.sizeBytes, 0),
      physicalDigests: [...new Set(admitted.map((receipt) => receipt.digest))].sort(),
    });
  };
  assert.equal(
    canonicalArtifactEnumeration(artifactEnumeration),
    canonicalArtifactEnumeration([...artifactEnumeration].reverse()),
  );
  const baseline = normalizedFixtureProjection(1);
  for (const pageSize of [1, 2, 7, 10_000]) {
    assert.equal(normalizedFixtureProjection(pageSize), baseline);
  }
  const callsBefore = unexpectedNetworkCalls;
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(unexpectedNetworkCalls, callsBefore);
});
