import { Buffer } from "node:buffer";
import { types as utilityTypes } from "node:util";

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export type JsonLimits = Readonly<{
  maxDepth: number;
  maxNodes: number;
  maxArrayLength: number;
  maxObjectKeys: number;
  maxStringBytes: number;
  maxCanonicalBytes: number;
}>;

export type JsonMetrics = Readonly<{
  nodes: number;
  maxDepth: number;
  canonicalBytes: number;
}>;

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

function assertPlainDataContainer(value: object, path: string): void {
  if (utilityTypes.isProxy(value)) {
    throw new TypeError(`${path} cannot be a Proxy`);
  }
}

type DataDescriptor = PropertyDescriptor & Readonly<{ value: unknown }>;

function ownDataDescriptor(value: object, key: PropertyKey, path: string): DataDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) {
    throw new TypeError(`${path} must be an own JSON value`);
  }
  if (!("value" in descriptor)) {
    throw new TypeError(`${path} cannot be an accessor property`);
  }
  return descriptor as DataDescriptor;
}

function assertNoSymbolProperties(keys: readonly PropertyKey[], path: string): void {
  if (keys.some((key) => typeof key === "symbol")) {
    throw new TypeError(`${path} cannot contain symbol properties`);
  }
}

function assertSupportedJsonKey(key: string, path: string): void {
  assertUnicodeScalarString(key, `${path} key`);
  if (key === "__proto__") {
    throw new TypeError(`${path} cannot contain the forbidden JSON key __proto__`);
  }
}

type JsonObjectEntry = Readonly<{ key: string; value: unknown }>;

