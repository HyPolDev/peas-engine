import { createHash } from "node:crypto";

import {
  assertJsonWithinLimits,
  canonicalJson,
  cloneJson,
  type JsonLimits,
  type JsonValue,
} from "../../core/json.js";
import { snapshotExactNormalizerInput } from "../normalizer-input.js";
import {
  validateBarDuration,
  validateDerivedMidpointScale,
  validatePrimaryDecimalShape,
  validateRationalComponentBytes,
  validateRawDecimalTokenBound,
  validateTimestampTextBound,
} from "./bounds.js";
import {
  type BarPayloadV1,
  type CanonicalDecimalV1,
  type CanonicalRationalV1,
  MARKET_BOUNDS,
  MarketContractError,
  type MarketPayloadV1,
  type MarketTimestampV1,
  marketReason,
  type NormalizedMarketFactV1,
  type RecordedMarketRecordV1,
  SIGNED_NS_MAX,
  SIGNED_NS_MIN,
} from "./contracts.js";
import {
  deriveDeliveryId,
  deriveDurableRevisionEvidenceHash,
  deriveMarketFactId,
  deriveNormalizedMarketFactId,
  deriveProviderObservationId,
  deriveRevisionFamilyId,
  deriveRevisionId,
  validateMarketSource,
} from "./identity.js";

const RECORD_LIMITS = Object.freeze({
  maxDepth: MARKET_BOUNDS.sidecarDepth,
  maxNodes: MARKET_BOUNDS.sidecarNodes,
  maxArrayLength: MARKET_BOUNDS.sidecarGenericArrayItems,
  maxObjectKeys: MARKET_BOUNDS.sidecarKeysPerObject,
  maxStringBytes: 1_024,
  maxCanonicalBytes: 65_536,
}) satisfies JsonLimits;

const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_INTEGER = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u;
const ID = /^[a-z][a-z0-9]*1_[0-9a-f]{64}$/u;

export function deriveCanonicalProviderPayloadDigest(payload: MarketPayloadV1 | null): string {
  return createHash("sha256")
    .update(canonicalJson(payload as unknown as JsonValue), "utf8")
    .digest("hex");
}

function fail(
  code: "market.input-invalid" | "market.decimal-invalid" | "market.timestamp-invalid",
): never {
  throw new MarketContractError(marketReason(code));
}

function parseSignedInteger(value: string, timestamp = false): bigint {
  if (typeof value === "string" && timestamp) validateTimestampTextBound(value);
  if (typeof value !== "string" || !SIGNED_INTEGER.test(value)) {
    fail(timestamp ? "market.timestamp-invalid" : "market.decimal-invalid");
  }
  try {
    return BigInt(value);
  } catch {
    fail(timestamp ? "market.timestamp-invalid" : "market.decimal-invalid");
  }
}

export function parseEpochNanoseconds(value: string): bigint {
  const parsed = parseSignedInteger(value, true);
  if (parsed < SIGNED_NS_MIN || parsed > SIGNED_NS_MAX) fail("market.timestamp-invalid");
  return parsed;
}

export function validateMarketTimestamp(value: MarketTimestampV1): MarketTimestampV1 {
  parseEpochNanoseconds(value.epochNs);
  const precision = parseSignedInteger(value.precisionNs, true);
  if (
    precision <= 0n ||
    precision > 1_000_000_000n ||
    ![
      "participant-publication",
      "member-execution",
      "sip-publication",
      "provider-documented-event",
      "provider-receive",
      "earnings-publication",
      "peas-retrieval",
      "peas-durable-capture",
      "correction-effective",
      "correction-arrival",
      "bar-start",
      "bar-end",
      "calendar-boundary",
      "replay-preserved",
    ].includes(value.semantic)
  ) {
    fail("market.timestamp-invalid");
  }
  return Object.freeze({ ...value });
}

export function canonicalDecimalFromToken(value: string): CanonicalDecimalV1 {
  if (typeof value === "string") validateRawDecimalTokenBound(value);
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) {
    fail("market.decimal-invalid");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart = "", fractionalPart = ""] = unsigned.split(".");
  const trimmedFraction = fractionalPart.replace(/0+$/u, "");
  const coefficient = `${integerPart}${trimmedFraction}`.replace(/^0+(?=\d)/u, "");
  if (coefficient === "0") return Object.freeze({ coefficient: "0", scale: 0, negative: false });
  return validateCanonicalDecimal({
    coefficient,
    scale: trimmedFraction.length,
    negative,
  });
}

