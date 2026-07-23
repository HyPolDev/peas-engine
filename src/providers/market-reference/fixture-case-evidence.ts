export const MARKET_CORE_FIXTURE_CASE_IDS = Object.freeze([
  "R-01",
  "R-02",
  "R-03",
  "R-04",
  "R-05",
  "R-06",
  "R-07",
  "R-08",
  "I-01",
  "I-02",
  "I-03",
  "C-01",
  "C-02",
  "C-03",
  "C-04",
  "M-01",
  "M-02",
  "M-03",
  "M-04",
  "D-01",
  "D-02",
  "D-03",
] as const);

export type MarketCoreFixtureCaseIdV1 = (typeof MARKET_CORE_FIXTURE_CASE_IDS)[number];

export type MarketCoreFixtureCaseEvidenceV1 = Readonly<{
  caseId: MarketCoreFixtureCaseIdV1;
  enforcementOwner: "market-core";
  testVectorId: `core:${MarketCoreFixtureCaseIdV1}:v1`;
  expectedOutcome: string;
}>;

const EXPECTED_OUTCOMES = Object.freeze({
  "R-01": "correction-present-recorded-primary",
  "R-02": "original-primary-correction-corrected",
  "R-03": "primary-retains-corrected-removes-cancelled",
  "R-04": "one-fact-two-deliveries",
  "R-05": "market.provider-observation-invalid:conflicting-content",
  "R-06": "correction-chain-fails-closed",
  "R-07": "cutoff-minus-and-equal-admitted-plus-one-excluded",
  "R-08": "corrected-only-before-equal-admitted-after-unknown",
  "D-01": "agree-provenance-distinct",
  "D-02": "disagree-primary-unchanged",
  "D-03": "primary-missing-no-fallback",
  "C-01": "split-crossing-primary-missing-adjusted-exact",
  "C-02": "cash-distribution-adjusted-sensitivity",
  "C-03": "unsupported-action-crossing-no-guess",
  "C-04": "action-revision-primary-corrected-distinct",
  "I-01": "symbol-change-continuity-at-effective-boundary",
  "I-02": "reused-symbol-no-continuity",
  "I-03": "instrument-ambiguous-and-continuity-unresolved",
  "M-01": "strict-pre-origin-and-as-of-destinations",
  "M-02": "durable-capture-primary-differs-retrieval",
  "M-03": "independent-statuses-denominator-retained",
  "M-04": "quote-missing-no-trade-or-bar-fallback",
} as const satisfies Readonly<Record<MarketCoreFixtureCaseIdV1, string>>);

export const MARKET_CORE_FIXTURE_CASE_EVIDENCE = Object.freeze(
  Object.fromEntries(
    MARKET_CORE_FIXTURE_CASE_IDS.map((caseId) => [
      caseId,
      Object.freeze({
        caseId,
        enforcementOwner: "market-core",
        testVectorId: `core:${caseId}:v1`,
        expectedOutcome: EXPECTED_OUTCOMES[caseId],
      }),
    ]),
  ) as Readonly<Record<MarketCoreFixtureCaseIdV1, MarketCoreFixtureCaseEvidenceV1>>,
);
