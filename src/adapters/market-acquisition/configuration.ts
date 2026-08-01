import { Buffer } from "node:buffer";
import { types as utilityTypes } from "node:util";

import { canonicalHash } from "../../core/hash.js";
import type { JsonValue } from "../../core/json.js";
import { snapshotExactNormalizerInput } from "../../providers/normalizer-input.js";
import {
  ACCEPTED_PR_2E_CANDIDATE_SHA,
  AUTHORIZATION_MODE,
  createMarketAcquisitionSafeError,
  MARKET_ACQUISITION_LIMITS,
  ROUTE_POLICY_VERSION,
  type AlpacaAcquisitionKind,
  type AlpacaQueryFields,
  type FrozenInstrumentRequest,
  type MarketAcquisitionOperationStage,
  type MarketAcquisitionResult,
  type MarketAcquisitionTerminalReason,
  type SafeDetailKind,
  type TrustedClockEvidence,
  type TrustedClockSample,
  type ValidatedMarketAcquisitionConfiguration,
} from "./contracts.js";
import {
  ALPACA_ROUTE_REGISTRY,
  deriveMarketAcquisitionConfigurationIdentity,
  deriveMarketAcquisitionRequestIdentity,
  FROZEN_MARKET_IDENTITIES,
  ZERO_SPEND_POLICY_ID,
  ZERO_SPEND_POLICY_PREIMAGE,
} from "./identity.js";

const CONFIGURATION_KEYS = Object.freeze([
  "schemaVersion",
  "acceptedContractCandidateSha",
  "lane",
  "kind",
  "providerId",
  "datasetId",
  "feedId",
  "endpointChannelId",
  "entitlementSnapshotId",
  "routePolicyVersion",
  "aliasAuthorityCatalogId",
  "instruments",
  "queryFields",
  "trustedClockEvidence",
  "liveEnabled",
  "authorizationMode",
  "capability",
  "sourceRole",
  "fallbackKind",
  "zeroIncrementalSpend",
  "costStatus",
  "zeroSpendPolicyId",
  "zeroSpendPolicyPreimage",
  "runDecision",
  "retentionPolicyReadiness",
]);
const CLOCK_EVIDENCE_KEYS = Object.freeze([
  "available",
  "basisId",
  "wallClock",
  "synchronization",
  "maximumErrorNs",
  "maximumErrorBounded",
  "monotonicClock",
  "monotonicSessionId",
  "priorSample",
  "currentSample",
]);
const CLOCK_SAMPLE_KEYS = Object.freeze([
  "sampleId",
  "previousSampleId",
  "basisId",
  "wallClock",
  "synchronization",
  "wallNs",
  "monotonicClock",
  "monotonicSessionId",
  "monotonicUs",
]);
const INSTRUMENT_KEYS = Object.freeze(["instrumentId", "symbol"]);
const ZERO_SPEND_KEYS = Object.freeze([
  "schemaVersion",
  "policyVersion",
  "p109AuthorityCandidate",
  "maximumIncrementalSpend",
  "existingEntitlementsOnly",
  "accountInspection",
  "accountMutation",
  "subscriptionMutation",
  "unknownCostBehavior",
  "fallbackKind",
]);
const SIGNED_NS_MAX = (1n << 63n) - 1n;
const HISTORY_DELAY_NS = 900_000_000_000n;
const NS_PER_DAY = 86_400_000_000_000n;

class ClosedFailure {
  constructor(
    readonly reasonCode: MarketAcquisitionTerminalReason,
    readonly operationStage: MarketAcquisitionOperationStage,
    readonly detailKind: SafeDetailKind,
  ) {}
}

function fail(
  reasonCode: MarketAcquisitionTerminalReason,
  operationStage: MarketAcquisitionOperationStage,
  detailKind: SafeDetailKind,
): never {
  throw new ClosedFailure(reasonCode, operationStage, detailKind);
}

function exactObject(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  return exactObjectOr(
    value,
    keys,
    "configuration-invalid",
    "configuration",
    "input-shape-invalid",
  );
}

