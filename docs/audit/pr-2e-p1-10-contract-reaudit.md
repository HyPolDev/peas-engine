# PR 2E P1-10 independent contract re-audit

```text
REVIEWED_CANDIDATE_SHA = 8cc8c8424d0498fd2c5486d37b7eb42df5991b2c
CONTRACT_DECISION = NO_GO
RETENTION_IMPLEMENTATION_AUTHORIZATION = HUMAN_AUTHORIZATION_REQUIRED / NOT_AUTHORIZED
PR_2F_ENTRY = NO_GO
PROVIDER_WITNESS = NOT_AUTHORIZED
MERGE = NOT_AUTHORIZED
```

## Review identity and isolation

This is a fresh independent re-audit. The reviewer authored none of the contract, fixture, test,
repair, board, roadmap, orchestration, or initial-audit package and edited only this new re-audit
record.

Before review:

- `git rev-parse HEAD` returned
  `8cc8c8424d0498fd2c5486d37b7eb42df5991b2c`;
- `git status --short --branch` returned only `## HEAD (no branch)`;
- the reviewed worktree was the dedicated detached worktree
  `pr-2e-reaudit-8cc8c84`; and
- the integration worktree and branch were not used for review edits.

I read the complete P1-09/PR 2D authority chain, the ArtifactStore and migration constraints, the
relevant recorded acquisition, observation-ledger, runtime-root, reconciliation, redaction,
hard-kill, persistence, package, and CI/release-evidence surfaces, every PR 2E candidate file, and
the immutable initial `NO_GO` audit. P1-09's final accepted `GO` supersedes historical pending prose
only. It does not authorize transport, a provider witness, retention-semantics changes, PR 2F, or
merge.

The candidate diff from base `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` contains contract,
orchestration, audit, roadmap/board, original synthetic fixture, and contract-test files only. It
adds no production source, migration, workflow, dependency, transport, credential loader, provider
client, or FMP production file. Accepted PR 2D and P1-09 authority files are unchanged. I found no
query-bearing provider URL, credential, raw page token, provider payload, or provider-derived
fixture bytes in the candidate package.

## Independent identity recomputation

I independently implemented canonical recursive key ordering and
`uint64be(length) || bytes` framing with SHA-256 using only `node:crypto`. The computation did not
import repository identity or canonical-hash functions and did not access credentials or the
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

The same independent implementation reproduced the exact zero-spend policy identity:

`mzp1_b2f575e234dcd7f05eb5fcc03060420313b56e45aff87c961c3771d1c5cf3b9e`.

## Initial-finding disposition

### F-001 — CLOSED

The repaired preflight accepts only canonical decimal integers from 1 through 10,000 inclusive and
rejects zero, 10,001, signs, whitespace, leading zero, decimal, exponent, and non-number spellings
(`test/p1-10-contract.test.ts:217-227`, `1368-1387`). Limits 1, 2, 7, and 10,000 retain one stable
logical request identity, produce four private configuration hashes, and a changed page limit is
rejected on restart (`test/p1-10-contract.test.ts:1368-1419`). The acceptance documents now agree
(`docs/contracts/pr-2e-p1-10-acceptance-matrix.md:35-38`).

### F-002 — CLOSED

The executable model contains the exact zero-spend preimage and ID
(`test/p1-10-contract.test.ts:64-77`), recomputes the ID, binds the ID and run decision into the
private configuration hash, and rejects missing, forged, mutated, absent, rejecting, stale, and
unknown values with every declared side-effect counter at zero
(`test/p1-10-contract.test.ts:191-201`, `492-498`, `1288-1315`).

### F-003 — NOT CLOSED

The repair adds a four-row identity-family table and all named mutation labels, but it does not
execute the required closed configuration gate over all frozen source identities and downstream
side-effect surfaces.

The table contains only one Alpaca provider, dataset, feed, and quote-channel exemplar
(`test/p1-10-contract.test.ts:509-557`). It does not apply the mutation classes to the second
provider, second dataset, second feed, the other two Alpaca channels, or either FMP channel. More
importantly, its `orderedCapabilities` member is an audit-only envelope field, not a member of any
frozen provider/dataset/feed/channel preimage (`test/p1-10-contract.test.ts:501-507`, `559-567`).
Reversing that invented field therefore does not prove rejection of a reordered set-like field in
the actual identity/configuration boundary.

