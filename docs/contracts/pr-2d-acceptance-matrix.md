# PR 2D recorded market-reference acceptance matrix

## Status rules

- Matrix status: `PROPOSED`
- Current implementation evidence: none
- Every row below: `REQUIRED_PENDING`
- P1-09: `PENDING`; live acquisition and the P2 run remain blocked

`REQUIRED_PENDING` means the contract requires executable evidence but no implementation/test
result has been accepted. A contract audit may verify that the row is specified; it must not mark a
row passed. A row becomes `PASSED` only after Wave 4 code/fixtures/tests exist, the named command
passes on the exact implementation SHA, and the independent final review accepts that evidence.

This matrix cross-links:

- [`pr-2d-provider-source-identity.md`](pr-2d-provider-source-identity.md)
- [`pr-2d-timestamp-trust.md`](pr-2d-timestamp-trust.md)
- [`pr-2d-market-eligibility.md`](pr-2d-market-eligibility.md)
- [`pr-2d-reason-codes.md`](pr-2d-reason-codes.md)
- [`pr-2d-resource-bounds.md`](pr-2d-resource-bounds.md)
- [`pr-2d-fixture-manifest.md`](pr-2d-fixture-manifest.md)
- [`pr-2d-study-freeze-manifest.md`](pr-2d-study-freeze-manifest.md)
- accepted ADR 0010 and the H-001 record in
  [`pr-2d-orchestration.md`](../goals/pr-2d-orchestration.md)

## Contract identity registry

The integration owner first commits the exact contract content, then materializes the external
`ContractAuthorityRegistryV1` record in a follow-on publication commit before the independent
review checkpoint. No implementation may accept `latest`, a path alone, or a mutable display title
as contract authority.

| Logical contract ID | Semantic authority |
| --- | --- |
| `peas/adr-0010/v1` | Accepted market-reference and event-study decision, including H-001 |
| `peas/market-provider-source-identity/v1` | Provider/dataset/feed/instrument/fact/observation/revision/result identity |
| `peas/market-timestamp-trust/v1` | Timestamp, sequence, clock, anchor, and session trust |
| `peas/market-eligibility/v1` | Quote/trade/bar/prior-close/session/correction selection |
| `peas/market-reason-catalog/v1` | Closed 63-definition `market.*` catalog, details, priority, and applicability |
| `peas/study-reason-catalog/v1` | Closed 33-definition `study.*` catalog, preservation, details, priority, and applicability |
| `peas/market-resource-bounds/v1` | Canonical exact byte/item/key/depth/window/state bounds |
| `peas/market-fixture-manifest/v1` | Original-synthetic recorded fixture contract |
| `peas/study-freeze-manifest/v1` | N=180 pre-outcome design, selection, and dataset-freeze contract |
| `peas/market-acceptance-matrix/v1` | This required-evidence matrix |

## Planned executable surfaces

Filenames are planned Wave 4 ownership targets, not evidence that files currently exist:

- `test/market-reference-contract.test.ts`
- `test/market-reference-fixture.test.ts`
- `test/market-reference-selection.test.ts`
- `test/market-reference-replay.test.ts`
- `test/market-reference-persistence.test.ts`
- `test/study-freeze-manifest.test.ts`
- `test/market-reference-provenance.test.ts`
- `test/market-reference-effect-isolation.test.ts`

All tests are offline and use only the original-synthetic fixture catalog. The complete relevant
PR 2C/storage/replay suite remains required as regression evidence.

## Identity, authority, and inert-boundary evidence

