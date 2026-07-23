# ADR 0010: Recorded market-reference and event-study contract

- Status: Accepted; independent contract `GO` on
  `750e1ab2486ce785a60304fceb19a1502ff34319`
- Date: 2026-07-23
- Contract authority registry:
  `car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad`
- Contract audit: [`pr-2d-contract-final-go.md`](../audit/pr-2d-contract-final-go.md)
- Implementation candidate: `9dcefde1954c8426312fb082950b6105fe6847f6`
- Final implementation audit:
  [`pr-2d-final-reaudit.md`](../audit/pr-2d-final-reaudit.md), independent `GO`; the replaced
  candidate's `NO_GO` remains preserved in
  [`pr-2d-final-review.md`](../audit/pr-2d-final-review.md)
- Scope: provider-neutral recorded/offline market evidence and pre-outcome study freeze
- Compatibility: additive sidecar contract; no frozen port, reducer, migration, dependency, or
  financial-effect change

## Decision summary

PEAS will model market evidence as an independent immutable source family joined through ADR 0009's
unchanged `marketReferenceJoinKey`. Market prices, providers, feeds, timestamps, results, and study
outcomes never change earnings-event, provider evidence-bundle, or deterministic-kernel identity.

The human owner approved the material scientific choices on 2026-07-23:

1. the primary PEAS observation anchor is the existing trusted **durable capture** basis;
2. the existing trusted retrieval basis is a mandatory sensitivity and remains labeled by its exact
   recorded semantics; `retrievedAtMs` is not transport response completion;
3. a point reference at `T0`, `T0+1m`, `T0+5m`, or `T0+30m` is the last eligible fact whose trusted
   market event time is less than or equal to that exact target; and
4. release-gap origin is the last eligible quote strictly before trusted publication. A
   first-after-target selector is forbidden because it introduces look-ahead.

PR 2D freezes contracts, original synthetic fixtures, pure bounded normalization and selection,
recorded replay, and study-manifest validation. It adds no live HTTP/WebSocket client, polling,
subscription, provider request, licensed raw fixture, credential, account action, paid capability,
broker/order/portfolio code, or dispatchable effect.

The normative detail is split across:

- [`pr-2d-provider-source-identity.md`](../contracts/pr-2d-provider-source-identity.md);
- [`pr-2d-timestamp-trust.md`](../contracts/pr-2d-timestamp-trust.md);
- [`pr-2d-market-eligibility.md`](../contracts/pr-2d-market-eligibility.md);
- [`pr-2d-reason-codes.md`](../contracts/pr-2d-reason-codes.md);
- [`pr-2d-resource-bounds.md`](../contracts/pr-2d-resource-bounds.md);
- [`pr-2d-fixture-manifest.md`](../contracts/pr-2d-fixture-manifest.md);
- [`pr-2d-acceptance-matrix.md`](../contracts/pr-2d-acceptance-matrix.md); and
- [`pr-2d-study-freeze-manifest.md`](../contracts/pr-2d-study-freeze-manifest.md).

## Context and evidence

The decision reconciles four independently authored reports:

- [`pr-2d-market-microstructure.md`](../research/pr-2d-market-microstructure.md);
- [`pr-2d-alpaca-fmp-contract.md`](../research/pr-2d-alpaca-fmp-contract.md);
- [`pr-2d-market-identity-replay.md`](../research/pr-2d-market-identity-replay.md); and
- [`pr-2d-event-study-design.md`](../research/pr-2d-event-study-design.md).

All four found that retrieval and durable capture answer different questions and can select
different market states. Durable capture measures when a normalized earnings observation was
durably available to the operational PEAS system. It includes verified-read, normalization,
persistence, and scheduling latency; that latency is part of the operational claim. Retrieval is an
earlier sensitivity measuring the exact recorded artifact-retrieval epoch, not an invented network
clock. When both bases are trusted, the dataset records capture-minus-retrieval latency and computes
both policy-versioned result branches from the same immutable evidence.

The microstructure report used as-of target selection. The event-study report proposed first
eligible facts at or after targets. The latter was rejected: it uses information later than the
measurement instant, makes latency variable with quote frequency, and can move facts across the
fixed residual windows. The accepted selector is as-of with an explicit staleness limit.

## Independent identity graph

```text
provider + entitlement snapshot
  -> dataset -> endpoint/channel -> feed -> venue/tape
  -> acquisition sidecar -> verified raw artifact evidence -> delivery
  -> provider observation -> immutable revision -> normalized market fact
  -> bounded candidate set + frozen selection policy
  -> selected reference | typed missing reference
  -> provider discrepancy -> frozen study entry

earnings observation -> unchanged marketReferenceJoinKey --------------------^
```

