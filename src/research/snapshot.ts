import { createHash } from "node:crypto";

import type { ArtifactStore } from "../artifacts/artifact-store.js";
import { type StoredEvent, validateStoredEvent, verifyStoredEvent } from "../core/event.js";
import { canonicalHash } from "../core/hash.js";
import { canonicalJson } from "../core/json.js";
import {
  EVENT_CLUSTER_EFFECTS_ZERO,
  type EventCluster,
  type EventClusterMember,
  type EventPlan,
  latestEventClusterSnapshot,
} from "../domain/event-cluster-beta.js";
import type { MarketReferenceKindV1 } from "../providers/market-reference/contracts.js";
import { parseSecEasternCivilAcceptanceDateTime } from "../providers/sec/normalizer.js";
import {
  type Dataset,
  datasetSchema,
  freeze,
  identity,
  json,
  type NormalizedRecord,
  normalizedSchema,
} from "./contracts.js";

export type ResearchInput = Readonly<{
  snapshot: StoredEvent;
  plan: EventPlan;
  records: readonly NormalizedRecord[];
  dataset: Dataset;
  decisionMs: number;
  cutoffMs: number;
  initialStartMs: number;
  closeMs: number;
  nextSessionMs: number;
  repairEvent: boolean;
}>;
export type FrozenInput = ResearchInput & Readonly<{ id: string; cluster: EventCluster }>;
const kind: MarketReferenceKindV1 = "bar-one-minute-completed-close";

export function researchMemberKey(
  member: Pick<EventClusterMember, "lane" | "providerId" | "recordId" | "revisionId">,
): string {
  return identity("member", {
    lane: member.lane,
    providerId: member.providerId,
    recordId: member.recordId,
    revisionId: member.revisionId,
  });
}

/** Export one explicit persisted snapshot. No mutable latest pointer or live capture path. */
export function freezeResearchInput(raw: ResearchInput): FrozenInput {
  const snapshotInput = freeze(raw);
  const input: ResearchInput = {
    snapshot: snapshotInput.snapshot,
    plan: snapshotInput.plan,
    records: snapshotInput.records,
    dataset: snapshotInput.dataset,
    decisionMs: snapshotInput.decisionMs,
    cutoffMs: snapshotInput.cutoffMs,
    initialStartMs: snapshotInput.initialStartMs,
    closeMs: snapshotInput.closeMs,
    nextSessionMs: snapshotInput.nextSessionMs,
    repairEvent: snapshotInput.repairEvent,
  };
  const snapshot = validateStoredEvent(input.snapshot);
  verifyStoredEvent(snapshot);
  if (snapshot.type !== "event-cluster.snapshot") throw new Error("research-snapshot-type");
  const cluster = latestEventClusterSnapshot([snapshot]);
  const { revisionDigest, ...planBody } = input.plan;
  if (
    canonicalHash("peas/event-plan-revision/v1", json(planBody)) !== revisionDigest ||
    cluster.planId !== input.plan.planId ||
    cluster.planRevisionDigest !== revisionDigest ||
    canonicalJson(json(input.plan.prohibitedEffects)) !==
      canonicalJson(json(EVENT_CLUSTER_EFFECTS_ZERO))
  )
    throw new Error("research-plan-binding");
  for (const t of [
    input.decisionMs,
    input.cutoffMs,
    input.initialStartMs,
    input.closeMs,
    input.nextSessionMs,
  ])
    if (!Number.isSafeInteger(t) || t < 0) throw new Error("research-clock-invalid");
  if (
    input.cutoffMs > input.decisionMs ||
    input.initialStartMs >= input.cutoffMs ||
    input.closeMs <= input.decisionMs ||
    input.nextSessionMs <= input.closeMs
  )
    throw new Error("research-clock-order");
  const records = input.records.map((r) => normalizedSchema.parse(r));
  if (
    records.length !== cluster.members.length ||
    new Set(records.map((r) => r.memberKey)).size !== records.length
  )
    throw new Error("research-record-inventory");
  for (const member of cluster.members) {
    for (const clock of [member.firstObservedAtMs, member.retrievedAtMs]) {
      if (!Number.isSafeInteger(clock) || clock < 0)
        throw new Error("research-source-clock-invalid");
    }
    if (
      member.publicationOrAcceptanceAtMs !== null &&
      (!Number.isSafeInteger(member.publicationOrAcceptanceAtMs) ||
        member.publicationOrAcceptanceAtMs < 0)
    )
      throw new Error("research-source-clock-invalid");
    if (
      member.retrievedAtMs < member.firstObservedAtMs ||
      (member.publicationOrAcceptanceAtMs !== null &&
        member.publicationOrAcceptanceAtMs > member.firstObservedAtMs)
    )
      throw new Error("research-source-clock-order");
    const record = records.find((r) => r.memberKey === researchMemberKey(member));
    if (
      record === undefined ||
      record.artifactDigest !== member.artifactDigest ||
      member.normalization.sourceArtifactDigest !== member.artifactDigest ||
      record.normalizedEventId !== member.normalization.normalizedEventId ||
      record.normalizedEventHash !== member.normalization.normalizedEventHash ||
      record.normalizerId !== member.normalization.normalizerId
    )
      throw new Error("research-normalization-binding");
    const normalized = validateStoredEvent(record.normalizedEvent);
    verifyStoredEvent(normalized);
    if (
      normalized.eventId !== record.normalizedEventId ||
      normalized.eventHash !== record.normalizedEventHash ||
      normalized.provider.artifactHash !== member.artifactDigest
    )
      throw new Error("research-normalized-event-binding");
    if (record.normalizedAtMs !== null && record.normalizedAtMs < normalized.receivedAtMs)
      throw new Error("research-normalization-clock-provenance");
    if (
      record.secAcceptanceEastern !== null &&
      (member.lane !== "sec" ||
        parseSecEasternCivilAcceptanceDateTime(record.secAcceptanceEastern) !==
          member.publicationOrAcceptanceAtMs)
    )
      throw new Error("research-sec-time-binding");
  }
  const dataset = datasetSchema.parse(input.dataset);
  const keys = dataset.bars.map((b) => `${b.instrumentId}:${b.endMs}`);
  if (
    new Set(keys).size !== keys.length ||
    dataset.bars.some(
      (b) =>
        b.kind !== kind ||
        b.endMs % 60000 !== 0 ||
        (b.availableAtMs !== null && b.availableAtMs < b.endMs),
    )
  )
    throw new Error("research-market-clock-or-duplicate");
  const body = { ...input, records, dataset, cluster };
  return freeze({ ...body, id: identity("input", body) });
}

/** Optional local vault verification. Never fetches, captures or modifies original live evidence. */
export async function verifyResearchArtifacts(
  input: FrozenInput,
  store: Pick<ArtifactStore, "read">,
): Promise<void> {
  for (const member of input.cluster.members) {
    const read = await store.read(member.artifactDigest);
    const hash = createHash("sha256");
    for await (const bytes of read.stream) hash.update(bytes);
    if (
      hash.digest("hex") !== member.artifactDigest ||
      read.artifact.digest !== member.artifactDigest
    )
      throw new Error("research-artifact-digest");
  }
}