function exactObjectOr(
  value: unknown,
  keys: readonly string[],
  reasonCode: MarketAcquisitionTerminalReason,
  operationStage: MarketAcquisitionOperationStage,
  detailKind: SafeDetailKind,
): Readonly<Record<string, unknown>> {
  try {
    return snapshotExactNormalizerInput(value, keys);
  } catch {
    return fail(reasonCode, operationStage, detailKind);
  }
}

function exactArray(value: unknown): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      utilityTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return fail("configuration-invalid", "configuration", "input-shape-invalid");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = new Set([
      "length",
      ...Array.from({ length: value.length }, (_, index) => `${index}`),
    ]);
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !expected.has(key)) ||
      Object.keys(descriptors).length !== expected.size
    ) {
      return fail("configuration-invalid", "configuration", "input-shape-invalid");
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[`${index}`];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        return fail("configuration-invalid", "configuration", "input-shape-invalid");
      }
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof ClosedFailure) throw error;
    return fail("configuration-invalid", "configuration", "input-shape-invalid");
  }
}

function validateInstruments(value: unknown): readonly FrozenInstrumentRequest[] {
  const members = exactArray(value);
  if (members.length < 1 || members.length > MARKET_ACQUISITION_LIMITS.instruments) {
    return fail("bound-exceeded", "request-preflight", "bound-exceeded");
  }
  const result: FrozenInstrumentRequest[] = [];
  let priorSymbol: string | null = null;
  const seenIds = new Set<string>();
  for (const member of members) {
    const input = exactObject(member, INSTRUMENT_KEYS);
    const instrumentId = input["instrumentId"];
    const symbol = input["symbol"];
    if (
      typeof instrumentId !== "string" ||
      !/^min1_[0-9a-f]{64}$/u.test(instrumentId) ||
      typeof symbol !== "string" ||
      !/^[A-Z][A-Z0-9.]{0,31}$/u.test(symbol) ||
      symbol.includes(",") ||
      seenIds.has(instrumentId) ||
      (priorSymbol !== null &&
        Buffer.compare(Buffer.from(priorSymbol, "utf8"), Buffer.from(symbol, "utf8")) >= 0)
    ) {
      return fail("configuration-invalid", "configuration", "input-shape-invalid");
    }
    seenIds.add(instrumentId);
    priorSymbol = symbol;
    result.push(Object.freeze({ instrumentId, symbol }));
  }
  return Object.freeze(result);
}

function parseCanonicalNs(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/u.test(value)) {
    return fail("query-invalid", "request-preflight", "query-invalid");
  }
  const millisecondText = `${value.slice(0, 23)}Z`;
  const milliseconds = Date.parse(millisecondText);
  if (
    !Number.isSafeInteger(milliseconds) ||
    new Date(milliseconds).toISOString() !== millisecondText
  ) {
    return fail("query-invalid", "request-preflight", "query-invalid");
  }
  const roundTrip = `${millisecondText.slice(0, 20)}${value.slice(20, 29)}Z`;
  if (roundTrip !== value) {
    return fail("query-invalid", "request-preflight", "query-invalid");
  }
  return BigInt(milliseconds) * 1_000_000n + (BigInt(value.slice(20, 29)) % 1_000_000n);
}

