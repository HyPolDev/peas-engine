# P1-10 Alpaca historical wire-grammar authority

Status: official-document evidence map for the authorized PR 2E amendment
Evidence access date: `2026-07-30`
Provider requests made: `0`

## 1. Decision

Alpaca's official endpoint Markdown pages embed OpenAPI definitions that are sufficient to freeze
the raw JSON response envelopes, compact item keys, JSON types, required item fields, nullable
pagination token, tape enum, and the optional historical-trade update marker for the three already
authorized multi-symbol routes.

The official documents are **not** sufficient to construct a correction or cancellation edge.
They document an optional trade field `u` and the three meanings `canceled`, `incorrect`, and
`corrected`, but do not document:

- which earlier item a corrected item supersedes;
- whether the exchange trade ID is reused or changed across a correction;
- a correction/replacement sequence number;
- the scope or uniqueness lifetime of the exchange trade ID;
- the ordering of an incorrect item and its corrected item;
- how a cancellation identifies its target; or
- whether historical pages expose every revision or a corrected-in-place/final view.

Consequently, the amendment may parse the marker but MUST NOT invent a revision edge. Any item
with `u` present terminates the complete acquisition as `correction-unsupported` unless a
separately accepted authority later supplies the missing link semantics. A trade without `u`
passes strict grammar validation only to a closed no-record quarantine because the static
authority does not prove Consolidated-Last eligibility. Neither disposition can produce a primary
fact or become a fallback.

No account page, dashboard, plan, credential, provider data endpoint, or live payload was accessed.
The evidence process read only public documentation pages. Provider examples contained in those
documentation bytes were not used as authority, copied, structurally transcribed, or committed.
No provider example values or payload bytes are reproduced here.

## 2. Evidence method and precedence

The sources are applied in this order:

1. the embedded OpenAPI definition in the exact historical endpoint `.md` page;
2. normative prose on that same endpoint page;
3. the official Alpaca-py Models and Historical Data documentation for semantic names and
   collection shape;
4. the official Historical Stock Data guide for SIP consolidation;
5. the Real-time Stock Data schema only where it explicitly documents the same compact field and
   semantic;
6. the Market Data FAQ only for bar interval/aggregation and pagination semantics; and
7. the identified Alpaca-authored educational page only for its explicit historical-quote NBBO
   statement.

OpenAPI examples are non-normative evidence and are not copied. A field appearing only in an
example cannot expand the grammar. The real-time schema cannot add a historical REST field.
Provider permissiveness also does not force PEAS to accept a value that the frozen project scope
cannot translate safely.

## 3. Selected official sources

