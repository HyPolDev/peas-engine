# PEAS Engine

PEAS Engine is an auditable deterministic event processor. The same captured event stream is
processed by the same reducer in live-style operation and replay, producing byte-identical
canonical state and the same decision-chain hash.

The first domain reducer groups normalized earnings releases into fixed-window clusters. HTTP,
Express, market-data ingestion, and external workers are adapters and are intentionally outside the
kernel.

## Requirements

- Node.js 24.17.0 (the repository is pinned through `.node-version`)
- npm and Git

On Windows PowerShell, use `npm.cmd` if script execution policy blocks the `npm.ps1` shim.

```powershell
npm.cmd ci
npm.cmd run check
```

`npm run check` verifies formatting, lint rules, strict types, compilation, replay equivalence,
SQLite restart recovery, transaction rollback, and append-only database guards.

## Architecture

```text
live ingress ──> append-only event log ──> deterministic processor ──> pure reducer
                         │                         │
                         │                         ├── state checkpoint
                         │                         ├── immutable decision ledger
                         │                         └── jobs / transactional outbox
                         │
                         └──> replay reader ───────┘
```

The processor is shared by both modes. Live-style adapters persist and dispatch immutable intents;
replay adapters collect those intents without performing external effects. Timer firings and job
outcomes return as captured events.

For each stored event:

1. Global position defines the sole processing order.
2. `logicalAtMs` supplies monotonic processing time.
3. The pure reducer returns state and ordered intent drafts.
4. The processor assigns deterministic output IDs and advances the decision hash chain.
5. State, decisions, jobs, outbox rows, and the checkpoint commit atomically.

See [ADR 0001](docs/adr/0001-deterministic-kernel.md) and
[ADR 0002](docs/adr/0002-storage-and-scaling.md) for the binding design decisions.

## Determinism rules

Reducer code must not access wall time, randomness, environment variables, network, filesystem, or
database state. Persisted values are a strict JSON subset:

- objects, arrays, strings, booleans, null, and safe integers;
- no floating point, negative zero, `undefined`, `Date`, `Map`, `Set`, or sparse arrays;
- monetary and ratio values use scaled integers or decimal strings;
- ordering uses captured positions and explicit stable keys, never locale rules.

Canonical JSON and SHA-256 use explicit domain tags. The run manifest hashes the reducer name,
version, configuration, and canonicalization version.

## Acceptance vector

[`fixtures/earnings-cluster.v1.ndjson`](fixtures/earnings-cluster.v1.ndjson) captures six inputs:
two accepted releases, a domain redelivery, a late release, a timer firing, and a job result.
[`fixtures/earnings-cluster.v1.golden.json`](fixtures/earnings-cluster.v1.golden.json) pins the event,
state, and decision-chain hashes.

The acceptance suite runs the vector through:

- event-at-a-time in-memory live-style processing;
- fresh replay with side effects disabled;
- SQLite processing across a database restart;
- a failed SQLite commit that must leave no outputs or checkpoint behind.

## Runtime data

Do not place a live SQLite database in this OneDrive-synchronized repository. Use a local runtime
directory such as `%LOCALAPPDATA%\peas-engine`. Tests use the operating system's temporary directory.
Commit migrations and fixtures, not database or WAL files.

## Repository layout

```text
fixtures/                   Captured and golden replay vectors
migrations/                 Auditable SQL schema changes
src/core/                   Canonical JSON, hashing, clock, envelopes, processor
src/domain/earnings-cluster Pure domain reducer
src/adapters/memory/        Reference and replay adapters
src/adapters/sqlite/        Durable single-writer adapters
test/                       Acceptance and invariant tests
docs/adr/                   Architecture decision records
```

## Scaling path

SQLite is the first durable single-writer implementation. Read projections can scale independently,
and workers claim jobs/outbox records outside reducer transactions. When write concurrency or
multi-node processing requires it, add a PostgreSQL adapter behind the existing `EventLog` and
`ProcessingStore` interfaces. The event envelope, canonical bytes, output IDs, and replay hashes must
remain unchanged.
