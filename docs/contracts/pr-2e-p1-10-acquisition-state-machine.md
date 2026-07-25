# PR 2E P1-10 historical market acquisition state-machine contract

- Status: proposed contract-only checkpoint; implementation remains `NO_GO`
- Scope: offline specification and synthetic contract-test authority for P1-10
- Accepted downstream boundary: PR 2D contract authority registry
  `car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad`
- P1-09 authority: exact independently reviewed candidate
  `36dcf92b465fc5708614718b4312631fb5dbf544`
- Production namespace reserved for a later authorized PR 2F:
  `src/adapters/market-acquisition/**`

This document specifies a bounded acquisition coordinator. It adds no transport, credential read,
provider request, provider payload, migration, retention deletion, or provider-specific
normalization. The accepted PR 2D ports, identities, normalization, correction, selection, and
reason semantics remain unchanged.

PR 2F may not implement this contract until the exact integrated PR 2E candidate receives a fresh
independent `GO`, the orchestration owner acknowledges that checkpoint, and any retention
architecture requiring a migration, port, reconciliation, or vault-semantics change receives
separate human authorization. A PR 2E contract `GO` is not provider-call authority.

## 1. Closed lanes and authority

### 1.1 Alpaca primary lane

Only these three identities may enter the live state machine:

| Fact family | Exact endpoint-channel identity | Exact route |
| --- | --- | --- |
| quotes | `mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0` | `GET https://data.alpaca.markets/v2/stocks/quotes` |
| trades | `mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1` | `GET https://data.alpaca.markets/v2/stocks/trades` |
| bars | `mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c` | `GET https://data.alpaca.markets/v2/stocks/bars` |

Every row is bound to:

- `providerId`
  `mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c`;
- `datasetId`
  `mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1`;
- `feedId`
  `mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023`;
- `authorizationMode=p1-09-approved`; and
- no fallback.

The route is compiled authority, not runtime-configurable text. The multi-symbol route is mandatory
even for one symbol. An arbitrary origin, base URL, method, path, endpoint-channel identity, or
capability rejects before credentials are read and before transport is obtained.

The closed request fields for quotes and trades are `symbols`, `start`, `end`, `limit`, `feed`, and
`sort`, plus `page_token` only for a continuation. Bars add `timeframe` and `adjustment`. Values are
closed as follows:

- `feed` is exactly `sip`;
- `sort` is exactly `asc`;
- bars use exactly `timeframe=1Min` and `adjustment=raw`;
- `symbols` contains one through 64 unique canonical instrument symbols;
- `start` and `end` are explicit canonical UTC timestamps and `start <= end`;
- `limit` is an explicit integer from 1 through 10,000;
- the query covers one through eight consecutive calendar dates; and
- a first request has no `page_token`.

Omitted/default/wrong values and every unlisted query field are terminal pre-dispatch rejections.
Credentials never appear in a URL.

### 1.2 FMP discrepancy lane

The P1-09 FMP provider, dataset, feed, and two endpoint-channel identities remain frozen for
contract rejection tests. FMP remains private, discrepancy-only, never primary, never fallback,
never SIP/NBBO-equivalent, and unable to alter an Alpaca selection. The first PR 2F implementation
wave has no FMP production state machine or transport. An attempted FMP run therefore terminates
as `lane-not-implemented` with zero credential reads and zero transport calls.

### 1.3 Prohibited capability behavior

Latest, snapshot, single-symbol, WebSocket, delayed SIP, real-time SIP, IEX, BOATS, overnight, OTC,
corporate-action, account, subscription, entitlement-management, trial, upgrade, and paid-feed
capabilities have no transition to credential loading or dispatch. An unlisted FMP endpoint has no
transition to transport. There is no generic route state and no fallback edge.

## 2. Closed resource and time ceilings

The configured value for every ceiling is the lesser of the approved entitlement limit and this
project ceiling. A missing, non-integer, negative, zero where zero is not allowed, non-finite,
unprovable, or higher entitlement limit does not widen the project value. Unknown cost or quota
status is terminal before credential access.

