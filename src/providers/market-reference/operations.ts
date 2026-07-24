import { canonicalJson, type JsonValue } from "../../core/json.js";
import {
  BAR_DURATION_NS,
  type BarPayloadV1,
  type CanonicalDecimalV1,
  type CanonicalMarketReasonV1,
  type CanonicalRationalV1,
  COMPLETED_BAR_AGE_NS,
  EXTENDED_QUOTE_AGE_NS,
  type MarketSessionKindV1,
  marketReason,
  type QuotePayloadV1,
  REGULAR_QUOTE_AGE_NS,
  type TradePayloadV1,
} from "./contracts.js";
import {
  compareCanonicalDecimals,
  parseEpochNanoseconds,
  quoteMidpoint,
  requirePositiveDecimal,
} from "./normalization.js";

function invalidInput(): never {
  throw new TypeError("invalid provider-neutral market operation input");
}

function parseSequence(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) invalidInput();
  return BigInt(value);
}

export type NativeSequenceReplayEventV1 =
  | Readonly<{
      kind: "data";
      sequence: string;
      semanticDigest: string;
    }>
  | Readonly<{
      kind: "reset";
      nextSequence: string;
      authoritative: boolean;
    }>;

export type NativeSequenceReplayStepV1 = Readonly<{
  inputIndex: number;
  disposition:
    | "accepted"
    | "duplicate"
    | "gap-opened"
    | "suppressed-through-gap"
    | "authoritative-reset"
    | "unexpected-reset"
    | "regression";
  stateAfter: "healthy" | "invalid-until-authoritative-reset";
  marketStateAvailableAfter: boolean;
  reason: CanonicalMarketReasonV1 | null;
}>;

export type NativeSequenceReplayResultV1 = Readonly<{
  finalState: "healthy" | "invalid-until-authoritative-reset";
  marketStateAvailable: boolean;
  nextExpectedSequence: string | null;
  acceptedSemanticDigests: readonly string[];
  steps: readonly NativeSequenceReplayStepV1[];
}>;

/**
 * Replays one already-scoped native sequence. A gap, regression, or unexpected reset invalidates
 * state until an authoritative reset supplies the next expected sequence.
 */
export function replayNativeSequence(
  events: readonly NativeSequenceReplayEventV1[],
): NativeSequenceReplayResultV1 {
  let healthy = true;
  let marketStateAvailable = false;
  let nextExpected: bigint | null = null;
  let previous: Readonly<{ sequence: bigint; semanticDigest: string }> | null = null;
  const acceptedSemanticDigests: string[] = [];
  const steps: NativeSequenceReplayStepV1[] = [];

  for (const [inputIndex, event] of events.entries()) {
    if (event.kind === "reset") {
      const resetNext = parseSequence(event.nextSequence);
      if (!event.authoritative) {
        healthy = false;
        marketStateAvailable = false;
        steps.push(
          Object.freeze({
            inputIndex,
            disposition: "unexpected-reset",
            stateAfter: "invalid-until-authoritative-reset",
            marketStateAvailableAfter: false,
            reason: marketReason("market.sequence-regression"),
          }),
        );
        continue;
      }
      healthy = true;
      marketStateAvailable = false;
      nextExpected = resetNext;
      previous = null;
      steps.push(
        Object.freeze({
          inputIndex,
          disposition: "authoritative-reset",
          stateAfter: "healthy",
          marketStateAvailableAfter: false,
          reason: null,
        }),
      );
      continue;
    }

    if (typeof event.semanticDigest !== "string" || event.semanticDigest.length === 0) {
      invalidInput();
    }
    const sequence = parseSequence(event.sequence);
    if (!healthy) {
      steps.push(
        Object.freeze({
          inputIndex,
          disposition: "suppressed-through-gap",
          stateAfter: "invalid-until-authoritative-reset",
          marketStateAvailableAfter: false,
          reason: marketReason("market.sequence-insufficient", { sequenceFailureKind: "gap" }),
        }),
      );
      continue;
    }
    if (
      previous !== null &&
      sequence === previous.sequence &&
      event.semanticDigest === previous.semanticDigest
    ) {
      steps.push(
        Object.freeze({
          inputIndex,
          disposition: "duplicate",
          stateAfter: "healthy",
          marketStateAvailableAfter: marketStateAvailable,
          reason: null,
        }),
      );
      continue;
    }
    if (nextExpected !== null && sequence < nextExpected) {
      healthy = false;
      marketStateAvailable = false;
      steps.push(
        Object.freeze({
          inputIndex,
          disposition: "regression",
          stateAfter: "invalid-until-authoritative-reset",
          marketStateAvailableAfter: false,
          reason: marketReason("market.sequence-regression"),
        }),
      );
      continue;
    }
    if (nextExpected !== null && sequence > nextExpected) {
      healthy = false;
      marketStateAvailable = false;
      steps.push(
        Object.freeze({
          inputIndex,
          disposition: "gap-opened",
          stateAfter: "invalid-until-authoritative-reset",
          marketStateAvailableAfter: false,
          reason: marketReason("market.sequence-insufficient", { sequenceFailureKind: "gap" }),
        }),
      );
      continue;
    }

    acceptedSemanticDigests.push(event.semanticDigest);
    marketStateAvailable = true;
    previous = Object.freeze({ sequence, semanticDigest: event.semanticDigest });
    nextExpected = sequence + 1n;
    steps.push(
      Object.freeze({
        inputIndex,
        disposition: "accepted",
        stateAfter: "healthy",
        marketStateAvailableAfter: true,
        reason: null,
      }),
    );
  }

  return Object.freeze({
    finalState: healthy ? "healthy" : "invalid-until-authoritative-reset",
    marketStateAvailable: healthy && marketStateAvailable,
    nextExpectedSequence: healthy && nextExpected !== null ? nextExpected.toString() : null,
    acceptedSemanticDigests: Object.freeze(acceptedSemanticDigests),
    steps: Object.freeze(steps),
  });
}

