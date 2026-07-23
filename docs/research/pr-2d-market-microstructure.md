# PR 2D market microstructure and movement contract research

Status: proposed contract input; one material human decision remains open
Research cut-off and source-access date: 2026-07-23
Repository checkpoint reviewed: 06e75591f8d2fec0cb2adaada276a2f43b0cddf3
Implementation scope: recorded/offline only; synthetic fixtures only

## Executive disposition

The market-reference contract can be deterministic, provider-neutral, replayable, and bounded if it:

1. preserves quote, trade, bar, auction, session, corporate-action, and instrument facts as different fact kinds;
2. uses the explicit consolidated SIP NBBO for the primary price reference and never reconstructs it from an incomplete venue set;
3. never silently substitutes a trade or a bar when the quote metric is absent;
4. selects only facts known by the requested replay cut-off, using a pinned protocol/version mapping that fails closed for unknown condition codes;
5. stores exact decimal integers and scales rather than IEEE-754 values;
6. freezes the session calendar, time-zone database identity, staleness policy, condition map, source identity, and correction view in the study manifest; and
7. reports missing or degraded evidence in the denominator with a closed mr.* reason vocabulary.

There is one blocking decision for ADR acceptance:

- H-001: choose retrieval completion or durable capture as the primary first-observation anchor. The choice materially changes the scientific estimand and can move price changes between “already present” and residual windows. This report therefore defines all calculations as functions of T0 but does not silently choose T0.

Recommendation for H-001, subject to explicit human approval: use retrieval completion as the primary scientific availability anchor, and record durable capture as a secondary operational latency anchor. Do not overload an existing retrievedAtMs field unless its documented semantics are exactly retrieval completion. If the ledger cannot represent retrieval completion separately, stop and extend the recorded schema compatibly before accepting ADR 0010; do not reinterpret a field.

This decision does not block synthetic types, parsers, normalization, replay, bounds, or fixtures. It does block final acceptance of the study metric semantics.

## Scope and normative language

“MUST”, “MUST NOT”, “SHOULD”, and “MAY” below are proposed normative requirements for ADR 0010.

This report defines:

- a price/reference-selection contract;
- movement equations and their interval anchors;
- session and calendar rules;
- quote, trade, bar, correction, halt, corporate-action, and symbol-continuity behavior;
- trust and deterministic ordering rules;
- exact parser/state bounds;
- a closed market-reference reason vocabulary; and
- redistribution-safe synthetic acceptance cases.

It does not:

- authorize or implement live HTTP or WebSocket access;
- establish provider entitlement, retention, replay, redistribution, or derived-use rights;
- inspect credentials or accounts;
- change frozen kernel ports;
- choose the 100–200-event universe or outcome thresholds; or
- treat market price evidence as proof of event identity.

## Official evidence base

All sources below are primary official sources and were accessed 2026-07-23. Protocol facts are pinned to the named document version. A future implementation MUST freeze the exact effective specification and mapping digest used for every artifact because condition sets and round-lot behavior change over time.

