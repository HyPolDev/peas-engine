# PR 2C fixture-boundary targeted audit at `9b1a32`

## Review record

- **Targeted verdict:** **NO_GO**
- **Exact reviewed SHA:** `9b1a32a5e7992c7d98ac3bde8b79b032de76168e`
- **Scope:** the recorded FMP and NVIDIA fixture loaders, their closed manifests, the
  associated fixture contract, and focused executable tests
- **Reviewer:** independent targeted review agent `/root/terra_fixture_boundary_audit`
- **Independence:** the reviewer authored none of ADR 0008/0009, the PR 2C contract, the reviewed
  implementation or tests, the general fresh-audit report, or the subsequent repairs. The reviewer
  performed a separate read-only inspection and did not participate in the final integration.

All file and line references below identify the exact reviewed SHA, not a later repair head.

## Findings

### FB-01 — Blocking: byte ceilings are enforced after unrestricted whole-file reads

FMP validates declared `sizeBytes` only as a non-negative safe integer at
`src/adapters/fmp/recorded-fmp-fixture.ts:322-324`. It then calls unrestricted `readFile` at
`src/adapters/fmp/recorded-fmp-fixture.ts:538`, compares the actual size only at lines 542-545, and
reaches the 10 MiB normalizer gate only at line 548 and
`src/providers/fmp/normalizer.ts:354-361`.

NVIDIA has the same boundary defect. Its manifest loop accepts any non-negative safe declared size
at `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:234-235`. The loader reads both members fully
and concurrently with `Promise.all` and unrestricted `readFile` at lines 392-402, checks the
declared size only at lines 395-399, and reaches the 10 MiB member/20 MiB aggregate gates only in
the normalizer at `src/providers/ir/nvidia/normalizer.ts:681-688` and 733-738.

This permits resource consumption proportional to the filesystem object rather than the frozen
loader ceilings. A mismatched declaration still forces a complete read. A matching oversized
declaration also permits hashing before the normalizer rejects the bytes. NVIDIA can allocate and
read two oversized members concurrently. The behavior contradicts the 10 MiB FMP member/aggregate
and 10/20 MiB NVIDIA member/aggregate contract in
`docs/contracts/pr-2c-fixture-manifest.md:180-201`.

Required repair:

- Reject over-limit declared member sizes, and NVIDIA's declared aggregate size, before opening any
  member.
- Open a confined regular-file handle, inspect the handle with `fstat`, reject an oversized file,
  and consume no more than the applicable maximum plus one byte. Do not use unrestricted
  whole-file `readFile` at this trust boundary.
- Bind validation and consumption to the same handle and fail closed if replacement, truncation,
  or growth prevents the declared size and fully consumed bytes from agreeing.
- Preserve the stable member-limit, bundle-limit, read-failure, and digest-mismatch distinctions.

Required executable evidence:

- Exact and one-over declared member sizes through both public loaders.
- Exact and one-over actual filesystem sizes using only generated synthetic temporary files.
- Declared/actual disagreement in both directions.
- NVIDIA aggregate exact and one-over cases.
- A controlled replacement/growth case proving validation and consumption use one handle.
- Read instrumentation proving an over-limit object is not consumed in full.
- No digest, normalization, candidate, draft, or projection work after a pre-read limit failure.

### FB-02 — Blocking: malformed NVIDIA provenance can accompany an emitted candidate

