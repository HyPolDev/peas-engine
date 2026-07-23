# PR 2D independent repaired-contract re-audit

## Review record

- Binary verdict: `NO_GO`
- Implementation authorization: `false`
- Review date: `2026-07-23`
- Exact reviewed repaired checkpoint:
  `726f1690ce80562a1e9a452a26bf90849f04d08f`
- Contract-content commit:
  `b6e89fb18755f8ff2ac0f67d046ead043063236e`
- Previous contract checkpoint:
  `7c484124680972b5cbbd39f31cf69b542a6341cc`
- PR 2D base:
  `0377323b5486a8ad3b8e2631d4c8559760893be6`
- Reviewer: fresh independent review-only Luna agent
  `/root/luna_pr2d_contract_reaudit`
- Review worktree:
  `C:\Users\HyPol\.codex\visualizations\2026\07\19\019f7803-6765-73b3-9abf-959f6e73eda5\worktrees\pr-2d-market-reference-contract`

Every file-and-line reference in this report is bound to the exact reviewed checkpoint. Before
review, `HEAD` resolved to the full reviewed SHA and the tracked worktree was clean. This audit file
is the reviewer's only write. The reviewer did not edit, stage, commit, or implement any contract,
source, fixture, test, governance, migration, dependency, or ignored test-output file.

## Reviewer independence

The reviewer authored none of the PR 2D research, H-001 decision integration, ADR, contract repair,
authority registry, first audit, roadmap, board, source, fixture, test, or implementation content.
The reviewer also authored none of the inherited PR 2C observation-ledger, ArtifactStore,
provider/source, frozen-port, entitlement, or no-trade evidence.

The review read the authoritative assignment, H-001 record, first `NO_GO`, repaired ADR 0010, all
eight PR 2D contract documents, the external authority registry, ADRs 0006 and 0009, the PR 2C
observation-ledger schema, the relevant roadmap/board state, and the exact repaired-checkpoint diff.
It independently re-audited every former blocker and the complete contract gate.

## Binary verdict

`NO_GO` for
`726f1690ce80562a1e9a452a26bf90849f04d08f`.

The repair is substantial. The external registry binds ten sorted logical authorities to nine
immutable document blobs and recomputes exactly. H-001, the last-at-or-before selectors, strict
pre-publication origin, quote/trade/bar separation, recorded-corpus correction semantics, closed
market/study code counts, provider/entitlement separation, synthetic-only fixture boundary,
zero-spend rule, effect isolation, and frozen-port preservation are all materially improved.

Four consolidated blockers nevertheless remain:

1. the normative hash framing and study identity preimages contradict the repository and one
   another;
2. canonical reason-detail and bound-oracle schemas still cannot encode one common result;
3. the sampling seed and market-cap/liquidity strata are not recomputable pre-outcome facts, and
   the bootstrap contract contains two derivations; and
4. the dataset-freeze schema requires a result identity for a rejected operation even though the
   market contract forbids such an identity.

Independent implementations can therefore derive different IDs, reason bytes, bound outcomes,
cohorts, and dataset records while claiming V1 conformance. P1-08 implementation is not authorized.

## Blocking findings

### R2D-REAUDIT-001 — hash framing and study authority preimages are contradictory

**Severity:** blocking identity, authority, and replay defect

The identity contract says that every V1 identity is
`SHA-256(domainSeparator || 0x00 || RFC8785(preimage))` at
`docs/contracts/pr-2d-provider-source-identity.md:10-22`. The repository implementation instead
hashes each part with an unsigned eight-byte big-endian length prefix at `src/core/hash.ts:9-27`.
The published authority record was correctly generated with the repository implementation, not
with the documented zero-separator formula:

```text
repository canonicalHash:
car1_33a2b2caacbd33833b91fc3a0fee0fb2adc43c0ee0cd70679c5767431f18b119

documented domain || 0x00 || RFC8785:
car1_8164b6720dbe9ee549c6725a6aa241f73744878df93c36a1ebba2fff4b4d1e83
```

