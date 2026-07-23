import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  FMP_FIXTURE_CASES,
  FMP_FIXTURE_SEEDS,
  type FmpFixtureCase,
} from "../fixtures/fmp/v1/manifest.js";
import {
  NVIDIA_BASELINE_MANIFEST,
  NVIDIA_FIXTURE_SEEDS,
} from "../fixtures/ir/nvidia/v1/manifest.js";
import {
  loadRecordedFmpFixture,
  type RecordedFmpFixtureManifestV2,
} from "../src/adapters/fmp/recorded-fmp-fixture.js";
import {
  loadRecordedNvidiaFixture,
  type NvidiaFixtureManifestV2,
} from "../src/adapters/ir/nvidia/recorded-nvidia-fixture.js";
import { recordedFixtureArtifactStore } from "./recorded-fixture-artifact-store.js";

const FMP_ROOT = path.join(process.cwd(), "fixtures", "fmp", "v1");
const NVIDIA_ROOT = path.join(process.cwd(), "fixtures", "ir", "nvidia", "v1");

function fmpCase(caseId: string): FmpFixtureCase {
  const fixture = FMP_FIXTURE_CASES.find((candidate) => candidate.caseId === caseId);
  assert.ok(fixture, `missing FMP fixture ${caseId}`);
  return fixture;
}

async function loadFmp(manifest: unknown) {
  const caseId = (manifest as { caseId?: unknown }).caseId;
  const seeds = typeof caseId === "string" ? FMP_FIXTURE_SEEDS.get(caseId) : undefined;
  assert.ok(seeds);
  return loadRecordedFmpFixture(
    recordedFixtureArtifactStore(FMP_ROOT, seeds).store,
    manifest as RecordedFmpFixtureManifestV2,
  );
}

async function loadNvidia(manifest: unknown) {
  return loadRecordedNvidiaFixture(
    recordedFixtureArtifactStore(NVIDIA_ROOT, NVIDIA_FIXTURE_SEEDS).store,
    manifest as NvidiaFixtureManifestV2,
  );
}

test("nvidia requires one proof for each derived role and recomputes the complete proof map", async () => {
  const baseline = await loadNvidia(NVIDIA_BASELINE_MANIFEST);
  assert.equal(baseline.status, "emitted");
  assert.equal(baseline.reasonCode, null);

  const reordered = structuredClone(NVIDIA_BASELINE_MANIFEST) as unknown as {
    derivedProofs: Array<(typeof NVIDIA_BASELINE_MANIFEST.derivedProofs)[number]>;
  };
  reordered.derivedProofs.reverse();
  const reorderedResult = await loadNvidia(reordered);
  assert.equal(reorderedResult.status, "emitted");
  assert.deepEqual(
    reorderedResult.transcript.projectionHashes,
    baseline.transcript.projectionHashes,
  );
  assert.equal(reorderedResult.transcriptHash, baseline.transcriptHash);

  const reject = async (manifest: unknown): Promise<void> => {
    const result = await loadNvidia(manifest);
    assert.equal(result.status, "quarantined");
    assert.equal(result.reasonCode, "ir.bundle-hash-mismatch");
    assert.deepEqual(result.transcript.projectionHashes, []);
  };
  const [rssProof, visibleProof] = NVIDIA_BASELINE_MANIFEST.derivedProofs;
  assert.ok(rssProof);
  assert.ok(visibleProof);

  await reject({
    ...NVIDIA_BASELINE_MANIFEST,
    derivedProofs: [rssProof, { ...rssProof }],
  });
  await reject({
    ...NVIDIA_BASELINE_MANIFEST,
    derivedProofs: [visibleProof, { ...visibleProof }],
  });
  await reject({ ...NVIDIA_BASELINE_MANIFEST, derivedProofs: [rssProof] });
  for (const proof of [
    { ...rssProof, parentArtifactHash: "0".repeat(64) },
    { ...rssProof, policy: visibleProof.policy },
    { ...rssProof, projectionHash: "0".repeat(64) },
    { ...rssProof, projectionSizeBytes: rssProof.projectionSizeBytes + 1 },
  ]) {
    await reject({ ...NVIDIA_BASELINE_MANIFEST, derivedProofs: [proof, visibleProof] });
  }
});

test("fmp terminal outcomes have no derived proof and failure transcripts cannot echo a claim", async () => {
  const emitted = fmpCase("latest-explicit-time");
  const proof = emitted.derivedProofs[0];
  assert.ok(proof);
  const malformed = fmpCase("malformed-json");

  const invented = await loadFmp({ ...malformed, derivedProofs: [proof] });
  assert.equal(invented.status, "quarantined");
  assert.equal(invented.reasonCode, "fmp.bundle-hash-mismatch");
  assert.equal(invented.transcript.projectionHash, null);

  const ignored = {
    ...emitted,
    route: { ...emitted.route, classification: "not-earnings-release" as const },
    derivedProofs: [],
    expected: {
      status: "ignored" as const,
      reasonCode: "fmp.not-earnings-related" as const,
      limitKind: null,
      recordId: null,
      revisionId: null,
      rawArtifactHash: emitted.retrievedMembers[0].artifactHash,
      primaryArtifactHash: null,
      selectedProjectionHash: null,
      routeHash: null,
      candidateHash: null,
      eventDraftHash: null,
      publishedAtMs: null,
      timestampConfidence: null,
      originalTimestamp: null,
    },
  };
  const ignoredResult = await loadFmp(ignored);
  assert.equal(ignoredResult.status, "ignored");
  assert.equal(ignoredResult.transcript.projectionHash, null);

  const prohibitedIgnoredProof = await loadFmp({ ...ignored, derivedProofs: [proof] });
  assert.equal(prohibitedIgnoredProof.status, "quarantined");
  assert.equal(prohibitedIgnoredProof.reasonCode, "fmp.bundle-hash-mismatch");
  assert.equal(prohibitedIgnoredProof.transcript.projectionHash, null);

  for (const badProof of [
    { ...proof, parentArtifactHash: "0".repeat(64) },
    { ...proof, projectionHash: "0".repeat(64) },
    { ...proof, projectionSizeBytes: proof.projectionSizeBytes + 1 },
  ]) {
    const failed = await loadFmp({ ...emitted, derivedProofs: [badProof] });
    assert.equal(failed.status, "quarantined");
    assert.equal(failed.reasonCode, "fmp.bundle-hash-mismatch");
    assert.equal(failed.transcript.projectionHash, null);
  }
});
