import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { FMP_FIXTURE_CASES } from "../fixtures/fmp/v1/manifest.js";
import { NVIDIA_BASELINE_MANIFEST } from "../fixtures/ir/nvidia/v1/manifest.js";
import { loadRecordedFmpFixture } from "../src/adapters/fmp/recorded-fmp-fixture.js";
import { loadRecordedNvidiaFixture } from "../src/adapters/ir/nvidia/recorded-nvidia-fixture.js";
import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { ManualClock } from "../src/core/clock.js";
import { deriveEventId, type EventDraft, type StoredEvent } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonObject, type JsonValue } from "../src/core/json.js";
import type { ReducerContext } from "../src/core/processor.js";
import {
  type AnalysisBranch,
  type EarningsClusterConfig,
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";

const reducer = new EarningsClusterReducer();
const BASE = 1_800_000_000_000;
const SUBJECT = "earnings:0000123456:2026-Q1";
const CIK = "0000123456";
const PERIOD = "2026-Q1";
const config: EarningsClusterConfig = {
  mirrorDebounceMs: 60_000,
  lifecycleMs: 3_600_000,
  maxSourcesPerCluster: 32,
  maxAnalysisBranches: 32,
  maxAnalysisResultBytes: 256_000,
};
const identities = {
  extractorVersion: "recorded-mirror-extractor-v1",
  featureSetId: "recorded-mirror-features-v1",
  promptId: null,
  modelId: null,
  datasetId: "recorded-mirror-synthetic-v1",
} as const;

function digest(label: string): string {
  return canonicalHash("peas/recorded-mirror-acceptance/v1", { label });
}

function context(nowMs: number): ReducerContext<EarningsClusterConfig> {
  return {
    nowMs,
    runId: "recorded-mirror-run",
    behaviorHash: digest("behavior"),
    identities,
    config,
    configHash: digest("config"),
  };
}

function storedFromDraft(draft: EventDraft, position: number, nowMs: number): StoredEvent {
  const eventId = deriveEventId(draft.provider);
  return {
    ...draft,
    eventId,
    streamVersion: String(position),
    receivedAtMs: nowMs,
    logicalAtMs: nowMs,
    position: String(position),
    contentHash: digest(`content:${eventId}:${position}`),
    previousEventHash: digest(`previous:${position}`),
    eventHash: digest(`event:${eventId}:${position}`),
  };
}

function legacyDraft(options: {
  provider: "financial-modeling-prep" | "nvidia-ir";
  recordId: string;
  revisionId: string;
  artifactHash: string;
  sourceKind: "fmp_release" | "issuer_release";
  publishedAtMs?: number;
}): EventDraft {
  const publishedAtMs = options.publishedAtMs ?? BASE - 1_000;
  return {
    envelopeVersion: 2,
    type: "earnings.source.observed",
    schemaVersion: 1,
    source:
      options.provider === "financial-modeling-prep"
        ? "peas-recorded:fmp-press-release-synthetic-v1"
        : "peas-recorded:nvidia-newsroom-press-release-synthetic-v1",
    subject: SUBJECT,
    occurredAtMs: publishedAtMs,
    correlationId: SUBJECT,
    provider: {
      provider: options.provider,
      recordId: options.recordId,
      revisionId: options.revisionId,
      artifactHash: options.artifactHash,
    },
    payload: {
      issuerCik: CIK,
      fiscalPeriod: PERIOD,
      sourceKind: options.sourceKind,
      artifactHash: options.artifactHash,
      publishedAtMs,
      timestampConfidence: "provider",
      originalTimestamp: "2027-01-01T12:00:00Z",
    },
  };
}

function recordedSecDraft(): EventDraft {
  const path = join(process.cwd(), "fixtures", "recorded-sec-pr2b.captured.ndjson");
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .find((value) => value.length > 0);
  assert.ok(line);
  const event = JSON.parse(line) as StoredEvent;
  return {
    envelopeVersion: event.envelopeVersion,
    type: event.type,
    schemaVersion: event.schemaVersion,
    source: event.source,
    subject: event.subject,
    occurredAtMs: event.occurredAtMs,
    correlationId: event.correlationId,
    ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
    provider: event.provider,
    payload: event.payload,
  };
}

async function recordedProviderDrafts(): Promise<Readonly<{ fmp: EventDraft; ir: EventDraft }>> {
  const fmpManifest = FMP_FIXTURE_CASES.find(
    (fixture) => fixture.caseId === "latest-explicit-time",
  );
  assert.ok(fmpManifest);
  const [fmp, ir] = await Promise.all([
    loadRecordedFmpFixture({
      fixtureRoot: join(process.cwd(), "fixtures", "fmp", "v1"),
      manifest: fmpManifest,
    }),
    loadRecordedNvidiaFixture({
      fixtureRoot: join(process.cwd(), "fixtures", "ir", "nvidia", "v1"),
      manifest: NVIDIA_BASELINE_MANIFEST,
    }),
  ]);
  assert.ok(fmp.status === "emitted");
  assert.ok(ir.status === "emitted" && ir.normalization?.status === "emitted");
  return { fmp: fmp.draft, ir: ir.normalization.draft };
}

function routeRecordedDraftToSecFixture(draft: EventDraft): EventDraft {
  return {
    ...draft,
    subject: SUBJECT,
    correlationId: SUBJECT,
    payload: { ...draft.payload, issuerCik: CIK, fiscalPeriod: PERIOD },
  };
}

function initialize(event: StoredEvent): EarningsClusterState {
  const initial = reducer.initialState(reducer.route(event), config);
  return reducer.apply(initial, event, context(event.logicalAtMs)).state;
}

function apply(
  state: EarningsClusterState,
  event: StoredEvent,
): ReturnType<EarningsClusterReducer["apply"]> {
  return reducer.apply(state, event, context(event.logicalAtMs));
}

function cluster(state: EarningsClusterState) {
  assert.ok(state.cluster);
  return state.cluster;
}

function canonicalSourceSet(state: EarningsClusterState): string {
  return canonicalJson(
    cluster(state)
      .sources.map((source) => ({
        provider: source.provider,
        recordId: source.providerRecordId,
        revisionId: source.providerRevisionId,
        primaryArtifactHash: source.primaryArtifactHash,
        evidenceBundleHash: source.evidenceBundleHash,
      }))
      .sort((left, right) => (canonicalJson(left) < canonicalJson(right) ? -1 : 1)) as JsonValue,
  );
}

function timerEvent(state: EarningsClusterState, position: number): StoredEvent {
  const timer = cluster(state).timers.find(
    (candidate) => candidate.timerType === "earnings.mirror-debounce",
  );
  assert.ok(timer);
  return storedFromDraft(
    {
      envelopeVersion: 2,
      type: "kernel.timer.fired",
      schemaVersion: 1,
      source: "test:recorded-mirror",
      subject: SUBJECT,
      occurredAtMs: timer.scheduledForLogicalMs,
      correlationId: SUBJECT,
      causationId: timer.jobId,
      provider: {
        provider: "test-kernel",
        recordId: timer.jobId,
        revisionId: "1",
        artifactHash: digest(`timer:${timer.jobId}`),
      },
      payload: {
        timerType: timer.timerType,
        clusterId: cluster(state).clusterId,
        jobId: timer.jobId,
        scheduledForLogicalMs: timer.scheduledForLogicalMs,
        fencingToken: 1,
      },
    },
    position,
    timer.scheduledForLogicalMs,
  );
}

function leaseEvent(
  state: EarningsClusterState,
  branch: AnalysisBranch,
  position: number,
): StoredEvent {
  return storedFromDraft(
    {
      envelopeVersion: 2,
      type: "kernel.job.leased",
      schemaVersion: 1,
      source: "test:recorded-mirror",
      subject: SUBJECT,
      occurredAtMs: BASE + position,
      correlationId: SUBJECT,
      causationId: branch.jobId,
      provider: {
        provider: "test-kernel",
        recordId: branch.jobId,
        revisionId: "lease-1",
        artifactHash: digest(`lease:${branch.jobId}`),
      },
      payload: {
        jobType: "earnings.cluster.analyze",
        clusterId: cluster(state).clusterId,
        branchId: branch.branchId,
        jobId: branch.jobId,
        inputBundleHash: branch.inputBundleHash,
        attempt: 1,
        fencingToken: 1,
      },
    },
    position,
    BASE + position,
  );
}

test("FMP and issuer-IR preserve provenance across identical and byte-different mirrors", () => {
  const shared = digest("shared-release-body");
  const fmp = storedFromDraft(
    legacyDraft({
      provider: "financial-modeling-prep",
      recordId: "fmp:nvda:release-1",
      revisionId: "fmp-rev-1",
      artifactHash: shared,
      sourceKind: "fmp_release",
    }),
    1,
    BASE,
  );
  const irMirror = storedFromDraft(
    legacyDraft({
      provider: "nvidia-ir",
      recordId: "nvidia-ir:release-1",
      revisionId: "ir-rev-1",
      artifactHash: shared,
      sourceKind: "issuer_release",
    }),
    2,
    BASE + 1,
  );
  let state = initialize(fmp);
  const duplicate = apply(state, irMirror);
  state = duplicate.state;
  assert.equal(duplicate.decisions[0]?.type, "earnings.source.mirror-duplicate");
  assert.equal(cluster(state).sources.length, 2);
  assert.equal(cluster(state).analysisBranches.length, 1);
  assert.notEqual(cluster(state).sources[0]?.provider, cluster(state).sources[1]?.provider);

  const correction = storedFromDraft(
    legacyDraft({
      provider: "nvidia-ir",
      recordId: "nvidia-ir:release-1",
      revisionId: "ir-rev-2",
      artifactHash: digest("changed-release-body"),
      sourceKind: "issuer_release",
    }),
    3,
    BASE + 2,
  );
  const changed = apply(state, correction);
  state = changed.state;
  assert.equal(changed.decisions[0]?.type, "earnings.source.mirror-debounced");
  assert.equal(cluster(state).sources.length, 3);
  assert.equal(cluster(state).analysisBranches.length, 1);
  state = apply(state, timerEvent(state, 4)).state;
  assert.equal(cluster(state).analysisBranches.length, 2);
  assert.equal(cluster(state).analysisBranches[1]?.inputSources.length, 3);
});

test("recorded loader outputs integrate across all arrival permutations", async () => {
  const recorded = await recordedProviderDrafts();
  const drafts = [
    recordedSecDraft(),
    routeRecordedDraftToSecFixture(recorded.fmp),
    routeRecordedDraftToSecFixture(recorded.ir),
  ];
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ] as const;
  const outputs = permutations.map((order) => {
    const events = order.map((index, position) =>
      storedFromDraft(drafts[index] as EventDraft, position + 1, BASE + position),
    );
    let state = initialize(events[0] as StoredEvent);
    for (const event of events.slice(1)) state = apply(state, event).state;
    state = apply(state, timerEvent(state, 4)).state;
    assert.equal(cluster(state).sources.length, 3);
    return canonicalSourceSet(state);
  });
  assert.equal(new Set(outputs).size, 1);
});

