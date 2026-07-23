# PR 2D independent contract gate audit

## Review record

- Binary verdict: `NO_GO`
- Implementation authorization: `false`
- Review date: `2026-07-23`
- Exact reviewed checkpoint:
  `acbad9a7757ac1d42f89769c217ef5075a0d1998`
- Contract-content commit:
  `8cdac9efc5b5044acafa088788539dbbb8868ef1`
- Previous reviewed checkpoint:
  `737ea8fc236c07ea7bba635bda63abcc74126de3`
- PR 2D base:
  `0377323b5486a8ad3b8e2631d4c8559760893be6`
- Reviewer: fresh independent review-only Luna agent
  `/root/luna_pr2d_contract_go_audit`
- Review worktree:
  `C:\Users\HyPol\.codex\visualizations\2026\07\19\019f7803-6765-73b3-9abf-959f6e73eda5\worktrees\pr-2d-market-reference-contract`

Every file-and-line reference in this report is bound to the exact reviewed checkpoint. Before this
audit write, `HEAD` resolved to the full reviewed SHA and `git status --short` was empty. This file
is the reviewer's only write. The reviewer did not edit, stage, commit, or implement any research,
contract, authority registry, governance, source, fixture, test, migration, dependency, or ignored
output.

## Reviewer independence and scope

The reviewer authored none of the PR 2D research, H-001 decision integration, ADR, contracts,
contract repairs, authority registries, board/roadmap changes, three prior audits, source, fixtures,
tests, or implementation. The reviewer also authored none of the inherited PR 2C observation
ledger, ArtifactStore, provider/source, frozen-port, entitlement, or no-trade evidence.

The review read the authoritative assignment and H-001 record, all three prior `NO_GO` audits,
ADR 0010, all eight PR 2D contract documents, the external authority registry, ADRs 0006 and 0009,
the PR 2C observation-ledger schema and implementation, the frozen EventLog, ProcessingStore, and
ArtifactStore interfaces, the entitlement boundary, roadmap/board state, and the exact
base-to-checkpoint diff. It independently re-audited the complete contract gate rather than
treating any prior verified area as approval.

## Binary verdict

`NO_GO` for
`acbad9a7757ac1d42f89769c217ef5075a0d1998`.

The semantic repair correctly adds `releaseKind` and `releaseClusterKey` to both normative
`scc1_` preimages and specifies deterministic release-basis, representative-evidence, collision,
and downstream-propagation rules. The published authority registry, repository hash framing, six
study preimages, reason catalogs, 84-bound registry, correction views, study seed/strata/analysis,
rejected-operation behavior, H-001 policy, zero-spend boundary, and frozen-port compatibility also
recompute or reconcile as described below.

One executable identity-vector blocker remains. All seven newly normative `SCC-*` vectors use an
issuer-mapping prefix and instrument prefix that contradict the inherited and PR 2D identity
contracts. Their displayed release keys and candidate IDs recompute only from those invalid inputs.
A conforming validator must reject the inputs before `scc1_` hashing, so the required golden vectors
cannot prove the repaired contract. P1-08 implementation is not authorized.

## Blocking finding

### R2D-GO-AUDIT-001 — the release-cluster golden vectors use invalid issuer and instrument identities

**Severity:** blocking identity, fixture-oracle, and executable-acceptance defect

The inherited issuer mapping family is exactly `imap1_`, and the PR 2D instrument family is exactly
`min1_`:

- `docs/contracts/pr-2d-provider-source-identity.md:253-263` preserves `imap1_` and defines
  `instrumentId = "min1_" + H(...)`;
- `src/providers/observation-ledger.ts:528-531` derives `imap1_`, while
  `src/providers/observation-ledger.ts:717-721` rejects an issuer mapping outside
  `^imap1_[0-9a-f]{64}$`; and
- `docs/contracts/pr-2d-fixture-manifest.md:410-411` and `:697-698` require the fixture validator to
  recompute inherited `imap1_` and direct `min1_` identities.

The newly normative literals instead set:

