import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ACCEPTED_PR_2E_CANDIDATE_SHA,
  type MarketAcquisitionConfigurationInput,
} from "../src/adapters/market-acquisition/contracts.js";
import { validateMarketAcquisitionConfiguration } from "../src/adapters/market-acquisition/configuration.js";
import {
  ALPACA_ROUTE_REGISTRY,
  ZERO_SPEND_POLICY_ID,
  ZERO_SPEND_POLICY_PREIMAGE,
} from "../src/adapters/market-acquisition/identity.js";
import { canonicalHash } from "../src/core/hash.js";
import type { JsonValue } from "../src/core/json.js";
import { deriveInstrumentId } from "../src/providers/market-reference/identity.js";
import { deriveIssuerMappingId } from "../src/providers/observation-ledger.js";

const catalogPath = path.join(
  process.cwd(),
  "config",
  "event-beta",
  "2026-09-02-to-2026-09-03.alias-authority-catalog.json",
);
const capabilityPath = path.join(
  process.cwd(),
  "config",
  "event-beta",
  "2026-09-02-to-2026-09-03.provider-capabilities.json",
);

type AliasRecord = Readonly<{
  canonicalSymbol: string;
  issuerMappingPreimage: Parameters<typeof deriveIssuerMappingId>[0];
  issuerMappingId: string;
  instrumentPreimage: Parameters<typeof deriveInstrumentId>[0];
  instrumentId: string;
  symbolAliasPreimage: Record<string, unknown>;
  symbolAliasId: string;
}>;

type Catalog = Readonly<{
  schemaVersion: string;
  classification: string;
  providerEvidence: boolean;
  networkAuthorized: boolean;
  records: AliasRecord[];
  catalogId: string;
}>;

type Candidate = Readonly<{
  ticker: string;
  marketSymbol: string;
  sectorSymbol: string;
  barQueryWindow: Readonly<{ start: string; end: string }>;
}>;

const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Catalog;
const capabilities = JSON.parse(readFileSync(capabilityPath, "utf8")) as {
  providers: { alpacaHistoricalSipBars: { aliasAuthorityCatalogId: string } };
  candidates: Candidate[];
};

function instantNs(value: string): bigint {
  return BigInt(Date.parse(`${value.slice(0, 23)}Z`)) * 1_000_000n + BigInt(value.slice(20, 29));
}

function trustedClockEvidence(wallNs: bigint, session: string) {
  const basis = {
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorMs: 0,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: session,
  };
  const basisId = `clk1_${canonicalHash("peas/clock-basis/v1", basis)}`;
  return {
    available: true,
    basisId,
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorNs: 0n,
    maximumErrorBounded: true,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: session,
    priorSample: {
      sampleId: `${session}-prior`,
      previousSampleId: null,
      basisId,
      wallClock: "system-utc",
      synchronization: "verified-bound",
      wallNs: wallNs - 1n,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: session,
      monotonicUs: 1n,
    },
    currentSample: {
      sampleId: `${session}-current`,
      previousSampleId: `${session}-prior`,
      basisId,
      wallClock: "system-utc",
      synchronization: "verified-bound",
      wallNs,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: session,
      monotonicUs: 2n,
    },
  };
}

test("five-event alias catalog freezes canonical issuer, instrument, alias, and catalog identities", () => {
  assert.deepEqual(
    catalog.records.map(({ canonicalSymbol }) => canonicalSymbol),
    ["AVGO", "CIEN", "DOCU", "HPE", "LULU", "SPY", "XLK", "XLY"],
  );
  for (const record of catalog.records) {
    assert.equal(record.issuerMappingId, deriveIssuerMappingId(record.issuerMappingPreimage));
    assert.equal(record.instrumentId, deriveInstrumentId(record.instrumentPreimage));
    assert.equal(
      record.symbolAliasId,
      `msa1_${canonicalHash(
        "peas/market-symbol-alias/v1",
        record.symbolAliasPreimage as unknown as JsonValue,
      )}`,
    );
  }
  const preimage = {
    schemaVersion: catalog.schemaVersion,
    classification: catalog.classification,
    providerEvidence: catalog.providerEvidence,
    networkAuthorized: catalog.networkAuthorized,
    records: catalog.records,
  };
  assert.equal(
    catalog.catalogId,
    `maac1_${canonicalHash(
      "peas/market-acquisition-alias-authority-catalog/v1",
      preimage as unknown as JsonValue,
    )}`,
  );
  assert.equal(
    capabilities.providers.alpacaHistoricalSipBars.aliasAuthorityCatalogId,
    catalog.catalogId,
  );
});

test("all five proposed bar mappings pass the existing acquisition validator provider-free", () => {
  const instrumentBySymbol = new Map(
    catalog.records.map((record) => [record.canonicalSymbol, record.instrumentId]),
  );
  const validationOnlyEntitlementSnapshotId = `ent1_${canonicalHash(
    "peas/event-beta/provider-free-validation-entitlement/v1",
    { authorizationGranted: false, credentialRead: false, providerRequest: false },
  )}`;
  for (const candidate of capabilities.candidates) {
    const symbols = [candidate.marketSymbol, "SPY", candidate.sectorSymbol].sort();
    const instruments = symbols.map((symbol) => {
      const instrumentId = instrumentBySymbol.get(symbol);
      assert.notEqual(instrumentId, undefined);
      return { instrumentId: instrumentId as string, symbol };
    });
    const endNs = instantNs(candidate.barQueryWindow.end);
    const route = ALPACA_ROUTE_REGISTRY.bars;
    const input: MarketAcquisitionConfigurationInput = {
      schemaVersion: 1,
      acceptedContractCandidateSha: ACCEPTED_PR_2E_CANDIDATE_SHA,
      lane: "alpaca-historical-sip",
      kind: "bars",
      providerId: route.providerId,
      datasetId: route.datasetId,
      feedId: route.feedId,
      endpointChannelId: route.endpointChannelId,
      entitlementSnapshotId: validationOnlyEntitlementSnapshotId,
      routePolicyVersion: "p1-10-frozen-historical-multi-symbol-v1",
      aliasAuthorityCatalogId: catalog.catalogId,
      instruments,
      queryFields: {
        symbols: symbols.join(","),
        start: candidate.barQueryWindow.start,
        end: candidate.barQueryWindow.end,
        limit: "10000",
        feed: "sip",
        sort: "asc",
        timeframe: "1Min",
        adjustment: "raw",
      },
      trustedClockEvidence: trustedClockEvidence(
        endNs + 900_000_000_000n,
        `event-beta-${candidate.ticker.toLowerCase()}`,
      ),
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
    const result = validateMarketAcquisitionConfiguration(input);
    assert.equal(result.ok, true, result.ok ? undefined : result.error.reasonCode);
    if (!result.ok) continue;
    assert.equal(result.value.aliasAuthorityCatalogId, catalog.catalogId);
    assert.deepEqual(result.value.instruments, instruments);
  }
});
