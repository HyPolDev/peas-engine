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
  deriveClockBasisId,
  deriveIssuerMappingId,
  deriveMarketReferenceJoinKey,
  deriveProjectionDigest,
  deriveProjectionId,
  deriveRawEvidenceSetHash,
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

function rejectsLedger(reasonCode: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof ObservationLedgerContractError && error.reasonCode === reasonCode;
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

function edgeBoundaryLedger(overByOne: boolean): readonly ObservationLedgerEntryV1[] {
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
  const clock = {
    clockBasisId: basis.clockBasisId,
    wallTimeMs: WALL_TIME,
    monotonicTimeUs: null,
  };
  const cohorts: Array<{
    links: Array<{
      role: string;
      acquisitionObservationId: string;
      vaultObservationId: string;
      vaultObservationHash: string;
      artifactDigest: string;
      sizeBytes: number;
    }>;
    verified: ObservationLedgerEntryV1[];
  }> = [];
  for (let cohort = 0; cohort < 18; cohort += 1) {
    const links = [];
    const verifiedEntries: ObservationLedgerEntryV1[] = [];
    for (let member = 0; member < 16; member += 1) {
      const label = `edge-${cohort}-${member}`;
      const acquisitionPreimage = {
        provider: "synthetic",
        retrievalAttemptId: label,
        sanitizedRequestIdentityHash: digest(`${label}-request`),
        routeLabel: "edge-boundary",
      };
      const acquisitionObservationId = deriveAcquisitionObservationId(acquisitionPreimage);
      const acquisition = add(
        entries,
        {
          kind: "acquisition.declared",
          ...acquisitionPreimage,
          acquisitionObservationId,
        },
        [basisEntry],
        clock,
      );
      const vaultObservationId = digest(`${label}-vault-id`);
      const vaultObservationHash = digest(`${label}-vault-hash`);
      const artifactDigest = digest(`${label}-artifact`);
      const sizeBytes = member + 1;
      const committed = add(
        entries,
        {
          kind: "artifact.committed",
          acquisitionObservationId,
          vaultObservationId,
          vaultObservationHash,
          artifactDigest,
          sizeBytes,
          acquisitionMode: "recorded",
          retrievedAtMs: WALL_TIME,
        },
        [basisEntry, acquisition],
        clock,
      );
      verifiedEntries.push(
        add(
          entries,
          {
            kind: "artifact.verified",
            acquisitionObservationId,
            vaultObservationId,
            artifactDigest,
            metadataSizeBytes: sizeBytes,
            consumedSizeBytes: sizeBytes,
          },
          [basisEntry, committed],
          clock,
        ),
      );
      links.push({
        role: `edge.${member.toString().padStart(2, "0")}`,
        acquisitionObservationId,
        vaultObservationId,
        vaultObservationHash,
        artifactDigest,
        sizeBytes,
      });
    }
    cohorts.push({ links, verified: verifiedEntries });
  }
  for (let index = 0; index < 475; index += 1) {
    const cohort = cohorts[Math.floor(index / 29)] as (typeof cohorts)[number];
    add(
      entries,
      {
        kind: "normalization.ignored",
        rawArtifactLinks: cohort.links,
        loaderIdentity: "edge-loader-v1",
        selectionHash: digest(`edge-selection-${index}`),
        loaderTranscriptHash: digest(`edge-loader-transcript-${index}`),
        normalizerIdentity: "edge-normalizer-v1",
        normalizerTranscriptHash: digest(`edge-normalizer-transcript-${index}`),
        reasonCode: `edge.ignored.${index}`,
      },
      [basisEntry, ...cohort.verified],
      clock,
    );
  }
  const partialCohort = cohorts[17] as (typeof cohorts)[number];
  const partialLinkCount = overByOne ? 9 : 8;
  add(
    entries,
    {
      kind: "normalization.ignored",
      rawArtifactLinks: partialCohort.links.slice(0, partialLinkCount),
      loaderIdentity: "edge-loader-v1",
      selectionHash: digest("edge-selection-partial"),
      loaderTranscriptHash: digest("edge-loader-transcript-partial"),
      normalizerIdentity: "edge-normalizer-v1",
      normalizerTranscriptHash: digest("edge-normalizer-transcript-partial"),
      reasonCode: "edge.ignored.partial",
    },
    [basisEntry, ...partialCohort.verified.slice(0, partialLinkCount)],
    clock,
  );
  while (entries.length < OBSERVATION_LEDGER_MAX_ENTRIES) {
    const index = entries.length;
    const preimage = {
      provider: "synthetic",
      retrievalAttemptId: `edge-filler-${index}`,
      sanitizedRequestIdentityHash: digest(`edge-filler-${index}`),
      routeLabel: "edge-boundary-filler",
    };
    add(
      entries,
      {
        kind: "acquisition.declared",
        ...preimage,
        acquisitionObservationId: deriveAcquisitionObservationId(preimage),
      },
      [basisEntry],
      clock,
    );
  }
  return entries;
}

function rewriteNormalization(
  entry: ObservationLedgerEntryV1,
  options: Readonly<{
    projectionDigest?: string;
    provider?: string;
    source?: string;
    providerRecordId?: string;
    providerRevisionId?: string;
    evidenceBundleHash?: string | null;
    rawArtifactLinks?: readonly {
      role: string;
      acquisitionObservationId: string;
      vaultObservationId: string;
      vaultObservationHash: string;
      artifactDigest: string;
      sizeBytes: number;
    }[];
  }>,
): ObservationLedgerEntryV1 {
  assert.equal(entry.facts.kind, "normalization.emitted");
  if (entry.facts.kind !== "normalization.emitted") throw new Error("normalization required");
  const projectionDigest = options.projectionDigest ?? entry.facts.projectionDigest;
  const provider = options.provider ?? entry.facts.sourceIdentity.provider;
  const source = options.source ?? entry.facts.sourceIdentity.source;
  const providerRecordId = options.providerRecordId ?? entry.facts.sourceIdentity.providerRecordId;
  const providerRevisionId =
    options.providerRevisionId ?? entry.facts.sourceIdentity.providerRevisionId;
  const evidenceBundleHash =
    options.evidenceBundleHash === undefined
      ? entry.facts.evidenceBundleHash
      : options.evidenceBundleHash;
  const rawArtifactLinks = options.rawArtifactLinks ?? entry.facts.rawArtifactLinks;
  const sourceRecordIdentity = deriveSourceRecordIdentity({ provider, source, providerRecordId });
  const sourceIdentity = {
    ...entry.facts.sourceIdentity,
    provider,
    source,
    providerRecordId,
    providerRevisionId,
    sourceRecordIdentity,
    sourceVersionIdentity: deriveSourceVersionIdentity({
      sourceRecordIdentity,
      providerRevisionId,
      projectionDigest,
      evidenceBundleHash,
    }),
    revisionFamilyIdentity: deriveRevisionFamilyIdentity({
      provider,
      source,
      providerStableRecordFamily: providerRecordId,
    }),
  };
  const projectionId = deriveProjectionId({
    loaderIdentity: entry.facts.loaderIdentity,
    normalizerIdentity: entry.facts.normalizerIdentity,
    rawArtifactLinks,
    projectionDigest,
  });
  const sourceObservationId = deriveSourceObservationId({
    sourceVersionIdentity: sourceIdentity.sourceVersionIdentity,
    projectionId,
    rawArtifactLinks,
  });
  return createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: entry.executionId,
    parentEntryIds: entry.parentEntryIds,
    clock: entry.clock,
    facts: {
      ...entry.facts,
      projectionDigest,
      projectionId,
      sourceObservationId,
      sourceIdentity,
      evidenceBundleHash,
      rawArtifactLinks,
    },
  });
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

