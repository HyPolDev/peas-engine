import { Buffer } from "node:buffer";

import { canonicalJson, type JsonValue } from "../../core/json.js";
import { snapshotExactNormalizerInput } from "../normalizer-input.js";

export const MARKET_CONTRACT_AUTHORITY_REGISTRY_ID =
  "car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad";

export const MARKET_REFERENCE_KINDS = Object.freeze([
  "bar-one-minute-completed-close",
  "bolo",
  "closing-trade",
  "daily-bar-close",
  "final-eligible-trade-close",
  "listing-official-open",
  "opening-trade",
  "prior-listing-official-close",
  "quote-nbbo-midpoint",
  "reopening-trade",
  "trade-last-eligible-consolidated",
] as const);

export type MarketReferenceKindV1 = (typeof MARKET_REFERENCE_KINDS)[number];
export type MarketViewKindV1 = "recorded-primary" | "recorded-corrected";
export type MarketReferenceResultStatusV1 = "selected-complete" | "selected-degraded" | "missing";
export type MarketEvaluationStatusV1 = MarketReferenceResultStatusV1 | "rejected";
export type MarketSessionKindV1 =
  | "regular-continuous"
  | "official-open-auction"
  | "official-close-auction"
  | "extended-pre"
  | "extended-post"
  | "overnight"
  | "halted"
  | "calendar-closed"
  | "unknown";

export type CanonicalDecimalV1 = Readonly<{
  coefficient: string;
  scale: number;
  negative: boolean;
}>;

export type CanonicalRationalV1 = Readonly<{
  numerator: string;
  denominator: string;
}>;

export type MarketTimestampV1 = Readonly<{
  epochNs: string;
  semantic:
    | "participant-publication"
    | "member-execution"
    | "sip-publication"
    | "provider-documented-event"
    | "provider-receive"
    | "earnings-publication"
    | "peas-retrieval"
    | "peas-durable-capture"
    | "correction-effective"
    | "correction-arrival"
    | "bar-start"
    | "bar-end"
    | "calendar-boundary"
    | "replay-preserved";
  precisionNs: string;
}>;

export type ProviderSequenceV1 = Readonly<{
  value: string;
  scope: string;
  trustClass:
    | "native-gap-checked"
    | "provider-stable-sequence"
    | "native-unchecked"
    | "deterministic-artifact-order"
    | "none";
}>;

export const MARKET_BOUND_IDS = Object.freeze([
  "aggregateVerifiedBytes",
  "artifactsPerAcquisition",
  "calendarDatesPerManifest",
  "candidatesPerReferenceSelection",
  "canonicalExecutionBundleBytes",
  "canonicalRecordBytes",
  "canonicalSidecarRecordBytes",
  "conditionMemberBytes",
  "conditionMembers",
  "deliveriesPerProviderObservation",
  "factsPerAcquisition",
  "genericStringBytes",
  "historicalQueryWindow",
  "identifierBytes",
  "instrumentsPerAcquisition",
  "intervalsPerCluster",
  "marketCentersPerInstrumentState",
  "opaqueProviderIdBytes",
  "pageTokenInputBytes",
  "pagesPerAcquisition",
  "parserTokensPerArtifact",
  "primaryResidualHorizonNs",
  "primaryResidualTargets",
  "providerOrDatasetCodeBytes",
  "providersPerSelectionPolicy",
  "rawArtifactBytes",
  "rawDecimalTokenBytes",
  "rawJsonArrayItems",
  "rawJsonDepth",
  "rawJsonKeysPerObject",
  "rawJsonNodes",
  "recordedReplayPageSize",
  "recordsPerArtifactOrPage",
  "referenceResultsPerCluster",
  "revisionDepthPerFamily",
  "selectionSearchWindowMs",
  "sidecarDepth",
  "sidecarEdgesPerExecution",
  "sidecarGenericArrayItems",
  "sidecarKeysPerObject",
  "sidecarNodes",
  "sidecarRecordsPerExecution",
  "symbolBytes",
  "timestampTextBytes",
] as const);

export type MarketBoundIdV1 = (typeof MARKET_BOUND_IDS)[number];

export const CANONICAL_BOUND_IDS = Object.freeze([
  "rawArtifactBytes",
  "aggregateVerifiedBytes",
  "artifactsPerAcquisition",
  "pagesPerAcquisition",
  "recordsPerArtifactOrPage",
  "factsPerAcquisition",
  "canonicalRecordBytes",
  "rawJsonDepth",
  "rawJsonNodes",
  "rawJsonKeysPerObject",
  "rawJsonArrayItems",
  "parserTokensPerArtifact",
  "sidecarDepth",
  "sidecarNodes",
  "sidecarKeysPerObject",
  "sidecarGenericArrayItems",
  "genericStringBytes",
  "identifierBytes",
  "providerOrDatasetCodeBytes",
  "symbolBytes",
  "timestampTextBytes",
  "pageTokenInputBytes",
  "opaqueProviderIdBytes",
  "conditionMembers",
  "conditionMemberBytes",
  "rawDecimalTokenBytes",
  "rawDecimalScale",
  "primaryCoefficientDigits",
  "primarySourceScale",
  "derivedMidpointScale",
  "rationalComponentBytes",
  "instrumentsPerAcquisition",
  "providersPerSelectionPolicy",
  "marketCentersPerInstrumentState",
  "revisionDepthPerFamily",
  "deliveriesPerProviderObservation",
  "candidatesPerReferenceSelection",
  "intervalsPerCluster",
  "referenceResultsPerCluster",
  "sidecarRecordsPerExecution",
  "sidecarEdgesPerExecution",
  "canonicalSidecarRecordBytes",
  "canonicalExecutionBundleBytes",
  "recordedReplayPageSize",
  "historicalQueryWindow",
  "selectionSearchWindowMs",
  "primaryResidualTargets",
  "primaryResidualHorizonNs",
  "regularQuoteAgeNs",
  "extendedQuoteAgeNs",
  "barDurationNs",
  "captureRetrievalLagMs",
  "calendarDatesPerManifest",
  "targetClusters",
  "laneTargets",
  "controlTargets",
  "candidateFrameMembers",
  "frameDispositionOrStratumCells",
  "selectedClusterEntryBytes",
  "completeStudyManifestBytes",
  "datasetFreezeBundleBytes",
  "studyJsonDepth",
  "studyJsonNodesTotal",
  "studyKeysPerObject",
  "studyGenericArrayItems",
  "studyStringBytes",
  "studyIdentifierBytes",
  "contractSourceEntitlementIds",
  "reasonDefinitions",
  "metricDefinitions",
  "sensitivityDefinitions",
  "referencesPerCluster",
  "referencesTotal",
  "annotationsPerCluster",
  "revisionsReferencedPerCluster",
  "strataDimensions",
  "collectionSessions",
  "collectionCalendarSpanMs",
  "liquidityHistorySessions",
  "minimumValidLiquiditySessions",
  "timelyObservationMs",
  "correctionLagMs",
  "bootstrapReplicates",
  "holmSlots",
] as const);

