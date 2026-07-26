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
  deriveArtifactContentId,
  deriveEndpointChannelId,
  deriveInstrumentId,
  deriveMarketAcquisitionId,
  deriveMarketDatasetId,
  deriveMarketFeedId,
  deriveMarketProviderId,
  deriveRawArtifactId,
} from "../src/providers/market-reference/identity.js";
import {
  deriveAcquisitionObservationId,
  deriveIssuerMappingId,
} from "../src/providers/observation-ledger.js";

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
const ENTITLEMENT_SNAPSHOT_ID = `ent1_${"a".repeat(64)}`;
const ROUTE_POLICY_VERSION = "p1-10-frozen-historical-multi-symbol-v1";
const JOURNAL_SCHEMA_VERSION = 1;
const RUN_SESSION_NONCE = "synthetic-run-session-v1";
const CANONICAL_SYMBOLS = Object.freeze(["GA", "GC"]);
type InstrumentMember = Readonly<{ canonicalSymbol: string; instrumentId: string }>;
type IssuerMappingPreimage = Readonly<{
  issuerCik: string;
  symbols: readonly string[];
  selectedSymbol: string;
  mappingAuthority: string;
  mappingVersion: string;
  effectiveFromMs: number;
  effectiveToMs: number | null;
}>;
type SyntheticInstrumentPreimage = Readonly<{
  issuerMappingId: string;
  securityAuthority: string;
  securityKey: string;
  issueType: string;
  shareClass: string;
  primaryListingVenueCode: string;
  currency: string;
  roundLotSize: number;
  effectiveFromNs: string;
  effectiveToNs: string | null;
  predecessorInstrumentId: string | null;
  transitionReason: string | null;
}>;
type SymbolAliasPreimage = Readonly<{
  instrumentId: string;
  symbol: string;
  mappingAuthority: string;
  mappingVersion: string;
  mappingArtifactDigest: string;
  effectiveFromNs: string;
  effectiveToNs: string | null;
}>;
type FrozenAliasAuthorityRecord = Readonly<{
  canonicalSymbol: string;
  issuerMappingPreimage: IssuerMappingPreimage;
  issuerMappingId: string;
  instrumentPreimage: SyntheticInstrumentPreimage;
  instrumentId: string;
  symbolAliasPreimage: SymbolAliasPreimage;
  symbolAliasId: string;
}>;
type FrozenAliasAuthorityCatalog = Readonly<{
  schemaVersion: string;
  classification: string;
  providerEvidence: boolean;
  networkAuthorized: boolean;
  records: readonly FrozenAliasAuthorityRecord[];
  catalogId: string;
}>;
type DeepMutable<T> = T extends readonly (infer Element)[]
  ? DeepMutable<Element>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

const ALIAS_AUTHORITY_CATALOG_SCHEMA = "peas-p1-10-synthetic-alias-authority-catalog-v1";
const ALIAS_AUTHORITY_CATALOG_ID =
  "maac1_361de0d202a39899c369c10da3c5bb43e98305c91749f1bee6b7cab5eac685dd";
const ALIAS_AUTHORITY_CATALOG_DOMAIN = "peas/market-acquisition-alias-authority-catalog/v1";

function recursivelyDeepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      recursivelyDeepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function assertRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (!Object.isFrozen(value)) throw rejection("instrument-authority-catalog-mutable");
  for (const nested of Object.values(value as Record<string, unknown>)) {
    assertRecursivelyFrozen(nested);
  }
}

function syntheticAliasAuthorityRecord(
  canonicalSymbol: string,
  ordinal: number,
  options: Readonly<{
    effectiveFromNs?: string;
    effectiveToNs?: string | null;
    effectiveFromMs?: number;
    effectiveToMs?: number | null;
    securityVersion?: string;
  }> = {},
): FrozenAliasAuthorityRecord {
  const issuerMappingPreimage: IssuerMappingPreimage = Object.freeze({
    issuerCik: (ordinal + 1).toString().padStart(10, "0"),
    symbols: Object.freeze([canonicalSymbol]),
    selectedSymbol: canonicalSymbol,
    mappingAuthority: "peas-p1-10-original-synthetic",
    mappingVersion: `v${ordinal + 1}`,
    effectiveFromMs: options.effectiveFromMs ?? 0,
    effectiveToMs: options.effectiveToMs ?? null,
  });
  const issuerMappingId = deriveIssuerMappingId(issuerMappingPreimage);
  assert.equal(
    issuerMappingId,
    `imap1_${independentCanonicalHash(
      "peas/issuer-mapping/v1",
      issuerMappingPreimage as unknown as JsonValue,
    )}`,
  );
  const instrumentPreimage: SyntheticInstrumentPreimage = Object.freeze({
    issuerMappingId,
    securityAuthority: "peas-p1-10-original-synthetic",
    securityKey: `fictional-security-${ordinal}-${options.securityVersion ?? "base"}`,
    issueType: "common-share",
    shareClass: "A",
    primaryListingVenueCode: "XNAS",
    currency: "USD",
    roundLotSize: 100,
    effectiveFromNs: options.effectiveFromNs ?? "0",
    effectiveToNs: options.effectiveToNs ?? null,
    predecessorInstrumentId: null,
    transitionReason: null,
  });
  const instrumentId = deriveInstrumentId(instrumentPreimage);
  assert.equal(
    instrumentId,
    `min1_${independentCanonicalHash(
      "peas/market-instrument/v1",
      instrumentPreimage as unknown as JsonValue,
    )}`,
  );
  const symbolAliasPreimage: SymbolAliasPreimage = Object.freeze({
    instrumentId,
    symbol: canonicalSymbol,
    mappingAuthority: "peas-p1-10-original-synthetic",
    mappingVersion: `v${ordinal + 1}`,
    mappingArtifactDigest: createHash("sha256")
      .update(`p1-10-original-synthetic-alias-authority:${ordinal}:${canonicalSymbol}`)
      .digest("hex"),
    effectiveFromNs: options.effectiveFromNs ?? "0",
    effectiveToNs: options.effectiveToNs ?? null,
  });
  const symbolAliasId = `msa1_${canonicalHash(
    "peas/market-symbol-alias/v1",
    symbolAliasPreimage as unknown as JsonValue,
  )}`;
  assert.equal(
    symbolAliasId,
    `msa1_${independentCanonicalHash(
      "peas/market-symbol-alias/v1",
      symbolAliasPreimage as unknown as JsonValue,
    )}`,
  );
  return Object.freeze({
    canonicalSymbol,
    issuerMappingPreimage,
    issuerMappingId,
    instrumentPreimage,
    instrumentId,
    symbolAliasPreimage,
    symbolAliasId,
  });
}

const MODULE_ALIAS_AUTHORITY_CATALOG = recursivelyDeepFreeze(
  JSON.parse(
    readFileSync("fixtures/market-acquisition/v1/synthetic-alias-authority-catalog.json", "utf8"),
  ) as FrozenAliasAuthorityCatalog,
);
const FROZEN_INSTRUMENT_REGISTRY = MODULE_ALIAS_AUTHORITY_CATALOG.records;
const MODULE_ALIAS_AUTHORITY_CATALOG_VALIDATED = (() => {
  assertRecursivelyFrozen(MODULE_ALIAS_AUTHORITY_CATALOG);
  validateAliasAuthorityCatalogStructureAndRows(MODULE_ALIAS_AUTHORITY_CATALOG);
  validateAliasAuthorityCatalogIdentity(MODULE_ALIAS_AUTHORITY_CATALOG, ALIAS_AUTHORITY_CATALOG_ID);
  if (MODULE_ALIAS_AUTHORITY_CATALOG.records.length !== 65) {
    throw rejection("instrument-authority-catalog-count-invalid");
  }
  return true;
})();
const BASE_INSTRUMENTS = Object.freeze(
  CANONICAL_SYMBOLS.map((symbol) => {
    const authority = FROZEN_INSTRUMENT_REGISTRY.find(
      (record) => record.canonicalSymbol === symbol,
    );
    if (authority === undefined) throw rejection("synthetic-instrument-registry-invalid");
    return Object.freeze({ canonicalSymbol: symbol, instrumentId: authority.instrumentId });
  }),
);
const EFFECTIVE_CEILINGS = Object.freeze({
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
});

type AlpacaKind = "bars" | "quotes" | "trades";
type ContinuationBindingPreimage = Readonly<{
  precedingMarketAcquisitionId: string;
  requestIdentityHash: string;
  precedingLogicalPageIdentityHash: string;
  precedingPageOrdinal: number;
  precedingArtifactObservationId: string;
  precedingArtifactDigest: string;
  precedingPageChainHash: string;
  nextPageOrdinal: number;
  nextTokenHash: string;
}>;
type ContinuationMaterial = Readonly<{
  opaqueMaterial: string;
  tokenHash: string;
  binding: ContinuationBindingPreimage;
  bindingHash: string;
  priorTokenHashes: readonly string[];
}>;
type TrustedClockEvidenceInput = Readonly<Record<string, unknown>>;
type Preflight = Readonly<{
  kind: AlpacaKind;
  method: string;
  origin: string;
  path: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  entitlementSnapshotId: string;
  routePolicyVersion: string;
  aliasAuthorityCatalogId: string;
  instruments: readonly InstrumentMember[];
  fields: Readonly<Record<string, string>>;
  trustedClockEvidence: unknown;
  liveEnabled: boolean;
  authorizationMode: string;
  capability: string;
  fallbackKind: string;
  zeroIncrementalSpend: boolean;
  costStatus: "zero-incremental-spend-approved" | "unknown" | "stale";
  zeroSpendPolicyId: string | null;
  zeroSpendPolicyPreimage: Readonly<Record<string, JsonValue>> | null;
  runDecision: "allow" | "reject" | null;
  pageOrdinal: number;
  continuation: ContinuationMaterial | null;
}>;

const CLOCK_BASIS_ID = "synthetic-system-utc-basis-v1";
const CLOCK_SESSION_ID = "synthetic-process-session-v1";
const CLOCK_CURRENT_WALL_NS = 1_000_000_000_000_000_000n;
const MAX_SIGNED_CLOCK_NS = (1n << 63n) - 1n;

function baseTrustedClockEvidence(
  currentWallNs = CLOCK_CURRENT_WALL_NS,
  maximumErrorNs: bigint | null = 0n,
): TrustedClockEvidenceInput {
  return {
    available: true,
    basisId: CLOCK_BASIS_ID,
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorNs,
    maximumErrorBounded: true,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: CLOCK_SESSION_ID,
    priorSample: {
      sampleId: "clock-sample-prior",
      previousSampleId: null,
      basisId: CLOCK_BASIS_ID,
      wallClock: "system-utc",
      synchronization: "verified-bound",
      wallNs: currentWallNs - 1n,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: CLOCK_SESSION_ID,
      monotonicUs: 10n,
    },
    currentSample: {
      sampleId: "clock-sample-current",
      previousSampleId: "clock-sample-prior",
      basisId: CLOCK_BASIS_ID,
      wallClock: "system-utc",
      synchronization: "verified-bound",
      wallNs: currentWallNs,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: CLOCK_SESSION_ID,
      monotonicUs: 11n,
    },
  };
}

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
    symbols: CANONICAL_SYMBOLS.join(","),
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
    entitlementSnapshotId: ENTITLEMENT_SNAPSHOT_ID,
    routePolicyVersion: ROUTE_POLICY_VERSION,
    aliasAuthorityCatalogId: ALIAS_AUTHORITY_CATALOG_ID,
    instruments: BASE_INSTRUMENTS,
    fields: kind === "bars" ? { ...common, timeframe: "1Min", adjustment: "raw" } : common,
    trustedClockEvidence: baseTrustedClockEvidence(),
    liveEnabled: true,
    authorizationMode: "p1-09-approved",
    capability: "historical-market-reference",
    fallbackKind: "none",
    zeroIncrementalSpend: true,
    costStatus: "zero-incremental-spend-approved",
    zeroSpendPolicyId: ZERO_SPEND_POLICY_ID,
    zeroSpendPolicyPreimage: ZERO_SPEND_POLICY_PREIMAGE,
    runDecision: "allow",
    pageOrdinal: 0,
    continuation: null,
  };
}

function assertExactObjectKeys(
  value: unknown,
  expectedKeys: readonly string[],
  code: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...expectedKeys].sort().join(",")
  ) {
    throw rejection(code);
  }
}

function validateAliasAuthorityRecord(record: FrozenAliasAuthorityRecord): void {
  assertExactObjectKeys(
    record,
    [
      "canonicalSymbol",
      "issuerMappingPreimage",
      "issuerMappingId",
      "instrumentPreimage",
      "instrumentId",
      "symbolAliasPreimage",
      "symbolAliasId",
    ],
    "instrument-alias-authority-shape-invalid",
  );
  assertExactObjectKeys(
    record.issuerMappingPreimage,
    [
      "issuerCik",
      "symbols",
      "selectedSymbol",
      "mappingAuthority",
      "mappingVersion",
      "effectiveFromMs",
      "effectiveToMs",
    ],
    "instrument-alias-authority-shape-invalid",
  );
  assertExactObjectKeys(
    record.instrumentPreimage,
    [
      "issuerMappingId",
      "securityAuthority",
      "securityKey",
      "issueType",
      "shareClass",
      "primaryListingVenueCode",
      "currency",
      "roundLotSize",
      "effectiveFromNs",
      "effectiveToNs",
      "predecessorInstrumentId",
      "transitionReason",
    ],
    "instrument-alias-authority-shape-invalid",
  );
  assertExactObjectKeys(
    record.symbolAliasPreimage,
    [
      "instrumentId",
      "symbol",
      "mappingAuthority",
      "mappingVersion",
      "mappingArtifactDigest",
      "effectiveFromNs",
      "effectiveToNs",
    ],
    "instrument-alias-authority-shape-invalid",
  );
  if (
    typeof record.canonicalSymbol !== "string" ||
    typeof record.issuerMappingId !== "string" ||
    typeof record.instrumentId !== "string" ||
    typeof record.symbolAliasId !== "string" ||
    !Array.isArray(record.issuerMappingPreimage.symbols) ||
    typeof record.issuerMappingPreimage.issuerCik !== "string" ||
    typeof record.issuerMappingPreimage.selectedSymbol !== "string" ||
    typeof record.issuerMappingPreimage.mappingAuthority !== "string" ||
    typeof record.issuerMappingPreimage.mappingVersion !== "string" ||
    typeof record.instrumentPreimage.issuerMappingId !== "string" ||
    typeof record.instrumentPreimage.securityAuthority !== "string" ||
    typeof record.instrumentPreimage.securityKey !== "string" ||
    typeof record.instrumentPreimage.issueType !== "string" ||
    typeof record.instrumentPreimage.shareClass !== "string" ||
    typeof record.instrumentPreimage.primaryListingVenueCode !== "string" ||
    typeof record.instrumentPreimage.currency !== "string" ||
    !Number.isSafeInteger(record.instrumentPreimage.roundLotSize) ||
    typeof record.instrumentPreimage.effectiveFromNs !== "string" ||
    typeof record.symbolAliasPreimage.instrumentId !== "string" ||
    typeof record.symbolAliasPreimage.symbol !== "string" ||
    typeof record.symbolAliasPreimage.mappingAuthority !== "string" ||
    typeof record.symbolAliasPreimage.mappingVersion !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.symbolAliasPreimage.mappingArtifactDigest) ||
    typeof record.symbolAliasPreimage.effectiveFromNs !== "string"
  ) {
    throw rejection("instrument-alias-authority-shape-invalid");
  }
  const recomputedIssuerMappingId = deriveIssuerMappingId(record.issuerMappingPreimage);
  const independentIssuerMappingId = `imap1_${independentCanonicalHash(
    "peas/issuer-mapping/v1",
    record.issuerMappingPreimage as unknown as JsonValue,
  )}`;
  const recomputedInstrumentId = deriveInstrumentId(record.instrumentPreimage);
  const independentInstrumentId = `min1_${independentCanonicalHash(
    "peas/market-instrument/v1",
    record.instrumentPreimage as unknown as JsonValue,
  )}`;
  const recomputedSymbolAliasId = `msa1_${canonicalHash(
    "peas/market-symbol-alias/v1",
    record.symbolAliasPreimage as unknown as JsonValue,
  )}`;
  const independentSymbolAliasId = `msa1_${independentCanonicalHash(
    "peas/market-symbol-alias/v1",
    record.symbolAliasPreimage as unknown as JsonValue,
  )}`;
  const canonicalNs = (value: string): boolean => /^(0|[1-9]\d*)$/u.test(value);
  if (
    !canonicalNs(record.instrumentPreimage.effectiveFromNs) ||
    (record.instrumentPreimage.effectiveToNs !== null &&
      !canonicalNs(record.instrumentPreimage.effectiveToNs)) ||
    !canonicalNs(record.symbolAliasPreimage.effectiveFromNs) ||
    (record.symbolAliasPreimage.effectiveToNs !== null &&
      !canonicalNs(record.symbolAliasPreimage.effectiveToNs)) ||
    !Number.isSafeInteger(record.issuerMappingPreimage.effectiveFromMs) ||
    record.issuerMappingPreimage.effectiveFromMs < 0 ||
    (record.issuerMappingPreimage.effectiveToMs !== null &&
      (!Number.isSafeInteger(record.issuerMappingPreimage.effectiveToMs) ||
        record.issuerMappingPreimage.effectiveToMs <= record.issuerMappingPreimage.effectiveFromMs))
  ) {
    throw rejection("instrument-alias-authority-interval-invalid");
  }
  const instrumentFrom = BigInt(record.instrumentPreimage.effectiveFromNs);
  const instrumentTo =
    record.instrumentPreimage.effectiveToNs === null
      ? null
      : BigInt(record.instrumentPreimage.effectiveToNs);
  const aliasFrom = BigInt(record.symbolAliasPreimage.effectiveFromNs);
  const aliasTo =
    record.symbolAliasPreimage.effectiveToNs === null
      ? null
      : BigInt(record.symbolAliasPreimage.effectiveToNs);
  const issuerFrom = BigInt(record.issuerMappingPreimage.effectiveFromMs) * 1_000_000n;
  const issuerTo =
    record.issuerMappingPreimage.effectiveToMs === null
      ? null
      : BigInt(record.issuerMappingPreimage.effectiveToMs) * 1_000_000n;
  if (
    record.issuerMappingId !== recomputedIssuerMappingId ||
    record.issuerMappingId !== independentIssuerMappingId ||
    record.instrumentId !== recomputedInstrumentId ||
    record.instrumentId !== independentInstrumentId ||
    record.symbolAliasId !== recomputedSymbolAliasId ||
    record.symbolAliasId !== independentSymbolAliasId ||
    record.instrumentPreimage.issuerMappingId !== record.issuerMappingId ||
    record.symbolAliasPreimage.instrumentId !== record.instrumentId ||
    record.symbolAliasPreimage.symbol !== record.canonicalSymbol ||
    record.issuerMappingPreimage.selectedSymbol !== record.canonicalSymbol ||
    record.issuerMappingPreimage.symbols.length !== 1 ||
    record.issuerMappingPreimage.symbols[0] !== record.canonicalSymbol ||
    (instrumentTo !== null && instrumentFrom >= instrumentTo) ||
    (aliasTo !== null && aliasFrom >= aliasTo) ||
    aliasFrom < instrumentFrom ||
    (instrumentTo !== null && (aliasTo === null || aliasTo > instrumentTo)) ||
    issuerFrom > instrumentFrom ||
    (issuerTo !== null && (instrumentTo === null || instrumentTo > issuerTo))
  ) {
    throw rejection("instrument-alias-authority-invalid");
  }
}

function aliasAuthorityCatalogPreimage(catalog: FrozenAliasAuthorityCatalog): JsonValue {
  return {
    schemaVersion: catalog.schemaVersion,
    classification: catalog.classification,
    providerEvidence: catalog.providerEvidence,
    networkAuthorized: catalog.networkAuthorized,
    records: catalog.records,
  } as unknown as JsonValue;
}

function validateAliasAuthorityCatalogStructureAndRows(catalog: FrozenAliasAuthorityCatalog): void {
  assertExactObjectKeys(
    catalog,
    [
      "schemaVersion",
      "classification",
      "providerEvidence",
      "networkAuthorized",
      "records",
      "catalogId",
    ],
    "instrument-authority-catalog-shape-invalid",
  );
  if (
    catalog.schemaVersion !== ALIAS_AUTHORITY_CATALOG_SCHEMA ||
    catalog.classification !== "original-project-authored-synthetic" ||
    catalog.providerEvidence !== false ||
    catalog.networkAuthorized !== false ||
    !Array.isArray(catalog.records) ||
    catalog.records.length === 0 ||
    typeof catalog.catalogId !== "string"
  ) {
    throw rejection("instrument-authority-catalog-shape-invalid");
  }
  for (const record of catalog.records) validateAliasAuthorityRecord(record);
}

function validateAliasAuthorityCatalogIdentity(
  catalog: FrozenAliasAuthorityCatalog,
  configuredCatalogId: string,
): void {
  const preimage = aliasAuthorityCatalogPreimage(catalog);
  const acceptedCatalogId = `maac1_${canonicalHash(ALIAS_AUTHORITY_CATALOG_DOMAIN, preimage)}`;
  const independentCatalogId = `maac1_${independentCanonicalHash(
    ALIAS_AUTHORITY_CATALOG_DOMAIN,
    preimage,
  )}`;
  if (
    catalog.catalogId !== ALIAS_AUTHORITY_CATALOG_ID ||
    configuredCatalogId !== ALIAS_AUTHORITY_CATALOG_ID ||
    catalog.catalogId !== acceptedCatalogId ||
    catalog.catalogId !== independentCatalogId
  ) {
    throw rejection("instrument-authority-catalog-identity-invalid");
  }
}

function authorityCatalogSnapshotForUse(
  catalog: FrozenAliasAuthorityCatalog,
): FrozenAliasAuthorityCatalog {
  if (catalog === MODULE_ALIAS_AUTHORITY_CATALOG) {
    if (!MODULE_ALIAS_AUTHORITY_CATALOG_VALIDATED) {
      throw rejection("instrument-authority-catalog-unvalidated");
    }
    return catalog;
  }
  let snapshot: FrozenAliasAuthorityCatalog;
  try {
    snapshot = JSON.parse(
      canonicalJson(catalog as unknown as JsonValue),
    ) as FrozenAliasAuthorityCatalog;
  } catch {
    throw rejection("instrument-authority-catalog-snapshot-invalid");
  }
  validateAliasAuthorityCatalogStructureAndRows(snapshot);
  return snapshot;
}

function authorityCatalogWithRecords(
  records: readonly FrozenAliasAuthorityRecord[],
  catalogId = ALIAS_AUTHORITY_CATALOG_ID,
): FrozenAliasAuthorityCatalog {
  return {
    schemaVersion: ALIAS_AUTHORITY_CATALOG_SCHEMA,
    classification: "original-project-authored-synthetic",
    providerEvidence: false,
    networkAuthorized: false,
    records,
    catalogId,
  };
}

function mutableAliasAuthorityCatalogClone(): DeepMutable<FrozenAliasAuthorityCatalog> {
  return JSON.parse(
    canonicalJson(MODULE_ALIAS_AUTHORITY_CATALOG as unknown as JsonValue),
  ) as DeepMutable<FrozenAliasAuthorityCatalog>;
}

function intervalContainsQuery(
  effectiveFromNs: string,
  effectiveToNs: string | null,
  queryStartNs: bigint,
  queryEndNs: bigint,
): boolean {
  if (!/^(0|[1-9]\d*)$/u.test(effectiveFromNs)) return false;
  if (effectiveToNs !== null && !/^(0|[1-9]\d*)$/u.test(effectiveToNs)) return false;
  const from = BigInt(effectiveFromNs);
  const to = effectiveToNs === null ? null : BigInt(effectiveToNs);
  return from <= queryStartNs && (to === null || queryEndNs < to);
}