| ID | Contract IDs | Required executable proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-ID-001` | provider-source, fixture | Golden RFC 8785 preimage/domain/prefix vectors recompute every provider, entitlement, dataset, feed, venue/tape, instrument, acquisition, artifact, observation, delivery, revision, fact, selection, missing, discrepancy, fixture, study, and dataset ID. | contract tests | `REQUIRED_PENDING` |
| `AM-ID-002` | provider-source | Historical SIP, delayed stream, latest delayed, IEX, overnight, and provider-defined/FMP-like surfaces remain distinct identities with coincident values. | `Q-15`, `D-01` | `REQUIRED_PENDING` |
| `AM-ID-003` | provider-source | Identical bytes under two provider/source observations may share content digest but retain distinct provider, entitlement, observation, delivery, revision, and selection identities. | provenance tests | `REQUIRED_PENDING` |
| `AM-ID-004` | provider-source, fixture | ArtifactStore exact observation lookup and bounded verified complete read reconcile provider/observation/hash/digest/size/as-of facts before parsing. Declaration-only, missing, forged, future, wrong-provider, under/over/growing/replaced reads fail without partial output. | fixture authority tests, `X-04` | `REQUIRED_PENDING` |
| `AM-ID-005` | all contracts | Every public constructor/validator rejects unknown, missing, inherited, accessor, symbol, proxy, sparse, cyclic, duplicate-key, unsafe/nonfinite, and over-limit values before getter/trap execution or hashing. | `X-01`, hostile-boundary counters | `REQUIRED_PENDING` |
| `AM-ID-006` | provider-source | Same provider stable identity with changed content and no explicit revision quarantines independent of input/arrival order; distinct providers never collapse. | `R-05` | `REQUIRED_PENDING` |
| `AM-ID-007` | provider-source, observation ledger | `marketReferenceJoinKey` remains the exact inherited PR 2C key; prices/provider/feed/result/study outcomes do not enter it or earnings/evidence-bundle identity. | golden join vectors, regression suite | `REQUIRED_PENDING` |
| `AM-ID-008` | all contracts | The external `car1_` registry contains exactly ten sorted logical authorities over nine immutable document blobs at one exact content commit; both reason-catalog IDs intentionally bind the same reason document. Every document SHA-256, Git blob OID, path, content commit, and registry ID recomputes; missing, extra, forged, `HEAD`, branch, `latest`, path-only, self-referential, or audit-cyclic authority rejects. | registry golden/forgery vectors and independent checkpoint audit | `REQUIRED_PENDING` |
| `AM-ID-009` | provider-source, study | `StudyDesignV1` and `StudyFreezeManifestV1` each carry the same recomputed `contractAuthorityRegistryId` and exactly the ten sorted logical authority IDs in the registry. Both `std1_` and `sfm1_` primitive preimages bind them. Missing, extra, nine-only, duplicate, reordered, wrong-registry, or registry/content-commit mismatch rejects before either ID is emitted. | literal ten-authority design/freeze golden and one-mutation vectors | `REQUIRED_PENDING` |
| `AM-ID-010` | provider-source, study, fixture | The exact `scc1_` primitive preimage binds both recomputed `releaseClusterKey` and `releaseKind` in addition to representative schedule evidence. Literal one-field mutation/collision vectors prove a different `scc1_` for quarterly versus annual releases; two distinct non-null cross-source release keys; two distinct native schedule IDs; fiscal-period versus native-date cluster bases; and multiple distinct schedule items carried by one identical `scheduleSourceObservationId`. Every vector recomputes and cross-validates `releaseKind`, `plannedFiscalPeriod`, selected `clusterBasis`, `releaseClusterKey`, representative source/native evidence, and candidate fields; caller-supplied mismatches reject before hashing. | literal preimage bytes/hashes, former collision witness, and one-field mutation matrix | `REQUIRED_PENDING` |
| `AM-ID-011` | provider-source, study, fixture | Each selected `scc1_` mutation from `AM-ID-010` propagates deterministically through the containing `sfs1_`, selected `scl1_`, and `sfm1_` primitive preimages and changes every dependent displayed ID while unrelated identities remain stable. Two semantically distinct clusters in one frame coexist without `study.duplicate-cluster`; only byte-identical duplicate candidate identity or same-ID/conflicting-preimage evidence is fatal. Frame/member permutation, source packaging, restart, and backend cannot collapse the repaired identities or create a false duplicate. | downstream `sfs1_`/`scl1_`/`sfm1_` golden differential and no-false-duplicate vectors | `REQUIRED_PENDING` |

## H-001, timestamp, selection, and metric evidence

| ID | Contract IDs | Required executable proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-TM-001` | ADR0010, timestamp, eligibility | The accepted explicit H-001 policy names durable capture as primary and retrieval as mandatory sensitivity. An absent policy, capture mismatch, retrieval omission, or reinterpretation of retrievedAtMs fails with the exact canonical direct-key anchor reason. | `M-02`, explicit-policy accept/reject vectors | `REQUIRED_PENDING` |
| `AM-TM-002` | timestamp | Retrieval basis retains exact PR 2C `retrievedAtMs` semantics and is never described or hashed as transport/response completion. | schema rejection/vector | `REQUIRED_PENDING` |
| `AM-TM-003` | timestamp | Capture-minus-retrieval is emitted when both bases validate; incompatible clocks, missing basis, wall regression, monotonic regression/session mismatch fail or type missing exactly. | anchor/clock matrix | `REQUIRED_PENDING` |
| `AM-SEL-001` | eligibility | Every Q/L/B point selector uses only facts with event time `<= target`; an otherwise eligible fact at target+1 ns is ignored. | `Q-03`, `M-01` | `REQUIRED_PENDING` |
| `AM-SEL-002` | eligibility | Release-gap origin is the last eligible quote strictly `< Tpub`; destination is as-of durable-capture Q0. Quote at Tpub cannot become origin and first-after selection is impossible. | `M-01` | `REQUIRED_PENDING` |
| `AM-SEL-003` | eligibility | T0/T1/T5/T30 are exact UTC offsets; no snapping to quote, bar, minute, or wall-clock boundary; duplicate/omitted/fifth target rejects. | target-vector tests | `REQUIRED_PENDING` |
| `AM-SEL-004` | eligibility | Missing Q0 independently makes only dependent quote metrics missing; other target evidence is still evaluated and recorded. | `M-03` | `REQUIRED_PENDING` |
| `AM-MET-001` | eligibility | Prior-close, release-gap, and residual +1/+5/+30 outputs use exact reduced rational arithmetic and bind endpoint result IDs, times, sessions, age, view, basis, and policies. | `M-01`, exact numeric vectors | `REQUIRED_PENDING` |
| `AM-MET-002` | eligibility | `quote-nbbo-midpoint`, `trade-last-eligible-consolidated`, and `bar-one-minute-completed-close` results/metrics remain differently typed/named; available trade/bar never fills a missing quote. | `M-04` | `REQUIRED_PENDING` |
| `AM-MET-003` | eligibility | Official corrected/listing close precedence is exact; final trade or daily bar can appear only as labeled sensitivity. | `PCL-01..03` | `REQUIRED_PENDING` |
| `AM-MET-004` | eligibility, bounds | Decimal coefficient/scale/midpoint and signed rational return canonicalization has exact boundary/one-over, zero denominator, negative/zero eligible price, and no IEEE-754 drift. | `Q-01`, `Q-02`, numeric bounds | `REQUIRED_PENDING` |

