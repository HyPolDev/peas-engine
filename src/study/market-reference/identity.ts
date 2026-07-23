import { createHash } from "node:crypto";

import { canonicalHash } from "../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../core/json.js";
import type {
  StudyClusterCandidateV1,
  StudyClusterSelectionV1,
  StudyDatasetFreezeV1,
  StudyDesignV1,
  StudyFrameSnapshotV1,
  StudyFreezeManifestV1,
  StudyReleaseClusterBasisV1,
} from "./contracts.js";

function withoutExpectedId<T extends Readonly<Record<string, unknown>>>(
  value: T,
  expectedIdKey: keyof T,
): JsonValue {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== expectedIdKey),
  ) as JsonValue;
}

export function deriveReleaseClusterKey(
  issuerMappingId: string,
  releaseKind: "quarterly" | "annual",
  clusterBasis: StudyReleaseClusterBasisV1,
): string {
  return createHash("sha256")
    .update(canonicalJson({ issuerMappingId, releaseKind, clusterBasis }))
    .digest("hex");
}

export function deriveStudyClusterCandidateId(candidate: StudyClusterCandidateV1): string {
  return `scc1_${canonicalHash("peas/event-study-cluster-candidate/v1", candidate)}`;
}

export function deriveStudyDesignId(design: StudyDesignV1): string {
  const preimage = {
    designVersion: design.designVersion,
    contractAuthorityRegistryId: design.contractAuthorityRegistryId,
    acceptedContractIds: design.acceptedContractIds,
    algorithms: design.algorithms,
    metricDefinitions: design.metricDefinitions,
    gateThresholds: design.gateThresholds,
    missingPolicyId: design.missingPolicyId,
    outlierPolicyId: design.outlierPolicyId,
    multiplicityPolicyId: design.multiplicityPolicyId,
    correctionPolicyId: design.correctionPolicyId,
    sensitivityPolicyId: design.sensitivityPolicyId,
    boundsPolicyId: design.boundsPolicyId,
    analysisCodeDigest: design.analysisCodeDigest,
  } as const;
  return `std1_${canonicalHash("peas/study-design/v1", preimage)}`;
}

export function deriveStudyFrameSnapshotId(frame: StudyFrameSnapshotV1): string {
  const candidates = frame.candidates.map((candidate) =>
    withoutExpectedId(candidate, "expectedClusterCandidateId"),
  );
  const preimage = {
    studyDesignId: frame.studyDesignId,
    contractAuthorityRegistryId: frame.contractAuthorityRegistryId,
    samplingFrameAsOfMs: frame.samplingFrameAsOfMs,
    calendarSnapshotId: frame.calendarSnapshotId,
    scheduleSourcePolicyId: frame.scheduleSourcePolicyId,
    frameConstructionCodeDigest: frame.frameConstructionCodeDigest,
    configurationDigest: frame.configurationDigest,
    preFrameEvidenceSnapshotId: frame.preFrameEvidenceSnapshotId,
    rankSeedMaterialId: frame.rankSeedMaterialId,
    rankSeedHex: frame.rankSeedHex,
    seedCommittedAtMs: frame.seedCommittedAtMs,
    frameConstructedAtMs: frame.frameConstructedAtMs,
    candidates,
    dispositions: frame.dispositions,
  } as const;
  return `sfs1_${canonicalHash("peas/study-frame-snapshot/v1", preimage)}`;
}

export function deriveStudyClusterId(cluster: StudyClusterSelectionV1): string {
  const preimage = {
    clusterCandidateId: cluster.clusterCandidateId,
    frameSnapshotId: cluster.frameSnapshotId,
    lane: cluster.lane,
    controlGroup: cluster.controlGroup,
    strata: cluster.strata,
    rank: cluster.rank,
    allocationCell: cluster.allocationCell,
    selectionFraction: cluster.selectionFraction,
  } as const;
  return `scl1_${canonicalHash("peas/study-cluster/v1", preimage)}`;
}