function validateInstrumentMembership(
  value: Preflight,
  authorityCatalog: FrozenAliasAuthorityCatalog = MODULE_ALIAS_AUTHORITY_CATALOG,
): Readonly<{
  canonicalSymbols: readonly string[];
  instrumentIds: readonly string[];
}> {
  if (
    !Array.isArray(value.instruments) ||
    value.instruments.length < 1 ||
    value.instruments.length > LIMITS.instruments
  ) {
    throw rejection("instrument-count-invalid");
  }
  const canonicalSymbols: string[] = [];
  const instrumentIds: string[] = [];
  let priorSymbol: string | null = null;
  const seenSymbols = new Set<string>();
  const seenInstrumentIds = new Set<string>();
  const queryStartNs = parseCanonicalNs(value.fields["start"] as string);
  const queryEndNs = parseCanonicalNs(value.fields["end"] as string);
  const authorityByAlias = new Map<string, FrozenAliasAuthorityRecord[]>();
  const catalogSnapshot = authorityCatalogSnapshotForUse(authorityCatalog);
  for (const record of catalogSnapshot.records) {
    const records = authorityByAlias.get(record.canonicalSymbol) ?? [];
    records.push(record);
    authorityByAlias.set(record.canonicalSymbol, records);
  }
  for (const member of value.instruments) {
    if (
      member === null ||
      typeof member !== "object" ||
      Object.keys(member).sort().join(",") !== "canonicalSymbol,instrumentId" ||
      typeof member.canonicalSymbol !== "string" ||
      typeof member.instrumentId !== "string"
    ) {
      throw rejection("instrument-member-shape-invalid");
    }
    const symbol = member.canonicalSymbol;
    if (
      symbol.length === 0 ||
      Buffer.byteLength(symbol, "utf8") === 0 ||
      symbol.includes(",") ||
      symbol.trim() !== symbol
    ) {
      throw rejection("instrument-alias-invalid");
    }
    const aliasAuthority = authorityByAlias.get(symbol) ?? [];
    const matchingAuthority = aliasAuthority.filter((record) => {
      const issuerFromNs = BigInt(record.issuerMappingPreimage.effectiveFromMs) * 1_000_000n;
      const issuerToNs =
        record.issuerMappingPreimage.effectiveToMs === null
          ? null
          : BigInt(record.issuerMappingPreimage.effectiveToMs) * 1_000_000n;
      const issuerContains =
        issuerFromNs <= queryStartNs && (issuerToNs === null || queryEndNs < issuerToNs);
      return (
        issuerContains &&
        intervalContainsQuery(
          record.instrumentPreimage.effectiveFromNs,
          record.instrumentPreimage.effectiveToNs,
          queryStartNs,
          queryEndNs,
        ) &&
        intervalContainsQuery(
          record.symbolAliasPreimage.effectiveFromNs,
          record.symbolAliasPreimage.effectiveToNs,
          queryStartNs,
          queryEndNs,
        )
      );
    });
    if (matchingAuthority.length === 0) {
      throw rejection(
        aliasAuthority.length > 0 ? "instrument-effective-interval-gap" : "instrument-unmapped",
      );
    }
    if (matchingAuthority.length !== 1) {
      throw rejection("instrument-effective-interval-ambiguous");
    }
    const frozenInstrumentId = (matchingAuthority[0] as FrozenAliasAuthorityRecord).instrumentId;
    if (member.instrumentId !== frozenInstrumentId) {
      throw rejection("instrument-alias-instrument-mismatch");
    }
    if (seenSymbols.has(symbol) || seenInstrumentIds.has(member.instrumentId)) {
      throw rejection("instrument-duplicate");
    }
    if (
      priorSymbol !== null &&
      Buffer.compare(Buffer.from(priorSymbol, "utf8"), Buffer.from(symbol, "utf8")) >= 0
    ) {
      throw rejection("instrument-order-invalid");
    }
    seenSymbols.add(symbol);
    seenInstrumentIds.add(member.instrumentId);
    canonicalSymbols.push(symbol);
    instrumentIds.push(member.instrumentId);
    priorSymbol = symbol;
  }
  const encodedSymbols = canonicalSymbols.join(",");
  if (value.fields["symbols"] !== encodedSymbols) {
    throw rejection("instrument-query-membership-mismatch");
  }
  validateAliasAuthorityCatalogIdentity(catalogSnapshot, value.aliasAuthorityCatalogId);
  return {
    canonicalSymbols,
    instrumentIds: instrumentIds.sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    ),
  };
}

function parseCanonicalNs(text: string): bigint {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/u.test(text)) {
    throw rejection("timestamp-invalid");
  }
  const millisecondEncoding = `${text.slice(0, 23)}Z`;
  const milliseconds = Date.parse(millisecondEncoding);
  if (!Number.isFinite(milliseconds)) throw rejection("timestamp-invalid");
  const exactMillisecondRoundTrip = new Date(milliseconds).toISOString();
  if (exactMillisecondRoundTrip !== millisecondEncoding) {
    throw rejection("timestamp-roundtrip-invalid");
  }
  const exactNanosecondRoundTrip = `${exactMillisecondRoundTrip.slice(0, 20)}${text.slice(20, 29)}Z`;
  if (exactNanosecondRoundTrip !== text) throw rejection("timestamp-roundtrip-invalid");
  return BigInt(milliseconds) * 1_000_000n + (BigInt(text.slice(20, 29)) % 1_000_000n);
}

function validateTrustedClockEvidence(evidence: unknown): bigint {
  assertExactObjectKeys(
    evidence,
    [
      "available",
      "basisId",
      "wallClock",
      "synchronization",
      "maximumErrorNs",
      "maximumErrorBounded",
      "monotonicClock",
      "monotonicSessionId",
      "priorSample",
      "currentSample",
    ],
    "clock-unavailable",
  );
  const priorSample = evidence["priorSample"];
  const currentSample = evidence["currentSample"];
  const sampleKeys = [
    "sampleId",
    "previousSampleId",
    "basisId",
    "wallClock",
    "synchronization",
    "wallNs",
    "monotonicClock",
    "monotonicSessionId",
    "monotonicUs",
  ] as const;
  assertExactObjectKeys(priorSample, sampleKeys, "clock-unavailable");
  assertExactObjectKeys(currentSample, sampleKeys, "clock-unavailable");
  if (
    evidence["available"] !== true ||
    evidence["basisId"] !== CLOCK_BASIS_ID ||
    evidence["wallClock"] !== "system-utc" ||
    evidence["synchronization"] !== "verified-bound" ||
    evidence["monotonicClock"] !== "process-monotonic-us" ||
    typeof evidence["monotonicSessionId"] !== "string" ||
    evidence["monotonicSessionId"].length === 0
  ) {
    throw rejection("clock-unavailable");
  }
  const maximumErrorNs = evidence["maximumErrorNs"];
  if (
    evidence["maximumErrorBounded"] !== true ||
    typeof maximumErrorNs !== "bigint" ||
    maximumErrorNs < 0n ||
    maximumErrorNs > MAX_SIGNED_CLOCK_NS
  ) {
    throw rejection("clock-unprovable");
  }
  for (const sample of [priorSample, currentSample]) {
    if (
      typeof sample["sampleId"] !== "string" ||
      sample["sampleId"].length === 0 ||
      sample["basisId"] !== evidence["basisId"] ||
      sample["wallClock"] !== evidence["wallClock"] ||
      sample["synchronization"] !== evidence["synchronization"] ||
      sample["monotonicClock"] !== evidence["monotonicClock"] ||
      sample["monotonicSessionId"] !== evidence["monotonicSessionId"] ||
      typeof sample["wallNs"] !== "bigint" ||
      sample["wallNs"] < 0n ||
      sample["wallNs"] > MAX_SIGNED_CLOCK_NS ||
      typeof sample["monotonicUs"] !== "bigint" ||
      sample["monotonicUs"] < 0n ||
      sample["monotonicUs"] > MAX_SIGNED_CLOCK_NS
    ) {
      throw rejection("clock-unavailable");
    }
  }
  if (
    priorSample["previousSampleId"] !== null ||
    currentSample["previousSampleId"] !== priorSample["sampleId"] ||
    currentSample["sampleId"] === priorSample["sampleId"]
  ) {
    throw rejection("clock-sample-linkage-invalid");
  }
  const priorWallNs = priorSample["wallNs"] as bigint;
  const currentWallNs = currentSample["wallNs"] as bigint;
  if (currentWallNs < priorWallNs) throw rejection("clock-regression");
  const priorMonotonicUs = priorSample["monotonicUs"] as bigint;
  const currentMonotonicUs = currentSample["monotonicUs"] as bigint;
  if (currentMonotonicUs <= priorMonotonicUs) throw rejection("clock-regression");
  if (maximumErrorNs > currentWallNs) throw rejection("clock-unprovable");
  const conservativeTrustedRequestStartedAtNs = currentWallNs - maximumErrorNs;
  if (
    conservativeTrustedRequestStartedAtNs < 0n ||
    conservativeTrustedRequestStartedAtNs > MAX_SIGNED_CLOCK_NS
  ) {
    throw rejection("clock-unprovable");
  }
  return conservativeTrustedRequestStartedAtNs;
}

