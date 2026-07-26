import { Buffer } from "node:buffer";

import { canonicalHash } from "../../core/hash.js";
import type { JsonValue } from "../../core/json.js";
import {
  deriveEndpointChannelId,
  deriveMarketDatasetId,
  deriveMarketFeedId,
  deriveMarketProviderId,
} from "../../providers/market-reference/identity.js";
import {
  MARKET_ACQUISITION_LIMITS,
  type AlpacaAcquisitionKind,
  type CompiledMarketRoute,
  type FrozenInstrumentRequest,
} from "./contracts.js";

export const FROZEN_MARKET_IDENTITIES = Object.freeze({
  alpaca: Object.freeze({
    providerId: "mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c",
    datasetId: "mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1",
    feedId: "mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023",
    quotesChannelId: "mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0",
    tradesChannelId: "mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1",
    barsChannelId: "mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c",
  }),
  fmp: Object.freeze({
    providerId: "mpv1_526c731d81a453ab057fd6f946e49291d0863350d319a73893d46e34b2a51a7a",
    datasetId: "mds1_eaaa286ff4841f43275131aca2abb17fad3ab78cbe3af49921a36a3249439f68",
    feedId: "mfd1_582a672a4109841f0ef80d286021e1e827d4a5f050059e22c87d08c842d0051b",
    quoteChannelId: "mec1_1e1c2239cce268ea690a82bd3f3ff6148bbd2bb8bb288c57a2e2cdf79cf8f1cd",
    tradeChannelId: "mec1_feb9f3a3deab6dbabd6fcc204c8ced63d88a2ca14d8f235b1fec2dab49df6bdf",
  }),
} as const);

const ALPACA_PROVIDER_PREIMAGE = Object.freeze({
  providerCode: "alpaca",
  serviceOperatorCode: "alpaca-markets",
});
const ALPACA_DATASET_PREIMAGE = Object.freeze({
  providerId: FROZEN_MARKET_IDENTITIES.alpaca.providerId,
  assetClass: "us-equity",
  coverageRegion: "united-states",
  productFamily: "historical-stock-market-data",
  apiGeneration: "v2",
  recordFamily: "quotes-trades-bars",
  datasetDocumentationVersion: "official-reference-2026-07-25",
} as const);
const ALPACA_FEED_PREIMAGE = Object.freeze({
  datasetId: FROZEN_MARKET_IDENTITIES.alpaca.datasetId,
  providerFeedCode: "sip",
  consolidationKind: "sip-consolidated",
  delayClass: "historical",
  adjustmentMode: "raw",
  correctionRepresentation: "unknown",
} as const);

const FMP_PROVIDER_PREIMAGE = Object.freeze({
  providerCode: "financial-modeling-prep",
  serviceOperatorCode: "financial-modeling-prep",
});
const FMP_DATASET_PREIMAGE = Object.freeze({
  providerId: FROZEN_MARKET_IDENTITIES.fmp.providerId,
  assetClass: "us-equity",
  coverageRegion: "united-states",
  productFamily: "premium-market-reference-discrepancy",
  apiGeneration: "stable",
  recordFamily: "aftermarket-quote-trade",
  datasetDocumentationVersion: "official-stable-docs-2026-07-25",
} as const);
const FMP_FEED_PREIMAGE = Object.freeze({
  datasetId: FROZEN_MARKET_IDENTITIES.fmp.datasetId,
  providerFeedCode: "exchanges-and-third-party-providers",
  consolidationKind: "unknown",
  delayClass: "provider-defined",
  adjustmentMode: "unknown",
  correctionRepresentation: "unknown",
} as const);

function endpointPreimage(
  feedId: string,
  channelKind: "historical-rest" | "latest-rest",
  safeRouteLabel: string,
  endpointDocumentationVersion: string,
  paginationKind: "opaque-token" | "none-documented",
  factKind: "quote" | "trade" | "bar",
) {
  return Object.freeze({
    feedId,
    channelKind,
    methodKind: "get" as const,
    safeRouteLabel,
    endpointDocumentationVersion,
    paginationKind,
    factKinds: Object.freeze([factKind]),
  });
}

