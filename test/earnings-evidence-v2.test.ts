import assert from "node:assert/strict";
import test from "node:test";

import type { StoredEvent } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, cloneJson, type JsonObject } from "../src/core/json.js";
import type { ReducerContext } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  earningsClusterStateCanonicalBytes,
  MAX_EARNINGS_AGGREGATE_STATE_BYTES,
  MAX_EARNINGS_ANALYSIS_ARTIFACTS,
  MAX_EARNINGS_ANALYSIS_MEMBERSHIPS,
  MAX_EARNINGS_CLUSTER_SOURCES,
  MAX_EARNINGS_RETAINED_BRANCH_MEMBERSHIPS,
  MAX_EARNINGS_SOURCE_EVIDENCE_REFERENCES,
  type AnalysisBranch,
  type EarningsClusterConfig,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import {
  createProviderEvidenceBundle,
  type EvidenceReference,
  type ProviderEvidenceBundle,
} from "../src/providers/evidence-bundle.js";

const reducer = new EarningsClusterReducer();
const BASE = 1_950_000_000_000;
const CIK = "0000123456";
const PERIOD = "2027-Q2";
const SUBJECT = `earnings:${CIK}:${PERIOD}`;
const config: EarningsClusterConfig = {
  mirrorDebounceMs: 60_000,
  lifecycleMs: 3_600_000,
  maxSourcesPerCluster: 32,
  maxAnalysisBranches: 32,
  maxAnalysisResultBytes: 256_000,
};
const identities = {
  extractorVersion: "evidence-v2-extractor",
  featureSetId: "evidence-v2-features",
  promptId: null,
  modelId: null,
  datasetId: "evidence-v2-dataset",
} as const;
let sequence = 0;

function digest(label: string): string {
  return canonicalHash("peas/earnings-evidence-v2-test/v1", { label });
}

function context(
  nowMs: number,
  configuration: EarningsClusterConfig = config,
): ReducerContext<EarningsClusterConfig> {
  return {
    nowMs,
    runId: "earnings-evidence-v2-run",
    behaviorHash: digest("behavior"),
    identities,
    config: configuration,
    configHash: digest("config"),
  };
}

function stored(options: {
  type: string;
  schemaVersion?: number;
  payload: JsonObject;
  nowMs?: number;
  source?: string;
  subject?: string;
  correlationId?: string;
  causationId?: string;
  provider?: string;
  recordId?: string;
  revisionId?: string;
  artifactHash?: string;
}): StoredEvent {
  sequence += 1;
  const label = `${sequence}:${options.type}`;
  return {
    envelopeVersion: 2,
    eventId: digest(`event:${label}`),
    type: options.type,
    schemaVersion: options.schemaVersion ?? 1,
    source: options.source ?? "test:earnings-evidence-v2",
    subject: options.subject ?? SUBJECT,
    streamVersion: String(sequence),
    occurredAtMs: options.nowMs ?? BASE,
    receivedAtMs: options.nowMs ?? BASE,
    logicalAtMs: options.nowMs ?? BASE,
    correlationId: options.correlationId ?? SUBJECT,
    ...(options.causationId === undefined ? {} : { causationId: options.causationId }),
    provider: {
      provider: options.provider ?? "test-provider",
      recordId: options.recordId ?? `record-${sequence}`,
      revisionId: options.revisionId ?? "1",
      artifactHash: options.artifactHash ?? digest(`artifact:${label}`),
    },
    payload: options.payload,
    position: String(sequence),
    contentHash: digest(`content:${label}`),
    previousEventHash: digest(`previous:${label}`),
    eventHash: digest(`chain:${label}`),
  };
}

function evidence(label: string, count = 5, primary?: string): readonly EvidenceReference[] {
  assert.ok(count >= 5 && count <= MAX_EARNINGS_SOURCE_EVIDENCE_REFERENCES);
  const primaryArtifactHash = primary ?? digest(`${label}:exhibit:0`);
  const members: EvidenceReference[] = [
    { role: "sec.submissions", artifactHash: digest(`${label}:submissions`) },
    { role: "sec.filing-index", artifactHash: digest(`${label}:index`) },
    { role: "sec.primary-document", artifactHash: digest(`${label}:primary-document`) },
    { role: "sec.xbrl-instance", artifactHash: digest(`${label}:xbrl`) },
    { role: "sec.exhibit-99.1", artifactHash: primaryArtifactHash },
  ];
  for (let index = 5; index < count; index += 1) {
    members.push({ role: "sec.exhibit-99.1", artifactHash: digest(`${label}:exhibit:${index}`) });
  }
  return members;
}

