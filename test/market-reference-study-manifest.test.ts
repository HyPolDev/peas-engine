import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "../src/core/hash.js";
import {
  BOUND_ENFORCEMENT_REGISTRY,
  CANONICAL_BOUND_IDS,
} from "../src/providers/market-reference/contracts.js";
import {
  ACCEPTED_CONTRACT_AUTHORITY_REGISTRY_ID,
  HOLM_SLOT_IDS,
  STUDY_REASON_CATALOG,
  STUDY_CONTRACT_AUTHORITY_IDS,
  STUDY_DATASET_FREEZE_POLICY_VERSION,
  STUDY_BOUND_IDS,
  StudyContractError,
  bootstrapPoolIndex,
  capacityHamilton,
  classifyProspectiveControl,
  deriveBootstrapSeed,
  deriveBootstrapWord,
  deriveRankSeedHex,
  deriveReleaseClusterKey,
  deriveStudyDatasetFreezeId,
  deriveStudyClusterId,
  deriveStudyManifestId,
  deriveStudyFrameSnapshotId,
  deriveStudyClusterCandidateId,
  deriveStudyRankDigest,
  evaluateClusterReadinessMetrics,
  evaluateStudyBound,
  evaluateHolm24,
  evaluateReadinessGates,
  exactMedian,
  laneStratifiedBootstrap,
  rational,
  type7Quantile,
  validateHolmFamilySlots,
  validateStudyDatasetFreeze,
  validateStudyReason,
  validateStudyClusterCandidate,
  validateStudyFreezeManifest,
  validateStudyFrameSnapshot,
  type StudyCandidateFrameEntryV1,
  type StudyFrameSnapshotV1,
  type StudyFreezeManifestV1,
  type StudyDatasetValidationEvidenceV1,
  type StudyBoundIdV1,
} from "../src/study/market-reference/index.js";

const OBSERVATION = "aob1_0000000000000000000000000000000000000000000000000000000000000000";
const ISSUER_MAPPING_ID = "imap1_b5fb4ba66e0c0db04d272e66bcfd071e46fe343be06487bb76c892834958441e";
const INSTRUMENT_ID = "min1_e9356093916724ade802248d445ca057c3667b74cb09a06fe34c01767f807fc3";
const RETIRED_COLLISION = "scc1_3dedd976378f6b5a8fb86477f3518ed9c62068ac4a697dd2eaba2c2c8b233f0b";

type Vector = Readonly<{
  name: string;
  releaseKind: "quarterly" | "annual";
  clusterBasis:
    | Readonly<{ kind: "fiscal-period"; plannedFiscalPeriod: string }>
    | Readonly<{ kind: "cross-source"; crossSourceReleaseKeyHash: string }>
    | Readonly<{
        kind: "native-date";
        plannedReleaseDate: string;
        nativeScheduleIdHash: string;
      }>;
  plannedFiscalPeriod: string | null;
  nativeScheduleIdHash: string;
  crossSourceReleaseKeyHash: string | null;
  releaseClusterKey: string;
  clusterCandidateId: string;
}>;

const VECTORS: readonly Vector[] = [
  {
    name: "SCC-Q-X-A",
    releaseKind: "quarterly",
    clusterBasis: { kind: "cross-source", crossSourceReleaseKeyHash: "3".repeat(64) },
    plannedFiscalPeriod: null,
    nativeScheduleIdHash: "8".repeat(64),
    crossSourceReleaseKeyHash: "3".repeat(64),
    releaseClusterKey: "760e1a706fd2a029bf6c2be35713f6055a58ccb03b38346a37b6a17e1c160dad",
    clusterCandidateId: "scc1_23a3ce22af13c273284dcc55f2a2f98e71d8ee33039d896b34789e26fc51a29c",
  },
  {
    name: "SCC-A-X-A",
    releaseKind: "annual",
    clusterBasis: { kind: "cross-source", crossSourceReleaseKeyHash: "3".repeat(64) },
    plannedFiscalPeriod: null,
    nativeScheduleIdHash: "9".repeat(64),
    crossSourceReleaseKeyHash: "3".repeat(64),
    releaseClusterKey: "f187d8d01fdeb210ec1f201f155dfdfa17edf9e26f0cf2018788559170b05acc",
    clusterCandidateId: "scc1_9d065ec03ea039dbfe4a979a91903706f93fe8d8d58a177365fa5d702139e898",
  },
  {
    name: "SCC-Q-X-B",
    releaseKind: "quarterly",
    clusterBasis: { kind: "cross-source", crossSourceReleaseKeyHash: "4".repeat(64) },
    plannedFiscalPeriod: null,
    nativeScheduleIdHash: "a".repeat(64),
    crossSourceReleaseKeyHash: "4".repeat(64),
    releaseClusterKey: "f8d55d7faab94cb219a6be507859ffdb38f5c4ba47221a3500a69b59f92243f6",
    clusterCandidateId: "scc1_e1e29e6b3a530fcaf740d74460e19c09b7f617b14d0dda169555a9e6a32ee602",
  },
  {
    name: "SCC-Q-N-A",
    releaseKind: "quarterly",
    clusterBasis: {
      kind: "native-date",
      plannedReleaseDate: "2027-02-03",
      nativeScheduleIdHash: "5".repeat(64),
    },
    plannedFiscalPeriod: null,
    nativeScheduleIdHash: "5".repeat(64),
    crossSourceReleaseKeyHash: null,
    releaseClusterKey: "0b6220f62e090fcf1dbab51c9a6f1e67cea26a6b24536a940839e41254501a0d",
    clusterCandidateId: "scc1_f1978744380df6d88f5c04b45d28dfe5744f00d4bec9dfa4f3212e4932aa04d8",
  },
  {
    name: "SCC-Q-N-B",
    releaseKind: "quarterly",
    clusterBasis: {
      kind: "native-date",
      plannedReleaseDate: "2027-02-03",
      nativeScheduleIdHash: "6".repeat(64),
    },
    plannedFiscalPeriod: null,
    nativeScheduleIdHash: "6".repeat(64),
    crossSourceReleaseKeyHash: null,
    releaseClusterKey: "e821fcc567119d5a7a4beec2f592594c29489e1ab5210cfc36492484d9d1a866",
    clusterCandidateId: "scc1_ff342e0d714128058f7b0c60bd3961d41b91cc90992e3dd5596be9ec7fe70c8e",
  },
  {
    name: "SCC-Q-F-A",
    releaseKind: "quarterly",
    clusterBasis: { kind: "fiscal-period", plannedFiscalPeriod: "2027-Q1" },
    plannedFiscalPeriod: "2027-Q1",
    nativeScheduleIdHash: "b".repeat(64),
    crossSourceReleaseKeyHash: null,
    releaseClusterKey: "ad7cb2c98df8c571669552d26826b4d99a99daf48917be02e3bdbd3e4680e7ea",
    clusterCandidateId: "scc1_44c9c8a19d0ceb40a2e0e27ac574a4c9a9559a040dc72dad625ef16cdecddc38",
  },
  {
    name: "SCC-Q-N-C",
    releaseKind: "quarterly",
    clusterBasis: {
      kind: "native-date",
      plannedReleaseDate: "2027-02-03",
      nativeScheduleIdHash: "7".repeat(64),
    },
    plannedFiscalPeriod: null,
    nativeScheduleIdHash: "7".repeat(64),
    crossSourceReleaseKeyHash: null,
    releaseClusterKey: "7dac1d974db6c72a5a0c59ab3e651b5c9a1bedf3b56fd217f7125545c88d0374",
    clusterCandidateId: "scc1_aff6232f2aac45822feabd9336e4729804959b04d99ad9d1588231a4a4229a87",
  },
];

