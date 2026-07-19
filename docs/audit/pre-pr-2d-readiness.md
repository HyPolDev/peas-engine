# Pre-PR-2D readiness certificate

## Decision

- Status: `BLOCKED_PR2C_REPAIR_AND_REVIEW`
- Reviewed baseline: `origin/main@c51758a1058b86730e19185b98fcd448d9ff533a`
- Readiness branch: `dev/pre-pr-2d-readiness`
- Certificate date: `2026-07-19`
- PR 2D start authorized: `NO`
- Recorded/offline PR 2D allowed after this certificate becomes `GO`: `YES`
- Live market-reference acquisition allowed: `NO`
- P2 collection allowed: `NO`
- Incremental market-data spending allowed: `NO`

This certificate is deliberately not `GO`. The base, candidate-study disposition, and entitlement
record are prepared, but the fresh PR 2C audit returned `NO_GO`. Its findings must be repaired, an
exact repaired SHA must receive fresh independent `GO`, and final readiness validation evidence must
pass. Do not create `dev/pr-2d-market-reference-contract` until an independent reviewer changes this
certificate to `GO` against exact committed evidence.

## Baseline and ancestry

| Check | Result | Evidence |
| --- | --- | --- |
| Exact readiness base | `PASS` | `HEAD` and `origin/main` were both `c51758a1058b86730e19185b98fcd448d9ff533a` before readiness edits. |
| Pull request #4 merge present | `PASS` | `73b4d0b5f85f04f66315bdb6b43edd187381e600` is an ancestor of the readiness base and is the recorded PR #4 merge. |
| Roadmap commit present | `PASS` | `c51758a1058b86730e19185b98fcd448d9ff533a` is the exact readiness base. |
| PR 2D local branch absent | `PASS` | No local `dev/pr-2d-market-reference-contract` branch was listed on 2026-07-19. |
| PR 2D tracked remote branch absent | `PASS` | No `origin/dev/pr-2d-market-reference-contract` tracking branch was listed on 2026-07-19. A fresh fetch/remote check is required again immediately before PR 2D. |
| Unknown future readiness merge SHA avoided | `PASS` | Board metadata separates the known PR 2C code baseline from the known planning baseline and does not predict a readiness merge SHA. |

Commit identities in `docs/project-board.json` mean:

- `codeBaselineCommit`: PR 2C merge commit
  `73b4d0b5f85f04f66315bdb6b43edd187381e600`; and
- `planningBaselineCommit`: roadmap/readiness starting point
  `c51758a1058b86730e19185b98fcd448d9ff533a`.

Neither field claims to be the future merge commit of this readiness work.

## Completed readiness evidence

### Candidate study/no-trade research

- Disposition: `ADOPT_WITH_CHANGES`
- Decision record: `docs/research/no-trade-policy-disposition.md`
- Preserved non-normative archive: `docs/research/candidates/no-trade-v0.1/`
- Dirty roadmap/board proposal: explicitly rejected and not copied
- Frozen-port compatibility rule: candidate study/model/trade fields must not modify PR 2C's closed
  observation-ledger facts or frozen kernel/storage ports

Preserved candidate hashes:

| File | SHA-256 |
| --- | --- |
| `no-trade-universe-policy.md` | `22837AA14535E09B1177ABCDEB4E393E7FB7BFC4F2054177E2E170F8816C408E` |
| `no-trade-policy.v1.json` | `896E40297A51009297A4AAB0988E26DC0302BE9506367A739A1DBDA8BEF60862` |
| `no-trade-blueprint.html` | `75B03F4AEBAD8F732FD68F19C8A896305AA2C18330280B54F310D87AAF35CBCF` |

The archive is research input only. ADR 0010 must independently freeze the corrected sample frame,
strata, controls, denominators, thresholds, missingness, and leakage policy. Later model and trading
thresholds remain deferred.

### Market-data entitlement and zero-spend evidence

- Gate: `P1-09`
- Status: `PENDING`
- Decision record: `docs/research/market-data-entitlement-gate.md`
- Recorded/offline PR 2D work: `ALLOWED` after overall readiness `GO`
- P1-10 live delayed historical adapter: `BLOCKED`
- P2 forward collection: `BLOCKED`
- Any new paid capability: `NOT_AUTHORIZED`
- Provider fallback: not selected; requires human `FALLBACK_APPROVED` before outcomes

The entitlement record distinguishes historical Alpaca REST `feed=sip`, WebSocket
`v2/delayed_sip`, and latest-endpoint `feed=delayed_sip`. PR 2D may model those identities and use
original synthetic provider-shaped fixtures. It may not access a provider, account, credential, or
licensed byte while the gate is pending.

## Pending blockers

### PR 2C repair and independent disposition

- Superseded implementation head: `9b1a32a5e7992c7d98ac3bde8b79b032de76168e`
- Fresh audit verdict for that head: `NO_GO`
- Historical general audit that must land with the repair:
  `docs/audit/pr-2c-fresh-audit-9b1a32.md`
- Historical targeted audit that must land with the repair:
  `docs/audit/pr-2c-fixture-boundary-audit-9b1a32.md`
- Required repaired implementation SHA: `PENDING`
- Required durable final record: `docs/audit/pr-2c-final-disposition.md`
- Fresh independent reviewer of the exact repaired SHA: `PENDING`
- Binary repaired-head verdict: `PENDING`
- Commands, test totals, skips, and platform evidence: `PENDING`
- Explicit closure or disposition of every general and targeted audit finding: `PENDING`
- ADR 0008/0009 and PR 2C goal/audit current-status reconciliation: `PENDING`

