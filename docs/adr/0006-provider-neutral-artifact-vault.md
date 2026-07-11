# ADR 0006: Provider-neutral artifact vault

- Status: Accepted
- Date: 2026-07-11
- Baseline: `v0.2.0-kernel-rc.2` at `fe04e32f9b218b41b1c56bffd2a131fb32192f82`

## Decision

Store raw HTTP entity bytes after transport decompression and before text decoding in a
content-addressed filesystem tree outside SQLite. SHA-256 is the content identity and every
consumer read first creates and verifies a private snapshot. SQLite contains separate immutable
evidence for retrieval attempts, terminal attempt outcomes, committed artifacts, successful
observations, and integrity incidents.

Filesystem installation and SQLite commit are not atomic. A single leased vault-writer process
uses an expiring lease with a random owner identity and monotonically increasing SQLite fencing
generation. The lease is renewed at half-duration or faster and at write commit boundaries.
Ownership is checked immediately before filesystem installation and again inside the immediate
SQLite success transaction. A writer that loses ownership cannot commit trusted metadata; a crash
or takeover may leave only a recoverable content orphan. PID liveness is not an ownership signal.

An exact replay of a completed attempt consumes and verifies the redelivered bytes, then returns the
original artifact and observation without creating evidence. Reuse of an attempt identity with
different immutable metadata, response facts, or content is a conflict. Incomplete or non-success
terminal identities are not automatically reused; reconciliation must first classify them.

The vault uses bounded in-process concurrency, bounded streaming, safe-integer sizes, and restart
reconciliation. Valid verified filesystem orphans may be adopted without invented retrieval
observations. Invalid or ambiguous objects can be quarantined without an artifact metadata row.
Quarantine installation is exclusive and never replaces an existing object. Incident identity
includes fresh entropy so same-clock incidents remain distinct. Reconciliation accepts explicit
item and elapsed-time budgets and returns a continuation marker when another idempotent pass is
required. Corrupt reads stop after observing at most one configured read chunk beyond committed
size and never expose bytes before snapshot verification. Quarantine has no automatic restoration
path.

Persisted request metadata is limited to the method, sanitized origin, a path hash, a reviewed safe
route label, and allowlisted response facts. Raw paths, queries, full URLs, credentials, cookies,
authorization data, arbitrary headers, and provider filenames are never persisted or used in a
filesystem path. Persisted identifiers and response facts use field-specific grammars that reject
controls, CRLF, URI-shaped values, userinfo, query/fragment delimiters, and other disallowed forms;
generic secret guessing is not the trust boundary. Canonical JSON/hash records are checked against
every duplicated relational value for attempts, outcomes, blobs, observations, and incidents.

The runtime root is `%LOCALAPPDATA%\peas-engine` on Windows. Linux uses
`$XDG_DATA_HOME/peas-engine`, falling back to `~/.local/share/peas-engine`.
Every existing ancestor and vault component is required to be a plain same-volume directory.
Operation-time checks reject Linux symbolic links and Windows directory junctions exposed by the
Node filesystem API. These checks narrow replacement races but do not claim kernel-enforced
directory-handle-relative resolution on platforms where Node does not expose it; hostile local
administrators remain outside the threat model.

## Kernel boundary

The vault is an adapter-side subsystem. It does not change `EventDraft`, `EventLog`,
`ProcessingStore`, reducers, manifests, or any frozen kernel behavior. A later normalizer may place
the digest of a verified artifact into the existing `EventDraft.provider.artifactHash` field.

## Deferred

Provider clients and semantics, HTTP transport, normalization, text decoding, artifact bundles,
remote storage, encryption, deletion and retention policy, distributed leases,
automatic repair, and quarantine restoration are separate decisions.
