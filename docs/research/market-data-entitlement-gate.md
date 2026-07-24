# Market-data entitlement, retention, and zero-spend gate

## Document control

- Status: `REVIEW`
- Gate: `P1-09`
- Owner: `human-owner`
- Prepared from public official material only
- Public-material access date: `2026-07-19`
- Incremental market-data budget: `0`
- Evidence intake: `COMPLETE`
- Human-owner decision: `OWNER_APPROVED_WITH_RESIDUAL_RISK`
- Alpaca historical REST `feed=sip` decision: `OWNER_APPROVED_WITH_RESIDUAL_RISK`
- FMP private discrepancy decision: `OWNER_APPROVED_WITH_RESIDUAL_RISK`
- FMP-only fallback decision: `NOT_AUTHORIZED`
- Owner authorization:
  [`docs/research/p1-09-owner-risk-authorization.md`](p1-09-owner-risk-authorization.md)
- Independent review: `PENDING`
- Recorded/offline PR 2D work: `ALLOWED`
- Live delayed market-reference adapter P1-10: `BLOCKED`
- P2 forward collection: `BLOCKED`

This is an engineering authorization record, not legal advice. Public documentation can establish
available product surfaces and default restrictions, but it cannot prove the terms, classification,
or entitlements attached to the human owner's accounts. Only the human owner may change a provider
decision or accept residual interpretation risk. The owner exercised that authority on
`2026-07-24`; P1-09 now awaits independent engineering review.

## Purpose

This gate determines whether PEAS may later acquire, privately retain, replay, analyze, and derive
publishable aggregate results from a zero-incremental-cost market-data source.

It does not authorize acquisition inside PR 2D. PR 2D may research and implement provider-neutral
recorded contracts, original synthetic fixtures, bounded validators, and deterministic offline tests
while this gate remains `PENDING`.

P1-10 and P2 must fail closed until this gate records either:

1. written permission for a suitable primary source; or
2. an explicit human-owned `OWNER_APPROVED_WITH_RESIDUAL_RISK` decision that freezes the exact
   source and restrictions before outcomes, followed by independent `GO`; or
3. an explicit human-owned `FALLBACK_APPROVED` decision accepting a named lower-evidence source and
   its scientific limitations before any outcome data are inspected.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `PENDING` | Public material is insufficient or account-specific evidence has not been supplied. The use is not authorized while pending. |
| `ATTESTED` | The human owner supplied the account or project-classification fact; this status does not independently grant a data-use capability. |
| `GRANTED` | Written provider permission and human account attestation authorize the exact recorded uses and limits in this document. |
| `OWNER_APPROVED_WITH_RESIDUAL_RISK` | The provider did not affirm every capability, but the human owner reviewed the response and policy, accepted the remaining interpretation risk, and froze a narrower use boundary. Independent engineering `GO` is still required before acquisition. |
| `DENIED` | The provider refused, or governing terms prohibit, a required use. |
| `FALLBACK_APPROVED` | The human owner explicitly accepts a named lower-evidence source and freezes that choice before outcomes. |
| `NOT_AUTHORIZED` | The source or use is outside project authorization and must not be activated or attempted. |

An agent must not infer `GRANTED` from successful authentication, endpoint availability, free access,
provider marketing, an existing subscription, or absence of an API error. Agents must distinguish
provider-granted capabilities from the human owner's residual-risk authorization and enforce the
narrower boundary in
[`p1-09-owner-risk-authorization.md`](p1-09-owner-risk-authorization.md).

## Current project decision

