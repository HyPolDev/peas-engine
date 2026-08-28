import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { ManualClock } from "../src/core/clock.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import {
  amendEventPlan,
  compileCalendarCandidates,
  compileEventPlan,
  createEventCluster,
  deriveEventClusterRequestId,
  EVENT_CLUSTER_EFFECTS_ZERO,
  EventClusterBetaError,
  eventClusterSnapshotDraft,
  latestEventClusterSnapshot,
  normalizeExhibitAlias,
  recordEventClusterMember,
  recordStableMissing,
  settleEventCluster,
  transitionEventCluster,
  type CalendarCandidate,
  type EventCluster,
  type EventClusterLane,
  type EventClusterMember,
  type EventPlan,
  type EventPlanSpec,
  type ProviderCapabilityEntry,
} from "../src/domain/event-cluster-beta.js";

const candidate: CalendarCandidate = {
  calendarSourceId: "calendar.synthetic",
  calendarRevisionId: "revision-1",
  issuerId: "issuer-adsk",
  cik: "0000769397",
  ticker: "ADSK",
  exchange: "NASDAQ",
  instrumentId: "instrument-adsk",
  sectorBenchmark: "IGV",
  fiscalPeriod: "2027-Q2",
  expectedEventDate: "2026-08-27",
  expectedSession: "after-market",
  discoveredAtMs: 100,
};

const spec: EventPlanSpec = {
  windows: {
    activationStartMs: 1_000,
    primaryStartMs: 2_000,
    primaryEndMs: 4_000,
    settlementEndMs: 8_000,
  },
  sourceAssignments: [
    { lane: "sec", providerId: "sec.recorded", capabilities: ["sec-filing", "filing-exhibit"] },
    { lane: "issuer-ir", providerId: "ir.recorded", capabilities: ["issuer-release"] },
    { lane: "transcript", providerId: "transcript.recorded", capabilities: ["transcript"] },
    {
      lane: "market",
      providerId: "market.synthetic",
      capabilities: ["market-bars", "benchmark-market-data"],
    },
  ],
  expectedForms: ["10-K", "10-Q", "8-K"],
  expectedItems: ["9.01", "2.02", "7.01"],
  exhibitAliases: ["EX-99.1", "EX-99"],
  rawRetention: "immutable",
  duplicatePolicy: "provider-record-revision",
  correctionPolicy: "explicit-replacement",
  stableMissingPolicy: "lane-settlement",
  prohibitedEffects: EVENT_CLUSTER_EFFECTS_ZERO,
};

const registry: readonly ProviderCapabilityEntry[] = [
  {
    providerId: "sec.recorded",
    capability: "sec-filing",
    available: true,
    credentialRequirement: "none",
  },
  {
    providerId: "sec.recorded",
    capability: "filing-exhibit",
    available: true,
    credentialRequirement: "none",
  },
  {
    providerId: "ir.recorded",
    capability: "issuer-release",
    available: true,
    credentialRequirement: "none",
  },
  {
    providerId: "transcript.recorded",
    capability: "transcript",
    available: true,
    credentialRequirement: "none",
  },
  {
    providerId: "market.synthetic",
    capability: "market-bars",
    available: true,
    credentialRequirement: "none",
  },
  {
    providerId: "market.synthetic",
    capability: "benchmark-market-data",
    available: true,
    credentialRequirement: "none",
  },
];

function plan(): EventPlan {
  return compileEventPlan(candidate, spec, registry);
}

function activeCluster(eventPlan = plan()): EventCluster {
  let cluster = createEventCluster(eventPlan, 100);
  cluster = transitionEventCluster(cluster, "prewarming", 200);
  cluster = transitionEventCluster(cluster, "frozen", 300);
  return transitionEventCluster(cluster, "active", 1_000);
}

function artifact(label: string): string {
  return canonicalHash("peas/event-cluster-test-artifact/v1", label);
}

