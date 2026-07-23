# PEAS earnings no-trade universe policy

- Policy version: `0.1`
- Status: research contract; not live-trading authorization
- Scope: U.S.-listed earnings-event capture, research, and later shadow/paper eligibility
- Companion registry: [`no-trade-policy.v1.json`](no-trade-policy.v1.json)
- Interactive view: [`no-trade-blueprint.html`](no-trade-blueprint.html)

## Decision

PEAS must not use a permanent ticker blacklist as its primary safety control. A ticker can become
liquid or illiquid, change its business model, complete a merger, add a new share class, or move
from an operating-company earnings setup to an asset/NAV-driven setup. The engine therefore keeps
three separate decisions with effective dates and evidence references:

1. `capture_eligible`: should PEAS retain and normalize the event for observation and research?
2. `model_eligible`: does a validated model family exist for this issuer and event?
3. `trade_eligible`: is this exact security executable, interpretable, and positive-edge after
   costs at the decision time?

The forward observation run remains capture-first. An `observe_only` or `no_trade` label must not
suppress a useful raw artifact or event cluster. This is how PEAS learns from negative controls
without accidentally converting them into hypothetical intents.

## Why a simple earnings/price correlation is not enough

A positive EPS surprise does not mechanically imply a positive stock reaction. Research using
large earnings-announcement samples finds opposite-sign price responses in roughly 40-45% of
observations, with stale expectations, pre-announcement moves, GAAP exclusions, revenue,
guidance, volatility, and bid-ask spread among the important sources of noise. See
[Kinney, Burgstahler and Martin](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=170560) and
[Johnson and Zhao](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=990078).

PEAS should therefore test the incremental, out-of-sample explanatory value of a complete
earnings packet after benchmark, sector, external-driver, latency, and cost controls. A raw
single-name correlation over a small number of quarters is a diagnostic, not an eligibility rule.

## Gate order

The classifier is fail-closed. The first failed gate sets `trade_eligible = false`; all additional
reason codes are retained so research can distinguish the primary veto from contributing risks.

### Gate 1: security and venue

Eligible by default only when the security is an exchange-listed common share or an explicitly
supported ADR with one deterministic issuer, CIK, exchange, currency, and share-class mapping.

Hard no-trade cases:

- ETFs, ETNs, closed-end funds, preferreds, warrants, rights, units, and other non-common-equity
  instruments;
- SPACs, blank-check companies, and reporting shells before an operating-company history exists;
- OTC securities or unsupported foreign/home-market lines;
- ambiguous ticker, ADR ratio, share class, CIK, currency, or corporate-action identity; and
- delinquent or unreliable public reporting.

