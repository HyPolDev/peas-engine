# PR 2E P1-10 Alpaca historical wire and translation amendment

Status: authorized contract-amendment draft; narrowed bar-only translation disposition
Accepted base: `038fb381963cd822d2e7f81e55d45d26f1d2c9e5`
Scope: the three frozen Alpaca historical multi-symbol channels only
Implementation authority: none

This amendment closes the JSON wire grammar and deterministic translation boundary that was not
specified by the accepted PR 2E candidate. It does not change an accepted PR 2D type, normalizer,
selection rule, identity preimage, source role, route, query allowlist, feed, entitlement, resource
ceiling, retention rule, or authorization gate.

The parser is an offline consumer of already committed and verified private artifacts. Nothing in
this document authorizes a provider request, credential or account inspection, provider example in
Git, provider-payload publication, FMP transport, a witness, spending, P2 collection, an outcome
calculation, or merge.

Human direction checkpoint, 2026-07-30: after review of the official-document insufficiencies
recorded in sections 5, 6, and 11, the human owner explicitly authorized this exact narrowed
disposition:

- the frozen historical quote and trade routes remain authorized for private raw capture under all
  existing request, entitlement, credential, artifact, retention, and no-public-output gates;
- every schema-valid quote and every schema-valid trade without `u` has the mandatory deterministic
  no-record quarantine outcome specified below;
- every trade with `u` is terminal `correction-unsupported`;
- only eligible raw one-minute bars translate to `RecordedMarketRecordV1`;
- quote/trade evidence makes no selection, fallback, discrepancy, derived-public, or other public
  contribution; and
- any future quote or trade translation is deferred and requires renewed human authority plus a
  prospective independently accepted contract amendment.

This direction resolves the amendment-scope stop condition only. It does not authorize PR 2F to
resume before exact-SHA contract GO and merge authorization, and it does not authorize a provider
request, witness, credential/account inspection, FMP transport, spending, or merge.

## 1. Authority and official-document evidence

The provider-wire evidence is limited to these official Alpaca publications, retrieved as public
documentation on 2026-07-30 without calling a market-data endpoint:

1. [Historical quotes Markdown/OpenAPI](https://docs.alpaca.markets/us/reference/stockquotes-1.md)
   for the `stock_quotes_resp`, `stock_quote`, `stock_tape`, `timestamp`, and
   `next_page_token` schemas and symbol-first/timestamp-second pagination statement.
2. [Historical trades Markdown/OpenAPI](https://docs.alpaca.markets/us/reference/stocktrades-1.md)
   for the `stock_trades_resp`, `stock_trade`, `stock_tape`, `timestamp`, and
   `next_page_token` schemas, including the optional trade-update field.
3. [Historical bars Markdown/OpenAPI](https://docs.alpaca.markets/us/reference/stockbars.md)
   for the `stock_bars_resp`, `stock_bar`, `timestamp`, and `next_page_token` schemas,
   one-minute/raw request semantics, and symbol-first/timestamp-second pagination statement.
4. [Alpaca-py market-data models](https://alpaca.markets/sdks/python/api_reference/data/models.html)
   for the provider's published model meanings, including a bar timestamp as the opening timestamp
   and quote/trade fields as level-one quote and transaction data.
5. [Official Market Data API article](https://alpaca.markets/learn/understanding-alpacas-market-data-api-with-pandas-and-plotly)
   only for the published statement that the historical quotes API yields NBBO.
6. [Official market-data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) only for the
   published one-minute aggregation rule: the bar timestamp is the left endpoint and the interval
   is left-inclusive/right-exclusive.

Provider examples embedded in those publications are not contract fixtures and must not be copied,
structurally transcribed, hashed into repository evidence, or used as a substitute for a schema.
WebSocket schemas, SDK implementation behavior, community material, observed provider bytes, and
undocumented production behavior are not authority for this REST grammar.

The provider-neutral authority remains, unchanged:

- `docs/contracts/pr-2d-provider-source-identity.md`;
- `docs/contracts/pr-2d-timestamp-trust.md`;
- `docs/contracts/pr-2d-market-eligibility.md`;
- `docs/contracts/pr-2d-reason-codes.md`;
- `docs/contracts/pr-2d-resource-bounds.md`;
- `src/providers/market-reference/contracts.ts`;
- `src/providers/market-reference/identity.ts`; and
- `src/providers/market-reference/normalization.ts`.

Conflicts resolve toward the accepted provider-neutral authority and a no-record outcome. This
amendment never fills an absent provider-neutral field with `false`, `not-applicable`, zero,
arrival order, an artifact ordinal, or a guessed protocol meaning.

## 2. Parsing boundary and exact-object discipline

Parsing begins only after the complete page chain is committed, verified, checkpointed, and proven
complete under `pr-2e-p1-10-artifact-replay.md`. It consumes the exact verified artifact bytes with
a bounded JSON tokenizer that retains each number token and rejects before ordinary JavaScript
number conversion.

Every JSON object and array is inert data. Duplicate object names, inherited names, accessors,
symbol properties, proxies, cycles, sparse arrays, holes, non-finite values, negative zero, unsafe
integer conversion, trailing non-whitespace bytes, invalid UTF-8, and an unpaired surrogate reject
the page as `schema-invalid`. All recognized objects reject unknown or extra own fields even where
the provider OpenAPI does not spell `additionalProperties:false`.

Resource preflight uses the accepted lesser-limit rule. In particular:

- page records use the accepted 10,000-record project ceiling;
- normalized facts use the accepted 160,000-fact acquisition ceiling;
- timestamps use `timestampTextBytes`;
- number lexemes use `rawDecimalTokenBytes`;
- symbols use `symbolBytes`;
- condition arrays use `conditionMembers` and `conditionMemberBytes`; and
- opaque tokens use the accepted P1-10 4,096-byte ceiling and the stricter accepted bound if one
  applies.

One-over rejects before allocation, dictionary lookup, numeric conversion, record emission,
deduplication, or selection.

## 3. Common lexical grammar

### 3.1 Numbers

The tokenizer accepts a number for this contract only when its exact ASCII token is:

```text
-?(0|[1-9][0-9]*)(\.[0-9]+)?
```

Exponent notation, a leading plus, a leading zero, trailing decimal point, `-0`, and a token outside
`rawDecimalTokenBytes` reject. Parsing is base-10 integer arithmetic only.

Prices and VWAP must be strictly positive. A quote `bp` or `ap` may be literal zero only because the
official quote schema documents zero as no active side; such a quote cannot emit a provider-neutral
record. Sizes, volume, and counts are canonical non-negative integers, with these documented
machine ranges:

- quote `bs` and `as`, and trade `s`: unsigned 32-bit;
- trade `i`: unsigned 64-bit; and
- bar `v` and `n`: non-negative signed 64-bit.

An emitted bar additionally requires positive `v` and `n`, positive OHLC/VWAP, `l <= o <= h`,
`l <= c <= h`, and `l <= vw <= h`. A schema-valid provider value that fails these internal
consistency checks is contradictory and quarantines its bar key; it is never repaired or rounded.

Canonical decimals are created from the retained token by the accepted PR 2D decimal algorithm:
remove trailing fractional zeroes, reduce zero to `{coefficient:"0",scale:0,negative:false}`, and
otherwise preserve the exact base-10 value. IEEE-754 never enters identity or comparison.

### 3.2 Timestamps

The official OpenAPI defines `t` as an RFC-3339 string with nanosecond precision. P1-10 accepts
this bounded exact subset:

```text
YYYY-MM-DDTHH:mm:ss[.fraction](Z|[+-]HH:MM)
```

`fraction` has one through nine decimal digits. Calendar fields must name a real Gregorian instant;
hour is 00-23, minute and second are 00-59, and leap-second text is rejected. Lowercase `t`/`z`,
missing seconds, whitespace, more than nine fractional digits, invalid offset fields, the RFC-3339
unknown-local-offset spelling `-00:00`, or any other spelling rejects.

Parsing applies a numeric offset by exact integer arithmetic and yields exact signed 64-bit UTC
epoch nanoseconds. `precisionNs` is `1000000000` with no fraction and `10^(9-d)` for `d` fractional
digits. Canonical rendering is UTC with uppercase `T` and `Z` at the same lexical precision class;
an accepted numeric-offset input therefore need not equal its canonical rendering. Parsing the
canonical rendering must reproduce the same `epochNs` and `precisionNs`. A failed parse, overflow,
or failed canonical round trip is `market.timestamp-invalid`. No response, retrieval, replay,
local-file, database, or wall-clock time substitutes for `t`.

### 3.3 Provider code strings

Symbols are exact ASCII strings already present in the validated one-to-one
`canonicalSymbols -> instrumentIds` request membership. Condition and exchange strings are
nonempty ASCII and bounded before interpretation. Condition order is preserved. No meta endpoint
may be called to expand a code.

`z` is exactly one OpenAPI `stock_tape` value: `A`, `B`, `C`, `N`, or `O`. The frozen SIP primary
lane admits only `A`, `B`, and `C` for semantic processing. `N` is the prohibited overnight family
and `O` is the separately prohibited OTC family; either is a page-level
`market.dataset-feed-mismatch` rejection with no record or selection.

The historical REST schemas publish no sequence field. `t`, JSON order, symbol order, page order,
trade `i`, retry order, and artifact order are not provider sequence. Every emitted record has
`providerSequence:null` and `sequenceSessionDate:null`.

## 4. Exact response envelopes and symbol grouping

The top-level object has exactly three permitted own fields:

| Channel | Required records field | Required token field | Optional field |
| --- | --- | --- | --- |
| quotes | `quotes` | `next_page_token` | `currency` |
| trades | `trades` | `next_page_token` | `currency` |
| bars | `bars` | `next_page_token` | `currency` |

The records field is an object. Each own key is one exact requested canonical symbol and each value
is a dense array of the channel's item type. An unrequested symbol, duplicate symbol name,
unmapped/ambiguous alias, wrong case, scalar group, or non-array group rejects. A page may omit a
requested symbol and may carry an empty array; absence does not manufacture a record. Across the
verified complete chain, every item still counts against bounds before deduplication.

`currency`, when present, must be the exact string `USD`. When absent, the result is also USD
because the official endpoint contract documents USD as the request's default and the accepted
request policy forbids a caller-selected currency. Any other value is
`market.currency-unsupported`; it is never converted.

Within each symbol group, `t` must be nondecreasing. Processing order is canonical requested-symbol
unsigned-UTF-8 order, then timestamp, then canonical wire-record digest; JSON object-property order
is irrelevant. A decreasing `t`, a record outside the inclusive requested start/end interval, or a
record under a different symbol is `schema-invalid`.

`next_page_token` is a required own field and is exactly:

- `null`, meaning the one terminal page; or
- a nonempty string within the token ceiling, meaning a nonterminal page.

Empty string, absence, number, boolean, object, array, a token on a terminal declaration, null on a
nonterminal declaration, repeated token, loop, cross-query token, token substitution, and any page
after null reject under the accepted pagination state machine. The token is opaque private
material: do not decode, normalize, log, place in a public error, or use it in a PR 2D semantic
identity.

## 5. Closed quote wire grammar and outcome

A quote item has exactly these required own fields and no optional fields:

| Field | Exact wire type | Published meaning |
| --- | --- | --- |
| `t` | timestamp string | quote timestamp |
| `bx` | string | bid exchange |
| `bp` | number | bid price; zero means no active bid |
| `bs` | uint32 integer | bid size |
| `ap` | number | ask price; zero means no active ask |
| `as` | uint32 integer | ask size |
| `ax` | string | ask exchange |
| `c` | array of strings | quote condition flags |
| `z` | `A|B|C|N|O` | stock tape |

`c` has exactly one or two members, matching the published rule: one applies to both sides; two
apply first to bid and second to ask. Zero or more than two members is contradictory. A zero side,
zero size, crossed pair, or malformed code is retained only as a closed quarantine witness and
never repaired.

The official historical quote material proves that the endpoint yields NBBO, but it does not
provide the accepted PR 2D versioned provider-to-CQS/UTP condition mapping, historical halt/reset
state, or historical LULD executable/limit/non-executable state. The item therefore cannot prove
the required `QuotePayloadV1.condition`, `slow`, `luldState`, and `halted` fields.

Consequently, every schema-valid historical quote item has this exact outcome in amendment V1:

```text
normalization.quarantined
canonical reason = {code:"market.condition-unknown",detail:null}
RecordedMarketRecordV1 emitted = no
normalized fact emitted = no
selection candidate emitted = no
```

The parser may retain a private bounded wire digest and quarantine evidence, but it must not create
a partial quote record with `quoteKind:"nbbo"`, guessed flags, or a nullable field that the accepted
type does not permit. A quote-only acquisition completes with the unchanged PR 2D typed
`market.no-eligible-quote` result only after every page/item quarantine is durable and the complete
corpus is proven. This is not permission to fall back to a trade, bar, FMP, latest, snapshot, or
another feed.

## 6. Closed trade wire grammar, updates, and outcome

A trade item has exactly these required own fields:

| Field | Exact wire type | Published meaning |
| --- | --- | --- |
| `t` | timestamp string | trade timestamp |
| `i` | uint64 integer | trade ID sent by the exchange |
| `x` | string | exchange code |
| `p` | positive number | trade price |
| `s` | positive uint32 integer | trade size |
| `c` | array of strings | trade condition flags |
| `z` | `A|B|C|N|O` | stock tape |

The sole optional own field is `u`. If present, it must be exactly `canceled`, `incorrect`, or
`corrected`, with the meanings published by the official historical-trades OpenAPI. Any other
field or `u` value is `schema-invalid`.

The documentation does not publish the uniqueness/session scope of exchange trade ID `i`; it is
not a sequence, globally stable record key, revision key, or correction edge. It therefore cannot
supply `providerRecordKey`, `providerSequence`, `providerRevisionKey`,
`supersedesRevisionId`, or `effectiveEventTime`.

The authorized historical response also carries no explicit consolidated-Last update result and
does not contain the complete session state required by accepted PR 2D to replay conditional sale
conditions. The parser cannot prove a general trade's `tradeKind` or
`updatesConsolidatedLast`. It must not treat the endpoint label, ascending order, `i`, or absence of
`u` as that proof.

For a schema-valid trade with absent `u`, the exact V1 outcome is:

```text
normalization.quarantined
canonical reason =
  {code:"market.trade-condition-ineligible",
   detail:{tradeConditionFailureKind:"state-insufficient"}}
RecordedMarketRecordV1 emitted = no
normalized fact emitted = no
selection candidate emitted = no
```

If `u` is present, the documented update lacks the immutable prior-revision link and effective
time required by accepted PR 2D. The complete acquisition stops at normalization with terminal
classification `correction-unsupported`. It emits no record, normalized fact, correction graph,
or selection. `canceled` does not manufacture a cancellation payload; `incorrect` does not mutate
or delete an earlier fact; `corrected` does not become a correction or later trade by arrival
order. A mixed page cannot expose its otherwise valid records because the unsupported update may
change corpus completeness.

A trade-only acquisition with no `u` completes with unchanged typed
`market.no-eligible-trade` only after all quarantines and the complete corpus are durable. It never
falls back.

## 7. Closed raw one-minute-bar wire grammar

A bar item has exactly these required own fields and no optional fields:

| Field | Exact wire type | Published meaning |
| --- | --- | --- |
| `t` | timestamp string | opening timestamp of the bar |
| `o` | positive number | open |
| `h` | positive number | high |
| `l` | positive number | low |
| `c` | positive number | close |
| `v` | positive int64 integer | volume |
| `n` | positive int64 integer | trade count |
| `vw` | positive number | VWAP |

The request must already be bound to `timeframe=1Min` and `adjustment=raw`. There is no response
field that can override either value. `t` is `barStartNs`; `barEndNs` is the checked exact sum
`barStartNs + 60_000_000_000`. The interval is `[barStartNs,barEndNs)`. Overflow, a start outside
the query, an end beyond the bounded evidence window, or a noncompleted interval quarantines the
bar and emits no record.

The complete wire-record conflict key is:

```text
{ endpointChannelId, instrumentId, eventKind:"bar", barStartNs }
```

Before translation, a private `wireRecordDigest` covers the exact endpoint-channel identity, exact
symbol-group key, and the channel-specific canonical wire item. It is the lowercase 64-hex result
of the accepted length-framed hash:

```text
H("peas/p1-10-wire-record/v1", preimage)

H(domain, value) =
  SHA-256(
    u64be(byteLength(UTF8(domain))) || UTF8(domain) ||
    u64be(byteLength(UTF8(RFC8785(value)))) || UTF8(RFC8785(value))
  )

preimage = {
  endpointChannelId,
  symbolGroupKey,
  item
}
```

`endpointChannelId` is the exact frozen channel ID. `symbolGroupKey` is the exact validated
containing response-object key. `item` has exactly one of these closed shapes:

```text
quote item = {
  t: canonicalUtcAtSourcePrecision,
  bx: exactValidatedString,
  bp: CanonicalDecimalV1,
  bs: canonicalUnsignedBase10String,
  ap: CanonicalDecimalV1,
  as: canonicalUnsignedBase10String,
  ax: exactValidatedString,
  c: exactValidatedConditionStringsInWireOrder,
  z: exactValidatedTape
}

trade item = {
  t: canonicalUtcAtSourcePrecision,
  i: canonicalUnsignedBase10String,
  x: exactValidatedString,
  p: CanonicalDecimalV1,
  s: canonicalUnsignedBase10String,
  c: exactValidatedConditionStringsInWireOrder,
  z: exactValidatedTape,
  u: null | "canceled" | "incorrect" | "corrected"
}

bar item = {
  t: canonicalUtcAtSourcePrecision,
  o: CanonicalDecimalV1,
  h: CanonicalDecimalV1,
  l: CanonicalDecimalV1,
  c: CanonicalDecimalV1,
  v: canonicalUnsignedBase10String,
  n: canonicalUnsignedBase10String,
  vw: CanonicalDecimalV1
}
```

`canonicalUtcAtSourcePrecision` is the section 3.2 UTC rendering at the same derived precision
class. Every `CanonicalDecimalV1` is the section 3.1 reduced exact base-10 object. Every integer is
the grammar-validated mathematical value rendered as unsigned base-10 digits with no leading
zeroes except the value zero. Condition arrays retain member order. Trade `u` is explicitly `null`
when absent so that the preimage shape is fixed. No raw number lexeme, numeric-offset spelling,
JSON property order, page/token/attempt material, or IEEE-754 value enters the preimage.

The displayed construction order is non-semantic. RFC 8785 emits the exact hash-byte member order:
top-level `endpointChannelId,item,symbolGroupKey`; quote item
`ap,as,ax,bp,bs,bx,c,t,z`; trade item `c,i,p,s,t,u,x,z`; and bar item
`c,h,l,n,o,t,v,vw`. Each `CanonicalDecimalV1` emits `coefficient,negative,scale`.

This digest is parser-control evidence, not a replacement for any accepted PR 2D identity.
Semantically equivalent accepted numeric or offset spellings therefore have the same digest.
Identical key and digest is duplicate/redelivery; preserve every delivery observation and normalize
once. Identical key with a different digest quarantines the complete key with
`{code:"market.provider-observation-invalid",detail:{providerObservationFailureKind:"conflicting-content"}}`
independent of page, order, retry, or backend. It is never guessed to be a replacement or
correction.

## 8. Exact bar translation to `RecordedMarketRecordV1`

Only a bar that passes every prior rule emits a provider-neutral record. The output has exactly the
accepted fields and these values:

| `RecordedMarketRecordV1` field | Exact value/source |
| --- | --- |
| `source.providerId` | `mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c` |
| `source.datasetId` | `mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1` |
| `source.feedId` | `mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023` |
| `source.endpointChannelId` | `mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c` |
| `source.entitlementSnapshotId` | exact validated run entitlement ID; never a default |
| `instrumentId` | exact validated ID paired one-to-one with the containing symbol group |
| `venueTapeId` | `null`; the bar schema publishes no tape or venue |
| `providerRecordKey` | `null`; the bar schema publishes no stable record key |
| `providerRevisionKey` | `null`; the bar schema publishes no revision key |
| `providerStableRecordFamily` | accepted fallback-provider-family hash from section 8.1 |
| `eventKind` | `bar` |
| `eventTime` | `{epochNs:barStartNs,semantic:"bar-start",precisionNs:<derived from t>}` |
| `providerSequence` | `null` |
| `sequenceSessionDate` | `null` |
| `canonicalProviderPayloadDigest` | accepted `deriveCanonicalProviderPayloadDigest(payload)` |
| `marketAcquisitionId` | exact recomputed accepted acquisition-attempt ID |
| `rawArtifactId` | exact verified page artifact ID |
| `memberKey` | exact canonical artifact-member path from section 8.2 |
| `occurrenceOrdinal` | `0`; every array member already has one unique path in its artifact |
| `revisionKind` | `original` as the immutable PEAS capture observation, not a claim about provider correction history |
| `supersedesRevisionId` | `null` |
| `effectiveEventTime` | `null` |
| `sessionKind` | exact result of the accepted calendar/session resolver; unknown rejects emission |
| `currency` | `USD` |
| `payload` | exact object below |
| `normalizerVersion` | `market-normalizer-v1` |
| `conditionPolicyVersion` | `p1-10-alpaca-no-quote-trade-emission-v1` |
| `calendarVersion` | exact validated accepted calendar version used for `sessionKind` |
| `parserContractVersion` | `p1-10-alpaca-historical-wire-v1` |
| `durablyRecordedAtMs` | exact artifact/ledger durable evidence; never provider or replay time |
| `durableLogicalAtMs` | exact compatible durable logical time from accepted ledger evidence |
| `durableClockBasisId` | exact validated ADR-0009 basis ID and direct-parent evidence |
| `primaryCorpusMember` | exact immutable corpus-admission decision; never inferred by the parser |

The bar payload is exactly:

```text
{
  kind: "bar",
  barKind: "one-minute",
  close: canonicalDecimalFromRetainedToken(c),
  barStartNs,
  barEndNs,
  adjustmentMode: "raw"
}
```

Open, high, low, volume, count, and VWAP are validated and included in the private wire digest but
do not enter `BarPayloadV1`, whose accepted shape is unchanged. A difference in any of those fields
still triggers the conflict rule before projection.

### 8.1 Fallback family

Because the historical bar schema publishes no record key, `providerStableRecordFamily` is the
lowercase 64-hex accepted hash:

```text
H("peas/market-provider-fallback-family/v1", {
  providerId,
  datasetId,
  feedId,
  endpointChannelId,
  entitlementSnapshotId,
  instrumentId,
  eventKind: "bar",
  eventTime,
  venueTapeId: null,
  providerSequence: null,
  canonicalProviderPayloadDigest
})
```

No page number, token, response order, URL, raw body, retrieval time, or backend enters it.

### 8.2 Artifact-member evidence

`memberKey` is the exact canonical artifact-member path:

```text
$.bars[<RFC8785 JSON string for symbolGroupKey>][<canonical unsigned itemIndex>]
```

`itemIndex` is the canonical non-negative array index in that verified symbol group. The path is
delivery evidence only and introduces no new identity domain or hash preimage. Page-size changes
may change raw-artifact/member/delivery evidence but must not change provider observation, market
fact, normalized fact, or selection identity.

## 9. Duplicate, correction, and ordering invariants

The parser first counts and validates all wire items, then groups by the channel-specific logical
key, then applies these rules:

1. Equal key and equal wire digest is exact duplicate/redelivery. Preserve all immutable delivery
   observations; emit at most one semantic bar.
2. Equal key and different wire digest is a conflict. Quarantine the whole equivalence class in
   every arrival and backend order.
3. Quote and trade records never become bars, and no channel fills another channel's absence.
4. A later artifact, larger trade ID, later page, later retry, or later durable capture is not a
   market correction or sequence.
5. A bar replacement is unsupported because the endpoint publishes no revision relation. A
   changed bar at the same key is conflict, not last-writer-wins.
6. Any trade `u` stops the complete acquisition as section 6 requires.
7. No selection runs until every page outcome, duplicate group, conflict, quarantine, and emitted
   bar is durable and the full corpus revalidates.

Canonical results must be byte-identical across replay page sizes 1, 2, 7, and 10,000; provider
object-property order; retry order; restart from every durable checkpoint; and memory/SQLite
backends. No post-return timer, stream, callback, promise, or database activity is permitted.

## 10. Required executable amendment matrix

All fixtures are original and synthetic. No fixture may copy or structurally transcribe a provider
example. The matrix must prove at least:

- exact envelope required/optional fields and every missing/extra/wrong-type case;
- duplicate JSON names, hostile object shapes, sparse arrays, and one-over bounds;
- requested, omitted, extra, duplicate, wrong-case, and unmapped symbol groups;
- absent/present `currency`, exact USD, and every other value;
- timestamp forms at 0 through 9 fractional digits, exact `Z` and numeric-offset conversion,
  invalid dates/offsets, `-00:00`, lowercase, leap second, >9 digits, overflow, and failed canonical
  round trip;
- exact decimal/integer limits, exponent/plus/leading-zero/negative-zero rejection, OHLC/VWAP
  contradictions, and no floating-point identity;
- quote exact fields, condition arity 1/2, zero side, unknown flags, `N`/`O` tape rejection, and
  invariant no-record quarantine;
- trade exact fields, uint64 ID limits, absent and each exact `u`, unknown `u`, absent revision
  linkage, invariant no-record outcome, and complete-acquisition stop for `u`;
- bar exact fields, one-minute interval arithmetic, completed/open interval, raw adjustment,
  exact record projection, all accepted identity fields, and unknown calendar/corpus evidence;
- token null/string, empty/malformed/oversized/repeated/loop/substitution/cross-query cases and page
  after terminal;
- exact duplicate/redelivery and same-key conflicting bytes in every order;
- deterministic replay and restart invariance; and
- zero provider calls, zero credential reads, zero raw/token/public leakage, zero fallback, and no
  post-return activity.

## 11. Authorized gate disposition and explicit limitation

The exact historical REST OpenAPI is sufficient to freeze parsing for all three channels and to
emit raw one-minute bars. It is not sufficient to populate all mandatory provider-neutral quote or
trade fields without guessing. Amendment V1 resolves that insufficiency only by the deterministic
no-record/quarantine outcomes in sections 5 and 6.

The human owner explicitly accepted this material functional limitation on 2026-07-30:

- Alpaca historical quotes cannot produce Q(t) under this amendment;
- Alpaca historical trades cannot produce L(t) or auction-trade sensitivities under this
  amendment; and
- only the raw one-minute-bar sensitivity can reach `RecordedMarketRecordV1`.

Quotes and trades remain authorized private raw-capture routes, but their bytes contribute only
the mandatory quarantine/terminal evidence defined here. They cannot contribute a fact,
candidate, selection, fallback, discrepancy, derived public value, or public output.

Removing that limitation or translating any quote or trade requires renewed human authority and a
separately accepted prospective amendment backed by official static provider-to-protocol
condition authority plus the historical halt/LULD/session state and correction-link evidence
required by PR 2D. It must not be inferred from a WebSocket schema, a meta-endpoint call, provider
examples, or observed production bytes.

Until this complete amendment, its fixtures, and its executable tests receive an independent
exact-SHA `CONTRACT_GO`, PR 2F remains stopped. A contract GO is neither merge authorization nor
provider-call authorization.
