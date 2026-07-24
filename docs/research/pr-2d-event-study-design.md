# PR 2D event-study and data-quality precommitment

## Control, scope, and claim labels

- Research owner: independent Luna event-study and data-quality analyst
- Repository base: `0377323b5486a8ad3b8e2631d4c8559760893be6`
- Phase 0 checkpoint: `06e7559`
- Research and official-source access date: `2026-07-23`
- Outcome data inspected: none
- Provider calls, account/credential inspection, licensed bytes, and incremental spend: none
- P1-09: `PENDING`; P1-10 and P2 remain `BLOCKED`
- Primary-observation anchor: `HUMAN_DECISION_REQUIRED`

This report is a pre-outcome design recommendation, not a calculated study result and not legal,
investment, execution, or trading advice. It uses these labels:

- **F -- repository fact:** inherited from accepted repository evidence.
- **D -- documented external fact:** stated by a cited official or primary source.
- **I -- inference:** a constrained interpretation of repository or external facts.
- **R -- recommendation:** a proposed ADR 0010 rule that is not accepted until integration and
  independent contract review.

## Executive recommendation

**R:** Freeze one study of exactly `180` prospectively selected issuer-release clusters, preserving
the candidate's `120 / 40 / 20` counts only after correcting their semantics:

| Mutually exclusive sampling lane | Target | Corrected meaning |
| --- | ---: | --- |
| `standard` | 120 | Standard-operating-company model-family candidates that are not assigned to a prospective control. |
| `specialized` | 40 | Versioned specialized-model candidates that are not assigned to a prospective control; this is a sampling label only. |
| `prospective-control` | 20 | Five candidates in each of four T-1-knowable stress groups; never a halt, missing quote, price move, correction, or other event-time outcome. |

All `180` selected clusters are the capture and primary study denominator. A cancellation, late
schedule change, missing source, ambiguous timestamp, halt, unusable quote, provider disagreement,
or later correction remains one of those `180`; none can be replaced after the freeze. Capture
eligibility, market-reference quality, metric evaluability, model-family labeling, and future trade
eligibility are orthogonal fields. PR 2D defines no model promotion, cost, order, or trade threshold.

**R:** The gate asks whether PEAS can produce a complete, timely, deterministic measurement and
whether a non-negligible fraction of clusters retain quote-width-exceeding movement for five minutes
after the chosen PEAS observation anchor. It does not ask whether a trade would have been profitable.

## Disposition of the preserved candidate

**F:** `docs/research/no-trade-policy-disposition.md` gives the preserved candidate
`ADOPT_WITH_CHANGES` status. This report applies that instruction as follows.

| Candidate provision | Event-study treatment |
| --- | --- |
| Capture first; missing/degraded/control cases stay visible | `ADOPT`; every selected cluster stays in the `N=180` denominator. |
| Separate capture, model, and trade eligibility | `ADOPT_WITH_CHANGES`; use orthogonal study fields and leave trade eligibility null/out of scope. |
| `120 / 40 / 20` allocation | `ADOPT_WITH_CHANGES`; retain the counts, make lanes mutually exclusive, freeze the frame/ranking, and replace outcome-defined controls with four prospective groups. |
| T-1 universe and event-time snapshots | `ADOPT_WITH_CHANGES`; the pre-run frame snapshot selects the sample, while per-cluster T-1 and event-time snapshots annotate it and can never cause replacement. |
| Specialized model-family list | `ADOPT_WITH_CHANGES`; versioned sampling labels only, with authority/effective time/evidence and no eligibility conclusion. |
| Halts, contamination, stale/crossed quotes, missing references | `ADOPT_WITH_CHANGES`; event-time annotations and sensitivities, never retrospective control recruitment or denominator removal. |
| Anti-post-outcome threshold rule | `ADOPT`; the manifest and analysis code digest must be frozen before any selected outcome is available. |
| `$5`, dollar-volume, spread, depth, borrow, analyst-count, history, persistence, and cost rules | `REJECT` from P2; they are neither study admission nor success thresholds. |
| Candidate `states`, `NT_*` reasons, ticker seeds, and implementation fields | `REJECT`; use study/market reasons, no ticker blacklist, and no PR 2C ledger-field change. |

## Human decision: primary PEAS observation anchor

**F:** PR 2C already permits `marketReferenceJoinKey` to bind either a trusted capture basis or a
trusted retrieval basis. The provider and identity research reports independently conclude that
choosing between retrieval completion and durable capture changes scientific meaning.

| Alternative | Exact inherited basis | Scientific claim | Expected bias and affected metrics |
| --- | --- | --- | --- |
| A -- durable capture | `{basisKind:"capture",eventId,receivedAtMs,logicalAtMs,clockBasisId}` | Market state when a normalized earnings observation was durably captured and operationally available to PEAS. | Later anchor includes verified-read, normalization, persistence, and scheduling delay. It increases measured publication-to-observation latency, assigns more movement to `prior-close -> first`, and can reduce or shift +1/+5 residuals. |
| B -- retrieval completion | `{basisKind:"retrieval",role,acquisitionObservationId,vaultObservationId,retrievedAtMs,clockBasisId}` | Market state at the recorded completion epoch of the selected raw earnings artifact. | Earlier anchor is closer to complete-byte availability, but bytes may not yet be verified, normalized, or durably usable. It reduces measured latency and can move price changes from pre-anchor into +1/+5 windows. `retrievedAtMs` must not be renamed transport completion. |

**R:** If the intended P2 claim is operational PEAS knowledge, select A as primary and B as a
mandatory sensitivity. If the intended claim is provider/acquisition latency, select B as primary
and A as a mandatory sensitivity. In either case:

1. selection of the `180` clusters, strata, provider policy, missingness rules, formulas, bounds,
   thresholds, and correction cutoffs can be frozen now and do not depend on the anchor choice;
2. calculate both branches from the same immutable cluster/reference set;
3. record `captureMinusRetrievalMs` for every cluster where both bases are trusted;
4. never use the branch with the more favorable result; and
5. keep ADR 0010 unaccepted until the human owner records one primary claim and anchor.

