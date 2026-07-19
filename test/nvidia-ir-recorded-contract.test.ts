import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { setImmediate as drainEventLoop, setTimeout as delay } from "node:timers/promises";

import {
  NVIDIA_BASELINE_MANIFEST,
  NVIDIA_FIXTURE_SEEDS,
  type NvidiaFixtureSeedMemberV1,
} from "../fixtures/ir/nvidia/v1/manifest.js";
import {
  loadRecordedNvidiaFixture,
  type NvidiaDerivedProofV1,
  type NvidiaFixtureManifestV2,
  type NvidiaRetrievedMemberV2,
} from "../src/adapters/ir/nvidia/recorded-nvidia-fixture.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { NVIDIA_IR_LIMITS } from "../src/providers/ir/nvidia/contracts.js";
import {
  assertNvidiaDeclaredLimit,
  assertNvidiaRecordedMemberBounds,
  normalizeRecordedNvidiaIr,
  parseNvidiaReference,
} from "../src/providers/ir/nvidia/normalizer.js";
import {
  fixtureObservation,
  recordedFixtureArtifactStore,
} from "./recorded-fixture-artifact-store.js";

const ROOT = path.join(process.cwd(), "fixtures", "ir", "nvidia", "v1", "bodies");
const FIXTURE_ROOT = path.dirname(ROOT);
const KEY = "https://nvidianews.nvidia.com/news/synthetic-fiscal-2030-q1";
const bytes = (value: string): Uint8Array => Buffer.from(value, "utf8");
const fixture = (name: string): Promise<Buffer> => readFile(path.join(ROOT, name));
type MutableNvidiaManifest = Omit<NvidiaFixtureManifestV2, "retrievedMembers" | "derivedProofs"> & {
  retrievedMembers: NvidiaRetrievedMemberV2[];
  derivedProofs: NvidiaDerivedProofV1[];
};
const loadNvidia = (manifest: NvidiaFixtureManifestV2 = NVIDIA_BASELINE_MANIFEST) =>
  loadRecordedNvidiaFixture(
    recordedFixtureArtifactStore(FIXTURE_ROOT, NVIDIA_FIXTURE_SEEDS).store,
    manifest,
  );

test("offline loader verifies the full recorded manifest before normalization", async () => {
  const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, NVIDIA_FIXTURE_SEEDS);
  const loaded = await loadRecordedNvidiaFixture(authority.store, NVIDIA_BASELINE_MANIFEST);
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
  const proofFailure = await loadNvidia(badProof as unknown as NvidiaFixtureManifestV2);
  assert.equal(proofFailure.reasonCode, "ir.bundle-hash-mismatch");

  assert.equal(authority.counters.observationCalls.size, 2);
  assert.equal(authority.counters.readCalls.size, 2);
  assert.equal(loaded.transcript.observationHashes.length, 2);
  for (const member of NVIDIA_BASELINE_MANIFEST.retrievedMembers) {
    assert.equal(authority.counters.observationCalls.get(member.selectedObservationId), 1);
    assert.equal(authority.counters.readCalls.get(member.artifactHash), 1);
  }
});

test("NVIDIA rejects missing or forged authoritative observations before artifact reads", async () => {
  const mutations = [
    (observation: ReturnType<typeof fixtureObservation>) => ({
      ...observation,
      observationId: "0".repeat(64),
    }),
    (observation: ReturnType<typeof fixtureObservation>) => ({
      ...observation,
      observationHash: "0".repeat(64),
    }),
    (observation: ReturnType<typeof fixtureObservation>) => ({
      ...observation,
      artifactDigest: "0".repeat(64),
    }),
    (observation: ReturnType<typeof fixtureObservation>) => ({
      ...observation,
      provider: "prv1_invalid" as typeof observation.provider,
    }),
    (observation: ReturnType<typeof fixtureObservation>) => ({
      ...observation,
      retrievedAtMs: NVIDIA_BASELINE_MANIFEST.asOfMs + 1,
    }),
  ];
  for (const mutation of mutations) {
    const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, NVIDIA_FIXTURE_SEEDS, {
      observation: mutation,
    });
    const result = await loadRecordedNvidiaFixture(authority.store, NVIDIA_BASELINE_MANIFEST);
    assert.equal(result.reasonCode, "ir.observation-invalid");
    assert.equal(authority.counters.observationCalls.size, 2);
    assert.deepEqual([...authority.counters.observationCalls.values()], [1, 1]);
    assert.equal(authority.counters.readCalls.size, 0);
    assert.deepEqual(result.transcript.artifactHashes, []);
  }
  const missingAuthority = recordedFixtureArtifactStore(FIXTURE_ROOT, NVIDIA_FIXTURE_SEEDS, {
    observation: () => null,
  });
  const missing = await loadRecordedNvidiaFixture(missingAuthority.store, NVIDIA_BASELINE_MANIFEST);
  assert.equal(missing.reasonCode, "ir.observation-invalid");
  assert.equal(missingAuthority.counters.observationCalls.size, 2);
  assert.deepEqual([...missingAuthority.counters.observationCalls.values()], [1, 1]);
  assert.equal(missingAuthority.counters.readCalls.size, 0);
});

