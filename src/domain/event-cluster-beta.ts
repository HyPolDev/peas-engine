import { z } from "zod";

import type { EventDraft, StoredEvent } from "../core/event.js";
import { canonicalHash } from "../core/hash.js";
import { canonicalJson, inertJsonSnapshot, type JsonObject, type JsonValue } from "../core/json.js";

export const EVENT_CLUSTER_EFFECTS_ZERO = Object.freeze({
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

export const EVENT_CLUSTER_LANES = Object.freeze([
  "sec",
  "issuer-ir",
  "transcript",
  "market",
] as const);
export type EventClusterLane = (typeof EVENT_CLUSTER_LANES)[number];

export const PROVIDER_CAPABILITIES = Object.freeze([
  "calendar-discovery",
  "issuer-release",
  "sec-filing",
  "filing-exhibit",
  "issuer-slides",
  "webcast-metadata",
  "prepared-remarks",
  "transcript",
  "expectations-snapshot",
  "market-bars",
  "market-quotes-trades",
  "benchmark-market-data",
] as const);
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export type ProviderCapabilityEntry = Readonly<{
  providerId: string;
  capability: ProviderCapability;
  available: boolean;
  credentialRequirement: "none" | "separately-authorized";
}>;

export type CalendarCandidate = Readonly<{
  calendarSourceId: string;
  calendarRevisionId: string;
  issuerId: string;
  cik: string;
  ticker: string;
  exchange: string;
  instrumentId: string;
  sectorBenchmark: string;
  fiscalPeriod: string;
  expectedEventDate: string;
  expectedSession: "before-market" | "after-market" | "unknown";
  discoveredAtMs: number;
}>;

export type PlanWindows = Readonly<{
  activationStartMs: number;
  primaryStartMs: number;
  primaryEndMs: number;
  settlementEndMs: number;
}>;

export type SourceAssignment = Readonly<{
  lane: EventClusterLane;
  providerId: string;
  capabilities: readonly ProviderCapability[];
}>;

export type EventPlanSpec = Readonly<{
  windows: PlanWindows;
  sourceAssignments: readonly SourceAssignment[];
  expectedForms: readonly string[];
  expectedItems: readonly string[];
  exhibitAliases: readonly string[];
  rawRetention: "immutable";
  duplicatePolicy: "provider-record-revision";
  correctionPolicy: "explicit-replacement";
  stableMissingPolicy: "lane-settlement";
  prohibitedEffects: typeof EVENT_CLUSTER_EFFECTS_ZERO;
}>;

export type AcquisitionPlan = Readonly<{
  lane: EventClusterLane;
  providerId: string;
  capabilities: readonly ProviderCapability[];
  readiness: "ready" | "capability-unavailable" | "authorization-required";
  blocker: string | null;
}>;

export type EventPlanAmendment = Readonly<{
  amendmentId: string;
  recordedAtMs: number;
  reason: string;
  priorRevisionDigest: string;
  changeDigest: string;
  changes: Readonly<{
    expectedEventDate?: string;
    expectedSession?: CalendarCandidate["expectedSession"];
    windows?: PlanWindows;
  }>;
}>;

export type MarketWindowDefinition = Readonly<{
  id: "pre-event" | "release-gap" | "plus-1" | "plus-5" | "plus-30" | "close" | "next-session";
  granularity: "one-minute-bars";
  evidenceClass: "coarse-movement-not-tradability";
  anchor: "event-relative" | "session-close" | "next-session";
  startMinuteOffset: number | null;
  endMinuteOffset: number | null;
}>;

export type EventPlan = Readonly<{
  schemaVersion: 1;
  planId: string;
  revision: number;
  revisionDigest: string;
  frozen: true;
  candidate: CalendarCandidate;
  windows: PlanWindows;
  acquisitionPlans: readonly AcquisitionPlan[];
  expectedForms: readonly string[];
  expectedItems: readonly string[];
  exhibitAliases: readonly ("EX-99" | "EX-99.1")[];
  marketSubjects: readonly [string, "SPY", string];
  marketWindows: readonly MarketWindowDefinition[];
  rawRetention: "immutable";
  duplicatePolicy: "provider-record-revision";
  correctionPolicy: "explicit-replacement";
  stableMissingPolicy: "lane-settlement";
  prohibitedEffects: typeof EVENT_CLUSTER_EFFECTS_ZERO;
  amendments: readonly EventPlanAmendment[];
}>;

export type EventClusterMemberKind =
  | "issuer-release"
  | "sec-8-k"
  | "sec-10-q"
  | "sec-10-k"
  | "transcript"
  | "market-bars";

export type EventClusterMember = Readonly<{
  lane: EventClusterLane;
  kind: EventClusterMemberKind;
  providerId: string;
  recordId: string;
  revisionId: string;
  artifactDigest: string;
  publicationOrAcceptanceAtMs: number | null;
  firstObservedAtMs: number;
  retrievedAtMs: number;
  relationship: "original" | "correction" | "amendment";
  replacesArtifactDigest: string | null;
}>;

export type LaneState = Readonly<{
  lane: EventClusterLane;
  status: "pending" | "observed" | "stable-missing" | "stopped";
  memberCount: number;
  stableMissingReason: string | null;
}>;

export type ClusterInventory = Readonly<{
  memberDigests: readonly string[];
  missingLanes: readonly EventClusterLane[];
  duplicateCount: number;
  inventoryDigest: string;
}>;

export type EventCluster = Readonly<{
  schemaVersion: 1;
  clusterId: string;
  planId: string;
  planRevisionDigest: string;
  revision: number;
  status:
    | "candidate"
    | "prewarming"
    | "frozen"
    | "active"
    | "primary-observed"
    | "follow-up"
    | "settling"
    | "complete"
    | "stopped";
  lanes: readonly LaneState[];
  members: readonly EventClusterMember[];
  duplicateCount: number;
  inventory: ClusterInventory | null;
  stoppedReason: string | null;
  updatedAtMs: number;
  stateDigest: string;
}>;

export class EventClusterBetaError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EventClusterBetaError";
  }
}

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const epoch = z.number().int().nonnegative().safe();
const candidateSchema = z
  .object({
    calendarSourceId: identifier,
    calendarRevisionId: identifier,
    issuerId: identifier,
    cik: z.string().regex(/^\d{10}$/u),
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,15}$/u),
    exchange: identifier,
    instrumentId: identifier,
    sectorBenchmark: z.string().regex(/^[A-Z][A-Z0-9.-]{0,15}$/u),
    fiscalPeriod: z.string().regex(/^\d{4}-(?:Q[1-4]|FY)$/u),
    expectedEventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    expectedSession: z.enum(["before-market", "after-market", "unknown"]),
    discoveredAtMs: epoch,
  })
  .strict();
