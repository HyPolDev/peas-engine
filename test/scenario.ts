import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import type { EventDraft, StoredEvent } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import type { JsonObject, JsonValue } from "../src/core/json.js";
import {
  DeterministicProcessor,
  type RunKind,
  type RunManifest,
  type StoredOutput,
} from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterConfig,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";

export const BASE_TIME_MS = 1_800_000_000_000;
export const ISSUER_CIK = "0000123456";
export const FISCAL_PERIOD = "2026-Q2";
export const SUBJECT = `earnings:${ISSUER_CIK}:${FISCAL_PERIOD}`;
export const PRIMARY_ARTIFACT = canonicalHash("peas/test-artifact/v2", {
  document: "ACME Q2 issuer release",
});
export const CALL_ARTIFACT = canonicalHash("peas/test-artifact/v2", {
  document: "ACME Q2 earnings call",
});
export const CONFIG: EarningsClusterConfig = {
  mirrorDebounceMs: 60_000,
  lifecycleMs: 6 * 60 * 60 * 1_000,
  maxSourcesPerCluster: 32,
  maxAnalysisBranches: 32,
  maxAnalysisResultBytes: 64_000,
};

const BUILD_DIGEST = canonicalHash("peas/test-build/v2", { commit: "kernel-contracts-v2" });
const SCHEMA_DIGEST = canonicalHash("peas/test-schema-registry/v2", {
  eventEnvelope: 2,
  earningsSource: 1,
  earningsState: 3,
});

export function makeManifest(
  runId = "audit-fixture-run-v2",
  kind: RunKind = "replay",
  effectsAllowed = false,
): RunManifest<EarningsClusterConfig> {
  return {
    manifestVersion: 2,
    runId,
    kind,
    effectsAllowed,
    canonicalizationVersion: "peas-json-v1",
    behavior: {
      reducerName: "earnings-cluster",
      reducerVersion: "2.2.0",
      buildDigest: BUILD_DIGEST,
      schemaRegistryDigest: SCHEMA_DIGEST,
      configuration: CONFIG,
      identities: {
        extractorVersion: "fixture-extractor-v2",
        featureSetId: "earnings-kernel-v2",
        modelId: null,
        promptId: null,
        datasetId: null,
      },
    },
  };
}

function artifactFor(label: string, payload: JsonObject): string {
  return canonicalHash("peas/test-event-artifact/v2", { label, payload });
}

function sourceDraft(options: {
  provider: string;
  recordId: string;
  revisionId?: string;
  artifactHash: string;
  sourceKind: string;
  publishedAtMs: number | null;
}): EventDraft {
  return {
    envelopeVersion: 2,
    type: "earnings.source.observed",
    schemaVersion: 1,
    source: `fixture:${options.provider}`,
    subject: SUBJECT,
    occurredAtMs: options.publishedAtMs,
    correlationId: "correlation-acme-q2",
    provider: {
      provider: options.provider,
      recordId: options.recordId,
      revisionId: options.revisionId ?? "1",
      artifactHash: options.artifactHash,
    },
    payload: {
      issuerCik: ISSUER_CIK,
      fiscalPeriod: FISCAL_PERIOD,
      sourceKind: options.sourceKind,
      artifactHash: options.artifactHash,
      publishedAtMs: options.publishedAtMs,
      timestampConfidence: "provider",
      originalTimestamp: "2027-01-15T16:00:00-05:00",
    },
  };
}