function validateQueryFields(
  value: unknown,
  kind: AlpacaAcquisitionKind,
  instruments: readonly FrozenInstrumentRequest[],
): Readonly<{ fields: AlpacaQueryFields; startNs: bigint; endNs: bigint; limit: number }> {
  const required = ["symbols", "start", "end", "limit", "feed", "sort"];
  const keys = kind === "bars" ? [...required, "timeframe", "adjustment"] : required;
  const query = exactObjectOr(value, keys, "query-invalid", "request-preflight", "query-invalid");
  const symbols = instruments.map(({ symbol }) => symbol).join(",");
  if (
    query["symbols"] !== symbols ||
    query["feed"] !== "sip" ||
    query["sort"] !== "asc" ||
    (kind === "bars" && (query["timeframe"] !== "1Min" || query["adjustment"] !== "raw"))
  ) {
    return fail("query-invalid", "request-preflight", "query-invalid");
  }
  const limitText = query["limit"];
  if (typeof limitText !== "string" || !/^[1-9]\d{0,4}$/u.test(limitText)) {
    return fail("query-invalid", "request-preflight", "query-invalid");
  }
  const limit = Number(limitText);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MARKET_ACQUISITION_LIMITS.recordsPerPage ||
    String(limit) !== limitText
  ) {
    return fail("bound-exceeded", "request-preflight", "bound-exceeded");
  }
  const startNs = parseCanonicalNs(query["start"]);
  const endNs = parseCanonicalNs(query["end"]);
  if (
    startNs > endNs ||
    endNs / NS_PER_DAY - startNs / NS_PER_DAY + 1n >
      BigInt(MARKET_ACQUISITION_LIMITS.historicalCalendarDates)
  ) {
    return fail("query-invalid", "request-preflight", "query-invalid");
  }
  const fields = Object.freeze({
    symbols,
    start: query["start"] as string,
    end: query["end"] as string,
    limit: limitText,
    feed: "sip" as const,
    sort: "asc" as const,
    ...(kind === "bars" ? { timeframe: "1Min" as const, adjustment: "raw" as const } : {}),
  });
  return Object.freeze({ fields, startNs, endNs, limit });
}

function validateClockSample(
  value: unknown,
  evidence: Readonly<Record<string, unknown>>,
): TrustedClockSample {
  const sample = exactObjectOr(
    value,
    CLOCK_SAMPLE_KEYS,
    "clock-unavailable",
    "trusted-time",
    "clock-unavailable",
  );
  if (
    typeof sample["sampleId"] !== "string" ||
    sample["sampleId"].length === 0 ||
    (sample["previousSampleId"] !== null && typeof sample["previousSampleId"] !== "string") ||
    sample["basisId"] !== evidence["basisId"] ||
    sample["wallClock"] !== evidence["wallClock"] ||
    sample["synchronization"] !== evidence["synchronization"] ||
    typeof sample["wallNs"] !== "bigint" ||
    sample["wallNs"] < 0n ||
    sample["wallNs"] > SIGNED_NS_MAX ||
    sample["monotonicClock"] !== evidence["monotonicClock"] ||
    sample["monotonicSessionId"] !== evidence["monotonicSessionId"] ||
    typeof sample["monotonicUs"] !== "bigint" ||
    sample["monotonicUs"] < 0n ||
    sample["monotonicUs"] > SIGNED_NS_MAX
  ) {
    return fail("clock-unavailable", "trusted-time", "clock-unavailable");
  }
  return Object.freeze({
    sampleId: sample["sampleId"],
    previousSampleId: sample["previousSampleId"],
    basisId: sample["basisId"] as string,
    wallClock: "system-utc",
    synchronization: "verified-bound",
    wallNs: sample["wallNs"],
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: sample["monotonicSessionId"] as string,
    monotonicUs: sample["monotonicUs"],
  });
}