function secBundle(options: {
  label: string;
  accession?: string;
  count?: number;
  primary?: string;
  revisionId?: string;
  members?: readonly EvidenceReference[];
}): ProviderEvidenceBundle {
  const members = options.members ?? evidence(options.label, options.count, options.primary);
  const primaryArtifactHash =
    options.primary ?? members.find((member) => member.role === "sec.exhibit-99.1")?.artifactHash;
  assert.ok(primaryArtifactHash);
  return createProviderEvidenceBundle({
    provider: "sec-edgar",
    source: "sec:normalizer-v1",
    recordId: `sec:${options.accession ?? "0000123456-27-000001"}:earnings-source-v2`,
    revisionId: options.revisionId ?? "1",
    subject: SUBJECT,
    issuerCik: CIK,
    fiscalPeriod: PERIOD,
    sourceKind: "sec_8k",
    primaryArtifactHash,
    evidence: members,
  });
}

function v2Event(
  bundle: ProviderEvidenceBundle,
  nowMs = BASE,
  memberOrder = bundle.evidence,
): StoredEvent {
  return stored({
    type: "earnings.source.observed",
    schemaVersion: 2,
    nowMs,
    source: bundle.source,
    subject: bundle.subject,
    correlationId: bundle.subject,
    causationId: bundle.evidenceBundleHash,
    provider: bundle.provider,
    recordId: bundle.recordId,
    revisionId: bundle.revisionId,
    artifactHash: bundle.primaryArtifactHash,
    payload: {
      issuerCik: bundle.issuerCik,
      fiscalPeriod: bundle.fiscalPeriod,
      sourceKind: bundle.sourceKind,
      primaryArtifactHash: bundle.primaryArtifactHash,
      evidenceBundleHash: bundle.evidenceBundleHash,
      evidence: memberOrder,
      publishedAtMs: nowMs,
      timestampConfidence: "exact",
      originalTimestamp: "2031-10-17T20:00:00Z",
    },
  });
}

function v1Event(nowMs = BASE): StoredEvent {
  const artifactHash = digest(`legacy:${sequence + 1}`);
  return stored({
    type: "earnings.source.observed",
    nowMs,
    artifactHash,
    provider: "legacy-sec-name-is-not-validated",
    payload: {
      issuerCik: CIK,
      fiscalPeriod: PERIOD,
      sourceKind: "issuer_release",
      artifactHash,
      publishedAtMs: nowMs,
      timestampConfidence: "provider",
      originalTimestamp: null,
    },
  });
}

function initialize(first: StoredEvent): EarningsClusterState {
  const initial = reducer.initialState(reducer.route(first), config);
  return reducer.apply(initial, first, context(first.logicalAtMs)).state;
}

function cluster(state: EarningsClusterState) {
  assert.ok(state.cluster);
  return state.cluster;
}

function branch(state: EarningsClusterState, index = 0): AnalysisBranch {
  const value = cluster(state).analysisBranches[index];
  assert.ok(value);
  return value;
}

function lease(state: EarningsClusterState, selected: AnalysisBranch): EarningsClusterState {
  const event = stored({
    type: "kernel.job.leased",
    causationId: selected.jobId,
    payload: {
      jobType: "earnings.cluster.analyze",
      clusterId: cluster(state).clusterId,
      branchId: selected.branchId,
      jobId: selected.jobId,
      inputBundleHash: selected.inputBundleHash,
      attempt: 1,
      fencingToken: 1,
    },
  });
  return reducer.apply(state, event, context(event.logicalAtMs)).state;
}

function success(
  state: EarningsClusterState,
  selected: AnalysisBranch,
  provenance: JsonObject,
): StoredEvent {
  return stored({
    type: "kernel.job.succeeded",
    causationId: selected.jobId,
    payload: {
      jobType: "earnings.cluster.analyze",
      clusterId: cluster(state).clusterId,
      branchId: selected.branchId,
      jobId: selected.jobId,
      inputBundleHash: selected.inputBundleHash,
      attempt: 1,
      fencingToken: 1,
      provenance,
      result: { verdict: "complete" },
    },
  });
}

