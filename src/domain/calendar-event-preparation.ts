import { z } from "zod";

import { canonicalHash } from "../core/hash.js";
import { canonicalJson, inertJsonSnapshot, type JsonValue } from "../core/json.js";
import {
  amendEventPlan,
  compileEventPlan,
  EVENT_CLUSTER_EFFECTS_ZERO,
  EVENT_CLUSTER_LANES,
  type CalendarCandidate,
  type EventClusterLane,
  type EventPlan,
  type EventPlanAmendment,
  type EventPlanSpec,
  type ProviderCapability,
  type ProviderCapabilityEntry,
} from "./event-cluster-beta.js";
import { parseSecEasternCivilAcceptanceDateTime } from "../providers/sec/normalizer.js";

export const CALENDAR_PREPARATION_SOURCE_IDS = Object.freeze([
  "calendar-identity",
  "sec-submissions",
  "sec-filing-exhibit",
  "issuer-release",
  "issuer-presentation",
  "issuer-webcast",
  "prepared-remarks",
  "transcript",
  "estimates-snapshot",
  "issuer-market-bars",
  "spy-market-bars",
  "sector-market-bars",
] as const);

export type CalendarPreparationSourceId = (typeof CALENDAR_PREPARATION_SOURCE_IDS)[number];
export type ReadinessStatus = "ready" | "missing" | "blocked" | "separately-authorized";

export type CalendarSourceBinding = Readonly<{
  sourceId: CalendarPreparationSourceId;
  providerId: string;
  capability: ProviderCapability;
  configuredIdentityOrPath: string | null;
  officialHostPlaceholder: string | null;
  pathPlaceholder: string | null;
  available: boolean;
  credentialRequirement: "none" | "separately-authorized";
  entitlementRequirement: "none" | "separately-authorized";
  liveAccessRequired: boolean;
}>;

export type CalendarPreparationAmendment = Readonly<{
  amendmentId: string;
  phase: "before-freeze" | "after-freeze";
  recordedAtMs: number;
  reason: string;
  changes: Readonly<{
    expectedEventDate?: string;
    expectedSession?: CalendarCandidate["expectedSession"];
  }>;
}>;

export type CalendarEventPreparationInput = Readonly<{
  schemaVersion: 1;
  issuerName: string;
  issuerId: string;
  ticker: string;
  cik: string;
  exchange: string;
  instrumentId: string;
  sectorBenchmark: string;
  fiscalPeriod: string;
  expectedEventDate: string;
  expectedSession: CalendarCandidate["expectedSession"];
  calendarSourceId: string;
  calendarRevisionId: string;
  discoveredAtMs: number;
  corroboratingCalendarCandidates: readonly Readonly<{
    calendarSourceId: string;
    calendarRevisionId: string;
    expectedEventDate: string;
    expectedSession: CalendarCandidate["expectedSession"];
    discoveredAtMs: number;
  }>[];
  sourceBindings: readonly CalendarSourceBinding[];
  pollingPolicy: Readonly<{
    intervalSeconds: number;
    requestCeiling: number;
    timeoutMs: number;
    responseSizeLimitBytes: number;
  }>;
  amendments: readonly CalendarPreparationAmendment[];
}>;

export type ReadinessChecklistRow = Readonly<{
  sourceId: CalendarPreparationSourceId;
  requiredMaterial: string;
  plannedProviderCapability: ProviderCapability;
  providerId: string;
  configuredIdentityOrPath: string | null;
  requirement: "mandatory" | "optional";
  status: ReadinessStatus;
  blockerReason: string | null;
  credentialsRequired: boolean;
  entitlementRequired: boolean;
  liveAccessRequired: boolean;
}>;

