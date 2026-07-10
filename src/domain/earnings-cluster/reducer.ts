import { z } from "zod";

import type { StoredEvent } from "../../core/event.js";
import { canonicalHash } from "../../core/hash.js";
import { assertJson, cloneJson, type JsonObject } from "../../core/json.js";
import type { DecisionDraft, Reducer, ReducerContext, Transition } from "../../core/processor.js";

export type EarningsClusterConfig = {
  clusterWindowMs: number;
};

export type ReleaseRecord = {
  releaseId: string;
  issuerId: string;
  fiscalPeriod: string;
  sourceEventId: string;
  logicalAtMs: number;
};

export type AnalysisRecord = {
  status: "pending" | "succeeded" | "failed";
  result: JsonObject | null;
  errorCode: string | null;
};

export type EarningsCluster = {
  clusterId: string;
  clusterKey: string;
  status: "open" | "closed";
  openedAtMs: number;
  closesAtMs: number;
  closedAtMs: number | null;
  releases: ReleaseRecord[];
  analysis: AnalysisRecord | null;
};

export type ReleaseOutcome = {
  outcome: "accepted" | "late";
  clusterId: string;
  sourceEventId: string;
};

export type EarningsClusterState = {
  schemaVersion: 1;
  clusters: Record<string, EarningsCluster>;
  clusterByKey: Record<string, string>;
  releaseOutcomes: Record<string, ReleaseOutcome>;
};

const configSchema = z.object({ clusterWindowMs: z.number().int().positive().safe() }).strict();
const releaseSchema = z
  .object({
    releaseId: z.string().min(1).max(256),
    clusterKey: z.string().min(1).max(512),
    issuerId: z.string().min(1).max(256),
    fiscalPeriod: z.string().min(1).max(128),
  })
  .strict();
const timerFiredSchema = z
  .object({
    timerType: z.literal("earnings.cluster.close"),
    clusterId: z.string().min(1),
    scheduledForLogicalMs: z.number().int().nonnegative().safe(),
  })
  .strict();
const jobSucceededSchema = z
  .object({
    jobType: z.literal("earnings.cluster.analyze"),
    clusterId: z.string().min(1),
    result: z.record(z.string(), z.unknown()),
  })
  .strict();
const jobFailedSchema = z
  .object({
    jobType: z.literal("earnings.cluster.analyze"),
    clusterId: z.string().min(1),
    errorCode: z.string().min(1).max(256),
  })
  .strict();

function decision(type: string, payload: JsonObject): DecisionDraft {
  return { type, payload };
}

function noEffects(
  state: EarningsClusterState,
  entry: DecisionDraft,
): Transition<EarningsClusterState> {
  return { state, decisions: [entry], jobs: [], outbox: [] };
}

function requireSchemaVersion(event: StoredEvent): void {
  if (event.schemaVersion !== 1) {
    throw new Error(`Unsupported ${event.type} schema version ${event.schemaVersion}`);
  }
}

