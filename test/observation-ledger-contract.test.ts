import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "../src/core/hash.js";
import { assertJsonWithinLimits, canonicalJson, type JsonValue } from "../src/core/json.js";
import {
  type ClockStampV1,
  createClockBasis,
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
  OBSERVATION_LEDGER_BUNDLE_MAX_BYTES,
  OBSERVATION_LEDGER_ENTRY_LIMITS,
  OBSERVATION_LEDGER_MAX_CLOCK_BASES,
  OBSERVATION_LEDGER_MAX_EDGES,
  OBSERVATION_LEDGER_MAX_ENTRIES,
  OBSERVATION_LEDGER_MAX_ENTRIES_PER_ACQUISITION,
  OBSERVATION_LEDGER_MAX_PARENTS,
  OBSERVATION_LEDGER_MAX_PROJECTIONS_PER_SUBJECT,
  OBSERVATION_LEDGER_MAX_RAW_LINKS,
  OBSERVATION_LEDGER_MAX_SYMBOLS,
  OBSERVATION_LEDGER_PAGE_SIZE_MAX,
  OBSERVATION_LEDGER_PAGE_SIZE_MIN,
  ObservationLedgerContractError,
  type ObservationLedgerEntryV1,
  type ObservationLedgerFactsV1,
  observationLedgerSemanticProjection,
  paginateObservationLedger,
  replayRecordedObservationLedger,
  validateObservationLedgerBundle,
} from "../src/providers/observation-ledger.js";

const EXECUTION = "recorded-contract-execution";
const WALL_TIME = 1_800_000_000_000;
const nullClock = { clockBasisId: null, wallTimeMs: null, monotonicTimeUs: null } as const;

function digest(label: string): string {
  return canonicalHash("peas/observation-ledger-contract-test/v1", { label });
}

function add(
  entries: ObservationLedgerEntryV1[],
  facts: ObservationLedgerFactsV1,
  parents: readonly ObservationLedgerEntryV1[],
  clock: ClockStampV1,
): ObservationLedgerEntryV1 {
  const entry = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: parents.map((parent) => parent.entryId).sort(),
    clock,
    facts,
  });
  entries.push(entry);
  return entry;
}

function recordedLedger(acquisitionSuffix = ""): readonly ObservationLedgerEntryV1[] {
  const entries: ObservationLedgerEntryV1[] = [];
  const basis = createClockBasis({
    wallClock: "recorded-fixture",
    synchronization: "not-applicable",
    maximumErrorMs: null,
    monotonicClock: "none",
    monotonicSessionId: null,
  });
  const basisEntry = add(
    entries,
    { kind: "clock-basis.declared", clockBasis: basis },
    [],
    nullClock,
  );
  const clock = { clockBasisId: basis.clockBasisId, wallTimeMs: WALL_TIME, monotonicTimeUs: null };
  const acquisitionPreimage = {
    provider: "nvidia-ir",
    retrievalAttemptId: `recorded-attempt-1${acquisitionSuffix}`,
    sanitizedRequestIdentityHash: digest("request"),
    routeLabel: "nvidia-ir-recorded-rss",
  } as const;
  const acquisitionObservationId = deriveAcquisitionObservationId(acquisitionPreimage);
  const acquisition = add(
    entries,
    {
      kind: "acquisition.declared",
      acquisitionObservationId,
      ...acquisitionPreimage,
    },
    [basisEntry],
    clock,
  );
  const committed = add(
    entries,
    {
      kind: "artifact.committed",
      acquisitionObservationId,
      vaultObservationId: digest("vault-observation"),
      vaultObservationHash: digest("vault-observation-hash"),
      artifactDigest: digest("raw-rss"),
      sizeBytes: 321,
      acquisitionMode: "recorded",
      retrievedAtMs: WALL_TIME,
    },
    [basisEntry, acquisition],
    clock,
  );
  const verified = add(
    entries,
    {
      kind: "artifact.verified",
      acquisitionObservationId,
      vaultObservationId: digest("vault-observation"),
      artifactDigest: digest("raw-rss"),
      metadataSizeBytes: 321,
      consumedSizeBytes: 321,
    },
    [basisEntry, committed],
    clock,
  );
  const mapping = createIssuerMapping({
    issuerCik: "0001045810",
    symbols: ["NVDA"],
    selectedSymbol: "NVDA",
    mappingAuthority: "peas-static-fixture",
    mappingVersion: "v1",
    effectiveFromMs: null,
    effectiveToMs: null,
  });
  const rawArtifactLinks = [
    {
      role: "nvidia-ir.rss",
      acquisitionObservationId,
      vaultObservationId: digest("vault-observation"),
      vaultObservationHash: digest("vault-observation-hash"),
      artifactDigest: digest("raw-rss"),
      sizeBytes: 321,
    },
  ] as const;
  const loaderIdentity = "nvidia-ir-recorded-loader-v1";
  const normalizerIdentity = "nvidia-ir-normalizer-v1";
  const projectionDigest = deriveProjectionDigest({ title: "Synthetic NVIDIA release" });
  const projectionId = deriveProjectionId({
    loaderIdentity,
    normalizerIdentity,
    rawArtifactLinks,
    projectionDigest,
  });
  const provider = "nvidia-ir";
  const source = "peas-recorded:nvidia-newsroom-press-release-synthetic-v1";
  const providerRecordId = "nvidia-ir:synthetic-release";
  const providerRevisionId = digest("raw-rss");
  const sourceRecordIdentity = deriveSourceRecordIdentity({ provider, source, providerRecordId });
  const sourceVersionIdentity = deriveSourceVersionIdentity({
    sourceRecordIdentity,
    providerRevisionId,
    projectionDigest,
    evidenceBundleHash: null,
  });
  const revisionFamilyIdentity = deriveRevisionFamilyIdentity({
    provider,
    source,
    providerStableRecordFamily: providerRecordId,
  });
  const sourceObservationId = deriveSourceObservationId({
    sourceVersionIdentity,
    projectionId,
    rawArtifactLinks,
  });
  const normalized = add(
    entries,
    {
      kind: "normalization.emitted",
      projectionId,
      projectionDigest,
      sourceObservationId,
      sourceIdentity: {
        provider,
        source,
        sourceKind: "issuer_release",
        providerRecordId,
        providerRevisionId,
        sourceRecordIdentity,
        sourceVersionIdentity,
        revisionFamilyIdentity,
        supersedesSourceVersionIdentity: null,
      },
      publicationTime: {
        publishedAtMs: WALL_TIME - 1_000,
        timestampConfidence: "provider",
        originalTimestamp: "2027-01-15T12:00:00Z",
      },
      issuerMapping: mapping,
      subject: "earnings:0001045810:2026-Q1",
      fiscalPeriod: "2026-Q1",
      evidenceBundleHash: null,
      primaryArtifactHash: digest("raw-rss"),
      primaryArtifactKind: "raw-artifact",
      rawArtifactLinks,
      loaderIdentity,
      selectionHash: digest("selection"),
      loaderTranscriptHash: digest("loader-transcript"),
      normalizerIdentity,
      normalizerTranscriptHash: digest("normalizer-transcript"),
      eventDraftHash: digest("draft"),
    },
    [basisEntry, verified],
    clock,
  );
  add(
    entries,
    {
      kind: "capture.appended",
      sourceObservationId,
      sourceVersionIdentity,
      eventId: digest("event"),
      eventHash: digest("event-chain"),
      position: 1,
      receivedAtMs: WALL_TIME,
      logicalAtMs: WALL_TIME,
    },
    [basisEntry, normalized],
    clock,
  );
  return validateObservationLedgerBundle(entries);
}

