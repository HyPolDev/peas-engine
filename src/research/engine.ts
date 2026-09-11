import { EVENT_CLUSTER_EFFECTS_ZERO } from "../domain/event-cluster-beta.js";
import {
  freeze,
  type Horizon,
  identity,
  type OptionalFeatureBundle,
  type Protocol,
  parseProtocol,
} from "./contracts.js";
import {
  type FrozenInput,
  freezeResearchInput,
  type ResearchInput,
  researchMemberKey,
} from "./snapshot.js";

export type Manifest = Readonly<{ id: string; protocol: Protocol; inputs: readonly FrozenInput[] }>;
export type Partition = "train" | "validation" | "untouched-test" | "excluded";
export type Feature = Readonly<{
  id: string;
  inputId: string;
  cutoffMs: number;
  decisionMs: number;
  version: string;
  partition: Partition;
  exclusion: string | null;
  initialReactionBps: number | null;
  sourceOrder: "SEC_FIRST" | "ISSUER_IR_FIRST" | "NEAR_SIMULTANEOUS" | null;
  dependencies: readonly {
    memberKey: string;
    artifactDigest: string;
    publicationMs: number | null;
    observedMs: number;
    retrievedMs: number;
    normalizedMs: number | null;
    readyMs: number | null;
    available: boolean;
    reason: string | null;
  }[];
  missing: readonly string[];
  expectations: OptionalFeatureBundle;
  llm: OptionalFeatureBundle;
}>;
export type Label = Readonly<{
  id: string;
  inputId: string;
  featureId: string;
  horizon: Horizon;
  version: string;
  datasetId: string;
  entryMs: number;
  exitMs: number;
  status: "available" | "missing" | "purged" | "excluded";
  reason: string | null;
  grossBps: number | null;
  benchmarkBps: number | null;
  abnormalBps: number | null;
  roundTripCostBps: number;
  netLongBps: number | null;
}>;
export type Trial = Readonly<{
  id: string;
  manifestId: string;
  variantId: string;
  featureId: string;
  labelId: string;
  partition: Partition;
  status: "completed" | "failed";
  reason: string | null;
  direction: number | null;
  grossBps: number | null;
  netBps: number | null;
}>;
export type Signal = Readonly<{
  id: string;
  manifestId: string;
  variantId: string;
  horizon: Horizon;
  partition: Partition;
  evidenceClass: "SYNTHETIC_VALIDATION";
  decision: "NO_TRADE";
  attempted: number;
  completed: number;
  failed: number;
  grossDistributionBps: readonly number[];
  netDistributionBps: readonly number[];
  uncertainty: "synthetic-not-estimable";
  capacity: "unknown";
  reason: string;
  entryDelayMs: number;
  roundTripCostBps: number;
  uncertaintyMarginBps: number;
  prohibitedEffects: typeof EVENT_CLUSTER_EFFECTS_ZERO;
}>;
export type Evaluation = Readonly<{
  features: readonly Feature[];
  labels: readonly Label[];
  trials: readonly Trial[];
  signals: readonly Signal[];
  id: string;
}>;

export function freezeManifest(
  rawProtocol: unknown,
  rawInputs: readonly ResearchInput[],
): Manifest {
  const protocol = parseProtocol(rawProtocol);
  if (rawInputs.length < 1 || rawInputs.length > 500) throw new Error("research-cohort-bound");
  const inputs = rawInputs
    .map(freezeResearchInput)
    .sort((a, b) => a.decisionMs - b.decisionMs || a.id.localeCompare(b.id));
  // One issuer-event can never straddle partitions through another revision or decision.
  if (
    new Set(inputs.map((i) => `${i.plan.candidate.issuerId}:${i.plan.candidate.fiscalPeriod}`))
      .size !== inputs.length
  )
    throw new Error("research-duplicate-issuer-event");
  const body = { protocol, inputs };
  return freeze({ ...body, id: identity("manifest", body) });
}

