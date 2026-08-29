import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  CalendarEventPreparationError,
  prepareCalendarEvent,
  type CalendarEventPreparationInput,
  type CalendarPreparationSourceId,
  type CalendarSourceBinding,
} from "../src/domain/calendar-event-preparation.js";
import {
  createEventCluster,
  EVENT_CLUSTER_EFFECTS_ZERO,
} from "../src/domain/event-cluster-beta.js";

const fixturePath = path.join(
  process.cwd(),
  "test",
  "fixtures",
  "calendar-event-preparation.synthetic.json",
);
const goldenPreparationPath = path.join(
  process.cwd(),
  "test",
  "fixtures",
  "calendar-event-preparation.golden.json.txt",
);
const goldenChecklistPath = path.join(
  process.cwd(),
  "examples",
  "calendar-event-preparation",
  "provider-readiness.md",
);

function fixture(): CalendarEventPreparationInput {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as CalendarEventPreparationInput;
}

function withBinding(
  input: CalendarEventPreparationInput,
  sourceId: CalendarPreparationSourceId,
  changes: Partial<CalendarSourceBinding>,
): CalendarEventPreparationInput {
  return {
    ...input,
    sourceBindings: input.sourceBindings.map((binding) =>
      binding.sourceId === sourceId ? { ...binding, ...changes } : binding,
    ),
  };
}

function withOfflineLane(
  input: CalendarEventPreparationInput,
  sourceIds: readonly CalendarPreparationSourceId[],
): CalendarEventPreparationInput {
  return {
    ...input,
    sourceBindings: input.sourceBindings.map((binding) =>
      sourceIds.includes(binding.sourceId)
        ? {
            ...binding,
            available: true,
            credentialRequirement: "none",
            entitlementRequirement: "none",
            liveAccessRequired: false,
          }
        : binding,
    ),
  };
}

test("synthetic preparation is deterministic, immutable, and digest-bound", () => {
  const first = prepareCalendarEvent(fixture());
  const second = prepareCalendarEvent(fixture());
  assert.equal(first.preparationJson, second.preparationJson);
  assert.equal(first.checklistMarkdown, second.checklistMarkdown);
  assert.equal(first.preparation.configurationDigest, second.preparation.configurationDigest);
  assert.equal(first.preparation.eventPlan.planId, second.preparation.eventPlan.planId);
  assert.equal(Object.isFrozen(first.preparation), true);
  assert.equal(Object.isFrozen(first.preparation.eventPlan), true);
  assert.equal(first.checklist.length, 12);
  assert.deepEqual(
    first.checklist.map((row) => row.sourceId),
    [
      "calendar-identity",
      "estimates-snapshot",
      "issuer-market-bars",
      "issuer-presentation",
      "issuer-release",
      "issuer-webcast",
      "prepared-remarks",
      "sec-filing-exhibit",
      "sec-submissions",
      "sector-market-bars",
      "spy-market-bars",
      "transcript",
    ],
  );
  assert.match(first.checklistMarkdown, /Calendar Event Provider Readiness/u);
  assert.match(first.checklistMarkdown, new RegExp(first.preparation.configurationDigest, "u"));
  const rebound = prepareCalendarEvent(
    withBinding(fixture(), "issuer-market-bars", {
      configuredIdentityOrPath: "instrument-example-common-rebound",
    }),
  );
  assert.notEqual(rebound.preparation.configurationDigest, first.preparation.configurationDigest);
  assert.equal(rebound.preparation.eventPlan.planId, first.preparation.eventPlan.planId);
});

test("before-market, after-market, and unknown sessions generate distinct ordered windows", () => {
  const after = prepareCalendarEvent(fixture()).preparation;
  const before = prepareCalendarEvent({
    ...fixture(),
    expectedSession: "before-market",
  }).preparation;
  const unknown = prepareCalendarEvent({ ...fixture(), expectedSession: "unknown" }).preparation;
  assert.notEqual(after.eventPlan.planId, before.eventPlan.planId);
  assert.notEqual(before.eventPlan.planId, unknown.eventPlan.planId);
  for (const preparation of [after, before, unknown]) {
    const windows = preparation.eventPlan.windows;
    assert.ok(windows.activationStartMs <= windows.primaryStartMs);
    assert.ok(windows.primaryStartMs < windows.primaryEndMs);
    assert.ok(windows.primaryEndMs <= windows.settlementEndMs);
  }
  assert.equal(after.eventPlan.candidate.expectedSession, "after-market");
  assert.equal(before.eventPlan.candidate.expectedSession, "before-market");
  assert.equal(unknown.eventPlan.candidate.expectedSession, "unknown");
});

