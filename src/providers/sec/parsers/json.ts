import {
  deepFreezeJson,
  inertJsonSnapshot,
  parseJsonWithinLimits,
  type JsonObject,
  type JsonValue,
} from "../../../core/json.js";
import { SEC_MAX_MEMBER_BYTES } from "../contracts.js";
import { secParserFailure } from "./errors.js";

export type SecSubmissions = Readonly<{
  accession: string;
  cik: string | null;
  form: string;
  items: readonly string[];
  acceptanceDateTime: string | null;
}>;

export type SecIndexExhibit = Readonly<{
  memberKey: string;
  type: string;
  sequence: number;
}>;

export type SecFilingIndex = Readonly<{
  accession: string;
  subjectCik: string | null;
  form: string;
  items: readonly string[];
  exhibits: readonly SecIndexExhibit[];
}>;

export type SecSubmissionsSelector = Readonly<{
  accession: string;
  subjectCik: string;
}>;

function fail(): never {
  return secParserFailure("sec.malformed-json", "SEC JSON is malformed or structurally invalid");
}

function object(value: JsonValue): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as JsonObject;
}

function exactKeys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[],
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !allowed.has(key))) {
    fail();
  }
}

function string(value: JsonValue | undefined, maxBytes = 512): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) return fail();
  return value;
}

function nullableString(value: JsonValue | undefined, maxBytes = 512): string | null {
  return value === undefined ? null : string(value, maxBytes);
}

function stringArray(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value) || value.length > 256) return fail();
  return value.map((entry) => string(entry, 128));
}

function parse(serialized: string): JsonValue {
  try {
    return parseJsonWithinLimits(
      serialized,
      {
        maxDepth: 16,
        maxNodes: 100_000,
        maxArrayLength: 10_000,
        maxObjectKeys: 1_024,
        maxStringBytes: 1024 * 1024,
        maxCanonicalBytes: SEC_MAX_MEMBER_BYTES,
      },
      "$.secJson",
    );
  } catch {
    return fail();
  }
}

function frozen<T extends JsonValue>(value: T): Readonly<T> {
  return deepFreezeJson(inertJsonSnapshot(value));
}

function selectedArray(value: JsonValue | undefined, index: number): JsonValue | undefined {
  if (!Array.isArray(value) || value.length > 10_000) return fail();
  return value[index];
}

function parseLiveSubmissions(value: JsonObject, selector: SecSubmissionsSelector): SecSubmissions {
  const cikValue = value["cik"];
  const cik = typeof cikValue === "number" ? String(cikValue).padStart(10, "0") : string(cikValue);
  if (cik !== selector.subjectCik) return fail();
  const filings = object(value["filings"] as JsonValue);
  const recent = object(filings["recent"] as JsonValue);
  const accessions = recent["accessionNumber"];
  if (!Array.isArray(accessions) || accessions.length > 10_000) return fail();
  const index = accessions.indexOf(selector.accession);
  if (index < 0) return fail();
  const rawItems = string(selectedArray(recent["items"], index), 512);
  return frozen({
    accession: selector.accession,
    cik,
    form: string(selectedArray(recent["form"], index), 32),
    items: rawItems
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    acceptanceDateTime: string(selectedArray(recent["acceptanceDateTime"], index)),
  }) as SecSubmissions;
}

export function parseSecSubmissionsJson(
  serialized: string,
  selector?: SecSubmissionsSelector,
): SecSubmissions {
  const value = object(parse(serialized));
  if (!Object.hasOwn(value, "accession")) {
    if (selector === undefined) return fail();
    return parseLiveSubmissions(value, selector);
  }
  exactKeys(value, ["accession", "form", "items"], ["cik", "acceptanceDateTime"]);
  return frozen({
    accession: string(value["accession"]),
    cik: nullableString(value["cik"]),
    form: string(value["form"], 32),
    items: stringArray(value["items"]),
    acceptanceDateTime: nullableString(value["acceptanceDateTime"]),
  }) as SecSubmissions;
}

export function parseSecFilingIndexJson(serialized: string): SecFilingIndex {
  const value = object(parse(serialized));
  exactKeys(value, ["accession", "form", "items", "exhibits"], ["subjectCik"]);
  const rawExhibits = value["exhibits"];
  if (!Array.isArray(rawExhibits) || rawExhibits.length > 256) return fail();
  const exhibits = rawExhibits.map((raw) => {
    const exhibit = object(raw);
    exactKeys(exhibit, ["memberKey", "type", "sequence"], []);
    const sequence = exhibit["sequence"];
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence)) return fail();
    return {
      memberKey: string(exhibit["memberKey"], 64),
      type: string(exhibit["type"], 64),
      sequence,
    };
  });
  return frozen({
    accession: string(value["accession"]),
    subjectCik: nullableString(value["subjectCik"]),
    form: string(value["form"], 32),
    items: stringArray(value["items"]),
    exhibits,
  }) as SecFilingIndex;
}
