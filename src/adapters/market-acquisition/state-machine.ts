import { Buffer } from "node:buffer";

import { canonicalJson, type JsonValue } from "../../core/json.js";
import { MARKET_ACQUISITION_LIMITS, type MarketAcquisitionTerminalReason } from "./contracts.js";
import {
  GENESIS_HASH,
  NO_TOKEN_HASH,
  type JournalCheckpointKind,
  type PageChainInput,
  deriveAttemptControlIdentities,
  deriveLogicalPageIdentityHash,
  derivePrivateTokenHash,
  planPageAdmission,
} from "./journal.js";
import {
  evaluateRollingQuota,
  retryFitsAcquisitionDeadline,
  type DeadlineProof,
  validateDeadlineProof,
} from "./quota.js";
import {
  type RetryContext,
  type RetryDelayProof,
  decideRetry,
  validateRetryDelayProof,
} from "./retry.js";

export const ACQUISITION_STATES = Object.freeze([
  "declared",
  "preflighting",
  "dispatch-ready",
  "credential-ready",
  "attempt-active",
  "response-accepted",
  "artifact-committing",
  "artifact-committed",
  "artifact-verifying",
  "page-verified",
  "checkpointing",
  "waiting-retry",
  "chain-complete",
  "normalizing",
  "ready-for-selection",
  "selecting",
  "completed",
  "stopped",
  "failed-clean",
  "quarantined",
] as const);
export type AcquisitionState = (typeof ACQUISITION_STATES)[number];
export type TerminalAcquisitionState = "completed" | "stopped" | "failed-clean" | "quarantined";

export const ACQUISITION_TRANSITIONS: Readonly<
  Record<AcquisitionState, readonly AcquisitionState[]>
> = Object.freeze({
  declared: ["preflighting"],
  preflighting: ["dispatch-ready", "stopped", "failed-clean"],
  "dispatch-ready": ["credential-ready", "stopped"],
  "credential-ready": ["attempt-active"],
  "attempt-active": ["waiting-retry", "response-accepted", "stopped", "failed-clean"],
  "response-accepted": ["artifact-committing", "failed-clean"],
  "artifact-committing": ["artifact-committed", "failed-clean"],
  "artifact-committed": ["artifact-verifying"],
  "artifact-verifying": ["page-verified", "failed-clean", "quarantined"],
  "page-verified": ["checkpointing"],
  checkpointing: ["chain-complete", "preflighting", "failed-clean"],
  "waiting-retry": ["preflighting", "stopped"],
  "chain-complete": ["normalizing"],
  normalizing: ["ready-for-selection", "quarantined", "failed-clean"],
  "ready-for-selection": ["selecting"],
  selecting: ["completed", "failed-clean", "quarantined"],
  completed: [],
  stopped: [],
  "failed-clean": [],
  quarantined: [],
} as const);

export type AcquisitionBudgets = Readonly<{
  successfulPages: number;
  verifiedBytes: number;
  records: number;
  normalizedFacts: number;
  attempts: number;
}>;

type ContinuationAuthority = Readonly<{
  nextTokenMaterial: string;
  nextTokenHash: string;
  nextContinuationBindingHash: string;
}>;

export type AcquisitionMachineSnapshot = Readonly<{
  schemaVersion: 1;
  requestIdentityHash: string;
  acquisitionConfigurationHash: string;
  marketAcquisitionJournalId: string;
  runSessionNonce: string;
  currentState: AcquisitionState;
  laneDisabled: boolean;
  terminalReason: MarketAcquisitionTerminalReason | null;
  pageOrdinal: number;
  pageAttemptsStarted: number;
  logicalPageIdentityHash: string;
  attemptOrdinal: number | null;
  attemptId: string | null;
  retrievalAttemptId: string | null;
  currentTokenHash: string;
  currentContinuationBindingHash: string | null;
  consumedTokenHashes: readonly string[];
  pageChainHash: string;
  continuationAuthority: ContinuationAuthority | null;
  budgets: AcquisitionBudgets;
  quotaWindowEvidence: readonly number[];
  acquisitionDeclaredMonotonicMs: number;
  lastMonotonicMs: number;
  pendingRetryDelayMs: number | null;
}>;

