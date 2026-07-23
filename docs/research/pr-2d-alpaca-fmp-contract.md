# PR 2D Alpaca and FMP recorded-contract research

## Control and disposition

- Research owner: independent Luna provider-contract analyst
- Repository checkpoint read: `06e7559`
- Official-source access date: `2026-07-23`
- Provider calls, authentication, account inspection, and provider-byte capture: none
- Incremental spend: none
- Alpaca entitlement: `PENDING`
- FMP entitlement: `PENDING`
- FMP as SIP-equivalent source: `NOT_AUTHORIZED`
- Live P1-10 and P2: `BLOCKED`
- PR 2D use: provider-neutral recorded contracts, original synthetic fixtures, and offline tests only

This report is engineering research, not legal advice. It does not turn documented product
availability into permission. The binding entitlement record remains
`docs/research/market-data-entitlement-gate.md`.

Claims use these labels:

- **D -- documented fact:** directly stated by a current official provider page or agreement.
- **I -- inference:** a constrained conclusion from documented facts; not a provider guarantee.
- **R -- recommendation:** the proposed fail-closed PEAS contract.

Where an official page exposes no stable document version, the source register says `version not
displayed`; “stable” is an FMP route family, not a promise that the schema never changes.

## Executive conclusions

1. **D:** Alpaca exposes three separate relevant identities: historical US-equity REST with
   `feed=sip`, WebSocket `v2/delayed_sip`, and latest/snapshot REST with
   `feed=delayed_sip`. IEX, SIP, BOATS, derived overnight, and OTC are also separately named feeds.
2. **R:** Never collapse those identities. Endpoint family, dataset, feed, entitlement snapshot,
   adjustment, symbol-mapping policy, and acquisition mode must all be explicit.
3. **D:** Alpaca's Basic table advertises US stocks/ETFs, history since 2016, 200 historical calls
   per minute, 30 WebSocket symbols, and a latest-15-minute historical restriction. Its FAQ says a
   historical SIP request can be made without a paid subscription when `end` is at least 15 minutes
   old, while another official historical-data page says IEX is the only no-subscription feed.
4. **I:** That official contradiction prevents an entitlement decision. Successful access would
   not resolve the governing product, account class, retention right, or scientific representation.
5. **D:** Alpaca historical quote/trade/bar pages use opaque `next_page_token` pagination, a
   1--10,000 total-record page limit, symbol-then-time ordering, inclusive `start`/`end`, explicit
   feed, `asof` symbol mapping, and `asc|desc` sorting. Bars additionally identify timeframe and
   adjustment.
6. **D:** Alpaca snapshots can contain latest trade, latest quote, minute bar, daily bar, and
   previous daily bar. **R:** `previousDailyBar` is a snapshot component, not automatically the
   study's eligible prior official close; it requires a separate prior-close eligibility decision.
7. **D:** FMP publishes distinct stock quote, short quote, batch quote, aftermarket quote,
   aftermarket trade, interval-chart, end-of-day, symbol-change, split, and dividend surfaces.
   Public pages do not establish consolidated NBBO, SIP/tape identity, condition completeness,
   correction history, point-in-time revisions, or provider-receive timestamps.
8. **R:** Each FMP surface is a separate lower-evidence dataset/endpoint identity. It may be a
   discrepancy input only after entitlement approval and must never silently replace a SIP quote.
9. **D:** FMP's public Premium page advertises 750 requests per minute and 50 GB trailing-30-day
   bandwidth, but the account, plan version, endpoint access, and one-minute entitlement have not
   been attested. Public endpoint documentation and plan presentation are ambiguous about
   one-minute Premium access.
10. **R:** All checked-in payloads must be original synthetic data. Raw provider bytes, response
    examples copied from documentation, credentials, private correspondence, and account evidence
    stay outside Git.

## Provider, dataset, feed, and endpoint identity

Every row below is a different identity even when values coincide. `providerId`, `datasetId`,
`feedId`, and `endpointId` are recommended PEAS labels, not provider-issued identifiers.

