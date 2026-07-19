import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  FMP_FIXTURE_CASES,
  FMP_FIXTURE_SEEDS,
  type FmpFixtureCase,
  type FmpFixtureSeedMemberV1,
} from "../fixtures/fmp/v1/manifest.js";
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
import {
  fixtureObservation,
  recordedFixtureArtifactStore,
} from "./recorded-fixture-artifact-store.js";

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
  const seed = FMP_FIXTURE_SEEDS.get(fixture.caseId)?.[0];
  assert.ok(seed);
  return readFile(path.join(FIXTURE_ROOT, seed.path));
}

async function load(fixture: FmpFixtureCase) {
  const seeds = FMP_FIXTURE_SEEDS.get(fixture.caseId);
  assert.ok(seeds);
  return loadRecordedFmpFixture(recordedFixtureArtifactStore(FIXTURE_ROOT, seeds).store, fixture);
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
    assert.equal(fixture.provenance.classification, "synthetic");
    assert.equal(fixture.provenance.approvalReference, null);
    const result = await load(fixture);
    assert.equal(result.status, fixture.expected.status, fixture.caseId);
    assert.equal(result.reasonCode, fixture.expected.reasonCode, fixture.caseId);
    assert.equal(result.primaryArtifactHash, fixture.expected.rawArtifactHash, fixture.caseId);
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
      revisionId: "sha256:981b30ba0401e2e5b0514a3ed7d4b129f812463f87a0282f15e2fa753fa36b63",
      artifactHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
    },
    payload: {
      issuerCik: "0000000001",
      fiscalPeriod: "2026-Q1",
      sourceKind: "fmp_release",
      artifactHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
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
  assert.equal(original.revisionId, duplicate.revisionId);
  assert.equal(original.eventDraftHash, duplicate.eventDraftHash);
  assert.notEqual(original.revisionId, correction.revisionId);
  assert.notEqual(original.selectedProjectionHash, correction.selectedProjectionHash);
  assert.notEqual(original.eventDraftHash, correction.eventDraftHash);
});

function normalizedSelf(items: readonly Record<string, unknown>[]) {
  const bytes = Buffer.from(JSON.stringify(items));
  const inspected = inspectRecordedFmpCollection(bytes);
  const selected = inspected.items[0];
  assert.ok(selected);
  return normalizeRecordedFmpCollection({
    bytes,
    selector: { recordId: selected.recordId, revisionId: selected.revisionId },
    route: ROUTE,
  });
}

test("URL-only and comment-only FMP changes cannot alter semantic or event identity", () => {
  const item = {
    symbol: "SYNX",
    publishedDate: "2026-05-07T16:30:00Z",
    title: "Synthetic URL-Free Results",
    text: "Synthetic semantic body.",
    site: "first.invalid",
    image: "https://user:secret@first.invalid/image.png?token=one#fragment",
    url: "https://first.invalid/release?credential=one#first",
  };
  const baseline = normalizedSelf([item]);
  const urlOnly = normalizedSelf([
    {
      ...item,
      site: "second.invalid",
      image: "https://other:credential@second.invalid/other.png?token=two#fragment",
      url: "https://second.invalid/release?credential=two#second",
      text: `${item.text} https://user:password@first.invalid/path?token=one#fragment`,
    },
  ]);
  const commentOnly = normalizedSelf([
    {
      ...item,
      text: `${item.text}<!-- arbitrary nonsemantic acquisition comment -->`,
    },
  ]);
  for (const result of [baseline, urlOnly, commentOnly]) assert.equal(result.status, "emitted");
  if (
    baseline.status !== "emitted" ||
    urlOnly.status !== "emitted" ||
    commentOnly.status !== "emitted"
  )
    return;
  for (const result of [urlOnly, commentOnly]) {
    assert.equal(result.recordId, baseline.recordId);
    assert.equal(result.revisionId, baseline.revisionId);
    assert.equal(result.selectedProjectionHash, baseline.selectedProjectionHash);
    assert.equal(result.candidateHash, baseline.candidateHash);
    assert.equal(result.eventDraftHash, baseline.eventDraftHash);
    assert.deepEqual(result.draft, baseline.draft);
    assert.notEqual(result.primaryArtifactHash, baseline.primaryArtifactHash);
  }
});

