# PR 2D final independent implementation review

## Review record

- Candidate SHA: `f63172b523e951f995df054cbbd63026ec674bfe`
- Candidate subject: `feat: implement recorded market reference contract`
- Contract checkpoint: `750e1ab2486ce785a60304fceb19a1502ff34319`
- Accepted contract authority:
  `car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad`
- Review role: fresh independent final implementation auditor; authored none of the contract,
  implementation, fixtures, or tests
- Review date: 2026-07-23
- Binary decision: `NO_GO`

## Scope and method

I reviewed the exact candidate against ADR 0010, all nine registry-bound PR 2D contract
authorities, the acceptance matrix, the 64-case synthetic fixture contract, the 84-bound
enforcement registry, the market-reference implementation and adapters, the event-study
implementation, and all focused PR 2D tests.

The review included:

1. exact-SHA and change-scope inspection;
2. line-by-line review of identity, normalization, selection, revision/cutoff, recorded-loader,
   gate-evidence, bound, study-design, sampling, dataset-freeze, and analysis code;
3. independent JSON and executable enumeration of 64 fixture cases and the unique
   `20 core + 33 loader + 31 study = 84` bound partition;
4. static scans for live network, credential, broker/order/portfolio, financial-effect,
   dependency, migration, and frozen-port changes;
5. inspection of memory/SQLite, durable ArtifactStore, page-size, replay, restart, arrival-order,
   correction, duplicate, source-isolation, and study-denominator tests; and
6. two direct executable adversarial probes against the compiled output of the exact candidate.

## Gate evidence reviewed

The supplied exact-candidate gate record reports:

- runtime verification, formatting, lint, typecheck, and build: `PASS`;
- focused PR 2D tests: `74/74 PASS`;
- hard-kill tests: `3/3 PASS`;
- full coverage suite: `PASS`, with 90.00% lines, 80.67% branches, and 96.04% functions;
- evidence reconciliation: 31 pass, one platform skip, zero fail; and
- mutation: 39/39 killed, comprising 14 kernel and 25 artifact mutations.

The monolithic `npm run check` wrapper reached its external 30-minute orchestration timeout while
mutation was still running. This is not treated as a waived pass. The unchanged mutation command
was rerun against the same candidate and completed `39/39 killed` in 1099.2 seconds. The two
findings below are semantic acceptance gaps not exercised by those successful gates.

## Blocking findings

### F-001 - Study design validation accepts non-contract formulas, thresholds, policies, and fields

Severity: blocking.

The accepted study contract defines a closed `StudyAlgorithmsV1` at
`docs/contracts/pr-2d-study-freeze-manifest.md:186-234`, exact nine metric variants at
`docs/contracts/pr-2d-study-freeze-manifest.md:243-287`, exact four gate variants and thresholds at
`docs/contracts/pr-2d-study-freeze-manifest.md:289-320`, and prohibits outcome/threshold leakage at
`docs/contracts/pr-2d-study-freeze-manifest.md:1516-1535`. The acceptance matrix requires the exact
E1--E4 rules and threshold boundaries at `docs/contracts/pr-2d-acceptance-matrix.md:158-164`.

The implementation does not enforce those frozen semantics:

- `src/study/market-reference/validation.ts:452-463` accepts arbitrary nonempty policy and design
  strings.
- `src/study/market-reference/validation.ts:464-477` checks only the counts and ordering of
  `metricId`; it does not validate any metric row's closed fields, formula, price basis, view,
  denominator, missing treatment, or canonical value.
- `src/study/market-reference/validation.ts:478-500` checks only a subset of algorithm keys and
  values. It neither closes the object nor validates the contract's registries, digests, offsets,
  reference/view/status arrays, policy IDs, gate policy, lane targets, or control targets.
- `src/study/market-reference/identity.ts:38-54` then hashes whatever caller-supplied design passed
  those partial checks. Recomputing that hash proves self-consistency, not conformance to the
  accepted design.

