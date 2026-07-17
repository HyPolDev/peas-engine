import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { NVIDIA_BASELINE_MANIFEST } from "../fixtures/ir/nvidia/v1/manifest.js";
import {
  loadRecordedNvidiaFixture,
  type NvidiaDerivedProofV1,
  type NvidiaFixtureManifestV1,
  type NvidiaRetrievedMemberV1,
} from "../src/adapters/ir/nvidia/recorded-nvidia-fixture.js";
import { NVIDIA_IR_LIMITS } from "../src/providers/ir/nvidia/contracts.js";
import {
  assertNvidiaDeclaredLimit,
  assertNvidiaRecordedMemberBounds,
  normalizeRecordedNvidiaIr,
  parseNvidiaReference,
} from "../src/providers/ir/nvidia/normalizer.js";

const ROOT = path.join(process.cwd(), "fixtures", "ir", "nvidia", "v1", "bodies");
const FIXTURE_ROOT = path.dirname(ROOT);
const KEY = "https://nvidianews.nvidia.com/news/synthetic-fiscal-2030-q1";
const bytes = (value: string): Uint8Array => Buffer.from(value, "utf8");
const fixture = (name: string): Promise<Buffer> => readFile(path.join(ROOT, name));

test("offline loader verifies the full recorded manifest before normalization", async () => {
  const loaded = await loadRecordedNvidiaFixture({
    fixtureRoot: FIXTURE_ROOT,
    manifest: NVIDIA_BASELINE_MANIFEST,
  });
  assert.equal(loaded.status, "emitted");
  assert.equal(loaded.reasonCode, null);
  assert.equal(loaded.transcript.observationIds.length, 2);
  assert.equal(loaded.transcript.projectionHashes.length, 2);
  assert.match(loaded.transcriptHash, /^[0-9a-f]{64}$/u);
  assert.equal(loaded.normalization?.status, "emitted");

  const badProof = structuredClone(NVIDIA_BASELINE_MANIFEST) as unknown as {
    derivedProofs: NvidiaDerivedProofV1[];
  };
  const originalProof = badProof.derivedProofs[0];
  assert.ok(originalProof);
  badProof.derivedProofs[0] = { ...originalProof, projectionHash: "0".repeat(64) };
  const proofFailure = await loadRecordedNvidiaFixture({
    fixtureRoot: FIXTURE_ROOT,
    manifest: badProof as unknown as NvidiaFixtureManifestV1,
  });
  assert.equal(proofFailure.reasonCode, "ir.bundle-hash-mismatch");

  const escaping = structuredClone(NVIDIA_BASELINE_MANIFEST) as unknown as {
    retrievedMembers: NvidiaRetrievedMemberV1[];
  };
  const originalMember = escaping.retrievedMembers[0];
  assert.ok(originalMember);
  escaping.retrievedMembers[0] = { ...originalMember, path: "../baseline.rss" };
  const pathFailure = await loadRecordedNvidiaFixture({
    fixtureRoot: FIXTURE_ROOT,
    manifest: escaping as unknown as NvidiaFixtureManifestV1,
  });
  assert.equal(pathFailure.reasonCode, "ir.artifact-read-failed");
});

