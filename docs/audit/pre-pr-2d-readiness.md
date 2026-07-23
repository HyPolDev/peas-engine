# Pre-PR-2D readiness certificate

## Decision

- Status: `GO`
- Reviewed baseline: `origin/main@c51758a1058b86730e19185b98fcd448d9ff533a`
- Exact reviewed readiness candidate: `8ab07d67b25622dda32408822288c5ed88602b69`
- Readiness branch: `dev/pre-pr-2d-readiness`
- Pull request: [#5](https://github.com/HyPolDev/peas-engine/pull/5)
- Certificate date: `2026-07-23`
- PR 2D start authorized: `NO`
- Recorded/offline PR 2D allowed after this audit/status publication is merged into the verified
  PR 2D base: `YES`
- Live market-reference acquisition allowed: `NO`
- P2 collection allowed: `NO`
- Incremental market-data spending allowed: `NO`

This certificate is `GO` for prerequisite merge. The independent substantive review found zero
defects in exact candidate `8ab07d67b25622dda32408822288c5ed88602b69`, and the fresh CI-closure review
closed its sole process finding, `R2D-READY-001`, after exact-SHA Windows, Linux, and 10k-scale
success. The PR 2C implementation `GO`, prior `NO_GO / PENDING_CI` review, and final readiness `GO`
remain separately recorded and exact-SHA scoped.

This `GO` does not by itself authorize starting PR 2D from the current branch or from the old
`origin/main`. First merge this audit/status-only publication through PR #5, fetch the resulting
`origin/main`, and verify that the exact merged base contains the candidate and both readiness audit
records. Do not create `dev/pr-2d-market-reference-contract` until that merged-base verification
passes. No future merge SHA is predicted here.

## Baseline and ancestry

| Check | Result | Evidence |
| --- | --- | --- |
| Exact readiness base | `PASS` | The isolated readiness effort began from `origin/main@c51758a1058b86730e19185b98fcd448d9ff533a`; later candidate commits do not rewrite that starting identity. |
| Pull request #4 merge present | `PASS` | `73b4d0b5f85f04f66315bdb6b43edd187381e600` is an ancestor of the readiness base and is the recorded PR #4 merge. |
| Roadmap commit present | `PASS` | `c51758a1058b86730e19185b98fcd448d9ff533a` is the exact readiness base. |
| PR 2D local branch absent | `PASS` | No local `dev/pr-2d-market-reference-contract` branch was listed on 2026-07-19. |
| PR 2D tracked remote branch absent | `PASS` | No `origin/dev/pr-2d-market-reference-contract` tracking branch was listed on 2026-07-19. A fresh fetch/remote check is required again immediately before PR 2D. |
| Unknown future readiness merge SHA avoided | `PASS` | Board metadata separates the known PR 2C code baseline from the known planning baseline and does not predict a readiness merge SHA. |

Commit identities in `docs/project-board.json` mean:

- `codeBaselineCommit`: exact independently approved PR 2C repaired implementation
  `731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`; and
- `planningBaselineCommit`: roadmap/readiness starting point
  `c51758a1058b86730e19185b98fcd448d9ff533a`.

Neither field claims to be the future merge commit of this readiness work. The independent PR 2C
disposition was added by the documentation-only child commit
`aaabdb416368aa349872bc5f1d6621362f6f3cde`, whose sole parent is the exact reviewed
implementation. Merge commit `e42300a42743143db4979d7103a31e9957c48b58` combines that published
evidence lineage with the readiness package; it is an integration waypoint, not an independently
reviewed readiness head.

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

### Completed PR 2C repair and independent disposition

- Exact independently reviewed implementation:
  `731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`
- Binary implementation verdict: `GO`
- Durable final record: `docs/audit/pr-2c-final-disposition.md`
- Audit publication head: `aaabdb416368aa349872bc5f1d6621362f6f3cde`
- Combined readiness integration waypoint: `e42300a42743143db4979d7103a31e9957c48b58`

The complete supersession chain remains visible and exact-SHA scoped:

1. The general and fixture-boundary audits rejected
   `9b1a32a5e7992c7d98ac3bde8b79b032de76168e` in
   `docs/audit/pr-2c-fresh-audit-9b1a32.md` and
   `docs/audit/pr-2c-fixture-boundary-audit-9b1a32.md`.
2. `docs/audit/pr-2c-reaudit-175b75a.md` rejected
   `175b75a33acaa8a8355c37dc630cbe0ebdc4f852` after confirming the earlier defects were materially
   repaired, because sibling stream activity could continue after a metadata failure.
3. `docs/audit/pr-2c-reaudit-43ba575.md` rejected
   `43ba57539f76d01658a7fe21b06187c724c941ce` after confirming atomic metadata acquisition, because
   its cancellation fallback could return before delayed destruction closed.
4. `docs/audit/pr-2c-final-disposition.md` independently approved exact implementation
   `731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e` and explicitly closed every finding above.
5. Documentation-only commit `aaabdb416368aa349872bc5f1d6621362f6f3cde` publishes that final
   disposition as the direct child of the reviewed implementation. It does not broaden the `GO` to
   later code. Merge `e42300a42743143db4979d7103a31e9957c48b58` only combines the approved PR
   2C lineage with readiness documents.

The historical `NO_GO` records and their older current-status labels remain evidence for their own
SHAs. The final disposition is the controlling implementation gate for `731c2d3`; neither its
publication commit nor the integration merge is a readiness `GO`.

## Readiness validation

The final committed readiness candidate passed every required local and hosted gate:

| Validation | Status | Required recorded result |
| --- | --- | --- |
| `npm.cmd run verify:runtime` | `PASS` | Exit `0`; Node `24.17.0`, npm `12.0.0` |
| `npm.cmd run format:check` | `PASS` | Exit `0`; 114 files checked |
| `npm.cmd run lint` | `PASS` | Exit `0`; 114 files checked |
| `npm.cmd run typecheck` | `PASS` | Exit `0` |
| `npm.cmd run build` | `PASS` | Exit `0` |
| `npm.cmd run check` | `PASS` | Exit `0`; hard-kill 3/3; coverage 272 total, 266 passed, 6 intentional skips, 0 failed; evidence reconciliation 32 total, 31 passed, 1 Windows symlink skip, 0 failed; mutations 39/39 killed |
| `git diff --check` | `PASS` | Exit `0` |
| Board JSON parse/schema compatibility | `PASS` | PowerShell `ConvertFrom-Json` parsed schema V2; repository search found no board-schema consumer requiring an update. |
| Required Linux CI | `PASS` | PR #5 CI run [`29970456123`](https://github.com/HyPolDev/peas-engine/actions/runs/29970456123), job [`89091170729`](https://github.com/HyPolDev/peas-engine/actions/runs/29970456123/job/89091170729), exact head `8ab07d67`, terminal `success` |
| Required Windows CI | `PASS` | PR #5 CI run [`29970456123`](https://github.com/HyPolDev/peas-engine/actions/runs/29970456123), job [`89091170828`](https://github.com/HyPolDev/peas-engine/actions/runs/29970456123/job/89091170828), exact head `8ab07d67`, terminal `success` |
| Required 10k scale CI | `PASS` | PR #5 CI run [`29970456123`](https://github.com/HyPolDev/peas-engine/actions/runs/29970456123), job [`89092258656`](https://github.com/HyPolDev/peas-engine/actions/runs/29970456123/job/89092258656), exact head `8ab07d67`, terminal `success` |

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

## Satisfied `GO` conditions and remaining merge lock

The independent readiness reviews established the following for exact committed SHAs:

1. The complete PR 2C `NO_GO` and re-audit chain named above remains preserved with the final
   disposition.
2. `docs/audit/pr-2c-final-disposition.md` remains an independent binary `GO` for exact repaired
   SHA `731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`; later code changes require a new disposition.
3. The candidate disposition, archive hashes, entitlement record, roadmap, board, and authoritative
   PR 2D assignment are internally consistent.
4. The complete local validation table above is populated and passing.
5. Required Windows and Linux checks pass on the final readiness PR head.
6. The independent reviewer records their identity, review date, exact readiness head, exact
   file/line findings, and binary verdict below.
7. This audit/status-only publication still must be merged into the exact base from which PR 2D will
   branch; after the merge, fetch and verify that base before creating the PR 2D branch.

Entitlement may remain `PENDING` when this certificate becomes `GO`, but the certificate must retain
the explicit P1-10/P2 block and fail-closed provider/fallback policy.

## Independent readiness review

- Substantive reviewer: fresh independent review-only Luna agent `/root/luna_readiness_final`
- Substantive review record: `docs/audit/pre-pr-2d-readiness-review.md`
- Substantive result: zero implementation, contract, governance, archive, licensing-boundary,
  frozen-port, or dirty-worktree findings; `NO_GO / PENDING_CI` solely for `R2D-READY-001`
- CI-closure reviewer: fresh independent review-only Terra agent `/root/terra_readiness_ci_go`
- Reviewer independence: authored none of the candidate, PR 2C repair/audits, readiness governance,
  prior review, PR #5, workflow, or CI results
- Exact reviewed readiness SHA: `8ab07d67b25622dda32408822288c5ed88602b69`
- Review date: `2026-07-23`
- CI-closure record: `docs/audit/pre-pr-2d-readiness-ci-go.md`
- Findings: `R2D-READY-001` closed; zero open findings
- Verdict: `GO` for audit/status publication and prerequisite merge