Synthetic deltas at `0`, `1`, `999`, `1,000`, `4,999`, `5,000`, `29,999`, and `30,000` ms with a
quote change between the anchors prove materiality at the exact study windows. Therefore this report
records `HUMAN_DECISION_REQUIRED`, not a silent default.

## Study question and estimands

**R:** The study has three ordered questions:

1. Can PEAS account deterministically for all selected clusters and produce the precommitted market
   references or stable missing reasons?
2. For clusters with a trusted publication clock, did PEAS obtain its chosen primary observation
   within 15 minutes?
3. Does at least a precommitted minority retain market movement beyond simultaneous NBBO quote-width
   uncertainty for five minutes after that observation?

The primary estimands, all over the fixed `N=180` denominator unless stated otherwise, are:

| ID | Estimand | Definition |
| --- | --- | --- |
| `E1.complete-primary` | Fully complete primary-reference rate | Count with trusted publication and primary anchor, eligible prior close, NBBO midpoint at first/+1/+5/+30, complete identities/provenance, and frozen as-known correction semantics, divided by 180. Missing is not success. |
| `E2.observed-within-15m` | Timely-observation rate | Count whose conservative latency upper bound is `<= 900_000 ms`, divided by 180. Missing/ambiguous timing is not success. |
| `E3.informative-residual-5m` | Five-minute residual-information rate | Count with complete `P0`, `P5`, and two-sided quotes for which `abs(P5-P0) > (spread0+spread5)/2`, divided by 180. Equality and missing are not success. This is measurement beyond quote-width uncertainty, not expected return after costs. |
| `E4.deterministic-reproduction` | Exact replay rate | Count whose selected or typed-missing result, canonical metric record, and study entry are byte-identical across required replay/order/page-size/backend runs, divided by 180. |

Primary descriptive movement outputs are the median, interquartile range, median absolute deviation,
and 95% deterministic stratified-bootstrap interval for prior-close-to-first, release-gap, and
residual +1/+5/+30-minute returns. They describe the sampled clusters and do not themselves authorize
a provider purchase or financial effect.

## Prospective frame, timing, and cluster identity

### Run calendar

**R:** A run-specific manifest supplies accepted gate timestamps but derives all study dates:

1. `readyAtMs` is the maximum independently published acceptance time for ADR 0010/P1-08, P1-09,
   P1-10, and P1-06. P1-09 must no longer be pending before this value exists.
2. `S1` is the first frozen-calendar regular session whose open is strictly after `readyAtMs`.
3. `samplingFrameAsOfMs` is the official regular close of `S5`.
4. The immutable study freeze must be published before the open of `S6`.
5. Collection starts at the open of `S15`, ten full trading sessions after frame capture.
6. Collection covers exactly 65 regular sessions, `S15` through `S79` inclusive, and closes at the
   end of the final approved post-market session for `S79`.

If the T-1-known frame cannot fill every lane/control requirement, the manifest is invalid and
collection does not start. A new window requires a new manifest and independent review before any
candidate outcome in that new window. No started run is extended, and no second frame may refill an
attrited quota.

**D:** NYSE publishes holiday and early-close schedules, including 1:00 p.m. early closes on named
days, while Nasdaq rules distinguish pre-market, regular, and post-market hours. **R:** The manifest
must bind a versioned US-equities calendar snapshot and `America/New_York` timezone database; it
must not reconstruct sessions from weekday arithmetic.

### Candidate frame and selected capture universe

**R:** The `samplingFrame` is every distinct prospectively scheduled quarterly or annual earnings
release in `S15..S79` that was known by `samplingFrameAsOfMs` and has:

- one frozen schedule-source observation and schedule-source policy;
- a deterministic issuer mapping and one U.S.-exchange-listed common-share or explicitly supported
  ADR instrument candidate;
- a schedule record known before the release, even when fiscal period or release session is unknown;
  and
- no outcome, event-time market fact, actual release latency, later correction, or provider coverage
  fact in its selection preimage.

Funds, ETFs, ETNs, preferreds, warrants, rights, units, OTC securities, and duplicate share-class
alternatives are frame dispositions, not disappearances. Count them by reason before sampling.

**D:** SEC EDGAR submissions data identifies filer CIK plus current/former names, exchanges, and
tickers, and is updated as filings disseminate. SEC search also exposes SIC as the company's type of
business. **R:** These facts may support a frozen identity/sector snapshot, but ticker or SIC alone
is not issuer, instrument, share-class, or model-family authority.

Define the prospective cluster candidate:

```text
clusterCandidateId = H("peas/event-study-cluster-candidate/v1", {
  scheduleSourceObservationId, issuerMappingId, instrumentId,
  plannedFiscalPeriod, plannedReleaseDate, plannedSession
})
```

Null `plannedFiscalPeriod` or `plannedSession` is encoded as null, never guessed. Multiple source
documents for one actual release remain independent source observations under the one frozen cluster.
A provider-confirmed revision remains in that cluster; a distinct restatement or later earnings
release is not retroactively merged. When several share classes map to one issuer/event, choose the
one with greatest frame-snapshot 20-session median regular-session dollar volume; missing volume
sorts last and `instrumentId` breaks an exact tie. Report every unselected alternative.

The selected `180` IDs become `captureUniverse`. Non-selected frame members are reported only in the
frame/selection accounting and must not be swapped in later.

## Freeze snapshot and strata

**R:** Two snapshots serve different purposes:

- `samplingSnapshot` is captured at `samplingFrameAsOfMs` for every frame member and is the sole
  source for lane assignment, strata, and ranking.
- `eventTMinus1Snapshot` is captured at the previous frozen regular-session close for each selected
  cluster. It records identity, schedule, sector, cap, liquidity, source expectations, and model
  labels as then known, but only annotates drift. It cannot change membership, lane, weight, or rank.

This separation prevents outcomes from early clusters influencing T-1-based selection of later
clusters.

