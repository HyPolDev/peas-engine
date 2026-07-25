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
  family: IdentityFamily;
  preimage: Readonly<Record<string, unknown>>;
  expectedId: string;
  orderedCapabilities: readonly string[];
}>;

const IDENTITY_ENVELOPES: readonly IdentityEnvelope[] = [
  {
    family: "provider",
    preimage: { providerCode: "alpaca", serviceOperatorCode: "alpaca-markets" },
    expectedId: IDS.alpacaProvider,
    orderedCapabilities: ["acquire", "replay"],
  },
  {
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
    orderedCapabilities: ["acquire", "replay"],
  },
  {
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
    orderedCapabilities: ["acquire", "replay"],
  },
  {
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
    orderedCapabilities: ["acquire", "replay"],
  },
];

function validateIdentityEnvelope(value: IdentityEnvelope): void {
  const exactKeys = ["expectedId", "family", "orderedCapabilities", "preimage"];
  if (
    Object.keys(value).sort().join(",") !== exactKeys.join(",") ||
    canonicalJson(value.orderedCapabilities as unknown as JsonValue) !==
      canonicalJson(["acquire", "replay"])
  ) {
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

type ContractEvent =
  | "acquisition.declared"
  | "request.started"
  | "request.succeeded"
  | "artifact.committed"
  | "artifact.verified"
  | "checkpoint.advanced"
  | "normalization.emitted"
  | "selection.recorded"
  | "failure.recorded";

type AcquisitionBudgets = {
  pages: number;
  bytes: number;
  records: number;
  facts: number;
  attempts: number;
};

type DurableCheckpoint = Readonly<{
  schemaVersion: 1;
  marketAcquisitionId: string;
  requestIdentityHash: string;
  configurationHash: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  pageOrdinal: number;
  currentTokenHash: string | null;
  nextTokenHash: string | null;
  privateResumableTokenMaterial: string | null;
  artifactObservationId: string | null;
  artifactDigest: string | null;
  budgets: Readonly<AcquisitionBudgets>;
  terminal: boolean;
  incomplete: boolean;
}>;

type JournalRow = Readonly<{
  sequence: number;
  event: ContractEvent;
  checkpoint: DurableCheckpoint;
}>;

interface ContractJournal {
  append(event: ContractEvent, checkpoint: DurableCheckpoint): void;
  rows(): readonly JournalRow[];
  close(): void;
}

const PREDECESSORS: Readonly<Record<ContractEvent, readonly ContractEvent[]>> = {
  "acquisition.declared": [],
  "request.started": ["acquisition.declared", "failure.recorded"],
  "request.succeeded": ["request.started"],
  "artifact.committed": ["request.succeeded"],
  "artifact.verified": ["artifact.committed"],
  "checkpoint.advanced": ["artifact.verified"],
  "normalization.emitted": ["checkpoint.advanced"],
  "selection.recorded": ["normalization.emitted"],
  "failure.recorded": [
    "acquisition.declared",
    "request.started",
    "request.succeeded",
    "artifact.committed",
    "artifact.verified",
    "checkpoint.advanced",
    "normalization.emitted",
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

class MemoryContractJournal implements ContractJournal {
  readonly #rows: JournalRow[] = [];

  append(event: ContractEvent, checkpoint: DurableCheckpoint): void {
    validateJournalAppend(this.#rows, event);
    this.#rows.push({ sequence: this.#rows.length, event, checkpoint });
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
    this.#database
      .prepare(
        "INSERT INTO acquisition_journal (sequence, event, checkpoint_json) VALUES (?, ?, ?)",
      )
      .run(rows.length, event, canonicalJson(checkpoint as unknown as JsonValue));
  }

  rows(): readonly JournalRow[] {
    return (
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
    return Uint8Array.from(this.receipt.bytes);
  }
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
  selectionDigest: string | null = null;

  constructor(
    readonly request: Preflight,
    readonly provider: ProviderDouble,
    readonly artifact: ArtifactDouble,
    readonly journal: ContractJournal,
  ) {}

  checkpoint(overrides: Partial<DurableCheckpoint> = {}): DurableCheckpoint {
    const privateResumableTokenMaterial = this.request.firstRequest
      ? null
      : Buffer.alloc(this.request.pageMaterialBytes ?? 0, 0x07).toString("base64");
    return {
      schemaVersion: 1,
      marketAcquisitionId: hash("synthetic-acquisition"),
      requestIdentityHash: requestIdentity(this.request),
      configurationHash: configurationHash(this.request),
      providerId: this.request.providerId,
      datasetId: this.request.datasetId,
      feedId: this.request.feedId,
      endpointChannelId: this.request.endpointChannelId,
      pageOrdinal: this.request.firstRequest ? 0 : 1,
      currentTokenHash:
        privateResumableTokenMaterial === null ? null : hash(privateResumableTokenMaterial),
      nextTokenHash: null,
      privateResumableTokenMaterial,
      artifactObservationId: this.artifact.receipt?.observationId ?? null,
      artifactDigest: this.artifact.receipt?.digest ?? null,
      budgets: { ...this.budget.value },
      terminal: false,
      incomplete: true,
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
      this.counters.normalizationCalls += 1;
      this.budget.add("facts", 3);
      this.selectionDigest = hash(
        this.provider.resources
          .map((resource) => resource.glyph)
          .sort()
          .join("|"),
      );
      this.journal.append("normalization.emitted", this.checkpoint());
      if (fault.crashAt === "during-normalization" || fault.crashAt === "before-selection") {
        return "crashed";
      }
      this.counters.selectionCalls += 1;
      this.journal.append(
        "selection.recorded",
        this.checkpoint({ terminal: true, incomplete: false }),
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
    if (latest.checkpoint.configurationHash !== expectedConfigurationHash) {
      throw rejection("restart-configuration-changed");
    }
    Object.assign(this.budget.value, latest.checkpoint.budgets);
    const has = (event: ContractEvent): boolean => rows.some((row) => row.event === event);
    if (!has("artifact.committed")) {
      this.artifact.reconcileOrphans();
      this.journal.append("failure.recorded", this.checkpoint());
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
    if (!has("artifact.verified")) {
      const committed = [...rows].reverse().find((row) => row.event === "artifact.committed");
      const digest = committed?.checkpoint.artifactDigest;
      if (digest === null || digest === undefined) throw rejection("artifact-missing");
      this.artifact.read(digest);
      this.journal.append("artifact.verified", this.checkpoint());
    }
    if (!has("checkpoint.advanced")) {
      this.budget.add("pages", 1);
      this.budget.add("records", 3);
      this.journal.append("checkpoint.advanced", this.checkpoint());
    }
    if (!has("normalization.emitted")) {
      this.counters.normalizationCalls += 1;
      this.budget.add("facts", 3);
      this.selectionDigest = hash(
        this.provider.resources
          .map((resource) => resource.glyph)
          .sort()
          .join("|"),
      );
      this.journal.append("normalization.emitted", this.checkpoint());
    }
    if (!has("selection.recorded")) {
      this.counters.selectionCalls += 1;
      this.journal.append(
        "selection.recorded",
        this.checkpoint({ terminal: true, incomplete: false }),
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
    assert.doesNotThrow(() => validateIdentityEnvelope(envelope), envelope.family);
    const preimageEntries = Object.entries(envelope.preimage);
    const firstKey = preimageEntries[0]?.[0];
    assert.ok(firstKey !== undefined);
    const withoutFirst = Object.fromEntries(preimageEntries.slice(1));
    const mutations: readonly [string, IdentityEnvelope][] = [
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
        "reordered-set",
        { ...envelope, orderedCapabilities: [...envelope.orderedCapabilities].reverse() },
      ],
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
    for (const [_name, mutation] of mutations) {
      const counters = zeroCounters();
      assert.throws(() => {
        validateIdentityEnvelope(mutation);
        counters.credentialReads += 1;
      }, /(?:identity|market)/u);
      assertZeroSideEffects(counters);
    }
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
  journal.append("request.started", model.checkpoint());
  journal.append("request.succeeded", model.checkpoint());
  journal.append("failure.recorded", model.checkpoint());
  journal.append("request.started", model.checkpoint());

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

test("memory and real SQLite close/reopen preserve the complete journal and restart decision", async () => {
  const request = exactBoundaryRequest(0n);
  const memoryJournal = new MemoryContractJournal();
  const memoryModel = new AcquisitionContractModel(
    request,
    new ProviderDouble(),
    new ArtifactDouble(),
    memoryJournal,
  );
  assert.equal(await memoryModel.run(), "complete");
  const expected = canonicalJson(memoryJournal.rows() as unknown as JsonValue);

  const directory = mkdtempSync(join(tmpdir(), "peas-p1-10-journal-"));
  const filename = join(directory, "journal.sqlite");
  const provider = new ProviderDouble();
  const artifact = new ArtifactDouble();
  try {
    let sqliteJournal = new SqliteContractJournal(filename);
    const crashing = new AcquisitionContractModel(request, provider, artifact, sqliteJournal);
    assert.equal(await crashing.run({ crashAt: "artifact-committed" }), "crashed");
    sqliteJournal.close();

    sqliteJournal = new SqliteContractJournal(filename);
    const restarted = new AcquisitionContractModel(request, provider, artifact, sqliteJournal);
    const providerCallsBefore = provider.requestCalls;
    assert.equal(await restarted.resume(configurationHash(request)), "complete");
    assert.equal(provider.requestCalls, providerCallsBefore);
    const sqliteProjection = canonicalJson(sqliteJournal.rows() as unknown as JsonValue);
    assert.equal(sqliteProjection, expected);
    const checkpoint = sqliteJournal.rows().at(-1)?.checkpoint;
    assert.ok(checkpoint !== undefined);
    assert.deepEqual(checkpoint.budgets, {
      pages: 1,
      bytes: 15,
      records: 3,
      facts: 3,
      attempts: 1,
    });
    assert.equal(checkpoint.requestIdentityHash, requestIdentity(request));
    assert.equal(checkpoint.configurationHash, configurationHash(request));
    assert.equal(checkpoint.terminal, true);
    assert.equal(checkpoint.incomplete, false);
    sqliteJournal.close();
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
