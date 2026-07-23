import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import * as operationalLoaderBounds from "../src/adapters/market-reference/recorded-loader-bounds.js";
import {
  evaluateRecordedLoaderCatalog,
  evaluateRecordedMarketFixtureSelections,
  loadRecordedMarketArtifacts,
  loadRecordedMarketFixture,
  MARKET_MAX_RAW_ARTIFACT_BYTES,
  normalizeVerifiedRecordedMarketFixture,
  RECORDED_LOADER_BOUND_IDS,
  type RecordedMarketArtifactManifestV1,
  type RecordedMarketFixtureManifestV1,
  recordedMarketArtifactProjection,
  recordedMarketCatalogEvidence,
  validateRecordedMarketFixtureManifest,
} from "../src/adapters/market-reference/recorded-market-loader.js";
import type { ArtifactObservation } from "../src/artifacts/artifact-store.js";
import { sanitizeRequestIdentity } from "../src/artifacts/identity.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import {
  BOUND_ENFORCEMENT_REGISTRY,
  MarketContractError,
} from "../src/providers/market-reference/contracts.js";
import {
  deriveAdmittedRevisionSetHash,
  deriveArtifactContentId,
  deriveDeliveryId,
  deriveDurableRevisionEvidenceHash,
  deriveEndpointChannelId,
  deriveEntitlementSnapshotId,
  deriveInstrumentId,
  deriveMarketAcquisitionId,
  deriveMarketDatasetId,
  deriveMarketFactId,
  deriveMarketFeedId,
  deriveMarketIntervalKey,
  deriveMarketProviderId,
  deriveNormalizedMarketFactId,
  deriveProviderObservationId,
  deriveRawArtifactId,
  deriveRecordedCorpusCutoffId,
  deriveRecordedCorpusSnapshotId,
  deriveRevisionFamilyId,
  deriveRevisionId,
  deriveSelectionPolicyId,
  deriveVenueTapeId,
} from "../src/providers/market-reference/identity.js";
import {
  deriveCanonicalProviderPayloadDigest,
  normalizeRecordedMarketRecord,
} from "../src/providers/market-reference/normalization.js";
import { selectMarketReference } from "../src/providers/market-reference/selection.js";
import {
  deriveAcquisitionObservationId,
  deriveIssuerMappingId,
  deriveMarketReferenceJoinKey,
} from "../src/providers/observation-ledger.js";
import {
  fixtureObservation,
  type RecordedFixtureSeedMember,
  recordedFixtureArtifactStore,
} from "./recorded-fixture-artifact-store.js";

const FIXTURE_ROOT = path.resolve("fixtures", "market-reference");
const SOURCE_PROFILE_ID = `mfp1_${"a".repeat(64)}`;
const CHECKED_SOURCE_PROFILE_ID =
  "mfp1_679c05231215eb312e4e2d50955cc0964f66da0aa0cfad16de91d635ee415d27";
const AS_OF_MS = 1_783_517_600_000;
const PROVENANCE = Object.freeze({
  classification: "synthetic",
  redistributionClass: "project-authored",
  authoringPolicyId: "peas-original-market-fixture-v1",
  containsProviderBytes: false,
  containsProviderExamples: false,
  containsActualMarketValues: false,
  containsCredentialsOrAccountFacts: false,
  networkRequired: false,
  approvalReference: null,
  note: "Original fictional PEAS market-reference fixture.",
} as const);
const REQUIRED_CATALOG_CASE_IDS = Object.freeze([
  ...Array.from({ length: 15 }, (_, index) => `Q-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `S-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 6 }, (_, index) => `T-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `B-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `PCL-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, index) => `R-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `O-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `I-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, index) => `C-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, index) => `M-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `D-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 2 }, (_, index) => `E-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `X-${String(index + 1).padStart(2, "0")}`),
]);

function literalExpectedOperationEvidence(caseId: string): Record<string, unknown> {
  const evidence: Readonly<Record<string, Record<string, unknown>>> = {
    "Q-01": { calculation: "exact-midpoint", numerator: "1001", denominator: "100" },
    "Q-02": { calculation: "exact-midpoint", numerator: "2000001", denominator: "2000000" },
    "Q-03": {
      selector: "as-of-target",
      atTarget: "base-selected",
      atTargetPlusOneNs: "later-selected",
      futureExcludedAtTarget: true,
    },
    "Q-04": {
      exactBoundaryAgeNs: "5000000000",
      exactStatus: "eligible",
      oneOverAgeNs: "5000000001",
      oneOverReason: "market.quote-stale",
    },
    "Q-05": { missingSides: ["ask"], reason: "market.quote-one-sided" },
    "Q-06": { strictStatus: "missing", excludedQualityKind: "locked" },
    "Q-07": { strictStatus: "missing", reason: "market.quote-crossed" },
    "Q-08": { strictStatus: "missing", excludedQualityKind: "slow" },
    "Q-09": { strictStatus: "missing", reason: "market.condition-unknown" },
    "Q-10": { strictStatus: "missing", excludedQualityKind: "luld-limit-state" },
    "Q-11": {
      duringHalt: "market.quote-halt",
      afterResume: "missing",
      firstPostResumeQuote: "selected",
      postResumeBackfill: "excluded",
    },
    "Q-12": {
      gap: "gap-opened",
      suppressed: "suppressed-through-gap",
      reset: "authoritative-reset",
      finalState: "healthy",
    },
    "Q-13": {
      result: "missing",
      reason: "market.sequence-insufficient",
      sequenceFailureKind: "equal-time-ambiguous",
    },
    "Q-14": { bolo: "improved", protectedNbbo: "unchanged" },
    "Q-15": { comparison: "agree", independentSourceCount: 2 },
    "S-01": { holiday: true, sessionKind: "calendar-closed" },
    "S-02": { beforeClose: "regular-continuous", atClose: "extended-post" },
    "S-03": { preDstUtcOffsetMinutes: -300, postDstUtcOffsetMinutes: -240 },
    "S-04": { transition: "missing", reason: "market.session-transition" },
    "S-05": { overnight: "missing", regular: "selected-complete" },
    "T-01": { updatesConsolidatedLast: true, reason: null },
    "T-02": {
      updatesConsolidatedLast: false,
      reason: "market.trade-condition-ineligible/does-not-update-last",
    },
    "T-03": {
      updatesConsolidatedLast: "state-insufficient",
      reason: "market.trade-condition-ineligible/state-insufficient",
    },
    "T-04": { updatesConsolidatedLast: false, reason: "market.trade-odd-lot" },
    "T-05": {
      updatesConsolidatedLast: false,
      reason: "market.trade-condition-ineligible/does-not-update-last",
    },
    "T-06": { codes: ["Q", "O", "5", "6", "M", "9"], distinctFactKinds: true },
    "B-01": { adjustmentMode: "raw", status: "point-eligible" },
    "B-02": { status: "missing", reason: "market.bar-interval-future" },
    "B-03": { raw: "point-eligible", split: "adjusted-sensitivity-only" },
    "PCL-01": { selected: "corrected-close", precedenceOver: "listing-official-close" },
    "PCL-02": { selected: "listing-official-close", correctedPresent: false },
    "PCL-03": {
      primary: "missing",
      finalTradeSensitivity: "selected",
      completedBarSensitivity: "selected",
    },
    "E-01": {
      variants: [
        "pending:market.entitlement-invalid/pending",
        "denied:market.entitlement-invalid/denied",
        "expired:market.entitlement-invalid/unfrozen",
        "wrong-entitlement:market.entitlement-invalid/scope-mismatch",
      ],
      providerAccessCalls: 0,
      artifactStoreAccessCalls: 0,
    },
    "E-02": {
      variants: [
        "unauthorized-fallback:market.silent-fallback-forbidden",
        "paid-cost:market.entitlement-invalid/zero-spend-violation",
      ],
      providerAccessCalls: 0,
      artifactStoreAccessCalls: 0,
    },
    "X-01": { trapField: "unknown", reason: "market.input-invalid" },
    "X-02": { malformed: "unterminated-records-array", reason: "market.input-invalid" },
    "X-03": {
      sensitiveField: "credential",
      reason: "market.input-invalid",
      echoed: false,
    },
    "X-04": {
      declaredOneOverReason: "market.bound-exceeded/rawArtifactBytes",
      siblingStreams: 3,
      allSiblingsSettled: true,
      partialMembersPublished: false,
    },
    "X-05": {
      operationalBounds: 33,
      acceptedVectors: 33,
      coverage: "complete",
    },
    "O-03": {
      pageChainGap: "market.page-chain-invalid",
      querySubstitution: "market.page-chain-invalid",
      artifactAccessCalls: 0,
    },
  };
  const row = evidence[caseId];
  assert.ok(row, caseId);
  return row;
}

function literalExpectedCatalogOutcomes(): readonly Record<string, unknown>[] {
  const missingReasons: Readonly<Record<string, Readonly<{ code: string; detail: unknown }>>> = {
    "Q-04": { code: "market.quote-stale", detail: null },
    "Q-05": { code: "market.quote-one-sided", detail: null },
    "Q-07": { code: "market.quote-crossed", detail: null },
    "Q-09": { code: "market.condition-unknown", detail: null },
    "Q-11": { code: "market.quote-halt", detail: null },
    "Q-13": {
      code: "market.sequence-insufficient",
      detail: { sequenceFailureKind: "equal-time-ambiguous" },
    },
    "S-01": { code: "market.session-closed", detail: null },
    "S-05": { code: "market.overnight-primary-forbidden", detail: null },
    "T-02": {
      code: "market.trade-condition-ineligible",
      detail: { tradeConditionFailureKind: "does-not-update-last" },
    },
    "T-03": {
      code: "market.trade-condition-ineligible",
      detail: { tradeConditionFailureKind: "state-insufficient" },
    },
    "T-04": { code: "market.trade-odd-lot", detail: null },
    "T-05": {
      code: "market.trade-condition-ineligible",
      detail: { tradeConditionFailureKind: "does-not-update-last" },
    },
    "B-02": { code: "market.bar-interval-future", detail: null },
    "PCL-03": {
      code: "market.prior-close-missing",
      detail: { priorCloseFailureKind: "absent" },
    },
    "E-01": { code: "market.entitlement-invalid", detail: { entitlementFailureKind: "pending" } },
    "E-02": { code: "market.silent-fallback-forbidden", detail: null },
    "X-01": { code: "market.input-invalid", detail: null },
    "X-02": { code: "market.input-invalid", detail: null },
    "X-03": { code: "market.input-invalid", detail: null },
    "X-04": { code: "market.bound-exceeded", detail: { limitKind: "rawArtifactBytes" } },
    "O-03": { code: "market.page-chain-invalid", detail: null },
  };
  const degradedDiagnostics: Readonly<Record<string, readonly Record<string, unknown>[]>> = {
    "Q-06": [{ code: "market.quote-quality-degraded", detail: { qualityKind: "locked" } }],
    "Q-08": [{ code: "market.quote-quality-degraded", detail: { qualityKind: "slow" } }],
    "Q-10": [
      {
        code: "market.quote-quality-degraded",
        detail: { qualityKind: "luld-limit-state" },
      },
    ],
  };
  const gateOperations: Readonly<Record<string, string>> = {
    "E-01": "evaluateE01EntitlementGateEvidence",
    "E-02": "evaluateE02AuthorizationCostGateEvidence",
    "X-01": "evaluateX01ClosedSchemaGateEvidence",
    "X-02": "evaluateX02MalformedParserGateEvidence",
    "X-03": "evaluateX03SensitiveNoEchoGateEvidence",
    "X-04": "evaluateX04StreamSiblingGateEvidence",
    "X-05": "evaluateX05OperationalCoverageEvidence",
    "O-03": "evaluateO03PageChainQueryGateEvidence",
  };
  const semanticOperations: Readonly<Record<string, string>> = {
    "Q-01": "evaluatePrimaryQuoteBoundary",
    "Q-02": "evaluatePrimaryQuoteBoundary",
    "Q-03": "selectQuoteTimelineReference",
    "Q-04": "evaluatePrimaryQuoteBoundary",
    "Q-05": "constructTwoSidedQuote",
    "Q-06": "evaluateStrictExecutableQuote",
    "Q-07": "evaluatePrimaryQuoteBoundary",
    "Q-08": "evaluateStrictExecutableQuote",
    "Q-09": "evaluatePrimaryQuoteBoundary",
    "Q-10": "evaluateStrictExecutableQuote",
    "Q-11": "selectQuoteTimelineReference",
    "Q-12": "replayNativeSequence",
    "Q-13": "selectQuoteTimelineReference",
    "Q-14": "selectIsolatedQuoteReference",
    "Q-15": "compareIndependentSourceReferences",
    "S-01": "classifyFrozenSession",
    "S-02": "classifyFrozenSession",
    "S-03": "classifyFrozenSession",
    "S-04": "evaluateSessionTransition",
    "S-05": "selectMarketReference.session-policy",
    "T-01": "replayConsolidatedLast",
    "T-02": "replayConsolidatedLast",
    "T-03": "replayConsolidatedLast",
    "T-04": "replayConsolidatedLast",
    "T-05": "replayConsolidatedLast",
    "T-06": "classifyTapeOfficialTradeCode",
    "B-01": "evaluateRecordedBarSensitivity",
    "B-02": "evaluateRecordedBarSensitivity",
    "B-03": "evaluateRecordedBarSensitivity",
    "PCL-01": "selectPriorCloseAndSensitivities",
    "PCL-02": "selectPriorCloseAndSensitivities",
    "PCL-03": "selectPriorCloseAndSensitivities",
  };
  const localCaseIds = REQUIRED_CATALOG_CASE_IDS.filter(
    (caseId) =>
      caseId.startsWith("Q-") ||
      caseId.startsWith("S-") ||
      caseId.startsWith("T-") ||
      caseId.startsWith("B-") ||
      caseId.startsWith("PCL-") ||
      caseId.startsWith("E-") ||
      caseId.startsWith("X-") ||
      caseId === "O-03",
  );
  return localCaseIds.map((caseId) => {
    const reason = missingReasons[caseId] ?? null;
    const diagnostics = degradedDiagnostics[caseId] ?? [];
    const isGate = caseId.startsWith("E-") || caseId.startsWith("X-") || caseId === "O-03";
    const status =
      caseId === "X-05"
        ? "verified"
        : isGate
          ? "rejected"
          : reason !== null
            ? "missing"
            : diagnostics.length > 0
              ? "selected-degraded"
              : "selected-complete";
    const value =
      status === "missing" || status === "rejected" || status === "verified"
        ? null
        : caseId === "Q-02"
          ? { numerator: "2000001", denominator: "2000000" }
          : caseId === "Q-14"
            ? { numerator: "2007", denominator: "200" }
            : caseId === "Q-06"
              ? { numerator: "10", denominator: "1" }
              : caseId.startsWith("Q-") || caseId.startsWith("S-")
                ? { numerator: "1001", denominator: "100" }
                : caseId.startsWith("PCL-")
                  ? { coefficient: "995", scale: 2, negative: false }
                  : { coefficient: "1001", scale: 2, negative: false };
    return {
      caseId,
      status,
      reason,
      diagnostics,
      value,
      operationEvidence: literalExpectedOperationEvidence(caseId),
      operation: isGate
        ? (gateOperations[caseId] as string)
        : (semanticOperations[caseId] ?? "normalizeRecordedMarketRecords+selectMarketReference"),
    };
  });
}

