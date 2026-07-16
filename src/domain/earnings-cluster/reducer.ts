import { z } from "zod";

import type { StoredEvent } from "../../core/event.js";
import { canonicalHash } from "../../core/hash.js";
import {
  assertJson,
  assertJsonWithinLimits,
  canonicalJson,
  cloneJson,
  inertJsonSnapshot,
  type JsonObject,
  type JsonValue,
} from "../../core/json.js";
import {
  deriveJobId,
  deriveMessageId,
  type DecisionDraft,
  type JobDraft,
  type Reducer,
  type ReducerContext,
  type Transition,
} from "../../core/processor.js";
import {
  computeProviderEvidenceBundleHash,
  type EvidenceReference,
  ProviderEvidenceBundleError,
} from "../../providers/evidence-bundle.js";
import { SecContractError, validateSecEvidenceBundle } from "../../providers/sec/contracts.js";

export type EarningsClusterConfig = {
  mirrorDebounceMs: number;
  lifecycleMs: number;
  maxSourcesPerCluster: number;
  maxAnalysisBranches: number;
  maxAnalysisResultBytes: number;
};

// Each analysis branch freezes its source inputs, so aggregate size grows with
// sources x branches. These are audit boundaries, not configurable defaults.
export const MAX_EARNINGS_CLUSTER_SOURCES = 32;
export const MAX_EARNINGS_ANALYSIS_BRANCHES = 32;
export const MAX_EARNINGS_SOURCE_EVIDENCE_REFERENCES = 16;
export const MAX_EARNINGS_ANALYSIS_MEMBERSHIPS = 512;
export const MAX_EARNINGS_ANALYSIS_ARTIFACTS = 512;
export const MAX_EARNINGS_RETAINED_BRANCH_MEMBERSHIPS = 16_384;
export const MAX_EARNINGS_AGGREGATE_STATE_BYTES = 8 * 1024 * 1024;

export type SourceKind =
  | "issuer_release"
  | "fmp_release"
  | "sec_8k"
  | "call"
  | "transcript"
  | "filing";

export type SourceObservation = {
  eventSchemaVersion: 1 | 2;
  eventId: string;
  eventHash: string;
  position: string;
  sourceKind: SourceKind;
  primaryArtifactHash: string;
  evidenceBundleHash: string | null;
  evidence: EvidenceReference[];
  provider: string;
  providerRecordId: string;
  providerRevisionId: string;
  publishedAtMs: number | null;
  receivedAtMs: number;
  timestampConfidence: "exact" | "provider" | "inferred" | "unknown";
  originalTimestamp: string | null;
};

export type TimerExpectation = {
  timerType: "earnings.mirror-debounce" | "earnings.lifecycle-finalize";
  jobId: string;
  scheduledForLogicalMs: number;
  status: "pending" | "fired";
};

export type AnalysisInput = {
  eventSchemaVersion: 1 | 2;
  eventId: string;
  eventHash: string;
  position: string;
  sourceKind: SourceKind;
  primaryArtifactHash: string;
  evidenceBundleHash: string | null;
  evidence: EvidenceReference[];
  provider: string;
  providerRecordId: string;
  providerRevisionId: string;
};

export type AnalysisContract = {
  extractorVersion: string;
  featureSetId: string | null;
  promptId: string | null;
  modelId: string | null;
  datasetId: string | null;
};

export type AnalysisBranch = {
  branchId: string;
  phase: "first_source" | "source_confirmation" | "call_second_wave" | "incremental_filing";
  jobId: string;
  inputBundleHash: string;
  inputSources: AnalysisInput[];
  artifactCatalog: string[];
  analysisContract: AnalysisContract;
  analysisContractHash: string;
  status: "pending" | "succeeded" | "failed";
  requestedAtMs: number;
  expectedAttempt: number;
  expectedFencingToken: number;
  resultEventId: string | null;
  resultHash: string | null;
  errorCode: string | null;
};

export type EarningsCluster = {
  clusterId: string;
  issuerCik: string;
  fiscalPeriod: string;
  status: "open" | "finalized";
  firstObservedAtMs: number;
  lifecycleEndsAtMs: number;
  finalizedAtMs: number | null;
  sources: SourceObservation[];
  timers: TimerExpectation[];
  analysisBranches: AnalysisBranch[];
};

export type EarningsClusterState = {
  schemaVersion: 4;
  aggregateId: string;
  cluster: EarningsCluster | null;
  rejectionCount: number;
};

export type EarningsAnalysisJobPayload = {
  clusterId: string;
  branchId: string;
  phase: AnalysisBranch["phase"];
  inputBundleHash: string;
  inputSources: AnalysisInput[];
  artifactCatalog: string[];
  analysisContract: AnalysisContract;
  analysisContractHash: string;
};

export type EarningsAnalysisResultProvenance = AnalysisContract & {
  analysisContractHash: string;
  inputSources: AnalysisInput[];
  artifactCatalog: string[];
};

const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const positiveSafeInteger = z.number().int().positive().safe();
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const configSchema = z
  .object({
    mirrorDebounceMs: positiveSafeInteger,
    lifecycleMs: positiveSafeInteger,
    maxSourcesPerCluster: positiveSafeInteger.max(MAX_EARNINGS_CLUSTER_SOURCES),
    maxAnalysisBranches: positiveSafeInteger.max(MAX_EARNINGS_ANALYSIS_BRANCHES),
    maxAnalysisResultBytes: positiveSafeInteger.max(10_000_000),
  })
  .strict();
const sourceKindSchema = z.enum([
  "issuer_release",
  "fmp_release",
  "sec_8k",
  "call",
  "transcript",
  "filing",
]);
const timestampFields = {
  publishedAtMs: nonnegativeSafeInteger.nullable(),
  timestampConfidence: z.enum(["exact", "provider", "inferred", "unknown"]),
  originalTimestamp: z.string().max(512).nullable(),
} as const;
const sourceObservedV1Schema = z
  .object({
    issuerCik: z.string().regex(/^\d{1,10}$/u),
    fiscalPeriod: z.string().regex(/^\d{4}-(?:Q[1-4]|FY)$/u),
    sourceKind: sourceKindSchema,
    artifactHash: hash,
    ...timestampFields,
  })
  .strict();
const evidenceReferenceSchema = z
  .object({
    role: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
    artifactHash: hash,
  })
  .strict();
const sourceObservedV2Schema = z
  .object({
    issuerCik: z.string().regex(/^\d{10}$/u),
    fiscalPeriod: z.string().regex(/^\d{4}-(?:Q[1-4]|FY)$/u),
    sourceKind: z.enum(["sec_8k", "filing"]),
    primaryArtifactHash: hash,
    evidenceBundleHash: hash,
    evidence: z.array(evidenceReferenceSchema).min(1).max(MAX_EARNINGS_SOURCE_EVIDENCE_REFERENCES),
    ...timestampFields,
  })
  .strict();
const sourceRouteSchema = z.object({
  issuerCik: z.string().regex(/^\d{1,10}$/u),
  fiscalPeriod: z.string().regex(/^\d{4}-(?:Q[1-4]|FY)$/u),
});
const timerFiredSchema = z
  .object({
    timerType: z.enum(["earnings.mirror-debounce", "earnings.lifecycle-finalize"]),
    clusterId: hash,
    jobId: hash,
    scheduledForLogicalMs: nonnegativeSafeInteger,
    fencingToken: positiveSafeInteger,
  })
  .strict();
