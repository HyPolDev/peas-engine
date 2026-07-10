# Kernel V2 release-candidate go/no-go report

## Candidate identity

- Commit SHA: `<40-character SHA>`
- Candidate tag: `v0.2.0-kernel-rc.1`
- V1 archival ref: `archive/kernel-v1`
- Worktree clean: `<yes/no>`
- Node: `24.17.0`
- npm: `12.0.0`

Every link and artifact below must embed or report the candidate SHA above. Evidence from any other
revision is inadmissible.

- Reconciled release-manifest artifact: `<URL>`
- Reconciliation status: `<passed/failed>`
- CI run ID shared by Windows/Linux/10k: `<run ID>`
- Manual 100k run ID: `<run ID>`
- Manual 100k trigger: `<audit-100k PR label / workflow_dispatch>`

## Required remote evidence

| Gate | Result | Candidate SHA | Evidence link |
| --- | --- | --- | --- |
| Windows `npm run check` | `<pass/fail>` | `<SHA>` | `<URL>` |
| Linux `npm run check` | `<pass/fail>` | `<SHA>` | `<URL>` |
| Linux SQLite 10k | `<pass/fail>` | `<SHA>` | `<URL>` |
| Linux SQLite 100k | `<pass/fail>` | `<SHA>` | `<URL>` |

## Correctness evidence

- Tests: `<passed/skipped/failed>`
- Line/branch/function coverage: `<percentages>`
- Targeted mutations killed: `<count/total>`
- `PRAGMA integrity_check`: `<result>`
- Event head: `<hash>`
- State head: `<hash>`
- Decision head: `<hash>`
- Captured fixture SHA-256: `<hash>`
- Golden file SHA-256: `<hash>`

### Golden-head explanation

Explain every changed event, state, or decision head by reducer, schema, manifest, canonicalization,
or fixture behavior. Never approve a golden update whose only rationale is making CI pass.

## Performance evidence

| Scale | Throughput | p50 | p95 | p99 | RSS delta | DB size | WAL size | Slope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k | | | | | | | | |
| 10k | | | | | | | | |
| 100k | | | | | | | | |

## Finding-to-regression map

| Audit finding | Resolution | Regression test | Result |
| --- | --- | --- | --- |
| Older/duplicate envelope bypassed verification | Strict envelope validation plus exact persisted predecessor/suffix-to-cursor verification before no-op | `processor-integrity.test.ts`, `sqlite-integrity.test.ts`, `stored-event-validation.test.ts` | |
| In-flight analysis used mutable cluster inputs | Frozen branch input snapshot | `reducer-contracts.test.ts` | |
| Non-live run could enable effects | Runtime/store/SQL effect matrix | `run-policy.test.ts`, `sqlite-integrity.test.ts` | |
| Analysis provenance was self-attested | Manifest-bound five-field contract and hash | `reducer-contracts.test.ts` | |
| SQL relational columns were unaudited | Relational envelope and claim reconciliation | `sqlite-integrity.test.ts` | |
| Rejected migration left side effects | One validated `IMMEDIATE` plan transaction | `sqlite-integrity.test.ts` | |
| Aggregate could grow quadratically | Hard 32-source/32-branch limits and byte-identical capacity rejection | `reducer-contracts.test.ts`, `persistence-scale.test.ts` | |
| Timer/cap/CIK/UTF-8/mirror edge cases | Deterministic lifecycle and bounded-state corrections | `reducer-contracts.test.ts`, `property.test.ts` | |
| Persistence/concurrency/crash uncertainty | Differential, process contention, and SIGKILL recovery | persistence/SQLite audit suites | |

## Known limitations and accepted risks

- `<limitation, owner, expiry/review condition>`

## Decision

Choose exactly one and justify it:

- `GO`
- `CONDITIONAL GO`
- `NO-GO`

Decision owner: `<name>`  
Decision date: `<ISO date>`  
Rationale: `<evidence-based rationale>`
