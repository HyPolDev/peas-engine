import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { test } from "node:test";

import type { ArtifactStore } from "../src/artifacts/artifact-store.js";
import { canonicalHash } from "../src/core/hash.js";
import {
  createIssuerMapping,
  createObservationLedgerEntry,
  deriveAcquisitionObservationId,
  deriveMarketReferenceJoinKey,
  deriveProjectionDigest,
  deriveProjectionId,
  deriveRevisionFamilyIdentity,
  deriveSourceObservationId,
  deriveSourceRecordIdentity,
  deriveSourceVersionIdentity,
  validateObservationLedgerBundle,
  type ClockStampV1,
  type ObservationLedgerEntryV1,
  type RawArtifactLinkV1,
} from "../src/providers/observation-ledger.js";
import {
  DeliveryConflictRegistry,
  MarketAcquisitionLedger,
  verifyCommittedArtifact,
} from "../src/adapters/market-acquisition/artifact-integration.js";
import { retentionGuardedArtifactStore } from "./p1-10-repair-fixtures.js";
import {
  canonicalReplayProjection,
  replayAcquisitionLedger,
  replayVerifiedAcquisition,
} from "../src/adapters/market-acquisition/replay.js";

const bytes = Buffer.from('{"original":"synthetic-market-page"}', "utf8");
const digest = createHash("sha256").update(bytes).digest("hex");
const hash = (member: string): string =>
  canonicalHash("peas/p1-10-artifact-replay-test/v1", { member });
const retrievalAttemptId = `rat1_${hash("attempt")}`;
const requestIdentityHash = hash("request");
const artifactObservationId = hash("vault-observation");
const artifactObservationHash = hash("vault-observation-hash");
const acquisitionObservationId = deriveAcquisitionObservationId({
  provider: "alpaca",
  retrievalAttemptId,
  sanitizedRequestIdentityHash: requestIdentityHash,
  routeLabel: "alpaca-v2-historical-quotes",
});

function artifactStoreDouble(): Readonly<{ store: ArtifactStore; readCalls: () => number }> {
  let reads = 0;
  const request = {
    method: "GET",
    origin: "https://data.alpaca.markets",
    pathHash: hash("path"),
    routeLabel: "alpaca-v2-historical-quotes",
    identityHash: requestIdentityHash,
  };
  const attempt = {
    attemptId: retrievalAttemptId,
    provider: "alpaca",
    recordId: "synthetic-record",
    revisionId: "synthetic-revision",
    startedAtMs: 1_000,
    request,
    stagingId: "synthetic-stage",
    recordedAtMs: 1_000,
  };
  const observation = {
    observationId: artifactObservationId,
    attemptId: retrievalAttemptId,
    artifactDigest: digest,
    provider: "alpaca",
    recordId: "synthetic-record",
    revisionId: "synthetic-revision",
    retrievedAtMs: 1_001,
    request,
    response: {
      statusCode: 200,
      etag: null,
      lastModified: null,
      mediaType: "application/json",
      contentEncoding: null,
      declaredContentLength: bytes.byteLength,
      transportDecoded: true,
    },
    observationHash: artifactObservationHash,
  };
  const metadata = {
    digest,
    algorithm: "sha256",
    sizeBytes: bytes.byteLength,
    committedAtMs: 1_002,
    provenance: "retrieval",
  };
  const store = {
    async store() {
      throw new Error("unexpected-store");
    },
    async stat(candidate: string) {
      return candidate === digest ? metadata : undefined;
    },
    async read(candidate: string) {
      if (candidate !== digest) throw new Error("unexpected-digest");
      reads += 1;
      return { artifact: metadata, stream: Readable.from([bytes]) };
    },
    async getAttempt(candidate: string) {
      return candidate === retrievalAttemptId ? attempt : undefined;
    },
    async getObservation(candidate: string) {
      return candidate === artifactObservationId ? observation : undefined;
    },
    async readObservations() {
      return { items: [observation], nextSequence: "1", hasMore: false };
    },
    async reconcile() {
      throw new Error("unexpected-reconcile");
    },
  } as unknown as ArtifactStore;
  return { store, readCalls: () => reads };
}

function clock(ledger: MarketAcquisitionLedger, position: number): ClockStampV1 {
  return {
    clockBasisId: ledger.clockBasis.clockBasisId,
    wallTimeMs: 1_000 + position,
    monotonicTimeUs: 10_000 + position,
  };
}