The counter proof is also disconnected from the acquisition gate. After direct identity
validation, the test increments only `credentialReads`; transport construction, DNS, network,
provider, artifact, normalization, selection, and post-return counters have no reachable increment
site in this wrapper (`test/p1-10-contract.test.ts:1357-1364`). Their zero values are initialized
outcomes rather than observations of the integrated guarded acquisition model. This does not
satisfy the exact all-counter proof required by
`docs/contracts/pr-2e-p1-10-entitlement-identity.md:515-527` and `562-583`.

Required remediation:

1. Run every named hostile mutation class through the closed acquisition/configuration parser for
   every frozen identity instance, or provide a demonstrably exhaustive family abstraction whose
   members are the real frozen preimages and whose set-like member is part of the real schema.
2. Drive each rejection through the same guarded model that owns credential, transport, DNS,
   network/provider, artifact, normalization, selection, and post-return instrumentation.
3. Assert the exact section-8 counter projection for every row, including FMP identities and route
   roles.

### F-004 — NOT CLOSED

The repair creates useful provider/body/artifact/journal doubles, but the executable behavior still
contradicts and omits mandatory state, retry, checkpoint, and restart rules.

#### F-004a — unclassified 429 and Retry-After behavior is wrong

The contract permits a `429` retry only when a closed sanitized classification explicitly proves
temporary throttling without quota exhaustion; missing or ambiguous quota status is terminal
(`docs/contracts/pr-2e-p1-10-acquisition-state-machine.md:334-338`). The executable function has no
such classification and returns a retry for plain `http-429` whenever its generic
`quotaRemaining` boolean is true (`test/p1-10-contract.test.ts:288-311`). The test explicitly
expects an unclassified `429` with a missing header to retry
(`test/p1-10-contract.test.ts:1612-1615`).

The contract also requires waiting `max(projectDelay, retryAfterMs)` for a valid header
(`docs/contracts/pr-2e-p1-10-acquisition-state-machine.md:352-367`). The model merely validates the
header and still returns `retry-1000` or `retry-2000`; its exact 30-second case expects
`retry-1000` (`test/p1-10-contract.test.ts:306-311`, `1631-1634`). Thus a passing test proves a
shorter wait than the contract permits.

#### F-004b — the checkpoint is not the exact closed checkpoint

The contract requires every checkpoint to contain exactly the fields at
`docs/contracts/pr-2e-p1-10-artifact-replay.md:278-327`, including journal/acquisition observation
identities, admitted acquisition IDs, logical-page and attempt identities, checkpoint kind,
current/next resumable material, artifact size/hash/content/raw IDs, ledger causality, per-page
counts, page-chain hash, deadline and rolling-quota evidence, terminal reason, prior-entry hash,
sequence, and entry hash.

The executable `DurableCheckpoint` contains only a reduced subset
(`test/p1-10-contract.test.ts:605-623`), renames `acquisitionConfigurationHash` to
`configurationHash`, and has no exact-shape/unknown-field validator, canonical journal-entry hash
chain, causal-parent validation, or cumulative-budget reconciliation from immutable receipts. The
test title calling this checkpoint “complete” therefore does not match the normative schema.

#### F-004c — restart does not reverify committed artifacts as required

The contract requires re-verification before use after restart; after an
`artifact-verified` receipt it must reverify and append only the missing page checkpoint, and an
interrupted normalization must reverify the complete chain and restart normalization
(`docs/contracts/pr-2e-p1-10-artifact-replay.md:403-405`, `596-634`, `650-659`).

The resume model skips `artifact.read` whenever any prior `artifact.verified` row exists and skips
normalization whenever any prior `normalization.emitted` row exists
(`test/p1-10-contract.test.ts:1092-1115`). The `during-normalization` crash is injected only after
the normalized-fact counter, selection digest, and `normalization.emitted` row already exist
(`test/p1-10-contract.test.ts:1033-1043`). It therefore does not model a crash during
normalization and does not prove canonical normalization restart.

#### F-004d — SQLite equivalence is not exercised at every durable checkpoint