Provider observations remain distinct when bytes or economic values agree. Identical bytes may
share only content identity. They do not collapse provider, entitlement, dataset, endpoint, feed,
observation, delivery, or revision identity. Byte-different corrections and cancellations create
new immutable revisions and never overwrite earlier evidence. Same-provider stable-key conflicts
without a valid revision edge quarantine the equivalence class in every arrival order.

All displayed identities are recomputed from versioned domain separators and exact inert canonical
preimages. Unknown values are explicit nulls, never empty strings, zeroes, defaults, inferred feeds,
current symbols, retrieval times, or wall clocks. Prices, sizes, ratios, and returns use canonical
decimal integers/scales or reduced rationals; IEEE-754 values are not semantic inputs. URLs, paths,
credentials, headers, tokens, account IDs, page size, insertion order, and processing wall time are
excluded from market-fact and earnings identities.

## Clock and observation semantics

The contract keeps separate:

- exchange/participant market event time and its precision;
- SIP publication time and protocol-scoped sequence evidence;
- provider receive time when documented;
- request start and any future separately contracted response-completion time;
- ADR 0009 `retrievedAtMs` on the exact raw artifact link;
- ArtifactStore commit and verified-read evidence;
- durable earnings capture `receivedAtMs`, logical time, and clock basis;
- correction effective time and correction durable-arrival time;
- normalization/selection telemetry; and
- replay remapping, which creates no new semantic clock.

The primary anchor is exactly ADR 0009's capture basis
`{basisKind:"capture",eventId,receivedAtMs,logicalAtMs,clockBasisId}`. Its complete
`marketReferenceJoinKey` is input to market selection. The mandatory sensitivity uses ADR 0009's
exact retrieval basis. No PR 2D type alters either preimage or adds a ledger fact kind.

Clock precision, semantics, maximum error, wall/monotonic basis, monotonic session, and regression
witness are closed data. A timestamp never substitutes for another class. Provider page order is
not market order. Gaps, unknown resets, equal-time conflicts without a documented tie-break, and
incompatible clocks fail closed.

## Sessions, instruments, and regimes

Session intervals come from a versioned primary-listing-exchange calendar and pinned
`America/New_York` timezone database. Half-open UTC intervals distinguish regular continuous,
official open/close auctions, extended premarket, extended post-market, overnight, halted, closed,
and unknown states. Holidays, early closes, and DST are explicit; weekday arithmetic and fixed UTC
offsets are forbidden.

Regular-continuous consolidated SIP evidence is the primary market-quality stratum. Extended pre-
and post-market results remain separately labeled strata with their own staleness and coverage
status. Overnight/BOATS/derived overnight evidence is excluded from primary and extended metrics
and requires a different dataset, feed, venue, calendar, entitlement, and future contract.

Symbol is an effective-dated alias, not instrument identity. Instrument versions bind issuer
mapping, security authority/key, share class, listing venue, currency, effective interval, and
mapping evidence. A name change alone does not create a new instrument. Symbol, split, or reverse-
split continuity requires authoritative effective-dated evidence. Share-class changes, mergers,
spin-offs, conversions, ADR-ratio changes, ambiguous security-key changes, and symbol reuse never
bridge automatically.

Cross-corporate-action primary comparisons are missing. Pure splits/reverse splits and pure USD
cash distributions may have separately named exact-rational sensitivities only when frozen by the
study policy. Vendor adjustment is never implicit.

## Market facts and deterministic selection

Quote, trade, bar, prior-close, official-auction, correction, cancellation, status, LULD, and
corporate-action facts are distinct closed variants. No missing fact kind is filled by another.

For a target `t`, the quote selector `Q(t)`:

1. validates the complete bounded manifest, authority chain, identities, entitlement declaration,
   instrument interval, calendar, protocol/condition map, clocks, correction view, and sequence;
2. replays only immutable facts admitted by the requested `recorded-primary` or
   `recorded-corrected` corpus cutoff;
3. processes gaps/resets, trading actions, halts, LULD, quote wipeout, duplicates, and revisions in
   trusted source order;
4. selects the last explicit consolidated SIP BBO/NBBO state with event time `<= t`;
5. requires two positive sides, eligible known conditions, applicable executable LULD state, no
   national halt, no unresolved sequence conflict, non-crossed prices, and inclusive staleness; and
6. emits the exact midpoint and selected identity or one typed missing identity.