const analysisContractSchema = z
  .object({
    extractorVersion: z.string().min(1).max(256),
    featureSetId: z.string().min(1).max(256).nullable(),
    promptId: z.string().min(1).max(256).nullable(),
    modelId: z.string().min(1).max(256).nullable(),
    datasetId: z.string().min(1).max(256).nullable(),
  })
  .strict();
const jobLeasedSchema = z
  .object({
    jobType: z.literal("earnings.cluster.analyze"),
    clusterId: hash,
    branchId: hash,
    jobId: hash,
    inputBundleHash: hash,
    attempt: positiveSafeInteger,
    fencingToken: positiveSafeInteger,
  })
  .strict();
const jobFailedSchema = z
  .object({
    jobType: z.literal("earnings.cluster.analyze"),
    clusterId: hash,
    branchId: hash,
    jobId: hash,
    inputBundleHash: hash,
    attempt: positiveSafeInteger,
    fencingToken: positiveSafeInteger,
    errorCode: z.string().min(1).max(256),
  })
  .strict();
const sourceProvenanceFields = {
  eventId: hash,
  eventHash: hash,
  position: z.string().regex(/^\d+$/u),
  sourceKind: sourceKindSchema,
  primaryArtifactHash: hash,
  evidence: z.array(evidenceReferenceSchema).min(1).max(MAX_EARNINGS_SOURCE_EVIDENCE_REFERENCES),
  provider: z.string().min(1).max(512),
  providerRecordId: z.string().min(1).max(512),
  providerRevisionId: z.string().min(1).max(512),
} as const;
const sourceObservationV1Schema = z
  .object({
    eventSchemaVersion: z.literal(1),
    ...sourceProvenanceFields,
    evidenceBundleHash: z.null(),
    publishedAtMs: nonnegativeSafeInteger.nullable(),
    receivedAtMs: nonnegativeSafeInteger,
    timestampConfidence: z.enum(["exact", "provider", "inferred", "unknown"]),
    originalTimestamp: z.string().max(512).nullable(),
  })
  .strict()
  .superRefine((value, context) => validateLegacyEvidence(value, context));
const sourceObservationV2Schema = z
  .object({
    eventSchemaVersion: z.literal(2),
    ...sourceProvenanceFields,
    evidenceBundleHash: hash,
    publishedAtMs: nonnegativeSafeInteger.nullable(),
    receivedAtMs: nonnegativeSafeInteger,
    timestampConfidence: z.enum(["exact", "provider", "inferred", "unknown"]),
    originalTimestamp: z.string().max(512).nullable(),
  })
  .strict()
  .superRefine((value, context) => validateV2Evidence(value, context));
const sourceObservationSchema = z.union([sourceObservationV1Schema, sourceObservationV2Schema]);
const timerExpectationSchema = z
  .object({
    timerType: z.enum(["earnings.mirror-debounce", "earnings.lifecycle-finalize"]),
    jobId: hash,
    scheduledForLogicalMs: nonnegativeSafeInteger,
    status: z.enum(["pending", "fired"]),
  })
  .strict();
const analysisInputV1Schema = z
  .object({
    eventSchemaVersion: z.literal(1),
    ...sourceProvenanceFields,
    evidenceBundleHash: z.null(),
  })
  .strict()
  .superRefine((value, context) => validateLegacyEvidence(value, context));
const analysisInputV2Schema = z
  .object({
    eventSchemaVersion: z.literal(2),
    ...sourceProvenanceFields,
    evidenceBundleHash: hash,
  })
  .strict()
  .superRefine((value, context) => validateV2Evidence(value, context));
const analysisInputSchema = z.union([analysisInputV1Schema, analysisInputV2Schema]);
const artifactCatalogSchema = z.array(hash).max(MAX_EARNINGS_ANALYSIS_ARTIFACTS);
const analysisProvenanceSchema = analysisContractSchema
  .extend({
    analysisContractHash: hash,
    inputSources: z.array(analysisInputSchema).min(1).max(MAX_EARNINGS_CLUSTER_SOURCES),
    artifactCatalog: artifactCatalogSchema,
  })
  .strict()
  .superRefine((value, context) => validateInputCollection(value, context, false));
const analysisJobPayloadSchema = z
  .object({
    clusterId: hash,
    branchId: hash,
    phase: z.enum([
      "first_source",
      "source_confirmation",
      "call_second_wave",
      "incremental_filing",
    ]),
    inputBundleHash: hash,
    inputSources: z.array(analysisInputSchema).min(1).max(MAX_EARNINGS_CLUSTER_SOURCES),
    artifactCatalog: artifactCatalogSchema,
    analysisContract: analysisContractSchema,
    analysisContractHash: hash,
  })
  .strict()
  .superRefine((value, context) => validateInputCollection(value, context, true));
const jobSucceededSchema = z
  .object({
    jobType: z.literal("earnings.cluster.analyze"),
    clusterId: hash,
    branchId: hash,
    jobId: hash,
    inputBundleHash: hash,
    attempt: positiveSafeInteger,
    fencingToken: positiveSafeInteger,
    provenance: analysisProvenanceSchema,
    result: z.record(z.string(), z.unknown()),
  })
  .strict();
const analysisBranchSchema = z
  .object({
    branchId: hash,
    phase: z.enum([
      "first_source",
      "source_confirmation",
      "call_second_wave",
      "incremental_filing",
    ]),
    jobId: hash,
    inputBundleHash: hash,
    inputSources: z.array(analysisInputSchema).min(1).max(MAX_EARNINGS_CLUSTER_SOURCES),
    artifactCatalog: artifactCatalogSchema,
    analysisContract: analysisContractSchema,
    analysisContractHash: hash,
    status: z.enum(["pending", "succeeded", "failed"]),
    requestedAtMs: nonnegativeSafeInteger,
    expectedAttempt: nonnegativeSafeInteger,
    expectedFencingToken: nonnegativeSafeInteger,
    resultEventId: hash.nullable(),
    resultHash: hash.nullable(),
    errorCode: z.string().min(1).max(256).nullable(),
  })
  .strict()
  .superRefine((value, context) => validateInputCollection(value, context, true));
