# Read-only earnings vertical-slice plan

- Status: Kernel V2 RC.2 has effective `GO`; PR 2A is complete and merged; PR 2B recorded SEC is
  the current implementation gate
- RC.2 evidence: immutable prerelease `v0.2.0-kernel-rc.2` at
  `fe04e32f9b218b41b1c56bffd2a131fb32192f82`; Windows, Linux, 10k, 100k, release, asset, and
  checksum verification passed
- PR 2A merge: pull request #2, merged to `main` at
  `e350210a3c8d8f0bd3ae512dde9461fcfb58d0b4`
- RC.1 disposition: `CONDITIONAL GO` for offline audit comparison and design only; it is immutable
  historical evidence, not the frozen kernel
- Explicitly excluded: brokerage connectivity, orders, portfolio mutation, and automated trading

## PR 2A: artifact-vault foundation (complete)

PR 2A is merged. The implementation, recovery state machine, platform policy, hard-kill matrix,
runtime-root checks, and evidence integration are now part of `main`. The remaining work begins at
the provider boundary; PR 2A intentionally contains no SEC, FMP, or issuer-IR semantics.

This PR is provider-neutral. It introduces `ArtifactDigest`, `ArtifactMetadata`,
`RetrievalObservation`, `StoredArtifact`, and `ArtifactStore` without SEC, FMP, or IR parsing.

Content and observations remain separate. Identical bytes are stored once by SHA-256, while every
provider retrieval retains its provider record/revision, retrieval time, request identity, status,
ETag, Last-Modified value, media type, encoding, and artifact hash. Secrets, authorization headers,
cookies, API keys, and signed URLs are never persisted.

Raw bytes live outside SQLite under `%LOCALAPPDATA%\peas-engine` on Windows and an explicit
application-data root such as `$XDG_DATA_HOME/peas-engine` on Linux, using content-addressed
sharded paths such as `artifacts/sha256/ab/cd/<digest>`. Provider filenames never influence paths.
The vault rejects symlink, junction, reparse-point, and path-substitution escapes from its configured
root. SQLite stores immutable metadata, observations, and reconciliation state.

Filesystem and SQLite writes cannot form one atomic transaction, so durability uses:

```text
staged -> committed
       -> corrupt/quarantined
```

The write path streams to a temporary file, hashes and size-checks while streaming, enforces global
and per-artifact quotas, flushes and closes, atomically renames to the digest path, then commits
metadata and the retrieval observation. Disk-full and quota failures leave no committed metadata
claiming absent content. Restart reconciliation handles abandoned staging files, renamed files
without metadata, metadata without files, and changed files. Every `read()` recomputes size and
SHA-256 from a handle whose identity is protected against verify/read path substitution; corrupt
artifacts are quarantined and can never be normalized.

“Raw” means the exact HTTP entity body presented to the client plus relevant response headers. If a
client automatically decompresses transport bytes, that fact is recorded; transport and entity
hashes are retained where practical.

Required tests cover duplicate bytes, multi-provider observations, concurrent convergence,
conflicting metadata, crashes on both sides of rename/SQLite commit, missing or changed files,
incorrect size/digest, zero/max size, quota and `ENOSPC` failures, hostile filenames, symlink and
Windows junction/reparse-point escape attempts, verify/read substitution, reopen reconciliation,
and quarantine. Windows and Linux both exercise concurrent rename races and runtime-root behavior.

## PR 2B: recorded SEC end-to-end

The accepted contract and implementation sequence are in
[`ADR 0007`](adr/0007-recorded-sec-normalization.md). Copy-ready bounded agent assignments are in
[`docs/agent-prompts/pr-2b-recorded-sec.md`](agent-prompts/pr-2b-recorded-sec.md). Independent review
closed the contract gate on 2026-07-13. The fixture, evidence-bundle, normalizer, reducer, and
recorded end-to-end gates are implemented and independently audited. PR 2B is now in review; live
provider work remains deferred.

