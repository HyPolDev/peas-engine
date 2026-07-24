import type { JsonLimits, JsonValue } from "../../core/json.js";
import type {
  MarketResultAsOfBasisV1,
  TrustedObservationBasisV1,
} from "../../providers/market-reference/contracts.js";
import { STUDY_BOUND_IDS } from "./bounds.js";

export const ACCEPTED_CONTRACT_AUTHORITY_REGISTRY_ID =
  "car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad";

export const STUDY_CONTRACT_AUTHORITY_IDS = [
  "peas/adr-0010/v1",
  "peas/market-acceptance-matrix/v1",
  "peas/market-eligibility/v1",
  "peas/market-fixture-manifest/v1",
  "peas/market-provider-source-identity/v1",
  "peas/market-reason-catalog/v1",
  "peas/market-resource-bounds/v1",
  "peas/market-timestamp-trust/v1",
  "peas/study-freeze-manifest/v1",
  "peas/study-reason-catalog/v1",
] as const;

export const STUDY_JSON_LIMITS: JsonLimits = {
  maxDepth: 12,
  maxNodes: 500_000,
  maxArrayLength: 12_800,
  maxObjectKeys: 64,
  maxStringBytes: 4_096,
  maxCanonicalBytes: 67_108_864,
};

export const STUDY_TARGET_CLUSTERS = 180;
export const STUDY_FRAME_CANDIDATE_LIMIT = 8_192;
export const STUDY_FRAME_CELL_LIMIT = 2_048;
export const STUDY_COLLECTION_SESSION_COUNT = 65;
export const STUDY_CORRECTION_LAG_MS = 604_800_000;
export const STUDY_BOOTSTRAP_REPLICATES = 10_000;
export const STUDY_HOLM_SLOTS = 24;
export const STUDY_DATASET_FREEZE_POLICY_VERSION = "peas-study-dataset-freeze-v1";

export type StudyContractAuthorityIdV1 = (typeof STUDY_CONTRACT_AUTHORITY_IDS)[number];
export type StudyContractAuthorityIdsV1 = typeof STUDY_CONTRACT_AUTHORITY_IDS;

export type StudyLaneV1 = "standard" | "specialized" | "prospective-control";
export type StudyControlGroupV1 =
  | "identity-transition"
  | "schedule-uncertain"
  | "source-sparse"
  | "liquidity-tail"
  | null;
export type StudySessionV1 =
  | "pre-market"
  | "regular"
  | "post-market"
  | "overnight-or-closed"
  | "unknown";
export type StudySectorV1 =
  | "agriculture"
  | "mining"
  | "construction"
  | "manufacturing"
  | "transport-communications-utilities"
  | "wholesale"
  | "retail"
  | "finance-insurance-real-estate"
  | "services"
  | "public-administration"
  | "unknown";
export type StudyModelFamilyV1 =
  | "standard-operating-company"
  | "digital-asset-treasury"
  | "precommercial-biotech"
  | "bank"
  | "insurer"
  | "equity-reit"
  | "bdc"
  | "commodity-producer"
  | "holding-nav"
  | "discontinuous-history"
  | "unknown";

export type StudyReleaseClusterBasisV1 =
  | Readonly<{ kind: "fiscal-period"; plannedFiscalPeriod: string }>
  | Readonly<{ kind: "cross-source"; crossSourceReleaseKeyHash: string }>
  | Readonly<{
      kind: "native-date";
      plannedReleaseDate: string;
      nativeScheduleIdHash: string;
    }>;

export type StudyScheduleSourceEvidenceV1 = Readonly<{
  sourceFamily:
    | "issuer-regulatory-filing"
    | "issuer-ir-calendar"
    | "exchange-calendar"
    | "approved-schedule-provider";
  precedenceOrdinal: 0 | 1 | 2 | 3;
  scheduleSourceObservationId: string;
  sourceRevisionId: string | null;
  nativeScheduleIdHash: string;
  crossSourceReleaseKeyHash: string | null;
  durablyCapturedAtMs: number;
  effectiveAtMs: number | null;
  nativeRevisionSequence: string | null;
  issuerMappingId: string;
  releaseKind: "quarterly" | "annual";
  plannedFiscalPeriod: string | null;
  plannedReleaseDate: string;
  plannedSession: StudySessionV1;
}>;