const ALPACA_ENDPOINT_PREIMAGES = Object.freeze({
  quotes: endpointPreimage(
    FROZEN_MARKET_IDENTITIES.alpaca.feedId,
    "historical-rest",
    "alpaca-v2-historical-quotes",
    "official-reference-2026-07-25",
    "opaque-token",
    "quote",
  ),
  trades: endpointPreimage(
    FROZEN_MARKET_IDENTITIES.alpaca.feedId,
    "historical-rest",
    "alpaca-v2-historical-trades",
    "official-reference-2026-07-25",
    "opaque-token",
    "trade",
  ),
  bars: endpointPreimage(
    FROZEN_MARKET_IDENTITIES.alpaca.feedId,
    "historical-rest",
    "alpaca-v2-historical-bars",
    "official-reference-2026-07-25",
    "opaque-token",
    "bar",
  ),
});
const FMP_ENDPOINT_PREIMAGES = Object.freeze({
  quote: endpointPreimage(
    FROZEN_MARKET_IDENTITIES.fmp.feedId,
    "latest-rest",
    "fmp-stable-aftermarket-quote",
    "official-stable-docs-2026-07-25",
    "none-documented",
    "quote",
  ),
  trade: endpointPreimage(
    FROZEN_MARKET_IDENTITIES.fmp.feedId,
    "latest-rest",
    "fmp-stable-aftermarket-trade",
    "official-stable-docs-2026-07-25",
    "none-documented",
    "trade",
  ),
});

export const ALPACA_ROUTE_REGISTRY: Readonly<Record<AlpacaAcquisitionKind, CompiledMarketRoute>> =
  Object.freeze({
    quotes: Object.freeze({
      lane: "alpaca-historical-sip",
      kind: "quotes",
      method: "GET",
      origin: "https://data.alpaca.markets",
      path: "/v2/stocks/quotes",
      providerId: FROZEN_MARKET_IDENTITIES.alpaca.providerId,
      datasetId: FROZEN_MARKET_IDENTITIES.alpaca.datasetId,
      feedId: FROZEN_MARKET_IDENTITIES.alpaca.feedId,
      endpointChannelId: FROZEN_MARKET_IDENTITIES.alpaca.quotesChannelId,
      safeRouteLabel: "alpaca-v2-historical-quotes",
    }),
    trades: Object.freeze({
      lane: "alpaca-historical-sip",
      kind: "trades",
      method: "GET",
      origin: "https://data.alpaca.markets",
      path: "/v2/stocks/trades",
      providerId: FROZEN_MARKET_IDENTITIES.alpaca.providerId,
      datasetId: FROZEN_MARKET_IDENTITIES.alpaca.datasetId,
      feedId: FROZEN_MARKET_IDENTITIES.alpaca.feedId,
      endpointChannelId: FROZEN_MARKET_IDENTITIES.alpaca.tradesChannelId,
      safeRouteLabel: "alpaca-v2-historical-trades",
    }),
    bars: Object.freeze({
      lane: "alpaca-historical-sip",
      kind: "bars",
      method: "GET",
      origin: "https://data.alpaca.markets",
      path: "/v2/stocks/bars",
      providerId: FROZEN_MARKET_IDENTITIES.alpaca.providerId,
      datasetId: FROZEN_MARKET_IDENTITIES.alpaca.datasetId,
      feedId: FROZEN_MARKET_IDENTITIES.alpaca.feedId,
      endpointChannelId: FROZEN_MARKET_IDENTITIES.alpaca.barsChannelId,
      safeRouteLabel: "alpaca-v2-historical-bars",
    }),
  });

