import { assertJsonWithinLimits, canonicalJson, type JsonValue } from "../../core/json.js";
import { validateCanonicalMarketReason } from "../../providers/market-reference/contracts.js";
import { validateMarketResultAsOfBasis } from "../../providers/market-reference/identity.js";
import { capacityHamilton, deriveStudyRankDigest } from "./algorithms.js";
import { evaluateStudyBound, STUDY_BOUND_IDS, type StudyBoundIdV1 } from "./bounds.js";
import {
  ACCEPTED_CONTRACT_AUTHORITY_REGISTRY_ID,
  STUDY_COLLECTION_SESSION_COUNT,
  STUDY_CONTRACT_AUTHORITY_IDS,
  STUDY_CORRECTION_LAG_MS,
  STUDY_DATASET_FREEZE_POLICY_VERSION,
  STUDY_FRAME_CANDIDATE_LIMIT,
  STUDY_FRAME_CELL_LIMIT,
  STUDY_JSON_LIMITS,
  STUDY_TARGET_CLUSTERS,
  type StudyCandidateFrameEntryV1,
  type StudyClusterCandidateV1,
  type StudyClusterSelectionV1,
  StudyContractError,
  type StudyDatasetFreezeV1,
  type StudyDatasetValidationEvidenceV1,
  type StudyDesignV1,
  type StudyFrameSnapshotV1,
  type StudyFreezeManifestV1,
  type StudyRunPrerequisitesV1,
  type StudyScheduleSourceEvidenceV1,
} from "./contracts.js";
import {
  deriveRankSeedHex,
  deriveReleaseClusterKey,
  deriveStudyClusterCandidateId,
  deriveStudyClusterId,
  deriveStudyDatasetFreezeId,
  deriveStudyDesignId,
  deriveStudyFrameSnapshotId,
  deriveStudyManifestId,
} from "./identity.js";
import { validateStudyReason } from "./reasons.js";

const HEX_64 = /^[0-9a-f]{64}$/u;
const GIT_SHA_40 = /^[0-9a-f]{40}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CANDIDATE_ID = /^scc1_[0-9a-f]{64}$/u;
const STUDY_CLUSTER_ID = /^scl1_[0-9a-f]{64}$/u;
const STUDY_MANIFEST_ID = /^sfm1_[0-9a-f]{64}$/u;
const MARKET_RESULT_ID = /^(?:msr1|mmr1)_[0-9a-f]{64}$/u;
const MARKET_JOIN_KEY = /^mrj1_[0-9a-f]{64}$/u;
const STUDY_REFERENCE_KINDS = [
  "quote-nbbo-midpoint",
  "trade-last-eligible-consolidated",
  "bar-one-minute-completed-close",
  "prior-listing-official-close",
] as const;
const STUDY_VIEW_KINDS = ["recorded-primary", "recorded-corrected"] as const;
const STUDY_RESULT_STATUSES = ["selected-complete", "selected-degraded", "missing"] as const;
const STUDY_METRIC_IDS = [
  "E1.complete-primary",
  "E2.observed-within-15m",
  "E3.informative-residual-5m",
  "E4.deterministic-reproduction",
  "priorCloseMovementAtFirstObservation",
  "releaseGapMovement",
  "residualMovement1m",
  "residualMovement30m",
  "residualMovement5m",
] as const;
const STUDY_ALGORITHM_KEYS = [
  "samplingAlgorithmId",
  "framePolicyId",
  "scheduleSourcePolicyId",
  "releaseClusteringPolicyId",
  "shareClassPolicyId",
  "sectorRegistryId",
  "modelFamilyRegistryId",
  "lanePolicyId",
  "controlPolicyId",
  "rankPolicyId",
  "allocationPolicyId",
  "studyReasonCatalogId",
  "studyReasonCatalogDigest",
  "marketReasonCatalogId",
  "marketReasonCatalogDigest",
  "primaryAnchorKind",
  "primaryAnchorClaim",
  "mandatorySensitivityAnchorKind",
  "selectorKind",
  "releaseOriginSelectorKind",
  "targetOffsetsNs",
  "referenceKinds",
  "viewKinds",
  "resultStatuses",
  "quoteAgePolicyId",
  "sessionPolicyId",
  "providerPolicyContractId",
  "bootstrapPolicyId",
  "holmPolicyId",
  "gatePolicyId",
  "targetClusters",
  "laneTargets",
  "controlTargets",
] as const;
const MOVEMENT_METRIC_KEYS = [
  "metricId",
  "metricKind",
  "priceBasis",
  "viewKind",
  "formulaId",
  "population",
  "missingTreatment",
  "canonicalValue",
  "displayRounding",
] as const;
const PROPORTION_METRIC_KEYS = [
  "metricId",
  "metricKind",
  "successPredicateId",
  "denominator",
  "missingTreatment",
] as const;
const GATE_THRESHOLD_KEYS = [
  "metricId",
  "intervalKind",
  "threshold",
  "goComparator",
  "noGoComparator",
  "otherwise",
] as const;
const ACCEPTED_REASON_CATALOG_DIGEST =
  "7ca2b41b8560e7b4a0672430209f4c334e9d0bee8779cecdc8d0f65bf26a9efc";
const ACCEPTED_DESIGN_POLICY_IDS = Object.freeze({
  designVersion: "StudyDesignV1",
  correctionPolicyId: "peas/market-provider-source-identity/v1",
  missingPolicyId: "peas/study-freeze-manifest/v1",
  outlierPolicyId: "peas/study-freeze-manifest/v1",
  multiplicityPolicyId: "peas/study-freeze-manifest/v1",
  sensitivityPolicyId: "peas/study-freeze-manifest/v1",
  boundsPolicyId: "peas/market-resource-bounds/v1",
  quoteAgePolicyId: "peas/market-eligibility/v1",
  sessionPolicyId: "peas/market-eligibility/v1",
  providerPolicyContractId: "peas/market-provider-source-identity/v1",
} as const);
const MOVEMENT_FORMULAS = Object.freeze({
  priorCloseMovementAtFirstObservation: "return-bps-cprev-q0",
  releaseGapMovement: "return-bps-qpre-q0",
  residualMovement1m: "return-bps-q0-q1",
  residualMovement30m: "return-bps-q0-q30",
  residualMovement5m: "return-bps-q0-q5",
} as const);
const READINESS_METRICS = Object.freeze({
  "E1.complete-primary": {
    metricKind: "fixed-denominator-proportion",
    successPredicateId: "trusted-anchor-cprev-q0-q1-q5-q30-recorded-primary-complete",
    denominator: 180,
    missingTreatment: "not-success",
  },
  "E2.observed-within-15m": {
    metricKind: "fixed-denominator-proportion",
    successPredicateId: "latency-upper-ms-lte-900000",
    denominator: 180,
    missingTreatment: "not-success",
  },
  "E3.informative-residual-5m": {
    metricKind: "fixed-denominator-proportion",
    successPredicateId: "abs-q5-minus-q0-gt-sum-half-spreads",
    denominator: 180,
    missingTreatment: "not-success",
  },
  "E4.deterministic-reproduction": {
    metricKind: "exact-reproduction-count",
    successPredicateId: "all-required-variants-byte-identical",
    denominator: 180,
    missingTreatment: "failure",
  },
} as const);
const READINESS_GATES = Object.freeze({
  "E1.complete-primary": {
    intervalKind: "wilson-two-sided-95",
    threshold: "0.750000000000000000",
    goComparator: "lower-gte",
    noGoComparator: "upper-lt",
    otherwise: "INCONCLUSIVE",
  },
  "E2.observed-within-15m": {
    intervalKind: "wilson-two-sided-95",
    threshold: "0.700000000000000000",
    goComparator: "lower-gte",
    noGoComparator: "upper-lt",
    otherwise: "INCONCLUSIVE",
  },
  "E3.informative-residual-5m": {
    intervalKind: "wilson-two-sided-95",
    threshold: "0.250000000000000000",
    goComparator: "lower-gte",
    noGoComparator: "upper-lt",
    otherwise: "INCONCLUSIVE",
  },
  "E4.deterministic-reproduction": {
    intervalKind: "none",
    threshold: "180/180",
    goComparator: "equal",
    noGoComparator: "not-equal",
    otherwise: "NO_INCONCLUSIVE_STATE",
  },
} as const);
const STUDY_LANES = ["standard", "specialized", "prospective-control"] as const;
const STUDY_CONTROLS = [
  "identity-transition",
  "schedule-uncertain",
  "source-sparse",
  "liquidity-tail",
] as const;
const STUDY_SESSIONS = [
  "pre-market",
  "regular",
  "post-market",
  "overnight-or-closed",
  "unknown",
] as const;
const STUDY_SECTORS = [
  "agriculture",
  "mining",
  "construction",
  "manufacturing",
  "transport-communications-utilities",
  "wholesale",
  "retail",
  "finance-insurance-real-estate",
  "services",
  "public-administration",
  "unknown",
] as const;
const STUDY_MODEL_FAMILIES = [
  "standard-operating-company",
  "digital-asset-treasury",
  "precommercial-biotech",
  "bank",
  "insurer",
  "equity-reit",
  "bdc",
  "commodity-producer",
  "holding-nav",
  "discontinuous-history",
  "unknown",
] as const;
const STUDY_SIZE_STRATA = ["low", "mid", "high", "unknown"] as const;

const DESIGN_KEYS = [
  "schemaVersion",
  "designVersion",
  "contractAuthorityRegistryId",
  "acceptedContractIds",
  "algorithms",
  "metricDefinitions",
  "gateThresholds",
  "correctionPolicyId",
  "missingPolicyId",
  "outlierPolicyId",
  "multiplicityPolicyId",
  "sensitivityPolicyId",
  "boundsPolicyId",
  "analysisCodeDigest",
  "expectedStudyDesignId",
] as const;
const FRAME_KEYS = [
  "schemaVersion",
  "studyDesignId",
  "contractAuthorityRegistryId",
  "samplingFrameAsOfMs",
  "calendarSnapshotId",
  "scheduleSourcePolicyId",
  "frameConstructionCodeDigest",
  "configurationDigest",
  "preFrameEvidenceSnapshotId",
  "rankSeedMaterialId",
  "rankSeedHex",
  "seedCommittedAtMs",
  "frameConstructedAtMs",
  "candidates",
  "dispositions",
  "expectedFrameSnapshotId",
] as const;
const CANDIDATE_KEYS = [
  "scheduleSourceObservationId",
  "releaseClusterKey",
  "releaseKind",
  "clusterBasis",
  "scheduleSourceEvidence",
  "issuerMappingId",
  "instrumentId",
  "plannedFiscalPeriod",
  "plannedReleaseDate",
  "plannedSession",
  "frameFacts",
  "expectedClusterCandidateId",
] as const;
const EVIDENCE_KEYS = [
  "sourceFamily",
  "precedenceOrdinal",
  "scheduleSourceObservationId",
  "sourceRevisionId",
  "nativeScheduleIdHash",
  "crossSourceReleaseKeyHash",
  "durablyCapturedAtMs",
  "effectiveAtMs",
  "nativeRevisionSequence",
  "issuerMappingId",
  "releaseKind",
  "plannedFiscalPeriod",
  "plannedReleaseDate",
  "plannedSession",
] as const;
const CLUSTER_KEYS = [
  "clusterCandidateId",
  "frameSnapshotId",
  "lane",
  "controlGroup",
  "strata",
  "rank",
  "allocationCell",
  "selectionFraction",
  "expectedStudyClusterId",
] as const;
const MANIFEST_KEYS = [
  "schemaVersion",
  "studyDesignId",
  "codeCommit",
  "configurationDigest",
  "contractAuthorityRegistryId",
  "contractIds",
  "calendarSnapshotId",
  "entitlementSnapshotIds",
  "providerSourcePolicyId",
  "selectionPolicyId",
  "primaryAnchorKind",
  "alternateAnchorRequired",
  "readyAtMs",
  "samplingFrameAsOfMs",
  "freezePublishedAtMs",
  "collectionSessions",
  "correctionLagMs",
  "rankSeedMaterialId",
  "rankSeedHex",
  "frameSnapshotId",
  "selectedClusters",
  "expectedCounts",
  "expectedStudyManifestId",
] as const;
const DATASET_KEYS = [
  "schemaVersion",
  "studyManifestId",
  "freezeCutoffMs",
  "collectionCodeCommit",
  "collectionConfigurationDigest",
  "executionIds",
  "artifactInventoryDigest",
  "sourceObservationIds",
  "revisionIds",
  "marketReferenceJoinKeys",
  "referenceResultIds",
  "discrepancyIds",
  "metricRecordIds",
  "denominatorAccounting",
  "datasetFreezePolicyVersion",
  "expectedDatasetFreezeId",
] as const;
const FRAME_FACT_KEYS = [
  "subject",
  "shareClassSelection",
  "eventTMinusOneSnapshotPolicyId",
  "scheduleDisagreement",
  "identityTransitionKnown",
  "identityTransitionEvidenceObservationIds",
  "sicCode",
  "sicDivisionCode",
  "sicAuthorityObservationId",
  "sicMappingVersion",
  "sectorStratum",
  "marketCapEvidence",
  "marketCapStratum",
  "liquidityEvidence",
  "liquidityStratum",
  "modelFamily",
  "modelFamilyAuthority",
  "modelFamilyVersion",
  "modelFamilyEffectiveAtMs",
  "modelFamilyEvidenceObservationIds",
  "expectedSourceFamilies",
  "marketReferenceJoinPolicyId",
  "intervalKeys",
  "referenceKinds",
] as const;
const DENOMINATOR_KEYS = [
  "studyClusterId",
  "lane",
  "controlGroup",
  "sector",
  "marketCap",
  "liquidity",
  "plannedSession",
  "actualSession",
  "modelFamily",
  "releaseStatus",
  "primaryAnchorStatus",
  "eventTMinusOneSnapshotId",
  "providerComparison",
  "retrievalSensitivityStatus",
  "references",
  "metrics",
  "attrition",
  "annotations",
  "anchorTelemetry",
  "retrievalSensitivityReferences",
] as const;
const DATASET_EVIDENCE_KEYS = [
  "collectionConfigurationDigest",
  "artifactInventoryDigest",
  "datasetFreezePolicyVersion",
  "marketResults",
  "metricRecords",
  "clusterOutcomes",
] as const;
const DATASET_MARKET_RESULT_EVIDENCE_KEYS = [
  "studyClusterId",
  "endpointKind",
  "referenceKind",
  "viewKind",
  "resultId",
  "resultStatus",
  "asOfBasis",
  "preservedMissingReason",
  "diagnostics",
  "marketReferenceJoinKey",
  "sourceObservationIds",
  "revisionIds",
  "discrepancyIds",
  "executionIds",
  "correctedCutoffMs",
] as const;
const DATASET_METRIC_EVIDENCE_KEYS = ["metricRecordId", "studyClusterId", "metricId"] as const;
const DATASET_CLUSTER_OUTCOME_KEYS = [
  "studyClusterId",
  "actualSession",
  "releaseStatus",
  "primaryAnchorStatus",
  "eventTMinusOneSnapshotId",
  "providerComparison",
  "retrievalSensitivityStatus",
  "anchorTelemetry",
] as const;
const STUDY_ANCHOR_TELEMETRY_KEYS = [
  "captureBasis",
  "retrievalBasis",
  "captureMinusRetrievalMs",
  "latencyStudyReason",
] as const;

function invalid(message: string): never {
  throw new StudyContractError("study.input-invalid", message);
}

function bound(limitKind: string, message: string): never {
  throw new StudyContractError("study.bound-exceeded", message, { limitKind });
}

