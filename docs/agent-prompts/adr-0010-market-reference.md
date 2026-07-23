# ADR 0010 market-reference contract and recorded implementation

## Role and objective

Act as co-lead engineer, project manager, architecture integrator, and orchestration owner for PEAS
PR 2D.

Deliver a review-ready market-reference contract and recorded implementation gate required before
the 100-200-cluster forward event-validation study. The work must:

1. accept ADR 0010 through an independently reviewed contract gate;
2. freeze the event-validation study before outcomes exist;
3. implement a provider-neutral, recorded-only market-reference boundary;
4. add redistribution-safe synthetic fixtures and executable deterministic tests;
5. receive an independent contract `GO` and a separate independent final implementation `GO`;
6. push the integration branch and open a draft pull request; and
7. leave the pull request unmerged.

This assignment spans two sequential roadmap gates:

- P1-07 freezes and independently accepts the market-reference and event-study contract; and
- P1-08 implements and independently accepts the recorded market-reference boundary.

P1-08 must not begin until an independent reviewer returns `GO` for the exact P1-07 contract
checkpoint. The merged governance currently permits those gates to use one isolated worktree, one
integration branch, and one draft pull request. If the latest merged governance instead requires
separate pull requests, stop and record the required branch and stacking plan before creating
either branch.

## Repository, prerequisites, and isolation

- Repository: `HyPolDev/peas-engine`
- Target branch: `dev/pr-2d-market-reference-contract`
- Base: latest `origin/main`

### Pre-PR-2D authorization lock

Do not create the branch, delegate PR 2D research, or write a PR 2D contract or implementation file
until every prerequisite below is committed, merged, and durably evidenced on the latest fetched
`origin/main`:

1. Pull request #4 merge commit `73b4d0b5f85f04f66315bdb6b43edd187381e600` is an ancestor of
   `origin/main`.
2. Planning commit `c51758a1058b86730e19185b98fcd448d9ff533a` is an ancestor of
   `origin/main`.
3. The inherited PR 2C defects are repaired on a committed exact SHA without weakening the accepted
   ArtifactStore authority, observation-ledger semantics, or frozen ports.
4. `docs/audit/pr-2c-final-disposition.md` records a fresh independent binary `GO` for that exact
   repaired SHA, complete commands/results, reviewer independence, and an explicit supersession of
   both `docs/audit/pr-2c-fresh-audit-9b1a32.md` and
   `docs/audit/pr-2c-fixture-boundary-audit-9b1a32.md`.
5. The repaired PR 2C head, both preserved historical `NO_GO` reports, and the final disposition are
   merged into `origin/main`.
6. The merged pre-PR-2D readiness work contains
   `docs/audit/pre-pr-2d-readiness.md` with `Status: GO` for an exact committed readiness SHA and
   passing required Windows and Linux evidence.
7. The base contains `docs/research/no-trade-policy-disposition.md`,
   `docs/research/market-data-entitlement-gate.md`, and this authoritative assignment.

Fetch origin safely and record the exact `origin/main` SHA before evaluating the lock. Do not treat
the planning commit, the PR #4 merge, roadmap prose, a historical agent message, or an uncommitted
repair worktree as proof that the lock is satisfied. If any prerequisite is absent, contradictory,
not independently reviewed, or not on the fetched base, report the exact missing evidence and stop.
PR 2D is not authorized.

Verify that no local or remote `dev/pr-2d-market-reference-contract` branch already exists. Stop
instead of reusing or overwriting one.

Create the branch in a new isolated worktree at a new unused path. Do not modify, clean, stage,
stash, reset, switch, delete, move, or reuse any existing worktree. Existing dirty and historical
worktrees belong to the user and are out of bounds.

Read the readiness certificate and all dispositions completely. If a current project document
contradicts them, identify exact files and lines. Repair unambiguous documentation drift or stop for
a material human decision; never select the convenient document silently.

## Binding inherited decisions

### PR 2C ArtifactStore authority and repair

