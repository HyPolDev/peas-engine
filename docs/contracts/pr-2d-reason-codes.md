# PR 2D closed market-reference reason catalog

Status: normative Wave 2 contract input
Catalog ID: market-reasons-v1
Canonical namespace: market.*
Canonical definitions: 63, within the resource-bound maximum of 64
Study catalog ID: study-reasons-v1
Study namespace: study.*
Study definitions: 33, within the independent per-namespace maximum of 64

This document reconciles every independent mr.* and market.* research proposal into one closed PR
2D namespace. Constructors, validators, normalizers, selectors, missing results, discrepancy
records, fixtures, and tests MUST emit only the canonical codes below.

Related contracts:

- [timestamp and trust](pr-2d-timestamp-trust.md);
- [market eligibility](pr-2d-market-eligibility.md);
- [provider/source identity](pr-2d-provider-source-identity.md);
- [resource bounds](pr-2d-resource-bounds.md);
- [fixture manifest](pr-2d-fixture-manifest.md);
- [acceptance matrix](pr-2d-acceptance-matrix.md); and
- [study freeze manifest](pr-2d-study-freeze-manifest.md).

P1-09 remains pending. A reason records a deterministic disposition; it grants no provider access,
entitlement, retention, replay, redistribution, publication, fallback, or spend authority.

## 1. Namespace and detail boundary

market.* is the only PR 2D market-reference namespace.

Inherited fmp.*, ir.*, observation.*, and clock.* values remain upstream transcript/ledger reasons.
They are not aliases and are not renamed. A PR 2D record retains them in typed provenance while its
own typed `reason` uses this catalog. study.* is the separately versioned closed event-study layer
defined in section 5. It points to immutable market results without replacing their reasons.

Some canonical codes use one required closed detail enum to stay within the frozen 64-definition
bound without losing deterministic cause. Detail is a separately validated enum field, not free
text and not part of the reason string:

| Canonical code | Required detail field | Closed values |
| --- | --- | --- |
| market.bound-exceeded | limitKind | One exact market-scoped bound key from `market-reference-bounds-v1`. |
| market.source-contract-invalid | sourceFailureKind | incomplete, endpoint-unknown, spec-version-unknown |
| market.entitlement-invalid | entitlementFailureKind | unfrozen, pending, denied, scope-mismatch, zero-spend-violation |
| market.artifact-invalid | artifactFailureKind | observation-invalid, digest-mismatch, size-mismatch, observation-hash-mismatch, media-or-encoding-mismatch |
| market.provider-observation-invalid | providerObservationFailureKind | schema-invalid, identity-invalid, conflicting-content |
| market.revision-invalid | revisionFailureKind | orphan, fork, cycle, reused-key, chain-unresolved, unsupported-after-cancellation |
| market.timestamp-insufficient | timestampFailureKind | missing, semantic-untrusted, precision-insufficient, capture-retrieval-lag-exceeded |
| market.sequence-insufficient | sequenceFailureKind | missing, gap, equal-time-ambiguous |
| market.instrument-invalid | instrumentFailureKind | unmapped, ambiguous, outside-effective-window, symbol-continuity-unresolved |
| market.coverage-insufficient | coverageFailureKind | provider-unknown, instrument-not-covered |
| market.session-unknown | sessionFailureKind | calendar-missing, boundary-ambiguous, timestamp-or-coverage-unknown |
| market.trade-condition-ineligible | tradeConditionFailureKind | does-not-update-last, state-insufficient |
| market.prior-close-missing | priorCloseFailureKind | absent, ineligible |
| market.metric-endpoint-missing | endpointKind | pre-release, first-observation, plus-1m, plus-5m, plus-30m, sensitivity |
| market.quote-quality-degraded | qualityKind | locked, slow, luld-limit-state |
| market.evidence-quality-degraded | evidenceQualityKind | sip-time-only, native-sequence-unchecked |

The detail value is required exactly for those codes and forbidden for other codes. Provider error
text, HTTP text, exception text, symbol, price, path, URL, credential, account fact, current wall
time, and arbitrary free text are forbidden from codes, details, and identities. Bounded structured
evidence may separately carry IDs, expected/actual counts, and policy versions.

## 2. Dispositions and priority

| Disposition | Terminal scope | Result behavior |
| --- | --- | --- |
| rejected | operation | Emit no candidate/result from the invalid operation and no partial output. |
| ineligible | candidate/equivalence class | Candidate cannot win; retain its canonical outcome in candidateSetHash. |
| missing | reference/metric | Validation completed but no eligible value exists; emit one immutable typed missing result. |
| degraded | none | Emit selected result plus sorted unique diagnostic. |
| annotation | none | Retain nonterminal evidence; selected/missing status is decided elsewhere. |

