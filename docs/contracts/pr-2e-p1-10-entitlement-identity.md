# PR 2E P1-10 entitlement, identity, and closed capability contract

- Status: `PROPOSED_CONTRACT_CHECKPOINT`
- Scope: P1-10 historical market-reference acquisition preflight only
- Starting authority base:
  `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a`
- P1-09 accepted candidate:
  `36dcf92b465fc5708614718b4312631fb5dbf544`
- PR 2D merge:
  `ebe959324e48faf73c325a97ed9200bd6c76c9a6`
- Incremental market-data budget: exactly `0`
- Fallback: exactly `none`
- Live/provider execution in PR 2E: `NOT_AUTHORIZED`
- PR 2F implementation while this contract lacks independent exact-SHA `GO`:
  `NO_GO`

This document freezes the entitlement and identity boundary that a later PR 2F implementation must
enforce before credentials are read and before a transport can be invoked. It does not authorize
transport code, a provider request, credential access, account inspection, subscription changes,
provider bytes, or a witness.

The accepted P1-09 final `GO` and closure supersede historical `P1-09 PENDING` prose. That historical
prose remains byte-preserved in the accepted PR 2D documents and does not regain operational
authority here. This contract neither edits nor reinterprets an accepted PR 2D identity or policy.

## 1. Authority and precedence

The operational authority chain is:

1. the human-owner decision in
   `docs/research/p1-09-owner-risk-authorization.md`;
2. the preserved P1-09 independent review and re-audit findings;
3. the exact-candidate `GO` in `docs/audit/p1-09-final-go.md`;
4. ADR 0010 and the accepted PR 2D contract authority registry; and
5. this prospective P1-10 contract, but only after an independent `GO` for its exact candidate SHA.

If a provider, dataset, feed, endpoint, method, origin, path, query field, value, provider role,
publication right, cost decision, identity preimage, or entitlement status cannot be proved from
that chain, it is `NOT_AUTHORIZED`. Absence from an allowlist is a denial, not permission to use a
provider default.

Contract `GO` does not authorize:

- credentials to be read;
- a provider request or witness;
- FMP transport implementation;
- an account, plan, invoice, dashboard, cookie, or credential inspection;
- a subscription, trial, upgrade, display-license, account, or classification change;
- incremental spending;
- provider payloads or provider-derived examples in Git; or
- a change to a frozen PR 2D port, normalization rule, selection rule, source role, or study policy.

## 2. Normative identity derivation

All 11 identities use the accepted functions in
`src/providers/market-reference/identity.ts` and the accepted framing in
`src/core/hash.ts`:

```text
lp(bytes) = uint64be(byteLength(bytes)) || bytes
H(domain, preimage) =
  SHA-256(lp(utf8(domain)) || lp(utf8(RFC8785(preimage))))
```

The literal prefixes and domains are:

| Identity | Prefix | Domain |
| --- | --- | --- |
| provider | `mpv1_` | `peas/market-provider/v1` |
| dataset | `mds1_` | `peas/market-dataset/v1` |
| feed | `mfd1_` | `peas/market-feed/v1` |
| endpoint channel | `mec1_` | `peas/market-endpoint-channel/v1` |

Preimages are exact inert JSON. Missing, extra, inherited, accessor, symbol, sparse, proxy, cyclic,
non-finite, negative-zero, unsafe-integer, malformed, or noncanonical set-like values reject before
hashing. No default is inserted. Endpoint `factKinds` is a nonempty sorted unique array.

The following never enters any provider, dataset, feed, or endpoint-channel preimage:

- an origin, URL, path, query string, query value, or page token;
- a credential, environment-variable value, request header, cookie, account, invoice, or plan
  evidence;
- a symbol, request time, response time, capture time, local path, runtime root, backend, page size,
  page ordinal, or provider bytes; or
- a display name, mutable provider label, provider error, or current configuration value.

The safe route label is an inert versioned label. It is not authority to accept a caller-provided
origin or path. Routes are independently closed in section 4.

## 3. Exact canonical preimages and recomputed identities

### 3.1 Alpaca historical SIP primary lane

