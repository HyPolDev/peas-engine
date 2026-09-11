# PEAS Alpha Research MVP

Status: requirements reconciled onto 2026-09-11 authoritative main; provider-free implementation authorized.

Current base: `fc364fff482131473588c7acb9a1b438ef8bdb59`, tree
`dfdc1c729a3bff7664094af7ce4e7f7b66b563d7`. PR #18 durability recovery merged.
Operational beta remains incomplete; raw forward SEC success is not end-to-end beta GO.
AVO preparation is historical and its event window expired. This document's September 3 baseline
and historical lane labels below are planning history. Current Lane A owns Alpha Research MVP;
current Lane B prepares a future event. See [implementation scope](alpha-research-implementation.md).

Recorded: 2026-09-03

Authoritative base at creation: `2ef2142ef23f83ea59ddf7f7f91a063d57c72b6b`

Authoritative tree at creation: `934ab36738103c3c916bb7f88a51d112702616b7`

This document defines the shortest path from PEAS as a trustworthy event-observation laboratory to
PEAS as an auditable alpha-research system. It authorizes no provider request, credential use,
subscription, spending, order, trade, portfolio change, or financial effect.

## Product thesis

PEAS exists to determine whether the full information cluster around a dated market event contains
small, repeatable and executable price-prediction opportunities. Earnings are the first experimental
domain, not the permanent product boundary.

The intended advantage is not the already-known observation that earnings surprises can be followed
by drift. PEAS should search for conditional imperfections involving source order, information
content, market reaction, issuer history, liquidity, session, revisions and cross-source
disagreement. A useful result may have too little capacity, frequency or operational convenience for
a large institutional fund while remaining meaningful at modest capital.

The system must distinguish four progressively stronger claims:

1. `PATTERN_DETECTED` - a relationship exists in exploratory data.
2. `PREDICTIVE_SIGNAL` - the relationship survives untouched chronological evaluation.
3. `PAPER_ALPHA` - the frozen rule survives forward operation after realistic costs and delays.
4. `TRADABLE_ALPHA` - a separately authorized capital trial supports executable net returns.

No earlier claim implies a later one.

## Research MVP completion boundary

PEAS Research MVP is complete when it can:

1. build trustworthy live and historical EventClusters;
2. preserve what was knowable at each decision time;
3. replay clusters deterministically from immutable artifacts;
4. generate versioned point-in-time features and forward-return labels;
5. register every hypothesis, parameter search and failed experiment;
6. run chronological discovery, selection and untouched evaluation partitions;
7. simulate delayed entry, benchmark adjustment, spreads, slippage and other declared costs;
8. produce an auditable `TRADE_CANDIDATE` or `NO_TRADE` research result;
9. freeze surviving signals for forward shadow evaluation; and
10. prove that no research execution creates a dispatchable or financial effect.

The Research MVP does not require brokerage integration, live capital, a generalized provider
platform, high-frequency infrastructure, or an LLM dependency.

## Operating model: two concurrent lanes

### Lane A - operational measurement beta

Complete the 3-5-cluster EventPlan/EventCluster beta. Include successful, degraded and stable-missing
outcomes. This lane proves source independence, timing, raw retention, normalization, SQLite
provenance, restart, settlement and reproducibility. Beta clusters used to repair instrumentation
are excluded from untouched alpha evaluation.

### Lane B - historical alpha research

Begin provider-free research contracts and implementation while Lane A continues. Historical
backfill supplies statistical scale; live capture supplies causal and operational validation. A STOP
in either lane does not stop unrelated authorized work in the other lane.

The former sequence that delayed historical research until after the complete 180-cluster
prospective study is retired. The 180-cluster study remains a formal prospective measurement phase,
but it is not a prerequisite for an early historical feasibility screen.

## Initial alpha scope

The first research wave targets statistical event alpha. It does not claim direct arbitrage or a
sub-minute latency advantage.

### Hypothesis family H1 - reaction continuation or reversal

Test whether the issuer's initial benchmark-relative reaction predicts residual movement over
predeclared +5, +15, +30, +60 minute, close and next-session horizons, conditional on session,
liquidity, volatility and event completeness.