A missing/rejected result has exactly one typed `reason`. A selected result has `reason:null`.
`selected-degraded` has one or more sorted typed `diagnostics` entries.

Priority is deterministic:

1. operation-terminal causes are evaluated first; lowest numeric priority wins and no partial
   candidate set survives;
2. candidate reasons remain attached to their candidates;
3. if all failed candidates share one reason/detail, that pair is the missing result reason;
4. for mixed candidate failures, the lowest numeric applicable pair is primary and candidateSetHash
   retains every other outcome;
5. no-eligible-* and prior-close absent apply only when no candidate of that kind exists, not when a
   more specific ineligibility exists;
6. metric-endpoint-missing points to the underlying missing reference without erasing its cause; and
7. diagnostics sort by unsigned UTF-8 bytes and never outrank terminal reasons.

Arrival order, provider priority, page order, hash order, or implementation branch order cannot
change priority.

For the three definitions whose terminal scope depends on the validated subject, the mapping is
closed:

| Canonical code | Validated subject | Disposition and scope |
| --- | --- | --- |
| market.timestamp-insufficient | one candidate fact | ineligible / candidate |
| market.timestamp-insufficient | reference or metric after the complete candidate set | missing / reference or metric |
| market.sequence-insufficient | one candidate or revision member | ineligible / candidate |
| market.sequence-insufficient | complete source state or reference | missing / state or reference |
| market.instrument-invalid | one candidate fact | ineligible / candidate |
| market.instrument-invalid | requested reference after complete mapping evidence | missing / reference |

No caller chooses between these outcomes. The already validated subject type and complete-set state
determine the single row before priority evaluation.

## 3. Canonical terminal and missing definitions