This is not a display-only difference: the acceptance matrix requires literal golden
domain/preimage vectors, and every downstream ID depends on the selected hash framing.

The study identities also have two incompatible authoritative preimages:

- the provider/source contract includes `contractAuthorityRegistryId` in `std1_` at
  `docs/contracts/pr-2d-provider-source-identity.md:712-720`, but the study formula omits it at
  `docs/contracts/pr-2d-study-freeze-manifest.md:45-50` and `StudyDesignV1` has no such field at
  `docs/contracts/pr-2d-study-freeze-manifest.md:93-111`;
- the provider/source contract includes `contractAuthorityRegistryId` in `sfm1_` at
  `docs/contracts/pr-2d-provider-source-identity.md:738-746`, but the study formula and
  `StudyFreezeManifestV1` omit it at
  `docs/contracts/pr-2d-study-freeze-manifest.md:64-71` and `:371-405`; and
- the provider/source contract says `acceptedContractIds` and `contractIds` contain exactly nine
  logical IDs at `docs/contracts/pr-2d-provider-source-identity.md:757-763`, while the validated
  registry and acceptance matrix contain exactly ten logical authorities at
  `docs/contracts/pr-2d-provider-source-identity.md:53-63`,
  `docs/audit/pr-2d-contract-authority.json:1-77`, and
  `docs/contracts/pr-2d-acceptance-matrix.md:27-45`.

Consequently a study design or freeze cannot simultaneously satisfy both normative documents or
prove which accepted bytes it uses.

**Required repair:**

1. Make the normative hash framing exactly the existing length-prefixed repository
   `canonicalHash`, or deliberately version and implement another function; do not describe one
   while publishing the other.
2. Pin literal golden canonical bytes and hashes for both framing-collision and ordinary vectors.
3. Add `contractAuthorityRegistryId` to the exact study design/freeze schemas and both local
   preimages, or remove it consistently from the provider contract with an equally immutable
   replacement.
4. Require the exact ten logical authorities, not nine, and add missing/extra/reordered vectors.
5. Recompute every affected document digest, blob OID, authority registry ID, study ID, and
   fixture golden after the semantic repair.

### R2D-REAUDIT-002 — reason details and fixture bound outcomes have incompatible closed shapes

**Severity:** blocking reason, fixture-oracle, and exact-bound defect

The provider/source contract defines canonical market details as
`{field:<literal>,value:<enum>}` at
`docs/contracts/pr-2d-provider-source-identity.md:398-418`. That union omits
`market.bound-exceeded`'s required `limitKind` entirely. The normative reason catalog instead
requires a detail field named directly by each row, including `limitKind`, `qualityKind`, and the
other exact detail keys at `docs/contracts/pr-2d-reason-codes.md:37-60`. The resource contract uses
a separate `reason` and `detail` in `BoundDispositionV1` and requires
`{limitKind:<boundId>}` at `docs/contracts/pr-2d-resource-bounds.md:60-80`.

The fixture oracle selects a fourth representation:

- `SyntheticExercisedBoundV1.expectedReason` is
  `{code:"market.bound-exceeded",detail:null}` with a separate `limitKind` at
  `docs/contracts/pr-2d-fixture-manifest.md:641-647`; and
- the fixture prose explicitly requires null reason detail plus separate `limitKind` at
  `docs/contracts/pr-2d-fixture-manifest.md:650-659`.

No exact total mapping is defined. A bound result therefore cannot be both the canonical
`{code,detail}` reason used in candidate/result hashes and the fixture's expected value.

The fixture-bound registry is also not reconciled with the canonical 84-bound ledger. It introduces
different names such as `fixture.manifest-bytes` at
`docs/contracts/pr-2d-fixture-manifest.md:710-745` without an alias-to-canonical-ID table. It then
says every maximum has a one-over `market.bound-exceeded` result at `:747-750`, although the
canonical ledger assigns quote-age +1 to candidate `market.quote-stale` and capture/retrieval-lag
+1 to metric-local `market.timestamp-insufficient` at
`docs/contracts/pr-2d-resource-bounds.md:147-162` and `:227-245`. The acceptance matrix requires the
one exact disposition for all 84 canonical IDs at
`docs/contracts/pr-2d-acceptance-matrix.md:160-176`.

