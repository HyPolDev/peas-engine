import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { recordedMarketCatalogEvidence } from "../src/adapters/market-reference/recorded-market-loader.js";
import { canonicalHash, hashParts } from "../src/core/hash.js";
import {
  CORE_OWNED_BOUND_IDS,
  LOADER_OWNED_BOUND_IDS,
  STUDY_OWNED_BOUND_IDS,
  validateBarDuration,
  validateCandidateCount,
  validateCaptureRetrievalLag,
  validateConditionMembers,
  validateDeliveryCount,
  validateDerivedMidpointScale,
  validateMarketCenterStateCount,
  validatePrimaryDecimalShape,
  validatePrimaryResidualConfiguration,
  validateProviderCount,
  validateProviderDecimalEvidenceToken,
  validateQuoteAge,
  validateRationalComponentBytes,
  validateRevisionDepth,
  validateTimestampTextBound,
} from "../src/providers/market-reference/bounds.js";
import {
  BOUND_ENFORCEMENT_REGISTRY,
  CANONICAL_BOUND_IDS,
  type CanonicalMarketReasonDetailV1,
  MARKET_CONTRACT_AUTHORITY_REGISTRY_ID,
  MARKET_REASON_CODES,
  MARKET_REFERENCE_KINDS,
  MarketContractError,
  type MarketReasonCodeV1,
  type MarketSelectionRequestV1,
  marketReason,
  type NormalizedMarketFactV1,
  type RecordedMarketRecordV1,
  validateCanonicalMarketReason,
} from "../src/providers/market-reference/contracts.js";
import {
  MARKET_CORE_FIXTURE_CASE_EVIDENCE,
  MARKET_CORE_FIXTURE_CASE_IDS,
  type MarketCoreFixtureCaseIdV1,
} from "../src/providers/market-reference/fixture-case-evidence.js";
import {
  admittedRevisionIds,
  deriveAdmittedRevisionSetHash,
  deriveArtifactContentId,
  deriveCanonicalId,
  deriveDurableRevisionEvidenceHash,
  deriveEndpointChannelId,
  deriveEntitlementSnapshotId,
  deriveInstrumentId,
  deriveMarketAcquisitionId,
  deriveMarketDatasetId,
  deriveMarketFeedId,
  deriveMarketProviderId,
  deriveRawArtifactId,
  deriveRecordedCorpusCutoffId,
  deriveRecordedCorpusSnapshotId,
  deriveSelectionPolicyId,
  deriveValidatedMarketReferenceJoinKey,
  deriveVenueTapeId,
  validateMarketJoinEvidence,
} from "../src/providers/market-reference/identity.js";
import {
  canonicalDecimalFromToken,
  deriveCanonicalProviderPayloadDigest,
  exactCashDistributionAdjustedSensitivity,
  exactSplitAdjustedSensitivity,
  normalizeRecordedMarketRecord,
  normalizeRecordedMarketRecords,
  parseEpochNanoseconds,
  quoteMidpoint,
  reduceRational,
} from "../src/providers/market-reference/normalization.js";
import {
  classifyFrozenSession,
  classifyTapeOfficialTradeCode,
  compareIndependentSourceReferences,
  constructTwoSidedQuote,
  evaluatePrimaryQuoteBoundary,
  evaluateRecordedBarSensitivity,
  evaluateSessionTransition,
  evaluateStrictExecutableQuote,
  replayConsolidatedLast,
  replayNativeSequence,
  selectIsolatedQuoteReference,
  selectPriorCloseAndSensitivities,
  selectQuoteTimelineReference,
  selectStrictExecutableQuote,
} from "../src/providers/market-reference/operations.js";
import {
  evaluateFinalCorrectedCorpusClosure,
  evaluateMarketProviderDiscrepancy,
  evaluateMarketSelectionContext,
  selectMarketReference,
} from "../src/providers/market-reference/selection.js";
import {
  deriveAcquisitionObservationId,
  deriveIssuerMappingId,
} from "../src/providers/observation-ledger.js";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const providerId = deriveMarketProviderId({
  providerCode: "peas-synthetic-a",
  serviceOperatorCode: "peas-project",
});
const datasetId = deriveMarketDatasetId({
  providerId,
  assetClass: "us-equity",
  coverageRegion: "fictional-us",
  productFamily: "synthetic-market",
  apiGeneration: "v1",
  recordFamily: "recorded",
  datasetDocumentationVersion: "synthetic-v1",
});
const feedId = deriveMarketFeedId({
  datasetId,
  providerFeedCode: "synthetic-sip",
  consolidationKind: "sip-consolidated",
  delayClass: "historical",
  adjustmentMode: "raw",
  correctionRepresentation: "revision-stream",
});
const endpointChannelId = deriveEndpointChannelId({
  feedId,
  channelKind: "recorded-synthetic",
  methodKind: "recorded",
  safeRouteLabel: "synthetic-recorded",
  endpointDocumentationVersion: "synthetic-v1",
  paginationKind: "recorded-manifest",
  factKinds: ["bar", "prior-close", "quote", "trade"],
});
const entitlementSnapshotId = deriveEntitlementSnapshotId({
  providerId,
  productCode: "synthetic-offline",
  accountClass: "project-owned-synthetic",
  professionalStatus: "not-applicable",
  effectiveFromMs: 0,
  effectiveToMs: null,
  capabilities: [
    {
      datasetId,
      feedId,
      endpointChannelId,
      use: "offline-replay",
      status: "granted",
      maximumRawRetentionDays: null,
      survivesTermination: true,
    },
  ],
  permissionEvidenceHash: digest("project-authored-synthetic"),
  humanApprovalId: null,
  zeroIncrementalSpend: true,
});
const source = Object.freeze({
  providerId,
  datasetId,
  feedId,
  endpointChannelId,
  entitlementSnapshotId,
});
const issuerMappingId = deriveIssuerMappingId({
  issuerCik: "0000000001",
  symbols: ["PEAS"],
  selectedSymbol: "PEAS",
  mappingAuthority: "peas-synthetic-fixture",
  mappingVersion: "v1",
  effectiveFromMs: 0,
  effectiveToMs: null,
});
const instrumentId = deriveInstrumentId({
  issuerMappingId,
  securityAuthority: "peas-synthetic",
  securityKey: "fictional-common-1",
  issueType: "common-share",
  shareClass: "A",
  primaryListingVenueCode: "XNAS",
  currency: "USD",
  roundLotSize: 100,
  effectiveFromNs: "0",
  effectiveToNs: null,
  predecessorInstrumentId: null,
  transitionReason: null,
});
const venueTapeId = deriveVenueTapeId({
  planCode: "utp",
  networkCode: "C",
  participantCode: "Q",
  venueCode: "XNAS",
  protocolName: "PEAS synthetic UTP subset",
  protocolVersion: "v1",
});
const acquisitionObservationId = deriveAcquisitionObservationId({
  provider: "peas-synthetic-a",
  retrievalAttemptId: "synthetic-attempt-1",
  sanitizedRequestIdentityHash: digest("synthetic-request"),
  routeLabel: "synthetic-recorded",
});
const marketAcquisitionId = deriveMarketAcquisitionId({
  acquisitionObservationId,
  ...source,
  instrumentIds: [instrumentId],
  requestedFactKinds: ["bar", "prior-close", "quote", "trade"],
  queryStartNs: "0",
  queryEndNs: "1000000000000",
  sortOrder: "event-time-ascending",
  routePolicyVersion: "synthetic-v1",
});
const artifactContentId = deriveArtifactContentId({
  sha256: digest("synthetic bytes"),
  sizeBytes: 15,
  mediaType: "application/json",
  contentEncoding: "identity",
});
const rawArtifactId = deriveRawArtifactId({
  artifactContentId,
  vaultObservationId: digest("vault-observation"),
  vaultObservationHash: digest("vault-observation-hash"),
  acquisitionObservationId,
  role: "synthetic-market-page",
});

const joinEvidence = deriveValidatedMarketReferenceJoinKey({
  subject: "fictional-earnings-event",
  issuerMappingId,
  selectedSourceObservationId: `sob1_${digest("source-observation")}`,
  selectedSourceVersionIdentity: `svr1_${digest("source-version")}`,
  trustedObservationBasis: {
    basisKind: "capture",
    eventId: digest("event"),
    receivedAtMs: 105_000,
    logicalAtMs: 105_000,
    clockBasisId: `clk1_${digest("clock")}`,
  },
});

function decimal(value: string) {
  return canonicalDecimalFromToken(value);
}

function quoteRecord(
  options: Partial<RecordedMarketRecordV1> & {
    eventTimeNs?: string;
    bid?: string;
    ask?: string;
    revisionKey?: string;
    family?: string;
    slow?: boolean;
    halted?: boolean;
    occurrenceOrdinal?: number;
    memberKey?: string;
  } = {},
): RecordedMarketRecordV1 {
  const eventTimeNs = options.eventTimeNs ?? "100000000000";
  const bid = options.bid ?? "10.00";
  const ask = options.ask ?? "10.02";
  const revisionKey = options.revisionKey ?? "rev-1";
  const family = options.family ?? "quote-family-1";
  const payload = {
    kind: "quote" as const,
    quoteKind: "nbbo" as const,
    bidPrice: decimal(bid),
    askPrice: decimal(ask),
    bidSize: decimal("100"),
    askSize: decimal("200"),
    explicitConsolidatedNbbo: true,
    condition: "eligible" as const,
    slow: options.slow ?? false,
    luldState: "executable" as const,
    halted: options.halted ?? false,
  };
  return {
    source,
    instrumentId,
    venueTapeId,
    providerRecordKey: family,
    providerRevisionKey: revisionKey,
    providerStableRecordFamily: family,
    eventKind: "quote",
    eventTime: {
      epochNs: eventTimeNs,
      semantic: "participant-publication",
      precisionNs: "1000000",
    },
    providerSequence: null,
    sequenceSessionDate: "2027-02-03",
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(payload),
    marketAcquisitionId,
    rawArtifactId,
    memberKey: options.memberKey ?? `${family}-${revisionKey}`,
    occurrenceOrdinal: options.occurrenceOrdinal ?? 0,
    revisionKind: "original",
    supersedesRevisionId: null,
    effectiveEventTime: null,
    sessionKind: "regular-continuous",
    currency: "USD",
    payload,
    normalizerVersion: "market-normalizer-v1",
    conditionPolicyVersion: "synthetic-utp-v1",
    calendarVersion: "synthetic-calendar-v1",
    parserContractVersion: "synthetic-parser-v1",
    durablyRecordedAtMs: options.durablyRecordedAtMs ?? 105_000,
    durableLogicalAtMs: options.durableLogicalAtMs ?? 105_000,
    durableClockBasisId: options.durableClockBasisId ?? `clk1_${digest("clock")}`,
    primaryCorpusMember: options.primaryCorpusMember ?? true,
  };
}

function tradeRecord(options: Partial<RecordedMarketRecordV1> = {}): RecordedMarketRecordV1 {
  const payload = {
    kind: "trade" as const,
    tradeKind: "last-eligible" as const,
    price: decimal("10.01"),
    size: decimal("50"),
    updatesConsolidatedLast: true as const,
    oddLot: false,
  };
  return {
    ...quoteRecord({
      eventTimeNs: "100000000000",
      family: "trade-family-1",
      revisionKey: "trade-rev-1",
    }),
    eventKind: "trade",
    providerRecordKey: "trade-family-1",
    providerStableRecordFamily: "trade-family-1",
    providerRevisionKey: "trade-rev-1",
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(payload),
    memberKey: "trade-family-1-trade-rev-1",
    payload,
    ...options,
  };
}

