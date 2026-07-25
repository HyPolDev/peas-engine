# PR 2E P1-10 fifth independent contract review

```text
REVIEWED_CANDIDATE_SHA = 00d8d90232e18342ed401f415e085ecb911319a2
CONTRACT_DECISION = NO_GO
RETENTION_IMPLEMENTATION_AUTHORIZATION = HUMAN_AUTHORIZATION_REQUIRED / NOT_AUTHORIZED
PR_2F_ENTRY = NO_GO
PROVIDER_WITNESS = NOT_AUTHORIZED
MERGE = NOT_AUTHORIZED
```

## Review identity and isolation

This is a fresh independent review. The reviewer authored none of the contract, fixture, test,
repair, board, roadmap, orchestration, or prior-audit package and edited only this new review
record.

Before review:

- `git rev-parse HEAD` returned
  `00d8d90232e18342ed401f415e085ecb911319a2`;
- `git status --short --branch` returned only `## HEAD (no branch)`, proving both detached HEAD and
  a clean worktree; and
- the review used the dedicated worktree `pr-2e-fifth-audit-00d8d90`, not the integration
  worktree.

I read the frozen P1-09/PR 2D authority chain, every PR 2E contract and original-synthetic fixture,
the complete executable contract model, and all five immutable prior `NO_GO` reports. P1-09 final
`GO` supersedes historical pending prose only. It does not authorize transport, a provider
witness, retention-semantics changes, PR 2F, or merge.

The candidate diff from base `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` contains only contract,
orchestration, audit, roadmap/board, original-synthetic fixture, and contract-test files. It adds
no production source, migration, workflow, dependency, transport, credential loader, provider
client, or FMP production file. Accepted PR 2D and P1-09 authority files are unchanged.

## Independent source-identity and zero-spend recomputation

I independently implemented recursive canonical JSON key ordering and exact
`uint64be(length) || bytes` framing with SHA-256 using only `node:crypto`. The computation imported
no repository canonicalizer, hash helper, or identity function and accessed neither credentials nor
network. All 11 frozen identities matched:

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

The same independent implementation reproduced the exact zero-spend identity:

`mzp1_b2f575e234dcd7f05eb5fcc03060420313b56e45aff87c961c3771d1c5cf3b9e`.

## Prior-finding disposition

The candidate preserves the material closures of F-001 through F-004e recorded by the third
review. The fifth repair also materially closes the fourth review's continuation defect:

- continuation admission receives the actual preceding durable checkpoint, not a caller boolean;
- the actual `fields.page_token`, raw material, private token hash, request identity, next ordinal,
  all preceding-page members, recomputed binding hash, and stored expected binding hash are compared
  before counters advance (`test/p1-10-contract.test.ts:653-713`);
- uninterrupted dispatch retrieves the preceding `checkpoint.advanced` row and uses the same
  admission API (`test/p1-10-contract.test.ts:3456-3525`);
- restart first validates the complete journal and then uses the same admission API
  (`test/p1-10-contract.test.ts:3758-3875`); and
- self-consistently rehashed next-ordinal, token-relation, request-identity, and every listed
  predecessor-member mutation execute through standalone, uninterrupted, and restart paths with
  zero rejected-logical-dispatch counter delta
  (`test/p1-10-contract.test.ts:4671-4827`).

F-005b is closed. F-005c remains closed: canonical timestamps require exact millisecond and
nanosecond parse/re-encode equality (`test/p1-10-contract.test.ts:560-574`) and the guarded vectors
reject impossible month days, invalid leap days, overflow, and normalized-but-different instants
(`test/p1-10-contract.test.ts:4840-4867`).

F-005a is improved but not closed because the advertised frozen authority and hostile-authority
proof are not executable as claimed.

## Candidate-blocking findings

### F-006a - no literal root freezes the synthetic alias authority

The repaired acceptance documents advertise complete original-synthetic issuer, instrument, and
symbol-alias preimages with **displayed** `imap1_`, `min1_`, and `msa1_` identities and independent
framed-hash equality (`docs/contracts/pr-2e-p1-10-acceptance-matrix.md:40`;
`docs/contracts/pr-2e-p1-10-fixture-manifest.md:52-56`). The fourth review required independently
checked literal identities so that the accepted alias authority, rather than an algorithmically
self-consistent replacement, is frozen.

The executable package contains no literal synthetic `imap1_`, `min1_`, or `msa1_` value.
`syntheticAliasAuthorityRecord` derives each value and compares it only with a second derivation
from the same runtime preimage (`test/p1-10-contract.test.ts:134-205`). The registry is then
generated from that function at module load (`test/p1-10-contract.test.ts:217-227`). Therefore a
change to an authority preimage and both derivation outputs can remain green; no accepted byte
literal anchors the asserted frozen membership.

As a direct independent probe, the first `GA` row under the candidate's displayed preimages
recomputes to:

```text
imap1_f31410cd268dff7928dc29df37d1dde373bad5c56e3cbaeceaa700cc29482a0f
min1_3b467b21098f87d8080d2ead6b24e22d24a5b995dfb7b107cf197efe806ef800
msa1_d53850b61421a9f7dfebcef3b4d2b4aeca4bd5b45630a5e2ce55e59ea4651f98
```

None of those literals appears in the candidate. Green equality between repository and
test-local derivations does not supply the missing golden authority.

Required repair:

1. freeze an explicit original-synthetic authority catalog containing complete preimages and
   displayed literal `imap1_`, `min1_`, and `msa1_` values;