The accepted PR 2C contract already requires every selected recorded observation to exist in the
existing `ArtifactStore`, and requires complete observation evidence to agree before a recorded
loader may emit. The inherited FMP/NVIDIA observation-identity gap is an implementation defect, not
an open choice between an authoritative and a declaration-only trust model.

The pre-PR-2D repair is agent-owned. Enforce the accepted authority using the existing
`ArtifactStore` in the same architectural direction as the SEC precedent: bind each raw member to
an explicit selected observation and artifact hash, perform a bounded verified ArtifactStore read,
and reconcile the returned observation identity, provider, digest, as-of facts, and bytes. Version
internal recorded-loader manifests and call sites when required. Do not change public
`ArtifactStore`, `EventLog`, `ProcessingStore`, observation-ledger, or kernel port signatures, and
do not add or rewrite a migration.

Do not request a human decision merely to enforce the accepted contract. Stop for a human decision
only if a proposed resolution would weaken or narrow the existing observation-existence/evidence
claims, change a frozen port, add a migration or dependency, or materially change project scope.

### Candidate no-trade research

The preserved candidate under `docs/research/candidates/no-trade-v0.1/` has disposition
`ADOPT_WITH_CHANGES`. It is traceable research input, not an executable or normative policy.

- Carry capture-first accounting, prospective strata, negative-control research, T-1 universe
  state, and event-time data-quality annotations into the event-study workstream for independent
  analysis.
- Do not copy its proposed model/trade thresholds, mutually exclusive state model, `NT_*` registry,
  ticker seeds, or `120/40/20` allocation into ADR 0010 without independently freezing corrected
  semantics.
- Keep capture eligibility, market-reference quality, study admission, model eligibility, and trade
  eligibility as separate concepts.
- Keep later model promotion, trading eligibility, execution, and cost policy outside PR 2D.
- Use additive, versioned study manifests or sidecars. Do not add candidate fields to PR 2C's closed
  observation-ledger fact union or change frozen ports.

Record every accepted, amended, or rejected candidate provision explicitly in the integrated
contract.

### Entitlement and zero-spend gate

`docs/research/market-data-entitlement-gate.md` is binding. Its current P1-09 status is `PENDING`.
That status permits official-document research, provider-neutral contracts, original synthetic
fixtures, recorded implementation, and offline tests in PR 2D. It does not authorize provider
acquisition.

Human attestation and written-provider evidence collection may proceed while P1-09 is `PENDING`.
The gate cannot close until its frozen provider, dataset, feed, entitlement, and fallback policy is
compatible with accepted ADR 0010 and receives independent `GO`.

While P1-09 is `PENDING`:

- P1-10 and P2 remain blocked;
- do not authenticate, inspect an account or credential, call a provider endpoint, retrieve provider
  bytes, start a trial, change an account, activate a subscription, or add spending;
- do not describe Alpaca or FMP as authorized;
- do not select FMP or another provider as a fallback; and
- make provider and fallback policy fail closed before outcomes can exist.

Historical Alpaca REST `feed=sip`, WebSocket `v2/delayed_sip`, and a latest-endpoint
`feed=delayed_sip` selection are separate provider/dataset/feed identities unless official written
evidence establishes an exact equivalence relevant to PEAS. Never use "Alpaca Basic delayed SIP
history" as one undifferentiated dataset name.

Alpaca is a candidate source, not a provisionally authorized primary, while P1-09 is `PENDING`.

Existing FMP Premium is only a repository assertion while the entitlement gate is pending. Model it
as a separately identified, lower-evidence discrepancy candidate; it is not SIP/NBBO-equivalent and
must never silently replace missing SIP evidence.

Paid Alpaca, FMP Ultimate, IBKR, Databento, Massive, and all other new paid capabilities are
`NOT_AUTHORIZED`. No incremental market-data spending is authorized before the validation study.

Raw licensed bytes stay private and outside Git. Every committed market fixture must be original
synthetic data or carry explicit redistribution permission recorded in the repository.

## Explicit exclusions

PR 2D must not add or perform:

- a production HTTP or WebSocket client, provider polling, subscriptions, or retry loops;
- a live provider call or network-dependent test;
- account, dashboard, invoice, cookie, API-key, credential, or private-correspondence inspection;
- licensed raw market-data fixtures;
- account, subscription, billing, professional-status, or entitlement changes;
- Docker changes or LLM dependencies;
- broker, order, portfolio, position, fill, trading, or financial-effect code;
- a change to frozen `EventLog`, `ProcessingStore`, `ArtifactStore`, observation-ledger, or
  deterministic-kernel port signatures;
- a rewrite of any existing migration;
- a new migration or external dependency without an approved contract amendment;
- market prices, URLs, credentials, headers, retrieval IDs, or wall-clock telemetry in earnings-event
  or evidence-bundle identity; or
- silent fallback between provider, dataset, feed, quote, trade, bar, session, or timestamp trust
  level.

## Binding architecture defaults

- Market evidence is an independent source family joined through PR 2C's
  `marketReferenceJoinKey`; it never changes earnings-event or provider evidence-bundle identity.
- Provider observations remain distinct even when normalized facts or raw digests agree. Identical
  bytes may share an artifact digest but do not collapse provider, dataset, feed, observation, or
  entitlement identity.
- Byte-different corrections and cancellations create immutable source/revision identities and do
  not rewrite prior evidence.
- Distinguish exchange event time, provider receive time when available, request start/end,
  retrieval completion, durable artifact commit, normalization, selection, trusted PEAS observation
  anchor, replay remapping, correction arrival, and correction effective time.
- Retrieval and capture telemetry are observation evidence, not market-fact, evidence-bundle, or
  earnings-event identity.
- Use deterministic canonical representations for price, size, currency, timestamp, sequence,
  condition, and adjustment data. Do not rely on unfrozen binary floating-point behavior.
- Acquisition remains effect-isolated from normalization and selection:

```text
bounded acquisition -> private immutable raw artifact -> verified complete read
  -> pure bounded market normalization -> deterministic reference selection
  -> marketReferenceJoinKey
```

No acquisition implementation belongs in PR 2D.

Every parser, manifest, object, array, condition set, page, time window, retry declaration,
artifact, canonical output, and retained state collection must have exact byte, item, key, depth,
token, and time-window limits where applicable. Every executable numeric limit requires an exact
boundary and a one-over test.

## Phase 0 - baseline and evidence inventory

Before delegating research or implementation:

1. Verify the exact base SHA, required ancestors, readiness `GO`, and required documents.
2. Read completely:
   - every ADR;
   - the roadmap and board;
   - the readiness certificate;
   - the PR 2C final disposition;
   - PR 2B/2C orchestration, contracts, acceptance matrices, and audit evidence;
   - the no-trade disposition and all preserved candidate files;
   - the market-data entitlement gate;
   - ArtifactStore contracts and durable implementations;
   - recorded SEC, FMP, and NVIDIA loaders and normalizers;
   - the observation-ledger schema and implementation;
   - provider evidence-bundle contracts;
   - cross-source, replay, restart, memory, and SQLite acceptance tests;
   - frozen port definitions; and
   - repository contribution and validation requirements.
3. Inventory source, fixture, test, contract, audit, and migration files that PR 2D could affect.
4. Create a non-overlapping file-ownership map before assigning any writer.
5. Record the exact base SHA, Node/npm versions, operating system, commands, test totals, failures,
   skips, platform limitations, and existing warnings.
6. Run at minimum:
   - `npm.cmd run verify:runtime`;
   - `npm.cmd run format:check`;
   - `npm.cmd run lint`;
   - `npm.cmd run typecheck`;
   - `npm.cmd run build`;
   - the complete relevant PR 2C/storage/replay tests;
   - `npm.cmd run check`; and
   - `git diff --check`.
7. Create `docs/goals/pr-2d-orchestration.md` and record the baseline and ownership map.

Do not dismiss a pre-existing failure. Reproduce it on the exact clean base and record its
disposition before implementation.

## P1-07 / Wave 1 - independently authored research

Use four independently authored workstreams. Run them concurrently only as capacity permits.
Independence and complete evidence are required; simultaneous start is not. The integration owner
may complete missing ordinary research if allocation fails, but cannot replace either independent
reviewer required later.

