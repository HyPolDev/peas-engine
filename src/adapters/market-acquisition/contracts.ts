import { canonicalHash } from "../../core/hash.js";
import type { JsonValue } from "../../core/json.js";

export const ACCEPTED_PR_2E_CANDIDATE_SHA = "f16ea4fcec1eda1126e9a3e446c77b76ddf15678" as const;
export const AUTHORIZATION_MODE = "p1-09-approved" as const;
export const ROUTE_POLICY_VERSION = "p1-10-frozen-historical-multi-symbol-v1" as const;
export const ZERO_SPEND_POLICY_VERSION = "p1-10-zero-spend-policy-v1" as const;

export const MARKET_ACQUISITION_LIMITS = Object.freeze({
  concurrentProviderRequests: 1,
  rawArtifactBytes: 10 * 1024 * 1024,
  aggregateVerifiedBytes: 64 * 1024 * 1024,
  successfulPages: 16,
  recordsPerPage: 10_000,
  normalizedFacts: 160_000,
  opaquePageTokenBytes: 4_096,
  instruments: 64,
  historicalCalendarDates: 8,
  attemptsPerAcquisition: 48,
  attemptsPerLogicalPage: 3,
  retryAfterMs: 30_000,
  attemptDeadlineMs: 30_000,
  acquisitionDeadlineMs: 300_000,
  rateAttempts: 30,
  rateWindowMs: 60_000,
} as const);

export const MARKET_ACQUISITION_TERMINAL_REASONS = Object.freeze([
  "authority-invalid",
  "lane-not-authorized",
  "lane-not-implemented",
  "capability-not-authorized",
  "configuration-invalid",
  "identity-mismatch",
  "query-invalid",
  "zero-spend-unprovable",
  "credential-unavailable",
  "clock-unavailable",
  "clock-regression",
  "historical-boundary-unprovable",
  "concurrency-exhausted",
  "quota-exhausted",
  "attempt-budget-exhausted",
  "page-budget-exhausted",
  "acquisition-deadline",
  "attempt-timeout",
  "retry-after-invalid",
  "transport-failed",
  "http-nonretryable",
  "lane-disabled",
  "partial-cleanup-failed",
  "artifact-store-failed",
  "artifact-verification-failed",
  "response-length-mismatch",
  "schema-invalid",
  "bound-exceeded",
  "pagination-invalid",
  "journal-conflict",
  "delivery-conflict",
  "correction-unsupported",
  "normalization-failed",
  "selection-failed",
  "operator-stop",
] as const);

export type MarketAcquisitionTerminalReason = (typeof MARKET_ACQUISITION_TERMINAL_REASONS)[number];

export const MARKET_ACQUISITION_OPERATION_STAGES = Object.freeze([
  "configuration",
  "authority",
  "identity",
  "request-preflight",
  "trusted-time",
  "request-started",
  "credential-load",
  "dispatch",
  "response-headers",
  "response-body",
  "cleanup",
  "artifact-commit",
  "artifact-verify",
  "checkpoint",
  "normalization",
  "selection",
  "retention-stop",
  "retention-plan",
  "retention-erase",
  "retention-verify",
] as const);

export type MarketAcquisitionOperationStage = (typeof MARKET_ACQUISITION_OPERATION_STAGES)[number];

export const SAFE_DETAIL_KINDS = Object.freeze([
  "none",
  "input-shape-invalid",
  "authority-invalid",
  "identity-mismatch",
  "source-not-authorized",
  "lane-not-implemented",
  "live-disabled",
  "zero-spend-unprovable",
  "query-invalid",
  "bound-exceeded",
  "clock-unavailable",
  "clock-regression",
  "historical-boundary-unprovable",
] as const);

export type SafeDetailKind = (typeof SAFE_DETAIL_KINDS)[number];

export type MarketAcquisitionSafeError = Readonly<{
  reasonCode: MarketAcquisitionTerminalReason;
  operationStage: MarketAcquisitionOperationStage;
  detailHash: string;
}>;

