# PR 2E P1-10 Alpaca wire-translation acceptance matrix

Status: executable contract-amendment evidence; offline only
Accepted base: `038fb381963cd822d2e7f81e55d45d26f1d2c9e5`
Normative contract: `docs/contracts/pr-2e-p1-10-alpaca-wire-translation.md`
Executable owner: `test/p1-10-wire-translation-contract.test.ts`

## 1. Closed disposition

This matrix implements the human-authorized narrowed disposition:

- historical quote pages are parsed under the closed wire grammar and every schema-valid item is
  durably quarantined with `market.condition-unknown`;
- historical trade pages are parsed under the closed wire grammar and every schema-valid item
  without `u` is durably quarantined with
  `market.trade-condition-ineligible/state-insufficient`;
- any schema-valid trade containing `u=canceled|incorrect|corrected` stops the complete acquisition
  as `correction-unsupported`;
- only eligible raw one-minute bars emit `RecordedMarketRecordV1`; and
- quote/trade evidence produces no record, normalized fact, selection, fallback, discrepancy,
  derived-public output, or other public contribution.

The executable is a deterministic model, not production transport. It reads no credential, opens
no provider connection, accepts no provider URL, and contains no live payload. Every fixture is
original project-authored synthetic input.

## 2. Result vocabulary

| Result | Exact meaning |
| --- | --- |
| admit | Closed envelope and item grammar pass. |
| reject | The complete page or chain fails before any record or selection can escape. |
| quarantine | The item/key is retained only as private typed evidence; no record is emitted. |
| correction-unsupported | A documented `u` value is present, but immutable revision linkage is unavailable; the complete acquisition stops. |
| emit-bar | One exact accepted `RecordedMarketRecordV1` bar is emitted and accepted by the PR 2D normalizer. |
| terminal | Required `next_page_token` is `null`. |
| continuation | Required `next_page_token` is a nonempty private opaque string within the accepted byte ceiling. |

## 3. Executable test map

