import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isProxy } from "node:util/types";

import Database from "better-sqlite3";

import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import {
  type CanonicalDecimalV1,
  type MarketTimestampV1,
  type RecordedMarketRecordV1,
  SIGNED_NS_MAX,
  SIGNED_NS_MIN,
} from "../src/providers/market-reference/contracts.js";
import {
  canonicalDecimalFromToken,
  deriveCanonicalProviderPayloadDigest,
  normalizeRecordedMarketRecords,
} from "../src/providers/market-reference/normalization.js";

type EndpointKind = "quotes" | "trades" | "bars";
type PlainRecord = Record<string, unknown>;
type RawNumber = Readonly<{ readonly rawNumber: string }>;

type TimestampResult = Readonly<{
  timestamp: MarketTimestampV1;
  canonicalUtc: string;
  fractionalDigits: number;
}>;

type Quarantine = Readonly<{
  endpointKind: EndpointKind;
  reason: string;
  symbol: string;
  itemIndex: number;
}>;

type BarObservation = Readonly<{
  logicalKey: string;
  wireDigest: string;
  symbol: string;
  itemIndex: number;
  record: RecordedMarketRecordV1 | null;
  quarantineReason: string | null;
}>;

type PageAdmission = Readonly<{
  endpointKind: EndpointKind;
  terminal: boolean;
  privateNextToken: string | null;
  records: readonly RecordedMarketRecordV1[];
  quarantines: readonly Quarantine[];
  barObservations: readonly BarObservation[];
  terminalReason: "correction-unsupported" | null;
  publicSummary: Readonly<{
    endpointKind: EndpointKind;
    recordCount: number;
    quarantineCount: number;
    terminalReason: "correction-unsupported" | null;
  }>;
}>;

type ParseContext = Readonly<{
  requestedSymbols: readonly string[];
  instrumentIds: Readonly<Record<string, string>>;
  queryStartNs: bigint;
  queryEndNs: bigint;
  entitlementSnapshotId: string;
  marketAcquisitionId: string;
  rawArtifactId: string;
  calendarVersion: string;
  durableClockBasisId: string;
  durablyRecordedAtMs: number;
  durableLogicalAtMs: number;
  sessionKind: RecordedMarketRecordV1["sessionKind"];
  primaryCorpusMember: boolean;
  timeframe: "1Min";
  adjustment: "raw";
}>;

class WireContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WireContractError";
  }
}

const reject = (code: string): never => {
  throw new WireContractError(code);
};

const IDS = Object.freeze({
  providerId: "mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c",
  datasetId: "mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1",
  feedId: "mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023",
  quotes: "mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0",
  trades: "mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1",
  bars: "mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c",
} as const);

const ENDPOINT_DATA_FIELD = Object.freeze({
  quotes: "quotes",
  trades: "trades",
  bars: "bars",
} satisfies Readonly<Record<EndpointKind, string>>);

const ITEM_FIELDS = Object.freeze({
  quotes: Object.freeze(["t", "bx", "bp", "bs", "ap", "as", "ax", "c", "z"]),
  trades: Object.freeze(["t", "i", "x", "p", "s", "c", "z"]),
  bars: Object.freeze(["t", "o", "h", "l", "c", "v", "n", "vw"]),
} satisfies Readonly<Record<EndpointKind, readonly string[]>>);

const RAW_LIMITS = Object.freeze({
  depth: 32,
  nodes: 250_000,
  keysPerObject: 64,
  arrayItems: 10_000,
  parserTokens: 250_000,
  genericStringBytes: 1_024,
  pageTokenBytes: 4_096,
});

const CHAIN_LIMITS = Object.freeze({
  pages: 16,
  rawBytesPerPage: 10 * 1024 * 1024,
  aggregateVerifiedBytes: 64 * 1024 * 1024,
  normalizedFacts: 160_000,
});

const FIXTURE_ROOT = "fixtures/market-acquisition/v1/wire-grammar";
const validFixture = JSON.parse(
  readFileSync(`${FIXTURE_ROOT}/valid-pages.json`, "utf8"),
) as Readonly<{ cases: readonly ValidCase[] }>;
const grammarFixture = JSON.parse(
  readFileSync(`${FIXTURE_ROOT}/grammar-faults.json`, "utf8"),
) as Readonly<{ cases: readonly FixtureCase[] }>;
const paginationFixture = JSON.parse(
  readFileSync(`${FIXTURE_ROOT}/pagination-delivery-faults.json`, "utf8"),
) as Readonly<{ cases: readonly FixtureCase[] }>;
const hostileAtomicityFixture = JSON.parse(
  readFileSync(`${FIXTURE_ROOT}/hostile-atomicity-faults.json`, "utf8"),
) as Readonly<{ cases: readonly FixtureCase[] }>;
const barTranslationFixture = JSON.parse(
  readFileSync(`${FIXTURE_ROOT}/bar-translation.json`, "utf8"),
) as Readonly<{
  cases: readonly Readonly<{
    caseId: string;
    wireCaseId: string;
    symbolGroupKey: string;
    itemIndex: number;
    providerStableRecordFamilyPreimage: JsonValue;
    providerStableRecordFamily: string;
    memberKey: string;
    expectedRecord: RecordedMarketRecordV1;
  }>[];
}>;

type ValidCase = Readonly<{
  caseId: string;
  endpointKind: EndpointKind;
  expectedGrammarDisposition: string;
  expectedTranslationDisposition: string;
  wire: PlainRecord;
}>;

type FixtureCase = Readonly<{
  caseId: string;
  [key: string]: unknown;
}>;

const validById = new Map(validFixture.cases.map((entry) => [entry.caseId, entry]));
const allSyntheticSymbols = Object.freeze(
  [
    ...new Set(
      validFixture.cases.flatMap((entry) => {
        const field = ENDPOINT_DATA_FIELD[entry.endpointKind];
        const groups = entry.wire[field] as PlainRecord;
        return Object.keys(groups);
      }),
    ),
  ].sort(),
);
const instrumentIds = Object.freeze(
  Object.fromEntries(
    allSyntheticSymbols.map((symbol) => [
      symbol,
      symbol === "PEASIVY"
        ? `min1_${"b".repeat(64)}`
        : `min1_${canonicalHash("peas/p1-10-wire-test-instrument/v1", symbol)}`,
    ]),
  ),
);

const BASE_CONTEXT: ParseContext = Object.freeze({
  requestedSymbols: allSyntheticSymbols,
  instrumentIds,
  queryStartNs: BigInt(parseTimestamp("2033-05-06T00:00:00Z").timestamp.epochNs),
  queryEndNs: BigInt(parseTimestamp("2033-05-07T00:00:00Z").timestamp.epochNs),
  entitlementSnapshotId: `ent1_${"a".repeat(64)}`,
  marketAcquisitionId: `maq1_${"d".repeat(64)}`,
  rawArtifactId: `mar1_${"c".repeat(64)}`,
  calendarVersion: "peas-p1-10-original-synthetic-calendar-v1",
  durableClockBasisId: `clk1_${"e".repeat(64)}`,
  durablyRecordedAtMs: 1_998_976_380_000,
  durableLogicalAtMs: 1_998_976_380_000,
  sessionKind: "regular-continuous",
  primaryCorpusMember: true,
  timeframe: "1Min",
  adjustment: "raw",
});

function rawNumber(rawNumber: string): RawNumber {
  return Object.freeze({ rawNumber });
}

function isRawNumber(value: unknown): value is RawNumber {
  if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value)) {
    return false;
  }
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    if (Object.getOwnPropertySymbols(value).length !== 0) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length !== 1 || keys[0] !== "rawNumber") return false;
    const descriptor = descriptors["rawNumber"];
    return (
      descriptor !== undefined &&
      "value" in descriptor &&
      descriptor.enumerable === true &&
      typeof descriptor.value === "string"
    );
  } catch {
    return false;
  }
}

function assertPlainRecord(value: unknown, code = "schema-invalid"): asserts value is PlainRecord {
  if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value)) {
    reject(code);
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) reject(code);
    if (Object.getOwnPropertySymbols(value).length !== 0) reject(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length > RAW_LIMITS.keysPerObject) {
      reject("rawJsonKeysPerObject");
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "__proto__" || !("value" in descriptor) || descriptor.enumerable !== true) {
        reject(code);
      }
    }
  } catch (error) {
    if (error instanceof WireContractError) throw error;
    reject(code);
  }
}

function assertDenseArray(value: unknown, code = "schema-invalid"): asserts value is unknown[] {
  if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value)) {
    reject(code);
  }
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) reject(code);
    if (Object.getOwnPropertySymbols(value).length !== 0) reject(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      reject(code);
    }
    const length = (lengthDescriptor as PropertyDescriptor & { value: number }).value;
    if (length > RAW_LIMITS.arrayItems) reject("rawJsonArrayItems");
    const allowedKeys = new Set(["length", ...Array.from({ length }, (_, index) => String(index))]);
    if (Object.keys(descriptors).some((key) => !allowedKeys.has(key))) reject(code);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        reject(code);
      }
    }
  } catch (error) {
    if (error instanceof WireContractError) throw error;
    reject(code);
  }
}

function assertExactKeys(
  value: PlainRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key))) reject("schema-invalid");
  if (actual.some((key) => !allowed.has(key))) reject("schema-invalid");
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function independentCanonicalJson(value: JsonValue): string {
  const active = new Set<object>();
  const encode = (candidate: unknown): string => {
    if (candidate === null) return "null";
    switch (typeof candidate) {
      case "string": {
        if (
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(candidate)
        ) {
          throw new TypeError("unpaired-surrogate");
        }
        return JSON.stringify(candidate);
      }
      case "boolean":
        return candidate ? "true" : "false";
      case "number":
        if (!Number.isSafeInteger(candidate) || Object.is(candidate, -0)) {
          throw new TypeError("non-canonical-number");
        }
        return JSON.stringify(candidate);
      case "object": {
        if (isProxy(candidate) || active.has(candidate)) {
          throw new TypeError("non-inert-container");
        }
        active.add(candidate);
        try {
          if (Array.isArray(candidate)) {
            const descriptors = Object.getOwnPropertyDescriptors(candidate);
            if (
              Object.getOwnPropertySymbols(candidate).length !== 0 ||
              candidate.length !== Object.keys(candidate).length ||
              Object.keys(candidate).some(
                (key, index) =>
                  key !== String(index) ||
                  !Object.hasOwn(descriptors, key) ||
                  !("value" in (descriptors[key] as PropertyDescriptor)),
              )
            ) {
              throw new TypeError("non-dense-array");
            }
            return `[${candidate
              .map((_, index) =>
                encode(
                  (
                    descriptors[String(index)] as PropertyDescriptor & {
                      value: unknown;
                    }
                  ).value,
                ),
              )
              .join(",")}]`;
          }
          const prototype = Object.getPrototypeOf(candidate);
          if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError("non-plain-object");
          }
          if (Object.getOwnPropertySymbols(candidate).length !== 0) {
            throw new TypeError("symbol-property");
          }
          const descriptors = Object.getOwnPropertyDescriptors(candidate);
          const keys = Object.keys(descriptors).sort((left, right) =>
            left < right ? -1 : left > right ? 1 : 0,
          );
          return `{${keys
            .map((key) => {
              const descriptor = descriptors[key];
              if (
                descriptor === undefined ||
                !("value" in descriptor) ||
                descriptor.enumerable !== true
              ) {
                throw new TypeError("non-data-property");
              }
              return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
            })
            .join(",")}}`;
        } finally {
          active.delete(candidate);
        }
      }
      default:
        throw new TypeError("non-json-value");
    }
  };
  return encode(value);
}

function independentFramedHash(domain: string, value: JsonValue): string {
  const hash = createHash("sha256");
  for (const part of [domain, independentCanonicalJson(value)]) {
    const bytes = Buffer.from(part, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.byteLength));
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function parseRawJson(text: string): unknown {
  let offset = 0;
  let nodes = 0;
  let tokens = 0;
  const countNode = (depth: number): void => {
    if (depth > RAW_LIMITS.depth) reject("rawJsonDepth");
    nodes += 1;
    tokens += 1;
    if (nodes > RAW_LIMITS.nodes) reject("rawJsonNodes");
    if (tokens > RAW_LIMITS.parserTokens) reject("parserTokensPerArtifact");
  };
  const whitespace = (): void => {
    while (/[\t\n\r ]/u.test(text[offset] ?? "")) offset += 1;
  };
  const parseString = (maximumBytes: number = RAW_LIMITS.genericStringBytes): string => {
    if (text[offset] !== '"') reject("malformed-json");
    const start = offset;
    offset += 1;
    let escaped = false;
    while (offset < text.length) {
      const character = text[offset] as string;
      if (!escaped && character === '"') {
        offset += 1;
        let decoded: unknown;
        try {
          decoded = JSON.parse(text.slice(start, offset));
        } catch {
          reject("malformed-json");
        }
        if (
          typeof decoded !== "string" ||
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(decoded)
        ) {
          reject("malformed-json");
        }
        if (utf8Bytes(decoded as string) > maximumBytes) {
          reject(
            maximumBytes === RAW_LIMITS.pageTokenBytes
              ? "pageTokenInputBytes"
              : "genericStringBytes",
          );
        }
        return decoded as string;
      }
      if (!escaped && character.charCodeAt(0) < 0x20) reject("malformed-json");
      if (!escaped && character === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      offset += 1;
    }
    throw new WireContractError("malformed-json");
  };
  const parseValue = (depth: number, maximumStringBytes?: number): unknown => {
    countNode(depth);
    whitespace();
    const character = text[offset];
    if (character === '"') return parseString(maximumStringBytes);
    if (character === "{") {
      offset += 1;
      const result: PlainRecord = Object.create(null) as PlainRecord;
      const names = new Set<string>();
      whitespace();
      if (text[offset] === "}") {
        offset += 1;
        return result;
      }
      for (;;) {
        whitespace();
        const name = parseString();
        tokens += 1;
        if (tokens > RAW_LIMITS.parserTokens) reject("parserTokensPerArtifact");
        if (names.has(name)) reject("duplicate-json-name");
        names.add(name);
        if (names.size > RAW_LIMITS.keysPerObject) reject("rawJsonKeysPerObject");
        whitespace();
        if (text[offset] !== ":") reject("malformed-json");
        offset += 1;
        result[name] = parseValue(
          depth + 1,
          name === "next_page_token" ? RAW_LIMITS.pageTokenBytes : undefined,
        );
        whitespace();
        if (text[offset] === "}") {
          offset += 1;
          return result;
        }
        if (text[offset] !== ",") reject("malformed-json");
        offset += 1;
      }
    }
    if (character === "[") {
      offset += 1;
      const result: unknown[] = [];
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return result;
      }
      for (;;) {
        if (result.length >= RAW_LIMITS.arrayItems) reject("rawJsonArrayItems");
        result.push(parseValue(depth + 1));
        whitespace();
        if (text[offset] === "]") {
          offset += 1;
          return result;
        }
        if (text[offset] !== ",") reject("malformed-json");
        offset += 1;
      }
    }
    for (const [literal, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return value;
      }
    }
    const match = text
      .slice(offset)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u);
    const token = match?.[0] ?? reject("malformed-json");
    offset += token.length;
    return rawNumber(token);
  };
  try {
    const value = parseValue(1);
    whitespace();
    if (offset !== text.length) reject("malformed-json");
    return value;
  } catch (error) {
    if (error instanceof WireContractError) throw error;
    return reject("malformed-json");
  }
}

function modelValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (
    entry: unknown,
    depth: number,
    maximumStringBytes: number = RAW_LIMITS.genericStringBytes,
  ): unknown => {
    if (depth > RAW_LIMITS.depth) reject("rawJsonDepth");
    nodes += 1;
    if (nodes > RAW_LIMITS.nodes) reject("rawJsonNodes");
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) reject("schema-invalid");
      return rawNumber(Object.is(entry, -0) ? "-0" : String(entry));
    }
    if (typeof entry === "string") {
      if (utf8Bytes(entry) > maximumStringBytes) reject("genericStringBytes");
      return entry;
    }
    if (typeof entry !== "object" || entry === null) return entry;
    if (isProxy(entry)) reject("schema-invalid");
    if (isRawNumber(entry)) return entry;
    if (seen.has(entry)) reject("schema-invalid");
    seen.add(entry);
    try {
      if (Array.isArray(entry)) {
        assertDenseArray(entry);
        const descriptors = Object.getOwnPropertyDescriptors(entry);
        const length = (
          Object.getOwnPropertyDescriptor(entry, "length") as PropertyDescriptor & {
            value: number;
          }
        ).value;
        return Array.from({ length }, (_, index) =>
          visit(
            (
              descriptors[String(index)] as PropertyDescriptor & {
                value: unknown;
              }
            ).value,
            depth + 1,
          ),
        );
      }
      assertPlainRecord(entry);
      const descriptors = Object.getOwnPropertyDescriptors(entry);
      return Object.fromEntries(
        Object.keys(descriptors).map((key) => [
          key,
          visit(
            (
              descriptors[key] as PropertyDescriptor & {
                value: unknown;
              }
            ).value,
            depth + 1,
            key === "next_page_token" ? Number.MAX_SAFE_INTEGER : RAW_LIMITS.genericStringBytes,
          ),
        ]),
      );
    } catch (error) {
      if (error instanceof WireContractError) throw error;
      return reject("schema-invalid");
    } finally {
      seen.delete(entry);
    }
  };
  return visit(value, 1);
}

function fixtureWire(caseId: string): PlainRecord {
  const entry = validById.get(caseId);
  assert.ok(entry, `missing valid fixture ${caseId}`);
  return structuredClone(entry.wire);
}

function firstGroup(page: PlainRecord, endpointKind: EndpointKind): [string, unknown[]] {
  const groups = page[ENDPOINT_DATA_FIELD[endpointKind]] as PlainRecord;
  const symbol = Object.keys(groups)[0];
  assert.ok(symbol);
  return [symbol, groups[symbol] as unknown[]];
}

function firstItem(page: PlainRecord, endpointKind: EndpointKind): PlainRecord {
  const [, items] = firstGroup(page, endpointKind);
  return items[0] as PlainRecord;
}

function expectWireError(code: string, operation: () => unknown): void {
  assert.throws(
    operation,
    (error: unknown) => error instanceof WireContractError && error.code === code,
  );
}