## Quote, trade, bar, session, and market-state evidence

| ID | Contract IDs | Required executable proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-Q-001` | timestamp, eligibility | Primary quote requires explicit consolidated SIP NBBO, known versioned condition semantics, exact instrument/USD, two positive sides, and complete sequence state. | `Q-01`, `Q-05`, `Q-09` | `REQUIRED_PENDING` |
| `AM-Q-002` | eligibility | Locked and eligible-slow quotes are degraded primary; strict sensitivity excludes. Crossed and one-sided quotes are missing. | `Q-05..08` | `REQUIRED_PENDING` |
| `AM-Q-003` | eligibility, bounds | Regular age exactly 5 s and extended age exactly 30 s are eligible; +1 ns is stale. Frozen sensitivity grid stays separately labeled. | `Q-04`, extended boundary case | `REQUIRED_PENDING` |
| `AM-Q-004` | eligibility | BOLO/odd-lot quote, one venue, partial venue set, provider latest, bar, and overnight facts cannot reconstruct or mutate protected NBBO. | `Q-14`, `S-05` | `REQUIRED_PENDING` |
| `AM-T-001` | eligibility | Consolidated Last uses explicit update evidence or full condition-combination/day-state replay; single-character heuristics fail closed. | `T-01..05` | `REQUIRED_PENDING` |
| `AM-T-002` | eligibility | Odd lot, extended/out-of-sequence, average/bunched, seller, contingent, and conditional cases follow pinned matrices and preserve execution/publication timestamps. | `T-02..05` | `REQUIRED_PENDING` |
| `AM-B-001` | eligibility | A bar is unadjusted, exactly 60 seconds, and completed by target; containing/open bar is future-contaminated. Adjusted/unadjusted identities remain separate. | `B-01..03` | `REQUIRED_PENDING` |
| `AM-SES-001` | timestamp, eligibility | Frozen exchange calendar/tzdb controls holiday, early close, regular/pre/post, half-open boundaries, both DST transitions, and session-transition missingness. | `S-01..04` | `REQUIRED_PENDING` |
| `AM-SES-002` | eligibility | Overnight/closed sources are excluded from primary and cannot update regular/extended state. | `S-05` | `REQUIRED_PENDING` |
| `AM-STATE-001` | eligibility | Cross-SRO/market-wide halt, quote/trade resume separation, participant-only halt, LULD executable/limit/nonexecutable, wipeout, reset, and reopening do not backfill a target. | `Q-10..12` | `REQUIRED_PENDING` |

## Corrections, duplicates, ordering, instruments, and provider disagreements

| ID | Contract IDs | Required executable proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-REV-001` | provider-source, eligibility | Correction/cancellation creates an immutable targeted revision; original remains. `recorded-primary` and `recorded-corrected` select the exact expected corpus states. | `R-01..03` | `REQUIRED_PENDING` |
| `AM-REV-002` | provider-source | Orphan, fork, cycle, reused revision key, over-depth chain, and correction of unsupported cancellation fail closed in every arrival order. | `R-06`, bound cases | `REQUIRED_PENDING` |
| `AM-DUP-001` | provider-source | Same identity+digest redelivery applies once but retains deliveries; same identity+different digest without edge conflicts; same values across providers stay distinct. | `R-04..05`, `D-01` | `REQUIRED_PENDING` |
| `AM-ORD-001` | timestamp | Trusted source sequence beats arrival order; gaps/resets/retransmissions/regressions and equal-time ambiguity have exact fail/recovery behavior. Artifact ordinal never claims market order. | `Q-12..13`, `O-02` | `REQUIRED_PENDING` |
| `AM-INS-001` | provider-source, eligibility | Effective-dated alias continuity only with authoritative same-issue/share-class evidence; symbol reuse, ambiguous class/CUSIP-like change, and unsupported bridge fail. | `I-01..03` | `REQUIRED_PENDING` |
| `AM-CA-001` | provider-source, eligibility | Corporate action crossing makes primary comparison missing; pure split/cash sensitivity is exact; merger/spin/ADR/combined/ambiguous actions never guess. | `C-01..04` | `REQUIRED_PENDING` |
| `AM-DIS-001` | provider-source, study | Independent provider results yield exactly `agree`, `disagree`, or `not-comparable`; primary missing is never filled, equal facts retain provenance, and provider priority cannot change. | `D-01..03` | `REQUIRED_PENDING` |
| `AM-MISS-001` | market reason catalog | Every selected result has null reason, every missing result has one canonical reason, and every rejected operation has one canonical failure reason but no market result or result ID. Sorted diagnostics are closed, and provider/free-form error text never enters identity. | complete market result/failure reason matrix | `REQUIRED_PENDING` |