export type ConsolidatedLastConditionV1 =
  | "regular"
  | "sold-last"
  | "prior-reference-price"
  | "sold-out-of-sequence"
  | "odd-lot"
  | "official-open"
  | "official-close"
  | "corrected-close"
  | "opening"
  | "reopening"
  | "closing";

export type ConsolidatedLastReplayEventV1 = Readonly<{
  eventId: string;
  condition: ConsolidatedLastConditionV1;
  price: CanonicalDecimalV1;
  conditionalDayState: "qualifying" | "nonqualifying" | "unknown";
}>;

export type ConsolidatedLastReplayStepV1 = Readonly<{
  eventId: string;
  factKind: "trade" | "official-open" | "official-close" | "corrected-close";
  tradeKind: TradePayloadV1["tradeKind"] | null;
  updatesConsolidatedLast: boolean | "state-insufficient";
  consolidatedLastAfter: CanonicalDecimalV1 | null;
  reason: CanonicalMarketReasonV1 | null;
}>;

export type ConsolidatedLastReplayResultV1 = Readonly<{
  consolidatedLast: CanonicalDecimalV1 | null;
  steps: readonly ConsolidatedLastReplayStepV1[];
}>;

function typedTradeCondition(condition: ConsolidatedLastConditionV1): Readonly<{
  factKind: ConsolidatedLastReplayStepV1["factKind"];
  tradeKind: TradePayloadV1["tradeKind"] | null;
}> {
  const row = {
    regular: ["trade", "last-eligible"],
    "sold-last": ["trade", "last-eligible"],
    "prior-reference-price": ["trade", "last-eligible"],
    "sold-out-of-sequence": ["trade", "last-eligible"],
    "odd-lot": ["trade", "last-eligible"],
    "official-open": ["official-open", null],
    "official-close": ["official-close", null],
    "corrected-close": ["corrected-close", null],
    opening: ["trade", "opening"],
    reopening: ["trade", "reopening"],
    closing: ["trade", "closing"],
  } as const;
  const [factKind, tradeKind] = row[condition];
  return Object.freeze({ factKind, tradeKind });
}

/**
 * Replays the complete bounded condition/day state needed for consolidated Last. Conditional
 * conditions fail closed when their qualifying state is absent.
 */
export function replayConsolidatedLast(
  events: readonly ConsolidatedLastReplayEventV1[],
): ConsolidatedLastReplayResultV1 {
  let consolidatedLast: CanonicalDecimalV1 | null = null;
  const steps: ConsolidatedLastReplayStepV1[] = [];
  for (const event of events) {
    if (typeof event.eventId !== "string" || event.eventId.length === 0) invalidInput();
    requirePositiveDecimal(event.price);
    const typed = typedTradeCondition(event.condition);
    let updates: boolean | "state-insufficient" = false;
    if (
      event.condition === "regular" ||
      event.condition === "opening" ||
      event.condition === "reopening" ||
      event.condition === "closing"
    ) {
      updates = true;
    } else if (
      event.condition === "sold-last" ||
      event.condition === "prior-reference-price" ||
      event.condition === "sold-out-of-sequence"
    ) {
      updates =
        event.conditionalDayState === "unknown"
          ? "state-insufficient"
          : event.conditionalDayState === "qualifying" &&
            (event.condition === "sold-last" || consolidatedLast === null);
    }
    if (updates === true) consolidatedLast = event.price;
    const reason =
      updates === true || typed.factKind !== "trade"
        ? null
        : marketReason("market.trade-condition-ineligible", {
            tradeConditionFailureKind:
              updates === "state-insufficient" ? "state-insufficient" : "does-not-update-last",
          });
    steps.push(
      Object.freeze({
        eventId: event.eventId,
        ...typed,
        updatesConsolidatedLast: updates,
        consolidatedLastAfter: consolidatedLast,
        reason,
      }),
    );
  }
  return Object.freeze({ consolidatedLast, steps: Object.freeze(steps) });
}

export type TapeOfficialTradeCodeV1 = "Q" | "O" | "5" | "6" | "M" | "9";