function edgeBoundaryLedger(clockOneRoot: boolean): readonly ObservationLedgerEntryV1[] {
  const entries: ObservationLedgerEntryV1[] = [];
  const basis = createClockBasis({
    wallClock: "recorded-fixture",
    synchronization: "not-applicable",
    maximumErrorMs: null,
    monotonicClock: "none",
    monotonicSessionId: null,
  });
  const basisEntry = add(
    entries,
    { kind: "clock-basis.declared", clockBasis: basis },
    [],
    nullClock,
  );
  const regressionClock = {
    clockBasisId: basis.clockBasisId,
    wallTimeMs: WALL_TIME,
    monotonicTimeUs: null,
  };
  const roots = ["prior", "regressing"].map((label, index) => {
    const preimage = {
      provider: "synthetic",
      retrievalAttemptId: `edge-${label}`,
      sanitizedRequestIdentityHash: digest(`edge-${label}`),
      routeLabel: "edge-boundary",
    };
    return add(
      entries,
      {
        kind: "acquisition.declared",
        ...preimage,
        acquisitionObservationId: deriveAcquisitionObservationId(preimage),
      },
      clockOneRoot && index === 0 ? [basisEntry] : [],
      clockOneRoot && index === 0 ? regressionClock : nullClock,
    );
  });
  const prior = roots[0] as ObservationLedgerEntryV1;
  const regressing = roots[1] as ObservationLedgerEntryV1;
  for (let index = 0; index < 4_093; index += 1) {
    add(
      entries,
      {
        kind: "clock.regression",
        priorEntryId: prior.entryId,
        regressingEntryId: regressing.entryId,
        priorWallTimeMs: 10_000,
        currentWallTimeMs: index,
        monotonicOrderPreserved: true,
      },
      [basisEntry, prior, regressing],
      regressionClock,
    );
  }
  return entries;
}

test("ledger pins the exact entry preimage and derived identity", () => {
  const entry = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: "golden-execution",
    parentEntryIds: [],
    clock: nullClock,
    facts: {
      kind: "acquisition.declared",
      provider: "financial-modeling-prep",
      retrievalAttemptId: "attempt-001",
      sanitizedRequestIdentityHash: digest("golden-request"),
      routeLabel: "fmp-recorded-latest",
      acquisitionObservationId: deriveAcquisitionObservationId({
        provider: "financial-modeling-prep",
        retrievalAttemptId: "attempt-001",
        sanitizedRequestIdentityHash: digest("golden-request"),
        routeLabel: "fmp-recorded-latest",
      }),
    },
  });
  assert.equal(entry.entryHash, "1a8e12cdd21dfcb17a4d87dffed9a0345b24376e978d4b8d70b37974fbd306d5");
  assert.equal(entry.entryId, `ole1_${entry.entryHash}`);
});

