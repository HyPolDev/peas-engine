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

export function parseSecSubmissionsJson(serialized: string): SecSubmissions {
  const value = object(parse(serialized));
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