const clusterSchema = z
  .object({
    clusterId: hash,
    issuerCik: z.string().regex(/^\d{10}$/u),
    fiscalPeriod: z.string().regex(/^\d{4}-(?:Q[1-4]|FY)$/u),
    status: z.enum(["open", "finalized"]),
    firstObservedAtMs: nonnegativeSafeInteger,
    lifecycleEndsAtMs: nonnegativeSafeInteger,
    finalizedAtMs: nonnegativeSafeInteger.nullable(),
    sources: z.array(sourceObservationSchema).max(MAX_EARNINGS_CLUSTER_SOURCES),
    timers: z.array(timerExpectationSchema).max(16),
    analysisBranches: z.array(analysisBranchSchema).max(MAX_EARNINGS_ANALYSIS_BRANCHES),
  })
  .strict()
  .superRefine((value, context) => {
    const sourceIds = new Set<string>();
    for (const source of value.sources) {
      if (sourceIds.has(source.eventId)) {
        context.addIssue({ code: "custom", message: "Source event IDs must be unique" });
      }
      sourceIds.add(source.eventId);
      if (canonicalJson(source.evidence) !== canonicalJson(canonicalEvidence(source.evidence))) {
        context.addIssue({ code: "custom", message: "Persisted source evidence is not canonical" });
      }
      if (source.eventSchemaVersion === 2) {
        try {
          validateSecEvidenceBundle({
            provider: source.provider,
            source: "sec:normalizer-v1",
            recordId: source.providerRecordId,
            revisionId: source.providerRevisionId,
            subject: `earnings:${value.issuerCik}:${value.fiscalPeriod}`,
            issuerCik: value.issuerCik,
            fiscalPeriod: value.fiscalPeriod,
            sourceKind: source.sourceKind,
            primaryArtifactHash: source.primaryArtifactHash,
            evidence: source.evidence,
            evidenceBundleHash: source.evidenceBundleHash,
          });
        } catch {
          context.addIssue({
            code: "custom",
            message: "Persisted V2 evidence identity is invalid",
          });
        }
      }
    }
    let retainedMemberships = 0;
    const branchIds = new Set<string>();
    const branchJobIds = new Set<string>();
    for (const branch of value.analysisBranches) {
      if (branchIds.has(branch.branchId) || branchJobIds.has(branch.jobId)) {
        context.addIssue({ code: "custom", message: "Analysis branch and job IDs must be unique" });
      }
      branchIds.add(branch.branchId);
      branchJobIds.add(branch.jobId);
      retainedMemberships += membershipCount(branch.inputSources);
      for (const input of branch.inputSources) {
        const source = value.sources.find((candidate) => candidate.eventId === input.eventId);
        if (source === undefined || canonicalJson(analysisInput(source)) !== canonicalJson(input)) {
          context.addIssue({
            code: "custom",
            message: "Branch input is not frozen source provenance",
          });
        }
      }
    }
    if (retainedMemberships > MAX_EARNINGS_RETAINED_BRANCH_MEMBERSHIPS) {
      context.addIssue({ code: "custom", message: "Retained branch memberships exceed capacity" });
    }
  });
const stateSchema = z
  .object({
    schemaVersion: z.literal(4),
    aggregateId: z.string().min(1).max(512),
    cluster: clusterSchema.nullable(),
    rejectionCount: nonnegativeSafeInteger,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cluster !== null && value.aggregateId !== value.cluster.clusterId) {
      context.addIssue({ code: "custom", message: "Aggregate and cluster identity must match" });
    }
  });

const SEC_EVIDENCE_ROLES = new Set([
  "sec.submissions",
  "sec.filing-index",
  "sec.primary-document",
  "sec.exhibit-99.1",
  "sec.periodic-report",
  "sec.xbrl-instance",
]);

