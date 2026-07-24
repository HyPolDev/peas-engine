import { Buffer } from "node:buffer";

import {
  CANONICAL_BOUND_IDS,
  type CanonicalBoundIdV1,
  type CanonicalMarketReasonV1,
  EXTENDED_QUOTE_AGE_NS,
  MARKET_BOUNDS,
  type MarketBoundIdV1,
  MarketContractError,
  marketReason,
  REGULAR_QUOTE_AGE_NS,
} from "./contracts.js";

export const CORE_OWNED_BOUND_IDS = Object.freeze([
  "timestampTextBytes",
  "conditionMembers",
  "conditionMemberBytes",
  "rawDecimalTokenBytes",
  "rawDecimalScale",
  "primaryCoefficientDigits",
  "primarySourceScale",
  "derivedMidpointScale",
  "rationalComponentBytes",
  "providersPerSelectionPolicy",
  "marketCentersPerInstrumentState",
  "revisionDepthPerFamily",
  "deliveriesPerProviderObservation",
  "candidatesPerReferenceSelection",
  "primaryResidualTargets",
  "primaryResidualHorizonNs",
  "regularQuoteAgeNs",
  "extendedQuoteAgeNs",
  "barDurationNs",
  "captureRetrievalLagMs",
] as const satisfies readonly CanonicalBoundIdV1[]);

export const STUDY_OWNED_BOUND_IDS = Object.freeze(
  CANONICAL_BOUND_IDS.slice(CANONICAL_BOUND_IDS.indexOf("targetClusters")),
);

export const LOADER_OWNED_BOUND_IDS = Object.freeze(
  CANONICAL_BOUND_IDS.filter(
    (boundId) =>
      !CORE_OWNED_BOUND_IDS.includes(boundId as (typeof CORE_OWNED_BOUND_IDS)[number]) &&
      !STUDY_OWNED_BOUND_IDS.includes(boundId),
  ),
);

if (
  new Set([...CORE_OWNED_BOUND_IDS, ...LOADER_OWNED_BOUND_IDS, ...STUDY_OWNED_BOUND_IDS]).size !==
  CANONICAL_BOUND_IDS.length
) {
  throw new Error("bound ownership must partition all 84 canonical bounds");
}

function boundExceeded(boundId: MarketBoundIdV1): never {
  throw new MarketContractError(marketReason("market.bound-exceeded", { limitKind: boundId }));
}

export function validateTimestampTextBound(value: string): void {
  if (Buffer.byteLength(value, "ascii") > 64) boundExceeded("timestampTextBytes");
}

export function validateConditionMembers(codes: readonly string[]): readonly string[] {
  if (codes.length > MARKET_BOUNDS.conditionMembers) boundExceeded("conditionMembers");
  const snapshot = [...codes];
  for (const code of snapshot) {
    if (Buffer.byteLength(code, "ascii") > MARKET_BOUNDS.conditionMemberBytes) {
      boundExceeded("conditionMemberBytes");
    }
    if (!/^[\x20-\x7e]*$/u.test(code)) {
      throw new MarketContractError(marketReason("market.input-invalid"));
    }
  }
  if (new Set(snapshot).size !== snapshot.length) {
    throw new MarketContractError(marketReason("market.input-invalid"));
  }
  return Object.freeze(snapshot);
}

export function validateRawDecimalTokenBound(value: string): void {
  if (Buffer.byteLength(value, "ascii") > MARKET_BOUNDS.rawDecimalTokenBytes) {
    boundExceeded("rawDecimalTokenBytes");
  }
}

export function validateProviderDecimalEvidenceToken(value: string): void {
  validateRawDecimalTokenBound(value);
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) {
    throw new MarketContractError(marketReason("market.decimal-invalid"));
  }
  const scale = value.includes(".") ? (value.split(".")[1]?.length ?? 0) : 0;
  if (scale > 12) throw new MarketContractError(marketReason("market.decimal-invalid"));
}

export function validatePrimaryDecimalShape(coefficientDigits: number, scale: number): void {
  if (
    coefficientDigits > MARKET_BOUNDS.primaryCoefficientDigits ||
    scale > MARKET_BOUNDS.primarySourceScale
  ) {
    throw new MarketContractError(marketReason("market.decimal-invalid"));
  }
}

export function validateDerivedMidpointScale(scale: number): void {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 7) {
    throw new MarketContractError(marketReason("market.decimal-invalid"));
  }
}

export function validateRationalComponentBytes(numerator: string, denominator: string): void {
  if (Buffer.byteLength(numerator, "ascii") > 32 || Buffer.byteLength(denominator, "ascii") > 32) {
    throw new MarketContractError(marketReason("market.decimal-invalid"));
  }
}

export function validateProviderCount(count: number): void {
  if (count > MARKET_BOUNDS.providersPerSelectionPolicy) {
    boundExceeded("providersPerSelectionPolicy");
  }
}

export function validateMarketCenterStateCount(count: number): void {
  if (count > 64) boundExceeded("marketCentersPerInstrumentState");
}

export function validateRevisionDepth(count: number): void {
  if (count > MARKET_BOUNDS.revisionDepthPerFamily) boundExceeded("revisionDepthPerFamily");
}

export function validateDeliveryCount(count: number): void {
  if (count > MARKET_BOUNDS.deliveriesPerProviderObservation) {
    boundExceeded("deliveriesPerProviderObservation");
  }
}

export function validateCandidateCount(count: number): void {
  if (count > MARKET_BOUNDS.candidatesPerReferenceSelection) {
    boundExceeded("candidatesPerReferenceSelection");
  }
}

export function validatePrimaryResidualConfiguration(
  targets: readonly string[],
  horizonNs: bigint,
): void {
  const expected = ["T0", "T1", "T5", "T30"];
  if (
    targets.length > expected.length ||
    targets.some((target, index) => target !== expected[index])
  ) {
    if (targets.length > expected.length) boundExceeded("primaryResidualTargets");
    throw new MarketContractError(marketReason("market.input-invalid"));
  }
  if (targets.length !== expected.length) {
    throw new MarketContractError(marketReason("market.input-invalid"));
  }
  if (horizonNs > 1_800_000_000_000n) boundExceeded("primaryResidualHorizonNs");
  if (horizonNs !== 1_800_000_000_000n) {
    throw new MarketContractError(marketReason("market.input-invalid"));
  }
}

export function validateQuoteAge(session: "regular" | "extended", ageNs: bigint): void {
  const reason = classifyQuoteAge(session, ageNs);
  if (reason !== null) throw new MarketContractError(reason);
}

export function classifyQuoteAge(
  session: "regular" | "extended",
  ageNs: bigint,
): CanonicalMarketReasonV1 | null {
  const maximum = session === "regular" ? REGULAR_QUOTE_AGE_NS : EXTENDED_QUOTE_AGE_NS;
  return ageNs > maximum ? marketReason("market.quote-stale") : null;
}

export function validateBarDuration(durationNs: bigint): void {
  if (durationNs !== 60_000_000_000n) {
    throw new MarketContractError(marketReason("market.input-invalid"));
  }
}

export function validateCaptureRetrievalLag(captureAtMs: number, retrievedAtMs: number): void {
  const lag = Math.abs(captureAtMs - retrievedAtMs);
  if (lag > 600_000) {
    throw new MarketContractError(
      marketReason("market.timestamp-insufficient", {
        timestampFailureKind: "capture-retrieval-lag-exceeded",
      }),
    );
  }
}
