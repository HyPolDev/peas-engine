# PR 2E P1-10 sixth independent contract review

```text
REVIEWED_CANDIDATE_SHA = 9ec0a48266d72ce42f0a815da6ed367d91a06b7b
CONTRACT_DECISION = GO
RETENTION_IMPLEMENTATION_AUTHORIZATION = HUMAN_AUTHORIZATION_REQUIRED / NOT_AUTHORIZED
PR_2F_ENTRY = NO_GO
PROVIDER_WITNESS = NOT_AUTHORIZED
MERGE = NOT_AUTHORIZED
```

## Review identity, isolation, and scope

This is a fresh independent review. The reviewer authored none of the PR 2E contract, fixture,
test, repair, orchestration, board, roadmap, or prior-audit package and edited only this review
record.

Before reading candidate content:

- `git rev-parse HEAD` returned
  `9ec0a48266d72ce42f0a815da6ed367d91a06b7b`;
- `git status --short --branch` returned only `## HEAD (no branch)`, proving detached HEAD and a
  clean worktree; and
- the review used the dedicated detached worktree `audit-sixth-9ec0a482`, not the integration
  worktree.

The candidate diff from base `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` contains only
documentation, the six immutable earlier PR 2E audit records, project board/roadmap integration,
original-synthetic fixtures, and `test/p1-10-contract.test.ts`. It adds no production source,
migration, workflow, dependency, HTTP transport, credential loader, provider client, or FMP
production file. Accepted PR 2D and P1-09 authority bytes are unchanged.

I read the accepted P1-09/PR 2D authority chain, every PR 2E contract, the complete fixture root,
the complete executable contract model, and all six prior immutable `NO_GO` reports. P1-09 final
`GO` supersedes historical pending status prose only. It does not authorize a provider request,
credential use, account inspection, witness, retention-semantics change, PR 2F, merge, P1-06
entry, or P2 work.

## Independent source-identity and zero-spend recomputation

I independently implemented recursive canonical JSON key ordering and exact
`uint64be(length) || bytes` framing with SHA-256 using only `node:crypto`. The computation did not
import a repository canonicalizer, hash helper, identity function, or test constant and accessed
neither credentials nor provider network. All 11 identities matched the exact P1-09 preimages in
`docs/contracts/pr-2e-p1-10-entitlement-identity.md:90-225`:

| Identity | Independent result |
| --- | --- |
| Alpaca provider | `mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c` |
| Alpaca dataset | `mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1` |
| Alpaca feed | `mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023` |
| Alpaca quotes channel | `mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0` |
| Alpaca trades channel | `mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1` |
| Alpaca bars channel | `mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c` |
| FMP provider | `mpv1_526c731d81a453ab057fd6f946e49291d0863350d319a73893d46e34b2a51a7a` |
| FMP dataset | `mds1_eaaa286ff4841f43275131aca2abb17fad3ab78cbe3af49921a36a3249439f68` |
| FMP feed | `mfd1_582a672a4109841f0ef80d286021e1e827d4a5f050059e22c87d08c842d0051b` |
| FMP aftermarket-quote channel | `mec1_1e1c2239cce268ea690a82bd3f3ff6148bbd2bb8bb288c57a2e2cdf79cf8f1cd` |
| FMP aftermarket-trade channel | `mec1_feb9f3a3deab6dbabd6fcc204c8ced63d88a2ca14d8f235b1fec2dab49df6bdf` |

The same independent implementation reproduced the zero-spend identity from the exact inert
preimage at `docs/contracts/pr-2e-p1-10-entitlement-identity.md:406-435`:

`mzp1_b2f575e234dcd7f05eb5fcc03060420313b56e45aff87c961c3771d1c5cf3b9e`.

The closed zero-spend preflight requires the literal policy identity, independently recomputable
preimage, run decision `allow`, and exact cost status before credential or transport counters can
advance (`test/p1-10-contract.test.ts:812-857,1229-1252`). Mutation and absent/false/unknown/stale
decisions execute through zero-side-effect rejection.

## Independent literal alias-authority recomputation

I separately parsed
`fixtures/market-acquisition/v1/synthetic-alias-authority-catalog.json` and recomputed every
displayed identity from its literal preimage without importing repository or test hashing code:

- all 65 `imap1_` issuer-mapping identities matched;
- all 65 `min1_` market-instrument identities matched;
- all 65 `msa1_` symbol-alias identities matched;
- all 65 symbols were unique and every issuer/instrument/alias linkage and effective interval was
  structurally complete; and
- the complete catalog preimage independently recomputed to
  `maac1_361de0d202a39899c369c10da3c5bb43e98305c91749f1bee6b7cab5eac685dd`, exactly matching the
  displayed literal.

Independent boundary samples were:

