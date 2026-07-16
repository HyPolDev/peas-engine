# PR 2B Goal Orchestration Contract

## Objective

Deliver PR 2B, recorded SEC end-to-end normalization, as a ready-for-review pull request from
`dev/pr-2b-recorded-sec-ete` to `main`. Do not merge the pull request.

The architecture accepted in commit `5a2960ed76f413549a689f31a50f1bfa2d667d13` is binding.
Read these files completely before implementation:

- `docs/adr/0007-recorded-sec-normalization.md`
- `docs/agent-prompts/pr-2b-recorded-sec.md`
- `docs/read-only-vertical-slice-plan.md`

## Orchestrator role

The root agent is the architecture and integration owner. It maintains the plan, assigns bounded
work, enforces gates, reviews every proposed diff, integrates accepted commits, runs final checks,
and opens the pull request. It must not duplicate delegated implementation while an owner agent is
working on it.

Keep agent depth at one. Use no more than six open subagent threads and no more than two concurrent
write agents. Parallelize read-only audits freely within that limit. Parallelize writers only when
their file ownership is disjoint and they work in isolated Git worktrees. If isolated worktrees are
unavailable, serialize all writes.

## Starting-state rule

Before spawning implementation agents, inventory the current branch, worktrees, commits, staged,
modified, and untracked files. Preserve all user and agent work. Never reset, delete, overwrite, or
silently re-create existing candidate work.

At goal creation, candidate Agent 1 and Agent 2 outputs may exist uncommitted on
`dev/pr-2b/evidence-bundle`, including `fixtures/sec/`, `src/providers/`, and their tests. Treat them
as candidate deliverables: audit them, identify ownership, run their checks, and either adopt and
commit them intentionally or return precise findings to an owner agent. Do not begin Agent 3 or 4
until accepted Agent 1 and Agent 2 commits are integrated into the integration branch.

## Git and authority

- Use `dev/pr-2b-recorded-sec-ete` as the integration branch.
- Base each implementation worktree on the latest accepted integration commit at its gate.
- Give every writer exclusive file ownership in its prompt.
- Owner agents may test and commit only their owned changes. They must not push, merge, rebase,
  reset, or alter another agent's files.
- The root orchestrator reviews and cherry-picks or otherwise integrates accepted commits.
- The root may push the final integration branch and open a ready-for-review PR to `main`.
- Do not merge the PR. Do not rewrite shared history.

## Execution waves

### Wave 0 â€” Adoption and baseline

On the critical path, inventory the repository and map existing uncommitted files to Agent 1 or 2.
In parallel, use two read-only reviewers when useful:

1. Fixture reviewer: audit candidate SEC fixture bytes, manifests, expectations, licensing, and
   fixture tests against ADR 0007 and the Agent 1 prompt.
2. Evidence-bundle reviewer: audit provider-neutral bundle types, validation, canonical hashing,
   verified reads, limits, and tests against ADR 0007 and the Agent 2 prompt.

Wait for both. Resolve findings through the relevant owner, run focused checks, review diffs, and
integrate accepted Agent 1 and Agent 2 commits. Record the new integration SHA.

### Wave 1 â€” Parser and domain V2

After Agent 1 and 2 are integrated, spawn at most two isolated writers concurrently:

1. Agent 3, SEC parser/normalizer, owns only the files assigned by its prompt plus package manifest
   and lockfile changes. It alone may add exactly `htmlparser2@12.0.0`. It must request any required
   network or sandbox approval and must not substitute another dependency.
2. Agent 4, earnings-domain V2, owns only reducer/domain and assigned tests. It must not edit SEC
   fixtures, parser goldens, package manifests, or lockfiles.

Use the exact Agent 3 and Agent 4 sections in `docs/agent-prompts/pr-2b-recorded-sec.md`, replacing
base SHA and branch placeholders with the current gate values and appending the ownership,
worktree, no-revert, test, and handoff rules from this contract. Wait for both, review independently,
then integrate in dependency-safe order and rerun combined checks.