test("NVIDIA metadata gate cancels and settles both acquired streams before returning", async () => {
  for (const invalidRole of ["ir.rss-feed", "ir.release-html"] as const) {
    for (const failure of ["invalid", "over-limit"] as const) {
      const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, NVIDIA_FIXTURE_SEEDS, {
        metadataSize: (actualSize, seed) => {
          if (seed.role !== invalidRole) return actualSize;
          return failure === "over-limit" ? NVIDIA_IR_LIMITS.memberBytes + 1 : actualSize + 1;
        },
      });
      const result = await loadRecordedNvidiaFixture(authority.store, NVIDIA_BASELINE_MANIFEST);
      assert.equal(
        result.reasonCode,
        failure === "over-limit" ? "ir.member-limit-exceeded" : "ir.bundle-hash-mismatch",
        `${invalidRole}:${failure}`,
      );
      assert.equal(result.normalization, null);
      assert.deepEqual(result.transcript.projectionHashes, []);
      assert.equal(authority.counters.observationCalls.size, 2);
      assert.equal(authority.counters.readCalls.size, 2);
      for (const member of NVIDIA_BASELINE_MANIFEST.retrievedMembers) {
        assert.equal(authority.counters.observationCalls.get(member.selectedObservationId), 1);
        assert.equal(authority.counters.readCalls.get(member.artifactHash), 1);
        assert.equal(authority.counters.streamStarts.get(member.artifactHash) ?? 0, 0);
        assert.equal(authority.counters.streamSettles.get(member.artifactHash) ?? 0, 0);
        assert.equal(authority.counters.streamCloses.get(member.artifactHash), 1);
        assert.equal(authority.counters.streamedBytes.get(member.artifactHash) ?? 0, 0);
      }
      const activityAtReturn = {
        streamStarts: [...authority.counters.streamStarts],
        streamSettles: [...authority.counters.streamSettles],
        streamCloses: [...authority.counters.streamCloses],
        streamedBytes: [...authority.counters.streamedBytes],
      };
      await drainEventLoop();
      await delay(10);
      assert.deepEqual(
        {
          streamStarts: [...authority.counters.streamStarts],
          streamSettles: [...authority.counters.streamSettles],
          streamCloses: [...authority.counters.streamCloses],
          streamedBytes: [...authority.counters.streamedBytes],
        },
        activityAtReturn,
        `${invalidRole}:${failure}:post-return activity`,
      );
    }
  }

  for (const failedRole of ["ir.rss-feed", "ir.release-html"] as const) {
    const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, NVIDIA_FIXTURE_SEEDS, {
      readError: (seed) =>
        seed.role === failedRole ? new Error("raw-provider-body-sentinel") : null,
    });
    const result = await loadRecordedNvidiaFixture(authority.store, NVIDIA_BASELINE_MANIFEST);
    assert.equal(result.reasonCode, "ir.artifact-read-failed", failedRole);
    assert.equal(result.normalization, null);
    assert.deepEqual(result.transcript.projectionHashes, []);
    assert.equal(JSON.stringify(result).includes("raw-provider-body-sentinel"), false);
    assert.equal(authority.counters.observationCalls.size, 2);
    assert.equal(authority.counters.readCalls.size, 2);
    for (const member of NVIDIA_BASELINE_MANIFEST.retrievedMembers) {
      assert.equal(authority.counters.observationCalls.get(member.selectedObservationId), 1);
      assert.equal(authority.counters.readCalls.get(member.artifactHash), 1);
      assert.equal(authority.counters.streamStarts.get(member.artifactHash) ?? 0, 0);
      assert.equal(authority.counters.streamSettles.get(member.artifactHash) ?? 0, 0);
      assert.equal(
        authority.counters.streamCloses.get(member.artifactHash) ?? 0,
        member.role === failedRole ? 0 : 1,
      );
      assert.equal(authority.counters.streamedBytes.get(member.artifactHash) ?? 0, 0);
    }
    const activityAtReturn = {
      streamStarts: [...authority.counters.streamStarts],
      streamSettles: [...authority.counters.streamSettles],
      streamCloses: [...authority.counters.streamCloses],
      streamedBytes: [...authority.counters.streamedBytes],
    };
    await drainEventLoop();
    await delay(10);
    assert.deepEqual(
      {
        streamStarts: [...authority.counters.streamStarts],
        streamSettles: [...authority.counters.streamSettles],
        streamCloses: [...authority.counters.streamCloses],
        streamedBytes: [...authority.counters.streamedBytes],
      },
      activityAtReturn,
      `${failedRole}:post-return activity`,
    );
  }
});