export type StudyClusterCandidateV1 = Readonly<{
  scheduleSourceObservationId: string;
  issuerMappingId: string;
  instrumentId: string;
  releaseKind: "quarterly" | "annual";
  releaseClusterKey: string;
  plannedFiscalPeriod: string | null;
  plannedReleaseDate: string;
  plannedSession: StudySessionV1;
}>;

export type StudyCandidateFrameEntryV1 = StudyClusterCandidateV1 &
  Readonly<{
    clusterBasis: StudyReleaseClusterBasisV1;
    scheduleSourceEvidence: readonly StudyScheduleSourceEvidenceV1[];
    frameFacts: JsonValue;
    expectedClusterCandidateId: string;
  }>;

export type StudyDesignV1 = Readonly<{
  schemaVersion: 1;
  designVersion: string;
  contractAuthorityRegistryId: string;
  acceptedContractIds: readonly string[];
  algorithms: JsonValue;
  metricDefinitions: readonly JsonValue[];
  gateThresholds: readonly JsonValue[];
  correctionPolicyId: string;
  missingPolicyId: string;
  outlierPolicyId: string;
  multiplicityPolicyId: string;
  sensitivityPolicyId: string;
  boundsPolicyId: string;
  analysisCodeDigest: string;
  expectedStudyDesignId: string;
}>;

export type FrameDispositionCountV1 = Readonly<{
  disposition:
    | "eligible"
    | "study.frame-candidate-invalid"
    | "study.instrument-out-of-scope"
    | "study.share-class-not-selected";
  reason: JsonValue;
  count: number;
  members: readonly JsonValue[];
}>;

export type StudyFrameSnapshotV1 = Readonly<{
  schemaVersion: 1;
  studyDesignId: string;
  contractAuthorityRegistryId: string;
  samplingFrameAsOfMs: number;
  calendarSnapshotId: string;
  scheduleSourcePolicyId: "peas-study-schedule-source-v1";
  frameConstructionCodeDigest: string;
  configurationDigest: string;
  preFrameEvidenceSnapshotId: string;
  rankSeedMaterialId: string;
  rankSeedHex: string;
  seedCommittedAtMs: number;
  frameConstructedAtMs: number;
  candidates: readonly StudyCandidateFrameEntryV1[];
  dispositions: readonly FrameDispositionCountV1[];
  expectedFrameSnapshotId: string;
}>;

export type StudyClusterSelectionV1 = Readonly<{
  clusterCandidateId: string;
  frameSnapshotId: string;
  lane: StudyLaneV1;
  controlGroup: StudyControlGroupV1;
  strata: Readonly<{
    sector: StudySectorV1;
    marketCap: "low" | "mid" | "high" | "unknown";
    liquidity: "low" | "mid" | "high" | "unknown";
    plannedSession: StudySessionV1;
    modelFamily: StudyModelFamilyV1;
  }>;
  rank: string;
  allocationCell: Readonly<{
    allocationCellId: string;
    cellFrameCount: number;
    cellSelectedCount: number;
  }>;
  selectionFraction: Readonly<{ numerator: string; denominator: string }>;
  expectedStudyClusterId: string;
}>;

