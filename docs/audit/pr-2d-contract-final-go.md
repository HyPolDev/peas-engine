# PR 2D final independent contract gate

## Review record

- Binary verdict: `GO`
- Implementation authorization: `true`
- Review date: `2026-07-23`
- Exact reviewed checkpoint:
  `750e1ab2486ce785a60304fceb19a1502ff34319`
- Contract-content commit:
  `acd9f25bc89355ce18292d0dcd5afecfebf818cf`
- Contract authority registry:
  `car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad`
- PR 2D base:
  `0377323b5486a8ad3b8e2631d4c8559760893be6`
- Reviewer: fresh independent review-only Luna agent
  `/root/luna_contract_final_go`
- Review worktree:
  `C:\Users\HyPol\.codex\visualizations\2026\07\19\019f7803-6765-73b3-9abf-959f6e73eda5\worktrees\pr-2d-market-reference-contract`

Every file-and-line reference in this report is bound to the exact reviewed checkpoint. Before this
audit write, `HEAD` resolved to the full reviewed SHA and `git status --short` was empty. This audit
file is the reviewer's only write. The reviewer did not edit, stage, commit, or implement any
research, contract, registry, governance, source, fixture, test, migration, dependency, or generated
output.

## Reviewer independence and scope

The reviewer authored none of the four PR 2D research reports, H-001 integration, ADR 0010,
contract documents, contract repairs, authority registries, roadmap/board changes, prior audits,
source, fixtures, tests, or implementation. The reviewer also authored none of the inherited PR 2C
observation-ledger, ArtifactStore, provider/source, frozen-port, entitlement, or no-trade evidence.

The review read the authoritative assignment, all four prior PR 2D `NO_GO` records, ADR 0010, all
eight PR 2D contract documents, the external authority registry, the relevant inherited ADR 0006/
0009, observation-ledger and ArtifactStore contracts and implementations, entitlement and
no-trade dispositions, roadmap/board state, and the exact base-to-checkpoint diff. It independently
recomputed the repaired evidence rather than accepting a prior review's arithmetic.

## Binary decision

`GO` for
`750e1ab2486ce785a60304fceb19a1502ff34319`.

P1-07's contract is deterministic, closed enough to implement, authority-bound to exact immutable
bytes, compatible with the inherited ports, and fail-closed at the pending entitlement boundary.
The implementation gate is authorized only for this exact semantic contract and registry.

`implementationAuthorization` is `true`. P1-08 may begin only after the required audit/status-only
publication proves that ADR 0010's accepted head differs from this reviewed checkpoint solely by
audit and governance status evidence. Any semantic contract change invalidates this `GO`.

## Findings

| Severity | Findings |
| --- | ---: |
| Blocking | 0 |
| Major | 0 |
| Minor | 0 |

P1-09 remains `PENDING`; this `GO` does not authorize provider access, live acquisition, fallback,
credentials, account inspection, provider bytes, licensing assumptions, subscriptions, or spend.
Executable implementation evidence remains pending by design and belongs to the later independent
P1-08 final implementation gate.

## Independently verified contract evidence

### Exact contract authority and hash framing

- `docs/contracts/pr-2d-provider-source-identity.md:83-158` defines the external, non-self-cyclic
  `ContractAuthorityRegistryV1`, its exact ten logical IDs, nine repository paths, sorted order,
  per-blob digest/OID/commit validation, and `car1_` preimage.
- `docs/audit/pr-2d-contract-authority.json:1` names content commit
  `acd9f25bc89355ce18292d0dcd5afecfebf818cf`, contains exactly ten unique logical IDs sorted by
  unsigned UTF-8 over nine distinct paths, and binds both reason authorities intentionally to the
  same reason-catalog blob.
- Every registry path was read as raw Git blob bytes from that exact content commit. Every
  `documentSha256`, Git blob OID, repository path, per-entry content commit, and registry content
  commit matches. Recomputing
  `canonicalHash("peas/contract-authority-registry/v1",
  {schemaVersion,contractContentCommit,entries})` produces exactly
  `car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad`.