function partition(
  p: Protocol,
  input: FrozenInput,
): { name: Partition; endMs: number; reason: string | null } {
  if (!p.universe.includes(input.plan.candidate.ticker))
    return { name: "excluded", endMs: 0, reason: "outside-universe" };
  if (input.repairEvent || p.excludedStatuses.some((s) => s === input.cluster.status))
    return {
      name: "excluded",
      endMs: 0,
      reason: input.repairEvent ? "operational-repair" : "stopped-cluster",
    };
  const names = ["train", "validation", "untouched-test"] as const;
  for (const [index, name] of names.entries()) {
    const start = p.partitionBoundariesMs[index];
    const endMs = p.partitionBoundariesMs[index + 1];
    if (
      start !== undefined &&
      endMs !== undefined &&
      input.decisionMs >= start &&
      input.decisionMs < endMs
    )
      return { name, endMs, reason: null };
  }
  return { name: "excluded", endMs: 0, reason: "outside-partitions" };
}

function price(
  input: FrozenInput,
  instrumentId: string,
  atMs: number,
  cutoffMs?: number,
): number | null {
  const bar = input.dataset.bars.find((b) => b.instrumentId === instrumentId && b.endMs === atMs);
  if (
    bar === undefined ||
    bar.availableAtMs === null ||
    (cutoffMs !== undefined && (bar.endMs > cutoffMs || bar.availableAtMs > cutoffMs))
  )
    return null;
  return bar.close;
}
function returns(
  input: FrozenInput,
  startMs: number,
  endMs: number,
  cutoffMs?: number,
): number[] | null {
  const result: number[] = [];
  for (const instrument of [
    input.plan.candidate.instrumentId,
    "SPY",
    input.plan.candidate.sectorBenchmark,
  ]) {
    const start = price(input, instrument, startMs, cutoffMs);
    const end = price(input, instrument, endMs, cutoffMs);
    if (start === null || end === null) return null;
    const bps = (end / start - 1) * 10000;
    if (!Number.isFinite(bps)) throw new Error("research-nonfinite-return");
    result.push(bps);
  }
  return result;
}
function benchmark(p: Protocol, r: number[]): number {
  return (r[1] ?? 0) * p.benchmarkWeights[0] + (r[2] ?? 0) * p.benchmarkWeights[1];
}
function cost(p: Protocol): number {
  return 2 * (p.spreadBps + p.slippageBps + p.feeBps + p.impactBps);
}
function optional(
  kind: "expectations" | "llm",
  input: FrozenInput,
  version: string,
): OptionalFeatureBundle {
  return {
    kind,
    version,
    status: kind === "llm" ? "disabled" : "unavailable",
    reason: "separately-gated-no-imputation",
    inputArtifactDigests: [],
    cutoffMs: input.cutoffMs,
    provider: null,
    model: null,
    promptDigest: null,
    schemaDigest: null,
    decodingDigest: null,
    outputDigest: null,
  };
}