function enforceStudyBound(boundId: StudyBoundIdV1, observed: number | readonly number[]): void {
  const evaluation = evaluateStudyBound(boundId, observed);
  if (evaluation.accepted) return;
  if (evaluation.violation === "study.bound-exceeded") {
    bound(boundId, `${boundId} exceeds its canonical study boundary`);
  }
  invalid(`${boundId} violates its canonical study boundary: ${evaluation.violation}`);
}

function asRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${path} must be an exact object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    invalid(`${path} has missing or extra fields`);
  }
}

function assertSafeNonnegative(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${path} must be a non-negative safe integer`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) invalid(`${path} must be a nonempty string`);
}

function assertPattern(value: unknown, pattern: RegExp, path: string): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) invalid(`${path} has invalid grammar`);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function assertSortedUniqueStrings(
  values: unknown,
  path: string,
  maximum = 64,
  limitKind: string | null = null,
): string[] {
  if (!Array.isArray(values)) invalid(`${path} must be an array`);
  if (values.length > maximum) {
    if (limitKind === null) invalid(`${path} exceeds its semantic maximum of ${maximum}`);
    if (STUDY_BOUND_IDS.includes(limitKind as StudyBoundIdV1)) {
      enforceStudyBound(limitKind as StudyBoundIdV1, values.length);
    }
    bound(limitKind, `${path} exceeds ${maximum}`);
  }
  const strings = values.map((value, index) => {
    assertString(value, `${path}[${index}]`);
    return value;
  });
  for (let index = 1; index < strings.length; index += 1) {
    const prior = strings[index - 1] as string;
    const current = strings[index] as string;
    if (compareUtf8(prior, current) >= 0) invalid(`${path} must be UTF-8 sorted and unique`);
  }
  return strings;
}

function validatePreservedMarketReason(value: unknown, path: string): void {
  const record = asRecord(value, path);
  assertExactKeys(record, ["code", "disposition", "scope", "detail"], path);
  validateCanonicalMarketReason({ code: record["code"], detail: record["detail"] });
  if (
    !["rejected", "ineligible", "missing", "degraded", "annotation"].includes(
      record["disposition"] as string,
    ) ||
    typeof record["scope"] !== "string" ||
    record["scope"].length === 0
  ) {
    invalid(`${path} has invalid disposition or scope`);
  }
}

export function assertAcceptedContractAuthority(registryId: unknown, contractIds: unknown): void {
  if (registryId !== ACCEPTED_CONTRACT_AUTHORITY_REGISTRY_ID) {
    throw new StudyContractError("study.frame-not-frozen", "authority registry is not accepted", {
      frameFailureKind: "contract-unbound",
    });
  }
  if (
    !Array.isArray(contractIds) ||
    canonicalJson(contractIds as JsonValue) !== canonicalJson(STUDY_CONTRACT_AUTHORITY_IDS)
  ) {
    throw new StudyContractError("study.frame-not-frozen", "authority tuple is not exact", {
      frameFailureKind: "contract-unbound",
    });
  }
}

function assertExpectedId(actual: unknown, expected: string, path: string): void {
  if (actual !== expected) invalid(`${path} does not equal its recomputed identity`);
}

function assertExactFieldValues(
  record: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
  path: string,
): void {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (canonicalJson(record[key] as JsonValue) !== canonicalJson(expectedValue as JsonValue)) {
      invalid(`${path}.${key} is not the accepted contract value`);
    }
  }
}

function validateStudyMetricDefinition(value: unknown, index: number): string {
  const path = `design.metricDefinitions[${index}]`;
  const record = asRecord(value, path);
  assertString(record["metricId"], `${path}.metricId`);
  const id = record["metricId"];
  const readiness = READINESS_METRICS[id as keyof typeof READINESS_METRICS] as
    | Readonly<Record<string, unknown>>
    | undefined;
  if (readiness !== undefined) {
    assertExactKeys(record, PROPORTION_METRIC_KEYS, path);
    assertExactFieldValues(record, { metricId: id, ...readiness }, path);
    return id;
  }
  const formula = MOVEMENT_FORMULAS[id as keyof typeof MOVEMENT_FORMULAS] as string | undefined;
  if (formula === undefined) invalid(`${path}.metricId is not accepted`);
  assertExactKeys(record, MOVEMENT_METRIC_KEYS, path);
  assertExactFieldValues(
    record,
    {
      metricId: id,
      metricKind: "exact-rational-return-bps",
      priceBasis: "quote-nbbo-midpoint",
      viewKind: "recorded-primary",
      formulaId: formula,
      population: "available-case-with-fixed-180-missing-accounting",
      missingTreatment: "no-imputation",
      canonicalValue: "reduced-signed-rational",
      displayRounding: "half-even-6-decimals",
    },
    path,
  );
  return id;
}

function validateStudyGateThreshold(value: unknown, index: number): string {
  const path = `design.gateThresholds[${index}]`;
  const record = asRecord(value, path);
  assertString(record["metricId"], `${path}.metricId`);
  const id = record["metricId"];
  const expected = READINESS_GATES[id as keyof typeof READINESS_GATES] as
    | Readonly<Record<string, unknown>>
    | undefined;
  if (expected === undefined) invalid(`${path}.metricId is not accepted`);
  assertExactKeys(record, GATE_THRESHOLD_KEYS, path);
  assertExactFieldValues(record, { metricId: id, ...expected }, path);
  return id;
}

function validateStudyAlgorithms(value: unknown): void {
  const algorithms = asRecord(value, "design.algorithms");
  assertExactKeys(algorithms, STUDY_ALGORITHM_KEYS, "design.algorithms");
  const requiredAlgorithmConstants: Readonly<Record<string, unknown>> = {
    samplingAlgorithmId: "peas-study-sampling-v1",
    framePolicyId: "peas-study-frame-v1",
    scheduleSourcePolicyId: "peas-study-schedule-source-v1",
    releaseClusteringPolicyId: "peas-study-release-clustering-v1",
    shareClassPolicyId: "peas-study-share-class-v1",
    sectorRegistryId: "peas-study-sec-sic-divisions-v1",
    modelFamilyRegistryId: "peas-study-model-families-v1",
    lanePolicyId: "peas-study-lanes-v1",
    controlPolicyId: "peas-study-controls-v1",
    rankPolicyId: "peas-study-rank-v1",
    allocationPolicyId: "peas-study-capacity-hamilton-v1",
    studyReasonCatalogId: "study-reasons-v1",
    studyReasonCatalogDigest: ACCEPTED_REASON_CATALOG_DIGEST,
    marketReasonCatalogId: "market-reasons-v1",
    marketReasonCatalogDigest: ACCEPTED_REASON_CATALOG_DIGEST,
    primaryAnchorKind: "capture",
    primaryAnchorClaim: "operational-durable-peas-knowledge",
    mandatorySensitivityAnchorKind: "retrieval",
    selectorKind: "last-eligible-at-or-before-target",
    releaseOriginSelectorKind: "last-eligible-strictly-before-publication",
    targetOffsetsNs: ["0", "60000000000", "300000000000", "1800000000000"],
    referenceKinds: STUDY_REFERENCE_KINDS,
    viewKinds: STUDY_VIEW_KINDS,
    resultStatuses: STUDY_RESULT_STATUSES,
    quoteAgePolicyId: ACCEPTED_DESIGN_POLICY_IDS.quoteAgePolicyId,
    sessionPolicyId: ACCEPTED_DESIGN_POLICY_IDS.sessionPolicyId,
    providerPolicyContractId: ACCEPTED_DESIGN_POLICY_IDS.providerPolicyContractId,
    bootstrapPolicyId: "peas-study-lane-bootstrap-v1",
    holmPolicyId: "peas-study-holm-24-v1",
    gatePolicyId: "peas-study-gates-v1",
    targetClusters: STUDY_TARGET_CLUSTERS,
    laneTargets: { standard: 120, specialized: 40, prospectiveControl: 20 },
    controlTargets: {
      identityTransition: 5,
      scheduleUncertain: 5,
      sourceSparse: 5,
      liquidityTail: 5,
    },
  };
  assertExactFieldValues(algorithms, requiredAlgorithmConstants, "design.algorithms");
}

export function validateStudyDesign(value: unknown): Readonly<{
  studyDesignId: string;
  design: StudyDesignV1;
}> {
  assertJsonWithinLimits(value, { ...STUDY_JSON_LIMITS, maxCanonicalBytes: 33_554_432 }, "design");
  const record = asRecord(value, "design");
  assertExactKeys(record, DESIGN_KEYS, "design");
  if (record["schemaVersion"] !== 1) invalid("design.schemaVersion must be 1");
  assertAcceptedContractAuthority(
    record["contractAuthorityRegistryId"],
    record["acceptedContractIds"],
  );
  if (record["designVersion"] !== ACCEPTED_DESIGN_POLICY_IDS.designVersion) {
    invalid("design.designVersion is not accepted");
  }
  assertPattern(record["analysisCodeDigest"], HEX_64, "design.analysisCodeDigest");
  for (const key of [
    "correctionPolicyId",
    "missingPolicyId",
    "outlierPolicyId",
    "multiplicityPolicyId",
    "sensitivityPolicyId",
    "boundsPolicyId",
  ] as const) {
    if (record[key] !== ACCEPTED_DESIGN_POLICY_IDS[key]) {
      invalid(`design.${key} is not accepted`);
    }
  }
  if (!Array.isArray(record["metricDefinitions"]) || record["metricDefinitions"].length !== 9) {
    invalid("design.metricDefinitions must contain exactly nine rows");
  }
  const metricIds = record["metricDefinitions"].map((row, index) =>
    validateStudyMetricDefinition(row, index),
  );
  if (canonicalJson(metricIds) !== canonicalJson(STUDY_METRIC_IDS)) {
    invalid("design.metricDefinitions must contain the exact sorted nine-metric tuple");
  }
  if (!Array.isArray(record["gateThresholds"]) || record["gateThresholds"].length !== 4) {
    invalid("design.gateThresholds must contain exactly four rows");
  }
  const gateIds = record["gateThresholds"].map((row, index) =>
    validateStudyGateThreshold(row, index),
  );
  if (canonicalJson(gateIds) !== canonicalJson(STUDY_METRIC_IDS.slice(0, 4))) {
    invalid("design.gateThresholds must contain the exact sorted E1-E4 tuple");
  }
  validateStudyAlgorithms(record["algorithms"]);
  const design = value as StudyDesignV1;
  const studyDesignId = deriveStudyDesignId(design);
  assertExpectedId(design.expectedStudyDesignId, studyDesignId, "design.expectedStudyDesignId");
  return { studyDesignId, design };
}

function evidenceSortKey(evidence: StudyScheduleSourceEvidenceV1): string {
  return [
    evidence.precedenceOrdinal.toString(),
    evidence.scheduleSourceObservationId,
    evidence.nativeScheduleIdHash,
    evidence.releaseKind,
    evidence.plannedFiscalPeriod ?? "",
    evidence.plannedReleaseDate,
    evidence.plannedSession,
    evidence.crossSourceReleaseKeyHash ?? "",
    canonicalJson(evidence),
  ].join("\0");
}

function validateEvidence(
  value: unknown,
  candidate: StudyCandidateFrameEntryV1,
  path: string,
): StudyScheduleSourceEvidenceV1 {
  const record = asRecord(value, path);
  assertExactKeys(record, EVIDENCE_KEYS, path);
  const evidence = value as StudyScheduleSourceEvidenceV1;
  const ordinal: Readonly<Record<StudyScheduleSourceEvidenceV1["sourceFamily"], number>> = {
    "issuer-regulatory-filing": 0,
    "issuer-ir-calendar": 1,
    "exchange-calendar": 2,
    "approved-schedule-provider": 3,
  };
  if (ordinal[evidence.sourceFamily] !== evidence.precedenceOrdinal) {
    invalid(`${path} family/precedence mismatch`);
  }
  assertPattern(evidence.nativeScheduleIdHash, HEX_64, `${path}.nativeScheduleIdHash`);
  if (evidence.crossSourceReleaseKeyHash !== null) {
    assertPattern(evidence.crossSourceReleaseKeyHash, HEX_64, `${path}.crossSourceReleaseKeyHash`);
  }
  assertSafeNonnegative(evidence.durablyCapturedAtMs, `${path}.durablyCapturedAtMs`);
  if (evidence.effectiveAtMs !== null) {
    assertSafeNonnegative(evidence.effectiveAtMs, `${path}.effectiveAtMs`);
  }
  if (
    evidence.issuerMappingId !== candidate.issuerMappingId ||
    evidence.releaseKind !== candidate.releaseKind
  ) {
    invalid(`${path} does not match the candidate issuer/release kind`);
  }
  return evidence;
}

function validateFrameFacts(value: unknown, samplingFrameAsOfMs: number): void {
  const facts = asRecord(value, "candidate.frameFacts");
  assertExactKeys(facts, FRAME_FACT_KEYS, "candidate.frameFacts");
  assertString(facts["subject"], "candidate.frameFacts.subject");
  assertString(
    facts["eventTMinusOneSnapshotPolicyId"],
    "candidate.frameFacts.eventTMinusOneSnapshotPolicyId",
  );
  assertString(
    facts["marketReferenceJoinPolicyId"],
    "candidate.frameFacts.marketReferenceJoinPolicyId",
  );
  const disagreement = asRecord(
    facts["scheduleDisagreement"],
    "candidate.frameFacts.scheduleDisagreement",
  );
  assertExactKeys(disagreement, ["date", "session"], "candidate.frameFacts.scheduleDisagreement");
  if (typeof disagreement["date"] !== "boolean" || typeof disagreement["session"] !== "boolean") {
    invalid("candidate frame schedule disagreement flags must be boolean");
  }
  if (typeof facts["identityTransitionKnown"] !== "boolean") {
    invalid("candidate frame identityTransitionKnown must be boolean");
  }
  const transitionEvidence = assertSortedUniqueStrings(
    facts["identityTransitionEvidenceObservationIds"],
    "candidate.frameFacts.identityTransitionEvidenceObservationIds",
  );
  if (transitionEvidence.length > 0 !== facts["identityTransitionKnown"]) {
    invalid("candidate frame identity-transition evidence is inconsistent");
  }
  if (
    facts["sicCode"] !== null &&
    (typeof facts["sicCode"] !== "string" || !/^\d{4}$/u.test(facts["sicCode"]))
  ) {
    invalid("candidate frame SIC must be null or four ASCII digits");
  }
  if (facts["sicMappingVersion"] !== "sec-sic-division-v1") {
    invalid("candidate frame SIC mapping version is not accepted");
  }
  assertSafeNonnegative(
    facts["modelFamilyEffectiveAtMs"],
    "candidate.frameFacts.modelFamilyEffectiveAtMs",
  );
  if (facts["modelFamilyEffectiveAtMs"] > samplingFrameAsOfMs) {
    invalid("candidate model-family evidence is post-frame");
  }
  assertSortedUniqueStrings(
    facts["modelFamilyEvidenceObservationIds"],
    "candidate.frameFacts.modelFamilyEvidenceObservationIds",
  );
  assertSortedUniqueStrings(
    facts["expectedSourceFamilies"],
    "candidate.frameFacts.expectedSourceFamilies",
  );
  if (
    canonicalJson(facts["intervalKeys"] as JsonValue) !==
    canonicalJson(["Cprev", "Qpre", "Q0", "Q1", "Q5", "Q30"])
  ) {
    invalid("candidate frame interval keys are not exact");
  }
  if (
    canonicalJson(facts["referenceKinds"] as JsonValue) !==
    canonicalJson([
      "quote-nbbo-midpoint",
      "trade-last-eligible-consolidated",
      "bar-one-minute-completed-close",
      "prior-listing-official-close",
    ])
  ) {
    invalid("candidate frame reference kinds are not exact");
  }
  const shareClass = asRecord(
    facts["shareClassSelection"],
    "candidate.frameFacts.shareClassSelection",
  );
  assertExactKeys(
    shareClass,
    ["policyId", "candidates", "selectedInstrumentId"],
    "candidate.frameFacts.shareClassSelection",
  );
  if (
    shareClass["policyId"] !== "peas-study-share-class-v1" ||
    !Array.isArray(shareClass["candidates"]) ||
    shareClass["candidates"].length < 1
  ) {
    invalid("candidate share-class selection is invalid");
  }
  assertString(
    shareClass["selectedInstrumentId"],
    "candidate.frameFacts.shareClassSelection.selectedInstrumentId",
  );
  const shareCandidates = shareClass["candidates"].map((rawCandidate, index) => {
    const shareCandidate = asRecord(
      rawCandidate,
      `candidate.frameFacts.shareClassSelection.candidates[${index}]`,
    );
    assertExactKeys(
      shareCandidate,
      [
        "instrumentId",
        "securityKind",
        "usExchangeListed",
        "liquiditySessions",
        "validLiquiditySessionCount",
        "medianDollarVolume",
      ],
      `candidate.frameFacts.shareClassSelection.candidates[${index}]`,
    );
    assertPattern(
      shareCandidate["instrumentId"],
      /^min1_[0-9a-f]{64}$/u,
      "share-class instrument ID",
    );
    if (
      !["common-share", "supported-adr"].includes(shareCandidate["securityKind"] as string) ||
      shareCandidate["usExchangeListed"] !== true ||
      !Array.isArray(shareCandidate["liquiditySessions"]) ||
      shareCandidate["liquiditySessions"].length !== 20 ||
      !Number.isSafeInteger(shareCandidate["validLiquiditySessionCount"]) ||
      (shareCandidate["validLiquiditySessionCount"] as number) < 0 ||
      (shareCandidate["validLiquiditySessionCount"] as number) > 20
    ) {
      invalid("share-class candidate evidence is invalid");
    }
    const median =
      shareCandidate["medianDollarVolume"] === null
        ? null
        : rationalEvidence(
            shareCandidate["medianDollarVolume"],
            "shareClassCandidate.medianDollarVolume",
          );
    if ((shareCandidate["validLiquiditySessionCount"] as number) < 15 !== (median === null)) {
      invalid("share-class candidate liquidity threshold is inconsistent");
    }
    return { record: shareCandidate, median };
  });
  const sortedShareCandidates = [...shareCandidates].sort((left, right) => {
    if (left.median === null && right.median !== null) return 1;
    if (left.median !== null && right.median === null) return -1;
    if (left.median !== null && right.median !== null) {
      const comparison = compareEvidenceRational(right.median, left.median);
      if (comparison !== 0) return comparison;
    }
    return compareUtf8(
      left.record["instrumentId"] as string,
      right.record["instrumentId"] as string,
    );
  });
  if (sortedShareCandidates[0]?.record["instrumentId"] !== shareClass["selectedInstrumentId"]) {
    invalid("share-class selected instrument does not recompute");
  }
  const marketCap = asRecord(facts["marketCapEvidence"], "candidate.frameFacts.marketCapEvidence");
  assertExactKeys(
    marketCap,
    [
      "policyId",
      "asOfSession",
      "asOfNs",
      "priceReferenceKind",
      "priceViewKind",
      "priceMarketResultId",
      "priceResultStatus",
      "price",
      "sharesOutstanding",
      "sharesValueDate",
      "sharesEffectiveAtNs",
      "sharesSourceObservationId",
      "sharesAuthorityVersion",
      "sharesDurablyCapturedAtMs",
      "marketCap",
      "unknownKind",
      "stratum",
      "comparisonRank",
      "comparisonPopulationSize",
    ],
    "candidate.frameFacts.marketCapEvidence",
  );
  if (
    marketCap["policyId"] !== "peas-study-market-cap-v1" ||
    marketCap["priceReferenceKind"] !== "prior-listing-official-close" ||
    marketCap["priceViewKind"] !== "recorded-primary" ||
    facts["marketCapStratum"] !== marketCap["stratum"]
  ) {
    invalid("candidate market-cap evidence policy/stratum mismatch");
  }
  if (
    (marketCap["priceResultStatus"] === "missing" &&
      (typeof marketCap["priceMarketResultId"] !== "string" ||
        !/^mmr1_[0-9a-f]{64}$/u.test(marketCap["priceMarketResultId"]))) ||
    (["selected-complete", "selected-degraded"].includes(
      marketCap["priceResultStatus"] as string,
    ) &&
      (typeof marketCap["priceMarketResultId"] !== "string" ||
        !/^msr1_[0-9a-f]{64}$/u.test(marketCap["priceMarketResultId"])))
  ) {
    invalid("market-cap price result ID/status mismatch");
  }
  if (marketCap["marketCap"] === null) {
    if (
      marketCap["unknownKind"] === null ||
      marketCap["stratum"] !== "unknown" ||
      marketCap["comparisonRank"] !== null
    ) {
      invalid("unknown market-cap evidence nullability is inconsistent");
    }
  } else {
    const suppliedMarketCap = rationalEvidence(
      marketCap["marketCap"],
      "candidate.frameFacts.marketCapEvidence.marketCap",
    );
    if (
      marketCap["unknownKind"] !== null ||
      marketCap["price"] === null ||
      marketCap["sharesOutstanding"] === null ||
      marketCap["sharesValueDate"] === null ||
      marketCap["sharesEffectiveAtNs"] === null ||
      marketCap["sharesSourceObservationId"] === null ||
      marketCap["sharesAuthorityVersion"] === null ||
      marketCap["sharesDurablyCapturedAtMs"] === null ||
      !["selected-complete", "selected-degraded"].includes(marketCap["priceResultStatus"] as string)
    ) {
      invalid("known market-cap evidence is incomplete");
    }
    const price = decimalEvidence(
      marketCap["price"],
      "candidate.frameFacts.marketCapEvidence.price",
    );
    const shares = decimalEvidence(
      marketCap["sharesOutstanding"],
      "candidate.frameFacts.marketCapEvidence.sharesOutstanding",
    );
    if (
      typeof marketCap["sharesEffectiveAtNs"] !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(marketCap["sharesEffectiveAtNs"]) ||
      BigInt(marketCap["sharesEffectiveAtNs"]) > BigInt(samplingFrameAsOfMs) * 1_000_000n
    ) {
      invalid("market-cap shares effective time is invalid or post-frame");
    }
    const expectedMarketCap: readonly [bigint, bigint] = [
      price[0] * shares[0],
      price[1] * shares[1],
    ];
    if (compareEvidenceRational(suppliedMarketCap, expectedMarketCap) !== 0) {
      invalid("market cap does not equal exact price times shares");
    }
  }
  if (
    marketCap["sharesDurablyCapturedAtMs"] !== null &&
    (typeof marketCap["sharesDurablyCapturedAtMs"] !== "number" ||
      marketCap["sharesDurablyCapturedAtMs"] > samplingFrameAsOfMs)
  ) {
    invalid("market-cap shares evidence is post-frame");
  }
  assertSafeNonnegative(
    marketCap["comparisonPopulationSize"],
    "candidate.frameFacts.marketCapEvidence.comparisonPopulationSize",
  );
  const liquidity = asRecord(facts["liquidityEvidence"], "candidate.frameFacts.liquidityEvidence");
  assertExactKeys(
    liquidity,
    [
      "policyId",
      "asOfSession",
      "sessions",
      "validSessionCount",
      "medianDollarVolume",
      "stratum",
      "comparisonRank",
      "comparisonPopulationSize",
      "tailRank",
      "tailPopulationSize",
      "tailEligible",
    ],
    "candidate.frameFacts.liquidityEvidence",
  );
  if (
    liquidity["policyId"] !== "peas-study-liquidity-20-session-median-v1" ||
    !Array.isArray(liquidity["sessions"]) ||
    liquidity["sessions"].length !== 20 ||
    facts["liquidityStratum"] !== liquidity["stratum"]
  ) {
    invalid("candidate liquidity evidence policy/session count/stratum is invalid");
  }
  const sessionIds = new Set<string>();
  let recomputedValid = 0;
  const validDollarVolumes: (readonly [bigint, bigint])[] = [];
  for (const [index, rawSession] of liquidity["sessions"].entries()) {
    const session = asRecord(
      rawSession,
      `candidate.frameFacts.liquidityEvidence.sessions[${index}]`,
    );
    assertExactKeys(
      session,
      [
        "sessionId",
        "sessionCloseNs",
        "closeMarketResultId",
        "closeResultStatus",
        "closePrice",
        "regularSessionVolume",
        "volumeFactId",
        "volumeSourceObservationId",
        "volumeAuthorityVersion",
        "dollarVolume",
        "status",
        "missingKind",
      ],
      `candidate.frameFacts.liquidityEvidence.sessions[${index}]`,
    );
    assertString(session["sessionId"], "liquidity session ID");
    if (
      typeof session["sessionCloseNs"] !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(session["sessionCloseNs"]) ||
      BigInt(session["sessionCloseNs"]) > BigInt(samplingFrameAsOfMs) * 1_000_000n
    ) {
      invalid("liquidity session close is invalid or post-frame");
    }
    if (sessionIds.has(session["sessionId"])) invalid("liquidity sessions must be unique");
    sessionIds.add(session["sessionId"]);
    if (session["status"] === "valid") {
      recomputedValid += 1;
      if (
        session["missingKind"] !== null ||
        session["dollarVolume"] === null ||
        session["closePrice"] === null ||
        session["regularSessionVolume"] === null ||
        session["volumeAuthorityVersion"] !== "consolidated-regular-session-volume-v1"
      ) {
        invalid("valid liquidity session evidence is incomplete");
      }
      const close = decimalEvidence(session["closePrice"], "liquidity.closePrice");
      const volume = decimalEvidence(session["regularSessionVolume"], "liquidity.volume");
      const supplied = rationalEvidence(session["dollarVolume"], "liquidity.dollarVolume");
      const expected: readonly [bigint, bigint] = [close[0] * volume[0], close[1] * volume[1]];
      if (compareEvidenceRational(supplied, expected) !== 0) {
        invalid("liquidity dollar volume does not equal exact close times volume");
      }
      validDollarVolumes.push(supplied);
    } else if (session["status"] === "missing") {
      if (session["missingKind"] === null || session["dollarVolume"] !== null) {
        invalid("missing liquidity session evidence is inconsistent");
      }
    } else {
      invalid("liquidity session status is invalid");
    }
  }
  assertSafeNonnegative(
    liquidity["validSessionCount"],
    "candidate.frameFacts.liquidityEvidence.validSessionCount",
  );
  if (liquidity["validSessionCount"] !== recomputedValid) {
    invalid("liquidity valid session count does not recompute");
  }
  if (
    (recomputedValid < 15 &&
      (liquidity["medianDollarVolume"] !== null ||
        liquidity["stratum"] !== "unknown" ||
        liquidity["comparisonRank"] !== null)) ||
    (recomputedValid >= 15 && liquidity["medianDollarVolume"] === null)
  ) {
    invalid("liquidity 14/15-session threshold is inconsistent");
  }
  if (liquidity["medianDollarVolume"] !== null) {
    const suppliedMedian = rationalEvidence(
      liquidity["medianDollarVolume"],
      "candidate.frameFacts.liquidityEvidence.medianDollarVolume",
    );
    const sorted = validDollarVolumes.sort(compareEvidenceRational);
    const middle = Math.floor(sorted.length / 2);
    const expectedMedian =
      sorted.length % 2 === 1
        ? (sorted[middle] as readonly [bigint, bigint])
        : ([
            (sorted[middle - 1] as readonly [bigint, bigint])[0] *
              (sorted[middle] as readonly [bigint, bigint])[1] +
              (sorted[middle] as readonly [bigint, bigint])[0] *
                (sorted[middle - 1] as readonly [bigint, bigint])[1],
            2n *
              (sorted[middle - 1] as readonly [bigint, bigint])[1] *
              (sorted[middle] as readonly [bigint, bigint])[1],
          ] as const);
    if (compareEvidenceRational(suppliedMedian, expectedMedian) !== 0) {
      invalid("liquidity median does not recompute from 20-session evidence");
    }
  }
}

function rationalEvidence(value: unknown, path: string): readonly [bigint, bigint] {
  const record = asRecord(value, path);
  assertExactKeys(record, ["numerator", "denominator"], path);
  if (
    typeof record["numerator"] !== "string" ||
    typeof record["denominator"] !== "string" ||
    !/^(?:0|[1-9]\d*)$/u.test(record["numerator"]) ||
    !/^[1-9]\d*$/u.test(record["denominator"])
  ) {
    invalid(`${path} must be a canonical non-negative rational`);
  }
  const numerator = BigInt(record["numerator"]);
  const denominator = BigInt(record["denominator"]);
  return [numerator, denominator];
}

function decimalEvidence(value: unknown, path: string): readonly [bigint, bigint] {
  const record = asRecord(value, path);
  assertExactKeys(record, ["coefficient", "scale", "negative"], path);
  if (
    typeof record["coefficient"] !== "string" ||
    !/^[1-9]\d*$/u.test(record["coefficient"]) ||
    typeof record["scale"] !== "number" ||
    !Number.isSafeInteger(record["scale"]) ||
    record["scale"] < 0 ||
    record["negative"] !== false
  ) {
    invalid(`${path} must be a positive canonical decimal`);
  }
  return [BigInt(record["coefficient"]), 10n ** BigInt(record["scale"])];
}

function compareEvidenceRational(
  left: readonly [bigint, bigint],
  right: readonly [bigint, bigint],
): number {
  const difference = left[0] * right[1] - right[0] * left[1];
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function validateGlobalStrata(candidates: readonly StudyCandidateFrameEntryV1[]): void {
  for (const dimension of ["marketCap", "liquidity"] as const) {
    const known = candidates
      .map((candidate) => {
        const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
        const evidence = asRecord(
          facts[dimension === "marketCap" ? "marketCapEvidence" : "liquidityEvidence"],
          `${dimension}Evidence`,
        );
        const value =
          dimension === "marketCap" ? evidence["marketCap"] : evidence["medianDollarVolume"];
        return value === null
          ? null
          : {
              candidate,
              evidence,
              value: rationalEvidence(value, `${dimension}Evidence.value`),
            };
      })
      .filter((row) => row !== null)
      .sort(
        (left, right) =>
          compareEvidenceRational(left.value, right.value) ||
          compareUtf8(left.candidate.instrumentId, right.candidate.instrumentId) ||
          compareUtf8(
            left.candidate.expectedClusterCandidateId,
            right.candidate.expectedClusterCandidateId,
          ),
      );
    for (const candidate of candidates) {
      const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
      const evidence = asRecord(
        facts[dimension === "marketCap" ? "marketCapEvidence" : "liquidityEvidence"],
        `${dimension}Evidence`,
      );
      if (evidence["comparisonPopulationSize"] !== known.length) {
        invalid(`${dimension} comparison population size does not recompute`);
      }
    }
    for (const [rank, row] of known.entries()) {
      const expected = (["low", "mid", "high"] as const)[
        Math.min(2, Math.floor((3 * rank) / known.length))
      ];
      if (row.evidence["comparisonRank"] !== rank || row.evidence["stratum"] !== expected) {
        invalid(`${dimension} global tertile rank/label does not recompute`);
      }
    }
  }
  const tailPopulation = candidates
    .filter((candidate) => {
      const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
      const disagreement = asRecord(facts["scheduleDisagreement"], "scheduleDisagreement");
      return !(
        facts["identityTransitionKnown"] === true ||
        candidate.plannedSession === "unknown" ||
        disagreement["date"] === true ||
        disagreement["session"] === true ||
        (Array.isArray(facts["expectedSourceFamilies"]) &&
          facts["expectedSourceFamilies"].length <= 1)
      );
    })
    .map((candidate) => {
      const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
      const evidence = asRecord(facts["liquidityEvidence"], "liquidityEvidence");
      return evidence["medianDollarVolume"] === null
        ? null
        : {
            candidate,
            evidence,
            value: rationalEvidence(evidence["medianDollarVolume"], "liquidity median"),
          };
    })
    .filter((row) => row !== null)
    .sort(
      (left, right) =>
        compareEvidenceRational(left.value, right.value) ||
        compareUtf8(left.candidate.instrumentId, right.candidate.instrumentId) ||
        compareUtf8(
          left.candidate.expectedClusterCandidateId,
          right.candidate.expectedClusterCandidateId,
        ),
    );
  for (const candidate of candidates) {
    const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
    const evidence = asRecord(facts["liquidityEvidence"], "liquidityEvidence");
    const isEarlierControl =
      facts["identityTransitionKnown"] === true ||
      candidate.plannedSession === "unknown" ||
      asRecord(facts["scheduleDisagreement"], "scheduleDisagreement")["date"] === true ||
      asRecord(facts["scheduleDisagreement"], "scheduleDisagreement")["session"] === true ||
      (Array.isArray(facts["expectedSourceFamilies"]) &&
        facts["expectedSourceFamilies"].length <= 1);
    if (isEarlierControl) {
      if (
        evidence["tailRank"] !== null ||
        evidence["tailPopulationSize"] !== null ||
        evidence["tailEligible"] !== false
      ) {
        invalid("earlier-control candidate cannot carry liquidity-tail rank");
      }
      continue;
    }
    if (evidence["medianDollarVolume"] === null) {
      if (
        evidence["tailRank"] !== null ||
        evidence["tailPopulationSize"] !== tailPopulation.length ||
        evidence["tailEligible"] !== false
      ) {
        invalid("unknown-liquidity tail evidence is inconsistent");
      }
    }
  }
  for (const [rank, row] of tailPopulation.entries()) {
    const expectedEligible = Math.floor((10 * rank) / tailPopulation.length) === 0;
    if (
      row.evidence["tailRank"] !== rank ||
      row.evidence["tailPopulationSize"] !== tailPopulation.length ||
      row.evidence["tailEligible"] !== expectedEligible
    ) {
      invalid("liquidity-tail rank/eligibility does not recompute");
    }
  }
}

function chooseRepresentative(
  evidence: readonly StudyScheduleSourceEvidenceV1[],
): StudyScheduleSourceEvidenceV1 {
  const sorted = [...evidence].sort((left, right) => {
    if (left.precedenceOrdinal !== right.precedenceOrdinal) {
      return left.precedenceOrdinal - right.precedenceOrdinal;
    }
    const effective =
      (right.effectiveAtMs ?? Number.MIN_SAFE_INTEGER) -
      (left.effectiveAtMs ?? Number.MIN_SAFE_INTEGER);
    if (effective !== 0) return effective;
    if (left.durablyCapturedAtMs !== right.durablyCapturedAtMs) {
      return right.durablyCapturedAtMs - left.durablyCapturedAtMs;
    }
    return compareUtf8(evidenceSortKey(left), evidenceSortKey(right));
  });
  const representative = sorted[0];
  if (representative === undefined) invalid("candidate schedule evidence cannot be empty");
  return representative;
}

export function validateStudyClusterCandidate(
  value: unknown,
  samplingFrameAsOfMs = Number.MAX_SAFE_INTEGER,
): Readonly<{ clusterCandidateId: string; candidate: StudyCandidateFrameEntryV1 }> {
  assertJsonWithinLimits(
    value,
    { ...STUDY_JSON_LIMITS, maxArrayLength: 256, maxCanonicalBytes: 65_536 },
    "candidate",
  );
  const record = asRecord(value, "candidate");
  assertExactKeys(record, CANDIDATE_KEYS, "candidate");
  const candidate = value as StudyCandidateFrameEntryV1;
  assertPattern(candidate.issuerMappingId, /^imap1_[0-9a-f]{64}$/u, "candidate.issuerMappingId");
  assertPattern(candidate.instrumentId, /^min1_[0-9a-f]{64}$/u, "candidate.instrumentId");
  assertPattern(candidate.releaseClusterKey, HEX_64, "candidate.releaseClusterKey");
  assertPattern(candidate.plannedReleaseDate, ISO_DATE, "candidate.plannedReleaseDate");
  if (!["quarterly", "annual"].includes(candidate.releaseKind)) {
    invalid("candidate.releaseKind is invalid");
  }
  if (
    !Array.isArray(candidate.scheduleSourceEvidence) ||
    candidate.scheduleSourceEvidence.length < 1
  ) {
    invalid("candidate.scheduleSourceEvidence must be nonempty");
  }
  const evidence = candidate.scheduleSourceEvidence.map((row, index) =>
    validateEvidence(row, candidate, `candidate.scheduleSourceEvidence[${index}]`),
  );
  for (const row of evidence) {
    if (row.durablyCapturedAtMs > samplingFrameAsOfMs) {
      invalid("candidate evidence was durably captured after frame time");
    }
  }
  for (let index = 1; index < evidence.length; index += 1) {
    if (
      compareUtf8(
        evidenceSortKey(evidence[index - 1] as StudyScheduleSourceEvidenceV1),
        evidenceSortKey(evidence[index] as StudyScheduleSourceEvidenceV1),
      ) >= 0
    ) {
      invalid("candidate schedule evidence must be canonically sorted and unique");
    }
  }
  const basis = asRecord(candidate.clusterBasis, "candidate.clusterBasis");
  if (candidate.clusterBasis.kind === "fiscal-period") {
    const clusterBasis = candidate.clusterBasis;
    assertExactKeys(basis, ["kind", "plannedFiscalPeriod"], "candidate.clusterBasis");
    const grammar = candidate.releaseKind === "annual" ? /^\d{4}-FY$/u : /^\d{4}-Q[1-4]$/u;
    if (
      candidate.plannedFiscalPeriod !== clusterBasis.plannedFiscalPeriod ||
      !grammar.test(clusterBasis.plannedFiscalPeriod) ||
      evidence.some((row) => row.plannedFiscalPeriod !== clusterBasis.plannedFiscalPeriod)
    ) {
      invalid("candidate fiscal-period basis/evidence mismatch");
    }
  } else if (candidate.clusterBasis.kind === "cross-source") {
    const clusterBasis = candidate.clusterBasis;
    assertExactKeys(basis, ["kind", "crossSourceReleaseKeyHash"], "candidate.clusterBasis");
    assertPattern(
      clusterBasis.crossSourceReleaseKeyHash,
      HEX_64,
      "candidate.clusterBasis.crossSourceReleaseKeyHash",
    );
    if (
      candidate.plannedFiscalPeriod !== null ||
      evidence.some(
        (row) =>
          row.plannedFiscalPeriod !== null ||
          row.crossSourceReleaseKeyHash !== clusterBasis.crossSourceReleaseKeyHash,
      )
    ) {
      invalid("candidate cross-source basis/evidence mismatch");
    }
  } else if (candidate.clusterBasis.kind === "native-date") {
    const clusterBasis = candidate.clusterBasis;
    assertExactKeys(
      basis,
      ["kind", "plannedReleaseDate", "nativeScheduleIdHash"],
      "candidate.clusterBasis",
    );
    assertPattern(
      clusterBasis.nativeScheduleIdHash,
      HEX_64,
      "candidate.clusterBasis.nativeScheduleIdHash",
    );
    if (
      candidate.plannedFiscalPeriod !== null ||
      candidate.plannedReleaseDate !== clusterBasis.plannedReleaseDate ||
      evidence.some(
        (row) =>
          row.plannedFiscalPeriod !== null ||
          row.crossSourceReleaseKeyHash !== null ||
          row.plannedReleaseDate !== clusterBasis.plannedReleaseDate ||
          row.nativeScheduleIdHash !== clusterBasis.nativeScheduleIdHash,
      )
    ) {
      invalid("candidate native-date basis/evidence mismatch");
    }
  } else {
    invalid("candidate.clusterBasis kind is invalid");
  }
  const representative = chooseRepresentative(evidence);
  for (const key of [
    "scheduleSourceObservationId",
    "issuerMappingId",
    "releaseKind",
    "plannedFiscalPeriod",
    "plannedReleaseDate",
    "plannedSession",
  ] as const) {
    if (candidate[key] !== representative[key]) {
      invalid(`candidate.${key} does not match its representative evidence`);
    }
  }
  const releaseClusterKey = deriveReleaseClusterKey(
    candidate.issuerMappingId,
    candidate.releaseKind,
    candidate.clusterBasis,
  );
  if (releaseClusterKey !== candidate.releaseClusterKey) {
    invalid("candidate.releaseClusterKey is stale or forged");
  }
  const identityPreimage: StudyClusterCandidateV1 = {
    scheduleSourceObservationId: candidate.scheduleSourceObservationId,
    issuerMappingId: candidate.issuerMappingId,
    instrumentId: candidate.instrumentId,
    releaseKind: candidate.releaseKind,
    releaseClusterKey: candidate.releaseClusterKey,
    plannedFiscalPeriod: candidate.plannedFiscalPeriod,
    plannedReleaseDate: candidate.plannedReleaseDate,
    plannedSession: candidate.plannedSession,
  };
  const clusterCandidateId = deriveStudyClusterCandidateId(identityPreimage);
  assertExpectedId(
    candidate.expectedClusterCandidateId,
    clusterCandidateId,
    "candidate.expectedClusterCandidateId",
  );
  validateFrameFacts(candidate.frameFacts, samplingFrameAsOfMs);
  return { clusterCandidateId, candidate };
}

export function validateStudyFrameSnapshot(
  value: unknown,
  expectedStudyDesignId: string,
): Readonly<{ frameSnapshotId: string; frame: StudyFrameSnapshotV1 }> {
  assertJsonWithinLimits(
    value,
    {
      ...STUDY_JSON_LIMITS,
      maxNodes: 5_000_000,
      maxCanonicalBytes: 67_108_864,
    },
    "frame-preflight",
  );
  const preflight = asRecord(value, "frame-preflight");
  if (
    Array.isArray(preflight["candidates"]) &&
    preflight["candidates"].length > STUDY_FRAME_CANDIDATE_LIMIT
  ) {
    enforceStudyBound("candidateFrameMembers", preflight["candidates"].length);
    bound("candidateFrameMembers", "frame has more than 8192 candidates");
  }
  assertJsonWithinLimits(value, { ...STUDY_JSON_LIMITS, maxCanonicalBytes: 33_554_432 }, "frame");
  const record = asRecord(value, "frame");
  assertExactKeys(record, FRAME_KEYS, "frame");
  const frame = value as StudyFrameSnapshotV1;
  if (frame.schemaVersion !== 1 || frame.studyDesignId !== expectedStudyDesignId) {
    invalid("frame schema or study design identity mismatch");
  }
  if (frame.contractAuthorityRegistryId !== ACCEPTED_CONTRACT_AUTHORITY_REGISTRY_ID) {
    throw new StudyContractError(
      "study.frame-not-frozen",
      "frame authority registry is not accepted",
      { frameFailureKind: "contract-unbound" },
    );
  }
  if (frame.scheduleSourcePolicyId !== "peas-study-schedule-source-v1") {
    invalid("frame schedule source policy is not accepted");
  }
  assertSafeNonnegative(frame.samplingFrameAsOfMs, "frame.samplingFrameAsOfMs");
  assertSafeNonnegative(frame.seedCommittedAtMs, "frame.seedCommittedAtMs");
  assertSafeNonnegative(frame.frameConstructedAtMs, "frame.frameConstructedAtMs");
  if (
    frame.seedCommittedAtMs < frame.samplingFrameAsOfMs ||
    frame.seedCommittedAtMs >= frame.frameConstructedAtMs
  ) {
    throw new StudyContractError("study.rank-invalid", "rank seed timing is invalid", {
      rankFailureKind: "seed",
    });
  }
  assertPattern(frame.rankSeedHex, HEX_64, "frame.rankSeedHex");
  if (deriveRankSeedHex(frame.rankSeedMaterialId) !== frame.rankSeedHex) {
    throw new StudyContractError("study.rank-invalid", "rank seed does not match material", {
      rankFailureKind: "seed",
    });
  }
  if (frame.candidates.length > STUDY_FRAME_CANDIDATE_LIMIT) {
    enforceStudyBound("candidateFrameMembers", frame.candidates.length);
    bound("candidateFrameMembers", "frame has more than 8192 candidates");
  }
  const candidateIds = frame.candidates.map(
    (candidate) =>
      validateStudyClusterCandidate(candidate, frame.samplingFrameAsOfMs).clusterCandidateId,
  );
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new StudyContractError("study.duplicate-cluster", "duplicate candidate identity", {
      duplicateFailureKind: "duplicate-identity",
    });
  }
  validateGlobalStrata(frame.candidates);
  if (frame.dispositions.length > STUDY_FRAME_CELL_LIMIT) {
    enforceStudyBound("frameDispositionOrStratumCells", frame.dispositions.length);
    bound("frameDispositionOrStratumCells", "frame has more than 2048 disposition rows");
  }
  for (const disposition of frame.dispositions) {
    if (disposition.count !== disposition.members.length) {
      invalid("frame disposition count does not equal members");
    }
  }
  const frameSnapshotId = deriveStudyFrameSnapshotId(frame);
  assertExpectedId(frame.expectedFrameSnapshotId, frameSnapshotId, "frame.expectedFrameSnapshotId");
  return { frameSnapshotId, frame };
}

export function validateStudyClusterSelection(
  value: unknown,
  frameSnapshotId: string,
  candidateIds?: ReadonlySet<string>,
): Readonly<{ studyClusterId: string; cluster: StudyClusterSelectionV1 }> {
  const record = asRecord(value, "cluster");
  assertExactKeys(record, CLUSTER_KEYS, "cluster");
  const cluster = value as StudyClusterSelectionV1;
  assertPattern(cluster.clusterCandidateId, CANDIDATE_ID, "cluster.clusterCandidateId");
  if (candidateIds !== undefined && !candidateIds.has(cluster.clusterCandidateId)) {
    invalid("cluster candidate is absent from the frame");
  }
  if (cluster.frameSnapshotId !== frameSnapshotId) invalid("cluster frame identity mismatch");
  if (!STUDY_LANES.includes(cluster.lane as never)) invalid("cluster lane is invalid");
  if (cluster.controlGroup !== null && !STUDY_CONTROLS.includes(cluster.controlGroup as never)) {
    invalid("cluster control group is invalid");
  }
  if ((cluster.lane === "prospective-control") !== (cluster.controlGroup !== null)) {
    invalid("cluster lane/control nullability is invalid");
  }
  assertPattern(cluster.rank, HEX_64, "cluster.rank");
  const strata = asRecord(cluster.strata, "cluster.strata");
  assertExactKeys(
    strata,
    ["sector", "marketCap", "liquidity", "plannedSession", "modelFamily"],
    "cluster.strata",
  );
  if (
    !STUDY_SECTORS.includes(cluster.strata.sector as never) ||
    !STUDY_SIZE_STRATA.includes(cluster.strata.marketCap as never) ||
    !STUDY_SIZE_STRATA.includes(cluster.strata.liquidity as never) ||
    !STUDY_SESSIONS.includes(cluster.strata.plannedSession as never) ||
    !STUDY_MODEL_FAMILIES.includes(cluster.strata.modelFamily as never)
  ) {
    invalid("cluster strata contain an unknown semantic value");
  }
  const allocationCell = asRecord(cluster.allocationCell, "cluster.allocationCell");
  assertExactKeys(
    allocationCell,
    ["allocationCellId", "cellFrameCount", "cellSelectedCount"],
    "cluster.allocationCell",
  );
  assertString(cluster.allocationCell.allocationCellId, "cluster.allocationCell.allocationCellId");
  const selectionFraction = asRecord(cluster.selectionFraction, "cluster.selectionFraction");
  assertExactKeys(selectionFraction, ["numerator", "denominator"], "cluster.selectionFraction");
  assertSafeNonnegative(cluster.allocationCell.cellFrameCount, "cluster.cellFrameCount");
  assertSafeNonnegative(cluster.allocationCell.cellSelectedCount, "cluster.cellSelectedCount");
  if (
    cluster.allocationCell.cellFrameCount < 1 ||
    cluster.allocationCell.cellSelectedCount < 1 ||
    cluster.allocationCell.cellSelectedCount > cluster.allocationCell.cellFrameCount
  ) {
    invalid("cluster allocation cell counts are invalid");
  }
  if (
    typeof cluster.selectionFraction.numerator !== "string" ||
    !/^(?:0|[1-9]\d*)$/u.test(cluster.selectionFraction.numerator) ||
    typeof cluster.selectionFraction.denominator !== "string" ||
    !/^[1-9]\d*$/u.test(cluster.selectionFraction.denominator)
  ) {
    invalid("cluster selection fraction grammar is invalid");
  }
  const numerator = BigInt(cluster.selectionFraction.numerator);
  const denominator = BigInt(cluster.selectionFraction.denominator);
  if (
    numerator !== BigInt(cluster.allocationCell.cellSelectedCount) ||
    denominator !== BigInt(cluster.allocationCell.cellFrameCount)
  ) {
    invalid("cluster selection fraction does not match allocation cell counts");
  }
  const studyClusterId = deriveStudyClusterId(cluster);
  assertExpectedId(
    cluster.expectedStudyClusterId,
    studyClusterId,
    "cluster.expectedStudyClusterId",
  );
  return { studyClusterId, cluster };
}

function requireRunGate(prerequisites: StudyRunPrerequisitesV1): void {
  if (!prerequisites.p109EntitlementGo) {
    throw new StudyContractError(
      "study.primary-provider-unfrozen",
      "P1-09 is not independently GO",
      { providerFreezeKind: "provider" },
    );
  }
  const freezes = [
    ["provider", prerequisites.providerFrozen],
    ["dataset", prerequisites.datasetFrozen],
    ["feed", prerequisites.feedFrozen],
    ["endpoint", prerequisites.endpointFrozen],
    ["entitlement", prerequisites.entitlementFrozen],
    ["fallback", prerequisites.fallbackFrozen],
  ] as const;
  for (const [kind, frozen] of freezes) {
    if (!frozen) {
      throw new StudyContractError("study.primary-provider-unfrozen", `${kind} is not frozen`, {
        providerFreezeKind: kind,
      });
    }
  }
  if (
    !prerequisites.p108ImplementationGo ||
    !prerequisites.p110AcquisitionGo ||
    !prerequisites.p106EvidenceCaptureGo
  ) {
    invalid("all pre-run roadmap gates must be independently GO");
  }
  if (!prerequisites.zeroIncrementalSpend) invalid("run must enforce zero incremental spend");
}

export function classifyProspectiveControl(
  candidate: StudyCandidateFrameEntryV1,
): Exclude<StudyClusterSelectionV1["controlGroup"], null> | null {
  const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
  if (facts["identityTransitionKnown"] === true) return "identity-transition";
  const disagreement = asRecord(facts["scheduleDisagreement"], "scheduleDisagreement");
  if (
    candidate.plannedSession === "unknown" ||
    disagreement["date"] === true ||
    disagreement["session"] === true
  ) {
    return "schedule-uncertain";
  }
  if (
    Array.isArray(facts["expectedSourceFamilies"]) &&
    facts["expectedSourceFamilies"].length <= 1
  ) {
    return "source-sparse";
  }
  const liquidity = asRecord(facts["liquidityEvidence"], "liquidityEvidence");
  return liquidity["tailEligible"] === true ? "liquidity-tail" : null;
}

function validateManifestSampling(
  manifest: StudyFreezeManifestV1,
  frame: StudyFrameSnapshotV1,
): void {
  const candidateById = new Map(
    frame.candidates.map((candidate) => [candidate.expectedClusterCandidateId, candidate]),
  );
  const ranked = frame.candidates
    .map((candidate) => ({
      candidate,
      rank: deriveStudyRankDigest(frame.rankSeedHex, candidate.expectedClusterCandidateId),
      eligibility: classifyProspectiveControl(candidate),
    }))
    .sort(
      (left, right) =>
        compareUtf8(left.rank, right.rank) ||
        compareUtf8(
          left.candidate.expectedClusterCandidateId,
          right.candidate.expectedClusterCandidateId,
        ),
    );
  const controlWinner = new Map<string, Exclude<StudyClusterSelectionV1["controlGroup"], null>>();
  for (const group of [
    "identity-transition",
    "schedule-uncertain",
    "source-sparse",
    "liquidity-tail",
  ] as const) {
    const eligible = ranked.filter(({ eligibility }) => eligibility === group);
    if (eligible.length < 5) {
      throw new StudyContractError("study.quota-insufficient", "control capacity is below five", {
        quotaKind: "control",
      });
    }
    for (const row of eligible.slice(0, 5)) {
      controlWinner.set(row.candidate.expectedClusterCandidateId, group);
    }
  }
  for (const cluster of manifest.selectedClusters) {
    const candidate = candidateById.get(cluster.clusterCandidateId);
    if (candidate === undefined) invalid("selected cluster is absent from frame");
    const expectedRank = deriveStudyRankDigest(frame.rankSeedHex, cluster.clusterCandidateId);
    if (cluster.rank !== expectedRank) {
      throw new StudyContractError("study.rank-invalid", "selected rank does not recompute", {
        rankFailureKind: "hash",
      });
    }
    const expectedControl = controlWinner.get(cluster.clusterCandidateId) ?? null;
    if (cluster.controlGroup !== expectedControl) {
      throw new StudyContractError(
        "study.rank-invalid",
        "control priority/winner does not recompute",
        { rankFailureKind: "allocation" },
      );
    }
    const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
    const specialized =
      facts["modelFamily"] !== "standard-operating-company" && facts["modelFamily"] !== "unknown";
    const expectedLane =
      expectedControl !== null ? "prospective-control" : specialized ? "specialized" : "standard";
    if (cluster.lane !== expectedLane) invalid("selected cluster lane does not recompute");
    const expectedCellId =
      `${String(facts["marketCapStratum"])}|${String(facts["liquidityStratum"])}|` +
      candidate.plannedSession;
    if (cluster.allocationCell.allocationCellId !== expectedCellId) {
      throw new StudyContractError("study.rank-invalid", "allocation cell ID is invalid", {
        rankFailureKind: "allocation",
      });
    }
  }

  for (const lane of ["standard", "specialized"] as const) {
    const target = lane === "standard" ? 120 : 40;
    const available = ranked.filter(({ candidate }) => {
      if (controlWinner.has(candidate.expectedClusterCandidateId)) return false;
      const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
      const specialized =
        facts["modelFamily"] !== "standard-operating-company" && facts["modelFamily"] !== "unknown";
      return lane === "specialized" ? specialized : !specialized;
    });
    const groupKey = (candidate: StudyCandidateFrameEntryV1): string => {
      const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
      return String(lane === "specialized" ? facts["modelFamily"] : facts["sectorStratum"]);
    };
    const groups = new Map<string, StudyCandidateFrameEntryV1[]>();
    for (const { candidate } of available) {
      const key = groupKey(candidate);
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }
    const base = lane === "specialized" ? 2 : 1;
    const baseAwards = new Map(
      [...groups].map(([key, members]) => [key, Math.min(base, members.length)]),
    );
    const baseTotal = [...baseAwards.values()].reduce((sum, value) => sum + value, 0);
    const remainingAwards = capacityHamilton(
      [...groups]
        .map(([cellId, members]) => ({
          cellId,
          capacity: members.length - (baseAwards.get(cellId) ?? 0),
        }))
        .filter(({ capacity }) => capacity > 0),
      target - baseTotal,
    );
    const groupAwards = new Map(
      [...groups].map(([key]) => [
        key,
        (baseAwards.get(key) ?? 0) +
          (remainingAwards.find(({ cellId }) => cellId === key)?.awarded ?? 0),
      ]),
    );
    const selected = manifest.selectedClusters.filter((cluster) => cluster.lane === lane);
    for (const [group, award] of groupAwards) {
      const selectedGroup = selected.filter((cluster) => {
        const candidate = candidateById.get(
          cluster.clusterCandidateId,
        ) as StudyCandidateFrameEntryV1;
        return groupKey(candidate) === group;
      });
      if (selectedGroup.length !== award) {
        throw new StudyContractError("study.rank-invalid", "first-level Hamilton award mismatch", {
          rankFailureKind: "allocation",
        });
      }
      const members = groups.get(group) as StudyCandidateFrameEntryV1[];
      const cells = new Map<string, StudyCandidateFrameEntryV1[]>();
      for (const candidate of members) {
        const facts = asRecord(candidate.frameFacts, "candidate.frameFacts");
        const cellId =
          `${String(facts["marketCapStratum"])}|${String(facts["liquidityStratum"])}|` +
          candidate.plannedSession;
        cells.set(cellId, [...(cells.get(cellId) ?? []), candidate]);
      }
      const cellAwards = capacityHamilton(
        [...cells].map(([cellId, cellMembers]) => ({ cellId, capacity: cellMembers.length })),
        award,
      );
      for (const cellAward of cellAwards) {
        const selectedCell = selectedGroup.filter(
          (cluster) => cluster.allocationCell.allocationCellId === cellAward.cellId,
        );
        if (selectedCell.length !== cellAward.awarded) {
          throw new StudyContractError(
            "study.rank-invalid",
            "second-level Hamilton award mismatch",
            {
              rankFailureKind: "allocation",
            },
          );
        }
        for (const cluster of selectedCell) {
          if (
            cluster.allocationCell.cellFrameCount !== cellAward.capacity ||
            cluster.allocationCell.cellSelectedCount !== cellAward.awarded
          ) {
            invalid("cluster allocation evidence does not equal frame/cell award");
          }
        }
      }
    }
  }
}

export function validateStudyFreezeManifest(
  value: unknown,
  frame: StudyFrameSnapshotV1,
  prerequisites: StudyRunPrerequisitesV1,
): Readonly<{ studyManifestId: string; manifest: StudyFreezeManifestV1 }> {
  requireRunGate(prerequisites);
  assertJsonWithinLimits(
    value,
    { ...STUDY_JSON_LIMITS, maxCanonicalBytes: 33_554_432 },
    "manifest",
  );
  const record = asRecord(value, "manifest");
  assertExactKeys(record, MANIFEST_KEYS, "manifest");
  const manifest = value as StudyFreezeManifestV1;
  if (manifest.schemaVersion !== 1) invalid("manifest.schemaVersion must be 1");
  assertAcceptedContractAuthority(manifest.contractAuthorityRegistryId, manifest.contractIds);
  assertPattern(manifest.codeCommit, GIT_SHA_40, "manifest.codeCommit");
  assertPattern(manifest.configurationDigest, HEX_64, "manifest.configurationDigest");
  assertSortedUniqueStrings(
    manifest.entitlementSnapshotIds,
    "manifest.entitlementSnapshotIds",
    64,
    "contractSourceEntitlementIds",
  );
  if (
    manifest.entitlementSnapshotIds.length < 1 ||
    manifest.providerSourcePolicyId === "synthetic-offline-v1"
  ) {
    throw new StudyContractError(
      "study.primary-provider-unfrozen",
      "a real approved provider policy and entitlement are required",
      { providerFreezeKind: "provider" },
    );
  }
  if (
    manifest.studyDesignId !== frame.studyDesignId ||
    manifest.frameSnapshotId !== frame.expectedFrameSnapshotId ||
    manifest.configurationDigest !== frame.configurationDigest ||
    manifest.calendarSnapshotId !== frame.calendarSnapshotId ||
    manifest.rankSeedMaterialId !== frame.rankSeedMaterialId ||
    manifest.rankSeedHex !== frame.rankSeedHex ||
    manifest.samplingFrameAsOfMs !== frame.samplingFrameAsOfMs
  ) {
    invalid("manifest does not preserve its design/frame identities");
  }
  if (manifest.primaryAnchorKind !== "capture" || manifest.alternateAnchorRequired !== true) {
    throw new StudyContractError("study.anchor-policy-invalid", "H-001 anchor policy mismatch", {
      anchorFailureKind:
        manifest.primaryAnchorKind !== "capture" ? "capture-not-primary" : "retrieval-not-required",
    });
  }
  if (manifest.correctionLagMs !== STUDY_CORRECTION_LAG_MS) {
    enforceStudyBound("correctionLagMs", manifest.correctionLagMs);
    invalid("manifest correction lag must be exactly 604800000 ms");
  }
  if (manifest.collectionSessions.length !== STUDY_COLLECTION_SESSION_COUNT) {
    enforceStudyBound("collectionSessions", manifest.collectionSessions.length);
    invalid("manifest collection sessions must contain exactly 65 sessions");
  }
  if (new Set(manifest.collectionSessions).size !== manifest.collectionSessions.length) {
    invalid("manifest collection sessions must be unique");
  }
  const sessionTimes = manifest.collectionSessions.map((session, index) => {
    assertPattern(session, ISO_DATE, `manifest.collectionSessions[${index}]`);
    return Date.parse(`${session}T00:00:00.000Z`);
  });
  if (
    sessionTimes.some((time, index) => index > 0 && time <= (sessionTimes[index - 1] as number))
  ) {
    invalid("manifest collection sessions must be chronologically sorted");
  }
  if (
    (sessionTimes[sessionTimes.length - 1] as number) - (sessionTimes[0] as number) >
    10_368_000_000
  ) {
    enforceStudyBound(
      "collectionCalendarSpanMs",
      (sessionTimes[sessionTimes.length - 1] as number) - (sessionTimes[0] as number),
    );
    bound("collectionCalendarSpanMs", "collection calendar span exceeds 120 days");
  }
  if (
    manifest.freezePublishedAtMs < manifest.samplingFrameAsOfMs ||
    frame.frameConstructedAtMs > manifest.freezePublishedAtMs
  ) {
    invalid("manifest frame/freeze chronology is invalid");
  }
  if (
    prerequisites.firstOutcomeAtMs !== null &&
    manifest.freezePublishedAtMs >= prerequisites.firstOutcomeAtMs
  ) {
    throw new StudyContractError(
      "study.freeze-after-outcome",
      "freeze is not before first outcome",
      {
        freezeFailureKind:
          manifest.freezePublishedAtMs === prerequisites.firstOutcomeAtMs
            ? "equal-to-first-outcome"
            : "after-first-outcome",
      },
    );
  }
  if (manifest.selectedClusters.length !== STUDY_TARGET_CLUSTERS) {
    enforceStudyBound("targetClusters", manifest.selectedClusters.length);
    invalid("manifest must select exactly 180 clusters");
  }
  validateManifestSampling(manifest, frame);
  const frameCandidateIds = new Set(
    frame.candidates.map((candidate) => candidate.expectedClusterCandidateId),
  );
  const clusterIds = manifest.selectedClusters.map(
    (cluster) =>
      validateStudyClusterSelection(cluster, frame.expectedFrameSnapshotId, frameCandidateIds)
        .studyClusterId,
  );
  if (new Set(clusterIds).size !== STUDY_TARGET_CLUSTERS) {
    throw new StudyContractError("study.duplicate-cluster", "selected cluster IDs are not unique", {
      duplicateFailureKind: "duplicate-identity",
    });
  }
  const laneCounts = { standard: 0, specialized: 0, "prospective-control": 0 };
  const controlCounts = {
    "identity-transition": 0,
    "schedule-uncertain": 0,
    "source-sparse": 0,
    "liquidity-tail": 0,
  };
  for (const cluster of manifest.selectedClusters) {
    laneCounts[cluster.lane] += 1;
    if (cluster.controlGroup !== null) controlCounts[cluster.controlGroup] += 1;
    if ((cluster.lane === "prospective-control") !== (cluster.controlGroup !== null)) {
      invalid("control group and lane are inconsistent");
    }
  }
  if (
    laneCounts.standard !== 120 ||
    laneCounts.specialized !== 40 ||
    laneCounts["prospective-control"] !== 20 ||
    Object.values(controlCounts).some((count) => count !== 5)
  ) {
    enforceStudyBound("laneTargets", [
      laneCounts.standard,
      laneCounts.specialized,
      laneCounts["prospective-control"],
    ]);
    enforceStudyBound("controlTargets", Object.values(controlCounts));
    throw new StudyContractError("study.quota-insufficient", "lane/control quotas are not exact", {
      quotaKind: "lane",
    });
  }
  const expectedCounts = {
    targetClusters: 180,
    laneTargets: { standard: 120, specialized: 40, prospectiveControl: 20 },
    controlTargets: {
      identityTransition: 5,
      scheduleUncertain: 5,
      sourceSparse: 5,
      liquidityTail: 5,
    },
  };
  if (canonicalJson(manifest.expectedCounts) !== canonicalJson(expectedCounts)) {
    invalid("manifest.expectedCounts is not exact");
  }
  const studyManifestId = deriveStudyManifestId(manifest);
  assertExpectedId(
    manifest.expectedStudyManifestId,
    studyManifestId,
    "manifest.expectedStudyManifestId",
  );
  return { studyManifestId, manifest };
}

const ATTRITION_STAGES = [
  "selected",
  "release-observed",
  "anchor-trusted",
  "prior-close-eligible",
  "q0-eligible",
  "q1-eligible",
  "q5-eligible",
  "q30-eligible",
  "fully-complete",
] as const;
const PRIMARY_ENDPOINTS = ["Cprev", "Qpre", "Q0", "Q1", "Q5", "Q30"] as const;

export function validateStudyDatasetFreeze(
  value: unknown,
  manifest: StudyFreezeManifestV1,
  evidence: StudyDatasetValidationEvidenceV1,
): Readonly<{ datasetFreezeId: string; dataset: StudyDatasetFreezeV1 }> {
  assertJsonWithinLimits(manifest, STUDY_JSON_LIMITS, "dataset.manifest");
  const manifestRecord = asRecord(manifest, "dataset.manifest");
  assertExactKeys(manifestRecord, MANIFEST_KEYS, "dataset.manifest");
  if (manifest.schemaVersion !== 1) invalid("dataset manifest schema must be 1");
  assertAcceptedContractAuthority(manifest.contractAuthorityRegistryId, manifest.contractIds);
  assertPattern(manifest.codeCommit, GIT_SHA_40, "manifest.codeCommit");
  assertPattern(manifest.configurationDigest, HEX_64, "manifest.configurationDigest");
  assertPattern(manifest.studyDesignId, /^std1_[0-9a-f]{64}$/u, "manifest.studyDesignId");
  assertPattern(manifest.rankSeedHex, HEX_64, "manifest.rankSeedHex");
  assertString(manifest.rankSeedMaterialId, "manifest.rankSeedMaterialId");
  assertString(manifest.calendarSnapshotId, "manifest.calendarSnapshotId");
  assertString(manifest.providerSourcePolicyId, "manifest.providerSourcePolicyId");
  assertString(manifest.selectionPolicyId, "manifest.selectionPolicyId");
  assertSortedUniqueStrings(
    manifest.entitlementSnapshotIds,
    "manifest.entitlementSnapshotIds",
    64,
    "contractSourceEntitlementIds",
  );
  if (
    manifest.entitlementSnapshotIds.length < 1 ||
    manifest.primaryAnchorKind !== "capture" ||
    manifest.alternateAnchorRequired !== true ||
    manifest.correctionLagMs !== STUDY_CORRECTION_LAG_MS
  ) {
    enforceStudyBound("correctionLagMs", manifest.correctionLagMs);
    invalid("dataset manifest has an unfrozen provider, anchor, or correction policy");
  }
  for (const [name, timestamp] of [
    ["readyAtMs", manifest.readyAtMs],
    ["samplingFrameAsOfMs", manifest.samplingFrameAsOfMs],
    ["freezePublishedAtMs", manifest.freezePublishedAtMs],
  ] as const) {
    assertSafeNonnegative(timestamp, `manifest.${name}`);
  }
  if (
    !Array.isArray(manifest.collectionSessions) ||
    manifest.collectionSessions.length !== STUDY_COLLECTION_SESSION_COUNT
  ) {
    if (Array.isArray(manifest.collectionSessions)) {
      enforceStudyBound("collectionSessions", manifest.collectionSessions.length);
    }
    invalid("dataset manifest must retain the exact 65 collection sessions");
  }
  const collectionSessionTimes = manifest.collectionSessions.map((session, index) => {
    assertPattern(session, ISO_DATE, `manifest.collectionSessions[${index}]`);
    return Date.parse(`${session}T00:00:00.000Z`);
  });
  if (
    collectionSessionTimes.some(
      (time, index) => index > 0 && time <= (collectionSessionTimes[index - 1] as number),
    )
  ) {
    invalid("dataset manifest collection sessions must be sorted and unique");
  }
  const collectionSpan =
    (collectionSessionTimes[collectionSessionTimes.length - 1] as number) -
    (collectionSessionTimes[0] as number);
  enforceStudyBound("collectionCalendarSpanMs", collectionSpan);
  if (!Array.isArray(manifest.selectedClusters) || manifest.selectedClusters.length !== 180) {
    if (Array.isArray(manifest.selectedClusters)) {
      enforceStudyBound("targetClusters", manifest.selectedClusters.length);
    }
    invalid("dataset manifest must contain the complete 180-cluster frozen selection");
  }
  assertPattern(manifest.frameSnapshotId, /^sfs1_[0-9a-f]{64}$/u, "manifest.frameSnapshotId");
  assertPattern(
    manifest.expectedStudyManifestId,
    STUDY_MANIFEST_ID,
    "manifest.expectedStudyManifestId",
  );
  const frozenClusterById = new Map<string, StudyClusterSelectionV1>();
  for (const cluster of manifest.selectedClusters) {
    const validated = validateStudyClusterSelection(cluster, manifest.frameSnapshotId);
    if (frozenClusterById.has(validated.studyClusterId)) {
      invalid("dataset manifest contains a duplicate frozen cluster");
    }
    frozenClusterById.set(validated.studyClusterId, validated.cluster);
  }
  const laneCounts = new Map(STUDY_LANES.map((lane) => [lane, 0]));
  const controlCounts = new Map(STUDY_CONTROLS.map((control) => [control, 0]));
  for (const cluster of frozenClusterById.values()) {
    laneCounts.set(cluster.lane, (laneCounts.get(cluster.lane) ?? 0) + 1);
    if (cluster.controlGroup !== null) {
      controlCounts.set(cluster.controlGroup, (controlCounts.get(cluster.controlGroup) ?? 0) + 1);
    }
  }
  if (
    laneCounts.get("standard") !== 120 ||
    laneCounts.get("specialized") !== 40 ||
    laneCounts.get("prospective-control") !== 20 ||
    STUDY_CONTROLS.some((control) => controlCounts.get(control) !== 5)
  ) {
    enforceStudyBound("laneTargets", [
      laneCounts.get("standard") ?? 0,
      laneCounts.get("specialized") ?? 0,
      laneCounts.get("prospective-control") ?? 0,
    ]);
    enforceStudyBound(
      "controlTargets",
      STUDY_CONTROLS.map((control) => controlCounts.get(control) ?? 0),
    );
    invalid("dataset manifest lane/control cohort quotas are not exact");
  }
  const expectedCounts = {
    targetClusters: 180,
    laneTargets: { standard: 120, specialized: 40, prospectiveControl: 20 },
    controlTargets: {
      identityTransition: 5,
      scheduleUncertain: 5,
      sourceSparse: 5,
      liquidityTail: 5,
    },
  };
  if (canonicalJson(manifest.expectedCounts) !== canonicalJson(expectedCounts)) {
    invalid("dataset manifest expected counts are not exact");
  }
  if (deriveStudyManifestId(manifest) !== manifest.expectedStudyManifestId) {
    invalid("dataset manifest identity does not match its complete frozen semantics");
  }

  assertJsonWithinLimits(evidence, STUDY_JSON_LIMITS, "dataset.evidence");
  const evidenceRecord = asRecord(evidence, "dataset.evidence");
  assertExactKeys(evidenceRecord, DATASET_EVIDENCE_KEYS, "dataset.evidence");
  assertPattern(
    evidence.collectionConfigurationDigest,
    HEX_64,
    "dataset.evidence.collectionConfigurationDigest",
  );
  assertPattern(
    evidence.artifactInventoryDigest,
    HEX_64,
    "dataset.evidence.artifactInventoryDigest",
  );
  if (evidence.datasetFreezePolicyVersion !== STUDY_DATASET_FREEZE_POLICY_VERSION) {
    invalid("dataset evidence uses an unaccepted freeze policy");
  }
  if (
    !Array.isArray(evidence.marketResults) ||
    evidence.marketResults.length !== STUDY_TARGET_CLUSTERS * PRIMARY_ENDPOINTS.length * 2
  ) {
    invalid("dataset evidence must contain exactly 1080 capture and 1080 retrieval results");
  }
  enforceStudyBound("referencesTotal", evidence.marketResults.length);
  if (!Array.isArray(evidence.metricRecords) || !Array.isArray(evidence.clusterOutcomes)) {
    invalid("dataset evidence inventories must be arrays");
  }
  if (evidence.clusterOutcomes.length !== STUDY_TARGET_CLUSTERS) {
    invalid("dataset evidence must contain exactly 180 cluster outcomes");
  }

  const marketResultById = new Map<string, (typeof evidence.marketResults)[number]>();
  const outcomeByClusterId = new Map<string, (typeof evidence.clusterOutcomes)[number]>();
  const metricEvidenceById = new Map<string, (typeof evidence.metricRecords)[number]>();
  const evidenceExecutionIds = new Set<string>();
  const evidenceSourceObservationIds = new Set<string>();
  const evidenceRevisionIds = new Set<string>();
  const evidenceMarketReferenceJoinKeys = new Set<string>();
  const evidenceDiscrepancyIds = new Set<string>();
  let maximumCorrectedCutoffMs = 0;

  for (const [index, result] of evidence.marketResults.entries()) {
    const resultRecord = asRecord(result, `dataset.evidence.marketResults[${index}]`);
    assertExactKeys(
      resultRecord,
      DATASET_MARKET_RESULT_EVIDENCE_KEYS,
      `dataset.evidence.marketResults[${index}]`,
    );
    assertPattern(result.studyClusterId, STUDY_CLUSTER_ID, "marketResult.studyClusterId");
    if (!frozenClusterById.has(result.studyClusterId)) {
      invalid("market-result evidence refers to a cluster outside the frozen cohort");
    }
    if (
      !PRIMARY_ENDPOINTS.includes(result.endpointKind as never) ||
      !STUDY_REFERENCE_KINDS.includes(result.referenceKind as never) ||
      !STUDY_VIEW_KINDS.includes(result.viewKind as never) ||
      !STUDY_RESULT_STATUSES.includes(result.resultStatus as never)
    ) {
      invalid("market-result evidence has an unknown semantic enum");
    }
    try {
      validateMarketResultAsOfBasis(result.asOfBasis);
    } catch {
      invalid("market-result evidence has an invalid inherited as-of basis");
    }
    if (result.asOfBasis.viewKind !== result.viewKind) {
      invalid("market-result evidence view does not match its inherited as-of basis");
    }
    assertPattern(result.resultId, MARKET_RESULT_ID, "marketResult.resultId");
    assertPattern(
      result.marketReferenceJoinKey,
      MARKET_JOIN_KEY,
      "marketResult.marketReferenceJoinKey",
    );
    assertSafeNonnegative(result.correctedCutoffMs, "marketResult.correctedCutoffMs");
    maximumCorrectedCutoffMs = Math.max(maximumCorrectedCutoffMs, result.correctedCutoffMs);
    if (marketResultById.has(result.resultId)) {
      invalid("market-result evidence contains a duplicate result identity");
    }
    if (!Array.isArray(result.diagnostics)) invalid("market-result diagnostics must be an array");
    const diagnosticKeys = result.diagnostics.map(
      (diagnostic: JsonValue, diagnosticIndex: number) => {
        validatePreservedMarketReason(
          diagnostic,
          `dataset.evidence.marketResults[${index}].diagnostics[${diagnosticIndex}]`,
        );
        return canonicalJson(diagnostic);
      },
    );
    if (
      diagnosticKeys.join("\0") !== [...diagnosticKeys].sort(compareUtf8).join("\0") ||
      new Set(diagnosticKeys).size !== diagnosticKeys.length
    ) {
      invalid("market-result evidence diagnostics must be sorted and unique");
    }
    if (result.resultStatus === "missing") {
      if (result.preservedMissingReason === null) {
        invalid("missing market-result evidence must preserve its exact reason");
      }
      validatePreservedMarketReason(
        result.preservedMissingReason,
        `dataset.evidence.marketResults[${index}].preservedMissingReason`,
      );
    } else if (result.preservedMissingReason !== null) {
      invalid("selected market-result evidence cannot carry a missing reason");
    }
    for (const [key, maximum] of [
      ["sourceObservationIds", 64],
      ["revisionIds", 32],
      ["discrepancyIds", 64],
      ["executionIds", 64],
    ] as const) {
      const identities = assertSortedUniqueStrings(
        result[key],
        `dataset.evidence.marketResults[${index}].${key}`,
        maximum,
      );
      const target =
        key === "sourceObservationIds"
          ? evidenceSourceObservationIds
          : key === "revisionIds"
            ? evidenceRevisionIds
            : key === "discrepancyIds"
              ? evidenceDiscrepancyIds
              : evidenceExecutionIds;
      identities.forEach((identity) => {
        target.add(identity);
      });
    }
    evidenceMarketReferenceJoinKeys.add(result.marketReferenceJoinKey);
    marketResultById.set(result.resultId, result);
  }

  for (const [index, metric] of evidence.metricRecords.entries()) {
    const metricRecord = asRecord(metric, `dataset.evidence.metricRecords[${index}]`);
    assertExactKeys(
      metricRecord,
      DATASET_METRIC_EVIDENCE_KEYS,
      `dataset.evidence.metricRecords[${index}]`,
    );
    assertString(metric.metricRecordId, "metricEvidence.metricRecordId");
    assertPattern(metric.studyClusterId, STUDY_CLUSTER_ID, "metricEvidence.studyClusterId");
    if (
      !frozenClusterById.has(metric.studyClusterId) ||
      !STUDY_METRIC_IDS.includes(metric.metricId as never) ||
      metricEvidenceById.has(metric.metricRecordId)
    ) {
      invalid("metric evidence has an unknown owner, metric, or duplicate identity");
    }
    metricEvidenceById.set(metric.metricRecordId, metric);
  }

  for (const [index, outcome] of evidence.clusterOutcomes.entries()) {
    const outcomeRecord = asRecord(outcome, `dataset.evidence.clusterOutcomes[${index}]`);
    assertExactKeys(
      outcomeRecord,
      DATASET_CLUSTER_OUTCOME_KEYS,
      `dataset.evidence.clusterOutcomes[${index}]`,
    );
    assertPattern(outcome.studyClusterId, STUDY_CLUSTER_ID, "clusterOutcome.studyClusterId");
    if (
      !frozenClusterById.has(outcome.studyClusterId) ||
      outcomeByClusterId.has(outcome.studyClusterId) ||
      !STUDY_SESSIONS.includes(outcome.actualSession as never) ||
      !["observed", "not-observed"].includes(outcome.releaseStatus) ||
      !["trusted", "missing", "invalid"].includes(outcome.primaryAnchorStatus) ||
      !["agree", "disagree", "not-comparable"].includes(outcome.providerComparison) ||
      !["complete", "incomplete"].includes(outcome.retrievalSensitivityStatus)
    ) {
      invalid("cluster outcome evidence is invalid, duplicated, or outside the cohort");
    }
    if (outcome.eventTMinusOneSnapshotId !== null) {
      assertString(outcome.eventTMinusOneSnapshotId, "clusterOutcome.eventTMinusOneSnapshotId");
    }
    const telemetry = asRecord(outcome.anchorTelemetry, "clusterOutcome.anchorTelemetry");
    assertExactKeys(telemetry, STUDY_ANCHOR_TELEMETRY_KEYS, "clusterOutcome.anchorTelemetry");
    const captureBasis = asRecord(telemetry["captureBasis"], "anchorTelemetry.captureBasis");
    const retrievalBasis = asRecord(telemetry["retrievalBasis"], "anchorTelemetry.retrievalBasis");
    assertExactKeys(
      captureBasis,
      ["basisKind", "eventId", "receivedAtMs", "logicalAtMs", "clockBasisId"],
      "anchorTelemetry.captureBasis",
    );
    assertExactKeys(
      retrievalBasis,
      [
        "basisKind",
        "role",
        "acquisitionObservationId",
        "vaultObservationId",
        "retrievedAtMs",
        "clockBasisId",
      ],
      "anchorTelemetry.retrievalBasis",
    );
    if (captureBasis["basisKind"] !== "capture" || retrievalBasis["basisKind"] !== "retrieval") {
      invalid("anchor telemetry relabels the inherited capture or retrieval basis");
    }
    assertSafeNonnegative(captureBasis["receivedAtMs"], "anchorTelemetry.receivedAtMs");
    assertSafeNonnegative(captureBasis["logicalAtMs"], "anchorTelemetry.logicalAtMs");
    assertSafeNonnegative(retrievalBasis["retrievedAtMs"], "anchorTelemetry.retrievedAtMs");
    for (const [name, basisValue] of [
      ["eventId", captureBasis["eventId"]],
      ["captureClockBasisId", captureBasis["clockBasisId"]],
      ["role", retrievalBasis["role"]],
      ["acquisitionObservationId", retrievalBasis["acquisitionObservationId"]],
      ["vaultObservationId", retrievalBasis["vaultObservationId"]],
      ["retrievalClockBasisId", retrievalBasis["clockBasisId"]],
    ] as const) {
      assertString(basisValue, `anchorTelemetry.${name}`);
    }
    const latencyComparable =
      captureBasis["clockBasisId"] === retrievalBasis["clockBasisId"] &&
      captureBasis["receivedAtMs"] >= retrievalBasis["retrievedAtMs"];
    const expectedDelta = latencyComparable
      ? captureBasis["receivedAtMs"] - retrievalBasis["retrievedAtMs"]
      : null;
    if (expectedDelta !== null && expectedDelta <= 600_000) {
      if (
        telemetry["captureMinusRetrievalMs"] !== expectedDelta ||
        telemetry["latencyStudyReason"] !== null
      ) {
        invalid("capture-minus-retrieval telemetry does not equal the exact inherited clocks");
      }
    } else {
      if (
        telemetry["captureMinusRetrievalMs"] !== null ||
        telemetry["latencyStudyReason"] === null
      ) {
        invalid("non-comparable retrieval latency must be null with a stable study reason");
      }
      const latencyReason = validateStudyReason(telemetry["latencyStudyReason"]);
      if (
        latencyReason.code !== "study.anchor-clock-insufficient" ||
        latencyReason.detail?.["basisKind"] !== "capture-minus-retrieval"
      ) {
        invalid("retrieval latency nullability uses the wrong study reason");
      }
    }
    outcomeByClusterId.set(outcome.studyClusterId, outcome);
  }

  assertJsonWithinLimits(value, STUDY_JSON_LIMITS, "dataset");
  const record = asRecord(value, "dataset");
  assertExactKeys(record, DATASET_KEYS, "dataset");
  const dataset = value as StudyDatasetFreezeV1;
  if (dataset.schemaVersion !== 1 || dataset.studyManifestId !== manifest.expectedStudyManifestId) {
    invalid("dataset schema or manifest identity mismatch");
  }
  assertSafeNonnegative(dataset.freezeCutoffMs, "dataset.freezeCutoffMs");
  if (dataset.freezeCutoffMs !== maximumCorrectedCutoffMs) {
    invalid("dataset freeze cutoff must equal the maximum immutable corrected cutoff");
  }
  assertPattern(dataset.collectionCodeCommit, GIT_SHA_40, "dataset.collectionCodeCommit");
  assertPattern(
    dataset.collectionConfigurationDigest,
    HEX_64,
    "dataset.collectionConfigurationDigest",
  );
  assertPattern(dataset.artifactInventoryDigest, HEX_64, "dataset.artifactInventoryDigest");
  if (
    dataset.collectionConfigurationDigest !== evidence.collectionConfigurationDigest ||
    dataset.artifactInventoryDigest !== evidence.artifactInventoryDigest ||
    dataset.datasetFreezePolicyVersion !== STUDY_DATASET_FREEZE_POLICY_VERSION ||
    dataset.datasetFreezePolicyVersion !== evidence.datasetFreezePolicyVersion
  ) {
    invalid("dataset configuration, artifact, or freeze-policy evidence does not match");
  }
  for (const [key, maximum] of [
    ["executionIds", 12_800],
    ["sourceObservationIds", 12_800],
    ["revisionIds", 5_760],
    ["marketReferenceJoinKeys", 12_800],
    ["referenceResultIds", 12_800],
    ["discrepancyIds", 12_800],
    ["metricRecordIds", 5_760],
  ] as const) {
    assertSortedUniqueStrings(dataset[key], `dataset.${key}`, maximum, "referencesTotal");
  }
  if (dataset.denominatorAccounting.length !== STUDY_TARGET_CLUSTERS) {
    enforceStudyBound("targetClusters", dataset.denominatorAccounting.length);
    invalid("dataset denominator accounting must contain exactly 180 rows");
  }
  const manifestClusterIds = [...frozenClusterById.keys()].sort(compareUtf8);
  const denominatorClusterIds: string[] = [];
  const accountingReferenceResultIds: string[] = [];
  const accountingMetricRecordIds: string[] = [];
  const consumedMarketResultIds = new Set<string>();
  const consumedMetricRecordIds = new Set<string>();
  for (const [index, rawRow] of dataset.denominatorAccounting.entries()) {
    const row = asRecord(rawRow, `dataset.denominatorAccounting[${index}]`);
    assertExactKeys(row, DENOMINATOR_KEYS, `dataset.denominatorAccounting[${index}]`);
    assertPattern(row["studyClusterId"], STUDY_CLUSTER_ID, `denominator[${index}].studyClusterId`);
    const studyClusterId = row["studyClusterId"];
    if (index > 0 && compareUtf8(denominatorClusterIds[index - 1] as string, studyClusterId) >= 0) {
      invalid("dataset denominator rows must be sorted and unique by studyClusterId");
    }
    denominatorClusterIds.push(studyClusterId);
    const frozenCluster = frozenClusterById.get(studyClusterId);
    const outcome = outcomeByClusterId.get(studyClusterId);
    if (frozenCluster === undefined || outcome === undefined) {
      invalid("denominator row has no complete frozen selection and outcome evidence");
    }
    if (
      canonicalJson({
        lane: row["lane"],
        controlGroup: row["controlGroup"],
        sector: row["sector"],
        marketCap: row["marketCap"],
        liquidity: row["liquidity"],
        plannedSession: row["plannedSession"],
        modelFamily: row["modelFamily"],
      } as JsonValue) !==
      canonicalJson({
        lane: frozenCluster.lane,
        controlGroup: frozenCluster.controlGroup,
        sector: frozenCluster.strata.sector,
        marketCap: frozenCluster.strata.marketCap,
        liquidity: frozenCluster.strata.liquidity,
        plannedSession: frozenCluster.strata.plannedSession,
        modelFamily: frozenCluster.strata.modelFamily,
      })
    ) {
      invalid("denominator row rewrites frozen lane/control/strata/session/model semantics");
    }
    if (
      canonicalJson({
        studyClusterId,
        actualSession: row["actualSession"],
        releaseStatus: row["releaseStatus"],
        primaryAnchorStatus: row["primaryAnchorStatus"],
        eventTMinusOneSnapshotId: row["eventTMinusOneSnapshotId"],
        providerComparison: row["providerComparison"],
        retrievalSensitivityStatus: row["retrievalSensitivityStatus"],
        anchorTelemetry: row["anchorTelemetry"],
      } as JsonValue) !== canonicalJson(outcome)
    ) {
      invalid("denominator row does not byte-match immutable cluster outcome evidence");
    }
    if (!Array.isArray(row["references"]) || row["references"].length !== 6) {
      invalid(`denominator[${index}] must contain exactly six required references`);
    }
    const primaryImmutableResults: (typeof evidence.marketResults)[number][] = [];
    const primaryEndpoints = row["references"].map((reference, referenceIndex) => {
      const referenceRow = asRecord(
        reference,
        `denominator[${index}].references[${referenceIndex}]`,
      );
      assertExactKeys(
        referenceRow,
        [
          "endpointKind",
          "referenceKind",
          "viewKind",
          "resultStatus",
          "selectedReferenceId",
          "missingReferenceId",
          "studyReason",
          "diagnostics",
        ],
        `denominator[${index}].references[${referenceIndex}]`,
      );
      if (referenceRow["resultStatus"] === "rejected") {
        throw new StudyContractError(
          "study.input-invalid",
          "rejected market operation invalidates the complete dataset",
        );
      }
      if (
        !STUDY_REFERENCE_KINDS.includes(referenceRow["referenceKind"] as never) ||
        !STUDY_VIEW_KINDS.includes(referenceRow["viewKind"] as never) ||
        !STUDY_RESULT_STATUSES.includes(referenceRow["resultStatus"] as never)
      ) {
        invalid("reference accounting has an invalid kind/view/status");
      }
      if (referenceRow["viewKind"] !== "recorded-primary") {
        invalid("the six required primary references must use recorded-primary");
      }
      const expectedKind =
        referenceIndex === 0 ? "prior-listing-official-close" : "quote-nbbo-midpoint";
      if (referenceRow["referenceKind"] !== expectedKind) {
        invalid("required primary reference kind does not match its endpoint");
      }
      const selected = referenceRow["selectedReferenceId"];
      const missing = referenceRow["missingReferenceId"];
      if (selected !== null) assertPattern(selected, MARKET_RESULT_ID, "selectedReferenceId");
      if (missing !== null) assertPattern(missing, MARKET_RESULT_ID, "missingReferenceId");
      if ((selected === null) === (missing === null)) {
        invalid("reference accounting must be selected xor missing");
      }
      if (!Array.isArray(referenceRow["diagnostics"])) {
        invalid("reference diagnostics must be an array");
      }
      const diagnosticKeys = referenceRow["diagnostics"].map((diagnostic, diagnosticIndex) => {
        validatePreservedMarketReason(
          diagnostic,
          `denominator[${index}].references[${referenceIndex}].diagnostics[${diagnosticIndex}]`,
        );
        return canonicalJson(diagnostic as JsonValue);
      });
      if (
        new Set(diagnosticKeys).size !== diagnosticKeys.length ||
        diagnosticKeys.join("\0") !== [...diagnosticKeys].sort(compareUtf8).join("\0")
      ) {
        invalid("reference diagnostics must be sorted and unique");
      }
      if (referenceRow["resultStatus"] === "missing") {
        if (selected !== null || missing === null || referenceRow["studyReason"] === null) {
          invalid("missing reference accounting nullability is invalid");
        }
        validateStudyReason(referenceRow["studyReason"]);
      } else {
        if (selected === null || missing !== null || referenceRow["studyReason"] !== null) {
          invalid("selected reference accounting nullability is invalid");
        }
        if (
          (referenceRow["resultStatus"] === "selected-complete" && diagnosticKeys.length !== 0) ||
          (referenceRow["resultStatus"] === "selected-degraded" && diagnosticKeys.length === 0)
        ) {
          invalid("selected reference diagnostics do not match result status");
        }
      }
      const resultId = (selected ?? missing) as string;
      const immutableResult = marketResultById.get(resultId);
      if (
        immutableResult === undefined ||
        consumedMarketResultIds.has(resultId) ||
        immutableResult.studyClusterId !== studyClusterId ||
        immutableResult.endpointKind !== referenceRow["endpointKind"] ||
        immutableResult.referenceKind !== referenceRow["referenceKind"] ||
        immutableResult.viewKind !== referenceRow["viewKind"] ||
        immutableResult.resultStatus !== referenceRow["resultStatus"] ||
        canonicalJson(immutableResult.diagnostics) !==
          canonicalJson(referenceRow["diagnostics"] as JsonValue)
      ) {
        invalid("reference accounting does not byte-match its immutable market result");
      }
      const rowTelemetry = asRecord(row["anchorTelemetry"], "denominator.anchorTelemetry");
      if (
        immutableResult.asOfBasis.anchorRole !== "h001-primary-durable-capture" ||
        canonicalJson(immutableResult.asOfBasis.trustedObservationBasis) !==
          canonicalJson(rowTelemetry["captureBasis"] as JsonValue)
      ) {
        invalid("primary reference is not bound to the exact durable-capture basis");
      }
      if (referenceRow["resultStatus"] === "missing") {
        const reason = asRecord(referenceRow["studyReason"], "reference.studyReason");
        if (
          reason["marketResultId"] !== resultId ||
          canonicalJson(reason["preservedMarketReason"] as JsonValue) !==
            canonicalJson(immutableResult.preservedMissingReason)
        ) {
          invalid("missing reference does not preserve the immutable result/reason pair");
        }
      } else if (immutableResult.preservedMissingReason !== null) {
        invalid("selected reference is linked to missing-result evidence");
      }
      consumedMarketResultIds.add(resultId);
      accountingReferenceResultIds.push(resultId);
      primaryImmutableResults.push(immutableResult);
      return referenceRow["endpointKind"];
    });
    if (canonicalJson(primaryEndpoints as JsonValue) !== canonicalJson(PRIMARY_ENDPOINTS)) {
      invalid(`denominator[${index}] primary reference order is invalid`);
    }
    if (
      !Array.isArray(row["retrievalSensitivityReferences"]) ||
      row["retrievalSensitivityReferences"].length !== 6
    ) {
      invalid(`denominator[${index}] must contain exactly six retrieval-sensitivity references`);
    }
    enforceStudyBound(
      "referencesPerCluster",
      row["references"].length + row["retrievalSensitivityReferences"].length,
    );
    const retrievalEndpoints = row["retrievalSensitivityReferences"].map(
      (reference, referenceIndex) => {
        const referenceRow = asRecord(
          reference,
          `denominator[${index}].retrievalSensitivityReferences[${referenceIndex}]`,
        );
        assertExactKeys(
          referenceRow,
          [
            "endpointKind",
            "referenceKind",
            "viewKind",
            "resultStatus",
            "selectedReferenceId",
            "missingReferenceId",
            "studyReason",
            "diagnostics",
          ],
          `denominator[${index}].retrievalSensitivityReferences[${referenceIndex}]`,
        );
        const expectedKind =
          referenceIndex === 0 ? "prior-listing-official-close" : "quote-nbbo-midpoint";
        if (
          !PRIMARY_ENDPOINTS.includes(referenceRow["endpointKind"] as never) ||
          referenceRow["referenceKind"] !== expectedKind ||
          referenceRow["viewKind"] !== "recorded-primary" ||
          !STUDY_RESULT_STATUSES.includes(referenceRow["resultStatus"] as never)
        ) {
          invalid("retrieval sensitivity has an invalid endpoint, kind, view, or status");
        }
        const selected = referenceRow["selectedReferenceId"];
        const missing = referenceRow["missingReferenceId"];
        if (selected !== null) assertPattern(selected, MARKET_RESULT_ID, "selectedReferenceId");
        if (missing !== null) assertPattern(missing, MARKET_RESULT_ID, "missingReferenceId");
        if ((selected === null) === (missing === null)) {
          invalid("retrieval sensitivity must be selected xor typed-missing");
        }
        if (!Array.isArray(referenceRow["diagnostics"])) {
          invalid("retrieval sensitivity diagnostics must be an array");
        }
        const diagnosticKeys = referenceRow["diagnostics"].map((diagnostic, diagnosticIndex) => {
          validatePreservedMarketReason(
            diagnostic,
            `denominator[${index}].retrievalSensitivityReferences[${referenceIndex}].diagnostics[${diagnosticIndex}]`,
          );
          return canonicalJson(diagnostic as JsonValue);
        });
        if (
          diagnosticKeys.join("\0") !== [...diagnosticKeys].sort(compareUtf8).join("\0") ||
          new Set(diagnosticKeys).size !== diagnosticKeys.length
        ) {
          invalid("retrieval sensitivity diagnostics must be sorted and unique");
        }
        if (referenceRow["resultStatus"] === "missing") {
          if (selected !== null || missing === null || referenceRow["studyReason"] === null) {
            invalid("missing retrieval-sensitivity nullability is invalid");
          }
          validateStudyReason(referenceRow["studyReason"]);
        } else {
          if (selected === null || missing !== null || referenceRow["studyReason"] !== null) {
            invalid("selected retrieval-sensitivity nullability is invalid");
          }
          if (
            (referenceRow["resultStatus"] === "selected-complete" && diagnosticKeys.length !== 0) ||
            (referenceRow["resultStatus"] === "selected-degraded" && diagnosticKeys.length === 0)
          ) {
            invalid("retrieval-sensitivity diagnostics do not match result status");
          }
        }
        const resultId = (selected ?? missing) as string;
        const immutableResult = marketResultById.get(resultId);
        const primaryResult = primaryImmutableResults[referenceIndex];
        if (
          immutableResult === undefined ||
          primaryResult === undefined ||
          consumedMarketResultIds.has(resultId) ||
          immutableResult.studyClusterId !== studyClusterId ||
          immutableResult.endpointKind !== referenceRow["endpointKind"] ||
          immutableResult.referenceKind !== referenceRow["referenceKind"] ||
          immutableResult.viewKind !== referenceRow["viewKind"] ||
          immutableResult.resultStatus !== referenceRow["resultStatus"] ||
          immutableResult.asOfBasis.anchorRole !== "h001-mandatory-retrieval-sensitivity" ||
          canonicalJson(immutableResult.asOfBasis.trustedObservationBasis) !==
            canonicalJson(
              asRecord(row["anchorTelemetry"], "denominator.anchorTelemetry")[
                "retrievalBasis"
              ] as JsonValue,
            ) ||
          canonicalJson(immutableResult.diagnostics) !==
            canonicalJson(referenceRow["diagnostics"] as JsonValue)
        ) {
          invalid("retrieval accounting does not byte-match its immutable retrieval result");
        }
        const selectorSemantics = (result: (typeof evidence.marketResults)[number]): JsonValue => ({
          targetTimeNs: result.asOfBasis.targetTimeNs,
          comparator: result.asOfBasis.comparator,
          viewKind: result.asOfBasis.viewKind,
          recordedCorpusSnapshotId: result.asOfBasis.recordedCorpusSnapshotId,
          corpusCutoffId: result.asOfBasis.corpusCutoffId,
          admittedRevisionSetHash: result.asOfBasis.admittedRevisionSetHash,
        });
        if (
          canonicalJson(selectorSemantics(immutableResult)) !==
          canonicalJson(selectorSemantics(primaryResult))
        ) {
          invalid("retrieval sensitivity changes the frozen target selector or corpus");
        }
        if (referenceRow["resultStatus"] === "missing") {
          const reason = asRecord(referenceRow["studyReason"], "retrieval.studyReason");
          if (
            reason["marketResultId"] !== resultId ||
            canonicalJson(reason["preservedMarketReason"] as JsonValue) !==
              canonicalJson(immutableResult.preservedMissingReason)
          ) {
            invalid("missing retrieval result does not preserve its immutable result/reason pair");
          }
        } else if (immutableResult.preservedMissingReason !== null) {
          invalid("selected retrieval result is linked to missing-result evidence");
        }
        consumedMarketResultIds.add(resultId);
        accountingReferenceResultIds.push(resultId);
        return referenceRow["endpointKind"];
      },
    );
    if (canonicalJson(retrievalEndpoints as JsonValue) !== canonicalJson(PRIMARY_ENDPOINTS)) {
      invalid(`denominator[${index}] retrieval reference order is invalid`);
    }
    if (
      (row["retrievalSensitivityStatus"] === "complete") !==
      row["retrievalSensitivityReferences"].every(
        (reference) => asRecord(reference, "retrieval reference")["resultStatus"] !== "missing",
      )
    ) {
      invalid("retrieval-sensitivity completeness does not match its fixed denominator");
    }
    if (!Array.isArray(row["metrics"]) || row["metrics"].length !== 9) {
      invalid(`denominator[${index}] must contain exactly nine metrics`);
    }
    const metricIds: string[] = [];
    for (const [metricIndex, metric] of row["metrics"].entries()) {
      const metricRecord = asRecord(metric, `denominator[${index}].metrics[${metricIndex}]`);
      assertExactKeys(
        metricRecord,
        ["metricId", "evaluability", "metricRecordId", "success", "studyReason"],
        `denominator[${index}].metrics[${metricIndex}]`,
      );
      if (!STUDY_METRIC_IDS.includes(metricRecord["metricId"] as never)) {
        invalid("metric accounting has an unknown metric ID");
      }
      metricIds.push(metricRecord["metricId"] as string);
      if (!["evaluable", "missing"].includes(metricRecord["evaluability"] as string)) {
        invalid("metric evaluability is invalid");
      }
      const isMovement =
        (metricRecord["metricId"] as string).startsWith("residual") ||
        ["priorCloseMovementAtFirstObservation", "releaseGapMovement"].includes(
          metricRecord["metricId"] as string,
        );
      if (metricRecord["evaluability"] === "evaluable") {
        assertString(metricRecord["metricRecordId"], "metric.metricRecordId");
        accountingMetricRecordIds.push(metricRecord["metricRecordId"]);
        const immutableMetric = metricEvidenceById.get(metricRecord["metricRecordId"]);
        if (
          immutableMetric === undefined ||
          consumedMetricRecordIds.has(metricRecord["metricRecordId"]) ||
          immutableMetric.studyClusterId !== studyClusterId ||
          immutableMetric.metricId !== metricRecord["metricId"]
        ) {
          invalid("metric accounting does not match immutable metric-record ownership");
        }
        consumedMetricRecordIds.add(metricRecord["metricRecordId"]);
        if (metricRecord["studyReason"] !== null) invalid("evaluable metric cannot have a reason");
        if (
          isMovement
            ? metricRecord["success"] !== null
            : typeof metricRecord["success"] !== "boolean"
        ) {
          invalid("metric success has invalid nullability");
        }
      } else {
        if (metricRecord["metricRecordId"] !== null || metricRecord["studyReason"] === null) {
          invalid("missing metric accounting nullability is invalid");
        }
        validateStudyReason(metricRecord["studyReason"]);
        if (isMovement ? metricRecord["success"] !== null : metricRecord["success"] !== false) {
          invalid("missing fixed-denominator metric must be not-success");
        }
      }
    }
    if (canonicalJson(metricIds) !== canonicalJson(STUDY_METRIC_IDS)) {
      invalid("metric accounting must contain the nine exact metric IDs in sorted order");
    }
    if (!Array.isArray(row["attrition"]) || row["attrition"].length !== 9) {
      invalid(`denominator[${index}] must contain exactly nine attrition stages`);
    }
    const attritionEntries = row["attrition"].map((entry, attritionIndex) => {
      const attrition = asRecord(entry, `denominator[${index}].attrition[${attritionIndex}]`);
      assertExactKeys(
        attrition,
        ["stage", "status", "reason"],
        `denominator[${index}].attrition[${attritionIndex}]`,
      );
      if (!["passed", "not-passed"].includes(attrition["status"] as string)) {
        invalid("attrition status is invalid");
      }
      if (
        (attrition["status"] === "passed" && attrition["reason"] !== null) ||
        (attrition["status"] === "not-passed" && attrition["reason"] === null)
      ) {
        invalid("attrition reason nullability is invalid");
      }
      if (attrition["reason"] !== null) validateStudyReason(attrition["reason"]);
      return attrition;
    });
    const stages = attritionEntries.map((entry) => entry["stage"]) as JsonValue;
    if (canonicalJson(stages) !== canonicalJson(ATTRITION_STAGES)) {
      invalid(`denominator[${index}] attrition order is invalid`);
    }
    if (attritionEntries[0]?.["status"] !== "passed") {
      invalid("selected attrition must always pass");
    }
    if (!Array.isArray(row["annotations"]) || row["annotations"].length > 64) {
      if (Array.isArray(row["annotations"])) {
        enforceStudyBound("annotationsPerCluster", row["annotations"].length);
      }
      bound("annotationsPerCluster", "annotation count exceeds 64");
    }
    const annotationCodes: string[] = [];
    const annotationKeys = row["annotations"].map((annotation) => {
      const validated = validateStudyReason(annotation);
      if (validated.disposition !== "annotation")
        invalid("cluster annotation is not an annotation");
      annotationCodes.push(validated.code);
      return canonicalJson(annotation as JsonValue);
    });
    if (
      annotationKeys.join("\0") !== [...annotationKeys].sort(compareUtf8).join("\0") ||
      new Set(annotationKeys).size !== annotationKeys.length
    ) {
      invalid("annotations must be sorted and unique");
    }
    const hasAnnotation = (code: string): boolean => annotationCodes.includes(code);
    if ((row["eventTMinusOneSnapshotId"] === null) !== hasAnnotation("study.t-minus-one-missing")) {
      invalid("T-1 snapshot nullability does not match its required annotation");
    }
    if (
      (row["providerComparison"] === "disagree") !== hasAnnotation("study.provider-disagreement") ||
      (row["providerComparison"] === "not-comparable") !==
        hasAnnotation("study.provider-not-comparable")
    ) {
      invalid("provider comparison does not match its exact annotation");
    }
    const clusterDiscrepancyCount = row["references"].reduce((count, reference) => {
      const referenceRecord = asRecord(reference, "reference");
      const resultId = (referenceRecord["selectedReferenceId"] ??
        referenceRecord["missingReferenceId"]) as string;
      return count + (marketResultById.get(resultId)?.discrepancyIds.length ?? 0);
    }, 0);
    if (
      (row["providerComparison"] === "agree" && clusterDiscrepancyCount !== 0) ||
      (row["providerComparison"] === "disagree" && clusterDiscrepancyCount === 0)
    ) {
      invalid("provider comparison does not match immutable discrepancy evidence");
    }
    const referenceStatusByEndpoint = new Map(
      row["references"].map((reference) => {
        const referenceRecord = asRecord(reference, "reference");
        return [referenceRecord["endpointKind"], referenceRecord["resultStatus"]] as const;
      }),
    );
    const expectedStagePasses = [
      true,
      row["releaseStatus"] === "observed",
      row["primaryAnchorStatus"] === "trusted",
      referenceStatusByEndpoint.get("Cprev") !== "missing",
      referenceStatusByEndpoint.get("Q0") !== "missing",
      referenceStatusByEndpoint.get("Q1") !== "missing",
      referenceStatusByEndpoint.get("Q5") !== "missing",
      referenceStatusByEndpoint.get("Q30") !== "missing",
    ];
    expectedStagePasses.push(
      expectedStagePasses.every(Boolean) && referenceStatusByEndpoint.get("Qpre") !== "missing",
    );
    for (const [stageIndex, expectedPass] of expectedStagePasses.entries()) {
      if ((attritionEntries[stageIndex]?.["status"] === "passed") !== expectedPass) {
        invalid("attrition status does not reconcile to immutable row evidence");
      }
    }
    if (
      row["releaseStatus"] === "not-observed" &&
      asRecord(attritionEntries[1]?.["reason"], "release attrition reason")["code"] !==
        "study.release-not-observed"
    ) {
      invalid("not-observed release lacks its exact retained-outcome reason");
    }
  }
  if (
    canonicalJson([...denominatorClusterIds].sort(compareUtf8)) !==
    canonicalJson(manifestClusterIds)
  ) {
    invalid("dataset denominator cluster IDs differ from the frozen cohort");
  }
  if (
    canonicalJson([...accountingReferenceResultIds].sort(compareUtf8)) !==
      canonicalJson(dataset.referenceResultIds) ||
    canonicalJson([...accountingMetricRecordIds].sort(compareUtf8)) !==
      canonicalJson(dataset.metricRecordIds)
  ) {
    invalid("dataset identity inventories do not equal denominator accounting");
  }
  if (
    consumedMarketResultIds.size !== marketResultById.size ||
    consumedMetricRecordIds.size !== metricEvidenceById.size
  ) {
    invalid("immutable result or metric evidence contains unaccounted records");
  }
  const exactEvidenceInventory = (
    actual: readonly string[],
    expected: ReadonlySet<string>,
    name: string,
  ): void => {
    if (
      canonicalJson(actual as JsonValue) !==
      canonicalJson([...expected].sort(compareUtf8) as JsonValue)
    ) {
      invalid(`dataset ${name} does not equal the immutable evidence union`);
    }
  };
  exactEvidenceInventory(dataset.executionIds, evidenceExecutionIds, "executionIds");
  exactEvidenceInventory(
    dataset.sourceObservationIds,
    evidenceSourceObservationIds,
    "sourceObservationIds",
  );
  exactEvidenceInventory(dataset.revisionIds, evidenceRevisionIds, "revisionIds");
  exactEvidenceInventory(
    dataset.marketReferenceJoinKeys,
    evidenceMarketReferenceJoinKeys,
    "marketReferenceJoinKeys",
  );
  exactEvidenceInventory(dataset.discrepancyIds, evidenceDiscrepancyIds, "discrepancyIds");
  const datasetFreezeId = deriveStudyDatasetFreezeId(dataset);
  assertExpectedId(
    dataset.expectedDatasetFreezeId,
    datasetFreezeId,
    "dataset.expectedDatasetFreezeId",
  );
  return { datasetFreezeId, dataset };
}
