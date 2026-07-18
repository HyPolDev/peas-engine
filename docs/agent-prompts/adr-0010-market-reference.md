# ADR 0010 market-reference contract and recorded implementation

## Role

Act as the co-lead engineer, project manager, and orchestration owner for the PEAS market-reference
contract gate. Investigate the decision using primary evidence, coordinate independent specialists,
integrate their work, and continue review/fix/review loops until the contract and recorded
implementation receive an independent `GO`.

## Objective

Deliver a review-ready PR that freezes the reproducible market reference and event-validation study
contract required before the 100-200-cluster forward observation run. Implement the provider-neutral
recorded boundary, synthetic fixtures, and executable deterministic tests. Prepare, but do not add,
live provider acquisition.

The pre-validation cost policy is zero incremental market-data spend:

- Alpaca Basic delayed SIP history is the provisional primary reference only if written permission
  covers the required retention and derived use.
- Existing FMP Premium access is a secondary discrepancy source and the explicit lower-evidence
  fallback if the human owner accepts that limitation.
- IBKR, paid Alpaca, FMP Ultimate, Databento, Massive, and other new subscriptions are deferred until
  the event-validation study justifies spend.

## Repository and branch

- Repository: `HyPolDev/peas-engine`
- Base: latest `origin/main`, which must contain merged pull request #4
- Suggested branch: `dev/pr-2d-market-reference-contract`
- Use a new isolated worktree. Never modify, clean, reset, stage, or reuse an existing dirty
  worktree.

Record the exact base SHA before editing. Preserve unrelated user work and frozen kernel ports.

## Authorized outcome

- Research official provider, exchange, and regulatory contracts relevant to US equity quotes,
  trades, bars, sessions, corrections, and timestamps.
- Add ADR 0010, supporting contract tables, study-manifest specification, synthetic fixtures,
  provider-neutral recorded normalization/selection code, and contract tests.
- Update the roadmap/board evidence for completed gates.
- Run independent contract and final implementation audits.
- Commit intentional files, push the branch, and open a draft PR.
- Do not merge the PR.

## Explicit exclusions

- No production HTTP/WebSocket client, polling loop, or live provider call from tests.
- No account upgrades, purchases, credentials, API keys, cookies, or licensed provider bytes.
- No Docker changes.
- No broker, order, portfolio, position, fill, or trading code.
- No LLM dependency.
- No ArtifactStore port or frozen deterministic-kernel port changes.
- No market-data value, URL, credential, header, retrieval ID, or wall-clock observation in earnings
  event identity.
- No silent fallback between quote, trade, bar, provider, session, or timestamp trust level.

## Binding architecture defaults

- Market evidence is an independent source family joined through PR 2C's
  `marketReferenceJoinKey`; it never changes the earnings event or evidence-bundle identity.
- Provider observations remain distinct even when their bytes or normalized facts agree. Identical
  bytes may share an artifact digest.
- Byte-different corrections create deterministic new market source/revision identities and never
  rewrite prior evidence.
- Retrieval/capture telemetry is observation evidence, not domain identity.
- Raw licensed bytes remain private and outside Git. Repository fixtures are synthetic or carry
  explicit redistribution approval.
- Every parser, request manifest, collection, time window, page, retry, condition list, and canonical
  output has exact byte/item/depth/token bounds with exact and one-over tests.
- Acquisition is effect-isolated from normalization and reference selection:

```text
bounded acquisition -> private raw artifact -> verified read -> pure market normalization
  -> deterministic reference selection -> marketReferenceJoinKey
```

## Phase 0 - baseline and evidence inventory

1. Fetch without altering dirty worktrees and verify `origin/main` contains pull request #4.
2. Read all ADRs, the project roadmap/board, PR 2B/2C orchestration and audit evidence, the artifact
   vault contract, SEC/FMP/NVIDIA recorded loaders, the observation ledger, cross-source acceptance
   tests, and the frozen port definitions.
3. Run the relevant baseline format, lint, typecheck, build, and focused tests.
4. Record exact base SHA, toolchain versions, test totals, skips, and any platform limitations.
5. Create a file-ownership map before assigning implementation work.

## Wave 1 - independent research, concurrently

Run four independent specialists. Require primary/official sources, access date, direct links, and a
clear separation between documented fact, inference, and recommendation.

### A. Market microstructure and metric analyst

Define the evidence needed for:

- prior-close movement at the first trusted PEAS observation;
- release-gap movement from the last eligible pre-publication reference to first observation; and
- residual movement at +1, +5, and +30 minutes.

Evaluate NBBO midpoint, last eligible SIP trade, one-minute bars, official close, extended hours,
halts, locked/crossed quotes, odd lots, late/out-of-sequence trades, corrections/cancellations,
corporate actions, symbol changes, and stale evidence. Propose exact selection algorithms, trust
levels, reason codes, bounds, and synthetic cases. Do not silently treat a bar or trade as a quote.

### B. Alpaca/FMP contract analyst

Use official Alpaca and FMP documentation and terms. Determine endpoint structures, pagination,
timestamps, feed/dataset identity, adjustment policy, corrections, coverage, extended-hours
behavior, entitlements, rate/bandwidth limits, and authentication boundaries. Identify what can be
proven from public material and what requires written account-specific confirmation.

