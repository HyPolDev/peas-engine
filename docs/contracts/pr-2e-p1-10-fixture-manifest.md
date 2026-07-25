# PR 2E P1-10 synthetic fixture manifest

Status: contract candidate; recorded/offline only
Authority: accepted PR 2D contracts plus the P1-09 final `GO` for
`36dcf92b465fc5708614718b4312631fb5dbf544`
Fixture root: `fixtures/market-acquisition/v1`

## Purpose and prohibition

This manifest defines the complete PR 2E acquisition-test corpus. It is original project-authored
synthetic material. It contains no provider bytes, provider examples, provider-derived field
layouts, symbols, prices, credentials, account evidence, URLs with query strings, request headers,
or raw pagination material. It is neither a provider fixture nor a transport template.

The fixture package is inert. It may be loaded only by offline tests. It must not read environment
credentials, dispatch a request, inspect an account, or be uploaded as provider evidence.

## Files

| File | Classification | Purpose |
| --- | --- | --- |
| `README.md` | original synthetic documentation | States provenance, exclusions, and safe use |
| `manifest.json` | original synthetic inventory | Names the eight abstract behavior cases |
| `synthetic-pages.json` | original synthetic projection | Five invented color glyphs distributed across three abstract pages |

The abstract page members are intentionally unlike a quote, trade, bar, FMP response, or provider
pagination envelope. Pagination hashes and hostile values are generated in test memory and are not
persisted.

## Corpus cases

| Case | Required result |
| --- | --- |
| `verified-chain` | Ordinal, request-identity, predecessor-hash, terminal, record, and page bounds verify before normalization |
| `identical-redelivery` | Physical bytes may deduplicate while both delivery observations remain conceptually distinct |
| `conflicting-redelivery` | Different bytes asserted for one delivery/revision quarantine the family and prohibit selection |
| `supported-revision` | A byte-different replacement is admitted only with distinct, supported revision evidence |
| `unknown-revision` | Unknown or absent revision semantics are never inferred; the family is quarantined |
| `restart-every-checkpoint` | Verified pages are never re-requested; an uncommitted in-flight page gets a new attempt |
| `page-size-invariance` | Page sizes `1`, `2`, `7`, and `10,000` produce the same canonical projection |
| `memory-sqlite-equivalence` | The same journal rows have byte-identical canonical projections in memory and SQLite |

## In-memory-only vectors

`test/p1-10-contract.test.ts` constructs the following values without persisting them:

- the exact 11 frozen identity preimages and expected IDs;
- exact and one-over values for every project ceiling;
- exact 15-minute history-boundary and one-nanosecond-newer timestamps;
- bounded opaque continuation material represented only by byte length;
- route, method, identity, field, value, clock, cost, and authorization mutations;
- retry status and `Retry-After` variations;
- malformed, truncated, schema-drift, and declared-length failure classifications;
- loop, gap, duplicate, substitution, and page-after-terminal attacks;
- hostile nested errors, causes, accessors, and proxy containers; and
- crash/restart transitions at every durable and non-durable boundary.

None of these vectors is evidence about a provider response. Their sole authority is this accepted
contract package.

## Integrity and provenance gates

The executable test must verify:

1. `manifest.json` declares `original-project-authored-synthetic`, `providerEvidence=false`, and
   `networkAuthorized=false`.
2. The page projection is deterministic and independent of replay page size.
3. No default test can reach `fetch`; a global witness throws on unexpected access.
4. Missing credentials fail after non-secret preflight and before transport.
5. Redaction tests compare only closed safe projections and never retain hostile source text.
6. FMP cannot become primary, fallback, or public evidence.

Any future fixture that contains provider material, provider-derived structure, a secret, raw token,
account fact, or query-bearing URL is outside this manifest and is an immediate `NO_GO`.

## Change control

Any byte change in this document, the acceptance matrix, the fixture root, or
`test/p1-10-contract.test.ts` after independent review invalidates contract `GO` and requires a new
candidate SHA and fresh independent review.