test("ledger rejects coercible identity fields and hostile containers before identity derivation", () => {
  const acquisition = {
    provider: "nvidia-ir",
    retrievalAttemptId: "attempt",
    sanitizedRequestIdentityHash: digest("coercion"),
    routeLabel: "rss",
  } as const;
  assert.doesNotThrow(() => deriveAcquisitionObservationId(acquisition));
  for (const hostile of [[digest("coercion")], 1, true, {}, null] as const) {
    assert.throws(
      () =>
        deriveAcquisitionObservationId({
          ...acquisition,
          sanitizedRequestIdentityHash: hostile,
        } as never),
      rejectsLedger("observation.entry-invalid"),
    );
  }
  assert.throws(
    () =>
      createIssuerMapping({
        issuerCik: 1_234_567_890 as never,
        symbols: [["NVDA"]] as never,
        selectedSymbol: "NVDA",
        mappingAuthority: "fixture",
        mappingVersion: "v1",
        effectiveFromMs: null,
        effectiveToMs: null,
      }),
    rejectsLedger("observation.issuer-mapping-invalid"),
  );

  const basisPreimage = {
    wallClock: "recorded-fixture",
    synchronization: "not-applicable",
    maximumErrorMs: null,
    monotonicClock: "none",
    monotonicSessionId: null,
  } as const;
  assert.doesNotThrow(() => deriveClockBasisId(basisPreimage));
  assert.doesNotThrow(() =>
    deriveIssuerMappingId({
      issuerCik: "0001045810",
      symbols: ["NVDA"],
      selectedSymbol: "NVDA",
      mappingAuthority: "fixture",
      mappingVersion: "v1",
      effectiveFromMs: null,
      effectiveToMs: null,
    }),
  );
  assert.doesNotThrow(() =>
    deriveRawEvidenceSetHash([
      {
        role: "rss",
        acquisitionObservationId: deriveAcquisitionObservationId(acquisition),
        vaultObservationId: digest("vault"),
        vaultObservationHash: digest("vault-hash"),
        artifactDigest: digest("artifact"),
        sizeBytes: 1,
      },
    ]),
  );

  const safe = recordedLedger();
  let proxyTouched = false;
  const proxyBundle = new Proxy(safe, {
    get() {
      proxyTouched = true;
      throw new Error("proxy trap must not run");
    },
  });
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  const sparse = new Array<ObservationLedgerEntryV1>(1);
  const customPrototype = Object.setPrototypeOf([...safe], { inherited() {} });
  const accessor = [] as ObservationLedgerEntryV1[];
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() {
      throw new Error("getter must not run");
    },
  });
  Object.defineProperty(accessor, "length", { value: 1 });
  for (const hostile of ["", null, {}, proxyBundle, cyclic, sparse, customPrototype, accessor]) {
    assert.throws(
      () => validateObservationLedgerBundle(hostile as never),
      rejectsLedger("observation.entry-invalid"),
    );
  }
  assert.equal(proxyTouched, false);
});

