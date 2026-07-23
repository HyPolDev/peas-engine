# PR 2D independent contract review

## Review record

- Binary verdict: `NO_GO`
- Implementation authorization: `false`
- Review date: `2026-07-23`
- Exact reviewed contract checkpoint:
  `7c484124680972b5cbbd39f31cf69b542a6341cc`
- Checkpoint parent: `cbec6e00259b17bdec59fcc20608f66f90896b71`
- PR 2D base: `0377323b5486a8ad3b8e2631d4c8559760893be6`
- Reviewer: fresh independent review-only Terra agent
  `/root/terra_pr2d_contract_audit`
- Review worktree:
  `C:\Users\HyPol\.codex\visualizations\2026\07\19\019f7803-6765-73b3-9abf-959f6e73eda5\worktrees\pr-2d-market-reference-contract`

Every file-and-line reference in this report is bound to the exact reviewed checkpoint. The
worktree was clean and `HEAD` equaled the full reviewed SHA before review began. This audit file is
the reviewer's only write. The reviewer did not edit, stage, commit, or implement any contract,
source, fixture, test, governance, migration, or dependency file.

## Reviewer independence

The reviewer authored none of the four PR 2D research reports, H-001 integration, ADR 0010,
provider/identity, timestamp, eligibility, reason, resource, fixture, acceptance, study, roadmap, or
board content. The reviewer also authored none of the inherited PR 2C observation-ledger,
ArtifactStore, provider identity, frozen-port, entitlement, or no-trade disposition evidence.

The review read the authoritative assignment and orchestration record, all four PR 2D research
reports, ADR 0010, all eight PR 2D contract files, ADR 0009, the PR 2C observation-ledger and
provider/source contracts, the observation-ledger implementation, the ArtifactStore contract and
durable implementation, entitlement and no-trade dispositions, roadmap, board, and the exact
checkpoint diff.

## Binary verdict

`NO_GO` for
`7c484124680972b5cbbd39f31cf69b542a6341cc`.

The approved H-001 durable-capture primary and as-of target selectors are represented correctly in
the ADR, timestamp, and eligibility prose. Provider/dataset/feed/endpoint/entitlement separation,
P1-09 fail-closed treatment, synthetic-only redistribution boundary, no-spend rule, effect
isolation, and the docs-only preservation of frozen ports are also directionally sound.

The checkpoint nevertheless contains unresolved identity preimages, contradictory correction and
reference vocabularies, incomplete fixture and study schemas, non-deterministic sampling/analysis
steps, and bounds with more than one permitted one-over disposition. Those defects make the
contract impossible to implement and test as one exact deterministic V1. P1-08 implementation is
not authorized.

## Blocking findings

### R2D-CONTRACT-001 — contract authority and selection/result identity preimages are not closed

**Severity:** blocking identity and replay contract defect

The acceptance matrix requires every logical contract ID to be bound to an accepted document
digest or commit before the contract checkpoint, but the checkpoint contains only logical names and
mutable semantic descriptions at `docs/contracts/pr-2d-acceptance-matrix.md:27-43`. Repository-wide
search at the exact checkpoint finds no logical-ID-to-digest/commit registry. Consequently
`acceptedContractIds` and `contractIds` cannot prove which bytes were accepted.

The selection identity is also not an exact primitive preimage. Its formula names
`intervalDefinitions`, `sourcePolicy`, `providerPriority`, `eligibilityPolicy`, `stalenessPolicy`,
`correctionPolicy`, and `tieBreakPolicy` without defining their exact closed shapes at
`docs/contracts/pr-2d-provider-source-identity.md:290-312`. Selected and missing identities then
hash undefined `intervalKey`, `referenceKind`, and `asOfBasis` values at
`docs/contracts/pr-2d-provider-source-identity.md:314-333`; no contract defines an `intervalKey`
derivation or the exact `asOfBasis` result shape. The acceptance matrix compounds the ambiguity by
calling durable capture an “implicit/default” primary while requiring explicit-policy failure in
the same row at `docs/contracts/pr-2d-acceptance-matrix.md:73-79`.

This prevents independent displayed-ID recomputation, policy-change isolation, stable missing
identity, and page/restart/backend replay proof.

**Required repair:**

1. Add an immutable registry mapping every logical contract ID to the exact accepted document
   digest and checkpoint/publication commit.
2. Define exact closed schemas, canonical ordering, nullability, bounds, and version identities for
   interval, source/provider priority, eligibility, staleness, correction, tie-break, discrepancy
   comparison, and as-of-basis policy values.
3. Define a deterministic `intervalKey` derivation and one closed reference-kind registry.
4. Make all displayed policy/result IDs recomputable from primitive preimages, with forged-ID
   vectors.