### Hypothesis family H2 - source order and information diffusion

Test whether `SEC_FIRST`, `ISSUER_IR_FIRST`, `NEAR_SIMULTANEOUS`, source disagreement, corrections,
or progressively arriving artifacts predict different residual market paths after the first usable
PEAS observation.

### Hypothesis family H3 - expectation and content disagreement

When point-in-time expectations are legitimately available, test whether agreement or conflict
among earnings, revenue, guidance, textual changes and the initial price reaction predicts later
abnormal returns. Missing expectations remain explicit and cannot be reconstructed with future
knowledge.

Additional hypotheses may be proposed, but each must be registered before its evaluation partition
is inspected and must count toward the experiment-trial total.

## Canonical research records

### As-of feature record

Each record binds:

- EventPlan, EventCluster, issuer and instrument identities;
- exact decision timestamp and information cutoff;
- source publication, SEC acceptance, PEAS observation, retrieval and normalization clocks;
- source availability, trust, missingness, revisions and conflicts;
- numeric earnings, revenue and guidance facts when known;
- issuer, SPY and sector market state known by the cutoff;
- release session, pre-event returns, volatility, volume and liquidity;
- deterministic feature-code and configuration identity;
- optional LLM feature-bundle identity; and
- an explicit assertion that no post-cutoff fact entered the feature set.

### Outcome-label record

For every declared decision timestamp and holding horizon, retain:

- raw and benchmark-adjusted returns;
- entry price after the declared processing and order delay;
- spread, slippage, fee and market-impact assumptions;
- maximum favorable and adverse excursion;
- close and next-session outcomes;
- halt, quote-quality, missing or non-executable reasons; and
- label-code, market-dataset and configuration identities.

One-minute bars support coarse reaction, drift and reversal research. A claim about sub-minute
latency or direct arbitrage requires a later separately approved quote/trade/spread and
first-executable-state capability.

### Experiment record

Every attempted experiment is append-only and includes:

- hypothesis and economic rationale;
- eligible universe and exclusions;
- feature and label versions;
- direction, entry, exit and holding rules;
- parameters and every variation tried;
- discovery, selection and untouched partitions;
- costs, delay, benchmark and capacity assumptions;
- results, diagnostics and failure reasons;
- implementation and environment identity; and
- status: `proposed`, `exploratory`, `rejected`, `validated`, `shadow`, or `retired`.

Failed experiments may not be deleted from trial accounting. Untouched data used for model changes
is no longer untouched and starts a new research epoch.

## Signal contract

A signal does not emit an unqualified buy or sell. It returns:

- expected abnormal-return distribution;
- uncertainty and evidence quality;
- estimated transaction cost and entry delay;
- expected holding period and trigger frequency;
- liquidity and capacity estimate;
- known failure regimes; and
- `TRADE_CANDIDATE` or `NO_TRADE`.

The default is `NO_TRADE`. Promotion requires expected return to exceed costs plus a frozen
uncertainty margin on untouched data. Strategy construction should combine several weak signals
only after their errors, exposures and capacity have been measured separately.

## LLM research lane

LLMs are versioned feature extractors and hypothesis assistants, never the source of truth or trade
authority. Candidate LLM features include:

- guidance raised, lowered, narrowed or withdrawn;
- change from the issuer's previous language;
- segment acceleration or deterioration;
- new qualifiers, omissions and risk language;
- contradictions across release, filing, exhibits, slides and call;
- answer responsiveness and uncertainty;
- textual novelty relative to issuer history; and
- agreement or conflict between narrative and numeric evidence.

Every LLM output binds its exact input artifacts, as-of cutoff, model/provider identity, prompt,
schema, decoding configuration and output. Historical features must be materialized and frozen;
model upgrades create a new feature version rather than silently rewriting history.

LLM features must demonstrate incremental untouched predictive value over simple numeric,
market-reaction and dictionary-based baselines. A persuasive explanation without incremental
predictive value is not alpha.

Provider/API use, model credentials and spending remain separately gated. Provider-free development
may use deterministic mock extractors and frozen synthetic outputs.