export const FMP_DISABLED_ROUTE_REGISTRY = Object.freeze({
  quote: Object.freeze({
    lane: "fmp-private-discrepancy",
    kind: "aftermarket-quote",
    method: "GET",
    origin: "https://financialmodelingprep.com",
    path: "/stable/aftermarket-quote",
    providerId: FROZEN_MARKET_IDENTITIES.fmp.providerId,
    datasetId: FROZEN_MARKET_IDENTITIES.fmp.datasetId,
    feedId: FROZEN_MARKET_IDENTITIES.fmp.feedId,
    endpointChannelId: FROZEN_MARKET_IDENTITIES.fmp.quoteChannelId,
    safeRouteLabel: "fmp-stable-aftermarket-quote",
  }),
  trade: Object.freeze({
    lane: "fmp-private-discrepancy",
    kind: "aftermarket-trade",
    method: "GET",
    origin: "https://financialmodelingprep.com",
    path: "/stable/aftermarket-trade",
    providerId: FROZEN_MARKET_IDENTITIES.fmp.providerId,
    datasetId: FROZEN_MARKET_IDENTITIES.fmp.datasetId,
    feedId: FROZEN_MARKET_IDENTITIES.fmp.feedId,
    endpointChannelId: FROZEN_MARKET_IDENTITIES.fmp.tradeChannelId,
    safeRouteLabel: "fmp-stable-aftermarket-trade",
  }),
} as const);

export const ZERO_SPEND_POLICY_PREIMAGE = Object.freeze({
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
} as const);

export const ZERO_SPEND_POLICY_ID =
  "mzp1_b2f575e234dcd7f05eb5fcc03060420313b56e45aff87c961c3771d1c5cf3b9e";

export function validateFrozenMarketIdentityRegistry(): void {
  const actual = [
    deriveMarketProviderId(ALPACA_PROVIDER_PREIMAGE),
    deriveMarketDatasetId(ALPACA_DATASET_PREIMAGE),
    deriveMarketFeedId(ALPACA_FEED_PREIMAGE),
    deriveEndpointChannelId(ALPACA_ENDPOINT_PREIMAGES.quotes),
    deriveEndpointChannelId(ALPACA_ENDPOINT_PREIMAGES.trades),
    deriveEndpointChannelId(ALPACA_ENDPOINT_PREIMAGES.bars),
    deriveMarketProviderId(FMP_PROVIDER_PREIMAGE),
    deriveMarketDatasetId(FMP_DATASET_PREIMAGE),
    deriveMarketFeedId(FMP_FEED_PREIMAGE),
    deriveEndpointChannelId(FMP_ENDPOINT_PREIMAGES.quote),
    deriveEndpointChannelId(FMP_ENDPOINT_PREIMAGES.trade),
  ];
  const expected = [
    FROZEN_MARKET_IDENTITIES.alpaca.providerId,
    FROZEN_MARKET_IDENTITIES.alpaca.datasetId,
    FROZEN_MARKET_IDENTITIES.alpaca.feedId,
    FROZEN_MARKET_IDENTITIES.alpaca.quotesChannelId,
    FROZEN_MARKET_IDENTITIES.alpaca.tradesChannelId,
    FROZEN_MARKET_IDENTITIES.alpaca.barsChannelId,
    FROZEN_MARKET_IDENTITIES.fmp.providerId,
    FROZEN_MARKET_IDENTITIES.fmp.datasetId,
    FROZEN_MARKET_IDENTITIES.fmp.feedId,
    FROZEN_MARKET_IDENTITIES.fmp.quoteChannelId,
    FROZEN_MARKET_IDENTITIES.fmp.tradeChannelId,
  ];
  if (actual.some((value, index) => value !== expected[index])) {
    throw new Error("frozen market acquisition identity registry mismatch");
  }
  const zeroSpendPolicyId = `mzp1_${canonicalHash(
    "peas/market-zero-spend-policy/v1",
    ZERO_SPEND_POLICY_PREIMAGE,
  )}`;
  if (zeroSpendPolicyId !== ZERO_SPEND_POLICY_ID) {
    throw new Error("frozen zero-spend identity mismatch");
  }
}

export type RequestIdentityInput = Readonly<{
  route: CompiledMarketRoute;
  entitlementSnapshotId: string;
  instruments: readonly FrozenInstrumentRequest[];
  factFamily: AlpacaAcquisitionKind;
  queryStartNs: bigint;
  queryEndNs: bigint;
  authorizationMode: "p1-09-approved";
}>;

