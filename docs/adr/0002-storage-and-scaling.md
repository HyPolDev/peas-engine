# ADR 0002: SQLite durability with a PostgreSQL scaling boundary

- Status: Accepted
- Date: 2026-07-10

## Context

The initial engine needs durable events, checkpoints, jobs, and an outbox without requiring a service
or container. It must also admit a multi-node implementation later.

## Decision

Use SQLite in WAL mode with one processing writer. SQL migrations are committed and handwritten.
The event log and immutable output ledger reject updates and deletes through database triggers.

Appending an event is atomic. Processing an event uses one transaction for:

- immutable decision ledger rows;
- job and outbox intents;
- canonical state and its hash;
- decision-chain head and processed position.

Delivery leases, attempts, statuses, and errors are mutable operational data and are excluded from
replay hashes. Runtime databases live outside synchronized source directories.

The core depends only on `EventLog` and `ProcessingStore` interfaces. A future PostgreSQL adapter must
preserve canonical serialization, event positions, output IDs, transaction boundaries, and replay
results. PostgreSQL becomes appropriate for multiple processing writers or multi-node leasing; it is
not required merely to scale readers or effect workers.

## Consequences

- Local development and a single-node deployment require no database service.
- A crash before commit advances nothing; a crash after commit is detected by the checkpoint.
- SQLite write throughput is intentionally single-writer.
- Moving to PostgreSQL is an adapter and migration project, not a reducer rewrite.