Every report must use primary official sources where available, give direct URLs and access dates,
identify the document/specification version when available, and distinguish documented fact from
inference and recommendation. Each report must also identify unresolved human decisions and propose
deterministic algorithms, reason codes, bounds, and synthetic cases without provider/account access.

### A. Market microstructure and metric analyst

Write `docs/research/pr-2d-market-microstructure.md`.

Define deterministic rules for prior-close movement at first trusted observation; release-gap
movement; residual movement at +1, +5, and +30 minutes; every interval anchor; NBBO midpoint; last
eligible consolidated trade as a separately labeled metric; bars as a separately labeled fallback
or sensitivity; regular/extended sessions; calendars, early closes, holidays, and daylight saving;
staleness; one-sided, locked, and crossed quotes; halts and reopenings; corrections, cancellations,
odd lots, condition codes, and out-of-sequence messages; corporate actions; issuer/instrument/share
class and symbol changes; missing windows; as-known versus corrected replay; and timestamp/sequence
trust. Use official CTA, UTP, FINRA, SEC, exchange, and provider specifications where applicable.
Never silently substitute a trade or bar for a quote.

### B. Alpaca and FMP contract analyst

Write `docs/research/pr-2d-alpaca-fmp-contract.md`.

Use only official provider documentation, terms, and the sanitized entitlement record. Determine
endpoint structures, historical `feed=sip`, `v2/delayed_sip`, latest `delayed_sip`, IEX, and FMP
dataset identities; quote/trade/bar/prior-close availability; timestamps, sequences, conditions,
and nullability; pagination; rate, bandwidth, page, symbol, and time-window limits; regular,
extended, and overnight behavior; adjustments, corrections, cancellations, and symbol changes;
coverage; authentication boundaries without credential inspection; account/plan dependency; and the
retention, replay, derived-use, publication, and termination questions that remain pending.

Do not infer a right from successful access, free access, marketing language, or an existing
subscription.

### C. Identity, telemetry, and replay architect

Write `docs/research/pr-2d-market-identity-replay.md`.

Specify versioned identities and primitive preimages for provider, entitlement snapshot, dataset,
feed, venue/tape, instrument/share class, issuer mapping, acquisition attempt, raw artifact, market
fact, provider observation, duplicate delivery, correction/cancellation/revision, normalized fact,
selection policy, selected reference, missing reference, study-manifest entry, and
`marketReferenceJoinKey`. Cover nullability, exchange/provider/PEAS clocks, wall versus monotonic
time, replay remapping, duplicate bytes versus duplicate provider identity, correction ordering,
out-of-order delivery, page-size and restart invariance, provider independence, as-known/corrected
views, stable missing identities, and selection-policy versioning. Integrate with PR 2C without
changing frozen ports.

### D. Event-study and data-quality analyst

Write `docs/research/pr-2d-event-study-design.md`.

Follow the `ADOPT_WITH_CHANGES` disposition. Precommit the 100-200-cluster study's target size,
capture universe, T-1 frame, selection time and algorithm, cluster definition, sector/market-cap/
liquidity/session/model-family strata, prospective controls, event-time annotations, inclusions,
exclusions, denominators, primary/secondary metrics, minimum evidence completeness, success/failure/
inconclusive thresholds, timestamp-trust groups, session groups, quote/trade sensitivity,
missing-data/outlier/multiple-comparison policies, provider disagreement, correction policy,
sensitivity analysis, attrition reporting, and freeze manifest. Keep later trading thresholds
separate. Prevent survivorship, outcome-informed sampling, post-outcome exclusion, timestamp and
correction look-ahead, provider-selection leakage, threshold tuning, and silent loss of missing
clusters.

## P1-07 / Wave 2 - integrate and freeze ADR 0010

Reconcile all four reports and record disagreements and their resolution. Create at minimum:

- `docs/adr/0010-market-reference-contract.md`;
- a provider/source/identity table;
- a timestamp/trust table;
- a quote/trade/bar eligibility table;
- a complete reason-code table;
- an exact/one-over bound matrix;
- a fixture-manifest specification;
- an acceptance-test matrix; and
- an event-study freeze-manifest specification.