| Ceiling | Exact project value | Exact/one-over rule |
| --- | ---: | --- |
| concurrent provider requests | 1 | one active request succeeds; a second cannot dispatch |
| raw artifact per page | 10,485,760 bytes (10 MiB) | exact succeeds; byte 10,485,761 aborts and destroys the partial body |
| aggregate verified bytes per acquisition | 67,108,864 bytes (64 MiB) | exact succeeds; byte 67,108,865 terminates atomically |
| successful pages/artifacts per acquisition | 16 | page 16 may complete; page 17 never dispatches |
| requested page limit | 10,000 records | 10,000 succeeds; 10,001 rejects before credentials |
| records per verified page | 10,000 | 10,000 succeeds; 10,001 rejects the acquisition |
| normalized facts per acquisition | 160,000 | 160,000 succeeds; fact 160,001 emits no selection |
| opaque page-token input | 4,096 UTF-8 bytes | exact may be privately hashed; byte 4,097 rejects before hash/log |
| instruments per acquisition | 64 | 64 succeeds; 65 rejects before planning |
| historical query span | 8 consecutive calendar dates | 8 succeeds; a ninth rejects before planning |
| HTTP attempts per acquisition, retries included | 48 | attempt 48 may start; attempt 49 never dispatches |
| attempts per logical page | 3 total | one initial plus two retries; fourth never dispatches |
| retry delays | 1,000 ms then 2,000 ms | exact deterministic values; no randomized jitter |
| accepted `Retry-After` | 30,000 ms | exact succeeds; 30,001 ms or larger is invalid |
| whole attempt deadline | 30,000 ms | includes dispatch, headers, body, store, abort, destroy, and settlement |
| whole acquisition deadline | 300,000 ms | includes preflight, attempts, delays, storage, verification, journal, normalization, cleanup, and terminal persistence |
| Alpaca project rate | 30 attempt starts per rolling 60,000 ms | the 30th may start; the 31st waits or terminates without dispatch |

All byte totals use verified consumed bytes, not a provider declaration alone. Declared and actual
length are independently checked. Duplicate input members count for resource safety before any
semantic deduplication. A bound failure never truncates, splits, evicts active state, emits partial
facts, or silently creates another acquisition.

## 3. Identities

### 3.1 Acquisition and logical request

`marketAcquisitionId` uses the exact frozen PR 2D preimage and no other field:

```text
acquisitionObservationId
providerId, datasetId, feedId, endpointChannelId
entitlementSnapshotId
sorted unique instrumentIds
sorted unique requestedFactKinds
queryStartNs, queryEndNs
sortOrder
routePolicyVersion
```

It excludes page size/limit, page ordinal, page token, response order, URL/query text, credentials,
headers, account data, local path, request/retrieval/commit wall time, backend, provider bytes,
attempts, retries, process IDs, and replay time. PR 2E does not add a field to this accepted
preimage.

Because the frozen `acquisitionObservationId` binds a physical `retrievalAttemptId`,
`marketAcquisitionId` is observation/attempt-scoped and may change for a retry. It is not the
acquisition-wide logical-query identity. Each durable successful page records the exact
`marketAcquisitionId` associated with its physical delivery evidence.

The acquisition-wide `requestIdentityHash` independently binds the exact source tuple,
entitlement snapshot, instrument IDs, fact family, exact start/end, `feed=sip`, `sort=asc`,
`authorizationMode=p1-09-approved`, the closed route-policy version, and for bars the exact
`timeframe=1Min` and `adjustment=raw`. It remains unchanged for every page. It excludes requested
page limit, page ordinal, all raw or hashed token evidence, `acquisitionObservationId`,
`retrievalAttemptId`, and `marketAcquisitionId`, preserving the frozen PR 2D page-layout and
physical-attempt exclusions.

A separate private `acquisitionConfigurationHash` binds `requestIdentityHash`, the requested page
limit, the effective lesser-of entitlement/project ceilings, run-scoped live-enable decision,
zero-spend policy ID and decision, quota policy, retry policy, deadline policy, retention-policy
readiness, and journal schema version. It is operational restart evidence, never a PR 2D semantic
identity. Restart rejects any configuration-hash change; changing page limit cannot change
`marketAcquisitionId` or `requestIdentityHash`.

