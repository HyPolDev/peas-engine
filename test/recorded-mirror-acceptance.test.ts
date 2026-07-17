import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { FMP_FIXTURE_CASES } from "../fixtures/fmp/v1/manifest.js";
import { NVIDIA_BASELINE_MANIFEST } from "../fixtures/ir/nvidia/v1/manifest.js";
import { SEC_FIXTURE_CASES, type SecFixtureCase } from "../fixtures/sec/v1/manifest.js";
import { loadRecordedFmpFixture } from "../src/adapters/fmp/recorded-fmp-fixture.js";
import { loadRecordedNvidiaFixture } from "../src/adapters/ir/nvidia/recorded-nvidia-fixture.js";
import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import {
  type RecordedSecBundleManifest,
  runRecordedSecPipeline,
} from "../src/adapters/sec/recorded-sec-pipeline.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import type {
  ArtifactObservation,
  ArtifactStore,
  VerifiedArtifactRead,
} from "../src/artifacts/artifact-store.js";
import { ManualClock } from "../src/core/clock.js";
import {
  deriveEventId,
  draftFromStored,
  type EventDraft,
  type EventLog,
  type StoredEvent,
} from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonObject, type JsonValue } from "../src/core/json.js";
import { DeterministicProcessor, type ReducerContext } from "../src/core/processor.js";
import {
  type AnalysisBranch,
  type EarningsClusterConfig,
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { makeManifest } from "./scenario.js";

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
const MIGRATIONS = loadMigrations(join(process.cwd(), "migrations"));
const REPLAY_PAGE_SIZES = [1, 2, 7, 10_000] as const;

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

function secFixture(caseId: string): SecFixtureCase {
  const fixture = SEC_FIXTURE_CASES.find((candidate) => candidate.caseId === caseId);
  assert.ok(fixture, `missing SEC fixture ${caseId}`);
  return fixture;
}

function recordedSecStore(fixture: SecFixtureCase): ArtifactStore {
  const persistedProviderId = `prv1_${canonicalHash("peas/artifact-provider-identifier/v1", {
    value: fixture.provider,
  })}`;
  const bytesByDigest = new Map(
    fixture.members.map((member) => [
      member.artifactHash,
      readFileSync(join(process.cwd(), "fixtures", "sec", "v1", member.path)),
    ]),
  );
  const observations = new Map(
    fixture.members.map((member) => {
      assert.ok(member.selectedObservation);
      const observation = {
        observationId: member.selectedObservationId,
        attemptId: member.retrievalAttempt.attemptId,
        artifactDigest: member.artifactHash,
        provider: persistedProviderId,
        recordId: fixture.recordId,
        revisionId: fixture.revisionId,
        retrievedAtMs: member.selectedObservation.retrievedAtMs,
        request: {
          method: "GET",
          origin: "https://fixture.invalid",
          pathHash: member.retrievalAttempt.requestIdentityHash,
          routeLabel: "recorded-sec-fixture",
          identityHash: member.retrievalAttempt.requestIdentityHash,
        },
        response: member.response,
        observationHash: member.selectedObservation.observationHash,
      } as unknown as ArtifactObservation;
      return [member.selectedObservationId, observation] as const;
    }),
  );
  return {
    async getObservation(id) {
      return observations.get(id);
    },
    async read(digestValue): Promise<VerifiedArtifactRead> {
      const bytes = bytesByDigest.get(digestValue);
      if (bytes === undefined) throw new Error("missing recorded SEC artifact");
      return {
        artifact: {
          digest: digestValue,
          algorithm: "sha256",
          sizeBytes: bytes.byteLength,
          committedAtMs: fixture.asOfMs,
          provenance: "retrieval",
        },
        stream: Readable.from([bytes]),
      };
    },
    async stat(digestValue) {
      const bytes = bytesByDigest.get(digestValue);
      return bytes === undefined
        ? undefined
        : {
            digest: digestValue,
            algorithm: "sha256",
            sizeBytes: bytes.byteLength,
            committedAtMs: fixture.asOfMs,
            provenance: "retrieval",
          };
    },
    async store() {
      throw new Error("recorded SEC acceptance store is read-only");
    },
    async getAttempt() {
      throw new Error("recorded SEC acceptance store has no attempt lookup");
    },
    async readObservations() {
      throw new Error("recorded SEC acceptance store has no observation scan");
    },
    async reconcile() {
      throw new Error("recorded SEC acceptance store does not reconcile");
    },
  };
}

function recordedSecManifest(fixture: SecFixtureCase): RecordedSecBundleManifest {
  return {
    asOfMs: fixture.asOfMs,
    provider: fixture.provider,
    source: fixture.source,
    recordId: fixture.recordId,
    revisionId: fixture.revisionId,
    sourceKind: fixture.sourceKind,
    accession: fixture.accession,
    subjectCik: fixture.subjectCik,
    fiscalPeriod: fixture.fiscalPeriod,
    primaryArtifactHash: fixture.expectedPrimaryArtifactHash,
    evidenceBundleHash: fixture.expected.evidenceBundleHash,
    members: fixture.presentationOrder.map((index) => {
      const member = fixture.members[index];
      assert.ok(member);
      return {
        role: member.role,
        memberKey: member.memberKey,
        artifactHash: member.artifactHash,
        selectedObservationId: member.selectedObservationId,
      };
    }),
  };
}

async function recordedSecPipelineDraft(): Promise<EventDraft> {
  const fixture = secFixture("valid-item-202");
  assert.ok(fixture.expected.evidenceBundleHash);
  const log = new InMemoryEventLog({ clock: new ManualClock(BASE) });
  const result = await runRecordedSecPipeline({
    artifactStore: recordedSecStore(fixture),
    eventLog: log,
    manifest: recordedSecManifest(fixture),
  });
  assert.equal(result.status, "emitted");
  if (result.status !== "emitted") throw new Error("recorded SEC pipeline did not emit");
  assert.equal(result.capture.disposition, "appended");
  assert.equal(
    result.normalization.draft.payload["evidenceBundleHash"],
    fixture.expected.evidenceBundleHash,
  );
  return result.normalization.draft;
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

async function readAllEvents(
  eventLog: EventLog,
  pageSize: number,
): Promise<readonly StoredEvent[]> {
  const events: StoredEvent[] = [];
  let position = "0";
  for (;;) {
    const page = await eventLog.readAfter(position, pageSize);
    events.push(...page.events);
    position = page.nextPosition;
    if (!page.hasMore) return events;
  }
}

function stateFromSnapshot(
  snapshot: Awaited<
    ReturnType<DeterministicProcessor<EarningsClusterState, EarningsClusterConfig>["snapshot"]>
  >,
): EarningsClusterState {
  const aggregate = snapshot.aggregates[0];
  assert.ok(aggregate);
  return aggregate.state;
}

async function captureRecordedPermutation(
  drafts: Readonly<{ sec: EventDraft; fmp: EventDraft; ir: EventDraft; correction: EventDraft }>,
  order: readonly ("sec" | "fmp" | "ir")[],
  runId: string,
): Promise<
  Readonly<{
    events: readonly StoredEvent[];
    snapshot: Awaited<
      ReturnType<DeterministicProcessor<EarningsClusterState, EarningsClusterConfig>["snapshot"]>
    >;
  }>
> {
  const clock = new ManualClock(BASE);
  const eventLog = new InMemoryEventLog({ clock });
  const store = new InMemoryProcessingStore<EarningsClusterState>(eventLog);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest: makeManifest(runId),
  });
  const append = async (draft: EventDraft): Promise<StoredEvent> => {
    const captured = await eventLog.append(draft);
    if (captured.disposition === "appended") await processor.process(captured.event);
    return captured.event;
  };

  await append(drafts[order[0] as "sec" | "fmp" | "ir"]);
  const firstState = stateFromSnapshot(await processor.snapshot(1));
  const firstBranch = cluster(firstState).analysisBranches[0];
  assert.ok(firstBranch);
  clock.advanceBy(1);
  await append(draftFromStored(leaseEvent(firstState, firstBranch, 2)));
  const leasedSnapshot = await processor.snapshot(1);
  assert.ok(
    leasedSnapshot.outputs.some(
      (output) =>
        output.category === "decision" && output.body["type"] === "earnings.analysis.leased",
    ),
  );

  for (const key of order.slice(1)) {
    clock.advanceBy(1);
    await append(drafts[key]);
  }
  const redelivery = await eventLog.append(drafts[order[0] as "sec" | "fmp" | "ir"]);
  assert.equal(redelivery.disposition, "redelivery");

  const identicalMirror: EventDraft = {
    ...drafts.fmp,
    source: "peas-recorded:cross-source-identical-mirror-test-v1",
    provider: {
      ...drafts.fmp.provider,
      provider: "recorded-identical-mirror",
      recordId: `mirror:${drafts.fmp.provider.recordId}`,
    },
    payload: { ...drafts.fmp.payload, sourceKind: "issuer_release" },
  };
  clock.advanceBy(1);
  await append(identicalMirror);
  clock.advanceBy(1);
  await append(drafts.correction);

  const beforeTimer = stateFromSnapshot(await processor.snapshot(2));
  const timer = timerEvent(beforeTimer, 100);
  clock.advanceTo(timer.occurredAtMs as number);
  await append(draftFromStored(timer));

  const snapshot = await processor.snapshot(7);
  const finalState = stateFromSnapshot(snapshot);
  assert.equal(cluster(finalState).analysisBranches[0]?.inputSources.length, 1);
  assert.equal(cluster(finalState).analysisBranches[0]?.expectedAttempt, 1);
  assert.equal(cluster(finalState).analysisBranches[0]?.expectedFencingToken, 1);
  assert.ok(cluster(finalState).analysisBranches.some((branch) => branch.inputSources.length > 1));
  assert.ok(
    snapshot.outputs.some(
      (output) =>
        output.category === "decision" &&
        output.body["type"] === "earnings.source.mirror-duplicate",
    ),
  );
  return { events: await readAllEvents(eventLog, 10_000), snapshot };
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

test("real recorded cross-source capture replays identically across pages and stores", async () => {
  const [recorded, sec] = await Promise.all([recordedProviderDrafts(), recordedSecPipelineDraft()]);
  const correctionManifest = FMP_FIXTURE_CASES.find(
    (fixture) => fixture.caseId === "byte-different-correction",
  );
  assert.ok(correctionManifest);
  const correction = await loadRecordedFmpFixture({
    fixtureRoot: join(process.cwd(), "fixtures", "fmp", "v1"),
    manifest: correctionManifest,
  });
  assert.equal(correction.status, "emitted");
  if (correction.status !== "emitted") throw new Error("recorded FMP correction did not emit");

  const drafts = {
    sec: routeRecordedDraftToSecFixture(sec),
    fmp: routeRecordedDraftToSecFixture(recorded.fmp),
    ir: routeRecordedDraftToSecFixture(recorded.ir),
    correction: routeRecordedDraftToSecFixture(correction.draft),
  } as const;
  assert.notEqual(drafts.fmp.provider.artifactHash, drafts.ir.provider.artifactHash);
  assert.notEqual(drafts.fmp.provider.revisionId, drafts.correction.provider.revisionId);
  assert.equal(typeof drafts.sec.payload["evidenceBundleHash"], "string");
  assert.equal("evidenceBundleHash" in drafts.fmp.payload, false);
  assert.equal("evidenceBundleHash" in drafts.ir.payload, false);

  const permutations = [
    ["sec", "fmp", "ir"],
    ["sec", "ir", "fmp"],
    ["fmp", "sec", "ir"],
    ["fmp", "ir", "sec"],
    ["ir", "sec", "fmp"],
    ["ir", "fmp", "sec"],
  ] as const;
  const sourceSets: string[] = [];
  for (const [permutationIndex, order] of permutations.entries()) {
    const runId = `recorded-mirror-permutation-${permutationIndex}`;
    const captured = await captureRecordedPermutation(drafts, order, runId);
    assert.equal(captured.events.length, 7);
    sourceSets.push(canonicalSourceSet(stateFromSnapshot(captured.snapshot)));

    for (const pageSize of REPLAY_PAGE_SIZES) {
      const replayLog = new CapturedEventLog(captured.events);
      const replayStore = new InMemoryProcessingStore<EarningsClusterState>(replayLog);
      const replay = new DeterministicProcessor({
        reducer: new EarningsClusterReducer(),
        store: replayStore,
        eventLog: replayLog,
        manifest: makeManifest(runId),
      });
      await replay.processAvailable(pageSize);
      assert.equal(
        canonicalJson((await readAllEvents(replayLog, pageSize)) as unknown as JsonValue),
        canonicalJson(captured.events as unknown as JsonValue),
      );
      assert.equal(
        canonicalJson((await replay.snapshot(pageSize)) as unknown as JsonValue),
        canonicalJson(captured.snapshot as unknown as JsonValue),
      );

      const database = openSqliteDatabase(":memory:", MIGRATIONS);
      try {
        const sqliteClock = new ManualClock(captured.events[0]?.receivedAtMs ?? BASE);
        const sqliteLog = new SqliteEventLog(database, { clock: sqliteClock });
        for (const event of captured.events) {
          sqliteClock.advanceTo(event.receivedAtMs);
          const appended = await sqliteLog.append(draftFromStored(event));
          assert.equal(appended.disposition, "appended");
          assert.equal(
            canonicalJson(appended.event as unknown as JsonValue),
            canonicalJson(event as unknown as JsonValue),
          );
        }
        const sqliteProcessor = new DeterministicProcessor({
          reducer: new EarningsClusterReducer(),
          store: new SqliteProcessingStore<EarningsClusterState>(database),
          eventLog: sqliteLog,
          manifest: makeManifest(runId),
        });
        await sqliteProcessor.processAvailable(pageSize);
        assert.equal(
          canonicalJson((await readAllEvents(sqliteLog, pageSize)) as unknown as JsonValue),
          canonicalJson(captured.events as unknown as JsonValue),
        );
        assert.equal(
          canonicalJson((await sqliteProcessor.snapshot(pageSize)) as unknown as JsonValue),
          canonicalJson(captured.snapshot as unknown as JsonValue),
        );
      } finally {
        database.close();
      }
    }
  }
  assert.equal(new Set(sourceSets).size, 1);
});
