# No-trade policy v0.1 candidate disposition

- Verdict: `ADOPT_WITH_CHANGES`
- Decision date: 2026-07-19
- Reviewed source branch: `dev/pr-2b-sec-fixtures`
- Reviewed source HEAD: `21fa58b9114b5b9ea107193eb324e03df1dcb657`
- Comparison baseline: `origin/main@c51758a1058b86730e19185b98fcd448d9ff533a`
- Effect authorization: none
- Normative status: candidate research only

## Authority and scope

This disposition preserves useful pre-existing research without accepting it as the PR 2D contract.
The copied files under [`candidates/no-trade-v0.1`](candidates/no-trade-v0.1) are byte-for-byte
historical candidate inputs. They are non-normative, authorize no financial effect, and must not be
used directly as an executable policy, study manifest, market-reference selector, or provider
fallback policy.

ADR 0010 and its independent contract review own the final PR 2D universe, study strata,
market-reference quality rules, missing-data reasons, thresholds, snapshot schemas, and leakage
controls. A future P4/P5 contract owns model and trade eligibility. When this candidate conflicts
with accepted ADRs, frozen contracts, or the current roadmap, those accepted sources prevail.

## Reviewed candidate inputs

| Preserved candidate | SHA-256 | Size | Disposition |
| --- | --- | ---: | --- |
| [`no-trade-universe-policy.md`](candidates/no-trade-v0.1/no-trade-universe-policy.md) | `22837AA14535E09B1177ABCDEB4E393E7FB7BFC4F2054177E2E170F8816C408E` | 15,765 bytes | `ADOPT_WITH_CHANGES` |
| [`no-trade-policy.v1.json`](candidates/no-trade-v0.1/no-trade-policy.v1.json) | `896E40297A51009297A4AAB0988E26DC0302BE9506367A739A1DBDA8BEF60862` | 7,093 bytes | `ADOPT_WITH_CHANGES` |
| [`no-trade-blueprint.html`](candidates/no-trade-v0.1/no-trade-blueprint.html) | `75B03F4AEBAD8F732FD68F19C8A896305AA2C18330280B54F310D87AAF35CBCF` | 30,849 bytes | `ADOPT_WITH_CHANGES`; derived orientation only |

The source checkout's dirty `docs/project-board.json` and `docs/project-roadmap.md` diffs are
explicitly rejected and were not copied. Relative to the comparison baseline, those diffs regress
the recorded PR 2B/PR 2C state, replace the current focus with an obsolete branch, remove the
P1-07/P1-08/P1-09/P1-10 sequence, duplicate P1-07 with a proposed P2-00 gate, and attempt to add
model/no-trade fields to P1-05. Any future board or roadmap reference to this research must be made
as a narrow edit on the latest `origin/main`; none of the rejected dirty diff is reusable.

## Mechanical validation

The machine-readable candidate parses as JSON and contains:

- five declared states;
- six declared gates;
- 25 unique reason codes;
- ten model-family candidates;
- no reason referring to an unknown gate or state;
- no seed example referring to an unknown reason; and
- a sampling target of 180 clusters whose `120 + 40 + 20` allocation sums exactly.

The Markdown companion's relative links resolve within the preserved candidate directory. The HTML
contains no duplicate or missing internal anchor, external script or stylesheet, network/storage
call, credential-like value, or provider data. Its JavaScript only performs local filtering. This
makes it safe to preserve, but not normative: it duplicates policy values and can drift from the
Markdown and JSON. If an interactive view is retained after ADR 0010, it should be regenerated or
verified from the accepted source rather than edited as an independent contract.

The byte-for-byte historical HTML archive is narrowly excluded from Biome formatting and linting.
It contains pre-existing accessibility/style findings that cannot be repaired without changing the
recorded archive hash. Any future generated interactive view must pass the then-current repository
format and lint gates as a new derived artifact.

## Section-by-section disposition