A distinct private `logicalPageIdentityHash` binds `requestIdentityHash`, the zero-based page
ordinal, and the private hash of the token authorizing that page. Page zero uses a distinguished
no-token value. It binds no raw token. Changing any query field creates a different acquisition
rather than a continuation; changing page position or token evidence creates a different logical
page, not a different acquisition-wide request.

### 3.2 Attempts and deliveries

Every physical dispatch has a new `attemptId` that binds `logicalPageIdentityHash`, the zero-based
attempt ordinal for that logical page, and a run/session nonce. A retry preserves
`requestIdentityHash`, page ordinal, token hash, and `logicalPageIdentityHash`; it creates a new
`retrievalAttemptId`, `acquisitionObservationId`, `marketAcquisitionId`, `attemptId`, trusted
request-start evidence, and `acquisition.declared -> request.started` ledger chain.

An attempt is not a successful page. A successful page additionally requires:

1. a complete 2xx response;
2. successful private `ArtifactStore` commit;
3. verified read with digest, declared size, consumed size, observation identity, and request
   identity reconciliation;
4. closed-schema page validation within record and fact bounds;
5. token extraction and private token-hash validation; and
6. durable page-checkpoint commit.

Exact duplicate bytes may share physical content while every provider delivery retains its own
immutable attempt and observation evidence. Physical deduplication never collapses page, attempt,
provider, dataset, feed, endpoint, authorization, or delivery identity.

## 4. Trusted request-start authorization boundary

The authorization clock is the trusted `request.started` stamp for the physical attempt. The
coordinator samples and validates it immediately before credential access and dispatch, after all
non-secret preflight gates have passed:

```text
endNs <= trustedRequestStartedAtNs - 900_000_000_000
```

Equality is authorized. An end value one nanosecond newer is rejected. Arithmetic is exact signed
integer nanoseconds and rejects underflow or overflow.

The clock basis must be `system-utc` with `verified-bound` synchronization, a bounded non-null
maximum error, and same-session `process-monotonic-us` evidence. Authorization succeeds only when
the conservative oldest provable request-start instant still proves the inequality. In equivalent
form, if the clock reading is `wallNs` and its maximum error is `errorNs`, authorization uses
`trustedRequestStartedAtNs = wallNs - errorNs`, never the favorable side of the uncertainty
interval.

The following are terminal before credentials and dispatch:

- unavailable or null clock basis;
- non-verified or incompatible synchronization;
- absent, invalid, or unbounded maximum error;
- wall-clock regression from any prior acquisition entry in the same basis;
- same-session monotonic regression or missing same-session monotonic order;
- a changed clock basis during preflight;
- arithmetic overflow; or
- a boundary that cannot be proved.

Response, completion, replay, file, artifact, database, or `CURRENT_TIMESTAMP` time never
authorizes a request. No rounding or minute snapping is permitted.

While a response is active, every mutation boundary samples the compatible clock and proves
non-regressing wall and monotonic order. A regression does not retroactively authorize or
deauthorize already transmitted bytes; it immediately aborts the active request, destroys all
partial bytes, settles the stream, records terminal `clock-regression`, disables further dispatch
for the acquisition, and emits no artifact commit for that body.

## 5. Exact states

An acquisition has exactly one current state:

| State | Meaning |
| --- | --- |
| `declared` | immutable logical-acquisition journal declaration exists; no physical-attempt preflight has run |
| `preflighting` | all non-secret authority, identity, query, bound, cost, quota, journal, and clock checks are executing |
| `dispatch-ready` | non-secret preflight and durable trusted `request.started` evidence passed; no credential has yet been read |
| `credential-ready` | runtime-only credential read succeeded; no request has been dispatched |
| `attempt-active` | exactly one request is in flight under a persisted `request.started` entry |
| `response-accepted` | complete acceptable headers/status were received and `request.succeeded` is durable; the body/store path is not yet committed |
| `artifact-committing` | one complete bounded body is being privately committed |
| `artifact-committed` | immutable artifact observation and `artifact.committed` ledger evidence exist |
| `artifact-verifying` | the committed artifact is being read through the verified-read boundary |
| `page-verified` | bytes, observation, schema, record count, page position, and token relation validate |
| `checkpointing` | the verified page and cumulative budgets are being atomically advanced in the acquisition journal |
| `waiting-retry` | a retryable failure is fully cleaned up and a deterministic delay is pending |
| `chain-complete` | a verified terminal token closes a contiguous page-zero-through-page-N chain |
| `normalizing` | the complete verified chain is translated through unchanged PR 2D normalization |
| `ready-for-selection` | all normalized/ignored/quarantined results for the complete chain are durable and facts remain within bounds |
| `selecting` | unchanged PR 2D selection is executing over the complete admitted fact corpus |
| `completed` | terminal selection or typed missing result is durable |
| `stopped` | terminal policy, authorization, quota, timeout, lane-disable, or operator stop; no trusted partial output |
| `failed-clean` | terminal technical/schema/artifact/pagination/correction failure after all active resources are settled |
| `quarantined` | conflicting delivery/revision or unsupported mutation is preserved privately and excluded from selection |

`completed`, `stopped`, `failed-clean`, and `quarantined` are terminal. No terminal state has an
outgoing dispatch, normalization, or selection transition.

## 6. Transition table

Only these transitions exist:

| From | Event and required proof | To |
| --- | --- | --- |
| `declared` | durable logical-acquisition journal declaration | `preflighting` |
| `preflighting` | every non-secret gate passes; a new attempt-scoped `acquisition.declared -> request.started` chain is durable | `dispatch-ready` |
| `preflighting` | any gate fails | `stopped` or `failed-clean` |
| `dispatch-ready` | runtime credential boundary succeeds | `credential-ready` |
| `dispatch-ready` | credential missing/invalid | `stopped` with zero transport calls |
| `credential-ready` | exactly one authorized dispatch begins under the already durable `request.started` entry | `attempt-active` |
| `attempt-active` | retryable pre-response failure and cleanup completes | `waiting-retry` |
| `attempt-active` | acceptable complete response headers/status | `response-accepted` |
| `attempt-active` | non-retryable status, timeout, regression, abort failure, or acquisition stop | `stopped` or `failed-clean` |
| `response-accepted` | bounded response body begins private store | `artifact-committing` |
| `response-accepted` | body/store fails after cleanup | `failed-clean`; no artifact, normalization, or selection |
| `artifact-committing` | store returns a reconciled immutable observation | `artifact-committed` |
| `artifact-committing` | store/stream failure and cleanup completes | `failed-clean` |
| `artifact-committed` | exact commit ledger evidence is durable | `artifact-verifying` |
| `artifact-verifying` | verified read and page validation pass | `page-verified` |
| `artifact-verifying` | read/digest/size/schema/page failure | `failed-clean` or `quarantined` |
| `page-verified` | page is durably incorporated into the journal | `checkpointing` |
| `checkpointing` | terminal next-token value and chain closure prove complete | `chain-complete` |
| `checkpointing` | a valid unique next token exists and budgets permit another page | `preflighting` |
| `checkpointing` | persistence failure or next-page bound failure | `failed-clean` |
| `waiting-retry` | delay completes; all deadlines, quotas, lane status, and request identity still pass | `preflighting` |
| `waiting-retry` | a deadline, quota, cost, authorization, or stop gate fails | `stopped` |
| `chain-complete` | every committed page verifies again and admitted chain identity matches | `normalizing` |
| `normalizing` | deterministic normalization completes or emits closed ignored/quarantined outcomes | `ready-for-selection` or `quarantined` |
| `normalizing` | facts/bounds/schema/revision fail | `failed-clean` or `quarantined` |
| `ready-for-selection` | complete fact corpus and unchanged PR 2D selection authority validate | `selecting` |
| `selecting` | selected or typed missing result is durable | `completed` |
| `selecting` | selection conflict/failure | `failed-clean` or `quarantined` |

