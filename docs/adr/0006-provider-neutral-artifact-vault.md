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
generation. The lease is renewed at half-duration or faster and at every mutation boundary.
Ownership is checked immediately before filesystem installation and again inside every immediate
SQLite mutation transaction using a fresh clock reading obtained after the transaction begins.
Attempt creation and terminal outcomes, artifact adoption, incident insertion, reconciliation, and
quarantine installation are fenced as well as successful commits. A writer that loses ownership
cannot commit trusted metadata or continue reconciliation; a crash or takeover may leave only a
recoverable stage or content orphan. PID liveness is not an ownership signal.

An exact replay of a completed attempt consumes and verifies the redelivered bytes, then returns the
original artifact and observation without creating evidence. Reuse of an attempt identity with
different immutable metadata, response facts, or content is a conflict. Incomplete or non-success
terminal identities are not automatically reused; reconciliation must first classify them.

The vault uses bounded in-process concurrency, bounded streaming, safe-integer sizes, and durable
restart reconciliation. Reconciliation state is canonical-hashed in SQLite and binds a monotonic
generation, phase, database key, content shard, and caller continuation token. Evidence validation
uses keyset pagination with SQL `LIMIT`; open attempts and artifact checks are paged rather than
materialized. Filesystem enumeration uses `opendir()` and fails closed when any audited directory
exceeds 256 entries. That strict fanout cap makes filename-key resumption bounded even though Node
does not expose portable durable directory cookies. The cursor advances only after its represented
read or filesystem action succeeds, and stale, tampered, or generation-mismatched cursors fail
closed. Valid verified filesystem orphans may be adopted without invented retrieval
observations. Invalid or ambiguous objects can be quarantined without an artifact metadata row.
Quarantine installation is exclusive and never replaces an existing object. Incident identity
includes fresh entropy so same-clock incidents remain distinct. Corrupt reads stop after observing
at most one configured read chunk beyond committed size and never expose bytes before snapshot
verification. Quarantine has no automatic restoration path.

Persisted request metadata is limited to the method, sanitized origin, a path hash, a reviewed safe
route label, and allowlisted response facts. Raw paths, queries, full URLs, credentials, cookies,
authorization data, arbitrary headers, and provider filenames are never persisted or used in a
filesystem path. Externally supplied attempt, provider, record, and revision identifiers are
validated and then persisted only as versioned, domain-separated `att1_`, `prv1_`, `rec1_`, and
`rev1_` SHA-256 identities; their raw forms never
cross the vault persistence boundary. Persisted response facts use field-specific grammars that
reject controls, CRLF, URI-shaped values, userinfo, query/fragment delimiters, and other disallowed
forms. Canonical JSON/hash records are checked against every duplicated relational value for
attempts, outcomes, blobs, observations, and incidents, including the outcome consulted by exact
redelivery.

The runtime root is `%LOCALAPPDATA%\peas-engine` on Windows. Linux uses
`$XDG_DATA_HOME/peas-engine`, falling back to `~/.local/share/peas-engine`.
Every existing ancestor and vault component is required to be a plain same-volume directory.
Operation-time checks reject Linux symbolic links and Windows directory junctions exposed by the
Node filesystem API. These checks narrow replacement races but do not claim kernel-enforced
directory-handle-relative resolution on platforms where Node does not expose it; hostile local
administrators remain outside the threat model.

The item budget counts verified database rows, actions, and empty phase/shard transitions. The byte
budget bounds orphan hashing and must be at least one configured artifact. The elapsed budget is
checked between bounded operations; a single SQLite `LIMIT` query or at-most-257-entry directory
read is the maximum non-preemptible unit. Reports expose rows visited, directory entries read,
bytes hashed, and elapsed time. Unmanaged directories above the fanout cap are classified as unsafe
and retained untouched for operator inspection rather than partially enumerated or adopted.

## Kernel boundary

The vault is an adapter-side subsystem. It does not change `EventDraft`, `EventLog`,
`ProcessingStore`, reducers, manifests, or any frozen kernel behavior. A later normalizer may place
the digest of a verified artifact into the existing `EventDraft.provider.artifactHash` field.

## Deferred

Provider clients and semantics, HTTP transport, normalization, text decoding, artifact bundles,
remote storage, encryption, deletion and retention policy, distributed leases,
automatic repair, and quarantine restoration are separate decisions.