test("ledger clock error values and public basis constructors are runtime-closed", () => {
  const base = {
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorMs: 0,
    monotonicClock: "none",
    monotonicSessionId: null,
  } as const;
  assert.doesNotThrow(() => createClockBasis(base));
  for (const value of [null, -1, 1.5, "1", true, {}, []] as const) {
    assert.throws(
      () => createClockBasis({ ...base, maximumErrorMs: value } as never),
      rejectsLedger("observation.clock-basis-invalid"),
    );
  }
  for (const synchronization of ["operator-asserted", "unspecified", "not-applicable"] as const) {
    const wallClock = synchronization === "not-applicable" ? "recorded-fixture" : "system-utc";
    assert.doesNotThrow(() =>
      createClockBasis({ ...base, wallClock, synchronization, maximumErrorMs: null }),
    );
    for (const value of [0, -1, 1.5, "bad", true, {}, []] as const) {
      assert.throws(
        () =>
          createClockBasis({ ...base, wallClock, synchronization, maximumErrorMs: value } as never),
        rejectsLedger("observation.clock-basis-invalid"),
      );
    }
  }
});

test("clock regression closure is exact, deterministic, and replay-safe", () => {
  const entries: ObservationLedgerEntryV1[] = [];
  const basis = createClockBasis({
    wallClock: "recorded-fixture",
    synchronization: "not-applicable",
    maximumErrorMs: null,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: "regression-session",
  });
  const basisEntry = add(
    entries,
    { kind: "clock-basis.declared", clockBasis: basis },
    [],
    nullClock,
  );
  for (const [index, label] of ["prior", "regressing"].entries()) {
    const preimage = {
      provider: "synthetic",
      retrievalAttemptId: `regression-${label}`,
      sanitizedRequestIdentityHash: digest(`regression-${label}`),
      routeLabel: "regression-replay",
    };
    add(
      entries,
      {
        kind: "acquisition.declared",
        ...preimage,
        acquisitionObservationId: deriveAcquisitionObservationId(preimage),
      },
      [basisEntry],
      {
        clockBasisId: basis.clockBasisId,
        wallTimeMs: index === 0 ? 200 : 100,
        monotonicTimeUs: index + 1,
      },
    );
  }
  const prior = entries[1] as ObservationLedgerEntryV1;
  const regressing = entries[2] as ObservationLedgerEntryV1;
  const witnessFacts = {
    kind: "clock.regression",
    priorEntryId: prior.entryId,
    regressingEntryId: regressing.entryId,
    priorWallTimeMs: 200,
    currentWallTimeMs: 100,
    monotonicOrderPreserved: true,
  } as const;
  const witness = add(entries, witnessFacts, [basisEntry, prior, regressing], regressing.clock);
  assert.equal(validateObservationLedgerBundle(entries).length, 4);

  assert.throws(
    () =>
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: EXECUTION,
        parentEntryIds: witness.parentEntryIds,
        clock: witness.clock,
        facts: { ...witnessFacts, monotonicOrderPreserved: "true" } as never,
      }),
    /observation\.entry-invalid/u,
  );
  assert.throws(
    () => validateObservationLedgerBundle(entries.slice(0, 3)),
    /observation\.clock-regression-invalid/u,
  );

  const duplicate = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: witness.parentEntryIds,
    clock: witness.clock,
    facts: witnessFacts,
  });
  assert.throws(
    () => validateObservationLedgerBundle([...entries, duplicate]),
    /observation\.(?:clock-regression|parent-transition)-invalid/u,
  );
  assert.throws(
    () => validateObservationLedgerBundle([basisEntry, regressing, prior, witness]),
    /observation\.(?:clock-regression|parent-transition|clock-basis)-invalid/u,
  );

  for (const facts of [
    { ...witnessFacts, priorWallTimeMs: 201 },
    { ...witnessFacts, currentWallTimeMs: 99 },
    { ...witnessFacts, monotonicOrderPreserved: false },
  ] as const) {
    const hostile = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: EXECUTION,
      parentEntryIds: witness.parentEntryIds,
      clock: witness.clock,
      facts,
    });
    assert.throws(
      () => validateObservationLedgerBundle([...entries.slice(0, 3), hostile]),
      /observation\.clock-regression-invalid/u,
    );
  }

  const nullParents = ["null-prior", "null-regressing"].map((label) => {
    const preimage = {
      provider: "synthetic",
      retrievalAttemptId: label,
      sanitizedRequestIdentityHash: digest(label),
      routeLabel: "null-regression",
    };
    return createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: EXECUTION,
      parentEntryIds: [],
      clock: nullClock,
      facts: {
        kind: "acquisition.declared",
        ...preimage,
        acquisitionObservationId: deriveAcquisitionObservationId(preimage),
      },
    });
  });
  const nullWitness = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: nullParents.map((entry) => entry.entryId).sort(),
    clock: nullClock,
    facts: {
      kind: "clock.regression",
      priorEntryId: (nullParents[0] as ObservationLedgerEntryV1).entryId,
      regressingEntryId: (nullParents[1] as ObservationLedgerEntryV1).entryId,
      priorWallTimeMs: 2,
      currentWallTimeMs: 1,
      monotonicOrderPreserved: false,
    },
  });
  assert.throws(
    () => validateObservationLedgerBundle([...nullParents, nullWitness]),
    /observation\.clock-regression-invalid/u,
  );

  const otherBasis = createClockBasis({
    wallClock: "replayed-original",
    synchronization: "not-applicable",
    maximumErrorMs: null,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: "other-regression-session",
  });
  const otherBasisEntry = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [],
    clock: nullClock,
    facts: { kind: "clock-basis.declared", clockBasis: otherBasis },
  });
  const crossBasisRegressing = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [otherBasisEntry.entryId],
    clock: { clockBasisId: otherBasis.clockBasisId, wallTimeMs: 50, monotonicTimeUs: 2 },
    facts: regressing.facts,
  });
  const crossBasisWitness = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [otherBasisEntry.entryId, prior.entryId, crossBasisRegressing.entryId].sort(),
    clock: crossBasisRegressing.clock,
    facts: {
      ...witnessFacts,
      regressingEntryId: crossBasisRegressing.entryId,
      currentWallTimeMs: 50,
    },
  });
  assert.throws(
    () =>
      validateObservationLedgerBundle([
        basisEntry,
        otherBasisEntry,
        prior,
        crossBasisRegressing,
        crossBasisWitness,
      ]),
    /observation\.clock-regression-invalid/u,
  );

  const monotonicRegression = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [basisEntry.entryId],
    clock: { clockBasisId: basis.clockBasisId, wallTimeMs: 50, monotonicTimeUs: 0 },
    facts: regressing.facts,
  });
  assert.throws(
    () => validateObservationLedgerBundle([basisEntry, prior, monotonicRegression]),
    /observation\.clock-basis-invalid/u,
  );

  const replayed = replayRecordedObservationLedger(entries, "regression-replay");
  const replayedRegression = replayed[3] as ObservationLedgerEntryV1;
  assert.equal(replayedRegression.facts.kind, "clock.regression");
  if (replayedRegression.facts.kind !== "clock.regression") return;
  assert.deepEqual(
    [replayedRegression.facts.priorEntryId, replayedRegression.facts.regressingEntryId].sort(),
    replayedRegression.parentEntryIds.filter((parent) => parent !== replayed[0]?.entryId).sort(),
  );
  assert.notEqual(replayedRegression.facts.priorEntryId, prior.entryId);
  assert.deepEqual(replayedRegression.clock, witness.clock);
  assert.equal(replayedRegression.facts.priorWallTimeMs, witnessFacts.priorWallTimeMs);
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

