# PR 2D event-study freeze-manifest contract

## Status and scope

- Contract status: `PROPOSED`
- Design schema: `StudyDesignV1`
- Pre-outcome run schema: `StudyFreezeManifestV1`
- Post-collection schema: `StudyDatasetFreezeV1`
- Fixed target: exactly `180` prospectively selected clusters
- P1-09: `PENDING`; a run-specific provider policy cannot freeze until P1-09 independently returns
  `GO`

This contract makes the event-study recommendations executable and incorporates the approved H-001
decision from [`pr-2d-orchestration.md`](../goals/pr-2d-orchestration.md): durable capture is the
primary operational PEAS observation anchor, the exact inherited retrieval basis is a mandatory
sensitivity, and every point target selects the last eligible fact at or before the target. It must
be read with the provider/source, timestamp/trust, market-eligibility, reason, resource,
[`fixture-manifest`](pr-2d-fixture-manifest.md), and
[`acceptance-matrix`](pr-2d-acceptance-matrix.md) contracts.

The manifest is an additive sidecar. It does not extend `ObservationLedgerFactsV1`, EventDraft,
EventLog, ProcessingStore, ArtifactStore, the deterministic kernel, or migrations.

## Three immutable stages

1. `StudyDesignV1` freezes the accepted ADR/contract versions, algorithms, metrics, thresholds,
   bounds, missing/outlier/multiplicity/correction/provider policies, and validation code identity.
2. `StudyFreezeManifestV1` freezes the eligible frame, frame-time facts, deterministic rank seed,
   exact 180-cluster selection, primary provider/entitlement policy, and H-001 bases before any
   selected outcome is available.
3. `StudyDatasetFreezeV1` binds the collected artifacts, source/market observations, selected or
   typed-missing references, corrections, metrics, attrition, and denominators before any study
   conclusion is calculated.

Each stage names its predecessor; later stages may add results but cannot change a prior semantic
field. A semantic amendment after a selected outcome exists creates a new study, not a new version of
the same study.

## Exact inert-data rule and identities

Every object is exact inert JSON. Unknown/missing/inherited/accessor/symbol/sparse/proxy/cyclic,
duplicate-key, unsafe-integer, non-finite, noncanonical decimal, and invalid timestamp values reject
before recursion, sorting, allocation, hashing, metric evaluation, or partial output.

```text
studyDesignId = "std1_" + H("peas/study-design/v1", {
  designVersion, contractAuthorityRegistryId, acceptedContractIds,
  algorithms, metricDefinitions,
  gateThresholds, missingPolicyId, outlierPolicyId, multiplicityPolicyId,
  correctionPolicyId, sensitivityPolicyId, boundsPolicyId, analysisCodeDigest
})
frameSnapshotId = "sfs1_" + H("peas/study-frame-snapshot/v1", {
  studyDesignId, contractAuthorityRegistryId, samplingFrameAsOfMs,
  calendarSnapshotId, scheduleSourcePolicyId,
  frameConstructionCodeDigest, configurationDigest,
  preFrameEvidenceSnapshotId, rankSeedMaterialId, rankSeedHex,
  seedCommittedAtMs, frameConstructedAtMs, candidates, dispositions
})
clusterCandidateId = "scc1_" + H("peas/event-study-cluster-candidate/v1", {
  scheduleSourceObservationId, issuerMappingId, instrumentId,
  releaseKind, releaseClusterKey,
  plannedFiscalPeriod, plannedReleaseDate, plannedSession
})
studyClusterId = "scl1_" + H("peas/study-cluster/v1", {
  clusterCandidateId, frameSnapshotId, lane, controlGroup,
  strata, rank, allocationCell, selectionFraction
})
studyManifestId = "sfm1_" + H("peas/study-freeze-manifest/v1", {
  studyDesignId, codeCommit, configurationDigest,
  contractAuthorityRegistryId, contractIds,
  calendarSnapshotId, entitlementSnapshotIds, providerSourcePolicyId,
  selectionPolicyId, primaryAnchorKind, alternateAnchorRequired,
  readyAtMs, samplingFrameAsOfMs, freezePublishedAtMs,
  collectionSessions, correctionLagMs, rankSeedMaterialId, rankSeedHex,
  frameSnapshotId, selectedClusters, expectedCounts
})
datasetFreezeId = "sdf1_" + H("peas/study-dataset-freeze/v1", {
  studyManifestId, freezeCutoffMs, collectionCodeCommit,
  collectionConfigurationDigest, executionIds, artifactInventoryDigest,
  sourceObservationIds, revisionIds, marketReferenceJoinKeys,
  referenceResultIds, discrepancyIds, metricRecordIds,
  denominatorAccounting, datasetFreezePolicyVersion
})
```

These are the authoritative preimages from
[`pr-2d-provider-source-identity.md`](pr-2d-provider-source-identity.md). The V1 schema envelopes may
carry the corresponding `expected*Id` only as displayed test evidence. Every displayed ID is
excluded from its own preimage and recomputed; a missing or forged value rejects. Nested
`expectedClusterCandidateId` and `expectedStudyClusterId` values are likewise excluded before the
containing frame or manifest preimage is canonicalized. The validator inserts only their recomputed
IDs where a higher-level preimage explicitly calls for an ID.

`contractAuthorityRegistryId` has exact grammar `car1_` plus 64 lowercase hexadecimal characters
and must recompute from the accepted `ContractAuthorityRegistryV1` using the repository's existing
length-prefixed `canonicalHash`. Its registry has exactly ten entries, one for every literal in
`StudyContractAuthorityIdsV1`, sorted in that tuple order. Each entry binds exact logical ID,
repository path, document SHA-256, Git blob OID, and one common contract-content commit. Both the
design and freeze carry the same recomputed registry ID and exact ten-item tuple; the frame carries
the same ID and inherits the tuple through `studyDesignId`. Missing, extra, duplicate, reordered,
path-only, mutable, or digest/blob/commit-mismatched authority fails before seed or frame work. A
new semantic checkpoint regenerates the registry and every dependent study identity.

Paths, URLs, credentials, raw provider bytes, account facts, page tokens, current wall time, actual
prices, actual latency, provider success, corrections, missingness, and conclusions are excluded
from all pre-outcome identities.

## StudyDesignV1

```ts
type StudyDesignV1 = Readonly<{
  schemaVersion: 1;
  designVersion: string;
  contractAuthorityRegistryId: string;
  acceptedContractIds: StudyContractAuthorityIdsV1;
  algorithms: StudyAlgorithmsV1;
  metricDefinitions: readonly StudyMetricDefinitionV1[];
  gateThresholds: readonly StudyGateThresholdV1[];
  correctionPolicyId: string;
  missingPolicyId: string;
  outlierPolicyId: string;
  multiplicityPolicyId: string;
  sensitivityPolicyId: string;
  boundsPolicyId: string;
  analysisCodeDigest: string;
  expectedStudyDesignId: string;
}>;

type StudyContractAuthorityIdsV1 = readonly [
  "peas/adr-0010/v1",
  "peas/market-acceptance-matrix/v1",
  "peas/market-eligibility/v1",
  "peas/market-fixture-manifest/v1",
  "peas/market-provider-source-identity/v1",
  "peas/market-reason-catalog/v1",
  "peas/market-resource-bounds/v1",
  "peas/market-timestamp-trust/v1",
  "peas/study-freeze-manifest/v1",
  "peas/study-reason-catalog/v1",
];
```

The following definitions close every value inside the `std1_` preimage. Arrays appear in the
literal order stated here; set-like evidence-ID arrays are sorted unique by unsigned UTF-8 bytes.

```ts
type StudyReferenceKindV1 =
  | "quote-nbbo-midpoint"
  | "trade-last-eligible-consolidated"
  | "bar-one-minute-completed-close"
  | "prior-listing-official-close";

type StudyViewKindV1 = "recorded-primary" | "recorded-corrected";

type StudyResultStatusV1 =
  | "selected-complete"
  | "selected-degraded"
  | "missing";

type StudySectorV1 =
  | "agriculture"
  | "mining"
  | "construction"
  | "manufacturing"
  | "transport-communications-utilities"
  | "wholesale"
  | "retail"
  | "finance-insurance-real-estate"
  | "services"
  | "public-administration"
  | "unknown";

type StudyModelFamilyV1 =
  | "standard-operating-company"
  | "digital-asset-treasury"
  | "precommercial-biotech"
  | "bank"
  | "insurer"
  | "equity-reit"
  | "bdc"
  | "commodity-producer"
  | "holding-nav"
  | "discontinuous-history"
  | "unknown";

type StudyAlgorithmsV1 = Readonly<{
  samplingAlgorithmId: "peas-study-sampling-v1";
  framePolicyId: "peas-study-frame-v1";
  scheduleSourcePolicyId: "peas-study-schedule-source-v1";
  releaseClusteringPolicyId: "peas-study-release-clustering-v1";
  shareClassPolicyId: "peas-study-share-class-v1";
  sectorRegistryId: "peas-study-sec-sic-divisions-v1";
  modelFamilyRegistryId: "peas-study-model-families-v1";
  lanePolicyId: "peas-study-lanes-v1";
  controlPolicyId: "peas-study-controls-v1";
  rankPolicyId: "peas-study-rank-v1";
  allocationPolicyId: "peas-study-capacity-hamilton-v1";
  studyReasonCatalogId: "study-reasons-v1";
  studyReasonCatalogDigest: string;
  marketReasonCatalogId: "market-reasons-v1";
  marketReasonCatalogDigest: string;
  primaryAnchorKind: "capture";
  primaryAnchorClaim: "operational-durable-peas-knowledge";
  mandatorySensitivityAnchorKind: "retrieval";
  selectorKind: "last-eligible-at-or-before-target";
  releaseOriginSelectorKind: "last-eligible-strictly-before-publication";
  targetOffsetsNs: readonly ["0", "60000000000", "300000000000", "1800000000000"];
  referenceKinds: readonly [
    "quote-nbbo-midpoint",
    "trade-last-eligible-consolidated",
    "bar-one-minute-completed-close",
    "prior-listing-official-close",
  ];
  viewKinds: readonly ["recorded-primary", "recorded-corrected"];
  resultStatuses: readonly [
    "selected-complete",
    "selected-degraded",
    "missing",
  ];
  quoteAgePolicyId: string;
  sessionPolicyId: string;
  providerPolicyContractId: string;
  bootstrapPolicyId: "peas-study-lane-bootstrap-v1";
  holmPolicyId: "peas-study-holm-24-v1";
  gatePolicyId: "peas-study-gates-v1";
  targetClusters: 180;
  laneTargets: Readonly<{ standard: 120; specialized: 40; prospectiveControl: 20 }>;
  controlTargets: Readonly<{
    identityTransition: 5;
    scheduleUncertain: 5;
    sourceSparse: 5;
    liquidityTail: 5;
  }>;
}>;

type StudyMovementMetricIdV1 =
  | "priorCloseMovementAtFirstObservation"
  | "releaseGapMovement"
  | "residualMovement1m"
  | "residualMovement5m"
  | "residualMovement30m";

type StudyMetricDefinitionV1 =
  | Readonly<{
      metricId: StudyMovementMetricIdV1;
      metricKind: "exact-rational-return-bps";
      priceBasis: "quote-nbbo-midpoint";
      viewKind: "recorded-primary";
      formulaId:
        | "return-bps-cprev-q0"
        | "return-bps-qpre-q0"
        | "return-bps-q0-q1"
        | "return-bps-q0-q5"
        | "return-bps-q0-q30";
      population: "available-case-with-fixed-180-missing-accounting";
      missingTreatment: "no-imputation";
      canonicalValue: "reduced-signed-rational";
      displayRounding: "half-even-6-decimals";
    }>
  | Readonly<{
      metricId: "E1.complete-primary";
      metricKind: "fixed-denominator-proportion";
      successPredicateId: "trusted-anchor-cprev-q0-q1-q5-q30-recorded-primary-complete";
      denominator: 180;
      missingTreatment: "not-success";
    }>
  | Readonly<{
      metricId: "E2.observed-within-15m";
      metricKind: "fixed-denominator-proportion";
      successPredicateId: "latency-upper-ms-lte-900000";
      denominator: 180;
      missingTreatment: "not-success";
    }>
  | Readonly<{
      metricId: "E3.informative-residual-5m";
      metricKind: "fixed-denominator-proportion";
      successPredicateId: "abs-q5-minus-q0-gt-sum-half-spreads";
      denominator: 180;
      missingTreatment: "not-success";
    }>
  | Readonly<{
      metricId: "E4.deterministic-reproduction";
      metricKind: "exact-reproduction-count";
      successPredicateId: "all-required-variants-byte-identical";
      denominator: 180;
      missingTreatment: "failure";
    }>;

type StudyGateThresholdV1 =
  | Readonly<{
      metricId: "E1.complete-primary";
      intervalKind: "wilson-two-sided-95";
      threshold: "0.750000000000000000";
      goComparator: "lower-gte";
      noGoComparator: "upper-lt";
      otherwise: "INCONCLUSIVE";
    }>
  | Readonly<{
      metricId: "E2.observed-within-15m";
      intervalKind: "wilson-two-sided-95";
      threshold: "0.700000000000000000";
      goComparator: "lower-gte";
      noGoComparator: "upper-lt";
      otherwise: "INCONCLUSIVE";
    }>
  | Readonly<{
      metricId: "E3.informative-residual-5m";
      intervalKind: "wilson-two-sided-95";
      threshold: "0.250000000000000000";
      goComparator: "lower-gte";
      noGoComparator: "upper-lt";
      otherwise: "INCONCLUSIVE";
    }>
  | Readonly<{
      metricId: "E4.deterministic-reproduction";
      intervalKind: "none";
      threshold: "180/180";
      goComparator: "equal";
      noGoComparator: "not-equal";
      otherwise: "NO_INCONCLUSIVE_STATE";
    }>;
```