| Candidate provision | Location | Verdict | Required treatment |
| --- | --- | --- | --- |
| Capture broadly; a no-trade or observe-only label does not suppress evidence | Markdown lines 9-23; JSON `principles.captureFirst` and `principles.noTradeSuppressesCapture` | `ADOPT` | Carry into ADR 0010 as a study invariant. Missing, degraded, excluded, and control clusters remain accounted for. |
| Capture, model, and trade eligibility are different questions | Markdown lines 14-23 | `ADOPT_WITH_CHANGES` | Represent them as independent dimensions. Do not encode them as one mutually exclusive state. PR 2D may freeze study admission and data quality; it must leave future trade eligibility unevaluated. |
| Single `states` list containing `capture_only`, `observe_only`, `model_eligible`, `no_trade`, and `trade_eligible` | JSON `states` | `REJECT` | A model-eligible event can simultaneously be no-trade, so the list loses information. Replace it in any future normative schema with exact orthogonal fields and nullability. |
| Earnings/price-correlation motivation | Markdown lines 25-36 | `ADOPT_WITH_CHANGES` | Retain only as non-normative research context. It neither selects the P2 sample nor supplies a success threshold. |
| Security and venue gate | Markdown lines 43-61; JSON `security_venue` reasons | `ADOPT_WITH_CHANGES` | Use deterministic instrument/identity facts as prospective strata or recorded reasons. Do not retrospectively remove attempted clusters, and do not infer a trade decision in PR 2D. |
| Quote freshness, two-sidedness, session, halt, locked/crossed, and price-discovery facts | Markdown lines 63-87 and 129-143 | `ADOPT_WITH_CHANGES` | ADR 0010 must define these as market-reference eligibility, trust, missingness, or sensitivity semantics. A market-data quality result must not silently become a financial-effect veto. |
| `$5` price, `$5m`/0.5% dollar-volume capacity, 50/100 bps spread, 10% depth, borrow, three-contributor consensus, 12-event history, and two-fold persistence thresholds | Markdown lines 69-81 and 145-160; JSON `provisionalThresholds` | `REJECT` from PR 2D | Preserve only as provisional future P4/P5 or shadow/paper research. They are not P2 study success, completeness, market-reference validity, or exclusion thresholds. Quote staleness ceilings are a separate ADR 0010 decision. |
| Prospective expectation and evidence-integrity gate | Markdown lines 89-100 | `ADOPT_WITH_CHANGES` | Record available evidence descriptively where useful, but do not require P3 expectation snapshots for P2 admission. `origin/main` schedules prospective expectation snapshots after P2-01. Missing expectations must remain visible and cannot remove a P2 cluster from its denominator. |
| Specialized model-family list | Markdown lines 102-127; JSON `modelFamilies` | `ADOPT_WITH_CHANGES` | Use as candidate sampling labels only. Every label needs an authority, version, effective time, and evidence. It does not prove model or trade eligibility. |
| Event contamination and unstable discovery | Markdown lines 129-143 | `ADOPT_WITH_CHANGES` | Freeze annotation and sensitivity rules before outcomes. Naturally occurring event-time conditions cannot be used retrospectively to fill a control quota, and affected clusters remain in denominators. |
| Anti-post-outcome promotion rule | Markdown lines 147-160 | `ADOPT` | Thresholds must be registered before the phase that evaluates them. PR 2D separately freezes its P2 study thresholds; later P5 thresholds remain explicitly deferred. |
| MSTR/APGE and other named examples | Markdown lines 162-185; JSON `seedReviewExamples` | `ADOPT_WITH_CHANGES` | Keep only as illustrative, effective-dated review seeds with source evidence. Never turn a ticker seed into a permanent blacklist or an executable current decision. |
| `NT_*` registry | Markdown lines 187-201; JSON `reasonCodes` | `ADOPT_WITH_CHANGES` | Split semantics and namespaces. PR 2D needs market-reference/study quality and missingness reasons that do not imply a trade decision. `NT_*` remains candidate P4/P5 classification research. Any executable registry needs exact schemas, effective time, version, source identities, bounds, and exact/one-over tests. |
| Target approximately 180 clusters split 120 standard / 40 specialized / 20 controls | Markdown lines 203-218; JSON `forwardRunSamplingTarget` | `ADOPT_WITH_CHANGES` | Carry forward as a candidate allocation inside the roadmap's 100-200 range. ADR 0010 must decide the final allocation only after adding a frozen frame, as-of time, cluster definition, quotas, deterministic selection, replacement rules, denominators, weighting, and attrition handling. |
| T-1 universe snapshot and event-time eligibility snapshot | Markdown lines 214-218 | `ADOPT_WITH_CHANGES` | Implement through a new bounded, versioned study manifest or additive sidecar joined through existing identities. Do not change the frozen observation-ledger union or kernel ports. |
| Add model-family and no-trade fields to the observation telemetry contract | Markdown line 224 and dirty P1-05 board change | `REJECT` | ADR 0009 defines an exact closed V1 fact union and says telemetry is not an EventDraft, reducer, or manifest field. PR 2D must use the existing `marketReferenceJoinKey` and additive provider-neutral contracts instead. |

