import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import type { EventDraft, StoredEvent } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, cloneJson, type JsonObject } from "../src/core/json.js";
import {
  DeterministicProcessor,
  type ReducerContext,
  type RunManifest,
} from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  MAX_EARNINGS_ANALYSIS_BRANCHES,
  MAX_EARNINGS_CLUSTER_SOURCES,
  type AnalysisBranch,
  type EarningsClusterConfig,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";

const BASE_TIME = 1_900_000_000_000;
const PERIOD = "2027-Q1";
const PADDED_CIK = "0000123456";
const RUN_ID = "reducer-contract-test";
const reducer = new EarningsClusterReducer();

const baseConfig: EarningsClusterConfig = {
  mirrorDebounceMs: 60_000,
  lifecycleMs: 3_600_000,
  maxSourcesPerCluster: 32,
  maxAnalysisBranches: 32,
  maxAnalysisResultBytes: 64_000,
};

const identities = {
  extractorVersion: "extractor-2027-01",
  featureSetId: "earnings-features-v3",
  promptId: "earnings-prompt-v5",
  modelId: "model-snapshot-42",
  datasetId: "dataset-2027-q1",
} as const;

let sequence = 0;

function hash(label: string): string {
  return canonicalHash("peas/reducer-contract-test/v1", { label });
}

function context(
  nowMs: number,
  config: EarningsClusterConfig = baseConfig,
): ReducerContext<EarningsClusterConfig> {
  return {
    nowMs,
    runId: RUN_ID,
    behaviorHash: hash("behavior"),
    identities,
    config,
    configHash: hash(`config:${canonicalJson(config)}`),
  };
}

function event(options: {
  type: string;
  payload: JsonObject;
  nowMs: number;
  subject?: string;
  causationId?: string;
  artifactHash?: string;
}): StoredEvent {
  sequence += 1;
  const label = `${sequence}:${options.type}`;
  return {
    envelopeVersion: 2,
    eventId: hash(`event:${label}`),
    type: options.type,
    schemaVersion: 1,
    source: "reducer-contract-test",
    subject: options.subject ?? "kernel:test",
    streamVersion: String(sequence),
    occurredAtMs: options.nowMs,
    receivedAtMs: options.nowMs,
    logicalAtMs: options.nowMs,
    correlationId: "reducer-contract-correlation",
    ...(options.causationId === undefined ? {} : { causationId: options.causationId }),
    provider: {
      provider: "test-provider",
      recordId: `record-${sequence}`,
      revisionId: "1",
      artifactHash: options.artifactHash ?? hash(`provider-artifact:${label}`),
    },
    payload: options.payload,
    position: String(sequence),
    contentHash: hash(`content:${label}`),
    previousEventHash: hash(`previous:${label}`),
    eventHash: hash(`chain:${label}`),
  };
}

function sourceEvent(
  options: {
    cik?: string;
    sourceKind?: "issuer_release" | "fmp_release" | "sec_8k" | "call";
    artifactHash?: string;
    nowMs?: number;
    provider?: string;
  } = {},
): StoredEvent {
  const cik = options.cik ?? PADDED_CIK;
  const nowMs = options.nowMs ?? BASE_TIME;
  const artifactHash = options.artifactHash ?? hash(`source-artifact:${sequence + 1}`);
  const stored = event({
    type: "earnings.source.observed",
    nowMs,
    subject: `earnings:${cik}:${PERIOD}`,
    artifactHash,
    payload: {
      issuerCik: cik,
      fiscalPeriod: PERIOD,
      sourceKind: options.sourceKind ?? "issuer_release",
      artifactHash,
      publishedAtMs: nowMs,
      timestampConfidence: "provider",
      originalTimestamp: "2027-04-15T20:00:00Z",
    },
  });
  return {
    ...stored,
    provider: {
      ...stored.provider,
      provider: options.provider ?? "issuer-ir",
    },
  };
}

function initialize(
  first: StoredEvent = sourceEvent(),
  config: EarningsClusterConfig = baseConfig,
): EarningsClusterState {
  const aggregateId = reducer.route(first);
  const initial = reducer.initialState(aggregateId, config);
  return reducer.apply(initial, first, context(first.logicalAtMs, config)).state;
}

function requireCluster(state: EarningsClusterState) {
  assert.ok(state.cluster);
  return state.cluster;
}

function requireBranch(state: EarningsClusterState, index = 0): AnalysisBranch {
  const branch = requireCluster(state).analysisBranches[index];
  assert.ok(branch);
  return branch;
}