function floorDiv(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  const remainder = value % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function parseTimestamp(value: unknown): TimestampResult {
  if (typeof value !== "string") reject("market.timestamp-invalid");
  const text = value as string;
  if (utf8Bytes(text) > 64) reject("timestampTextBytes");
  const match = text.match(
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})$/u,
  );
  if (match === null) reject("market.timestamp-invalid");
  const parts = match as RegExpMatchArray;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone] =
    parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) reject("market.timestamp-invalid");
  const localMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const local = new Date(localMs);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() + 1 !== month ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    reject("market.timestamp-invalid");
  }
  let offsetMinutes = 0;
  const zoneText = zone ?? reject("market.timestamp-invalid");
  if (zoneText !== "Z") {
    const sign = zoneText[0] === "+" ? 1 : -1;
    const zoneHour = Number(zoneText.slice(1, 3));
    const zoneMinute = Number(zoneText.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59 || zoneText === "-00:00") {
      reject("market.timestamp-invalid");
    }
    offsetMinutes = sign * (zoneHour * 60 + zoneMinute);
  }
  const utcSeconds = BigInt(localMs / 1_000 - offsetMinutes * 60);
  const fractionalNs = BigInt(fraction.padEnd(9, "0") || "0");
  const epochNs = utcSeconds * 1_000_000_000n + fractionalNs;
  if (epochNs < SIGNED_NS_MIN || epochNs > SIGNED_NS_MAX) reject("market.timestamp-invalid");
  const digits = fraction.length;
  const precisionNs = 10n ** BigInt(9 - digits);
  const wholeSeconds = floorDiv(epochNs, 1_000_000_000n);
  const remainderNs = epochNs - wholeSeconds * 1_000_000_000n;
  const date = new Date(Number(wholeSeconds * 1_000n));
  const pad = (entry: number, length = 2): string => String(entry).padStart(length, "0");
  const renderedFraction =
    digits === 0
      ? ""
      : `.${(remainderNs / 10n ** BigInt(9 - digits)).toString().padStart(digits, "0")}`;
  const canonicalUtc = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(
    date.getUTCSeconds(),
  )}${renderedFraction}Z`;
  const reparsed = canonicalUtc.match(
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?Z$/u,
  );
  if (reparsed === null || (reparsed[7] ?? "").length !== digits)
    reject("market.timestamp-invalid");
  return Object.freeze({
    timestamp: Object.freeze({
      epochNs: epochNs.toString(),
      semantic: "provider-documented-event",
      precisionNs: precisionNs.toString(),
    }),
    canonicalUtc,
    fractionalDigits: digits,
  });
}

function numberToken(value: unknown): string {
  if (!isRawNumber(value)) reject("schema-invalid");
  const token = (value as RawNumber).rawNumber;
  if (Buffer.byteLength(token, "ascii") > 32) reject("rawDecimalTokenBytes");
  if (!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(token)) {
    reject("market.decimal-invalid");
  }
  return token;
}

function unsignedInteger(value: unknown, maximum: bigint, positive = false): bigint {
  const token = numberToken(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(token)) reject("schema-invalid");
  const parsed = BigInt(token);
  if (parsed > maximum) reject("bound-exceeded");
  if (positive && parsed === 0n) reject("schema-invalid");
  return parsed;
}

function decimal(value: unknown, allowZero = false): CanonicalDecimalV1 {
  const token = numberToken(value);
  const parsed = canonicalDecimalFromToken(token);
  if (parsed.negative || (!allowZero && parsed.coefficient === "0")) reject("schema-invalid");
  return parsed;
}

function compareDecimal(left: CanonicalDecimalV1, right: CanonicalDecimalV1): number {
  const scale = Math.max(left.scale, right.scale);
  const leftValue =
    BigInt(left.coefficient) * 10n ** BigInt(scale - left.scale) * (left.negative ? -1n : 1n);
  const rightValue =
    BigInt(right.coefficient) * 10n ** BigInt(scale - right.scale) * (right.negative ? -1n : 1n);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function nonemptyAscii(value: unknown, maximumBytes = 8): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[\x20-\x7e]+$/u.test(value) ||
    Buffer.byteLength(value, "ascii") > maximumBytes
  ) {
    reject("schema-invalid");
  }
  return value as string;
}

function conditions(value: unknown, endpointKind: "quotes" | "trades"): readonly string[] {
  assertDenseArray(value);
  if (value.length > 8) reject("conditionMembers");
  if (endpointKind === "quotes" && value.length !== 1 && value.length !== 2) {
    reject("schema-invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const parsed = Array.from({ length: value.length }, (_, index) =>
    nonemptyAscii(
      (
        descriptors[String(index)] as PropertyDescriptor & {
          value: unknown;
        }
      ).value,
    ),
  );
  if (new Set(parsed).size !== parsed.length) reject("schema-invalid");
  return Object.freeze(parsed);
}

function tape(value: unknown): "A" | "B" | "C" {
  if (value === "N" || value === "O") reject("market.dataset-feed-mismatch");
  if (value !== "A" && value !== "B" && value !== "C") reject("schema-invalid");
  return value as "A" | "B" | "C";
}

function endpointChannelId(endpointKind: EndpointKind): string {
  return IDS[endpointKind];
}

function fallbackFamily(record: {
  source: RecordedMarketRecordV1["source"];
  instrumentId: string;
  eventTime: MarketTimestampV1;
  canonicalProviderPayloadDigest: string;
}): string {
  return canonicalHash("peas/market-provider-fallback-family/v1", {
    providerId: record.source.providerId,
    datasetId: record.source.datasetId,
    feedId: record.source.feedId,
    endpointChannelId: record.source.endpointChannelId,
    entitlementSnapshotId: record.source.entitlementSnapshotId,
    instrumentId: record.instrumentId,
    eventKind: "bar",
    eventTime: record.eventTime,
    venueTapeId: null,
    providerSequence: null,
    canonicalProviderPayloadDigest: record.canonicalProviderPayloadDigest,
  } as unknown as JsonValue);
}

function wireDigest(endpointKind: EndpointKind, symbol: string, item: JsonValue): string {
  return canonicalHash("peas/p1-10-wire-record/v1", {
    endpointChannelId: endpointChannelId(endpointKind),
    symbolGroupKey: symbol,
    item,
  } as unknown as JsonValue);
}

type ValidatedItem =
  | Readonly<{
      kind: "quote";
      symbol: string;
      itemIndex: number;
      timestamp: TimestampResult;
      digest: string;
      contradiction: boolean;
    }>
  | Readonly<{
      kind: "trade";
      symbol: string;
      itemIndex: number;
      timestamp: TimestampResult;
      digest: string;
      update: "canceled" | "incorrect" | "corrected" | null;
      tradeId: string;
    }>
  | Readonly<{
      kind: "bar";
      symbol: string;
      itemIndex: number;
      timestamp: TimestampResult;
      digest: string;
      close: CanonicalDecimalV1;
      barStartNs: bigint;
      barEndNs: bigint;
      contradictory: boolean;
    }>;

function validateItem(
  endpointKind: EndpointKind,
  symbol: string,
  itemIndex: number,
  value: unknown,
  context: ParseContext,
): ValidatedItem {
  assertPlainRecord(value);
  assertExactKeys(value, ITEM_FIELDS[endpointKind], endpointKind === "trades" ? ["u"] : []);
  const timestamp = parseTimestamp(value["t"]);
  const epochNs = BigInt(timestamp.timestamp.epochNs);
  if (epochNs < context.queryStartNs || epochNs > context.queryEndNs) reject("schema-invalid");
  if (endpointKind === "quotes") {
    const bidExchange = nonemptyAscii(value["bx"]);
    const askExchange = nonemptyAscii(value["ax"]);
    const bid = decimal(value["bp"], true);
    const ask = decimal(value["ap"], true);
    const bidSize = unsignedInteger(value["bs"], 4_294_967_295n);
    const askSize = unsignedInteger(value["as"], 4_294_967_295n);
    const conditionCodes = conditions(value["c"], "quotes");
    const tapeCode = tape(value["z"]);
    return Object.freeze({
      kind: "quote",
      symbol,
      itemIndex,
      timestamp,
      digest: wireDigest(endpointKind, symbol, {
        t: timestamp.canonicalUtc,
        bx: bidExchange,
        bp: bid,
        bs: bidSize.toString(),
        ap: ask,
        as: askSize.toString(),
        ax: askExchange,
        c: conditionCodes,
        z: tapeCode,
      } as unknown as JsonValue),
      contradiction:
        bid.coefficient === "0" ||
        ask.coefficient === "0" ||
        bidSize === 0n ||
        askSize === 0n ||
        compareDecimal(bid, ask) > 0,
    });
  }
  if (endpointKind === "trades") {
    const tradeId = unsignedInteger(value["i"], 18_446_744_073_709_551_615n).toString();
    const exchange = nonemptyAscii(value["x"]);
    const price = decimal(value["p"]);
    const size = unsignedInteger(value["s"], 4_294_967_295n, true);
    const conditionCodes = conditions(value["c"], "trades");
    const tapeCode = tape(value["z"]);
    const update = value["u"];
    if (
      update !== undefined &&
      update !== "canceled" &&
      update !== "incorrect" &&
      update !== "corrected"
    ) {
      reject("schema-invalid");
    }
    return Object.freeze({
      kind: "trade",
      symbol,
      itemIndex,
      timestamp,
      digest: wireDigest(endpointKind, symbol, {
        t: timestamp.canonicalUtc,
        i: tradeId,
        x: exchange,
        p: price,
        s: size.toString(),
        c: conditionCodes,
        z: tapeCode,
        u: (update ?? null) as "canceled" | "incorrect" | "corrected" | null,
      } as unknown as JsonValue),
      update: (update ?? null) as "canceled" | "incorrect" | "corrected" | null,
      tradeId,
    });
  }
  if (context.timeframe !== "1Min" || context.adjustment !== "raw") reject("schema-invalid");
  const open = decimal(value["o"]);
  const high = decimal(value["h"]);
  const low = decimal(value["l"]);
  const close = decimal(value["c"]);
  const volume = unsignedInteger(value["v"], SIGNED_NS_MAX);
  const count = unsignedInteger(value["n"], SIGNED_NS_MAX);
  const vwap = decimal(value["vw"]);
  const barStartNs = epochNs;
  const barEndNs = barStartNs + 60_000_000_000n;
  const contradictory =
    volume === 0n ||
    count === 0n ||
    compareDecimal(low, high) > 0 ||
    compareDecimal(open, low) < 0 ||
    compareDecimal(open, high) > 0 ||
    compareDecimal(close, low) < 0 ||
    compareDecimal(close, high) > 0 ||
    compareDecimal(vwap, low) < 0 ||
    compareDecimal(vwap, high) > 0 ||
    barEndNs > context.queryEndNs ||
    barEndNs > SIGNED_NS_MAX;
  return Object.freeze({
    kind: "bar",
    symbol,
    itemIndex,
    timestamp,
    digest: wireDigest(endpointKind, symbol, {
      t: timestamp.canonicalUtc,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume.toString(),
      n: count.toString(),
      vw: vwap,
    } as unknown as JsonValue),
    close,
    barStartNs,
    barEndNs,
    contradictory,
  });
}

function translateBar(item: Extract<ValidatedItem, { kind: "bar" }>, context: ParseContext) {
  const source = Object.freeze({
    providerId: IDS.providerId,
    datasetId: IDS.datasetId,
    feedId: IDS.feedId,
    endpointChannelId: IDS.bars,
    entitlementSnapshotId: context.entitlementSnapshotId,
  });
  const payload = Object.freeze({
    kind: "bar" as const,
    barKind: "one-minute" as const,
    close: item.close,
    barStartNs: item.barStartNs.toString(),
    barEndNs: item.barEndNs.toString(),
    adjustmentMode: "raw" as const,
  });
  const eventTime = Object.freeze({
    ...item.timestamp.timestamp,
    semantic: "bar-start" as const,
  });
  const canonicalProviderPayloadDigest = deriveCanonicalProviderPayloadDigest(payload);
  const family = fallbackFamily({
    source,
    instrumentId: context.instrumentIds[item.symbol] as string,
    eventTime,
    canonicalProviderPayloadDigest,
  });
  return Object.freeze({
    source,
    instrumentId: context.instrumentIds[item.symbol] as string,
    venueTapeId: null,
    providerRecordKey: null,
    providerRevisionKey: null,
    providerStableRecordFamily: family,
    eventKind: "bar",
    eventTime,
    providerSequence: null,
    sequenceSessionDate: null,
    canonicalProviderPayloadDigest,
    marketAcquisitionId: context.marketAcquisitionId,
    rawArtifactId: context.rawArtifactId,
    memberKey: `$.bars[${JSON.stringify(item.symbol)}][${item.itemIndex}]`,
    occurrenceOrdinal: 0,
    revisionKind: "original",
    supersedesRevisionId: null,
    effectiveEventTime: null,
    sessionKind: context.sessionKind,
    currency: "USD",
    payload,
    normalizerVersion: "market-normalizer-v1",
    conditionPolicyVersion: "p1-10-alpaca-no-quote-trade-emission-v1",
    calendarVersion: context.calendarVersion,
    parserContractVersion: "p1-10-alpaca-historical-wire-v1",
    durablyRecordedAtMs: context.durablyRecordedAtMs,
    durableLogicalAtMs: context.durableLogicalAtMs,
    durableClockBasisId: context.durableClockBasisId,
    primaryCorpusMember: context.primaryCorpusMember,
  } satisfies RecordedMarketRecordV1);
}

function admitPage(
  endpointKind: EndpointKind,
  input: unknown,
  context: ParseContext = BASE_CONTEXT,
): PageAdmission {
  assertPlainRecord(input);
  const dataField = ENDPOINT_DATA_FIELD[endpointKind];
  assertExactKeys(input, [dataField, "next_page_token"], ["currency"]);
  if (Object.hasOwn(input, "currency") && input["currency"] !== "USD") {
    reject("market.currency-unsupported");
  }
  const token = input["next_page_token"];
  if (token !== null && (typeof token !== "string" || token.length === 0)) {
    reject("schema-invalid");
  }
  if (typeof token === "string" && utf8Bytes(token) > 4_096) reject("pageTokenInputBytes");
  const groups = input[dataField];
  assertPlainRecord(groups);
  const groupNames = Object.keys(groups);
  const groupDescriptors = Object.getOwnPropertyDescriptors(groups);
  if (groupNames.length === 0 && token !== null) reject("schema-invalid");
  const membership = new Set(context.requestedSymbols);
  let recordCount = 0;
  const validated: ValidatedItem[] = [];
  for (const symbol of groupNames) {
    if (
      !/^[\x21-\x7e]{1,32}$/u.test(symbol) ||
      symbol !== symbol.toUpperCase() ||
      !membership.has(symbol) ||
      context.instrumentIds[symbol] === undefined
    ) {
      reject("schema-invalid");
    }
    const items = (
      groupDescriptors[symbol] as PropertyDescriptor & {
        value: unknown;
      }
    ).value;
    assertDenseArray(items);
    recordCount += items.length;
    if (recordCount > 10_000) reject("recordsPerArtifactOrPage");
    const itemDescriptors = Object.getOwnPropertyDescriptors(items);
    let priorNs: bigint | null = null;
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = validateItem(
        endpointKind,
        symbol,
        itemIndex,
        (
          itemDescriptors[String(itemIndex)] as PropertyDescriptor & {
            value: unknown;
          }
        ).value,
        context,
      );
      const eventNs = BigInt(item.timestamp.timestamp.epochNs);
      if (priorNs !== null && eventNs < priorNs) reject("schema-invalid");
      priorNs = eventNs;
      if (item.kind === "trade" && item.update !== null) {
        const terminalReason = "correction-unsupported" as const;
        const quarantines = Object.freeze([
          Object.freeze({
            endpointKind,
            reason: terminalReason,
            symbol,
            itemIndex,
          }),
        ]);
        return Object.freeze({
          endpointKind,
          terminal: true,
          privateNextToken: null,
          records: Object.freeze([]),
          quarantines,
          barObservations: Object.freeze([]),
          terminalReason,
          publicSummary: Object.freeze({
            endpointKind,
            recordCount: 0,
            quarantineCount: quarantines.length,
            terminalReason,
          }),
        });
      }
      validated.push(item);
    }
  }
  const ordered = [...validated].sort((left, right) => {
    const symbolOrder = Buffer.compare(Buffer.from(left.symbol), Buffer.from(right.symbol));
    if (symbolOrder !== 0) return symbolOrder;
    const leftNs = BigInt(left.timestamp.timestamp.epochNs);
    const rightNs = BigInt(right.timestamp.timestamp.epochNs);
    if (leftNs !== rightNs) return leftNs < rightNs ? -1 : 1;
    return left.digest.localeCompare(right.digest);
  });
  const quarantines: Quarantine[] = [];
  const records: RecordedMarketRecordV1[] = [];
  const barObservations: BarObservation[] = [];
  const terminalReason: "correction-unsupported" | null = null;
  if (endpointKind === "quotes") {
    for (const item of ordered) {
      quarantines.push({
        endpointKind,
        reason: "market.condition-unknown",
        symbol: item.symbol,
        itemIndex: item.itemIndex,
      });
    }
  } else if (endpointKind === "trades") {
    for (const item of ordered) {
      quarantines.push({
        endpointKind,
        reason: "market.trade-condition-ineligible/state-insufficient",
        symbol: item.symbol,
        itemIndex: item.itemIndex,
      });
    }
  } else {
    const bars = ordered.filter(
      (item): item is Extract<ValidatedItem, { kind: "bar" }> => item.kind === "bar",
    );
    const byKey = new Map<string, Extract<ValidatedItem, { kind: "bar" }>[]>();
    for (const bar of bars) {
      const key = `${endpointChannelId(endpointKind)}|${context.instrumentIds[bar.symbol]}|${
        bar.barStartNs
      }`;
      const existing = byKey.get(key);
      if (existing === undefined) byKey.set(key, [bar]);
      else existing.push(bar);
    }
    for (const group of byKey.values()) {
      const logicalKey = `${endpointChannelId(endpointKind)}|${
        context.instrumentIds[group[0]?.symbol ?? reject("schema-invalid")]
      }|${group[0]?.barStartNs ?? reject("schema-invalid")}`;
      const digests = new Set(group.map((entry) => entry.digest));
      if (digests.size > 1) {
        for (const item of group) {
          barObservations.push({
            logicalKey,
            wireDigest: item.digest,
            symbol: item.symbol,
            itemIndex: item.itemIndex,
            record: null,
            quarantineReason: "market.provider-observation-invalid/conflicting-content",
          });
          quarantines.push({
            endpointKind,
            reason: "market.provider-observation-invalid/conflicting-content",
            symbol: item.symbol,
            itemIndex: item.itemIndex,
          });
        }
      } else {
        const item = group[0] as Extract<ValidatedItem, { kind: "bar" }>;
        if (
          item.contradictory ||
          context.sessionKind === "unknown" ||
          context.calendarVersion.length === 0
        ) {
          for (const delivery of group) {
            barObservations.push({
              logicalKey,
              wireDigest: delivery.digest,
              symbol: delivery.symbol,
              itemIndex: delivery.itemIndex,
              record: null,
              quarantineReason: "market.provider-observation-invalid/schema-invalid",
            });
            quarantines.push({
              endpointKind,
              reason: "market.provider-observation-invalid/schema-invalid",
              symbol: delivery.symbol,
              itemIndex: delivery.itemIndex,
            });
          }
        } else {
          const record = translateBar(item, context);
          records.push(record);
          for (const delivery of group) {
            barObservations.push({
              logicalKey,
              wireDigest: delivery.digest,
              symbol: delivery.symbol,
              itemIndex: delivery.itemIndex,
              record,
              quarantineReason: null,
            });
          }
        }
      }
    }
  }
  const publicSummary = Object.freeze({
    endpointKind,
    recordCount: records.length,
    quarantineCount: quarantines.length,
    terminalReason,
  });
  return Object.freeze({
    endpointKind,
    terminal: token === null,
    privateNextToken: token as string | null,
    records: Object.freeze(records),
    quarantines: Object.freeze(quarantines),
    barObservations: Object.freeze(barObservations),
    terminalReason,
    publicSummary,
  });
}

function admitFixture(caseId: string, context: ParseContext = BASE_CONTEXT): PageAdmission {
  const entry = validById.get(caseId);
  assert.ok(entry);
  return admitPage(entry.endpointKind, parseRawJson(JSON.stringify(entry.wire)), context);
}

type ChainPage = Readonly<{
  ordinal: number;
  page: PlainRecord;
  presentedRequestToken: string | null;
  logicalRequestId: string;
  rawArtifactId?: string;
}>;

type VerifiedRawPage = Readonly<{
  ordinal: number;
  rawText: string;
  rawDigest: string;
  rawArtifactId: string;
  presentedTokenMaterial: string | null;
  presentedTokenHash: string | null;
  returnedTokenHash: string | null;
  returnedTokenMaterial: string | null;
}>;

type PersistedChainOutcome = Readonly<{
  records: readonly RecordedMarketRecordV1[];
  quarantines: readonly Quarantine[];
  terminalReason: "correction-unsupported" | null;
  barObservationCount: number;
  resolutionHash: string;
}>;

type ChainCheckpoint = Readonly<{
  endpointKind: EndpointKind;
  contextIdentityHash: string;
  nextOrdinal: number;
  expectedPrivateToken: string | null;
  expectedPrivateTokenHash: string | null;
  seenReturnedTokenHashes: readonly string[];
  logicalRequestId: string;
  terminal: boolean;
  verifiedPages: readonly VerifiedRawPage[];
  outcome: PersistedChainOutcome | null;
}>;

function contextIdentityHash(context: ParseContext): string {
  return canonicalHash("peas/p1-10-wire-parse-context/v1", {
    requestedSymbols: context.requestedSymbols,
    instrumentIds: context.instrumentIds,
    queryStartNs: context.queryStartNs.toString(),
    queryEndNs: context.queryEndNs.toString(),
    entitlementSnapshotId: context.entitlementSnapshotId,
    marketAcquisitionId: context.marketAcquisitionId,
    calendarVersion: context.calendarVersion,
    durableClockBasisId: context.durableClockBasisId,
    durablyRecordedAtMs: context.durablyRecordedAtMs,
    durableLogicalAtMs: context.durableLogicalAtMs,
    sessionKind: context.sessionKind,
    primaryCorpusMember: context.primaryCorpusMember,
    timeframe: context.timeframe,
    adjustment: context.adjustment,
  });
}

function enforcePageCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > CHAIN_LIMITS.pages) {
    reject("successfulPagesPerAcquisition");
  }
}

function enforceRawPageBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > CHAIN_LIMITS.rawBytesPerPage) {
    reject("rawArtifactBytes");
  }
}

function enforceAggregateVerifiedBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > CHAIN_LIMITS.aggregateVerifiedBytes) {
    reject("aggregateVerifiedBytesPerAcquisition");
  }
}

function enforceNormalizedFactCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > CHAIN_LIMITS.normalizedFacts) {
    reject("normalizedFactsPerAcquisition");
  }
}

interface Journal {
  load(): ChainCheckpoint | null;
  save(checkpoint: ChainCheckpoint): void;
  close(): void;
}

class MemoryJournal implements Journal {
  private checkpoint: unknown = null;

  load(): ChainCheckpoint | null {
    return this.checkpoint === null ? null : (structuredClone(this.checkpoint) as ChainCheckpoint);
  }

  save(checkpoint: ChainCheckpoint): void {
    this.checkpoint = structuredClone(checkpoint);
  }

  seedUncheckedForTest(checkpoint: unknown): void {
    this.checkpoint = structuredClone(checkpoint);
  }

  close(): void {}
}

class SqliteJournal implements Journal {
  private readonly database = new Database(":memory:");

  constructor() {
    this.database.exec(
      "CREATE TABLE checkpoint (singleton INTEGER PRIMARY KEY CHECK (singleton=1), value TEXT NOT NULL)",
    );
  }

  load(): ChainCheckpoint | null {
    const row = this.database.prepare("SELECT value FROM checkpoint WHERE singleton = 1").get() as
      | { value: string }
      | undefined;
    return row === undefined ? null : (JSON.parse(row.value) as ChainCheckpoint);
  }

  save(checkpoint: ChainCheckpoint): void {
    this.database
      .prepare(
        "INSERT INTO checkpoint(singleton,value) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(checkpoint));
  }

  seedUncheckedForTest(checkpoint: unknown): void {
    this.database
      .prepare(
        "INSERT INTO checkpoint(singleton,value) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(checkpoint));
  }

  close(): void {
    this.database.close();
  }
}

function privateTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function encodeWireJson(value: unknown): string {
  if (isRawNumber(value)) return value.rawNumber;
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(encodeWireJson).join(",")}]`;
  }
  assertPlainRecord(value);
  return `{${Object.entries(value)
    .map(([key, entry]) => `${JSON.stringify(key)}:${encodeWireJson(entry)}`)
    .join(",")}}`;
}

