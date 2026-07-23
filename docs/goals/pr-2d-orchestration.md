# PR 2D market-reference contract orchestration

- Status: Wave 4 recorded implementation authorized
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
- the complete 726-line revised PR 2D orchestration prompt supplied with the task, including its
  readiness, entitlement, stopping, exact-checkpoint, and draft-publication rules;
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

## Affected-file inventory

The Phase 0 inventory separates expected new PR 2D surfaces from inherited compatibility surfaces.
Contract reconciliation may narrow names, but it may not expand into a new dependency, migration,
transport, frozen port, or financial-effect surface without an approved contract amendment.

Expected new documentation:

- `docs/research/pr-2d-market-microstructure.md`
- `docs/research/pr-2d-alpaca-fmp-contract.md`
- `docs/research/pr-2d-market-identity-replay.md`
- `docs/research/pr-2d-event-study-design.md`
- `docs/adr/0010-market-reference-contract.md`
- `docs/contracts/pr-2d-provider-source-identity.md`
- `docs/contracts/pr-2d-timestamp-trust.md`
- `docs/contracts/pr-2d-market-eligibility.md`
- `docs/contracts/pr-2d-reason-codes.md`
- `docs/contracts/pr-2d-resource-bounds.md`
- `docs/contracts/pr-2d-fixture-manifest.md`
- `docs/contracts/pr-2d-acceptance-matrix.md`
- `docs/contracts/pr-2d-study-freeze-manifest.md`
- `docs/audit/pr-2d-contract-review.md`
- `docs/audit/pr-2d-final-review.md`

Expected new implementation surfaces, with final filenames and ownership deferred until contract
GO:

- a provider-neutral `src/providers/market-reference/` namespace for bounded contracts,
  identities, pure normalization, revision handling, deterministic selection, and study-manifest
  validation;
- a recorded-only `src/adapters/market-reference/` boundary;
- redistribution-safe `fixtures/market-reference/v1/` synthetic manifests and bodies; and
- focused `test/market-reference-*.test.ts` contract, fixture, replay, differential, integration,
  and study-manifest suites.

## Wave 4 non-overlapping ownership map

Independent contract `GO` was issued for exact checkpoint
`750e1ab2486ce785a60304fceb19a1502ff34319` and registry
`car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad` in
`docs/audit/pr-2d-contract-final-go.md`. Implementation is partitioned as follows:

| Owner | Exclusive write surface | Responsibility |
| --- | --- | --- |
| Terra core contract | `src/providers/market-reference/**`; `test/market-reference-contract.test.ts` | Bounded provider-neutral types, identities, reasons, normalization, revision state, deterministic selectors, and unchanged-ledger join evidence. |
| Terra recorded fixtures | `src/adapters/market-reference/**`; `fixtures/market-reference/**`; `test/market-reference-fixtures.test.ts` | Original synthetic corpus, recorded-only verified loading, provenance, malformed inputs, and exact/one-over fixture boundaries. |
| Luna study manifest | `src/study/market-reference/**`; `test/market-reference-study-manifest.test.ts` | Bounded study design/frame/freeze validators and identities without calculating outcomes. |
| Integration owner | `test/market-reference-integration.test.ts`; `test/market-reference-replay.test.ts`; `test/market-reference-persistence.test.ts`; PR 2D governance/audit files | Cross-owner integration, order/restart/page-size/memory/SQLite/effect-isolation proofs, validation, and publication. |

No owner may edit another owner's surface or any frozen port, migration, dependency, existing
provider, or existing fixture body. Cross-surface changes return to the integration owner for an
explicit ownership-map amendment before editing.

## Accepted-contract publication proof

Publication commit `d934d1185cf3a42b9e598cf7c7d520da06ee45ce` follows the independent
audit-only commit `bfdc45fe7ee2276ad143fae31d51cdf290bfbcb0`. Relative to reviewed checkpoint
`750e1ab2486ce785a60304fceb19a1502ff34319`, `git diff --name-status` reports only the new final
audit and status/governance changes to ADR 0010, this orchestration record, the project board, and
the roadmap. The eight normative `docs/contracts/pr-2d-*.md` blobs and the external registry blob
are byte-identical to the reviewed checkpoint. ADR 0010's only delta is its `Accepted` status,
reviewed SHA, registry ID, and audit link. No semantic contract, source, fixture, test, port,
migration, or dependency changed; P1-08 therefore begins from the independently authorized
contract.