function request(
  options: Partial<MarketSelectionRequestV1> & {
    targetTimeNs?: string;
    comparator?: MarketSelectionRequestV1["asOfBasis"]["comparator"];
    viewKind?: MarketSelectionRequestV1["asOfBasis"]["viewKind"];
    facts?: readonly NormalizedMarketFactV1[];
    comparisonSources?: readonly (typeof source)[];
  } = {},
): MarketSelectionRequestV1 {
  const viewKind = options.viewKind ?? "recorded-primary";
  const facts = options.facts ?? [];
  const comparisonSources = options.comparisonSources ?? [];
  const sourcePolicy = {
    policyVersion: "market-source-policy-v1" as const,
    authorizationMode: "synthetic-offline-only" as const,
    primarySource: source,
    comparisonSources,
    fallbackKind: "none" as const,
    selectionIsolation: "per-source" as const,
  };
  const recordedCorpus = {
    schemaVersion: 1 as const,
    marketReferenceJoinKey: joinEvidence.marketReferenceJoinKey,
    sourcePolicy,
    marketAcquisitionIds: [...new Set(facts.map((fact) => fact.marketAcquisitionId))].sort(),
    rawArtifactIds: [...new Set(facts.map((fact) => fact.rawArtifactId))].sort(),
    providerObservationIds: [...new Set(facts.map((fact) => fact.providerObservationId))].sort(),
    revisionEvidence: [
      ...new Map(
        facts.map((fact) => [
          `${fact.revisionId}\u0000${fact.deliveryId}`,
          (() => {
            const evidence = {
              revisionId: fact.revisionId,
              deliveryId: fact.deliveryId,
              rawArtifactId: fact.rawArtifactId,
              durablyRecordedAtMs: fact.durablyRecordedAtMs,
              logicalAtMs: fact.durableLogicalAtMs,
              clockBasisId: fact.durableClockBasisId,
            };
            return {
              ...evidence,
              durableEvidenceHash: deriveDurableRevisionEvidenceHash(evidence),
            };
          })(),
        ]),
      ).values(),
    ].sort((left, right) =>
      `${left.revisionId}\u0000${left.deliveryId}`.localeCompare(
        `${right.revisionId}\u0000${right.deliveryId}`,
      ),
    ),
    corpusClosedAtMs: 105_000,
    corpusClosedLogicalAtMs: 105_000,
    corpusClockBasisId: `clk1_${digest("clock")}`,
    corpusClosureEvidenceHash: digest("corpus-closure"),
  };
  const recordedCorpusSnapshotId = deriveRecordedCorpusSnapshotId(recordedCorpus);
  const admittedRevisionSetHash = deriveAdmittedRevisionSetHash(
    [...new Set(facts.map((fact) => fact.revisionId))].sort(),
  );
  const correctedCutoffNs = viewKind === "recorded-corrected" ? "604905000000000" : null;
  const corpusCutoff = {
    corpusSnapshotId: recordedCorpusSnapshotId,
    cutoffObservationEvidenceHash: digest(`cutoff-${viewKind}`),
    admittedRevisionSetHash,
    ...(viewKind === "recorded-primary"
      ? {
          viewKind: "recorded-primary" as const,
          cutoffKind: "primary-corpus-closure" as const,
          cutoffTargetNs: null,
        }
      : {
          viewKind: "recorded-corrected" as const,
          cutoffKind: "capture-t0-plus-seven-days" as const,
          cutoffTargetNs: correctedCutoffNs as string,
        }),
  };
  const corpusCutoffId = deriveRecordedCorpusCutoffId(corpusCutoff);
  const intervalDefinitions = [
    {
      intervalKind: "prior-close" as const,
      anchorKind: "previous-eligible-listing-session" as const,
      offsetNs: null,
      comparator: "authoritative-prior-close" as const,
      sessionRule: "prior-eligible-session" as const,
    },
    {
      intervalKind: "publication-pre" as const,
      anchorKind: "earnings-publication" as const,
      offsetNs: "0",
      comparator: "strictly-before" as const,
      sessionRule: "cross-session-allowed" as const,
    },
    {
      intervalKind: "t0" as const,
      anchorKind: "h001-selected-basis" as const,
      offsetNs: "0",
      comparator: "at-or-before" as const,
      sessionRule: "anchor-session" as const,
    },
    {
      intervalKind: "t1" as const,
      anchorKind: "h001-selected-basis" as const,
      offsetNs: "60000000000",
      comparator: "at-or-before" as const,
      sessionRule: "same-session-as-t0" as const,
    },
    {
      intervalKind: "t5" as const,
      anchorKind: "h001-selected-basis" as const,
      offsetNs: "300000000000",
      comparator: "at-or-before" as const,
      sessionRule: "same-session-as-t0" as const,
    },
    {
      intervalKind: "t30" as const,
      anchorKind: "h001-selected-basis" as const,
      offsetNs: "1800000000000",
      comparator: "at-or-before" as const,
      sessionRule: "same-session-as-t0" as const,
    },
  ].sort((left, right) =>
    deriveCanonicalId("mik1_", "peas/market-reference-interval/v1", left).localeCompare(
      deriveCanonicalId("mik1_", "peas/market-reference-interval/v1", right),
    ),
  );
  const selectionPolicy = {
    contractAuthorityRegistryId: MARKET_CONTRACT_AUTHORITY_REGISTRY_ID,
    primaryAnchorKind: "capture" as const,
    alternateAnchorKind: "retrieval" as const,
    alternateAnchorRequired: true as const,
    intervalDefinitions,
    targetSelector: "last-eligible-at-or-before" as const,
    publicationOriginSelector: "last-eligible-strictly-before-publication" as const,
    sourcePolicy,
    providerPriority: {
      policyVersion: "market-provider-priority-v1" as const,
      entries: [
        { source, role: "primary" as const, rank: 0 },
        ...comparisonSources.map((comparisonSource, index) => ({
          source: comparisonSource,
          role: "discrepancy-only" as const,
          rank: index + 1,
        })),
      ],
      missingPrimaryBehavior: "typed-missing-no-fallback" as const,
    },
    eligibilityPolicy: {
      policyVersion: "market-eligibility-v1" as const,
      referenceKinds: MARKET_REFERENCE_KINDS,
      primaryReferenceKind: "quote-nbbo-midpoint" as const,
      currency: "USD" as const,
      completeWindowRequired: true as const,
      referenceSubstitution: "forbidden" as const,
      unknownConditionBehavior: "ineligible" as const,
      strictExecutableDiagnostics: ["locked", "luld-limit-state", "slow"] as const,
    },
    stalenessPolicy: {
      policyVersion: "market-staleness-v1" as const,
      regularQuoteAgeNs: "5000000000" as const,
      extendedQuoteAgeNs: "30000000000" as const,
      regularTradeAgeNs: "5000000000" as const,
      extendedTradeAgeNs: "30000000000" as const,
      completedBarAgeNs: "60000000000" as const,
      boundary: "inclusive" as const,
      negativeAgeBehavior: "ineligible" as const,
      overnightPrimaryAgeNs: null,
    },
    correctionPolicy: {
      policyVersion: "market-correction-policy-v1" as const,
      primaryCorpusSnapshotId: recordedCorpusSnapshotId,
      corpusCutoffId,
      ...(viewKind === "recorded-primary"
        ? {
            viewKind: "recorded-primary" as const,
            admissionKind: "member-of-primary-recorded-corpus" as const,
            correctedOffsetNs: null,
            finalCorrectedOnlyBehavior: "recorded-primary-unavailable" as const,
          }
        : {
            viewKind: "recorded-corrected" as const,
            admissionKind: "member-of-primary-or-durably-recorded-by-corrected-cutoff" as const,
            correctedOffsetNs: "604800000000000" as const,
            finalCorrectedOnlyBehavior:
              "recorded-corrected-only-if-corpus-closed-by-cutoff" as const,
          }),
    },
    tieBreakPolicy: {
      policyVersion: "market-tie-break-v1" as const,
      trustedOrder: ["source-native-total-order", "identical-economic-state", "missing"] as const,
      identicalEconomicRepresentative: "smallest-normalized-market-fact-id" as const,
      unresolvedDifferingState: "market.sequence-insufficient/equal-time-ambiguous" as const,
      forbiddenOrders: ["arrival", "artifact", "hash", "page", "provider-priority", "row"] as const,
    },
    discrepancyPolicy: {
      policyVersion: "market-discrepancy-v1" as const,
      comparisonKind: "exact-reduced-rational" as const,
      compareIndependentSources: true as const,
      equalValueMergesProvenance: false as const,
      missingBehavior: "not-comparable" as const,
      disagreementChangesPrimary: false as const,
    },
    reasonCatalogId: "market-reasons-v1" as const,
    boundsPolicyId: "market-reference-bounds-v1" as const,
  };
  const selectionPolicyId = deriveSelectionPolicyId(selectionPolicy);
  const comparator = options.comparator ?? "at-or-before";
  const requestedInterval = intervalDefinitions.find(
    (definition) =>
      definition.comparator === comparator &&
      (comparator !== "at-or-before" || definition.intervalKind === "t0"),
  );
  assert.ok(requestedInterval);
  return {
    marketReferenceJoinKey: joinEvidence.marketReferenceJoinKey,
    intervalKey: deriveCanonicalId("mik1_", "peas/market-reference-interval/v1", requestedInterval),
    referenceKind: options.referenceKind ?? "quote-nbbo-midpoint",
    selectionPolicyId,
    selectionPolicy,
    recordedCorpusSnapshotId,
    recordedCorpus,
    corpusCutoffId,
    corpusCutoff,
    context: {
      instrumentId,
      calendarSnapshotId: `cal1_${digest("synthetic-calendar")}`,
      targetSessionKind: "regular-continuous",
      targetWithinSession: true,
      symbolContinuity: "proved",
      corporateActionState: "none",
    },
    asOfBasis: {
      anchorRole: "h001-primary-durable-capture",
      trustedObservationBasis: joinEvidence.trustedObservationBasis,
      targetTimeNs: options.targetTimeNs ?? "105000000000",
      comparator,
      viewKind,
      recordedCorpusSnapshotId,
      corpusCutoffId,
      admittedRevisionSetHash,
    },
    correctedCutoffNs,
  };
}

const directDetails = new Map<MarketReasonCodeV1, CanonicalMarketReasonDetailV1>([
  ["market.artifact-invalid", { artifactFailureKind: "digest-mismatch" }],
  ["market.bound-exceeded", { limitKind: "timestampTextBytes" }],
  ["market.coverage-insufficient", { coverageFailureKind: "provider-unknown" }],
  ["market.entitlement-invalid", { entitlementFailureKind: "pending" }],
  ["market.evidence-quality-degraded", { evidenceQualityKind: "sip-time-only" }],
  ["market.instrument-invalid", { instrumentFailureKind: "unmapped" }],
  ["market.metric-endpoint-missing", { endpointKind: "plus-5m" }],
  ["market.prior-close-missing", { priorCloseFailureKind: "absent" }],
  [
    "market.provider-observation-invalid",
    { providerObservationFailureKind: "conflicting-content" },
  ],
  ["market.quote-quality-degraded", { qualityKind: "locked" }],
  ["market.revision-invalid", { revisionFailureKind: "orphan" }],
  ["market.sequence-insufficient", { sequenceFailureKind: "gap" }],
  ["market.session-unknown", { sessionFailureKind: "calendar-missing" }],
  ["market.source-contract-invalid", { sourceFailureKind: "incomplete" }],
  ["market.timestamp-insufficient", { timestampFailureKind: "missing" }],
  ["market.trade-condition-ineligible", { tradeConditionFailureKind: "does-not-update-last" }],
]);

function assertCoreFixtureCase(caseId: MarketCoreFixtureCaseIdV1, actualOutcome: string): void {
  const evidence = MARKET_CORE_FIXTURE_CASE_EVIDENCE[caseId];
  assert.deepEqual(evidence, {
    caseId,
    enforcementOwner: "market-core",
    testVectorId: `core:${caseId}:v1`,
    expectedOutcome: actualOutcome,
  });
}

test("the 22 executable core case IDs cross-bind the canonical 64-row fixture evidence", () => {
  const fixtureRows = recordedMarketCatalogEvidence().filter(
    (row) => row["enforcementOwner"] === "market-core",
  );
  assert.equal(fixtureRows.length, 22);
  assert.deepEqual(
    fixtureRows,
    MARKET_CORE_FIXTURE_CASE_IDS.map((caseId) => MARKET_CORE_FIXTURE_CASE_EVIDENCE[caseId]),
  );
});

test("market reason catalog is the closed 63-code direct-detail contract", () => {
  assert.equal(MARKET_REASON_CODES.length, 63);
  assert.equal(new Set(MARKET_REASON_CODES).size, 63);
  for (const code of MARKET_REASON_CODES) {
    const detail = directDetails.get(code) ?? null;
    assert.deepEqual(validateCanonicalMarketReason({ code, detail }), { code, detail });
  }
  assert.throws(
    () => validateCanonicalMarketReason({ code: "mr.quote-stale", detail: null }),
    MarketContractError,
  );
  assert.throws(
    () =>
      validateCanonicalMarketReason({
        code: "market.bound-exceeded",
        detail: { field: "limitKind", value: "timestampTextBytes" },
      }),
    MarketContractError,
  );
  assert.throws(
    () => validateCanonicalMarketReason({ code: "market.bound-exceeded", detail: null }),
    MarketContractError,
  );
  assert.throws(
    () =>
      validateCanonicalMarketReason({
        code: "market.quote-stale",
        detail: { qualityKind: "slow" },
      }),
    MarketContractError,
  );
  let getterCalls = 0;
  assert.throws(
    () =>
      validateCanonicalMarketReason({
        code: "market.quote-stale",
        get detail() {
          getterCalls += 1;
          return null;
        },
      }),
    MarketContractError,
  );
  assert.equal(getterCalls, 0);
});

test("repository framing and identity families match pinned contract vectors", () => {
  assert.equal(
    canonicalHash("peas/golden/v1", { a: "x", n: 1 }),
    "6b2d9419f583fd8f1e317a03a25f14dbcaeb06a3e63bfe566ab9f33b1e39de97",
  );
  assert.equal(
    hashParts("peas/frame-collision/v1", "ab", "c"),
    "4e38029c6f73af0004b786cb417eaf3f4b06d9c4c23477e65a6a0136f0ef6ff8",
  );
  assert.equal(
    hashParts("peas/frame-collision/v1", "a", "bc"),
    "31b5b621ccf61824923b45fb664e683a1f719e61aebe63cca5ebe1bbcf910ae3",
  );
  assert.equal(
    issuerMappingId,
    "imap1_b5fb4ba66e0c0db04d272e66bcfd071e46fe343be06487bb76c892834958441e",
  );
  assert.equal(
    instrumentId,
    "min1_e9356093916724ade802248d445ca057c3667b74cb09a06fe34c01767f807fc3",
  );
  assert.match(providerId, /^mpv1_[0-9a-f]{64}$/u);
  assert.match(datasetId, /^mds1_[0-9a-f]{64}$/u);
  assert.match(feedId, /^mfd1_[0-9a-f]{64}$/u);
  assert.match(endpointChannelId, /^mec1_[0-9a-f]{64}$/u);
  assert.match(entitlementSnapshotId, /^ent1_[0-9a-f]{64}$/u);
});

