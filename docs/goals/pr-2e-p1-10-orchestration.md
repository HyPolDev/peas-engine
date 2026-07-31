# PR 2E P1-10 historical market-reference acquisition orchestration

## Program decision

P1-10 is a two-pull-request, contract-first program.

- **PR 2E** is the recorded/offline contract wave. It may contain documentation, original
  synthetic fixtures, deterministic provider doubles, static checks, executable contract tests,
  state-machine models, rejection tests, acceptance matrices, and retention/deletion proposals.
  It must contain no production transport, credential loading, provider request, provider payload,
  or provider-derived example.
- **PR 2F** is the implementation wave. It may not begin until a fresh independent reviewer returns
  `GO` for one exact PR 2E candidate SHA, the orchestration owner acknowledges that checkpoint, and
  the human owner separately authorizes any retention implementation that changes a port,
  migration, reconciliation rule, or artifact-vault semantic.
- Neither pull request may be merged without a separate human-owner merge authorization.
- Contract `GO` does not authorize a provider witness. No provider witness is part of PR 2E.

Until all gates are satisfied, P1-10 remains in progress, P1-06 remains blocked, and P2 remains
blocked.

## Baseline and isolation record

| Item | Frozen value or observed state |
| --- | --- |
| Repository | `HyPolDev/peas-engine` |
| Required base | `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` |
| Verified `origin/main` | `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` |
| Initial branch head | `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` |
| PR 2E branch | `dev/pr-2e-p1-10-historical-sip-acquisition-contract` |
| Worktree | isolated task worktree under `.codex/worktrees/ff4b/PEAS` |
| Initial worktree state | clean; no staged, modified, or untracked paths |
| PR 2D merge | `ebe959324e48faf73c325a97ed9200bd6c76c9a6` |
| PR 2D reviewed implementation | `9dcefde1954c8426312fb082950b6105fe6847f6` |
| P1-09 initial reviewed candidate | `d034b5e5d6632d6a1e875fa6b0221d1c8185c92d` (`NO_GO`) |
| P1-09 repaired candidate | `ce92cb46e3fd9957f9b9c6834bb8217a2c987ac5` (`NO_GO`) |
| P1-09 accepted candidate | `36dcf92b465fc5708614718b4312631fb5dbf544` (`GO`) |
| P1-09 closure/current main | `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` |

The commits after the PR 2D merge are, in order:

1. `fb68e43d5f984d21ec16cde0ad20aa7ee0d101a5` — post-PR 2D roadmap update;
2. `d034b5e5d6632d6a1e875fa6b0221d1c8185c92d` — P1-09 owner authorization;
3. `ce92cb46e3fd9957f9b9c6834bb8217a2c987ac5` — first P1-09 audit repair;
4. `36dcf92b465fc5708614718b4312631fb5dbf544` — final P1-09 re-audit repair and reviewed
   candidate; and
5. `1061d0171b24d957214dbdeaf19d39b9f0e2fa6a` — P1-09 closure and status publication.

If a later baseline check finds a different `origin/main`, work stops. The later commits must be
inspected and their changed assumptions reported; no agent may automatically rebase or reinterpret
the frozen authority.

## Authority chain and reading result

The program is constrained, in descending order of current operational relevance, by:

1. the human P1-10 assignment and its closed authorization classes;
2. P1-09 final independent `GO` at
   `36dcf92b465fc5708614718b4312631fb5dbf544`;
3. the human-owner authorization in
   `docs/research/p1-09-owner-risk-authorization.md`;
4. the accepted PR 2D contract authority and ADR 0010;
5. ADR 0009's immutable observation/clock ledger;
6. ADR 0006's private provider-neutral artifact vault and migration 005; and
7. the existing recorded implementation and its exact-SHA test/release evidence.

The P1-09 final `GO` supersedes historical operational prose saying that P1-09 is pending.
Historical statements remain evidence of the earlier gate state. Accepted PR 2D contract bytes and
P1-09 authority documents are read-only in PR 2E and must not be edited merely to modernize status.