```json
{
  "providerId": "mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c",
  "providerPreimage": {
    "providerCode": "alpaca",
    "serviceOperatorCode": "alpaca-markets"
  },
  "datasetId": "mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1",
  "datasetPreimage": {
    "providerId": "mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c",
    "assetClass": "us-equity",
    "coverageRegion": "united-states",
    "productFamily": "historical-stock-market-data",
    "apiGeneration": "v2",
    "recordFamily": "quotes-trades-bars",
    "datasetDocumentationVersion": "official-reference-2026-07-25"
  },
  "feedId": "mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023",
  "feedPreimage": {
    "datasetId": "mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1",
    "providerFeedCode": "sip",
    "consolidationKind": "sip-consolidated",
    "delayClass": "historical",
    "adjustmentMode": "raw",
    "correctionRepresentation": "unknown"
  },
  "endpointChannels": [
    {
      "endpointChannelId": "mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0",
      "preimage": {
        "feedId": "mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023",
        "channelKind": "historical-rest",
        "methodKind": "get",
        "safeRouteLabel": "alpaca-v2-historical-quotes",
        "endpointDocumentationVersion": "official-reference-2026-07-25",
        "paginationKind": "opaque-token",
        "factKinds": [
          "quote"
        ]
      }
    },
    {
      "endpointChannelId": "mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1",
      "preimage": {
        "feedId": "mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023",
        "channelKind": "historical-rest",
        "methodKind": "get",
        "safeRouteLabel": "alpaca-v2-historical-trades",
        "endpointDocumentationVersion": "official-reference-2026-07-25",
        "paginationKind": "opaque-token",
        "factKinds": [
          "trade"
        ]
      }
    },
    {
      "endpointChannelId": "mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c",
      "preimage": {
        "feedId": "mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023",
        "channelKind": "historical-rest",
        "methodKind": "get",
        "safeRouteLabel": "alpaca-v2-historical-bars",
        "endpointDocumentationVersion": "official-reference-2026-07-25",
        "paginationKind": "opaque-token",
        "factKinds": [
          "bar"
        ]
      }
    }
  ]
}
```

### 3.2 Financial Modeling Prep private discrepancy lane

```json
{
  "providerId": "mpv1_526c731d81a453ab057fd6f946e49291d0863350d319a73893d46e34b2a51a7a",
  "providerPreimage": {
    "providerCode": "financial-modeling-prep",
    "serviceOperatorCode": "financial-modeling-prep"
  },
  "datasetId": "mds1_eaaa286ff4841f43275131aca2abb17fad3ab78cbe3af49921a36a3249439f68",
  "datasetPreimage": {
    "providerId": "mpv1_526c731d81a453ab057fd6f946e49291d0863350d319a73893d46e34b2a51a7a",
    "assetClass": "us-equity",
    "coverageRegion": "united-states",
    "productFamily": "premium-market-reference-discrepancy",
    "apiGeneration": "stable",
    "recordFamily": "aftermarket-quote-trade",
    "datasetDocumentationVersion": "official-stable-docs-2026-07-25"
  },
  "feedId": "mfd1_582a672a4109841f0ef80d286021e1e827d4a5f050059e22c87d08c842d0051b",
  "feedPreimage": {
    "datasetId": "mds1_eaaa286ff4841f43275131aca2abb17fad3ab78cbe3af49921a36a3249439f68",
    "providerFeedCode": "exchanges-and-third-party-providers",
    "consolidationKind": "unknown",
    "delayClass": "provider-defined",
    "adjustmentMode": "unknown",
    "correctionRepresentation": "unknown"
  },
  "endpointChannels": [
    {
      "endpointChannelId": "mec1_1e1c2239cce268ea690a82bd3f3ff6148bbd2bb8bb288c57a2e2cdf79cf8f1cd",
      "preimage": {
        "feedId": "mfd1_582a672a4109841f0ef80d286021e1e827d4a5f050059e22c87d08c842d0051b",
        "channelKind": "latest-rest",
        "methodKind": "get",
        "safeRouteLabel": "fmp-stable-aftermarket-quote",
        "endpointDocumentationVersion": "official-stable-docs-2026-07-25",
        "paginationKind": "none-documented",
        "factKinds": [
          "quote"
        ]
      }
    },
    {
      "endpointChannelId": "mec1_feb9f3a3deab6dbabd6fcc204c8ced63d88a2ca14d8f235b1fec2dab49df6bdf",
      "preimage": {
        "feedId": "mfd1_582a672a4109841f0ef80d286021e1e827d4a5f050059e22c87d08c842d0051b",
        "channelKind": "latest-rest",
        "methodKind": "get",
        "safeRouteLabel": "fmp-stable-aftermarket-trade",
        "endpointDocumentationVersion": "official-stable-docs-2026-07-25",
        "paginationKind": "none-documented",
        "factKinds": [
          "trade"
        ]
      }
    }
  ]
}
```