export type CanonicalBoundIdV1 = (typeof CANONICAL_BOUND_IDS)[number];
export type BoundVectorKindV1 =
  | "exact"
  | "upper-one-over"
  | "lower-one-below"
  | "exact-count-minus-one";
export type BoundAtomicityV1 = "operation" | "candidate" | "metric" | "study-run";
export type BoundViolationKindV1 =
  | "market-bound"
  | "market-input"
  | "market-decimal"
  | "market-quote-stale"
  | "market-timestamp-insufficient"
  | "study-bound"
  | "study-input"
  | "study-liquidity-unknown"
  | "study-timeliness-not-met"
  | "study-correction-after-cutoff";

export type BoundEnforcementRuleV1 = Readonly<{
  boundId: CanonicalBoundIdV1;
  stage: string;
  atomicity: BoundAtomicityV1;
  exactValue: string;
  upperViolation: BoundViolationKindV1 | null;
  schemaUpperViolation: BoundViolationKindV1 | null;
  lowerViolation: BoundViolationKindV1 | null;
  countMinusOneViolation: BoundViolationKindV1 | null;
}>;

const BOUND_EXACT_VALUES: Readonly<Record<CanonicalBoundIdV1, string>> = Object.freeze({
  rawArtifactBytes: "10485760",
  aggregateVerifiedBytes: "67108864",
  artifactsPerAcquisition: "16",
  pagesPerAcquisition: "16",
  recordsPerArtifactOrPage: "10000",
  factsPerAcquisition: "160000",
  canonicalRecordBytes: "65536",
  rawJsonDepth: "32",
  rawJsonNodes: "250000",
  rawJsonKeysPerObject: "64",
  rawJsonArrayItems: "10000",
  parserTokensPerArtifact: "250000",
  sidecarDepth: "8",
  sidecarNodes: "512",
  sidecarKeysPerObject: "64",
  sidecarGenericArrayItems: "32",
  genericStringBytes: "1024",
  identifierBytes: "512",
  providerOrDatasetCodeBytes: "128",
  symbolBytes: "32",
  timestampTextBytes: "64",
  pageTokenInputBytes: "4096",
  opaqueProviderIdBytes: "128",
  conditionMembers: "8",
  conditionMemberBytes: "8",
  rawDecimalTokenBytes: "32",
  rawDecimalScale: "12",
  primaryCoefficientDigits: "20",
  primarySourceScale: "6",
  derivedMidpointScale: "7",
  rationalComponentBytes: "32",
  instrumentsPerAcquisition: "64",
  providersPerSelectionPolicy: "8",
  marketCentersPerInstrumentState: "64",
  revisionDepthPerFamily: "16",
  deliveriesPerProviderObservation: "32",
  candidatesPerReferenceSelection: "10000",
  intervalsPerCluster: "16",
  referenceResultsPerCluster: "64",
  sidecarRecordsPerExecution: "4096",
  sidecarEdgesPerExecution: "12279",
  canonicalSidecarRecordBytes: "65536",
  canonicalExecutionBundleBytes: "67108864",
  recordedReplayPageSize: "1..10000",
  historicalQueryWindow: "1..8",
  selectionSearchWindowMs: "0..86400000",
  primaryResidualTargets: "exactly:T0,T1,T5,T30",
  primaryResidualHorizonNs: "1800000000000",
  regularQuoteAgeNs: "5000000000",
  extendedQuoteAgeNs: "30000000000",
  barDurationNs: "60000000000",
  captureRetrievalLagMs: "600000",
  calendarDatesPerManifest: "400",
  targetClusters: "exactly:180;range:100..200",
  laneTargets: "exactly:120/40/20",
  controlTargets: "exactly:5/5/5/5",
  candidateFrameMembers: "8192",
  frameDispositionOrStratumCells: "2048",
  selectedClusterEntryBytes: "65536",
  completeStudyManifestBytes: "33554432",
  datasetFreezeBundleBytes: "67108864",
  studyJsonDepth: "12",
  studyJsonNodesTotal: "500000",
  studyKeysPerObject: "64",
  studyGenericArrayItems: "256",
  studyStringBytes: "4096",
  studyIdentifierBytes: "512",
  contractSourceEntitlementIds: "64",
  reasonDefinitions: "64-per-namespace",
  metricDefinitions: "32",
  sensitivityDefinitions: "32",
  referencesPerCluster: "64",
  referencesTotal: "12800",
  annotationsPerCluster: "64",
  revisionsReferencedPerCluster: "32",
  strataDimensions: "8",
  collectionSessions: "exactly:65",
  collectionCalendarSpanMs: "10368000000",
  liquidityHistorySessions: "exactly:20",
  minimumValidLiquiditySessions: "15-of-20",
  timelyObservationMs: "900000",
  correctionLagMs: "604800000",
  bootstrapReplicates: "exactly:10000",
  holmSlots: "exactly:24",
});