There is no transition from a partially verified page chain to `normalizing`,
`ready-for-selection`, or `selecting`.

## 7. Non-secret preflight order

For each physical attempt, preflight evaluates this exact order without reading credentials:

1. contract candidate and accepted PR 2D authority registry;
2. run-scoped live-enable flag and `authorizationMode=p1-09-approved`;
3. provider/dataset/feed/endpoint-channel identities and primary-only role;
4. compiled method/origin/path and closed query-field/value set;
5. symbol, window, page, record, fact, byte, token, attempt, and concurrency ceilings;
6. zero-spend policy decision and eligible no-incremental-cost status;
7. lane-disabled and operator-stop state;
8. logical acquisition/request identity equality with the durable journal;
9. page-chain position and private prior-token-hash authority;
10. acquisition and per-page attempt budgets;
11. whole-acquisition and whole-attempt deadline feasibility;
12. rolling project quota and any stricter approved entitlement quota;
13. trusted clock basis, regression checks, and exact 15-minute boundary; and
14. durable `request.started` intent/evidence readiness.

Any failure stops before credential access, creates no network call, and records only the closed
non-secret terminal classification. A credential error cannot mask an earlier preflight failure.

## 8. Status, timeout, retry, and quota policy

### 8.1 Retry classes

Only these failures may be retried:

- a pre-response transport failure;
- a partial-body transport failure after all partial bytes are destroyed and the response stream,
  store stream, timers, listeners, and sibling resources are settled;
- HTTP `408`, `429`, `500`, `502`, `503`, or `504`.

Never retry:

- HTTP `400`, `401`, `403`, `404`, `409`, or `422`;
- an unlisted status;
- identity, entitlement, authorization, feed, capability, cost, clock, bound, schema, pagination,
  redaction, artifact, correction, or journal failure;
- malformed JSON or provider body;
- unsupported correction/replacement semantics;
- inability to prove complete cleanup; or
- any zero-spend failure.

HTTP `401` or `403` disables the affected lane for the remainder of the run after cleanup. It does
not inspect, refresh, replace, or retry a credential. A quota-exhausted `429` ends the acquisition.
A `429` is retryable only when the closed sanitized response classification explicitly proves
temporary throttling without provider quota exhaustion and the project quota independently permits
another attempt; missing or ambiguous quota status is terminal.

### 8.2 Attempt numbering and delays

Attempt ordinal zero is the initial attempt. After a retryable failure:

- retry ordinal one waits exactly 1,000 ms;
- retry ordinal two waits exactly 2,000 ms;
- no ordinal three exists.

The delay is measured with the compatible same-session monotonic clock. Wall-clock movement cannot
shorten it. There is no random jitter. A retry recomputes all preflight gates and receives a new
trusted `request.started` stamp and new attempt identity.

### 8.3 `Retry-After`

The only accepted `Retry-After` grammar is a canonical non-negative ASCII integer delta-seconds
with no sign, whitespace, decimal point, leading zero except literal `0`, or alternate unit. HTTP
date form is rejected as non-deterministic for this contract. Exact conversion to milliseconds
must be safe.

- missing header: use the applicable 1,000 ms or 2,000 ms project delay;
- valid delta-seconds whose exact conversion is at or below 30,000 ms: wait
  `max(projectDelay, retryAfterMs)`;
- malformed, negative, date-form, overflowed, or above-30,000-ms value: terminal
  `retry-after-invalid`, with no retry.

The wire grammar's first representable excessive value is 31 seconds (31,000 ms). The normalized
millisecond validator is nevertheless tested independently at 30,000 and 30,001 ms so the project
ceiling cannot be widened by a different future parser.

The wait must still fit the whole-attempt feasibility check for the next attempt and the
whole-acquisition deadline. It never reserves or authorizes quota.

### 8.4 Rolling quota