| Scope | Current status | Consequence |
| --- | --- | --- |
| PR 2D official-document research | `ALLOWED` | Public read-only research may continue. |
| PR 2D provider-neutral contracts | `ALLOWED` | Contracts must represent unresolved entitlement explicitly and fail closed. |
| PR 2D synthetic fixtures and offline tests | `ALLOWED` | Fixtures must be original synthetic material, not provider bytes. |
| Alpaca Basic historical SIP acquisition | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Frozen to historical REST `feed=sip` with request end time at least 15 minutes old; awaits independent P1-09 `GO`. |
| Alpaca `delayed_sip` acquisition | `NOT_AUTHORIZED` | WebSocket and latest-endpoint delayed feeds are outside the frozen source decision. |
| Existing FMP Premium market-reference acquisition | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Private discrepancy lane only; no public FMP-derived output and no one-minute data; awaits independent P1-09 `GO`. |
| FMP-only lower-evidence fallback | `NOT_AUTHORIZED` | FMP may not replace missing Alpaca/SIP evidence. |
| P1-10 delayed historical adapter | `BLOCKED` | Requires a resolved provider and entitlement snapshot. |
| P2 collection | `BLOCKED` | Requires P1-10 and a provider choice frozen before outcomes. |
| Any new paid plan or upgrade | `NOT_AUTHORIZED` | Zero incremental spend is binding. |
| Raw provider data in Git | `NOT_AUTHORIZED` | Only synthetic or explicitly redistribution-approved fixtures may be committed. |

## Binding zero-spend policy

- Do not activate or upgrade Alpaca, FMP, IBKR, Databento, Massive, or another market-data
  subscription.
- Do not begin a trial that automatically converts to a paid plan.
- Do not accept an endpoint, feed, or data option that may generate incremental charges.
- Do not change billing, account, professional-status, exchange, or display-use declarations.
- Do not inspect credentials, account IDs, cookies, invoices, dashboards, or private account pages.
- A human may provide a sanitized attestation of existing plan and account classification without
  committing account identifiers or billing material.
- Existing FMP Premium may be considered only within its current paid scope. No FMP Ultimate or other
  upgrade is authorized.
- Alpaca Algo Trader Plus and every other paid Alpaca market-data option are deferred.
- The future P1-10 configuration must set incremental provider budget to zero and reject any
  dataset/feed whose entitlement snapshot is not explicitly allowlisted.
- Provider selection and fallback selection must be frozen before P2 outcomes are available.

## Alpaca public-document findings

### Product and feed identity

Official Alpaca material distinguishes these market-data identities:

| Identity | Publicly documented meaning | Current PEAS status |
| --- | --- | --- |
| Historical `feed=sip` | Historical CTA/UTP consolidated US-equity data selected with the REST `feed` parameter | `PENDING` |
| `v2/delayed_sip` | A separately named 15-minute-delayed WebSocket SIP feed | `PENDING` |
| Latest-endpoint `feed=delayed_sip` | A separately selectable delayed feed on certain latest endpoints | `PENDING` |
| `v2/sip` | Real-time SIP WebSocket feed associated with a paid entitlement | `NOT_AUTHORIZED` |
| `iex` | IEX-only feed and limited real-time coverage on Basic | Not an approved consolidated-market substitute |
| `boats` | Blue Ocean ATS overnight source | `NOT_AUTHORIZED` for the primary study |
| `overnight` | Alpaca-derived overnight source | `NOT_AUTHORIZED` for the primary study |
| `otc` | OTC source | Outside current study scope |

The project must not use "Alpaca Basic delayed SIP history" as a single dataset name.

Historical REST `feed=sip`, WebSocket `v2/delayed_sip`, and a latest-endpoint `delayed_sip`
selection must have separate provider/dataset/feed identities unless written provider evidence
establishes an exact equivalence relevant to PEAS.

### Historical Basic access

