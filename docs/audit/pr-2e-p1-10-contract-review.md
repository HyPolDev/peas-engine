# PR 2E P1-10 independent contract review

```text
REVIEWED_CANDIDATE_SHA = 72164f8d15ff073325232c652ec33ea6573e40de
CONTRACT_DECISION = NO_GO
RETENTION_IMPLEMENTATION_AUTHORIZATION = HUMAN_AUTHORIZATION_REQUIRED / NOT_AUTHORIZED
PR_2F_ENTRY = NO_GO
PROVIDER_WITNESS = NOT_AUTHORIZED
MERGE = NOT_AUTHORIZED
```

## Review identity and isolation

This is a fresh, read-only contract audit. The reviewer authored none of the reviewed contract,
fixture, test, roadmap, or board package and edited only this audit record.

Before review:

- `git rev-parse HEAD` returned
  `72164f8d15ff073325232c652ec33ea6573e40de`;
- `git symbolic-ref -q --short HEAD` returned no branch, proving detached HEAD;
- `git status --porcelain=v1` returned no output; and
- the reviewed worktree was the dedicated audit worktree
  `pr-2e-audit-72164f8`, not the integration worktree.

The candidate diff from base `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` contains only six
new contract documents, the orchestration document, roadmap/board status changes, three original
synthetic fixture files, and `test/p1-10-contract.test.ts`. It adds no production source,
migration, workflow, dependency, transport, credential reader, provider client, or FMP production
file. I found no provider payload or raw provider byte in the fixture corpus.

I read the frozen P1-09/PR 2D authority chain, the relevant ArtifactStore, migration, observation
ledger, runtime-root, reconciliation, package/workflow surfaces, and every candidate file. The
P1-09 final `GO` at `36dcf92b465fc5708614718b4312631fb5dbf544` supersedes historical pending
status only; it does not authorize transport, a witness, retention-semantics changes, PR 2F, or
merge.

## Independent identity recomputation

I independently implemented RFC-8785-compatible key ordering for these inert preimages, the exact
`uint64be(length) || bytes` framing, and SHA-256 using only `node:crypto`. The computation did not
import repository identity functions, access a credential, or make a network call. All 11 literal
results matched the P1-09 values:

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

The same independent computation also reproduced the proposed zero-spend policy ID:

`mzp1_b2f575e234dcd7f05eb5fcc03060420313b56e45aff87c961c3771d1c5cf3b9e`.

The focused candidate test imported the accepted repository derivation functions and matched all
11 source identities, providing a separate repository-function comparison. The defects below do
not concern the literal source identity values.

## Findings

### F-001 — P0 — The executable request contract rejects authorized bounded page limits

The normative entitlement contract permits a canonical `limit` from 1 through 10,000
(`docs/contracts/pr-2e-p1-10-entitlement-identity.md:266-274`), and the state-machine contract calls
10,000 a ceiling (`docs/contracts/pr-2e-p1-10-acquisition-state-machine.md:87-105`). The acceptance
matrix instead accepts only `limit=10000` and says every other limit rejects
(`docs/contracts/pr-2e-p1-10-acceptance-matrix.md:35-36`). The executable preflight implements that
narrowing with exact string equality and rejects `1`, `2`, and `7`
(`test/p1-10-contract.test.ts:178-184`).

This is not a harmless test omission. It makes valid, lower bounded requests structurally
unrepresentable, contradicts the candidate's own page-layout/configuration separation, and would
reject the separately frozen optional witness limit of 1. It also means the replay assertions at
page sizes 1, 2, 7, and 10,000 do not exercise the request preflight they claim to cover.

Required remediation: choose the already-authorized closed integer range 1 through 10,000,
make every contract document consistent, parse it canonically without coercion, add lower/exact/
one-over vectors, and exercise preflight plus configuration/restart identity at 1, 2, 7, and
10,000. Any alternative narrowing is a contract change requiring explicit authority.

### F-002 — P0 — The required zero-spend policy identity is absent from the executable gate