function fillClusterToHardCap(): EarningsClusterState {
  let state = initialize();
  for (let index = 1; index < MAX_EARNINGS_CLUSTER_SOURCES; index += 1) {
    const next = sourceEvent({
      sourceKind: "call",
      artifactHash: hash(`hard-cap-artifact:${index}`),
      nowMs: BASE_TIME + index,
    });
    state = reducer.apply(state, next, context(next.logicalAtMs)).state;
  }
  return state;
}

function leaseBranch(
  state: EarningsClusterState,
  branch: AnalysisBranch,
  nowMs = BASE_TIME + 1,
): EarningsClusterState {
  const leased = event({
    type: "kernel.job.leased",
    nowMs,
    causationId: branch.jobId,
    payload: {
      jobType: "earnings.cluster.analyze",
      clusterId: requireCluster(state).clusterId,
      branchId: branch.branchId,
      jobId: branch.jobId,
      inputBundleHash: branch.inputBundleHash,
      attempt: 1,
      fencingToken: 1,
    },
  });
  return reducer.apply(state, leased, context(nowMs)).state;
}

function successEvent(
  state: EarningsClusterState,
  branch: AnalysisBranch,
  result: JsonObject = { verdict: "ok" },
  provenanceOverrides: Partial<Record<keyof AnalysisBranch["analysisContract"], string | null>> &
    Readonly<{ analysisContractHash?: string }> = {},
  inputOverrides: Readonly<{
    inputSources?: AnalysisBranch["inputSources"];
    artifactCatalog?: readonly string[];
  }> = {},
): StoredEvent {
  const contract = { ...branch.analysisContract, ...provenanceOverrides };
  const analysisContractHash =
    provenanceOverrides.analysisContractHash ?? branch.analysisContractHash;
  return event({
    type: "kernel.job.succeeded",
    nowMs: BASE_TIME + 3,
    causationId: branch.jobId,
    payload: {
      jobType: "earnings.cluster.analyze",
      clusterId: requireCluster(state).clusterId,
      branchId: branch.branchId,
      jobId: branch.jobId,
      inputBundleHash: branch.inputBundleHash,
      attempt: 1,
      fencingToken: 1,
      provenance: {
        ...contract,
        analysisContractHash,
        inputSources: inputOverrides.inputSources ?? branch.inputSources,
        artifactCatalog: inputOverrides.artifactCatalog ?? branch.artifactCatalog,
      },
      result,
    },
  });
}

test("a leased branch accepts its frozen inputs after another source arrives", () => {
  let state = initialize();
  const originalBranch = requireBranch(state);
  state = leaseBranch(state, originalBranch);

  const sourceB = sourceEvent({
    sourceKind: "call",
    artifactHash: hash("call-artifact"),
    nowMs: BASE_TIME + 2,
  });
  state = reducer.apply(state, sourceB, context(sourceB.logicalAtMs)).state;
  assert.equal(requireCluster(state).sources.length, 2);
  assert.equal(originalBranch.inputSources.length, 1);

  const currentBranch = requireBranch(state, 1);
  const mutableClusterResult = successEvent(
    state,
    originalBranch,
    { verdict: "wrong-current-cluster-inputs" },
    {},
    {
      inputSources: currentBranch.inputSources,
      artifactCatalog: currentBranch.artifactCatalog,
    },
  );
  const rejected = reducer.apply(
    state,
    mutableClusterResult,
    context(mutableClusterResult.logicalAtMs),
  );
  assert.equal(requireBranch(rejected.state).status, "pending");
  assert.equal(rejected.decisions[0]?.payload["reason"], "analysis-input-set-mismatch");

  const result = successEvent(state, originalBranch);
  const completed = reducer.apply(state, result, context(result.logicalAtMs));
  assert.equal(requireBranch(completed.state).status, "succeeded");
  assert.equal(completed.decisions[0]?.type, "earnings.analysis.succeeded");
});

test("every manifest-bound analysis identity and the contract hash are enforced", () => {
  const initial = initialize();
  const initialBranch = requireBranch(initial);
  const leased = leaseBranch(initial, initialBranch);
  const branch = requireBranch(leased);
  const mutations = [
    { extractorVersion: "wrong-extractor" },
    { featureSetId: "wrong-feature-set" },
    { promptId: "wrong-prompt" },
    { modelId: "wrong-model" },
    { datasetId: "wrong-dataset" },
    { analysisContractHash: hash("wrong-analysis-contract") },
  ] as const;

  for (const mutation of mutations) {
    const submitted = successEvent(leased, branch, { verdict: "wrong-contract" }, mutation);
    const transition = reducer.apply(leased, submitted, context(submitted.logicalAtMs));
    assert.equal(requireBranch(transition.state).status, "pending");
    assert.equal(transition.decisions[0]?.payload["reason"], "analysis-contract-mismatch");
  }
});

