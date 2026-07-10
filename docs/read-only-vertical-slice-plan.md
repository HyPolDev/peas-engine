# Read-only earnings vertical-slice plan

- Status: Blocked until one exact Kernel V2 candidate SHA passes Windows, Linux, 10k, and 100k
  remote gates and receives a `GO` decision
- Explicitly excluded: brokerage connectivity, orders, portfolio mutation, and automated trading

## PR 2A: artifact-vault foundation

This PR is provider-neutral. It introduces `ArtifactDigest`, `ArtifactMetadata`,
`RetrievalObservation`, `StoredArtifact`, and `ArtifactStore` without SEC, FMP, or IR parsing.

Content and observations remain separate. Identical bytes are stored once by SHA-256, while every
provider retrieval retains its provider record/revision, retrieval time, request identity, status,
ETag, Last-Modified value, media type, encoding, and artifact hash. Secrets, authorization headers,
cookies, API keys, and signed URLs are never persisted.

Raw bytes live outside SQLite under `%LOCALAPPDATA%\peas-engine` using content-addressed sharded
paths such as `artifacts/sha256/ab/cd/<digest>`. Provider filenames never influence paths. SQLite
stores immutable metadata, observations, and reconciliation state.

Filesystem and SQLite writes cannot form one atomic transaction, so durability uses:

```text
staged -> committed
       -> corrupt/quarantined
```

The write path streams to a temporary file, hashes and size-checks while streaming, flushes and
closes, atomically renames to the digest path, then commits metadata and the retrieval observation.
Restart reconciliation handles abandoned staging files, renamed files without metadata, metadata
without files, and changed files. Every `read()` recomputes size and SHA-256; corrupt artifacts are
quarantined and can never be normalized.

“Raw” means the exact HTTP entity body presented to the client plus relevant response headers. If a
client automatically decompresses transport bytes, that fact is recorded; transport and entity
hashes are retained where practical.

Required tests cover duplicate bytes, multi-provider observations, concurrent convergence,
conflicting metadata, crashes on both sides of rename/SQLite commit, missing or changed files,
incorrect size/digest, zero/max size, hostile filenames, reopen reconciliation, and quarantine.

## PR 2B: recorded SEC end-to-end

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

## Go/no-go boundary

No artifact or provider implementation starts until the exact same candidate commit SHA is present
in both OS checks, 10k and 100k metrics, golden evidence, the RC tag, and the signed go/no-go report.
Success of this read-only sequence does not authorize brokerage work; that requires a separate
architecture and safety review.