This leaves former findings R2D-CONTRACT-002 and R2D-CONTRACT-006 open for the executable oracle.

**Required repair:**

1. Define one exact canonical market detail object shape and use it in provider identities,
   reasons, candidates, results, bounds, fixtures, study preservation, and acceptance evidence.
2. Include `limitKind` in that closed type and forbid a second parallel detail channel.
3. Replace fixture-only bound aliases with the exact 84 canonical IDs, or add a complete
   one-to-one versioned mapping and prove it in both directions.
4. Make each fixture bound vector carry the exact canonical stage, vector kind, reason/detail, and
   atomicity from the enforcement ledger, including candidate- and metric-local outcomes.
5. Add exact/upper/lower/count-minus-one, forged-detail, and result-ID recomputation vectors after
   the shapes agree.

### R2D-REAUDIT-003 — sampling strata and randomness remain caller assertions

**Severity:** blocking prospective sampling, leakage, and reproducibility defect

`StudyFreezeManifestV1` accepts `rankSeedHex` as an unconstrained string at
`docs/contracts/pr-2d-study-freeze-manifest.md:371-405`. The ranking algorithm later consumes an
undefined `rankSeedBytes` at `:701-706`, and bootstrap seed derivation consumes it again at
`:881-889`. The contract does not define:

- exact byte length or lowercase-hex grammar;
- conversion from `rankSeedHex` to `rankSeedBytes`;
- derivation or external authority;
- the point at which it becomes immutable; or
- a rule requiring it to be committed before the frame is visible.

The frame snapshot preimage at `docs/contracts/pr-2d-study-freeze-manifest.md:51-55` does not bind
the seed. An operator can therefore inspect the frozen frame, try seeds, and choose one that changes
the 180 selected identities before publishing the manifest. This is sampling leakage even if no
market outcome has yet arrived.

The stratum inputs are likewise not fully recomputable:

- a frame entry contains only a caller-supplied `marketCapStratum` enum at
  `docs/contracts/pr-2d-study-freeze-manifest.md:430-477`; no market-cap value, shares/value date,
  source observation, authority version, as-of evidence, or missing predicate exists anywhere in
  the schema;
- liquidity candidates carry only a session count and an asserted median at
  `docs/contracts/pr-2d-study-freeze-manifest.md:502-514`, while the prose requires agreement with
  “retained session evidence” that the hashed frame schema does not carry at `:612-629`; and
- the tertile algorithm at `docs/contracts/pr-2d-study-freeze-manifest.md:708-712` does not state
  the exact comparison population for each dimension or bind a value/evidence record to the
  resulting market-cap and liquidity labels consumed by allocation at `:714-731`.

The allocation text also says to apply “the same loop” within awarded groups at
`docs/contracts/pr-2d-study-freeze-manifest.md:725-728`, but the loop's base-seat rule is defined
only for model-family and sector groups, not the second-level cap/liquidity/session cells. Two
implementations can assign different cell seats.

Finally, the summary bootstrap formula derives replicate `i` from
`SHA256("peas/study-bootstrap/v1" || seed || uint64be(i))` at
`docs/contracts/pr-2d-study-freeze-manifest.md:867-872`, while the detailed algorithm derives a
different bootstrap seed and per-draw words under `peas/study-bootstrap-word/v1` at `:881-918`.
The first digest is unused by the detailed algorithm and no supersession rule selects one.

These gaps leave former R2D-CONTRACT-005 open despite the otherwise useful release-clustering,
control-ranking, bootstrap, and Holm detail added by the repair.

**Required repair:**

1. Derive one exact fixed-length seed from immutable evidence committed before the frame, or bind a
   separately reviewed external seed record with exact timing and authority.
