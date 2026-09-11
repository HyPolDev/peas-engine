import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { ManualClock } from "../src/core/clock.js";
import {
  compileEventPlan,
  createEventCluster,
  deriveEventClusterRequestId,
  EVENT_CLUSTER_EFFECTS_ZERO,
  type EventClusterMember,
  eventClusterSnapshotDraft,
  type ProviderCapabilityEntry,
  recordEventClusterMember,
  recordStableMissing,
  stopEventCluster,
  transitionEventCluster,
} from "../src/domain/event-cluster-beta.js";
import type { Dataset, NormalizedRecord } from "../src/research/contracts.js";
import { type ResearchInput, researchMemberKey } from "../src/research/snapshot.js";

export const protocol = JSON.parse(
  readFileSync("fixtures/alpha-research/protocol.v1.json", "utf8"),
);
export const artifactBytes = Buffer.from("SYNTHETIC_VALIDATION fixture artifact v1");
export async function syntheticInput(
  date = "2026-01-10T15:00:00Z",
  index = 0,
  order: "sec" | "ir" | "simultaneous" | "missing" = "sec",
  sharedArtifact = false,
): Promise<ResearchInput> {
  const t = Date.parse(date);
  const assignments = [
    { lane: "sec", providerId: "synthetic.sec", capabilities: ["sec-filing"] },
    { lane: "issuer-ir", providerId: "synthetic.ir", capabilities: ["issuer-release"] },
    { lane: "transcript", providerId: "synthetic.transcript", capabilities: ["transcript"] },
    { lane: "market", providerId: "synthetic.market", capabilities: ["market-bars"] },
  ] as const;
  const registry: ProviderCapabilityEntry[] = assignments.flatMap((a) =>
    a.capabilities.map((capability) => ({
      providerId: a.providerId,
      capability,
      available: true,
      credentialRequirement: "none",
    })),
  );
  const plan = compileEventPlan(
    {
      calendarSourceId: "synthetic",
      calendarRevisionId: "v1",
      issuerId: `synthetic-${index}`,
      cik: String(index + 1).padStart(10, "0"),
      ticker: "SYN",
      exchange: "SYNTHETIC",
      instrumentId: "SYN",
      sectorBenchmark: "XLK",
      fiscalPeriod: "2026-Q1",
      expectedEventDate: date.slice(0, 10),
      expectedSession: "before-market",
      discoveredAtMs: t - 3600000,
    },
    {
      windows: {
        activationStartMs: t - 3600000,
        primaryStartMs: t - 600000,
        primaryEndMs: t + 600000,
        settlementEndMs: t + 86400000,
      },
      sourceAssignments: assignments,
      expectedForms: ["8-K"],
      expectedItems: ["2.02"],
      exhibitAliases: ["EX-99.1"],
      rawRetention: "immutable",
      duplicatePolicy: "provider-record-revision",
      correctionPolicy: "explicit-replacement",
      stableMissingPolicy: "lane-settlement",
      prohibitedEffects: EVENT_CLUSTER_EFFECTS_ZERO,
    },
    registry,
  );
  let cluster = createEventCluster(plan, t - 3600000);
  cluster = transitionEventCluster(cluster, "prewarming", t - 3500000);
  cluster = transitionEventCluster(cluster, "frozen", t - 3400000);
  cluster = transitionEventCluster(cluster, "active", t - 3300000);
  const records: NormalizedRecord[] = [];
  for (const [n, lane] of (["sec", "issuer-ir"] as const).entries()) {
    if (order === "missing" && lane === "issuer-ir") continue;
    const artifactDigest = createHash("sha256")
      .update(n === 0 || sharedArtifact ? artifactBytes : Buffer.from("synthetic-ir-v1"))
      .digest("hex");
    const observed =
      t -
      10000 +
      (order === "simultaneous" ? n * 1000 : order === "ir" ? (1 - n) * 3000 : n * 3000);
    const providerId = lane === "sec" ? "synthetic.sec" : "synthetic.ir";
    const capability = lane === "sec" ? "sec-filing" : "issuer-release";
    const normalizedLog = new InMemoryEventLog({ clock: new ManualClock(observed + 200) });
    const normalizedEvent = (
      await normalizedLog.append({
        envelopeVersion: 2,
        type: "synthetic.normalized",
        schemaVersion: 1,
        source: providerId,
        subject: `synthetic:${index}:${lane}`,
        occurredAtMs: observed - 100,
        correlationId: plan.planId,
        provider: {
          provider: providerId,
          recordId: lane === "sec" ? `${plan.candidate.cik}-26-000001` : `${index}-${lane}`,
          revisionId: "v1",
          artifactHash: artifactDigest,
        },
        payload: { evidenceClass: "SYNTHETIC_VALIDATION", revenue: 100 },
      })
    ).event;
    const member: EventClusterMember = {
      lane,
      kind: lane === "sec" ? "sec-8-k" : "issuer-release",
      issuerId: plan.candidate.issuerId,
      cik: plan.candidate.cik,
      fiscalPeriod: plan.candidate.fiscalPeriod,
      providerId,
      recordId: lane === "sec" ? `${plan.candidate.cik}-26-000001` : `${index}-${lane}`,
      revisionId: "v1",
      artifactDigest,
      requestIdentity: {
        providerId,
        capability,
        requestId: deriveEventClusterRequestId({
          providerId,
          capability,
          recordId: lane === "sec" ? `${plan.candidate.cik}-26-000001` : `${index}-${lane}`,
          revisionId: "v1",
        }),
      },
      normalization: {
        normalizerId: "synthetic-v1",
        sourceArtifactDigest: artifactDigest,
        normalizedEventId: normalizedEvent.eventId,
        normalizedEventHash: normalizedEvent.eventHash,
      },
      form: lane === "sec" ? "8-K" : null,
      items: lane === "sec" ? ["2.02"] : [],
      exhibitAlias: null,
      publicationOrAcceptanceAtMs: observed - 100,
      firstObservedAtMs: observed,
      retrievedAtMs: observed + 100,
      relationship: "original",
      replacesArtifactDigest: null,
    };
    cluster = recordEventClusterMember(cluster, plan, member);
    records.push({
      memberKey: researchMemberKey(member),
      artifactDigest,
      normalizedEventId: normalizedEvent.eventId,
      normalizedEventHash: normalizedEvent.eventHash,
      normalizerId: "synthetic-v1",
      normalizedAtMs: observed + 200,
      featureReadyAtMs: observed + 300,
      secAcceptanceEastern: null,
      normalizedEvent,
    });
  }
  cluster = recordStableMissing(cluster, "transcript", "synthetic-not-provided", t);
  const snapshot = (
    await new InMemoryEventLog({ clock: new ManualClock(t) }).append(
      eventClusterSnapshotDraft(cluster),
    )
  ).event;
  const bars: Dataset["bars"] = [];
  for (const instrumentId of ["SYN", "SPY", "XLK"])
    for (const minute of [-1, 0, 1, 5, 15, 30, 60, 120, 1440])
      bars.push({
        instrumentId,
        endMs: t + minute * 60000,
        availableAtMs: t + minute * 60000,
        close:
          instrumentId === "SYN"
            ? 100 + (minute === -1 ? 0 : minute === 0 ? 1 : minute === 1 ? 2 : 3 + minute / 100)
            : 100,
        kind: "bar-one-minute-completed-close",
      });
  return {
    snapshot,
    plan,
    records,
    dataset: {
      version: "synthetic-bars-v1",
      evidenceClass: "SYNTHETIC_VALIDATION",
      adjustmentPolicy: "synthetic-no-corporate-actions",
      bars,
    },
    decisionMs: t,
    cutoffMs: t,
    initialStartMs: t - 60000,
    closeMs: t + 120 * 60000,
    nextSessionMs: t + 86400000,
    repairEvent: false,
  };
}

export async function stoppedInput(input: ResearchInput): Promise<ResearchInput> {
  const cluster = input.snapshot.payload["cluster"] as unknown as Parameters<
    typeof stopEventCluster
  >[0];
  const stopped = stopEventCluster(cluster, "synthetic-stop", input.decisionMs);
  const snapshot = (
    await new InMemoryEventLog({ clock: new ManualClock(input.decisionMs) }).append(
      eventClusterSnapshotDraft(stopped),
    )
  ).event;
  return { ...input, snapshot };
}