| ID | Official page | URL | Published/update evidence | Authority used |
| --- | --- | --- | --- | --- |
| `AQ` | Historical quotes | <https://docs.alpaca.markets/us/reference/stockquotes-1.md> | embedded `updatedAt: 2026-05-27T17:58:03.000Z`; accessed `2026-07-30` | `GET /v2/stocks/quotes`, multi-symbol ordering/pagination, `stock_quote`, `stock_quotes_resp`, `timestamp`, `stock_tape` |
| `AT` | Historical trades | <https://docs.alpaca.markets/us/reference/stocktrades-1.md> | embedded `updatedAt: 2026-05-27T17:58:03.000Z`; accessed `2026-07-30` | `GET /v2/stocks/trades`, multi-symbol ordering/pagination, `stock_trade`, `stock_trades_resp`, `timestamp`, `stock_tape`, optional `u` |
| `AB` | Historical bars | <https://docs.alpaca.markets/us/reference/stockbars.md> | embedded `updatedAt: 2026-05-27T17:58:03.000Z`; accessed `2026-07-30` | `GET /v2/stocks/bars`, multi-symbol ordering/pagination, `stock_bar`, `stock_bars_resp`, `timestamp`, raw adjustment request meaning |
| `AM` | Alpaca-py Models | <https://alpaca.markets/sdks/python/api_reference/data/models.html> | accessed `2026-07-30` | bar/quote/trade semantic attribute names; `BarSet`, `QuoteSet`, and `TradeSet` keyed by symbol |
| `AH` | Alpaca-py Historical Data | <https://alpaca.markets/sdks/python/api_reference/data/stock/historical.html> | accessed `2026-07-30` | bars, quotes, and trades over one security or a list; their official set return types |
| `AS` | Historical Stock Data | <https://docs.alpaca.markets/us/docs/historical-stock-data-1> | page reported updated six months before access; accessed `2026-07-30` | `sip` covers all US exchanges and consolidates quotes/trades through CTA and UTP |
| `AN` | Understanding Alpaca's Market Data API with Pandas and Plotly | <https://alpaca.markets/learn/understanding-alpacas-market-data-api-with-pandas-and-plotly> | Alpaca Team, `2022-01-26`; accessed `2026-07-30` | historical quotes yield NBBO and expose ask/bid price, size, exchange, conditions, timestamp, and tape |
| `AR` | Real-time Stock Data | <https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data> | accessed `2026-07-30` | corroboration of compact quote/trade/bar keys, condition arrays, tape, and RFC-3339 nanosecond timestamp semantics; not REST-envelope authority |
| `AF` | Market Data FAQ | <https://docs.alpaca.markets/us/docs/market-data-faq> | accessed `2026-07-30` | one-minute bar is left-labeled; interval is start-inclusive/end-exclusive; bars are trade aggregates; token/null pagination behavior |

The endpoint `.md` pages are the decisive sources because the ordinary rendered reference pages
do not expose the complete response schema in extracted prose, while their official Markdown
forms include the embedded OpenAPI definitions.

The exact retrieved public-document bytes have this provenance:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| `AQ` | 17,407 | `38c0211b2d7cc3d58e3a7c6ef0401df98123bb05bfcb2937487fd65060ca1157` |
| `AT` | 17,136 | `fcff97aa00bfbac533fe681df220f3f6042ae3415bba90108f7a749c3ada1161` |
| `AB` | 17,275 | `79e382b51fe778f6ec624a55c367e8c519b3553db35f0c63c86493a2595fb4fe` |

Each digest is SHA-256 over the response bytes retrieved from its exact `.md` URL on
`2026-07-30`. The bytes were hashed in memory and were not stored or committed.

## 4. Historical REST envelopes

### 4.1 Directly documented grammar

| Route | Required top-level data key | Data value | Other required key | Optional key |
| --- | --- | --- | --- | --- |
| quotes | `quotes` | object: symbol string to array of `stock_quote` | `next_page_token` | `currency` |
| trades | `trades` | object: symbol string to array of `stock_trade` | `next_page_token` | `currency` |
| bars | `bars` | object: symbol string to array of `stock_bar` | `next_page_token` | `currency` |

Sources: `AQ`, `AT`, and `AB`, schemas `stock_quotes_resp`, `stock_trades_resp`, and
`stock_bars_resp`.

For all three:

- the data object and `next_page_token` are required;
- `next_page_token` is a nullable string;
- `currency`, when present, is a string;
- each data-object property is a symbol grouping and its value is an array of the route-specific
  item; and
- the endpoint prose orders results by symbol first and item timestamp second.

The OpenAPI definitions do not set `additionalProperties: false` on the envelope or item schemas.
They therefore do not document that the provider will never add a field.

### 4.2 Conservative PEAS closure

The amendment closes the accepted input rather than extending the provider schema:

- the envelope has exactly its route data key, `next_page_token`, and optional `currency`;
- the data object contains only symbols in the verified request identity;
- every symbol key resolves through the predeclared effective-dated instrument mapping;
- an unrequested, unmapped, duplicate-after-canonicalization, or malformed symbol key rejects the
  complete page;
- `currency` may be absent or exactly `USD`, because the accepted request does not authorize the
  provider's currency parameter and the official endpoint pages document USD as its default;