| Executable test | Contract coverage | Expected proof |
| --- | --- | --- |
| `wire fixture catalog is closed, original synthetic, inert, and fully enumerated` | Fixture provenance, six-file manifest, 9 valid + 50 grammar + 19 pagination/delivery + 8 hostile-atomicity cases | Exactly 86 unique case IDs; no provider evidence, network authority, URL, header, credential, account, or copied example |
| `all 50 grammar-fault fixtures execute every literal operation and disposition` | Literal `baseCaseIds`, endpoint mappings, fields, values, generated recipes/bounds, raw-number tokens, timestamps, raw JSON texts, and per-vector dispositions from all 50 grammar cases | A closed operation interpreter expands and executes every literal case; all expanded vectors match their fixture disposition, rather than relying on catalog presence or manually recreated lookalikes |
| `all 8 hostile-atomicity recipes execute with literal zero-trap and zero-output counters` | All eight literal immediate-update-stop and recursively inert descriptor recipes from `hostile-atomicity-faults.json` | Every case ID executes its declared construction and exact disposition; getter, setter, Proxy-trap, later-read, later-parse/digest/quarantine/record, normalized-fact, and selection counters remain at the literal expected values |
| `exact RFC3339 Z and numeric-offset parsing preserves lexical precision and canonical UTC` | RFC3339 `Z` and numeric offsets, precision classes 0..9, exact offset arithmetic, signed-64-bit epoch ns, same-precision UTC render/reparse | Exact epoch/precision equality; invalid calendar, leap second, lowercase, `-00:00`, offset overflow, >9 digits, overflow, and 65-byte input reject |
| `all valid synthetic pages admit exact grammar and enforce bar-only translation` | All valid quote/trade/bar envelopes | Quote/trade record count zero; every `u` terminal; eligible bars normalize through accepted PR 2D code |
| `response envelopes, currency, symbol grouping, and closed item fields fail closed` | Required/optional/unknown envelope fields, exact `USD`, symbol membership/case/group type, required/unknown/null item fields | Every unauthorized shape rejects; omitted or exact `USD` admits |
| `quote/trade conditions, tapes, updates, and absent sequence authority never emit records` | Quote condition arity 1/2, trade conditions 0..8, member bounds, SIP tapes A/B/C, prohibited N/O, all exact `u` values | Deterministic no-record quarantine; N/O rejects as feed mismatch; the first fully validated `u` stops complete acquisition before any later same-symbol, same-page-symbol, or later-page property read |
| `canonical trade-update precedence is exhaustive across direct, restart, memory, and SQLite paths` | 27 original-synthetic `canceled|incorrect|corrected` x `first|middle|last` x malformed/getter-hostile/Proxy-hostile vectors; canonical-earlier update group inserted after the later-canonical group; direct admission and verified-raw integrated chain; uninterrupted and every durable prefix; memory and SQLite | Every path durably returns only `correction-unsupported`, clears continuation, stores no later page, emits zero records/bar observations/later quarantines/selections/replacements/reversible mutations, and performs exactly zero getter or Proxy-trap calls |
| `decimal and integer lexical grammar, machine limits, and one-over bounds are exact` | Closed raw number grammar, leading plus, exponent, leading zero, trailing point, negative zero, uint32/uint64/int64 exact/one-over | Exact limits admit; every one-over/noncanonical token rejects before conversion |
| `numeric wire fields reject wrong types and bars quarantine every contradiction` | Price/VWAP types, positivity, bar OHLC/VWAP relationships, volume/count positivity, completed interval | Wrong types reject; valid-number contradictions and nonpositive bar counts quarantine with no affected bar record |
| `bar projection is exact RecordedMarketRecordV1 and accepted normalizer input` | Every accepted provider-neutral field/value, `providerSequence:null`, `sequenceSessionDate:null`, raw one-minute payload, fallback family | Deep field equality and accepted PR 2D normalization |
| `literal bar golden independently recomputes accepted hashes and exact record bytes` | Original synthetic golden, payload digest, accepted fallback-family framed hash, literal artifact-member path | A test-local recursive RFC 8785 encoder and length-framed SHA-256 implementation, which import neither production canonicalization nor production hash code, reproduce both literal hashes; exact record equality and accepted normalizer input follow |
| `wireRecordDigest uses the exact frozen canonical preimage and collapses equivalent spellings` | Exact length-framed domain, endpoint-channel ID, symbol-group key, per-kind canonical item, UTC-at-source-precision, decimals, integers, condition order, explicit nullable `u` | Independent framed-hash equality; equivalent offset/decimal spellings deduplicate; a nonprojected bar-field change changes the digest |
| `required opaque token grammar and complete page-chain contradictions fail closed` | Token required/null/nonempty/4096-byte, first-request rule, binding, ordinals, loops, cross-query use, page after terminal, incomplete chain | Exact terminal/continuation behavior; every contradiction rejects; token never enters public summary |
| `journal persists verified pages, token history, terminal resolution, and restart-safe stops` | Raw-page digest/checkpoint, presented and returned private token material/hash/history, incomplete restart, outcome persistence, immediate trade-`u` stop | Incomplete prefixes return zero; repeated token rejects after restart; after the first fully validated `u`, no later same-page/later-symbol/later-page property is read and no later parse/digest/quarantine/record occurs; the terminal result is persisted, reloaded, validated, and recomputed only through that stop position before return |
| `every journal load independently rejects incomplete and terminal checkpoint mutation` | Closed checkpoint shape, endpoint kind, complete parse/configuration identity, contiguous ordinals, raw bytes/digests, token material/hash continuity and complete history, expected continuation, terminal state, terminal-only outcome, persisted resolution | Memory and SQLite reject stored endpoint/context/field/ordinal/raw/token/history/terminal/outcome mutation and runtime endpoint/context changes before item parsing; even an internally rehashed mutated result is rejected by complete raw-page replay and outcome recomputation |
| `chain page, per-page byte, aggregate byte, and outcome ceilings are exact` | 16 successful pages, 10 MiB raw/page, 64 MiB aggregate verified bytes, and 160,000 normalized facts | Named runtime helpers accept each exact numeric ceiling and reject one over; aggregate arithmetic is tested directly without allocating a 64 MiB fixture |
| `complete-chain bar deduplication and conflicts are global across pages` | Cross-page identical/conflicting bar keys | Identical deliveries normalize once; every cross-page conflicting delivery quarantines and the affected key emits no record |
| `every pagination-delivery fixture operation executes with its literal disposition` | All 19 named fixture operations, including corrected same-trade-ID no-stable-identity vectors | Every fixture operation runs; none is satisfied by catalog presence alone |
| `raw JSON parsing rejects malformed text, duplicate names, and trailing bytes before schema` | Lexical parser boundary | Reject before object-schema admission without losing duplicates through `JSON.parse` |
| `hostile objects, accessors, symbols, sparse arrays, and inherited state are inert rejects` | Recursive descriptor validation at envelope, symbol-group, array, item, condition-array, continuation, and nested hostile-value depths; cycle detection; trusted passive Proxy detection before reflection | Typed reject with exactly zero getter/setter calls and zero `ownKeys`, descriptor, prototype, `get`, or other Proxy-trap calls; arrays are descriptor-validated for length, dense indexes, and no extra/symbol properties before child reads |
| `raw tokenizer depth, node, key, array, and decoded-text ceilings are typed` | Raw depth 32, nodes 250,000, parser tokens 250,000 counted separately (including object-key strings), keys 64, array 10,000, generic string 1,024, token 4,096 | Exact admits; one-over rejects with the named typed bound; the 250,000/250,001 parser-token vector remains at 126,032 raw nodes |
| `record, condition, timestamp, token, and page-record bounds accept exact and reject one-over` | 10,000 records, condition/member, 32-byte decimal, 64-byte timestamp, 4,096-byte token | Exact admits; one-over rejects before semantic output |
| `identical bar redelivery deduplicates; conflicting same-key bytes quarantine in every order` | Exact duplicate/redelivery and same logical bar key with different bytes | One semantic bar for identical bytes; complete conflict class quarantined independently of order |
| `canonical output is invariant across page sizes, restart prefixes, property order, and backends` | Page sizes 1/2/7/10,000; every durable prefix; memory/SQLite; response property order | Byte-equal semantic projections across every path |
| `unknown calendar evidence quarantines and fully offline execution has zero side effects` | Calendar proof, credential/network/fallback/public-output/no-post-return gates | Unknown calendar emits no record; all five side-effect counters remain zero after microtask and event-loop settlement |