test("ledger enforces parent transitions, clock basis, and issuer mapping", () => {
  const ledger = recordedLedger();
  assert.equal(ledger.length, 6);
  assert.equal(ledger[0]?.facts.kind, "clock-basis.declared");

  const committed = ledger.find((entry) => entry.facts.kind === "artifact.committed");
  assert.ok(committed);
  const hostile = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [ledger[0]?.entryId as string],
    clock: committed.clock,
    facts: committed.facts,
  });
  assert.throws(
    () => validateObservationLedgerBundle([ledger[0] as ObservationLedgerEntryV1, hostile]),
    (error) =>
      error instanceof ObservationLedgerContractError &&
      error.reasonCode === "observation.parent-transition-invalid",
  );

  assert.throws(
    () =>
      createClockBasis({
        wallClock: "system-utc",
        synchronization: "not-applicable",
        maximumErrorMs: null,
        monotonicClock: "none",
        monotonicSessionId: null,
      }),
    /observation\.clock-basis-invalid/u,
  );
  assert.throws(
    () =>
      createIssuerMapping({
        issuerCik: "0001045810",
        symbols: ["NVDA", "NVDA"],
        selectedSymbol: "NVDA",
        mappingAuthority: "fixture",
        mappingVersion: "v1",
        effectiveFromMs: null,
        effectiveToMs: null,
      }),
    /observation\.issuer-mapping-invalid/u,
  );
});

test("unknown facts and extra clock declarations fail closed", () => {
  assert.throws(
    () =>
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: "unknown-fact",
        parentEntryIds: [],
        clock: nullClock,
        facts: { kind: "future.unknown" } as never,
      }),
    /observation\.entry-invalid/u,
  );

  const ledger = recordedLedger();
  const primaryBasis = ledger[0] as ObservationLedgerEntryV1;
  const acquisition = ledger[1] as ObservationLedgerEntryV1;
  const committed = ledger[2] as ObservationLedgerEntryV1;
  const extraBasis = createClockBasis({
    wallClock: "recorded-fixture",
    synchronization: "not-applicable",
    maximumErrorMs: null,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: "extra-clock-session",
  });
  const extraBasisEntry = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [],
    clock: nullClock,
    facts: { kind: "clock-basis.declared", clockBasis: extraBasis },
  });
  const hostileCommit = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [...committed.parentEntryIds, extraBasisEntry.entryId].sort(),
    clock: committed.clock,
    facts: committed.facts,
  });
  assert.throws(
    () =>
      validateObservationLedgerBundle([primaryBasis, extraBasisEntry, acquisition, hostileCommit]),
    /observation\.clock-basis-invalid/u,
  );

  assert.ok(acquisition.facts.kind === "acquisition.declared");
  const nullClockWithBasisParent = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: acquisition.executionId,
    parentEntryIds: [primaryBasis.entryId],
    clock: nullClock,
    facts: acquisition.facts,
  });
  assert.throws(
    () => validateObservationLedgerBundle([primaryBasis, nullClockWithBasisParent]),
    /observation\.clock-basis-invalid/u,
  );
});

test("clock regression replay remaps both fact identities and causal parents", () => {
  const entries: ObservationLedgerEntryV1[] = [];
  for (const label of ["prior", "regressing"] as const) {
    const preimage = {
      provider: "synthetic",
      retrievalAttemptId: `regression-${label}`,
      sanitizedRequestIdentityHash: digest(`regression-${label}`),
      routeLabel: "regression-replay",
    };
    entries.push(
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: "regression-original",
        parentEntryIds: [],
        clock: nullClock,
        facts: {
          kind: "acquisition.declared",
          ...preimage,
          acquisitionObservationId: deriveAcquisitionObservationId(preimage),
        },
      }),
    );
  }
  const prior = entries[0] as ObservationLedgerEntryV1;
  const regressing = entries[1] as ObservationLedgerEntryV1;
  entries.push(
    createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: "regression-original",
      parentEntryIds: [prior.entryId, regressing.entryId].sort(),
      clock: nullClock,
      facts: {
        kind: "clock.regression",
        priorEntryId: prior.entryId,
        regressingEntryId: regressing.entryId,
        priorWallTimeMs: 2,
        currentWallTimeMs: 1,
        monotonicOrderPreserved: true,
      },
    }),
  );
  const replayed = replayRecordedObservationLedger(
    validateObservationLedgerBundle(entries),
    "regression-replay",
  );
  const replayedRegression = replayed[2] as ObservationLedgerEntryV1;
  assert.equal(replayedRegression.facts.kind, "clock.regression");
  if (replayedRegression.facts.kind !== "clock.regression") return;
  assert.deepEqual(
    [replayedRegression.facts.priorEntryId, replayedRegression.facts.regressingEntryId].sort(),
    [...replayedRegression.parentEntryIds].sort(),
  );
  assert.notEqual(replayedRegression.facts.priorEntryId, prior.entryId);
});

