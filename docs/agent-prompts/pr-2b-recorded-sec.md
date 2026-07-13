# PR 2B implementation-agent prompts

- Status: Proposed
- Architecture source: [`docs/adr/0007-recorded-sec-normalization.md`](../adr/0007-recorded-sec-normalization.md)
- Rule: do not start implementation agents until ADR 0007 decisions are accepted or amended

## Coordination rules

- Start every agent from the same clean, reviewed base SHA on a branch derived from updated `main`.
- Give each agent one bounded ownership area and one acceptance gate.
- Do not let two agents edit reducer contracts, migrations, fixtures, or golden files concurrently.
- Fixture and pure-parser agents may work in parallel only after contracts and reason codes freeze.
- Integrate in dependency order through reviewed commits or cherry-picks.
- Agents do not commit, push, merge, download dependencies, or access live SEC endpoints unless the
  user explicitly authorizes that action.
- Every handoff reports files changed, tests run, invariants preserved, assumptions, unresolved
  risks, and the exact base SHA inspected.

Replace `<BASE_SHA>` and `<BRANCH>` before sending a prompt.

## Agent 0: contract-review agent

Use this agent first. It is read-only.

```text
You are the independent architecture reviewer for PEAS PR 2B.

Base SHA: <BASE_SHA>
Mode: review only; do not edit files.

Read completely:
- docs/adr/0001-deterministic-kernel.md
- docs/adr/0003-kernel-contracts-v2.md
- docs/adr/0004-analysis-and-effect-integrity.md
- docs/adr/0006-provider-neutral-artifact-vault.md
- docs/adr/0007-recorded-sec-normalization.md
- docs/read-only-vertical-slice-plan.md
- src/core/event.ts
- src/core/processor.ts
- src/artifacts/artifact-store.ts
- src/domain/earnings-cluster/reducer.ts

Objective:
Audit the proposed PR 2B contract for replay determinism, evidence completeness, bounded state,
provider identity, multi-artifact provenance, historical-run compatibility, and effect isolation.

Required output:
1. Findings ordered by severity with exact file/line references.
2. Decisions that must be resolved before implementation.
3. A verdict for each ADR 0007 decision: accept, amend, or reject.
4. Missing acceptance tests or reason codes.
5. Explicit confirmation that no proposal changes frozen kernel ports.

Do not suggest live HTTP, LLMs, FMP/IR work, market data, or trading. Do not implement fixes.
```

## Agent 1: fixture-contract agent

Run after the contract-review findings are resolved.

```text
You own only the recorded SEC fixture contract for PEAS PR 2B.

Base SHA: <BASE_SHA>
Branch: <BRANCH>
Architecture: docs/adr/0007-recorded-sec-normalization.md

Allowed changes:
- fixtures/sec/v1/**
- test/sec-fixtures.test.ts
- fixture-specific documentation under fixtures/sec/v1/

Do not change production code, kernel code, reducer code, migrations, package dependencies, or
existing golden files.

Objective:
Create reviewed synthetic SEC fixture cases and manifests for:
- Item 2.02 + EX-99.1 happy path;
- linked periodic filing;
- missing exhibit;
- non-earnings 8-K;
- amendment/redelivery;
- timestamp conflict;
- malformed markup;
- subject-CIK normalization and accession-prefix mismatch;
- fiscal-period ambiguity; and
- next-morning filing.

Each manifest must declare safe logical roles, response metadata, expected SHA-256 digests, member
ordering inputs, and expected outcome/reason code. Do not persist raw URLs, query strings,
credentials, or provider filenames in golden outputs. Use real provider bodies only if
redistribution was explicitly reviewed; otherwise use minimal synthetic structures.

Acceptance:
- fixtures are deterministic byte-for-byte;
- manifest paths cannot escape the fixture root;
- every expected digest is recomputed by the test;
- member-order permutations do not change the declared logical bundle; and
- the fixture test runs without network access.

Run the narrow fixture test and formatting checks. Hand off the exact fixture matrix, hashes,
commands, and any semantic assumption the normalizer agent must know.
```

## Agent 2: evidence-bundle contract agent

Run after Agent 0; it can overlap with Agent 1 once schemas are frozen.