## Closed reason-catalog evidence

| ID | Contract IDs | Required executable proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-RSN-001` | market reason catalog | Enumerate exactly 63 unique `market.*` definitions and unique numeric priorities; every code, required detail value, null-detail case, disposition, scope, applicability, retired alias, and collision vector validates or rejects exactly. | exhaustive generated catalog vectors | `REQUIRED_PENDING` |
| `AM-RSN-002` | study reason catalog | Enumerate exactly 33 unique `study.*` definitions and unique numeric priorities; every code, required detail value, null-detail case, disposition, scope, applicability, and unknown/retired spelling validates or rejects exactly. | exhaustive generated study catalog vectors | `REQUIRED_PENDING` |
| `AM-RSN-003` | study reason catalog | Missing, extra, inherited, accessor, symbol, proxy, sparse, cyclic, duplicate-key, wrong-code/detail, wrong-disposition, wrong-scope, wrong-subject, and noncanonical-order `StudyReasonV1` values reject as `study.input-invalid` before hashing or value echo. | one-mutation-at-a-time hostile schema vectors | `REQUIRED_PENDING` |
| `AM-RSN-004` | market reason catalog, study reason catalog | Every fatal collision selects the lowest numeric applicable reason independent of input order; frame dispositions remain pre-rank counts; retained outcomes never change N=180; metric-missing is metric-local; annotations sort uniquely by canonical tuple. | all-pairs priority and permutation matrix | `REQUIRED_PENDING` |
| `AM-RSN-005` | market reason catalog, study reason catalog | Every study reason requiring market evidence carries an exact immutable `marketResultId` plus byte-equal canonical market code/disposition/scope/detail. Missing, partial, forged, differently detailed, replaced, or generic study substitution rejects; the original market reason remains independently queryable. | bidirectional preservation and forgery vectors | `REQUIRED_PENDING` |
| `AM-RSN-006` | reason catalog, bounds | The 64-definition ceiling applies independently to each namespace: 64 market or study definitions validates; 65 in either yields `{code:"study.bound-exceeded",detail:{limitKind:"reasonDefinitions"}}`. Counts are never summed across namespaces. | 63/64/65 per-namespace vectors | `REQUIRED_PENDING` |
| `AM-RSN-007` | provider-source, reason catalogs, bounds, fixture, study | Every surface uses byte-identical `CanonicalReasonV1={code,detail}` and a null or singleton direct-key detail. `{field,value}`, scalar detail, top-level or sibling `limitKind`, separate detail, second detail channel, wrong direct key/value, and missing/extra detail reject before candidate/result/bound/fixture/study hashing. | cross-surface canonical-byte, forged-shape, and displayed-ID vectors | `REQUIRED_PENDING` |
| `AM-RSN-008` | reason catalogs, study | A rejected market operation emits `StudyDatasetValidationFailureV1` with its exact direct-key `rejectedOperationReason`, `marketResultId:null`, and `datasetFreezeId:null`. It emits no study reference row, missing/selected result, denominator entry, `mmr1_`, or `sdf1_`; forged result IDs and conversion to metric missing reject. | rejected authority/bound/identity envelope vectors | `REQUIRED_PENDING` |

## Replay, persistence, and deterministic state evidence

| ID | Contract IDs | Required executable proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-REP-001` | all market contracts | Fixture/object/member/arrival order permutations with equivalent source state produce byte-identical facts, revisions, candidate hashes, selections, metrics, and fixture/study IDs. | `O-01`, replay tests | `REQUIRED_PENDING` |
| `AM-REP-002` | provider-source, bounds | Page sizes `1`, `2`, `7`, `10,000` and provider page layouts produce identical semantic/result IDs; page tokens/order are telemetry. Token loop/gap/query substitution rejects. | `O-03`, page matrix | `REQUIRED_PENDING` |
| `AM-REP-003` | provider-source | Restart before/after observation lookup, verified read, normalization, correction application, and persisted selection yields one complete result and no partial candidate set. | restart fault matrix | `REQUIRED_PENDING` |
| `AM-REP-004` | provider-source, study | Memory and SQLite output is byte-identical for facts, results, reasons, metrics, manifest/dataset IDs, and pagination reconciliation. | persistence differential | `REQUIRED_PENDING` |
| `AM-REP-005` | observation ledger | Replay preserves semantic/market/join/study IDs and original stamps, remapping only execution-scoped ledger entries/causal parents/regression witnesses. | ledger replay integration | `REQUIRED_PENDING` |
| `AM-REP-006` | observation ledger | Active analysis lease freezes selected source/join/result IDs; later arrival creates separate branch/view and cannot mutate leased input. | lease integration | `REQUIRED_PENDING` |