export type TapeOfficialTradeClassificationV1 =
  | Readonly<{
      code: "Q";
      eventKind: "official-open";
      payloadKind: "official-value";
      valueKind: "listing-official-open";
    }>
  | Readonly<{
      code: "O" | "5" | "6";
      eventKind: "trade";
      payloadKind: "trade";
      tradeKind: "opening" | "reopening" | "closing";
    }>
  | Readonly<{
      code: "M";
      eventKind: "official-close";
      payloadKind: "prior-close";
      closeKind: "listing-official-close";
    }>
  | Readonly<{
      code: "9";
      eventKind: "corrected-close";
      payloadKind: "prior-close";
      closeKind: "corrected-consolidated-close";
    }>;

/** Maps official/trade/close tape semantics without collapsing them into a generic price fact. */
export function classifyTapeOfficialTradeCode(
  code: TapeOfficialTradeCodeV1,
): TapeOfficialTradeClassificationV1 {
  const rows: Readonly<Record<TapeOfficialTradeCodeV1, TapeOfficialTradeClassificationV1>> = {
    Q: {
      code: "Q",
      eventKind: "official-open",
      payloadKind: "official-value",
      valueKind: "listing-official-open",
    },
    O: { code: "O", eventKind: "trade", payloadKind: "trade", tradeKind: "opening" },
    "5": { code: "5", eventKind: "trade", payloadKind: "trade", tradeKind: "reopening" },
    "6": { code: "6", eventKind: "trade", payloadKind: "trade", tradeKind: "closing" },
    M: {
      code: "M",
      eventKind: "official-close",
      payloadKind: "prior-close",
      closeKind: "listing-official-close",
    },
    "9": {
      code: "9",
      eventKind: "corrected-close",
      payloadKind: "prior-close",
      closeKind: "corrected-consolidated-close",
    },
  };
  const result = rows[code];
  if (result === undefined) invalidInput();
  return Object.freeze(result);
}

export type FrozenSessionCalendarEntryV1 = Readonly<{
  sessionDate: string;
  timeZone: "America/New_York";
  utcOffsetMinutes: -300 | -240;
  calendarVersion: string;
  holiday: boolean;
  extendedOpenNs: string | null;
  regularOpenNs: string | null;
  regularCloseNs: string | null;
  extendedCloseNs: string | null;
}>;

export type FrozenSessionClassificationV1 = Readonly<{
  sessionDate: string;
  sessionKind: "extended-pre" | "regular-continuous" | "extended-post" | "calendar-closed";
  utcOffsetMinutes: -300 | -240;
  calendarVersion: string;
}>;

function calendarBoundaries(
  entry: FrozenSessionCalendarEntryV1,
): readonly [bigint, bigint, bigint, bigint] | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(entry.sessionDate) ||
    entry.timeZone !== "America/New_York" ||
    (entry.utcOffsetMinutes !== -300 && entry.utcOffsetMinutes !== -240) ||
    typeof entry.calendarVersion !== "string" ||
    entry.calendarVersion.length === 0
  ) {
    invalidInput();
  }
  const values = [
    entry.extendedOpenNs,
    entry.regularOpenNs,
    entry.regularCloseNs,
    entry.extendedCloseNs,
  ] as const;
  if (entry.holiday) {
    if (values.some((value) => value !== null)) invalidInput();
    return null;
  }
  if (values.some((value) => value === null)) invalidInput();
  const parsed = values.map((value) => parseEpochNanoseconds(value as string)) as [
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  if (!(parsed[0] < parsed[1] && parsed[1] < parsed[2] && parsed[2] < parsed[3])) {
    invalidInput();
  }
  return parsed;
}

/**
 * Classifies a target against frozen UTC boundaries. Boundaries are half-open: a fact exactly at
 * regular close is extended-post, never regular-continuous.
 */
export function classifyFrozenSession(
  entry: FrozenSessionCalendarEntryV1,
  targetNs: string,
): FrozenSessionClassificationV1 {
  const target = parseEpochNanoseconds(targetNs);
  const boundaries = calendarBoundaries(entry);
  let sessionKind: FrozenSessionClassificationV1["sessionKind"] = "calendar-closed";
  if (boundaries !== null) {
    const [extendedOpen, regularOpen, regularClose, extendedClose] = boundaries;
    if (target >= extendedOpen && target < regularOpen) sessionKind = "extended-pre";
    else if (target >= regularOpen && target < regularClose) sessionKind = "regular-continuous";
    else if (target >= regularClose && target < extendedClose) sessionKind = "extended-post";
  }
  return Object.freeze({
    sessionDate: entry.sessionDate,
    sessionKind,
    utcOffsetMinutes: entry.utcOffsetMinutes,
    calendarVersion: entry.calendarVersion,
  });
}

export function evaluateSessionTransition(
  origin: MarketSessionKindV1,
  destination: MarketSessionKindV1,
): Readonly<{
  status: "same-session" | "missing";
  reason: CanonicalMarketReasonV1 | null;
}> {
  return origin === destination
    ? Object.freeze({ status: "same-session", reason: null })
    : Object.freeze({ status: "missing", reason: marketReason("market.session-transition") });
}

export type QuoteSideInputV1 = Readonly<{
  price: CanonicalDecimalV1;
  size: CanonicalDecimalV1;
}>;

