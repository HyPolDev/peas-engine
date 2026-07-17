import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { FMP_FIXTURE_CASES, type FmpFixtureCase } from "../fixtures/fmp/v1/manifest.js";
import {
  assertFmpTranscriptBytesWithinLimit,
  loadRecordedFmpFixture,
} from "../src/adapters/fmp/recorded-fmp-fixture.js";
import {
  FMP_MAX_DECODED_BYTES,
  FMP_MAX_JSON_DEPTH,
  FMP_MAX_JSON_TOKENS,
  FMP_MAX_RESPONSE_BYTES,
  FMP_MAX_TRANSCRIPT_BYTES,
  type FmpRecordedRouteV1,
} from "../src/providers/fmp/contracts.js";
import { FmpJsonError, parseFmpJson } from "../src/providers/fmp/json.js";
import {
  inspectRecordedFmpCollection,
  normalizeRecordedFmpCollection,
} from "../src/providers/fmp/normalizer.js";

const FIXTURE_ROOT = path.resolve("fixtures/fmp/v1");
const ZERO_SELECTOR = {
  recordId: `fmp-recorded-synthetic:${"0".repeat(64)}`,
  revisionId: `sha256:${"0".repeat(64)}`,
} as const;
const ROUTE = {
  classification: "earnings-release",
  issuerMapping: { issuerCik: "0000000001", symbol: "SYNX", fiscalPeriod: "2026-Q1" },
  mappingAuthority: "peas-synthetic-fixture",
  mappingVersion: "1",
} as const satisfies FmpRecordedRouteV1;

async function bytesFor(fixture: FmpFixtureCase): Promise<Buffer> {
  return readFile(path.join(FIXTURE_ROOT, fixture.retrievedMembers[0].path));
}

async function load(fixture: FmpFixtureCase) {
  return loadRecordedFmpFixture({ fixtureRoot: FIXTURE_ROOT, manifest: fixture });
}

function emitted(caseId: string) {
  const fixture = FMP_FIXTURE_CASES.find((candidate) => candidate.caseId === caseId);
  assert.ok(fixture);
  return fixture;
}

test("synthetic latest/search manifests pin canonical candidate and draft hashes", async () => {
  for (const fixture of FMP_FIXTURE_CASES) {
    const member = fixture.retrievedMembers[0];
    const bytes = await bytesFor(fixture);
    assert.equal(bytes.byteLength, member.sizeBytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), member.artifactHash);
    assert.equal(member.observation.artifactDigest, member.artifactHash);
    assert.equal(fixture.provenance.classification, "synthetic");
    assert.equal(fixture.provenance.approvalReference, null);
    const result = await load(fixture);
    assert.equal(result.status, fixture.expected.status, fixture.caseId);
    assert.equal(result.reasonCode, fixture.expected.reasonCode, fixture.caseId);
    assert.equal(result.primaryArtifactHash, fixture.expected.primaryArtifactHash, fixture.caseId);
    if (result.status !== "emitted") continue;
    assert.equal(result.recordId, fixture.expected.recordId, fixture.caseId);
    assert.equal(result.revisionId, fixture.expected.revisionId, fixture.caseId);
    assert.equal(result.selectedProjectionHash, fixture.expected.selectedProjectionHash);
    assert.equal(result.candidateHash, fixture.expected.candidateHash, fixture.caseId);
    assert.equal(result.eventDraftHash, fixture.expected.eventDraftHash, fixture.caseId);
    assert.equal(result.candidate.publishedAtMs, fixture.expected.publishedAtMs);
    assert.equal(result.candidate.timestampConfidence, fixture.expected.timestampConfidence);
    assert.equal(result.draft.causationId, undefined);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.draft.payload), true);
  }

  const latest = await load(emitted("latest-explicit-time"));
  assert.equal(latest.status, "emitted");
  assert.deepEqual(JSON.parse(JSON.stringify(latest.draft)), {
    envelopeVersion: 2,
    type: "earnings.source.observed",
    schemaVersion: 1,
    source: "peas-recorded:fmp-press-release-synthetic-v1",
    subject: "earnings:0000000001:2026-Q1",
    occurredAtMs: 1_778_171_400_000,
    correlationId: "earnings:0000000001:2026-Q1",
    provider: {
      provider: "financial-modeling-prep",
      recordId:
        "fmp-recorded-synthetic:c08d87be4da7598dc42f3c2461a601162a0f007c4ba015a7e459002bb850055e",
      revisionId: "sha256:cc43824b44239244fd88670707dd9bf633de17de257233ce4b508a0302c76372",
      artifactHash: "6440ac3e4e0cff9079ce648e6105bfa7e3438f2223da43694eb0d45b647934b9",
    },
    payload: {
      issuerCik: "0000000001",
      fiscalPeriod: "2026-Q1",
      sourceKind: "fmp_release",
      artifactHash: "6440ac3e4e0cff9079ce648e6105bfa7e3438f2223da43694eb0d45b647934b9",
      publishedAtMs: 1_778_171_400_000,
      timestampConfidence: "provider",
      originalTimestamp: "2026-05-07T16:30:00Z",
    },
  });
});

