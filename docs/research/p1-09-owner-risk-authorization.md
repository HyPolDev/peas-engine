# P1-09 human-owner authorization and residual-risk acceptance

## Document control

- Decision date: `2026-07-24`
- Gate: `P1-09`
- Decision: `OWNER_APPROVED_WITH_RESIDUAL_RISK`
- Owner: `HyPolDev`
- Project classification: personal, individual, noncommercial research
- Incremental market-data budget: `0`
- Private correspondence evidence SHA-256:
  `0f197aa11318330a7618841d6f3cd106d963d6c768508feed1080aae39ae0c85`
- Private correspondence: retained outside the repository under human control
- Independent review: `PENDING`
- P1-10 live acquisition: `BLOCKED_PENDING_INDEPENDENT_GO`
- P2 collection: `BLOCKED`

This is a human-owned engineering authorization and risk-acceptance decision, not a representation
that a provider affirmatively granted every capability and not legal advice. It records how PEAS
must interpret the supplied provider responses and published policies without repeatedly reopening
the same decision in later agent sessions.

## Human attestation

The human owner attests that:

- the project is personal, individual, noncommercial, has no company, client, employer, or
  organizational use, and currently generates no revenue;
- the human owner is the only user;
- the existing FMP subscription is individual FMP Premium;
- no trial, upgrade, subscription change, display license, professional classification, or
  additional paid service was requested or activated;
- public repository content will contain only project-authored synthetic fixtures;
- credentials, account information, and raw provider responses will remain private; and
- the human owner supplied Alpaca and FMP support correspondence addressing the proposed use.

The repository stores only the evidence digest above. Names, email addresses, ticket identifiers,
account data, and correspondence text remain private.

## Interpretation rule

The human owner has reviewed the provider correspondence and applicable published policies and
accepts responsibility for their interpretation for this project.

A provider statement that no additional restriction is documented is not relabeled as an
affirmative provider grant. Where the proposed use is not prohibited by the supplied response or
applicable policy, the human owner accepts the remaining uncertainty as
`OWNER_APPROVED_WITH_RESIDUAL_RISK`.

Future agents and reviewers must use this record as the authoritative human decision. They must not
reopen the decision merely because a provider response was incomplete. They must stop and return to
P1-09 only if:

1. implementation would exceed the boundaries below;
2. new provider evidence contradicts this decision;
3. spending, a trial, an upgrade, or an account/classification change would be required;
4. the provider, dataset, feed, endpoint family, or scientific source identity changes;
5. raw, reconstructable, or otherwise prohibited data would be published; or
6. project use ceases to be personal, individual, and noncommercial.

## Frozen source decision

### Primary source

- Provider/product: Alpaca individual Basic Trading API account.
- Dataset/feed: historical US-equity SIP selected explicitly with REST `feed=sip`.
- Temporal access boundary: every request end time must be at least 15 minutes before request time.
- Eligible facts: historical SIP quotes, trades, and bars from only the exact endpoint allowlist
  below.
- Primary scientific use: ADR 0010 durable-capture market-reference evidence.
- Retention and replay: private durable retention, repeated offline replay, locally controlled
  automated processing, and retention of normalized private facts are owner-approved with residual
  risk.
- Retention duration: raw artifacts, normalized facts, and private derived datasets have a maximum
  retention of `3650` days from capture. If the Alpaca account closes, delete affected raw
  artifacts and cease affected normalized/derived use within `30` calendar days of the effective
  closure date. Owner revocation, contrary provider guidance, or loss of the
  personal/individual/noncommercial classification requires immediate acquisition stop and
  deletion or cessation within `30` calendar days unless the contrary instruction requires an
  earlier deadline.
- Publication: limited to non-reconstructable aggregate research outputs that contain no raw,
  row-level, reconstructable, credential, or account material.

Alpaca `v2/delayed_sip` WebSocket, latest-endpoint `feed=delayed_sip`, paid Alpaca feeds, Algo Trader
Plus, BOATS, overnight feeds, and any other feed are not authorized by this decision. Adding one
requires a new prospective entitlement snapshot and review.

### Secondary discrepancy source