test("identity boundary rejects active and forged values without invoking getters", () => {
  let getterCalls = 0;
  const active = {
    providerCode: "synthetic",
    get serviceOperatorCode() {
      getterCalls += 1;
      return "project";
    },
  };
  assert.throws(() => deriveMarketProviderId(active), MarketContractError);
  assert.equal(getterCalls, 0);
  const proxy = new Proxy(
    { providerCode: "synthetic", serviceOperatorCode: "project" },
    {
      ownKeys() {
        throw new Error("trap must not execute");
      },
    },
  );
  assert.throws(() => deriveMarketProviderId(proxy), MarketContractError);
  assert.throws(
    () =>
      validateMarketJoinEvidence({
        ...joinEvidence,
        marketReferenceJoinKey: `mrj1_${digest("forged")}`,
      }),
    MarketContractError,
  );
});

test("canonical decimal, midpoint, timestamp, and one-over boundaries are exact", () => {
  assert.deepEqual(decimal("10.020000"), {
    coefficient: "1002",
    scale: 2,
    negative: false,
  });
  assert.deepEqual(
    quoteMidpoint({
      kind: "quote",
      quoteKind: "nbbo",
      bidPrice: decimal("1.000000"),
      askPrice: decimal("1.000001"),
      bidSize: decimal("1"),
      askSize: decimal("1"),
      explicitConsolidatedNbbo: true,
      condition: "eligible",
      slow: false,
      luldState: "executable",
      halted: false,
    }),
    { numerator: "2000001", denominator: "2000000" },
  );
  assert.equal(parseEpochNanoseconds("9223372036854775807"), 9223372036854775807n);
  assert.throws(() => parseEpochNanoseconds("9223372036854775808"), MarketContractError);
  assert.deepEqual(decimal("12345678901234567890"), {
    coefficient: "12345678901234567890",
    scale: 0,
    negative: false,
  });
  assert.throws(() => decimal("123456789012345678901"), MarketContractError);
  assert.throws(() => decimal(`1${"0".repeat(31)}`), MarketContractError);
  assert.throws(() => decimal(`1${"0".repeat(32)}`), MarketContractError);
});

test("normalization derives immutable provider, delivery, revision, fact, and normalized identities", () => {
  const first = normalizeRecordedMarketRecord(quoteRecord());
  const second = normalizeRecordedMarketRecord(quoteRecord());
  assert.match(first.providerObservationId, /^mob1_[0-9a-f]{64}$/u);
  assert.match(first.deliveryId, /^mdl1_[0-9a-f]{64}$/u);
  assert.match(first.revisionFamilyId, /^mrf1_[0-9a-f]{64}$/u);
  assert.match(first.revisionId, /^mrv1_[0-9a-f]{64}$/u);
  assert.match(first.marketFactId ?? "", /^mft1_[0-9a-f]{64}$/u);
  assert.match(first.normalizedMarketFactId ?? "", /^mnf1_[0-9a-f]{64}$/u);
  assert.deepEqual(first, second);

  const changedProvider = deriveMarketProviderId({
    providerCode: "peas-synthetic-b",
    serviceOperatorCode: "peas-project",
  });
  assert.notEqual(changedProvider, providerId);
  assert.throws(
    () =>
      selectMarketReference(request({ facts: [first] }), [
        { ...first, normalizedMarketFactId: `mnf1_${digest("forged")}` },
      ]),
    (error: unknown) =>
      error instanceof MarketContractError && error.reason.code === "market.identity-invalid",
  );
});

test("as-of target includes equality, excludes target+1ns, and is order invariant", () => {
  const atTarget = normalizeRecordedMarketRecord(
    quoteRecord({
      eventTimeNs: "105000000000",
      family: "quote-at-target",
      revisionKey: "target",
      bid: "10.00",
      ask: "10.02",
    }),
  );
  const afterTarget = normalizeRecordedMarketRecord(
    quoteRecord({
      eventTimeNs: "105000000001",
      family: "quote-after-target",
      revisionKey: "future",
      bid: "20.00",
      ask: "20.02",
    }),
  );
  const left = selectMarketReference(request({ facts: [afterTarget, atTarget] }), [
    afterTarget,
    atTarget,
  ]);
  const right = selectMarketReference(request({ facts: [atTarget, afterTarget] }), [
    atTarget,
    afterTarget,
  ]);
  assert.equal(left.status, "selected-complete");
  assert.equal(left.marketEventTimeNs, "105000000000");
  assert.equal(left.selectedReferenceId, right.selectedReferenceId);
  assert.equal(left.candidateSetHash, right.candidateSetHash);
});

test("strict publication origin excludes equality", () => {
  const before = normalizeRecordedMarketRecord(
    quoteRecord({
      eventTimeNs: "99999999999",
      family: "quote-before-publication",
      revisionKey: "before",
    }),
  );
  const equal = normalizeRecordedMarketRecord(
    quoteRecord({
      eventTimeNs: "100000000000",
      family: "quote-at-publication",
      revisionKey: "equal",
      bid: "12",
      ask: "12.02",
    }),
  );
  const result = selectMarketReference(
    request({
      targetTimeNs: "100000000000",
      comparator: "strictly-before",
      facts: [equal, before],
    }),
    [equal, before],
  );
  assert.equal(result.status, "selected-complete");
  assert.equal(result.marketEventTimeNs, "99999999999");
});

test("quote staleness exact boundary is eligible and one nanosecond over is typed missing", () => {
  const fact = normalizeRecordedMarketRecord(quoteRecord({ eventTimeNs: "100000000000" }));
  const exact = selectMarketReference(request({ targetTimeNs: "105000000000", facts: [fact] }), [
    fact,
  ]);
  assert.equal(exact.status, "selected-complete");
  const staleFact = normalizeRecordedMarketRecord(
    quoteRecord({ eventTimeNs: "99999999999", family: "stale-one-over" }),
  );
  const oneOver = selectMarketReference(
    request({ targetTimeNs: "105000000000", facts: [staleFact] }),
    [staleFact],
  );
  assert.equal(oneOver.status, "missing");
  assert.deepEqual(oneOver.reason, marketReason("market.quote-stale"));
});

test("locked and slow quotes remain selected-degraded with sorted direct-key diagnostics", () => {
  const locked = normalizeRecordedMarketRecord(quoteRecord({ bid: "10", ask: "10", slow: true }));
  const result = selectMarketReference(request({ facts: [locked] }), [locked]);
  assert.equal(result.status, "selected-degraded");
  assert.deepEqual(result.diagnostics, [
    marketReason("market.quote-quality-degraded", { qualityKind: "locked" }),
    marketReason("market.quote-quality-degraded", { qualityKind: "slow" }),
  ]);
});

test("trade cannot substitute for a missing quote and reference kinds stay distinct", () => {
  const trade = normalizeRecordedMarketRecord(tradeRecord());
  const barPayload = {
    kind: "bar" as const,
    barKind: "one-minute" as const,
    close: decimal("10.01"),
    barStartNs: "40000000000",
    barEndNs: "100000000000",
    adjustmentMode: "raw" as const,
  };
  const bar = normalizeRecordedMarketRecord({
    ...quoteRecord({ family: "bar-family-1", revisionKey: "bar-rev-1" }),
    eventKind: "bar",
    payload: barPayload,
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(barPayload),
  });
  const facts = [trade, bar];
  const quoteResult = selectMarketReference(request({ facts }), facts);
  assert.equal(quoteResult.status, "missing");
  assert.deepEqual(quoteResult.reason, marketReason("market.no-eligible-quote"));

  const tradeResult = selectMarketReference(
    request({ facts, referenceKind: "trade-last-eligible-consolidated" }),
    facts,
  );
  const barResult = selectMarketReference(
    request({ facts, referenceKind: "bar-one-minute-completed-close" }),
    facts,
  );
  assert.equal(tradeResult.status, "selected-complete");
  assert.equal(barResult.status, "selected-complete");
  assert.notEqual(quoteResult.missingReferenceId, tradeResult.selectedReferenceId);
  assert.notEqual(quoteResult.missingReferenceId, barResult.selectedReferenceId);
  assertCoreFixtureCase("M-04", "quote-missing-no-trade-or-bar-fallback");
});

test("primary source is isolated and discrepancy-only sources cannot change its result", () => {
  const comparisonProviderId = deriveMarketProviderId({
    providerCode: "peas-synthetic-comparison",
    serviceOperatorCode: "peas-project",
  });
  const comparisonDatasetId = deriveMarketDatasetId({
    providerId: comparisonProviderId,
    assetClass: "us-equity",
    coverageRegion: "fictional-us",
    productFamily: "synthetic-comparison",
    apiGeneration: "v1",
    recordFamily: "recorded",
    datasetDocumentationVersion: "synthetic-v1",
  });
  const comparisonFeedId = deriveMarketFeedId({
    datasetId: comparisonDatasetId,
    providerFeedCode: "synthetic-comparison",
    consolidationKind: "provider-aggregate",
    delayClass: "historical",
    adjustmentMode: "raw",
    correctionRepresentation: "revision-stream",
  });
  const comparisonEndpointChannelId = deriveEndpointChannelId({
    feedId: comparisonFeedId,
    channelKind: "recorded-synthetic",
    methodKind: "recorded",
    safeRouteLabel: "synthetic-comparison",
    endpointDocumentationVersion: "synthetic-v1",
    paginationKind: "recorded-manifest",
    factKinds: ["quote"],
  });
  const comparisonEntitlementSnapshotId = deriveEntitlementSnapshotId({
    providerId: comparisonProviderId,
    productCode: "synthetic-offline",
    accountClass: "project-owned-synthetic",
    professionalStatus: "not-applicable",
    effectiveFromMs: 0,
    effectiveToMs: null,
    capabilities: [
      {
        datasetId: comparisonDatasetId,
        feedId: comparisonFeedId,
        endpointChannelId: comparisonEndpointChannelId,
        use: "offline-replay",
        status: "granted",
        maximumRawRetentionDays: null,
        survivesTermination: true,
      },
    ],
    permissionEvidenceHash: digest("comparison-synthetic"),
    humanApprovalId: null,
    zeroIncrementalSpend: true,
  });
  const comparisonSource = Object.freeze({
    providerId: comparisonProviderId,
    datasetId: comparisonDatasetId,
    feedId: comparisonFeedId,
    endpointChannelId: comparisonEndpointChannelId,
    entitlementSnapshotId: comparisonEntitlementSnapshotId,
  });
  const comparisonAcquisitionId = deriveMarketAcquisitionId({
    acquisitionObservationId,
    ...comparisonSource,
    instrumentIds: [instrumentId],
    requestedFactKinds: ["quote"],
    queryStartNs: "0",
    queryEndNs: "1000000000000",
    sortOrder: "event-time-ascending",
    routePolicyVersion: "synthetic-v1",
  });
  const primaryFact = normalizeRecordedMarketRecord(
    quoteRecord({ family: "isolated-primary", revisionKey: "primary" }),
  );
  const comparisonRecord = quoteRecord({
    family: "isolated-comparison",
    revisionKey: "comparison",
    bid: "99",
    ask: "99.02",
  });
  const comparisonFact = normalizeRecordedMarketRecord({
    ...comparisonRecord,
    source: comparisonSource,
    marketAcquisitionId: comparisonAcquisitionId,
  });
  const authority = request({
    facts: [primaryFact, comparisonFact],
    comparisonSources: [comparisonSource],
  });
  const primaryResult = selectMarketReference(authority, [comparisonFact, primaryFact]);
  assert.equal(primaryResult.status, "selected-complete");
  assert.deepEqual(primaryResult.exactPrice, { numerator: "1001", denominator: "100" });
  const discrepancy = evaluateMarketProviderDiscrepancy(authority, [primaryFact, comparisonFact]);
  assert.match(discrepancy.providerDiscrepancyId, /^mdp1_[0-9a-f]{64}$/u);
  assert.equal(discrepancy.comparisonResult, "disagree");
  assert.equal(
    discrepancy.providerResults[0]?.result.selectedReferenceId,
    primaryResult.selectedReferenceId,
  );
  assertCoreFixtureCase("D-02", "disagree-primary-unchanged");
  const agreeingRecord = quoteRecord({
    family: "isolated-agree",
    revisionKey: "agree",
    bid: "10",
    ask: "10.02",
  });
  const agreeingFact = normalizeRecordedMarketRecord({
    ...agreeingRecord,
    source: comparisonSource,
    marketAcquisitionId: comparisonAcquisitionId,
  });
  const agreeingAuthority = request({
    facts: [primaryFact, agreeingFact],
    comparisonSources: [comparisonSource],
  });
  const agreeingDiscrepancy = evaluateMarketProviderDiscrepancy(agreeingAuthority, [
    agreeingFact,
    primaryFact,
  ]);
  assert.equal(agreeingDiscrepancy.comparisonResult, "agree");
  assert.notEqual(
    agreeingDiscrepancy.providerResults[0]?.result.selectedReferenceId,
    agreeingDiscrepancy.providerResults[1]?.result.selectedReferenceId,
  );
  assertCoreFixtureCase("D-01", "agree-provenance-distinct");
  const missingComparisonAuthority = request({
    facts: [primaryFact],
    comparisonSources: [comparisonSource],
  });
  assert.equal(
    evaluateMarketProviderDiscrepancy(missingComparisonAuthority, [primaryFact]).comparisonResult,
    "not-comparable",
  );
  const missingPrimaryAuthority = request({
    facts: [comparisonFact],
    comparisonSources: [comparisonSource],
  });
  const missingPrimary = selectMarketReference(missingPrimaryAuthority, [comparisonFact]);
  const secondaryOnlyDiscrepancy = evaluateMarketProviderDiscrepancy(missingPrimaryAuthority, [
    comparisonFact,
  ]);
  assert.equal(missingPrimary.status, "missing");
  assert.equal(secondaryOnlyDiscrepancy.providerResults[1]?.result.status, "selected-complete");
  assert.equal(secondaryOnlyDiscrepancy.comparisonResult, "not-comparable");
  assertCoreFixtureCase("D-03", "primary-missing-no-fallback");
  assert.throws(
    () =>
      deriveSelectionPolicyId({
        ...authority.selectionPolicy,
        providerPriority: {
          ...authority.selectionPolicy.providerPriority,
          entries: [
            { source: comparisonSource, role: "primary", rank: 0 },
            { source, role: "discrepancy-only", rank: 1 },
          ],
        },
      }),
    MarketContractError,
  );
});