- a different or malformed currency rejects the page;
- unknown top-level or item fields reject the page before normalization; and
- a route's data key cannot be substituted by another route's key.

These rules are local fail-closed policy. They are not claims that Alpaca's OpenAPI closes
additional properties.

## 5. Item grammar

### 5.1 Quote

`AQ` makes all nine compact keys required:

| Key | OpenAPI type | Documented meaning |
| --- | --- | --- |
| `t` | `timestamp` string | event timestamp |
| `bx` | string | bid exchange |
| `bp` | number, `double` | bid price; zero means no active bid |
| `bs` | integer, `uint32` | bid size in shares under the current schema |
| `ap` | number, `double` | ask price; zero means no active ask |
| `as` | integer, `uint32` | ask size in shares under the current schema |
| `ax` | string | ask exchange |
| `c` | array of strings | quote condition flags |
| `z` | `stock_tape` | tape |

The current schema expressly notes that bid and ask size are shares; it also records that the unit
was round lots before `2025-11-03`. A strict grammar validator can bind the unit evidence to the
accepted calendar's US-equity session date rather than guess a UTC cutover instant:

- session date before `2025-11-03`: multiply the wire integer by the instrument version's
  effective round-lot size; and
- session date on or after `2025-11-03`: treat the wire integer as shares.

An unknown session date or round-lot size quarantines the quote. Even when that evidence is known,
the quote remains a no-record quarantine under the owner-authorized narrowed disposition. The
amendment must bind the endpoint documentation version and must not apply today's unit rule to
bytes collected under an earlier documentation/regime identity.

For `c`, the endpoint OpenAPI says:

- one member applies to both sides; and
- two members mean bid-side first and ask-side second.

It does not document a meaning for zero members or more than two members. Those cardinalities,
non-string members, empty members, duplicate members, and members outside the accepted
protocol/version dictionary fail closed. The eight-member provider-neutral PR 2D ceiling is only a
maximum resource bound; it is not authority to accept undocumented Alpaca quote shapes.

`AQ` describes the quote as best bid and ask. `AS` establishes that `feed=sip` consolidates bid/ask
quotes across all US venues through CTA/UTP, and `AN` expressly identifies the historical quotes
API result as NBBO. These statements are sufficient to validate the authorized SIP wire grammar,
but they do not prove the mandatory PR 2D condition, halt, and LULD state needed to emit a
`RecordedMarketRecordV1`. The amendment therefore does not populate `quoteKind`,
`explicitConsolidatedNbbo`, or any other neutral quote field. The same evidence is forbidden for
any other feed identity.

### 5.2 Trade

`AT` makes these seven compact keys required:

| Key | OpenAPI type | Documented meaning |
| --- | --- | --- |
| `t` | `timestamp` string | event timestamp |
| `i` | integer, `uint64` | trade ID sent by the exchange |
| `x` | string | exchange code |
| `p` | number, `double` | trade price |
| `s` | integer, `uint32` | trade size |
| `c` | array of strings | trade condition flags |
| `z` | `stock_tape` | tape |

The same schema defines optional `u` as a string. Its prose supplies this closed vocabulary:

| `u` state | Direct documented meaning | PEAS disposition |
| --- | --- | --- |
| absent | trade is valid | strict grammar validation, then closed no-record quarantine because Consolidated-Last eligibility is not proven |
| `canceled` | the trade has been canceled | terminal `correction-unsupported`; no inferred target |
| `incorrect` | the given trade is no longer valid because it was corrected | terminal `correction-unsupported`; no inferred successor |
| `corrected` | this trade corrects a previous incorrect trade | terminal `correction-unsupported`; no inferred predecessor |

Although those three values appear in the official property description, the OpenAPI property does
not encode them as a formal `enum`. PEAS nevertheless uses the description as the closed accepted
vocabulary and rejects every other present value.

The exchange trade ID is not documented as:

- a provider sequence;
- globally unique;
- unique by symbol, tape, venue, or session;
- stable across corrections;
- a revision key; or
- the target pointer for `u`.

Therefore `i` MUST NOT populate `providerSequence`, `providerRevisionKey`, or
`supersedesRevisionId`. A later amendment may assign a labeled, scope-qualified provider record key
only if it proves the missing scope and stability. Until then, collision/redelivery handling uses
the accepted canonical provider observation/delivery evidence and never ID ordering.

### 5.3 Raw one-minute bar

`AB` makes these eight compact keys required:

| Key | OpenAPI type | Documented meaning |
| --- | --- | --- |
| `t` | `timestamp` string | bar timestamp |
| `o` | number, `double` | opening price |
| `h` | number, `double` | high price |
| `l` | number, `double` | low price |
| `c` | number, `double` | closing price |
| `v` | integer, `int64` | volume |
| `n` | integer, `int64` | trade count |
| `vw` | number, `double` | volume-weighted average price |

`AM` defines the bar timestamp as the opening timestamp. `AF` says a minute bar is left-labeled and
contains trades whose timestamps are at or after that minute's start and before the following
minute. Under the already frozen `timeframe=1Min` request, the neutral mapping is therefore:

- `barStartNs = t`;
- `barEndNs = t + 60,000,000,000`;
- `barKind = "one-minute"`; and
- `adjustmentMode = "raw"` from the verified request identity.

The response item does not repeat timeframe, adjustment, or feed. They are bound from the verified
request, endpoint-channel, and page-chain identity; they are never defaulted from response absence.
All eight response fields participate in the separate private canonical wire-record evidence even
though the accepted PR 2D `BarPayloadV1` carries only close, interval, and adjustment.

## 6. Timestamp authority

The `timestamp` component in all three endpoint OpenAPI definitions is:

- JSON string;
- OpenAPI `date-time`; and
- described as RFC-3339 with nanosecond precision.

`AM` gives the semantic interpretation:

- quote: time of submission of the quote;
- trade: time of submission of the trade; and
- bar: opening timestamp of the bar.

The provider documentation does not prove participant-publication, member-execution, or
SIP-publication semantics. Quotes and trades therefore map only to the accepted
`provider-documented-event` semantic. Bars map to `bar-start`.

The conservative parser accepts only an RFC-3339 instant with:

- a complete date and time;
- an explicit UTC designator or numeric offset;
- no more than nine fractional second digits;
- a real calendar date and valid offset;
- exact signed-64-bit epoch-nanosecond conversion; and
- an exact canonical UTC round trip to the same epoch nanosecond.

The stored `epochNs` is the exact UTC instant. “Nanosecond precision” states the schema's maximum
resolution; it does not prove hidden digits for a particular token. `precisionNs` is therefore
derived from the exact lexical fraction:

- no fractional digits: `1000000000`;
- one through eight digits: `10^(9 - digits)`; and
- nine digits: `1`.

UTC conversion or zero-padding MUST NOT manufacture source accuracy. Leap-second text, more than
nine fractional digits, naive time, date-only text, non-RFC-3339 text, overflow, or a
non-round-tripping value rejects before a neutral record is emitted.

Request `start`/`end` grammar is separate from response `t`. The broader endpoint request schema
does not widen the already frozen canonical request timestamp contract.

## 7. Tape, exchanges, and conditions

The endpoint OpenAPI `stock_tape` enum is `A|B|C|N|O` and describes:

- `A`: New York Stock Exchange tape;
- `B`: NYSE Arca, Bats, IEX, and other regional exchanges;
- `C`: NASDAQ tape;
- `N`: overnight; and
- `O`: OTC.

Only `A|B|C` are compatible with the frozen historical SIP lane. `N` or `O` in this lane is a feed
identity contradiction and rejects the page. `x`, `ax`, and `bx` are exchange strings, but the
endpoint schemas defer their code dictionaries to separate metadata routes. Those routes are not
authorized acquisition capabilities and MUST NOT be called.