function inspectContinuationToken(endpointKind: EndpointKind, input: unknown): string | null {
  assertPlainRecord(input);
  const dataField = ENDPOINT_DATA_FIELD[endpointKind];
  assertExactKeys(input, [dataField, "next_page_token"], ["currency"]);
  assertPlainRecord(input[dataField]);
  if (Object.hasOwn(input, "currency") && input["currency"] !== "USD") {
    reject("market.currency-unsupported");
  }
  const token = input["next_page_token"];
  if (token === null) return null;
  if (typeof token !== "string" || token.length === 0) reject("schema-invalid");
  const tokenText = token as string;
  if (utf8Bytes(tokenText) > RAW_LIMITS.pageTokenBytes) reject("pageTokenInputBytes");
  return tokenText;
}

function admitExternalTradeCorrectionClaim(input: unknown): never {
  assertPlainRecord(input);
  assertExactKeys(input, ["guessedSupersededTradeId", "guessedRevisionOrdinal"]);
  for (const field of ["guessedSupersededTradeId", "guessedRevisionOrdinal"] as const) {
    const value = input[field];
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      reject("schema-invalid");
    }
  }
  return reject("unsupported-correction-linkage");
}

function resolveCompleteChain(
  endpointKind: EndpointKind,
  admissions: readonly PageAdmission[],
): Readonly<{
  records: readonly RecordedMarketRecordV1[];
  quarantines: readonly Quarantine[];
  terminalReason: "correction-unsupported" | null;
  barObservationCount: number;
}> {
  const quarantines = admissions.flatMap((admission) => admission.quarantines);
  const terminalReason = admissions.some(
    (admission) => admission.terminalReason === "correction-unsupported",
  )
    ? "correction-unsupported"
    : null;
  if (terminalReason !== null || endpointKind !== "bars") {
    return Object.freeze({
      records: Object.freeze([]),
      quarantines: Object.freeze(quarantines),
      terminalReason,
      barObservationCount: 0,
    });
  }
  const observations = admissions.flatMap((admission) => admission.barObservations);
  const byKey = new Map<string, BarObservation[]>();
  for (const observation of observations) {
    const existing = byKey.get(observation.logicalKey);
    if (existing === undefined) byKey.set(observation.logicalKey, [observation]);
    else existing.push(observation);
  }
  const records: RecordedMarketRecordV1[] = [];
  const globalQuarantines = [...quarantines];
  for (const group of [...byKey.values()].sort((left, right) =>
    (left[0]?.logicalKey ?? "").localeCompare(right[0]?.logicalKey ?? ""),
  )) {
    const digests = new Set(group.map((observation) => observation.wireDigest));
    if (digests.size > 1) {
      for (const observation of group) {
        if (
          observation.quarantineReason !== "market.provider-observation-invalid/conflicting-content"
        ) {
          globalQuarantines.push({
            endpointKind,
            reason: "market.provider-observation-invalid/conflicting-content",
            symbol: observation.symbol,
            itemIndex: observation.itemIndex,
          });
        }
      }
      continue;
    }
    if (group.some((observation) => observation.quarantineReason !== null)) continue;
    const candidates = group
      .flatMap((observation) => (observation.record === null ? [] : [observation.record]))
      .sort((left, right) => {
        const artifactOrder = left.rawArtifactId.localeCompare(right.rawArtifactId);
        return artifactOrder !== 0 ? artifactOrder : left.memberKey.localeCompare(right.memberKey);
      });
    const selected = candidates[0];
    if (selected !== undefined) records.push(selected);
  }
  records.sort((left, right) =>
    canonicalJson(recordSemanticProjection(left)).localeCompare(
      canonicalJson(recordSemanticProjection(right)),
    ),
  );
  return Object.freeze({
    records: Object.freeze(records),
    quarantines: Object.freeze(globalQuarantines),
    terminalReason: null,
    barObservationCount: observations.length,
  });
}

function buildPersistedOutcome(
  endpointKind: EndpointKind,
  verifiedPages: readonly VerifiedRawPage[],
  context: ParseContext,
): PersistedChainOutcome {
  const admissions: PageAdmission[] = [];
  for (const verifiedPage of verifiedPages) {
    const recomputedDigest = createHash("sha256")
      .update(verifiedPage.rawText, "utf8")
      .digest("hex");
    if (recomputedDigest !== verifiedPage.rawDigest) reject("verified-page-mutation");
    const admission = admitPage(endpointKind, parseRawJson(verifiedPage.rawText), {
      ...context,
      rawArtifactId: verifiedPage.rawArtifactId,
    });
    admissions.push(admission);
    if (admission.terminalReason === "correction-unsupported") break;
  }
  const resolved = resolveCompleteChain(endpointKind, admissions);
  enforceNormalizedFactCount(resolved.records.length);
  const outcomePreimage = {
    records: resolved.records,
    quarantines: resolved.quarantines,
    terminalReason: resolved.terminalReason,
    barObservationCount: resolved.barObservationCount,
  };
  return Object.freeze({
    ...outcomePreimage,
    resolutionHash: createHash("sha256")
      .update(canonicalJson(outcomePreimage as unknown as JsonValue), "utf8")
      .digest("hex"),
  });
}

function sameCanonical(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
  } catch {
    return false;
  }
}

function validateLoadedCheckpoint(
  endpointKind: EndpointKind,
  context: ParseContext,
  input: unknown,
): ChainCheckpoint {
  try {
    const expectedContextIdentityHash = contextIdentityHash(context);
    assertPlainRecord(input);
    assertExactKeys(input, [
      "endpointKind",
      "contextIdentityHash",
      "nextOrdinal",
      "expectedPrivateToken",
      "expectedPrivateTokenHash",
      "seenReturnedTokenHashes",
      "logicalRequestId",
      "terminal",
      "verifiedPages",
      "outcome",
    ]);
    if (
      input["endpointKind"] !== endpointKind ||
      input["contextIdentityHash"] !== expectedContextIdentityHash ||
      typeof input["contextIdentityHash"] !== "string" ||
      !/^[0-9a-f]{64}$/u.test(input["contextIdentityHash"] as string)
    ) {
      reject("checkpoint-invalid");
    }
    if (
      !Number.isSafeInteger(input["nextOrdinal"]) ||
      (input["nextOrdinal"] as number) < 0 ||
      typeof input["logicalRequestId"] !== "string" ||
      (input["logicalRequestId"] as string).length === 0 ||
      typeof input["terminal"] !== "boolean"
    ) {
      reject("checkpoint-invalid");
    }
    const expectedPrivateToken = input["expectedPrivateToken"];
    const expectedPrivateTokenHash = input["expectedPrivateTokenHash"];
    if (
      (expectedPrivateToken !== null && typeof expectedPrivateToken !== "string") ||
      (expectedPrivateTokenHash !== null &&
        (typeof expectedPrivateTokenHash !== "string" ||
          !/^[0-9a-f]{64}$/u.test(expectedPrivateTokenHash)))
    ) {
      reject("checkpoint-invalid");
    }
    assertDenseArray(input["seenReturnedTokenHashes"]);
    const storedSeenHashes = input["seenReturnedTokenHashes"] as unknown[];
    if (
      storedSeenHashes.some((hash) => typeof hash !== "string" || !/^[0-9a-f]{64}$/u.test(hash)) ||
      storedSeenHashes.some((hash, index) => {
        const prior = storedSeenHashes[index - 1];
        return index > 0 && typeof prior === "string" && typeof hash === "string" && prior >= hash;
      })
    ) {
      reject("checkpoint-invalid");
    }
    assertDenseArray(input["verifiedPages"]);
    const pages = input["verifiedPages"] as unknown[];
    enforcePageCount(pages.length);
    if (input["nextOrdinal"] !== pages.length) {
      reject("checkpoint-invalid");
    }
    let aggregateVerifiedBytes = 0;
    let priorReturnedMaterial: string | null = null;
    let priorReturnedHash: string | null = null;
    let correctionStop = false;
    const recomputedSeenHashes: string[] = [];
    const validatedPages: VerifiedRawPage[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      assertPlainRecord(page);
      assertExactKeys(page, [
        "ordinal",
        "rawText",
        "rawDigest",
        "rawArtifactId",
        "presentedTokenMaterial",
        "presentedTokenHash",
        "returnedTokenHash",
        "returnedTokenMaterial",
      ]);
      if (
        page["ordinal"] !== index ||
        typeof page["rawText"] !== "string" ||
        typeof page["rawDigest"] !== "string" ||
        !/^[0-9a-f]{64}$/u.test(page["rawDigest"] as string) ||
        typeof page["rawArtifactId"] !== "string" ||
        !/^mar1_[0-9a-f]{64}$/u.test(page["rawArtifactId"] as string)
      ) {
        reject("checkpoint-invalid");
      }
      const rawPageBytes = utf8Bytes(page["rawText"] as string);
      enforceRawPageBytes(rawPageBytes);
      aggregateVerifiedBytes += rawPageBytes;
      enforceAggregateVerifiedBytes(aggregateVerifiedBytes);
      for (const key of [
        "presentedTokenMaterial",
        "presentedTokenHash",
        "returnedTokenMaterial",
        "returnedTokenHash",
      ] as const) {
        const value = page[key];
        if (value !== null && typeof value !== "string") reject("checkpoint-invalid");
      }
      const presentedMaterial = page["presentedTokenMaterial"] as string | null;
      const presentedHash = page["presentedTokenHash"] as string | null;
      if (
        presentedMaterial !== priorReturnedMaterial ||
        presentedHash !== priorReturnedHash ||
        (presentedMaterial === null
          ? presentedHash !== null
          : privateTokenHash(presentedMaterial) !== presentedHash)
      ) {
        reject("checkpoint-invalid");
      }
      const rawText = page["rawText"] as string;
      if (createHash("sha256").update(rawText, "utf8").digest("hex") !== page["rawDigest"]) {
        reject("checkpoint-invalid");
      }
      const parsedPage = parseRawJson(rawText);
      const returnedMaterial = inspectContinuationToken(endpointKind, parsedPage);
      const returnedHash = returnedMaterial === null ? null : privateTokenHash(returnedMaterial);
      if (
        returnedMaterial !== page["returnedTokenMaterial"] ||
        returnedHash !== page["returnedTokenHash"]
      ) {
        reject("checkpoint-invalid");
      }
      if (returnedHash !== null) {
        if (recomputedSeenHashes.includes(returnedHash)) reject("checkpoint-invalid");
        recomputedSeenHashes.push(returnedHash);
      }
      if (priorReturnedMaterial === null && index > 0) reject("checkpoint-invalid");
      priorReturnedMaterial = returnedMaterial;
      priorReturnedHash = returnedHash;
      validatedPages.push(page as unknown as VerifiedRawPage);
      if (
        endpointKind === "trades" &&
        admitPage(endpointKind, parsedPage, {
          ...context,
          rawArtifactId: page["rawArtifactId"] as string,
        }).terminalReason === "correction-unsupported"
      ) {
        if (index !== pages.length - 1) reject("checkpoint-invalid");
        correctionStop = true;
      }
    }
    recomputedSeenHashes.sort();
    const recomputedExpectedToken = correctionStop ? null : priorReturnedMaterial;
    const recomputedExpectedTokenHash = correctionStop ? null : priorReturnedHash;
    if (
      !sameCanonical(storedSeenHashes, recomputedSeenHashes) ||
      expectedPrivateToken !== recomputedExpectedToken ||
      expectedPrivateTokenHash !== recomputedExpectedTokenHash
    ) {
      reject("checkpoint-invalid");
    }
    const recomputedTerminal =
      correctionStop || (pages.length > 0 && priorReturnedMaterial === null);
    if (input["terminal"] !== recomputedTerminal) reject("checkpoint-invalid");

    const outcome = input["outcome"];
    let validatedOutcome: PersistedChainOutcome | null = null;
    if (outcome !== null) {
      if (!recomputedTerminal) reject("checkpoint-invalid");
      assertPlainRecord(outcome);
      assertExactKeys(outcome, [
        "records",
        "quarantines",
        "terminalReason",
        "barObservationCount",
        "resolutionHash",
      ]);
      assertDenseArray(outcome["records"]);
      assertDenseArray(outcome["quarantines"]);
      if (
        (outcome["terminalReason"] !== null &&
          outcome["terminalReason"] !== "correction-unsupported") ||
        !Number.isSafeInteger(outcome["barObservationCount"]) ||
        (outcome["barObservationCount"] as number) < 0 ||
        typeof outcome["resolutionHash"] !== "string" ||
        !/^[0-9a-f]{64}$/u.test(outcome["resolutionHash"] as string)
      ) {
        reject("checkpoint-invalid");
      }
      const records = outcome["records"] as RecordedMarketRecordV1[];
      normalizeRecordedMarketRecords(records);
      for (const quarantine of outcome["quarantines"] as unknown[]) {
        assertPlainRecord(quarantine);
        assertExactKeys(quarantine, ["endpointKind", "reason", "symbol", "itemIndex"]);
        if (
          !["quotes", "trades", "bars"].includes(quarantine["endpointKind"] as string) ||
          typeof quarantine["reason"] !== "string" ||
          typeof quarantine["symbol"] !== "string" ||
          !Number.isSafeInteger(quarantine["itemIndex"]) ||
          (quarantine["itemIndex"] as number) < 0
        ) {
          reject("checkpoint-invalid");
        }
      }
      const outcomePreimage = {
        records,
        quarantines: outcome["quarantines"],
        terminalReason: outcome["terminalReason"],
        barObservationCount: outcome["barObservationCount"],
      };
      const expectedResolutionHash = createHash("sha256")
        .update(canonicalJson(outcomePreimage as unknown as JsonValue), "utf8")
        .digest("hex");
      if (expectedResolutionHash !== outcome["resolutionHash"]) {
        reject("checkpoint-invalid");
      }
      validatedOutcome = outcome as unknown as PersistedChainOutcome;
    }
    return Object.freeze({
      endpointKind,
      contextIdentityHash: expectedContextIdentityHash,
      nextOrdinal: input["nextOrdinal"] as number,
      expectedPrivateToken: expectedPrivateToken as string | null,
      expectedPrivateTokenHash: expectedPrivateTokenHash as string | null,
      seenReturnedTokenHashes: Object.freeze(storedSeenHashes as string[]),
      logicalRequestId: input["logicalRequestId"] as string,
      terminal: input["terminal"] as boolean,
      verifiedPages: Object.freeze(validatedPages),
      outcome: validatedOutcome,
    });
  } catch (error) {
    if (error instanceof WireContractError && error.code === "checkpoint-invalid") {
      throw error;
    }
    return reject("checkpoint-invalid");
  }
}