test("recorded replay preserves semantic identities and page-size reconstruction", () => {
  const original = recordedLedger();
  const replayed = replayRecordedObservationLedger(original, "replay-execution");
  assert.notEqual(original[1]?.entryId, replayed[1]?.entryId);
  const originalNormalization = original.find(
    (entry) => entry.facts.kind === "normalization.emitted",
  );
  const replayNormalization = replayed.find(
    (entry) => entry.facts.kind === "normalization.emitted",
  );
  assert.ok(originalNormalization?.facts.kind === "normalization.emitted");
  assert.ok(replayNormalization?.facts.kind === "normalization.emitted");
  assert.equal(
    originalNormalization.facts.sourceObservationId,
    replayNormalization.facts.sourceObservationId,
  );
  const replayProjection = observationLedgerSemanticProjection(replayed) as readonly JsonValue[];
  const commit = replayProjection.find(
    (value) => (value as { facts: { kind: string } }).facts.kind === "artifact.committed",
  ) as { facts: { acquisitionMode: string } };
  assert.equal(commit.facts.acquisitionMode, "replay");

  for (const pageSize of [1, 2, 5, 10_000]) {
    const reconstructed = paginateObservationLedger(replayed, pageSize).flat();
    assert.equal(
      canonicalJson(reconstructed as unknown as JsonValue),
      canonicalJson(replayed as unknown as JsonValue),
    );
  }
});

test("all displayed provider identities are recomputed and cannot be caller assertions", () => {
  const ledger = recordedLedger();
  const emitted = ledger.find((entry) => entry.facts.kind === "normalization.emitted");
  assert.ok(emitted?.facts.kind === "normalization.emitted");
  const emittedFacts = emitted.facts;
  assert.throws(
    () =>
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: EXECUTION,
        parentEntryIds: emitted.parentEntryIds,
        clock: emitted.clock,
        facts: { ...emittedFacts, sourceObservationId: `sob1_${digest("forged")}` },
      }),
    (error) =>
      error instanceof ObservationLedgerContractError &&
      error.reasonCode === "observation.derived-identity-mismatch",
  );
  assert.throws(
    () =>
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: EXECUTION,
        parentEntryIds: emitted.parentEntryIds,
        clock: emitted.clock,
        facts: {
          ...emittedFacts,
          sourceIdentity: {
            ...emittedFacts.sourceIdentity,
            sourceVersionIdentity: `svr1_${digest("forged-version")}`,
          },
        },
      }),
    /observation\.derived-identity-mismatch/u,
  );
});

test("ignored and quarantined normalization are terminal and failure cutoffs reject descendants", () => {
  const emittedLedger = recordedLedger();
  const prefix = emittedLedger.slice(0, 4);
  const basis = prefix[0];
  const acquisition = prefix[1];
  const committed = prefix[2];
  const verified = prefix[3];
  const emitted = emittedLedger[4];
  assert.ok(basis && acquisition && committed && verified && emitted);
  assert.ok(emitted.facts.kind === "normalization.emitted");
  const common = {
    rawArtifactLinks: emitted.facts.rawArtifactLinks,
    loaderIdentity: emitted.facts.loaderIdentity,
    selectionHash: emitted.facts.selectionHash,
    loaderTranscriptHash: emitted.facts.loaderTranscriptHash,
  } as const;
  for (const facts of [
    {
      kind: "normalization.ignored",
      ...common,
      normalizerIdentity: emitted.facts.normalizerIdentity,
      normalizerTranscriptHash: emitted.facts.normalizerTranscriptHash,
      reasonCode: "provider.non-earnings",
    },
    {
      kind: "normalization.quarantined",
      ...common,
      normalizerIdentity: null,
      normalizerTranscriptHash: null,
      reasonCode: "provider.malformed",
    },
  ] as const) {
    const terminal = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: EXECUTION,
      parentEntryIds: [basis.entryId, verified.entryId].sort(),
      clock: emitted.clock,
      facts,
    });
    assert.doesNotThrow(() => validateObservationLedgerBundle([...prefix, terminal]));
    const capture = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: EXECUTION,
      parentEntryIds: [basis.entryId, terminal.entryId].sort(),
      clock: emitted.clock,
      facts: {
        kind: "capture.appended",
        sourceObservationId: emitted.facts.sourceObservationId,
        sourceVersionIdentity: emitted.facts.sourceIdentity.sourceVersionIdentity,
        eventId: digest("forbidden-capture"),
        eventHash: digest("forbidden-capture-chain"),
        position: 1,
        receivedAtMs: WALL_TIME,
        logicalAtMs: WALL_TIME,
      },
    });
    assert.throws(
      () => validateObservationLedgerBundle([...prefix, terminal, capture]),
      /observation\.parent-transition-invalid/u,
    );
  }

  assert.ok(committed.facts.kind === "artifact.committed");
  const failed = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [basis.entryId, committed.entryId].sort(),
    clock: emitted.clock,
    facts: {
      kind: "failure.recorded",
      stage: "verified-read",
      failedAfter: "artifact.committed",
      acquisitionObservationId: committed.facts.acquisitionObservationId,
      sourceObservationId: null,
      reasonCode: "observation.artifact-read-failed",
      detailHash: null,
    },
  });
  const normalizationAfterFailure = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [basis.entryId, verified.entryId].sort(),
    clock: emitted.clock,
    facts: emitted.facts,
  });
  assert.throws(
    () => validateObservationLedgerBundle([...prefix, failed, normalizationAfterFailure]),
    /observation\.parent-transition-invalid/u,
  );
});