### 3.3 Independent recomputation evidence

The integrator independently reproduced the repository's RFC 8785 key ordering and exact
`uint64be-length || bytes` framing in Node.js, using the accepted literal prefixes, domains, and
preimages above. The output matched all 11 P1-09 values:

| Family | Count | Result |
| --- | ---: | --- |
| `mpv1_` | 2 | exact match |
| `mds1_` | 2 | exact match |
| `mfd1_` | 2 | exact match |
| `mec1_` | 5 | exact match |
| Total | 11 | exact match |

The recomputation used `node` and `node:crypto` only; it made no network call and read no
credential or provider byte. The repository build import could not be executed during this isolated
draft because dependencies had not yet been installed (`tsc` was absent). Therefore the integrated
contract candidate must additionally execute the repository derivation functions directly in
`test/p1-10-contract.test.ts` and compare all 11 literal values before review. An independent
auditor must repeat the computation at the exact candidate SHA.

## 4. Closed transport identity and route registry

The route registry is compile-time contract data. Runtime configuration cannot supply or override
an origin, scheme, port, base URL, path, method, safe route label, or endpoint-channel identity.
Redirects are not an alternate route and must not be followed.

### 4.1 Alpaca routes

| Channel | Method | Exact origin | Exact path |
| --- | --- | --- | --- |
| quotes `mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0` | `GET` | `https://data.alpaca.markets` | `/v2/stocks/quotes` |
| trades `mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1` | `GET` | `https://data.alpaca.markets` | `/v2/stocks/trades` |
| bars `mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c` | `GET` | `https://data.alpaca.markets` | `/v2/stocks/bars` |

These are the multi-symbol routes and must be used even for one instrument. The single-symbol route
variants are not authorized.

The closed non-secret field allowlist is:

| Field | Quotes | Trades | Bars | Exact rule |
| --- | --- | --- | --- | --- |
| `symbols` | required | required | required | Sorted unique effective frozen aliases for the requested instruments, encoded once; 1 through 64 instruments. |
| `start` | required | required | required | Explicit canonical UTC instant; bounded; no default. |
| `end` | required | required | required | Explicit canonical UTC instant; bounded; no default; trusted 15-minute rule applies. |
| `limit` | required | required | required | Canonical decimal integer from `1` through `10000`; no provider default. |
| `page_token` | conditional | conditional | conditional | Absent on the first request; thereafter byte-identical opaque material returned by the immediately preceding verified page, at most 4,096 bytes. |
| `feed` | required | required | required | Exactly `sip`. |
| `sort` | required | required | required | Exactly `asc`. |
| `timeframe` | forbidden | forbidden | required | Exactly `1Min`. |
| `adjustment` | forbidden | forbidden | required | Exactly `raw`. |

Every key appears at most once. Unknown, duplicate, empty, differently cased, encoded-alias, or
unlisted fields reject. Query construction occurs only after the typed request object passes the
closed validator. A caller-supplied query string is never accepted.

`symbols` is not a free-form comma-separated caller value. Each member must resolve to the exact
effective symbol alias of one frozen instrument identity for the whole requested interval. The
encoder sorts unique aliases by unsigned UTF-8 bytes and joins them once. A blank member, duplicate,
unmapped symbol, ambiguous effective interval, delimiter injection, or more than 64 instruments
rejects before credential loading.

`start` and `end` are exact UTC epoch-nanosecond values in the trusted request identity. Any HTTP
text representation is a deterministic canonical UTC encoding of those exact values and must
round-trip without loss. Offset local time, absent offset, date-only input, excess precision,
rounding, truncation, overflow, or a different round-trip value rejects. `start` must not be later
than `end`; both are explicit and the inclusive set of touched UTC calendar dates is at most eight
consecutive dates.

