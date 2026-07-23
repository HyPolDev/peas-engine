# PR 2C independent re-audit at `175b75a`

## Review record

- **Binary verdict:** **NO_GO**
- **Exact reviewed SHA:** `175b75a33acaa8a8355c37dc630cbe0ebdc4f852`
- **Base:** `c51758a1058b86730e19185b98fcd448d9ff533a`
- **Review date:** 2026-07-19
- **Environment:** Windows, PowerShell, Node 24.17.0, npm 12.0.0
- **Reviewer:** independent review-only Terra agent `/root/terra_pr2c_final_audit`

The reviewer authored none of PR 2C, the repair at the reviewed SHA, its ADR or contract changes,
its loaders, fixture manifests, ledger implementation, test helpers, or executable tests. The
reviewer made no implementation change. This file is the reviewer's only repository write.

## Binary verdict

`NO_GO` for exact implementation
`175b75a33acaa8a8355c37dc630cbe0ebdc4f852`.

Most findings from the two independent `9b1a32` reports are repaired, but the repaired NVIDIA
loader still violates the frozen atomic metadata/body boundary. PR 2C cannot receive final `GO` or
be used as the completed readiness prerequisite for PR 2D until the finding below is repaired and a
new exact head receives fresh independent review.

## Blocking finding

### P1 - a rejected NVIDIA read-metadata gate can consume a sibling body after returning

The frozen fixture contract states that a rejected read-metadata gate consumes zero body bytes at
`docs/contracts/pr-2c-fixture-manifest.md:101-106`, and it requires counters proving this behavior at
lines 203-208. ADR 0008 likewise specifies verified metadata before both streams are fully consumed
at `docs/adr/0008-recorded-fmp-and-nvidia-ir-normalization.md:358-367`.