function buildLiveLedger(): readonly ObservationLedgerEntryV1[] {
  const ledger = new MarketAcquisitionLedger("p1-10-live-synthetic-v1", {
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorMs: 0,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: "synthetic-process-session-v1",
  });
  const acquisition = ledger.declareAcquisition(
    {
      kind: "acquisition.declared",
      acquisitionObservationId,
      provider: "alpaca",
      retrievalAttemptId,
      sanitizedRequestIdentityHash: requestIdentityHash,
      routeLabel: "alpaca-v2-historical-quotes",
    },
    clock(ledger, 0),
  );
  const started = ledger.requestStarted(
    acquisition,
    { kind: "request.started", acquisitionObservationId },
    clock(ledger, 1),
  );
  const succeeded = ledger.requestSucceeded(
    started,
    {
      kind: "request.succeeded",
      acquisitionObservationId,
      safeResponseMetadataHash: hash("response-metadata"),
    },
    clock(ledger, 2),
  );
  const committed = ledger.artifactCommitted(
    acquisition,
    succeeded,
    {
      kind: "artifact.committed",
      acquisitionObservationId,
      vaultObservationId: artifactObservationId,
      vaultObservationHash: artifactObservationHash,
      artifactDigest: digest,
      sizeBytes: bytes.byteLength,
      acquisitionMode: "live",
      retrievedAtMs: 1_003,
    },
    clock(ledger, 3),
  );
  const verified = ledger.artifactVerified(
    committed,
    {
      kind: "artifact.verified",
      acquisitionObservationId,
      vaultObservationId: artifactObservationId,
      artifactDigest: digest,
      metadataSizeBytes: bytes.byteLength,
      consumedSizeBytes: bytes.byteLength,
    },
    clock(ledger, 4),
  );
  const rawArtifactLinks: readonly RawArtifactLinkV1[] = [
    {
      role: "primary",
      acquisitionObservationId,
      vaultObservationId: artifactObservationId,
      vaultObservationHash: artifactObservationHash,
      artifactDigest: digest,
      sizeBytes: bytes.byteLength,
    },
  ];
  const loaderIdentity = "p1-10-synthetic-loader-v1";
  const normalizerIdentity = "p1-10-synthetic-normalizer-v1";
  const projectionDigest = deriveProjectionDigest({ syntheticProjection: "alpha" });
  const projectionId = deriveProjectionId({
    loaderIdentity,
    normalizerIdentity,
    rawArtifactLinks,
    projectionDigest,
  });
  const sourceRecordIdentity = deriveSourceRecordIdentity({
    provider: "alpaca",
    source: "p1-10-original-synthetic",
    providerRecordId: artifactObservationId,
  });
  const sourceVersionIdentity = deriveSourceVersionIdentity({
    sourceRecordIdentity,
    providerRevisionId: "synthetic-revision-v1",
    projectionDigest,
    evidenceBundleHash: null,
  });
  const revisionFamilyIdentity = deriveRevisionFamilyIdentity({
    provider: "alpaca",
    source: "p1-10-original-synthetic",
    providerStableRecordFamily: artifactObservationId,
  });
  const sourceObservationId = deriveSourceObservationId({
    sourceVersionIdentity,
    projectionId,
    rawArtifactLinks,
  });
  const issuerMapping = createIssuerMapping({
    issuerCik: "0000000001",
    symbols: ["ZZZA"],
    selectedSymbol: "ZZZA",
    mappingAuthority: "p1-10-original-synthetic",
    mappingVersion: "v1",
    effectiveFromMs: null,
    effectiveToMs: null,
  });
  const normalized = ledger.normalizationOutcome(
    [verified],
    {
      kind: "normalization.emitted",
      projectionId,
      projectionDigest,
      sourceObservationId,
      sourceIdentity: {
        provider: "alpaca",
        source: "p1-10-original-synthetic",
        sourceKind: "filing",
        providerRecordId: artifactObservationId,
        providerRevisionId: "synthetic-revision-v1",
        sourceRecordIdentity,
        sourceVersionIdentity,
        revisionFamilyIdentity,
        supersedesSourceVersionIdentity: null,
      },
      publicationTime: {
        publishedAtMs: null,
        timestampConfidence: "unknown",
        originalTimestamp: null,
      },
      issuerMapping,
      subject: "p1-10-original-synthetic-subject",
      fiscalPeriod: "synthetic-period",
      evidenceBundleHash: null,
      primaryArtifactHash: digest,
      primaryArtifactKind: "raw-artifact",
      rawArtifactLinks,
      loaderIdentity,
      selectionHash: hash("selection"),
      loaderTranscriptHash: hash("loader-transcript"),
      normalizerIdentity,
      normalizerTranscriptHash: hash("normalizer-transcript"),
      eventDraftHash: hash("event-draft"),
    },
    clock(ledger, 5),
  );
  const trustedObservationBasis = {
    basisKind: "retrieval",
    role: "primary",
    acquisitionObservationId,
    vaultObservationId: artifactObservationId,
    retrievedAtMs: 1_003,
    clockBasisId: ledger.clockBasis.clockBasisId,
  } as const;
  ledger.selectionRecorded(
    normalized,
    verified,
    {
      kind: "selection.recorded",
      purpose: "market-reference-anchor",
      selectionBasis: "retrieval",
      trustedObservationBasis,
      selectedSourceObservationId: sourceObservationId,
      selectedSourceVersionIdentity: sourceVersionIdentity,
      subject: "p1-10-original-synthetic-subject",
      issuerMappingId: issuerMapping.issuerMappingId,
      asOfMs: 1_006,
      branchId: null,
      marketReferenceJoinKey: deriveMarketReferenceJoinKey({
        subject: "p1-10-original-synthetic-subject",
        issuerMappingId: issuerMapping.issuerMappingId,
        selectedSourceObservationId: sourceObservationId,
        selectedSourceVersionIdentity: sourceVersionIdentity,
        trustedObservationBasis,
      }),
    },
    clock(ledger, 6),
  );
  return ledger.entries;
}

