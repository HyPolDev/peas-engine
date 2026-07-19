# PR 2C final independent disposition at `731c2d3`

## Review record

- **Binary verdict:** **GO**
- **Exact reviewed SHA:** `731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`
- **Base:** `c51758a1058b86730e19185b98fcd448d9ff533a`
- **Review date:** 2026-07-19
- **Environment:** Windows, PowerShell, Node 24.17.0, npm 12.0.0
- **Reviewer:** independent review-only Terra agent `/root/terra_pr2c_go_731`

The reviewer authored none of PR 2C, the three repair commits, ADR 0008/0009, the fixture and
observation-ledger contracts, the loaders, manifests, test helper, or executable tests. The review
began from a clean worktree at the exact reviewed SHA. The reviewer made no implementation or test
change. This disposition is the reviewer's only repository write.

Every file and line reference below is bound to
`731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`; it must not be read as approval of a later tree.

## Binary verdict

**GO** for exact implementation
`731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e` against base
`c51758a1058b86730e19185b98fcd448d9ff533a`.

The four durable `NO_GO` records remain immutable historical evidence. Their blocking findings are
closed at this exact SHA, the complete clean repository gate has a passing unchanged-tree run, and
the independent focused review found no additional blocker in the reviewed PR 2C boundary.

## Supersession chain

This is an exact-SHA disposition, not a rewrite of prior evidence:

1. `docs/audit/pr-2c-fresh-audit-9b1a32.md` rejected `9b1a32a5e7992c7d98ac3bde8b79b032de76168e`
   for derived-projection retrieval, unbounded recorded reads, and incomplete NVIDIA provenance
   validation.
2. `docs/audit/pr-2c-fixture-boundary-audit-9b1a32.md` independently rejected the same SHA for the
   recorded loader/manifest boundary, including authority, exact-shape, expected-output, selector,
   path, and byte-bound gaps.
3. `docs/audit/pr-2c-reaudit-175b75a.md` found those defects materially repaired at
   `175b75a33acaa8a8355c37dc630cbe0ebdc4f852`, but rejected that SHA because NVIDIA could return
   from one member's failed metadata gate while a sibling body continued asynchronously.
4. `docs/audit/pr-2c-reaudit-43ba575.md` found the atomic metadata repair at
   `43ba57539f76d01658a7fe21b06187c724c941ce`, but rejected that SHA because a `setImmediate`
   fallback could report cancellation settlement before delayed `_destroy`/`close` completion.
5. This record supersedes the fourth assessment only for
   `731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`. The earlier records remain authoritative for their
   own SHAs and continue to document why the repair chain was required.

The earlier unauthenticated repository claim of GO at the merged PR 2C tip remains superseded; this
fresh, review-only exact-SHA disposition is the controlling PR 2C implementation gate.

## Finding closure

### Derived-projection retrieval and ledger identity

FMP and NVIDIA semantic primaries remain `derived-projection` identities and no longer have to equal
a raw retrieval digest. A retrieval basis selects an exact raw link by role, acquisition
observation, and vault observation, then reconciles the matching verified and committed artifact,
size, digest, retrieval time, and clock at
`src/providers/observation-ledger.ts:1693-1729`.

The executable contract covers both providers with capture and retrieval bases at
`test/observation-ledger-contract.test.ts:1416-1436`, rejects forged raw identities and unrelated
verification parents beginning at `test/observation-ledger-contract.test.ts:1439`, and proves
provider-order, replay-remapping, and page-size stability at
`test/observation-ledger-contract.test.ts:1504-1554`.

### ArtifactStore authority, exact calls, bounded reads, and full consumption

Both production manifests are V2 and contain only declared member identity, size, selected
observation, selector/route, derived proof, expected output, and provenance. Paths and acquisition
preimages are test-only vault-seeding data. FMP recomputes authoritative observation identity and
hash before its single verified read at `src/adapters/fmp/recorded-fmp-fixture.ts:532-630`; its
public orchestration and proof reconciliation are at
`src/adapters/fmp/recorded-fmp-fixture.ts:634-726`.

