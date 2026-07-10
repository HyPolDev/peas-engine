# PEAD Engine V1 archival record

- Historical repository: `HyPolDev/PEAD_Engine`
- Local inspection path: `G:\Programación\PEAD_ENGINE`
- Committed V1 baseline: `d0baf09f3a22c6b60f65a5e22a50c3fb22378059`
- Commit date: 2026-07-04T15:18:02+02:00
- Commit subject: `implemented backtest data`
- Published archival ref: annotated tag `archive/kernel-v1`
- Support status: historical evidence only; unsupported and superseded

## Archival boundary

The inspected V1 worktree contained 13 modified and 107 untracked paths. The commit SHA above
identifies only the committed baseline and intentionally excludes those unreviewed working-tree
files. The annotated tag was created at the exact committed SHA and pushed to the V1 origin without
staging, changing, or cleaning any of those local paths. The dirty files remain outside the archival
boundary and would require a separate reviewed snapshot if they are ever to become evidence.

## Why V1 was superseded

- Live SEC, FMP, and model calls run inline without a captured deterministic replay contract.
- File-based seen-ID deduplication is bounded and lossy; corruption falls back to an empty cache.
- Event-emitter persistence is not awaited before an item is marked seen, so failed persistence can
  permanently suppress work.
- There is no immutable hash-chained event ledger, logical clock, run manifest, state head, or
  decision head.
- Analysis inputs and extractor/feature/prompt/model/dataset identities are not frozen into a
  point-in-time contract.
- Paper-broker and portfolio state mutate directly using wall time, without run-scoped effect
  isolation, immutable intents, fencing, or ambiguous-effect reconciliation.
- Persistence uses mutable application tables without checkpoint/output integrity hashes or a
  checksummed migration ledger.
- Raw provider response bytes are processed in memory rather than retained as immutable,
  hash-verified artifacts.
- Runtime versions and CI are not pinned in the committed baseline.

## V2 replacement map

- ADR 0001 replaces live-coupled processing with deterministic live/replay semantics, persisted
  logical time, canonical hashes, and immutable intent rules.
- ADR 0002 replaces mutable persistence conventions with transactional event/checkpoint/output
  durability, checksummed migrations, and fenced delivery.
- ADR 0003 defines trusted ingress, immutable run manifests, bounded state, poison-event progress,
  and explicit scaling/effect boundaries.
- ADR 0004 freezes analysis inputs and provenance, enforces the run/effect matrix, reconciles SQL
  relational columns, and makes migration rejection atomic.
- ADR 0005 binds every release result and golden/metrics artifact to one reconciled commit SHA.
- The raw-artifact guarantee is intentionally assigned to the separate PR 2A artifact-vault
  foundation.