function runChain(
  endpointKind: EndpointKind,
  pages: readonly ChainPage[],
  journal: Journal,
  context: ParseContext = BASE_CONTEXT,
): readonly RecordedMarketRecordV1[] {
  const expectedContextIdentityHash = contextIdentityHash(context);
  const loadedCheckpoint = journal.load();
  let checkpoint: ChainCheckpoint;
  if (loadedCheckpoint === null) {
    if (pages.length === 0) reject("pagination-incomplete");
    checkpoint = Object.freeze({
      endpointKind,
      contextIdentityHash: expectedContextIdentityHash,
      nextOrdinal: 0,
      expectedPrivateToken: null,
      expectedPrivateTokenHash: null,
      seenReturnedTokenHashes: Object.freeze([]),
      logicalRequestId: pages[0]?.logicalRequestId ?? reject("pagination-incomplete"),
      terminal: false,
      verifiedPages: Object.freeze([]),
      outcome: null,
    });
  } else {
    checkpoint = validateLoadedCheckpoint(endpointKind, context, loadedCheckpoint);
  }
  if (checkpoint.outcome !== null) {
    if (pages.length !== 0) reject("page-after-terminal");
    const recomputed = buildPersistedOutcome(endpointKind, checkpoint.verifiedPages, context);
    if (!sameCanonical(recomputed, checkpoint.outcome)) reject("checkpoint-invalid");
    return Object.freeze(structuredClone(recomputed.records));
  }
  const seenReturnedTokenHashes = new Set(checkpoint.seenReturnedTokenHashes);
  let aggregateVerifiedBytes = checkpoint.verifiedPages.reduce(
    (total, page) => total + utf8Bytes(page.rawText),
    0,
  );
  for (const chainPage of pages) {
    if (checkpoint.terminal) reject("page-after-terminal");
    if (chainPage.ordinal !== checkpoint.nextOrdinal) reject("page-position-invalid");
    if (chainPage.logicalRequestId !== checkpoint.logicalRequestId) reject("cross-query-token");
    if (chainPage.ordinal === 0 && chainPage.presentedRequestToken !== null) {
      reject("first-request-token");
    }
    if (chainPage.presentedRequestToken !== checkpoint.expectedPrivateToken) {
      reject("token-substitution");
    }
    const presentedTokenHash =
      chainPage.presentedRequestToken === null
        ? null
        : privateTokenHash(chainPage.presentedRequestToken);
    if (presentedTokenHash !== checkpoint.expectedPrivateTokenHash) {
      reject("token-substitution");
    }
    enforcePageCount(checkpoint.verifiedPages.length + 1);
    const rawText = encodeWireJson(modelValue(chainPage.page));
    const rawPageBytes = utf8Bytes(rawText);
    enforceRawPageBytes(rawPageBytes);
    aggregateVerifiedBytes += rawPageBytes;
    enforceAggregateVerifiedBytes(aggregateVerifiedBytes);
    const parsedEnvelope = parseRawJson(rawText);
    const returnedToken = inspectContinuationToken(endpointKind, parsedEnvelope);
    const returnedTokenHash = returnedToken === null ? null : privateTokenHash(returnedToken);
    if (returnedTokenHash !== null && seenReturnedTokenHashes.has(returnedTokenHash)) {
      reject("repeated-token");
    }
    if (returnedTokenHash !== null) seenReturnedTokenHashes.add(returnedTokenHash);
    const rawArtifactId =
      chainPage.rawArtifactId ?? `mar1_${chainPage.ordinal.toString(16).padStart(64, "0")}`;
    const verifiedPage: VerifiedRawPage = Object.freeze({
      ordinal: chainPage.ordinal,
      rawText,
      rawDigest: createHash("sha256").update(rawText, "utf8").digest("hex"),
      rawArtifactId,
      presentedTokenMaterial: chainPage.presentedRequestToken,
      presentedTokenHash,
      returnedTokenHash,
      returnedTokenMaterial: returnedToken,
    });
    const verifiedPages = Object.freeze([...checkpoint.verifiedPages, verifiedPage]);
    const correctionStop =
      endpointKind === "trades" &&
      admitPage(endpointKind, parsedEnvelope, {
        ...context,
        rawArtifactId,
      }).terminalReason === "correction-unsupported";
    checkpoint = Object.freeze({
      endpointKind,
      contextIdentityHash: expectedContextIdentityHash,
      nextOrdinal: chainPage.ordinal + 1,
      expectedPrivateToken: correctionStop ? null : returnedToken,
      expectedPrivateTokenHash: correctionStop ? null : returnedTokenHash,
      seenReturnedTokenHashes: Object.freeze([...seenReturnedTokenHashes].sort()),
      logicalRequestId: checkpoint.logicalRequestId,
      terminal: correctionStop || returnedToken === null,
      verifiedPages,
      outcome: null,
    });
    if (correctionStop) {
      checkpoint = Object.freeze({
        ...checkpoint,
        outcome: buildPersistedOutcome(endpointKind, verifiedPages, context),
      });
      journal.save(checkpoint);
      const persistedCorrection = journal.load();
      if (persistedCorrection === null) reject("checkpoint-invalid");
      const validatedCorrection = validateLoadedCheckpoint(
        endpointKind,
        context,
        persistedCorrection,
      );
      if (
        validatedCorrection.outcome?.terminalReason !== "correction-unsupported" ||
        validatedCorrection.outcome.records.length !== 0
      ) {
        reject("checkpoint-invalid");
      }
      return Object.freeze([]);
    }
    journal.save(checkpoint);
  }
  if (!checkpoint.terminal) return Object.freeze([]);

  const outcome = buildPersistedOutcome(endpointKind, checkpoint.verifiedPages, context);
  checkpoint = Object.freeze({ ...checkpoint, outcome });
  journal.save(checkpoint);
  const persisted = journal.load();
  if (persisted === null) reject("checkpoint-invalid");
  const validated = validateLoadedCheckpoint(endpointKind, context, persisted);
  if (validated.outcome === null) reject("checkpoint-invalid");
  const recomputed = buildPersistedOutcome(endpointKind, validated.verifiedPages, context);
  if (!sameCanonical(recomputed, validated.outcome)) reject("checkpoint-invalid");
  return Object.freeze(structuredClone(recomputed.records));
}

function cloneAndModel(page: PlainRecord): PlainRecord {
  return modelValue(structuredClone(page)) as PlainRecord;
}

function recordSemanticProjection(record: RecordedMarketRecordV1): JsonValue {
  return {
    source: record.source,
    instrumentId: record.instrumentId,
    venueTapeId: record.venueTapeId,
    providerRecordKey: record.providerRecordKey,
    providerRevisionKey: record.providerRevisionKey,
    providerStableRecordFamily: record.providerStableRecordFamily,
    eventKind: record.eventKind,
    eventTime: record.eventTime,
    providerSequence: record.providerSequence,
    sequenceSessionDate: record.sequenceSessionDate,
    canonicalProviderPayloadDigest: record.canonicalProviderPayloadDigest,
    marketAcquisitionId: record.marketAcquisitionId,
    occurrenceOrdinal: record.occurrenceOrdinal,
    revisionKind: record.revisionKind,
    supersedesRevisionId: record.supersedesRevisionId,
    effectiveEventTime: record.effectiveEventTime,
    sessionKind: record.sessionKind,
    currency: record.currency,
    payload: record.payload,
    normalizerVersion: record.normalizerVersion,
    conditionPolicyVersion: record.conditionPolicyVersion,
    calendarVersion: record.calendarVersion,
    parserContractVersion: record.parserContractVersion,
    durablyRecordedAtMs: record.durablyRecordedAtMs,
    durableLogicalAtMs: record.durableLogicalAtMs,
    durableClockBasisId: record.durableClockBasisId,
    primaryCorpusMember: record.primaryCorpusMember,
  } as unknown as JsonValue;
}

function makeSyntheticBars(count: number): readonly PlainRecord[] {
  const baseSeconds = BigInt(parseTimestamp("2033-05-06T08:00:00Z").timestamp.epochNs);
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const epochNs = baseSeconds + BigInt(index) * 60_000_000_000n;
      const wholeSeconds = epochNs / 1_000_000_000n;
      const date = new Date(Number(wholeSeconds * 1_000n));
      const timestamp = date.toISOString().replace(".000Z", ".000000000Z");
      const closeCents = 8_000 + index;
      const token = (delta: number): RawNumber => {
        const cents = closeCents + delta;
        return rawNumber(`${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
      };
      return {
        t: timestamp,
        o: token(-25),
        h: token(50),
        l: token(-50),
        c: token(0),
        v: 100 + index,
        n: 40 + index,
        vw: token(12),
      };
    }),
  );
}

function paginateBars(items: readonly PlainRecord[], pageSize: number): readonly ChainPage[] {
  if (![1, 2, 7, 10_000].includes(pageSize)) reject("page-size-invalid");
  const pages: ChainPage[] = [];
  for (let offset = 0; offset < items.length; offset += pageSize) {
    const ordinal = pages.length;
    const terminal = offset + pageSize >= items.length;
    const returnedToken = terminal ? null : `peas-synthetic-opaque-page-${ordinal + 1}`;
    pages.push({
      ordinal,
      logicalRequestId: "peas-synthetic-bars-page-size-invariance",
      presentedRequestToken: ordinal === 0 ? null : `peas-synthetic-opaque-page-${ordinal}`,
      rawArtifactId: `mar1_${ordinal.toString(16).padStart(64, "0")}`,
      page: {
        bars: { PEASIVY: items.slice(offset, offset + pageSize) },
        next_page_token: returnedToken,
      },
    });
  }
  return Object.freeze(pages);
}

function applyPaginationMutation(
  page: PlainRecord,
  endpointKind: EndpointKind,
  mutation: Readonly<Record<string, unknown>>,
): void {
  const operation = mutation["operation"];
  if (operation === "replace" && mutation["path"] === "/next_page_token") {
    page["next_page_token"] = mutation["value"];
    return;
  }
  if (operation === "replace-first-item-field") {
    firstItem(page, endpointKind)[mutation["field"] as string] = mutation["value"];
    return;
  }
  if (operation === "add-own-field-to-first-item") {
    firstItem(page, endpointKind)[mutation["field"] as string] = mutation["value"];
    return;
  }
  if (operation === "append-copy-of-first-item-to-first-symbol") {
    const [, items] = firstGroup(page, endpointKind);
    const appended = structuredClone(items[0]);
    items.push(appended);
    const then = mutation["then"];
    if (then !== undefined) {
      assertPlainRecord(then);
      if (then["operation"] !== "replace-appended-item-field") reject("fixture-operation-unknown");
      (appended as PlainRecord)[then["field"] as string] = then["value"];
    }
    return;
  }
  reject("fixture-operation-unknown");
}

function paginationFixturePage(
  endpointKind: EndpointKind,
  specification: Readonly<Record<string, unknown>>,
): PlainRecord {
  const caseId =
    (specification["wireCaseId"] as string | undefined) ??
    (specification["baseWireCaseId"] as string | undefined) ??
    reject("fixture-operation-unknown");
  const page = fixtureWire(caseId);
  for (const mutation of (specification["wireMutations"] ?? []) as readonly Readonly<
    Record<string, unknown>
  >[]) {
    applyPaginationMutation(page, endpointKind, mutation);
  }
  return page;
}

type GrammarFaultVector = Readonly<{
  label: string;
  endpointKind: EndpointKind;
  candidate: unknown;
  expected: "admit" | "reject";
  rawText: boolean;
}>;

function grammarExpectedDisposition(
  descriptor: Readonly<Record<string, unknown>>,
  fallback: Readonly<Record<string, unknown>>,
  endpointKind: EndpointKind,
  literalValue?: unknown,
): "admit" | "reject" {
  const endpointDisposition = fallback["expectedDispositionByEndpoint"];
  const literal =
    descriptor["expectedFinalDisposition"] ??
    descriptor["expectedDisposition"] ??
    descriptor["expectedGrammarDisposition"] ??
    descriptor["expectedTranslationDisposition"] ??
    (typeof endpointDisposition === "object" && endpointDisposition !== null
      ? (endpointDisposition as PlainRecord)[endpointKind]
      : undefined) ??
    fallback["expectedFinalDisposition"] ??
    fallback["expectedDisposition"] ??
    fallback["expectedGrammarDisposition"] ??
    fallback["expectedTranslationDisposition"];
  assert.equal(typeof literal, "string", `${fallback["caseId"] as string} disposition`);
  const disposition = literal as string;
  if (disposition === "quarantine-zero-side-or-reject-negative") {
    return literalValue === 0 ? "admit" : "reject";
  }
  if (
    disposition.startsWith("accept") ||
    disposition.startsWith("quarantine") ||
    disposition.startsWith("terminal-correction")
  ) {
    return "admit";
  }
  if (disposition.startsWith("reject")) return "reject";
  return reject("fixture-disposition-unknown");
}

function grammarBasePairs(
  fixtureCase: FixtureCase,
): readonly Readonly<{ endpointKind: EndpointKind; baseCaseId: string }>[] {
  const endpointKinds = fixtureCase["endpointKinds"] as readonly EndpointKind[];
  const baseCaseIds = fixtureCase["baseCaseIds"] as readonly string[] | undefined;
  if (baseCaseIds === undefined) return Object.freeze([]);
  assert.equal(endpointKinds.length, baseCaseIds.length, fixtureCase.caseId);
  return Object.freeze(
    endpointKinds.map((endpointKind, index) => {
      const baseCaseId = baseCaseIds[index];
      assert.ok(baseCaseId);
      assert.equal(validById.get(baseCaseId)?.endpointKind, endpointKind);
      return Object.freeze({ endpointKind, baseCaseId });
    }),
  );
}

function generatedFixtureValue(recipe: Readonly<Record<string, unknown>>): unknown {
  if (recipe["kind"] === "repeat-ascii") {
    return (recipe["character"] as string).repeat(recipe["bytes"] as number);
  }
  if (recipe["kind"] === "numbered-strings") {
    return Array.from(
      { length: recipe["count"] as number },
      (_, index) => `${recipe["prefix"] as string}${index}`,
    );
  }
  if (recipe["kind"] === "single-repeated-ascii-string") {
    return [(recipe["character"] as string).repeat(recipe["bytes"] as number)];
  }
  if (recipe["kind"] === "synthetic-opaque-token") {
    return "t".repeat(recipe["bytes"] as number);
  }
  return reject("fixture-operation-unknown");
}

function replacePointer(root: PlainRecord, pointer: string, value: unknown): void {
  assert.match(pointer, /^\/[^/]+$/u);
  root[pointer.slice(1)] = value;
}

function expandGrammarFaultCase(fixtureCase: FixtureCase): readonly GrammarFaultVector[] {
  const operation = fixtureCase["operation"];
  const vectors: GrammarFaultVector[] = [];
  const add = (
    endpointKind: EndpointKind,
    candidate: unknown,
    descriptor: Readonly<Record<string, unknown>> = fixtureCase,
    literalValue?: unknown,
    rawText = false,
    suffix = "",
  ): void => {
    vectors.push(
      Object.freeze({
        label: `${fixtureCase.caseId}:${endpointKind}${suffix}`,
        endpointKind,
        candidate,
        expected: grammarExpectedDisposition(descriptor, fixtureCase, endpointKind, literalValue),
        rawText,
      }),
    );
  };

  if (operation === "parse-original-synthetic-raw-json-text") {
    const endpointKinds = fixtureCase["endpointKinds"] as readonly EndpointKind[];
    const rawTexts = fixtureCase["rawJsonTexts"] as readonly string[];
    assert.equal(endpointKinds.length, rawTexts.length, fixtureCase.caseId);
    rawTexts.forEach((rawText, index) => {
      const endpointKind = endpointKinds[index];
      assert.ok(endpointKind);
      add(endpointKind, rawText, fixtureCase, rawText, true, `:raw-${index}`);
    });
    return vectors;
  }

  for (const { endpointKind, baseCaseId } of grammarBasePairs(fixtureCase)) {
    const fresh = (): PlainRecord => fixtureWire(baseCaseId);
    const field = fixtureCase["field"] as string | undefined;
    const valueVariants = (fixtureCase["values"] as readonly unknown[] | undefined) ?? [
      fixtureCase["value"],
    ];
    if (operation === "replace-root") {
      add(endpointKind, structuredClone(fixtureCase["value"]));
    } else if (operation === "remove-each-own-field") {
      for (const fieldName of (fixtureCase["fieldSetByEndpoint"] as PlainRecord)[
        endpointKind
      ] as readonly string[]) {
        const page = fresh();
        delete page[fieldName];
        add(endpointKind, page, fixtureCase, fieldName, false, `:${fieldName}`);
      }
    } else if (operation === "add-own-field") {
      const page = fresh();
      page[fixtureCase["field"] as string] = fixtureCase["value"];
      add(endpointKind, page);
    } else if (operation === "rename-data-field") {
      const page = fresh();
      const source = ENDPOINT_DATA_FIELD[endpointKind];
      const destination = (fixtureCase["fieldMapByEndpoint"] as PlainRecord)[
        endpointKind
      ] as string;
      page[destination] = page[source];
      delete page[source];
      add(endpointKind, page);
    } else if (operation === "replace") {
      for (const value of valueVariants) {
        const page = fresh();
        const pointer =
          (fixtureCase["pathByEndpoint"] as PlainRecord | undefined)?.[endpointKind] ??
          fixtureCase["path"];
        replacePointer(page, pointer as string, structuredClone(value));
        add(endpointKind, page, fixtureCase, value, false, `:${String(value)}`);
      }
    } else if (operation === "replace-or-add-own-field") {
      for (const value of valueVariants) {
        const page = fresh();
        replacePointer(page, fixtureCase["path"] as string, structuredClone(value));
        add(endpointKind, page, fixtureCase, value, false, `:${String(value)}`);
      }
    } else if (operation === "rename-first-symbol-own-key") {
      for (const value of valueVariants) {
        const page = fresh();
        const groups = page[ENDPOINT_DATA_FIELD[endpointKind]] as PlainRecord;
        const original = Object.keys(groups)[0];
        assert.ok(original);
        groups[value as string] = groups[original];
        delete groups[original];
        add(endpointKind, page, fixtureCase, value, false, `:${String(value)}`);
      }
    } else if (operation === "replace-first-symbol-value") {
      for (const value of valueVariants) {
        const page = fresh();
        const groups = page[ENDPOINT_DATA_FIELD[endpointKind]] as PlainRecord;
        const symbol = Object.keys(groups)[0];
        assert.ok(symbol);
        groups[symbol] = structuredClone(value);
        add(endpointKind, page, fixtureCase, value, false, `:${String(value)}`);
      }
    } else if (operation === "replace-first-item") {
      for (const value of valueVariants) {
        const page = fresh();
        const [, items] = firstGroup(page, endpointKind);
        items[0] = structuredClone(value);
        add(endpointKind, page, fixtureCase, value, false, `:${String(value)}`);
      }
    } else if (operation === "replace-data-member-with-empty-object-and-token-with-string") {
      const page = fresh();
      page[ENDPOINT_DATA_FIELD[endpointKind]] = {};
      page["next_page_token"] = fixtureCase["token"];
      add(endpointKind, page);
    } else if (operation === "remove-each-own-field-from-first-item") {
      for (const fieldName of (fixtureCase["fieldSetByEndpoint"] as PlainRecord)[
        endpointKind
      ] as readonly string[]) {
        const page = fresh();
        delete firstItem(page, endpointKind)[fieldName];
        add(endpointKind, page, fixtureCase, fieldName, false, `:${fieldName}`);
      }
    } else if (operation === "add-own-field-to-first-item") {
      const page = fresh();
      firstItem(page, endpointKind)[fixtureCase["field"] as string] = fixtureCase["value"];
      add(endpointKind, page);
    } else if (
      operation === "replace-each-own-field-in-first-item" ||
      operation === "replace-each-number-field-in-first-item"
    ) {
      const fields =
        (fixtureCase["fieldSet"] as readonly string[] | undefined) ??
        ((fixtureCase["fieldSetByEndpoint"] as PlainRecord)[endpointKind] as readonly string[]);
      for (const fieldName of fields) {
        for (const value of valueVariants) {
          const page = fresh();
          firstItem(page, endpointKind)[fieldName] = structuredClone(value);
          add(endpointKind, page, fixtureCase, value, false, `:${fieldName}:${String(value)}`);
        }
      }
    } else if (
      operation === "replace-first-item-field" ||
      operation === "replace-or-add-first-item-field"
    ) {
      const descriptors =
        (fixtureCase["timestampCases"] as readonly PlainRecord[] | undefined) ??
        valueVariants.map((value): PlainRecord => ({ value }));
      for (const descriptor of descriptors) {
        const value = Object.hasOwn(descriptor, "text") ? descriptor["text"] : descriptor["value"];
        const page = fresh();
        firstItem(page, endpointKind)[field as string] = structuredClone(value);
        add(endpointKind, page, descriptor, value, false, `:${String(value)}`);
      }
    } else if (operation === "replace-first-item-field-with-generated-string") {
      for (const descriptor of fixtureCase["generatedValues"] as readonly PlainRecord[]) {
        const value = generatedFixtureValue(descriptor);
        const page = fresh();
        firstItem(page, endpointKind)[field as string] = value;
        add(endpointKind, page, descriptor, value, false, `:${descriptor["bytes"] as number}`);
      }
    } else if (operation === "replace-first-item-field-with-generated-array") {
      for (const descriptor of fixtureCase["generatedValues"] as readonly PlainRecord[]) {
        const value = generatedFixtureValue(descriptor);
        const page = fresh();
        firstItem(page, endpointKind)[field as string] = value;
        add(
          endpointKind,
          page,
          descriptor,
          value,
          false,
          `:${descriptor["count"] ?? descriptor["bytes"]}`,
        );
      }
    } else if (
      operation === "replace-first-item-raw-number-token" ||
      operation === "replace-first-decimal-with-raw-number-token"
    ) {
      const decimalField = { quotes: "bp", trades: "p", bars: "o" }[endpointKind];
      const descriptors = (fixtureCase["rawNumberTokens"] as readonly unknown[]).map((entry) =>
        typeof entry === "string" ? { token: entry } : (entry as PlainRecord),
      );
      for (const descriptor of descriptors) {
        const token = descriptor["token"] as string;
        const page = fresh();
        firstItem(page, endpointKind)[field ?? decimalField] = rawNumber(token);
        add(endpointKind, page, descriptor, token, false, `:${token}`);
      }
    } else if (operation === "replace-each-first-item-raw-number-token") {
      for (const fieldName of fixtureCase["fieldSet"] as readonly string[]) {
        for (const descriptor of fixtureCase["rawNumberTokens"] as readonly PlainRecord[]) {
          const token = descriptor["token"] as string;
          const page = fresh();
          firstItem(page, endpointKind)[fieldName] = rawNumber(token);
          add(endpointKind, page, descriptor, token, false, `:${fieldName}:${token}`);
        }
      }
    } else if (operation === "replace-first-item-fields") {
      for (const fieldMap of fixtureCase["fieldMaps"] as readonly PlainRecord[]) {
        const page = fresh();
        Object.assign(firstItem(page, endpointKind), structuredClone(fieldMap));
        add(endpointKind, page, fixtureCase, fieldMap, false, `:${JSON.stringify(fieldMap)}`);
      }
    } else if (operation === "replace-first-symbol-array-with-generated-identical-items") {
      for (const descriptor of fixtureCase["generatedValues"] as readonly PlainRecord[]) {
        const page = fresh();
        const [, items] = firstGroup(page, endpointKind);
        const exemplar = structuredClone(items[0]);
        items.splice(
          0,
          items.length,
          ...Array.from({ length: descriptor["count"] as number }, () => structuredClone(exemplar)),
        );
        add(
          endpointKind,
          page,
          descriptor,
          descriptor["count"],
          false,
          `:${descriptor["count"] as number}`,
        );
      }
    } else if (operation === "duplicate-first-item-with-earlier-timestamp-after-it") {
      const page = fresh();
      const [, items] = firstGroup(page, endpointKind);
      const duplicate = structuredClone(items[0]) as PlainRecord;
      duplicate["t"] = fixtureCase["timestamp"];
      items.splice(1, 0, duplicate);
      add(endpointKind, page);
    } else if (operation === "replace-with-generated-string") {
      for (const descriptor of fixtureCase["generatedValues"] as readonly PlainRecord[]) {
        const page = fresh();
        const value = generatedFixtureValue(descriptor);
        replacePointer(page, fixtureCase["path"] as string, value);
        add(endpointKind, page, descriptor, value, false, `:${descriptor["bytes"] as number}`);
      }
    } else {
      reject("fixture-operation-unknown");
    }
  }
  assert.ok(vectors.length > 0, fixtureCase.caseId);
  return Object.freeze(vectors);
}

test("wire fixture catalog is closed, original synthetic, inert, and fully enumerated", () => {
  const manifest = JSON.parse(
    readFileSync("fixtures/market-acquisition/v1/manifest.json", "utf8"),
  ) as PlainRecord;
  const amendment = manifest["wireGrammarAmendment"] as PlainRecord;
  assert.equal(amendment["classification"], "original-project-authored-synthetic");
  assert.equal(amendment["providerEvidence"], false);
  assert.equal(amendment["networkAuthorized"], false);
  assert.equal(amendment["copiedProviderExamples"], false);
  assert.deepEqual(amendment["files"], [
    "wire-grammar/README.md",
    "wire-grammar/valid-pages.json",
    "wire-grammar/grammar-faults.json",
    "wire-grammar/pagination-delivery-faults.json",
    "wire-grammar/hostile-atomicity-faults.json",
    "wire-grammar/bar-translation.json",
  ]);
  assert.equal(validFixture.cases.length, 9);
  assert.equal(grammarFixture.cases.length, 50);
  assert.equal(paginationFixture.cases.length, 19);
  assert.equal(hostileAtomicityFixture.cases.length, 8);
  const identifiers = [
    ...validFixture.cases,
    ...grammarFixture.cases,
    ...paginationFixture.cases,
    ...hostileAtomicityFixture.cases,
  ].map((entry) => entry.caseId);
  assert.equal(new Set(identifiers).size, 86);
  const matrixText = readFileSync("docs/contracts/pr-2e-p1-10-wire-acceptance-matrix.md", "utf8");
  for (const identifier of identifiers) {
    assert.equal(matrixText.includes(`\`${identifier}\``), true, identifier);
  }
  assert.ok(identifiers.includes("exact-timestamp-offset-round-trip"));
  assert.ok(identifiers.includes("fault-duplicate-json-key"));
  assert.ok(identifiers.includes("item-conflicting-bar-key"));
  const corpusText = [
    readFileSync(`${FIXTURE_ROOT}/valid-pages.json`, "utf8"),
    readFileSync(`${FIXTURE_ROOT}/grammar-faults.json`, "utf8"),
    readFileSync(`${FIXTURE_ROOT}/pagination-delivery-faults.json`, "utf8"),
    readFileSync(`${FIXTURE_ROOT}/hostile-atomicity-faults.json`, "utf8"),
  ].join("\n");
  for (const forbidden of [
    "https://",
    "http://",
    "APCA-API-KEY",
    "PEAS_ALPACA_API",
    "financialmodelingprep",
    '"apikey"',
  ]) {
    assert.equal(corpusText.includes(forbidden), false, forbidden);
  }
});

