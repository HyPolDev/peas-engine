import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  evaluateRecordedMarketFixtureSelections,
  loadRecordedMarketArtifacts,
  loadRecordedMarketFixture,
  normalizeVerifiedRecordedMarketFixture,
  recordedMarketArtifactProjection,
  recordedMarketCatalogEvidence,
  type VerifiedRecordedMarketMemberV1,
} from "../src/adapters/market-reference/recorded-market-loader.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import type { NormalizedMarketFactV1 } from "../src/providers/market-reference/contracts.js";
import { normalizeRecordedMarketRecord } from "../src/providers/market-reference/normalization.js";
import { selectMarketReference } from "../src/providers/market-reference/selection.js";
import {
  checkedRecordedMarketFixtureAuthority,
  loadCheckedRecordedMarketFixture,
  marketRequest,
  normalizeQuote,
  quoteRecord,
} from "./market-reference-scenario.js";
import { recordedFixtureArtifactStore } from "./recorded-fixture-artifact-store.js";

function canonical(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

function assertReplayCatalogBinding(caseId: "O-01" | "O-02", expectedOutcome: string): void {
  const row = recordedMarketCatalogEvidence().find((entry) => entry["caseId"] === caseId);
  assert.deepEqual(row, {
    caseId,
    enforcementOwner: "integration-replay",
    testVectorId: `replay:${caseId}:v1`,
    expectedOutcome,
  });
}

function replayWithPageSize(
  source: readonly NormalizedMarketFactV1[],
  pageSize: number,
): ReturnType<typeof selectMarketReference> {
  const restarted: NormalizedMarketFactV1[] = [];
  for (let index = 0; index < source.length; index += pageSize) {
    const page = source.slice(index, index + pageSize);
    const durableCheckpoint = canonical([...restarted, ...page]);
    restarted.splice(
      0,
      restarted.length,
      ...(JSON.parse(durableCheckpoint) as NormalizedMarketFactV1[]),
    );
  }
  return selectMarketReference(marketRequest({ facts: restarted }), restarted);
}

test("[O-01] recorded replay is invariant to page size, restart serialization, and input order", () => {
  assertReplayCatalogBinding("O-01", "permutation-semantic-identities-unchanged");
  const facts = [
    normalizeQuote({
      eventTimeNs: "101000000000",
      family: "replay-quote-1",
      revisionKey: "r1",
      bid: "30.00",
      ask: "30.02",
    }),
    normalizeQuote({
      eventTimeNs: "102000000000",
      family: "replay-quote-2",
      revisionKey: "r2",
      bid: "31.00",
      ask: "31.02",
    }),
    normalizeQuote({
      eventTimeNs: "104000000000",
      family: "replay-quote-3",
      revisionKey: "r3",
      bid: "32.00",
      ask: "32.02",
    }),
  ];
  const expected = replayWithPageSize(facts, 1);

  for (const pageSize of [1, 2, 7, 10_000]) {
    assert.equal(canonical(replayWithPageSize(facts, pageSize)), canonical(expected));
    assert.equal(
      canonical(replayWithPageSize([...facts].reverse(), pageSize)),
      canonical(expected),
    );
  }
});

test("[O-02] trusted source sequence controls when arrival order contradicts it", () => {
  assertReplayCatalogBinding("O-02", "trusted-sequence-controls-arrival-preserved");
  const first = normalizeRecordedMarketRecord({
    ...quoteRecord({
      eventTimeNs: "103000000000",
      family: "o-02-first",
      revisionKey: "o-02-first",
      bid: "20.00",
      ask: "20.02",
    }),
    providerSequence: {
      value: "1",
      scope: "o-02-synthetic-session",
      trustClass: "native-gap-checked",
    },
  });
  const second = normalizeRecordedMarketRecord({
    ...quoteRecord({
      eventTimeNs: "103000000000",
      family: "o-02-second",
      revisionKey: "o-02-second",
      bid: "21.00",
      ask: "21.02",
    }),
    providerSequence: {
      value: "2",
      scope: "o-02-synthetic-session",
      trustClass: "native-gap-checked",
    },
  });
  const facts = [first, second];
  const request = marketRequest({ facts });
  const sourceOrder = selectMarketReference(request, facts);
  const contradictoryArrival = selectMarketReference(request, [...facts].reverse());

  assert.equal(sourceOrder.status, "selected-complete");
  assert.deepEqual(sourceOrder.exactPrice, { numerator: "2101", denominator: "100" });
  assert.equal(canonical(contradictoryArrival), canonical(sourceOrder));
});

test("capture primary and retrieval sensitivity keep semantic fact identity but not branch identity", () => {
  const facts = [normalizeQuote({ eventTimeNs: "104000000000" })];
  const capture = selectMarketReference(marketRequest({ basis: "capture", facts }), facts);
  const retrieval = selectMarketReference(marketRequest({ basis: "retrieval", facts }), facts);

  assert.equal(capture.status, "selected-complete");
  assert.equal(retrieval.status, "selected-complete");
  assert.equal(capture.selectedNormalizedMarketFactId, retrieval.selectedNormalizedMarketFactId);
  assert.notEqual(capture.selectedReferenceId, retrieval.selectedReferenceId);
  assert.notEqual(
    marketRequest({ basis: "capture", facts }).marketReferenceJoinKey,
    marketRequest({ basis: "retrieval", facts }).marketReferenceJoinKey,
  );
});

test("checked ArtifactStore bytes produce byte-identical facts and evaluations after cold restarts", async () => {
  const first = await loadCheckedRecordedMarketFixture();
  assert.equal(first.result.status, "verified");
  assert.ok(first.result.normalizedFacts.length > 0);
  assert.ok(first.result.evaluations.length > 0);
  const replayProjection = (loaded: typeof first.result): string =>
    canonical({
      status: loaded.status,
      normalizedFacts: loaded.normalizedFacts,
      evaluations: loaded.evaluations,
      members: loaded.members.map((member) => ({
        role: member.role,
        artifactContentId: member.artifactContentId,
        rawArtifactId: member.rawArtifactId,
        selectedObservationId: member.selectedObservationId,
        selectedObservationHash: member.selectedObservationHash,
      })),
    });
  const expected = replayProjection(first.result);

  for (const restart of [1, 2, 3, 4]) {
    const loaded = await loadCheckedRecordedMarketFixture();
    assert.equal(loaded.result.status, "verified", `restart ${restart}`);
    assert.equal(replayProjection(loaded.result), expected, `restart ${restart}`);
    for (const member of loaded.result.members) {
      assert.equal(loaded.counters.readCalls.get(member.artifactDigest), 1);
      assert.equal(loaded.counters.streamStarts.get(member.artifactDigest), 1);
      assert.equal(loaded.counters.streamSettles.get(member.artifactDigest), 1);
    }
  }
});

test("recorded fixture resumes deterministically at every lookup/read/normalize/select boundary", async () => {
  const authority = await checkedRecordedMarketFixtureAuthority();
  const baselineAuthority = recordedFixtureArtifactStore(authority.fixtureRoot, authority.seeds);
  const baseline = await loadRecordedMarketFixture(baselineAuthority.store, authority.manifest);
  assert.equal(baseline.status, "verified");

  const beforeLookupAuthority = recordedFixtureArtifactStore(
    authority.fixtureRoot,
    authority.seeds,
  );
  const beforeLookup = await loadRecordedMarketFixture(
    {
      ...beforeLookupAuthority.store,
      async getObservation() {
        throw new Error("synthetic restart before observation lookup");
      },
    },
    authority.manifest,
  );
  assert.equal(beforeLookup.status, "rejected");

  const afterLookupAuthority = recordedFixtureArtifactStore(
    authority.fixtureRoot,
    authority.seeds,
    { readError: () => new Error("synthetic restart after observation lookup") },
  );
  const afterLookup = await loadRecordedMarketFixture(
    afterLookupAuthority.store,
    authority.manifest,
  );
  assert.equal(afterLookup.status, "rejected");
  assert.equal(
    [...afterLookupAuthority.counters.observationCalls.values()].reduce(
      (total, count) => total + count,
      0,
    ),
    authority.seeds.length,
  );

  const verifiedReadAuthority = recordedFixtureArtifactStore(
    authority.fixtureRoot,
    authority.seeds,
  );
  const verified = await loadRecordedMarketArtifacts(
    verifiedReadAuthority.store,
    recordedMarketArtifactProjection(authority.manifest),
  );
  assert.equal(verified.status, "verified");
  const memberCheckpoint = canonical(
    verified.members.map((member) => ({
      ...member,
      bytes: Buffer.from(member.bytes).toString("base64"),
    })),
  );
  const resumedMembers = (
    JSON.parse(memberCheckpoint) as Array<
      Omit<VerifiedRecordedMarketMemberV1, "bytes"> & { bytes: string }
    >
  ).map(
    ({ bytes, ...member }): VerifiedRecordedMarketMemberV1 => ({
      ...member,
      bytes: Uint8Array.from(Buffer.from(bytes, "base64")),
    }),
  );
  const normalized = normalizeVerifiedRecordedMarketFixture(authority.manifest, resumedMembers);
  assert.equal(canonical(normalized), canonical(baseline.normalizedFacts));

  const factCheckpoint = canonical(normalized);
  const resumedFacts = JSON.parse(factCheckpoint) as NormalizedMarketFactV1[];
  const evaluations = evaluateRecordedMarketFixtureSelections(authority.manifest, resumedFacts);
  assert.equal(canonical(evaluations), canonical(baseline.evaluations));

  const cleanRestart = await loadCheckedRecordedMarketFixture();
  assert.equal(cleanRestart.result.status, "verified");
  assert.equal(canonical(cleanRestart.result.normalizedFacts), canonical(baseline.normalizedFacts));
  assert.equal(canonical(cleanRestart.result.evaluations), canonical(baseline.evaluations));
});