test("redelivery preserves delivery evidence but collapses semantic selection", () => {
  const first = normalizeRecordedMarketRecord(quoteRecord({ occurrenceOrdinal: 0 }));
  const second = normalizeRecordedMarketRecord(
    quoteRecord({ occurrenceOrdinal: 1, memberKey: "same-record-redelivery" }),
  );
  assert.equal(first.providerObservationId, second.providerObservationId);
  assert.equal(first.revisionId, second.revisionId);
  assert.notEqual(first.deliveryId, second.deliveryId);
  const authority = request({ facts: [second, first] });
  const one = selectMarketReference(authority, [first, second]);
  const redelivered = selectMarketReference(authority, [second, first]);
  assert.equal(one.selectedReferenceId, redelivered.selectedReferenceId);
  assert.equal(one.candidateSetHash, redelivered.candidateSetHash);
});

test("declared corpus completeness is bidirectional and durable evidence preimages are exact", () => {
  const first = normalizeRecordedMarketRecord(
    quoteRecord({ family: "complete-a", revisionKey: "a" }),
  );
  const second = normalizeRecordedMarketRecord(
    quoteRecord({ family: "complete-b", revisionKey: "b" }),
  );
  const authority = request({ facts: [first, second] });
  assert.throws(
    () => selectMarketReference(authority, [first]),
    (error: unknown) =>
      error instanceof MarketContractError && error.reason.code === "market.identity-invalid",
  );
  const extra = normalizeRecordedMarketRecord(
    quoteRecord({ family: "complete-extra", revisionKey: "extra" }),
  );
  assert.throws(
    () => selectMarketReference(authority, [first, second, extra]),
    MarketContractError,
  );
  const forgedEvidencePreimage = {
    revisionId: first.revisionId,
    deliveryId: first.deliveryId,
    rawArtifactId: first.rawArtifactId,
    durablyRecordedAtMs: first.durablyRecordedAtMs,
    logicalAtMs: first.durableLogicalAtMs + 1,
    clockBasisId: first.durableClockBasisId,
  };
  const forgedFact = {
    ...first,
    durableLogicalAtMs: forgedEvidencePreimage.logicalAtMs,
    durableEvidenceHash: deriveDurableRevisionEvidenceHash(forgedEvidencePreimage),
  };
  assert.throws(
    () => selectMarketReference(authority, [forgedFact, second]),
    (error: unknown) =>
      error instanceof MarketContractError && error.reason.code === "market.identity-invalid",
  );
  assert.throws(
    () =>
      deriveRecordedCorpusSnapshotId({
        ...authority.recordedCorpus,
        revisionEvidence: authority.recordedCorpus.revisionEvidence.map((row, index) =>
          index === 0 ? { ...row, logicalAtMs: row.logicalAtMs + 1 } : row,
        ),
      }),
    MarketContractError,
  );
  assert.throws(
    () =>
      deriveRecordedCorpusSnapshotId({
        ...authority.recordedCorpus,
        revisionEvidence: authority.recordedCorpus.revisionEvidence.map((row, index) =>
          index === 0 ? { ...row, clockBasisId: "forged-clock" } : row,
        ),
      }),
    MarketContractError,
  );
});

test("redelivery bound accepts exactly 32 and rejects 33 before selection output", () => {
  const deliveries = Array.from({ length: 33 }, (_, index) =>
    normalizeRecordedMarketRecord(
      quoteRecord({
        occurrenceOrdinal: index,
        memberKey: `bounded-redelivery-${index.toString().padStart(2, "0")}`,
      }),
    ),
  );
  assert.equal(
    selectMarketReference(request({ facts: deliveries.slice(0, 32) }), deliveries.slice(0, 32))
      .status,
    "selected-complete",
  );
  assert.throws(
    () => selectMarketReference(request({ facts: deliveries }), deliveries),
    (error: unknown) =>
      error instanceof MarketContractError &&
      error.reason.code === "market.bound-exceeded" &&
      error.reason.detail !== null &&
      "limitKind" in error.reason.detail &&
      error.reason.detail.limitKind === "deliveriesPerProviderObservation",
  );
});

test("same-provider stable-key conflict quarantines independent of arrival order", () => {
  const first = normalizeRecordedMarketRecord(
    quoteRecord({ family: "conflict", revisionKey: "same", bid: "10", ask: "10.02" }),
  );
  const second = normalizeRecordedMarketRecord(
    quoteRecord({ family: "conflict", revisionKey: "same", bid: "11", ask: "11.02" }),
  );
  const left = selectMarketReference(request({ facts: [first, second] }), [first, second]);
  const right = selectMarketReference(request({ facts: [second, first] }), [second, first]);
  assert.equal(left.status, "missing");
  assert.deepEqual(
    left.reason,
    marketReason("market.provider-observation-invalid", {
      providerObservationFailureKind: "conflicting-content",
    }),
  );
  assert.equal(left.missingReferenceId, right.missingReferenceId);
});

test("recorded-primary and recorded-corrected apply immutable revision membership", () => {
  const originalRecord = quoteRecord({
    family: "corrected-family",
    revisionKey: "original",
    bid: "10",
    ask: "10.02",
  });
  const original = normalizeRecordedMarketRecord(originalRecord);
  const correctionPayload = {
    ...(originalRecord.payload as Extract<RecordedMarketRecordV1["payload"], { kind: "quote" }>),
    bidPrice: decimal("11"),
    askPrice: decimal("11.02"),
  };
  const correction = normalizeRecordedMarketRecord({
    ...originalRecord,
    providerRevisionKey: "correction",
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(correctionPayload),
    memberKey: "corrected-family-correction",
    revisionKind: "correction",
    supersedesRevisionId: original.revisionId,
    effectiveEventTime: originalRecord.eventTime,
    payload: correctionPayload,
    durablyRecordedAtMs: 105_001,
    primaryCorpusMember: false,
  });
  const primary = selectMarketReference(request({ facts: [original] }), [original]);
  const corrected = selectMarketReference(
    request({ viewKind: "recorded-corrected", facts: [original, correction] }),
    [original, correction],
  );
  assert.equal(primary.status, "selected-complete");
  assert.equal(corrected.status, "selected-complete");
  assert.equal(primary.selectedRevisionId, original.revisionId);
  assert.equal(corrected.selectedRevisionId, correction.revisionId);
  assert.notEqual(primary.selectedReferenceId, corrected.selectedReferenceId);
  assert.equal(original.payload?.kind, "quote");
  assert.equal(
    (original.payload as { bidPrice: { coefficient: string } }).bidPrice.coefficient,
    "10",
  );
});

test("a cancellation removes its target only from the admitted immutable view", () => {
  const originalRecord = quoteRecord({
    family: "cancelled-family",
    revisionKey: "original",
  });
  const original = normalizeRecordedMarketRecord(originalRecord);
  const cancellation = normalizeRecordedMarketRecord({
    ...originalRecord,
    providerRevisionKey: "cancel",
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(null),
    memberKey: "cancelled-family-cancel",
    revisionKind: "cancellation",
    supersedesRevisionId: original.revisionId,
    effectiveEventTime: originalRecord.eventTime,
    payload: null,
    durablyRecordedAtMs: 105_001,
    primaryCorpusMember: false,
  });
  const primary = selectMarketReference(request({ facts: [original] }), [original]);
  const corrected = selectMarketReference(
    request({ viewKind: "recorded-corrected", facts: [cancellation, original] }),
    [cancellation, original],
  );
  assert.equal(primary.status, "selected-complete");
  assert.equal(corrected.status, "missing");
  assert.deepEqual(corrected.reason, marketReason("market.no-eligible-quote"));
  assert.notEqual(primary.selectedReferenceId, corrected.missingReferenceId);
});

test("equal-time differing facts without trusted order are missing; trusted sequence resolves", () => {
  const firstRecord = quoteRecord({
    eventTimeNs: "100000000000",
    family: "equal-a",
    revisionKey: "a",
    bid: "10",
    ask: "10.02",
  });
  const secondRecord = quoteRecord({
    eventTimeNs: "100000000000",
    family: "equal-b",
    revisionKey: "b",
    bid: "11",
    ask: "11.02",
  });
  const ambiguousFacts = [
    normalizeRecordedMarketRecord(firstRecord),
    normalizeRecordedMarketRecord(secondRecord),
  ];
  const ambiguous = selectMarketReference(request({ facts: ambiguousFacts }), ambiguousFacts);
  assert.equal(ambiguous.status, "missing");
  assert.deepEqual(
    ambiguous.reason,
    marketReason("market.sequence-insufficient", {
      sequenceFailureKind: "equal-time-ambiguous",
    }),
  );

  const orderedFacts = [
    normalizeRecordedMarketRecord({
      ...firstRecord,
      providerSequence: {
        value: "1",
        scope: "synthetic-session",
        trustClass: "native-gap-checked",
      },
    }),
    normalizeRecordedMarketRecord({
      ...secondRecord,
      providerSequence: {
        value: "2",
        scope: "synthetic-session",
        trustClass: "native-gap-checked",
      },
    }),
  ];
  const ordered = selectMarketReference(request({ facts: orderedFacts }), orderedFacts);
  assert.equal(ordered.status, "selected-complete");
  assert.deepEqual(ordered.exactPrice, { numerator: "1101", denominator: "100" });
});

test("bounded batch normalization and selection reject one-over atomically", () => {
  const record = quoteRecord();
  assert.equal(normalizeRecordedMarketRecords([record]).length, 1);
  const fact = normalizeRecordedMarketRecord(record);
  const oneOver = new Array(10_001).fill(fact) as readonly (typeof fact)[];
  assert.throws(
    () => selectMarketReference(request({ facts: oneOver }), oneOver),
    (error: unknown) => {
      if (
        !(error instanceof MarketContractError) ||
        error.reason.code !== "market.bound-exceeded"
      ) {
        return false;
      }
      const detail = error.reason.detail;
      return (
        detail !== null &&
        "limitKind" in detail &&
        detail.limitKind === "candidatesPerReferenceSelection"
      );
    },
  );
});

test("all eleven reference kinds select only their explicit payload subtype", () => {
  const cases = MARKET_REFERENCE_KINDS.map((referenceKind, index) => {
    const base = quoteRecord({
      family: `reference-${index}`,
      revisionKey: `reference-${index}`,
      eventTimeNs: "100000000000",
    });
    let eventKind: RecordedMarketRecordV1["eventKind"];
    let payload: NonNullable<RecordedMarketRecordV1["payload"]>;
    if (referenceKind === "quote-nbbo-midpoint" || referenceKind === "bolo") {
      eventKind = "quote";
      payload = {
        ...(base.payload as Extract<RecordedMarketRecordV1["payload"], { kind: "quote" }>),
        quoteKind: referenceKind === "bolo" ? "bolo" : "nbbo",
      };
    } else if (
      referenceKind === "trade-last-eligible-consolidated" ||
      referenceKind === "opening-trade" ||
      referenceKind === "reopening-trade" ||
      referenceKind === "closing-trade" ||
      referenceKind === "final-eligible-trade-close"
    ) {
      eventKind = "trade";
      payload = {
        kind: "trade",
        tradeKind: {
          "trade-last-eligible-consolidated": "last-eligible",
          "opening-trade": "opening",
          "reopening-trade": "reopening",
          "closing-trade": "closing",
          "final-eligible-trade-close": "final-close",
        }[referenceKind] as "last-eligible" | "opening" | "reopening" | "closing" | "final-close",
        price: decimal("10.01"),
        size: decimal("100"),
        updatesConsolidatedLast: true,
        oddLot: false,
      };
    } else if (
      referenceKind === "bar-one-minute-completed-close" ||
      referenceKind === "daily-bar-close"
    ) {
      eventKind = "bar";
      payload = {
        kind: "bar",
        barKind: referenceKind === "bar-one-minute-completed-close" ? "one-minute" : "daily",
        close: decimal("10.01"),
        barStartNs: referenceKind === "bar-one-minute-completed-close" ? "40000000000" : "0",
        barEndNs: "100000000000",
        adjustmentMode: "raw",
      };
    } else if (referenceKind === "prior-listing-official-close") {
      eventKind = "prior-close";
      payload = {
        kind: "prior-close",
        price: decimal("10.01"),
        closeKind: "listing-official-close",
        sessionDate: "2027-02-02",
      };
    } else {
      eventKind = "official-open";
      payload = {
        kind: "official-value",
        valueKind: "listing-official-open",
        price: decimal("10.01"),
        sessionDate: "2027-02-03",
      };
    }
    return {
      referenceKind,
      fact: normalizeRecordedMarketRecord({
        ...base,
        eventKind,
        payload,
        canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(payload),
      }),
    };
  });
  for (const { referenceKind, fact } of cases) {
    const result = selectMarketReference(
      request({
        referenceKind,
        facts: [fact],
        comparator:
          referenceKind === "prior-listing-official-close"
            ? "authoritative-prior-close"
            : "at-or-before",
      }),
      [fact],
    );
    assert.match(result.status, /^selected-/u, referenceKind);
  }
});