| Claim | Provider | Recommended identity tuple | Official endpoint/surface | Availability and scientific status |
| --- | --- | --- | --- | --- |
| D/R | Alpaca | `alpaca / us-equities-historical-v2 / sip / multi-quotes` | `GET https://data.alpaca.markets/v2/stocks/quotes` | Historical CTA/UTP consolidated quotes are documented; Basic entitlement remains `PENDING`. |
| D/R | Alpaca | `alpaca / us-equities-historical-v2 / sip / multi-trades` | `GET https://data.alpaca.markets/v2/stocks/trades` | Historical consolidated trades are documented; historical correction representation is unresolved. |
| D/R | Alpaca | `alpaca / us-equities-historical-v2 / sip / multi-bars` | `GET https://data.alpaca.markets/v2/stocks/bars` | Trade aggregates; never equivalent to quote or trade facts. |
| D/R | Alpaca | `alpaca / us-equities-historical-v2 / iex / quotes|trades|bars` | Same historical paths with `feed=iex` | Single-exchange evidence; never a consolidated-market substitute. |
| D/R | Alpaca | `alpaca / us-equities-historical-v2 / boats / quotes|trades|bars` | Same historical paths with `feed=boats` | Blue Ocean ATS overnight evidence; excluded from the primary study unless separately approved. |
| D/R | Alpaca | `alpaca / us-equities-stream-v2 / delayed_sip / websocket` | `wss://stream.data.alpaca.markets/v2/delayed_sip` | Fifteen-minute-delayed SIP stream; distinct from historical REST and latest REST. No client belongs in PR 2D. |
| D/R | Alpaca | `alpaca / us-equities-latest-v2 / delayed_sip / latest-quote` | `GET /v2/stocks/quotes/latest` and single-symbol variant | Latest best bid/ask from a named delayed feed; not a historical query. |
| D/R | Alpaca | `alpaca / us-equities-latest-v2 / delayed_sip / latest-trade` | `GET /v2/stocks/trades/latest` and single-symbol variant | Latest eligible trade; documentation says trades excluded from bar-price updates, including odd lots, are omitted. |
| D/R | Alpaca | `alpaca / us-equities-snapshot-v2 / delayed_sip / snapshot` | `GET /v2/stocks/snapshots` and single-symbol variant | Composite response with independently nullable-by-contract components: latest trade/quote, minute/daily/previous-daily bars. |
| D/R | Alpaca | `alpaca / us-equities-latest-v2 / iex|sip|boats|overnight|otc / <endpoint>` | Latest and snapshot feed selector | Each named feed is distinct. `overnight` is Alpaca-derived; `boats` is BOATS; neither is primary SIP evidence. |
| D/R | FMP | `financial-modeling-prep / stock-quote-stable / provider-defined / quote` | `GET https://financialmodelingprep.com/stable/quote?symbol=...` | Provider-defined real-time stock snapshot; public docs do not establish NBBO or sale-condition semantics. |
| D/R | FMP | `financial-modeling-prep / stock-quote-short-stable / provider-defined / quote-short` | `GET /stable/quote-short?symbol=...` | A separate reduced snapshot schema; do not merge with full quote identity. |
| D/R | FMP | `financial-modeling-prep / stock-batch-quote-stable / provider-defined / batch-quote` | `GET /stable/batch-quote?symbols=...` | Separate batch acquisition shape; semantic equivalence to single quote is not documented. |
| D/R | FMP | `financial-modeling-prep / stock-batch-quote-short-stable / provider-defined / batch-quote-short` | `GET /stable/batch-quote-short?symbols=...` | Separate reduced batch acquisition shape; never collapse with full or single-symbol quote identity. |
| D/R | FMP | `financial-modeling-prep / stock-aftermarket-quote-stable / provider-defined / aftermarket-quote` | `GET /stable/aftermarket-quote?symbol=...` | Post-market bid/ask surface; exact venue/composite, session clock, and correction semantics unresolved. |
| D/R | FMP | `financial-modeling-prep / stock-aftermarket-trade-stable / provider-defined / aftermarket-trade` | `GET /stable/aftermarket-trade?symbol=...` | Post-market trade price/size/timestamp surface; not a consolidated trade stream. |
| D/R | FMP | `financial-modeling-prep / stock-batch-aftermarket-quote-stable / provider-defined / batch-aftermarket-quote` | `GET /stable/batch-aftermarket-quote?symbols=...` | Separate batch post-market quote acquisition; equivalence to the single-symbol endpoint is undocumented. |
| D/R | FMP | `financial-modeling-prep / stock-batch-aftermarket-trade-stable / provider-defined / batch-aftermarket-trade` | `GET /stable/batch-aftermarket-trade?symbols=...` | Separate batch post-market trade acquisition; equivalence to the single-symbol endpoint is undocumented. |
| D/R | FMP | `financial-modeling-prep / stock-intraday-stable / provider-defined / chart-1min` | `GET /stable/historical-chart/1min?symbol=...` | OHLCV aggregate; plan access and adjustment/session semantics unresolved. |
| D/R | FMP | `financial-modeling-prep / stock-intraday-stable / provider-defined / chart-{5min|15min|30min|1hour|4hour}` | One distinct path per interval | Each interval is separately identified; do not assume one is deterministically derived from another. |
| D/R | FMP | `financial-modeling-prep / stock-eod-stable / provider-defined / eod-full` | `GET /stable/historical-price-eod/full?symbol=...` | Daily OHLCV/VWAP-style surface; candidate prior-close evidence, not quote evidence. |
| D/R | FMP | `financial-modeling-prep / stock-eod-stable / provider-defined / eod-light` | `GET /stable/historical-price-eod/light?symbol=...` | Reduced EOD schema; distinct from full EOD. |
| D/R | FMP | `financial-modeling-prep / stock-eod-stable / provider-defined / eod-non-split-adjusted` | `GET /stable/historical-price-eod/non-split-adjusted?symbol=...` | Explicitly described as unadjusted for splits; other adjustment semantics still require confirmation. |
| D/R | FMP | `financial-modeling-prep / stock-eod-stable / provider-defined / eod-dividend-adjusted` | `GET /stable/historical-price-eod/dividend-adjusted?symbol=...` | Dividend-adjusted EOD dataset; never mix with raw/unadjusted values. |
| D/R | FMP | `financial-modeling-prep / symbol-reference-stable / provider-defined / symbol-change` | `GET /stable/symbol-change` | Reference surface for symbol changes; point-in-time completeness and stable record IDs are not documented. |
| D/R | FMP | `financial-modeling-prep / corporate-actions-stable / provider-defined / splits|dividends` | Stable split/dividend endpoint families in the official index | Separate reference evidence; never infer adjustment from presence alone. |

**R:** Dataset identity must also include the exact entitlement-snapshot ID, account/product class
attestation, endpoint documentation version/date, currency, requested symbol mapping, adjustment,
and session policy. Default-feed behavior is forbidden: every recorded request declaration must
name a feed explicitly.

**D:** FMP also publishes stock-price-change, exchange-wide quote, ETF/mutual-fund quote, index,
forex, crypto, commodity, and other asset-class quote/chart surfaces. **R:** They are outside the
current US-equity market-reference scope and are separate identities, not alternate routes to any
row above. Adding one requires an explicit provider/source-table amendment and contract review.

## Alpaca endpoint and representation contract

### Historical REST structure and pagination

- **D:** Multi-symbol historical quotes, trades, and bars require a comma-separated `symbols`
  parameter. `start` and `end` accept RFC 3339 or `YYYY-MM-DD` and are inclusive.