The quote and trade condition arrays establish representation, not the complete CTA/UTP semantic
mapping. Their meaning is supplied only by the already accepted, versioned PR 2D protocol
condition maps. Translation:

- selects the map by exact tape/protocol/version identity;
- preserves member order where side position is semantic;
- never unions CTA and UTP code meanings;
- never fetches a metadata dictionary at runtime;
- maps an unknown/version-mismatched code to the accepted fail-closed condition outcome; and
- does not infer halt, resume, LULD, or revision state from a condition that the accepted map does
  not explicitly cover.

`AR` corroborates that the same compact stock quote/trade fields use condition arrays and tape
strings. It does not independently authorize a historical field or a WebSocket route.

## 8. Pagination authority

`AQ`, `AT`, and `AB` state that:

- results are ordered by symbol first and event/bar timestamp second;
- the page limit applies across all symbols, not per symbol;
- fewer than the requested limit may be returned even when more data exists; and
- the returned continuation token must be used to reach later symbols/pages.

The response schema requires `next_page_token` and defines it as nullable string. Therefore:

- `null` is terminal;
- a nonempty string is an opaque continuation token;
- omission is malformed, not another terminal representation;
- empty string is malformed;
- any non-string/non-null value is malformed;
- token content is never decoded, normalized, logged, or exposed;
- the next request may echo it only as the already accepted `page_token`;
- a token on page zero is forbidden because page zero has no verified predecessor; and
- token repetition, substitution, query-identity change, page after null, or other page-chain
  contradiction follows the accepted PR 2E fail-closed pagination contract.

`AF` is consistent with both a non-null continuation and null terminal token. The endpoint
OpenAPI—not an example—settles required presence and nullability.

## 9. Deterministic bar-translation evidence boundary

The provider documents only wire facts. For raw one-minute bars alone, these accepted neutral
values come from the verified acquisition context or frozen PR 2D authority rather than from
hidden provider behavior. Quotes and trades use none of these values to construct a neutral record.

| Neutral field/value | Authority |
| --- | --- |
| `source.providerId`, `datasetId`, `feedId`, `endpointChannelId` | exact frozen PR 2E identities |
| `source.entitlementSnapshotId` | verified run-scoped entitlement decision |
| `instrumentId` | predeclared effective-dated symbol mapping; never symbol hashing |
| `venueTapeId` | `null`; the historical bar response schema publishes no tape or venue |
| `eventKind` | exact `bar` for the authorized bars endpoint channel |
| `eventTime` | section 6 |
| `providerSequence` | `null`; no sequence is documented |
| `sequenceSessionDate` | `null` when provider sequence is null |
| `marketAcquisitionId`, `rawArtifactId` | verified acquisition/artifact evidence |
| `memberKey`, `occurrenceOrdinal` | deterministic verified page/member traversal; delivery-local and permitted to change with page partitioning, never semantic identity |
| `currency` | `USD` only |
| `normalizerVersion`, `conditionPolicyVersion`, `calendarVersion`, `parserContractVersion` | accepted version registry |
| durable times/basis and primary-corpus membership | observation ledger and accepted corpus contract, never response time |

Provider JSON numbers are evidence tokens, not IEEE-754 authority. The parser must retain enough
lexical evidence to create the accepted exact canonical decimal and must reject non-finite,
overflowing, negative where forbidden, excessive, or non-round-tripping values. JSON property
order cannot change canonical payload or neutral identities.

The accepted `canonicalProviderPayloadDigest` is unchanged: it covers only the reduced accepted
`BarPayloadV1` containing close, interval, bar kind, and raw adjustment. Open, high, low, volume,
trade count, and VWAP do not enter that provider-neutral payload or its digest.

The separate private `wireRecordDigest` covers the exact endpoint-channel ID, exact symbol-group
key, and the contract's canonical form of all eight admitted compact bar fields. It excludes
symbol-map property order and envelope pagination material while those facts remain in page-chain
evidence. It is parser-control conflict evidence and is not a PR 2D identity or a substitute for
`canonicalProviderPayloadDigest`.