function candidate(vector: Vector): StudyCandidateFrameEntryV1 {
  const liquiditySessions = Array.from({ length: 20 }, (_, index) => ({
    sessionId: `S${index}`,
    sessionCloseNs: `${1_700_000_000_000_000_000n + BigInt(index)}`,
    closeMarketResultId: `mmr1_${index.toString(16).padStart(64, "0")}`,
    closeResultStatus: "missing",
    closePrice: null,
    regularSessionVolume: null,
    volumeFactId: null,
    volumeSourceObservationId: null,
    volumeAuthorityVersion: null,
    dollarVolume: null,
    status: "missing",
    missingKind: "close-missing",
  }));
  return {
    scheduleSourceObservationId: OBSERVATION,
    issuerMappingId: ISSUER_MAPPING_ID,
    instrumentId: INSTRUMENT_ID,
    releaseKind: vector.releaseKind,
    releaseClusterKey: vector.releaseClusterKey,
    plannedFiscalPeriod: vector.plannedFiscalPeriod,
    plannedReleaseDate: "2027-02-03",
    plannedSession: "pre-market",
    clusterBasis: vector.clusterBasis,
    scheduleSourceEvidence: [
      {
        sourceFamily: "issuer-ir-calendar",
        precedenceOrdinal: 1,
        scheduleSourceObservationId: OBSERVATION,
        sourceRevisionId: null,
        nativeScheduleIdHash: vector.nativeScheduleIdHash,
        crossSourceReleaseKeyHash: vector.crossSourceReleaseKeyHash,
        durablyCapturedAtMs: 1_800_000_000_000,
        effectiveAtMs: 1_800_000_000_000,
        nativeRevisionSequence: "1",
        issuerMappingId: ISSUER_MAPPING_ID,
        releaseKind: vector.releaseKind,
        plannedFiscalPeriod: vector.plannedFiscalPeriod,
        plannedReleaseDate: "2027-02-03",
        plannedSession: "pre-market",
      },
    ],
    frameFacts: {
      subject: "synthetic:PEAS",
      shareClassSelection: {
        policyId: "peas-study-share-class-v1",
        candidates: [
          {
            instrumentId: INSTRUMENT_ID,
            securityKind: "common-share",
            usExchangeListed: true,
            liquiditySessions,
            validLiquiditySessionCount: 0,
            medianDollarVolume: null,
          },
        ],
        selectedInstrumentId: INSTRUMENT_ID,
      },
      eventTMinusOneSnapshotPolicyId: "peas-study-t-minus-one-v1",
      scheduleDisagreement: { date: false, session: false },
      identityTransitionKnown: false,
      identityTransitionEvidenceObservationIds: [],
      sicCode: "0000",
      sicDivisionCode: null,
      sicAuthorityObservationId: null,
      sicMappingVersion: "sec-sic-division-v1",
      sectorStratum: "unknown",
      marketCapEvidence: {
        policyId: "peas-study-market-cap-v1",
        asOfSession: "2027-01-29",
        asOfNs: "1800000000000000000",
        priceReferenceKind: "prior-listing-official-close",
        priceViewKind: "recorded-primary",
        priceMarketResultId: `mmr1_${"1".repeat(64)}`,
        priceResultStatus: "missing",
        price: null,
        sharesOutstanding: null,
        sharesValueDate: null,
        sharesEffectiveAtNs: null,
        sharesSourceObservationId: null,
        sharesAuthorityVersion: null,
        sharesDurablyCapturedAtMs: null,
        marketCap: null,
        unknownKind: "price-missing",
        stratum: "unknown",
        comparisonRank: null,
        comparisonPopulationSize: 0,
      },
      marketCapStratum: "unknown",
      liquidityEvidence: {
        policyId: "peas-study-liquidity-20-session-median-v1",
        asOfSession: "2027-01-29",
        sessions: liquiditySessions,
        validSessionCount: 0,
        medianDollarVolume: null,
        stratum: "unknown",
        comparisonRank: null,
        comparisonPopulationSize: 0,
        tailRank: null,
        tailPopulationSize: null,
        tailEligible: false,
      },
      liquidityStratum: "unknown",
      modelFamily: "unknown",
      modelFamilyAuthority: "unknown",
      modelFamilyVersion: "v1",
      modelFamilyEffectiveAtMs: 1_800_000_000_000,
      modelFamilyEvidenceObservationIds: [],
      expectedSourceFamilies: ["issuer-ir-calendar"],
      marketReferenceJoinPolicyId: "peas-market-reference-join-v1",
      intervalKeys: ["Cprev", "Qpre", "Q0", "Q1", "Q5", "Q30"],
      referenceKinds: [
        "quote-nbbo-midpoint",
        "trade-last-eligible-consolidated",
        "bar-one-minute-completed-close",
        "prior-listing-official-close",
      ],
    },
    expectedClusterCandidateId: vector.clusterCandidateId,
  };
}

function rejectsCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof StudyContractError && error.reasonCode === code;
}

test("accepted synthetic issuer, instrument, seven SCC vectors, and retired collision are pinned", () => {
  const issuerPreimage = {
    issuerCik: "0000000001",
    symbols: ["PEAS"],
    selectedSymbol: "PEAS",
    mappingAuthority: "peas-synthetic-fixture",
    mappingVersion: "v1",
    effectiveFromMs: 0,
    effectiveToMs: null,
  };
  assert.equal(
    `imap1_${canonicalHash("peas/issuer-mapping/v1", issuerPreimage)}`,
    ISSUER_MAPPING_ID,
  );
  const instrumentPreimage = {
    issuerMappingId: ISSUER_MAPPING_ID,
    securityAuthority: "peas-synthetic",
    securityKey: "fictional-common-1",
    issueType: "common-share",
    shareClass: "A",
    primaryListingVenueCode: "XNAS",
    currency: "USD",
    roundLotSize: 100,
    effectiveFromNs: "0",
    effectiveToNs: null,
    predecessorInstrumentId: null,
    transitionReason: null,
  };
  assert.equal(
    `min1_${canonicalHash("peas/market-instrument/v1", instrumentPreimage)}`,
    INSTRUMENT_ID,
  );

  for (const vector of VECTORS) {
    assert.equal(
      deriveReleaseClusterKey(ISSUER_MAPPING_ID, vector.releaseKind, vector.clusterBasis),
      vector.releaseClusterKey,
      vector.name,
    );
    assert.equal(
      deriveStudyClusterCandidateId({
        scheduleSourceObservationId: OBSERVATION,
        issuerMappingId: ISSUER_MAPPING_ID,
        instrumentId: INSTRUMENT_ID,
        releaseKind: vector.releaseKind,
        releaseClusterKey: vector.releaseClusterKey,
        plannedFiscalPeriod: vector.plannedFiscalPeriod,
        plannedReleaseDate: "2027-02-03",
        plannedSession: "pre-market",
      }),
      vector.clusterCandidateId,
      vector.name,
    );
    assert.equal(
      validateStudyClusterCandidate(candidate(vector), 1_800_000_000_000).clusterCandidateId,
      vector.clusterCandidateId,
    );
  }
  const retired = {
    scheduleSourceObservationId: OBSERVATION,
    issuerMappingId: ISSUER_MAPPING_ID,
    instrumentId: INSTRUMENT_ID,
    plannedFiscalPeriod: null,
    plannedReleaseDate: "2027-02-03",
    plannedSession: "pre-market",
  };
  assert.equal(
    `scc1_${canonicalHash("peas/event-study-cluster-candidate/v1", retired)}`,
    RETIRED_COLLISION,
  );
  assert.notEqual(VECTORS[0]?.clusterCandidateId, VECTORS[1]?.clusterCandidateId);
});

