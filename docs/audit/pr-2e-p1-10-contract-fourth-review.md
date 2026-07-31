# PR 2E P1-10 fourth independent contract review

```text
REVIEWED_CANDIDATE_SHA = ab245236d4953cde9c90a77fa6eb62143b0b4946
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
  `ab245236d4953cde9c90a77fa6eb62143b0b4946`;
- `git symbolic-ref -q HEAD` and `git branch --show-current` returned no branch, proving detached
  HEAD;
- `git status --short --untracked-files=all` returned no output; and
- the review used the dedicated worktree `pr-2e-fourth-audit-ab24523`, not the integration
  worktree.

I read the frozen P1-09/PR 2D authority chain, the ArtifactStore and migration constraints, the
relevant recorded acquisition, observation-ledger, runtime-root, reconciliation, redaction,
hard-kill, persistence, package, and CI/release-evidence surfaces, every PR 2E candidate file, and
all four immutable prior `NO_GO` reports. P1-09 final `GO` supersedes historical pending prose
only. It does not authorize transport, a provider witness, retention-semantics changes, PR 2F, or
merge.

The candidate diff from base `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` contains only contract,
orchestration, audit, roadmap/board, original synthetic fixture, and contract-test files. It adds
no production source, migration, workflow, dependency, transport, credential loader, provider
client, or FMP production file. Accepted PR 2D and P1-09 authority files are unchanged.

## Independent identity and zero-spend recomputation

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

The candidate preserves the material closure of F-001 through F-004e recorded by the third review.
It also materially improves all three F-005 areas:

- instrument input is typed, bounded, unique, unsigned-UTF-8 ordered, and used as the single source
  of `canonicalSymbols` and `instrumentIds`;
- every integrated live-model page, including restart dispatch, now constructs and preflights an
  actual `fields.page_token`; and
- timestamp parsing requires exact millisecond and nanosecond parse/re-encode equality and rejects
  the supplied impossible-date vectors.

F-005c is closed. F-005a and F-005b are not fully closed for the reasons below.

## Candidate-blocking findings

### F-005a - NOT CLOSED: the executable registry cannot prove effective frozen instrument identity

The normative boundary requires each symbol to resolve to the exact effective frozen alias of one
frozen instrument identity for the entire requested interval and explicitly rejects an ambiguous
effective interval (`docs/contracts/pr-2e-p1-10-entitlement-identity.md:270`,
`284-288`). The repair's `InstrumentMember` contains only `canonicalSymbol` and `instrumentId`;
the registry has no effective-from/effective-to interval, alias-authority record, or instrument
preimage (`test/p1-10-contract.test.ts:87-107`). The validator therefore cannot determine whether
an alias is effective for the whole request or whether two instrument versions overlap the
requested interval (`test/p1-10-contract.test.ts:236-300`).

The apparent instrument IDs are also test-local prefix-shaped values made as
`"min1_" + sha256(canonicalSymbol)` (`test/p1-10-contract.test.ts:88-92`), not recomputed accepted
PR 2D `min1_` identities under `H("peas/market-instrument/v1", instrumentPreimage)`. Freezing the
resulting array in JavaScript does not prove that its members are frozen market-instrument
identities.

The negative vector labeled ambiguous merely pairs one alias with another registry member's ID
(`test/p1-10-contract.test.ts:4181-4186`). It does not create two effective alias mappings whose
intervals overlap the query. The repair also narrows the advertised vector from the normative
“ambiguous effective interval” to “ambiguous-ID”
(`docs/contracts/pr-2e-p1-10-fixture-manifest.md:52-53`;
`docs/contracts/pr-2e-p1-10-acceptance-matrix.md:41`).

Required repair:

1. freeze original-synthetic alias-authority rows containing exact non-overlapping effective
   intervals and complete accepted PR 2D issuer/instrument preimages;
2. recompute each `imap1_`/`min1_` through the accepted domains, with independent literal checks;
3. resolve the complete requested interval to exactly one instrument version per alias; and
4. drive a real gap and overlapping-effective-interval ambiguity through the guarded coordinator
   with every side-effect counter at zero.

The existing blank, duplicate, unmapped, delimiter, order, query-mismatch, 64, and 65 vectors should
remain.

### F-005b - NOT CLOSED: advertised preceding-page binding mutations are not executable

The integrated coordinator's normal path is materially improved: it derives continuation material
from the preceding durable `checkpoint.advanced` row and compares the derived binding hash with the
durable expected hash before preflight (`test/p1-10-contract.test.ts:3150-3189`). Normal run and
restart dispatches call this path before credential/transport counters advance
(`test/p1-10-contract.test.ts:3206-3217`, `3549-3557`).

The closed standalone continuation gate, however, treats `precedingPageVerified` as a
caller-supplied boolean and verifies only a self-consistent binding hash plus request identity,
ordinal, and token relations (`test/p1-10-contract.test.ts:397-417`). A caller can change
`precedingMarketAcquisitionId`, `precedingLogicalPageIdentityHash`,
`precedingArtifactObservationId`, `precedingArtifactDigest`, or
`precedingPageChainHash`, recompute `bindingHash`, retain `precedingPageVerified=true`, and pass
that gate because none of those fields is compared with durable preceding-page evidence there.

This would be caught by the integrated coordinator's separate durable expected-hash comparison,
but the candidate does not drive that hostile request through the integrated run/restart gate. The
negative array covers missing material/field, empty, repeated, cross-query, query substitution, and
4,097 bytes only (`test/p1-10-contract.test.ts:4285-4308`). It contains no next-ordinal mutation or
preceding-binding-field mutation even though the acceptance matrix claims both are guarded
zero-side-effect vectors (`docs/contracts/pr-2e-p1-10-acceptance-matrix.md:53`).

Required repair:

1. make the pre-dispatch admission API receive the actual preceding durable checkpoint or its
   independently verified expected binding, rather than trusting a boolean;
2. compare every preceding-page binding member with that evidence before credential access;
3. inject changed next ordinal and each changed preceding-binding member into both uninterrupted
   run and restart dispatch; and
4. prove each rejection leaves credential, transport construction, DNS/network/provider,
   artifact, normalization, selection, and post-return activity exactly zero.

## Controls that passed

The following controls passed but do not waive the findings:

- all 11 source identities and the zero-spend identity independently recompute;
- exact 15-minute equality passes and one nanosecond newer rejects;
- strict timestamp round-trip checks reject impossible month days, invalid leap dates, and
  represented overflows;
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
| independent framed SHA-256 recomputation | all 11 source IDs and zero-spend ID matched |
| exact-SHA GitHub Actions run `30176899711` | completed `success`; head SHA matched exactly |
| Ubuntu job `89727034561` | `success`; exact candidate check passed |
| Windows job `89727034553` | `success`; exact candidate check passed |
| scale-10k job `89727928752` | `success`; exact candidate scale evidence passed |
| scale-100k / reconcile-release | correctly skipped by policy |

Green execution cannot cure missing effective-interval authority or hostile vectors absent from the
executable boundary.

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

Candidate `ab245236d4953cde9c90a77fa6eb62143b0b4946` has green exact-SHA CI and closes F-005c, but it
does not yet prove effective frozen alias resolution and does not execute the advertised durable
preceding-page binding mutations through uninterrupted and restart dispatch. Any contract, fixture,
or contract-test repair creates a new candidate SHA and requires another fresh independent review.

This decision authorizes no transport code, credential use, provider request, witness, retention
change, merge, P1-06 entry, or P2 work.