### Binding EventDraft resource boundary

This precondition is complete in Kernel RC.2. `EVENT_PAYLOAD_LIMITS`, iterative JSON validation,
bounded serialized parsing, and atomic memory/SQLite rejection cover total UTF-8 bytes, structural
depth, total nodes, array length, object-key count, and individual string/key bytes. The boundary
remains a frozen PR 2B contract and must not regress.

The boundary must reject an oversized or structurally excessive draft before recursive canonical
JSON processing can exhaust memory or the call stack. Versioned limits must cover at least total
UTF-8 bytes, nesting depth, total nodes, array length, object-key count, and individual string/key
bytes. Validation itself must tolerate hostile depth, and failures must produce the specified
quarantine/rejection behavior without partially capturing an event. Tests must cover exact and
one-over boundaries for ASCII, CJK, and emoji content; wide and deeply nested structures; and
byte-identical behavior in memory and SQLite paths.

The first provider slice is offline SEC evidence:

```text
recorded SEC response -> ArtifactStore -> verified read -> SEC normalizer
  -> EventDraft -> trusted capture -> earnings reducer -> audited cluster
```

Cover submissions/filing metadata, 8-K Item 2.02, filing index, EX-99.1, and 10-Q/10-K linkage. A
filing is modeled as a related artifact bundle rather than one document. Tests cover missing
exhibits, duplicate/amended accessions, timestamp disagreements, non-earnings 8-Ks, malformed HTML,
CIK normalization, fiscal-period ambiguity, and next-morning filings.

## PR 2C: recorded IR/FMP/SEC mirrors

Add reviewed recorded or synthetic issuer-IR and FMP structures only after PR 2B passes. Exercise
IR/FMP/SEC arrival permutations, identical and byte-different mirrors, corrections, inferred times,
redelivery, and sources arriving while first-source analysis is leased. Confirm redistribution
rights before committing provider bodies; restricted responses remain private/encrypted or are
replaced by reviewed synthetic fixtures.

## Read-only live clients

After all recorded-provider PRs pass, enable live reads in this order: SEC, FMP, a small issuer-IR
allowlist, then broader IR coverage. Every response follows:

```text
fetch -> durable artifact -> verified read -> normalize -> EventDraft
```

The deployment uses an explicit dispatcher allowlist for artifact fetch, timer, normalization,
analysis, and projection-update intents. Broker domains, credentials, order topics, and portfolio
mutation are structurally unavailable. `effectsAllowed: true` alone is insufficient authorization
for an effect type.

## Preconditions for any future financial effect

Completion of the read-only slice does not authorize financial effects. Before any brokerage or
order submission is designed, a separate accepted ADR and adversarial test gate must require:

- an explicit effect-type allowlist that fails closed and makes financial effect types
  structurally unavailable to read-only deployments;
- a durable `submission-started` intent committed before the external call, bound to the immutable
  output ID and current fencing token;
- broker-supported idempotency using a stable submission key wherever the broker offers it;
- reconciliation with the broker before every retry after a timeout, process crash, lost lease, or
  any other uncertain outcome; and
- no automatic reclaim-and-resubmit path for an ambiguous financial effect.

The existing terminal `ambiguous` state is necessary but insufficient because a process can crash
after the external submission and before recording ambiguity. Authorization remains blocked until
the pre-call durable state and post-crash reconciliation protocol are implemented and proven.

## Go/no-go boundary (satisfied)

The RC.2 foundation gate is satisfied. The exact candidate SHA is bound to both OS checks, 10k and
100k metrics, golden evidence, and the annotated RC tag. The prerelease is immutable; `gh release
verify`, all three `gh release verify-asset` checks, and local `SHA256SUMS` comparison succeeded.
No additional kernel release ceremony blocks PR 2B.

Success of this read-only sequence does not authorize brokerage work; that requires the separate
architecture, safety review, durable submission protocol, broker reconciliation, idempotency, and
effect-type authorization described above.
