import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { isProxy } from "node:util/types";
import { P1_10_TEST_AUTHORITY } from "../../../internal-test-authority.js";

import { assertArtifactDigest } from "../../../artifacts/validation.js";
import { canonicalHash } from "../../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../../core/json.js";
import {
  ALPACA_PRIVATE_ARTIFACT_POLICY,
  ALPACA_RETENTION_POLICY_ID,
  FMP_PRIVATE_ARTIFACT_POLICY,
  FMP_RETENTION_POLICY_ID,
} from "../private-artifact-policy.js";
import { safeAcquisitionError } from "../redaction.js";
import type {
  ArtifactRetentionController,
  ArtifactRetentionJournal,
  RetentionArtifactBoundary,
  RetentionCheckpoint,
  ErasureResult,
  RetentionErasureAttempt,
  RetentionErasurePlan,
  RetentionOwnership,
  RetentionOperationLease,
  RetentionReceipt,
  RetentionStopEvent,
  RetentionTombstone,
} from "./contracts.js";
import {
  deriveRetentionAttemptId,
  deriveRetentionCheckpointId,
  deriveRetentionOwnershipId,
  deriveRetentionPlanHash,
  deriveRetentionPlanId,
  deriveRetentionReceiptId,
  deriveRetentionStopEventId,
  deriveRetentionTombstoneId,
} from "./identity.js";
import {
  assertOwnedRetentionJournal,
  assertOwnedSqliteRetentionJournal,
} from "../owned-journal.js";
import {
  assertOwnedVaultArtifactRetentionBoundary,
  ownedVaultRetentionCoordinatorRoot,
  ownedVaultRetentionRuntimeIdentity,
} from "./vault-boundary.js";
import { ownedSqliteRetentionJournalRuntimeIdentity } from "./sqlite-journal.js";
import type { AlpacaPreparedArtifactCommit } from "../alpaca/contracts.js";
import { consumePreparedAlpacaArtifactCommit } from "../alpaca/retained-sink.js";
import { resolveRetentionDerivedLineageLease } from "./artifact-access.js";

const ID = /^[a-z][a-z0-9]*_[0-9a-f]{64}$/u;
const POLICY_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const ownedRetentionControllers = new WeakSet<object>();
const retentionControllerRoots = new WeakMap<object, object>();
const CONTROLLER_CONSTRUCTION_AUTHORITY = Object.freeze({});
const trustedTimeOriginMs = performance.timeOrigin;
const trustedMonotonicNowMs = performance.now.bind(performance);
const trustedRetentionNowMs = (): number =>
  Math.trunc(trustedTimeOriginMs + trustedMonotonicNowMs());
type RetentionCoordinator = {
  admissionClosed: boolean;
  pendingStops: number;
  activeOperations: number;
  operationIdleWaiting: Array<() => void>;
  operationStopHandlers: Set<() => void>;
  stopTail: Promise<void>;
};
const retentionCoordinators = new WeakMap<object, RetentionCoordinator>();

function coordinatorFor(root: object): RetentionCoordinator {
  const existing = retentionCoordinators.get(root);
  if (existing !== undefined) return existing;
  const value: RetentionCoordinator = {
    admissionClosed: false,
    pendingStops: 0,
    activeOperations: 0,
    operationIdleWaiting: [],
    operationStopHandlers: new Set(),
    stopTail: Promise.resolve(),
  };
  retentionCoordinators.set(root, value);
  return value;
}

export type RetentionFaultBoundary = (checkpoint: string) => void | Promise<void>;

function sortedUnique(values: readonly string[]): readonly string[] {
  const result = [...values].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  if (result.some((value, index) => index > 0 && result[index - 1] === value))
    throw new TypeError("Retention identifier sets must be unique");
  return result;
}

function sortedSet(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)));
}