test("candidate validation rejects stale key, extra fields, post-frame evidence, and accessors", () => {
  const base = candidate(VECTORS[0] as Vector);
  assert.throws(
    () => validateStudyClusterCandidate({ ...base, releaseClusterKey: "0".repeat(64) }),
    rejectsCode("study.input-invalid"),
  );
  assert.throws(
    () => validateStudyClusterCandidate({ ...base, unexpected: true }),
    rejectsCode("study.input-invalid"),
  );
  assert.throws(
    () =>
      validateStudyClusterCandidate(
        {
          ...base,
          scheduleSourceEvidence: [
            { ...(base.scheduleSourceEvidence[0] as object), durablyCapturedAtMs: 101 },
          ],
        },
        100,
      ),
    rejectsCode("study.input-invalid"),
  );
  const accessor = { ...base } as Record<string, unknown>;
  Object.defineProperty(accessor, "instrumentId", { enumerable: true, get: () => INSTRUMENT_ID });
  assert.throws(() => validateStudyClusterCandidate(accessor), /accessor/u);
  assert.throws(() => validateStudyClusterCandidate(new Proxy(base, {})), /Proxy/u);
});

test("rank, bootstrap, rejection sampling, Hamilton, and Holm literal contracts are deterministic", () => {
  const rankSeedHex = Array.from({ length: 32 }, (_, index) =>
    index.toString(16).padStart(2, "0"),
  ).join("");
  assert.equal(
    deriveBootstrapSeed(rankSeedHex, `std1_${"0".repeat(64)}`),
    "c53a848e04b4d945a53529ae5b38521ed30911687fc2a5da82f9cac328837bc9",
  );
  const word = deriveBootstrapWord({
    bootstrapSeedHex: "c53a848e04b4d945a53529ae5b38521ed30911687fc2a5da82f9cac328837bc9",
    metricId: "residualMovement5m",
    replicateIndex: 0,
    laneOrdinal: 0,
    drawIndex: 0,
    counter: 0n,
  });
  assert.deepEqual(word, {
    digest: "d61c7e091da9669460ab57eecf06483bc5250e38f3740827fb63813bc181d818",
    word: 15_428_345_001_081_923_220n,
  });
  assert.equal(bootstrapPoolIndex(word.word, 180), 60);
  assert.equal(bootstrapPoolIndex(18_446_744_073_709_551_610n, 10), null);
  assert.equal(bootstrapPoolIndex(9n, 10), 9);

  const hamilton = capacityHamilton(
    [
      { cellId: "a", capacity: 2 },
      { cellId: "b", capacity: 2 },
      { cellId: "c", capacity: 1 },
    ],
    3,
  );
  assert.deepEqual(
    hamilton.map(({ cellId, awarded }) => ({ cellId, awarded })),
    [
      { cellId: "a", awarded: 1 },
      { cellId: "b", awarded: 1 },
      { cellId: "c", awarded: 1 },
    ],
  );
  assert.deepEqual(
    capacityHamilton([...hamilton].reverse(), 3).map(({ cellId, awarded }) => ({
      cellId,
      awarded,
    })),
    [
      { cellId: "a", awarded: 1 },
      { cellId: "b", awarded: 1 },
      { cellId: "c", awarded: 1 },
    ],
  );
  assert.equal(deriveStudyRankDigest(rankSeedHex, VECTORS[0]?.clusterCandidateId ?? "").length, 64);
  assert.doesNotThrow(() => validateHolmFamilySlots(HOLM_SLOT_IDS));
  assert.throws(() => validateHolmFamilySlots(HOLM_SLOT_IDS.slice(0, 23)), /exact 24/u);
  assert.throws(() => validateHolmFamilySlots([...HOLM_SLOT_IDS, "extra"]), /exact 24/u);

  const overlappingControl = structuredClone(candidate(VECTORS[0] as Vector));
  const overlappingFacts = overlappingControl.frameFacts as Record<string, unknown>;
  overlappingFacts["identityTransitionKnown"] = true;
  overlappingFacts["identityTransitionEvidenceObservationIds"] = [OBSERVATION];
  (overlappingFacts["scheduleDisagreement"] as Record<string, unknown>)["date"] = true;
  assert.equal(classifyProspectiveControl(overlappingControl), "identity-transition");
  overlappingFacts["identityTransitionKnown"] = false;
  overlappingFacts["identityTransitionEvidenceObservationIds"] = [];
  assert.equal(classifyProspectiveControl(overlappingControl), "schedule-uncertain");
  (overlappingFacts["scheduleDisagreement"] as Record<string, unknown>)["date"] = false;
  assert.equal(classifyProspectiveControl(overlappingControl), "source-sparse");
});