5. Remove “implicit/default”; durable capture must be accepted only through the explicit H-001
   policy.

### R2D-CONTRACT-002 — the fixture schema cannot recompute the identities or expected reasons it claims

**Severity:** blocking fixture, provenance, and executable-test contract defect

The fixture contract says every displayed ID is recomputed from validated primitive preimages at
`docs/contracts/pr-2d-fixture-manifest.md:50-63`, but its source profile contains only displayed
`providerId`, `datasetId`, `feedId`, `endpointChannelId`, `entitlementSnapshotId`, and an undefined
`profileId`; it contains none of the primitive provider/dataset/feed/endpoint/entitlement preimages
at `docs/contracts/pr-2d-fixture-manifest.md:65-109`.

The acquisition schema similarly supplies `acquisitionAttemptId`, `routePolicyId`, instruments,
window, and paging fields at `docs/contracts/pr-2d-fixture-manifest.md:112-140`, while the
authoritative `maq1_` preimage requires provider, dataset, feed, endpoint, entitlement, requested
fact kinds, sort order, and `routePolicyVersion` at
`docs/contracts/pr-2d-provider-source-identity.md:165-187`. The fixture neither carries a
`marketAcquisitionId` nor defines how one source profile is chosen when several profiles exist, so
its `mdl1_` delivery IDs cannot be recomputed. It additionally invents an
`instrumentVersionId`/predecessor-version identity with no domain or preimage at
`docs/contracts/pr-2d-fixture-manifest.md:163-188`, whereas the provider contract defines the
effective version directly as `instrumentId`.

The executable oracle also cannot represent the canonical reason contract. Expected results and
reason traces contain `primaryReason` and `diagnosticFlags` but no required `reasonDetail` object at
`docs/contracts/pr-2d-fixture-manifest.md:293-340`. The reason catalog requires exact detail enums
for fifteen codes, including degraded quote quality, at
`docs/contracts/pr-2d-reason-codes.md:34-56`; those details enter `candidateSetHash` and missing
identity at `docs/contracts/pr-2d-provider-source-identity.md:314-340`. Required fixtures such as a
locked quote therefore cannot express the expected `qualityKind`, candidate hash, or missing ID.

Finally, the fixture uses `as-recorded|later-corrected`, reference kinds
`nbbo-midpoint|last-eligible-trade|completed-bar|official-close`, result statuses
`complete|degraded|missing|rejected`, and `diagnosticFlags` at
`docs/contracts/pr-2d-fixture-manifest.md:253-340`. The normative market contract instead closes
`quote-nbbo-midpoint|trade-last-eligible-consolidated|bar-one-minute-completed-close|
prior-listing-official-close`, `selected-complete|selected-degraded|missing|rejected`, and
`diagnosticCodes` at `docs/contracts/pr-2d-market-eligibility.md:27-48` and `:479-497`. No mapping
or separate fixture-only layer is defined.

**Required repair:**

1. Carry or reference an immutable, bounded synthetic source registry containing every primitive
   preimage needed to recompute source, entitlement, acquisition, instrument, artifact, observation,
   revision, fact, policy, and result IDs.
2. Replace or define `profileId`, `acquisitionAttemptId`, `instrumentVersionId`, calendar/policy
   identities, and every other displayed ID; reconcile the acquisition schema exactly with
   `marketAcquisitionId`.
3. Use the one canonical view, reference-kind, result-status, and diagnostics vocabulary across all
   contracts, or define an exact total mapping before hashing.
4. Add required reason-detail objects to expected candidates/results/traces and prove that the
   fixture oracle can recompute candidate-set, selected, and missing identities in both directions.

### R2D-CONTRACT-003 — correction-view names and cutoffs describe different scientific datasets

**Severity:** blocking correction, replay, and study-leakage defect

The provider identity, timestamp, and eligibility contracts freeze `as-known|corrected`. They admit
market revisions to the primary view only when authoritative PEAS durable capture is at or before
the metric-specific `T0/T1/T5/T30` cutoff, and use a corrected cutoff of exactly capture T0 plus
seven 24-hour periods at `docs/contracts/pr-2d-provider-source-identity.md:309-312` and `:348-351`,
`docs/contracts/pr-2d-timestamp-trust.md:356-398`, and
`docs/contracts/pr-2d-market-eligibility.md:453-477`.

The fixture and study instead freeze `as-recorded(cutoffObservationId)|later-corrected` at
`docs/contracts/pr-2d-fixture-manifest.md:253-284` and
`docs/contracts/pr-2d-study-freeze-manifest.md:394-445`. The study expressly says the as-recorded
corpus cutoff must not be called known-at-market-time without native arrival evidence. The
acceptance matrix nevertheless tests only the as-recorded/later-corrected names at
`docs/contracts/pr-2d-acceptance-matrix.md:104-115`.

