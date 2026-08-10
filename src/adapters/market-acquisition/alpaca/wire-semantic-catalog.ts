import { canonicalHash } from "../../../core/hash.js";
import type { FrozenSessionCalendarEntryV1 } from "../../../providers/market-reference/operations.js";

export const ALPACA_WIRE_CALENDAR_VERSION = "peas-p1-10-original-synthetic-calendar-v1";
export const ALPACA_PRIMARY_CORPUS_AUTHORITY_ID =
  "wsc1_" +
  canonicalHash("peas/alpaca-primary-corpus-authority/v1", {
    provider: "alpaca",
    lane: "historical-sip",
    role: "primary",
  });

interface AcceptedCalendarRecord {
  readonly dayStartNs: bigint;
  readonly dayEndNs: bigint;
  readonly entry: FrozenSessionCalendarEntryV1;
}

function acceptedRecord(
  dayStartNs: string,
  dayEndNs: string,
  entry: FrozenSessionCalendarEntryV1,
): AcceptedCalendarRecord {
  return Object.freeze({ dayStartNs: BigInt(dayStartNs), dayEndNs: BigInt(dayEndNs), entry });
}

function closedSession(
  sessionDate: string,
  utcOffsetMinutes: -300 | -240,
): FrozenSessionCalendarEntryV1 {
  return Object.freeze({
    sessionDate,
    timeZone: "America/New_York",
    utcOffsetMinutes,
    calendarVersion: ALPACA_WIRE_CALENDAR_VERSION,
    holiday: true,
    extendedOpenNs: null,
    regularOpenNs: null,
    regularCloseNs: null,
    extendedCloseNs: null,
  });
}

function openSession(
  sessionDate: string,
  utcOffsetMinutes: -300 | -240,
  extendedOpenNs: string,
  regularOpenNs: string,
  regularCloseNs: string,
  extendedCloseNs: string,
): FrozenSessionCalendarEntryV1 {
  return Object.freeze({
    sessionDate,
    timeZone: "America/New_York",
    utcOffsetMinutes,
    calendarVersion: ALPACA_WIRE_CALENDAR_VERSION,
    holiday: false,
    extendedOpenNs,
    regularOpenNs,
    regularCloseNs,
    extendedCloseNs,
  });
}

/**
 * Complete immutable authority for the original synthetic P1-10 query fixtures only.
 * Dates, local-day bounds, UTC offsets, closures, and session boundaries are literal accepted
 * evidence. Unknown dates are never reconstructed from weekday, holiday, or DST rules.
 */
const ACCEPTED_CALENDAR = Object.freeze([
  acceptedRecord(
    "1994043600000000000",
    "1994130000000000000",
    openSession(
      "2033-03-10",
      -300,
      "1994058000000000000",
      "1994077800000000000",
      "1994101200000000000",
      "1994115600000000000",
    ),
  ),
  acceptedRecord(
    "1994130000000000000",
    "1994216400000000000",
    openSession(
      "2033-03-11",
      -300,
      "1994144400000000000",
      "1994164200000000000",
      "1994187600000000000",
      "1994202000000000000",
    ),
  ),
  acceptedRecord("1994216400000000000", "1994302800000000000", closedSession("2033-03-12", -300)),
  acceptedRecord("1994302800000000000", "1994385600000000000", closedSession("2033-03-13", -240)),
  acceptedRecord(
    "1994385600000000000",
    "1994472000000000000",
    openSession(
      "2033-03-14",
      -240,
      "1994400000000000000",
      "1994419800000000000",
      "1994443200000000000",
      "1994457600000000000",
    ),
  ),
  acceptedRecord("1998878400000000000", "1998964800000000000", closedSession("2033-05-05", -240)),
  acceptedRecord(
    "1998964800000000000",
    "1999051200000000000",
    openSession(
      "2033-05-06",
      -240,
      "1998950399999999999",
      "1998950400000000000",
      "1999036800000000001",
      "1999036800000000002",
    ),
  ),
  acceptedRecord(
    "2014603200000000000",
    "2014689600000000000",
    openSession(
      "2033-11-03",
      -240,
      "2014617600000000000",
      "2014637400000000000",
      "2014660800000000000",
      "2014675200000000000",
    ),
  ),
  acceptedRecord(
    "2014689600000000000",
    "2014776000000000000",
    openSession(
      "2033-11-04",
      -240,
      "2014704000000000000",
      "2014723800000000000",
      "2014747200000000000",
      "2014761600000000000",
    ),
  ),
  acceptedRecord("2014776000000000000", "2014862400000000000", closedSession("2033-11-05", -240)),
  acceptedRecord("2014862400000000000", "2014952400000000000", closedSession("2033-11-06", -300)),
  acceptedRecord(
    "2014952400000000000",
    "2015038800000000000",
    openSession(
      "2033-11-07",
      -300,
      "2014966800000000000",
      "2014986600000000000",
      "2015010000000000000",
      "2015024400000000000",
    ),
  ),
]);

function containingRecordIndex(epochNs: bigint): number {
  return ACCEPTED_CALENDAR.findIndex(
    (record) => epochNs >= record.dayStartNs && epochNs < record.dayEndNs,
  );
}

export function acceptedAlpacaWireCalendarEntries(
  queryStartNs: string,
  queryEndNs: string,
): readonly FrozenSessionCalendarEntryV1[] {
  let startNs: bigint;
  let endNs: bigint;
  try {
    startNs = BigInt(queryStartNs);
    endNs = BigInt(queryEndNs);
  } catch {
    throw new TypeError("wire-semantic-calendar-range-invalid");
  }
  if (startNs > endNs) throw new TypeError("wire-semantic-calendar-range-invalid");
  const startIndex = containingRecordIndex(startNs);
  const endIndex = containingRecordIndex(endNs);
  if (startIndex < 0 || endIndex < startIndex) {
    throw new TypeError("wire-semantic-calendar-unknown");
  }
  for (let index = startIndex; index < endIndex; index += 1) {
    const current = ACCEPTED_CALENDAR[index];
    const next = ACCEPTED_CALENDAR[index + 1];
    if (current === undefined || next === undefined || current.dayEndNs !== next.dayStartNs) {
      throw new TypeError("wire-semantic-calendar-unknown");
    }
  }
  return Object.freeze(
    ACCEPTED_CALENDAR.slice(startIndex, endIndex + 1).map((record) => record.entry),
  );
}
