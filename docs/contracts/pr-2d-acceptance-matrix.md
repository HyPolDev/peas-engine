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

The integration owner must bind each logical ID to the accepted document digest/commit before the
contract checkpoint. No implementation may accept `latest`, a path alone, or a mutable display
title as contract authority.

| Logical contract ID | Semantic authority |
| --- | --- |
| `peas/adr-0010/v1` | Accepted market-reference and event-study decision, including H-001 |
| `peas/market-provider-source-identity/v1` | Provider/dataset/feed/instrument/fact/observation/revision/result identity |
| `peas/market-timestamp-trust/v1` | Timestamp, sequence, clock, anchor, and session trust |
| `peas/market-eligibility/v1` | Quote/trade/bar/prior-close/session/correction selection |
| `peas/market-reason-catalog/v1` | Closed `market.*` and `study.*` reasons/flags |
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

## H-001, timestamp, selection, and metric evidence

| ID | Contract IDs | Required executable proof | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| `AM-TM-001` | ADR0010, timestamp, eligibility | Durable capture is the implicit/default primary only under accepted H-001; retrieval is mandatory sensitivity. Missing explicit policy/default mismatch fails. | `M-02`, contract vectors | `REQUIRED_PENDING` |
| `AM-TM-002` | timestamp | Retrieval basis retains exact PR 2C `retrievedAtMs` semantics and is never described or hashed as transport/response completion. | schema rejection/vector | `REQUIRED_PENDING` |
| `AM-TM-003` | timestamp | Capture-minus-retrieval is emitted when both bases validate; incompatible clocks, missing basis, wall regression, monotonic regression/session mismatch fail or type missing exactly. | anchor/clock matrix | `REQUIRED_PENDING` |
| `AM-SEL-001` | eligibility | Every Q/L/B point selector uses only facts with event time `<= target`; an otherwise eligible fact at target+1 ns is ignored. | `Q-03`, `M-01` | `REQUIRED_PENDING` |
| `AM-SEL-002` | eligibility | Release-gap origin is the last eligible quote strictly `< Tpub`; destination is as-of durable-capture Q0. Quote at Tpub cannot become origin and first-after selection is impossible. | `M-01` | `REQUIRED_PENDING` |
| `AM-SEL-003` | eligibility | T0/T1/T5/T30 are exact UTC offsets; no snapping to quote, bar, minute, or wall-clock boundary; duplicate/omitted/fifth target rejects. | target-vector tests | `REQUIRED_PENDING` |
| `AM-SEL-004` | eligibility | Missing Q0 independently makes only dependent quote metrics missing; other target evidence is still evaluated and recorded. | `M-03` | `REQUIRED_PENDING` |
| `AM-MET-001` | eligibility | Prior-close, release-gap, and residual +1/+5/+30 outputs use exact reduced rational arithmetic and bind endpoint result IDs, times, sessions, age, view, basis, and policies. | `M-01`, exact numeric vectors | `REQUIRED_PENDING` |
| `AM-MET-002` | eligibility | Quote, last-eligible-trade, and completed-bar results/metrics remain differently typed/named; available trade/bar never fills missing quote. | `M-04` | `REQUIRED_PENDING` |
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
| `AM-REV-001` | provider-source, eligibility | Correction/cancellation creates immutable targeted revision; original remains. As-recorded and later-corrected views select exact expected states. | `R-01..03` | `REQUIRED_PENDING` |
| `AM-REV-002` | provider-source | Orphan, fork, cycle, reused revision key, over-depth chain, and correction of unsupported cancellation fail closed in every arrival order. | `R-06`, bound cases | `REQUIRED_PENDING` |
| `AM-DUP-001` | provider-source | Same identity+digest redelivery applies once but retains deliveries; same identity+different digest without edge conflicts; same values across providers stay distinct. | `R-04..05`, `D-01` | `REQUIRED_PENDING` |
| `AM-ORD-001` | timestamp | Trusted source sequence beats arrival order; gaps/resets/retransmissions/regressions and equal-time ambiguity have exact fail/recovery behavior. Artifact ordinal never claims market order. | `Q-12..13`, `O-02` | `REQUIRED_PENDING` |
| `AM-INS-001` | provider-source, eligibility | Effective-dated alias continuity only with authoritative same-issue/share-class evidence; symbol reuse, ambiguous class/CUSIP-like change, and unsupported bridge fail. | `I-01..03` | `REQUIRED_PENDING` |
| `AM-CA-001` | provider-source, eligibility | Corporate action crossing makes primary comparison missing; pure split/cash sensitivity is exact; merger/spin/ADR/combined/ambiguous actions never guess. | `C-01..04` | `REQUIRED_PENDING` |
| `AM-DIS-001` | provider-source, study | Independent provider results yield deterministic `agree|disagree|not-comparable`; primary missing is never filled, equal facts retain provenance, and provider priority cannot change. | `D-01..03` | `REQUIRED_PENDING` |
| `AM-MISS-001` | reason catalog | Every selected/missing/rejected result uses exactly one closed primary reason plus sorted closed flags; provider/free-form error text never enters identity. | complete case/reason matrix | `REQUIRED_PENDING` |

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
| `AM-ST-003` | study | Sampling frame snapshot alone controls lane/strata/rank/allocation; later per-event T-1 snapshots annotate drift and cannot change selection. | frame/T-1 mutation matrix | `REQUIRED_PENDING` |
| `AM-ST-004` | study | SHA-256 rank and capacity-aware Hamilton floors/remainders/ties/exhaustion recompute exactly under every input order; unknown cells explicit; insufficient quota blocks start. | ranking/allocation vectors | `REQUIRED_PENDING` |
| `AM-ST-005` | study | Freeze/calendar dates derive from gate GO timestamps, freeze strictly precedes S6 open, collection is S15..S79, and an outcome before freeze rejects. | calendar/freeze boundary tests | `REQUIRED_PENDING` |
| `AM-ST-006` | study | Cancelled, shifted, missed, duplicate, halted, contaminated, missing, disagreeing, or corrected cluster remains in fixed N=180; no replacement or denominator shrink. | attrition permutation matrix | `REQUIRED_PENDING` |
| `AM-ST-007` | study | Every forbidden actual outcome/provider success/price/latency/result/correction/post-frame field in a pre-outcome object rejects before ranking and without value echo. | one-field-at-a-time leakage matrix | `REQUIRED_PENDING` |
| `AM-ST-008` | study, eligibility | E1 completeness, E2 conservative 15-minute timing, E3 half-spread residual information, and E4 reproduction use fixed n=180 and exact quote/reference rules. | metric golden vectors | `REQUIRED_PENDING` |
| `AM-ST-009` | study | Wilson calculation uses pinned z/precision/sqrt/rounding; lower/upper equality and one unit around 0.75/0.70/0.25 yield exact GO/NO_GO/inconclusive. | threshold vectors | `REQUIRED_PENDING` |
| `AM-ST-010` | study | Missing is not-success for primary rates; no primary imputation; valid extremes retained; invalid price is missing; winsorized/missing-bound sensitivities cannot alter gate. | missing/outlier matrix | `REQUIRED_PENDING` |
| `AM-ST-011` | study | Holm has exactly 24 slots, missing slot p=1, tied p uses slot ID; bootstrap has exactly 10,000 lane-stratified deterministic rejection-sampled replicates. | Holm/bootstrap vectors | `REQUIRED_PENDING` |
| `AM-ST-012` | study, provider-source | As-recorded cutoff prevents correction look-ahead; later-corrected cutoff exactly T0+604800000 ms includes equality and excludes +1 ms; dataset freezes after all cutoffs. | correction-cutoff matrix | `REQUIRED_PENDING` |
| `AM-ST-013` | study | Dataset freeze contains exactly one entry per frozen cluster, complete attrition/denominator tables and selected/missing IDs, while pre-outcome design/selection fields remain byte-identical. | dataset-freeze differential | `REQUIRED_PENDING` |

## Bound-coverage ledger

Every canonical bound row in `peas/market-resource-bounds/v1`, plus every fixture/study bound below,
must produce machine-readable evidence `{boundId,exactCaseId,oneOverCaseId,exactResult,oneOverReason}`.
No aggregate “bounds tested” boolean is sufficient.

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

The exact case must pass and the one-over case must fail with the canonical bound reason before
partial materialization. A declared in-limit size paired with actual growth one over must fail on
the actual verified read.

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