| Stratum | Exact proposal |
| --- | --- |
| Sector | SEC SIC division derived from the frozen four-digit SIC: `agriculture`, `mining`, `construction`, `manufacturing`, `transport-communications-utilities`, `wholesale`, `retail`, `finance-insurance-real-estate`, `services`, `public-administration`, or `unknown`. Store the original SIC and mapping version. |
| Market cap | `priorEligibleClose * sharesOutstandingAsKnown`; assign `low|mid|high` by deterministic tertiles among known positive frame values, with rank ties broken by `instrumentId`; absent/invalid is `unknown`. |
| Liquidity | Median of `close * volume` for the 20 frozen regular sessions ending at the frame snapshot; require at least 15 valid sessions for a known value. Assign known values to deterministic tertiles; otherwise `unknown`. This is sampling, not an execution/capacity gate. |
| Planned session | `pre-market|regular|post-market|overnight-or-closed|unknown`, from the frozen schedule/calendar as known at frame time. Actual session is separate. |
| Model family | `standard-operating-company`, one of the nine adopted specialized candidate families, or `unknown`, with authority/version/effective time/evidence. A label implies no model/trade eligibility. |

The specialized candidate labels are `digital-asset-treasury`, `precommercial-biotech`, `bank`,
`insurer`, `equity-reit`, `bdc`, `commodity-producer`, `holding-nav`, and
`discontinuous-history`. Changes to this list create a new label-policy version and require a new
study manifest before outcomes.

For each tertile, sort known values ascending by `(exactValue,instrumentId)`, assign zero-based rank
`r` among `n`, and set bucket `min(2,floor(3*r/n))`; bucket 0/1/2 is low/mid/high. The liquidity-tail
control uses `floor(10*r/n) == 0` after earlier control groups are removed. An even-count median is
the exact rational mean of the two center values. No percentile boundary is rounded through binary
floating point.

### Session classification

**R:** Convert a trusted event timestamp through the frozen timezone/calendar and classify against
that session's actual close:

- `[04:00, 09:30)` Eastern: `pre-market`;
- `[09:30, regularClose)`: `regular`;
- `[regularClose, 20:00)`: `post-market`;
- all other times: `overnight-or-closed`;
- missing/untrusted timestamp or calendar: `unknown`.

On an early close, post-market starts at the published early close, not 16:00. Overnight is not
primary SIP evidence while the entitlement policy forbids it. Planned and observed session are both
reported; observed session never rewrites the sampling stratum.

## Deterministic lane assignment and selection

### Prospective controls

**R:** Assign prospective-control eligibility from the frame snapshot only. A candidate satisfying
more than one rule receives the first rule in this fixed priority order:

1. `identity-transition`: a documented symbol, listing, share-class, split, merger, spin, or ADR-ratio
   change was effective in the prior 180 calendar days or was already announced effective through
   the planned release date;
2. `schedule-uncertain`: planned session is `unknown`, or frozen schedule sources disagree on the
   release date/session under the precommitted schedule policy;
3. `source-sparse`: at most one authoritative earnings-source family is prospectively expected by
   the frozen source-availability snapshot;
4. `liquidity-tail`: known frame liquidity is in the bottom decile after the three earlier controls
   are removed.

Select exactly five from each group. A halt, actual missing quote, spread, price move, concurrent
event, correction, or failed source may never create a prospective control. Those are event-time
annotations across all lanes.

### Allocation and ranking algorithm

**R:** Use one public randomization seed committed in the freeze manifest and derive
`rank = SHA256("peas/event-study-rank/v1" || 0x00 || seed || 0x00 || clusterCandidateId)`. Sort by
unsigned digest bytes, then `clusterCandidateId`.

1. Validate the complete frame and snapshot before ranking; duplicate candidate IDs or conflicting
   snapshot facts invalidate the manifest.
2. Select `5` candidates in each prospective-control group by rank and remove all 20 from other
   lanes.
3. From remaining specialized candidates, allocate 40 across populated model families. Give each
   populated family a floor of two when capacity permits; allocate the remainder proportional to
   frozen family counts by Hamilton largest remainder. Ties use model-family ID. Reallocate a
   capacity shortfall iteratively by the same rule among families with remaining capacity.
4. From remaining standard candidates, allocate 120 across populated SIC divisions. Give each
   populated division a floor of one; allocate/reallocate the remainder by the same capacity-aware
   Hamilton rule.
5. Within every primary allocation group, partition candidates by
   `{marketCap,liquidity,plannedSession}` and allocate the group target proportionally with the same
   largest-remainder/capacity algorithm. Rank selects within a cell.
6. Unknown strata are explicit cells. They cannot be silently assigned to the largest known cell.
7. Any lane total below `20`, `40`, or `120` invalidates the freeze. There is no cross-lane spillover.

At each Hamilton step, after fixed floors, let `R` be remaining seats and `Ci` each cell's remaining
capacity. Assign `floor(R*Ci/sum(C))`, then assign unfilled seats by descending exact remainder
`(R*Ci) mod sum(C)`, with cell ID as the ascending tie-break. Cap at `Ci`, remove exhausted cells,
and repeat until `R=0` or capacity exhaustion proves `study.quota-insufficient`.

The study is stratified/descriptive by default because specialized/control candidates are
intentionally oversampled. Report frame counts, selected counts, and exact selection fractions for
every lane, primary group, and marginal stratum. Do not claim population representativeness. A
separately labeled inverse-probability sensitivity is permitted only when every reported population
cell has a nonzero frozen selection probability; otherwise omit it rather than invent a weight.

## Enrollment, event-time annotations, and denominators

**R:** Enrollment occurs once, when the independently reviewed freeze manifest names 180 unique
cluster IDs. After enrollment, no factual development removes or replaces a cluster.

