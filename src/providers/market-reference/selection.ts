import { canonicalJson, type JsonValue } from "../../core/json.js";
import { snapshotExactNormalizerInput } from "../normalizer-input.js";
import {
  classifyQuoteAge,
  validateCandidateCount,
  validateDeliveryCount,
  validateRevisionDepth,
} from "./bounds.js";
import {
  type CanonicalMarketReasonV1,
  type CanonicalRationalV1,
  COMPLETED_BAR_AGE_NS,
  compareCanonicalReasons,
  EXTENDED_QUOTE_AGE_NS,
  EXTENDED_TRADE_AGE_NS,
  type MarketCandidateOutcomeV1,
  MarketContractError,
  type MarketPayloadV1,
  type MarketProviderDiscrepancyV1,
  type MarketReferenceKindV1,
  type MarketReferenceResultV1,
  type MarketSelectionContextV1,
  type MarketSelectionRequestV1,
  type MarketSourceKeyV1,
  marketReason,
  type NormalizedMarketFactV1,
  REGULAR_QUOTE_AGE_NS,
  REGULAR_TRADE_AGE_NS,
} from "./contracts.js";
import {
  admittedRevisionIds,
  deriveCandidateSetHash,
  deriveMarketIntervalKey,
  deriveMissingReferenceId,
  deriveProviderDiscrepancyId,
  deriveRecordedCorpusCutoffId,
  deriveRecordedCorpusSnapshotId,
  deriveSelectedReferenceId,
  deriveSelectionPolicyId,
  validateMarketResultAsOfBasis,
} from "./identity.js";
import {
  compareCanonicalDecimals,
  parseEpochNanoseconds,
  quoteMidpoint,
  requirePositiveDecimal,
  validateNormalizedMarketFactIdentity,
} from "./normalization.js";

type ClassifiedFact = Readonly<{
  fact: NormalizedMarketFactV1;
  outcome: MarketCandidateOutcomeV1;
}>;

const ID_PATTERNS = Object.freeze({
  interval: /^mik1_[0-9a-f]{64}$/u,
  join: /^mrj1_[0-9a-f]{64}$/u,
  policy: /^msp1_[0-9a-f]{64}$/u,
  corpus: /^mcs1_[0-9a-f]{64}$/u,
  cutoff: /^mcc1_[0-9a-f]{64}$/u,
  hash: /^[0-9a-f]{64}$/u,
});

const REASON_PRIORITY = new Map<string, number>([
  ["market.bound-exceeded", 1],
  ["market.input-invalid", 2],
  ["market.identity-invalid", 3],
  ["market.source-contract-invalid", 4],
  ["market.entitlement-invalid", 5],
  ["market.dataset-feed-mismatch", 6],
  ["market.artifact-invalid", 7],
  ["market.artifact-read-failed", 8],
  ["market.page-chain-invalid", 9],
  ["market.provider-observation-invalid", 10],
  ["market.decimal-invalid", 11],
  ["market.timestamp-invalid", 12],
  ["market.clock-basis-invalid", 13],
  ["market.anchor-policy-invalid", 14],
  ["market.sequence-regression", 15],
  ["market.replay-incompatible", 16],
  ["market.silent-fallback-forbidden", 17],
  ["market.revision-invalid", 18],
  ["market.selection-conflict", 19],
  ["market.condition-unknown", 100],
  ["market.timestamp-insufficient", 101],
  ["market.clock-basis-incompatible", 102],
  ["market.sequence-insufficient", 103],
  ["market.correction-view-unknown", 104],
  ["market.instrument-invalid", 105],
  ["market.coverage-insufficient", 106],
  ["market.currency-unsupported", 107],
  ["market.corporate-action-unresolved", 108],
  ["market.corporate-action-crossing", 109],
  ["market.adjustment-unknown", 110],
  ["market.session-unknown", 111],
  ["market.session-closed", 112],
  ["market.session-transition", 113],
  ["market.overnight-primary-forbidden", 114],
  ["market.quote-halt", 120],
  ["market.quote-luld-nonexecutable", 121],
  ["market.quote-one-sided", 122],
  ["market.quote-not-consolidated", 123],
  ["market.quote-condition-ineligible", 124],
  ["market.quote-size-invalid", 125],
  ["market.quote-crossed", 126],
  ["market.quote-stale", 127],
  ["market.no-eligible-quote", 128],
  ["market.trade-condition-ineligible", 130],
  ["market.trade-odd-lot", 131],
  ["market.trade-cancelled", 132],
  ["market.no-eligible-trade", 133],
  ["market.bar-interval-future", 140],
  ["market.bar-stale", 141],
  ["market.no-eligible-bar", 142],
  ["market.prior-close-missing", 150],
]);