`metricDefinitions` contains exactly the nine rows above sorted by `metricId`; the movement metric
and `formulaId` pairing is one-to-one in the displayed order and any cross-pair rejects.
`gateThresholds` contains exactly the four E1--E4 rows sorted by `metricId`. `StudyReferenceKindV1`,
`StudyViewKindV1`, and `StudyResultStatusV1` are the canonical vocabularies from
[`pr-2d-market-eligibility.md`](pr-2d-market-eligibility.md); shorter fixture/report aliases are not
accepted or mapped during hashing.

## Closed study reason catalog and market-reason preservation

The separate normative authority is the accepted
[`pr-2d-reason-codes.md`](pr-2d-reason-codes.md) catalog ID `study-reasons-v1`, exactly 33 codes.
`StudyDesignV1.algorithms.studyReasonCatalogDigest` is the accepted lowercase SHA-256 of those
catalog bytes. A digest mismatch, unknown study code, retired spelling, wrong detail, disposition,
scope, applicability, or priority rejects as canonical `study.input-invalid`; this document does
not define a competing local code list.

```ts
type CanonicalReasonDetailV1 =
  | null
  | Readonly<{ limitKind: string }>
  | Readonly<{
      sourceFailureKind: "incomplete" | "endpoint-unknown" | "spec-version-unknown";
    }>
  | Readonly<{
      entitlementFailureKind:
        | "unfrozen"
        | "pending"
        | "denied"
        | "scope-mismatch"
        | "zero-spend-violation";
    }>
  | Readonly<{
      artifactFailureKind:
        | "observation-invalid"
        | "digest-mismatch"
        | "size-mismatch"
        | "observation-hash-mismatch"
        | "media-or-encoding-mismatch";
    }>
  | Readonly<{
      providerObservationFailureKind:
        | "schema-invalid"
        | "identity-invalid"
        | "conflicting-content";
    }>
  | Readonly<{
      revisionFailureKind:
        | "orphan"
        | "fork"
        | "cycle"
        | "reused-key"
        | "chain-unresolved"
        | "unsupported-after-cancellation";
    }>
  | Readonly<{
      timestampFailureKind:
        | "missing"
        | "semantic-untrusted"
        | "precision-insufficient"
        | "capture-retrieval-lag-exceeded";
    }>
  | Readonly<{
      sequenceFailureKind: "missing" | "gap" | "equal-time-ambiguous";
    }>
  | Readonly<{
      instrumentFailureKind:
        | "unmapped"
        | "ambiguous"
        | "outside-effective-window"
        | "symbol-continuity-unresolved";
    }>
  | Readonly<{
      coverageFailureKind: "provider-unknown" | "instrument-not-covered";
    }>
  | Readonly<{
      sessionFailureKind:
        | "calendar-missing"
        | "boundary-ambiguous"
        | "timestamp-or-coverage-unknown";
    }>
  | Readonly<{
      tradeConditionFailureKind: "does-not-update-last" | "state-insufficient";
    }>
  | Readonly<{ priorCloseFailureKind: "absent" | "ineligible" }>
  | Readonly<{
      endpointKind:
        | "pre-release"
        | "first-observation"
        | "plus-1m"
        | "plus-5m"
        | "plus-30m"
        | "sensitivity";
    }>
  | Readonly<{
      qualityKind:
        | "locked"
        | "slow"
        | "luld-limit-state"
        | "halt"
        | "stale"
        | "crossed"
        | "one-sided"
        | "condition-ineligible";
    }>
  | Readonly<{
      evidenceQualityKind: "sip-time-only" | "native-sequence-unchecked";
    }>
  | Readonly<{
      frameFailureKind:
        | "snapshot-missing"
        | "snapshot-mutable"
        | "seed-unfrozen"
        | "policy-unfrozen"
        | "contract-unbound";
    }>
  | Readonly<{
      freezeFailureKind: "equal-to-first-outcome" | "after-first-outcome";
    }>
  | Readonly<{
      leakageFieldKind:
        | "actual-release"
        | "price"
        | "latency"
        | "condition"
        | "availability"
        | "correction"
        | "market-result"
        | "post-frame";
    }>
  | Readonly<{
      duplicateFailureKind: "duplicate-identity" | "conflicting-preimage";
    }>
  | Readonly<{ quotaKind: "lane" | "control" | "stratum" }>
  | Readonly<{ rankFailureKind: "seed" | "hash" | "ordering" | "allocation" }>
  | Readonly<{
      providerFreezeKind:
        | "provider"
        | "dataset"
        | "feed"
        | "endpoint"
        | "entitlement"
        | "fallback";
    }>
  | Readonly<{
      anchorFailureKind:
        | "capture-not-primary"
        | "retrieval-not-required"
        | "policy-missing"
        | "retrieved-at-reinterpreted";
    }>
  | Readonly<{
      candidateFailureKind:
        | "schedule"
        | "issuer"
        | "instrument"
        | "fiscal-period"
        | "source-conflict";
    }>
  | Readonly<{
      releaseFailureKind: "cancelled" | "postponed" | "outside-window" | "not-captured";
    }>
  | Readonly<{
      identityChangeKind: "issuer" | "instrument" | "share-class";
    }>
  | Readonly<{ basisKind: "capture" | "retrieval" | "capture-minus-retrieval" }>
  | Readonly<{
      correctionFailureKind:
        | "original-admission"
        | "revision-arrival"
        | "cancellation"
        | "cutoff-evidence";
    }>
  | Readonly<{
      contaminationKind:
        | "issuer-release"
        | "macro-release"
        | "trading-halt"
        | "corporate-action";
    }>;

type StudyReasonV1 = Readonly<{
  code: string;
  disposition: "fatal" | "frame-disposition" | "retained-outcome" | "metric-missing" | "annotation";
  scope: "design" | "frame" | "candidate" | "cluster" | "metric" | "dataset" | "replay";
  detail: CanonicalReasonDetailV1;
  marketResultId: string | null;
  preservedMarketReason: PreservedMarketReasonV1 | null;
}>;

type PreservedMarketReasonV1 = Readonly<{
  code: string;
  disposition: "rejected" | "ineligible" | "missing" | "degraded" | "annotation";
  scope: string;
  detail: CanonicalReasonDetailV1;
}>;
```

The two shapes above are exact envelopes; `code`, `detail`, `disposition`, and `scope` are not free
text because the accepted catalog digest closes their total permitted values and pairings.
Every non-null `detail` has exactly one own direct-key property from
`CanonicalReasonDetailV1`; scalar details, `{field,value}`, inherited/accessor properties,
top-level or parallel detail channels, and a second detail key reject. `limitKind` is one exact
market- or study-scoped bound ID, as selected by `code`, from the accepted
`market-reference-bounds-v1` registry. The accepted reason catalog closes every code to exactly one
detail alternative and exact value; a structurally valid detail paired with the wrong code rejects.
`marketResultId` and `preservedMarketReason` are both null or both non-null. When non-null they must
byte-match the referenced immutable selected/missing market result's canonical market reason. The
seven study codes named by section 5.3 of the catalog require that pair. A study reason never
translates, collapses, or replaces market evidence, and the alias `diagnosticFlags` is forbidden.

The four offsets are exactly T0, +1 minute, +5 minutes, and +30 minutes elapsed UTC. A duplicate,
omitted, reordered, renamed, rounded, or fifth target rejects. Quote, trade, and completed-bar
variants use separate `priceBasis` and metric IDs.

## Authorization and run-calendar gate

A `StudyDesignV1` contract may be accepted while P1-09 is pending, but a run-specific
`StudyFreezeManifestV1` is invalid until all of these are true:

1. ADR 0010/P1-07 and recorded implementation P1-08 have independent exact-SHA `GO` evidence;
2. P1-09 has a human-approved and independently reviewed `GO` entitlement snapshot for the exact
   provider/dataset/feed/use; pending, denied, expired, or not-authorized capabilities fail closed;
3. P1-10 and P1-06 have their required acceptance evidence;
4. primary provider, dataset, feed, endpoint, entitlement, correction representation, and fallback
   policy are immutable and zero-incremental-spend; and
5. the freeze contains no selected event outcome.

FMP or any other source cannot become fallback because the primary is absent. Any fallback that
materially changes SIP/NBBO semantics requires a pre-outcome contract amendment and fresh review.

Let `readyAtMs` be the maximum independently published acceptance time of those gates. With the
frozen calendar:

- `S1` is the first regular session whose open is strictly after `readyAtMs`;
- `samplingFrameAsOfMs` is the official regular close of `S5`;
- the reviewed freeze must be published strictly before the open of `S6`;
- collection begins at the open of `S15`; and
- collection spans exactly 65 regular sessions, `S15..S79` inclusive, ending after the authorized
  post-market interval for `S79`.

If quotas cannot be filled, collection does not start. A started run is never extended and no later
frame replaces attrited clusters.

## Non-tunable rank-seed derivation

The seed is derived, never supplied. First close the complete immutable pre-frame evidence snapshot:

```text
preFrameEvidenceSnapshotId = "pfe1_" + H("peas/study-pre-frame-evidence/v1", {
  contractAuthorityRegistryId, studyDesignId, samplingFrameAsOfMs,
  calendarSnapshotId, scheduleSourcePolicyId,
  frameConstructionCodeDigest, configurationDigest,
  sourceObservationIds, artifactInventoryDigest
})

rankSeedMaterialId = "rsm1_" + H("peas/study-rank-seed-material/v1", {
  contractAuthorityRegistryId, studyDesignId, samplingFrameAsOfMs,
  calendarSnapshotId, scheduleSourcePolicyId,
  frameConstructionCodeDigest, configurationDigest,
  preFrameEvidenceSnapshotId
})

rankSeedHex = H("peas/study-rank-seed/v1", {rankSeedMaterialId})
```

`H` is the repository length-prefixed `canonicalHash`; every shown object is RFC 8785 canonical
inert JSON. `sourceObservationIds` is the complete sorted-unique set admitted by the frozen
schedule/issuer/instrument/market-cap/liquidity evidence policies at
`samplingFrameAsOfMs`; omission or addition changes the snapshot ID and fails complete-frame
reconciliation. `artifactInventoryDigest` binds the complete verified artifact inventory, not a
path or caller declaration.

`rankSeedHex` is exactly 64 lowercase hexadecimal characters with no `0x`, representing 32 bytes.
`rankSeedBytes[k]` is the integer encoded by characters `2k,2k+1`, for `k=0..31`; uppercase, odd
length, nonhex, or alternate text/byte conversion rejects. The material record is durably committed
after the pre-frame snapshot closes and strictly before any candidate list, stratum, rank, or
allocation is emitted: `samplingFrameAsOfMs <= seedCommittedAtMs < frameConstructedAtMs`. The
durable stamp is timing evidence and does not enter either seed hash, so waiting cannot tune the
seed. `frameConstructedAtMs` must be before the first selected outcome and no later than
`freezePublishedAtMs`.

The frame and manifest carry identical `contractAuthorityRegistryId`, `rankSeedMaterialId`, and
`rankSeedHex`; the frame additionally carries the snapshot and timing evidence. Validators
recompute all three IDs before ranking. Changing any registry/evidence/calendar/code/config input
changes the material, seed, frame, cluster, and manifest identities. Reusing a seed under different
material or trying multiple seeds for one material is `study.rank-invalid` with
`rankFailureKind:seed`.

## StudyFreezeManifestV1

```ts
type StudyFreezeManifestV1 = Readonly<{
  schemaVersion: 1;
  studyDesignId: string;
  codeCommit: string;
  configurationDigest: string;
  contractAuthorityRegistryId: string;
  contractIds: StudyContractAuthorityIdsV1;
  calendarSnapshotId: string;
  entitlementSnapshotIds: readonly string[];
  providerSourcePolicyId: string;
  selectionPolicyId: string;
  primaryAnchorKind: "capture";
  alternateAnchorRequired: true;
  readyAtMs: number;
  samplingFrameAsOfMs: number;
  freezePublishedAtMs: number;
  collectionSessions: readonly string[];
  correctionLagMs: 604800000;
  rankSeedMaterialId: string;
  rankSeedHex: string;
  frameSnapshotId: string;
  selectedClusters: readonly StudyClusterFreezeEntryV1[];
  expectedCounts: Readonly<{
    targetClusters: 180;
    laneTargets: Readonly<{ standard: 120; specialized: 40; prospectiveControl: 20 }>;
    controlTargets: Readonly<{
      identityTransition: 5;
      scheduleUncertain: 5;
      sourceSparse: 5;
      liquidityTail: 5;
    }>;
  }>;
  expectedStudyManifestId: string;
}>;
```

`providerSourcePolicyId` binds the exact primary and any explicitly authorized lower-evidence
fallback. A fallback is legal only when its entitlement snapshot and accepted ADR name it before
this freeze. While P1-09 remains pending, no run manifest can validate with any provider-source
policy. `collectionSessions` is the exact sorted 65-session `S15..S79` sequence; start/end aliases
are not substituted into the preimage.

## Frame and T-1 separation

```ts
type StudyFrameSnapshotV1 = Readonly<{
  schemaVersion: 1;
  studyDesignId: string;
  contractAuthorityRegistryId: string;
  samplingFrameAsOfMs: number;
  calendarSnapshotId: string;
  scheduleSourcePolicyId: "peas-study-schedule-source-v1";
  frameConstructionCodeDigest: string;
  configurationDigest: string;
  preFrameEvidenceSnapshotId: string;
  rankSeedMaterialId: string;
  rankSeedHex: string;
  seedCommittedAtMs: number;
  frameConstructedAtMs: number;
  candidates: readonly StudyCandidateFrameEntryV1[];
  dispositions: readonly FrameDispositionCountV1[];
  expectedFrameSnapshotId: string;
}>;

type StudyCandidateFrameEntryV1 = Readonly<{
  scheduleSourceObservationId: string;
  releaseClusterKey: string;
  releaseKind: "quarterly" | "annual";
  clusterBasis: StudyReleaseClusterBasisV1;
  scheduleSourceEvidence: readonly StudyScheduleSourceEvidenceV1[];
  issuerMappingId: string;
  instrumentId: string;
  plannedFiscalPeriod: string | null;
  plannedReleaseDate: string;
  plannedSession: "pre-market" | "regular" | "post-market" | "overnight-or-closed" | "unknown";
  frameFacts: Readonly<{
    subject: string;
    shareClassSelection: StudyShareClassSelectionV1;
    eventTMinusOneSnapshotPolicyId: string;
    scheduleDisagreement: Readonly<{ date: boolean; session: boolean }>;
    identityTransitionKnown: boolean;
    identityTransitionEvidenceObservationIds: readonly string[];
    sicCode: string | null;
    sicDivisionCode: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | null;
    sicAuthorityObservationId: string | null;
    sicMappingVersion: "sec-sic-division-v1";
    sectorStratum: StudySectorV1;
    marketCapEvidence: StudyMarketCapEvidenceV1;
    marketCapStratum: "low" | "mid" | "high" | "unknown";
    liquidityEvidence: StudyLiquidityEvidenceV1;
    liquidityStratum: "low" | "mid" | "high" | "unknown";
    modelFamily: StudyModelFamilyV1;
    modelFamilyAuthority:
      | "issuer-filing"
      | "regulatory-classification"
      | "project-reviewed-mapping"
      | "unknown";
    modelFamilyVersion: string;
    modelFamilyEffectiveAtMs: number;
    modelFamilyEvidenceObservationIds: readonly string[];
    expectedSourceFamilies: readonly (
      | "issuer-regulatory-filing"
      | "issuer-ir-calendar"
      | "exchange-calendar"
      | "approved-schedule-provider"
    )[];
    marketReferenceJoinPolicyId: string;
    intervalKeys: readonly ["Cprev", "Qpre", "Q0", "Q1", "Q5", "Q30"];
    referenceKinds: readonly [
      "quote-nbbo-midpoint",
      "trade-last-eligible-consolidated",
      "bar-one-minute-completed-close",
      "prior-listing-official-close",
    ];
  }>;
  expectedClusterCandidateId: string;
}>;

type StudyReleaseClusterBasisV1 =
  | Readonly<{
      kind: "fiscal-period";
      plannedFiscalPeriod: string;
    }>
  | Readonly<{
      kind: "cross-source";
      crossSourceReleaseKeyHash: string;
    }>
  | Readonly<{
      kind: "native-date";
      plannedReleaseDate: string;
      nativeScheduleIdHash: string;
    }>;

type StudyScheduleSourceEvidenceV1 = Readonly<{
  sourceFamily:
    | "issuer-regulatory-filing"
    | "issuer-ir-calendar"
    | "exchange-calendar"
    | "approved-schedule-provider";
  precedenceOrdinal: 0 | 1 | 2 | 3;
  scheduleSourceObservationId: string;
  sourceRevisionId: string | null;
  nativeScheduleIdHash: string;
  crossSourceReleaseKeyHash: string | null;
  durablyCapturedAtMs: number;
  effectiveAtMs: number | null;
  nativeRevisionSequence: string | null;
  issuerMappingId: string;
  releaseKind: "quarterly" | "annual";
  plannedFiscalPeriod: string | null;
  plannedReleaseDate: string;
  plannedSession: "pre-market" | "regular" | "post-market" | "overnight-or-closed" | "unknown";
}>;

type StudyExactDecimalV1 = Readonly<{
  coefficient: string;
  scale: number;
  negative: false;
}>;

type StudyExactRationalV1 = Readonly<{
  numerator: string;
  denominator: string;
}>;

type StudyMarketCapEvidenceV1 = Readonly<{
  policyId: "peas-study-market-cap-v1";
  asOfSession: string;
  asOfNs: string;
  priceReferenceKind: "prior-listing-official-close";
  priceViewKind: "recorded-primary";
  priceMarketResultId: string;
  priceResultStatus: "selected-complete" | "selected-degraded" | "missing";
  price: StudyExactDecimalV1 | null;
  sharesOutstanding: StudyExactDecimalV1 | null;
  sharesValueDate: string | null;
  sharesEffectiveAtNs: string | null;
  sharesSourceObservationId: string | null;
  sharesAuthorityVersion: string | null;
  sharesDurablyCapturedAtMs: number | null;
  marketCap: StudyExactRationalV1 | null;
  unknownKind:
    | null
    | "price-missing"
    | "shares-missing"
    | "shares-after-frame"
    | "authority-unknown"
    | "nonpositive-or-overflow";
  stratum: "low" | "mid" | "high" | "unknown";
  comparisonRank: number | null;
  comparisonPopulationSize: number;
}>;

type StudyLiquiditySessionEvidenceV1 = Readonly<{
  sessionId: string;
  sessionCloseNs: string;
  closeMarketResultId: string;
  closeResultStatus: "selected-complete" | "selected-degraded" | "missing";
  closePrice: StudyExactDecimalV1 | null;
  regularSessionVolume: StudyExactDecimalV1 | null;
  volumeFactId: string | null;
  volumeSourceObservationId: string | null;
  volumeAuthorityVersion: "consolidated-regular-session-volume-v1" | null;
  dollarVolume: StudyExactRationalV1 | null;
  status: "valid" | "missing";
  missingKind:
    | null
    | "close-missing"
    | "volume-missing"
    | "nonpositive-or-overflow"
    | "after-frame"
    | "authority-unknown";
}>;

type StudyLiquidityEvidenceV1 = Readonly<{
  policyId: "peas-study-liquidity-20-session-median-v1";
  asOfSession: string;
  sessions: readonly StudyLiquiditySessionEvidenceV1[];
  validSessionCount: number;
  medianDollarVolume: StudyExactRationalV1 | null;
  stratum: "low" | "mid" | "high" | "unknown";
  comparisonRank: number | null;
  comparisonPopulationSize: number;
  tailRank: number | null;
  tailPopulationSize: number | null;
  tailEligible: boolean;
}>;

type StudyShareClassCandidateV1 = Readonly<{
  instrumentId: string;
  securityKind: "common-share" | "supported-adr";
  usExchangeListed: true;
  liquiditySessions: readonly StudyLiquiditySessionEvidenceV1[];
  validLiquiditySessionCount: number;
  medianDollarVolume: StudyExactRationalV1 | null;
}>;

type StudyShareClassSelectionV1 = Readonly<{
  policyId: "peas-study-share-class-v1";
  candidates: readonly StudyShareClassCandidateV1[];
  selectedInstrumentId: string;
}>;

type FrameDispositionCountV1 = Readonly<{
  disposition:
    | "eligible"
    | "study.frame-candidate-invalid"
    | "study.instrument-out-of-scope"
    | "study.share-class-not-selected";
  reason: StudyReasonV1 | null;
  count: number;
  members: readonly Readonly<{
    scheduleSourceObservationId: string;
    issuerMappingId: string | null;
    instrumentId: string | null;
    clusterCandidateId: string | null;
  }>[];
}>;

type StudyClusterFreezeEntryV1 = Readonly<{
  clusterCandidateId: string;
  frameSnapshotId: string;
  lane: "standard" | "specialized" | "prospective-control";
  controlGroup:
    | "identity-transition"
    | "schedule-uncertain"
    | "source-sparse"
    | "liquidity-tail"
    | null;
  strata: Readonly<{
    sector: StudySectorV1;
    marketCap: "low" | "mid" | "high" | "unknown";
    liquidity: "low" | "mid" | "high" | "unknown";
    plannedSession: "pre-market" | "regular" | "post-market" | "overnight-or-closed" | "unknown";
    modelFamily: StudyModelFamilyV1;
  }>;
  rank: string;
  allocationCell: Readonly<{
    allocationCellId: string;
    cellFrameCount: number;
    cellSelectedCount: number;
  }>;
  selectionFraction: Readonly<{ numerator: string; denominator: string }>;
  expectedStudyClusterId: string;
}>;
```