export function validateCanonicalDecimal(value: CanonicalDecimalV1): CanonicalDecimalV1 {
  if (typeof value.coefficient === "string" && typeof value.scale === "number") {
    validatePrimaryDecimalShape(value.coefficient.length, value.scale);
  }
  if (
    !CANONICAL_INTEGER.test(value.coefficient) ||
    !Number.isSafeInteger(value.scale) ||
    value.scale < 0 ||
    typeof value.negative !== "boolean" ||
    (value.coefficient === "0" && (value.scale !== 0 || value.negative)) ||
    (value.scale > 0 && value.coefficient.endsWith("0"))
  ) {
    fail("market.decimal-invalid");
  }
  return Object.freeze({ ...value });
}

export function requirePositiveDecimal(value: CanonicalDecimalV1): CanonicalDecimalV1 {
  const valid = validateCanonicalDecimal(value);
  if (valid.negative || valid.coefficient === "0") fail("market.decimal-invalid");
  return valid;
}

function decimalSignedCoefficient(value: CanonicalDecimalV1, scale: number): bigint {
  const coefficient = BigInt(value.coefficient) * 10n ** BigInt(scale - value.scale);
  return value.negative ? -coefficient : coefficient;
}

export function compareCanonicalDecimals(
  left: CanonicalDecimalV1,
  right: CanonicalDecimalV1,
): number {
  const lhs = validateCanonicalDecimal(left);
  const rhs = validateCanonicalDecimal(right);
  const scale = Math.max(lhs.scale, rhs.scale);
  const a = decimalSignedCoefficient(lhs, scale);
  const b = decimalSignedCoefficient(rhs, scale);
  return a < b ? -1 : a > b ? 1 : 0;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export function reduceRational(numerator: bigint, denominator: bigint): CanonicalRationalV1 {
  if (denominator === 0n) {
    throw new MarketContractError(marketReason("market.division-by-zero"));
  }
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  const reducedNumerator = ((numerator / divisor) * sign).toString();
  const reducedDenominator = ((denominator / divisor) * sign).toString();
  validateRationalComponentBytes(reducedNumerator, reducedDenominator);
  return Object.freeze({
    numerator: reducedNumerator,
    denominator: reducedDenominator,
  });
}

export function quoteMidpoint(
  payload: Extract<MarketPayloadV1, { kind: "quote" }>,
): CanonicalRationalV1 {
  const bid = requirePositiveDecimal(payload.bidPrice);
  const ask = requirePositiveDecimal(payload.askPrice);
  const scale = Math.max(bid.scale, ask.scale);
  validateDerivedMidpointScale(scale + 1);
  return reduceRational(
    decimalSignedCoefficient(bid, scale) + decimalSignedCoefficient(ask, scale),
    2n * 10n ** BigInt(scale),
  );
}

function positiveRationalComponents(
  value: CanonicalRationalV1,
): readonly [numerator: bigint, denominator: bigint] {
  if (
    !CANONICAL_INTEGER.test(value.numerator) ||
    !CANONICAL_INTEGER.test(value.denominator) ||
    value.numerator === "0" ||
    value.denominator === "0"
  ) {
    fail("market.decimal-invalid");
  }
  validateRationalComponentBytes(value.numerator, value.denominator);
  return [BigInt(value.numerator), BigInt(value.denominator)];
}

export function exactSplitAdjustedSensitivity(
  preActionPrice: CanonicalDecimalV1,
  newSharesPerOldShare: CanonicalRationalV1,
): CanonicalRationalV1 {
  const price = requirePositiveDecimal(preActionPrice);
  const [newShares, oldShares] = positiveRationalComponents(newSharesPerOldShare);
  const signedPrice = decimalSignedCoefficient(price, price.scale);
  return reduceRational(signedPrice * oldShares, 10n ** BigInt(price.scale) * newShares);
}

export function exactCashDistributionAdjustedSensitivity(
  preActionPrice: CanonicalDecimalV1,
  cashPerShare: CanonicalDecimalV1,
): CanonicalRationalV1 {
  const price = requirePositiveDecimal(preActionPrice);
  const cash = requirePositiveDecimal(cashPerShare);
  const scale = Math.max(price.scale, cash.scale);
  const adjusted = decimalSignedCoefficient(price, scale) - decimalSignedCoefficient(cash, scale);
  if (adjusted <= 0n) fail("market.decimal-invalid");
  return reduceRational(adjusted, 10n ** BigInt(scale));
}

export function exactReturn(
  origin: CanonicalDecimalV1 | CanonicalRationalV1,
  destination: CanonicalDecimalV1 | CanonicalRationalV1,
): CanonicalRationalV1 {
  const toFraction = (
    value: CanonicalDecimalV1 | CanonicalRationalV1,
  ): readonly [bigint, bigint] => {
    if ("coefficient" in value) {
      const decimal = requirePositiveDecimal(value);
      return [decimalSignedCoefficient(decimal, decimal.scale), 10n ** BigInt(decimal.scale)];
    }
    return [BigInt(value.numerator), BigInt(value.denominator)];
  };
  const [aNumerator, aDenominator] = toFraction(origin);
  const [bNumerator, bDenominator] = toFraction(destination);
  if (aNumerator <= 0n || aDenominator <= 0n || bNumerator <= 0n || bDenominator <= 0n) {
    fail("market.decimal-invalid");
  }
  return reduceRational(
    bNumerator * aDenominator - aNumerator * bDenominator,
    bDenominator * aNumerator,
  );
}

function validatePayload(
  payload: MarketPayloadV1,
  eventKind: RecordedMarketRecordV1["eventKind"],
): MarketPayloadV1 {
  if (payload.kind === "quote") {
    if (eventKind !== "quote") fail("market.input-invalid");
    validateCanonicalDecimal(payload.bidPrice);
    validateCanonicalDecimal(payload.askPrice);
    validateCanonicalDecimal(payload.bidSize);
    validateCanonicalDecimal(payload.askSize);
  } else if (payload.kind === "trade") {
    if (eventKind !== "trade") fail("market.input-invalid");
    requirePositiveDecimal(payload.price);
    requirePositiveDecimal(payload.size);
  } else if (payload.kind === "bar") {
    if (eventKind !== "bar") fail("market.input-invalid");
    validateBar(payload);
  } else if (payload.kind === "prior-close") {
    if (
      eventKind !== "prior-close" &&
      eventKind !== "official-close" &&
      eventKind !== "corrected-close"
    ) {
      fail("market.input-invalid");
    }
    requirePositiveDecimal(payload.price);
  } else if (payload.kind === "official-value") {
    if (eventKind !== "official-open") fail("market.input-invalid");
    requirePositiveDecimal(payload.price);
  } else if (payload.kind === "trading-action") {
    if (eventKind !== "trading-action") fail("market.input-invalid");
  } else if (payload.kind === "luld") {
    if (eventKind !== "luld") fail("market.input-invalid");
  } else if (payload.kind === "corporate-action") {
    if (eventKind !== "corporate-action") fail("market.input-invalid");
  }
  return payload;
}

function validateBar(payload: BarPayloadV1): void {
  requirePositiveDecimal(payload.close);
  const start = parseEpochNanoseconds(payload.barStartNs);
  const end = parseEpochNanoseconds(payload.barEndNs);
  if (payload.barKind === "one-minute") validateBarDuration(end - start);
  if (payload.barKind === "daily" && end <= start) {
    fail("market.input-invalid");
  }
  if (payload.adjustmentMode === "unknown") {
    throw new MarketContractError(marketReason("market.adjustment-unknown"));
  }
}

function snapshotRecord(value: RecordedMarketRecordV1): RecordedMarketRecordV1 {
  try {
    assertJsonWithinLimits(value, RECORD_LIMITS, "$.recordedMarketRecord");
    const outer = snapshotExactNormalizerInput(value, [
      "source",
      "instrumentId",
      "venueTapeId",
      "providerRecordKey",
      "providerRevisionKey",
      "providerStableRecordFamily",
      "eventKind",
      "eventTime",
      "providerSequence",
      "sequenceSessionDate",
      "canonicalProviderPayloadDigest",
      "marketAcquisitionId",
      "rawArtifactId",
      "memberKey",
      "occurrenceOrdinal",
      "revisionKind",
      "supersedesRevisionId",
      "effectiveEventTime",
      "sessionKind",
      "currency",
      "payload",
      "normalizerVersion",
      "conditionPolicyVersion",
      "calendarVersion",
      "parserContractVersion",
      "durablyRecordedAtMs",
      "durableLogicalAtMs",
      "durableClockBasisId",
      "primaryCorpusMember",
    ]);
    const source = snapshotExactNormalizerInput(outer["source"], [
      "providerId",
      "datasetId",
      "feedId",
      "endpointChannelId",
      "entitlementSnapshotId",
    ]);
    const eventTime = snapshotTimestamp(outer["eventTime"]);
    const effectiveEventTime =
      outer["effectiveEventTime"] === null ? null : snapshotTimestamp(outer["effectiveEventTime"]);
    const providerSequence =
      outer["providerSequence"] === null
        ? null
        : snapshotExactNormalizerInput(outer["providerSequence"], ["value", "scope", "trustClass"]);
    const payload = snapshotPayload(outer["payload"]);
    const snapshot = {
      ...outer,
      source,
      eventTime,
      effectiveEventTime,
      providerSequence,
      payload,
    };
    if (
      typeof outer["instrumentId"] !== "string" ||
      (outer["venueTapeId"] !== null && typeof outer["venueTapeId"] !== "string") ||
      (outer["providerRecordKey"] !== null && typeof outer["providerRecordKey"] !== "string") ||
      (outer["providerRevisionKey"] !== null && typeof outer["providerRevisionKey"] !== "string") ||
      typeof outer["providerStableRecordFamily"] !== "string" ||
      ![
        "quote",
        "trade",
        "bar",
        "prior-close",
        "official-open",
        "official-close",
        "corrected-close",
        "trading-action",
        "luld",
        "corporate-action",
      ].includes(outer["eventKind"] as string) ||
      (outer["sequenceSessionDate"] !== null && typeof outer["sequenceSessionDate"] !== "string") ||
      typeof outer["canonicalProviderPayloadDigest"] !== "string" ||
      typeof outer["marketAcquisitionId"] !== "string" ||
      typeof outer["rawArtifactId"] !== "string" ||
      typeof outer["memberKey"] !== "string" ||
      typeof outer["occurrenceOrdinal"] !== "number" ||
      !["original", "correction", "cancellation"].includes(outer["revisionKind"] as string) ||
      (outer["supersedesRevisionId"] !== null &&
        typeof outer["supersedesRevisionId"] !== "string") ||
      ![
        "regular-continuous",
        "official-open-auction",
        "official-close-auction",
        "extended-pre",
        "extended-post",
        "overnight",
        "halted",
        "calendar-closed",
        "unknown",
      ].includes(outer["sessionKind"] as string) ||
      outer["currency"] !== "USD" ||
      typeof outer["normalizerVersion"] !== "string" ||
      typeof outer["conditionPolicyVersion"] !== "string" ||
      typeof outer["calendarVersion"] !== "string" ||
      typeof outer["parserContractVersion"] !== "string" ||
      typeof outer["durablyRecordedAtMs"] !== "number" ||
      typeof outer["durableLogicalAtMs"] !== "number" ||
      typeof outer["durableClockBasisId"] !== "string" ||
      typeof outer["primaryCorpusMember"] !== "boolean"
    ) {
      fail("market.input-invalid");
    }
    if (
      providerSequence !== null &&
      (typeof providerSequence["value"] !== "string" ||
        typeof providerSequence["scope"] !== "string" ||
        ![
          "native-gap-checked",
          "provider-stable-sequence",
          "native-unchecked",
          "deterministic-artifact-order",
          "none",
        ].includes(providerSequence["trustClass"] as string))
    ) {
      fail("market.input-invalid");
    }
    return cloneJson(snapshot as unknown as JsonValue) as unknown as RecordedMarketRecordV1;
  } catch (error) {
    if (error instanceof MarketContractError) throw error;
    if (error instanceof RangeError) {
      throw new MarketContractError(
        marketReason("market.bound-exceeded", { limitKind: "canonicalRecordBytes" }),
      );
    }
    fail("market.input-invalid");
  }
}

function snapshotTimestamp(value: unknown): Readonly<Record<string, unknown>> {
  const timestamp = snapshotExactNormalizerInput(value, ["epochNs", "semantic", "precisionNs"]);
  if (
    typeof timestamp["epochNs"] !== "string" ||
    typeof timestamp["semantic"] !== "string" ||
    typeof timestamp["precisionNs"] !== "string"
  ) {
    fail("market.input-invalid");
  }
  return timestamp;
}

function snapshotDecimal(value: unknown): CanonicalDecimalV1 {
  const decimal = snapshotExactNormalizerInput(value, ["coefficient", "scale", "negative"]);
  if (
    typeof decimal["coefficient"] !== "string" ||
    typeof decimal["scale"] !== "number" ||
    typeof decimal["negative"] !== "boolean"
  ) {
    fail("market.input-invalid");
  }
  return validateCanonicalDecimal(decimal as unknown as CanonicalDecimalV1);
}

function snapshotPayload(value: unknown): MarketPayloadV1 | null {
  if (value === null) return null;
  const discriminator = snapshotExactNormalizerInput(
    value,
    ["kind"],
    [
      "bidPrice",
      "quoteKind",
      "askPrice",
      "bidSize",
      "askSize",
      "explicitConsolidatedNbbo",
      "condition",
      "slow",
      "luldState",
      "halted",
      "price",
      "tradeKind",
      "size",
      "updatesConsolidatedLast",
      "oddLot",
      "close",
      "barKind",
      "barStartNs",
      "barEndNs",
      "adjustmentMode",
      "closeKind",
      "sessionDate",
      "valueKind",
      "action",
      "state",
      "actionKind",
      "effectiveNs",
      "successorInstrumentId",
    ],
  );
  const kind = discriminator["kind"];
  if (kind === "quote") {
    const payload = snapshotExactNormalizerInput(value, [
      "kind",
      "quoteKind",
      "bidPrice",
      "askPrice",
      "bidSize",
      "askSize",
      "explicitConsolidatedNbbo",
      "condition",
      "slow",
      "luldState",
      "halted",
    ]);
    if (
      !["nbbo", "bolo"].includes(payload["quoteKind"] as string) ||
      typeof payload["explicitConsolidatedNbbo"] !== "boolean" ||
      !["eligible", "ineligible", "unknown"].includes(payload["condition"] as string) ||
      typeof payload["slow"] !== "boolean" ||
      !["executable", "limit", "non-executable", "not-applicable"].includes(
        payload["luldState"] as string,
      ) ||
      typeof payload["halted"] !== "boolean"
    ) {
      fail("market.input-invalid");
    }
    return {
      ...payload,
      bidPrice: snapshotDecimal(payload["bidPrice"]),
      askPrice: snapshotDecimal(payload["askPrice"]),
      bidSize: snapshotDecimal(payload["bidSize"]),
      askSize: snapshotDecimal(payload["askSize"]),
    } as unknown as MarketPayloadV1;
  }
  if (kind === "trade") {
    const payload = snapshotExactNormalizerInput(value, [
      "kind",
      "tradeKind",
      "price",
      "size",
      "updatesConsolidatedLast",
      "oddLot",
    ]);
    if (
      !["last-eligible", "opening", "reopening", "closing", "final-close"].includes(
        payload["tradeKind"] as string,
      ) ||
      ![true, false, "state-insufficient"].includes(payload["updatesConsolidatedLast"] as true) ||
      typeof payload["oddLot"] !== "boolean"
    ) {
      fail("market.input-invalid");
    }
    return {
      ...payload,
      price: snapshotDecimal(payload["price"]),
      size: snapshotDecimal(payload["size"]),
    } as unknown as MarketPayloadV1;
  }
  if (kind === "bar") {
    const payload = snapshotExactNormalizerInput(value, [
      "kind",
      "barKind",
      "close",
      "barStartNs",
      "barEndNs",
      "adjustmentMode",
    ]);
    if (
      !["one-minute", "daily"].includes(payload["barKind"] as string) ||
      typeof payload["barStartNs"] !== "string" ||
      typeof payload["barEndNs"] !== "string" ||
      !["raw", "split", "dividend", "spin-off", "all", "provider-defined", "unknown"].includes(
        payload["adjustmentMode"] as string,
      )
    ) {
      fail("market.input-invalid");
    }
    return {
      ...payload,
      close: snapshotDecimal(payload["close"]),
    } as unknown as MarketPayloadV1;
  }
  if (kind === "prior-close") {
    const payload = snapshotExactNormalizerInput(value, [
      "kind",
      "price",
      "closeKind",
      "sessionDate",
    ]);
    if (
      !["listing-official-close", "corrected-consolidated-close"].includes(
        payload["closeKind"] as string,
      ) ||
      typeof payload["sessionDate"] !== "string"
    ) {
      fail("market.input-invalid");
    }
    return {
      ...payload,
      price: snapshotDecimal(payload["price"]),
    } as unknown as MarketPayloadV1;
  }
  if (kind === "official-value") {
    const payload = snapshotExactNormalizerInput(value, [
      "kind",
      "valueKind",
      "price",
      "sessionDate",
    ]);
    if (
      payload["valueKind"] !== "listing-official-open" ||
      typeof payload["sessionDate"] !== "string"
    ) {
      fail("market.input-invalid");
    }
    return { ...payload, price: snapshotDecimal(payload["price"]) } as unknown as MarketPayloadV1;
  }
  if (kind === "trading-action") {
    const payload = snapshotExactNormalizerInput(value, ["kind", "action"]);
    if (!["halt", "quote-resume", "trade-resume", "reset"].includes(payload["action"] as string)) {
      fail("market.input-invalid");
    }
    return payload as unknown as MarketPayloadV1;
  }
  if (kind === "luld") {
    const payload = snapshotExactNormalizerInput(value, ["kind", "state"]);
    if (!["executable", "limit", "non-executable"].includes(payload["state"] as string)) {
      fail("market.input-invalid");
    }
    return payload as unknown as MarketPayloadV1;
  }
  if (kind === "corporate-action") {
    const payload = snapshotExactNormalizerInput(value, [
      "kind",
      "actionKind",
      "effectiveNs",
      "successorInstrumentId",
    ]);
    if (
      !["split", "dividend", "spin-off", "symbol-change"].includes(
        payload["actionKind"] as string,
      ) ||
      typeof payload["effectiveNs"] !== "string" ||
      (payload["successorInstrumentId"] !== null &&
        typeof payload["successorInstrumentId"] !== "string")
    ) {
      fail("market.input-invalid");
    }
    parseEpochNanoseconds(payload["effectiveNs"] as string);
    return payload as unknown as MarketPayloadV1;
  }
  fail("market.input-invalid");
}

export function normalizeRecordedMarketRecord(
  value: RecordedMarketRecordV1,
): NormalizedMarketFactV1 {
  const record = snapshotRecord(value);
  validateMarketSource(record.source);
  if (
    !ID.test(record.instrumentId) ||
    !ID.test(record.marketAcquisitionId) ||
    !ID.test(record.rawArtifactId) ||
    (record.venueTapeId !== null && !ID.test(record.venueTapeId)) ||
    !/^[0-9a-f]{64}$/u.test(record.canonicalProviderPayloadDigest) ||
    !Number.isSafeInteger(record.occurrenceOrdinal) ||
    record.occurrenceOrdinal < 0 ||
    !Number.isSafeInteger(record.durablyRecordedAtMs) ||
    record.durablyRecordedAtMs < 0 ||
    !Number.isSafeInteger(record.durableLogicalAtMs) ||
    record.durableLogicalAtMs < 0 ||
    record.durableClockBasisId.length === 0
  ) {
    fail("market.input-invalid");
  }
  validateMarketTimestamp(record.eventTime);
  if (record.effectiveEventTime !== null) validateMarketTimestamp(record.effectiveEventTime);
  if (record.revisionKind === "cancellation") {
    if (record.payload !== null) fail("market.input-invalid");
  } else {
    if (record.payload === null) fail("market.input-invalid");
    validatePayload(record.payload, record.eventKind);
  }
  if (
    record.canonicalProviderPayloadDigest !== deriveCanonicalProviderPayloadDigest(record.payload)
  ) {
    throw new MarketContractError(
      marketReason("market.provider-observation-invalid", {
        providerObservationFailureKind: "conflicting-content",
      }),
    );
  }

  const providerObservationId = deriveProviderObservationId({
    ...record.source,
    instrumentId: record.instrumentId,
    venueTapeId: record.venueTapeId,
    providerRecordKey: record.providerRecordKey,
    providerRevisionKey: record.providerRevisionKey,
    eventKind: record.eventKind,
    eventTime: record.eventTime as unknown as JsonValue,
    providerSequence: record.providerSequence as unknown as JsonValue | null,
    sequenceSessionDate: record.sequenceSessionDate,
    canonicalProviderPayloadDigest: record.canonicalProviderPayloadDigest,
  });
  const deliveryId = deriveDeliveryId({
    providerObservationId,
    marketAcquisitionId: record.marketAcquisitionId,
    rawArtifactId: record.rawArtifactId,
    memberKey: record.memberKey,
    occurrenceOrdinal: record.occurrenceOrdinal,
  });
  const revisionFamilyId = deriveRevisionFamilyId({
    providerId: record.source.providerId,
    datasetId: record.source.datasetId,
    feedId: record.source.feedId,
    endpointChannelId: record.source.endpointChannelId,
    instrumentId: record.instrumentId,
    eventKind: record.eventKind,
    providerStableRecordFamily: record.providerStableRecordFamily,
  });
  const marketFactId =
    record.payload === null
      ? null
      : deriveMarketFactId({
          instrumentId: record.instrumentId,
          eventKind: record.eventKind,
          eventTime: record.eventTime as unknown as JsonValue,
          venueTapeId: record.venueTapeId,
          sessionKind: record.sessionKind,
          currency: record.currency,
          canonicalPayload: record.payload as unknown as JsonValue,
        });
  const revisionId = deriveRevisionId({
    revisionFamilyId,
    revisionKind: record.revisionKind,
    providerRevisionKey: record.providerRevisionKey,
    supersedesRevisionId: record.supersedesRevisionId,
    effectiveEventTime: record.effectiveEventTime as unknown as JsonValue | null,
    marketFactId,
  });
  const normalizedMarketFactId =
    marketFactId === null
      ? null
      : deriveNormalizedMarketFactId({
          marketFactId,
          providerObservationId,
          revisionId,
          normalizerVersion: record.normalizerVersion,
          conditionPolicyVersion: record.conditionPolicyVersion,
          calendarVersion: record.calendarVersion,
          parserContractVersion: record.parserContractVersion,
        });
  const durableEvidenceHash = deriveDurableRevisionEvidenceHash({
    revisionId,
    deliveryId,
    rawArtifactId: record.rawArtifactId,
    durablyRecordedAtMs: record.durablyRecordedAtMs,
    logicalAtMs: record.durableLogicalAtMs,
    clockBasisId: record.durableClockBasisId,
  });

  return Object.freeze({
    source: record.source,
    providerObservationId,
    deliveryId,
    revisionFamilyId,
    revisionId,
    marketFactId,
    normalizedMarketFactId,
    instrumentId: record.instrumentId,
    venueTapeId: record.venueTapeId,
    providerRecordKey: record.providerRecordKey,
    providerRevisionKey: record.providerRevisionKey,
    providerStableRecordFamily: record.providerStableRecordFamily,
    eventKind: record.eventKind,
    eventTime: record.eventTime,
    providerSequence: record.providerSequence,
    sequenceSessionDate: record.sequenceSessionDate,
    canonicalProviderPayloadDigest: record.canonicalProviderPayloadDigest,
    marketAcquisitionId: record.marketAcquisitionId,
    rawArtifactId: record.rawArtifactId,
    memberKey: record.memberKey,
    occurrenceOrdinal: record.occurrenceOrdinal,
    revisionKind: record.revisionKind,
    supersedesRevisionId: record.supersedesRevisionId,
    effectiveEventTime: record.effectiveEventTime,
    sessionKind: record.sessionKind,
    currency: record.currency,
    payload: record.payload,
    normalizerVersion: record.normalizerVersion,
    conditionPolicyVersion: record.conditionPolicyVersion,
    calendarVersion: record.calendarVersion,
    parserContractVersion: record.parserContractVersion,
    durablyRecordedAtMs: record.durablyRecordedAtMs,
    durableLogicalAtMs: record.durableLogicalAtMs,
    durableClockBasisId: record.durableClockBasisId,
    durableEvidenceHash,
    primaryCorpusMember: record.primaryCorpusMember,
  });
}

export function validateNormalizedMarketFactIdentity(
  fact: NormalizedMarketFactV1,
): NormalizedMarketFactV1 {
  try {
    fact = snapshotExactNormalizerInput(fact, [
      "source",
      "providerObservationId",
      "deliveryId",
      "revisionFamilyId",
      "revisionId",
      "marketFactId",
      "normalizedMarketFactId",
      "instrumentId",
      "venueTapeId",
      "providerRecordKey",
      "providerRevisionKey",
      "providerStableRecordFamily",
      "eventKind",
      "eventTime",
      "providerSequence",
      "sequenceSessionDate",
      "canonicalProviderPayloadDigest",
      "marketAcquisitionId",
      "rawArtifactId",
      "memberKey",
      "occurrenceOrdinal",
      "revisionKind",
      "supersedesRevisionId",
      "effectiveEventTime",
      "sessionKind",
      "currency",
      "payload",
      "normalizerVersion",
      "conditionPolicyVersion",
      "calendarVersion",
      "parserContractVersion",
      "durablyRecordedAtMs",
      "durableLogicalAtMs",
      "durableClockBasisId",
      "durableEvidenceHash",
      "primaryCorpusMember",
    ]) as NormalizedMarketFactV1;
    validateMarketSource(fact.source);
    validateMarketTimestamp(snapshotTimestamp(fact.eventTime) as unknown as MarketTimestampV1);
    if (fact.effectiveEventTime !== null) {
      validateMarketTimestamp(
        snapshotTimestamp(fact.effectiveEventTime) as unknown as MarketTimestampV1,
      );
    }
    const payload = snapshotPayload(fact.payload);
    if (
      canonicalJson(payload as unknown as JsonValue) !==
        canonicalJson(fact.payload as unknown as JsonValue) ||
      deriveCanonicalProviderPayloadDigest(payload) !== fact.canonicalProviderPayloadDigest
    ) {
      throw new MarketContractError(
        marketReason("market.provider-observation-invalid", {
          providerObservationFailureKind: "conflicting-content",
        }),
      );
    }
    if (payload !== null) validatePayload(payload, fact.eventKind);
    const providerObservationId = deriveProviderObservationId({
      ...fact.source,
      instrumentId: fact.instrumentId,
      venueTapeId: fact.venueTapeId,
      providerRecordKey: fact.providerRecordKey,
      providerRevisionKey: fact.providerRevisionKey,
      eventKind: fact.eventKind,
      eventTime: fact.eventTime as unknown as JsonValue,
      providerSequence: fact.providerSequence as unknown as JsonValue | null,
      sequenceSessionDate: fact.sequenceSessionDate,
      canonicalProviderPayloadDigest: fact.canonicalProviderPayloadDigest,
    });
    const deliveryId = deriveDeliveryId({
      providerObservationId,
      marketAcquisitionId: fact.marketAcquisitionId,
      rawArtifactId: fact.rawArtifactId,
      memberKey: fact.memberKey,
      occurrenceOrdinal: fact.occurrenceOrdinal,
    });
    const revisionFamilyId = deriveRevisionFamilyId({
      providerId: fact.source.providerId,
      datasetId: fact.source.datasetId,
      feedId: fact.source.feedId,
      endpointChannelId: fact.source.endpointChannelId,
      instrumentId: fact.instrumentId,
      eventKind: fact.eventKind,
      providerStableRecordFamily: fact.providerStableRecordFamily,
    });
    const marketFactId =
      fact.payload === null
        ? null
        : deriveMarketFactId({
            instrumentId: fact.instrumentId,
            eventKind: fact.eventKind,
            eventTime: fact.eventTime as unknown as JsonValue,
            venueTapeId: fact.venueTapeId,
            sessionKind: fact.sessionKind,
            currency: fact.currency,
            canonicalPayload: fact.payload as unknown as JsonValue,
          });
    const revisionId = deriveRevisionId({
      revisionFamilyId,
      revisionKind: fact.revisionKind,
      providerRevisionKey: fact.providerRevisionKey,
      supersedesRevisionId: fact.supersedesRevisionId,
      effectiveEventTime: fact.effectiveEventTime as unknown as JsonValue | null,
      marketFactId,
    });
    const normalizedMarketFactId =
      marketFactId === null
        ? null
        : deriveNormalizedMarketFactId({
            marketFactId,
            providerObservationId,
            revisionId,
            normalizerVersion: fact.normalizerVersion,
            conditionPolicyVersion: fact.conditionPolicyVersion,
            calendarVersion: fact.calendarVersion,
            parserContractVersion: fact.parserContractVersion,
          });
    const durableEvidenceHash = deriveDurableRevisionEvidenceHash({
      revisionId,
      deliveryId,
      rawArtifactId: fact.rawArtifactId,
      durablyRecordedAtMs: fact.durablyRecordedAtMs,
      logicalAtMs: fact.durableLogicalAtMs,
      clockBasisId: fact.durableClockBasisId,
    });
    if (
      providerObservationId !== fact.providerObservationId ||
      deliveryId !== fact.deliveryId ||
      revisionFamilyId !== fact.revisionFamilyId ||
      marketFactId !== fact.marketFactId ||
      revisionId !== fact.revisionId ||
      normalizedMarketFactId !== fact.normalizedMarketFactId ||
      durableEvidenceHash !== fact.durableEvidenceHash
    ) {
      throw new MarketContractError(marketReason("market.identity-invalid"));
    }
    return fact;
  } catch (error) {
    if (error instanceof MarketContractError) throw error;
    throw new MarketContractError(marketReason("market.identity-invalid"));
  }
}

export function normalizeRecordedMarketRecords(
  values: readonly RecordedMarketRecordV1[],
): readonly NormalizedMarketFactV1[] {
  if (values.length > 160_000) {
    throw new MarketContractError(
      marketReason("market.bound-exceeded", { limitKind: "factsPerAcquisition" }),
    );
  }
  return Object.freeze(values.map((value) => normalizeRecordedMarketRecord(value)));
}
