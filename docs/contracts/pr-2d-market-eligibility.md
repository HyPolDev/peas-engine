# PR 2D market eligibility, selection, and movement contract

Status: normative Wave 2 contract input
Decision checkpoint: cbec6e00259b17bdec59fcc20608f66f90896b71
Scope: provider-neutral recorded/offline selection only

This contract freezes deterministic quote, trade, completed-bar, official-close, correction,
corporate-action, and movement behavior. It implements the approved H-001 decision and the approved
as-of selector: the last eligible fact at or before each exact target, with a strict-before selector
for the release-gap origin. First-after, nearest-on-either-side, and look-ahead selectors are
forbidden.

Normative dependencies:

- [timestamp and trust contract](pr-2d-timestamp-trust.md);
- [provider and source identity](pr-2d-provider-source-identity.md);
- [closed reason catalog](pr-2d-reason-codes.md);
- [resource bounds](pr-2d-resource-bounds.md);
- [fixture manifest](pr-2d-fixture-manifest.md);
- [acceptance matrix](pr-2d-acceptance-matrix.md); and
- [study freeze manifest](pr-2d-study-freeze-manifest.md).

P1-09 remains pending. No Alpaca, FMP, SIP, exchange, feed, fallback, raw byte, retention, replay,
publication, account, entitlement, or spend authorization is inferred here. Until P1-09 is approved,
only original synthetic-offline evidence may pass an executable PR 2D contract test.

## 1. Closed reference kinds and no-fallback rule

| Reference kind | Canonical price basis | Primary/sensitivity role |
| --- | --- | --- |
| quote-nbbo-midpoint | exact midpoint of an eligible explicit consolidated SIP NBBO | primary |
| trade-last-eligible-consolidated | price of the last trade proven to update consolidated Last | separately labeled sensitivity |
| bar-one-minute-completed-close | close of the latest eligible completed one-minute bar | separately labeled sensitivity |
| prior-listing-official-close | primary-listing M close, superseded by eligible listing-market 9 correction | primary prior-close denominator |
| listing-official-open | primary-listing Q fact | separately labeled auction fact |
| opening-trade | O fact | separately labeled trade fact |
| reopening-trade | 5 fact | separately labeled trade fact |
| closing-trade | 6 fact | separately labeled trade fact |
| final-eligible-trade-close | final session trade proven to update consolidated Last | separately labeled prior-close sensitivity |
| daily-bar-close | eligible daily aggregate with explicit adjustment identity | separately labeled prior-close sensitivity |
| bolo | best odd-lot order under the exact SIP regime | separate odd-lot sensitivity; never NBBO |

Every selection runs independently for one exact referenceKind. A missing quote remains a typed
missing quote even when a trade, bar, another provider, another feed, BOLO, or a snapshot field is
available. Attempted unlabeled substitution is market.silent-fallback-forbidden.

Provider comparison also runs independently. A secondary provider never fills a missing primary
result, and equal economic values never merge their provider/source provenance.

## 2. Common preconditions

Before any candidate is eligible, the complete bounded input MUST validate:

1. exact provider, dataset, feed, endpoint/protocol, protocol version, entitlement snapshot,
   artifact, provider observation, revision, normalized fact, instrument, venue/tape, calendar,
   condition-policy, selection-policy, reason-catalog, and bounds identities;
2. exact ArtifactStore observation, commit, verified complete read, digest, size, and raw-link
   reconciliation;
3. exact inert-data shape and every declared/actual resource bound before allocation, sort, hash, or
   partial output;
4. one frozen primary source policy with no default feed and no automatic fallback;
5. one exact instrument/share-class version effective at the fact time;
6. currency USD and canonical exact decimal values;
7. timestamp, precision, semantic, sequence, session, and calendar eligibility from the timestamp
   contract;
8. a complete immutable correction/revision view; and
9. the exact approved anchor branch and interval.

Failure before candidate construction produces a rejected operation or typed missing result under
the reason catalog. A manifest declaration does not override contradictory bytes or authority.

## 3. Exact price arithmetic

Prices and sizes are canonical base-10 values under the resource-bounds contract. IEEE-754 values
MUST NOT enter price identity, comparison, midpoint, adjustment, or return calculation.

For bid B and ask A, first align the integer coefficients to common scale s:

    midpointNumerator   = aligned(B,s) + aligned(A,s)
    midpointDenominator = 2 * 10^s

