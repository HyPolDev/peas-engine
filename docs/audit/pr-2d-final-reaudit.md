# PR 2D final independent implementation re-audit

## Review record

- Replacement candidate SHA: `9dcefde1954c8426312fb082950b6105fe6847f6`
- Replacement candidate subject: `fix: close PR 2D final audit findings`
- Replaced candidate: `f63172b523e951f995df054cbbd63026ec674bfe`
- Prior independent decision:
  [`docs/audit/pr-2d-final-review.md`](pr-2d-final-review.md), `NO_GO`
- Contract checkpoint: `750e1ab2486ce785a60304fceb19a1502ff34319`
- Accepted contract authority:
  `car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad`
- Review role: fresh independent final re-auditor; authored none of the contract,
  implementation, fixtures, tests, prior findings, or repairs
- Review date: 2026-07-23
- Binary decision: `GO`

## Scope and method

I reviewed the exact replacement candidate against accepted ADR 0010, all registry-bound PR 2D
contracts, the acceptance matrix, and both blocking findings in the prior final review. I did not
edit or waive the prior `NO_GO`.

The re-audit included:

1. exact-SHA, clean-worktree, replacement-diff, and accepted-contract immutability checks;
2. line-by-line comparison of the F-001 study-design validator with the closed
   `StudyAlgorithmsV1`, nine metric definitions, four gate definitions, policy identities,
   catalog digests, and tuple ordering;
3. line-by-line comparison of the F-002 corrected-view selector with the branch-independent
   capture-T0-plus-seven-days rule;
4. executable reproduction of the former arbitrary-study-design and arbitrary-retrieval-cutoff
   attacks, plus missing/extra/cross-paired/corpus-divergence variants;
5. independent build and execution of the complete focused PR 2D test set;
6. executable enumeration of the 64-case fixture contract and the unique
   `20 core + 33 loader + 31 study = 84` bound partition;
7. review of identity, timestamp/as-of, source isolation, corrections, provenance, persistence,
   replay/restart, fixed-denominator study, leakage, and authorization behavior; and
8. static diff/import scans for live acquisition, credentials, spending, broker/order/portfolio
   effects, dependencies, migrations, and frozen-port changes.

The replacement delta is confined to:

- `src/providers/market-reference/selection.ts`;
- `src/study/market-reference/validation.ts`;
- `test/market-reference-contract.test.ts`; and
- `test/market-reference-study-manifest.test.ts`.

No registry-bound contract file differs from the accepted contract checkpoint.

## Prior finding F-001 - closed

The accepted contract closes the algorithm object at
`docs/contracts/pr-2d-study-freeze-manifest.md:186-234`, all nine metric variants at
`docs/contracts/pr-2d-study-freeze-manifest.md:243-287`, and the four exact gates at
`docs/contracts/pr-2d-study-freeze-manifest.md:289-320`.

The replacement enforces those semantics before deriving `std1_`:

- the complete algorithm, movement-metric, readiness-metric, and gate key sets and accepted
  catalog/policy constants are pinned at
  `src/study/market-reference/validation.ts:67-204`;
- movement metrics require their exact metric-to-formula pairing and every price/view/population/
  missing/canonicalization field, while readiness metrics require their exact predicate,
  denominator, and missing treatment at
  `src/study/market-reference/validation.ts:584-615`;
- gates require exact fields, metric pairing, interval, threshold, comparators, and terminal state
  at `src/study/market-reference/validation.ts:618-629`;
- algorithms reject every missing or extra field and byte-compare every scalar, tuple, nested
  target object, policy ID, and accepted catalog digest at
  `src/study/market-reference/validation.ts:632-675`; and
- top-level schema/version/policy identities, the exact sorted nine-metric tuple, and the exact
  sorted E1--E4 gate tuple all validate before `deriveStudyDesignId` at
  `src/study/market-reference/validation.ts:678-728`.

The former attack - extra `forbiddenPostOutcomeOverride`, wrong formulas, arbitrary policy IDs, and
zero/`always` gates with a recomputed `std1_`—now rejects as `study.input-invalid`. The executable
mutation matrix additionally rejects missing fields, nested extras, wrong catalog digests,
cross-paired formulas, 179 denominators, null missing treatments, tuple reordering, threshold
minus-one/equality-plus-one variants, wrong comparators, wrong terminal states, and all top-level
policy substitutions at `test/market-reference-study-manifest.test.ts:455-561`.

