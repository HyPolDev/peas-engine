# PR 2D market-reference contract orchestration

- Status: Phase 0 complete; independent contract research authorized
- Branch: `dev/pr-2d-market-reference-contract`
- Exact base: `origin/main` at `0377323b5486a8ad3b8e2631d4c8559760893be6`
- Base evidence: merge commit for pull request #5, including pull request #4, roadmap commit
  `c51758a1058b86730e19185b98fcd448d9ff533a`, and the exact PR 2C implementation GO at
  `731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`
- Outcome: draft pull request; do not merge

## Objective

Deliver an accepted ADR 0010, a frozen 100--200-event validation-study contract, and a
provider-neutral recorded market-reference implementation with redistribution-safe synthetic
fixtures and deterministic offline tests. No live provider acquisition belongs in PR 2D.

## Isolation and exact-base verification

The integration branch was created from the exact base above in the isolated worktree
`C:\Users\HyPol\.codex\visualizations\2026\07\19\019f7803-6765-73b3-9abf-959f6e73eda5\worktrees\pr-2d-market-reference-contract`.
The pre-existing checkout remains on `dev/pr-2b-sec-fixtures` at
`21fa58b9114b5b9ea107193eb324e03df1dcb657` with its pre-existing modified and untracked files.
It was not cleaned, staged, reset, reused, or modified.

The exact base was fetched and verified to be both local `HEAD` and `origin/main`. Its ancestry
contains the pull request #5 merge, pull request #4 merge, roadmap commit `c51758a`, the PR 2C
fixture-boundary repair, and the exact independently approved PR 2C implementation candidate.

## Phase 0 evidence inventory

The integration owner read the complete authoritative assignment before delegation and then read
the evidence it routes to, including:

- ADRs 0001--0009, the project roadmap, project board, readiness publication, and readiness audit
  chain;
- PR 2B and PR 2C orchestration records, implementation prompts, contract tables, fixture
  manifests, acceptance matrices, research reports, and full audit histories;
- the no-trade policy and disposition, policy manifest, validation universe, and entitlement gate;
- the frozen event and `ProcessingStore` ports, `ArtifactStore` contract and durable implementation,
  runtime root, trusted-filesystem boundary, writer lease, and SQLite migration 005;
- provider evidence-bundle, recorded SEC/FMP/NVIDIA loaders, contracts, normalizers, and bounded
  JSON handling;
- the observation ledger, provider/source identity rules, reason-code catalog, and
  `marketReferenceJoinKey`; and
- recorded acceptance, replay, identity, persistence differential, crash-recovery, concurrency,
  and provenance-closure tests.

Current documentation drift was identified: the board and roadmap still describe pull request #5
as unmerged and PR 2D as unauthorized. The integration owner owns that repair after the contract is
reconciled; it is stale evidence, not a new policy decision.

## Baseline environment and validation

- Platform: Windows NT 10.0.19045.0
- Node.js: `v24.17.0`
- npm: `12.0.0`
- `npm.cmd ci --no-fund --no-audit`: passed; 54 packages installed
- `npm.cmd run verify:runtime`: passed
- `npm.cmd run format:check`: passed; 111 files
- `npm.cmd run lint`: passed; 111 files
- `npm.cmd run typecheck`: passed
- `npm.cmd run build`: passed
- focused recorded/provider/ledger/persistence suite: 92 passed, 0 failed, 0 skipped
- `git diff --check`: passed
- complete `npm.cmd run check`: passed in 540.6 seconds, comprising:
  - artifact hard-kill matrix: 3 passed, 0 failed, 0 skipped;
  - coverage suite: 266 passed, 0 failed, 6 intentional skips out of 272 tests;
  - evidence-reconciliation suite: 31 passed, 0 failed, 1 Windows-platform skip out of 32 tests;
  - targeted mutation gate: 39/39 killed, including 14/14 kernel and 25/25 artifact-vault
    mutations; and
  - aggregate coverage: 92.30% lines, 83.73% branches, and 97.32% functions.

## Authorization lock

- Recorded/offline work only. No live HTTP or WebSocket implementation or test belongs in PR 2D.
- Do not inspect credentials, accounts, provider responses, or private/licensed provider bytes.
- Do not activate subscriptions, change entitlements, or incur market-data spending.
- Checked-in market payloads must be synthetic and redistribution-safe.
- P1-09 remains pending; PR 2D must not silently claim that written retention, replay, internal-use,
  or derived-publication permission exists.
- Do not change frozen ports, broker/order code, portfolio state, trading behavior, or financial
  effects.

## Primary-observation-anchor decision rule

The existing observation ledger can bind a market-reference join to either trusted durable capture
time or trusted retrieval-completion time. The research reports must evaluate the scientific
meaning of both. If choosing one as the primary observation anchor materially changes the study's
meaning, the integration owner must stop for a human decision instead of selecting by convenience.

## File ownership map

Only the named owner may write the listed files during a wave. Writers must not edit another
owner's files, and simultaneous overlapping edits are prohibited.

| Wave | Owner | Exclusive write ownership |
| --- | --- | --- |
| Phase 0 and integration | Root integration owner | `docs/goals/pr-2d-orchestration.md`; later ADR 0010, integrated contract tables, project board, roadmap, and audit publication records |
| Research A | Terra microstructure analyst | `docs/research/pr-2d-market-microstructure.md` only |
| Research B | Luna provider-contract analyst | `docs/research/pr-2d-alpaca-fmp-contract.md` only |
| Research C | Terra identity/replay architect | `docs/research/pr-2d-market-identity-replay.md` only |
| Research D | Luna event-study analyst | `docs/research/pr-2d-event-study-design.md` only |
| Contract audit | Fresh review-only agent | its assigned `docs/audit/` record only; no contract edits |
| Implementation | Deferred until contract GO | exact non-overlapping source, fixture, test, and study-validator paths will be frozen before implementation delegation |
| Final audit | Fresh review-only agent | its assigned final `docs/audit/` record only; no implementation edits |

Research agents may read the entire repository and official primary sources but may not implement,
call providers, inspect credentials, or broaden their one-file ownership. The integration owner
alone reconciles disagreements and records why a position was accepted or rejected.

## Gates

1. Record a clean complete baseline and commit this Phase 0 ownership/evidence checkpoint.
2. Obtain four independent research reports from the owners above.
3. Reconcile ADR 0010 and every required contract table and freeze manifest.
4. Obtain a fresh, independent, exact-checkpoint binary contract `GO` before implementation.
5. Freeze non-overlapping implementation ownership and build only the recorded boundary, synthetic
   fixtures, deterministic tests, and bounded study-manifest validators.
6. Run the complete offline gate and obtain a fresh independent final implementation `GO`.
7. Commit intentional files, push the branch, and open an unmerged draft pull request.

Any `NO_GO` returns exact findings to the relevant owner and repeats independent review after
repair. Work stops only for a decision that materially changes the primary observation anchor,
market/source identity, licensing or authorized spending, frozen ports, or project scope.