test("SEC v2 equality does not erase its bundle, while revision and redelivery remain deterministic", async () => {
  const sec = recordedSecDraft();
  const secPrimary = sec.provider.artifactHash;
  const fmp = legacyDraft({
    provider: "financial-modeling-prep",
    recordId: "fmp:sec-byte-mirror",
    revisionId: "fmp-rev-1",
    artifactHash: secPrimary,
    sourceKind: "fmp_release",
  });
  let state = initialize(storedFromDraft(sec, 1, BASE));
  const joined = apply(state, storedFromDraft(fmp, 2, BASE + 1));
  state = joined.state;
  assert.notEqual(joined.decisions[0]?.type, "earnings.source.mirror-duplicate");
  assert.equal(cluster(state).sources[0]?.evidenceBundleHash === null, false);
  assert.equal(cluster(state).sources[1]?.evidenceBundleHash, null);

  const revised = legacyDraft({
    provider: "financial-modeling-prep",
    recordId: "fmp:sec-byte-mirror",
    revisionId: "fmp-rev-2",
    artifactHash: digest("fmp-correction"),
    sourceKind: "fmp_release",
  });
  state = apply(state, storedFromDraft(revised, 3, BASE + 2)).state;
  assert.deepEqual(
    cluster(state)
      .sources.filter((source) => source.provider === "financial-modeling-prep")
      .map((source) => source.providerRevisionId),
    ["fmp-rev-1", "fmp-rev-2"],
  );

  const log = new InMemoryEventLog({ clock: new ManualClock(BASE) });
  const first = await log.append(fmp);
  const redelivery = await log.append(fmp);
  assert.equal(first.disposition, "appended");
  assert.equal(redelivery.disposition, "redelivery");
  assert.equal(redelivery.event.eventId, first.event.eventId);
  const page = await log.readAfter("0", 10_000);
  assert.equal(page.events.length, 1);
});