| Event after freeze | Primary treatment |
| --- | --- |
| Release cancelled, indefinitely postponed, or outside the 65-session window | Retain in `N=180` as `study.release-not-observed`; no replacement. |
| Release date/session changes but remains observable | Capture under the original cluster; record planned and actual facts plus `study.schedule-changed`. |
| Identity/share-class mapping changes | Retain; use the frozen instrument for the primary analysis, annotate transition, and place remapped instrument results only in a named sensitivity. Ambiguity produces typed missingness. |
| Duplicate schedule/source delivery | Collapse only under frozen identity rules; retain every delivery/revision witness. |
| Missing publication/anchor/reference | Retain as missing for affected metric and as failure for full-denominator rate estimands. |
| Halt, reopening, stale/locked/crossed/one-sided quote, concurrent event | Retain and annotate using frozen market/study reasons; do not recast it as a control or exclusion. |
| Provider correction/cancellation | Apply only under the frozen as-known/corrected view; never rewrite the original observation. |

Every table must show at least:

```text
frameN -> selectedN=180 -> releaseObservedN -> anchorTrustedN
  -> priorCloseEligibleN -> P0EligibleN -> P1EligibleN -> P5EligibleN -> P30EligibleN
  -> fullyCompleteN
```

Show counts and percentages against both `selectedN=180` and the immediately preceding stage, for
the total study and every lane, sector, cap, liquidity, planned session, actual session, model-family,
timestamp-trust, and provider-disagreement group. A complete-case chart without the fixed denominator
beside it is invalid.

## Timestamp trust and market-reference completeness

### Study trust groups

**R:** Preserve the complete underlying clock/timestamp facts and derive one study label:

| Group | Requirements | Primary use |
| --- | --- | --- |
| `T0-verified` | Publication is `exact` or provider-stated under a frozen grammar/precision; selected PEAS basis has a non-null clock basis with `verified-bound`; market event times/sequence satisfy the accepted market contract. | Primary latency and movement. |
| `T1-asserted` | Publication is exact/provider but PEAS synchronization is `operator-asserted` or error is not verified; all other identity/evidence is complete. | Primary movement; latency sensitivity only. |
| `T2-inferred` | Publication time is inferred under a frozen named policy, or a market timestamp has lower documented precision. | Secondary sensitivity only. |
| `T3-insufficient` | Publication, PEAS anchor, market event time, timezone, sequence/condition, or calendar basis cannot support the requested metric. | Typed missing result; retained in denominator. |

For a latency comparison with bounded timestamp uncertainties `ep` and `ea`:

```text
latencyLowerMs = (anchorMs - ea) - (publishedMs + ep)
latencyUpperMs = (anchorMs + ea) - (publishedMs - ep)
```

`E2` is timely only when `latencyUpperMs <= 900000`. It is late only when
`latencyLowerMs > 900000`; overlap is `study.latency-ambiguous` and is not a timely success. A
material negative interval is invalid, not clamped. Exact equality at 900,000 ms is timely;
900,001 ms is not.

### Minimum primary evidence

**R:** `E1` succeeds for a cluster only when all of the following reconcile:

- exact study/cluster/issuer/instrument/schedule identities and both sampling snapshots;
- selected earnings source observation/version and `marketReferenceJoinKey`;
- primary-anchor evidence under the human-selected basis and a compatible clock declaration;
- frozen provider/dataset/feed/endpoint/entitlement and market-selection-policy identities;
- verified artifact evidence or a stable typed missing result for every requested market fact;
- previous eligible regular-session close on an explicit adjustment basis;
- eligible two-sided primary NBBO midpoint at first observation and +1/+5/+30 minutes;
- quote event time, venue/tape, conditions, session/calendar, staleness, halt and correction view;
- candidate-set and selected-reference or missing-reference identities; and
- exact code/configuration/contract/calendar/reason/bounds/dataset-freeze identities.

Missing an element cannot be repaired from a trade, bar, another provider, a current symbol, a wall
clock, or a later correction. It produces the exact market reason plus one study reason.

## Metric calculation

**R:** Use canonical decimal prices and exact integer/rational arithmetic. Never route price or
return identity through binary floating point. For any positive prices `Pa` and `Pb`, retain the
exact rational basis-point return:

```text
returnBps(Pa,Pb) = 10000 * (Pb - Pa) / Pa
```

Display-only decimals round half-even to six places. The primary price at every instant is the
eligible NBBO midpoint selected by the accepted microstructure contract. Define:

- `Pc`: previous eligible regular-session close;
- `Ppre`: last eligible quote midpoint at or before trusted publication within the frozen backward
  search window;
- `Ppost`: first eligible quote midpoint at or after trusted publication within the frozen forward
  search window;
- `P0`: first eligible quote midpoint at or after the chosen primary PEAS observation anchor; and
- `P1`, `P5`, `P30`: eligible midpoint at the exact +1/+5/+30-minute targets under the frozen
  nearest/one-sided selection rule.

The mandatory movement metrics are:

```text
priorCloseToFirst = returnBps(Pc, P0)
releaseGap        = returnBps(Ppre, Ppost)
residual1         = returnBps(P0, P1)
residual5         = returnBps(P0, P5)
residual30        = returnBps(P0, P30)
```

A metric is null with a typed reason if either endpoint is missing or ineligible. Never calculate
from a bar close because a quote is missing. The separately labeled sensitivities are:

1. last eligible consolidated trade using the accepted condition/odd-lot/correction rules;
2. eligible bar references, with timeframe and adjustment identity;
3. alternate primary observation anchor;
4. `T0` only versus `T0+T1`;
5. regular versus pre/post-market; and
6. corrected view versus as-known view.

`E3` compares absolute midpoint change against the sum of half-spread uncertainty:

```text
informative5 = abs(P5-P0) > ((ask0-bid0) + (ask5-bid5)) / 2
```

Both quotes must be eligible, positive, two-sided, and non-crossed. Locked quotes may be analyzed
only if the market contract marks them eligible; equality in the formula is false. This metric does
not model fees, slippage, depth, borrow, or tradeability.

## Precommitted GO, NO_GO, and inconclusive thresholds