A corpus cutoff observation, PEAS durable capture by each market target, and native provider
revision arrival are not interchangeable. They can include different originals/corrections and
therefore change completeness, prices, identities, and E1. The contract does not define which
clock admits an original market fact obtained from delayed historical data, or how the per-metric
cutoff relates to `correctionCutoffObservationId`.

**Required repair:**

1. Choose one closed pair of view names and define the exact admission predicate for originals,
   corrections, and cancellations.
2. State whether the primary claim is known by PEAS at each metric target, present in a named
   immutable recorded corpus, or native-provider-as-known; do not conflate them.
3. Bind every cutoff to exact timestamp/basis/observation evidence and encode it in
   `selectionPolicyId` and the selected/missing result.
4. Specify the behavior for delayed/final-corrected-only providers and prove exact before/at/after
   cutoff vectors in both views.

### R2D-CONTRACT-004 — the study schemas and closed study reason catalog are incomplete

**Severity:** blocking manifest, denominator, and reason-closure defect

`StudyDesignV1` references undefined `StudyMetricDefinitionV1` and
`StudyGateThresholdV1` types at `docs/contracts/pr-2d-study-freeze-manifest.md:93-135`.
`StudyFrameSnapshotV1` references undefined `FrameDispositionCountV1` at
`docs/contracts/pr-2d-study-freeze-manifest.md:214-228`, and `StudyDatasetFreezeV1` references
undefined `StudyDenominatorTableV1` at
`docs/contracts/pr-2d-study-freeze-manifest.md:518-548`. These values are inside hashed preimages or
the fixed-denominator evidence, so prose cannot substitute for their missing exact shapes,
nullability, ordering, identity rules, and bounds.

The acceptance registry claims one closed market/study reason authority at
`docs/contracts/pr-2d-acceptance-matrix.md:33-43`, but the reason contract defines only the 63
`market.*` values and explicitly leaves `study.*` to a separate layer at
`docs/contracts/pr-2d-reason-codes.md:25-32`. The study contract merely lists eight example fatal
codes at `docs/contracts/pr-2d-study-freeze-manifest.md:584-594`; it supplies no complete registry,
priority, disposition, detail, applicability, or identity rule. Several required research
dispositions and annotations are therefore absent from the normative contract.

**Required repair:**

1. Define every referenced study type completely, including metric/gate formulas, frame
   dispositions, per-cluster denominator rows, typed attrition, and stable missing annotations.
2. Add one complete closed `study.*` catalog with deterministic priority, scope, details, and tests,
   or explicitly version a separate catalog and bind its digest into `StudyDesignV1`.
3. Specify exact cross-layer preservation of the underlying `market.*` reason without replacing it
   with a generic study reason.
4. Add forged/missing/extra-field, reason-priority, full-denominator, and exact/one-over vectors for
   every new schema.

### R2D-CONTRACT-005 — prospective sampling and secondary analysis are not deterministic enough to freeze

**Severity:** blocking sampling, threshold-leakage, and reproducibility defect

The study schema leaves `sectorStratum` and `modelFamily` as arbitrary strings and names four
non-canonical reference kinds at `docs/contracts/pr-2d-study-freeze-manifest.md:238-278`. It later
refers to “the frozen nine labels from the research contract” without listing them or giving a
normative label-policy preimage at `:309-324`. The contract says to select five controls per group,
but does not specify which five win when a group has more than five eligible candidates. The
Hamilton algorithm at `:326-350` allocates specialized and standard cells, not the oversubscribed
control groups.

The frame also lacks the independently proposed deterministic rules for collapsing multiple
schedule-source observations into one release cluster and for choosing one share class. It only
says duplicate share-class alternatives are dispositions at
`docs/contracts/pr-2d-study-freeze-manifest.md:297-307`. Because
`clusterCandidateId` includes `scheduleSourceObservationId`, two sources for one planned release
become different candidates unless a missing clustering rule intervenes. These gaps permit lane,
control, stratum, and membership choices after the frame is visible.

The analysis freeze is also under-specified. The 32-byte SHA-256 value described for bootstrap
replicate `i` supplies only four 64-bit words; no counter expansion/PRNG, draw count, per-lane sample
size, missing-value handling, or output ordering is defined at
`docs/contracts/pr-2d-study-freeze-manifest.md:474-495`. The fixed 24 Holm slots name metrics and
groups but do not define hypotheses, test statistics, or p-value algorithms. Independent
implementations cannot produce byte-identical bootstrap intervals or p-values.

**Required repair:**

1. Freeze the exact sector and nine specialized/standard label registries and their authority,
   version, as-of evidence, and unknown behavior.