const MARKET_DECIMAL_BOUNDS = new Set<CanonicalBoundIdV1>([
  "rawDecimalScale",
  "primaryCoefficientDigits",
  "primarySourceScale",
  "derivedMidpointScale",
  "rationalComponentBytes",
]);
const STUDY_LOCAL_BOUNDS = new Set<CanonicalBoundIdV1>([
  "minimumValidLiquiditySessions",
  "timelyObservationMs",
  "correctionLagMs",
]);
const STUDY_EXACT_BOUNDS = new Set<CanonicalBoundIdV1>([
  "targetClusters",
  "laneTargets",
  "controlTargets",
  "collectionSessions",
  "liquidityHistorySessions",
  "bootstrapReplicates",
  "holmSlots",
]);
const RANGE_BOUNDS = new Set<CanonicalBoundIdV1>([
  "recordedReplayPageSize",
  "historicalQueryWindow",
  "selectionSearchWindowMs",
]);

function boundStage(boundId: CanonicalBoundIdV1): string {
  const stages: readonly (readonly [readonly CanonicalBoundIdV1[], string])[] = [
    [["rawArtifactBytes", "aggregateVerifiedBytes"], "verified-artifact-read-before-parse"],
    [
      ["artifactsPerAcquisition", "pagesPerAcquisition"],
      "acquisition-authority-preflight-before-lookup-read",
    ],
    [
      ["recordsPerArtifactOrPage", "factsPerAcquisition", "canonicalRecordBytes"],
      "parser-canonical-output-preflight-before-fact-emission",
    ],
    [
      [
        "rawJsonDepth",
        "rawJsonNodes",
        "rawJsonKeysPerObject",
        "rawJsonArrayItems",
        "parserTokensPerArtifact",
      ],
      "raw-parser-inert-snapshot-before-recursive-descent",
    ],
    [
      ["sidecarDepth", "sidecarNodes", "sidecarKeysPerObject", "sidecarGenericArrayItems"],
      "sidecar-parser-inert-snapshot-before-recursive-descent",
    ],
    [
      [
        "genericStringBytes",
        "identifierBytes",
        "providerOrDatasetCodeBytes",
        "symbolBytes",
        "timestampTextBytes",
        "pageTokenInputBytes",
        "opaqueProviderIdBytes",
      ],
      "decoded-text-preflight-before-grammar-hash-log",
    ],
    [["conditionMembers", "conditionMemberBytes"], "condition-array-preflight-before-dictionary"],
    [["rawDecimalTokenBytes"], "decimal-token-preflight-before-numeric-conversion"],
    [
      [
        "rawDecimalScale",
        "primaryCoefficientDigits",
        "primarySourceScale",
        "derivedMidpointScale",
        "rationalComponentBytes",
      ],
      "exact-decimal-rational-normalization-before-candidate-metric",
    ],
    [
      ["instrumentsPerAcquisition", "providersPerSelectionPolicy"],
      "acquisition-policy-preflight-before-lookup-split",
    ],
    [
      [
        "marketCentersPerInstrumentState",
        "revisionDepthPerFamily",
        "deliveriesPerProviderObservation",
      ],
      "complete-immutable-source-state-preflight",
    ],
    [
      ["candidatesPerReferenceSelection", "intervalsPerCluster", "referenceResultsPerCluster"],
      "complete-selection-request-preflight",
    ],
    [
      [
        "sidecarRecordsPerExecution",
        "sidecarEdgesPerExecution",
        "canonicalSidecarRecordBytes",
        "canonicalExecutionBundleBytes",
      ],
      "execution-bundle-preflight-before-graph-validation",
    ],
    [["recordedReplayPageSize"], "replay-request-validation-before-page-read"],
    [["historicalQueryWindow"], "acquisition-request-validation-before-planning"],
    [["selectionSearchWindowMs"], "selection-request-validation-before-window"],
    [["primaryResidualTargets"], "policy-validation-before-target-derivation"],
    [["primaryResidualHorizonNs"], "policy-validation-before-interval-addition"],
    [["regularQuoteAgeNs", "extendedQuoteAgeNs"], "candidate-eligibility-after-time-session"],
    [["barDurationNs"], "bar-normalization-before-candidate"],
    [["captureRetrievalLagMs"], "anchor-quality-after-both-clocks"],
    [["calendarDatesPerManifest"], "manifest-preflight-before-calendar-lookup"],
    [["targetClusters", "laneTargets", "controlTargets"], "study-design-before-frame"],
    [
      ["candidateFrameMembers", "frameDispositionOrStratumCells"],
      "frame-preflight-before-validation-rank",
    ],
    [
      ["selectedClusterEntryBytes", "completeStudyManifestBytes", "datasetFreezeBundleBytes"],
      "canonical-study-byte-preflight",
    ],
    [
      ["studyJsonDepth", "studyJsonNodesTotal", "studyKeysPerObject", "studyGenericArrayItems"],
      "study-parser-inert-snapshot",
    ],
    [["studyStringBytes", "studyIdentifierBytes"], "decoded-study-text-preflight"],
    [
      [
        "contractSourceEntitlementIds",
        "reasonDefinitions",
        "metricDefinitions",
        "sensitivityDefinitions",
      ],
      "design-registry-preflight",
    ],
    [
      [
        "referencesPerCluster",
        "referencesTotal",
        "annotationsPerCluster",
        "revisionsReferencedPerCluster",
        "strataDimensions",
      ],
      "complete-study-collection-preflight",
    ],
    [
      ["collectionSessions", "liquidityHistorySessions", "bootstrapReplicates", "holmSlots"],
      "exact-study-configuration-validation",
    ],
    [["collectionCalendarSpanMs"], "collection-calendar-validation"],
    [["minimumValidLiquiditySessions"], "t-minus-one-liquidity-classification"],
    [["timelyObservationMs"], "e2-conservative-latency-classification"],
    [["correctionLagMs"], "correction-view-admission"],
  ];
  const stage = stages.find(([ids]) => ids.includes(boundId))?.[1];
  if (stage === undefined) throw new Error(`missing bound stage: ${boundId}`);
  return stage;
}