An attempt consumes quota at its durable trusted `request.started` transition, before dispatch.
For proposed start `t`, the rolling window is `(t - 60,000 ms, t]`; a prior start exactly at
`t - 60,000 ms` is outside the window. The proposed start is permitted only when its inclusion
keeps the count at or below 30 and below any stricter approved entitlement limit.

If quota will become available within the whole-acquisition deadline, the coordinator may
deterministically wait until the oldest blocking attempt falls out of the half-open window. If it
cannot prove that instant or the deadline would be exceeded, it stops without dispatch. Retries
consume quota like initial attempts.

### 8.5 Deadlines and settlement

The 30,000 ms whole-attempt deadline begins at the trusted `request.started` transition and ends
only when success reaches `page-verified` or failure cleanup is fully settled. Timeout before
headers and timeout during body use the same deadline. Timeout aborts transport and storage,
destroys partial bytes, drains no unbounded body, detaches listeners, cancels timers, and awaits
close/settlement before returning.

The 300,000 ms whole-logical-acquisition deadline begins at the durable journal declaration. It is
not reset by an attempt-scoped `acquisition.declared`, page, retry, restart, or process crash. A
restart uses the persisted original deadline basis. No work remains scheduled after a public
method returns.

## 9. Pagination and complete-chain proof

### 9.1 Token privacy and binding

Raw page tokens are secret-like private control material:

- never logged, placed in an error, ledger fact, public evidence, fixture output, URL record,
  identity preimage, or repository file;
- stored only in the private durable journal under the configured runtime root;
- bounded before hashing or persistence;
- passed back byte-for-byte without decoding, normalization, trimming, or interpretation; and
- destroyed from transient memory when no longer needed.

The private token hash is a domain-separated digest of private token bytes. Each continuation token
record binds:

```text
preceding successful page's attempt-scoped marketAcquisitionId
unchanged request identity excluding page token
preceding page ordinal
preceding verified artifact observation ID and digest
preceding page-chain hash
next page ordinal
token hash
```

It is usable exactly once for that next page.

### 9.2 Page chain

Pagination begins at ordinal zero with no token. A returned token becomes authoritative only after
the page that returned it has been committed, verified, schema-validated, and checkpointed.

The page-chain hash is a forward hash over the previous chain hash, page ordinal,
`requestIdentityHash`, `logicalPageIdentityHash`, verified artifact observation ID and digest,
current token hash, next token hash or the terminal marker, record count, and cumulative budgets.
Provider response order or page size never substitutes for this identity.

Reject before further dispatch:

- a first-request token;
- raw token length above 4,096 bytes;
- a repeated token or token hash;
- a token loop;
- a missing/gapped/skipped page ordinal;
- duplicate page position;
- a cross-acquisition or cross-query token;
- changed symbols, start, end, limit, feed, sort, timeframe, adjustment, identity, or route;
- token substitution;
- a token not bound to the immediately preceding verified page;
- a nonterminal page without one valid next token;
- a terminal page with a next token;
- any page after a terminal token; or
- page 17.

A null/absent next token is the only terminal marker. Empty string is malformed, not terminal.
Completeness requires a contiguous chain from page zero through exactly one terminal page, every
page committed and verified, cumulative budgets reconciled, and no unresolved in-flight page.
Selection is forbidden until that proof is durable.

## 10. Partial response, sibling cleanup, and rollback

Transport bytes have no semantic standing before private commit and verified read. On any
pre-commit failure:

1. stop accepting bytes;
2. abort the request and body reader;
3. destroy the ArtifactStore input stream and every acquired sibling stream;
4. destroy staging/partial bytes through the existing vault abort/reconciliation protocol;
5. cancel timers and detach callbacks/listeners;
6. await close/settlement of every resource;
7. persist the exact terminal stage and non-secret detail hash; and
8. only then return or consider a retry.

Partial bytes are never parsed, normalized, selected, retained as a successful artifact, or used to
derive a page token. Failure to prove cleanup is itself terminal and non-retryable.

