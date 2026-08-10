import type { AlpacaPreparedArtifactCommit } from "../alpaca/contracts.js";

export type RetentionProviderLane = "alpaca" | "fmp";
export type RetentionStopReason =
  | "maximum-retention"
  | "account-closure"
  | "owner-revocation"
  | "provider-guidance"
  | "classification-loss"
  | "subscription-termination"
  | "attestation-expired";

export type RetentionOwnership = Readonly<{
  ownershipId: string;
  policyId: string;
  providerLane: RetentionProviderLane;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  artifactObservationId: string;
  artifactDigest: string;
  artifactSizeBytes: number;
  derivedIds: readonly string[];
  trustedCaptureMs: number;
  expiresAtMs: number;
}>;

export type RetentionStopEvent = Readonly<{
  stopEventId: string;
  policyId: string;
  providerLane: RetentionProviderLane;
  providerId: string;
  effectiveAtMs: number;
  deadlineMs: number;
  reason: RetentionStopReason;
}>;

export type RetentionErasurePlan = Readonly<{
  planId: string;
  planHash: string;
  policyId: string;
  providerLane: RetentionProviderLane;
  providerId: string;
  datasetIds: readonly string[];
  feedIds: readonly string[];
  endpointChannelIds: readonly string[];
  artifactObservationIds: readonly string[];
  artifactDigests: readonly string[];
  derivedIds: readonly string[];
  stopEventId: string;
  effectiveAtMs: number;
  deadlineMs: number;
  predecessorReceiptId: string | null;
}>;

export type RetentionErasureAttempt = Readonly<{
  attemptId: string;
  planId: string;
  artifactDigest: string;
  attemptOrdinal: number;
  startedAtMs: number;
  outcome: "started" | "erased" | "already-absent" | "failed";
}>;

export type RetentionTombstone = Readonly<{
  tombstoneId: string;
  planId: string;
  artifactDigest: string;
  recordedAtMs: number;
}>;

export type RetentionReceipt = Readonly<{
  receiptId: string;
  planId: string;
  planHash: string;
  artifactDigests: readonly string[];
  artifactObservationIds: readonly string[];
  priorSizeBytes: number;
  attemptCount: number;
  outcome: "verified-erased";
  completedAtMs: number;
}>;

export type RetentionCheckpoint = Readonly<{
  checkpointId: string;
  planId: string;
  receiptId: string;
  sequence: number;
  completedAtMs: number;
}>;

export type RetentionReceiptRevalidation = Readonly<{
  revalidationId: string;
  planId: string;
  sequence: number;
  predecessorReceiptId: string;
  receipt: RetentionReceipt;
  recordedAtMs: number;
}>;

export type ErasureCopyKind = "content" | "staging" | "snapshot" | "quarantine";

export type ErasureResult = Readonly<{
  artifactDigest: string;
  erasedCopies: Readonly<Record<ErasureCopyKind, number>>;
  alreadyAbsent: boolean;
}>;

export interface RetentionArtifactBoundary {
  settleActiveReadersAndWriters(): Promise<boolean>;
  eraseDigestCopies(digest: string): Promise<ErasureResult>;
  verifyDigestCopiesAbsent(digest: string): Promise<boolean>;
}

export interface ArtifactRetentionJournal {
  registerOwnershipAndApplyActiveStop(ownership: RetentionOwnership): boolean;
  registerDerivedLineageAndApplyActiveStop(
    ownershipId: string,
    derivedIds: readonly string[],
  ): boolean;
  listOwnership(
    providerLane: RetentionProviderLane,
    providerId: string,
  ): readonly RetentionOwnership[];
  ownershipForDigest(digest: string): readonly RetentionOwnership[];
  ownershipForDerivedId(derivedId: string): readonly RetentionOwnership[];
  recordStopAndDenials(stop: RetentionStopEvent, derivedIds: readonly string[]): void;
  providerUseDenied(providerLane: RetentionProviderLane, providerId: string): boolean;
  reconciliationUseDenied(trustedNowMs: number): boolean;
  digestUseDenied(digest: string): boolean;
  derivedUseDenied(derivedId: string): boolean;
  recordPlan(plan: RetentionErasurePlan): void;
  getPlan(planId: string): RetentionErasurePlan | undefined;
  getPlanForStop(stopEventId: string): RetentionErasurePlan | undefined;
  recordAttempt(attempt: RetentionErasureAttempt): void;
  attemptsFor(planId: string, digest: string): readonly RetentionErasureAttempt[];
  recordTombstone(tombstone: RetentionTombstone): void;
  hasTombstone(digest: string): boolean;
  recordReceipt(receipt: RetentionReceipt): void;
  getReceiptForPlan(planId: string): RetentionReceipt | undefined;
  recordReceiptRevalidation(revalidation: RetentionReceiptRevalidation): void;
  recordReceiptRevalidationAndCheckpoint(
    revalidation: RetentionReceiptRevalidation,
    checkpoint: RetentionCheckpoint,
  ): void;
  receiptRevalidationsForPlan(planId: string): readonly RetentionReceiptRevalidation[];
  revalidationCheckpointsForPlan(planId: string): readonly RetentionCheckpoint[];
  recordCheckpoint(checkpoint: RetentionCheckpoint): void;
  getCheckpoint(planId: string): RetentionCheckpoint | undefined;
}

export interface ArtifactRetentionController {
  registerOwnership(input: Omit<RetentionOwnership, "ownershipId">): RetentionOwnership;
  commitArtifact<T>(prepared: AlpacaPreparedArtifactCommit<T>): Promise<T>;
  commitArtifact<T>(
    input: Omit<RetentionOwnership, "ownershipId">,
    commit: () => Promise<T>,
  ): Promise<T>;
  registerDerivedLineage(artifactDigests: readonly string[], derivedIds: readonly string[]): void;
  registerDerivedLineageFromLease(lease: object, derivedIds: readonly string[]): void;
  beginUse(
    artifactDigests?: readonly string[],
    derivedIds?: readonly string[],
  ): RetentionOperationLease;
  enforceStop(input: Omit<RetentionStopEvent, "stopEventId">): Promise<RetentionReceipt>;
  assertArtifactUseAllowed(digest: string): void;
  assertDerivedUseAllowed(derivedId: string): void;
}

export interface RetentionOperationLease {
  assertAllowed(): void;
  onStop(handler: () => void): void;
  release(): void;
}
