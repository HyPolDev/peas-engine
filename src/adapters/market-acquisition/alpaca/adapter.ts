import { snapshotNormalizerBytes } from "../../../providers/normalizer-input.js";
import { canonicalJson, type JsonValue } from "../../../core/json.js";
import { canonicalHash } from "../../../core/hash.js";
import { P1_10_TEST_AUTHORITY } from "../../../internal-test-authority.js";
import type { StoreArtifactResult } from "../../../artifacts/artifact-store.js";
import { persistedRetrievalAttemptId } from "../../../artifacts/validation.js";
import {
  createObservationLedgerEntry,
  type ClockStampV1,
  type ObservationLedgerEntryV1,
} from "../../../providers/observation-ledger.js";
import {
  deriveArtifactContentId,
  deriveMarketAcquisitionId,
  deriveRawArtifactId,
} from "../../../providers/market-reference/identity.js";
import { normalizeRecordedMarketRecords } from "../../../providers/market-reference/normalization.js";
import {
  createMarketAcquisitionSafeError,
  MARKET_ACQUISITION_LIMITS,
  ROUTE_POLICY_VERSION,
  type MarketAcquisitionOperationStage,
  type MarketAcquisitionTerminalReason,
} from "../contracts.js";
import type { RetryFailure } from "../retry.js";
import { decideRetry, parseRetryAfterMs } from "../retry.js";
import {
  authorizeCredentialLoad,
  assertCredentialIsolatedAlpacaTransport,
  assertOwnedDurableCredentialAuthorizationBoundary,
  credentialAuthorizationDenialReason,
  discardCredentialPreflightPermit,
  discardOwnedAlpacaArtifactCommitAuthority,
  isOwnedProductionCredentialAuthorizationBoundary,
  issueOwnedAlpacaArtifactCommitAuthority,
  ownedCredentialAttemptStateEvidence,
  ownedCredentialMigrations,
  ownedCredentialTrustedNowMs,
  loadOwnedAcquisitionStateSnapshot,
  ownedLiveCredentialAcquisitionJournal,
  persistOwnedAcquisitionTransition,
  remainingCredentialAttemptBudgetMs,
  type DurableCredentialAuthorizationBoundary,
  withAlpacaAuthorization,
  type CredentialAuthorizationRequest,
  type CredentialAttemptResult,
  type CredentialPreflightPermit,
  type AlpacaArtifactCommitAuthority,
  type RuntimeSecretSource,
} from "../credentials.js";
import {
  deriveAcquisitionTransition,
  type AcquisitionEvent,
  type AcquisitionEventProof,
  type AcquisitionMachineSnapshot,
  type AcquisitionTransitionPlan,
  type OwnedAcquisitionTransitionBinding,
} from "../state-machine.js";
import {
  attachLedgerEvidence,
  persistOwnedProductionAcquisitionWorkflowEvidence,
  type VerifiedAcquisitionWorkflowEvidenceInput,
} from "../artifact-integration.js";
import {
  createJournalEntry,
  deriveMarketAcquisitionJournalId,
  journalEntryBody,
  TERMINAL_TOKEN_HASH,
  type JournalCheckpointBody,
  type JournalEntry,
  type JournalIdentityInput,
  type PageChainInput,
} from "../journal.js";
import {
  beginRetentionUse,
  createRetentionEnforcedArtifactStore,
  registerRetentionDerivedLineage,
} from "../retention/artifact-access.js";
import { openOwnedDurableAlpacaWireSemanticEvidenceBoundary } from "./wire-semantic-evidence.js";
import {
  authenticatedAlpacaAdmissionArtifact,
  openOwnedDurableAlpacaWireAdmissionBoundary,
  parseAndAdmitAlpacaHistoricalPage,
  resolveAlpacaHistoricalChain,
  type AlpacaWirePageAdmission,
} from "./wire.js";
import type {
  AlpacaAttemptFailure,
  AlpacaAttemptInput,
  AlpacaAttemptResource,
  AlpacaAttemptResult,
  AlpacaBodyRead,
  AlpacaDeadlineHandle,
  AlpacaPageAuthority,
  AlpacaTransportRequestLease,
  AlpacaTransportResponse,
  VerifiedContinuationPage,
} from "./contracts.js";
import { buildAlpacaTransportRequest } from "./request.js";
import {
  assertRetentionOwnedAlpacaPageSink,
  bindRetentionOwnedAlpacaPageSinkAttempt,
  consumeOwnedAlpacaCommittedPageResult,
} from "./retained-sink.js";
import { assertOwnedAlpacaDeadlineScheduler } from "./deadline.js";
import { AlpacaDeadlineElapsed } from "./deadline.js";

class DeadlineElapsed {}

class AttemptFailure {
  constructor(
    readonly reason: MarketAcquisitionTerminalReason,
    readonly stage: MarketAcquisitionOperationStage,
    readonly retryFailure: RetryFailure,
    readonly laneDisabled = false,
  ) {}
}

type InflightOperation = Promise<unknown> | null;
const ownedProductionTransitionReceipts = new WeakMap<object, OwnedAcquisitionTransitionBinding>();
const ownedProductionWorkflowReceipts = new WeakMap<
  object,
  VerifiedAcquisitionWorkflowEvidenceInput
>();

function failure(
  reason: MarketAcquisitionTerminalReason,
  stage: MarketAcquisitionOperationStage,
  retryFailure: RetryFailure,
  laneDisabled = false,
): never {
  throw new AttemptFailure(reason, stage, retryFailure, laneDisabled);
}

function validateResponse(value: AlpacaTransportResponse): void {
  if (
    value === null ||
    typeof value !== "object" ||
    !Number.isSafeInteger(value.status) ||
    value.status < 100 ||
    value.status > 599 ||
    (value.contentLength !== null &&
      (!Number.isSafeInteger(value.contentLength) || value.contentLength < 0)) ||
    (value.retryAfter !== null && typeof value.retryAfter !== "string") ||
    !["temporary-throttling-proved", "quota-exhausted", "missing", "ambiguous"].includes(
      value.quotaClassification,
    ) ||
    value.body === null ||
    typeof value.body !== "object" ||
    !Array.isArray(value.siblingResources)
  ) {
    failure("schema-invalid", "response-headers", { kind: "schema" });
  }
}

function classifyHttp(response: AlpacaTransportResponse): never {
  if (response.status === 429 && response.retryAfter !== null) {
    try {
      parseRetryAfterMs(response.retryAfter);
    } catch {
      return failure("retry-after-invalid", "response-headers", { kind: "malformed-body" });
    }
  }
  const retryFailure: RetryFailure = {
    kind: "http",
    status: response.status,
    quotaClassification: response.quotaClassification,
    retryAfter: response.status === 429 ? response.retryAfter : null,
  };
  if (response.status === 401 || response.status === 403) {
    return failure("lane-disabled", "response-headers", retryFailure, true);
  }
  if (response.status === 429 && response.quotaClassification === "quota-exhausted") {
    return failure("quota-exhausted", "response-headers", retryFailure);
  }
  if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
    return failure("transport-failed", "response-headers", retryFailure);
  }
  return failure("http-nonretryable", "response-headers", retryFailure);
}

async function boundedBoolean(
  operation: Promise<unknown>,
  expired: Promise<void>,
): Promise<boolean> {
  let completed = false;
  let immediate = false;
  const guarded = operation.then(
    () => {
      completed = true;
      immediate = true;
      return true;
    },
    () => {
      completed = true;
      immediate = false;
      return false;
    },
  );
  await Promise.resolve();
  if (completed) return immediate;
  return Promise.race([guarded, expired.then(() => false)]);
}