test("control, LULD, and corporate-action records normalize as explicit deterministic state", () => {
  const base = quoteRecord({ family: "state", revisionKey: "state" });
  const payloads = [
    {
      eventKind: "trading-action" as const,
      payload: { kind: "trading-action" as const, action: "halt" as const },
    },
    {
      eventKind: "luld" as const,
      payload: { kind: "luld" as const, state: "non-executable" as const },
    },
    {
      eventKind: "corporate-action" as const,
      payload: {
        kind: "corporate-action" as const,
        actionKind: "symbol-change" as const,
        effectiveNs: "100000000000",
        successorInstrumentId: instrumentId,
      },
    },
  ];
  for (const [index, entry] of payloads.entries()) {
    const fact = normalizeRecordedMarketRecord({
      ...base,
      eventKind: entry.eventKind,
      providerStableRecordFamily: `state-${index}`,
      providerRecordKey: `state-${index}`,
      providerRevisionKey: `state-${index}`,
      memberKey: `state-${index}`,
      payload: entry.payload,
      canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(entry.payload),
    });
    assert.equal(fact.payload?.kind, entry.payload.kind);
  }
});

test("R-01..R-08 execute immutable revision, delivery, chain, and cutoff semantics", () => {
  const originalRecord = quoteRecord({
    family: "case-r-revisions",
    revisionKey: "original",
    bid: "10",
    ask: "10.02",
  });
  const original = normalizeRecordedMarketRecord(originalRecord);
  const correctedPayload = {
    ...(originalRecord.payload as Extract<RecordedMarketRecordV1["payload"], { kind: "quote" }>),
    bidPrice: decimal("11"),
    askPrice: decimal("11.02"),
  };
  const correctionRecord: RecordedMarketRecordV1 = {
    ...originalRecord,
    providerRevisionKey: "correction",
    memberKey: "case-r-revisions-correction",
    revisionKind: "correction",
    supersedesRevisionId: original.revisionId,
    effectiveEventTime: originalRecord.eventTime,
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(correctedPayload),
    payload: correctedPayload,
    durablyRecordedAtMs: 105_001,
    primaryCorpusMember: true,
  };
  const correction = normalizeRecordedMarketRecord(correctionRecord);

  const firstCorpusResult = selectMarketReference(request({ facts: [original, correction] }), [
    original,
    correction,
  ]);
  assert.equal(firstCorpusResult.selectedRevisionId, correction.revisionId);
  assertCoreFixtureCase("R-01", "correction-present-recorded-primary");

  const primary = selectMarketReference(request({ facts: [original] }), [original]);
  const corrected = selectMarketReference(
    request({
      viewKind: "recorded-corrected",
      facts: [
        original,
        normalizeRecordedMarketRecord({
          ...correctionRecord,
          primaryCorpusMember: false,
        }),
      ],
    }),
    [
      original,
      normalizeRecordedMarketRecord({
        ...correctionRecord,
        primaryCorpusMember: false,
      }),
    ],
  );
  assert.equal(primary.selectedRevisionId, original.revisionId);
  assert.notEqual(primary.selectedRevisionId, corrected.selectedRevisionId);
  assertCoreFixtureCase("R-02", "original-primary-correction-corrected");

  const cancellation = normalizeRecordedMarketRecord({
    ...originalRecord,
    providerRevisionKey: "cancellation",
    memberKey: "case-r-revisions-cancellation",
    revisionKind: "cancellation",
    supersedesRevisionId: original.revisionId,
    effectiveEventTime: originalRecord.eventTime,
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(null),
    payload: null,
    durablyRecordedAtMs: 105_001,
    primaryCorpusMember: false,
  });
  const cancelled = selectMarketReference(
    request({ viewKind: "recorded-corrected", facts: [original, cancellation] }),
    [original, cancellation],
  );
  assert.equal(primary.status, "selected-complete");
  assert.equal(cancelled.status, "missing");
  assertCoreFixtureCase("R-03", "primary-retains-corrected-removes-cancelled");

  const deliveryOne = normalizeRecordedMarketRecord(
    quoteRecord({ family: "case-r-redelivery", occurrenceOrdinal: 0 }),
  );
  const deliveryTwo = normalizeRecordedMarketRecord(
    quoteRecord({
      family: "case-r-redelivery",
      occurrenceOrdinal: 1,
      memberKey: "case-r-redelivery-second",
    }),
  );
  const redeliveryResult = selectMarketReference(request({ facts: [deliveryOne, deliveryTwo] }), [
    deliveryTwo,
    deliveryOne,
  ]);
  assert.equal(deliveryOne.normalizedMarketFactId, deliveryTwo.normalizedMarketFactId);
  assert.notEqual(deliveryOne.deliveryId, deliveryTwo.deliveryId);
  assert.equal(redeliveryResult.status, "selected-complete");
  assertCoreFixtureCase("R-04", "one-fact-two-deliveries");

  const conflictOne = normalizeRecordedMarketRecord(
    quoteRecord({ family: "case-r-conflict", revisionKey: "same", bid: "10", ask: "10.02" }),
  );
  const conflictTwo = normalizeRecordedMarketRecord(
    quoteRecord({ family: "case-r-conflict", revisionKey: "same", bid: "12", ask: "12.02" }),
  );
  const conflict = selectMarketReference(request({ facts: [conflictOne, conflictTwo] }), [
    conflictTwo,
    conflictOne,
  ]);
  assert.deepEqual(
    conflict.reason,
    marketReason("market.provider-observation-invalid", {
      providerObservationFailureKind: "conflicting-content",
    }),
  );
  assertCoreFixtureCase("R-05", "market.provider-observation-invalid:conflicting-content");

  const orphan = normalizeRecordedMarketRecord({
    ...correctionRecord,
    providerStableRecordFamily: "case-r-orphan",
    providerRecordKey: "case-r-orphan",
    providerRevisionKey: "orphan",
    memberKey: "case-r-orphan",
    supersedesRevisionId: `mrv1_${digest("absent-parent")}`,
  });
  const invalidChain = selectMarketReference(request({ facts: [orphan] }), [orphan]);
  assert.deepEqual(
    invalidChain.reason,
    marketReason("market.revision-invalid", { revisionFailureKind: "orphan" }),
  );
  const fork = selectMarketReference(request({ facts: [original, correction, cancellation] }), [
    correction,
    cancellation,
    original,
  ]);
  assert.deepEqual(
    fork.reason,
    marketReason("market.revision-invalid", { revisionFailureKind: "fork" }),
  );
  const afterCancellation = normalizeRecordedMarketRecord({
    ...correctionRecord,
    providerRevisionKey: "after-cancellation",
    memberKey: "case-r-revisions-after-cancellation",
    supersedesRevisionId: cancellation.revisionId,
  });
  const unsupportedChain = selectMarketReference(
    request({ facts: [original, cancellation, afterCancellation] }),
    [afterCancellation, original, cancellation],
  );
  assert.deepEqual(
    unsupportedChain.reason,
    marketReason("market.revision-invalid", {
      revisionFailureKind: "unsupported-after-cancellation",
    }),
  );
  assertCoreFixtureCase("R-06", "correction-chain-fails-closed");

  const correctedCutoffMs = 604_905_000;
  const cutoffPoints: readonly (readonly [string, number])[] = [
    ["minus", correctedCutoffMs - 1],
    ["equal", correctedCutoffMs],
    ["plus", correctedCutoffMs + 1],
  ];
  const cutoffFacts = cutoffPoints.map(([label, recordedAtMs]) =>
    normalizeRecordedMarketRecord(
      quoteRecord({
        family: `case-r-cutoff-${label}`,
        revisionKey: `case-r-cutoff-${label}`,
        memberKey: `case-r-cutoff-${label}`,
        durablyRecordedAtMs: recordedAtMs,
        durableLogicalAtMs: recordedAtMs,
      }),
    ),
  );
  const cutoffAuthority = request({ viewKind: "recorded-corrected", facts: cutoffFacts });
  const expectedAdmittedIds = cutoffFacts
    .filter((fact) => fact.durablyRecordedAtMs <= correctedCutoffMs)
    .map((fact) => fact.revisionId)
    .sort();
  const correctedCutoff = {
    ...cutoffAuthority.corpusCutoff,
    admittedRevisionSetHash: deriveAdmittedRevisionSetHash(expectedAdmittedIds),
  };
  assert.deepEqual(
    admittedRevisionIds(cutoffAuthority.recordedCorpus, correctedCutoff),
    expectedAdmittedIds,
  );
  assert.equal(expectedAdmittedIds.includes(cutoffFacts[2]?.revisionId as string), false);
  assertCoreFixtureCase("R-07", "cutoff-minus-and-equal-admitted-plus-one-excluded");

  assert.equal(
    evaluateFinalCorrectedCorpusClosure(correctedCutoffMs - 1, correctedCutoffMs * 1_000_000),
    null,
  );
  assert.equal(
    evaluateFinalCorrectedCorpusClosure(correctedCutoffMs, correctedCutoffMs * 1_000_000),
    null,
  );
  assert.deepEqual(
    evaluateFinalCorrectedCorpusClosure(correctedCutoffMs + 1, correctedCutoffMs * 1_000_000),
    marketReason("market.correction-view-unknown"),
  );
  assertCoreFixtureCase("R-08", "corrected-only-before-equal-admitted-after-unknown");
});

test("C-01..C-04 and I-01..I-03 execute corporate-action and instrument gates", () => {
  const fact = normalizeRecordedMarketRecord(
    quoteRecord({
      family: "case-context",
      revisionKey: "at-effective-boundary",
      eventTimeNs: "105000000000",
      bid: "99",
      ask: "101",
    }),
  );
  const base = request({ facts: [fact] });

  const crossingContext = {
    ...base.context,
    corporateActionState: "supported-sensitivity" as const,
  };
  assert.deepEqual(
    evaluateMarketSelectionContext(crossingContext),
    marketReason("market.corporate-action-crossing"),
  );
  const splitPrimary = selectMarketReference({ ...base, context: crossingContext }, [fact]);
  assert.equal(splitPrimary.status, "missing");
  assert.deepEqual(splitPrimary.reason, marketReason("market.corporate-action-crossing"));
  assert.deepEqual(
    exactSplitAdjustedSensitivity(decimal("100"), {
      numerator: "2",
      denominator: "1",
    }),
    { numerator: "50", denominator: "1" },
  );
  assertCoreFixtureCase("C-01", "split-crossing-primary-missing-adjusted-exact");

  assert.deepEqual(exactCashDistributionAdjustedSensitivity(decimal("100"), decimal("1.25")), {
    numerator: "395",
    denominator: "4",
  });
  assertCoreFixtureCase("C-02", "cash-distribution-adjusted-sensitivity");

  const unsupported = selectMarketReference({ ...base, context: crossingContext }, [fact]);
  assert.equal(unsupported.status, "missing");
  assert.equal(unsupported.exactPrice, null);
  assert.deepEqual(unsupported.reason, marketReason("market.corporate-action-crossing"));
  assertCoreFixtureCase("C-03", "unsupported-action-crossing-no-guess");

  const actionPayload = {
    kind: "corporate-action" as const,
    actionKind: "split" as const,
    effectiveNs: "105000000000",
    successorInstrumentId: instrumentId,
  };
  const actionRecord: RecordedMarketRecordV1 = {
    ...quoteRecord({
      family: "case-action-revision",
      revisionKey: "original-action",
      eventTimeNs: "105000000000",
    }),
    eventKind: "corporate-action",
    payload: actionPayload,
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(actionPayload),
  };
  const originalAction = normalizeRecordedMarketRecord(actionRecord);
  const correctedActionPayload = {
    ...actionPayload,
    effectiveNs: "105000000001",
  };
  const correctedAction = normalizeRecordedMarketRecord({
    ...actionRecord,
    providerRevisionKey: "corrected-action",
    memberKey: "case-action-revision-corrected",
    revisionKind: "correction",
    supersedesRevisionId: originalAction.revisionId,
    effectiveEventTime: actionRecord.eventTime,
    payload: correctedActionPayload,
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(correctedActionPayload),
    durablyRecordedAtMs: 105_001,
    primaryCorpusMember: false,
  });
  const actionPrimary = selectMarketReference(request({ facts: [originalAction] }), [
    originalAction,
  ]);
  const actionCorrected = selectMarketReference(
    request({
      viewKind: "recorded-corrected",
      facts: [originalAction, correctedAction],
    }),
    [correctedAction, originalAction],
  );
  assert.notEqual(originalAction.revisionId, correctedAction.revisionId);
  assert.notEqual(actionPrimary.missingReferenceId, actionCorrected.missingReferenceId);
  assertCoreFixtureCase("C-04", "action-revision-primary-corrected-distinct");

  const continuity = selectMarketReference(base, [fact]);
  assert.equal(continuity.status, "selected-complete");
  assert.equal(continuity.marketEventTimeNs, "105000000000");
  assertCoreFixtureCase("I-01", "symbol-change-continuity-at-effective-boundary");

  const unresolvedContext = {
    ...base.context,
    symbolContinuity: "unresolved" as const,
  };
  const reused = selectMarketReference({ ...base, context: unresolvedContext }, [fact]);
  assert.deepEqual(
    reused.reason,
    marketReason("market.instrument-invalid", {
      instrumentFailureKind: "symbol-continuity-unresolved",
    }),
  );
  assertCoreFixtureCase("I-02", "reused-symbol-no-continuity");

  const ambiguousContext = {
    ...base.context,
    symbolContinuity: "ambiguous" as const,
  };
  const ambiguous = selectMarketReference({ ...base, context: ambiguousContext }, [fact]);
  assert.deepEqual(
    ambiguous.reason,
    marketReason("market.instrument-invalid", { instrumentFailureKind: "ambiguous" }),
  );
  assert.deepEqual(
    evaluateMarketSelectionContext(unresolvedContext),
    marketReason("market.instrument-invalid", {
      instrumentFailureKind: "symbol-continuity-unresolved",
    }),
  );
  assertCoreFixtureCase("I-03", "instrument-ambiguous-and-continuity-unresolved");
});