function assertSafeTime(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} is invalid`);
}

function assertId(value: string, label: string): void {
  if (!ID.test(value)) throw new TypeError(`${label} is invalid`);
}

export class DefaultArtifactRetentionController implements ArtifactRetentionController {
  readonly #journal: ArtifactRetentionJournal;
  readonly #artifacts: RetentionArtifactBoundary;
  readonly #nowMs: () => number;
  readonly #faultBoundary: RetentionFaultBoundary;
  readonly #coordinator: RetentionCoordinator;

  constructor(
    dependencies: {
      journal: ArtifactRetentionJournal;
      artifacts: RetentionArtifactBoundary;
      nowMs: () => number;
      faultBoundary?: RetentionFaultBoundary;
    },
    authority?: object,
    coordinatorRoot?: object,
  ) {
    if (authority !== CONTROLLER_CONSTRUCTION_AUTHORITY) {
      assertOwnedRetentionJournal(dependencies.journal);
    }
    this.#journal = dependencies.journal;
    this.#artifacts = dependencies.artifacts;
    this.#nowMs = dependencies.nowMs;
    this.#faultBoundary = dependencies.faultBoundary ?? (() => undefined);
    this.#coordinator = coordinatorFor(coordinatorRoot ?? (dependencies.artifacts as object));
    if (authority === CONTROLLER_CONSTRUCTION_AUTHORITY) ownedRetentionControllers.add(this);
  }

  registerOwnership(input: Omit<RetentionOwnership, "ownershipId">): RetentionOwnership {
    if (P1_10_TEST_AUTHORITY === undefined) {
      throw new TypeError("retention-owned-mutation-required");
    }
    return this.#registerOwnership(input);
  }

  #registerOwnership(input: Omit<RetentionOwnership, "ownershipId">): RetentionOwnership {
    this.#validateOwnership(input);
    const value: RetentionOwnership = {
      ...input,
      derivedIds: sortedUnique(input.derivedIds),
      ownershipId: deriveRetentionOwnershipId({
        ...input,
        derivedIds: sortedUnique(input.derivedIds),
      }),
    };
    if (!this.#journal.registerOwnershipAndApplyActiveStop(value)) {
      throw safeAcquisitionError("retention-stop-required", "retention-stop");
    }
    return value;
  }

  beginUse(
    artifactDigests: readonly string[] = [],
    derivedIds: readonly string[] = [],
  ): RetentionOperationLease {
    const digests = sortedSet(artifactDigests);
    const derived = sortedSet(derivedIds);
    const assertAllowed = (): void => {
      if (this.#coordinator.admissionClosed) {
        throw safeAcquisitionError("retention-stop-required", "artifact-verify");
      }
      if (
        digests.length === 0 &&
        derived.length === 0 &&
        this.#journal.reconciliationUseDenied(this.#trustedNow())
      ) {
        throw safeAcquisitionError("retention-stop-required", "artifact-verify");
      }
      for (const digest of digests) this.#assertArtifactUseAllowed(digest);
      for (const derivedId of derived) this.#assertDerivedUseAllowed(derivedId);
    };
    assertAllowed();
    this.#coordinator.activeOperations += 1;
    let released = false;
    let stopHandler: (() => void) | null = null;
    return Object.freeze({
      assertAllowed,
      onStop: (handler: () => void): void => {
        if (released || typeof handler !== "function") {
          throw new TypeError("retention-operation-stop-handler-invalid");
        }
        if (stopHandler !== null) this.#coordinator.operationStopHandlers.delete(stopHandler);
        stopHandler = handler;
        this.#coordinator.operationStopHandlers.add(handler);
        if (this.#coordinator.admissionClosed) handler();
      },
      release: (): void => {
        if (released) return;
        released = true;
        if (stopHandler !== null) this.#coordinator.operationStopHandlers.delete(stopHandler);
        this.#coordinator.activeOperations -= 1;
        if (this.#coordinator.activeOperations === 0) {
          for (const waiter of this.#coordinator.operationIdleWaiting.splice(
            0,
            this.#coordinator.operationIdleWaiting.length,
          ))
            waiter();
        }
      },
    });
  }

  async commitArtifact<T>(prepared: AlpacaPreparedArtifactCommit<T>): Promise<T>;
  async commitArtifact<T>(
    input: Omit<RetentionOwnership, "ownershipId">,
    commit: () => Promise<T>,
  ): Promise<T>;
  async commitArtifact<T>(
    preparedOrInput: AlpacaPreparedArtifactCommit<T> | Omit<RetentionOwnership, "ownershipId">,
    testCommit?: () => Promise<T>,
  ): Promise<T> {
    const preparedBinding =
      testCommit === undefined
        ? consumePreparedAlpacaArtifactCommit(
            preparedOrInput as AlpacaPreparedArtifactCommit<T>,
            retentionControllerRoots.get(this),
          )
        : P1_10_TEST_AUTHORITY === undefined
          ? (() => {
              throw new TypeError("retention-owned-mutation-required");
            })()
          : Object.freeze({
              prepared: Object.freeze({
                ownership: preparedOrInput as Omit<RetentionOwnership, "ownershipId">,
                commit: testCommit,
              }),
              dispose(): void {},
            });
    try {
      const input = preparedBinding.prepared.ownership;
      const commit = preparedBinding.prepared.commit;
      this.#validateOwnership(input);
      const operation = this.beginUse();
      let committed = false;
      try {
        this.#registerOwnership(input);
        const artifact = await commit();
        committed = true;
        operation.assertAllowed();
        this.#assertArtifactUseAllowed(input.artifactDigest);
        return artifact;
      } catch (error) {
        if (committed) {
          try {
            await this.#artifacts.eraseDigestCopies(input.artifactDigest);
            if (!(await this.#artifacts.verifyDigestCopiesAbsent(input.artifactDigest))) {
              throw new Error("retention-commit-rollback-unprovable");
            }
          } catch {
            throw safeAcquisitionError("retention-erasure-unprovable", "retention-erase");
          }
        }
        throw error;
      } finally {
        operation.release();
      }
    } finally {
      preparedBinding.dispose();
    }
  }

  registerDerivedLineage(artifactDigests: readonly string[], derivedIds: readonly string[]): void {
    if (P1_10_TEST_AUTHORITY === undefined) {
      throw new TypeError("retention-owned-mutation-required");
    }
    this.#registerDerivedLineage(artifactDigests, derivedIds);
  }

  registerDerivedLineageFromLease(lease: object, derivedIds: readonly string[]): void {
    this.#registerDerivedLineage(resolveRetentionDerivedLineageLease(lease, this), derivedIds);
  }

  #registerDerivedLineage(artifactDigests: readonly string[], derivedIds: readonly string[]): void {
    const digests = sortedSet(artifactDigests);
    const derived = sortedUnique(derivedIds);
    if (digests.length === 0 || derived.length === 0) {
      throw safeAcquisitionError("retention-policy-invalid", "normalization");
    }
    const operation = this.beginUse(digests);
    try {
      for (const digest of digests) {
        const ownership = this.#journal.ownershipForDigest(digest);
        if (ownership.length === 0) {
          throw safeAcquisitionError("retention-stop-required", "normalization");
        }
        for (const value of ownership) {
          if (!this.#journal.registerDerivedLineageAndApplyActiveStop(value.ownershipId, derived)) {
            throw safeAcquisitionError("retention-stop-required", "normalization");
          }
        }
      }
      operation.assertAllowed();
      for (const derivedId of derived) this.#assertDerivedUseAllowed(derivedId);
    } finally {
      operation.release();
    }
  }

  async enforceStop(input: Omit<RetentionStopEvent, "stopEventId">): Promise<RetentionReceipt> {
    this.#validateStop(input);
    const stop: RetentionStopEvent = {
      ...input,
      stopEventId: deriveRetentionStopEventId(input),
    };
    const initialOwnership = this.#journal.listOwnership(input.providerLane, input.providerId);
    this.#coordinator.pendingStops += 1;
    this.#coordinator.admissionClosed = true;
    for (const handler of [...this.#coordinator.operationStopHandlers]) {
      try {
        handler();
      } catch {
        // Admission remains closed; settlement still waits for the operation lease.
      }
    }
    const predecessor = this.#coordinator.stopTail;
    let releaseStop!: () => void;
    this.#coordinator.stopTail = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    await predecessor;
    try {
      if (this.#coordinator.activeOperations > 0) {
        const remaining = input.deadlineMs - this.#trustedNow();
        if (remaining < 1) this.#assertDeadline(input.deadlineMs);
        let timeout: NodeJS.Timeout | undefined;
        const idle = new Promise<void>((resolve) =>
          this.#coordinator.operationIdleWaiting.push(resolve),
        );
        try {
          const settled = await Promise.race([
            idle.then(() => true),
            new Promise<boolean>((resolve) => {
              timeout = setTimeout(() => resolve(false), Math.min(remaining, 30_000));
            }),
          ]);
          if (!settled)
            throw safeAcquisitionError("retention-erasure-unprovable", "retention-erase");
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      }
      this.#journal.recordStopAndDenials(
        stop,
        sortedSet(initialOwnership.flatMap((value) => value.derivedIds)),
      );
      return await this.#enforceStop(input, stop);
    } finally {
      releaseStop();
      this.#coordinator.pendingStops -= 1;
      if (this.#coordinator.pendingStops === 0) this.#coordinator.admissionClosed = false;
    }
  }

  async #enforceStop(
    input: Omit<RetentionStopEvent, "stopEventId">,
    stop: RetentionStopEvent,
  ): Promise<RetentionReceipt> {
    await this.#faultBoundary("retention-stop-denials-committed");
    const ownership = this.#journal.listOwnership(input.providerLane, input.providerId);
    const derivedIds = sortedSet(ownership.flatMap((value) => value.derivedIds));

    const planBody = {
      policyId: input.policyId,
      providerLane: input.providerLane,
      providerId: input.providerId,
      datasetIds: sortedSet(ownership.map((value) => value.datasetId)),
      feedIds: sortedSet(ownership.map((value) => value.feedId)),
      endpointChannelIds: sortedSet(ownership.map((value) => value.endpointChannelId)),
      artifactObservationIds: sortedSet(ownership.map((value) => value.artifactObservationId)),
      artifactDigests: sortedSet(ownership.map((value) => value.artifactDigest)),
      derivedIds,
      stopEventId: stop.stopEventId,
      effectiveAtMs: input.effectiveAtMs,
      deadlineMs: input.deadlineMs,
      predecessorReceiptId: null,
    } as const;
    const planId = deriveRetentionPlanId(planBody);
    const planWithoutHash = { ...planBody, planId };
    const plan: RetentionErasurePlan = {
      ...planWithoutHash,
      planHash: deriveRetentionPlanHash(planWithoutHash),
    };
    this.#journal.recordPlan(plan);
    const reloadedPlan = this.#journal.getPlan(plan.planId);
    if (reloadedPlan === undefined || recomputeRetentionPlanHash(reloadedPlan) !== plan.planHash)
      throw safeAcquisitionError("retention-erasure-unprovable", "retention-plan");
    await this.#faultBoundary("retention-plan-committed");

    const priorReceipt = this.#journal.getReceiptForPlan(plan.planId);
    if (priorReceipt !== undefined) {
      if (!(await this.#artifacts.settleActiveReadersAndWriters())) {
        throw safeAcquisitionError("retention-erasure-unprovable", "retention-verify");
      }
      try {
        await this.#verifyPlanErased(plan);
        await this.#ensureCheckpoint(plan, priorReceipt);
        return priorReceipt;
      } catch {
        // Reappearance is repaired under the immutable original plan. A successor plan would reuse
        // the same unique stop event and diverge between memory and SQLite journals.
      }
    }

    this.#assertDeadline(input.deadlineMs);
    const settled = await this.#artifacts.settleActiveReadersAndWriters();
    if (!settled)
      throw safeAcquisitionError("retention-erasure-unprovable", "retention-erase", {
        detailKind: "retention-state",
        state: "settling",
      });
    await this.#faultBoundary("retention-resources-settled");

    for (const digest of plan.artifactDigests) {
      this.#assertDeadline(input.deadlineMs);
      if (this.#journal.hasTombstone(digest)) {
        if (await this.#artifacts.verifyDigestCopiesAbsent(digest)) continue;
      }
      const priorAttempts = this.#journal.attemptsFor(plan.planId, digest);
      const attemptOrdinal =
        priorAttempts.reduce((maximum, value) => Math.max(maximum, value.attemptOrdinal), -1) + 1;
      const startedAtMs = this.#trustedNow();
      const startedBody = {
        planId: plan.planId,
        artifactDigest: digest,
        attemptOrdinal,
        startedAtMs,
        outcome: "started",
      } as const;
      const started: RetentionErasureAttempt = {
        ...startedBody,
        attemptId: deriveRetentionAttemptId(startedBody),
      };
      this.#journal.recordAttempt(started);
      await this.#faultBoundary(`retention-erasure-attempt-started:${digest}`);
      let erasure: ErasureResult;
      try {
        erasure = await this.#artifacts.eraseDigestCopies(digest);
      } catch {
        throw safeAcquisitionError("retention-erasure-failed", "retention-erase");
      }
      const outcomeBody = {
        planId: plan.planId,
        artifactDigest: digest,
        attemptOrdinal,
        startedAtMs,
        outcome: erasure.alreadyAbsent ? "already-absent" : "erased",
      } as const;
      this.#journal.recordAttempt({
        ...outcomeBody,
        attemptId: deriveRetentionAttemptId(outcomeBody),
      });
      await this.#faultBoundary(`retention-physical-erasure-complete:${digest}`);

      if (!this.#journal.hasTombstone(digest)) {
        const tombstoneBody = {
          planId: plan.planId,
          artifactDigest: digest,
          recordedAtMs: this.#trustedNow(),
        };
        const tombstone: RetentionTombstone = {
          ...tombstoneBody,
          tombstoneId: deriveRetentionTombstoneId(tombstoneBody),
        };
        this.#journal.recordTombstone(tombstone);
        await this.#faultBoundary(`retention-tombstone-committed:${digest}`);
      }
    }

    await this.#verifyPlanErased(plan);
    const latestOwnership = this.#journal.listOwnership(input.providerLane, input.providerId);
    if (
      canonicalJson(latestOwnership.map((value) => value.ownershipId) as unknown as JsonValue) !==
      canonicalJson(ownership.map((value) => value.ownershipId) as unknown as JsonValue)
    ) {
      return this.#enforceStop(input, stop);
    }
    await this.#faultBoundary("retention-erasure-verified");

    if (priorReceipt !== undefined) {
      await this.#ensureCheckpoint(plan, priorReceipt);
      return priorReceipt;
    }

    const receiptBody = {
      planId: plan.planId,
      planHash: plan.planHash,
      artifactDigests: plan.artifactDigests,
      artifactObservationIds: plan.artifactObservationIds,
      priorSizeBytes: [
        ...new Map(ownership.map((value) => [value.artifactDigest, value])).values(),
      ].reduce((sum, value) => {
        const next = sum + value.artifactSizeBytes;
        if (!Number.isSafeInteger(next)) throw new RangeError("Retention byte total is unsafe");
        return next;
      }, 0),
      attemptCount: new Set(
        plan.artifactDigests.flatMap((digest) =>
          this.#journal
            .attemptsFor(plan.planId, digest)
            .map((attempt) => `${attempt.artifactDigest}:${attempt.attemptOrdinal}`),
        ),
      ).size,
      outcome: "verified-erased",
      completedAtMs: this.#trustedNow(),
    } as const;
    const receipt: RetentionReceipt = {
      ...receiptBody,
      receiptId: deriveRetentionReceiptId(receiptBody),
    };
    this.#journal.recordReceipt(receipt);
    const reread = this.#journal.getReceiptForPlan(plan.planId);
    if (reread?.receiptId !== receipt.receiptId)
      throw safeAcquisitionError("retention-erasure-unprovable", "retention-verify");
    await this.#faultBoundary("retention-receipt-committed-reread");
    await this.#ensureCheckpoint(plan, receipt);
    return receipt;
  }

  assertArtifactUseAllowed(digest: string): void {
    if (this.#coordinator.admissionClosed)
      throw safeAcquisitionError("retention-stop-required", "artifact-verify");
    this.#assertArtifactUseAllowed(digest);
  }

  #assertArtifactUseAllowed(digest: string): void {
    assertArtifactDigest(digest);
    const now = this.#trustedNow();
    const ownership = this.#journal.ownershipForDigest(digest);
    if (
      ownership.length === 0 ||
      this.#journal.digestUseDenied(digest) ||
      ownership.some((value) => now >= value.expiresAtMs)
    )
      throw safeAcquisitionError("retention-stop-required", "artifact-verify");
  }

  assertDerivedUseAllowed(derivedId: string): void {
    if (this.#coordinator.admissionClosed)
      throw safeAcquisitionError("retention-stop-required", "normalization");
    this.#assertDerivedUseAllowed(derivedId);
  }

  #assertDerivedUseAllowed(derivedId: string): void {
    assertId(derivedId, "Derived identifier");
    const now = this.#trustedNow();
    const ownership = this.#journal.ownershipForDerivedId(derivedId);
    if (
      ownership.length === 0 ||
      this.#journal.derivedUseDenied(derivedId) ||
      ownership.some((value) => now >= value.expiresAtMs)
    )
      throw safeAcquisitionError("retention-stop-required", "normalization");
  }

  async #verifyPlanErased(plan: RetentionErasurePlan): Promise<void> {
    if (!this.#journal.providerUseDenied(plan.providerLane, plan.providerId)) {
      throw safeAcquisitionError("retention-erasure-unprovable", "retention-verify");
    }
    for (const digest of plan.artifactDigests) {
      if (
        !this.#journal.digestUseDenied(digest) ||
        !this.#journal.hasTombstone(digest) ||
        !(await this.#artifacts.verifyDigestCopiesAbsent(digest))
      ) {
        throw safeAcquisitionError("retention-erasure-unprovable", "retention-verify");
      }
    }
    for (const derivedId of plan.derivedIds) {
      if (!this.#journal.derivedUseDenied(derivedId)) {
        throw safeAcquisitionError("retention-erasure-unprovable", "retention-verify");
      }
    }
  }

  async #ensureCheckpoint(plan: RetentionErasurePlan, receipt: RetentionReceipt): Promise<void> {
    const existing = this.#journal.getCheckpoint(plan.planId);
    if (existing !== undefined) {
      if (existing.receiptId !== receipt.receiptId)
        throw safeAcquisitionError("retention-erasure-unprovable", "checkpoint");
      return;
    }
    const checkpointBody = {
      planId: plan.planId,
      receiptId: receipt.receiptId,
      sequence: 0,
      completedAtMs: receipt.completedAtMs,
    };
    const checkpoint: RetentionCheckpoint = {
      ...checkpointBody,
      checkpointId: deriveRetentionCheckpointId(checkpointBody),
    };
    this.#journal.recordCheckpoint(checkpoint);
    const reread = this.#journal.getCheckpoint(plan.planId);
    if (reread?.checkpointId !== checkpoint.checkpointId)
      throw safeAcquisitionError("retention-erasure-unprovable", "checkpoint");
    await this.#faultBoundary("retention-checkpoint-committed-reread");
  }

  #validateOwnership(value: Omit<RetentionOwnership, "ownershipId">): void {
    if (value.policyId !== ALPACA_RETENTION_POLICY_ID && value.policyId !== FMP_RETENTION_POLICY_ID)
      throw safeAcquisitionError("retention-policy-invalid", "retention-plan");
    if (value.providerLane === "fmp" && value.policyId !== FMP_RETENTION_POLICY_ID)
      throw safeAcquisitionError("retention-policy-invalid", "retention-plan");
    if (value.providerLane === "alpaca" && value.policyId !== ALPACA_RETENTION_POLICY_ID)
      throw safeAcquisitionError("retention-policy-invalid", "retention-plan");
    for (const [label, id] of [
      ["Provider", value.providerId],
      ["Dataset", value.datasetId],
      ["Feed", value.feedId],
      ["Channel", value.endpointChannelId],
    ] as const)
      assertId(id, label);
    if (
      !/^[0-9a-f]{64}$/u.test(value.artifactObservationId) &&
      !(P1_10_TEST_AUTHORITY !== undefined && ID.test(value.artifactObservationId))
    ) {
      throw new TypeError("Observation is invalid");
    }
    assertArtifactDigest(value.artifactDigest);
    for (const id of value.derivedIds) assertId(id, "Derived identifier");
    sortedUnique(value.derivedIds);
    assertSafeTime(value.trustedCaptureMs, "Trusted capture time");
    assertSafeTime(value.expiresAtMs, "Expiry time");
    if (
      !Number.isSafeInteger(value.artifactSizeBytes) ||
      value.artifactSizeBytes < 0 ||
      value.expiresAtMs < value.trustedCaptureMs
    )
      throw new RangeError("Retention ownership bounds are invalid");
    const policy =
      value.providerLane === "alpaca"
        ? ALPACA_PRIVATE_ARTIFACT_POLICY
        : FMP_PRIVATE_ARTIFACT_POLICY;
    const maximumExpiry = value.trustedCaptureMs + policy.maximumRetentionMs;
    if (!Number.isSafeInteger(maximumExpiry) || value.expiresAtMs > maximumExpiry)
      throw safeAcquisitionError("retention-policy-invalid", "retention-plan");
  }

  #validateStop(value: Omit<RetentionStopEvent, "stopEventId">): void {
    if (!POLICY_ID.test(value.policyId)) throw new TypeError("Retention policy is invalid");
    assertId(value.providerId, "Provider");
    assertSafeTime(value.effectiveAtMs, "Stop effective time");
    assertSafeTime(value.deadlineMs, "Stop deadline");
    if (value.deadlineMs < value.effectiveAtMs)
      throw safeAcquisitionError("retention-policy-invalid", "retention-stop");
    const policy =
      value.providerLane === "alpaca"
        ? ALPACA_PRIVATE_ARTIFACT_POLICY
        : FMP_PRIVATE_ARTIFACT_POLICY;
    if (
      value.policyId !== policy.policyId ||
      value.deadlineMs > value.effectiveAtMs + policy.stopGraceMs
    )
      throw safeAcquisitionError("retention-policy-invalid", "retention-stop");
  }

  #assertDeadline(deadlineMs: number): void {
    if (this.#trustedNow() > deadlineMs)
      throw safeAcquisitionError("retention-deadline-breached", "retention-erase");
  }

  #trustedNow(): number {
    const value = this.#nowMs();
    assertSafeTime(value, "Trusted retention time");
    return value;
  }
}

function constructOwnedArtifactRetentionController(
  dependencies: {
    journal: ArtifactRetentionJournal;
    artifacts: RetentionArtifactBoundary;
    nowMs: () => number;
    faultBoundary?: RetentionFaultBoundary;
  },
  coordinatorRoot?: object,
  runtimeIdentity?: object,
): DefaultArtifactRetentionController {
  const controller = new DefaultArtifactRetentionController(
    dependencies,
    CONTROLLER_CONSTRUCTION_AUTHORITY,
    coordinatorRoot,
  );
  Object.freeze(controller);
  if (runtimeIdentity !== undefined) retentionControllerRoots.set(controller, runtimeIdentity);
  return controller;
}

/** Live composition accepts only the exact owned SQLite journal and exact owned vault boundary. */
export function createArtifactRetentionController(dependencies: {
  journal: ArtifactRetentionJournal;
  artifacts: RetentionArtifactBoundary;
  faultBoundary?: RetentionFaultBoundary;
}): DefaultArtifactRetentionController {
  assertOwnedSqliteRetentionJournal(dependencies.journal);
  assertOwnedVaultArtifactRetentionBoundary(dependencies.artifacts);
  const journalIdentity = ownedSqliteRetentionJournalRuntimeIdentity(dependencies.journal);
  const vaultIdentity = ownedVaultRetentionRuntimeIdentity(dependencies.artifacts);
  if (journalIdentity !== vaultIdentity) {
    throw new TypeError("retention-runtime-root-mismatch");
  }
  return constructOwnedArtifactRetentionController(
    { ...dependencies, nowMs: trustedRetentionNowMs },
    ownedVaultRetentionCoordinatorRoot(dependencies.artifacts),
    vaultIdentity,
  );
}

/** Explicit offline-test composition; the Node test runner is the only admitted runtime. */
export function createTestArtifactRetentionController(dependencies: {
  journal: ArtifactRetentionJournal;
  artifacts: RetentionArtifactBoundary;
  nowMs: () => number;
  faultBoundary?: RetentionFaultBoundary;
}): DefaultArtifactRetentionController {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-retention-composition-unavailable");
  }
  assertOwnedRetentionJournal(dependencies.journal);
  try {
    assertOwnedSqliteRetentionJournal(dependencies.journal);
  } catch {
    return constructOwnedArtifactRetentionController(dependencies);
  }
  try {
    assertOwnedVaultArtifactRetentionBoundary(dependencies.artifacts);
  } catch {
    return constructOwnedArtifactRetentionController(dependencies);
  }
  const journalIdentity = ownedSqliteRetentionJournalRuntimeIdentity(dependencies.journal);
  const vaultIdentity = ownedVaultRetentionRuntimeIdentity(dependencies.artifacts);
  if (journalIdentity !== vaultIdentity) {
    throw new TypeError("retention-runtime-root-mismatch");
  }
  return constructOwnedArtifactRetentionController(
    dependencies,
    ownedVaultRetentionCoordinatorRoot(dependencies.artifacts),
    vaultIdentity,
  );
}

export function assertOwnedArtifactRetentionController(value: ArtifactRetentionController): void {
  if (
    !ownedRetentionControllers.has(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== DefaultArtifactRetentionController.prototype ||
    !Object.isFrozen(value)
  ) {
    throw new TypeError("owned-artifact-retention-controller-required");
  }
}

export function ownedArtifactRetentionControllerRuntimeIdentity(
  value: ArtifactRetentionController,
): object {
  assertOwnedArtifactRetentionController(value);
  const identity = retentionControllerRoots.get(value as object);
  if (identity === undefined) throw new TypeError("production-retention-controller-required");
  return identity;
}

export function recomputeRetentionPlanHash(plan: RetentionErasurePlan): string {
  const { planHash: _planHash, ...withoutHash } = plan;
  return canonicalHash(
    "peas/market-acquisition-retention-plan-record/v1",
    withoutHash as unknown as JsonValue,
  );
}

Object.freeze(DefaultArtifactRetentionController.prototype);