| Priority | Canonical code | Disposition | Scope | Applies to | Exact trigger |
| ---: | --- | --- | --- | --- | --- |
| 1 | market.bound-exceeded | rejected | operation | parser/artifact/page/manifest/state/selection | Any named byte/item/key/depth/token/string/window/state bound is exceeded. limitKind is required. |
| 2 | market.input-invalid | rejected | operation | public input/schema | Input is not exact inert data or violates closed shape/type/nullability. |
| 3 | market.identity-invalid | rejected | operation | any PR 2D identity | ID does not recompute from exact versioned preimage or contains forbidden material. |
| 4 | market.source-contract-invalid | rejected | operation | source declaration/dialect | Required source identity is incomplete, endpoint/protocol is unknown, or exact mapping version is unsupported; sourceFailureKind distinguishes them. |
| 5 | market.entitlement-invalid | rejected | operation | entitlement/source use | Snapshot/capability is unfrozen, pending, denied, out of scope, or violates zero-spend; entitlementFailureKind and immutable entitlement state distinguish them. |
| 6 | market.dataset-feed-mismatch | rejected | operation | provider/source identity | Provider, dataset, channel, feed, consolidation, delay, adjustment, session, or response identity conflicts. |
| 7 | market.artifact-invalid | rejected | operation | ArtifactStore evidence | Observation/digest/size/hash/media/encoding authority fails; artifactFailureKind identifies the exact failure. |
| 8 | market.artifact-read-failed | rejected | operation | verified read | Bounded verified complete read does not settle successfully. |
| 9 | market.page-chain-invalid | rejected | operation | recorded acquisition pages | Repeated/gapped token, token/query substitution, invalid ordinal, missing nonterminal token, incomplete chain, or chain hash mismatch. |
| 10 | market.provider-observation-invalid | ineligible | observation/equivalence class | provider observation | Provider observation schema/identity fails or same stable identity has conflicting canonical content; providerObservationFailureKind distinguishes it. |
| 11 | market.decimal-invalid | rejected | operation | price/size/action/return | Decimal is malformed, noncanonical, non-positive where required, out of bounds, or arithmetic overflows. |
| 12 | market.timestamp-invalid | rejected | operation | any timestamp | Grammar, range, precision representation, timezone/offset, or exact conversion is invalid. |
| 13 | market.clock-basis-invalid | rejected | operation | PEAS clock/anchor/revision arrival | Basis, stamp, synchronization/error/nullability, parent, regression witness, or monotonic order violates contract. |
| 14 | market.anchor-policy-invalid | rejected | operation | selection/study policy | The explicit policy is absent, primary is not durable capture, retrieval sensitivity is not mandatory, or retrievedAtMs is reinterpreted. |
| 15 | market.sequence-regression | rejected | operation | source state | Sequence regresses outside a documented reset or reset/retransmission contract is violated. |
| 16 | market.replay-incompatible | rejected | operation | replay/restart/backend | Replay changes semantic evidence/identity, fails causal remap, selects partial state, or differs by page/order/restart/backend. |
| 17 | market.silent-fallback-forbidden | rejected | operation | source/reference selection | Quote/trade/bar/prior-close/provider/feed substitution is attempted without a distinct frozen labeled policy. |
| 18 | market.revision-invalid | ineligible | revision family | correction/cancellation | Revision graph is orphaned, forked, cyclic, key-conflicted, unresolved, or unsupported after cancellation; revisionFailureKind distinguishes it. |
| 19 | market.selection-conflict | missing | reference | selector | Exact frozen policy cannot produce one winner and no more specific sequence/identity cause applies. |
| 100 | market.condition-unknown | ineligible | candidate | quote/trade/status | Condition is absent from exact dictionary or provider mapping is undocumented/lossy. |
| 101 | market.timestamp-insufficient | ineligible or missing | candidate/reference/metric | market fact/publication/capture-retrieval latency | Required timestamp is missing, semantic/precision cannot support the use, or comparable capture-retrieval lag exceeds 600,000 ms; timestampFailureKind fixes scope/disposition. |
| 102 | market.clock-basis-incompatible | missing | metric/sensitivity | capture-retrieval latency | Bases validate independently but do not share one comparable trusted clock basis. |
| 103 | market.sequence-insufficient | ineligible or missing | candidate/state/reference | source ordering | Required sequence is absent, state has an unresolved gap, or equal-time differing facts lack trusted order; sequenceFailureKind fixes scope/disposition. |
| 104 | market.correction-view-unknown | missing | reference/view | historical provider data | Original/revision/corpus-membership semantics cannot reconstruct the requested recorded view. |
| 105 | market.instrument-invalid | ineligible or missing | candidate/reference | instrument/share class/symbol | Mapping is absent, ambiguous, outside effective interval, or symbol continuity is unproved; instrumentFailureKind fixes scope/disposition. |
| 106 | market.coverage-insufficient | missing | reference | provider/source coverage | Coverage is not frozen or explicitly excludes instrument/session/date; coverageFailureKind distinguishes it. |
| 107 | market.currency-unsupported | ineligible | candidate | any price/action | Currency is absent, conflicting, or not USD for V1. |
| 108 | market.corporate-action-unresolved | missing | metric/reference | instrument/action | Action identity, revision, effective boundary, share class, or exact effect is uncertain. |
| 109 | market.corporate-action-crossing | missing | metric | price comparison | Action is effective after first endpoint and at/before second; unadjusted primary comparison is forbidden. |
| 110 | market.adjustment-unknown | ineligible | candidate/reference | bar/EOD/provider price/action | Adjustment is absent, conflicting, provider-defined without approval, or unsupported. |
| 111 | market.session-unknown | missing | reference | calendar/tzdb/session | Calendar is missing, boundary is ambiguous, or timestamp/source coverage cannot assign a session; sessionFailureKind distinguishes it. |
| 112 | market.session-closed | missing | reference | session | Target is outside an eligible official session. |
| 113 | market.session-transition | missing | metric/reference | residual interval | Endpoint session kind differs from T0 for primary same-session residual. |
| 114 | market.overnight-primary-forbidden | ineligible | candidate/reference | overnight source/session | BOATS, 24X, derived overnight, or other overnight fact is offered as primary/ordinary extended evidence. |
| 120 | market.quote-halt | missing | quote reference | quote/market state | Cross-SRO or market-wide halt/pause is active at target. |
| 121 | market.quote-luld-nonexecutable | ineligible | quote candidate | quote/LULD | One or both national sides are explicitly non-executable. |
| 122 | market.quote-one-sided | ineligible | quote candidate | quote | Bid or ask price/size is absent, zero, or not positive two-sided state. |
| 123 | market.quote-not-consolidated | ineligible | quote candidate | quote provenance | Explicit consolidated SIP NBBO provenance is absent. |
| 124 | market.quote-condition-ineligible | ineligible | quote candidate | quote | Known pinned condition is not NBBO eligible for both required national sides. |
| 125 | market.quote-size-invalid | ineligible | quote candidate | quote | Bid/ask size is malformed, non-positive, or schema-inconsistent. |
| 126 | market.quote-crossed | ineligible | quote candidate | quote | Bid is greater than ask. |
| 127 | market.quote-stale | ineligible | quote candidate | quote | Non-negative age exceeds frozen session threshold by at least one nanosecond. |
| 128 | market.no-eligible-quote | missing | quote reference | quote | Complete bounded source/window contains no quote candidate at/before target. |
| 130 | market.trade-condition-ineligible | ineligible | trade candidate | trade | Exact conditions do not update Last or complete state cannot decide; tradeConditionFailureKind distinguishes it. |
| 131 | market.trade-odd-lot | ineligible | trade candidate | trade | Exact odd-lot condition/regime does not update consolidated Last. |
| 132 | market.trade-cancelled | ineligible | trade candidate | trade/revision view | Candidate is cancelled in requested immutable view. |
| 133 | market.no-eligible-trade | missing | trade reference | trade | Complete bounded source/window contains no trade candidate at/before target. |
| 140 | market.bar-interval-future | ineligible | bar candidate | bar | Target is before barEndNs; containing bar is incomplete. |
| 141 | market.bar-stale | ineligible | bar candidate | bar | Target minus completed barEndNs exceeds 60 seconds. |
| 142 | market.no-eligible-bar | missing | bar reference | bar | Complete bounded source/window contains no completed one-minute bar at/before target. |
| 150 | market.prior-close-missing | missing | prior-close reference | official close | M/eligible listing-market 9 is absent or a close-like candidate is ineligible; priorCloseFailureKind distinguishes it. |
| 151 | market.anchor-missing | missing | reference/metric | capture/retrieval anchor | Required exact basis or causal evidence is absent. |
| 152 | market.anchor-order-invalid | missing | metric | publication/anchor/targets | Tpub is after T0, target order is invalid, delta is negative where forbidden, or interval addition overflows. |
| 153 | market.publication-time-untrusted | missing | release-gap/latency | earnings publication | Publication is null, inferred/date-only, or below exact/provider trust required by primary metric. |
| 154 | market.metric-endpoint-missing | missing | metric | Qpre/Q0/Q1/Q5/Q30/sensitivity | Required endpoint reference is missing; endpointKind identifies it and underlying result retains its cause. |
| 155 | market.division-by-zero | missing | metric | exact return | Validated return denominator is zero. |
| 156 | market.reference-window-missing | missing | reference | artifact/time window | Required declared artifact or bounded time window is absent/incomplete. |