export type CalendarEventPreparationFile = Readonly<{
  schemaVersion: 1;
  configurationDigest: string;
  issuerName: string;
  eventPlan: EventPlan;
  activationAndObservation: Readonly<{
    expectedReleaseAnchorMs: number;
    estimateSnapshotAtMs: number;
    followUpStartMs: number;
    followUpEndMs: number;
    followUpForms: readonly ["10-Q", "10-Q/A", "10-K", "10-K/A"];
  }>;
  expectedMaterials: Readonly<{
    secForms: readonly string[];
    secItems: readonly string[];
    exhibitAliases: readonly string[];
    issuerMaterials: readonly ["press-release", "presentation", "webcast"];
    transcriptMaterials: readonly ["prepared-remarks", "transcript"];
  }>;
  permittedProviderCapabilities: readonly Readonly<{
    sourceId: CalendarPreparationSourceId;
    providerId: string;
    capability: ProviderCapability;
    officialHostPlaceholder: string | null;
    pathPlaceholder: string | null;
  }>[];
  sourceReadiness: readonly ReadinessChecklistRow[];
  networkPolicy: CalendarEventPreparationInput["pollingPolicy"];
  marketEvidence: Readonly<{
    subjects: EventPlan["marketSubjects"];
    windows: EventPlan["marketWindows"];
    interpretation: "coarse-bar-movement-not-tradability";
  }>;
  preparationHistory: Readonly<{
    beforeFreezeAmendments: readonly Readonly<{
      amendmentId: string;
      recordedAtMs: number;
      reason: string;
      changeDigest: string;
    }>[];
    afterFreezeAmendments: EventPlan["amendments"];
  }>;
  unresolvedRequirements: readonly Readonly<{
    sourceId: CalendarPreparationSourceId;
    status: Exclude<ReadinessStatus, "ready">;
    reason: string;
  }>[];
  prohibitedEffects: typeof EVENT_CLUSTER_EFFECTS_ZERO;
}>;

export type CalendarEventPreparationResult = Readonly<{
  preparation: CalendarEventPreparationFile;
  checklist: readonly ReadinessChecklistRow[];
  preparationJson: string;
  checklistMarkdown: string;
}>;

export class CalendarEventPreparationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CalendarEventPreparationError";
  }
}

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const epoch = z.number().int().nonnegative().safe();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const session = z.enum(["before-market", "after-market", "unknown"]);
const capability = z.enum([
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
]);
const sourceId = z.enum(CALENDAR_PREPARATION_SOURCE_IDS);
const sourceBindingSchema = z
  .object({
    sourceId,
    providerId: identifier,
    capability,
    configuredIdentityOrPath: z.string().min(1).max(1024).nullable(),
    officialHostPlaceholder: z
      .string()
      .regex(/^[a-z0-9.-]+$/u)
      .nullable(),
    pathPlaceholder: z.string().min(1).max(1024).nullable(),
    available: z.boolean(),
    credentialRequirement: z.enum(["none", "separately-authorized"]),
    entitlementRequirement: z.enum(["none", "separately-authorized"]),
    liveAccessRequired: z.boolean(),
  })
  .strict();
const amendmentSchema = z
  .object({
    amendmentId: identifier,
    phase: z.enum(["before-freeze", "after-freeze"]),
    recordedAtMs: epoch,
    reason: z.string().min(1).max(512),
    changes: z
      .object({
        expectedEventDate: date.optional(),
        expectedSession: session.optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0),
  })
  .strict();
const inputSchema = z
  .object({
    schemaVersion: z.literal(1),
    issuerName: z.string().min(1).max(256),
    issuerId: identifier,
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,15}$/u),
    cik: z.string().regex(/^\d{10}$/u),
    exchange: identifier,
    instrumentId: identifier,
    sectorBenchmark: z.string().regex(/^[A-Z][A-Z0-9.-]{0,15}$/u),
    fiscalPeriod: z.string().regex(/^\d{4}-(?:Q[1-4]|FY)$/u),
    expectedEventDate: date,
    expectedSession: session,
    calendarSourceId: identifier,
    calendarRevisionId: identifier,
    discoveredAtMs: epoch,
    corroboratingCalendarCandidates: z
      .array(
        z
          .object({
            calendarSourceId: identifier,
            calendarRevisionId: identifier,
            expectedEventDate: date,
            expectedSession: session,
            discoveredAtMs: epoch,
          })
          .strict(),
      )
      .max(31),
    sourceBindings: z.array(sourceBindingSchema).length(CALENDAR_PREPARATION_SOURCE_IDS.length),
    pollingPolicy: z
      .object({
        intervalSeconds: z.number().int().min(60).max(3600),
        requestCeiling: z.number().int().min(1).max(1000),
        timeoutMs: z.number().int().min(100).max(120_000),
        responseSizeLimitBytes: z
          .number()
          .int()
          .min(1024)
          .max(64 * 1024 * 1024),
      })
      .strict(),
    amendments: z.array(amendmentSchema).max(32),
  })
  .strict();