test("record-family duplicate conflicts reject in either item order", () => {
  const original = {
    symbol: "SYNX",
    publishedDate: "2026-05-07T16:30:00Z",
    title: "Synthetic Duplicate Conflict Results",
    text: "First retained semantic body.",
    site: null,
    image: null,
    url: null,
  };
  const corrected = { ...original, text: "Conflicting retained semantic body." };
  for (const items of [
    [original, corrected],
    [corrected, original],
  ]) {
    const bytes = Buffer.from(JSON.stringify(items));
    const selected = inspectRecordedFmpCollection(bytes).items[0];
    assert.ok(selected);
    const result = normalizeRecordedFmpCollection({
      bytes,
      selector: { recordId: selected.recordId, revisionId: selected.revisionId },
      route: ROUTE,
    });
    assert.equal(result.status, "quarantined");
    assert.equal(result.reasonCode, "fmp.duplicate-conflict");
  }
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

test("FMP quarantines malformed naive calendar time and preserves valid leap-day unknown time", () => {
  const item = {
    symbol: "SYNX",
    publishedDate: "2028-02-29 23:59:59",
    title: "Synthetic Naive Calendar Results",
    text: "Original fictional body.",
    site: null,
    image: null,
    url: null,
  };
  const leapDay = normalizedSelf([item]);
  assert.equal(leapDay.status, "emitted");
  if (leapDay.status === "emitted") {
    assert.equal(leapDay.candidate.publishedAtMs, null);
    assert.equal(leapDay.candidate.timestampConfidence, "unknown");
  }
  for (const publishedDate of [
    "2026-02-29 12:00:00",
    "2026-04-31 12:00:00",
    "2026-05-07 24:00:00",
    "2026-05-07 12:60:00",
    "2026-05-07 12:00:60",
  ]) {
    const rejected = normalizeRecordedFmpCollection({
      bytes: Buffer.from(JSON.stringify([{ ...item, publishedDate }])),
      selector: ZERO_SELECTOR,
      route: ROUTE,
    });
    assert.equal(rejected.status, "quarantined", publishedDate);
    assert.equal(rejected.reasonCode, "fmp.timestamp-invalid", publishedDate);
  }
});

test("FMP ASCII whitespace normalization preserves Unicode whitespace distinctions", () => {
  const item = {
    symbol: "SYNX",
    publishedDate: "2026-05-07T16:30:00Z",
    title: "Synthetic Whitespace Results",
    text: "alpha beta",
    site: null,
    image: null,
    url: null,
  };
  const ascii = normalizedSelf([item]);
  const unicode = normalizedSelf([{ ...item, text: "alpha\u00a0beta" }]);
  assert.equal(ascii.status, "emitted");
  assert.equal(unicode.status, "emitted");
  if (ascii.status !== "emitted" || unicode.status !== "emitted") return;
  assert.equal(ascii.projection.text, "alpha beta");
  assert.equal(unicode.projection.text, "alpha\u00a0beta");
  assert.notEqual(ascii.selectedProjectionHash, unicode.selectedProjectionHash);
  assert.notEqual(ascii.revisionId, unicode.revisionId);
  assert.notEqual(ascii.eventDraftHash, unicode.eventDraftHash);
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

test("FMP public normalizer rejects hostile containers before any caller trap can execute", async () => {
  const sourceBytes = await bytesFor(emitted("latest-explicit-time"));
  const inspected = inspectRecordedFmpCollection(sourceBytes);
  const selected = inspected.items[0];
  assert.ok(selected);
  const input = {
    bytes: new Uint8Array(sourceBytes),
    selector: { recordId: selected.recordId, revisionId: selected.revisionId },
    route: ROUTE,
  };
  const baseline = normalizeRecordedFmpCollection(input);
  assert.equal(baseline.status, "emitted");
  assert.deepEqual(
    normalizeRecordedFmpCollection({
      bytes: new Uint8Array(sourceBytes),
      selector: { ...input.selector },
      route: { ...ROUTE, issuerMapping: { ...ROUTE.issuerMapping } },
    }),
    baseline,
  );

  let accessorCalls = 0;
  const accessorOuter = {};
  for (const [key, value] of Object.entries(input)) {
    Object.defineProperty(accessorOuter, key, {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return value;
      },
    });
  }
  let proxyCalls = 0;
  const proxyOuter = new Proxy(input, {
    get() {
      proxyCalls += 1;
      throw new Error("outer get trap must not run");
    },
    ownKeys() {
      proxyCalls += 1;
      throw new Error("outer ownKeys trap must not run");
    },
    getOwnPropertyDescriptor() {
      proxyCalls += 1;
      throw new Error("outer descriptor trap must not run");
    },
  });
  const inheritedOuter = Object.create(input);
  const symbolOuter = { ...input };
  Object.defineProperty(symbolOuter, Symbol("hostile"), { enumerable: true, value: true });
  const nonEnumerableOuter = { ...input };
  Object.defineProperty(nonEnumerableOuter, "route", { enumerable: false, value: input.route });
  const customPrototypeOuter = Object.setPrototypeOf({ ...input }, { hostile: true });
  const selectorAccessor = {};
  Object.defineProperty(selectorAccessor, "recordId", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      throw new Error("nested selector getter must not run");
    },
  });
  Object.defineProperty(selectorAccessor, "revisionId", {
    enumerable: true,
    value: input.selector.revisionId,
  });
  const routeProxy = new Proxy(ROUTE, {
    get() {
      proxyCalls += 1;
      throw new Error("nested route proxy trap must not run");
    },
  });
  const mappingAccessor = { ...ROUTE, issuerMapping: {} } as Record<string, unknown>;
  Object.defineProperty(mappingAccessor["issuerMapping"] as object, "issuerCik", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      throw new Error("nested mapping getter must not run");
    },
  });
  const sparseSelector = new Array(1);
  const inheritedSelector = Object.create(input.selector);
  const symbolRoute = { ...ROUTE };
  Object.defineProperty(symbolRoute, Symbol("hostile"), { enumerable: true, value: true });
  const customRoute = Object.setPrototypeOf({ ...ROUTE }, { hostile: true });
  const cyclicRoute: Record<string, unknown> = { ...ROUTE };
  cyclicRoute["self"] = cyclicRoute;
  const byteProxy = new Proxy(new Uint8Array(sourceBytes), {
    get() {
      proxyCalls += 1;
      throw new Error("byte proxy trap must not run");
    },
  });

  const hostileCases: readonly [string, unknown][] = [
    ["accessor outer", accessorOuter],
    ["proxy outer", proxyOuter],
    ["inherited outer", inheritedOuter],
    ["missing outer field", { bytes: input.bytes, selector: input.selector }],
    ["extra outer field", { ...input, unexpected: true }],
    ["symbol outer field", symbolOuter],
    ["non-enumerable outer field", nonEnumerableOuter],
    ["custom outer prototype", customPrototypeOuter],
    ["accessor selector", { ...input, selector: selectorAccessor }],
    ["proxy route", { ...input, route: routeProxy }],
    ["accessor route mapping", { ...input, route: mappingAccessor }],
    ["sparse selector", { ...input, selector: sparseSelector }],
    ["inherited selector", { ...input, selector: inheritedSelector }],
    ["symbol route", { ...input, route: symbolRoute }],
    ["custom route prototype", { ...input, route: customRoute }],
    ["cyclic route", { ...input, route: cyclicRoute }],
    ["proxy byte member", { ...input, bytes: byteProxy }],
    ["non-byte member", { ...input, bytes: {} }],
  ];
  for (const [name, hostile] of hostileCases) {
    const result = normalizeRecordedFmpCollection(
      hostile as Parameters<typeof normalizeRecordedFmpCollection>[0],
    );
    assert.equal(result.status, "quarantined", name);
    assert.equal(result.reasonCode, "fmp.response-invalid", name);
    assert.equal(result.primaryArtifactHash, null, name);
    assert.equal(result.candidate, null, name);
    assert.equal(result.draft, null, name);
  }
  assert.equal(accessorCalls, 0);
  assert.equal(proxyCalls, 0);
});

