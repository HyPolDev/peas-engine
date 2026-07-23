# PR 2D independent final repaired-contract re-audit

## Review record

- Binary verdict: `NO_GO`
- Implementation authorization: `false`
- Review date: `2026-07-23`
- Exact reviewed checkpoint:
  `737ea8fc236c07ea7bba635bda63abcc74126de3`
- Contract-content commit:
  `84ecd6c3fd0ae8280d290ed77763c811675122fa`
- Previous repaired checkpoint:
  `726f1690ce80562a1e9a452a26bf90849f04d08f`
- PR 2D base:
  `0377323b5486a8ad3b8e2631d4c8559760893be6`
- Reviewer: fresh independent review-only Terra agent
  `/root/terra_pr2d_contract_final_reaudit`
- Review worktree:
  `C:\Users\HyPol\.codex\visualizations\2026\07\19\019f7803-6765-73b3-9abf-959f6e73eda5\worktrees\pr-2d-market-reference-contract`

Every file-and-line reference in this report is bound to the exact reviewed checkpoint. Before this
audit write, `HEAD` resolved to the full reviewed SHA and `git status --short` was empty. This file is
the reviewer's only write. The reviewer did not edit, stage, commit, or implement any research,
contract, authority, governance, source, fixture, test, migration, dependency, or ignored output.

## Reviewer independence and scope

The reviewer authored none of the PR 2D research, H-001 decision integration, ADR, contracts,
contract repairs, authority registries, board/roadmap changes, prior audits, source, fixtures, tests,
or implementation. The reviewer also authored none of the inherited PR 2C observation-ledger,
ArtifactStore, provider/source, frozen-port, entitlement, or no-trade evidence.

The review read the authoritative assignment and H-001 record, both prior `NO_GO` audits, ADR 0010,
all eight PR 2D contract documents, the external authority registry, ADRs 0006 and 0009, the PR 2C
observation-ledger schema and implementation, the frozen EventLog, ProcessingStore, and
ArtifactStore interfaces, the entitlement boundary, roadmap/board state, and the exact
base-to-checkpoint diff. It independently re-audited every original and second-audit blocker and the
complete contract gate rather than treating a prior report's verified area as approval.

## Binary verdict

`NO_GO` for
`737ea8fc236c07ea7bba635bda63abcc74126de3`.

The second repair wave closes all four blockers from
[`pr-2d-contract-reaudit.md`](pr-2d-contract-reaudit.md). Repository hash framing, all six duplicated
study preimages, ten-authority binding, direct-key reason details, the 84-bound fixture oracle,
pre-frame seed commitment, market-cap/liquidity evidence, both Hamilton passes, the single bootstrap
derivation, and atomic dataset rejection now reconcile.

One independently discovered study-identity blocker remains. The normative release-clustering
contract distinguishes release clusters by `releaseKind` and `releaseClusterKey`, but the
`scc1_` preimage omits both. Distinct valid release groups can therefore produce the same
`clusterCandidateId`. That makes the prospective cluster identity unable to represent the cluster
definition it is supposed to freeze. P1-08 implementation is not authorized.

## Blocking finding

### R2D-FINAL-REAUDIT-001 — cluster-candidate identity omits the release-cluster identity

**Severity:** blocking identity, prospective sampling, and replay defect

The authoritative `scc1_` formula hashes only:

```text
{
  scheduleSourceObservationId,
  issuerMappingId,
  instrumentId,
  plannedFiscalPeriod,
  plannedReleaseDate,
  plannedSession
}
```

That formula appears identically at
`docs/contracts/pr-2d-provider-source-identity.md:825-828` and
`docs/contracts/pr-2d-study-freeze-manifest.md:59-62`.

The normative frame entry, however, also contains `releaseClusterKey` and
`releaseKind:"quarterly"|"annual"` at
`docs/contracts/pr-2d-study-freeze-manifest.md:678-729`. Release clustering explicitly groups by
`releaseKind`, distinguishes fiscal-period, cross-source, and native-date cluster bases, and derives:

```text
releaseClusterKey =
  SHA256(RFC8785({issuerMappingId,releaseKind,clusterBasis}))
```