type FixtureAuthority = Readonly<{
  manifest: RecordedMarketArtifactManifestV1;
  seeds: readonly RecordedFixtureSeedMember[];
}>;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function observationHash(observation: Omit<ArtifactObservation, "observationHash">): string {
  return canonicalHash("peas/artifact-observation/v1", observation);
}

function makeAuthority(options: {
  body: Uint8Array;
  bodyPath?: string;
  providerCode?: string;
  sourceProfileId?: string;
  memberCount?: number;
  declaredSizeBytes?: number;
  digests?: readonly string[];
}): FixtureAuthority {
  const providerCode = options.providerCode ?? "peas-synthetic-a";
  const memberCount = options.memberCount ?? 1;
  const declaredSizeBytes = options.declaredSizeBytes ?? options.body.byteLength;
  const request = sanitizeRequestIdentity({
    method: "GET",
    origin: "https://synthetic.invalid",
    path: "/offline/market-reference",
    routeLabel: "market-reference.synthetic-recorded",
  });
  const seeds = Array.from({ length: memberCount }, (_, index): RecordedFixtureSeedMember => {
    const digest = options.digests?.[index] ?? sha256(options.body);
    return {
      role: `market-page-${index}`,
      path: options.bodyPath ?? "synthetic-market-corpus.json",
      artifactHash: digest,
      sizeBytes: declaredSizeBytes,
      attempt: {
        attemptId: `${providerCode}-acquisition`,
        provider: providerCode,
        recordId: `market-page-${index}`,
        revisionId: "fixture-v1",
        startedAtMs: 99_000,
        request,
      },
      response: {
        statusCode: 200,
        etag: `fixture-${index}`,
        lastModified: null,
        mediaType: "application/json",
        contentEncoding: "identity",
        declaredContentLength: declaredSizeBytes,
        transportDecoded: true,
      },
      retrievedAtMs: 100_001,
    };
  });
  const firstObservation = fixtureObservation(seeds[0] as RecordedFixtureSeedMember);
  const acquisitionObservationId = deriveAcquisitionObservationId({
    provider: providerCode,
    retrievalAttemptId: firstObservation.attemptId,
    sanitizedRequestIdentityHash: firstObservation.request.identityHash,
    routeLabel: firstObservation.request.routeLabel,
  });
  let priorPageChainHash: string | null = null;
  const retrievedMembers = seeds.map((seed, index) => {
    const observation = fixtureObservation(seed);
    const artifactContentPreimage = {
      sha256: seed.artifactHash,
      sizeBytes: declaredSizeBytes,
      mediaType: "application/json" as const,
      contentEncoding: "identity" as const,
    };
    const artifactContentId = deriveArtifactContentId(artifactContentPreimage);
    const rawArtifactPreimage = {
      artifactContentId,
      vaultObservationId: observation.observationId,
      vaultObservationHash: observation.observationHash,
      acquisitionObservationId,
      role: seed.role,
    };
    const member = {
      kind: "retrieved-synthetic" as const,
      role: seed.role,
      sourceProfileId: options.sourceProfileId ?? SOURCE_PROFILE_ID,
      pageOrdinal: index,
      priorPageChainHash,
      terminalPage: index === seeds.length - 1,
      bodyFormat: "application/json" as const,
      artifactContentId,
      artifactContentPreimage,
      rawArtifactId: deriveRawArtifactId(rawArtifactPreimage),
      rawArtifactPreimage,
      artifactDigest: seed.artifactHash,
      sizeBytes: declaredSizeBytes,
      selectedObservationId: observation.observationId,
      selectedObservationHash: observation.observationHash,
    };
    priorPageChainHash = canonicalHash("peas/market-page-chain/v1", {
      sourceProfileId: member.sourceProfileId,
      pageOrdinal: member.pageOrdinal,
      priorPageChainHash: member.priorPageChainHash,
      artifactContentId: member.artifactContentId,
      terminalPage: member.terminalPage,
    });
    return member;
  });
  return {
    manifest: {
      schemaVersion: 1,
      caseId: "recorded-market-synthetic",
      sourceProfileId: options.sourceProfileId ?? SOURCE_PROFILE_ID,
      providerCode,
      acquisitionObservationId,
      asOfMs: AS_OF_MS,
      expectedPageCount: memberCount,
      retrievedMembers,
      provenance: PROVENANCE,
    },
    seeds,
  };
}

async function catalogBytes(): Promise<Uint8Array> {
  return readFile(path.join(FIXTURE_ROOT, "synthetic-market-corpus.json"));
}

function fixtureBoundReason(violation: string, boundId: string) {
  const reasons: Readonly<Record<string, Readonly<{ code: string; detail: object | null }>>> = {
    "market-bound": { code: "market.bound-exceeded", detail: { limitKind: boundId } },
    "market-input": { code: "market.input-invalid", detail: null },
    "market-decimal": { code: "market.decimal-invalid", detail: null },
    "market-quote-stale": { code: "market.quote-stale", detail: null },
    "market-timestamp-insufficient": {
      code: "market.timestamp-insufficient",
      detail: { timestampFailureKind: "capture-retrieval-lag-exceeded" },
    },
    "study-bound": { code: "study.bound-exceeded", detail: { limitKind: boundId } },
    "study-input": { code: "study.input-invalid", detail: null },
    "study-liquidity-unknown": { code: "study.liquidity-unknown", detail: null },
    "study-timeliness-not-met": {
      code: "study.timeliness-threshold-not-met",
      detail: null,
    },
    "study-correction-after-cutoff": {
      code: "study.correction-after-cutoff",
      detail: null,
    },
  };
  const reason = reasons[violation];
  assert.ok(reason);
  return reason;
}

function fixtureUpperValue(boundId: string, exactValue: string, schemaUpper = false): string {
  if (schemaUpper) return "201";
  const special: Readonly<Record<string, string>> = {
    recordedReplayPageSize: "10001",
    historicalQueryWindow: "9",
    selectionSearchWindowMs: "86400001",
    primaryResidualTargets: "T0,T1,T5,T30,T60",
    targetClusters: "181",
    laneTargets: "121/40/20",
    controlTargets: "6/5/5/5",
    reasonDefinitions: "65-per-namespace",
    collectionSessions: "66",
    liquidityHistorySessions: "21",
    bootstrapReplicates: "10001",
    holmSlots: "25",
  };
  return special[boundId] ?? (BigInt(exactValue) + 1n).toString();
}

function fixtureLowerValue(boundId: string): string {
  const values: Readonly<Record<string, string>> = {
    recordedReplayPageSize: "0",
    historicalQueryWindow: "0",
    selectionSearchWindowMs: "-1",
    targetClusters: "179",
    laneTargets: "119/40/20",
    controlTargets: "4/5/5/5",
    collectionSessions: "64",
    liquidityHistorySessions: "19",
    minimumValidLiquiditySessions: "14",
    bootstrapReplicates: "9999",
    holmSlots: "23",
  };
  const value = values[boundId];
  assert.ok(value);
  return value;
}

function fixtureExercisedBounds(candidateIdentity: string, metricId: string) {
  const rows: Record<string, unknown>[] = [];
  for (const rule of BOUND_ENFORCEMENT_REGISTRY) {
    const localIds = {
      candidateIdentity: rule.atomicity === "candidate" ? candidateIdentity : null,
      metricId: rule.atomicity === "metric" ? metricId : null,
      studyCaseId: rule.atomicity === "study-run" ? "study-case:precommitted-180-cluster-v1" : null,
    };
    const disposition = (vectorKind: string, accepted: boolean, violation: string | null) => ({
      boundId: rule.boundId,
      stage: rule.stage,
      vectorKind,
      accepted,
      reason: violation === null ? null : fixtureBoundReason(violation, rule.boundId),
      atomicity: rule.atomicity,
    });
    rows.push({
      boundId: rule.boundId,
      observedValue: rule.exactValue,
      expectedDisposition: disposition("exact", true, null),
      ...localIds,
    });
    if (rule.upperViolation !== null) {
      rows.push({
        boundId: rule.boundId,
        observedValue: fixtureUpperValue(rule.boundId, rule.exactValue),
        expectedDisposition: disposition("upper-one-over", false, rule.upperViolation),
        ...localIds,
      });
    }
    if (rule.schemaUpperViolation !== null) {
      rows.push({
        boundId: rule.boundId,
        observedValue: fixtureUpperValue(rule.boundId, rule.exactValue, true),
        expectedDisposition: disposition("upper-one-over", false, rule.schemaUpperViolation),
        ...localIds,
      });
    }
    if (rule.lowerViolation !== null) {
      rows.push({
        boundId: rule.boundId,
        observedValue: fixtureLowerValue(rule.boundId),
        expectedDisposition: disposition("lower-one-below", false, rule.lowerViolation),
        ...localIds,
      });
    }
    if (rule.countMinusOneViolation !== null) {
      rows.push({
        boundId: rule.boundId,
        observedValue:
          rule.boundId === "primaryResidualTargets" ? "T0,T1,T5" : fixtureLowerValue(rule.boundId),
        expectedDisposition: disposition(
          "exact-count-minus-one",
          false,
          rule.countMinusOneViolation,
        ),
        ...localIds,
      });
    }
  }
  return rows;
}

export async function fullSemanticFixture(): Promise<
  Readonly<{
    manifest: RecordedMarketFixtureManifestV1;
    seeds: readonly RecordedFixtureSeedMember[];
    bytes: Uint8Array;
  }>
