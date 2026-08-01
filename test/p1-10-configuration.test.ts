import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "../src/core/hash.js";
import {
  ACCEPTED_PR_2E_CANDIDATE_SHA,
  createMarketAcquisitionSafeError,
  type MarketAcquisitionConfigurationInput,
} from "../src/adapters/market-acquisition/contracts.js";
import { validateMarketAcquisitionConfiguration } from "../src/adapters/market-acquisition/configuration.js";
import {
  ALPACA_ROUTE_REGISTRY,
  FMP_DISABLED_ROUTE_REGISTRY,
  FROZEN_MARKET_IDENTITIES,
  validateFrozenMarketIdentityRegistry,
  ZERO_SPEND_POLICY_ID,
  ZERO_SPEND_POLICY_PREIMAGE,
} from "../src/adapters/market-acquisition/identity.js";

const FETCH = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (() => {
  networkCalls += 1;
  throw new Error("network forbidden");
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = FETCH;
});

const WALL_NS = 1_800_000_000_000_000_000n;
const END_NS = WALL_NS - 900_000_000_000n;
const SESSION = "configuration-test-session";
const BASIS_PREIMAGE = Object.freeze({
  wallClock: "system-utc",
  synchronization: "verified-bound",
  maximumErrorMs: 0,
  monotonicClock: "process-monotonic-us",
  monotonicSessionId: SESSION,
});
const BASIS_ID = `clk1_${canonicalHash("peas/clock-basis/v1", BASIS_PREIMAGE)}`;

function canonicalTimestamp(epochNs: bigint): string {
  const milliseconds = epochNs / 1_000_000n;
  const fraction = (epochNs % 1_000_000_000n).toString().padStart(9, "0");
  return `${new Date(Number(milliseconds)).toISOString().slice(0, 19)}.${fraction}Z`;
}

function clockEvidence() {
  return {
    available: true,
    basisId: BASIS_ID,
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorNs: 0n,
    maximumErrorBounded: true,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: SESSION,
    priorSample: {
      sampleId: "prior",
      previousSampleId: null,
      basisId: BASIS_ID,
      wallClock: "system-utc",
      synchronization: "verified-bound",
      wallNs: WALL_NS - 1n,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: SESSION,
      monotonicUs: 100n,
    },
    currentSample: {
      sampleId: "current",
      previousSampleId: "prior",
      basisId: BASIS_ID,
      wallClock: "system-utc",
      synchronization: "verified-bound",
      wallNs: WALL_NS,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: SESSION,
      monotonicUs: 101n,
    },
  };
}

function baseConfiguration(
  kind: "quotes" | "trades" | "bars" = "quotes",
): MarketAcquisitionConfigurationInput {
  const route = ALPACA_ROUTE_REGISTRY[kind];
  const common = {
    symbols: "QA,QB",
    start: canonicalTimestamp(END_NS - 60_000_000_000n),
    end: canonicalTimestamp(END_NS),
    limit: "10000",
    feed: "sip",
    sort: "asc",
  };
  return {
    schemaVersion: 1,
    acceptedContractCandidateSha: ACCEPTED_PR_2E_CANDIDATE_SHA,
    lane: "alpaca-historical-sip",
    kind,
    providerId: route.providerId,
    datasetId: route.datasetId,
    feedId: route.feedId,
    endpointChannelId: route.endpointChannelId,
    entitlementSnapshotId: `ent1_${"a".repeat(64)}`,
    routePolicyVersion: "p1-10-frozen-historical-multi-symbol-v1",
    aliasAuthorityCatalogId: `maac1_${"b".repeat(64)}`,
    instruments: [
      { instrumentId: `min1_${"1".repeat(64)}`, symbol: "QA" },
      { instrumentId: `min1_${"2".repeat(64)}`, symbol: "QB" },
    ],
    queryFields: kind === "bars" ? { ...common, timeframe: "1Min", adjustment: "raw" } : common,
    trustedClockEvidence: clockEvidence(),
    liveEnabled: true,
    authorizationMode: "p1-09-approved",
    capability: "historical-market-reference",
    sourceRole: "primary",
    fallbackKind: "none",
    zeroIncrementalSpend: true,
    costStatus: "zero-incremental-spend-approved",
    zeroSpendPolicyId: ZERO_SPEND_POLICY_ID,
    zeroSpendPolicyPreimage: ZERO_SPEND_POLICY_PREIMAGE,
    runDecision: "allow",
    retentionPolicyReadiness: "ready",
  };
}