export type AcquisitionEventProof = Readonly<{
  requestIdentityHash: string;
  acquisitionConfigurationHash: string;
  marketAcquisitionJournalId: string;
  runSessionNonce: string;
  nowMonotonicMs: number;
  resourcesSettled: boolean;
}>;

type BaseEvent = Readonly<{ proof: AcquisitionEventProof }>;
export type AcquisitionEvent =
  | (BaseEvent & Readonly<{ kind: "begin-preflight" }>)
  | (BaseEvent & Readonly<{ kind: "preflight-approved" }>)
  | (BaseEvent &
      Readonly<{
        kind: "preflight-stopped";
        reason: MarketAcquisitionTerminalReason;
      }>)
  | (BaseEvent & Readonly<{ kind: "preflight-failed"; reason: MarketAcquisitionTerminalReason }>)
  | (BaseEvent & Readonly<{ kind: "credentials-loaded" }>)
  | (BaseEvent & Readonly<{ kind: "credential-unavailable" }>)
  | (BaseEvent &
      Readonly<{
        kind: "dispatch-started";
        deadlineProof: DeadlineProof;
        entitlementQuotaLimit: number;
      }>)
  | (BaseEvent &
      Readonly<{
        kind: "retry-cleanup-complete";
        context: RetryContext;
      }>)
  | (BaseEvent & Readonly<{ kind: "retry-delay-elapsed"; delayProof: RetryDelayProof }>)
  | (BaseEvent & Readonly<{ kind: "response-accepted" }>)
  | (BaseEvent & Readonly<{ kind: "attempt-stopped"; reason: MarketAcquisitionTerminalReason }>)
  | (BaseEvent & Readonly<{ kind: "attempt-failed"; reason: MarketAcquisitionTerminalReason }>)
  | (BaseEvent & Readonly<{ kind: "artifact-store-started" }>)
  | (BaseEvent & Readonly<{ kind: "artifact-store-committed" }>)
  | (BaseEvent & Readonly<{ kind: "artifact-store-failed" }>)
  | (BaseEvent & Readonly<{ kind: "artifact-verification-started" }>)
  | (BaseEvent & Readonly<{ kind: "page-verified" }>)
  | (BaseEvent & Readonly<{ kind: "page-verification-failed" }>)
  | (BaseEvent & Readonly<{ kind: "page-quarantined" }>)
  | (BaseEvent &
      Readonly<{
        kind: "page-checkpointed";
        pageChainInput: Omit<PageChainInput, "nextTokenHash">;
        nextTokenMaterial: string | null;
      }>)
  | (BaseEvent & Readonly<{ kind: "continue-next-page" }>)
  | (BaseEvent & Readonly<{ kind: "terminal-page-admitted" }>)
  | (BaseEvent & Readonly<{ kind: "normalization-started" }>)
  | (BaseEvent & Readonly<{ kind: "normalization-completed"; normalizedFactCount: number }>)
  | (BaseEvent & Readonly<{ kind: "normalization-failed" }>)
  | (BaseEvent & Readonly<{ kind: "normalization-quarantined" }>)
  | (BaseEvent & Readonly<{ kind: "selection-started" }>)
  | (BaseEvent & Readonly<{ kind: "selection-completed" }>)
  | (BaseEvent & Readonly<{ kind: "selection-failed" }>)
  | (BaseEvent & Readonly<{ kind: "selection-quarantined" }>)
  | (BaseEvent &
      Readonly<{
        kind: "policy-stopped";
        reason: MarketAcquisitionTerminalReason;
      }>);

export type AcquisitionTransitionPlan = Readonly<{
  eventKind: AcquisitionEvent["kind"];
  fromState: AcquisitionState;
  toState: AcquisitionState;
  checkpointKind: JournalCheckpointKind | null;
  next: AcquisitionMachineSnapshot;
}>;

export type PersistTransitionPlan = (plan: AcquisitionTransitionPlan) => Promise<void>;

const TERMINAL_STATES = new Set<AcquisitionState>([
  "completed",
  "stopped",
  "failed-clean",
  "quarantined",
]);
const HASH = /^[0-9a-f]{64}$/u;