- **D:** `limit` is 1--10,000, defaults to 1,000, and applies to total records across all symbols,
  not to each symbol. A response may contain fewer results even when more exist.
- **D:** Results are ordered by symbol first and timestamp second. A busy first symbol can consume a
  page before later symbols appear.
- **D:** When more data exists, the response supplies an opaque `next_page_token`; the caller passes
  it as `page_token`. The token's construction, lifetime, consistency under source updates, and
  cross-query validity are not documented.
- **D:** `sort` is `asc|desc`, default `asc`; `feed` is explicit; `currency` defaults to USD.
- **D:** `asof` maps renamed symbols to an underlying entity for a specified date; `asof=-` disables
  mapping. Returned labels can be rewritten to the queried current symbol across a historical name
  change.
- **D:** Bars require `timeframe`. The published grammar includes 1--59 minutes, 1--23 hours,
  one day, one week, and selected month multiples.
- **D:** Bar `adjustment` supports `raw`, `split`, `dividend`, `spin-off`, `all`, and documented
  combinations on the current multi-bar page.
- **R:** A page token is acquisition telemetry, never market-fact identity. Persist only a private
  bounded token or its hash; credentials, URLs, and tokens stay out of semantic hashes and Git.
- **R:** A continuation is valid only with the exact same canonical query fields and the immediately
  preceding page-chain identity. Reject a repeated token, missing terminal token state, page gap,
  token/query substitution, or aggregate-bound overflow.
- **R:** Canonical facts sort by deterministic fact key, not response page or object order. Record
  the original page number and within-page ordinal as observation evidence so page-size invariance
  and contradictory duplicates remain auditable.

The official pages publish no stock-symbol count maximum for these multi-symbol endpoints and no
maximum time window. **R:** absence of a published limit is not an unbounded contract; use the
project limits below.

### Quotes, trades, bars, and prior close

- **D:** Alpaca's current stock-stream schema documents trade ID, exchange, price, size, condition
  array, RFC-3339 timestamp with nanosecond precision, and tape. Its quote schema documents bid/ask
  exchange, price and round-lot size, condition array, nanosecond RFC-3339 timestamp, and tape.
- **I:** The historical pages use the same market concepts, but their public reference rendering
  does not constitute a promise that every streaming field is populated in every historical row.
- **R:** Preserve timestamp text and parse to a canonical integer nanosecond string. Never round
  through binary floating point or millisecond-only identity.
- **R:** Trade ID/sequence-like values are opaque bounded decimal strings. Null or absence is
  permitted only where the endpoint-specific schema version explicitly allows it; a missing value
  needed for correction linkage makes that linkage unavailable rather than guessed.
- **D:** Minute bars aggregate eligible trades and include pre-market and aftermarket trades. Late
  trades can generate updated bars on the stream. Alpaca's FAQ documents condition-dependent rules
  for bar open/close, high/low, and volume, and states that no bar is produced when eligible price
  fields remain zero.
- **D:** Latest-trade endpoints exclude trades whose conditions do not update bar price; the page
  names odd lots as an example. **R:** latest trade and “last eligible consolidated trade under the
  study policy” are therefore different selection contracts unless proven identical for the exact
  feed and policy.
- **D:** A stock snapshot may include `previousDailyBar`. **R:** treat it as a separately identified
  provider snapshot component. For the primary prior close, require the previous eligible exchange
  session, explicit adjustment policy, eligible trade/bar policy, and complete session calendar.
  Otherwise emit `market.prior-close-ineligible` or `market.prior-close-missing`.
- **R:** Quotes, trades, bars, latest values, snapshots, and prior-close projections are separate
  fact kinds. No fallback is implicit.

### Sessions, overnight, coverage, and entitlements

- **D:** Alpaca's plan table describes Basic securities coverage as US stocks and ETFs and history
  since 2016. It describes Basic real-time equity coverage as IEX and paid coverage as all US stock
  exchanges.
- **D:** Alpaca describes SIP as CTA/UTP consolidated US-equity coverage and IEX as one exchange.
- **D:** The WebSocket page names `v2/delayed_sip` as 15-minute-delayed SIP, `v1beta1/boats` as Blue
  Ocean ATS, and `v1beta1/overnight` as an Alpaca-derived overnight feed.
- **D:** Historical quote/trade/bar selectors currently list `sip`, `iex`, `boats`, and `otc`, but
  not derived `overnight`. Latest and snapshot selectors list both `boats` and `overnight`.
- **D:** Streaming minute bars include pre-market and aftermarket trades. The public historical
  pages expose timestamps rather than a regular-session-only flag.
- **I:** Historical REST can contain records outside regular hours, but public material reviewed
  does not freeze exact extended-hours boundaries, auction treatment, holiday/early-close handling,
  or whether every feed has identical session coverage.
- **R:** Derive session labels from a separately versioned exchange calendar and event timestamp;
  never infer session from endpoint name. Reject BOATS/overnight from primary SIP metrics and label
  any separately approved overnight sensitivity by its exact feed.
- **D:** Basic advertises 200 historical calls/minute and 30 WebSocket symbols. No contractual Basic
  bandwidth ceiling was found in the public pages reviewed.
- **R:** Record both provider-advertised and stricter project bounds in the entitlement snapshot.
  Unknown bandwidth is `null`, never infinity. PR 2D implements no transport or throttling.
- **D:** All non-crypto market-data endpoints require authentication. Trading API uses
  `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY` headers; Broker API uses a short-lived bearer token.
- **R:** Authentication class may enter the entitlement identity; credential material, headers,
  tokens, URLs, and account IDs must not enter request, artifact, fact, selection, or join identity.

### Corrections, cancellations, conditions, and symbol mapping

- **D:** Alpaca's stock stream exposes trade-correction and trade-cancel/error messages and
  separately exposes updated bars, trading status, and LULD channels. Trade/quote conditions and
  tape/exchange identifiers are documented.
