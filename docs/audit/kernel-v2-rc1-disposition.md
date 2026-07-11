# Kernel V2 RC.1 post-audit disposition

- Candidate commit: `f8764667970be2474e126ac8eab7ba7c92e66b5e`
- Historical tag: `v0.2.0-kernel-rc.1`
- Audit run: <https://github.com/HyPolDev/peas-engine/actions/runs/29129996595>
- Draft PR: <https://github.com/HyPolDev/peas-engine/pull/1>
- Disposition date: 2026-07-11
- Decision: `CONDITIONAL GO`

## Decision scope

RC.1 is a successful audit candidate and remains useful for deterministic offline comparison,
research, and PR 2A design review. It is not the frozen Kernel V2 release, must not be merged as the
final candidate, and does not authorize provider normalization, live-provider deployment, or any
financial effect.

The annotated RC.1 tag is immutable historical evidence. It must not be moved, replaced, or
deleted. All corrections target a new commit and, after new same-SHA evidence, a new
`v0.2.0-kernel-rc.2` tag.

## Evidence retained for RC.1

The RC.1 same-SHA audit passed Windows, Linux, 10k, and 100k gates against the commit above. An
independent local rerun reported 53 tests with 51 passed, 2 intentional scale-only skips, zero
failures, coverage above the configured thresholds, and five of five targeted mutations killed.
The audited lockfile reported no known npm advisories at that time.

This evidence remains valid for RC.1, but it is not sufficient for a final `GO`:

- the completed report is represented in mutable pull-request text rather than a durable release
  asset;
- the reconciled manifest is a retention-limited workflow artifact;
- the report and manifest are not assets of an immutable release with published digests and
  GitHub's machine-verifiable release attestation; and
- the audit discovered two kernel trust-boundary defects plus important release and scaling
  follow-ups.

## RC.2 merge blockers

| Finding | Required closure | RC.1 status |
| --- | --- | --- |
| A direct processing-store commit can skip event positions | Both stores bind a commit to the complete prior cursor: immediate position, predecessor event hash, monotonic logical time, and prior-derived state/decision heads; a fully rehashed skipped commit changes no rows or state | Open in RC.1 |
| Manifest versions and hashes are trusted at runtime boundaries | Strict V2 runtime schema rejects unknown fields/versions and both stores recompute manifest and behavior hashes before registration | Open in RC.1 |

Both fixes require memory and SQLite regression tests and a fresh complete release gate. Passing
through the normal processor path does not waive persistence-boundary validation.

## RC.2 required hardening and evidence

The RC.2 candidate must also:

1. record the actual nightly trigger and classify `schedule` as regression-only; only an explicit
   manual dispatch or approved pre-merge label path may produce release evidence;
2. add the `(run_id, sequence)` processing-output index through a new immutable migration and prove
   late-page reads over interleaved runs;
3. exercise the evidence reconciler against wrong SHA, runtime, lockfile, golden vector, runner,
   trigger, missing/duplicate gates, failed integrity, and malformed evidence;
4. make deterministic `EventDraft` byte and structural budgets a binding precondition before PR 2B
   provider normalization, whether the implementation lands in RC.2 or PR 2B;
5. rerun Windows, Linux, 10k, and 100k against one clean candidate SHA; and
6. enable GitHub release immutability before publication; attach the completed report, reconciled
   manifest, and `SHA256SUMS` to an RC.2 draft; publish it as a prerelease; confirm
   `isImmutable: true`; and pass `gh release verify` plus `gh release verify-asset` for every asset
   under the definition in ADR 0005.

## Scaling interpretation

RC.1 demonstrates sparse, sequential single-writer durability at 100k issuers. It does not prove a
full earnings pipeline with dense multi-source clusters, timers, analyses, reopen cycles, multiple
research runs, or complete snapshot materialization.

`better-sqlite3` performs synchronous database calls, so a live SQLite deployment requires a
dedicated writer process or equivalently isolated worker, bounded batches, a bounded queue, and
backpressure. `snapshot()` intentionally materializes the complete audit and is not the production
large-run API. Immutable research outputs grow approximately with `events x retained runs`, so
database rotation, verified archive/restore, and retention policy are required before large sweeps.

## Future-effect boundary

Read-only success never authorizes brokerage. Any future financial effect requires a separate
accepted design with an explicit effect-type allowlist, a durable `submission-started` intent
before the external call, broker idempotency where available, and reconciliation before retry after
every uncertain outcome. Automatic reclaim and resubmission of an ambiguous financial effect is
forbidden.

## Decision rationale

The deterministic kernel and audit discipline are strong, but persistence and manifest boundaries
must fail closed even when called outside the normal processor. RC.1 also lacks an immutable
release with GitHub's signed release attestation. The only defensible decision is therefore
`CONDITIONAL GO` until a single RC.2 SHA closes the findings and satisfies the complete evidence
contract.