test("padded and unpadded CIK observations converge through the full processor", async () => {
  const clock = new ManualClock(BASE_TIME);
  const eventLog = new InMemoryEventLog({ clock });
  const store = new InMemoryProcessingStore<EarningsClusterState>(eventLog);
  const manifest: RunManifest<EarningsClusterConfig> = {
    manifestVersion: 2,
    runId: "cik-normalization-run",
    kind: "replay",
    effectsAllowed: false,
    canonicalizationVersion: "peas-json-v1",
    behavior: {
      reducerName: reducer.name,
      reducerVersion: reducer.version,
      buildDigest: hash("cik-test-build"),
      schemaRegistryDigest: hash("cik-test-schema"),
      configuration: baseConfig,
      identities,
    },
  };
  const processor = new DeterministicProcessor({ reducer, store, eventLog, manifest });

  for (const [index, cik] of ["123456", PADDED_CIK].entries()) {
    const artifactHash = hash(`cik-artifact:${index}`);
    const draft: EventDraft = {
      envelopeVersion: 2,
      type: "earnings.source.observed",
      schemaVersion: 1,
      source: "cik-normalization-test",
      subject: `earnings:${cik}:${PERIOD}`,
      occurredAtMs: clock.nowMs(),
      correlationId: "cik-normalization-correlation",
      provider: {
        provider: "cik-test",
        recordId: `cik-record-${index}`,
        revisionId: "1",
        artifactHash,
      },
      payload: {
        issuerCik: cik,
        fiscalPeriod: PERIOD,
        sourceKind: index === 0 ? "issuer_release" : "fmp_release",
        artifactHash,
        publishedAtMs: clock.nowMs(),
        timestampConfidence: "provider",
        originalTimestamp: null,
      },
    };
    const appended = await eventLog.append(draft);
    await processor.process(appended.event);
    clock.advanceBy(1);
  }

  const snapshot = await processor.snapshot();
  assert.equal(snapshot.aggregates.length, 1);
  const state = snapshot.aggregates[0]?.state;
  assert.ok(state);
  assert.equal(requireCluster(state).issuerCik, PADDED_CIK);
  assert.equal(requireCluster(state).sources.length, 2);
});

test("analysis capacity rejection does not append the source", () => {
  const config = { ...baseConfig, maxAnalysisBranches: 1 };
  let state = initialize(sourceEvent(), config);
  const clusterBefore = canonicalJson(requireCluster(state) as unknown as JsonObject);
  const stateBefore = canonicalJson(state);
  const sourceB = sourceEvent({
    sourceKind: "call",
    artifactHash: hash("capacity-artifact"),
    nowMs: BASE_TIME + 2,
  });
  const transition = reducer.apply(state, sourceB, context(sourceB.logicalAtMs, config));
  state = transition.state;

  assert.equal(canonicalJson(requireCluster(state) as unknown as JsonObject), clusterBefore);
  assert.equal(canonicalJson(state), stateBefore);
  assert.equal(state.rejectionCount, 0);
  assert.equal(transition.decisions[0]?.payload["reason"], "analysis-branch-limit-exceeded");
});

test("configuration cannot exceed the audited aggregate hard limits", () => {
  assert.doesNotThrow(() =>
    reducer.initialState(hash("at-hard-limit"), {
      ...baseConfig,
      maxSourcesPerCluster: MAX_EARNINGS_CLUSTER_SOURCES,
      maxAnalysisBranches: MAX_EARNINGS_ANALYSIS_BRANCHES,
    }),
  );
  assert.throws(() =>
    reducer.initialState(hash("sources-over-hard-limit"), {
      ...baseConfig,
      maxSourcesPerCluster: MAX_EARNINGS_CLUSTER_SOURCES + 1,
    }),
  );
  assert.throws(() =>
    reducer.initialState(hash("branches-over-hard-limit"), {
      ...baseConfig,
      maxAnalysisBranches: MAX_EARNINGS_ANALYSIS_BRANCHES + 1,
    }),
  );
});