The contract requires SQLite close/reopen at every durable checkpoint and comparison with a fresh
memory reconstruction, with response, artifact, duplicate-delivery, replay-page, and backend-page
permutations (`docs/contracts/pr-2e-p1-10-artifact-replay.md:705-724`). The crash matrix uses only
the memory journal (`test/p1-10-contract.test.ts:1818-1887`). The SQLite test closes/reopens at only
`artifact-committed`, retains the same in-memory provider and artifact objects across the simulated
restart, and compares only the eventual final rows (`test/p1-10-contract.test.ts:1989-2035`).

It does not close/reopen SQLite at acquisition declaration, request start/success, artifact
verification, page checkpoint, normalization, or terminal selection; does not reconstruct the
artifact/store from durable evidence; and does not compare restart decisions at every checkpoint.

Required remediation:

1. Give `429` a closed sanitized quota classification and stop on missing, ambiguous, or
   quota-exhausted classifications; compute and assert the exact effective delay including 30,000
   ms.
2. Implement the exact closed checkpoint body, exact-shape rejection, sequence and canonical
   hash-chain validation, causal-parent checks, and reconciliation of cached cumulative values
   against immutable receipts.
3. Drive the actual contract state set and every legal/illegal transition, rather than a reduced
   event list.
4. Reverify every committed artifact required by the restart algorithm, model a real interruption
   before normalization completion, and prove no verified page is redispatched.
5. Close and reopen real SQLite independently at every durable checkpoint, reconstruct fresh
   memory/provider/artifact state from durable evidence, and compare the complete checkpoint,
   restart decision, counters, normalized facts, and selection under all required permutations.

## Other controls

The following controls passed review and do not waive the findings:

- the trusted request-start equality boundary passes and one nanosecond newer rejects;
- the fixed Alpaca routes, multi-symbol paths, `feed=sip`, `sort=asc`, `1Min/raw` bar values,
  no-fallback role, and source IDs remain closed in the documents;
- FMP remains private-discrepancy-only, excluded from the first PR 2F transport wave, unable to
  become primary/fallback, and excluded from public output;
- provider/body failures use synthetic doubles and the exercised body-failure cases settle their
  modeled resources;
- the candidate adds no production transport or credential-loading code; and
- roadmap/board status keeps P1-10 in progress and P1-06/P2 blocked.

## Validation on the exact candidate

| Command/check | Independent result |
| --- | --- |
| detached HEAD and clean-status checks | exact candidate, detached, clean before audit |
| `npm.cmd run verify:runtime` | passed; Node 24.17.0 / npm 12.0.0 |
| `npm.cmd ci --no-fund --no-audit` | passed; 54 packages installed |
| `PEAS_CANDIDATE_SHA=8cc8c8424d0498fd2c5486d37b7eb42df5991b2c npm.cmd run verify:candidate` | passed |
| `npm.cmd run format:check` | passed; 143 files |
| `npm.cmd run lint` | passed; 143 files |
| `npm.cmd run typecheck` | passed |
| `npm.cmd run build` | passed |
| `node --test --test-reporter=spec dist/test/p1-10-contract.test.js` | passed; 21/21 |
| independent framed SHA-256 recomputation | all 11 source IDs and zero-spend ID matched |
| candidate inventory and leak scan | contract-only scope; no prohibited material found |
| same-SHA GitHub PR inspection | draft PR head matched; Ubuntu passed; Windows was still in progress at observation |

Green execution of the current suite cannot cure the semantic contradictions and missing
executable evidence above.

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

This re-audit cannot grant that authority. Even after a later exact contract candidate receives an
independent `GO`, PR 2F may not begin until the human owner separately authorizes the exact
retention surfaces and semantics and the orchestration owner acknowledges both gates.

## Binary decision

`CONTRACT_DECISION=NO_GO` for
`8cc8c8424d0498fd2c5486d37b7eb42df5991b2c`.

The next repair must produce a new candidate SHA and a new fresh independent review. This report and
the initial audit are immutable evidence; neither may be rewritten into `GO`.

This decision does not authorize a provider call, Alpaca or FMP witness, transport implementation,
PR 2F entry, retention implementation, merge, P2 collection, or outcome calculation.
