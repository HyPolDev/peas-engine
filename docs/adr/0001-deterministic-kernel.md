# ADR 0001: Deterministic kernel and replay contract

- Status: Accepted
- Date: 2026-07-10

## Context

PEAS must reproduce decisions from captured inputs for debugging, audit, model evaluation, and safe
rule evolution. A separate replay implementation would drift from live behavior.

## Decision

Live-style processing and replay call one `DeterministicProcessor` and one versioned pure reducer.
The reducer receives only immutable JSON state, one stored event, hashed configuration, and the
event's persisted monotonic logical time.

Global event position is the processing order. Source occurrence time remains business data and may
arrive out of order. Wall-clock observation time is captured at ingress, while `logicalAtMs` is
persisted once and cannot regress.

Reducer output drafts are ordered. The processor derives each immutable output ID from run identity,
input event hash, category, ordinal, deduplication key, and canonical body hash. Each run maintains
separate state and decision-chain hashes. The decision chain advances for every event, including
events with no outputs.

Canonical JSON is an RFC 8785-style encoding over PEAS' narrower JSON domain. Numbers must be safe
integers. Financial decimals are strings or scaled integers.

Dispatch is at-least-once for effects whose provider supports an idempotency key. A worker uses the
deterministic job/outbox ID for that key and captures lease acquisition and outcomes as new events.
Lease attempts use monotonically increasing fencing tokens. A run's immutable manifest controls
whether its intents become dispatchable; replay is not protected by an in-memory mode switch.

When an external submission has an unknown outcome, the operational row enters `ambiguous` and is
not retried automatically. Reconciliation must resolve it. This rule is mandatory for brokerage
orders and other non-idempotent financial effects.

## Consequences

- Replaying a captured stream produces the same canonical state and intent transcript.
- Reducers cannot call clocks, random generators, databases, filesystems, or networks.
- Configuration and rule changes require explicit versions and new golden vectors.
- Hash changes expose semantic or serialization drift immediately.
- Stale workers cannot commit results after a lease is reclaimed.
