# PEAS next product slice: calendar-driven event clusters

Status: adopted product direction on authoritative post-PR-#14 `main`  
Adopted: 2026-08-28

## Proven position

- PR #13 merged the disabled-by-default SEC-first P1-03/P1-04 implementation as
  `7827704a370d7b73cce8f298e04f078586497a57`.
- PR #14 merged the complete historical-accession, `EX-99`/`EX-99.1`, New York civil-time, and
  downstream-normalization repair stack as `d4ffac5c08651189d808598d49fe3edf82e439b2`,
  tree `2d09555b7fb0cf93e8d5d035b39dca75232b8ea2`.
- The Autodesk pilot produced `RAW_FORWARD_DETECTION_GO` for accession
  `0000769397-26-000059`, form `8-K`, items `2.02,7.01,9.01`. It terminally produced
  `END_TO_END_FORWARD_NO_GO`; the then-running selector did not interpret SEC New York civil time
  correctly. The preserved-response path now interprets the raw SEC civil value
  `2026-08-27 16:05:06` in `America/New_York` as `2026-08-27T20:05:06.000Z`, normalizes it, and
  preserves SQLite provenance.
- PR #10 is superseded historical corpus-automation work. It is not on the active critical path and
  remains open pending separate closure authorization.
- P1-03/P1-04 implementation exists, but operational acceptance remains incomplete.

## Product outcome

Build a provider-neutral, calendar-prepared earnings `EventCluster`, not merely an SEC filing
collector. A cluster preserves what was prospectively knowable, what arrived during the event,
what arrived later, and the surrounding market path. Source publication time, SEC acceptance time,
first PEAS observation time, retrieval time, and normalization time remain distinct.

## EventPlan contract

An `EventPlan` is prospectively frozen before activation. It binds:

- immutable plan, issuer, CIK, ticker, instrument, exchange, sector benchmark, and fiscal-period
  identities;
- expected event date and reporting session (`before-market`, `after-market`, or `unknown`);
- activation, primary-observation, follow-up, and settlement windows;
- provider capability assignments and lane-scoped AcquisitionPlans;
- expected forms, items, exhibit aliases, and issuer-IR artifact kinds;
- immutable raw retention, duplicate, correction, amendment, and stable-missing rules;
- one-minute issuer, SPY, and sector market-window definitions;
- prohibited effects and any separately authorized credential requirements; and
- a revision digest and explicit amendment history.

No frozen field changes silently. A correction creates a new revision digest while preserving the
plan identity, the prior digest, the change digest, the reason, and the recorded time.

## EventCluster contract and lifecycle

An `EventCluster` relates optional SEC, issuer-IR, transcript, and market members for one issuer and
fiscal event. Each member preserves provider/request identity, raw artifact digest,
publication/acceptance time when available, first-observation and retrieval times, revision and
replacement relationships, and normalization provenance.

The lifecycle is:

1. `candidate`
2. `prewarming`
3. `frozen`
4. `active`
5. `primary-observed`
6. `follow-up`
7. `settling`
8. `complete`
9. `stopped`

SEC, issuer-IR, transcript, and market lanes progress independently. One unavailable source does not
block another. Missing expected artifacts become explicit stable-missing facts at settlement.
Duplicate redeliveries do not add members. Corrections and amendments require explicit ancestry.
Later `10-Q`/`10-Q-A` or `10-K`/`10-K-A` members remain linked to the same event without being
required for primary observation.

## Provider capability registry

The registry advertises bounded capabilities rather than treating providers as interchangeable:

- `calendar-discovery`
- `issuer-release`
- `sec-filing`
- `filing-exhibit`
- `issuer-slides`
- `webcast-metadata`
- `prepared-remarks`
- `transcript`
- `expectations-snapshot`
- `market-bars`
- `market-quotes-trades`
- `benchmark-market-data`

Unknown, unavailable, credential-gated, or unsupported capabilities produce a readiness blocker or
stable-missing reason. They never cause live provider substitution or improvisation.

## Preparation schedule

- **T-14 to T-7:** reconcile calendar candidates, issuer/CIK/ticker/instrument identity, expected
  fiscal period and reporting session, then allocate the provisional cluster.
- **T-7 to T-2:** compile lane-scoped source plans and a provider readiness matrix using
  provider-free checks unless live access is separately authorized.
- **T-1:** freeze the plan identity, source priorities, estimate snapshot time, market windows,
  stable-missing policy, and every unresolved readiness blocker.
- **Event window:** activate only independently authorized lanes, retaining immutable responses and
  distinct observation times. A source-specific failure stops that lane; identity, safety, or
  prohibited-effect failures stop the cluster.
- **T+1 to T+3:** link later filings, transcripts, corrections, and market paths when separately
  authorized, reconcile duplicates and revisions, settle stable missing outcomes, and freeze the
  final inventory.

## Market evidence

The operational beta defines one-minute issuer, SPY, and one frozen sector-benchmark window for
pre-event, release gap, +1, +5, +30 minutes, close, and next session. Bar-based movement is coarse
event-response evidence, not proof of immediate tradability. Quotes, trades, spreads, halts, and
first-tradable state are a later capability and authorization gate.

## Operational beta and formal study

The first beta contains 3-5 clusters across at least two issuers and is excluded from the formal
scientific cohort. It measures source coverage, first-observation latency, missingness, duplicates,
corrections, settlement duration, and operator burden. It must include a clean stable-missing case,
not only successful filings.

Formal P2 collection remains blocked behind P1 readiness. The existing 180-cluster, 65-session
contract is unchanged. Prospective expectation and market snapshots must be frozen before or
alongside P2 cohort admission; placing them after observed P2 outcomes is scientifically invalid.

## Active provider-free package

The authorized package may implement deterministic calendar compilation, immutable plan identity,
capability readiness, independent source lanes, amendments, duplicates/corrections, stable missing,
settlement inventory, market-window definitions, and memory/SQLite restart equivalence using only
fixtures, mocks, synthetic inputs, and previously authorized preserved artifacts.

It may not make SEC, issuer-IR, calendar, transcript, market-data, or other provider requests; use
credentials or accounts; create subscriptions or spending; select a live issuer; launch a live
controller; merge its draft PR; or create broker, order, portfolio, position, fill, trading, or
financial effects.

## Next real-life gate

After this provider-free package receives exact-head CI and `EVENT_CLUSTER_BETA_PACKAGE_GO`, the
human owner may decide whether to merge it. Only after an unchanged merge should PEAS select and
freeze a confirmed future issuer, prepare and mock the exact live packet, and request a separate
exact-candidate live/provider authorization.