test("raw links bind the exact committed vault observation evidence", () => {
  const ledger = recordedLedger();
  const committed = ledger[2] as ObservationLedgerEntryV1;
  const normalization = ledger[4] as ObservationLedgerEntryV1;
  assert.equal(committed.facts.kind, "artifact.committed");
  assert.equal(normalization.facts.kind, "normalization.emitted");
  if (
    committed.facts.kind !== "artifact.committed" ||
    normalization.facts.kind !== "normalization.emitted"
  ) {
    return;
  }
  const link = normalization.facts.rawArtifactLinks[0];
  assert.ok(link);
  assert.deepEqual(
    [link.vaultObservationId, link.vaultObservationHash, link.artifactDigest, link.sizeBytes],
    [
      committed.facts.vaultObservationId,
      committed.facts.vaultObservationHash,
      committed.facts.artifactDigest,
      committed.facts.sizeBytes,
    ],
  );

  const substituted = rewriteNormalization(normalization, {
    rawArtifactLinks: [
      { ...link, vaultObservationHash: digest("substituted-vault-observation-hash") },
    ],
  });
  assert.throws(
    () => validateObservationLedgerBundle([...ledger.slice(0, 4), substituted]),
    /observation\.parent-transition-invalid/u,
  );

  const redelivery = recordedLedger("-vault-conflict");
  const secondAcquisition = redelivery[1] as ObservationLedgerEntryV1;
  const secondCommit = redelivery[2] as ObservationLedgerEntryV1;
  assert.equal(secondCommit.facts.kind, "artifact.committed");
  if (secondCommit.facts.kind !== "artifact.committed") return;
  for (const facts of [
    { ...secondCommit.facts, vaultObservationHash: digest("conflicting-vault-hash") },
    { ...secondCommit.facts, artifactDigest: digest("conflicting-vault-digest") },
    { ...secondCommit.facts, sizeBytes: secondCommit.facts.sizeBytes + 1 },
  ]) {
    const hostile = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: secondCommit.executionId,
      parentEntryIds: secondCommit.parentEntryIds,
      clock: secondCommit.clock,
      facts,
    });
    assert.throws(
      () =>
        validateObservationLedgerBundle([
          ledger[0] as ObservationLedgerEntryV1,
          ledger[1] as ObservationLedgerEntryV1,
          committed,
          secondAcquisition,
          hostile,
        ]),
      /observation\.parent-transition-invalid/u,
    );
  }
});