test("frame is authority-bound, seed-bound, exact/one-over bounded, and fail-closed", () => {
  const seedMaterialId = `rsm1_${"1".repeat(64)}`;
  const seed = deriveRankSeedHex(seedMaterialId);
  const baseCandidate = candidate(VECTORS[0] as Vector);
  const frameBase = {
    schemaVersion: 1,
    studyDesignId: `std1_${"2".repeat(64)}`,
    contractAuthorityRegistryId: ACCEPTED_CONTRACT_AUTHORITY_REGISTRY_ID,
    samplingFrameAsOfMs: 1_800_000_000_000,
    calendarSnapshotId: `cal1_${"3".repeat(64)}`,
    scheduleSourcePolicyId: "peas-study-schedule-source-v1",
    frameConstructionCodeDigest: "4".repeat(64),
    configurationDigest: "5".repeat(64),
    preFrameEvidenceSnapshotId: `pfe1_${"6".repeat(64)}`,
    rankSeedMaterialId: seedMaterialId,
    rankSeedHex: seed,
    seedCommittedAtMs: 1_800_000_000_001,
    frameConstructedAtMs: 1_800_000_000_002,
    candidates: [baseCandidate],
    dispositions: [],
    expectedFrameSnapshotId: "",
  } as StudyFrameSnapshotV1;
  assert.throws(
    () => validateStudyFrameSnapshot(frameBase, frameBase.studyDesignId),
    rejectsCode("study.input-invalid"),
  );
  assert.throws(
    () =>
      validateStudyFrameSnapshot(
        {
          ...frameBase,
          candidates: Array.from({ length: 8_193 }, () => null),
        },
        frameBase.studyDesignId,
      ),
    rejectsCode("study.bound-exceeded"),
  );
  assert.throws(
    () =>
      validateStudyFrameSnapshot(
        { ...frameBase, contractAuthorityRegistryId: `car1_${"0".repeat(64)}` },
        frameBase.studyDesignId,
      ),
    rejectsCode("study.frame-not-frozen"),
  );

  const knownCandidates = VECTORS.map((vector, index) => {
    const known = structuredClone(candidate(vector));
    const frameFacts = known.frameFacts as Record<string, unknown>;
    const evidence = frameFacts["marketCapEvidence"] as Record<string, unknown>;
    const stratum = index < 3 ? "low" : index < 5 ? "mid" : "high";
    Object.assign(evidence, {
      priceResultStatus: "selected-complete",
      priceMarketResultId: `msr1_${(index + 1).toString(16).padStart(64, "0")}`,
      price: { coefficient: "1", scale: 0, negative: false },
      sharesOutstanding: { coefficient: `${index + 1}`, scale: 0, negative: false },
      sharesValueDate: "2027-01-29",
      sharesEffectiveAtNs: "1700000000000000000",
      sharesSourceObservationId: `aob1_${(index + 1).toString(16).padStart(64, "0")}`,
      sharesAuthorityVersion: "synthetic-shares-v1",
      sharesDurablyCapturedAtMs: 1_700_000_000_000,
      marketCap: { numerator: `${index + 1}`, denominator: "1" },
      unknownKind: null,
      stratum,
      comparisonRank: index,
      comparisonPopulationSize: 7,
    });
    frameFacts["marketCapStratum"] = stratum;
    return known;
  });
  const validFrame = {
    ...frameBase,
    candidates: knownCandidates,
    expectedFrameSnapshotId: "",
  } as StudyFrameSnapshotV1;
  const withFrameId = {
    ...validFrame,
    expectedFrameSnapshotId: deriveStudyFrameSnapshotId(validFrame),
  };
  assert.doesNotThrow(() => validateStudyFrameSnapshot(withFrameId, frameBase.studyDesignId));
  const wrongTertile = structuredClone(withFrameId);
  const wrongFacts = wrongTertile.candidates[0]?.frameFacts as Record<string, unknown>;
  wrongFacts["marketCapStratum"] = "high";
  (wrongFacts["marketCapEvidence"] as Record<string, unknown>)["stratum"] = "high";
  assert.throws(
    () => validateStudyFrameSnapshot(wrongTertile, frameBase.studyDesignId),
    rejectsCode("study.input-invalid"),
  );
});

test("run freeze refuses P1-09 pending before inspecting a provider policy or outcome", () => {
  const placeholder = {} as StudyFreezeManifestV1;
  const frame = {} as StudyFrameSnapshotV1;
  assert.throws(
    () =>
      validateStudyFreezeManifest(placeholder, frame, {
        p108ImplementationGo: true,
        p109EntitlementGo: false,
        p110AcquisitionGo: false,
        p106EvidenceCaptureGo: false,
        providerFrozen: false,
        datasetFrozen: false,
        feedFrozen: false,
        endpointFrozen: false,
        entitlementFrozen: false,
        fallbackFrozen: false,
        zeroIncrementalSpend: true,
        firstOutcomeAtMs: null,
      }),
    (error) =>
      error instanceof StudyContractError &&
      error.reasonCode === "study.primary-provider-unfrozen" &&
      error.detail?.["providerFreezeKind"] === "provider",
  );
  assert.equal(STUDY_CONTRACT_AUTHORITY_IDS.length, 10);
});

test("all 33 closed study reasons validate and arbitrary code/detail/error construction rejects", () => {
  assert.equal(Object.keys(STUDY_REASON_CATALOG).length, 33);
  for (const [code, rule] of Object.entries(STUDY_REASON_CATALOG)) {
    const reason = {
      code,
      disposition: rule.disposition,
      scope: rule.scopes[0],
      detail: rule.detail === null ? null : { [rule.detail.key]: rule.detail.values[0] as string },
      marketResultId: rule.marketEvidence ? `mmr1_${"1".repeat(64)}` : null,
      preservedMarketReason: rule.marketEvidence
        ? {
            code: "market.no-eligible-quote",
            disposition: "missing",
            scope: "reference",
            detail: null,
          }
        : null,
    };
    assert.equal(validateStudyReason(reason).code, code);
  }
  const valid = {
    code: "study.rank-invalid",
    disposition: "fatal",
    scope: "frame",
    detail: { rankFailureKind: "seed" },
    marketResultId: null,
    preservedMarketReason: null,
  };
  assert.throws(
    () => validateStudyReason({ ...valid, detail: { field: "rankFailureKind", value: "seed" } }),
    rejectsCode("study.input-invalid"),
  );
  assert.throws(
    () => validateStudyReason({ ...valid, code: "study.anchor-human-decision-unresolved" }),
    rejectsCode("study.input-invalid"),
  );
  assert.throws(
    () => new StudyContractError("study.not-real", "forged"),
    /not a closed fatal code/u,
  );
  assert.throws(
    () => new StudyContractError("study.input-invalid", "forged", { arbitrary: "detail" }),
    /detail is invalid/u,
  );
  assert.throws(
    () =>
      new StudyContractError("study.rank-invalid", "forged", {
        rankFailureKind: "caller-choice",
      }),
    /detail is invalid/u,
  );
  const accessor = { ...valid } as Record<string, unknown>;
  Object.defineProperty(accessor, "code", {
    enumerable: true,
    get: () => "study.rank-invalid",
  });
  assert.throws(() => validateStudyReason(accessor), /accessor/u);
});