## 4. Literal synthetic fixture coverage

The executable asserts the closed inventory and executes every grammar, pagination/delivery, and
hostile-atomicity fixture operation and disposition. The grammar operation interpreter expands each
literal base case, endpoint, field, value, generated recipe, raw token, and raw text; the targeted
category tests below remain as additional semantic assertions. No unlisted fixture file or case may
silently enter the amendment.

### 4.1 Valid pages

`wire-quotes-terminal-grouped`, `wire-quotes-continuation-currency`,
`wire-trades-terminal-grouped`, `wire-trade-update-canceled`,
`wire-trade-update-incorrect`, `wire-trade-update-corrected`,
`wire-bars-terminal-grouped`, `wire-bars-continuation`, `wire-bars-empty-terminal`.

### 4.2 Envelope, field, lexical, and bound vectors

`fault-envelope-root-not-object`, `fault-envelope-missing-required`,
`fault-envelope-unknown-field`, `fault-envelope-cross-kind-member`,
`fault-envelope-data-member-not-object`, `fault-envelope-currency`,
`fault-symbol-group-unrequested`, `fault-symbol-group-key-shape`,
`fault-symbol-group-not-array`, `fault-symbol-group-item-not-object`,
`fault-empty-nonterminal-envelope`, `fault-item-missing-required-field`,
`fault-item-unknown-field`, `fault-item-null-required-field`, `fault-timestamp-type`,
`fault-timestamp-canonical-round-trip`, `exact-timestamp-offset-round-trip`,
`exact-timestamp-supported-precision`, `fault-timestamp-string-bytes`,
`fault-condition-container`, `fault-condition-member-type`,
`exact-and-excessive-quote-condition-count`, `exact-and-excessive-trade-condition-count`,
`exact-and-excessive-condition-member-bytes`, `fault-tape-type-or-value`,
`exact-tape-values`, `fault-frozen-sip-tape-contradiction`, `fault-quote-string-fields`,
`fault-quote-uint32-fields`, `exact-quote-uint32-boundaries`, `fault-trade-uint32-size`,
`exact-trade-uint32-size-boundaries`, `fault-trade-id`, `exact-and-excessive-trade-id`,
`fault-trade-update-value-or-type`, `documented-trade-update-values`,
`fault-json-number-fields`, `fault-nonpositive-price-or-vwap`,
`exact-and-excessive-decimal-token-bytes`, `fault-decimal-token-grammar`,
`fault-bar-int64-fields`, `exact-and-excessive-bar-int64-fields`,
`fault-bar-ohlc-contradiction`, `fault-record-count`, `fault-record-order-within-symbol`,
`fault-next-page-token-type`, `fault-next-page-token-empty`,
`exact-and-excessive-next-page-token-bytes`, `fault-malformed-json`,
`fault-duplicate-json-key`.

### 4.3 Pagination, delivery, duplicate, conflict, and correction vectors

`chain-terminal-null`, `chain-two-page-opaque-continuation`, `chain-first-request-token`,
`chain-token-substitution`, `chain-repeated-token-loop`, `chain-skipped-page-ordinal`,
`chain-duplicate-page-ordinal`, `chain-cross-query-token`, `chain-page-after-terminal`,
`chain-incomplete-after-nonterminal`, `delivery-identical-bytes`,
`delivery-same-asserted-identity-conflicting-bytes`,
`trade-same-id-identical-items-no-stable-identity`,
`trade-same-id-different-items-no-stable-identity`, `item-identical-bar-key-redelivery`,
`item-conflicting-bar-key`, `trade-correction-without-linkage`,
`trade-correction-guessed-target-forbidden`, `replacement-marker-unknown`.

### 4.4 Immediate-stop and recursive inertness vectors