test("identical raw bytes are invariant to replay page size and fixture execution order", async () => {
  const fixture = emitted("latest-explicit-time");
  const original = await bytesFor(fixture);
  const baseline = normalizeRecordedFmpCollection({
    bytes: original,
    selector: fixture.selector,
    route: fixture.route,
  });
  assert.equal(baseline.status, "emitted");
  for (const pageSize of [1, 7, 64, 4_096]) {
    const pages: Buffer[] = [];
    for (let offset = 0; offset < original.byteLength; offset += pageSize) {
      pages.push(original.subarray(offset, Math.min(offset + pageSize, original.byteLength)));
    }
    assert.deepEqual(
      normalizeRecordedFmpCollection({
        bytes: Buffer.concat(pages),
        selector: fixture.selector,
        route: fixture.route,
      }),
      baseline,
    );
  }
  const forward = await Promise.all(FMP_FIXTURE_CASES.map(async (entry) => load(entry)));
  const reverse = await Promise.all(
    [...FMP_FIXTURE_CASES].reverse().map(async (entry) => load(entry)),
  );
  assert.deepEqual(reverse.reverse(), forward);
});

test("identical duplicates collapse while byte-different corrections create a new revision", async () => {
  const original = await load(emitted("search-explicit-time"));
  const duplicate = await load(emitted("duplicate-identical-item"));
  const correction = await load(emitted("byte-different-correction"));
  assert.equal(original.status, "emitted");
  assert.equal(duplicate.status, "emitted");
  assert.equal(correction.status, "emitted");
  assert.equal(original.recordId, duplicate.recordId);
  assert.equal(original.recordId, correction.recordId);
  assert.equal(original.selectedProjectionHash, duplicate.selectedProjectionHash);
  assert.notEqual(original.revisionId, duplicate.revisionId);
  assert.notEqual(original.revisionId, correction.revisionId);
  assert.notEqual(original.selectedProjectionHash, correction.selectedProjectionHash);
  assert.notEqual(original.eventDraftHash, correction.eventDraftHash);
});

test("missing or naive time never falls back to retrieval time", async () => {
  const missing = await load(emitted("missing-provider-time"));
  assert.equal(missing.status, "emitted");
  assert.equal(missing.draft.occurredAtMs, null);
  assert.equal(missing.draft.payload.originalTimestamp, null);

  const bytes = Buffer.from(
    JSON.stringify([
      {
        symbol: "SYNX",
        publishedDate: "2026-05-07 16:30:00",
        title: "Synthetic Naive Time Results",
        text: "Original fictional body.",
        site: null,
        image: null,
        url: null,
      },
    ]),
  );
  const inspected = inspectRecordedFmpCollection(bytes);
  const selected = inspected.items[0];
  assert.ok(selected);
  const result = normalizeRecordedFmpCollection({
    bytes,
    selector: { recordId: selected.recordId, revisionId: selected.revisionId },
    route: ROUTE,
  });
  assert.equal(result.status, "emitted");
  assert.equal(result.draft.occurredAtMs, null);
  assert.equal(result.draft.payload.timestampConfidence, "unknown");
  assert.equal(result.draft.payload.originalTimestamp, null);
});