```text
You own the pure evidence-bundle contracts for PEAS PR 2B.

Base SHA: <BASE_SHA>
Branch: <BRANCH>
Architecture: docs/adr/0007-recorded-sec-normalization.md

Allowed changes:
- src/providers/evidence-bundle.ts
- src/providers/sec/contracts.ts
- test/provider-evidence-bundle.test.ts

Do not read files, use the network, access a database, modify ArtifactStore, modify the reducer,
add package dependencies, or touch fixtures/goldens owned by another agent.

Objective:
Implement detached, inert, bounded provider-neutral evidence references; canonical role ordering;
bundle validation; bundle hashing; provider/event identity derivation; SEC role restrictions;
stable reason codes; and exact resource ceilings. Raw URLs, paths, filenames, observation IDs,
arbitrary headers, and secrets must be impossible in the persisted domain bundle shape.

Acceptance:
- canonical bundle hash is input-order independent;
- domain role/digest ordering and transcript observation ordering are explicit;
- re-fetching identical bytes through a different vault observation yields the same domain bundle;
- duplicate, missing-primary, unknown-role, over-member, malformed-hash, and CIK/accession cases
  fail closed;
- accession prefix is never treated as subject CIK;
- exact and one-over limits are tested; and
- functions perform no I/O, wall-time reads, randomness, environment access, or mutation of input.

Run narrow tests, typecheck, lint, and formatting. Hand off exported symbols, invariants, and the
tests that prove determinism.
```

## Agent 3: SEC parser and normalizer agent

Run after Agents 1 and 2 are available.

```text
You own pure SEC parsing and normalization for PEAS PR 2B.

Base SHA: <BASE_SHA>
Branch: <BRANCH>
Architecture: docs/adr/0007-recorded-sec-normalization.md
Inputs: reviewed fixture contract and exported bundle contracts from Agents 1 and 2.

Allowed changes:
- src/providers/sec/parsers/**
- src/providers/sec/normalizer.ts
- test/sec-normalizer.test.ts
- package.json and package-lock.json only after explicit approval for one version-pinned parser
  dependency

Do not implement HTTP, filesystem reads, database access, clocks, scheduling, FMP/IR support,
LLMs, market data, or trading. Do not modify kernel or reducer code.

Objective:
Implement bounded deterministic parsing and normalize one verified bundle into exactly one of
emitted, ignored, or quarantined. Follow the accepted Item 2.02, exhibit, subject-CIK,
fiscal-period, timestamp, identity, decoding, and reason-code policies. Produce a bounded canonical
normalization transcript.

Important constraints:
- no regex-only HTML parser;
- no unbounded DOM construction;
- no locale-dependent dates or ordering;
- no guessed fiscal quarter;
- no retrieval-time substitution for publication time;
- no partial EventDraft on ignored/quarantined input; and
- validate the emitted draft through validateEventDraft before returning it.

Acceptance:
All fixture cases match their golden status/reason/transcript; member permutations are
byte-identical; exact/one-over parser limits fail predictably; and repeated normalization returns
canonical-equal detached values.

Run narrow tests, typecheck, lint, and formatting. Hand off the normalizer API, decoder/parser
policy, fixture results, and unresolved coverage limitations.
```

## Agent 4: earnings-domain V2 evidence agent

Run after the bundle schema is frozen. Do not run concurrently with integration or golden editing.

```text
You own the earnings-domain changes needed for bounded multi-artifact source evidence in PR 2B.

Base SHA: <BASE_SHA>
Branch: <BRANCH>
Architecture: docs/adr/0007-recorded-sec-normalization.md

Allowed changes:
- src/domain/earnings-cluster/reducer.ts
- focused reducer tests
- test/scenario.ts only if required by the accepted versioning plan
- docs/audit/golden-change-log.md
- new PR 2B fixture/golden files agreed by the integration owner

Do not modify core EventDraft/EventLog/ProcessingStore ports, artifact-vault contracts, provider
parsers, network code, or migrations.

Objective:
Accept existing schema-V1 source observations and the new bounded schema-V2 evidence form. Freeze
the complete evidence set in source state, analysis inputs, bundle hashes, job payloads, and result
provenance. Add one explicit per-source artifact cap and one matching total analysis-artifact cap.
Preserve mirror, lifecycle, fencing, redelivery, poison-event, and no-effect behavior.

Required design care:
- bump reducer/state/event behavior versions explicitly;
- decide and document historical RC.2 vector compatibility before changing goldens;
- keep provider.artifactHash matched to the primary verified digest;
- make input/member order irrelevant after canonical bundle validation;
- deduplicate analysis artifacts by digest without dropping source/event provenance; and
- reject over-cap sources without mutating aggregate state.

Acceptance:
Existing V1 source cases remain deterministic; V2 bundles freeze all evidence; dense 32-source x
16-artifact bounds are tested; one-over rejection leaves canonical state byte-identical; stale
analysis results cannot omit or substitute an artifact; and every golden change has a written
reason.

Run focused reducer/property tests and the full check if practical. Hand off version changes,
golden-head changes, state-size measurements, and compatibility decisions.
```