Regular quote age is at most five seconds; extended quote age is at most thirty seconds. Exact
limits are eligible and one nanosecond over is stale. Locked and SIP-eligible slow quotes remain
eligible but degraded; strict sensitivities exclude locked or slow states. Crossed, one-sided,
unknown-condition, non-consolidated, halted, non-executable-LULD, and stale quotes are missing.

`L(t)` is a separately labeled last-eligible-consolidated-trade sensitivity. Eligibility comes from
the pinned complete sale-condition combination and consolidated-last state, not size or one
condition character. Odd lots, ineligible extended/out-of-sequence states, cancelled trades, and
ambiguous prior-reference/sold-last conditions do not update it.

`B(t)` is a separately labeled one-minute-bar sensitivity. It selects the close of the latest fully
completed unadjusted bar whose end is `<= t`; the bar containing `t` is future-contaminated. A bar
never claims quote, trade, halt, condition, or executability semantics.

Prior close selects the previous eligible primary-listing session's latest corrected consolidated
close condition, then official listing close, under the requested correction view. Final eligible
trade and daily-bar close are separately labeled sensitivities only.

## Frozen movement metrics

Let `Tpub` be trusted publication, `T0` the approved durable capture anchor, and
`T1/T5/T30 = T0 + 1/5/30` exact elapsed UTC minutes. Let `Qpre` be the last eligible quote strictly
before `Tpub`; `Q0/Q1/Q5/Q30 = Q(T0/T1/T5/T30)`; and `Cprev` be the eligible prior close.

```text
priorCloseMovementAtFirstObservation = (Q0 - Cprev) / Cprev
releaseGapMovement                   = (Q0 - Qpre) / Qpre
residualMovement1m                   = (Q1 - Q0) / Q0
residualMovement5m                   = (Q5 - Q0) / Q0
residualMovement30m                  = (Q30 - Q0) / Q0
```

Results are reduced rationals carrying both reference identities, timestamps, ages, sessions,
quality, policy IDs, anchor kind, correction view, and typed completeness. Missing endpoints make
only dependent metrics missing; every target and denominator remains recorded. Trade and bar
variants use different metric names and `priceBasis` values.

## Corrections, cutoffs, replay, and missingness

The primary correction view is `recorded-primary`: it admits exactly the validated revision
membership of the first complete verified immutable PEAS corpus. This is an as-recorded corpus
claim, not a claim that PEAS or the native provider knew the revision at the market target. A later
correction with an earlier effective time is not back-projected into that corpus.
`recorded-corrected` begins with the immutable primary set and admits additional valid revisions
whose preserved PEAS durable-recorded evidence is at or before the frozen cutoff of primary anchor
plus exactly seven 24-hour periods. Originals, corrections, and cancellations remain immutable;
orphans, cycles, forks, ambiguous targets, and provider-key conflicts fail closed. Final-corrected
or corrected-in-place evidence with unknown revision membership cannot produce
`recorded-primary`.

Selection validates the complete declared bounded evidence set before emitting. Candidate hashes
include eligible, rejected, and typed-missing evidence in canonical order. Provider priority,
fallback, arrival order, page token, page size, iterator order, restart, backend row ID, and current
time cannot change identity. Memory and SQLite execution, page sizes 1/2/7/maximum, duplicate and
correction permutations, restart, and replay must emit byte-identical semantic records.

Missing reference is a first-class deterministic result with join key, interval, reference kind,
selection policy, as-of basis, candidate-set hash, and one closed reason. Missing clusters remain in
all study denominators. Free-form provider or exception text enters no reason, identity, or fixture.

## Provider, entitlement, licensing, and fallback

P1-09 remains `PENDING`. PR 2D authorizes no provider access or real provider bytes. An entitlement
snapshot freezes provider, product/account class, dataset, endpoint, feed, capability, effective
interval, sanitized permission-evidence hash, human approval, and zero-incremental-spend assertion.
Any required capability that is pending, denied, expired, mismatched, or costs more fails closed
before acquisition.

Historical Alpaca `feed=sip`, WebSocket `v2/delayed_sip`, latest/snapshot `delayed_sip`, IEX,
BOATS, derived overnight, and OTC are separate identities. Alpaca historical SIP is only a
conditional future primary candidate after written permission and proof that its exact recorded
semantics satisfy the accepted quote/timestamp/correction contract. FMP endpoint families remain
distinct provider-defined lower-evidence sources. FMP is not NBBO/SIP evidence and may be only a
separately authorized discrepancy source. It never fills a missing primary result.