function objectDataEntries(
  value: object,
  path: string,
  maxObjectKeys?: number,
  maxStringBytes?: number,
): JsonObjectEntry[] {
  assertPlainDataContainer(value, path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain JSON object`);
  }

  const ownKeys = Reflect.ownKeys(value);
  assertNoSymbolProperties(ownKeys, path);
  const keys = ownKeys as string[];
  if (maxObjectKeys !== undefined && keys.length > maxObjectKeys) {
    throw new RangeError(`${path} exceeds the ${maxObjectKeys}-key object limit`);
  }

  const entries = keys.map((key) => {
    assertSupportedJsonKey(key, path);
    if (maxStringBytes !== undefined && Buffer.byteLength(key, "utf8") > maxStringBytes) {
      throw new RangeError(`${path} key exceeds the ${maxStringBytes}-byte string limit`);
    }
    const descriptor = ownDataDescriptor(value, key, `${path}.${key}`);
    if (descriptor.enumerable !== true) {
      throw new TypeError(`${path}.${key} cannot be a non-enumerable property`);
    }
    return { key, value: descriptor.value };
  });
  entries.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return entries;
}

function arrayIndex(key: string, length: number): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/u.test(key)) return undefined;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length ? index : undefined;
}

function arrayDataValues(
  value: readonly unknown[],
  path: string,
  maxArrayLength?: number,
): unknown[] {
  assertPlainDataContainer(value, path);
  const lengthDescriptor = ownDataDescriptor(value, "length", `${path}.length`);
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || typeof length !== "number" || length < 0) {
    throw new TypeError(`${path}.length must be a non-negative safe integer`);
  }
  if (maxArrayLength !== undefined && length > maxArrayLength) {
    throw new RangeError(`${path} exceeds the ${maxArrayLength}-item array limit`);
  }

  const ownKeys = Reflect.ownKeys(value);
  assertNoSymbolProperties(ownKeys, path);
  const values = new Array<unknown>(length);
  let observedIndexes = 0;
  for (const ownKey of ownKeys) {
    if (ownKey === "length") continue;
    const key = ownKey as string;
    assertSupportedJsonKey(key, path);
    const index = arrayIndex(key, length);
    if (index === undefined) {
      throw new TypeError(`${path} cannot contain the unsupported array property ${key}`);
    }
    const descriptor = ownDataDescriptor(value, key, `${path}[${index}]`);
    if (descriptor.enumerable !== true) {
      throw new TypeError(`${path}[${index}] cannot be a non-enumerable property`);
    }
    values[index] = descriptor.value;
    observedIndexes += 1;
  }
  if (observedIndexes !== length) {
    throw new TypeError(`${path} cannot contain sparse array entries`);
  }
  return values;
}

type JsonTraversalFrame =
  | Readonly<{ kind: "visit"; value: unknown; path: string; depth: number }>
  | Readonly<{ kind: "leave"; value: object }>;

function assertJsonLimits(limits: JsonLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`JSON limit ${name} must be a positive safe integer`);
    }
  }
}

/**
 * Iteratively validates untrusted JSON and enforces resource budgets before recursive
 * canonicalization. `maxDepth` counts the root value as depth 1. Canonical byte accounting is
 * exact for PEAS JSON; object key ordering does not affect its encoded length.
 */
export function assertJsonWithinLimits(
  value: unknown,
  limits: JsonLimits,
  rootPath = "$",
): JsonMetrics {
  assertJsonLimits(limits);
  const activeContainers = new Set<object>();
  const frames: JsonTraversalFrame[] = [{ kind: "visit", value, path: rootPath, depth: 1 }];
  let nodes = 0;
  let observedDepth = 0;
  let canonicalBytes = 0;

  const addCanonicalBytes = (bytes: number): void => {
    canonicalBytes += bytes;
    if (canonicalBytes > limits.maxCanonicalBytes) {
      throw new RangeError(
        `${rootPath} exceeds the ${limits.maxCanonicalBytes}-byte canonical JSON limit`,
      );
    }
  };

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    if (frame.kind === "leave") {
      activeContainers.delete(frame.value);
      continue;
    }

    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new RangeError(`${rootPath} exceeds the ${limits.maxNodes}-node JSON limit`);
    }
    if (frame.depth > limits.maxDepth) {
      throw new RangeError(`${frame.path} exceeds the JSON depth limit of ${limits.maxDepth}`);
    }
    observedDepth = Math.max(observedDepth, frame.depth);

    if (frame.value === null) {
      addCanonicalBytes(4);
      continue;
    }

    switch (typeof frame.value) {
      case "string": {
        assertUnicodeScalarString(frame.value, frame.path);
        const stringBytes = Buffer.byteLength(frame.value, "utf8");
        if (stringBytes > limits.maxStringBytes) {
          throw new RangeError(
            `${frame.path} exceeds the ${limits.maxStringBytes}-byte string limit`,
          );
        }
        addCanonicalBytes(Buffer.byteLength(JSON.stringify(frame.value), "utf8"));
        break;
      }
      case "boolean":
        addCanonicalBytes(frame.value ? 4 : 5);
        break;
      case "number": {
        if (!Number.isSafeInteger(frame.value) || Object.is(frame.value, -0)) {
          throw new TypeError(`${frame.path} must be a safe integer and cannot be negative zero`);
        }
        addCanonicalBytes(Buffer.byteLength(JSON.stringify(frame.value), "utf8"));
        break;
      }
      case "object": {
        assertPlainDataContainer(frame.value, frame.path);
        if (activeContainers.has(frame.value)) {
          throw new TypeError(`${frame.path} contains a cyclic JSON reference`);
        }
        activeContainers.add(frame.value);
        frames.push({ kind: "leave", value: frame.value });

        if (Array.isArray(frame.value)) {
          const values = arrayDataValues(frame.value, frame.path, limits.maxArrayLength);
          addCanonicalBytes(2 + Math.max(0, values.length - 1));
          for (let index = values.length - 1; index >= 0; index -= 1) {
            frames.push({
              kind: "visit",
              value: values[index],
              path: `${frame.path}[${index}]`,
              depth: frame.depth + 1,
            });
          }
          break;
        }

        const entries = objectDataEntries(
          frame.value,
          frame.path,
          limits.maxObjectKeys,
          limits.maxStringBytes,
        );
        addCanonicalBytes(2 + Math.max(0, entries.length - 1));
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const entry = entries[index];
          if (entry === undefined) continue;
          const { key } = entry;
          addCanonicalBytes(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
          frames.push({
            kind: "visit",
            value: entry.value,
            path: `${frame.path}.${key}`,
            depth: frame.depth + 1,
          });
        }
        break;
      }
      default:
        throw new TypeError(`${frame.path} contains a non-JSON ${typeof frame.value}`);
    }
  }

  return { nodes, maxDepth: observedDepth, canonicalBytes };
}

/** Rejects oversized serialized input before `JSON.parse` allocates the decoded object graph. */
export function assertSerializedJsonWithinLimit(
  serialized: string,
  maxBytes: number,
  rootPath = "$",
): void {
  if (typeof serialized !== "string") {
    throw new TypeError(`${rootPath} serialized JSON must be a string`);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("Serialized JSON byte limit must be a positive safe integer");
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new RangeError(`${rootPath} exceeds the ${maxBytes}-byte serialized JSON limit`);
  }
}

/**
 * Bounds a serialized JSON representation before parsing, then applies the same iterative inert
 * JSON validation used for already-decoded adapter input. Stored PEAS JSON is canonical, so its
 * canonical-byte budget is also the conservative serialized representation budget.
 */
export function parseJsonWithinLimits(
  serialized: string,
  limits: JsonLimits,
  rootPath = "$",
): JsonValue {
  assertJsonLimits(limits);
  assertSerializedJsonWithinLimit(serialized, limits.maxCanonicalBytes, rootPath);
  const value: unknown = JSON.parse(serialized);
  assertJsonWithinLimits(value, limits, rootPath);
  return value as JsonValue;
}

/**
 * Fails closed when prototype pollution could satisfy a required schema field or intercept Zod's
 * output assignment. Call synchronously immediately before parsing a null-prototype snapshot.
 */
export function assertSchemaPrototypeSafety(fieldNames: readonly string[]): void {
  for (const fieldName of fieldNames) {
    if (Object.getOwnPropertyDescriptor(Object.prototype, fieldName) !== undefined) {
      throw new TypeError(`Object.prototype contains schema field ${fieldName}`);
    }
  }
  for (const key of Reflect.ownKeys(Array.prototype)) {
    if (typeof key === "string" && /^(?:0|[1-9]\d*)$/u.test(key)) {
      throw new TypeError(`Array.prototype contains indexed schema property ${key}`);
    }
  }
}

/** Creates a deep inert snapshot whose JSON object containers have null prototypes. */
export function inertJsonSnapshot<T extends JsonValue>(value: T): T {
  const snapshot = JSON.parse(canonicalJson(value)) as T;
  const pending: object[] = [];
  if (snapshot !== null && typeof snapshot === "object") pending.push(snapshot);
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (Array.isArray(current)) {
      for (const child of current) {
        if (child !== null && typeof child === "object") pending.push(child);
      }
      continue;
    }
    Object.setPrototypeOf(current, null);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object") pending.push(child);
    }
  }
  return snapshot;
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
      assertPlainDataContainer(value, path);
      if (Array.isArray(value)) {
        const entries = arrayDataValues(value, path).map((entry, index) =>
          encode(entry, `${path}[${index}]`),
        );
        return `[${entries.join(",")}]`;
      }

      const entries = objectDataEntries(value, path).map((entry) => {
        return `${JSON.stringify(entry.key)}:${encode(entry.value, `${path}.${entry.key}`)}`;
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
    const children = Array.isArray(value)
      ? arrayDataValues(value, "$")
      : objectDataEntries(value, "$").map((entry) => entry.value);
    for (const child of children) deepFreezeJson(child as JsonValue);
    Object.freeze(value);
  }
  return value;
}