| Authority | Official source | Contract use |
|---|---|---|
| CTA | [CTA technical specifications](https://www.ctaplan.com/tech-specs) | Current CTS/CQS publication point and specification index. |
| CTA / SIAC | [CTS Pillar Multicast Output Specification, version 2.11b, 2026-01-29](https://www.ctaplan.com/publicdocs/ctaplan/CTS_Pillar_Output_Specification.pdf) | Trade timestamps, sequence/block behavior, sale-condition matrix, corrections/cancels, official open/close, prior close, prices, sizes, and listing-market identity. |
| CTA / SIAC | [CQS Pillar Multicast Output Specification with Odd Lots, version 2.11b, 2026-01-29](https://www.ctaplan.com/publicdocs/ctaplan/CQS_Pillar_Output_Specification_Odd_Lots.pdf) | NBBO appendages, quote eligibility, recovery/reset behavior, quote timestamps, BOLO, round-lot and odd-lot quote behavior. |
| CTA | [Odd-lot changes FAQ, version 2.3, 2026-03-17](https://www.ctaplan.com/publicdocs/ctaplan/CTA_Odd_Lots_Changes_FAQ.pdf) | 2026-04-27 odd-lot/BOLO activation and transition boundary. |
| CTA | [Odd Lots program page](https://www.ctaplan.com/odd-lots) | Protected quote, odd-lot quote, and BOLO separation. |
| UTP SIP | [UTP Data Feed Services Specification, version 3.0a, 2025-11](https://utpplan.com/DOC/UtpBinaryOutputSpec-3.0a.pdf) | Tape C quotes/trades, NBBO appendages, timestamps, sequences, trading actions, sale conditions, corrections/cancels, security directory, and round-lot identity. |
| FINRA | [Trade Reporting FAQ](https://www.finra.org/filing-reporting/market-transparency-reporting/trade-reporting-faq) | Prior Reference Price semantics and late-report behavior. |
| FINRA | [Trade modifiers and LULD price-band applicability](https://www.finra.org/filing-reporting/trf/trade-report-modifiers-and-applicability-limit-uplimit-down-luld-price-bands) | FINRA-reported condition interpretation and LULD applicability. |
| FINRA | [Regulatory Notice 14-46](https://www.finra.org/rules-guidance/notices/14-46) | Official background for out-of-sequence reporting; the condition carried by the current feed remains authoritative. |
| LULD Plan | [Limit Up-Limit Down Plan](https://www.luldplan.com/) | Price-band, limit-state, pause, and regular-hours scope. |
| NYSE | [NYSE market hours and calendars](https://www.nyse.com/trade/hours-calendars) | Core sessions, exchange-specific extended sessions, holidays, and early closes. |
| Nasdaq | [Nasdaq market holiday schedule and hours](https://www.nasdaq.com/market-activity/stock-market-holiday-schedule) | Core/premarket/after-hours and holidays/early closes. |
| NIST | [Daylight Saving Time](https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst) | U.S. DST rule and 2026 transition dates. |
| SEC | [Accessing EDGAR data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) | CIK permanence and the explicit limitations of SEC ticker mapping. |
| SEC | [Regulation NMS](https://www.sec.gov/rules-regulations/2005/06/regulation-nms) | National market-system context; protocol output remains the executable source. |
| SEC | [Regulation NMS minimum-pricing-increment and round-lot amendments, Release 34-101070](https://www.sec.gov/files/rules/final/2024/34-101070.pdf) | Round-lot and odd-lot regulatory transition context. |
| NYSE | [NYSE corporate actions](https://www.nyse.com/market-data/corporate-actions) | Listing-exchange action types and authoritative event updates. |
| NYSE Regulation | [Corporate Actions, Market Watch and Proxy Compliance](https://www.nyse.com/regulation/corporate-actions-market-watch-proxy-compliance) | Effective action notices for NYSE-listed instruments. |
| Nasdaq Trader | [Nasdaq Daily List product description](https://nasdaqtrader.com/Trader.aspx?id=DailyListPD) | Nasdaq-listed new issues, delistings, symbol/name changes, dividends, and split adjustments. |
| FINRA | [OTC Equity Daily List](https://otce-dr.finra.org/otce/dailyList?viewType=Symbol%2FName+Changes) | OTC symbol/name changes and other corporate actions. |
| FINRA | [OTC Equity Daily List User Guide](https://www.finra.org/sites/default/files/OTCE_Daily_List_User_Guide.pdf) | Publication time, effective/ex-date, old/new symbol, split, distribution, and revision fields. |

The SEC’s June 2026 Rule 610/611 rescission item is a proposal, not an effective rule for this research cut-off. It MUST NOT be used to rewrite the current condition contract. If the study crosses a legal or protocol effective-date boundary, the manifest MUST split the data by regime rather than retroactively applying one mapping.

## Canonical identities

### Source identity

Every normalized market fact MUST carry:

- providerId;
- datasetId;
- feedId;
- protocolOrEndpointId;
- protocolVersion;
- entitlementSnapshotId;
- artifactId and artifactDigest;
- artifactCaptureBasis;
- sourceFactKind;
- sourceNativeIdentity; and
- parserContractVersion.

Empty, “default”, “auto”, or inferred source components are invalid. Provider-specific condition mappings MUST be keyed by the complete source/protocol/version tuple. Unknown tuples fail closed with mr.spec-version-unknown.

### Issuer, instrument, and symbol identity

Symbol text is an alias, never the instrument identity.

The canonical instrument version MUST contain:

- instrumentId: stable PEAS identifier;
- issuerId plus issuerAuthority, where SEC CIK may identify an SEC registrant but not a share class;
- primaryListingMarket;
- issueType and shareClass or series;
- sourceIssueIdentity;
- roundLotSize;
- currency;
- validFromNs inclusive;
- validToNs exclusive or null;
- symbol aliases with their own effective intervals;
- mappingAuthority and mappingArtifactDigest; and
- predecessor/successor relation, if any, with a typed reason.

The SEC states that CIKs are unique and not recycled, but its company_tickers files are periodically updated and are not guaranteed for accuracy or scope. Therefore CIK plus ticker is insufficient to identify an instrument or share class.

Continuity rules:

1. A symbol change MAY bridge two aliases only when an authoritative listing/market record identifies the same issue/share class and gives a non-overlapping effective boundary.
2. A name change alone does not create a new instrument.
3. A split or reverse split normally preserves the instrument lineage but creates a new instrument version with an exact adjustment factor and effective boundary.
4. A merger, spin-off, conversion, unit separation, new share class, ADR ratio change, listing transfer without demonstrated issue continuity, or ambiguous CUSIP change MUST NOT be bridged automatically.
5. A symbol reused after validToNs belongs to a different alias interval and MUST NOT inherit prior facts.
6. A CUSIP or other licensed identifier MAY be retained only under the applicable entitlement; fixtures and committed manifests MUST use synthetic identifiers.

Ambiguity yields mr.instrument-ambiguous. Missing authoritative continuity yields mr.symbol-change-unresolved. Neither may be repaired by matching strings or issuer names.

## Exact numeric and timestamp representation

### Decimal canonicalization

Incoming price, size, and corporate-action quantities MUST be parsed as decimal text or scaled integers. Binary floating-point is prohibited in normalization, comparison, midpoint, and return calculations.

Canonical decimal form is:

- sign: minus only when the value kind permits negative values;
- coefficient: base-10 digits with no leading zero except the single value 0;
- scale: integer from 0 through 6 for source prices and sizes;
- no trailing fractional zero after normalization; and
- currency: exactly USD for this study version.

Source price and size coefficients MUST contain at most 20 digits. Eligible quote/trade prices and sizes MUST be strictly positive. A midpoint may require scale 7 because division by two can add one decimal place. Corporate-action ratios are reduced positive integer numerator/denominator pairs with at most 20 digits per side.

An exact midpoint is:

    midpoint = (bidCoefficient × 10^(commonScale-bidScale)
              + askCoefficient × 10^(commonScale-askScale)) / (2 × 10^commonScale)

The result MUST be reduced and then rendered canonically. No rounding is permitted for selection or metric computation.

A simple return from positive exact prices A to B is:

    return(A,B) = (B - A) / A

The return MUST be stored as a reduced signed numerator and positive denominator. Decimal display is derived and MUST state its rounding mode and display scale; it is not the comparison value.

### Time

Canonical event and market cut-offs are signed 64-bit UTC epoch nanoseconds. Parsing rejects:

- local timestamps without a named zone and offset;
- leap-second spellings unsupported by the parser;
- nonexistent or ambiguous local civil times;
- more than nine fractional-second digits; or
- values outside the signed 64-bit range.

Calendar construction is the only place local time is permitted. It MUST use America/New_York, a pinned tzdb version/digest, and the primary-listing exchange calendar version/digest, then freeze exact UTC [startNs,endNs) intervals.

## Timestamp and sequence trust

Time semantics and ordering semantics are different fields. A trustworthy timestamp is not proof of complete ordering, and a complete sequence is not proof that an event timestamp means execution time.

### Closed timestamp-trust classes

| Class | Meaning | Primary quote use | Trade sensitivity use |
|---|---|---:|---:|
| participant-publication | Exchange matching-engine publication timestamp documented by CTA/UTP Timestamp 1 | yes | yes, labeled publication-time |
| member-execution | FINRA/TRF member-reported execution timestamp documented by CTA/UTP | not a quote class | yes, labeled execution-time |
| sip-publication | CTA SIP Block Timestamp or UTP sipTime, meaning SIP processing/output time | sensitivity only | sensitivity only |
| provider-documented-event | Provider-documented exchange/event timestamp with a pinned semantic mapping | yes only if the mapping says consolidated quote event time | yes only if the mapping proves the fact kind |
| provider-receipt | Provider receipt/processing time | no | no |
| inferred | Derived from date, bar boundary, page order, or neighboring facts | no | no |
| unknown | Missing or undocumented | no | no |

CTA specifies exchange Timestamp 1 as the matching-engine publication time and FINRA/TRF Timestamp 1 as member-reported execution time. It specifies SIP Block Timestamp as SIP block-processing completion; retransmitted blocks retain the original processing timestamp. UTP similarly separates timestamp1 from sipTime. These fields MUST remain semantically tagged; they are not interchangeable.

### Closed sequence-trust classes

| Class | Evidence | Rule |
|---|---|---|
| native-gap-checked | Complete CTA block/message sequence or UTP MoldUDP64 sequence with resets/retransmissions processed | May support primary as-known state. |
| native-unchecked | Native sequence carried but gaps/resets were not proven complete | Degraded; no primary as-known claim across a gap. |
| provider-stable-sequence | Provider documents a stable sequence and the mapping/version is pinned | May order within its documented scope only. |
| deterministic-artifact-order | No source sequence; byte/record position is stable | Replayable but not evidence of market arrival order. |
| none | No order field and unstable page/arrival order | Fail when equal-time ordering affects state. |

CTA block sequences and UTP transport sequences MAY be used when gap detection, reset, replay, and retransmission semantics are implemented. UTP participant tokens and trading-action actionSequence values are internal fields and MUST NOT be promoted to global market order. Provider pagination order is not sequence trust.

### Deterministic ordering

For facts in one source/protocol session:

1. apply source-native sequence when its trust class is native-gap-checked or provider-stable-sequence;
2. otherwise order by exact marketEventTimeNs;
3. break equal timestamps only with a documented source-native tie-break;
4. use artifact digest and record ordinal solely to make diagnostics stable, never to claim market order; and
5. if equal-time conflicting facts can change the selected state and no trusted tie-break exists, return missing with mr.sequence-ambiguous.

A gap, unexpected reset, duplicate sequence with conflicting payload, or sequence regression invalidates primary state from the gap through the next authoritative reset/snapshot. It MUST NOT be healed by sorting timestamps.

## Primary-observation anchor: required human decision

Let:

- Tpub be the event’s trusted provider/issuer publication time;
- Tr be the time the complete event payload was available to PEAS after retrieval;
- Tc be the time the immutable payload was durably stored and its digest/ledger entry was committed; and
- T0 be the human-selected primary observation anchor.

The alternatives answer different questions:

| Anchor | Scientific estimand | Advantages | Bias/risk |
|---|---|---|---|
| retrieval completion Tr | Market movement already present when PEAS had the complete evidence available to process | Closest to actionable information availability; separates storage cost from source/retrieval latency | Requires a semantically exact, durable retrieval-completion observation; transport-start or generic retrievedAt must not be substituted. |
| durable capture Tc | Market movement already present when PEAS had persisted, digest-verified evidence | Strongest replay/audit boundary; already aligns with immutable artifact existence | Includes local I/O, hashing, queueing, contention, restart, and artifact-size latency; can shift T0 past price changes that were observable earlier. |

This is material, not cosmetic. If Tr and Tc straddle a quote update or a +1/+5/+30 target boundary, P(T0), the release gap, and every residual return can change. Large payloads, backfills, retries, and storage contention make the difference correlated with source/artifact characteristics, creating systematic measurement bias.

H-001 decision record MUST state:

- selected primary anchor and why;
- exact ledger fields and their existing semantics;
- whether the non-primary anchor is retained as sensitivity;
- treatment when the selected anchor is absent;
- whether clockBasisId and wall/logical components are sufficient; and
- an example where Tr and Tc select different synthetic quotes.

Until H-001 is approved, all APIs MUST accept an explicit trustedObservationBasis and MUST return mr.anchor-decision-required if asked for an implicit project default.

## Sessions, calendars, and DST

### Session identity

Each fact MUST carry sessionKind:

- regular-continuous;
- official-open-auction;
- official-close-auction;
- extended-pre;
- extended-post;
- overnight;
- halted;
- calendar-closed; or
- unknown.

The primary study session is regular-continuous, the frozen interval [09:30:00, officialClose) America/New_York for the primary-listing exchange. The official opening and closing auctions are separate fact kinds at their published times; they are not silently folded into the continuous quote metric.

On an ordinary session, officialClose is 16:00:00 local. On an early-close day it is the exact exchange-published close, commonly 13:00:00 local. Exchange calendars, not weekday arithmetic, determine holidays and early closes.

### Extended and overnight

Extended-pre and extended-post are secondary strata. They MUST have a provider/dataset/feed identity and a frozen venue/session-coverage policy because official exchange hours differ. A recommended common comparison interval is:

- extended-pre: [04:00:00,09:30:00) local;
- extended-post: [officialClose,20:00:00) local.

A fact outside a venue’s documented session is not made valid merely because it lies in the common interval.

BOATS/Blue Ocean ATS, 24X overnight trading, and every other overnight source are excluded from the primary and ordinary extended-hours metrics. If later authorized, they require sessionKind=overnight and a distinct venue, dataset, feed, trading-date convention, calendar, and entitlement identity. An overnight quote MUST NOT update the regular/extended NBBO state. Primary exclusion returns mr.overnight-excluded.

### Calendar algorithm

For each instrument version and study date:

1. resolve the primary-listing exchange from authoritative symbol reference data;
2. load the frozen exchange calendar entry;
3. reject a missing, overlapping, or contradictory entry;
4. convert each named local boundary through the pinned America/New_York tzdb rules;
5. freeze the exact UTC nanoseconds and original local date/offset;
6. classify facts using half-open intervals; and
7. record calendarId, calendarVersion, calendarDigest, tzdbVersion, and tzdbDigest.

DST is never implemented as a fixed UTC offset. NIST records the U.S. second-Sunday-in-March and first-Sunday-in-November rule; in 2026 DST runs from March 8 through November 1. Any event exactly at a session boundary belongs to the interval beginning at that boundary. A fact exactly at regular close is not regular-continuous.

## Quote contract and deterministic NBBO selection

### Raw fact versus eligible reference

The normalizer MUST preserve the raw consolidated quote and then derive an eligibility decision. It MUST NOT rewrite or discard a locked, crossed, slow, one-sided, or LULD state.

The primary quote source is the explicit SIP national BBO/NBBO appendage for the security and protocol version. It MUST NOT be reconstructed from provider “latest quotes”, one venue, a partial venue set, BOLO, or bars.

### Quote eligibility table

| Check | Primary decision | Reason/flag |
|---|---|---|
| Complete source/protocol identity and known condition mapping | required | mr.spec-version-unknown or mr.condition-unknown |
| Exact instrument version and USD | required | mr.instrument-unmapped or mr.currency-unsupported |
| Both bid and ask present, with strictly positive price and size | required | mr.quote-one-sided or mr.quote-size-invalid |
| Explicit consolidated NBBO provenance | required | mr.quote-not-consolidated |
| Quote condition is SIP NBBO-eligible for both sides under pinned map | required | mr.quote-condition-ineligible |
| Security not in cross-SRO halt/pause or market-wide halt at target | required | mr.quote-halt |
| LULD national BBO marks both sides executable or LULD is documented not applicable | required | mr.quote-luld-nonexecutable |
| bid less than ask | normal | complete |
| bid equals ask | eligible but degraded; strict sensitivity excludes it | mr.quote-locked |
| bid greater than ask | ineligible | mr.quote-crossed |
| quote age no greater than frozen threshold | required | mr.quote-stale |
| no unresolved sequence gap/reset at target | required | mr.sequence-gap |

CQS 2.11b explicitly marks A, B, E, F, H, O, R, and W as BBO-eligible, including side-specific or both-side slow states; C, L, N, U, and intraday-auction state 4 are ineligible. UTP 3.0a marks A, B, H, O, R, and one-sided Y as NBBO-eligible at the market-center level, but the national NBBO condition still distinguishes two-sided R, one-sided Y, and closed L. Primary use requires a two-sided national state. The executable provider-neutral result MUST be generated from a versioned mapping table, not from an unversioned hard-coded union.

Slow quotes that the SIP includes in NBBO remain eligible for the primary midpoint but carry mr.quote-slow as a degradation flag. A strict-executable sensitivity excludes any slow side. This preserves the actual disseminated NBBO while exposing the different protected/executable interpretation.

### Staleness

Official sources do not define one universal research “stale quote” age. This is a study policy and MUST be precommitted.

Recommended version-1 policy:

- regular-continuous maximum quote age: 5,000,000,000 ns;
- extended-pre/post maximum quote age: 30,000,000,000 ns;
- official auction facts: no quote-age substitution; select the authoritative auction fact;
- overnight: excluded; and
- sensitivity grid: regular 1,000,000,000 and 30,000,000,000 ns; extended 5,000,000,000 and 60,000,000,000 ns.

Age is targetTimeNs minus quoteMarketEventTimeNs. It MUST be non-negative and less than or equal to the threshold. Exact threshold is eligible; threshold plus 1 ns is stale. A native gap-checked feed does not waive this study-quality threshold. A provider snapshot with an undocumented event timestamp cannot pass primary staleness.

### Selection algorithm Q(t)

Given instrument version i, source identity s, correction view v, and target t:

1. resolve the frozen session interval containing t;
2. reject calendar-closed, unknown, or excluded overnight state;
3. replay only facts whose trusted arrival/order is included by v and the as-known cut-off;
4. process gap/reset, trading-action, LULD, quote-wipeout, and correction state in trusted source order;
5. identify the last explicit consolidated NBBO state with marketEventTimeNs less than or equal to t;
6. apply every primary eligibility check;
7. compute the exact midpoint; and
8. return the selected fact identity, revision identity, event timestamp, age, trust classes, degradation flags, and reason.

The algorithm is as-of, never look-ahead. It does not choose the first quote after t. No quote passing the contract yields a missing result, not a trade or bar.

## Trade contract: separately labeled last eligible consolidated trade

The trade metric is named lastEligibleConsolidatedTrade and is never returned as NBBO midpoint. Its result MUST state factKind=trade, priceBasis=last-eligible-consolidated-trade, and the exact sale-condition mapping version.

### Eligibility

The preferred evidence is the SIP’s explicit consolidated Last update result or an equivalent provider field whose semantics are documented and version-pinned. If that result is absent, the implementation MAY reproduce it only by replaying the complete applicable session state and the exact CTS/UTP sale-condition combination matrix. It MUST NOT decide from one condition character in isolation.

CTS 2.11b and UTP 3.0a establish these important cases:

| Condition | Consolidated-last treatment | Contract treatment |
|---|---|---|
| regular sale, automatic execution, intermarket sweep | generally updates | eligible if every combined condition permits |
| opening O, reopening 5, closing 6 | generally updates | eligible trade metric; also separately label auction/reopening role |
| Sold Last L | conditional under the specification’s prior-state/listing-market rule | eligible only if the replay proves the condition updated consolidated Last |
| Prior Reference Price P | conditional; generally not Last except the first/only qualifying case | no heuristic; full state or explicit update evidence required |
| Sold/out-of-sequence Z and derivatively priced 4 | conditional first/only case | no heuristic; full state or explicit update evidence required |
| odd lot I | does not update consolidated Last | ineligible with mr.trade-odd-lot |
| extended-hours T or extended sold-out-of-sequence U | does not update consolidated Last | ineligible for this metric; MAY support an explicitly different extended-trade metric |
| average/bunched-average, price variation, seller, contingent, QCT | does not update consolidated Last | ineligible |
| official close M | market-center official value, not ordinary consolidated Last | official-close fact only |
| official open Q | market-center official value, not ordinary consolidated Last | official-open fact only |
| corrected consolidated close 9 | correction to consolidated closing statistic | corrected-close fact only |

For multiple conditions, a “does not update” result takes precedence exactly as the official matrices specify. A provider-specific shorthand mapping that cannot express the full combination or conditional day state MUST fail closed with mr.trade-condition-ambiguous.

FINRA’s current FAQ explains that a Prior Reference Price report carries both execution and prior-reference time and generally does not update Last except the first/only qualifying case. The implementation MUST preserve both timestamps and the P condition; it MUST NOT move the trade back in ordering merely to make it appear timely.

### L(t) selection

1. Reconstruct the corrected or as-recorded trade state requested by the view.
2. Consider only non-cancelled trades for the exact instrument and source identity with trusted market time less than or equal to t.
3. Determine consolidated-Last eligibility using explicit SIP update evidence or a complete session replay.
4. Select the eligible trade that most recently updated consolidated Last in trusted source order.
5. Apply the session and staleness policy frozen specifically for trades.
6. Return the trade/revision identity, execution/publication semantic tag, sale-condition tuple, eligibility evidence, price, size, and quality status.

Recommended trade-age limits, used only for this secondary metric, are the same 5-second regular and 30-second extended limits as quotes. The exact-boundary rule is inclusive. A separate sensitivity MAY remove the age limit, but the result must remain labeled.

## Bars: fallback or sensitivity only

A one-minute bar MUST be labeled factKind=bar and MUST NOT claim NBBO, quote, last-sale condition, halt state, or point-in-time executability.

The deterministic point-target bar sensitivity B(t) is:

1. require a documented one-minute interval and unadjusted intraday price identity;
2. use half-open interval [barStartNs,barEndNs), with barEndNs minus barStartNs exactly 60,000,000,000 ns;
3. select the latest completed bar with barEndNs less than or equal to t;
4. select its close, not the open/high/low or a provider “latest” value;
5. reject bars whose adjustment, currency, session, or interval boundary is unknown; and
6. report the age t minus barEndNs.

The bar containing t is future-contaminated until its end and is therefore ineligible. A missing quote remains missing in the primary result even when B(t) exists.

Adjusted and unadjusted bars are different dataset/fact identities. Only unadjusted bars are eligible for point-market sensitivity. An explicitly calculated corporate-action-adjusted return is a different derived metric.

## Official open, official close, and prior close

Official auction values and continuous-market references remain distinct:

- listingOfficialOpen selects condition Q from the primary listing market;
- listingOfficialClose selects condition M from the primary listing market;
- correctedConsolidatedClose selects condition 9 from the listing market;
- openingTrade selects O;
- reopeningTrade selects 5;
- closingTrade selects 6; and
- finalEligibleTrade is the last session trade that actually updated consolidated Last.

None is silently substituted for another.

For the prior-close denominator Cprev at T0:

1. resolve the immediately preceding eligible primary-listing session from the frozen calendar;
2. in an as-recorded view, apply only close corrections present by that view’s acquisition cut-off;
3. select the latest authoritative correctedConsolidatedClose 9 for that session if present;
4. otherwise select the primary-listing listingOfficialClose M;
5. validate exact instrument-version continuity and corporate actions between close and T0; and
6. if either official fact is absent, return mr.prior-close-missing.

A finalEligibleTrade or provider daily-bar close MAY be calculated only as a separately labeled sensitivity, never as Cprev. This deliberate refusal avoids an invisible definition change on markets or dates where M/9 is unavailable.

## Movement metrics and interval anchors

### Frozen anchors

Let:

- Tpub = exact trusted event publication time;
- T0 = explicit trusted first-observation basis selected by H-001;
- T1 = T0 + 60,000,000,000 ns;
- T5 = T0 + 300,000,000,000 ns; and
- T30 = T0 + 1,800,000,000,000 ns.

The offsets are elapsed UTC durations, not wall-clock rounded minutes. Targets are not snapped to quote, trade, bar, or minute boundaries.

For every target, Q(t) is the eligible quote as of t. A target crossing a regular/extended session boundary is missing in the primary same-session residual with mr.session-transition; a precommitted transition sensitivity MAY report it separately. A halt, calendar close, missing quote, or staleness at a target remains missing and remains in the denominator.

### Prices

- Cprev = authoritative prior-session close defined above.
- Qpre = Q(Tpub minus epsilon), implemented as the last eligible quote with marketEventTimeNs strictly less than Tpub.
- Q0 = Q(T0).
- Q1 = Q(T1).
- Q5 = Q(T5).
- Q30 = Q(T30).

Tpub MUST have trusted, documented publication semantics. If Tpub is inferred, date-only, or absent, release-gap movement is missing with mr.release-time-untrusted. Tpub greater than T0 is invalid for the metric and yields mr.anchor-order-invalid.

### Equations

All outputs are exact reduced rational values:

- priorCloseMovementAtFirstObservation = return(Cprev,Q0);
- releaseGapMovement = return(Qpre,Q0);
- residualMovement1m = return(Q0,Q1);
- residualMovement5m = return(Q0,Q5); and
- residualMovement30m = return(Q0,Q30).

Release gap measures price change from the last eligible quote strictly before public release to the first trusted PEAS observation. It is not an overnight “gap” alias and is not the same as prior-close movement.

Each output MUST carry:

- metricContractVersion;
- numerator and denominator price identities;
- their timestamps, session kinds, ages, and quality statuses;
- selected source/revision identities;
- correction view;
- trustedObservationBasis;
- calendar/tzdb/condition/staleness policy digests; and
- complete/degraded/missing status with reason.

If Q0 is missing, all quote-based metrics using Q0 are missing independently; the implementation still evaluates and records evidence for the other targets rather than short-circuiting the entire event.

Trade and bar variants repeat the same equations with L or B prices, but their metric names and priceBasis values MUST be different. A report MUST never place quote, trade, and bar variants in one unlabeled column.

## Halts, reopenings, LULD, and market state

The state machine MUST process:

- market-wide circuit-breaker status;
- cross-SRO trading action;
- quote-resume and trade-resume separately;
- LULD price bands and national BBO indicator;
- participant/market-center status;
- quote wipeout, day reset, disaster-recovery reset, and cold restart; and
- opening, reopening, and closing auction facts.

UTP explicitly warns that quote condition alone is insufficient for halt/pause/resumption and requires Trading Action messages. Therefore:

1. a cross-SRO halt/pause or market-wide halt makes primary Q(t) unavailable;
2. a market-center-only halt removes/ineligibilizes that venue but does not by itself halt the security nationally;
3. a quotation resumption does not imply trading resumption;
4. a pre-halt quote cannot pass staleness during the halt;
5. the first eligible quote after resume MAY support a separately labeled post-reopen metric but MUST NOT backfill a target inside the halt; and
6. a reopening trade 5 is separately labeled and does not substitute for the post-resume quote.

LULD applies during regular trading hours under the Plan. A national BBO with a non-executable side is missing for the primary reference. A limit-state quote exactly at a band remains a real quote but is degraded with mr.quote-luld-limit-state; a strict sensitivity excludes it. A crossed/not-limit-state indicator is still subject to the crossed-quote rejection.

## Corrections, cancellations, duplicates, and replay

### Immutable fact/revision model

Every source fact is immutable. A cancel or correction creates a revision edge; it never mutates stored bytes.

The normalized trade revision identity contains:

- source-native original identity;
- source-native revision/correction identity;
- prior revision identity;
- action: new, correct, cancel, or error;
- source order;
- arrival observation identity;
- corrected fields;
- artifact identity; and
- payload digest.

CTA corrections/cancels reference the participant reference number and correction chains reference the most recent correction. UTP corrections/cancels carry original/corrected trade identifiers. The implementation MUST follow the pinned source contract. If an as-of record lacks a unique original identity, such as a source format where as-of trades carry no unique ID, correction state is unresolved and fails closed.

### Duplicate handling

- Same complete source identity and same payload digest: collapse as delivery duplicate, retain every delivery observation, and apply once.
- Same source identity and different payload without an explicit correction edge: reject both from primary state with mr.duplicate-conflict.
- Same business values but different source identities: distinct facts, not duplicates.
- A retransmission carrying the original source sequence/time is a duplicate delivery, not a later market event.

### Two replay views

as-recorded(cutoffObservationId):

- includes only artifacts/revisions durably present by the acquisition/ledger cut-off;
- applies their corrections in trusted source order; and
- answers what the recorded corpus contained by that acquisition cut-off.

later-corrected(freezeManifestId):

- includes every authorized artifact/revision named by the frozen manifest;
- resolves the complete bounded correction chain; and
- answers the final recorded state at dataset freeze.

Neither view may be called “known at market time t” unless a native real-time capture proves source arrival by t. Historical REST retrieval that returns a final corrected state cannot reconstruct contemporaneous market knowledge.

All selections MUST be recomputed from normalized immutable facts under both views. Storing only the selected price is insufficient. Page size, artifact order, duplicate delivery order, restart, and memory/SQLite storage MUST NOT change either selection.

## Corporate actions

Corporate-action facts MUST come from the authoritative primary-listing exchange record for exchange-listed securities or FINRA’s Daily List for OTC securities, with provider/dataset entitlement separately established. Issuer filings are corroborating evidence but do not replace the market’s effective/ex-date record.

For any split, reverse split, dividend/distribution, spin-off, rights issue, conversion, merger, symbol/share-class change, or listing change whose effective interval intersects either endpoint of a metric:

1. preserve the raw unadjusted prices;
2. resolve an exact action identity, revision, effective timestamp/date, affected instrument version, and source;
3. reject primary cross-boundary comparison with mr.corporate-action-crossing;
4. do not apply a vendor adjustment silently; and
5. MAY calculate a separately named adjusted sensitivity only when the exact action is in the frozen policy.

Version-1 adjusted sensitivities MAY support only:

- pure split/reverse split with exact newSharesPerOldShare N/D, where a pre-action price is converted to post-action basis by multiplying by D/N; and
- pure cash distribution in USD with exact per-share amount, where the pre-action reference is reduced by that amount, only if the frozen study policy explicitly authorizes this convention.

Combined, optional, taxable, multi-currency, spin-off, rights, merger, ADR-ratio, or ambiguous actions are unsupported in version 1 and remain missing. Adjustment-factor zero or a non-positive adjusted denominator is invalid. A later action correction produces a later-corrected result; the as-recorded view preserves the earlier result.

## Closed reason-code vocabulary

Every result has status complete, degraded, missing, or rejected. It has exactly one primaryReason or null and zero or more diagnosticFlags. When several missing/rejected reasons apply, choose the first applicable row in the following priority order; retain the others as diagnostic flags. Codes outside this table are invalid for market-reference contract version 1.

| Priority | Code | Status/effect |
|---:|---|---|
| 1 | mr.bound-exceeded | rejected; a named parser/state bound was exceeded |
| 2 | mr.schema-invalid | rejected; syntax, required field, or type invalid |
| 3 | mr.decimal-invalid | rejected; noncanonical, out-of-range, or non-positive eligible value |
| 4 | mr.timestamp-invalid | rejected; timestamp syntax/range invalid |
| 5 | mr.source-identity-incomplete | rejected; provider/dataset/feed/protocol/artifact identity incomplete |
| 6 | mr.spec-version-unknown | missing; no exact source/protocol/version map |
| 7 | mr.condition-unknown | missing; source condition absent from pinned map |
| 8 | mr.sequence-gap | missing; unresolved native sequence gap/reset |
| 9 | mr.sequence-ambiguous | missing; equal-time conflict lacks trusted order |
| 10 | mr.sequence-regression | rejected; order regressed outside documented reset |
| 11 | mr.duplicate-conflict | missing; same native identity has conflicting payload |
| 12 | mr.correction-chain-unresolved | missing; original/revision identity absent, cyclic, or ambiguous |
| 13 | mr.instrument-unmapped | missing; no authoritative instrument version |
| 14 | mr.instrument-ambiguous | missing; multiple instrument/share-class mappings |
| 15 | mr.symbol-change-unresolved | missing; alias continuity unproven |
| 16 | mr.currency-unsupported | missing; currency is not USD |
| 17 | mr.corporate-action-unresolved | missing; action identity/effect uncertain |
| 18 | mr.corporate-action-crossing | missing primary; separate adjusted sensitivity MAY exist |
| 19 | mr.calendar-missing | missing; exchange calendar/version absent |
| 20 | mr.session-boundary-ambiguous | missing; local/UTC or overlapping interval ambiguity |
| 21 | mr.session-closed | missing; target is outside an eligible market session |
| 22 | mr.session-transition | missing primary residual; target changes session kind |
| 23 | mr.overnight-excluded | missing primary; overnight fact excluded |
| 24 | mr.quote-halt | missing quote; cross-SRO/market-wide halt or pause active |
| 25 | mr.quote-luld-nonexecutable | missing quote; one or both national sides non-executable |
| 26 | mr.quote-one-sided | missing quote; bid or ask absent/zero |
| 27 | mr.quote-not-consolidated | missing quote; explicit SIP NBBO provenance absent |
| 28 | mr.quote-condition-ineligible | missing quote; pinned condition is not NBBO eligible |
| 29 | mr.quote-size-invalid | missing quote; non-positive/invalid side size |
| 30 | mr.quote-crossed | missing quote; bid greater than ask |
| 31 | mr.quote-stale | missing quote; exact age exceeds frozen threshold |
| 32 | mr.quote-missing | missing quote; no candidate at/before target |
| 33 | mr.trade-condition-ambiguous | missing trade; no explicit update result or full-state derivation |
| 34 | mr.trade-condition-ineligible | missing trade; condition does not update consolidated Last |
| 35 | mr.trade-odd-lot | missing trade metric; odd-lot condition I |
| 36 | mr.trade-cancelled | missing trade metric; selected candidate cancelled in view |
| 37 | mr.trade-missing | missing trade; no eligible candidate |
| 38 | mr.bar-adjustment-unknown | missing bar; adjustment identity absent/unsupported |
| 39 | mr.bar-interval-future | missing bar; interval has not completed at target |
| 40 | mr.bar-missing | missing bar; no eligible completed bar |
| 41 | mr.anchor-decision-required | missing; no explicit H-001 basis |
| 42 | mr.anchor-missing | missing; chosen anchor observation absent |
| 43 | mr.anchor-order-invalid | missing; Tpub is after T0 or target order invalid |
| 44 | mr.release-time-untrusted | missing release gap; Tpub semantics insufficient |
| 45 | mr.prior-close-missing | missing prior-close movement |
| 46 | mr.pre-release-reference-missing | missing release gap; Qpre absent |
| 47 | mr.target-reference-missing | missing residual; target price absent |
| 48 | mr.division-by-zero | rejected metric; denominator is zero |
| 49 | mr.missing-window | missing; required artifact/time window absent |
| 50 | mr.provider-disagreement | degraded/missing according to frozen disagreement policy |

Closed degradation flags that do not replace an otherwise complete primary result:

- mr.quote-locked;
- mr.quote-slow;
- mr.quote-luld-limit-state;
- mr.timestamp-sip-only;
- mr.sequence-native-unchecked;
- mr.session-extended;
- mr.correction-later-available; and
- mr.corporate-action-adjusted-sensitivity.

## Exact implementation bounds

These are proposed version-1 recorded-contract bounds, not provider limits. Every parser MUST reject before unbounded allocation, every state container MUST evict only according to deterministic completed-session rules, and every bound MUST have exact-limit and one-over tests.

| Bound | Exact maximum/invariant | Exact test | One-over/invalid test |
|---|---:|---|---|
| artifact bytes | 16,777,216 bytes | 16,777,216 accepted | 16,777,217 rejected |
| records per artifact | 100,000 | 100,000 accepted | 100,001 rejected |
| bytes per record | 65,536 bytes | 65,536 accepted | 65,537 rejected |
| fields per record | 128 | 128 accepted | 129 rejected |
| UTF-8 bytes per generic string | 1,024 | 1,024 accepted | 1,025 rejected |
| UTF-8 bytes per identity component | 512 | 512 accepted | 513 rejected |
| sale-condition components | 8 | 8 accepted | 9 rejected |
| source decimal coefficient digits | 20 | 20 accepted | 21 rejected |
| source decimal scale | 6 | scale 6 accepted | scale 7 rejected |
| derived midpoint scale | 7 | scale 7 accepted | scale 8 rejected |
| correction/revision depth | 32 | chain of 32 accepted | link 33 rejected |
| repeated deliveries per native identity | 64 | 64 identical deliveries collapse | 65 rejected before retention |
| artifacts in one selection request | 32 | 32 accepted | 33 rejected |
| instruments in one study manifest | 1,000 | 1,000 accepted | 1,001 rejected |
| calendar dates per manifest | 400 | 400 accepted | 401 rejected |
| active market-center states per instrument | 64 | 64 accepted | 65 rejected |
| page size exposed by recorded replay | 1 through 10,000 | 1 and 10,000 accepted | 0 and 10,001 rejected |
| primary residual targets | exactly 4: T0,T1,T5,T30 | exact set accepted | duplicate, omitted, or fifth target rejected |
| maximum primary residual horizon | 1,800,000,000,000 ns | exact +30m accepted | +30m plus 1 ns rejected |
| regular quote age | 5,000,000,000 ns | exact age eligible | plus 1 ns stale |
| extended quote age | 30,000,000,000 ns | exact age eligible | plus 1 ns stale |

Bounds are part of parserContractVersion and study configuration digest. Raising a bound is a contract revision, not an operational hotfix.

## Redistribution-safe synthetic fixture and acceptance matrix

Fixtures MUST be hand-authored synthetic data with fictional issuers, symbols, instruments, venues, artifacts, and values. They MAY use documented public condition-code values but MUST NOT copy provider payloads, licensed raw market records, actual event prices, account data, credentials, or proprietary identifiers.

Each fixture manifest MUST state:

- fixtureId and schemaVersion;
- synthetic=true and redistributionClass=project-authored;
- source/protocol/version being modeled;
- fictitious instrument-version and session identities;
- calendar/tzdb/condition-map digests;
- ordered input facts with exact arrival/order and event times;
- requested correction view and observation basis;
- expected selected identities, exact prices/returns, status, primary reason, and flags; and
- every exercised bound.

Required cases:

| Case | Synthetic arrangement | Required assertion |
|---|---|---|
| Q-01 exact midpoint | bid 10.000000, ask 10.020000 | exact midpoint 10.01; no float drift |
| Q-02 half-unit midpoint | bid 1.000000, ask 1.000001 | exact midpoint 1.0000005 at scale 7 |
| Q-03 as-of tie | quote before target and quote 1 ns after | before quote selected; future quote ignored |
| Q-04 stale boundary | age exactly 5 s, then 5 s + 1 ns | exact accepted; one-over mr.quote-stale |
| Q-05 one-sided | zero/missing ask | mr.quote-one-sided; no trade/bar substitution |
| Q-06 locked | bid equals ask | complete/degraded with mr.quote-locked; strict sensitivity missing |
| Q-07 crossed | bid greater than ask | mr.quote-crossed |
| Q-08 slow CQS state | BBO-eligible slow code under 2.11b | primary degraded mr.quote-slow; strict sensitivity excludes |
| Q-09 unknown condition | code absent from pinned version | mr.condition-unknown, fail closed |
| Q-10 LULD | executable, limit-state, then non-executable side | complete, degraded, then missing respectively |
| Q-11 halt/reopen | quote, cross-SRO halt, quote resume, trade resume | halt target missing; post-resume quote not backfilled |
| Q-12 gap/reset | native sequence skips one, then authoritative reset | state missing through reset; deterministic recovery |
| Q-13 equal-time conflict | two conflicting quotes without trusted sequence | mr.sequence-ambiguous |
| Q-14 BOLO | odd-lot price improves protected NBBO | primary midpoint remains protected NBBO; BOLO separate |
| T-01 regular trade | regular condition updates Last | separate trade metric selected |
| T-02 Sold Last | L with day state that qualifies and state that does not | exact matrix behavior in each case |
| T-03 PRP | P as first/only, then after normal Last | conditional update only with complete session state |
| T-04 odd lot | I trade at different price | never selected for consolidated Last |
| T-05 out of sequence | Z/U and execution/report timestamps | no timestamp reordering; exact matrix result |
| T-06 official values | Q,O,5,6,M,9 | every fact labeled separately; 9 revises close only |
| R-01 correction before cut-off | original then correction before as-recorded cut-off | corrected revision selected |
| R-02 correction after cut-off | correction arrives after first view | as-recorded original; later-corrected revision |
| R-03 cancel | selected trade then cancel | prior view retains; later view removes |
| R-04 duplicate retransmission | same identity/digest and original sequence | apply once; retain two delivery observations |
| R-05 duplicate conflict | same identity, different digest, no correction | mr.duplicate-conflict |
| B-01 completed bar | completed 1-minute unadjusted bar | separate B(t) close |
| B-02 open bar | target inside bar | mr.bar-interval-future |
| S-01 holiday | weekday exchange holiday | mr.session-closed |
| S-02 early close | quote at close minus 1 ns and at close | first regular; second outside regular |
| S-03 DST | dates around both 2026 transitions | frozen UTC intervals match America/New_York |
| S-04 session transition | T0 premarket, T30 regular | primary residual mr.session-transition |
| S-05 overnight | BOATS/overnight fact and regular fact | overnight excluded and cannot mutate regular state |
| I-01 symbol change | authoritative same-share-class alias change | continuity succeeds only across exact boundary |
| I-02 symbol reuse | same text after unrelated instrument interval | no continuity |
| C-01 pure split | 2-for-1 at market-open boundary | primary crossing missing; exact adjusted sensitivity separate |
| C-02 ambiguous action | spin-off/merger without exact mapping | mr.corporate-action-unresolved |
| M-01 metric anchors | quotes at Tpub-1ns,Tpub,T0,T1,T5,T30 | strict-pre Qpre and exact residual equations |
| M-02 anchor choice | Tr before a quote update, Tc after it | different Q0 proves H-001 materiality |
| M-03 missing targets | Q0 present, Q5 stale, Q30 absent | each metric independently statused; denominator retained |
| P-01 page invariance | same facts paged 1,2,5,10,000 and shuffled artifacts | identical identities/results |
| P-02 storage invariance | memory and SQLite replay | byte-identical normalized results |
| X-01..X-20 bounds | every table bound at exact maximum and one over | exact accepted; one-over mr.bound-exceeded |

Tests MUST compare canonical serialized results, not approximate numeric equality.

## Disagreements, unknowns, and required integration decisions

### Human decision trigger

- H-001 is material and unresolved: retrieval completion versus durable capture as T0. ADR 0010 MUST remain proposed until a human approves the field semantics and primary/sensitivity choice.

### Recommendations requiring contract-audit confirmation

- Staleness is a study choice, not an exchange rule. The recommended 5-second regular and 30-second extended values must be reconciled with the event-study analyst’s universe/liquidity strata before outcomes exist.
- Locked NBBO is retained as degraded primary evidence because it has an exact executable price; a strict sensitivity excludes it. If reviewers prefer primary exclusion, that is a contract change and must be decided before the dataset freeze.
- SIP-eligible slow quotes remain in the primary NBBO midpoint but are flagged; a strict-executable sensitivity removes them. This preserves the disseminated NBBO and makes the alternative explicit.
- Prior-close primary uses authoritative M/9 facts and refuses silent final-trade/bar fallback. If provider coverage cannot supply M/9, coverage may be low; the correct response is a separately labeled sensitivity and explicit missingness, not redefinition.

### External/entitlement unknowns

- Alpaca/FMP field semantics and whether their condition/timestamp fields are sufficient for these mappings belong to the provider-contract report. Unknown or lossy mappings fail closed.
- Access to exchange corporate-action products may be licensed. This report specifies the semantic boundary only and does not authorize retrieval, retention, or redistribution.
- The 2026-04-27 odd-lot/BOLO transition means pre- and post-cutover artifacts may require different protocol maps. A provider that normalizes historical data without disclosing the applicable regime cannot support primary odd-lot interpretation.
- BOATS/overnight coverage and entitlements are intentionally excluded. They require a future explicit source/session contract.
- The SEC Rule 610/611 rescission proposal was not effective at the research cut-off. Any later effective rule or SIP specification change requires a new regime identity.

## Handoff and validation

ADR integration should lift:

- the H-001 decision record;
- exact Q(t), L(t), B(t), Cprev, Qpre, and movement equations;
- the source/version, timestamp, session, quote, trade, reason, and bound tables;
- corporate-action and instrument-continuity rules; and
- the synthetic acceptance matrix.

Implementation may proceed on provider-neutral recorded types, pure normalization, immutable revisions, bounded replay, and synthetic tests while H-001 and licensing confirmation remain pending. It MUST require an explicit observation basis and MUST NOT claim provider access or primary-study readiness until those gates close.

Validation performed for this research artifact:

- every requested microstructure topic is addressed;
- only official primary sources are cited;
- every source has a direct URL and the common access date is recorded;
- documented protocol facts are separated from project recommendations;
- quote/trade/bar substitutions are prohibited and tested;
- provider-specific unknown condition mappings fail closed;
- exact/one-over resource and staleness boundaries are specified;
- synthetic fixtures are redistribution-safe by construction; and
- the material anchor decision is surfaced rather than guessed.