test("clock bases and trusted market selections enforce their closed cartesian contracts", () => {
  assert.doesNotThrow(() =>
    createClockBasis({
      wallClock: "system-utc",
      synchronization: "verified-bound",
      maximumErrorMs: 25,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: "session-1",
    }),
  );
  assert.doesNotThrow(() =>
    createClockBasis({
      wallClock: "system-utc",
      synchronization: "operator-asserted",
      maximumErrorMs: null,
      monotonicClock: "none",
      monotonicSessionId: null,
    }),
  );
  assert.throws(
    () =>
      createClockBasis({
        wallClock: "recorded-fixture",
        synchronization: "verified-bound",
        maximumErrorMs: 1,
        monotonicClock: "none",
        monotonicSessionId: null,
      }),
    /observation\.clock-basis-invalid/u,
  );

  const ledger = recordedLedger();
  const basis = ledger[0];
  const normalized = ledger[4];
  const capture = ledger[5];
  assert.ok(basis && normalized && capture);
  assert.ok(normalized.facts.kind === "normalization.emitted");
  assert.ok(capture.facts.kind === "capture.appended");
  assert.ok(capture.clock.clockBasisId !== null);
  const trustedObservationBasis = {
    basisKind: "capture",
    eventId: capture.facts.eventId,
    receivedAtMs: capture.facts.receivedAtMs,
    logicalAtMs: capture.facts.logicalAtMs,
    clockBasisId: capture.clock.clockBasisId,
  } as const;
  const selectionCommon = {
    subject: normalized.facts.subject,
    issuerMappingId: normalized.facts.issuerMapping.issuerMappingId,
    selectedSourceObservationId: normalized.facts.sourceObservationId,
    selectedSourceVersionIdentity: normalized.facts.sourceIdentity.sourceVersionIdentity,
    trustedObservationBasis,
  } as const;
  const marketReferenceJoinKey = deriveMarketReferenceJoinKey(selectionCommon);
  const selection = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [basis.entryId, capture.entryId].sort(),
    clock: capture.clock,
    facts: {
      kind: "selection.recorded",
      purpose: "market-reference-anchor",
      selectionBasis: "capture",
      ...selectionCommon,
      asOfMs: WALL_TIME,
      branchId: null,
      marketReferenceJoinKey,
    },
  });
  assert.doesNotThrow(() => validateObservationLedgerBundle([...ledger, selection]));
  assert.ok(selection.facts.kind === "selection.recorded");
  const selectionFacts = selection.facts;
  assert.throws(
    () =>
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: EXECUTION,
        parentEntryIds: selection.parentEntryIds,
        clock: selection.clock,
        facts: { ...selectionFacts, marketReferenceJoinKey: `mrj1_${digest("forged")}` },
      }),
    /observation\.derived-identity-mismatch/u,
  );
});