`request.succeeded` means acceptable response status and headers were established; it is not proof
that the response body was fully consumed and is not an artifact commit. If body or store fails
after `request.succeeded` but before commit, the ledger records the exact failure stage and emits no
`artifact.committed`, `normalization.*`, or `selection.recorded` for that attempt. If the verified
read fails after `artifact.committed`, the immutable commit remains, the ledger records the
artifact-read failure parented by that commit, and no `artifact.verified`, `normalization.*`, or
`selection.recorded` is emitted.

Rollback never deletes or rewrites a previously committed immutable verified artifact. It marks the
acquisition incomplete/failed and prevents downstream selection. Private orphan/stage handling uses
the existing reconciler. Retention deletion is outside this transition graph and remains separately
authorized work.

## 11. Crash and restart semantics

The durable journal, specified by the PR 2E artifact/replay contract, is authoritative. Restart
first recomputes the complete logical acquisition identity and validates unchanged configuration,
query, authority, zero-spend policy, deadlines, and cumulative budgets.

| Crash point | Restart rule |
| --- | --- |
| before request | rerun non-secret preflight; no attempt is presumed |
| after `request.started`, before terminal response | mark prior attempt abandoned/incomplete after reconciliation; create a new attempt for the same logical page |
| during body/store | reconcile and destroy/abort partial stage; never normalize it; retry only if the original failure class and budgets permit |
| after artifact commit, before verification | verify the committed artifact; do not re-request the page |
| after verification, before checkpoint | re-verify and atomically create the missing checkpoint; do not re-request |
| after checkpoint | resume only the next valid page |
| during normalization | re-verify the complete chain and deterministically restart normalization; no provider request |
| before selection | validate durable normalized corpus and run selection; no provider request |

Restart never reuses an old attempt identity, resets attempts/deadlines/quotas, skips a page,
re-requests an already verified page, or trusts a checkpoint without its artifact verification.
Memory and SQLite journals must make the same decision. Replay page sizes 1, 2, 7, and 10,000,
provider response order, process restart, and backend row order must produce byte-identical PR 2D
facts and selection/missing results.

## 12. Duplicate, redelivery, correction, and mutation rules

Acquisition preserves deliveries and defers economic semantics to unchanged PR 2D contracts:

- identical redelivery bytes may deduplicate physical content but retain distinct immutable
  attempt, delivery, observation, and causal ledger evidence;
- duplicate records within a verified page count toward resource bounds before exact semantic
  duplicate collapse;
- the same asserted provider delivery/revision identity with conflicting bytes or economic content
  quarantines the entire equivalence class independent of arrival order;
- a provider replacement/correction is admitted only with the complete supported immutable
  revision relation, stable-key scope, revision kind, and durable evidence required by PR 2D;
- correction and cancellation never overwrite original facts;
- orphan, fork, cycle, ambiguous target, correction-in-place without revision evidence, changed
  stable-key meaning, or undocumented replacement semantics quarantines affected facts and
  produces no primary selection;
- retries and pagination never manufacture correction order; and
- FMP evidence cannot resolve or replace an Alpaca conflict.

Unknown correction behavior is never guessed. A provider schema or correction behavior outside
the accepted contract is a stop condition requiring a prospective contract amendment and fresh
review.

## 13. Ledger ordering and output atomicity

For a successful live page, causal ledger order is:

```text
acquisition.declared
-> request.started
-> request.succeeded
-> artifact.committed
-> artifact.verified
```

After the complete page chain is proven, every admitted page proceeds in canonical page order:

```text
artifact.verified
-> normalization.emitted | normalization.ignored | normalization.quarantined
```

Only after all page outcomes are durable and the complete normalized corpus validates may one
terminal acquisition result proceed:

```text
normalization.*
-> selection.recorded
```

A failure records `failure.recorded` with the exact last successful predecessor and closed stage.
No acquisition exposes partial normalized facts or a selection before terminal completion. A
quarantined page/family prevents primary selection whenever it can affect the requested result.
Ignored evidence remains explicit and counted; it is not silently dropped from completeness.

## 14. Closed terminal classifications

The state machine emits one non-secret classification from this closed set. Provider body, raw
exception, URL/query, token, header, credential, or arbitrary library text is never a
classification detail.

