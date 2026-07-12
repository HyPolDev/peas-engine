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

Filesystem installation and SQLite commit are not atomic, so every cross-medium operation is a
forward-recovery state machine. A single leased vault-writer process
uses an expiring lease with a random owner identity and monotonically increasing SQLite fencing
generation. The lease is renewed at half-duration or faster and at every mutation boundary.
Ownership is checked immediately before filesystem installation and again inside every immediate
SQLite mutation transaction using a fresh clock reading obtained after the transaction begins.
Attempt creation, install-intent transitions, terminal outcomes, action planning/application,
incident insertion, reconciliation receipts, and quarantine installation are fenced as well as
successful commits. A writer that loses ownership
cannot commit trusted metadata or continue reconciliation; a crash or takeover may leave only a
recoverable stage or content orphan. PID liveness is not an ownership signal.

An exact replay of a completed attempt consumes and verifies the redelivered bytes, then returns the
original artifact and observation without creating evidence. Reuse of an attempt identity with
different immutable metadata, response facts, or content is a conflict. Incomplete or non-success
terminal identities are not automatically reused; reconciliation must first classify them.

No content installation precedes its immutable `ins1_` install intent. The intent binds the attempt
and staging identities, digest and size, artifact and observation candidates, allowlisted response
metadata, and whether the destination was new or preexisting and verified. Immutable `ist1_`
transitions record content installation, the atomic success-evidence commit, stage cleanup, or
abort. The blob, succeeded outcome, observation, and `evidence-committed` transition are one
immediate fenced SQLite transaction loaded solely from the intent. Reconciliation may complete an
observation only from such an intent; unmanaged content can only become a `recovered-orphan` blob.

The vault uses bounded in-process concurrency, bounded streaming, safe-integer sizes, and durable
restart reconciliation. A canonical durable head binds an `rr1_` run, writer generation, cursor
epoch, persisted nonce, phase, key/shard position, pending action, active call, counters, and an
`rc1_` token. Each call has an immutable `rcl1_` response receipt committed before return. Retrying
the immediately consumed token returns that receipt. Same-generation null cursors fail closed; a
later generation may resume an active run tokenlessly and rotates the token atomically. Terminal
state and its null response remain durable. A new full scan requires `startNew: true` and the
completed run ID.

Evidence validation uses bounded keyset pages and directory enumeration. Each mutation first
commits one deterministic `act1_` plan keyed by its run and `wrk1_` work identity; the durable head
points directly to the pending action. Filesystem replay then converges to one immutable application
receipt. Cursor advancement, relational effects, action application, and call counters commit
together. Incident and `q1_` quarantine identities exclude writer generation and timestamps, so a
takeover replays the same evidence and target. Quarantine targets are exclusive, synced, verified
against the plan, and never overwritten. A target collision, changed source identity, or a
both-missing replay fails closed. Valid orphans may be adopted without observations. Corrupt reads
never expose bytes before snapshot verification. Quarantine has no automatic restoration path.

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

Production has no implicit runtime-root fallback. `PEAS_RUNTIME_ROOT` is required and must identify
an absolute configured local root. SQLite is fixed at `<root>/sqlite/peas.sqlite`; its WAL and SHM
remain beside it. Content, staging, snapshots, quarantine, and locks are fixed descendants of
`<root>/artifacts`. A repository/database bound anywhere else is rejected before the vault opens.
The path is deployment configuration and no host-specific drive or user path is compiled into the
application.

The frozen `config/artifact-vault-deployment-policy.v1.json` distinguishes a configured local root
from CI temporary roots. A configured Windows root requires a fixed local NTFS volume on an
allowlisted non-removable bus, a direct volume path, and no reparse ancestor. Network, synchronized,
removable, directory-mounted, and cross-device layouts are rejected. Linux configured roots are
restricted to the policy's local filesystem allowlist. CI uses isolated temporary directories,
must retain fixed-NTFS/filesystem, same-device, and redirect checks, and never constitutes
deployment approval. Hosted-runner bus types are recorded but are not compared with the production
bus allowlist; only an explicit configured-root attestation can satisfy that deployment check.

Every existing ancestor and vault component is required to be a plain same-volume directory. The
trusted-filesystem adapter creates components individually, rejects redirects before descendant
creation, revalidates root/parent device and identity at mutation boundaries, uses no-follow opens
where exposed, enforces regular-file and link-count policy, compares handle identity before and
after hashing, creates targets exclusively, and syncs files and directories where meaningful.
Linux real paths are checked component by component. Windows junctions and symbolic links exposed
by Node are rejected, and file/volume identities are persisted with recovery evidence. A hostile
administrator with kernel-level replacement capability remains outside the application threat
model unless the deployment supplies a native handle-relative backend.

Deployment validation and the application check different but complementary facts. Application
startup enforces the derived layout, plain-directory ancestry exposed by Node, same-device identity,
no-follow file access, and repository binding. The deployment validator binds filesystem type,
drive type, bus type, volume identity, and the absence of any reparse attribute to the frozen
policy. Failure or inability to obtain either half is a release/deployment failure, not a fallback.

Production code exposes named, inert-by-default fault boundaries immediately after durable SQLite
commits and filesystem mutations. Test workers report a selected boundary over IPC and block so a
parent can hard-kill the process instead of simulating failure with an exception. CI runs the vault
suite on Linux and Windows; unsupported required capabilities are visible failures, not silent skips.
Release reconciliation binds both platform reports, the hard-kill report, deployment-policy hash,
platform-capability inventory, and fault-boundary inventory to one exact candidate SHA. A platform
report with any unsupported required capability cannot authorize a release.

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
Administrator/kernel replacement after verified handles are opened and physical compromise below
the filesystem durability boundary are explicit exclusions. Network, synchronized, removable, and
reparse-mounted runtime volumes are prohibited deployments rather than accepted risks.