function feature(p: Protocol, input: FrozenInput): Feature {
  const split = partition(p, input);
  const dependencies = input.cluster.members.map((m) => {
    const memberKey = researchMemberKey(m);
    const r = input.records.find((r) => r.memberKey === memberKey);
    const normalizedMs = r?.normalizedAtMs ?? null;
    const readyMs = r?.featureReadyAtMs ?? null;
    const clocks = [
      m.publicationOrAcceptanceAtMs,
      m.firstObservedAtMs,
      m.retrievedAtMs,
      normalizedMs,
      readyMs,
    ];
    let reason: string | null = null;
    if (clocks.some((c) => c === null)) reason = "missing-availability-clock";
    else if (clocks.some((c) => c !== null && c > input.cutoffMs)) reason = "future-information";
    else if (
      m.retrievedAtMs < m.firstObservedAtMs ||
      (normalizedMs ?? 0) < m.retrievedAtMs ||
      (readyMs ?? 0) < (normalizedMs ?? 0)
    )
      reason = "availability-clock-order";
    return {
      memberKey,
      artifactDigest: m.artifactDigest,
      publicationMs: m.publicationOrAcceptanceAtMs,
      observedMs: m.firstObservedAtMs,
      retrievedMs: m.retrievedAtMs,
      normalizedMs,
      readyMs,
      available: reason === null,
      reason,
    };
  });
  const usableTime = (lane: "sec" | "issuer-ir"): number | null => {
    const times = input.cluster.members
      .filter((m) => m.lane === lane)
      .flatMap((m) => {
        const dep = dependencies.find((d) => d.memberKey === researchMemberKey(m));
        return dep?.available && dep.readyMs !== null
          ? [Math.max(dep.observedMs, dep.retrievedMs, dep.readyMs)]
          : [];
      });
    return times.length === 0 ? null : Math.min(...times);
  };
  const sec = usableTime("sec");
  const ir = usableTime("issuer-ir");
  const sourceOrder: Feature["sourceOrder"] =
    sec === null || ir === null
      ? null
      : Math.abs(sec - ir) <= p.simultaneityMs
        ? "NEAR_SIMULTANEOUS"
        : sec < ir
          ? "SEC_FIRST"
          : "ISSUER_IR_FIRST";
  const r = returns(input, input.initialStartMs, input.cutoffMs, input.cutoffMs);
  const initialReactionBps = r === null ? null : (r[0] ?? 0) - benchmark(p, r);
  const missing = [
    ...dependencies.filter((d) => !d.available).map((d) => `${d.artifactDigest}:${d.reason}`),
    ...input.cluster.lanes
      .filter((l) => l.status !== "observed")
      .map((l) => `lane:${l.lane}:${l.status}`),
    "expectations:unavailable",
    "llm:disabled",
    "liquidity:unavailable",
    "volatility:unavailable",
    "source-disagreement:unavailable",
  ];
  if (sourceOrder === null) missing.push("source-order:unavailable");
  if (r === null) missing.push("initial-market:unavailable");
  const body = {
    inputId: input.id,
    cutoffMs: input.cutoffMs,
    decisionMs: input.decisionMs,
    version: p.featureVersion,
    partition: split.name,
    exclusion: split.reason,
    initialReactionBps,
    sourceOrder,
    dependencies,
    missing,
    expectations: optional("expectations", input, p.expectationsVersion),
    llm: optional("llm", input, p.llmVersion),
  };
  return freeze({ ...body, id: identity("feature", body) });
}

function label(p: Protocol, input: FrozenInput, f: Feature, horizon: Horizon): Label {
  // Completed minute close at or AFTER the frozen delay. No nearest/stale/future substitution.
  const entryMs = Math.ceil((input.decisionMs + p.entryDelayMs) / 60000) * 60000;
  const exitMs =
    typeof horizon === "number"
      ? input.decisionMs + horizon * 60000
      : horizon === "close"
        ? input.closeMs
        : input.nextSessionMs;
  const split = partition(p, input);
  let status: Label["status"] = "available";
  let reason: string | null = null;
  if (split.name === "excluded") {
    status = "excluded";
    reason = split.reason;
  } else if (
    exitMs >= split.endMs ||
    entryMs >= split.endMs ||
    input.initialStartMs <
      (p.partitionBoundariesMs[["train", "validation", "untouched-test"].indexOf(split.name)] ?? 0)
  ) {
    status = "purged";
    reason = "partition-overlap";
  } else if (entryMs >= exitMs) {
    status = "missing";
    reason = "entry-after-horizon";
  }
  const r = status === "available" ? returns(input, entryMs, exitMs) : null;
  if (status === "available" && r === null) {
    status = "missing";
    reason = "missing-market-or-availability";
  }
  const grossBps = r?.[0] ?? null;
  const benchmarkBps = r === null ? null : benchmark(p, r);
  const abnormalBps = grossBps === null || benchmarkBps === null ? null : grossBps - benchmarkBps;
  const body = {
    inputId: input.id,
    featureId: f.id,
    horizon,
    version: p.labelVersion,
    datasetId: identity("dataset", input.dataset),
    entryMs,
    exitMs,
    status,
    reason,
    grossBps,
    benchmarkBps,
    abnormalBps,
    roundTripCostBps: cost(p),
    netLongBps: abnormalBps === null ? null : abnormalBps - cost(p),
  };
  return freeze({ ...body, id: identity("label", body) });
}

