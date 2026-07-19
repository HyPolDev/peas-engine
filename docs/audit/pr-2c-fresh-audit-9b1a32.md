# PR 2C fresh independent audit at 9b1a32

- Status: `NO_GO`
- Review date: 2026-07-19
- Base: `41f19b83e104857ed32b45fa5838c8199f5467ab`
- Reviewed implementation: `9b1a32a5e7992c7d98ac3bde8b79b032de76168e`
- Documentation-only head: `f4d07bc62be7669caae12c577abb0e8c524497c2`
- Merge commit: `73b4d0b5f85f04f66315bdb6b43edd187381e600`
- Environment: Windows, PowerShell, Node 24.17.0, npm 12.0.0

## Reviewer independence

The fresh read-only reviewer authored none of PR 2C, its ADRs, contracts, fixtures, tests,
implementation, repairs, integration, merge preparation, or prior reviews. The detached audit
worktree remained clean. This review does not rely on the earlier unauthenticated claim of a final
`GO`.

## Binary verdict

`NO_GO` for implementation `9b1a32a5e7992c7d98ac3bde8b79b032de76168e`.

The earlier repository claim of a final `GO` is superseded. PR 2C may not be marked accepted or
complete for PR 2D readiness until the findings below are repaired and a new exact head receives a
fresh independent review.

## Blocking findings

### P1 - retrieval selection rejects contracted derived projections

ADR 0009 requires FMP and NVIDIA normalization to use a `derived-projection` primary equal to the
semantic projection digest while keeping raw digests out of domain identity. A retrieval basis
separately identifies one verified raw link.

`src/providers/observation-ledger.ts:1696-1702` instead locates the trusted retrieval link only when
the raw link artifact digest equals `normalization.primaryArtifactHash`. That can hold for a
`raw-artifact` primary but cannot hold for the contracted FMP/NVIDIA derived projection.

Existing tests conceal the mismatch: the NVIDIA-shaped ledger factory at
`test/observation-ledger-contract.test.ts:210-211` models the primary as a raw artifact, and the
market-reference selection case at lines 1217-1286 covers capture basis only.

The reviewer reproduced the failure by using the contracted `derived-projection` primary and a
schema-valid retrieval basis over its verified raw link. Validation rejected it with
`observation.parent-transition-invalid`.

Required repair:

- decouple trusted retrieval raw-link selection from semantic primary kind/hash;
- match the typed basis to exactly one normalization raw link;
- reconcile that link through its committed and verified acquisition evidence, time, and clock;
- add FMP and NVIDIA positive retrieval cases using derived projections;
- add forged link/digest/observation hostile cases; and
- cover market joins, replay remapping, page size, and backend behavior without changing frozen
  ports or domain primary semantics.

### P1 - recorded loaders allocate whole files before applying ceilings

FMP performs an unbounded `readFile` at
`src/adapters/fmp/recorded-fmp-fixture.ts:536-545`. Its manifest validator accepts any nonnegative
safe declared `sizeBytes` without rejecting values above the 10 MiB contract before I/O.

NVIDIA performs an unbounded `readFile` at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:392-400`. Its validator does not preflight the
10 MiB per-member and 20 MiB aggregate ceilings before I/O.

Normalizer checks occur only after full file allocation, so the loader boundary itself is not
bounded.

Required repair:

- reject declared per-member or aggregate sizes above the contract before reading;
- safely stat and reconcile the actual file size;
- use a bounded read that cannot allocate beyond the permitted maximum;
- preserve complete-consumption and digest verification; and
- add real loader exact/one-over tests for the FMP member, each NVIDIA member, and NVIDIA aggregate.

### P2 - malformed NVIDIA provenance can emit

The contract requires `provenance.note` to be a string. The validator checks the exact provenance
keys but does not validate the note type, non-emptiness, or bound. A cloned baseline manifest with
`provenance.note = 1` emitted successfully instead of rejecting before body reads.

Required repair:

- validate every selector, member, expected-output, and provenance field for exact runtime type,
  enum/nullability, and UTF-8 bound before reading bodies;
- add hostile exact-object cases proving malformed manifests cannot emit; and
- inspect the FMP manifest for symmetric field-validation gaps.

## Historical finding disposition

The earlier matrix findings for primitive/container closure, clocks, projection proof roles, FMP
timestamps, NVIDIA projection ceilings, FMP proof policy, NVIDIA normalizer member bounds, Unicode
whitespace, provider input proxies, identity, correction handling, and raw-link reconciliation are
closed at the reviewed head where exercised.

Historical finding 7 is reopened by the loader and manifest-boundary findings. Historical finding
11 is reopened by the missing derived-projection retrieval path. All historical findings remain
evidence and must not be deleted or rewritten.

## Other reviewed areas

No additional blocker was found in FMP/NVIDIA semantic identity and raw-byte isolation,
correction/duplicate handling, projection proof recomputation, clock-basis regression/remapping,
provider-revision conflicts, raw-link committed/verified reconciliation, recorded mirror
acceptance structure, network/effect isolation, or frozen EventLog, ProcessingStore, ArtifactStore,
and migration signatures.

## History verification

- `git diff --name-status 9b1a32..f4d07bc` changes only the project board and roadmap.
- `f4d07bc^{tree}` and `73b4d0b^{tree}` both resolve to
  `913bdcdbb5186dca9667e3b4e7a6f01f74dc1e6e`.
- The documentation head is therefore documentation-only and the merge commit is tree-equivalent
  to the PR tip.

## Validation evidence

- `npm.cmd run verify:runtime` passed.
- In an exact-SHA archive using the locked PR 2C dependencies: runtime verification, the 29-item
  fault-boundary inventory, formatting of 109 files, lint of 109 files, and typecheck passed.
- Full `npm.cmd run check` could not complete in the archive because the hard-kill test requires a
  Git worktree. The detached audit worktree was intentionally not modified to install dependencies.
- The focused derived-projection retrieval probe failed with
  `observation.parent-transition-invalid`.
- The focused malformed NVIDIA provenance probe emitted when it should have rejected.

The incomplete full-suite run is an audit-environment limitation, not a waiver. The repaired head
must pass the complete repository gate in a real worktree before fresh review.

## Supersession

This `NO_GO` supersedes the prior claimed `GO` for `9b1a32a`. It does not supersede itself when a
repair is written. A later final disposition must identify the repaired head, close each finding
with exact file/test evidence, report full validation, and obtain a fresh independent binary
verdict.