function compareEvidence(left: EvidenceReference, right: EvidenceReference): number {
  const leftValue = left.role === right.role ? left.artifactHash : left.role;
  const rightValue = left.role === right.role ? right.artifactHash : right.role;
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function canonicalEvidence(evidence: readonly EvidenceReference[]): EvidenceReference[] {
  return evidence.map((member) => ({ ...member })).sort(compareEvidence);
}

function validateEvidenceUniqueness(
  value: { evidence: readonly EvidenceReference[] },
  context: z.RefinementCtx,
): void {
  const digests = new Set<string>();
  for (const member of value.evidence) {
    if (digests.has(member.artifactHash)) {
      context.addIssue({ code: "custom", message: "Evidence artifact digests must be unique" });
    }
    digests.add(member.artifactHash);
  }
}

function validateLegacyEvidence(
  value: { primaryArtifactHash: string; evidence: readonly EvidenceReference[] },
  context: z.RefinementCtx,
): void {
  validateEvidenceUniqueness(value, context);
  if (
    value.evidence.length !== 1 ||
    value.evidence[0]?.role !== "legacy.primary" ||
    value.evidence[0]?.artifactHash !== value.primaryArtifactHash
  ) {
    context.addIssue({ code: "custom", message: "V1 evidence must be one legacy.primary member" });
  }
}

function validateV2Evidence(
  value: {
    sourceKind: SourceKind;
    primaryArtifactHash: string;
    evidence: readonly EvidenceReference[];
  },
  context: z.RefinementCtx,
): void {
  validateEvidenceUniqueness(value, context);
  if (value.sourceKind !== "sec_8k" && value.sourceKind !== "filing") {
    context.addIssue({ code: "custom", message: "V2 source kind must be SEC-backed" });
    return;
  }
  for (const member of value.evidence) {
    if (!SEC_EVIDENCE_ROLES.has(member.role)) {
      context.addIssue({ code: "custom", message: "V2 evidence contains an unknown SEC role" });
    }
  }
  const expectedPrimaryRole =
    value.sourceKind === "sec_8k" ? "sec.exhibit-99.1" : "sec.primary-document";
  const primary = value.evidence.filter(
    (member) => member.artifactHash === value.primaryArtifactHash,
  );
  if (primary.length !== 1 || primary[0]?.role !== expectedPrimaryRole) {
    context.addIssue({ code: "custom", message: "V2 primary evidence membership is invalid" });
  }
}

function compareDecimal(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareAnalysisInputs(left: AnalysisInput, right: AnalysisInput): number {
  const position = compareDecimal(left.position, right.position);
  if (position !== 0) return position;
  return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
}

function canonicalAnalysisInputs(inputs: readonly AnalysisInput[]): AnalysisInput[] {
  return inputs
    .map((input) => ({ ...input, evidence: canonicalEvidence(input.evidence) }))
    .sort(compareAnalysisInputs);
}

function membershipCount(inputs: readonly AnalysisInput[]): number {
  return inputs.reduce((total, input) => total + input.evidence.length, 0);
}

function artifactCatalog(inputs: readonly AnalysisInput[]): string[] {
  return [
    ...new Set(inputs.flatMap((input) => input.evidence.map((member) => member.artifactHash))),
  ].sort();
}

function validateInputCollection(
  value: { inputSources: readonly AnalysisInput[]; artifactCatalog: readonly string[] },
  context: z.RefinementCtx,
  canonicalRequired: boolean,
): void {
  if (membershipCount(value.inputSources) > MAX_EARNINGS_ANALYSIS_MEMBERSHIPS) {
    context.addIssue({ code: "custom", message: "Analysis memberships exceed capacity" });
  }
  const eventIds = new Set<string>();
  for (const input of value.inputSources) {
    if (eventIds.has(input.eventId)) {
      context.addIssue({ code: "custom", message: "Analysis source event IDs must be unique" });
    }
    eventIds.add(input.eventId);
  }
  const expectedCatalog = artifactCatalog(value.inputSources);
  if (
    new Set(value.artifactCatalog).size !== value.artifactCatalog.length ||
    canonicalJson([...value.artifactCatalog].sort()) !== canonicalJson(expectedCatalog)
  ) {
    context.addIssue({
      code: "custom",
      message: "Analysis artifact catalog is not the exact union",
    });
  }
  if (
    canonicalRequired &&
    (canonicalJson(value.inputSources) !==
      canonicalJson(canonicalAnalysisInputs(value.inputSources)) ||
      canonicalJson(value.artifactCatalog) !== canonicalJson(expectedCatalog))
  ) {
    context.addIssue({ code: "custom", message: "Persisted analysis provenance is not canonical" });
  }
}

function decision(type: string, payload: JsonObject): DecisionDraft {
  return { type, payload };
}

function deriveClusterId(issuerCik: string, fiscalPeriod: string): string {
  return canonicalHash("peas/earnings-cluster-id/v2", {
    issuerCik: canonicalizeCik(issuerCik),
    fiscalPeriod,
  });
}

function canonicalizeCik(issuerCik: string): string {
  return issuerCik.padStart(10, "0");
}

function subjectMatches(subject: string, issuerCik: string, fiscalPeriod: string): boolean {
  const parsed = /^earnings:(\d{1,10}):(\d{4}-(?:Q[1-4]|FY))$/u.exec(subject);
  return (
    parsed !== null &&
    canonicalizeCik(parsed[1] ?? "") === canonicalizeCik(issuerCik) &&
    parsed[2] === fiscalPeriod
  );
}

function rejected(
  state: EarningsClusterState,
  event: StoredEvent,
  reason: string,
): Transition<EarningsClusterState> {
  state.rejectionCount += 1;
  return rejectedWithoutStateChange(state, event, reason);
}

function rejectedWithoutStateChange(
  state: EarningsClusterState,
  event: StoredEvent,
  reason: string,
): Transition<EarningsClusterState> {
  return {
    state,
    decisions: [
      decision("kernel.event.rejected", {
        eventId: event.eventId,
        eventType: event.type,
        reason,
      }),
    ],
    jobs: [],
    outbox: [],
  };
}

function noEffects(
  state: EarningsClusterState,
  entry: DecisionDraft,
): Transition<EarningsClusterState> {
  return { state, decisions: [entry], jobs: [], outbox: [] };
}

function phaseFor(kind: SourceKind, isFirst: boolean): AnalysisBranch["phase"] {
  if (isFirst) return "first_source";
  if (kind === "call" || kind === "transcript") return "call_second_wave";
  if (kind === "filing") return "incremental_filing";
  return "source_confirmation";
}

function isReleaseMirrorKind(kind: SourceKind): boolean {
  return kind === "issuer_release" || kind === "fmp_release" || kind === "sec_8k";
}

function analysisInput(source: SourceObservation): AnalysisInput {
  return {
    eventSchemaVersion: source.eventSchemaVersion,
    eventId: source.eventId,
    eventHash: source.eventHash,
    position: source.position,
    sourceKind: source.sourceKind,
    primaryArtifactHash: source.primaryArtifactHash,
    evidenceBundleHash: source.evidenceBundleHash,
    evidence: canonicalEvidence(source.evidence),
    provider: source.provider,
    providerRecordId: source.providerRecordId,
    providerRevisionId: source.providerRevisionId,
  };
}

function analysisInputs(sources: readonly SourceObservation[]): AnalysisInput[] {
  return canonicalAnalysisInputs(sources.map(analysisInput));
}

function expectedAnalysisContract(
  context: ReducerContext<EarningsClusterConfig>,
): AnalysisContract {
  return {
    extractorVersion: context.identities.extractorVersion,
    featureSetId: context.identities.featureSetId,
    promptId: context.identities.promptId,
    modelId: context.identities.modelId,
    datasetId: context.identities.datasetId,
  };
}

function analysisContractHash(contract: AnalysisContract): string {
  return canonicalHash("peas/earnings-analysis-contract/v1", contract);
}

function inputBundleHash(
  cluster: EarningsCluster,
  phase: AnalysisBranch["phase"],
  inputs: readonly AnalysisInput[],
  artifacts: readonly string[],
  contractHash: string,
): string {
  return canonicalHash("peas/earnings-analysis-input-bundle/v3", {
    clusterId: cluster.clusterId,
    issuerCik: cluster.issuerCik,
    fiscalPeriod: cluster.fiscalPeriod,
    phase,
    analysisContractHash: contractHash,
    sources: inputs,
    artifactCatalog: artifacts,
  });
}

class AnalysisCapacityError extends Error {
  constructor(
    readonly reason: "analysis-membership-limit-exceeded" | "analysis-artifact-limit-exceeded",
  ) {
    super(reason);
  }
}

function timerDraft(
  runId: string,
  clusterId: string,
  timerType: TimerExpectation["timerType"],
  dueAtMs: number,
  recoveryEventId?: string,
): Readonly<{ expectation: TimerExpectation; job: JobDraft }> {
  const payload = { clusterId, timerType, scheduledForLogicalMs: dueAtMs };
  const dedupeKey =
    recoveryEventId === undefined
      ? `timer:${timerType}:${clusterId}`
      : `timer:${timerType}:${clusterId}:recovery:${recoveryEventId}`;
  const inputHash = canonicalHash("peas/timer-input-bundle/v2", payload);
  const jobId = deriveJobId(runId, dedupeKey, payload);
  return {
    expectation: { timerType, jobId, scheduledForLogicalMs: dueAtMs, status: "pending" },
    job: {
      jobId,
      type: "kernel.timer",
      dedupeKey,
      notBeforeLogicalMs: dueAtMs,
      inputBundleHash: inputHash,
      payload,
    },
  };
}

function analysisDraft(
  runId: string,
  cluster: EarningsCluster,
  phase: AnalysisBranch["phase"],
  nowMs: number,
  contract: AnalysisContract,
): Readonly<{ branch: AnalysisBranch; job: JobDraft }> {
  const inputs = analysisInputs(cluster.sources);
  const artifacts = artifactCatalog(inputs);
  if (membershipCount(inputs) > MAX_EARNINGS_ANALYSIS_MEMBERSHIPS) {
    throw new AnalysisCapacityError("analysis-membership-limit-exceeded");
  }
  if (artifacts.length > MAX_EARNINGS_ANALYSIS_ARTIFACTS) {
    throw new AnalysisCapacityError("analysis-artifact-limit-exceeded");
  }
  const contractHash = analysisContractHash(contract);
  const bundleHash = inputBundleHash(cluster, phase, inputs, artifacts, contractHash);
  const branchId = canonicalHash("peas/analysis-branch-id/v3", {
    clusterId: cluster.clusterId,
    phase,
    inputBundleHash: bundleHash,
  });
  const payload: EarningsAnalysisJobPayload = {
    clusterId: cluster.clusterId,
    branchId,
    phase,
    inputBundleHash: bundleHash,
    inputSources: inputs,
    artifactCatalog: artifacts,
    analysisContract: contract,
    analysisContractHash: contractHash,
  };
  analysisJobPayloadSchema.parse(payload);
  const dedupeKey = `analysis:${branchId}`;
  const jobId = deriveJobId(runId, dedupeKey, payload);
  return {
    branch: {
      branchId,
      phase,
      jobId,
      inputBundleHash: bundleHash,
      inputSources: inputs,
      artifactCatalog: artifacts,
      analysisContract: contract,
      analysisContractHash: contractHash,
      status: "pending",
      requestedAtMs: nowMs,
      expectedAttempt: 0,
      expectedFencingToken: 0,
      resultEventId: null,
      resultHash: null,
      errorCode: null,
    },
    job: {
      jobId,
      type: "earnings.cluster.analyze",
      dedupeKey,
      notBeforeLogicalMs: nowMs,
      inputBundleHash: bundleHash,
      payload,
    },
  };
}

const STATE_PREFLIGHT_LIMITS = Object.freeze({
  maxDepth: 12,
  maxNodes: 100_000,
  maxArrayLength: MAX_EARNINGS_RETAINED_BRANCH_MEMBERSHIPS,
  maxObjectKeys: 32,
  maxStringBytes: MAX_EARNINGS_AGGREGATE_STATE_BYTES,
  maxCanonicalBytes: MAX_EARNINGS_AGGREGATE_STATE_BYTES,
});

const PAYLOAD_PREFLIGHT_LIMITS = Object.freeze({
  maxDepth: 12,
  maxNodes: 20_000,
  maxArrayLength: 10_000,
  maxObjectKeys: 64,
  maxStringBytes: 256 * 1024,
  maxCanonicalBytes: 1024 * 1024,
});

function inertPayload(value: unknown): JsonObject | null {
  try {
    assertJsonWithinLimits(value, PAYLOAD_PREFLIGHT_LIMITS);
    const snapshot = inertJsonSnapshot(value as JsonValue);
    if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
    return snapshot as JsonObject;
  } catch {
    return null;
  }
}

export function earningsClusterStateCanonicalBytes(state: Readonly<EarningsClusterState>): number {
  return Buffer.byteLength(canonicalJson(state), "utf8");
}

function projectedTransition(
  previous: EarningsClusterState,
  event: Readonly<StoredEvent>,
  transition: Transition<EarningsClusterState>,
): Transition<EarningsClusterState> {
  if (earningsClusterStateCanonicalBytes(transition.state) <= MAX_EARNINGS_AGGREGATE_STATE_BYTES) {
    return transition;
  }
  return rejectedWithoutStateChange(previous, event, "aggregate-state-capacity-exceeded");
}

export class EarningsClusterReducer
  implements Reducer<EarningsClusterState, EarningsClusterConfig>
{
  readonly name = "earnings-cluster";
  readonly version = "3.0.0";

  route(event: Readonly<StoredEvent>): string {
    if (
      event.type === "earnings.source.observed" &&
      (event.schemaVersion === 1 || event.schemaVersion === 2)
    ) {
      const snapshot = inertPayload(event.payload);
      const parsed = sourceRouteSchema.safeParse(snapshot);
      if (parsed.success) return deriveClusterId(parsed.data.issuerCik, parsed.data.fiscalPeriod);
    }
    const snapshot = event.schemaVersion === 1 ? inertPayload(event.payload) : null;
    if (event.type === "kernel.timer.fired") {
      const parsed = timerFiredSchema.safeParse(snapshot);
      if (parsed.success) return parsed.data.clusterId;
    }
    if (event.type === "kernel.job.succeeded") {
      const parsed = jobSucceededSchema.safeParse(snapshot);
      if (parsed.success) return parsed.data.clusterId;
    }
    if (event.type === "kernel.job.leased") {
      const parsed = jobLeasedSchema.safeParse(snapshot);
      if (parsed.success) return parsed.data.clusterId;
    }
    if (event.type === "kernel.job.failed") {
      const parsed = jobFailedSchema.safeParse(snapshot);
      if (parsed.success) return parsed.data.clusterId;
    }
    return `quarantine:${event.eventId}`;
  }

  parseState(value: unknown): EarningsClusterState {
    assertJsonWithinLimits(value, STATE_PREFLIGHT_LIMITS, "$.earningsClusterState");
    const parsed = stateSchema.parse(inertJsonSnapshot(value as JsonValue));
    assertJson(parsed);
    const state = cloneJson(parsed as unknown as JsonObject) as EarningsClusterState;
    if (earningsClusterStateCanonicalBytes(state) > MAX_EARNINGS_AGGREGATE_STATE_BYTES) {
      throw new TypeError("Earnings aggregate state exceeds the canonical UTF-8 ceiling");
    }
    return state;
  }

  initialState(aggregateId: string, config: Readonly<EarningsClusterConfig>): EarningsClusterState {
    configSchema.parse(config);
    return { schemaVersion: 4, aggregateId, cluster: null, rejectionCount: 0 };
  }

  apply(
    previous: Readonly<EarningsClusterState>,
    event: Readonly<StoredEvent>,
    context: ReducerContext<EarningsClusterConfig>,
  ): Transition<EarningsClusterState> {
    const previousState = this.parseState(previous);
    const state = cloneJson(previousState as unknown as JsonObject) as EarningsClusterState;
    configSchema.parse(context.config);
    let transition: Transition<EarningsClusterState>;
    switch (event.type) {
      case "earnings.source.observed":
        transition =
          event.schemaVersion === 1 || event.schemaVersion === 2
            ? this.#sourceObserved(state, event, context)
            : rejected(state, event, "unsupported-schema-version");
        break;
      case "kernel.timer.fired":
        transition =
          event.schemaVersion === 1
            ? this.#timerFired(state, event, context)
            : rejected(state, event, "unsupported-schema-version");
        break;
      case "kernel.job.succeeded":
        transition =
          event.schemaVersion === 1
            ? this.#jobSucceeded(state, event, context)
            : rejected(state, event, "unsupported-schema-version");
        break;
      case "kernel.job.leased":
        transition =
          event.schemaVersion === 1
            ? this.#jobLeased(state, event)
            : rejected(state, event, "unsupported-schema-version");
        break;
      case "kernel.job.failed":
        transition =
          event.schemaVersion === 1
            ? this.#jobFailed(state, event)
            : rejected(state, event, "unsupported-schema-version");
        break;
      default:
        transition = noEffects(
          state,
          decision("kernel.event.ignored", { eventId: event.eventId, eventType: event.type }),
        );
        break;
    }
    return projectedTransition(previousState, event, transition);
  }

  #sourceObserved(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
    context: ReducerContext<EarningsClusterConfig>,
  ): Transition<EarningsClusterState> {
    const snapshot = inertPayload(event.payload);
    if (snapshot === null) return rejected(state, event, "invalid-source-payload");
    const rawEvidence = snapshot["evidence"];
    if (
      event.schemaVersion === 2 &&
      Array.isArray(rawEvidence) &&
      rawEvidence.length > MAX_EARNINGS_SOURCE_EVIDENCE_REFERENCES
    ) {
      return rejectedWithoutStateChange(state, event, "source-evidence-limit-exceeded");
    }
    const parsed =
      event.schemaVersion === 1
        ? sourceObservedV1Schema.safeParse(snapshot)
        : sourceObservedV2Schema.safeParse(snapshot);
    if (!parsed.success) return rejected(state, event, "invalid-source-payload");
    const payload = parsed.data;
    const issuerCik = canonicalizeCik(payload.issuerCik);
    const clusterId = deriveClusterId(issuerCik, payload.fiscalPeriod);
    if (state.aggregateId !== clusterId) return rejected(state, event, "aggregate-route-mismatch");
    const primaryArtifactHash =
      event.schemaVersion === 1
        ? (payload as z.infer<typeof sourceObservedV1Schema>).artifactHash
        : (payload as z.infer<typeof sourceObservedV2Schema>).primaryArtifactHash;
    if (primaryArtifactHash !== event.provider.artifactHash) {
      return rejected(state, event, "artifact-provenance-mismatch");
    }

    let evidenceBundleHash: string | null = null;
    let evidence: EvidenceReference[] = [
      { role: "legacy.primary", artifactHash: primaryArtifactHash },
    ];
    if (event.schemaVersion === 1) {
      if (!subjectMatches(event.subject, issuerCik, payload.fiscalPeriod)) {
        return rejected(state, event, "subject-identity-mismatch");
      }
    } else {
      const v2 = payload as z.infer<typeof sourceObservedV2Schema>;
      evidenceBundleHash = v2.evidenceBundleHash;
      const expectedRecordSuffix =
        v2.sourceKind === "sec_8k" ? "earnings-source-v2" : "periodic-source-v2";
      const recordMatch = /^sec:\d{10}-\d{2}-\d{6}:(earnings-source-v2|periodic-source-v2)$/u.exec(
        event.provider.recordId,
      );
      if (
        event.provider.provider !== "sec-edgar" ||
        event.source !== "sec:normalizer-v1" ||
        event.provider.revisionId !== "1" ||
        recordMatch?.[1] !== expectedRecordSuffix ||
        event.subject !== `earnings:${v2.issuerCik}:${v2.fiscalPeriod}` ||
        event.correlationId !== event.subject ||
        event.causationId !== evidenceBundleHash
      ) {
        return rejected(state, event, "source-identity-mismatch");
      }
      const bundleInput = {
        provider: event.provider.provider,
        source: event.source,
        recordId: event.provider.recordId,
        revisionId: event.provider.revisionId,
        subject: event.subject,
        issuerCik: v2.issuerCik,
        fiscalPeriod: v2.fiscalPeriod,
        sourceKind: v2.sourceKind,
        primaryArtifactHash: v2.primaryArtifactHash,
        evidence: v2.evidence,
      };
      let recomputed: string;
      try {
        recomputed = computeProviderEvidenceBundleHash(bundleInput);
      } catch (error) {
        const reason =
          error instanceof ProviderEvidenceBundleError && error.code === "member-limit-exceeded"
            ? "source-evidence-limit-exceeded"
            : "source-evidence-invalid";
        return rejectedWithoutStateChange(state, event, reason);
      }
      if (recomputed !== evidenceBundleHash) {
        return rejectedWithoutStateChange(state, event, "evidence-bundle-hash-mismatch");
      }
      try {
        const bundle = validateSecEvidenceBundle({ ...bundleInput, evidenceBundleHash });
        evidence = bundle.evidence.map((member) => ({ ...member }));
      } catch (error) {
        if (error instanceof SecContractError) {
          const reason =
            error.reasonCode === "sec.bundle-hash-mismatch"
              ? "evidence-bundle-hash-mismatch"
              : error.reasonCode === "sec.identity-mismatch"
                ? "source-identity-mismatch"
                : error.reasonCode === "sec.member-limit-exceeded"
                  ? "source-evidence-limit-exceeded"
                  : "source-evidence-invalid";
          return rejectedWithoutStateChange(state, event, reason);
        }
        return rejectedWithoutStateChange(state, event, "source-evidence-invalid");
      }
    }

    const source: SourceObservation = {
      eventSchemaVersion: event.schemaVersion as 1 | 2,
      eventId: event.eventId,
      eventHash: event.eventHash,
      position: event.position,
      sourceKind: payload.sourceKind,
      primaryArtifactHash,
      evidenceBundleHash,
      evidence: canonicalEvidence(evidence),
      provider: event.provider.provider,
      providerRecordId: event.provider.recordId,
      providerRevisionId: event.provider.revisionId,
      publishedAtMs: payload.publishedAtMs,
      receivedAtMs: event.receivedAtMs,
      timestampConfidence: payload.timestampConfidence,
      originalTimestamp: payload.originalTimestamp,
    };

    if (state.cluster === null) {
      const lifecycleEndsAtMs = context.nowMs + context.config.lifecycleMs;
      const mirrorEndsAtMs = context.nowMs + context.config.mirrorDebounceMs;
      if (!Number.isSafeInteger(lifecycleEndsAtMs) || !Number.isSafeInteger(mirrorEndsAtMs)) {
        return rejected(state, event, "deadline-overflow");
      }
      const cluster: EarningsCluster = {
        clusterId,
        issuerCik,
        fiscalPeriod: payload.fiscalPeriod,
        status: "open",
        firstObservedAtMs: context.nowMs,
        lifecycleEndsAtMs,
        finalizedAtMs: null,
        sources: [source],
        timers: [],
        analysisBranches: [],
      };
      const mirrorTimer = timerDraft(
        context.runId,
        clusterId,
        "earnings.mirror-debounce",
        mirrorEndsAtMs,
      );
      const lifecycleTimer = timerDraft(
        context.runId,
        clusterId,
        "earnings.lifecycle-finalize",
        lifecycleEndsAtMs,
      );
      const analysis = analysisDraft(
        context.runId,
        cluster,
        "first_source",
        context.nowMs,
        expectedAnalysisContract(context),
      );
      cluster.timers.push(mirrorTimer.expectation, lifecycleTimer.expectation);
      cluster.analysisBranches.push(analysis.branch);
      state.cluster = cluster;
      const firstSourcePayload = {
        clusterId,
        issuerCik: cluster.issuerCik,
        fiscalPeriod: cluster.fiscalPeriod,
        sourceEventId: event.eventId,
        inputBundleHash: analysis.branch.inputBundleHash,
      };
      return {
        state,
        decisions: [decision("earnings.cluster.first-source-ready", firstSourcePayload)],
        jobs: [mirrorTimer.job, lifecycleTimer.job, analysis.job],
        outbox: [
          {
            messageId: deriveMessageId(
              context.runId,
              `first-source:${clusterId}`,
              firstSourcePayload,
            ),
            topic: "earnings.cluster.first-source-ready",
            dedupeKey: `first-source:${clusterId}`,
            payload: firstSourcePayload,
          },
        ],
      };
    }

    const cluster = state.cluster;
    if (cluster.clusterId !== clusterId) return rejected(state, event, "cluster-identity-mismatch");
    if (cluster.status === "finalized" || context.nowMs >= cluster.lifecycleEndsAtMs) {
      return noEffects(
        state,
        decision("earnings.source.after-lifecycle", {
          clusterId,
          sourceEventId: event.eventId,
          lifecycleEndsAtMs: cluster.lifecycleEndsAtMs,
        }),
      );
    }
    if (cluster.sources.length >= context.config.maxSourcesPerCluster) {
      return rejectedWithoutStateChange(state, event, "cluster-source-limit-exceeded");
    }

    const matchingArtifact = cluster.sources.find(
      (candidate) =>
        candidate.primaryArtifactHash === source.primaryArtifactHash &&
        candidate.evidenceBundleHash === source.evidenceBundleHash,
    );
    if (matchingArtifact !== undefined) {
      cluster.sources.push(source);
      return noEffects(
        state,
        decision("earnings.source.mirror-duplicate", {
          clusterId,
          sourceEventId: event.eventId,
          canonicalSourceEventId: matchingArtifact.eventId,
          primaryArtifactHash: source.primaryArtifactHash,
          evidenceBundleHash: source.evidenceBundleHash,
          provider: source.provider,
          providerRecordId: source.providerRecordId,
          providerRevisionId: source.providerRevisionId,
        }),
      );
    }

    const mirrorTimer = cluster.timers.find(
      (timer) => timer.timerType === "earnings.mirror-debounce",
    );
    const debounceReleaseMirror =
      isReleaseMirrorKind(source.sourceKind) &&
      cluster.sources.some((candidate) => isReleaseMirrorKind(candidate.sourceKind)) &&
      mirrorTimer?.status === "pending" &&
      context.nowMs < mirrorTimer.scheduledForLogicalMs;
    if (debounceReleaseMirror) {
      cluster.sources.push(source);
      return noEffects(
        state,
        decision("earnings.source.mirror-debounced", {
          clusterId,
          sourceEventId: event.eventId,
          sourceKind: source.sourceKind,
          mirrorWindowEndsAtMs: mirrorTimer.scheduledForLogicalMs,
        }),
      );
    }

    const phase = phaseFor(source.sourceKind, false);
    if (cluster.analysisBranches.length >= context.config.maxAnalysisBranches) {
      return rejectedWithoutStateChange(state, event, "analysis-branch-limit-exceeded");
    }
    cluster.sources.push(source);
    let analysis: ReturnType<typeof analysisDraft>;
    try {
      analysis = analysisDraft(
        context.runId,
        cluster,
        phase,
        context.nowMs,
        expectedAnalysisContract(context),
      );
    } catch (error) {
      cluster.sources.pop();
      if (error instanceof AnalysisCapacityError) {
        return rejectedWithoutStateChange(state, event, error.reason);
      }
      throw error;
    }
    if (cluster.analysisBranches.some((branch) => branch.branchId === analysis.branch.branchId)) {
      return noEffects(
        state,
        decision("earnings.analysis-branch-duplicate", {
          clusterId,
          branchId: analysis.branch.branchId,
        }),
      );
    }
    cluster.analysisBranches.push(analysis.branch);
    return {
      state,
      decisions: [
        decision("earnings.source.joined", {
          clusterId,
          sourceEventId: event.eventId,
          sourceKind: source.sourceKind,
          branchId: analysis.branch.branchId,
        }),
      ],
      jobs: [analysis.job],
      outbox: [],
    };
  }

  #timerFired(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
    context: ReducerContext<EarningsClusterConfig>,
  ): Transition<EarningsClusterState> {
    const parsed = timerFiredSchema.safeParse(inertPayload(event.payload));
    if (!parsed.success) return rejected(state, event, "invalid-timer-payload");
    const payload = parsed.data;
    const cluster = state.cluster;
    if (cluster === null || cluster.clusterId !== payload.clusterId) {
      return rejected(state, event, "timer-cluster-mismatch");
    }
    const timer = cluster.timers.find((candidate) => candidate.timerType === payload.timerType);
    if (timer === undefined) return rejected(state, event, "timer-not-requested");
    const provenanceMismatch =
      timer.jobId !== payload.jobId ||
      timer.scheduledForLogicalMs !== payload.scheduledForLogicalMs ||
      event.causationId !== payload.jobId;
    if (provenanceMismatch) {
      return noEffects(
        state,
        decision("kernel.timer.stale", {
          clusterId: cluster.clusterId,
          timerType: timer.timerType,
          receivedJobId: payload.jobId,
          expectedJobId: timer.jobId,
          expectedScheduledForLogicalMs: timer.scheduledForLogicalMs,
        }),
      );
    }
    if (timer.status === "fired") {
      return noEffects(
        state,
        decision("kernel.timer.duplicate", { clusterId: cluster.clusterId, jobId: timer.jobId }),
      );
    }
    if (context.nowMs < timer.scheduledForLogicalMs) {
      const recovery = timerDraft(
        context.runId,
        cluster.clusterId,
        timer.timerType,
        timer.scheduledForLogicalMs,
        event.eventId,
      );
      timer.jobId = recovery.expectation.jobId;
      return {
        state,
        decisions: [
          decision("kernel.timer.early-rescheduled", {
            clusterId: cluster.clusterId,
            timerType: timer.timerType,
            consumedJobId: payload.jobId,
            replacementJobId: recovery.job.jobId,
            scheduledForLogicalMs: timer.scheduledForLogicalMs,
          }),
        ],
        jobs: [recovery.job],
        outbox: [],
      };
    }
    timer.status = "fired";
    if (timer.timerType === "earnings.mirror-debounce") {
      const currentInputs = analysisInputs(cluster.sources);
      const currentArtifacts = artifactCatalog(currentInputs);
      const inputsAlreadyRepresented = cluster.analysisBranches.some(
        (branch) =>
          canonicalJson(branch.inputSources) === canonicalJson(currentInputs) &&
          canonicalJson(branch.artifactCatalog) === canonicalJson(currentArtifacts),
      );
      const windowComplete = decision("earnings.cluster.mirror-window-complete", {
        clusterId: cluster.clusterId,
        sourceCount: cluster.sources.length,
        uniqueArtifactCount: currentArtifacts.length,
      });
      if (inputsAlreadyRepresented) return noEffects(state, windowComplete);
      const capacityFallback = (): Transition<EarningsClusterState> => ({
        state,
        decisions: [
          windowComplete,
          decision("earnings.analysis.capacity-exhausted", {
            clusterId: cluster.clusterId,
            phase: "source_confirmation",
          }),
        ],
        jobs: [],
        outbox: [],
      });
      if (cluster.analysisBranches.length >= context.config.maxAnalysisBranches) {
        return capacityFallback();
      }
      let analysis: ReturnType<typeof analysisDraft>;
      try {
        analysis = analysisDraft(
          context.runId,
          cluster,
          "source_confirmation",
          context.nowMs,
          expectedAnalysisContract(context),
        );
      } catch (error) {
        if (error instanceof AnalysisCapacityError) return capacityFallback();
        throw error;
      }
      cluster.analysisBranches.push(analysis.branch);
      if (earningsClusterStateCanonicalBytes(state) > MAX_EARNINGS_AGGREGATE_STATE_BYTES) {
        cluster.analysisBranches.pop();
        return capacityFallback();
      }
      return {
        state,
        decisions: [
          windowComplete,
          decision("earnings.analysis.debounce-batch-ready", {
            clusterId: cluster.clusterId,
            branchId: analysis.branch.branchId,
            inputBundleHash: analysis.branch.inputBundleHash,
          }),
        ],
        jobs: [analysis.job],
        outbox: [],
      };
    }
    cluster.status = "finalized";
    cluster.finalizedAtMs = context.nowMs;
    return noEffects(
      state,
      decision("earnings.cluster.finalized", {
        clusterId: cluster.clusterId,
        sourceCount: cluster.sources.length,
        analysisBranchCount: cluster.analysisBranches.length,
      }),
    );
  }

  #jobSucceeded(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
    context: ReducerContext<EarningsClusterConfig>,
  ): Transition<EarningsClusterState> {
    const parsed = jobSucceededSchema.safeParse(inertPayload(event.payload));
    if (!parsed.success) return rejected(state, event, "invalid-job-success-payload");
    const payload = parsed.data;
    assertJson(payload.result);
    if (
      Buffer.byteLength(canonicalJson(payload.result as JsonObject), "utf8") >
      context.config.maxAnalysisResultBytes
    ) {
      return rejected(state, event, "analysis-result-too-large");
    }
    const cluster = state.cluster;
    if (cluster === null || cluster.clusterId !== payload.clusterId) {
      return rejected(state, event, "analysis-cluster-mismatch");
    }
    const branch = cluster.analysisBranches.find(
      (candidate) => candidate.branchId === payload.branchId,
    );
    if (branch === undefined) return rejected(state, event, "analysis-branch-not-requested");
    if (
      branch.jobId !== payload.jobId ||
      branch.inputBundleHash !== payload.inputBundleHash ||
      event.causationId !== payload.jobId ||
      branch.expectedAttempt !== payload.attempt ||
      branch.expectedFencingToken !== payload.fencingToken
    ) {
      return rejected(state, event, "analysis-provenance-mismatch");
    }
    if (branch.status !== "pending") {
      return noEffects(
        state,
        decision("earnings.analysis-result-duplicate", {
          clusterId: cluster.clusterId,
          branchId: branch.branchId,
        }),
      );
    }
    const runContract = expectedAnalysisContract(context);
    if (
      canonicalJson(branch.analysisContract) !== canonicalJson(runContract) ||
      branch.analysisContractHash !== analysisContractHash(runContract)
    ) {
      return rejected(state, event, "analysis-branch-contract-mismatch");
    }
    const submittedContract: AnalysisContract = {
      extractorVersion: payload.provenance.extractorVersion,
      featureSetId: payload.provenance.featureSetId,
      promptId: payload.provenance.promptId,
      modelId: payload.provenance.modelId,
      datasetId: payload.provenance.datasetId,
    };
    if (
      canonicalJson(submittedContract) !== canonicalJson(branch.analysisContract) ||
      payload.provenance.analysisContractHash !== branch.analysisContractHash ||
      analysisContractHash(submittedContract) !== branch.analysisContractHash ||
      analysisContractHash(branch.analysisContract) !== branch.analysisContractHash
    ) {
      return rejected(state, event, "analysis-contract-mismatch");
    }
    const submittedInputs = canonicalAnalysisInputs(payload.provenance.inputSources);
    const submittedArtifacts = [...payload.provenance.artifactCatalog].sort();
    if (
      canonicalJson(submittedInputs) !== canonicalJson(branch.inputSources) ||
      canonicalJson(submittedArtifacts) !== canonicalJson(branch.artifactCatalog)
    ) {
      return rejected(state, event, "analysis-input-set-mismatch");
    }
    const canonicalProvenance: EarningsAnalysisResultProvenance = {
      ...submittedContract,
      analysisContractHash: payload.provenance.analysisContractHash,
      inputSources: submittedInputs,
      artifactCatalog: submittedArtifacts,
    };
    branch.status = "succeeded";
    branch.resultEventId = event.eventId;
    branch.resultHash = canonicalHash("peas/analysis-result/v3", {
      result: payload.result as JsonObject,
      provenance: canonicalProvenance,
      attempt: payload.attempt,
      fencingToken: payload.fencingToken,
    });
    const completedPayload = {
      clusterId: cluster.clusterId,
      branchId: branch.branchId,
      jobId: branch.jobId,
      inputBundleHash: branch.inputBundleHash,
      resultHash: branch.resultHash,
    };
    return {
      state,
      decisions: [decision("earnings.analysis.succeeded", completedPayload)],
      jobs: [],
      outbox: [
        {
          messageId: deriveMessageId(
            context.runId,
            `analysis-completed:${branch.branchId}`,
            completedPayload,
          ),
          topic: "earnings.analysis.completed",
          dedupeKey: `analysis-completed:${branch.branchId}`,
          payload: completedPayload,
        },
      ],
    };
  }

  #jobFailed(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
  ): Transition<EarningsClusterState> {
    const parsed = jobFailedSchema.safeParse(inertPayload(event.payload));
    if (!parsed.success) return rejected(state, event, "invalid-job-failure-payload");
    const payload = parsed.data;
    const cluster = state.cluster;
    if (cluster === null || cluster.clusterId !== payload.clusterId) {
      return rejected(state, event, "analysis-cluster-mismatch");
    }
    const branch = cluster.analysisBranches.find(
      (candidate) => candidate.branchId === payload.branchId,
    );
    if (branch === undefined) return rejected(state, event, "analysis-branch-not-requested");
    if (
      branch.jobId !== payload.jobId ||
      branch.inputBundleHash !== payload.inputBundleHash ||
      event.causationId !== payload.jobId ||
      branch.expectedAttempt !== payload.attempt ||
      branch.expectedFencingToken !== payload.fencingToken
    ) {
      return rejected(state, event, "analysis-provenance-mismatch");
    }
    if (branch.status !== "pending") {
      return noEffects(
        state,
        decision("earnings.analysis-result-duplicate", {
          clusterId: cluster.clusterId,
          branchId: branch.branchId,
        }),
      );
    }
    branch.status = "failed";
    branch.resultEventId = event.eventId;
    branch.errorCode = payload.errorCode;
    return noEffects(
      state,
      decision("earnings.analysis.failed", {
        clusterId: cluster.clusterId,
        branchId: branch.branchId,
        jobId: branch.jobId,
        errorCode: payload.errorCode,
      }),
    );
  }

  #jobLeased(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
  ): Transition<EarningsClusterState> {
    const parsed = jobLeasedSchema.safeParse(inertPayload(event.payload));
    if (!parsed.success) return rejected(state, event, "invalid-job-lease-payload");
    const payload = parsed.data;
    const cluster = state.cluster;
    if (cluster === null || cluster.clusterId !== payload.clusterId) {
      return rejected(state, event, "analysis-cluster-mismatch");
    }
    const branch = cluster.analysisBranches.find(
      (candidate) => candidate.branchId === payload.branchId,
    );
    if (branch === undefined) return rejected(state, event, "analysis-branch-not-requested");
    if (
      branch.jobId !== payload.jobId ||
      branch.inputBundleHash !== payload.inputBundleHash ||
      event.causationId !== payload.jobId
    ) {
      return rejected(state, event, "analysis-lease-provenance-mismatch");
    }
    if (branch.status !== "pending") {
      return noEffects(
        state,
        decision("earnings.analysis-lease-after-completion", {
          clusterId: cluster.clusterId,
          branchId: branch.branchId,
          fencingToken: payload.fencingToken,
        }),
      );
    }
    if (
      payload.fencingToken <= branch.expectedFencingToken ||
      payload.attempt <= branch.expectedAttempt
    ) {
      return rejected(state, event, "analysis-stale-lease");
    }
    branch.expectedAttempt = payload.attempt;
    branch.expectedFencingToken = payload.fencingToken;
    return noEffects(
      state,
      decision("earnings.analysis.leased", {
        clusterId: cluster.clusterId,
        branchId: branch.branchId,
        jobId: branch.jobId,
        attempt: payload.attempt,
        fencingToken: payload.fencingToken,
      }),
    );
  }
}
