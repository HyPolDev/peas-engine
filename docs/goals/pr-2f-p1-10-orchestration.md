# PR 2F P1-10 historical SIP acquisition implementation orchestration

## Checkpoint and authority

This is the stacked, offline implementation wave authorized after the final external contract
review returned `CONTRACT_GO` for the immutable amended PR 2E candidate and its merge was verified:

```text
acceptedPreAmendmentSha = 038fb381963cd822d2e7f81e55d45d26f1d2c9e5
acceptedPreAmendmentTree = d6fb3258c29c5b97f5cf7edab6d74c0d80386c16
acceptedPr2eCandidateSha = f16ea4fcec1eda1126e9a3e446c77b76ddf15678
acceptedPr2eTree = f2fb2b35adb0a22265eaefc2dc6309fa2e4fb3b7
mergedPr2eCommit = bda45d8ef8f97c35dec614f79e5e3ca81a7bfe93
implementationBranch = dev/pr-2f-p1-10-historical-sip-acquisition
implementationOriginalBase = 038fb381963cd822d2e7f81e55d45d26f1d2c9e5
mergedAuthorityIntegrationCommit = 420b40a65dd2cec45e8bbeff726b800c8d9b0e5e
```

The human owner separately authorized exactly the retention architecture in
`docs/contracts/pr-2e-p1-10-credential-privacy-retention.md` sections 9–11. That authorization
covers the internal `ArtifactRetentionController`, additive append-only retention state,
runtime-root-confined physical erasure, tombstone/use-denial-aware vault behavior, the frozen
retention state sequence, restart/idempotence/shared-digest behavior, and offline
memory/SQLite/platform evidence.

It does not authorize a provider request or witness, credential/account inspection, FMP
transport, paid capability, spending, subscription/account mutation, broker or other financial
effect, P2 collection, event-study outcomes, policy changes, merge, or alteration of the accepted
PR 2E candidate.

## Immutable accepted surfaces

All accepted PR 2E contract, fixture, executable-model, and audit bytes are read-only in PR 2F,
including:

- `docs/contracts/pr-2e-p1-10-*.md`;
- `fixtures/market-acquisition/v1/**`;
- `test/p1-10-contract.test.ts`;
- `docs/audit/pr-2e-p1-10-*.md`; and
- the accepted PR 2D and P1-09 authority chain.

Every integration checkpoint must prove these paths have zero diff from merged PR 2E commit
`bda45d8ef8f97c35dec614f79e5e3ca81a7bfe93`. A required change to any accepted byte is a stop
condition and requires a new contract-amendment review and renewed authorization.

## Exclusive implementation ownership

| Lane                                | Exclusive production ownership                                                                                                                                                                                                                                                                 | Exclusive test ownership                                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — runtime/configuration/identity  | `src/adapters/market-acquisition/contracts.ts`, `configuration.ts`, `identity.ts`                                                                                                                                                                                                              | `test/p1-10-configuration.test.ts`                                                                                                                               |
| B — state/retry/quota/journal       | `state-machine.ts`, `retry.ts`, `quota.ts`, `journal.ts`                                                                                                                                                                                                                                       | `test/p1-10-state-machine.test.ts`                                                                                                                               |
| C — credentials/redaction/retention | `credentials.ts`, `redaction.ts`, `private-artifact-policy.ts`, `retention/**`, `migrations/006_market_acquisition_retention.sql`; retention-only hooks in `src/adapters/artifacts/durable-artifact-store.ts`, `sqlite-artifact-repository.ts`, `trusted-filesystem.ts`, and `runtime-root.ts` | `test/p1-10-credential-privacy.test.ts`, `test/p1-10-retention.test.ts`, new `test/fixtures/p1-10-retention-*` helpers, and new retention-only hard-kill scripts |
| D — Alpaca adapter                  | `src/adapters/market-acquisition/alpaca/**`                                                                                                                                                                                                                                                    | `test/p1-10-alpaca-adapter.test.ts`                                                                                                                              |
| E — artifact/ledger/restart/replay  | `artifact-integration.ts`, `replay.ts`, `memory-journal.ts`, `sqlite-journal.ts`                                                                                                                                                                                                               | `test/p1-10-artifact-replay.test.ts`, `test/p1-10-persistence-equivalence.test.ts`                                                                               |

No FMP production file may be added.

## Coordinator-only shared surfaces

The coordinator alone may edit:

- `docs/goals/pr-2f-p1-10-orchestration.md`;
- `docs/project-roadmap.md`;
- `docs/project-board.json`;
- `src/adapters/market-acquisition/index.ts`;
- `package.json` and existing CI/release-evidence workflows, only if required for offline
  validation and without adding secrets or network jobs; and
- draft PR metadata.

No other shared export or integration file is authorized without first recording it here. Agents
must not edit another lane's files.

## Implementation sequence

1. Freeze exact contracts, value objects, identity derivations, configuration parsing, safe
   errors, and zero-call preflight.
2. Implement the deterministic state/retry/quota/journal core and both durable journal backends.
3. Implement credentials, recursive safe projection, private-artifact policy, and the separately
   authorized retention controller/migration.
4. Implement the Alpaca-only historical multi-symbol adapter behind an injected transport. Live
   acquisition remains disabled by default; offline tests use deterministic doubles and a global
   network witness.
5. Integrate private artifact capture, ADR-0009 ledger ordering, restart, replay, accepted PR 2D
   normalization, and deterministic selection.
6. Run focused tests, complete offline `npm run check`, exact-candidate verification, Linux and
   Windows CI, and `PEAS_SCALE_10K=1 npm run test:scale`.
7. Freeze one clean implementation candidate SHA and stop for a fresh independent implementation
   audit. Do not self-authorize completion or merge.

## Pre-freeze implementation checkpoint

The authorized offline implementation is complete against merged PR 2E commit
`bda45d8ef8f97c35dec614f79e5e3ca81a7bfe93`. It includes the deterministic production wire
boundary, artifact/ledger/replay integration, memory and SQLite persistence, and the previously
authorized retention architecture. Original-synthetic tests cover direct and integrated wire
admission, canonical early terminal-update handling, hostile later values, restart/every-prefix
equivalence, and deterministic replay. Focused and complete pre-freeze offline gates are green,
including format, lint, typecheck, build, tests, coverage, mutation, hard-kill, reconciliation,
memory/SQLite evidence, and scale 10k. Candidate freeze, clean exact-SHA reruns, hosted
Ubuntu/Windows/scale evidence, and independent detached audit remain pending.

## Mandatory stop conditions

Stop before proceeding if implementation would require changing an accepted PR 2E byte, a provider
capability is not frozen, cost or entitlement is unknown, trusted request time is unprovable,
pagination completeness is unprovable, a provider/credential/account access is proposed, a
provider byte or raw token would enter Git/public evidence, retention erasure cannot stay beneath
the accepted runtime root, active resources cannot settle, or any work crosses into FMP transport,
financial effects, P2, outcomes, witness execution, or merge.
