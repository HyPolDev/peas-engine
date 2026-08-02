import { snapshotNormalizerBytes } from "../../../providers/normalizer-input.js";
import {
  createMarketAcquisitionSafeError,
  MARKET_ACQUISITION_LIMITS,
  type MarketAcquisitionOperationStage,
  type MarketAcquisitionTerminalReason,
} from "../contracts.js";
import type { RetryFailure } from "../retry.js";
import { parseRetryAfterMs } from "../retry.js";
import {
  authorizeCredentialLoad,
  assertCredentialIsolatedAlpacaTransport,
  assertOwnedDurableCredentialAuthorizationBoundary,
  type DurableCredentialAuthorizationBoundary,
  withAlpacaAuthorization,
  type CredentialAuthorizationRequest,
  type CredentialPreflightPermit,
  type RuntimeSecretSource,
} from "../credentials.js";
import type {
  AlpacaAttemptFailure,
  AlpacaAttemptInput,
  AlpacaAttemptResource,
  AlpacaAttemptResult,
  AlpacaBodyRead,
  AlpacaDeadlineHandle,
  AlpacaTransportRequestLease,
  AlpacaTransportResponse,
} from "./contracts.js";
import { buildAlpacaTransportRequest } from "./request.js";
import { assertRetentionOwnedAlpacaPageSink } from "./retained-sink.js";
import { assertOwnedAlpacaDeadlineScheduler } from "./deadline.js";

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
      if (error instanceof DeadlineElapsed) {
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
    acquisitionDeclaredMonotonicMs: number;
    nowMonotonicMs: number;
  }
>;

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
    const { acquisitionDeclaredMonotonicMs, nowMonotonicMs } = input;
    if (
      !Number.isSafeInteger(acquisitionDeclaredMonotonicMs) ||
      !Number.isSafeInteger(nowMonotonicMs) ||
      nowMonotonicMs < acquisitionDeclaredMonotonicMs
    ) {
      return safeFailure(
        new AttemptFailure("configuration-invalid", "request-preflight", { kind: "authorization" }),
        false,
      );
    }
    const remaining =
      MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs -
      (nowMonotonicMs - acquisitionDeclaredMonotonicMs);
    if (remaining < 1) {
      return safeFailure(
        new AttemptFailure("acquisition-deadline", "request-preflight", { kind: "authorization" }),
        false,
      );
    }
    const abortController = new AbortController();
    let requestLease: AlpacaTransportRequestLease;
    try {
      requestLease = buildAlpacaTransportRequest(input.plan, input.page, abortController.signal);
    } catch {
      return safeFailure(
        new AttemptFailure("configuration-invalid", "request-preflight", {
          kind: "authorization",
        }),
        true,
      );
    }
    let deadline: AlpacaDeadlineHandle;
    try {
      const scheduled = input.deadlineScheduler.arm(
        Math.min(MARKET_ACQUISITION_LIMITS.attemptDeadlineMs, remaining),
      );
      if (
        scheduled === null ||
        typeof scheduled !== "object" ||
        !(scheduled.expired instanceof Promise) ||
        typeof scheduled.cancel !== "function" ||
        typeof scheduled.settle !== "function"
      ) {
        throw new TypeError("alpaca-deadline-handle-invalid");
      }
      deadline = Object.freeze({
        expired: scheduled.expired,
        cancel: scheduled.cancel.bind(scheduled),
        settle: scheduled.settle.bind(scheduled),
      });
    } catch {
      requestLease.release();
      return safeFailure(
        new AttemptFailure("attempt-timeout", "request-started", {
          kind: "cleanup-unprovable",
        }),
        false,
      );
    }
    let permit: CredentialPreflightPermit;
    try {
      const evidence = await this.#authorization.establish(input.credentialAuthorization);
      permit = authorizeCredentialLoad(evidence);
    } catch {
      requestLease.release();
      const timerSettled = await settleTimer(deadline);
      return safeFailure(
        new AttemptFailure("configuration-invalid", "request-preflight", { kind: "authorization" }),
        timerSettled,
      );
    }
    const authorized = await withAlpacaAuthorization(
      permit,
      this.#secrets,
      requestLease.request,
      (dispatchCapability) =>
        executeAlpacaAttempt({
          dispatchCapability,
          transport: input.transport,
          artifactSink: input.artifactSink,
          requestLease,
          abortController,
          deadline,
        }),
    );
    if (authorized.ok) return authorized.value;
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
