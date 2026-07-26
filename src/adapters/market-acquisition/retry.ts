import { MARKET_ACQUISITION_LIMITS } from "./contracts.js";

export const RETRY_POLICY_VERSION = "p1-10-deterministic-1s-2s-no-jitter-v1";
export const RETRY_DELAYS_MS = Object.freeze([1_000, 2_000] as const);
export const MAX_RETRY_AFTER_MS = MARKET_ACQUISITION_LIMITS.retryAfterMs;
export const MAX_ATTEMPTS_PER_PAGE = MARKET_ACQUISITION_LIMITS.attemptsPerLogicalPage;
export const MAX_ATTEMPTS_PER_ACQUISITION = MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition;

export const RETRYABLE_HTTP_STATUSES = Object.freeze([408, 429, 500, 502, 503, 504] as const);
export const NON_RETRYABLE_HTTP_STATUSES = Object.freeze([400, 401, 403, 404, 409, 422] as const);

export type RetryableHttpStatus = (typeof RETRYABLE_HTTP_STATUSES)[number];
export type NonRetryableHttpStatus = (typeof NON_RETRYABLE_HTTP_STATUSES)[number];

export type RetryFailure =
  | Readonly<{ kind: "pre-response-transport" }>
  | Readonly<{ kind: "clean-partial-body-transport"; resourcesSettled: boolean }>
  | Readonly<{
      kind: "http";
      status: number;
      quotaClassification:
        | "temporary-throttling-proved"
        | "quota-exhausted"
        | "missing"
        | "ambiguous";
      retryAfter: string | null;
    }>
  | Readonly<{
      kind:
        | "identity"
        | "entitlement"
        | "authorization"
        | "feed"
        | "capability"
        | "cost"
        | "clock"
        | "bound"
        | "schema"
        | "pagination"
        | "redaction"
        | "artifact"
        | "correction"
        | "journal"
        | "malformed-body"
        | "cleanup-unprovable"
        | "zero-spend";
    }>;

export type RetryContext = Readonly<{
  failure: RetryFailure;
  pageAttemptsStarted: number;
  acquisitionAttemptsStarted: number;
}>;

export type RetryDecision =
  | Readonly<{ kind: "retry"; delayMs: number; retryOrdinal: 1 | 2 }>
  | Readonly<{
      kind: "stop";
      reason:
        | "non-retryable"
        | "lane-disabled"
        | "quota-exhausted"
        | "retry-after-invalid"
        | "attempt-budget-exhausted"
        | "cleanup-unprovable";
    }>;

function isCanonicalNonNegativeInteger(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/u.test(value);
}

/**
 * Parses only the accepted canonical delta-seconds grammar.
 * `null` means the header was absent and deliberately remains distinguishable from zero seconds.
 */
export function parseRetryAfterMs(value: string | null): number | null {
  if (value === null) return null;
  if (!isCanonicalNonNegativeInteger(value)) {
    throw new TypeError("retry-after-invalid");
  }
  const seconds = Number(value);
  const milliseconds = seconds * 1_000;
  if (
    !Number.isSafeInteger(seconds) ||
    !Number.isSafeInteger(milliseconds) ||
    milliseconds > MAX_RETRY_AFTER_MS
  ) {
    throw new RangeError("retry-after-invalid");
  }
  return milliseconds;
}

function projectDelay(pageAttemptsStarted: number): Readonly<{
  delayMs: number;
  retryOrdinal: 1 | 2;
}> {
  if (pageAttemptsStarted === 1) return { delayMs: RETRY_DELAYS_MS[0], retryOrdinal: 1 };
  if (pageAttemptsStarted === 2) return { delayMs: RETRY_DELAYS_MS[1], retryOrdinal: 2 };
  throw new RangeError("attempt-budget-exhausted");
}

function stopForHttp(status: number): RetryDecision {
  if (status === 401 || status === 403) return { kind: "stop", reason: "lane-disabled" };
  return { kind: "stop", reason: "non-retryable" };
}

export function decideRetry(context: RetryContext): RetryDecision {
  const { pageAttemptsStarted, acquisitionAttemptsStarted, failure } = context;
  if (
    !Number.isSafeInteger(pageAttemptsStarted) ||
    pageAttemptsStarted < 1 ||
    !Number.isSafeInteger(acquisitionAttemptsStarted) ||
    acquisitionAttemptsStarted < 1
  ) {
    return { kind: "stop", reason: "attempt-budget-exhausted" };
  }
  if (
    pageAttemptsStarted >= MAX_ATTEMPTS_PER_PAGE ||
    acquisitionAttemptsStarted >= MAX_ATTEMPTS_PER_ACQUISITION
  ) {
    return { kind: "stop", reason: "attempt-budget-exhausted" };
  }

  if (failure.kind === "clean-partial-body-transport" && !failure.resourcesSettled) {
    return { kind: "stop", reason: "cleanup-unprovable" };
  }
  if (
    failure.kind !== "pre-response-transport" &&
    failure.kind !== "clean-partial-body-transport" &&
    failure.kind !== "http"
  ) {
    return {
      kind: "stop",
      reason: failure.kind === "cleanup-unprovable" ? "cleanup-unprovable" : "non-retryable",
    };
  }

  const project = projectDelay(pageAttemptsStarted);
  if (failure.kind !== "http") return { kind: "retry", ...project };

  if (
    !Number.isSafeInteger(failure.status) ||
    !RETRYABLE_HTTP_STATUSES.includes(failure.status as RetryableHttpStatus)
  ) {
    return stopForHttp(failure.status);
  }
  if (failure.status !== 429) return { kind: "retry", ...project };

  if (failure.quotaClassification === "quota-exhausted") {
    return { kind: "stop", reason: "quota-exhausted" };
  }
  if (failure.quotaClassification !== "temporary-throttling-proved") {
    return { kind: "stop", reason: "quota-exhausted" };
  }
  try {
    const retryAfterMs = parseRetryAfterMs(failure.retryAfter);
    return {
      kind: "retry",
      retryOrdinal: project.retryOrdinal,
      delayMs: Math.max(project.delayMs, retryAfterMs ?? 0),
    };
  } catch {
    return { kind: "stop", reason: "retry-after-invalid" };
  }
}

export type RetryDelayProof = Readonly<{
  clockBasis: "same-session-monotonic";
  elapsedMs: number;
  monotonicOrderValid: true;
}>;

export function validateRetryDelayProof(delayMs: number, proof: RetryDelayProof): void {
  if (
    !Number.isSafeInteger(delayMs) ||
    delayMs < 0 ||
    proof.clockBasis !== "same-session-monotonic" ||
    proof.monotonicOrderValid !== true ||
    proof.elapsedMs !== delayMs
  ) {
    throw new TypeError("retry-delay-proof-invalid");
  }
}