test("persisted aggregate arrays and frozen inputs cannot exceed the hard limits", () => {
  const atCap = fillClusterToHardCap();
  assert.equal(requireCluster(atCap).sources.length, MAX_EARNINGS_CLUSTER_SOURCES);
  assert.equal(requireCluster(atCap).analysisBranches.length, MAX_EARNINGS_ANALYSIS_BRANCHES);
  assert.equal(
    requireBranch(atCap, MAX_EARNINGS_ANALYSIS_BRANCHES - 1).inputSources.length,
    MAX_EARNINGS_CLUSTER_SOURCES,
  );
  assert.doesNotThrow(() => reducer.parseState(atCap));

  const sourceOverflow = cloneJson(
    atCap as unknown as JsonObject,
  ) as unknown as EarningsClusterState;
  const firstSource = requireCluster(sourceOverflow).sources[0];
  assert.ok(firstSource);
  requireCluster(sourceOverflow).sources.push(firstSource);
  assert.throws(() => reducer.parseState(sourceOverflow));

  const branchOverflow = cloneJson(
    atCap as unknown as JsonObject,
  ) as unknown as EarningsClusterState;
  const firstBranch = requireBranch(branchOverflow);
  requireCluster(branchOverflow).analysisBranches.push(firstBranch);
  assert.throws(() => reducer.parseState(branchOverflow));

  const inputOverflow = cloneJson(
    atCap as unknown as JsonObject,
  ) as unknown as EarningsClusterState;
  const fullBranch = requireBranch(inputOverflow, MAX_EARNINGS_ANALYSIS_BRANCHES - 1);
  const firstInput = fullBranch.inputSources[0];
  assert.ok(firstInput);
  fullBranch.inputSources.push(firstInput);
  assert.throws(() => reducer.parseState(inputOverflow));
});

test("the exact hard cap is supported and a beyond-cap event cannot mutate the cluster", () => {
  const atCap = fillClusterToHardCap();
  const clusterBefore = canonicalJson(requireCluster(atCap) as unknown as JsonObject);
  const stateBefore = canonicalJson(atCap);
  const overflow = sourceEvent({
    sourceKind: "call",
    artifactHash: hash("hard-cap-overflow-artifact"),
    nowMs: BASE_TIME + MAX_EARNINGS_CLUSTER_SOURCES,
  });

  const transition = reducer.apply(atCap, overflow, context(overflow.logicalAtMs));

  assert.equal(canonicalJson(requireCluster(atCap) as unknown as JsonObject), clusterBefore);
  assert.equal(
    canonicalJson(requireCluster(transition.state) as unknown as JsonObject),
    clusterBefore,
  );
  assert.equal(canonicalJson(transition.state), stateBefore);
  assert.equal(transition.state.rejectionCount, atCap.rejectionCount);
  assert.equal(transition.decisions[0]?.payload["reason"], "cluster-source-limit-exceeded");
  assert.equal(transition.jobs.length, 0);
  assert.equal(transition.outbox.length, 0);
});

test("early, stale, and duplicate lifecycle timers retain a path to finalization", () => {
  let state = initialize();
  const original = requireCluster(state).timers.find(
    (timer) => timer.timerType === "earnings.lifecycle-finalize",
  );
  assert.ok(original);
  const originalJobId = original.jobId;
  const early = event({
    type: "kernel.timer.fired",
    nowMs: original.scheduledForLogicalMs - 1,
    causationId: original.jobId,
    payload: {
      timerType: original.timerType,
      clusterId: requireCluster(state).clusterId,
      jobId: original.jobId,
      scheduledForLogicalMs: original.scheduledForLogicalMs,
      fencingToken: 1,
    },
  });
  const recovered = reducer.apply(state, early, context(early.logicalAtMs));
  state = recovered.state;
  assert.equal(recovered.decisions[0]?.type, "kernel.timer.early-rescheduled");
  assert.equal(recovered.jobs.length, 1);
  const replacement = requireCluster(state).timers.find(
    (timer) => timer.timerType === "earnings.lifecycle-finalize",
  );
  assert.ok(replacement);
  assert.notEqual(replacement.jobId, originalJobId);

  const stale = event({
    type: "kernel.timer.fired",
    nowMs: replacement.scheduledForLogicalMs,
    causationId: originalJobId,
    payload: {
      timerType: replacement.timerType,
      clusterId: requireCluster(state).clusterId,
      jobId: originalJobId,
      scheduledForLogicalMs: replacement.scheduledForLogicalMs,
      fencingToken: 1,
    },
  });
  const staleTransition = reducer.apply(state, stale, context(stale.logicalAtMs));
  state = staleTransition.state;
  assert.equal(staleTransition.decisions[0]?.type, "kernel.timer.stale");
  assert.equal(requireCluster(state).status, "open");

  const fired = event({
    type: "kernel.timer.fired",
    nowMs: replacement.scheduledForLogicalMs,
    causationId: replacement.jobId,
    payload: {
      timerType: replacement.timerType,
      clusterId: requireCluster(state).clusterId,
      jobId: replacement.jobId,
      scheduledForLogicalMs: replacement.scheduledForLogicalMs,
      fencingToken: 2,
    },
  });
  state = reducer.apply(state, fired, context(fired.logicalAtMs)).state;
  assert.equal(requireCluster(state).status, "finalized");

  const duplicate = event({
    type: "kernel.timer.fired",
    nowMs: fired.logicalAtMs + 1,
    causationId: replacement.jobId,
    payload: fired.payload,
  });
  const duplicateTransition = reducer.apply(state, duplicate, context(duplicate.logicalAtMs));
  assert.equal(duplicateTransition.decisions[0]?.type, "kernel.timer.duplicate");
  assert.equal(requireCluster(duplicateTransition.state).status, "finalized");
});