function validateTrustedClockEvidence(
  value: unknown,
): Readonly<{ evidence: TrustedClockEvidence; trustedStartedNs: bigint }> {
  const input = exactObjectOr(
    value,
    CLOCK_EVIDENCE_KEYS,
    "clock-unavailable",
    "trusted-time",
    "clock-unavailable",
  );
  if (
    input["available"] !== true ||
    typeof input["basisId"] !== "string" ||
    input["wallClock"] !== "system-utc" ||
    input["synchronization"] !== "verified-bound" ||
    input["maximumErrorBounded"] !== true ||
    typeof input["maximumErrorNs"] !== "bigint" ||
    input["maximumErrorNs"] < 0n ||
    input["maximumErrorNs"] > SIGNED_NS_MAX ||
    input["monotonicClock"] !== "process-monotonic-us" ||
    typeof input["monotonicSessionId"] !== "string" ||
    input["monotonicSessionId"].length === 0
  ) {
    return fail("clock-unavailable", "trusted-time", "clock-unavailable");
  }
  const maximumErrorNs = input["maximumErrorNs"];
  const maximumErrorMs = Number((maximumErrorNs + 999_999n) / 1_000_000n);
  const expectedBasisId = `clk1_${canonicalHash("peas/clock-basis/v1", {
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorMs,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: input["monotonicSessionId"],
  })}`;
  if (input["basisId"] !== expectedBasisId) {
    return fail("clock-unavailable", "trusted-time", "clock-unavailable");
  }
  const priorSample = validateClockSample(input["priorSample"], input);
  const currentSample = validateClockSample(input["currentSample"], input);
  if (
    priorSample.previousSampleId !== null ||
    currentSample.previousSampleId !== priorSample.sampleId ||
    currentSample.sampleId === priorSample.sampleId
  ) {
    return fail("clock-unavailable", "trusted-time", "clock-unavailable");
  }
  if (
    currentSample.wallNs < priorSample.wallNs ||
    currentSample.monotonicUs <= priorSample.monotonicUs
  ) {
    return fail("clock-regression", "trusted-time", "clock-regression");
  }
  if (maximumErrorNs > currentSample.wallNs) {
    return fail("clock-unavailable", "trusted-time", "clock-unavailable");
  }
  const trustedStartedNs = currentSample.wallNs - maximumErrorNs;
  const evidence = Object.freeze({
    available: true,
    basisId: input["basisId"],
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorNs,
    maximumErrorBounded: true,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: input["monotonicSessionId"],
    priorSample,
    currentSample,
  }) satisfies TrustedClockEvidence;
  return Object.freeze({ evidence, trustedStartedNs });
}

function validateZeroSpend(input: Readonly<Record<string, unknown>>): void {
  if (
    input["zeroIncrementalSpend"] !== true ||
    input["costStatus"] !== "zero-incremental-spend-approved" ||
    input["zeroSpendPolicyId"] !== ZERO_SPEND_POLICY_ID ||
    input["runDecision"] !== "allow"
  ) {
    fail("zero-spend-unprovable", "authority", "zero-spend-unprovable");
  }
  const policy = exactObject(input["zeroSpendPolicyPreimage"], ZERO_SPEND_KEYS);
  const policyJson = policy as JsonValue;
  if (
    canonicalHash("peas/market-zero-spend-policy/v1", policyJson) !==
      ZERO_SPEND_POLICY_ID.slice("mzp1_".length) ||
    JSON.stringify(policy) !== JSON.stringify(ZERO_SPEND_POLICY_PREIMAGE)
  ) {
    fail("zero-spend-unprovable", "authority", "zero-spend-unprovable");
  }
}

