# ADR 0004: Immutable analysis inputs and defense-in-depth effect isolation

- Status: Accepted
- Date: 2026-07-10

## Context

Dynamic adversarial review found that an analysis completion was checked against the cluster's
current sources instead of the branch's point-in-time inputs, provenance fields were recorded but
not manifest-enforced, and a caller could combine a non-live run kind with `effectsAllowed: true`.
The review also found relational audit gaps and migration-plan rejection that could leave committed
DDL.

## Decision

Each analysis branch persists its exact selected input event IDs, event hashes, positions, source
kinds, and artifact hashes. It also persists an analysis contract containing extractor version,
feature-set ID, prompt ID, model ID, and dataset ID, plus a hash of that contract. The job carries the
same inputs and contract. Completion must match every component, the contract hash, the input-bundle
hash, the lease attempt, and the fencing token. Later cluster arrivals may create a new branch but
cannot modify or invalidate an existing branch.

Only a `live` run may set `effectsAllowed: true`. The processor, both processing stores, SQLite
schema constraint, and claim query independently enforce that matrix. Live runs may still disable
effects. Replay, shadow, research, and paper runs can never create or claim dispatchable rows.

SQLite event reads reconcile every duplicated event column with canonical `event_json`. Output rows
carry an envelope hash over sequence, output ID, run, input event, aggregate, category, ordinal,
dedupe key, schedule, and body hash. Audit reads and claims recompute and reconcile the envelope.
Claim eligibility is derived from the immutable job body so corrupting the relational schedule can
neither accelerate nor suppress work silently.

Migration plans must be contiguous from version 1. The complete applied prefix is validated before
new DDL, and the plan, ledger inserts, and final verification run in one `IMMEDIATE` transaction.

Every supplied event is strict-schema-validated and hash-verified before processor position
handling. An older or duplicate event must match the exact persisted bytes, its predecessor, and a
verified contiguous suffix ending at the persisted cursor hash before it can return the prior cursor
as an idempotent no-op. A locally self-consistent rewrite of an older row therefore cannot hide a
broken successor link.

The earnings reducer has hard, non-configurable audit ceilings of 32 source observations, 32
analysis branches, and 32 frozen inputs/provenance entries per branch. Reducer behavior version
2.2.0 binds these ceilings into replay identity and prevents the schema's formerly possible
quadratic 1,000-source/1,000-branch state.
Capacity rejection emits an immutable decision but leaves the aggregate state byte-identical; the
rejected event cannot consume source or branch capacity or alter an audit counter.

## Verification contract

- A leased branch accepts its frozen A-only result after source B arrives.
- Each analysis-contract field and its hash is independently mutated and rejected.
- All five run kinds are tested with both effect values in memory, SQLite, and SQL constraints.
- Every event/output relational column is tampered and detected without relying on immutability
  triggers.
- Divergent and syntactically broken migration plans leave schema and ledger byte-identical.
- Fast-check covers event order, redelivery, revisions, Unicode, timers, and lease sequences.
- Targeted mutations of effects, chain verification, transactionality, caps, and fencing are killed.
- Multi-process contention and SIGKILL rollback probes converge after restart and pass
  `PRAGMA integrity_check`.
- Tampered, malformed-but-self-rehashed, and self-consistent-but-unpersisted older envelopes are
  rejected before idempotent return.
- A rewritten older SQLite row is rejected when its unchanged successor no longer links to it.
- Configuration, persisted state, and transitions cannot exceed the 32-source/32-branch ceilings;
  the 33rd source leaves state byte-identical.

## Consequences

Analysis results are point-in-time claims, not statements about a mutable cluster. Effect safety no
longer depends on a caller-supplied boolean or one adapter. Relational columns remain queryable for
performance while their audit equivalence is independently verifiable.