function objectField(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object field ${key}`);
  }
  return value as JsonObject;
}

function stringField(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string") throw new Error(`Expected string field ${key}`);
  return value;
}

function numberField(object: JsonObject, key: string): number {
  const value = object[key];
  if (typeof value !== "number") throw new Error(`Expected number field ${key}`);
  return value;
}

function arrayField(object: JsonObject, key: string): readonly JsonValue[] {
  const value = object[key];
  if (!Array.isArray(value)) throw new Error(`Expected array field ${key}`);
  return value;
}

function outputBy(
  outputs: readonly StoredOutput[],
  category: "job" | "outbox",
  predicate: (body: JsonObject, payload: JsonObject) => boolean,
): StoredOutput {
  const output = [...outputs].reverse().find((candidate) => {
    if (candidate.category !== category) return false;
    const payload = objectField(candidate.body, "payload");
    return predicate(candidate.body, payload);
  });
  if (output === undefined) throw new Error(`Missing ${category} output`);
  return output;
}

async function allEvents(log: InMemoryEventLog): Promise<readonly StoredEvent[]> {
  const events: StoredEvent[] = [];
  let cursor = "0";
  while (true) {
    const page = await log.readAfter(cursor, 3);
    events.push(...page.events);
    cursor = page.nextPosition;
    if (!page.hasMore) return events;
  }
}

export async function captureScenario(): Promise<
  Readonly<{
    events: readonly StoredEvent[];
    snapshot: Awaited<
      ReturnType<DeterministicProcessor<EarningsClusterState, EarningsClusterConfig>["snapshot"]>
    >;
    manifest: RunManifest<EarningsClusterConfig>;
    firstDraft: EventDraft;
    store: InMemoryProcessingStore<EarningsClusterState>;
  }>
> {
  const clock = new ManualClock(BASE_TIME_MS);
  const eventLog = new InMemoryEventLog({ clock });
  const store = new InMemoryProcessingStore<EarningsClusterState>(eventLog);
  const manifest = makeManifest();
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest,
  });

  const processDraft = async (draft: EventDraft): Promise<StoredEvent> => {
    const appended = await eventLog.append(draft);
    if (appended.disposition !== "appended") throw new Error("Scenario event unexpectedly deduped");
    await processor.process(appended.event);
    return appended.event;
  };

  const firstDraft = sourceDraft({
    provider: "issuer-ir",
    recordId: "acme-q2-release",
    artifactHash: PRIMARY_ARTIFACT,
    sourceKind: "issuer_release",
    publishedAtMs: BASE_TIME_MS - 5_000,
  });
  await processDraft(firstDraft);

  clock.advanceBy(30_000);
  await processDraft(
    sourceDraft({
      provider: "fmp",
      recordId: "fmp-acme-q2-release",
      artifactHash: PRIMARY_ARTIFACT,
      sourceKind: "fmp_release",
      publishedAtMs: BASE_TIME_MS - 5_000,
    }),
  );

  clock.advanceBy(10_000);
  const malformedPayload: JsonObject = { issuerCik: "__proto__", artifactHash: "bad" };
  await processDraft({
    envelopeVersion: 2,
    type: "earnings.source.observed",
    schemaVersion: 1,
    source: "fixture:malformed",
    subject: "earnings:malformed",
    occurredAtMs: null,
    correlationId: "correlation-malformed",
    provider: {
      provider: "fixture",
      recordId: "malformed-1",
      revisionId: "1",
      artifactHash: artifactFor("malformed", malformedPayload),
    },
    payload: malformedPayload,
  });

  const initialSnapshot = await processor.snapshot();
  const mirrorTimer = outputBy(initialSnapshot.outputs, "job", (_body, payload) => {
    return payload["timerType"] === "earnings.mirror-debounce";
  });
  const mirrorBody = mirrorTimer.body;
  const mirrorPayload = objectField(mirrorBody, "payload");
  const mirrorJobId = stringField(mirrorBody, "jobId");
  const mirrorDueAt = numberField(mirrorPayload, "scheduledForLogicalMs");
  clock.advanceTo(mirrorDueAt);
  const mirrorFiredPayload: JsonObject = {
    timerType: "earnings.mirror-debounce",
    clusterId: stringField(mirrorPayload, "clusterId"),
    jobId: mirrorJobId,
    scheduledForLogicalMs: mirrorDueAt,
    fencingToken: 1,
  };
  await processDraft({
    envelopeVersion: 2,
    type: "kernel.timer.fired",
    schemaVersion: 1,
    source: "fixture:scheduler",
    subject: SUBJECT,
    occurredAtMs: mirrorDueAt,
    correlationId: "correlation-acme-q2",
    causationId: mirrorJobId,
    provider: {
      provider: "peas-scheduler",
      recordId: mirrorJobId,
      revisionId: "1",
      artifactHash: artifactFor("mirror-fired", mirrorFiredPayload),
    },
    payload: mirrorFiredPayload,
  });

  const beforeFirstAnalysis = await processor.snapshot();
  const firstAnalysis = outputBy(beforeFirstAnalysis.outputs, "job", (_body, payload) => {
    return payload["phase"] === "first_source";
  });
  const firstAnalysisBody = firstAnalysis.body;
  const firstAnalysisPayload = objectField(firstAnalysisBody, "payload");
  const firstJobId = stringField(firstAnalysisBody, "jobId");
  const firstBundleHash = stringField(firstAnalysisBody, "inputBundleHash");
  const firstAnalysisContract = objectField(firstAnalysisPayload, "analysisContract");
  const firstLeasePayload: JsonObject = {
    jobType: "earnings.cluster.analyze",
    clusterId: stringField(firstAnalysisPayload, "clusterId"),
    branchId: stringField(firstAnalysisPayload, "branchId"),
    jobId: firstJobId,
    inputBundleHash: firstBundleHash,
    attempt: 1,
    fencingToken: 1,
  };
  clock.advanceBy(5_000);
  await processDraft({
    envelopeVersion: 2,
    type: "kernel.job.leased",
    schemaVersion: 1,
    source: "fixture:worker",
    subject: SUBJECT,
    occurredAtMs: clock.nowMs(),
    correlationId: "correlation-acme-q2",
    causationId: firstJobId,
    provider: {
      provider: "peas-worker",
      recordId: `lease:${firstJobId}`,
      revisionId: "fence-1",
      artifactHash: artifactFor("first-analysis-lease", firstLeasePayload),
    },
    payload: firstLeasePayload,
  });
  const firstResultPayload: JsonObject = {
    jobType: "earnings.cluster.analyze",
    clusterId: stringField(firstAnalysisPayload, "clusterId"),
    branchId: stringField(firstAnalysisPayload, "branchId"),
    jobId: firstJobId,
    inputBundleHash: firstBundleHash,
    attempt: 1,
    fencingToken: 1,
    provenance: {
      ...firstAnalysisContract,
      analysisContractHash: stringField(firstAnalysisPayload, "analysisContractHash"),
      inputEventIds: arrayField(firstAnalysisPayload, "inputEventIds"),
      inputArtifactHashes: arrayField(firstAnalysisPayload, "artifactHashes"),
    },
    result: { score: "0.87", signal: "positive" },
  };
  clock.advanceBy(5_000);
  await processDraft({
    envelopeVersion: 2,
    type: "kernel.job.succeeded",
    schemaVersion: 1,
    source: "fixture:worker",
    subject: SUBJECT,
    occurredAtMs: clock.nowMs(),
    correlationId: "correlation-acme-q2",
    causationId: firstJobId,
    provider: {
      provider: "peas-worker",
      recordId: firstJobId,
      revisionId: "attempt-1",
      artifactHash: artifactFor("first-analysis", firstResultPayload),
    },
    payload: firstResultPayload,
  });

  clock.advanceTo(BASE_TIME_MS + 60 * 60 * 1_000);
  await processDraft(
    sourceDraft({
      provider: "issuer-call",
      recordId: "acme-q2-call",
      artifactHash: CALL_ARTIFACT,
      sourceKind: "call",
      publishedAtMs: clock.nowMs() - 1_000,
    }),
  );

  const beforeCallAnalysis = await processor.snapshot();
  const callAnalysis = outputBy(beforeCallAnalysis.outputs, "job", (_body, payload) => {
    return payload["phase"] === "call_second_wave";
  });
  const callBody = callAnalysis.body;
  const callPayload = objectField(callBody, "payload");
  const callJobId = stringField(callBody, "jobId");
  const callBundleHash = stringField(callBody, "inputBundleHash");
  const callAnalysisContract = objectField(callPayload, "analysisContract");
  const callLeaseBase: JsonObject = {
    jobType: "earnings.cluster.analyze",
    clusterId: stringField(callPayload, "clusterId"),
    branchId: stringField(callPayload, "branchId"),
    jobId: callJobId,
    inputBundleHash: callBundleHash,
    attempt: 1,
    fencingToken: 1,
  };
  clock.advanceBy(100);
  await processDraft({
    envelopeVersion: 2,
    type: "kernel.job.leased",
    schemaVersion: 1,
    source: "fixture:worker",
    subject: SUBJECT,
    occurredAtMs: clock.nowMs(),
    correlationId: "correlation-acme-q2",
    causationId: callJobId,
    provider: {
      provider: "peas-worker",
      recordId: `lease:${callJobId}`,
      revisionId: "fence-1",
      artifactHash: artifactFor("call-analysis-lease-1", callLeaseBase),
    },
    payload: callLeaseBase,
  });
  const callLeaseReclaimed: JsonObject = {
    ...callLeaseBase,
    attempt: 2,
    fencingToken: 2,
  };
  clock.advanceBy(100);
  await processDraft({
    envelopeVersion: 2,
    type: "kernel.job.leased",
    schemaVersion: 1,
    source: "fixture:worker",
    subject: SUBJECT,
    occurredAtMs: clock.nowMs(),
    correlationId: "correlation-acme-q2",
    causationId: callJobId,
    provider: {
      provider: "peas-worker",
      recordId: `lease:${callJobId}`,
      revisionId: "fence-2",
      artifactHash: artifactFor("call-analysis-lease-2", callLeaseReclaimed),
    },
    payload: callLeaseReclaimed,
  });
  const wrongPayload: JsonObject = {
    jobType: "earnings.cluster.analyze",
    clusterId: stringField(callPayload, "clusterId"),
    branchId: stringField(callPayload, "branchId"),
    jobId: callJobId,
    inputBundleHash: callBundleHash,
    attempt: 1,
    fencingToken: 1,
    provenance: {
      ...callAnalysisContract,
      analysisContractHash: stringField(callPayload, "analysisContractHash"),
      inputEventIds: arrayField(callPayload, "inputEventIds"),
      inputArtifactHashes: arrayField(callPayload, "artifactHashes"),
    },
    result: { score: "0.11", signal: "stale-wrong-result" },
  };
  clock.advanceBy(100);
  await processDraft({
    envelopeVersion: 2,
    type: "kernel.job.succeeded",
    schemaVersion: 1,
    source: "fixture:worker",
    subject: SUBJECT,
    occurredAtMs: clock.nowMs(),
    correlationId: "correlation-acme-q2",
    causationId: callJobId,
    provider: {
      provider: "peas-worker",
      recordId: "wrong-call-result",
      revisionId: "attempt-1",
      artifactHash: artifactFor("wrong-call-analysis", wrongPayload),
    },
    payload: wrongPayload,
  });

  const callResultPayload: JsonObject = {
    ...wrongPayload,
    attempt: 2,
    fencingToken: 2,
    result: { score: "0.74", signal: "call-second-wave" },
  };
  clock.advanceBy(100);
  await processDraft({
    envelopeVersion: 2,
    type: "kernel.job.succeeded",
    schemaVersion: 1,
    source: "fixture:worker",
    subject: SUBJECT,
    occurredAtMs: clock.nowMs(),
    correlationId: "correlation-acme-q2",
    causationId: callJobId,
    provider: {
      provider: "peas-worker",
      recordId: callJobId,
      revisionId: "attempt-1",
      artifactHash: artifactFor("call-analysis", callResultPayload),
    },
    payload: callResultPayload,
  });

  const beforeLifecycle = await processor.snapshot();
  const lifecycleTimer = outputBy(beforeLifecycle.outputs, "job", (_body, payload) => {
    return payload["timerType"] === "earnings.lifecycle-finalize";
  });
  const lifecycleBody = lifecycleTimer.body;
  const lifecyclePayload = objectField(lifecycleBody, "payload");
  const lifecycleJobId = stringField(lifecycleBody, "jobId");
  const lifecycleDueAt = numberField(lifecyclePayload, "scheduledForLogicalMs");
  clock.advanceTo(lifecycleDueAt);
  const lifecycleFiredPayload: JsonObject = {
    timerType: "earnings.lifecycle-finalize",
    clusterId: stringField(lifecyclePayload, "clusterId"),
    jobId: lifecycleJobId,
    scheduledForLogicalMs: lifecycleDueAt,
    fencingToken: 1,
  };
  await processDraft({
    envelopeVersion: 2,
    type: "kernel.timer.fired",
    schemaVersion: 1,
    source: "fixture:scheduler",
    subject: SUBJECT,
    occurredAtMs: lifecycleDueAt,
    correlationId: "correlation-acme-q2",
    causationId: lifecycleJobId,
    provider: {
      provider: "peas-scheduler",
      recordId: lifecycleJobId,
      revisionId: "1",
      artifactHash: artifactFor("lifecycle-fired", lifecycleFiredPayload),
    },
    payload: lifecycleFiredPayload,
  });

  clock.advanceBy(1_000);
  await processDraft(
    sourceDraft({
      provider: "sec",
      recordId: "acme-q2-10q",
      artifactHash: canonicalHash("peas/test-artifact/v2", { document: "ACME Q2 10-Q" }),
      sourceKind: "filing",
      publishedAtMs: clock.nowMs(),
    }),
  );

  const redelivery = await eventLog.append(firstDraft);
  if (redelivery.disposition !== "redelivery") throw new Error("Expected provider redelivery");

  return {
    events: await allEvents(eventLog),
    snapshot: await processor.snapshot(),
    manifest,
    firstDraft,
    store,
  };
}

export function jsonObject(value: JsonValue | undefined): JsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected JSON object");
  }
  return value as JsonObject;
}