test("analysis result limits use canonical UTF-8 bytes for ASCII, CJK, and emoji", () => {
  for (const [label, text] of [
    ["ascii", "a".repeat(12)],
    ["cjk", "界".repeat(12)],
    ["emoji", "🙂".repeat(12)],
  ] as const) {
    const result = { text };
    const byteLength = Buffer.byteLength(canonicalJson(result), "utf8");
    const state = initialize();
    const branch = requireBranch(state);
    const leased = leaseBranch(state, branch);
    const leasedBranch = requireBranch(leased);
    const submitted = successEvent(leased, leasedBranch, result);

    const exact = reducer.apply(
      leased,
      submitted,
      context(submitted.logicalAtMs, { ...baseConfig, maxAnalysisResultBytes: byteLength }),
    );
    assert.equal(requireBranch(exact.state).status, "succeeded", `${label} exact boundary`);

    const rejected = reducer.apply(
      leased,
      submitted,
      context(submitted.logicalAtMs, {
        ...baseConfig,
        maxAnalysisResultBytes: byteLength - 1,
      }),
    );
    assert.equal(requireBranch(rejected.state).status, "pending", `${label} byte overflow`);
    assert.equal(rejected.decisions[0]?.payload["reason"], "analysis-result-too-large");
  }
});

test("mirror arrivals retain provider provenance and produce one debounced analysis batch", () => {
  const sharedArtifact = hash("shared-release-artifact");
  const first = sourceEvent({ artifactHash: sharedArtifact, provider: "issuer-ir" });
  let state = initialize(first);

  const exactMirror = sourceEvent({
    sourceKind: "fmp_release",
    artifactHash: sharedArtifact,
    provider: "fmp",
    nowMs: BASE_TIME + 1,
  });
  const exactTransition = reducer.apply(state, exactMirror, context(exactMirror.logicalAtMs));
  state = exactTransition.state;
  assert.equal(exactTransition.jobs.length, 0);
  assert.equal(requireCluster(state).sources[1]?.provider, "fmp");

  const nearMirror = sourceEvent({
    sourceKind: "sec_8k",
    artifactHash: hash("near-mirror-byte-different"),
    provider: "sec",
    nowMs: BASE_TIME + 2,
  });
  const nearTransition = reducer.apply(state, nearMirror, context(nearMirror.logicalAtMs));
  state = nearTransition.state;
  assert.equal(nearTransition.jobs.length, 0);
  assert.equal(nearTransition.decisions[0]?.type, "earnings.source.mirror-debounced");

  const mirrorTimer = requireCluster(state).timers.find(
    (timer) => timer.timerType === "earnings.mirror-debounce",
  );
  assert.ok(mirrorTimer);
  const fired = event({
    type: "kernel.timer.fired",
    nowMs: mirrorTimer.scheduledForLogicalMs,
    causationId: mirrorTimer.jobId,
    payload: {
      timerType: mirrorTimer.timerType,
      clusterId: requireCluster(state).clusterId,
      jobId: mirrorTimer.jobId,
      scheduledForLogicalMs: mirrorTimer.scheduledForLogicalMs,
      fencingToken: 1,
    },
  });
  const batch = reducer.apply(state, fired, context(fired.logicalAtMs));
  assert.equal(batch.jobs.length, 1);
  assert.equal(requireCluster(batch.state).analysisBranches.length, 2);
  assert.equal(requireBranch(batch.state, 1).inputSources.length, 3);
  assert.equal(requireBranch(batch.state, 1).artifactCatalog.length, 2);
  assert.deepEqual(
    requireCluster(batch.state).sources.map((source) => source.provider),
    ["issuer-ir", "fmp", "sec"],
  );
});

test.after(() => {
  sequence = 0;
  // Exercise the JSON clone used by persisted states so accidental non-JSON additions fail here.
  cloneJson(reducer.initialState(hash("clone-check"), baseConfig));
});