`analysisCodeDigest` remains a required lowercase 64-hex identity input rather than a contract
constant, as specified by the string field and `std1_` preimage at
`docs/contracts/pr-2d-study-freeze-manifest.md:45-50` and
`docs/contracts/pr-2d-study-freeze-manifest.md:111-126`. It is bound into the recomputed design
identity; the accepted reason-catalog digests, by contrast, are exact registry document digests and
are validated as such.

Decision for F-001: `CLOSED`.

## Prior finding F-002 - closed

The accepted corrected-view authority admits revisions only through exactly
`T0Capture + 604800000 ms`, including equality and excluding later durable evidence
(`docs/contracts/pr-2d-provider-source-identity.md:703-714` and
`docs/contracts/pr-2d-study-freeze-manifest.md:1372-1380`).

The replacement makes the rule branch-independent:

- a corrected capture request still validates its own exact capture-T0-plus-seven-days cutoff at
  `src/providers/market-reference/selection.ts:617-630`;
- a corrected retrieval request now fails closed when invoked without a primary capture authority
  at `src/providers/market-reference/selection.ts:632-638`;
- when paired, the primary must be the exact corrected durable-capture authority and must share the
  join key, interval, reference kind, selection policy, context, corpus snapshot, cutoff identity,
  admitted-revision-set hash, and cutoff value; the cutoff is then recomputed from the primary
  capture `receivedAtMs`, not retrieval time, at
  `src/providers/market-reference/selection.ts:639-665`; and
- the public paired operation validates both authorities and evaluates both branches over the same
  supplied fact corpus at `src/providers/market-reference/selection.ts:1138-1161`.

The selection boundary also byte-completes the supplied facts against the immutable corpus
revision/delivery, acquisition, artifact, and observation evidence at
`src/providers/market-reference/selection.ts:864-917`. Thus the paired API cannot smuggle a second
fact corpus after matching only displayed IDs.

The exact executable attack matrix is at
`test/market-reference-contract.test.ts:1935-2077`. It proves:

- corrected retrieval fails as a standalone selector;
- the valid paired capture/retrieval selection succeeds;
- cutoff minus one nanosecond, plus one millisecond, and an arbitrary extra day reject;
- divergent corpus, cutoff, and admitted-revision identities reject; and
- a retrieval request rebuilt over an additional cutoff-eligible revision rejects instead of
  changing revision membership.

The validator does not compare `corpusClosedAtMs` with T0 and therefore introduces no
`corpusClosedAt = T0` assumption. Corpus closure remains separately identity-bound.

Decision for F-002: `CLOSED`.

## Full-scope verification

No additional blocking or non-blocking finding was identified.

### Deterministic identities, timestamps, and selection

- The inherited PR 2C observation-ledger join is imported and recomputed, not redefined, at
  `src/providers/market-reference/identity.ts:10` and
  `src/providers/market-reference/identity.ts:1617-1640`.
- Source policy closes primary versus discrepancy-only roles, forbids fallback, and requires typed
  missing primary behavior at `src/providers/market-reference/identity.ts:1064-1103`.
- Selection validates declared source membership and filters a source before normalization-state
  selection at `src/providers/market-reference/selection.ts:844-926`; comparison sources cannot
  change the primary result.
- Target equality uses `<=`, strict publication origin uses `<`, and equal-time differing facts
  without trusted ordering fail as typed
  `market.sequence-insufficient/equal-time-ambiguous` at
  `src/providers/market-reference/selection.ts:1009-1013` and
  `src/providers/market-reference/selection.ts:1043-1073`.
- Revision-family membership, stable-key conflicts, corrections, cancellations, duplicates, and
  arrival/order invariance remain covered by the focused executable cases that passed on this exact
  candidate.

### Fixtures, provenance, bounds, and replay

- The manifest loader closes the catalog at exactly 64 unique cases at
  `src/adapters/market-reference/recorded-market-loader.ts:2239-2241`; the checked fixture test
  independently verifies 64 catalog rows and 64 unique case IDs at
  `test/market-reference-fixtures.test.ts:1872-1873`.
- The 40 loader outcomes are independently compared with the frozen expected outcomes at
  `src/adapters/market-reference/recorded-market-loader.ts:3768-3812`.
