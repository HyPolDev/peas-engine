# Alpha Research MVP implementation contract

Base: fc364fff482131473588c7acb9a1b438ef8bdb59 (PR #18 merged).
Protocol was committed at 6d47226 before synthetic evaluation. The JSON protocol is authoritative
for numerical defaults; formatting-only edits do not change its parsed identity.

## Reproduce provider-free

Use the pinned Node 24.17.0 / npm 12.0.0 environment:

```text
npm ci
npm run build:test
node --test dist/test/alpha-research.test.js
npm run check
```

`freezeResearchInput` exports one explicit stored `event-cluster.snapshot` with its EventPlan
revision, state digest, member artifacts, original normalized stored events and availability
clocks. `verifyResearchArtifacts` optionally verifies retained local ArtifactStore bytes. It
never acquires or rewrites original evidence. `freezeManifest` binds the full cohort and versioned
synthetic market dataset, all variants, partitions, exclusions and assumptions. The research
registry durably registers this manifest before `run` exposes results; its epoch cannot be changed.
A pure `evaluateManifest` also supports deterministic correctness oracles and replay.

Research decimal values use a reserved `$researchDecimal` canonical JSON tag; signed zero
canonicalizes to zero and other finite numbers round trip exactly under the pinned JavaScript
runtime. The kernel's integer-only JSON contract is
unchanged. Provider/market identities use existing contracts; the market input is an explicitly
synthetic completed-minute-bar projection, not an authorized historical-provider loader.

## Information and evaluation boundaries

Publication/SEC acceptance, first observation, retrieval, normalization capture and feature-ready
clocks must all be present and at or before cutoff. Forged normalization capture times reject.
Post-cutoff or missing dependencies remain unavailable, never filled from later observations.
The existing SEC Eastern civil-time parser retains New York DST semantics. Market feature bars
require both completed-bar time and availability by cutoff. Outcome bars stay in labels, and
perturbing future prices cannot alter feature values. Snapshot completion/status is retained for
cohort accounting; it is not used as a predictive feature.

H1 follows/opposes the sign of initial equal-SPY/sector-relative reaction. H2 uses the first usable
SEC versus issuer-IR observation (maximum of observation/retrieval/readiness), with the frozen
1-second simultaneity interval; simultaneous or missing sources fail visibly. H2 is a deliberately
simple source-order baseline, not a claim that source order causes a price response. All parameter
variants are evaluated as predeclared; there is no selection/tuning against untouched data.

Partitions are half-open chronological intervals. A duplicate issuer/fiscal-period event rejects,
including changed snapshots/decisions. Labels touching the next partition boundary are purged;
feature windows crossing the partition start are also purged. Out-of-universe, repair, stopped,
missing and failed trials remain in denominators. Each signal preserves its horizon and partition.

Entry uses the completed minute close at or after the 60-second delay, with exact endpoints only.
No stale/nearest-bar substitution occurs. Both directions pay 12 bps round trip: per side 2 spread,
3 slippage, 1 fee, 0 impact. The zero impact assumption is synthetic only. Gross, benchmark,
abnormal and cost-adjusted returns remain inspectable. One-minute closes are coarse reference
prices, not executable quotes. Intrahorizon high/low excursions, liquidity, volatility, actual
spread, capacity and statistical uncertainty are unavailable in this MVP; no claim is inferred.

Expectations are explicitly unavailable and LLM features disabled. Their placeholder binds cutoff
and versions with provider/model/prompt/schema/decoding/input/output slots. Any future extractor
requires separate authorization, frozen outputs and an incremental untouched comparison with the
simple baseline before adoption. No API is wired.

## Durability and scope

Dedicated `migrations/research/001_alpha_research.sql` adds immutable manifest and append-only
record tables using the existing SQLite runner. Open a separate research database with
`loadMigrations("migrations/research")`; the ten operational migrations and credential gates remain
unchanged. Attempts start durably before evaluation; outputs and terminal success append in
one transaction. Failed attempts append a stable reason. An interrupted start remains visible;
resume appends a new attempt. Completed runs are idempotent and replay verifies every record.
SQLite rows include features, labels, all trials, signals, attempt starts/ends and full result.
Raw SQLite connections remain trusted local administrative capabilities, consistent with existing
repository storage. The registry is not a security boundary against a database administrator.

Synthetic outputs are hard-coded SYNTHETIC_VALIDATION / NO_TRADE, with zero prohibited effects.
No alpha-claim promotion, dispatch, credential access, provider call, LLM call or financial effect
is exposed. This proves implementation correctness only. Operational beta acceptance is still
incomplete. Historical point-in-time research (initially approximately 250-500 events including
failed/missing cases, corrections and issuer histories) requires a later authorized dataset with
SEC/IR artifacts, observed-availability provenance, mappings/corporate actions and issuer/SPY/sector
minute bars. Publication-only timestamps cannot establish historical live availability.
