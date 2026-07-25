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
- strict timestamp round-trip vectors for valid leap instants, impossible dates, invalid leap days,
  overflow, and normalized-but-different instants;
- original-synthetic frozen uppercase alias-authority rows with complete issuer-mapping,
  market-instrument, and symbol-alias preimages, displayed `imap1_`/`min1_`/`msa1_`, accepted-domain
  and independent framed-hash recomputation, inclusive/exclusive effective intervals, and typed
  memberships covering exact 64/65 bounds, blank, duplicate, unmapped, wrong-instrument,
  delimiter-injected, reordered, query/membership mismatch, interval gap, and true overlapping
  effective-version ambiguity;
- original synthetic opaque continuation material held only in memory, including exact 4,096/4,097
  byte bounds and missing, empty, repeated, cross-query, substituted, post-terminal, next-ordinal,
  and every preceding durable binding-member mutation, self-consistently rehashed and executed
  through standalone, uninterrupted, and restart pre-dispatch admission;
- route, method, identity, field, value, clock, cost, and authorization mutations;
- exact zero-spend preimage/ID and missing, forged, mutated, stale, and unknown run decisions;
- all 11 frozen provider, dataset, feed, and channel preimages under one guarded parser, covering
  one-field mutation, missing/extra fields, changed membership of the real channel `factKinds`
  member, a controlled valid multi-member channel set in canonical and reversed order, forged IDs,
  URL/path and header/credential insertion, and provider-default substitution;
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
2. The page projection is deterministic and independent of request/replay page limits `1`, `2`,
   `7`, and `10,000`; those values pass canonical preflight while coercive and out-of-range values
   fail.
3. No default test can reach `fetch`; a global witness throws on unexpected access.
4. Missing credentials fail after non-secret preflight and before transport.
5. Redaction tests compare only closed safe projections and never retain hostile source text.
6. FMP cannot become primary, fallback, or public evidence.
7. A production-free acquisition model drives causal journal transitions, provider-body and
   store/read failures, actual cleanup, complete checkpoints, crash recovery, and memory/SQLite
   close/reopen equivalence.
8. SQLite is closed and reopened from every durable checkpoint prefix using fresh reconstructed
   provider/artifact doubles; every committed artifact is reverified before normalization,
   selection, or terminal return.
9. The complete acquisition-state and checkpoint-kind Cartesian products reject every unlisted
   transition, while every listed transition remains executable.
10. Independent immutable attempt, artifact, admitted-page, and normalization receipt sidecars
    defeat coherently rehashed cached-total forgeries.
11. A synthetic three-delivery/two-physical-digest enumeration preserves delivery observations,
    deduplicates only physical content, and has one canonical page chain and cumulative projection
    in forward or reverse backend enumeration order.
12. The production-free coordinator executes a three-page continuation chain, with two
    byte-identical redeliveries retaining distinct immutable observations, through the same
    state-owning event API, journals, restart, normalization, and selection path.
13. SQLite query enumeration actually runs with ascending/descending order and page limits `1`,
    `2`, `7`, and `10,000`; durable observation receipts are restored independently in both
    directions rather than from hard-coded bytes.

Any future fixture that contains provider material, provider-derived structure, a secret, raw token,
account fact, or query-bearing URL is outside this manifest and is an immediate `NO_GO`.

## Change control

Any byte change in this document, the acceptance matrix, the fixture root, or
`test/p1-10-contract.test.ts` after independent review invalidates contract `GO` and requires a new
candidate SHA and fresh independent review.