export type StudyFreezeManifestV1 = Readonly<{
  schemaVersion: 1;
  studyDesignId: string;
  codeCommit: string;
  configurationDigest: string;
  contractAuthorityRegistryId: string;
  contractIds: readonly string[];
  calendarSnapshotId: string;
  entitlementSnapshotIds: readonly string[];
  providerSourcePolicyId: string;
  selectionPolicyId: string;
  primaryAnchorKind: "capture";
  alternateAnchorRequired: true;
  readyAtMs: number;
  samplingFrameAsOfMs: number;
  freezePublishedAtMs: number;
  collectionSessions: readonly string[];
  correctionLagMs: 604_800_000;
  rankSeedMaterialId: string;
  rankSeedHex: string;
  frameSnapshotId: string;
  selectedClusters: readonly StudyClusterSelectionV1[];
  expectedCounts: Readonly<{
    targetClusters: 180;
    laneTargets: Readonly<{ standard: 120; specialized: 40; prospectiveControl: 20 }>;
    controlTargets: Readonly<{
      identityTransition: 5;
      scheduleUncertain: 5;
      sourceSparse: 5;
      liquidityTail: 5;
    }>;
  }>;
  expectedStudyManifestId: string;
}>;

export type StudyDatasetFreezeV1 = Readonly<{
  schemaVersion: 1;
  studyManifestId: string;
  freezeCutoffMs: number;
  collectionCodeCommit: string;
  collectionConfigurationDigest: string;
  executionIds: readonly string[];
  artifactInventoryDigest: string;
  sourceObservationIds: readonly string[];
  revisionIds: readonly string[];
  marketReferenceJoinKeys: readonly string[];
  referenceResultIds: readonly string[];
  discrepancyIds: readonly string[];
  metricRecordIds: readonly string[];
  denominatorAccounting: readonly JsonValue[];
  datasetFreezePolicyVersion: string;
  expectedDatasetFreezeId: string;
}>;

/**
 * Validation-only immutable evidence for one of the six required primary
 * market-reference results. This is deliberately separate from the dataset
 * identity preimage: the dataset binds the inventories while validation
 * proves that every accounting row byte-matches an already recorded result.
 */
export type StudyDatasetMarketResultEvidenceV1 = Readonly<{
  studyClusterId: string;
  endpointKind: "Cprev" | "Qpre" | "Q0" | "Q1" | "Q5" | "Q30";
  referenceKind:
    | "quote-nbbo-midpoint"
    | "trade-last-eligible-consolidated"
    | "bar-one-minute-completed-close"
    | "prior-listing-official-close";
  viewKind: "recorded-primary" | "recorded-corrected";
  resultId: string;
  resultStatus: "selected-complete" | "selected-degraded" | "missing";
  asOfBasis: MarketResultAsOfBasisV1;
  preservedMissingReason: JsonValue | null;
  diagnostics: readonly JsonValue[];
  marketReferenceJoinKey: string;
  sourceObservationIds: readonly string[];
  revisionIds: readonly string[];
  discrepancyIds: readonly string[];
  executionIds: readonly string[];
  correctedCutoffMs: number;
}>;

export type StudyAnchorTelemetryV1 = Readonly<{
  captureBasis: Extract<TrustedObservationBasisV1, Readonly<{ basisKind: "capture" }>>;
  retrievalBasis: Extract<TrustedObservationBasisV1, Readonly<{ basisKind: "retrieval" }>>;
  captureMinusRetrievalMs: number | null;
  latencyStudyReason: JsonValue | null;
}>;

export type StudyDatasetMetricRecordEvidenceV1 = Readonly<{
  metricRecordId: string;
  studyClusterId: string;
  metricId:
    | "E1.complete-primary"
    | "E2.observed-within-15m"
    | "E3.informative-residual-5m"
    | "E4.deterministic-reproduction"
    | "priorCloseMovementAtFirstObservation"
    | "releaseGapMovement"
    | "residualMovement1m"
    | "residualMovement30m"
    | "residualMovement5m";
}>;

export type StudyDatasetClusterOutcomeEvidenceV1 = Readonly<{
  studyClusterId: string;
  actualSession: StudySessionV1;
  releaseStatus: "observed" | "not-observed";
  primaryAnchorStatus: "trusted" | "missing" | "invalid";
  eventTMinusOneSnapshotId: string | null;
  providerComparison: "agree" | "disagree" | "not-comparable";
  retrievalSensitivityStatus: "complete" | "incomplete";
  anchorTelemetry: StudyAnchorTelemetryV1;
}>;