test("artifact verification reconciles attempt, observation, metadata, digest, and consumed bytes", async () => {
  const fixture = artifactStoreDouble();
  const guarded = retentionGuardedArtifactStore(fixture.store, [
    { artifactDigest: digest, artifactSizeBytes: bytes.byteLength, artifactObservationId },
  ]);
  const verified = await verifyCommittedArtifact(guarded, {
    artifactObservationId,
    artifactDigest: digest,
    artifactSizeBytes: bytes.byteLength,
    artifactObservationHash,
    retrievalAttemptId,
    requestIdentityHash,
    provider: "alpaca",
  });
  assert.equal(verified.consumedSizeBytes, bytes.byteLength);
  assert.equal(fixture.readCalls(), 1);
  await assert.rejects(
    () =>
      verifyCommittedArtifact(guarded, {
        artifactObservationId,
        artifactDigest: digest,
        artifactSizeBytes: bytes.byteLength + 1,
        artifactObservationHash,
        retrievalAttemptId,
        requestIdentityHash,
        provider: "alpaca",
      }),
    /artifact-metadata-mismatch/u,
  );
  await assert.rejects(
    () =>
      verifyCommittedArtifact(fixture.store as never, {
        artifactObservationId,
        artifactDigest: digest,
        artifactSizeBytes: bytes.byteLength,
        artifactObservationHash,
        retrievalAttemptId,
        requestIdentityHash,
        provider: "alpaca",
      }),
    /retention-enforced-store-required/u,
  );
});

test("live ledger uses genuine ADR-0009 entries and a distinct matching clock parent", () => {
  const ledger = buildLiveLedger();
  assert.doesNotThrow(() => validateObservationLedgerBundle(ledger));
  const declaration = ledger[0];
  assert.equal(declaration?.facts.kind, "clock-basis.declared");
  for (const entry of ledger.slice(1)) {
    assert.match(entry.entryId, /^ole1_[0-9a-f]{64}$/u);
    assert.equal(entry.parentEntryIds.filter((id) => id === declaration?.entryId).length, 1);
  }
  assert.deepEqual(
    ledger.map((entry) => entry.facts.kind),
    [
      "clock-basis.declared",
      "acquisition.declared",
      "request.started",
      "request.succeeded",
      "artifact.committed",
      "artifact.verified",
      "normalization.emitted",
      "selection.recorded",
    ],
  );
  const acquisition = ledger.find((entry) => entry.facts.kind === "acquisition.declared");
  const hostile = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: acquisition?.executionId as string,
    parentEntryIds: [],
    clock: acquisition?.clock as ClockStampV1,
    facts: acquisition?.facts as Extract<
      ObservationLedgerEntryV1["facts"],
      { kind: "acquisition.declared" }
    >,
  });
  assert.throws(
    () => validateObservationLedgerBundle([ledger[0] as ObservationLedgerEntryV1, hostile]),
    /observation.clock-basis-invalid/u,
  );
});

