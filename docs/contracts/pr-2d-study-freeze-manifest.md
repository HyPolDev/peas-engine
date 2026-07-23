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
  designVersion, acceptedContractIds, algorithms, metricDefinitions,
  gateThresholds, missingPolicyId, outlierPolicyId, multiplicityPolicyId,
  correctionPolicyId, sensitivityPolicyId, boundsPolicyId, analysisCodeDigest
})
frameSnapshotId = "sfs1_" + H("peas/study-frame-snapshot/v1", {
  studyDesignId, samplingFrameAsOfMs, calendarSnapshotId,
  scheduleSourcePolicyId, frameConstructionCodeDigest,
  configurationDigest, candidates, dispositions
})
clusterCandidateId = "scc1_" + H("peas/event-study-cluster-candidate/v1", {
  scheduleSourceObservationId, issuerMappingId, instrumentId,
  plannedFiscalPeriod, plannedReleaseDate, plannedSession
})
studyClusterId = "scl1_" + H("peas/study-cluster/v1", {
  clusterCandidateId, frameSnapshotId, lane, controlGroup,
  strata, rank, allocationCell, selectionFraction
})
studyManifestId = "sfm1_" + H("peas/study-freeze-manifest/v1", {
  studyDesignId, codeCommit, configurationDigest, contractIds,
  calendarSnapshotId, entitlementSnapshotIds, providerSourcePolicyId,
  selectionPolicyId, primaryAnchorKind, alternateAnchorRequired,
  readyAtMs, samplingFrameAsOfMs, freezePublishedAtMs,
  collectionSessions, correctionLagMs, rankSeedHex,
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

Paths, URLs, credentials, raw provider bytes, account facts, page tokens, current wall time, actual
prices, actual latency, provider success, corrections, missingness, and conclusions are excluded
from all pre-outcome identities.

## StudyDesignV1

```ts
type StudyDesignV1 = Readonly<{
  schemaVersion: 1;
  designVersion: string;
  acceptedContractIds: readonly string[];
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
  | "missing"
  | "rejected";

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
    "rejected",
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
type StudyReasonV1 = Readonly<{
  code: string;
  disposition: "fatal" | "frame-disposition" | "retained-outcome" | "metric-missing" | "annotation";
  scope: "design" | "frame" | "candidate" | "cluster" | "metric" | "dataset" | "replay";
  detail: Readonly<Record<string, string>> | null;
  marketResultId: string | null;
  preservedMarketReason: PreservedMarketReasonV1 | null;
}>;

type PreservedMarketReasonV1 = Readonly<{
  code: string;
  disposition: "rejected" | "ineligible" | "missing" | "degraded" | "annotation";
  scope: string;
  detail: Readonly<Record<string, string>> | null;
}>;
```

The two shapes above are exact envelopes; `code`, `detail`, `disposition`, and `scope` are not free
text because the accepted catalog digest closes their total permitted values and pairings.
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

## StudyFreezeManifestV1

```ts
type StudyFreezeManifestV1 = Readonly<{
  schemaVersion: 1;
  studyDesignId: string;
  codeCommit: string;
  configurationDigest: string;
  contractIds: readonly string[];
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
  samplingFrameAsOfMs: number;
  calendarSnapshotId: string;
  scheduleSourcePolicyId: "peas-study-schedule-source-v1";
  frameConstructionCodeDigest: string;
  configurationDigest: string;
  candidates: readonly StudyCandidateFrameEntryV1[];
  dispositions: readonly FrameDispositionCountV1[];
  expectedFrameSnapshotId: string;
}>;

type StudyCandidateFrameEntryV1 = Readonly<{
  scheduleSourceObservationId: string;
  releaseClusterKey: string;
  releaseKind: "quarterly" | "annual";
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
    marketCapStratum: "low" | "mid" | "high" | "unknown";
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

type StudyShareClassCandidateV1 = Readonly<{
  instrumentId: string;
  securityKind: "common-share" | "supported-adr";
  usExchangeListed: true;
  validLiquiditySessions: number;
  medianDollarVolume: Readonly<{ numerator: string; denominator: string }> | null;
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
provider fallback. Every retained source observation must have durable capture
`<=samplingFrameAsOfMs` and appears once in `scheduleSourceEvidence`, sorted by
`(precedenceOrdinal,scheduleSourceObservationId)`.

Within one `{sourceFamily,nativeScheduleIdHash}`, accept the greatest canonical non-negative
`nativeRevisionSequence` when every revision supplies it. Otherwise accept the greatest
`effectiveAtMs`, treating null as less than every integer, then greatest `durablyCapturedAtMs`, then
smallest `scheduleSourceObservationId`. A reused stable revision identity with conflicting canonical
content, a fork, or a cycle receives canonical `study.frame-candidate-invalid` with
`candidateFailureKind:source-conflict`; arrival and array order never break the tie.

Clustering occurs before share-class selection:

1. validate issuer mapping, release kind, date, session, and fiscal-period grammar;
2. encode fiscal period only as `YYYY-Q1` through `YYYY-Q4`, `YYYY-FY`, or null;
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

The cluster representative is the retained evidence row with lowest precedence ordinal, then
greatest effective time (null last), greatest durable capture, then smallest observation ID. Its
schedule observation and planned fields enter `scc1_`; all contributing rows remain in frame
evidence. `releaseClusterKey` is lowercase SHA-256 of RFC 8785 canonical
`{issuerMappingId,releaseKind,clusterBasis}`. `clusterBasis` is exactly one of
`{kind:"fiscal-period",plannedFiscalPeriod}`, `{kind:"cross-source",crossSourceReleaseKeyHash}`,
or `{kind:"native-date",plannedReleaseDate,nativeScheduleIdHash}` in that precedence. Exact
duplicate candidate IDs are fatal `study.duplicate-cluster` with
`duplicateFailureKind:duplicate-identity`; conflicting preimages use `conflicting-preimage`. A
provider delivery is never a second candidate.

### Deterministic share-class selection

For each cluster, retain only supported U.S.-exchange-listed common shares and explicitly supported
ADRs. Every other security receives canonical `study.instrument-out-of-scope`. For each supported
candidate calculate the exact median of `close*volume` over the 20 regular sessions ending at the
frame snapshot. Fewer than 15 valid sessions gives `medianDollarVolume:null` and canonical
`study.liquidity-unknown`; it never borrows another share class's value.

Known median numerator is canonical non-negative decimal integer text, denominator is canonical
positive decimal integer text, and the fraction is reduced. `validLiquiditySessions` is 0..20 and
must agree with the retained session evidence.

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

Sort by unsigned digest bytes, then `clusterCandidateId` ascending. For each tertile, sort known
exact values by `(value,instrumentId)`, give zero-based rank `r` among `n`, and assign
`min(2,floor(3*r/n))`; missing/invalid is `unknown`. Liquidity is the exact median of `close*volume`
over the prior 20 regular sessions with at least 15 valid sessions. Its bottom decile is
`floor(10*r/n)==0`. No calculation uses binary floating point.

Allocation is deterministic capacity-aware Hamilton:

1. for each populated specialized family assign `min(2,capacity)` base seats; for each populated
   standard sector assign `min(1,capacity)` base seats; the maxima are 18 and 11, so these bases
   never exceed their 40/120 targets;
2. let `R` be remaining seats and `Ci` a cell's remaining capacity;
3. assign `floor(R*Ci/sum(C))`;
4. assign remaining seats by descending exact remainder `(R*Ci) mod sum(C)`, tie by cell ID;
5. cap at `Ci`, remove exhausted cells, and repeat; and
6. select candidates within cells by rank.

Apply the same loop first across model-family/sector groups and then within each awarded group
across canonical cell IDs
`{marketCapStratum}|{liquidityStratum}|{plannedSession}`. Group and cell IDs compare by unsigned
UTF-8 bytes. `selectionFraction` is the reduced exact rational
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
- Movement medians use 10,000 lane-stratified bootstrap replicates. Replicate `i` derives from
  `SHA256("peas/study-bootstrap/v1" || seed || uint64be(i))`; unsigned-64 rejection sampling avoids
  modulo bias; type-7 percentile endpoints and half-even six-decimal display are fixed.
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

type StudyReferenceAccountingV1 = Readonly<{
  endpointKind: "Cprev" | "Qpre" | "Q0" | "Q1" | "Q5" | "Q30" | "sensitivity";
  referenceKind: StudyReferenceKindV1;
  viewKind: StudyViewKindV1;
  resultStatus: StudyResultStatusV1;
  marketResultId: string;
  studyReason: StudyReasonV1 | null;
  diagnostics: readonly PreservedMarketReasonV1[];
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
selected result has null study missing reason; a missing/rejected result requiring study treatment
has the exact reason and preserved market result/reason pair. Typed `diagnostics` byte-match the
canonical market result's sorted typed diagnostics. Metrics contain exactly the nine design metric
IDs sorted by `metricId`.
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
| `STV-004` | Accepted study/market catalog digests recompute; one changed catalog byte, mutable path, logical ID without digest, or mismatched checkpoint rejects before frame construction. |
| `STV-005` | Four schedule families, every precedence tie-break, sequence/no-sequence revision selection, conflict/fork/cycle, input permutation, and post-frame revision exclusion yield one result independent of arrival order. |
| `STV-006` | Same issuer/fiscal release across sources clusters once; date/session disagreement annotates; null-period proved key clusters; ambiguous null key and conflicting fiscal period dispose; restatement/later period remains separate. |
| `STV-007` | Share-class known median wins; null sorts last; exact rational tie and all-null use instrument ID; every loser is counted; post-freeze reversal cannot change winner. |
| `STV-008` | All 11 SIC divisions/unknown and all 11 model-family values validate authority/version/as-of evidence; conflict becomes exact unknown; unknown remains an explicit standard stratum. |
| `STV-009` | One candidate matching all controls receives only the first; each group with 4/5/6 members proves insufficient/exact/oversubscribed rank behavior; unselected controls return to their natural lane. |
| `STV-010` | Rank digest, UTF-8 tie, specialized/standard bases, Hamilton floor/remainder/tie/capacity iteration, unknown cell, exact selection fraction, empty cell, and insufficient capacity recompute under every input order. |
| `STV-011` | Dataset has the exact same 180 cluster IDs, nine ordered attrition stages each, six ordered primary references, nine metrics, stable missing/retained annotations, and no replacement; 179/181, duplicate, reordered, or reason-erased rows reject. |
| `STV-012` | Every canonical reference kind, `recorded-primary|recorded-corrected` view, and `selected-complete|selected-degraded|missing|rejected` status round-trips; every retired abbreviation rejects. |
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