at `docs/contracts/pr-2d-study-freeze-manifest.md:908-934`. Those fields are therefore semantic
cluster identity, not descriptive output. The contract contains no invariant making
`scheduleSourceObservationId` unique per schedule item or per release cluster. On the contrary,
`StudyScheduleSourceEvidenceV1` carries the separate `nativeScheduleIdHash` and
`crossSourceReleaseKeyHash` fields at
`docs/contracts/pr-2d-study-freeze-manifest.md:731-750`, which permit multiple distinguishable
schedule items or cluster bases within one source observation.

The collision is literal. Two otherwise identical candidate preimages with:

```text
A: releaseKind="quarterly", releaseClusterKey="aa...aa"
B: releaseKind="annual",    releaseClusterKey="bb...bb"
```

and common null `plannedFiscalPeriod`, common representative observation, issuer, instrument, date,
and session both recompute:

```text
scc1_96d999ef3a53ee1cdcce205f05b250159c124e5341ee14e4146f611334fcf749
```

under the repository `canonicalHash`. Different non-null cross-source/native cluster bases can
collide for the same reason. The later duplicate-ID rule at
`docs/contracts/pr-2d-study-freeze-manifest.md:929-935` merely turns the semantic collision into a
fatal `study.duplicate-cluster`; it does not make `scc1_` identify the two distinct prospective
release clusters. Depending on source packaging, a valid frame can be rejected, and a displayed
candidate ID does not prove which release-cluster key/kind it names.

The acceptance matrix's general study-ID derivation requirement at
`docs/contracts/pr-2d-acceptance-matrix.md:67-75` and clustering/sampling rows at
`docs/contracts/pr-2d-acceptance-matrix.md:149-166` contain no mutation vector proving that changing
`releaseKind` or `releaseClusterKey` changes `scc1_`.

**Required repair:**

1. Add the recomputed `releaseClusterKey` and `releaseKind` to the exact `scc1_` preimage in both
   normative identity locations. If a smaller primitive cluster-basis preimage is preferred, define
   it once and bind an equivalently complete, collision-resistant cluster identity; do not rely on
   source-observation uniqueness that the schema does not require.
2. State the exact cross-field validation between `releaseKind`, `plannedFiscalPeriod`, the selected
   `clusterBasis`, `releaseClusterKey`, representative schedule evidence, and the candidate preimage.
3. Add literal mutation/collision vectors covering quarterly versus annual, two non-null
   cross-source keys, two native schedule IDs, fiscal-period versus native-date basis, and identical
   source observations containing multiple schedule items.
4. Propagate the repaired preimage through `sfs1_`, `scl1_`, `sfm1_`, fixture/study golden vectors,
   and acceptance evidence.
5. Regenerate all nine document digests/blob OIDs, the external ten-authority registry, and `car1_`
   for a new semantic content commit, then obtain another fresh independent exact-checkpoint review.

## Prior-finding disposition

### First audit

| First-audit finding | Final re-audit disposition |
| --- | --- |
| `R2D-CONTRACT-001` authority and selection/result preimages | `REPAIRED`: the external ten-authority registry, exact policy components, interval/as-of schemas, and selected/missing result preimages recompute. The new `scc1_` release-cluster defect is separately recorded above. |
| `R2D-CONTRACT-002` fixture identities and reasons | `REPAIRED`: the fixture carries/references complete primitive source, acquisition, instrument, corpus, selection, result, reason-detail, and bound dispositions with one canonical vocabulary. |
| `R2D-CONTRACT-003` correction view/cutoff contradiction | `REPAIRED`: `recorded-primary|recorded-corrected` consistently describe immutable recorded-corpus membership and exact durable-cutoff admission without provider-native knowledge claims. |
| `R2D-CONTRACT-004` study schemas and reason catalog | `REPAIRED`: all referenced study shapes are closed, the catalog has 33 unique study codes, market reasons are preserved, and rejected operations atomically invalidate dataset freeze. |
| `R2D-CONTRACT-005` sampling and secondary analysis | `PARTIALLY_REPAIRED`: seed, strata, controls, Hamilton, bootstrap, Holm, and clustering rules are now deterministic, but release-cluster identity remains underbound under `R2D-FINAL-REAUDIT-001`. |
| `R2D-CONTRACT-006` non-binary bounds | `REPAIRED`: 84 unique numeric bound IDs match 84 unique enforcement-ledger IDs with one exact disposition per required vector. |