- The reviewed checkpoint differs from its content commit only by
  `docs/audit/pr-2d-contract-authority.json`.
- `docs/contracts/pr-2d-provider-source-identity.md:10-63` exactly matches the repository's
  eight-byte unsigned big-endian length-prefixed `hashParts` framing. The ordinary vector
  recomputes as
  `6b2d9419f583fd8f1e317a03a25f14dbcaeb06a3e63bfe566ab9f33b1e39de97`.
  The collision witnesses recompute as
  `4e38029c6f73af0004b786cb417eaf3f4b06d9c4c23477e65a6a0136f0ef6ff8`
  and
  `31b5b621ccf61824923b45fb664e683a1f719e61aebe63cca5ebe1bbcf910ae3`
  and are distinct.

### H-001 anchor, timestamps, intervals, and selectors

- `docs/adr/0010-market-reference-contract.md:15-23` records the approved durable-capture primary,
  exact inherited retrieval sensitivity, last-eligible `<=` point selectors, and strict `< Tpub`
  release origin.
- `docs/contracts/pr-2d-timestamp-trust.md:25-77` preserves the exact inherited capture/retrieval
  basis shapes and meanings, uses exact integer nanosecond conversion, and expressly forbids
  reinterpreting `retrievedAtMs` as transport completion.
- `docs/contracts/pr-2d-timestamp-trust.md:275-305` closes T0/T1/T5/T30 arithmetic and the selector
  inequalities without nearest/first-after behavior.
- `docs/contracts/pr-2d-provider-source-identity.md:515-545` defines all six exact interval
  preimages and `mik1_` derivation, while
  `docs/contracts/pr-2d-provider-source-identity.md:719-763` binds the complete basis, target,
  comparator, view, corpus, and admitted revision set into results and the explicit selection
  policy.
- `docs/contracts/pr-2d-market-eligibility.md:100-145` reconciles all metric endpoints and equality
  boundaries. `Tpub > T0` is missing, equality at publication cannot become Qpre, equality at point
  targets is eligible, and one nanosecond after is future information.

### Source, market, revision, and result identities

- `docs/contracts/pr-2d-provider-source-identity.md:166-251` keeps provider, entitlement, dataset,
  feed, endpoint/channel, venue, tape, protocol, adjustment, correction, and authorization
  identities separate. There is no default feed.
- `docs/contracts/pr-2d-provider-source-identity.md:253-321` preserves inherited `imap1_`, defines
  direct `min1_` instrument versions and effective aliases, and keeps acquisition, content, raw
  artifact, ArtifactStore observation, and verified read evidence distinct.
- `docs/contracts/pr-2d-provider-source-identity.md:323-405` closes provider observation, delivery,
  revision family/revision, market fact, and normalized fact preimages. Redelivery retains delivery
  witnesses, correction/cancellation remains immutable, and same-provider conflicts quarantine
  without last-writer-wins.
- `docs/contracts/pr-2d-provider-source-identity.md:407-513` closes the eleven reference kinds,
  selected/degraded/missing statuses, direct-key reason representation, and diagnostics.
- `docs/contracts/pr-2d-provider-source-identity.md:719-805` closes candidate ordering and hashing,
  selected/missing/discrepancy preimages, cardinality, provider independence, and the no-result
  behavior for operation rejection.
- `docs/contracts/pr-2d-market-eligibility.md:147-211` requires complete bounded candidate
  evaluation, deterministic revision/state replay, trusted-time/source-order tie handling, and
  missing on unresolved differing state. Provider priority, arrival, artifact, page, row, and hash
  order cannot select a winner.

### Corrections, duplicate evidence, and replay

- `docs/contracts/pr-2d-provider-source-identity.md:645-717`,
  `docs/contracts/pr-2d-timestamp-trust.md:356-420`, and
  `docs/contracts/pr-2d-market-eligibility.md:459-486` agree on the sole view pair
  `recorded-primary|recorded-corrected`.