2. Add exact market-cap and liquidity source/value/session evidence, as-of rules, identities, and
   recomputation predicates to the frame preimage.
3. Define the exact comparison population, tie behavior, unknown behavior, and validation for each
   stratum.
4. Define the second-level Hamilton base/award rule explicitly rather than referring to an
   inapplicable first-level loop.
5. Remove one bootstrap derivation or define an exact relationship and use for both; pin literal
   draw, rejection, median, and quantile vectors.
6. Prove seed-selection resistance, changed-evidence sensitivity, and byte-identical membership
   across independent implementations.

### R2D-REAUDIT-004 — rejected market operations cannot enter the required dataset schema

**Severity:** blocking dataset-freeze and fixed-denominator schema defect

The study vocabulary includes `rejected` as a valid result status at
`docs/contracts/pr-2d-study-freeze-manifest.md:124-130`. The market eligibility contract says a
rejected operation emits neither a selected nor missing identity at
`docs/contracts/pr-2d-market-eligibility.md:493-518`, and the provider/source contract repeats that
rule at `docs/contracts/pr-2d-provider-source-identity.md:697-710`.

`StudyReferenceAccountingV1` nevertheless requires a non-null `marketResultId:string` for every
status, including `rejected`, at
`docs/contracts/pr-2d-study-freeze-manifest.md:997-1005`. The dataset requires six primary rows and
preserved reasons at `:1072-1085`. A rejected operation therefore has no legal value for a required
field. Forging an `mmr1_` would violate the market contract; omitting the row would violate the fixed
180-cluster denominator contract.

The same conflict affects `StudyReasonV1`: when market evidence is preserved,
`marketResultId` and `preservedMarketReason` must both exist at
`docs/contracts/pr-2d-reason-codes.md:189-238`, but no immutable result exists for an
operation-terminal rejection.

**Required repair:**

1. Decide whether an operation rejection invalidates the entire dataset freeze, or define a
   separate immutable rejected-operation outcome identity.
2. If rejected references remain in the dataset, model selected, missing, and rejected accounting
   as exact disjoint variants with correct ID nullability.
3. Update study-reason preservation and the six-row denominator rule consistently.
4. Add rejected authority/bounds/identity cases proving that no missing ID is forged and no frozen
   cluster disappears.

## Prior-finding disposition

| First-audit finding | Re-audit disposition |
| --- | --- |
| `R2D-CONTRACT-001` authority and selection/result preimages | `PARTIALLY_REPAIRED`: external registry and market policy/result preimages are materially closed; hash framing and study registry preimages remain contradictory under `R2D-REAUDIT-001`. |
| `R2D-CONTRACT-002` fixture identities and reasons | `PARTIALLY_REPAIRED`: primitive source/acquisition/instrument/corpus identities are now represented; reason-detail and bound-oracle closure remains open under `R2D-REAUDIT-002`. |
| `R2D-CONTRACT-003` correction view/cutoff contradiction | `REPAIRED`: one `recorded-primary|recorded-corrected` pair now defines immutable corpus membership and exact cutoff admission without claiming native-provider knowledge. |
| `R2D-CONTRACT-004` study schemas and reason catalog | `PARTIALLY_REPAIRED`: the 33-code catalog and formerly undefined types are present; rejected-reference accounting remains impossible under `R2D-REAUDIT-004`, and study authority binding remains inconsistent under `R2D-REAUDIT-001`. |
| `R2D-CONTRACT-005` sampling and secondary analysis | `PARTIALLY_REPAIRED`: clustering, controls, sign tests, Holm, and detailed bootstrap logic improved; seed/stratum/allocation and competing bootstrap derivations remain open under `R2D-REAUDIT-003`. |
| `R2D-CONTRACT-006` non-binary bounds | `PARTIALLY_REPAIRED`: the canonical enforcement ledger now has 84 unique IDs with sole dispositions; fixture aliases and reason/detail outcomes contradict it under `R2D-REAUDIT-002`. |

## Reviewed areas without an additional blocking finding