export function deriveMarketAcquisitionRequestIdentity(input: RequestIdentityInput): string {
  const instrumentIds = input.instruments
    .map(({ instrumentId }) => instrumentId)
    .sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  const canonicalSymbols = input.instruments.map(({ symbol }) => symbol);
  const preimage = {
    providerId: input.route.providerId,
    datasetId: input.route.datasetId,
    feedId: input.route.feedId,
    endpointChannelId: input.route.endpointChannelId,
    entitlementSnapshotId: input.entitlementSnapshotId,
    authorizationMode: input.authorizationMode,
    instrumentIds,
    canonicalSymbols,
    factFamily: input.factFamily,
    queryStartNs: input.queryStartNs.toString(),
    queryEndNs: input.queryEndNs.toString(),
    semanticFixedFields: {
      feed: "sip",
      sort: "asc",
      timeframe: input.factFamily === "bars" ? "1Min" : null,
      adjustment: input.factFamily === "bars" ? "raw" : null,
    },
    routePolicyVersion: "p1-10-frozen-historical-multi-symbol-v1",
  } satisfies JsonValue;
  return canonicalHash("peas/market-acquisition-request/v1", preimage);
}

export type AcquisitionConfigurationIdentityInput = Readonly<{
  requestIdentityHash: string;
  requestedPageLimit: number;
  liveEnabled: true;
  zeroSpendPolicyId: string;
  runDecision: "allow";
  aliasAuthorityCatalogId: string;
  retentionPolicyReadiness: "ready";
}>;

export function deriveMarketAcquisitionConfigurationIdentity(
  input: AcquisitionConfigurationIdentityInput,
): string {
  const preimage = {
    requestIdentityHash: input.requestIdentityHash,
    requestedPageLimit: input.requestedPageLimit,
    effectiveLesserOfEntitlementAndProjectCeilings: {
      concurrentRequests: MARKET_ACQUISITION_LIMITS.concurrentProviderRequests,
      rawArtifactBytes: MARKET_ACQUISITION_LIMITS.rawArtifactBytes,
      aggregateBytes: MARKET_ACQUISITION_LIMITS.aggregateVerifiedBytes,
      pages: MARKET_ACQUISITION_LIMITS.successfulPages,
      recordsPerPage: MARKET_ACQUISITION_LIMITS.recordsPerPage,
      facts: MARKET_ACQUISITION_LIMITS.normalizedFacts,
      tokenBytes: MARKET_ACQUISITION_LIMITS.opaquePageTokenBytes,
      instruments: MARKET_ACQUISITION_LIMITS.instruments,
      spanDays: MARKET_ACQUISITION_LIMITS.historicalCalendarDates,
      attempts: MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition,
      pageAttempts: MARKET_ACQUISITION_LIMITS.attemptsPerLogicalPage,
      retryAfterMs: MARKET_ACQUISITION_LIMITS.retryAfterMs,
      attemptDeadlineMs: MARKET_ACQUISITION_LIMITS.attemptDeadlineMs,
      acquisitionDeadlineMs: MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs,
      rateAttempts: MARKET_ACQUISITION_LIMITS.rateAttempts,
      rateWindowMs: MARKET_ACQUISITION_LIMITS.rateWindowMs,
    },
    runScopedLiveEnableDecision: input.liveEnabled,
    zeroSpendPolicyIdAndDecision: {
      policyId: input.zeroSpendPolicyId,
      decision: input.runDecision,
    },
    aliasAuthorityCatalogId: input.aliasAuthorityCatalogId,
    retryPolicyVersion: "p1-10-deterministic-1s-2s-no-jitter-v1",
    quotaPolicyVersion: "p1-10-30-per-rolling-60s-v1",
    deadlinePolicyVersion: "p1-10-30s-attempt-300s-acquisition-v1",
    retentionPolicyReadiness: input.retentionPolicyReadiness,
    journalSchemaVersion: 1,
  } satisfies JsonValue;
  return canonicalHash("peas/market-acquisition-configuration/v1", preimage);
}

validateFrozenMarketIdentityRegistry();
