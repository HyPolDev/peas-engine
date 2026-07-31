# PR 2E P1-10 third independent contract review

```text
REVIEWED_CANDIDATE_SHA = d4108a9aa1c4f2166aca5ccb0234408bf0ab6678
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
  `d4108a9aa1c4f2166aca5ccb0234408bf0ab6678`;
- `git branch --show-current` returned no branch, proving detached HEAD;
- `git status --short --untracked-files=all` returned no output; and
- the review used the dedicated detached worktree `pr-2e-third-audit-d4108a9`, not the integration
  worktree.

I read the frozen P1-09/PR 2D authority chain, the ArtifactStore and migration constraints, the
relevant recorded acquisition, observation-ledger, runtime-root, reconciliation, redaction,
hard-kill, persistence, package, and CI/release-evidence surfaces, every PR 2E candidate file, and
all three immutable prior `NO_GO` reports. P1-09 final `GO` supersedes historical pending prose
only. It does not authorize transport, a provider witness, retention-semantics changes, PR 2F, or
merge.

The candidate diff from base `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` contains only contract,
orchestration, audit, roadmap/board, original synthetic fixture, and contract-test files. It adds no
production source, migration, workflow, dependency, transport, credential loader, provider client,
or FMP production file. Accepted PR 2D and P1-09 authority files are unchanged.

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

The candidate materially closes the earlier reports' findings:

- F-001 and F-002: page-limit grammar/configuration binding and zero-spend identity/decision are
  executable through guarded rejection paths.
- F-003: the controlled multi-member channel vector now reverses the same two members without
  changing membership.
- F-004a: retry classification, exact deterministic delays, 429 classification, deadline, and
  quota proof are integrated into the event API.
- F-004b: request/configuration/page/attempt/acquisition/journal identities, exact journal-entry
  framing, ADR-0009 causal parents, and verified-page budget admission use the normative domains and
  preimages.
- F-004c through F-004e: the model owns current state, drives a three-page chain, preserves
  distinct delivery observations with physical digest deduplication, restarts every durable prefix,
  and executes memory/SQLite close-reopen equivalence.

Those repairs are real and were re-audited. They do not waive the new request-boundary findings
below.

## Candidate-blocking findings

### F-005a - instrument membership is not validated and identity membership can disagree

The contract requires one through 64 sorted, unique, effective frozen aliases, rejects blank,
duplicate, unmapped, ambiguous, delimiter-injected, and one-over sets before credential loading,
and binds the corresponding instrument identities
(`docs/contracts/pr-2e-p1-10-entitlement-identity.md:268-288`;
`docs/contracts/pr-2e-p1-10-acquisition-state-machine.md:49-63`).

The executable `preflight` only checks that a `symbols` key exists
(`test/p1-10-contract.test.ts:241-251`). It never parses or validates membership, uniqueness,
canonical ordering, empty members, alias resolution, delimiter injection, or the 64-instrument
ceiling. The sole 64/65 assertion calls a detached count-only helper
(`test/p1-10-contract.test.ts:2067-2069`, `4022-4023`), so it cannot prove the guarded request
boundary.

The resulting identity can also be internally inconsistent. `requestIdentityPreimage` splits and
sorts the caller's unchecked `symbols` string but always binds the two hard-coded baseline
`INSTRUMENT_IDS` (`test/p1-10-contract.test.ts:589-600`). A changed or malformed symbol set can
therefore pass preflight while its `canonicalSymbols` and `instrumentIds` describe different
members.

This defeats the closed allowlist, the exact-limit/one-over register, stable request identity, and
zero-call rejection proof.

Required repair:

1. accept a typed bounded instrument set rather than a free-form caller string;
2. resolve every member to one frozen instrument identity and effective alias;
3. enforce nonempty, unique, canonical unsigned-UTF-8 order and the 64-member ceiling;
4. derive both `instrumentIds` and `canonicalSymbols` from that same validated membership; and
5. drive blank, duplicate, unmapped, ambiguous, injected, reordered, 64, and 65-member vectors
   through the same guarded coordinator with every side-effect counter at zero on rejection.

### F-005b - later-page preflight does not require or bind `page_token`

The contract permits `page_token` only after page zero and requires it to be byte-identical opaque
material returned by the immediately preceding verified page
(`docs/contracts/pr-2e-p1-10-entitlement-identity.md:268-282`;
`docs/contracts/pr-2e-p1-10-acceptance-matrix.md:43-46`).

The executable boundary merely adds `page_token` to an allowed-key set and checks a separate
`pageMaterialBytes` number (`test/p1-10-contract.test.ts:246-274`). It does not require the field on
a continuation request, reject a field/material mismatch, compare raw opaque bytes with the
preceding verified checkpoint, or prove that the actual HTTP query field is bound to that material.
Its positive later-page test explicitly succeeds with `firstRequest=false` and
`pageMaterialBytes=4096` while the request contains no `page_token`
(`test/p1-10-contract.test.ts:3966-3971`).

The integrated three-page run does not compensate. It invokes `guardedPreflight` once before page
zero and then advances later pages only through journal-state events
(`test/p1-10-contract.test.ts:2946-2964`, `3083-3106`). Its private token-chain proof is valuable,
but no later-page typed request/query boundary is constructed and validated.

Required repair:

1. make continuation material an exact typed field of each later logical request;
2. require absence on page zero and exact presence thereafter;
3. bind the byte-for-byte material and its private hash to the immediately preceding verified page,
   unchanged request identity, next ordinal, and actual `page_token` query field;
4. run missing, empty, repeated, cross-query, substituted, 4,096-byte, and 4,097-byte vectors
   through the same integrated pre-dispatch gate; and
5. prove every rejected vector performs zero credential, transport-construction, DNS, network,
   provider, artifact, normalization, selection, and post-return activity.

### F-005c - timestamp grammar accepts non-round-tripping calendar instants

The contract requires exact UTC epoch nanoseconds whose HTTP representation deterministically
round-trips without loss and explicitly rejects overflow or a different round-trip value
(`docs/contracts/pr-2e-p1-10-entitlement-identity.md:290-294`;
`docs/contracts/pr-2e-p1-10-acceptance-matrix.md:36-37`).

`parseCanonicalNs` checks only a lexical nine-digit pattern and finite `Date.parse`
(`test/p1-10-contract.test.ts:192-199`). It never re-encodes and compares the parsed calendar
instant. Node normalizes syntactically matching impossible dates: the independent audit probe
showed `2026-02-30T00:00:00.000Z` becoming `2026-03-02T00:00:00.000Z` and
`2026-04-31T00:00:00.000Z` becoming `2026-05-01T00:00:00.000Z`. An old-enough impossible date can
therefore satisfy the history boundary and be accepted as a different instant.

Required repair: use a strict calendar parser or exact parse-and-re-encode equality, then add
zero-call vectors for impossible month days, invalid leap days, overflow, and every representation
whose parsed instant differs from its input.

## Controls that passed

The following controls passed but do not waive F-005:

- exact 15-minute equality is accepted and one nanosecond newer is rejected;
- the fixed Alpaca origin, routes, channel identities, `feed=sip`, `sort=asc`, and `1Min/raw` bars
  remain closed;
- retry, quota, deadlines, cleanup, causal journal order, acyclic page-chain admission, three-page
  restart, replay-size invariance, and memory/SQLite equivalence execute successfully;
- FMP remains private-discrepancy-only, excluded from first-wave production transport, unable to
  become primary/fallback, and excluded from public output;
- the candidate adds no production transport, credential-loading code, migration, or FMP client;
  and
- roadmap/board status keeps P1-10 in progress and P1-06/P2 blocked.

## Validation on the exact candidate

| Command/check | Independent result |
| --- | --- |
| detached HEAD and clean-status checks | exact candidate; detached; clean before audit |
| `npm.cmd run verify:runtime` | passed; Node 24.17.0 / npm 12.0.0 |
| `npm.cmd ci` | passed; 54 packages installed |
| `npm.cmd run verify:candidate` | passed; exact candidate reported |
| `npm.cmd run build` | passed |
| `node --test --test-concurrency=1 dist/test/p1-10-contract.test.js` | passed; 22/22 |
| independent framed SHA-256 recomputation | all 11 source IDs and zero-spend ID matched |
| first local `npm.cmd run check` attempt | reached coverage after format, lint, typecheck, and hard-kill passed; 120-second audit-shell timeout |
| second local `npm.cmd run check` attempt | progressed through the full test/coverage body; 600-second audit-shell timeout before the script returned |
| exact-SHA GitHub Actions run `30175323904` | completed `success`; head SHA matched exactly |
| Ubuntu job `89723054260` | `success`; runtime, install, candidate, check, and evidence steps passed |
| Windows job `89723054283` | `success`; runtime, install, candidate, check, and evidence steps passed |
| scale-10k job `89723969670` | `success`; exact-SHA candidate and `test:scale` passed |
| scale-100k / reconcile-release | correctly skipped by policy |

The local audit-shell timeouts are not classified as candidate test failures because the same-SHA
hosted jobs reached terminal success. Green execution cannot cure acceptance tests that admit
request shapes forbidden by their normative contract.

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

This review cannot grant that authority. Even if F-005 were repaired and a later exact candidate
received independent contract `GO`, PR 2F could not begin until the human owner separately
authorizes the exact retention architecture and the orchestration owner acknowledges both
checkpoints.

## Binary decision

`CONTRACT_DECISION=NO_GO`

The candidate has green exact-SHA CI and closes the earlier journal/state/restart findings, but its
executable preflight boundary does not enforce the frozen instrument set, does not bind an actual
later-page `page_token`, and accepts non-round-tripping calendar timestamps. Any contract,
fixture, or contract-test repair creates a new candidate SHA and requires another fresh independent
review. This decision authorizes no transport code, credential use, provider request, witness,
retention change, merge, P1-06 entry, or P2 work.