const windowsSchema = z
  .object({
    activationStartMs: epoch,
    primaryStartMs: epoch,
    primaryEndMs: epoch,
    settlementEndMs: epoch,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.activationStartMs > value.primaryStartMs ||
      value.primaryStartMs >= value.primaryEndMs ||
      value.primaryEndMs > value.settlementEndMs
    ) {
      context.addIssue({ code: "custom", message: "EventPlan windows are not ordered" });
    }
  });
const capabilitySchema = z.enum(PROVIDER_CAPABILITIES);
const laneSchema = z.enum(EVENT_CLUSTER_LANES);
const capabilityEntrySchema = z
  .object({
    providerId: identifier,
    capability: capabilitySchema,
    available: z.boolean(),
    credentialRequirement: z.enum(["none", "separately-authorized"]),
  })
  .strict();
const assignmentSchema = z
  .object({
    lane: laneSchema,
    providerId: identifier,
    capabilities: z.array(capabilitySchema).min(1).max(8),
  })
  .strict();
const effectsSchema = z
  .object({
    network: z.literal(0),
    provider: z.literal(0),
    credential: z.literal(0),
    account: z.literal(0),
    subscription: z.literal(0),
    spending: z.literal(0),
    broker: z.literal(0),
    order: z.literal(0),
    portfolio: z.literal(0),
    position: z.literal(0),
    fill: z.literal(0),
    financialEffect: z.literal(0),
  })
  .strict();