### Wave 2 â€” End-to-end integration

Run Agent 5 sequentially from the latest integration commit. It owns only recorded-pipeline wiring,
end-to-end acceptance tests, and explicitly assigned supporting files. It must prove deterministic
live-style versus replay hashes, evidence completeness, transcript behavior, bounded operation, and
`effectsAllowed: false`. Review and integrate only after focused and combined checks pass.

### Wave 3 â€” Adversarial review and bounded repair loop

Run Agent 6 as an independent, read-only adversarial reviewer. Require findings ordered by severity
with exact file and line references, acceptance-matrix coverage, test gaps, dependency/license
review, frozen-port confirmation, and a binary verdict.

If findings remain, group them by disjoint ownership. Spawn the minimum number of repair agents,
at most two writers concurrently, with each prompt containing only its accepted findings, owned
files, required tests, and prohibition on weakening ADR 0007. Integrate reviewed repairs, rerun
focused and full checks, then rerun an independent read-only review. Continue the review-fix-review
loop until there are no unresolved blocker or high findings.

If the same blocking condition survives three complete review/repair cycles, or resolving it would
change a frozen kernel port or accepted architecture, stop and request a user decision. Do not lower
severity, remove an acceptance test, or reinterpret the contract merely to obtain a pass.

### Wave 4 â€” Final integration and publication

The root integration owner reviews the complete diff, runs all required local checks, validates the
goldens and dependency/license delta, confirms a clean integration worktree, pushes
`dev/pr-2b-recorded-sec-ete`, and opens a ready-for-review PR against `main`. Monitor the required
Windows and Linux GitHub checks and repair failures through the same bounded ownership loop.

## Prompting protocol

For Agents 1 through 6, use the corresponding prompt in
`docs/agent-prompts/pr-2b-recorded-sec.md` as the technical assignment. Every spawned-agent prompt
must additionally state:

- its wave, base SHA, branch/worktree, and exact owned paths;
- which other agents are active and that their changes must not be reverted;
- whether the task is read-only or may write and commit;
- the required focused checks and handoff format;
- the PR 2B exclusions and frozen-port rule;
- that completion means a reviewed commit or evidence-backed review, not a prose-only claim.

Each writer handoff must include commit SHA, changed files, checks and results, assumptions, and any
remaining risks. Each reviewer handoff must include severity-ordered findings and a binary verdict.

## Scope boundaries

PR 2B must not add live SEC HTTP, FMP or issuer-IR work, LLM extraction, market data, brokerage,
trading, or any financial effect. All recorded-pipeline runs use a non-live manifest with
`effectsAllowed: false`. Frozen kernel port signatures must not change.

Stop for user direction before any scope expansion, frozen-port change, redistribution of real SEC
document bodies, security/integrity compromise, or action requiring credentials the user has not
authorized.

## Definition of done

Do not mark the goal complete until all of the following are verified:

- Agent 1 through Agent 6 scopes are completed, reviewed, and integrated.
- Every ADR 0007 acceptance item has a passing test or explicit verified evidence.
- Recorded live-style processing and replay produce identical state and decision hashes.
- Evidence-bundle provenance, SEC identity/linkage, timestamps, parser/decoder bounds, transcript
  outcomes, projected state bounds, mixed V1/V2 behavior, and failure reasons are covered.
- `npm run check` and all additional required local tests pass from a clean integration worktree.
- Only the accepted dependency and reviewed license/lockfile changes are present.
- No live network path or financial effect is introduced.
- The final adversarial audit has no unresolved blocker or high findings.
- Required Windows and Linux PR checks are green.
- The roadmap/board and relevant documentation reflect the delivered state.
- A ready-for-review PR from `dev/pr-2b-recorded-sec-ete` to `main` exists with an accurate summary,
  test evidence, golden/dependency notes, risks, and explicit exclusions.

A draft PR, passing focused tests alone, or an implementation claim without independent review is
not completion.