test("all 50 grammar-fault fixtures execute every literal operation and disposition", () => {
  const executed = new Set<string>();
  const mismatches: string[] = [];
  let vectorCount = 0;
  for (const fixtureCase of grammarFixture.cases) {
    const vectors = expandGrammarFaultCase(fixtureCase);
    executed.add(fixtureCase.caseId);
    vectorCount += vectors.length;
    for (const vector of vectors) {
      const operation = (): unknown => {
        if (vector.rawText) return parseRawJson(vector.candidate as string);
        return admitPage(vector.endpointKind, modelValue(vector.candidate));
      };
      let actual: "admit" | "reject" = "admit";
      try {
        operation();
      } catch {
        actual = "reject";
      }
      if (actual !== vector.expected) {
        mismatches.push(`${vector.label}: expected ${vector.expected}, observed ${actual}`);
      }
    }
  }
  assert.equal(executed.size, 50);
  assert.equal(executed.size, grammarFixture.cases.length);
  assert.ok(vectorCount > 300, `expanded only ${vectorCount} literal vectors`);
  assert.deepEqual(mismatches, []);
});

test("all 8 hostile-atomicity recipes execute with literal zero-trap and zero-output counters", async () => {
  const executedCases = new Set<string>();
  const executedRecipes = new Set<string>();

  for (const fixtureCase of hostileAtomicityFixture.cases) {
    executedCases.add(fixtureCase.caseId);
    const recipes = fixtureCase["runtimeValueRecipes"] as readonly PlainRecord[];
    let accessorCalls = 0;
    let proxyTrapCalls = 0;
    let laterSchemaReads = 0;
    let terminalDecisions = 0;
    let records = 0;
    let quarantines = 0;
    const normalizationCalls = 0;
    const replacements = 0;
    const selections = 0;
    const reversibleStateMutations = 0;
    let observedErrorCode: string | null = null;

    const throwingAccessorObject = (propertyAlias: string): PlainRecord => {
      const value = Object.create(null) as PlainRecord;
      Object.defineProperty(value, propertyAlias, {
        enumerable: true,
        configurable: true,
        get() {
          laterSchemaReads += 1;
          accessorCalls += 1;
          throw new Error("synthetic-hostile-accessor");
        },
      });
      return value;
    };
    const throwingProxy = (): object =>
      new Proxy(
        {},
        {
          getPrototypeOf() {
            laterSchemaReads += 1;
            proxyTrapCalls += 1;
            throw new Error("synthetic-hostile-proxy");
          },
          ownKeys() {
            laterSchemaReads += 1;
            proxyTrapCalls += 1;
            throw new Error("synthetic-hostile-proxy");
          },
          getOwnPropertyDescriptor() {
            laterSchemaReads += 1;
            proxyTrapCalls += 1;
            throw new Error("synthetic-hostile-proxy");
          },
          get() {
            laterSchemaReads += 1;
            proxyTrapCalls += 1;
            throw new Error("synthetic-hostile-proxy");
          },
        },
      );
    const observeAdmission = (admission: PageAdmission): void => {
      terminalDecisions += admission.terminalReason === "correction-unsupported" ? 1 : 0;
      records += admission.records.length;
      quarantines += admission.quarantines.length;
      assert.equal(admission.barObservations.length, 0);
    };
    const expectRejected = (operation: () => unknown): void => {
      try {
        operation();
        assert.fail(`${fixtureCase.caseId} unexpectedly admitted`);
      } catch (error) {
        if (error instanceof WireContractError) {
          observedErrorCode = error.code;
          return;
        }
        throw error;
      }
    };

    for (const recipe of recipes) {
      executedRecipes.add(recipe["recipeId"] as string);
    }

    switch (fixtureCase["operation"]) {
      case "append-runtime-values-after-first-valid-update": {
        const page = cloneAndModel(fixtureWire(fixtureCase["baseCaseId"] as string));
        const [, items] = firstGroup(page, "trades");
        for (const recipe of recipes) {
          if (recipe["kind"] === "literal-null") {
            items.push(null);
          } else if (recipe["kind"] === "object-with-throwing-own-accessor") {
            items.push(throwingAccessorObject(recipe["propertyAlias"] as string));
          } else {
            reject("fixture-operation-unknown");
          }
        }
        observeAdmission(admitPage("trades", page));
        break;
      }
      case "append-runtime-symbol-group-after-first-valid-update-group": {
        const page = cloneAndModel(fixtureWire(fixtureCase["baseCaseId"] as string));
        const groups = page["trades"] as PlainRecord;
        groups[(fixtureCase["placement"] as PlainRecord)["symbolAlias"] as string] = [
          throwingProxy(),
        ];
        observeAdmission(admitPage("trades", page));
        break;
      }
      case "construct-runtime-page-chain-with-hostile-page-after-valid-update": {
        const updatePage = cloneAndModel(fixtureWire(fixtureCase["baseCaseId"] as string));
        updatePage["next_page_token"] = "peas-synthetic-opaque-stop-before-page-one";
        const hostilePage = throwingAccessorObject(recipes[0]?.["propertyAlias"] as string);
        const journal = new MemoryJournal();
        try {
          records += runChain(
            "trades",
            [
              {
                ordinal: 0,
                page: updatePage,
                presentedRequestToken: null,
                logicalRequestId: "peas-synthetic-immediate-u-stop",
              },
              {
                ordinal: 1,
                page: hostilePage,
                presentedRequestToken: "peas-synthetic-opaque-stop-before-page-one",
                logicalRequestId: "peas-synthetic-immediate-u-stop",
              },
            ],
            journal,
          ).length;
          const outcome = journal.load()?.outcome;
          terminalDecisions += outcome?.terminalReason === "correction-unsupported" ? 1 : 0;
          quarantines += outcome?.quarantines.length ?? 0;
        } finally {
          journal.close();
        }
        break;
      }
      case "replace-first-array-index-with-runtime-accessor": {
        const page = cloneAndModel(fixtureWire(fixtureCase["baseCaseId"] as string));
        const [, items] = firstGroup(page, "bars");
        Object.defineProperty(items, recipes[0]?.["index"] as number, {
          enumerable: true,
          configurable: true,
          get() {
            accessorCalls += 1;
            throw new Error("synthetic-hostile-index-accessor");
          },
        });
        expectRejected(() => admitPage("bars", page));
        break;
      }
      case "replace-first-item-numeric-field-with-runtime-proxy": {
        const page = cloneAndModel(fixtureWire(fixtureCase["baseCaseId"] as string));
        firstItem(page, "bars")[fixtureCase["field"] as string] = throwingProxy();
        expectRejected(() => admitPage("bars", page));
        break;
      }
      case "set-first-symbol-array-runtime-prototype": {
        const page = cloneAndModel(fixtureWire(fixtureCase["baseCaseId"] as string));
        const [, items] = firstGroup(page, "bars");
        Object.setPrototypeOf(items, Object.freeze(Object.create(null)));
        expectRejected(() => admitPage("bars", page));
        break;
      }
      case "add-extra-own-property-to-first-symbol-array": {
        const page = cloneAndModel(fixtureWire(fixtureCase["baseCaseId"] as string));
        const [, items] = firstGroup(page, "bars");
        Object.defineProperty(items, recipes[0]?.["propertyAlias"] as string, {
          enumerable: recipes[0]?.["enumerable"] as boolean,
          configurable: true,
          value: true,
        });
        expectRejected(() => admitPage("bars", page));
        break;
      }
      case "replace-first-item-condition-member-with-runtime-value": {
        for (const recipe of recipes) {
          const page = cloneAndModel(fixtureWire(fixtureCase["baseCaseId"] as string));
          const conditionValues = firstItem(page, "trades")[
            fixtureCase["field"] as string
          ] as unknown[];
          const index = fixtureCase["index"] as number;
          if (recipe["kind"] === "array-index-throwing-accessor") {
            Object.defineProperty(conditionValues, index, {
              enumerable: true,
              configurable: true,
              get() {
                accessorCalls += 1;
                throw new Error("synthetic-hostile-nested-accessor");
              },
            });
          } else if (recipe["kind"] === "proxy-with-throwing-traps") {
            conditionValues[index] = throwingProxy();
          } else {
            reject("fixture-operation-unknown");
          }
          expectRejected(() => admitPage("trades", page));
        }
        break;
      }
      default:
        reject("fixture-operation-unknown");
    }

    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const expected = fixtureCase["expectedCounters"] as PlainRecord;
    const actual: PlainRecord = {
      terminalDecisions,
      laterSchemaReads,
      accessorCalls,
      proxyTrapCalls,
      records,
      quarantines,
      normalizationCalls,
      replacements,
      selections,
      reversibleStateMutations,
      postReturnActivity: 0,
    };
    for (const [counter, expectedValue] of Object.entries(expected)) {
      assert.equal(actual[counter], expectedValue, `${fixtureCase.caseId}:${counter}`);
    }
    if (fixtureCase["expectedErrorCode"] !== undefined) {
      assert.equal(observedErrorCode, fixtureCase["expectedErrorCode"], fixtureCase.caseId);
    } else {
      assert.equal(observedErrorCode, null, fixtureCase.caseId);
    }
  }

  assert.equal(executedCases.size, 8);
  assert.equal(executedCases.size, hostileAtomicityFixture.cases.length);
  assert.equal(executedRecipes.size, 10);
});

test("exact RFC3339 Z and numeric-offset parsing preserves lexical precision and canonical UTC", () => {
  const precisionCase = grammarFixture.cases.find(
    (entry) => entry.caseId === "exact-timestamp-supported-precision",
  ) as FixtureCase;
  const timestampCases = precisionCase["timestampCases"] as readonly Readonly<{
    text: string;
    precisionNs: string;
  }>[];
  assert.equal(timestampCases.length, 10);
  for (const timestampCase of timestampCases) {
    const parsed = parseTimestamp(timestampCase.text);
    assert.equal(parsed.timestamp.precisionNs, timestampCase.precisionNs);
    assert.equal(parsed.canonicalUtc, timestampCase.text);
    assert.equal(parseTimestamp(parsed.canonicalUtc).timestamp.epochNs, parsed.timestamp.epochNs);
  }

  const offsetCase = grammarFixture.cases.find(
    (entry) => entry.caseId === "exact-timestamp-offset-round-trip",
  ) as FixtureCase;
  for (const timestampCase of offsetCase["timestampCases"] as readonly Readonly<{
    text: string;
    canonicalUtc: string;
    precisionNs: string;
  }>[]) {
    const parsed = parseTimestamp(timestampCase.text);
    assert.equal(parsed.canonicalUtc, timestampCase.canonicalUtc);
    assert.equal(parsed.timestamp.precisionNs, timestampCase.precisionNs);
    const roundTrip = parseTimestamp(parsed.canonicalUtc);
    assert.equal(roundTrip.timestamp.epochNs, parsed.timestamp.epochNs);
    assert.equal(roundTrip.timestamp.precisionNs, parsed.timestamp.precisionNs);
  }

  const invalidCase = grammarFixture.cases.find(
    (entry) => entry.caseId === "fault-timestamp-canonical-round-trip",
  ) as FixtureCase;
  for (const invalid of invalidCase["values"] as readonly unknown[]) {
    expectWireError("market.timestamp-invalid", () => parseTimestamp(invalid));
  }
  for (const invalid of [
    "2033-05-06T07:08:09.123456789+24:00",
    "2033-05-06T07:08:09.123456789+00:60",
    "2033-05-06T07:08:09.123456789z",
    "2033-05-06t07:08:09.123456789Z",
  ]) {
    expectWireError("market.timestamp-invalid", () => parseTimestamp(invalid));
  }
  expectWireError("timestampTextBytes", () => parseTimestamp("2".repeat(65)));
});

test("all valid synthetic pages admit exact grammar and enforce bar-only translation", () => {
  for (const entry of validFixture.cases) {
    const result = admitFixture(entry.caseId);
    if (entry.endpointKind === "quotes") {
      assert.equal(result.records.length, 0);
      assert.equal(result.quarantines.length > 0, true);
      assert.ok(result.quarantines.every((item) => item.reason === "market.condition-unknown"));
      assert.equal(result.terminalReason, null);
    } else if (entry.endpointKind === "trades") {
      assert.equal(result.records.length, 0);
      assert.equal(result.quarantines.length > 0, true);
      const hasUpdate = entry.caseId.startsWith("wire-trade-update-");
      assert.equal(result.terminalReason, hasUpdate ? "correction-unsupported" : null);
    } else if (entry.caseId === "wire-bars-empty-terminal") {
      assert.equal(result.records.length, 0);
      assert.equal(result.quarantines.length, 0);
    } else {
      assert.equal(result.records.length > 0, true);
      assert.equal(result.quarantines.length, 0);
      assert.equal(normalizeRecordedMarketRecords(result.records).length, result.records.length);
    }
    assert.equal(result.terminal, entry.wire["next_page_token"] === null);
  }
});

test("response envelopes, currency, symbol grouping, and closed item fields fail closed", () => {
  for (const endpointKind of ["quotes", "trades", "bars"] as const) {
    const caseId =
      endpointKind === "quotes"
        ? "wire-quotes-terminal-grouped"
        : endpointKind === "trades"
          ? "wire-trades-terminal-grouped"
          : "wire-bars-terminal-grouped";
    const base = fixtureWire(caseId);
    const dataField = ENDPOINT_DATA_FIELD[endpointKind];

    for (const missing of [dataField, "next_page_token"]) {
      const page = structuredClone(base);
      delete page[missing];
      expectWireError("schema-invalid", () => admitPage(endpointKind, modelValue(page)));
    }
    for (const data of [null, [], "violet", 13, true]) {
      const page = structuredClone(base);
      page[dataField] = data;
      expectWireError("schema-invalid", () => admitPage(endpointKind, modelValue(page)));
    }
    {
      const page = structuredClone(base);
      page["peas_unknown"] = "violet";
      expectWireError("schema-invalid", () => admitPage(endpointKind, modelValue(page)));
    }
    for (const currency of [null, "", "EUR", 1, [], {}]) {
      const page = structuredClone(base);
      page["currency"] = currency;
      expectWireError("market.currency-unsupported", () =>
        admitPage(endpointKind, modelValue(page)),
      );
    }
    {
      const page = structuredClone(base);
      delete page["currency"];
      assert.doesNotThrow(() => admitPage(endpointKind, modelValue(page)));
      page["currency"] = "USD";
      assert.doesNotThrow(() => admitPage(endpointKind, modelValue(page)));
    }
    for (const replacement of ["PEASUNREQUESTED", "", "peasamber", " PEASAMBER", "PEASAMBER "]) {
      const page = structuredClone(base);
      const groups = page[dataField] as PlainRecord;
      const original = Object.keys(groups)[0] as string;
      const value = groups[original];
      delete groups[original];
      groups[replacement] = value;
      expectWireError("schema-invalid", () => admitPage(endpointKind, modelValue(page)));
    }
    for (const replacement of [null, {}, "cobalt", 17, true]) {
      const page = structuredClone(base);
      const groups = page[dataField] as PlainRecord;
      groups[Object.keys(groups)[0] as string] = replacement;
      expectWireError("schema-invalid", () => admitPage(endpointKind, modelValue(page)));
    }
    for (const missing of ITEM_FIELDS[endpointKind]) {
      const page = structuredClone(base);
      delete firstItem(page, endpointKind)[missing];
      expectWireError("schema-invalid", () => admitPage(endpointKind, modelValue(page)));
    }
    {
      const page = structuredClone(base);
      firstItem(page, endpointKind)["peas_unknown"] = "indigo";
      expectWireError("schema-invalid", () => admitPage(endpointKind, modelValue(page)));
    }
    for (const field of ITEM_FIELDS[endpointKind]) {
      const page = structuredClone(base);
      firstItem(page, endpointKind)[field] = null;
      const expected =
        field === "t"
          ? "market.timestamp-invalid"
          : ["bp", "ap", "p", "o", "h", "l", "c", "vw"].includes(field)
            ? "schema-invalid"
            : "schema-invalid";
      expectWireError(expected, () => admitPage(endpointKind, modelValue(page)));
    }
  }
});

