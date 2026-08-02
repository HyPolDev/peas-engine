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

const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;
const FIRST_SUPPORTED_CALENDAR_YEAR = 2007;
const LAST_SUPPORTED_CALENDAR_YEAR = 9_999;
const pad = (value: number): string => String(value).padStart(2, "0");

function nthSundayUtcMs(year: number, month: number, ordinal: number, hour: number): number {
  const first = new Date(Date.UTC(year, month, 1));
  const day = 1 + ((7 - first.getUTCDay()) % 7) + (ordinal - 1) * 7;
  return Date.UTC(year, month, day, hour);
}

/** Immutable post-2007 America/New_York DST rule used by this frozen synthetic authority. */
function utcOffsetAt(milliseconds: number): -300 | -240 {
  const year = new Date(milliseconds).getUTCFullYear();
  if (year < FIRST_SUPPORTED_CALENDAR_YEAR || year > LAST_SUPPORTED_CALENDAR_YEAR) {
    throw new TypeError("wire-semantic-calendar-year-unsupported");
  }
  const daylightStart = nthSundayUtcMs(year, 2, 2, 7);
  const daylightEnd = nthSundayUtcMs(year, 10, 1, 6);
  return milliseconds >= daylightStart && milliseconds < daylightEnd ? -240 : -300;
}

function localDate(milliseconds: number): string {
  const offset = utcOffsetAt(milliseconds);
  const local = new Date(milliseconds + offset * MINUTE_MS);
  return (
    String(local.getUTCFullYear()).padStart(4, "0") +
    "-" +
    pad(local.getUTCMonth() + 1) +
    "-" +
    pad(local.getUTCDate())
  );
}

function parseDate(value: string): Readonly<{ year: number; month: number; day: number }> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) throw new TypeError("wire-semantic-calendar-date-invalid");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const verified = new Date(Date.UTC(year, month - 1, day));
  if (
    verified.getUTCFullYear() !== year ||
    verified.getUTCMonth() !== month - 1 ||
    verified.getUTCDate() !== day
  ) {
    throw new TypeError("wire-semantic-calendar-date-invalid");
  }
  if (year < FIRST_SUPPORTED_CALENDAR_YEAR || year > LAST_SUPPORTED_CALENDAR_YEAR) {
    throw new TypeError("wire-semantic-calendar-year-unsupported");
  }
  return Object.freeze({ year, month, day });
}

function localEpochNs(
  date: Readonly<{ year: number; month: number; day: number }>,
  hour: number,
  minute: number,
  offset: -300 | -240,
): string {
  return (
    BigInt(Date.UTC(date.year, date.month - 1, date.day, hour, minute) - offset * MINUTE_MS) *
    1_000_000n
  ).toString();
}

function syntheticCalendarEntry(sessionDate: string): FrozenSessionCalendarEntryV1 {
  const date = parseDate(sessionDate);
  const noonUtc = Date.UTC(date.year, date.month - 1, date.day, 17);
  const utcOffsetMinutes = utcOffsetAt(noonUtc);
  const dayOfWeek = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  const holiday = dayOfWeek === 0 || dayOfWeek === 6 || sessionDate === "2033-05-05";
  if (holiday) {
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
  if (sessionDate === "2033-05-06") {
    return Object.freeze({
      sessionDate,
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      calendarVersion: ALPACA_WIRE_CALENDAR_VERSION,
      holiday: false,
      extendedOpenNs: "1998950399999999999",
      regularOpenNs: "1998950400000000000",
      regularCloseNs: "1999036800000000001",
      extendedCloseNs: "1999036800000000002",
    });
  }
  return Object.freeze({
    sessionDate,
    timeZone: "America/New_York",
    utcOffsetMinutes,
    calendarVersion: ALPACA_WIRE_CALENDAR_VERSION,
    holiday: false,
    extendedOpenNs: localEpochNs(date, 4, 0, utcOffsetMinutes),
    regularOpenNs: localEpochNs(date, 9, 30, utcOffsetMinutes),
    regularCloseNs: localEpochNs(date, 16, 0, utcOffsetMinutes),
    extendedCloseNs: localEpochNs(date, 20, 0, utcOffsetMinutes),
  });
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
  for (let cursor = startMs; cursor <= endMs; cursor += SIX_HOURS_MS) {
    dates.add(localDate(cursor));
  }
  dates.add(localDate(endMs));
  return Object.freeze([...dates].sort().map(syntheticCalendarEntry));
}
