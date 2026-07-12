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

The vault uses bounded in-process concurrency, bounded streaming, safe-integer sizes, and restart
reconciliation. Valid verified filesystem orphans may be adopted without invented retrieval
observations. Invalid or ambiguous objects can be quarantined without an artifact metadata row.
Quarantine installation is exclusive and never replaces an existing object. Incident identity
includes fresh entropy so same-clock incidents remain distinct. Corrupt reads stop after observing
at most one configured read chunk beyond committed size and never expose bytes before snapshot
verification. Quarantine has no automatic restoration path.

Persisted request metadata is limited to the method, sanitized origin, a path hash, a reviewed safe
route label, and allowlisted response facts. Raw paths, queries, full URLs, credentials, cookies,
authorization data, arbitrary headers, and provider filenames are never persisted or used in a
filesystem path. Externally supplied attempt, provider, record, and revision identifiers are
validated and then persisted only as domain-separated SHA-256 identities; their raw forms never
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

## Unresolved bounded-reconciliation architecture

The current `maxItems` and `maxElapsedMs` interface bounds mutation work after enumeration, but it
does not bound all pre-work. SQLite verification and open-attempt reads materialize complete result
sets, and Node's portable directory API provides neither a durable directory cookie nor ordered
seek-by-name semantics. Reopening a directory after a crash cannot resume a large enumeration from
an opaque position without rescanning an unbounded prefix. The existing `restart-v1` marker is
therefore not a durable phase/key cursor and is not a release-grade availability guarantee.

The enforceable alternative is a broader vault layout revision: all vault writes enter through a
SQLite-maintained inventory and bounded sharded directories, reconciliation persists a phase/key
work queue in SQLite, and platform-specific native directory enumeration supplies durable cookies
where orphan discovery outside that inventory remains required. Migration and compatibility rules
for existing flat staging, snapshots, and quarantine directories are required. Until that design
is implemented and crash-tested, hostile or very large directories and evidence tables can exceed
a requested reconciliation time or memory budget. PR 2A remains NO-GO on that availability risk;
the item/time fields must not be represented as a complete bound.

## Kernel boundary

The vault is an adapter-side subsystem. It does not change `EventDraft`, `EventLog`,
`ProcessingStore`, reducers, manifests, or any frozen kernel behavior. A later normalizer may place
the digest of a verified artifact into the existing `EventDraft.provider.artifactHash` field.

## Deferred

Provider clients and semantics, HTTP transport, normalization, text decoding, artifact bundles,
remote storage, encryption, deletion and retention policy, distributed leases,
automatic repair, and quarantine restoration are separate decisions.