async function settleAll(
  resources: readonly AlpacaAttemptResource[],
  expired: Promise<void>,
): Promise<boolean> {
  const outcomes = await Promise.all(
    resources.map((resource) => boundedBoolean(resource.settle(), expired)),
  );
  return outcomes.every(Boolean);
}

async function abortDestroyAll(
  resources: readonly AlpacaAttemptResource[],
  expired: Promise<void>,
): Promise<boolean> {
  const aborted = await Promise.all(
    resources.map((resource) => boundedBoolean(resource.abort(), expired)),
  );
  const destroyed = await Promise.all(
    resources.map((resource) => boundedBoolean(resource.destroy(), expired)),
  );
  return (
    (await settleAll(resources, expired)) && aborted.every(Boolean) && destroyed.every(Boolean)
  );
}

async function settleTimer(handle: AlpacaDeadlineHandle): Promise<boolean> {
  try {
    handle.cancel();
  } catch {
    return false;
  }
  return boundedBoolean(handle.settle(), handle.expired);
}

function safeFailure(attempt: AttemptFailure, resourcesSettled: boolean): AlpacaAttemptFailure {
  const settledAttempt =
    resourcesSettled && attempt.retryFailure.kind === "clean-partial-body-transport"
      ? new AttemptFailure(
          attempt.reason,
          attempt.stage,
          { kind: "clean-partial-body-transport", resourcesSettled: true },
          attempt.laneDisabled,
        )
      : attempt;
  const finalAttempt = resourcesSettled
    ? settledAttempt
    : new AttemptFailure(
        "partial-cleanup-failed",
        "cleanup",
        { kind: "cleanup-unprovable" },
        attempt.laneDisabled,
      );
  return Object.freeze({
    ok: false,
    error: createMarketAcquisitionSafeError(finalAttempt.reason, finalAttempt.stage),
    retryFailure: finalAttempt.retryFailure,
    laneDisabled: finalAttempt.laneDisabled,
    resourcesSettled,
  });
}

/**
 * Executes one already-authorized Alpaca page attempt. There is deliberately no default
 * transport: production code can reach this boundary only by explicitly supplying the reviewed
 * transport, validated plan, credential-boundary headers, private sink, and deadline scheduler.
 */
type AuthorizedAlpacaAttemptInput<T> = Readonly<{
  dispatchCapability: AlpacaAttemptInput<T>["dispatchCapability"];
  transport: AlpacaAttemptInput<T>["transport"];
  artifactSink: AlpacaAttemptInput<T>["artifactSink"];
  requestLease: AlpacaTransportRequestLease;
  abortController: AbortController;
  deadline: AlpacaDeadlineHandle;
  machine: OwnedProductionAcquisitionState | null;
  stateProof(): AcquisitionEventProof;
}>;

async function executeAlpacaAttempt<T>(
  input: AuthorizedAlpacaAttemptInput<T>,
): Promise<AlpacaAttemptResult<T>> {
  const { abortController, deadline } = input;
  try {
    assertRetentionOwnedAlpacaPageSink(input.artifactSink);
  } catch {
    return safeFailure(
      new AttemptFailure("configuration-invalid", "request-preflight", { kind: "authorization" }),
      true,
    );
  }
  let response: AlpacaTransportResponse | null = null;
  let inflight: InflightOperation = null;
  let timedOut = false;
  const run = async <R>(operation: Promise<R>): Promise<R> => {
    const tracked = operation.finally(() => {
      if (inflight === tracked) inflight = null;
    });
    inflight = tracked;
    const outcome = await Promise.race([
      tracked,
      deadline.expired.then(() => {
        timedOut = true;
        abortController.abort();
        throw new DeadlineElapsed();
      }),
    ]);
    return outcome;
  };
  try {
    try {
      response = await run(input.transport.dispatch(input.dispatchCapability));
    } catch (error) {
      if (error instanceof DeadlineElapsed || error instanceof AlpacaDeadlineElapsed) {
        return failure("attempt-timeout", "dispatch", { kind: "pre-response-transport" });
      }
      return failure("transport-failed", "dispatch", { kind: "pre-response-transport" });
    } finally {
      input.requestLease.release();
    }
    validateResponse(response);
    if (response.status !== 200) classifyHttp(response);
    if (
      response.contentLength !== null &&
      response.contentLength > MARKET_ACQUISITION_LIMITS.rawArtifactBytes
    ) {
      return failure("bound-exceeded", "response-headers", { kind: "bound" });
    }
    let consumedBytes = 0;
    while (true) {
      let item: AlpacaBodyRead;
      try {
        item = await run(response.body.read());
      } catch (error) {
        if (error instanceof DeadlineElapsed) {
          return failure("attempt-timeout", "response-body", {
            kind: "clean-partial-body-transport",
            resourcesSettled: false,
          });
        }
        return failure("transport-failed", "response-body", {
          kind: "clean-partial-body-transport",
          resourcesSettled: false,
        });
      }
      if (item.done) break;
      let bytes: Uint8Array;
      try {
        bytes = snapshotNormalizerBytes(
          item.bytes,
          MARKET_ACQUISITION_LIMITS.rawArtifactBytes - consumedBytes,
        );
      } catch {
        return failure("bound-exceeded", "response-body", { kind: "bound" });
      }
      consumedBytes += bytes.byteLength;
      try {
        await run(input.artifactSink.write(bytes));
      } catch (error) {
        if (error instanceof DeadlineElapsed) {
          return failure("attempt-timeout", "artifact-commit", { kind: "artifact" });
        }
        return failure("artifact-store-failed", "artifact-commit", { kind: "artifact" });
      }
    }
    if (response.contentLength !== null && response.contentLength !== consumedBytes) {
      return failure("response-length-mismatch", "response-body", { kind: "malformed-body" });
    }
    if (input.machine !== null) {
      await input.machine.responseAccepted(input.stateProof().nowMonotonicMs);
      await input.machine.artifactStoreStarted(input.stateProof().nowMonotonicMs);
    }
    let artifact: T;
    try {
      artifact = await run(input.artifactSink.completeVerifyAndRegisterOwnership());
    } catch (error) {
      if (error instanceof DeadlineElapsed) {
        return failure("attempt-timeout", "artifact-commit", { kind: "artifact" });
      }
      return failure("artifact-store-failed", "artifact-commit", { kind: "artifact" });
    }
    const resources = [response.body, ...response.siblingResources];
    const responseSettled = await settleAll(resources, deadline.expired);
    const transportSettled = await boundedBoolean(input.transport.settle(), deadline.expired);
    const sinkSettled = await boundedBoolean(input.artifactSink.settle(), deadline.expired);
    const timerSettled = await settleTimer(deadline);
    const resourcesSettled = responseSettled && transportSettled && sinkSettled && timerSettled;
    if (!resourcesSettled) {
      await abortDestroyAll([input.artifactSink, ...resources], deadline.expired);
      await boundedBoolean(input.transport.abort(), deadline.expired);
      await boundedBoolean(input.transport.settle(), deadline.expired);
      return safeFailure(
        new AttemptFailure("partial-cleanup-failed", "cleanup", {
          kind: "cleanup-unprovable",
        }),
        false,
      );
    }
    if (input.machine !== null) {
      await input.machine.artifactStoreCommitted(input.stateProof().nowMonotonicMs);
      await input.machine.artifactVerificationStarted(input.stateProof().nowMonotonicMs);
      await input.machine.pageVerified(input.stateProof().nowMonotonicMs);
    }
    return Object.freeze({
      ok: true,
      artifact,
      status: 200,
      declaredContentLength: response.contentLength,
      consumedBytes,
      resourcesSettled: true,
    });
  } catch (error) {
    const attempt =
      error instanceof AttemptFailure
        ? error
        : new AttemptFailure("configuration-invalid", "request-preflight", {
            kind: "authorization",
          });
    abortController.abort();
    const transportAborted = await boundedBoolean(input.transport.abort(), deadline.expired);
    const resources: AlpacaAttemptResource[] = [input.artifactSink];
    if (response !== null) resources.push(response.body, ...response.siblingResources);
    const ownedResourcesSettled = await abortDestroyAll(resources, deadline.expired);
    const transportSettled = await boundedBoolean(input.transport.settle(), deadline.expired);
    const resourcesSettled = transportAborted && ownedResourcesSettled && transportSettled;
    if (inflight !== null) {
      try {
        await boundedBoolean(inflight, deadline.expired);
      } catch {}
    }
    const timerSettled = await settleTimer(deadline);
    return safeFailure(
      attempt,
      resourcesSettled && timerSettled && (!timedOut || inflight === null),
    );
  }
}