export type TwoSidedQuoteConstructionV1 =
  | Readonly<{ status: "complete"; payload: QuotePayloadV1; reason: null }>
  | Readonly<{
      status: "missing-side";
      payload: null;
      missingSides: readonly ("bid" | "ask")[];
      reason: CanonicalMarketReasonV1;
    }>;

/** Preserves absent quote sides as null at the provider boundary instead of inventing zero values. */
export function constructTwoSidedQuote(
  input: Readonly<{
    quoteKind: QuotePayloadV1["quoteKind"];
    bid: QuoteSideInputV1 | null;
    ask: QuoteSideInputV1 | null;
    explicitConsolidatedNbbo: boolean;
    condition: QuotePayloadV1["condition"];
    slow: boolean;
    luldState: QuotePayloadV1["luldState"];
    halted: boolean;
  }>,
): TwoSidedQuoteConstructionV1 {
  const missingSides: ("bid" | "ask")[] = [];
  if (
    input.bid === null ||
    input.bid.price.coefficient === "0" ||
    input.bid.size.coefficient === "0"
  ) {
    missingSides.push("bid");
  }
  if (
    input.ask === null ||
    input.ask.price.coefficient === "0" ||
    input.ask.size.coefficient === "0"
  ) {
    missingSides.push("ask");
  }
  if (missingSides.length > 0) {
    return Object.freeze({
      status: "missing-side",
      payload: null,
      missingSides: Object.freeze(missingSides),
      reason: marketReason("market.quote-one-sided"),
    });
  }
  const bid = input.bid as QuoteSideInputV1;
  const ask = input.ask as QuoteSideInputV1;
  requirePositiveDecimal(bid.price);
  requirePositiveDecimal(bid.size);
  requirePositiveDecimal(ask.price);
  requirePositiveDecimal(ask.size);
  return Object.freeze({
    status: "complete",
    payload: Object.freeze({
      kind: "quote",
      quoteKind: input.quoteKind,
      bidPrice: bid.price,
      askPrice: ask.price,
      bidSize: bid.size,
      askSize: ask.size,
      explicitConsolidatedNbbo: input.explicitConsolidatedNbbo,
      condition: input.condition,
      slow: input.slow,
      luldState: input.luldState,
      halted: input.halted,
    }),
    reason: null,
  });
}

export type StrictExecutableQuoteResultV1 =
  | Readonly<{
      status: "eligible";
      exactMidpoint: CanonicalRationalV1;
      reason: null;
      excludedDiagnostic: null;
    }>
  | Readonly<{
      status: "missing";
      exactMidpoint: null;
      reason: CanonicalMarketReasonV1;
      excludedDiagnostic: CanonicalMarketReasonV1 | null;
    }>;

/** Executes the precommitted strict sensitivity that excludes locked, slow, and LULD-limit NBBO. */
export function evaluateStrictExecutableQuote(
  payload: QuotePayloadV1,
): StrictExecutableQuoteResultV1 {
  if (payload.quoteKind !== "nbbo" || !payload.explicitConsolidatedNbbo) {
    return Object.freeze({
      status: "missing",
      exactMidpoint: null,
      reason: marketReason("market.quote-not-consolidated"),
      excludedDiagnostic: null,
    });
  }
  if (
    payload.bidPrice.coefficient === "0" ||
    payload.askPrice.coefficient === "0" ||
    payload.bidSize.coefficient === "0" ||
    payload.askSize.coefficient === "0"
  ) {
    return Object.freeze({
      status: "missing",
      exactMidpoint: null,
      reason: marketReason("market.quote-one-sided"),
      excludedDiagnostic: null,
    });
  }
  const comparison = compareCanonicalDecimals(payload.bidPrice, payload.askPrice);
  if (comparison > 0) {
    return Object.freeze({
      status: "missing",
      exactMidpoint: null,
      reason: marketReason("market.quote-crossed"),
      excludedDiagnostic: null,
    });
  }
  if (
    payload.halted ||
    payload.condition !== "eligible" ||
    payload.luldState === "non-executable"
  ) {
    const reason = payload.halted
      ? marketReason("market.quote-halt")
      : payload.condition === "unknown"
        ? marketReason("market.condition-unknown")
        : payload.condition === "ineligible"
          ? marketReason("market.quote-condition-ineligible")
          : marketReason("market.quote-luld-nonexecutable");
    return Object.freeze({
      status: "missing",
      exactMidpoint: null,
      reason,
      excludedDiagnostic: null,
    });
  }
  const qualityKind =
    comparison === 0
      ? ("locked" as const)
      : payload.slow
        ? ("slow" as const)
        : payload.luldState === "limit"
          ? ("luld-limit-state" as const)
          : null;
  if (qualityKind !== null) {
    return Object.freeze({
      status: "missing",
      exactMidpoint: null,
      reason: marketReason("market.no-eligible-quote"),
      excludedDiagnostic: marketReason("market.quote-quality-degraded", { qualityKind }),
    });
  }
  return Object.freeze({
    status: "eligible",
    exactMidpoint: quoteMidpoint(payload),
    reason: null,
    excludedDiagnostic: null,
  });
}

