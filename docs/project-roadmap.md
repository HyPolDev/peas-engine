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
  P1-07 is complete. Exact P1-08 implementation candidate
  `9dcefde1954c8426312fb082950b6105fe6847f6` received independent final `GO` in
  [`docs/audit/pr-2d-final-reaudit.md`](audit/pr-2d-final-reaudit.md).
- The preserved no-trade candidate has disposition `ADOPT_WITH_CHANGES`. It is research input for
  ADR 0010, not an executable policy; later model/trade thresholds remain outside PR 2D.
- P1-09 is complete. The owner authorization in
  [`docs/research/p1-09-owner-risk-authorization.md`](research/p1-09-owner-risk-authorization.md)
  freezes Alpaca historical REST `feed=sip` older than 15 minutes as primary, existing FMP Premium
  as a private non-fallback discrepancy source, zero incremental spend, and explicit publication
  restrictions. Fresh independent review returned `GO` for exact candidate
  `36dcf92b465fc5708614718b4312631fb5dbf544`, recorded in
  [`docs/audit/p1-09-final-go.md`](audit/p1-09-final-go.md). P1-10 is ready strictly within the
  frozen boundary; P2 remains blocked behind P1-10 and P1-06.
- P1-10 is complete. Offline repair candidate
  `d513da9b98c77f662929e2b792abca8d828841bb`, tree
  `bc067d9ea3b7cc4edb6f7647560acd14307863a8`, passed the complete unchanged local package and
  same-SHA hosted Ubuntu, Windows, 10k, 100k, and reconciliation gates in
  [run `31350658054`](https://github.com/HyPolDev/peas-engine/actions/runs/31350658054). Detached
  internal and external review returned `CONTRACT_GO`, final review returned
  `FINAL_PREMERGE_GO`, and pull request
  [`#9`](https://github.com/HyPolDev/peas-engine/pull/9) merged as
  `e1d9c1a1cab6f9c1b974fac79b9c6c6ab4af6b3a` with the reviewed tree unchanged. All rejected
  candidates and their `CONTRACT_NO_GO` decisions remain historical evidence.
- PR 2D merged as pull request
  [`#6`](https://github.com/HyPolDev/peas-engine/pull/6) at
  `ebe959324e48faf73c325a97ed9200bd6c76c9a6`. Exact published head
  `fb150828c0fe5e1272c246f1889be02aab8b0d90` passed Linux, Windows, and required 10k-scale CI in
  [run `30040906906`](https://github.com/HyPolDev/peas-engine/actions/runs/30040906906). The
  independent project-context audit returned `GO`; the initial 1k throughput failure remains
  preserved and was closed by an unchanged exact-head rerun. The merge changes no P1-09, spending,
  live-provider, P1-10, or P2 authorization.
- No live SEC HTTP, FMP, issuer-IR, calendar, market-data, LLM, brokerage, or trading adapter exists.
- The next product slice is explicitly read-only: no LLM dependency, no orders, no brokerage, and
  no portfolio mutation.

## Delivery stages

| Stage                                    | Outcome                                                                                                                                 | Exit gate                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 Foundation - complete                 | Deterministic kernel, durable artifacts, bounded ingress, replay evidence                                                               | RC.2 and PR 2A gates are satisfied                                                                                                               |
| P1 Forward read-only slice - in progress | Live SEC/FMP/IR capture, calendar prewarming, and a zero-incremental-cost delayed market-reference path                                 | A readiness drill proves complete provenance, frozen market joins, restart recovery, replay equivalence, and zero dispatchable financial effects |
| P2 Observation run                       | Exactly 180 forward earnings clusters with fixed 120 standard / 40 specialized / 20 prospective-control membership, collected across exactly 65 regular sessions | Dataset has source-level provenance and a reproducible measurement report                                                                        |
| P3 Context snapshots                     | Prospective FMP estimates, regular/aftermarket market data, sector/SPY abnormal movement, session, halt, and first-tradable-quote state | Every decision input is timestamped, versioned, and replayable                                                                                   |
| P4 Decision packets                      | Deterministic numbers first; evidence-backed language/guidance extraction second; explicit setup/no-trade classification                | Packets are reproducible, source-linked, and safe to compare in replay                                                                           |
| P5 Historical research                   | Parquet datasets, latency assumptions, executable fills, benchmark-adjusted outcomes, MFE/MAE, and cost-aware walk-forward validation   | Research runs are isolated, auditable, and do not create dispatchable work                                                                       |
| P6 Shadow and paper                      | Hypothetical intents, broker state, fills, and reconciliation without live capital                                                      | Shadow/paper invariants hold across restart, duplicate delivery, stale leases, and ambiguity                                                     |
| P7 Tiny live deployment                  | Small, separately authorized live effect path                                                                                           | A separate safety ADR, broker idempotency, pre-call durable submission, and reconciliation gates pass                                            |

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
findings. ADR 0010 is Accepted, P1-07 is complete, and P1-08 recorded/offline implementation is
complete at exact candidate `9dcefde1954c8426312fb082950b6105fe6847f6` after independent final
`GO` in `docs/audit/pr-2d-final-reaudit.md`. No new
market-data spend is authorized before the first event-validation study. Historical Alpaca REST
`feed=sip`, WebSocket `v2/delayed_sip`, and latest-endpoint `feed=delayed_sip` are separate identities
unless written provider evidence proves an exact equivalence. Existing FMP Premium is a pending
repository assertion and a separately labeled lower-evidence discrepancy candidate, not an
authorized or SIP-equivalent fallback. Paid Alpaca, FMP Ultimate, IBKR, Databento, Massive, and every
other new subscription remain deferred.

The preceding `P1-09 PENDING` descriptions are preserved historical status from PR 2D planning.
They are superseded operationally by the exact-candidate P1-09 final `GO` at
`36dcf92b465fc5708614718b4312631fb5dbf544` and closure on current baseline
`1061d0171b24d957214dbdeaf19d39b9f0e2fa6a`. They must not be treated as live authorization prose.
P1-09 completion permits the separately gated PR 2E contract-only wave. It does not authorize
transport, credentials, provider calls, a witness, retention-semantics changes, PR 2F, or merge.
An internal review recorded `GO` for PR 2E candidate
`9ec0a48266d72ce42f0a815da6ed367d91a06b7b`, but the authoritative external user-owned audit
returned `NO_GO` on its executable wall-clock proof. Repaired candidate
`5e7dba7d2dfb047f3e840e7b54127e2fc303cd66` closed that finding, but external re-review returned
`NO_GO` on one newly exposed executable ADR-0009 gap: the journal did not prove a genuine
`clk1_` clock-basis declaration and its mandatory separate direct-parent relationship on clocked
ledger facts. PR 2E is reopened only for that bounded journal repair. No retention implementation,
PR 2F work, provider witness, or merge is authorized.

That repair history is now superseded operationally. The external user-owned audit returned `GO`
for exact immutable PR 2E candidate
`038fb381963cd822d2e7f81e55d45d26f1d2c9e5`, tree
`d6fb3258c29c5b97f5cf7edab6d74c0d80386c16`. The owner separately authorized the frozen retention
architecture and an offline PR 2F wave, which is preserved and stopped at committed checkpoint
`da6bc096215ca8e4047fcac10fec3c1357589a91` plus six untracked Lane E files. PR 2E is now reopened
only for an Alpaca historical wire-grammar amendment. The owner authorized the exact narrowed
disposition: raw one-minute bars may translate when every neutral field is proven; quotes and
trades without the documented update field remain private raw-capture inputs but produce
no-record quarantine; trades with the update field terminate `correction-unsupported`; and
quotes/trades never become fallback, alter bar selection, or enter public output. PR 2F remains
stopped until this amendment receives external `CONTRACT_GO`, explicit merge authorization, and is
merged.

The first frozen amendment candidate `add3bc99862eaa2998b3dee0bbc0004b4b5f1e23`
passed complete same-SHA local and hosted gates but received external `CONTRACT_NO_GO`: valid trade
`u` did not stop later same-page item parsing, and nested hostile arrays/values could execute
getter or Proxy code before rejection. The bounded repair now requires immediate
`correction-unsupported` return before later same-symbol/later-symbol/later-page value reads,
recursive passive-Proxy-first descriptor admission, and all 8 original-synthetic hostile/atomicity
cases (10 literal runtime recipes) with exact zero-call/zero-output counters.

That repaired candidate, `1bdfe46947be842655bc630556163fc2c24f342e`, tree
`ef0c66ef079bd0cef06b014bfc2f89039d95911a`, also passed complete same-SHA local and hosted gates,
but external re-review returned `CONTRACT_NO_GO` with `SAME_MATERIAL_FINDING_RECURRENCE`. Symbol
groups still followed JSON insertion order, and the integrated chain modeled/encoded the whole
semantic page before scanning `u`. The human owner authorized exactly one bounded recurrence
repair: canonical unsigned-UTF-8 group traversal, a verified-raw-text boundary before semantic
modeling, and exhaustive direct/integrated every-prefix memory/SQLite vectors for all three update
values and placements with reversed group order plus malformed/getter-hostile/Proxy-hostile later
items/groups. Candidate `8f21b13b7d3ad837b89d715b625cc8db0dea6a1d`, tree
`956de717f36294a114193d21c540f3d648b2b4ee`, closed that wire recurrence: the independent audit
reproduced the focused `27/27`, combined `53/53`, and 27-vector / 162-run restart evidence with no
wire finding. Its immutable final decision remained `CONTRACT_NO_GO` only because the legacy
300-cluster wall-clock assertion failed two complete Windows coverage runs at `19,998 ms` and
`15,204 ms` despite isolated and hosted passes. The owner authorized one new timing-only repair:
retain the exact `15,000 ms` processing-work bound as deterministic process CPU time, expose wall
elapsed time and host-delay sensitivity as diagnostics, and regenerate complete clean-process,
same-SHA local/hosted, and external evidence. No production or accepted-contract change is
authorized. A repeated timing failure or broader authority need stops work.

That timing repair is now complete. Exact candidate
`f16ea4fcec1eda1126e9a3e446c77b76ddf15678`, tree
`f2fb2b35adb0a22265eaefc2dc6309fa2e4fb3b7`, preserved the strict `15,000 ms` processing-work
bound, passed complete same-SHA local, Ubuntu, Windows, and 10k gates, and received external
`CONTRACT_GO` plus `FINAL_PREMERGE_GO`. PR 2E was merged as
`bda45d8ef8f97c35dec614f79e5e3ca81a7bfe93`, whose tree is the reviewed candidate tree and whose
parents are the verified pre-merge `main` and reviewed PR 2E head. The owner then authorized the
preserved PR 2F checkpoint `da6bc096215ca8e4047fcac10fec3c1357589a91`, tree
`faa4d7bdaeb7c87c14b62aba9a51d9054fa1d825`, to resume offline against the merged authority. This
does not authorize provider calls, credentials or account inspection, FMP transport, spending,
P1-06, P2, outcomes, financial effects, or any contract expansion.

PR 2F is now complete and merged. Its finding-only lifecycle preserved rejected candidates
`666dcd1b99bf49599d5865561c1e9b6b5c0b0ae5`,
`9488b1f198f5f45b531f0132aa02298e225da545`,
`eb8deea372c7f115074966ea5bf80c471ceea697`,
`f3bb708dfdc8faaa025c90978c808e79fae19e43`,
`5f339fc642827e48e7f54d91b59088a921b6f7a2`, and
`ecb9929d8237df8bc81fe4df854b549b0ae6d0eb` as immutable `CONTRACT_NO_GO` history. The final exact
candidate `d513da9b98c77f662929e2b792abca8d828841bb`, tree
`bc067d9ea3b7cc4edb6f7647560acd14307863a8`, passed all unchanged local and hosted gates, detached
internal and external `CONTRACT_GO`, and `FINAL_PREMERGE_GO`. Pull request #9 merged as
`e1d9c1a1cab6f9c1b974fac79b9c6c6ab4af6b3a`; its merge tree is byte-identical to the reviewed
candidate. No provider, account, credential, spending, or financial-effect call was made during
the repair.

The repair decision is final for the reviewed bytes. It closed the credential-ordering, durable
workflow-provenance, destination/query binding, complete pagination and semantic authority,
ledger-to-artifact replay/restart coverage, absolute deadline/settlement, owned SQLite/runtime-root,
retention expiry/stop/erasure/receipt, read/reconcile/derived-lineage barriers, writer lease/fence,
quarantine last-copy, and terminal-counter findings. The evidence package includes the unchanged
local format/lint/type/build, 569-pass full test suite, coverage, hard-kill, reconciliation, 39/39
mutation gate, memory/SQLite restart/every-prefix matrices, hosted Ubuntu/Windows/10k/100k,
detached internal and external `CONTRACT_GO`, and `FINAL_PREMERGE_GO` on the merged candidate.

The accepted threat model trusts the correctly provisioned, OS-access-controlled
`PEAS_RUNTIME_ROOT` and the owned PEAS process/deployment identity. Ordinary application callers,
public APIs, structural SQLite adapters, raw handles, proxies, subclasses, and caller-authored
journals/evidence are untrusted and cannot mint production authority. An administrator capable of
replacing the complete OS-protected runtime root, executable, configuration, and all authority
state is outside this PR. Resistance to that actor would require a new contract/product decision;
it must not be added as implicit hardening.

Non-goals remain unchanged: no provider/API/market-data call, credential or account inspection,
copied provider payload, provider witness, fallback, spending, public endpoint or field, provider
role, commercial capability, hardware counter, external signing service, network authority,
financial effect, P1-03/P1-04 implementation, P1-06 execution, P2 collection/outcomes, or later
model/trading work.

### Effects-disabled 200+ event local validation gate

This is a planning gate only. It does not authorize provisioning, corpus execution, provider
access, or later implementation. The 200+ objects are local **event validation cases**, including
fault/restart/replay variants; they are not a P2 `StudyManifest`, do not change the accepted exact
180-cluster `120/40/20` study design, and produce no scientific outcome.

| Required work | Exact planning output | Acceptance before `LOCAL_TEST_GO` |
| --- | --- | --- |
| Corpus definition | A canonical manifest with at least 200 unique event-case identities, exact fixture/artifact digests and sizes, expected dispositions, calendar/session and corpus authority, deterministic order, and accepted/missing/malformed/duplicate/corrected/quarantine/terminal/expiry/erasure/stop-race coverage | 100% of frozen cases accounted for; zero substitutions, deletions, duplicate identities, or untyped missing results; no post-run manifest edit |
| Runtime provisioning | A clean OS-access-controlled `PEAS_RUNTIME_ROOT` created only through the owned first-boot path when the complete layout is absent; pinned executable SHA/tree, lockfile, Node/npm/SQLite versions, OS build, migrations, timezone/clock, runtime-root inventory, and process/deployment identity | Missing authority anchor plus any primary state is terminal corruption; no authority reconstruction from mutable primary rows; memory and SQLite roots are isolated and effects-disabled |
| Exact configuration | One hashed configuration manifest binding candidate/build, corpus, artifact, provider/entitlement, calendar/session, corpus-admission, clock and ledger authorities; request origin/path/query, page/worker limits, seed/order, retries, quotas, attempt/acquisition deadlines, retention/expiry/erasure, trusted time, backend, checkpoint schedule, and measurement commands | Runtime-observed configuration equals the frozen manifest byte-for-byte; any default, environment override, unknown field, identity drift, or authority mismatch is fatal before case execution |
| Acceptance thresholds | Freeze categorical thresholds before execution: at least 200 cases; 100% manifest coverage; zero network/provider/credential/account calls; zero broker/order/portfolio/position/fill/dispatchable/spending/financial-effect rows; zero integrity, replay, restart, cleanup, or typed-reason mismatch | Every threshold passes without waiver. Exact accepted contract maxima remain binding; the existing 15,000 ms processing-CPU scale bound is unchanged and wall time remains diagnostic only |
| Deterministic replay | Replay the complete frozen ledger/artifact set repeatedly in canonical and adversarial order/page-size permutations with full expectation tuples and exact provider/request/artifact pinning | Canonical semantic bytes, identities, reasons, counters, and evidence inventories are identical across repeated runs and memory/SQLite; terminal facts cause zero later-item access |
| Restart coverage | A matrix that restarts every represented transition class at every reachable durable checkpoint prefix, including acquisition, page commit/verification, normalization, lineage, stop, expiry, erasure, receipt revalidation, reconciliation, and quarantine recovery | Cold and warm memory/SQLite restart return the same terminal result; zero advancement from unverified checkpoints; hard-kill around credential claim, lease/fence, artifact commit, source removal, ownership, denial, erasure, and receipt commit leaves recoverable exact state |
| Integrity and reconciliation | Exact set-equality reconciliation of ledger facts, artifacts, page proofs, normalized facts, derived lineage, ownership, denials, tombstones, physical copies, erasure attempts/receipts, quarantine actions, and snapshots | Zero digest/size/provider/request/page/ledger/evidence-union mismatch; existing receipts revalidate absence and denial; unique `(digest, attemptOrdinal)` counts are exact; no stale receipt or post-stop mutation survives |
| Resource measurements | Preserve raw processing CPU and diagnostic wall time, peak RSS/heap, artifact/SQLite bytes, files/handles, workers, timers, readers, streams, leases/fences, reconciliation duration, per-case throughput, and cleanup latency | No accepted resource maximum is exceeded; exact and one-over vectors behave as contracted; zero orphan worker, timer, stream, reader, lease, fence, snapshot, or active retention operation remains |
| Final decision | Freeze the candidate SHA/tree, corpus/config digests, commands, platform/runtime inventory, raw results, reconciliation report, resource report, effects query, and independent exact-SHA review | Return exactly `LOCAL_TEST_GO` only when every preceding row passes on unchanged bytes. Otherwise preserve `LOCAL_TEST_NO_GO` with deterministic reproductions and authorize no later gate |

### Compressed parallel path to real collection

The active planning target is **16–20 engineering working days** from authorization to accepted
P1-06 readiness and `readyAtMs`. After readiness, the accepted prospective design still requires the
full S1-S15 lead. With no entitlement or review delay, first real capture is therefore expected
approximately **30–35 working days, or 6–7 calendar weeks, after authorization**. This estimate is a
parallel delivery target, not authority to waive or merge gates.

The clean milestone sequence reaches readiness on Day 17. The 16–20-day target retains bounded
allowance for exact-SHA evidence closeout, one supported finding repair, and fresh review. A larger
or recurring finding extends the schedule; it does not consume the prospective lead or relax a
contract. This documentation change does not authorize provider access, local-corpus execution,
production-runtime provisioning, real-company selection, or recording.

| Working-day window | Concurrent outcome | Required exit evidence |
| --- | --- | --- |
| Days 1–2 | Freeze the local manifest, provider/entitlement matrix, interfaces, exact configuration, test commands, and evidence format concurrently | One reviewed immutable planning package; no provider access, runtime provisioning, or corpus execution |
| Days 3–5 | Execute the complete effects-disabled local matrix while the independent reviewer pre-reviews contracts, fixtures, and evidence structure | Full final-byte replay/restart/integrity/resource/zero-effects evidence with no stale or overlapping run |
| Day 6 | Perform detached exact-SHA review | Exact unchanged-byte `LOCAL_TEST_GO`, or preserved `LOCAL_TEST_NO_GO` and finding-only repair |
| Days 7–11 | Run parallel SEC, FMP, generic issuer-IR, and universe/calendar implementation lanes under separately frozen authority | Owned read-only adapters, exact provenance, recorded contract tests, calendar/session authority, and no financial effects |
| Days 12–14 | Integrate and run memory/SQLite replay, every-prefix restart, correction, reconciliation, resource, and zero-effects gates | One clean exact candidate with complete final-byte evidence and deterministic recovery |
| Days 15–17 | Run the P1-06 sustained readiness drill and independent readiness review | P1-06 readiness `GO`; its accepted publication time establishes `readyAtMs` |
| From `readyAtMs` | Derive S1; capture the candidate frame through S5; publish the immutable manifest before S6; rehearse operations during S6–S14; begin real collection at S15 | Exact prospective frame and immutable 180-cluster manifest before outcomes; no substitution after freeze |

The complete recording remains exactly **180 clusters** with fixed **120 standard / 40 specialized /
20 prospective-control** membership, collected across exactly **65 regular sessions**. The 200+
local event cases remain effects-disabled software-validation cases; they are not members of the
scientific sample and cannot change its numerator, denominator, selection, or timing.

### Preserved provider architecture

- FMP earnings calendar is the broad candidate-discovery source, subject to separately frozen exact
  dataset, endpoint, entitlement, retention, and use authority.
- SEC submissions provide regulatory release confirmation with exact CIK, filing, artifact, and
  retrieval provenance.
- One configuration-driven generic issuer-IR source family handles issuer-owned sources. The
  recorded NVIDIA RSS/IR fixture is the first supported pattern; this does not authorize or require
  one bespoke adapter per issuer.
- Alpaca historical REST `feed=sip` with an end time older than 15 minutes remains the existing
  primary market source under the accepted entitlement boundary.
- FMP market data remains the approved private non-fallback discrepancy source and never fills
  missing primary evidence.
- No new commercial provider may be added unless a frozen coverage rehearsal proves the current
  sources cannot fill the exact 120/40/20 prospective frame. Any addition requires a separate
  pre-outcome contract, entitlement, retention, cost, provenance, and independent review.

### Planned automation workstream

Automation is **planning only and requires separately authorized implementation**. Its bounded
scope is:

- one-command local-validation and P1-06 readiness gates;
- deterministic manifest and exact-configuration compilation;
- provider-adapter scaffolding and contract-test generation;
- a configuration-driven issuer-source registry;
- generated every-prefix restart and fault matrices;
- automatic reconciliation and resource measurement;
- exact-SHA evidence packaging and local/origin/PR/CI identity verification;
- gate-state tracking that prevents overlapping, stale, or wrong-byte runs;
- candidate-frame preflight and deterministic exact 180-cluster selection; and
- continuous zero-network and zero-financial-effects assertions.

These automations may reduce a clean, finding-free engineering cycle to approximately **13–16
working days**. They cannot weaken or self-authorize a gate, shorten the mandatory S1-S15
prospective lead, or shorten the exactly 65-regular-session recording window. This documentation
change implements none of them.

The next decision is therefore to approve or reject that exact local-validation manifest. Only a
clean `LOCAL_TEST_GO` may unblock the separately frozen P1-03/P1-04 source-capture and calendar
work. Those tasks still require their own implementation, restart, provenance, and independent
acceptance evidence. Only after P1-03 and P1-04 are independently complete may a separately
authorized P1-06 readiness drill begin. P2 remains blocked until P1-06 receives an independent
readiness `GO`.

### Post-PR 2D next actions

PR 2D, P1-09, and P1-10 are complete and merged. The active critical path is the effects-disabled
local gate -> P1-03/P1-04 -> P1-06 readiness and `readyAtMs` -> mandatory S1-S15 prospective lead ->
P2 collection. Parallel implementation does not waive a gate.

| Order | Work item                                                      | Owner                                             | May start now                                                                                      | Required output and exit condition                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Close the P1-09 evidence package                               | Human owner                                       | Complete                                                                                           | Sanitized owner attestation, private Alpaca/FMP responses represented by opaque digest, explicit source/fallback decision, and zero-spend confirmation are recorded                                                                               |
| 2     | Independently audit the frozen P1-09 authorization             | Integration owner plus fresh independent reviewer | Complete                                                                                           | Exact candidate `36dcf92b...` received `GO`; P1-09 is complete                                                                                                                                                                                    |
| 3     | Prepare PR 2E, the P1-10 contract package                      | Agents with non-overlapping ownership             | Complete and merged at `bda45d8e...`                                                               | Exact candidate `f16ea4f...`, tree `f2fb2b35...`, passed complete local/hosted gates, external `CONTRACT_GO`, and `FINAL_PREMERGE_GO`; accepted contract and audit bytes are immutable in PR 2F                                                   |
| 4     | Resolve the retention architecture authorization gate          | Human owner                                       | Complete for the exact frozen architecture                                                         | Preserve the owner-authorized maintenance port, additive migration, controlled vault-root erasure, tombstone/use-denial semantics, and exact retention sequence; no scope expansion                                                               |
| 5     | Implement PR 2F against merged PR 2E                           | Current sole PR 2F implementation owner           | Complete and merged as PR #9 at `e1d9c1a...`                                                        | Exact candidate `d513da9...`, tree `bc067d9...`, passed unchanged local and hosted gates, internal/external `CONTRACT_GO`, and `FINAL_PREMERGE_GO`; reviewed bytes merged unchanged                                                             |
| 6     | Freeze and execute the effects-disabled 200+ event local gate  | Integration owner plus fresh auditor              | Planning may complete; execution is blocked pending approval of the exact corpus/runtime/configuration manifest       | At least 200 frozen local cases; exact replay/restart/integrity/resource/effects evidence; independent `LOCAL_TEST_GO`; no provider call or scientific outcome                                                                                    |
| 7     | Complete live read-only source capture and calendar prewarming | Non-overlapping source and calendar owners        | Blocked pending `LOCAL_TEST_GO` and a separately frozen human authorization for exact P1-03/P1-04   | Bounded SEC/FMP/issuer-IR capture as authorized, issuer allowlist, schedule provenance, restart/backfill evidence, independent acceptance, and no dispatchable financial effects                                                               |
| 8     | Run P1-06 integrated readiness drill                           | Integration owner plus fresh auditor              | After P1-03, P1-04, P1-05, and P1-10 are independently complete                                    | Same-SHA Linux/Windows and 10k evidence; complete synthetic matrix; retention enforcement; restart/replay and memory/SQLite equivalence; binary readiness `GO`                                                                                    |
| 9     | Collect and freeze P2                                          | Collection agents, then research owner            | After P1-06 independent `GO`, derive S1, freeze the frame through S5, publish before S6, rehearse S6-S14, and begin collection at S15 | Exactly 180 prospectively frozen clusters with fixed 120/40/20 membership across exactly 65 regular sessions; immutable dataset manifest, code/config/entitlement identities, and completeness report before conclusions |
| 10    | Execute the event-validation analysis                          | Research owner plus independent reviewer          | Blocked until the dataset freeze                                                                   | Reproducible frozen-metric report and binary decision on whether the evidence justifies any later data, model, or market-access investment                                                                                                        |

Immediate agent-safe preparation in item 3 must remain a separate recorded/offline change. It may
define interfaces around the frozen Alpaca historical REST `feed=sip` boundary, but it must not add
a live transport before independent P1-09 `GO`, read environment credentials, capture provider
examples, select `delayed_sip`, or encode an FMP fallback. If review changes the provider/source
identity or scientific meaning, repair and re-audit the preparation package before live
implementation.

PR 2E candidate `5e7dba7d2dfb047f3e840e7b54127e2fc303cd66` had green offline and same-SHA
Linux, Windows, and 10k gates. External re-review confirmed the earlier wall-clock P0 closed and
returned `NO_GO` on the executable journal's missing genuine ADR-0009 clock-basis identity and
mandatory direct parent. The next action is to freeze and fully validate only that bounded journal
repair and return its exact SHA to the same external audit task. Separately, the current
ArtifactStore has no deletion API and migration 005 installs no-delete triggers. Retention
implementation remains `HUMAN_AUTHORIZATION_REQUIRED / NOT_AUTHORIZED`; PR 2F may not begin without
both external contract `GO` and separate human authorization of the exact retention architecture.

That paragraph is preserved audit history. Candidate `038fb381963cd822d2e7f81e55d45d26f1d2c9e5`
closed the ADR-0009 finding and received external `GO`; the owner then authorized the exact
retention architecture. The active next action is now the narrowed PR 2E wire amendment and its
same-SHA external review. Phase B remains stopped for this amendment even though the earlier
retention gate was resolved.

That active-action sentence is retained as audit history and is now superseded by the accepted
timing repair, verified PR 2E merge `bda45d8ef8f97c35dec614f79e5e3ca81a7bfe93`, and the owner's
explicit authorization to resume the preserved PR 2F checkpoint under the unchanged offline gates.

### Scheduling and critical-path judgment

The compressed day windows above supersede the former sequential work-session estimate. Treat each
day as an evidence-producing delivery box, not an unconditional promise. Human/provider response
time, a supported finding and repair cycle, unavailable independent review, or a failed entitlement
or coverage gate extends the schedule rather than permitting a waiver. Parallel owners must retain
non-overlapping file and decision authority, while the integration owner alone freezes candidate
bytes and final evidence.

The nominal **16–20 working days to P1-06 readiness and `readyAtMs`** can compress to **13–16 working
days** only after the separately authorized automation workstream exists and a clean cycle produces
no supported finding. Neither estimate includes or shortens the required S1-S15 lead or the exactly
65-regular-session observation window.

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

In parallel, freeze the exact 180-cluster universe, sampling strata, prospective controls,
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

### Step 3 - recorded market-reference implementation gate: complete

Exact candidate `9dcefde1954c8426312fb082950b6105fe6847f6` received independent final `GO`
in `docs/audit/pr-2d-final-reaudit.md`. Project-authored synthetic quote, trade, bar, session,
correction, malformed-input, and exact/one-over fixtures execute all 64 cases and 84 bounds.
Recorded selection is deterministic across order, restart, replay page size, memory/SQLite, and
durable ArtifactStore reopen. The implementation has no provider call, credential access, paid
activation, broker/order surface, or financial effect.

### Step 4 - build live source capture and delayed market acquisition only after their gates

The earlier PR 2E `NO_GO` and retention-pending status is preserved above as audit history.
Candidate `038fb381963cd822d2e7f81e55d45d26f1d2c9e5` subsequently received external contract `GO`,
and the owner authorized the exact retention architecture. The current gate is the separately
authorized sole recurring-P0 repair of the narrowed wire amendment: it requires a clean exact
candidate, same-SHA offline and hosted evidence, exactly one complete external re-review,
`CONTRACT_GO`, explicit merge authorization, and merge. Any recurrence or new material authority
need stops work without another repair. PR 2F remains stopped at
`da6bc096215ca8e4047fcac10fec3c1357589a91` plus its six untracked Lane E files until those amendment
gates close and the owner renews Phase B direction.

Only then may implementation resume for the approved delayed historical provider/dataset/feed
behind the accepted recorded contract:

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

P2 remains blocked until P1-09, P1-10, and P1-06 are complete. Then collect exactly 180 forward earnings
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