The authorization boundary is:

```text
endNs <= trustedRequestStartedAtNs - 900000000000
```

Equality is authorized. One nanosecond newer is rejected. The check uses the trusted
`request.started` wall stamp only. Response, completion, replay, local file, rounded-minute, or
database-current time is forbidden. An absent or unprovable clock basis, excessive maximum error,
wall regression, or same-session monotonic regression rejects before credentials are read and
before dispatch.

The only future Alpaca authentication boundary is:

- runtime environment name `PEAS_ALPACA_API_KEY_ID` to emitted header
  `APCA-API-KEY-ID`; and
- runtime environment name `PEAS_ALPACA_API_SECRET_KEY` to emitted header
  `APCA-API-SECRET-KEY`.

Credentials are never accepted through configuration objects, command-line query values, URLs,
identity preimages, fixtures, or repository files. This section names boundaries only; PR 2E loads
neither variable.

### 4.2 FMP routes

| Channel | Method | Exact origin | Exact path |
| --- | --- | --- | --- |
| aftermarket quote `mec1_1e1c2239cce268ea690a82bd3f3ff6148bbd2bb8bb288c57a2e2cdf79cf8f1cd` | `GET` | `https://financialmodelingprep.com` | `/stable/aftermarket-quote` |
| aftermarket trade `mec1_feb9f3a3deab6dbabd6fcc204c8ced63d88a2ca14d8f235b1fec2dab49df6bdf` | `GET` | `https://financialmodelingprep.com` | `/stable/aftermarket-trade` |

The only allowed non-secret query field is `symbol`, appearing exactly once and containing exactly
one effective frozen symbol alias. No other non-secret query field is accepted. Authentication is
reserved to runtime environment name `PEAS_FMP_API_KEY` and emitted header name exactly `apikey`.
It is never a URL or query value.

This closed registry is required for synthetic contract rejection tests. It does not authorize or
implement an FMP client. FMP production transport is excluded from the first PR 2F implementation
wave. Any attempt to dispatch FMP in that wave must fail as
`market.entitlement-invalid/{entitlementFailureKind:"scope-mismatch"}` with zero credential reads
and zero transport calls. A later FMP implementation requires renewed human scope approval,
active-subscription attestation, and separate review.

## 5. Closed entitlement and source roles

The accepted source policy is:

```text
authorizationMode = "p1-09-approved"
primarySource = exact Alpaca provider/dataset/feed/channel tuple
comparisonSources = exact FMP tuples only when separately enabled in a later authorized change
fallbackKind = "none"
selectionIsolation = "per-source"
missingPrimaryBehavior = "typed-missing-no-fallback"
```

Alpaca historical SIP is the sole primary lane. FMP is private discrepancy evidence only. FMP is
never primary, fallback, SIP-equivalent, or NBBO-equivalent; it cannot change an Alpaca selection.
FMP evidence is excluded from every public output.

The exact source keys are:

| Role | Provider ID | Dataset ID | Feed ID | Permitted endpoint-channel IDs |
| --- | --- | --- | --- | --- |
| primary | `mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c` | `mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1` | `mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023` | `mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0`, `mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1`, `mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c` |
| private discrepancy only | `mpv1_526c731d81a453ab057fd6f946e49291d0863350d319a73893d46e34b2a51a7a` | `mds1_eaaa286ff4841f43275131aca2abb17fad3ab78cbe3af49921a36a3249439f68` | `mfd1_582a672a4109841f0ef80d286021e1e827d4a5f050059e22c87d08c842d0051b` | `mec1_1e1c2239cce268ea690a82bd3f3ff6148bbd2bb8bb288c57a2e2cdf79cf8f1cd`, `mec1_feb9f3a3deab6dbabd6fcc204c8ced63d88a2ca14d8f235b1fec2dab49df6bdf` |