export type AlpacaProductionAttemptInput<T> = Readonly<
  Omit<AlpacaAttemptInput<T>, "plan" | "dispatchCapability" | "attemptBudgetMs"> & {
    plan: AlpacaAttemptInput<T>["plan"];
    credentialAuthorization: CredentialAuthorizationRequest;
  }
>;

/**
 * Production-only durable state composer. The class and its transition-minting methods never
 * cross the module boundary; callers can inspect neither a mutable machine nor a write authority.
 */
class OwnedProductionAcquisitionState {
  #snapshot: AcquisitionMachineSnapshot;
  readonly #authorization: DurableCredentialAuthorizationBoundary;

  constructor(authorization: DurableCredentialAuthorizationBoundary) {
    this.#authorization = authorization;
    this.#snapshot = loadOwnedAcquisitionStateSnapshot(authorization);
  }

  get snapshot(): AcquisitionMachineSnapshot {
    return this.#snapshot;
  }

  async #apply(event: AcquisitionEvent): Promise<AcquisitionTransitionPlan> {
    const derived = deriveAcquisitionTransition(this.#snapshot, event);
    const receipt = Object.freeze({ kind: "owned-production-acquisition-transition" as const });
    ownedProductionTransitionReceipts.set(
      receipt,
      Object.freeze({
        planJson: canonicalJson(derived.plan as unknown as JsonValue),
        eventJson: canonicalJson(derived.event as unknown as JsonValue),
      }),
    );
    try {
      await persistOwnedAcquisitionTransition(this.#authorization, receipt);
    } catch (error) {
      ownedProductionTransitionReceipts.delete(receipt);
      throw error;
    }
    this.#snapshot = derived.plan.next;
    return derived.plan;
  }

  #proof(nowMonotonicMs: number, resourcesSettled = true): AcquisitionEventProof {
    return Object.freeze({
      requestIdentityHash: this.#snapshot.requestIdentityHash,
      acquisitionConfigurationHash: this.#snapshot.acquisitionConfigurationHash,
      marketAcquisitionJournalId: this.#snapshot.marketAcquisitionJournalId,
      runSessionNonce: this.#snapshot.runSessionNonce,
      nowMonotonicMs,
      resourcesSettled,
    });
  }

  beginPreflight(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "begin-preflight", proof: this.#proof(nowMonotonicMs) });
  }
  approvePreflight(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "preflight-approved", proof: this.#proof(nowMonotonicMs) });
  }
  credentialsLoaded(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "credentials-loaded", proof: this.#proof(nowMonotonicMs) });
  }
  dispatchStarted(
    nowMonotonicMs: number,
    entitlementQuotaLimit: number,
  ): Promise<AcquisitionTransitionPlan> {
    return this.#apply({
      kind: "dispatch-started",
      proof: this.#proof(nowMonotonicMs),
      deadlineProof: Object.freeze({
        acquisitionDeclaredMonotonicMs: this.#snapshot.acquisitionDeclaredMonotonicMs,
        attemptStartedMonotonicMs: nowMonotonicMs,
        nowMonotonicMs,
      }),
      entitlementQuotaLimit,
    });
  }
  responseAccepted(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "response-accepted", proof: this.#proof(nowMonotonicMs) });
  }
  artifactStoreStarted(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "artifact-store-started", proof: this.#proof(nowMonotonicMs) });
  }
  artifactStoreCommitted(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "artifact-store-committed", proof: this.#proof(nowMonotonicMs) });
  }
  artifactVerificationStarted(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({
      kind: "artifact-verification-started",
      proof: this.#proof(nowMonotonicMs),
    });
  }
  pageVerified(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "page-verified", proof: this.#proof(nowMonotonicMs) });
  }
  pageCheckpointed(
    nowMonotonicMs: number,
    pageChainInput: Omit<PageChainInput, "nextTokenHash">,
    nextTokenMaterial: string | null,
  ): Promise<AcquisitionTransitionPlan> {
    return this.#apply({
      kind: "page-checkpointed",
      proof: this.#proof(nowMonotonicMs),
      pageChainInput,
      nextTokenMaterial,
    });
  }
  terminalPageAdmitted(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "terminal-page-admitted", proof: this.#proof(nowMonotonicMs) });
  }
  continueNextPage(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "continue-next-page", proof: this.#proof(nowMonotonicMs) });
  }
  retryCleanup(
    nowMonotonicMs: number,
    failure: RetryFailure,
    resourcesSettled: boolean,
  ): Promise<AcquisitionTransitionPlan> {
    return this.#apply({
      kind: "retry-cleanup-complete",
      proof: this.#proof(nowMonotonicMs, resourcesSettled),
      context: Object.freeze({
        failure,
        pageAttemptsStarted: this.#snapshot.pageAttemptsStarted,
        acquisitionAttemptsStarted: this.#snapshot.budgets.attempts,
      }),
    });
  }
  retryDelayElapsed(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    const delayMs = this.#snapshot.pendingRetryDelayMs;
    if (delayMs === null) throw new TypeError("retry-delay-not-pending");
    return this.#apply({
      kind: "retry-delay-elapsed",
      proof: this.#proof(nowMonotonicMs),
      delayProof: Object.freeze({
        clockBasis: "same-session-monotonic" as const,
        elapsedMs: delayMs,
        monotonicOrderValid: true,
      }),
    });
  }
  attemptFailed(
    nowMonotonicMs: number,
    reason: MarketAcquisitionTerminalReason,
  ): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "attempt-failed", reason, proof: this.#proof(nowMonotonicMs) });
  }
  artifactStoreFailed(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "artifact-store-failed", proof: this.#proof(nowMonotonicMs) });
  }
  pageVerificationFailed(nowMonotonicMs: number): Promise<AcquisitionTransitionPlan> {
    return this.#apply({ kind: "page-verification-failed", proof: this.#proof(nowMonotonicMs) });
  }
}