test("full ArtifactStore observation evidence and projection proof fail closed", async () => {
  const fixture = emitted("latest-explicit-time");
  const member = fixture.retrievedMembers[0];
  const proof = fixture.derivedProofs[0];
  assert.ok(proof);
  const seeds = FMP_FIXTURE_SEEDS.get(fixture.caseId);
  assert.ok(seeds);

  for (const observation of [
    (value: ReturnType<typeof fixtureObservation>) => ({
      ...value,
      retrievedAtMs: fixture.asOfMs + 1,
    }),
    (value: ReturnType<typeof fixtureObservation>) => ({
      ...value,
      artifactDigest: "0".repeat(64),
    }),
    (value: ReturnType<typeof fixtureObservation>) => ({
      ...value,
      observationHash: "0".repeat(64),
    }),
    (value: ReturnType<typeof fixtureObservation>) => ({
      ...value,
      provider: "prv1_invalid" as typeof value.provider,
    }),
  ]) {
    const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, seeds, { observation });
    const rejected = await loadRecordedFmpFixture(authority.store, fixture);
    assert.equal(rejected.reasonCode, "fmp.observation-invalid");
    assert.equal(authority.counters.readCalls.size, 0);
  }
  const missingAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, seeds, {
    observation: () => null,
  });
  const missing = await loadRecordedFmpFixture(missingAuthority.store, fixture);
  assert.equal(missing.reasonCode, "fmp.observation-invalid");
  assert.equal(missingAuthority.counters.readCalls.size, 0);

  const wrongProof = {
    ...fixture,
    derivedProofs: [{ ...proof, projectionHash: "0".repeat(64) }],
  } as unknown as FmpFixtureCase;
  assert.equal((await load(wrongProof)).reasonCode, "fmp.bundle-hash-mismatch");

  const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, seeds);
  const valid = await loadRecordedFmpFixture(authority.store, fixture);
  assert.equal(valid.status, "emitted");
  assert.equal(valid.transcript.selectedObservationId, member.selectedObservationId);
  assert.equal(valid.transcript.observationHash, fixtureObservation(seeds[0]).observationHash);
  assert.equal(valid.transcript.artifactHash, member.artifactHash);
  assert.equal(valid.transcript.projectionHash, proof.projectionHash);
  assert.match(valid.transcriptHash, /^[a-f0-9]{64}$/u);
  assert.equal(authority.counters.observationCalls.get(member.selectedObservationId), 1);
  assert.equal(authority.counters.readCalls.get(member.artifactHash), 1);
});

