# ADR 0002: SQLite durability with a PostgreSQL scaling boundary

- Status: Accepted
- Date: 2026-07-10

## Context

The initial engine needs durable events, checkpoints, jobs, and an outbox without requiring a service
or container. It must also admit a multi-node implementation later.

## Decision

Use SQLite in WAL mode with one processing writer. SQL migrations are committed, handwritten,
ordered, and recorded with checksums. Startup rejects changed migration history. The event log, run
manifests, and immutable output ledger reject updates and deletes through database triggers.

Appending an event is atomic. Processing an event uses one transaction for:

- immutable decision ledger rows;
- job and outbox intents;
- one bounded aggregate checkpoint and its hash;
- run-scoped state and decision-chain heads, exact event head, and processed position.

Delivery leases, attempts, statuses, fencing tokens, and errors are mutable operational data and are
excluded from replay hashes. The intent body exists only in the immutable output ledger. Claim,
renew, and completion operations guard on lease owner and fencing token. Runtime databases live
outside synchronized source directories.

The core depends only on asynchronous, paged `EventLog` and `ProcessingStore` interfaces. A future
PostgreSQL adapter must preserve canonical serialization, event positions, run-scoped output IDs,
transaction boundaries, fencing behavior, and replay results. PostgreSQL becomes appropriate for
multiple processing writers or multi-node leasing; it is not required merely to scale readers or
effect workers.

## Consequences

- Local development and a single-node deployment require no database service.
- A crash before commit advances nothing; a crash after commit is detected by the checkpoint.
- SQLite write throughput is intentionally single-writer.
- Applied migration files are immutable; corrections require a new migration.
- Moving to PostgreSQL is an adapter and migration project, not a reducer rewrite.