function member(
  lane: EventClusterLane,
  kind: EventClusterMember["kind"],
  recordId: string,
  revisionId = "revision-1",
  options: Partial<EventClusterMember> = {},
): EventClusterMember {
  const capability =
    kind === "issuer-release"
      ? "issuer-release"
      : kind === "transcript"
        ? "transcript"
        : kind === "market-bars"
          ? "market-bars"
          : "sec-filing";
  const form =
    kind === "sec-8-k" ? "8-K" : kind === "sec-10-q" ? "10-Q" : kind === "sec-10-k" ? "10-K" : null;
  const providerId =
    lane === "issuer-ir"
      ? "ir.recorded"
      : lane === "market"
        ? "market.synthetic"
        : `${lane}.recorded`;
  return {
    lane,
    kind,
    issuerId: candidate.issuerId,
    cik: candidate.cik,
    fiscalPeriod: candidate.fiscalPeriod,
    providerId,
    recordId,
    revisionId,
    artifactDigest: artifact(`${recordId}:${revisionId}`),
    requestIdentity: {
      requestId: deriveEventClusterRequestId({
        providerId,
        capability,
        recordId,
        revisionId,
      }),
      providerId,
      capability,
    },
    normalization: {
      normalizerId: `${lane}.normalizer-v1`,
      sourceArtifactDigest: artifact(`${recordId}:${revisionId}`),
      normalizedEventId: artifact(`event:${recordId}:${revisionId}`),
      normalizedEventHash: artifact(`event-hash:${recordId}:${revisionId}`),
    },
    form,
    items: kind === "sec-8-k" ? ["2.02", "7.01", "9.01"] : [],
    exhibitAlias: kind === "sec-8-k" ? "EX-99.1" : null,
    publicationOrAcceptanceAtMs: 2_500,
    firstObservedAtMs: 2_600,
    retrievedAtMs: 2_700,
    relationship: "original",
    replacesArtifactDigest: null,
    ...options,
  };
}

test("calendar compilation is deterministic and rejects conflicting dates", () => {
  const first = compileCalendarCandidates([candidate], spec, registry)[0];
  const second = compileCalendarCandidates([{ ...candidate }], { ...spec }, [...registry])[0];
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.planId, second.planId);
  assert.equal(first.revisionDigest, second.revisionDigest);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(first.expectedForms, ["10-K", "10-Q", "8-K"]);
  assert.deepEqual(first.expectedItems, ["2.02", "7.01", "9.01"]);
  assert.deepEqual(first.exhibitAliases, ["EX-99", "EX-99.1"]);
  assert.deepEqual(first.marketSubjects, ["ADSK", "SPY", "IGV"]);
  assert.equal(
    first.marketWindows.every((window) => window.granularity === "one-minute-bars"),
    true,
  );
  assert.deepEqual(
    first.marketWindows
      .filter((window) => window.anchor === "event-relative")
      .map((window) => [window.id, window.startMinuteOffset, window.endMinuteOffset]),
    [
      ["pre-event", -30, -1],
      ["release-gap", 0, 0],
      ["plus-1", 1, 1],
      ["plus-5", 5, 5],
      ["plus-30", 30, 30],
    ],
  );
  assert.equal(
    first.marketWindows.every(
      (window) => window.evidenceClass === "coarse-movement-not-tradability",
    ),
    true,
  );

  assert.throws(
    () =>
      compileCalendarCandidates(
        [
          candidate,
          { ...candidate, calendarSourceId: "calendar.other", expectedEventDate: "2026-08-28" },
        ],
        spec,
        registry,
      ),
    (error: unknown) =>
      error instanceof EventClusterBetaError && error.code === "event-plan.calendar-conflict",
  );
});

test("before-market, after-market, and unknown session values produce distinct frozen plans", () => {
  const plans = (["before-market", "after-market", "unknown"] as const).map((expectedSession) =>
    compileEventPlan({ ...candidate, expectedSession }, spec, registry),
  );
  assert.equal(new Set(plans.map((value) => value.planId)).size, 3);
  assert.deepEqual(
    plans.map((value) => value.candidate.expectedSession),
    ["before-market", "after-market", "unknown"],
  );
});

test("provider capability unavailability is lane-scoped and stable", () => {
  const unavailableRegistry = registry.map((entry) =>
    entry.providerId === "transcript.recorded" ? { ...entry, available: false } : entry,
  );
  const eventPlan = compileEventPlan(candidate, spec, unavailableRegistry);
  const transcript = eventPlan.acquisitionPlans.find((entry) => entry.lane === "transcript");
  assert.equal(transcript?.readiness, "capability-unavailable");
  assert.equal(transcript?.blocker, "capability-unavailable:transcript");
  const cluster = createEventCluster(eventPlan, 100);
  assert.equal(cluster.lanes.find((lane) => lane.lane === "transcript")?.status, "stable-missing");
  assert.equal(cluster.lanes.find((lane) => lane.lane === "sec")?.status, "pending");
});

test("independent lanes allow issuer release without SEC and SEC without transcript", () => {
  const eventPlan = plan();
  let issuerFirst = activeCluster(eventPlan);
  issuerFirst = recordEventClusterMember(
    issuerFirst,
    eventPlan,
    member("issuer-ir", "issuer-release", "issuer-release-1", "revision-1", {
      providerId: "ir.recorded",
    }),
  );
  assert.equal(issuerFirst.status, "primary-observed");
  assert.equal(issuerFirst.lanes.find((lane) => lane.lane === "issuer-ir")?.status, "observed");
  assert.equal(issuerFirst.lanes.find((lane) => lane.lane === "sec")?.status, "pending");
  issuerFirst = recordStableMissing(issuerFirst, "sec", "no-qualifying-filing", 4_500);
  assert.equal(issuerFirst.lanes.find((lane) => lane.lane === "sec")?.status, "stable-missing");

  let secFirst = activeCluster(eventPlan);
  secFirst = recordEventClusterMember(
    secFirst,
    eventPlan,
    member("sec", "sec-8-k", "0000769397-26-000059", "revision-1", { providerId: "sec.recorded" }),
  );
  assert.equal(secFirst.lanes.find((lane) => lane.lane === "sec")?.status, "observed");
  assert.equal(secFirst.lanes.find((lane) => lane.lane === "transcript")?.status, "pending");
});

