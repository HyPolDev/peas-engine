# PEAS Engine

PEAS Engine is an auditable deterministic event-processing kernel. A captured event stream run
through the same versioned behavior produces the same aggregate checkpoints, immutable intent
ledger, state-chain head, and decision-chain head in live-style processing and replay.

This repository intentionally stops at the kernel boundary. HTTP ingestion, Express APIs,
market-data providers, analysis workers, and brokerage integrations belong in adapters and vertical
slices built on these contracts.

## Release status

[`v0.2.0-kernel-rc.2`](https://github.com/HyPolDev/peas-engine/releases/tag/v0.2.0-kernel-rc.2)
at `fe04e32f9b218b41b1c56bffd2a131fb32192f82` is the immutable Kernel V2 prerelease. Its
Windows, Linux, 10k, and 100k gates passed on the same candidate SHA; the release and all three
evidence assets verify successfully, so the effective decision is `GO` for read-only adapter and
vertical-slice work.

The provider-neutral artifact vault was subsequently merged in
[#2](https://github.com/HyPolDev/peas-engine/pull/2) at main commit
`e350210a3c8d8f0bd3ae512dde9461fcfb58d0b4`. Provider normalizers and live clients are not yet
implemented. The next reviewable unit is PR 2B: the recorded SEC end-to-end slice.

## Requirements

- Node.js 24.17.0, pinned by `.node-version`
- npm 12, pinned by `packageManager`
- Git

On Windows PowerShell, use `npm.cmd` if script execution policy blocks the `npm.ps1` shim.

```powershell
npm.cmd ci
npm.cmd run check
```

`npm run check` verifies formatting, lint rules, strict types, replay equivalence, coverage floors,
targeted mutation kills, relational tamper detection, run isolation, migration atomicity, lease
fencing, poison-event quarantine, multi-process concurrency, hard-crash recovery, and scale budgets.

## Kernel flow

```text
untrusted provider data
        |
        v
trusted capture boundary --> append-only hash-chained event log
                                      |
                                      v
                           deterministic processor
                                      |
                         +------------+-------------+
                         |                          |
                         v                          v
             bounded aggregate checkpoint   immutable output ledger
                                                    |
                                  effects-allowed run only
                                                    |
                                                    v
                                         fenced jobs / outbox
```

Live-style processing and replay use the same processor and reducer. The difference is data: every
run has an immutable manifest and only a manifest with `effectsAllowed: true` can create
dispatchable operational rows. Replay, shadow, and research runs still retain their complete intent
transcripts without performing external effects.

For every stored event, the processor:

1. strict-schema-validates the durable envelope, verifies its identity, content hash, hash-chain
   link, and exact stored bytes;
2. routes it to one stable aggregate and validates the checkpoint schema and hash;
3. invokes the pure reducer using persisted logical time and manifest-bound configuration;
4. derives run-scoped deterministic output IDs and advances state and decision hash chains;
5. commits the event cursor, aggregate checkpoint, and ordered immutable outputs atomically.

## Audit invariants

- Ingress assigns local event IDs, stream versions, receipt times, positions, and chain hashes.
  Provider payloads cannot choose them.
- Provider identity is `(provider, recordId, revisionId, artifactHash)`. Exact redelivery returns the
  original event; an artifact conflict for the same provider revision fails closed.
- Event, cursor, checkpoint, manifest, and output hashes are recomputed when read or committed.
- Already-processed events are verified against their persisted bytes, predecessor, and contiguous
  chain through the current cursor head before the processor permits an idempotent no-op.
- Ports are asynchronous and paged. No kernel contract requires loading the full log or all
  aggregates.
- Aggregate state is bounded by configured source, branch, result, and payload limits.
- Earnings aggregates have non-configurable audit ceilings of 32 sources, 32 branches, and 32
  frozen inputs per branch, preventing a 1,000-by-1,000 quadratic state shape.
- A source rejected at either capacity ceiling emits an audit decision while leaving aggregate
  state byte-identical.
- Malformed recognized events and stale worker results become deterministic rejection records and
  advance the cursor; integrity failures stop processing.
- Jobs and outbox messages are immutable intents. Only lease owner, expiry, attempt, fencing token,
  status, and error are mutable operational state.
- Workers must capture lease acquisition before publishing a result. Reducers accept a result only
  for the exact expected job, branch, input bundle, attempt, fencing token, artifact set, and
  manifest-bound analysis contract. The branch freezes its input events and artifacts when emitted;
  later sources cannot alter them.
- An ambiguous external effect is terminal until reconciliation. Brokerage/order adapters must
  never automatically retry an ambiguous submission.
- Applied SQL migrations are ordered and checksummed. Editing an applied migration is rejected.

Reducer code must not access wall time, randomness, environment variables, network, filesystem, or
database state. Persisted values use the strict PEAS JSON domain: objects, arrays, strings, booleans,
null, and safe integers. Floating point, negative zero, `undefined`, `Date`, `Map`, `Set`, and sparse
arrays are rejected. Financial decimals use decimal strings or explicitly scaled integers.

## Acceptance vector

[`fixtures/earnings-cluster.v2.captured.ndjson`](fixtures/earnings-cluster.v2.captured.ndjson) is the
checked-in 13-event capture. It includes source mirroring, malformed input, independent debounce and
lifecycle timers, two analysis phases, lease reclaim, a stale fenced result, finalization, and a
late filing. [`fixtures/earnings-cluster.v2.golden.json`](fixtures/earnings-cluster.v2.golden.json)
pins the event, state, and decision-chain heads plus bounded-state and rejection counts.

The acceptance suite compares event-at-a-time live-style processing with a fresh replay reading two
events at a time. Their complete audited snapshots must be byte-identical. The earlier V1 fixtures
remain only as historical prototype evidence and are not the binding V2 contract.

## Runtime data

Do not place a live SQLite database in this OneDrive-synchronized repository. Use a local runtime
directory such as `%LOCALAPPDATA%\peas-engine`. Tests use the operating system temporary directory.
Commit migrations and fixtures, not database, WAL, or shared-memory files.

`001_kernel_contracts_v2.sql` is a clean V2 baseline, not an in-place upgrade from the prototype
schema. Archive any V1 database as evidence and create a new V2 database. A production migration
must receive a new ordered migration number; an applied file must never be replaced.

## Repository layout

```text
fixtures/                   Captured streams and golden audit vectors
migrations/                 Ordered, checksummed SQL migrations
scripts/                    Safe repository maintenance scripts
src/core/                   JSON, hashes, envelopes, manifests, processor ports
src/domain/earnings-cluster Bounded, versioned earnings reducer
src/adapters/memory/        Reference capture, replay, and processing stores
src/adapters/sqlite/        Durable single-writer adapters and fenced delivery
test/                       Acceptance, adversarial, and scale tests
docs/adr/                   Binding architecture decisions
```

SQLite is the first durable single-writer implementation. Read projections and effect workers scale
independently. When multi-node processing requires more write concurrency, a PostgreSQL adapter can
implement the existing asynchronous ports, but it must preserve envelope bytes, run manifests,
transaction boundaries, output identities, fencing behavior, and replay hashes.

The SQLite adapter uses synchronous `better-sqlite3` calls despite the asynchronous port shape. A
live deployment therefore requires a dedicated single writer, bounded batches, a bounded queue,
and backpressure. The sparse 100k gate is durability evidence, not proof of dense or end-to-end
pipeline capacity. `snapshot()` intentionally materializes a complete audit and is not the
production large-run read API. Because immutable output storage grows approximately with
`events x retained runs`, large research sweeps require database rotation, verified archives, and a
retention policy.

See [ADR 0001](docs/adr/0001-deterministic-kernel.md),
[ADR 0002](docs/adr/0002-storage-and-scaling.md), and
[ADR 0003](docs/adr/0003-kernel-contracts-v2.md), plus the corrective decisions in
[ADR 0004](docs/adr/0004-analysis-and-effect-integrity.md) and the same-commit release contract in
[ADR 0005](docs/adr/0005-release-evidence-identity.md). The next implementation phase is
defined—but still audit-gated—in the
[read-only vertical-slice plan](docs/read-only-vertical-slice-plan.md).

The superseded PEAD Engine baseline and its limitations are recorded in the
[V1 archival record](docs/archive/pead-engine-v1.md).