test("conflicting calendar dates stop deterministic compilation", () => {
  const input = fixture();
  assert.throws(
    () =>
      prepareCalendarEvent({
        ...input,
        corroboratingCalendarCandidates: [
          {
            calendarSourceId: "calendar.synthetic-second",
            calendarRevisionId: "revision-2",
            expectedEventDate: "2026-10-30",
            expectedSession: input.expectedSession,
            discoveredAtMs: input.discoveredAtMs + 1,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof CalendarEventPreparationError &&
      error.code === "calendar-preparation.calendar-conflict",
  );
});

test("missing CIK or instrument mapping fails before plan creation", () => {
  for (const input of [
    { ...fixture(), cik: "" },
    { ...fixture(), instrumentId: "" },
  ]) {
    assert.throws(
      () => prepareCalendarEvent(input),
      (error: unknown) =>
        error instanceof CalendarEventPreparationError &&
        error.code === "calendar-preparation.input-invalid",
    );
  }
});

test("missing issuer IR configuration is explicit and lane-scoped", () => {
  let input = withBinding(fixture(), "issuer-release", { configuredIdentityOrPath: null });
  input = withOfflineLane(input, ["sec-submissions", "sec-filing-exhibit"]);
  const result = prepareCalendarEvent(input);
  const release = result.checklist.find((row) => row.sourceId === "issuer-release");
  assert.equal(release?.status, "missing");
  assert.equal(release?.blockerReason, "configured-identity-or-path-missing");
  assert.equal(
    result.preparation.eventPlan.acquisitionPlans.find((plan) => plan.lane === "sec")?.readiness,
    "ready",
  );
  assert.equal(
    result.preparation.eventPlan.acquisitionPlans.find((plan) => plan.lane === "issuer-ir")
      ?.readiness,
    "capability-unavailable",
  );
});

test("issuer release can be ready while transcript material remains missing", () => {
  let input = withOfflineLane(fixture(), [
    "issuer-release",
    "issuer-presentation",
    "issuer-webcast",
  ]);
  input = withBinding(input, "prepared-remarks", { configuredIdentityOrPath: null });
  input = withBinding(input, "transcript", { configuredIdentityOrPath: null });
  const result = prepareCalendarEvent(input);
  assert.equal(result.checklist.find((row) => row.sourceId === "issuer-release")?.status, "ready");
  assert.equal(result.checklist.find((row) => row.sourceId === "transcript")?.status, "missing");
  assert.equal(
    result.preparation.eventPlan.acquisitionPlans.find((plan) => plan.lane === "issuer-ir")
      ?.readiness,
    "ready",
  );
  assert.equal(
    result.preparation.eventPlan.acquisitionPlans.find((plan) => plan.lane === "transcript")
      ?.readiness,
    "capability-unavailable",
  );
});

test("selected optional transcript preserves its separate authorization gate", () => {
  const input = withBinding(fixture(), "transcript", {
    configuredIdentityOrPath: "issuer/example/transcript",
    available: true,
  });
  const result = prepareCalendarEvent(input);
  assert.equal(
    result.checklist.find((row) => row.sourceId === "transcript")?.status,
    "separately-authorized",
  );
  assert.equal(
    result.preparation.eventPlan.acquisitionPlans.find((plan) => plan.lane === "transcript")
      ?.readiness,
    "authorization-required",
  );
});

test("EX-99 aliases and later periodic follow-up policy are explicit", () => {
  const preparation = prepareCalendarEvent(fixture()).preparation;
  assert.deepEqual(preparation.eventPlan.exhibitAliases, ["EX-99", "EX-99.1"]);
  assert.deepEqual(preparation.activationAndObservation.followUpForms, [
    "10-Q",
    "10-Q/A",
    "10-K",
    "10-K/A",
  ]);
  assert.equal(
    preparation.activationAndObservation.followUpStartMs,
    preparation.eventPlan.windows.primaryEndMs,
  );
  assert.equal(
    preparation.activationAndObservation.followUpEndMs,
    preparation.eventPlan.windows.settlementEndMs,
  );
});

test("unavailable and authorization-required capabilities remain explicit", () => {
  let unavailable = withOfflineLane(fixture(), [
    "estimates-snapshot",
    "issuer-market-bars",
    "spy-market-bars",
    "sector-market-bars",
  ]);
  unavailable = withBinding(unavailable, "issuer-market-bars", { available: false });
  const blocked = prepareCalendarEvent(unavailable);
  assert.equal(
    blocked.checklist.find((row) => row.sourceId === "issuer-market-bars")?.status,
    "blocked",
  );
  assert.equal(
    blocked.preparation.eventPlan.acquisitionPlans.find((plan) => plan.lane === "market")
      ?.readiness,
    "capability-unavailable",
  );

  const authorization = prepareCalendarEvent(fixture());
  assert.equal(
    authorization.checklist.find((row) => row.sourceId === "sec-submissions")?.status,
    "separately-authorized",
  );
  assert.equal(
    authorization.checklist.find((row) => row.sourceId === "sec-submissions")?.blockerReason,
    "live-access-authorization-required",
  );
  const estimates = authorization.checklist.find((row) => row.sourceId === "estimates-snapshot");
  assert.equal(estimates?.credentialsRequired, true);
  assert.equal(estimates?.entitlementRequired, true);
  assert.equal(estimates?.blockerReason, "credential-and-entitlement-authorization-required");
});

test("an unavailable optional estimates provider does not make the Alpaca market lane ambiguous", () => {
  let input = fixture();
  for (const sourceId of ["issuer-market-bars", "spy-market-bars", "sector-market-bars"] as const) {
    input = withBinding(input, sourceId, {
      providerId: "alpaca.historical-sip",
      available: true,
      credentialRequirement: "separately-authorized",
      entitlementRequirement: "separately-authorized",
      liveAccessRequired: true,
    });
  }
  input = withBinding(input, "estimates-snapshot", {
    providerId: "fmp.estimates-unaccepted",
    configuredIdentityOrPath: null,
    available: false,
  });

  const result = prepareCalendarEvent(input);
  const marketPlan = result.preparation.eventPlan.acquisitionPlans.find(
    (plan) => plan.lane === "market",
  );
  assert.equal(marketPlan?.providerId, "alpaca.historical-sip");
  assert.equal(marketPlan?.readiness, "authorization-required");
  assert.equal(
    result.checklist.find((row) => row.sourceId === "estimates-snapshot")?.status,
    "missing",
  );
  assert.equal(
    result.preparation.permittedProviderCapabilities.some(
      (entry) =>
        entry.sourceId === "estimates-snapshot" && entry.providerId === "fmp.estimates-unaccepted",
    ),
    true,
  );
});

test("shared capability preserves per-source partial mapping and blocks its lane", () => {
  let input = withOfflineLane(fixture(), [
    "estimates-snapshot",
    "issuer-market-bars",
    "spy-market-bars",
    "sector-market-bars",
  ]);
  input = withBinding(input, "sector-market-bars", { configuredIdentityOrPath: null });
  const result = prepareCalendarEvent(input);
  assert.equal(result.checklist.find((row) => row.sourceId === "spy-market-bars")?.status, "ready");
  assert.equal(
    result.checklist.find((row) => row.sourceId === "sector-market-bars")?.status,
    "missing",
  );
  assert.equal(
    result.preparation.eventPlan.acquisitionPlans.find((plan) => plan.lane === "market")?.readiness,
    "capability-unavailable",
  );
});

test("before-freeze amendments change the initial identity without mutating history", () => {
  const baseline = prepareCalendarEvent(fixture()).preparation;
  const amended = prepareCalendarEvent({
    ...fixture(),
    amendments: [
      {
        amendmentId: "calendar-correction-1",
        phase: "before-freeze",
        recordedAtMs: 1780000001000,
        reason: "synthetic calendar correction",
        changes: { expectedEventDate: "2026-10-30", expectedSession: "before-market" },
      },
    ],
  }).preparation;
  assert.equal(amended.eventPlan.revision, 1);
  assert.equal(amended.eventPlan.amendments.length, 0);
  assert.equal(amended.preparationHistory.beforeFreezeAmendments.length, 1);
  assert.notEqual(amended.eventPlan.planId, baseline.eventPlan.planId);
  assert.equal(amended.eventPlan.candidate.expectedEventDate, "2026-10-30");
});

test("after-freeze amendments create a new revision with explicit ancestry", () => {
  const baseline = prepareCalendarEvent(fixture()).preparation;
  const amended = prepareCalendarEvent({
    ...fixture(),
    amendments: [
      {
        amendmentId: "post-freeze-correction-1",
        phase: "after-freeze",
        recordedAtMs: 1780000002000,
        reason: "synthetic post-freeze correction",
        changes: { expectedEventDate: "2026-10-30" },
      },
    ],
  }).preparation;
  assert.equal(amended.eventPlan.revision, 2);
  assert.equal(amended.eventPlan.amendments.length, 1);
  assert.equal(
    amended.eventPlan.amendments[0]?.priorRevisionDigest,
    baseline.eventPlan.revisionDigest,
  );
  assert.notEqual(amended.eventPlan.revisionDigest, baseline.eventPlan.revisionDigest);
});

test("unavailable acquisition settles as stable missing at cluster creation", () => {
  let input = withBinding(fixture(), "issuer-release", { configuredIdentityOrPath: null });
  input = withOfflineLane(input, ["sec-submissions", "sec-filing-exhibit"]);
  const preparation = prepareCalendarEvent(input).preparation;
  const cluster = createEventCluster(
    preparation.eventPlan,
    preparation.eventPlan.windows.activationStartMs,
  );
  const issuerLane = cluster.lanes.find((lane) => lane.lane === "issuer-ir");
  assert.equal(issuerLane?.status, "stable-missing");
  assert.equal(issuerLane?.stableMissingReason, "capability-unavailable:issuer-release");
});

test("issuer, SPY, and sector market windows are deterministic coarse evidence", () => {
  const preparation = prepareCalendarEvent(fixture()).preparation;
  assert.deepEqual(preparation.marketEvidence.subjects, ["EXMPL", "SPY", "XLK"]);
  assert.equal(preparation.marketEvidence.windows.length, 7);
  assert.equal(
    preparation.marketEvidence.windows.every(
      (window) =>
        window.granularity === "one-minute-bars" &&
        window.evidenceClass === "coarse-movement-not-tradability",
    ),
    true,
  );
  assert.equal(preparation.marketEvidence.interpretation, "coarse-bar-movement-not-tradability");
});

test("CLI output matches committed golden bytes across host timezone settings", () => {
  const root = mkdtempSync(path.join(tmpdir(), "peas-calendar-preparation-"));
  try {
    const script = path.join(process.cwd(), "scripts", "prepare-calendar-event.mjs");
    const expectedPreparation = readFileSync(goldenPreparationPath, "utf8");
    const expectedChecklist = readFileSync(goldenChecklistPath, "utf8");
    const utc = path.join(root, "utc");
    const tokyo = path.join(root, "tokyo");
    for (const [timezone, output] of [
      ["UTC", utc],
      ["Asia/Tokyo", tokyo],
    ] as const) {
      const run = spawnSync(
        process.execPath,
        [script, `--input=${fixturePath}`, `--output=${output}`],
        { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, TZ: timezone } },
      );
      assert.equal(run.status, 0, run.stderr);
    }
    for (const output of [utc, tokyo]) {
      assert.equal(
        readFileSync(path.join(output, "event-preparation.json"), "utf8"),
        expectedPreparation,
      );
      assert.equal(
        readFileSync(path.join(output, "provider-readiness.md"), "utf8"),
        expectedChecklist,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preparation has zero network surface and zero prohibited effects", () => {
  const result = prepareCalendarEvent(fixture());
  assert.deepEqual({ ...result.preparation.prohibitedEffects }, EVENT_CLUSTER_EFFECTS_ZERO);
  assert.equal(
    Object.values(result.preparation.prohibitedEffects).every((value) => value === 0),
    true,
  );
  for (const relative of [
    path.join("src", "domain", "calendar-event-preparation.ts"),
    path.join("scripts", "prepare-calendar-event.mjs"),
  ]) {
    const source = readFileSync(path.join(process.cwd(), relative), "utf8");
    assert.doesNotMatch(source, /node:(?:http|https|net)|\bfetch\s*\(|\brequest\s*\(/u);
  }
});