Reduce by the greatest common divisor. Do not round. The canonical displayed midpoint is derived
only after selection and never supplies identity.

For positive endpoint prices Pa and Pb:

    returnRatioNumerator   = Pb - Pa
    returnRatioDenominator = Pa

    returnBpsNumerator     = 10_000 * (Pb - Pa)
    returnBpsDenominator   = Pa

Both pairs are reduced with a positive denominator. returnRatio and returnBps are the same exact
estimand in different units. Gate comparison uses exact rational values or the separately frozen
high-precision study serialization; display rounding cannot decide eligibility or a threshold.

Zero/non-positive eligible prices, noncanonical decimals, overflow, or a zero denominator fail
closed.

## 4. Approved anchors and metric intervals

The primary branch uses the exact durable-capture basis:

    T0 = receivedAtMs * 1_000_000 ns

The mandatory sensitivity repeats every selection using:

    T0 = retrievedAtMs * 1_000_000 ns

for the exact existing retrieval basis. retrievedAtMs is not transport completion and is never
renamed.

For each branch:

    T1  = T0 + 60_000_000_000 ns
    T5  = T0 + 300_000_000_000 ns
    T30 = T0 + 1_800_000_000_000 ns

Let Tpub be trusted publication time under the timestamp contract.

| Symbol | Exact selection |
| --- | --- |
| Cprev | authoritative prior-session listing close selected under section 10 |
| Qpre | last eligible quote with eventTimeNs strictly less than Tpub |
| Q0 | Q(T0) |
| Q1 | Q(T1) |
| Q5 | Q(T5) |
| Q30 | Q(T30) |
| L0/L1/L5/L30 | independent L(t) trade sensitivity at each target |
| B0/B1/B5/B30 | independent B(t) completed-bar sensitivity at each target |

Primary movement records are:

    priorCloseMovementAtFirstObservation = returnBps(Cprev, Q0)
    releaseGapMovement                   = returnBps(Qpre, Q0)
    residualMovement1m                   = returnBps(Q0, Q1)
    residualMovement5m                   = returnBps(Q0, Q5)
    residualMovement30m                  = returnBps(Q0, Q30)

Trade and bar variants repeat the equations only under names that state their reference kind.
Quote, trade, and bar values MUST NOT occupy an unlabeled shared result field.

Tpub greater than T0 makes releaseGapMovement missing. Equality between a quote event time and Tpub
does not qualify Qpre. Equality between an eligible fact time and T0/T1/T5/T30 does qualify the
point selector. A fact one nanosecond after a target is future information and is excluded.

## 5. Candidate-set and tie-break algorithm

Each selection key is:

    {
      marketReferenceJoinKey,
      intervalKey,
      referenceKind,
      selectionPolicyId,
      asOfBasis
    }

`intervalKey` is the recomputed `mik1_` row for `prior-close|publication-pre|t0|t1|t5|t30`;
`referenceKind` is one exact section-1 value; and `asOfBasis` is the complete
`MarketResultAsOfBasisV1` object. Caller labels or defaults cannot supply any field. The selection
policy contains the explicit H-001 anchor pair, all closed component objects, the immutable
contract-authority registry, and the exact recorded-corpus correction policy.

Selection MUST use the complete declared bounded evidence window. It MUST NOT stop at the first
provider page or first apparent winner.

### 5.1 Common pseudocode

    select(referenceKind, targetNs, comparator):
      validate complete manifest, source authority, artifacts, identities, bounds
      validate exact anchor, interval, calendar, and correction view
      observations = normalize every declared observation without reordering provenance
      groups = classify duplicate/conflicting provider identities
      retain one semantic input per exact redelivery group; retain every delivery witness
      quarantine every conflicting identity group
      revisions = validate immutable revision graphs
      view = apply only revisions admitted by the requested cutoff
      state = replay control, halt, LULD, reset, quote, and trade state in trusted source order
      candidates = all requested-kind facts plus their eligible/degraded/ineligible outcomes
      candidateSetHash = hash canonical sorted tuples for the complete candidate set
      eligible = candidates that pass every kind-specific rule
      eligible = filter eligible by comparator(factTime, targetNs)
      if eligible is empty: return typed missing result
      winnerTime = maximum applicable fact time
      tied = every eligible candidate at winnerTime
      return resolveTie(tied, trusted source order, canonical economic state)