## Study freeze, leakage, and analysis evidence

| ID | Contract IDs | Required executable proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-ST-001` | study | Exactly 180 unique clusters, schema range 100..200, lane targets 120/40/20, and four prospective-control groups of five validate; every +/-1 and 99/201 fails. | study manifest vectors | `REQUIRED_PENDING` |
| `AM-ST-002` | study | Control priority is identity-transition, schedule-uncertain, source-sparse, liquidity-tail; event-time outcomes cannot recruit a control. | overlapping-control/leakage fixtures | `REQUIRED_PENDING` |
| `AM-ST-003` | study | The immutable pre-frame seed commitment and sampling frame snapshot alone control lane/strata/rank/allocation; later seed choice or per-event T-1 facts reject or annotate drift and cannot change selection. | seed/frame/T-1 mutation matrix | `REQUIRED_PENDING` |
| `AM-ST-004` | study | SHA-256 rank and both first-level and second-level capacity-aware Hamilton floors/base seats/remainders/award ties/exhaustion recompute exactly under every input order; unknown cells are explicit and insufficient quota blocks start. | first/second-level ranking/allocation vectors | `REQUIRED_PENDING` |
| `AM-ST-005` | study | Freeze/calendar dates derive from gate GO timestamps, freeze strictly precedes S6 open, collection is S15..S79, and an outcome before freeze rejects. | calendar/freeze boundary tests | `REQUIRED_PENDING` |
| `AM-ST-006` | study, study reason catalog | Cancelled, shifted, missed, halted, contaminated, missing, disagreeing, or corrected selected cluster retains the exact closed study reason and preserved market reason where required, remains in fixed N=180, and cannot be replaced. Duplicate selected identity is fatal before dataset materialization. | attrition/reason/preservation permutation matrix | `REQUIRED_PENDING` |
| `AM-ST-007` | study | Every forbidden actual outcome/provider success/price/latency/result/correction/post-frame field in a pre-outcome object rejects before ranking and without value echo. | one-field-at-a-time leakage matrix | `REQUIRED_PENDING` |
| `AM-ST-008` | study, eligibility | E1 completeness, E2 conservative 15-minute timing, E3 half-spread residual information, and E4 reproduction use fixed n=180 and exact quote/reference rules. | metric golden vectors | `REQUIRED_PENDING` |
| `AM-ST-009` | study | Wilson calculation uses pinned z/precision/sqrt/rounding; lower/upper equality and one unit around 0.75/0.70/0.25 yield exact GO/NO_GO/inconclusive. | threshold vectors | `REQUIRED_PENDING` |
| `AM-ST-010` | study | Missing is not-success for primary rates; no primary imputation; valid extremes retained; invalid price is missing; winsorized/missing-bound sensitivities cannot alter gate. | missing/outlier matrix | `REQUIRED_PENDING` |
| `AM-ST-011` | study | Holm has exactly 24 slots, missing slot p=1, and tied p uses slot ID. Bootstrap uses only the one normative seed/word derivation for exactly 10,000 lane-stratified rejection-sampled replicates; no competing summary digest affects a draw. | Holm plus literal bootstrap word/draw/rejection/median/quantile vectors | `REQUIRED_PENDING` |
| `AM-ST-012` | study, provider-source | `recorded-primary` freezes first-corpus membership; `recorded-corrected` at exactly T0+604800000 ms includes equality and excludes +1 ms; neither is represented as provider-native knowledge, and the dataset freezes after all cutoffs. | correction-cutoff matrix | `REQUIRED_PENDING` |
| `AM-ST-013` | study | Dataset freeze contains exactly one entry per frozen cluster, complete attrition/denominator tables and selected/missing IDs, while pre-outcome design/selection fields remain byte-identical. | dataset-freeze differential | `REQUIRED_PENDING` |
| `AM-ST-014` | study | Rank seed grammar, byte length, hex-to-byte conversion, derivation/authority, commitment timestamp, immutability point, and frame-preimage binding recompute exactly. Trying alternate seeds after frame visibility or changing one committed seed bit rejects and cannot produce a study ID. | seed commitment, selection-resistance, and one-bit sensitivity vectors | `REQUIRED_PENDING` |
| `AM-ST-015` | study | Every market-cap stratum recomputes from exact value, shares/value date, source observation, authority version, as-of evidence, and missing predicate; every liquidity stratum recomputes from the exact retained 20-session evidence and 15-session minimum. Caller-supplied labels alone reject. | cap/liquidity evidence forgery and changed-evidence vectors | `REQUIRED_PENDING` |
| `AM-ST-016` | study | Each stratum freezes its exact comparison population, canonical ordering, rank/tertile cut points, equality/tie rule, and unknown behavior. Equivalent evidence produces byte-identical labels/membership; one evidence mutation changes only the recomputed dependent IDs/cells. | comparison-population/tie/unknown differential | `REQUIRED_PENDING` |
| `AM-ST-017` | study | The second-level cap/liquidity/session Hamilton pass has an explicit capacity-capped base-seat calculation and deterministic remainder-award loop independent of the first-level sector/model-family pass. Every zero-capacity, exhaustion, and exact-tie vector has one result. | literal two-level Hamilton golden vectors | `REQUIRED_PENDING` |
| `AM-ST-018` | study | Exactly one bootstrap derivation controls every word and draw. Literal seed, counter, rejection, lane sample-size, missingness, replicate statistic, sorted output, median, type-7 quantile, and serialization vectors agree across independent implementations and backends. | bootstrap byte-for-byte conformance corpus | `REQUIRED_PENDING` |
| `AM-ST-019` | study, eligibility, reason catalogs | If any of the six required per-cluster market operations is rejected, the entire dataset freeze is invalid: no accounting row or denominator is silently dropped, no selected/missing result ID is forged, and no dataset-freeze ID is emitted. Candidate-ineligible and metric-missing outcomes remain local and follow their normal fixed-denominator path. | rejected-operation versus local-disposition matrix | `REQUIRED_PENDING` |

## Bound-coverage ledger

Every canonical bound row in `peas/market-resource-bounds/v1` must produce machine-readable
`BoundDispositionV1` evidence plus
`{exactCaseId,upperOneOverCaseId,lowerCaseId,siblingPosition,settledBeforeReturn,
zeroPartialOutput,noPostReturnActivity}`. `lowerCaseId` is required for a range, minimum, or exact
count and null otherwise. Each disposition must match the one closed enforcement-ledger stage,
canonical `{code,detail}` reason, and atomicity. No aggregate bounds-tested boolean is sufficient.

| ID | Contract IDs | Required executable proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-BND-001` | bounds | `BoundDispositionV1` accepts only its exact closed fields/enums and all 84 unique bound IDs. Missing, extra, forged ID/stage/vector/canonical reason/atomicity, noncanonical direct detail key, parallel detail field, and duplicate ledger membership reject before hashing. | schema and complete-ID registry vectors | `REQUIRED_PENDING` |
| `AM-BND-002` | bounds | Each of 84 bound IDs reaches the named public stage at exact acceptance and produces the sole ledger disposition at upper one-over; ranges/minimums/exact counts also produce the sole lower-one-below or exact-count-minus-one disposition. | generated 84-row exact/upper/lower matrix | `REQUIRED_PENDING` |
| `AM-BND-003` | bounds | A 65-byte timestamp yields only `{code:"market.bound-exceeded",detail:{limitKind:"timestampTextBytes"}}`; a 21-digit primary coefficient yields only `{code:"market.decimal-invalid",detail:null}` at operation scope; 65 instruments and a ninth query date yield only their direct-key bound reasons and never validator splitting. | R2D-CONTRACT-006 regression vectors | `REQUIRED_PENDING` |
| `AM-BND-004` | bounds | Pre-acquisition planner splitting is a separately identified operation completed before validation; recorded parser/validator one-over input always rejects and never silently starts another acquisition. | planner/validator isolation vectors | `REQUIRED_PENDING` |
| `AM-BND-005` | bounds | Declared-in-limit/actual-one-over and stream growth/replacement fail on verified actual size. Violating siblings in first/middle/last position settle every acquired stream before return, emit zero partial output, and schedule no post-return activity. | fault-injected stream/member matrix | `REQUIRED_PENDING` |
| `AM-BND-006` | bounds, fixture, reason catalogs | Quote-age +1 is candidate-only `{code:"market.quote-stale",detail:null}`; capture/retrieval lag +1 is metric-local `{code:"market.timestamp-insufficient",detail:{timestampFailureKind:"capture-retrieval-lag-exceeded"}}`; liquidity one-below, timely +1, and correction +1 produce only their exact closed study reasons without changing the frozen cohort. None is rewritten as operation-terminal bound failure. | threshold classification and fixture-oracle vectors | `REQUIRED_PENDING` |
| `AM-BND-007` | bounds, fixture | The executable fixture bound registry contains exactly the same 84 canonical bound IDs as the authoritative enforcement ledger, with no fixture-only aliases. For every exact/upper/lower/count-minus-one vector, fixture stage, vectorKind, accepted, canonical `{code,detail}`, and atomicity equal the ledger byte-for-byte in both directions. | generated ledger-to-fixture and fixture-to-ledger equivalence proof | `REQUIRED_PENDING` |
| `AM-BND-008` | bounds, fixture, provider-source | Bound fixture results recompute every candidate-set, selected/missing, and study evidence ID from the same direct-key reason bytes. A separate `limitKind`, null detail plus sibling limit, `{field,value}`, forged canonical ID, or candidate/metric-local outcome promoted to operation rejection fails before any displayed ID is emitted. | reason-byte and result-ID forgery vectors | `REQUIRED_PENDING` |

