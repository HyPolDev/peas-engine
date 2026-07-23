# PR 2C independent re-audit at `43ba575`

## Review record

- **Binary verdict:** **NO_GO**
- **Exact reviewed SHA:** `43ba57539f76d01658a7fe21b06187c724c941ce`
- **Base:** `c51758a1058b86730e19185b98fcd448d9ff533a`
- **Review date:** 2026-07-19
- **Environment:** Windows, PowerShell, Node 24.17.0, npm 12.0.0
- **Reviewer:** independent review-only Luna agent `/root/luna_pr2c_final_go`

The reviewer authored none of PR 2C, either repair commit, ADR 0008/0009, the fixture and
observation-ledger contracts, the loaders, manifests, test helper, or executable tests. The review
began with a clean worktree at the exact reviewed SHA. The reviewer made no implementation change;
this audit record is the reviewer's only repository write.

## Binary verdict

`NO_GO` for exact implementation
`43ba57539f76d01658a7fe21b06187c724c941ce`.

The repair correctly separates NVIDIA read acquisition/metadata validation from body consumption,
but its cancellation helper reports settlement after one event-loop turn even when a conforming
Node `Readable` is still completing asynchronous destruction. The loader can therefore return while
an acquired stream remains live and later emits lifecycle activity. PR 2C cannot receive final
`GO` or satisfy the PR 2D readiness prerequisite until this finding is repaired and a new exact
head receives fresh independent review.

## Blocking finding

### P1 - the NVIDIA cancellation barrier can complete before stream destruction settles

The frozen fixture contract requires a multi-member acquisition/metadata failure to destroy every
acquired stream and cross a cancellation-settlement barrier before return, with no sibling stream
surviving the return or emitting later activity at
`docs/contracts/pr-2c-fixture-manifest.md:101-110`. ADR 0008 freezes the same behavior at
`docs/adr/0008-recorded-fmp-and-nvidia-ir-normalization.md:357-371`.