test("reducer 3.0 starts only from schema-4 genesis and replays V1 as legacy evidence", () => {
  const first = v1Event();
  const genesis = reducer.initialState(reducer.route(first), config);
  assert.equal(reducer.version, "3.0.0");
  assert.equal(genesis.schemaVersion, 4);
  assert.throws(() => reducer.parseState({ ...genesis, schemaVersion: 3 }));

  const state = reducer.apply(genesis, first, context(first.logicalAtMs)).state;
  const source = cluster(state).sources[0];
  assert.ok(source);
  assert.equal(source.eventSchemaVersion, 1);
  assert.equal(source.evidenceBundleHash, null);
  assert.deepEqual(source.evidence, [
    { role: "legacy.primary", artifactHash: first.provider.artifactHash },
  ]);
});

test("V2 independently verifies SEC identity and canonical bundle membership", () => {
  const bundle = secBundle({ label: "permuted" });
  const first = v2Event(bundle, BASE, [...bundle.evidence].reverse());
  const state = initialize(first);
  const source = cluster(state).sources[0];
  assert.ok(source);
  assert.equal(source.eventSchemaVersion, 2);
  assert.equal(source.evidenceBundleHash, bundle.evidenceBundleHash);
  assert.equal(canonicalJson(source.evidence), canonicalJson(bundle.evidence));
  const frozenInput = branch(state).inputSources[0];
  assert.ok(frozenInput);
  assert.equal(canonicalJson(frozenInput.evidence), canonicalJson(bundle.evidence));
  assert.deepEqual(
    branch(state).artifactCatalog,
    bundle.evidence.map((member) => member.artifactHash).sort(),
  );

  for (const mutation of [
    {
      payload: { ...first.payload, evidenceBundleHash: digest("wrong-bundle") },
      causationId: digest("wrong-bundle"),
      expected: "evidence-bundle-hash-mismatch",
    },
    {
      provider: { ...first.provider, artifactHash: digest("wrong-primary") },
      expected: "artifact-provenance-mismatch",
    },
    { source: "sec:wrong", expected: "source-identity-mismatch" },
  ] as const) {
    const hostile = {
      ...first,
      ...mutation,
      eventId: digest(`mutation:${mutation.expected}`),
    } as StoredEvent;
    const transition = reducer.apply(
      reducer.initialState(reducer.route(hostile), config),
      hostile,
      context(hostile.logicalAtMs),
    );
    assert.equal(transition.decisions[0]?.payload["reason"], mutation.expected);
    assert.equal(transition.state.cluster, null);
  }
});

test("mixed V1/V2 replay retains every source and secondary-only evidence changes branch identity", () => {
  let state = initialize(v1Event());
  const primary = digest("secondary-only-primary");
  const firstMembers = evidence("secondary-a", 5, primary);
  const firstBundle = secBundle({ label: "secondary-a", primary, members: firstMembers });
  const secondMembers = firstMembers.map((member) =>
    member.role === "sec.xbrl-instance"
      ? { ...member, artifactHash: digest("secondary-b:xbrl") }
      : member,
  );
  const secondBundle = secBundle({ label: "secondary-b", primary, members: secondMembers });
  const firstV2 = v2Event(firstBundle, BASE + 60_001);
  state = reducer.apply(state, firstV2, context(firstV2.logicalAtMs)).state;
  const priorBranch = branch(state, 1);
  const secondV2 = v2Event(secondBundle, BASE + 60_002);
  state = reducer.apply(state, secondV2, context(secondV2.logicalAtMs)).state;
  const nextBranch = branch(state, 2);

  assert.equal(cluster(state).sources.length, 3);
  assert.notEqual(firstBundle.evidenceBundleHash, secondBundle.evidenceBundleHash);
  assert.notEqual(priorBranch.inputBundleHash, nextBranch.inputBundleHash);
  assert.notEqual(priorBranch.branchId, nextBranch.branchId);
});

test("result provenance rejects omission but accepts canonical-order permutations", () => {
  let state = initialize(v2Event(secBundle({ label: "result", count: 8 })));
  state = lease(state, branch(state));
  const selected = branch(state);
  const incomplete = cloneJson(
    selected.inputSources as unknown as JsonObject[],
  ) as unknown as AnalysisBranch["inputSources"];
  incomplete[0]?.evidence.pop();
  const omitted = success(state, selected, {
    ...selected.analysisContract,
    analysisContractHash: selected.analysisContractHash,
    inputSources: incomplete,
    artifactCatalog: selected.artifactCatalog,
  });
  const rejected = reducer.apply(state, omitted, context(omitted.logicalAtMs));
  assert.equal(rejected.decisions[0]?.payload["reason"], "invalid-job-success-payload");
  assert.equal(branch(rejected.state).status, "pending");

  const permutedInputs = [...selected.inputSources]
    .reverse()
    .map((input) => ({ ...input, evidence: [...input.evidence].reverse() }));
  const completedEvent = success(state, selected, {
    ...selected.analysisContract,
    analysisContractHash: selected.analysisContractHash,
    inputSources: permutedInputs,
    artifactCatalog: [...selected.artifactCatalog].reverse(),
  });
  const completed = reducer.apply(state, completedEvent, context(completedEvent.logicalAtMs));
  assert.equal(branch(completed.state).status, "succeeded");
});