Alpaca's [Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) says a historical SIP
query may be made without the paid subscription when its `end` is at least 15 minutes old. The
current [Market Data API plan table](https://docs.alpaca.markets/us/docs/about-market-data-api)
describes Basic as free, with historical data since 2016, a latest-15-minute restriction, and 200
historical calls per minute.

However, Alpaca's
[Historical Stock Data](https://docs.alpaca.markets/us/docs/historical-stock-data-1) page also says
IEX is the only feed usable without a subscription. That statement conflicts with the more specific
FAQ description of historical SIP queries outside the recent 15-minute window.

Therefore:

- Public material supports a provisional hypothesis that Basic can query historical SIP bars,
  trades, and quotes outside the recent 15-minute window.
- This was the original pre-decision finding: the public-document contradiction prevented
  `GRANTED`.
- This original requirement for further written confirmation is superseded by the later support
  response, the exact endpoint allowlist, and the human owner's
  `OWNER_APPROVED_WITH_RESIDUAL_RISK` decision.
- Successful access must not be used as a substitute for written permission.

### Endpoint shape, pagination, and rate limits

The [historical bars reference](https://docs.alpaca.markets/us/reference/stockbars) documents:

- explicit `start` and inclusive `end`;
- a page limit of 1-10,000 data points;
- `next_page_token` pagination;
- `raw`, split, dividend, spin-off, and combined adjustment modes;
- symbol mapping controlled by `asof`;
- feed identity;
- deterministic ascending or descending sort; and
- `429` rate-limit behavior and rate-limit response headers.

The current public Basic plan advertises:

- 200 historical API calls per minute;
- 30 WebSocket symbol subscriptions;
- historical coverage since 2016; and
- the recent-15-minute historical restriction.

No public source reviewed establishes a contractual Basic bandwidth allowance. Absence of a
published bandwidth limit is not permission for unbounded use. P1-10 must use a tighter
project-owned request, response, page, symbol, time-window, and total-run budget regardless of
provider maximums.

### Conditions, corrections, and scientific adequacy

Alpaca's
[real-time stock-data documentation](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data)
documents:

- nanosecond RFC-3339 timestamps for trades and quotes;
- trade and quote condition-code arrays;
- tape and exchange identifiers;
- quote bid/ask prices, sizes, and exchanges;
- separate trade-correction and trade-cancel/error channels;
- late-trade updated bars;
- trading-status and LULD channels.

The public material reviewed does not establish that Basic historical REST retrieval provides:

- the complete original delivery sequence;
- every correction and cancellation event;
- both pre-correction and corrected states;
- provider-receive timestamps;
- the correction arrival time;
- the correction effective time;
- complete historical halt/status delivery;
- a point-in-time "as known at PEAS observation time" view; or
- the exact CTA/UTP condition-code version applicable to every historical date.

This matters because a current corrected historical result may not reproduce what was knowable at
the original PEAS observation anchor.

Written confirmation must state whether historical Basic quotes, trades, and bars are:

1. final corrected state only;
2. immutable original messages;
3. a revision stream; or
4. another defined representation.

Until then, PR 2D may model all alternatives provider-neutrally but must not assert that Alpaca
supports an as-known-at-the-time reconstruction.

### Public usage restrictions

Alpaca's current
[customer agreement](https://files.alpaca.markets/disclosures/library/AcctAppMarginAndCustAgmt.pdf),
version shown as `V25.2026.06`, states that exchanges and associations assert proprietary interests
in market data and restricts reproduction, distribution, sale, and commercial exploitation without
Alpaca's written consent.

Alpaca's [support article on redistribution](https://alpaca.markets/support/redistribute-alpaca-api)
says Alpaca API data cannot be redistributed.

The public
[Terms and Conditions](https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf)
describes content as personal and noncommercial and restricts copying, reproduction, public display,
mirroring, transmission, distribution, publication, and commercial use without express prior
written consent.

These sources do not clearly grant all PEAS-required uses:

- durable private storage of raw SIP bytes;
- repeated offline deterministic replay;
- retention for a stated period;
- retention after subscription or account termination;
- automated non-display research;
- creation and retention of derived research datasets;
- publication of aggregate latency and return statistics;
- publication of charts or tables derived from the data; or
- use by more than one person or execution agent.

These public-material limitations formed the original `PENDING` finding. The later support response
and human-owner decision resolve the engineering authorization through
`OWNER_APPROVED_WITH_RESIDUAL_RISK`; they do not retroactively convert the public material into an
affirmative provider grant.

### Alpaca questions submitted to support

The human owner submitted written questions covering this proposed use. The private response is
represented by the evidence digest in `p1-09-owner-risk-authorization.md`:

1. The applicable account/product classification and governing agreement.
2. Basic-plan access to historical US-equity `feed=sip` quotes, trades, and bars when `end` is at
   least 15 minutes old.
3. Whether historical `feed=sip`, WebSocket `v2/delayed_sip`, and latest-endpoint `delayed_sip` are
   separate datasets or entitlements.
4. Regular and extended-hours coverage for historical quotes, trades, and bars.
5. Whether overnight/BOATS material is separate and excluded from the requested permission.
6. Permission to capture raw responses into a private, access-controlled, content-addressed
   artifact store.
7. Maximum permitted raw retention duration.
8. Permission for repeated offline deterministic replay by the same individual owner.
9. Permission for automated private non-display research.
10. Whether multiple local execution agents controlled by the same individual count as additional
    users or redistribution.
11. Permission to retain raw data after account closure or subscription termination, including the
    permitted duration.
12. Permission to retain derived normalized facts after account closure or subscription
    termination.
13. Permission to publish aggregate latency, coverage, missingness, disagreement, price-movement,
    and return statistics that do not expose reconstructable raw records.
14. Whether public charts, tables, confidence intervals, and model-validation summaries count as
    display, redistribution, derivative work, or commercial use.
15. Required attribution, notices, review, or display license for published derived aggregates.
16. Whether historical output contains final corrected state only or exposes corrections/
    cancellations and their effective ordering.
17. Availability and completeness of trade and quote condition codes, sequence identifiers,
    exchange/tape identifiers, halt state, and symbol/corporate-action mappings.
18. Whether any requested use requires a paid plan, data license, professional classification, or
    exchange agreement.

The written reply must be attributable to Alpaca and identify the applicable product or account
class. A generic marketing answer is insufficient.

## FMP public-document findings

### Existing-plan assertion

The repository says the human owner already has FMP Premium. No account, invoice, dashboard,
credential, order form, or private subscription evidence was inspected.

Therefore:

- "existing FMP Premium" is a repository assertion, not independently verified entitlement
  evidence;
- the human owner must provide a sanitized plan attestation;
- agents must not inspect the account; and
- the existing plan may not be upgraded or altered.

### Public Premium limits and scope

The current [FMP pricing page](https://site.financialmodelingprep.com/pricing-plans) advertises
Premium as:

- an individual-use plan;
- 750 calls per minute;
- a trailing-30-day bandwidth limit of 50 GB;
- up to approximately 30 years of historical data;
- real-time timeframe;
- intraday charts;
- US, UK, and Canada coverage; and
- priority email support.

The same pricing page reserves "1 Minute Intraday Charting" expressly in the Ultimate feature list,
while FMP's general
[one-minute chart documentation](https://site.financialmodelingprep.com/developer/docs/stable/intraday-1-min)
publicly describes a one-minute endpoint.

Consequently, PEAS must not assume that the existing Premium account includes one-minute history,
full one-minute depth, or every documented endpoint. Exact endpoint-level Premium access must be
confirmed from the applicable order form or a written FMP response without exposing account
material.

### Public endpoint surface

FMP's [stable API documentation](https://site.financialmodelingprep.com/developer/docs) publicly
describes:

- stock quote and short-quote snapshots;
- aftermarket quote and trade endpoints;
- historical intraday OHLCV charts;
- adjusted and unadjusted end-of-day charts;
- symbol-change data;
- split and dividend data;
- exchange/reference information; and
- authentication using an API-key header or URL query parameter.

Any later adapter must use header authentication and must never place a credential in a logged URL,
domain identity, artifact identity, exception, fixture, or repository document.

Public documentation reviewed does not establish that FMP supplies:

- consolidated CTA/UTP NBBO;
- the same SIP dataset identity as Alpaca;
- bid/ask venue identities sufficient to reconstruct NBBO;
- trade sale-condition codes;
- quote-condition codes;
- tape or SIP sequence numbers;
- corrections and cancellations as immutable revision events;
- point-in-time historical revisions;
- provider-receive timestamps;
- a historical as-known-at-the-time view; or
- deterministic correspondence between quote, trade, and bar datasets.

FMP must therefore remain a separately labeled lower-evidence discrepancy source. It must never
silently substitute for an eligible SIP quote.

### Public license restrictions

FMP's [Terms of Service](https://site.financialmodelingprep.com/terms-of-service) describes the
standard license as limited, revocable, non-transferable, non-sublicensable, and restricted to the
subscription period and stated subscription purposes.

The public terms state that, without prior written approval, customers may not distribute, display,
publish, copy, download, edit, create derivative works from, transfer, or otherwise make
unauthorized use of the services. The individual license is limited to personal, non-business,
non-commercial use and prohibits sharing access or integrating data into tools accessible by third
parties.

The terms also state that, upon termination:

- license rights end;
- use of FMP data and information derived from it must cease;
- copies must be destroyed or returned; and
- cached data must be deleted.

The [pricing page](https://site.financialmodelingprep.com/pricing-plans) separately states that
displaying or redistributing FMP data requires a Data Display and Licensing Agreement.

Therefore, under public default terms, and preserved as the historical pre-decision finding:

- raw redistribution is `NOT_AUTHORIZED`;
- public raw fixtures are `NOT_AUTHORIZED`;
- commercial use under an individual Premium plan is `NOT_AUTHORIZED`;
- post-termination raw retention is `NOT_AUTHORIZED` unless a specific written agreement overrides
  the public default;
- post-termination use of derived information is `NOT_AUTHORIZED` unless a specific written
  agreement overrides it; and
- private durable capture, replay, and publication of derived aggregates originally remained
  `PENDING` written confirmation.

This last pending statement is superseded operationally by the later FMP support response and
human-owner decision: offline replay is `GRANTED`; narrowly private capture and processing are
`OWNER_APPROVED_WITH_RESIDUAL_RISK`; publication or display of FMP data or FMP-derived outputs
remains `NOT_AUTHORIZED`. The public-default termination restrictions remain binding.

### Historical FMP attestation requirements

The following requirements drove the human attestation completed on `2026-07-24`:

- current plan name;
- personal, commercial, academic, or other account classification;
- whether the subscription is individual-use;
- verification date;
- applicable order-form or subscription version;
- current calls-per-minute limit;
- current trailing-30-day bandwidth limit;
- relevant endpoint families actually included;
- exact intraday granularities included;
- historical depth for each required endpoint;
- existing renewal status;
- that no upgrade, trial, display license, or account change was made; and
- whether PEAS use is wholly personal and noncommercial.

The attestation proves account state only. It does not override FMP's license restrictions.

### FMP questions submitted to support

The human owner submitted questions covering:

1. Whether the existing Premium subscription permits private durable storage of API responses.
2. Maximum raw retention duration.
3. Permission for repeated offline deterministic replay.
4. Permission for automated private non-display research by the individual subscriber.
5. Whether locally controlled execution agents count as other users.
6. Permission to normalize and retain derived market facts.
7. Permission to publish non-reconstructable aggregate latency, coverage, disagreement,
   price-movement, and return statistics.
8. Whether public aggregate charts and tables require a display or data-license agreement.
9. Whether derived aggregates must be deleted or cease to be used when the subscription terminates.
10. Whether raw data may ever be retained after termination and for how long.
11. Exact Premium access to one-minute, five-minute, fifteen-minute, thirty-minute, hourly, daily,
    quote, aftermarket quote, and aftermarket trade endpoints.
12. Market source and coverage behind each quote, trade, and bar endpoint.
13. Whether quotes represent consolidated NBBO, a provider-defined composite, or another construct.
14. Availability of venue, tape, condition, sequence, correction, cancellation, and revision
    information.
15. Whether historical results are corrected in place and whether earlier states can be
    reconstructed.
16. Whether the proposed use remains personal/noncommercial when PEAS source code is public but all
    provider bytes remain private.
17. Whether an additional agreement or paid license would be required.

Any answer requiring additional spend leaves that use `NOT_AUTHORIZED` under the current zero-spend
policy.

## Current capability decision matrix

| Provider and capability | Status now | Basis |
| --- | --- | --- |
| Alpaca Basic account/product classification | `ATTESTED` | Human owner identifies an individual Basic account and personal/noncommercial use |
| Alpaca historical `feed=sip` outside 15 minutes | `GRANTED` | Alpaca support confirms Basic historical SIP access older than 15 minutes |
| Alpaca `v2/delayed_sip` WebSocket | `NOT_AUTHORIZED` | Outside the frozen source decision |
| Alpaca latest `delayed_sip` endpoints | `NOT_AUTHORIZED` | Outside the frozen source decision |
| Alpaca private durable raw retention | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Maximum 3650 days from capture; account closure or another stop trigger requires deletion/cessation within 30 calendar days or an earlier provider deadline |
| Alpaca offline deterministic replay | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Support reports no additional documented rule; owner accepts residual interpretation risk |
| Alpaca private non-display research | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Frozen to locally controlled personal/noncommercial processing |
| Alpaca raw redistribution or Git fixtures | `NOT_AUTHORIZED` | Public restrictions are explicit |
| Alpaca post-account raw retention | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Delete within 30 calendar days of effective account closure |
| Alpaca derived-data retention after closure | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Cease affected normalized/derived use within 30 calendar days of effective account closure |
| Alpaca publication of derived aggregates | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Non-reconstructable aggregates only; no raw or row-level data |
| FMP Premium account assertion | `ATTESTED` | Human owner attests individual Premium and personal/noncommercial use |
| FMP Premium market endpoints | `GRANTED` | Support identifies included quote, aftermarket, price-change, and batch-quote surfaces |
| FMP Premium one-minute history | `NOT_AUTHORIZED` | Support states one-minute intraday charting requires Ultimate |
| FMP private durable raw retention | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Maximum 3650 days from capture and active-subscription use only; delete/cease no later than effective termination |
| FMP offline deterministic replay | `GRANTED` | FMP support states offline replay/testing is allowed |
| FMP private non-display research | `OWNER_APPROVED_WITH_RESIDUAL_RISK` | Personal local processing only; the MCP answer did not affirm arbitrary agent use |
| FMP raw display, redistribution, or Git fixtures | `NOT_AUTHORIZED` | Separate display/licensing agreement required |
| FMP commercial use under individual Premium | `NOT_AUTHORIZED` | Public individual-use terms prohibit it |
| FMP post-termination raw retention | `NOT_AUTHORIZED` | Public terms require deletion unless overridden |
| FMP post-termination derived use | `NOT_AUTHORIZED` | Public terms require cessation unless overridden |
| FMP publication of derived aggregates | `NOT_AUTHORIZED` | Support states publishing or displaying FMP data requires a separate agreement |
| FMP as SIP-equivalent primary reference | `NOT_AUTHORIZED` | Public evidence does not establish equivalent market semantics |
| FMP-only lower-evidence fallback | `NOT_AUTHORIZED` | Human owner freezes Alpaca historical SIP as primary and rejects silent fallback |
| Paid Alpaca, FMP Ultimate, IBKR, Databento, Massive, others | `NOT_AUTHORIZED` | Zero incremental spend |

## Evidence acceptable for changing status

A provider capability may move to `GRANTED` only when the repository contains a sanitized human
attestation recording:

- provider;
- product and plan;
- account-use classification;
- exact permitted capability;
- exact dataset/feed/endpoint scope;
- permission effective date;
- expiration or termination condition;
- raw retention duration;
- post-account retention rule;
- replay permission;
- derived-use and publication rule;
- required attribution or display conditions;
- provider representative or official support channel type, without personal details;
- date of written response;
- an opaque private evidence reference or SHA-256 digest; and
- human approver and approval date.

Do not commit:

- provider correspondence text;
- names or email addresses;
- account numbers;
- case numbers if they identify the account;
- API keys;
- cookies;
- invoices;
- billing information;
- screenshots of account pages; or
- raw provider data.

The full provider response should remain in a private human-controlled location. The repository
stores only the sanitized authorization summary.

## Fallback rule

FMP cannot become the fallback merely because Alpaca remains pending or is unavailable.

`FALLBACK_APPROVED` requires a human decision made before P2 outcomes that records:

- Alpaca status;
- why FMP is the selected fallback;
- exact FMP endpoint and dataset identities;
- accepted loss of SIP/NBBO and condition/correction fidelity;
- metrics that become unavailable or secondary;
- how provider disagreement will be labeled;
- missing-data treatment;
- whether study thresholds remain scientifically meaningful;
- entitlement and retention permission; and
- confirmation that no spend was added.

If those limitations materially change the meaning of the event study, the fallback requires a
study-contract amendment and fresh independent review.

## PR 2D rule while this gate is pending

PR 2D may:

- create provider-neutral identities and entitlement snapshots;
- distinguish historical `feed=sip` from `delayed_sip`;
- model quote, trade, bar, correction, cancellation, and missing-evidence cases;
- use original synthetic provider-shaped fixtures;
- implement deterministic selection and reason codes;
- implement fail-closed validators;
- test zero-spend restrictions offline; and
- accept ADR 0010 conditionally with P1-10 and P2 still blocked.

PR 2D must not:

- call Alpaca or FMP;
- authenticate;
- inspect an account;
- retrieve provider bytes;
- use real provider responses as fixtures;
- declare either provider authorized;
- select FMP as fallback;
- implement a live acquisition client;
- activate a plan; or
- weaken the P1-10/P2 block.

## Gate-resolution procedure

1. Human evidence intake and owner attestation were completed on `2026-07-24`.
2. Alpaca and FMP written responses are retained privately; the repository stores only the opaque
   evidence digest in `p1-09-owner-risk-authorization.md`.
3. The human owner froze Alpaca historical REST `feed=sip` as primary, FMP Premium as a private
   discrepancy source, and no fallback.
4. The human owner accepted the recorded residual interpretation risks and prohibited the explicit
   FMP publication/licensing and one-minute uses.
5. A fresh independent reviewer must verify that provider, dataset, feed, retention, replay,
   publication, fallback, and cost decisions are internally consistent with ADR 0010.
6. On independent `GO`, set P1-09 to `COMPLETE` and authorize P1-10 implementation only within the
   frozen boundary.
7. On `NO_GO`, repair the record or return the affected capability to `PENDING`; do not call a
   provider while unresolved.
8. Any later entitlement change creates a new versioned snapshot and may not retroactively alter
   the frozen study source policy.

## Exit conditions

P1-09 is complete only when:

- an exact provider/dataset/feed policy is frozen;
- the relevant account classification is attested;
- private raw retention is provider-granted or explicitly owner-approved with residual risk;
- retention duration is fixed;
- offline replay is provider-granted or explicitly owner-approved with residual risk;
- private automated non-display research is provider-granted or explicitly owner-approved with
  residual risk;
- post-account raw and derived retention are explicitly resolved;
- derived aggregate publication is explicitly resolved;
- redistribution remains prohibited unless separately licensed;
- correction/condition limitations are recorded;
- provider fallback is frozen before outcomes;
- incremental budget remains zero;
- the human owner's electronic project instruction is durably attributed in the sanitized record;
  and
- an independent reviewer returns `GO`.

## Human-only actions

These actions require the human owner. Agents must not perform them or inspect the resulting account
or correspondence material.

1. Provide a sanitized attestation that the current FMP plan is Premium, including
   personal/commercial classification, applicable order form, current limits, included intraday
   granularities, and confirmation that no upgrade was made.
2. Send Alpaca the 18 written questions in this gate, explicitly naming historical REST `feed=sip`
   outside 15 minutes and distinguishing it from `v2/delayed_sip`.
3. Send FMP the 17 written questions if FMP will remain a discrepancy source or fallback.
4. Keep full replies privately; commit only a sanitized permission summary and optional evidence
   digest.
5. Decide whether PEAS qualifies as wholly personal/noncommercial use under each provider's terms.
6. If Alpaca refuses or remains unsuitable, explicitly accept or reject the lower-evidence FMP
   fallback before any P2 outcomes.
7. Do not authorize P1-10 or P2 until the entitlement record passes independent review.
8. Do not buy, trial, upgrade, or change any market-data plan.

## Official source register

All sources were accessed on `2026-07-19`.

### Alpaca

- [About Market Data API](https://docs.alpaca.markets/us/docs/about-market-data-api) - Basic/paid
  plan distinctions, historical limits, call rates, subscription model, and authentication
  boundary.
- [Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) - historical SIP query
  behavior outside the recent 15-minute window, default-feed behavior, bars, and conditions.
- [Historical Stock Data](https://docs.alpaca.markets/us/docs/historical-stock-data-1) - feed
  descriptions and conflicting no-subscription wording.
- [Historical bars reference](https://docs.alpaca.markets/us/reference/stockbars) - date range, page
  limit, pagination, adjustment, symbol mapping, feed, and rate-limit response.
- [Real-time Stock Data](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data) - `sip`,
  `iex`, `delayed_sip`, `boats`, and `overnight` identity; trade/quote schema; corrections, cancels,
  conditions, and updated bars.
- [Alpaca customer agreement](https://files.alpaca.markets/disclosures/library/AcctAppMarginAndCustAgmt.pdf) -
  version displayed `V25.2026.06`; market-data restrictions and nonprofessional classification.
- [Alpaca Terms and Conditions](https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf) -
  personal/noncommercial and copying/publication/distribution restrictions.
- [Can I redistribute Alpaca API data?](https://alpaca.markets/support/redistribute-alpaca-api) -
  public redistribution prohibition.

### FMP

- [FMP pricing plans](https://site.financialmodelingprep.com/pricing-plans) - Premium public scope,
  individual classification, calls per minute, bandwidth, historical range, and display/
  redistribution-license warning.
- [FMP Terms of Service](https://site.financialmodelingprep.com/terms-of-service) - subscription
  license, personal/commercial restrictions, copying/display/derivative restrictions, termination,
  and deletion.
- [FMP stable API documentation](https://site.financialmodelingprep.com/developer/docs) - endpoint
  families, symbol changes, quote/aftermarket/chart surfaces, and authentication methods.
- [FMP one-minute chart documentation](https://site.financialmodelingprep.com/developer/docs/stable/intraday-1-min) -
  public one-minute endpoint description requiring reconciliation with plan-specific access.
- [FMP aftermarket quote](https://site.financialmodelingprep.com/developer/docs/aftermarket-quote-quote) -
  aftermarket bid/ask surface.
- [FMP aftermarket trade](https://site.financialmodelingprep.com/developer/docs/stable/aftermarket-trade) -
  aftermarket trade price, size, and timestamp surface.
- [FMP API changelog](https://site.financialmodelingprep.com/developer/docs/changelog) - evidence that
  data structures, symbol methodology, and endpoints can change over time.
