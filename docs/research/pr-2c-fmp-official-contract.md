# PR 2C FMP official-contract research

- Mode: official documentation only; no API call was made
- Fixture policy: synthetic only unless a separate redistribution approval is recorded
- Coverage conclusion: entitlement-dependent and documented with a USA badge; not proven global

## Official evidence

| Topic | Evidence-backed conclusion |
| --- | --- |
| Latest | `GET /stable/news/press-releases-latest?page=0&limit=20` |
| Search | `GET /stable/news/press-releases?symbols=AAPL` |
| Pagination | The latest example proves page zero plus `page` and `limit`; maximums, defaults, ordering, and snapshot consistency are not documented. |
| Authentication | FMP requires an API key and documents `apikey` in a header or query. Credentials are outside every fixture and hash. |
| Representation | FMP describes Market News as REST APIs returning structured/searchable JSON. |
| Freshness/history | FMP describes press releases as real-time and the search surface as current and historical. |
| Streaming | FMP says WebSocket news/press-release streaming is not offered. |
| Coverage | Both stable press-release entries carry a USA flag. Endpoint-specific global issuer, exchange, country, and retention guarantees are not documented. |
| Redistribution | FMP states that display or redistribution requires a Data Display and Licensing Agreement. |

Official sources:

- [Press Releases API](https://site.financialmodelingprep.com/developer/docs/stable/press-releases)
- [Search Press Releases API](https://site.financialmodelingprep.com/developer/docs/stable/search-press-releases)
- [Stable API index and authentication](https://site.financialmodelingprep.com/developer/docs)
- [API quickstart](https://site.financialmodelingprep.com/developer/docs/quickstart)
- [Market News dataset](https://site.financialmodelingprep.com/datasets/market-news)
- [Cycle times](https://site.financialmodelingprep.com/developer/docs/cycle-times)
- [Pricing and redistribution notice](https://site.financialmodelingprep.com/developer/docs/pricing/)
- [FAQ/contact](https://site.financialmodelingprep.com/contact)

## Documentation gaps

The public stable pages do not expose a complete indexable response schema. Exact fields and
nullability, error envelopes, page/limit types and maximums, pagination consistency, timestamp
field/format/timezone, provider record/revision identifiers, correction linkage, symbol-list
cardinality, retention, endpoint-specific coverage, and entitlement depth are not documented
guarantees. A historical example using `symbol`, `date`, `title`, and `text` is not treated as the
current stable schema.

PR 2C therefore pins `fmp-press-release-recorded-v1` as a PEAS synthetic fixture dialect, not as a
claim about all live FMP responses. A future live adapter must validate that dialect against
complete official documentation or an entitlement-authorized sample and separately confirm the
license.
