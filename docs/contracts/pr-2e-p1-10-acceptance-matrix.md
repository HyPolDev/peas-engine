# PR 2E P1-10 acquisition acceptance and fault-injection matrix

Status: contract candidate; no implementation authorization
Executable owner: `test/p1-10-contract.test.ts`
Fixture authority: `docs/contracts/pr-2e-p1-10-fixture-manifest.md`

## Result vocabulary

- **accept**: the exact authorized value advances to the next gate.
- **reject-zero-call**: a typed pre-dispatch failure occurs before credential loading and transport.
- **terminal**: the acquisition stops with no retry.
- **retry-same-page**: the same logical page identity receives a new attempt identity after complete
  partial-byte cleanup.
- **quarantine**: no affected normalization or primary selection is emitted.
- **resume**: restart verifies committed artifacts and continues only at the next valid page.

All default execution is offline. The matrix supplies deterministic doubles only. The global
network witness throws if any code reaches `fetch`, and missing credentials remain an asserted
zero-call path rather than a skipped test.

## Frozen identity and lane vectors

| Vector | Expected |
| --- | --- |
| Recompute Alpaca provider, dataset, feed, quotes channel, trades channel, bars channel | Exact equality with the six frozen IDs |
| Recompute FMP provider, dataset, feed, aftermarket-quote channel, aftermarket-trade channel | Exact equality with the five frozen IDs |
| Any changed preimage member or endpoint-channel identity | `reject-zero-call` |
| Live acquisition default/flag absent or false | `reject-zero-call` |
| `authorizationMode=p1-09-approved`, zero-spend decision true, capability `historical-market-reference`, fallback `none` | accept |
| Wrong authorization mode, unknown capability, account/subscription mutation, nonzero/unknown spend, or any fallback | `reject-zero-call` |
| Alpaca historical multi-symbol quotes/trades/bars GET route with exact channel | accept |
| Unauthorized origin, method, path, single-symbol route, latest, snapshot, stream, or capability | `reject-zero-call` |
| Omitted/default, empty, or non-`sip` feed | `reject-zero-call` |
| Missing or noncanonical `start`/`end`; unbounded range | `reject-zero-call` |
| `sort=asc`; bounded `limit=10000` | accept |
| Other sort, limit, or query field | `reject-zero-call` |
| Bars `timeframe=1Min` and `adjustment=raw` | accept |
| Other/omitted timeframe or adjustment | `reject-zero-call` |
| First request without continuation material | accept |
| First request with continuation material | `reject-zero-call` |
| Later request with preceding-page-bound opaque continuation | accept |
| Later request with missing, empty, excessive, or cross-query continuation | `reject-zero-call` |
| FMP private discrepancy role with exact quote/trade channel | contract-valid but transport disabled |
| FMP as primary, fallback, public output, or any other endpoint | `reject-zero-call` |

## Trusted request-time and clock vectors

The tested authorization predicate is:

`end <= conservativeTrustedRequestStartedAt - 900000000000ns`.

`conservativeTrustedRequestStartedAt` subtracts the declared maximum clock error. The source is the
trusted `request.started` stamp, never response, completion, replay, local-file, rounded, or database
time.

| Vector | Expected |
| --- | --- |
| End exactly at the conservative 15-minute boundary | accept |
| End one nanosecond newer | `reject-zero-call` |
| End before boundary | accept |
| Wall basis unavailable or maximum error invalid/unprovable | `reject-zero-call` |
| Same-session monotonic order equal or regressing before dispatch | `reject-zero-call` |
| Wall or monotonic regression while response is active | destroy/settle body and siblings; terminal clock failure; no commit/normalization/selection |

## Exact-limit and one-over register

The lesser of an approved entitlement limit and the project ceiling always wins. Every row has an
executable exact acceptance and one-over rejection.