```text
row 0
imap1_f31410cd268dff7928dc29df37d1dde373bad5c56e3cbaeceaa700cc29482a0f
min1_3b467b21098f87d8080d2ead6b24e22d24a5b995dfb7b107cf197efe806ef800
msa1_d53850b61421a9f7dfebcef3b4d2b4aeca4bd5b45630a5e2ce55e59ea4651f98

row 64
imap1_b34c463cbf4d6eb73bb02762840d1a0733b741356f6f131a20a6e4ba73d7d1a4
min1_5425cde56d2a1bfbd9c864f629ab17cd8940b9da1a6433b4b39f1da8e73685be
msa1_597acb7f76343333b26120520d49e956698d6de53b4e9b82ff17178c6e661b0b
```

The catalog file SHA-256 is
`4469a2d27db825ea99acf55aee2fd475b18ff07387c3237de494b0c583466e75`.
An independent content scan found no provider origin, provider name, authentication/header name,
credential environment name, pagination field, market fact, price, quote, trade, bar, or URL in
the catalog.

## Prior-finding disposition

### F-006a - closed: literal root and configuration binding

The candidate now carries all 65 complete literal rows and displayed IDs in a dedicated
original-synthetic catalog. Module load parses that literal file, recursively freezes the complete
object graph, and validates every row plus the literal catalog identity before use
(`test/p1-10-contract.test.ts:147-267,414-628`). The accepted catalog identity is included in the
closed acquisition-configuration preimage
(`test/p1-10-contract.test.ts:1314-1339`). Independent mutations of every preimage family, every
displayed-ID family, the displayed catalog ID, and the configured catalog ID reject before any
side effect (`test/p1-10-contract.test.ts:5115-5205`).

Preimages and displayed IDs can no longer move together without changing the literal catalog
bytes, independently recomputed catalog identity, and bound configuration. F-006a is closed.

### F-006b - closed: exact immutable cache and per-use hostile snapshot

There is no generic `WeakSet` or shallow-frozen-array cache. Only object identity equality with
the exact module-owned catalog can reuse one-time validation; that object and all descendants are
recursively frozen. Every external/test catalog is canonical-snapshotted and every row is
revalidated on every use (`test/p1-10-contract.test.ts:630-668`).

The executable hostile seam first admits a frozen outer catalog with mutable rows, then separately
mutates a row, nested preimage, interval, linkage, or displayed ID. The next guarded call rejects
with every side-effect counter zero (`test/p1-10-contract.test.ts:5207-5264`). F-006b is closed.

### F-005b - remains closed: durable continuation authority

Continuation admission receives the actual preceding durable checkpoint. It compares the exact
opaque material and byte limit, token hash, request identity, page ordinal, preceding acquisition,
logical page, artifact observation/digest, page-chain hash, complete continuation-binding hash,
and stored checkpoint authority before dispatch (`test/p1-10-contract.test.ts:890-948`).
Self-consistently rehashed mutation of every durable member runs through standalone,
uninterrupted, and restart admission and produces no rejected-page dispatch
(`test/p1-10-contract.test.ts:4824-5065`). Restart verifies the journal and reuses the same
admission path; an already verified page is never requested again.

### F-005c - remains closed: canonical timestamps

The parser requires exact nine-digit UTC nanoseconds and exact millisecond and nanosecond
parse/re-encode equality (`test/p1-10-contract.test.ts:796-809`). Impossible dates, invalid leap
days, overflow, leap-second text, and normalized-but-different instants reject
(`test/p1-10-contract.test.ts:5068-5112`).

## Full contract controls

No candidate-blocking finding remains.

- **Closed acquisition surface.** Alpaca preflight hard-requires the fixed provider/dataset/feed/
  endpoint tuple, `GET`, fixed origin/path, explicit `feed=sip`, `sort=asc`, bounded canonical
  limit, exact multi-symbol membership, and `1Min/raw` bars. It rejects every extra field and first
  request token before credentials (`test/p1-10-contract.test.ts:812-969`). The documentation
  freezes only the three multi-symbol routes and closed field/value matrix
  (`docs/contracts/pr-2e-p1-10-entitlement-identity.md:255-306`).
- **Trusted time.** The executable predicate uses exact integer nanoseconds and accepts equality at
  the conservative trusted `request.started` minus 900,000,000,000 ns boundary while rejecting one
  nanosecond newer (`test/p1-10-contract.test.ts:955-989,5267-5310`). Unavailable/unprovable time
  and pre-dispatch monotonic regression reject before credential reads; active-response regression
  aborts, destroys, and settles all acquired streams with no commit, normalization, or selection
  (`test/p1-10-contract.test.ts:5312-5344,6180-6224`). The contract also explicitly makes wall
  regression terminal before and during dispatch
  (`docs/contracts/pr-2e-p1-10-acquisition-state-machine.md:244-281`).