function expectFailure(input: unknown, reasonCode: string, operationStage?: string): void {
  const before = networkCalls;
  const result = validateMarketAcquisitionConfiguration(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.reasonCode, reasonCode);
  if (operationStage !== undefined) assert.equal(result.error.operationStage, operationStage);
  assert.match(result.error.detailHash, /^[0-9a-f]{64}$/u);
  assert.deepEqual(Object.keys(result.error).sort(), [
    "detailHash",
    "operationStage",
    "reasonCode",
  ]);
  assert.equal(networkCalls, before);
}

test("all frozen identities and the closed route registry recompute without network access", () => {
  validateFrozenMarketIdentityRegistry();
  assert.equal(Object.keys(ALPACA_ROUTE_REGISTRY).length, 3);
  assert.equal(Object.keys(FMP_DISABLED_ROUTE_REGISTRY).length, 2);
  assert.equal(ALPACA_ROUTE_REGISTRY.quotes.origin, "https://data.alpaca.markets");
  assert.equal(ALPACA_ROUTE_REGISTRY.quotes.path, "/v2/stocks/quotes");
  assert.equal(ALPACA_ROUTE_REGISTRY.trades.path, "/v2/stocks/trades");
  assert.equal(ALPACA_ROUTE_REGISTRY.bars.path, "/v2/stocks/bars");
  assert.equal(
    ALPACA_ROUTE_REGISTRY.bars.endpointChannelId,
    FROZEN_MARKET_IDENTITIES.alpaca.barsChannelId,
  );
  assert.equal(networkCalls, 0);
});

test("closed Alpaca configurations compile exact routes, query semantics, and stable identities", () => {
  const hashes = new Set<string>();
  for (const kind of ["quotes", "trades", "bars"] as const) {
    const result = validateMarketAcquisitionConfiguration(baseConfiguration(kind));
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.value.route, ALPACA_ROUTE_REGISTRY[kind]);
    assert.equal(result.value.route.method, "GET");
    assert.equal(result.value.queryFields.feed, "sip");
    assert.equal(result.value.queryFields.sort, "asc");
    assert.equal(result.value.trustedRequestStartedAtNs, WALL_NS);
    assert.match(result.value.requestIdentityHash, /^[0-9a-f]{64}$/u);
    assert.match(result.value.acquisitionConfigurationHash, /^[0-9a-f]{64}$/u);
    hashes.add(result.value.requestIdentityHash);
  }
  assert.equal(hashes.size, 3);
  assert.equal(networkCalls, 0);
});

test("configuration has no arbitrary transport surface and unknown fields fail closed", () => {
  for (const [key, value] of [
    ["origin", "https://example.invalid"],
    ["baseUrl", "https://example.invalid"],
    ["path", "/v2/stocks/snapshots"],
    ["method", "POST"],
    ["url", "https://example.invalid/secret?token=value"],
    ["headers", { authorization: "credential-shaped" }],
    ["endpoint", "latest"],
  ] as const) {
    expectFailure(
      { ...baseConfiguration(), [key]: value },
      "configuration-invalid",
      "configuration",
    );
  }
});

test("live defaults and every authorization or zero-spend weakening reject before side effects", () => {
  const absentLive = { ...baseConfiguration() } as Record<string, unknown>;
  delete absentLive["liveEnabled"];
  expectFailure(absentLive, "configuration-invalid", "configuration");
  expectFailure({ ...baseConfiguration(), liveEnabled: false }, "lane-not-authorized");
  expectFailure(
    { ...baseConfiguration(), acceptedContractCandidateSha: "0".repeat(40) },
    "authority-invalid",
  );
  expectFailure({ ...baseConfiguration(), authorizationMode: "pending" }, "authority-invalid");
  expectFailure({ ...baseConfiguration(), fallbackKind: "fmp" }, "authority-invalid");
  expectFailure({ ...baseConfiguration(), sourceRole: "fallback" }, "lane-not-authorized");
  expectFailure({ ...baseConfiguration(), zeroIncrementalSpend: false }, "zero-spend-unprovable");
  expectFailure({ ...baseConfiguration(), costStatus: "unknown" }, "zero-spend-unprovable");
  expectFailure({ ...baseConfiguration(), runDecision: "reject" }, "zero-spend-unprovable");
  expectFailure(
    { ...baseConfiguration(), zeroSpendPolicyId: `mzp1_${"0".repeat(64)}` },
    "zero-spend-unprovable",
  );
});

test("source tuple and channel mutations cannot select an origin, path, feed, or route", () => {
  for (const mutation of [
    { providerId: FROZEN_MARKET_IDENTITIES.fmp.providerId },
    { datasetId: FROZEN_MARKET_IDENTITIES.fmp.datasetId },
    { feedId: FROZEN_MARKET_IDENTITIES.fmp.feedId },
    { endpointChannelId: FROZEN_MARKET_IDENTITIES.alpaca.barsChannelId },
    { routePolicyVersion: "caller-route-policy" },
  ]) {
    expectFailure({ ...baseConfiguration(), ...mutation }, "identity-mismatch", "identity");
  }
});

