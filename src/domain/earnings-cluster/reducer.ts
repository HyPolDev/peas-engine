import { z } from "zod";

import type { StoredEvent } from "../../core/event.js";
import { canonicalHash } from "../../core/hash.js";
import { assertJson, canonicalJson, cloneJson, type JsonObject } from "../../core/json.js";
import {
  deriveJobId,
  deriveMessageId,
  type DecisionDraft,
  type JobDraft,
  type Reducer,
  type ReducerContext,
  type Transition,
} from "../../core/processor.js";

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

export type SourceKind =
  | "issuer_release"
  | "fmp_release"
  | "sec_8k"
  | "call"
  | "transcript"
  | "filing";

export type SourceObservation = {
  eventId: string;
  eventHash: string;
  position: string;
  sourceKind: SourceKind;
  artifactHash: string;
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
  eventId: string;
  eventHash: string;
  position: string;
  sourceKind: SourceKind;
  artifactHash: string;
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
  schemaVersion: 3;
  aggregateId: string;
  cluster: EarningsCluster | null;
  rejectionCount: number;
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
const sourceObservedSchema = z
  .object({
    issuerCik: z.string().regex(/^\d{1,10}$/u),
    fiscalPeriod: z.string().regex(/^\d{4}-(?:Q[1-4]|FY)$/u),
    sourceKind: sourceKindSchema,
    artifactHash: hash,
    publishedAtMs: nonnegativeSafeInteger.nullable(),
    timestampConfidence: z.enum(["exact", "provider", "inferred", "unknown"]),
    originalTimestamp: z.string().max(512).nullable(),
  })
  .strict();
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
const analysisProvenanceSchema = analysisContractSchema
  .extend({
    analysisContractHash: hash,
    inputEventIds: z.array(hash).max(MAX_EARNINGS_CLUSTER_SOURCES),
    inputArtifactHashes: z.array(hash).max(MAX_EARNINGS_CLUSTER_SOURCES),
  })
  .strict();
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
const sourceObservationSchema = z
  .object({
    eventId: hash,
    eventHash: hash,
    position: z.string().regex(/^\d+$/u),
    sourceKind: sourceKindSchema,
    artifactHash: hash,
    provider: z.string().min(1).max(512),
    providerRecordId: z.string().min(1).max(512),
    providerRevisionId: z.string().min(1).max(512),
    publishedAtMs: nonnegativeSafeInteger.nullable(),
    receivedAtMs: nonnegativeSafeInteger,
    timestampConfidence: z.enum(["exact", "provider", "inferred", "unknown"]),
    originalTimestamp: z.string().max(512).nullable(),
  })
  .strict();
const timerExpectationSchema = z
  .object({
    timerType: z.enum(["earnings.mirror-debounce", "earnings.lifecycle-finalize"]),
    jobId: hash,
    scheduledForLogicalMs: nonnegativeSafeInteger,
    status: z.enum(["pending", "fired"]),
  })
  .strict();
const analysisInputSchema = z
  .object({
    eventId: hash,
    eventHash: hash,
    position: z.string().regex(/^\d+$/u),
    sourceKind: sourceKindSchema,
    artifactHash: hash,
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
  .strict();
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
  .strict();
const stateSchema = z
  .object({
    schemaVersion: z.literal(3),
    aggregateId: z.string().min(1).max(512),
    cluster: clusterSchema.nullable(),
    rejectionCount: nonnegativeSafeInteger,
  })
  .strict();

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
    eventId: source.eventId,
    eventHash: source.eventHash,
    position: source.position,
    sourceKind: source.sourceKind,
    artifactHash: source.artifactHash,
  };
}

function uniqueAnalysisInputs(sources: readonly SourceObservation[]): AnalysisInput[] {
  const seenArtifacts = new Set<string>();
  const inputs: AnalysisInput[] = [];
  for (const source of sources) {
    if (seenArtifacts.has(source.artifactHash)) continue;
    seenArtifacts.add(source.artifactHash);
    inputs.push(analysisInput(source));
  }
  return inputs;
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
  contractHash: string,
): string {
  return canonicalHash("peas/earnings-analysis-input-bundle/v2", {
    clusterId: cluster.clusterId,
    issuerCik: cluster.issuerCik,
    fiscalPeriod: cluster.fiscalPeriod,
    phase,
    analysisContractHash: contractHash,
    sources: inputs,
  });
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
  const inputs = uniqueAnalysisInputs(cluster.sources);
  const contractHash = analysisContractHash(contract);
  const bundleHash = inputBundleHash(cluster, phase, inputs, contractHash);
  const branchId = canonicalHash("peas/analysis-branch-id/v2", {
    clusterId: cluster.clusterId,
    phase,
    inputBundleHash: bundleHash,
  });
  const payload = {
    clusterId: cluster.clusterId,
    branchId,
    phase,
    inputBundleHash: bundleHash,
    inputSources: inputs,
    inputEventIds: inputs.map((input) => input.eventId),
    artifactHashes: inputs.map((input) => input.artifactHash),
    analysisContract: contract,
    analysisContractHash: contractHash,
  };
  const dedupeKey = `analysis:${branchId}`;
  const jobId = deriveJobId(runId, dedupeKey, payload);
  return {
    branch: {
      branchId,
      phase,
      jobId,
      inputBundleHash: bundleHash,
      inputSources: inputs,
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

export class EarningsClusterReducer
  implements Reducer<EarningsClusterState, EarningsClusterConfig>
{
  readonly name = "earnings-cluster";
  readonly version = "2.2.0";

  route(event: Readonly<StoredEvent>): string {
    if (event.type === "earnings.source.observed") {
      const parsed = sourceObservedSchema.safeParse(event.payload);
      if (parsed.success) return deriveClusterId(parsed.data.issuerCik, parsed.data.fiscalPeriod);
    }
    if (event.type === "kernel.timer.fired") {
      const parsed = timerFiredSchema.safeParse(event.payload);
      if (parsed.success) return parsed.data.clusterId;
    }
    if (event.type === "kernel.job.succeeded") {
      const parsed = jobSucceededSchema.safeParse(event.payload);
      if (parsed.success) return parsed.data.clusterId;
    }
    if (event.type === "kernel.job.leased") {
      const parsed = jobLeasedSchema.safeParse(event.payload);
      if (parsed.success) return parsed.data.clusterId;
    }
    if (event.type === "kernel.job.failed") {
      const parsed = jobFailedSchema.safeParse(event.payload);
      if (parsed.success) return parsed.data.clusterId;
    }
    return `quarantine:${event.eventId}`;
  }

  parseState(value: unknown): EarningsClusterState {
    const parsed = stateSchema.parse(value);
    assertJson(parsed);
    return cloneJson(parsed as unknown as JsonObject) as EarningsClusterState;
  }

  initialState(aggregateId: string, config: Readonly<EarningsClusterConfig>): EarningsClusterState {
    configSchema.parse(config);
    return { schemaVersion: 3, aggregateId, cluster: null, rejectionCount: 0 };
  }

  apply(
    previous: Readonly<EarningsClusterState>,
    event: Readonly<StoredEvent>,
    context: ReducerContext<EarningsClusterConfig>,
  ): Transition<EarningsClusterState> {
    const state = this.parseState(previous);
    configSchema.parse(context.config);
    if (event.schemaVersion !== 1) return rejected(state, event, "unsupported-schema-version");

    switch (event.type) {
      case "earnings.source.observed":
        return this.#sourceObserved(state, event, context);
      case "kernel.timer.fired":
        return this.#timerFired(state, event, context);
      case "kernel.job.succeeded":
        return this.#jobSucceeded(state, event, context);
      case "kernel.job.leased":
        return this.#jobLeased(state, event);
      case "kernel.job.failed":
        return this.#jobFailed(state, event);
      default:
        return noEffects(
          state,
          decision("kernel.event.ignored", { eventId: event.eventId, eventType: event.type }),
        );
    }
  }

  #sourceObserved(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
    context: ReducerContext<EarningsClusterConfig>,
  ): Transition<EarningsClusterState> {
    const parsed = sourceObservedSchema.safeParse(event.payload);
    if (!parsed.success) return rejected(state, event, "invalid-source-payload");
    const payload = parsed.data;
    const issuerCik = canonicalizeCik(payload.issuerCik);
    const clusterId = deriveClusterId(issuerCik, payload.fiscalPeriod);
    if (state.aggregateId !== clusterId) return rejected(state, event, "aggregate-route-mismatch");
    if (!subjectMatches(event.subject, issuerCik, payload.fiscalPeriod)) {
      return rejected(state, event, "subject-identity-mismatch");
    }
    if (payload.artifactHash !== event.provider.artifactHash) {
      return rejected(state, event, "artifact-provenance-mismatch");
    }

    const source: SourceObservation = {
      eventId: event.eventId,
      eventHash: event.eventHash,
      position: event.position,
      sourceKind: payload.sourceKind,
      artifactHash: payload.artifactHash,
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
      (candidate) => candidate.artifactHash === source.artifactHash,
    );
    if (matchingArtifact !== undefined) {
      cluster.sources.push(source);
      return noEffects(
        state,
        decision("earnings.source.mirror-duplicate", {
          clusterId,
          sourceEventId: event.eventId,
          canonicalSourceEventId: matchingArtifact.eventId,
          artifactHash: source.artifactHash,
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
    const analysis = analysisDraft(
      context.runId,
      cluster,
      phase,
      context.nowMs,
      expectedAnalysisContract(context),
    );
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
    const parsed = timerFiredSchema.safeParse(event.payload);
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
      const currentInputs = uniqueAnalysisInputs(cluster.sources);
      const inputsAlreadyRepresented = cluster.analysisBranches.some(
        (branch) => canonicalJson(branch.inputSources) === canonicalJson(currentInputs),
      );
      const windowComplete = decision("earnings.cluster.mirror-window-complete", {
        clusterId: cluster.clusterId,
        sourceCount: cluster.sources.length,
        uniqueArtifactCount: currentInputs.length,
      });
      if (inputsAlreadyRepresented) return noEffects(state, windowComplete);
      if (cluster.analysisBranches.length >= context.config.maxAnalysisBranches) {
        return {
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
        };
      }
      const analysis = analysisDraft(
        context.runId,
        cluster,
        "source_confirmation",
        context.nowMs,
        expectedAnalysisContract(context),
      );
      cluster.analysisBranches.push(analysis.branch);
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
    const parsed = jobSucceededSchema.safeParse(event.payload);
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
    const expectedEventIds = branch.inputSources.map((source) => source.eventId);
    const expectedArtifacts = branch.inputSources.map((source) => source.artifactHash);
    if (
      canonicalJson(payload.provenance.inputEventIds) !== canonicalJson(expectedEventIds) ||
      canonicalJson(payload.provenance.inputArtifactHashes) !== canonicalJson(expectedArtifacts)
    ) {
      return rejected(state, event, "analysis-input-set-mismatch");
    }
    branch.status = "succeeded";
    branch.resultEventId = event.eventId;
    branch.resultHash = canonicalHash("peas/analysis-result/v2", {
      result: payload.result as JsonObject,
      provenance: payload.provenance,
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
    const parsed = jobFailedSchema.safeParse(event.payload);
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
    const parsed = jobLeasedSchema.safeParse(event.payload);
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