An executable probe against this candidate constructed a design with:

- an extra `forbiddenPostOutcomeOverride: "GO"` algorithm field;
- all nine metric rows containing only their expected `metricId` plus `formulaId: "wrong"`;
- all four gate rows using threshold `0.000000000000000000` and comparator `always`; and
- arbitrary `wrong` policy IDs.

After recomputing its `std1_` identity, `validateStudyDesign` accepted it as
`std1_08158af4b5b025461874a81812c775e5a24e111e78805460a9af08e760463252`.
Therefore the implementation does not freeze the study contract before outcomes and cannot satisfy
the 180-cluster milestone's leakage-prevention requirement.

Required repair:

1. implement exact closed validators for every `StudyAlgorithmsV1`, metric-definition, and
   gate-threshold variant;
2. require every literal, tuple, pairing, policy ID, digest, denominator, comparator, and
   nullability rule from the accepted contract;
3. reject every missing, extra, cross-paired, abbreviated, or arbitrary field/value before
   producing a study-design ID; and
4. add one-field-at-a-time mutation tests, including wrong formulas, thresholds, comparators,
   denominators, policy IDs, tuple order, extra nested fields, and all threshold equality/one-unit
   boundaries.

### F-002 - Retrieval corrected-view selection accepts an arbitrary correction cutoff

Severity: blocking.

The accepted cutoff is branch-independent: `recorded-corrected` must use exactly
`T0CaptureNs + 604800000000000`, include equality, and exclude later durable evidence
(`docs/contracts/pr-2d-provider-source-identity.md:703-714`). The acceptance matrix requires this
exact cutoff at `docs/contracts/pr-2d-acceptance-matrix.md:163-164`. ADR 0010 makes durable capture
primary and retrieval only a mandatory sensitivity at
`docs/adr/0010-market-reference-contract.md:19-27`; retrieval does not create a different
correction-cutoff authority.

The implementation validates the exact seven-day relationship only when the result branch itself
has a capture basis:

- `src/providers/market-reference/selection.ts:598-607` checks corrected-view shape and internal
  cutoff equality.
- `src/providers/market-reference/selection.ts:608-615` checks
  `capture receivedAtMs + seven days` only under `basis.basisKind === "capture"`.
- `src/providers/market-reference/identity.ts:1579-1607` validly admits the mandatory retrieval
  basis, leaving the corrected retrieval branch without any binding to the paired primary capture
  T0.

An executable probe started from a valid retrieval `recorded-corrected` request whose contractual
cutoff was `604905000000000`, changed the cutoff to `691305000000000` (one extra day), recomputed
the cutoff and selection-policy identities, and invoked `selectMarketReference`. The candidate
returned `selected-complete` under
`anchorRole: "h001-mandatory-retrieval-sensitivity"`. This permits later revisions to enter the
retrieval corrected corpus contrary to the frozen cutoff and can make capture/retrieval
sensitivities compare different revision membership.

Required repair:

1. bind corrected cutoff authority to the approved primary capture T0 independently of the selected
   result branch, either through validated paired-anchor evidence or an equivalent immutable
   capture-cutoff authority;
2. enforce the exact capture-T0-plus-seven-days value for both capture and retrieval result
   branches;
3. require capture and retrieval sensitivities to share the same corpus snapshot, cutoff identity,
   and admitted revision-set hash; and
4. add retrieval-branch cutoff equality, minus-one, plus-one-millisecond, arbitrary-later-cutoff,
   and admitted-revision differential tests.

## Verified non-blocking evidence

The following reviewed areas did not produce an additional finding:

- The post-contract implementation does not change the accepted normative contract after the
  acceptance-status publication. The implementation delta is confined to additive market-reference
  source, adapter, study, fixture, test, and orchestration files.
- The unchanged observation-ledger join is recomputed rather than redefined at
  `src/providers/market-reference/identity.ts:1610-1640`. No observation-ledger fact kind,
  ArtifactStore/EventLog/ProcessingStore port, dependency, or migration is changed.