test("an arrival during an active analysis lease creates a new immutable branch", () => {
  const first = storedFromDraft(
    legacyDraft({
      provider: "financial-modeling-prep",
      recordId: "fmp:leased-first",
      revisionId: "1",
      artifactHash: digest("leased-first"),
      sourceKind: "fmp_release",
    }),
    1,
    BASE,
  );
  let state = initialize(first);
  const leasedBranch = cluster(state).analysisBranches[0];
  assert.ok(leasedBranch);
  const frozenInputHash = canonicalHash(
    "peas/recorded-mirror-frozen-input/v1",
    leasedBranch.inputSources as unknown as JsonObject[],
  );
  const leased = apply(state, leaseEvent(state, leasedBranch, 2));
  assert.equal(leased.decisions[0]?.type, "earnings.analysis.leased");
  state = leased.state;

  const later = storedFromDraft(
    legacyDraft({
      provider: "nvidia-ir",
      recordId: "nvidia-ir:after-lease",
      revisionId: "1",
      artifactHash: digest("after-lease"),
      sourceKind: "issuer_release",
    }),
    3,
    BASE + config.mirrorDebounceMs + 1,
  );
  state = apply(state, later).state;
  assert.equal(cluster(state).analysisBranches.length, 2);
  const original = cluster(state).analysisBranches[0];
  const incremental = cluster(state).analysisBranches[1];
  assert.ok(original && incremental);
  assert.equal(
    canonicalHash(
      "peas/recorded-mirror-frozen-input/v1",
      original.inputSources as unknown as JsonObject[],
    ),
    frozenInputHash,
  );
  assert.equal(original.inputSources.length, 1);
  assert.equal(incremental.inputSources.length, 2);
  assert.notEqual(original.inputBundleHash, incremental.inputBundleHash);
});