test("M-01..M-03 execute strict/as-of, H-001, and independent missing selectors", () => {
  const metricPoints: readonly (readonly [string, string])[] = [
    ["pre", "99999999999"],
    ["publication-equal", "100000000000"],
    ["t0", "105000000000"],
    ["t1", "165000000000"],
    ["t5", "405000000000"],
    ["t30", "1905000000000"],
  ];
  const metricFacts = metricPoints.map(([label, eventTimeNs]) =>
    normalizeRecordedMarketRecord(
      quoteRecord({
        family: `case-m01-${label}`,
        revisionKey: `case-m01-${label}`,
        memberKey: `case-m01-${label}`,
        eventTimeNs,
      }),
    ),
  );
  const metricAuthority = request({ facts: metricFacts });
  const atInterval = (
    authority: MarketSelectionRequestV1,
    intervalKind: "publication-pre" | "t0" | "t1" | "t5" | "t30",
    targetTimeNs: string,
  ): MarketSelectionRequestV1 => {
    const interval = authority.selectionPolicy.intervalDefinitions.find(
      (candidate) => candidate.intervalKind === intervalKind,
    );
    assert.ok(interval);
    return {
      ...authority,
      intervalKey: deriveCanonicalId("mik1_", "peas/market-reference-interval/v1", interval),
      asOfBasis: {
        ...authority.asOfBasis,
        targetTimeNs,
        comparator: interval.comparator,
      },
    };
  };
  const publication = selectMarketReference(
    atInterval(metricAuthority, "publication-pre", "100000000000"),
    metricFacts,
  );
  assert.equal(publication.marketEventTimeNs, "99999999999");
  const destinations = [
    ["t0", "105000000000"],
    ["t1", "165000000000"],
    ["t5", "405000000000"],
    ["t30", "1905000000000"],
  ] as const;
  for (const [intervalKind, targetTimeNs] of destinations) {
    const result = selectMarketReference(
      atInterval(metricAuthority, intervalKind, targetTimeNs),
      metricFacts,
    );
    assert.equal(result.marketEventTimeNs, targetTimeNs);
  }
  assertCoreFixtureCase("M-01", "strict-pre-origin-and-as-of-destinations");

  const beforeRetrieval = normalizeRecordedMarketRecord(
    quoteRecord({
      family: "case-m02-before-retrieval",
      revisionKey: "before-retrieval",
      eventTimeNs: "100000000000",
      bid: "10",
      ask: "10.02",
    }),
  );
  const afterRetrievalBeforeCapture = normalizeRecordedMarketRecord(
    quoteRecord({
      family: "case-m02-after-retrieval",
      revisionKey: "after-retrieval",
      eventTimeNs: "105000000000",
      bid: "11",
      ask: "11.02",
    }),
  );
  const h001Facts = [beforeRetrieval, afterRetrievalBeforeCapture];
  const captureAuthority = request({ facts: h001Facts });
  const retrievalAuthority: MarketSelectionRequestV1 = {
    ...captureAuthority,
    asOfBasis: {
      ...captureAuthority.asOfBasis,
      anchorRole: "h001-mandatory-retrieval-sensitivity",
      trustedObservationBasis: {
        basisKind: "retrieval",
        role: "market-page-0",
        acquisitionObservationId,
        vaultObservationId: digest("case-m02-vault-observation"),
        retrievedAtMs: 100_000,
        clockBasisId: `clk1_${digest("case-m02-retrieval-clock")}`,
      },
      targetTimeNs: "100000000000",
    },
  };
  const captureResult = selectMarketReference(captureAuthority, h001Facts);
  const retrievalResult = selectMarketReference(retrievalAuthority, h001Facts);
  assert.equal(captureResult.marketEventTimeNs, "105000000000");
  assert.equal(retrievalResult.marketEventTimeNs, "100000000000");
  assert.notEqual(captureResult.selectedReferenceId, retrievalResult.selectedReferenceId);
  assertCoreFixtureCase("M-02", "durable-capture-primary-differs-retrieval");

  const q0 = normalizeRecordedMarketRecord(
    quoteRecord({
      family: "case-m03-q0",
      revisionKey: "q0",
      eventTimeNs: "105000000000",
    }),
  );
  const q5Stale = normalizeRecordedMarketRecord(
    quoteRecord({
      family: "case-m03-q5-stale",
      revisionKey: "q5-stale",
      eventTimeNs: "399999999999",
    }),
  );
  const statusAuthority = request({ facts: [q0, q5Stale] });
  const independentResults = [
    selectMarketReference(atInterval(statusAuthority, "t0", "105000000000"), [q0, q5Stale]),
    selectMarketReference(atInterval(statusAuthority, "t5", "405000000000"), [q0, q5Stale]),
    selectMarketReference(atInterval(statusAuthority, "t30", "1905000000000"), [q0, q5Stale]),
  ];
  assert.deepEqual(
    independentResults.map((result) => result.status),
    ["selected-complete", "missing", "missing"],
  );
  assert.equal(independentResults.length, 3);
  assert.deepEqual(independentResults[1]?.reason, marketReason("market.quote-stale"));
  assertCoreFixtureCase("M-03", "independent-statuses-denominator-retained");
});

test("every core-owned bound executes its real enforcement site at exact and violating vectors", () => {
  const assertReason = (
    operation: () => unknown,
    code: string,
    detail: CanonicalMarketReasonDetailV1 | null = null,
  ) => {
    assert.throws(
      operation,
      (error: unknown) =>
        error instanceof MarketContractError &&
        error.reason.code === code &&
        canonicalHash("peas/test-reason/v1", error.reason) ===
          canonicalHash("peas/test-reason/v1", { code, detail }),
    );
  };

  validateTimestampTextBound("1".repeat(64));
  assertReason(() => validateTimestampTextBound("1".repeat(65)), "market.bound-exceeded", {
    limitKind: "timestampTextBytes",
  });

  validateConditionMembers(Array.from({ length: 8 }, (_, index) => `C${index}123456`));
  assertReason(
    () => validateConditionMembers(Array.from({ length: 9 }, (_, index) => `C${index}`)),
    "market.bound-exceeded",
    { limitKind: "conditionMembers" },
  );
  validateConditionMembers(["12345678"]);
  assertReason(() => validateConditionMembers(["123456789"]), "market.bound-exceeded", {
    limitKind: "conditionMemberBytes",
  });

  validateProviderDecimalEvidenceToken(`1${"0".repeat(31)}`);
  assertReason(
    () => validateProviderDecimalEvidenceToken(`1${"0".repeat(32)}`),
    "market.bound-exceeded",
    { limitKind: "rawDecimalTokenBytes" },
  );
  validateProviderDecimalEvidenceToken(`0.${"1".repeat(12)}`);
  assertReason(
    () => validateProviderDecimalEvidenceToken(`0.${"1".repeat(13)}`),
    "market.decimal-invalid",
  );

  validatePrimaryDecimalShape(20, 6);
  assertReason(() => validatePrimaryDecimalShape(21, 6), "market.decimal-invalid");
  assertReason(() => validatePrimaryDecimalShape(20, 7), "market.decimal-invalid");
  validateDerivedMidpointScale(7);
  assertReason(() => validateDerivedMidpointScale(8), "market.decimal-invalid");
  validateRationalComponentBytes("1".repeat(32), "2".repeat(32));
  assertReason(() => validateRationalComponentBytes("1".repeat(33), "2"), "market.decimal-invalid");
  assert.deepEqual(reduceRational(1n, 2n), { numerator: "1", denominator: "2" });

  validateProviderCount(8);
  assertReason(() => validateProviderCount(9), "market.bound-exceeded", {
    limitKind: "providersPerSelectionPolicy",
  });
  validateMarketCenterStateCount(64);
  assertReason(() => validateMarketCenterStateCount(65), "market.bound-exceeded", {
    limitKind: "marketCentersPerInstrumentState",
  });
  validateRevisionDepth(16);
  assertReason(() => validateRevisionDepth(17), "market.bound-exceeded", {
    limitKind: "revisionDepthPerFamily",
  });
  validateDeliveryCount(32);
  assertReason(() => validateDeliveryCount(33), "market.bound-exceeded", {
    limitKind: "deliveriesPerProviderObservation",
  });
  validateCandidateCount(10_000);
  assertReason(() => validateCandidateCount(10_001), "market.bound-exceeded", {
    limitKind: "candidatesPerReferenceSelection",
  });

  validatePrimaryResidualConfiguration(["T0", "T1", "T5", "T30"], 1_800_000_000_000n);
  assertReason(
    () =>
      validatePrimaryResidualConfiguration(["T0", "T1", "T5", "T30", "T31"], 1_800_000_000_000n),
    "market.bound-exceeded",
    { limitKind: "primaryResidualTargets" },
  );
  assertReason(
    () => validatePrimaryResidualConfiguration(["T0", "T1", "T5"], 1_800_000_000_000n),
    "market.input-invalid",
  );
  assertReason(
    () => validatePrimaryResidualConfiguration(["T0", "T1", "T5", "T30"], 1_800_000_000_001n),
    "market.bound-exceeded",
    { limitKind: "primaryResidualHorizonNs" },
  );

  validateQuoteAge("regular", 5_000_000_000n);
  assertReason(() => validateQuoteAge("regular", 5_000_000_001n), "market.quote-stale");
  validateQuoteAge("extended", 30_000_000_000n);
  assertReason(() => validateQuoteAge("extended", 30_000_000_001n), "market.quote-stale");
  validateBarDuration(60_000_000_000n);
  assertReason(() => validateBarDuration(59_999_999_999n), "market.input-invalid");
  assertReason(() => validateBarDuration(60_000_000_001n), "market.input-invalid");
  validateCaptureRetrievalLag(1_000_000, 400_000);
  assertReason(
    () => validateCaptureRetrievalLag(1_000_001, 400_000),
    "market.timestamp-insufficient",
    { timestampFailureKind: "capture-retrieval-lag-exceeded" },
  );

  assert.deepEqual(
    new Set([...CORE_OWNED_BOUND_IDS, ...LOADER_OWNED_BOUND_IDS, ...STUDY_OWNED_BOUND_IDS]),
    new Set(CANONICAL_BOUND_IDS),
  );
});

test("all 84 canonical bounds have one unique enforcement disposition", () => {
  assert.equal(CANONICAL_BOUND_IDS.length, 84);
  assert.equal(new Set(CANONICAL_BOUND_IDS).size, 84);
  assert.equal(BOUND_ENFORCEMENT_REGISTRY.length, 84);
  assert.deepEqual(
    new Set(BOUND_ENFORCEMENT_REGISTRY.map((row) => row.boundId)),
    new Set(CANONICAL_BOUND_IDS),
  );
  const replayPage = BOUND_ENFORCEMENT_REGISTRY.find(
    (row) => row.boundId === "recordedReplayPageSize",
  );
  assert.equal(replayPage?.exactValue, "1..10000");
  assert.equal(replayPage?.upperViolation, "market-bound");
  const clusters = BOUND_ENFORCEMENT_REGISTRY.find((row) => row.boundId === "targetClusters");
  assert.equal(clusters?.exactValue, "exactly:180;range:100..200");
  assert.equal(clusters?.countMinusOneViolation, "study-input");
  const liquidity = BOUND_ENFORCEMENT_REGISTRY.find(
    (row) => row.boundId === "minimumValidLiquiditySessions",
  );
  assert.equal(liquidity?.exactValue, "15-of-20");
  assert.equal(liquidity?.lowerViolation, "study-liquidity-unknown");
});

test("record, nested timestamp, payload, boolean, and provider preimages fail closed on extras", () => {
  const base = quoteRecord();
  assert.throws(
    () =>
      normalizeRecordedMarketRecord({
        ...base,
        topExtra: "forbidden",
      } as unknown as RecordedMarketRecordV1),
    MarketContractError,
  );
  assert.throws(
    () =>
      normalizeRecordedMarketRecord({
        ...base,
        eventTime: { ...base.eventTime, nestedExtra: true },
      } as unknown as RecordedMarketRecordV1),
    MarketContractError,
  );
  assert.throws(
    () =>
      normalizeRecordedMarketRecord({
        ...base,
        payload: { ...base.payload, payloadExtra: true },
      } as unknown as RecordedMarketRecordV1),
    MarketContractError,
  );
  assert.throws(
    () =>
      normalizeRecordedMarketRecord({
        ...base,
        primaryCorpusMember: "yes",
      } as unknown as RecordedMarketRecordV1),
    MarketContractError,
  );
  assert.throws(
    () =>
      deriveMarketProviderId({
        providerCode: "peas-synthetic-a",
        serviceOperatorCode: "peas-project",
        extra: true,
      } as never),
    MarketContractError,
  );
});