export function deriveStudyManifestId(manifest: StudyFreezeManifestV1): string {
  const selectedClusters = manifest.selectedClusters.map((cluster) =>
    withoutExpectedId(cluster, "expectedStudyClusterId"),
  );
  const preimage = {
    studyDesignId: manifest.studyDesignId,
    codeCommit: manifest.codeCommit,
    configurationDigest: manifest.configurationDigest,
    contractAuthorityRegistryId: manifest.contractAuthorityRegistryId,
    contractIds: manifest.contractIds,
    calendarSnapshotId: manifest.calendarSnapshotId,
    entitlementSnapshotIds: manifest.entitlementSnapshotIds,
    providerSourcePolicyId: manifest.providerSourcePolicyId,
    selectionPolicyId: manifest.selectionPolicyId,
    primaryAnchorKind: manifest.primaryAnchorKind,
    alternateAnchorRequired: manifest.alternateAnchorRequired,
    readyAtMs: manifest.readyAtMs,
    samplingFrameAsOfMs: manifest.samplingFrameAsOfMs,
    freezePublishedAtMs: manifest.freezePublishedAtMs,
    collectionSessions: manifest.collectionSessions,
    correctionLagMs: manifest.correctionLagMs,
    rankSeedMaterialId: manifest.rankSeedMaterialId,
    rankSeedHex: manifest.rankSeedHex,
    frameSnapshotId: manifest.frameSnapshotId,
    selectedClusters,
    expectedCounts: manifest.expectedCounts,
  } as const;
  return `sfm1_${canonicalHash("peas/study-freeze-manifest/v1", preimage)}`;
}

export function deriveStudyDatasetFreezeId(dataset: StudyDatasetFreezeV1): string {
  const preimage = {
    studyManifestId: dataset.studyManifestId,
    freezeCutoffMs: dataset.freezeCutoffMs,
    collectionCodeCommit: dataset.collectionCodeCommit,
    collectionConfigurationDigest: dataset.collectionConfigurationDigest,
    executionIds: dataset.executionIds,
    artifactInventoryDigest: dataset.artifactInventoryDigest,
    sourceObservationIds: dataset.sourceObservationIds,
    revisionIds: dataset.revisionIds,
    marketReferenceJoinKeys: dataset.marketReferenceJoinKeys,
    referenceResultIds: dataset.referenceResultIds,
    discrepancyIds: dataset.discrepancyIds,
    metricRecordIds: dataset.metricRecordIds,
    denominatorAccounting: dataset.denominatorAccounting,
    datasetFreezePolicyVersion: dataset.datasetFreezePolicyVersion,
  } as const;
  return `sdf1_${canonicalHash("peas/study-dataset-freeze/v1", preimage)}`;
}

export function derivePreFrameEvidenceSnapshotId(
  input: Readonly<{
    contractAuthorityRegistryId: string;
    studyDesignId: string;
    samplingFrameAsOfMs: number;
    calendarSnapshotId: string;
    scheduleSourcePolicyId: string;
    frameConstructionCodeDigest: string;
    configurationDigest: string;
    sourceObservationIds: readonly string[];
    artifactInventoryDigest: string;
  }>,
): string {
  return `pfe1_${canonicalHash("peas/study-pre-frame-evidence/v1", input)}`;
}

export function deriveRankSeedMaterialId(
  input: Readonly<{
    contractAuthorityRegistryId: string;
    studyDesignId: string;
    samplingFrameAsOfMs: number;
    calendarSnapshotId: string;
    scheduleSourcePolicyId: string;
    frameConstructionCodeDigest: string;
    configurationDigest: string;
    preFrameEvidenceSnapshotId: string;
  }>,
): string {
  return `rsm1_${canonicalHash("peas/study-rank-seed-material/v1", input)}`;
}

export function deriveRankSeedHex(rankSeedMaterialId: string): string {
  return canonicalHash("peas/study-rank-seed/v1", { rankSeedMaterialId });
}