- Primary admission is exact membership in the first complete verified immutable corpus, not a
  native-provider-known or PEAS-known-at-target claim. Corrected admission starts from that set and
  adds valid revisions with durable evidence at or before capture T0 plus exactly
  `604800000000000 ns`; equality is included and the next representable PEAS millisecond is
  excluded.
- Corrected-in-place/final-only evidence with unknown primary membership cannot forge
  `recorded-primary`; final-corrected-only evidence enters the corrected view only under the exact
  closed-corpus predicate.
- `docs/contracts/pr-2d-provider-source-identity.md:922-936` closes page-size, restart, backend,
  redelivery, replay-remapping, and active-lease invariants without changing semantic identities.

### Reason, bound, and fixture closure

- `docs/contracts/pr-2d-reason-codes.md:28-87` requires the one exact `{code,detail}` representation
  and defines all 16 direct-key market detail mappings.
- The market tables at `docs/contracts/pr-2d-reason-codes.md:135-207` contain exactly 63 unique
  canonical `market.*` codes and priorities. The study tables at
  `docs/contracts/pr-2d-reason-codes.md:208-303` contain exactly 33 unique `study.*` codes and all
  17 direct-key study mappings. Scope, applicability, fatal priority, fixed-denominator retention,
  and immutable preservation of the underlying market result/reason are closed at
  `docs/contracts/pr-2d-reason-codes.md:305-360`.
- The three numeric tables in `docs/contracts/pr-2d-resource-bounds.md:93-200` contain exactly 84
  unique bound IDs. Expanding the grouped enforcement ledger at
  `docs/contracts/pr-2d-resource-bounds.md:206-250` yields the same 84 unique IDs with no omission,
  extra, or duplicate. Every violating vector has one stage, one reason, and one atomicity.
- `docs/contracts/pr-2d-fixture-manifest.md:22-67` binds the complete fixture to the exact authority
  registry and recomputes displayed IDs. Source primitives and dependency validation are closed at
  `docs/contracts/pr-2d-fixture-manifest.md:69-237`; acquisition and ArtifactStore authority are
  closed at `docs/contracts/pr-2d-fixture-manifest.md:239-331`; instrument/calendar primitives are
  closed at `docs/contracts/pr-2d-fixture-manifest.md:333-418`; and fact/result/corpus/H-001 oracles
  are closed at `docs/contracts/pr-2d-fixture-manifest.md:420-669`.
- `docs/contracts/pr-2d-fixture-manifest.md:801-836` makes the registry-bound 84-row enforcement
  ledger the sole fixture authority and explicitly proves candidate-, metric-, operation-, and
  study-run-local outcomes without truncation or partial output.

### Corrected release-cluster identity corpus

- `docs/contracts/pr-2d-study-freeze-manifest.md:915-1003` closes schedule-source precedence,
  revision choice, fiscal/cross-source/native-date clustering, representative selection,
  contributor membership, raw RFC 8785 release-cluster hashing, eight-field `scc1_`, and downstream
  identity propagation.
- The complete original-synthetic issuer preimage at
  `docs/contracts/pr-2d-study-freeze-manifest.md:1007-1022` recomputes through the inherited
  `peas/issuer-mapping/v1` function as
  `imap1_b5fb4ba66e0c0db04d272e66bcfd071e46fe343be06487bb76c892834958441e`.
- The complete linked instrument preimage at
  `docs/contracts/pr-2d-study-freeze-manifest.md:1023-1039` recomputes through
  `peas/market-instrument/v1` as
  `min1_e9356093916724ade802248d445ca057c3667b74cb09a06fe34c01767f807fc3`.
  Both complete preimages satisfy the inherited/direct field contracts; neither is a plausible
  prefix with an unproved digest.
- Independently recomputing raw
  `SHA-256(RFC8785({issuerMappingId,releaseKind,clusterBasis}))` and then repository-framed
  `canonicalHash("peas/event-study-cluster-candidate/v1", exactEightFieldPreimage)` produces all
  seven exact key/ID pairs at
  `docs/contracts/pr-2d-study-freeze-manifest.md:1056-1064` and the duplicate fixture authority at
  `docs/contracts/pr-2d-fixture-manifest.md:750-758`.