test("provider revision conflicts reject before capture independent of order", () => {
  const first = recordedLedger("-revision-first");
  const second = recordedLedger("-revision-second");
  const basis = first[0] as ObservationLedgerEntryV1;
  const firstPrefix = first.slice(1, 5) as readonly ObservationLedgerEntryV1[];
  const secondPrefix = second.slice(1, 5) as readonly ObservationLedgerEntryV1[];
  const secondNormalization = secondPrefix[3] as ObservationLedgerEntryV1;
  assert.equal(secondNormalization.facts.kind, "normalization.emitted");

  assert.equal(validateObservationLedgerBundle([basis, ...firstPrefix, ...secondPrefix]).length, 9);

  for (const conflicting of [
    rewriteNormalization(secondNormalization, {
      projectionDigest: deriveProjectionDigest({ title: "Conflicting retained release" }),
    }),
    rewriteNormalization(secondNormalization, { evidenceBundleHash: digest("changed-bundle") }),
  ]) {
    for (const values of [
      [basis, ...firstPrefix, ...secondPrefix.slice(0, 3), conflicting],
      [basis, ...secondPrefix.slice(0, 3), conflicting, ...firstPrefix],
    ]) {
      assert.throws(
        () => validateObservationLedgerBundle(values),
        (error) =>
          error instanceof ObservationLedgerContractError &&
          error.reasonCode === "observation.revision-conflict",
      );
    }
  }

  const newRevision = rewriteNormalization(secondNormalization, {
    providerRevisionId: digest("genuine-new-provider-revision"),
    projectionDigest: deriveProjectionDigest({ title: "Genuine semantic correction" }),
  });
  assert.equal(
    validateObservationLedgerBundle([
      basis,
      ...firstPrefix,
      ...secondPrefix.slice(0, 3),
      newRevision,
    ]).length,
    9,
  );

  const otherProvider = rewriteNormalization(secondNormalization, {
    provider: "independent-synthetic-provider",
  });
  assert.equal(
    validateObservationLedgerBundle([
      basis,
      ...firstPrefix,
      ...secondPrefix.slice(0, 3),
      otherProvider,
    ]).length,
    9,
  );
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
  const depthBasis = createClockBasis({
    wallClock: "recorded-fixture",
    synchronization: "not-applicable",
    maximumErrorMs: null,
    monotonicClock: "none",
    monotonicSessionId: null,
  });
  const depthBasisEntry = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: "depth-boundary",
    parentEntryIds: [],
    clock: nullClock,
    facts: { kind: "clock-basis.declared", clockBasis: depthBasis },
  });
  depthEntries.push(depthBasisEntry);
  const depthClock = (wallTimeMs: number): ClockStampV1 => ({
    clockBasisId: depthBasis.clockBasisId,
    wallTimeMs,
    monotonicTimeUs: null,
  });
  for (const [index, label] of ["depth-prior", "depth-regressing"].entries()) {
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
        parentEntryIds: [depthBasisEntry.entryId],
        clock: depthClock(1_000 - index),
        facts: {
          kind: "acquisition.declared",
          ...preimage,
          acquisitionObservationId: deriveAcquisitionObservationId(preimage),
        },
      }),
    );
  }
  let prior = depthEntries[1] as ObservationLedgerEntryV1;
  let regressing = depthEntries[2] as ObservationLedgerEntryV1;
  for (let depth = 3; depth <= 17; depth += 1) {
    const witness = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: "depth-boundary",
      parentEntryIds: [depthBasisEntry.entryId, prior.entryId, regressing.entryId].sort(),
      clock: regressing.clock,
      facts: {
        kind: "clock.regression",
        priorEntryId: prior.entryId,
        regressingEntryId: regressing.entryId,
        priorWallTimeMs: prior.clock.wallTimeMs as number,
        currentWallTimeMs: regressing.clock.wallTimeMs as number,
        monotonicOrderPreserved: false,
      },
    });
    depthEntries.push(witness);
    if (depth === 16) assert.doesNotThrow(() => validateObservationLedgerBundle(depthEntries));
    if (depth === 17) break;
    const label = `depth-regressing-${depth}`;
    const preimage = {
      provider: "synthetic",
      retrievalAttemptId: label,
      sanitizedRequestIdentityHash: digest(label),
      routeLabel: "depth-boundary",
    };
    const next = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: "depth-boundary",
      parentEntryIds: [depthBasisEntry.entryId],
      clock: depthClock(998 - depth),
      facts: {
        kind: "acquisition.declared",
        ...preimage,
        acquisitionObservationId: deriveAcquisitionObservationId(preimage),
      },
    });
    depthEntries.push(next);
    prior = witness;
    regressing = next;
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
  assert.throws(() => paginateObservationLedger(pageLedger, 0), /observation\.page-size-invalid/u);
  assert.throws(
    () => paginateObservationLedger(pageLedger, 10_001),
    /observation\.page-size-invalid/u,
  );

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