function parseConfiguration(input: unknown): ValidatedMarketAcquisitionConfiguration {
  const value = exactObject(input, CONFIGURATION_KEYS);
  if (
    value["schemaVersion"] !== 1 ||
    value["acceptedContractCandidateSha"] !== ACCEPTED_PR_2E_CANDIDATE_SHA ||
    value["authorizationMode"] !== AUTHORIZATION_MODE ||
    value["capability"] !== "historical-market-reference" ||
    value["fallbackKind"] !== "none"
  ) {
    return fail("authority-invalid", "authority", "authority-invalid");
  }
  if (value["liveEnabled"] !== true) {
    return fail("lane-not-authorized", "authority", "live-disabled");
  }
  if (value["lane"] === "fmp-private-discrepancy") {
    return fail("lane-not-implemented", "authority", "lane-not-implemented");
  }
  if (
    value["lane"] !== "alpaca-historical-sip" ||
    value["sourceRole"] !== "primary" ||
    value["retentionPolicyReadiness"] !== "ready"
  ) {
    return fail("lane-not-authorized", "authority", "source-not-authorized");
  }
  if (!["quotes", "trades", "bars"].includes(value["kind"] as string)) {
    return fail("configuration-invalid", "configuration", "input-shape-invalid");
  }
  const kind = value["kind"] as AlpacaAcquisitionKind;
  const route = ALPACA_ROUTE_REGISTRY[kind];
  if (
    value["providerId"] !== FROZEN_MARKET_IDENTITIES.alpaca.providerId ||
    value["datasetId"] !== FROZEN_MARKET_IDENTITIES.alpaca.datasetId ||
    value["feedId"] !== FROZEN_MARKET_IDENTITIES.alpaca.feedId ||
    value["endpointChannelId"] !== route.endpointChannelId ||
    value["routePolicyVersion"] !== ROUTE_POLICY_VERSION ||
    typeof value["entitlementSnapshotId"] !== "string" ||
    !/^ent1_[0-9a-f]{64}$/u.test(value["entitlementSnapshotId"]) ||
    typeof value["aliasAuthorityCatalogId"] !== "string" ||
    !/^maac1_[0-9a-f]{64}$/u.test(value["aliasAuthorityCatalogId"])
  ) {
    return fail("identity-mismatch", "identity", "identity-mismatch");
  }
  validateZeroSpend(value);
  const instruments = validateInstruments(value["instruments"]);
  const query = validateQueryFields(value["queryFields"], kind, instruments);
  const clock = validateTrustedClockEvidence(value["trustedClockEvidence"]);
  if (
    clock.trustedStartedNs < HISTORY_DELAY_NS ||
    query.endNs > clock.trustedStartedNs - HISTORY_DELAY_NS
  ) {
    return fail("historical-boundary-unprovable", "trusted-time", "historical-boundary-unprovable");
  }
  const requestIdentityHash = deriveMarketAcquisitionRequestIdentity({
    route,
    entitlementSnapshotId: value["entitlementSnapshotId"],
    instruments,
    factFamily: kind,
    queryStartNs: query.startNs,
    queryEndNs: query.endNs,
    authorizationMode: AUTHORIZATION_MODE,
  });
  const acquisitionConfigurationHash = deriveMarketAcquisitionConfigurationIdentity({
    requestIdentityHash,
    requestedPageLimit: query.limit,
    liveEnabled: true,
    zeroSpendPolicyId: ZERO_SPEND_POLICY_ID,
    runDecision: "allow",
    aliasAuthorityCatalogId: value["aliasAuthorityCatalogId"],
    retentionPolicyReadiness: "ready",
  });
  return Object.freeze({
    schemaVersion: 1,
    acceptedContractCandidateSha: ACCEPTED_PR_2E_CANDIDATE_SHA,
    lane: "alpaca-historical-sip",
    kind,
    route,
    entitlementSnapshotId: value["entitlementSnapshotId"],
    aliasAuthorityCatalogId: value["aliasAuthorityCatalogId"],
    instruments,
    queryFields: query.fields,
    queryStartNs: query.startNs,
    queryEndNs: query.endNs,
    trustedRequestStartedAtNs: clock.trustedStartedNs,
    trustedClockEvidence: clock.evidence,
    requestIdentityHash,
    acquisitionConfigurationHash,
    liveEnabled: true,
    authorizationMode: AUTHORIZATION_MODE,
    capability: "historical-market-reference",
    sourceRole: "primary",
    fallbackKind: "none",
    zeroIncrementalSpend: true,
    costStatus: "zero-incremental-spend-approved",
    zeroSpendPolicyId: ZERO_SPEND_POLICY_ID,
    runDecision: "allow",
    retentionPolicyReadiness: "ready",
  });
}

export function validateMarketAcquisitionConfiguration(
  input: unknown,
): MarketAcquisitionResult<ValidatedMarketAcquisitionConfiguration> {
  try {
    return Object.freeze({ ok: true, value: parseConfiguration(input) });
  } catch (error) {
    const failure =
      error instanceof ClosedFailure
        ? error
        : new ClosedFailure("configuration-invalid", "configuration", "input-shape-invalid");
    return Object.freeze({
      ok: false,
      error: createMarketAcquisitionSafeError(
        failure.reasonCode,
        failure.operationStage,
        failure.detailKind,
      ),
    });
  }
}
