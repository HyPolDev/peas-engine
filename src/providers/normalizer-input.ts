import { types as utilityTypes } from "node:util";

import {
  assertJsonWithinLimits,
  inertJsonSnapshot,
  type JsonLimits,
  type JsonValue,
} from "../core/json.js";

export class ProviderNormalizerInputError extends Error {
  constructor() {
    super("provider normalizer input is not inert exact data");
    this.name = "ProviderNormalizerInputError";
  }
}

export class ProviderNormalizerInputLimitError extends ProviderNormalizerInputError {
  constructor() {
    super();
    this.name = "ProviderNormalizerInputLimitError";
  }
}

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;

function fail(): never {
  throw new ProviderNormalizerInputError();
}

function ownDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
    return fail();
  }
  return descriptor.value;
}

/**
 * Reads only own data-property descriptors from an ordinary object, then returns detached
 * null-prototype data. Proxies are rejected before any reflective operation can invoke a trap.
 */
export function snapshotExactNormalizerInput(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      utilityTypes.isProxy(value) ||
      Array.isArray(value)
    ) {
      fail();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) fail();
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (
      keys.length < requiredKeys.length ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      requiredKeys.some((key) => !keys.includes(key))
    ) {
      fail();
    }
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of [...requiredKeys, ...optionalKeys]) {
      if (keys.includes(key)) snapshot[key] = ownDataProperty(value, key);
    }
    return Object.freeze(snapshot);
  } catch (error) {
    if (error instanceof ProviderNormalizerInputError) throw error;
    fail();
  }
}

/** Bounds and detaches a nested JSON contract after the outer descriptor boundary has accepted it. */
export function snapshotNestedNormalizerJson<T>(value: unknown, limits: JsonLimits): T {
  try {
    assertJsonWithinLimits(value, limits, "$.providerNormalizerInput");
    return inertJsonSnapshot(value as JsonValue) as T;
  } catch {
    fail();
  }
}

/**
 * Copies a supported byte member once using intrinsic typed-array operations. No caller-owned
 * byte container remains reachable after this boundary.
 */
export function snapshotNormalizerBytes(value: unknown, maximumBytes: number): Uint8Array {
  if (
    value === null ||
    typeof value !== "object" ||
    utilityTypes.isProxy(value) ||
    !(value instanceof Uint8Array) ||
    TYPED_ARRAY_BYTE_LENGTH === undefined
  ) {
    fail();
  }
  try {
    const byteLength = TYPED_ARRAY_BYTE_LENGTH.call(value);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) fail();
    if (byteLength > maximumBytes) throw new ProviderNormalizerInputLimitError();
    const snapshot = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(snapshot, value);
    return snapshot;
  } catch (error) {
    if (error instanceof ProviderNormalizerInputError) throw error;
    fail();
  }
}
