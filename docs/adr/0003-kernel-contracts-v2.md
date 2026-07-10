# ADR 0003: Kernel Contracts V2 audit boundary

- Status: Accepted
- Date: 2026-07-10

## Context

The first deterministic prototype proved live/replay equivalence but left several production audit
boundaries implicit: who assigns event identity, how runs are isolated, how much history a port may
load, how poison events progress, how analysis results bind to inputs, and how stale effect workers
are fenced.

## Decision

Adopt Kernel Contracts V2 before building a vertical slice.

The trusted capture adapter receives an untrusted `EventDraft` and assigns all local identity and
ordering fields. The stored envelope is hash chained. Exact provider redelivery returns the original
event, while conflicting content for the same provider revision fails closed.

Every processing invocation belongs to an immutable run manifest. It binds run kind, effect policy,
reducer and build identities, schema registry digest, canonicalization version, configuration,
feature set, and optional model, prompt, and dataset identities. Checkpoints and outputs are
run-scoped. Effect eligibility is enforced by persisted run data.

Core storage ports are asynchronous and paged. The processor loads one verified aggregate
checkpoint per event. The earnings reducer routes by stable issuer CIK and fiscal period and caps
source records, analysis branches, results, and stored result size. It models first-source,
confirmation, call, and incremental-filing phases separately; mirror debounce does not close the
overall lifecycle.

Recognized events with invalid domain payloads are quarantined through deterministic rejection
outputs and advance the cursor. Envelope, chain, cursor, checkpoint, or output corruption is an
integrity failure and stops processing.

Analysis results bind to the emitted job ID, branch ID, input-bundle hash, artifact set, extractor,
feature set, prompt, model, dataset, lease attempt, and fencing token. Lease acquisition itself is a
captured event. A later lease supersedes earlier attempts, so stale completion is rejected without
blocking subsequent events.

Jobs and outbox messages are immutable intent ledger rows plus mutable delivery state. Operational
delivery supports claim, lease renewal, reclaim, fencing, terminal success/failure, and an
`ambiguous` terminal state. An ambiguous financial effect requires reconciliation and must not be
automatically retried.

## Acceptance criteria

- The same captured stream produces an identical complete snapshot in event-at-a-time live-style
  processing and paged replay.
- Checked-in event, state, and decision heads detect behavioral drift.
- Tampered events, checkpoints, outputs, and migration history fail closed.
- Replay and shadow runs create no dispatchable rows.
- Malformed events and stale worker results do not wedge the stream.
- Dense 32-source, 300-cluster memory, 1k/10k SQLite, poison-flood, concurrency, and crash/restart
  gates pass; a scheduled 100k SQLite run records long-horizon scaling evidence.
- CI runs the complete check on Linux and Windows with exact Node 24.17.0 and npm 12.0.0 runtime
  assertions.

## Consequences

- Adapter and vertical-slice work can rely on explicit audit contracts rather than conventions.
- Behavior changes require a manifest identity/version change and reviewed golden-vector updates.
- Operational delivery remains independently scalable without entering deterministic state.
- V1 fixtures remain historical evidence; V2 fixtures and migrations are the binding baseline.