function datasetFixture(): {
  manifest: StudyFreezeManifestV1;
  dataset: Record<string, unknown>;
  evidence: StudyDatasetValidationEvidenceV1;
} {
  const frameSnapshotId = `sfs1_${"f".repeat(64)}`;
  const selectedClusters = Array.from({ length: 180 }, (_, index) => {
    const lane = index < 120 ? "standard" : index < 160 ? "specialized" : "prospective-control";
    const selection = {
      clusterCandidateId: `scc1_${index.toString(16).padStart(64, "0")}`,
      frameSnapshotId,
      lane,
      controlGroup:
        index < 160
          ? null
          : ((
              [
                "identity-transition",
                "schedule-uncertain",
                "source-sparse",
                "liquidity-tail",
              ] as const
            )[Math.floor((index - 160) / 5)] ?? "identity-transition"),
      strata: {
        sector: "unknown",
        marketCap: "unknown",
        liquidity: "unknown",
        plannedSession: "pre-market",
        modelFamily: "unknown",
      },
      rank: index.toString(16).padStart(64, "0"),
      allocationCell: {
        allocationCellId: `cell-${index}`,
        cellFrameCount: 1,
        cellSelectedCount: 1,
      },
      selectionFraction: { numerator: "1", denominator: "1" },
      expectedStudyClusterId: "",
    } as const;
    return {
      ...selection,
      expectedStudyClusterId: deriveStudyClusterId(selection),
    };
  });
  const metricIds = [
    "E1.complete-primary",
    "E2.observed-within-15m",
    "E3.informative-residual-5m",
    "E4.deterministic-reproduction",
    "priorCloseMovementAtFirstObservation",
    "releaseGapMovement",
    "residualMovement1m",
    "residualMovement30m",
    "residualMovement5m",
  ];
  const endpoints = ["Cprev", "Qpre", "Q0", "Q1", "Q5", "Q30"] as const;
  const attritionStages = [
    "selected",
    "release-observed",
    "anchor-trusted",
    "prior-close-eligible",
    "q0-eligible",
    "q1-eligible",
    "q5-eligible",
    "q30-eligible",
    "fully-complete",
  ];
  const denominatorAccounting = [...selectedClusters]
    .sort((left, right) => left.expectedStudyClusterId.localeCompare(right.expectedStudyClusterId))
    .map((selection, clusterIndex) => {
      const captureBasis = {
        basisKind: "capture" as const,
        eventId: `event-${clusterIndex}`,
        receivedAtMs: 1_950_000_000_500 + clusterIndex,
        logicalAtMs: 10_000 + clusterIndex,
        clockBasisId: "clock-verified-v1",
      };
      const retrievalBasis = {
        basisKind: "retrieval" as const,
        role: "primary-release-artifact",
        acquisitionObservationId: `acquisition-${clusterIndex}`,
        vaultObservationId: `vault-${clusterIndex}`,
        retrievedAtMs: 1_950_000_000_000 + clusterIndex,
        clockBasisId: "clock-verified-v1",
      };
      const referenceRow = (
        endpointKind: (typeof endpoints)[number],
        referenceIndex: number,
        retrieval: boolean,
      ) => ({
        endpointKind,
        referenceKind:
          referenceIndex === 0 ? "prior-listing-official-close" : "quote-nbbo-midpoint",
        viewKind: "recorded-primary",
        resultStatus: "selected-complete",
        selectedReferenceId: `msr1_${(clusterIndex * 12 + (retrieval ? 6 : 0) + referenceIndex)
          .toString(16)
          .padStart(64, "0")}`,
        missingReferenceId: null,
        studyReason: null,
        diagnostics: [],
      });
      return {
        studyClusterId: selection.expectedStudyClusterId,
        lane: selection.lane,
        controlGroup: selection.controlGroup,
        sector: selection.strata.sector,
        marketCap: selection.strata.marketCap,
        liquidity: selection.strata.liquidity,
        plannedSession: selection.strata.plannedSession,
        actualSession: "pre-market",
        modelFamily: selection.strata.modelFamily,
        releaseStatus: "observed",
        primaryAnchorStatus: "trusted",
        eventTMinusOneSnapshotId: `ets1_${clusterIndex.toString(16).padStart(64, "0")}`,
        providerComparison: "agree",
        retrievalSensitivityStatus: "complete",
        anchorTelemetry: {
          captureBasis,
          retrievalBasis,
          captureMinusRetrievalMs: 500,
          latencyStudyReason: null,
        },
        references: endpoints.map((endpointKind, referenceIndex) =>
          referenceRow(endpointKind, referenceIndex, false),
        ),
        retrievalSensitivityReferences: endpoints.map((endpointKind, referenceIndex) =>
          referenceRow(endpointKind, referenceIndex, true),
        ),
        metrics: metricIds.map((metricId, metricIndex) => ({
          metricId,
          evaluability: "evaluable",
          metricRecordId: `metric-${clusterIndex}-${metricIndex}`,
          success: metricId.startsWith("E") ? true : null,
          studyReason: null,
        })),
        attrition: attritionStages.map((stage) => ({ stage, status: "passed", reason: null })),
        annotations: [],
      };
    });
  const manifestBase = {
    schemaVersion: 1,
    studyDesignId: `std1_${"1".repeat(64)}`,
    codeCommit: "a".repeat(40),
    configurationDigest: "2".repeat(64),
    contractAuthorityRegistryId: ACCEPTED_CONTRACT_AUTHORITY_REGISTRY_ID,
    contractIds: [...STUDY_CONTRACT_AUTHORITY_IDS],
    calendarSnapshotId: `cal1_${"3".repeat(64)}`,
    entitlementSnapshotIds: [`ent1_${"4".repeat(64)}`],
    providerSourcePolicyId: "peas-market-provider-source-policy-v1",
    selectionPolicyId: "market-reference-selection-v1",
    primaryAnchorKind: "capture",
    alternateAnchorRequired: true,
    readyAtMs: 1_900_000_000_000,
    samplingFrameAsOfMs: 1_900_000_000_001,
    freezePublishedAtMs: 1_900_000_000_002,
    collectionSessions: Array.from({ length: 65 }, (_, index) =>
      new Date(Date.UTC(2030, 0, index + 1)).toISOString().slice(0, 10),
    ),
    correctionLagMs: 604_800_000,
    rankSeedMaterialId: `rsm1_${"5".repeat(64)}`,
    rankSeedHex: "6".repeat(64),
    frameSnapshotId,
    selectedClusters,
    expectedCounts: {
      targetClusters: 180,
      laneTargets: { standard: 120, specialized: 40, prospectiveControl: 20 },
      controlTargets: {
        identityTransition: 5,
        scheduleUncertain: 5,
        sourceSparse: 5,
        liquidityTail: 5,
      },
    },
    expectedStudyManifestId: "",
  } as unknown as StudyFreezeManifestV1;
  const manifest = {
    ...manifestBase,
    expectedStudyManifestId: deriveStudyManifestId(manifestBase),
  } as StudyFreezeManifestV1;
  const marketResults = denominatorAccounting.flatMap((row, clusterIndex) =>
    [...row.references, ...row.retrievalSensitivityReferences].map((reference, resultIndex) => {
      const referenceIndex = resultIndex % 6;
      const retrieval = resultIndex >= 6;
      return {
        studyClusterId: row.studyClusterId,
        endpointKind: reference.endpointKind,
        referenceKind: reference.referenceKind,
        viewKind: reference.viewKind,
        resultId: reference.selectedReferenceId,
        resultStatus: reference.resultStatus,
        asOfBasis: {
          anchorRole: retrieval
            ? ("h001-mandatory-retrieval-sensitivity" as const)
            : ("h001-primary-durable-capture" as const),
          trustedObservationBasis: retrieval
            ? row.anchorTelemetry.retrievalBasis
            : row.anchorTelemetry.captureBasis,
          targetTimeNs: `${1_000_000_000 + clusterIndex * 10_000 + referenceIndex}`,
          comparator:
            referenceIndex === 0
              ? ("authoritative-prior-close" as const)
              : referenceIndex === 1
                ? ("strictly-before" as const)
                : ("at-or-before" as const),
          viewKind: "recorded-primary" as const,
          recordedCorpusSnapshotId: `mcs1_${clusterIndex.toString(16).padStart(64, "0")}`,
          corpusCutoffId: `mcc1_${clusterIndex.toString(16).padStart(64, "0")}`,
          admittedRevisionSetHash: "7".repeat(64),
        },
        preservedMissingReason: null,
        diagnostics: [],
        marketReferenceJoinKey: `mrj1_${(clusterIndex * 2 + (retrieval ? 1 : 0))
          .toString(16)
          .padStart(64, "0")}`,
        sourceObservationIds: [
          `aob1_${(clusterIndex * 12 + resultIndex).toString(16).padStart(64, "0")}`,
        ],
        revisionIds: [`mrv1_${(clusterIndex * 12 + resultIndex).toString(16).padStart(64, "0")}`],
        discrepancyIds: [],
        executionIds: [`mex1_${(clusterIndex * 12 + resultIndex).toString(16).padStart(64, "0")}`],
        correctedCutoffMs: 2_000_000_000_000,
      };
    }),
  );
  const metricRecords = denominatorAccounting.flatMap((row) =>
    row.metrics.map((metric) => ({
      metricRecordId: metric.metricRecordId,
      studyClusterId: row.studyClusterId,
      metricId: metric.metricId,
    })),
  );
  const clusterOutcomes = denominatorAccounting.map((row) => ({
    studyClusterId: row.studyClusterId,
    actualSession: row.actualSession,
    releaseStatus: row.releaseStatus,
    primaryAnchorStatus: row.primaryAnchorStatus,
    eventTMinusOneSnapshotId: row.eventTMinusOneSnapshotId,
    providerComparison: row.providerComparison,
    retrievalSensitivityStatus: row.retrievalSensitivityStatus,
    anchorTelemetry: row.anchorTelemetry,
  }));
  const evidence = {
    collectionConfigurationDigest: "c".repeat(64),
    artifactInventoryDigest: "d".repeat(64),
    datasetFreezePolicyVersion: STUDY_DATASET_FREEZE_POLICY_VERSION,
    marketResults,
    metricRecords,
    clusterOutcomes,
  } as StudyDatasetValidationEvidenceV1;
  const referenceResultIds = denominatorAccounting
    .flatMap((row) =>
      [...row.references, ...row.retrievalSensitivityReferences].map(
        (reference) => reference.selectedReferenceId,
      ),
    )
    .sort();
  const metricRecordIds = denominatorAccounting
    .flatMap((row) => row.metrics.map((metric) => metric.metricRecordId))
    .sort();
  const dataset = {
    schemaVersion: 1,
    studyManifestId: manifest.expectedStudyManifestId,
    freezeCutoffMs: 2_000_000_000_000,
    collectionCodeCommit: "b".repeat(40),
    collectionConfigurationDigest: evidence.collectionConfigurationDigest,
    executionIds: marketResults.flatMap((result) => result.executionIds).sort(),
    artifactInventoryDigest: evidence.artifactInventoryDigest,
    sourceObservationIds: marketResults.flatMap((result) => result.sourceObservationIds).sort(),
    revisionIds: marketResults.flatMap((result) => result.revisionIds).sort(),
    marketReferenceJoinKeys: [
      ...new Set(marketResults.map((result) => result.marketReferenceJoinKey)),
    ].sort(),
    referenceResultIds,
    discrepancyIds: [],
    metricRecordIds,
    denominatorAccounting,
    datasetFreezePolicyVersion: STUDY_DATASET_FREEZE_POLICY_VERSION,
    expectedDatasetFreezeId: "",
  };
  dataset.expectedDatasetFreezeId = deriveStudyDatasetFreezeId(dataset as never);
  return { manifest, dataset, evidence };
}