## 4. Canonical diagnostics

| Priority | Canonical code | Disposition | Applies to | Exact trigger |
| ---: | --- | --- | --- | --- |
| 900 | market.duplicate-redelivery | annotation | provider observation/delivery | Exact observation identity/content delivered again; apply once and retain every witness. |
| 901 | market.correction-after-cutoff | annotation | revision/view | Valid revision durable arrival is after requested cutoff; exclude it. This also records that a later correction exists. |
| 902 | market.quote-quality-degraded | degraded | selected quote | Eligible quote is locked, slow, or at executable LULD limit state; qualityKind distinguishes it. |
| 903 | market.evidence-quality-degraded | degraded | sensitivity state | Selection explicitly permits SIP-time-only or native-unchecked evidence; evidenceQualityKind distinguishes it and primary use remains forbidden. |
| 904 | market.provider-disagreement | annotation | provider discrepancy | Independently selected comparable provider results differ under frozen comparison. |
| 905 | market.provider-not-comparable | annotation | provider discrepancy | Secondary is absent or semantics prevent comparison; this is not agreement. |

## 5. Closed study reason catalog

`study-reasons-v1` is a closed catalog. It is not an alias layer over `market.*`. A study reason
describes frame validation, fixed-denominator retention, metric evaluability, or study diagnostics;
the exact underlying market result and market reason remain independently preserved as specified
below.

### 5.1 Typed study reason and details

Every study reason is the exact inert object:

```text
StudyReasonV1 = {
  code: one exact study.* code from section 5.2,
  disposition: fatal | frame-disposition | retained-outcome | metric-missing | annotation,
  scope: design | frame | candidate | cluster | metric | dataset | replay,
  detail: null | one exact detail object required by the table below,
  marketResultId: null | one immutable selected/missing market result ID,
  preservedMarketReason: null | PreservedMarketReasonV1
}

PreservedMarketReasonV1 = {
  code: one canonical market.* code,
  disposition: the exact market disposition,
  scope: the exact market scope,
  detail: null | the exact canonical market detail object
}
```

Unknown, missing, extra, inherited, accessor, symbol, proxy, sparse, cyclic, or noncanonical members
reject the containing study object as `study.input-invalid`. `detail` is required and non-null
exactly for the codes below and must contain exactly the named key:

| Study code | Required detail key | Closed values |
| --- | --- | --- |
| study.bound-exceeded | limitKind | One exact bound key from `market-reference-bounds-v1` whose scope is study. |
| study.frame-not-frozen | frameFailureKind | snapshot-missing, snapshot-mutable, seed-unfrozen, policy-unfrozen, contract-unbound |
| study.freeze-after-outcome | freezeFailureKind | equal-to-first-outcome, after-first-outcome |
| study.outcome-leakage | leakageFieldKind | actual-release, price, latency, condition, availability, correction, market-result, post-frame |
| study.duplicate-cluster | duplicateFailureKind | duplicate-identity, conflicting-preimage |
| study.quota-insufficient | quotaKind | lane, control, stratum |
| study.rank-invalid | rankFailureKind | seed, hash, ordering, allocation |
| study.primary-provider-unfrozen | providerFreezeKind | provider, dataset, feed, endpoint, entitlement, fallback |
| study.anchor-policy-invalid | anchorFailureKind | capture-not-primary, retrieval-not-required, policy-missing, retrieved-at-reinterpreted |
| study.frame-candidate-invalid | candidateFailureKind | schedule, issuer, instrument, fiscal-period, source-conflict |
| study.release-not-observed | releaseFailureKind | cancelled, postponed, outside-window, not-captured |
| study.identity-changed | identityChangeKind | issuer, instrument, share-class |
| study.anchor-clock-insufficient | basisKind | capture, retrieval, capture-minus-retrieval |
| study.reference-window-missing | endpointKind | pre-release, first-observation, plus-1m, plus-5m, plus-30m, sensitivity |
| study.correction-semantics-unknown | correctionFailureKind | original-admission, revision-arrival, cancellation, cutoff-evidence |
| study.concurrent-event | contaminationKind | issuer-release, macro-release, trading-halt, corporate-action |
| study.market-quality-degraded | qualityKind | halt, stale, locked, crossed, one-sided, condition-ineligible |

Every other study code requires `detail:null`. `marketResultId` and `preservedMarketReason` are both
required or both null. When non-null they must reproduce the referenced immutable market result
exactly; a forged, partial, differently detailed, or noncanonical pair rejects as
`study.input-invalid`.

### 5.2 Canonical study definitions

| Priority | Canonical code | Disposition | Scope | Applies to | Exact trigger |
| ---: | --- | --- | --- | --- | --- |
| 1 | study.bound-exceeded | fatal | design/frame/cluster/metric/dataset | study parser/validator/analysis | A named study byte/item/key/depth/node/string/window/state ceiling is exceeded; limitKind is required. |
| 2 | study.input-invalid | fatal | design/frame/cluster/metric/dataset | any public study input | Closed shape, type, nullability, canonical ordering, identity, or exact-count validation fails and no more specific fatal code applies. |
| 3 | study.frame-not-frozen | fatal | design/frame | pre-outcome authority | Required immutable snapshot, seed, policy, or accepted contract binding is absent or mutable; frameFailureKind is required. |
| 4 | study.freeze-after-outcome | fatal | design/frame | freeze chronology | Freeze equals or follows the first selected outcome; freezeFailureKind is required. |
| 5 | study.outcome-leakage | fatal | design/frame/candidate | pre-outcome selection preimage | A forbidden outcome or post-frame field is present; leakageFieldKind is required. |
| 6 | study.duplicate-cluster | fatal | frame/cluster | candidate and selected identities | A cluster identity repeats or the same identity has conflicting preimages; duplicateFailureKind is required. |
| 7 | study.quota-insufficient | fatal | frame | lane/control/stratum allocation | Deterministic eligible capacity cannot fill a fixed target; quotaKind is required. |
| 8 | study.rank-invalid | fatal | frame | rank/Hamilton allocation | Seed, rank hash, ordering, or allocation does not recompute; rankFailureKind is required. |
| 9 | study.primary-provider-unfrozen | fatal | design/frame | provider/source gate | Any required provider/source/entitlement/fallback component is not accepted and frozen; providerFreezeKind is required. |
| 10 | study.anchor-policy-invalid | fatal | design/frame | H-001 policy | Durable capture is not explicit primary, retrieval is not explicit mandatory sensitivity, the policy is missing, or retrievedAtMs is reinterpreted; anchorFailureKind is required. |
| 11 | study.replay-mismatch | fatal | replay/dataset | order/page/restart/backend replay | Required recomputation differs in any semantic byte, reason, identity, denominator, or result. |
| 100 | study.frame-candidate-invalid | frame-disposition | candidate | pre-sampling frame | Candidate schedule/issuer/instrument/fiscal/source evidence cannot validate; candidateFailureKind is required and the candidate is counted before sampling. |
| 101 | study.instrument-out-of-scope | frame-disposition | candidate | instrument universe | Frozen instrument is not a supported U.S.-listed common share or ADR. |
| 102 | study.share-class-not-selected | frame-disposition | candidate | deterministic share-class choice | Another instrument wins the frozen liquidity then instrument-ID rule. |
| 200 | study.release-not-observed | retained-outcome | cluster | fixed N=180 cohort | Selected release is cancelled, postponed, outside the collection window, or never captured; releaseFailureKind is required and the cluster remains in every denominator. |
| 201 | study.timeliness-threshold-not-met | retained-outcome | metric | E2 latency classification | Valid conservative latency lower bound is greater than 900000 ms; this is not missing and remains a non-success. |
| 300 | study.publication-time-insufficient | metric-missing | metric | latency and release-origin metrics | Publication is null, inferred, date-only, or below frozen primary trust. |
| 301 | study.anchor-clock-insufficient | metric-missing | metric | capture/retrieval/latency metric | Selected basis or trusted clock/error evidence cannot support the metric; basisKind is required. |
| 302 | study.latency-ambiguous | metric-missing | metric | E2 latency classification | Conservative latency interval straddles 900000 ms and therefore is not a timely success. |
| 303 | study.prior-close-missing | metric-missing | metric | prior-close movement | Referenced canonical market result has no eligible prior close. |
| 304 | study.reference-window-missing | metric-missing | metric | release-gap/residual endpoint | Exact endpoint is absent; endpointKind is required. |
| 305 | study.correction-semantics-unknown | metric-missing | metric | frozen correction view | Recorded evidence cannot apply the requested original/revision/cancellation cutoff predicate; correctionFailureKind is required. |
| 306 | study.metric-not-evaluable | metric-missing | metric | any frozen metric | Required validated inputs remain absent after every more-specific study and preserved market reason is recorded. |
| 900 | study.schedule-changed | annotation | cluster | actual versus frozen schedule | Actual date/session differs from the frozen planned value; membership and denominator cannot change. |
| 901 | study.t-minus-one-missing | annotation | cluster | T-1 drift snapshot | Per-cluster T-1 snapshot cannot validate; frozen frame membership cannot change. |
| 902 | study.identity-changed | annotation | cluster | post-frame identity drift | Issuer, instrument, or share-class evidence changes after frame freeze; identityChangeKind is required. |
| 903 | study.provider-disagreement | annotation | metric/cluster | provider comparison | Frozen independently selected comparable provider results disagree. |
| 904 | study.provider-not-comparable | annotation | metric/cluster | provider comparison | Secondary is absent or its frozen semantics do not permit comparison; this is not agreement. |
| 905 | study.correction-after-cutoff | annotation | metric/cluster | correction view | Valid market revision is durably captured one unit after the exact requested cutoff and remains excluded. |
| 906 | study.concurrent-event | annotation | cluster | contamination policy | A predeclared event-time contamination rule matches; contaminationKind is required and the cluster remains in N=180. |
| 907 | study.market-quality-degraded | annotation | metric/cluster | referenced market result | Preserved market reason reports halt, stale, locked, crossed, one-sided, or condition failure; qualityKind is required. |
| 908 | study.outlier-retained | annotation | metric | descriptive return fence | Valid return is outside the frozen descriptive fence; it is retained without winsorization in the primary analysis. |
| 909 | study.liquidity-unknown | annotation | candidate/cluster | T-1 liquidity evidence | Fewer than 15 of exactly 20 required sessions validate; liquidity stratum is exactly unknown and the fact is not guessed. |