No free access implies retention, replay, agent processing, derived use, redistribution, or
publication permission. Raw provider bytes remain private and outside Git. Repository fixtures are
original synthetic work with explicit provenance. Provider change or fallback after outcomes is
forbidden; a pre-outcome fallback requires a human decision, entitlement `GO`, compatible contract
amendment, and new independent review.

## Frozen event-study design

The future study contains exactly 180 prospectively selected clusters in mutually exclusive lanes:
120 standard, 40 specialized, and 20 prospective controls, with five controls in each frozen
T-1-knowable identity-transition, schedule-uncertain, source-sparse, and liquidity-tail group.
Event-time halts, missingness, prices, corrections, latency, and provider success can never select a
control or replace a cluster.

The immutable frame snapshot precedes outcomes and alone determines lane, strata, rank, Hamilton
allocation, and membership. Per-cluster T-1 snapshots annotate drift but cannot change selection.
Every selected cluster remains in `N=180` after cancellation, postponement, source failure,
timestamp ambiguity, halt, missing quote, disagreement, or correction. Frame, attrition, preceding-
stage, and full-denominator counts are mandatory.

Primary gates are deterministic reproduction, complete primary-reference rate, conservative
within-15-minute observation rate, and five-minute quote-width-exceeding residual-information rate.
Their exact Wilson thresholds, formulas, missing/outlier policy, fixed Holm family, deterministic
bootstrap, sensitivities, correction cutoff, code/config/contract/calendar/entitlement identities,
and forbidden outcome fields are frozen by the study contract before collection. These are P2
measurement gates, not trade eligibility, model promotion, cost, order, or financial thresholds.
The study cannot start until P1-09, P1-10, P1-06, ADR 0010, and all specified gates are independently
approved.

## Bounds and hostile inputs

Every public input is exact inert data: no unknown or inherited keys, accessors, symbols, proxies,
sparse arrays, cycles, shared mutable values, non-finite numbers, or active behavior. Byte, item,
key, depth, node, token, string, condition, artifact, record, page, window, identity, revision,
candidate, state, manifest, and study ceilings are normative in the resource-bound contract.

Totals are preflighted before recursive validation, parsing, allocation, sorting, hashing, artifact
read, state mutation, or partial emission. Declared and actual bytes are checked independently.
Every numeric maximum requires one passing exact-boundary vector and one otherwise identical
one-over vector with the closed bound reason. Raising a bound changes the contract version.

## Effect isolation and compatibility

```text
future bounded acquisition (excluded from PR 2D)
  -> private immutable raw artifact
  -> authoritative observation lookup + verified complete bounded read
  -> pure bounded market normalization
  -> deterministic reference selection
  -> additive result/study sidecars referencing marketReferenceJoinKey
```

PR 2D does not change `EventLog`, `ProcessingStore`, `ArtifactStore`, `ObservationLedgerFactsV1`,
`deriveMarketReferenceJoinKey`, event schemas, reducer state, evidence-bundle identity, migrations
001--005, Docker, dependencies, or effect categories. If accepted implementation cannot satisfy the
contract additively through existing storage/repository patterns, implementation stops for a human-
approved contract amendment instead of changing a frozen boundary.

## Contract and publication gates

1. This ADR remains `Proposed` until all linked contract files are complete and a fresh independent
   reviewer gives binary `GO` to the exact contract-checkpoint SHA.
2. Implementation begins only from the accepted contract publication head. Any semantic change
   invalidates the review.
3. Implementation uses non-overlapping ownership and recorded/offline code, synthetic fixtures,
   deterministic tests, and bounded study-manifest validators only.
4. A final exact implementation candidate receives a different fresh independent binary review.
5. Any code/contract change after final `GO` invalidates it. Audit/status-only publication changes
   must be proven as the only delta.
6. The branch is pushed and opened as a draft pull request only after final `GO`; required Linux and
   Windows CI must pass; the pull request remains unmerged.

## Consequences

The contract favors truthful missingness, provenance, and replay over coverage. Provider historical
limitations may make primary completeness low, especially for authoritative prior close,
contemporaneous correction history, and extended sessions. That is a study result, not permission
to silently relax the source, substitute a fact kind, tune a threshold, or remove a denominator.

Durable capture includes local processing latency, so the primary metric is operational rather than
pure provider latency. The mandatory retrieval sensitivity quantifies that difference without
changing the selected corpus. Exact decimal/rational math, immutable revisions, closed identities,
bounded state, and synthetic hostile fixtures add implementation work but make the future study
reviewable before outcomes exist.
