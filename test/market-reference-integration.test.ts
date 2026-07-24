import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { normalizeRecordedMarketRecord } from "../src/providers/market-reference/normalization.js";
import { selectMarketReference } from "../src/providers/market-reference/selection.js";
import {
  loadCheckedRecordedMarketFixture,
  marketRequest,
  normalizeQuote,
  quoteRecord,
  tradeRecord,
} from "./market-reference-scenario.js";

function canonical(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

test("arrival order and duplicate redelivery cannot change a selected reference", () => {
  const oldQuote = normalizeQuote({
    eventTimeNs: "100000000000",
    family: "integration-old-quote",
    revisionKey: "old-1",
    bid: "10.00",
    ask: "10.02",
  });
  const latest = normalizeQuote({
    eventTimeNs: "104000000000",
    family: "integration-latest-quote",
    revisionKey: "latest-1",
    bid: "11.00",
    ask: "11.02",
  });
  const redelivery = normalizeQuote({
    eventTimeNs: "104000000000",
    family: "integration-latest-quote",
    revisionKey: "latest-1",
    bid: "11.00",
    ask: "11.02",
    memberKey: "redelivered-page-member",
    occurrenceOrdinal: 1,
  });
  const request = marketRequest({ facts: [oldQuote, latest, redelivery] });
  const baseline = selectMarketReference(request, [oldQuote, latest, redelivery]);
  const permuted = selectMarketReference(request, [redelivery, oldQuote, latest]);

  assert.equal(canonical(permuted), canonical(baseline));
  assert.equal(baseline.status, "selected-complete");
  assert.equal(baseline.selectedNormalizedMarketFactId, latest.normalizedMarketFactId);
  assert.ok(Object.isFrozen(baseline));
  assert.ok(Object.isFrozen(baseline.candidates));
});

test("primary, corrected, and cancelled views remain immutable and explicitly distinct", () => {
  const originalRecord = quoteRecord({
    family: "integration-revision-family",
    revisionKey: "revision-original",
    bid: "20.00",
    ask: "20.02",
  });
  const original = normalizeRecordedMarketRecord(originalRecord);
  const correction = normalizeRecordedMarketRecord(
    quoteRecord({
      family: "integration-revision-family",
      revisionKey: "revision-correction",
      revisionKind: "correction",
      supersedesRevisionId: original.revisionId,
      bid: "21.00",
      ask: "21.02",
      primaryCorpusMember: false,
      durablyRecordedAtMs: 106_000,
    }),
  );
  const cancellation = normalizeRecordedMarketRecord(
    quoteRecord({
      family: "integration-revision-family",
      revisionKey: "revision-cancellation",
      revisionKind: "cancellation",
      supersedesRevisionId: correction.revisionId,
      primaryCorpusMember: false,
      durablyRecordedAtMs: 107_000,
    }),
  );

  const primary = selectMarketReference(marketRequest({ facts: [original] }), [original]);
  const correctedFacts = [correction, original];
  const corrected = selectMarketReference(
    marketRequest({ viewKind: "recorded-corrected", facts: correctedFacts }),
    correctedFacts,
  );
  const cancelledFacts = [cancellation, correction, original];
  const cancelled = selectMarketReference(
    marketRequest({ viewKind: "recorded-corrected", facts: cancelledFacts }),
    cancelledFacts,
  );

  assert.equal(primary.status, "selected-complete");
  assert.equal(primary.selectedRevisionId, original.revisionId);
  assert.equal(corrected.status, "selected-complete");
  assert.equal(corrected.selectedRevisionId, correction.revisionId);
  assert.notEqual(corrected.selectedReferenceId, primary.selectedReferenceId);
  assert.equal(cancelled.status, "missing");
  assert.equal(cancelled.selectedReferenceId, null);
});

test("trade evidence never silently substitutes for an NBBO quote", () => {
  const trade = normalizeRecordedMarketRecord(tradeRecord());
  const quoteResult = selectMarketReference(marketRequest({ facts: [trade] }), [trade]);
  const tradeResult = selectMarketReference(
    marketRequest({ referenceKind: "trade-last-eligible-consolidated", facts: [trade] }),
    [trade],
  );

  assert.equal(quoteResult.status, "missing");
  assert.equal(quoteResult.reason?.code, "market.no-eligible-quote");
  assert.equal(tradeResult.status, "selected-complete");
  assert.notEqual(tradeResult.selectedReferenceId, quoteResult.missingReferenceId);
});

test("checked manifest drives verified artifacts through normalization and selection", async () => {
  const loaded = await loadCheckedRecordedMarketFixture();
  assert.equal(loaded.result.status, "verified");
  assert.equal(loaded.result.members.length, loaded.manifest.retrievedMembers.length);
  assert.equal(loaded.result.normalizedFacts.length, loaded.manifest.parsedFactExpectations.length);
  assert.equal(loaded.result.evaluations.length, loaded.manifest.expectedEvaluations.length);
  assert.ok(loaded.result.members.every((member) => member.rawArtifactId.startsWith("mar1_")));
  assert.ok(
    loaded.result.normalizedFacts.every(
      (fact) => fact.normalizedMarketFactId?.startsWith("mnf1_") === true,
    ),
  );
  assert.ok(
    loaded.result.evaluations.some(
      (evaluation) =>
        evaluation.status === "selected-complete" &&
        evaluation.selectedReferenceId?.startsWith("msr1_") === true,
    ),
  );
  assert.ok(loaded.result.evaluations.some((evaluation) => evaluation.status === "missing"));
});

test("production market-reference modules have no acquisition or financial-effect import surface", () => {
  const roots = [
    join("src", "providers", "market-reference"),
    join("src", "adapters", "market-reference"),
    join("src", "study", "market-reference"),
  ];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
    }
  };
  for (const root of roots) visit(root);

  assert.ok(files.length >= 10);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|undici|ws)["']/u,
      file,
    );
    assert.doesNotMatch(source, /\bfetch\s*\(|\bnew\s+WebSocket\b/u, file);
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:broker|order|portfolio|position|fill|execution)[^"']*["']/iu,
      file,
    );
    assert.doesNotMatch(source, /effectsAllowed\s*:\s*true/u, file);
  }
});
