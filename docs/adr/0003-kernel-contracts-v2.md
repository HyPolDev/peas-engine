# ADR 0003: Kernel Contracts V2 audit boundary

- Status: Accepted
- Date: 2026-07-10
- Amended: 2026-07-11 (RC.1 and RC.2 audit boundaries)

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

Because `EventDraft` is untrusted, provider normalization is not authorized until a versioned
resource boundary limits total UTF-8 bytes, structural depth and nodes, arrays, object keys, and
individual strings/keys before recursive canonicalization. The boundary is an exact inert-JSON
own-property contract: accessors, non-enumerable properties, symbol properties, `__proto__`,
Proxies, sparse arrays, and unsupported array properties are rejected. Schema parsing also fails
closed if inherited `Object.prototype` fields or indexed `Array.prototype` fields could influence
the result. Serialized UTF-8 bytes are bounded before `JSON.parse`; object-key counts are bounded
before sorting; and raw reducer state is iteratively bounded before `parseState` or recursive
canonicalization. This contract is a binding precondition for every provider normalizer in PR 2B.

Every processing invocation belongs to an immutable run manifest. It binds run kind, effect policy,
reducer and build identities, schema registry digest, canonicalization version, configuration,
feature set, and optional model, prompt, and dataset identities. Checkpoints and outputs are
run-scoped. Effect eligibility is enforced by persisted run data.

Core storage ports are asynchronous and paged. The processor loads one verified aggregate
checkpoint per event. The earnings reducer routes by stable issuer CIK and fiscal period and caps
source records, analysis branches, results, and stored result size. It models first-source,
confirmation, call, and incremental-filing phases separately; mirror debounce does not close the
overall lifecycle.

Every processing write is admitted through strict runtime schemas for `ProcessingCommit`,
`RunCursor`, `AggregateCheckpoint`, and the category-discriminated output envelopes. Unknown or
active fields are rejected. Validation produces one detached canonical snapshot, and that exact
snapshot is used for transition verification and persistence; adapters must not reread the caller's
object. Aggregate IDs are 1--512 characters from the portable ASCII alphabet
`[A-Za-z0-9._:-]`, which makes memory and SQLite `BINARY` pagination order agree. Operational
dedupe identity is the domain-separated hash of the canonical tuple `(runId, category, dedupeKey)`,
not a delimiter-joined string.

Both memory and SQLite stores validate and hash-verify the exact stored event before advancing a
cursor. The same category-specific stored-output validator is used at commit, audit-read, and claim
boundaries: decisions require only their strict decision body, jobs require the derived job ID,
type, payload, input-bundle hash, dedupe key, and schedule, and outbox messages require their
derived message ID, topic, payload, and dedupe key. SQLite claims additionally filter by immutable
output category and use the dispatch index; delivery rows are guarded so `jobs` can reference only
job outputs and `outbox` only outbox outputs.

Migration 004 preflights every historical processing output, aggregate identifier, ordinal/category
ordering rule, and delivery-table category reference before installing the category guards or
recording the migration. Any invalid historical row aborts the complete migration transaction.
Persisted aggregate state must be canonically encoded, and all serialized persisted JSON is byte
bounded before parsing.

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

The `ambiguous` state is not by itself authorization for financial effects: a worker can crash after
an external submission but before recording ambiguity. A future financial-effect contract must
durably record `submission-started` before the external call, use broker idempotency where
available, reconcile every uncertain outcome before retry, and enforce an explicit effect-type
allowlist. No current kernel or read-only vertical-slice decision authorizes those effects.

## Acceptance criteria

- The same captured stream produces an identical complete snapshot in event-at-a-time live-style
  processing and paged replay.
- Checked-in event, state, and decision heads detect behavioral drift.
- Tampered events, checkpoints, outputs, and migration history fail closed.
- Active, hidden, inherited, unknown, and category-invalid JSON cannot alter the verified transcript
  or become dispatchable work; memory and SQLite reject the same malformed stored events.
- Replay and shadow runs create no dispatchable rows.
- Malformed events and stale worker results do not wedge the stream.
- Dense 32-source, 300-cluster memory, 1k/10k SQLite, poison-flood, concurrency, and crash/restart
  gates pass; a scheduled 100k SQLite run records regression evidence only, while release evidence
  requires the explicit manual trigger defined in ADR 0005.
- CI runs the complete check on Linux and Windows with exact Node 24.17.0 and npm 12.0.0 runtime
  assertions.
- The targeted mutation gate kills all 14 boundary mutants, including strict shape, inert
  own-property, stored-event parity, category-specific output, upgrade preflight, canonical-state,
  portable-identifier, canonical-dedupe-tuple, and serialized-byte-preflight mutations.

## Consequences

- Adapter and vertical-slice work can rely on explicit audit contracts rather than conventions.
- Behavior changes require a manifest identity/version change and reviewed golden-vector updates.
- Operational delivery remains independently scalable without entering deterministic state.
- V1 fixtures remain historical evidence; V2 fixtures and migrations are the binding baseline.
- RC.1 remains immutable historical evidence with a post-audit `CONDITIONAL GO`; only a separately
  gated RC.2 published and verified as an immutable GitHub release under ADR 0005 can freeze these
  contracts.
- The second RC.2 audit assigned `NO-GO`. These amended contracts describe the required correction,
  not a release approval: RC.2 remains `NO-GO` until the clean local gate, 14/14 mutation gate, and
  exact-SHA remote evidence pass. It may then be recorded as `CONDITIONAL GO` only while immutable
  publication and verification remain outstanding.