const SOURCE_DEFINITIONS: Readonly<
  Record<
    CalendarPreparationSourceId,
    Readonly<{
      material: string;
      capability: ProviderCapability;
      lane: EventClusterLane | null;
      requirement: "mandatory" | "optional";
    }>
  >
> = Object.freeze({
  "calendar-identity": {
    material: "Deterministic calendar identity",
    capability: "calendar-discovery",
    lane: null,
    requirement: "mandatory",
  },
  "sec-submissions": {
    material: "SEC submissions feed",
    capability: "sec-filing",
    lane: "sec",
    requirement: "mandatory",
  },
  "sec-filing-exhibit": {
    material: "SEC filing and earnings exhibit",
    capability: "filing-exhibit",
    lane: "sec",
    requirement: "mandatory",
  },
  "issuer-release": {
    material: "Issuer press release",
    capability: "issuer-release",
    lane: "issuer-ir",
    requirement: "mandatory",
  },
  "issuer-presentation": {
    material: "Issuer presentation or slides",
    capability: "issuer-slides",
    lane: "issuer-ir",
    requirement: "optional",
  },
  "issuer-webcast": {
    material: "Issuer webcast metadata",
    capability: "webcast-metadata",
    lane: "issuer-ir",
    requirement: "optional",
  },
  "prepared-remarks": {
    material: "Prepared remarks",
    capability: "prepared-remarks",
    lane: "transcript",
    requirement: "optional",
  },
  transcript: {
    material: "Transcript",
    capability: "transcript",
    lane: "transcript",
    requirement: "optional",
  },
  "estimates-snapshot": {
    material: "Prospective estimates snapshot",
    capability: "expectations-snapshot",
    lane: "market",
    requirement: "optional",
  },
  "issuer-market-bars": {
    material: "Issuer one-minute market bars",
    capability: "market-bars",
    lane: "market",
    requirement: "mandatory",
  },
  "spy-market-bars": {
    material: "SPY one-minute benchmark bars",
    capability: "benchmark-market-data",
    lane: "market",
    requirement: "mandatory",
  },
  "sector-market-bars": {
    material: "Sector-benchmark one-minute bars",
    capability: "benchmark-market-data",
    lane: "market",
    requirement: "mandatory",
  },
});

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function fail(code: string): never {
  throw new CalendarEventPreparationError(code);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

function stablePrettyJson(value: unknown): string {
  const canonical = canonicalJson(value as JsonValue);
  return `${JSON.stringify(JSON.parse(canonical), null, 2)}\n`;
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readiness(binding: CalendarSourceBinding): Readonly<{
  status: ReadinessStatus;
  reason: string | null;
}> {
  if (binding.configuredIdentityOrPath === null) {
    return { status: "missing", reason: "configured-identity-or-path-missing" };
  }
  if (!binding.available) {
    return { status: "blocked", reason: "provider-capability-unavailable" };
  }
  if (
    binding.credentialRequirement === "separately-authorized" &&
    binding.entitlementRequirement === "separately-authorized"
  ) {
    return {
      status: "separately-authorized",
      reason: "credential-and-entitlement-authorization-required",
    };
  }
  if (binding.credentialRequirement === "separately-authorized") {
    return { status: "separately-authorized", reason: "credential-authorization-required" };
  }
  if (binding.entitlementRequirement === "separately-authorized") {
    return { status: "separately-authorized", reason: "entitlement-authorization-required" };
  }
  if (binding.liveAccessRequired) {
    return { status: "separately-authorized", reason: "live-access-authorization-required" };
  }
  return { status: "ready", reason: null };
}

function validateBindings(bindings: readonly CalendarSourceBinding[]): void {
  const seen = new Set<CalendarPreparationSourceId>();
  for (const binding of bindings) {
    if (seen.has(binding.sourceId)) fail("calendar-preparation.source-duplicate");
    seen.add(binding.sourceId);
    if (binding.capability !== SOURCE_DEFINITIONS[binding.sourceId].capability) {
      fail("calendar-preparation.capability-mismatch");
    }
  }
  if (seen.size !== CALENDAR_PREPARATION_SOURCE_IDS.length) {
    fail("calendar-preparation.source-set-incomplete");
  }
}

function expectedReleaseAnchor(
  dateValue: string,
  expectedSession: CalendarCandidate["expectedSession"],
): number {
  const time =
    expectedSession === "before-market"
      ? "07:00:00"
      : expectedSession === "after-market"
        ? "16:00:00"
        : "12:00:00";
  const anchor = parseSecEasternCivilAcceptanceDateTime(`${dateValue}T${time}`);
  if (anchor === null) fail("calendar-preparation.release-anchor-invalid");
  return anchor;
}

function windowsFor(
  dateValue: string,
  expectedSession: CalendarCandidate["expectedSession"],
): Readonly<{
  anchorMs: number;
  windows: EventPlanSpec["windows"];
}> {
  const anchorMs = expectedReleaseAnchor(dateValue, expectedSession);
  if (expectedSession === "before-market") {
    return {
      anchorMs,
      windows: {
        activationStartMs: anchorMs - 12 * HOUR_MS,
        primaryStartMs: anchorMs - HOUR_MS,
        primaryEndMs: anchorMs + 10 * HOUR_MS,
        settlementEndMs: anchorMs + 36 * HOUR_MS,
      },
    };
  }
  if (expectedSession === "after-market") {
    return {
      anchorMs,
      windows: {
        activationStartMs: anchorMs - 8 * HOUR_MS,
        primaryStartMs: anchorMs - HOUR_MS,
        primaryEndMs: anchorMs + 8 * HOUR_MS,
        settlementEndMs: anchorMs + 36 * HOUR_MS,
      },
    };
  }
  return {
    anchorMs,
    windows: {
      activationStartMs: anchorMs - 12 * HOUR_MS,
      primaryStartMs: anchorMs - 12 * HOUR_MS + 1,
      primaryEndMs: anchorMs + 12 * HOUR_MS,
      settlementEndMs: anchorMs + 48 * HOUR_MS,
    },
  };
}

function checklistFor(
  bindings: readonly CalendarSourceBinding[],
): readonly ReadinessChecklistRow[] {
  return Object.freeze(
    [...bindings]
      .sort((left, right) => ordinalCompare(left.sourceId, right.sourceId))
      .map((binding) => {
        const definition = SOURCE_DEFINITIONS[binding.sourceId];
        const result = readiness(binding);
        return Object.freeze({
          sourceId: binding.sourceId,
          requiredMaterial: definition.material,
          plannedProviderCapability: binding.capability,
          providerId: binding.providerId,
          configuredIdentityOrPath: binding.configuredIdentityOrPath,
          requirement: definition.requirement,
          status: result.status,
          blockerReason: result.reason,
          credentialsRequired: binding.credentialRequirement !== "none",
          entitlementRequired: binding.entitlementRequirement !== "none",
          liveAccessRequired: binding.liveAccessRequired,
        });
      }),
  );
}

function providerInputs(bindings: readonly CalendarSourceBinding[]): Readonly<{
  assignments: EventPlanSpec["sourceAssignments"];
  registry: readonly ProviderCapabilityEntry[];
}> {
  const registryByKey = new Map<string, ProviderCapabilityEntry>();
  for (const binding of bindings) {
    const key = `${binding.providerId}:${binding.capability}`;
    const next: ProviderCapabilityEntry = {
      providerId: binding.providerId,
      capability: binding.capability,
      available: binding.available,
      credentialRequirement: binding.credentialRequirement,
    };
    const prior = registryByKey.get(key);
    if (
      prior !== undefined &&
      (prior.available !== next.available ||
        prior.credentialRequirement !== next.credentialRequirement)
    ) {
      fail("calendar-preparation.provider-declaration-conflict");
    }
    registryByKey.set(key, next);
  }

  const selectedSourceIds = new Set<CalendarPreparationSourceId>();
  const assignments = EVENT_CLUSTER_LANES.map((lane) => {
    const laneBindings = bindings.filter(
      (binding) => SOURCE_DEFINITIONS[binding.sourceId].lane === lane,
    );
    const planned = laneBindings.filter((binding) => {
      const definition = SOURCE_DEFINITIONS[binding.sourceId];
      const status = readiness(binding).status;
      return (
        definition.requirement === "mandatory" ||
        status === "ready" ||
        status === "separately-authorized"
      );
    });
    const selected = planned.length > 0 ? planned : laneBindings.slice(0, 1);
    const providerIds = new Set(selected.map((binding) => binding.providerId));
    if (providerIds.size !== 1) fail("calendar-preparation.lane-provider-ambiguous");
    const providerId = [...providerIds][0];
    if (providerId === undefined) fail("calendar-preparation.lane-provider-missing");
    for (const binding of selected) selectedSourceIds.add(binding.sourceId);
    return {
      lane,
      providerId,
      capabilities: [...new Set(selected.map((binding) => binding.capability))].sort(
        ordinalCompare,
      ),
    } as EventPlanSpec["sourceAssignments"][number];
  });

  // Provider capability declarations are shared, while configured identities and
  // source readiness are source-specific. Mandatory missing/blocked sources stop
  // their lane; every source selected into a plan preserves its authorization gate.
  for (const binding of bindings) {
    const definition = SOURCE_DEFINITIONS[binding.sourceId];
    const status = readiness(binding).status;
    const key = `${binding.providerId}:${binding.capability}`;
    const declared = registryByKey.get(key);
    if (declared === undefined) fail("calendar-preparation.provider-declaration-missing");
    if (definition.requirement === "mandatory" && (status === "missing" || status === "blocked")) {
      registryByKey.set(key, { ...declared, available: false });
    } else if (selectedSourceIds.has(binding.sourceId) && status === "separately-authorized") {
      registryByKey.set(key, {
        ...declared,
        credentialRequirement: "separately-authorized",
      });
    }
  }

  return {
    assignments,
    registry: [...registryByKey.values()].sort((left, right) =>
      ordinalCompare(
        `${left.providerId}:${left.capability}`,
        `${right.providerId}:${right.capability}`,
      ),
    ),
  };
}

function candidateFrom(
  input: CalendarEventPreparationInput,
  calendar: Readonly<{
    calendarSourceId: string;
    calendarRevisionId: string;
    expectedEventDate: string;
    expectedSession: CalendarCandidate["expectedSession"];
    discoveredAtMs: number;
  }>,
): CalendarCandidate {
  return {
    calendarSourceId: calendar.calendarSourceId,
    calendarRevisionId: calendar.calendarRevisionId,
    issuerId: input.issuerId,
    cik: input.cik,
    ticker: input.ticker,
    exchange: input.exchange,
    instrumentId: input.instrumentId,
    sectorBenchmark: input.sectorBenchmark,
    fiscalPeriod: input.fiscalPeriod,
    expectedEventDate: calendar.expectedEventDate,
    expectedSession: calendar.expectedSession,
    discoveredAtMs: calendar.discoveredAtMs,
  };
}

function markdownChecklist(rows: readonly ReadinessChecklistRow[], digest: string): string {
  const lines = [
    "# Calendar Event Provider Readiness",
    "",
    `Configuration digest: \`${digest}\``,
    "",
    "| Source | Material | Capability | Provider / identity | Requirement | Status | Blocker | Credentials | Entitlement | Live access |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const identity =
      row.configuredIdentityOrPath === null
        ? "—"
        : row.configuredIdentityOrPath.replaceAll("|", "\\|");
    lines.push(
      `| ${row.sourceId} | ${row.requiredMaterial} | ${row.plannedProviderCapability} | ${row.providerId} / ${identity} | ${row.requirement} | ${row.status} | ${row.blockerReason ?? "—"} | ${row.credentialsRequired ? "yes" : "no"} | ${row.entitlementRequired ? "yes" : "no"} | ${row.liveAccessRequired ? "yes" : "no"} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function prepareCalendarEvent(
  inputValue: CalendarEventPreparationInput,
): CalendarEventPreparationResult {
  let input: CalendarEventPreparationInput;
  try {
    input = inputSchema.parse(
      inertJsonSnapshot(inputValue as unknown as JsonValue),
    ) as unknown as CalendarEventPreparationInput;
  } catch {
    fail("calendar-preparation.input-invalid");
  }
  validateBindings(input.sourceBindings);
  const { assignments, registry } = providerInputs(input.sourceBindings);

  let dateValue = input.expectedEventDate;
  let sessionValue = input.expectedSession;
  const beforeFreezeAmendments: {
    amendmentId: string;
    recordedAtMs: number;
    reason: string;
    changeDigest: string;
  }[] = [];
  for (const amendment of input.amendments.filter((value) => value.phase === "before-freeze")) {
    dateValue = amendment.changes.expectedEventDate ?? dateValue;
    sessionValue = amendment.changes.expectedSession ?? sessionValue;
    beforeFreezeAmendments.push({
      amendmentId: amendment.amendmentId,
      recordedAtMs: amendment.recordedAtMs,
      reason: amendment.reason,
      changeDigest: canonicalHash(
        "peas/calendar-preparation-before-freeze-amendment/v1",
        amendment.changes as JsonValue,
      ),
    });
  }

  let windowResult = windowsFor(dateValue, sessionValue);
  const spec: EventPlanSpec = {
    windows: windowResult.windows,
    sourceAssignments: assignments,
    expectedForms: ["8-K", "10-Q", "10-K"],
    expectedItems: ["2.02", "7.01", "9.01"],
    exhibitAliases: ["EX-99", "EX-99.1"],
    rawRetention: "immutable",
    duplicatePolicy: "provider-record-revision",
    correctionPolicy: "explicit-replacement",
    stableMissingPolicy: "lane-settlement",
    prohibitedEffects: EVENT_CLUSTER_EFFECTS_ZERO,
  };
  const primary = candidateFrom(input, {
    calendarSourceId: input.calendarSourceId,
    calendarRevisionId: input.calendarRevisionId,
    expectedEventDate: dateValue,
    expectedSession: sessionValue,
    discoveredAtMs: input.discoveredAtMs,
  });
  const corroborating = input.corroboratingCalendarCandidates.map((calendar) =>
    candidateFrom(input, calendar),
  );
  const candidates = [primary, ...corroborating];
  const dates = new Set(candidates.map((candidate) => candidate.expectedEventDate));
  const sessions = new Set(candidates.map((candidate) => candidate.expectedSession));
  if (dates.size !== 1 || sessions.size !== 1) {
    fail("calendar-preparation.calendar-conflict");
  }
  const selectedCandidate = candidates.sort((left, right) =>
    ordinalCompare(
      `${left.calendarSourceId}:${left.calendarRevisionId}`,
      `${right.calendarSourceId}:${right.calendarRevisionId}`,
    ),
  )[0];
  if (selectedCandidate === undefined) fail("calendar-preparation.plan-count-invalid");
  let eventPlan: EventPlan = compileEventPlan(selectedCandidate, spec, registry);

  for (const amendment of input.amendments.filter((value) => value.phase === "after-freeze")) {
    const amendedDate =
      amendment.changes.expectedEventDate ?? eventPlan.candidate.expectedEventDate;
    const amendedSession = amendment.changes.expectedSession ?? eventPlan.candidate.expectedSession;
    windowResult = windowsFor(amendedDate, amendedSession);
    const changes: EventPlanAmendment["changes"] = {
      ...amendment.changes,
      windows: windowResult.windows,
    };
    eventPlan = amendEventPlan(eventPlan, {
      amendmentId: amendment.amendmentId,
      recordedAtMs: amendment.recordedAtMs,
      reason: amendment.reason,
      changes,
    });
  }

  windowResult = windowsFor(
    eventPlan.candidate.expectedEventDate,
    eventPlan.candidate.expectedSession,
  );
  const checklist = checklistFor(input.sourceBindings);
  const unresolvedRequirements = checklist
    .filter(
      (
        row,
      ): row is ReadinessChecklistRow & {
        status: Exclude<ReadinessStatus, "ready">;
        blockerReason: string;
      } => row.status !== "ready" && row.blockerReason !== null,
    )
    .map((row) => ({ sourceId: row.sourceId, status: row.status, reason: row.blockerReason }));
  const preimage = {
    schemaVersion: 1 as const,
    issuerName: input.issuerName,
    eventPlan,
    activationAndObservation: {
      expectedReleaseAnchorMs: windowResult.anchorMs,
      estimateSnapshotAtMs: windowResult.anchorMs - 30 * MINUTE_MS,
      followUpStartMs: eventPlan.windows.primaryEndMs,
      followUpEndMs: eventPlan.windows.settlementEndMs,
      followUpForms: ["10-Q", "10-Q/A", "10-K", "10-K/A"] as const,
    },
    expectedMaterials: {
      secForms: ["8-K", "8-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A"],
      secItems: eventPlan.expectedItems,
      exhibitAliases: eventPlan.exhibitAliases,
      issuerMaterials: ["press-release", "presentation", "webcast"] as const,
      transcriptMaterials: ["prepared-remarks", "transcript"] as const,
    },
    permittedProviderCapabilities: [...input.sourceBindings]
      .sort((left, right) => ordinalCompare(left.sourceId, right.sourceId))
      .map((binding) => ({
        sourceId: binding.sourceId,
        providerId: binding.providerId,
        capability: binding.capability,
        officialHostPlaceholder: binding.officialHostPlaceholder,
        pathPlaceholder: binding.pathPlaceholder,
      })),
    sourceReadiness: checklist,
    networkPolicy: input.pollingPolicy,
    marketEvidence: {
      subjects: eventPlan.marketSubjects,
      windows: eventPlan.marketWindows,
      interpretation: "coarse-bar-movement-not-tradability" as const,
    },
    preparationHistory: {
      beforeFreezeAmendments,
      afterFreezeAmendments: eventPlan.amendments,
    },
    unresolvedRequirements,
    prohibitedEffects: EVENT_CLUSTER_EFFECTS_ZERO,
  };
  const configurationDigest = canonicalHash(
    "peas/calendar-event-preparation/v1",
    preimage as unknown as JsonValue,
  );
  const preparation = deepFreeze(
    inertJsonSnapshot({
      ...preimage,
      configurationDigest,
    } as unknown as JsonValue) as unknown as CalendarEventPreparationFile,
  ) as CalendarEventPreparationFile;
  return Object.freeze({
    preparation,
    checklist,
    preparationJson: stablePrettyJson(preparation),
    checklistMarkdown: markdownChecklist(checklist, configurationDigest),
  });
}