### Second audit

| Second-audit finding | Final re-audit disposition |
| --- | --- |
| `R2D-REAUDIT-001` hash framing and study authority preimages | `REPAIRED`: the repository's uint64-big-endian length-prefixed framing is normative; ordinary/collision vectors, all ten authorities, `car1_`, and all six study preimages reconcile. |
| `R2D-REAUDIT-002` reason details and fixture bound outcomes | `REPAIRED`: every surface uses the direct-key `{code,detail}` pair; no fixture alias or parallel `limitKind` remains; fixture and ledger bind the same 84 IDs and dispositions. |
| `R2D-REAUDIT-003` sampling strata and randomness | `REPAIRED` for the cited defects: seed material/timing, 32-byte conversion, frame binding, cap/liquidity evidence and populations, second-level Hamilton, and one bootstrap derivation are closed. The independent release-cluster identity defect is recorded separately. |
| `R2D-REAUDIT-004` rejected market operations | `REPAIRED`: rejection yields one validation-failure envelope, no market result/denominator row/`sdf1_`, invalidates the dataset atomically, and leaves the precommitted frame unchanged for rerun. |

No prior `NO_GO` is superseded by this report's repaired dispositions. They remain immutable evidence
for their exact reviewed SHAs. This report controls only the exact checkpoint named above and remains
`NO_GO`.

## Independently recomputed evidence

### Hash framing and authority

- Repository `canonicalHash("peas/golden/v1",{a:"x",n:1})` recomputed as
  `6b2d9419f583fd8f1e317a03a25f14dbcaeb06a3e63bfe566ab9f33b1e39de97`.
- Collision witness `hashParts("peas/frame-collision/v1","ab","c")` recomputed as
  `4e38029c6f73af0004b786cb417eaf3f4b06d9c4c23477e65a6a0136f0ef6ff8`.
- Collision witness `hashParts("peas/frame-collision/v1","a","bc")` recomputed as
  `31b5b621ccf61824923b45fb664e683a1f719e61aebe63cca5ebe1bbcf910ae3`.
- The registry contains exactly ten sorted unique logical authorities over nine distinct paths at
  content commit `84ecd6c3fd0ae8280d290ed77763c811675122fa`.
- Every registry entry's raw Git blob SHA-256, Git blob OID, path, and content commit recomputed
  exactly.
- The external registry recomputed as
  `car1_ac0a3f089138323edd7a188739c523628219424b75c14baa761122d98d76888e`.
- The checkpoint differs from the content commit only by
  `docs/audit/pr-2d-contract-authority.json`, avoiding a self-digest cycle.
- `std1_`, `sfs1_`, `scc1_`, `scl1_`, `sfm1_`, and `sdf1_` field lists are byte-for-byte equivalent
  between the provider/source and study contracts. This equivalence exposes rather than repairs the
  common `scc1_` omission above.

### Reasons, bounds, fixtures, and corrections

- The reason tables contain 63/63 unique `market.*` definitions and 33/33 unique `study.*`
  definitions.
- The direct-detail tables contain 16 market and 17 study code/key mappings. Provider, study,
  reason, bound, fixture, and acceptance surfaces use the same null-or-singleton direct-key shape.
- The three numeric bound tables contain 84 unique bound IDs. The enforcement ledger expands to the
  same 84 unique IDs, with no missing, extra, or duplicate ID.
- The fixture contract has no fixture-only bound alias and binds its oracle to the same registry,
  stage, vector kind, reason/detail, accepted flag, and atomicity.
- `recorded-primary` admits exactly first complete verified corpus membership.
  `recorded-corrected` adds valid revisions durably recorded at or before capture T0 plus
  `604800000` ms; equality is included and the next millisecond excluded.
- Delayed/final-corrected-only data cannot claim provider-native or PEAS-known-at-target state and
  cannot produce `recorded-primary` without original membership evidence.

### Study seed, strata, allocation, and analysis