test("RSS plus release emits one deterministic candidate and draft across parser chunks", async () => {
  const input = {
    rssBytes: await fixture("baseline.rss"),
    releaseHtmlBytes: await fixture("baseline.html"),
    selectionKey: KEY,
  };
  const whole = normalizeRecordedNvidiaIr(input);
  assert.deepEqual(normalizeRecordedNvidiaIr(input, { rssChunkSize: 1, htmlChunkSize: 7 }), whole);
  assert.equal(whole.status, "emitted");
  if (whole.status !== "emitted") return;
  assert.equal(whole.candidate.fiscalPeriod, "2030-Q1");
  assert.equal(whole.candidate.timestampConfidence, "provider");
  assert.equal(whole.draft.occurredAtMs, Date.UTC(2030, 4, 15, 12, 30));
  assert.match(whole.candidate.providerRecordId, /^ir:nvidia:[0-9a-f]{64}$/u);
  assert.match(whole.candidate.providerRevisionId, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(whole.draft.provider.artifactHash, whole.candidate.primaryArtifactHash);
});

test("semantic corrections create revisions while raw-only comments preserve identity", async () => {
  const rssBytes = await fixture("baseline.rss");
  const baselineHtml = await fixture("baseline.html");
  const baseline = normalizeRecordedNvidiaIr({
    rssBytes,
    releaseHtmlBytes: baselineHtml,
    selectionKey: KEY,
  });
  const changed = normalizeRecordedNvidiaIr({
    rssBytes,
    releaseHtmlBytes: await fixture("changed-body.html"),
    selectionKey: KEY,
  });
  const rawOnly = normalizeRecordedNvidiaIr({
    rssBytes,
    releaseHtmlBytes: bytes(`${baselineHtml.toString("utf8")}<!-- nonsemantic -->`),
    selectionKey: KEY,
  });
  assert.equal(baseline.status, "emitted");
  assert.equal(changed.status, "emitted");
  assert.equal(rawOnly.status, "emitted");
  if (baseline.status !== "emitted" || changed.status !== "emitted" || rawOnly.status !== "emitted")
    return;
  assert.equal(changed.candidate.providerRecordId, baseline.candidate.providerRecordId);
  assert.notEqual(
    changed.candidate.selectedProjectionHash,
    baseline.candidate.selectedProjectionHash,
  );
  assert.notEqual(changed.candidate.providerRevisionId, baseline.candidate.providerRevisionId);
  assert.equal(rawOnly.candidate.selectedProjectionHash, baseline.candidate.selectedProjectionHash);
  assert.equal(rawOnly.candidate.providerRevisionId, baseline.candidate.providerRevisionId);
  assert.equal(rawOnly.transcript.candidateHash, baseline.transcript.candidateHash);
  assert.equal(rawOnly.transcript.eventDraftHash, baseline.transcript.eventDraftHash);
  assert.deepEqual(rawOnly.draft, baseline.draft);
});

test("URL-only and comment-only NVIDIA changes preserve projections and event identity", async () => {
  const rss = (await fixture("baseline.rss")).toString("utf8");
  const html = (await fixture("baseline.html")).toString("utf8");
  const baseline = normalizeRecordedNvidiaIr({
    rssBytes: bytes(rss),
    releaseHtmlBytes: bytes(html),
    selectionKey: KEY,
  });
  const urlOnly = normalizeRecordedNvidiaIr({
    rssBytes: bytes(
      rss
        .replace("?source=rss#release", "?credential=changed#different-fragment")
        .replace(
          "Entirely synthetic release.",
          "Entirely synthetic release. https://user:secret@nvidianews.nvidia.com/private?token=x#y",
        ),
    ),
    releaseHtmlBytes: bytes(
      html
        .replace(
          'href="https://nvidianews.nvidia.com/news/synthetic-fiscal-2030-q1"',
          'href="https://nvidianews.nvidia.com/news/synthetic-fiscal-2030-q1?canonical=changed#fragment"',
        )
        .replace("?view=full", "?credential=changed#fragment")
        .replace(
          "All prose in this fixture is original.",
          "All prose in this fixture is original. https://user:secret@nvidianews.nvidia.com/private?token=x#y",
        ),
    ),
    selectionKey: `${KEY}?loader=changed#fragment`,
  });
  const commentOnly = normalizeRecordedNvidiaIr({
    rssBytes: bytes(rss.replace("<item>", "<!-- nonsemantic RSS comment --><item>")),
    releaseHtmlBytes: bytes(
      html.replace("<article class=", "<!-- nonsemantic HTML comment --><article class="),
    ),
    selectionKey: KEY,
  });
  for (const result of [baseline, urlOnly, commentOnly]) assert.equal(result.status, "emitted");
  if (
    baseline.status !== "emitted" ||
    urlOnly.status !== "emitted" ||
    commentOnly.status !== "emitted"
  )
    return;
  for (const result of [urlOnly, commentOnly]) {
    assert.deepEqual(result.projections, baseline.projections);
    assert.deepEqual(result.candidate, baseline.candidate);
    assert.deepEqual(result.draft, baseline.draft);
    assert.equal(
      result.transcript.selectedProjectionHash,
      baseline.transcript.selectedProjectionHash,
    );
    assert.equal(result.transcript.candidateHash, baseline.transcript.candidateHash);
    assert.equal(result.transcript.eventDraftHash, baseline.transcript.eventDraftHash);
  }
  assert.notEqual(urlOnly.transcript.rssArtifactHash, baseline.transcript.rssArtifactHash);
  assert.notEqual(
    urlOnly.transcript.releaseHtmlArtifactHash,
    baseline.transcript.releaseHtmlArtifactHash,
  );
  assert.notEqual(commentOnly.transcript.rssArtifactHash, baseline.transcript.rssArtifactHash);
  assert.notEqual(
    commentOnly.transcript.releaseHtmlArtifactHash,
    baseline.transcript.releaseHtmlArtifactHash,
  );
});

test("missing item publication time remains null/unknown", async () => {
  const rss = (await fixture("baseline.rss"))
    .toString("utf8")
    .replace(/<pubDate>[^<]+<\/pubDate>/u, "");
  const result = normalizeRecordedNvidiaIr({
    rssBytes: bytes(rss),
    releaseHtmlBytes: await fixture("baseline.html"),
    selectionKey: KEY,
  });
  assert.equal(result.status, "emitted");
  if (result.status !== "emitted") return;
  assert.deepEqual(
    [
      result.candidate.publishedAtMs,
      result.candidate.timestampConfidence,
      result.draft.occurredAtMs,
    ],
    [null, "unknown", null],
  );
});

test("duplicate GUIDs collapse only when retained RSS semantics are identical", async () => {
  const baseline = (await fixture("baseline.rss")).toString("utf8");
  const item = /<item>[\s\S]*<\/item>/u.exec(baseline)?.[0];
  assert.ok(item);
  const identical = baseline.replace("</channel>", `${item}</channel>`);
  const conflict = baseline.replace(
    "</channel>",
    `${item.replace("Entirely synthetic release.", "Different original test text.")}</channel>`,
  );
  assert.equal(
    normalizeRecordedNvidiaIr({
      rssBytes: bytes(identical),
      releaseHtmlBytes: await fixture("baseline.html"),
      selectionKey: KEY,
    }).status,
    "emitted",
  );
  const rejected = normalizeRecordedNvidiaIr({
    rssBytes: bytes(conflict),
    releaseHtmlBytes: await fixture("baseline.html"),
    selectionKey: KEY,
  });
  assert.equal(rejected.status, "quarantined");
  if (rejected.status === "quarantined")
    assert.equal(rejected.reasonCode, "ir.duplicate-guid-conflict");
});

test("URL, XML, HTML, canonical, and time failures have stable reasons", async () => {
  assert.equal(parseNvidiaReference(`${KEY}?source=rss#release`), KEY);
  assert.throws(() => parseNvidiaReference("https://NVIDIANEWS.nvidia.com/news/x"), {
    message: "ir.link-invalid",
  });
  const rss = await fixture("baseline.rss");
  const html = await fixture("baseline.html");
  const malformedXml = normalizeRecordedNvidiaIr({
    rssBytes: bytes('<!DOCTYPE rss><rss version="2.0"></rss>'),
    releaseHtmlBytes: html,
    selectionKey: KEY,
  });
  const malformedHtml = normalizeRecordedNvidiaIr({
    rssBytes: rss,
    releaseHtmlBytes: await fixture("malformed.html"),
    selectionKey: KEY,
  });
  const badCanonical = normalizeRecordedNvidiaIr({
    rssBytes: rss,
    releaseHtmlBytes: await fixture("bad-canonical.html"),
    selectionKey: KEY,
  });
  const badTime = normalizeRecordedNvidiaIr({
    rssBytes: bytes(
      rss
        .toString("utf8")
        .replace("Wed, 15 May 2030 12:30:00 GMT", "Wed, 15 May 2030 12:30:00 +0000"),
    ),
    releaseHtmlBytes: html,
    selectionKey: KEY,
  });
  for (const [result, reason] of [
    [malformedXml, "ir.feed-malformed"],
    [malformedHtml, "ir.release-malformed"],
    [badCanonical, "ir.canonical-conflict"],
    [badTime, "ir.timestamp-invalid"],
  ] as const) {
    assert.equal(result.status, "quarantined");
    if (result.status === "quarantined") assert.equal(result.reasonCode, reason);
  }
});

test("member limit is exact and the adapter cannot initiate network effects", async () => {
  assert.doesNotThrow(() =>
    assertNvidiaRecordedMemberBounds(
      new Uint8Array(NVIDIA_IR_LIMITS.memberBytes),
      new Uint8Array(0),
    ),
  );
  assert.throws(
    () =>
      assertNvidiaRecordedMemberBounds(
        new Uint8Array(NVIDIA_IR_LIMITS.memberBytes + 1),
        new Uint8Array(0),
      ),
    { message: "ir.member-limit-exceeded" },
  );
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    calls += 1;
    throw new Error("network forbidden");
  }) as typeof fetch;
  try {
    assert.equal(
      normalizeRecordedNvidiaIr({
        rssBytes: await fixture("baseline.rss"),
        releaseHtmlBytes: await fixture("baseline.html"),
        selectionKey: KEY,
      }).status,
      "emitted",
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("every declared parser, projection, bundle, and transcript boundary is exact", () => {
  const boundaries = [
    ["xml-tokens", NVIDIA_IR_LIMITS.xmlTokens],
    ["xml-depth", NVIDIA_IR_LIMITS.xmlDepth],
    ["xml-attributes", NVIDIA_IR_LIMITS.xmlAttributes],
    ["html-tokens", NVIDIA_IR_LIMITS.htmlTokens],
    ["html-depth", NVIDIA_IR_LIMITS.htmlDepth],
    ["html-attributes", NVIDIA_IR_LIMITS.htmlAttributes],
    ["categories", NVIDIA_IR_LIMITS.categories],
    ["extracted-text-bytes", NVIDIA_IR_LIMITS.extractedTextBytes],
    ["projection-bytes", NVIDIA_IR_LIMITS.projectionBytes],
    ["bundle-bytes", NVIDIA_IR_LIMITS.bundleBytes],
    ["transcript-bytes", NVIDIA_IR_LIMITS.transcriptBytes],
  ] as const;
  for (const [kind, maximum] of boundaries) {
    assert.doesNotThrow(() => assertNvidiaDeclaredLimit(kind, maximum), `${kind} exact`);
    assert.throws(() => assertNvidiaDeclaredLimit(kind, maximum + 1), `${kind} one-over`);
  }
});

test("generated category, XML attribute, and HTML depth overflow reach parser gates", async () => {
  const baselineRss = (await fixture("baseline.rss")).toString("utf8");
  const html = await fixture("baseline.html");
  const categories = Array.from({ length: NVIDIA_IR_LIMITS.categories + 1 }, (_, index) =>
    index === 0 ? "<category>Press Releases</category>" : `<category>Synthetic ${index}</category>`,
  ).join("");
  const categoryRss = baselineRss.replace(
    /<categories>[\s\S]*?<\/categories>/u,
    `<categories>${categories}</categories>`,
  );
  const categoryResult = normalizeRecordedNvidiaIr({
    rssBytes: bytes(categoryRss),
    releaseHtmlBytes: html,
    selectionKey: KEY,
  });
  assert.equal(categoryResult.transcript.limitKind, "categories");

  const attributes = Array.from(
    { length: NVIDIA_IR_LIMITS.xmlAttributes + 1 },
    (_, index) => ` a${index}="x"`,
  ).join("");
  const attributeRss = baselineRss.replace("<item>", `<item${attributes}>`);
  const attributeResult = normalizeRecordedNvidiaIr({
    rssBytes: bytes(attributeRss),
    releaseHtmlBytes: html,
    selectionKey: KEY,
  });
  assert.equal(attributeResult.transcript.limitKind, "xml-attributes");

  const nested = `${"<div>".repeat(NVIDIA_IR_LIMITS.htmlDepth + 1)}x${"</div>".repeat(
    NVIDIA_IR_LIMITS.htmlDepth + 1,
  )}`;
  const deepHtml = (await fixture("baseline.html"))
    .toString("utf8")
    .replace("<p>Revenue was an invented", `${nested}<p>Revenue was an invented`);
  const depthResult = normalizeRecordedNvidiaIr({
    rssBytes: bytes(baselineRss),
    releaseHtmlBytes: bytes(deepHtml),
    selectionKey: KEY,
  });
  assert.equal(depthResult.transcript.limitKind, "html-depth");
});