const EVENT_TARGETS: Readonly<Record<AcquisitionEvent["kind"], AcquisitionState>> = {
  "begin-preflight": "preflighting",
  "preflight-approved": "dispatch-ready",
  "preflight-stopped": "stopped",
  "preflight-failed": "failed-clean",
  "credentials-loaded": "credential-ready",
  "credential-unavailable": "stopped",
  "dispatch-started": "attempt-active",
  "retry-cleanup-complete": "waiting-retry",
  "retry-delay-elapsed": "preflighting",
  "response-accepted": "response-accepted",
  "attempt-stopped": "stopped",
  "attempt-failed": "failed-clean",
  "artifact-store-started": "artifact-committing",
  "artifact-store-committed": "artifact-committed",
  "artifact-store-failed": "failed-clean",
  "artifact-verification-started": "artifact-verifying",
  "page-verified": "page-verified",
  "page-verification-failed": "failed-clean",
  "page-quarantined": "quarantined",
  "page-checkpointed": "checkpointing",
  "continue-next-page": "preflighting",
  "terminal-page-admitted": "chain-complete",
  "normalization-started": "normalizing",
  "normalization-completed": "ready-for-selection",
  "normalization-failed": "failed-clean",
  "normalization-quarantined": "quarantined",
  "selection-started": "selecting",
  "selection-completed": "completed",
  "selection-failed": "failed-clean",
  "selection-quarantined": "quarantined",
  "policy-stopped": "stopped",
};

const CHECKPOINT_FOR_EVENT: Partial<
  Readonly<Record<AcquisitionEvent["kind"], JournalCheckpointKind>>
> = {
  "begin-preflight": "acquisition-declared",
  "preflight-approved": "request-started",
  "dispatch-started": "attempt-started",
  "response-accepted": "request-succeeded",
  "artifact-store-committed": "artifact-committed",
  "page-verified": "artifact-verified",
  "page-checkpointed": "page-checkpointed",
  "terminal-page-admitted": "chain-complete",
  "normalization-started": "normalization-started",
  "normalization-completed": "normalization-complete",
  "selection-started": "selection-started",
  "selection-completed": "completed",
  "preflight-stopped": "stopped",
  "credential-unavailable": "stopped",
  "attempt-stopped": "stopped",
  "policy-stopped": "stopped",
  "preflight-failed": "failed-clean",
  "attempt-failed": "failed-clean",
  "artifact-store-failed": "failed-clean",
  "page-verification-failed": "failed-clean",
  "normalization-failed": "failed-clean",
  "selection-failed": "failed-clean",
  "page-quarantined": "quarantined",
  "normalization-quarantined": "quarantined",
  "selection-quarantined": "quarantined",
};