The SEC defines a shell company around nominal operations and nominal assets and has adopted
specific investor-protection rules for SPACs and shells. These structures do not belong in a
conventional operating-company earnings model. See the
[SEC shell-company rule overview](https://www.sec.gov/rules-regulations/2005/07/s7-19-04) and
[SEC SPAC/shell compliance guide](https://www.sec.gov/resources-small-businesses/small-business-compliance-guides/special-purpose-acquisition-companies-shell-companies-projections).

### Gate 2: executable market

Liquidity is measured in dollars and in the relevant session, not with raw share volume. A high
priced security can have low share volume but ample dollar capacity; a low-priced security can
show many shares while offering little executable notional.

Provisional research thresholds:

| Test | Initial rule | Purpose |
| --- | --- | --- |
| Price floor | Previous regular-session close at least `$5.00` | Avoid penny/low-price microstructure regimes |
| Regular-session capacity | 20-day median dollar volume at least `max($5m, 200 x target order notional)` | Keep target participation at or below 0.5% of median daily notional |
| Live quote | Fresh, two-sided consolidated quote; maximum age is feed/session-specific and frozen in the run manifest | Reject stale or one-sided markets |
| Spread | At most `50 bps` regular session or `100 bps` extended hours | Bound immediate spread cost; calibrate with forward data |
| Near-touch depth | Target order at most 10% of displayed executable notional inside the configured price collar | Avoid consuming a fragile book |
| Halt state | No regulatory, operational, LULD, or market-wide halt; first stable quote after reopening required | A halted security is not executable |
| Short path | Locate available and all-in borrow cost captured before any hypothetical short intent | Prevent an unexecutable short signal |

These are starting research parameters, not universal market truths. They must be versioned and
calibrated by order size and session during P5. The SEC notes that after-hours markets can have less
liquidity, wider spreads, greater volatility, and uncertain prices; some stocks do not trade at
all. FINRA also confirms that trading is prohibited during a halt and that news-driven opening
imbalances can delay the first trade. See the
[SEC after-hours risk guide](https://www.sec.gov/about/reports-publications/investorpubsafterhourshtm) and
[FINRA halt and delay guide](https://www.finra.org/investors/investing/investment-products/stocks/trading-halts-delays-suspensions).

### Gate 3: expectation and evidence integrity

No-trade when any of the following is unresolved at decision time:

- no prospective expectation snapshot from before the publication time;
- fewer than three contributing analysts for a consensus-dependent setup, unless a separately
  validated sparse-coverage model applies;
- stale or post-release-contaminated estimates;
- ambiguous fiscal period, issuer, unit, currency, adjusted/GAAP basis, or publication time;
- incomplete market, sector, session, halt, or first-tradable-quote snapshot;
- unresolved correction/revision identity; or
- the selected source was observed after the configured maximum-entry window.

### Gate 4: model-family fit

The generic earnings model is for operating companies whose revenue, earnings, guidance, and
operating KPIs are economically meaningful inputs. The following archetypes are `observe_only`
until a dedicated expectation and external-driver model is validated:

| Archetype | Why generic EPS/revenue is insufficient | Required model packet | Illustrative review names, not a blacklist |
| --- | --- | --- | --- |
| Digital-asset treasury / crypto balance sheet | Token price, holdings, financing, dilution, NAV premium, and fair-value accounting can dominate | Token return, holdings, diluted token/share, mNAV, financing and capital-stack changes | `MSTR`; crypto miners require a related but distinct mining-economics packet |
| Pre-commercial biotech | Clinical/regulatory milestones and cash runway matter more than quarterly revenue/EPS | Trial calendar, regulatory status, probability-adjusted pipeline, cash runway and financing | `APGE` is a current archetype example, not a permanent classification |
| Banks | NIM, deposit mix, provisions, credit quality, capital, and securities marks drive the interpretation | NIM, deposits/betas, provisions, charge-offs, CET1 and guidance | `JPM`, `BAC`, `WFC` |
| Insurers | Underwriting profitability, reserve development and investment income require sector definitions | Combined ratio, loss trend, reserve development, premiums and book value | `PGR`, `CB`, `ALL` |
| Equity REITs | GAAP depreciation makes EPS incomplete for property operating performance | FFO/AFFO, same-store NOI, occupancy, leasing, cap rates and leverage | `PLD`, `O`, `EQIX` |
| BDCs / credit vehicles | Portfolio yield, NII, NAV, non-accruals and credit marks drive results | NII, NAV, non-accrual, leverage, portfolio marks and dividend coverage | `ARCC`, `MAIN` |
| Commodity producers and miners | Commodity, production, realized price, hedges and capex can dominate | Production, realized price, costs, hedges, capex and commodity-residual return | `EOG`, `FANG`; miners require commodity-specific packets |
| Holding / NAV companies | Asset values, look-through earnings and capital allocation can overwhelm consolidated EPS | NAV bridge, asset marks, capital allocation and look-through earnings | `BRK.A`, `BRK.B` |
| Recent IPO, de-SPAC, spin, bankruptcy emergence or major restructuring | Short, discontinuous or non-comparable history undermines expectations and model stability | Post-transaction identity, pro forma history and a minimum clean observation set | Dynamic, effective-dated classification |

These categories are not statements that earnings never matter. They are statements that PEAS
must not reuse the generic feature packet where the denominator and economic drivers differ. For
example, Nareit identifies FFO as a supplemental measure designed to make REIT operating results
more comparable, the FDIC's banking profile emphasizes NIM and credit-loss provisions, and the
NAIC defines combined ratio as an underwriting-profitability indicator. See
[Nareit on FFO](https://www.reit.com/glossary/funds-operation-ffo),
[FDIC banking metrics](https://www.fdic.gov/news/speeches/2026/fdic-quarterly-banking-profile-fourth-quarter-2025), and
[NAIC insurance glossary](https://content.naic.org/glossary-insurance-terms).

### Gate 5: event contamination and price discovery

Even a normally eligible company becomes no-trade for an individual event when:

- earnings are bundled with a merger, financing, major divestiture, CEO departure, clinical or
  regulatory result, material litigation outcome, bankruptcy event, or other independent catalyst;
- benchmark/sector movement is extreme and the residual return cannot be estimated reliably;
- the security is halted, the opening is delayed, or the first quote remains unstable;
- price has moved beyond the strategy's pre-registered risk/reward or latency boundary before the
  first executable observation; or
- the source packet contains conflicting guidance, a material correction, or an unresolved
  revision.

PEAS should retain every detected contaminating event as evidence. `Concurrent event` is not a
synonym for bad news; it means the earnings-only causal interpretation is unsafe.

### Gate 6: validated edge after costs

P5 historical and forward walk-forward research owns the final model gate. The research report
must use session-specific abnormal returns, executable entry prices, spreads, slippage, borrow,
fees, and latency. Initial diagnostics are:

- fewer than 12 clean comparable events: `insufficient_history` for a single-name conclusion;
- prefer a pooled/hierarchical model-family estimate over an unstable single-name correlation;
- report out-of-sample Spearman association, directional accuracy, calibration, incremental
  explanatory power over benchmark/sector/external-driver controls, and post-cost expected value;
- require the positive edge to persist across at least two walk-forward folds; and
- classify `no_out_of_sample_edge` whenever expected value after costs is non-positive, regardless
  of an attractive in-sample correlation.

Numerical promotion thresholds beyond the history minimum must be frozen before the P5 evaluation,
not chosen after seeing outcomes.

## MSTR case study

`MSTR` should be captured but is `observe_only` for the generic earnings model.

Strategy's 2025 Form 10-K describes the company as a Bitcoin Treasury Company, states that bitcoin
is its primary treasury reserve asset, says that bitcoin holdings materially affect both financial
results and the market price of its listed securities, and explains that fair-value changes flow
through net income. The same filing says the trading price can deviate significantly from the fair
value of its bitcoin holdings. These facts support a structural model-mismatch classification; they
do **not** by themselves prove zero earnings/price correlation. See
[Strategy 2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1050446/000105044626000020/mstr-20251231.htm).

Required before MSTR can leave `observe_only`:

- bitcoin return from expectation freeze through each response window;
- bitcoin holdings, purchases and average cost;
- fully diluted shares and senior capital-stack changes;
- bitcoin per diluted share and a reproducible mNAV/premium calculation;
- ATM, preferred, convertible and debt issuance/accretion effects;
- software revenue, margin and guidance surprise kept separate from bitcoin fair-value noise; and
- MSTR abnormal return after bitcoin, Nasdaq/sector, financing and market controls.

Default reasons: `NT_MODEL_FAMILY_UNSUPPORTED`, `NT_EXTERNAL_DRIVER_DOMINANT`, and
`NT_ACCOUNTING_MARK_TO_MARKET_DOMINATED`.

## Reason-code registry

The machine-readable companion freezes exact identifiers. The human grouping is:

| Group | Principal reason codes |
| --- | --- |
| Instrument | `NT_INSTRUMENT_UNSUPPORTED`, `NT_VENUE_UNSUPPORTED`, `NT_SHELL_OR_SPAC`, `NT_SECURITY_IDENTITY_AMBIGUOUS` |
| Execution | `NT_PRICE_BELOW_FLOOR`, `NT_CAPACITY_TOO_LOW`, `NT_NO_FRESH_TWO_SIDED_QUOTE`, `NT_SPREAD_TOO_WIDE`, `NT_TRADING_HALTED`, `NT_BORROW_UNAVAILABLE` |
| Evidence | `NT_EXPECTATION_MISSING_OR_STALE`, `NT_EVENT_IDENTITY_AMBIGUOUS`, `NT_MARKET_SNAPSHOT_INCOMPLETE`, `NT_REVISION_UNRESOLVED`, `NT_FIRST_OBSERVATION_TOO_LATE` |
| Model fit | `NT_MODEL_FAMILY_UNSUPPORTED`, `NT_EXTERNAL_DRIVER_DOMINANT`, `NT_EARNINGS_NOT_PRIMARY_CATALYST`, `NT_ACCOUNTING_MARK_TO_MARKET_DOMINATED`, `NT_INSUFFICIENT_HISTORY`, `NT_NO_OUT_OF_SAMPLE_EDGE` |
| Event/risk | `NT_CONCURRENT_MATERIAL_EVENT`, `NT_PRICE_DISCOVERY_UNSTABLE`, `NT_MARKET_DISLOCATION`, `NT_EXPECTED_EDGE_NOT_AFTER_COSTS` |

Every decision packet records the primary reason, all contributing reasons, evaluated thresholds,
observed values, model/policy version, effective time, and source/artifact identities. Unknown input
is a failed gate, never an implicit pass.

## Forward observation-run design

The 100-200-cluster run should target approximately 180 clusters:

- 120 standard operating-company candidates across sector, market-cap, session and liquidity
  buckets;
- 40 specialized-model candidates, including digital-asset, clinical-stage, bank, insurer, REIT,
  BDC and commodity archetypes; and
- 20 hard or event-specific no-trade controls, such as low capacity, halt/delay, missing
  expectations, ambiguous identity, or concurrent material events.

The quotas are sampling targets, not eligibility promises. Each cluster receives a T-1
`universe_snapshot` and an event-time `eligibility_snapshot`. The run reports reason-code
prevalence, missing inputs, state transitions, source latency, duplicates/revisions, first
tradable quote, and movement before observation. This policy must be frozen before the run, while
promotion thresholds remain explicitly provisional until cost-aware P5 validation.

## Implementation boundary

This document adds no trading behavior and does not expand PR 2B. Near-term implementation is:

1. Add reason-code and universe-snapshot fields to the observation telemetry contract before P2.
2. Capture labels without filtering source collection.
3. Add prospective expectation and market-state inputs in P3.
4. Build deterministic classification inputs and packets in P4.
5. Calibrate and promote model families only through leakage-controlled P5 research.
6. Re-evaluate liquidity and event-time execution gates in shadow/paper operation before any
   separate live-effect authorization.