The eight fields in the displayed `scc1_` formula are its complete preimage field set. In particular,
`releaseKind` and the recomputed `releaseClusterKey` are semantic identity inputs; neither may be
inferred from, replaced by, or omitted because of `scheduleSourceObservationId`. `clusterBasis` and
`scheduleSourceEvidence` are validation evidence in the containing `sfs1_` preimage and bind
`scc1_` through the mandatory key recomputation below.

The six cluster fields above are the complete `scl1_` preimage; no unnamed or indirect preimage
alias is accepted. `expectedFrameSnapshotId`, `expectedClusterCandidateId`,
`expectedStudyClusterId`, and `expectedStudyManifestId` are displayed evidence only and are stripped
before canonicalization. The manifest's `selectedClusters` member therefore hashes the sorted
ID-free `StudyClusterFreezeEntryV1` preimages, after validating their recomputed candidate, frame,
and cluster IDs.

### Schedule-source precedence, revisions, and release clustering

`peas-study-schedule-source-v1` has exactly four families and fixed precedence: issuer regulatory
filing `0`, issuer IR calendar `1`, exchange calendar `2`, and an explicitly accepted schedule
provider `3`. Family and ordinal must match. This is evidence precedence, not entitlement or market
provider fallback. Every retained source schedule item must have durable capture
`<=samplingFrameAsOfMs` and appears once in `scheduleSourceEvidence`. One acquisition observation
may contain multiple items; its observation ID is not an item or cluster identity. Rows sort by
numeric `precedenceOrdinal` ascending, then unsigned UTF-8 over `scheduleSourceObservationId`,
`nativeScheduleIdHash`, `releaseKind`, nullable `plannedFiscalPeriod`, `plannedReleaseDate`,
`plannedSession`, and nullable `crossSourceReleaseKeyHash`, with null before every string, then by
the RFC 8785 bytes of the complete row. Duplicate rows or two rows with the same complete
item/revision identity and conflicting canonical content reject.

Within one `{sourceFamily,nativeScheduleIdHash}`, accept the greatest canonical non-negative
`nativeRevisionSequence` when every revision supplies it. Otherwise accept the greatest
`effectiveAtMs`, treating null as less than every integer, then greatest `durablyCapturedAtMs`, then
smallest `scheduleSourceObservationId`. A reused stable revision identity with conflicting canonical
content, a fork, or a cycle receives canonical `study.frame-candidate-invalid` with
`candidateFailureKind:source-conflict`; arrival and array order never break the tie.

Clustering occurs before share-class selection:

1. validate issuer mapping, release kind, date, session, and fiscal-period grammar;
2. encode fiscal period only as `YYYY-Q1` through `YYYY-Q4`, `YYYY-FY`, or null; a non-null
   quarterly period must be `YYYY-Q1` through `YYYY-Q4`, a non-null annual period must be
   `YYYY-FY`, and cross-kind forms reject;
3. when fiscal period is non-null, group exact
   `{issuerMappingId,releaseKind,plannedFiscalPeriod}`; a date/session disagreement stays one cluster
   and sets the two `scheduleDisagreement` booleans;
4. when fiscal period is null, group only observations with the same non-null
   `crossSourceReleaseKeyHash`; if that key is absent, only exact
   `{issuerMappingId,releaseKind,plannedReleaseDate,nativeScheduleIdHash}` duplicates collapse;
5. two null-period groups for one issuer/release kind/date that cannot prove sameness receive
   `study.frame-candidate-invalid` with `candidateFailureKind:fiscal-period`, rather than being
   guessed into one release;
6. incompatible non-null fiscal periods under one `crossSourceReleaseKeyHash` receive the same
   canonical fiscal-period disposition; and
7. a restatement or later release with a different validated fiscal period remains distinct and is
   never merged after outcomes.

For each cluster, `scheduleSourceEvidence` is nonempty and contains exactly its contributing,
retained-revision rows, not every item from their containing observations. Every row has the
candidate's exact `issuerMappingId` and `releaseKind` and satisfies exactly one selected basis:

- `fiscal-period`: candidate and every row have the same non-null `plannedFiscalPeriod`, with the
  release-kind grammar above; `clusterBasis` has exactly
  `{kind:"fiscal-period",plannedFiscalPeriod}`;
- `cross-source`: candidate and every row have `plannedFiscalPeriod:null` and the same non-null
  `crossSourceReleaseKeyHash`; `clusterBasis` has exactly
  `{kind:"cross-source",crossSourceReleaseKeyHash}`; or
- `native-date`: candidate and every row have `plannedFiscalPeriod:null`,
  `crossSourceReleaseKeyHash:null`, the same `plannedReleaseDate`, and the same
  `nativeScheduleIdHash`; `clusterBasis` has exactly
  `{kind:"native-date",plannedReleaseDate,nativeScheduleIdHash}`.

The alternatives are selected in the displayed precedence and are exact disjoint shapes. A field
from another alternative, an unrelated evidence row, a mixed kind/issuer/basis, an empty
contributor set, or a caller-selected lower-precedence basis rejects before candidate hashing.
Every `nativeScheduleIdHash` and non-null `crossSourceReleaseKeyHash` used by these shapes is exactly
64 lowercase hexadecimal characters representing its raw 32-byte digest.

The cluster representative is the contributing row with lowest precedence ordinal, then greatest
effective time with null less than every integer, greatest durable capture, smallest
`scheduleSourceObservationId`, smallest `nativeScheduleIdHash`, then smallest canonical nullable
`crossSourceReleaseKeyHash` with null before every string, all string comparisons by unsigned UTF-8
bytes, then smallest RFC 8785 bytes of the complete row. Candidate `scheduleSourceObservationId`,
`issuerMappingId`, `releaseKind`,
`plannedFiscalPeriod`, `plannedReleaseDate`, and `plannedSession` byte-match that representative.
Thus multiple schedule items inside one observation remain independently representable even though
they share `scheduleSourceObservationId`.

`releaseClusterKey` is exactly 64 lowercase hexadecimal characters and equals raw SHA-256, without
a prefix or repository length framing, of the RFC 8785 bytes for the exact three-key object
`{issuerMappingId,releaseKind,clusterBasis}`. Validators first select and validate the basis and
representative, recompute this key, and only then recompute the exact eight-field `scc1_` preimage.
The candidate's `releaseKind` and `releaseClusterKey` must equal those recomputed values; no
displayed or supplied key is trusted.

`sfs1_` hashes the complete validated candidate evidence, including kind, key, basis, and
contributors, after `scc1_` recomputation succeeds. `scl1_` binds that `scc1_` and `sfs1_`;
`sfm1_` binds the frame and the selected `scl1_` entries; a later `sdf1_` binds that `sfm1_` through
`studyManifestId`. Changing kind, basis, representative item, or contributing evidence therefore
changes `scc1_` and/or `sfs1_`, and every dependent selected cluster, manifest, and dataset identity
must be regenerated. A stale downstream identity, a mutation that leaves an identity unchanged, or
a candidate ID reused for a different validated cluster rejects. Exact duplicate candidate IDs are
fatal
`study.duplicate-cluster` with `duplicateFailureKind:duplicate-identity`; conflicting preimages use
`conflicting-preimage`. A provider delivery is never a second candidate.

### Literal cluster-candidate identity vectors

All rows below use these exact common candidate fields:

```text
scheduleSourceObservationId =
  "aob1_0000000000000000000000000000000000000000000000000000000000000000"
issuerMappingPreimage = {
  issuerCik:"0000000001",
  symbols:["PEAS"],
  selectedSymbol:"PEAS",
  mappingAuthority:"peas-synthetic-fixture",
  mappingVersion:"v1",
  effectiveFromMs:0,
  effectiveToMs:null
}
issuerMappingId =
  "imap1_b5fb4ba66e0c0db04d272e66bcfd071e46fe343be06487bb76c892834958441e"
instrumentPreimage = {
  issuerMappingId:
    "imap1_b5fb4ba66e0c0db04d272e66bcfd071e46fe343be06487bb76c892834958441e",
  securityAuthority:"peas-synthetic",
  securityKey:"fictional-common-1",
  issueType:"common-share",
  shareClass:"A",
  primaryListingVenueCode:"XNAS",
  currency:"USD",
  roundLotSize:100,
  effectiveFromNs:"0",
  effectiveToNs:null,
  predecessorInstrumentId:null,
  transitionReason:null
}
instrumentId =
  "min1_e9356093916724ade802248d445ca057c3667b74cb09a06fe34c01767f807fc3"
plannedReleaseDate = "2027-02-03"
plannedSession = "pre-market"
```

The primitives above are original project-authored synthetic data.
`issuerMappingId` recomputes as
`"imap1_" + canonicalHash("peas/issuer-mapping/v1",issuerMappingPreimage)`;
`instrumentId` recomputes as
`"min1_" + canonicalHash("peas/market-instrument/v1",instrumentPreimage)`.
Both primitive preimages validate completely before any release-cluster or candidate hash is
attempted; a prefix-only or forged digest is not an accepted vector input.

`releaseClusterKey` uses the raw RFC-8785 SHA-256 rule above. `clusterCandidateId` uses repository
length-prefixed `canonicalHash("peas/event-study-cluster-candidate/v1", preimage)` over the exact
eight-field preimage. The expected literals are:

| Vector | `releaseKind`; `clusterBasis`; `plannedFiscalPeriod` | Expected `releaseClusterKey` | Expected `clusterCandidateId` |
| --- | --- | --- | --- |
| `SCC-Q-X-A` | `quarterly`; `{kind:"cross-source",crossSourceReleaseKeyHash:"3333333333333333333333333333333333333333333333333333333333333333"}`; null | `760e1a706fd2a029bf6c2be35713f6055a58ccb03b38346a37b6a17e1c160dad` | `scc1_23a3ce22af13c273284dcc55f2a2f98e71d8ee33039d896b34789e26fc51a29c` |
| `SCC-A-X-A` | `annual`; `{kind:"cross-source",crossSourceReleaseKeyHash:"3333333333333333333333333333333333333333333333333333333333333333"}`; null | `f187d8d01fdeb210ec1f201f155dfdfa17edf9e26f0cf2018788559170b05acc` | `scc1_9d065ec03ea039dbfe4a979a91903706f93fe8d8d58a177365fa5d702139e898` |
| `SCC-Q-X-B` | `quarterly`; `{kind:"cross-source",crossSourceReleaseKeyHash:"4444444444444444444444444444444444444444444444444444444444444444"}`; null | `f8d55d7faab94cb219a6be507859ffdb38f5c4ba47221a3500a69b59f92243f6` | `scc1_e1e29e6b3a530fcaf740d74460e19c09b7f617b14d0dda169555a9e6a32ee602` |
| `SCC-Q-N-A` | `quarterly`; `{kind:"native-date",plannedReleaseDate:"2027-02-03",nativeScheduleIdHash:"5555555555555555555555555555555555555555555555555555555555555555"}`; null | `0b6220f62e090fcf1dbab51c9a6f1e67cea26a6b24536a940839e41254501a0d` | `scc1_f1978744380df6d88f5c04b45d28dfe5744f00d4bec9dfa4f3212e4932aa04d8` |
| `SCC-Q-N-B` | `quarterly`; `{kind:"native-date",plannedReleaseDate:"2027-02-03",nativeScheduleIdHash:"6666666666666666666666666666666666666666666666666666666666666666"}`; null | `e821fcc567119d5a7a4beec2f592594c29489e1ab5210cfc36492484d9d1a866` | `scc1_ff342e0d714128058f7b0c60bd3961d41b91cc90992e3dd5596be9ec7fe70c8e` |
| `SCC-Q-F-A` | `quarterly`; `{kind:"fiscal-period",plannedFiscalPeriod:"2027-Q1"}`; `"2027-Q1"` | `ad7cb2c98df8c571669552d26826b4d99a99daf48917be02e3bdbd3e4680e7ea` | `scc1_44c9c8a19d0ceb40a2e0e27ac574a4c9a9559a040dc72dad625ef16cdecddc38` |
| `SCC-Q-N-C` | `quarterly`; `{kind:"native-date",plannedReleaseDate:"2027-02-03",nativeScheduleIdHash:"7777777777777777777777777777777777777777777777777777777777777777"}`; null | `7dac1d974db6c72a5a0c59ab3e651b5c9a1bedf3b56fd217f7125545c88d0374` | `scc1_aff6232f2aac45822feabd9336e4729804959b04d99ad9d1588231a4a4229a87` |

The same-observation evidence vector places all seven items in the one synthetic observation named
above. Each candidate's `scheduleSourceEvidence` retains its corresponding exact item. Every item
uses `sourceFamily:"issuer-ir-calendar"`, `precedenceOrdinal:1`, `sourceRevisionId:null`,
`durablyCapturedAtMs:1800000000000`, `effectiveAtMs:1800000000000`,
`nativeRevisionSequence:"1"`, the common issuer/date/session, and its table release kind/period.
Its remaining exact hashes are:

| Vector | Evidence `nativeScheduleIdHash` | Evidence `crossSourceReleaseKeyHash` |
| --- | --- | --- |
| `SCC-Q-X-A` | `8888888888888888888888888888888888888888888888888888888888888888` | `3333333333333333333333333333333333333333333333333333333333333333` |
| `SCC-A-X-A` | `9999999999999999999999999999999999999999999999999999999999999999` | `3333333333333333333333333333333333333333333333333333333333333333` |
| `SCC-Q-X-B` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` | `4444444444444444444444444444444444444444444444444444444444444444` |
| `SCC-Q-N-A` | `5555555555555555555555555555555555555555555555555555555555555555` | null |
| `SCC-Q-N-B` | `6666666666666666666666666666666666666666666666666666666666666666` | null |
| `SCC-Q-F-A` | `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` | null |
| `SCC-Q-N-C` | `7777777777777777777777777777777777777777777777777777777777777777` | null |

As a regression witness, projecting either `SCC-Q-X-A` or `SCC-A-X-A` onto the retired six fields
`{scheduleSourceObservationId,issuerMappingId,instrumentId,plannedFiscalPeriod,plannedReleaseDate,plannedSession}`
produces the same retired hash
`scc1_3dedd976378f6b5a8fb86477f3518ed9c62068ac4a697dd2eaba2c2c8b233f0b`.
The accepted eight-field preimages instead produce the pinned distinct
`scc1_23a3ce22af13c273284dcc55f2a2f98e71d8ee33039d896b34789e26fc51a29c` and
`scc1_9d065ec03ea039dbfe4a979a91903706f93fe8d8d58a177365fa5d702139e898`.
Validators reject the retired projection and never accept its hash as a V1 candidate identity.

The executable vector set proves:

- `SCC-Q-X-A` versus `SCC-A-X-A` isolates quarterly/annual kind under the same observation and
  cross-source key;
- `SCC-Q-X-A` versus `SCC-Q-X-B` isolates two non-null cross-source keys;
- `SCC-Q-N-A` versus `SCC-Q-N-B` isolates two native schedule item IDs;
- `SCC-Q-F-A` versus `SCC-Q-N-C` distinguishes fiscal-period and native-date basis selection; and
- all seven rows can originate as separate schedule items inside the same acquisition observation;
  accepted evidence membership and the recomputed cluster key, not observation uniqueness, decide
  whether they form one or multiple clusters.

Every displayed pair has distinct key and candidate ID. Mutating `releaseKind`, basis kind, basis
value, representative item, or planned fiscal period while retaining an old key rejects the
cross-field check; recomputing the key must produce the corresponding distinct candidate ID.
Substituting fiscal/cross/native fields across alternatives, adding an unrelated same-observation
item, or collapsing two rows merely because their observation IDs match rejects. For each accepted
mutation in an otherwise byte-identical frame, tests also assert changed `sfs1_`, changed `scl1_`,
changed `sfm1_`, and changed later `sdf1_`; retaining any old downstream ID rejects.

### Market-cap and liquidity evidence

All decimal coefficients are canonical nonzero ASCII digits without leading zero, scales are
non-negative safe integers within the resource policy, and values used here are positive.
Rationals use signed canonical numerator text, positive denominator text, and are reduced by GCD;
binary floating point is forbidden.

Market cap uses the selected instrument's last eligible `prior-listing-official-close` from
`recorded-primary` whose official session close is at or before the S5 frame close, plus the latest
authoritative shares-outstanding fact with effective time and durable capture both
`<=samplingFrameAsOfMs`. The price market result must be selected/missing and byte-reconcile with
the recorded market result. The shares fact binds exact value date, effective time, source
observation, authority version, and durable capture. When both values are valid,
`marketCap = price * sharesOutstanding` as a reduced rational and `unknownKind:null`; every known
field is non-null. Otherwise `marketCap:null`, `stratum:"unknown"`, and exactly one matching
`unknownKind`; unavailable shares authority fields are null, never guessed. `marketCapStratum` must
equal `marketCapEvidence.stratum`.

Liquidity contains exactly the 20 consecutive frozen regular sessions ending with S5, oldest to
newest, with no duplicate or skipped session. Every row binds the official close time, immutable
close market result, exact regular-session consolidated volume fact, source observation, and
authority version. A valid row has selected close status, positive close/volume, non-null evidence,
exact reduced `dollarVolume=close*volume`, `status:"valid"`, and `missingKind:null`. Every other row
has `dollarVolume:null`, `status:"missing"`, and one exact missing kind; it cannot be repaired from a
later, extended-hours, provider-summary, or different-instrument fact. `validSessionCount` equals
the valid-row count. At 15..20 valid rows, median is the exact middle value or rational mean of the
two middle values; at 0..14 it is null and stratum unknown with canonical
`study.liquidity-unknown`. `liquidityStratum` must equal `liquidityEvidence.stratum`.

### Deterministic share-class selection

For each cluster, retain only supported U.S.-exchange-listed common shares and explicitly supported
ADRs. Every other security receives canonical `study.instrument-out-of-scope`. For each supported
candidate calculate the exact median of `close*volume` over the same 20 regular sessions ending at
the frame snapshot through its complete `liquiditySessions`. Fewer than 15 valid sessions gives
`medianDollarVolume:null` and canonical
`study.liquidity-unknown`; it never borrows another share class's value.

Known median numerator is canonical non-negative decimal integer text, denominator is canonical
positive decimal integer text, and the fraction is reduced. `validLiquiditySessionCount` is 0..20
and must agree with the retained session evidence.

Sort candidates by known median before null, known median descending by exact rational comparison,
then `instrumentId` ascending by unsigned UTF-8 bytes. The first wins, even when every median is
null. Every loser receives `study.share-class-not-selected`; the reason contract intentionally
carries no selected-instrument detail, so the winner remains typed evidence in
`StudyShareClassSelectionV1`. Post-freeze liquidity, listing, symbol, or ADR-ratio changes cannot
revise it.

The immutable `StudyFrameSnapshotV1` is the only source for selection, lane, strata, ranking, and
allocation. The
per-event `eventTMinusOneSnapshot` is captured at the previous regular-session close and is added
only in the dataset freeze as a drift/quality annotation. It cannot change cluster ID, membership,
lane, rank, allocation, provider, threshold, or denominator. This prevents early outcomes from
influencing later T-1 selection.

The frame contains every prospectively scheduled quarterly/annual release in `S15..S79` known at
frame time with a deterministic schedule observation, issuer mapping, and supported U.S.-listed
common-share/ADR instrument candidate. Unsupported instruments, invalid candidates, duplicate
share-class alternatives, and other dispositions remain counted in the frame snapshot's
`dispositions` member.

`dispositions` has exactly one row for each represented disposition, sorted by disposition code;
`members` is sorted by canonical nullable
`{scheduleSourceObservationId,issuerMappingId,instrumentId,clusterCandidateId}`, and `count` equals
its length. Every raw frame member appears in exactly one row. `eligible` requires `reason:null`;
each other row requires the exact canonical `StudyReasonV1` with disposition `frame-disposition`,
scope `candidate`, null market preservation, and matching code. Missing, extra, duplicate, or
cross-row member evidence rejects before rank generation.

## Prospective lane/control assignment

### Frozen sampling registries

`peas-study-sec-sic-divisions-v1` maps accepted SEC division codes exactly: `A` agriculture, `B`
mining, `C` construction, `D` manufacturing, `E` transport-communications-utilities, `F`
wholesale, `G` retail, `H` finance-insurance-real-estate, `I` services, and `J`
public-administration. A missing, invalid, conflicting, or unmapped four-ASCII-digit SIC or division
becomes `unknown`; no issuer name or model label substitutes. The exact SIC, division, authority
observation, mapping version, and sector must agree, and the authority observation's durable capture
must be `<=samplingFrameAsOfMs`.

`peas-study-model-families-v1` contains exactly `standard-operating-company`, the nine specialized
labels `digital-asset-treasury`, `precommercial-biotech`, `bank`, `insurer`, `equity-reit`, `bdc`,
`commodity-producer`, `holding-nav`, and `discontinuous-history`, plus `unknown`. Authority
precedence is issuer filing, regulatory classification, project-reviewed mapping, then unknown.
Evidence must name the authority, version, effective time `<=samplingFrameAsOfMs`, and sorted unique
observation IDs. Conflicting equal-precedence labels become `unknown`. A non-control candidate with
one of the nine labels enters the specialized pool; `standard-operating-company` or `unknown`
enters the standard pool, with unknown retained as its own descriptive stratum. This label is never
model, trade, or financial-effect eligibility.

### Prospective controls

Assign one control-eligibility group from frame-time evidence in this strict priority:

1. `identity-transition`: documented symbol/listing/share-class/split/merger/spin/ADR-ratio change
   effective in the 180 calendar days ending on the planned release date or already announced
   effective through that date; `identityTransitionKnown` must have nonempty accepted evidence;
2. `schedule-uncertain`: planned session is unknown or either frozen schedule-disagreement boolean
   is true;
3. `source-sparse`: at most one authoritative earnings-source family expected;
4. `liquidity-tail`: known frame liquidity lies in the bottom decile after earlier controls.

`identityTransitionKnown:true` requires at least one sorted unique evidence observation;
`false` requires an empty array. All evidence must be durably captured by frame time.

Compute the one group for every candidate before selection. Within each group sort by the common
`rankDigest`, then `clusterCandidateId`, and select the first five. Fewer than five in any group is
`study.quota-insufficient` with `quotaKind:control`; no other group backfills it. Oversubscribed
members after the first five return to their natural specialized/standard pool; they do not receive
a second control eligibility. The 20 winners are removed before lane allocation. An event-time
halt, missing/stale/crossed quote, price move, correction, provider failure, or concurrent event can
never recruit a control.

All evidence-ID arrays in the registries are sorted unique. Unknown labels, sources, mappings,
versions, extra registry members, or post-frame evidence reject or take the exact unknown behavior
above; they cannot be resolved from outcomes.

## Exact deterministic ranking and allocation

```text
rankDigest = SHA256("peas/event-study-rank/v1" || 0x00 ||
                    rankSeedBytes || 0x00 || utf8(clusterCandidateId))