function requireSafeInteger(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name}-invalid`);
  }
}

function assertSortedUnique(values: readonly string[], name: string): void {
  for (const [index, value] of values.entries()) {
    if (!HASH.test(value)) throw new TypeError(`${name}-invalid`);
    if (
      index > 0 &&
      Buffer.compare(Buffer.from(values[index - 1] ?? ""), Buffer.from(value)) >= 0
    ) {
      throw new TypeError(`${name}-not-sorted-unique`);
    }
  }
}

function immutableSnapshot(value: AcquisitionMachineSnapshot): AcquisitionMachineSnapshot {
  return Object.freeze({
    ...value,
    consumedTokenHashes: Object.freeze([...value.consumedTokenHashes]),
    budgets: Object.freeze({ ...value.budgets }),
    quotaWindowEvidence: Object.freeze([...value.quotaWindowEvidence]),
    continuationAuthority:
      value.continuationAuthority === null
        ? null
        : Object.freeze({ ...value.continuationAuthority }),
  });
}

function validateSnapshot(snapshot: AcquisitionMachineSnapshot): void {
  canonicalJson({
    ...snapshot,
    // The state core intentionally contains only integer millisecond clocks.
  } as unknown as JsonValue);
  if (
    snapshot.schemaVersion !== 1 ||
    !HASH.test(snapshot.requestIdentityHash) ||
    !HASH.test(snapshot.acquisitionConfigurationHash) ||
    !HASH.test(snapshot.marketAcquisitionJournalId) ||
    snapshot.runSessionNonce.length === 0 ||
    !ACQUISITION_STATES.includes(snapshot.currentState)
  ) {
    throw new TypeError("acquisition-snapshot-invalid");
  }
  requireSafeInteger(
    snapshot.pageOrdinal,
    0,
    MARKET_ACQUISITION_LIMITS.successfulPages - 1,
    "page-ordinal",
  );
  const expectedLogicalPageIdentityHash = deriveLogicalPageIdentityHash({
    requestIdentityHash: snapshot.requestIdentityHash,
    pageOrdinal: snapshot.pageOrdinal,
    currentTokenHash: snapshot.currentTokenHash,
  });
  if (snapshot.logicalPageIdentityHash !== expectedLogicalPageIdentityHash) {
    throw new TypeError("snapshot-logical-page-identity-invalid");
  }
  if (snapshot.attemptOrdinal === null) {
    if (snapshot.attemptId !== null || snapshot.retrievalAttemptId !== null) {
      throw new TypeError("snapshot-attempt-identity-invalid");
    }
  } else {
    const expectedAttempt = deriveAttemptControlIdentities({
      logicalPageIdentityHash: snapshot.logicalPageIdentityHash,
      attemptOrdinal: snapshot.attemptOrdinal,
      runSessionNonce: snapshot.runSessionNonce,
    });
    if (
      expectedAttempt.attemptId !== snapshot.attemptId ||
      expectedAttempt.retrievalAttemptId !== snapshot.retrievalAttemptId
    ) {
      throw new TypeError("snapshot-attempt-identity-invalid");
    }
  }
  requireSafeInteger(
    snapshot.pageAttemptsStarted,
    0,
    MARKET_ACQUISITION_LIMITS.attemptsPerLogicalPage,
    "page-attempts",
  );
  requireSafeInteger(
    snapshot.budgets.successfulPages,
    0,
    MARKET_ACQUISITION_LIMITS.successfulPages,
    "successful-pages",
  );
  requireSafeInteger(
    snapshot.budgets.verifiedBytes,
    0,
    MARKET_ACQUISITION_LIMITS.aggregateVerifiedBytes,
    "verified-bytes",
  );
  requireSafeInteger(
    snapshot.budgets.records,
    0,
    MARKET_ACQUISITION_LIMITS.successfulPages * MARKET_ACQUISITION_LIMITS.recordsPerPage,
    "records",
  );
  requireSafeInteger(
    snapshot.budgets.normalizedFacts,
    0,
    MARKET_ACQUISITION_LIMITS.normalizedFacts,
    "normalized-facts",
  );
  requireSafeInteger(
    snapshot.budgets.attempts,
    0,
    MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition,
    "attempts",
  );
  requireSafeInteger(snapshot.acquisitionDeclaredMonotonicMs, 0, Number.MAX_SAFE_INTEGER, "start");
  requireSafeInteger(snapshot.lastMonotonicMs, 0, Number.MAX_SAFE_INTEGER, "last-monotonic");
  if (snapshot.lastMonotonicMs < snapshot.acquisitionDeclaredMonotonicMs) {
    throw new RangeError("snapshot-clock-regression");
  }
  if (
    snapshot.quotaWindowEvidence.length !== snapshot.budgets.attempts ||
    snapshot.quotaWindowEvidence.some(
      (value, index) =>
        !Number.isSafeInteger(value) ||
        value < snapshot.acquisitionDeclaredMonotonicMs ||
        value > snapshot.lastMonotonicMs ||
        (index > 0 && value < (snapshot.quotaWindowEvidence[index - 1] ?? 0)),
    )
  ) {
    throw new TypeError("snapshot-quota-evidence-invalid");
  }
  assertSortedUnique(snapshot.consumedTokenHashes, "consumed-token-hashes");
  if (
    (snapshot.pageOrdinal === 0) !==
    (snapshot.currentTokenHash === NO_TOKEN_HASH &&
      snapshot.currentContinuationBindingHash === null)
  ) {
    throw new TypeError("snapshot-token-state-invalid");
  }
  if (snapshot.pageOrdinal > 0 && !HASH.test(snapshot.currentTokenHash)) {
    throw new TypeError("snapshot-token-state-invalid");
  }
  if (snapshot.pageChainHash !== GENESIS_HASH && !HASH.test(snapshot.pageChainHash)) {
    throw new TypeError("snapshot-page-chain-invalid");
  }
  if (
    TERMINAL_STATES.has(snapshot.currentState) !== (snapshot.terminalReason !== null) ||
    (snapshot.currentState === "completed" && snapshot.terminalReason !== null)
  ) {
    // Completed is a successful terminal and deliberately carries no failure reason.
    if (snapshot.currentState !== "completed" || snapshot.terminalReason !== null) {
      throw new TypeError("snapshot-terminal-invalid");
    }
  }
}

function validateProof(snapshot: AcquisitionMachineSnapshot, proof: AcquisitionEventProof): void {
  if (
    proof.requestIdentityHash !== snapshot.requestIdentityHash ||
    proof.acquisitionConfigurationHash !== snapshot.acquisitionConfigurationHash ||
    proof.marketAcquisitionJournalId !== snapshot.marketAcquisitionJournalId ||
    proof.runSessionNonce !== snapshot.runSessionNonce ||
    !Number.isSafeInteger(proof.nowMonotonicMs) ||
    proof.nowMonotonicMs < snapshot.lastMonotonicMs
  ) {
    throw new TypeError("acquisition-event-proof-invalid");
  }
}

function assertTransition(from: AcquisitionState, to: AcquisitionState): void {
  if (!ACQUISITION_TRANSITIONS[from].includes(to)) {
    throw new TypeError("acquisition-transition-invalid");
  }
}

function terminalReasonForEvent(event: AcquisitionEvent): MarketAcquisitionTerminalReason | null {
  switch (event.kind) {
    case "preflight-stopped":
    case "preflight-failed":
    case "attempt-stopped":
    case "attempt-failed":
    case "policy-stopped":
      return event.reason;
    case "credential-unavailable":
      return "credential-unavailable";
    case "artifact-store-failed":
      return "artifact-store-failed";
    case "page-verification-failed":
      return "artifact-verification-failed";
    case "page-quarantined":
      return "delivery-conflict";
    case "normalization-failed":
      return "normalization-failed";
    case "normalization-quarantined":
      return "correction-unsupported";
    case "selection-failed":
      return "selection-failed";
    case "selection-quarantined":
      return "delivery-conflict";
    default:
      return null;
  }
}

function ensureResourcesSettled(event: AcquisitionEvent, target: AcquisitionState): void {
  if (
    (target === "waiting-retry" || target === "chain-complete" || TERMINAL_STATES.has(target)) &&
    !event.proof.resourcesSettled
  ) {
    throw new TypeError("acquisition-resources-unsettled");
  }
}

function deriveNext(
  snapshot: AcquisitionMachineSnapshot,
  event: AcquisitionEvent,
): AcquisitionMachineSnapshot {
  validateProof(snapshot, event.proof);
  const target = EVENT_TARGETS[event.kind];
  assertTransition(snapshot.currentState, target);
  ensureResourcesSettled(event, target);
  const next: AcquisitionMachineSnapshot = {
    ...snapshot,
    currentState: target,
    terminalReason: terminalReasonForEvent(event),
    lastMonotonicMs: event.proof.nowMonotonicMs,
  };

  switch (event.kind) {
    case "dispatch-started": {
      if (snapshot.laneDisabled) throw new TypeError("lane-disabled");
      validateDeadlineProof(event.deadlineProof);
      if (
        event.deadlineProof.acquisitionDeclaredMonotonicMs !==
          snapshot.acquisitionDeclaredMonotonicMs ||
        event.deadlineProof.nowMonotonicMs !== event.proof.nowMonotonicMs ||
        event.deadlineProof.attemptStartedMonotonicMs !== event.proof.nowMonotonicMs ||
        event.proof.nowMonotonicMs - snapshot.acquisitionDeclaredMonotonicMs >=
          MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs
      ) {
        throw new TypeError("deadline-proof-mismatch");
      }
      if (
        snapshot.pageAttemptsStarted >= MARKET_ACQUISITION_LIMITS.attemptsPerLogicalPage ||
        snapshot.budgets.attempts >= MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition
      ) {
        throw new RangeError("attempt-budget-exhausted");
      }
      const quota = evaluateRollingQuota(
        snapshot.quotaWindowEvidence,
        event.proof.nowMonotonicMs,
        event.entitlementQuotaLimit,
        snapshot.acquisitionDeclaredMonotonicMs + MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs,
      );
      if (quota.kind !== "admit") throw new RangeError(`dispatch-${quota.kind}`);
      const attemptOrdinal = snapshot.pageAttemptsStarted;
      const attempt = deriveAttemptControlIdentities({
        logicalPageIdentityHash: snapshot.logicalPageIdentityHash,
        attemptOrdinal,
        runSessionNonce: snapshot.runSessionNonce,
      });
      return immutableSnapshot({
        ...next,
        pageAttemptsStarted: snapshot.pageAttemptsStarted + 1,
        attemptOrdinal,
        attemptId: attempt.attemptId,
        retrievalAttemptId: attempt.retrievalAttemptId,
        budgets: { ...snapshot.budgets, attempts: snapshot.budgets.attempts + 1 },
        quotaWindowEvidence: quota.attemptStarts,
      });
    }
    case "retry-cleanup-complete": {
      if (
        event.context.pageAttemptsStarted !== snapshot.pageAttemptsStarted ||
        event.context.acquisitionAttemptsStarted !== snapshot.budgets.attempts
      ) {
        throw new TypeError("retry-context-mismatch");
      }
      const decision = decideRetry(event.context);
      if (decision.kind !== "retry") throw new TypeError(`retry-${decision.reason}`);
      if (
        !retryFitsAcquisitionDeadline(
          event.proof.nowMonotonicMs,
          decision.delayMs,
          snapshot.acquisitionDeclaredMonotonicMs,
        )
      ) {
        throw new RangeError("retry-acquisition-deadline");
      }
      return immutableSnapshot({ ...next, pendingRetryDelayMs: decision.delayMs });
    }
    case "retry-delay-elapsed": {
      if (snapshot.pendingRetryDelayMs === null) throw new TypeError("retry-delay-not-pending");
      validateRetryDelayProof(snapshot.pendingRetryDelayMs, event.delayProof);
      return immutableSnapshot({ ...next, pendingRetryDelayMs: null });
    }
    case "page-checkpointed": {
      const input = event.pageChainInput;
      if (
        input.priorPageChainHash !== snapshot.pageChainHash ||
        input.requestIdentityHash !== snapshot.requestIdentityHash ||
        input.logicalPageIdentityHash !== snapshot.logicalPageIdentityHash ||
        input.pageOrdinal !== snapshot.pageOrdinal ||
        input.currentTokenHash !== snapshot.currentTokenHash ||
        input.cumulativeSuccessfulPages !== snapshot.budgets.successfulPages + 1 ||
        input.cumulativeVerifiedBytes !==
          snapshot.budgets.verifiedBytes + input.artifactSizeBytes ||
        input.cumulativeRecords !== snapshot.budgets.records + input.pageRecordCount ||
        input.cumulativeNormalizedFacts !== 0 ||
        input.cumulativeAttempts !== snapshot.budgets.attempts
      ) {
        throw new TypeError("page-admission-proof-invalid");
      }
      const admission = planPageAdmission(input, event.nextTokenMaterial);
      return immutableSnapshot({
        ...next,
        budgets: {
          ...snapshot.budgets,
          successfulPages: input.cumulativeSuccessfulPages,
          verifiedBytes: input.cumulativeVerifiedBytes,
          records: input.cumulativeRecords,
        },
        pageChainHash: admission.pageChainHash,
        continuationAuthority:
          event.nextTokenMaterial === null || admission.nextContinuationBindingHash === null
            ? null
            : {
                nextTokenMaterial: event.nextTokenMaterial,
                nextTokenHash: admission.nextTokenHash,
                nextContinuationBindingHash: admission.nextContinuationBindingHash,
              },
      });
    }
    case "continue-next-page": {
      const authority = snapshot.continuationAuthority;
      if (authority === null) throw new TypeError("continuation-authority-missing");
      const recomputedTokenHash = derivePrivateTokenHash(authority.nextTokenMaterial);
      if (
        recomputedTokenHash !== authority.nextTokenHash ||
        snapshot.consumedTokenHashes.includes(recomputedTokenHash)
      ) {
        throw new TypeError("continuation-token-invalid");
      }
      return immutableSnapshot({
        ...next,
        pageOrdinal: snapshot.pageOrdinal + 1,
        pageAttemptsStarted: 0,
        logicalPageIdentityHash: deriveLogicalPageIdentityHash({
          requestIdentityHash: snapshot.requestIdentityHash,
          pageOrdinal: snapshot.pageOrdinal + 1,
          currentTokenHash: recomputedTokenHash,
        }),
        attemptOrdinal: null,
        attemptId: null,
        retrievalAttemptId: null,
        currentTokenHash: recomputedTokenHash,
        currentContinuationBindingHash: authority.nextContinuationBindingHash,
        consumedTokenHashes: [...snapshot.consumedTokenHashes, recomputedTokenHash].sort(),
        continuationAuthority: null,
      });
    }
    case "terminal-page-admitted":
      if (snapshot.continuationAuthority !== null) {
        throw new TypeError("terminal-page-has-continuation");
      }
      return immutableSnapshot(next);
    case "normalization-completed": {
      requireSafeInteger(
        event.normalizedFactCount,
        0,
        MARKET_ACQUISITION_LIMITS.normalizedFacts,
        "normalized-facts",
      );
      return immutableSnapshot({
        ...next,
        budgets: { ...snapshot.budgets, normalizedFacts: event.normalizedFactCount },
      });
    }
    case "attempt-stopped":
      return immutableSnapshot({
        ...next,
        laneDisabled:
          snapshot.laneDisabled ||
          event.reason === "lane-disabled" ||
          event.reason === "quota-exhausted",
      });
    case "selection-completed":
      return immutableSnapshot({ ...next, terminalReason: null });
    default:
      return immutableSnapshot(next);
  }
}

export function createInitialAcquisitionSnapshot(
  input: Readonly<{
    requestIdentityHash: string;
    acquisitionConfigurationHash: string;
    marketAcquisitionJournalId: string;
    runSessionNonce: string;
    acquisitionDeclaredMonotonicMs: number;
  }>,
): AcquisitionMachineSnapshot {
  const snapshot = immutableSnapshot({
    schemaVersion: 1,
    ...input,
    currentState: "declared",
    laneDisabled: false,
    terminalReason: null,
    pageOrdinal: 0,
    pageAttemptsStarted: 0,
    logicalPageIdentityHash: deriveLogicalPageIdentityHash({
      requestIdentityHash: input.requestIdentityHash,
      pageOrdinal: 0,
      currentTokenHash: NO_TOKEN_HASH,
    }),
    attemptOrdinal: null,
    attemptId: null,
    retrievalAttemptId: null,
    currentTokenHash: NO_TOKEN_HASH,
    currentContinuationBindingHash: null,
    consumedTokenHashes: [],
    pageChainHash: GENESIS_HASH,
    continuationAuthority: null,
    budgets: {
      successfulPages: 0,
      verifiedBytes: 0,
      records: 0,
      normalizedFacts: 0,
      attempts: 0,
    },
    quotaWindowEvidence: [],
    lastMonotonicMs: input.acquisitionDeclaredMonotonicMs,
    pendingRetryDelayMs: null,
  });
  validateSnapshot(snapshot);
  return snapshot;
}

export class AcquisitionStateMachine {
  #snapshot: AcquisitionMachineSnapshot;
  readonly #persist: PersistTransitionPlan;

  constructor(snapshot: AcquisitionMachineSnapshot, persist: PersistTransitionPlan) {
    validateSnapshot(snapshot);
    if (typeof persist !== "function") {
      throw new TypeError("acquisition-durable-persistence-required");
    }
    this.#snapshot = immutableSnapshot(snapshot);
    this.#persist = persist;
  }

  get snapshot(): AcquisitionMachineSnapshot {
    return this.#snapshot;
  }

  /**
   * Validates the full event and prospective state before persistence. The in-memory state changes
   * only after the supplied durable-plan callback succeeds.
   */
  async applyAcquisitionEvent(event: AcquisitionEvent): Promise<AcquisitionTransitionPlan> {
    const before = this.#snapshot;
    const next = deriveNext(before, event);
    validateSnapshot(next);
    const plan = Object.freeze({
      eventKind: event.kind,
      fromState: before.currentState,
      toState: next.currentState,
      checkpointKind: CHECKPOINT_FOR_EVENT[event.kind] ?? null,
      next,
    });
    await this.#persist(plan);
    this.#snapshot = next;
    return plan;
  }
}