test("malformed input, duplicate keys, invalid time, digest mismatch, and bounds fail closed", async () => {
  const malformed = await load(emitted("malformed-json"));
  assert.equal(malformed.status, "quarantined");
  assert.equal(malformed.reasonCode, "fmp.malformed-json");

  const duplicateKey = Buffer.from(
    '[{"symbol":"SYNX","symbol":"SYNX","publishedDate":null,"title":"T","text":"B","site":null,"image":null,"url":null}]',
  );
  assert.equal(
    normalizeRecordedFmpCollection({ bytes: duplicateKey, selector: ZERO_SELECTOR, route: ROUTE })
      .reasonCode,
    "fmp.malformed-json",
  );

  const invalidTime = Buffer.from(
    JSON.stringify([
      {
        symbol: "SYNX",
        publishedDate: "2026-02-30T12:00:00Z",
        title: "Synthetic Invalid Time",
        text: "Original fictional body.",
        site: null,
        image: null,
        url: null,
      },
    ]),
  );
  assert.equal(
    normalizeRecordedFmpCollection({ bytes: invalidTime, selector: ZERO_SELECTOR, route: ROUTE })
      .reasonCode,
    "fmp.timestamp-invalid",
  );

  const fixture = emitted("latest-explicit-time");
  const member = fixture.retrievedMembers[0];
  const tamperedManifest = {
    ...fixture,
    retrievedMembers: [{ ...member, sizeBytes: member.sizeBytes + 1 }],
  } as unknown as FmpFixtureCase;
  const tampered = await load(tamperedManifest);
  assert.equal(tampered.status, "quarantined");
  assert.equal(tampered.reasonCode, "fmp.bundle-hash-mismatch");

  const oversized = new Uint8Array(FMP_MAX_RESPONSE_BYTES + 1);
  const overResult = normalizeRecordedFmpCollection({
    bytes: oversized,
    selector: ZERO_SELECTOR,
    route: ROUTE,
  });
  assert.equal(overResult.reasonCode, "fmp.response-byte-limit-exceeded");

  const item = {
    symbol: "SYNX",
    publishedDate: null,
    title: "Synthetic Item Limit",
    text: "B",
    site: null,
    image: null,
    url: null,
  };
  const tooMany = Buffer.from(JSON.stringify(Array.from({ length: 1_001 }, () => item)));
  assert.equal(
    normalizeRecordedFmpCollection({ bytes: tooMany, selector: ZERO_SELECTOR, route: ROUTE })
      .reasonCode,
    "fmp.item-limit-exceeded",
  );

  const exactText = Buffer.from(JSON.stringify([{ ...item, text: "x".repeat(4 * 1024 * 1024) }]));
  assert.doesNotThrow(() => inspectRecordedFmpCollection(exactText));
  const overText = Buffer.from(
    JSON.stringify([{ ...item, text: "x".repeat(4 * 1024 * 1024 + 1) }]),
  );
  assert.equal(
    normalizeRecordedFmpCollection({ bytes: overText, selector: ZERO_SELECTOR, route: ROUTE })
      .reasonCode,
    "fmp.string-limit-exceeded",
  );
});