function denseState(): EarningsClusterState {
  const firstBundle = secBundle({ label: "dense-0", accession: "0000123456-27-000100", count: 16 });
  let state = initialize(v2Event(firstBundle));
  for (let index = 1; index < MAX_EARNINGS_CLUSTER_SOURCES; index += 1) {
    const accession = `0000123456-27-${String(index + 100).padStart(6, "0")}`;
    const next = v2Event(
      secBundle({ label: `dense-${index}`, accession, count: 16 }),
      BASE + index,
    );
    state = reducer.apply(state, next, context(next.logicalAtMs)).state;
  }
  const timer = cluster(state).timers.find(
    (candidate) => candidate.timerType === "earnings.mirror-debounce",
  );
  assert.ok(timer);
  const fired = stored({
    type: "kernel.timer.fired",
    nowMs: timer.scheduledForLogicalMs,
    causationId: timer.jobId,
    payload: {
      timerType: timer.timerType,
      clusterId: cluster(state).clusterId,
      jobId: timer.jobId,
      scheduledForLogicalMs: timer.scheduledForLogicalMs,
      fencingToken: 1,
    },
  });
  return reducer.apply(state, fired, context(fired.logicalAtMs)).state;
}

test("dense 32x16 reaches every exact input ceiling and one-over source addition is byte-identical", () => {
  const state = denseState();
  const dense = branch(state, 1);
  assert.equal(cluster(state).sources.length, 32);
  assert.equal(dense.inputSources.length, 32);
  assert.equal(
    dense.inputSources.flatMap((input) => input.evidence).length,
    MAX_EARNINGS_ANALYSIS_MEMBERSHIPS,
  );
  assert.equal(dense.artifactCatalog.length, MAX_EARNINGS_ANALYSIS_ARTIFACTS);
  assert.doesNotThrow(() => reducer.parseState(state));

  const before = canonicalJson(state);
  const overflow = v2Event(
    secBundle({ label: "dense-over", accession: "0000123456-27-000999", count: 16 }),
    BASE + 33,
  );
  const transition = reducer.apply(state, overflow, context(overflow.logicalAtMs));
  assert.equal(canonicalJson(transition.state), before);
  assert.equal(transition.decisions[0]?.payload["reason"], "cluster-source-limit-exceeded");

  const tooMany = [
    ...secBundle({ label: "member-over", count: 16 }).evidence,
    { role: "sec.exhibit-99.1", artifactHash: digest("member-over:17") },
  ];
  const overEventBase = v2Event(secBundle({ label: "member-over", count: 16 }));
  const overEvent = { ...overEventBase, payload: { ...overEventBase.payload, evidence: tooMany } };
  const overTransition = reducer.apply(
    reducer.initialState(reducer.route(overEvent), config),
    overEvent,
    context(overEvent.logicalAtMs),
  );
  assert.equal(overTransition.decisions[0]?.payload["reason"], "source-evidence-limit-exceeded");
});

test("mirror timer capacity fallback fires the timer without adding a branch", () => {
  let state = initialize(v1Event());
  const mirrorBase = v1Event(BASE + 1);
  const mirror = {
    ...mirrorBase,
    provider: { ...mirrorBase.provider, provider: "fmp" },
    payload: { ...mirrorBase.payload, sourceKind: "fmp_release" },
  };
  state = reducer.apply(state, mirror, context(mirror.logicalAtMs)).state;
  const timer = cluster(state).timers.find(
    (candidate) => candidate.timerType === "earnings.mirror-debounce",
  );
  assert.ok(timer);
  const fired = stored({
    type: "kernel.timer.fired",
    nowMs: timer.scheduledForLogicalMs,
    causationId: timer.jobId,
    payload: {
      timerType: timer.timerType,
      clusterId: cluster(state).clusterId,
      jobId: timer.jobId,
      scheduledForLogicalMs: timer.scheduledForLogicalMs,
      fencingToken: 1,
    },
  });
  const transition = reducer.apply(
    state,
    fired,
    context(fired.logicalAtMs, { ...config, maxAnalysisBranches: 1 }),
  );
  assert.equal(cluster(transition.state).analysisBranches.length, 1);
  assert.equal(
    cluster(transition.state).timers.find(
      (candidate) => candidate.timerType === "earnings.mirror-debounce",
    )?.status,
    "fired",
  );
  assert.equal(transition.decisions[1]?.type, "earnings.analysis.capacity-exhausted");
});

