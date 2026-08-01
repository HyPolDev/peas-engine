import { Buffer } from "node:buffer";
import { isProxy } from "node:util/types";

import { canonicalHash } from "../../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../../core/json.js";
import {
  SIGNED_NS_MAX,
  SIGNED_NS_MIN,
  type CanonicalDecimalV1,
  type MarketTimestampV1,
  type RecordedMarketRecordV1,
} from "../../../providers/market-reference/contracts.js";
import {
  canonicalDecimalFromToken,
  deriveCanonicalProviderPayloadDigest,
} from "../../../providers/market-reference/normalization.js";
import {
  TERMINAL_TOKEN_HASH,
  derivePrivateTokenHash,
  type JournalEntry,
  type JournalIdentityInput,
  validateJournalEntries,
} from "../journal.js";

export type AlpacaWireEndpointKind = "quotes" | "trades" | "bars";
type PlainRecord = Record<string, unknown>;
type RawNumber = Readonly<{ rawNumber: string }>;

export type AlpacaWireTimestamp = Readonly<{
  timestamp: MarketTimestampV1;
  canonicalUtc: string;
  fractionalDigits: number;
}>;

export type AlpacaWireQuarantine = Readonly<{
  endpointKind: AlpacaWireEndpointKind;
  reason: string;
  symbol: string;
  itemIndex: number;
}>;

export type AlpacaBarObservation = Readonly<{
  logicalKey: string;
  wireDigest: string;
  symbol: string;
  itemIndex: number;
  record: RecordedMarketRecordV1 | null;
  quarantineReason: string | null;
}>;

export type AlpacaWirePageAdmission = Readonly<{
  endpointKind: AlpacaWireEndpointKind;
  marketAcquisitionId: string;
  rawArtifactId: string;
  wireItemCount: number;
  terminal: boolean;
  privateNextToken: string | null;
  records: readonly RecordedMarketRecordV1[];
  quarantines: readonly AlpacaWireQuarantine[];
  barObservations: readonly AlpacaBarObservation[];
  terminalReason: "correction-unsupported" | null;
  terminalItemDigest: string | null;
  publicSummary: Readonly<{
    endpointKind: AlpacaWireEndpointKind;
    recordCount: number;
    quarantineCount: number;
    terminalReason: "correction-unsupported" | null;
  }>;
}>;

export type AlpacaWireChainResolution = Readonly<{
  records: readonly RecordedMarketRecordV1[];
  quarantines: readonly AlpacaWireQuarantine[];
  terminalReason: "correction-unsupported" | null;
  barObservationCount: number;
}>;

export type AlpacaWireParseContext = Readonly<{
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

export class AlpacaWireContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AlpacaWireContractError";
  }
}

const reject = (code: string): never => {
  throw new AlpacaWireContractError(code);
};

export const ALPACA_WIRE_IDS = Object.freeze({
  providerId: "mpv1_7a0d9dbb0982daebfdc6986ef4903b3c6388f83cbafa6c1b7af8bf92b5ec6d9c",
  datasetId: "mds1_d18d90386ef7b3ddff114dc552ca4561a3ee613f3bc501e60491e81d85f734d1",
  feedId: "mfd1_79bf3edbf4b7d87ab16edadaafca55d991bdc6962294abc2998f240838483023",
  quotes: "mec1_c0af047d911436c6c0f73a164885e07c6e5976d217b4f4c8b8dd0db17d14e4f0",
  trades: "mec1_9f2e99ba4973554bb26e71e722bf5367db20173a49a08f2ea45d227d44af0cf1",
  bars: "mec1_016928912d87c2fd5ae5eae163752f363d7b8deba66f4b08753cf9d80c891c9c",
} as const);

const DATA_FIELD = Object.freeze({ quotes: "quotes", trades: "trades", bars: "bars" });
const ITEM_FIELDS = Object.freeze({
  quotes: Object.freeze(["t", "bx", "bp", "bs", "ap", "as", "ax", "c", "z"]),
  trades: Object.freeze(["t", "i", "x", "p", "s", "c", "z"]),
  bars: Object.freeze(["t", "o", "h", "l", "c", "v", "n", "vw"]),
});
const LIMITS = Object.freeze({
  depth: 32,
  nodes: 250_000,
  keysPerObject: 64,
  arrayItems: 10_000,
  parserTokens: 250_000,
  genericStringBytes: 1_024,
  pageTokenBytes: 4_096,
  numberTokenBytes: 32,
});