For Q and L, applicable fact time is trusted market event time. For B, it is barEndNs. For Qpre the
comparator is eventTimeNs < Tpub. For every point target it is factTime <= targetNs.

### 5.2 Tie resolution

    resolveTie(tied, sourceOrder, economicState):
      if tied has one candidate: return it
      if all candidates are exact redeliveries: return the semantic observation once
      if trusted source-native order totally orders the differing facts:
        return the last fact in that order
      if all remaining candidates have identical canonical economic state:
        choose the smallest normalizedMarketFactId as provenance representative
        retain all equivalent evidence in candidateSetHash
        return representative
      return missing market.sequence-insufficient
        with sequenceFailureKind equal-time-ambiguous

Provider priority is not a market-time tie-break. Each authorized provider/source is selected
independently. Artifact order, record ordinal, page token, page size, provider page order, SQL row
ID, local path, insertion order, revision ID, and hash order cannot make one differing market fact
later than another.

No absolute-distance or first-after rule is allowed.

## 6. Q(t): explicit consolidated NBBO

### 6.1 Required provenance

Primary Q(t) requires an explicit consolidated SIP national BBO/NBBO fact under a pinned
source/protocol/version condition mapping. It MUST NOT be reconstructed from:

- one venue;
- an incomplete venue set;
- provider latest/snapshot semantics without proven explicit consolidated NBBO identity;
- IEX-only evidence;
- FMP provider-defined quote fields;
- BOLO or other odd-lot-only state;
- trade prints; or
- bars.

The source identity contract decides whether an authorized future provider fact proves this
provenance. Current P1-09 pending evidence proves no provider authorization.

### 6.2 Quote eligibility

| Condition | Primary Q(t) result |
| --- | --- |
| known exact protocol/version and condition dictionary | required |
| exact instrument version and USD | required |
| explicit consolidated national bid and ask | required |
| positive bid/ask prices and sizes | required |
| two-sided NBBO-eligible national state | required |
| no unresolved sequence gap/reset | required |
| no cross-SRO/market-wide halt or pause at target | required |
| both national sides LULD executable, or LULD documented not applicable | required |
| bid less than ask | complete |
| bid equals ask | selected degraded with market.quote-quality-degraded and qualityKind locked |
| bid greater than ask | ineligible with market.quote-crossed |
| SIP-eligible slow side | selected degraded with market.quote-quality-degraded and qualityKind slow |
| LULD limit state exactly at a band | selected degraded with market.quote-quality-degraded and qualityKind luld-limit-state |
| one side absent/zero | ineligible with market.quote-one-sided |
| age at or below frozen maximum | required |

A strict-executable sensitivity excludes locked, slow, and LULD-limit-state quotes. It is a
different selectionPolicyId and never replaces primary Q(t).

### 6.3 Condition-map requirements

For CQS 2.11b, the versioned map recognizes A, B, E, F, H, O, R, and W as BBO-eligible according to
their documented side behavior. C, L, N, U, and intraday-auction state 4 are ineligible.

For UTP 3.0a, the market-center map recognizes A, B, H, O, R, and one-sided Y as NBBO eligible
according to the specification. Primary Q(t) nevertheless requires the national two-sided open
state R; national Y is one-sided and L is closed.

These statements freeze only the named official protocol versions. A provider normalization MUST
map its fields to the exact protocol/tape dictionary identity. Unknown, undocumented, lossy, or
future condition mappings fail closed; no generic union of codes is permitted.

### 6.4 Staleness

Version-1 project policy, not a provider promise:

| Session | Maximum quote age | Boundary |
| --- | ---: | --- |
| regular-continuous | 5,000,000,000 ns | age equal to maximum is eligible; +1 ns is stale |
| extended-pre/post | 30,000,000,000 ns | age equal to maximum is eligible; +1 ns is stale |
| overnight | none | primary forbidden |
| official auction | none | auction fact is separate; no quote substitution |

    quoteAgeNs = targetNs - quoteEventTimeNs

Age must be non-negative. The same limits apply to Qpre using Tpub as target. A native
gap-checked sequence does not waive staleness. The frozen sensitivity grid is regular 1 second and
30 seconds, extended 5 seconds and 60 seconds.

### 6.5 Quote state machine