**R:** Use two-sided 95% Wilson score intervals for `E1`, `E2`, and `E3`, with
`z = 1.959963984540054`, success count `x`, and fixed `n=180`. Missing is not success, so the
denominator never shrinks. NIST documents Wilson intervals for binomial proportions; the formula,
constant, decimal precision, and rounding mode must be pinned in code and fixtures.

```text
p = x/n
d = 1 + z^2/n
center = (p + z^2/(2n)) / d
half = (z/d) * sqrt(p*(1-p)/n + z^2/(4n^2))
lower = max(0, center-half)
upper = min(1, center+half)
```

Evaluate with decimal precision of at least 34 significant digits, correctly rounded square root,
and round-half-even only when serializing 18 decimal places. Gate comparisons use those 18-place
canonical values, not displayed percentages.

| Gate | `GO` component | `NO_GO` component | Otherwise |
| --- | --- | --- | --- |
| Determinism `E4` | Exactly `180/180` stable selected-or-missing outputs across all required variants | Any identity, canonical bytes, selection, missing reason, or metric differs | No inconclusive state; any mismatch fails. |
| Completeness `E1` | Wilson lower bound `>= 0.75` | Wilson upper bound `< 0.75` | `INCONCLUSIVE` |
| Timeliness `E2` | Wilson lower bound `>= 0.70` for observation within 15 minutes | Wilson upper bound `< 0.70` | `INCONCLUSIVE` |
| Residual information `E3` | Wilson lower bound `>= 0.25` | Wilson upper bound `< 0.25` | `INCONCLUSIVE` |

Overall `GO` requires determinism and all three statistical components to be `GO`. Any deterministic
failure or any statistical component `NO_GO` yields overall `NO_GO`. All other combinations are
`INCONCLUSIVE`; no component can compensate for another. These are measurement-investment
thresholds for P2, not provider-selection, trading, cost, or model-promotion thresholds. Changing a
threshold after any selected market outcome is available invalidates the study.

Also fail the run contract before collection if the selected manifest is not exactly 180 unique
clusters, any lane/control count differs, P1-09 is not independently `GO`, the provider/fallback or
primary anchor is unfrozen, the freeze occurs after a selected release, or outcome fields enter the
sampling preimage.

## Missing data, outliers, multiple comparisons, and sensitivities

### Missing data

**R:** Primary proportion estimands treat missing/ambiguous evidence as not-success with `n=180`.
Movement distributions are available-case summaries with their exact numerator and the parallel
full-denominator missing count/reasons. No primary imputation is permitted.

Precommitted missingness sensitivities are:

1. worst case: every missing movement is non-informative;
2. bounded best case: every missing movement is informative, explicitly labeled as unattainable
   upper bound rather than an estimate;
3. `T0`-only complete cases;
4. primary-session complete cases;
5. lane/stratum-specific missingness; and
6. if justified without outcome-derived variables, inverse-probability-of-observation weighting
   using only frame/snapshot covariates, with model formula/configuration frozen before unblinding.

**D:** FDA statistical guidance states that analysis plans should prespecify sensitivity analyses
for assumptions about missing data and observational-study confounders and should be finalized
before unblinding. **R:** PEAS applies that general design principle without claiming this is a
regulated clinical study.

### Outliers and invalid facts

**R:** Valid extreme movements remain in every primary result. Do not trim, winsorize, sigma-filter,
or remove a cluster because its price move is large. Report medians, IQR, MAD, and the full min/max.
A separate sensitivity winsorizes valid returns at the predeclared sample 1st/99th percentiles using
type-7 quantiles, but cannot change a gate result. Impossible/nonpositive price, arithmetic overflow,
identity mismatch, or malformed data is invalid/missing with a reason, not an outlier.

### Multiple comparisons

The four gate decisions above are a fixed ordered decision rule, not a search over p-values. Secondary
hypothesis tests are exploratory. If reported, apply Holm's step-down adjustment at familywise
`alpha=0.05` to one fixed family of 24 slots:

- five movement metrics (`priorCloseToFirst`, `releaseGap`, `residual1`, `residual5`, `residual30`)
  in four actual-session groups = 20; and
- four paired quote-versus-trade comparisons = 4.

An unavailable slot receives `p=1`; the family size never shrinks. Sort by `(p,slotId)` and use the
original Holm procedure. Model-family, sector, cap, liquidity, provider, and control breakdowns are
descriptive with intervals and denominators, not additional significance claims.

### Deterministic intervals and sensitivity set

Use 10,000 stratified cluster-bootstrap replicates for medians, resampling within the three lanes.
The manifest freezes a 32-byte seed; replicate `i` derives its stream from
`SHA256("peas/study-bootstrap/v1" || seed || uint64be(i))`. Sampling uses rejection sampling from
unsigned 64-bit words to avoid modulo bias. Percentile endpoints use type-7 quantiles and half-even
six-decimal display rounding. Exact rerun must be byte-identical.

The complete precommitted sensitivity set is:

- alternate PEAS anchor and `captureMinusRetrievalMs`;
- NBBO quote primary versus separately labeled eligible trade and bar;
- `T0` versus `T0+T1`, planned versus actual session, and early-close/DST cases;
- as-known versus corrected view;
- provider disagreement and named secondary provider, without fallback;
- all-valid versus winsorized descriptive returns;
- missing-data bounds and eligible inverse-observation weighting; and
- unweighted total plus every lane/marginal stratum.

## Provider disagreement, fallback, and correction policy

**F:** While P1-09 is pending, no provider is authorized, Alpaca identities remain separate, FMP is
not SIP/NBBO-equivalent, and fallback cannot be selected automatically.

**R:** The run manifest must freeze exactly one primary provider/dataset/feed/endpoint/entitlement
policy before selection. A secondary discrepancy source is analyzed only if separately authorized
before outcomes. Provider results never merge, and the secondary source never fills a missing
primary quote. Equal facts retain independent provenance. A frozen comparison policy emits either
`agree`, `disagree`, or `not-comparable`; absence of the secondary source is `not-comparable`, not
agreement. Report all three counts against 180.