function rawNumber(raw: string): RawNumber {
  return Object.freeze({ rawNumber: raw });
}

function isRawNumber(value: unknown): value is RawNumber {
  if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value)) {
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  const descriptor = descriptors["rawNumber"];
  return (
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    keys.length === 1 &&
    keys[0] === "rawNumber" &&
    descriptor !== undefined &&
    "value" in descriptor &&
    descriptor.enumerable === true &&
    typeof descriptor.value === "string"
  );
}

function assertPlainRecord(value: unknown): asserts value is PlainRecord {
  if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value)) {
    reject("schema-invalid");
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) reject("schema-invalid");
    if (Object.getOwnPropertySymbols(value).length !== 0) reject("schema-invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length > LIMITS.keysPerObject) reject("rawJsonKeysPerObject");
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "__proto__" || !("value" in descriptor) || descriptor.enumerable !== true) {
        reject("schema-invalid");
      }
    }
  } catch (error) {
    if (error instanceof AlpacaWireContractError) throw error;
    reject("schema-invalid");
  }
}

function assertDenseArray(value: unknown): asserts value is unknown[] {
  if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value)) {
    reject("schema-invalid");
  }
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) reject("schema-invalid");
    if (Object.getOwnPropertySymbols(value).length !== 0) reject("schema-invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors["length"];
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      reject("schema-invalid");
    }
    const length = (lengthDescriptor as PropertyDescriptor & { value: number }).value;
    if (length > LIMITS.arrayItems) reject("rawJsonArrayItems");
    if (Object.keys(descriptors).length !== length + 1) reject("schema-invalid");
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        reject("schema-invalid");
      }
    }
  } catch (error) {
    if (error instanceof AlpacaWireContractError) throw error;
    reject("schema-invalid");
  }
}

function exactKeys(
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

function compareUnsignedUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** Bounded tokenizer retaining every JSON number lexeme and rejecting duplicate names. */
export function parseAlpacaHistoricalJson(text: string): unknown {
  let offset = 0;
  let nodes = 0;
  let tokens = 0;
  const countNode = (depth: number): void => {
    if (depth > LIMITS.depth) reject("rawJsonDepth");
    nodes += 1;
    tokens += 1;
    if (nodes > LIMITS.nodes) reject("rawJsonNodes");
    if (tokens > LIMITS.parserTokens) reject("parserTokensPerArtifact");
  };
  const whitespace = (): void => {
    while (/^[\t\n\r ]$/u.test(text[offset] ?? "")) offset += 1;
  };
  const parseString = (maximumBytes: number = LIMITS.genericStringBytes): string => {
    if (text[offset] !== '"') reject("malformed-json");
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset] as string;
      if (character.charCodeAt(0) < 0x20) reject("malformed-json");
      if (character === '"') {
        let backslashes = 0;
        for (let cursor = offset - 1; cursor > start && text[cursor] === "\\"; cursor -= 1) {
          backslashes += 1;
        }
        if (backslashes % 2 === 0) {
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
          const decodedString = decoded as string;
          if (utf8Bytes(decodedString) > maximumBytes) {
            reject(
              maximumBytes === LIMITS.pageTokenBytes ? "pageTokenInputBytes" : "genericStringBytes",
            );
          }
          return decodedString;
        }
      }
      offset += 1;
    }
    return reject("malformed-json");
  };
  const parseValue = (depth: number, maximumStringBytes?: number): unknown => {
    countNode(depth);
    whitespace();
    const character = text[offset];
    if (character === '"') return parseString(maximumStringBytes);
    if (character === "{") {
      offset += 1;
      const result = Object.create(null) as PlainRecord;
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
        if (tokens > LIMITS.parserTokens) reject("parserTokensPerArtifact");
        if (names.has(name)) reject("duplicate-json-name");
        names.add(name);
        if (names.size > LIMITS.keysPerObject) reject("rawJsonKeysPerObject");
        whitespace();
        if (text[offset] !== ":") reject("malformed-json");
        offset += 1;
        result[name] = parseValue(
          depth + 1,
          name === "next_page_token" ? LIMITS.pageTokenBytes : undefined,
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
        if (result.length >= LIMITS.arrayItems) reject("rawJsonArrayItems");
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
    if (error instanceof AlpacaWireContractError) throw error;
    return reject("malformed-json");
  }
}

export function decodeAlpacaHistoricalJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return reject("schema-invalid");
  }
  return parseAlpacaHistoricalJson(text);
}