> {
  const registry = JSON.parse(
    await readFile(path.resolve("docs", "audit", "pr-2d-contract-authority.json"), "utf8"),
  ) as RecordedMarketFixtureManifestV1["contractAuthorityRegistry"];
  const providerPreimage = {
    providerCode: "peas-synthetic-a",
    serviceOperatorCode: "peas-project",
  };
  const providerId = deriveMarketProviderId(providerPreimage);
  const datasetPreimage = {
    providerId,
    assetClass: "us-equity" as const,
    coverageRegion: "fictional-us",
    productFamily: "project-authored-synthetic",
    apiGeneration: "recorded-v1",
    recordFamily: "quotes",
    datasetDocumentationVersion: "fixture-v1",
  };
  const datasetId = deriveMarketDatasetId(datasetPreimage);
  const feedPreimage = {
    datasetId,
    providerFeedCode: "synthetic-sip",
    consolidationKind: "sip-consolidated" as const,
    delayClass: "historical" as const,
    adjustmentMode: "raw" as const,
    correctionRepresentation: "revision-stream" as const,
  };
  const feedId = deriveMarketFeedId(feedPreimage);
  const endpointPreimage = {
    feedId,
    channelKind: "recorded-synthetic" as const,
    methodKind: "recorded" as const,
    safeRouteLabel: "synthetic-recorded",
    endpointDocumentationVersion: "fixture-v1",
    paginationKind: "recorded-manifest" as const,
    factKinds: ["quote"],
  };
  const endpointChannelId = deriveEndpointChannelId(endpointPreimage);
  const entitlementPreimage = {
    providerId,
    productCode: "synthetic-offline",
    accountClass: "project-owned-synthetic" as const,
    professionalStatus: "not-applicable" as const,
    effectiveFromMs: 0,
    effectiveToMs: null,
    capabilities: [
      {
        datasetId,
        feedId,
        endpointChannelId,
        use: "offline-replay" as const,
        status: "granted" as const,
        maximumRawRetentionDays: null,
        survivesTermination: true,
      },
    ],
    permissionEvidenceHash: sha256("project-authored-synthetic"),
    humanApprovalId: null,
    zeroIncrementalSpend: true as const,
  };
  const entitlementSnapshotId = deriveEntitlementSnapshotId(entitlementPreimage);
  const venuePreimage = {
    planCode: "utp" as const,
    networkCode: "C" as const,
    participantCode: "Q",
    venueCode: "XNAS",
    protocolName: "PEAS synthetic UTP subset",
    protocolVersion: "fixture-v1",
  };
  const venueTapeId = deriveVenueTapeId(venuePreimage);
  const sourceProfileWithoutId = {
    provider: { providerId, preimage: providerPreimage },
    dataset: { datasetId, preimage: datasetPreimage },
    feed: { feedId, preimage: feedPreimage },
    endpoint: { endpointChannelId, preimage: endpointPreimage },
    entitlement: { entitlementSnapshotId, preimage: entitlementPreimage },
    venueTapes: [{ venueTapeId, preimage: venuePreimage }],
    protocolVersion: "fixture-v1",
    parserContractVersion: "synthetic-parser-v1",
    fixtureAuthorizationClass: "synthetic-offline-v1",
    marketDataClass: "consolidated-quote",
    consolidationKind: "sip-emulated",
    correctionRepresentation: "revision-stream",
    conditionMap: null,
    emulationReference: (() => {
      const preimage = {
        contractAuthorityRegistryId: registry.contractAuthorityRegistryId,
        logicalContractId: "peas/market-eligibility/v1",
        sectionLabel: "quote eligibility",
        semanticSubset: "fictional consolidated quote",
      };
      return {
        emulationReferenceId: `mer1_${canonicalHash(
          "peas/market-emulation-reference/v1",
          preimage,
        )}`,
        preimage,
      };
    })(),
  };
  const sourceProfileId = `mfp1_${canonicalHash(
    "peas/market-fixture-source-profile/v1",
    sourceProfileWithoutId,
  )}`;
  const sourceProfile = { profileId: sourceProfileId, ...sourceProfileWithoutId };
  const comparisonProviderPreimage = {
    providerCode: "peas-synthetic-b",
    serviceOperatorCode: "peas-project",
  };
  const comparisonProviderId = deriveMarketProviderId(comparisonProviderPreimage);
  const comparisonDatasetPreimage = {
    ...datasetPreimage,
    providerId: comparisonProviderId,
    productFamily: "project-authored-synthetic-comparison",
  };
  const comparisonDatasetId = deriveMarketDatasetId(comparisonDatasetPreimage);
  const comparisonFeedPreimage = {
    ...feedPreimage,
    datasetId: comparisonDatasetId,
    providerFeedCode: "synthetic-comparison",
  };
  const comparisonFeedId = deriveMarketFeedId(comparisonFeedPreimage);
  const comparisonEndpointPreimage = {
    ...endpointPreimage,
    feedId: comparisonFeedId,
    safeRouteLabel: "synthetic-recorded-comparison",
  };
  const comparisonEndpointChannelId = deriveEndpointChannelId(comparisonEndpointPreimage);
  const comparisonEntitlementPreimage = {
    ...entitlementPreimage,
    providerId: comparisonProviderId,
    productCode: "synthetic-offline-comparison",
    capabilities: [
      {
        datasetId: comparisonDatasetId,
        feedId: comparisonFeedId,
        endpointChannelId: comparisonEndpointChannelId,
        use: "offline-replay" as const,
        status: "granted" as const,
        maximumRawRetentionDays: null,
        survivesTermination: true,
      },
    ],
    permissionEvidenceHash: sha256("project-authored-synthetic-comparison"),
  };
  const comparisonEntitlementSnapshotId = deriveEntitlementSnapshotId(
    comparisonEntitlementPreimage,
  );
  const comparisonSourceProfileWithoutId = {
    ...sourceProfileWithoutId,
    provider: {
      providerId: comparisonProviderId,
      preimage: comparisonProviderPreimage,
    },
    dataset: {
      datasetId: comparisonDatasetId,
      preimage: comparisonDatasetPreimage,
    },
    feed: { feedId: comparisonFeedId, preimage: comparisonFeedPreimage },
    endpoint: {
      endpointChannelId: comparisonEndpointChannelId,
      preimage: comparisonEndpointPreimage,
    },
    entitlement: {
      entitlementSnapshotId: comparisonEntitlementSnapshotId,
      preimage: comparisonEntitlementPreimage,
    },
  };
  const comparisonSourceProfile = {
    profileId: `mfp1_${canonicalHash(
      "peas/market-fixture-source-profile/v1",
      comparisonSourceProfileWithoutId,
    )}`,
    ...comparisonSourceProfileWithoutId,
  };
  const issuerMappingPreimage = {
    issuerCik: "0000000001",
    symbols: ["PEAS"],
    selectedSymbol: "PEAS",
    mappingAuthority: "peas-synthetic-fixture",
    mappingVersion: "v1",
    effectiveFromMs: 0,
    effectiveToMs: null,
  };
  const issuerMappingId = deriveIssuerMappingId(issuerMappingPreimage);
  const instrumentPreimage = {
    issuerMappingId,
    securityAuthority: "peas-synthetic" as const,
    securityKey: "fictional-common-1",
    issueType: "common-share" as const,
    shareClass: "A",
    primaryListingVenueCode: "XNAS",
    currency: "USD" as const,
    roundLotSize: 100,
    effectiveFromNs: "0",
    effectiveToNs: null,
    predecessorInstrumentId: null,
    transitionReason: null,
  };
  const instrumentId = deriveInstrumentId(instrumentPreimage);
  const aliasPreimage = {
    instrumentId,
    symbol: "PEAS",
    mappingAuthority: "peas-synthetic-fixture",
    mappingVersion: "v1",
    mappingArtifactDigest: sha256("fictional-symbol-map"),
    effectiveFromNs: "0",
    effectiveToNs: null,
  };
  const instrument = {
    issuerMappingId,
    issuerMappingPreimage,
    instrumentId,
    instrumentPreimage,
    symbolAliases: [
      {
        symbolAliasId: `msa1_${canonicalHash("peas/market-symbol-alias/v1", aliasPreimage)}`,
        preimage: aliasPreimage,
      },
    ],
  };
  const quotePayload = (caseId: string) => {
    const bidPrice =
      caseId === "Q-02"
        ? { coefficient: "1", scale: 0, negative: false }
        : caseId === "Q-14"
          ? { coefficient: "1003", scale: 2, negative: false }
          : caseId === "Q-07"
            ? { coefficient: "1003", scale: 2, negative: false }
            : { coefficient: "10", scale: 0, negative: false };
    const askPrice =
      caseId === "Q-02"
        ? { coefficient: "1000001", scale: 6, negative: false }
        : caseId === "Q-06"
          ? { coefficient: "10", scale: 0, negative: false }
          : caseId === "Q-14"
            ? { coefficient: "1004", scale: 2, negative: false }
            : { coefficient: "1002", scale: 2, negative: false };
    return {
      kind: "quote" as const,
      quoteKind: caseId === "Q-14" ? ("bolo" as const) : ("nbbo" as const),
      bidPrice,
      askPrice,
      bidSize: { coefficient: "100", scale: 0, negative: false },
      askSize: {
        coefficient: caseId === "Q-05" ? "0" : "200",
        scale: 0,
        negative: false,
      },
      explicitConsolidatedNbbo: caseId !== "Q-14",
      condition: caseId === "Q-09" ? ("unknown" as const) : ("eligible" as const),
      slow: caseId === "Q-08",
      luldState: caseId === "Q-10" ? ("limit" as const) : ("executable" as const),
      halted: caseId === "Q-11",
    };
  };
  const rawRecords = REQUIRED_CATALOG_CASE_IDS.map((caseId, occurrenceOrdinal) => {
    const eventNs = 100_000_000_000n + BigInt(occurrenceOrdinal) * 1_000_000n;
    const catalogValue = (() => {
      if (caseId.startsWith("T-") || caseId === "PCL-03") {
        return {
          eventKind: "trade" as const,
          payload: {
            kind: "trade" as const,
            tradeKind:
              caseId === "T-06"
                ? ("closing" as const)
                : caseId === "PCL-03"
                  ? ("final-close" as const)
                  : ("last-eligible" as const),
            price: { coefficient: "1001", scale: 2, negative: false },
            size: { coefficient: caseId === "T-04" ? "1" : "100", scale: 0, negative: false },
            updatesConsolidatedLast:
              caseId === "T-03"
                ? ("state-insufficient" as const)
                : !(caseId === "T-02" || caseId === "T-05"),
            oddLot: caseId === "T-04",
          },
        };
      }
      if (caseId.startsWith("B-")) {
        const barEndNs = caseId === "B-02" ? eventNs + 1n : eventNs;
        return {
          eventKind: "bar" as const,
          payload: {
            kind: "bar" as const,
            barKind: "one-minute" as const,
            close: { coefficient: "1001", scale: 2, negative: false },
            barStartNs: (barEndNs - 60_000_000_000n).toString(),
            barEndNs: barEndNs.toString(),
            adjustmentMode: "raw" as const,
          },
        };
      }
      if (caseId === "PCL-01" || caseId === "PCL-02") {
        return {
          eventKind:
            caseId === "PCL-01" ? ("corrected-close" as const) : ("official-close" as const),
          payload: {
            kind: "prior-close" as const,
            price: { coefficient: "995", scale: 2, negative: false },
            closeKind:
              caseId === "PCL-01"
                ? ("corrected-consolidated-close" as const)
                : ("listing-official-close" as const),
            sessionDate: "2037-06-16",
          },
        };
      }
      if (caseId.startsWith("S-")) {
        return {
          eventKind: "quote" as const,
          payload: quotePayload(caseId),
        };
      }
      if (caseId.startsWith("C-")) {
        const actions = ["split", "dividend", "spin-off", "symbol-change"] as const;
        return {
          eventKind: "corporate-action" as const,
          payload: {
            kind: "corporate-action" as const,
            actionKind: actions[occurrenceOrdinal - 46] ?? "split",
            effectiveNs: eventNs.toString(),
            successorInstrumentId: caseId === "C-04" ? instrumentId : null,
          },
        };
      }
      return { eventKind: "quote" as const, payload: quotePayload(caseId) };
    })();
    const payload = catalogValue.payload;
    return {
      sourceProfileId,
      memberRole: "market-page-0",
      instrumentId,
      venueTapeId,
      providerRecordKey: `synthetic-catalog:${caseId}`,
      providerRevisionKey: `original:${caseId}`,
      providerStableRecordFamily: `synthetic-catalog-family:${caseId}`,
      eventKind: catalogValue.eventKind,
      eventTime: {
        epochNs: eventNs.toString(),
        semantic: "participant-publication",
        precisionNs: "1000000",
      },
      providerSequence: {
        value: String(occurrenceOrdinal + 1),
        scope: "synthetic-catalog",
        trustClass: "provider-stable-sequence" as const,
      },
      sequenceSessionDate: "2037-06-17",
      canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(payload),
      memberKey: `synthetic-catalog:${caseId}:original`,
      occurrenceOrdinal,
      revisionKind: "original" as const,
      supersedesRevisionId: null,
      effectiveEventTime: null,
      sessionKind:
        caseId === "S-01"
          ? "calendar-closed"
          : caseId === "S-04"
            ? "extended-pre"
            : caseId === "S-05"
              ? "overnight"
              : "regular-continuous",
      currency: "USD",
      payload,
      normalizerVersion: "market-normalizer-v1",
      conditionPolicyVersion: "synthetic-utp-v1",
      calendarVersion: "synthetic-calendar-v1",
      parserContractVersion: "synthetic-parser-v1",
      durablyRecordedAtMs: 105000,
      durableLogicalAtMs: 105000,
      durableClockBasisId: `clk1_${sha256("fictional-clock")}`,
      primaryCorpusMember: true,
    };
  });
  const rawRecord = rawRecords.at(-1);
  assert.ok(rawRecord);
  const bytes = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, sourceProfileId, records: rawRecords }, null, 2)}\n`,
  );
  const authority = makeAuthority({ body: bytes, sourceProfileId });
  const acquisitionObservationId = authority.manifest.acquisitionObservationId;
  const acquisitionPreimage = {
    acquisitionObservationId,
    providerId,
    datasetId,
    feedId,
    endpointChannelId,
    entitlementSnapshotId,
    instrumentIds: [instrumentId],
    requestedFactKinds: [
      "bar",
      "corporate-action",
      "corrected-close",
      "official-close",
      "quote",
      "trade",
      "trading-action",
    ],
    queryStartNs: "0",
    queryEndNs: "200000000000",
    sortOrder: "event-time-ascending",
    routePolicyVersion: "synthetic-v1",
  };
  const marketAcquisitionId = deriveMarketAcquisitionId(acquisitionPreimage);
  const typedRecords = rawRecords.map((record) => {
    const { sourceProfileId: _sourceProfileId, memberRole: _memberRole, ...rawCoreRecord } = record;
    return {
      ...rawCoreRecord,
      source: { providerId, datasetId, feedId, endpointChannelId, entitlementSnapshotId },
      marketAcquisitionId,
      rawArtifactId: authority.manifest.retrievedMembers[0]?.rawArtifactId as string,
    };
  });
  const normalizedFacts = typedRecords.map((record) =>
    normalizeRecordedMarketRecord(record as Parameters<typeof normalizeRecordedMarketRecord>[0]),
  );
  const typedRecord = typedRecords.at(-1);
  const normalized = normalizedFacts.at(-1);
  assert.ok(typedRecord);
  assert.ok(normalized);
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
    deriveMarketIntervalKey(left).localeCompare(deriveMarketIntervalKey(right)),
  );
  const intervalDefinition = intervalDefinitions.find((row) => row.intervalKind === "t0");
  assert.ok(intervalDefinition);
  const intervalKey = deriveMarketIntervalKey(intervalDefinition);
  const joinTrustedObservationBasis = {
    basisKind: "capture" as const,
    eventId: sha256("fictional-capture-event"),
    receivedAtMs: 105000,
    logicalAtMs: 105000,
    clockBasisId: `clk1_${sha256("fictional-clock")}`,
  };
  const marketReferenceJoinKey = deriveMarketReferenceJoinKey({
    subject: "earnings:0000000001:2027-Q1",
    issuerMappingId,
    selectedSourceObservationId: `sob1_${sha256("fictional-source-observation")}`,
    selectedSourceVersionIdentity: `svr1_${sha256("fictional-source-version")}`,
    trustedObservationBasis: joinTrustedObservationBasis,
  });
  const source = { providerId, datasetId, feedId, endpointChannelId, entitlementSnapshotId };
  const comparisonSource = {
    providerId: comparisonProviderId,
    datasetId: comparisonDatasetId,
    feedId: comparisonFeedId,
    endpointChannelId: comparisonEndpointChannelId,
    entitlementSnapshotId: comparisonEntitlementSnapshotId,
  };
  const sourcePolicy = {
    policyVersion: "market-source-policy-v1" as const,
    authorizationMode: "synthetic-offline-only" as const,
    primarySource: source,
    comparisonSources: [comparisonSource],
    fallbackKind: "none" as const,
    selectionIsolation: "per-source" as const,
  };
  const admittedRevisionSetHash = deriveAdmittedRevisionSetHash(
    normalizedFacts.map((fact) => fact.revisionId).sort(),
  );
  const revisionEvidence = normalizedFacts.map((fact) => {
    const preimage = {
      revisionId: fact.revisionId,
      deliveryId: fact.deliveryId,
      rawArtifactId: fact.rawArtifactId,
      durablyRecordedAtMs: fact.durablyRecordedAtMs,
      logicalAtMs: fact.durableLogicalAtMs,
      clockBasisId: fact.durableClockBasisId,
    };
    assert.equal(fact.durableEvidenceHash, deriveDurableRevisionEvidenceHash(preimage));
    return {
      ...preimage,
      durableEvidenceHash: fact.durableEvidenceHash,
    };
  });
  const snapshot = {
    schemaVersion: 1 as const,
    marketReferenceJoinKey,
    sourcePolicy,
    marketAcquisitionIds: [marketAcquisitionId],
    rawArtifactIds: [typedRecord.rawArtifactId],
    providerObservationIds: normalizedFacts.map((fact) => fact.providerObservationId).sort(),
    revisionEvidence: revisionEvidence.sort((left, right) =>
      left.revisionId.localeCompare(right.revisionId),
    ),
    corpusClosedAtMs: AS_OF_MS,
    corpusClosedLogicalAtMs: AS_OF_MS,
    corpusClockBasisId: `clk1_${sha256("fictional-clock")}`,
    corpusClosureEvidenceHash: sha256("fictional-corpus-closure"),
  };
  const recordedCorpusSnapshotId = deriveRecordedCorpusSnapshotId(snapshot);
  const cutoff = {
    corpusSnapshotId: recordedCorpusSnapshotId,
    viewKind: "recorded-primary" as const,
    cutoffKind: "primary-corpus-closure" as const,
    cutoffTargetNs: null,
    cutoffObservationEvidenceHash: sha256("fictional-cutoff-observation"),
    admittedRevisionSetHash,
  };
  const corpusCutoffId = deriveRecordedCorpusCutoffId(cutoff);
  const selectionPolicyPreimage = {
    contractAuthorityRegistryId: registry.contractAuthorityRegistryId,
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
        { source: comparisonSource, role: "discrepancy-only" as const, rank: 1 },
      ],
      missingPrimaryBehavior: "typed-missing-no-fallback" as const,
    },
    eligibilityPolicy: {
      policyVersion: "market-eligibility-v1" as const,
      referenceKinds: [
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
      ] as const,
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
      viewKind: "recorded-primary" as const,
      admissionKind: "member-of-primary-recorded-corpus" as const,
      correctedOffsetNs: null,
      finalCorrectedOnlyBehavior: "recorded-primary-unavailable" as const,
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
  const selectionPolicyId = deriveSelectionPolicyId(selectionPolicyPreimage);
  const asOfBasis = {
    anchorRole: "h001-primary-durable-capture" as const,
    trustedObservationBasis: joinTrustedObservationBasis,
    targetTimeNs: "105000000000",
    comparator: "at-or-before" as const,
    viewKind: "recorded-primary" as const,
    recordedCorpusSnapshotId,
    corpusCutoffId,
    admittedRevisionSetHash,
  };
  const requestPreimage = {
    marketReferenceJoinKey,
    instrumentId,
    selectionPolicyId,
    intervalKey,
    referenceKind: "quote-nbbo-midpoint",
    asOfBasis,
  };
  const requestId = `msq1_${canonicalHash("peas/market-selection-request/v1", requestPreimage)}`;
  const selectionRequest = {
    requestId,
    ...requestPreimage,
    selectionPolicyPreimage,
    intervalDefinition,
    selectionSearchWindowMs: 86_400_000,
  };
  const calendarDates = [
    {
      localDate: "2037-06-17",
      sessionStatus: "open",
      regularOpenNs: "100000000000",
      regularCloseNs: "200000000000",
      extendedPreStartNs: "90000000000",
      extendedPostEndNs: "210000000000",
      earlyClose: false,
    },
  ];
  const calendarWithoutId = {
    calendarVersion: "synthetic-calendar-v1",
    calendarDigest: sha256("fictional-calendar"),
    timezone: "America/New_York",
    tzdbVersion: "synthetic-tzdb-v1",
    tzdbDigest: sha256("fictional-tzdb"),
    dates: calendarDates,
  };
  const calendarSnapshotId = `mcal1_${canonicalHash(
    "peas/market-calendar-snapshot/v1",
    calendarWithoutId,
  )}`;
  const evaluation = selectMarketReference(
    {
      marketReferenceJoinKey: requestPreimage.marketReferenceJoinKey,
      intervalKey,
      referenceKind: "quote-nbbo-midpoint",
      selectionPolicyId,
      selectionPolicy: selectionPolicyPreimage,
      recordedCorpusSnapshotId,
      recordedCorpus: snapshot,
      corpusCutoffId,
      corpusCutoff: cutoff,
      context: {
        instrumentId,
        calendarSnapshotId,
        targetSessionKind: "regular-continuous",
        targetWithinSession: true,
        symbolContinuity: "proved",
        corporateActionState: "none",
      },
      asOfBasis,
      correctedCutoffNs: null,
    },
    normalizedFacts,
  );
  const missingIntervalDefinition = intervalDefinitions.find(
    (row) => row.intervalKind === "publication-pre",
  );
  assert.ok(missingIntervalDefinition);
  const missingIntervalKey = deriveMarketIntervalKey(missingIntervalDefinition);
  const missingAsOfBasis = {
    ...asOfBasis,
    targetTimeNs: "100000000000",
    comparator: "strictly-before" as const,
  };
  const missingRequestPreimage = {
    ...requestPreimage,
    intervalKey: missingIntervalKey,
    asOfBasis: missingAsOfBasis,
  };
  const missingSelectionRequest = {
    requestId: `msq1_${canonicalHash("peas/market-selection-request/v1", missingRequestPreimage)}`,
    ...missingRequestPreimage,
    selectionPolicyPreimage,
    intervalDefinition: missingIntervalDefinition,
    selectionSearchWindowMs: 86_400_000,
  };
  const missingEvaluation = selectMarketReference(
    {
      marketReferenceJoinKey: missingRequestPreimage.marketReferenceJoinKey,
      intervalKey: missingIntervalKey,
      referenceKind: "quote-nbbo-midpoint",
      selectionPolicyId,
      selectionPolicy: selectionPolicyPreimage,
      recordedCorpusSnapshotId,
      recordedCorpus: snapshot,
      corpusCutoffId,
      corpusCutoff: cutoff,
      context: {
        instrumentId,
        calendarSnapshotId,
        targetSessionKind: "regular-continuous",
        targetWithinSession: true,
        symbolContinuity: "proved",
        corporateActionState: "none",
      },
      asOfBasis: missingAsOfBasis,
      correctedCutoffNs: null,
    },
    normalizedFacts,
  );
  const retrievalObservation = fixtureObservation(authority.seeds[0] as RecordedFixtureSeedMember);
  const retrievalAsOfBasis = {
    ...asOfBasis,
    anchorRole: "h001-mandatory-retrieval-sensitivity" as const,
    trustedObservationBasis: {
      basisKind: "retrieval" as const,
      role: "market-page-0",
      acquisitionObservationId,
      vaultObservationId: retrievalObservation.observationId,
      retrievedAtMs: retrievalObservation.retrievedAtMs,
      clockBasisId: `clk1_${sha256("fictional-retrieval-clock")}`,
    },
    targetTimeNs: (BigInt(retrievalObservation.retrievedAtMs) * 1_000_000n).toString(),
  };
  const retrievalRequestPreimage = {
    ...requestPreimage,
    asOfBasis: retrievalAsOfBasis,
  };
  const retrievalSelectionRequest = {
    requestId: `msq1_${canonicalHash(
      "peas/market-selection-request/v1",
      retrievalRequestPreimage,
    )}`,
    ...retrievalRequestPreimage,
    selectionPolicyPreimage,
    intervalDefinition,
    selectionSearchWindowMs: 86_400_000,
  };
  const retrievalEvaluation = selectMarketReference(
    {
      marketReferenceJoinKey: retrievalRequestPreimage.marketReferenceJoinKey,
      intervalKey,
      referenceKind: "quote-nbbo-midpoint",
      selectionPolicyId,
      selectionPolicy: selectionPolicyPreimage,
      recordedCorpusSnapshotId,
      recordedCorpus: snapshot,
      corpusCutoffId,
      corpusCutoff: cutoff,
      context: {
        instrumentId,
        calendarSnapshotId,
        targetSessionKind: "regular-continuous",
        targetWithinSession: true,
        symbolContinuity: "proved",
        corporateActionState: "none",
      },
      asOfBasis: retrievalAsOfBasis,
      correctedCutoffNs: null,
    },
    normalizedFacts,
  );
  const calendarSnapshot = {
    calendarSnapshotId,
    ...calendarWithoutId,
  };
  const acquisition = {
    sourceProfileId,
    acquisitionObservationId,
    acquisitionObservationPreimage: {
      provider: providerPreimage.providerCode,
      retrievalAttemptId: fixtureObservation(authority.seeds[0] as RecordedFixtureSeedMember)
        .attemptId,
      sanitizedRequestIdentityHash: fixtureObservation(
        authority.seeds[0] as RecordedFixtureSeedMember,
      ).request.identityHash,
      routeLabel: "market-reference.synthetic-recorded",
    },
    marketAcquisitionId,
    marketAcquisitionPreimage: acquisitionPreimage,
    acquisitionMode: "recorded",
    declaredPageSize: 1,
    expectedPageCount: 1,
    consecutiveCalendarDates: ["2037-06-17"],
    pageTokenInput: null,
    completeWindowRequired: true,
  };
  const recordedCorpora = [
    {
      recordedCorpusSnapshotId,
      snapshot,
      corpusCutoffId,
      cutoff,
    },
  ];
  const parsedFactExpectations = normalizedFacts.map((fact) => {
    assert.ok(fact.marketFactId);
    assert.ok(fact.payload);
    const providerObservationPreimage = {
      ...fact.source,
      instrumentId: fact.instrumentId,
      venueTapeId: fact.venueTapeId,
      providerRecordKey: fact.providerRecordKey,
      providerRevisionKey: fact.providerRevisionKey,
      eventKind: fact.eventKind,
      eventTime: fact.eventTime,
      providerSequence: fact.providerSequence,
      sequenceSessionDate: fact.sequenceSessionDate,
      canonicalProviderPayloadDigest: fact.canonicalProviderPayloadDigest,
    };
    const deliveryPreimage = {
      providerObservationId: fact.providerObservationId,
      marketAcquisitionId: fact.marketAcquisitionId,
      rawArtifactId: fact.rawArtifactId,
      memberKey: fact.memberKey,
      occurrenceOrdinal: fact.occurrenceOrdinal,
    };
    const revisionFamilyPreimage = {
      providerId: fact.source.providerId,
      datasetId: fact.source.datasetId,
      feedId: fact.source.feedId,
      endpointChannelId: fact.source.endpointChannelId,
      instrumentId: fact.instrumentId,
      eventKind: fact.eventKind,
      providerStableRecordFamily: fact.providerStableRecordFamily,
    };
    const marketFactPreimage = {
      instrumentId: fact.instrumentId,
      eventKind: fact.eventKind,
      eventTime: fact.eventTime,
      venueTapeId: fact.venueTapeId,
      sessionKind: fact.sessionKind,
      currency: fact.currency,
      canonicalPayload: fact.payload,
    };
    const revisionPreimage = {
      revisionFamilyId: fact.revisionFamilyId,
      revisionKind: fact.revisionKind,
      providerRevisionKey: fact.providerRevisionKey,
      supersedesRevisionId: fact.supersedesRevisionId,
      effectiveEventTime: fact.effectiveEventTime,
      marketFactId: fact.marketFactId,
    };
    const normalizedMarketFactPreimage = {
      marketFactId: fact.marketFactId,
      providerObservationId: fact.providerObservationId,
      revisionId: fact.revisionId,
      normalizerVersion: fact.normalizerVersion,
      conditionPolicyVersion: fact.conditionPolicyVersion,
      calendarVersion: fact.calendarVersion,
      parserContractVersion: fact.parserContractVersion,
    };
    return {
      memberRole: "market-page-0",
      recordOrdinal: fact.occurrenceOrdinal,
      sourceProfileId,
      instrumentId,
      providerObservationId: deriveProviderObservationId(providerObservationPreimage),
      providerObservationPreimage,
      deliveryId: deriveDeliveryId(deliveryPreimage),
      deliveryPreimage,
      revisionFamilyId: deriveRevisionFamilyId(revisionFamilyPreimage),
      revisionFamilyPreimage,
      revisionId: deriveRevisionId(revisionPreimage),
      revisionPreimage,
      marketFactId: deriveMarketFactId(marketFactPreimage),
      marketFactPreimage,
      normalizedMarketFactId: deriveNormalizedMarketFactId(normalizedMarketFactPreimage),
      normalizedMarketFactPreimage,
      factKind: fact.eventKind,
      marketEventTimeNs: fact.eventTime.epochNs,
      sourceSequence: fact.providerSequence?.value ?? null,
      sourceNativeIdentity: fact.providerRecordKey,
      canonicalFactDigest: canonicalHash("peas/market-canonical-fact/v1", marketFactPreimage),
    };
  });
  const fixturePreimage = {
    caseId: "recorded-market-synthetic",
    contractAuthorityRegistry: registry,
    sourceProfiles: [sourceProfile, comparisonSourceProfile],
    acquisition,
    instruments: [instrument],
    calendarSnapshot,
    retrievedMembers: authority.manifest.retrievedMembers,
    parsedFactExpectations,
    recordedCorpora,
    selectionRequests: [selectionRequest, missingSelectionRequest, retrievalSelectionRequest],
    catalogEvidence: recordedMarketCatalogEvidence(),
    expectedCatalogOutcomes:
      literalExpectedCatalogOutcomes() as unknown as readonly import("../src/core/json.js").JsonObject[],
    provenance: PROVENANCE,
  };
  const fixtureId = `mfx1_${canonicalHash("peas/market-fixture/v1", fixturePreimage)}`;
  const expectedEvaluation = (request: typeof selectionRequest, result: typeof evaluation) => ({
    requestId: request.requestId,
    intervalKey: request.intervalKey,
    referenceKind: request.referenceKind,
    asOfBasis: request.asOfBasis,
    status: result.status,
    resultKind: result.status === "missing" ? ("missing" as const) : ("selected" as const),
    candidateOutcomes: result.candidates,
    selectedReferenceId: result.selectedReferenceId,
    missingReferenceId: result.missingReferenceId,
    selectedNormalizedMarketFactId: result.selectedNormalizedMarketFactId,
    selectedRevisionId: result.selectedRevisionId,
    candidateSetHash: result.candidateSetHash,
    exactPrice: result.exactPrice,
    marketEventTimeNs: result.marketEventTimeNs,
    ageNs: result.ageNs,
    reason: result.reason,
    diagnostics: result.diagnostics,
  });
  const expectedEvaluations = [
    expectedEvaluation(selectionRequest, evaluation),
    expectedEvaluation(
      missingSelectionRequest as unknown as typeof selectionRequest,
      missingEvaluation as typeof evaluation,
    ),
    expectedEvaluation(
      retrievalSelectionRequest as unknown as typeof selectionRequest,
      retrievalEvaluation as typeof evaluation,
    ),
  ];
  assert.ok(evaluation.selectedReferenceId);
  assert.ok(retrievalEvaluation.selectedReferenceId);
  const expectedMetrics = (["capture", "retrieval"] as const).map((observationBasisKind) => {
    const numeratorReferenceId =
      observationBasisKind === "capture"
        ? evaluation.selectedReferenceId
        : retrievalEvaluation.selectedReferenceId;
    const preimage = {
      metricKind: "release-gap-movement",
      priceBasis: "quote-nbbo-midpoint",
      observationBasisKind,
      viewKind: "recorded-primary",
      numeratorReferenceId,
      denominatorReferenceId: evaluation.selectedReferenceId,
    };
    return {
      metricId: `mmm1_${canonicalHash("peas/market-movement-metric/v1", preimage)}`,
      ...preimage,
      rationalNumerator: observationBasisKind === "capture" ? "0" : "-18019999",
      rationalDenominator: observationBasisKind === "capture" ? "1" : "20020000",
      status: "selected-complete",
      reason: null,
      diagnostics: [],
    };
  });
  const expectedReasonTrace = [
    ...evaluation.candidates
      .filter((candidate) => candidate.reason !== null)
      .map((candidate) => ({
        stage: "selection",
        requestId: selectionRequest.requestId,
        candidateIdentity: candidate.normalizedMarketFactId,
        reason: candidate.reason,
        diagnostics: candidate.diagnostics,
      })),
    {
      stage: "selection",
      requestId: missingSelectionRequest.requestId,
      candidateIdentity: null,
      reason: missingEvaluation.reason,
      diagnostics: missingEvaluation.diagnostics,
    },
  ];
  assert.ok(expectedReasonTrace.every((row) => row.reason !== null));
  const exercisedBounds = fixtureExercisedBounds(
    parsedFactExpectations[0]?.normalizedMarketFactId as string,
    expectedMetrics[0]?.metricId as string,
  );
  const withoutManifestId = {
    schemaVersion: 1 as const,
    fixtureId,
    ...fixturePreimage,
    expectedEvaluations,
    expectedMetrics,
    expectedReasonTrace,
    exercisedBounds,
  };
  const manifest = {
    ...withoutManifestId,
    expectedManifestId: `mfm1_${canonicalHash(
      "peas/market-fixture-manifest/v1",
      withoutManifestId as unknown as import("../src/core/json.js").JsonValue,
    )}`,
  } as unknown as RecordedMarketFixtureManifestV1;
  return { manifest, seeds: authority.seeds, bytes };
}

function reboundManifest(value: RecordedMarketFixtureManifestV1): RecordedMarketFixtureManifestV1 {
  const mutable = structuredClone(value) as unknown as Record<string, unknown>;
  mutable["fixtureId"] = `mfx1_${canonicalHash("peas/market-fixture/v1", {
    caseId: mutable["caseId"],
    contractAuthorityRegistry: mutable["contractAuthorityRegistry"],
    sourceProfiles: mutable["sourceProfiles"],
    acquisition: mutable["acquisition"],
    instruments: mutable["instruments"],
    calendarSnapshot: mutable["calendarSnapshot"],
    retrievedMembers: mutable["retrievedMembers"],
    parsedFactExpectations: mutable["parsedFactExpectations"],
    recordedCorpora: mutable["recordedCorpora"],
    selectionRequests: mutable["selectionRequests"],
    catalogEvidence: mutable["catalogEvidence"],
    expectedCatalogOutcomes: mutable["expectedCatalogOutcomes"],
    provenance: mutable["provenance"],
  } as import("../src/core/json.js").JsonValue)}`;
  delete mutable["expectedManifestId"];
  return {
    ...mutable,
    expectedManifestId: `mfm1_${canonicalHash(
      "peas/market-fixture-manifest/v1",
      mutable as import("../src/core/json.js").JsonValue,
    )}`,
  } as unknown as RecordedMarketFixtureManifestV1;
}

function assertLoaderCatalogVectors(
  manifest: RecordedMarketFixtureManifestV1,
  caseIds: readonly string[],
): void {
  for (const caseId of caseIds) {
    const row = manifest.catalogEvidence.find((candidate) => candidate["caseId"] === caseId);
    assert.ok(row, caseId);
    assert.equal(row["enforcementOwner"], "recorded-loader", caseId);
    assert.equal(row["testVectorId"], `loader:${caseId}:v1`, caseId);
    assert.equal(typeof row["expectedOutcome"], "string", caseId);
  }
}

function assertReason(
  result: Awaited<ReturnType<typeof loadRecordedMarketArtifacts>>,
  code: string,
  detailKey: string | null = null,
  detailValue: string | null = null,
): void {
  assert.equal(result.status, "rejected");
  assert.equal(result.reason.code, code);
  if (detailKey === null) {
    assert.equal(result.reason.detail, null);
  } else {
    assert.ok(result.reason.detail);
    assert.equal(
      (result.reason.detail as unknown as Record<string, unknown>)[detailKey],
      detailValue,
    );
  }
  assert.deepEqual([...result.members], []);
}

test("full registry-bound manifest drives verified bytes through normalization and selection", async () => {
  const fixture = await fullSemanticFixture();
  const checkedManifest = JSON.parse(
    await readFile(path.join(FIXTURE_ROOT, "fixture-manifest.json"), "utf8"),
  ) as RecordedMarketFixtureManifestV1;
  const seedMap = JSON.parse(
    await readFile(path.join(FIXTURE_ROOT, "test-seed-map.json"), "utf8"),
  ) as {
    schemaVersion: number;
    fixtureId: string;
    members: readonly {
      role: string;
      sourceProfileId: string;
      providerCode: string;
      artifactDigest: string;
      sizeBytes: number;
      relativeBodyPath: string;
      attempt: RecordedFixtureSeedMember["attempt"];
      response: RecordedFixtureSeedMember["response"];
      retrievedAtMs: number;
    }[];
  };
  assert.deepEqual(checkedManifest, fixture.manifest);
  assert.equal(seedMap.schemaVersion, 1);
  assert.equal(seedMap.fixtureId, checkedManifest.fixtureId);
  assert.deepEqual(
    seedMap.members,
    fixture.seeds.map((seed) => ({
      role: seed.role,
      sourceProfileId: checkedManifest.retrievedMembers.find((member) => member.role === seed.role)
        ?.sourceProfileId,
      providerCode: seed.attempt.provider,
      artifactDigest: seed.artifactHash,
      sizeBytes: seed.sizeBytes,
      relativeBodyPath: seed.path,
      attempt: seed.attempt,
      response: seed.response,
      retrievedAtMs: seed.retrievedAtMs,
    })),
  );
  const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, fixture.seeds);
  const projected = recordedMarketArtifactProjection(checkedManifest);
  const checkpointRead = await loadRecordedMarketArtifacts(authority.store, projected);
  assert.equal(checkpointRead.status, "verified", JSON.stringify(checkpointRead));
  const checkpointFacts = normalizeVerifiedRecordedMarketFixture(
    checkedManifest,
    checkpointRead.members,
  );
  const checkpointEvaluations = evaluateRecordedMarketFixtureSelections(
    checkedManifest,
    checkpointFacts,
  );
  const checkpointCatalogOutcomes = await evaluateRecordedLoaderCatalog(
    checkedManifest,
    checkpointRead.members,
    checkpointFacts,
  );
  const result = await loadRecordedMarketFixture(authority.store, checkedManifest);
  assert.equal(result.status, "verified", JSON.stringify(result));
  assert.deepEqual(checkpointFacts, result.normalizedFacts);
  assert.deepEqual(checkpointEvaluations, result.evaluations);
  assert.deepEqual(checkpointCatalogOutcomes, result.catalogOutcomes);
  assert.equal(result.catalogOutcomes.length, 40);
  assert.equal(new Set(result.catalogOutcomes.map((outcome) => outcome.caseId)).size, 40);
  for (const outcome of result.catalogOutcomes) {
    assert.notEqual(outcome.state["operationEvidence"], null, outcome.caseId);
    assert.deepEqual(
      JSON.parse(JSON.stringify(outcome.state["operationEvidence"])),
      checkedManifest.expectedCatalogOutcomes.find((row) => row["caseId"] === outcome.caseId)?.[
        "operationEvidence"
      ],
      outcome.caseId,
    );
  }
  assert.equal(result.normalizedFacts.length, REQUIRED_CATALOG_CASE_IDS.length);
  assert.match(result.normalizedFacts[0]?.providerObservationId ?? "", /^mob1_[a-f0-9]{64}$/u);
  assert.match(result.normalizedFacts[0]?.deliveryId ?? "", /^mdl1_[a-f0-9]{64}$/u);
  assert.match(result.normalizedFacts[0]?.revisionId ?? "", /^mrv1_[a-f0-9]{64}$/u);
  assert.match(result.normalizedFacts[0]?.marketFactId ?? "", /^mft1_[a-f0-9]{64}$/u);
  assert.match(result.normalizedFacts[0]?.normalizedMarketFactId ?? "", /^mnf1_[a-f0-9]{64}$/u);
  assert.equal(result.evaluations.length, 3);
  assert.match(result.evaluations[0]?.selectedReferenceId ?? "", /^msr1_[a-f0-9]{64}$/u);
  assert.match(result.evaluations[1]?.missingReferenceId ?? "", /^mmr1_[a-f0-9]{64}$/u);
  assert.match(result.evaluations[2]?.selectedReferenceId ?? "", /^msr1_[a-f0-9]{64}$/u);
  assert.notEqual(
    result.evaluations[0]?.selectedReferenceId,
    result.evaluations[2]?.selectedReferenceId,
  );
  assert.equal(checkedManifest.expectedMetrics.length, 2);
  assert.ok(checkedManifest.expectedReasonTrace.length > 0);
  assert.equal(
    new Set(checkedManifest.exercisedBounds.map((row) => row["boundId"])).size,
    BOUND_ENFORCEMENT_REGISTRY.length,
  );
  const loaderBoundRows = checkedManifest.exercisedBounds.filter((row) =>
    RECORDED_LOADER_BOUND_IDS.includes(
      row["boundId"] as (typeof RECORDED_LOADER_BOUND_IDS)[number],
    ),
  );
  assert.equal(RECORDED_LOADER_BOUND_IDS.length, 33);
  assert.equal(new Set(loaderBoundRows.map((row) => row["boundId"])).size, 33);
  assert.ok(
    loaderBoundRows.every((row) => {
      const disposition = row["expectedDisposition"] as Record<string, unknown>;
      return disposition["vectorKind"] === "exact"
        ? disposition["accepted"] === true
        : disposition["accepted"] === false;
    }),
  );
  for (const rule of BOUND_ENFORCEMENT_REGISTRY) {
    const rows = checkedManifest.exercisedBounds.filter((row) => row["boundId"] === rule.boundId);
    assert.equal(
      rows.filter(
        (row) => (row["expectedDisposition"] as Record<string, unknown>)["vectorKind"] === "exact",
      ).length,
      1,
      rule.boundId,
    );
    assert.equal(
      rows.filter(
        (row) =>
          (row["expectedDisposition"] as Record<string, unknown>)["vectorKind"] ===
          "upper-one-over",
      ).length,
      Number(rule.upperViolation !== null) + Number(rule.schemaUpperViolation !== null),
      rule.boundId,
    );
    assert.equal(
      rows.some(
        (row) =>
          (row["expectedDisposition"] as Record<string, unknown>)["vectorKind"] ===
          "lower-one-below",
      ),
      rule.lowerViolation !== null,
      rule.boundId,
    );
    assert.equal(
      rows.some(
        (row) =>
          (row["expectedDisposition"] as Record<string, unknown>)["vectorKind"] ===
          "exact-count-minus-one",
      ),
      rule.countMinusOneViolation !== null,
      rule.boundId,
    );
  }
  const primaryPolicy = checkedManifest.selectionRequests[0]?.["selectionPolicyPreimage"] as Record<
    string,
    unknown
  >;
  assert.equal(primaryPolicy["primaryAnchorKind"], "capture");
  assert.equal(primaryPolicy["alternateAnchorKind"], "retrieval");
  assert.equal(primaryPolicy["alternateAnchorRequired"], true);
  assert.equal(primaryPolicy["targetSelector"], "last-eligible-at-or-before");
  assert.equal(
    primaryPolicy["publicationOriginSelector"],
    "last-eligible-strictly-before-publication",
  );
  assert.deepEqual(
    checkedManifest.expectedMetrics.map((row) => row["observationBasisKind"]).sort(),
    ["capture", "retrieval"],
  );
  assert.equal(checkedManifest.catalogEvidence.length, 64);
  assert.equal(new Set(checkedManifest.catalogEvidence.map((row) => row["caseId"])).size, 64);
  assert.deepEqual(
    Object.fromEntries(
      ["recorded-loader", "market-core", "integration-replay"].map((owner) => [
        owner,
        checkedManifest.catalogEvidence.filter((row) => row["enforcementOwner"] === owner).length,
      ]),
    ),
    { "recorded-loader": 40, "market-core": 22, "integration-replay": 2 },
  );
  assert.equal(
    checkedManifest.selectionRequests[0]?.["marketReferenceJoinKey"],
    deriveMarketReferenceJoinKey({
      subject: "earnings:0000000001:2027-Q1",
      issuerMappingId: "imap1_b5fb4ba66e0c0db04d272e66bcfd071e46fe343be06487bb76c892834958441e",
      selectedSourceObservationId: `sob1_${sha256("fictional-source-observation")}`,
      selectedSourceVersionIdentity: `svr1_${sha256("fictional-source-version")}`,
      trustedObservationBasis: {
        basisKind: "capture",
        eventId: sha256("fictional-capture-event"),
        receivedAtMs: 105000,
        logicalAtMs: 105000,
        clockBasisId: `clk1_${sha256("fictional-clock")}`,
      },
    }),
  );
  assert.deepEqual(
    result.normalizedFacts.map((entry) => entry.providerRecordKey),
    REQUIRED_CATALOG_CASE_IDS.map((caseId) => `synthetic-catalog:${caseId}`),
  );
  const fact = result.normalizedFacts[0];
  assert.ok(fact);
  const {
    providerObservationId: _providerObservationId,
    deliveryId: _deliveryId,
    revisionFamilyId: _revisionFamilyId,
    revisionId: _revisionId,
    marketFactId: _marketFactId,
    normalizedMarketFactId: _normalizedMarketFactId,
    ...record
  } = fact;
  for (const field of ["credential", "account", "cookie", "header", "url", "path", "unknown"]) {
    assert.throws(
      () =>
        normalizeRecordedMarketRecord({
          ...record,
          [field]: `forbidden-${field}`,
        } as Parameters<typeof normalizeRecordedMarketRecord>[0]),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "market.input-invalid" &&
        !error.message.includes(`forbidden-${field}`),
      field,
    );
  }
});

test("metric, reason-trace, and 84-bound catalogs reject hostile closed-schema mutations", async () => {
  const fixture = await fullSemanticFixture();
  const rebindMetricId = (metric: Record<string, unknown>): void => {
    metric["metricId"] = `mmm1_${canonicalHash("peas/market-movement-metric/v1", {
      metricKind: metric["metricKind"],
      priceBasis: metric["priceBasis"],
      observationBasisKind: metric["observationBasisKind"],
      viewKind: metric["viewKind"],
      numeratorReferenceId: metric["numeratorReferenceId"],
      denominatorReferenceId: metric["denominatorReferenceId"],
    } as import("../src/core/json.js").JsonValue)}`;
  };
  for (const pageSize of [1, 2, 7, 10_000]) {
    const accepted = structuredClone(fixture.manifest) as unknown as Record<string, unknown>;
    (accepted["acquisition"] as Record<string, unknown>)["declaredPageSize"] = pageSize;
    assert.doesNotThrow(() =>
      validateRecordedMarketFixtureManifest(reboundManifest(accepted as never)),
    );
  }
  const reject = (mutate: (draft: Record<string, unknown>) => void) => {
    const draft = structuredClone(fixture.manifest) as unknown as Record<string, unknown>;
    mutate(draft);
    assert.throws(() => validateRecordedMarketFixtureManifest(reboundManifest(draft as never)));
  };
  reject((draft) => {
    draft["expectedMetrics"] = [];
  });
  reject((draft) => {
    (draft["acquisition"] as Record<string, unknown>)["declaredPageSize"] = 10_001;
  });
  reject((draft) => {
    const rows = draft["expectedMetrics"] as Record<string, unknown>[];
    rows[0] = { ...rows[0], extra: true };
  });
  reject((draft) => {
    const rows = draft["expectedMetrics"] as Record<string, unknown>[];
    rows[0] = { ...rows[0], metricId: `mmm1_${"0".repeat(64)}` };
  });
  reject((draft) => {
    const rows = draft["expectedMetrics"] as Record<string, unknown>[];
    draft["expectedMetrics"] = rows.filter((row) => row["observationBasisKind"] !== "retrieval");
  });
  reject((draft) => {
    const rows = draft["expectedMetrics"] as Record<string, unknown>[];
    const retrieval = rows.find((row) => row["observationBasisKind"] === "retrieval");
    assert.ok(retrieval);
    retrieval["observationBasisKind"] = "capture";
    rebindMetricId(retrieval);
  });
  reject((draft) => {
    const rows = draft["expectedMetrics"] as Record<string, unknown>[];
    const capture = rows.find((row) => row["observationBasisKind"] === "capture");
    const retrieval = rows.find((row) => row["observationBasisKind"] === "retrieval");
    assert.ok(capture);
    assert.ok(retrieval);
    retrieval["numeratorReferenceId"] = capture["numeratorReferenceId"];
    retrieval["rationalNumerator"] = "0";
    retrieval["rationalDenominator"] = "1";
    rebindMetricId(retrieval);
  });
  reject((draft) => {
    draft["expectedReasonTrace"] = [];
  });
  reject((draft) => {
    const rows = draft["expectedReasonTrace"] as Record<string, unknown>[];
    rows[0] = { ...rows[0], requestId: `msq1_${"0".repeat(64)}` };
  });
  reject((draft) => {
    const rows = draft["exercisedBounds"] as Record<string, unknown>[];
    rows.pop();
  });
  reject((draft) => {
    const rows = draft["exercisedBounds"] as Record<string, unknown>[];
    rows.push(structuredClone(rows[0] as Record<string, unknown>));
  });
  reject((draft) => {
    const rows = draft["exercisedBounds"] as Record<string, unknown>[];
    const disposition = rows[0]?.["expectedDisposition"] as Record<string, unknown>;
    disposition["stage"] = "forged-stage";
  });
  reject((draft) => {
    const rows = draft["exercisedBounds"] as Record<string, unknown>[];
    const candidate = rows.find(
      (row) => (row["expectedDisposition"] as Record<string, unknown>)["atomicity"] === "candidate",
    );
    assert.ok(candidate);
    candidate["candidateIdentity"] = null;
  });
  reject((draft) => {
    const rows = draft["catalogEvidence"] as Record<string, unknown>[];
    rows.pop();
  });
  reject((draft) => {
    const rows = draft["catalogEvidence"] as Record<string, unknown>[];
    rows.push(structuredClone(rows[0] as Record<string, unknown>));
  });
  reject((draft) => {
    const rows = draft["catalogEvidence"] as Record<string, unknown>[];
    const core = rows.find((row) => row["caseId"] === "R-01");
    assert.ok(core);
    core["enforcementOwner"] = "recorded-loader";
    core["testVectorId"] = "loader:R-01:v1";
  });
  reject((draft) => {
    const rows = draft["catalogEvidence"] as Record<string, unknown>[];
    const capture = rows.find((row) => row["caseId"] === "M-02");
    assert.ok(capture);
    capture["expectedOutcome"] = "retrieval-primary-differs-capture";
  });
  const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, fixture.seeds);
  const invalid = reboundManifest({
    ...fixture.manifest,
    exercisedBounds: fixture.manifest.exercisedBounds.slice(1),
  });
  const result = await loadRecordedMarketFixture(authority.store, invalid);
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.members, []);
  assert.deepEqual(result.normalizedFacts, []);
  assert.deepEqual(result.evaluations, []);
});

test("original synthetic corpus covers the required recorded market conditions without network", async () => {
  const bytes = await catalogBytes();
  const fixture = makeAuthority({ body: bytes, sourceProfileId: CHECKED_SOURCE_PROFILE_ID });
  const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, fixture.seeds);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("network forbidden");
  }) as typeof fetch;
  try {
    const result = await loadRecordedMarketArtifacts(authority.store, fixture.manifest);
    assert.equal(result.status, "verified");
    assert.equal(fetchCalls, 0);
    assert.equal(result.members.length, 1);
    const loadedMember = result.members[0];
    assert.ok(loadedMember);
    assert.equal(loadedMember.records.length, REQUIRED_CATALOG_CASE_IDS.length);
    assertLoaderCatalogVectors(
      (await fullSemanticFixture()).manifest,
      REQUIRED_CATALOG_CASE_IDS.filter(
        (caseId) =>
          caseId.startsWith("Q-") ||
          caseId.startsWith("S-") ||
          caseId.startsWith("T-") ||
          caseId.startsWith("B-") ||
          caseId.startsWith("PCL-"),
      ),
    );
    const recordsByCase = new Map(
      loadedMember.records.map((record) => {
        const row = record as Record<string, unknown>;
        return [String(row["providerRecordKey"]).replace("synthetic-catalog:", ""), row] as const;
      }),
    );
    for (const caseId of REQUIRED_CATALOG_CASE_IDS.slice(0, 32)) {
      const record = recordsByCase.get(caseId);
      assert.ok(record, caseId);
      const expectedKind = caseId.startsWith("Q-")
        ? "quote"
        : caseId.startsWith("S-")
          ? "quote"
          : caseId.startsWith("T-") || caseId === "PCL-03"
            ? "trade"
            : caseId.startsWith("B-")
              ? "bar"
              : caseId === "PCL-01"
                ? "corrected-close"
                : "official-close";
      assert.equal(record["eventKind"], expectedKind, caseId);
      const expectedPayloadKind =
        expectedKind === "corrected-close" || expectedKind === "official-close"
          ? "prior-close"
          : expectedKind;
      assert.equal(
        (record["payload"] as Record<string, unknown>)["kind"],
        expectedPayloadKind,
        caseId,
      );
    }
    const q02 = recordsByCase.get("Q-02");
    assert.ok(q02);
    const q02Payload = q02["payload"] as Record<string, unknown>;
    const q02Bid = q02Payload["bidPrice"] as Record<string, unknown>;
    const q02Ask = q02Payload["askPrice"] as Record<string, unknown>;
    assert.equal(q02Bid["coefficient"], "1");
    assert.equal(q02Bid["scale"], 0);
    assert.equal(q02Bid["negative"], false);
    assert.equal(q02Ask["coefficient"], "1000001");
    assert.equal(q02Ask["scale"], 6);
    assert.equal(q02Ask["negative"], false);
    assert.equal((loadedMember.records[0] as Record<string, unknown>)["eventKind"], "quote");
    const member = fixture.manifest.retrievedMembers[0];
    assert.ok(member);
    assert.equal(authority.counters.observationCalls.get(member.selectedObservationId), 1);
    assert.equal(authority.counters.readCalls.get(member.artifactDigest), 1);
    assert.equal(authority.counters.streamedBytes.get(member.artifactDigest), bytes.byteLength);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("identical bytes from distinct synthetic providers preserve observation and raw-artifact identity", async () => {
  const bytes = await catalogBytes();
  const left = makeAuthority({
    body: bytes,
    providerCode: "peas-synthetic-a",
    sourceProfileId: CHECKED_SOURCE_PROFILE_ID,
  });
  const right = makeAuthority({
    body: bytes,
    providerCode: "peas-synthetic-b",
    sourceProfileId: CHECKED_SOURCE_PROFILE_ID,
  });
  const leftResult = await loadRecordedMarketArtifacts(
    recordedFixtureArtifactStore(FIXTURE_ROOT, left.seeds).store,
    left.manifest,
  );
  const rightResult = await loadRecordedMarketArtifacts(
    recordedFixtureArtifactStore(FIXTURE_ROOT, right.seeds).store,
    right.manifest,
  );
  assert.equal(leftResult.status, "verified");
  assert.equal(rightResult.status, "verified");
  assert.equal(leftResult.members[0]?.artifactContentId, rightResult.members[0]?.artifactContentId);
  assert.notEqual(
    leftResult.members[0]?.selectedObservationId,
    rightResult.members[0]?.selectedObservationId,
  );
  assert.notEqual(leftResult.members[0]?.rawArtifactId, rightResult.members[0]?.rawArtifactId);
  assert.deepEqual(leftResult.members[0]?.bytes, rightResult.members[0]?.bytes);
});

test("ArtifactStore observation, provider, digest, hash, as-of, and media evidence fail before reads", async () => {
  const bytes = await catalogBytes();
  const fixture = makeAuthority({ body: bytes });
  assertLoaderCatalogVectors((await fullSemanticFixture()).manifest, ["E-01", "E-02"]);
  const mutations: readonly ((value: ArtifactObservation) => ArtifactObservation)[] = [
    (value) => ({ ...value, retrievedAtMs: AS_OF_MS + 1 }),
    (value) => ({ ...value, provider: "prv1_invalid" as typeof value.provider }),
    (value) => ({ ...value, artifactDigest: "0".repeat(64) }),
    (value) => ({ ...value, observationHash: "0".repeat(64) }),
    (value) => ({
      ...value,
      response: { ...value.response, mediaType: "text/plain" },
    }),
  ];
  for (const mutate of mutations) {
    const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, fixture.seeds, {
      observation: (value) => {
        const changed = mutate(value);
        if (changed.observationHash === value.observationHash) {
          const { observationHash: _old, ...withoutHash } = changed;
          return { ...withoutHash, observationHash: observationHash(withoutHash) };
        }
        return changed;
      },
    });
    const result = await loadRecordedMarketArtifacts(authority.store, fixture.manifest);
    assert.equal(result.status, "rejected");
    assert.equal(authority.counters.readCalls.size, 0);
  }
});

test("duplicate-key and deeply nested JSON reject atomically after one complete verified read", async () => {
  assertLoaderCatalogVectors((await fullSemanticFixture()).manifest, ["X-01", "X-02", "X-03"]);
  const duplicateBytes = Buffer.from(
    `{"schemaVersion":1,"sourceProfileId":"${SOURCE_PROFILE_ID}","records":[],"records":[{"caseId":"X-02"}]}`,
  );
  const duplicate = makeAuthority({ body: duplicateBytes });
  const duplicateAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, duplicate.seeds, {
    metadataSize: () => duplicateBytes.byteLength,
    stream: () => Readable.from([duplicateBytes]),
  });
  const duplicateResult = await loadRecordedMarketArtifacts(
    duplicateAuthority.store,
    duplicate.manifest,
  );
  assertReason(duplicateResult, "market.input-invalid");
  assert.equal(
    duplicateAuthority.counters.streamedBytes.get(duplicate.seeds[0]?.artifactHash ?? ""),
    duplicateBytes.byteLength,
  );

  const nested = Buffer.from(
    `{"schemaVersion":1,"sourceProfileId":"${SOURCE_PROFILE_ID}","records":[${"[".repeat(
      33,
    )}0${"]".repeat(33)}]}`,
  );
  const nestedFixture = makeAuthority({ body: nested });
  const nestedAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, nestedFixture.seeds, {
    metadataSize: () => nested.byteLength,
    stream: () => Readable.from([nested]),
  });
  const nestedResult = await loadRecordedMarketArtifacts(
    nestedAuthority.store,
    nestedFixture.manifest,
  );
  assertReason(nestedResult, "market.bound-exceeded", "limitKind", "rawJsonDepth");
});

test("actual stream growth and replacement fail verified complete reads with no partial members", async () => {
  assertLoaderCatalogVectors((await fullSemanticFixture()).manifest, ["X-04"]);
  const bytes = await catalogBytes();
  const fixture = makeAuthority({ body: bytes });
  const growthAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, fixture.seeds, {
    stream: () => Readable.from([bytes, Buffer.from("x")]),
  });
  const growth = await loadRecordedMarketArtifacts(growthAuthority.store, fixture.manifest);
  assert.equal(growth.status, "rejected");
  assert.deepEqual(growth.members, []);
  assert.equal(growth.reason.code, "market.artifact-read-failed");

  const replacement = Uint8Array.from(bytes, (value, index) => (index === 0 ? value ^ 1 : value));
  const replacementAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, fixture.seeds, {
    stream: () => Readable.from([replacement]),
  });
  const replaced = await loadRecordedMarketArtifacts(replacementAuthority.store, fixture.manifest);
  assert.equal(replaced.status, "rejected");
  assertReason(replaced, "market.artifact-invalid", "artifactFailureKind", "digest-mismatch");
  assert.deepEqual(replaced.members, []);
});

test("artifact/page and aggregate exact one-over declarations reject before lookup or parse", async () => {
  assertLoaderCatalogVectors((await fullSemanticFixture()).manifest, ["X-05"]);
  const bytes = await catalogBytes();
  const minimal = Buffer.from(
    `{"schemaVersion":1,"sourceProfileId":"${SOURCE_PROFILE_ID}","records":[]}`,
  );
  const exactArtifactBytes = Buffer.concat([
    minimal,
    Buffer.alloc(MARKET_MAX_RAW_ARTIFACT_BYTES - minimal.byteLength, 0x20),
  ]);
  const exactArtifact = makeAuthority({ body: exactArtifactBytes });
  const exactArtifactAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, exactArtifact.seeds, {
    metadataSize: () => exactArtifactBytes.byteLength,
    stream: () => Readable.from([exactArtifactBytes]),
  });
  const exactArtifactResult = await loadRecordedMarketArtifacts(
    exactArtifactAuthority.store,
    exactArtifact.manifest,
  );
  assert.equal(exactArtifactResult.status, "verified");
  assert.equal(
    exactArtifactAuthority.counters.streamedBytes.get(sha256(exactArtifactBytes)),
    MARKET_MAX_RAW_ARTIFACT_BYTES,
  );

  const sixteenPages = makeAuthority({
    body: bytes,
    memberCount: 16,
    sourceProfileId: CHECKED_SOURCE_PROFILE_ID,
  });
  const sixteenAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, sixteenPages.seeds);
  const sixteenResult = await loadRecordedMarketArtifacts(
    sixteenAuthority.store,
    sixteenPages.manifest,
  );
  assert.equal(sixteenResult.status, "verified");
  assert.equal(sixteenResult.members.length, 16);

  const rawOneOver = makeAuthority({
    body: bytes,
    declaredSizeBytes: MARKET_MAX_RAW_ARTIFACT_BYTES + 1,
  });
  const rawAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, rawOneOver.seeds);
  const rawResult = await loadRecordedMarketArtifacts(rawAuthority.store, rawOneOver.manifest);
  assertReason(rawResult, "market.bound-exceeded", "limitKind", "rawArtifactBytes");
  assert.equal(rawAuthority.counters.observationCalls.size, 0);

  const seventeen = makeAuthority({
    body: bytes,
    memberCount: 17,
    digests: Array.from({ length: 17 }, (_, index) => sha256(`artifact-${index}`)),
  });
  const seventeenAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, seventeen.seeds);
  const seventeenResult = await loadRecordedMarketArtifacts(
    seventeenAuthority.store,
    seventeen.manifest,
  );
  assertReason(seventeenResult, "market.bound-exceeded", "limitKind", "pagesPerAcquisition");
  assert.equal(seventeenAuthority.counters.observationCalls.size, 0);

  const aggregate = makeAuthority({
    body: bytes,
    memberCount: 7,
    declaredSizeBytes: MARKET_MAX_RAW_ARTIFACT_BYTES,
    digests: Array.from({ length: 7 }, (_, index) => sha256(`aggregate-${index}`)),
  });
  const aggregateAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, aggregate.seeds, {
    metadataSize: () => MARKET_MAX_RAW_ARTIFACT_BYTES,
  });
  const aggregateResult = await loadRecordedMarketArtifacts(
    aggregateAuthority.store,
    aggregate.manifest,
  );
  assertReason(aggregateResult, "market.bound-exceeded", "limitKind", "aggregateVerifiedBytes");
  assert.equal(aggregateAuthority.counters.readCalls.size, 7);
  assert.deepEqual(aggregateResult.members, []);
});

test("record-count exact and one-over boundaries are deterministic", async () => {
  const build = (count: number): Uint8Array =>
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        sourceProfileId: SOURCE_PROFILE_ID,
        records: Array.from({ length: count }, (_, index) => index),
      }),
    );
  const exactBytes = build(10_000);
  const exact = makeAuthority({ body: exactBytes });
  const exactAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, exact.seeds, {
    metadataSize: () => exactBytes.byteLength,
    stream: () => Readable.from([exactBytes]),
  });
  const exactResult = await loadRecordedMarketArtifacts(exactAuthority.store, exact.manifest);
  assert.equal(exactResult.status, "verified");
  assert.equal(exactResult.members[0]?.records.length, 10_000);

  const overBytes = build(10_001);
  const over = makeAuthority({ body: overBytes });
  const overAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, over.seeds, {
    metadataSize: () => overBytes.byteLength,
    stream: () => Readable.from([overBytes]),
  });
  const overResult = await loadRecordedMarketArtifacts(overAuthority.store, over.manifest);
  assertReason(overResult, "market.bound-exceeded", "limitKind", "recordsPerArtifactOrPage");
});

test("page-chain gaps, loops, substitutions, and terminal misplacement reject before ArtifactStore access", async () => {
  assertLoaderCatalogVectors((await fullSemanticFixture()).manifest, ["O-03"]);
  const bytes = await catalogBytes();
  const fixture = makeAuthority({
    body: bytes,
    memberCount: 3,
    digests: [sha256("page-a"), sha256("page-b"), sha256("page-c")],
  });
  const mutations: readonly ((
    members: RecordedMarketArtifactManifestV1["retrievedMembers"],
  ) => RecordedMarketArtifactManifestV1["retrievedMembers"])[] = [
    (members) =>
      members.map((member, index) => (index === 1 ? { ...member, pageOrdinal: 2 } : member)),
    (members) =>
      members.map((member, index) =>
        index === 1 ? { ...member, priorPageChainHash: member.artifactDigest } : member,
      ),
    (members) =>
      members.map((member, index) =>
        index === 1
          ? { ...member, artifactContentId: members[2]?.artifactContentId ?? "" }
          : member,
      ),
    (members) =>
      members.map((member, index) => (index === 0 ? { ...member, terminalPage: true } : member)),
  ];
  for (const mutate of mutations) {
    const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, fixture.seeds);
    const result = await loadRecordedMarketArtifacts(authority.store, {
      ...fixture.manifest,
      retrievedMembers: mutate(fixture.manifest.retrievedMembers),
    });
    assertReason(result, "market.input-invalid");
    assert.equal(authority.counters.observationCalls.size, 0);
    assert.equal(authority.counters.readCalls.size, 0);
  }
});

test("first, middle, and last metadata failures settle every acquired sibling with no post-return activity", async () => {
  const bytes = await catalogBytes();
  const fixture = makeAuthority({
    body: bytes,
    memberCount: 3,
    digests: [sha256("settle-a"), sha256("settle-b"), sha256("settle-c")],
  });
  for (const failingRole of ["market-page-0", "market-page-1", "market-page-2"]) {
    const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, fixture.seeds, {
      metadataSize: (actual, seed) => (seed.role === failingRole ? actual + 1 : actual),
    });
    const result = await loadRecordedMarketArtifacts(authority.store, fixture.manifest);
    assertReason(result, "market.artifact-invalid", "artifactFailureKind", "size-mismatch");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(authority.counters.readCalls.size, 3);
    assert.equal(
      [...authority.counters.readCalls.values()].reduce((sum, count) => sum + count, 0),
      3,
    );
    assert.equal(
      [...authority.counters.streamCloses.values()].reduce((sum, count) => sum + count, 0),
      3,
    );
    const snapshot = {
      starts: [...authority.counters.streamStarts],
      settles: [...authority.counters.streamSettles],
      closes: [...authority.counters.streamCloses],
      bytes: [...authority.counters.streamedBytes],
    };
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(
      {
        starts: [...authority.counters.streamStarts],
        settles: [...authority.counters.streamSettles],
        closes: [...authority.counters.streamCloses],
        bytes: [...authority.counters.streamedBytes],
      },
      snapshot,
    );
  }
});

function boundedArrayTree(totalNodes: number, maximumArrayItems: number): JsonValue {
  assert.ok(Number.isSafeInteger(totalNodes) && totalNodes >= 2);
  const innerArrayCount = Math.ceil((totalNodes - 1) / (maximumArrayItems + 1));
  assert.ok(innerArrayCount <= maximumArrayItems);
  let leavesRemaining = totalNodes - 1 - innerArrayCount;
  const root: JsonValue[] = [];
  for (let index = 0; index < innerArrayCount; index += 1) {
    const leafCount = Math.min(maximumArrayItems, leavesRemaining);
    root.push(Array.from({ length: leafCount }, () => null));
    leavesRemaining -= leafCount;
  }
  assert.equal(leavesRemaining, 0);
  return root;
}

function nestedArrayAtDepth(depth: number): JsonValue {
  assert.ok(Number.isSafeInteger(depth) && depth >= 1);
  let value: JsonValue = null;
  for (let current = 1; current < depth; current += 1) value = [value];
  return value;
}

function objectWithKeys(count: number): JsonValue {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`k${String(index).padStart(3, "0")}`, null]),
  );
}

function parserTokenTree(tokenCount: number): JsonValue {
  assert.ok(tokenCount >= 4);
  // One root-object node plus one property-name token leaves tokenCount - 2 nodes in the value.
  return { payload: boundedArrayTree(tokenCount - 2, 10_000) };
}

function canonicalSizedValue(targetBytes: number): JsonValue {
  assert.ok(Number.isSafeInteger(targetBytes) && targetBytes >= 2);
  if (targetBytes <= 1_026) return "x".repeat(targetBytes - 2);
  for (let fieldCount = 1; fieldCount <= 64; fieldCount += 1) {
    const value = Object.fromEntries(
      Array.from({ length: fieldCount }, (_, index) => [`k${String(index).padStart(2, "0")}`, ""]),
    );
    const emptyBytes = Buffer.byteLength(canonicalJson(value), "utf8");
    const payloadBytes = targetBytes - emptyBytes;
    if (payloadBytes < 0 || payloadBytes > fieldCount * 1_024) continue;
    let remaining = payloadBytes;
    for (const key of Object.keys(value)) {
      const bytes = Math.min(1_024, remaining);
      value[key] = "x".repeat(bytes);
      remaining -= bytes;
    }
    assert.equal(remaining, 0);
    assert.equal(Buffer.byteLength(canonicalJson(value), "utf8"), targetBytes);
    return value;
  }
  assert.fail(`cannot construct bounded JSON with ${targetBytes} canonical bytes`);
}

function canonicalSizedExecutionBundle(
  targetBytes: number,
): operationalLoaderBounds.RecordedExecutionBundleInputV1 {
  const emptyBytes = Buffer.byteLength(canonicalJson({ edges: [], records: [] }), "utf8");
  const fullRecord = canonicalSizedValue(65_536);
  const fullRecordCount = Math.floor((targetBytes - emptyBytes - 2) / 65_537);
  const tailBytes = targetBytes - emptyBytes - fullRecordCount * 65_537;
  assert.ok(fullRecordCount >= 1 && fullRecordCount < 4_096);
  assert.ok(tailBytes >= 2 && tailBytes <= 65_536);
  return {
    records: [
      ...Array.from({ length: fullRecordCount }, () => fullRecord),
      canonicalSizedValue(tailBytes),
    ],
    edges: [],
  };
}

test("all 33 recorded-loader bounds execute exact and one-over typed operational paths", () => {
  const exercised = new Set<operationalLoaderBounds.RecordedLoaderBoundIdV1>();
  const oneOver = (
    boundId: operationalLoaderBounds.RecordedLoaderBoundIdV1,
    action: () => unknown,
  ): void => {
    assert.throws(
      action,
      (error: unknown) =>
        error instanceof MarketContractError &&
        error.reason.code === "market.bound-exceeded" &&
        error.reason.detail !== null &&
        "limitKind" in error.reason.detail &&
        error.reason.detail.limitKind === boundId,
      boundId,
    );
    exercised.add(boundId);
  };
  const exact = (action: () => unknown): void => assert.doesNotThrow(action);

  exact(() =>
    operationalLoaderBounds.validateRawArtifactByteBound({
      role: "market-page-0",
      declaredSizeBytes: 10_485_760,
      verifiedSizeBytes: 10_485_760,
    }),
  );
  oneOver("rawArtifactBytes", () =>
    operationalLoaderBounds.validateRawArtifactByteBound({
      role: "market-page-0",
      declaredSizeBytes: 10_485_761,
      verifiedSizeBytes: 10_485_760,
    }),
  );

  const aggregateExact = [
    ...Array.from({ length: 6 }, (_, index) => ({
      role: `market-page-${index}`,
      declaredSizeBytes: 10_485_760,
      verifiedSizeBytes: 10_485_760,
    })),
    {
      role: "market-page-6",
      declaredSizeBytes: 4_194_304,
      verifiedSizeBytes: 4_194_304,
    },
  ];
  exact(() => operationalLoaderBounds.validateAggregateVerifiedByteBound(aggregateExact));
  oneOver("aggregateVerifiedBytes", () =>
    operationalLoaderBounds.validateAggregateVerifiedByteBound([
      ...aggregateExact.slice(0, -1),
      {
        role: "market-page-6",
        declaredSizeBytes: 4_194_305,
        verifiedSizeBytes: 4_194_305,
      },
    ]),
  );

  exact(() =>
    operationalLoaderBounds.validateAcquisitionCardinalityBounds({
      artifactMembers: Array.from({ length: 16 }, () => null),
      expectedPageCount: 16,
      instrumentIds: ["instrument-0"],
    }),
  );
  oneOver("artifactsPerAcquisition", () =>
    operationalLoaderBounds.validateAcquisitionCardinalityBounds({
      artifactMembers: Array.from({ length: 17 }, () => null),
      expectedPageCount: 16,
      instrumentIds: ["instrument-0"],
    }),
  );
  oneOver("pagesPerAcquisition", () =>
    operationalLoaderBounds.validateAcquisitionCardinalityBounds({
      artifactMembers: [],
      expectedPageCount: 17,
      instrumentIds: ["instrument-0"],
    }),
  );
  exact(() =>
    operationalLoaderBounds.validateAcquisitionCardinalityBounds({
      artifactMembers: [],
      expectedPageCount: 1,
      instrumentIds: Array.from({ length: 64 }, (_, index) => `instrument-${index}`),
    }),
  );
  oneOver("instrumentsPerAcquisition", () =>
    operationalLoaderBounds.validateAcquisitionCardinalityBounds({
      artifactMembers: [],
      expectedPageCount: 1,
      instrumentIds: Array.from({ length: 65 }, (_, index) => `instrument-${index}`),
    }),
  );

  exact(() =>
    operationalLoaderBounds.validateRecordAndFactCardinalityBounds(
      [{ role: "market-page-0", pageOrdinal: 0, records: Array(10_000).fill(null) }],
      Array(160_000).fill(null),
    ),
  );
  oneOver("recordsPerArtifactOrPage", () =>
    operationalLoaderBounds.validateRecordAndFactCardinalityBounds(
      [{ role: "market-page-0", pageOrdinal: 0, records: Array(10_001).fill(null) }],
      [],
    ),
  );
  // 160,001 facts cannot coexist with both 16-page and 10,000-record maxima, so exercise the
  // narrow typed post-normalization guard directly.
  oneOver("factsPerAcquisition", () =>
    operationalLoaderBounds.validateRecordAndFactCardinalityBounds([], Array(160_001).fill(null)),
  );

  const exactCanonicalRecord = canonicalSizedValue(65_536);
  exact(() => operationalLoaderBounds.validateCanonicalRecordByteBounds([exactCanonicalRecord]));
  oneOver("canonicalRecordBytes", () =>
    operationalLoaderBounds.validateCanonicalRecordByteBounds([canonicalSizedValue(65_537)]),
  );

  exact(() =>
    operationalLoaderBounds.validateRawJsonParserBounds(nestedArrayAtDepth(32), "market-page-0"),
  );
  oneOver("rawJsonDepth", () =>
    operationalLoaderBounds.validateRawJsonParserBounds(nestedArrayAtDepth(33), "market-page-0"),
  );
  exact(() =>
    operationalLoaderBounds.validateRawJsonParserBounds(
      boundedArrayTree(250_000, 10_000),
      "market-page-0",
    ),
  );
  oneOver("rawJsonNodes", () =>
    operationalLoaderBounds.validateRawJsonParserBounds(
      boundedArrayTree(250_001, 10_000),
      "market-page-0",
    ),
  );
  exact(() =>
    operationalLoaderBounds.validateRawJsonParserBounds(objectWithKeys(64), "market-page-0"),
  );
  oneOver("rawJsonKeysPerObject", () =>
    operationalLoaderBounds.validateRawJsonParserBounds(objectWithKeys(65), "market-page-0"),
  );
  exact(() =>
    operationalLoaderBounds.validateRawJsonParserBounds(Array(10_000).fill(null), "market-page-0"),
  );
  oneOver("rawJsonArrayItems", () =>
    operationalLoaderBounds.validateRawJsonParserBounds(Array(10_001).fill(null), "market-page-0"),
  );
  exact(() =>
    operationalLoaderBounds.validateRawJsonParserBounds(parserTokenTree(250_000), "market-page-0"),
  );
  oneOver("parserTokensPerArtifact", () =>
    operationalLoaderBounds.validateRawJsonParserBounds(parserTokenTree(250_001), "market-page-0"),
  );

  exact(() =>
    operationalLoaderBounds.validateGenericStringByteBounds([
      { path: "$.raw.value", value: "x".repeat(1_024) },
    ]),
  );
  oneOver("genericStringBytes", () =>
    operationalLoaderBounds.validateGenericStringByteBounds([
      { path: "$.raw.value", value: "x".repeat(1_025) },
    ]),
  );
  exact(() =>
    operationalLoaderBounds.validateIdentifierByteBounds([
      { path: "$.request.id", value: "i".repeat(512) },
    ]),
  );
  oneOver("identifierBytes", () =>
    operationalLoaderBounds.validateIdentifierByteBounds([
      { path: "$.request.id", value: "i".repeat(513) },
    ]),
  );
  exact(() =>
    operationalLoaderBounds.validateProviderOrDatasetCodeByteBounds({
      providerCode: "p".repeat(128),
      datasetCode: "d".repeat(128),
    }),
  );
  oneOver("providerOrDatasetCodeBytes", () =>
    operationalLoaderBounds.validateProviderOrDatasetCodeByteBounds({
      providerCode: "p".repeat(129),
      datasetCode: "d",
    }),
  );
  exact(() =>
    operationalLoaderBounds.validateSymbolByteBounds([
      { path: "$.instrument.symbol", symbol: "S".repeat(32) },
    ]),
  );
  oneOver("symbolBytes", () =>
    operationalLoaderBounds.validateSymbolByteBounds([
      { path: "$.instrument.symbol", symbol: "S".repeat(33) },
    ]),
  );
  exact(() =>
    operationalLoaderBounds.validatePageTokenInputByteBound({
      path: "$.request.pageToken",
      value: "t".repeat(4_096),
    }),
  );
  oneOver("pageTokenInputBytes", () =>
    operationalLoaderBounds.validatePageTokenInputByteBound({
      path: "$.request.pageToken",
      value: "t".repeat(4_097),
    }),
  );
  exact(() =>
    operationalLoaderBounds.validateOpaqueProviderIdByteBounds([
      { path: "$.record.providerRecordKey", value: "r".repeat(128) },
    ]),
  );
  oneOver("opaqueProviderIdBytes", () =>
    operationalLoaderBounds.validateOpaqueProviderIdByteBounds([
      { path: "$.record.providerRecordKey", value: "r".repeat(129) },
    ]),
  );

  exact(() =>
    operationalLoaderBounds.validateClusterCardinalityBounds({
      intervalDefinitions: Array(16).fill(null),
      referenceResults: Array(64).fill(null),
    }),
  );
  oneOver("intervalsPerCluster", () =>
    operationalLoaderBounds.validateClusterCardinalityBounds({
      intervalDefinitions: Array(17).fill(null),
      referenceResults: [],
    }),
  );
  oneOver("referenceResultsPerCluster", () =>
    operationalLoaderBounds.validateClusterCardinalityBounds({
      intervalDefinitions: [],
      referenceResults: Array(65).fill(null),
    }),
  );

  exact(() =>
    operationalLoaderBounds.validateSidecarParserBounds(
      nestedArrayAtDepth(8),
      "$.execution.sidecar",
    ),
  );
  oneOver("sidecarDepth", () =>
    operationalLoaderBounds.validateSidecarParserBounds(
      nestedArrayAtDepth(9),
      "$.execution.sidecar",
    ),
  );
  exact(() =>
    operationalLoaderBounds.validateSidecarParserBounds(
      boundedArrayTree(512, 32),
      "$.execution.sidecar",
    ),
  );
  oneOver("sidecarNodes", () =>
    operationalLoaderBounds.validateSidecarParserBounds(
      boundedArrayTree(513, 32),
      "$.execution.sidecar",
    ),
  );
  exact(() =>
    operationalLoaderBounds.validateSidecarParserBounds(objectWithKeys(64), "$.execution.sidecar"),
  );
  oneOver("sidecarKeysPerObject", () =>
    operationalLoaderBounds.validateSidecarParserBounds(objectWithKeys(65), "$.execution.sidecar"),
  );
  exact(() =>
    operationalLoaderBounds.validateSidecarParserBounds(
      Array(32).fill(null),
      "$.execution.sidecar",
    ),
  );
  oneOver("sidecarGenericArrayItems", () =>
    operationalLoaderBounds.validateSidecarParserBounds(
      Array(33).fill(null),
      "$.execution.sidecar",
    ),
  );

  exact(() =>
    operationalLoaderBounds.validateExecutionBundleBounds({
      records: Array(4_096).fill(null),
      edges: [],
    }),
  );
  oneOver("sidecarRecordsPerExecution", () =>
    operationalLoaderBounds.validateExecutionBundleBounds({
      records: Array(4_097).fill(null),
      edges: [],
    }),
  );
  const edge = { fromRecordId: "left", toRecordId: "right", edgeKind: "derives" };
  exact(() =>
    operationalLoaderBounds.validateExecutionBundleBounds({
      records: [],
      edges: Array.from({ length: 12_279 }, () => edge),
    }),
  );
  oneOver("sidecarEdgesPerExecution", () =>
    operationalLoaderBounds.validateExecutionBundleBounds({
      records: [],
      edges: Array.from({ length: 12_280 }, () => edge),
    }),
  );

  exact(() =>
    operationalLoaderBounds.validateSidecarParserBounds(
      exactCanonicalRecord,
      "$.execution.records[0]",
    ),
  );
  exact(() => operationalLoaderBounds.validateSidecarRecordByteBounds([exactCanonicalRecord]));
  const oneOverCanonicalSidecar = canonicalSizedValue(65_537);
  exact(() =>
    operationalLoaderBounds.validateSidecarParserBounds(
      oneOverCanonicalSidecar,
      "$.execution.records[0]",
    ),
  );
  oneOver("canonicalSidecarRecordBytes", () =>
    operationalLoaderBounds.validateSidecarRecordByteBounds([oneOverCanonicalSidecar]),
  );

  exact(() =>
    operationalLoaderBounds.validateExecutionBundleBounds(
      canonicalSizedExecutionBundle(67_108_864),
    ),
  );
  oneOver("canonicalExecutionBundleBytes", () =>
    operationalLoaderBounds.validateExecutionBundleBounds(
      canonicalSizedExecutionBundle(67_108_865),
    ),
  );

  exact(() =>
    operationalLoaderBounds.validateRecordedReplayPageSizeBound({
      acquisitionMode: "replay",
      declaredPageSize: 10_000,
    }),
  );
  oneOver("recordedReplayPageSize", () =>
    operationalLoaderBounds.validateRecordedReplayPageSizeBound({
      acquisitionMode: "replay",
      declaredPageSize: 10_001,
    }),
  );
  assert.throws(
    () =>
      operationalLoaderBounds.validateRecordedReplayPageSizeBound({
        acquisitionMode: "replay",
        declaredPageSize: 0,
      }),
    (error: unknown) =>
      error instanceof MarketContractError && error.reason.code === "market.input-invalid",
  );

  exact(() =>
    operationalLoaderBounds.validateHistoricalQueryWindowBound({
      consecutiveCalendarDates: Array.from({ length: 8 }, (_, index) => `date-${index}`),
    }),
  );
  oneOver("historicalQueryWindow", () =>
    operationalLoaderBounds.validateHistoricalQueryWindowBound({
      consecutiveCalendarDates: Array.from({ length: 9 }, (_, index) => `date-${index}`),
    }),
  );
  assert.throws(
    () =>
      operationalLoaderBounds.validateHistoricalQueryWindowBound({
        consecutiveCalendarDates: [],
      }),
    (error: unknown) =>
      error instanceof MarketContractError && error.reason.code === "market.input-invalid",
  );

  exact(() =>
    operationalLoaderBounds.validateSelectionSearchWindowBound({
      windowStartMs: 0,
      windowEndMs: 86_400_000,
    }),
  );
  oneOver("selectionSearchWindowMs", () =>
    operationalLoaderBounds.validateSelectionSearchWindowBound({
      windowStartMs: 0,
      windowEndMs: 86_400_001,
    }),
  );

  exact(() =>
    operationalLoaderBounds.validateCalendarDatesPerManifestBound({
      dates: Array(400).fill(null),
    }),
  );
  oneOver("calendarDatesPerManifest", () =>
    operationalLoaderBounds.validateCalendarDatesPerManifestBound({
      dates: Array(401).fill(null),
    }),
  );

  assert.deepEqual(
    [...exercised].sort(),
    [...operationalLoaderBounds.RECORDED_LOADER_OPERATIONAL_BOUND_IDS].sort(),
  );
  assert.equal(exercised.size, 33);
});