At the exact reviewed SHA, `settleDestroyedStream` installs `close`, `end`, and `error` listeners at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:540-557`, but then schedules
`setImmediate(complete)` at line 558. `complete` resolves the cancellation promise at lines 545-552
whether or not the stream's `_destroy` callback has completed and whether or not `close` has
occurred. `cancelAcquiredNvidiaMembers` therefore awaits the timer fallback, not necessarily actual
stream settlement, at lines 567-570. Both acquisition rejection and metadata rejection return
through that helper at lines 603-630; consumption failure does the same at lines 662-676.

The checked-in test at `test/nvidia-ir-recorded-contract.test.ts:121-210` does not detect this
behavior. Its fixture-store stream is a `Readable.from` wrapper whose unstarted generator closes
within the fallback turn. Waiting 10 milliseconds after return only proves that helper's immediate
stream implementation; it does not prove the port-level settlement contract for a `Readable` with
an asynchronous `_destroy` callback.

#### Independent exact-SHA probes

The reviewer built `43ba575`, reused the checked-in authoritative observations and metadata, and
substituted only test-local `Readable` instances whose `_destroy` callbacks completed after 75 ms.
No network, provider, credential, or external byte source was involved.

1. **Metadata rejection.** Both `ArtifactStore.read` calls fulfilled exactly once. The first member
   reported its otherwise valid metadata size plus one byte; both returned streams used delayed
   destruction. The loader returned the stable `ir.bundle-hash-mismatch` reason while the probe
   reported:

   ```json
   {"reasonCode":"ir.bundle-hash-mismatch","atReturn":0,"afterDelay":2}
   ```

   Neither body was consumed, but both destruction callbacks ran only after the loader had returned.

2. **Acquisition rejection.** One `ArtifactStore.read` rejected after a controlled delay while the
   sibling fulfilled with valid metadata and a delayed-destruction stream. The loader made exactly
   two read calls and returned `ir.artifact-read-failed`, but the sibling's destruction callback
   again ran after return:

   ```json
   {"reasonCode":"ir.artifact-read-failed","atReturn":{"delayedDestroyCallbacks":0,"readCalls":2},"afterDelay":{"delayedDestroyCallbacks":1,"readCalls":2}}
   ```

These probes preserve zero body bytes, exact call counts, and stable public reasons. They isolate
the remaining defect to the promised cancellation-settlement/lifecycle boundary. A passing
functional suite cannot waive that frozen behavior.

#### Required repair and evidence

1. Remove any timer or event-loop-turn fallback that resolves cancellation as successful settlement
   before the acquired stream reaches an actual terminal state.
2. Destroy every fulfilled stream after an acquisition or metadata failure and await each stream's
   real terminal acknowledgement before the loader promise resolves. The same rule must apply to
   every unconsumed sibling after a body-consumption failure.
3. If the frozen `Readable` port cannot provide a bounded terminal acknowledgement, stop for an
   explicit contract decision; do not silently redefine a timeout as successful settlement or
   change a frozen port in this repair.
4. Add symmetric delayed-`_destroy` tests for each member role and for acquisition, metadata, and
   consumption failures. Prove that the loader remains pending before the delayed terminal callback,
   returns only afterward, performs exactly one read per member, consumes zero sibling body bytes,
   emits no normalization/projection/candidate/draft, and has no post-return stream activity.
5. Re-run a fresh independent audit and the complete clean exact-SHA repository gate.

## Prior finding disposition

The two-commit repair from `c51758a` through `43ba575` materially closes the other inherited
findings; no additional blocker was found in the reviewed areas:

- `docs/audit/pr-2c-fresh-audit-9b1a32.md` remains immutable evidence. Its derived-projection
  retrieval defect is repaired at `src/providers/observation-ledger.ts:1693-1729`, with FMP/NVIDIA
  positive, forged-identity, provider-order, replay, and page-size cases at
  `test/observation-ledger-contract.test.ts:1416-1545`.
- `docs/audit/pr-2c-fixture-boundary-audit-9b1a32.md` remains immutable evidence. FMP and NVIDIA now
  use the existing `ArtifactStore` as authority, recompute returned observation identity/hash,
  enforce exact call counts and verified metadata, fully consume bounded streams, keep acquisition
  preimages out of production manifests, validate closed expected/provenance/proof shapes, and use
  only synthetic checked-in fixtures.
- `docs/audit/pr-2c-reaudit-175b75a.md` remains immutable evidence. Commit `43ba575` closes that
  report's original sibling-body-consumption race by settling both read promises and validating all
  metadata before sequential consumption at
  `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:603-631,662-676`. This audit supersedes the
  earlier assessment only to carry forward the narrower terminal-settlement defect above; it does
  not rewrite or delete any prior `NO_GO` record.
- Cross-source duplicate/correction behavior, arrival permutations, redelivery, replay page sizes,
  and in-memory/SQLite equivalence remain executable in
  `test/recorded-mirror-acceptance.test.ts:534-804`.

The three earlier `NO_GO` records are not final dispositions for this SHA. This fourth SHA-bound
record is controlling for `43ba575` and remains `NO_GO` until a later repaired head receives its own
fresh independent verdict.

## Independent validation

The reviewer verified before recording this disposition:

- `git rev-parse HEAD` returned
  `43ba57539f76d01658a7fe21b06187c724c941ce` while the audit worktree was clean.
- `git rev-parse origin/main` returned
  `c51758a1058b86730e19185b98fcd448d9ff533a`.
- `git diff --check c51758a..43ba575` passed.
- `npm.cmd run build` passed at the exact clean SHA.
- Focused exact-head tests passed **60/60, 0 failed, 0 skipped**: FMP recorded contract, NVIDIA IR
  recorded contract, observation-ledger contract, recorded-mirror acceptance, and fixture
  provenance closure.
- The generated hard-kill evidence is explicitly bound to `43ba575` and reports all **29/29**
  declared fault boundaries converged.
- The two independent delayed-destruction probes above failed the frozen terminal-settlement
  assertion and are independently sufficient for `NO_GO`.

A central coverage run later reported 270 tests, 264 passed, 6 skipped, 0 failed, but follow-on
unstaged repair edits began in the shared worktree before that coverage build completed. Those
totals are deliberately **not** represented as clean exact-`43ba575` evidence. This evidence-integrity
limitation is not a waiver and cannot change the binary verdict; the eventual repaired head must run
the full gate from a clean exact SHA.

## Safety and compatibility statement

The reviewed diff adds no HTTP or WebSocket implementation, provider credential access, live
network test, licensed raw fixture, subscription action, broker/order path, or financial effect.
The focused effect-isolation and recorded replay/backend tests passed. The name-status diff from
`c51758a` through `43ba575` changes no migration, `ArtifactStore` interface, EventLog,
ProcessingStore, or frozen kernel-port file. The unresolved behavior is local recorded/offline
stream cancellation.

## Gate

**NO_GO** for `43ba57539f76d01658a7fe21b06187c724c941ce`.
