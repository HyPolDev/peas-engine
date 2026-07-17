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
- PR 2C is under repair on `dev/pr-2c-recorded-mirrors`. Its earlier implementation verdict was
  superseded by findings against head `9aa6a404a3098e0a6d99c7ed7ab38aa8e965fe13`; the repaired,
  fully validated head requires a fresh independent review for recorded FMP, NVIDIA Newsroom RSS,
  cross-source replay, and the observation ledger.
- No live SEC HTTP, FMP, issuer-IR, calendar, market-data, LLM, brokerage, or trading adapter exists.
- The next product slice is explicitly read-only: no LLM dependency, no orders, no brokerage, and
  no portfolio mutation.

## Delivery stages

| Stage | Outcome | Exit gate |
| --- | --- | --- |
| P0 Foundation - complete | Deterministic kernel, durable artifacts, bounded ingress, replay evidence | RC.2 and PR 2A gates are satisfied |
| P1 Forward read-only slice - in progress | Recorded SEC path, recorded FMP/IR mirrors, live reads, calendar prewarming, observation telemetry, and raw capture | A readiness drill proves complete provenance, restart recovery, replay equivalence, and zero dispatchable financial effects |
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

## Immediate sequence

Current checkpoint: PR 2B is merged as pull request #3. PR 2C's prior implementation decision was
superseded by audit findings. Repairs must pass the complete offline validation matrix, be pushed to
the existing pull request, and receive fresh independent review before merge review.

1. Validate and push the repaired PR 2C head; do not add live reads or merge it from this gate.
2. Request fresh independent review of recorded FMP/NVIDIA identity, observation-ledger, replay,
   fixture safety, and SEC compatibility evidence.
3. Merge PR 2C only through the separate human review workflow after that review.
4. Enable live read-only SEC/FMP/IR capture plus calendar prewarming and raw artifact retention.
5. Run a restart/reconciliation and completeness drill, then begin the 100-200 cluster observation
   run before adding LLM extraction or trade simulation.

The later full market-snapshot stage remains separate, but the observation run must either capture
a minimal timestamped market reference or bind a licensed historical intraday dataset before data
collection begins. Otherwise the first-observation price-movement metric cannot be reproduced.

The board should be updated when a gate, dependency, or acceptance criterion changes—not on every
small coding step. The PR and test evidence remain the detailed execution log.