test("ledger byte, timestamp, cross-execution, and clock-parent boundary probes reach the public validator", () => {
  const ledger = recordedLedger();
  const normalized = ledger[4] as ObservationLedgerEntryV1;
  assert.ok(normalized.facts.kind === "normalization.emitted");
  const normalizedFacts = normalized.facts;
  const exactPublicationTime: Extract<
    ObservationLedgerFactsV1,
    { kind: "normalization.emitted" }
  >["publicationTime"] = {
    publishedAtMs: WALL_TIME - 1_000,
    timestampConfidence: "provider",
    originalTimestamp: "t".repeat(256),
  };
  const exactTimestamp = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: normalized.parentEntryIds,
    clock: normalized.clock,
    facts: {
      ...normalizedFacts,
      publicationTime: exactPublicationTime,
    },
  });
  assert.equal(
    (exactTimestamp.facts as Extract<ObservationLedgerFactsV1, { kind: "normalization.emitted" }>)
      .publicationTime.originalTimestamp?.length,
    256,
  );
  assert.throws(
    () =>
      createObservationLedgerEntry({
        schemaVersion: 1,
        executionId: EXECUTION,
        parentEntryIds: normalized.parentEntryIds,
        clock: normalized.clock,
        facts: {
          ...normalizedFacts,
          publicationTime: {
            ...exactPublicationTime,
            originalTimestamp: "t".repeat(257),
          },
        },
      }),
    rejectsLedger("observation.entry-invalid"),
  );

  const basis = ledger[0] as ObservationLedgerEntryV1;
  const acquisition = ledger[1] as ObservationLedgerEntryV1;
  const noBasisParent = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [],
    clock: acquisition.clock,
    facts: acquisition.facts,
  });
  assert.throws(
    () => validateObservationLedgerBundle([basis, noBasisParent]),
    rejectsLedger("observation.clock-basis-invalid"),
  );
  const crossExecution = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: "other-execution",
    parentEntryIds: [basis.entryId],
    clock: acquisition.clock,
    facts: acquisition.facts,
  });
  assert.throws(
    () => validateObservationLedgerBundle([...ledger, crossExecution]),
    rejectsLedger("observation.parent-transition-invalid"),
  );

  const limit = OBSERVATION_LEDGER_BUNDLE_MAX_BYTES;
  const boundary = Array.from({ length: OBSERVATION_LEDGER_MAX_ENTRIES }, () => ({
    a: "a".repeat(4_000),
    b: "b".repeat(4_000),
    c: "c".repeat(4_000),
    d: "d".repeat(4_000),
    e: "",
  }));
  let remaining =
    limit - Buffer.byteLength(canonicalJson(boundary as unknown as JsonValue), "utf8");
  for (const member of boundary) {
    if (remaining <= 0) break;
    const fill = Math.min(4_000, remaining);
    member.e = "e".repeat(fill);
    remaining -= fill;
  }
  assert.equal(Buffer.byteLength(canonicalJson(boundary as unknown as JsonValue), "utf8"), limit);
  assert.throws(
    () => validateObservationLedgerBundle(boundary as never),
    rejectsLedger("observation.entry-invalid"),
  );
  const oneOver = boundary.map((member, index) =>
    index === 0 ? { ...member, e: `${member.e}x` } : member,
  );
  assert.equal(
    Buffer.byteLength(canonicalJson(oneOver as unknown as JsonValue), "utf8"),
    limit + 1,
  );
  assert.throws(
    () => validateObservationLedgerBundle(oneOver as never),
    rejectsLedger("observation.bundle-limit-exceeded"),
  );
});