| Provider capability | Frozen disposition |
| --- | --- |
| Alpaca exact quotes/trades/bars acquire | `OWNER_APPROVED_WITH_RESIDUAL_RISK` |
| Alpaca private retain, offline replay, automated research, retain derived | `OWNER_APPROVED_WITH_RESIDUAL_RISK` |
| Alpaca publish non-reconstructable aggregates | `OWNER_APPROVED_WITH_RESIDUAL_RISK`, subject to the P1-09 restrictions |
| Alpaca redistribute raw/provider bytes | `NOT_AUTHORIZED` |
| FMP exact aftermarket quote/trade acquire, private retain, automated research, retain derived | `OWNER_APPROVED_WITH_RESIDUAL_RISK`, but transport implementation is separately gated |
| FMP exact aftermarket quote/trade offline replay | `GRANTED` |
| FMP publish aggregate/display or redistribute raw | `NOT_AUTHORIZED` |
| FMP as primary, replacement, fallback, SIP, or NBBO | `NOT_AUTHORIZED` |
| Any provider account/entitlement mutation or incremental spend | `NOT_AUTHORIZED` |

The accepted retention maxima are 3,650 days for each lane, with the different P1-09 termination
rules preserved. Retention architecture and authorization are owned by the separate credential,
privacy, and retention contract. An entitlement parser must nevertheless reject a longer or absent
maximum, an FMP entitlement that survives termination, or an Alpaca stop-trigger rule that omits
the 30-calendar-day-or-earlier deadline. This document does not authorize a vault or migration
change.

## 6. Explicitly unlisted and prohibited capabilities

The following are `NOT_AUTHORIZED`, and the list is illustrative rather than a substitute for the
closed allowlists:

- arbitrary URLs, origins, ports, paths, redirects, methods, SDK-selected endpoints, or query
  fields;
- Alpaca latest endpoints, snapshots, single-symbol routes, WebSockets, `delayed_sip`, real-time
  SIP, IEX, BOATS, overnight, OTC, news, corporate actions, calendar, account, subscription,
  entitlement-management, brokerage, order, position, or portfolio routes;
- any Alpaca feed other than explicit historical `sip`;
- any Alpaca bar timeframe other than `1Min` or adjustment other than `raw`;
- FMP Stock Quote, Stock Quote Short, Stock Price Change, batch, chart, one-minute,
  historical-chart, or any other endpoint;
- FMP API keys in a query or URL;
- provider or feed fallback, including retrying a failed Alpaca request against FMP;
- a trial, upgrade, paid feed, Ultimate plan, display license, account change, or paid-use method;
- provider bytes, raw tokens, credential-shaped values, provider payload examples, or
  provider-derived public results in repository content; and
- P2 collection, event-study outcomes, or changes to PR 2D normalization and selection.

Every absent capability is prohibited even if a provider documents it, an account may include it,
an SDK exposes it, or it has no incremental per-call charge.

## 7. Zero-spend configuration proof

The sanitized zero-spend policy identity is:

```text
mzp1_b2f575e234dcd7f05eb5fcc03060420313b56e45aff87c961c3771d1c5cf3b9e
```

It is derived as:

```text
zeroSpendPolicyId =
  "mzp1_" + H("peas/market-zero-spend-policy/v1", zeroSpendPolicyPreimage)
```

from this exact inert preimage:

```json
{
  "schemaVersion": 1,
  "policyVersion": "p1-10-zero-spend-policy-v1",
  "p109AuthorityCandidate": "36dcf92b465fc5708614718b4312631fb5dbf544",
  "maximumIncrementalSpend": "0",
  "existingEntitlementsOnly": true,
  "accountInspection": "forbidden",
  "accountMutation": "forbidden",
  "subscriptionMutation": "forbidden",
  "unknownCostBehavior": "reject-before-credential-read",
  "fallbackKind": "none"
}
```

`maximumIncrementalSpend` is the exact unit-independent zero. It cannot be changed through runtime
configuration. The policy identity is sanitized: it contains no provider plan, account, invoice,
correspondence, person, credential, payment, price, currency, or provider response. A run decision
records this policy ID and an allow/reject result, never account detail. The integrated executable
contract suite and independent auditor must recompute this policy identity in addition to the 11
frozen source identities.

Paid use is structurally unreachable only if all of the following hold:

1. the origin, path, method, feed, timeframe, adjustment, role, and channel identity are compiled
   from this closed registry rather than read from runtime configuration;
2. `authorizationMode` is exactly `p1-09-approved`;
3. `zeroIncrementalSpend` is exactly `true`;
4. the sanitized zero-spend policy identity and run-scoped decision are present and validate;
5. the cost status is positively proved `zero-incremental-spend-approved`; absent, unknown,
   stale, caller-asserted, or provider-derived-at-runtime status rejects;
6. live acquisition defaults to disabled and requires an explicit run-scoped enable decision in
   PR 2F;
7. no method exists for subscription, trial, upgrade, paid-feed, display-license, account, or
   entitlement mutation;
8. project request quotas are enforced below provider ceilings and cannot be raised through
   caller configuration; and
9. every unauthorized capability terminates before credential loading, ArtifactStore mutation,
   DNS, socket creation, fetch, HTTP, SDK, browser, or provider access.

No agent may prove cost status by inspecting an account, plan page, invoice, dashboard,
correspondence, credential, cookie, or provider response. The human-owned P1-09 sanitized
attestation and a bounded run-scoped policy decision are the only authority inputs. A configuration
flag cannot upgrade a denied or unlisted capability.

The configuration schema is closed. It contains only inert identity references, exact bounded
request values, run-scoped enable and policy references, and the fixed zero-spend decision. It has
no `baseUrl`, `origin`, `path`, `url`, `endpoint`, arbitrary header map, credential value,
credential-file path, provider options bag, paid-plan flag, fallback flag, or unknown extension
map.

## 8. Fail-closed parsing and typed zero-call rejection

Configuration parsing must snapshot exact inert data before validation and must not invoke getters,
proxies, coercion hooks, stringifiers, iterators, error accessors, or environment reads. It validates
in this order:

1. exact closed shape, primitive types, nullability, and bounds;
2. accepted contract and authorization-mode identities;
3. all 11 provider/source identities by recomputation where applicable;
4. source role, fallback `none`, zero-spend policy, and enabled-lane scope;
5. exact route/channel/method/origin/path registry membership;
6. exact query field membership and values;
7. instrument, interval, page, and aggregate bounds;
8. trusted request-start clock and the 15-minute boundary;
9. quota and cost proof;
10. only then, in a later authorized runtime, credential availability; and
11. only after every preceding gate passes, construction of a transport request.

Failure at a higher step prevents every lower step. In particular, no non-secret failure may be
deferred until credentials have been read.

The rejection mapping is closed:

| Failure | Exact canonical reason |
| --- | --- |
| malformed, missing, extra, accessor, proxy, sparse, cyclic, unsafe, or unknown configuration value | `market.input-invalid`, `detail:null` |
| forged or non-recomputing provider/dataset/feed/channel/contract/policy identity | `market.identity-invalid`, `detail:null` |
| unlisted origin, path, method, route, redirect, endpoint family, query field, timeframe, or capability surface | `market.source-contract-invalid`, `detail:{sourceFailureKind:"endpoint-unknown"}` |
| provider/dataset/feed/channel tuple mismatch, omitted/default/wrong feed, or wrong adjustment identity | `market.dataset-feed-mismatch`, `detail:null` |
| pending, denied, expired, disabled FMP transport, wrong role, publication violation, or other authorization scope mismatch | `market.entitlement-invalid`, with exact applicable `entitlementFailureKind` |
| absent, false, unknown, stale, or violated zero-spend decision | `market.entitlement-invalid`, `detail:{entitlementFailureKind:"zero-spend-violation"}` |
| any provider, feed, fact-kind, or role fallback | `market.silent-fallback-forbidden`, `detail:null` |
| first-request token, repeated token, cross-query token, substituted token, or other chain defect | `market.page-chain-invalid`, `detail:null` |
| a named resource ceiling exceeded | `market.bound-exceeded`, with its exact direct-key `limitKind` |
| unavailable/unprovable/regressing request clock | `market.clock-basis-invalid`, `detail:null` |
| missing runtime credential after all non-secret gates pass | a closed P1-10 safe error at stage `credential-load`; no provider or PR 2D semantic result is emitted |