const specSchema = z
  .object({
    windows: windowsSchema,
    sourceAssignments: z.array(assignmentSchema).length(EVENT_CLUSTER_LANES.length),
    expectedForms: z.array(z.string().min(1).max(16)).min(1).max(8),
    expectedItems: z
      .array(z.string().regex(/^\d+\.\d+$/u))
      .min(1)
      .max(16),
    exhibitAliases: z
      .array(z.enum(["EX-99", "EX-99.1"]))
      .min(1)
      .max(2),
    rawRetention: z.literal("immutable"),
    duplicatePolicy: z.literal("provider-record-revision"),
    correctionPolicy: z.literal("explicit-replacement"),
    stableMissingPolicy: z.literal("lane-settlement"),
    prohibitedEffects: effectsSchema,
  })
  .strict();
const memberSchema = z
  .object({
    lane: laneSchema,
    kind: z.enum([
      "issuer-release",
      "sec-8-k",
      "sec-10-q",
      "sec-10-k",
      "transcript",
      "market-bars",
    ]),
    providerId: identifier,
    recordId: identifier,
    revisionId: identifier,
    artifactDigest: digest,
    publicationOrAcceptanceAtMs: epoch.nullable(),
    firstObservedAtMs: epoch,
    retrievedAtMs: epoch,
    relationship: z.enum(["original", "correction", "amendment"]),
    replacesArtifactDigest: digest.nullable(),
  })
  .strict();

const MARKET_WINDOWS: readonly MarketWindowDefinition[] = Object.freeze([
  Object.freeze({
    id: "pre-event",
    granularity: "one-minute-bars",
    evidenceClass: "coarse-movement-not-tradability",
    anchor: "event-relative",
    startMinuteOffset: -30,
    endMinuteOffset: -1,
  }),
  ...([0, 1, 5, 30] as const).map((offset) =>
    Object.freeze({
      id: offset === 0 ? "release-gap" : (`plus-${offset}` as "plus-1" | "plus-5" | "plus-30"),
      granularity: "one-minute-bars" as const,
      evidenceClass: "coarse-movement-not-tradability" as const,
      anchor: "event-relative" as const,
      startMinuteOffset: offset,
      endMinuteOffset: offset,
    }),
  ),
  Object.freeze({
    id: "close",
    granularity: "one-minute-bars",
    evidenceClass: "coarse-movement-not-tradability",
    anchor: "session-close",
    startMinuteOffset: null,
    endMinuteOffset: null,
  }),
  Object.freeze({
    id: "next-session",
    granularity: "one-minute-bars",
    evidenceClass: "coarse-movement-not-tradability",
    anchor: "next-session",
    startMinuteOffset: null,
    endMinuteOffset: null,
  }),
]);