Freeze observation-anchor and interval semantics, quote/trade/bar separation, sessions, timestamp
trust, provider/dataset/feed/entitlement identity, fact/revision identity, deterministic selection,
correction and replay views, missing-reference behavior, corporate actions/symbol mapping, licensing
and private-data boundaries, a fail-closed provider/fallback policy, resource bounds, study leakage
controls, and frozen-port compatibility.

If retrieval completion versus durable artifact capture as the primary PEAS observation anchor
materially changes the scientific meaning, stop for a human decision with alternatives, expected
bias, affected metrics, and a recommendation. Do not guess.

Keep ADR 0010 `Proposed` until contract review returns `GO`. Create an intentional contract-checkpoint
commit and record its exact SHA. Implementation must not start before independent approval of that
exact checkpoint.

## P1-07 / Wave 3 - independent contract audit

Assign a fresh review-only agent that authored none of the research reports, ADR, or contract files.
The integration owner/root agent cannot self-issue or substitute for this independent decision.

Review the exact contract-checkpoint SHA. Audit deterministic identities and preimages; provider,
dataset, feed, and entitlement separation; timestamps and observation anchor; market selection,
sessions, conditions, corrections, duplicates, ordering, symbol/corporate-action mapping,
provenance, exact bounds, bounded state, restart/page-size/backend replay, stable missing reasons,
sampling/threshold/provider leakage, denominators, redistribution safety, zero-spend enforcement,
fail-closed fallback, effect isolation, and frozen-port compatibility.

Persist `docs/audit/pr-2d-contract-review.md` with the exact reviewed SHA, reviewer independence,
commands/evidence, exact file-and-line findings, binary `GO` or `NO_GO`, supersession chain, and
review date.

For `NO_GO`, return each finding to the appropriate owner, amend and test the contract, create a new
checkpoint, and obtain a fresh independent review of the new exact SHA. Continue until `GO` or a
genuine human decision is required. Agent-capacity failure may delay review but cannot waive it.

After `GO`, create an audit/status-only contract-publication commit that sets ADR 0010 to `Accepted`
and records the reviewed SHA and verdict. Prove and record that the accepted-contract head differs
from the reviewed checkpoint only by audit/status evidence. Any semantic contract change invalidates
the `GO` and requires a new checkpoint and fresh independent review. Begin implementation only from
that proven accepted-contract head.

## P1-08 / Wave 4 - recorded implementation after contract `GO`

Create a new file-ownership map from the accepted contract. Use non-overlapping implementation
owners and run workstreams concurrently only as capacity permits.

### Core market-contract owner

Implement bounded provider-neutral inputs and types; canonical numeric/timestamp representations;
provider/dataset/feed/instrument/fact/observation/revision identities; duplicate, correction, and
cancellation semantics; pure normalization; deterministic reference selection; stable reason codes;
missing-reference results; and PR 2C observation-ledger join evidence. Do not add transport or alter
frozen ports.

### Synthetic fixture and recorded-loader owner

Implement original synthetic fixtures for quotes, trades, bars, prior close, regular and extended
sessions, early closes, duplicates, identical bytes from distinct providers, corrections,
cancellations, out-of-order arrivals, odd lots, locked/crossed/one-sided/stale quotes, halts and
reopening, missing windows, corporate actions, symbol changes, malformed nested inputs, oversized
collections, and every exact/one-over resource bound. Add provenance declarations and prove tests do
not use the network.

### Determinism and integration-test owner

Prove invariance across fixture order, arrival order, duplicate redelivery, correction arrival,
restart, replay page size, memory/SQLite, clock regression/remapping, same-provider conflicts,
identical and disagreeing cross-provider facts, missing data, active analysis leases, and repeated
execution. Prove that quote, trade, and bar results stay explicitly labeled and cannot substitute
silently.

### Study-manifest owner