The general audit found a derived-projection retrieval-selection defect, unbounded recorded-loader
reads, and malformed NVIDIA provenance acceptance. The targeted fixture audit additionally requires
complete terminal expected-value validation and early selector/case/path validation. Accepted ADR
0008 and the fixture contract already require existing `ArtifactStore` authority for selected
observations, so agents must implement that ordinary conformance repair without requesting a human
decision. Weakening or replacing the accepted authority model would require a separate human
contract decision. Repairs do not supersede either `NO_GO`; only a fresh independent disposition for
an exact repaired SHA can do so.

Do not infer `GO` from roadmap prose, the merge itself, passing repair tests, or a historical agent
message. The durable independent record must identify the exact repaired SHA, close every finding,
and state exactly which historical evidence it supersedes.

### Readiness validation

The following fields must be completed on the final committed readiness candidate:

| Validation | Status | Required recorded result |
| --- | --- | --- |
| `npm.cmd run verify:runtime` | `PENDING` | Exact exit status and relevant output |
| `npm.cmd run format:check` | `PENDING` | Exact exit status |
| `npm.cmd run lint` | `PENDING` | Exact exit status |
| `npm.cmd run typecheck` | `PENDING` | Exact exit status |
| `npm.cmd run build` | `PENDING` | Exact exit status |
| `npm.cmd run check` | `PENDING` | Test totals, failures, and skips |
| `git diff --check` | `PENDING` | Exact exit status |
| Board JSON parse/schema compatibility | `PASS` | PowerShell `ConvertFrom-Json` parsed schema V2; repository search found no board-schema consumer requiring an update. |
| Required Windows CI | `PENDING` | Run URL, exact candidate SHA, and result |
| Required Linux CI | `PENDING` | Run URL, exact candidate SHA, and result |

Known non-blocking limitation: account-specific provider evidence may remain pending while PR 2D
does recorded/offline work. It is blocking for P1-10 and P2, not a reason to waive any PR 2D audit.

## Dirty-worktree preservation

The user-owned checkout at `C:/Users/HyPol/OneDrive/Documentos/PEAS` remains outside this readiness
worktree.

Read-only observation on 2026-07-19 recorded:

- branch: `dev/pr-2b-sec-fixtures`;
- HEAD: `21fa58b9114b5b9ea107193eb324e03df1dcb657`;
- modified: `docs/project-board.json`, `docs/project-roadmap.md`;
- untracked: `docs/goals/`, `docs/research/`; and
- no staging, stash, reset, clean, switch, commit, move, or deletion was performed there by this
  readiness work.

All readiness writes are confined to the isolated
`dev/pre-pr-2d-readiness` worktree. The dirty roadmap/board diffs are rejected rather than imported.

## Human-only actions

The following work is intentionally not delegated to agents:

The existing accepted contract already authorizes and requires agents to make `ArtifactStore`
authoritative in the PR 2C repair. That conformance work is not a human-only action. Human direction
is required only if someone proposes weakening or replacing the accepted authority model.

1. Provide the sanitized FMP plan/account-classification attestation described in the entitlement
   record, without account identifiers, credentials, billing data, or screenshots.
2. Send Alpaca the recorded written questions, separately naming historical REST `feed=sip`,
   WebSocket `v2/delayed_sip`, and latest-endpoint `feed=delayed_sip`.
3. Send FMP the recorded written questions if FMP remains a discrepancy or fallback candidate.
4. Keep complete provider replies private; commit only a sanitized permission summary and optional
   opaque evidence digest.
5. Decide whether the project qualifies for the provider's personal/noncommercial terms.
6. If the preferred source is unavailable or denied, explicitly approve or reject a named,
   sufficiently permitted lower-evidence fallback before any P2 outcome exists.
7. Authorize no P1-10 or P2 work until the entitlement record passes independent review.
8. Do not buy, trial, upgrade, or change any market-data plan under the current zero-spend policy.

## Conditions for changing this certificate to `GO`

An independent readiness reviewer may change this certificate to `GO` only when all of the following
are true for exact committed SHAs:

1. Both historical PR 2C `NO_GO` reports named above are preserved with the repair.
2. `docs/audit/pr-2c-final-disposition.md` records an independent binary `GO` for an exact repaired
   SHA, commands/results, closure of every finding, and an explicit supersession chain.
3. PR 2C ADR, goal, and audit current-status records agree with that disposition without deleting
   historical evidence.
4. The candidate disposition, archive hashes, entitlement record, roadmap, board, and authoritative
   PR 2D assignment are internally consistent.
5. The complete local validation table above is populated and passing.
6. Required Windows and Linux checks pass on the final readiness PR head.
7. The independent reviewer records their identity, review date, exact readiness head, exact
   file/line findings, and binary verdict below.

Entitlement may remain `PENDING` when this certificate becomes `GO`, but the certificate must retain
the explicit P1-10/P2 block and fail-closed provider/fallback policy.

## Independent readiness review

- Reviewer: `PENDING`
- Reviewer independence: `PENDING`
- Exact reviewed readiness SHA: `PENDING`
- Review date: `PENDING`
- Findings: `PENDING`
- Verdict: `PENDING`