/** Pure replay; the durable registry requires a prior manifest commit before exposing results. */
export function evaluateManifest(raw: Manifest): Evaluation {
  const manifest = freezeManifest(raw.protocol, raw.inputs);
  if (manifest.id !== raw.id) throw new Error("research-manifest-tampered");
  const p = manifest.protocol;
  const features: Feature[] = [],
    labels: Label[] = [],
    trials: Trial[] = [],
    signals: Signal[] = [];
  for (const input of manifest.inputs) {
    const f = feature(p, input);
    features.push(f);
    for (const horizon of p.horizons) {
      const l = label(p, input, f, horizon);
      labels.push(l);
      for (const v of p.variants) {
        let reason = l.reason;
        let direction: number | null = null;
        if (v.hypothesis === "H1") {
          if (f.initialReactionBps === null) reason ??= "missing-H1-feature";
          else if (Math.abs(f.initialReactionBps) <= v.thresholdBps) reason ??= "threshold-not-met";
          else direction = Math.sign(f.initialReactionBps) * v.direction;
        } else {
          if (f.sourceOrder === null) reason ??= "missing-H2-feature";
          else if (f.sourceOrder === "NEAR_SIMULTANEOUS") reason ??= "simultaneous-no-direction";
          else direction = (f.sourceOrder === "SEC_FIRST" ? 1 : -1) * v.direction;
        }
        const grossBps =
          reason === null && direction !== null && l.abnormalBps !== null
            ? direction * l.abnormalBps
            : null;
        const body = {
          manifestId: manifest.id,
          variantId: v.id,
          featureId: f.id,
          labelId: l.id,
          partition: f.partition,
          status: grossBps === null ? ("failed" as const) : ("completed" as const),
          reason,
          direction,
          grossBps,
          netBps: grossBps === null ? null : grossBps - l.roundTripCostBps,
        };
        trials.push(freeze({ ...body, id: identity("trial", body) }));
      }
    }
  }
  for (const v of p.variants)
    for (const horizon of p.horizons)
      for (const part of ["train", "validation", "untouched-test", "excluded"] as const) {
        const selected = trials.filter(
          (t) =>
            t.variantId === v.id &&
            t.partition === part &&
            labels.find((l) => l.id === t.labelId)?.horizon === horizon,
        );
        const grossDistributionBps = selected.flatMap((t) =>
          t.grossBps === null ? [] : [t.grossBps],
        );
        const netDistributionBps = selected.flatMap((t) => (t.netBps === null ? [] : [t.netBps]));
        const body = {
          manifestId: manifest.id,
          variantId: v.id,
          horizon,
          partition: part,
          evidenceClass: "SYNTHETIC_VALIDATION" as const,
          decision: "NO_TRADE" as const,
          attempted: selected.length,
          completed: netDistributionBps.length,
          failed: selected.length - netDistributionBps.length,
          grossDistributionBps,
          netDistributionBps,
          uncertainty: "synthetic-not-estimable" as const,
          capacity: "unknown" as const,
          reason: "synthetic-correctness-only-no-alpha-promotion",
          entryDelayMs: p.entryDelayMs,
          roundTripCostBps: cost(p),
          uncertaintyMarginBps: p.uncertaintyMarginBps,
          prohibitedEffects: EVENT_CLUSTER_EFFECTS_ZERO,
        };
        signals.push(freeze({ ...body, id: identity("signal", body) }));
      }
  const body = { features, labels, trials, signals };
  return freeze({ ...body, id: identity("evaluation", body) });
}