export function createMarketAcquisitionSafeError(
  reasonCode: MarketAcquisitionTerminalReason,
  operationStage: MarketAcquisitionOperationStage,
  detailKind: SafeDetailKind = "none",
): MarketAcquisitionSafeError {
  const safeReasonCode = MARKET_ACQUISITION_TERMINAL_REASONS.includes(reasonCode)
    ? reasonCode
    : "configuration-invalid";
  const safeOperationStage = MARKET_ACQUISITION_OPERATION_STAGES.includes(operationStage)
    ? operationStage
    : "configuration";
  const safeDetailKind = SAFE_DETAIL_KINDS.includes(detailKind) ? detailKind : "none";
  const detailPreimage = Object.freeze({ detailKind: safeDetailKind }) satisfies JsonValue;
  return Object.freeze({
    reasonCode: safeReasonCode,
    operationStage: safeOperationStage,
    detailHash: canonicalHash("peas/market-acquisition-safe-detail/v1", detailPreimage),
  });
}

export type MarketAcquisitionResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: MarketAcquisitionSafeError }>;

export type AlpacaAcquisitionKind = "quotes" | "trades" | "bars";
export type MarketAcquisitionLane = "alpaca-historical-sip" | "fmp-private-discrepancy";

export type FrozenInstrumentRequest = Readonly<{
  instrumentId: string;
  symbol: string;
}>;

export type TrustedClockSample = Readonly<{
  sampleId: string;
  previousSampleId: string | null;
  basisId: string;
  wallClock: "system-utc";
  synchronization: "verified-bound";
  wallNs: bigint;
  monotonicClock: "process-monotonic-us";
  monotonicSessionId: string;
  monotonicUs: bigint;
}>;

export type TrustedClockEvidence = Readonly<{
  available: true;
  basisId: string;
  wallClock: "system-utc";
  synchronization: "verified-bound";
  maximumErrorNs: bigint;
  maximumErrorBounded: true;
  monotonicClock: "process-monotonic-us";
  monotonicSessionId: string;
  priorSample: TrustedClockSample;
  currentSample: TrustedClockSample;
}>;

export type AlpacaQueryFields = Readonly<{
  symbols: string;
  start: string;
  end: string;
  limit: string;
  feed: "sip";
  sort: "asc";
  timeframe?: "1Min";
  adjustment?: "raw";
}>;

export type MarketAcquisitionConfigurationInput = Readonly<{
  schemaVersion: 1;
  acceptedContractCandidateSha: string;
  lane: MarketAcquisitionLane;
  kind: AlpacaAcquisitionKind;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  entitlementSnapshotId: string;
  routePolicyVersion: string;
  aliasAuthorityCatalogId: string;
  instruments: readonly FrozenInstrumentRequest[];
  queryFields: unknown;
  trustedClockEvidence: unknown;
  liveEnabled: boolean;
  authorizationMode: string;
  capability: string;
  sourceRole: string;
  fallbackKind: string;
  zeroIncrementalSpend: boolean;
  costStatus: string;
  zeroSpendPolicyId: string;
  zeroSpendPolicyPreimage: unknown;
  runDecision: string;
  retentionPolicyReadiness: string;
}>;

export type CompiledMarketRoute = Readonly<{
  lane: MarketAcquisitionLane;
  kind: AlpacaAcquisitionKind | "aftermarket-quote" | "aftermarket-trade";
  method: "GET";
  origin: string;
  path: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  safeRouteLabel: string;
}>;

export type ValidatedMarketAcquisitionConfiguration = Readonly<{
  schemaVersion: 1;
  acceptedContractCandidateSha: typeof ACCEPTED_PR_2E_CANDIDATE_SHA;
  lane: "alpaca-historical-sip";
  kind: AlpacaAcquisitionKind;
  route: CompiledMarketRoute;
  entitlementSnapshotId: string;
  aliasAuthorityCatalogId: string;
  instruments: readonly FrozenInstrumentRequest[];
  queryFields: AlpacaQueryFields;
  queryStartNs: bigint;
  queryEndNs: bigint;
  trustedRequestStartedAtNs: bigint;
  trustedClockEvidence: TrustedClockEvidence;
  requestIdentityHash: string;
  acquisitionConfigurationHash: string;
  liveEnabled: true;
  authorizationMode: typeof AUTHORIZATION_MODE;
  capability: "historical-market-reference";
  sourceRole: "primary";
  fallbackKind: "none";
  zeroIncrementalSpend: true;
  costStatus: "zero-incremental-spend-approved";
  zeroSpendPolicyId: string;
  runDecision: "allow";
  retentionPolicyReadiness: "ready";
}>;