| Bound family | Required boundary members | Status |
| --- | --- | --- |
| Raw/manifest bytes | member, aggregate members, record, fixture manifest, cluster entry, freeze manifest, dataset bundle, canonical output | `REQUIRED_PENDING` |
| Structural JSON | depth, total nodes/tokens, keys per object/record, generic/named arrays, duplicate key, decoded string bytes | `REQUIRED_PENDING` |
| Identity/text | identity component, generic string, timestamp text, opaque native ID, symbol, condition member | `REQUIRED_PENDING` |
| Numeric | coefficient digits, source scale, midpoint scale, rational component, safe integer, signed-ns range | `REQUIRED_PENDING` |
| Source state | records, conditions, correction depth, deliveries, members/artifacts, profiles/providers, instruments, centers, sequences/conflicts | `REQUIRED_PENDING` |
| Paging/windows | page size min/max, page/member count, query/calendar dates, selection requests/results, target set, +30m horizon | `REQUIRED_PENDING` |
| Market eligibility | regular/extended age exact/+1, bar 60s, session boundary, correction cutoff, target+1 ns | `REQUIRED_PENDING` |
| Study structure | frame 8192/8193, cells 2048/2049, 180 and 100..200, lane/control +/-1, references/revisions/annotations | `REQUIRED_PENDING` |
| Study time/statistics | 65 sessions, 120 days/+1 ms, 20/15 liquidity, 900000/900001 latency, 604800000/+1 correction, 10000/10001 bootstrap, 24/25 Holm | `REQUIRED_PENDING` |