The entitlement contract freezes an exact zero-spend policy preimage and ID, requires a run
decision to carry and validate that ID, and explicitly requires the integrated executable suite to
recompute it (`docs/contracts/pr-2e-p1-10-entitlement-identity.md:406-453`). The executable
`Preflight` model has only a boolean and a two-value cost-status field
(`test/p1-10-contract.test.ts:77-84`); the test file contains no `mzp1_` literal,
`zeroSpendPolicyId`, policy preimage, or policy-version validation. Its negative coverage merely
flips the boolean or sets cost status to unknown (`test/p1-10-contract.test.ts:590-603` and
`632-655`).

Consequently, the passing suite does not prove that a forged, missing, stale, or changed policy ID
fails before credential access, even though the contract makes that proof part of the structural
zero-spend boundary. A caller-controlled boolean is not the frozen policy proof.

Required remediation: add the exact closed policy preimage/ID to the executable model,
independently derive it in the test, bind it into the private configuration hash and run decision,
and prove missing, forged, one-field-mutated, stale, and unknown policy values produce zero
credential/transport/artifact calls.

### F-003 — P0 — The identity rejection matrix required by the contract is not executable

The entitlement contract requires one-field mutation, missing field, extra field, reordered
set-like array, forged ID, URL/path insertion, header/credential insertion, and provider-default
substitution for every identity family
(`docs/contracts/pr-2e-p1-10-entitlement-identity.md:562-583`). The only identity-derivation test
constructs the 11 happy preimages and compares their outputs
(`test/p1-10-contract.test.ts:500-585`). The later preflight mutation list changes one endpoint
channel and a few request fields, but does not adversarially exercise the provider, dataset, feed,
and endpoint preimage validators or prove the required zero-call counters
(`test/p1-10-contract.test.ts:587-630`).

This leaves the closed identity/configuration parser untested against exactly the hostile shape and
identity-substitution cases the contract says are mandatory before implementation.

Required remediation: add table-driven negative derivation/configuration vectors for every
identity family and every mutation class named in the contract, including exact zero credential,
transport-construction, DNS/network/provider, artifact, normalization, selection, and post-return
counts.

### F-004 — P0 — Several advertised fault-injection proofs are assertions over invented outcomes

The state-machine contract requires executable proof of legal/illegal transitions, quota
intersection and rolling-window equality, active-response regression, timeout cleanup,
first/middle/last sibling and store/read failures, durable checkpoint ordering, crash recovery,
response-order invariance, and memory/SQLite equivalence
(`docs/contracts/pr-2e-p1-10-acquisition-state-machine.md:633-658`). The current suite does not
execute those behaviors:

- malformed/truncated/declared-length cases construct a three-string event array and assert that no
  string starts with `artifact.`; timeout cases create a `Set`, immediately clear it, and call that
  settlement (`test/p1-10-contract.test.ts:744-759`);
- exact/one-over resource coverage feeds unrelated numbers to one generic comparator rather than
  exercising the named enforcement surfaces (`test/p1-10-contract.test.ts:679-717`);
- crash recovery calls a function that returns a predetermined string list based solely on the
  supplied checkpoint name (`test/p1-10-contract.test.ts:393-423` and `879-889`);
- memory/SQLite equivalence copies three-column `{ordinal,stage,digest}` rows into an in-memory
  SQLite table, omitting the required journal body, budgets, identities, token material,
  checkpoint validation, and restart decisions (`test/p1-10-contract.test.ts:988-1010`); and
- sibling settlement uses three identical promises and `Promise.allSettled`; it does not model
  abort/destroy or first/middle/last stream/store/read failures
  (`test/p1-10-contract.test.ts:1012-1033`).

These tests can remain green if the specified state ordering, cleanup, quota, or restart policy is
wrong because they manufacture the expected result rather than drive a contract model through the
fault. The fixture manifest's claim of a complete acquisition-test corpus therefore is not
supported by executable evidence.