test("dataset accounting is a closed evidence-backed union and rejects semantic and cross-link forgeries", () => {
  const { manifest, dataset, evidence } = datasetFixture();
  assert.equal(
    validateStudyDatasetFreeze(dataset, manifest, evidence).datasetFreezeId,
    dataset["expectedDatasetFreezeId"],
  );
  const mutateFirstRow = (
    change: (row: Record<string, unknown>) => void,
  ): Record<string, unknown> => {
    const copy = structuredClone(dataset);
    const row = (copy["denominatorAccounting"] as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    change(row);
    return copy;
  };
  assert.throws(
    () =>
      validateStudyDatasetFreeze(
        mutateFirstRow((row) => {
          const references = row["references"] as Record<string, unknown>[];
          references.push({
            ...references[0],
            resultStatus: "rejected",
            selectedReferenceId: null,
          });
        }),
        manifest,
        evidence,
      ),
    rejectsCode("study.input-invalid"),
  );
  for (const mutation of [
    (row: Record<string, unknown>) => {
      row["lane"] = "bogus";
    },
    (row: Record<string, unknown>) => {
      (row["metrics"] as Record<string, unknown>[])[0] = {
        ...(row["metrics"] as Record<string, unknown>[])[0],
        metricId: "bogus",
      };
    },
    (row: Record<string, unknown>) => {
      (row["references"] as Record<string, unknown>[])[0] = {
        ...(row["references"] as Record<string, unknown>[])[0],
        resultStatus: "bogus",
      };
    },
    (row: Record<string, unknown>) => {
      (row["annotations"] as unknown[]).push({
        code: "study.not-real",
        disposition: "annotation",
        scope: "cluster",
        detail: null,
        marketResultId: null,
        preservedMarketReason: null,
      });
    },
  ]) {
    assert.throws(
      () => validateStudyDatasetFreeze(mutateFirstRow(mutation), manifest, evidence),
      rejectsCode("study.input-invalid"),
    );
  }

  const omittedEvidence = {
    ...evidence,
    marketResults: evidence.marketResults.slice(1),
  };
  assert.throws(
    () => validateStudyDatasetFreeze(dataset, manifest, omittedEvidence),
    rejectsCode("study.input-invalid"),
  );

  const firstMarketResult = evidence.marketResults[0];
  if (firstMarketResult === undefined) throw new Error("fixture market result is missing");
  const crossLinkedEvidence = {
    ...evidence,
    marketResults: [
      {
        ...firstMarketResult,
        studyClusterId: evidence.clusterOutcomes[1]?.studyClusterId ?? "",
      },
      ...evidence.marketResults.slice(1),
    ],
  };
  assert.throws(
    () => validateStudyDatasetFreeze(dataset, manifest, crossLinkedEvidence),
    rejectsCode("study.input-invalid"),
  );

  const missingRetrievalRow = mutateFirstRow((row) => {
    (row["retrievalSensitivityReferences"] as unknown[]).pop();
  });
  assert.throws(
    () => validateStudyDatasetFreeze(missingRetrievalRow, manifest, evidence),
    rejectsCode("study.input-invalid"),
  );

  const firstRetrievalResultIndex = evidence.marketResults.findIndex(
    (result) => result.asOfBasis.anchorRole === "h001-mandatory-retrieval-sensitivity",
  );
  const firstRetrievalResult = evidence.marketResults[firstRetrievalResultIndex];
  if (firstRetrievalResult === undefined) throw new Error("fixture retrieval result is missing");
  const relabeledRetrievalEvidence = {
    ...evidence,
    marketResults: evidence.marketResults.map((result, index) =>
      index === firstRetrievalResultIndex
        ? {
            ...result,
            asOfBasis: {
              ...result.asOfBasis,
              anchorRole: "h001-primary-durable-capture" as const,
              trustedObservationBasis: evidence.clusterOutcomes[0]?.anchorTelemetry
                .captureBasis ?? {
                basisKind: "capture" as const,
                eventId: "missing",
                receivedAtMs: 0,
                logicalAtMs: 0,
                clockBasisId: "missing",
              },
            },
          }
        : result,
    ),
  };
  assert.throws(
    () => validateStudyDatasetFreeze(dataset, manifest, relabeledRetrievalEvidence),
    rejectsCode("study.input-invalid"),
  );

  const crossLinkedRetrievalEvidence = {
    ...evidence,
    marketResults: evidence.marketResults.map((result, index) =>
      index === firstRetrievalResultIndex
        ? {
            ...result,
            studyClusterId: evidence.clusterOutcomes[1]?.studyClusterId ?? "",
          }
        : result,
    ),
  };
  assert.throws(
    () => validateStudyDatasetFreeze(dataset, manifest, crossLinkedRetrievalEvidence),
    rejectsCode("study.input-invalid"),
  );

  const forgedSelectorEvidence = {
    ...evidence,
    marketResults: evidence.marketResults.map((result, index) =>
      index === firstRetrievalResultIndex
        ? {
            ...result,
            asOfBasis: {
              ...result.asOfBasis,
              targetTimeNs: `${BigInt(result.asOfBasis.targetTimeNs) + 1n}`,
            },
          }
        : result,
    ),
  };
  assert.throws(
    () => validateStudyDatasetFreeze(dataset, manifest, forgedSelectorEvidence),
    rejectsCode("study.input-invalid"),
  );

  const forgedLatencyDataset = structuredClone(dataset);
  const forgedLatencyRow = (
    forgedLatencyDataset["denominatorAccounting"] as Record<string, unknown>[]
  )[0] as Record<string, unknown>;
  (forgedLatencyRow["anchorTelemetry"] as Record<string, unknown>)["captureMinusRetrievalMs"] = 499;
  const forgedLatencyEvidence = {
    ...evidence,
    clusterOutcomes: evidence.clusterOutcomes.map((outcome, index) =>
      index === 0
        ? {
            ...outcome,
            anchorTelemetry: {
              ...outcome.anchorTelemetry,
              captureMinusRetrievalMs: 499,
            },
          }
        : outcome,
    ),
  };
  assert.throws(
    () => validateStudyDatasetFreeze(forgedLatencyDataset, manifest, forgedLatencyEvidence),
    rejectsCode("study.input-invalid"),
  );

  const incompleteManifest = structuredClone(manifest) as unknown as Record<string, unknown>;
  (incompleteManifest["selectedClusters"] as Record<string, unknown>[])[0] = {
    expectedStudyClusterId: manifest.selectedClusters[0]?.expectedStudyClusterId,
  };
  assert.throws(
    () =>
      validateStudyDatasetFreeze(
        dataset,
        incompleteManifest as unknown as StudyFreezeManifestV1,
        evidence,
      ),
    rejectsCode("study.input-invalid"),
  );

  for (const mutation of [
    (copy: Record<string, unknown>) => {
      copy["freezeCutoffMs"] = 2_000_000_000_001;
    },
    (copy: Record<string, unknown>) => {
      copy["collectionConfigurationDigest"] = "e".repeat(64);
    },
    (copy: Record<string, unknown>) => {
      copy["datasetFreezePolicyVersion"] = "caller-selected-policy";
    },
    (copy: Record<string, unknown>) => {
      (copy["sourceObservationIds"] as string[]).push("unaccounted-observation");
    },
  ]) {
    const copy = structuredClone(dataset);
    mutation(copy);
    assert.throws(
      () => validateStudyDatasetFreeze(copy, manifest, evidence),
      rejectsCode("study.input-invalid"),
    );
  }

  const missingDataset = structuredClone(dataset);
  const missingRow = (missingDataset["denominatorAccounting"] as Record<string, unknown>[])[0] as
    | Record<string, unknown>
    | undefined;
  const missingReferences = missingRow?.["references"];
  const missingReference = Array.isArray(missingReferences)
    ? (missingReferences[0] as Record<string, unknown> | undefined)
    : undefined;
  const missingResultId = `mmr1_${"9".repeat(64)}`;
  const immutableReason = {
    code: "market.no-eligible-quote",
    disposition: "missing",
    scope: "reference",
    detail: null,
  };
  if (missingReference !== undefined) {
    Object.assign(missingReference, {
      resultStatus: "missing",
      selectedReferenceId: null,
      missingReferenceId: missingResultId,
      studyReason: {
        code: "study.prior-close-missing",
        disposition: "metric-missing",
        scope: "metric",
        detail: null,
        marketResultId: missingResultId,
        preservedMarketReason: {
          ...immutableReason,
          code: "market.no-eligible-trade",
        },
      },
    });
  }
  const missingEvidence = {
    ...evidence,
    marketResults: [
      {
        ...firstMarketResult,
        resultId: missingResultId,
        resultStatus: "missing" as const,
        preservedMissingReason: immutableReason,
      },
      ...evidence.marketResults.slice(1),
    ],
  };
  assert.throws(
    () => validateStudyDatasetFreeze(missingDataset, manifest, missingEvidence),
    rejectsCode("study.input-invalid"),
  );
});

test("exact rational statistics, Wilson gates, and 24-slot Holm are deterministic", () => {
  assert.deepEqual(exactMedian([rational(-3n), rational(1n), rational(5n)]), rational(1n));
  assert.deepEqual(
    exactMedian([rational(-3n), rational(1n), rational(5n), rational(9n)]),
    rational(3n),
  );
  const values = [0n, 10n, 20n, 30n, 40n].map((value) => rational(value));
  assert.deepEqual(type7Quantile(values, rational(1n, 40n)), rational(1n));
  assert.deepEqual(type7Quantile(values, rational(39n, 40n)), rational(39n));
  const gates = evaluateReadinessGates({
    e1Successes: 180,
    e2Successes: 180,
    e3Successes: 180,
    e4Reproduced: 180,
  });
  assert.equal(gates.overall, "GO");
  assert.equal(
    evaluateReadinessGates({
      e1Successes: 0,
      e2Successes: 180,
      e3Successes: 180,
      e4Reproduced: 180,
    }).overall,
    "NO_GO",
  );
  assert.equal(
    evaluateReadinessGates({
      e1Successes: 135,
      e2Successes: 126,
      e3Successes: 45,
      e4Reproduced: 180,
    }).overall,
    "INCONCLUSIVE",
  );
  const readiness = evaluateClusterReadinessMetrics({
    trustedPublication: true,
    trustedDurableAnchor: true,
    requiredPrimaryReferencesComplete: true,
    primaryCorrectionSemanticsComplete: true,
    latencyUpperMs: 900_000,
    q0: rational(100n),
    q5: rational(102n),
    bid0: rational(99n),
    ask0: rational(101n),
    bid5: rational(101n),
    ask5: rational(103n),
    requiredVariantsByteIdentical: true,
  });
  assert.deepEqual(readiness, { E1: true, E2: true, E3: false, E4: true });
  assert.equal(
    evaluateClusterReadinessMetrics({
      trustedPublication: true,
      trustedDurableAnchor: true,
      requiredPrimaryReferencesComplete: true,
      primaryCorrectionSemanticsComplete: true,
      latencyUpperMs: 900_001,
      q0: rational(100n),
      q5: rational(103n),
      bid0: rational(99n),
      ask0: rational(101n),
      bid5: rational(102n),
      ask5: rational(104n),
      requiredVariantsByteIdentical: true,
    }).E2,
    false,
  );
  const holm = evaluateHolm24(
    HOLM_SLOT_IDS.map((slotId, index) => ({
      slotId,
      rawP: index === 0 ? rational(1n, 1_000n) : null,
    })),
  );
  assert.equal(holm.length, 24);
  assert.equal(holm[0]?.rejected, true);
  assert.equal(
    holm.slice(1).every(({ rejected }) => !rejected),
    true,
  );
});

test("lane-stratified bootstrap emits exactly 10000 deterministic replicates and rejects count drift", () => {
  const input = {
    rankSeedHex: Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0")).join(
      "",
    ),
    studyDesignId: `std1_${"0".repeat(64)}`,
    metricId: "residualMovement5m" as const,
    rows: Array.from({ length: 180 }, (_, index) => ({
      studyClusterId: `scl1_${index.toString(16).padStart(64, "0")}`,
      lane:
        index < 120
          ? ("standard" as const)
          : index < 160
            ? ("specialized" as const)
            : ("prospective-control" as const),
      value: index === 0 ? rational(5n) : null,
    })),
  };
  const first = laneStratifiedBootstrap(input);
  const second = laneStratifiedBootstrap(input);
  assert.equal(first.status, "available");
  assert.equal(first.replicates?.length, 10_000);
  assert.deepEqual(first, second);
  assert.throws(
    () => laneStratifiedBootstrap({ ...input, replicateCount: 9_999 }),
    rejectsCode("study.input-invalid"),
  );
  assert.throws(
    () => laneStratifiedBootstrap({ ...input, replicateCount: 10_001 }),
    rejectsCode("study.input-invalid"),
  );
});