async function ownedContinuationPage(
  authorization: DurableCredentialAuthorizationBoundary,
  plan: AlpacaAttemptInput<unknown>["plan"],
  snapshot: AcquisitionMachineSnapshot,
  advance: boolean,
): Promise<VerifiedContinuationPage> {
  const targetPageOrdinal = snapshot.pageOrdinal + (advance ? 1 : 0);
  if (targetPageOrdinal < 1) throw new TypeError("owned-continuation-page-invalid");
  const journal = await ownedLiveCredentialAcquisitionJournal(authorization, plan);
  const entries = await journal.load(snapshot.marketAcquisitionJournalId);
  const preceding = [...entries]
    .reverse()
    .find(
      (entry) =>
        entry.checkpointKind === "page-checkpointed" && entry.pageOrdinal === targetPageOrdinal - 1,
    );
  if (
    preceding === undefined ||
    preceding.artifactObservationId === null ||
    preceding.artifactDigest === null ||
    preceding.nextTokenHash === null ||
    preceding.nextTokenHash === TERMINAL_TOKEN_HASH ||
    preceding.nextResumableTokenMaterial === null ||
    preceding.nextContinuationBindingHash === null
  ) {
    throw new TypeError("owned-continuation-checkpoint-invalid");
  }
  const tokenMaterial = preceding.nextResumableTokenMaterial;
  const currentTokenHash = preceding.nextTokenHash;
  const currentContinuationBindingHash = preceding.nextContinuationBindingHash;
  if (
    advance &&
    (snapshot.continuationAuthority?.nextTokenMaterial !== tokenMaterial ||
      snapshot.continuationAuthority.nextTokenHash !== currentTokenHash ||
      snapshot.continuationAuthority.nextContinuationBindingHash !== currentContinuationBindingHash)
  ) {
    throw new TypeError("owned-continuation-authority-mismatch");
  }
  if (
    !advance &&
    (snapshot.currentTokenHash !== currentTokenHash ||
      snapshot.currentContinuationBindingHash !== currentContinuationBindingHash)
  ) {
    throw new TypeError("owned-continuation-state-mismatch");
  }
  const previouslyConsumedTokenHashes = snapshot.consumedTokenHashes.filter(
    (value) => value !== currentTokenHash,
  );
  return Object.freeze({
    kind: "verified-continuation" as const,
    pageOrdinal: targetPageOrdinal,
    tokenMaterial,
    currentTokenHash,
    currentContinuationBindingHash,
    previouslyConsumedTokenHashes: Object.freeze([...previouslyConsumedTokenHashes].sort()),
    preceding: Object.freeze({
      marketAcquisitionId: preceding.marketAcquisitionId,
      requestIdentityHash: preceding.requestIdentityHash,
      logicalPageIdentityHash: preceding.logicalPageIdentityHash,
      pageOrdinal: preceding.pageOrdinal,
      artifactObservationId: preceding.artifactObservationId,
      artifactDigest: preceding.artifactDigest,
      pageChainHash: preceding.pageChainHash,
      nextTokenHash: currentTokenHash,
      nextContinuationBindingHash: currentContinuationBindingHash,
    }),
  });
}

function liveJournalIdentity(plan: AlpacaAttemptInput<unknown>["plan"]): JournalIdentityInput {
  return Object.freeze({
    schemaVersion: 1,
    requestIdentityHash: plan.requestIdentityHash,
    providerId: plan.route.providerId,
    datasetId: plan.route.datasetId,
    feedId: plan.route.feedId,
    endpointChannelId: plan.route.endpointChannelId,
  });
}

function nextLedgerClock(
  ledger: readonly ObservationLedgerEntryV1[],
  clockBasisId: string,
  trustedNowMs: number,
): ClockStampV1 {
  const sameBasis = ledger.filter((entry) => entry.clock.clockBasisId === clockBasisId);
  const lastWall = Math.max(
    trustedNowMs,
    ...sameBasis.flatMap((entry) =>
      entry.clock.wallTimeMs === null ? [] : [entry.clock.wallTimeMs],
    ),
  );
  const lastMonotonic = Math.max(
    trustedNowMs * 1_000,
    ...sameBasis.flatMap((entry) =>
      entry.clock.monotonicTimeUs === null ? [] : [entry.clock.monotonicTimeUs],
    ),
  );
  return Object.freeze({
    clockBasisId,
    wallTimeMs: lastWall,
    monotonicTimeUs: lastMonotonic + 1,
  });
}