If the primary provider becomes unavailable after freeze, affected clusters are missing under that
source. Switching source or activating FMP fallback requires an explicit pre-outcome human decision,
a compatible study-contract amendment, and fresh review; it cannot rescue the current run after an
outcome exists.

Primary correction view is `as-known`: include only revisions whose authoritative durable capture
is no later than the metric cutoff. A later-arriving correction with an earlier effective time is
excluded and annotated. Corrected sensitivity uses revisions captured by exactly
`primaryAnchor + 604_800_000 ms` (seven 24-hour periods). Dataset freeze occurs only after the last
selected cluster reaches that cutoff. A provider that exposes only corrected-in-place history with
unknown arrival/revision semantics cannot satisfy as-known completeness; retain its corrected result
as a separately labeled sensitivity and count the primary as missing. A correction after the frozen
cutoff never changes the dataset version.

## Versioned freeze-manifest specification

**R:** Implement additive sidecars; do not add a PR 2C ledger fact kind or change a frozen port. A
run consists of three immutable, hash-linked records:

1. `StudyDesignV1`: accepted contract, algorithms, formulas, thresholds, bounds, and analysis plan;
2. `StudyFreezeManifestV1`: pre-outcome frame, snapshots, rank seed, provider/anchor policy, and the
   180 selected cluster entries; and
3. `StudyDatasetFreezeV1`: post-collection exact artifacts/reference/missing/metric records and
   attrition accounting, frozen before any conclusion is calculated.

The minimum exact semantic fields are:

```ts
type StudyFreezeManifestV1 = Readonly<{
  schemaVersion: 1;
  studyId: string;
  designVersion: string;
  acceptedAdrCommit: string;
  codeCommit: string;
  configurationDigest: string;
  analysisCodeDigest: string;
  contractIds: readonly string[];
  reasonCatalogId: string;
  boundsPolicyId: string;
  calendarSnapshotId: string;
  timezoneDatabaseVersion: string;
  scheduleSourcePolicyId: string;
  scheduleSourceObservationIds: readonly string[];
  entitlementSnapshotIds: readonly string[];
  providerSourcePolicyId: string;
  selectionPolicyId: string;
  primaryAnchorKind: "capture" | "retrieval";
  alternateAnchorRequired: true;
  readyAtMs: number;
  samplingFrameAsOfMs: number;
  freezePublishedAtMs: number;
  collectionStartSession: string;
  collectionEndSession: string;
  correctionLagMs: 604800000;
  targetClusters: 180;
  laneTargets: Readonly<{ standard: 120; specialized: 40; prospectiveControl: 20 }>;
  controlTargets: Readonly<{
    identityTransition: 5;
    scheduleUncertain: 5;
    sourceSparse: 5;
    liquidityTail: 5;
  }>;
  rankSeedHex: string;
  frameSnapshotId: string;
  frameDispositionCounts: readonly FrameDispositionCountV1[];
  selectedClusters: readonly StudyClusterFreezeEntryV1[];
  metricDefinitions: readonly StudyMetricDefinitionV1[];
  gateThresholds: readonly StudyGateThresholdV1[];
  missingPolicyId: string;
  outlierPolicyId: string;
  multiplicityPolicyId: string;
  correctionPolicyId: string;
  sensitivityPolicyId: string;
  expectedManifestId: string;
}>;
```

Each selected cluster entry binds:

- `clusterCandidateId`, `clusterId`, schedule observation, subject, issuer mapping, instrument and
  planned fiscal-period/date/session identities;
- immutable sampling snapshot, T-1 snapshot policy, lane/control assignment, all marginal strata,
  model-family authority/version/evidence, rank, allocation cell, and selection fraction;
- selected earnings source policy and expected source families;
- expected `marketReferenceJoinKey` derivation policy and primary/alternate trusted basis;
- exact prior-close/first/+1/+5/+30 interval IDs and quote/trade/bar reference kinds;
- provider/dataset/feed/endpoint/entitlement and selection-policy identities; and
- no outcome price, actual latency, actual source availability, event-time condition, result ID, or
  conclusion.

`StudyDatasetFreezeV1` adds, without changing the pre-outcome record:

- dataset freeze time/ID, collection code/config digest, execution IDs, and private raw-artifact
  inventory digests without provider bytes;
- exact source observations/revisions, `marketReferenceJoinKey`, market selected/missing/discrepancy
  result IDs, correction cutoffs, and calendar/session identities;
- metric records or stable missing reasons for every cluster/reference/window;
- planned/actual sessions, T-1/event-time annotations, attrition transition counts, and all
  denominators; and
- recomputed manifest ID and a proof that no design, frame, lane, threshold, provider, anchor, or
  policy field changed.

Derive IDs over validated RFC 8785 canonical values:

```text
studyDesignId  = "std1_" + H("peas/study-design/v1", design)
frameSnapshotId = "sfs1_" + H("peas/study-frame-snapshot/v1", frame)
clusterId      = "scl1_" + H("peas/study-cluster/v1", selectedEntryPreimage)
studyManifestId = "sfm1_" + H("peas/study-freeze-manifest/v1", manifestWithoutExpectedId)
datasetFreezeId = "sdf1_" + H("peas/study-dataset-freeze/v1", datasetFreeze)
```

Displayed IDs are always recomputed. Paths, URLs, credentials, raw provider bytes, account facts,
page tokens, insertion order, current wall time, computed outcomes, and human-readable conclusions
enter no design/frame/cluster identity.

## Closed study reason-code proposal

The integrated ADR may reconcile names, but the accepted catalog must be closed and must distinguish
frame disposition, annotation, metric missingness, and fatal contract failure.