function exactByteState(source: EarningsClusterState): EarningsClusterState {
  const state = cloneJson(source as unknown as JsonObject) as unknown as EarningsClusterState;
  const dense = branch(state, 1);
  cluster(state).analysisBranches = Array.from({ length: 32 }, (_, index) => ({
    ...(cloneJson(dense as unknown as JsonObject) as unknown as AnalysisBranch),
    branchId: digest(`byte-branch:${index}`),
    jobId: digest(`byte-job:${index}`),
    status: "pending" as const,
    expectedAttempt: 0,
    expectedFencingToken: 0,
    resultEventId: null,
    resultHash: null,
    errorCode: null,
  }));
  assert.equal(
    cluster(state).analysisBranches.reduce(
      (total, item) => total + item.inputSources.flatMap((input) => input.evidence).length,
      0,
    ),
    MAX_EARNINGS_RETAINED_BRANCH_MEMBERSHIPS,
  );

  const target = MAX_EARNINGS_AGGREGATE_STATE_BYTES;
  const baseBytes = earningsClusterStateCanonicalBytes(state);
  const estimate = Math.max(1, Math.floor((target - baseBytes) / (32 * 33)));
  for (
    let positionLength = Math.max(1, estimate - 4);
    positionLength <= estimate + 4;
    positionLength += 1
  ) {
    const position = "1".repeat(positionLength);
    for (const observed of cluster(state).sources) observed.position = position;
    for (const item of cluster(state).analysisBranches) {
      for (const input of item.inputSources) input.position = position;
      item.inputSources.sort((left, right) =>
        left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0,
      );
    }
    const adjustable = cluster(state).sources.slice(0, 3);
    assert.equal(adjustable.length, 3);
    for (const source of adjustable) source.originalTimestamp = "";
    const remaining = target - earningsClusterStateCanonicalBytes(state);
    if (remaining >= 0 && remaining <= 3 * 510) {
      let pending = remaining;
      for (const source of adjustable) {
        const bytes = Math.min(510, pending);
        source.originalTimestamp = "t".repeat(bytes);
        pending -= bytes;
      }
      if (earningsClusterStateCanonicalBytes(state) === target) return state;
    }
  }
  throw new Error("Unable to synthesize exact aggregate byte boundary");
}

test("exact 8 MiB state is accepted and an over-cap success leaves it byte-identical", () => {
  const exact = exactByteState(denseState());
  assert.equal(earningsClusterStateCanonicalBytes(exact), MAX_EARNINGS_AGGREGATE_STATE_BYTES);
  assert.doesNotThrow(() => reducer.parseState(exact));
  const over = cloneJson(exact as unknown as JsonObject) as unknown as EarningsClusterState;
  const first = cluster(over).sources[0];
  assert.ok(first && first.originalTimestamp !== null);
  first.originalTimestamp += "x";
  assert.throws(() => reducer.parseState(over));

  const leased = lease(exact, branch(exact));
  assert.equal(earningsClusterStateCanonicalBytes(leased), MAX_EARNINGS_AGGREGATE_STATE_BYTES);
  const selected = branch(leased);
  const completedEvent = success(leased, selected, {
    ...selected.analysisContract,
    analysisContractHash: selected.analysisContractHash,
    inputSources: selected.inputSources,
    artifactCatalog: selected.artifactCatalog,
  });
  const transition = reducer.apply(leased, completedEvent, context(completedEvent.logicalAtMs));
  assert.equal(canonicalJson(transition.state), canonicalJson(leased));
  assert.equal(transition.decisions[0]?.payload["reason"], "aggregate-state-capacity-exceeded");
});

test("hostile state and payload inputs fail closed", () => {
  const genesis = reducer.initialState(digest("hostile"), config);
  assert.throws(() => reducer.parseState(new Proxy(genesis, {})));
  const hostile = v1Event();
  Object.defineProperty(hostile, "payload", {
    value: new Proxy(hostile.payload, {}),
    enumerable: true,
  });
  const transition = reducer.apply(
    reducer.initialState(reducer.route(hostile), config),
    hostile,
    context(hostile.logicalAtMs),
  );
  assert.equal(transition.decisions[0]?.payload["reason"], "invalid-source-payload");
});

test.after(() => {
  sequence = 0;
});