async function persistOwnedVerifiedPageArtifact(
  authorization: DurableCredentialAuthorizationBoundary,
  plan: AlpacaAttemptInput<unknown>["plan"],
  acquisitionObservationId: string,
  machine: OwnedProductionAcquisitionState,
  result: StoreArtifactResult,
): Promise<void> {
  const composition = consumeOwnedAlpacaCommittedPageResult(result as object);
  const artifactStore = createRetentionEnforcedArtifactStore(
    composition.store,
    composition.retention,
  );
  const journal = await ownedLiveCredentialAcquisitionJournal(authorization, plan);
  const expectedIdentity = liveJournalIdentity(plan);
  const journalId = deriveMarketAcquisitionJournalId(expectedIdentity);
  const currentJournal = [...(await journal.load(journalId))];
  const ledger = [...(await journal.loadLedgerEntries())];
  const clockDeclaration = ledger.find((entry) => entry.facts.kind === "clock-basis.declared");
  if (clockDeclaration?.facts.kind !== "clock-basis.declared") {
    throw new TypeError("owned-workflow-clock-declaration-missing");
  }
  const snapshot = machine.snapshot;
  if (snapshot.currentState !== "page-verified") {
    throw new TypeError("owned-workflow-page-state-mismatch");
  }
  if (
    snapshot.attemptId === null ||
    snapshot.retrievalAttemptId === null ||
    snapshot.attemptOrdinal === null
  ) {
    throw new TypeError("owned-workflow-attempt-state-missing");
  }
  if (persistedRetrievalAttemptId(snapshot.retrievalAttemptId) !== result.observation.attemptId) {
    throw new TypeError("owned-workflow-artifact-attempt-mismatch");
  }
  if (acquisitionObservationId.length === 0) {
    throw new TypeError("owned-workflow-acquisition-observation-missing");
  }
  const attemptId = snapshot.attemptId;
  const retrievalAttemptId = snapshot.retrievalAttemptId;
  const attemptOrdinal = snapshot.attemptOrdinal;
  if (attemptId === null || retrievalAttemptId === null || attemptOrdinal === null) {
    throw new TypeError("owned-workflow-page-result-mismatch");
  }
  const executionId = clockDeclaration.executionId;
  let clock = nextLedgerClock(
    ledger,
    clockDeclaration.facts.clockBasis.clockBasisId,
    ownedCredentialTrustedNowMs(authorization),
  );
  let acquisition = ledger.find(
    (entry) =>
      entry.facts.kind === "acquisition.declared" &&
      entry.facts.retrievalAttemptId === snapshot.retrievalAttemptId &&
      entry.facts.acquisitionObservationId === acquisitionObservationId,
  );
  if (acquisition === undefined) {
    acquisition = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId,
      parentEntryIds: [clockDeclaration.entryId],
      clock,
      facts: {
        kind: "acquisition.declared",
        acquisitionObservationId,
        provider: "alpaca",
        retrievalAttemptId: snapshot.retrievalAttemptId,
        sanitizedRequestIdentityHash: plan.requestIdentityHash,
        routeLabel: plan.route.safeRouteLabel,
      },
    });
    ledger.push(acquisition);
    clock = nextLedgerClock(
      ledger,
      clockDeclaration.facts.clockBasis.clockBasisId,
      ownedCredentialTrustedNowMs(authorization),
    );
  }
  let started = ledger.find(
    (entry) =>
      entry.facts.kind === "request.started" &&
      entry.facts.acquisitionObservationId === acquisitionObservationId &&
      entry.parentEntryIds.includes(acquisition.entryId),
  );
  if (started === undefined) {
    started = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId,
      parentEntryIds: [acquisition.entryId, clockDeclaration.entryId].sort(),
      clock,
      facts: { kind: "request.started", acquisitionObservationId },
    });
    ledger.push(started);
    clock = nextLedgerClock(
      ledger,
      clockDeclaration.facts.clockBasis.clockBasisId,
      ownedCredentialTrustedNowMs(authorization),
    );
  }
  const succeeded = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId,
    parentEntryIds: [clockDeclaration.entryId, started.entryId].sort(),
    clock,
    facts: {
      kind: "request.succeeded",
      acquisitionObservationId,
      safeResponseMetadataHash: canonicalHash(
        "peas/alpaca-safe-response-metadata/v1",
        result.observation.response as unknown as JsonValue,
      ),
    },
  });
  ledger.push(succeeded);
  clock = nextLedgerClock(
    ledger,
    clockDeclaration.facts.clockBasis.clockBasisId,
    ownedCredentialTrustedNowMs(authorization),
  );
  const committed = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId,
    parentEntryIds: [acquisition.entryId, clockDeclaration.entryId, succeeded.entryId].sort(),
    clock,
    facts: {
      kind: "artifact.committed",
      acquisitionObservationId,
      vaultObservationId: result.observation.observationId,
      vaultObservationHash: result.observation.observationHash,
      artifactDigest: result.artifact.digest,
      sizeBytes: result.artifact.sizeBytes,
      acquisitionMode: "live",
      retrievedAtMs: result.observation.retrievedAtMs,
    },
  });
  ledger.push(committed);
  clock = nextLedgerClock(
    ledger,
    clockDeclaration.facts.clockBasis.clockBasisId,
    ownedCredentialTrustedNowMs(authorization),
  );
  const verified = createObservationLedgerEntry({
    schemaVersion: 1,
    executionId,
    parentEntryIds: [clockDeclaration.entryId, committed.entryId].sort(),
    clock,
    facts: {
      kind: "artifact.verified",
      acquisitionObservationId,
      vaultObservationId: result.observation.observationId,
      artifactDigest: result.artifact.digest,
      metadataSizeBytes: result.artifact.sizeBytes,
      consumedSizeBytes: result.artifact.sizeBytes,
    },
  });
  ledger.push(verified);

  const marketAcquisitionId = deriveMarketAcquisitionId({
    acquisitionObservationId,
    providerId: plan.route.providerId,
    datasetId: plan.route.datasetId,
    feedId: plan.route.feedId,
    endpointChannelId: plan.route.endpointChannelId,
    entitlementSnapshotId: plan.entitlementSnapshotId,
    instrumentIds: Object.freeze(plan.instruments.map((value) => value.instrumentId).sort()),
    requestedFactKinds: Object.freeze([plan.kind === "bars" ? "bar" : plan.kind.slice(0, -1)]),
    queryStartNs: plan.queryStartNs.toString(),
    queryEndNs: plan.queryEndNs.toString(),
    sortOrder: "asc",
    routePolicyVersion: ROUTE_POLICY_VERSION,
  });
  const artifactContentId = deriveArtifactContentId({
    sha256: result.artifact.digest,
    sizeBytes: result.artifact.sizeBytes,
    mediaType: result.observation.response.mediaType ?? "",
    contentEncoding: result.observation.response.contentEncoding ?? "",
  });
  const rawArtifactId = deriveRawArtifactId({
    artifactContentId,
    vaultObservationId: result.observation.observationId,
    vaultObservationHash: result.observation.observationHash,
    acquisitionObservationId,
    role: "primary",
  });
  const previous = currentJournal.at(-1);
  if (previous === undefined) throw new TypeError("owned-workflow-journal-seed-missing");
  const continuationMaterial =
    snapshot.pageOrdinal === 0
      ? null
      : (previous.nextResumableTokenMaterial ?? previous.currentResumableTokenMaterial);
  const base = (stage: ObservationLedgerEntryV1 | null): JournalCheckpointBody =>
    attachLedgerEvidence(
      Object.freeze({
        ...journalEntryBody(previous),
        acquisitionObservationId,
        marketAcquisitionId,
        requestIdentityHash: snapshot.requestIdentityHash,
        acquisitionConfigurationHash: snapshot.acquisitionConfigurationHash,
        logicalPageIdentityHash: snapshot.logicalPageIdentityHash,
        pageOrdinal: snapshot.pageOrdinal,
        currentTokenHash: snapshot.currentTokenHash,
        currentResumableTokenMaterial: continuationMaterial,
        currentContinuationBindingHash: snapshot.currentContinuationBindingHash,
        nextTokenHash: null,
        nextResumableTokenMaterial: null,
        nextContinuationBindingHash: null,
        attemptId,
        retrievalAttemptId,
        attemptOrdinal,
        artifactObservationId: null,
        artifactDigest: null,
        artifactSizeBytes: null,
        artifactObservationHash: null,
        artifactContentId: null,
        rawArtifactId: null,
        pageRecordCount: null,
        pageNormalizedFactCount: null,
        pageChainHash: snapshot.pageChainHash,
        cumulativeSuccessfulPages: snapshot.budgets.successfulPages,
        cumulativeVerifiedBytes: snapshot.budgets.verifiedBytes,
        cumulativeRecords: snapshot.budgets.records,
        cumulativeNormalizedFacts: snapshot.budgets.normalizedFacts,
        cumulativeAttempts: snapshot.budgets.attempts,
        quotaWindowEvidence: snapshot.quotaWindowEvidence,
        terminalState: null,
        terminalReasonCode: null,
        incomplete: true,
      }),
      stage,
      clockDeclaration,
    );
  const append = (kind: JournalEntry["checkpointKind"], body: JournalCheckpointBody): void => {
    currentJournal.push(createJournalEntry(currentJournal.at(-1) ?? null, journalId, kind, body));
  };
  append("attempt-started", base(started));
  append("request-succeeded", base(succeeded));
  const artifactFields = Object.freeze({
    artifactObservationId: result.observation.observationId,
    artifactDigest: result.artifact.digest,
    artifactSizeBytes: result.artifact.sizeBytes,
    artifactObservationHash: result.observation.observationHash,
    artifactContentId,
    rawArtifactId,
  });
  append("artifact-committed", Object.freeze({ ...base(committed), ...artifactFields }));
  append("artifact-verified", Object.freeze({ ...base(verified), ...artifactFields }));
  const receipt = Object.freeze({ kind: "owned-production-workflow-evidence" as const });
  ownedProductionWorkflowReceipts.set(
    receipt,
    Object.freeze({
      journal,
      journalId,
      expectedIdentity,
      artifactStore,
      journalEntries: Object.freeze([...currentJournal]),
      ledgerEntries: Object.freeze([...ledger]),
    }),
  );
  try {
    await persistOwnedProductionAcquisitionWorkflowEvidence(receipt);
  } catch (error) {
    ownedProductionWorkflowReceipts.delete(receipt);
    throw error;
  }

  const artifactExpectation = Object.freeze({
    artifactObservationId: result.observation.observationId,
    artifactDigest: result.artifact.digest,
    artifactSizeBytes: result.artifact.sizeBytes,
    artifactObservationHash: result.observation.observationHash,
    retrievalAttemptId,
    requestIdentityHash: plan.requestIdentityHash,
    provider: "alpaca",
  });
  const migrations = ownedCredentialMigrations(authorization);
  const semanticBoundary = await openOwnedDurableAlpacaWireSemanticEvidenceBoundary(
    authorization,
    migrations,
    plan,
    artifactStore,
  );
  try {
    await semanticBoundary.persistIssuedAuthority(plan, artifactExpectation);
  } finally {
    semanticBoundary.close();
  }
  const wireBoundary = await openOwnedDurableAlpacaWireAdmissionBoundary(
    authorization,
    migrations,
    plan,
    artifactStore,
  );
  let admission: AlpacaWirePageAdmission;
  try {
    const authority = await wireBoundary.issue({
      plan,
      expectedIdentity,
      marketAcquisitionJournalId: journalId,
    });
    const read = await artifactStore.read(result.artifact.digest);
    const chunks: Buffer[] = [];
    let consumed = 0;
    try {
      for await (const chunk of read.stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        consumed += bytes.byteLength;
        if (consumed > result.artifact.sizeBytes) {
          throw new RangeError("owned-workflow-artifact-read-bound");
        }
        chunks.push(Buffer.from(bytes));
      }
      if (consumed !== result.artifact.sizeBytes) {
        throw new TypeError("owned-workflow-artifact-read-size-mismatch");
      }
      const bytes = Buffer.concat(chunks);
      try {
        admission = parseAndAdmitAlpacaHistoricalPage(plan.kind, bytes, authority);
      } finally {
        bytes.fill(0);
      }
    } finally {
      for (const chunk of chunks) chunk.fill(0);
      read.stream.destroy();
    }
  } finally {
    wireBoundary.close();
  }
  const authenticated = authenticatedAlpacaAdmissionArtifact(admission);
  if (
    authenticated.artifactDigest !== result.artifact.digest ||
    authenticated.artifactSizeBytes !== result.artifact.sizeBytes ||
    admission.marketAcquisitionId !== marketAcquisitionId ||
    admission.rawArtifactId !== rawArtifactId
  ) {
    throw new TypeError("owned-workflow-wire-admission-mismatch");
  }
  const beforeCheckpoint = machine.snapshot;
  await machine.pageCheckpointed(
    ownedCredentialTrustedNowMs(authorization),
    Object.freeze({
      priorPageChainHash: beforeCheckpoint.pageChainHash,
      marketAcquisitionId,
      requestIdentityHash: beforeCheckpoint.requestIdentityHash,
      logicalPageIdentityHash: beforeCheckpoint.logicalPageIdentityHash,
      pageOrdinal: beforeCheckpoint.pageOrdinal,
      artifactObservationId: result.observation.observationId,
      artifactDigest: result.artifact.digest,
      artifactSizeBytes: result.artifact.sizeBytes,
      artifactObservationHash: result.observation.observationHash,
      artifactContentId,
      rawArtifactId,
      currentTokenHash: beforeCheckpoint.currentTokenHash,
      pageRecordCount: admission.wireItemCount,
      cumulativeSuccessfulPages: beforeCheckpoint.budgets.successfulPages + 1,
      cumulativeVerifiedBytes: beforeCheckpoint.budgets.verifiedBytes + result.artifact.sizeBytes,
      cumulativeRecords: beforeCheckpoint.budgets.records + admission.wireItemCount,
      cumulativeNormalizedFacts: 0,
      cumulativeAttempts: beforeCheckpoint.budgets.attempts,
    }),
    admission.privateNextToken,
  );
  const checkpointSnapshot = machine.snapshot;
  const artifactVerifiedEntry = currentJournal.at(-1);
  if (artifactVerifiedEntry?.checkpointKind !== "artifact-verified") {
    throw new TypeError("owned-workflow-artifact-checkpoint-missing");
  }
  const continuation = checkpointSnapshot.continuationAuthority;
  const pageBody = attachLedgerEvidence(
    Object.freeze({
      ...journalEntryBody(artifactVerifiedEntry),
      admittedMarketAcquisitionIds: Object.freeze(
        [...artifactVerifiedEntry.admittedMarketAcquisitionIds, marketAcquisitionId].sort(),
      ),
      nextTokenHash: continuation?.nextTokenHash ?? TERMINAL_TOKEN_HASH,
      nextResumableTokenMaterial: continuation?.nextTokenMaterial ?? null,
      nextContinuationBindingHash: continuation?.nextContinuationBindingHash ?? null,
      pageRecordCount: admission.wireItemCount,
      pageChainHash: checkpointSnapshot.pageChainHash,
      cumulativeSuccessfulPages: checkpointSnapshot.budgets.successfulPages,
      cumulativeVerifiedBytes: checkpointSnapshot.budgets.verifiedBytes,
      cumulativeRecords: checkpointSnapshot.budgets.records,
      cumulativeNormalizedFacts: checkpointSnapshot.budgets.normalizedFacts,
      cumulativeAttempts: checkpointSnapshot.budgets.attempts,
      quotaWindowEvidence: checkpointSnapshot.quotaWindowEvidence,
    }),
    null,
    clockDeclaration,
  );
  append("page-checkpointed", pageBody);
  const checkpointReceipt = Object.freeze({ kind: "owned-production-page-checkpoint" as const });
  ownedProductionWorkflowReceipts.set(
    checkpointReceipt,
    Object.freeze({
      journal,
      journalId,
      expectedIdentity,
      artifactStore,
      journalEntries: Object.freeze([...currentJournal]),
      ledgerEntries: Object.freeze([...ledger]),
    }),
  );
  try {
    await persistOwnedProductionAcquisitionWorkflowEvidence(checkpointReceipt);
  } catch (error) {
    ownedProductionWorkflowReceipts.delete(checkpointReceipt);
    throw error;
  }
  if (admission.privateNextToken === null) {
    await machine.terminalPageAdmitted(ownedCredentialTrustedNowMs(authorization));
    const chainBody = attachLedgerEvidence(
      journalEntryBody(currentJournal.at(-1) as JournalEntry),
      verified,
      clockDeclaration,
    );
    append("chain-complete", chainBody);
    const chainReceipt = Object.freeze({ kind: "owned-production-chain-complete" as const });
    ownedProductionWorkflowReceipts.set(
      chainReceipt,
      Object.freeze({
        journal,
        journalId,
        expectedIdentity,
        artifactStore,
        journalEntries: Object.freeze([...currentJournal]),
        ledgerEntries: Object.freeze([...ledger]),
      }),
    );
    try {
      await persistOwnedProductionAcquisitionWorkflowEvidence(chainReceipt);
    } catch (error) {
      ownedProductionWorkflowReceipts.delete(chainReceipt);
      throw error;
    }
    await resolveAndNormalizeOwnedCompleteChain(
      authorization,
      plan,
      journal,
      journalId,
      expectedIdentity,
      artifactStore,
    );
  }
}