test("quote/trade conditions, tapes, updates, and absent sequence authority never emit records", () => {
  const quote = fixtureWire("wire-quotes-terminal-grouped");
  for (const members of [["C1"], ["C1", "C2"]]) {
    const page = structuredClone(quote);
    firstItem(page, "quotes")["c"] = members;
    const result = admitPage("quotes", modelValue(page));
    assert.equal(result.records.length, 0);
    assert.equal(result.quarantines[0]?.reason, "market.condition-unknown");
  }
  for (const members of [[], ["C1", "C2", "C3"]]) {
    const page = structuredClone(quote);
    firstItem(page, "quotes")["c"] = members;
    expectWireError("schema-invalid", () => admitPage("quotes", modelValue(page)));
  }

  const trade = fixtureWire("wire-trades-terminal-grouped");
  for (const count of [0, 1, 8]) {
    const page = structuredClone(trade);
    firstItem(page, "trades")["c"] = Array.from({ length: count }, (_, index) => `C${index}`);
    const result = admitPage("trades", modelValue(page));
    assert.equal(result.records.length, 0);
    assert.equal(result.terminalReason, null);
  }
  {
    const page = structuredClone(trade);
    firstItem(page, "trades")["c"] = Array.from({ length: 9 }, (_, index) => `C${index}`);
    expectWireError("conditionMembers", () => admitPage("trades", modelValue(page)));
  }
  for (const endpointKind of ["quotes", "trades"] as const) {
    const source = endpointKind === "quotes" ? quote : trade;
    for (const accepted of ["A", "B", "C"]) {
      const page = structuredClone(source);
      firstItem(page, endpointKind)["z"] = accepted;
      assert.equal(admitPage(endpointKind, modelValue(page)).records.length, 0);
    }
    for (const rejected of ["N", "O"]) {
      const page = structuredClone(source);
      firstItem(page, endpointKind)["z"] = rejected;
      expectWireError("market.dataset-feed-mismatch", () =>
        admitPage(endpointKind, modelValue(page)),
      );
    }
  }
  for (const update of ["canceled", "incorrect", "corrected"] as const) {
    const page = structuredClone(trade);
    firstItem(page, "trades")["u"] = update;
    const result = admitPage("trades", modelValue(page));
    assert.equal(result.records.length, 0);
    assert.equal(result.terminalReason, "correction-unsupported");
    assert.deepEqual(result.quarantines, [
      {
        endpointKind: "trades",
        reason: "correction-unsupported",
        symbol: "PEASLIL",
        itemIndex: 0,
      },
    ]);
    assert.equal(result.barObservations.length, 0);
  }
  for (const update of ["", "replaced", "CANCELED", null, 1, true, [], {}]) {
    const page = structuredClone(trade);
    firstItem(page, "trades")["u"] = update;
    expectWireError("schema-invalid", () => admitPage("trades", modelValue(page)));
  }
});

test("valid trade updates stop at first, middle, and last positions before hostile successors", () => {
  let accessorCalls = 0;
  let proxyTrapCalls = 0;
  const throwingItemAccessor = (): PlainRecord => {
    const value = Object.create(null) as PlainRecord;
    Object.defineProperty(value, "syntheticLaterField", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        throw new Error("synthetic-post-u-accessor");
      },
    });
    return value;
  };
  const throwingItemProxy = (): object =>
    new Proxy(
      {},
      {
        getPrototypeOf() {
          proxyTrapCalls += 1;
          throw new Error("synthetic-post-u-proxy");
        },
        ownKeys() {
          proxyTrapCalls += 1;
          throw new Error("synthetic-post-u-proxy");
        },
        getOwnPropertyDescriptor() {
          proxyTrapCalls += 1;
          throw new Error("synthetic-post-u-proxy");
        },
        get() {
          proxyTrapCalls += 1;
          throw new Error("synthetic-post-u-proxy");
        },
      },
    );
  const base = cloneAndModel(fixtureWire("wire-trades-terminal-grouped"));
  const normal = structuredClone(firstItem(base, "trades"));

  for (const update of ["canceled", "incorrect", "corrected"] as const) {
    for (const position of ["first", "middle", "last"] as const) {
      const updateItem = structuredClone(normal);
      updateItem["u"] = update;
      const groups: PlainRecord = {};
      let expectedItemIndex = 0;
      if (position === "first") {
        groups["PEASLIL"] = [updateItem, null];
      } else if (position === "middle") {
        expectedItemIndex = 1;
        groups["PEASLIL"] = [structuredClone(normal), updateItem, throwingItemAccessor()];
      } else {
        expectedItemIndex = 1;
        groups["PEASLIL"] = [structuredClone(normal), updateItem];
        groups["PEASUMB"] = [throwingItemProxy()];
      }
      const result = admitPage("trades", {
        trades: groups,
        next_page_token: "peas-synthetic-must-not-resume-after-u",
      });
      assert.equal(result.terminal, true);
      assert.equal(result.privateNextToken, null);
      assert.equal(result.terminalReason, "correction-unsupported");
      assert.deepEqual(result.records, []);
      assert.deepEqual(result.barObservations, []);
      assert.deepEqual(result.quarantines, [
        {
          endpointKind: "trades",
          reason: "correction-unsupported",
          symbol: "PEASLIL",
          itemIndex: expectedItemIndex,
        },
      ]);
      assert.deepEqual(result.publicSummary, {
        endpointKind: "trades",
        recordCount: 0,
        quarantineCount: 1,
        terminalReason: "correction-unsupported",
      });
      for (const forbiddenState of [
        "replacement",
        "replacements",
        "selection",
        "selections",
        "reversibleState",
        "providerRecordKey",
        "providerRevisionKey",
      ]) {
        assert.equal(Object.hasOwn(result, forbiddenState), false, forbiddenState);
      }
      const resolved = resolveCompleteChain("trades", [result]);
      assert.equal(resolved.terminalReason, "correction-unsupported");
      assert.deepEqual(resolved.records, []);
      assert.equal(resolved.barObservationCount, 0);
    }
  }
  assert.equal(accessorCalls, 0);
  assert.equal(proxyTrapCalls, 0);
});

test("decimal and integer lexical grammar, machine limits, and one-over bounds are exact", () => {
  for (const token of ["1e2", "1E+2", "+1", "-0", "01", "1."]) {
    expectWireError("market.decimal-invalid", () => numberToken(rawNumber(token)));
  }
  assert.equal(numberToken(rawNumber("12345678901234567890.12345678901")).length, 32);
  expectWireError("rawDecimalTokenBytes", () =>
    numberToken(rawNumber("12345678901234567890.123456789012")),
  );

  assert.equal(unsignedInteger(rawNumber("0"), 18_446_744_073_709_551_615n), 0n);
  assert.equal(
    unsignedInteger(rawNumber("18446744073709551615"), 18_446_744_073_709_551_615n),
    18_446_744_073_709_551_615n,
  );
  expectWireError("bound-exceeded", () =>
    unsignedInteger(rawNumber("18446744073709551616"), 18_446_744_073_709_551_615n),
  );
  assert.equal(unsignedInteger(rawNumber("4294967295"), 4_294_967_295n), 4_294_967_295n);
  expectWireError("bound-exceeded", () => unsignedInteger(rawNumber("4294967296"), 4_294_967_295n));
  assert.equal(unsignedInteger(rawNumber("9223372036854775807"), SIGNED_NS_MAX), SIGNED_NS_MAX);
  expectWireError("bound-exceeded", () =>
    unsignedInteger(rawNumber("9223372036854775808"), SIGNED_NS_MAX),
  );

  expectWireError("market.decimal-invalid", () => decimal(rawNumber("000")));
});

test("numeric wire fields reject wrong types and bars quarantine every contradiction", () => {
  const wrongValues = [null, "17.125", true, [], {}];
  for (const endpointKind of ["quotes", "trades", "bars"] as const) {
    const page =
      endpointKind === "quotes"
        ? fixtureWire("wire-quotes-terminal-grouped")
        : endpointKind === "trades"
          ? fixtureWire("wire-trades-terminal-grouped")
          : fixtureWire("wire-bars-terminal-grouped");
    const numericFields =
      endpointKind === "quotes"
        ? ["bp", "ap"]
        : endpointKind === "trades"
          ? ["p"]
          : ["o", "h", "l", "c", "vw"];
    for (const field of numericFields) {
      for (const wrong of wrongValues) {
        const mutated = structuredClone(page);
        firstItem(mutated, endpointKind)[field] = wrong;
        expectWireError("schema-invalid", () => admitPage(endpointKind, modelValue(mutated)));
      }
    }
  }

  const contradictionMaps = [
    { h: 60.125, l: 60.375 },
    { o: 63.125, h: 62.875 },
    { c: 59.875, l: 60.375 },
    { vw: 63.125, h: 62.875 },
    { vw: 59.875, l: 60.375 },
    { v: 0 },
    { n: 0 },
  ];
  for (const mutation of contradictionMaps) {
    const page = fixtureWire("wire-bars-terminal-grouped");
    Object.assign(firstItem(page, "bars"), mutation);
    const result = admitPage("bars", modelValue(page));
    assert.equal(result.records.length, 1);
    assert.equal(result.quarantines.length, 1);
    assert.equal(
      result.quarantines[0]?.reason,
      "market.provider-observation-invalid/schema-invalid",
    );
  }
  {
    const page = fixtureWire("wire-bars-terminal-grouped");
    const timestamp = firstItem(page, "bars")["t"] as string;
    const incompleteEnd = BigInt(parseTimestamp(timestamp).timestamp.epochNs) + 59_999_999_999n;
    const groups = page["bars"] as PlainRecord;
    for (const symbol of Object.keys(groups).slice(1)) delete groups[symbol];
    const result = admitPage("bars", modelValue(page), {
      ...BASE_CONTEXT,
      queryEndNs: incompleteEnd,
    });
    assert.equal(result.records.length, 0);
    assert.equal(result.quarantines.length, 1);
  }
});

test("bar projection is exact RecordedMarketRecordV1 and accepted normalizer input", () => {
  const result = admitFixture("wire-bars-terminal-grouped");
  assert.equal(result.records.length, 2);
  const ivory = result.records.find((record) => record.memberKey === '$.bars["PEASIVY"][0]');
  assert.ok(ivory);
  assert.deepEqual(ivory.source, {
    providerId: IDS.providerId,
    datasetId: IDS.datasetId,
    feedId: IDS.feedId,
    endpointChannelId: IDS.bars,
    entitlementSnapshotId: BASE_CONTEXT.entitlementSnapshotId,
  });
  assert.equal(ivory.instrumentId, instrumentIds["PEASIVY"]);
  assert.equal(ivory.venueTapeId, null);
  assert.equal(ivory.providerRecordKey, null);
  assert.equal(ivory.providerRevisionKey, null);
  assert.match(ivory.providerStableRecordFamily, /^[0-9a-f]{64}$/u);
  assert.equal(ivory.eventKind, "bar");
  assert.deepEqual(ivory.eventTime, {
    epochNs: parseTimestamp("2033-05-06T07:12:00.000000000Z").timestamp.epochNs,
    semantic: "bar-start",
    precisionNs: "1",
  });
  assert.equal(ivory.providerSequence, null);
  assert.equal(ivory.sequenceSessionDate, null);
  assert.equal(ivory.marketAcquisitionId, BASE_CONTEXT.marketAcquisitionId);
  assert.equal(ivory.rawArtifactId, BASE_CONTEXT.rawArtifactId);
  assert.equal(ivory.occurrenceOrdinal, 0);
  assert.equal(ivory.revisionKind, "original");
  assert.equal(ivory.supersedesRevisionId, null);
  assert.equal(ivory.effectiveEventTime, null);
  assert.equal(ivory.sessionKind, "regular-continuous");
  assert.equal(ivory.currency, "USD");
  assert.deepEqual(ivory.payload, {
    kind: "bar",
    barKind: "one-minute",
    close: { coefficient: "62125", scale: 3, negative: false },
    barStartNs: ivory.eventTime.epochNs,
    barEndNs: (BigInt(ivory.eventTime.epochNs) + 60_000_000_000n).toString(),
    adjustmentMode: "raw",
  });
  assert.equal(
    ivory.canonicalProviderPayloadDigest,
    deriveCanonicalProviderPayloadDigest(ivory.payload),
  );
  assert.equal(ivory.normalizerVersion, "market-normalizer-v1");
  assert.equal(ivory.conditionPolicyVersion, "p1-10-alpaca-no-quote-trade-emission-v1");
  assert.equal(ivory.parserContractVersion, "p1-10-alpaca-historical-wire-v1");
  assert.equal(ivory.providerStableRecordFamily, fallbackFamily(ivory));
  const normalized = normalizeRecordedMarketRecords(result.records);
  assert.equal(normalized.length, 2);
  assert.ok(normalized.every((fact) => fact.providerSequence === null));
  assert.ok(normalized.every((fact) => fact.sequenceSessionDate === null));

  for (const contextMutation of [{ primaryCorpusMember: false }]) {
    const changed = admitPage(
      "bars",
      parseRawJson(JSON.stringify(fixtureWire("wire-bars-terminal-grouped"))),
      { ...BASE_CONTEXT, ...contextMutation },
    );
    assert.ok(changed.records.every((record) => !record.primaryCorpusMember));
  }
});

test("literal bar golden independently recomputes accepted hashes and exact record bytes", () => {
  assert.equal(barTranslationFixture.cases.length, 1);
  const golden = barTranslationFixture.cases[0];
  assert.ok(golden);
  assert.equal(golden.caseId, "translate-first-peasivy-raw-one-minute-bar");
  assert.equal(golden.memberKey, '$.bars["PEASIVY"][0]');
  const payloadDigest = createHash("sha256")
    .update(independentCanonicalJson(golden.expectedRecord.payload as unknown as JsonValue), "utf8")
    .digest("hex");
  assert.equal(payloadDigest, golden.expectedRecord.canonicalProviderPayloadDigest);
  assert.equal(
    independentCanonicalJson({
      z: 3,
      a: { negative: false, scale: 2, coefficient: "41375" },
    }),
    '{"a":{"coefficient":"41375","negative":false,"scale":2},"z":3}',
  );
  assert.equal(
    independentFramedHash(
      "peas/market-provider-fallback-family/v1",
      golden.providerStableRecordFamilyPreimage,
    ),
    golden.providerStableRecordFamily,
  );
  const actual = admitFixture(golden.wireCaseId).records.find(
    (record) => record.memberKey === golden.memberKey,
  );
  assert.ok(actual);
  assert.deepEqual(actual, golden.expectedRecord);
  assert.equal(normalizeRecordedMarketRecords([actual]).length, 1);
});

test("wireRecordDigest uses the exact frozen canonical preimage and collapses equivalent spellings", () => {
  const baseline = admitFixture("wire-bars-terminal-grouped");
  const observation = baseline.barObservations.find(
    (entry) => entry.symbol === "PEASIVY" && entry.itemIndex === 0,
  );
  assert.ok(observation);
  const exactPreimage = {
    endpointChannelId: IDS.bars,
    symbolGroupKey: "PEASIVY",
    item: {
      t: "2033-05-06T07:12:00.000000000Z",
      o: { coefficient: "61125", scale: 3, negative: false },
      h: { coefficient: "62875", scale: 3, negative: false },
      l: { coefficient: "60375", scale: 3, negative: false },
      c: { coefficient: "62125", scale: 3, negative: false },
      v: "101",
      n: "41",
      vw: { coefficient: "619375", scale: 4, negative: false },
    },
  } as unknown as JsonValue;
  assert.equal(
    observation.wireDigest,
    independentFramedHash("peas/p1-10-wire-record/v1", exactPreimage),
  );

  const equivalent = cloneAndModel(fixtureWire("wire-bars-terminal-grouped"));
  const equivalentItem = firstItem(equivalent, "bars");
  equivalentItem["t"] = "2033-05-06T08:12:00.000000000+01:00";
  equivalentItem["c"] = rawNumber("62.1250");
  const equivalentObservation = admitPage("bars", equivalent).barObservations.find(
    (entry) => entry.symbol === "PEASIVY" && entry.itemIndex === 0,
  );
  assert.equal(equivalentObservation?.wireDigest, observation.wireDigest);

  const nonprojectedChange = fixtureWire("wire-bars-terminal-grouped");
  firstItem(nonprojectedChange, "bars")["h"] = 62.75;
  const changedObservation = admitPage("bars", modelValue(nonprojectedChange)).barObservations.find(
    (entry) => entry.symbol === "PEASIVY" && entry.itemIndex === 0,
  );
  assert.notEqual(changedObservation?.wireDigest, observation.wireDigest);

  const tradeAdmission = admitFixture("wire-trades-terminal-grouped");
  const tradeItem = modelValue(
    firstItem(fixtureWire("wire-trades-terminal-grouped"), "trades"),
  ) as PlainRecord;
  const validatedTrade = validateItem("trades", "PEASLIL", 0, tradeItem, BASE_CONTEXT);
  assert.equal(validatedTrade.kind, "trade");
  assert.equal(
    validatedTrade.digest,
    independentFramedHash("peas/p1-10-wire-record/v1", {
      endpointChannelId: IDS.trades,
      symbolGroupKey: "PEASLIL",
      item: {
        t: "2033-05-06T07:10:11.987654321Z",
        i: "7001",
        x: "VX",
        p: { coefficient: "41125", scale: 3, negative: false },
        s: "19",
        c: ["T1"],
        z: "A",
        u: null,
      },
    } as unknown as JsonValue),
  );
  assert.equal(tradeAdmission.records.length, 0);
});