test("EX-99 aliases normalize without broadening the exhibit vocabulary", () => {
  assert.equal(normalizeExhibitAlias("EX-99"), "EX-99.1");
  assert.equal(normalizeExhibitAlias("EX-99.1"), "EX-99.1");
  assert.equal(normalizeExhibitAlias("EX-101"), null);
});

test("member admission binds issuer, accession, form, item, provider request, and normalization provenance", () => {
  const eventPlan = plan();
  const cluster = activeCluster(eventPlan);
  const accepted = member("sec", "sec-8-k", "0000769397-26-000059", "revision-1", {
    providerId: "sec.recorded",
    exhibitAlias: "EX-99",
  });
  assert.equal(recordEventClusterMember(cluster, eventPlan, accepted).members.length, 1);
  const rejects = (value: EventClusterMember, code: string) =>
    assert.throws(
      () => recordEventClusterMember(cluster, eventPlan, value),
      (error: unknown) => error instanceof EventClusterBetaError && error.code === code,
    );
  rejects(
    { ...accepted, issuerId: "issuer-other", cik: "0000000001" },
    "event-cluster.member-subject-invalid",
  );
  rejects(
    member("sec", "sec-8-k", "0001104659-26-000059", "revision-1", {
      providerId: "sec.recorded",
      exhibitAlias: "EX-99",
    }),
    "event-cluster.member-accession-invalid",
  );
  rejects({ ...accepted, form: "10-Q" }, "event-cluster.member-form-invalid");
  rejects({ ...accepted, items: ["1.01"] }, "event-cluster.member-item-invalid");
  rejects(
    { ...accepted, requestIdentity: { ...accepted.requestIdentity, providerId: "sec.other" } },
    "event-cluster.member-capability-invalid",
  );
  rejects(
    {
      ...accepted,
      normalization: { ...accepted.normalization, sourceArtifactDigest: artifact("other") },
    },
    "event-cluster.member-normalization-provenance-invalid",
  );
});

test("later periodic filings link to the cluster and revisions require explicit ancestry", () => {
  const eventPlan = plan();
  let cluster = activeCluster(eventPlan);
  const filing = member("sec", "sec-10-q", "0000769397-26-000060", "revision-1", {
    providerId: "sec.recorded",
    retrievedAtMs: 3_000,
  });
  cluster = recordEventClusterMember(cluster, eventPlan, filing);
  assert.equal(cluster.status, "follow-up");
  assert.equal(cluster.members[0]?.kind, "sec-10-q");

  const duplicate = recordEventClusterMember(cluster, eventPlan, filing);
  assert.equal(duplicate.members.length, 1);
  assert.equal(duplicate.duplicateCount, 1);

  assert.throws(
    () =>
      recordEventClusterMember(
        duplicate,
        eventPlan,
        member("sec", "sec-10-q", filing.recordId, "revision-2", { providerId: "sec.recorded" }),
      ),
    (error: unknown) =>
      error instanceof EventClusterBetaError && error.code === "event-cluster.revision-unlinked",
  );
  const amended = recordEventClusterMember(
    duplicate,
    eventPlan,
    member("sec", "sec-10-q", filing.recordId, "revision-2", {
      providerId: "sec.recorded",
      relationship: "amendment",
      replacesArtifactDigest: filing.artifactDigest,
      retrievedAtMs: 3_100,
    }),
  );
  assert.equal(amended.members.length, 2);
  assert.equal(amended.members[1]?.relationship, "amendment");
  const revisionTwo = amended.members.find((value) => value.revisionId === "revision-2");
  assert.ok(revisionTwo);
  assert.throws(
    () =>
      recordEventClusterMember(
        amended,
        eventPlan,
        member("sec", "sec-10-q", filing.recordId, "revision-3", {
          providerId: "sec.recorded",
          relationship: "correction",
          replacesArtifactDigest: filing.artifactDigest,
          retrievedAtMs: 3_200,
        }),
      ),
    (error: unknown) =>
      error instanceof EventClusterBetaError && error.code === "event-cluster.revision-unlinked",
  );
  const corrected = recordEventClusterMember(
    amended,
    eventPlan,
    member("sec", "sec-10-q", filing.recordId, "revision-3", {
      providerId: "sec.recorded",
      relationship: "correction",
      replacesArtifactDigest: revisionTwo.artifactDigest,
      retrievedAtMs: 3_200,
    }),
  );
  assert.equal(corrected.members.length, 3);
  const annual = recordEventClusterMember(
    corrected,
    eventPlan,
    member("sec", "sec-10-k", "0000769397-27-000010", "revision-1", {
      providerId: "sec.recorded",
      retrievedAtMs: 3_200,
    }),
  );
  assert.equal(
    annual.members.some((value) => value.kind === "sec-10-k"),
    true,
  );
});