- The prohibited retired six-field projection recomputes exactly as
  `scc1_3dedd976378f6b5a8fb86477f3518ed9c62068ac4a697dd2eaba2c2c8b233f0b`
  (`docs/contracts/pr-2d-study-freeze-manifest.md:1083-1090`). The accepted quarterly and annual
  vectors instead recompute to distinct IDs. Invalid `ism1_`/`ins1_` vector inputs are absent from
  the normative study and fixture corpus and are retained only as explicit rejection text in the
  acceptance matrix.

### Study freeze, sampling, and analysis determinism

- The six duplicated study identity preimages at
  `docs/contracts/pr-2d-provider-source-identity.md:807-852` and
  `docs/contracts/pr-2d-study-freeze-manifest.md:39-83` have byte-equivalent ordered field lists:
  13 `std1_`, 14 `sfs1_`, 8 `scc1_`, 8 `scl1_`, 21 `sfm1_`, and 14 `sdf1_` fields.
- `docs/contracts/pr-2d-study-freeze-manifest.md:538-565` prevents a run freeze while P1-09 or any
  prerequisite is unapproved and fixes the exact calendar chronology before outcomes.
- `docs/contracts/pr-2d-study-freeze-manifest.md:567-610` derives the rank seed from immutable
  pre-frame evidence before candidate exposure. The timing evidence cannot tune the hash.
- Release clustering and share-class choice are deterministic at
  `docs/contracts/pr-2d-study-freeze-manifest.md:915-1003` and
  `docs/contracts/pr-2d-study-freeze-manifest.md:1111-1158`.
- The SIC/model registries, strict control priority, oversubscription rank, global cap/liquidity
  comparison populations, bottom-decile control, and two-level capacity-aware Hamilton allocation
  are closed at `docs/contracts/pr-2d-study-freeze-manifest.md:1183-1281`.
- The fixed `N=180` denominator and no-replacement rules are closed at
  `docs/contracts/pr-2d-study-freeze-manifest.md:1283-1304`. The exact metrics and selectors at
  `docs/contracts/pr-2d-study-freeze-manifest.md:1306-1350` agree with H-001.
- The bootstrap procedure at `docs/contracts/pr-2d-study-freeze-manifest.md:1430-1480` fixes its
  seed, lane pools, sampling-with-replacement count, counter expansion, rejection sampling, exact
  median, type-7 quantiles, output order, and literals. The seed recomputes as
  `c53a848e04b4d945a53529ae5b38521ed30911687fc2a5da82f9cac328837bc9`;
  `BOOT-WORD-01` recomputes digest
  `d61c7e091da9669460ab57eecf06483bc5250e38f3740827fb63813bc181d818`,
  uint64 `15428345001081923220`, pool-180 index `60`; and the pool-10 rejection limit is
  `18446744073709551610`.
- `docs/contracts/pr-2d-study-freeze-manifest.md:1482-1514` fixes exactly 24 Holm slots, exact
  two-sided sign-test p-values, unavailable `p=1`, stable tie ordering, sequential rejection,
  adjusted p-values, and no dynamic family shrink.
- A rejected required market operation atomically invalidates the entire proposed dataset, emits no
  market result/study row/`sdf1_`, and cannot remove or replace the frozen cluster
  (`docs/contracts/pr-2d-study-freeze-manifest.md:1647-1656`). The publishable denominator union is
  exactly 180 selected-or-typed-missing rows at
  `docs/contracts/pr-2d-study-freeze-manifest.md:1658-1684`.

### Redistribution, zero-spend, effect isolation, and frozen ports

- `docs/adr/0010-market-reference-contract.md:217-236` leaves P1-09 pending, separates candidate
  providers/feeds/endpoints, forbids inferred rights, and prevents fallback after outcomes.
- `docs/contracts/pr-2d-fixture-manifest.md:671-690` permits only project-authored original synthetic
  material and has no redistribution escape hatch.