- **D:** The conditions metadata endpoint is keyed by `trade|quote` and tape `A|B|C`.
- **D:** Latest endpoints are described as returning data as received and expose no adjustment
  parameter; historical bar and `asof` options can transform prices/volume or symbol labels.
- **I:** Public docs do not prove whether historical REST is final-corrected state, original message
  history, a revision stream, or some other representation. They do not establish historical
  correction arrival/effective times or an as-known-at-observation view.
- **R:** `correctionRepresentation` must be one of `original-stream`, `revision-stream`,
  `final-corrected`, or `unknown`. Current Alpaca historical capability remains `unknown`; the
  corrected view cannot be presented as an as-known view.
- **R:** Preserve provider conditions and the condition-dictionary snapshot identity. Unsupported,
  unknown, contradictory, or over-limit conditions make the fact ineligible with a stable reason;
  they are never silently discarded.
- **R:** `asof`, returned symbol, requested symbol, immutable instrument ID if available, issuer
  mapping, and corporate-action adjustment policy are distinct. A symbol rewrite never proves share
  class or issuer continuity.

## FMP endpoint and representation contract

### Public product scope and limits

- **D:** The current public pricing page advertises Premium as individual use, 750 API calls per
  minute, a 50 GB trailing-30-day bandwidth limit, real-time timeframe, intraday charts, up to about
  30 years of history, and US/UK/Canada coverage.
- **D:** The same presentation specifically lists one-minute intraday charting in Ultimate while
  the general stable documentation advertises a one-minute endpoint.
- **I:** Public marketing does not prove that the asserted existing Premium account includes
  one-minute data, all relevant endpoints, the advertised depth for each endpoint, or the same
  limits today. The applicable order form/account classification is not in repository evidence.
- **R:** Every FMP endpoint is `PENDING` until a sanitized human attestation and written endpoint-
  level confirmation identify the existing plan, account-use class, calls/minute, bandwidth,
  intervals, historical depth, markets, and governing order-form version.

### Quotes, trades, bars, prior close, and timestamps

- **D:** The stable index describes full/short/batch stock quote snapshots; post-market quote and
  trade endpoints; 1-, 5-, 15-, and 30-minute plus 1- and 4-hour OHLCV chart endpoints; full/light,
  non-split-adjusted, and dividend-adjusted EOD charts; and symbol-change data.
- **D:** The aftermarket trade description advertises price, size, and timestamp. The aftermarket
  quote description advertises bid and ask information outside regular hours. The intraday pages
  advertise OHLC and volume with `from`/`to` date parameters.
- **D:** The current public pages reviewed do not expose a complete versioned response schema,
  field-level nullability, timestamp format/timezone guarantee, stable source record ID, sequence,
  venue/tape, quote/trade conditions, or immutable correction linkage.
- **R:** Do not bake remembered or example FMP JSON fields into a provider-neutral contract. A
  future live adapter requires a separately versioned FMP dialect supported by official schema or
  an entitlement-authorized sample. Until then, synthetic FMP cases map only through declared
  adapter fields and must permit absent/unknown provider semantics.
- **R:** A full/short quote field described as a previous close, if later confirmed, remains a
  snapshot fact. Primary prior close should come from a separately selected eligible EOD session
  record with explicit adjustment and calendar policy; otherwise missing.
- **R:** FMP OHLCV bars are never quote midpoint or consolidated-trade facts. Use only a separately
  labeled bar sensitivity/fallback that the study contract and entitlement snapshot authorize.

### Pagination, symbols, windows, sessions, and coverage gaps

- **D:** The public pages reviewed show `symbol` on single quote/chart/aftermarket routes and
  `symbols` on batch quote/aftermarket routes. The one-minute page names `from` and `to`.
- **D:** They do not document a pagination token for relevant quote/aftermarket/chart endpoints, a
  complete maximum symbol count, a maximum chart window, stable result ordering, snapshot
  consistency, or page-size invariance.
- **R:** Record `paginationKind:"none-documented"` for these source-page versions; do not invent a
  page number/token contract. If later official evidence adds pagination, version the endpoint
  contract rather than changing this identity in place.
- **D:** FMP labels aftermarket quote/trade as post-market/outside normal hours. It does not define
  exact premarket, post-market, overnight, holiday, early-close, or timezone boundaries on those
  pages.
- **I:** “Aftermarket” is not evidence of complete extended-hours or overnight coverage. No public
  source reviewed establishes an FMP overnight dataset equivalent to Alpaca BOATS or derived
  overnight.
- **R:** FMP session is `unknown` unless independently derived from a frozen exchange calendar and
  a trusted event timestamp. Do not treat a generic quote as regular-session or an aftermarket
  endpoint as complete extended-hours evidence by name alone.
- **D:** The stable index uses global/USA badges and the pricing page advertises US/UK/Canada at the
  plan level. It does not provide endpoint-by-endpoint exchange, venue, survivorship, delisting,
  share-class, or historical coverage guarantees.
- **R:** Freeze endpoint-specific coverage in the entitlement snapshot. Missing coverage stays in
  the denominator with `market.provider-coverage-unknown` or `market.instrument-not-covered`.

### Adjustments, revisions, and source adequacy

- **D:** FMP publishes distinct full/light, non-split-adjusted, and dividend-adjusted EOD paths plus
  split, dividend, and symbol-change reference surfaces. Its changelog records that endpoints,
  symbol methodology, and chart processing can change.
- **D:** Public pages reviewed do not specify intraday adjustment policy, corrected-in-place
  behavior, historical revisions, cancellation messages, provider-receive time, or the ability to
  reconstruct an earlier as-known state.
- **R:** Require `adjustmentPolicy` and `correctionRepresentation` in every FMP fact. Missing
  documentation maps to `unknown`, which is ineligible for primary adjusted comparisons.