| Code | Type | Exact trigger/treatment |
| --- | --- | --- |
| `study.frame-not-frozen` | fatal | Frame/snapshot/seed/provider/anchor policy is absent or mutable. |
| `study.freeze-after-outcome` | fatal | Freeze time is not before every selected release; reject the run. |
| `study.outcome-leakage` | fatal | Selection preimage contains an actual release, price, latency, condition, availability, correction, or result fact. |
| `study.frame-candidate-invalid` | frame disposition | Candidate schedule/issuer/instrument identity cannot validate; count before sampling. |
| `study.instrument-out-of-scope` | frame disposition | Frozen instrument is not a supported U.S.-listed common share/ADR. |
| `study.share-class-not-selected` | frame disposition | Another instrument won the precommitted share-class rule. |
| `study.duplicate-cluster` | fatal | Candidate/cluster identity repeats or conflicts. |
| `study.quota-insufficient` | fatal before start | Any lane/control allocation cannot reach its fixed target. |
| `study.rank-invalid` | fatal | Rank/seed/hash/allocation does not recompute. |
| `study.release-not-observed` | retained outcome | Selected release cancelled/postponed/outside window or never captured. |
| `study.schedule-changed` | annotation | Actual date/session differs from frozen planned value. |
| `study.t-minus-one-missing` | annotation/missing | Per-cluster T-1 snapshot cannot validate; never replaces cluster. |
| `study.identity-changed` | annotation/missing | Effective issuer/instrument/share-class facts changed after frame freeze. |
| `study.publication-time-insufficient` | metric missing | Publication is null/unknown/inferred for a primary latency metric. |
| `study.anchor-human-decision-unresolved` | fatal | Primary capture/retrieval choice is not frozen. |
| `study.anchor-clock-insufficient` | metric missing | Selected basis or clock/error evidence cannot support the metric. |
| `study.latency-ambiguous` | metric missing/not timely | Conservative latency interval straddles 15 minutes. |
| `study.prior-close-missing` | metric missing | No eligible prior close under frozen calendar/adjustment rules. |
| `study.reference-window-missing` | metric missing | Exact first/+1/+5/+30 reference is missing; retain interval and market reason. |
| `study.primary-provider-unfrozen` | fatal | Provider/dataset/feed/entitlement/fallback policy is not precommitted. |
| `study.provider-disagreement` | annotation | Frozen independently selected provider results disagree under comparison policy. |
| `study.provider-not-comparable` | annotation | Secondary result is absent or semantics do not permit comparison; not agreement. |
| `study.correction-semantics-unknown` | metric missing | Provider cannot support an as-known primary view. |
| `study.correction-after-cutoff` | annotation | Revision captured after the fixed cutoff is excluded. |
| `study.concurrent-event` | annotation | Predeclared event-time contamination rule matches; cluster stays in denominator. |
| `study.market-quality-degraded` | annotation/missing | Referenced market reason marks halt/stale/locked/crossed/one-sided/condition failure. |
| `study.outlier-retained` | annotation | Valid return is outside predeclared descriptive fence; no exclusion. |
| `study.metric-not-evaluable` | metric missing | Required validated endpoints are absent after more specific reasons are retained. |
| `study.replay-mismatch` | fatal | Any required order/page/restart/backend recomputation differs. |
| `study.bound-exceeded` | fatal | A declared byte/item/key/depth/string/window/state limit is one over. |

No free-form error, provider text, ticker, price, path, or credential enters a reason code or identity.

## Exact resource bounds

These are project-owned recommendations, not provider maxima. All totals are preflighted before
recursive validation, allocation, sorting, hashing, metric calculation, or partial emission.

| Boundary | Exact maximum or required value | One-over / boundary evidence |
| --- | ---: | --- |
| Target clusters | exactly 180; schema range 100..200 | 179/181 fail this design; 99/201 fail schema |
| Lane/control counts | 120/40/20 and 5 each | any +/-1 fails before collection |
| Candidate frame members | 8,192 | 8,193 -> `study.bound-exceeded` |
| Frame disposition/stratum cells | 2,048 | 2,049 -> reject |
| Selected cluster entry / complete manifest bytes | 64 KiB / 32 MiB | exact succeeds; +1 byte rejects |
| Dataset-freeze bundle bytes | 64 MiB | +1 byte rejects atomically |
| JSON depth / nodes / keys per object | 12 / 500,000 total / 64 | 13th depth, 500,001st node, or 65th key rejects |
| Generic array items | 256 except named bounded arrays | 257 rejects; frame/cluster arrays use their explicit limits |
| UTF-8 string / identifier / timestamp text | 4,096 / 512 / 64 bytes | +1 byte rejects before hashing |
| Contract/source/entitlement IDs | 64 each | 65 rejects |
| Reasons/metrics/sensitivities | 64 / 32 / 32 | +1 item rejects |
| References per cluster / total | 64 / 12,800 | 65 or 12,801 rejects |
| Annotations/revisions per cluster | 64 / 32 | +1 rejects; no silent truncation |
| Providers per policy / strata dimensions | 8 / 8 | 9 rejects |
| Collection sessions | exactly 65; <=120 calendar days | 64/66 invalid design; 120 days +1 ms rejects |
| Freeze lead | freeze before S6 open; collection begins S15 | equality at S6 open rejects; S15-1 ms cannot be a selected outcome |
| T-1 history / minimum valid liquidity sessions | 20 / 15 | 21 requested or 14 valid -> known liquidity forbidden |
| Timely threshold | `900,000 ms` inclusive | 900,000 timely; 900,001 not timely |
| Correction lag | `604,800,000 ms` inclusive | exact included; +1 ms excluded |
| Bootstrap replicates / Holm slots | 10,000 / 24 | 10,001 or 25 rejects the frozen analysis configuration |
| Canonical price/return rational components | 32 ASCII bytes each | 33 bytes or arithmetic overflow -> metric invalid |

## Required redistribution-safe synthetic cases

All fixture companies, symbols, schedules, filings, quotes, trades, bars, conditions, corporate
actions, and prices must be original synthetic material with invalid domains and
`classification:"synthetic"`. No provider example, real market record, account fact, or licensed
byte is required.

1. Exact 8,192-member frame and 8,193 one-over; exact 180 selected clusters and every 179/181,
   99/201, lane +/-1, and control +/-1 failure.