test("selection rejects unknown enums, extra fields, and forged policy/corpus/cutoff preimages", () => {
  const base = request();
  for (const forged of [
    { ...base, referenceKind: "unknown-reference" },
    { ...base, asOfBasis: { ...base.asOfBasis, comparator: "first-after" } },
    { ...base, asOfBasis: { ...base.asOfBasis, viewKind: "live" } },
    { ...base, extra: true },
    {
      ...base,
      selectionPolicy: {
        ...base.selectionPolicy,
        targetSelector: "first-after",
      },
    },
    {
      ...base,
      recordedCorpus: {
        ...base.recordedCorpus,
        corpusClosedAtMs: base.recordedCorpus.corpusClosedAtMs + 1,
      },
    },
    {
      ...base,
      corpusCutoff: {
        ...base.corpusCutoff,
        cutoffObservationEvidenceHash: digest("forged-cutoff-evidence"),
      },
    },
  ]) {
    assert.throws(
      () => selectMarketReference(forged as unknown as MarketSelectionRequestV1, []),
      MarketContractError,
    );
  }
});

test("Q-12 executes native sequence gap, suppression, authoritative reset, and recovery", () => {
  const replay = replayNativeSequence([
    { kind: "data", sequence: "1", semanticDigest: digest("Q-12:one") },
    { kind: "data", sequence: "3", semanticDigest: digest("Q-12:gap") },
    { kind: "data", sequence: "4", semanticDigest: digest("Q-12:suppressed") },
    { kind: "reset", nextSequence: "10", authoritative: true },
    { kind: "data", sequence: "10", semanticDigest: digest("Q-12:recovered") },
  ]);
  assert.deepEqual(
    replay.steps.map((step) => step.disposition),
    ["accepted", "gap-opened", "suppressed-through-gap", "authoritative-reset", "accepted"],
  );
  assert.deepEqual(
    replay.steps[1]?.reason,
    marketReason("market.sequence-insufficient", { sequenceFailureKind: "gap" }),
  );
  assert.equal(replay.finalState, "healthy");
  assert.equal(replay.steps[3]?.marketStateAvailableAfter, false);
  assert.equal(replay.marketStateAvailable, true);
  assert.equal(replay.nextExpectedSequence, "11");
  assert.deepEqual(replay.acceptedSemanticDigests, [digest("Q-12:one"), digest("Q-12:recovered")]);

  const unexpected = replayNativeSequence([
    { kind: "data", sequence: "8", semanticDigest: digest("Q-12:before-unexpected-reset") },
    { kind: "reset", nextSequence: "1", authoritative: false },
    { kind: "data", sequence: "1", semanticDigest: digest("Q-12:must-not-heal") },
  ]);
  assert.equal(unexpected.finalState, "invalid-until-authoritative-reset");
  assert.deepEqual(unexpected.steps[1]?.reason, marketReason("market.sequence-regression"));
  assert.equal(unexpected.steps[2]?.disposition, "suppressed-through-gap");
});

test("T-01..T-05 replay complete trade-condition and day state without timestamp heuristics", () => {
  const replay = replayConsolidatedLast([
    {
      eventId: "T-03:first-prior-reference",
      condition: "prior-reference-price",
      price: decimal("9.90"),
      conditionalDayState: "qualifying",
    },
    {
      eventId: "T-01:regular",
      condition: "regular",
      price: decimal("10.00"),
      conditionalDayState: "nonqualifying",
    },
    {
      eventId: "T-02:sold-last-qualifying",
      condition: "sold-last",
      price: decimal("10.01"),
      conditionalDayState: "qualifying",
    },
    {
      eventId: "T-02:sold-last-unknown-state",
      condition: "sold-last",
      price: decimal("10.02"),
      conditionalDayState: "unknown",
    },
    {
      eventId: "T-03:prior-reference-after-normal-last",
      condition: "prior-reference-price",
      price: decimal("10.03"),
      conditionalDayState: "qualifying",
    },
    {
      eventId: "T-04:odd-lot",
      condition: "odd-lot",
      price: decimal("11.00"),
      conditionalDayState: "nonqualifying",
    },
    {
      eventId: "T-05:out-of-sequence-after-normal-last",
      condition: "sold-out-of-sequence",
      price: decimal("9.00"),
      conditionalDayState: "qualifying",
    },
  ]);
  assert.deepEqual(
    replay.steps.map((step) => step.updatesConsolidatedLast),
    [true, true, true, "state-insufficient", false, false, false],
  );
  assert.deepEqual(
    replay.steps[3]?.reason,
    marketReason("market.trade-condition-ineligible", {
      tradeConditionFailureKind: "state-insufficient",
    }),
  );
  assert.deepEqual(
    replay.steps[4]?.reason,
    marketReason("market.trade-condition-ineligible", {
      tradeConditionFailureKind: "does-not-update-last",
    }),
  );
  assert.deepEqual(replay.consolidatedLast, decimal("10.01"));
});

test("S-01..S-04 execute holiday, early-close, DST, and session-transition gates", () => {
  const ns = (iso: string): string => (BigInt(Date.parse(iso)) * 1_000_000n).toString();
  const holiday = {
    sessionDate: "2026-07-04",
    timeZone: "America/New_York" as const,
    utcOffsetMinutes: -240 as const,
    calendarVersion: "fictional-xnas-2026-v1",
    holiday: true,
    extendedOpenNs: null,
    regularOpenNs: null,
    regularCloseNs: null,
    extendedCloseNs: null,
  };
  assert.equal(
    classifyFrozenSession(holiday, ns("2026-07-04T15:00:00Z")).sessionKind,
    "calendar-closed",
  );

  const earlyClose = {
    ...holiday,
    sessionDate: "2026-07-03",
    holiday: false,
    extendedOpenNs: ns("2026-07-03T08:00:00Z"),
    regularOpenNs: ns("2026-07-03T13:30:00Z"),
    regularCloseNs: ns("2026-07-03T17:00:00Z"),
    extendedCloseNs: ns("2026-07-03T21:00:00Z"),
  };
  assert.equal(
    classifyFrozenSession(earlyClose, (BigInt(earlyClose.regularCloseNs) - 1n).toString())
      .sessionKind,
    "regular-continuous",
  );
  assert.equal(
    classifyFrozenSession(earlyClose, earlyClose.regularCloseNs).sessionKind,
    "extended-post",
  );

  const dstEntries = [
    {
      sessionDate: "2026-03-06",
      offset: -300 as const,
      open: "2026-03-06T14:30:00Z",
      close: "2026-03-06T21:00:00Z",
    },
    {
      sessionDate: "2026-03-09",
      offset: -240 as const,
      open: "2026-03-09T13:30:00Z",
      close: "2026-03-09T20:00:00Z",
    },
    {
      sessionDate: "2026-10-30",
      offset: -240 as const,
      open: "2026-10-30T13:30:00Z",
      close: "2026-10-30T20:00:00Z",
    },
    {
      sessionDate: "2026-11-02",
      offset: -300 as const,
      open: "2026-11-02T14:30:00Z",
      close: "2026-11-02T21:00:00Z",
    },
  ].map((row) => ({
    sessionDate: row.sessionDate,
    timeZone: "America/New_York" as const,
    utcOffsetMinutes: row.offset,
    calendarVersion: "fictional-xnas-2026-v1",
    holiday: false,
    extendedOpenNs: (BigInt(ns(row.open)) - 19_800_000_000_000n).toString(),
    regularOpenNs: ns(row.open),
    regularCloseNs: ns(row.close),
    extendedCloseNs: (BigInt(ns(row.close)) + 14_400_000_000_000n).toString(),
  }));
  assert.deepEqual(
    dstEntries.map((entry) => classifyFrozenSession(entry, entry.regularOpenNs).utcOffsetMinutes),
    [-300, -240, -240, -300],
  );
  assert.deepEqual(evaluateSessionTransition("extended-pre", "regular-continuous"), {
    status: "missing",
    reason: marketReason("market.session-transition"),
  });
  assert.deepEqual(evaluateSessionTransition("regular-continuous", "regular-continuous"), {
    status: "same-session",
    reason: null,
  });
});

test("Q-05/Q-06/Q-08/Q-10 execute missing-side and strict-executable quote sensitivity", () => {
  const side = (price: string) => ({ price: decimal(price), size: decimal("100") });
  const oneSided = constructTwoSidedQuote({
    quoteKind: "nbbo",
    bid: side("10"),
    ask: null,
    explicitConsolidatedNbbo: true,
    condition: "eligible",
    slow: false,
    luldState: "executable",
    halted: false,
  });
  assert.deepEqual(oneSided, {
    status: "missing-side",
    payload: null,
    missingSides: ["ask"],
    reason: marketReason("market.quote-one-sided"),
  });

  const complete = constructTwoSidedQuote({
    quoteKind: "nbbo",
    bid: side("10"),
    ask: side("10.02"),
    explicitConsolidatedNbbo: true,
    condition: "eligible",
    slow: false,
    luldState: "executable",
    halted: false,
  });
  assert.equal(complete.status, "complete");
  if (complete.status !== "complete") assert.fail("expected complete Q-05 control");
  assert.equal(evaluateStrictExecutableQuote(complete.payload).status, "eligible");

  const locked = evaluateStrictExecutableQuote({
    ...complete.payload,
    askPrice: complete.payload.bidPrice,
  });
  assert.equal(locked.status, "missing");
  assert.deepEqual(
    locked.excludedDiagnostic,
    marketReason("market.quote-quality-degraded", { qualityKind: "locked" }),
  );

  const slow = evaluateStrictExecutableQuote({ ...complete.payload, slow: true });
  assert.equal(slow.status, "missing");
  assert.deepEqual(
    slow.excludedDiagnostic,
    marketReason("market.quote-quality-degraded", { qualityKind: "slow" }),
  );
  const strictSelection = selectStrictExecutableQuote(
    [
      { candidateId: "Q-08:earlier-executable", eventTimeNs: "100", payload: complete.payload },
      {
        candidateId: "Q-08:latest-slow",
        eventTimeNs: "101",
        payload: { ...complete.payload, slow: true },
      },
    ],
    "101",
  );
  assert.equal(strictSelection.selectedCandidateId, "Q-08:earlier-executable");

  const limit = evaluateStrictExecutableQuote({ ...complete.payload, luldState: "limit" });
  assert.equal(limit.status, "missing");
  assert.deepEqual(
    limit.excludedDiagnostic,
    marketReason("market.quote-quality-degraded", { qualityKind: "luld-limit-state" }),
  );
  assert.deepEqual(
    evaluateStrictExecutableQuote({ ...complete.payload, luldState: "non-executable" }).reason,
    marketReason("market.quote-luld-nonexecutable"),
  );
});

test("Q-14/Q-15 keep NBBO, BOLO, and independent source identities isolated", () => {
  const nbbo = quoteRecord({
    family: "Q-14:nbbo",
    revisionKey: "Q-14:nbbo",
    bid: "10",
    ask: "10.02",
  }).payload as Extract<RecordedMarketRecordV1["payload"], { kind: "quote" }>;
  const bolo = {
    ...nbbo,
    quoteKind: "bolo" as const,
    bidPrice: decimal("10.03"),
    askPrice: decimal("10.04"),
    explicitConsolidatedNbbo: false,
  };
  const candidates = [
    { candidateId: "Q-14:protected", eventTimeNs: "100", payload: nbbo },
    { candidateId: "Q-14:bolo", eventTimeNs: "101", payload: bolo },
  ];
  const protectedResult = selectIsolatedQuoteReference(candidates, "quote-nbbo-midpoint", "200");
  const boloResult = selectIsolatedQuoteReference(candidates, "bolo", "200");
  assert.equal(protectedResult.selectedCandidateId, "Q-14:protected");
  assert.deepEqual(protectedResult.exactMidpoint, { numerator: "1001", denominator: "100" });
  assert.equal(boloResult.selectedCandidateId, "Q-14:bolo");
  assert.notDeepEqual(protectedResult.exactMidpoint, boloResult.exactMidpoint);

  const agreement = compareIndependentSourceReferences([
    {
      sourceIdentity: "Q-15:source-a",
      selectionIdentity: "Q-15:selection-a",
      exactPrice: decimal("10.01"),
    },
    {
      sourceIdentity: "Q-15:source-b",
      selectionIdentity: "Q-15:selection-b",
      exactPrice: { numerator: "1001", denominator: "100" },
    },
  ]);
  assert.equal(agreement.comparison, "agree");
  assert.deepEqual(agreement.sourceIdentities, ["Q-15:source-a", "Q-15:source-b"]);
  assert.deepEqual(agreement.selectionIdentities, ["Q-15:selection-a", "Q-15:selection-b"]);
});