The exact case must pass. Every upper-one-over, lower-one-below, and exact-count-minus-one case must
produce its sole closed-ledger disposition before partial materialization. A declared in-limit size
paired with actual growth one over must fail on the actual verified read.

## Licensing, zero-spend, effect, and compatibility evidence

| ID | Contract IDs | Required executable/audit proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-SAFE-001` | fixture | Every checked-in body/manifest is original synthetic, fictional, invalid-domain, and carries exact provenance; repository scan finds no provider body/example/licensed identifier set. | provenance closure | `REQUIRED_PENDING` |
| `AM-SAFE-002` | fixture | Network witness proves zero DNS/HTTP/HTTPS/WebSocket/browser/SDK attempts in every fixture/test path. | effect-isolation test | `REQUIRED_PENDING` |
| `AM-SAFE-003` | fixture, provider-source | Credential/account/cookie/header/URL/path/private correspondence fields reject before hash/log/error and are never echoed. | secret hostility scan/test | `REQUIRED_PENDING` |
| `AM-SAFE-004` | provider-source, study | Pending/denied/expired/wrong entitlement, paid capability, or unapproved fallback fails before body/provider access; `synthetic-offline-v1` cannot authorize a run. | `E-01..02`, P1-09 gate tests | `REQUIRED_PENDING` |
| `AM-SAFE-005` | provider-source | Configuration enforces zero incremental spend and no trial/subscription/account/professional/display change; paid Alpaca/FMP Ultimate/IBKR/other sources are not selectable. | config validator tests/audit | `REQUIRED_PENDING` |
| `AM-SAFE-006` | all contracts | No EventLog, ProcessingStore, ArtifactStore, EventDraft, observation-ledger, or kernel port signature changes; no migration/dependency/Docker change. | API snapshots and git diff audit | `REQUIRED_PENDING` |
| `AM-SAFE-007` | all contracts | No broker/order/portfolio/position/fill/dispatchable row or financial effect in live-style, replay, research, shadow, or paper modes. | effect-isolation and persistence query | `REQUIRED_PENDING` |
| `AM-SAFE-008` | all contracts | No live HTTP/WebSocket/acquisition implementation or network-dependent test; all provider acquisition remains deferred to P1-10 after P1-09 GO. | source scan/import graph/audit | `REQUIRED_PENDING` |

## Required validation commands after implementation

The implementation candidate must record exact command output, totals, failures, skips, platform
limitations, and exact SHA for:

```text
npm.cmd run verify:runtime
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run check
node --test --test-concurrency=1 <all focused PR2D and relevant PR2C/storage/replay suites>
git diff --check
```

Focused evidence must include every planned test surface, every bound ledger member, fixture
provenance closure, network/effect witnesses, identity vectors, page/restart/order/backend
differentials, and study leakage/threshold vectors. Windows and required Linux CI must pass on the
same final candidate SHA. Until then, all matrix rows remain `REQUIRED_PENDING`.
