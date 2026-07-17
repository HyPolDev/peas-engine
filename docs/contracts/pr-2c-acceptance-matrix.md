# PR 2C acceptance-test matrix

| Area | Required proof | Planned test owner |
| --- | --- | --- |
| FMP latest/search | Same selected synthetic item on both acquisition variants has one record/revision identity | FMP fixture agent |
| FMP order/page | Item/object order, declared page size, and replay page size do not change canonical item output | FMP fixture agent |
| FMP corrections | Same record tuple plus changed semantic title/body has a new deterministic revision | FMP fixture agent |
| FMP time | Explicit offset converts; naive/null remains null/unknown; malformed offset quarantines | FMP fixture agent |
| FMP malformed/bounds | JSON syntax, duplicate key, shape, encoding, and every exact/one-over bound fail with stable reasons | FMP fixture agent |
| NVIDIA feed/item | Synthetic RSS selection and HTML canonical key produce one detached candidate | NVIDIA fixture agent |
| NVIDIA duplicates | Identical duplicate item collapses; conflicting duplicate item quarantines independent of order | NVIDIA fixture agent |
| NVIDIA revisions | Same non-URL family plus changed retained projection yields a new revision; intra-feed conflict quarantines | NVIDIA fixture agent |
| NVIDIA time | Item GMT time converts; channel/mod/page/retrieval times never substitute missing item time | NVIDIA fixture agent |
| NVIDIA links | Every GUID/permalink/link/canonical/og/query/fragment/host/port/userinfo permutation follows the exact selection-key policy; no link is followed | NVIDIA fixture agent |
| URL/comment-only raw change | Semantic projection, revision, candidate, EventDraft, and evidence-bundle identity stay equal while raw provenance may differ | Both fixture agents |
| NVIDIA malformed/bounds | XML DTD/entity/syntax, HTML/canonical, encoding, and every exact/one-over bound have stable reasons | NVIDIA fixture agent |
| Projection proof | Selected projection independently recomputes from verified parent artifact; sibling/order changes are non-semantic | Both fixture agents |
| Fixture safety | Paths remain inside root; all bodies are synthetic; no secrets, live URLs, copied bodies, or network access | Both fixture agents |
| SEC/FMP/IR permutations | Every arrival order is accepted as captured business order and fixture presentation order is irrelevant | Cross-source agent |
| SEC/V1 equal digest | SEC V2 non-null bundle versus FMP/IR V1 null bundle retains both sources and emits debounce/join, never exact mirror-duplicate | Cross-source agent |
| V1 identical mirrors | FMP/IR V1 with equal semantic primary digest and both null bundle hashes may emit mirror-duplicate while preserving provider provenance | Cross-source agent |
| Byte-different mirrors | Independent sources stay distinct; same-provider correction has new revision identity | Cross-source agent |
| Redelivery/conflict | Exact redelivery is idempotent; same provider record/revision with changed content fails closed | Cross-source agent |
| Active lease | A later mirror may create a new branch but cannot mutate or invalidate the leased branch/input bundle | Cross-source agent |
| Replay | Same captured stream has byte-identical canonical snapshots across page sizes and memory/SQLite where exercised | Cross-source agent |
| Effects | Replay/shadow/research/paper create zero dispatchable rows; no HTTP or financial-effect surface exists | Cross-source/final audit |
| Telemetry identities | Acquisition, raw evidence, projection, record/version, normalized observation, and capture identities are acyclic and distinct | Contract tests |
| Telemetry clocks | Closed facts, basis iff rules, nullability, monotonic scope/regression, selection as-of, graph/page/total exact and one-over bounds are exact | Contract tests |
| Telemetry transitions | Every fact-parent transition, failure cutoff, entry-ID vector, bundle-byte bound, missing/cycle/cross-execution parent, and clock cartesian case is executable | Contract tests |
| Frozen compatibility | No EventDraft/EventLog/ProcessingStore/ArtifactStore signature or migration changes | Contract/final audits |

The implementation wave may add cases but cannot remove or weaken a row. A case without executable
coverage requires explicit review evidence and cannot be silently marked complete.