export const BOUND_ENFORCEMENT_REGISTRY: readonly BoundEnforcementRuleV1[] = Object.freeze(
  CANONICAL_BOUND_IDS.map((boundId) => {
    const isStudy =
      CANONICAL_BOUND_IDS.indexOf(boundId) >= CANONICAL_BOUND_IDS.indexOf("targetClusters");
    const local: BoundViolationKindV1 | null =
      boundId === "regularQuoteAgeNs" || boundId === "extendedQuoteAgeNs"
        ? "market-quote-stale"
        : boundId === "captureRetrievalLagMs"
          ? "market-timestamp-insufficient"
          : boundId === "timelyObservationMs"
            ? "study-timeliness-not-met"
            : boundId === "correctionLagMs"
              ? "study-correction-after-cutoff"
              : null;
    const upperViolation: BoundViolationKindV1 | null =
      boundId === "minimumValidLiquiditySessions"
        ? null
        : (local ??
          (MARKET_DECIMAL_BOUNDS.has(boundId)
            ? "market-decimal"
            : isStudy
              ? STUDY_EXACT_BOUNDS.has(boundId)
                ? "study-input"
                : "study-bound"
              : boundId === "barDurationNs"
                ? "market-input"
                : "market-bound"));
    return Object.freeze({
      boundId,
      stage: boundStage(boundId),
      atomicity:
        boundId === "regularQuoteAgeNs" || boundId === "extendedQuoteAgeNs"
          ? "candidate"
          : STUDY_LOCAL_BOUNDS.has(boundId) || boundId === "captureRetrievalLagMs"
            ? "metric"
            : isStudy
              ? "study-run"
              : "operation",
      exactValue: BOUND_EXACT_VALUES[boundId],
      upperViolation,
      schemaUpperViolation: boundId === "targetClusters" ? "study-bound" : null,
      lowerViolation: RANGE_BOUNDS.has(boundId)
        ? "market-input"
        : boundId === "minimumValidLiquiditySessions"
          ? "study-liquidity-unknown"
          : STUDY_EXACT_BOUNDS.has(boundId)
            ? "study-input"
            : null,
      countMinusOneViolation:
        boundId === "primaryResidualTargets"
          ? "market-input"
          : STUDY_EXACT_BOUNDS.has(boundId)
            ? "study-input"
            : null,
    });
  }),
);

if (
  CANONICAL_BOUND_IDS.length !== 84 ||
  BOUND_ENFORCEMENT_REGISTRY.length !== 84 ||
  new Set(CANONICAL_BOUND_IDS).size !== 84 ||
  new Set(BOUND_ENFORCEMENT_REGISTRY.map((entry) => entry.boundId)).size !== 84
) {
  throw new Error("PR 2D bound registry must contain exactly 84 unique equivalent rows");
}

export const MARKET_BOUNDS = Object.freeze({
  candidatesPerReferenceSelection: 10_000,
  conditionMemberBytes: 8,
  conditionMembers: 8,
  deliveriesPerProviderObservation: 32,
  primaryCoefficientDigits: 20,
  primarySourceScale: 6,
  providersPerSelectionPolicy: 8,
  rawDecimalTokenBytes: 32,
  revisionDepthPerFamily: 16,
  sidecarDepth: 8,
  sidecarGenericArrayItems: 32,
  sidecarKeysPerObject: 64,
  sidecarNodes: 512,
  timestampTextBytes: 64,
} as const);

export const REGULAR_QUOTE_AGE_NS = 5_000_000_000n;
export const EXTENDED_QUOTE_AGE_NS = 30_000_000_000n;
export const REGULAR_TRADE_AGE_NS = 5_000_000_000n;
export const EXTENDED_TRADE_AGE_NS = 30_000_000_000n;
export const COMPLETED_BAR_AGE_NS = 60_000_000_000n;
export const BAR_DURATION_NS = 60_000_000_000n;
export const CORRECTED_VIEW_OFFSET_NS = 604_800_000_000_000n;
export const SIGNED_NS_MIN = -(1n << 63n);
export const SIGNED_NS_MAX = (1n << 63n) - 1n;

export const MARKET_REASON_CODES = Object.freeze([
  "market.adjustment-unknown",
  "market.anchor-missing",
  "market.anchor-order-invalid",
  "market.anchor-policy-invalid",
  "market.artifact-invalid",
  "market.artifact-read-failed",
  "market.bar-interval-future",
  "market.bar-stale",
  "market.bound-exceeded",
  "market.clock-basis-incompatible",
  "market.clock-basis-invalid",
  "market.condition-unknown",
  "market.correction-after-cutoff",
  "market.correction-view-unknown",
  "market.corporate-action-crossing",
  "market.corporate-action-unresolved",
  "market.coverage-insufficient",
  "market.currency-unsupported",
  "market.dataset-feed-mismatch",
  "market.decimal-invalid",
  "market.division-by-zero",
  "market.duplicate-redelivery",
  "market.entitlement-invalid",
  "market.evidence-quality-degraded",
  "market.identity-invalid",
  "market.input-invalid",
  "market.instrument-invalid",
  "market.metric-endpoint-missing",
  "market.no-eligible-bar",
  "market.no-eligible-quote",
  "market.no-eligible-trade",
  "market.overnight-primary-forbidden",
  "market.page-chain-invalid",
  "market.prior-close-missing",
  "market.provider-disagreement",
  "market.provider-not-comparable",
  "market.provider-observation-invalid",
  "market.publication-time-untrusted",
  "market.quote-condition-ineligible",
  "market.quote-crossed",
  "market.quote-halt",
  "market.quote-luld-nonexecutable",
  "market.quote-not-consolidated",
  "market.quote-one-sided",
  "market.quote-quality-degraded",
  "market.quote-size-invalid",
  "market.quote-stale",
  "market.reference-window-missing",
  "market.replay-incompatible",
  "market.revision-invalid",
  "market.selection-conflict",
  "market.sequence-insufficient",
  "market.sequence-regression",
  "market.session-closed",
  "market.session-transition",
  "market.session-unknown",
  "market.silent-fallback-forbidden",
  "market.source-contract-invalid",
  "market.timestamp-insufficient",
  "market.timestamp-invalid",
  "market.trade-cancelled",
  "market.trade-condition-ineligible",
  "market.trade-odd-lot",
] as const);

