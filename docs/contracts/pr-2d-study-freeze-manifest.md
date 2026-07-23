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
  algorithms: Readonly<{
    samplingAlgorithmId: "peas-study-sampling-v1";
    framePolicyId: string;
    lanePolicyId: string;
    controlPolicyId: string;
    primaryAnchorKind: "capture";
    primaryAnchorClaim: "operational-durable-peas-knowledge";
    mandatorySensitivityAnchorKind: "retrieval";
    selectorKind: "last-eligible-at-or-before-target";
    releaseOriginSelectorKind: "last-eligible-strictly-before-publication";
    targetOffsetsNs: readonly ["0", "60000000000", "300000000000", "1800000000000"];
    quoteAgePolicyId: string;
    sessionPolicyId: string;
    providerPolicyContractId: string;
    bootstrapPolicyId: string;
    gatePolicyId: string;
    targetClusters: 180;
    laneTargets: Readonly<{ standard: 120; specialized: 40; prospectiveControl: 20 }>;
    controlTargets: Readonly<{
      identityTransition: 5;
      scheduleUncertain: 5;
      sourceSparse: 5;
      liquidityTail: 5;
    }>;
  }>;
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
  scheduleSourcePolicyId: string;
  frameConstructionCodeDigest: string;
  configurationDigest: string;
  candidates: readonly StudyCandidateFrameEntryV1[];
  dispositions: readonly FrameDispositionCountV1[];
  expectedFrameSnapshotId: string;
}>;

type StudyCandidateFrameEntryV1 = Readonly<{
  scheduleSourceObservationId: string;
  issuerMappingId: string;
  instrumentId: string;
  plannedFiscalPeriod: string | null;
  plannedReleaseDate: string;
  plannedSession: "pre-market" | "regular" | "post-market" | "overnight-or-closed" | "unknown";
  samplingSnapshotId: string;
  frameFacts: Readonly<{
    subject: string;
    instrumentVersionId: string;
    eventTMinusOneSnapshotPolicyId: string;
    sectorStratum: string;
    marketCapStratum: "low" | "mid" | "high" | "unknown";
    liquidityStratum: "low" | "mid" | "high" | "unknown";
    modelFamily: string;
    modelFamilyAuthority: string;
    modelFamilyVersion: string;
    modelFamilyEffectiveAtMs: number;
    expectedSourceFamilies: readonly string[];
    marketReferenceJoinPolicyId: string;
    intervalIds: readonly [string, string, string, string, string, string];
    referenceKinds: readonly [
      "nbbo-midpoint",
      "last-eligible-trade",
      "completed-bar",
      "official-close",
    ];
  }>;
  expectedClusterCandidateId: string;
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
    sector: string;
    marketCap: "low" | "mid" | "high" | "unknown";
    liquidity: "low" | "mid" | "high" | "unknown";
    plannedSession: "pre-market" | "regular" | "post-market" | "overnight-or-closed" | "unknown";
    modelFamily: string;
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

`samplingSnapshot` is the only source for selection, lane, strata, ranking, and allocation. The
per-event `eventTMinusOneSnapshot` is captured at the previous regular-session close and is added
only in the dataset freeze as a drift/quality annotation. It cannot change cluster ID, membership,
lane, rank, allocation, provider, threshold, or denominator. This prevents early outcomes from
influencing later T-1 selection.

The frame contains every prospectively scheduled quarterly/annual release in `S15..S79` known at
frame time with a deterministic schedule observation, issuer mapping, and supported U.S.-listed
common-share/ADR instrument candidate. Unsupported instruments, invalid candidates, duplicate
share-class alternatives, and other dispositions remain counted in the frame snapshot's
`dispositions` member.

## Prospective lane/control assignment

Assign controls first using frame-time evidence and this strict priority:

1. `identity-transition`: documented symbol/listing/share-class/split/merger/spin/ADR-ratio change
   effective in the prior 180 days or already announced through planned release date;
2. `schedule-uncertain`: planned session unknown or frozen schedule sources disagree;
3. `source-sparse`: at most one authoritative earnings-source family expected;
4. `liquidity-tail`: known frame liquidity lies in the bottom decile after earlier controls.

Select exactly five per kind. An event-time halt, missing/stale/crossed quote, price move,
correction, provider failure, or concurrent event can never recruit a control.

After controls, select exactly 40 specialized and 120 standard candidates. Specialized candidate
families are the frozen nine labels from the research contract; they are sampling labels, not model
or trade eligibility.

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

1. give each populated specialized family a floor of two when capacity permits, and each populated
   standard SIC division a floor of one;
2. let `R` be remaining seats and `Ci` a cell's remaining capacity;
3. assign `floor(R*Ci/sum(C))`;
4. assign remaining seats by descending exact remainder `(R*Ci) mod sum(C)`, tie by cell ID;
5. cap at `Ci`, remove exhausted cells, and repeat; and
6. select candidates within cells by rank.

Within each family/division, the cells are `{marketCap,liquidity,plannedSession}`. Unknown is an
explicit cell. There is no cross-lane spillover. Insufficient capacity invalidates the freeze.

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
  close, under the frozen as-recorded cutoff;
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

Primary correction view is `as-recorded(cutoffObservationId)`: use only immutable artifacts and
revisions durably present by the specified corpus cutoff. It must not be called known-at-market-time
without native arrival evidence. `later-corrected` includes all authorized revisions captured by
exactly `T0 + 604800000 ms`; one ms later is excluded. The dataset freezes only after the last
cluster reaches its cutoff. Corrected-in-place/unknown revision semantics cannot satisfy the primary
as-recorded completeness claim and remain a labeled sensitivity.

## Primary estimands and gate thresholds

All proportions use fixed `n=180`; missing/ambiguous is not success.

| ID | Success definition |
| --- | --- |
| `E1.complete-primary` | trusted publication/durable anchor, Cprev, Q0/Q1/Q5/Q30, complete identities/provenance, and as-recorded correction semantics |
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
  highest-trust; regular/pre/post/transition; locked/slow exclusion; quote staleness grid; as-recorded
  versus later-corrected; provider comparison; outlier/missing bounds; and every lane/marginal
  stratum.

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
```

Exactly one denominator-accounting entry exists for each of the 180 frozen cluster IDs. The sorted
identity arrays bind actual source observations/revisions, `marketReferenceJoinKey`, selected or
typed-missing references, discrepancies, metrics, and replay executions; their referenced immutable
records bind the primary/retrieval bases, T-1/event-time snapshots, correction cutoffs,
planned/actual sessions, stable reasons, and replay proofs. The dataset object cannot modify any
design/freeze field. Raw licensed bytes remain private; only artifact/observation/digest identities
appear. `expectedDatasetFreezeId` is excluded and recomputed exactly like every earlier displayed
ID.

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

## Validator result

A valid pre-outcome manifest returns only recomputed identities and structural counts. It does not
calculate or expose outcomes. Fatal failures use the closed `study.*`/`market.*` catalog, including
`study.frame-not-frozen`, `study.freeze-after-outcome`, `study.outcome-leakage`,
`study.quota-insufficient`, `study.rank-invalid`, `study.primary-provider-unfrozen`,
`study.anchor-human-decision-unresolved`, and `study.bound-exceeded`.

Before P1-09 GO, every attempted run freeze fails `study.primary-provider-unfrozen`; recorded
synthetic fixture validation may continue under `synthetic-offline-v1` but cannot masquerade as a
study run.