### 5.3 Priority, applicability, and cross-layer preservation

For one public study operation, evaluate all applicable causes against the complete inert snapshot.
The lowest numeric fatal priority is the sole operation reason and the operation emits no partial
frame, rank, cluster, manifest, metric set, or dataset. Frame dispositions attach to rejected frame
candidates and are counted by exact code/detail before sampling. Retained outcomes attach only to
already frozen clusters and can never recruit, remove, or replace a cluster. A missing metric has
exactly one lowest-priority applicable metric-missing reason. Annotations are sorted by unsigned
UTF-8 bytes of `(code, canonical detail, marketResultId)` and are unique by that tuple.

Applicability is closed:

- fatal reasons cannot be downgraded to a frame disposition, retained outcome, missing metric, or
  annotation;
- frame dispositions are legal only before rank/allocation and never appear on a selected cluster;
- retained outcomes and annotations require an already frozen cluster and cannot change N=180;
- metric-missing reasons apply only to the named metric family and never erase other evaluable
  metrics;
- `study.prior-close-missing`, `study.reference-window-missing`,
  `study.correction-semantics-unknown`, `study.provider-disagreement`,
  `study.provider-not-comparable`, `study.correction-after-cutoff`, and
  `study.market-quality-degraded` require the exact `marketResultId` and
  `preservedMarketReason`;
- `study.metric-not-evaluable` is legal only after all more-specific causes were evaluated and
  retains every referenced market result/reason in the metric evidence; and
- no study code may replace, translate, reprioritize, or discard a canonical market code/detail.

The validator rejects every unknown `study.*` string and the retired
`study.anchor-human-decision-unresolved` spelling. Because H-001 is approved, the latter maps only
as migration documentation to `study.anchor-policy-invalid` with the exact applicable detail; it
is never accepted at runtime. Both catalog IDs and accepted digests are bound into
`StudyDesignV1`, every study result identity, fixture oracle, and acceptance evidence. A catalog
change creates a new version and requires pre-outcome review.

## 6. Retirement of every mr.* research spelling

Left-column spellings are not accepted V1 outputs. Where the canonical code uses a detail field, the
required detail is shown.