PR 2E freezes acquisition behavior around the already accepted provider-neutral PR 2D identities,
normalization, selection, corrections, missingness, study, and resource contracts. It does not
change those contracts or authorize outcomes, P2 collection, a new provider policy, a new feed, or
a financial effect.

## Milestone boundary

- P1-03 owns live SEC acquisition, the earnings-related FMP mirror, and issuer-IR acquisition.
- P1-04 owns schedule and calendar prewarming.
- P1-10 owns only historical market-reference acquisition, private raw capture, restart/replay, and
  translation into the accepted provider-neutral PR 2D boundary.
- P1-10 must not add calendar acquisition or a generic arbitrary-route FMP client shared with
  P1-03.
- Existing `src/providers/market-reference/**`,
  `src/adapters/market-reference/**`, and `src/study/market-reference/**` remain network-free.
  `recorded-market-loader.ts` retains its synthetic-only provenance and is not repurposed.

## Current dependency and port map

| Surface | Existing responsibility | P1-10 relationship |
| --- | --- | --- |
| `src/core/hash.ts`, `src/core/json.ts` | canonical inert hashing and JSON | reused for acquisition, request, page, attempt, journal, and safe-detail identities |
| `src/core/clock.ts` | deterministic clock abstraction | informs trusted clock injection; no authorization to weaken ADR 0009 clock semantics |
| `src/artifacts/artifact-store.ts` | frozen store/read/stat/observation/reconciliation port | PR 2F may call the accepted port; PR 2E may only specify integration |
| `src/artifacts/identity.ts`, `validation.ts`, `errors.ts` | sanitized request identity, safe response metadata, vault validation/errors | inherited privacy boundary; raw paths, queries, headers, and errors remain prohibited |
| `src/adapters/artifacts/durable-artifact-store.ts` | bounded private content-addressed storage | target for private provider bytes after an authorized PR 2F request |
| `src/adapters/artifacts/runtime-root.ts` | mandatory configured `PEAS_RUNTIME_ROOT` layout | all private raw market artifacts remain under this runtime root, never the repository |
| `src/adapters/artifacts/trusted-filesystem.ts`, `writer-lease.ts` | filesystem and single-writer fencing | inherited vault safety and restart boundary |
| `src/adapters/artifacts/sqlite-artifact-repository.ts` | immutable SQLite vault evidence | artifact observations and verified reads remain the raw-evidence authority |
| `migrations/005_artifact_vault.sql` | immutable attempt, outcome, blob, observation, install, incident, and reconciliation tables | installs no-delete triggers; creates no retention-deletion path |
| `src/providers/observation-ledger.ts` and ADR 0009 | closed acquisition/request/artifact/normalization/selection/failure/clock causal facts | PR 2F must preserve causal ordering and closed safe facts without changing the port |
| `src/providers/market-reference/contracts.ts` | closed provider-neutral facts, policies, reasons, bounds, and result types | accepted output boundary; read-only |
| `src/providers/market-reference/identity.ts` | provider/dataset/feed/channel/acquisition/artifact/delivery/revision/fact/selection identities | exact frozen identities and PR 2D derivations are reused; read-only |
| `src/providers/market-reference/normalization.ts` | pure deterministic recorded-fact normalization | consumes only verified, translated facts; policy is unchanged |
| `src/providers/market-reference/selection.ts` | immutable primary/corrected selection and discrepancy isolation | no live-acquisition policy may alter selection or let FMP become primary/fallback |
| `src/adapters/market-reference/recorded-market-loader.ts` | recorded-only manifest, bounded verified reads, normalization, and selection | precedent and downstream integration target; never a live transport surface |
| `src/adapters/market-reference/recorded-loader-bounds.ts` and gate evidence | operational loader bounds and offline safety evidence | precedent for exact/one-over and structured rejection evidence |
| `src/study/market-reference/**` | frozen study design and validation | out of scope for acquisition implementation and outcomes |
| memory/SQLite event and processing stores | deterministic persistence implementations | precedent for backend equivalence; not an acquisition journal port |
| recorded SEC/FMP/issuer-IR adapters | synthetic recorded loading and normalization patterns | architectural precedent only; their acquisition ownership remains P1-03 |
| market-reference tests | contract, fixture, integration, replay, persistence, and study invariants | PR 2E adds a separate acquisition contract suite without rewriting accepted tests |
| artifact, ledger, runtime-root, reconciliation, hard-kill, and persistence tests | crash, platform, cleanup, evidence, and backend precedents | reused as acceptance patterns and regression gates |

