import { Buffer } from "node:buffer";
import { types as utilityTypes } from "node:util";

import { canonicalHash } from "../../core/hash.js";
import type { JsonValue } from "../../core/json.js";

export type SafeErrorReasonCode =
  | "credential-unavailable"
  | "lane-not-implemented"
  | "retention-policy-invalid"
  | "retention-stop-required"
  | "retention-deadline-breached"
  | "retention-erasure-failed"
  | "retention-erasure-unprovable";

export type SafeErrorOperationStage =
  | "configuration"
  | "authority"
  | "identity"
  | "request-preflight"
  | "trusted-time"
  | "request-started"
  | "credential-load"
  | "dispatch"
  | "response-headers"
  | "response-body"
  | "cleanup"
  | "artifact-commit"
  | "artifact-verify"
  | "checkpoint"
  | "normalization"
  | "selection"
  | "retention-stop"
  | "retention-plan"
  | "retention-erase"
  | "retention-verify";

export type SafeErrorDetail =
  | Readonly<{ detailKind: "none" }>
  | Readonly<{ detailKind: "retention-state"; state: RetentionDetailState }>
  | Readonly<{
      detailKind: "retention-count";
      counter: RetentionDetailCounter;
      value: number;
    }>
  | Readonly<{
      detailKind: "retention-policy";
      policyId: string;
      decision: "allow" | "deny";
    }>;

export type RetentionDetailState =
  | "stop-required"
  | "denied"
  | "planned"
  | "settling"
  | "erasing"
  | "tombstoned"
  | "verifying"
  | "receipted"
  | "complete";

export type RetentionDetailCounter =
  | "artifact-count"
  | "derived-count"
  | "attempt-count"
  | "copy-count";

export type SafeAcquisitionError = Readonly<{
  reasonCode: SafeErrorReasonCode;
  operationStage: SafeErrorOperationStage;
  detailHash: string;
}>;

export const REDACTED = "[redacted]";
export const OPAQUE = "[opaque]";
export const ACCESSOR = "[accessor]";
export const CYCLE = "[cycle]";
export const DEPTH_LIMIT = "[depth-limit]";
export const MEMBER_LIMIT = "[member-limit]";
export const BYTE_LIMIT = "[byte-limit]";

export type RedactionLimits = Readonly<{
  maxDepth: number;
  maxMembers: number;
  maxOutputBytes: number;
}>;

const DEFAULT_LIMITS: RedactionLimits = {
  maxDepth: 6,
  maxMembers: 64,
  maxOutputBytes: 8_192,
};

const FORBIDDEN_KEY =
  /(?:credential|key|secret|password|token|authorization|proxy.?authorization|cookie|set.?cookie|header|url|uri|origin|path|query|search|fragment|body|payload|response|request|cause|message|stack|account|subscription|invoice|payment|price|symbol)/iu;

function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function stringMarker(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  const bucket = bytes === 0 ? 0 : bytes <= 16 ? 16 : bytes <= 64 ? 64 : bytes <= 256 ? 256 : 257;
  return `[string:${bucket}]`;
}

function markerForPrimitive(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string") return stringMarker(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? value : "[number]";
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "bigint") return "[bigint]";
  if (typeof value === "symbol") return "[symbol]";
  if (typeof value === "function") return "[function]";
  return OPAQUE;
}

function boundedLimits(limits: RedactionLimits): RedactionLimits {
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid redaction limits");
  return limits;
}

/**
 * Creates a non-evidentiary, descriptor-safe projection. The result is suitable only for
 * diagnostic sinks that already prohibit provider material; it must never be used as an identity
 * or safe-error detail preimage.
 */
export function projectHostileValue(
  input: unknown,
  requestedLimits: Partial<RedactionLimits> = {},
): JsonValue {
  const limits = boundedLimits({ ...DEFAULT_LIMITS, ...requestedLimits });
  const seen = new WeakSet<object>();
  let members = 0;
  let outputBytes = 0;
  const addBytes = (value: string): boolean => {
    outputBytes += Buffer.byteLength(value, "utf8");
    return outputBytes <= limits.maxOutputBytes;
  };

  const visit = (value: unknown, depth: number): JsonValue => {
    if (value === null || typeof value !== "object") {
      const marker = markerForPrimitive(value);
      return addBytes(typeof marker === "string" ? marker : String(marker)) ? marker : BYTE_LIMIT;
    }
    if (depth > limits.maxDepth) return DEPTH_LIMIT;
    if (seen.has(value)) return CYCLE;
    if (utilityTypes.isProxy(value)) return OPAQUE;
    let prototype: object | null;
    let descriptors: PropertyDescriptorMap;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return OPAQUE;
    }
    if (prototype !== Object.prototype && prototype !== null) return OPAQUE;
    seen.add(value);
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    const keys = Object.keys(descriptors).sort(utf8Compare);
    for (const key of keys) {
      members += 1;
      if (members > limits.maxMembers) {
        result["$overflow"] = MEMBER_LIMIT;
        break;
      }
      if (!addBytes(key)) {
        result["$overflow"] = BYTE_LIMIT;
        break;
      }
      if (FORBIDDEN_KEY.test(key)) {
        result[key] = REDACTED;
        continue;
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined) continue;
      if (!("value" in descriptor)) {
        result[key] = ACCESSOR;
        continue;
      }
      result[key] = visit(descriptor.value, depth + 1);
    }
    return result;
  };

  return visit(input, 1);
}

function assertClosedSafeDetail(detail: SafeErrorDetail): JsonValue {
  if (detail.detailKind === "none") return { detailKind: "none" };
  if (detail.detailKind === "retention-state")
    return { detailKind: detail.detailKind, state: detail.state };
  if (detail.detailKind === "retention-count") {
    if (!Number.isSafeInteger(detail.value) || detail.value < 0)
      throw new RangeError("Safe detail counter must be a bounded nonnegative integer");
    return {
      counter: detail.counter,
      detailKind: detail.detailKind,
      value: detail.value,
    };
  }
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(detail.policyId))
    throw new TypeError("Safe retention policy identifier is invalid");
  return {
    decision: detail.decision,
    detailKind: detail.detailKind,
    policyId: detail.policyId,
  };
}

export function safeAcquisitionError(
  reasonCode: SafeErrorReasonCode,
  operationStage: SafeErrorOperationStage,
  detail: SafeErrorDetail = { detailKind: "none" },
): SafeAcquisitionError {
  return Object.freeze({
    reasonCode,
    operationStage,
    detailHash: canonicalHash(
      "peas/market-acquisition-safe-detail/v1",
      assertClosedSafeDetail(detail),
    ),
  });
}

export function isSafeAcquisitionError(value: unknown): value is SafeAcquisitionError {
  if (value === null || typeof value !== "object" || utilityTypes.isProxy(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    if (keys.join(",") !== "detailHash,operationStage,reasonCode") return false;
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) return false;
    for (const key of keys)
      if (!("value" in (descriptors[key] as PropertyDescriptor))) return false;
    const candidate = value as Partial<SafeAcquisitionError>;
    return (
      typeof candidate.reasonCode === "string" &&
      typeof candidate.operationStage === "string" &&
      typeof candidate.detailHash === "string" &&
      /^[0-9a-f]{64}$/u.test(candidate.detailHash)
    );
  } catch {
    return false;
  }
}