```text
issuerMappingId = "ism1_111...111"
instrumentId    = "ins1_222...222"
```

at `docs/contracts/pr-2d-study-freeze-manifest.md:1006-1016` and duplicate those values at
`docs/contracts/pr-2d-fixture-manifest.md:727-738`. Neither `ism1_` nor `ins1_` is an accepted
identity family.

The published values do hash exactly from the invalid literals. For example,
`SCC-Q-X-A` recomputes:

```text
releaseClusterKey =
e93fd5ecdb8f5b0f6d234f2791795b408e0046c85ebcdbf8be755d837a2acf7f

clusterCandidateId =
scc1_bdf356c3a2cc41610900efe5e0282619244e088282b831bf0cd6e71998f8c2be
```

as displayed at `docs/contracts/pr-2d-study-freeze-manifest.md:1023-1025` and
`docs/contracts/pr-2d-fixture-manifest.md:740-742`. Replacing only the two invalid families with
syntactically valid `imap1_111...111` and `min1_222...222` changes the same vector to:

```text
releaseClusterKey =
7295ea30815dd8e7bab8237b593278169f9521cfcf668fa0c9829356c0bcc731

clusterCandidateId =
scc1_80a38293eed93abad428321f93b20c09f8835773d9b438f933fe632ff24aa6cc
```

The key changes because `issuerMappingId` is an input to
`SHA-256(RFC8785({issuerMappingId,releaseKind,clusterBasis}))`; the candidate changes again because
both the key and `instrumentId` are in its exact eight-field preimage. Therefore every one of the
seven displayed key/ID pairs, plus the retired six-field collision literal, is bound to invalid
primitive identity families.

This directly contradicts the acceptance claim that each literal vector cross-validates all
candidate fields before hashing at `docs/contracts/pr-2d-acceptance-matrix.md:76-77`. It is not
enough that the low-level bytes produce distinct hashes: the fixture and study contracts require
the candidate to pass inherited identity validation before an `scc1_`, frame, selected cluster,
manifest, or dataset identity is emitted.

**Required repair:**

1. Define complete original-synthetic issuer-mapping and instrument primitive preimages for the
   literal vector family and use their recomputed `imap1_` and `min1_` values in both normative
   vector locations. A syntactically plausible but forged digest is not sufficient for the full
   fixture oracle.
2. Recompute all seven raw `releaseClusterKey` values, all seven eight-field `scc1_` values, and the
   retired six-field collision witness from those valid identities.
3. Keep the quarterly/annual, two cross-source-key, two native-schedule-ID, fiscal/native-basis,
   same-observation-item, stale-key, representative-evidence, and downstream
   `sfs1_`/`scl1_`/`sfm1_`/`sdf1_` mutation obligations, but pin their literal expectations from the
   corrected valid starting identities.
4. Regenerate every affected document SHA-256, Git blob OID, the ten-authority registry, and
   `car1_` for a new semantic content commit, then obtain another fresh independent exact-checkpoint
   review.

## Prior-finding disposition

### First audit

| First-audit finding | Current disposition |
| --- | --- |
| `R2D-CONTRACT-001` authority and selection/result preimages | `REPAIRED`: the external ten-authority registry and closed market/study/result preimages recompute. |
| `R2D-CONTRACT-002` fixture identities and reasons | `REOPENED_IN_PART`: the original source/acquisition/reason-shape defects are repaired, but the newly added cluster fixture literals violate the authoritative issuer/instrument identity families under `R2D-GO-AUDIT-001`. |
| `R2D-CONTRACT-003` correction view/cutoff contradiction | `REPAIRED`: one recorded-corpus view pair and exact durable cutoffs are consistent. |
| `R2D-CONTRACT-004` study schemas and reason catalog | `REPAIRED`: referenced types, 33-code study catalog, market preservation, and rejected-operation handling are closed. |
| `R2D-CONTRACT-005` sampling and secondary analysis | `PARTIALLY_REPAIRED`: clustering, seed, strata, allocation, bootstrap, Holm, and eight-field `scc1_` semantics are deterministic, but the required executable cluster literals cannot validate under `R2D-GO-AUDIT-001`. |
| `R2D-CONTRACT-006` non-binary bounds | `REPAIRED`: 84 numeric IDs have 84 sole enforcement-ledger dispositions and the fixture references that exact registry. |