function fail(code: string): never {
  throw new EventClusterBetaError(code);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

function frozenJson<T>(value: T): Readonly<T> {
  return deepFreeze(inertJsonSnapshot(value as unknown as JsonValue) as unknown as T);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function planRevisionPreimage(plan: Omit<EventPlan, "revisionDigest">): JsonObject {
  return inertJsonSnapshot(plan as unknown as JsonValue) as JsonObject;
}

function omitPlanRevisionDigest(plan: EventPlan): Omit<EventPlan, "revisionDigest"> {
  const copy = { ...plan } as Omit<EventPlan, "revisionDigest"> & { revisionDigest?: string };
  delete copy.revisionDigest;
  return copy;
}

function acquisitionPlans(
  assignments: readonly SourceAssignment[],
  registry: readonly ProviderCapabilityEntry[],
): AcquisitionPlan[] {
  const lanes = new Set<EventClusterLane>();
  const plans = assignments.map((assignment) => {
    if (lanes.has(assignment.lane)) fail("event-plan.duplicate-lane");
    lanes.add(assignment.lane);
    const capabilities = sortedUnique(assignment.capabilities) as ProviderCapability[];
    let readiness: AcquisitionPlan["readiness"] = "ready";
    let blocker: string | null = null;
    for (const capability of capabilities) {
      const entry = registry.find(
        (candidate) =>
          candidate.providerId === assignment.providerId && candidate.capability === capability,
      );
      if (entry === undefined || !entry.available) {
        readiness = "capability-unavailable";
        blocker = `capability-unavailable:${capability}`;
        break;
      }
      if (entry.credentialRequirement === "separately-authorized") {
        readiness = "authorization-required";
        blocker = `authorization-required:${capability}`;
        break;
      }
    }
    return {
      lane: assignment.lane,
      providerId: assignment.providerId,
      capabilities,
      readiness,
      blocker,
    };
  });
  if (lanes.size !== EVENT_CLUSTER_LANES.length) fail("event-plan.lane-set-incomplete");
  return plans.sort((left, right) => left.lane.localeCompare(right.lane));
}

export function normalizeExhibitAlias(value: string): "EX-99.1" | null {
  return value === "EX-99" || value === "EX-99.1" ? "EX-99.1" : null;
}

export function compileEventPlan(
  candidateInput: CalendarCandidate,
  specInput: EventPlanSpec,
  registryInput: readonly ProviderCapabilityEntry[],
): EventPlan {
  const candidate = candidateSchema.parse(
    inertJsonSnapshot(candidateInput as unknown as JsonValue),
  );
  const spec = specSchema.parse(inertJsonSnapshot(specInput as unknown as JsonValue));
  const registry = z
    .array(capabilityEntrySchema)
    .max(64)
    .parse(inertJsonSnapshot(registryInput as unknown as JsonValue));
  const plans = acquisitionPlans(spec.sourceAssignments, registry);
  const expectedForms = sortedUnique(spec.expectedForms);
  const expectedItems = sortedUnique(spec.expectedItems);
  const exhibitAliases = sortedUnique(spec.exhibitAliases) as ("EX-99" | "EX-99.1")[];
  const marketSubjects = [candidate.ticker, "SPY", candidate.sectorBenchmark] as const;
  const identityPreimage = inertJsonSnapshot({
    candidate,
    windows: spec.windows,
    acquisitionPlans: plans,
    expectedForms,
    expectedItems,
    exhibitAliases,
    marketSubjects,
    marketWindows: MARKET_WINDOWS,
    rawRetention: spec.rawRetention,
    duplicatePolicy: spec.duplicatePolicy,
    correctionPolicy: spec.correctionPolicy,
    stableMissingPolicy: spec.stableMissingPolicy,
    prohibitedEffects: spec.prohibitedEffects,
  } as unknown as JsonValue);
  const planId = canonicalHash("peas/event-plan/v1", identityPreimage);
  const withoutDigest: Omit<EventPlan, "revisionDigest"> = {
    schemaVersion: 1,
    planId,
    revision: 1,
    frozen: true,
    candidate,
    windows: spec.windows,
    acquisitionPlans: plans,
    expectedForms,
    expectedItems,
    exhibitAliases,
    marketSubjects,
    marketWindows: MARKET_WINDOWS,
    rawRetention: spec.rawRetention,
    duplicatePolicy: spec.duplicatePolicy,
    correctionPolicy: spec.correctionPolicy,
    stableMissingPolicy: spec.stableMissingPolicy,
    prohibitedEffects: spec.prohibitedEffects,
    amendments: [],
  };
  const plan: EventPlan = {
    ...withoutDigest,
    revisionDigest: canonicalHash(
      "peas/event-plan-revision/v1",
      planRevisionPreimage(withoutDigest),
    ),
  };
  return frozenJson(plan) as EventPlan;
}

export function compileCalendarCandidates(
  candidatesInput: readonly CalendarCandidate[],
  spec: EventPlanSpec,
  registry: readonly ProviderCapabilityEntry[],
): readonly EventPlan[] {
  const candidates = z
    .array(candidateSchema)
    .min(1)
    .max(32)
    .parse(inertJsonSnapshot(candidatesInput as unknown as JsonValue));
  const byEvent = new Map<string, CalendarCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.issuerId}:${candidate.fiscalPeriod}`;
    const values = byEvent.get(key) ?? [];
    values.push(candidate);
    byEvent.set(key, values);
  }
  const plans: EventPlan[] = [];
  for (const values of byEvent.values()) {
    const dates = new Set(values.map((value) => value.expectedEventDate));
    const sessions = new Set(values.map((value) => value.expectedSession));
    if (dates.size !== 1 || sessions.size !== 1) fail("event-plan.calendar-conflict");
    values.sort((left, right) =>
      `${left.calendarSourceId}:${left.calendarRevisionId}`.localeCompare(
        `${right.calendarSourceId}:${right.calendarRevisionId}`,
      ),
    );
    const selected = values[0];
    if (selected === undefined) fail("event-plan.calendar-empty");
    plans.push(compileEventPlan(selected, spec, registry));
  }
  return Object.freeze(plans.sort((left, right) => left.planId.localeCompare(right.planId)));
}

export function amendEventPlan(
  plan: EventPlan,
  input: Readonly<{
    amendmentId: string;
    recordedAtMs: number;
    reason: string;
    changes: EventPlanAmendment["changes"];
  }>,
): EventPlan {
  identifier.parse(input.amendmentId);
  epoch.parse(input.recordedAtMs);
  z.string().min(1).max(512).parse(input.reason);
  if (plan.amendments.some((amendment) => amendment.amendmentId === input.amendmentId)) {
    fail("event-plan.amendment-duplicate");
  }
  const changes = inertJsonSnapshot(
    input.changes as unknown as JsonValue,
  ) as unknown as EventPlanAmendment["changes"];
  if (Object.keys(changes).length === 0) fail("event-plan.amendment-empty");
  const windows =
    changes.windows === undefined ? plan.windows : windowsSchema.parse(changes.windows);
  const candidate = candidateSchema.parse({
    ...plan.candidate,
    ...(changes.expectedEventDate === undefined
      ? {}
      : { expectedEventDate: changes.expectedEventDate }),
    ...(changes.expectedSession === undefined ? {} : { expectedSession: changes.expectedSession }),
  });
  const amendment: EventPlanAmendment = {
    amendmentId: input.amendmentId,
    recordedAtMs: input.recordedAtMs,
    reason: input.reason,
    priorRevisionDigest: plan.revisionDigest,
    changeDigest: canonicalHash("peas/event-plan-amendment/v1", changes as unknown as JsonValue),
    changes,
  };
  const withoutDigest: Omit<EventPlan, "revisionDigest"> = {
    ...omitPlanRevisionDigest(plan),
    revision: plan.revision + 1,
    candidate,
    windows,
    amendments: [...plan.amendments, amendment],
  };
  const next: EventPlan = {
    ...withoutDigest,
    revisionDigest: canonicalHash(
      "peas/event-plan-revision/v1",
      planRevisionPreimage(withoutDigest),
    ),
  };
  return frozenJson(next) as EventPlan;
}

function lanesForPlan(plan: EventPlan): LaneState[] {
  return EVENT_CLUSTER_LANES.map((lane) => {
    const acquisition = plan.acquisitionPlans.find((candidate) => candidate.lane === lane);
    if (acquisition === undefined) fail("event-cluster.plan-lane-missing");
    return {
      lane,
      status: acquisition.readiness === "ready" ? "pending" : "stable-missing",
      memberCount: 0,
      stableMissingReason: acquisition.blocker,
    } as LaneState;
  });
}

function withDigest(input: Omit<EventCluster, "stateDigest">): EventCluster {
  const withoutPriorDigest = {
    ...(input as Omit<EventCluster, "stateDigest"> & { stateDigest?: string }),
  };
  delete withoutPriorDigest.stateDigest;
  const stateDigest = canonicalHash(
    "peas/event-cluster-state/v1",
    inertJsonSnapshot(withoutPriorDigest as unknown as JsonValue),
  );
  return frozenJson({ ...withoutPriorDigest, stateDigest }) as EventCluster;
}

export function createEventCluster(plan: EventPlan, atMs: number): EventCluster {
  epoch.parse(atMs);
  const clusterId = canonicalHash(
    "peas/event-cluster/v1",
    inertJsonSnapshot({
      planId: plan.planId,
      issuerId: plan.candidate.issuerId,
      fiscalPeriod: plan.candidate.fiscalPeriod,
    } as JsonValue),
  );
  return withDigest({
    schemaVersion: 1,
    clusterId,
    planId: plan.planId,
    planRevisionDigest: plan.revisionDigest,
    revision: 1,
    status: "candidate",
    lanes: lanesForPlan(plan),
    members: [],
    duplicateCount: 0,
    inventory: null,
    stoppedReason: null,
    updatedAtMs: atMs,
  });
}

const transitions: Readonly<Record<EventCluster["status"], readonly EventCluster["status"][]>> = {
  candidate: ["prewarming", "stopped"],
  prewarming: ["frozen", "stopped"],
  frozen: ["active", "stopped"],
  active: ["primary-observed", "follow-up", "settling", "stopped"],
  "primary-observed": ["follow-up", "settling", "stopped"],
  "follow-up": ["settling", "stopped"],
  settling: ["complete", "stopped"],
  complete: [],
  stopped: [],
};

export function transitionEventCluster(
  cluster: EventCluster,
  status: EventCluster["status"],
  atMs: number,
): EventCluster {
  epoch.parse(atMs);
  if (!transitions[cluster.status].includes(status)) fail("event-cluster.transition-invalid");
  return withDigest({
    ...cluster,
    revision: cluster.revision + 1,
    status,
    updatedAtMs: atMs,
  });
}

function expectedLane(kind: EventClusterMemberKind): EventClusterLane {
  if (kind === "issuer-release") return "issuer-ir";
  if (kind === "transcript") return "transcript";
  if (kind === "market-bars") return "market";
  return "sec";
}

function memberOrder(left: EventClusterMember, right: EventClusterMember): number {
  return `${left.lane}:${left.providerId}:${left.recordId}:${left.revisionId}`.localeCompare(
    `${right.lane}:${right.providerId}:${right.recordId}:${right.revisionId}`,
  );
}

export function recordEventClusterMember(
  cluster: EventCluster,
  memberInput: EventClusterMember,
): EventCluster {
  if (!["active", "primary-observed", "follow-up"].includes(cluster.status)) {
    fail("event-cluster.not-observing");
  }
  const member = memberSchema.parse(inertJsonSnapshot(memberInput as unknown as JsonValue));
  if (member.lane !== expectedLane(member.kind)) fail("event-cluster.member-lane-invalid");
  if (member.firstObservedAtMs > member.retrievedAtMs) fail("event-cluster.member-time-invalid");
  if (
    member.publicationOrAcceptanceAtMs !== null &&
    member.publicationOrAcceptanceAtMs > member.firstObservedAtMs
  ) {
    fail("event-cluster.member-time-invalid");
  }
  const exact = cluster.members.find(
    (candidate) =>
      candidate.providerId === member.providerId &&
      candidate.recordId === member.recordId &&
      candidate.revisionId === member.revisionId,
  );
  if (exact !== undefined) {
    if (
      canonicalJson(exact as unknown as JsonValue) !== canonicalJson(member as unknown as JsonValue)
    ) {
      fail("event-cluster.redelivery-conflict");
    }
    return withDigest({
      ...cluster,
      revision: cluster.revision + 1,
      duplicateCount: cluster.duplicateCount + 1,
      updatedAtMs: member.retrievedAtMs,
    });
  }
  const priorRecord = cluster.members.find(
    (candidate) =>
      candidate.providerId === member.providerId && candidate.recordId === member.recordId,
  );
  if (priorRecord !== undefined) {
    if (
      member.relationship === "original" ||
      member.replacesArtifactDigest !== priorRecord.artifactDigest
    ) {
      fail("event-cluster.revision-unlinked");
    }
  } else if (member.relationship !== "original" || member.replacesArtifactDigest !== null) {
    fail("event-cluster.revision-target-missing");
  }
  const members = [...cluster.members, member].sort(memberOrder);
  const lanes = cluster.lanes.map((lane) =>
    lane.lane === member.lane
      ? {
          ...lane,
          status: "observed" as const,
          memberCount: members.filter((candidate) => candidate.lane === member.lane).length,
          stableMissingReason: null,
        }
      : lane,
  );
  const primary = member.kind === "issuer-release" || member.kind === "sec-8-k";
  const followUp =
    member.kind === "sec-10-q" || member.kind === "sec-10-k" || member.kind === "transcript";
  const status = followUp
    ? "follow-up"
    : primary && cluster.status === "active"
      ? "primary-observed"
      : cluster.status;
  return withDigest({
    ...cluster,
    revision: cluster.revision + 1,
    status,
    lanes,
    members,
    updatedAtMs: member.retrievedAtMs,
  });
}

export function recordStableMissing(
  cluster: EventCluster,
  lane: EventClusterLane,
  reason: string,
  atMs: number,
): EventCluster {
  epoch.parse(atMs);
  z.string().min(1).max(256).parse(reason);
  if (!["active", "primary-observed", "follow-up", "settling"].includes(cluster.status)) {
    fail("event-cluster.not-settleable");
  }
  const lanes = cluster.lanes.map((state) =>
    state.lane === lane && state.status === "pending"
      ? { ...state, status: "stable-missing" as const, stableMissingReason: reason }
      : state,
  );
  return withDigest({
    ...cluster,
    revision: cluster.revision + 1,
    lanes,
    updatedAtMs: atMs,
  });
}

export function settleEventCluster(
  cluster: EventCluster,
  plan: EventPlan,
  atMs: number,
): EventCluster {
  epoch.parse(atMs);
  if (cluster.planId !== plan.planId || cluster.planRevisionDigest !== plan.revisionDigest) {
    fail("event-cluster.plan-identity-drift");
  }
  if (atMs < plan.windows.settlementEndMs) fail("event-cluster.settlement-too-early");
  if (cluster.status !== "settling") {
    fail("event-cluster.not-settleable");
  }
  const lanes = cluster.lanes.map((lane) =>
    lane.status === "pending"
      ? {
          ...lane,
          status: "stable-missing" as const,
          stableMissingReason: "not-observed-before-settlement",
        }
      : lane,
  );
  const memberDigests = sortedUnique(cluster.members.map((member) => member.artifactDigest));
  const missingLanes = lanes
    .filter((lane) => lane.status === "stable-missing")
    .map((lane) => lane.lane)
    .sort();
  const inventoryWithoutDigest = {
    memberDigests,
    missingLanes,
    duplicateCount: cluster.duplicateCount,
  };
  const inventory: ClusterInventory = {
    ...inventoryWithoutDigest,
    inventoryDigest: canonicalHash(
      "peas/event-cluster-inventory/v1",
      inertJsonSnapshot(inventoryWithoutDigest as unknown as JsonValue),
    ),
  };
  return withDigest({
    ...cluster,
    revision: cluster.revision + 1,
    status: "complete",
    lanes,
    inventory,
    updatedAtMs: atMs,
  });
}

export function stopEventCluster(
  cluster: EventCluster,
  reason: string,
  atMs: number,
): EventCluster {
  z.string().min(1).max(256).parse(reason);
  epoch.parse(atMs);
  if (cluster.status === "complete" || cluster.status === "stopped") {
    fail("event-cluster.already-terminal");
  }
  return withDigest({
    ...cluster,
    revision: cluster.revision + 1,
    status: "stopped",
    stoppedReason: reason,
    updatedAtMs: atMs,
  });
}

export function eventClusterSnapshotDraft(cluster: EventCluster): EventDraft {
  const payload = inertJsonSnapshot({ cluster } as unknown as JsonValue) as JsonObject;
  return {
    envelopeVersion: 2,
    type: "event-cluster.snapshot",
    schemaVersion: 1,
    source: "event-cluster-beta:provider-free",
    subject: `event-cluster:${cluster.clusterId}`,
    occurredAtMs: cluster.updatedAtMs,
    correlationId: cluster.clusterId,
    provider: {
      provider: "peas.event-cluster-beta",
      recordId: cluster.clusterId,
      revisionId: String(cluster.revision),
      artifactHash: cluster.stateDigest,
    },
    payload,
  };
}

export function latestEventClusterSnapshot(events: readonly StoredEvent[]): EventCluster {
  const snapshots = events.filter((event) => event.type === "event-cluster.snapshot");
  const latest = snapshots
    .sort((left, right) => (BigInt(left.streamVersion) < BigInt(right.streamVersion) ? -1 : 1))
    .at(-1);
  if (latest === undefined) fail("event-cluster.snapshot-missing");
  const payload = latest.payload["cluster"];
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    fail("event-cluster.snapshot-invalid");
  }
  const cluster = payload as unknown as EventCluster;
  const { stateDigest, ...withoutDigest } = cluster;
  if (
    typeof stateDigest !== "string" ||
    canonicalHash(
      "peas/event-cluster-state/v1",
      inertJsonSnapshot(withoutDigest as unknown as JsonValue),
    ) !== stateDigest
  ) {
    fail("event-cluster.snapshot-digest-invalid");
  }
  return frozenJson(cluster) as EventCluster;
}