export type PrimaryQuoteBoundaryResultV1 =
  | Readonly<{
      status: "selected-complete" | "selected-degraded";
      exactMidpoint: CanonicalRationalV1;
      reason: null;
      diagnostics: readonly CanonicalMarketReasonV1[];
    }>
  | Readonly<{
      status: "missing";
      exactMidpoint: null;
      reason: CanonicalMarketReasonV1;
      diagnostics: readonly CanonicalMarketReasonV1[];
    }>;

/**
 * Executes primary NBBO midpoint, quality, and exact staleness boundaries without relying on a
 * fixture label or a caller-supplied eligibility result.
 */
export function evaluatePrimaryQuoteBoundary(
  payload: QuotePayloadV1,
  sessionKind: "regular-continuous" | "extended-pre" | "extended-post",
  ageNs: string,
): PrimaryQuoteBoundaryResultV1 {
  const missing = (reason: CanonicalMarketReasonV1): PrimaryQuoteBoundaryResultV1 =>
    Object.freeze({
      status: "missing",
      exactMidpoint: null,
      reason,
      diagnostics: Object.freeze([]),
    });
  if (payload.quoteKind !== "nbbo" || !payload.explicitConsolidatedNbbo) {
    return missing(marketReason("market.quote-not-consolidated"));
  }
  if (
    payload.bidPrice.coefficient === "0" ||
    payload.askPrice.coefficient === "0" ||
    payload.bidSize.coefficient === "0" ||
    payload.askSize.coefficient === "0"
  ) {
    return missing(marketReason("market.quote-one-sided"));
  }
  requirePositiveDecimal(payload.bidPrice);
  requirePositiveDecimal(payload.askPrice);
  requirePositiveDecimal(payload.bidSize);
  requirePositiveDecimal(payload.askSize);
  if (payload.halted) return missing(marketReason("market.quote-halt"));
  if (payload.condition === "unknown") return missing(marketReason("market.condition-unknown"));
  if (payload.condition === "ineligible") {
    return missing(marketReason("market.quote-condition-ineligible"));
  }
  if (payload.luldState === "non-executable") {
    return missing(marketReason("market.quote-luld-nonexecutable"));
  }
  const comparison = compareCanonicalDecimals(payload.bidPrice, payload.askPrice);
  if (comparison > 0) return missing(marketReason("market.quote-crossed"));
  const age = parseEpochNanoseconds(ageNs);
  const maximum =
    sessionKind === "regular-continuous" ? REGULAR_QUOTE_AGE_NS : EXTENDED_QUOTE_AGE_NS;
  if (age > maximum) return missing(marketReason("market.quote-stale"));
  const diagnostics: CanonicalMarketReasonV1[] = [];
  if (comparison === 0) {
    diagnostics.push(marketReason("market.quote-quality-degraded", { qualityKind: "locked" }));
  }
  if (payload.slow) {
    diagnostics.push(marketReason("market.quote-quality-degraded", { qualityKind: "slow" }));
  }
  if (payload.luldState === "limit") {
    diagnostics.push(
      marketReason("market.quote-quality-degraded", { qualityKind: "luld-limit-state" }),
    );
  }
  diagnostics.sort((left, right) => {
    const leftJson = canonicalJson(left as unknown as JsonValue);
    const rightJson = canonicalJson(right as unknown as JsonValue);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
  return Object.freeze({
    status: diagnostics.length === 0 ? "selected-complete" : "selected-degraded",
    exactMidpoint: quoteMidpoint(payload),
    reason: null,
    diagnostics: Object.freeze(diagnostics),
  });
}

export type QuoteTimelineEventV1 =
  | Readonly<{
      kind: "quote";
      eventId: string;
      eventTimeNs: string;
      trustedSequence: string | null;
      sessionKind: "regular-continuous" | "extended-pre" | "extended-post" | "overnight";
      payload: QuotePayloadV1;
    }>
  | Readonly<{
      kind: "trading-action";
      eventId: string;
      eventTimeNs: string;
      trustedSequence: string | null;
      action: "halt" | "quote-resume" | "trade-resume" | "reset";
    }>;

export type QuoteTimelineSelectionV1 =
  | Readonly<{
      status: "selected-complete" | "selected-degraded";
      selectedEventId: string;
      marketEventTimeNs: string;
      exactMidpoint: CanonicalRationalV1;
      reason: null;
      diagnostics: readonly CanonicalMarketReasonV1[];
    }>
  | Readonly<{
      status: "missing";
      selectedEventId: null;
      marketEventTimeNs: null;
      exactMidpoint: null;
      reason: CanonicalMarketReasonV1;
      diagnostics: readonly CanonicalMarketReasonV1[];
    }>;

function missingQuoteTimeline(reason: CanonicalMarketReasonV1): QuoteTimelineSelectionV1 {
  return Object.freeze({
    status: "missing",
    selectedEventId: null,
    marketEventTimeNs: null,
    exactMidpoint: null,
    reason,
    diagnostics: Object.freeze([]),
  });
}

/**
 * Replays a bounded quote/control window to an as-of target. Future events are ignored; halt and
 * reset clear state; quote resume never restores pre-halt state; overnight observations use an
 * isolated lane; and unresolved equal-time economic conflicts fail closed.
 */
export function selectQuoteTimelineReference(
  events: readonly QuoteTimelineEventV1[],
  targetNs: string,
): QuoteTimelineSelectionV1 {
  const target = parseEpochNanoseconds(targetNs);
  const admitted = events.filter((event) => parseEpochNanoseconds(event.eventTimeNs) <= target);
  const byTime = new Map<string, QuoteTimelineEventV1[]>();
  for (const event of admitted) {
    if (event.eventId.length === 0) invalidInput();
    const key = parseEpochNanoseconds(event.eventTimeNs).toString();
    const group = byTime.get(key) ?? [];
    group.push(event);
    byTime.set(key, group);
  }
  const orderedTimes = [...byTime.keys()].sort((left, right) =>
    BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0,
  );
  let halted = false;
  let current: Extract<QuoteTimelineEventV1, { kind: "quote" }> | null = null;
  let lastExclusion: CanonicalMarketReasonV1 | null = null;

  for (const time of orderedTimes) {
    const group = byTime.get(time) as QuoteTimelineEventV1[];
    const sequences = group.map((event) =>
      event.trustedSequence === null ? null : parseSequence(event.trustedSequence),
    );
    const hasTotalSequence =
      sequences.every((sequence) => sequence !== null) &&
      new Set(sequences.map((sequence) => (sequence as bigint).toString())).size === group.length;
    if (!hasTotalSequence) {
      const primaryQuotes = group.filter(
        (event): event is Extract<QuoteTimelineEventV1, { kind: "quote" }> =>
          event.kind === "quote" && event.sessionKind !== "overnight",
      );
      const economicStates = new Set(
        primaryQuotes.map((event) => canonicalJson(event.payload as unknown as JsonValue)),
      );
      if (economicStates.size > 1) {
        return missingQuoteTimeline(
          marketReason("market.sequence-insufficient", {
            sequenceFailureKind: "equal-time-ambiguous",
          }),
        );
      }
    }
    const orderedGroup = [...group].sort((left, right) => {
      if (hasTotalSequence) {
        const leftSequence = parseSequence(left.trustedSequence as string);
        const rightSequence = parseSequence(right.trustedSequence as string);
        if (leftSequence !== rightSequence) return leftSequence < rightSequence ? -1 : 1;
      }
      return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
    });
    for (const event of orderedGroup) {
      if (event.kind === "trading-action") {
        if (event.action === "halt") {
          halted = true;
          current = null;
          lastExclusion = marketReason("market.quote-halt");
        } else if (event.action === "quote-resume") {
          halted = false;
          current = null;
          lastExclusion = marketReason("market.no-eligible-quote");
        } else if (event.action === "reset") {
          current = null;
          lastExclusion = marketReason("market.no-eligible-quote");
        }
        continue;
      }
      if (event.sessionKind === "overnight") {
        lastExclusion = marketReason("market.overnight-primary-forbidden");
        continue;
      }
      if (halted) {
        lastExclusion = marketReason("market.quote-halt");
        continue;
      }
      const boundary = evaluatePrimaryQuoteBoundary(event.payload, event.sessionKind, "0");
      if (boundary.status === "missing") {
        lastExclusion = boundary.reason;
        continue;
      }
      current = event;
      lastExclusion = null;
    }
  }

  if (current === null) {
    return missingQuoteTimeline(lastExclusion ?? marketReason("market.no-eligible-quote"));
  }
  const age = target - parseEpochNanoseconds(current.eventTimeNs);
  const boundary = evaluatePrimaryQuoteBoundary(
    current.payload,
    current.sessionKind as "regular-continuous" | "extended-pre" | "extended-post",
    age.toString(),
  );
  if (boundary.status === "missing") return missingQuoteTimeline(boundary.reason);
  return Object.freeze({
    status: boundary.status,
    selectedEventId: current.eventId,
    marketEventTimeNs: current.eventTimeNs,
    exactMidpoint: boundary.exactMidpoint,
    reason: null,
    diagnostics: boundary.diagnostics,
  });
}

export type IsolatedQuoteCandidateV1 = Readonly<{
  candidateId: string;
  eventTimeNs: string;
  payload: QuotePayloadV1;
}>;

export type IsolatedQuoteSelectionV1 =
  | Readonly<{
      status: "selected";
      referenceKind: "quote-nbbo-midpoint" | "bolo";
      selectedCandidateId: string;
      exactMidpoint: CanonicalRationalV1;
      reason: null;
    }>
  | Readonly<{
      status: "missing";
      referenceKind: "quote-nbbo-midpoint" | "bolo";
      selectedCandidateId: null;
      exactMidpoint: null;
      reason: CanonicalMarketReasonV1;
    }>;

/** Selects protected NBBO and BOLO in disjoint state lanes. Neither kind can mutate the other. */
export function selectIsolatedQuoteReference(
  candidates: readonly IsolatedQuoteCandidateV1[],
  referenceKind: "quote-nbbo-midpoint" | "bolo",
  targetNs: string,
): IsolatedQuoteSelectionV1 {
  const target = parseEpochNanoseconds(targetNs);
  const quoteKind = referenceKind === "bolo" ? "bolo" : "nbbo";
  const lane = candidates
    .filter(
      (candidate) =>
        candidate.payload.quoteKind === quoteKind &&
        parseEpochNanoseconds(candidate.eventTimeNs) <= target,
    )
    .sort((left, right) =>
      parseEpochNanoseconds(left.eventTimeNs) < parseEpochNanoseconds(right.eventTimeNs) ? -1 : 1,
    );
  const latest = lane.at(-1);
  if (latest === undefined) {
    return Object.freeze({
      status: "missing",
      referenceKind,
      selectedCandidateId: null,
      exactMidpoint: null,
      reason: marketReason("market.no-eligible-quote"),
    });
  }
  const latestTime = parseEpochNanoseconds(latest.eventTimeNs);
  const tied = lane.filter(
    (candidate) => parseEpochNanoseconds(candidate.eventTimeNs) === latestTime,
  );
  const economicStates = new Set(
    tied.map((candidate) => canonicalJson(candidate.payload as unknown as JsonValue)),
  );
  if (economicStates.size > 1) {
    return Object.freeze({
      status: "missing",
      referenceKind,
      selectedCandidateId: null,
      exactMidpoint: null,
      reason: marketReason("market.sequence-insufficient", {
        sequenceFailureKind: "equal-time-ambiguous",
      }),
    });
  }
  const winner = [...tied].sort((left, right) =>
    left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0,
  )[0] as IsolatedQuoteCandidateV1;
  return Object.freeze({
    status: "selected",
    referenceKind,
    selectedCandidateId: winner.candidateId,
    exactMidpoint: quoteMidpoint(winner.payload),
    reason: null,
  });
}

/**
 * Selects the last strict-executable NBBO at or before the target, so an excluded latest quote
 * does not prevent a still-fresh earlier strict candidate from being selected.
 */
export function selectStrictExecutableQuote(
  candidates: readonly IsolatedQuoteCandidateV1[],
  targetNs: string,
): IsolatedQuoteSelectionV1 {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.payload.quoteKind === "nbbo" &&
      evaluateStrictExecutableQuote(candidate.payload).status === "eligible",
  );
  return selectIsolatedQuoteReference(eligible, "quote-nbbo-midpoint", targetNs);
}

export type IndependentSourceReferenceV1 = Readonly<{
  sourceIdentity: string;
  selectionIdentity: string;
  exactPrice: CanonicalDecimalV1 | CanonicalRationalV1 | null;
}>;

export type IndependentSourceComparisonV1 = Readonly<{
  comparison: "agree" | "disagree" | "not-comparable";
  sourceIdentities: readonly string[];
  selectionIdentities: readonly string[];
}>;

function exactFraction(value: CanonicalDecimalV1 | CanonicalRationalV1): readonly [bigint, bigint] {
  if ("coefficient" in value) {
    requirePositiveDecimal(value);
    return [(value.negative ? -1n : 1n) * BigInt(value.coefficient), 10n ** BigInt(value.scale)];
  }
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  if (denominator <= 0n) invalidInput();
  return [numerator, denominator];
}

/** Compares exact values while retaining independent source and selection identities. */
export function compareIndependentSourceReferences(
  references: readonly IndependentSourceReferenceV1[],
): IndependentSourceComparisonV1 {
  if (
    references.length < 2 ||
    new Set(references.map((reference) => reference.sourceIdentity)).size !== references.length ||
    references.some(
      (reference) =>
        reference.sourceIdentity.length === 0 || reference.selectionIdentity.length === 0,
    )
  ) {
    invalidInput();
  }
  const sourceIdentities = Object.freeze(references.map((reference) => reference.sourceIdentity));
  const selectionIdentities = Object.freeze(
    references.map((reference) => reference.selectionIdentity),
  );
  if (references.some((reference) => reference.exactPrice === null)) {
    return Object.freeze({
      comparison: "not-comparable",
      sourceIdentities,
      selectionIdentities,
    });
  }
  const [firstNumerator, firstDenominator] = exactFraction(
    references[0]?.exactPrice as CanonicalDecimalV1 | CanonicalRationalV1,
  );
  const agree = references.slice(1).every((reference) => {
    const [numerator, denominator] = exactFraction(
      reference.exactPrice as CanonicalDecimalV1 | CanonicalRationalV1,
    );
    return firstNumerator * denominator === numerator * firstDenominator;
  });
  return Object.freeze({
    comparison: agree ? "agree" : "disagree",
    sourceIdentities,
    selectionIdentities,
  });
}

export type RecordedBarSensitivityV1 =
  | Readonly<{
      status: "point-eligible" | "adjusted-sensitivity-only";
      exactClose: CanonicalDecimalV1;
      adjustmentMode: BarPayloadV1["adjustmentMode"];
      reason: null;
    }>
  | Readonly<{
      status: "missing";
      exactClose: null;
      adjustmentMode: BarPayloadV1["adjustmentMode"];
      reason: CanonicalMarketReasonV1;
    }>;

/**
 * Keeps adjusted bars executable as explicitly labeled sensitivities, while only raw completed
 * one-minute bars can serve the point-market B(t) lane.
 */
export function evaluateRecordedBarSensitivity(
  payload: BarPayloadV1,
  targetNs: string,
): RecordedBarSensitivityV1 {
  requirePositiveDecimal(payload.close);
  const start = parseEpochNanoseconds(payload.barStartNs);
  const end = parseEpochNanoseconds(payload.barEndNs);
  const target = parseEpochNanoseconds(targetNs);
  if (payload.barKind !== "one-minute" || end - start !== BAR_DURATION_NS) invalidInput();
  if (end > target) {
    return Object.freeze({
      status: "missing",
      exactClose: null,
      adjustmentMode: payload.adjustmentMode,
      reason: marketReason("market.bar-interval-future"),
    });
  }
  if (target - end > COMPLETED_BAR_AGE_NS) {
    return Object.freeze({
      status: "missing",
      exactClose: null,
      adjustmentMode: payload.adjustmentMode,
      reason: marketReason("market.bar-stale"),
    });
  }
  if (payload.adjustmentMode === "unknown") {
    return Object.freeze({
      status: "missing",
      exactClose: null,
      adjustmentMode: payload.adjustmentMode,
      reason: marketReason("market.adjustment-unknown"),
    });
  }
  return Object.freeze({
    status: payload.adjustmentMode === "raw" ? "point-eligible" : "adjusted-sensitivity-only",
    exactClose: payload.close,
    adjustmentMode: payload.adjustmentMode,
    reason: null,
  });
}

export type PriorCloseSensitivityFactV1 = Readonly<{
  factId: string;
  factKind: "corrected-close" | "official-close" | "final-trade" | "completed-bar";
  eventTimeNs: string;
  exactPrice: CanonicalDecimalV1;
}>;

export type PriorCloseSensitivitySelectionV1 = Readonly<{
  primaryPriorClose:
    | Readonly<{
        status: "selected";
        factId: string;
        factKind: "corrected-close" | "official-close";
        exactPrice: CanonicalDecimalV1;
        reason: null;
      }>
    | Readonly<{
        status: "missing";
        factId: null;
        factKind: null;
        exactPrice: null;
        reason: CanonicalMarketReasonV1;
      }>;
  finalTradeSensitivity:
    | Readonly<{ status: "selected"; factId: string; exactPrice: CanonicalDecimalV1 }>
    | Readonly<{ status: "missing"; factId: null; exactPrice: null }>;
  completedBarSensitivity:
    | Readonly<{ status: "selected"; factId: string; exactPrice: CanonicalDecimalV1 }>
    | Readonly<{ status: "missing"; factId: null; exactPrice: null }>;
}>;

function latestSensitivityFact(
  facts: readonly PriorCloseSensitivityFactV1[],
  factKind: PriorCloseSensitivityFactV1["factKind"],
  target: bigint,
): PriorCloseSensitivityFactV1 | null {
  const eligible = facts
    .filter(
      (fact) => fact.factKind === factKind && parseEpochNanoseconds(fact.eventTimeNs) <= target,
    )
    .sort((left, right) => {
      const leftTime = parseEpochNanoseconds(left.eventTimeNs);
      const rightTime = parseEpochNanoseconds(right.eventTimeNs);
      if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
      return left.factId < right.factId ? 1 : left.factId > right.factId ? -1 : 0;
    });
  return eligible.at(-1) ?? null;
}

/**
 * Applies corrected-close precedence only inside the primary prior-close lane. Final-trade and
 * completed-bar facts remain independently selected sensitivities and never fill a missing Cprev.
 */
export function selectPriorCloseAndSensitivities(
  facts: readonly PriorCloseSensitivityFactV1[],
  targetNs: string,
): PriorCloseSensitivitySelectionV1 {
  const target = parseEpochNanoseconds(targetNs);
  for (const fact of facts) {
    if (fact.factId.length === 0) invalidInput();
    requirePositiveDecimal(fact.exactPrice);
    parseEpochNanoseconds(fact.eventTimeNs);
  }
  const corrected = latestSensitivityFact(facts, "corrected-close", target);
  const official = latestSensitivityFact(facts, "official-close", target);
  const primary = corrected ?? official;
  const finalTrade = latestSensitivityFact(facts, "final-trade", target);
  const completedBar = latestSensitivityFact(facts, "completed-bar", target);
  return Object.freeze({
    primaryPriorClose:
      primary === null
        ? Object.freeze({
            status: "missing",
            factId: null,
            factKind: null,
            exactPrice: null,
            reason: marketReason("market.prior-close-missing", {
              priorCloseFailureKind: "absent",
            }),
          })
        : Object.freeze({
            status: "selected",
            factId: primary.factId,
            factKind: primary.factKind as "corrected-close" | "official-close",
            exactPrice: primary.exactPrice,
            reason: null,
          }),
    finalTradeSensitivity:
      finalTrade === null
        ? Object.freeze({ status: "missing", factId: null, exactPrice: null })
        : Object.freeze({
            status: "selected",
            factId: finalTrade.factId,
            exactPrice: finalTrade.exactPrice,
          }),
    completedBarSensitivity:
      completedBar === null
        ? Object.freeze({ status: "missing", factId: null, exactPrice: null })
        : Object.freeze({
            status: "selected",
            factId: completedBar.factId,
            exactPrice: completedBar.exactPrice,
          }),
  });
}