test("settlement freezes explicit stable-missing lanes and final inventory", () => {
  const eventPlan = plan();
  let cluster = activeCluster(eventPlan);
  cluster = recordEventClusterMember(
    cluster,
    eventPlan,
    member("market", "market-bars", "adsk-spy-igv-window", "revision-1", {
      providerId: "market.synthetic",
    }),
  );
  cluster = transitionEventCluster(cluster, "settling", eventPlan.windows.settlementEndMs);
  const settled = settleEventCluster(cluster, eventPlan, eventPlan.windows.settlementEndMs);
  assert.equal(settled.status, "complete");
  assert.deepEqual(settled.inventory?.missingLanes, ["issuer-ir", "sec", "transcript"]);
  assert.equal(settled.inventory?.memberDigests.length, 1);
  assert.match(settled.inventory?.inventoryDigest ?? "", /^[0-9a-f]{64}$/u);
});

test("frozen plans retain immutable amendment history without mutating prior bytes", () => {
  const original = plan();
  const originalBytes = canonicalJson(original as unknown as JsonValue);
  const revised = amendEventPlan(original, {
    amendmentId: "calendar-correction-1",
    recordedAtMs: 500,
    reason: "calendar source corrected the expected session",
    changes: { expectedSession: "unknown" },
  });
  assert.equal(original.revision, 1);
  assert.equal(revised.revision, 2);
  assert.equal(revised.planId, original.planId);
  assert.notEqual(revised.revisionDigest, original.revisionDigest);
  assert.equal(revised.amendments[0]?.priorRevisionDigest, original.revisionDigest);
  assert.equal(canonicalJson(original as unknown as JsonValue), originalBytes);
  assert.equal(Object.isFrozen(revised.amendments), true);
});

test("cluster snapshots are byte-identical through memory and SQLite restart", async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "peas-event-cluster-beta-"));
  context.after(() =>
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  );
  const databasePath = path.join(root, "cluster.sqlite");
  const migrations = loadMigrations(path.join(process.cwd(), "migrations"));
  const memoryClock = new ManualClock(10_000);
  const sqliteClock = new ManualClock(10_000);
  const memory = new InMemoryEventLog({ clock: memoryClock });
  let database = openSqliteDatabase(databasePath, migrations);
  let sqlite = new SqliteEventLog(database, { clock: sqliteClock });

  const eventPlan = plan();
  let cluster = activeCluster(eventPlan);
  const snapshots: EventCluster[] = [cluster];
  cluster = recordEventClusterMember(
    cluster,
    eventPlan,
    member("issuer-ir", "issuer-release", "release-1", "revision-1", { providerId: "ir.recorded" }),
  );
  snapshots.push(cluster);
  for (const snapshot of snapshots) {
    const draft = eventClusterSnapshotDraft(snapshot);
    await memory.append(draft);
    await sqlite.append(draft);
  }
  const memoryPage = await memory.readAfter("0", 10);
  const sqlitePage = await sqlite.readAfter("0", 10);
  assert.equal(
    canonicalJson(memoryPage as unknown as JsonValue),
    canonicalJson(sqlitePage as unknown as JsonValue),
  );
  database.close();

  database = openSqliteDatabase(databasePath, migrations);
  sqlite = new SqliteEventLog(database, { clock: sqliteClock });
  const restartedPage = await sqlite.readAfter("0", 10);
  assert.equal(
    canonicalJson(restartedPage as unknown as JsonValue),
    canonicalJson(memoryPage as unknown as JsonValue),
  );
  assert.equal(latestEventClusterSnapshot(restartedPage.events).stateDigest, cluster.stateDigest);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  database.close();
});

test("the beta package exposes only zero prohibited effects", () => {
  assert.equal(Object.isFrozen(EVENT_CLUSTER_EFFECTS_ZERO), true);
  assert.deepEqual(EVENT_CLUSTER_EFFECTS_ZERO, {
    network: 0,
    provider: 0,
    credential: 0,
    account: 0,
    subscription: 0,
    spending: 0,
    broker: 0,
    order: 0,
    portfolio: 0,
    position: 0,
    fill: 0,
    financialEffect: 0,
  });
});