- **R:** Byte-different retrievals create immutable provider observations/revisions even when FMP
  exposes no revision ID. Never overwrite the earlier artifact. Do not infer causal correction or
  supersession without provider evidence; record an unresolved same-endpoint disagreement.
- **R:** FMP cannot provide a primary NBBO metric under current evidence. It remains a separately
  labeled discrepancy candidate, and `FALLBACK_APPROVED` requires a pre-outcome human decision and
  a study-contract amendment if the scientific meaning changes.

### Authentication

- **D:** FMP stable documentation permits API-key authentication in a header or query parameter.
- **R:** A future adapter must use header authentication. The API key, query form, complete URL,
  header value, account ID, and dashboard evidence are forbidden from logs, fixtures, errors,
  artifact identities, fact identities, and Git.
- **R:** `401|403` means unauthenticated/forbidden acquisition, not a missing market fact. PR 2D
  models the failure offline but performs no request.

## Licensing, retention, replay, and derived publication

### Alpaca public position

- **D:** Alpaca's redistribution support article says Alpaca API data cannot be redistributed.
- **D:** The current customer agreement displayed as `V25.2026.06` describes exchange proprietary
  interests and restricts reproduction, distribution, sale, and commercial exploitation without
  written consent. The public Terms and Conditions restrict copying, public display, mirroring,
  transmission, distribution, publication, and commercial use without prior consent.
- **I:** Those documents do not affirmatively grant PEAS durable raw storage, repeated offline
  replay, automated non-display research, multi-agent local processing, post-account retention, or
  publication of non-reconstructable derived aggregates.
- **R:** Raw redistribution and provider bytes in Git are `NOT_AUTHORIZED`; every other listed use
  remains `PENDING` written confirmation. PENDING is not permission.

### FMP public position

- **D:** FMP's public Terms grant access only to the data/endpoints and purposes in the applicable
  subscription/order form during the subscription period. They describe the license as limited,
  revocable, non-transferable, non-sublicensable, and non-exclusive.
- **D:** Without prior written approval, the terms restrict distribution, display, publication,
  copying/downloading, derivative works, transfer, and access by third parties. Personal use is
  individual, non-business, and non-commercial; display to multiple users requires a specific
  agreement.
- **D:** The terms state that limits and endpoint access can be defined by subscription tier,
  order form, pricing page, or account and can change. They also discuss security controls for
  locations where data is stored; this is not a grant to store under the individual plan.
- **D:** On termination, the public terms require cessation of use of data and information derived
  from it, destruction/return of copies, and deletion of received and cached data unless a specific
  governing agreement changes that result.
- **I:** Private durable capture, deterministic replay, derived normalization, agent processing,
  and publication of aggregates are not safely authorized by the public default text.
- **R:** Raw/public redistribution, public raw fixtures, individual-plan commercial use,
  post-termination raw retention, and post-termination derived use are `NOT_AUTHORIZED` under the
  public default. Private capture/replay/research and aggregate publication remain `PENDING` written
  confirmation for the actual order form.

### Written-confirmation matrix

The human owner must obtain provider-attributable answers for the applicable product/account class.
Full replies stay private; only a sanitized permission summary and optional opaque digest enter Git.

| Capability | Alpaca question | FMP question | Status now |
| --- | --- | --- | --- |
| Exact entitlement | Does Basic permit historical US-equity `feed=sip` quotes/trades/bars with `end` at least 15 minutes old, and are historical SIP, `v2/delayed_sip`, and latest `delayed_sip` distinct entitlements? | Which existing Premium order-form version, endpoints, intervals, markets, depth, call rate, and bandwidth apply? | `PENDING` |
| Dataset semantics | Are historical results final-corrected, originals, a revision stream, or another representation; which conditions, tapes, sequences, statuses, corrections, and mappings are complete? | What market source/composite lies behind each quote/trade/bar; are venue, tape, condition, sequence, correction, cancellation, and revision data available? | `PENDING` |
| Sessions | What regular/extended coverage applies; are BOATS/overnight strictly separate? | What exact premarket/post-market/overnight hours, calendars, exchanges, and timezones apply per endpoint? | `PENDING` |
| Private raw storage | May responses be captured in a private access-controlled content-addressed store, and for how long? | Does the existing plan/order form permit the same, at which declared storage locations, and for how long? | `PENDING` |
| Offline replay | May the individual subscriber repeatedly replay stored raw data deterministically? | Same question for the existing plan. | `PENDING` |
| Automated research | Is private automated non-display research permitted, and do local agents controlled by one person count as additional users? | Same question and whether public PEAS code with private bytes remains personal/noncommercial. | `PENDING` |
| Derived facts | May normalized facts be retained, including after account/subscription termination? | May normalized/derived facts be retained, and must they be deleted or cease being used on termination? | `PENDING`; FMP post-termination default `NOT_AUTHORIZED` |
| Aggregate publication | May non-reconstructable latency, coverage, missingness, disagreement, price-movement, return, chart, table, CI, and model-validation aggregates be published? What attribution/display license is required? | Same question; does any public aggregate require a data-display/license agreement? | `PENDING` |
| Cost/classification | Does any required use require payment, professional status, exchange agreement, or other license? | Does any required use require Ultimate, commercial, display, or another paid license? | Any incremental-cost answer is `NOT_AUTHORIZED` |

## Proposed provider-neutral recorded contract

### Exact input fields

**R:** A recorded market acquisition declaration should be an exact inert value with no unknown,
inherited, accessor, symbol, sparse, cyclic, or non-finite fields:

```ts
type RecordedMarketSourceV1 = Readonly<{
  schemaVersion: 1;
  providerId: "alpaca" | "financial-modeling-prep" | string;
  datasetId: string;
  feedId: string;
  endpointId: string;
  endpointDocVersion: string;
  entitlementSnapshotId: string;
  entitlementState: "granted" | "pending" | "denied" | "not-authorized";
  acquisitionMode: "recorded" | "replay";
  instrumentId: string;
  requestedSymbol: string;
  returnedSymbol: string | null;
  issuerMappingId: string;
  factKind: "quote" | "trade" | "bar" | "prior-close" | "correction" | "cancellation";
  sessionScope: "regular" | "extended" | "overnight" | "all" | "unknown";
  adjustmentPolicy: "raw" | "split" | "dividend" | "spin-off" | "all" | "provider-defined" | "unknown";
  correctionRepresentation: "original-stream" | "revision-stream" | "final-corrected" | "unknown";
  queryStartNs: string | null;
  queryEndNs: string | null;
  sort: "asc" | "desc" | "provider-defined";
  providerPageLimit: number | null;
  pageOrdinal: number;
  priorPageChainHash: string | null;
  pageTokenHash: string | null;
  rawArtifactLink: RawArtifactLinkV1;
}>;
```

`entitlementState` other than `granted` must fail live acquisition. Recorded synthetic contract
tests may carry `pending` solely to prove fail-closed behavior; they cannot claim real provider
bytes. `feedId`, endpoint, adjustment, session, and correction representation are always explicit.

### Normalized fact fields and nullability

**R:** Every normalized fact retains:

- provider/dataset/feed/endpoint/entitlement identities;
- immutable instrument, requested/returned symbol, issuer mapping, currency, and venue/tape when
  documented;
- exact fact kind and provider source/revision/duplicate identity;
- canonical event timestamp text plus integer nanoseconds;
- provider receive, sequence, trade ID, quote condition, trade condition, correction arrival,
  correction effective time, session, and status as nullable typed fields;
- canonical decimal-string price fields and integer/decimal-string sizes;
- bar timeframe, start/end, OHLC, volume, trade count, VWAP, and adjustment policy only for bars;
- bid/ask price, size, and exchange only for quotes;
- price, size, exchange, tape, trade ID, and conditions only for trades;
- original and corrected/cancelled references only for revision facts; and
- acquisition/request/retrieval/durable-commit clocks as observation telemetry, never fact identity.

A provider omission stays null with a reason; it is never filled from retrieval time, another
endpoint, another provider, or a sibling fact. Prices and timestamps never pass through binary
floating point before identity.

### Identity and duplicate rules

**R:** The semantic preimage must include provider, dataset, feed, endpoint, instrument, fact kind,
event time, venue/tape, provider sequence/trade ID when available, canonical values, conditions,
adjustment, and correction representation. Entitlement identity belongs to the provider
observation/selection authorization, not to the market event itself. Retrieval page/token/order,
URL, credentials, local paths, and wall clocks enter no market-fact identity.

Exact same provider fact plus exact same content is redelivery. Same provider identity with changed
content is a conflict unless an explicit correction/revision relation exists. Identical content
from different provider/dataset/feed/endpoint identities remains separate evidence. Page size,
response order, restart, and memory/SQLite backend must not change normalized identity or selection.

## Observation anchor: retrieval completion versus durable capture

Provider pages document exchange-event timestamps but do not document PEAS retrieval or durable
commit clocks. Those are local observation evidence.

- **D (repository):** ADR 0009 distinguishes a trusted retrieval-basis selection from capture-basis
  selection. `marketReferenceJoinKey` includes the complete trusted basis. The ledger also states
  that transport end is not separately exposed and is never equated with its recorded retrieval
  epoch.
- **I:** A true response-completion anchor is closer to “when all response bytes were locally
  available” and excludes local hashing/fsync/commit delay. It therefore measures acquisition
  latency plus provider delay more directly.
- **I:** A durable-artifact-commit anchor means “when immutable verified evidence was possessed.” It
  is stronger for audit/replay but adds machine/storage delay, which can vary with payload size,
  concurrency, filesystem, and restart. That can bias release-gap and residual-window metrics.
- **I:** First-byte or request-start anchors would be earlier still and are not substitutes for a
  complete usable response.
- **R:** Preserve all clocks separately: request start, response completion if later exposed,
  recorded retrieval epoch, artifact commit wall/monotonic clock, verified read, normalization,
  selection, and trusted source capture. Never rename one to another.
- **R:** Prefer trusted response completion as the primary scientific availability anchor only if a
  future additive acquisition sidecar can define and prove it without changing frozen ports.
  Report durable commit latency separately and require `responseCompleted <= durableCommitted` on
  compatible clock bases. If true response completion is unavailable, use durable commit as the
  reproducible primary and label the resulting latency as capture-inclusive.

**Human decision required at ADR integration:** choosing response completion versus durable commit
changes the scientific interpretation of first-observation latency and can shift the +1/+5-minute
windows. The integration owner must freeze one primary anchor before outcomes, retain the other as
a secondary diagnostic, and record expected bias. The current `retrievedAtMs` must not be silently
relabelled “transport completion.”

## Proposed stable reason codes

