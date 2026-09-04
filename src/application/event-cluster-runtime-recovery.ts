import type { AppendResult, EventLog, StoredEvent } from "../core/event.js";
import {
  EVENT_CLUSTER_LANES,
  type EventCluster,
  EventClusterBetaError,
  type EventClusterLane,
  type EventPlan,
  eventClusterSnapshotDraft,
  latestEventClusterSnapshot,
  settleEventCluster,
  transitionEventCluster,
} from "../domain/event-cluster-beta.js";

export type EventClusterRunClassification = "complete" | "stopped" | "incomplete";

export type RecoveredEventClusterRun = Readonly<{
  cluster: EventCluster;
  classification: EventClusterRunClassification;
  completedLanes: readonly EventClusterLane[];
  pendingLanes: readonly EventClusterLane[];
}>;

function assertPlanIdentity(cluster: EventCluster, plan: EventPlan): void {
  if (cluster.planId !== plan.planId || cluster.planRevisionDigest !== plan.revisionDigest) {
    throw new EventClusterBetaError("event-cluster.plan-identity-drift");
  }
}

function classify(cluster: EventCluster): EventClusterRunClassification {
  if (cluster.status === "complete") return "complete";
  if (cluster.status === "stopped") return "stopped";
  return "incomplete";
}

export function recoverEventClusterRun(
  events: readonly StoredEvent[],
  plan: EventPlan,
): RecoveredEventClusterRun {
  const scopedEvents = events.filter((event) => {
    if (event.type !== "event-cluster.snapshot") return false;
    const payload = event.payload["cluster"];
    return (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      (payload as Readonly<Record<string, unknown>>)["planId"] === plan.planId
    );
  });
  const cluster = latestEventClusterSnapshot(scopedEvents);
  assertPlanIdentity(cluster, plan);
  const classification = classify(cluster);
  const completedLanes = EVENT_CLUSTER_LANES.filter((lane) => {
    const status = cluster.lanes.find((candidate) => candidate.lane === lane)?.status;
    return status === "observed" || status === "stable-missing";
  });
  const pendingLanes =
    classification === "incomplete"
      ? EVENT_CLUSTER_LANES.filter(
          (lane) =>
            cluster.lanes.find((candidate) => candidate.lane === lane)?.status === "pending",
        )
      : [];
  return Object.freeze({
    cluster,
    classification,
    completedLanes: Object.freeze(completedLanes),
    pendingLanes: Object.freeze(pendingLanes),
  });
}

export async function recoverEventClusterRunFromLog(
  eventLog: EventLog,
  plan: EventPlan,
): Promise<RecoveredEventClusterRun> {
  const events: StoredEvent[] = [];
  let cursor = "0";
  for (;;) {
    const page = await eventLog.readAfter(cursor, 1_000);
    events.push(...page.events);
    if (!page.hasMore) break;
    if (page.nextPosition === cursor) {
      throw new EventClusterBetaError("event-cluster.snapshot-invalid");
    }
    cursor = page.nextPosition;
  }
  return recoverEventClusterRun(events, plan);
}

export function shouldAcquireRecoveredLane(
  run: RecoveredEventClusterRun,
  lane: EventClusterLane,
): boolean {
  return run.classification === "incomplete" && run.pendingLanes.includes(lane);
}

export async function checkpointEventClusterRun(
  eventLog: EventLog,
  cluster: EventCluster,
): Promise<AppendResult> {
  return eventLog.append(eventClusterSnapshotDraft(cluster));
}

export function settleRecoveredEventClusterRun(
  cluster: EventCluster,
  plan: EventPlan,
  atMs: number,
): EventCluster {
  assertPlanIdentity(cluster, plan);
  if (cluster.status === "complete") return cluster;
  if (cluster.status === "stopped") {
    throw new EventClusterBetaError("event-cluster.already-terminal");
  }
  const settling =
    cluster.status === "settling" ? cluster : transitionEventCluster(cluster, "settling", atMs);
  return settleEventCluster(settling, plan, atMs);
}