### Second audit

| Second-audit finding | Current disposition |
| --- | --- |
| `R2D-REAUDIT-001` hash framing and study authority preimages | `REPAIRED`: repository length-prefixed framing, ten-authority binding, and all six duplicated study field lists reconcile. |
| `R2D-REAUDIT-002` reason details and fixture bound outcomes | `REPAIRED`: direct-key reasons and the 84-bound fixture/ledger authority have one common representation. |
| `R2D-REAUDIT-003` sampling strata and randomness | `REPAIRED` for the cited seed, evidence, comparison-population, two-level Hamilton, and bootstrap defects. |
| `R2D-REAUDIT-004` rejected market operations | `REPAIRED`: a rejected required operation atomically invalidates the dataset freeze and cannot forge a result identity. |

### Third audit

| Third-audit finding | Current disposition |
| --- | --- |
| `R2D-FINAL-REAUDIT-001` cluster identity omitted release-cluster identity | `PARTIALLY_REPAIRED`: both normative formulas now bind `releaseKind` and recomputed `releaseClusterKey`, and the old semantic collision is structurally removed. The required literal conformance corpus is invalid under the inherited issuer/instrument identity families, so executable closure remains blocked by `R2D-GO-AUDIT-001`. |

No prior `NO_GO` is superseded by this report. Each remains immutable evidence for its exact
reviewed SHA. This report controls only the exact checkpoint named above and is also `NO_GO`.

## Independently recomputed evidence

### Authority and repository hashes

- The registry contains exactly ten sorted unique logical authorities over nine distinct paths at
  content commit `8cdac9efc5b5044acafa088788539dbbb8868ef1`.
- Every raw Git blob's SHA-256, Git blob OID, path, and content commit matches
  `docs/audit/pr-2d-contract-authority.json`.
- The external registry recomputes exactly as
  `car1_c43fc356676cc346fb4d3d1e919c06be3edfe60923f06abb778e1e3bbf17e26b`.
- The checkpoint differs from the content commit only by the external authority JSON.
- Repository ordinary vector recomputed
  `6b2d9419f583fd8f1e317a03a25f14dbcaeb06a3e63bfe566ab9f33b1e39de97`.
- Framing witnesses `["ab","c"]` and `["a","bc"]` recomputed respectively
  `4e38029c6f73af0004b786cb417eaf3f4b06d9c4c23477e65a6a0136f0ef6ff8` and
  `31b5b621ccf61824923b45fb664e683a1f719e61aebe63cca5ebe1bbcf910ae3`.

### Study preimages, reasons, bounds, and analysis

- `std1_`, `sfs1_`, `scc1_`, `scl1_`, `sfm1_`, and `sdf1_` have byte-equivalent field lists in
  the provider/source and study contracts. `scc1_` now has exactly eight fields, including
  `releaseKind` and `releaseClusterKey`.
- All seven displayed release keys and `scc1_` values, and retired
  `scc1_ccbd0bbddcb06b722082461293abd6a0d704954f2b0db22d80dce712de7ebfa3`, recompute from the
  displayed bytes. This arithmetic success exposes rather than cures their invalid identity
  inputs.
- The reason catalogs contain 63/63 unique market codes and priorities and 33/33 unique study codes
  and priorities. Their direct-key tables contain 16 market and 17 study mappings.
- The three numeric-bound tables contain 84 unique IDs. Expanding the enforcement ledger yields
  exactly the same 84 unique IDs with no missing or extra entry: 50 operation, 2 candidate,
  4 metric, and 28 study-run dispositions.
- The fixture schema references `CanonicalBoundIdV1` and `BoundDispositionV1` directly, forbids
  local aliases, and requires the exact/upper/lower/count-minus-one vectors from that sole ledger.