2. Every permutation of frame/array/object order produces the same ranks, Hamilton allocations,
   cluster IDs, and manifest ID.
3. Capacity-aware largest remainder covers exact ties, unknown cells, empty cells, family floors,
   iterative shortfall, and insufficient-lane rejection.
4. One candidate satisfies all four prospective controls and is assigned only
   `identity-transition`; event-time halt/missing/large move cannot create a control.
5. Same issuer/event with two share classes selects T-1 higher liquidity; exact tie uses instrument
   ID; post-freeze liquidity reversal cannot change the selection.
6. Sampling snapshot versus per-event T-1 drift proves later T-1 facts cannot alter rank, lane, or
   weight.
7. Cancelled, shifted, missed, duplicate, late, and ambiguous releases remain in all 180 denominator
   and cannot trigger replacement.
8. Regular, pre-market, post-market, early close, holiday, DST fold/gap, overnight, and unknown
   timestamps use the frozen calendar and never weekday arithmetic.
9. Publication/anchor uncertainty gives exact latency lower/upper bounds; 900,000 ms is timely,
   900,001 is late, overlap is ambiguous, and materially negative latency is invalid.
10. Capture and retrieval anchor deltas at every 1/5/30-minute boundary alter the appropriate
    movement windows but never sample membership.
11. Complete NBBO quote path calculates all five rational returns; missing quote with an available
    trade/bar stays missing in primary and appears only in the labeled sensitivity.
12. `informative5` is false below/equal to half-spread sum and true one canonical unit over;
    locked/crossed/one-sided/stale/halted cases follow frozen market eligibility.
13. Missing publication, prior close, first/+1/+5/+30 window, provider, entitlement, and correction
    semantics each yield a stable reason and still divide by 180.
14. Valid extreme returns stay primary; invalid/nonpositive/overflow prices become typed missing;
    winsorization cannot alter gate output.
15. As-known excludes a correction captured one unit after the metric cutoff; corrected sensitivity
    includes at exactly +604,800,000 ms and excludes one ms later.
16. Primary/secondary providers with equal values retain identities; disagreement annotates; absent
    secondary is not-comparable; missing primary cannot be filled by secondary.
17. Wilson threshold fixtures cover lower/upper equality and one representable unit around 0.75,
    0.70, and 0.25; missing always remains in `n=180`.
18. Bootstrap replicates are byte-identical across restart/backend; rejection sampling covers a
    discarded 64-bit draw; 10,000 exact and 10,001 one-over.
19. Holm has 24 fixed slots, tied p-values use slot ID, missing slot maps to one, and a 25th slot
    rejects rather than changing the family.
20. Every manifest byte/item/key/depth/node/string/ID/reference/revision/session/window bound has an
    exact and one-over case, including actual canonical bytes exceeding an in-limit declaration.
21. Outcome price, actual latency, correction, provider success, result ID, path, URL, credential,
    or current wall time injected into a pre-outcome entry rejects with no echo.
22. Memory/SQLite, page sizes `1`, `2`, `7`, and maximum, duplicate delivery, correction arrival,
    fixture order, restart, and repeated analysis produce identical selected-or-missing results and
    dataset freeze identity.

## Integration handoff and unresolved decisions

1. `HUMAN_DECISION_REQUIRED`: state the intended scientific claim and select durable capture or
   retrieval completion as primary. The other remains mandatory sensitivity.
2. `P1_09_PENDING`: no run-specific provider, feed, fallback, entitlement, or acquisition may be
   frozen until the human-owned gate and independent review return `GO`.
3. Contract integration must reconcile the exact interval selector, staleness, quote/trade/bar,
   calendar, condition, and correction rules with the independent microstructure report. This report
   never authorizes a silent substitute.
4. Freeze one schedule-source policy before frame construction; calendar-source success or coverage
   may not be chosen after outcomes.
5. Preserve this report's selection/denominator/threshold semantics if filenames or identity fields
   are reconciled. A semantic change after outcomes requires a new study, not a manifest revision.

All non-anchor-dependent recorded/offline contract, validator, synthetic-fixture, and deterministic
test work may continue. ADR 0010 cannot become `Accepted` with an implicit anchor, and P2 cannot
start while P1-09 is pending.

## Official and primary source register

All external sources below were accessed `2026-07-23`. They support only the stated external fact;
sample counts, thresholds, algorithms, and reason codes above are PEAS recommendations.

- [SEC Search Filings and SIC list](https://www.sec.gov/search-filings) -- SEC describes SIC codes
  as indicating a company's type of business and exposes CIK/ticker/company filing search; live page,
  version not displayed.
- [SEC EDGAR Application Programming Interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) --
  SEC describes submissions data containing current/former names, exchanges, and tickers and states
  that submissions JSON updates as filings disseminate; page last reviewed/updated 2025-04-08.
- [Nasdaq Equity 1 definitions](https://listingcenter.nasdaq.com/rulebook/nasdaq/rules/Nasdaq%20Equity%201) --
  official rulebook definitions for pre-market 04:00--09:30, regular 09:30--16:00, and post-market
  16:00--20:00 Eastern; current rule page includes 2026 amendments.
- [NYSE Holidays & Trading Hours](https://www.nyse.com/trade/hours-calendars) -- official 2026--2028
  holiday and early-close calendar; live page, version not displayed.
- [NIST/SEMATECH e-Handbook: confidence intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm) --
  official Wilson/binomial interval discussion; live handbook page, version not displayed.
- [FDA/ICH E8(R1), General Considerations for Clinical Studies](https://www.fda.gov/media/157560/download) --
  official guidance states that sensitivity analyses for missing-data assumptions should be
  prespecified and analysis details fixed before study results are known; April 2022 guidance PDF.
  PEAS uses the general anti-leakage principle only.
- [Holm, "A Simple Sequentially Rejective Multiple Test Procedure"](https://doi.org/10.2307/4615733) --
  primary 1979 paper defining the fixed-family step-down procedure; DOI record.