```

`rankDigest` is exactly 64 lowercase hex characters for the 32 digest bytes. Sort by unsigned digest
bytes, then `clusterCandidateId` ascending.

The market-cap and liquidity tertile comparison population is, independently for each dimension,
every unique eligible release-cluster candidate after source clustering, scope validation, and
share-class selection, but before control assignment or lane sampling. It is global across sectors,
models, sessions, and lanes. Filter only candidates whose corresponding evidence produces a known
positive exact value. Sort ascending by exact rational value, then `instrumentId`, then
`clusterCandidateId`, both unsigned UTF-8. With zero-based rank `r` among `n`, assign
`min(2,floor(3*r/n))` to low/mid/high. Equal values remain consecutive in the deterministic ID order;
there is no averaged-rank or shared-boundary override. Missing/invalid evidence is excluded only
from that dimension's comparison population and must assert `unknown`; it remains an eligible frame
candidate. The recomputed value, rank, population size, and label must agree with the hashed evidence.
Every known row has integer `comparisonRank` in `0..comparisonPopulationSize-1`; every unknown row
has null rank, while all rows carry the same known-population size for that dimension.

For `liquidity-tail`, after removing candidates assigned to the first three control eligibility
groups, rebuild one known-liquidity population from the remaining candidates, use the same
`(value,instrumentId,clusterCandidateId)` order, and mark exactly rows satisfying
`floor(10*r/n)==0`. Remaining known rows carry exact tail rank/population; remaining unknown rows
carry null rank and the same population size; candidates removed by an earlier control carry both
tail fields null. `tailEligible` is true exactly for the bottom-decile expression. Unknown liquidity
never qualifies. No calculation uses binary floating point.

Allocation is deterministic capacity-aware Hamilton:

1. for each populated specialized family assign `min(2,capacity)` base seats; for each populated
   standard sector assign `min(1,capacity)` base seats; the maxima are 18 and 11, so these bases
   never exceed their 40/120 targets;
2. let `R` be remaining seats and `Ci` a cell's remaining capacity;
3. assign `floor(R*Ci/sum(C))`;
4. assign remaining seats by descending exact remainder `(R*Ci) mod sum(C)`, tie by cell ID;
5. cap at `Ci`, remove exhausted cells, and repeat; and
6. select candidates within cells by rank.

First-level `Ci` is the remaining capacity of each model-family or sector group after its exact base
award; `R` is 40 or 120 minus all base awards. After the first-level final award `Ai` is fixed for a
group, second-level allocation starts fresh across that group's canonical populated cell IDs
`{marketCapStratum}|{liquidityStratum}|{plannedSession}`: every cell has base award exactly zero,
`R=Ai`, and `Ci` equals its full candidate count. Apply steps 3--5 until exactly `Ai` seats are
awarded. The specialized two-seat and standard one-seat bases never propagate to cells. Group and
cell IDs compare by unsigned UTF-8 bytes. `selectionFraction` is the reduced exact rational
`cellSelectedCount/cellFrameCount`; a zero-capacity cell is omitted, never assigned denominator
zero. Unknown is explicit. There is no cross-lane spillover. Capacity exhaustion returns
`study.quota-insufficient` with `quotaKind:lane` or `stratum` as applicable.

## Enrollment and denominators

Enrollment is the independently reviewed freeze of 180 unique cluster IDs. The selected 180 are the
capture and primary denominator forever. There are no replacements after freeze.

Cancelled/postponed/missed/shifted releases; identity drift; missing publication/anchor/reference;
halts; stale/locked/crossed/one-sided quotes; provider disagreement; contamination; and corrections
remain in the denominator with closed reasons. Capture eligibility, reference quality, metric
evaluability, model label, and future trade eligibility are independent fields.

Every output reports:

```text
frameN -> selectedN=180 -> releaseObservedN -> anchorTrustedN
  -> priorCloseEligibleN -> Q0EligibleN -> Q1EligibleN -> Q5EligibleN -> Q30EligibleN
  -> fullyCompleteN
```

Report each count against both 180 and the preceding stage, overall and by lane, control, sector,
cap, liquidity, planned/actual session, model family, timestamp trust, and provider comparison.
Complete-case output without the fixed-denominator counts is invalid. The study is
stratified/descriptive; it makes no population-representative claim.

## Primary anchor, selectors, and metrics

Durable capture primary is the existing exact basis:

```text
{basisKind:"capture",eventId,receivedAtMs,logicalAtMs,clockBasisId}
```

Mandatory retrieval sensitivity is the existing exact basis:

```text
{basisKind:"retrieval",role,acquisitionObservationId,
 vaultObservationId,retrievedAtMs,clockBasisId}
```

The retrieval field retains its recorded semantics and is never relabeled transport completion.
When both bases are trusted, record `captureMinusRetrievalMs`; absence of the sensitivity basis does
not change the durable primary but is counted.

Let Tpub be trusted publication, T0 durable capture, and T1/T5/T30 exact elapsed UTC offsets. Define:

- `Cprev`: preceding-session authoritative corrected consolidated close, else listing official
  close, under the frozen `recorded-primary` corpus;
- `Qpre`: last eligible NBBO quote with event time strictly `< Tpub`;
- `Q0/Q1/Q5/Q30`: last eligible NBBO quote with event time `<=` its exact target, subject to frozen
  staleness and same-session rules.

The primary exact rational metrics are:

```text
priorCloseMovementAtFirst = return(Cprev,Q0)
releaseGapMovement = return(Qpre,Q0)
residualMovement1m = return(Q0,Q1)
residualMovement5m = return(Q0,Q5)
residualMovement30m = return(Q0,Q30)
return(A,B) = (B-A)/A
```

The origin/destination fact times must be `<=` their targets; `Qpre` must be strictly before
publication. A first-after fact is look-ahead and rejects. A target crossing session kind is missing
primary with `market.session-transition`. Missing quote stays missing despite available trade/bar.

Trade sensitivities repeat equations with last eligible consolidated trade; bar sensitivities use
the close of the latest completed unadjusted 60-second bar whose end is `<=` target. Names and
`priceBasis` remain distinct. Prior close never silently falls back to final trade/bar.

## Timestamp, quote-quality, and correction policies

Primary movement accepts the timestamp/trust groups frozen by the timestamp contract. Primary
latency requires publication and durable clock uncertainty sufficient to calculate conservative
bounds. For publication error `ep` and anchor error `ea`:

```text
latencyLowerMs = (anchorMs-ea) - (publishedMs+ep)
latencyUpperMs = (anchorMs+ea) - (publishedMs-ep)
```

Timely means `latencyUpperMs <= 900000`; `900001` is not timely; a straddling interval is ambiguous
and not a success. Material negative ordering is invalid.

Primary NBBO requires two positive sides, explicit SIP-consolidated provenance, pinned condition
semantics, no national halt/pause, executable LULD sides, no unresolved sequence gap, and age
`<=5,000,000,000 ns` regular or `<=30,000,000,000 ns` extended. Locked and SIP-eligible slow quotes
remain degraded primary evidence; strict sensitivities exclude them. Crossed, one-sided, stale,
nonconsolidated, unknown-condition, halt, and nonexecutable-LULD states are missing.

The primary view is `recorded-primary`: use exactly the validated revision membership of the first
complete verified immutable corpus snapshot, identified by its corpus snapshot and closure
observation. It is a recorded-dataset claim, never a native-provider-known or PEAS-known-at-target
claim. `recorded-corrected` begins with that immutable set and admits additional valid revisions
whose preserved PEAS durable capture is at or before exactly `T0 + 604800000 ms`; one ms later is
excluded. Every view/cutoff/corpus identity is already part of the canonical market selection result.
The dataset freezes only after the last cluster reaches its corrected cutoff. Corrected-in-place or
unknown membership cannot satisfy `recorded-primary`; final-corrected-only evidence can enter
`recorded-corrected` only under the exact closed-corpus rule in the timestamp contract.

## Primary estimands and gate thresholds

All proportions use fixed `n=180`; missing/ambiguous is not success.

| ID | Success definition |
| --- | --- |
| `E1.complete-primary` | trusted publication/durable anchor, Cprev, Q0/Q1/Q5/Q30, complete identities/provenance, and `recorded-primary` correction semantics |
| `E2.observed-within-15m` | conservative latency upper bound `<=900000 ms` |
| `E3.informative-residual-5m` | complete Q0/Q5 and `abs(Q5-Q0) > ((ask0-bid0)+(ask5-bid5))/2`; equality is false |
| `E4.deterministic-reproduction` | selected-or-missing result, canonical metric, and study entry byte-identical across required variants |

Use two-sided 95% Wilson score intervals at `z=1.959963984540054`, at least 34 significant decimal
digits, correctly rounded square root, and half-even serialization to 18 decimals. Gate comparisons
use the 18-place canonical values.

| Gate | `GO` | `NO_GO` | Otherwise |
| --- | --- | --- | --- |
| E4 | exactly `180/180` | any mismatch | no inconclusive state |
| E1 | lower bound `>=0.75` | upper bound `<0.75` | `INCONCLUSIVE` |
| E2 | lower bound `>=0.70` | upper bound `<0.70` | `INCONCLUSIVE` |
| E3 | lower bound `>=0.25` | upper bound `<0.25` | `INCONCLUSIVE` |

Overall `GO` requires all four components GO. Any NO_GO yields overall NO_GO; otherwise
INCONCLUSIVE. These are measurement/readiness thresholds, not provider, cost, model, or trade
thresholds.

## Missing, outlier, multiplicity, bootstrap, provider, and sensitivity policies

- No primary imputation. Primary rates count missing as not-success; movement summaries state exact
  available numerator plus all-180 missing reasons.
- Retain every valid extreme movement. Primary analysis never trims, sigma-filters, or winsorizes.
  A type-7 1st/99th percentile winsorized sensitivity cannot change the gate.
- Missing sensitivities are worst-case, unattainable best-case bound, highest-trust complete cases,
  primary-session cases, lane/stratum missingness, and a pre-outcome frame-covariate observation
  model only when its exact formula/config is frozen.
- The gate is a fixed threshold rule, not a p-value search. Optional secondary tests use Holm at
  familywise alpha `0.05` over exactly 24 slots: five movement metrics in four actual-session groups
  plus four quote/trade comparisons. Missing slots have `p=1`; sort by `(p,slotId)`.
- Movement medians use only the single exact 10,000-replicate lane-stratified procedure below; no
  summary digest, alternate PRNG, library RNG, or caller seed exists.
- Exactly one primary provider/source policy is frozen. An authorized secondary discrepancy source
  yields `agree|disagree|not-comparable`; it never fills primary missingness. Equal facts retain
  provenance. Absent secondary is not agreement.
- Mandatory sensitivities: retrieval anchor/capture-minus-retrieval; quote versus labeled trade/bar;
  highest-trust; regular/pre/post/transition; locked/slow exclusion; quote staleness grid;
  `recorded-primary` versus `recorded-corrected`; provider comparison; outlier/missing bounds; and
  every lane/marginal stratum.

### Exact lane-stratified bootstrap

Bootstrap applies only to the five movement medians; E1--E4 gates are never bootstrapped. The
32-byte seed is derived before outcomes as

```text
bootstrapSeed = SHA256("peas/study-bootstrap-seed/v1" || 0x00 ||
                       rankSeedBytes || 0x00 || ascii(studyDesignId))