export class EarningsClusterReducer
  implements Reducer<EarningsClusterState, EarningsClusterConfig>
{
  readonly name = "earnings-cluster";
  readonly version = "1.0.0";

  initialState(config: Readonly<EarningsClusterConfig>): EarningsClusterState {
    configSchema.parse(config);
    return { schemaVersion: 1, clusters: {}, clusterByKey: {}, releaseOutcomes: {} };
  }

  apply(
    previous: Readonly<EarningsClusterState>,
    event: Readonly<StoredEvent>,
    context: ReducerContext<EarningsClusterConfig>,
  ): Transition<EarningsClusterState> {
    const state = cloneJson(previous);
    configSchema.parse(context.config);

    switch (event.type) {
      case "earnings.release.observed":
        requireSchemaVersion(event);
        return this.#releaseObserved(state, event, context);
      case "kernel.timer.fired":
        requireSchemaVersion(event);
        return this.#timerFired(state, event, context);
      case "kernel.job.succeeded":
        requireSchemaVersion(event);
        return this.#jobSucceeded(state, event);
      case "kernel.job.failed":
        requireSchemaVersion(event);
        return this.#jobFailed(state, event);
      default:
        return noEffects(
          state,
          decision("kernel.event.ignored", { eventId: event.eventId, eventType: event.type }),
        );
    }
  }

  #releaseObserved(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
    context: ReducerContext<EarningsClusterConfig>,
  ): Transition<EarningsClusterState> {
    const payload = releaseSchema.parse(event.payload);
    const knownRelease = state.releaseOutcomes[payload.releaseId];
    if (knownRelease !== undefined) {
      return noEffects(
        state,
        decision("earnings.release.duplicate", {
          releaseId: payload.releaseId,
          originalEventId: knownRelease.sourceEventId,
          duplicateEventId: event.eventId,
        }),
      );
    }

    const knownClusterId = state.clusterByKey[payload.clusterKey];
    if (knownClusterId === undefined) {
      const clusterId = canonicalHash("peas/earnings-cluster-id/v1", {
        clusterKey: payload.clusterKey,
        firstReleaseId: payload.releaseId,
      });
      const closesAtMs = context.nowMs + context.config.clusterWindowMs;
      if (!Number.isSafeInteger(closesAtMs)) throw new RangeError("Cluster deadline overflow");
      const release: ReleaseRecord = {
        releaseId: payload.releaseId,
        issuerId: payload.issuerId,
        fiscalPeriod: payload.fiscalPeriod,
        sourceEventId: event.eventId,
        logicalAtMs: context.nowMs,
      };
      state.clusters[clusterId] = {
        clusterId,
        clusterKey: payload.clusterKey,
        status: "open",
        openedAtMs: context.nowMs,
        closesAtMs,
        closedAtMs: null,
        releases: [release],
        analysis: null,
      };
      state.clusterByKey[payload.clusterKey] = clusterId;
      state.releaseOutcomes[payload.releaseId] = {
        outcome: "accepted",
        clusterId,
        sourceEventId: event.eventId,
      };
      return {
        state,
        decisions: [
          decision("earnings.cluster.opened", {
            clusterId,
            clusterKey: payload.clusterKey,
            closesAtMs,
          }),
        ],
        jobs: [
          {
            type: "earnings.cluster.close",
            dedupeKey: `close:${clusterId}`,
            notBeforeLogicalMs: closesAtMs,
            payload: { clusterId, scheduledForLogicalMs: closesAtMs },
          },
        ],
        outbox: [],
      };
    }

    const cluster = state.clusters[knownClusterId];
    if (cluster === undefined) throw new Error(`Missing cluster ${knownClusterId}`);
    if (cluster.status !== "open" || context.nowMs >= cluster.closesAtMs) {
      state.releaseOutcomes[payload.releaseId] = {
        outcome: "late",
        clusterId: cluster.clusterId,
        sourceEventId: event.eventId,
      };
      return noEffects(
        state,
        decision("earnings.release.late", {
          releaseId: payload.releaseId,
          clusterId: cluster.clusterId,
          closesAtMs: cluster.closesAtMs,
          observedAtLogicalMs: context.nowMs,
        }),
      );
    }

    cluster.releases.push({
      releaseId: payload.releaseId,
      issuerId: payload.issuerId,
      fiscalPeriod: payload.fiscalPeriod,
      sourceEventId: event.eventId,
      logicalAtMs: context.nowMs,
    });
    state.releaseOutcomes[payload.releaseId] = {
      outcome: "accepted",
      clusterId: cluster.clusterId,
      sourceEventId: event.eventId,
    };
    return noEffects(
      state,
      decision("earnings.release.joined", {
        releaseId: payload.releaseId,
        clusterId: cluster.clusterId,
        memberCount: cluster.releases.length,
      }),
    );
  }

  #timerFired(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
    context: ReducerContext<EarningsClusterConfig>,
  ): Transition<EarningsClusterState> {
    const payload = timerFiredSchema.parse(event.payload);
    const cluster = state.clusters[payload.clusterId];
    if (cluster === undefined) {
      return noEffects(
        state,
        decision("earnings.cluster.timer-orphaned", { clusterId: payload.clusterId }),
      );
    }
    if (payload.scheduledForLogicalMs !== cluster.closesAtMs) {
      throw new Error(`Timer deadline does not match cluster ${cluster.clusterId}`);
    }
    if (cluster.status === "closed") {
      return noEffects(
        state,
        decision("earnings.cluster.timer-duplicate", { clusterId: cluster.clusterId }),
      );
    }
    if (context.nowMs < cluster.closesAtMs) {
      return noEffects(
        state,
        decision("earnings.cluster.timer-early", {
          clusterId: cluster.clusterId,
          closesAtMs: cluster.closesAtMs,
          firedAtLogicalMs: context.nowMs,
        }),
      );
    }

    cluster.status = "closed";
    cluster.closedAtMs = context.nowMs;
    cluster.analysis = { status: "pending", result: null, errorCode: null };
    return {
      state,
      decisions: [
        decision("earnings.cluster.closed", {
          clusterId: cluster.clusterId,
          memberCount: cluster.releases.length,
          closedAtMs: context.nowMs,
        }),
      ],
      jobs: [
        {
          type: "earnings.cluster.analyze",
          dedupeKey: `analyze:${cluster.clusterId}`,
          notBeforeLogicalMs: context.nowMs,
          payload: { clusterId: cluster.clusterId },
        },
      ],
      outbox: [
        {
          topic: "earnings.cluster.closed",
          dedupeKey: `cluster-closed:${cluster.clusterId}`,
          payload: { clusterId: cluster.clusterId, memberCount: cluster.releases.length },
        },
      ],
    };
  }

  #jobSucceeded(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
  ): Transition<EarningsClusterState> {
    const payload = jobSucceededSchema.parse(event.payload);
    assertJson(payload.result);
    const cluster = state.clusters[payload.clusterId];
    if (cluster === undefined || cluster.status !== "closed" || cluster.analysis === null) {
      return noEffects(
        state,
        decision("earnings.cluster.analysis-orphaned", { clusterId: payload.clusterId }),
      );
    }
    if (cluster.analysis.status !== "pending") {
      return noEffects(
        state,
        decision("earnings.cluster.analysis-duplicate", { clusterId: cluster.clusterId }),
      );
    }

    cluster.analysis = { status: "succeeded", result: cloneJson(payload.result), errorCode: null };
    return {
      state,
      decisions: [
        decision("earnings.cluster.analysis-succeeded", { clusterId: cluster.clusterId }),
      ],
      jobs: [],
      outbox: [
        {
          topic: "earnings.cluster.analysis-completed",
          dedupeKey: `analysis-completed:${cluster.clusterId}`,
          payload: { clusterId: cluster.clusterId, result: cloneJson(payload.result) },
        },
      ],
    };
  }

  #jobFailed(
    state: EarningsClusterState,
    event: Readonly<StoredEvent>,
  ): Transition<EarningsClusterState> {
    const payload = jobFailedSchema.parse(event.payload);
    const cluster = state.clusters[payload.clusterId];
    if (cluster === undefined || cluster.status !== "closed" || cluster.analysis === null) {
      return noEffects(
        state,
        decision("earnings.cluster.analysis-orphaned", { clusterId: payload.clusterId }),
      );
    }
    if (cluster.analysis.status !== "pending") {
      return noEffects(
        state,
        decision("earnings.cluster.analysis-duplicate", { clusterId: cluster.clusterId }),
      );
    }

    cluster.analysis = { status: "failed", result: null, errorCode: payload.errorCode };
    return {
      state,
      decisions: [
        decision("earnings.cluster.analysis-failed", {
          clusterId: cluster.clusterId,
          errorCode: payload.errorCode,
        }),
      ],
      jobs: [],
      outbox: [],
    };
  }
}
