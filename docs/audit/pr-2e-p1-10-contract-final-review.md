# PR 2E P1-10 final independent contract review

```text
REVIEWED_CANDIDATE_SHA = 74f559f3b3b58de68f67e9ea8bc6991e381704e4
CONTRACT_DECISION = NO_GO
RETENTION_IMPLEMENTATION_AUTHORIZATION = HUMAN_AUTHORIZATION_REQUIRED / NOT_AUTHORIZED
PR_2F_ENTRY = NO_GO
PROVIDER_WITNESS = NOT_AUTHORIZED
MERGE = NOT_AUTHORIZED
```

## Review identity and isolation

This is a fresh independent final review. The reviewer authored none of the contract, fixture,
test, repair, board, roadmap, orchestration, or either prior-audit package and edited only this new
review record.

Before review:

- `git rev-parse HEAD` returned
  `74f559f3b3b58de68f67e9ea8bc6991e381704e4`;
- `git branch --show-current` returned no branch, proving detached HEAD;
- `git status --short` returned no output; and
- the review used the dedicated detached worktree
  `pr-2e-final-audit-74f559f`, not the integration worktree.

I read the complete frozen P1-09/PR 2D authority chain, the ArtifactStore and migration constraints,
the relevant recorded acquisition, observation-ledger, runtime-root, reconciliation, redaction,
hard-kill, persistence, package, and CI/release-evidence surfaces, every PR 2E candidate file, and
both immutable prior `NO_GO` reports. P1-09 final `GO` supersedes historical pending prose only. It
does not authorize transport, a provider witness, retention-semantics changes, PR 2F, or merge.

The candidate diff from base `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` contains only contract,
orchestration, audit, roadmap/board, original synthetic fixture, and contract-test files. It adds no
production source, migration, workflow, dependency, transport, credential loader, provider client,
or FMP production file. Accepted PR 2D and P1-09 authority files are unchanged. A focused leak scan
found no credential assignment, query-bearing provider URL, raw page token, provider payload, or
provider-derived fixture bytes.

## Independent identity recomputation

I independently implemented recursive canonical JSON key ordering and exact
`uint64be(length) || bytes` framing with SHA-256 using only `node:crypto`. The computation imported
no repository identity or canonical-hash function and accessed neither credentials nor network.
All 11 frozen identities matched:

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

### F-001 - CLOSED

The executable preflight accepts only canonical decimal integers from 1 through 10,000, including
1, 2, 7, and 10,000, and rejects coercive, zero, and one-over forms
(`test/p1-10-contract.test.ts:217-227`, `2197-2250`). Page limit remains outside the request
identity and changes the private configuration hash.

### F-002 - CLOSED

The exact zero-spend preimage and identity are executable, bound into the run decision and
configuration, and missing, forged, mutated, rejecting, stale, and unknown decisions reject with
the declared side-effect counters at zero (`test/p1-10-contract.test.ts:64-77`, `487-513`,
`2062-2088`).

### F-003 - NOT FULLY CLOSED

All 11 real identity envelopes now traverse one guarded wrapper. The positive path has reachable
credential, transport-construction, DNS/network/provider, artifact, normalization, selection, and
post-return increments, and each exercised negative path rejects before those increments
(`test/p1-10-contract.test.ts:525-729`, `2091-2158`).

The required reordered set-like-array class is still not isolated. Every frozen channel has a
singleton `factKinds`. The alleged reorder vector first adds an unauthorized member and only then
reverses the changed array (`test/p1-10-contract.test.ts:2139-2151`). Its rejection can therefore
be caused entirely by changed membership/forged identity, whether or not noncanonical ordering is
rejected. This does not prove the explicit noncanonical set-order rule in
`docs/contracts/pr-2e-p1-10-entitlement-identity.md:74-76` and the required reordered-set vector at
lines 562-569.

Required repair: add a controlled channel-schema vector with the same valid multi-member set in
canonical and reversed order, prove canonicalization/rejection behavior independently of member
substitution, then route the rejected form through the same all-counter guarded gate.

### F-004a - CLOSED

`429` now requires the closed `temporary-throttling-proved` classification. Missing, ambiguous, and
quota-exhausted classification is terminal, and effective delay is
`max(projectDelay, Retry-After)`, including exactly 30,000 ms
(`test/p1-10-contract.test.ts:286-327`, `2590-2636`).

### F-004b - NOT CLOSED

