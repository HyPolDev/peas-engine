# PEAS project operating model

This is the working plan for turning PEAS into a safe, auditable, read-only research system before
any financial effect is considered. The machine-readable board lives in
[`docs/project-board.json`](project-board.json); the interactive blueprint is the human view of the
same plan.

## Recommended tool stack

Use GitHub as the execution system, the repository as the durable specification, and the blueprint
as the shared orientation layer:

1. **GitHub Issues/Projects** — task status, ownership, dependencies, PR links, review, and release
   gates. This is the place agents can work against without inventing a second task system.
2. **Repository docs** — ADRs, acceptance criteria, fixtures, evidence, and the versioned board.
   These remain available to every local agent and travel with the code.
3. **Interactive blueprint** — a compact view for seeing the whole system, sequencing, and current
   bottlenecks.

Use Notion for long-form research notes or a decision journal only if that becomes useful. Use
Linear only if PEAS becomes a larger human engineering team that needs product-planning workflows.
Do not maintain task state independently in Linear, Notion, and GitHub.

## Current position

- Kernel V2 RC.2 is an immutable prerelease at
  `fe04e32f9b218b41b1c56bffd2a131fb32192f82`. The exact-SHA platform, scale, release, asset, and
  checksum verification gates passed, so the effective decision is `GO` for read-only slice work.
- The provider-neutral artifact vault is complete. PR #2 merged to `main` at
  `e350210a3c8d8f0bd3ae512dde9461fcfb58d0b4` after successful CI.
- The deterministic `EventDraft` resource boundary is also complete in RC.2 and covered by
  adversarial memory/SQLite tests.
- ADR 0007 is accepted after independent review. It freezes PR 2B evidence membership, selected
  observation loading, SEC semantics, parser/decoder policy, compatibility, limits, reason codes,
  and non-live effect isolation without changing frozen ports.
- PR 2B merged as pull request #3 at `41f19b83e104857ed32b45fa5838c8199f5467ab`. It implements
  and independently audits the recorded SEC path: synthetic raw fixtures,
  verified selected-observation loading, pure deterministic normalization, schema-V2 evidence
  provenance, trusted capture, and byte-identical live-style/replay processing in memory and
  SQLite. Historical RC.2 vectors and frozen kernel ports remain unchanged.
- PR 2C originally merged as pull request #4 at
  `73b4d0b5f85f04f66315bdb6b43edd187381e600`. The preserved audit chain rejected implementation
  SHAs `9b1a32a5e7992c7d98ac3bde8b79b032de76168e`,
  `175b75a33acaa8a8355c37dc630cbe0ebdc4f852`, and
  `43ba57539f76d01658a7fe21b06187c724c941ce`. A fresh independent review then returned `GO` for
  exact repaired implementation `731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`. Its final disposition
  is `docs/audit/pr-2c-final-disposition.md`, published by documentation-only child commit
  `aaabdb416368aa349872bc5f1d6621362f6f3cde` and combined with the readiness package by
  `e42300a42743143db4979d7103a31e9957c48b58`. The `GO` remains scoped to the reviewed implementation
  SHA; it is not a readiness verdict.