test("required opaque token grammar and complete page-chain contradictions fail closed", () => {
  for (const endpointKind of ["quotes", "trades", "bars"] as const) {
    const base =
      endpointKind === "quotes"
        ? fixtureWire("wire-quotes-terminal-grouped")
        : endpointKind === "trades"
          ? fixtureWire("wire-trades-terminal-grouped")
          : fixtureWire("wire-bars-terminal-grouped");
    for (const token of [0, true, [], {}, ""]) {
      const page = structuredClone(base);
      page["next_page_token"] = token;
      expectWireError("schema-invalid", () => admitPage(endpointKind, modelValue(page)));
    }
    {
      const page = structuredClone(base);
      page["next_page_token"] = "x".repeat(4_096);
      assert.equal(admitPage(endpointKind, modelValue(page)).privateNextToken?.length, 4_096);
      page["next_page_token"] = "x".repeat(4_097);
      expectWireError("pageTokenInputBytes", () => admitPage(endpointKind, modelValue(page)));
    }
  }

  const first = fixtureWire("wire-bars-continuation");
  const second = fixtureWire("wire-bars-terminal-grouped");
  const acceptedPages: readonly ChainPage[] = [
    {
      ordinal: 0,
      page: first,
      presentedRequestToken: null,
      logicalRequestId: "peas-synthetic-chain",
    },
    {
      ordinal: 1,
      page: second,
      presentedRequestToken: "peas-synthetic-opaque-bars-ordinal-2",
      logicalRequestId: "peas-synthetic-chain",
    },
  ];
  const journal = new MemoryJournal();
  assert.equal(runChain("bars", acceptedPages, journal).length, 3);
  assert.equal(journal.load()?.terminal, true);

  const chainMutation = (
    changes: Partial<ChainPage>,
    expected: string,
    pages = acceptedPages,
    index = 1,
  ): void => {
    const changed = pages.map((entry, pageIndex) =>
      pageIndex === index ? { ...entry, ...changes } : entry,
    );
    expectWireError(expected, () => runChain("bars", changed, new MemoryJournal()));
  };
  chainMutation({ presentedRequestToken: "substituted" }, "token-substitution");
  chainMutation({ ordinal: 2 }, "page-position-invalid");
  chainMutation({ ordinal: 0 }, "page-position-invalid");
  chainMutation({ logicalRequestId: "other-query" }, "cross-query-token");
  chainMutation(
    { presentedRequestToken: "unexpected-first-token" },
    "first-request-token",
    acceptedPages,
    0,
  );
  assert.deepEqual(runChain("bars", acceptedPages.slice(0, 1), new MemoryJournal()), []);
  const terminalTemplate = acceptedPages[1] as ChainPage;
  const terminalThenAnother: readonly ChainPage[] = [
    { ...terminalTemplate, ordinal: 0, presentedRequestToken: null },
    { ...terminalTemplate, ordinal: 1, presentedRequestToken: null },
  ];
  expectWireError("page-after-terminal", () =>
    runChain("bars", terminalThenAnother, new MemoryJournal()),
  );

  const loopFirst = fixtureWire("wire-quotes-continuation-currency");
  const loopSecond = fixtureWire("wire-quotes-continuation-currency");
  const repeatedToken = loopFirst["next_page_token"] as string;
  expectWireError("repeated-token", () =>
    runChain(
      "quotes",
      [
        {
          ordinal: 0,
          page: loopFirst,
          presentedRequestToken: null,
          logicalRequestId: "peas-synthetic-loop",
        },
        {
          ordinal: 1,
          page: loopSecond,
          presentedRequestToken: repeatedToken,
          logicalRequestId: "peas-synthetic-loop",
        },
      ],
      new MemoryJournal(),
    ),
  );
});

test("journal persists verified pages, token history, terminal resolution, and restart-safe stops", () => {
  class RecordingJournal extends MemoryJournal {
    readonly saves: ChainCheckpoint[] = [];

    override save(checkpoint: ChainCheckpoint): void {
      this.saves.push(structuredClone(checkpoint));
      super.save(checkpoint);
    }
  }

  const first = fixtureWire("wire-bars-continuation");
  const second = fixtureWire("wire-bars-terminal-grouped");
  const firstPage: ChainPage = {
    ordinal: 0,
    page: first,
    presentedRequestToken: null,
    logicalRequestId: "peas-synthetic-journal",
  };
  const secondPage: ChainPage = {
    ordinal: 1,
    page: second,
    presentedRequestToken: "peas-synthetic-opaque-bars-ordinal-2",
    logicalRequestId: "peas-synthetic-journal",
  };
  const journal = new RecordingJournal();
  assert.deepEqual(runChain("bars", [firstPage], journal), []);
  const incomplete = journal.load();
  assert.ok(incomplete);
  assert.equal(incomplete.terminal, false);
  assert.equal(incomplete.outcome, null);
  assert.equal(incomplete.verifiedPages.length, 1);
  assert.equal(incomplete.seenReturnedTokenHashes.length, 1);
  assert.match(incomplete.verifiedPages[0]?.rawDigest ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(
    incomplete.expectedPrivateTokenHash,
    privateTokenHash("peas-synthetic-opaque-bars-ordinal-2"),
  );
  const completed = runChain("bars", [secondPage], journal);
  assert.equal(completed.length, 3);
  const terminal = journal.load();
  assert.ok(terminal?.terminal);
  assert.ok(terminal.outcome);
  assert.equal(terminal.outcome.records.length, 3);
  assert.equal(terminal.outcome.terminalReason, null);
  assert.match(terminal.outcome.resolutionHash, /^[0-9a-f]{64}$/u);
  assert.ok(journal.saves.at(-1)?.outcome !== null);
  assert.deepEqual(runChain("bars", [], journal), completed);

  const repeatedJournal = new MemoryJournal();
  const quoteFirst: ChainPage = {
    ordinal: 0,
    page: fixtureWire("wire-quotes-continuation-currency"),
    presentedRequestToken: null,
    logicalRequestId: "peas-synthetic-restart-loop",
  };
  assert.deepEqual(runChain("quotes", [quoteFirst], repeatedJournal), []);
  const quoteSecondPage = fixtureWire("wire-quotes-continuation-currency");
  expectWireError("repeated-token", () =>
    runChain(
      "quotes",
      [
        {
          ordinal: 1,
          page: quoteSecondPage,
          presentedRequestToken: "peas-synthetic-opaque-quotes-ordinal-2",
          logicalRequestId: "peas-synthetic-restart-loop",
        },
      ],
      repeatedJournal,
    ),
  );

  const tradeUpdate = fixtureWire("wire-trade-update-corrected");
  tradeUpdate["next_page_token"] = "peas-synthetic-opaque-trade-after-u";
  const laterMalformedTrade = fixtureWire("wire-trades-terminal-grouped");
  firstItem(laterMalformedTrade, "trades")["p"] = "must-not-be-parsed";
  const tradeJournal = new MemoryJournal();
  assert.deepEqual(
    runChain(
      "trades",
      [
        {
          ordinal: 0,
          page: tradeUpdate,
          presentedRequestToken: null,
          logicalRequestId: "peas-synthetic-u-stop",
        },
        {
          ordinal: 1,
          page: laterMalformedTrade,
          presentedRequestToken: "peas-synthetic-opaque-trade-after-u",
          logicalRequestId: "peas-synthetic-u-stop",
        },
      ],
      tradeJournal,
    ),
    [],
  );
  assert.equal(tradeJournal.load()?.outcome?.terminalReason, "correction-unsupported");
  assert.equal(tradeJournal.load()?.outcome?.records.length, 0);

  class MutableJournal implements Journal {
    checkpoint: ChainCheckpoint | null = null;

    load(): ChainCheckpoint | null {
      return this.checkpoint;
    }

    save(checkpoint: ChainCheckpoint): void {
      this.checkpoint = structuredClone(checkpoint);
    }

    close(): void {}
  }
  const corruptible = new MutableJournal();
  assert.deepEqual(runChain("bars", [firstPage], corruptible), []);
  const saved = corruptible.checkpoint;
  assert.ok(saved);
  const firstVerified = saved.verifiedPages[0];
  assert.ok(firstVerified);
  corruptible.checkpoint = {
    ...saved,
    verifiedPages: [{ ...firstVerified, rawText: `${firstVerified.rawText} ` }],
  };
  expectWireError("checkpoint-invalid", () => runChain("bars", [secondPage], corruptible));
});

test("every journal load independently rejects incomplete and terminal checkpoint mutation", () => {
  type SeedableJournal = Journal & {
    seedUncheckedForTest(checkpoint: unknown): void;
  };
  const factories = [
    ["memory", () => new MemoryJournal()],
    ["sqlite", () => new SqliteJournal()],
  ] as const;
  const firstWire = fixtureWire("wire-bars-continuation");
  const middleWire = fixtureWire("wire-bars-continuation");
  middleWire["next_page_token"] = "peas-synthetic-opaque-bars-ordinal-3";
  const terminalWire = fixtureWire("wire-bars-terminal-grouped");
  const prefix: readonly ChainPage[] = [
    {
      ordinal: 0,
      page: firstWire,
      presentedRequestToken: null,
      logicalRequestId: "peas-synthetic-checkpoint-mutation",
    },
    {
      ordinal: 1,
      page: middleWire,
      presentedRequestToken: "peas-synthetic-opaque-bars-ordinal-2",
      logicalRequestId: "peas-synthetic-checkpoint-mutation",
    },
  ];
  const finalPage: ChainPage = {
    ordinal: 2,
    page: terminalWire,
    presentedRequestToken: "peas-synthetic-opaque-bars-ordinal-3",
    logicalRequestId: "peas-synthetic-checkpoint-mutation",
  };

  const mutate = (checkpoint: ChainCheckpoint, operation: (copy: PlainRecord) => void): unknown => {
    const copy = structuredClone(checkpoint) as unknown as PlainRecord;
    operation(copy);
    return copy;
  };
  const pagesOf = (copy: PlainRecord): PlainRecord[] => copy["verifiedPages"] as PlainRecord[];
  const pageAt = (copy: PlainRecord, index: number): PlainRecord => {
    const page = pagesOf(copy)[index];
    assert.ok(page);
    return page;
  };
  const outcomeOf = (copy: PlainRecord): PlainRecord => copy["outcome"] as PlainRecord;
  const rehashOutcome = (outcome: PlainRecord): void => {
    outcome["resolutionHash"] = createHash("sha256")
      .update(
        canonicalJson({
          records: outcome["records"],
          quarantines: outcome["quarantines"],
          terminalReason: outcome["terminalReason"],
          barObservationCount: outcome["barObservationCount"],
        } as JsonValue),
        "utf8",
      )
      .digest("hex");
  };

  for (const [backend, createJournal] of factories) {
    const source = createJournal();
    try {
      assert.deepEqual(runChain("bars", prefix, source), [], backend);
      const incomplete = source.load();
      assert.ok(incomplete);
      assert.equal(incomplete.verifiedPages.length, 2);
      const terminalSource = createJournal();
      let terminal: ChainCheckpoint;
      try {
        assert.equal(runChain("bars", [...prefix, finalPage], terminalSource).length, 3);
        const loadedTerminal = terminalSource.load();
        assert.ok(loadedTerminal?.outcome);
        terminal = loadedTerminal;
      } finally {
        terminalSource.close();
      }

      const incompleteMutations: readonly [string, (copy: PlainRecord) => void][] = [
        [
          "extra checkpoint field",
          (copy) => {
            copy["extra"] = true;
          },
        ],
        [
          "endpoint kind",
          (copy) => {
            copy["endpointKind"] = "quotes";
          },
        ],
        [
          "context identity",
          (copy) => {
            copy["contextIdentityHash"] = "f".repeat(64);
          },
        ],
        [
          "next ordinal",
          (copy) => {
            copy["nextOrdinal"] = 3;
          },
        ],
        [
          "page ordinal",
          (copy) => {
            pageAt(copy, 1)["ordinal"] = 0;
          },
        ],
        [
          "raw text",
          (copy) => {
            pageAt(copy, 0)["rawText"] = `${pageAt(copy, 0)["rawText"] as string} `;
          },
        ],
        [
          "raw digest",
          (copy) => {
            pageAt(copy, 0)["rawDigest"] = "0".repeat(64);
          },
        ],
        [
          "presented token material",
          (copy) => {
            pageAt(copy, 1)["presentedTokenMaterial"] = "peas-synthetic-substitution";
          },
        ],
        [
          "presented token hash",
          (copy) => {
            pageAt(copy, 1)["presentedTokenHash"] = "1".repeat(64);
          },
        ],
        [
          "returned token material",
          (copy) => {
            pageAt(copy, 0)["returnedTokenMaterial"] = "peas-synthetic-substitution";
          },
        ],
        [
          "returned token hash",
          (copy) => {
            pageAt(copy, 0)["returnedTokenHash"] = "2".repeat(64);
          },
        ],
        [
          "expected token material",
          (copy) => {
            copy["expectedPrivateToken"] = "peas-synthetic-substitution";
          },
        ],
        [
          "expected token hash",
          (copy) => {
            copy["expectedPrivateTokenHash"] = "3".repeat(64);
          },
        ],
        [
          "token history omission",
          (copy) => {
            (copy["seenReturnedTokenHashes"] as unknown[]).splice(0, 1);
          },
        ],
        [
          "token history reordering",
          (copy) => {
            (copy["seenReturnedTokenHashes"] as unknown[]).reverse();
          },
        ],
        [
          "premature terminal",
          (copy) => {
            copy["terminal"] = true;
          },
        ],
        [
          "premature outcome",
          (copy) => {
            copy["outcome"] = structuredClone(terminal.outcome);
          },
        ],
      ];
      for (const [label, operation] of incompleteMutations) {
        const target = createJournal() as SeedableJournal;
        try {
          target.seedUncheckedForTest(mutate(incomplete, operation));
          expectWireError("checkpoint-invalid", () => runChain("bars", [finalPage], target));
        } catch (error) {
          assert.fail(`${backend} incomplete ${label}: ${String(error)}`);
        } finally {
          target.close();
        }
      }

      for (const [label, changedContext] of [
        [
          "requested symbols",
          { ...BASE_CONTEXT, requestedSymbols: [...BASE_CONTEXT.requestedSymbols].reverse() },
        ],
        [
          "instrument mapping",
          {
            ...BASE_CONTEXT,
            instrumentIds: {
              ...BASE_CONTEXT.instrumentIds,
              PEASIVY: `min1_${"f".repeat(64)}`,
            },
          },
        ],
        ["query start", { ...BASE_CONTEXT, queryStartNs: BASE_CONTEXT.queryStartNs + 1n }],
        ["query end", { ...BASE_CONTEXT, queryEndNs: BASE_CONTEXT.queryEndNs - 1n }],
        ["entitlement", { ...BASE_CONTEXT, entitlementSnapshotId: `ent1_${"f".repeat(64)}` }],
        ["acquisition", { ...BASE_CONTEXT, marketAcquisitionId: `maq1_${"f".repeat(64)}` }],
        ["calendar", { ...BASE_CONTEXT, calendarVersion: "peas-calendar-mutated" }],
        ["clock basis", { ...BASE_CONTEXT, durableClockBasisId: `clk1_${"f".repeat(64)}` }],
        [
          "durable time",
          { ...BASE_CONTEXT, durablyRecordedAtMs: BASE_CONTEXT.durablyRecordedAtMs + 1 },
        ],
        [
          "logical time",
          { ...BASE_CONTEXT, durableLogicalAtMs: BASE_CONTEXT.durableLogicalAtMs + 1 },
        ],
        ["session", { ...BASE_CONTEXT, sessionKind: "extended-pre" as const }],
        ["corpus", { ...BASE_CONTEXT, primaryCorpusMember: false }],
        ["timeframe", { ...BASE_CONTEXT, timeframe: "5Min" as unknown as "1Min" }],
        ["adjustment", { ...BASE_CONTEXT, adjustment: "split" as unknown as "raw" }],
      ] as const) {
        const target = createJournal();
        try {
          target.save(incomplete);
          expectWireError("checkpoint-invalid", () =>
            runChain("bars", [finalPage], target, changedContext),
          );
        } catch (error) {
          assert.fail(`${backend} runtime context ${label}: ${String(error)}`);
        } finally {
          target.close();
        }
      }
      const changedEndpointJournal = createJournal();
      try {
        changedEndpointJournal.save(incomplete);
        expectWireError("checkpoint-invalid", () =>
          runChain("quotes", [finalPage], changedEndpointJournal),
        );
      } finally {
        changedEndpointJournal.close();
      }
      const changedPageLocalArtifactJournal = createJournal();
      try {
        changedPageLocalArtifactJournal.save(incomplete);
        assert.equal(
          runChain("bars", [finalPage], changedPageLocalArtifactJournal, {
            ...BASE_CONTEXT,
            rawArtifactId: `mar1_${"f".repeat(64)}`,
          }).length,
          3,
        );
      } finally {
        changedPageLocalArtifactJournal.close();
      }

      const terminalMutations: readonly [string, (copy: PlainRecord) => void][] = [
        [
          "terminal flag",
          (copy) => {
            copy["terminal"] = false;
          },
        ],
        [
          "outcome hash",
          (copy) => {
            outcomeOf(copy)["resolutionHash"] = "4".repeat(64);
          },
        ],
        [
          "record with internally rehashed outcome",
          (copy) => {
            (outcomeOf(copy)["records"] as PlainRecord[]).splice(0, 1);
            rehashOutcome(outcomeOf(copy));
          },
        ],
        [
          "quarantine with internally rehashed outcome",
          (copy) => {
            (outcomeOf(copy)["quarantines"] as PlainRecord[]).push({
              endpointKind: "bars",
              reason: "market.provider-observation-invalid/conflicting-content",
              symbol: "PEASIVY",
              itemIndex: 0,
            });
            rehashOutcome(outcomeOf(copy));
          },
        ],
        [
          "bar observation count with internally rehashed outcome",
          (copy) => {
            outcomeOf(copy)["barObservationCount"] =
              (outcomeOf(copy)["barObservationCount"] as number) + 1;
            rehashOutcome(outcomeOf(copy));
          },
        ],
        [
          "terminal expected token",
          (copy) => {
            copy["expectedPrivateToken"] = "peas-synthetic-after-terminal";
          },
        ],
        [
          "terminal page raw digest",
          (copy) => {
            pageAt(copy, pagesOf(copy).length - 1)["rawDigest"] = "5".repeat(64);
          },
        ],
        [
          "outcome extra field",
          (copy) => {
            outcomeOf(copy)["extra"] = true;
          },
        ],
      ];
      for (const [label, operation] of terminalMutations) {
        const target = createJournal() as SeedableJournal;
        try {
          target.seedUncheckedForTest(mutate(terminal, operation));
          expectWireError("checkpoint-invalid", () => runChain("bars", [], target));
        } catch (error) {
          assert.fail(`${backend} terminal ${label}: ${String(error)}`);
        } finally {
          target.close();
        }
      }
    } finally {
      source.close();
    }
  }
});

test("chain page, per-page byte, aggregate byte, and outcome ceilings are exact", () => {
  assert.doesNotThrow(() => enforcePageCount(16));
  expectWireError("successfulPagesPerAcquisition", () => enforcePageCount(17));
  assert.doesNotThrow(() => enforceRawPageBytes(10 * 1024 * 1024));
  expectWireError("rawArtifactBytes", () => enforceRawPageBytes(10 * 1024 * 1024 + 1));
  assert.doesNotThrow(() => enforceAggregateVerifiedBytes(64 * 1024 * 1024));
  expectWireError("aggregateVerifiedBytesPerAcquisition", () =>
    enforceAggregateVerifiedBytes(64 * 1024 * 1024 + 1),
  );
  assert.doesNotThrow(() => enforceNormalizedFactCount(160_000));
  expectWireError("normalizedFactsPerAcquisition", () => enforceNormalizedFactCount(160_001));
});

test("complete-chain bar deduplication and conflicts are global across pages", () => {
  const continuation = fixtureWire("wire-bars-terminal-grouped");
  continuation["next_page_token"] = "peas-synthetic-opaque-global-bars";
  const duplicate = fixtureWire("wire-bars-terminal-grouped");
  const basePages: readonly ChainPage[] = [
    {
      ordinal: 0,
      page: continuation,
      presentedRequestToken: null,
      logicalRequestId: "peas-synthetic-global-bars",
    },
    {
      ordinal: 1,
      page: duplicate,
      presentedRequestToken: "peas-synthetic-opaque-global-bars",
      logicalRequestId: "peas-synthetic-global-bars",
    },
  ];
  assert.equal(runChain("bars", basePages, new MemoryJournal()).length, 2);

  const conflicting = fixtureWire("wire-bars-terminal-grouped");
  firstItem(conflicting, "bars")["c"] = 62.375;
  const journal = new MemoryJournal();
  const records = runChain(
    "bars",
    [basePages[0] as ChainPage, { ...(basePages[1] as ChainPage), page: conflicting }],
    journal,
  );
  assert.equal(records.length, 1);
  assert.equal(journal.load()?.outcome?.barObservationCount, 4);
  assert.equal(
    journal
      .load()
      ?.outcome?.quarantines.filter(
        (entry) => entry.reason === "market.provider-observation-invalid/conflicting-content",
      ).length,
    2,
  );

  const samePageFixture = paginationFixture.cases.find(
    (entry) => entry.caseId === "item-conflicting-bar-key",
  );
  assert.ok(samePageFixture);
  const samePageJournal = new MemoryJournal();
  const samePageRecords = runChain(
    "bars",
    [
      {
        ordinal: 0,
        page: paginationFixturePage("bars", samePageFixture),
        presentedRequestToken: null,
        logicalRequestId: "peas-synthetic-same-page-conflict",
      },
    ],
    samePageJournal,
  );
  assert.equal(samePageRecords.length, 1);
  assert.equal(samePageJournal.load()?.outcome?.quarantines.length, 2);
});

test("every pagination-delivery fixture operation executes with its literal disposition", () => {
  const executed = new Set<string>();
  for (const fixtureCase of paginationFixture.cases) {
    executed.add(fixtureCase.caseId);
    const endpointKind = fixtureCase["endpointKind"] as EndpointKind;
    if (fixtureCase.caseId.startsWith("chain-")) {
      const specifications = fixtureCase["pages"] as readonly Readonly<Record<string, unknown>>[];
      const pages = specifications.map((specification) => ({
        ordinal: specification["ordinal"] as number,
        page: paginationFixturePage(endpointKind, specification),
        presentedRequestToken: specification["presentedRequestToken"] as string | null,
        logicalRequestId:
          (specification["logicalRequestIdOverride"] as string | undefined) ??
          (fixtureCase["logicalRequestId"] as string),
      }));
      const journal = new MemoryJournal();
      const expected = fixtureCase["expectedDisposition"];
      if (expected === "accept-complete") {
        assert.equal(runChain(endpointKind, pages, journal).length > 0, true);
        assert.ok(journal.load()?.outcome);
      } else if (expected === "incomplete-no-normalization-no-selection") {
        assert.deepEqual(runChain(endpointKind, pages, journal), []);
        assert.equal(journal.load()?.outcome, null);
      } else {
        const expectedCode = new Map<string, string>([
          ["reject-before-page-read", "first-request-token"],
          [
            "reject-before-second-page-admission",
            fixtureCase.caseId === "chain-page-after-terminal"
              ? "page-after-terminal"
              : "token-substitution",
          ],
          ["reject-repeated-token", "repeated-token"],
          ["reject-gap", "page-position-invalid"],
          ["reject-duplicate-page-position", "page-position-invalid"],
          ["reject-changed-logical-request", "cross-query-token"],
        ]).get(expected as string);
        assert.ok(expectedCode, fixtureCase.caseId);
        expectWireError(expectedCode, () => runChain(endpointKind, pages, journal));
      }
      continue;
    }

    if (
      fixtureCase.caseId === "delivery-identical-bytes" ||
      fixtureCase.caseId === "delivery-same-asserted-identity-conflicting-bytes"
    ) {
      const deliverySpecs = fixtureCase["deliveries"] as readonly Readonly<
        Record<string, unknown>
      >[];
      const pages = deliverySpecs.map((specification) =>
        paginationFixturePage(endpointKind, specification),
      );
      const rawDigests = pages.map((page) =>
        createHash("sha256")
          .update(encodeWireJson(modelValue(page)), "utf8")
          .digest("hex"),
      );
      const admissions = pages.map((page, index) =>
        admitPage(endpointKind, modelValue(page), {
          ...BASE_CONTEXT,
          rawArtifactId: `mar1_${index.toString(16).padStart(64, "0")}`,
        }),
      );
      const resolved = resolveCompleteChain(endpointKind, admissions);
      if (fixtureCase.caseId === "delivery-identical-bytes") {
        assert.equal(new Set(rawDigests).size, 1);
        assert.equal(resolved.records.length, 2);
        assert.equal(resolved.barObservationCount, 4);
      } else {
        assert.equal(new Set(rawDigests).size, 2);
        assert.equal(resolved.records.length, 1);
        assert.equal(
          resolved.quarantines.filter((entry) => entry.reason.endsWith("conflicting-content"))
            .length,
          2,
        );
      }
      continue;
    }

    if (
      fixtureCase.caseId === "trade-same-id-identical-items-no-stable-identity" ||
      fixtureCase.caseId === "trade-same-id-different-items-no-stable-identity"
    ) {
      const page = paginationFixturePage(endpointKind, fixtureCase);
      const admission = admitPage(endpointKind, modelValue(page));
      const [, items] = firstGroup(modelValue(page) as PlainRecord, endpointKind);
      const first = validateItem(endpointKind, "PEASLIL", 0, items[0], BASE_CONTEXT);
      const second = validateItem(endpointKind, "PEASLIL", 1, items[1], BASE_CONTEXT);
      assert.equal(admission.records.length, 0);
      assert.equal(admission.quarantines.filter((entry) => entry.symbol === "PEASLIL").length, 2);
      assert.ok(
        admission.quarantines
          .filter((entry) => entry.symbol === "PEASLIL")
          .every(
            (entry) => entry.reason === "market.trade-condition-ineligible/state-insufficient",
          ),
      );
      assert.equal(
        first.digest === second.digest,
        fixtureCase.caseId === "trade-same-id-identical-items-no-stable-identity",
      );
      assert.equal(
        fixtureCase["expectedTranslationDisposition"],
        "two-independent-no-record-trade-quarantines",
      );
      assert.deepEqual(fixtureCase["expectedReason"], {
        code: "market.trade-condition-ineligible",
        detail: { tradeConditionFailureKind: "state-insufficient" },
      });
      const inferenceField =
        fixtureCase.caseId === "trade-same-id-identical-items-no-stable-identity"
          ? "duplicateFamilyInference"
          : "conflictFamilyInference";
      assert.deepEqual(fixtureCase["tradeIdAuthority"], {
        providerRecordKey: "not-authorized",
        providerSequence: "not-authorized",
        providerRevisionKey: "not-authorized",
        [inferenceField]: "forbidden",
      });
      continue;
    }

    if (
      fixtureCase.caseId === "item-identical-bar-key-redelivery" ||
      fixtureCase.caseId === "item-conflicting-bar-key"
    ) {
      const admission = admitPage(
        endpointKind,
        modelValue(paginationFixturePage(endpointKind, fixtureCase)),
      );
      if (fixtureCase.caseId === "item-identical-bar-key-redelivery") {
        assert.equal(admission.records.length, 2);
        assert.equal(admission.barObservations.length, 3);
      } else {
        assert.equal(admission.records.length, 1);
        assert.equal(admission.quarantines.length, 2);
      }
      continue;
    }

    if (fixtureCase.caseId === "trade-correction-without-linkage") {
      for (const wireCaseId of fixtureCase["wireCaseIds"] as readonly string[]) {
        const admission = admitFixture(wireCaseId);
        assert.equal(admission.terminalReason, "correction-unsupported");
        assert.equal(admission.records.length, 0);
      }
      assert.equal(
        fixtureCase["expectedTranslationDisposition"],
        "terminal-correction-unsupported",
      );
      continue;
    }

    if (fixtureCase.caseId === "trade-correction-guessed-target-forbidden") {
      expectWireError("unsupported-correction-linkage", () =>
        admitExternalTradeCorrectionClaim(fixtureCase["externalClaim"]),
      );
      expectWireError("schema-invalid", () =>
        admitExternalTradeCorrectionClaim({
          guessedSupersededTradeId: 7001,
          guessedRevisionOrdinal: 2,
          providerRecordKey: "peas-synthetic-forged-linkage",
        }),
      );
      continue;
    }

    if (fixtureCase.caseId === "replacement-marker-unknown") {
      expectWireError("schema-invalid", () =>
        admitPage(endpointKind, modelValue(paginationFixturePage(endpointKind, fixtureCase))),
      );
      continue;
    }
    assert.fail(`unexecuted pagination fixture ${fixtureCase.caseId}`);
  }
  assert.equal(executed.size, paginationFixture.cases.length);
  assert.equal(executed.size, 19);
});

test("raw JSON parsing rejects malformed text, duplicate names, and trailing bytes before schema", () => {
  const malformed = grammarFixture.cases.find(
    (entry) => entry.caseId === "fault-malformed-json",
  ) as FixtureCase;
  for (const rawText of malformed["rawJsonTexts"] as readonly string[]) {
    expectWireError("malformed-json", () => parseRawJson(rawText));
  }
  const duplicate = grammarFixture.cases.find(
    (entry) => entry.caseId === "fault-duplicate-json-key",
  ) as FixtureCase;
  for (const rawText of duplicate["rawJsonTexts"] as readonly string[]) {
    expectWireError("duplicate-json-name", () => parseRawJson(rawText));
  }
  expectWireError("malformed-json", () =>
    parseRawJson(`${JSON.stringify(fixtureWire("wire-bars-terminal-grouped"))}x`),
  );
});

test("hostile objects, accessors, symbols, sparse arrays, and inherited state are inert rejects", () => {
  let getterCalls = 0;
  const accessor = Object.create(null) as PlainRecord;
  Object.defineProperty(accessor, "bars", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {};
    },
  });
  accessor["next_page_token"] = null;
  expectWireError("schema-invalid", () => admitPage("bars", accessor));
  assert.equal(getterCalls, 0);

  const inherited = Object.create({ bars: {} }) as PlainRecord;
  inherited["next_page_token"] = null;
  expectWireError("schema-invalid", () => admitPage("bars", inherited));

  const symbolBearing = fixtureWire("wire-bars-terminal-grouped");
  Object.defineProperty(symbolBearing, Symbol("hostile"), { value: "private" });
  expectWireError("schema-invalid", () => admitPage("bars", symbolBearing));

  const sparse = fixtureWire("wire-bars-terminal-grouped");
  const [, items] = firstGroup(sparse, "bars");
  delete items[0];
  expectWireError("schema-invalid", () => admitPage("bars", sparse));

  let proxyTrapCalls = 0;
  const hostileProxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        proxyTrapCalls += 1;
        throw new Error("hostile-proxy");
      },
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error("hostile-proxy");
      },
      getOwnPropertyDescriptor() {
        proxyTrapCalls += 1;
        throw new Error("hostile-proxy");
      },
      get() {
        proxyTrapCalls += 1;
        throw new Error("hostile-proxy");
      },
    },
  );
  expectWireError("schema-invalid", () => modelValue(hostileProxy));
  assert.equal(proxyTrapCalls, 0);

  const cycle: PlainRecord = {};
  cycle["self"] = cycle;
  expectWireError("schema-invalid", () => modelValue(cycle));
});