- The external registry has ten sorted unique logical authorities over nine paths. Every
  `documentSha256`, Git blob OID, content commit, and the published `car1_` recomputed under the
  repository `canonicalHash`.
- H-001 explicitly fixes durable capture primary, the inherited retrieval basis as mandatory
  sensitivity, `<=` point selectors, and strict `< Tpub` release origin. No implicit/default or
  first-after selector remains.
- `recorded-primary` is now exactly first immutable verified corpus membership;
  `recorded-corrected` adds revisions durably recorded at/before capture T0 plus seven days.
  Final-corrected-only data cannot claim primary membership. The contract no longer conflates this
  with provider-native or PEAS-known-at-market-target state.
- The canonical reason document contains exactly 63 unique `market.*` and 33 unique `study.*`
  definitions. The remaining finding concerns representation, not missing code names.
- Provider/dataset/feed/endpoint/entitlement identities remain separate. P1-09 remains pending,
  provider/fallback selection fails closed, and no provider acquisition is authorized.
- Fixture provenance permits only original project-authored synthetic material and forbids provider
  bytes, examples, credentials, accounts, network access, subscription activation, or spend.
- The exact checkpoint diff is documentation-only. It changes no source, fixture body, test,
  dependency, migration, Docker, EventLog, ProcessingStore, ArtifactStore, observation-ledger,
  EventDraft, broker/order, portfolio, or financial-effect surface.

These observations do not waive the blocking findings.

## Validation evidence

The reviewer ran read-only checks against the exact checkpoint:

```text
git rev-parse HEAD
git status --short
git log --oneline --decorate -10
git diff --name-status 7c484124680972b5cbbd39f31cf69b542a6341cc..HEAD
git diff --name-only 0377323b5486a8ad3b8e2631d4c8559760893be6..HEAD
git show --check --oneline 726f1690ce80562a1e9a452a26bf90849f04d08f
git diff --check 0377323b5486a8ad3b8e2631d4c8559760893be6..HEAD
biome format --no-errors-on-unmatched <git-ls-files batches>
biome lint --no-errors-on-unmatched <git-ls-files batches>
npm.cmd run typecheck
node -e "<parse board and authority JSON>"
PowerShell/Get-FileHash plus git rev-parse <content-commit>:<path>
node -e "<recompute car1_ with repository canonicalHash framing>"
node -e "<recompute car1_ with documented zero-separator framing>"
```

Results:

- `HEAD` resolved exactly to
  `726f1690ce80562a1e9a452a26bf90849f04d08f`;
- the tracked tree was clean before this audit write;
- all ten authority entries matched their committed SHA-256, Git blob OID, path, and content commit;
- the published registry ID recomputed as
  `car1_33a2b2caacbd33833b91fc3a0fee0fb2adc43c0ee0cd70679c5767431f18b119`;
- the documented zero-separator formula recomputed different bytes as
  `car1_8164b6720dbe9ee549c6725a6aa241f73744878df93c36a1ebba2fff4b4d1e83`;
- the canonical resource tables contain 84 unique bound IDs;
- the reason catalog scan found 63/63 unique market definitions and 33/33 unique study
  definitions;
- tracked-file formatting and lint passed;
- typecheck passed;
- Git whitespace checks passed;
- board and authority JSON parsed; and
- the base-to-checkpoint diff contains documentation/research/governance files only.

A concurrently terminated full gate left an ignored `.audit-mutation-*` test directory. The reviewer
did not inspect it as contract evidence, delete it, or count it as a checkpoint failure. Biome was
therefore rerun against the exact tracked-file set. The tracked Git state remained clean.

## Gate and repair disposition

P1-07 remains unaccepted. ADR 0010 must remain `Proposed`. P1-08 implementation authorization is
explicitly `false`.

Repair all four consolidated findings in one reconciled semantic checkpoint, regenerate the
external authority registry for the new content commit, and assign another fresh independent
reviewer to that exact clean SHA. The next reviewer must re-run the full gate and must not treat the
verified portions of this `NO_GO` as approval for unchanged contradictory sections.