NVIDIA validates the complete closed expected/provenance/selector/member/proof shape before store
access at `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:279-479`, recomputes both authoritative
observations at `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:481-533`, and performs exactly one
`ArtifactStore.read` per member through the settled acquisition set at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:599-627`. Metadata is evaluated for all members
before consumption at `src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:569-596`. The loader then
allocates only the bounded declared member size, consumes sequentially, rejects overrun/underrun or
digest substitution, and settles every acquired stream on success or failure at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:630-674`.

Executable evidence includes FMP authority/proof closure at
`test/fmp-recorded-contract.test.ts:546-600`, FMP real loader exact/one-over/growth/replacement
coverage at `test/fmp-recorded-contract.test.ts:602-716`, NVIDIA authoritative observation and exact
call checks at `test/nvidia-ir-recorded-contract.test.ts:100-169`, NVIDIA member/aggregate and
actual-stream bounds at `test/nvidia-ir-recorded-contract.test.ts:434-603`, and zero-read hostile
manifest coverage at `test/nvidia-ir-recorded-contract.test.ts:605-770`.

### Atomic acquisition, metadata, consumption, and terminal settlement

The last two re-audit findings are closed. NVIDIA first settles both `ArtifactStore.read` promises
with `Promise.allSettled`, consumes neither stream until both metadata records pass, and cancels all
fulfilled siblings for acquisition or metadata failure at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:599-627`. Consumption is sequential and its
success and failure paths both cross the same settlement barrier at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:658-674`.