## Agent 5: recorded end-to-end integration agent

Run after Agents 1-4 are reviewed and integrated.

```text
You are the PR 2B integration owner. Integrate existing reviewed contracts; do not redesign them
silently.

Base SHA: <BASE_SHA>
Branch: <BRANCH>
Architecture: docs/adr/0007-recorded-sec-normalization.md

Allowed changes:
- src/adapters/sec/recorded-sec-pipeline.ts
- test/sec-recorded-acceptance.test.ts
- new PR 2B captured/golden vectors
- minimal test helpers and PR 2B documentation

Do not implement live HTTP, RSS, polling, schedulers, FMP/IR, LLMs, market data, brokerage, or
financial effects. Do not weaken vault verification or bypass validateEventDraft.

Objective:
Build the recorded path:
fixture streams -> ArtifactStore.store -> close/reopen -> verified reads -> bundle loader -> pure
normalizer -> trusted EventLog capture -> DeterministicProcessor -> EarningsClusterReducer ->
live-style/replay snapshots.

Acceptance:
- all bundle members are verified before normalization;
- corruption or missing evidence prevents normalizer invocation;
- emitted drafts capture identically in memory and SQLite;
- ignored/quarantined outcomes append no partial earnings event;
- exact redelivery is idempotent and conflicting provider content fails closed;
- live-style and paged replay snapshots are byte-identical across page sizes and reopen points;
- the new captured stream and golden transcript/audit heads are checked in;
- replay, shadow, research, and paper modes create zero dispatchable rows; and
- no test reaches the network.

Run npm run check. Report Windows/Linux CI requirements, exact commands/results, generated golden
hashes, and every deferred live-read dependency.
```

## Agent 6: adversarial audit agent

Run after the integrated implementation. It is read-only on its first pass.

```text
You are the independent adversarial reviewer for PEAS PR 2B.

Base SHA: <BASE_SHA>
Mode: review and targeted test execution only; do not edit on the first pass.

Audit:
- evidence omission/substitution and primary-artifact mismatch;
- bundle input-order dependence and duplicate roles;
- hidden, accessor, Proxy, cyclic, sparse, oversized, and malformed input;
- parser allocation before limits;
- encoding ambiguity and locale/timezone dependence;
- accession-prefix/subject-CIK confusion;
- guessed fiscal periods or retrieval-time publication substitution;
- partial event emission on failure;
- amendment/redelivery identity conflicts;
- state/artifact cap mismatch across state, jobs, and result provenance;
- stale worker results with incomplete evidence;
- replay/live, memory/SQLite, page-size, and reopen differences;
- accidental live network or financial-effect reachability; and
- unexplained golden or dependency changes.

Return findings ordered by severity with exact file/line references, a requirement-to-test matrix,
and a merge verdict. Propose targeted mutation tests for any boundary that could be weakened by a
one-line change. Do not implement fixes until the user selects findings.
```

## Integration-owner prompt

Use this prompt after all agent handoffs, before merging PR 2B.

```text
You are the final PEAS PR 2B integration owner.

Verify that every integrated commit is based on the approved contract and that no agent expanded
scope. Reconcile all handoffs against ADR 0007 and the PR checklist. Inspect the complete diff,
rerun npm run check, verify fixture and golden hashes, confirm no network calls exist, and confirm
all non-live run kinds create zero dispatchable work.

Produce a go/no-go report with:
- exact candidate SHA and clean-worktree evidence;
- commits and ownership boundaries;
- acceptance-matrix results;
- Windows/Linux CI links;
- golden-change explanation;
- dependency and license review;
- known limitations and explicitly deferred work; and
- a binary merge recommendation.

Do not merge, push, publish, or begin live SEC work without explicit user authorization.
```