The quote state machine processes, in trusted source order:

- day/session start and end;
- authoritative resets and retransmissions;
- quote wipeouts;
- participant/market-center status;
- market-wide circuit breakers;
- cross-SRO trading action;
- quote and trade resume separately;
- LULD price bands and national BBO indicator;
- round-lot/protected quote changes; and
- explicit NBBO appendages.

Quote condition alone cannot establish halt/resume. A market-center-only halt removes that venue
under the pinned SIP mapping but does not halt the security nationally. A pre-halt quote cannot be
selected during a cross-SRO halt. The first post-resume quote may support a separately labeled
post-reopen result; it cannot backfill a target in the halt.

## 7. Odd lots and BOLO

Odd lot is determined from the effective source roundLotSize, not a hard-coded 100 shares. Protocol
regime and trading date are part of the source identity because the 2026 odd-lot/BOLO transition
changes available facts.

- protected round-lot NBBO remains Q(t);
- BOLO and participant odd-lot quotes are separate reference kinds;
- an odd-lot trade marked I does not update consolidated Last and is ineligible for L(t);
- odd-lot quote prices at/better than NBBO do not rewrite the protected NBBO midpoint; and
- unknown round-lot or transition regime fails closed.

## 8. L(t): last eligible consolidated trade

L(t) is a separately labeled trade sensitivity. The preferred eligibility evidence is an explicit
SIP consolidated-Last update result. Without it, the implementation may reproduce eligibility only
by replaying the complete applicable session state under the exact pinned CTS/UTP sale-condition
combination matrix.

| Condition class | Consolidated-Last treatment |
| --- | --- |
| regular sale, automatic execution, intermarket sweep | eligible when every combined condition permits |
| opening O, reopening 5, closing 6 | generally eligible trade, also separately auction/reopening labeled |
| Sold Last L | conditional; select only when full state proves it updated Last |
| Prior Reference Price P | conditional first/only qualifying case; no heuristic |
| Sold/out-of-sequence Z and derivatively priced 4 | conditional first/only qualifying case; no heuristic |
| odd lot I | ineligible |
| extended-hours T and extended sold-out-of-sequence U | ineligible for consolidated-Last L(t) |
| average/bunched-average, price variation, seller, contingent, QCT | ineligible |
| official close M | official-close fact only |
| official open Q | official-open fact only |
| corrected consolidated close 9 | corrected-close fact only |

For combined conditions, any official does-not-update result takes precedence. If a conditional
case requires prior day/session state and that state is not present in the complete bounded window,
the trade is ineligible with market.trade-condition-ineligible and
`detail:{tradeConditionFailureKind:"state-insufficient"}`. Page order or a current provider latest-trade label
cannot supply the missing state.

Corrections and cancellations apply under the selected view before L(t). A cancellation removes its
target from the current view without deleting the immutable original. A correction supplies a new
immutable fact/revision and cannot become a later trade merely because it arrived later.

Trade staleness uses the same exact project thresholds as quote staleness: 5 seconds regular and
30 seconds extended, inclusive. A no-age trade sensitivity is permitted only under a distinct
selectionPolicyId.

## 9. B(t): completed one-minute bar

B(t) is a separately labeled aggregate sensitivity.

Eligibility requires:

- factKind bar;
- exactly one-minute documented interval;
- barStartNs inclusive and barEndNs exclusive;
- barEndNs minus barStartNs exactly 60,000,000,000 ns;
- unadjusted intraday price identity;
- USD and exact instrument/session identity;
- barEndNs less than or equal to target; and
- targetNs minus barEndNs less than or equal to 60,000,000,000 ns.

Select the latest completed eligible bar and use its close. A bar containing the target has future
information until barEndNs and is ineligible with market.bar-interval-future. Open/high/low/VWAP, a
provider latest value, an adjusted bar, or a daily bar does not substitute for the completed
one-minute close.

Bars do not prove NBBO, last-sale eligibility, halt state, point-time executability, or quote
spread. Their adjustment and interval identities are always explicit.

## 10. Official open, official close, and Cprev

The following are different facts:

| Fact | Required condition/source |
| --- | --- |
| listingOfficialOpen | Q from the primary listing market |
| listingOfficialClose | M from the primary listing market |
| correctedConsolidatedClose | 9 from the listing market |
| openingTrade | O |
| reopeningTrade | 5 |
| closingTrade | 6 |
| finalEligibleTrade | final trade proven to update consolidated Last |

