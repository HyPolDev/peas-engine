import type { SqliteDatabase } from "../sqlite/database.js";
import type {
  ArtifactMetadata,
  ArtifactObservation,
  ArtifactPage,
  IntegrityIncident,
  RetrievalAttempt,
  RetrievalAttemptOutcome,
  SafeHttpResponseMetadata,
  StoreArtifactResult,
} from "../../artifacts/artifact-store.js";
import { canonicalHash } from "../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../core/json.js";

type AttemptRow = {
  attempt_id: string;
  provider: string;
  provider_record_id: string;
  provider_revision_id: string;
  started_at_ms: bigint;
  recorded_at_ms: bigint;
  request_method: string;
  request_origin: string;
  request_path_hash: string;
  request_route_label: string;
  request_identity_hash: string;
  staging_id: string;
  attempt_json: string;
  attempt_hash: string;
};
type BlobRow = {
  digest: string;
  algorithm: "sha256";
  size_bytes: bigint;
  committed_at_ms: bigint;
  provenance: "retrieval" | "recovered-orphan";
  blob_json: string;
  blob_hash: string;
};
type ObservationRow = {
  sequence: bigint;
  observation_json: string;
  observation_hash: string;
  observation_id: string;
  attempt_id: string;
  artifact_digest: string;
  provider: string;
  provider_record_id: string;
  provider_revision_id: string;
  retrieved_at_ms: bigint;
  request_method: string;
  request_origin: string;
  request_path_hash: string;
  request_route_label: string;
  request_identity_hash: string;
  status_code: bigint;
  etag: string | null;
  last_modified: string | null;
  media_type: string | null;
  content_encoding: string | null;
  declared_content_length: bigint | null;
  transport_decoded: bigint;
};

function relationalMismatch(label: string, pairs: readonly (readonly [unknown, unknown])[]): void {
  if (pairs.some(([canonical, relational]) => canonical !== relational))
    throw new Error(`${label} relational mismatch`);
}

function safeNumber(value: bigint, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error(`${label} is not a safe integer`);
  return number;
}

function parseCanonical<T>(serialized: string, hash: string, domain: string): T {
  const value = JSON.parse(serialized) as JsonValue;
  if (canonicalJson(value) !== serialized) throw new Error(`${domain} is not canonically encoded`);
  if (canonicalHash(domain, value) !== hash) throw new Error(`${domain} hash mismatch`);
  return value as T;
}

export type WriterFence = Readonly<{
  ownerToken: string;
  generation: number;
  nowMs: () => number;
}>;