function fail(code: "market.input-invalid" | "market.identity-invalid"): never {
  throw new MarketContractError(marketReason(code));
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareOutcome(left: MarketCandidateOutcomeV1, right: MarketCandidateOutcomeV1): number {
  return (
    compareUtf8(left.providerObservationId, right.providerObservationId) ||
    compareUtf8(left.revisionId, right.revisionId) ||
    compareUtf8(left.normalizedMarketFactId, right.normalizedMarketFactId) ||
    compareUtf8(
      canonicalJson({
        eligibilityStatus: left.eligibilityStatus,
        reason: left.reason,
        diagnostics: left.diagnostics,
      } as unknown as JsonValue),
      canonicalJson({
        eligibilityStatus: right.eligibilityStatus,
        reason: right.reason,
        diagnostics: right.diagnostics,
      } as unknown as JsonValue),
    )
  );
}

function diagnostic(
  code: "market.quote-quality-degraded" | "market.evidence-quality-degraded",
  detail:
    | Readonly<{ qualityKind: "locked" | "slow" | "luld-limit-state" }>
    | Readonly<{ evidenceQualityKind: "sip-time-only" | "native-sequence-unchecked" }>,
): CanonicalMarketReasonV1 {
  return marketReason(code, detail);
}

function outcome(
  fact: NormalizedMarketFactV1,
  reason: CanonicalMarketReasonV1 | null,
  diagnostics: readonly CanonicalMarketReasonV1[] = [],
): MarketCandidateOutcomeV1 {
  if (fact.normalizedMarketFactId === null) fail("market.input-invalid");
  const sortedDiagnostics = [...diagnostics].sort(compareCanonicalReasons);
  return Object.freeze({
    providerObservationId: fact.providerObservationId,
    revisionId: fact.revisionId,
    normalizedMarketFactId: fact.normalizedMarketFactId,
    eligibilityStatus:
      reason === null ? (sortedDiagnostics.length === 0 ? "eligible" : "degraded") : "ineligible",
    reason,
    diagnostics: Object.freeze(sortedDiagnostics),
  });
}

function referencePayloadKind(referenceKind: MarketReferenceKindV1): MarketPayloadV1["kind"] {
  if (referenceKind === "quote-nbbo-midpoint" || referenceKind === "bolo") return "quote";
  if (
    referenceKind === "trade-last-eligible-consolidated" ||
    referenceKind === "opening-trade" ||
    referenceKind === "reopening-trade" ||
    referenceKind === "closing-trade" ||
    referenceKind === "final-eligible-trade-close"
  )
    return "trade";
  if (referenceKind === "bar-one-minute-completed-close" || referenceKind === "daily-bar-close")
    return "bar";
  if (referenceKind === "prior-listing-official-close") return "prior-close";
  return "official-value";
}

function matchesReferenceKind(
  payload: MarketPayloadV1 | null,
  referenceKind: MarketReferenceKindV1,
): boolean {
  if (payload === null || payload.kind !== referencePayloadKind(referenceKind)) return false;
  if (payload.kind === "quote") {
    return payload.quoteKind === (referenceKind === "bolo" ? "bolo" : "nbbo");
  }
  if (payload.kind === "trade") {
    const expected = {
      "trade-last-eligible-consolidated": "last-eligible",
      "opening-trade": "opening",
      "reopening-trade": "reopening",
      "closing-trade": "closing",
      "final-eligible-trade-close": "final-close",
    } as const;
    return payload.tradeKind === expected[referenceKind as keyof typeof expected];
  }
  if (payload.kind === "bar") {
    return (
      payload.barKind ===
      (referenceKind === "bar-one-minute-completed-close" ? "one-minute" : "daily")
    );
  }
  return true;
}

function ageLimit(
  fact: NormalizedMarketFactV1,
  referenceKind: MarketReferenceKindV1,
): bigint | null {
  if (referenceKind === "bar-one-minute-completed-close") return COMPLETED_BAR_AGE_NS;
  const isQuote = referenceKind === "quote-nbbo-midpoint" || referenceKind === "bolo";
  if (fact.sessionKind === "regular-continuous") {
    return isQuote ? REGULAR_QUOTE_AGE_NS : REGULAR_TRADE_AGE_NS;
  }
  if (fact.sessionKind === "extended-pre" || fact.sessionKind === "extended-post") {
    return isQuote ? EXTENDED_QUOTE_AGE_NS : EXTENDED_TRADE_AGE_NS;
  }
  return null;
}

function applicableTime(fact: NormalizedMarketFactV1): bigint {
  if (fact.payload?.kind === "bar") return parseEpochNanoseconds(fact.payload.barEndNs);
  return parseEpochNanoseconds(fact.eventTime.epochNs);
}

function classifyPayload(
  fact: NormalizedMarketFactV1,
  referenceKind: MarketReferenceKindV1,
  targetNs: bigint,
): ClassifiedFact {
  const payloadKind = referencePayloadKind(referenceKind);
  if (fact.payload?.kind !== payloadKind || !matchesReferenceKind(fact.payload, referenceKind)) {
    return { fact, outcome: outcome(fact, marketReason("market.silent-fallback-forbidden")) };
  }
  if (fact.currency !== "USD") {
    return { fact, outcome: outcome(fact, marketReason("market.currency-unsupported")) };
  }
  if (fact.sessionKind === "overnight") {
    return { fact, outcome: outcome(fact, marketReason("market.overnight-primary-forbidden")) };
  }
  if (fact.sessionKind === "calendar-closed") {
    return { fact, outcome: outcome(fact, marketReason("market.session-closed")) };
  }
  if (fact.sessionKind === "unknown") {
    return {
      fact,
      outcome: outcome(
        fact,
        marketReason("market.session-unknown", {
          sessionFailureKind: "timestamp-or-coverage-unknown",
        }),
      ),
    };
  }

  const payload = fact.payload;
  const precisionNs = BigInt(fact.eventTime.precisionNs);
  const quoteTrustedSemantic =
    fact.eventTime.semantic === "participant-publication" ||
    fact.eventTime.semantic === "provider-documented-event";
  const tradeTrustedSemantic =
    quoteTrustedSemantic || fact.eventTime.semantic === "member-execution";
  if (
    (payload.kind === "quote" && (!quoteTrustedSemantic || precisionNs > 1_000_000n)) ||
    (payload.kind === "trade" && (!tradeTrustedSemantic || precisionNs > 1_000_000n))
  ) {
    return {
      fact,
      outcome: outcome(
        fact,
        marketReason("market.timestamp-insufficient", {
          timestampFailureKind:
            precisionNs > 1_000_000n ? "precision-insufficient" : "semantic-untrusted",
        }),
      ),
    };
  }
  if (payload.kind === "quote") {
    if (payload.halted || fact.sessionKind === "halted") {
      return { fact, outcome: outcome(fact, marketReason("market.quote-halt")) };
    }
    if (!payload.explicitConsolidatedNbbo) {
      return { fact, outcome: outcome(fact, marketReason("market.quote-not-consolidated")) };
    }
    if (
      payload.bidPrice.coefficient === "0" ||
      payload.askPrice.coefficient === "0" ||
      payload.bidSize.coefficient === "0" ||
      payload.askSize.coefficient === "0"
    ) {
      return { fact, outcome: outcome(fact, marketReason("market.quote-one-sided")) };
    }
    requirePositiveDecimal(payload.bidPrice);
    requirePositiveDecimal(payload.askPrice);
    requirePositiveDecimal(payload.bidSize);
    requirePositiveDecimal(payload.askSize);
    if (payload.condition === "unknown") {
      return { fact, outcome: outcome(fact, marketReason("market.condition-unknown")) };
    }
    if (payload.condition === "ineligible") {
      return { fact, outcome: outcome(fact, marketReason("market.quote-condition-ineligible")) };
    }
    if (payload.luldState === "non-executable") {
      return { fact, outcome: outcome(fact, marketReason("market.quote-luld-nonexecutable")) };
    }
    const comparison = compareCanonicalDecimals(payload.bidPrice, payload.askPrice);
    if (comparison > 0) {
      return { fact, outcome: outcome(fact, marketReason("market.quote-crossed")) };
    }
    const diagnostics: CanonicalMarketReasonV1[] = [];
    if (comparison === 0) {
      diagnostics.push(diagnostic("market.quote-quality-degraded", { qualityKind: "locked" }));
    }
    if (payload.slow) {
      diagnostics.push(diagnostic("market.quote-quality-degraded", { qualityKind: "slow" }));
    }
    if (payload.luldState === "limit") {
      diagnostics.push(
        diagnostic("market.quote-quality-degraded", { qualityKind: "luld-limit-state" }),
      );
    }
    if (fact.providerSequence?.trustClass === "native-unchecked") {
      diagnostics.push(
        diagnostic("market.evidence-quality-degraded", {
          evidenceQualityKind: "native-sequence-unchecked",
        }),
      );
    }
    const age = targetNs - applicableTime(fact);
    const quoteAgeReason =
      age >= 0n &&
      (fact.sessionKind === "regular-continuous" ||
        fact.sessionKind === "extended-pre" ||
        fact.sessionKind === "extended-post")
        ? classifyQuoteAge(fact.sessionKind === "regular-continuous" ? "regular" : "extended", age)
        : null;
    if (quoteAgeReason !== null) {
      return { fact, outcome: outcome(fact, quoteAgeReason) };
    }
    return { fact, outcome: outcome(fact, null, diagnostics) };
  }

  if (payload.kind === "trade") {
    if (payload.oddLot) {
      return { fact, outcome: outcome(fact, marketReason("market.trade-odd-lot")) };
    }
    if (payload.updatesConsolidatedLast !== true) {
      return {
        fact,
        outcome: outcome(
          fact,
          marketReason("market.trade-condition-ineligible", {
            tradeConditionFailureKind:
              payload.updatesConsolidatedLast === "state-insufficient"
                ? "state-insufficient"
                : "does-not-update-last",
          }),
        ),
      };
    }
    const age = targetNs - applicableTime(fact);
    const limit = ageLimit(fact, referenceKind);
    if (age >= 0n && limit !== null && age > limit) {
      return { fact, outcome: outcome(fact, marketReason("market.no-eligible-trade")) };
    }
    return { fact, outcome: outcome(fact, null) };
  }

  if (payload.kind === "bar") {
    if (payload.adjustmentMode !== "raw") {
      return { fact, outcome: outcome(fact, marketReason("market.silent-fallback-forbidden")) };
    }
    const barEnd = parseEpochNanoseconds(payload.barEndNs);
    if (barEnd > targetNs) {
      return { fact, outcome: outcome(fact, marketReason("market.bar-interval-future")) };
    }
    if (targetNs - barEnd > COMPLETED_BAR_AGE_NS) {
      return { fact, outcome: outcome(fact, marketReason("market.bar-stale")) };
    }
    return { fact, outcome: outcome(fact, null) };
  }

  return { fact, outcome: outcome(fact, null) };
}

function defaultMissingReason(referenceKind: MarketReferenceKindV1): CanonicalMarketReasonV1 {
  if (referenceKind === "quote-nbbo-midpoint" || referenceKind === "bolo")
    return marketReason("market.no-eligible-quote");
  if (
    referenceKind === "trade-last-eligible-consolidated" ||
    referenceKind === "opening-trade" ||
    referenceKind === "reopening-trade" ||
    referenceKind === "closing-trade" ||
    referenceKind === "final-eligible-trade-close"
  ) {
    return marketReason("market.no-eligible-trade");
  }
  if (referenceKind === "bar-one-minute-completed-close" || referenceKind === "daily-bar-close") {
    return marketReason("market.no-eligible-bar");
  }
  if (referenceKind === "prior-listing-official-close") {
    return marketReason("market.prior-close-missing", { priorCloseFailureKind: "absent" });
  }
  return marketReason("market.selection-conflict");
}

export function evaluateMarketSelectionContext(
  context: MarketSelectionContextV1,
): CanonicalMarketReasonV1 | null {
  if (context.symbolContinuity === "ambiguous") {
    return marketReason("market.instrument-invalid", {
      instrumentFailureKind: "ambiguous",
    });
  }
  if (context.symbolContinuity === "unresolved") {
    return marketReason("market.instrument-invalid", {
      instrumentFailureKind: "symbol-continuity-unresolved",
    });
  }
  if (context.corporateActionState === "unresolved") {
    return marketReason("market.corporate-action-unresolved");
  }
  if (context.corporateActionState === "supported-sensitivity") {
    return marketReason("market.corporate-action-crossing");
  }
  return null;
}

export function evaluateFinalCorrectedCorpusClosure(
  durablyClosedAtMs: number,
  correctedCutoffNs: number,
): CanonicalMarketReasonV1 | null {
  if (
    !Number.isSafeInteger(durablyClosedAtMs) ||
    durablyClosedAtMs < 0 ||
    !Number.isSafeInteger(correctedCutoffNs) ||
    correctedCutoffNs < 0
  ) {
    fail("market.input-invalid");
  }
  return BigInt(durablyClosedAtMs) * 1_000_000n <= BigInt(correctedCutoffNs)
    ? null
    : marketReason("market.correction-view-unknown");
}

function chooseMissingReason(
  outcomes: readonly MarketCandidateOutcomeV1[],
  referenceKind: MarketReferenceKindV1,
): CanonicalMarketReasonV1 {
  const reasons = outcomes
    .map((candidate) => candidate.reason)
    .filter((reason): reason is CanonicalMarketReasonV1 => reason !== null);
  if (reasons.length === 0) return defaultMissingReason(referenceKind);
  return [...reasons].sort((left, right) => {
    const priority =
      (REASON_PRIORITY.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
      (REASON_PRIORITY.get(right.code) ?? Number.MAX_SAFE_INTEGER);
    return priority || compareCanonicalReasons(left, right);
  })[0] as CanonicalMarketReasonV1;
}

function validateRequest(request: MarketSelectionRequestV1): Readonly<{
  request: MarketSelectionRequestV1;
  targetNs: bigint;
  admittedRevisionIds: ReadonlySet<string>;
}>;
function validateRequest(
  request: MarketSelectionRequestV1,
  primaryCaptureAuthority: MarketSelectionRequestV1,
): Readonly<{
  request: MarketSelectionRequestV1;
  targetNs: bigint;
  admittedRevisionIds: ReadonlySet<string>;
}>;
function validateRequest(
  request: MarketSelectionRequestV1,
  primaryCaptureAuthority?: MarketSelectionRequestV1,
): Readonly<{
  request: MarketSelectionRequestV1;
  targetNs: bigint;
  admittedRevisionIds: ReadonlySet<string>;
}> {
  let exact: MarketSelectionRequestV1;
  try {
    exact = snapshotExactNormalizerInput(request, [
      "marketReferenceJoinKey",
      "intervalKey",
      "referenceKind",
      "selectionPolicyId",
      "selectionPolicy",
      "recordedCorpusSnapshotId",
      "recordedCorpus",
      "corpusCutoffId",
      "corpusCutoff",
      "context",
      "asOfBasis",
      "correctedCutoffNs",
    ]) as MarketSelectionRequestV1;
  } catch {
    fail("market.input-invalid");
  }
  if (
    !ID_PATTERNS.join.test(exact.marketReferenceJoinKey) ||
    !ID_PATTERNS.interval.test(exact.intervalKey) ||
    !ID_PATTERNS.policy.test(exact.selectionPolicyId) ||
    !ID_PATTERNS.corpus.test(exact.recordedCorpusSnapshotId) ||
    !ID_PATTERNS.cutoff.test(exact.corpusCutoffId) ||
    !ID_PATTERNS.hash.test(exact.asOfBasis.admittedRevisionSetHash) ||
    ![
      "bar-one-minute-completed-close",
      "bolo",
      "closing-trade",
      "daily-bar-close",
      "final-eligible-trade-close",
      "listing-official-open",
      "opening-trade",
      "prior-listing-official-close",
      "quote-nbbo-midpoint",
      "reopening-trade",
      "trade-last-eligible-consolidated",
    ].includes(exact.referenceKind)
  ) {
    fail("market.identity-invalid");
  }
  const policyId = deriveSelectionPolicyId(exact.selectionPolicy);
  const corpusId = deriveRecordedCorpusSnapshotId(exact.recordedCorpus);
  const cutoffId = deriveRecordedCorpusCutoffId(exact.corpusCutoff);
  const admitted = admittedRevisionIds(exact.recordedCorpus, exact.corpusCutoff);
  const asOf = validateMarketResultAsOfBasis(exact.asOfBasis);
  let context: Readonly<Record<string, unknown>>;
  try {
    context = snapshotExactNormalizerInput(exact.context, [
      "instrumentId",
      "calendarSnapshotId",
      "targetSessionKind",
      "targetWithinSession",
      "symbolContinuity",
      "corporateActionState",
    ]);
  } catch {
    fail("market.input-invalid");
  }
  if (
    typeof context["instrumentId"] !== "string" ||
    !/^min1_[0-9a-f]{64}$/u.test(context["instrumentId"]) ||
    typeof context["calendarSnapshotId"] !== "string" ||
    context["calendarSnapshotId"].length === 0 ||
    ![
      "regular-continuous",
      "official-open-auction",
      "official-close-auction",
      "extended-pre",
      "extended-post",
      "overnight",
      "halted",
      "calendar-closed",
      "unknown",
    ].includes(context["targetSessionKind"] as string) ||
    typeof context["targetWithinSession"] !== "boolean" ||
    !["proved", "ambiguous", "unresolved"].includes(context["symbolContinuity"] as string) ||
    !["none", "supported-sensitivity", "unresolved"].includes(
      context["corporateActionState"] as string,
    )
  ) {
    fail("market.input-invalid");
  }
  if (
    policyId !== exact.selectionPolicyId ||
    corpusId !== exact.recordedCorpusSnapshotId ||
    cutoffId !== exact.corpusCutoffId ||
    exact.recordedCorpus.marketReferenceJoinKey !== exact.marketReferenceJoinKey ||
    exact.corpusCutoff.corpusSnapshotId !== corpusId ||
    asOf.recordedCorpusSnapshotId !== corpusId ||
    asOf.corpusCutoffId !== cutoffId ||
    asOf.admittedRevisionSetHash !== exact.corpusCutoff.admittedRevisionSetHash ||
    asOf.viewKind !== exact.corpusCutoff.viewKind ||
    exact.selectionPolicy.correctionPolicy.primaryCorpusSnapshotId !== corpusId ||
    exact.selectionPolicy.correctionPolicy.corpusCutoffId !== cutoffId ||
    exact.selectionPolicy.correctionPolicy.viewKind !== exact.corpusCutoff.viewKind ||
    canonicalJson(exact.selectionPolicy.sourcePolicy as unknown as JsonValue) !==
      canonicalJson(exact.recordedCorpus.sourcePolicy as unknown as JsonValue)
  ) {
    fail("market.identity-invalid");
  }
  const interval = exact.selectionPolicy.intervalDefinitions.find(
    (candidate) => deriveMarketIntervalKey(candidate) === exact.intervalKey,
  );
  if (interval === undefined || interval.comparator !== asOf.comparator) {
    fail("market.input-invalid");
  }
  if (
    (exact.referenceKind === "prior-listing-official-close") !==
    (interval.intervalKind === "prior-close")
  ) {
    fail("market.input-invalid");
  }
  const basis = asOf.trustedObservationBasis;
  if (
    (asOf.anchorRole === "h001-primary-durable-capture" && basis.basisKind !== "capture") ||
    (asOf.anchorRole === "h001-mandatory-retrieval-sensitivity" && basis.basisKind !== "retrieval")
  ) {
    throw new MarketContractError(marketReason("market.anchor-policy-invalid"));
  }
  if (asOf.viewKind === "recorded-primary" && exact.correctedCutoffNs !== null) {
    fail("market.input-invalid");
  }
  if (
    asOf.viewKind === "recorded-corrected" &&
    (exact.correctedCutoffNs === null ||
      exact.correctedCutoffNs !== exact.corpusCutoff.cutoffTargetNs)
  ) {
    fail("market.input-invalid");
  }
  if (
    asOf.viewKind === "recorded-corrected" &&
    basis.basisKind === "capture" &&
    BigInt(exact.correctedCutoffNs as string) !==
      BigInt(basis.receivedAtMs) * 1_000_000n + 604_800_000_000_000n
  ) {
    fail("market.input-invalid");
  }
  if (
    asOf.viewKind === "recorded-corrected" &&
    basis.basisKind === "retrieval" &&
    primaryCaptureAuthority === undefined
  ) {
    fail("market.input-invalid");
  }
  if (
    asOf.viewKind === "recorded-corrected" &&
    basis.basisKind === "retrieval" &&
    primaryCaptureAuthority !== undefined
  ) {
    const primary = validateRequest(primaryCaptureAuthority).request;
    const primaryBasis = primary.asOfBasis.trustedObservationBasis;
    if (
      primary.asOfBasis.anchorRole !== "h001-primary-durable-capture" ||
      primaryBasis.basisKind !== "capture" ||
      primary.asOfBasis.viewKind !== "recorded-corrected" ||
      primary.marketReferenceJoinKey !== exact.marketReferenceJoinKey ||
      primary.intervalKey !== exact.intervalKey ||
      primary.referenceKind !== exact.referenceKind ||
      primary.selectionPolicyId !== exact.selectionPolicyId ||
      primary.recordedCorpusSnapshotId !== exact.recordedCorpusSnapshotId ||
      primary.corpusCutoffId !== exact.corpusCutoffId ||
      primary.asOfBasis.admittedRevisionSetHash !== asOf.admittedRevisionSetHash ||
      primary.correctedCutoffNs !== exact.correctedCutoffNs ||
      canonicalJson(primary.context as unknown as JsonValue) !==
        canonicalJson(exact.context as unknown as JsonValue) ||
      BigInt(exact.correctedCutoffNs as string) !==
        BigInt(primaryBasis.receivedAtMs) * 1_000_000n + 604_800_000_000_000n
    ) {
      fail("market.input-invalid");
    }
  }
  if (interval.anchorKind === "h001-selected-basis" && interval.offsetNs !== null) {
    const anchorMs = basis.basisKind === "capture" ? basis.receivedAtMs : basis.retrievedAtMs;
    const expected = BigInt(anchorMs) * 1_000_000n + BigInt(interval.offsetNs);
    if (BigInt(asOf.targetTimeNs) !== expected) fail("market.input-invalid");
  }
  return Object.freeze({
    request: exact,
    targetNs: parseEpochNanoseconds(asOf.targetTimeNs),
    admittedRevisionIds: new Set(admitted),
  });
}

function validateRevisionFamilies(
  facts: readonly NormalizedMarketFactV1[],
): ReadonlyMap<string, CanonicalMarketReasonV1> {
  const invalid = new Map<string, CanonicalMarketReasonV1>();
  const families = new Map<string, NormalizedMarketFactV1[]>();
  for (const fact of facts) {
    const members = families.get(fact.revisionFamilyId) ?? [];
    members.push(fact);
    families.set(fact.revisionFamilyId, members);
  }
  for (const [familyId, members] of families) {
    validateRevisionDepth(members.length);
    const byId = new Map(members.map((member) => [member.revisionId, member]));
    if (byId.size !== members.length) {
      invalid.set(
        familyId,
        marketReason("market.revision-invalid", { revisionFailureKind: "reused-key" }),
      );
      continue;
    }
    const children = new Map<string, number>();
    let familyReason: CanonicalMarketReasonV1 | null = null;
    for (const member of members) {
      if (member.revisionKind === "original") continue;
      const parentId = member.supersedesRevisionId;
      const parent = parentId === null ? undefined : byId.get(parentId);
      if (parent === undefined) {
        familyReason = marketReason("market.revision-invalid", {
          revisionFailureKind: "orphan",
        });
        break;
      }
      children.set(parent.revisionId, (children.get(parent.revisionId) ?? 0) + 1);
      if ((children.get(parent.revisionId) as number) > 1) {
        familyReason = marketReason("market.revision-invalid", {
          revisionFailureKind: "fork",
        });
        break;
      }
      if (parent.revisionKind === "cancellation") {
        familyReason = marketReason("market.revision-invalid", {
          revisionFailureKind: "unsupported-after-cancellation",
        });
        break;
      }
      const visited = new Set<string>([member.revisionId]);
      let cursor: NormalizedMarketFactV1 | undefined = parent;
      while (cursor !== undefined) {
        if (visited.has(cursor.revisionId)) {
          familyReason = marketReason("market.revision-invalid", {
            revisionFailureKind: "cycle",
          });
          break;
        }
        visited.add(cursor.revisionId);
        cursor =
          cursor.supersedesRevisionId === null ? undefined : byId.get(cursor.supersedesRevisionId);
      }
      if (familyReason !== null) break;
    }
    if (familyReason !== null) invalid.set(familyId, familyReason);
  }
  return invalid;
}

function stableConflictFamilies(facts: readonly NormalizedMarketFactV1[]): ReadonlySet<string> {
  const conflictFamilies = new Set<string>();
  const groups = new Map<string, NormalizedMarketFactV1[]>();
  for (const fact of facts) {
    const key = `${fact.revisionFamilyId}\u0000${fact.providerRevisionKey ?? ""}\u0000${fact.revisionKind}`;
    const members = groups.get(key) ?? [];
    members.push(fact);
    groups.set(key, members);
  }
  for (const members of groups.values()) {
    const identities = new Set(
      members.map(
        (member) =>
          `${member.providerObservationId}\u0000${member.marketFactId ?? ""}\u0000${member.revisionId}`,
      ),
    );
    if (identities.size > 1) {
      for (const member of members) conflictFamilies.add(member.revisionFamilyId);
    }
  }
  return conflictFamilies;
}

function applyView(
  facts: readonly NormalizedMarketFactV1[],
  admittedRevisionIdSet: ReadonlySet<string>,
): readonly NormalizedMarketFactV1[] {
  return facts.filter((fact) => admittedRevisionIdSet.has(fact.revisionId));
}

function cancelledRevisionIds(facts: readonly NormalizedMarketFactV1[]): ReadonlySet<string> {
  const result = new Set<string>();
  for (const fact of facts) {
    if (fact.revisionKind === "cancellation" && fact.supersedesRevisionId !== null) {
      result.add(fact.supersedesRevisionId);
    }
  }
  return result;
}

function correctedRevisionIds(facts: readonly NormalizedMarketFactV1[]): ReadonlySet<string> {
  const result = new Set<string>();
  for (const fact of facts) {
    if (fact.revisionKind === "correction" && fact.supersedesRevisionId !== null) {
      result.add(fact.supersedesRevisionId);
    }
  }
  return result;
}

function economicState(fact: NormalizedMarketFactV1): string {
  return canonicalJson(fact.payload as unknown as JsonValue);
}

function resolveWinner(facts: readonly NormalizedMarketFactV1[]): NormalizedMarketFactV1 | null {
  if (facts.length === 1) return facts[0] as NormalizedMarketFactV1;
  const economicStates = new Set(facts.map(economicState));
  if (economicStates.size === 1) {
    return [...facts].sort((left, right) =>
      compareUtf8(left.normalizedMarketFactId as string, right.normalizedMarketFactId as string),
    )[0] as NormalizedMarketFactV1;
  }
  const sequenceScope = facts[0]?.providerSequence?.scope;
  if (
    sequenceScope !== undefined &&
    facts.every(
      (fact) =>
        fact.providerSequence !== null &&
        fact.providerSequence.scope === sequenceScope &&
        (fact.providerSequence.trustClass === "native-gap-checked" ||
          fact.providerSequence.trustClass === "provider-stable-sequence") &&
        /^(?:0|[1-9][0-9]*)$/u.test(fact.providerSequence.value),
    )
  ) {
    return [...facts].sort((left, right) => {
      const leftValue = BigInt(left.providerSequence?.value as string);
      const rightValue = BigInt(right.providerSequence?.value as string);
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    })[facts.length - 1] as NormalizedMarketFactV1;
  }
  return null;
}

function selectedPrice(
  fact: NormalizedMarketFactV1,
): ReturnType<typeof requirePositiveDecimal> | CanonicalRationalV1 {
  const payload = fact.payload;
  if (payload === null) fail("market.input-invalid");
  if (payload.kind === "quote") return quoteMidpoint(payload);
  if (payload.kind === "trade") return requirePositiveDecimal(payload.price);
  if (payload.kind === "bar") return requirePositiveDecimal(payload.close);
  if (payload.kind === "prior-close" || payload.kind === "official-value") {
    return requirePositiveDecimal(payload.price);
  }
  fail("market.input-invalid");
}

function canonicalSource(source: MarketSourceKeyV1): string {
  return canonicalJson(source as unknown as JsonValue);
}

function selectMarketReferenceForSource(
  request: MarketSelectionRequestV1,
  inputFacts: readonly NormalizedMarketFactV1[],
  selectedSource: MarketSourceKeyV1,
  primaryCaptureAuthority?: MarketSelectionRequestV1,
): MarketReferenceResultV1 {
  const validated =
    primaryCaptureAuthority === undefined
      ? validateRequest(request)
      : validateRequest(request, primaryCaptureAuthority);
  request = validated.request;
  const targetNs = validated.targetNs;
  const selectedSourceKey = canonicalSource(selectedSource);
  const declaredSourceKeys = new Set([
    canonicalSource(request.selectionPolicy.sourcePolicy.primarySource),
    ...request.selectionPolicy.sourcePolicy.comparisonSources.map(canonicalSource),
  ]);
  if (!declaredSourceKeys.has(selectedSourceKey)) fail("market.input-invalid");
  validateCandidateCount(inputFacts.length);

  const distinctDeliveries = new Map<string, NormalizedMarketFactV1>();
  const evidenceByRevisionDelivery = new Map(
    request.recordedCorpus.revisionEvidence.map((row) => [
      `${row.revisionId}\u0000${row.deliveryId}`,
      row,
    ]),
  );
  const acquisitionIds = new Set(request.recordedCorpus.marketAcquisitionIds);
  const artifactIds = new Set(request.recordedCorpus.rawArtifactIds);
  const observationIds = new Set(request.recordedCorpus.providerObservationIds);
  const factEvidenceKeys: string[] = [];
  const factAcquisitionIds = new Set<string>();
  const factArtifactIds = new Set<string>();
  const factObservationIds = new Set<string>();
  for (const fact of inputFacts) {
    validateNormalizedMarketFactIdentity(fact);
    if (fact.instrumentId !== request.context.instrumentId) fail("market.input-invalid");
    const evidence = evidenceByRevisionDelivery.get(`${fact.revisionId}\u0000${fact.deliveryId}`);
    if (
      evidence === undefined ||
      evidence.rawArtifactId !== fact.rawArtifactId ||
      evidence.durablyRecordedAtMs !== fact.durablyRecordedAtMs ||
      evidence.logicalAtMs !== fact.durableLogicalAtMs ||
      evidence.clockBasisId !== fact.durableClockBasisId ||
      evidence.durableEvidenceHash !== fact.durableEvidenceHash ||
      !acquisitionIds.has(fact.marketAcquisitionId) ||
      !artifactIds.has(fact.rawArtifactId) ||
      !observationIds.has(fact.providerObservationId)
    ) {
      fail("market.identity-invalid");
    }
    const factSourceKey = canonicalSource(fact.source);
    if (!declaredSourceKeys.has(factSourceKey)) fail("market.input-invalid");
    factEvidenceKeys.push(`${fact.revisionId}\u0000${fact.deliveryId}`);
    factAcquisitionIds.add(fact.marketAcquisitionId);
    factArtifactIds.add(fact.rawArtifactId);
    factObservationIds.add(fact.providerObservationId);
    distinctDeliveries.set(fact.deliveryId, fact);
  }
  if (distinctDeliveries.size !== inputFacts.length) fail("market.input-invalid");
  const sorted = (values: Iterable<string>) => [...values].sort(compareUtf8);
  const evidenceKeys = request.recordedCorpus.revisionEvidence.map(
    (row) => `${row.revisionId}\u0000${row.deliveryId}`,
  );
  if (
    canonicalJson(sorted(factEvidenceKeys)) !== canonicalJson(evidenceKeys) ||
    canonicalJson(sorted(factAcquisitionIds)) !==
      canonicalJson(request.recordedCorpus.marketAcquisitionIds) ||
    canonicalJson(sorted(factArtifactIds)) !==
      canonicalJson(request.recordedCorpus.rawArtifactIds) ||
    canonicalJson(sorted(factObservationIds)) !==
      canonicalJson(request.recordedCorpus.providerObservationIds)
  ) {
    fail("market.identity-invalid");
  }
  const selectedInputFacts = inputFacts.filter(
    (fact) => canonicalSource(fact.source) === selectedSourceKey,
  );
  const deliveryCounts = new Map<string, number>();
  for (const fact of selectedInputFacts) {
    const count = (deliveryCounts.get(fact.providerObservationId) ?? 0) + 1;
    validateDeliveryCount(count);
    deliveryCounts.set(fact.providerObservationId, count);
  }

  const semanticFacts = new Map<string, NormalizedMarketFactV1>();
  for (const fact of selectedInputFacts) {
    const key = `${fact.providerObservationId}\u0000${fact.revisionId}`;
    if (!semanticFacts.has(key)) semanticFacts.set(key, fact);
  }
  const facts = [...semanticFacts.values()];
  const invalidFamilies = validateRevisionFamilies(facts);
  const conflicts = stableConflictFamilies(facts);
  const admitted = applyView(facts, validated.admittedRevisionIds);
  const cancelled = cancelledRevisionIds(admitted);
  const corrected = correctedRevisionIds(admitted);

  const classified: ClassifiedFact[] = [];
  const requestedPayloadKind = referencePayloadKind(request.referenceKind);
  for (const fact of admitted) {
    if (fact.normalizedMarketFactId === null) continue;
    if (
      fact.payload?.kind !== requestedPayloadKind ||
      !matchesReferenceKind(fact.payload, request.referenceKind)
    )
      continue;
    const invalidReason = invalidFamilies.get(fact.revisionFamilyId);
    if (invalidReason !== undefined) {
      classified.push({ fact, outcome: outcome(fact, invalidReason) });
      continue;
    }
    if (conflicts.has(fact.revisionFamilyId)) {
      classified.push({
        fact,
        outcome: outcome(
          fact,
          marketReason("market.provider-observation-invalid", {
            providerObservationFailureKind: "conflicting-content",
          }),
        ),
      });
      continue;
    }
    if (cancelled.has(fact.revisionId)) {
      if (fact.payload?.kind === "trade") {
        classified.push({
          fact,
          outcome: outcome(fact, marketReason("market.trade-cancelled")),
        });
      }
      continue;
    }
    if (corrected.has(fact.revisionId)) continue;
    classified.push(classifyPayload(fact, request.referenceKind, targetNs));
  }

  const candidates = Object.freeze(classified.map((entry) => entry.outcome).sort(compareOutcome));
  const candidateSetHash = deriveCandidateSetHash(candidates);
  const contextReason = evaluateMarketSelectionContext(request.context);
  if (contextReason !== null) {
    const missingReferenceId = deriveMissingReferenceId({
      marketReferenceJoinKey: request.marketReferenceJoinKey,
      intervalKey: request.intervalKey,
      referenceKind: request.referenceKind,
      selectionPolicyId: request.selectionPolicyId,
      asOfBasis: request.asOfBasis,
      resultStatus: "missing",
      reason: contextReason,
      candidateSetHash,
    });
    return Object.freeze({
      status: "missing",
      selectedReferenceId: null,
      missingReferenceId,
      candidateSetHash,
      selectedNormalizedMarketFactId: null,
      selectedRevisionId: null,
      exactPrice: null,
      marketEventTimeNs: null,
      ageNs: null,
      reason: contextReason,
      diagnostics: Object.freeze([]),
      candidates,
    });
  }
  const eligibleByTime = classified.filter((entry) => {
    if (entry.outcome.eligibilityStatus === "ineligible") return false;
    const time = applicableTime(entry.fact);
    return request.asOfBasis.comparator === "strictly-before" ? time < targetNs : time <= targetNs;
  });

  if (eligibleByTime.length === 0) {
    const reason = chooseMissingReason(candidates, request.referenceKind);
    const missingReferenceId = deriveMissingReferenceId({
      marketReferenceJoinKey: request.marketReferenceJoinKey,
      intervalKey: request.intervalKey,
      referenceKind: request.referenceKind,
      selectionPolicyId: request.selectionPolicyId,
      asOfBasis: request.asOfBasis,
      resultStatus: "missing",
      reason,
      candidateSetHash,
    });
    return Object.freeze({
      status: "missing",
      selectedReferenceId: null,
      missingReferenceId,
      candidateSetHash,
      selectedNormalizedMarketFactId: null,
      selectedRevisionId: null,
      exactPrice: null,
      marketEventTimeNs: null,
      ageNs: null,
      reason,
      diagnostics: Object.freeze([]),
      candidates,
    });
  }

  let winnerTime = applicableTime(eligibleByTime[0]?.fact as NormalizedMarketFactV1);
  for (const entry of eligibleByTime.slice(1)) {
    const time = applicableTime(entry.fact);
    if (time > winnerTime) winnerTime = time;
  }
  let tied = eligibleByTime
    .filter((entry) => applicableTime(entry.fact) === winnerTime)
    .map((entry) => entry.fact);
  if (request.referenceKind === "prior-listing-official-close") {
    const correctedCloses = tied.filter(
      (fact) =>
        fact.payload?.kind === "prior-close" &&
        fact.payload.closeKind === "corrected-consolidated-close",
    );
    if (correctedCloses.length > 0) tied = correctedCloses;
  }
  const winner = resolveWinner(tied);
  if (winner === null) {
    const reason = marketReason("market.sequence-insufficient", {
      sequenceFailureKind: "equal-time-ambiguous",
    });
    const missingReferenceId = deriveMissingReferenceId({
      marketReferenceJoinKey: request.marketReferenceJoinKey,
      intervalKey: request.intervalKey,
      referenceKind: request.referenceKind,
      selectionPolicyId: request.selectionPolicyId,
      asOfBasis: request.asOfBasis,
      resultStatus: "missing",
      reason,
      candidateSetHash,
    });
    return Object.freeze({
      status: "missing",
      selectedReferenceId: null,
      missingReferenceId,
      candidateSetHash,
      selectedNormalizedMarketFactId: null,
      selectedRevisionId: null,
      exactPrice: null,
      marketEventTimeNs: null,
      ageNs: null,
      reason,
      diagnostics: Object.freeze([]),
      candidates,
    });
  }

  const selectedOutcome = classified.find(
    (entry) => entry.fact.normalizedMarketFactId === winner.normalizedMarketFactId,
  )?.outcome;
  if (selectedOutcome === undefined || winner.normalizedMarketFactId === null) {
    fail("market.identity-invalid");
  }
  const diagnostics = selectedOutcome.diagnostics;
  const status = diagnostics.length === 0 ? "selected-complete" : "selected-degraded";
  const selectedReferenceId = deriveSelectedReferenceId({
    marketReferenceJoinKey: request.marketReferenceJoinKey,
    intervalKey: request.intervalKey,
    referenceKind: request.referenceKind,
    selectionPolicyId: request.selectionPolicyId,
    asOfBasis: request.asOfBasis,
    resultStatus: status,
    selectedNormalizedMarketFactId: winner.normalizedMarketFactId,
    selectedRevisionId: winner.revisionId,
    candidateSetHash,
    diagnostics,
  });
  return Object.freeze({
    status,
    selectedReferenceId,
    missingReferenceId: null,
    candidateSetHash,
    selectedNormalizedMarketFactId: winner.normalizedMarketFactId,
    selectedRevisionId: winner.revisionId,
    exactPrice: selectedPrice(winner),
    marketEventTimeNs: applicableTime(winner).toString(),
    ageNs: (targetNs - applicableTime(winner)).toString(),
    reason: null,
    diagnostics,
    candidates,
  });
}

export function selectMarketReference(
  request: MarketSelectionRequestV1,
  inputFacts: readonly NormalizedMarketFactV1[],
): MarketReferenceResultV1 {
  request = validateRequest(request).request;
  return selectMarketReferenceForSource(
    request,
    inputFacts,
    request.selectionPolicy.sourcePolicy.primarySource,
  );
}

export function selectPairedMarketReferences(
  primaryCaptureRequest: MarketSelectionRequestV1,
  retrievalSensitivityRequest: MarketSelectionRequestV1,
  inputFacts: readonly NormalizedMarketFactV1[],
): Readonly<{
  primaryCapture: MarketReferenceResultV1;
  retrievalSensitivity: MarketReferenceResultV1;
}> {
  const primary = validateRequest(primaryCaptureRequest).request;
  const retrieval = validateRequest(retrievalSensitivityRequest, primary).request;
  return Object.freeze({
    primaryCapture: selectMarketReferenceForSource(
      primary,
      inputFacts,
      primary.selectionPolicy.sourcePolicy.primarySource,
    ),
    retrievalSensitivity: selectMarketReferenceForSource(
      retrieval,
      inputFacts,
      retrieval.selectionPolicy.sourcePolicy.primarySource,
      primary,
    ),
  });
}

function resultId(result: MarketReferenceResultV1): string {
  return result.status === "missing" ? result.missingReferenceId : result.selectedReferenceId;
}

function equalExactPrices(
  left: Exclude<MarketReferenceResultV1["exactPrice"], null>,
  right: Exclude<MarketReferenceResultV1["exactPrice"], null>,
): boolean {
  const fraction = (
    value: Exclude<MarketReferenceResultV1["exactPrice"], null>,
  ): readonly [bigint, bigint] =>
    "coefficient" in value
      ? [(value.negative ? -1n : 1n) * BigInt(value.coefficient), 10n ** BigInt(value.scale)]
      : [BigInt(value.numerator), BigInt(value.denominator)];
  const [leftNumerator, leftDenominator] = fraction(left);
  const [rightNumerator, rightDenominator] = fraction(right);
  return leftNumerator * rightDenominator === rightNumerator * leftDenominator;
}

export function evaluateMarketProviderDiscrepancy(
  request: MarketSelectionRequestV1,
  inputFacts: readonly NormalizedMarketFactV1[],
): MarketProviderDiscrepancyV1 {
  request = validateRequest(request).request;
  const sources = [
    request.selectionPolicy.sourcePolicy.primarySource,
    ...request.selectionPolicy.sourcePolicy.comparisonSources,
  ];
  if (sources.length < 2) fail("market.input-invalid");
  const providerResults = Object.freeze(
    sources.map((source) =>
      Object.freeze({
        source,
        result: selectMarketReferenceForSource(request, inputFacts, source),
      }),
    ),
  );
  const selectedResults = providerResults
    .map((entry) => entry.result)
    .filter(
      (
        result,
      ): result is Extract<
        MarketReferenceResultV1,
        { status: "selected-complete" | "selected-degraded" }
      > => result.status !== "missing",
    );
  const comparisonResult =
    selectedResults.length !== providerResults.length
      ? ("not-comparable" as const)
      : selectedResults
            .slice(1)
            .every((result) =>
              equalExactPrices(
                selectedResults[0]?.exactPrice as Exclude<
                  MarketReferenceResultV1["exactPrice"],
                  null
                >,
                result.exactPrice,
              ),
            )
        ? ("agree" as const)
        : ("disagree" as const);
  const providerResultIds = Object.freeze(
    providerResults.map((entry) => resultId(entry.result)).sort(compareUtf8),
  );
  const providerDiscrepancyId = deriveProviderDiscrepancyId({
    marketReferenceJoinKey: request.marketReferenceJoinKey,
    intervalKey: request.intervalKey,
    referenceKind: request.referenceKind,
    selectionPolicyId: request.selectionPolicyId,
    providerResultIds,
    discrepancyPolicy: request.selectionPolicy.discrepancyPolicy,
    comparisonResult,
  });
  return Object.freeze({
    providerDiscrepancyId,
    providerResultIds,
    discrepancyPolicy: request.selectionPolicy.discrepancyPolicy,
    comparisonResult,
    providerResults,
  });
}