The implementation combines each member's `ArtifactStore.read`, metadata validation, and stream
consumption in `readBoundedNvidiaMember` at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:535-578`. The public loader starts that combined
operation for both members concurrently with `Promise.all` at lines 678-689. Therefore one member
can reject its metadata while the sibling has already passed its local metadata check and continues
consuming its stream. `Promise.all` returns on the first rejection but does not cancel or await that
sibling operation.

The reviewer reproduced this against the exact built SHA using the existing instrumented
`recordedFixtureArtifactStore`: the RSS member's returned metadata size was changed by one byte,
while the HTML member remained valid. The loader first returned:

```json
{"reason":"ir.bundle-hash-mismatch","reads":[["8f75463aaba9e1f535c82cc65c4d14f10864d199d2c87decc19cfb085e9b6c30",1],["7f77b5831efd61966acb2c1f3053fc34c3fdfd4513e125d50021fc10f9ff1e3e",1]],"streamed":[]}
```

After one event-loop delay, without any further loader call, the same counters were:

```json
{"reason":"ir.bundle-hash-mismatch","reads":[["8f75463aaba9e1f535c82cc65c4d14f10864d199d2c87decc19cfb085e9b6c30",1],["7f77b5831efd61966acb2c1f3053fc34c3fdfd4513e125d50021fc10f9ff1e3e",1]],"streamed":[["7f77b5831efd61966acb2c1f3053fc34c3fdfd4513e125d50021fc10f9ff1e3e",665]]}
```

The current tests prove zero bytes only for the individually over-limit object at
`test/nvidia-ir-recorded-contract.test.ts:215-261`; they do not inject invalid returned metadata
for either member and assert that neither sibling stream advances. The helper already exposes the
needed metadata mutation and byte counters at
`test/recorded-fixture-artifact-store.ts:34-41,92-130`.

Required repair:

1. Resolve exactly one `ArtifactStore.read` result for each raw member without consuming either
   stream.
2. Validate both returned metadata records, declared member ceilings, and the aggregate bound
   before body consumption begins.
3. If any read or metadata validation fails, destroy every acquired stream and await/settle all
   started work before returning; no sibling task may outlive the loader result.
4. Only after the complete metadata gate passes, fully consume both streams under the declared
   ceilings and recompute sizes and SHA-256 digests.
5. Add executable cases for an invalid or over-limit returned metadata record in each role. After
   an event-loop drain, assert exactly one read per member, zero streamed bytes for both members,
   no normalization/projection/candidate/draft, and the stable reason. Add the symmetric thrown-read
   cleanup case.

## Prior finding disposition

The repair materially closes the other findings from
`docs/audit/pr-2c-fresh-audit-9b1a32.md` and
`docs/audit/pr-2c-fixture-boundary-audit-9b1a32.md`:

- Derived-projection domain primaries are now independent of the selected retrieval raw link while
  the selected link is reconciled through verified and committed evidence at
  `src/providers/observation-ledger.ts:1693-1729`. NVIDIA and FMP positive, forged-link,
  provider-order, replay, and page-size evidence is at
  `test/observation-ledger-contract.test.ts:1416-1545`.
- Both loaders use the unchanged existing `ArtifactStore`; recompute observation IDs and hashes;
  validate provider, artifact digest, and as-of time; and perform exactly one observation lookup and
  read per successful raw member. The FMP implementation is at
  `src/adapters/fmp/recorded-fmp-fixture.ts:532-630,633-725`; NVIDIA is at
  `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:481-578,648-777`. Authority-forgery and call
  count tests are at `test/fmp-recorded-contract.test.ts:546-600` and
  `test/nvidia-ir-recorded-contract.test.ts:48-118`.
- Declared member and aggregate ceilings, returned metadata, complete stream consumption, and
  recomputed digests are now enforced. FMP's single-member boundary is atomic. NVIDIA's per-member
  enforcement is bounded, but its two-member orchestration remains blocked by the finding above.
- Closed NVIDIA expected fields, selector grammar, provenance classification/approval rules, member
  roles, and projection proof maps are validated before store access at
  `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:279-479`; hostile manifest cases are at
  `test/nvidia-ir-recorded-contract.test.ts:289-455`.
- Production manifests no longer contain paths or acquisition preimages. Those values exist only in
  test vault-seeding descriptors. No `ArtifactStore`, EventLog, ProcessingStore, frozen kernel port,
  or migration signature changed in `c51758a..175b75a`.
- Cross-source duplicates, corrections, arrival permutations, redelivery, replay page sizes, and
  in-memory/SQLite equivalence remain executable at
  `test/recorded-mirror-acceptance.test.ts:534-804`.

The two `9b1a32` `NO_GO` reports remain immutable historical evidence. This disposition supersedes
their assessment only for the exact repaired SHA reviewed here; it closes their individual identity,
manifest, provenance, and bounded-single-member defects but carries forward the fixture-boundary
gate as the new P1 above. It does not supersede itself when a later repair is written.

## Independent validation

The reviewer verified before writing this disposition:

- `git rev-parse HEAD` ->
  `175b75a33acaa8a8355c37dc630cbe0ebdc4f852`.
- `git rev-parse origin/main` ->
  `c51758a1058b86730e19185b98fcd448d9ff533a`.
- `git diff --check c51758a..175b75a` passed.
- `npm.cmd run clean` and `npm.cmd run build` passed.
- Focused exact-head tests passed **59/59, 0 failed, 0 skipped**:
  `fmp-recorded-contract`, `nvidia-ir-recorded-contract`, `observation-ledger-contract`,
  `recorded-mirror-acceptance`, and `fixture-provenance-closure`.
- `npm.cmd run format:check` passed for 113 files.
- `npm.cmd run lint` passed for 113 files.
- `npm.cmd run typecheck` passed.
- The focused asynchronous metadata probe above failed the frozen zero-body-read assertion and is
  independently sufficient for `NO_GO` despite the passing suites.

The central pre-commit `npm.cmd run check` evidence was also considered. It ran against the repair
content immediately before commit (evidence timestamps 14:17-14:26; commit 14:27) and reported:

- hard-kill: all three process-kill tests passed, covering all 29 declared fault boundaries;
- coverage: 269 tests, 263 passed, 6 skipped, 0 failed; 92.29% lines, 83.70% branches, 97.29%
  functions;
- evidence reconciliation: 31 passed, 1 platform skip, 0 failed;
- mutation: 39/39 killed; and
- format, lint, typecheck, and build passed.

The six coverage skips were the three process-kill tests exercised separately by the hard-kill
gate, Linux file-symlink evidence unavailable on Windows, the SQLite 10k extended scale gate, and
the SQLite 100k nightly scale gate. The evidence-reconciliation skip was the raw-evidence symlink
refusal case because Windows returned `EPERM` for symlink creation. Those skips are intentional and
do not cause this verdict. Because that evidence was produced just before the commit, its generated
hard-kill JSON identifies the then-current `c51758a` HEAD; this review treats it as supporting tree
evidence, not as the independent exact-SHA binding supplied by the commands and probe above.

## Safety and compatibility statement

The reviewed diff adds no HTTP or WebSocket implementation, provider credential access, live
network test, licensed raw fixture, subscription action, broker/order path, or financial effect.
The loaders import no network transport and the focused suites' effect-isolation checks passed.
`git diff --name-status c51758a..175b75a` contains no migration, ArtifactStore interface, EventLog,
ProcessingStore, or frozen kernel-port file. The unresolved behavior is local recorded/offline
concurrency, but it must still be repaired before `GO`.

## Gate

**NO_GO** for `175b75a33acaa8a8355c37dc630cbe0ebdc4f852`.