## Required leakage correction

The candidate's 20 hard or event-specific controls cannot be implemented as a quota filled after
observing provider coverage, release latency, price movement, halts, missing references, or other
event outcomes. ADR 0010 must make all of the following explicit before P2 collection:

1. Freeze the eligible issuer-event frame, frame construction code/configuration identity, and
   frame as-of time.
2. Define an earnings cluster and the handling of multiple releases, revisions, symbols, and share
   classes.
3. Separate prospectively identifiable control candidates from naturally occurring event-time
   control labels.
4. Select prospective candidates using a deterministic algorithm with a recorded seed or a fully
   enumerated rule before outcomes are available.
5. Record fixed per-stratum targets or deterministic allocation rules across sector, market cap,
   liquidity, session, and model-family candidates.
6. Freeze replacement, non-response, duplicate-event, cancellation, and attrition rules. A failed
   or missing cluster remains in its original denominator.
7. Assign halt, contamination, stale/missing reference, correction, and disagreement labels only
   under precommitted rules; never select extra events after the fact to reach 20.
8. Report per-stratum denominators. Because specialized candidates and controls are intentionally
   oversampled, use declared stratum weights for population estimates or label the results as
   stratified/descriptive rather than population-representative.
9. Freeze primary, secondary, completeness, success, failure, and inconclusive thresholds before
   any study conclusion is calculated. Do not reuse the candidate's future trading thresholds for
   this purpose.

## Frozen-port and PR 2C compatibility

The candidate's useful snapshots must not modify `ObservationLedgerFactsV1`, EventDraft, reducer
inputs, ArtifactStore ports, deterministic-kernel ports, existing migrations, or existing manifest
identities. In particular:

- ADR 0009's observation ledger is an exact, closed, schema-V1 causal bundle;
- unknown fields and fact kinds reject;
- the existing selection record already freezes the subject, issuer mapping, selected source
  observation/version, trusted observation basis, and optional `marketReferenceJoinKey`;
- market evidence must remain an independent source family joined through that key; and
- study/model/trade labels must not contaminate earnings-event or provider evidence-bundle identity.

ADR 0010 may define additive provider-neutral `StudyFreezeManifestV1`, `UniverseSnapshotV1`, or
`EligibilitySnapshotV1`-style contracts, subject to its own exact bounds and review. Such records
should reference existing subject, issuer mapping, source observation/version, artifact, and
market-reference identities. They must not claim to be new PR 2C ledger fact variants.

## Import decision and PR 2D handoff

All three preserved files are safe to retain by the recorded hashes as candidate research: they
contain no secrets, account material, licensed provider bytes, or live integration. None is safe to
accept or execute unchanged.

The preferred PR 2D use is:

- use the Markdown and JSON as traceable inputs to the independent event-study/data-quality
  workstream;
- treat the HTML only as a derived orientation aid;
- adopt capture-first accounting, prospective strata, negative controls, T-1 universe state, and
  event-time data-quality annotations after the corrections above;
- freeze P2 sampling, completeness, and outcome thresholds in ADR 0010;
- defer model promotion, execution, cost, and trade eligibility to P4/P5 or later; and
- record any ADR 0010 disagreement with this candidate explicitly rather than silently copying its
  numbers or reason codes.

This disposition resolves whether the dirty candidate should be preserved. It does not resolve the
human-owned market-data entitlement gate and does not authorize live acquisition or spending.
