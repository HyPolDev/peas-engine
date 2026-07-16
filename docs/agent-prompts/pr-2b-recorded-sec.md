# PR 2B implementation-agent prompts

- Status: Ready for implementation
- Architecture source: [`docs/adr/0007-recorded-sec-normalization.md`](../adr/0007-recorded-sec-normalization.md)
- Contract gate: complete; ADR 0007 is accepted after independent review

## Coordination rules

- Start Agents 1 and 2 from the same clean accepted-contract SHA on separate branches derived from
  `dev/pr-2b-recorded-sec-ete`.
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

This read-only review is complete. Retain the prompt as the historical review assignment.

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

Run from the accepted-contract SHA. It may overlap with Agent 2, but neither agent may edit the
other's ownership area.

```text
You own only the recorded SEC fixture contract for PEAS PR 2B.

Base SHA: <ACCEPTED_CONTRACT_SHA>
Branch: dev/pr-2b-sec-fixtures
Architecture: docs/adr/0007-recorded-sec-normalization.md

The ADR at Base SHA must have Status: Accepted. If it does not, stop without editing.

Allowed changes:
- fixtures/sec/v1/**
- test/sec-fixtures.test.ts
- fixture-specific documentation under fixtures/sec/v1/

Do not change production code, kernel code, artifact-vault code, reducer code, database code,
migrations, package dependencies, existing RC.2 fixtures/goldens, normalizer transcripts, or PR 2B
integration goldens. Do not access the network or install dependencies.

Objective:
Create the complete test-first recorded SEC fixture contract consumed by later bundle, normalizer,
reducer, and integration agents. Use minimal reviewed synthetic structures unless redistribution of
a provider body was explicitly approved per artifact.

Each fixture manifest declares:
- caseId, sourceKind, canonical accession, canonical subject CIK, and logical asOfMs;
- provider/source/record/revision identity and expected primary artifact;
- 1-16 evidence members, each with logical role, fixture-relative path, expected SHA-256 digest,
  deterministic retrieval-attempt metadata, and exactly one selectedObservationId;
- selected observation provider, digest, retrievedAtMs, and expected observation hash;
- safe response metadata and deliberately permuted presentation-order inputs;
- expected emitted, ignored, or quarantined status plus reasonCode/limitKind when applicable;
- expected issuer, period, timestamp value/confidence/original text when emitted;
- expected evidence-bundle hash for valid V2 cases; and
- whether outputHash must later be non-null or null.

Fixture-relative paths are loading instructions only. Raw URLs, query strings, credentials,
arbitrary headers, and SEC provider filenames cannot enter expected domain output or hashes.

Required fixture matrix:

A. Valid observations
- Item 2.02 8-K with exactly one submissions, filing index, primary document, EX-99.1, and XBRL
  fiscal-focus member.
- Item 2.02 8-K with two EX-99.1 exhibits; lowest positive sequence is primary and both remain
  evidence.
- 10-Q whose primary inline-XBRL document supplies fiscal focus.
- 10-K with a separate XBRL instance.
- linked periodic report with matching subject CIK and fiscal period.
- next-morning periodic filing emitted independently without retroactively changing the 8-K.

B. Membership failures
- each required role missing independently;
- duplicate singleton role and duplicate artifact digest;
- primary absent or under the wrong role;
- tied/conflicting EX-99.1 sequence;
- more than 16 members; and
- unknown SEC role.

C. Classification, identity, and linkage
- non-earnings 8-K without Item 2.02;
- padded/unpadded subject CIK and accession-prefix/subject-CIK mismatch;
- conflicting subject CIK;
- linked periodic foreign CIK and different period;
- absent and conflicting fiscal focus;
- exact redelivery, amendment accession, and conflicting same record/revision bytes.

D. Selected observation and as-of behavior
- observation exactly at asOfMs and one millisecond after;
- missing observation ID, mismatched digest, wrong provider, and reused observation ID; and
- two eligible observations for identical bytes: same expected domain identity, different loader
  transcript identity.

The manifest selects one observation per member. Do not design an observation scan or earliest-
observation rule.

E. Publication timestamps
- equivalent submissions RFC 3339 and filing-header Eastern candidates;
- RFC 3339 only, filing-header standard time, and filing-header daylight time;
- absent, conflicting, malformed, and unsupported pre-2007 local timestamps;
- filing date and retrieval time excluded from publication time; and
- linked-periodic time excluded from the preceding 8-K.

F. Decoder and markup bytes
- UTF-8 BOM, declared UTF-8, and undeclared valid UTF-8;
- declared Windows-1252 and undeclared Windows-1252 fallback;
- every accepted decoder alias from ADR 0007;
- unsupported declaration, BOM/declaration conflict, exact sniff-window boundary, and a declaration
  beginning inside but ending outside the window; and
- tolerated and quarantined malformed markup.

G. Deterministic generated boundaries
- exact/one-over member and total-bundle bytes;
- 250,000/250,001 semantic tokens;
- depth 256/257;
- 256/257 attributes per tag;
- exact/one-over extracted-text bytes; and
- the 256 KiB transcript contract without storing raw provider text.

Generate large boundary inputs in test code instead of checking in unnecessarily large bodies.

test/sec-fixtures.test.ts independently verifies:
- every path resolves inside fixtures/sec/v1 and cannot escape through traversal, absolute paths,
  links, junctions, or reparse points;
- every body digest, observation ID/hash, and valid expected bundle hash is recomputed using frozen
  identity/hash utilities;
- declared artifactHash, observation artifactDigest, and recomputed body digest agree;
- selected observations meet asOfMs unless the case intentionally expects sec.observation-invalid;
- valid role cardinalities and canonical membership satisfy ADR 0007;
- raw member permutations preserve the logical bundle;
- manifests are canonical, bounded, duplicate-free, and byte-for-byte deterministic;
- ignored/quarantined outputHash is null and emitted cases require a future non-null value without
  inventing the draft;
- no fixture or expected output contains prohibited request identity or secrets; and
- no test reaches the network.

Do not implement or mock the production normalizer. These tests validate fixture integrity and
declared contract expectations, not production parsing behavior.

Run the narrow fixture test, formatting checks for changed files, and typecheck if TypeScript
helpers are introduced.

Hand off:
- exact base SHA and branch;
- files changed and complete fixture matrix;
- checked-in/generated artifact, observation, and bundle hashes;
- commands/results and redistribution statement;
- assumptions consumed from ADR 0007 and cases deferred to parser tests; and
- confirmation that no production file, dependency, network path, or existing golden changed.

Do not commit, push, merge, or modify the integration branch without explicit user authorization.
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