The terminal helper has no timer, poll, microtask, or event-loop fallback. If a stream is not
already closed, it installs the terminal listeners, calls `destroy()` once when necessary, and
resolves only on the observable `close` acknowledgement at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:540-560`; cancellation awaits the settlement of
the entire acquired set at lines 563-566.

Symmetric delayed-`_destroy` evidence proves:

- failed metadata in either role, both stable metadata reasons, zero started/streamed body bytes,
  pending-before-callback, and no post-return activity at
  `test/nvidia-ir-recorded-contract.test.ts:172-241`;
- a thrown acquisition in either role, exact two read attempts, settled fulfilled sibling, no raw
  error leakage, pending-before-callback, and no post-return activity at
  `test/nvidia-ir-recorded-contract.test.ts:244-309`; and
- consumption overrun in either role, delayed erroring destruction, and already-closed streams at
  `test/nvidia-ir-recorded-contract.test.ts:311-431`.

The settlement contract explicitly trusts normal close emission: after `destroy()`, a returned
`VerifiedArtifactRead.stream` must acknowledge lifecycle completion with terminal `close`.
`emitClose:false` or another non-acknowledging stream is contract-invalid, not a successful timeout.
That postcondition is frozen at `docs/contracts/pr-2c-fixture-manifest.md:115-121` and
`docs/adr/0008-recorded-fmp-and-nvidia-ir-normalization.md:375-380`. The real durable
`ArtifactStore` implementation is exercised for one and only one close acknowledgement at
`test/artifact-vault.test.ts:306-322`. This adds no method, field, or signature to the frozen
`ArtifactStore` interface.

### Manifest, provenance, replay, backends, and effects

The closed NVIDIA expected/provenance gate is implemented at
`src/adapters/ir/nvidia/recorded-nvidia-fixture.ts:279-408`; the FMP counterpart is at
`src/adapters/fmp/recorded-fmp-fixture.ts:306-506`. Derived proof maps are recomputed in both
directions, and terminal results cannot echo unverified projection claims; focused closure is at
`test/fixture-provenance-closure.test.ts:50-125`. Checked-in manifests declare original-synthetic
provenance with null approval references at `fixtures/fmp/v1/manifest.ts:142-144` and
`fixtures/ir/nvidia/v1/manifest.ts:159-161`.

Cross-source order, duplicates, corrections, redelivery, immutable leases, replay page sizes, and
in-memory/SQLite equivalence are executable at
`test/recorded-mirror-acceptance.test.ts:534-804`. Network calls are trapped and remain zero in the
provider tests at `test/fmp-recorded-contract.test.ts:950-966` and
`test/nvidia-ir-recorded-contract.test.ts:1093-1111`; the accepted ADR scope remains offline and
`effectsAllowed:false` at `docs/adr/0008-recorded-fmp-and-nvidia-ir-normalization.md:11-13,426-428`.

## Validation evidence

### Central clean exact-SHA gate

The candidate was committed before the gate and remained clean and unchanged throughout. The
second complete `npm.cmd run check` passed at
`731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`:

- runtime verification passed;
- the declared fault-boundary inventory passed with **29/29** entries;
- formatting and lint passed for **113 files**;
- typecheck and all build stages passed;
- hard-kill passed **3/3**, covering the declared process-kill matrices;
- coverage ran **272 tests: 266 passed, 6 intentional skips, 0 failed**;
- evidence reconciliation ran **32 tests: 31 passed, 1 platform skip, 0 failed**; and
- mutation passed with **39/39 mutants killed**.

The six coverage skips were the three process-kill tests executed separately by the hard-kill gate,
the Linux file-symlink case unavailable on Windows, and the SQLite 10k extended and 100k nightly
scale gates. The evidence-reconciliation skip was the raw-evidence symlink refusal case because
Windows returned `EPERM` when creating the symlink. These are intentional/platform gates, not
silent waivers.

### First-run failure and retry disposition

The first clean exact-SHA `npm.cmd run check` was **not** a pass. It had one failure in the inherited
test `reconciliation expires attempts and quarantines unowned stages`: an expected quarantine count
of `1` was observed as `0`. The candidate changes only add the independent verified-read close test
to `test/artifact-vault.test.ts`; they do not modify that reconciliation case.

The same exact case then passed **1/1** without a source or commit change. The complete
`artifact-vault` file then passed **43/44** with only its intentional Linux symlink skip, and the
second unchanged-clean complete `npm.cmd run check` produced the passing totals above. The fresh
reviewer independently reran that complete file and again obtained **43 passed, 1 intentional skip,
0 failed**.

No root cause was established, so this record does not relabel the first run as a pass. The evidence
supports an isolated, non-reproduced scheduling-sensitive test failure rather than a reproducible
PR 2C product defect. One subsequent complete unchanged-tree pass plus the two passing complete-file
runs is sufficient for this gate; recurrence should be treated as test-reliability work, not erased
from the audit trail.

### Fresh independent commands

The reviewer independently ran the following against the clean exact SHA:

```text
git diff --check c51758a1058b86730e19185b98fcd448d9ff533a..731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e
npm.cmd run clean
npm.cmd run build
node --test --test-concurrency=1 --test-reporter=dot dist/test/fmp-recorded-contract.test.js dist/test/nvidia-ir-recorded-contract.test.js dist/test/observation-ledger-contract.test.js dist/test/recorded-mirror-acceptance.test.js dist/test/fixture-provenance-closure.test.js
node --test --test-concurrency=1 --test-reporter=spec dist/test/artifact-vault.test.js
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
```

`git diff --check` passed. Clean/build passed. The five focused suites passed **61/61, 0 failed,
0 skipped**. The full artifact-vault file passed **43/44, 0 failed, 1 intentional Linux-platform
skip**. Formatting and lint passed for **113 files**, and typecheck passed. The worktree remained
clean through all review-only commands.

## Safety and frozen-port compatibility

The name-status diff from base to reviewed SHA changes no migration, `ArtifactStore` interface,
EventLog, ProcessingStore, frozen kernel-port, broker/order, or financial-effect file. The repair
adds no live HTTP/WebSocket transport, credential or account access, subscription action, licensed
raw provider fixture, or external network test. All reviewed fixture bytes are checked-in
original-synthetic material. Runtime behavior in scope is deterministic recorded/offline loading,
normalization, observation-ledger validation, and replay only.

## Gate

**GO** for `731c2d33285cee8f27d9fe8ff1a2b9a1a29e9e4e`.

This exact commit may serve as the repaired PR 2C implementation prerequisite for PR 2D. Any later
code, contract, fixture, or test change requires its own review disposition; this GO does not
authorize live provider work, spending, credential access, or a merge.
