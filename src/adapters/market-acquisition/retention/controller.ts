import { Buffer } from "node:buffer";

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

const ID = /^[a-z][a-z0-9]*_[0-9a-f]{64}$/u;
const POLICY_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;

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

  constructor(dependencies: {
    journal: ArtifactRetentionJournal;
    artifacts: RetentionArtifactBoundary;
    nowMs: () => number;
    faultBoundary?: RetentionFaultBoundary;
  }) {
    this.#journal = dependencies.journal;
    this.#artifacts = dependencies.artifacts;
    this.#nowMs = dependencies.nowMs;
    this.#faultBoundary = dependencies.faultBoundary ?? (() => undefined);
  }

  registerOwnership(input: Omit<RetentionOwnership, "ownershipId">): RetentionOwnership {
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

  async enforceStop(input: Omit<RetentionStopEvent, "stopEventId">): Promise<RetentionReceipt> {
    this.#validateStop(input);
    const stop: RetentionStopEvent = {
      ...input,
      stopEventId: deriveRetentionStopEventId(input),
    };
    const initialOwnership = this.#journal.listOwnership(input.providerLane, input.providerId);
    if (initialOwnership.length === 0)
      throw safeAcquisitionError("retention-stop-required", "retention-stop", {
        detailKind: "retention-count",
        counter: "artifact-count",
        value: 0,
      });
    // Stop and all use denials are one durable journal operation and precede any erasure work.
    this.#journal.recordStopAndDenials(
      stop,
      sortedSet(initialOwnership.flatMap((value) => value.derivedIds)),
    );
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
      await this.#verifyPlanErased(plan);
      await this.#ensureCheckpoint(plan, priorReceipt);
      return priorReceipt;
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
        if (!(await this.#artifacts.verifyDigestCopiesAbsent(digest)))
          throw safeAcquisitionError("retention-erasure-unprovable", "retention-verify");
        continue;
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

    await this.#verifyPlanErased(plan);
    const latestOwnership = this.#journal.listOwnership(input.providerLane, input.providerId);
    if (
      canonicalJson(latestOwnership.map((value) => value.ownershipId) as unknown as JsonValue) !==
      canonicalJson(ownership.map((value) => value.ownershipId) as unknown as JsonValue)
    ) {
      return this.enforceStop(input);
    }
    await this.#faultBoundary("retention-erasure-verified");

    const receiptBody = {
      planId: plan.planId,
      planHash: plan.planHash,
      artifactDigests: plan.artifactDigests,
      artifactObservationIds: plan.artifactObservationIds,
      priorSizeBytes: ownership.reduce((sum, value) => {
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
    assertArtifactDigest(digest);
    const now = this.#trustedNow();
    if (
      this.#journal.digestUseDenied(digest) ||
      this.#journal.ownershipForDigest(digest).some((value) => now >= value.expiresAtMs)
    )
      throw safeAcquisitionError("retention-stop-required", "artifact-verify");
  }

  assertDerivedUseAllowed(derivedId: string): void {
    assertId(derivedId, "Derived identifier");
    const now = this.#trustedNow();
    if (
      this.#journal.derivedUseDenied(derivedId) ||
      this.#journal.ownershipForDerivedId(derivedId).some((value) => now >= value.expiresAtMs)
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
      ["Observation", value.artifactObservationId],
    ] as const)
      assertId(id, label);
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

export function recomputeRetentionPlanHash(plan: RetentionErasurePlan): string {
  const { planHash: _planHash, ...withoutHash } = plan;
  return canonicalHash(
    "peas/market-acquisition-retention-plan-record/v1",
    withoutHash as unknown as JsonValue,
  );
}
