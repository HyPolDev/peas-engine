export const STUDY_BOUND_IDS = [
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
] as const;

export type StudyBoundIdV1 = (typeof STUDY_BOUND_IDS)[number];
export type StudyBoundAtomicityV1 = "study-run" | "metric";
export type StudyBoundViolationV1 =
  | "study.bound-exceeded"
  | "study.input-invalid"
  | "study.liquidity-unknown"
  | "study.timeliness-threshold-not-met"
  | "study.correction-after-cutoff";

export type StudyBoundEvaluationV1 = Readonly<
  | { accepted: true; boundId: StudyBoundIdV1; atomicity: StudyBoundAtomicityV1 }
  | {
      accepted: false;
      boundId: StudyBoundIdV1;
      atomicity: StudyBoundAtomicityV1;
      violation: StudyBoundViolationV1;
    }
>;

const MAXIMUM_LIMITS: Readonly<Partial<Record<StudyBoundIdV1, number>>> = Object.freeze({
  candidateFrameMembers: 8_192,
  frameDispositionOrStratumCells: 2_048,
  selectedClusterEntryBytes: 65_536,
  completeStudyManifestBytes: 33_554_432,
  datasetFreezeBundleBytes: 67_108_864,
  studyJsonDepth: 12,
  studyJsonNodesTotal: 500_000,
  studyKeysPerObject: 64,
  studyGenericArrayItems: 256,
  studyStringBytes: 4_096,
  studyIdentifierBytes: 512,
  contractSourceEntitlementIds: 64,
  reasonDefinitions: 64,
  metricDefinitions: 32,
  sensitivityDefinitions: 32,
  referencesPerCluster: 64,
  referencesTotal: 12_800,
  annotationsPerCluster: 64,
  revisionsReferencedPerCluster: 32,
  strataDimensions: 8,
  collectionCalendarSpanMs: 10_368_000_000,
});

const EXACT_COUNTS: Readonly<Partial<Record<StudyBoundIdV1, number>>> = Object.freeze({
  targetClusters: 180,
  collectionSessions: 65,
  liquidityHistorySessions: 20,
  bootstrapReplicates: 10_000,
  holmSlots: 24,
});

function result(
  boundId: StudyBoundIdV1,
  accepted: boolean,
  violation: StudyBoundViolationV1 = "study.input-invalid",
): StudyBoundEvaluationV1 {
  const atomicity: StudyBoundAtomicityV1 = [
    "minimumValidLiquiditySessions",
    "timelyObservationMs",
    "correctionLagMs",
  ].includes(boundId)
    ? "metric"
    : "study-run";
  return accepted
    ? { accepted: true, boundId, atomicity }
    : { accepted: false, boundId, atomicity, violation };
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Public executable boundary evaluator for every study-owned canonical bound.
 * It is intentionally independent from the descriptive core registry so tests
 * exercise the same acceptance/rejection algorithm used by study validators.
 */
export function evaluateStudyBound(
  boundId: StudyBoundIdV1,
  observed: number | readonly number[],
): StudyBoundEvaluationV1 {
  if (boundId === "laneTargets" || boundId === "controlTargets") {
    if (!Array.isArray(observed) || observed.some((value) => !isNonnegativeSafeInteger(value))) {
      return result(boundId, false);
    }
    const exact = boundId === "laneTargets" ? [120, 40, 20] : [5, 5, 5, 5];
    return result(
      boundId,
      observed.length === exact.length && observed.every((value, index) => value === exact[index]),
    );
  }
  if (!isNonnegativeSafeInteger(observed)) return result(boundId, false);
  if (boundId === "targetClusters" && (observed < 100 || observed > 200)) {
    return result(boundId, false, "study.bound-exceeded");
  }
  const exactCount = EXACT_COUNTS[boundId];
  if (exactCount !== undefined) return result(boundId, observed === exactCount);
  if (boundId === "minimumValidLiquiditySessions") {
    return result(boundId, observed >= 15 && observed <= 20, "study.liquidity-unknown");
  }
  if (boundId === "timelyObservationMs") {
    return result(boundId, observed <= 900_000, "study.timeliness-threshold-not-met");
  }
  if (boundId === "correctionLagMs") {
    return result(boundId, observed <= 604_800_000, "study.correction-after-cutoff");
  }
  const maximum = MAXIMUM_LIMITS[boundId];
  if (maximum === undefined) return result(boundId, false);
  return result(boundId, observed <= maximum, "study.bound-exceeded");
}