Inherited files that may receive integration/status evidence only are
`docs/project-board.json`, `docs/project-roadmap.md`, and this orchestration record. Compatibility
must be demonstrated against, but no PR 2D writer may change, the frozen ports in
`src/core/event.ts`, `src/core/processor.ts`, and `src/artifacts/artifact-store.ts`; the existing
artifact-vault implementation under `src/adapters/artifacts/`; `src/providers/observation-ledger.ts`;
existing provider normalizers/loaders; memory and SQLite implementations; or migrations
`001`--`005`. The relevant existing tests are the PR 2C provider, observation-ledger,
recorded-mirror, persistence-differential, SQLite recovery/concurrency, and provenance-closure
suites recorded in the baseline. No existing fixture body is an authorized PR 2D market fixture.

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

## Wave 1 research checkpoint

Four independently authored reports are complete, were read completely by the integration owner,
and pass repository formatting, lint, and whitespace validation:

| Owner | Report | SHA-256 |
| --- | --- | --- |
| Terra A | `docs/research/pr-2d-market-microstructure.md` | `E3727151906FB82D238D7C27EE64E632347FE12319351B3F8FB11DE65C26C3A0` |
| Luna B | `docs/research/pr-2d-alpaca-fmp-contract.md` | `A937A258A507220E9D24EE565694EA94245A6829BC5615B7FA009ABDA9DD5861` |
| Terra C | `docs/research/pr-2d-market-identity-replay.md` | `E156D3915EBEFFA170CA1E87D467DF0A6FE7B8DCD23EF0E266C816C44CAB23DC` |
| Luna D | `docs/research/pr-2d-event-study-design.md` | `73704E3AC8482E1D74D5BD7F83F80A512D966A328C12F44390011B592948A6C5` |

Every report independently concludes that retrieval completion versus durable capture materially
changes first-observation latency and movement attribution. ADR integration is therefore stopped
at the prompt's `HUMAN_DECISION_REQUIRED` gate. The majority recommendation, and the integration
owner's recommendation for an operational PEAS validation claim, is durable capture as primary,
retrieval basis as a mandatory sensitivity, and a recorded capture-minus-retrieval latency
distribution. Retrieval completion is appropriate as primary only if the intended claim is
earliest provider-byte availability; the current `retrievedAtMs` must not be relabeled as transport
completion.

The reports also expose an interval-selector disagreement. The microstructure analysis selects the
last eligible quote at or before each exact target, while the event-study report proposes the first
eligible quote at or after each target. The first-after rule uses future information and can move
results across the +1/+5/+30 boundaries. The integration recommendation is the as-of rule: last
eligible quote at or before the target, subject to the frozen staleness bound. Release-gap movement
remains the authoritative prompt definition: the last eligible quote strictly before publication
to the as-of quote at the chosen PEAS observation anchor. Quote, trade, and completed-bar variants
remain separately labeled and never substitute silently.

No ADR, contract, implementation, fixture, test, board, or roadmap integration will begin until the
human owner approves or changes these material semantics. P1-09 remains `PENDING`; no provider,
feed, entitlement, fallback, acquisition, raw-byte, or spending authority has changed.

## Human decision H-001

On `2026-07-23`, the human owner approved both integration recommendations:

1. `durable-capture` is the primary observation anchor for the operational PEAS validation claim;
   the exact existing retrieval basis is a mandatory sensitivity, and the study records
   capture-minus-retrieval latency whenever both bases are trusted; and
2. every exact point target uses the last eligible fact at or before the target, subject to the
   frozen staleness policy. The last eligible quote strictly before trusted publication is the
   release-gap origin. A first-after-target selector is forbidden because it introduces look-ahead.

The approval does not rename `retrievedAtMs` as transport response completion and does not authorize
a new clock field, port, migration, provider, entitlement, raw byte, fallback, or spend.

## Wave 2 contract ownership

These paths are exclusive while their assigned writer is active. On explicit handoff, ownership
returns to the root integration owner for cross-document reconciliation. No two writers may edit a
file simultaneously.

| Owner | Exclusive Wave 2 paths |
| --- | --- |
| Root integration owner | `docs/adr/0010-market-reference-contract.md`; `docs/goals/pr-2d-orchestration.md`; final cross-document reconciliation only after each handoff |
| Terra microstructure contract owner | `docs/contracts/pr-2d-timestamp-trust.md`; `docs/contracts/pr-2d-market-eligibility.md`; `docs/contracts/pr-2d-reason-codes.md` |
| Terra identity contract owner | `docs/contracts/pr-2d-provider-source-identity.md`; `docs/contracts/pr-2d-resource-bounds.md` |
| Luna study/acceptance contract owner | `docs/contracts/pr-2d-fixture-manifest.md`; `docs/contracts/pr-2d-acceptance-matrix.md`; `docs/contracts/pr-2d-study-freeze-manifest.md` |

All Wave 2 writers must implement the approved H-001 semantics, retain quote/trade/bar separation,
keep provider choices conditional and fail closed while P1-09 is pending, and make no source-code,
fixture, test, board, roadmap, migration, dependency, or frozen-port change.
