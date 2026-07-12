import type { Readable } from "node:stream";

export type ArtifactDigest = string;
export type ArtifactSize = number;
export type RetrievalAttemptId = string;
export type PersistedAttemptId = string & { readonly __persistedAttemptId: unique symbol };
export type PersistedProviderId = string & { readonly __persistedProviderId: unique symbol };
export type PersistedRecordId = string & { readonly __persistedRecordId: unique symbol };
export type PersistedRevisionId = string & { readonly __persistedRevisionId: unique symbol };
export type ObservationId = string;
export type StagingId = string;
export type IncidentId = string;
export type ReconciliationRunId = string;
export type ReconciliationActionKey = string;
export type InstallIntentId = string;

export type RetrievalOutcome = "succeeded" | "failed" | "abandoned" | "expired";

export type IncidentKind =
  | "abandoned-stage"
  | "expired-stage"
  | "invalid-orphan"
  | "metadata-less-orphan"
  | "missing-content"
  | "size-mismatch"
  | "digest-mismatch"
  | "unsafe-filesystem-object"
  | "conflicting-destination"
  | "snapshot-verification-failure";

export type SanitizedRequestIdentity = Readonly<{
  method: string;
  origin: string;
  pathHash: string;
  routeLabel: string;
  identityHash: string;
}>;

export type SafeHttpResponseMetadata = Readonly<{
  statusCode: number;
  etag: string | null;
  lastModified: string | null;
  mediaType: string | null;
  contentEncoding: string | null;
  declaredContentLength: number | null;
  transportDecoded: true;
}>;

export type RetrievalAttemptDraft = Readonly<{
  attemptId: RetrievalAttemptId;
  provider: string;
  recordId: string;
  revisionId: string;
  startedAtMs: number;
  request: SanitizedRequestIdentity;
}>;

export type PersistedRetrievalAttemptDraft = Readonly<{
  attemptId: PersistedAttemptId;
  provider: PersistedProviderId;
  recordId: PersistedRecordId;
  revisionId: PersistedRevisionId;
  startedAtMs: number;
  request: SanitizedRequestIdentity;
}>;

export type RetrievalAttempt = PersistedRetrievalAttemptDraft &
  Readonly<{ stagingId: StagingId; recordedAtMs: number }>;

export type RetrievalAttemptOutcome = Readonly<{
  attemptId: PersistedAttemptId;
  outcome: RetrievalOutcome;
  completedAtMs: number;
  reasonCode: string | null;
  detailHash: string | null;
}>;

export type ArtifactMetadata = Readonly<{
  digest: ArtifactDigest;
  algorithm: "sha256";
  sizeBytes: ArtifactSize;
  committedAtMs: number;
  provenance: "retrieval" | "recovered-orphan";
}>;

export type ArtifactObservation = Readonly<{
  observationId: ObservationId;
  attemptId: PersistedAttemptId;
  artifactDigest: ArtifactDigest;
  provider: PersistedProviderId;
  recordId: PersistedRecordId;
  revisionId: PersistedRevisionId;
  retrievedAtMs: number;
  request: SanitizedRequestIdentity;
  response: SafeHttpResponseMetadata;
  observationHash: string;
}>;

export type IntegrityIncident = Readonly<{
  incidentId: IncidentId;
  actionKey?: ReconciliationActionKey | null;
  kind: IncidentKind;
  recordedAtMs: number;
  stagingId: StagingId | null;
  claimedDigest: ArtifactDigest | null;
  expectedSizeBytes: ArtifactSize | null;
  actualSizeBytes: ArtifactSize | null;
  detailHash: string | null;
}>;

export type StoreArtifactRequest = Readonly<{
  attempt: RetrievalAttemptDraft;
  response: SafeHttpResponseMetadata;
  entityBytes: Readable;
}>;

export type StoreArtifactResult = Readonly<{
  artifact: ArtifactMetadata;
  observation: ArtifactObservation;
  disposition: "created" | "deduplicated";
}>;

export type VerifiedArtifactRead = Readonly<{
  artifact: ArtifactMetadata;
  stream: Readable;
}>;

export type ArtifactPage<T> = Readonly<{
  items: readonly T[];
  nextSequence: string;
  hasMore: boolean;
}>;

export type ReconciliationReport = Readonly<{
  runId: ReconciliationRunId;
  validArtifacts: number;
  adoptedOrphans: number;
  abandonedStages: number;
  expiredStages: number;
  quarantinedObjects: number;
  missingArtifacts: number;
  incidents: readonly IncidentId[];
  continuationCursor: string | null;
  rowsVisited: number;
  directoryEntriesRead: number;
  bytesHashed: number;
  elapsedMs: number;
}>;

export type ReconciliationBudget = Readonly<{
  cursor: string | null;
  startNew: boolean;
  completedRunId: ReconciliationRunId | null;
  maxItems: number;
  maxElapsedMs: number;
  maxBytes: number;
}>;

export type ArtifactVaultConfig = Readonly<{
  runtimeRootMode: "configured" | "ci-temporary";
  runtimeRoot: string;
  maxArtifactBytes: number;
  maxVaultBytes: number;
  maxConcurrentWrites: number;
  streamHighWaterMarkBytes: number;
  stageExpiryMs: number;
  writerLeaseBehavior: "fail" | "wait";
  writerLeaseWaitMs: number;
  writerLeaseDurationMs: number;
  writerLeaseRenewalMs: number;
}>;

export interface ArtifactStore {
  store(request: StoreArtifactRequest): Promise<StoreArtifactResult>;
  stat(digest: ArtifactDigest): Promise<ArtifactMetadata | undefined>;
  read(digest: ArtifactDigest): Promise<VerifiedArtifactRead>;
  getAttempt(id: RetrievalAttemptId): Promise<RetrievalAttempt | undefined>;
  getObservation(id: ObservationId): Promise<ArtifactObservation | undefined>;
  readObservations(
    digest: ArtifactDigest,
    afterSequence: string,
    limit: number,
  ): Promise<ArtifactPage<ArtifactObservation>>;
  reconcile(budget?: Partial<ReconciliationBudget>): Promise<ReconciliationReport>;
}