2. Define release clustering, schedule-source precedence/revision handling, fiscal-period
   ambiguity, duplicate detection, and deterministic share-class selection.
3. Define rank-based or otherwise exact selection for oversubscribed control groups, including ties
   and insufficient capacity.
4. Fully specify bootstrap stream expansion, sampling with replacement, lane sample sizes,
   missingness, statistic, quantile, serialization, and output ordering.
5. Define every optional Holm slot's hypothesis, statistic, exact p-value method, ties, and
   unavailable-data behavior, or remove the unexecutable analysis from V1.

### R2D-CONTRACT-006 — several exact bounds permit contradictory one-over behavior

**Severity:** blocking hostile-input and acceptance-boundary defect

The bounds contract requires every one-over vector to fail with one stable reason at
`docs/contracts/pr-2d-resource-bounds.md:185-204`, and its global rule forbids silent split after
the public boundary at `:32-58`. Individual rows nevertheless permit multiple outcomes:

- a 65-byte timestamp is “timestamp invalid/bound exceeded” rather than one exact reason at
  `docs/contracts/pr-2d-resource-bounds.md:80-85`;
- a 21-digit primary coefficient is “ineligible/rejected” even though
  `market.decimal-invalid` is operation-rejected at `:89-94` and
  `docs/contracts/pr-2d-reason-codes.md:90-112`;
- 65 instruments “requires a pre-acquisition deterministic split” rather than the required
  one-over rejection at `docs/contracts/pr-2d-resource-bounds.md:94-100`; and
- a ninth historical query date either rejects or requires a split at
  `docs/contracts/pr-2d-resource-bounds.md:107-109`.

Those alternatives change whether a candidate set, acquisition identity, or result exists and make
the exact/one-over acceptance ledger non-binary.

**Required repair:**

1. Give every public bound one exact stage, disposition, reason/detail, and atomicity rule.
2. Separate a pre-acquisition planning/split contract from the recorded parser/validator; the
   validator itself must reject one-over input deterministically.
3. Reconcile every numeric row with fixture/study bound IDs and require the exact same expected
   reason in the acceptance matrix.
4. Add exact, one-over, declared-in-limit/actual-one-over, sibling-position, and no-post-return
   vectors for every row.

## Reviewed areas without an additional blocking finding

- H-001 durable capture is primary, the exact inherited retrieval basis is mandatory sensitivity,
  and `retrievedAtMs` is not renamed transport completion.
- Point selectors use `<= target`; release origin uses strict `< publication`; first-after and
  nearest selectors are forbidden.
- Quote/trade/bar/prior-close separation, staleness, sessions, calendar/DST, halts, LULD, odd lots,
  condition maps, corporate actions, immutable revisions, duplicate conflicts, and no-look-ahead
  intent are substantively represented.
- Provider, dataset, feed, endpoint, entitlement, observation, and artifact evidence remain
  separate; provider fallback fails closed while P1-09 is pending.
- Raw provider bytes remain private; checked-in fixtures are constrained to original synthetic
  material; no provider/account/credential access or incremental spend is authorized.
- The checkpoint diff is documentation-only. It changes no frozen EventLog, ProcessingStore,
  ArtifactStore, observation-ledger, EventDraft, migration, dependency, Docker, broker/order, or
  financial-effect surface.

These observations do not waive the blocking findings above.

## Validation evidence

The reviewer ran the following read-only checks against the exact checkpoint:

```text
git rev-parse HEAD
git rev-parse 7c48412
git status --short
git show --stat --oneline 7c48412
git show --check --oneline 7c48412
git diff --name-only 0377323..7c48412
git diff --check 0377323..7c48412
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
node -e "<parse docs/project-board.json>"
```

Results:

- `HEAD` and the reviewed object both resolved to
  `7c484124680972b5cbbd39f31cf69b542a6341cc`;
- the worktree was clean before the audit write;
- the checkpoint changes 16 documentation/research/governance files and no source, fixture, test,
  migration, package, Docker, or frozen-port file;
- Git whitespace checks passed;
- formatting passed for 114 files;
- lint passed for 114 files;
- typecheck passed; and
- `docs/project-board.json` parsed successfully.

Passing mechanical checks do not resolve the semantic contradictions and undefined schemas.

## Gate and repair disposition

P1-07 remains unaccepted. ADR 0010 must remain `Proposed`. P1-08 implementation authorization is
explicitly `false`.

Return all six findings to the contract owners, repair them in one reconciled semantic checkpoint,
and assign a fresh independent reviewer to the new exact SHA. The next review must not treat this
report's `NO_GO` as approval for unchanged sections or begin implementation before a binary `GO`.