## 10. Duplicate, redelivery, mutation, and correction conclusions

The official endpoint prose provides ordering; it does not promise stable provider response order
among otherwise equal items. It also does not document redelivery or duplicate suppression.
Those behaviors use the accepted provider-neutral rules:

- identical semantic provider observation plus identical canonical content is redelivery; preserve
  every delivery observation and normalize once;
- byte-identical artifacts may deduplicate physically without collapsing delivery evidence;
- conflicting content for the same asserted stable delivery/revision identity quarantines the
  complete equivalence class;
- equal-time conflicting records without a documented sequence/tie-break remain unordered and
  cannot be selected by page, arrival, artifact, or JSON order; and
- no last-writer-wins rule exists.

For `u`, the only accepted outcome in this amendment is terminal `correction-unsupported`. In
particular:

- `i` is not silently treated as the predecessor/successor link;
- adjacent array position is not a link;
- same timestamp, symbol, exchange, tape, price, size, or condition is not a link;
- page or arrival order is not a link;
- `incorrect` followed by `corrected` is not paired by observation; and
- a cancellation never deletes an immutable prior fact.

This preserves the frozen feed's `correctionRepresentation:"unknown"` identity and the PR 2D rule
that unknown historical correction membership cannot satisfy `recorded-primary`.

## 11. Ambiguity and contradiction register

| Item | Official evidence state | Closure |
| --- | --- | --- |
| exact envelopes and compact aliases | resolved by `AQ`, `AT`, `AB` embedded OpenAPI | contract-test exact shapes |
| unknown JSON fields | OpenAPI does not close additional properties | local fail-closed rejection |
| response currency | optional unconstrained string; request default documented USD | absent or exact `USD`; otherwise reject |
| symbol keys | map keys structurally unconstrained | exact requested/predeclared symbol set only |
| numeric lexical form/scale | JSON numeric types and formats only | exact bounded decimal parser; reject unprovable form |
| timestamp semantics | RFC-3339 ns plus SDK semantic names | provider-documented-event for quote/trade; bar-start for bar |
| timestamp offset/canonical form | RFC-3339 allows offsets; provider schema does not require raw `Z` | parse exact instant, canonicalize UTC, require exact epoch round trip |
| quote condition count | only one- and two-member meanings documented | reject zero or more than two |
| trade condition count | array documented; no empty-array meaning | empty/unknown cannot establish eligibility and fails closed |
| tape `N`/`O` | valid provider enum for other feed families | reject as frozen SIP identity contradiction |
| exchange code dictionaries | delegated to separate metadata routes | no request; preserve only under accepted static authority |
| trade update vocabulary | documented in `u` property prose, not formal enum | exact three strings only |
| correction/cancellation target | not documented | terminal `correction-unsupported`; no revision edge |
| exchange trade-ID scope/stability | not documented | not a sequence/revision key; no ordering |
| historical correction representation | not documented | preserve `unknown`; no primary correction claim |
| halt/LULD state | absent from these three historical response schemas | never infer from absence; selection must fail closed unless accepted independent state exists |
| provider symbol continuity | endpoint supports `asof`, but `asof` is outside the frozen request allowlist | no provider symbol remapping; use predeclared instrument alias |

There is no source contradiction that requires guessing the raw envelope or item grammar once the
embedded OpenAPI is used. The material semantic insufficiencies are Consolidated-Last eligibility
for trades, correction linkage for trade updates, and quote halt/LULD state. The contract closes
them without guessing: no-`u` trades and quotes produce closed no-record quarantine, and a trade
with `u` terminates as `correction-unsupported`. Halt/LULD absence is explicit negative evidence:
it cannot be turned into a false “not halted/executable” assertion. None of these gaps authorizes a
new route, metadata call, WebSocket, or provider witness.