export class SqliteArtifactRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  claimWriter(ownerToken: string, nowMs: number, durationMs: number): number {
    return this.#database
      .transaction(() => {
        const row = this.#database
          .prepare(
            "SELECT generation, expires_at_ms FROM artifact_writer_fence WHERE singleton = 1",
          )
          .get() as { generation: bigint; expires_at_ms: bigint } | undefined;
        if (row !== undefined && safeNumber(row.expires_at_ms, "writer lease expiry") > nowMs) {
          throw new Error("Vault writer fence is held");
        }
        const generation =
          row === undefined ? 1 : safeNumber(row.generation, "writer generation") + 1;
        this.#database
          .prepare(`INSERT INTO artifact_writer_fence
        (singleton, generation, owner_token, expires_at_ms) VALUES (1, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation,
          owner_token=excluded.owner_token, expires_at_ms=excluded.expires_at_ms`)
          .run(generation, ownerToken, nowMs + durationMs);
        return generation;
      })
      .immediate();
  }

  renewWriter(ownerToken: string, generation: number, nowMs: number, durationMs: number): void {
    const result = this.#database
      .prepare(`UPDATE artifact_writer_fence
      SET expires_at_ms = ? WHERE singleton = 1 AND owner_token = ? AND generation = ?
      AND expires_at_ms >= ?`)
      .run(nowMs + durationMs, ownerToken, generation, nowMs);
    if (result.changes !== 1) throw new Error("Vault writer lease was lost");
  }

  assertWriter(fence: WriterFence): void {
    const nowMs = fence.nowMs();
    const row = this.#database
      .prepare(`SELECT 1 present FROM artifact_writer_fence
      WHERE singleton = 1 AND owner_token = ? AND generation = ? AND expires_at_ms >= ?`)
      .get(fence.ownerToken, fence.generation, nowMs);
    if (row === undefined) throw new Error("Vault writer lease was lost");
  }

  recordAttempt(attempt: RetrievalAttempt, fence: WriterFence): void {
    this.#database
      .transaction(() => {
        this.assertWriter(fence);
        this.#insertAttempt(attempt);
      })
      .immediate();
  }

  #insertAttempt(attempt: RetrievalAttempt): void {
    const json = canonicalJson(attempt as unknown as JsonValue);
    const hash = canonicalHash("peas/artifact-attempt/v1", attempt as unknown as JsonValue);
    this.#database
      .prepare(`INSERT INTO artifact_retrieval_attempts (
        attempt_id, staging_id, provider, provider_record_id, provider_revision_id,
        started_at_ms, recorded_at_ms, request_method, request_origin, request_path_hash,
        request_route_label, request_identity_hash, attempt_json, attempt_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        attempt.attemptId,
        attempt.stagingId,
        attempt.provider,
        attempt.recordId,
        attempt.revisionId,
        attempt.startedAtMs,
        attempt.recordedAtMs,
        attempt.request.method,
        attempt.request.origin,
        attempt.request.pathHash,
        attempt.request.routeLabel,
        attempt.request.identityHash,
        json,
        hash,
      );
  }

  getAttempt(id: string): RetrievalAttempt | undefined {
    const row = this.#database
      .prepare("SELECT * FROM artifact_retrieval_attempts WHERE attempt_id = ?")
      .get(id) as AttemptRow | undefined;
    if (row === undefined) return undefined;
    const attempt = parseCanonical<RetrievalAttempt>(
      row.attempt_json,
      row.attempt_hash,
      "peas/artifact-attempt/v1",
    );
    relationalMismatch("Artifact attempt", [
      [attempt.attemptId, row.attempt_id],
      [attempt.stagingId, row.staging_id],
      [attempt.provider, row.provider],
      [attempt.recordId, row.provider_record_id],
      [attempt.revisionId, row.provider_revision_id],
      [attempt.startedAtMs, safeNumber(row.started_at_ms, "attempt start")],
      [attempt.recordedAtMs, safeNumber(row.recorded_at_ms, "attempt record time")],
      [attempt.request.method, row.request_method],
      [attempt.request.origin, row.request_origin],
      [attempt.request.pathHash, row.request_path_hash],
      [attempt.request.routeLabel, row.request_route_label],
      [attempt.request.identityHash, row.request_identity_hash],
    ]);
    return attempt;
  }

  getCompletedResult(attemptId: string): StoreArtifactResult | undefined {
    const outcome = this.#getOutcome(attemptId);
    if (outcome === undefined || outcome.outcome !== "succeeded") return undefined;
    const row = this.#database
      .prepare(`SELECT * FROM artifact_observations WHERE attempt_id = ?`)
      .get(attemptId) as ObservationRow | undefined;
    if (row === undefined) throw new Error("Succeeded artifact observation is missing");
    const observation = this.#parseObservation(row);
    const artifact = this.stat(observation.artifactDigest);
    if (artifact === undefined) throw new Error("Completed artifact metadata is missing");
    return { artifact, observation, disposition: "deduplicated" };
  }

  finishAttempt(outcome: RetrievalAttemptOutcome, fence: WriterFence): void {
    this.#database
      .transaction(() => {
        this.assertWriter(fence);
        this.#insertOutcome(outcome);
      })
      .immediate();
  }

  #insertOutcome(outcome: RetrievalAttemptOutcome): void {
    const json = canonicalJson(outcome as unknown as JsonValue);
    const hash = canonicalHash("peas/artifact-attempt-outcome/v1", outcome as unknown as JsonValue);
    this.#database
      .prepare(`INSERT INTO artifact_retrieval_outcomes (
        attempt_id, outcome, completed_at_ms, reason_code, detail_hash, outcome_json, outcome_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        outcome.attemptId,
        outcome.outcome,
        outcome.completedAtMs,
        outcome.reasonCode,
        outcome.detailHash,
        json,
        hash,
      );
  }

  commitSuccess(
    artifact: ArtifactMetadata,
    observation: ArtifactObservation,
    response: SafeHttpResponseMetadata,
    fence: WriterFence,
  ): "created" | "deduplicated" {
    return this.#database
      .transaction(() => {
        this.assertWriter(fence);
        const existing = this.stat(artifact.digest);
        let disposition: "created" | "deduplicated" = "deduplicated";
        if (existing === undefined) {
          this.#database
            .prepare(`INSERT INTO artifact_blobs (
          digest, algorithm, size_bytes, committed_at_ms, provenance, blob_json, blob_hash
        ) VALUES (?, 'sha256', ?, ?, ?, ?, ?)`)
            .run(
              artifact.digest,
              artifact.sizeBytes,
              artifact.committedAtMs,
              artifact.provenance,
              canonicalJson(artifact as unknown as JsonValue),
              canonicalHash("peas/artifact-blob/v1", artifact as unknown as JsonValue),
            );
          disposition = "created";
        } else if (existing.sizeBytes !== artifact.sizeBytes) {
          throw new Error("Artifact metadata size conflict");
        }

        this.#insertOutcome({
          attemptId: observation.attemptId,
          outcome: "succeeded",
          completedAtMs: artifact.committedAtMs,
          reasonCode: null,
          detailHash: null,
        });
        const jsonValue = { ...observation, observationHash: undefined } as unknown as Record<
          string,
          JsonValue
        >;
        delete jsonValue["observationHash"];
        const json = canonicalJson(jsonValue);
        this.#database
          .prepare(`INSERT INTO artifact_observations (
        observation_id, attempt_id, artifact_digest, provider, provider_record_id,
        provider_revision_id, retrieved_at_ms, request_method, request_origin,
        request_path_hash, request_route_label, request_identity_hash, status_code,
        etag, last_modified, media_type, content_encoding, declared_content_length,
        transport_decoded, observation_json, observation_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
          .run(
            observation.observationId,
            observation.attemptId,
            observation.artifactDigest,
            observation.provider,
            observation.recordId,
            observation.revisionId,
            observation.retrievedAtMs,
            observation.request.method,
            observation.request.origin,
            observation.request.pathHash,
            observation.request.routeLabel,
            observation.request.identityHash,
            response.statusCode,
            response.etag,
            response.lastModified,
            response.mediaType,
            response.contentEncoding,
            response.declaredContentLength,
            json,
            observation.observationHash,
          );
        return disposition;
      })
      .immediate();
  }

  adoptArtifact(artifact: ArtifactMetadata, fence: WriterFence): boolean {
    return this.#database
      .transaction(() => {
        this.assertWriter(fence);
        const result = this.#database
          .prepare(`INSERT OR IGNORE INTO artifact_blobs (
      digest, algorithm, size_bytes, committed_at_ms, provenance, blob_json, blob_hash
    ) VALUES (?, 'sha256', ?, ?, 'recovered-orphan', ?, ?)`)
          .run(
            artifact.digest,
            artifact.sizeBytes,
            artifact.committedAtMs,
            canonicalJson(artifact as unknown as JsonValue),
            canonicalHash("peas/artifact-blob/v1", artifact as unknown as JsonValue),
          );
        return result.changes === 1;
      })
      .immediate();
  }

  stat(digest: string): ArtifactMetadata | undefined {
    const row = this.#database
      .prepare("SELECT * FROM artifact_blobs WHERE digest = ?")
      .get(digest) as BlobRow | undefined;
    if (row === undefined) return undefined;
    const artifact = parseCanonical<ArtifactMetadata>(
      row.blob_json,
      row.blob_hash,
      "peas/artifact-blob/v1",
    );
    if (
      artifact.digest !== row.digest ||
      artifact.algorithm !== row.algorithm ||
      artifact.sizeBytes !== safeNumber(row.size_bytes, "artifact size") ||
      artifact.committedAtMs !== safeNumber(row.committed_at_ms, "artifact commit time") ||
      artifact.provenance !== row.provenance
    )
      throw new Error("Artifact blob relational mismatch");
    return artifact;
  }

  getObservation(id: string): ArtifactObservation | undefined {
    const row = this.#database
      .prepare(`SELECT *
      FROM artifact_observations WHERE observation_id = ?`)
      .get(id) as ObservationRow | undefined;
    return row === undefined ? undefined : this.#parseObservation(row, id);
  }

  readObservations(
    digest: string,
    afterSequence: string,
    limit: number,
  ): ArtifactPage<ArtifactObservation> {
    const after = BigInt(afterSequence);
    const rows = this.#database
      .prepare(`SELECT *
      FROM artifact_observations WHERE artifact_digest = ? AND sequence > ?
      ORDER BY sequence LIMIT ?`)
      .all(digest, after, limit + 1) as ObservationRow[];
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    return {
      items: selected.map((row) => this.#parseObservation(row)),
      nextSequence: selected.at(-1)?.sequence.toString() ?? afterSequence,
      hasMore,
    };
  }

  recordIncident(incident: IntegrityIncident, fence: WriterFence): void {
    this.#database
      .transaction(() => {
        this.assertWriter(fence);
        this.#insertIncident(incident);
      })
      .immediate();
  }

  #insertIncident(incident: IntegrityIncident): void {
    const json = canonicalJson(incident as unknown as JsonValue);
    const hash = canonicalHash("peas/artifact-incident/v1", incident as unknown as JsonValue);
    this.#database
      .prepare(`INSERT OR IGNORE INTO artifact_integrity_incidents (
      incident_id, kind, recorded_at_ms, staging_id, claimed_digest, expected_size_bytes,
      actual_size_bytes, detail_hash, incident_json, incident_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        incident.incidentId,
        incident.kind,
        incident.recordedAtMs,
        incident.stagingId,
        incident.claimedDigest,
        incident.expectedSizeBytes,
        incident.actualSizeBytes,
        incident.detailHash,
        json,
        hash,
      );
  }

  listArtifacts(): readonly ArtifactMetadata[] {
    const rows = this.#database
      .prepare("SELECT * FROM artifact_blobs ORDER BY digest")
      .all() as BlobRow[];
    return rows.map((row) => this.stat(row.digest) as ArtifactMetadata);
  }

  listOpenAttempts(): readonly RetrievalAttempt[] {
    const rows = this.#database
      .prepare(`SELECT a.*
      FROM artifact_retrieval_attempts a
      LEFT JOIN artifact_retrieval_outcomes o ON o.attempt_id = a.attempt_id
      WHERE o.attempt_id IS NULL ORDER BY a.attempt_id`)
      .all() as AttemptRow[];
    return rows.map((row) => this.getAttempt(row.attempt_id) as RetrievalAttempt);
  }

  verifyAllEvidence(): void {
    for (const row of this.#database
      .prepare("SELECT attempt_id FROM artifact_retrieval_attempts")
      .all() as { attempt_id: string }[])
      this.getAttempt(row.attempt_id);
    for (const row of this.#database
      .prepare("SELECT attempt_id FROM artifact_retrieval_outcomes")
      .all() as Array<{ attempt_id: string }>)
      this.#getOutcome(row.attempt_id);
    for (const row of this.#database
      .prepare("SELECT * FROM artifact_observations")
      .all() as ObservationRow[])
      this.#parseObservation(row);
    for (const row of this.#database
      .prepare("SELECT * FROM artifact_integrity_incidents")
      .all() as Array<Record<string, unknown>>) {
      const incident = parseCanonical<IntegrityIncident>(
        row["incident_json"] as string,
        row["incident_hash"] as string,
        "peas/artifact-incident/v1",
      );
      const numberOrNull = (value: unknown, label: string): number | null =>
        value === null ? null : safeNumber(value as bigint, label);
      relationalMismatch("Artifact incident", [
        [incident.incidentId, row["incident_id"]],
        [incident.kind, row["kind"]],
        [incident.recordedAtMs, safeNumber(row["recorded_at_ms"] as bigint, "incident time")],
        [incident.stagingId, row["staging_id"]],
        [incident.claimedDigest, row["claimed_digest"]],
        [
          incident.expectedSizeBytes,
          numberOrNull(row["expected_size_bytes"], "incident expected size"),
        ],
        [incident.actualSizeBytes, numberOrNull(row["actual_size_bytes"], "incident actual size")],
        [incident.detailHash, row["detail_hash"]],
      ]);
    }
    this.listArtifacts();
  }

  #getOutcome(attemptId: string): RetrievalAttemptOutcome | undefined {
    const row = this.#database
      .prepare("SELECT * FROM artifact_retrieval_outcomes WHERE attempt_id = ?")
      .get(attemptId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    const outcome = parseCanonical<RetrievalAttemptOutcome>(
      row["outcome_json"] as string,
      row["outcome_hash"] as string,
      "peas/artifact-attempt-outcome/v1",
    );
    relationalMismatch("Artifact outcome", [
      [outcome.attemptId, row["attempt_id"]],
      [outcome.outcome, row["outcome"]],
      [outcome.completedAtMs, safeNumber(row["completed_at_ms"] as bigint, "outcome completion")],
      [outcome.reasonCode, row["reason_code"]],
      [outcome.detailHash, row["detail_hash"]],
    ]);
    return outcome;
  }

  #parseObservation(row: ObservationRow, expectedId?: string): ArtifactObservation {
    const raw = parseCanonical<Omit<ArtifactObservation, "observationHash">>(
      row.observation_json,
      row.observation_hash,
      "peas/artifact-observation/v1",
    );
    const observation = { ...raw, observationHash: row.observation_hash };
    if (expectedId !== undefined && observation.observationId !== expectedId) {
      throw new Error("Artifact observation relational mismatch");
    }
    relationalMismatch("Artifact observation", [
      [observation.observationId, row.observation_id],
      [observation.attemptId, row.attempt_id],
      [observation.artifactDigest, row.artifact_digest],
      [observation.provider, row.provider],
      [observation.recordId, row.provider_record_id],
      [observation.revisionId, row.provider_revision_id],
      [observation.retrievedAtMs, safeNumber(row.retrieved_at_ms, "observation retrieval time")],
      [observation.request.method, row.request_method],
      [observation.request.origin, row.request_origin],
      [observation.request.pathHash, row.request_path_hash],
      [observation.request.routeLabel, row.request_route_label],
      [observation.request.identityHash, row.request_identity_hash],
      [observation.response.statusCode, safeNumber(row.status_code, "status")],
      [observation.response.etag, row.etag],
      [observation.response.lastModified, row.last_modified],
      [observation.response.mediaType, row.media_type],
      [observation.response.contentEncoding, row.content_encoding],
      [
        observation.response.declaredContentLength,
        row.declared_content_length === null
          ? null
          : safeNumber(row.declared_content_length, "declared length"),
      ],
      [observation.response.transportDecoded, row.transport_decoded === 1n],
    ]);
    return observation;
  }
}