For Cprev:

1. resolve the immediately preceding eligible primary-listing regular session from the frozen
   official calendar;
2. construct the requested correction view using the timestamp contract;
3. select the latest eligible listing-market 9 correction if present in that view;
4. otherwise select the primary-listing M official close;
5. validate USD, instrument/share-class continuity, and corporate-action boundaries through T0; and
6. return market.prior-close-missing or the more specific cause if no candidate passes.

O, 5, 6, finalEligibleTrade, provider previousDailyBar, provider previous-close snapshot field, EOD
record, or daily bar MUST NOT become primary Cprev. finalEligibleTrade and an eligible daily-bar
close may be separate named sensitivities with their own adjustment/session/source identities.

## 11. Sessions, halts, and transitions

The timestamp contract supplies exact half-open UTC intervals for regular-continuous,
official-open-auction, official-close-auction, extended-pre, extended-post, overnight, halted,
calendar-closed, and unknown.

Primary Q(t) and its residual endpoints require an eligible regular or separately stratified
pre/post session. A residual target whose session kind differs from T0 is missing with
market.session-transition. A frozen transition sensitivity may report it separately.

Release-gap and prior-close metrics retain both endpoint session kinds. Their definitions
intentionally span sessions when Tpub or the prior close makes that necessary; the result cannot be
misreported as same-session.

BOATS, 24X overnight, Alpaca-derived overnight, and every other overnight source are excluded from
primary and ordinary extended state. A future overnight sensitivity requires explicit authorization
and distinct provider/dataset/feed/venue/trading-date/calendar/session identities.

During a cross-SRO or market-wide halt/pause, Q(t) is missing. Quote resumption and trade resumption
are separate. A reopening trade 5 does not substitute for a post-resume quote.

## 12. Instrument, symbol, and corporate-action continuity

Symbol is an effective-dated alias, not an instrument or share-class identity.

An eligible instrument version binds issuer mapping, authoritative security key, share class/series,
primary listing venue, currency, round-lot size, effective interval, mapping authority/version, and
symbol alias interval under the identity contract.

Continuity rules:

1. a documented symbol/name change may preserve continuity only when authoritative evidence proves
   the same issue/share class and non-overlapping effective alias boundaries;
2. symbol reuse after an interval never inherits the prior instrument;
3. a split/reverse split preserves lineage but creates an effective instrument version and exact
   action factor;
4. mergers, spin-offs, conversions, unit separations, new share classes, ADR-ratio changes, and
   ambiguous security-key/listing changes are not automatically continuous; and
5. issuer CIK, ticker text, issuer name, or provider symbol rewrite alone cannot prove continuity.

For a split, reverse split, dividend/distribution, spin-off, right, conversion, merger, ADR-ratio,
symbol/share-class, or listing action effective after the first price endpoint and at or before the
second endpoint, primary comparison is missing with market.corporate-action-crossing. Raw
unadjusted prices are preserved.

A separately named adjusted sensitivity may support only:

- a pure split/reverse split with exact positive newSharesPerOldShare N/D, converting a pre-action
  price to post-action basis by D/N; or
- a pure USD cash distribution with exact per-share amount when the study policy explicitly freezes
  that convention.

Combined, optional, taxable, multi-currency, spin-off, rights, merger, ADR-ratio, or ambiguous
actions remain unsupported. No provider adjustment, current symbol, or back-adjusted bar is applied
silently.

## 13. Corrections, cancellations, duplicates, and views

Every source fact and revision is immutable.

- exact same provider observation identity plus exact same canonical content is redelivery: retain
  every delivery witness and apply the semantic observation once;
- same provider stable record/revision identity with different content and no valid revision edge
  quarantines the whole equivalence class;
- equal values from different provider/dataset/feed/endpoint identities remain independent;
- retransmission with original source sequence/time is delivery evidence, not a later market event;
- correction creates a new revision/fact and preserves original values;
- cancellation creates a null-fact revision and never deletes the original; and
- orphan, fork, cycle, conflicting reused key, or unsupported correction-after-cancellation fails.

The only V1 correction views are `recorded-primary` and `recorded-corrected`.