test("ledger request and redelivery fact transitions have executable positive controls", () => {
  const ledger = recordedLedger();
  const basis = ledger[0] as ObservationLedgerEntryV1;
  const acquisition = ledger[1] as ObservationLedgerEntryV1;
  assert.ok(acquisition.facts.kind === "acquisition.declared");
  const started = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [basis.entryId, acquisition.entryId].sort(),
    clock: acquisition.clock,
    facts: {
      kind: "request.started",
      acquisitionObservationId: acquisition.facts.acquisitionObservationId,
    },
  });
  const succeeded = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [basis.entryId, started.entryId].sort(),
    clock: acquisition.clock,
    facts: {
      kind: "request.succeeded",
      acquisitionObservationId: acquisition.facts.acquisitionObservationId,
      safeResponseMetadataHash: digest("response-metadata"),
    },
  });
  assert.doesNotThrow(() =>
    validateObservationLedgerBundle([basis, acquisition, started, succeeded]),
  );

  const normalized = ledger[4] as ObservationLedgerEntryV1;
  const capture = ledger[5] as ObservationLedgerEntryV1;
  assert.ok(normalized.facts.kind === "normalization.emitted");
  assert.ok(capture.facts.kind === "capture.appended");
  const redelivered = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId: EXECUTION,
    parentEntryIds: [basis.entryId, normalized.entryId].sort(),
    clock: capture.clock,
    facts: { ...capture.facts, kind: "capture.redelivered", position: capture.facts.position + 1 },
  });
  assert.doesNotThrow(() => validateObservationLedgerBundle([...ledger, redelivered]));
});