```text
authority-invalid
lane-not-authorized
lane-not-implemented
capability-not-authorized
configuration-invalid
identity-mismatch
query-invalid
zero-spend-unprovable
credential-unavailable
clock-unavailable
clock-regression
historical-boundary-unprovable
concurrency-exhausted
quota-exhausted
attempt-budget-exhausted
page-budget-exhausted
acquisition-deadline
attempt-timeout
retry-after-invalid
transport-failed
http-nonretryable
lane-disabled
partial-cleanup-failed
artifact-store-failed
artifact-verification-failed
response-length-mismatch
schema-invalid
bound-exceeded
pagination-invalid
journal-conflict
delivery-conflict
correction-unsupported
normalization-failed
selection-failed
operator-stop
```

Where an accepted PR 2D `market.*` reason exists, the downstream normalized/selection outcome uses
that exact reason. These acquisition classifications describe operation stage and do not amend the
accepted PR 2D reason catalog.

## 15. Stop conditions and lane disable

The coordinator stops immediately, performs cleanup, and prohibits further dispatch when:

- authority, route, field, feed, identity, provider role, or cost status is not exact;
- trusted request time or the 15-minute boundary is unprovable;
- the wall or same-session monotonic clock regresses;
- an attempt, page, byte, record, fact, symbol, query-window, quota, retry, or deadline ceiling is
  reached with no authorized next action;
- pagination completeness cannot be proved;
- a partial stream cannot be destroyed and settled;
- a secret, raw token, query URL, provider body, or provider byte crosses a public boundary;
- the provider returns an uncontracted schema, correction, or capability;
- an unauthorized fallback is proposed; or
- a human/operator stop or contrary provider instruction is active.

`401` and `403` additionally disable the affected lane for the run. Credential rotation, account
inspection, subscription changes, endpoint substitution, and automatic fallback are not recovery
actions.

## 16. Required executable contract proofs

PR 2E synthetic tests must prove, without credentials or network:

1. every state has only the transitions above and every illegal transition rejects;
2. exact/one-over behavior for every ceiling in section 2;
3. boundary equality and one-nanosecond-newer rejection before credential access;
4. wall and monotonic regression before dispatch and during an active response;
5. all status and `Retry-After` classifications, retry delays, attempt identity changes, and
   logical-page identity stability;
6. project and entitlement quota intersection, rolling-window boundary equality, and quota
   exhaustion;
7. timeout before headers and during body with destruction, settlement, no post-return activity,
   and no partial output;
8. first/middle/last sibling failures and store/read failures settle all resources;
9. every pagination gap, loop, repeat, substitution, duplicate position, cross-query use, and
   post-terminal page rejects;
10. commit/verify-before-checkpoint and complete-chain-before-selection;
11. identical redelivery, conflicting delivery, supported revision, and unsupported mutation
    behavior independent of order;
12. crash recovery from every durable checkpoint without re-requesting verified pages;
13. page-size 1/2/7/10,000, response-order, repeat-run, and memory/SQLite equivalence;
14. missing credentials and every unauthorized capability produce zero transport calls;
15. FMP cannot enter the production state machine, primary result, fallback, or public output; and
16. public completion returns only after timers, streams, abort handlers, store work, and callbacks
    have settled.

The default CI network witness must throw on every unexpected access. Absence of provider
credentials is the expected default and must not skip a test.

## 17. Deferred authorization and non-decisions

This contract does not authorize:

- any provider witness;
- FMP transport;
- a migration, frozen-port change, artifact-vault deletion API, or new reconciliation semantic;
- credential inspection or account/subscription inspection;
- provider-derived Git fixtures or public provider evidence;
- retention deletion implementation;
- P2 collection or any event-study outcome; or
- merge of PR 2E or PR 2F.

If retention enforcement cannot be implemented additively under separately approved authority, PR
2F remains `NO_GO`. If implementation requires altering this accepted contract or a frozen PR 2D
port, work returns to a new contract-amendment candidate and fresh independent review.
