# Lane A execution log

2026-09-11: Read complete authorization and PM decisions. No applicable AGENTS.md found.
Fresh fetch verified base fc364fff482131473588c7acb9a1b438ef8bdb59,
tree dfdc1c729a3bff7664094af7ce4e7f7b66b563d7; no open PRs.
Sole implementation owner: Lane A; independent reviewer will be assigned at frozen candidate.

## Protocol freeze (before any synthetic evaluation)

`fixtures/alpha-research/protocol.v1.json` freezes H1 continuation/reversal, H2 observed usable
source order with 1-second simultaneity, six horizons, 1-minute delayed entry, per-side
2 bps spread + 3 slippage + 1 fee, zero impact assumption, equal SPY/sector benchmark,
January train / February validation / March 2026 untouched test. Labels crossing the next
partition boundary are purged, including terminal test labels. Every event/horizon/variant
is retained, including missing, excluded, purged and failed high-threshold trials.
Synthetic cohort uses SYN only; stopped and repair events are excluded visibly. No imputation.
Expectations unavailable; LLM disabled. Capacity unknown, no tradability inference.
No parameter changes after results without PM human gate. Numerical fixtures are correctness
oracles, not statistical evidence. Only SYNTHETIC_VALIDATION / NO_TRADE permitted.

No provider, credential, financial, live-controller or merge authority. No recurring jobs.