async function resolveAndNormalizeOwnedCompleteChain(
  authorization: DurableCredentialAuthorizationBoundary,
  plan: AlpacaAttemptInput<unknown>["plan"],
  journal: Awaited<ReturnType<typeof ownedLiveCredentialAcquisitionJournal>>,
  journalId: string,
  expectedIdentity: JournalIdentityInput,
  artifactStore: ReturnType<typeof createRetentionEnforcedArtifactStore>,
): Promise<void> {
  const durable = await journal.load(journalId);
  const pages = durable.filter((entry) => entry.checkpointKind === "page-checkpointed");
  if (
    pages.length === 0 ||
    durable.at(-1)?.checkpointKind !== "chain-complete" ||
    pages.some(
      (entry, index) =>
        entry.pageOrdinal !== index ||
        entry.artifactDigest === null ||
        entry.artifactSizeBytes === null,
    )
  ) {
    throw new TypeError("owned-workflow-complete-chain-required");
  }
  const wireBoundary = await openOwnedDurableAlpacaWireAdmissionBoundary(
    authorization,
    ownedCredentialMigrations(authorization),
    plan,
    artifactStore,
  );
  const admissions: AlpacaWirePageAdmission[] = [];
  try {
    for (const page of pages) {
      const artifactDigest = page.artifactDigest;
      const artifactSizeBytes = page.artifactSizeBytes;
      if (artifactDigest === null || artifactSizeBytes === null) {
        throw new TypeError("owned-workflow-page-artifact-required");
      }
      const authority = await wireBoundary.issue({
        plan,
        expectedIdentity,
        marketAcquisitionJournalId: journalId,
      });
      const read = await artifactStore.read(artifactDigest);
      const chunks: Buffer[] = [];
      let consumed = 0;
      try {
        for await (const chunk of read.stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          consumed += bytes.byteLength;
          if (consumed > artifactSizeBytes) {
            throw new RangeError("owned-workflow-artifact-read-bound");
          }
          chunks.push(Buffer.from(bytes));
        }
        if (consumed !== artifactSizeBytes) {
          throw new TypeError("owned-workflow-artifact-read-size-mismatch");
        }
        const bytes = Buffer.concat(chunks);
        try {
          const admission = parseAndAdmitAlpacaHistoricalPage(plan.kind, bytes, authority);
          const authenticated = authenticatedAlpacaAdmissionArtifact(admission);
          if (
            authenticated.artifactDigest !== artifactDigest ||
            authenticated.artifactSizeBytes !== artifactSizeBytes
          ) {
            throw new TypeError("owned-workflow-chain-artifact-mismatch");
          }
          admissions.push(admission);
        } finally {
          bytes.fill(0);
        }
      } finally {
        for (const chunk of chunks) chunk.fill(0);
        read.stream.destroy();
      }
    }
    const resolution = await resolveAlpacaHistoricalChain(plan.kind, admissions, {
      journal,
      journalId,
      expectedIdentity,
    });
    const digests = pages.flatMap((entry) =>
      entry.artifactDigest === null ? [] : [entry.artifactDigest],
    );
    const lease = artifactStore.createUseLease(digests);
    const operation = beginRetentionUse(lease, digests);
    try {
      operation.assertAllowed();
      const normalized = normalizeRecordedMarketRecords(resolution.records);
      const derivedIds = normalized.flatMap((fact) =>
        [fact.marketFactId, fact.normalizedMarketFactId].filter(
          (value): value is string => value !== null,
        ),
      );
      if (derivedIds.length > 0) registerRetentionDerivedLineage(lease, derivedIds);
      operation.assertAllowed();
    } finally {
      operation.release();
    }
  } finally {
    wireBoundary.close();
  }
}