export type MarketReasonCodeV1 = (typeof MARKET_REASON_CODES)[number];

export type CanonicalMarketReasonDetailV1 =
  | Readonly<{ limitKind: MarketBoundIdV1 }>
  | Readonly<{
      sourceFailureKind: "incomplete" | "endpoint-unknown" | "spec-version-unknown";
    }>
  | Readonly<{
      entitlementFailureKind:
        | "unfrozen"
        | "pending"
        | "denied"
        | "scope-mismatch"
        | "zero-spend-violation";
    }>
  | Readonly<{
      artifactFailureKind:
        | "observation-invalid"
        | "digest-mismatch"
        | "size-mismatch"
        | "observation-hash-mismatch"
        | "media-or-encoding-mismatch";
    }>
  | Readonly<{
      providerObservationFailureKind: "schema-invalid" | "identity-invalid" | "conflicting-content";
    }>
  | Readonly<{
      revisionFailureKind:
        | "orphan"
        | "fork"
        | "cycle"
        | "reused-key"
        | "chain-unresolved"
        | "unsupported-after-cancellation";
    }>
  | Readonly<{
      timestampFailureKind:
        | "missing"
        | "semantic-untrusted"
        | "precision-insufficient"
        | "capture-retrieval-lag-exceeded";
    }>
  | Readonly<{ sequenceFailureKind: "missing" | "gap" | "equal-time-ambiguous" }>
  | Readonly<{
      instrumentFailureKind:
        | "unmapped"
        | "ambiguous"
        | "outside-effective-window"
        | "symbol-continuity-unresolved";
    }>
  | Readonly<{ coverageFailureKind: "provider-unknown" | "instrument-not-covered" }>
  | Readonly<{
      sessionFailureKind:
        | "calendar-missing"
        | "boundary-ambiguous"
        | "timestamp-or-coverage-unknown";
    }>
  | Readonly<{
      tradeConditionFailureKind: "does-not-update-last" | "state-insufficient";
    }>
  | Readonly<{ priorCloseFailureKind: "absent" | "ineligible" }>
  | Readonly<{
      endpointKind:
        | "pre-release"
        | "first-observation"
        | "plus-1m"
        | "plus-5m"
        | "plus-30m"
        | "sensitivity";
    }>
  | Readonly<{ qualityKind: "locked" | "slow" | "luld-limit-state" }>
  | Readonly<{
      evidenceQualityKind: "sip-time-only" | "native-sequence-unchecked";
    }>;

export type CanonicalMarketReasonV1 = Readonly<{
  code: MarketReasonCodeV1;
  detail: CanonicalMarketReasonDetailV1 | null;
}>;

const DETAIL_RULES = Object.freeze({
  "market.artifact-invalid": [
    "artifactFailureKind",
    [
      "observation-invalid",
      "digest-mismatch",
      "size-mismatch",
      "observation-hash-mismatch",
      "media-or-encoding-mismatch",
    ],
  ],
  "market.bound-exceeded": ["limitKind", MARKET_BOUND_IDS],
  "market.coverage-insufficient": [
    "coverageFailureKind",
    ["provider-unknown", "instrument-not-covered"],
  ],
  "market.entitlement-invalid": [
    "entitlementFailureKind",
    ["unfrozen", "pending", "denied", "scope-mismatch", "zero-spend-violation"],
  ],
  "market.evidence-quality-degraded": [
    "evidenceQualityKind",
    ["sip-time-only", "native-sequence-unchecked"],
  ],
  "market.instrument-invalid": [
    "instrumentFailureKind",
    ["unmapped", "ambiguous", "outside-effective-window", "symbol-continuity-unresolved"],
  ],
  "market.metric-endpoint-missing": [
    "endpointKind",
    ["pre-release", "first-observation", "plus-1m", "plus-5m", "plus-30m", "sensitivity"],
  ],
  "market.prior-close-missing": ["priorCloseFailureKind", ["absent", "ineligible"]],
  "market.provider-observation-invalid": [
    "providerObservationFailureKind",
    ["schema-invalid", "identity-invalid", "conflicting-content"],
  ],
  "market.quote-quality-degraded": ["qualityKind", ["locked", "slow", "luld-limit-state"]],
  "market.revision-invalid": [
    "revisionFailureKind",
    ["orphan", "fork", "cycle", "reused-key", "chain-unresolved", "unsupported-after-cancellation"],
  ],
  "market.sequence-insufficient": [
    "sequenceFailureKind",
    ["missing", "gap", "equal-time-ambiguous"],
  ],
  "market.session-unknown": [
    "sessionFailureKind",
    ["calendar-missing", "boundary-ambiguous", "timestamp-or-coverage-unknown"],
  ],
  "market.source-contract-invalid": [
    "sourceFailureKind",
    ["incomplete", "endpoint-unknown", "spec-version-unknown"],
  ],
  "market.timestamp-insufficient": [
    "timestampFailureKind",
    ["missing", "semantic-untrusted", "precision-insufficient", "capture-retrieval-lag-exceeded"],
  ],
  "market.trade-condition-ineligible": [
    "tradeConditionFailureKind",
    ["does-not-update-last", "state-insufficient"],
  ],
} as const);

const MARKET_REASON_SET = new Set<string>(MARKET_REASON_CODES);

export function isMarketReasonCode(value: unknown): value is MarketReasonCodeV1 {
  return typeof value === "string" && MARKET_REASON_SET.has(value);
}