test("full recorded evidence, projection proof, and path confinement fail closed", async () => {
  const fixture = emitted("latest-explicit-time");
  const member = fixture.retrievedMembers[0];
  const proof = fixture.derivedProofs[0];
  assert.ok(proof);

  const futureObservation = {
    ...fixture,
    retrievedMembers: [
      {
        ...member,
        observation: { ...member.observation, retrievedAtMs: fixture.asOfMs + 1 },
      },
    ],
  } as unknown as FmpFixtureCase;
  assert.equal((await load(futureObservation)).reasonCode, "fmp.observation-invalid");

  const wrongDigest = {
    ...fixture,
    retrievedMembers: [
      {
        ...member,
        observation: { ...member.observation, artifactDigest: "0".repeat(64) },
      },
    ],
  } as unknown as FmpFixtureCase;
  assert.equal((await load(wrongDigest)).reasonCode, "fmp.observation-invalid");

  const wrongProof = {
    ...fixture,
    derivedProofs: [{ ...proof, projectionHash: "0".repeat(64) }],
  } as unknown as FmpFixtureCase;
  assert.equal((await load(wrongProof)).reasonCode, "fmp.bundle-hash-mismatch");

  for (const invalidPath of [
    "../latest.json",
    "bodies\\latest.json",
    path.resolve("outside.json"),
  ]) {
    const escaped = {
      ...fixture,
      retrievedMembers: [{ ...member, path: invalidPath }],
    } as unknown as FmpFixtureCase;
    assert.equal((await load(escaped)).reasonCode, "fmp.artifact-read-failed");
  }

  const valid = await load(fixture);
  assert.equal(valid.status, "emitted");
  assert.equal(valid.transcript.selectedObservationId, member.selectedObservationId);
  assert.equal(valid.transcript.observationHash, member.observation.observationHash);
  assert.equal(valid.transcript.artifactHash, member.artifactHash);
  assert.equal(valid.transcript.projectionHash, proof.projectionHash);
  assert.match(valid.transcriptHash, /^[a-f0-9]{64}$/u);
});

test("JSON token, depth, decoded-total, and transcript exact/one-over limits are executable", () => {
  const exactTokens = `[${Array.from({ length: FMP_MAX_JSON_TOKENS - 2 }, () => "0").join(",")}]`;
  assert.doesNotThrow(() => parseFmpJson(exactTokens));
  const overTokens = `${exactTokens.slice(0, -1)},0]`;
  assert.throws(
    () => parseFmpJson(overTokens),
    (error: unknown) =>
      error instanceof FmpJsonError &&
      error.reasonCode === "fmp.parse-limit-exceeded" &&
      error.limitKind === "json-tokens",
  );

  const exactDepth = `${"[".repeat(FMP_MAX_JSON_DEPTH)}0${"]".repeat(FMP_MAX_JSON_DEPTH)}`;
  assert.doesNotThrow(() => parseFmpJson(exactDepth));
  const overDepth = `[${exactDepth}]`;
  assert.throws(
    () => parseFmpJson(overDepth),
    (error: unknown) => error instanceof FmpJsonError && error.limitKind === "json-depth",
  );

  assert.doesNotThrow(() => parseFmpJson(JSON.stringify("x".repeat(FMP_MAX_DECODED_BYTES))));
  assert.throws(
    () => parseFmpJson(JSON.stringify("x".repeat(FMP_MAX_DECODED_BYTES + 1))),
    (error: unknown) => error instanceof FmpJsonError && error.limitKind === "decoded-string-bytes",
  );

  assert.doesNotThrow(() =>
    assertFmpTranscriptBytesWithinLimit(new Uint8Array(FMP_MAX_TRANSCRIPT_BYTES)),
  );
  assert.throws(
    () => assertFmpTranscriptBytesWithinLimit(new Uint8Array(FMP_MAX_TRANSCRIPT_BYTES + 1)),
    RangeError,
  );
});

test("recorded normalization has no network or financial effect surface", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("network forbidden");
  }) as typeof fetch;
  try {
    const result = await load(emitted("latest-explicit-time"));
    assert.equal(result.status, "emitted");
    assert.equal(fetchCalls, 0);
    assert.equal("credentials" in result, false);
    assert.equal("headers" in result, false);
    assert.equal("effectsAllowed" in result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