- **Bounds.** Every frozen project ceiling has executable exact and one-over vectors, including
  concurrency 1, 10 MiB page bytes, 64 MiB aggregate bytes, 16 pages, 10,000 records/page and
  requested limit, 160,000 facts, 4,096 token bytes, 64 instruments, eight consecutive calendar
  dates, 48 attempts, three attempts/page, 30,000 ms Retry-After, 30,000 ms attempt deadline,
  300,000 ms acquisition deadline, and 30 attempts/rolling 60 seconds
  (`test/p1-10-contract.test.ts:5346-5424`; contract register
  `docs/contracts/pr-2e-p1-10-acquisition-state-machine.md:85-105`).
- **Retry, quota, timeout, and cleanup.** Only pre-response transport failures, fully cleaned
  partial-body failures, and 408/429/500/502/503/504 are retryable. 400/401/403/404/409/422 and
  contract/schema/artifact failures stop; 401/403 disable the lane and quota-exhausted 429 stops.
  Retry delay is deterministic 1,000/2,000 ms without jitter. Retry-After grammar and exact/excessive
  boundaries, same-page/new-attempt identities, rolling quotas, and both deadlines are executable
  (`test/p1-10-contract.test.ts:5800-6177`;
  `docs/contracts/pr-2e-p1-10-acquisition-state-machine.md:452-533`).
- **Pagination, journal, and restart.** The journal enforces the exact causal chain
  `acquisition.declared -> request.started -> request.succeeded -> artifact.committed ->
  artifact.verified -> normalization -> selection` and exact checkpoint shapes and receipts
  (`test/p1-10-contract.test.ts:1781-2064,2300-2610`). Opaque one-use token binding, loops, gaps,
  duplicate positions, substitution, post-terminal pages, incomplete chains, and conflicting
  delivery bytes reject before selection. Crash/restart covers every declared durable boundary,
  reverifies committed artifacts, never redispatches a committed page, and creates a fresh attempt
  for in-flight uncommitted work (`test/p1-10-contract.test.ts:6229-6366,6401-6492`).
- **Artifact causality, duplicate, correction, and replay.** A live artifact commit can follow only
  request success; body/store/read failures produce the exact terminal cleanup ordering and no
  downstream output. Identical bytes may deduplicate physically while delivery observations remain
  distinct. Conflicting same-delivery bytes and unknown correction semantics quarantine; supported
  revision evidence remains explicit (`test/p1-10-contract.test.ts:6180-6224,6370-6397`).
- **Credentials, redaction, and no-network default.** Non-secret preflight completes before the two
  Alpaca credential names can be read. Missing credentials are a typed pre-dispatch failure and the
  global fetch witness remains zero. Hostile nested values, causes, accessors, proxies, URLs,
  query strings, headers, credential-shaped keys, body text, and library messages reduce to the
  closed safe projection without invoking getters
  (`test/p1-10-contract.test.ts:6495-6540`;
  `docs/contracts/pr-2e-p1-10-credential-privacy-retention.md:49-207`).
- **FMP boundary.** The only documented FMP routes are the two stable aftermarket routes with
  symbol as the sole non-secret query field and `apikey` as the future header boundary. FMP is
  private-discrepancy-only, never primary/fallback/SIP/NBBO, cannot alter Alpaca selection, and is
  excluded from public output. The executable matrix rejects every role/output/route/identity/
  authentication mutation, and the candidate contains no FMP client
  (`test/p1-10-contract.test.ts:1147-1190,6543-6582`;
  `docs/contracts/pr-2e-p1-10-entitlement-identity.md:320-373`).
- **Fixture provenance and inventory.** The fixture manifest declares exact four-file inventory,
  original-project-authored synthetic classification, `providerEvidence=false`, and
  `networkAuthorized=false`; the executable test pins those values and exact inventory
  (`fixtures/market-acquisition/v1/manifest.json:1-22`;
  `test/p1-10-contract.test.ts:4352-4384`). The abstract glyph pages and literal invented authority
  contain no provider payload or structurally transcribed provider example.
- **Determinism and persistence.** Replay is invariant at page sizes 1, 2, 7, and 10,000.
  Memory and SQLite close/reopen from every durable checkpoint with fresh reconstructed state,
  forward/reverse enumeration, restored distinct delivery observations, artifact reverification,
  and byte-equivalent outputs. Repeat runs and provider response order agree, all streams settle,
  and post-return asynchronous activity remains zero
  (`test/p1-10-contract.test.ts:6585-6800`).

## Exact-candidate validation

All validation was offline. No credential was loaded, no account/provider page was inspected, and
no provider request was made.