export function validateCanonicalMarketReason(value: unknown): CanonicalMarketReasonV1 {
  let candidate: Readonly<Record<string, unknown>>;
  try {
    candidate = snapshotExactNormalizerInput(value, ["code", "detail"]);
  } catch {
    throw new MarketContractError({ code: "market.input-invalid", detail: null });
  }
  const code = candidate["code"];
  const candidateDetail = candidate["detail"];
  if (!isMarketReasonCode(code)) {
    throw new MarketContractError({ code: "market.input-invalid", detail: null });
  }
  const rule = DETAIL_RULES[code as keyof typeof DETAIL_RULES] as
    | readonly [string, readonly string[]]
    | undefined;
  let validatedDetail: CanonicalMarketReasonDetailV1 | null = null;
  if (rule === undefined) {
    if (candidateDetail !== null) {
      throw new MarketContractError({ code: "market.input-invalid", detail: null });
    }
  } else {
    let detail: Readonly<Record<string, unknown>>;
    try {
      detail = snapshotExactNormalizerInput(candidateDetail, [rule[0]]);
    } catch {
      throw new MarketContractError({ code: "market.input-invalid", detail: null });
    }
    const detailValue = detail[rule[0]];
    if (typeof detailValue !== "string" || !rule[1].includes(detailValue)) {
      throw new MarketContractError({ code: "market.input-invalid", detail: null });
    }
    validatedDetail = Object.freeze({
      ...detail,
    }) as CanonicalMarketReasonDetailV1;
  }
  return Object.freeze({
    code,
    detail: validatedDetail,
  });
}

export function marketReason(
  code: MarketReasonCodeV1,
  detail: CanonicalMarketReasonDetailV1 | null = null,
): CanonicalMarketReasonV1 {
  return validateCanonicalMarketReason({ code, detail });
}

export function compareCanonicalReasons(
  left: CanonicalMarketReasonV1,
  right: CanonicalMarketReasonV1,
): number {
  return Buffer.compare(
    Buffer.from(canonicalJson(left as unknown as JsonValue)),
    Buffer.from(canonicalJson(right as unknown as JsonValue)),
  );
}

export class MarketContractError extends Error {
  readonly reason: CanonicalMarketReasonV1;

  constructor(reason: CanonicalMarketReasonV1) {
    super(reason.code);
    this.name = "MarketContractError";
    this.reason = reason;
  }
}

export type MarketSourceKeyV1 = Readonly<{
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  entitlementSnapshotId: string;
}>;

export type MarketFactKindV1 =
  | "quote"
  | "trade"
  | "bar"
  | "prior-close"
  | "official-open"
  | "official-close"
  | "corrected-close"
  | "trading-action"
  | "luld"
  | "corporate-action";

export type MarketRevisionKindV1 = "original" | "correction" | "cancellation";

export type QuotePayloadV1 = Readonly<{
  kind: "quote";
  quoteKind: "nbbo" | "bolo";
  bidPrice: CanonicalDecimalV1;
  askPrice: CanonicalDecimalV1;
  bidSize: CanonicalDecimalV1;
  askSize: CanonicalDecimalV1;
  explicitConsolidatedNbbo: boolean;
  condition: "eligible" | "ineligible" | "unknown";
  slow: boolean;
  luldState: "executable" | "limit" | "non-executable" | "not-applicable";
  halted: boolean;
}>;

export type TradePayloadV1 = Readonly<{
  kind: "trade";
  tradeKind: "last-eligible" | "opening" | "reopening" | "closing" | "final-close";
  price: CanonicalDecimalV1;
  size: CanonicalDecimalV1;
  updatesConsolidatedLast: true | false | "state-insufficient";
  oddLot: boolean;
}>;

export type BarPayloadV1 = Readonly<{
  kind: "bar";
  barKind: "one-minute" | "daily";
  close: CanonicalDecimalV1;
  barStartNs: string;
  barEndNs: string;
  adjustmentMode:
    | "raw"
    | "split"
    | "dividend"
    | "spin-off"
    | "all"
    | "provider-defined"
    | "unknown";
}>;

export type PriorClosePayloadV1 = Readonly<{
  kind: "prior-close";
  price: CanonicalDecimalV1;
  closeKind: "listing-official-close" | "corrected-consolidated-close";
  sessionDate: string;
}>;

export type OfficialValuePayloadV1 = Readonly<{
  kind: "official-value";
  valueKind: "listing-official-open";
  price: CanonicalDecimalV1;
  sessionDate: string;
}>;

export type TradingActionPayloadV1 = Readonly<{
  kind: "trading-action";
  action: "halt" | "quote-resume" | "trade-resume" | "reset";
}>;

export type LuldPayloadV1 = Readonly<{
  kind: "luld";
  state: "executable" | "limit" | "non-executable";
}>;

export type CorporateActionPayloadV1 = Readonly<{
  kind: "corporate-action";
  actionKind: "split" | "dividend" | "spin-off" | "symbol-change";
  effectiveNs: string;
  successorInstrumentId: string | null;
}>;

export type MarketPayloadV1 =
  | QuotePayloadV1
  | TradePayloadV1
  | BarPayloadV1
  | PriorClosePayloadV1
  | OfficialValuePayloadV1
  | TradingActionPayloadV1
  | LuldPayloadV1
  | CorporateActionPayloadV1;

export type RecordedMarketRecordV1 = Readonly<{
  source: MarketSourceKeyV1;
  instrumentId: string;
  venueTapeId: string | null;
  providerRecordKey: string | null;
  providerRevisionKey: string | null;
  providerStableRecordFamily: string;
  eventKind: MarketFactKindV1;
  eventTime: MarketTimestampV1;
  providerSequence: ProviderSequenceV1 | null;
  sequenceSessionDate: string | null;
  canonicalProviderPayloadDigest: string;
  marketAcquisitionId: string;
  rawArtifactId: string;
  memberKey: string;
  occurrenceOrdinal: number;
  revisionKind: MarketRevisionKindV1;
  supersedesRevisionId: string | null;
  effectiveEventTime: MarketTimestampV1 | null;
  sessionKind: MarketSessionKindV1;
  currency: "USD";
  payload: MarketPayloadV1 | null;
  normalizerVersion: string;
  conditionPolicyVersion: string;
  calendarVersion: string;
  parserContractVersion: string;
  durablyRecordedAtMs: number;
  durableLogicalAtMs: number;
  durableClockBasisId: string;
  primaryCorpusMember: boolean;
}>;

