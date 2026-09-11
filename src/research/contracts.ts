import { isProxy } from "node:util/types";
import { z } from "zod";

import { canonicalHash } from "../core/hash.js";
import { inertJsonSnapshot, type JsonValue } from "../core/json.js";

const time = z.number().int().nonnegative().safe();
const id = z.string().min(1).max(256);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const horizonSchema = z.union([
  z.literal(5),
  z.literal(15),
  z.literal(30),
  z.literal(60),
  z.literal("close"),
  z.literal("next-session"),
]);
export const protocolSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceClass: z.literal("SYNTHETIC_VALIDATION"),
    epoch: id,
    featureVersion: z.literal("cutoff-v1"),
    labelVersion: z.literal("delayed-bars-v1"),
    hypotheses: z.tuple([z.literal("H1"), z.literal("H2")]),
    horizons: z.tuple([
      z.literal(5),
      z.literal(15),
      z.literal(30),
      z.literal(60),
      z.literal("close"),
      z.literal("next-session"),
    ]),
    variants: z
      .array(
        z
          .object({
            id,
            hypothesis: z.enum(["H1", "H2"]),
            direction: z.union([z.literal(1), z.literal(-1)]),
            thresholdBps: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    simultaneityMs: time,
    entryDelayMs: time.min(60000),
    spreadBps: z.number().finite().nonnegative(),
    slippageBps: z.number().finite().nonnegative(),
    feeBps: z.number().finite().nonnegative(),
    impactBps: z.number().finite().nonnegative(),
    benchmarkWeights: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    universe: z.array(id).min(1).max(100),
    excludedStatuses: z.array(z.literal("stopped")),
    repairEventsExcluded: z.literal(true),
    partitionBoundariesMs: z.tuple([time, time, time, time]),
    missingPolicy: z.literal("record-unavailable-no-imputation"),
    expectationsVersion: z.literal("unavailable-v1"),
    llmVersion: z.literal("disabled-v1"),
    uncertaintyMarginBps: z.number().finite().nonnegative(),
    capacity: z.literal("unknown"),
    environment: id,
    implementationVersion: z.literal("alpha-research-v1"),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      new Set(p.variants.map((v) => v.id)).size !== p.variants.length ||
      new Set(p.universe).size !== p.universe.length ||
      p.variants.some((v) => v.hypothesis === "H2" && v.thresholdBps !== 0) ||
      p.benchmarkWeights[0] + p.benchmarkWeights[1] !== 1 ||
      !Number.isFinite(2 * (p.spreadBps + p.slippageBps + p.feeBps + p.impactBps)) ||
      p.partitionBoundariesMs.some((t, i, a) => i > 0 && t <= (a[i - 1] ?? t))
    )
      ctx.addIssue({ code: "custom", message: "invalid-protocol-order-or-duplicates" });
  });
export type Protocol = z.infer<typeof protocolSchema>;
export type Horizon = z.infer<typeof horizonSchema>;

export const normalizedSchema = z
  .object({
    memberKey: digest,
    artifactDigest: digest,
    normalizedEventId: id,
    normalizedEventHash: digest,
    normalizerId: id,
    normalizedAtMs: time.nullable(),
    featureReadyAtMs: time.nullable(),
    // SEC civil strings are interpreted by the existing DST-aware SEC parser, never Date.parse.
    secAcceptanceEastern: z.string().nullable(),
    normalizedEvent: z.unknown(),
  })
  .strict();
export type NormalizedRecord = z.infer<typeof normalizedSchema>;

export const barSchema = z
  .object({
    instrumentId: id,
    endMs: time,
    availableAtMs: time.nullable(),
    close: z.number().finite().positive(),
    kind: z.literal("bar-one-minute-completed-close"),
  })
  .strict();
export const datasetSchema = z
  .object({
    version: id,
    evidenceClass: z.literal("SYNTHETIC_VALIDATION"),
    adjustmentPolicy: z.literal("synthetic-no-corporate-actions"),
    bars: z.array(barSchema).max(50000),
  })
  .strict();
export type Dataset = z.infer<typeof datasetSchema>;

export type OptionalFeatureBundle = Readonly<{
  kind: "expectations" | "llm";
  version: string;
  status: "unavailable" | "disabled";
  reason: string;
  inputArtifactDigests: readonly string[];
  cutoffMs: number;
  // Any future implementation must bind all of these, frozen before evaluation.
  provider: null;
  model: null;
  promptDigest: null;
  schemaDigest: null;
  decodingDigest: null;
  outputDigest: null;
}>;

export function json(value: unknown): JsonValue {
  // Kernel JSON intentionally permits integers only. Research decimals use an explicit,
  // reserved tagged representation, retaining round-trip IEEE-754 values without changing it.
  function encode(v: unknown): JsonValue {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("research-nonfinite-number");
      return Number.isSafeInteger(v) ? (Object.is(v, -0) ? 0 : v) : { $researchDecimal: String(v) };
    }
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v !== "object" || isProxy(v)) throw new Error("research-inert-json-required");
    if (Object.getOwnPropertySymbols(v).length !== 0 || Object.hasOwn(v, "$researchDecimal"))
      throw new Error("research-reserved-json-key");
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new Error("research-inert-json-required");
    const descriptors = Object.getOwnPropertyDescriptors(v);
    for (const d of Object.values(descriptors))
      if (!("value" in d)) throw new Error("research-accessor-rejected");
    if (Array.isArray(v))
      return Array.from({ length: v.length }, (_, i) => encode(descriptors[String(i)]?.value));
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, d]) => [key, encode(d.value)]),
    );
  }
  return inertJsonSnapshot(encode(value));
}
export function parseResearchJson(serialized: string): unknown {
  return JSON.parse(serialized, (_key: string, value: unknown) => {
    if (value !== null && typeof value === "object" && Object.hasOwn(value, "$researchDecimal")) {
      const token = (value as { $researchDecimal: string }).$researchDecimal;
      const number = Number(token);
      if (!Number.isFinite(number) || String(number) !== token || Object.keys(value).length !== 1)
        throw new Error("research-decimal-invalid");
      return number;
    }
    return value;
  });
}
export function identity(kind: string, value: unknown): string {
  return canonicalHash(`peas/research/${kind}/v1`, json(value));
}
export function freeze<T>(value: T): T {
  const copy = parseResearchJson(JSON.stringify(json(value))) as T;
  function deep(v: unknown): void {
    if (v !== null && typeof v === "object") {
      for (const child of Object.values(v)) deep(child);
      Object.freeze(v);
    }
  }
  deep(copy);
  return copy;
}

export function parseProtocol(input: unknown): Protocol {
  return freeze(protocolSchema.parse(freeze(input)));
}