| Command/check | Independent result |
| --- | --- |
| detached HEAD and clean-status checks | exact candidate; detached; clean before reading and after cleanup |
| `npm.cmd run verify:runtime` | passed; Node 24.17.0 / npm 12.0.0 |
| exact `PEAS_CANDIDATE_SHA` with `npm.cmd run verify:candidate` | passed |
| `npm.cmd run format:check` | passed; 144 files; no fixes |
| `npm.cmd run lint` | passed; 144 files; no fixes |
| `npm.cmd run typecheck` | passed |
| `npm.cmd run build` | passed |
| `node --test --test-concurrency=1 dist/test/p1-10-contract.test.js` | passed; 25/25, 0 skipped, 0 failed; 679,687.5815 ms |
| independent `node:crypto` framed SHA-256 recomputation | 11/11 source IDs, zero-spend ID, 65/65 `imap1_`/`min1_`/`msa1_` triples, and `maac1_` catalog ID matched |
| exact-SHA GitHub Actions run `30179975579` | completed `success`; head SHA matched exactly |
| Ubuntu job `89734784228` | `success`; runtime, clean install, candidate gate, complete check, and evidence passed |
| Windows job `89734784260` | `success`; runtime, clean install, candidate gate, complete Windows check, and evidence passed |
| scale-10k job `89736475207` | `success`; exact candidate scale gate and evidence passed |
| scale-100k / reconcile-release | skipped by the repository release-policy conditions |

The detached validation used the already clean-installed exact-candidate dependency tree through a
temporary local directory junction so no candidate source or lock bytes changed. The junction and
generated build output were removed. Final `git status --short --branch` again returned only
`## HEAD (no branch)`.

The orchestration owner additionally recorded same-SHA local `npm run check` success: 373 total
tests, 367 passed, six policy skips, zero failures; coverage 90.4194% statements, 80.8836%
branches, and 96.2460% functions; P1-10 25/25; evidence reconciliation 31 plus one policy skip;
mutation 39/39; and local 10k 53.084 acquisitions/s, p95 23.7391 ms, p99 46.9766 ms. The
independent focused run and hosted exact-SHA jobs corroborate, rather than assume, that evidence.

## Retention and implementation gate

The accepted `ArtifactStore` exposes store, stat, read, attempt/observation lookup, observation
paging, and reconciliation, but no deletion method
(`src/artifacts/artifact-store.ts:173-185`). Migration 005 installs no-delete triggers across
artifact attempts, outcomes, blobs, install records, observations, incidents, reconciliation
plans/applications, quarantine receipts, and reconciliation receipts
(`migrations/005_artifact_vault.sql:336-378`).

The contract proposes a separate internal maintenance port, additive migration, immediate
use-denial/tombstone state, digest/observation accounting, physical erasure under
`PEAS_RUNTIME_ROOT`, reconciliation semantics, and crash/platform evidence while leaving the
frozen consumer-facing `ArtifactStore` port unchanged
(`docs/contracts/pr-2e-p1-10-credential-privacy-retention.md:288-435`). Those are migration,
maintenance-port, reconciliation, and vault-semantic changes reserved to the human owner.

```text
RETENTION_IMPLEMENTATION_AUTHORIZATION = HUMAN_AUTHORIZATION_REQUIRED / NOT_AUTHORIZED
PR_2F_ENTRY = NO_GO
```

Contract `GO` does not grant retention authority. PR 2F may not begin until the human owner
separately authorizes the exact retention surfaces and semantics and the orchestration owner
acknowledges both the contract checkpoint and retention authorization.

## Binary decision

`CONTRACT_DECISION=GO`

Candidate `9ec0a48266d72ce42f0a815da6ed367d91a06b7b` closes F-006a and F-006b while preserving the
earlier continuation, timestamp, route, time, bound, retry, quota, pagination, cleanup, journal,
credential, redaction, FMP, replay, and persistence closures. The complete offline matrix and
same-SHA Linux, Windows, and 10k evidence are green. There is no unresolved contract-level
security, entitlement, identity, fixture-provenance, redaction, or deterministic-replay finding.

Any contract, fixture, or contract-test byte change after this review invalidates this `GO` and
requires a new exact candidate and fresh independent review.

This decision authorizes no production transport, credential use, provider request, provider
witness, FMP client, retention implementation, merge, P1-06 entry, P2 collection, or outcome
calculation.

## Review-record digest

```text
REPORT_BODY_BYTE_LENGTH = 18537
REPORT_BODY_SHA256 = 804a64da8869b7173c387c7abce5083a1b761d0154b54eba64f2b4b20f38cbf8
```

The digest covers the exact first 18,537 UTF-8 bytes of this file, ending with the newline after
`calculation.` immediately before this digest section. The digest section is excluded to avoid a
self-referential hash.