- Provider/product: existing individual FMP Premium subscription.
- Role: private, separately identified lower-evidence discrepancy source only.
- Included surfaces reported by support: Stock Quote, Stock Quote Short, Aftermarket Trade,
  Aftermarket Quote, Stock Price Change, and Batch Quote endpoints.
- Approved PEAS surfaces: only the exact Aftermarket Quote and Aftermarket Trade endpoint allowlist
  below. The other reported Premium surfaces are not authorized by this snapshot.
- One-minute intraday charting: `NOT_AUTHORIZED`; support states that it requires Ultimate.
- Offline replay: provider-confirmed as allowed.
- Private storage, normalized private facts, and locally controlled processing: owner-approved with
  residual risk while the active subscription and this personal/noncommercial classification
  remain unchanged.
- Retention duration: raw artifacts, normalized facts, and private derived datasets have a maximum
  retention of `3650` days from capture and only while the existing Premium subscription remains
  active. Delete affected raw artifacts and cease affected normalized/derived use no later than the
  effective subscription-termination time unless later written provider evidence affirmatively
  authorizes a different prospective rule.
- Public display or publication of FMP data or FMP-derived outputs: `NOT_AUTHORIZED` without a
  separate Data Display and Licensing Agreement.
- Post-termination raw retention and derived use: `NOT_AUTHORIZED` under the public default unless
  later written provider evidence affirmatively overrides it.

FMP is not SIP-equivalent, not an NBBO source, not a replacement for missing Alpaca evidence, and
not an approved fallback. Provider-specific FMP results must remain private and may not enter
published charts, tables, or statistics.

## Exact provider/source/endpoint allowlist

The identities below use the accepted PR 2D identity derivations. Documentation version
`2026-07-25` means the official endpoint reference was verified on that date; it does not claim a
provider schema release identifier.

### Canonical identity preimages

Every identity below was recomputed with the accepted functions in
`src/providers/market-reference/identity.ts`. These are the exact inert JSON preimages; no field is
implicit. URLs are intentionally excluded and appear only in the non-identity route tables.

```json
{
  "alpaca": {
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
          "factKinds": ["quote"]
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
          "factKinds": ["trade"]
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
          "factKinds": ["bar"]
        }
      }
    ]
  },
  "financialModelingPrep": {
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
          "factKinds": ["quote"]
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
          "factKinds": ["trade"]
        }
      }
    ]
  }
}
```

### Alpaca primary lane

- `providerId`:
  `mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c`
- Product: individual Basic Trading API
- `datasetId`:
  `mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1`
- Dataset preimage: US equity; United States; historical stock market data; API `v2`;
  quote/trade/bar record family; official reference verified `2026-07-25`
- `feedId`:
  `mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023`
- Feed preimage: explicit provider feed code `sip`; SIP consolidated; historical; raw adjustment;
  correction representation `unknown`

| `endpointChannelId` | Method and exact route | Channel/version/pagination | Fact | Capability disposition |
| --- | --- | --- | --- | --- |
| `mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0` | `GET https://data.alpaca.markets/v2/stocks/quotes` | `historical-rest`; official reference verified `2026-07-25`; opaque `next_page_token` | `quote` | Acquire, private-retain, offline-replay, automated-research, retain-derived, and non-reconstructable publish-aggregate are owner-approved with residual risk; redistribute-raw is not authorized |
| `mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1` | `GET https://data.alpaca.markets/v2/stocks/trades` | `historical-rest`; official reference verified `2026-07-25`; opaque `next_page_token` | `trade` | Same Alpaca disposition |
| `mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c` | `GET https://data.alpaca.markets/v2/stocks/bars` | `historical-rest`; official reference verified `2026-07-25`; opaque `next_page_token` | `bar` | Same Alpaca disposition; request adjustment must be `raw` |

Every Alpaca request must include explicit `feed=sip`, explicit `start` and `end`, ascending order,
and a bounded page limit. `end` must be no later than the runtime's trusted request time minus
exactly 15 minutes. P1-10 must reject omitted/default feed selection and any route or endpoint
channel not listed above. Latest, snapshot, single-symbol, WebSocket, corporate-action, news,
calendar, BOATS, overnight, IEX, OTC, and paid SIP endpoint channels are not authorized by this
snapshot.

Official references:

- [Alpaca historical quotes](https://docs.alpaca.markets/us/reference/stockquotes-1)
- [Alpaca historical trades](https://docs.alpaca.markets/us/v1.1/reference/stocktrades-1)
- [Alpaca historical bars](https://docs.alpaca.markets/us/v1.4.2/reference/stockbars)

### FMP private discrepancy lane

- `providerId`:
  `mpv1_526c731d81a453ab057fd6f946e49291d0863350d319a73893d46e34b2a51a7a`
- Product: existing individual Premium
- `datasetId`:
  `mds1_eaaa286ff4841f43275131aca2abb17fad3ab78cbe3af49921a36a3249439f68`
- Dataset preimage: US equity; United States; Premium market-reference discrepancy; API `stable`;
  aftermarket quote/trade record family; official stable docs verified `2026-07-25`
- `feedId`:
  `mfd1_582a672a4109841f0ef80d286021e1e827d4a5f050059e22c87d08c842d0051b`
- Feed preimage: provider-described exchanges and third-party providers; consolidation `unknown`;
  delay provider-defined; adjustment `unknown`; correction representation `unknown`

| `endpointChannelId` | Method and exact route | Channel/version/pagination | Fact | Capability disposition |
| --- | --- | --- | --- | --- |
| `mec1_1e1c2239cce268ea690a82bd3f3ff6148bbd2bb8bb288c57a2e2cdf79cf8f1cd` | `GET https://financialmodelingprep.com/stable/aftermarket-quote` | `latest-rest`; official stable docs verified `2026-07-25`; none documented | `quote` | Acquire, private-retain, automated-research, and retain-derived are owner-approved with residual risk; offline-replay is provider-granted; publish-aggregate and redistribute-raw are not authorized |
| `mec1_feb9f3a3deab6dbabd6fcc204c8ced63d88a2ca14d8f235b1fec2dab49df6bdf` | `GET https://financialmodelingprep.com/stable/aftermarket-trade` | `latest-rest`; official stable docs verified `2026-07-25`; none documented | `trade` | Same FMP disposition |

The only allowed non-secret query field is the exact frozen instrument symbol. Authentication must
use the `apikey` request header; credentials in URLs or query strings are prohibited. Stock Quote,
Stock Quote Short, Stock Price Change, batch endpoints, chart endpoints, one-minute endpoints, and
every other FMP route are not authorized by this snapshot.

Official references:

- [FMP Aftermarket Quote](https://site.financialmodelingprep.com/developer/docs/stable/aftermarket-quote)
- [FMP Aftermarket Trade](https://site.financialmodelingprep.com/developer/docs/stable/aftermarket-trade)

## Binding controls

- Incremental provider budget is exactly zero.
- No code may activate a subscription, trial, upgrade, paid feed, or display license.
- No silent provider or feed fallback is permitted.
- Provider, dataset, feed, and endpoint identities remain explicit and independently versioned.
- Authentication material may be read only by the future approved runtime boundary and must never
  enter logs, URLs, errors, identities, fixtures, evidence, or repository content.
- Raw provider artifacts remain private and content-addressed.
- Git fixtures remain project-authored and synthetic.
- P1-10 must enforce the Alpaca 15-minute historical boundary before any request.
- FMP evidence may affect only a separately labeled private discrepancy lane.
- Any contrary provider guidance stops affected acquisition and creates a new prospective snapshot;
  it may not retroactively rewrite already frozen evidence.
- P2 remains blocked until P1-10 and P1-06 independently pass their gates.

## Review instruction

The independent P1-09 reviewer must audit:

- faithful transcription of this human decision;
- compatibility with ADR 0010 identities, source isolation, study semantics, and frozen ports;
- exact enforcement of the zero-spend and publication boundaries;
- absence of silent fallback;
- whether the proposed P1-10 design can fail closed on an unauthorized feed or use; and
- whether any supplied provider statement directly contradicts the authorized boundary.

The reviewer must not require additional provider correspondence solely because a provider did not
answer beyond its documented policy. The required output is binary `GO` or `NO_GO` with exact file
and line references. P1-09 closes only after `GO`.

## Owner attestation

Approved by project owner `HyPolDev` through explicit instruction in the PEAS Codex conversation on
`2026-07-24`.

This attribution records the owner's electronic project instruction. It is not a fabricated
handwritten, provider, legal, or cryptographic signature.