function preflight(
  value: Preflight,
  precedingCheckpoint: DurableCheckpoint | null = null,
  authorityCatalog: FrozenAliasAuthorityCatalog = MODULE_ALIAS_AUTHORITY_CATALOG,
): void {
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
    value.endpointChannelId !== route.channel ||
    value.entitlementSnapshotId !== ENTITLEMENT_SNAPSHOT_ID ||
    value.routePolicyVersion !== ROUTE_POLICY_VERSION ||
    value.aliasAuthorityCatalogId !== ALIAS_AUTHORITY_CATALOG_ID
  ) {
    throw rejection("identity-not-authorized");
  }
  const conservativeTrustedRequestStartedAtNs = validateTrustedClockEvidence(
    value.trustedClockEvidence,
  );
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
  validateInstrumentMembership(value, authorityCatalog);
  const allowed = new Set(["symbols", "start", "end", "limit", "feed", "sort"]);
  if (value.kind === "bars") {
    allowed.add("timeframe");
    allowed.add("adjustment");
  }
  if (value.pageOrdinal > 0) allowed.add("page_token");
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
  if (
    !Number.isSafeInteger(value.pageOrdinal) ||
    value.pageOrdinal < 0 ||
    value.pageOrdinal >= LIMITS.pages
  ) {
    throw rejection("page-ordinal-invalid");
  }
  if (value.pageOrdinal === 0) {
    if (
      value.continuation !== null ||
      value.fields["page_token"] !== undefined ||
      precedingCheckpoint !== null
    ) {
      throw rejection("first-page-token");
    }
  } else {
    const continuation = value.continuation;
    const durableTokenHash = precedingCheckpoint?.nextTokenHash;
    const durableBinding: ContinuationBindingPreimage | null =
      precedingCheckpoint === null
        ? null
        : {
            precedingMarketAcquisitionId: precedingCheckpoint.marketAcquisitionId,
            requestIdentityHash: precedingCheckpoint.requestIdentityHash,
            precedingLogicalPageIdentityHash: precedingCheckpoint.logicalPageIdentityHash,
            precedingPageOrdinal: precedingCheckpoint.pageOrdinal,
            precedingArtifactObservationId: precedingCheckpoint.artifactObservationId as string,
            precedingArtifactDigest: precedingCheckpoint.artifactDigest as string,
            precedingPageChainHash: precedingCheckpoint.pageChainHash,
            nextPageOrdinal: precedingCheckpoint.pageOrdinal + 1,
            nextTokenHash: durableTokenHash as string,
          };
    if (
      precedingCheckpoint === null ||
      precedingCheckpoint.checkpointKind !== "page-checkpointed" ||
      precedingCheckpoint.artifactObservationId === null ||
      precedingCheckpoint.artifactDigest === null ||
      precedingCheckpoint.nextResumableTokenMaterial === null ||
      precedingCheckpoint.nextContinuationBindingHash === null ||
      durableTokenHash === null ||
      durableTokenHash === "terminal" ||
      continuation === null ||
      Object.keys(continuation).sort().join(",") !==
        "binding,bindingHash,opaqueMaterial,priorTokenHashes,tokenHash" ||
      Object.keys(continuation.binding).sort().join(",") !==
        "nextPageOrdinal,nextTokenHash,precedingArtifactDigest,precedingArtifactObservationId,precedingLogicalPageIdentityHash,precedingMarketAcquisitionId,precedingPageChainHash,precedingPageOrdinal,requestIdentityHash" ||
      continuation.opaqueMaterial.length === 0 ||
      Buffer.byteLength(continuation.opaqueMaterial, "utf8") > LIMITS.tokenBytes ||
      value.fields["page_token"] !== continuation.opaqueMaterial ||
      precedingCheckpoint.nextResumableTokenMaterial !== continuation.opaqueMaterial ||
      continuation.tokenHash !== privateTokenHash(continuation.opaqueMaterial) ||
      durableTokenHash !== continuation.tokenHash ||
      value.pageOrdinal !== precedingCheckpoint.pageOrdinal + 1 ||
      continuation.binding.requestIdentityHash !== requestIdentity(value) ||
      continuation.binding.nextTokenHash !== continuation.tokenHash ||
      durableBinding === null ||
      canonicalJson(continuation.binding as unknown as JsonValue) !==
        canonicalJson(durableBinding as unknown as JsonValue) ||
      continuation.bindingHash !== continuationBindingHash(continuation.binding) ||
      continuation.bindingHash !== continuationBindingHash(durableBinding) ||
      continuation.bindingHash !== precedingCheckpoint.nextContinuationBindingHash ||
      new Set(continuation.priorTokenHashes).size !== continuation.priorTokenHashes.length ||
      continuation.priorTokenHashes.some((tokenHash) => !/^[0-9a-f]{64}$/u.test(tokenHash)) ||
      continuation.priorTokenHashes.includes(continuation.tokenHash)
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
  if (conservativeTrustedRequestStartedAtNs < HISTORY_DELAY_NS) {
    throw rejection("history-boundary");
  }
  if (end > conservativeTrustedRequestStartedAtNs - HISTORY_DELAY_NS) {
    throw rejection("history-boundary");
  }
}

function exactBoundaryRequest(deltaNs: bigint, maximumErrorNs = 0n): Preflight {
  const endNs = CLOCK_CURRENT_WALL_NS - maximumErrorNs - HISTORY_DELAY_NS + deltaNs;
  const milliseconds = endNs / 1_000_000n;
  const fractional = (endNs % 1_000_000_000n).toString().padStart(9, "0");
  const prefix = new Date(Number(milliseconds)).toISOString().slice(0, 19);
  const canonicalEnd = `${prefix}.${fractional}Z`;
  return {
    ...baseRequest(),
    trustedClockEvidence: baseTrustedClockEvidence(CLOCK_CURRENT_WALL_NS, maximumErrorNs),
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
type RetryFailure = "pre-response" | "clean-partial" | `http-${number}` | "schema" | "artifact";
type RetryEventContext = Readonly<{
  failure: RetryFailure;
  pageAttemptNumber: number;
  acquisitionAttemptCount: number;
  retryAfter: string | null;
  quotaClassification: QuotaClassification;
}>;

function retryDecision(
  failure: RetryFailure,
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

function retryEventDecision(context: RetryEventContext): RetryDecision {
  if (
    !Number.isSafeInteger(context.pageAttemptNumber) ||
    context.pageAttemptNumber < 1 ||
    !Number.isSafeInteger(context.acquisitionAttemptCount) ||
    context.acquisitionAttemptCount < 1 ||
    context.acquisitionAttemptCount >= LIMITS.attempts
  ) {
    return { kind: "stop", delayMs: null };
  }
  return retryDecision(
    context.failure,
    context.pageAttemptNumber,
    context.retryAfter,
    context.quotaClassification,
  );
}

type Page = Readonly<{
  ordinal: number;
  deliveryObservationId: string;
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
  const seenDeliveryObservations = new Set<string>();
  const returnedTokenHashes = new Set<string>();
  let expectedPreceding: string | null = null;
  let terminal = false;
  for (const [index, page] of pages.entries()) {
    if (terminal) throw rejection("page-after-terminal");
    if (page.ordinal !== index) throw rejection("page-position");
    if (page.requestHash !== requestHash) throw rejection("query-substitution");
    if (page.precedingHash !== expectedPreceding) throw rejection("token-gap");
    if (seenDeliveryObservations.has(page.deliveryObservationId)) {
      throw rejection("duplicate-page-delivery-observation");
    }
    seenDeliveryObservations.add(page.deliveryObservationId);
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

function guardedPreflight(
  request: Preflight,
  counters: SideEffectCounters,
  precedingCheckpoint: DurableCheckpoint | null = null,
  authorityCatalog: FrozenAliasAuthorityCatalog = MODULE_ALIAS_AUTHORITY_CATALOG,
): void {
  preflight(request, precedingCheckpoint, authorityCatalog);
  counters.credentialReads += 1;
  counters.transportConstructions += 1;
}

function assertGuardedPreflightReject(
  request: Preflight,
  pattern: RegExp,
  precedingCheckpoint: DurableCheckpoint | null = null,
  authorityCatalog: FrozenAliasAuthorityCatalog = MODULE_ALIAS_AUTHORITY_CATALOG,
): void {
  const counters = zeroCounters();
  assert.throws(
    () => guardedPreflight(request, counters, precedingCheckpoint, authorityCatalog),
    pattern,
  );
  assertZeroSideEffects(counters);
}

function independentCanonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(independentCanonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${independentCanonicalJson(
          (value as Readonly<Record<string, JsonValue>>)[key] as JsonValue,
        )}`,
    )
    .join(",")}}`;
}

function independentCanonicalHash(domain: string, value: JsonValue): string {
  const digest = createHash("sha256");
  for (const part of [domain, independentCanonicalJson(value)]) {
    const bytes = Buffer.from(part, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.byteLength));
    digest.update(length);
    digest.update(bytes);
  }
  return digest.digest("hex");
}

function requestIdentityPreimage(request: Preflight): JsonValue {
  const membership = validateInstrumentMembership(request);
  return {
    providerId: request.providerId,
    datasetId: request.datasetId,
    feedId: request.feedId,
    endpointChannelId: request.endpointChannelId,
    entitlementSnapshotId: request.entitlementSnapshotId,
    authorizationMode: request.authorizationMode,
    instrumentIds: membership.instrumentIds,
    canonicalSymbols: membership.canonicalSymbols,
    factFamily: request.kind,
    queryStartNs: parseCanonicalNs(request.fields["start"] as string).toString(),
    queryEndNs: parseCanonicalNs(request.fields["end"] as string).toString(),
    semanticFixedFields: {
      feed: request.fields["feed"] as string,
      sort: request.fields["sort"] as string,
      timeframe: request.kind === "bars" ? (request.fields["timeframe"] as string) : null,
      adjustment: request.kind === "bars" ? (request.fields["adjustment"] as string) : null,
    },
    routePolicyVersion: request.routePolicyVersion,
  };
}

function requestIdentity(request: Preflight): string {
  const preimage = requestIdentityPreimage(request);
  const derived = canonicalHash("peas/market-acquisition-request/v1", preimage);
  assert.equal(derived, independentCanonicalHash("peas/market-acquisition-request/v1", preimage));
  return derived;
}

function configurationPreimage(request: Preflight): JsonValue {
  return {
    requestIdentityHash: requestIdentity(request),
    requestedPageLimit: Number(request.fields["limit"]),
    effectiveLesserOfEntitlementAndProjectCeilings: EFFECTIVE_CEILINGS,
    runScopedLiveEnableDecision: request.liveEnabled,
    zeroSpendPolicyIdAndDecision: {
      policyId: request.zeroSpendPolicyId,
      decision: request.runDecision,
    },
    aliasAuthorityCatalogId: request.aliasAuthorityCatalogId,
    retryPolicyVersion: "p1-10-deterministic-1s-2s-no-jitter-v1",
    quotaPolicyVersion: "p1-10-30-per-rolling-60s-v1",
    deadlinePolicyVersion: "p1-10-30s-attempt-300s-acquisition-v1",
    retentionPolicyReadiness: "human-authorization-required-not-authorized",
    journalSchemaVersion: JOURNAL_SCHEMA_VERSION,
  };
}

function configurationHash(request: Preflight): string {
  const preimage = configurationPreimage(request);
  const derived = canonicalHash("peas/market-acquisition-configuration/v1", preimage);
  assert.equal(
    derived,
    independentCanonicalHash("peas/market-acquisition-configuration/v1", preimage),
  );
  return derived;
}

function logicalPageIdentityHash(
  requestIdentityHash: string,
  pageOrdinal: number,
  currentTokenHash: string | null,
): string {
  const preimage = {
    requestIdentityHash,
    pageOrdinal,
    currentTokenHash: currentTokenHash ?? "no-token",
  } satisfies JsonValue;
  const derived = canonicalHash("peas/market-acquisition-logical-page/v1", preimage);
  assert.equal(
    derived,
    independentCanonicalHash("peas/market-acquisition-logical-page/v1", preimage),
  );
  return derived;
}

function attemptIdentity(
  logicalPageHash: string,
  attemptOrdinal: number,
): Readonly<{ attemptId: string; retrievalAttemptId: string }> {
  const preimage = {
    logicalPageIdentityHash: logicalPageHash,
    attemptOrdinal,
    runSessionNonce: RUN_SESSION_NONCE,
  } satisfies JsonValue;
  const digest = canonicalHash("peas/market-acquisition-attempt-control/v1", preimage);
  assert.equal(
    digest,
    independentCanonicalHash("peas/market-acquisition-attempt-control/v1", preimage),
  );
  return {
    attemptId: `mat1_${digest}`,
    retrievalAttemptId: `rat1_${digest}`,
  };
}

function acquisitionObservationIdentity(request: Preflight, retrievalAttemptId: string): string {
  const preimage = {
    provider: "alpaca",
    retrievalAttemptId,
    sanitizedRequestIdentityHash: requestIdentity(request),
    routeLabel: `alpaca-v2-historical-${request.kind}`,
  };
  const derived = deriveAcquisitionObservationId(preimage);
  assert.equal(
    derived,
    `aob1_${independentCanonicalHash("peas/acquisition-observation/v1", preimage)}`,
  );
  return derived;
}

function marketAcquisitionIdentity(request: Preflight, acquisitionObservationId: string): string {
  const membership = validateInstrumentMembership(request);
  const preimage = {
    acquisitionObservationId,
    providerId: request.providerId,
    datasetId: request.datasetId,
    feedId: request.feedId,
    endpointChannelId: request.endpointChannelId,
    entitlementSnapshotId: request.entitlementSnapshotId,
    instrumentIds: membership.instrumentIds,
    requestedFactKinds: [request.kind === "bars" ? "bar" : request.kind.slice(0, -1)].sort(),
    queryStartNs: parseCanonicalNs(request.fields["start"] as string).toString(),
    queryEndNs: parseCanonicalNs(request.fields["end"] as string).toString(),
    sortOrder: "asc",
    routePolicyVersion: request.routePolicyVersion,
  };
  const derived = deriveMarketAcquisitionId(preimage);
  assert.equal(
    derived,
    `maq1_${independentCanonicalHash("peas/market-acquisition-attempt/v1", preimage)}`,
  );
  return derived;
}

function marketAcquisitionJournalIdentity(request: Preflight): string {
  const preimage = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    requestIdentityHash: requestIdentity(request),
    providerId: request.providerId,
    datasetId: request.datasetId,
    feedId: request.feedId,
    endpointChannelId: request.endpointChannelId,
  } satisfies JsonValue;
  const derived = canonicalHash("peas/market-acquisition-journal/v1", preimage);
  assert.equal(derived, independentCanonicalHash("peas/market-acquisition-journal/v1", preimage));
  return derived;
}

function privateTokenHash(material: string): string {
  const preimage = { opaqueTokenMaterial: material } satisfies JsonValue;
  const derived = canonicalHash("peas/market-acquisition-private-token/v1", preimage);
  assert.equal(
    derived,
    independentCanonicalHash("peas/market-acquisition-private-token/v1", preimage),
  );
  return derived;
}

function continuationBindingHash(value: {
  precedingMarketAcquisitionId: string;
  requestIdentityHash: string;
  precedingLogicalPageIdentityHash: string;
  precedingPageOrdinal: number;
  precedingArtifactObservationId: string;
  precedingArtifactDigest: string;
  precedingPageChainHash: string;
  nextPageOrdinal: number;
  nextTokenHash: string;
}): string {
  const preimage = value as unknown as JsonValue;
  const derived = canonicalHash("peas/market-acquisition-continuation-binding/v1", preimage);
  assert.equal(
    derived,
    independentCanonicalHash("peas/market-acquisition-continuation-binding/v1", preimage),
  );
  return derived;
}

function continuationRequestForVerifiedPage(
  request: Preflight,
  preceding: DurableCheckpoint,
  opaqueMaterial: string,
  priorTokenHashes: readonly string[] = [],
): Preflight {
  const tokenHash = privateTokenHash(opaqueMaterial);
  if (
    preceding.checkpointKind !== "page-checkpointed" ||
    preceding.nextResumableTokenMaterial !== opaqueMaterial ||
    preceding.nextTokenHash !== tokenHash ||
    preceding.artifactObservationId === null ||
    preceding.artifactDigest === null
  ) {
    throw rejection("page-token-preceding-page-unverified");
  }
  const binding: ContinuationBindingPreimage = {
    precedingMarketAcquisitionId: preceding.marketAcquisitionId,
    requestIdentityHash: preceding.requestIdentityHash,
    precedingLogicalPageIdentityHash: preceding.logicalPageIdentityHash,
    precedingPageOrdinal: preceding.pageOrdinal,
    precedingArtifactObservationId: preceding.artifactObservationId as string,
    precedingArtifactDigest: preceding.artifactDigest as string,
    precedingPageChainHash: preceding.pageChainHash,
    nextPageOrdinal: preceding.pageOrdinal + 1,
    nextTokenHash: tokenHash,
  };
  return {
    ...request,
    fields: { ...request.fields, page_token: opaqueMaterial },
    pageOrdinal: binding.nextPageOrdinal,
    continuation: {
      opaqueMaterial,
      tokenHash,
      binding,
      bindingHash: continuationBindingHash(binding),
      priorTokenHashes: [...priorTokenHashes],
    },
  };
}

function admittedPageChainHash(priorPageChainHash: string, checkpoint: DurableCheckpoint): string {
  const preimage = {
    priorPageChainHash,
    marketAcquisitionId: checkpoint.marketAcquisitionId,
    requestIdentityHash: checkpoint.requestIdentityHash,
    logicalPageIdentityHash: checkpoint.logicalPageIdentityHash,
    pageOrdinal: checkpoint.pageOrdinal,
    artifactObservationId: checkpoint.artifactObservationId,
    artifactDigest: checkpoint.artifactDigest,
    artifactSizeBytes: checkpoint.artifactSizeBytes,
    artifactObservationHash: checkpoint.artifactObservationHash,
    artifactContentId: checkpoint.artifactContentId,
    rawArtifactId: checkpoint.rawArtifactId,
    currentTokenHash: checkpoint.pageOrdinal === 0 ? "no-token" : checkpoint.currentTokenHash,
    nextTokenHash: checkpoint.nextTokenHash,
    pageRecordCount: checkpoint.pageRecordCount,
    cumulativeSuccessfulPages: checkpoint.cumulativeSuccessfulPages,
    cumulativeVerifiedBytes: checkpoint.cumulativeVerifiedBytes,
    cumulativeRecords: checkpoint.cumulativeRecords,
    cumulativeNormalizedFacts: checkpoint.cumulativeNormalizedFacts,
    cumulativeAttempts: checkpoint.cumulativeAttempts,
  } satisfies JsonValue;
  const derived = canonicalHash("peas/market-acquisition-page-chain/v1", preimage);
  assert.equal(
    derived,
    independentCanonicalHash("peas/market-acquisition-page-chain/v1", preimage),
  );
  return derived;
}

function artifactIdentities(
  receipt: StoredReceipt,
  acquisitionObservationId: string,
): Readonly<{
  artifactObservationHash: string;
  artifactContentId: string;
  rawArtifactId: string;
}> {
  const artifactObservationHash = canonicalHash("peas/synthetic-artifact-observation/v1", {
    observationId: receipt.observationId,
    digest: receipt.digest,
    sizeBytes: receipt.bytes.byteLength,
  });
  const artifactContentId = deriveArtifactContentId({
    sha256: receipt.digest,
    sizeBytes: receipt.bytes.byteLength,
    mediaType: "application/x-peas-synthetic-glyph-page",
    contentEncoding: "identity",
  });
  const rawArtifactId = deriveRawArtifactId({
    artifactContentId,
    vaultObservationId: receipt.observationId,
    vaultObservationHash: artifactObservationHash,
    acquisitionObservationId,
    role: "private-market-reference-page",
  });
  return { artifactObservationHash, artifactContentId, rawArtifactId };
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
  runSessionNonce: string;
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
  currentContinuationBindingHash: string | null;
  nextContinuationBindingHash: string | null;
  attemptId: string;
  retrievalAttemptId: string;
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
  "runSessionNonce",
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
  "currentContinuationBindingHash",
  "nextContinuationBindingHash",
  "attemptId",
  "retrievalAttemptId",
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
  bindRequest(request: Preflight): void;
  append(event: ContractEvent, checkpoint: DurableCheckpoint): void;
  rows(): readonly JournalRow[];
  close(): void;
}

const PREDECESSORS: Readonly<Record<ContractEvent, readonly ContractEvent[]>> = {
  "acquisition.declared": ["request.started", "request.succeeded", "checkpoint.advanced"],
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
  "normalization.emitted": ["normalization.started", "normalization.emitted"],
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
  "attempt-started": [
    "acquisition-declared",
    "attempt-started",
    "request-succeeded",
    "stopped",
    "failed-clean",
  ],
  "request-succeeded": [
    "acquisition-declared",
    "attempt-started",
    "artifact-committed",
    "stopped",
    "failed-clean",
  ],
  "artifact-committed": ["artifact-verified", "stopped", "failed-clean", "quarantined"],
  "artifact-verified": ["page-checkpointed", "stopped", "failed-clean", "quarantined"],
  "page-checkpointed": [
    "acquisition-declared",
    "attempt-started",
    "chain-complete",
    "stopped",
    "failed-clean",
  ],
  "chain-complete": ["normalization-started", "stopped", "failed-clean", "quarantined"],
  "normalization-started": ["normalization-complete", "stopped", "failed-clean", "quarantined"],
  "normalization-complete": [
    "normalization-complete",
    "selection-started",
    "stopped",
    "failed-clean",
    "quarantined",
  ],
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

function journalEntryBody(checkpoint: DurableCheckpoint): JsonValue {
  const {
    checkpointKind: _checkpointKind,
    journalEntryHash: _journalEntryHash,
    journalSequence: _journalSequence,
    marketAcquisitionJournalId: _marketAcquisitionJournalId,
    priorJournalEntryHash: _priorJournalEntryHash,
    ...body
  } = checkpoint;
  return body as unknown as JsonValue;
}

function deriveJournalEntryHash(checkpoint: DurableCheckpoint): string {
  const preimage = {
    marketAcquisitionJournalId: checkpoint.marketAcquisitionJournalId,
    journalSequence: checkpoint.journalSequence,
    priorJournalEntryHash: checkpoint.priorJournalEntryHash,
    entryKind: checkpoint.checkpointKind,
    canonicalEntryBody: canonicalJson(journalEntryBody(checkpoint)),
  } satisfies JsonValue;
  const derived = canonicalHash("peas/market-acquisition-journal-entry/v1", preimage);
  assert.equal(
    derived,
    independentCanonicalHash("peas/market-acquisition-journal-entry/v1", preimage),
  );
  return derived;
}

function ledgerFactId(
  event: ContractEvent,
  sequence: number,
  checkpoint: DurableCheckpoint,
): string | null {
  if (
    [
      "checkpoint.advanced",
      "chain.complete",
      "normalization.started",
      "selection.started",
    ].includes(event)
  ) {
    return null;
  }
  return `ole1_${canonicalHash("peas/p1-10-synthetic-ledger-fact/v1", {
    event,
    sequence,
    marketAcquisitionId: checkpoint.marketAcquisitionId,
    artifactObservationId: checkpoint.artifactObservationId,
  })}`;
}

function exactCausalParents(
  rows: readonly JournalRow[],
  event: ContractEvent,
  checkpoint: DurableCheckpoint,
): readonly string[] {
  const matchingFact = (
    candidateEvent: ContractEvent,
    predicate: (row: JournalRow) => boolean = () => true,
  ): string => {
    const row = [...rows]
      .reverse()
      .find(
        (candidate) =>
          candidate.event === candidateEvent &&
          candidate.checkpoint.stageLedgerFactId !== null &&
          predicate(candidate),
      );
    if (
      row?.checkpoint.stageLedgerFactId === null ||
      row?.checkpoint.stageLedgerFactId === undefined
    ) {
      throw rejection("causal-parent-missing");
    }
    return row.checkpoint.stageLedgerFactId;
  };
  const sameAttempt = (row: JournalRow): boolean =>
    row.checkpoint.marketAcquisitionId === checkpoint.marketAcquisitionId;
  const sameArtifact = (row: JournalRow): boolean =>
    row.checkpoint.artifactObservationId === checkpoint.artifactObservationId;
  switch (event) {
    case "acquisition.declared":
      return [];
    case "request.started":
      return [matchingFact("acquisition.declared", sameAttempt)];
    case "request.succeeded":
      return [matchingFact("request.started", sameAttempt)];
    case "artifact.committed":
      return [
        matchingFact("acquisition.declared", sameAttempt),
        matchingFact("request.succeeded", sameAttempt),
      ].sort();
    case "artifact.verified":
      return [matchingFact("artifact.committed", (row) => sameAttempt(row) && sameArtifact(row))];
    case "normalization.emitted":
      return [matchingFact("artifact.verified", sameArtifact)];
    case "selection.recorded": {
      const normalization = [...rows]
        .reverse()
        .find(
          (row) =>
            row.event === "normalization.emitted" && row.checkpoint.stageLedgerFactId !== null,
        );
      if (
        normalization?.checkpoint.stageLedgerFactId === null ||
        normalization?.checkpoint.stageLedgerFactId === undefined
      ) {
        throw rejection("causal-parent-missing");
      }
      const verified = matchingFact(
        "artifact.verified",
        (row) =>
          row.checkpoint.artifactObservationId === normalization.checkpoint.artifactObservationId,
      );
      return [normalization.checkpoint.stageLedgerFactId, verified].sort();
    }
    case "failure.recorded": {
      const lastFact = [...rows].reverse().find((row) => row.checkpoint.stageLedgerFactId !== null)
        ?.checkpoint.stageLedgerFactId;
      return lastFact === undefined || lastFact === null ? [] : [lastFact];
    }
    default:
      return [];
  }
}

function finalizeCheckpoint(
  rows: readonly JournalRow[],
  event: ContractEvent,
  checkpoint: DurableCheckpoint,
): DurableCheckpoint {
  const prior = rows.at(-1)?.checkpoint;
  const journalSequence = rows.length;
  const stageLedgerFactId = ledgerFactId(event, journalSequence, checkpoint);
  const finalized = {
    ...checkpoint,
    checkpointKind: checkpointKindForEvent(event),
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
          ? (checkpoint.terminalReasonCode ?? "terminal-failure")
          : checkpoint.terminalReasonCode,
    incomplete:
      event === "selection.recorded" || event === "failure.recorded"
        ? false
        : checkpoint.incomplete,
    stageLedgerFactId,
    causalParentFactIds: exactCausalParents(rows, event, checkpoint),
    priorJournalEntryHash: prior?.journalEntryHash ?? "genesis",
    journalSequence,
    journalEntryHash: "",
  } satisfies DurableCheckpoint;
  validateCheckpointKindTransition(prior?.checkpointKind ?? null, finalized.checkpointKind);
  return { ...finalized, journalEntryHash: deriveJournalEntryHash(finalized) };
}

function validateExactCheckpoint(
  checkpoint: DurableCheckpoint,
  expectedRequest: Preflight = exactBoundaryRequest(0n),
): void {
  if (Object.keys(checkpoint).sort().join(",") !== [...CHECKPOINT_KEYS].sort().join(",")) {
    throw rejection("checkpoint-shape-invalid");
  }
  if (deriveJournalEntryHash(checkpoint) !== checkpoint.journalEntryHash) {
    throw rejection("checkpoint-hash-invalid");
  }
  const expectedAttempt = attemptIdentity(
    checkpoint.logicalPageIdentityHash,
    checkpoint.attemptOrdinal,
  );
  const expectedAcquisitionObservationId = acquisitionObservationIdentity(
    expectedRequest,
    expectedAttempt.retrievalAttemptId,
  );
  if (
    checkpoint.requestIdentityHash !== requestIdentity(expectedRequest) ||
    checkpoint.acquisitionConfigurationHash !== configurationHash(expectedRequest) ||
    checkpoint.marketAcquisitionJournalId !== marketAcquisitionJournalIdentity(expectedRequest) ||
    checkpoint.logicalPageIdentityHash !==
      logicalPageIdentityHash(
        checkpoint.requestIdentityHash,
        checkpoint.pageOrdinal,
        checkpoint.pageOrdinal === 0 ? null : checkpoint.currentTokenHash,
      ) ||
    checkpoint.runSessionNonce !== RUN_SESSION_NONCE ||
    checkpoint.attemptId !== expectedAttempt.attemptId ||
    checkpoint.retrievalAttemptId !== expectedAttempt.retrievalAttemptId ||
    checkpoint.acquisitionObservationId !== expectedAcquisitionObservationId ||
    checkpoint.marketAcquisitionId !==
      marketAcquisitionIdentity(expectedRequest, expectedAcquisitionObservationId) ||
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
      ? checkpoint.currentTokenHash !== "no-token" ||
        checkpoint.currentResumableTokenMaterial !== null ||
        checkpoint.currentContinuationBindingHash !== null
      : checkpoint.currentResumableTokenMaterial === null ||
        checkpoint.currentTokenHash !==
          privateTokenHash(checkpoint.currentResumableTokenMaterial) ||
        checkpoint.currentContinuationBindingHash === null
  ) {
    throw rejection("checkpoint-current-token-invalid");
  }
  const verifiedPageKinds: readonly CheckpointKind[] = [
    "artifact-verified",
    "page-checkpointed",
    "chain-complete",
    "normalization-started",
    "normalization-complete",
    "selection-started",
    "completed",
  ];
  const requiresVerifiedToken = verifiedPageKinds.includes(checkpoint.checkpointKind);
  const nextTokenRelationValid =
    checkpoint.nextTokenHash === null
      ? checkpoint.nextResumableTokenMaterial === null
      : checkpoint.nextTokenHash === "terminal"
        ? checkpoint.nextResumableTokenMaterial === null
        : checkpoint.nextResumableTokenMaterial !== null &&
          checkpoint.nextTokenHash === privateTokenHash(checkpoint.nextResumableTokenMaterial);
  if (
    !nextTokenRelationValid ||
    (requiresVerifiedToken && checkpoint.nextTokenHash === null) ||
    (checkpoint.checkpointKind === "chain-complete" && checkpoint.nextTokenHash !== "terminal")
  ) {
    throw rejection("checkpoint-next-token-invalid");
  }
  if (
    checkpoint.nextTokenHash === null || checkpoint.nextTokenHash === "terminal"
      ? checkpoint.nextContinuationBindingHash !== null
      : checkpoint.cumulativeSuccessfulPages > checkpoint.pageOrdinal
        ? checkpoint.nextContinuationBindingHash === null
        : checkpoint.nextContinuationBindingHash !== null
  ) {
    throw rejection("checkpoint-continuation-binding-invalid");
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
      artifactIdentities(
        {
          observationId: checkpoint.artifactObservationId as string,
          digest: checkpoint.artifactDigest as string,
          bytes: new Uint8Array(checkpoint.artifactSizeBytes as number),
          deliveryOrdinal: checkpoint.pageOrdinal,
        },
        checkpoint.acquisitionObservationId,
      ).artifactObservationHash ||
      checkpoint.artifactContentId !==
        artifactIdentities(
          {
            observationId: checkpoint.artifactObservationId as string,
            digest: checkpoint.artifactDigest as string,
            bytes: new Uint8Array(checkpoint.artifactSizeBytes as number),
            deliveryOrdinal: checkpoint.pageOrdinal,
          },
          checkpoint.acquisitionObservationId,
        ).artifactContentId ||
      checkpoint.rawArtifactId !==
        artifactIdentities(
          {
            observationId: checkpoint.artifactObservationId as string,
            digest: checkpoint.artifactDigest as string,
            bytes: new Uint8Array(checkpoint.artifactSizeBytes as number),
            deliveryOrdinal: checkpoint.pageOrdinal,
          },
          checkpoint.acquisitionObservationId,
        ).rawArtifactId)
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
    (checkpoint.stageLedgerFactId !== null &&
      !/^ole1_[0-9a-f]{64}$/u.test(checkpoint.stageLedgerFactId)) ||
    checkpoint.causalParentFactIds.some((id) => !/^ole1_[0-9a-f]{64}$/u.test(id)) ||
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
    new Set(checkpoint.admittedMarketAcquisitionIds).size !==
      checkpoint.admittedMarketAcquisitionIds.length ||
    (checkpoint.checkpointKind === "page-checkpointed" &&
      checkpoint.admittedMarketAcquisitionIds.at(-1) !== checkpoint.marketAcquisitionId)
  ) {
    throw rejection("checkpoint-admission-invalid");
  }
  if (prior !== null) {
    const shouldAdvance = checkpoint.checkpointKind === "page-checkpointed";
    if (
      shouldAdvance
        ? checkpoint.pageChainHash !== admittedPageChainHash(prior.pageChainHash, checkpoint)
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

function validateJournalRows(
  rows: readonly JournalRow[],
  expectedRequest: Preflight = exactBoundaryRequest(0n),
): void {
  let expectedPages = 0;
  let expectedBytes = 0;
  let expectedRecords = 0;
  let expectedFacts = 0;
  let expectedAttempts = 0;
  const admittedArtifactObservations = new Set<string>();
  for (const [index, row] of rows.entries()) {
    validateExactCheckpoint(row.checkpoint, expectedRequest);
    validateCheckpointSemantics(row.checkpoint, rows[index - 1]?.checkpoint ?? null);
    if (row.checkpoint.pageOrdinal > 0) {
      const preceding = [...rows.slice(0, index)]
        .reverse()
        .find(
          (candidate) =>
            candidate.event === "checkpoint.advanced" &&
            candidate.checkpoint.pageOrdinal === row.checkpoint.pageOrdinal - 1,
        )?.checkpoint;
      if (
        preceding === undefined ||
        row.checkpoint.currentTokenHash !== preceding.nextTokenHash ||
        row.checkpoint.currentResumableTokenMaterial !== preceding.nextResumableTokenMaterial ||
        row.checkpoint.currentContinuationBindingHash !== preceding.nextContinuationBindingHash
      ) {
        throw rejection("checkpoint-continuation-predecessor-invalid");
      }
    }
    if (
      row.sequence !== index ||
      row.checkpoint.journalSequence !== index ||
      row.checkpoint.priorJournalEntryHash !==
        (rows[index - 1]?.checkpoint.journalEntryHash ?? "genesis")
    ) {
      throw rejection("checkpoint-sequence-invalid");
    }
    assert.deepEqual(
      row.checkpoint.causalParentFactIds,
      exactCausalParents(rows.slice(0, index), row.event, row.checkpoint),
    );
    if (row.event === "request.started") expectedAttempts += 1;
    if (row.event === "checkpoint.advanced") {
      if (row.checkpoint.pageOrdinal !== expectedPages) {
        throw rejection("checkpoint-page-position-invalid");
      }
      const expectedNextBinding =
        row.checkpoint.nextTokenHash === "terminal"
          ? null
          : continuationBindingHash({
              precedingMarketAcquisitionId: row.checkpoint.marketAcquisitionId,
              requestIdentityHash: row.checkpoint.requestIdentityHash,
              precedingLogicalPageIdentityHash: row.checkpoint.logicalPageIdentityHash,
              precedingPageOrdinal: row.checkpoint.pageOrdinal,
              precedingArtifactObservationId: row.checkpoint.artifactObservationId as string,
              precedingArtifactDigest: row.checkpoint.artifactDigest as string,
              precedingPageChainHash: row.checkpoint.pageChainHash,
              nextPageOrdinal: row.checkpoint.pageOrdinal + 1,
              nextTokenHash: row.checkpoint.nextTokenHash as string,
            });
      if (row.checkpoint.nextContinuationBindingHash !== expectedNextBinding) {
        throw rejection("checkpoint-next-continuation-binding-invalid");
      }
      if (
        row.checkpoint.artifactObservationId === null ||
        admittedArtifactObservations.has(row.checkpoint.artifactObservationId)
      ) {
        throw rejection("checkpoint-duplicate-page-invalid");
      }
      admittedArtifactObservations.add(row.checkpoint.artifactObservationId);
      expectedBytes += row.checkpoint.artifactSizeBytes ?? 0;
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
  #expectedRequest = exactBoundaryRequest(0n);

  bindRequest(request: Preflight): void {
    this.#expectedRequest = request;
    if (this.#rows.length > 0) validateJournalRows(this.#rows, request);
  }

  append(event: ContractEvent, checkpoint: DurableCheckpoint): void {
    validateJournalAppend(this.#rows, event);
    const finalized = finalizeCheckpoint(this.#rows, event, checkpoint);
    const prospective = [
      ...this.#rows,
      { sequence: this.#rows.length, event, checkpoint: finalized },
    ];
    validateJournalRows(prospective, this.#expectedRequest);
    this.#rows.push(prospective.at(-1) as JournalRow);
  }

  rows(): readonly JournalRow[] {
    return structuredClone(this.#rows);
  }

  close(): void {}
}

class SqliteContractJournal implements ContractJournal {
  readonly #database: Database.Database;
  readonly #enumerationPageSize: number;
  readonly #enumerationDirection: "asc" | "desc";
  #expectedRequest = exactBoundaryRequest(0n);

  constructor(
    filename: string,
    enumerationPageSize = 10_000,
    enumerationDirection: "asc" | "desc" = "asc",
  ) {
    if (!Number.isSafeInteger(enumerationPageSize) || enumerationPageSize < 1) {
      throw rejection("sqlite-enumeration-page-size");
    }
    this.#enumerationPageSize = enumerationPageSize;
    this.#enumerationDirection = enumerationDirection;
    this.#database = new Database(filename);
    this.#database.pragma("foreign_keys = ON");
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("synchronous = FULL");
    this.#database.exec(
      "CREATE TABLE IF NOT EXISTS acquisition_journal (" +
        "sequence INTEGER PRIMARY KEY, event TEXT NOT NULL, checkpoint_json TEXT NOT NULL)",
    );
  }

  bindRequest(request: Preflight): void {
    this.#expectedRequest = request;
    if (this.rows().length > 0) validateJournalRows(this.rows(), request);
  }

  append(event: ContractEvent, checkpoint: DurableCheckpoint): void {
    const rows = this.rows();
    validateJournalAppend(rows, event);
    const finalized = finalizeCheckpoint(rows, event, checkpoint);
    validateJournalRows(
      [...rows, { sequence: rows.length, event, checkpoint: finalized }],
      this.#expectedRequest,
    );
    this.#database
      .prepare(
        "INSERT INTO acquisition_journal (sequence, event, checkpoint_json) VALUES (?, ?, ?)",
      )
      .run(rows.length, event, canonicalJson(finalized as unknown as JsonValue));
  }

  rows(): readonly JournalRow[] {
    const enumerated: { sequence: number; event: ContractEvent; checkpointJson: string }[] = [];
    for (let offset = 0; ; offset += this.#enumerationPageSize) {
      const batch = this.#database
        .prepare(
          "SELECT sequence, event, checkpoint_json AS checkpointJson " +
            `FROM acquisition_journal ORDER BY sequence ${this.#enumerationDirection.toUpperCase()} ` +
            "LIMIT ? OFFSET ?",
        )
        .all(this.#enumerationPageSize, offset) as {
        sequence: number;
        event: ContractEvent;
        checkpointJson: string;
      }[];
      enumerated.push(...batch);
      if (batch.length < this.#enumerationPageSize) break;
    }
    const rows = enumerated
      .sort((left, right) => left.sequence - right.sequence)
      .map((row) => ({
        sequence: row.sequence,
        event: row.event,
        checkpoint: JSON.parse(row.checkpointJson) as DurableCheckpoint,
      }));
    validateJournalRows(rows, this.#expectedRequest);
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

  canAdmit(nowMs: number): boolean {
    const cutoff = nowMs - LIMITS.rateWindowMs;
    const active = this.#attempts.filter((attempt) => attempt > cutoff);
    return active.length < Math.min(this.projectLimit, this.entitlementLimit);
  }

  commitAdmit(nowMs: number): void {
    if (!this.canAdmit(nowMs)) throw rejection("quota-bound");
    this.commitVerified(nowMs);
  }

  commitVerified(nowMs: number): void {
    const cutoff = nowMs - LIMITS.rateWindowMs;
    while ((this.#attempts[0] ?? Number.POSITIVE_INFINITY) <= cutoff) this.#attempts.shift();
    this.#attempts.push(nowMs);
  }

  admit(nowMs: number): boolean {
    if (!this.canAdmit(nowMs)) return false;
    this.commitAdmit(nowMs);
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
  readonly requestsByPage = new Map<number, number>();
  readonly #order: readonly string[];
  readonly #pages: readonly Readonly<{
    glyphs: readonly string[];
    nextToken: string | null;
  }>[];

  constructor(
    order: readonly string[] = ["amber", "cobalt", "fern"],
    continuationTokens: readonly [string, string] = [
      "synthetic-private-continuation-one",
      "synthetic-private-continuation-two",
    ],
  ) {
    this.#order = [...order];
    this.#pages = Object.freeze([
      { glyphs: ["amber", "cobalt", "fern"], nextToken: continuationTokens[0] },
      { glyphs: ["amber", "cobalt", "fern"], nextToken: continuationTokens[1] },
      { glyphs: ["lilac", "umber"], nextToken: null },
    ]);
    this.resources = this.#newResources(0);
  }

  #newResources(pageOrdinal: number): BodyResourceDouble[] {
    const page = this.#pages[pageOrdinal];
    if (page === undefined) throw rejection("provider-page-after-terminal");
    const rank = new Map(this.#order.map((glyph, index) => [glyph, index]));
    return [...page.glyphs]
      .sort(
        (left, right) =>
          (rank.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
      )
      .map((glyph) => new BodyResourceDouble(glyph));
  }

  pageCount(): number {
    return this.#pages.length;
  }

  nextToken(pageOrdinal: number): string | null {
    return this.#pages[pageOrdinal]?.nextToken ?? null;
  }

  recordCount(pageOrdinal: number): number {
    const page = this.#pages[pageOrdinal];
    if (page === undefined) throw rejection("provider-page-after-terminal");
    return page.glyphs.length;
  }

  async response(
    failAt: number | null = null,
    afterRead?: (index: number) => void,
    pageOrdinal = 0,
  ): Promise<Uint8Array> {
    this.resources = this.#newResources(pageOrdinal);
    this.requestCalls += 1;
    this.requestsByPage.set(pageOrdinal, (this.requestsByPage.get(pageOrdinal) ?? 0) + 1);
    const chunks: Uint8Array[] = [];
    try {
      for (const [index, resource] of this.resources.entries()) {
        if (failAt === index) throw rejection("body-failure");
        chunks.push(await resource.read());
        afterRead?.(index);
      }
      return Buffer.concat(
        chunks.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
      );
    } catch (error) {
      for (const resource of this.resources) resource.abortDestroy();
      await Promise.allSettled(this.resources.map((resource) => resource.read()));
      throw error;
    }
  }
}

type ActiveClockFault =
  | "wall-regression"
  | "monotonic-regression"
  | "changed-basis"
  | "wrong-synchronization"
  | "absent-error"
  | "unbounded-error";
type MutableTrustedClockSample = {
  sampleId: string;
  previousSampleId: string | null;
  basisId: string;
  wallClock: string;
  synchronization: string;
  wallNs: bigint;
  monotonicClock: string;
  monotonicSessionId: string;
  monotonicUs: bigint;
};
type MutableTrustedClockEvidence = {
  available: boolean;
  basisId: string;
  wallClock: string;
  synchronization: string;
  maximumErrorNs: bigint | null;
  maximumErrorBounded: boolean;
  monotonicClock: string;
  monotonicSessionId: string;
  priorSample: MutableTrustedClockSample;
  currentSample: MutableTrustedClockSample;
};

class ActiveClockBasisDouble {
  readonly evidence: MutableTrustedClockEvidence;
  readonly requestAuthority: Readonly<{
    basisId: string;
    wallClock: string;
    synchronization: string;
    maximumErrorNs: bigint;
    monotonicClock: string;
    monotonicSessionId: string;
    currentSampleId: string;
    currentWallNs: bigint;
    currentMonotonicUs: bigint;
  }>;
  #sampleOrdinal = 1;

  constructor(requestEvidence: unknown) {
    validateTrustedClockEvidence(requestEvidence);
    const snapshot = structuredClone(requestEvidence) as MutableTrustedClockEvidence;
    const admittedCurrent = { ...snapshot.currentSample };
    this.requestAuthority = Object.freeze({
      basisId: snapshot.basisId,
      wallClock: snapshot.wallClock,
      synchronization: snapshot.synchronization,
      maximumErrorNs: snapshot.maximumErrorNs as bigint,
      monotonicClock: snapshot.monotonicClock,
      monotonicSessionId: snapshot.monotonicSessionId,
      currentSampleId: admittedCurrent.sampleId,
      currentWallNs: admittedCurrent.wallNs,
      currentMonotonicUs: admittedCurrent.monotonicUs,
    });
    this.evidence = {
      ...snapshot,
      priorSample: { ...admittedCurrent, previousSampleId: null },
      currentSample: {
        ...admittedCurrent,
        sampleId: "clock-sample-active-1",
        previousSampleId: admittedCurrent.sampleId,
        wallNs: admittedCurrent.wallNs + 1n,
        monotonicUs: admittedCurrent.monotonicUs + 1n,
      },
    };
    validateTrustedClockEvidence(this.evidence);
  }

  validateAndAdvance(): void {
    validateTrustedClockEvidence(this.evidence);
    const prior = { ...this.evidence.currentSample, previousSampleId: null };
    this.#sampleOrdinal += 1;
    this.evidence.priorSample = prior;
    this.evidence.currentSample = {
      ...prior,
      sampleId: `clock-sample-active-${this.#sampleOrdinal}`,
      previousSampleId: prior.sampleId,
      wallNs: prior.wallNs + 1n,
      monotonicUs: prior.monotonicUs + 1n,
    };
  }

  inject(fault: ActiveClockFault): void {
    switch (fault) {
      case "wall-regression":
        this.evidence.currentSample.wallNs = this.evidence.priorSample.wallNs - 1n;
        break;
      case "monotonic-regression":
        this.evidence.currentSample.monotonicUs = this.evidence.priorSample.monotonicUs - 1n;
        break;
      case "changed-basis":
        this.evidence.currentSample.basisId = "synthetic-system-utc-basis-changed";
        break;
      case "wrong-synchronization":
        this.evidence.synchronization = "unverified";
        break;
      case "absent-error":
        this.evidence.maximumErrorNs = null;
        break;
      case "unbounded-error":
        this.evidence.maximumErrorBounded = false;
        break;
    }
  }
}

type StoredReceipt = Readonly<{
  observationId: string;
  digest: string;
  bytes: Uint8Array;
  deliveryOrdinal: number;
}>;

class ArtifactDouble {
  readonly #observations = new Map<string, StoredReceipt>();
  readonly #physicalBytes = new Map<string, Uint8Array>();
  readonly #observationOrder: string[] = [];
  storeCalls = 0;
  readCalls = 0;
  failStore = false;
  failRead = false;
  readonly orphanDigests: string[] = [];
  orphanReconciliations = 0;

  get receipt(): StoredReceipt | null {
    const observationId = this.#observationOrder.at(-1);
    return observationId === undefined ? null : (this.#observations.get(observationId) ?? null);
  }

  get receipts(): readonly StoredReceipt[] {
    return this.#observationOrder
      .map((id) => {
        const receipt = this.#observations.get(id);
        if (receipt === undefined) throw rejection("artifact-observation-missing");
        return {
          ...receipt,
          bytes: Uint8Array.from(this.#physicalBytes.get(receipt.digest) ?? receipt.bytes),
        };
      })
      .sort((left, right) => left.deliveryOrdinal - right.deliveryOrdinal);
  }

  store(bytes: Uint8Array): StoredReceipt {
    this.storeCalls += 1;
    if (this.failStore) throw rejection("artifact-store-failure");
    const digest = hash(Buffer.from(bytes).toString("hex"));
    const deliveryOrdinal = this.#observationOrder.length;
    const receipt = {
      observationId: `vault-observation-${canonicalHash("peas/synthetic-delivery-observation/v1", {
        digest,
        deliveryOrdinal,
      })}`,
      digest,
      bytes: Uint8Array.from(bytes),
      deliveryOrdinal,
    } satisfies StoredReceipt;
    this.#physicalBytes.set(digest, Uint8Array.from(bytes));
    this.#observations.set(receipt.observationId, receipt);
    this.#observationOrder.push(receipt.observationId);
    this.orphanDigests.push(receipt.digest);
    return receipt;
  }

  acknowledgeReceipt(receipt: StoredReceipt): void {
    const index = this.orphanDigests.indexOf(receipt.digest);
    if (index >= 0) this.orphanDigests.splice(index, 1);
  }

  restore(receipt: StoredReceipt): void {
    const actualDigest = hash(Buffer.from(receipt.bytes).toString("hex"));
    if (actualDigest !== receipt.digest) throw rejection("artifact-digest-mismatch");
    this.#physicalBytes.set(receipt.digest, Uint8Array.from(receipt.bytes));
    this.#observations.set(receipt.observationId, {
      ...receipt,
      bytes: Uint8Array.from(receipt.bytes),
    });
    if (!this.#observationOrder.includes(receipt.observationId)) {
      this.#observationOrder.push(receipt.observationId);
    }
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

  readObservation(observationId: string, digest: string): Uint8Array {
    this.readCalls += 1;
    if (this.failRead) throw rejection("artifact-read-failure");
    const receipt = this.#observations.get(observationId);
    const bytes = this.#physicalBytes.get(digest);
    if (receipt === undefined || receipt.digest !== digest || bytes === undefined) {
      throw rejection("artifact-missing");
    }
    if (hash(Buffer.from(bytes).toString("hex")) !== digest) {
      throw rejection("artifact-digest-mismatch");
    }
    return Uint8Array.from(bytes);
  }

  enumerateObservations(
    pageSize: number,
    direction: "asc" | "desc" = "asc",
  ): readonly StoredReceipt[] {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw rejection("artifact-enumeration-page-size");
    }
    const ordered = [...this.receipts].sort((left, right) =>
      direction === "asc"
        ? left.deliveryOrdinal - right.deliveryOrdinal
        : right.deliveryOrdinal - left.deliveryOrdinal,
    );
    const enumerated: StoredReceipt[] = [];
    for (let offset = 0; offset < ordered.length; offset += pageSize) {
      enumerated.push(...ordered.slice(offset, offset + pageSize));
    }
    return enumerated;
  }

  read(digest: string): Uint8Array {
    const receipt = this.receipts.find((candidate) => candidate.digest === digest);
    if (receipt === undefined) throw rejection("artifact-missing");
    return this.readObservation(receipt.observationId, digest);
  }
}

function normalizedFactsFromReceipt(receipt: StoredReceipt): readonly string[] {
  return (
    Buffer.from(receipt.bytes)
      .toString("utf8")
      .match(/amber|cobalt|fern|lilac|umber/gu) ?? []
  ).sort();
}

function normalizedFactsFromArtifact(artifact: ArtifactDouble): readonly string[] {
  const members = artifact.receipts.flatMap(normalizedFactsFromReceipt);
  if (members.length === 0) throw rejection("schema-failure");
  return [...new Set(members)].sort();
}

function normalizedDigestFromArtifact(artifact: ArtifactDouble): string {
  return hash(normalizedFactsFromArtifact(artifact).join("|"));
}

type AcquisitionFault = Readonly<{
  timeoutBeforeHeaders?: boolean;
  bodyFailureAt?: number;
  activeClockFault?: ActiveClockFault;
  schemaFailure?: boolean;
  storeFailure?: boolean;
  readFailure?: boolean;
  continuationMutation?: (request: Preflight) => Preflight;
  paginationFault?:
    | "loop"
    | "substitution"
    | "gap"
    | "duplicate-position"
    | "duplicate-page"
    | "page-after-terminal";
  crashAt?: string;
}>;

const ACQUISITION_EVENT_TARGETS = Object.freeze({
  "begin-preflight": "preflighting",
  "preflight-approved": "dispatch-ready",
  "credentials-loaded": "credential-ready",
  "dispatch-started": "attempt-active",
  "response-headers-accepted": "response-accepted",
  "artifact-store-started": "artifact-committing",
  "artifact-store-committed": "artifact-committed",
  "artifact-verification-started": "artifact-verifying",
  "page-verification-passed": "page-verified",
  "page-checkpoint-committed": "checkpointing",
  "retry-cleanup-complete": "waiting-retry",
  "terminal-token-admitted": "chain-complete",
  "normalization-started": "normalizing",
  "normalization-page-emitted": "normalizing",
  "normalization-completed": "ready-for-selection",
  "selection-started": "selecting",
  "selection-completed": "completed",
  "policy-stopped": "stopped",
  "technical-failure-settled": "failed-clean",
  "evidence-quarantined": "quarantined",
} as const);
type AcquisitionEventName = keyof typeof ACQUISITION_EVENT_TARGETS;
type AcquisitionEventEvidence = Readonly<{
  schemaVersion: 1;
  requestIdentityHash: string;
  acquisitionConfigurationHash: string;
  marketAcquisitionJournalId: string;
  runSessionNonce: string;
  cumulativeAttempts: number;
  cumulativeSuccessfulPages: number;
  cumulativeVerifiedBytes: number;
  cumulativeRecords: number;
  cumulativeNormalizedFacts: number;
  attemptElapsedMs: number;
  acquisitionElapsedMs: number;
  quotaWindowEvidence: readonly number[];
  resourcesSettled: boolean;
  tokenRelationValid: boolean;
  pageChainValid: boolean;
  retryDelayClockBasis: string | null;
  retryDelayElapsedMs: number | null;
  retryDelayMonotonicOrderValid: boolean | null;
  retryContext: RetryEventContext | null;
  retryDecision: RetryDecision | null;
}>;
type AcquisitionMutationPlan = Readonly<{
  journalEvent?: ContractEvent;
  budgetDelta?: Partial<AcquisitionBudgets>;
  attemptTime?: number;
  pageOrdinal?: number;
  currentAttemptOrdinal?: number;
  currentTokenMaterial?: string | null;
  nextTokenMaterial?: string | null;
  currentContinuationBindingHash?: string | null;
  nextContinuationBindingHash?: string | null;
  currentReceipt?: StoredReceipt | null;
  pageTokenVerified?: boolean;
  pageRecordCount?: number | null;
  pageChainHash?: string;
  appendAdmittedMarketAcquisitionId?: string;
  normalizedFacts?: readonly string[];
  pendingRetryDelayMs?: number | null;
  selectionDigest?: string | null;
  counterDelta?: Partial<SideEffectCounters>;
  checkpointOverrides?: Partial<DurableCheckpoint>;
}>;

type MutableCoordinatorSnapshot = Readonly<{
  state: AcquisitionState;
  budget: AcquisitionBudgets;
  currentPageOrdinal: number;
  currentAttemptOrdinal: number;
  currentTokenMaterial: string | null;
  nextTokenMaterial: string | null;
  currentContinuationBindingHash: string | null;
  nextContinuationBindingHash: string | null;
  currentReceipt: StoredReceipt | null;
  pageTokenVerified: boolean;
  pageRecordCount: number | null;
  pageChainHash: string;
  admittedMarketAcquisitionIds: string[];
  attemptTimes: number[];
  normalizedFacts: readonly string[];
  pendingRetryDelayMs: number | null;
  selectionDigest: string | null;
  counters: SideEffectCounters;
}>;

class AcquisitionContractModel {
  readonly counters = zeroCounters();
  readonly budget = new ContractBudget();
  readonly activeClock: ActiveClockBasisDouble;
  readonly quota: RollingQuota;
  currentState: AcquisitionState;
  currentPageOrdinal = 0;
  currentTokenMaterial: string | null = null;
  nextTokenMaterial: string | null = null;
  currentContinuationBindingHash: string | null = null;
  nextContinuationBindingHash: string | null = null;
  currentAttemptOrdinal = 0;
  currentReceipt: StoredReceipt | null = null;
  pageTokenVerified = false;
  pageRecordCount: number | null = null;
  pageChainHash = "genesis";
  admittedMarketAcquisitionIds: string[] = [];
  attemptTimes: number[] = [];
  normalizedFacts: readonly string[] = [];
  pendingRetryDelayMs: number | null = null;
  selectionDigest: string | null = null;

  constructor(
    readonly request: Preflight,
    readonly provider: ProviderDouble,
    readonly artifact: ArtifactDouble,
    readonly journal: ContractJournal,
    initialState: AcquisitionState = "declared",
    quotaEntitlementLimit: number = LIMITS.rateAttempts,
  ) {
    this.currentState = initialState;
    this.quota = new RollingQuota(LIMITS.rateAttempts, quotaEntitlementLimit);
    this.activeClock = new ActiveClockBasisDouble(request.trustedClockEvidence);
    this.journal.bindRequest(request);
  }

  exactEventEvidence(
    retryContext: RetryEventContext | null = null,
    overrides: Partial<AcquisitionEventEvidence> = {},
  ): AcquisitionEventEvidence {
    return {
      schemaVersion: 1,
      requestIdentityHash: requestIdentity(this.request),
      acquisitionConfigurationHash: configurationHash(this.request),
      marketAcquisitionJournalId: marketAcquisitionJournalIdentity(this.request),
      runSessionNonce: RUN_SESSION_NONCE,
      cumulativeAttempts: this.budget.value.attempts,
      cumulativeSuccessfulPages: this.budget.value.pages,
      cumulativeVerifiedBytes: this.budget.value.bytes,
      cumulativeRecords: this.budget.value.records,
      cumulativeNormalizedFacts: this.budget.value.facts,
      attemptElapsedMs: 0,
      acquisitionElapsedMs: this.budget.value.attempts * 1_000,
      quotaWindowEvidence: [...this.attemptTimes],
      resourcesSettled: this.provider.resources.every((resource) => resource.pending === 0),
      tokenRelationValid:
        this.currentPageOrdinal === 0
          ? this.currentTokenMaterial === null && this.currentContinuationBindingHash === null
          : this.currentTokenMaterial !== null && this.currentContinuationBindingHash !== null,
      pageChainValid:
        this.pageChainHash === "genesis" || /^[0-9a-f]{64}$/u.test(this.pageChainHash),
      retryDelayClockBasis: null,
      retryDelayElapsedMs: null,
      retryDelayMonotonicOrderValid: null,
      retryContext,
      retryDecision: retryContext === null ? null : retryEventDecision(retryContext),
      ...overrides,
    };
  }

  applyAcquisitionEvent(
    event: AcquisitionEventName,
    evidence: AcquisitionEventEvidence = this.exactEventEvidence(),
    plan: AcquisitionMutationPlan = {},
  ): void {
    const exactKeys = [
      "acquisitionConfigurationHash",
      "acquisitionElapsedMs",
      "attemptElapsedMs",
      "cumulativeAttempts",
      "cumulativeNormalizedFacts",
      "cumulativeRecords",
      "cumulativeSuccessfulPages",
      "cumulativeVerifiedBytes",
      "marketAcquisitionJournalId",
      "pageChainValid",
      "quotaWindowEvidence",
      "requestIdentityHash",
      "resourcesSettled",
      "retryContext",
      "retryDecision",
      "retryDelayClockBasis",
      "retryDelayElapsedMs",
      "retryDelayMonotonicOrderValid",
      "runSessionNonce",
      "schemaVersion",
      "tokenRelationValid",
    ];
    if (Object.keys(evidence).sort().join(",") !== exactKeys.join(",")) {
      throw rejection("acquisition-event-evidence-shape");
    }
    const expected = this.exactEventEvidence(evidence.retryContext);
    if (
      evidence.schemaVersion !== expected.schemaVersion ||
      evidence.requestIdentityHash !== expected.requestIdentityHash ||
      evidence.acquisitionConfigurationHash !== expected.acquisitionConfigurationHash ||
      evidence.marketAcquisitionJournalId !== expected.marketAcquisitionJournalId ||
      evidence.runSessionNonce !== expected.runSessionNonce ||
      evidence.cumulativeAttempts !== expected.cumulativeAttempts ||
      evidence.cumulativeSuccessfulPages !== expected.cumulativeSuccessfulPages ||
      evidence.cumulativeVerifiedBytes !== expected.cumulativeVerifiedBytes ||
      evidence.cumulativeRecords !== expected.cumulativeRecords ||
      evidence.cumulativeNormalizedFacts !== expected.cumulativeNormalizedFacts ||
      evidence.quotaWindowEvidence.join(",") !== expected.quotaWindowEvidence.join(",") ||
      canonicalJson(evidence.retryContext as unknown as JsonValue) !==
        canonicalJson(expected.retryContext as unknown as JsonValue) ||
      canonicalJson(evidence.retryDecision as unknown as JsonValue) !==
        canonicalJson(expected.retryDecision as unknown as JsonValue) ||
      evidence.attemptElapsedMs < 0 ||
      evidence.attemptElapsedMs > LIMITS.attemptDeadlineMs ||
      evidence.acquisitionElapsedMs < 0 ||
      evidence.acquisitionElapsedMs > LIMITS.acquisitionDeadlineMs ||
      !evidence.resourcesSettled ||
      !evidence.tokenRelationValid ||
      !evidence.pageChainValid
    ) {
      throw rejection("acquisition-event-proof-invalid");
    }
    const target = ACQUISITION_EVENT_TARGETS[event];
    if (event === "normalization-page-emitted") {
      if (this.currentState !== "normalizing") {
        throw rejection("acquisition-transition-invalid");
      }
    } else {
      validateAcquisitionTransition(this.currentState, target);
    }
    if (
      target === "waiting-retry" &&
      (evidence.retryContext === null ||
        evidence.retryContext.acquisitionAttemptCount !== this.budget.value.attempts ||
        evidence.retryContext.pageAttemptNumber !== this.currentAttemptOrdinal + 1 ||
        evidence.retryDecision === null ||
        evidence.retryDecision.kind !== "retry")
    ) {
      throw rejection("acquisition-event-retry-proof-invalid");
    }
    if (target !== "waiting-retry" && evidence.retryContext !== null) {
      throw rejection("acquisition-event-unexpected-retry-proof");
    }
    const retryDelayProofAbsent =
      evidence.retryDelayClockBasis === null &&
      evidence.retryDelayElapsedMs === null &&
      evidence.retryDelayMonotonicOrderValid === null;
    let mutationPlan = plan;
    if (target === "waiting-retry") {
      if (!retryDelayProofAbsent || evidence.retryDecision?.kind !== "retry") {
        throw rejection("acquisition-retry-delay-proof-unexpected");
      }
      mutationPlan = {
        ...plan,
        pendingRetryDelayMs: evidence.retryDecision.delayMs,
      };
    } else if (event === "begin-preflight" && this.currentState === "waiting-retry") {
      if (
        this.pendingRetryDelayMs === null ||
        evidence.retryDelayClockBasis !== "same-session-monotonic" ||
        evidence.retryDelayElapsedMs !== this.pendingRetryDelayMs ||
        evidence.retryDelayMonotonicOrderValid !== true
      ) {
        throw rejection("acquisition-retry-delay-proof-invalid");
      }
      mutationPlan = { ...plan, pendingRetryDelayMs: null };
    } else if (!retryDelayProofAbsent) {
      throw rejection("acquisition-retry-delay-proof-unexpected");
    }
    const prospectiveBudget = { ...this.budget.value };
    for (const [dimension, amount] of Object.entries(mutationPlan.budgetDelta ?? {}) as [
      keyof AcquisitionBudgets,
      number,
    ][]) {
      const maximum: Readonly<Record<keyof AcquisitionBudgets, number>> = {
        pages: LIMITS.pages,
        bytes: LIMITS.aggregateBytes,
        records: LIMITS.pages * LIMITS.recordsPerPage,
        facts: LIMITS.facts,
        attempts: LIMITS.attempts,
      };
      const next = prospectiveBudget[dimension] + amount;
      if (!Number.isSafeInteger(amount) || amount < 0 || next > maximum[dimension]) {
        throw rejection(`acquisition-event-${dimension}-bound`);
      }
      prospectiveBudget[dimension] = next;
    }
    if (
      mutationPlan.attemptTime !== undefined &&
      (!Number.isSafeInteger(mutationPlan.attemptTime) ||
        mutationPlan.attemptTime < 0 ||
        !this.quota.canAdmit(mutationPlan.attemptTime))
    ) {
      throw rejection("acquisition-event-quota-bound");
    }
    for (const amount of Object.values(mutationPlan.counterDelta ?? {})) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw rejection("acquisition-event-counter-invalid");
      }
    }
    const before = this.#mutableSnapshot();
    try {
      this.#applyMutationPlan(mutationPlan, prospectiveBudget, false);
      const prospectiveCheckpoint = this.checkpoint(mutationPlan.checkpointOverrides);
      this.#restoreMutableSnapshot(before);
      if (mutationPlan.journalEvent !== undefined) {
        this.journal.append(mutationPlan.journalEvent, prospectiveCheckpoint);
      }
      this.#applyMutationPlan(mutationPlan, prospectiveBudget, true);
      this.currentState = target;
    } catch (error) {
      this.#restoreMutableSnapshot(before);
      throw error;
    }
  }

  #mutableSnapshot(): MutableCoordinatorSnapshot {
    return {
      state: this.currentState,
      budget: { ...this.budget.value },
      currentPageOrdinal: this.currentPageOrdinal,
      currentAttemptOrdinal: this.currentAttemptOrdinal,
      currentTokenMaterial: this.currentTokenMaterial,
      nextTokenMaterial: this.nextTokenMaterial,
      currentContinuationBindingHash: this.currentContinuationBindingHash,
      nextContinuationBindingHash: this.nextContinuationBindingHash,
      currentReceipt: this.currentReceipt,
      pageTokenVerified: this.pageTokenVerified,
      pageRecordCount: this.pageRecordCount,
      pageChainHash: this.pageChainHash,
      admittedMarketAcquisitionIds: [...this.admittedMarketAcquisitionIds],
      attemptTimes: [...this.attemptTimes],
      normalizedFacts: [...this.normalizedFacts],
      pendingRetryDelayMs: this.pendingRetryDelayMs,
      selectionDigest: this.selectionDigest,
      counters: { ...this.counters },
    };
  }

  #restoreMutableSnapshot(snapshot: MutableCoordinatorSnapshot): void {
    this.currentState = snapshot.state;
    Object.assign(this.budget.value, snapshot.budget);
    this.currentPageOrdinal = snapshot.currentPageOrdinal;
    this.currentAttemptOrdinal = snapshot.currentAttemptOrdinal;
    this.currentTokenMaterial = snapshot.currentTokenMaterial;
    this.nextTokenMaterial = snapshot.nextTokenMaterial;
    this.currentContinuationBindingHash = snapshot.currentContinuationBindingHash;
    this.nextContinuationBindingHash = snapshot.nextContinuationBindingHash;
    this.currentReceipt = snapshot.currentReceipt;
    this.pageTokenVerified = snapshot.pageTokenVerified;
    this.pageRecordCount = snapshot.pageRecordCount;
    this.pageChainHash = snapshot.pageChainHash;
    this.admittedMarketAcquisitionIds = [...snapshot.admittedMarketAcquisitionIds];
    this.attemptTimes = [...snapshot.attemptTimes];
    this.normalizedFacts = [...snapshot.normalizedFacts];
    this.pendingRetryDelayMs = snapshot.pendingRetryDelayMs;
    this.selectionDigest = snapshot.selectionDigest;
    Object.assign(this.counters, snapshot.counters);
  }

  #applyMutationPlan(
    plan: AcquisitionMutationPlan,
    prospectiveBudget: AcquisitionBudgets,
    commitQuota: boolean,
  ): void {
    Object.assign(this.budget.value, prospectiveBudget);
    if (plan.pageOrdinal !== undefined) this.currentPageOrdinal = plan.pageOrdinal;
    if (plan.currentAttemptOrdinal !== undefined) {
      this.currentAttemptOrdinal = plan.currentAttemptOrdinal;
    }
    if ("currentTokenMaterial" in plan) {
      this.currentTokenMaterial = plan.currentTokenMaterial ?? null;
    }
    if ("nextTokenMaterial" in plan) {
      this.nextTokenMaterial = plan.nextTokenMaterial ?? null;
    }
    if ("currentContinuationBindingHash" in plan) {
      this.currentContinuationBindingHash = plan.currentContinuationBindingHash ?? null;
    }
    if ("nextContinuationBindingHash" in plan) {
      this.nextContinuationBindingHash = plan.nextContinuationBindingHash ?? null;
    }
    if ("currentReceipt" in plan) this.currentReceipt = plan.currentReceipt ?? null;
    if (plan.pageTokenVerified !== undefined) {
      this.pageTokenVerified = plan.pageTokenVerified;
    }
    if ("pageRecordCount" in plan) this.pageRecordCount = plan.pageRecordCount ?? null;
    if (plan.pageChainHash !== undefined) this.pageChainHash = plan.pageChainHash;
    if (plan.appendAdmittedMarketAcquisitionId !== undefined) {
      this.admittedMarketAcquisitionIds.push(plan.appendAdmittedMarketAcquisitionId);
    }
    if (plan.normalizedFacts !== undefined) this.normalizedFacts = [...plan.normalizedFacts];
    if ("pendingRetryDelayMs" in plan) {
      this.pendingRetryDelayMs = plan.pendingRetryDelayMs ?? null;
    }
    if ("selectionDigest" in plan) this.selectionDigest = plan.selectionDigest ?? null;
    for (const [counter, amount] of Object.entries(plan.counterDelta ?? {}) as [
      keyof SideEffectCounters,
      number,
    ][]) {
      this.counters[counter] += amount;
    }
    if (plan.attemptTime !== undefined) {
      this.attemptTimes.push(plan.attemptTime);
      if (commitQuota) this.quota.commitVerified(plan.attemptTime);
    }
  }

  coordinatorSnapshot(): JsonValue {
    return {
      state: this.currentState,
      budget: { ...this.budget.value },
      currentPageOrdinal: this.currentPageOrdinal,
      currentAttemptOrdinal: this.currentAttemptOrdinal,
      currentTokenMaterial: this.currentTokenMaterial,
      nextTokenMaterial: this.nextTokenMaterial,
      currentContinuationBindingHash: this.currentContinuationBindingHash,
      nextContinuationBindingHash: this.nextContinuationBindingHash,
      pageChainHash: this.pageChainHash,
      admittedMarketAcquisitionIds: [...this.admittedMarketAcquisitionIds],
      attemptTimes: [...this.attemptTimes],
      normalizedFacts: [...this.normalizedFacts],
      pendingRetryDelayMs: this.pendingRetryDelayMs,
      selectionDigest: this.selectionDigest,
      counters: { ...this.counters },
      artifactObservationIds: this.artifact.receipts.map((receipt) => receipt.observationId),
      artifactDigests: this.artifact.receipts.map((receipt) => receipt.digest),
      artifactStoreCalls: this.artifact.storeCalls,
      artifactReadCalls: this.artifact.readCalls,
      artifactOrphanDigests: [...this.artifact.orphanDigests],
      providerRequestCalls: this.provider.requestCalls,
      journalRows: this.journal.rows().map((row) => ({
        event: row.event,
        hash: row.checkpoint.journalEntryHash,
      })),
    };
  }

  previewCheckpoint(plan: AcquisitionMutationPlan): DurableCheckpoint {
    const prospectiveBudget = { ...this.budget.value };
    for (const [dimension, amount] of Object.entries(plan.budgetDelta ?? {}) as [
      keyof AcquisitionBudgets,
      number,
    ][]) {
      prospectiveBudget[dimension] += amount;
    }
    const before = this.#mutableSnapshot();
    try {
      this.#applyMutationPlan(plan, prospectiveBudget, false);
      return this.checkpoint(plan.checkpointOverrides);
    } finally {
      this.#restoreMutableSnapshot(before);
    }
  }

  checkpoint(overrides: Partial<DurableCheckpoint> = {}): DurableCheckpoint {
    const currentTokenHash =
      this.currentTokenMaterial === null ? "no-token" : privateTokenHash(this.currentTokenMaterial);
    const logicalPageHash = logicalPageIdentityHash(
      requestIdentity(this.request),
      this.currentPageOrdinal,
      this.currentTokenMaterial === null ? null : currentTokenHash,
    );
    const attempt = attemptIdentity(logicalPageHash, this.currentAttemptOrdinal);
    const acquisitionObservationId = acquisitionObservationIdentity(
      this.request,
      attempt.retrievalAttemptId,
    );
    const marketAcquisitionId = marketAcquisitionIdentity(this.request, acquisitionObservationId);
    const receipt = this.currentReceipt;
    const artifactIds =
      receipt === null ? null : artifactIdentities(receipt, acquisitionObservationId);
    const nextTokenHash = this.pageTokenVerified
      ? this.nextTokenMaterial === null
        ? "terminal"
        : privateTokenHash(this.nextTokenMaterial)
      : null;
    return {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      marketAcquisitionJournalId: marketAcquisitionJournalIdentity(this.request),
      runSessionNonce: RUN_SESSION_NONCE,
      acquisitionObservationId,
      marketAcquisitionId,
      admittedMarketAcquisitionIds: [...this.admittedMarketAcquisitionIds],
      requestIdentityHash: requestIdentity(this.request),
      acquisitionConfigurationHash: configurationHash(this.request),
      providerId: this.request.providerId,
      datasetId: this.request.datasetId,
      feedId: this.request.feedId,
      endpointChannelId: this.request.endpointChannelId,
      authorizationMode: "p1-09-approved",
      logicalPageIdentityHash: logicalPageHash,
      pageOrdinal: this.currentPageOrdinal,
      checkpointKind: "acquisition-declared",
      currentTokenHash,
      currentResumableTokenMaterial: this.currentTokenMaterial,
      nextTokenHash,
      nextResumableTokenMaterial:
        this.pageTokenVerified && this.nextTokenMaterial !== null ? this.nextTokenMaterial : null,
      currentContinuationBindingHash: this.currentContinuationBindingHash,
      nextContinuationBindingHash: this.nextContinuationBindingHash,
      attemptId: attempt.attemptId,
      retrievalAttemptId: attempt.retrievalAttemptId,
      attemptOrdinal: this.currentAttemptOrdinal,
      artifactObservationId: receipt?.observationId ?? null,
      artifactDigest: receipt?.digest ?? null,
      artifactSizeBytes: receipt?.bytes.byteLength ?? null,
      artifactObservationHash: artifactIds?.artifactObservationHash ?? null,
      artifactContentId: artifactIds?.artifactContentId ?? null,
      rawArtifactId: artifactIds?.rawArtifactId ?? null,
      stageLedgerFactId: null,
      causalParentFactIds: [],
      pageRecordCount: this.pageRecordCount,
      pageNormalizedFactCount: null,
      pageChainHash: this.pageChainHash,
      cumulativeSuccessfulPages: this.budget.value.pages,
      cumulativeVerifiedBytes: this.budget.value.bytes,
      cumulativeRecords: this.budget.value.records,
      cumulativeNormalizedFacts: this.budget.value.facts,
      cumulativeAttempts: this.budget.value.attempts,
      acquisitionDeadlineBasis: "trusted-request-started-plus-300000ms",
      quotaWindowEvidence: [...this.attemptTimes],
      terminalState: null,
      terminalReasonCode: null,
      incomplete: true,
      priorJournalEntryHash: "genesis",
      journalSequence: 0,
      journalEntryHash: "",
      ...overrides,
    };
  }

  loadDurableCoordinator(
    checkpoint: DurableCheckpoint,
    state: AcquisitionState,
    receipt: StoredReceipt | null,
    replayOutcome?: Readonly<{
      normalizedFacts: readonly string[];
      selectionDigest: string;
    }>,
  ): void {
    Object.assign(this.budget.value, {
      pages: checkpoint.cumulativeSuccessfulPages,
      bytes: checkpoint.cumulativeVerifiedBytes,
      records: checkpoint.cumulativeRecords,
      facts: checkpoint.cumulativeNormalizedFacts,
      attempts: checkpoint.cumulativeAttempts,
    });
    this.attemptTimes = [...checkpoint.quotaWindowEvidence];
    this.pageChainHash = checkpoint.pageChainHash;
    this.admittedMarketAcquisitionIds = [...checkpoint.admittedMarketAcquisitionIds];
    this.currentPageOrdinal = checkpoint.pageOrdinal;
    this.currentAttemptOrdinal = checkpoint.attemptOrdinal;
    this.currentTokenMaterial = checkpoint.currentResumableTokenMaterial;
    this.nextTokenMaterial = checkpoint.nextResumableTokenMaterial;
    this.currentContinuationBindingHash = checkpoint.currentContinuationBindingHash;
    this.nextContinuationBindingHash = checkpoint.nextContinuationBindingHash;
    this.currentReceipt = receipt;
    this.pageTokenVerified = checkpoint.nextTokenHash !== null;
    this.pageRecordCount = checkpoint.pageRecordCount;
    this.currentState = state;
    if (replayOutcome !== undefined) {
      this.normalizedFacts = [...replayOutcome.normalizedFacts];
      this.selectionDigest = replayOutcome.selectionDigest;
    }
  }

  currentPagePreflightAdmission(): Readonly<{
    request: Preflight;
    precedingCheckpoint: DurableCheckpoint | null;
  }> {
    if (this.currentPageOrdinal === 0) {
      return {
        request: {
          ...this.request,
          fields: withoutField(this.request.fields, "page_token"),
          pageOrdinal: 0,
          continuation: null,
        },
        precedingCheckpoint: null,
      };
    }
    if (this.currentTokenMaterial === null || this.currentContinuationBindingHash === null) {
      throw rejection("page-token-state-missing");
    }
    const preceding = this.journal
      .rows()
      .find(
        (row) =>
          row.event === "checkpoint.advanced" &&
          row.checkpoint.pageOrdinal === this.currentPageOrdinal - 1,
      )?.checkpoint;
    if (preceding === undefined) throw rejection("page-token-preceding-page-unverified");
    const priorTokenHashes = this.journal
      .rows()
      .filter(
        (row) =>
          row.event === "checkpoint.advanced" &&
          row.checkpoint.pageOrdinal < preceding.pageOrdinal &&
          row.checkpoint.nextTokenHash !== null &&
          row.checkpoint.nextTokenHash !== "terminal",
      )
      .map((row) => row.checkpoint.nextTokenHash as string);
    const pageRequest = continuationRequestForVerifiedPage(
      this.request,
      preceding,
      this.currentTokenMaterial,
      priorTokenHashes,
    );
    if (pageRequest.continuation?.bindingHash !== this.currentContinuationBindingHash) {
      throw rejection("page-token-binding-mismatch");
    }
    return { request: pageRequest, precedingCheckpoint: preceding };
  }

  async run(fault: AcquisitionFault = {}): Promise<"complete" | "crashed" | "failed"> {
    try {
      this.applyAcquisitionEvent("begin-preflight", this.exactEventEvidence(), {
        journalEvent: "acquisition.declared",
        pageOrdinal: 0,
        currentAttemptOrdinal: 0,
        currentReceipt: null,
        currentTokenMaterial: null,
        nextTokenMaterial: null,
        currentContinuationBindingHash: null,
        nextContinuationBindingHash: null,
        pageTokenVerified: false,
        pageRecordCount: null,
      });
      while (this.currentPageOrdinal < this.provider.pageCount()) {
        if (fault.crashAt === "before-request" && this.currentPageOrdinal === 0) return "crashed";
        const admission = this.currentPagePreflightAdmission();
        const admittedRequest =
          this.currentPageOrdinal > 0 && fault.continuationMutation !== undefined
            ? fault.continuationMutation(admission.request)
            : admission.request;
        guardedPreflight(admittedRequest, this.counters, admission.precedingCheckpoint);
        this.applyAcquisitionEvent("preflight-approved");
        this.applyAcquisitionEvent("credentials-loaded");
        const attemptTime = (this.budget.value.attempts + 1) * 1_000;
        new AcquisitionCeilingGate().validateDeadlines(LIMITS.attemptDeadlineMs, attemptTime);
        this.applyAcquisitionEvent("dispatch-started", this.exactEventEvidence(), {
          budgetDelta: { attempts: 1 },
          attemptTime,
          counterDelta: { dnsCalls: 1, networkCalls: 1, providerCalls: 1 },
          journalEvent: "request.started",
        });
        if (fault.crashAt === "request-started" && this.currentPageOrdinal === 0) return "crashed";
        if (fault.timeoutBeforeHeaders) throw rejection("timeout-before-headers");
        this.applyAcquisitionEvent("response-headers-accepted", this.exactEventEvidence(), {
          journalEvent: "request.succeeded",
        });
        if (fault.crashAt === "during-body" && this.currentPageOrdinal === 0) {
          this.applyAcquisitionEvent("artifact-store-started");
          await assert.rejects(
            () => this.provider.response(1, undefined, this.currentPageOrdinal),
            /body-failure/u,
          );
          return "crashed";
        }
        this.applyAcquisitionEvent("artifact-store-started");
        const bytes = await this.provider.response(
          fault.bodyFailureAt ?? null,
          (index) => {
            if (fault.activeClockFault !== undefined && index === 0) {
              this.activeClock.inject(fault.activeClockFault);
            }
            this.activeClock.validateAndAdvance();
          },
          this.currentPageOrdinal,
        );
        if (fault.schemaFailure) throw rejection("schema-failure");
        if (fault.crashAt === "vault-side-effect-before-receipt" && this.currentPageOrdinal === 0) {
          this.artifact.storeOrphan(bytes);
          return "crashed";
        }
        this.artifact.failStore = fault.storeFailure ?? false;
        const immutableReceipt = this.artifact.store(bytes);
        const admittedReceipt =
          fault.paginationFault === "duplicate-page" && this.currentPageOrdinal === 1
            ? (this.artifact.receipts[0] ?? immutableReceipt)
            : immutableReceipt;
        this.applyAcquisitionEvent("artifact-store-committed", this.exactEventEvidence(), {
          currentReceipt: admittedReceipt,
          counterDelta: { artifactCalls: 1 },
          journalEvent: "artifact.committed",
        });
        this.artifact.acknowledgeReceipt(admittedReceipt);
        if (fault.crashAt === "artifact-committed" && this.currentPageOrdinal === 0) {
          return "crashed";
        }
        this.applyAcquisitionEvent("artifact-verification-started");
        this.artifact.failRead = fault.readFailure ?? false;
        this.artifact.readObservation(admittedReceipt.observationId, admittedReceipt.digest);
        const pageRecordCount = this.provider.recordCount(this.currentPageOrdinal);
        let nextTokenMaterial = this.provider.nextToken(this.currentPageOrdinal);
        if (fault.paginationFault === "loop" && this.currentPageOrdinal === 1) {
          nextTokenMaterial = this.provider.nextToken(0);
        }
        if (nextTokenMaterial !== null) {
          const proposedTokenHash = privateTokenHash(nextTokenMaterial);
          const previouslyReturned = new Set(
            this.journal
              .rows()
              .filter((row) => row.event === "checkpoint.advanced")
              .map((row) => row.checkpoint.nextTokenHash)
              .filter((tokenHash): tokenHash is string => tokenHash !== null),
          );
          if (previouslyReturned.has(proposedTokenHash)) {
            throw rejection("pagination-token-loop");
          }
        }
        this.applyAcquisitionEvent("page-verification-passed", this.exactEventEvidence(), {
          nextTokenMaterial,
          pageTokenVerified: true,
          pageRecordCount,
          journalEvent: "artifact.verified",
        });
        if (fault.crashAt === "artifact-verified" && this.currentPageOrdinal === 0) {
          return "crashed";
        }
        const preChainPlan: AcquisitionMutationPlan = {
          budgetDelta: {
            pages: 1,
            bytes: admittedReceipt.bytes.byteLength,
            records: pageRecordCount,
          },
          appendAdmittedMarketAcquisitionId: this.checkpoint().marketAcquisitionId,
        };
        const checkpointBeforeChainAdvance = this.previewCheckpoint(preChainPlan);
        const prospectivePageChainHash = admittedPageChainHash(
          this.pageChainHash,
          checkpointBeforeChainAdvance,
        );
        const prospectiveNextBinding =
          nextTokenMaterial === null
            ? null
            : continuationBindingHash({
                precedingMarketAcquisitionId: checkpointBeforeChainAdvance.marketAcquisitionId,
                requestIdentityHash: checkpointBeforeChainAdvance.requestIdentityHash,
                precedingLogicalPageIdentityHash:
                  checkpointBeforeChainAdvance.logicalPageIdentityHash,
                precedingPageOrdinal: checkpointBeforeChainAdvance.pageOrdinal,
                precedingArtifactObservationId:
                  checkpointBeforeChainAdvance.artifactObservationId as string,
                precedingArtifactDigest: checkpointBeforeChainAdvance.artifactDigest as string,
                precedingPageChainHash: prospectivePageChainHash,
                nextPageOrdinal: this.currentPageOrdinal + 1,
                nextTokenHash: checkpointBeforeChainAdvance.nextTokenHash as string,
              });
        this.applyAcquisitionEvent("page-checkpoint-committed", this.exactEventEvidence(), {
          ...preChainPlan,
          pageChainHash: prospectivePageChainHash,
          nextContinuationBindingHash: prospectiveNextBinding,
          journalEvent: "checkpoint.advanced",
        });
        if (fault.crashAt === "checkpoint-advanced" && this.currentPageOrdinal === 0) {
          return "crashed";
        }
        if (nextTokenMaterial !== null) {
          const proposedToken =
            fault.paginationFault === "substitution" && this.currentPageOrdinal === 0
              ? `${nextTokenMaterial}-substituted`
              : nextTokenMaterial;
          const proposedPageOrdinal =
            fault.paginationFault === "gap" && this.currentPageOrdinal === 0
              ? this.currentPageOrdinal + 2
              : fault.paginationFault === "duplicate-position" && this.currentPageOrdinal === 0
                ? this.currentPageOrdinal
                : this.currentPageOrdinal + 1;
          this.applyAcquisitionEvent("begin-preflight", this.exactEventEvidence(), {
            journalEvent: "acquisition.declared",
            pageOrdinal: proposedPageOrdinal,
            currentAttemptOrdinal: 0,
            currentReceipt: null,
            currentTokenMaterial: proposedToken,
            nextTokenMaterial: null,
            currentContinuationBindingHash: prospectiveNextBinding,
            nextContinuationBindingHash: null,
            pageTokenVerified: false,
            pageRecordCount: null,
          });
          continue;
        }
        this.applyAcquisitionEvent("terminal-token-admitted", this.exactEventEvidence(), {
          journalEvent: "chain.complete",
        });
        if (fault.paginationFault === "page-after-terminal") {
          this.applyAcquisitionEvent("begin-preflight", this.exactEventEvidence(), {
            journalEvent: "acquisition.declared",
            pageOrdinal: this.currentPageOrdinal + 1,
          });
        }
        break;
      }
      for (const receipt of this.artifact.receipts) {
        this.artifact.readObservation(receipt.observationId, receipt.digest);
      }
      this.applyAcquisitionEvent("normalization-started", this.exactEventEvidence(), {
        journalEvent: "normalization.started",
        counterDelta: { normalizationCalls: 1 },
      });
      if (fault.crashAt === "during-normalization") return "crashed";
      const emittedFacts = new Set<string>();
      for (const receipt of this.artifact.receipts) {
        const admittedCheckpoint = this.journal
          .rows()
          .find(
            (row) =>
              row.event === "checkpoint.advanced" &&
              row.checkpoint.artifactObservationId === receipt.observationId,
          )?.checkpoint;
        if (admittedCheckpoint === undefined) throw rejection("admitted-page-missing");
        const pageFacts = normalizedFactsFromReceipt(receipt).filter(
          (fact) => !emittedFacts.has(fact),
        );
        for (const fact of pageFacts) emittedFacts.add(fact);
        this.applyAcquisitionEvent("normalization-page-emitted", this.exactEventEvidence(), {
          budgetDelta: { facts: pageFacts.length },
          currentReceipt: receipt,
          pageOrdinal: receipt.deliveryOrdinal,
          currentTokenMaterial: admittedCheckpoint.currentResumableTokenMaterial,
          currentContinuationBindingHash: admittedCheckpoint.currentContinuationBindingHash,
          currentAttemptOrdinal: admittedCheckpoint.attemptOrdinal,
          nextTokenMaterial: admittedCheckpoint.nextResumableTokenMaterial,
          nextContinuationBindingHash: admittedCheckpoint.nextContinuationBindingHash,
          pageTokenVerified: true,
          pageRecordCount: this.provider.recordCount(receipt.deliveryOrdinal),
          normalizedFacts: [...emittedFacts].sort(),
          journalEvent: "normalization.emitted",
          checkpointOverrides: { pageNormalizedFactCount: pageFacts.length },
        });
      }
      this.applyAcquisitionEvent("normalization-completed", this.exactEventEvidence(), {
        normalizedFacts: [...emittedFacts].sort(),
        selectionDigest: hash([...emittedFacts].sort().join("|")),
      });
      this.applyAcquisitionEvent("selection-started", this.exactEventEvidence(), {
        journalEvent: "selection.started",
      });
      if (fault.crashAt === "before-selection") {
        return "crashed";
      }
      this.applyAcquisitionEvent("selection-completed", this.exactEventEvidence(), {
        counterDelta: { selectionCalls: 1 },
        journalEvent: "selection.recorded",
        checkpointOverrides: {
          terminalState: "completed",
          terminalReasonCode: "completed",
          incomplete: false,
        },
      });
      return "complete";
    } catch (error) {
      const rows = this.journal.rows();
      if (rows.length > 0 && rows.at(-1)?.event !== "selection.recorded") {
        if (ACQUISITION_TRANSITIONS[this.currentState].includes("failed-clean")) {
          const errorMessage = error instanceof Error ? error.message : "";
          const terminalReasonCode = errorMessage.includes("p1-10.clock-regression")
            ? "clock-regression"
            : errorMessage.includes("p1-10.clock-")
              ? "clock-unavailable"
              : "technical-failure";
          this.applyAcquisitionEvent("technical-failure-settled", this.exactEventEvidence(), {
            journalEvent: "failure.recorded",
            checkpointOverrides: {
              terminalState: "failed-clean",
              terminalReasonCode,
              incomplete: false,
            },
          });
        }
      }
      return "failed";
    }
  }

  async resume(
    expectedConfigurationHash: string,
    fault: Pick<AcquisitionFault, "continuationMutation"> = {},
  ): Promise<"complete"> {
    let rows = this.journal.rows();
    const latest = rows.at(-1);
    if (latest === undefined) throw rejection("journal-empty");
    if (latest.checkpoint.acquisitionConfigurationHash !== expectedConfigurationHash) {
      throw rejection("restart-configuration-changed");
    }
    validateJournalRows(rows, this.request);
    const committedRows = rows.filter((row) => row.event === "artifact.committed");
    for (const committed of committedRows) {
      const digest = committed.checkpoint.artifactDigest;
      const observationId = committed.checkpoint.artifactObservationId;
      if (digest === null || observationId === null) throw rejection("artifact-missing");
      const receipt = this.artifact.receipts.find(
        (candidate) => candidate.observationId === observationId,
      );
      if (
        receipt === undefined ||
        receipt.digest !== digest ||
        receipt.bytes.byteLength !== committed.checkpoint.artifactSizeBytes ||
        artifactIdentities(receipt, committed.checkpoint.acquisitionObservationId)
          .artifactObservationHash !== committed.checkpoint.artifactObservationHash
      ) {
        throw rejection("artifact-receipt-mismatch");
      }
      this.artifact.readObservation(observationId, digest);
    }

    if (latest.event === "selection.recorded") {
      this.loadDurableCoordinator(
        latest.checkpoint,
        "completed",
        this.artifact.receipts.at(-1) ?? null,
        {
          normalizedFacts: normalizedFactsFromArtifact(this.artifact),
          selectionDigest: normalizedDigestFromArtifact(this.artifact),
        },
      );
      return "complete";
    }

    for (let pageOrdinal = 0; pageOrdinal < this.provider.pageCount(); pageOrdinal += 1) {
      rows = this.journal.rows();
      const checkpointed = rows.find(
        (row) => row.event === "checkpoint.advanced" && row.checkpoint.pageOrdinal === pageOrdinal,
      );
      if (checkpointed !== undefined) continue;
      const pageRows = rows.filter((row) => row.checkpoint.pageOrdinal === pageOrdinal);
      const committed = [...pageRows].reverse().find((row) => row.event === "artifact.committed");
      if (committed === undefined) {
        this.artifact.reconcileOrphans();
        const lastPageRow = pageRows.at(-1);
        const lastWasUnusedDeclaration = lastPageRow?.event === "acquisition.declared";
        const attemptOrdinal =
          Math.max(-1, ...pageRows.map((row) => row.checkpoint.attemptOrdinal)) +
          (lastWasUnusedDeclaration ? 0 : 1);
        const latestCheckpoint = rows.at(-1)?.checkpoint ?? latest.checkpoint;
        const precedingPageCheckpoint =
          pageOrdinal === 0
            ? null
            : (rows.find(
                (row) =>
                  row.event === "checkpoint.advanced" &&
                  row.checkpoint.pageOrdinal === pageOrdinal - 1,
              )?.checkpoint ?? null);
        if (pageOrdinal > 0 && precedingPageCheckpoint === null) {
          throw rejection("restart-preceding-page-missing");
        }
        this.loadDurableCoordinator(
          {
            ...latestCheckpoint,
            pageOrdinal,
            attemptOrdinal,
            currentResumableTokenMaterial:
              pageOrdinal === 0
                ? null
                : (precedingPageCheckpoint as DurableCheckpoint).nextResumableTokenMaterial,
            currentContinuationBindingHash:
              pageOrdinal === 0
                ? null
                : (precedingPageCheckpoint as DurableCheckpoint).nextContinuationBindingHash,
            nextResumableTokenMaterial: null,
            nextContinuationBindingHash: null,
            nextTokenHash: null,
            artifactObservationId: null,
            artifactDigest: null,
            artifactSizeBytes: null,
            artifactObservationHash: null,
            artifactContentId: null,
            rawArtifactId: null,
            pageRecordCount: null,
          },
          "declared",
          null,
        );
        if (!lastWasUnusedDeclaration) {
          this.applyAcquisitionEvent("begin-preflight", this.exactEventEvidence(), {
            journalEvent: "acquisition.declared",
            currentAttemptOrdinal: attemptOrdinal,
            currentReceipt: null,
            nextTokenMaterial: null,
            nextContinuationBindingHash: null,
            pageTokenVerified: false,
            pageRecordCount: null,
          });
        } else {
          this.applyAcquisitionEvent("begin-preflight");
        }
        const admission = this.currentPagePreflightAdmission();
        const admittedRequest =
          pageOrdinal > 0 && fault.continuationMutation !== undefined
            ? fault.continuationMutation(admission.request)
            : admission.request;
        guardedPreflight(admittedRequest, this.counters, admission.precedingCheckpoint);
        this.applyAcquisitionEvent("preflight-approved");
        this.applyAcquisitionEvent("credentials-loaded");
        const attemptTime = (this.budget.value.attempts + 1) * 1_000;
        this.applyAcquisitionEvent("dispatch-started", this.exactEventEvidence(), {
          budgetDelta: { attempts: 1 },
          attemptTime,
          counterDelta: { dnsCalls: 1, networkCalls: 1, providerCalls: 1 },
          journalEvent: "request.started",
        });
        const bytes = await this.provider.response(null, undefined, pageOrdinal);
        this.applyAcquisitionEvent("response-headers-accepted", this.exactEventEvidence(), {
          journalEvent: "request.succeeded",
        });
        this.applyAcquisitionEvent("artifact-store-started");
        const receipt = this.artifact.store(bytes);
        this.applyAcquisitionEvent("artifact-store-committed", this.exactEventEvidence(), {
          currentReceipt: receipt,
          counterDelta: { artifactCalls: 1 },
          journalEvent: "artifact.committed",
        });
        this.artifact.acknowledgeReceipt(receipt);
      } else {
        const receipt =
          this.artifact.receipts.find(
            (receipt) => receipt.observationId === committed.checkpoint.artifactObservationId,
          ) ?? null;
        if (receipt === null) throw rejection("artifact-receipt-mismatch");
        this.loadDurableCoordinator(committed.checkpoint, "artifact-committed", receipt);
      }
      const activeReceipt = this.currentReceipt;
      if (activeReceipt === null) throw rejection("artifact-receipt-mismatch");
      const verified = this.journal
        .rows()
        .find(
          (row) =>
            row.event === "artifact.verified" &&
            row.checkpoint.artifactObservationId === activeReceipt.observationId,
        );
      const nextTokenMaterial = this.provider.nextToken(pageOrdinal);
      const pageRecordCount = this.provider.recordCount(pageOrdinal);
      if (verified === undefined) {
        this.applyAcquisitionEvent("artifact-verification-started");
        this.artifact.readObservation(activeReceipt.observationId, activeReceipt.digest);
        this.applyAcquisitionEvent("page-verification-passed", this.exactEventEvidence(), {
          nextTokenMaterial,
          pageRecordCount,
          pageTokenVerified: true,
          journalEvent: "artifact.verified",
        });
      } else {
        this.loadDurableCoordinator(verified.checkpoint, "page-verified", activeReceipt);
      }
      const preChainPlan: AcquisitionMutationPlan = {
        budgetDelta: {
          pages: 1,
          bytes: activeReceipt.bytes.byteLength,
          records: pageRecordCount,
        },
        appendAdmittedMarketAcquisitionId: this.checkpoint().marketAcquisitionId,
      };
      const beforeAdvance = this.previewCheckpoint(preChainPlan);
      const pageChainHash = admittedPageChainHash(this.pageChainHash, beforeAdvance);
      const nextContinuationBindingHash =
        nextTokenMaterial === null
          ? null
          : continuationBindingHash({
              precedingMarketAcquisitionId: beforeAdvance.marketAcquisitionId,
              requestIdentityHash: beforeAdvance.requestIdentityHash,
              precedingLogicalPageIdentityHash: beforeAdvance.logicalPageIdentityHash,
              precedingPageOrdinal: beforeAdvance.pageOrdinal,
              precedingArtifactObservationId: beforeAdvance.artifactObservationId as string,
              precedingArtifactDigest: beforeAdvance.artifactDigest as string,
              precedingPageChainHash: pageChainHash,
              nextPageOrdinal: pageOrdinal + 1,
              nextTokenHash: beforeAdvance.nextTokenHash as string,
            });
      this.applyAcquisitionEvent("page-checkpoint-committed", this.exactEventEvidence(), {
        ...preChainPlan,
        pageChainHash,
        nextContinuationBindingHash,
        journalEvent: "checkpoint.advanced",
      });
    }

    rows = this.journal.rows();
    const finalPage = rows.filter((row) => row.event === "checkpoint.advanced").at(-1);
    if (finalPage === undefined) throw rejection("checkpoint-page-missing");
    const finalReceipt =
      this.artifact.receipts.find(
        (receipt) => receipt.observationId === finalPage.checkpoint.artifactObservationId,
      ) ?? null;
    this.loadDurableCoordinator(finalPage.checkpoint, "checkpointing", finalReceipt);
    if (!rows.some((row) => row.event === "chain.complete")) {
      this.applyAcquisitionEvent("terminal-token-admitted", this.exactEventEvidence(), {
        journalEvent: "chain.complete",
      });
    } else {
      const chainRow = rows.find((row) => row.event === "chain.complete");
      if (chainRow === undefined) throw rejection("checkpoint-chain-missing");
      this.loadDurableCoordinator(chainRow.checkpoint, "chain-complete", finalReceipt);
    }
    for (const receipt of this.artifact.receipts) {
      this.artifact.readObservation(receipt.observationId, receipt.digest);
    }
    rows = this.journal.rows();
    if (!rows.some((row) => row.event === "normalization.started")) {
      this.applyAcquisitionEvent("normalization-started", this.exactEventEvidence(), {
        journalEvent: "normalization.started",
        counterDelta: { normalizationCalls: 1 },
      });
    } else {
      const normalizedRows = rows.filter(
        (row) => row.event === "normalization.started" || row.event === "normalization.emitted",
      );
      const normalizedLatest = normalizedRows.at(-1);
      if (normalizedLatest === undefined) throw rejection("normalization-checkpoint-missing");
      const normalizedReceipt =
        this.artifact.receipts.find(
          (receipt) => receipt.observationId === normalizedLatest.checkpoint.artifactObservationId,
        ) ?? finalReceipt;
      this.loadDurableCoordinator(normalizedLatest.checkpoint, "normalizing", normalizedReceipt);
    }
    const alreadyNormalized = new Set(
      this.journal
        .rows()
        .filter((row) => row.event === "normalization.emitted")
        .map((row) => row.checkpoint.artifactObservationId),
    );
    const emittedFacts = new Set<string>();
    for (const receipt of this.artifact.receipts) {
      const facts = normalizedFactsFromReceipt(receipt);
      const pageFacts = facts.filter((fact) => !emittedFacts.has(fact));
      for (const fact of facts) emittedFacts.add(fact);
      if (alreadyNormalized.has(receipt.observationId)) continue;
      const admittedCheckpoint = this.journal
        .rows()
        .find(
          (row) =>
            row.event === "checkpoint.advanced" &&
            row.checkpoint.artifactObservationId === receipt.observationId,
        )?.checkpoint;
      if (admittedCheckpoint === undefined) throw rejection("admitted-page-missing");
      this.applyAcquisitionEvent("normalization-page-emitted", this.exactEventEvidence(), {
        budgetDelta: { facts: pageFacts.length },
        currentReceipt: receipt,
        pageOrdinal: receipt.deliveryOrdinal,
        currentTokenMaterial: admittedCheckpoint.currentResumableTokenMaterial,
        currentContinuationBindingHash: admittedCheckpoint.currentContinuationBindingHash,
        currentAttemptOrdinal: admittedCheckpoint.attemptOrdinal,
        nextTokenMaterial: admittedCheckpoint.nextResumableTokenMaterial,
        nextContinuationBindingHash: admittedCheckpoint.nextContinuationBindingHash,
        pageTokenVerified: true,
        pageRecordCount: this.provider.recordCount(receipt.deliveryOrdinal),
        normalizedFacts: [...emittedFacts].sort(),
        journalEvent: "normalization.emitted",
        checkpointOverrides: { pageNormalizedFactCount: pageFacts.length },
      });
    }
    const normalizedFacts = [...emittedFacts].sort();
    if (!this.journal.rows().some((row) => row.event === "selection.started")) {
      this.applyAcquisitionEvent("normalization-completed", this.exactEventEvidence(), {
        normalizedFacts,
        selectionDigest: hash(normalizedFacts.join("|")),
      });
      this.applyAcquisitionEvent("selection-started", this.exactEventEvidence(), {
        journalEvent: "selection.started",
      });
    } else {
      const selectionStarted = this.journal.rows().find((row) => row.event === "selection.started");
      if (selectionStarted === undefined) throw rejection("selection-checkpoint-missing");
      this.loadDurableCoordinator(selectionStarted.checkpoint, "selecting", this.currentReceipt, {
        normalizedFacts,
        selectionDigest: hash(normalizedFacts.join("|")),
      });
    }
    if (!this.journal.rows().some((row) => row.event === "selection.recorded")) {
      this.applyAcquisitionEvent("selection-completed", this.exactEventEvidence(), {
        counterDelta: { selectionCalls: 1 },
        journalEvent: "selection.recorded",
        checkpointOverrides: {
          terminalState: "completed",
          terminalReasonCode: "completed",
          incomplete: false,
        },
      });
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
    files: readonly string[];
    cases: readonly string[];
  };
  assert.equal(manifest.schemaVersion, "peas-p1-10-synthetic-acquisition-v1");
  assert.equal(manifest.classification, "original-project-authored-synthetic");
  assert.equal(manifest.providerEvidence, false);
  assert.equal(manifest.networkAuthorized, false);
  assert.deepEqual(manifest.files, [
    "README.md",
    "manifest.json",
    "synthetic-alias-authority-catalog.json",
    "synthetic-pages.json",
  ]);
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
        "changed-fact-kind-membership",
        {
          ...envelope,
          preimage: {
            ...envelope.preimage,
            factKinds: [...factKinds, "unauthorized-kind"],
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

  const canonicalMultiMemberChannelPreimage = {
    feedId: IDS.alpacaFeed,
    channelKind: "historical-rest",
    methodKind: "get",
    safeRouteLabel: "synthetic-multi-fact-order-witness",
    endpointDocumentationVersion: "synthetic-contract-v1",
    paginationKind: "opaque-token",
    factKinds: ["bar", "quote"],
  } as const;
  const controlledChannel: IdentityEnvelope = {
    name: "controlled-multi-member-channel-order",
    family: "channel",
    preimage: canonicalMultiMemberChannelPreimage,
    expectedId: deriveEndpointChannelId(canonicalMultiMemberChannelPreimage),
    lane: "alpaca",
  };
  const canonicalCounters = zeroCounters();
  assert.doesNotThrow(() => guardedIdentityConfiguration(controlledChannel, canonicalCounters));
  assert.deepEqual(canonicalCounters, {
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
  const reversedSameMembers: IdentityEnvelope = {
    ...controlledChannel,
    preimage: {
      ...canonicalMultiMemberChannelPreimage,
      factKinds: [...canonicalMultiMemberChannelPreimage.factKinds].reverse(),
    },
  };
  assert.deepEqual(
    [...(reversedSameMembers.preimage["factKinds"] as readonly string[])].sort(),
    [...canonicalMultiMemberChannelPreimage.factKinds],
    "the rejection vector changes only order, never membership",
  );
  const reversedCounters = zeroCounters();
  assert.throws(
    () => guardedIdentityConfiguration(reversedSameMembers, reversedCounters),
    /market\.input-invalid/u,
  );
  assertZeroSideEffects(reversedCounters);

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

test("typed instrument membership, continuation material, and canonical nanosecond timestamps close the guarded request boundary", async () => {
  const requestWithInstruments = (instruments: readonly InstrumentMember[]): Preflight => ({
    ...exactBoundaryRequest(0n),
    instruments,
    fields: {
      ...exactBoundaryRequest(0n).fields,
      symbols: instruments.map((member) => member.canonicalSymbol).join(","),
    },
  });
  const allAuthorityMembers = FROZEN_INSTRUMENT_REGISTRY.map((record) => ({
    canonicalSymbol: record.canonicalSymbol,
    instrumentId: record.instrumentId,
  }));
  const exact64 = allAuthorityMembers.slice(0, LIMITS.instruments);
  const exact64Request = requestWithInstruments(exact64);
  const exact64Counters = zeroCounters();
  assert.doesNotThrow(() => guardedPreflight(exact64Request, exact64Counters));
  assert.equal(exact64Counters.credentialReads, 1);
  assert.equal(exact64Counters.transportConstructions, 1);
  const exact64Preimage = requestIdentityPreimage(exact64Request) as Readonly<
    Record<string, JsonValue>
  >;
  assert.deepEqual(
    exact64Preimage["canonicalSymbols"],
    exact64.map((member) => member.canonicalSymbol),
  );
  assert.deepEqual(
    exact64Preimage["instrumentIds"],
    exact64
      .map((member) => member.instrumentId)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
  );

  const baselineFirst = BASE_INSTRUMENTS[0] as InstrumentMember;
  const baselineSecond = BASE_INSTRUMENTS[1] as InstrumentMember;
  const invalidInstrumentRequests: readonly Preflight[] = [
    requestWithInstruments([]),
    requestWithInstruments(allAuthorityMembers),
    requestWithInstruments([{ canonicalSymbol: "", instrumentId: baselineFirst.instrumentId }]),
    requestWithInstruments([baselineFirst, baselineFirst]),
    requestWithInstruments([
      {
        canonicalSymbol: "ZZZ",
        instrumentId: `min1_${"f".repeat(64)}`,
      },
    ]),
    requestWithInstruments([
      {
        canonicalSymbol: baselineFirst.canonicalSymbol,
        instrumentId: baselineSecond.instrumentId,
      },
    ]),
    requestWithInstruments([
      {
        canonicalSymbol: `${baselineFirst.canonicalSymbol},${baselineSecond.canonicalSymbol}`,
        instrumentId: baselineFirst.instrumentId,
      },
    ]),
    requestWithInstruments([...BASE_INSTRUMENTS].reverse()),
    {
      ...requestWithInstruments(BASE_INSTRUMENTS),
      fields: {
        ...requestWithInstruments(BASE_INSTRUMENTS).fields,
        symbols: baselineFirst.canonicalSymbol,
      },
    },
  ];
  for (const request of invalidInstrumentRequests) {
    assertGuardedPreflightReject(request, /instrument/u);
  }
  const intervalRequest = exactBoundaryRequest(0n);
  const queryStartNs = parseCanonicalNs(intervalRequest.fields["start"] as string);
  const queryStartMs = Number(queryStartNs / 1_000_000n);
  const gapRecord = syntheticAliasAuthorityRecord("GA", 0, {
    effectiveToNs: queryStartNs.toString(),
    effectiveToMs: queryStartMs,
    securityVersion: "gap",
  });
  const gapAuthority = [
    gapRecord,
    ...FROZEN_INSTRUMENT_REGISTRY.filter((record) => record.canonicalSymbol !== "GA"),
  ];
  assertGuardedPreflightReject(
    exactBoundaryRequest(0n),
    /instrument-effective-interval-gap/u,
    null,
    authorityCatalogWithRecords(gapAuthority),
  );
  const overlappingRecord = syntheticAliasAuthorityRecord("GA", 0, {
    securityVersion: "overlap",
  });
  assertGuardedPreflightReject(
    exactBoundaryRequest(0n),
    /instrument-effective-interval-ambiguous/u,
    null,
    authorityCatalogWithRecords([...FROZEN_INSTRUMENT_REGISTRY, overlappingRecord]),
  );

  const seedRequest = exactBoundaryRequest(0n);
  const seedJournal = new MemoryContractJournal();
  const seedModel = new AcquisitionContractModel(
    seedRequest,
    new ProviderDouble(
      ["amber", "cobalt", "fern"],
      ["t".repeat(LIMITS.tokenBytes), "synthetic-private-continuation-two"],
    ),
    new ArtifactDouble(),
    seedJournal,
  );
  assert.equal(await seedModel.run({ crashAt: "checkpoint-advanced" }), "crashed");
  const preceding = seedJournal
    .rows()
    .find((row) => row.event === "checkpoint.advanced")?.checkpoint;
  assert.ok(preceding !== undefined);
  assert.ok(preceding.nextResumableTokenMaterial !== null);
  const validContinuationRequest = continuationRequestForVerifiedPage(
    seedRequest,
    preceding,
    preceding.nextResumableTokenMaterial,
  );
  const continuationCounters = zeroCounters();
  assert.doesNotThrow(() =>
    guardedPreflight(validContinuationRequest, continuationCounters, preceding),
  );
  assert.equal(continuationCounters.credentialReads, 1);
  assert.equal(continuationCounters.transportConstructions, 1);

  const withContinuationMaterial = (
    material: string,
    mutate: (
      continuation: ContinuationMaterial,
      fields: Readonly<Record<string, string>>,
    ) => Readonly<{
      continuation: ContinuationMaterial | null;
      fields: Readonly<Record<string, string>>;
    }> = (continuation, fields) => ({ continuation, fields }),
  ): Preflight => {
    const prior = validContinuationRequest.continuation as ContinuationMaterial;
    const tokenHash = privateTokenHash(material);
    const binding = { ...prior.binding, nextTokenHash: tokenHash };
    const continuation: ContinuationMaterial = {
      ...prior,
      opaqueMaterial: material,
      tokenHash,
      binding,
      bindingHash: continuationBindingHash(binding),
    };
    const fields = { ...validContinuationRequest.fields, page_token: material };
    const mutated = mutate(continuation, fields);
    return {
      ...validContinuationRequest,
      continuation: mutated.continuation,
      fields: mutated.fields,
    };
  };
  assert.equal(
    Buffer.byteLength(
      (validContinuationRequest.continuation as ContinuationMaterial).opaqueMaterial,
      "utf8",
    ),
    LIMITS.tokenBytes,
  );

  const repeatedTokenHash = (validContinuationRequest.continuation as ContinuationMaterial)
    .tokenHash;
  const crossQueryRequest = withContinuationMaterial(
    (validContinuationRequest.continuation as ContinuationMaterial).opaqueMaterial,
    (continuation, fields) => {
      const binding = { ...continuation.binding, requestIdentityHash: hash("cross-query") };
      return {
        continuation: {
          ...continuation,
          binding,
          bindingHash: continuationBindingHash(binding),
        },
        fields,
      };
    },
  );
  const invalidContinuationRequests: readonly Preflight[] = [
    { ...validContinuationRequest, continuation: null },
    {
      ...validContinuationRequest,
      fields: withoutField(validContinuationRequest.fields, "page_token"),
    },
    withContinuationMaterial(""),
    withContinuationMaterial(
      (validContinuationRequest.continuation as ContinuationMaterial).opaqueMaterial,
      (continuation, fields) => ({
        continuation: { ...continuation, priorTokenHashes: [repeatedTokenHash] },
        fields,
      }),
    ),
    crossQueryRequest,
    withContinuationMaterial(
      (validContinuationRequest.continuation as ContinuationMaterial).opaqueMaterial,
      (continuation, fields) => ({
        continuation,
        fields: { ...fields, page_token: `${continuation.opaqueMaterial}-substituted` },
      }),
    ),
    withContinuationMaterial("t".repeat(LIMITS.tokenBytes + 1)),
  ];
  for (const request of invalidContinuationRequests) {
    assertGuardedPreflightReject(request, /page-token/u, preceding);
  }

  const mutateDurableBinding = (
    request: Preflight,
    mutate: (
      binding: ContinuationBindingPreimage,
      continuation: ContinuationMaterial,
    ) => Readonly<{
      binding: ContinuationBindingPreimage;
      opaqueMaterial?: string;
      pageOrdinal?: number;
    }>,
  ): Preflight => {
    const continuation = request.continuation as ContinuationMaterial;
    const mutation = mutate(continuation.binding, continuation);
    const opaqueMaterial = mutation.opaqueMaterial ?? continuation.opaqueMaterial;
    const tokenHash = privateTokenHash(opaqueMaterial);
    const binding = {
      ...mutation.binding,
      nextTokenHash:
        mutation.opaqueMaterial === undefined ? mutation.binding.nextTokenHash : tokenHash,
    };
    return {
      ...request,
      pageOrdinal: mutation.pageOrdinal ?? request.pageOrdinal,
      fields: { ...request.fields, page_token: opaqueMaterial },
      continuation: {
        ...continuation,
        opaqueMaterial,
        tokenHash,
        binding,
        bindingHash: continuationBindingHash(binding),
      },
    };
  };
  const durableBindingMutations: readonly [string, (request: Preflight) => Preflight][] = [
    [
      "next-page-ordinal",
      (request) =>
        mutateDurableBinding(request, (binding) => ({
          binding: { ...binding, nextPageOrdinal: binding.nextPageOrdinal + 1 },
          pageOrdinal: request.pageOrdinal + 1,
        })),
    ],
    [
      "preceding-market-acquisition",
      (request) =>
        mutateDurableBinding(request, (binding) => ({
          binding: { ...binding, precedingMarketAcquisitionId: `maq1_${"f".repeat(64)}` },
        })),
    ],
    [
      "preceding-logical-page",
      (request) =>
        mutateDurableBinding(request, (binding) => ({
          binding: { ...binding, precedingLogicalPageIdentityHash: "f".repeat(64) },
        })),
    ],
    [
      "preceding-artifact-observation",
      (request) =>
        mutateDurableBinding(request, (binding) => ({
          binding: {
            ...binding,
            precedingArtifactObservationId: "vault-observation-hostile-self-consistent",
          },
        })),
    ],
    [
      "preceding-artifact-digest",
      (request) =>
        mutateDurableBinding(request, (binding) => ({
          binding: { ...binding, precedingArtifactDigest: "e".repeat(64) },
        })),
    ],
    [
      "preceding-page-chain",
      (request) =>
        mutateDurableBinding(request, (binding) => ({
          binding: { ...binding, precedingPageChainHash: "d".repeat(64) },
        })),
    ],
    [
      "preceding-page-ordinal",
      (request) =>
        mutateDurableBinding(request, (binding) => ({
          binding: { ...binding, precedingPageOrdinal: binding.precedingPageOrdinal + 1 },
        })),
    ],
    [
      "request-identity",
      (request) =>
        mutateDurableBinding(request, (binding) => ({
          binding: { ...binding, requestIdentityHash: "c".repeat(64) },
        })),
    ],
    [
      "opaque-token-relation",
      (request) =>
        mutateDurableBinding(request, (binding, continuation) => ({
          binding,
          opaqueMaterial: `${continuation.opaqueMaterial}-hostile`,
        })),
    ],
  ];
  for (const [name, mutate] of durableBindingMutations) {
    assertGuardedPreflightReject(mutate(validContinuationRequest), /page-token/u, preceding);

    const uninterruptedProvider = new ProviderDouble();
    const uninterruptedModel = new AcquisitionContractModel(
      seedRequest,
      uninterruptedProvider,
      new ArtifactDouble(),
      new MemoryContractJournal(),
    );
    assert.equal(
      await uninterruptedModel.run({ continuationMutation: mutate }),
      "failed",
      `${name}:uninterrupted`,
    );
    assert.deepEqual(
      uninterruptedModel.counters,
      seedModel.counters,
      `${name}:uninterrupted-zero-dispatch-delta`,
    );
    assert.equal(uninterruptedProvider.requestCalls, 1, `${name}:uninterrupted-provider`);

    const restartProvider = new ProviderDouble();
    const restartModel = new AcquisitionContractModel(
      seedRequest,
      restartProvider,
      new ArtifactDouble(),
      new MemoryContractJournal(),
    );
    assert.equal(
      await restartModel.run({ crashAt: "checkpoint-advanced" }),
      "crashed",
      `${name}:restart-seed`,
    );
    const beforeRestartCounters = { ...restartModel.counters };
    const beforeRestartProviderCalls = restartProvider.requestCalls;
    await assert.rejects(
      () =>
        restartModel.resume(configurationHash(seedRequest), {
          continuationMutation: mutate,
        }),
      /page-token/u,
      `${name}:restart`,
    );
    assert.deepEqual(
      restartModel.counters,
      beforeRestartCounters,
      `${name}:restart-zero-dispatch-delta`,
    );
    assert.equal(
      restartProvider.requestCalls,
      beforeRestartProviderCalls,
      `${name}:restart-provider`,
    );
  }

  const integratedCountersModel = new AcquisitionContractModel(
    seedRequest,
    new ProviderDouble(),
    new ArtifactDouble(),
    new MemoryContractJournal(),
  );
  assert.equal(await integratedCountersModel.run(), "complete");
  assert.equal(integratedCountersModel.counters.credentialReads, 3);
  assert.equal(integratedCountersModel.counters.transportConstructions, 3);

  const canonicalLeap = {
    ...exactBoundaryRequest(0n),
    fields: {
      ...exactBoundaryRequest(0n).fields,
      start: "2000-02-29T00:00:00.123456789Z",
      end: "2000-02-29T00:00:00.123456789Z",
    },
  };
  assert.doesNotThrow(() => preflight(canonicalLeap));
  for (const timestamp of [
    "2026-02-30T00:00:00.000000000Z",
    "2025-02-29T00:00:00.000000000Z",
    "2026-04-31T00:00:00.000000000Z",
    "2026-13-01T00:00:00.000000000Z",
    "2026-01-01T24:00:00.000000000Z",
    "2026-01-01T00:00:60.000000000Z",
    "2026-01-32T00:00:00.000000000Z",
  ]) {
    const request = {
      ...exactBoundaryRequest(0n),
      fields: {
        ...exactBoundaryRequest(0n).fields,
        start: timestamp,
        end: timestamp,
      },
    };
    assertGuardedPreflightReject(request, /timestamp/u);
  }
});

test("literal alias-authority catalog roots every preimage, displayed ID, and closed configuration", () => {
  assert.equal(MODULE_ALIAS_AUTHORITY_CATALOG.catalogId, ALIAS_AUTHORITY_CATALOG_ID);
  assert.equal(MODULE_ALIAS_AUTHORITY_CATALOG.records.length, 65);
  assert.equal(MODULE_ALIAS_AUTHORITY_CATALOG_VALIDATED, true);
  assertRecursivelyFrozen(MODULE_ALIAS_AUTHORITY_CATALOG);
  assert.doesNotThrow(() =>
    validateAliasAuthorityCatalogIdentity(
      MODULE_ALIAS_AUTHORITY_CATALOG,
      ALIAS_AUTHORITY_CATALOG_ID,
    ),
  );
  const baselineRequest = exactBoundaryRequest(0n);
  assert.equal(
    (configurationPreimage(baselineRequest) as Readonly<Record<string, JsonValue>>)[
      "aliasAuthorityCatalogId"
    ],
    ALIAS_AUTHORITY_CATALOG_ID,
  );

  const firstRow = (catalog: DeepMutable<FrozenAliasAuthorityCatalog>) =>
    catalog.records[0] as DeepMutable<FrozenAliasAuthorityRecord>;
  const literalMutations: readonly Readonly<{
    name: string;
    mutate: (catalog: DeepMutable<FrozenAliasAuthorityCatalog>) => void;
  }>[] = [
    {
      name: "issuer-mapping-preimage",
      mutate: (catalog) => {
        firstRow(catalog).issuerMappingPreimage.mappingVersion = "v1-mutated";
      },
    },
    {
      name: "instrument-preimage",
      mutate: (catalog) => {
        firstRow(catalog).instrumentPreimage.securityKey = "fictional-security-mutated";
      },
    },
    {
      name: "symbol-alias-preimage",
      mutate: (catalog) => {
        firstRow(catalog).symbolAliasPreimage.mappingVersion = "v1-mutated";
      },
    },
    {
      name: "displayed-issuer-mapping-id",
      mutate: (catalog) => {
        firstRow(catalog).issuerMappingId = `imap1_${"f".repeat(64)}`;
      },
    },
    {
      name: "displayed-instrument-id",
      mutate: (catalog) => {
        firstRow(catalog).instrumentId = `min1_${"f".repeat(64)}`;
      },
    },
    {
      name: "displayed-symbol-alias-id",
      mutate: (catalog) => {
        firstRow(catalog).symbolAliasId = `msa1_${"f".repeat(64)}`;
      },
    },
    {
      name: "displayed-catalog-id",
      mutate: (catalog) => {
        catalog.catalogId = `maac1_${"f".repeat(64)}`;
      },
    },
  ];
  for (const mutation of literalMutations) {
    const catalog = mutableAliasAuthorityCatalogClone();
    mutation.mutate(catalog);
    assertGuardedPreflightReject(baselineRequest, /instrument/u, null, catalog);
  }

  const changedConfiguration = {
    ...baselineRequest,
    aliasAuthorityCatalogId: `maac1_${"f".repeat(64)}`,
  };
  const baselineConfigurationPreimage = configurationPreimage(baselineRequest) as Readonly<
    Record<string, JsonValue>
  >;
  const changedConfigurationPreimage = {
    ...baselineConfigurationPreimage,
    aliasAuthorityCatalogId: changedConfiguration.aliasAuthorityCatalogId,
  } satisfies JsonValue;
  assert.notEqual(
    canonicalHash("peas/market-acquisition-configuration/v1", changedConfigurationPreimage),
    configurationHash(baselineRequest),
  );
  assertGuardedPreflightReject(changedConfiguration, /identity-not-authorized/u);
});

test("outer-frozen mutable-inner external catalogs are snapshotted and revalidated every use", () => {
  const firstRow = (catalog: DeepMutable<FrozenAliasAuthorityCatalog>) =>
    catalog.records[0] as DeepMutable<FrozenAliasAuthorityRecord>;
  const mutationCases: readonly Readonly<{
    name: string;
    mutate: (catalog: DeepMutable<FrozenAliasAuthorityCatalog>) => void;
  }>[] = [
    {
      name: "row",
      mutate: (catalog) => {
        firstRow(catalog).canonicalSymbol = "GX";
      },
    },
    {
      name: "nested-preimage",
      mutate: (catalog) => {
        firstRow(catalog).issuerMappingPreimage.mappingAuthority =
          "peas-p1-10-original-synthetic-mutated";
      },
    },
    {
      name: "interval",
      mutate: (catalog) => {
        firstRow(catalog).symbolAliasPreimage.effectiveFromNs = "1";
      },
    },
    {
      name: "linkage",
      mutate: (catalog) => {
        firstRow(catalog).symbolAliasPreimage.instrumentId = `min1_${"e".repeat(64)}`;
      },
    },
    {
      name: "displayed-id",
      mutate: (catalog) => {
        firstRow(catalog).symbolAliasId = `msa1_${"e".repeat(64)}`;
      },
    },
  ];
  for (const mutationCase of mutationCases) {
    const mutableCatalog = mutableAliasAuthorityCatalogClone();
    const externalCatalog = Object.freeze({
      ...mutableCatalog,
      records: Object.freeze([...mutableCatalog.records]),
    }) as unknown as FrozenAliasAuthorityCatalog;
    assert.equal(Object.isFrozen(externalCatalog), true, mutationCase.name);
    assert.equal(Object.isFrozen(externalCatalog.records), true, mutationCase.name);
    assert.equal(Object.isFrozen(externalCatalog.records[0]), false, mutationCase.name);
    const admittedCounters = zeroCounters();
    assert.doesNotThrow(
      () => guardedPreflight(exactBoundaryRequest(0n), admittedCounters, null, externalCatalog),
      mutationCase.name,
    );
    assert.equal(admittedCounters.credentialReads, 1, mutationCase.name);
    assert.equal(admittedCounters.transportConstructions, 1, mutationCase.name);
    mutationCase.mutate(mutableCatalog);
    assertGuardedPreflightReject(exactBoundaryRequest(0n), /instrument/u, null, externalCatalog);
  }
});

test("trusted system-utc basis and same-session monotonic evidence fail closed at pre-dispatch", () => {
  const mutateClock = (mutate: (evidence: MutableTrustedClockEvidence) => void): unknown => {
    const evidence = structuredClone(
      baseTrustedClockEvidence(),
    ) as unknown as MutableTrustedClockEvidence;
    mutate(evidence);
    return evidence;
  };
  const omitClockField = (field: string): unknown => {
    const evidence = structuredClone(baseTrustedClockEvidence()) as Record<string, unknown>;
    delete evidence[field];
    return evidence;
  };
  const omitCurrentSampleField = (field: string): unknown => {
    const evidence = structuredClone(
      baseTrustedClockEvidence(),
    ) as unknown as MutableTrustedClockEvidence;
    delete (evidence.currentSample as unknown as Record<string, unknown>)[field];
    return evidence;
  };
  const omitPriorSampleField = (field: string): unknown => {
    const evidence = structuredClone(
      baseTrustedClockEvidence(),
    ) as unknown as MutableTrustedClockEvidence;
    delete (evidence.priorSample as unknown as Record<string, unknown>)[field];
    return evidence;
  };
  const vectors: readonly [string, () => unknown][] = [
    ["evidence-absent", () => undefined],
    ["evidence-null", () => null],
    ["availability-absent", () => omitClockField("available")],
    [
      "availability-null",
      () =>
        mutateClock((evidence) => {
          evidence.available = null as unknown as boolean;
        }),
    ],
    [
      "availability-wrong",
      () =>
        mutateClock((evidence) => {
          evidence.available = "true" as unknown as boolean;
        }),
    ],
    ["basis-id-absent", () => omitClockField("basisId")],
    [
      "basis-id-null",
      () =>
        mutateClock((evidence) => {
          evidence.basisId = null as unknown as string;
        }),
    ],
    [
      "basis-id-wrong",
      () =>
        mutateClock((evidence) => {
          evidence.basisId = "other-system-basis";
        }),
    ],
    ["wall-clock-absent", () => omitClockField("wallClock")],
    [
      "wall-clock-null",
      () =>
        mutateClock((evidence) => {
          evidence.wallClock = null as unknown as string;
        }),
    ],
    [
      "wall-clock-wrong",
      () =>
        mutateClock((evidence) => {
          evidence.wallClock = "local-time";
        }),
    ],
    ["synchronization-absent", () => omitClockField("synchronization")],
    [
      "synchronization-null",
      () =>
        mutateClock((evidence) => {
          evidence.synchronization = null as unknown as string;
        }),
    ],
    [
      "synchronization-wrong",
      () =>
        mutateClock((evidence) => {
          evidence.synchronization = "unverified";
        }),
    ],
    ["error-absent", () => omitClockField("maximumErrorNs")],
    ["error-bound-evidence-absent", () => omitClockField("maximumErrorBounded")],
    [
      "error-null",
      () =>
        mutateClock((evidence) => {
          evidence.maximumErrorNs = null;
        }),
    ],
    [
      "error-negative",
      () =>
        mutateClock((evidence) => {
          evidence.maximumErrorNs = -1n;
        }),
    ],
    [
      "error-wrong-type",
      () =>
        mutateClock((evidence) => {
          evidence.maximumErrorNs = "0" as unknown as bigint;
        }),
    ],
    [
      "error-unbounded",
      () =>
        mutateClock((evidence) => {
          evidence.maximumErrorBounded = false;
        }),
    ],
    [
      "error-over-signed-bound",
      () =>
        mutateClock((evidence) => {
          evidence.maximumErrorNs = MAX_SIGNED_CLOCK_NS + 1n;
        }),
    ],
    [
      "error-underflows-wall",
      () =>
        mutateClock((evidence) => {
          evidence.maximumErrorNs = CLOCK_CURRENT_WALL_NS + 1n;
        }),
    ],
    ["monotonic-clock-absent", () => omitClockField("monotonicClock")],
    ["monotonic-session-absent", () => omitClockField("monotonicSessionId")],
    ["prior-sample-absent", () => omitClockField("priorSample")],
    ["current-sample-absent", () => omitClockField("currentSample")],
    [
      "prior-sample-null",
      () =>
        mutateClock((evidence) => {
          evidence.priorSample = null as unknown as MutableTrustedClockSample;
        }),
    ],
    [
      "current-sample-null",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample = null as unknown as MutableTrustedClockSample;
        }),
    ],
    ["prior-sample-id-absent", () => omitPriorSampleField("sampleId")],
    ["prior-sample-link-absent", () => omitPriorSampleField("previousSampleId")],
    ["prior-sample-basis-link-absent", () => omitPriorSampleField("basisId")],
    ["current-sample-basis-link-absent", () => omitCurrentSampleField("basisId")],
    [
      "wall-regression",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.wallNs = evidence.priorSample.wallNs - 1n;
        }),
    ],
    [
      "monotonic-equality",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.monotonicUs = evidence.priorSample.monotonicUs;
        }),
    ],
    [
      "monotonic-regression",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.monotonicUs = evidence.priorSample.monotonicUs - 1n;
        }),
    ],
    [
      "sample-basis-link-absent",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.basisId = null as unknown as string;
        }),
    ],
    [
      "sample-basis-link-changed",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.basisId = "changed-system-basis";
        }),
    ],
    ["sample-id-absent", () => omitCurrentSampleField("sampleId")],
    ["sample-link-absent", () => omitCurrentSampleField("previousSampleId")],
    [
      "sample-link-changed",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.previousSampleId = "unrelated-sample";
        }),
    ],
    [
      "sample-wall-clock-changed",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.wallClock = "local-time";
        }),
    ],
    [
      "sample-synchronization-changed",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.synchronization = "unverified";
        }),
    ],
    [
      "monotonic-clock-wrong",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.monotonicClock = "wall-clock";
        }),
    ],
    [
      "monotonic-session-null",
      () =>
        mutateClock((evidence) => {
          evidence.monotonicSessionId = null as unknown as string;
        }),
    ],
    [
      "monotonic-session-changed",
      () =>
        mutateClock((evidence) => {
          evidence.currentSample.monotonicSessionId = "different-process-session";
        }),
    ],
  ];
  for (const [, evidence] of vectors) {
    assertGuardedPreflightReject(
      { ...exactBoundaryRequest(0n), trustedClockEvidence: evidence() },
      /clock/u,
    );
  }

  assert.doesNotThrow(() => preflight(exactBoundaryRequest(0n, 7n)));
  assertGuardedPreflightReject(exactBoundaryRequest(1n, 7n), /history-boundary/u);
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

test("first-page, cost, and credential ordering fail closed", () => {
  let credentialReads = 0;
  let calls = 0;
  const execute = (request: Preflight): void => {
    preflight(request);
    credentialReads += 1;
    calls += 1;
  };
  for (const request of [
    { ...exactBoundaryRequest(0n), liveEnabled: false },
    { ...exactBoundaryRequest(0n), authorizationMode: "" },
    { ...exactBoundaryRequest(0n), capability: "subscription-mutation" },
    { ...exactBoundaryRequest(0n), fallbackKind: "provider-default" },
    { ...exactBoundaryRequest(0n), zeroIncrementalSpend: false },
    { ...exactBoundaryRequest(0n), costStatus: "unknown" as const },
    {
      ...exactBoundaryRequest(0n),
      fields: { ...exactBoundaryRequest(0n).fields, page_token: "forbidden-first-page-token" },
    },
  ]) {
    assert.throws(() => execute(request));
  }
  assert.equal(credentialReads, 0);
  assert.equal(calls, 0);
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
  for (const from of ACQUISITION_STATES) {
    for (const [event, to] of Object.entries(ACQUISITION_EVENT_TARGETS) as [
      AcquisitionEventName,
      AcquisitionState,
    ][]) {
      const isRetryEvent = event === "retry-cleanup-complete";
      const needsIntegratedAttempt =
        (isRetryEvent && from === "attempt-active") ||
        (event === "begin-preflight" && from === "waiting-retry");
      const transitionModel = needsIntegratedAttempt
        ? new AcquisitionContractModel(
            exactBoundaryRequest(0n),
            new ProviderDouble(),
            new ArtifactDouble(),
            new MemoryContractJournal(),
          )
        : new AcquisitionContractModel(
            exactBoundaryRequest(0n),
            new ProviderDouble(),
            new ArtifactDouble(),
            new MemoryContractJournal(),
            from,
          );
      if (needsIntegratedAttempt) {
        transitionModel.applyAcquisitionEvent("begin-preflight");
        transitionModel.applyAcquisitionEvent("preflight-approved");
        transitionModel.applyAcquisitionEvent("credentials-loaded");
        transitionModel.applyAcquisitionEvent(
          "dispatch-started",
          transitionModel.exactEventEvidence(),
          { budgetDelta: { attempts: 1 }, attemptTime: 0 },
        );
      }
      if (event === "begin-preflight" && from === "waiting-retry") {
        const retryContext: RetryEventContext = {
          failure: "pre-response",
          pageAttemptNumber: 1,
          acquisitionAttemptCount: 1,
          retryAfter: null,
          quotaClassification: "missing",
        };
        transitionModel.applyAcquisitionEvent(
          "retry-cleanup-complete",
          transitionModel.exactEventEvidence(retryContext),
        );
      }
      const evidence = transitionModel.exactEventEvidence(
        isRetryEvent
          ? {
              failure: "pre-response",
              pageAttemptNumber: 1,
              acquisitionAttemptCount: transitionModel.budget.value.attempts,
              retryAfter: null,
              quotaClassification: "missing",
            }
          : null,
        event === "begin-preflight" && from === "waiting-retry"
          ? {
              retryDelayClockBasis: "same-session-monotonic",
              retryDelayElapsedMs: 1_000,
              retryDelayMonotonicOrderValid: true,
            }
          : {},
      );
      const eventAllowed =
        event === "normalization-page-emitted"
          ? from === "normalizing"
          : ACQUISITION_TRANSITIONS[from].includes(to);
      if (eventAllowed) {
        assert.doesNotThrow(
          () => transitionModel.applyAcquisitionEvent(event, evidence),
          `${from}:${event}`,
        );
        assert.equal(transitionModel.currentState, to);
      } else {
        assert.throws(
          () => transitionModel.applyAcquisitionEvent(event, evidence),
          /acquisition-transition-invalid/u,
          `${from}:${event}`,
        );
        assert.equal(transitionModel.currentState, from);
      }
    }
  }
  const evidenceModel = new AcquisitionContractModel(
    exactBoundaryRequest(0n),
    new ProviderDouble(),
    new ArtifactDouble(),
    new MemoryContractJournal(),
    "declared",
  );
  const beforeRejectedProof = canonicalJson(evidenceModel.coordinatorSnapshot());
  assert.throws(
    () =>
      evidenceModel.applyAcquisitionEvent(
        "begin-preflight",
        evidenceModel.exactEventEvidence(null, { pageChainValid: false }),
        {
          budgetDelta: { attempts: 1 },
          attemptTime: 1_000,
          counterDelta: { networkCalls: 1, providerCalls: 1 },
          journalEvent: "acquisition.declared",
        },
      ),
    /acquisition-event-proof-invalid/u,
  );
  assert.equal(
    canonicalJson(evidenceModel.coordinatorSnapshot()),
    beforeRejectedProof,
    "a rejected pre-side-effect proof must leave coordinator, journal, budgets, and counters byte-equivalent",
  );
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
  model.applyAcquisitionEvent("begin-preflight", model.exactEventEvidence(), {
    journalEvent: "acquisition.declared",
  });
  assert.throws(
    () => journal.append("selection.recorded", model.checkpoint()),
    /illegal-transition/u,
  );
  model.applyAcquisitionEvent("preflight-approved");
  model.applyAcquisitionEvent("credentials-loaded");
  model.applyAcquisitionEvent("dispatch-started", model.exactEventEvidence(), {
    budgetDelta: { attempts: 1 },
    attemptTime: 1_000,
    journalEvent: "request.started",
  });
  model.applyAcquisitionEvent("response-headers-accepted", model.exactEventEvidence(), {
    journalEvent: "request.succeeded",
  });
  model.applyAcquisitionEvent("technical-failure-settled", model.exactEventEvidence(), {
    journalEvent: "failure.recorded",
  });
  assert.throws(
    () => journal.append("request.started", model.checkpoint()),
    /checkpoint-transition-invalid/u,
  );

  const postStoreJournal = new MemoryContractJournal();
  const postStoreArtifact = new ArtifactDouble();
  const postStoreModel = new AcquisitionContractModel(
    exactBoundaryRequest(0n),
    new ProviderDouble(),
    postStoreArtifact,
    postStoreJournal,
  );
  postStoreModel.applyAcquisitionEvent("begin-preflight", postStoreModel.exactEventEvidence(), {
    journalEvent: "acquisition.declared",
  });
  postStoreModel.applyAcquisitionEvent("preflight-approved");
  postStoreModel.applyAcquisitionEvent("credentials-loaded");
  postStoreModel.applyAcquisitionEvent("dispatch-started", postStoreModel.exactEventEvidence(), {
    budgetDelta: { attempts: 1 },
    attemptTime: 1_000,
    journalEvent: "request.started",
  });
  postStoreModel.applyAcquisitionEvent(
    "response-headers-accepted",
    postStoreModel.exactEventEvidence(),
    { journalEvent: "request.succeeded" },
  );
  postStoreModel.applyAcquisitionEvent("artifact-store-started");
  const orphanReceipt = postStoreArtifact.store(Buffer.from("synthetic-orphan-proof"));
  const afterStoreBeforeRejectedCommit = canonicalJson(postStoreModel.coordinatorSnapshot());
  assert.throws(
    () =>
      postStoreModel.applyAcquisitionEvent(
        "artifact-store-committed",
        postStoreModel.exactEventEvidence(),
        {
          currentReceipt: orphanReceipt,
          counterDelta: { artifactCalls: 1 },
          journalEvent: "artifact.committed",
          checkpointOverrides: { artifactDigest: hash("forged-post-store-digest") },
        },
      ),
    /checkpoint-artifact-binding-invalid/u,
  );
  assert.equal(
    canonicalJson(postStoreModel.coordinatorSnapshot()),
    afterStoreBeforeRejectedCommit,
    "a failed durable receipt proof cannot invent a cross-store rollback",
  );
  assert.equal(postStoreModel.currentState, "artifact-committing");
  assert.equal(
    postStoreJournal.rows().some((row) => row.event === "artifact.committed"),
    false,
  );
  assert.equal(postStoreArtifact.receipts.length, 1);
  assert.equal(postStoreArtifact.orphanDigests.length, 1);
  postStoreArtifact.reconcileOrphans();
  assert.equal(postStoreArtifact.receipts.length, 1);
  assert.equal(postStoreArtifact.orphanDigests.length, 0);
  assert.equal(postStoreArtifact.orphanReconciliations, 1);

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
  const request = exactBoundaryRequest(0n);
  const attemptRows = rows.filter((row) => row.event === "request.started");
  const committedRows = rows.filter((row) => row.event === "artifact.committed");
  const admittedRows = rows.filter((row) => row.event === "checkpoint.advanced");
  const sidecars: ImmutableReceiptSidecars = {
    attempts: attemptRows.map((row) => ({
      attemptId: attemptIdentity(
        logicalPageIdentityHash(
          requestIdentity(request),
          row.checkpoint.pageOrdinal,
          row.checkpoint.pageOrdinal === 0 ? null : row.checkpoint.currentTokenHash,
        ),
        row.checkpoint.attemptOrdinal,
      ).attemptId,
      ordinal: row.checkpoint.attemptOrdinal,
    })),
    artifacts: artifact.receipts.map((receipt) => {
      const committed = committedRows.find(
        (row) => row.checkpoint.artifactObservationId === receipt.observationId,
      );
      assert.ok(committed !== undefined);
      const identities = artifactIdentities(receipt, committed.checkpoint.acquisitionObservationId);
      return {
        observationId: receipt.observationId,
        digest: receipt.digest,
        sizeBytes: receipt.bytes.byteLength,
        observationHash: identities.artifactObservationHash,
        contentId: identities.artifactContentId,
        rawArtifactId: identities.rawArtifactId,
      };
    }),
    admittedPages: admittedRows.map((row) => ({
      marketAcquisitionId: marketAcquisitionIdentity(
        request,
        acquisitionObservationIdentity(request, row.checkpoint.retrievalAttemptId),
      ),
      pageOrdinal: row.checkpoint.pageOrdinal,
      recordCount: new ProviderDouble().recordCount(row.checkpoint.pageOrdinal),
      artifactDigest: row.checkpoint.artifactDigest as string,
    })),
    normalizations: [{ factCount: 3 }, { factCount: 0 }, { factCount: 2 }],
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
  const forgedRows: JournalRow[] = [];
  const firstCommitIndex = rows.findIndex((candidate) => candidate.event === "artifact.committed");
  const firstAdmissionIndex = rows.findIndex(
    (candidate) => candidate.event === "checkpoint.advanced",
  );
  for (const row of rows) {
    const afterCommit = firstCommitIndex <= row.sequence;
    const afterAdmission = firstAdmissionIndex <= row.sequence;
    const draft = {
      ...row.checkpoint,
      artifactSizeBytes:
        row.checkpoint.artifactSizeBytes === null
          ? null
          : row.checkpoint.artifactSizeBytes + (afterCommit ? 1 : 0),
      cumulativeVerifiedBytes: row.checkpoint.cumulativeVerifiedBytes + (afterAdmission ? 1 : 0),
      priorJournalEntryHash: forgedRows.at(-1)?.checkpoint.journalEntryHash ?? "genesis",
      journalEntryHash: "",
    };
    const forgedCheckpoint = {
      ...draft,
      journalEntryHash: deriveJournalEntryHash(draft),
    };
    forgedRows.push({ sequence: row.sequence, event: row.event, checkpoint: forgedCheckpoint });
  }
  assert.throws(() => validateJournalRows(forgedRows), /checkpoint-artifact-binding-invalid/u);
  assert.throws(() => validateImmutableReceiptSidecars(forgedRows, sidecars));
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

  const activeAttemptModel = (quotaEntitlementLimit: number = LIMITS.rateAttempts) => {
    const model = new AcquisitionContractModel(
      exactBoundaryRequest(0n),
      new ProviderDouble(),
      new ArtifactDouble(),
      new MemoryContractJournal(),
      "declared",
      quotaEntitlementLimit,
    );
    model.applyAcquisitionEvent("begin-preflight");
    model.applyAcquisitionEvent("preflight-approved");
    model.applyAcquisitionEvent("credentials-loaded");
    model.applyAcquisitionEvent("dispatch-started", model.exactEventEvidence(), {
      budgetDelta: { attempts: 1 },
      attemptTime: 0,
    });
    return model;
  };
  const firstRetryContext: RetryEventContext = {
    failure: "pre-response",
    pageAttemptNumber: 1,
    acquisitionAttemptCount: 1,
    retryAfter: null,
    quotaClassification: "missing",
  };
  const rejectedRetryContexts: readonly RetryEventContext[] = [
    ...([400, 401, 403, 404, 409, 422] as const).map((status) => ({
      ...firstRetryContext,
      failure: `http-${status}` as const,
    })),
    ...(["quota-exhausted", "ambiguous", "missing"] as const).map(
      (quotaClassification): RetryEventContext => ({
        ...firstRetryContext,
        failure: "http-429",
        retryAfter: "1",
        quotaClassification,
      }),
    ),
    ...(["-1", "Wed, 21 Oct 2015 07:28:00 GMT", "1.5", "31"] as const).map(
      (retryAfter): RetryEventContext => ({
        ...firstRetryContext,
        failure: "http-429",
        retryAfter,
        quotaClassification: "temporary-throttling-proved",
      }),
    ),
    { ...firstRetryContext, failure: "schema" },
    { ...firstRetryContext, failure: "artifact" },
    { ...firstRetryContext, pageAttemptNumber: LIMITS.pageAttempts },
    { ...firstRetryContext, acquisitionAttemptCount: LIMITS.attempts },
  ];
  for (const retryContext of rejectedRetryContexts) {
    const model = activeAttemptModel();
    const before = canonicalJson(model.coordinatorSnapshot());
    assert.equal(retryEventDecision(retryContext).kind, "stop");
    assert.throws(
      () =>
        model.applyAcquisitionEvent(
          "retry-cleanup-complete",
          model.exactEventEvidence(retryContext),
        ),
      /acquisition-event-retry-proof-invalid/u,
      canonicalJson(retryContext as unknown as JsonValue),
    );
    assert.equal(canonicalJson(model.coordinatorSnapshot()), before);
  }

  const wrongDelayModel = activeAttemptModel();
  const beforeWrongDelay = canonicalJson(wrongDelayModel.coordinatorSnapshot());
  assert.throws(
    () =>
      wrongDelayModel.applyAcquisitionEvent(
        "retry-cleanup-complete",
        wrongDelayModel.exactEventEvidence(firstRetryContext, {
          retryDecision: { kind: "retry", delayMs: 2_000 },
        }),
      ),
    /acquisition-event-proof-invalid/u,
  );
  assert.equal(canonicalJson(wrongDelayModel.coordinatorSnapshot()), beforeWrongDelay);

  const exactRetryAfterModel = activeAttemptModel();
  const exactRetryAfterContext: RetryEventContext = {
    ...firstRetryContext,
    failure: "http-429",
    retryAfter: "30",
    quotaClassification: "temporary-throttling-proved",
  };
  const exactRetryAfterEvidence = exactRetryAfterModel.exactEventEvidence(exactRetryAfterContext);
  assert.deepEqual(exactRetryAfterEvidence.retryDecision, {
    kind: "retry",
    delayMs: LIMITS.retryAfterMs,
  });
  assert.doesNotThrow(() =>
    exactRetryAfterModel.applyAcquisitionEvent("retry-cleanup-complete", exactRetryAfterEvidence),
  );
  assert.equal(exactRetryAfterModel.currentState, "waiting-retry");
  assert.equal(exactRetryAfterModel.pendingRetryDelayMs, LIMITS.retryAfterMs);
  assert.doesNotThrow(() =>
    exactRetryAfterModel.applyAcquisitionEvent(
      "begin-preflight",
      exactRetryAfterModel.exactEventEvidence(null, {
        retryDelayClockBasis: "same-session-monotonic",
        retryDelayElapsedMs: LIMITS.retryAfterMs,
        retryDelayMonotonicOrderValid: true,
      }),
    ),
  );
  assert.equal(exactRetryAfterModel.pendingRetryDelayMs, null);

  for (const retryDelayProof of [
    {
      retryDelayClockBasis: "same-session-monotonic",
      retryDelayElapsedMs: 999,
      retryDelayMonotonicOrderValid: true,
    },
    {
      retryDelayClockBasis: "same-session-monotonic",
      retryDelayElapsedMs: 1_001,
      retryDelayMonotonicOrderValid: true,
    },
    {
      retryDelayClockBasis: null,
      retryDelayElapsedMs: null,
      retryDelayMonotonicOrderValid: null,
    },
    {
      retryDelayClockBasis: "wall-clock",
      retryDelayElapsedMs: 1_000,
      retryDelayMonotonicOrderValid: true,
    },
    {
      retryDelayClockBasis: "same-session-monotonic",
      retryDelayElapsedMs: 1_000,
      retryDelayMonotonicOrderValid: false,
    },
  ] as const) {
    const model = activeAttemptModel();
    model.applyAcquisitionEvent(
      "retry-cleanup-complete",
      model.exactEventEvidence(firstRetryContext),
    );
    const before = canonicalJson(model.coordinatorSnapshot());
    assert.throws(
      () =>
        model.applyAcquisitionEvent(
          "begin-preflight",
          model.exactEventEvidence(null, retryDelayProof),
        ),
      /acquisition-retry-delay-proof-invalid/u,
    );
    assert.equal(canonicalJson(model.coordinatorSnapshot()), before);
  }

  const exactDeadlineModel = new AcquisitionContractModel(
    exactBoundaryRequest(0n),
    new ProviderDouble(),
    new ArtifactDouble(),
    new MemoryContractJournal(),
  );
  assert.doesNotThrow(() =>
    exactDeadlineModel.applyAcquisitionEvent(
      "begin-preflight",
      exactDeadlineModel.exactEventEvidence(null, {
        attemptElapsedMs: LIMITS.attemptDeadlineMs,
        acquisitionElapsedMs: LIMITS.acquisitionDeadlineMs,
      }),
    ),
  );
  const ordinaryPreflightModel = new AcquisitionContractModel(
    exactBoundaryRequest(0n),
    new ProviderDouble(),
    new ArtifactDouble(),
    new MemoryContractJournal(),
  );
  const beforeUnexpectedRetryProof = canonicalJson(ordinaryPreflightModel.coordinatorSnapshot());
  assert.throws(
    () =>
      ordinaryPreflightModel.applyAcquisitionEvent(
        "begin-preflight",
        ordinaryPreflightModel.exactEventEvidence(null, {
          retryDelayClockBasis: "same-session-monotonic",
          retryDelayElapsedMs: 1_000,
          retryDelayMonotonicOrderValid: true,
        }),
      ),
    /acquisition-retry-delay-proof-unexpected/u,
  );
  assert.equal(
    canonicalJson(ordinaryPreflightModel.coordinatorSnapshot()),
    beforeUnexpectedRetryProof,
  );
  for (const elapsedOverrides of [
    {
      attemptElapsedMs: LIMITS.attemptDeadlineMs + 1,
      acquisitionElapsedMs: LIMITS.acquisitionDeadlineMs,
    },
    {
      attemptElapsedMs: LIMITS.attemptDeadlineMs,
      acquisitionElapsedMs: LIMITS.acquisitionDeadlineMs + 1,
    },
  ]) {
    const model = new AcquisitionContractModel(
      exactBoundaryRequest(0n),
      new ProviderDouble(),
      new ArtifactDouble(),
      new MemoryContractJournal(),
    );
    const before = canonicalJson(model.coordinatorSnapshot());
    assert.throws(
      () =>
        model.applyAcquisitionEvent(
          "begin-preflight",
          model.exactEventEvidence(null, elapsedOverrides),
        ),
      /acquisition-event-proof-invalid/u,
    );
    assert.equal(canonicalJson(model.coordinatorSnapshot()), before);
  }

  const identityModel = activeAttemptModel();
  const firstAttemptCheckpoint = identityModel.checkpoint();
  identityModel.applyAcquisitionEvent(
    "retry-cleanup-complete",
    identityModel.exactEventEvidence(firstRetryContext),
  );
  identityModel.applyAcquisitionEvent(
    "begin-preflight",
    identityModel.exactEventEvidence(null, {
      retryDelayClockBasis: "same-session-monotonic",
      retryDelayElapsedMs: 1_000,
      retryDelayMonotonicOrderValid: true,
    }),
    {
      currentAttemptOrdinal: 1,
    },
  );
  identityModel.applyAcquisitionEvent("preflight-approved");
  identityModel.applyAcquisitionEvent("credentials-loaded");
  identityModel.applyAcquisitionEvent("dispatch-started", identityModel.exactEventEvidence(), {
    budgetDelta: { attempts: 1 },
    attemptTime: 1_000,
  });
  const secondAttemptCheckpoint = identityModel.checkpoint();
  assert.equal(
    secondAttemptCheckpoint.logicalPageIdentityHash,
    firstAttemptCheckpoint.logicalPageIdentityHash,
  );
  assert.notEqual(secondAttemptCheckpoint.attemptId, firstAttemptCheckpoint.attemptId);
  assert.notEqual(
    secondAttemptCheckpoint.retrievalAttemptId,
    firstAttemptCheckpoint.retrievalAttemptId,
  );
  assert.notEqual(
    secondAttemptCheckpoint.acquisitionObservationId,
    firstAttemptCheckpoint.acquisitionObservationId,
  );
  assert.notEqual(
    secondAttemptCheckpoint.marketAcquisitionId,
    firstAttemptCheckpoint.marketAcquisitionId,
  );
  const secondRetryContext: RetryEventContext = {
    ...firstRetryContext,
    pageAttemptNumber: 2,
    acquisitionAttemptCount: 2,
  };
  const secondRetryEvidence = identityModel.exactEventEvidence(secondRetryContext);
  assert.deepEqual(secondRetryEvidence.retryDecision, { kind: "retry", delayMs: 2_000 });
  identityModel.applyAcquisitionEvent("retry-cleanup-complete", secondRetryEvidence);
  identityModel.applyAcquisitionEvent(
    "begin-preflight",
    identityModel.exactEventEvidence(null, {
      retryDelayClockBasis: "same-session-monotonic",
      retryDelayElapsedMs: 2_000,
      retryDelayMonotonicOrderValid: true,
    }),
    {
      currentAttemptOrdinal: 2,
    },
  );
  identityModel.applyAcquisitionEvent("preflight-approved");
  identityModel.applyAcquisitionEvent("credentials-loaded");
  identityModel.applyAcquisitionEvent("dispatch-started", identityModel.exactEventEvidence(), {
    budgetDelta: { attempts: 1 },
    attemptTime: 2_000,
  });
  const exhaustedPageContext: RetryEventContext = {
    ...firstRetryContext,
    pageAttemptNumber: LIMITS.pageAttempts,
    acquisitionAttemptCount: 3,
  };
  const beforeExhaustedPage = canonicalJson(identityModel.coordinatorSnapshot());
  assert.equal(retryEventDecision(exhaustedPageContext).kind, "stop");
  assert.throws(
    () =>
      identityModel.applyAcquisitionEvent(
        "retry-cleanup-complete",
        identityModel.exactEventEvidence(exhaustedPageContext),
      ),
    /acquisition-event-retry-proof-invalid/u,
  );
  assert.equal(canonicalJson(identityModel.coordinatorSnapshot()), beforeExhaustedPage);

  const quotaModel = activeAttemptModel(1);
  quotaModel.applyAcquisitionEvent(
    "retry-cleanup-complete",
    quotaModel.exactEventEvidence(firstRetryContext),
  );
  quotaModel.applyAcquisitionEvent(
    "begin-preflight",
    quotaModel.exactEventEvidence(null, {
      retryDelayClockBasis: "same-session-monotonic",
      retryDelayElapsedMs: 1_000,
      retryDelayMonotonicOrderValid: true,
    }),
    {
      currentAttemptOrdinal: 1,
    },
  );
  quotaModel.applyAcquisitionEvent("preflight-approved");
  quotaModel.applyAcquisitionEvent("credentials-loaded");
  const beforeQuotaRejection = canonicalJson(quotaModel.coordinatorSnapshot());
  assert.throws(
    () =>
      quotaModel.applyAcquisitionEvent("dispatch-started", quotaModel.exactEventEvidence(), {
        budgetDelta: { attempts: 1 },
        attemptTime: 1_000,
      }),
    /acquisition-event-quota-bound/u,
  );
  assert.equal(canonicalJson(quotaModel.coordinatorSnapshot()), beforeQuotaRejection);
});

test("provider/body/schema/store/read fault doubles enforce cleanup and causal journal writes", async () => {
  const cases: readonly [string, AcquisitionFault][] = [
    ["timeout-before-headers", { timeoutBeforeHeaders: true }],
    ["timeout-during-body", { bodyFailureAt: 0 }],
    ["active-wall-regression", { activeClockFault: "wall-regression" }],
    ["active-monotonic-regression", { activeClockFault: "monotonic-regression" }],
    ["active-changed-basis", { activeClockFault: "changed-basis" }],
    ["active-wrong-synchronization", { activeClockFault: "wrong-synchronization" }],
    ["active-absent-error", { activeClockFault: "absent-error" }],
    ["active-unbounded-error", { activeClockFault: "unbounded-error" }],
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
    const request = exactBoundaryRequest(0n);
    const requestClock = request.trustedClockEvidence as MutableTrustedClockEvidence;
    const model = new AcquisitionContractModel(request, provider, artifact, journal);
    assert.equal(model.activeClock.requestAuthority.basisId, requestClock.basisId, name);
    assert.equal(
      model.activeClock.requestAuthority.monotonicSessionId,
      requestClock.monotonicSessionId,
      name,
    );
    assert.equal(
      model.activeClock.requestAuthority.currentWallNs,
      requestClock.currentSample.wallNs,
      name,
    );
    assert.equal(
      model.activeClock.evidence.priorSample.sampleId,
      requestClock.currentSample.sampleId,
      name,
    );
    assert.equal(
      model.activeClock.evidence.priorSample.wallNs,
      requestClock.currentSample.wallNs,
      name,
    );
    assert.equal(
      model.activeClock.evidence.priorSample.monotonicUs,
      requestClock.currentSample.monotonicUs,
      name,
    );
    assert.equal(await model.run(fault), "failed", name);
    const events = journal.rows().map((row) => row.event);
    assert.equal(events.at(-1), "failure.recorded", name);
    assert.equal(events.includes("selection.recorded"), false, name);
    if (fault.bodyFailureAt !== undefined || fault.activeClockFault !== undefined) {
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
      fault.activeClockFault !== undefined ||
      fault.schemaFailure
    ) {
      assert.equal(events.includes("artifact.committed"), false, name);
    }
    if (fault.storeFailure) assert.equal(events.includes("artifact.committed"), false, name);
    if (fault.readFailure) {
      assert.equal(events.includes("artifact.committed"), true, name);
      assert.equal(events.includes("artifact.verified"), false, name);
    }
    if (fault.activeClockFault !== undefined) {
      const terminal = journal.rows().at(-1)?.checkpoint;
      assert.ok(terminal !== undefined, name);
      assert.match(terminal.terminalReasonCode ?? "", /^clock-(regression|unavailable)$/u, name);
      assert.equal(model.counters.artifactCalls, 0, name);
      assert.equal(model.counters.normalizationCalls, 0, name);
      assert.equal(model.counters.selectionCalls, 0, name);
      assert.equal(model.counters.postReturnActivity, 0, name);
      const settledJournal = canonicalJson(journal.rows() as unknown as JsonValue);
      const settledCounters = { ...model.counters };
      await Promise.resolve();
      assert.equal(canonicalJson(journal.rows() as unknown as JsonValue), settledJournal, name);
      assert.deepEqual(model.counters, settledCounters, name);
      if (fault.activeClockFault === "changed-basis") {
        assert.notEqual(
          model.activeClock.evidence.currentSample.basisId,
          model.activeClock.requestAuthority.basisId,
          name,
        );
      }
    }
  }
});

test("integrated pagination accepts physical dedup but rejects duplicate deliveries, positions, substitutions, loops, and post-terminal pages", async () => {
  const requestHash = hash("closed-logical-request");
  const first: Page = {
    ordinal: 0,
    deliveryObservationId: "synthetic-delivery-observation-0",
    requestHash,
    precedingHash: null,
    nextHash: hash("continuation-1"),
    digest: hash("page-0"),
    records: 1,
  };
  const second: Page = {
    ordinal: 1,
    deliveryObservationId: "synthetic-delivery-observation-1",
    requestHash,
    precedingHash: first.nextHash,
    nextHash: null,
    digest: first.digest,
    records: 1,
  };
  assert.equal(verifyChain([first, second], requestHash).length, 2);
  const attacks: readonly Page[][] = [
    [first, { ...second, precedingHash: hash("gap") }],
    [first, { ...second, ordinal: 0 }],
    [first, { ...second, requestHash: hash("substitution") }],
    [first, { ...second, deliveryObservationId: first.deliveryObservationId }],
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
  for (const [paginationFault, exactCalls] of [
    ["loop", 2],
    ["substitution", 1],
    ["gap", 1],
    ["duplicate-position", 1],
    ["duplicate-page", 2],
    ["page-after-terminal", 3],
  ] as const) {
    const provider = new ProviderDouble();
    const journal = new MemoryContractJournal();
    const model = new AcquisitionContractModel(
      exactBoundaryRequest(0n),
      provider,
      new ArtifactDouble(),
      journal,
    );
    const outcome = await model.run({ paginationFault }).catch(() => "closed-rejection" as const);
    assert.notEqual(outcome, "complete", paginationFault);
    assert.equal(provider.requestCalls, exactCalls, paginationFault);
    const events = journal.rows().map((row) => row.event);
    assert.equal(events.includes("selection.recorded"), false, paginationFault);
    if (paginationFault === "page-after-terminal") {
      const terminalIndex = events.indexOf("chain.complete");
      assert.ok(terminalIndex >= 0);
      assert.equal(
        events.slice(terminalIndex + 1).includes("acquisition.declared"),
        false,
        "a terminal chain cannot be extended with another declared page",
      );
      assert.equal(
        provider.requestCalls,
        provider.pageCount(),
        "the rejected page-after-terminal event performs zero additional dispatch",
      );
    }
  }
  const completedArtifact = new ArtifactDouble();
  const completed = new AcquisitionContractModel(
    exactBoundaryRequest(0n),
    new ProviderDouble(),
    completedArtifact,
    new MemoryContractJournal(),
  );
  assert.equal(await completed.run(), "complete");
  assert.equal(completedArtifact.receipts[0]?.digest, completedArtifact.receipts[1]?.digest);
  assert.notEqual(
    completedArtifact.receipts[0]?.observationId,
    completedArtifact.receipts[1]?.observationId,
    "identical physical bytes remain valid only as distinct delivery observations",
  );
  assert.throws(
    () => completed.applyAcquisitionEvent("begin-preflight"),
    /acquisition-transition-invalid/u,
  );
});

test("frozen acquisition/request identities exclude page layout while private configuration and page hashes bind it", () => {
  const request = exactBoundaryRequest(0n);
  const changedLimitRequest = {
    ...request,
    fields: { ...request.fields, limit: "7" },
  };
  const requestIdentityHash = requestIdentity(request);
  assert.equal(requestIdentity(changedLimitRequest), requestIdentityHash);
  assert.notEqual(configurationHash(request), configurationHash(changedLimitRequest));
  const firstPage = logicalPageIdentityHash(requestIdentityHash, 0, null);
  const continuationHash = privateTokenHash("synthetic-private-continuation-one");
  const secondPage = logicalPageIdentityHash(requestIdentityHash, 1, continuationHash);
  assert.notEqual(firstPage, secondPage);
  const firstAttempt = attemptIdentity(secondPage, 0);
  const retryAttempt = attemptIdentity(secondPage, 1);
  assert.match(firstAttempt.attemptId, /^mat1_[0-9a-f]{64}$/u);
  assert.match(firstAttempt.retrievalAttemptId, /^rat1_[0-9a-f]{64}$/u);
  assert.notEqual(firstAttempt.attemptId, retryAttempt.attemptId);
  const initialAcquisitionObservation = acquisitionObservationIdentity(
    request,
    firstAttempt.retrievalAttemptId,
  );
  const retryAcquisitionObservation = acquisitionObservationIdentity(
    request,
    retryAttempt.retrievalAttemptId,
  );
  const initialMarketAcquisitionId = marketAcquisitionIdentity(
    request,
    initialAcquisitionObservation,
  );
  const retryMarketAcquisitionId = marketAcquisitionIdentity(request, retryAcquisitionObservation);
  assert.match(initialMarketAcquisitionId, /^maq1_[0-9a-f]{64}$/u);
  assert.notEqual(initialMarketAcquisitionId, retryMarketAcquisitionId);
  assert.equal(
    marketAcquisitionIdentity(changedLimitRequest, initialAcquisitionObservation),
    initialMarketAcquisitionId,
    "page-limit configuration must not enter the frozen PR 2D acquisition preimage",
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
    const callsByPageAtCrash = new Map(provider.requestsByPage);
    const committedPagesAtCrash = new Set(
      journal
        .rows()
        .filter((row) => row.event === "artifact.committed")
        .map((row) => row.checkpoint.pageOrdinal),
    );
    const readsAtCrash = artifact.readCalls;
    await model.resume(configurationHash(request));
    const events = journal.rows().map((row) => row.event);
    assert.equal(events.at(-1), "selection.recorded", crashAt);
    assert.equal(events.filter((event) => event === "selection.recorded").length, 1, crashAt);
    const remainingDispatches = Array.from(
      { length: provider.pageCount() },
      (_, pageOrdinal) => pageOrdinal,
    ).filter((pageOrdinal) => !committedPagesAtCrash.has(pageOrdinal)).length;
    assert.equal(provider.requestCalls, callsAtCrash + remainingDispatches, crashAt);
    for (const pageOrdinal of committedPagesAtCrash) {
      assert.equal(
        provider.requestsByPage.get(pageOrdinal),
        callsByPageAtCrash.get(pageOrdinal),
        `${crashAt}: verified/committed page ${pageOrdinal} must not redispatch`,
      );
    }
    if (remainingDispatches === 0) {
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
  const baselineArtifact = new ArtifactDouble();
  const baselineModel = new AcquisitionContractModel(
    request,
    new ProviderDouble(),
    baselineArtifact,
    baselineJournal,
  );
  assert.equal(await baselineModel.run(), "complete");
  const baselineRows = baselineJournal.rows();
  const durableObservationReceipts = baselineArtifact.receipts.map((receipt) => ({
    ...receipt,
    bytes: Uint8Array.from(receipt.bytes),
  }));
  assert.equal(durableObservationReceipts.length, 3);
  assert.equal(new Set(durableObservationReceipts.map((receipt) => receipt.observationId)).size, 3);
  assert.equal(
    new Set(durableObservationReceipts.map((receipt) => receipt.digest)).size,
    2,
    "two distinct delivery observations physically deduplicate identical page bytes",
  );
  const orders = [
    ["amber", "cobalt", "fern"],
    ["fern", "amber", "cobalt"],
    ["cobalt", "fern", "amber"],
  ] as const;

  const restoreArtifact = (
    rows: readonly JournalRow[],
    enumerationPageSize: number,
    direction: "asc" | "desc",
  ): ArtifactDouble => {
    const artifact = new ArtifactDouble();
    const committedObservationIds = new Set(
      rows
        .filter((row) => row.event === "artifact.committed")
        .map((row) => row.checkpoint.artifactObservationId),
    );
    const selected = durableObservationReceipts
      .filter((receipt) => committedObservationIds.has(receipt.observationId))
      .sort((left, right) =>
        direction === "asc"
          ? left.deliveryOrdinal - right.deliveryOrdinal
          : right.deliveryOrdinal - left.deliveryOrdinal,
      );
    for (let offset = 0; offset < selected.length; offset += enumerationPageSize) {
      for (const receipt of selected.slice(offset, offset + enumerationPageSize)) {
        artifact.restore(receipt);
      }
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
      const direction = cutoff % 2 === 0 ? "asc" : "desc";

      const memoryJournal = new MemoryContractJournal();
      appendRows(memoryJournal, prefix, backendPageSize);
      const memoryProvider = new ProviderDouble(order);
      const memoryArtifact = restoreArtifact(prefix, backendPageSize, direction);
      const memoryModel = new AcquisitionContractModel(
        request,
        memoryProvider,
        memoryArtifact,
        memoryJournal,
      );
      const expectedDecision = restartDecision(prefix);
      await memoryModel.resume(configurationHash(request));

      const filename = join(directory, `checkpoint-${cutoff}.sqlite`);
      let sqliteJournal = new SqliteContractJournal(filename, backendPageSize, direction);
      appendRows(sqliteJournal, prefix, backendPageSize);
      sqliteJournal.close();
      sqliteJournal = new SqliteContractJournal(filename, backendPageSize, direction);
      assert.equal(restartDecision(sqliteJournal.rows()), expectedDecision);
      const sqliteProvider = new ProviderDouble(order);
      const sqliteArtifact = restoreArtifact(
        sqliteJournal.rows(),
        backendPageSize,
        direction === "asc" ? "desc" : "asc",
      );
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
