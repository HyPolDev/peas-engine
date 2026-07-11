# ADR 0002: SQLite durability with a PostgreSQL scaling boundary

- Status: Accepted
- Date: 2026-07-10
- Amended: 2026-07-11 (live SQLite and evidence-scope boundaries)

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

The core depends only on asynchronous, paged `EventLog` and `ProcessingStore` interfaces. The
SQLite adapter uses `better-sqlite3`, whose database calls are synchronous. An asynchronous port
signature does not make those calls non-blocking. A live SQLite deployment therefore uses one
dedicated writer process with a bounded input queue, bounded transaction batches, and explicit
backpressure. It must not execute unbounded database work on a latency-sensitive provider or HTTP
event loop.

A future PostgreSQL adapter must preserve canonical serialization, event positions, run-scoped
output IDs, transaction boundaries, fencing behavior, and replay results. PostgreSQL becomes
appropriate for multiple processing writers or multi-node leasing; it is not required merely to
scale readers or effect workers.

The complete `snapshot()` operation is an audit/export operation. It pages database reads but
intentionally accumulates all outputs and aggregate checkpoints into one result. Production
large-run consumers must use bounded page or projection APIs and must not use `snapshot()` as a
steady-state query surface.

Every research or replay run has a separate immutable output ledger. Retained storage therefore
approaches `processed events x retained runs`, in addition to checkpoints and operational rows.
Before large research sweeps, the deployment must define database rotation, an immutable archive
format and verification procedure, retention periods, deletion authorization, and restore tests.

The 100k audit workload is sparse and sequential: it processes one source event for each of 100k
issuers through a single writer. It is evidence for long-running SQLite durability and sparse
throughput, not proof of full-pipeline capacity. It does not represent dense multi-source clusters,
timers, analysis results, database reopen cycles, concurrent research runs, or complete snapshot
materialization. Those workloads require separate budgets and evidence.

## Consequences

- Local development and a single-node deployment require no database service.
- A crash before commit advances nothing; a crash after commit is detected by the checkpoint.
- SQLite write throughput is intentionally single-writer.
- Live SQLite processing requires a dedicated writer process or equivalently isolated worker, plus
  bounded batches, queue limits, and backpressure.
- Applied migration files are immutable; corrections require a new migration.
- Full snapshots remain valuable deterministic audit evidence but are not the production API for
  large-run reads.
- Research-run retention is an explicit capacity decision; unbounded run history is unsupported.
- Moving to PostgreSQL is an adapter and migration project, not a reducer rewrite.
