export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

function assertUnicodeScalarString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new TypeError(`${path} contains an unpaired high surrogate`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(`${path} contains an unpaired low surrogate`);
    }
  }
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      assertUnicodeScalarString(value, path);
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        throw new TypeError(`${path} must be a safe integer and cannot be negative zero`);
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        const entries: string[] = [];
        for (let index = 0; index < value.length; index += 1) {
          if (!Object.hasOwn(value, index)) {
            throw new TypeError(`${path} cannot contain sparse array entries`);
          }
          entries.push(encode(value[index], `${path}[${index}]`));
        }
        return `[${entries.join(",")}]`;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must be a plain JSON object`);
      }

      const object = value as Record<string, unknown>;
      const keys = Object.keys(object).sort();
      const entries = keys.map((key) => {
        assertUnicodeScalarString(key, `${path} key`);
        return `${JSON.stringify(key)}:${encode(object[key], `${path}.${key}`)}`;
      });
      return `{${entries.join(",")}}`;
    }
    default:
      throw new TypeError(`${path} contains a non-JSON ${typeof value}`);
  }
}

/**
 * RFC 8785-style canonical JSON for PEAS' intentionally narrower JSON domain.
 * Numeric values are restricted to safe integers; financial decimals use strings.
 */
export function canonicalJson(value: JsonValue): string {
  return encode(value, "$");
}

export function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function assertJson(value: unknown): asserts value is JsonValue {
  encode(value, "$");
}

export function deepFreezeJson<T extends JsonValue>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}