function floorDiv(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value % divisor < 0n ? quotient - 1n : quotient;
}

export function parseAlpacaWireTimestamp(value: unknown): AlpacaWireTimestamp {
  if (typeof value !== "string" || utf8Bytes(value) > 64) reject("market.timestamp-invalid");
  const text = value as string;
  const match = text.match(
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})$/u,
  );
  if (match === null) reject("market.timestamp-invalid");
  const parts = match as RegExpMatchArray;
  const [, y, mo, d, h, mi, s, fraction = "", zone] = parts;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (year === 0 || hour > 23 || minute > 59 || second > 59) reject("market.timestamp-invalid");
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() + 1 !== month ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  )
    reject("market.timestamp-invalid");
  const zoneText = zone ?? reject("market.timestamp-invalid");
  let offsetMinutes = 0;
  if (zoneText !== "Z") {
    const zoneHour = Number(zoneText.slice(1, 3));
    const zoneMinute = Number(zoneText.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59 || zoneText === "-00:00")
      reject("market.timestamp-invalid");
    offsetMinutes = (zoneText[0] === "+" ? 1 : -1) * (zoneHour * 60 + zoneMinute);
  }
  const epochNs =
    BigInt(local.getTime() / 1_000 - offsetMinutes * 60) * 1_000_000_000n +
    BigInt(fraction.padEnd(9, "0") || "0");
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
  const canonicalUtc = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${renderedFraction}Z`;
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
  if (Buffer.byteLength(token, "ascii") > LIMITS.numberTokenBytes) reject("rawDecimalTokenBytes");
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
  const parsed = canonicalDecimalFromToken(numberToken(value));
  if (parsed.negative || (!allowZero && parsed.coefficient === "0")) reject("schema-invalid");
  return parsed;
}

function compareDecimal(left: CanonicalDecimalV1, right: CanonicalDecimalV1): number {
  const scale = Math.max(left.scale, right.scale);
  const l = BigInt(left.coefficient) * 10n ** BigInt(scale - left.scale);
  const r = BigInt(right.coefficient) * 10n ** BigInt(scale - right.scale);
  return l < r ? -1 : l > r ? 1 : 0;
}

function nonemptyAscii(value: unknown, maximumBytes = 8): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[\x20-\x7e]+$/u.test(value) ||
    Buffer.byteLength(value, "ascii") > maximumBytes
  )
    reject("schema-invalid");
  return value as string;
}

function conditions(value: unknown, endpointKind: "quotes" | "trades"): readonly string[] {
  assertDenseArray(value);
  if (value.length > 8) reject("conditionMembers");
  if (endpointKind === "quotes" && value.length !== 1 && value.length !== 2)
    reject("schema-invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const parsed = Array.from({ length: value.length }, (_, index) =>
    nonemptyAscii((descriptors[String(index)] as PropertyDescriptor & { value: unknown }).value),
  );
  if (new Set(parsed).size !== parsed.length) reject("schema-invalid");
  return Object.freeze(parsed);
}

function tape(value: unknown): "A" | "B" | "C" {
  if (value === "N" || value === "O") reject("market.dataset-feed-mismatch");
  if (value !== "A" && value !== "B" && value !== "C") reject("schema-invalid");
  return value as "A" | "B" | "C";
}

type ValidatedItem =
  | Readonly<{
      kind: "quote";
      symbol: string;
      itemIndex: number;
      timestamp: AlpacaWireTimestamp;
      digest: string;
      contradictory: boolean;
    }>
  | Readonly<{
      kind: "trade";
      symbol: string;
      itemIndex: number;
      timestamp: AlpacaWireTimestamp;
      digest: string;
      update: "canceled" | "incorrect" | "corrected" | null;
    }>
  | Readonly<{
      kind: "bar";
      symbol: string;
      itemIndex: number;
      timestamp: AlpacaWireTimestamp;
      digest: string;
      close: CanonicalDecimalV1;
      barStartNs: bigint;
      barEndNs: bigint;
      contradictory: boolean;
    }>;

function endpointChannelId(kind: AlpacaWireEndpointKind): string {
  return ALPACA_WIRE_IDS[kind];
}

function wireDigest(kind: AlpacaWireEndpointKind, symbol: string, item: JsonValue): string {
  return canonicalHash("peas/p1-10-wire-record/v1", {
    endpointChannelId: endpointChannelId(kind),
    symbolGroupKey: symbol,
    item,
  } as unknown as JsonValue);
}

function validateItem(
  kind: AlpacaWireEndpointKind,
  symbol: string,
  itemIndex: number,
  value: unknown,
  context: AlpacaWireParseContext,
): ValidatedItem {
  assertPlainRecord(value);
  exactKeys(value, ITEM_FIELDS[kind], kind === "trades" ? ["u"] : []);
  const timestamp = parseAlpacaWireTimestamp(value["t"]);
  const epochNs = BigInt(timestamp.timestamp.epochNs);
  if (epochNs < context.queryStartNs || epochNs > context.queryEndNs) reject("schema-invalid");
  if (kind === "quotes") {
    const bx = nonemptyAscii(value["bx"]);
    const ax = nonemptyAscii(value["ax"]);
    const bp = decimal(value["bp"], true);
    const ap = decimal(value["ap"], true);
    const bs = unsignedInteger(value["bs"], 4_294_967_295n);
    const as = unsignedInteger(value["as"], 4_294_967_295n);
    const c = conditions(value["c"], "quotes");
    const z = tape(value["z"]);
    return Object.freeze({
      kind: "quote",
      symbol,
      itemIndex,
      timestamp,
      digest: wireDigest(kind, symbol, {
        t: timestamp.canonicalUtc,
        bx,
        bp,
        bs: bs.toString(),
        ap,
        as: as.toString(),
        ax,
        c,
        z,
      } as unknown as JsonValue),
      contradictory:
        bp.coefficient === "0" ||
        ap.coefficient === "0" ||
        bs === 0n ||
        as === 0n ||
        compareDecimal(bp, ap) > 0,
    });
  }
  if (kind === "trades") {
    const i = unsignedInteger(value["i"], 18_446_744_073_709_551_615n).toString();
    const x = nonemptyAscii(value["x"]);
    const p = decimal(value["p"]);
    const s = unsignedInteger(value["s"], 4_294_967_295n, true).toString();
    const c = conditions(value["c"], "trades");
    const z = tape(value["z"]);
    const present = Object.hasOwn(value, "u");
    const update = value["u"];
    if (present && update !== "canceled" && update !== "incorrect" && update !== "corrected")
      reject("schema-invalid");
    const normalized = present ? (update as "canceled" | "incorrect" | "corrected") : null;
    return Object.freeze({
      kind: "trade",
      symbol,
      itemIndex,
      timestamp,
      digest: wireDigest(kind, symbol, {
        t: timestamp.canonicalUtc,
        i,
        x,
        p,
        s,
        c,
        z,
        u: normalized,
      } as unknown as JsonValue),
      update: normalized,
    });
  }
  if (context.timeframe !== "1Min" || context.adjustment !== "raw") reject("schema-invalid");
  const o = decimal(value["o"]);
  const h = decimal(value["h"]);
  const l = decimal(value["l"]);
  const c = decimal(value["c"]);
  const v = unsignedInteger(value["v"], SIGNED_NS_MAX);
  const n = unsignedInteger(value["n"], SIGNED_NS_MAX);
  const vw = decimal(value["vw"]);
  const barEndNs = epochNs + 60_000_000_000n;
  return Object.freeze({
    kind: "bar",
    symbol,
    itemIndex,
    timestamp,
    digest: wireDigest(kind, symbol, {
      t: timestamp.canonicalUtc,
      o,
      h,
      l,
      c,
      v: v.toString(),
      n: n.toString(),
      vw,
    } as unknown as JsonValue),
    close: c,
    barStartNs: epochNs,
    barEndNs,
    contradictory:
      v === 0n ||
      n === 0n ||
      compareDecimal(l, h) > 0 ||
      compareDecimal(o, l) < 0 ||
      compareDecimal(o, h) > 0 ||
      compareDecimal(c, l) < 0 ||
      compareDecimal(c, h) > 0 ||
      compareDecimal(vw, l) < 0 ||
      compareDecimal(vw, h) > 0 ||
      barEndNs > context.queryEndNs ||
      barEndNs > SIGNED_NS_MAX,
  });
}

function fallbackFamily(
  source: RecordedMarketRecordV1["source"],
  instrumentId: string,
  eventTime: MarketTimestampV1,
  payloadDigest: string,
): string {
  return canonicalHash("peas/market-provider-fallback-family/v1", {
    providerId: source.providerId,
    datasetId: source.datasetId,
    feedId: source.feedId,
    endpointChannelId: source.endpointChannelId,
    entitlementSnapshotId: source.entitlementSnapshotId,
    instrumentId,
    eventKind: "bar",
    eventTime,
    venueTapeId: null,
    providerSequence: null,
    canonicalProviderPayloadDigest: payloadDigest,
  } as unknown as JsonValue);
}

function translateBar(
  item: Extract<ValidatedItem, { kind: "bar" }>,
  context: AlpacaWireParseContext,
): RecordedMarketRecordV1 {
  const instrumentId = context.instrumentIds[item.symbol] ?? reject("schema-invalid");
  const source = Object.freeze({
    providerId: ALPACA_WIRE_IDS.providerId,
    datasetId: ALPACA_WIRE_IDS.datasetId,
    feedId: ALPACA_WIRE_IDS.feedId,
    endpointChannelId: ALPACA_WIRE_IDS.bars,
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
  const eventTime = Object.freeze({ ...item.timestamp.timestamp, semantic: "bar-start" as const });
  const canonicalProviderPayloadDigest = deriveCanonicalProviderPayloadDigest(payload);
  return Object.freeze({
    source,
    instrumentId,
    venueTapeId: null,
    providerRecordKey: null,
    providerRevisionKey: null,
    providerStableRecordFamily: fallbackFamily(
      source,
      instrumentId,
      eventTime,
      canonicalProviderPayloadDigest,
    ),
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
  });
}

/** Admits a tokenizer-created inert page. It never reads a semantic value after a validated trade u. */
export function admitAlpacaHistoricalPage(
  kind: AlpacaWireEndpointKind,
  input: unknown,
  context: AlpacaWireParseContext,
): AlpacaWirePageAdmission {
  assertPlainRecord(input);
  const dataField = DATA_FIELD[kind];
  exactKeys(input, [dataField, "next_page_token"], ["currency"]);
  if (Object.hasOwn(input, "currency") && input["currency"] !== "USD")
    reject("market.currency-unsupported");
  const token = input["next_page_token"];
  if (token !== null && (typeof token !== "string" || token.length === 0)) reject("schema-invalid");
  if (typeof token === "string" && utf8Bytes(token) > LIMITS.pageTokenBytes)
    reject("pageTokenInputBytes");
  const groups = input[dataField];
  assertPlainRecord(groups);
  const groupNames = Object.keys(groups).sort(compareUnsignedUtf8);
  const groupDescriptors = Object.getOwnPropertyDescriptors(groups);
  if (groupNames.length === 0 && token !== null) reject("schema-invalid");
  const membership = new Set(context.requestedSymbols);
  for (const symbol of groupNames) {
    if (
      !/^[\x21-\x7e]{1,32}$/u.test(symbol) ||
      symbol !== symbol.toUpperCase() ||
      !membership.has(symbol) ||
      context.instrumentIds[symbol] === undefined
    )
      reject("schema-invalid");
  }
  let recordCount = 0;
  const validated: ValidatedItem[] = [];
  for (const symbol of groupNames) {
    const items = (groupDescriptors[symbol] as PropertyDescriptor & { value: unknown }).value;
    assertDenseArray(items);
    recordCount += items.length;
    if (recordCount > LIMITS.arrayItems) reject("recordsPerArtifactOrPage");
    const descriptors = Object.getOwnPropertyDescriptors(items);
    let priorNs: bigint | null = null;
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = validateItem(
        kind,
        symbol,
        itemIndex,
        (descriptors[String(itemIndex)] as PropertyDescriptor & { value: unknown }).value,
        context,
      );
      const eventNs = BigInt(item.timestamp.timestamp.epochNs);
      if (priorNs !== null && eventNs < priorNs) reject("schema-invalid");
      priorNs = eventNs;
      if (item.kind === "trade" && item.update !== null) {
        const terminalReason = "correction-unsupported" as const;
        const quarantines = Object.freeze([
          Object.freeze({ endpointKind: kind, reason: terminalReason, symbol, itemIndex }),
        ]);
        return Object.freeze({
          endpointKind: kind,
          marketAcquisitionId: context.marketAcquisitionId,
          rawArtifactId: context.rawArtifactId,
          wireItemCount: recordCount,
          terminal: true,
          privateNextToken: null,
          records: Object.freeze([]),
          quarantines,
          barObservations: Object.freeze([]),
          terminalReason,
          terminalItemDigest: item.digest,
          publicSummary: Object.freeze({
            endpointKind: kind,
            recordCount: 0,
            quarantineCount: 1,
            terminalReason,
          }),
        });
      }
      validated.push(item);
    }
  }
  const ordered = [...validated].sort((left, right) => {
    const symbolOrder = compareUnsignedUtf8(left.symbol, right.symbol);
    if (symbolOrder !== 0) return symbolOrder;
    const l = BigInt(left.timestamp.timestamp.epochNs);
    const r = BigInt(right.timestamp.timestamp.epochNs);
    if (l !== r) return l < r ? -1 : 1;
    return left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0;
  });
  const quarantines: AlpacaWireQuarantine[] = [];
  const records: RecordedMarketRecordV1[] = [];
  const barObservations: AlpacaBarObservation[] = [];
  if (kind === "quotes" || kind === "trades") {
    const reason =
      kind === "quotes"
        ? "market.condition-unknown"
        : "market.trade-condition-ineligible/state-insufficient";
    for (const item of ordered)
      quarantines.push({
        endpointKind: kind,
        reason,
        symbol: item.symbol,
        itemIndex: item.itemIndex,
      });
  } else {
    const bars = ordered.filter(
      (item): item is Extract<ValidatedItem, { kind: "bar" }> => item.kind === "bar",
    );
    const byKey = new Map<string, Extract<ValidatedItem, { kind: "bar" }>[]>();
    for (const bar of bars) {
      const key = `${ALPACA_WIRE_IDS.bars}|${context.instrumentIds[bar.symbol]}|${bar.barStartNs}`;
      const group = byKey.get(key);
      if (group === undefined) byKey.set(key, [bar]);
      else group.push(bar);
    }
    for (const [logicalKey, group] of byKey) {
      const digests = new Set(group.map((item) => item.digest));
      const contradiction =
        group[0]?.contradictory === true ||
        context.sessionKind === "unknown" ||
        context.calendarVersion.length === 0;
      if (digests.size > 1 || contradiction) {
        const reason =
          digests.size > 1
            ? "market.provider-observation-invalid/conflicting-content"
            : "market.provider-observation-invalid/schema-invalid";
        for (const item of group) {
          quarantines.push({
            endpointKind: kind,
            reason,
            symbol: item.symbol,
            itemIndex: item.itemIndex,
          });
          barObservations.push({
            logicalKey,
            wireDigest: item.digest,
            symbol: item.symbol,
            itemIndex: item.itemIndex,
            record: null,
            quarantineReason: reason,
          });
        }
      } else {
        const representative = group[0] ?? reject("schema-invalid");
        const record = translateBar(representative, context);
        records.push(record);
        for (const item of group)
          barObservations.push({
            logicalKey,
            wireDigest: item.digest,
            symbol: item.symbol,
            itemIndex: item.itemIndex,
            record,
            quarantineReason: null,
          });
      }
    }
  }
  const publicSummary = Object.freeze({
    endpointKind: kind,
    recordCount: records.length,
    quarantineCount: quarantines.length,
    terminalReason: null,
  });
  return Object.freeze({
    endpointKind: kind,
    marketAcquisitionId: context.marketAcquisitionId,
    rawArtifactId: context.rawArtifactId,
    wireItemCount: recordCount,
    terminal: token === null,
    privateNextToken: token as string | null,
    records: Object.freeze(records),
    quarantines: Object.freeze(quarantines),
    barObservations: Object.freeze(barObservations),
    terminalReason: null,
    terminalItemDigest: null,
    publicSummary,
  });
}

export function parseAndAdmitAlpacaHistoricalPage(
  kind: AlpacaWireEndpointKind,
  bytes: Uint8Array,
  context: AlpacaWireParseContext,
): AlpacaWirePageAdmission {
  return admitAlpacaHistoricalPage(kind, decodeAlpacaHistoricalJson(bytes), context);
}

function semanticRecordProjection(record: RecordedMarketRecordV1): JsonValue {
  const { rawArtifactId: _rawArtifactId, memberKey: _memberKey, ...semantic } = record;
  return semantic as unknown as JsonValue;
}

/** Resolves only after the verified complete chain; duplicate/conflict decisions are corpus-wide. */
export function resolveAlpacaHistoricalChain(
  endpointKind: AlpacaWireEndpointKind,
  admissions: readonly AlpacaWirePageAdmission[],
  proof: Readonly<{
    journal: readonly JournalEntry[];
    expectedIdentity: JournalIdentityInput;
  }>,
): AlpacaWireChainResolution {
  validateJournalEntries(proof.journal, proof.expectedIdentity);
  if (admissions.some((entry) => entry.endpointKind !== endpointKind)) reject("schema-invalid");
  const pages = proof.journal.filter((entry) => entry.checkpointKind === "page-checkpointed");
  const chainCompletions = proof.journal.filter(
    (entry) => entry.checkpointKind === "chain-complete",
  );
  if (
    admissions.length === 0 ||
    pages.length !== admissions.length ||
    chainCompletions.length !== 1 ||
    proof.journal.at(-1)?.checkpointKind !== "chain-complete"
  ) {
    reject("page-chain-incomplete");
  }
  let terminalCount = 0;
  for (const [index, admission] of admissions.entries()) {
    const page = pages[index] ?? reject("page-chain-incomplete");
    if (
      page.pageOrdinal !== index ||
      page.marketAcquisitionId !== admission.marketAcquisitionId ||
      page.rawArtifactId !== admission.rawArtifactId ||
      !page.admittedMarketAcquisitionIds.includes(admission.marketAcquisitionId) ||
      page.pageRecordCount !== admission.wireItemCount
    ) {
      reject("page-chain-substitution");
    }
    if (admission.terminal) {
      terminalCount += 1;
      if (
        admission.privateNextToken !== null ||
        page.nextTokenHash !== TERMINAL_TOKEN_HASH ||
        page.nextContinuationBindingHash !== null ||
        index !== admissions.length - 1
      ) {
        reject("page-chain-terminal-invalid");
      }
    } else if (
      admission.privateNextToken === null ||
      page.nextTokenHash !== derivePrivateTokenHash(admission.privateNextToken) ||
      page.nextContinuationBindingHash === null
    ) {
      reject("page-chain-continuation-invalid");
    }
  }
  if (terminalCount !== 1 || chainCompletions[0]?.pageOrdinal !== pages.at(-1)?.pageOrdinal) {
    reject("page-chain-terminal-invalid");
  }
  const quarantines = admissions.flatMap((entry) => entry.quarantines);
  const terminalReason = admissions.some(
    (entry) => entry.terminalReason === "correction-unsupported",
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
  const observations = admissions.flatMap((entry) => entry.barObservations);
  const byKey = new Map<string, AlpacaBarObservation[]>();
  for (const observation of observations) {
    const group = byKey.get(observation.logicalKey);
    if (group === undefined) byKey.set(observation.logicalKey, [observation]);
    else group.push(observation);
  }
  const records: RecordedMarketRecordV1[] = [];
  const globalQuarantines = [...quarantines];
  const groups = [...byKey.values()].sort((left, right) =>
    (left[0]?.logicalKey ?? "").localeCompare(right[0]?.logicalKey ?? ""),
  );
  for (const group of groups) {
    if (new Set(group.map((entry) => entry.wireDigest)).size > 1) {
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
    if (group.some((entry) => entry.quarantineReason !== null)) continue;
    const candidates = group
      .flatMap((entry) => (entry.record === null ? [] : [entry.record]))
      .sort((left, right) => {
        const artifactOrder = left.rawArtifactId.localeCompare(right.rawArtifactId);
        return artifactOrder !== 0 ? artifactOrder : left.memberKey.localeCompare(right.memberKey);
      });
    const selected = candidates[0];
    if (selected !== undefined) records.push(selected);
  }
  records.sort((left, right) =>
    canonicalJson(semanticRecordProjection(left)).localeCompare(
      canonicalJson(semanticRecordProjection(right)),
    ),
  );
  return Object.freeze({
    records: Object.freeze(records),
    quarantines: Object.freeze(globalQuarantines),
    terminalReason: null,
    barObservationCount: observations.length,
  });
}