/** Sole live composition boundary: durable evidence -> credentials -> bounded dispatch. */
export class AlpacaProductionAttemptBoundary {
  readonly #secrets: RuntimeSecretSource;
  readonly #authorization: DurableCredentialAuthorizationBoundary;

  constructor(secrets: RuntimeSecretSource, authorization: DurableCredentialAuthorizationBoundary) {
    assertOwnedDurableCredentialAuthorizationBoundary(authorization);
    this.#secrets = secrets;
    this.#authorization = authorization;
  }

  async execute<T>(input: AlpacaProductionAttemptInput<T>): Promise<AlpacaAttemptResult<T>> {
    try {
      assertRetentionOwnedAlpacaPageSink(input.artifactSink);
      assertCredentialIsolatedAlpacaTransport(input.transport);
      assertOwnedAlpacaDeadlineScheduler(input.deadlineScheduler);
    } catch {
      return safeFailure(
        new AttemptFailure("configuration-invalid", "request-preflight", {
          kind: "authorization",
        }),
        true,
      );
    }
    let machine: OwnedProductionAcquisitionState | null = null;
    if (isOwnedProductionCredentialAuthorizationBoundary(this.#authorization)) {
      try {
        machine = new OwnedProductionAcquisitionState(this.#authorization);
      } catch (error) {
        if (
          !(error instanceof TypeError) ||
          error.message !== "owned-acquisition-state-root-missing"
        ) {
          return safeFailure(
            new AttemptFailure("configuration-invalid", "request-preflight", {
              kind: "journal",
            }),
            true,
          );
        }
      }
    }
    const abortController = new AbortController();
    let requestLease: AlpacaTransportRequestLease;
    try {
      let effectivePage: AlpacaPageAuthority = input.page;
      if (machine !== null && machine.snapshot.currentState === "checkpointing") {
        effectivePage = await ownedContinuationPage(
          this.#authorization,
          input.plan,
          machine.snapshot,
          true,
        );
      } else if (machine !== null && machine.snapshot.pageOrdinal > 0) {
        effectivePage = await ownedContinuationPage(
          this.#authorization,
          input.plan,
          machine.snapshot,
          false,
        );
      }
      requestLease = buildAlpacaTransportRequest(input.plan, effectivePage, abortController.signal);
      if (machine !== null && machine.snapshot.currentState === "checkpointing") {
        await machine.continueNextPage(ownedCredentialTrustedNowMs(this.#authorization));
      }
    } catch {
      return safeFailure(
        new AttemptFailure("configuration-invalid", "request-preflight", {
          kind: "authorization",
        }),
        true,
      );
    }
    let permit: CredentialPreflightPermit;
    if (machine !== null) {
      try {
        if (machine.snapshot.currentState === "waiting-retry") {
          const delayMs = machine.snapshot.pendingRetryDelayMs;
          if (delayMs === null) throw new TypeError("production-retry-delay-missing");
          const retryDelay = input.deadlineScheduler.arm(delayMs);
          await retryDelay.expired;
          retryDelay.cancel();
          await retryDelay.settle();
          const nowMonotonicMs = ownedCredentialTrustedNowMs(this.#authorization);
          const proof = Object.freeze({
            requestIdentityHash: machine.snapshot.requestIdentityHash,
            acquisitionConfigurationHash: machine.snapshot.acquisitionConfigurationHash,
            marketAcquisitionJournalId: machine.snapshot.marketAcquisitionJournalId,
            runSessionNonce: machine.snapshot.runSessionNonce,
            nowMonotonicMs,
            resourcesSettled: true,
          });
          await machine.retryDelayElapsed(proof.nowMonotonicMs);
          await machine.beginPreflight(proof.nowMonotonicMs);
          await machine.approvePreflight(proof.nowMonotonicMs);
        }
        if (machine.snapshot.currentState === "preflighting") {
          await machine.approvePreflight(ownedCredentialTrustedNowMs(this.#authorization));
        }
        if (machine.snapshot.currentState !== "dispatch-ready") {
          throw new TypeError("production-acquisition-state-not-dispatch-ready");
        }
      } catch {
        requestLease.release();
        return safeFailure(
          new AttemptFailure("configuration-invalid", "request-preflight", { kind: "journal" }),
          true,
        );
      }
    }
    let admittedRetrievalAttemptId: string;
    let admittedAcquisitionObservationId: string;
    try {
      const evidence = await this.#authorization.establish(input.credentialAuthorization);
      permit = authorizeCredentialLoad(evidence, requestLease.request);
      const stateEvidence = ownedCredentialAttemptStateEvidence(permit);
      admittedRetrievalAttemptId = stateEvidence.retrievalAttemptId;
      admittedAcquisitionObservationId = stateEvidence.acquisitionObservationId;
      if (isOwnedProductionCredentialAuthorizationBoundary(this.#authorization)) {
        machine ??= new OwnedProductionAcquisitionState(this.#authorization);
        const proof = (): AcquisitionEventProof => {
          if (machine === null) throw new TypeError("production-acquisition-state-required");
          return Object.freeze({
            requestIdentityHash: machine.snapshot.requestIdentityHash,
            acquisitionConfigurationHash: machine.snapshot.acquisitionConfigurationHash,
            marketAcquisitionJournalId: machine.snapshot.marketAcquisitionJournalId,
            runSessionNonce: machine.snapshot.runSessionNonce,
            nowMonotonicMs: ownedCredentialTrustedNowMs(this.#authorization),
            resourcesSettled: true,
          });
        };
        if (machine.snapshot.currentState === "declared") {
          await machine.beginPreflight(proof().nowMonotonicMs);
        }
        if (machine.snapshot.currentState === "preflighting") {
          await machine.approvePreflight(proof().nowMonotonicMs);
        }
        if (machine.snapshot.currentState !== "dispatch-ready") {
          throw new TypeError("production-acquisition-state-not-dispatch-ready");
        }
      }
    } catch (error) {
      requestLease.release();
      const denial = credentialAuthorizationDenialReason(error);
      return safeFailure(
        new AttemptFailure(denial ?? "configuration-invalid", "request-preflight", {
          kind: "authorization",
        }),
        true,
      );
    }
    let deadline: AlpacaDeadlineHandle;
    try {
      const scheduled = input.deadlineScheduler.arm(remainingCredentialAttemptBudgetMs(permit));
      if (
        scheduled === null ||
        typeof scheduled !== "object" ||
        !(scheduled.expired instanceof Promise) ||
        typeof scheduled.assertRemaining !== "function" ||
        typeof scheduled.cancel !== "function" ||
        typeof scheduled.settle !== "function"
      ) {
        throw new TypeError("alpaca-deadline-handle-invalid");
      }
      deadline = Object.freeze({
        expired: scheduled.expired,
        assertRemaining: scheduled.assertRemaining.bind(scheduled),
        cancel: scheduled.cancel.bind(scheduled),
        settle: scheduled.settle.bind(scheduled),
      });
    } catch (error) {
      discardCredentialPreflightPermit(permit);
      requestLease.release();
      const denial = credentialAuthorizationDenialReason(error);
      return safeFailure(
        new AttemptFailure(denial ?? "attempt-timeout", "request-started", {
          kind: "cleanup-unprovable",
        }),
        false,
      );
    }
    let authorized: CredentialAttemptResult<AlpacaAttemptResult<T>>;
    const artifactCommitAuthority: AlpacaArtifactCommitAuthority =
      issueOwnedAlpacaArtifactCommitAuthority(permit);
    try {
      authorized = await withAlpacaAuthorization(
        permit,
        this.#secrets,
        requestLease.request,
        async (dispatchCapability) => {
          const proof = (): AcquisitionEventProof => {
            if (machine === null) throw new TypeError("production-acquisition-state-required");
            return Object.freeze({
              requestIdentityHash: machine.snapshot.requestIdentityHash,
              acquisitionConfigurationHash: machine.snapshot.acquisitionConfigurationHash,
              marketAcquisitionJournalId: machine.snapshot.marketAcquisitionJournalId,
              runSessionNonce: machine.snapshot.runSessionNonce,
              nowMonotonicMs: ownedCredentialTrustedNowMs(this.#authorization),
              resourcesSettled: true,
            });
          };
          if (machine !== null) {
            await machine.credentialsLoaded(proof().nowMonotonicMs);
            const dispatchProof = proof();
            await machine.dispatchStarted(
              dispatchProof.nowMonotonicMs,
              MARKET_ACQUISITION_LIMITS.rateAttempts,
            );
            if (machine.snapshot.retrievalAttemptId !== admittedRetrievalAttemptId) {
              throw new TypeError("production-acquisition-attempt-identity-mismatch");
            }
          }
          // Do not give the sink a consumable commit authority until both credential loading and
          // dispatch-start persistence have succeeded.  Any exception before this point leaves
          // the sink unable to commit later.
          bindRetentionOwnedAlpacaPageSinkAttempt(input.artifactSink, artifactCommitAuthority);
          const stateProof = (): AcquisitionEventProof =>
            machine === null
              ? (() => {
                  throw new TypeError("production-acquisition-state-required");
                })()
              : Object.freeze({
                  requestIdentityHash: machine.snapshot.requestIdentityHash,
                  acquisitionConfigurationHash: machine.snapshot.acquisitionConfigurationHash,
                  marketAcquisitionJournalId: machine.snapshot.marketAcquisitionJournalId,
                  runSessionNonce: machine.snapshot.runSessionNonce,
                  nowMonotonicMs: ownedCredentialTrustedNowMs(this.#authorization),
                  resourcesSettled: true,
                });
          const result = await executeAlpacaAttempt({
            dispatchCapability,
            transport: input.transport,
            artifactSink: input.artifactSink,
            requestLease,
            abortController,
            deadline,
            machine,
            stateProof,
          });
          if (!result.ok && machine !== null) {
            const context = Object.freeze({
              failure: result.retryFailure,
              pageAttemptsStarted: machine.snapshot.pageAttemptsStarted,
              acquisitionAttemptsStarted: machine.snapshot.budgets.attempts,
            });
            const retry = decideRetry(context);
            if (
              retry.kind === "retry" &&
              result.resourcesSettled &&
              ["attempt-active", "response-accepted", "artifact-committing"].includes(
                machine.snapshot.currentState,
              )
            ) {
              await machine.retryCleanup(
                stateProof().nowMonotonicMs,
                result.retryFailure,
                result.resourcesSettled,
              );
            } else if (machine.snapshot.currentState === "attempt-active") {
              await machine.attemptFailed(stateProof().nowMonotonicMs, result.error.reasonCode);
            } else if (
              machine.snapshot.currentState === "response-accepted" ||
              machine.snapshot.currentState === "artifact-committing"
            ) {
              await machine.artifactStoreFailed(stateProof().nowMonotonicMs);
            } else if (machine.snapshot.currentState === "artifact-verifying") {
              await machine.pageVerificationFailed(stateProof().nowMonotonicMs);
            }
          }
          return result;
        },
        deadline,
      );
    } catch (error) {
      requestLease.release();
      abortController.abort();
      await abortDestroyAll([input.artifactSink], deadline.expired);
      await boundedBoolean(input.transport.abort(), deadline.expired);
      const timerSettled = await settleTimer(deadline);
      if (error instanceof AlpacaDeadlineElapsed) {
        return safeFailure(
          new AttemptFailure("attempt-timeout", "credential-load", {
            kind: "pre-response-transport",
          }),
          timerSettled,
        );
      }
      throw error;
    } finally {
      discardOwnedAlpacaArtifactCommitAuthority(artifactCommitAuthority);
    }
    if (authorized.ok) {
      if (authorized.value.ok && machine !== null) {
        const committed = authorized.value.artifact;
        if (committed !== null && typeof committed === "object") {
          try {
            await persistOwnedVerifiedPageArtifact(
              this.#authorization,
              input.plan,
              admittedAcquisitionObservationId,
              machine,
              committed as unknown as StoreArtifactResult,
            );
          } catch (error) {
            if (
              P1_10_TEST_AUTHORITY === undefined ||
              !(error instanceof TypeError) ||
              error.message !== "owned-alpaca-committed-page-result-required"
            ) {
              throw error;
            }
          }
        } else if (P1_10_TEST_AUTHORITY === undefined) {
          throw new TypeError("owned-alpaca-committed-page-result-required");
        }
      }
      return authorized.value;
    }
    requestLease.release();
    const timerSettled = await settleTimer(deadline);
    return safeFailure(
      new AttemptFailure("credential-unavailable", "credential-load", {
        kind: "authorization",
      }),
      timerSettled,
    );
  }
}

Object.freeze(AlpacaProductionAttemptBoundary.prototype);

/** Persistence-side consumer for receipts minted only by the lexical production composer. */
export function consumeOwnedProductionAcquisitionTransitionReceipt(
  receipt: object,
): OwnedAcquisitionTransitionBinding {
  const binding = ownedProductionTransitionReceipts.get(receipt);
  if (binding === undefined) {
    throw new TypeError("owned-production-acquisition-transition-receipt-required");
  }
  ownedProductionTransitionReceipts.delete(receipt);
  return binding;
}

export function consumeOwnedProductionWorkflowEvidenceReceipt(
  receipt: object,
): VerifiedAcquisitionWorkflowEvidenceInput {
  const binding = ownedProductionWorkflowReceipts.get(receipt);
  if (binding === undefined) {
    throw new TypeError("owned-production-workflow-evidence-receipt-required");
  }
  ownedProductionWorkflowReceipts.delete(receipt);
  return binding;
}