| Reason code | Deterministic trigger |
| --- | --- |
| `market.entitlement-pending` | Provider capability is `PENDING`; live acquisition/real bytes are rejected. |
| `market.entitlement-denied` | Exact capability is denied or not authorized. |
| `market.endpoint-identity-unknown` | Provider/dataset/feed/endpoint/doc version is absent or unsupported. |
| `market.feed-mismatch` | Response/manifest feed differs from the declared feed. |
| `market.silent-fallback-forbidden` | A quote/trade/bar/provider/feed substitution was attempted without a frozen policy. |
| `market.provider-coverage-unknown` | Endpoint-specific coverage is not frozen. |
| `market.instrument-not-covered` | Frozen coverage excludes the instrument/session/date. |
| `market.timestamp-missing` | Required exchange-event timestamp is absent. |
| `market.timestamp-invalid` | Present timestamp is malformed, out of range, or loses precision. |
| `market.timestamp-trust-insufficient` | Timestamp exists but its documented basis cannot support the metric. |
| `market.sequence-missing` | Required ordering/correction sequence is absent. |
| `market.condition-unknown` | A condition is absent from the frozen dictionary. |
| `market.condition-ineligible` | A known condition fails the frozen eligibility policy. |
| `market.correction-representation-unknown` | Historical corrected/original semantics are not frozen. |
| `market.revision-conflict` | Same provider fact/revision identity has different canonical content. |
| `market.page-chain-invalid` | Token/query mismatch, repeated/gapped token, invalid ordinal, or nonterminal chain. |
| `market.symbol-mapping-ambiguous` | Symbol remap does not prove one instrument/share class over the interval. |
| `market.adjustment-unknown` | Required adjustment basis is absent or provider-defined without approval. |
| `market.session-unknown` | Calendar/time evidence cannot assign a frozen session. |
| `market.overnight-primary-forbidden` | BOATS/derived overnight/FMP-unknown overnight was offered as primary SIP evidence. |
| `market.prior-close-missing` | No previous eligible session close exists in the bounded evidence. |
| `market.prior-close-ineligible` | A snapshot/EOD field exists but fails session/adjustment/eligibility rules. |
| `market.provider-observation-invalid` | Artifact/observation/provider/digest/size/as-of evidence fails reconciliation. |
| `market.bound-exceeded` | Any exact parser/manifest/page/fact/state bound is one over. |

## Proposed exact bounds and one-over tests

These are project bounds for recorded parsing and validation, not claims about provider maxima.
Every numeric maximum requires both exact and one-over generated evidence.

| Boundary | Exact PR 2D maximum | Required one-over result |
| --- | ---: | --- |
| Raw response artifact | 16 MiB | 16 MiB + 1 byte -> `market.bound-exceeded` before partial emission |
| Aggregate artifacts per recorded acquisition | 64 MiB | 64 MiB + 1 -> reject atomically |
| Retrieved page members | 64 | 65 -> reject before sort/read |
| Provider page limit field | 10,000 | 10,001 -> reject; Alpaca's documented range is also 1--10,000 |
| Normalized facts per page | 10,000 | 10,001 -> reject |
| Facts per acquisition | 250,000 | 250,001 -> reject without partial selection |
| Symbols per acquisition | 64 | 65 -> reject; this is project-owned because no Alpaca stock max was published |
| Historical query window | 8 calendar days | 8 days + 1 ns -> reject or split before acquisition; no transport is in PR 2D |
| Page token / token hash input | 4 KiB UTF-8 | 4 KiB + 1 -> reject before hashing |
| Symbol / provider IDs | 32 / 128 UTF-8 bytes | one byte over -> reject |
| Timestamp text | 64 ASCII bytes | 65 -> `market.timestamp-invalid` |
| Decimal price/size | 32 ASCII bytes, scale <= 12 | 33 bytes or scale 13 -> reject before numeric conversion |
| Opaque trade/sequence ID | 128 ASCII bytes | 129 -> reject |
| Condition members / member size | 16 / 16 ASCII bytes | 17th member or 17th byte -> reject |
| Object depth / keys / array items | 32 / 64 / 10,000 | one over -> reject before recursive canonicalization |
| Canonical fact | 64 KiB | 64 KiB + 1 -> reject |
| Retained conflicting revisions per provider fact | 16 | 17 -> quarantine acquisition deterministically |
| Response-completion to durable-commit interval | 10 minutes | 10 minutes + 1 ms -> timing-quality failure, never fact mutation |

**R:** If integrated ADR 0010 chooses different limits, it must record the change and retain exact/
one-over coverage. A future live adapter must additionally bound calls/minute and trailing bandwidth
to the lesser of the frozen provider entitlement and project policy.

## Required original synthetic cases

1. Alpaca historical SIP quote/trade/bar pages with identical facts across 1-, 2-, and multi-page
   layouts; opaque token changes must not change facts.
2. Token loop, repeated token, token/query substitution, page gap, nonterminal missing token,
   symbol-first starvation, and record-count/byte exact plus one-over cases.
3. Same values from historical `sip`, historical `iex`, WebSocket `delayed_sip`, and latest
   `delayed_sip`; all remain distinct observations and selections.
4. SIP quote with nanosecond event time, bid/ask venue/tape/conditions; locked, crossed, one-sided,
   zero-price, unknown-condition, and over-limit condition cases.
5. Eligible trade, odd lot, out-of-sequence trade, missing trade ID, duplicate, conflict,
   correction, cancellation, and final-corrected-only historical representation.
6. Raw/split/dividend/spin-off/all bars with same apparent close; adjustment identity must keep
   results distinct.
7. Snapshot with all components, each component absent independently, stale previous daily bar, and
   prior-day bar from a holiday/early-close boundary.
8. Symbol rename across `asof`, `asof=-`, ambiguous share class, returned-symbol rewrite, split,
   dividend, and unmapped symbol.
9. Regular, premarket, post-market, BOATS, derived overnight, early close, holiday, and daylight-
   saving boundary facts; overnight cannot enter primary SIP selection.
10. FMP full quote, short quote, batch quote, aftermarket quote/trade, every interval chart, every
    EOD adjustment family, and symbol-change response with coincident prices but distinct identities.
11. FMP missing timestamp, unknown timezone, provider-defined session, unknown adjustment, no
    sequence, corrected-in-place byte change, and same bytes from a different endpoint.
12. Entitlement `pending`, `denied`, expired, mismatched endpoint, changed plan version, incremental-
    cost requirement, and unapproved FMP fallback; all fail closed before provider bytes are read.
13. Credential/query/header/URL fields attempted in a manifest, identity, error, or fixture; reject
    without echoing the value.