test("representative exact and one-over entry, parent, depth, and bundle bounds fail closed", () => {
  const exactRoute = "r".repeat(512);
  const exactPreimage = {
    provider: "synthetic",
    retrievalAttemptId: "attempt",
    sanitizedRequestIdentityHash: digest("bounded-request"),
    routeLabel: exactRoute,
  } as const;
  assert.doesNotThrow(() =>
    createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: "bounds",
      parentEntryIds: [],
      clock: nullClock,
      facts: {
        kind: "acquisition.declared",
        ...exactPreimage,
        acquisitionObservationId: deriveAcquisitionObservationId(exactPreimage),
      },
    }),
  );
  const overPreimage = { ...exactPreimage, routeLabel: "r".repeat(513) };
  assert.throws(
    () =>
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: "bounds",
        parentEntryIds: [],
        clock: nullClock,
        facts: {
          kind: "acquisition.declared",
          ...overPreimage,
          acquisitionObservationId: deriveAcquisitionObservationId(overPreimage),
        },
      }),
    /observation\.entry-invalid/u,
  );

  const parentIds = Array.from(
    { length: 33 },
    (_, index) => `ole1_${digest(`parent-${index}`)}`,
  ).sort();
  assert.doesNotThrow(() =>
    createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: "parent-boundary",
      parentEntryIds: parentIds.slice(0, 32),
      clock: nullClock,
      facts: {
        kind: "acquisition.declared",
        ...exactPreimage,
        acquisitionObservationId: deriveAcquisitionObservationId(exactPreimage),
      },
    }),
  );
  assert.throws(
    () =>
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: "parent-boundary",
        parentEntryIds: parentIds,
        clock: nullClock,
        facts: {
          kind: "acquisition.declared",
          ...exactPreimage,
          acquisitionObservationId: deriveAcquisitionObservationId(exactPreimage),
        },
      }),
    /observation\.entry-limit-exceeded/u,
  );

  const depthEntries: ObservationLedgerEntryV1[] = [];
  for (const label of ["depth-anchor", "depth-first"]) {
    const preimage = {
      provider: "synthetic",
      retrievalAttemptId: label,
      sanitizedRequestIdentityHash: digest(label),
      routeLabel: "depth-boundary",
    };
    depthEntries.push(
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: "depth-boundary",
        parentEntryIds: [],
        clock: nullClock,
        facts: {
          kind: "acquisition.declared",
          ...preimage,
          acquisitionObservationId: deriveAcquisitionObservationId(preimage),
        },
      }),
    );
  }
  const anchor = depthEntries[0] as ObservationLedgerEntryV1;
  for (let depth = 2; depth <= 17; depth += 1) {
    const prior = depthEntries.at(-1) as ObservationLedgerEntryV1;
    depthEntries.push(
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: "depth-boundary",
        parentEntryIds: [anchor.entryId, prior.entryId].sort(),
        clock: nullClock,
        facts: {
          kind: "clock.regression",
          priorEntryId: anchor.entryId,
          regressingEntryId: prior.entryId,
          priorWallTimeMs: 100,
          currentWallTimeMs: 99,
          monotonicOrderPreserved: true,
        },
      }),
    );
    if (depth === 16) {
      assert.doesNotThrow(() => validateObservationLedgerBundle(depthEntries));
    }
  }
  assert.throws(
    () => validateObservationLedgerBundle(depthEntries),
    /observation\.bundle-limit-exceeded/u,
  );

  const entries: ObservationLedgerEntryV1[] = [];
  for (let index = 0; index < 4_096; index += 1) {
    const preimage = {
      provider: "synthetic",
      retrievalAttemptId: `attempt-${index}`,
      sanitizedRequestIdentityHash: digest(`request-${index}`),
      routeLabel: "bundle-boundary",
    };
    entries.push(
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: "bundle-boundary",
        parentEntryIds: [],
        clock: nullClock,
        facts: {
          kind: "acquisition.declared",
          ...preimage,
          acquisitionObservationId: deriveAcquisitionObservationId(preimage),
        },
      }),
    );
  }
  assert.equal(validateObservationLedgerBundle(entries).length, 4_096);
  assert.throws(
    () => validateObservationLedgerBundle([...entries, entries[0] as ObservationLedgerEntryV1]),
    /observation\.bundle-limit-exceeded/u,
  );
});