```

For each movement metric in `StudyMovementMetricIdV1` order and replicate `i=0..9999`, process lanes
in fixed order `standard=0`, `specialized=1`, `prospective-control=2`. A lane pool contains exactly
the available valid `recorded-primary` metric rows in that lane, sorted by `studyClusterId`; missing
rows are not imputed. Draw with replacement exactly the pool's own size. An empty lane contributes
zero draws; if all three pools are empty, the interval is typed `unavailable` and no replicate array
is emitted.

For draw index `j`, start counter `c=0` and compute:

```text
word = first_uint64be(SHA256("peas/study-bootstrap-word/v1" || 0x00 || bootstrapSeed ||
                            0x00 || ascii(metricId) || uint64be(i) || uint8(laneOrdinal) ||
                            uint64be(j) || uint64be(c)))
limit = floor(2^64 / lanePoolSize) * lanePoolSize
```

If `word>=limit`, increment `c` and retry; otherwise select index `word mod lanePoolSize`. Counter
overflow at `2^64-1` is canonical `study.input-invalid`. The replicate statistic is the exact median
of the concatenated three resampled pools; for even count it is the reduced rational mean of the
two center values. Store replicates by `(metricId,replicateIndex)`; input order, worker count,
restart, and backend cannot change them.

Sort the 10,000 exact replicate medians by rational value then replicate index. Type-7 quantile for
probability `p` uses `h=1+(N-1)*p`, `j=floor(h)`, `g=h-j`, and
`Q=(1-g)*x[j]+g*x[j+1]` with one-based indices and the endpoint itself when `j=N`. The interval uses
exact `p=1/40` and `39/40`. Canonical values remain reduced rationals; display-only values round
half-even to six decimals. Any 9,999/10,001 count, duplicate index, invalid rational, changed lane
size, modulo-biased draw, or noncanonical output order rejects.

Literal bootstrap vectors are normative:

| Vector | Input | Exact output |
| --- | --- | --- |
| `BOOT-SEED-01` | rank seed bytes `00 01 ... 1f`; study design ID `std1_` plus 64 zeroes | bootstrap seed `c53a848e04b4d945a53529ae5b38521ed30911687fc2a5da82f9cac328837bc9` |
| `BOOT-WORD-01` | that seed; metric `residualMovement5m`; replicate/lane/draw/counter all zero | digest `d61c7e091da9669460ab57eecf06483bc5250e38f3740827fb63813bc181d818`; first uint64 `15428345001081923220`; pool 180 index `60` |
| `BOOT-REJECT-01` | pool 10; injected word `18446744073709551610`, then `9` | limit `18446744073709551610`; first word rejects on equality; next accepts index `9` |
| `BOOT-MEDIAN-01` | exact sorted values `[-3,1,5]` and `[-3,1,5,9]` | exact medians `1` and `3` |
| `BOOT-Q7-01` | exact sorted `[0,10,20,30,40]` | type-7 at `1/40` is `1`; at `39/40` is `39` |

The injected-word vector tests the rejection helper directly; production words still come only
from the one SHA-256 procedure above.

### Exact 24-slot Holm family

The fixed actual-session groups are `pre-market`, `regular`, `post-market`, and `other`; `other`
combines only canonical actual sessions `overnight-or-closed` and `unknown`. The 20 movement slot IDs
are the Cartesian product below; each cell is a literal ID.

| Metric | pre-market | regular | post-market | other |
| --- | --- | --- | --- | --- |
| priorCloseMovementAtFirstObservation | `holm.movement.prior-close.pre-market` | `holm.movement.prior-close.regular` | `holm.movement.prior-close.post-market` | `holm.movement.prior-close.other` |
| releaseGapMovement | `holm.movement.release-gap.pre-market` | `holm.movement.release-gap.regular` | `holm.movement.release-gap.post-market` | `holm.movement.release-gap.other` |
| residualMovement1m | `holm.movement.residual-1m.pre-market` | `holm.movement.residual-1m.regular` | `holm.movement.residual-1m.post-market` | `holm.movement.residual-1m.other` |
| residualMovement5m | `holm.movement.residual-5m.pre-market` | `holm.movement.residual-5m.regular` | `holm.movement.residual-5m.post-market` | `holm.movement.residual-5m.other` |
| residualMovement30m | `holm.movement.residual-30m.pre-market` | `holm.movement.residual-30m.regular` | `holm.movement.residual-30m.post-market` | `holm.movement.residual-30m.other` |

Each movement slot tests the two-sided null that the conditional median exact movement is zero.
Use only available valid rows in that actual-session group. Discard exact zeroes, let `n=positive+
negative`, `k=min(positive,negative)`, and compute the exact two-sided sign-test p-value
`min(1, 2*sum(r=0..k, choose(n,r))/2^n)`. If `n=0`, status is `unavailable` and exact p-value is 1.

The remaining literal slots are `holm.quote-trade.T0`, `holm.quote-trade.T1`,
`holm.quote-trade.T5`, and `holm.quote-trade.T30`. Each tests the two-sided null that the paired
`recorded-primary` quote midpoint minus separately selected consolidated Last price has median zero
at that exact target. Include a cluster only when both canonical results are
`selected-complete|selected-degraded`; discard an exact zero difference and use the same exact sign
test. No trade result fills a quote result. With no nonzero pairs, status is `unavailable` and p=1.

Holm has exactly `m=24`, alpha `1/20`, and no dynamic family shrink. Sort by exact rational
`(rawP,slotId)`. At sorted position `i=1..24`, compare `rawP <= alpha/(m-i+1)`; reject sequentially
until the first failure, then reject no later slot. The adjusted p-value is
`max(j=1..i, min(1,(m-j+1)*rawP[j]))`. Serialize raw and adjusted p-values half-even to 18 decimals
only after exact sorting/comparison, and emit final rows by `slotId`. A missing/extra/duplicate slot,
different hypothesis/statistic, 23/25 family, floating-point comparison, or tied-p input-order
break is `study.input-invalid`.

## Forbidden pre-outcome fields and leakage checks

`StudyFreezeManifestV1`, its candidate entries, snapshots, allocation cells, and referenced
pre-outcome sidecars must reject any actual:

- release artifact, headline/body, publication time, actual release time/session, revision, or
  correction;
- market quote/trade/bar/official value, price, size, spread, halt/LULD/condition, or corporate
  action first learned after frame time;
- PEAS source success/failure, retrieval/capture latency, provider coverage/result, missingness, or
  disagreement;
- selected/missing market result ID, metric value, p-value, bootstrap value, threshold result, or
  conclusion; or
- post-frame model-family, cap, liquidity, sector, identity, schedule, or source-availability update
  used to alter selection.

The validator checks every referenced artifact/sidecar's observation/capture time is `<=
samplingFrameAsOfMs` for selection fields. Later T-1/event-time facts are dataset annotations only.
Provider priority, fallback, thresholds, exclusions, and correction cutoffs cannot change after
outcomes.

## StudyDatasetFreezeV1

```ts
type StudyDatasetFreezeV1 = Readonly<{
  schemaVersion: 1;
  studyManifestId: string;
  freezeCutoffMs: number;
  collectionCodeCommit: string;
  collectionConfigurationDigest: string;
  executionIds: readonly string[];
  artifactInventoryDigest: string;
  sourceObservationIds: readonly string[];
  revisionIds: readonly string[];
  marketReferenceJoinKeys: readonly string[];
  referenceResultIds: readonly string[];
  discrepancyIds: readonly string[];
  metricRecordIds: readonly string[];
  denominatorAccounting: readonly StudyDenominatorTableV1[];
  datasetFreezePolicyVersion: string;
  expectedDatasetFreezeId: string;
}>;

type StudyReferenceAccountingV1 =
  | Readonly<{
      endpointKind: "Cprev" | "Qpre" | "Q0" | "Q1" | "Q5" | "Q30" | "sensitivity";
      referenceKind: StudyReferenceKindV1;
      viewKind: StudyViewKindV1;
      resultStatus: "selected-complete" | "selected-degraded";
      selectedReferenceId: string;
      missingReferenceId: null;
      studyReason: null;
      diagnostics: readonly PreservedMarketReasonV1[];
    }>
  | Readonly<{
      endpointKind: "Cprev" | "Qpre" | "Q0" | "Q1" | "Q5" | "Q30" | "sensitivity";
      referenceKind: StudyReferenceKindV1;
      viewKind: StudyViewKindV1;
      resultStatus: "missing";
      selectedReferenceId: null;
      missingReferenceId: string;
      studyReason: StudyReasonV1;
      diagnostics: readonly PreservedMarketReasonV1[];
    }>;

type StudyRejectedMarketOperationV1 = Readonly<{
  endpointKind: "Cprev" | "Qpre" | "Q0" | "Q1" | "Q5" | "Q30" | "sensitivity";
  referenceKind: StudyReferenceKindV1;
  viewKind: StudyViewKindV1;
  resultStatus: "rejected";
  selectedReferenceId: null;
  missingReferenceId: null;
  rejectedReason: PreservedMarketReasonV1;
}>;

type StudyMetricAccountingV1 = Readonly<{
  metricId:
    | StudyMovementMetricIdV1
    | "E1.complete-primary"
    | "E2.observed-within-15m"
    | "E3.informative-residual-5m"
    | "E4.deterministic-reproduction";
  evaluability: "evaluable" | "missing";
  metricRecordId: string | null;
  success: boolean | null;
  studyReason: StudyReasonV1 | null;
}>;

type StudyAttritionStageV1 =
  | "selected"
  | "release-observed"
  | "anchor-trusted"
  | "prior-close-eligible"
  | "q0-eligible"
  | "q1-eligible"
  | "q5-eligible"
  | "q30-eligible"
  | "fully-complete";

type StudyAttritionEntryV1 = Readonly<{
  stage: StudyAttritionStageV1;
  status: "passed" | "not-passed";
  reason: StudyReasonV1 | null;
}>;