### Missing production acquisition framework

At the frozen base there is no live provider HTTP client, general HTTP transport abstraction,
retry scheduler, provider quota/rate limiter, acquisition journal, runtime provider-credential
loader, recursive hostile-value redactor, or retention-deletion service. `package.json` has only
`better-sqlite3`, `htmlparser2`, and `zod` as runtime dependencies and has no HTTP/retry/secret
library. Occurrences of HTTP URLs in current production code are inert parsing, validation, or
identity sanitization surfaces; they are not live dispatch.

This absence is deliberate. PR 2E must not fill it with production code. If authorized, PR 2F will
add a narrow, provider-specific boundary under:

```text
src/adapters/market-acquisition/**
```

No arbitrary origin, path, endpoint family, feed, timeframe, query map, account operation, or paid
capability may become runtime configuration.

## Frozen lane summary

The Alpaca primary lane consists only of the exact accepted provider, dataset, SIP feed, and three
historical multi-symbol REST endpoint-channel identities for quotes, trades, and bars. Requests are
closed to the frozen method, origin, paths, fields, exact values, UTC start/end, page limit,
`feed=sip`, `sort=asc`, and, for bars, `timeframe=1Min` and `adjustment=raw`. The trusted
`request.started` time is the authorization boundary. Equality at 15 minutes is allowed; one
nanosecond newer fails before credential loading and dispatch. There is no fallback.

The FMP lane consists only of the accepted provider, dataset, feed, and two aftermarket quote/trade
endpoint-channel identities. It is private discrepancy evidence only, never primary or fallback,
never public output, and not part of the first PR 2F transport wave. PR 2E contract-tests its
closed boundary and rejection behavior but adds no FMP client.

The canonical P1-09 document and the PR 2E entitlement/identity contract own the literal 11 IDs and
their independently recomputable preimages. This orchestration record references that authority
rather than creating a competing identity registry.

## PR 2E exclusive ownership

Only the named owner may edit a listed path. Ownership returns to the integration owner only after
an explicit handoff. No contributor may edit accepted PR 2D or P1-09 authority documents.

| Owner | Exclusive write surface |
| --- | --- |
| Baseline and architecture mapper | `docs/goals/pr-2e-p1-10-orchestration.md` |
| Entitlement and identity integrator | `docs/contracts/pr-2e-p1-10-entitlement-identity.md` |
| Acquisition-state-machine architect | `docs/contracts/pr-2e-p1-10-acquisition-state-machine.md` |
| Credential/privacy/retention architect | `docs/contracts/pr-2e-p1-10-credential-privacy-retention.md` |
| Acceptance and fault-injection analyst | `docs/contracts/pr-2e-p1-10-fixture-manifest.md`; `docs/contracts/pr-2e-p1-10-acceptance-matrix.md`; `fixtures/market-acquisition/v1/**`; `test/p1-10-contract.test.ts` |
| Integration and replay architect | `docs/contracts/pr-2e-p1-10-artifact-replay.md` |
| Fresh independent contract auditor | `docs/audit/pr-2e-p1-10-contract-review.md` only; authors none of the contract, fixture, or test package |
| Integration owner | cross-document reconciliation; `docs/project-roadmap.md`; `docs/project-board.json`; PR metadata/draft PR body |

The draft PR body is PR metadata owned by the integration owner, not a shared repository file. It
will be prepared after reconciliation and must record the base SHA, exact candidate SHA, accepted
authority chain, the ownership table above, validation evidence, unresolved risks, explicit
deferred scope, and the no-merge/no-provider-call gates.

## Prospective PR 2F exclusive ownership