test("replay is page-size invariant, omits request facts, and re-verifies artifacts", async () => {
  const live = buildLiveLedger();
  const projections = [1, 2, 7, 10_000].map((pageSize) => {
    const replay = replayAcquisitionLedger(live, "p1-10-replay-synthetic-v1", pageSize);
    assert.equal(
      replay.some((entry) => entry.facts.kind === "request.started"),
      false,
    );
    assert.equal(
      replay.some((entry) => entry.facts.kind === "request.succeeded"),
      false,
    );
    const replayCommit = replay.find((entry) => entry.facts.kind === "artifact.committed");
    assert.equal(
      replayCommit?.facts.kind === "artifact.committed" ? replayCommit.facts.acquisitionMode : null,
      "replay",
    );
    return canonicalReplayProjection(replay);
  });
  assert.equal(new Set(projections).size, 1);
  const fixture = artifactStoreDouble();
  const guarded = retentionGuardedArtifactStore(fixture.store, [
    { artifactDigest: digest, artifactSizeBytes: bytes.byteLength, artifactObservationId },
  ]);
  await replayVerifiedAcquisition({
    artifactStore: guarded,
    artifacts: [
      {
        artifactObservationId,
        artifactDigest: digest,
        artifactSizeBytes: bytes.byteLength,
        artifactObservationHash,
        retrievalAttemptId,
        requestIdentityHash,
        provider: "alpaca",
      },
      {
        artifactObservationId,
        artifactDigest: digest,
        artifactSizeBytes: bytes.byteLength,
        artifactObservationHash,
        retrievalAttemptId,
        requestIdentityHash,
        provider: "alpaca",
      },
    ],
    ledger: live,
    executionId: "p1-10-replay-verified-v1",
    pageSize: 2,
  });
  assert.equal(fixture.readCalls(), 1, "physical duplicate is reverified once per replay");
});

test("duplicate and conflicting delivery classification is order-independent", () => {
  const first = hash("delivery-a");
  const second = hash("delivery-b");
  for (const order of [
    [first, second],
    [second, first],
  ]) {
    const registry = new DeliveryConflictRegistry();
    registry.observe("asserted-delivery-v1", order[0] as string);
    assert.deepEqual(registry.observe("asserted-delivery-v1", order[0] as string), {
      kind: "exact-redelivery",
      digests: [order[0]],
    });
    assert.deepEqual(registry.observe("asserted-delivery-v1", order[1] as string), {
      kind: "conflict-quarantined",
      digests: [first, second].sort(),
    });
  }
});

test("verified replay requires exact complete ledger-to-artifact coverage and conflicting duplicates reject", async () => {
  const ledger = buildLiveLedger();
  const fixture = artifactStoreDouble();
  const guarded = retentionGuardedArtifactStore(fixture.store, [
    { artifactDigest: digest, artifactSizeBytes: bytes.byteLength, artifactObservationId },
  ]);
  const expected = {
    artifactObservationId,
    artifactDigest: digest,
    artifactSizeBytes: bytes.byteLength,
    artifactObservationHash,
    retrievalAttemptId,
    requestIdentityHash,
    provider: "alpaca",
  } as const;
  const replay = (artifacts: readonly (typeof expected)[]) =>
    replayVerifiedAcquisition({
      artifactStore: guarded,
      artifacts,
      ledger,
      executionId: `p1-10-exact-coverage-${artifacts.length}`,
      pageSize: 2,
    });
  await assert.rejects(() => replay([]), /replay-artifact-coverage-mismatch/u);
  await assert.rejects(
    () =>
      replay([expected, { ...expected, artifactObservationId: hash("unexpected-observation") }]),
    /artifact-expectation-invalid|replay-artifact-coverage-mismatch|non-JSON undefined/u,
  );
  await assert.rejects(
    () => replay([expected, { ...expected, provider: "substituted" } as never]),
    /replay-artifact-expectation-conflict/u,
  );
  await assert.rejects(
    () => replay([{ ...expected, artifactObservationHash: undefined } as never]),
    /artifact-expectation-invalid|replay-artifact-coverage-mismatch|non-JSON undefined/u,
  );
  assert.equal(fixture.readCalls(), 0);
});

test("verified replay snapshots the complete expectation tuple before the first await", async () => {
  const ledger = buildLiveLedger();
  const fixture = artifactStoreDouble();
  const guarded = retentionGuardedArtifactStore(fixture.store, [
    { artifactDigest: digest, artifactSizeBytes: bytes.byteLength, artifactObservationId },
  ]);
  const mutable = {
    artifactObservationId,
    artifactDigest: digest,
    artifactSizeBytes: bytes.byteLength,
    artifactObservationHash,
    retrievalAttemptId,
    requestIdentityHash,
    provider: "alpaca",
  };
  const pending = replayVerifiedAcquisition({
    artifactStore: guarded,
    artifacts: [mutable],
    ledger,
    executionId: "p1-10-replay-expectation-snapshot-v1",
    pageSize: 2,
  });
  mutable.provider = "substituted-after-call";
  mutable.artifactDigest = hash("substituted-after-call");
  await pending;
  assert.equal(fixture.readCalls(), 1);
});