| Dimension | Exact accepted | One-over result |
| --- | ---: | --- |
| Concurrent provider requests | 1 | pre-dispatch bound failure |
| Raw artifact bytes/page | 10 MiB | destroy bytes; no artifact |
| Aggregate verified bytes/acquisition | 64 MiB | terminal bound failure |
| Successful pages/artifacts | 16 | terminal before page 17 |
| Records/page and requested page limit | 10,000 | page rejection |
| Normalized facts/acquisition | 160,000 | no partial selection |
| Opaque page-material bytes | 4,096 | pre-dispatch pagination failure |
| Instruments/acquisition | 64 | pre-dispatch bound failure |
| Historical query span | 8 consecutive calendar dates | pre-dispatch window failure |
| HTTP attempts/acquisition | 48 | terminal before attempt 49 |
| Attempts/logical page | 3 | terminal before attempt 4 |
| Accepted `Retry-After` | 30,000 ms | terminal |
| Whole-attempt deadline | 30,000 ms | abort/destroy/settle |
| Whole-acquisition deadline | 300,000 ms | terminal |
| Rolling project rate | 30 attempts/60,000 ms | no dispatch until/if a budgeted window permits; never exceed |

Retry delay is exactly `1,000 ms` then `2,000 ms`; there is no jitter.

## HTTP, transport, parsing, and cleanup

| Fault | Expected |
| --- | --- |
| Pre-response transport failure | `retry-same-page` if all budgets permit |
| Timeout before headers | abort/settle, then retry if budgets permit |
| Fully cleaned partial-body transport failure | `retry-same-page` if budgets permit |
| Timeout during body, truncated body, or declared-length mismatch | destroy all partial bytes; retry only as cleaned partial transport failure |
| HTTP 408, 500, 502, 503, 504 | retry under deterministic delay and all budgets |
| HTTP 429 with temporary quota and valid bounded delay | retry under quota/budget rules |
| Quota-exhausted 429 | terminal |
| HTTP 400, 404, 409, 422 | terminal, no retry |
| HTTP 401 or 403 | terminal and lane disabled for the run |
| Missing `Retry-After` | ordinary deterministic delay if the 429 is otherwise retryable |
| Negative, date-form, fractional, malformed, excessive `Retry-After` | terminal |
| Malformed JSON, duplicate structural ambiguity, or schema drift | terminal schema failure; no retry |
| Identity, entitlement, feed, clock, bound, pagination, redaction, artifact, or zero-spend failure | terminal; no retry |
| Response body or store failure after `request.succeeded` | exact terminal stage; no commit, normalization, or selection |
| Sibling stream failure | abort/destroy all siblings and await settlement before return |
| Any returned promise | no post-return timer, read, retry, write, or stream activity |

Every retry preserves logical request/page identity and creates distinct retrieval-attempt,
acquisition-observation, frozen PR 2D market-acquisition, and attempt identities.

## Pagination and completeness

| Vector | Expected |
| --- | --- |
| Ordinals start at zero and advance without gaps | accept |
| Token hash bound to preceding verified page and unchanged request identity | accept |
| Repeated token or loop | terminal pagination failure |
| Gap, skipped ordinal, or duplicate ordinal | terminal pagination failure |
| Duplicate page digest at another position | quarantine/terminal |
| Cross-query token or query substitution | terminal pre-dispatch |
| Page after terminal continuation | terminal |
| Complete chain with every page committed then verified before checkpoint | eligible for normalization |
| Incomplete/unverified chain | no selection |

Raw continuation material remains private and unlogged. Only its bounded private material and hash
may occur in a durable checkpoint; this synthetic package persists neither.

The acquisition-wide `requestIdentityHash` is invariant across every page and excludes page ordinal
and continuation material. Each private `logicalPageIdentityHash` binds that unchanged request hash,
the page ordinal, and the current continuation hash (or the distinguished no-continuation value for
page zero). Every attempt identity binds the logical-page hash plus a new attempt ordinal. Thus a
retry changes only attempt identity, page advancement changes logical-page identity, and neither
operation changes request identity.