- Planning commit `c51758a1058b86730e19185b98fcd448d9ff533a` records the P1-07, P1-08,
  P1-09, P1-10, and P1-06 sequence. Exact readiness candidate
  `8ab07d67b25622dda32408822288c5ed88602b69` received independent `GO` after PR #5 CI run
  [`29970456123`](https://github.com/HyPolDev/peas-engine/actions/runs/29970456123) passed Linux job
  `89091170729`, Windows job `89091170828`, and required 10k-scale job `89092258656`.
  `R2D-READY-001` is closed. PR #5 merged as `0377323b5486a8ad3b8e2631d4c8559760893be6`;
  the isolated PR 2D branch was created from that exact fetched and verified `origin/main` base.
  P1-07 is in progress and implementation remains locked behind its independent contract `GO`.
- The preserved no-trade candidate has disposition `ADOPT_WITH_CHANGES`. It is research input for
  ADR 0010, not an executable policy; later model/trade thresholds remain outside PR 2D.
- The P1-09 market-data entitlement gate is active with gate state `PENDING`: human attestation and
  written-provider evidence collection proceed in parallel. The gate cannot close until its frozen
  provider/dataset/feed/fallback policy is compatible with accepted ADR 0010 and receives independent
  `GO`. Recorded/offline PR 2D work may proceed after readiness `GO`, but P1-10 and P2 remain blocked.
- No live SEC HTTP, FMP, issuer-IR, calendar, market-data, LLM, brokerage, or trading adapter exists.
- The next product slice is explicitly read-only: no LLM dependency, no orders, no brokerage, and
  no portfolio mutation.

## Delivery stages

| Stage | Outcome | Exit gate |
| --- | --- | --- |
| P0 Foundation - complete | Deterministic kernel, durable artifacts, bounded ingress, replay evidence | RC.2 and PR 2A gates are satisfied |
| P1 Forward read-only slice - in progress | Live SEC/FMP/IR capture, calendar prewarming, and a zero-incremental-cost delayed market-reference path | A readiness drill proves complete provenance, frozen market joins, restart recovery, replay equivalence, and zero dispatchable financial effects |
| P2 Observation run | 100–200 forward earnings clusters with latency, missing-event, duplicate, revision, and first-observation price-movement measurements | Dataset has source-level provenance and a reproducible measurement report |
| P3 Context snapshots | Prospective FMP estimates, regular/aftermarket market data, sector/SPY abnormal movement, session, halt, and first-tradable-quote state | Every decision input is timestamped, versioned, and replayable |
| P4 Decision packets | Deterministic numbers first; evidence-backed language/guidance extraction second; explicit setup/no-trade classification | Packets are reproducible, source-linked, and safe to compare in replay |
| P5 Historical research | Parquet datasets, latency assumptions, executable fills, benchmark-adjusted outcomes, MFE/MAE, and cost-aware walk-forward validation | Research runs are isolated, auditable, and do not create dispatchable work |
| P6 Shadow and paper | Hypothetical intents, broker state, fills, and reconciliation without live capital | Shadow/paper invariants hold across restart, duplicate delivery, stale leases, and ambiguity |
| P7 Tiny live deployment | Small, separately authorized live effect path | A separate safety ADR, broker idempotency, pre-call durable submission, and reconciliation gates pass |

## Execution model

The critical path is sequential at the contract boundaries, but implementation can be parallelized
inside a stage:

- One integration owner controls migrations, event contracts, and release evidence.
- Provider adapters, capture, calendar prewarming, market snapshots, and research tooling can be
  separate agent tasks once their input/output contracts are written.
- Every task has one narrow acceptance test and one evidence location. A task is not done because
  code exists; it is done when the test, fixture, replay behavior, and provenance are reviewable.
- Recorded fixtures precede live provider access. The first live read order is SEC, FMP, then a
  small issuer-IR allowlist, even if the eventual forward slice runs those sources in parallel.
- Any task that would introduce an order, broker credential, portfolio mutation, or ambiguous
  external effect is out of scope until P7 and requires a new safety review.

## Agent task contract

Each GitHub issue or PR should include:

- `id`, `stage`, `status`, `owner`, and `dependsOn`;
- the exact acceptance test and command;
- fixtures or evidence produced;
- replay/effect implications;
- branch and PR links; and
- the next unblocker if the task is blocked.

Use these statuses: `blocked`, `ready`, `in-progress`, `review`, `done`, and `gated`. Keep one
small task per PR whenever the task changes a contract, migration, provider boundary, or safety
invariant.

## Zero-incremental-cost path to event validation

Current checkpoint: PR 2B and the original PR 2C are merged as pull requests #3 and #4. The repaired
PR 2C implementation has exact-SHA independent `GO`, and combined readiness candidate `8ab07d67`
has a final independent readiness `GO` with `R2D-READY-001` closed. PR #5 merged as exact PR 2D base
`0377323b5486a8ad3b8e2631d4c8559760893be6`; that `origin/main` was fetched and verified before the
isolated branch was created. P1-07 research is complete, and the human owner approved durable
capture as primary with retrieval sensitivity and as-of target selectors. The first contract
checkpoint `7c484124680972b5cbbd39f31cf69b542a6341cc` received independent `NO_GO`; its six
determinism findings are preserved in `docs/audit/pr-2d-contract-review.md`. The first repaired
checkpoint `726f1690ce80562a1e9a452a26bf90849f04d08f` also received independent `NO_GO`; its four
cross-document findings are preserved in `docs/audit/pr-2d-contract-reaudit.md` and are repaired.
The next checkpoint `737ea8fc236c07ea7bba635bda63abcc74126de3` closed those findings but received
independent `NO_GO` for one newly discovered underbound release-cluster candidate identity,
preserved in `docs/audit/pr-2d-contract-final-reaudit.md`. That formula was repaired at
`acbad9a7757ac1d42f89769c217ef5075a0d1998`, whose independent audit then found only that its new
literal vectors used invalid issuer/instrument identity families; the finding is preserved in
`docs/audit/pr-2d-contract-go-audit.md`. That final finding was repaired in content commit
`acd9f25bc89355ce18292d0dcd5afecfebf818cf`, bound by registry
`car1_f57a4f613fbadcb7a3b38dbf9748dfecc725d33e747b042fe2f21fba5d52eaad`, and independently
reviewed at exact checkpoint `750e1ab2486ce785a60304fceb19a1502ff34319`. The fresh review in
`docs/audit/pr-2d-contract-final-go.md` returned `GO` with implementation authorization and no
findings. ADR 0010 is Accepted, P1-07 is complete, and P1-08 recorded/offline implementation is in
progress under a non-overlapping ownership map. No new
market-data spend is authorized before the first event-validation study. Historical Alpaca REST
`feed=sip`, WebSocket `v2/delayed_sip`, and latest-endpoint `feed=delayed_sip` are separate identities
unless written provider evidence proves an exact equivalence. Existing FMP Premium is a pending
repository assertion and a separately labeled lower-evidence discrepancy candidate, not an
authorized or SIP-equivalent fallback. Paid Alpaca, FMP Ultimate, IBKR, Databento, Massive, and every
other new subscription remain deferred.

The entitlement delay does not block official-document research, provider-neutral contracts,
original synthetic fixtures, recorded implementation, or offline tests in PR 2D. It does block the
P1-10 market adapter and P2 collection. Agents must not inspect accounts or credentials, call a
provider, retrieve provider bytes, activate a plan, or silently choose a fallback while the gate is
pending. An IBKR live witness is not required for P2 and remains deferred.

### Fast-track scheduling judgment

Treat one day as an evidence-producing delivery box, not as an unconditional calendar promise. The
first three steps can move at roughly one box per focused day because they are contract, research,
and recorded-fixture work. Step 4 contains several adapters and needs parallel ownership plus an
integration pass. Step 5 must include a real scheduled observation window, so its elapsed time also
depends on the earnings calendar and provider availability.

| Delivery box | Fastest credible effort | Exit evidence | Main timing risk |
| --- | --- | --- | --- |
| 1. ADR 0010 and frozen study design | 1 focused day plus independent review | Accepted ADR, metric/reason-code tables, study manifest contract, review `GO` | A metric or timestamp decision changes the contract |
| 2. Zero-cost entitlement and retention | Human response and provider response time are unbounded | Sanitized human attestation plus written permission, or an explicit permitted lower-evidence fallback decision before outcomes | Account-specific and provider legal/support response time |
| 3. Recorded market-reference implementation gate | 1-2 focused days after ADR `GO` | Synthetic fixtures, exact/one-over tests, replay/order invariance, independent `GO` | Corrections, quote conditions, or bounds expose contract gaps |
| 4. Live sources plus delayed reference adapter | 2-4 focused days with non-overlapping parallel owners | SEC, FMP, NVIDIA and delayed reference paths integrated behind recorded contracts | Rate limits, authentication, provider variance, restart integration |
| 5. Integrated readiness drill | 1 setup day plus one complete scheduled window | Restart/reconciliation, backfill, deterministic replay, completeness and zero-effects evidence | No suitable event window or an external provider outage |

A strong team can therefore finish the engineering portion in approximately five to eight focused
working days. Five calendar days is an aggressive best case: it assumes ADR review closes quickly,
Alpaca answers immediately, implementation runs in parallel, and a suitable live event window is
available. The project manager may compress handoffs but must not merge a gate merely to preserve
the schedule.

### Step 1 - freeze the study and market-reference contract

Create ADR 0010 before market-provider implementation. It must define:

- first trusted PEAS observation as the primary observation anchor and its clock-basis requirements;
- prior-close movement, release-gap movement, and residual movement at +1, +5, and +30 minutes;
- NBBO midpoint as the preferred quote measure and last eligible trade as a separately labeled
  measure, never a silent substitute;
- regular and extended-hours session rules, staleness ceilings, halts, crossed quotes, corrections,
  missing windows, symbol changes, and issuer/instrument mapping;
- independent market-source, artifact, observation, and revision identities joined through
  `marketReferenceJoinKey` without changing event identity or frozen kernel ports;
- byte, item, page, request, time-window, retry, and retained-artifact bounds; and
- a licensing boundary that keeps raw provider bytes private and permits only synthetic fixtures in
  Git.

In parallel, freeze the 100-200-cluster universe, sampling strata, prospective controls,
event-time data-quality annotations, exclusions, denominators, minimum evidence completeness, and
success/failure/inconclusive thresholds. Follow the `ADOPT_WITH_CHANGES` decision in
[`docs/research/no-trade-policy-disposition.md`](research/no-trade-policy-disposition.md): treat the
preserved `120/40/20` allocation and later trading thresholds as candidate inputs, not accepted
contract values. The study must not choose sampling, fallback, exclusions, or thresholds after
inspecting outcomes.

The copy-ready manager assignment for this gate is
[`docs/agent-prompts/adr-0010-market-reference.md`](agent-prompts/adr-0010-market-reference.md).

### Step 2 - collect evidence and close the zero-cost entitlement and retention gate

Human evidence collection may start before ADR 0010 is accepted. The gate may close only after its
provider, dataset, feed, entitlement, and fallback policy is checked for compatibility with accepted
ADR 0010 and receives independent `GO`.

The human owner must obtain written Alpaca answers covering exact product/feed identity, durable
private retention, offline replay, internal non-display research, retention after account closure,
and publication of derived latency/return statistics. Historical REST `feed=sip`, WebSocket
`v2/delayed_sip`, and latest-endpoint `feed=delayed_sip` must be asked about separately. Agents must
not inspect the account, credentials, dashboards, invoices, correspondence, or provider bytes.

The human owner must provide a sanitized FMP plan/classification attestation and obtain written
permission for each required use if FMP remains a candidate. FMP remains separately labeled lower-
evidence discrepancy research, not a silent replacement for missing SIP evidence.

If Alpaca does not permit the required use, stop at the recorded boundary. A no-spend FMP-only or
other lower-evidence fallback requires explicit human `FALLBACK_APPROVED` status, sufficient
retention/replay permission, and any necessary study-contract amendment before outcomes. No
provider is selected automatically.

The complete pending capability matrix, acceptable sanitized evidence, questions, and human-only
actions live in
[`docs/research/market-data-entitlement-gate.md`](research/market-data-entitlement-gate.md).

### Step 3 - pass the recorded market-reference implementation gate

Add synthetic SIP-style quote, trade, and bar manifests plus executable contract tests for exact
and one-over bounds, regular/extended sessions, duplicates, corrections, stale/crossed quotes,
halts, missing windows, symbol remaps, malformed payloads, and oversized pages. Tests must prove
identical normalized output and selected references across fixture order, retrieval order, restart,
and replay page size. No test contacts a provider.

### Step 4 - build live source capture and delayed market acquisition only after their gates

P1-10 must not begin while P1-09 is `PENDING`. After the human-owned entitlement snapshot receives
independent `GO`, implement only the exact approved delayed historical provider/dataset/feed behind
the accepted recorded contract:

```text
bounded acquisition -> private raw artifact -> verified read -> pure market normalization
  -> deterministic reference selection -> marketReferenceJoinKey
```

Retrieval timing and reference selection then follow the accepted ADR 0010 and frozen entitlement
snapshot. Credentials, URLs, arbitrary headers, prices, and retrieval telemetry do not enter
earnings-event identity. A hard configuration prevents paid-plan activation, unapproved feed
selection, fallback drift, or a non-zero provider budget before the validation decision.

### Step 5 - run the integrated readiness drill

Exercise at least one complete scheduled window and prove restart/reconciliation, missed-window
backfill, duplicate delivery, corrections, clock regression handling, quota enforcement, provider
unavailability, deterministic replay, raw-artifact verification, and stable missing-reference reason
codes. Recompute selected market references from frozen artifacts and compare memory/SQLite results.
The deployment must expose no broker/order surface and create zero dispatchable financial effects.

### Step 6 - collect and freeze the forward dataset

P2 remains blocked until P1-09, P1-10, and P1-06 are complete. Then collect 100-200 forward earnings
clusters using the precommitted universe and strata. Every cluster
must retain source-level provenance, publication and PEAS observation clocks, raw artifact digests,
duplicate/revision relationships, the frozen market-reference join, and eligibility/no-trade
snapshot. A cluster with unavailable or unusable market evidence remains in the denominator with a
stable reason code; it is not silently dropped.

Freeze a dataset version, manifest, code SHA, configuration digest, provider/entitlement snapshot,
and completeness report before calculating study conclusions.

### Step 7 - complete the event-validation study

Report source coverage, missingness, duplicates, revisions, publication-to-observation latency,
movement already present at first observation, and residual +1/+5/+30-minute movement. Separate
regular from extended-hours events, trusted from inferred publication times, quote from trade
measures, and complete from degraded market references. Include sensitivity checks for staleness,
outliers, provider disagreement, and missing-data treatment.

The decision gate asks whether the event/source system shows enough measurable, reproducible value
to justify the next investment. Only after that review may the roadmap authorize an IBKR prospective
witness, a paid consolidated feed, FMP Ultimate, Databento, or later LLM/trading work.

The board should be updated when a gate, dependency, or acceptance criterion changes—not on every
small coding step. The PR and test evidence remain the detailed execution log.