test("study bound reasons consume the one 84-row core enforcement registry without aliases", () => {
  assert.equal(CANONICAL_BOUND_IDS.length, 84);
  assert.equal(BOUND_ENFORCEMENT_REGISTRY.length, 84);
  assert.deepEqual(
    BOUND_ENFORCEMENT_REGISTRY.map(({ boundId }) => boundId),
    CANONICAL_BOUND_IDS,
  );
  const studyBoundValues = STUDY_REASON_CATALOG["study.bound-exceeded"].detail?.values ?? [];
  const coreStudyBounds = CANONICAL_BOUND_IDS.slice(CANONICAL_BOUND_IDS.indexOf("targetClusters"));
  assert.deepEqual(studyBoundValues, coreStudyBounds);
  assert.deepEqual(STUDY_BOUND_IDS, coreStudyBounds);
  const exactProbes: Readonly<Record<StudyBoundIdV1, number | readonly number[]>> = {
    targetClusters: 180,
    laneTargets: [120, 40, 20],
    controlTargets: [5, 5, 5, 5],
    candidateFrameMembers: 8_192,
    frameDispositionOrStratumCells: 2_048,
    selectedClusterEntryBytes: 65_536,
    completeStudyManifestBytes: 33_554_432,
    datasetFreezeBundleBytes: 67_108_864,
    studyJsonDepth: 12,
    studyJsonNodesTotal: 500_000,
    studyKeysPerObject: 64,
    studyGenericArrayItems: 256,
    studyStringBytes: 4_096,
    studyIdentifierBytes: 512,
    contractSourceEntitlementIds: 64,
    reasonDefinitions: 64,
    metricDefinitions: 32,
    sensitivityDefinitions: 32,
    referencesPerCluster: 64,
    referencesTotal: 12_800,
    annotationsPerCluster: 64,
    revisionsReferencedPerCluster: 32,
    strataDimensions: 8,
    collectionSessions: 65,
    collectionCalendarSpanMs: 10_368_000_000,
    liquidityHistorySessions: 20,
    minimumValidLiquiditySessions: 15,
    timelyObservationMs: 900_000,
    correctionLagMs: 604_800_000,
    bootstrapReplicates: 10_000,
    holmSlots: 24,
  };
  const exactCountIds = new Set<StudyBoundIdV1>([
    "targetClusters",
    "laneTargets",
    "controlTargets",
    "collectionSessions",
    "liquidityHistorySessions",
    "bootstrapReplicates",
    "holmSlots",
  ]);
  for (const boundId of STUDY_BOUND_IDS) {
    const exact = exactProbes[boundId];
    const accepted = evaluateStudyBound(boundId, exact);
    assert.equal(accepted.accepted, true, `${boundId} exact boundary must be accepted`);
    assert.equal(
      accepted.atomicity,
      ["minimumValidLiquiditySessions", "timelyObservationMs", "correctionLagMs"].includes(boundId)
        ? "metric"
        : "study-run",
    );
    const outside =
      boundId === "laneTargets"
        ? [121, 40, 20]
        : boundId === "controlTargets"
          ? [6, 5, 5, 5]
          : boundId === "minimumValidLiquiditySessions"
            ? 14
            : (exact as number) + 1;
    const rejected = evaluateStudyBound(boundId, outside);
    assert.equal(rejected.accepted, false, `${boundId} applicable outside boundary must reject`);
    if (!rejected.accepted) {
      assert.equal(
        rejected.violation,
        boundId === "minimumValidLiquiditySessions"
          ? "study.liquidity-unknown"
          : boundId === "timelyObservationMs"
            ? "study.timeliness-threshold-not-met"
            : boundId === "correctionLagMs"
              ? "study.correction-after-cutoff"
              : exactCountIds.has(boundId)
                ? "study.input-invalid"
                : "study.bound-exceeded",
      );
    }
    if (exactCountIds.has(boundId)) {
      const countMinusOne =
        boundId === "laneTargets"
          ? [119, 40, 20]
          : boundId === "controlTargets"
            ? [4, 5, 5, 5]
            : (exact as number) - 1;
      const lower = evaluateStudyBound(boundId, countMinusOne);
      assert.equal(lower.accepted, false, `${boundId} count-minus-one must reject`);
      if (!lower.accepted) assert.equal(lower.violation, "study.input-invalid");
    }
  }
  for (const outsideSchemaRange of [99, 201]) {
    const schemaRejected = evaluateStudyBound("targetClusters", outsideSchemaRange);
    assert.equal(schemaRejected.accepted, false);
    if (!schemaRejected.accepted) {
      assert.equal(schemaRejected.violation, "study.bound-exceeded");
    }
  }
  for (const limitKind of studyBoundValues) {
    assert.doesNotThrow(() =>
      validateStudyReason({
        code: "study.bound-exceeded",
        disposition: "fatal",
        scope: "design",
        detail: { limitKind },
        marketResultId: null,
        preservedMarketReason: null,
      }),
    );
  }
  assert.throws(
    () =>
      validateStudyReason({
        code: "study.bound-exceeded",
        disposition: "fatal",
        scope: "design",
        detail: { limitKind: "fixture-only-alias" },
        marketResultId: null,
        preservedMarketReason: null,
      }),
    rejectsCode("study.input-invalid"),
  );
});