The frozen PR 2D `marketAcquisitionId` and the acquisition-wide `requestIdentityHash` also exclude
requested page limit. Because `marketAcquisitionId` includes the physical
`acquisitionObservationId`, a retry receives a new `marketAcquisitionId`; it is not the stable
logical request identity. A separate private `acquisitionConfigurationHash` binds the limit and all
effective operational policies. An unchanged configuration resumes; a changed limit or policy
causes a journal conflict without changing the stable request identity or inserting page-limit
fields into the frozen PR 2D preimage.

## Duplicate, correction, and mutation behavior

| Vector | Expected |
| --- | --- |
| Identical bytes redelivered for the same asserted delivery | physical deduplication allowed; delivery observation preserved |
| Different bytes for the same asserted delivery/revision | quarantine; no primary selection |
| Replacement with distinct supported revision evidence | distinct revision admitted under unchanged PR 2D rules |
| Replacement without supported revision evidence | quarantine; never infer correction semantics |
| Same logical content in different provider response order | canonical normalized facts and selection unchanged |

## Crash and durable-checkpoint matrix

| Injected crash | Restart rule |
| --- | --- |
| Before request | new attempt for same page |
| After `request.started` | previous attempt terminal/in-flight; new attempt for same page |
| During body | partial bytes destroyed; new attempt only if retry budgets permit |
| After a vault filesystem side effect but before durable artifact-commit receipt | reconcile the orphan; create a new attempt only after cleanup is proved |
| After artifact commit, before verification | verify committed artifact; never normalize unverified bytes |
| After artifact verification, before checkpoint | verify again idempotently; do not re-request page |
| After checkpoint | resume only the next valid page |
| During normalization | replay verified complete chain deterministically |
| Before selection | replay normalization then select once from complete verified chain |

Restart must reject changed configuration or logical request identity. It must verify every committed
artifact before use and produce identical facts and selection across every crash point.

## Privacy, credentials, retention, and output

| Vector | Expected |
| --- | --- |
| Missing `PEAS_ALPACA_API_KEY_ID` or `PEAS_ALPACA_API_SECRET_KEY` | typed credential-stage failure and zero network calls |
| Disabled reserved `PEAS_FMP_API_KEY` boundary | no read and no client |
| Non-secret preflight rejection | zero credential reads and zero transport calls |
| Credential-shaped nested keys, URL/error/cause/body/header/query fields | closed redacted projection only |
| Throwing getter, proxy, inherited/custom prototype, cycle, or hostile library value | getter/trap not trusted; opaque safe value |
| Raw provider error/body text | absent from logs and ledger facts |
| FMP evidence in public output | rejection |
| Provider material, raw token, credential, account evidence, or query-bearing URL in fixture/evidence | immediate `NO_GO` |

Retention deletion remains subject to the separate human authorization recorded in the credential,
privacy, and retention contract. This matrix does not authorize a port, migration, reconciliation,
or vault-semantic change.

## Replay, persistence, and termination invariants

| Vector | Expected |
| --- | --- |
| Replay page sizes `1`, `2`, `7`, `10,000` | byte-identical canonical projection |
| Memory journal versus SQLite journal | byte-identical ordered checkpoint projection |
| Provider response order permutation | same normalized facts and selection |
| Restart from every durable checkpoint | same final projection |
| Failure with active siblings | all abort/destroy/settle before return |
| Event-loop probe after return | zero asynchronous activity |

## Required validation

The exact PR 2E candidate must pass formatting, lint, typecheck, build, focused/full tests, coverage,
mutation, hard-kill, evidence reconciliation, applicable persistence/vault checks, and required
10k-scale execution. Linux and Windows CI must run without provider credentials or network access.
No test may be skipped because credentials are absent.

Any contract, fixture, or contract-test change after independent review invalidates the result and
requires a new candidate SHA and fresh review.
