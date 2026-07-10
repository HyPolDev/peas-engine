# ADR 0005: Release evidence is bound and reconciled by candidate commit

- Status: Accepted
- Date: 2026-07-10

## Context

A passing Windows check, Linux check, 10k scale run, and 100k scale run are not one release gate if
they were executed against different revisions. Artifact names and human-readable logs alone also
do not prove the tested source, dependency lockfile, golden vector, runtime, or integrity result.
Failed scale runs must not leave metrics that can be mistaken for release evidence.

## Decision

Every audit job checks out `PEAS_CANDIDATE_SHA`, verifies that it equals `git rev-parse HEAD`, and
requires a clean worktree before execution. The manually dispatched 100k workflow additionally
requires the dispatch ref SHA and workflow-definition SHA to equal the candidate. Checkout
credentials are not persisted.

Windows and Linux checks emit machine-readable test counts, coverage percentages and thresholds,
and mutation results. Scale metrics derive their SHA from Git, run correctness and
`PRAGMA integrity_check` assertions before writing, and explicitly record `gateStatus: passed`,
`integrityCheck: ok`, the complete latency/RSS/storage measurements, and worktree cleanliness.

Each gate evidence record contains:

- candidate, event, and workflow SHAs;
- workflow/run/attempt identity and URL;
- fixed runner OS label plus observed hosted-image identity;
- exact Node/npm versions and package-lock hash;
- captured-stream and golden-file hashes and golden heads;
- the complete relevant check and scale results.

Before the workflow exists on the default branch, adding the `audit-100k` label to the candidate PR
is the manual trigger. That labeled run repeats Windows, Linux, and 10k, executes 100k, and
reconciles all four artifacts within one CI run. After merge, the nightly workflow provides both
schedule and `workflow_dispatch` triggers, while the standalone release-evidence workflow can
reconcile separate CI and nightly run IDs. Both paths fail unless all records use one candidate,
runtime, lockfile, capture, and golden vector. Only then is a passing release manifest emitted. The
RC tag may point only to the reconciled candidate SHA.

GitHub actions are referenced by immutable commit SHA. Hosted runners use explicit OS labels
(`ubuntu-24.04` and `windows-2025`) instead of moving `-latest` aliases. Because hosted image builds
still receive updates, their `ImageOS` and `ImageVersion` values are recorded rather than claiming
bit-for-bit runner reproducibility.

## Consequences

An older passing 100k artifact cannot be reused for a newer candidate, and a failed integrity gate
cannot publish canonical passing metrics. Release evidence is self-describing enough to populate
the go/no-go report without scraping console formatting. Reconciliation remains a deliberate
manual release step because candidate 100k execution requires either the explicit PR label or a
post-merge workflow dispatch.