test("NVIDIA loader enforces exact and one-over member and aggregate byte declarations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "peas-nvidia-bounded-loader-"));
  try {
    await mkdir(path.join(root, "bodies"));
    const exactRssBytes = Buffer.alloc(NVIDIA_IR_LIMITS.memberBytes, 0x20);
    const exactHtmlBytes = Buffer.alloc(NVIDIA_IR_LIMITS.memberBytes, 0x21);
    const exactRssHash = createHash("sha256").update(exactRssBytes).digest("hex");
    const exactHtmlHash = createHash("sha256").update(exactHtmlBytes).digest("hex");
    await Promise.all([
      writeFile(path.join(root, "bodies", "exact.rss"), exactRssBytes),
      writeFile(path.join(root, "bodies", "exact.html"), exactHtmlBytes),
    ]);
    const exactSeeds: readonly NvidiaFixtureSeedMemberV1[] = NVIDIA_FIXTURE_SEEDS.map((seed) => ({
      ...seed,
      path: seed.role === "ir.rss-feed" ? "bodies/exact.rss" : "bodies/exact.html",
      artifactHash: seed.role === "ir.rss-feed" ? exactRssHash : exactHtmlHash,
      sizeBytes: NVIDIA_IR_LIMITS.memberBytes,
      attempt: { ...seed.attempt, attemptId: `nvidia-exact-${seed.role}` },
      response: { ...seed.response, declaredContentLength: NVIDIA_IR_LIMITS.memberBytes },
    }));
    const manifest = structuredClone(NVIDIA_BASELINE_MANIFEST) as unknown as MutableNvidiaManifest;
    manifest.retrievedMembers = manifest.retrievedMembers.map((member) => {
      const seed = exactSeeds.find((candidate) => candidate.role === member.role);
      assert.ok(seed);
      return {
        ...member,
        artifactHash: seed.artifactHash,
        sizeBytes: NVIDIA_IR_LIMITS.memberBytes,
        selectedObservationId: fixtureObservation(seed).observationId,
      };
    });
    manifest.derivedProofs = manifest.derivedProofs.map((proof) => ({
      ...proof,
      parentArtifactHash: proof.role === "ir.rss-item" ? exactRssHash : exactHtmlHash,
    }));
    const exactAuthority = recordedFixtureArtifactStore(root, exactSeeds);
    const exact = await loadRecordedNvidiaFixture(
      exactAuthority.store,
      manifest as unknown as NvidiaFixtureManifestV2,
    );
    assert.equal(exact.reasonCode, "ir.bundle-hash-mismatch");
    assert.deepEqual(exact.transcript.artifactHashes, [exactRssHash, exactHtmlHash]);
    assert.equal(
      exactAuthority.counters.streamedBytes.get(exactRssHash),
      NVIDIA_IR_LIMITS.memberBytes,
    );
    assert.equal(
      exactAuthority.counters.streamedBytes.get(exactHtmlHash),
      NVIDIA_IR_LIMITS.memberBytes,
    );

    for (const memberIndex of [0, 1]) {
      const perMemberOver = structuredClone(manifest);
      const target = perMemberOver.retrievedMembers[memberIndex];
      const sibling = perMemberOver.retrievedMembers[memberIndex === 0 ? 1 : 0];
      assert.ok(target);
      assert.ok(sibling);
      perMemberOver.retrievedMembers[memberIndex] = {
        ...target,
        sizeBytes: NVIDIA_IR_LIMITS.memberBytes + 1,
      };
      perMemberOver.retrievedMembers[memberIndex === 0 ? 1 : 0] = {
        ...sibling,
        sizeBytes: 0,
      };
      const authority = recordedFixtureArtifactStore(root, exactSeeds);
      const rejected = await loadRecordedNvidiaFixture(
        authority.store,
        perMemberOver as unknown as NvidiaFixtureManifestV2,
      );
      assert.equal(rejected.reasonCode, "ir.member-limit-exceeded", String(memberIndex));
      assert.deepEqual(rejected.transcript.artifactHashes, [], String(memberIndex));
      assert.equal(authority.counters.observationCalls.size, 0);
      assert.equal(authority.counters.readCalls.size, 0);
    }

    const aggregateOver = structuredClone(manifest);
    const first = aggregateOver.retrievedMembers[0];
    const second = aggregateOver.retrievedMembers[1];
    assert.ok(first);
    assert.ok(second);
    aggregateOver.retrievedMembers = [
      { ...first, sizeBytes: NVIDIA_IR_LIMITS.memberBytes },
      { ...second, sizeBytes: NVIDIA_IR_LIMITS.memberBytes + 1 },
    ];
    const aggregateAuthority = recordedFixtureArtifactStore(root, exactSeeds);
    const aggregateRejected = await loadRecordedNvidiaFixture(
      aggregateAuthority.store,
      aggregateOver as unknown as NvidiaFixtureManifestV2,
    );
    assert.equal(aggregateRejected.reasonCode, "ir.bundle-byte-limit-exceeded");
    assert.deepEqual(aggregateRejected.transcript.artifactHashes, []);
    assert.equal(aggregateAuthority.counters.observationCalls.size, 0);
    assert.equal(aggregateAuthority.counters.readCalls.size, 0);

    const actualOverBytes = Buffer.alloc(NVIDIA_IR_LIMITS.memberBytes + 1, 0x22);
    const actualOverHash = createHash("sha256").update(actualOverBytes).digest("hex");
    await writeFile(path.join(root, "bodies", "actual-over.rss"), actualOverBytes);
    const actualOverSeeds = exactSeeds.map((seed) =>
      seed.role === "ir.rss-feed"
        ? {
            ...seed,
            path: "bodies/actual-over.rss",
            artifactHash: actualOverHash,
            sizeBytes: NVIDIA_IR_LIMITS.memberBytes + 1,
            attempt: { ...seed.attempt, attemptId: "nvidia-actual-over-rss" },
            response: {
              ...seed.response,
              declaredContentLength: NVIDIA_IR_LIMITS.memberBytes + 1,
            },
          }
        : seed,
    );
    const actualOverManifest = structuredClone(manifest) as MutableNvidiaManifest;
    const actualOverRssIndex = actualOverManifest.retrievedMembers.findIndex(
      (member) => member.role === "ir.rss-feed",
    );
    const actualOverRss = actualOverManifest.retrievedMembers[actualOverRssIndex];
    const actualOverSeed = actualOverSeeds.find((seed) => seed.role === "ir.rss-feed");
    assert.ok(actualOverRss);
    assert.ok(actualOverSeed);
    actualOverManifest.retrievedMembers[actualOverRssIndex] = {
      ...actualOverRss,
      artifactHash: actualOverHash,
      selectedObservationId: fixtureObservation(actualOverSeed).observationId,
    };
    const rssProofIndex = actualOverManifest.derivedProofs.findIndex(
      (proof) => proof.role === "ir.rss-item",
    );
    const rssProof = actualOverManifest.derivedProofs[rssProofIndex];
    assert.ok(rssProof);
    actualOverManifest.derivedProofs[rssProofIndex] = {
      ...rssProof,
      parentArtifactHash: actualOverHash,
    };
    const actualOverAuthority = recordedFixtureArtifactStore(root, actualOverSeeds);
    const actualOver = await loadRecordedNvidiaFixture(
      actualOverAuthority.store,
      actualOverManifest,
    );
    assert.equal(actualOver.reasonCode, "ir.member-limit-exceeded");
    assert.equal(actualOverAuthority.counters.streamedBytes.get(actualOverHash) ?? 0, 0);

    const growthAuthority = recordedFixtureArtifactStore(root, exactSeeds, {
      stream: (_absolutePath, seed) =>
        seed.role === "ir.rss-feed"
          ? Readable.from([exactRssBytes, Buffer.from("x")])
          : Readable.from([exactHtmlBytes]),
    });
    const growth = await loadRecordedNvidiaFixture(growthAuthority.store, manifest);
    assert.equal(growth.reasonCode, "ir.bundle-hash-mismatch");

    const replacementAuthority = recordedFixtureArtifactStore(root, exactSeeds, {
      stream: (_absolutePath, seed) =>
        seed.role === "ir.rss-feed"
          ? Readable.from([Buffer.alloc(NVIDIA_IR_LIMITS.memberBytes, 0x22)])
          : Readable.from([exactHtmlBytes]),
    });
    const replacement = await loadRecordedNvidiaFixture(replacementAuthority.store, manifest);
    assert.equal(replacement.reasonCode, "ir.bundle-hash-mismatch");
    assert.equal(
      replacementAuthority.counters.streamedBytes.get(exactRssHash),
      NVIDIA_IR_LIMITS.memberBytes,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("NVIDIA exact-shape hostile manifest fields fail before any body read", async () => {
  const base = NVIDIA_BASELINE_MANIFEST;
  const [rss, release] = base.retrievedMembers;
  assert.ok(rss);
  assert.ok(release);
  const withRss = (patch: object): unknown => ({
    ...base,
    retrievedMembers: [{ ...rss, ...patch }, release],
  });
  const expectedCases: readonly [string, object][] = [
    ["status", { status: "other" }],
    ["reasonCode", { reasonCode: "other" }],
    ["limitKind iff", { limitKind: "xml-depth" }],
    ["recordId", { recordId: 7 }],
    ["revisionId", { revisionId: 7 }],
    ["issuerCik", { issuerCik: 7 }],
    ["symbol", { symbol: "OTHER" }],
    ["fiscalPeriod", { fiscalPeriod: 7 }],
    ["sourceKind", { sourceKind: "other" }],
    ["publishedAtMs", { publishedAtMs: -1 }],
    ["timestampConfidence", { timestampConfidence: "other" }],
    ["originalTimestamp", { originalTimestamp: 7 }],
    ["primaryArtifactHash", { primaryArtifactHash: null }],
    ["selectedProjectionHash", { selectedProjectionHash: null }],
    ["routeHash", { routeHash: null }],
    ["candidateHash", { candidateHash: null }],
    ["eventDraftHash", { eventDraftHash: null }],
  ];
  const terminalExpected = {
    status: "quarantined",
    reasonCode: "ir.release-malformed",
    limitKind: null,
    recordId: null,
    revisionId: null,
    issuerCik: null,
    symbol: null,
    fiscalPeriod: null,
    sourceKind: null,
    publishedAtMs: null,
    timestampConfidence: null,
    originalTimestamp: null,
    primaryArtifactHash: null,
    selectedProjectionHash: null,
    routeHash: null,
    candidateHash: null,
    eventDraftHash: null,
  } as const;
  const invalidTerminalCases = [
    "recordId",
    "revisionId",
    "issuerCik",
    "symbol",
    "fiscalPeriod",
    "sourceKind",
    "publishedAtMs",
    "timestampConfidence",
    "originalTimestamp",
    "primaryArtifactHash",
    "selectedProjectionHash",
    "routeHash",
    "candidateHash",
    "eventDraftHash",
  ].map(
    (field) =>
      [
        `terminal expected ${field}`,
        {
          ...base,
          expected: {
            ...terminalExpected,
            [field]: (base.expected as unknown as Record<string, unknown>)[field],
          },
        },
      ] as [string, unknown],
  );
  const cases: [string, unknown][] = [
    ["schemaVersion", { ...base, schemaVersion: 1 }],
    ["caseId", { ...base, caseId: 7 }],
    ["provider", { ...base, provider: "other" }],
    ["source", { ...base, source: "other" }],
    ["acquisitionVariant", { ...base, acquisitionVariant: "live" }],
    ["asOfMs", { ...base, asOfMs: -1 }],
    ["selector type", { ...base, selector: { selectionKey: 7 } }],
    ["selector empty", { ...base, selector: { selectionKey: "" } }],
    ["selector UTF-8", { ...base, selector: { selectionKey: "é".repeat(1_025) } }],
    ["selector noncanonical", { ...base, selector: { selectionKey: `${KEY}?query=1` } }],
    ["route policy", { ...base, route: { ...base.route, classificationPolicy: "other" } }],
    ["route issuer", { ...base, route: { ...base.route, issuerCik: "0000000000" } }],
    ["route symbol", { ...base, route: { ...base.route, symbol: "OTHER" } }],
    ["route authority", { ...base, route: { ...base.route, mappingAuthority: "other" } }],
    ["route version", { ...base, route: { ...base.route, mappingVersion: "other" } }],
    ["member kind", withRss({ kind: "derived" })],
    ["member role", withRss({ role: "other" })],
    ["member unexpected path", withRss({ path: "body" })],
    ["member artifact hash", withRss({ artifactHash: 7 })],
    ["member size", withRss({ sizeBytes: -1 })],
    ["member selected observation", withRss({ selectedObservationId: 7 })],
    ["member unexpected observation", withRss({ observation: {} })],
    [
      "provenance classification",
      { ...base, provenance: { ...base.provenance, classification: "other" } },
    ],
    ["provenance note type", { ...base, provenance: { ...base.provenance, note: 7 } }],
    ["provenance note empty", { ...base, provenance: { ...base.provenance, note: "" } }],
    [
      "provenance note UTF-8",
      { ...base, provenance: { ...base.provenance, note: "é".repeat(2_049) } },
    ],
    [
      "provenance approval",
      { ...base, provenance: { ...base.provenance, approvalReference: "unapproved" } },
    ],
    [
      "redistribution approval required",
      {
        ...base,
        provenance: {
          ...base.provenance,
          classification: "redistribution-approved",
          approvalReference: null,
        },
      },
    ],
    [
      "redistribution approval type",
      {
        ...base,
        provenance: {
          ...base.provenance,
          classification: "redistribution-approved",
          approvalReference: 7,
        },
      },
    ],
    [
      "redistribution approval UTF-8",
      {
        ...base,
        provenance: {
          ...base.provenance,
          classification: "redistribution-approved",
          approvalReference: "é".repeat(257),
        },
      },
    ],
    ...expectedCases.map(
      ([name, patch]) =>
        [`expected ${name}`, { ...base, expected: { ...base.expected, ...patch } }] as [
          string,
          unknown,
        ],
    ),
    ...invalidTerminalCases,
  ];
  for (const [name, manifest] of cases) {
    const authority = recordedFixtureArtifactStore(FIXTURE_ROOT, NVIDIA_FIXTURE_SEEDS);
    const result = await loadRecordedNvidiaFixture(
      authority.store,
      manifest as NvidiaFixtureManifestV2,
    );
    assert.equal(result.status, "quarantined", name);
    assert.deepEqual(result.transcript.artifactHashes, [], name);
    assert.equal(result.normalization, null, name);
    assert.equal(authority.counters.observationCalls.size, 0, name);
    assert.equal(authority.counters.readCalls.size, 0, name);
  }
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

test("record-family ambiguity is reached through a real RSS feed", async () => {
  const baseline = (await fixture("baseline.rss")).toString("utf8");
  const item = /<item>[\s\S]*<\/item>/u.exec(baseline)?.[0];
  assert.ok(item);
  const conflictingFamily = item
    .replaceAll("synthetic-fiscal-2030-q1", "synthetic-fiscal-2030-q1-correction")
    .replace("Entirely synthetic release.", "Conflicting retained RSS projection.");
  const result = normalizeRecordedNvidiaIr({
    rssBytes: bytes(baseline.replace("</channel>", `${conflictingFamily}</channel>`)),
    releaseHtmlBytes: await fixture("baseline.html"),
    selectionKey: KEY,
  });
  assert.equal(result.status, "quarantined");
  if (result.status === "quarantined")
    assert.equal(result.reasonCode, "ir.record-family-ambiguous");
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

test("NVIDIA URL policy rejects hostile RSS, canonical, and og:url references", async () => {
  const rss = (await fixture("baseline.rss")).toString("utf8");
  const html = (await fixture("baseline.html")).toString("utf8");
  for (const forbidden of [
    "https://other.invalid/news/synthetic-fiscal-2030-q1",
    "https://nvidianews.nvidia.com:443/news/synthetic-fiscal-2030-q1",
    "https://user:pass@nvidianews.nvidia.com/news/synthetic-fiscal-2030-q1",
    "https://nvidianews.nvidia.com/news/synthetic%2dfiscal-2030-q1",
    "https://nvidianews.nvidia.com\\news\\synthetic-fiscal-2030-q1",
    "https://nvidianews.nvidia.com//news/synthetic-fiscal-2030-q1",
    "https://nvidianews.nvidia.com/news/../synthetic-fiscal-2030-q1",
    "https://nvidianews.nvidia.com/news/synthetïc-fiscal-2030-q1",
  ]) {
    const result = normalizeRecordedNvidiaIr({
      rssBytes: bytes(rss.replaceAll(KEY, forbidden)),
      releaseHtmlBytes: bytes(html),
      selectionKey: KEY,
    });
    assert.equal(result.status, "quarantined", forbidden);
    if (result.status === "quarantined")
      assert.equal(result.reasonCode, "ir.link-invalid", forbidden);
  }
  const queryFragment = normalizeRecordedNvidiaIr({
    rssBytes: bytes(rss.replace("?source=rss#release", "?query=accepted#fragment")),
    releaseHtmlBytes: bytes(html.replace("?view=full", "?query=accepted#fragment")),
    selectionKey: `${KEY}?query=accepted#fragment`,
  });
  assert.equal(queryFragment.status, "emitted");
  for (const [attribute, value] of [
    ["href", "https://other.invalid/news/synthetic-fiscal-2030-q1"],
    ["content", "https://nvidianews.nvidia.com:443/news/synthetic-fiscal-2030-q1"],
  ] as const) {
    const result = normalizeRecordedNvidiaIr({
      rssBytes: bytes(rss),
      releaseHtmlBytes: bytes(
        html.replace(new RegExp(`${attribute}="[^"]+"`, "u"), `${attribute}="${value}"`),
      ),
      selectionKey: KEY,
    });
    assert.equal(result.status, "quarantined", attribute);
    if (result.status === "quarantined") assert.equal(result.reasonCode, "ir.canonical-conflict");
  }
});

test("NVIDIA validates member types and bounds before any raw member digest", async () => {
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
  const html = await fixture("baseline.html");
  for (const hostile of [null, "rss", {}, []]) {
    for (const [rssBytes, releaseHtmlBytes] of [
      [hostile, html],
      [await fixture("baseline.rss"), hostile],
    ]) {
      const result = normalizeRecordedNvidiaIr({
        rssBytes,
        releaseHtmlBytes,
        selectionKey: KEY,
      } as unknown as Parameters<typeof normalizeRecordedNvidiaIr>[0]);
      assert.equal(result.status, "quarantined");
      if (result.status === "quarantined") {
        assert.equal(result.reasonCode, "ir.bundle-invalid");
        assert.equal(result.transcript.rssArtifactHash, "0".repeat(64));
        assert.equal(result.transcript.releaseHtmlArtifactHash, "0".repeat(64));
      }
    }
  }
  const oversizedInputs: readonly (readonly [Uint8Array, Uint8Array])[] = [
    [new Uint8Array(NVIDIA_IR_LIMITS.memberBytes + 1), html],
    [await fixture("baseline.rss"), new Uint8Array(NVIDIA_IR_LIMITS.memberBytes + 1)],
  ];
  for (const [rssBytes, releaseHtmlBytes] of oversizedInputs) {
    const oversized = normalizeRecordedNvidiaIr({ rssBytes, releaseHtmlBytes, selectionKey: KEY });
    assert.equal(oversized.status, "quarantined");
    if (oversized.status === "quarantined") {
      assert.equal(oversized.reasonCode, "ir.member-limit-exceeded");
      assert.equal(oversized.transcript.rssArtifactHash, "0".repeat(64));
      assert.equal(oversized.transcript.releaseHtmlArtifactHash, "0".repeat(64));
    }
  }
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

test("NVIDIA public normalizer rejects hostile containers before any caller trap can execute", async () => {
  const input = {
    rssBytes: new Uint8Array(await fixture("baseline.rss")),
    releaseHtmlBytes: new Uint8Array(await fixture("baseline.html")),
    selectionKey: KEY,
  };
  const baseline = normalizeRecordedNvidiaIr(input);
  assert.equal(baseline.status, "emitted");
  assert.deepEqual(
    normalizeRecordedNvidiaIr(
      {
        rssBytes: new Uint8Array(input.rssBytes),
        releaseHtmlBytes: new Uint8Array(input.releaseHtmlBytes),
        selectionKey: KEY,
      },
      { rssChunkSize: 1, htmlChunkSize: 7 },
    ),
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
  Object.defineProperty(nonEnumerableOuter, "selectionKey", { enumerable: false, value: KEY });
  const customPrototypeOuter = Object.setPrototypeOf({ ...input }, { hostile: true });
  const byteProxy = new Proxy(new Uint8Array(input.rssBytes), {
    get() {
      proxyCalls += 1;
      throw new Error("byte proxy trap must not run");
    },
  });
  let revokedProxyCalls = 0;
  const revokedOuter = Proxy.revocable(input, {
    get() {
      revokedProxyCalls += 1;
      throw new Error("revoked outer get trap must not run");
    },
    ownKeys() {
      revokedProxyCalls += 1;
      throw new Error("revoked outer ownKeys trap must not run");
    },
    getOwnPropertyDescriptor() {
      revokedProxyCalls += 1;
      throw new Error("revoked outer descriptor trap must not run");
    },
  });
  revokedOuter.revoke();

  const assertBoundaryQuarantine = (
    result: ReturnType<typeof normalizeRecordedNvidiaIr>,
    name: string,
  ): void => {
    assert.equal(result.status, "quarantined", name);
    if (result.status !== "quarantined") return;
    assert.equal(result.reasonCode, "ir.bundle-invalid", name);
    assert.equal("candidate" in result, false, name);
    assert.equal("draft" in result, false, name);
    assert.equal(result.transcript.rssArtifactHash, "0".repeat(64), name);
    assert.equal(result.transcript.releaseHtmlArtifactHash, "0".repeat(64), name);
    assert.equal(result.transcript.rssItemProjectionHash, null, name);
    assert.equal(result.transcript.releaseVisibleProjectionHash, null, name);
    assert.equal(result.transcript.selectedProjectionHash, null, name);
    assert.equal(result.transcript.candidateHash, null, name);
    assert.equal(result.transcript.eventDraftHash, null, name);
  };

  const hostileInputs: readonly [string, unknown][] = [
    ["accessor outer", accessorOuter],
    ["proxy outer", proxyOuter],
    ["inherited outer", inheritedOuter],
    ["missing outer field", { rssBytes: input.rssBytes, selectionKey: KEY }],
    ["extra outer field", { ...input, unexpected: true }],
    ["symbol outer field", symbolOuter],
    ["non-enumerable outer field", nonEnumerableOuter],
    ["custom outer prototype", customPrototypeOuter],
    ["proxy byte member", { ...input, rssBytes: byteProxy }],
    ["non-byte member", { ...input, releaseHtmlBytes: {} }],
    ["revoked outer proxy", revokedOuter.proxy],
  ];
  for (const [name, hostile] of hostileInputs) {
    const result = normalizeRecordedNvidiaIr(
      hostile as Parameters<typeof normalizeRecordedNvidiaIr>[0],
    );
    assertBoundaryQuarantine(result, name);
  }

  const accessorOptions = {};
  Object.defineProperty(accessorOptions, "rssChunkSize", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      throw new Error("parser option getter must not run");
    },
  });
  const proxyOptions = new Proxy(
    {},
    {
      get() {
        proxyCalls += 1;
        throw new Error("parser option get trap must not run");
      },
      ownKeys() {
        proxyCalls += 1;
        throw new Error("parser option ownKeys trap must not run");
      },
      getOwnPropertyDescriptor() {
        proxyCalls += 1;
        throw new Error("parser option descriptor trap must not run");
      },
    },
  );
  const symbolOptions = {};
  Object.defineProperty(symbolOptions, Symbol("hostile"), { enumerable: true, value: true });
  const cyclicOptions: Record<string, unknown> = {};
  cyclicOptions["self"] = cyclicOptions;
  const revokedOptions = Proxy.revocable(
    {},
    {
      get() {
        revokedProxyCalls += 1;
        throw new Error("revoked option get trap must not run");
      },
      ownKeys() {
        revokedProxyCalls += 1;
        throw new Error("revoked option ownKeys trap must not run");
      },
      getOwnPropertyDescriptor() {
        revokedProxyCalls += 1;
        throw new Error("revoked option descriptor trap must not run");
      },
    },
  );
  revokedOptions.revoke();
  const hostileOptions: readonly [string, unknown][] = [
    ["accessor parser option", accessorOptions],
    ["proxy parser option", proxyOptions],
    ["inherited parser option", Object.create({ rssChunkSize: 1 })],
    ["extra parser option", { unexpected: true }],
    ["symbol parser option", symbolOptions],
    ["custom parser option prototype", Object.setPrototypeOf({}, { hostile: true })],
    ["sparse parser option", new Array(1)],
    ["cyclic parser option", cyclicOptions],
    ["revoked parser option proxy", revokedOptions.proxy],
  ];
  for (const [name, hostile] of hostileOptions) {
    const result = normalizeRecordedNvidiaIr(input, hostile as never);
    assertBoundaryQuarantine(result, name);
  }
  assert.equal(accessorCalls, 0);
  assert.equal(proxyCalls, 0);
  assert.equal(revokedProxyCalls, 0);
});

test("RSS and visible-release projection ceilings are enforced before projection hashes", async () => {
  const baselineRss = (await fixture("baseline.rss")).toString("utf8");
  const baselineHtml = (await fixture("baseline.html")).toString("utf8");
  const rssWithDescription = (description: string): Uint8Array =>
    bytes(
      baselineRss.replace(
        "<description>Entirely synthetic release.</description>",
        `<description>${description}</description>`,
      ),
    );
  const releaseWithBodyText = (bodyText: string): Uint8Array =>
    bytes(baselineHtml.replace("All prose in this fixture is original.", bodyText));
  const emptyRss = normalizeRecordedNvidiaIr({
    rssBytes: rssWithDescription(""),
    releaseHtmlBytes: bytes(baselineHtml),
    selectionKey: KEY,
  });
  const oneRss = normalizeRecordedNvidiaIr({
    rssBytes: rssWithDescription("x"),
    releaseHtmlBytes: bytes(baselineHtml),
    selectionKey: KEY,
  });
  assert.equal(emptyRss.status, "emitted");
  assert.equal(oneRss.status, "emitted");
  if (emptyRss.status !== "emitted" || oneRss.status !== "emitted") return;
  const oneRssBytes = Buffer.byteLength(
    canonicalJson(oneRss.projections.rssItem as unknown as JsonValue),
    "utf8",
  );
  const rssExactLength = NVIDIA_IR_LIMITS.projectionBytes - oneRssBytes + 1;
  const rssExact = normalizeRecordedNvidiaIr({
    rssBytes: rssWithDescription("x".repeat(rssExactLength)),
    releaseHtmlBytes: bytes(baselineHtml),
    selectionKey: KEY,
  });
  assert.equal(rssExact.status, "emitted");
  if (rssExact.status !== "emitted") return;
  assert.equal(
    Buffer.byteLength(canonicalJson(rssExact.projections.rssItem as unknown as JsonValue), "utf8"),
    NVIDIA_IR_LIMITS.projectionBytes,
  );
  const rssOver = normalizeRecordedNvidiaIr({
    rssBytes: rssWithDescription("x".repeat(rssExactLength + 1)),
    releaseHtmlBytes: bytes(baselineHtml),
    selectionKey: KEY,
  });
  assert.equal(rssOver.status, "quarantined");
  if (rssOver.status === "quarantined") {
    assert.equal(rssOver.reasonCode, "ir.parser-limit-exceeded");
    assert.equal(rssOver.transcript.limitKind, "extracted-text-bytes");
  }

  const emptyRelease = normalizeRecordedNvidiaIr({
    rssBytes: bytes(baselineRss),
    releaseHtmlBytes: releaseWithBodyText(""),
    selectionKey: KEY,
  });
  const oneRelease = normalizeRecordedNvidiaIr({
    rssBytes: bytes(baselineRss),
    releaseHtmlBytes: releaseWithBodyText("x"),
    selectionKey: KEY,
  });
  assert.equal(emptyRelease.status, "emitted");
  assert.equal(oneRelease.status, "emitted");
  if (emptyRelease.status !== "emitted" || oneRelease.status !== "emitted") return;
  const oneReleaseBytes = Buffer.byteLength(
    canonicalJson(oneRelease.projections.releaseVisible as unknown as JsonValue),
    "utf8",
  );
  const releaseExactLength = NVIDIA_IR_LIMITS.projectionBytes - oneReleaseBytes + 1;
  const releaseExact = normalizeRecordedNvidiaIr({
    rssBytes: bytes(baselineRss),
    releaseHtmlBytes: releaseWithBodyText("x".repeat(releaseExactLength)),
    selectionKey: KEY,
  });
  assert.equal(releaseExact.status, "emitted");
  if (releaseExact.status !== "emitted") return;
  assert.equal(
    Buffer.byteLength(
      canonicalJson(releaseExact.projections.releaseVisible as unknown as JsonValue),
      "utf8",
    ),
    NVIDIA_IR_LIMITS.projectionBytes,
  );
  const releaseOver = normalizeRecordedNvidiaIr({
    rssBytes: bytes(baselineRss),
    releaseHtmlBytes: releaseWithBodyText("x".repeat(releaseExactLength + 1)),
    selectionKey: KEY,
  });
  assert.equal(releaseOver.status, "quarantined");
  if (releaseOver.status === "quarantined") {
    assert.equal(releaseOver.reasonCode, "ir.parser-limit-exceeded");
    assert.equal(releaseOver.transcript.limitKind, "extracted-text-bytes");
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