export type NormalizedMarketFactV1 = Readonly<{
  source: MarketSourceKeyV1;
  providerObservationId: string;
  deliveryId: string;
  revisionFamilyId: string;
  revisionId: string;
  marketFactId: string | null;
  normalizedMarketFactId: string | null;
  instrumentId: string;
  venueTapeId: string | null;
  providerRecordKey: string | null;
  providerRevisionKey: string | null;
  providerStableRecordFamily: string;
  eventKind: MarketFactKindV1;
  eventTime: MarketTimestampV1;
  providerSequence: ProviderSequenceV1 | null;
  sequenceSessionDate: string | null;
  canonicalProviderPayloadDigest: string;
  marketAcquisitionId: string;
  rawArtifactId: string;
  memberKey: string;
  occurrenceOrdinal: number;
  revisionKind: MarketRevisionKindV1;
  supersedesRevisionId: string | null;
  effectiveEventTime: MarketTimestampV1 | null;
  sessionKind: MarketSessionKindV1;
  currency: "USD";
  payload: MarketPayloadV1 | null;
  normalizerVersion: string;
  conditionPolicyVersion: string;
  calendarVersion: string;
  parserContractVersion: string;
  durablyRecordedAtMs: number;
  durableLogicalAtMs: number;
  durableClockBasisId: string;
  durableEvidenceHash: string;
  primaryCorpusMember: boolean;
}>;

export type TrustedObservationBasisV1 =
  | Readonly<{
      basisKind: "capture";
      eventId: string;
      receivedAtMs: number;
      logicalAtMs: number;
      clockBasisId: string;
    }>
  | Readonly<{
      basisKind: "retrieval";
      role: string;
      acquisitionObservationId: string;
      vaultObservationId: string;
      retrievedAtMs: number;
      clockBasisId: string;
    }>;

export type MarketResultAsOfBasisV1 = Readonly<{
  anchorRole: "h001-primary-durable-capture" | "h001-mandatory-retrieval-sensitivity";
  trustedObservationBasis: TrustedObservationBasisV1;
  targetTimeNs: string;
  comparator: "authoritative-prior-close" | "strictly-before" | "at-or-before";
  viewKind: MarketViewKindV1;
  recordedCorpusSnapshotId: string;
  corpusCutoffId: string;
  admittedRevisionSetHash: string;
}>;

export type MarketIntervalDefinitionV1 = Readonly<{
  intervalKind: "prior-close" | "publication-pre" | "t0" | "t1" | "t5" | "t30";
  anchorKind: "previous-eligible-listing-session" | "earnings-publication" | "h001-selected-basis";
  offsetNs: string | null;
  comparator: "authoritative-prior-close" | "strictly-before" | "at-or-before";
  sessionRule:
    | "prior-eligible-session"
    | "cross-session-allowed"
    | "anchor-session"
    | "same-session-as-t0";
}>;

export type MarketSourcePolicyV1 = Readonly<{
  policyVersion: "market-source-policy-v1";
  authorizationMode: "p1-09-approved" | "synthetic-offline-only";
  primarySource: MarketSourceKeyV1;
  comparisonSources: readonly MarketSourceKeyV1[];
  fallbackKind: "none";
  selectionIsolation: "per-source";
}>;

export type MarketProviderPriorityV1 = Readonly<{
  policyVersion: "market-provider-priority-v1";
  entries: readonly Readonly<{
    source: MarketSourceKeyV1;
    role: "primary" | "discrepancy-only";
    rank: number;
  }>[];
  missingPrimaryBehavior: "typed-missing-no-fallback";
}>;

export type MarketEligibilityPolicyV1 = Readonly<{
  policyVersion: "market-eligibility-v1";
  referenceKinds: readonly MarketReferenceKindV1[];
  primaryReferenceKind: "quote-nbbo-midpoint";
  currency: "USD";
  completeWindowRequired: true;
  referenceSubstitution: "forbidden";
  unknownConditionBehavior: "ineligible";
  strictExecutableDiagnostics: readonly ["locked", "luld-limit-state", "slow"];
}>;

export type MarketStalenessPolicyV1 = Readonly<{
  policyVersion: "market-staleness-v1";
  regularQuoteAgeNs: "5000000000";
  extendedQuoteAgeNs: "30000000000";
  regularTradeAgeNs: "5000000000";
  extendedTradeAgeNs: "30000000000";
  completedBarAgeNs: "60000000000";
  boundary: "inclusive";
  negativeAgeBehavior: "ineligible";
  overnightPrimaryAgeNs: null;
}>;

export type MarketCorrectionPolicyV1 = Readonly<{
  policyVersion: "market-correction-policy-v1";
  primaryCorpusSnapshotId: string;
  corpusCutoffId: string;
}> &
  (
    | Readonly<{
        viewKind: "recorded-primary";
        admissionKind: "member-of-primary-recorded-corpus";
        correctedOffsetNs: null;
        finalCorrectedOnlyBehavior: "recorded-primary-unavailable";
      }>
    | Readonly<{
        viewKind: "recorded-corrected";
        admissionKind: "member-of-primary-or-durably-recorded-by-corrected-cutoff";
        correctedOffsetNs: "604800000000000";
        finalCorrectedOnlyBehavior: "recorded-corrected-only-if-corpus-closed-by-cutoff";
      }>
  );

export type MarketTieBreakPolicyV1 = Readonly<{
  policyVersion: "market-tie-break-v1";
  trustedOrder: readonly ["source-native-total-order", "identical-economic-state", "missing"];
  identicalEconomicRepresentative: "smallest-normalized-market-fact-id";
  unresolvedDifferingState: "market.sequence-insufficient/equal-time-ambiguous";
  forbiddenOrders: readonly ["arrival", "artifact", "hash", "page", "provider-priority", "row"];
}>;

