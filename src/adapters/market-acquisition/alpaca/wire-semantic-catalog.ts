import { canonicalHash } from "../../../core/hash.js";
import type { FrozenSessionCalendarEntryV1 } from "../../../providers/market-reference/operations.js";

export const ALPACA_WIRE_CALENDAR_VERSION = "peas-p1-10-original-synthetic-calendar-v1";
export const ALPACA_PRIMARY_CORPUS_AUTHORITY_ID = `wsc1_${canonicalHash(
  "peas/alpaca-primary-corpus-authority/v1",
  { provider: "alpaca", lane: "historical-sip", role: "primary" },
)}`;

const CATALOG = Object.freeze(
  new Map<string, FrozenSessionCalendarEntryV1>([
    [
      "2033-05-05",
      Object.freeze({
        sessionDate: "2033-05-05",
        timeZone: "America/New_York",
        utcOffsetMinutes: -240,
        calendarVersion: ALPACA_WIRE_CALENDAR_VERSION,
        holiday: true,
        extendedOpenNs: null,
        regularOpenNs: null,
        regularCloseNs: null,
        extendedCloseNs: null,
      }),
    ],
    [
      "2033-05-06",
      Object.freeze({
        sessionDate: "2033-05-06",
        timeZone: "America/New_York",
        utcOffsetMinutes: -240,
        calendarVersion: ALPACA_WIRE_CALENDAR_VERSION,
        holiday: false,
        extendedOpenNs: "1998950399999999999",
        regularOpenNs: "1998950400000000000",
        regularCloseNs: "1999036800000000001",
        extendedCloseNs: "1999036800000000002",
      }),
    ],
  ]),
);

const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function localDate(milliseconds: number): string {
  const parts = Object.fromEntries(
    NEW_YORK_DATE.formatToParts(new Date(milliseconds)).map((part) => [part.type, part.value]),
  );
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

export function acceptedAlpacaWireCalendarEntries(
  queryStartNs: string,
  queryEndNs: string,
): readonly FrozenSessionCalendarEntryV1[] {
  const startMs = Number(BigInt(queryStartNs) / 1_000_000n);
  const endMs = Number(BigInt(queryEndNs) / 1_000_000n);
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs > endMs) {
    throw new TypeError("wire-semantic-calendar-range-invalid");
  }
  const dates = new Set<string>();
  for (let cursor = startMs; cursor <= endMs; cursor += 6 * 60 * 60 * 1_000) {
    dates.add(localDate(cursor));
  }
  dates.add(localDate(endMs));
  const entries = [...dates].sort().map((date) => {
    const entry = CATALOG.get(date);
    if (entry === undefined) throw new TypeError("wire-semantic-calendar-catalog-missing");
    return entry;
  });
  return Object.freeze(entries);
}