`validateManifest` verifies only the exact provenance key set at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:200-201`. Its semantic condition at lines 202-220
checks `classification` and `approvalReference`, but never validates `provenance.note`.

The otherwise valid baseline can therefore retain valid fixture bytes and expected output while
using a null, numeric, object, empty, or otherwise semantically invalid note. Provenance is not
consulted after manifest validation, so the candidate can still emit. This violates the exact,
bounded provenance contract at `docs/contracts/pr-2c-fixture-manifest.md:152-168`.

Required repair and tests:

- Require an inert string, at least one byte and at most the frozen UTF-8 byte maximum.
- Test null, number, object, empty, exact, one-over, inherited, accessor, symbol, proxy, sparse, and
  cyclic variants.
- Assert invalid provenance performs no member open/read and emits no normalization, candidate, or
  draft.
- Resolve the public-contract inconsistency: `NvidiaFixtureManifestV1` permits
  `redistribution-approved` at `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:152-156`, while the
  validator permits only `synthetic` at line 217. Either implement the contracted approval-reference
  rules or narrow the public type and fixture specification intentionally.

### FB-03 — Blocking: NVIDIA terminal `expected` semantics are not validated

NVIDIA has no equivalent of FMP's `validateExpected`. The validator checks the exact expected key
set at `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:200`, but it does not validate field types,
enums, nullability, hash grammar, timestamp-confidence iff rules, or terminal/emitted consistency.

For a terminal normalization, `expectedMatches` compares only `status`, `reasonCode`, and
`limitKind`, then returns `true` at `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:352-360`.
Consequently, a terminal manifest may carry malformed or contradictory record/revision identity,
issuer, symbol, fiscal period, source kind, publication, and semantic-hash fields without causing
the manifest gate to reject them.

Required repair and tests:

- Validate the closed status, provider-reason, and limit-kind enums.
- Freeze reason/status and reason/limit-kind compatibility.
- Require every emitted identity, route, publication, candidate, and draft field and reconcile all
  of them to the normalization result.
- Require the contracted nullability for ignored and quarantined outcomes, including all candidate
  and draft identities and hashes.
- Test every expected field independently for emitted, ignored, and quarantined outcomes, including
  missing, extra, wrong type, malformed hash, incompatible reason/limit, and timestamp-confidence
  mutations.

### FB-04 — Material: NVIDIA selector validation is incomplete and deferred until after reads

The manifest validator tests only
`manifest.selector.selectionKey.length > 2_048` at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:211`. It does not require a string, require a
non-empty value, enforce the 2,048-byte UTF-8 ceiling, or apply the frozen canonical NVIDIA
reference grammar. The real parse occurs only after both files have been read, at
`src/providers/ir/nvidia/normalizer.ts:107-125` and
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:407-411`.

This violates the exact bounded canonical selection-key requirement at
`docs/contracts/pr-2c-fixture-manifest.md:198-201` and amplifies FB-01 by allowing an invalid
selector to trigger both reads.

Required tests include non-string, empty, malformed reference, Unicode code-unit/UTF-8-byte
divergence, exact 2,048-byte canonical input, one-over, and frozen query/fragment cases. Every
manifest-level rejection must prove zero member reads.

### FB-05 — Material: NVIDIA `caseId` accepts string-coercible non-strings

The regex at `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:207` has no explicit string guard.
`RegExp.test` coerces its operand, so a numeric value such as `1` passes the case-ID grammar and may
reach an emitted transcript despite the declared string type.

Require an inert string plus the frozen portable-ASCII and byte limits. Test null, number, object,
empty, exact, one-over, non-ASCII, and punctuation cases.

### FB-06 — Material: path semantics are not consistently frozen

NVIDIA performs no explicit path type, byte-length, or portable-component validation in its member
loop at `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:224-246`. Confinement is deferred to lines
293-312. FMP requires a string of 1-512 JavaScript code units at
`src/adapters/fmp/recorded-fmp-fixture.ts:318-320`, but does not define the limit in UTF-8 bytes or
enforce a portable character/component grammar.

The reviewed confinement helpers do reject the basic absolute, traversal, backslash, and symlink
escape cases, so this audit did not establish a root escape. The gap is deterministic exact-contract
behavior across platforms and unnecessarily defers invalid-path rejection.

Required tests include POSIX and Windows separators, drive and UNC forms, traversal, empty/dot
components, reserved components, non-ASCII/code-unit-versus-byte cases, exact and one-over byte
limits, symlinks/reparse points, directories, and non-regular filesystem objects. Invalid manifest
paths must perform no body read.

### FB-07 — Decision required: observation identity and hash are syntactic declarations only

FMP checks `selectedObservationId` and `observationHash` only as 64-hex strings at
`src/adapters/fmp/recorded-fmp-fixture.ts:324-330`. NVIDIA does the same at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:231-241`, adding uniqueness only between its two
selected IDs. Neither loader recomputes those identities from a primitive preimage or verifies that
the selected observation exists in an observation ledger. Arbitrary syntactically valid
substitution can therefore survive successful body/projection verification and appear in an
emitted loader transcript.

This conflicts with the unqualified statements that each selected observation exists and full
observation evidence agrees in `docs/contracts/pr-2c-fixture-manifest.md:97-101` unless the manifest
itself is explicitly defined as already authenticated evidence.

Resolve the trust model explicitly:

- include and validate a complete primitive observation preimage and recompute its identities;
- verify the declared identity through the observation-ledger boundary; or
- document that the manifest is trusted evidence and narrow claims that the fixture loader verifies
  observation existence.

Whichever rule is selected needs tests for arbitrary valid-ID/hash substitution, duplicate and
reused IDs, wrong provider/digest/time, and backend/replay agreement.

## Test-coverage assessment

The NVIDIA loader test at `test/nvidia-ir-recorded-contract.test.ts:28-63` exercises baseline
success, one bad projection hash, and one traversal path. The later hostile-input and boundary tests
exercise the pure normalizer, not `loadRecordedNvidiaFixture`; they cannot detect malformed manifest
emission or pre-limit filesystem I/O.

FMP has materially stronger expected/provenance hostility at
`test/fmp-recorded-contract.test.ts:587-653`, but its loader-size test at lines 359-375 changes a
small declared size or invokes the pure normalizer with an in-memory oversized value. It does not
prove that the filesystem loader enforces the ceiling before reading.

The repair is not reviewable until the real loader entry points receive the required hostile
manifest and bounded-filesystem cases above.

## Environment and safety statement

The review was performed in the isolated detached worktree
`worktrees/pr2c-fresh-audit`. At review start, `git rev-parse HEAD` returned the exact reviewed SHA
and `git status --short --branch` returned only `## HEAD (no branch)`, with no modified or untracked
files. The reviewer made no writes to that worktree.

The audit used only local repository inspection and checked-in original-synthetic fixture material.
No HTTP, WebSocket, provider API, account, credential, licensed provider byte, or other network
access occurred. No generated provider-like body was persisted.

This durable report was added in the separate repair worktree. That worktree already contained
concurrent changes owned by repair agents; this reviewer did not inspect as final, modify, stage,
revert, or clean those files and owns only this new audit artifact.

## Targeted gate

**NO_GO.** FB-01, FB-02, and FB-03 are independently sufficient to reject the fixture-boundary
gate. A fresh reviewer must audit the exact repaired head and verify the required real-loader tests
before this targeted verdict can be superseded.