- Fixture provenance must be synthetic, project-authored, contain no provider bytes/examples,
  actual market values, credentials/account facts, or approval claim, and require no network at
  `src/adapters/market-reference/recorded-market-loader.ts:768-782`. The frozen fixture states the
  same at `fixtures/market-reference/fixture-manifest.json:9830-9839`.
- Executable enumeration on the exact build returned 20 core, 33 loader, and 31 study bound IDs,
  84 total unique. Partition completeness is enforced at
  `src/providers/market-reference/bounds.ts:15-52`.
- Memory/SQLite result identity and durable ArtifactStore reopen/page-size behavior are exercised
  at `test/market-reference-persistence.test.ts:165-329`.
- Page-size, source-order, capture/retrieval branch identity, cold restart, and every
  lookup/read/normalize/select restart boundary are exercised at
  `test/market-reference-replay.test.ts:58-256`.

### Study freeze and leakage

- Run and dataset validation retain the exact 604800000 ms correction lag and 180-cluster
  requirement at `src/study/market-reference/validation.ts:1924-1977` and
  `src/study/market-reference/validation.ts:2086-2126`.
- Dataset evidence requires exactly 1080 capture plus 1080 retrieval results and exactly 180
  cluster outcomes at `src/study/market-reference/validation.ts:2204-2211`.
- Every primary result byte-binds to its durable capture basis at
  `src/study/market-reference/validation.ts:2620-2627`; every retrieval result byte-binds to its
  inherited retrieval basis and identical target-selector/corpus semantics at
  `src/study/market-reference/validation.ts:2727-2763`.
- The complete dataset retains 12 references per cluster and the exact nine metric IDs, so missing
  evidence remains in the fixed denominator rather than changing membership
  (`src/study/market-reference/validation.ts:2648-2657` and
  `src/study/market-reference/validation.ts:2793-2848`).
- The contract's pre-outcome leakage prohibition remains authoritative at
  `docs/contracts/pr-2d-study-freeze-manifest.md:1516-1535`; the replacement narrows accepted
  design values and creates no outcome-dependent design input.

### Authorization, effects, and compatibility

- Entitlement state and zero incremental spend reject before access at
  `src/adapters/market-reference/recorded-loader-gate-evidence.ts:151-218`.
- E-01 and E-02 explicitly prove zero provider, observation, ArtifactStore/body, network, and paid
  activation counters for pending/denied/expired/wrong-scope, unauthorized fallback, and
  unauthorized-cost variants at
  `src/adapters/market-reference/recorded-loader-gate-evidence.ts:220-327`.
- The production market-reference import scan rejects HTTP, network, WebSocket, fetch, acquisition,
  and financial-effect surfaces at `test/market-reference-integration.test.ts:144-169`.
- The candidate changes no dependency manifest, migration, frozen port, observation-ledger fact
  kind, broker/order/portfolio module, or financial-effect surface.
- P1-09 remains explicitly `PENDING` at `docs/project-board.json:232-239` and
  `docs/adr/0010-market-reference-contract.md:223-227`.

## Exact-candidate gate evidence

The supplied uninterrupted exact-candidate gate record reports:

- format, lint, typecheck, and build: `PASS`;
- focused PR 2D tests: `76/76 PASS`;
- uninterrupted `npm run check`: `PASS` in 2496.9 seconds;
- hard-kill: `3/3 PASS`;
- coverage: 90.41% lines, 80.78% branches, and 96.25% functions;
- evidence reconciliation: 31 pass, one platform skip, zero fail; and
- mutation: `39/39 killed`, comprising 14 kernel and 25 artifact mutations.

I independently reran formatting, lint, typecheck, build, `git diff --check`, and all focused PR 2D
tests on `9dcefde1954c8426312fb082950b6105fe6847f6`. They passed with exactly 76 tests, zero failures,
zero skips, and zero cancellations.

## Authorization boundary

This re-audit did not access a provider, inspect a credential, activate or modify an account or
subscription, use licensed raw market bytes, or authorize spending. It grants no retention, replay,
derived-use, publication, fallback, or provider entitlement. P1-09 remains human-owned and
`PENDING`; the 100--200-event study remains gated.

## Binary decision

`GO` for exact replacement candidate `9dcefde1954c8426312fb082950b6105fe6847f6`.

F-001 and F-002 from the prior independent final review are closed. The candidate is review-ready
for the remaining audit-record/status publication, push, draft-PR, and CI workflow. This decision
does not authorize merge.