- `docs/contracts/pr-2d-fixture-manifest.md:937-949` forbids network/provider/account/credential
  access, provider bytes/examples, subscriptions, spending, frozen-port changes, and financial
  effects.
- `docs/adr/0010-market-reference-contract.md:273-288` and
  `docs/contracts/pr-2d-provider-source-identity.md:901-920` preserve the exact inherited
  `marketReferenceJoinKey`, EventLog, ProcessingStore, ArtifactStore, observation-ledger fact union,
  EventDraft/evidence identity, migrations, dependencies, and financial-effect boundaries.
- The base-to-checkpoint diff contains only documentation, research, audit, and governance files.
  It contains no source, executable fixture body, test, migration, dependency, Docker, frozen-port,
  broker/order, portfolio, position, fill, or financial-effect change.

## Prior finding disposition and supersession chain

All earlier reports remain immutable evidence for their exact reviewed SHAs. This report
independently closes the current checkpoint and supersedes their `NO_GO` gate disposition only for
the new exact SHA:

| Prior report | Current disposition |
| --- | --- |
| `docs/audit/pr-2d-contract-review.md` | All six findings remain repaired: exact authority/preimages, fixture identity/reasons, one correction vocabulary, closed study types/reasons, deterministic sampling/analysis, and one-disposition bounds. |
| `docs/audit/pr-2d-contract-reaudit.md` | All four findings remain repaired: repository framing/authority, direct reason/bound representation, frozen strata/randomness, and atomic rejected-operation behavior. |
| `docs/audit/pr-2d-contract-final-reaudit.md` | The release-cluster semantic collision is repaired by exact `releaseKind` plus recomputed `releaseClusterKey` in the eight-field `scc1_` preimage and all downstream obligations. |
| `docs/audit/pr-2d-contract-go-audit.md` | `R2D-GO-AUDIT-001` is repaired by complete valid original-synthetic `imap1_`/`min1_` primitive preimages and independently recomputed seven-vector/retired-collision literals. |

No prior report is rewritten or retroactively converted to `GO`; each remains correct for its
named checkpoint.

## Validation evidence

The reviewer ran read-only checks against the exact checkpoint before writing this report:

```text
git status --short
git rev-parse HEAD
git log -3 --oneline
git diff --name-status acd9f25..750e1ab
git diff --name-status 0377323..750e1ab
git show --check --oneline 750e1ab
git diff --check 0377323..750e1ab
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
node -e "<parse project-board and authority JSON>"
node -e "<verify ten raw Git blobs, SHA-256, OIDs, common commit, ordering, and car1_>"
node -e "<recompute repository ordinary and collision framing vectors>"
node -e "<compare all six study preimage field lists and counts>"
node -e "<recompute 63/33 reason-code counts>"
node -e "<compare 84 numeric-bound IDs with 84 enforcement-ledger IDs>"
node -e "<recompute complete imap1_/min1_ primitives, seven release keys/scc1 IDs, and retired collision>"
node -e "<recompute bootstrap seed, word, rejection limit, and pool index>"
```

Results:

- clean pre-write `HEAD` was exactly
  `750e1ab2486ce785a60304fceb19a1502ff34319`;
- authority, framing, study-preimage, reason, bound, cluster, and bootstrap recomputations matched
  every pinned value;
- formatting passed for 115 files;
- lint passed for 115 files;
- typecheck passed;
- build passed;
- project-board and authority JSON parsed;
- whitespace validation passed; and
- the base-to-checkpoint diff is documentation/research/audit/governance only.

The full coverage/mutation gate was intentionally not run concurrently for this documentation-only
contract gate. It remains mandatory after implementation under the authoritative assignment.

## Gate disposition

P1-07 receives independent contract `GO` on the exact checkpoint and registry named above.

The integration owner may publish ADR 0010 as `Accepted` in an audit/status-only commit, prove the
publication-only delta, define the non-overlapping P1-08 ownership map, and begin recorded/offline
implementation. This authorization does not extend beyond the accepted contract, does not close
P1-09, and does not authorize any provider, network, licensing, account, spending, frozen-port, or
financial-effect action.