The test type lists the checkpoint field names, but its identities, hash chain, budgets, and
causal semantics are not the exact contract:

1. `requestIdentity` omits entitlement snapshot, instrument identities/symbol set, route-policy
   version, explicit fixed feed, and bars timeframe/adjustment
   (`test/p1-10-contract.test.ts:493-505`). `configurationHash` omits the effective
   lesser-of ceilings, live-enable decision, retry, quota, deadline, retention-readiness, and
   journal-schema policies (`test/p1-10-contract.test.ts:507-513`). This contradicts
   `docs/contracts/pr-2e-p1-10-artifact-replay.md:131-177`.
2. The checkpoint manufactures `marketAcquisitionJournalId` with
   `hash("synthetic-acquisition-journal")`, `marketAcquisitionId` with
   `hash("market-acquisition:" + acquisitionObservationId)`, and
   `logicalPageIdentityHash` without `requestIdentityHash`
   (`test/p1-10-contract.test.ts:1665-1690`). Validation accepts those same toy formulas
   (`test/p1-10-contract.test.ts:1101-1120`). It therefore does not recompute the frozen PR 2D
   acquisition preimage or the exact journal/page identities required by
   `docs/contracts/pr-2e-p1-10-artifact-replay.md:103-251`.
3. `journalEntryHash` hashes a checkpoint object containing an empty `journalEntryHash`; it does
   not frame the exact journal ID, sequence, prior hash, entry kind, and canonical entry body
   (`test/p1-10-contract.test.ts:1040-1044`; normative formula at
   `docs/contracts/pr-2e-p1-10-artifact-replay.md:231-251`).
4. Every event receives a new ledger fact whose sole parent is the immediately preceding
   checkpoint fact (`test/p1-10-contract.test.ts:1052-1098`, `1264-1268`). The contract instead
   requires live `artifact.committed` to parent both its own `acquisition.declared` and
   `request.succeeded`, and selection to parent the accepted normalization/capture basis
   (`docs/contracts/pr-2e-p1-10-artifact-replay.md:415-467`). Journal-only checkpoint stages may
   have `stageLedgerFactId=null`; the model invents facts for all of them.
5. The byte budget advances at store commit before verified read/page admission
   (`test/p1-10-contract.test.ts:1760-1778`) and receipt reconciliation sums
   `artifact.committed` rows (`test/p1-10-contract.test.ts:1269-1287`, `1304-1346`).
   `cumulativeVerifiedBytes` is defined as admitted verified artifact bytes, and cached values must
   reconcile from applicable immutable receipts
   (`docs/contracts/pr-2e-p1-10-artifact-replay.md:304-347`).

These defects allow a coherently rehashed but cross-query, underbound, or causally invalid journal
to pass the executable validator.

Required repair: derive and independently validate every journal/request/configuration/page/
attempt/acquisition identity from the exact normative preimage; implement the exact entry framing;
validate exact ADR-0009 direct-parent sets instead of previous-row adjacency; and advance/reconcile
verified/admitted budgets only at their normative durable stages.

### F-004c - PARTIALLY CLOSED

For the single synthetic artifact, restart performs a fresh read for every committed row and a
true `during-normalization` crash now occurs before `normalization.emitted`
(`test/p1-10-contract.test.ts:1807-1897`, `2822-2903`). It does not redispatch that one committed
artifact.

The proof remains incomplete because the model can hold only one artifact receipt, one page, and
one admitted acquisition ID (`test/p1-10-contract.test.ts:1575-1624`, `1665-1731`). It cannot
execute restart verification of a multi-page committed chain, resume the next continuation, or
show that every earlier verified page is not redispatched.

### F-004d - NOT CLOSED

SQLite is now actually closed and reopened at every prefix of one successful single-page history
using newly constructed provider/artifact doubles (`test/p1-10-contract.test.ts:3002-3118`).
However:

- the source history still contains one artifact/page only;
- `ArtifactDouble` stores only one receipt (`test/p1-10-contract.test.ts:1581-1624`);
- “backend page size” changes only the batch size of a loop that appends already materialized rows,
  not SQLite enumeration/page behavior (`test/p1-10-contract.test.ts:3028-3038`, `3064-3090`);
- duplicate-delivery and multi-artifact order are tested in detached classification/array helpers,
  not persisted through the journal, artifact store, restart, normalization, and selection
  (`test/p1-10-contract.test.ts:2791-2820`, `3120-3184`); and