These paths are a planning freeze, not implementation authorization.

| Owner | Exclusive write surface |
| --- | --- |
| Runtime/configuration and identity owner | `src/adapters/market-acquisition/contracts.ts`; `configuration.ts`; `identity.ts`; `test/p1-10-configuration.test.ts` |
| State/retry/quota/journal owner | `src/adapters/market-acquisition/state-machine.ts`; `retry.ts`; `quota.ts`; `journal.ts`; `test/p1-10-state-machine.test.ts` |
| Credential/redaction/retention owner | `src/adapters/market-acquisition/credentials.ts`; `redaction.ts`; `private-artifact-policy.ts`; separately authorized retention files; `test/p1-10-credential-privacy.test.ts`; `test/p1-10-retention.test.ts` |
| Alpaca adapter owner | `src/adapters/market-acquisition/alpaca/**`; `test/p1-10-alpaca-adapter.test.ts` |
| Artifact/ledger/restart/replay integrator | `src/adapters/market-acquisition/artifact-integration.ts`; `replay.ts`; `memory-journal.ts`; `sqlite-journal.ts`; `test/p1-10-artifact-replay.test.ts`; `test/p1-10-persistence-equivalence.test.ts` |
| Coordinator | only predeclared shared export files, roadmap/board changes, implementation orchestration record, and PR integration |
| Fresh implementation reviewer | review record only; authors none of the implementation |

Before PR 2F delegation, the coordinator must replace “predeclared shared export files” with a
literal closed path list. No FMP production file may be added in the first implementation PR.
Accepted PR 2E contract files become read-only. A discovered contract defect stops implementation
and returns to a separately reviewed contract-amendment candidate.

## Retention and deletion authorization gate

`ArtifactStore` exposes `store`, `stat`, `read`, attempt/observation lookup, observation paging, and
reconciliation. It exposes no deletion API. Migration 005 makes artifact attempts, outcomes, blobs,
install intents/transitions, observations, incidents, action plans/applications, quarantine
receipts, and reconciliation receipts immutable with explicit no-delete triggers.

P1-09 nevertheless requires bounded deletion or cessation:

- Alpaca raw artifacts, normalized facts, and private derived datasets: at most 3,650 days; affected
  raw deletion and affected normalized/derived cessation within 30 calendar days of account
  closure, owner revocation, contrary guidance, or classification loss, or an earlier provider
  deadline.
- FMP: at most 3,650 days and only while the subscription remains active; affected deletion and
  cessation no later than effective termination.

An exact auditable deletion design is therefore required, but implementing it may require a new
port, migration, reconciliation action/state, tombstone/receipt model, content garbage-collection
rule, or change to immutable vault semantics.

**Status: `HUMAN_AUTHORIZATION_REQUIRED`.**

PR 2E may document and test a proposal. It may not modify the frozen port or migration. Contract
review must explicitly state whether retention implementation is authorized. Unless the human
owner separately authorizes the exact affected surfaces and semantics, PR 2F is `NO_GO` even if
the rest of PR 2E receives contract `GO`.

## Historical-status and board-baseline drift

The current top-level roadmap correctly records P1-09 complete and P1-10 ready. Historical sections
still say P1-09 is pending, describe FMP as a pending assertion, say the entitlement gate blocks
live P1-10, or mark implementation “No.” Those passages are preserved history, not current
authority, and must be labeled as such only by the integration owner. Accepted PR 2D contract bytes
must not be changed for status cleanup.

The board's `current.codeBaselineCommit` is still the PR 2D merge
`ebe959324e48faf73c325a97ed9200bd6c76c9a6`, while the actual PR 2E base/current main is
`1061d0171b24d957214dbdeaf19d39b9f0e2fa6a`. The board marks P1-10 `ready`, P1-06 `planned`, and P2
`planned`. During this two-PR program the integration owner must update operational state to P1-10
`in-progress` and P1-06/P2 `blocked` without rewriting accepted authority or falsely claiming PR 2F
authorization.

## Contract integration and review gate