`atomic-valid-update-before-malformed-or-hostile-same-array-item`,
`atomic-valid-update-before-hostile-later-symbol-group`,
`atomic-valid-update-before-hostile-later-page`, `hostile-array-index-accessor`,
`hostile-nested-numeric-proxy`, `hostile-custom-array-prototype`,
`hostile-extra-own-array-property`, `hostile-nested-accessor-and-proxy-values`.

### 4.5 Exact golden

`translate-first-peasivy-raw-one-minute-bar` supplies the complete literal
`RecordedMarketRecordV1`, accepted payload digest, accepted fallback-family preimage/hash, and the
section 8.2 literal member path `$.bars["PEASIVY"][0]`. The executable independently recomputes
both hashes and then compares the complete record.

## 5. Determinism and leakage assertions

Semantic comparison excludes only the two delivery-local fields whose change is explicitly
permitted by the contract: `rawArtifactId` and `memberKey`. It retains every other
`RecordedMarketRecordV1` field, including the complete source, instrument/venue/provider keys,
fallback family, event kind/time/precision, provider sequence fields, payload digest,
`marketAcquisitionId`, `occurrenceOrdinal`, revision/effective-time fields, session, currency,
payload, every policy/parser/calendar version, all durable time/clock evidence, and corpus
admission.

The journal stores endpoint kind; a deterministic parse/configuration identity; verified raw-page
bytes and digests; raw artifact IDs; presented/returned token hashes; the private resumable
next-token material; the complete prior returned-token hash set; page ordinal; logical request
identity; and terminal state. The parse/configuration identity binds every requested symbol and
instrument mapping, query bound, entitlement/acquisition identifier, calendar/clock/durable-time
input, session/corpus decision, timeframe, and adjustment, excluding only page-local
`rawArtifactId`. An incomplete prefix persists only this verification state and returns zero
records. Full item parsing and global resolution begin only after a terminal null token. The
complete no-record/quarantine/bar resolution and its verification hash are saved before any result
is returned. Every load validates endpoint and configuration identity before item parsing, then the
exact checkpoint/page shapes, contiguous page/token chain, recomputed raw digests, token hashes and
history, expected continuation, and terminal/outcome consistency. A terminal return additionally
replays the verified raw pages in deterministic order and recomputes the complete outcome. A
trade-`u` outcome replays only through the first fully validated update item. The current correction
page remains byte-verified and durable; a later page is neither read nor appended. `runChain`
accepts the already verified raw text and does not recursively model or encode a semantic object.
Its adversarial semantic-envelope witness is accepted only when the inert raw parse independently
reaches the same terminal item digest and quarantine identity. A stored result cannot validate
itself by presenting a correspondingly altered result hash.

The immediate-stop vectors place malformed, hostile-getter, and hostile-Proxy witnesses in the
next item for first/middle update placement and in a later canonical symbol group for last
placement. Every page inserts that later group first in JSON property order. All 27 vectors run by
direct admission and through the integrated raw-text chain, uninterrupted and after every durable
prefix, with memory and SQLite journals. A separate later-page Proxy proves the chain returns
without reading its fields. The update item is fully descriptor/shape/field validated, the durable
`correction-unsupported` disposition is identical in every run, continuation is cleared, and every
later output, reversible mutation, getter call, and Proxy trap remains exactly zero.

The inert-container vectors place accessors and Proxies at the envelope, symbol-group map, group
array, item, condition array, condition member, continuation, and nested hostile-value boundaries.
A trusted passive Proxy predicate runs before any reflective operation; then every non-Proxy
container is recursively checked through own data descriptors before child reads. Exact getter,
setter, and every Proxy-trap counters remain zero for memory and SQLite-backed replay.

The live chain path calls named guards for the 16-page, 10 MiB/page, 64 MiB aggregate verified-byte,
and 160,000-normalized-fact ceilings. Restart validation recomputes page and aggregate byte use from
persisted raw text before accepting the checkpoint.

The two same-trade-ID fixtures assert the literal typed reason
`market.trade-condition-ineligible` with detail
`tradeConditionFailureKind=state-insufficient`, and assert every prohibited provider-record,
sequence, revision, duplicate-family, or conflict-family inference. The guessed-correction vector
passes through a closed external-claim parser and always rejects as
`unsupported-correction-linkage`; it is not represented by a direct test-side throw.

The public result is a closed count/status object. It cannot contain a symbol, private continuation
token, wire body, URL/query, header, credential-shaped value, quote, trade, bar, or price. The test
installs a throwing network witness and observes explicit credential/fallback counters; it then
settles both microtask and event-loop queues and proves no post-return activity.

## 6. Offline command

The focused proof is:

```text
npm run build
node --test --test-reporter=spec dist/test/p1-10-wire-translation-contract.test.js
```

This matrix grants no production implementation, provider request, credential/account inspection,
witness, FMP transport, spend, policy broadening, merge, P1-06, P2, or outcome authority.