test("every declared ledger resource dimension has an exact and one-over executable vector", () => {
  assert.deepEqual(OBSERVATION_LEDGER_ENTRY_LIMITS, {
    maxDepth: 8,
    maxNodes: 512,
    maxArrayLength: 32,
    maxObjectKeys: 64,
    maxStringBytes: 4_096,
    maxCanonicalBytes: 65_536,
  });
  assert.equal(OBSERVATION_LEDGER_MAX_RAW_LINKS, 16);
  assert.equal(OBSERVATION_LEDGER_MAX_SYMBOLS, 8);
  assert.equal(OBSERVATION_LEDGER_MAX_PARENTS, 32);
  assert.equal(OBSERVATION_LEDGER_MAX_ENTRIES_PER_ACQUISITION, 32);
  assert.equal(OBSERVATION_LEDGER_MAX_PROJECTIONS_PER_SUBJECT, 32);
  assert.equal(OBSERVATION_LEDGER_MAX_ENTRIES, 4_096);
  assert.equal(OBSERVATION_LEDGER_MAX_EDGES, 12_279);
  assert.equal(OBSERVATION_LEDGER_MAX_CLOCK_BASES, 32);
  assert.equal(OBSERVATION_LEDGER_BUNDLE_MAX_BYTES, 64 * 1024 * 1024);
  assert.equal(OBSERVATION_LEDGER_PAGE_SIZE_MIN, 1);
  assert.equal(OBSERVATION_LEDGER_PAGE_SIZE_MAX, 10_000);

  let exactDepth: JsonValue = null;
  for (let depth = 1; depth < OBSERVATION_LEDGER_ENTRY_LIMITS.maxDepth; depth += 1) {
    exactDepth = [exactDepth];
  }
  assert.equal(
    assertJsonWithinLimits(exactDepth, OBSERVATION_LEDGER_ENTRY_LIMITS).maxDepth,
    OBSERVATION_LEDGER_ENTRY_LIMITS.maxDepth,
  );
  assert.throws(
    () => assertJsonWithinLimits([exactDepth], OBSERVATION_LEDGER_ENTRY_LIMITS),
    /depth limit/u,
  );

  const exactNodes = [
    ...Array.from({ length: 31 }, () => Array.from({ length: 15 }, () => null)),
    Array.from({ length: 14 }, () => null),
  ];
  assert.equal(
    assertJsonWithinLimits(exactNodes, OBSERVATION_LEDGER_ENTRY_LIMITS).nodes,
    OBSERVATION_LEDGER_ENTRY_LIMITS.maxNodes,
  );
  assert.throws(
    () =>
      assertJsonWithinLimits(
        [...exactNodes.slice(0, 31), Array.from({ length: 15 }, () => null)],
        OBSERVATION_LEDGER_ENTRY_LIMITS,
      ),
    /node JSON limit/u,
  );
  assert.doesNotThrow(() =>
    assertJsonWithinLimits(
      Array.from({ length: 32 }, () => null),
      OBSERVATION_LEDGER_ENTRY_LIMITS,
    ),
  );
  assert.throws(
    () =>
      assertJsonWithinLimits(
        Array.from({ length: 33 }, () => null),
        OBSERVATION_LEDGER_ENTRY_LIMITS,
      ),
    /item array limit/u,
  );
  const exactKeys = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [`k${index.toString().padStart(2, "0")}`, null]),
  );
  assert.doesNotThrow(() => assertJsonWithinLimits(exactKeys, OBSERVATION_LEDGER_ENTRY_LIMITS));
  assert.throws(
    () => assertJsonWithinLimits({ ...exactKeys, overflow: null }, OBSERVATION_LEDGER_ENTRY_LIMITS),
    /key object limit/u,
  );
  assert.doesNotThrow(() =>
    assertJsonWithinLimits("x".repeat(4_096), OBSERVATION_LEDGER_ENTRY_LIMITS),
  );
  assert.throws(
    () => assertJsonWithinLimits("x".repeat(4_097), OBSERVATION_LEDGER_ENTRY_LIMITS),
    /byte string limit/u,
  );
  const exactBytesObject = Object.fromEntries(
    Array.from({ length: 15 }, (_, index) => [`p${index}`, "x".repeat(4_096)]),
  );
  exactBytesObject["tail"] = "";
  const remaining =
    OBSERVATION_LEDGER_ENTRY_LIMITS.maxCanonicalBytes -
    Buffer.byteLength(canonicalJson(exactBytesObject), "utf8");
  assert.ok(remaining > 0 && remaining <= 4_096);
  exactBytesObject["tail"] = "x".repeat(remaining);
  assert.equal(Buffer.byteLength(canonicalJson(exactBytesObject), "utf8"), 65_536);
  assert.doesNotThrow(() =>
    assertJsonWithinLimits(exactBytesObject, OBSERVATION_LEDGER_ENTRY_LIMITS),
  );
  assert.throws(
    () =>
      assertJsonWithinLimits(
        { ...exactBytesObject, tail: `${exactBytesObject["tail"]}x` },
        OBSERVATION_LEDGER_ENTRY_LIMITS,
      ),
    /canonical JSON limit/u,
  );

  const rawLinks = Array.from({ length: 17 }, (_, index) => ({
    role: `role.${index.toString().padStart(2, "0")}`,
    acquisitionObservationId: `aob1_${digest(`raw-acquisition-${index}`)}`,
    vaultObservationId: digest(`vault-${index}`),
    vaultObservationHash: digest(`vault-hash-${index}`),
    artifactDigest: digest(`artifact-${index}`),
    sizeBytes: 1,
  }));
  const ignoredFacts = {
    kind: "normalization.ignored" as const,
    rawArtifactLinks: rawLinks.slice(0, 16),
    loaderIdentity: "bounded-loader",
    selectionHash: digest("bounded-selection"),
    loaderTranscriptHash: digest("bounded-loader-transcript"),
    normalizerIdentity: "bounded-normalizer",
    normalizerTranscriptHash: digest("bounded-normalizer-transcript"),
    reasonCode: "synthetic.not-selected",
  };
  assert.doesNotThrow(() =>
    createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: "raw-link-boundary",
      parentEntryIds: [],
      clock: nullClock,
      facts: ignoredFacts,
    }),
  );
  assert.throws(
    () =>
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: "raw-link-boundary",
        parentEntryIds: [],
        clock: nullClock,
        facts: { ...ignoredFacts, rawArtifactLinks: rawLinks },
      }),
    /observation\.entry-(?:invalid|limit-exceeded)/u,
  );

  const symbols = Array.from({ length: 9 }, (_, index) => `S${index}`);
  assert.doesNotThrow(() =>
    createIssuerMapping({
      issuerCik: "0000000001",
      symbols: symbols.slice(0, 8),
      selectedSymbol: "S0",
      mappingAuthority: "bounds",
      mappingVersion: "v1",
      effectiveFromMs: null,
      effectiveToMs: null,
    }),
  );
  assert.throws(
    () =>
      createIssuerMapping({
        issuerCik: "0000000001",
        symbols,
        selectedSymbol: "S0",
        mappingAuthority: "bounds",
        mappingVersion: "v1",
        effectiveFromMs: null,
        effectiveToMs: null,
      }),
    /observation\.issuer-mapping-invalid/u,
  );

  const clockEntries = Array.from({ length: 33 }, (_, index) => {
    const clockBasis = createClockBasis({
      wallClock: "replayed-original",
      synchronization: "not-applicable",
      maximumErrorMs: null,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: `clock-${index}`,
    });
    return createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: "clock-count-boundary",
      parentEntryIds: [],
      clock: nullClock,
      facts: { kind: "clock-basis.declared", clockBasis },
    });
  });
  assert.equal(validateObservationLedgerBundle(clockEntries.slice(0, 32)).length, 32);
  assert.throws(
    () => validateObservationLedgerBundle(clockEntries),
    /observation\.bundle-limit-exceeded/u,
  );

  const acquisitionPreimage = {
    provider: "synthetic",
    retrievalAttemptId: "count-boundary",
    sanitizedRequestIdentityHash: digest("count-boundary"),
    routeLabel: "count-boundary",
  };
  const acquisitionObservationId = deriveAcquisitionObservationId(acquisitionPreimage);
  const acquisition = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: "acquisition-count-boundary",
    parentEntryIds: [],
    clock: nullClock,
    facts: {
      kind: "acquisition.declared",
      ...acquisitionPreimage,
      acquisitionObservationId,
    },
  });
  const acquisitionEntries = [acquisition];
  for (let index = 0; index < 32; index += 1) {
    acquisitionEntries.push(
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: "acquisition-count-boundary",
        parentEntryIds: [acquisition.entryId],
        clock: nullClock,
        facts: {
          kind: "failure.recorded",
          stage: "request",
          failedAfter: "acquisition.declared",
          acquisitionObservationId,
          sourceObservationId: null,
          reasonCode: `synthetic.failure.${index}`,
          detailHash: digest(`failure-${index}`),
        },
      }),
    );
  }
  assert.equal(
    validateObservationLedgerBundle(acquisitionEntries.slice(0, 32)).length,
    OBSERVATION_LEDGER_MAX_ENTRIES_PER_ACQUISITION,
  );
  assert.throws(
    () => validateObservationLedgerBundle(acquisitionEntries),
    /observation\.bundle-limit-exceeded/u,
  );

  const projectionLedgers = Array.from({ length: 33 }, (_, index) =>
    recordedLedger(`-projection-${index.toString().padStart(2, "0")}`),
  );
  const projectionEntries = [
    projectionLedgers[0]?.[0] as ObservationLedgerEntryV1,
    ...projectionLedgers.flatMap((ledger) => ledger.slice(1)),
  ];
  const entriesPerProjection = (projectionLedgers[0]?.length ?? 1) - 1;
  const exactProjectionEntries = projectionEntries.slice(
    0,
    1 + OBSERVATION_LEDGER_MAX_PROJECTIONS_PER_SUBJECT * entriesPerProjection,
  );
  assert.equal(
    validateObservationLedgerBundle(exactProjectionEntries).filter(
      (entry) => entry.facts.kind === "normalization.emitted",
    ).length,
    OBSERVATION_LEDGER_MAX_PROJECTIONS_PER_SUBJECT,
  );
  assert.throws(
    () => validateObservationLedgerBundle(projectionEntries),
    /observation\.bundle-limit-exceeded/u,
  );

  const exactEdgeLedger = edgeBoundaryLedger(false);
  assert.equal(exactEdgeLedger.length, OBSERVATION_LEDGER_MAX_ENTRIES);
  assert.equal(
    exactEdgeLedger.reduce((sum, entry) => sum + entry.parentEntryIds.length, 0),
    OBSERVATION_LEDGER_MAX_EDGES,
  );
  assert.equal(validateObservationLedgerBundle(exactEdgeLedger).length, exactEdgeLedger.length);
  const overEdgeLedger = edgeBoundaryLedger(true);
  assert.equal(overEdgeLedger.length, OBSERVATION_LEDGER_MAX_ENTRIES);
  assert.equal(
    overEdgeLedger.reduce((sum, entry) => sum + entry.parentEntryIds.length, 0),
    OBSERVATION_LEDGER_MAX_EDGES + 1,
  );
  assert.throws(
    () => validateObservationLedgerBundle(overEdgeLedger),
    /observation\.bundle-limit-exceeded/u,
  );

  const pageLedger = recordedLedger();
  assert.equal(paginateObservationLedger(pageLedger, 1).length, pageLedger.length);
  assert.equal(paginateObservationLedger(pageLedger, 10_000).length, 1);
  assert.throws(() => paginateObservationLedger(pageLedger, 0), /Page size/u);
  assert.throws(() => paginateObservationLedger(pageLedger, 10_001), /Page size/u);

  const oversizedBundle = Array.from({ length: 4_096 }, (_, index) => ({
    ...(pageLedger[0] as ObservationLedgerEntryV1),
    padding: `${index}:${"x".repeat(16_384)}`,
  })) as unknown as readonly ObservationLedgerEntryV1[];
  assert.ok(
    Buffer.byteLength(canonicalJson(oversizedBundle as unknown as JsonValue), "utf8") >
      64 * 1024 * 1024,
  );
  assert.throws(
    () => validateObservationLedgerBundle(oversizedBundle),
    /observation\.bundle-limit-exceeded/u,
  );
});