An `entitlementFailureKind` is exactly one of `unfrozen`, `pending`, `denied`, `scope-mismatch`, or
`zero-spend-violation`, as defined by the accepted PR 2D reason catalog. There is no free-form
provider text, URL, symbol, query, credential, account fact, or payload in a reason.

Every rejected result must prove:

```text
credentialReadCount = 0
transportConstructionCount = 0
dnsCallCount = 0
networkCallCount = 0
providerCallCount = 0
artifactStoreMutationCount = 0
normalizedFactCount = 0
selectionCount = 0
postReturnActivityCount = 0
```

The sole exception is missing credentials: all non-secret preflight has passed, so its
`credentialReadCount` may reflect bounded reads of the approved environment names; every transport,
provider, artifact, normalization, selection, and post-return count remains zero. Missing
credentials must never skip the test; it is a required typed pre-dispatch outcome.

Errors use only a closed reason, operation stage, and a non-secret detail hash under the separate
credential/privacy contract. They never echo rejected input.

## 9. Request identity separation

Provider/dataset/feed/channel identities answer which frozen source semantics are requested.
The logical request identity answers which bounded acquisition is requested. They are separate.

The later request identity may bind:

- the exact provider, dataset, feed, and endpoint-channel IDs;
- exact frozen instrument IDs rather than a raw symbol string;
- exact requested fact kind;
- exact start and end epoch nanoseconds;
- `sort=asc`, the exact route-policy version, and `authorizationMode=p1-09-approved`.

It must not bind:

- credentials or headers;
- a full URL, query string, caller-supplied origin/path, or raw page token;
- page size, page ordinal, transport attempt, retry delay, response order, response time, local
  path, backend, or provider bytes; or
- mutable account or plan evidence.

A continuation page retains the same logical request identity. Its private token hash is page-chain
evidence bound to the preceding verified page; the raw token is not logged, published, or included
in a public identity.

## 10. Required executable contract evidence

The integrated PR 2E test and synthetic fixture package must:

- derive all 11 literal IDs from the exact preimages using the accepted repository functions;
- reject a one-field mutation, missing field, extra field, reordered set-like array, forged ID,
  URL/path insertion, header/credential insertion, and provider-default substitution for every
  identity family;
- test every exact route and every unlisted origin, method, path, channel, feed, field, timeframe,
  adjustment, sort, capability, and redirect with zero calls;
- test the full field matrix for quotes, trades, bars, and both FMP routes;
- test explicit `feed=sip`, `sort=asc`, `1Min`, and `raw`, including omitted/default/wrong values;
- test first-page token rejection and valid preceding-page token binding without logging raw token
  material;
- test zero-spend true, false, absent, unknown, stale, and attempted account/plan mutation;
- test FMP attempting to become primary or fallback and any FMP public-output attempt;
- test live-disabled default, absent credentials, hostile credential-shaped input, and blocked
  network;
- test the 15-minute boundary at equality and one nanosecond newer before credential reads;
- prove every rejection counter in section 8 and no asynchronous activity after return; and
- scan repository/evidence output for credentials, raw tokens, query-bearing URLs, provider
  bodies, provider bytes, account material, and provider-derived FMP output.

All fixtures must be original and synthetic. The tests may use deterministic provider doubles only.
No test may require a credential or make DNS, HTTP, HTTPS, WebSocket, SDK, browser, or provider
access.

## 11. Gate disposition

This contract is not accepted merely because it exists. Before PR 2F:

1. the complete PR 2E package must pass its full offline validation matrix;
2. the integration owner must freeze an exact clean candidate SHA;
3. a fresh independent auditor must repeat all 11 identity derivations and return binary `GO` for
   that exact SHA;
4. the orchestration owner must acknowledge the checkpoint;
5. the audit must state whether retention implementation is authorized; and
6. any necessary retention port, migration, reconciliation, or vault-semantic change must receive
   separate human authorization.

Any contract, fixture, or contract-test change after review invalidates `GO`. Contract `GO` alone
does not authorize a provider witness or merge. FMP transport remains excluded from the first PR 2F
wave. Until all gates above are satisfied, implementation is `NO_GO`, P1-10 remains in progress,
P1-06 remains blocked, and P2 remains blocked.