test("FMP loader enforces declared and actual member bytes before unbounded allocation", async () => {
  const fixture = emitted("latest-explicit-time");
  const root = await mkdtemp(path.join(tmpdir(), "peas-fmp-bounded-loader-"));
  try {
    await mkdir(path.join(root, "bodies"));
    const exactBytes = Buffer.alloc(FMP_MAX_RESPONSE_BYTES, 0x20);
    const exactHash = createHash("sha256").update(exactBytes).digest("hex");
    await writeFile(path.join(root, "bodies", "exact.json"), exactBytes);
    const baseSeed = FMP_FIXTURE_SEEDS.get(fixture.caseId)?.[0];
    assert.ok(baseSeed);
    const exactSeed: FmpFixtureSeedMemberV1 = {
      ...baseSeed,
      path: "bodies/exact.json",
      artifactHash: exactHash,
      sizeBytes: FMP_MAX_RESPONSE_BYTES,
      attempt: { ...baseSeed.attempt, attemptId: "fmp-exact-member" },
      response: { ...baseSeed.response, declaredContentLength: FMP_MAX_RESPONSE_BYTES },
    };
    const originalMember = fixture.retrievedMembers[0];
    const originalProof = fixture.derivedProofs[0];
    assert.ok(originalProof);
    const exactManifest = {
      ...fixture,
      retrievedMembers: [
        {
          ...originalMember,
          artifactHash: exactHash,
          sizeBytes: FMP_MAX_RESPONSE_BYTES,
          selectedObservationId: fixtureObservation(exactSeed).observationId,
        },
      ],
      derivedProofs: [{ ...originalProof, parentArtifactHash: exactHash }],
    } as unknown as FmpFixtureCase;
    const exactAuthority = recordedFixtureArtifactStore(root, [exactSeed]);
    const exact = await loadRecordedFmpFixture(exactAuthority.store, exactManifest);
    assert.equal(exact.reasonCode, "fmp.bundle-hash-mismatch");
    assert.equal(exact.transcript.artifactHash, exactHash);
    assert.equal(exactAuthority.counters.streamedBytes.get(exactHash), FMP_MAX_RESPONSE_BYTES);

    const oneOver = {
      ...exactManifest,
      retrievedMembers: [
        {
          ...exactManifest.retrievedMembers[0],
          sizeBytes: FMP_MAX_RESPONSE_BYTES + 1,
        },
      ],
    } as unknown as FmpFixtureCase;
    const oneOverAuthority = recordedFixtureArtifactStore(root, [exactSeed]);
    const rejected = await loadRecordedFmpFixture(oneOverAuthority.store, oneOver);
    assert.equal(rejected.reasonCode, "fmp.response-byte-limit-exceeded");
    assert.equal(rejected.transcript.artifactHash, null);
    assert.equal(oneOverAuthority.counters.observationCalls.size, 0);
    assert.equal(oneOverAuthority.counters.readCalls.size, 0);

    const shortDeclaration = {
      ...exactManifest,
      retrievedMembers: [
        { ...exactManifest.retrievedMembers[0], sizeBytes: FMP_MAX_RESPONSE_BYTES - 1 },
      ],
    } as unknown as FmpFixtureCase;
    const shortAuthority = recordedFixtureArtifactStore(root, [exactSeed]);
    assert.equal(
      (await loadRecordedFmpFixture(shortAuthority.store, shortDeclaration)).reasonCode,
      "fmp.bundle-hash-mismatch",
    );
    assert.equal(shortAuthority.counters.streamedBytes.get(exactHash) ?? 0, 0);

    const overBytes = Buffer.alloc(FMP_MAX_RESPONSE_BYTES + 1, 0x20);
    const overHash = createHash("sha256").update(overBytes).digest("hex");
    await writeFile(path.join(root, "bodies", "actual-over.json"), overBytes);
    const actualOverSeed: FmpFixtureSeedMemberV1 = {
      ...exactSeed,
      path: "bodies/actual-over.json",
      artifactHash: overHash,
      sizeBytes: FMP_MAX_RESPONSE_BYTES + 1,
      attempt: { ...exactSeed.attempt, attemptId: "fmp-actual-over-member" },
      response: { ...exactSeed.response, declaredContentLength: FMP_MAX_RESPONSE_BYTES + 1 },
    };
    const actualOverManifest = {
      ...exactManifest,
      retrievedMembers: [
        {
          ...exactManifest.retrievedMembers[0],
          artifactHash: overHash,
          selectedObservationId: fixtureObservation(actualOverSeed).observationId,
        },
      ],
      derivedProofs: [{ ...originalProof, parentArtifactHash: overHash }],
    } as unknown as FmpFixtureCase;
    const actualOverAuthority = recordedFixtureArtifactStore(root, [actualOverSeed]);
    const actualOver = await loadRecordedFmpFixture(actualOverAuthority.store, actualOverManifest);
    assert.equal(actualOver.reasonCode, "fmp.response-byte-limit-exceeded");
    assert.equal(actualOverAuthority.counters.streamedBytes.get(overHash) ?? 0, 0);

    const growthAuthority = recordedFixtureArtifactStore(root, [exactSeed], {
      stream: () => Readable.from([exactBytes, Buffer.from("x")]),
    });
    const growth = await loadRecordedFmpFixture(growthAuthority.store, exactManifest);
    assert.equal(growth.reasonCode, "fmp.bundle-hash-mismatch");
    assert.equal(growthAuthority.counters.readCalls.get(exactHash), 1);

    const replacementAuthority = recordedFixtureArtifactStore(root, [exactSeed], {
      stream: () => Readable.from([Buffer.alloc(FMP_MAX_RESPONSE_BYTES, 0x21)]),
    });
    const replacement = await loadRecordedFmpFixture(replacementAuthority.store, exactManifest);
    assert.equal(replacement.reasonCode, "fmp.bundle-hash-mismatch");
    assert.equal(
      replacementAuthority.counters.streamedBytes.get(exactHash),
      FMP_MAX_RESPONSE_BYTES,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FMP exact-shape hostile manifest fields fail before any body read", async () => {
  const fixture = emitted("latest-explicit-time");
  const member = fixture.retrievedMembers[0];
  const seeds = FMP_FIXTURE_SEEDS.get(fixture.caseId);
  assert.ok(seeds);
  const cases: readonly [string, unknown][] = [
    ["schemaVersion", { ...fixture, schemaVersion: 1 }],
    ["caseId", { ...fixture, caseId: 7 }],
    ["provider", { ...fixture, provider: "other" }],
    ["source", { ...fixture, source: "other" }],
    ["acquisitionVariant", { ...fixture, acquisitionVariant: "live" }],
    ["asOfMs", { ...fixture, asOfMs: -1 }],
    ["selector recordId", { ...fixture, selector: { ...fixture.selector, recordId: 7 } }],
    ["selector revisionId", { ...fixture, selector: { ...fixture.selector, revisionId: 7 } }],
    ["route classification", { ...fixture, route: { ...fixture.route, classification: "other" } }],
    ["route authority", { ...fixture, route: { ...fixture.route, mappingAuthority: "" } }],
    ["route version", { ...fixture, route: { ...fixture.route, mappingVersion: "" } }],
    [
      "route issuer CIK",
      {
        ...fixture,
        route: {
          ...fixture.route,
          issuerMapping: { ...fixture.route.issuerMapping, issuerCik: 1 },
        },
      },
    ],
    [
      "route issuer symbol",
      {
        ...fixture,
        route: {
          ...fixture.route,
          issuerMapping: { ...fixture.route.issuerMapping, symbol: "bad symbol" },
        },
      },
    ],
    [
      "route fiscal period",
      {
        ...fixture,
        route: {
          ...fixture.route,
          issuerMapping: { ...fixture.route.issuerMapping, fiscalPeriod: "later" },
        },
      },
    ],
    ["member kind", { ...fixture, retrievedMembers: [{ ...member, kind: "derived" }] }],
    ["member role", { ...fixture, retrievedMembers: [{ ...member, role: "other" }] }],
    ["member unexpected path", { ...fixture, retrievedMembers: [{ ...member, path: "body" }] }],
    ["member artifact hash", { ...fixture, retrievedMembers: [{ ...member, artifactHash: 7 }] }],
    ["member size", { ...fixture, retrievedMembers: [{ ...member, sizeBytes: -1 }] }],
    [
      "member selected observation",
      { ...fixture, retrievedMembers: [{ ...member, selectedObservationId: 7 }] },
    ],
    [
      "member unexpected observation",
      { ...fixture, retrievedMembers: [{ ...member, observation: {} }] },
    ],
    ["expected status", { ...fixture, expected: { ...fixture.expected, status: "other" } }],
    ["expected reason", { ...fixture, expected: { ...fixture.expected, reasonCode: "other" } }],
    [
      "expected limit iff",
      { ...fixture, expected: { ...fixture.expected, limitKind: "json-depth" } },
    ],
    ["expected record", { ...fixture, expected: { ...fixture.expected, recordId: 7 } }],
    ["expected revision", { ...fixture, expected: { ...fixture.expected, revisionId: 7 } }],
    ["expected raw hash", { ...fixture, expected: { ...fixture.expected, rawArtifactHash: 7 } }],
    [
      "expected raw hash required",
      { ...fixture, expected: { ...fixture.expected, rawArtifactHash: null } },
    ],
    [
      "expected primary hash",
      { ...fixture, expected: { ...fixture.expected, primaryArtifactHash: null } },
    ],
    [
      "expected projection hash",
      { ...fixture, expected: { ...fixture.expected, selectedProjectionHash: null } },
    ],
    ["expected route hash", { ...fixture, expected: { ...fixture.expected, routeHash: null } }],
    [
      "expected candidate hash",
      { ...fixture, expected: { ...fixture.expected, candidateHash: null } },
    ],
    [
      "expected draft hash",
      { ...fixture, expected: { ...fixture.expected, eventDraftHash: null } },
    ],
    [
      "expected published time",
      { ...fixture, expected: { ...fixture.expected, publishedAtMs: -1 } },
    ],
    [
      "expected confidence",
      { ...fixture, expected: { ...fixture.expected, timestampConfidence: "other" } },
    ],
    [
      "expected original timestamp",
      { ...fixture, expected: { ...fixture.expected, originalTimestamp: 7 } },
    ],
    [
      "provenance classification",
      { ...fixture, provenance: { ...fixture.provenance, classification: "other" } },
    ],
    ["provenance note type", { ...fixture, provenance: { ...fixture.provenance, note: 7 } }],
    ["provenance note empty", { ...fixture, provenance: { ...fixture.provenance, note: "" } }],
    [
      "provenance note UTF-8",
      { ...fixture, provenance: { ...fixture.provenance, note: "é".repeat(2_049) } },
    ],
    [
      "provenance approval",
      { ...fixture, provenance: { ...fixture.provenance, approvalReference: "unapproved" } },
    ],
  ];
  for (const [name, manifest] of cases) {
    const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, seeds);
    const result = await loadRecordedFmpFixture(authority.store, manifest as FmpFixtureCase);
    assert.equal(result.status, "quarantined", name);
    assert.equal(result.transcript.artifactHash, null, name);
    assert.equal(authority.counters.observationCalls.size, 0, name);
    assert.equal(authority.counters.readCalls.size, 0, name);
  }
});

test("expected outcomes and provenance are strict atomic loader gates", async () => {
  const fixture = emitted("latest-explicit-time");
  const rejected = async (manifest: unknown): Promise<void> => {
    const seeds = FMP_FIXTURE_SEEDS.get(fixture.caseId);
    assert.ok(seeds);
    const result = await loadRecordedFmpFixture(
      recordedFixtureArtifactStore(FIXTURE_ROOT, seeds).store,
      manifest as FmpFixtureCase,
    );
    assert.equal(result.status, "quarantined");
    assert.equal(result.reasonCode, "fmp.bundle-hash-mismatch");
    assert.equal(result.candidate, null);
    assert.equal(result.draft, null);
  };

  await rejected({
    ...fixture,
    expected: { ...fixture.expected, status: "quarantined" },
  });
  await rejected({
    ...fixture,
    expected: { ...fixture.expected, candidateHash: "0".repeat(64) },
  });
  await rejected({
    ...fixture,
    provenance: {
      ...fixture.provenance,
      classification: "redistribution-approved",
      approvalReference: null,
    },
  });
  await rejected({
    ...fixture,
    provenance: { ...fixture.provenance, approvalReference: "unapproved" },
  });
  await rejected({
    ...fixture,
    provenance: { ...fixture.provenance, note: "x".repeat(4_097) },
  });

  const withExtra = { ...fixture.expected, unexpected: null };
  await rejected({ ...fixture, expected: withExtra });
  const { candidateHash: _missing, ...missingExpected } = fixture.expected;
  await rejected({ ...fixture, expected: missingExpected });

  const inherited = Object.assign(Object.create({ inherited: true }), fixture.expected);
  await rejected({ ...fixture, expected: inherited });

  const accessor = { ...fixture.expected } as Record<string, unknown>;
  Object.defineProperty(accessor, "candidateHash", {
    enumerable: true,
    get() {
      throw new Error("accessor must not execute");
    },
  });
  await rejected({ ...fixture, expected: accessor });

  const symbolExpected = { ...fixture.expected } as Record<PropertyKey, unknown>;
  symbolExpected[Symbol("unexpected")] = true;
  await rejected({ ...fixture, expected: symbolExpected });
  await rejected({ ...fixture, expected: new Proxy({ ...fixture.expected }, {}) });

  const sparseProofs = new Array(1);
  await rejected({ ...fixture, derivedProofs: sparseProofs });

  const cyclic = { ...fixture.expected } as Record<string, unknown>;
  cyclic["cycle"] = cyclic;
  await rejected({ ...fixture, expected: cyclic });
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