- Bootstrap seed literal recomputed
  `c53a848e04b4d945a53529ae5b38521ed30911687fc2a5da82f9cac328837bc9`.
- `BOOT-WORD-01` recomputed digest
  `d61c7e091da9669460ab57eecf06483bc5250e38f3740827fb63813bc181d818`,
  uint64 `15428345001081923220`, and pool-180 index `60`.
- Pool-10 rejection limit is `18446744073709551610`; equality rejects and word `9` selects index
  `9`. Only one bootstrap derivation is normative.

### Semantics, safety, and compatibility

- H-001 explicitly fixes durable capture primary, the exact inherited retrieval basis as mandatory
  sensitivity, point selectors at `<=` target, and release origin at strict `<` publication.
- `recorded-primary` and `recorded-corrected` retain exact immutable-corpus admission and cutoff
  behavior without claiming provider-native knowledge.
- Release clustering defines exact fiscal, cross-source, and native-date bases, deterministic
  contributing evidence and representative selection, cross-field validation, duplicate behavior,
  and downstream dependency propagation. The remaining finding is the validity of its literal
  starting identities.
- Provider/dataset/feed/endpoint/entitlement identities remain separate. P1-09 remains `PENDING`;
  provider acquisition and fallback fail closed.
- Fixture provenance permits only project-authored original synthetic material and forbids provider
  bytes/examples, credentials/accounts, network use, subscription changes, and spend.
- The base-to-checkpoint diff changes 20 documentation/research/governance paths and no source,
  test, fixture body, migration, dependency, Docker, EventLog, ProcessingStore, ArtifactStore,
  observation-ledger, EventDraft, broker/order, portfolio, position, fill, or financial-effect
  surface.

These verified areas do not waive `R2D-GO-AUDIT-001`.

## Validation evidence

The reviewer ran read-only checks against the exact checkpoint:

```text
git rev-parse HEAD
git status --short
git log --oneline --decorate -12
git show --check --oneline acbad9a
git diff --name-status 8cdac9e..acbad9a
git diff --name-only 0377323..acbad9a
git diff --check 0377323..acbad9a
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
node -e "<parse project-board and authority JSON>"
node -e "<verify ten raw Git blobs, SHA-256, OIDs, commits, ordering, and car1_>"
node -e "<recompute repository ordinary/collision vectors>"
node -e "<compare all six study preimage field lists>"
node -e "<recompute 63/33 reasons and 16/17 direct-detail registries>"
node -e "<compare 84 numeric-bound and enforcement-ledger registries and dispositions>"
node -e "<recompute bootstrap seed, word, rejection limit, and draw>"
node -e "<recompute all seven release keys/scc1 values, retired collision, and valid-prefix mutation>"
```

Results:

- `HEAD` resolved exactly to
  `acbad9a7757ac1d42f89769c217ef5075a0d1998`;
- tracked Git state was clean before this audit write;
- authority, framing, study-preimage, reason, bound, seed, bootstrap, JSON, and whitespace
  recomputations produced the exact results recorded above;
- formatting passed for 115 files;
- lint passed for 115 files;
- typecheck passed;
- build passed;
- project-board and authority JSON parsed; and
- the base-to-checkpoint diff contains documentation/research/governance files only.

The complete mutation/coverage gate was intentionally not run because this is a documentation-only
contract gate and the assignment requested formatting, lint, typecheck, build, diff, JSON, and
targeted deterministic recomputation rather than full mutation. Mechanical success does not make
the invalid golden identity inputs executable.

## Gate disposition

P1-07 remains unaccepted. ADR 0010 must remain `Proposed`. P1-08 implementation authorization is
explicitly `false`.

Repair `R2D-GO-AUDIT-001` in one reconciled semantic content commit, regenerate the external
authority registry for that commit, and assign another fresh independent reviewer to the new exact
clean checkpoint. No source, fixture, or study-validator implementation may begin from this
`NO_GO`, and this report does not authorize a status-only acceptance publication.
