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

Reducer output drafts are ordered. The processor derives each immutable output ID from reducer
identity, input event hash, category, ordinal, and canonical body hash. It maintains separate state
and decision-chain hashes. The decision chain advances for every event, including events with no
outputs.

Canonical JSON is an RFC 8785-style encoding over PEAS' narrower JSON domain. Numbers must be safe
integers. Financial decimals are strings or scaled integers.

External effects are at-least-once. A worker uses the deterministic job/outbox ID as the provider
idempotency key and captures outcomes as new events. Replay never dispatches effects.

## Consequences

- Replaying a captured stream produces the same canonical state and intent transcript.
- Reducers cannot call clocks, random generators, databases, filesystems, or networks.
- Configuration and rule changes require explicit versions and new golden vectors.
- Hash changes expose semantic or serialization drift immediately.