test("FMP is an exact known but disabled lane and never becomes primary or fallback", () => {
  const fmp = {
    ...baseConfiguration(),
    lane: "fmp-private-discrepancy",
    providerId: FROZEN_MARKET_IDENTITIES.fmp.providerId,
    datasetId: FROZEN_MARKET_IDENTITIES.fmp.datasetId,
    feedId: FROZEN_MARKET_IDENTITIES.fmp.feedId,
    endpointChannelId: FROZEN_MARKET_IDENTITIES.fmp.quoteChannelId,
    sourceRole: "private-discrepancy",
  };
  expectFailure(fmp, "lane-not-implemented", "authority");
  expectFailure({ ...fmp, sourceRole: "primary" }, "lane-not-implemented", "authority");
  expectFailure({ ...fmp, fallbackKind: "alpaca" }, "authority-invalid", "authority");
});

test("query allowlist rejects missing, wrong, and unlisted semantics", () => {
  const baseline = baseConfiguration();
  const fields = baseline.queryFields as Record<string, unknown>;
  for (const mutation of [
    { ...fields, feed: "iex" },
    { ...fields, sort: "desc" },
    { ...fields, snapshot: "true" },
    { ...fields, page_token: "first-page-token" },
    { ...fields, symbols: "QB,QA" },
  ]) {
    expectFailure({ ...baseline, queryFields: mutation }, "query-invalid");
  }
  expectFailure({ ...baseline, queryFields: { ...fields, limit: "10001" } }, "bound-exceeded");
  const bars = baseConfiguration("bars");
  expectFailure(
    { ...bars, queryFields: { ...(bars.queryFields as object), timeframe: "5Min" } },
    "query-invalid",
  );
  expectFailure(
    { ...bars, queryFields: { ...(bars.queryFields as object), adjustment: "split" } },
    "query-invalid",
  );
});

test("trusted clock equality passes and one nanosecond newer, forged basis, and regression reject", () => {
  const equality = validateMarketAcquisitionConfiguration(baseConfiguration());
  assert.equal(equality.ok, true);

  const newer = baseConfiguration();
  expectFailure(
    {
      ...newer,
      queryFields: {
        ...(newer.queryFields as Record<string, unknown>),
        end: canonicalTimestamp(END_NS + 1n),
      },
    },
    "historical-boundary-unprovable",
    "trusted-time",
  );
  expectFailure(
    {
      ...baseConfiguration(),
      trustedClockEvidence: { ...clockEvidence(), basisId: `clk1_${"0".repeat(64)}` },
    },
    "clock-unavailable",
    "trusted-time",
  );
  const regression = clockEvidence();
  expectFailure(
    {
      ...baseConfiguration(),
      trustedClockEvidence: {
        ...regression,
        currentSample: {
          ...regression.currentSample,
          wallNs: regression.priorSample.wallNs - 1n,
        },
      },
    },
    "clock-regression",
    "trusted-time",
  );
  for (const mutation of [
    { synchronization: "network-time" },
    { maximumErrorNs: null },
    { maximumErrorBounded: false },
    { monotonicClock: "performance-now" },
  ]) {
    expectFailure(
      { ...baseConfiguration(), trustedClockEvidence: { ...clockEvidence(), ...mutation } },
      "clock-unavailable",
      "trusted-time",
    );
  }
});

test("hostile accessors and proxies collapse to the same non-secret typed error", () => {
  const hostile = Object.defineProperty({}, "schemaVersion", {
    enumerable: true,
    get() {
      throw new Error("credential-shaped getter must not run");
    },
  });
  expectFailure(hostile, "configuration-invalid", "configuration");
  expectFailure(
    new Proxy(baseConfiguration(), {
      ownKeys() {
        throw new Error("hostile proxy trap");
      },
    }),
    "configuration-invalid",
    "configuration",
  );
});

test("safe-error construction is closed even for runtime-unsafe JavaScript callers", () => {
  const safe = createMarketAcquisitionSafeError(
    "provider-text" as never,
    "provider-stage" as never,
    "provider-detail" as never,
  );
  assert.deepEqual(Object.keys(safe).sort(), ["detailHash", "operationStage", "reasonCode"]);
  assert.equal(safe.reasonCode, "configuration-invalid");
  assert.equal(safe.operationStage, "configuration");
  assert.match(safe.detailHash, /^[0-9a-f]{64}$/u);
});