type StudyDenominatorTableV1 = Readonly<{
  studyClusterId: string;
  lane: "standard" | "specialized" | "prospective-control";
  controlGroup:
    | "identity-transition"
    | "schedule-uncertain"
    | "source-sparse"
    | "liquidity-tail"
    | null;
  sector: StudySectorV1;
  marketCap: "low" | "mid" | "high" | "unknown";
  liquidity: "low" | "mid" | "high" | "unknown";
  plannedSession: "pre-market" | "regular" | "post-market" | "overnight-or-closed" | "unknown";
  actualSession: "pre-market" | "regular" | "post-market" | "overnight-or-closed" | "unknown";
  modelFamily: StudyModelFamilyV1;
  releaseStatus: "observed" | "not-observed";
  primaryAnchorStatus: "trusted" | "missing" | "invalid";
  eventTMinusOneSnapshotId: string | null;
  providerComparison: "agree" | "disagree" | "not-comparable";
  references: readonly StudyReferenceAccountingV1[];
  metrics: readonly StudyMetricAccountingV1[];
  attrition: readonly StudyAttritionEntryV1[];
  annotations: readonly StudyReasonV1[];
}>;
```

`StudyRejectedMarketOperationV1` is validation-input evidence only; it is not a study-result
variant and is forbidden from `StudyReferenceAccountingV1`, `StudyDenominatorTableV1`,
`referenceResultIds`, every metric/attrition/annotation row, and the
`StudyDatasetFreezeV1` identity preimage. A rejected market operation emits no market result, no
selected or missing reference ID, no study row, and no `sdf1_` dataset-freeze ID. Encountering one
rejects the complete dataset-freeze validation atomically; no partial dataset is published. The
same already-frozen cluster and policy must be rerun without changing its manifest membership until
each required operation yields exactly one selected or typed-missing market result. Only after all
180 clusters have the complete selected/missing accounting union may dataset validation and
`expectedDatasetFreezeId` computation occur.

Exactly one denominator-accounting entry exists for each of the 180 frozen cluster IDs. The sorted
identity arrays bind actual source observations/revisions, `marketReferenceJoinKey`, selected or
typed-missing references, discrepancies, metrics, and replay executions; their referenced immutable
records bind the primary/retrieval bases, T-1/event-time snapshots, correction cutoffs,
planned/actual sessions, stable reasons, and replay proofs. The dataset object cannot modify any
design/freeze field. Raw licensed bytes remain private; only artifact/observation/digest identities
appear. `expectedDatasetFreezeId` is excluded and recomputed exactly like every earlier displayed
ID.

`denominatorAccounting` is sorted by `studyClusterId` and contains the same 180 IDs as the manifest,
with no replacement or omission. `attrition` contains exactly the nine stages above in declared
order. `selected` is always passed. Each reference stage is evaluated independently even when an
earlier stage is not-passed; missing Q0 cannot suppress Q1/Q5/Q30 evidence. `fully-complete` passes
only when every required preceding component passes. A passed stage requires `reason:null`; a
not-passed stage requires canonical retained-outcome or metric-missing evidence.

The six primary reference rows occur first in order `Cprev,Qpre,Q0,Q1,Q5,Q30`: Cprev uses
`prior-listing-official-close`, the five Q rows use `quote-nbbo-midpoint`, and all use
`recorded-primary`. Sensitivities follow sorted by `(endpointKind,referenceKind,viewKind)`. A
selected result has non-null `selectedReferenceId`, null `missingReferenceId`, and null study
missing reason. A typed-missing result has null `selectedReferenceId`, a non-null
`missingReferenceId`, and the exact study reason plus preserved missing market result/reason pair.
The two variants are disjoint and exhaustive for a publishable dataset. Typed `diagnostics`
byte-match the canonical selected or missing market result's sorted typed diagnostics. Metrics
contain exactly the nine design metric IDs sorted by `metricId`.
Movement success is null; E1--E4 success is boolean when evaluable and false when fixed-denominator
missingness is not-success. `metricRecordId` is non-null exactly when evaluable.

Annotations are sorted unique under the accepted study-reason catalog. `study.release-not-observed`
sets release status not-observed and remains in every denominator. `study.liquidity-unknown` records
14-or-fewer valid sessions without changing selection. Missing T-1 evidence is an annotation and
cannot rewrite frame strata. No generic study reason may erase a more-specific study reason or its
preserved `market.*` evidence.

## Exact manifest bounds

These limits must reconcile with [`pr-2d-resource-bounds.md`](pr-2d-resource-bounds.md). Every
maximum has exact and one-over executable evidence.

| Bound | Exact limit/invariant |
| --- | ---: |
| Target clusters | exactly 180; schema range 100..200 |
| Lane/control counts | 120/40/20 and four groups of 5 |
| Candidate frame | 8,192 |
| Frame disposition/allocation cells | 2,048 |
| Cluster entry bytes | 65,536 |
| Complete freeze manifest bytes | 33,554,432 |
| Dataset-freeze bundle bytes | 67,108,864 |
| JSON depth / total nodes / keys per object | 12 / 500,000 / 64 |
| Generic array | 256 except named arrays |
| Generic string / identity / timestamp text | 4,096 / 512 / 64 UTF-8 bytes |
| Contract/source/entitlement IDs | 64 each |
| Reasons / metrics / sensitivities | 64 / 32 / 32 |
| References per cluster / total | 64 / 12,800 |
| Annotations / revisions per cluster | 64 / 32 |
| Providers / strata dimensions | 8 / 8 |
| Collection sessions / calendar span | exactly 65 / <=120 calendar days |
| Liquidity sessions / minimum valid | 20 / 15 |
| Timely threshold | 900,000 ms inclusive |
| Correction lag | 604,800,000 ms inclusive |
| Bootstrap replicates / Holm slots | 10,000 / 24 |
| Canonical price/return integer component | 32 ASCII bytes |

Exact/one-over cases include 180 versus 179/181, schema 100/200 versus 99/201, every lane/control
plus/minus one, 8,192/8,193 frame members, freeze exactly before/at S6 open, 120 calendar days/+1 ms,
900,000/900,001 latency, correction cutoff/+1 ms, 10,000/10,001 bootstrap replicates, and 24/25
Holm slots. Over-limit input rejects atomically; it is never truncated or partially frozen.

The semantic registries are stricter than the generic storage ceilings: exactly 33 accepted study
reason codes, nine metric definitions, four gates, 11 sectors, 11 model-family values, four schedule
source families, three lanes, and four controls. Missing, duplicate, reordered where order is
declared, or extra semantic members reject as `study.input-invalid`; storage one-over remains
`study.bound-exceeded` with exact `limitKind`. The reason catalog itself is referenced by accepted
digest rather than copied into a caller-supplied array, so a fabricated 34th code is an unknown code,
not an opportunity to exercise the 64-definition storage ceiling.

### Required executable schema and algorithm vectors

| Vector | Exact required proof |
| --- | --- |
| `STV-001` | For every type in this document, exact valid object plus each key missing, extra, null-swapped, wrong-type, inherited, accessor, proxy, sparse, cyclic, duplicate-key, unsafe-number, noncanonical set order, and forged displayed ID. |
| `STV-002` | All 33 accepted `StudyReasonV1` codes, every closed detail value, wrong/missing/extra detail, priority collision, scope/disposition mismatch, and every unknown/retired study string. |
| `STV-003` | Each study reason that requires market evidence round-trips exact `marketResultId` and `PreservedMarketReasonV1`; forged ID, changed market detail, absent half of the pair, or generic study replacement rejects. |
| `STV-004` | The authority registry recomputes from exactly the ten literal `StudyContractAuthorityIdsV1` entries with exact paths, document digests, blob OIDs, and one common commit; the design, frame, and manifest bind the same registry ID and the design/freeze bind the exact tuple. Accepted study/market catalog digests recompute. One changed byte, missing/extra/reordered authority, mutable path, logical ID without digest, or mismatched checkpoint rejects before seed/frame construction and changes every dependent ID. |
| `STV-005` | Four schedule families, every precedence tie-break, sequence/no-sequence revision selection, conflict/fork/cycle, input permutation, and post-frame revision exclusion yield one result independent of arrival order. |
| `STV-006` | Same issuer/fiscal release across sources clusters once; date/session disagreement annotates; null-period proved key clusters; ambiguous null key and conflicting fiscal period dispose; restatement/later period remains separate. Recompute the original-synthetic `imap1_` and `min1_` primitives plus all literal `SCC-*` vectors and mutations: quarterly/annual, two cross-source keys, two native IDs, fiscal/native basis, and multiple same-observation items must validate exact representative/basis/key/preimage fields, never collide, and propagate changed `sfs1_`, `scl1_`, `sfm1_`, and later `sdf1_`. Forged primitive IDs, stale keys/IDs, and every cross-field mismatch reject. |
| `STV-007` | Market-cap evidence proves selected/missing official close, exact as-of shares authority, all known/unknown nullability branches, global exact-rational tertiles, boundary ties, and unknown exclusion without candidate exclusion. Liquidity proves exactly 20 consecutive S5-ending rows, 14/15/20 valid boundaries, exact median, global tertiles, post-earlier-control bottom-decile population, boundary ties, and unknown behavior. Share-class known median wins; null sorts last; exact rational tie and all-null use instrument ID; every loser is counted; post-freeze reversal cannot change winner. |
| `STV-008` | All 11 SIC divisions/unknown and all 11 model-family values validate authority/version/as-of evidence; conflict becomes exact unknown; unknown remains an explicit standard stratum. |
| `STV-009` | One candidate matching all controls receives only the first; each group with 4/5/6 members proves insufficient/exact/oversubscribed rank behavior; unselected controls return to their natural lane. |
| `STV-010` | Pre-frame evidence, rank material, and 32-byte lowercase seed recompute through the two-stage derivation; changed evidence/registry, caller seed, alternate byte conversion, reuse, post-exposure commitment, and timing-boundary failures reject. Rank digest and UTF-8 ties recompute. First-level specialized/standard bases and second-level fresh zero bases with `R=Ai` and full cell capacities prove Hamilton floor/remainder/tie/capacity iteration, unknown cell, exact selection fraction, empty cell, and insufficient capacity under every input order. |
| `STV-011` | Dataset has the exact same 180 cluster IDs, nine ordered attrition stages each, six ordered primary references, nine metrics, stable missing/retained annotations, and no replacement; 179/181, duplicate, reordered, or reason-erased rows reject. |
| `STV-012` | Every canonical reference kind and `recorded-primary|recorded-corrected` view round-trips through the disjoint `selected-complete|selected-degraded|missing` accounting union; wrong/null-swapped selected/missing IDs and every retired abbreviation reject. A validator-only rejected operation proves atomic no-row/no-result-ID/no-`sdf1_` failure, then the unchanged frozen cluster reruns to selected or typed-missing accounting. |
| `STV-013` | Bootstrap includes pool sizes 0/1/even/odd in each lane, rejected uint64 draw then accepted draw, four counter blocks, exact median/type-7 endpoints, 10,000 outputs, restart/backend equality, and 9,999/10,001 rejection. |
| `STV-014` | All 24 literal Holm slots, positive/negative/zero ties, exact binomial p, unavailable p=1, equal-p slot tie, step-down first failure, adjusted monotonic p, exact alpha equality, and 23/25 rejection. |
| `STV-015` | Wilson threshold equality and one canonical 18-decimal unit around every boundary, E4 180/180 and one mismatch, plus immutable overall GO/NO_GO/INCONCLUSIVE composition. |
| `STV-016` | Every study row in `pr-2d-resource-bounds.md` has exact, one-over/below, declared-in-limit actual-one-over, first/middle/last sibling, zero partial output, no post-return activity, restart, and memory/SQLite variants with exact reason/detail. |

No vector may use licensed bytes, a live provider, network, credentials, account state, incremental
spend, or an event outcome in a pre-outcome object.

## Validator result

A valid pre-outcome manifest returns only recomputed identities and structural counts. It does not
calculate or expose outcomes. Every failure, disposition, retained outcome, metric missingness, and
annotation uses the complete accepted `study-reasons-v1` catalog and its exact detail,
disposition, scope, priority, applicability, and market-preservation rules. An H-001 violation is
canonical `study.anchor-policy-invalid` with exact `anchorFailureKind`.

Before P1-09 GO, every attempted run freeze fails `study.primary-provider-unfrozen` with the first
unfrozen `providerFreezeKind` in fixed order provider, dataset, feed, endpoint, entitlement,
fallback. Recorded synthetic fixture validation may continue under `synthetic-offline-v1` but
cannot masquerade as a study run.