test("B-03 executes adjusted-bar sensitivity while raw B(t) remains isolated", () => {
  const raw = {
    kind: "bar" as const,
    barKind: "one-minute" as const,
    close: decimal("10.01"),
    barStartNs: "45000000000",
    barEndNs: "105000000000",
    adjustmentMode: "raw" as const,
  };
  const adjusted = { ...raw, adjustmentMode: "split" as const };
  assert.deepEqual(evaluateRecordedBarSensitivity(raw, "105000000000"), {
    status: "point-eligible",
    exactClose: decimal("10.01"),
    adjustmentMode: "raw",
    reason: null,
  });
  assert.deepEqual(evaluateRecordedBarSensitivity(adjusted, "105000000000"), {
    status: "adjusted-sensitivity-only",
    exactClose: decimal("10.01"),
    adjustmentMode: "split",
    reason: null,
  });

  const base = quoteRecord({
    family: "B-03:base",
    revisionKey: "B-03:base",
    eventTimeNs: "105000000000",
  });
  const rawFact = normalizeRecordedMarketRecord({
    ...base,
    eventKind: "bar",
    providerStableRecordFamily: "B-03:raw",
    providerRecordKey: "B-03:raw",
    providerRevisionKey: "B-03:raw",
    memberKey: "B-03:raw",
    payload: raw,
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(raw),
  });
  const adjustedFact = normalizeRecordedMarketRecord({
    ...base,
    eventKind: "bar",
    providerStableRecordFamily: "B-03:adjusted",
    providerRecordKey: "B-03:adjusted",
    providerRevisionKey: "B-03:adjusted",
    memberKey: "B-03:adjusted",
    payload: adjusted,
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(adjusted),
  });
  const result = selectMarketReference(
    request({
      referenceKind: "bar-one-minute-completed-close",
      facts: [rawFact, adjustedFact],
    }),
    [adjustedFact, rawFact],
  );
  assert.equal(result.status, "selected-complete");
  assert.equal(result.selectedNormalizedMarketFactId, rawFact.normalizedMarketFactId);
  assert.ok(
    result.candidates.some(
      (candidate) =>
        candidate.normalizedMarketFactId === adjustedFact.normalizedMarketFactId &&
        candidate.reason?.code === "market.silent-fallback-forbidden",
    ),
  );
});

test("T-06 and PCL-01..PCL-03 keep official, trade, and close facts separately typed", () => {
  assert.deepEqual(
    (["Q", "O", "5", "6", "M", "9"] as const).map((code) => classifyTapeOfficialTradeCode(code)),
    [
      {
        code: "Q",
        eventKind: "official-open",
        payloadKind: "official-value",
        valueKind: "listing-official-open",
      },
      { code: "O", eventKind: "trade", payloadKind: "trade", tradeKind: "opening" },
      { code: "5", eventKind: "trade", payloadKind: "trade", tradeKind: "reopening" },
      { code: "6", eventKind: "trade", payloadKind: "trade", tradeKind: "closing" },
      {
        code: "M",
        eventKind: "official-close",
        payloadKind: "prior-close",
        closeKind: "listing-official-close",
      },
      {
        code: "9",
        eventKind: "corrected-close",
        payloadKind: "prior-close",
        closeKind: "corrected-consolidated-close",
      },
    ],
  );

  const base = quoteRecord({
    family: "PCL:base",
    revisionKey: "PCL:base",
    eventTimeNs: "90000000000",
  });
  const officialPayload = {
    kind: "prior-close" as const,
    price: decimal("10"),
    closeKind: "listing-official-close" as const,
    sessionDate: "2027-02-02",
  };
  const correctedPayload = {
    ...officialPayload,
    price: decimal("10.01"),
    closeKind: "corrected-consolidated-close" as const,
  };
  const official = normalizeRecordedMarketRecord({
    ...base,
    eventKind: "official-close",
    providerStableRecordFamily: "PCL-02",
    providerRecordKey: "PCL-02",
    providerRevisionKey: "PCL-02",
    memberKey: "PCL-02",
    payload: officialPayload,
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(officialPayload),
  });
  const corrected = normalizeRecordedMarketRecord({
    ...base,
    eventKind: "corrected-close",
    providerStableRecordFamily: "PCL-01",
    providerRecordKey: "PCL-01",
    providerRevisionKey: "PCL-01",
    memberKey: "PCL-01",
    payload: correctedPayload,
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(correctedPayload),
  });
  const correctedFirst = selectMarketReference(
    request({
      referenceKind: "prior-listing-official-close",
      comparator: "authoritative-prior-close",
      facts: [official, corrected],
    }),
    [official, corrected],
  );
  assert.equal(correctedFirst.selectedNormalizedMarketFactId, corrected.normalizedMarketFactId);

  const officialOnly = selectMarketReference(
    request({
      referenceKind: "prior-listing-official-close",
      comparator: "authoritative-prior-close",
      facts: [official],
    }),
    [official],
  );
  assert.equal(officialOnly.selectedNormalizedMarketFactId, official.normalizedMarketFactId);

  const finalTrade = normalizeRecordedMarketRecord(tradeRecord());
  const noPriorClose = selectMarketReference(
    request({
      referenceKind: "prior-listing-official-close",
      comparator: "authoritative-prior-close",
      facts: [finalTrade],
    }),
    [finalTrade],
  );
  assert.equal(noPriorClose.status, "missing");
  assert.deepEqual(
    noPriorClose.reason,
    marketReason("market.prior-close-missing", { priorCloseFailureKind: "absent" }),
  );
});

test("Q-01/Q-02/Q-04/Q-07/Q-09 and B-01/B-02 execute exact boundary helpers", () => {
  const payload = quoteRecord({ family: "boundary:base", revisionKey: "boundary:base" })
    .payload as Extract<RecordedMarketRecordV1["payload"], { kind: "quote" }>;
  assert.deepEqual(
    evaluatePrimaryQuoteBoundary(
      { ...payload, bidPrice: decimal("10.000000"), askPrice: decimal("10.020000") },
      "regular-continuous",
      "0",
    ).exactMidpoint,
    { numerator: "1001", denominator: "100" },
  );
  assert.deepEqual(
    evaluatePrimaryQuoteBoundary(
      { ...payload, bidPrice: decimal("1.000000"), askPrice: decimal("1.000001") },
      "regular-continuous",
      "0",
    ).exactMidpoint,
    { numerator: "2000001", denominator: "2000000" },
  );
  assert.equal(
    evaluatePrimaryQuoteBoundary(payload, "regular-continuous", "5000000000").status,
    "selected-complete",
  );
  assert.deepEqual(
    evaluatePrimaryQuoteBoundary(payload, "regular-continuous", "5000000001").reason,
    marketReason("market.quote-stale"),
  );
  assert.deepEqual(
    evaluatePrimaryQuoteBoundary(
      { ...payload, bidPrice: decimal("10.03"), askPrice: decimal("10.02") },
      "regular-continuous",
      "0",
    ).reason,
    marketReason("market.quote-crossed"),
  );
  assert.deepEqual(
    evaluatePrimaryQuoteBoundary({ ...payload, condition: "unknown" }, "regular-continuous", "0")
      .reason,
    marketReason("market.condition-unknown"),
  );

  const completedBar = {
    kind: "bar" as const,
    barKind: "one-minute" as const,
    close: decimal("10.01"),
    barStartNs: "45000000000",
    barEndNs: "105000000000",
    adjustmentMode: "raw" as const,
  };
  assert.equal(
    evaluateRecordedBarSensitivity(completedBar, "105000000000").status,
    "point-eligible",
  );
  assert.deepEqual(
    evaluateRecordedBarSensitivity(completedBar, "104999999999").reason,
    marketReason("market.bar-interval-future"),
  );
});

test("Q-03/Q-11/Q-13 execute target, halt/resume, and equal-time conflict timelines", () => {
  const payload = quoteRecord({ family: "timeline:base", revisionKey: "timeline:base" })
    .payload as Extract<RecordedMarketRecordV1["payload"], { kind: "quote" }>;
  const targetAndFuture = [
    {
      kind: "quote" as const,
      eventId: "Q-03:target",
      eventTimeNs: "100",
      trustedSequence: "1",
      sessionKind: "regular-continuous" as const,
      payload,
    },
    {
      kind: "quote" as const,
      eventId: "Q-03:plus-one",
      eventTimeNs: "101",
      trustedSequence: "2",
      sessionKind: "regular-continuous" as const,
      payload: { ...payload, bidPrice: decimal("11"), askPrice: decimal("11.02") },
    },
  ];
  const atTarget = selectQuoteTimelineReference(targetAndFuture, "100");
  assert.equal(atTarget.selectedEventId, "Q-03:target");
  assert.equal(atTarget.marketEventTimeNs, "100");

  const haltTimeline = [
    {
      kind: "quote" as const,
      eventId: "Q-11:pre-halt",
      eventTimeNs: "100",
      trustedSequence: "1",
      sessionKind: "regular-continuous" as const,
      payload,
    },
    {
      kind: "trading-action" as const,
      eventId: "Q-11:halt",
      eventTimeNs: "101",
      trustedSequence: "2",
      action: "halt" as const,
    },
    {
      kind: "quote" as const,
      eventId: "Q-11:during-halt",
      eventTimeNs: "102",
      trustedSequence: "3",
      sessionKind: "regular-continuous" as const,
      payload,
    },
    {
      kind: "trading-action" as const,
      eventId: "Q-11:quote-resume",
      eventTimeNs: "103",
      trustedSequence: "4",
      action: "quote-resume" as const,
    },
    {
      kind: "trading-action" as const,
      eventId: "Q-11:trade-resume",
      eventTimeNs: "104",
      trustedSequence: "5",
      action: "trade-resume" as const,
    },
    {
      kind: "quote" as const,
      eventId: "Q-11:post-resume",
      eventTimeNs: "105",
      trustedSequence: "6",
      sessionKind: "regular-continuous" as const,
      payload: { ...payload, bidPrice: decimal("10.10"), askPrice: decimal("10.12") },
    },
  ];
  assert.deepEqual(
    selectQuoteTimelineReference([...haltTimeline].reverse(), "101").reason,
    marketReason("market.quote-halt"),
  );
  assert.deepEqual(
    selectQuoteTimelineReference(haltTimeline, "104").reason,
    marketReason("market.no-eligible-quote"),
  );
  assert.equal(
    selectQuoteTimelineReference(haltTimeline, "105").selectedEventId,
    "Q-11:post-resume",
  );

  const equalTimeConflict = selectQuoteTimelineReference(
    [
      {
        kind: "quote",
        eventId: "Q-13:left",
        eventTimeNs: "100",
        trustedSequence: null,
        sessionKind: "regular-continuous",
        payload,
      },
      {
        kind: "quote",
        eventId: "Q-13:right",
        eventTimeNs: "100",
        trustedSequence: null,
        sessionKind: "regular-continuous",
        payload: { ...payload, bidPrice: decimal("11"), askPrice: decimal("11.02") },
      },
    ],
    "100",
  );
  assert.deepEqual(
    equalTimeConflict.reason,
    marketReason("market.sequence-insufficient", {
      sequenceFailureKind: "equal-time-ambiguous",
    }),
  );
});

test("S-05 excludes overnight state without changing the regular primary lane", () => {
  const regularPayload = quoteRecord({ family: "S-05:regular", revisionKey: "S-05:regular" })
    .payload as Extract<RecordedMarketRecordV1["payload"], { kind: "quote" }>;
  const overnightPayload = {
    ...regularPayload,
    bidPrice: decimal("20"),
    askPrice: decimal("20.02"),
  };
  const regular = {
    kind: "quote" as const,
    eventId: "S-05:regular",
    eventTimeNs: "100",
    trustedSequence: "1",
    sessionKind: "regular-continuous" as const,
    payload: regularPayload,
  };
  const overnight = {
    kind: "quote" as const,
    eventId: "S-05:overnight",
    eventTimeNs: "101",
    trustedSequence: "2",
    sessionKind: "overnight" as const,
    payload: overnightPayload,
  };
  const combined = selectQuoteTimelineReference([overnight, regular], "101");
  assert.equal(combined.selectedEventId, "S-05:regular");
  assert.deepEqual(combined.exactMidpoint, { numerator: "1001", denominator: "100" });
  assert.deepEqual(
    selectQuoteTimelineReference([overnight], "101").reason,
    marketReason("market.overnight-primary-forbidden"),
  );
});

test("PCL-01/PCL-03 execute corrected precedence and non-substituting sensitivities", () => {
  const correctedFirst = selectPriorCloseAndSensitivities(
    [
      {
        factId: "PCL-01:official",
        factKind: "official-close",
        eventTimeNs: "100",
        exactPrice: decimal("10"),
      },
      {
        factId: "PCL-01:corrected",
        factKind: "corrected-close",
        eventTimeNs: "99",
        exactPrice: decimal("10.01"),
      },
    ],
    "100",
  );
  assert.deepEqual(correctedFirst.primaryPriorClose, {
    status: "selected",
    factId: "PCL-01:corrected",
    factKind: "corrected-close",
    exactPrice: decimal("10.01"),
    reason: null,
  });

  const sensitivitiesOnly = selectPriorCloseAndSensitivities(
    [
      {
        factId: "PCL-03:final-trade",
        factKind: "final-trade",
        eventTimeNs: "100",
        exactPrice: decimal("10.02"),
      },
      {
        factId: "PCL-03:completed-bar",
        factKind: "completed-bar",
        eventTimeNs: "100",
        exactPrice: decimal("10.03"),
      },
    ],
    "100",
  );
  assert.deepEqual(
    sensitivitiesOnly.primaryPriorClose.reason,
    marketReason("market.prior-close-missing", { priorCloseFailureKind: "absent" }),
  );
  assert.deepEqual(sensitivitiesOnly.finalTradeSensitivity, {
    status: "selected",
    factId: "PCL-03:final-trade",
    exactPrice: decimal("10.02"),
  });
  assert.deepEqual(sensitivitiesOnly.completedBarSensitivity, {
    status: "selected",
    factId: "PCL-03:completed-bar",
    exactPrice: decimal("10.03"),
  });
});