1. Integrate only the declared PR 2E files and reconcile them against the frozen authority.
2. Prove every fixture is original and synthetic; scan the Git diff and evidence for credentials,
   raw tokens, queried URLs, provider bodies/bytes, account material, and provider-derived examples.
3. Run the complete offline validation plan below with provider credential variables absent and
   network blocked/witnessed.
4. Commit the integrated package, confirm a clean worktree, record the exact candidate SHA, and
   freeze all contract, fixture, and contract-test edits.
5. Give a fresh independent auditor a clean detached worktree at exactly that SHA.
6. Require file-and-line findings, binary `GO` or `NO_GO`, exact reviewed SHA, independent
   recomputation of all 11 identities, and an explicit retention-authorization disposition.
7. Any contract, fixture, or contract-test change invalidates `GO`. Repair creates a new candidate
   SHA and requires a fresh review.
8. Do not write production transport while the decision is absent or `NO_GO`.

## Offline validation plan

Run on the exact integrated candidate:

```text
npm run verify:runtime
npm ci
npm run verify:candidate
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
npm run test:hard-kill
npm run test:coverage
npm run test:evidence-reconciliation
npm run test:mutation
npm run check
PEAS_SCALE_10K=1 npm run test:scale
git diff --check
```

The existing Linux and Windows CI jobs must pass for the same SHA. CI already binds
`PEAS_CANDIDATE_SHA`, checks out that exact SHA, runs runtime/candidate verification, installs with
`npm ci`, and runs `npm run check`. The Linux 10k job is mandatory. The audit-100k path runs only
when project release policy requires it. Existing coverage, mutation, hard-kill,
evidence-reconciliation, persistence, vault-platform, and candidate-SHA gates remain intact.

Default tests must have no provider credentials, make no provider call, add no provider secret to
GitHub Actions, and must not skip the missing-credential path. Evidence uploads must contain no
provider bytes, raw page tokens, URL queries, credentials, or provider-shaped hostile values.

## PR 2F entry gate

PR 2F may begin only when all of the following are true:

- PR 2E has an independently accepted exact candidate SHA;
- the orchestration owner has acknowledged that exact checkpoint;
- the human owner has authorized the exact retention/deletion architecture required by the
  implementation;
- the PR 2F worktree is newly isolated at the authorized integration base;
- the branch is `dev/pr-2f-p1-10-historical-sip-acquisition`;
- the accepted PR 2E SHA is copied into the PR 2F orchestration record; and
- every accepted PR 2E contract path is frozen read-only.

No provider call is authorized by this gate. A later Alpaca witness requires separate written
human approval of the exact implementation SHA, identities, routes, symbols, time range, call
ceiling, page limit, no-retry policy, account-eligibility attestation, zero spend, and execution
window. FMP transport and an FMP witness remain outside the first implementation wave.

## Stop conditions

Stop immediately and report the exact blocker on any baseline drift, dirty/shared worktree,
ambiguous authority, unfrozen identity/capability, required unauthorized port/migration/vault
change, unprovable trusted-time boundary, clock regression, incomplete pagination, unknown
cost/quota state, secret or provider-byte leakage, partial/unsettled response, unsupported schema
or correction, fallback proposal, attempted accepted-contract edit during implementation, witness
without exact-candidate approval, P2 collection, or outcome calculation.

## Draft PR 2E body plan

The integration owner will create the unmerged draft PR body after candidate freeze with these
sections:

1. contract-only outcome and explicit deferred implementation;
2. base SHA and exact candidate SHA;
3. accepted authority chain and superseded-history rule;
4. literal PR 2E ownership/file inventory;
5. frozen Alpaca and FMP lane summary with no new registry;
6. offline validation and same-SHA CI evidence;
7. retention status, including `HUMAN_AUTHORIZATION_REQUIRED` if unresolved;
8. security/privacy/zero-spend/no-network proof;
9. unresolved risks and stop conditions;
10. deferred FMP transport, provider witness, P2, event-study outcomes, financial effects, and all
    unlisted capabilities; and
11. explicit statement that neither merge nor provider access is authorized.