- Rank seed is derived through immutable `pfe1_` and `rsm1_` evidence, has exact 64-lowercase-hex
  grammar/32-byte conversion, is committed at
  `samplingFrameAsOfMs <= seedCommittedAtMs < frameConstructedAtMs`, and is bound into `sfs1_` and
  `sfm1_`.
- Market-cap evidence binds exact prior-close result, shares value/effective date, source
  observation, authority version, durable capture, reduced rational, comparison rank/population,
  and unknown predicate.
- Liquidity evidence binds exactly 20 consecutive sessions, every close/volume source, the 15-valid
  minimum, exact median, comparison/tail ranks and populations, and unknown behavior.
- First-level specialized/standard and second-level cap/liquidity/session Hamilton passes have
  separate base/remaining-capacity definitions, exact remainder ties, capacity exhaustion, and
  deterministic candidate rank.
- The sole bootstrap seed literal recomputed as
  `c53a848e04b4d945a53529ae5b38521ed30911687fc2a5da82f9cac328837bc9`.
- `BOOT-WORD-01` recomputed digest
  `d61c7e091da9669460ab57eecf06483bc5250e38f3740827fb63813bc181d818`,
  uint64 `15428345001081923220`, and pool-180 index `60`.
- Pool-10 rejection limit recomputed as `18446744073709551610`; equality rejects and word `9`
  selects index `9`.
- Median and type-7 quantile literals recompute as documented. Holm has exactly 24 fixed slots,
  exact sign-test p-values, stable tie ordering, and no dynamic family shrink.

### Safety and compatibility

- H-001 explicitly fixes durable capture primary, exact inherited retrieval sensitivity,
  last-eligible `<=` point targets, and strict `< Tpub` release origin.
- Provider, dataset, feed, endpoint, entitlement, observation, revision, artifact, fact, selection,
  result, and study identities remain separate. Provider fallback fails closed while P1-09 is
  pending.
- The fixture boundary permits only original project-authored synthetic bytes and expressly forbids
  provider examples, provider/account/credential access, network use, subscription changes, and
  spend.
- The base-to-checkpoint diff is documentation/research/governance only. It changes no EventLog,
  ProcessingStore, ArtifactStore, observation-ledger, EventDraft, migration, dependency, Docker,
  broker/order, portfolio, position, fill, or financial-effect surface.

These repaired areas do not waive `R2D-FINAL-REAUDIT-001`.

## Validation evidence

The reviewer ran read-only checks against the exact checkpoint:

```text
git rev-parse HEAD
git status --short
git log --oneline --decorate -10
git diff --name-status 84ecd6c..HEAD
git diff --name-only 0377323..HEAD
git show --check --oneline 737ea8f
git diff --check 0377323..HEAD
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
node -e "<parse board and authority JSON>"
node -e "<recompute repository ordinary/collision vectors>"
node -e "<verify ten raw Git blobs, SHA-256, OIDs, commits, ordering, and car1_>"
node -e "<recompute bootstrap seed, word, rejection limit, and draw>"
PowerShell "<compare 84 numeric-bound and enforcement-ledger registries>"
node -e "<construct the two-release scc1_ collision>"
```

Results:

- `HEAD` resolved exactly to
  `737ea8fc236c07ea7bba635bda63abcc74126de3`;
- tracked Git state was clean before this audit write;
- authority, hash, reason, bound, seed, bootstrap, JSON, and whitespace recomputations produced the
  exact results recorded above;
- formatting passed for 115 files;
- lint passed for 115 files;
- typecheck passed;
- build passed;
- project-board and authority JSON parsed; and
- the base-to-checkpoint diff contains documentation/research/governance files only.

The complete coverage/mutation gate was intentionally not run in parallel with another agent's
potential full validation. Mechanical success does not resolve the semantic `scc1_` collision.

## Gate and repair disposition

P1-07 remains unaccepted. ADR 0010 must remain `Proposed`. P1-08 implementation authorization is
explicitly `false`.

Repair `R2D-FINAL-REAUDIT-001` in one reconciled semantic content commit, regenerate the external
authority registry for that commit, and assign another fresh independent reviewer to the new exact
clean checkpoint. No source, fixture, or study-validator implementation may begin from this
`NO_GO`, and this report does not authorize a status-only acceptance publication.