export type StudyDatasetValidationEvidenceV1 = Readonly<{
  collectionConfigurationDigest: string;
  artifactInventoryDigest: string;
  datasetFreezePolicyVersion: typeof STUDY_DATASET_FREEZE_POLICY_VERSION;
  marketResults: readonly StudyDatasetMarketResultEvidenceV1[];
  metricRecords: readonly StudyDatasetMetricRecordEvidenceV1[];
  clusterOutcomes: readonly StudyDatasetClusterOutcomeEvidenceV1[];
}>;

export type StudyRunPrerequisitesV1 = Readonly<{
  p108ImplementationGo: boolean;
  p109EntitlementGo: boolean;
  p110AcquisitionGo: boolean;
  p106EvidenceCaptureGo: boolean;
  providerFrozen: boolean;
  datasetFrozen: boolean;
  feedFrozen: boolean;
  endpointFrozen: boolean;
  entitlementFrozen: boolean;
  fallbackFrozen: boolean;
  zeroIncrementalSpend: true;
  firstOutcomeAtMs: number | null;
}>;

export class StudyContractError extends Error {
  public readonly reasonCode: string;
  public readonly detail: Readonly<Record<string, string>> | null;

  public constructor(
    reasonCode: string,
    message: string,
    detail: Readonly<Record<string, string>> | null = null,
  ) {
    const fatalDetails: Readonly<
      Record<string, null | Readonly<{ key: string; values: readonly string[] }>>
    > = {
      "study.bound-exceeded": {
        key: "limitKind",
        values: STUDY_BOUND_IDS,
      },
      "study.input-invalid": null,
      "study.frame-not-frozen": {
        key: "frameFailureKind",
        values: [
          "snapshot-missing",
          "snapshot-mutable",
          "seed-unfrozen",
          "policy-unfrozen",
          "contract-unbound",
        ],
      },
      "study.freeze-after-outcome": {
        key: "freezeFailureKind",
        values: ["equal-to-first-outcome", "after-first-outcome"],
      },
      "study.outcome-leakage": {
        key: "leakageFieldKind",
        values: [
          "actual-release",
          "price",
          "latency",
          "condition",
          "availability",
          "correction",
          "market-result",
          "post-frame",
        ],
      },
      "study.duplicate-cluster": {
        key: "duplicateFailureKind",
        values: ["duplicate-identity", "conflicting-preimage"],
      },
      "study.quota-insufficient": {
        key: "quotaKind",
        values: ["lane", "control", "stratum"],
      },
      "study.rank-invalid": {
        key: "rankFailureKind",
        values: ["seed", "hash", "ordering", "allocation"],
      },
      "study.primary-provider-unfrozen": {
        key: "providerFreezeKind",
        values: ["provider", "dataset", "feed", "endpoint", "entitlement", "fallback"],
      },
      "study.anchor-policy-invalid": {
        key: "anchorFailureKind",
        values: [
          "capture-not-primary",
          "retrieval-not-required",
          "policy-missing",
          "retrieved-at-reinterpreted",
        ],
      },
      "study.replay-mismatch": null,
    };
    const detailRule = fatalDetails[reasonCode];
    if (!(reasonCode in fatalDetails)) {
      throw new TypeError(`StudyContractError reason is not a closed fatal code: ${reasonCode}`);
    }
    if (
      (detailRule === null && detail !== null) ||
      (detailRule !== null &&
        (detail === null ||
          detailRule === undefined ||
          Object.keys(detail).length !== 1 ||
          typeof detail[detailRule.key] !== "string" ||
          !detailRule.values.includes(detail[detailRule.key] as string)))
    ) {
      throw new TypeError(`StudyContractError detail is invalid for ${reasonCode}`);
    }
    super(`${reasonCode}: ${message}`);
    this.name = "StudyContractError";
    this.reasonCode = reasonCode;
    this.detail = detail;
  }
}