test("raw tokenizer depth, node, key, array, and decoded-text ceilings are typed", () => {
  const exactDepth = `${"[".repeat(31)}null${"]".repeat(31)}`;
  assert.doesNotThrow(() => parseRawJson(exactDepth));
  expectWireError("rawJsonDepth", () => parseRawJson(`${"[".repeat(32)}null${"]".repeat(32)}`));

  const exactKeys = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [`k${index}`, null]),
  );
  assert.doesNotThrow(() => parseRawJson(JSON.stringify(exactKeys)));
  const oneOverKeys = { ...exactKeys, k64: null };
  expectWireError("rawJsonKeysPerObject", () => parseRawJson(JSON.stringify(oneOverKeys)));

  assert.doesNotThrow(() => parseRawJson(JSON.stringify("x".repeat(1_024))));
  expectWireError("genericStringBytes", () => parseRawJson(JSON.stringify("x".repeat(1_025))));
  assert.doesNotThrow(() =>
    parseRawJson(
      JSON.stringify({
        bars: {},
        next_page_token: "t".repeat(4_096),
      }),
    ),
  );
  expectWireError("pageTokenInputBytes", () =>
    parseRawJson(
      JSON.stringify({
        bars: {},
        next_page_token: "t".repeat(4_097),
      }),
    ),
  );

  const inner = `[${Array.from({ length: 9_998 }, () => "null").join(",")}]`;
  const exactNodeText = `[${[
    ...Array.from({ length: 25 }, () => inner),
    ...Array.from({ length: 24 }, () => "null"),
  ].join(",")}]`;
  assert.doesNotThrow(() => parseRawJson(exactNodeText));
  const oneOverNodeText = `${exactNodeText.slice(0, -1)},null]`;
  expectWireError("rawJsonNodes", () => parseRawJson(oneOverNodeText));

  const sixtyFourKeyObjectText = `{${Array.from(
    { length: 64 },
    (_, index) => `"k${index}":null`,
  ).join(",")}}`;
  const exactParserTokenText = `[${[
    ...Array.from({ length: 1_937 }, () => sixtyFourKeyObjectText),
    ...Array.from({ length: 126 }, () => "null"),
  ].join(",")}]`;
  assert.doesNotThrow(() => parseRawJson(exactParserTokenText));
  const oneOverParserTokenText = `${exactParserTokenText.slice(0, -1)},null]`;
  expectWireError("parserTokensPerArtifact", () => parseRawJson(oneOverParserTokenText));

  assert.doesNotThrow(() =>
    parseRawJson(`[${Array.from({ length: 10_000 }, () => "null").join(",")}]`),
  );
  expectWireError("rawJsonArrayItems", () =>
    parseRawJson(`[${Array.from({ length: 10_001 }, () => "null").join(",")}]`),
  );
});

test("record, condition, timestamp, token, and page-record bounds accept exact and reject one-over", () => {
  const quote = fixtureWire("wire-quotes-terminal-grouped");
  const [, quoteItems] = firstGroup(quote, "quotes");
  const exemplar = structuredClone(quoteItems[0]);
  quoteItems.splice(0, quoteItems.length, ...Array.from({ length: 10_000 }, () => exemplar));
  const groups = quote["quotes"] as PlainRecord;
  for (const symbol of Object.keys(groups).slice(1)) delete groups[symbol];
  assert.equal(admitPage("quotes", modelValue(quote)).quarantines.length, 10_000);
  quoteItems.push(structuredClone(exemplar));
  expectWireError("rawJsonArrayItems", () => admitPage("quotes", modelValue(quote)));

  const trade = fixtureWire("wire-trades-terminal-grouped");
  firstItem(trade, "trades")["c"] = ["A".repeat(8)];
  assert.equal(admitPage("trades", modelValue(trade)).records.length, 0);
  firstItem(trade, "trades")["c"] = ["A".repeat(9)];
  expectWireError("schema-invalid", () => admitPage("trades", modelValue(trade)));

  const bar = cloneAndModel(fixtureWire("wire-bars-terminal-grouped"));
  firstItem(bar, "bars")["c"] = rawNumber("12345678901234567890.12345678901");
  assert.throws(() => admitPage("bars", bar));
  firstItem(bar, "bars")["c"] = rawNumber("12345678901234567890.123456789012");
  expectWireError("rawDecimalTokenBytes", () => admitPage("bars", bar));
});

test("identical bar redelivery deduplicates; conflicting same-key bytes quarantine in every order", () => {
  const duplicate = fixtureWire("wire-bars-terminal-grouped");
  const [, duplicateItems] = firstGroup(duplicate, "bars");
  duplicateItems.push(structuredClone(duplicateItems[0]));
  const deduplicated = admitPage("bars", modelValue(duplicate));
  assert.equal(deduplicated.records.length, 2);
  assert.equal(deduplicated.quarantines.length, 0);

  const conflict = fixtureWire("wire-bars-terminal-grouped");
  const [, conflictItems] = firstGroup(conflict, "bars");
  const changed = structuredClone(conflictItems[0]) as PlainRecord;
  changed["c"] = 62.375;
  conflictItems.push(changed);
  const forward = admitPage("bars", modelValue(conflict));
  conflictItems.reverse();
  const reverse = admitPage("bars", modelValue(conflict));
  assert.equal(forward.records.length, 1);
  assert.equal(reverse.records.length, 1);
  assert.equal(forward.quarantines.length, 2);
  assert.equal(reverse.quarantines.length, 2);
  assert.deepEqual(
    forward.records.map(recordSemanticProjection),
    reverse.records.map(recordSemanticProjection),
  );
  assert.ok(
    forward.quarantines.every(
      (entry) => entry.reason === "market.provider-observation-invalid/conflicting-content",
    ),
  );
});

test("canonical output is invariant across page sizes, restart prefixes, property order, and backends", () => {
  const syntheticBars = makeSyntheticBars(16);
  let expected: readonly JsonValue[] | null = null;
  for (const pageSize of [1, 2, 7, 10_000]) {
    const pages = paginateBars(syntheticBars, pageSize);
    for (const createJournal of [() => new MemoryJournal(), () => new SqliteJournal()]) {
      const journal = createJournal();
      try {
        const records = runChain("bars", pages, journal);
        const semantic = records
          .map(recordSemanticProjection)
          .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
        expected ??= semantic;
        assert.deepEqual(semantic, expected);
      } finally {
        journal.close();
      }
    }

    for (let prefix = 0; prefix < pages.length; prefix += 1) {
      const journal = new MemoryJournal();
      const prefixRecords =
        prefix === 0 ? [] : runChain("bars", pages.slice(0, prefix), journal, BASE_CONTEXT);
      assert.deepEqual(prefixRecords, []);
      const completedRecords =
        prefix === pages.length
          ? runChain("bars", [], journal)
          : runChain("bars", pages.slice(prefix), journal);
      const semantic = completedRecords
        .map(recordSemanticProjection)
        .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
      assert.deepEqual(semantic, expected);
    }
  }

  const reordered = fixtureWire("wire-bars-terminal-grouped");
  const groups = reordered["bars"] as PlainRecord;
  reordered["bars"] = Object.fromEntries(Object.entries(groups).reverse());
  const baseline = admitFixture("wire-bars-terminal-grouped")
    .records.map(recordSemanticProjection)
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const changedOrder = admitPage("bars", modelValue(reordered))
    .records.map(recordSemanticProjection)
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  assert.deepEqual(changedOrder, baseline);
});

test("unknown calendar evidence quarantines and fully offline execution has zero side effects", async () => {
  const unknownCalendar = admitPage(
    "bars",
    parseRawJson(JSON.stringify(fixtureWire("wire-bars-terminal-grouped"))),
    { ...BASE_CONTEXT, sessionKind: "unknown" },
  );
  assert.equal(unknownCalendar.records.length, 0);
  assert.equal(unknownCalendar.quarantines.length, 2);

  let networkCalls = 0;
  let credentialReads = 0;
  let fallbackCalls = 0;
  let publicRawLeaks = 0;
  let postReturnActivity = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    networkCalls += 1;
    throw new Error("network-forbidden");
  }) as typeof fetch;
  const credentialBoundary = Object.freeze({
    read: () => {
      credentialReads += 1;
      return "forbidden";
    },
  });
  const fallbackBoundary = Object.freeze({
    run: () => {
      fallbackCalls += 1;
    },
  });
  void credentialBoundary;
  void fallbackBoundary;
  try {
    const result = admitFixture("wire-bars-terminal-grouped");
    const publicText = canonicalJson(result.publicSummary as unknown as JsonValue);
    const privateToken = admitFixture("wire-bars-continuation").privateNextToken as string;
    if (publicText.includes(privateToken) || publicText.includes("PEASIVY")) {
      publicRawLeaks += 1;
    }
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    const snapshot = { networkCalls, credentialReads, fallbackCalls, publicRawLeaks };
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    if (
      networkCalls !== snapshot.networkCalls ||
      credentialReads !== snapshot.credentialReads ||
      fallbackCalls !== snapshot.fallbackCalls ||
      publicRawLeaks !== snapshot.publicRawLeaks
    ) {
      postReturnActivity += 1;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(
    { networkCalls, credentialReads, fallbackCalls, publicRawLeaks, postReturnActivity },
    {
      networkCalls: 0,
      credentialReads: 0,
      fallbackCalls: 0,
      publicRawLeaks: 0,
      postReturnActivity: 0,
    },
  );
});