| Retired spelling | Canonical V1 code and required detail |
| --- | --- |
| mr.bound-exceeded | market.bound-exceeded |
| mr.schema-invalid | market.input-invalid |
| mr.decimal-invalid | market.decimal-invalid |
| mr.timestamp-invalid | market.timestamp-invalid |
| mr.source-identity-incomplete | market.source-contract-invalid / incomplete |
| mr.spec-version-unknown | market.source-contract-invalid / spec-version-unknown |
| mr.condition-unknown | market.condition-unknown |
| mr.sequence-gap | market.sequence-insufficient / gap |
| mr.sequence-ambiguous | market.sequence-insufficient / equal-time-ambiguous |
| mr.sequence-regression | market.sequence-regression |
| mr.duplicate-conflict | market.provider-observation-invalid / conflicting-content |
| mr.correction-chain-unresolved | market.revision-invalid / chain-unresolved |
| mr.instrument-unmapped | market.instrument-invalid / unmapped |
| mr.instrument-ambiguous | market.instrument-invalid / ambiguous |
| mr.symbol-change-unresolved | market.instrument-invalid / symbol-continuity-unresolved |
| mr.currency-unsupported | market.currency-unsupported |
| mr.corporate-action-unresolved | market.corporate-action-unresolved |
| mr.corporate-action-crossing | market.corporate-action-crossing |
| mr.calendar-missing | market.session-unknown / calendar-missing |
| mr.session-boundary-ambiguous | market.session-unknown / boundary-ambiguous |
| mr.session-closed | market.session-closed |
| mr.session-transition | market.session-transition |
| mr.overnight-excluded | market.overnight-primary-forbidden |
| mr.quote-halt | market.quote-halt |
| mr.quote-luld-nonexecutable | market.quote-luld-nonexecutable |
| mr.quote-one-sided | market.quote-one-sided |
| mr.quote-not-consolidated | market.quote-not-consolidated |
| mr.quote-condition-ineligible | market.quote-condition-ineligible |
| mr.quote-size-invalid | market.quote-size-invalid |
| mr.quote-crossed | market.quote-crossed |
| mr.quote-stale | market.quote-stale |
| mr.quote-missing | market.no-eligible-quote |
| mr.trade-condition-ambiguous | market.trade-condition-ineligible / state-insufficient |
| mr.trade-condition-ineligible | market.trade-condition-ineligible / does-not-update-last |
| mr.trade-odd-lot | market.trade-odd-lot |
| mr.trade-cancelled | market.trade-cancelled |
| mr.trade-missing | market.no-eligible-trade |
| mr.bar-adjustment-unknown | market.adjustment-unknown |
| mr.bar-interval-future | market.bar-interval-future |
| mr.bar-missing | market.no-eligible-bar |
| mr.anchor-decision-required | market.anchor-policy-invalid |
| mr.anchor-missing | market.anchor-missing |
| mr.anchor-order-invalid | market.anchor-order-invalid |
| mr.release-time-untrusted | market.publication-time-untrusted |
| mr.prior-close-missing | market.prior-close-missing / absent |
| mr.pre-release-reference-missing | market.metric-endpoint-missing / pre-release |
| mr.target-reference-missing | market.metric-endpoint-missing / exact endpointKind |
| mr.division-by-zero | market.division-by-zero |
| mr.missing-window | market.reference-window-missing |
| mr.provider-disagreement | market.provider-disagreement |
| mr.quote-locked | market.quote-quality-degraded / locked |
| mr.quote-slow | market.quote-quality-degraded / slow |
| mr.quote-luld-limit-state | market.quote-quality-degraded / luld-limit-state |
| mr.timestamp-sip-only | market.evidence-quality-degraded / sip-time-only |
| mr.sequence-native-unchecked | market.evidence-quality-degraded / native-sequence-unchecked |
| mr.session-extended | no reason; exact sessionKind extended-pre/extended-post is authoritative |
| mr.correction-later-available | market.correction-after-cutoff |
| mr.corporate-action-adjusted-sensitivity | no reason; exact sensitivity referenceKind and adjustment identity are authoritative |

H-001 is approved. mr.anchor-decision-required does not remain a runtime decision-pending state.
A missing/contradictory approved policy is market.anchor-policy-invalid.

## 7. Reconciliation of other market.* research spellings

Left-column values not present in canonical tables are retired and MUST NOT be emitted.