export type MarketDiscrepancyPolicyV1 = Readonly<{
  policyVersion: "market-discrepancy-v1";
  comparisonKind: "exact-reduced-rational";
  compareIndependentSources: true;
  equalValueMergesProvenance: false;
  missingBehavior: "not-comparable";
  disagreementChangesPrimary: false;
}>;

export type MarketSelectionPolicyPreimageV1 = Readonly<{
  contractAuthorityRegistryId: string;
  primaryAnchorKind: "capture";
  alternateAnchorKind: "retrieval";
  alternateAnchorRequired: true;
  intervalDefinitions: readonly MarketIntervalDefinitionV1[];
  targetSelector: "last-eligible-at-or-before";
  publicationOriginSelector: "last-eligible-strictly-before-publication";
  sourcePolicy: MarketSourcePolicyV1;
  providerPriority: MarketProviderPriorityV1;
  eligibilityPolicy: MarketEligibilityPolicyV1;
  stalenessPolicy: MarketStalenessPolicyV1;
  correctionPolicy: MarketCorrectionPolicyV1;
  tieBreakPolicy: MarketTieBreakPolicyV1;
  discrepancyPolicy: MarketDiscrepancyPolicyV1;
  reasonCatalogId: "market-reasons-v1";
  boundsPolicyId: "market-reference-bounds-v1";
}>;

export type RecordedRevisionEvidenceV1 = Readonly<{
  revisionId: string;
  deliveryId: string;
  rawArtifactId: string;
  durablyRecordedAtMs: number;
  logicalAtMs: number;
  clockBasisId: string;
  durableEvidenceHash: string;
}>;

export type RecordedCorpusSnapshotV1 = Readonly<{
  schemaVersion: 1;
  marketReferenceJoinKey: string;
  sourcePolicy: MarketSourcePolicyV1;
  marketAcquisitionIds: readonly string[];
  rawArtifactIds: readonly string[];
  providerObservationIds: readonly string[];
  revisionEvidence: readonly RecordedRevisionEvidenceV1[];
  corpusClosedAtMs: number;
  corpusClosedLogicalAtMs: number;
  corpusClockBasisId: string;
  corpusClosureEvidenceHash: string;
}>;

export type RecordedCorpusCutoffV1 = Readonly<{
  corpusSnapshotId: string;
  cutoffObservationEvidenceHash: string;
  admittedRevisionSetHash: string;
}> &
  (
    | Readonly<{
        viewKind: "recorded-primary";
        cutoffKind: "primary-corpus-closure";
        cutoffTargetNs: null;
      }>
    | Readonly<{
        viewKind: "recorded-corrected";
        cutoffKind: "capture-t0-plus-seven-days";
        cutoffTargetNs: string;
      }>
  );

export type MarketSelectionContextV1 = Readonly<{
  instrumentId: string;
  calendarSnapshotId: string;
  targetSessionKind: MarketSessionKindV1;
  targetWithinSession: boolean;
  symbolContinuity: "proved" | "ambiguous" | "unresolved";
  corporateActionState: "none" | "supported-sensitivity" | "unresolved";
}>;

export type MarketSelectionRequestV1 = Readonly<{
  marketReferenceJoinKey: string;
  intervalKey: string;
  referenceKind: MarketReferenceKindV1;
  selectionPolicyId: string;
  selectionPolicy: MarketSelectionPolicyPreimageV1;
  recordedCorpusSnapshotId: string;
  recordedCorpus: RecordedCorpusSnapshotV1;
  corpusCutoffId: string;
  corpusCutoff: RecordedCorpusCutoffV1;
  context: MarketSelectionContextV1;
  asOfBasis: MarketResultAsOfBasisV1;
  correctedCutoffNs: string | null;
}>;

export type MarketCandidateOutcomeV1 = Readonly<{
  providerObservationId: string;
  revisionId: string;
  normalizedMarketFactId: string;
  eligibilityStatus: "eligible" | "degraded" | "ineligible";
  reason: CanonicalMarketReasonV1 | null;
  diagnostics: readonly CanonicalMarketReasonV1[];
}>;

export type SelectedMarketReferenceV1 = Readonly<{
  status: "selected-complete" | "selected-degraded";
  selectedReferenceId: string;
  missingReferenceId: null;
  candidateSetHash: string;
  selectedNormalizedMarketFactId: string;
  selectedRevisionId: string;
  exactPrice: CanonicalDecimalV1 | CanonicalRationalV1;
  marketEventTimeNs: string;
  ageNs: string;
  reason: null;
  diagnostics: readonly CanonicalMarketReasonV1[];
  candidates: readonly MarketCandidateOutcomeV1[];
}>;

export type MissingMarketReferenceV1 = Readonly<{
  status: "missing";
  selectedReferenceId: null;
  missingReferenceId: string;
  candidateSetHash: string;
  selectedNormalizedMarketFactId: null;
  selectedRevisionId: null;
  exactPrice: null;
  marketEventTimeNs: null;
  ageNs: null;
  reason: CanonicalMarketReasonV1;
  diagnostics: readonly CanonicalMarketReasonV1[];
  candidates: readonly MarketCandidateOutcomeV1[];
}>;

export type MarketReferenceResultV1 = SelectedMarketReferenceV1 | MissingMarketReferenceV1;

export type ProviderDiscrepancyComparisonV1 = "agree" | "disagree" | "not-comparable";

export type MarketProviderDiscrepancyV1 = Readonly<{
  providerDiscrepancyId: string;
  providerResultIds: readonly string[];
  discrepancyPolicy: MarketDiscrepancyPolicyV1;
  comparisonResult: ProviderDiscrepancyComparisonV1;
  providerResults: readonly Readonly<{
    source: MarketSourceKeyV1;
    result: MarketReferenceResultV1;
  }>[];
}>;

export type MarketJoinEvidenceV1 = Readonly<{
  subject: string;
  issuerMappingId: string;
  selectedSourceObservationId: string;
  selectedSourceVersionIdentity: string;
  trustedObservationBasis: TrustedObservationBasisV1;
  marketReferenceJoinKey: string;
}>;