`recorded-primary` applies exactly the valid revision set in the first complete verified immutable
recorded corpus named by `recordedCorpusSnapshotId`/`corpusCutoffId`. It is an as-recorded corpus
claim, not a claim that PEAS or a native provider knew those revisions at T0/T1/T5/T30. Market
target times still exclude future economic facts; they are not revision-admission cutoffs.

`recorded-corrected` starts with that set and admits valid revisions with preserved PEAS durable
recorded evidence at or before exactly capture T0 plus seven 24-hour periods. Equality is included;
the next representable millisecond after is excluded. Effective time determines the target fact; immutable corpus
membership and durable recorded evidence determine view admission.

Historical corrected-in-place/final-corrected data with unknown revision membership cannot satisfy
`recorded-primary`. It may satisfy `recorded-corrected` only when the complete corpus was durably
closed by the corrected cutoff; otherwise the view is missing with
market.correction-view-unknown.

The views have different `selectionPolicyId`, `asOfBasis`, `mcc1_`, and selected/missing identities
even when prices match. Existing results are immutable; later evidence creates a new corpus/view.

## 14. Result status and missingness

Each reference evaluation outcome is exactly one of:

- selected-complete: eligible with no degradation diagnostic;
- selected-degraded: eligible with one or more canonical degradation diagnostics;
- missing: no eligible reference after a valid bounded selection;
- rejected: input, authority, bounds, identity, or deterministic-state contract failed; this is an
  operation outcome, not a reference result.

Each selected/missing reference result carries:

- referenceKind, intervalKey, anchor branch, target, and comparison operator;
- selected normalized fact/revision identity or null;
- candidateSetHash including every ineligible candidate;
- exact price or null;
- event/completion time, age, session, timestamp/sequence trust, and view;
- source/condition/calendar/staleness/selection policy identities;
- exactly one canonical `{code,detail}` reason when missing, otherwise null; and
- sorted unique canonical `{code,detail}` diagnostics.

The exact reference-result status strings are
`selected-complete|selected-degraded|missing`; `rejected` exists only in the enclosing evaluation
status. The exact view strings are
`recorded-primary|recorded-corrected`. The exact eleven reference-kind strings are the registry in
section 1. Any alternate view/status names, abbreviated reference names, untyped diagnostics, or
untyped reason strings are invalid. Rejected operations emit no selected/missing identity; the
rejected status and one canonical operation reason remain outside the reference-result union.

A required rejected operation invalidates dataset-freeze validation. It must not be converted to a
missing reference, assigned a synthetic result ID, omitted as attrition, or allowed to remove its
precommitted cluster. No `sdf1_` may be derived until the same frozen study design is executed
without an operation-terminal rejection.

Missing/degraded clusters remain in the study denominator. One missing interval does not prevent
independent evaluation of the other intervals.

## 15. Determinism and validation obligations

The fixture and acceptance contracts MUST prove:

- quote exactly at each target is included and one nanosecond after is excluded;
- quote exactly at Tpub is excluded from Qpre;
- exact staleness boundaries and one nanosecond over for regular/extended quote and trade;
- explicit NBBO versus partial venue, IEX, FMP-defined quote, BOLO, trade, and bar;
- one-sided, locked, crossed, slow, LULD limit/non-executable, halt, resume, reset, and gap states;
- every named CQS/UTP condition class plus unknown/version-mismatched conditions;
- odd-lot dynamic roundLotSize and pre/post odd-lot protocol regimes;
- conditional L/P/Z/4 trade cases with complete and incomplete session state;
- correction/cancel/redelivery/conflict/orphan/fork/cycle and both correction views;
- one-minute completed, open, adjusted, stale, wrong-session, and daily bars;
- M/9 prior close and every forbidden substitute;
- ordinary/early-close/holiday/DST/session-transition/overnight cases;
- symbol continuity, symbol reuse, pure split, and unsupported corporate action;
- capture primary versus exact retrieval sensitivity with different selected prices;
- exact midpoint and rational return arithmetic without binary float;
- all input orders, page sizes, restarts, memory/SQLite backends, and repeated replays yielding
  byte-identical candidate sets and selected/missing results; and
- every resource bound at exact maximum and one over through the resource-bounds contract.

All emitted reasons are canonical market.* values from
[the PR 2D reason catalog](pr-2d-reason-codes.md). mr.* spellings and generic provider text are
forbidden.