- the reconstructed artifact is hard-coded from `ambercobaltfern`, rather than enumerated from
  independent durable observation receipts (`test/p1-10-contract.test.ts:3013-3027`).

This does not meet the required response, artifact, duplicate-delivery, replay-page, and
backend-page permutations across every durable checkpoint in
`docs/contracts/pr-2e-p1-10-artifact-replay.md:705-724`.

Required repair: execute a real synthetic multi-page/multi-artifact acquisition with distinct
delivery observations and physical-digest deduplication; persist and re-enumerate it through both
journals; close/reopen at every prefix; and compare the exact next decision, complete checkpoint,
page chain, counters, normalized facts, and selection under actual backend enumeration/page-size
permutations.

### F-004e - NOT CLOSED: the state and pagination models remain detached from acquisition

The 20-state adjacency table is an exact textual transcription, and the test checks its Cartesian
product (`test/p1-10-contract.test.ts:769-820`, `2409-2421`). But
`AcquisitionContractModel` has no current acquisition state and never invokes
`validateAcquisitionTransition` (`test/p1-10-contract.test.ts:1651-1898`). Retry, rolling quota,
deadlines, acquisition ceilings, and page-chain verification are separate helpers not used by the
model. Thus the suite proves a lookup table, not that legal edges are reachable under their
required proof or that an integrated run cannot take an illegal edge.

Pagination is likewise a detached six-field `Page` helper
(`test/p1-10-contract.test.ts:329-370`). It does not bind the preceding page's
`marketAcquisitionId`, logical-page identity, artifact observation/size, cumulative budgets, raw
one-use resumable material, or the exact page-chain preimage required at
`docs/contracts/pr-2e-p1-10-artifact-replay.md:507-592`. The acquisition itself always writes a
terminal-token hash for the single artifact and never executes a continuation
(`test/p1-10-contract.test.ts:1055-1070`, `1734-1797`).

Required repair: make the production-free acquisition model own and validate the exact current
state; drive every legal edge with its required evidence and every illegal edge through the same
model; integrate retry/quota/deadline/ceiling decisions; and run real two-or-more-page token
admission, continuation, loop/substitution, terminal, crash, and restart cases through the durable
journal and artifact doubles.

## Other controls

The following controls passed but do not waive the findings:

- the exact 15-minute equality boundary passes and one nanosecond newer rejects;
- the fixed Alpaca origins/routes, multi-symbol paths, `feed=sip`, `sort=asc`, `1Min/raw` bars,
  no-fallback role, and frozen source identities remain closed in the documents;
- FMP remains private-discrepancy-only, excluded from first-wave production transport, unable to
  become primary/fallback, and excluded from public output;
- the exercised body-failure cases abort, destroy, and settle their synthetic resources;
- the candidate adds no production transport, credential-loading code, migration, or FMP client;
  and
- roadmap/board status keeps P1-10 in progress and P1-06/P2 blocked.

## Validation on the exact candidate

| Command/check | Independent result |
| --- | --- |
| detached HEAD and clean-status checks | exact candidate; detached; clean before audit |
| `npm.cmd run verify:runtime` | passed; Node 24.17.0 / npm 12.0.0 |
| `npm.cmd ci --no-fund --no-audit` | passed; 54 packages installed |
| exact `PEAS_CANDIDATE_SHA` with `npm.cmd run verify:candidate` | passed |
| `npm.cmd run format:check` | passed; 143 files before this report |
| `npm.cmd run lint` | passed; 143 files before this report |
| `npm.cmd run typecheck` | passed |
| `npm.cmd run build` | passed |
| `node --test --test-reporter=spec dist/test/p1-10-contract.test.js` | passed; 22/22 |
| independent framed SHA-256 recomputation | all 11 source IDs and zero-spend ID matched |
| candidate inventory and leak scan | contract-only scope; no prohibited material found |
| same-SHA draft PR inspection | head matched; Ubuntu and Windows passed; scale-10k pending at observation |

Green execution cannot cure a model that implements different identities, causal relations, and
durable semantics from the contract it is intended to prove.

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

`CONTRACT_DECISION=NO_GO` for
`74f559f3b3b58de68f67e9ea8bc6991e381704e4`.

The next repair must produce a new candidate SHA and a new fresh independent review. This report and
both prior audits are immutable evidence and must not be rewritten into `GO`.

This decision does not authorize a provider call, Alpaca or FMP witness, transport implementation,
PR 2F entry, retention implementation, merge, P2 collection, or outcome calculation.