Implement bounded, versioned freeze-manifest types and validators for the universe/frame, T-1
snapshot, strata and target counts, prospective controls, event-time annotations, inclusions and
exclusions, metrics, thresholds, completeness denominators, missing/outlier/provider policies, code
SHA, configuration digest, contract/calendar version, entitlement snapshot, artifact/reference
identity, and dataset-freeze identity. Do not calculate study conclusions.

## PR 2D / Wave 5 - final integration, validation, and audit

Integrate only reviewed owner commits. Review the complete diff against the accepted ADR and
acceptance matrix, then run:

- `npm.cmd run verify:runtime`;
- `npm.cmd run format:check`;
- `npm.cmd run lint`;
- `npm.cmd run typecheck`;
- `npm.cmd run build`;
- `npm.cmd run check`;
- the complete offline suite;
- all focused market-reference and PR 2C observation-ledger tests;
- memory/SQLite differential, restart, and replay page-size tests;
- relevant hostile-boundary or mutation gates; and
- `git diff --check`.

Record commands, totals, failures, skips, and platform limitations. Confirm there is no provider
access, live network surface/test, secret, private account evidence, licensed raw data, subscription
activation, incremental cost, frozen-port change, financial effect, silent fallback, post-outcome
decision, or unrelated file.

Create a final candidate commit and record its exact SHA. Assign a fresh independent final reviewer
who authored no implementation and was not the integration owner. The root agent cannot replace the
reviewer. Prefer a reviewer distinct from the contract reviewer.

Persist `docs/audit/pr-2d-final-review.md` with reviewer independence, the exact reviewed SHA,
commands/evidence, exact file-and-line findings, supersession chain, and binary `GO` or `NO_GO`.
Any code or contract change after `GO` invalidates that `GO`; repair, validate, create a new SHA, and
repeat independent review.

After final `GO`:

1. update ADR 0010 with the reviewed implementation SHA and verdict;
2. update roadmap/board/acceptance/orchestration evidence truthfully, leaving P1-09 pending unless a
   separately authorized human decision changed it;
3. commit only the post-review audit/status evidence;
4. rerun documentation checks and prove the publication head differs from the reviewed
   implementation head only by audit/status evidence;
5. push `dev/pr-2d-market-reference-contract`;
6. open a draft PR against `main` describing official sources/access dates, decisions, study freeze,
   feed/dataset identities, entitlement status, synthetic provenance, validation, independent audit
   evidence, zero-spend enforcement, deferred acquisition, and explicit exclusions;
7. wait for all required Windows and Linux checks and repair failures with the same review cycle; and
8. do not merge.

## Persistence and stopping rules

Ordinary provider-response delay is not a PR 2D blocker. Continue safe recorded/offline work while
P1-09 remains pending. Ordinary allocation failure is also not a project blocker: reschedule a
research or implementation workstream or perform non-review work locally. Never waive either
independent audit.

Stop only when a decision would materially change the observation anchor or interval meaning;
provider, dataset, feed, or fallback identity; licensing or permitted derived use; authorized spend;
frozen ports; migration/dependency scope; study sampling or thresholds after outcomes; or project
scope.

## Definition of done

PR 2D is complete only when:

- the exact base and readiness prerequisites are recorded;
- ADR 0010 is `Accepted` after independent contract `GO`;
- study semantics and freeze-manifest contract are fixed before outcomes;
- provider/dataset/feed/instrument/fact/observation/revision/selection/join identities are
  deterministic;
- provider-neutral recorded code and original synthetic fixtures are implemented;
- quote, trade, and bar semantics remain distinct;
- corrections, duplicates, ordering, restart, replay page size, and memory/SQLite behavior are
  executable;
- required bounds have exact/one-over evidence;
- missing cases have stable reasons and remain in denominators;
- provider/fallback choice cannot change after outcomes;
- zero-spend and entitlement boundaries fail closed;
- no live acquisition or financial effect exists;
- the complete offline validation and required Windows/Linux checks pass;
- the final implementation has independent `GO` on an exact SHA;
- roadmap, board, audit, and acceptance evidence agree;
- a draft PR exists; and
- the PR remains unmerged.

Do not merge.
