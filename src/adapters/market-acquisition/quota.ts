import { MARKET_ACQUISITION_LIMITS } from "./contracts.js";

export const QUOTA_POLICY_VERSION = "p1-10-30-per-rolling-60s-v1";
export const PROJECT_RATE_ATTEMPTS = MARKET_ACQUISITION_LIMITS.rateAttempts;
export const PROJECT_RATE_WINDOW_MS = MARKET_ACQUISITION_LIMITS.rateWindowMs;
export const ATTEMPT_DEADLINE_MS = MARKET_ACQUISITION_LIMITS.attemptDeadlineMs;
export const ACQUISITION_DEADLINE_MS = MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs;

function requireNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name}-invalid`);
}

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name}-invalid`);
}

function sortedAttemptStarts(values: readonly number[]): readonly number[] {
  const copy = [...values];
  for (const value of copy) requireNonNegativeSafeInteger(value, "quota-start");
  copy.sort((left, right) => left - right);
  return Object.freeze(copy);
}

export type QuotaAdmission =
  | Readonly<{ kind: "admit"; attemptStarts: readonly number[] }>
  | Readonly<{ kind: "wait"; waitUntilMs: number }>
  | Readonly<{ kind: "stop"; reason: "quota-exhausted" | "acquisition-deadline" }>;

/**
 * Pure rolling-window proof for `(proposedStart - windowMs, proposedStart]`.
 * A start exactly one window old is excluded.
 */
export function evaluateRollingQuota(
  attemptStarts: readonly number[],
  proposedStartMs: number,
  entitlementLimit: number,
  acquisitionDeadlineAtMs: number,
): QuotaAdmission {
  requireNonNegativeSafeInteger(proposedStartMs, "quota-proposed-start");
  requirePositiveSafeInteger(entitlementLimit, "quota-entitlement-limit");
  requireNonNegativeSafeInteger(acquisitionDeadlineAtMs, "acquisition-deadline");
  const effectiveLimit = Math.min(PROJECT_RATE_ATTEMPTS, entitlementLimit);
  const sorted = sortedAttemptStarts(attemptStarts);
  if (sorted.some((start) => start > proposedStartMs)) {
    throw new RangeError("quota-window-future-start");
  }
  const lowerExclusive = proposedStartMs - PROJECT_RATE_WINDOW_MS;
  const active = sorted.filter((start) => start > lowerExclusive);
  if (active.length < effectiveLimit) {
    return { kind: "admit", attemptStarts: Object.freeze([...sorted, proposedStartMs]) };
  }
  const blocking = active.at(active.length - effectiveLimit);
  if (blocking === undefined) return { kind: "stop", reason: "quota-exhausted" };
  const waitUntilMs = blocking + PROJECT_RATE_WINDOW_MS;
  if (waitUntilMs > acquisitionDeadlineAtMs) {
    return { kind: "stop", reason: "acquisition-deadline" };
  }
  return { kind: "wait", waitUntilMs };
}

export type DeadlineProof = Readonly<{
  acquisitionDeclaredMonotonicMs: number;
  attemptStartedMonotonicMs: number;
  nowMonotonicMs: number;
}>;

export function validateDeadlineProof(proof: DeadlineProof): void {
  requireNonNegativeSafeInteger(proof.acquisitionDeclaredMonotonicMs, "acquisition-start");
  requireNonNegativeSafeInteger(proof.attemptStartedMonotonicMs, "attempt-start");
  requireNonNegativeSafeInteger(proof.nowMonotonicMs, "deadline-now");
  if (
    proof.attemptStartedMonotonicMs < proof.acquisitionDeclaredMonotonicMs ||
    proof.nowMonotonicMs < proof.attemptStartedMonotonicMs
  ) {
    throw new RangeError("deadline-monotonic-regression");
  }
  if (proof.nowMonotonicMs - proof.attemptStartedMonotonicMs > ATTEMPT_DEADLINE_MS) {
    throw new RangeError("attempt-timeout");
  }
  if (proof.nowMonotonicMs - proof.acquisitionDeclaredMonotonicMs > ACQUISITION_DEADLINE_MS) {
    throw new RangeError("acquisition-deadline");
  }
}

export function retryFitsAcquisitionDeadline(
  nowMonotonicMs: number,
  delayMs: number,
  acquisitionDeclaredMonotonicMs: number,
): boolean {
  requireNonNegativeSafeInteger(nowMonotonicMs, "deadline-now");
  requireNonNegativeSafeInteger(delayMs, "retry-delay");
  requireNonNegativeSafeInteger(acquisitionDeclaredMonotonicMs, "acquisition-start");
  if (nowMonotonicMs < acquisitionDeclaredMonotonicMs) return false;
  return (
    nowMonotonicMs + delayMs + ATTEMPT_DEADLINE_MS - acquisitionDeclaredMonotonicMs <=
    ACQUISITION_DEADLINE_MS
  );
}