- Primary source isolation and no fallback are implemented at
  `src/providers/market-reference/selection.ts:794-880` and
  `src/providers/market-reference/selection.ts:1072-1165`.
- Revision-family validation, stable-key conflict quarantine, cancellation/correction application,
  and equal-time fail-closed selection are implemented at
  `src/providers/market-reference/selection.ts:628-773` and
  `src/providers/market-reference/selection.ts:989-1034`.
- The fixture registry closes exactly 64 cases at
  `src/adapters/market-reference/recorded-market-loader.ts:1224-1357`; executable loader outcomes
  are compared bidirectionally with independently frozen manifest evidence at
  `src/adapters/market-reference/recorded-market-loader.ts:3765-3812`.
- Fixture provenance is explicitly synthetic and project-authored, with no provider bytes,
  provider examples, actual values, credentials/account facts, or network requirement at
  `fixtures/market-reference/fixture-manifest.json:9831-9839`. Its frozen identities are
  `mfx1_1c199ece41ba2dbd00e605d96914116ff5c9d0d4502e582de976fe91f37b93eb` and
  `mfm1_1538a166afd4537063efeeda60747f263866864f1b69cc631de8b7733aeb7aa7`
  (`fixtures/market-reference/fixture-manifest.json:3` and
  `fixtures/market-reference/fixture-manifest.json:14556`).
- The 84 bounds form one unique partition of 20 core, 33 loader, and 31 study bounds. Ownership is
  closed at `src/providers/market-reference/bounds.ts:15-52`, and all loader operational
  implementations are exercised at
  `src/adapters/market-reference/recorded-loader-gate-evidence.ts:592-721`.
- P1-09 and zero-spend gates fail before provider, observation, ArtifactStore, body, or network
  access at `src/adapters/market-reference/recorded-loader-gate-evidence.ts:151-327`.
  Recorded-fixture inputs must remain synthetic/offline at
  `src/adapters/market-reference/recorded-market-loader.ts:735-780` and
  `src/adapters/market-reference/recorded-market-loader.ts:1432-1536`.
- Dataset validation requires 1080 capture plus 1080 retrieval results and exactly 180 denominator
  rows at `src/study/market-reference/validation.ts:1978-1982` and
  `src/study/market-reference/validation.ts:2238-2240`; it byte-links six retrieval sensitivities
  per cluster to the same primary selector/corpus semantics at
  `src/study/market-reference/validation.ts:2425-2539`.
- Memory/SQLite, durable ArtifactStore, page-size, cold-restart, and phase-boundary replay evidence
  is executable at `test/market-reference-persistence.test.ts:165-331` and
  `test/market-reference-replay.test.ts:58-256`.
- Static source and diff scans found no live HTTP/WebSocket client, credential read, account action,
  licensed raw fixture, paid-plan action, broker/order/portfolio surface, financial effect,
  dependency change, migration, or frozen-port modification.

## Limitations and authorization boundary

This review did not access a provider, inspect a credential, activate a subscription, make an
account change, use licensed raw market bytes, or authorize spending. P1-09 remains `PENDING`; no
part of this review grants provider, retention, replay, derived-use, publication, fallback, or
spending permission.

I did not reinterpret the monolithic wrapper timeout as a pass or as a product failure. I reviewed
the transparent unchanged-command rerun evidence and independently executed the two semantic probes
above against the exact built candidate. Both probes are deterministic validator accepts and do not
depend on the wrapper or platform skip.

## Binary decision

`NO_GO` for `f63172b523e951f995df054cbbd63026ec674bfe`.

The implementation must not be published as the final PR 2D candidate, pushed as review-ready, or
used to open the implementation gate until F-001 and F-002 are repaired, the candidate is
recommitted, all gates pass on the new exact SHA, and a fresh independent final implementation
audit returns `GO`.