## Revised execution roadmap

### R0 - measurement beta

Outcome: 3-5 operational EventClusters across more than one issuer, including degraded or
stable-missing settlement.

Gate: complete provenance, correct clocks, lane isolation, restart equivalence and zero prohibited
effects.

Claim permitted: the measuring instrument is operationally credible.

### R1 - Alpha Research MVP contract and implementation

Outcome: canonical feature, label, experiment, signal and research-manifest contracts plus a
provider-free vertical slice.

Gate: deterministic output, leakage rejection, append-only trial accounting, chronological split
enforcement, cost assumptions and memory/SQLite or declared durable-format equivalence.

Claim permitted: PEAS can conduct auditable alpha experiments.

### R2 - historical feasibility screen

Outcome: approximately 250-500 historical clusters processed through the same research contracts
and the three initial hypothesis families.

Gate: complete cohort accounting, point-in-time integrity, simple baselines, all trials recorded and
no untouched-set reuse.

Claim permitted: `PATTERN_DETECTED` or `NO_EARLY_SIGNAL`; never tradable alpha.

### R3 - expanded walk-forward validation

Outcome: expand toward roughly 1,000 or more events, subject to effect-size and statistical-power
analysis, with multiple market regimes and a frozen final chronological holdout.

Gate: positive net result after declared costs and delay, stability across time and reasonable
subgroups, multiple-testing adjustment, sensitivity analysis and no dependence on a few events.

Claim permitted: `PREDICTIVE_SIGNAL` or rejection.

### R4 - forward shadow evaluation

Outcome: frozen signals produce hypothetical decisions on unseen live EventClusters with zero
financial effects.

Gate: live feature availability matches backfill assumptions; performance, missingness, latency,
cost sensitivity and operational behavior remain within frozen limits.

Claim permitted: `PAPER_ALPHA` or rejection.

### R5 - separately authorized tiny-capital experiment

Outcome: minimal-capital, tightly bounded execution of a previously frozen shadow-validated rule.

Gate: a separate effects-safety contract, broker idempotency, reconciliation, loss limits, capacity,
halt/kill behavior and explicit human authorization.

Claim permitted: evidence toward `TRADABLE_ALPHA`; no general deployment authority.

The formal 180-cluster prospective study may run after R0 readiness and in parallel with R1-R3. It
remains useful for unbiased operational and measurement evidence, but it does not block historical
alpha discovery.

## Anti-overfitting and research-integrity rules

- Split chronologically, never randomly across observations from the same issuer-event history.
- Freeze the final holdout before hypothesis results are inspected.
- Count all parameter, feature, horizon, universe and model variants.
- Compare complex models with simple baselines.
- Keep raw beta clusters used for repairs out of untouched evaluation.
- Preserve missing and failed events in denominators.
- Report results before and after costs, never only gross returns.
- Test stability across time, sector, issuer size, session and liquidity without selecting the most
  favorable subgroup after inspection.
- Measure capacity; a low-capacity signal may still be useful, but its limits must be explicit.
- Prefer a small ensemble of independently supported weak signals over one optimized backtest.

## Immediate provider-free implementation package

The next development authorization should be limited to:

1. the contracts for research manifests, as-of features, labels, experiments and signals;
2. a historical EventCluster ingestion/export boundary using fixtures and preserved artifacts;
3. deterministic baseline calculations for H1 and H2;
4. a placeholder point-in-time expectations interface for H3;
5. chronological partitioning and leakage tests;
6. append-only experiment/trial accounting;
7. cost and delayed-entry simulation with explicit assumptions;
8. a mock LLM feature-bundle interface and baseline-comparison gate;
9. provider-free tests and one independent review; and
10. a draft PR with no merge, provider, credential, spending or effect authority.

Live data acquisition, historical licensed-data access, credentials, paid models, account activity,
paper brokerage and capital execution each remain separate later decisions.

## Historical proposed decision (superseded by September 11 authorization)

Authorize or reject a provider-free Alpha Research MVP implementation package on authoritative main.
That authorization should not include historical-provider access, LLM API access, spending, shadow
operation, brokerage or trading.