Required remediation: implement a production-free but real deterministic contract model and
provider/store/journal doubles. Drive every required transition and fault through it, observe
abort/destroy/settlement and causal writes, persist the complete checkpoint schema in both memory
and SQLite, restart from each durable boundary, and prove the exact counters and output invariants.

## Control observations with no finding

- The 15-minute predicate uses conservative trusted `request.started` time; equality passes and
  one nanosecond newer rejects in the focused model.
- The documents close the Alpaca origins, multi-symbol paths, `feed=sip`, `sort=asc`, `1Min/raw`
  bars, no-fallback role, and exact source/channel identities.
- FMP is documented as private discrepancy evidence only, excluded from the first PR 2F transport
  wave, unable to become primary/fallback, and prohibited from public output.
- The documents preserve the required causal projection
  `acquisition.declared -> request.started -> request.succeeded -> artifact.committed ->
  artifact.verified -> normalization.* -> selection.recorded`.
- Credential names and authentication-header names are specified without credential values.
  Non-secret preflight is ordered before runtime-only credential access, raw provider text is
  excluded from safe errors, and private bytes are confined beneath `PEAS_RUNTIME_ROOT`.
- The candidate correctly reports that `ArtifactStore` has no deletion API and migration 005 has
  no-delete triggers. It does not claim retention is already enforced.
- Roadmap and board changes keep P1-10 in progress and P1-06/P2 blocked; accepted PR 2D and P1-09
  authority files are unchanged.

## Validation performed on the exact candidate

| Command/check | Independent result |
| --- | --- |
| detached HEAD / status checks | exact candidate; detached; clean before audit |
| `npm.cmd ci --no-fund --no-audit` | passed; 54 packages installed |
| `npm.cmd run verify:runtime` | passed; Node 24.17.0 / npm 12.0.0 |
| `npm.cmd run verify:candidate` | passed; exact candidate SHA |
| `npm.cmd run format:check` | passed; 143 files |
| `npm.cmd run lint` | passed; 143 files |
| `npm.cmd run typecheck` | passed |
| `npm.cmd run build` | passed |
| `node --test --test-reporter=spec dist/test/p1-10-contract.test.js` | passed; 17/17 |
| independent framed SHA-256 recomputation | all 11 frozen IDs and the proposed zero-spend ID matched |
| candidate file inventory / production-surface inspection | docs, synthetic fixtures, and one test only; no production transport |

I began `npm.cmd run check`, but it was intentionally interrupted after the semantic defects above
made the candidate conclusively `NO_GO`; it is not recorded as an independent pass. Coordinator
reports about same-SHA remote CI were not used to waive or determine any finding. Green execution
of the present tests cannot cure missing or contradictory contract evidence.

## Retention and gate disposition

The proposed retention design requires a new maintenance port, an additive migration, controlled
physical deletion, tombstone/use-denial behavior, changed vault read/stat behavior, changed
reconciliation semantics, and new persistence/hard-kill/platform evidence. Current authority
explicitly reserves those changes for the human owner.

```text
RETENTION_IMPLEMENTATION_AUTHORIZATION = HUMAN_AUTHORIZATION_REQUIRED / NOT_AUTHORIZED
PR_2F_ENTRY = NO_GO
```

This audit cannot grant that authority. Even after the four contract findings are repaired and a
new exact candidate receives fresh independent `GO`, PR 2F remains blocked until the human owner
separately authorizes the exact retention surfaces and semantics and the orchestration owner
acknowledges both gates.

No provider call, Alpaca witness, FMP transport, merge, P2 collection, or outcome calculation is
authorized by this review.

## Binary decision and handoff

`CONTRACT_DECISION=NO_GO` for
`72164f8d15ff073325232c652ec33ea6573e40de`.

Repair must occur on a new candidate SHA. The next independent reviewer must re-read the complete
package, independently recompute all 11 source identities, rerun the executable matrix, and issue a
new binary decision. This audit record must remain preserved and must not be rewritten to convert
the decision.