Design the zero-cost primary/fallback policy without assuming that free access grants durable
retention, replay, redistribution, or commercial use. Never expose or request credentials in the
repository or report.

### C. Identity, telemetry, and replay architect

Extend PR 2C conceptually without changing frozen ports. Specify provider, dataset, feed,
instrument, artifact, market fact, observation, correction/revision, selection, and join identities.
Cover wall-clock versus monotonic clocks, exchange event time, provider receive time, PEAS request
and durable-capture time, nullability, trust levels, replay remapping, duplicate identity, and stable
selection across arrival order and page size.

### D. Event-study and data-quality analyst

Precommit the 100-200-cluster study design: universe, strata, no-trade controls, exclusions,
denominators, minimum evidence completeness, primary/secondary measures, success/failure thresholds,
missing-data policy, outlier policy, multiple comparisons, sensitivity checks, and freeze manifest.
Prevent survivorship, timestamp, provider-selection, and post-outcome threshold leakage.

## Wave 2 - contract integration

Reconcile the four reports into:

- `ADR 0010`: market-reference evidence, identities, timestamps, selection, corrections, licensing,
  bounds, and replay contract;
- a provider/source/identity table;
- a timestamp and trust-level table;
- a quote/trade/bar eligibility and fallback table;
- a complete reason-code table;
- an exact/one-over resource-bound matrix;
- a synthetic fixture-manifest specification;
- an acceptance-test matrix; and
- a versioned event-study freeze-manifest specification.

Resolve disagreements explicitly. If selecting retrieval versus durable capture as the primary PEAS
observation anchor changes the study meaning, present the evidence and stop for a human decision
rather than guessing.

## Wave 3 - independent contract review

Assign a fresh review-only specialist that authored none of the integrated contract. Require exact
file and line references and a binary `GO` or `NO_GO`. Audit:

- deterministic identity and cross-provider independence;
- timestamp meaning, clock basis, trust, and replay remapping;
- quote/trade/bar selection and session behavior;
- corrections, duplicates, symbol/issuer mapping, and missing evidence;
- complete provenance and artifact verification;
- exact/one-over bounded state and parsing;
- study leakage, denominators, and reproducibility;
- fixture redistribution safety and credential isolation;
- zero-spend enforcement and explicit fallback behavior;
- effect isolation and frozen-port compatibility.

For `NO_GO`, route each finding to the relevant author, amend the contract, and repeat with a fresh
independent review. Continue until `GO` or a genuine human decision about licensing, metric meaning,
frozen ports, or scope blocks progress.

## Wave 4 - recorded implementation after contract `GO`

Run non-overlapping implementation owners concurrently:

### Core market-contract owner

Implement bounded provider-neutral recorded types, canonical identities, correction/revision
semantics, pure normalization, deterministic reference selection, reason codes, and observation-ledger
join evidence. Do not add network acquisition or alter frozen ports.

### Synthetic fixture owner

Create redistribution-safe fixtures for trades, quotes, minute bars, prior close, regular and
extended sessions, duplicate bytes, duplicate provider identities, corrections/cancellations,
locked/crossed and stale quotes, halts, missing windows, symbol changes, malformed inputs, and every
exact/one-over bound.

### Determinism and integration-test owner

Prove outputs are independent of fixture order, arrival order, duplicate delivery, restart, storage
backend, and replay page size. Cover identical and disagreeing FMP/Alpaca observations, stable
missing reasons, PR 2C clock-regression replay, and arrivals while an analysis lease is active.

### Study-manifest owner

Implement only the bounded, versioned validation/freeze manifest and validators required to lock
universe, strata, thresholds, exclusions, code/configuration identity, entitlement snapshot, and
completeness denominators. Do not calculate study conclusions in this PR.

## Wave 5 - final integration and audit

1. Rebase or update safely against latest `origin/main`; never reset unrelated work.
2. Run formatting, lint, typecheck, build, the full offline suite, focused market-reference tests,
   replay/storage-backend tests, and relevant mutation/boundary gates.
3. Run a fresh independent final audit against the contract-review checklist and all earlier
   findings. Require exact references and binary `GO`/`NO_GO`.
4. Confirm there is no live HTTP/WebSocket surface, secret, paid entitlement activation, licensed
   raw fixture, frozen-port change, or financial effect.
5. Update ADR status, roadmap/board evidence, acceptance matrix, and audit record.
6. Stage intentional files only, commit, push `dev/pr-2d-market-reference-contract`, and open a draft
   PR describing scope, official research, cost policy, fixture provenance, validation, and deferred
   live work.
7. Do not merge.

## Definition of done

The PR is complete only when:

- ADR 0010 and the study freeze contract have an independent `GO`;
- all provider-neutral recorded code and synthetic fixtures have a final independent `GO`;
- deterministic outputs are proven across ordering, replay page size, restart, and memory/SQLite;
- exact/one-over bounds and stable reason codes are executable;
- the zero-spend and licensing boundaries are explicit and fail closed;
- roadmap evidence is current; and
- a draft PR exists with green required checks.

Do not mark ordinary provider-response delay or agent-capacity failure as a project blocker. Continue
all safe recorded/offline work. Stop only for a decision that materially changes licensing,
observation-anchor meaning, market identity, frozen ports, cost authorization, or project scope.
