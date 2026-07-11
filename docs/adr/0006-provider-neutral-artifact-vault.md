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
uses bounded in-process concurrency, bounded streaming, safe-integer sizes, and restart
reconciliation. Valid verified filesystem orphans may be adopted without invented retrieval
observations. Invalid or ambiguous objects can be quarantined without an artifact metadata row.
Quarantine has no automatic restoration path.

Persisted request metadata is limited to the method, sanitized origin, a path hash, a reviewed safe
route label, and allowlisted response facts. Raw paths, queries, full URLs, credentials, cookies,
authorization data, arbitrary headers, and provider filenames are never persisted or used in a
filesystem path.

The runtime root is `%LOCALAPPDATA%\peas-engine` on Windows. Linux uses
`$XDG_DATA_HOME/peas-engine`, falling back to `~/.local/share/peas-engine`.

## Kernel boundary

The vault is an adapter-side subsystem. It does not change `EventDraft`, `EventLog`,
`ProcessingStore`, reducers, manifests, or any frozen kernel behavior. A later normalizer may place
the digest of a verified artifact into the existing `EventDraft.provider.artifactHash` field.

## Deferred

Provider clients and semantics, HTTP transport, normalization, text decoding, artifact bundles,
remote storage, encryption, deletion and retention policy, multi-writer or distributed leases,
automatic repair, and quarantine restoration are separate decisions.