| Research spelling | Canonical V1 disposition |
| --- | --- |
| market.entitlement-unfrozen | market.entitlement-invalid / unfrozen |
| market.entitlement-pending | market.entitlement-invalid / pending |
| market.entitlement-denied | market.entitlement-invalid / denied |
| market.entitlement-not-authorized | market.entitlement-invalid with exact applicable detail |
| market.endpoint-identity-unknown | market.source-contract-invalid / endpoint-unknown |
| market.spec-version-unknown | market.source-contract-invalid / spec-version-unknown |
| market.feed-mismatch | market.dataset-feed-mismatch |
| market.artifact-observation-invalid | market.artifact-invalid / observation-invalid |
| market.artifact-mismatch | market.artifact-invalid with exact artifactFailureKind |
| market.provider-observation-conflict | market.provider-observation-invalid / conflicting-content |
| market.revision-orphan | market.revision-invalid / orphan |
| market.revision-conflict | market.revision-invalid with exact revisionFailureKind |
| market.correction-chain-unresolved | market.revision-invalid / chain-unresolved |
| market.correction-representation-unknown | market.correction-view-unknown |
| market.timestamp-missing | market.timestamp-insufficient / missing |
| market.timestamp-untrusted | market.timestamp-insufficient / semantic-untrusted |
| market.timestamp-trust-insufficient | market.timestamp-insufficient with exact timestampFailureKind |
| market.sequence-missing | market.sequence-insufficient / missing |
| market.sequence-gap | market.sequence-insufficient / gap |
| market.sequence-ambiguous | market.sequence-insufficient / equal-time-ambiguous |
| market.instrument-unmapped | market.instrument-invalid / unmapped |
| market.instrument-ambiguous | market.instrument-invalid / ambiguous |
| market.instrument-outside-effective-window | market.instrument-invalid / outside-effective-window |
| market.symbol-mapping-ambiguous | market.instrument-invalid / symbol-continuity-unresolved |
| market.provider-coverage-unknown | market.coverage-insufficient / provider-unknown |
| market.instrument-not-covered | market.coverage-insufficient / instrument-not-covered |
| market.calendar-missing | market.session-unknown / calendar-missing |
| market.session-boundary-ambiguous | market.session-unknown / boundary-ambiguous |
| market.condition-ineligible | forbidden as fact-kind ambiguous; emit quote/trade-specific canonical code |
| market.trade-condition-ambiguous | market.trade-condition-ineligible / state-insufficient |
| market.bar-adjustment-unknown | market.adjustment-unknown |
| market.prior-close-ineligible | market.prior-close-missing / ineligible |
| market.no-prior-close | market.prior-close-missing / absent |
| market.pre-release-reference-missing | market.metric-endpoint-missing / pre-release |
| market.target-reference-missing | market.metric-endpoint-missing / exact endpointKind |
| market.parser-limit-exceeded | market.bound-exceeded with parser limitKind |
| market.selection-limit-exceeded | market.bound-exceeded with selection limitKind |
| market.correction-later-available | market.correction-after-cutoff |

When a retired generic spelling maps to a canonical code with several possible details, translation
is allowed only from the already validated structured evidence named by the canonical trigger. For
example, immutable entitlementState pending maps to pending, denied or not-authorized maps to
denied, a granted snapshot outside its capability maps to scope-mismatch, and a false required
zero-spend declaration maps to zero-spend-violation. A translator MUST NOT choose from the retired
string alone. If the structured discriminator is absent or conflicting, the alias-bearing input is
rejected as market.input-invalid. The same rule applies to revision, timestamp, sequence, artifact,
instrument, session, and endpoint details.

Consolidating aliases under a required closed detail enum preserves the exact trigger and
subject/fact applicability while honoring the maximum of 64 reason definitions. It does not merge,
raise, or weaken any byte/item/time/state bound.

## 8. Applicability and validator rules

Applicability is normative:

- quote-only codes cannot attach to trade/bar facts;
- trade-only codes cannot explain a quote;
- bar-only codes cannot explain prior close;
- official-close failure uses prior-close plus underlying instrument/session/action cause;
- metric-endpoint-missing wraps but never replaces the underlying reference reason;
- corrections annotate immutable revisions/views and never mutate original facts;
- provider discrepancy diagnostics never change provider results; and
- operation rejection cannot be downgraded to selected-degraded.

The validator MUST:

1. accept only the 63 exact canonical strings above;
2. reject every mr.* value and every retired market.* alias;
3. require and validate the exact closed detail field where declared;
4. validate code/disposition/scope/subject/fact compatibility;
5. validate one typed `reason` for missing/rejected and null for selected;
6. validate sorted unique typed `diagnostics` containing only diagnostic definitions;
7. require bounded limitKind for market.bound-exceeded;
8. preserve upstream reasons separately without accepting them as PR 2D codes;
9. produce identical reason/detail/diagnostics across input order, page size, restart, replay, and
   backend; and
10. cover all 63 definitions, every detail value, retired spelling, priority collision, exact bound,
    and one-over bound with redistribution-safe synthetic tests.

Catalog version and digest are part of selectionPolicyId, missing-result identity, fixture manifest,
acceptance evidence, and study freeze. Adding, deleting, renaming, reprioritizing, changing detail,
or changing applicability creates a new catalog version and requires pre-outcome contract review.