14. Retrieval epoch before/after artifact commit, response-completion absent, incompatible clocks,
    clock regression, exact 10-minute capture lag and one millisecond over.
15. Restart, duplicate redelivery, correction arrival permutations, page-size changes, and memory/
    SQLite replay produce identical normalized and selected identities.

All prose, symbols, prices, conditions, and provider-shaped payloads in these fixtures must be newly
authored synthetic data. Official examples are documentation, not fixture material.

## Unresolved ambiguities and integration handoff

- `HUMAN_DECISION_REQUIRED`: freeze the primary PEAS observation anchor as described above because
  response completion and durable capture answer different scientific questions.
- `PENDING_WRITTEN_ALPACA`: account/product classification; Basic historical SIP entitlement;
  distinction among historical/latest/stream delayed products; sessions; historical correction
  representation; storage; replay; agent use; retention; derived use; publication; termination;
  attribution; and any paid/professional/exchange requirement.
- `PENDING_HUMAN_FMP_ATTESTATION`: asserted Premium plan, use class, order-form version, rate,
  bandwidth, endpoint/interval access, depth, markets, renewal state, and confirmation of no change.
- `PENDING_WRITTEN_FMP`: market source/NBBO status, timestamp/sequence/condition/revision semantics,
  sessions/coverage, private storage, replay, agent processing, derived facts/publication,
  termination deletion, and whether any extra agreement or spend is required.
- `NOT_AUTHORIZED`: live provider access in PR 2D, raw provider fixtures, redistribution, paid
  Alpaca, FMP Ultimate, subscription/account changes, and silent FMP fallback.

The integrated contract can proceed while these permissions are pending by making acquisition fail
closed, keeping every provider/feed/endpoint distinct, and testing only original synthetic recorded
data. P1-10 and P2 remain blocked.

## Official source register

All sources are official provider material accessed `2026-07-23`. No endpoint was called.

### Alpaca

- [About Market Data API](https://docs.alpaca.markets/us/docs/about-market-data-api) -- current
  public plan/authentication page; version not displayed; page showed a recent update marker.
- [Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) -- historical SIP timing,
  default-feed, bar/condition, latest-symbol, and adjustment behavior; version not displayed.
- [Historical Stock Data](https://docs.alpaca.markets/us/docs/historical-stock-data-1) -- feed
  descriptions and the conflicting no-subscription statement; version not displayed.
- [Historical quotes](https://docs.alpaca.markets/us/reference/stockquotes-1),
  [historical trades](https://docs.alpaca.markets/us/reference/stocktrades-1), and
  [historical bars](https://docs.alpaca.markets/us/reference/stockbars) -- current v2 reference
  routes; pages showed “updated about 2 months ago”; no immutable spec version displayed.
- [Latest quotes](https://docs.alpaca.markets/us/reference/stocklatestquotes-1),
  [latest trades](https://docs.alpaca.markets/us/reference/stocklatesttrades-1), and
  [stock snapshots](https://docs.alpaca.markets/us/reference/stocksnapshots-1) -- latest/snapshot
  feed selectors and component descriptions; immutable spec version not displayed.
- [Real-time Stock Data](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data) --
  WebSocket feed identities, trade/quote/bar/correction/cancel/status/LULD schemas; version not
  displayed.
- [Condition codes](https://docs.alpaca.markets/us/reference/stockmetaconditions-1) -- trade/quote
  condition dictionary endpoint by tape; version not displayed.
- [Corporate actions](https://docs.alpaca.markets/us/reference/corporateactions-1) -- separately
  paged corporate-action reference; version not displayed.
- [Alpaca Customer Agreement](https://files.alpaca.markets/disclosures/library/AcctAppMarginAndCustAgmt.pdf) --
  displayed version `V25.2026.06`.
- [Alpaca Terms and Conditions](https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf) --
  public terms PDF; version not reliably displayed by the index.
- [Can I redistribute Alpaca API data?](https://alpaca.markets/support/redistribute-alpaca-api) --
  official support article dated November 2022.

### Financial Modeling Prep

- [Stable API index and authorization](https://site.financialmodelingprep.com/developer/docs/stable) --
  current `stable` route catalog; page/schema version not displayed.
- [Stock Quote API](https://site.financialmodelingprep.com/developer/docs/stock-api),
  [Stock Quote Short](https://site.financialmodelingprep.com/developer/docs/stable/quote-short),
  [Aftermarket Quote](https://site.financialmodelingprep.com/developer/docs/stable/aftermarket-quote),
  and [Aftermarket Trade](https://site.financialmodelingprep.com/developer/docs/stable/aftermarket-trade) --
  current endpoint descriptions; version not displayed.
- [One-minute chart](https://site.financialmodelingprep.com/developer/docs/stable/intraday-1-min),
  [30-minute chart](https://site.financialmodelingprep.com/developer/docs/stable/intraday-30-min),
  [one-hour chart](https://site.financialmodelingprep.com/developer/docs/stable/intraday-1-hour), and
  [full EOD chart](https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-full) --
  representative chart-family pages; version not displayed.
- [Symbol Changes List](https://site.financialmodelingprep.com/developer/docs/stable/symbol-changes-list) --
  current symbol-change surface; version not displayed.
- [Cycle Times](https://site.financialmodelingprep.com/developer/docs/cycle-times-stable) -- current
  stable-family refresh descriptions; version not displayed.
- [Pricing plans](https://site.financialmodelingprep.com/pricing-plans) -- current public individual-
  plan presentation; version not displayed and account-specific entitlement not proven.
- [Terms of Service](https://site.financialmodelingprep.com/developer/docs/terms-of-service) -- current
  public terms; page version/effective date not displayed in the rendered source reviewed.
- [Changelog](https://site.financialmodelingprep.com/developer/docs/changelog) -- official evidence
  that endpoint and chart/symbol processing can change; page version not displayed.