2. independently recompute and byte-compare every displayed literal before resolution;
3. bind the exact catalog identity or immutable literal rows into the closed configuration so a
   replacement catalog cannot self-authorize; and
4. mutate each preimage and each displayed ID independently through the guarded zero-side-effect
   boundary.

### F-006b - shallow-frozen authority arrays can bypass validation through the cache

The validator caches every supplied authority array for which only `Object.isFrozen(array)` is
true (`test/p1-10-contract.test.ts:467-475`). It does not require that the array is the one exact
frozen catalog, does not deep-freeze or snapshot every row and nested preimage, and does not bind a
validated catalog digest. The public test-model seam accepts arbitrary `authorityRecords`
(`test/p1-10-contract.test.ts:445-447`, `576-580`, `992-1008`).

Consequently, an outer-frozen array containing mutable rows can pass validation once, enter
`VALIDATED_ALIAS_AUTHORITIES`, and then have a row, identity, linkage, authority, or nested preimage
changed. A later call skips `validateAliasAuthorityRecord` entirely and resolves membership from
the mutated row. This defeats the candidate's claimed fail-closed frozen-authority proof. The
existing gap and overlap arrays are not frozen, so they do not exercise this cache path
(`test/p1-10-contract.test.ts:4534-4560`).

Required repair:

1. remove the generic shallow-freeze cache, or cache only one exact module-owned, recursively
   immutable catalog whose canonical digest and literal IDs were validated;
2. snapshot and validate all external/hostile authority input on every use if a test seam remains;
3. add a frozen-outer/mutable-inner mutation vector before and after first admission; and
4. prove changed row, preimage, interval, linkage, and displayed ID each reject through the guarded
   coordinator with every side-effect counter exactly zero.

## Controls that passed

The following controls passed but do not waive F-006:

- all 11 frozen source identities and the zero-spend identity independently recompute;
- exact 15-minute equality passes and one nanosecond newer rejects;
- inclusive/exclusive issuer, instrument, and alias interval containment, one whole-query effective
  version, a genuine gap, a genuine overlapping ambiguity, and exact 64/65 membership bounds
  execute successfully for the supplied catalog;
- the fixed Alpaca origin, routes, channel identities, `feed=sip`, `sort=asc`, and `1Min/raw` bars
  remain closed;
- retry, quota, deadlines, cleanup, causal journal order, page-chain admission, three-page restart,
  replay-size invariance, and memory/SQLite equivalence execute successfully;
- FMP remains private-discrepancy-only, excluded from first-wave production transport, unable to
  become primary/fallback, and excluded from public output;
- the candidate adds no production transport, credential-loading code, migration, or FMP client;
  and
- roadmap/board status keeps P1-10 in progress and P1-06/P2 blocked.

## Validation on the exact candidate

| Command/check | Independent result |
| --- | --- |
| detached HEAD and clean-status checks | exact candidate; detached; clean before and after validation |
| `npm.cmd run verify:runtime` | passed; Node 24.17.0 / npm 12.0.0 |
| `npm.cmd ci --no-fund --no-audit` | passed; 54 packages installed |
| exact `PEAS_CANDIDATE_SHA` with `npm.cmd run verify:candidate` | passed |
| `npm.cmd run format:check` | passed; 143 files |
| `npm.cmd run lint` | passed; 143 files |
| `npm.cmd run typecheck` | passed |
| `npm.cmd run build` | passed |
| `node --test --test-concurrency=1 --test-reporter=spec dist/test/p1-10-contract.test.js` | passed; 23/23 |
| fresh `node:crypto` framed SHA-256 recomputation | all 11 source IDs and zero-spend ID matched |
| exact-SHA GitHub Actions run `30178426969` | completed `success`; head SHA matched exactly |
| Ubuntu job `89730909366` | `success`; exact candidate check passed |
| Windows job `89730909358` | `success`; exact candidate check passed |
| scale-10k job `89731768028` | `success`; exact candidate scale evidence passed |
| scale-100k / reconcile-release | correctly skipped by policy |

Green execution cannot cure an authority catalog that lacks literal roots and can bypass validation
after a shallow-frozen cache admission.

## Retention and gate disposition

The current `ArtifactStore` has no deletion API and migration 005 installs no-delete triggers. The
proposed retention architecture still requires a new maintenance port, additive migration,
physical erasure/tombstone and use-denial semantics, changed read/stat and reconciliation behavior,
and new persistence, hard-kill, and platform evidence. Those changes remain reserved to the human
owner.

```text
RETENTION_IMPLEMENTATION_AUTHORIZATION = HUMAN_AUTHORIZATION_REQUIRED / NOT_AUTHORIZED
PR_2F_ENTRY = NO_GO
```

This review cannot grant that authority. Even after a later exact contract candidate receives an
independent `GO`, PR 2F may not begin until the human owner separately authorizes the exact
retention surfaces and semantics and the orchestration owner acknowledges both gates.

## Binary decision

`CONTRACT_DECISION=NO_GO`

Candidate `00d8d90232e18342ed401f415e085ecb911319a2` has green exact-SHA CI and closes the fourth
review's durable-continuation finding, but it does not freeze literal original-synthetic alias
authority identities and its shallow-freeze cache permits validation bypass. Any contract,
fixture, or contract-test repair creates a new candidate SHA and requires another fresh independent
review.

This decision authorizes no transport code, credential use, provider request, witness, retention
change, merge, P1-06 entry, or P2 work.
