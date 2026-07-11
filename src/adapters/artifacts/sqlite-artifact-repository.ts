import type { SqliteDatabase } from "../sqlite/database.js";
import type {
  ArtifactMetadata,
  ArtifactObservation,
  ArtifactPage,
  IntegrityIncident,
  RetrievalAttempt,
  RetrievalAttemptOutcome,
  SafeHttpResponseMetadata,
} from "../../artifacts/artifact-store.js";
import { canonicalHash } from "../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../core/json.js";

type AttemptRow = {
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
};
type ObservationRow = {
  sequence: bigint;
  observation_json: string;
  observation_hash: string;
};

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

export class SqliteArtifactRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  recordAttempt(attempt: RetrievalAttempt): void {
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
      .prepare(
        "SELECT staging_id, attempt_json, attempt_hash FROM artifact_retrieval_attempts WHERE attempt_id = ?",
      )
      .get(id) as AttemptRow | undefined;
    if (row === undefined) return undefined;
    const attempt = parseCanonical<RetrievalAttempt>(
      row.attempt_json,
      row.attempt_hash,
      "peas/artifact-attempt/v1",
    );
    if (attempt.attemptId !== id || attempt.stagingId !== row.staging_id)
      throw new Error("Artifact attempt relational mismatch");
    return attempt;
  }

  finishAttempt(outcome: RetrievalAttemptOutcome): void {
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
  ): "created" | "deduplicated" {
    return this.#database
      .transaction(() => {
        const existing = this.stat(artifact.digest);
        let disposition: "created" | "deduplicated" = "deduplicated";
        if (existing === undefined) {
          this.#database
            .prepare(`INSERT INTO artifact_blobs (
          digest, algorithm, size_bytes, committed_at_ms, provenance
        ) VALUES (?, 'sha256', ?, ?, ?)`)
            .run(artifact.digest, artifact.sizeBytes, artifact.committedAtMs, artifact.provenance);
          disposition = "created";
        } else if (existing.sizeBytes !== artifact.sizeBytes) {
          throw new Error("Artifact metadata size conflict");
        }

        this.finishAttempt({
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

  adoptArtifact(artifact: ArtifactMetadata): boolean {
    const result = this.#database
      .prepare(`INSERT OR IGNORE INTO artifact_blobs (
      digest, algorithm, size_bytes, committed_at_ms, provenance
    ) VALUES (?, 'sha256', ?, ?, 'recovered-orphan')`)
      .run(artifact.digest, artifact.sizeBytes, artifact.committedAtMs);
    return result.changes === 1;
  }

  stat(digest: string): ArtifactMetadata | undefined {
    const row = this.#database
      .prepare("SELECT * FROM artifact_blobs WHERE digest = ?")
      .get(digest) as BlobRow | undefined;
    if (row === undefined) return undefined;
    return {
      digest: row.digest,
      algorithm: row.algorithm,
      sizeBytes: safeNumber(row.size_bytes, "artifact size"),
      committedAtMs: safeNumber(row.committed_at_ms, "artifact commit time"),
      provenance: row.provenance,
    };
  }

  getObservation(id: string): ArtifactObservation | undefined {
    const row = this.#database
      .prepare(`SELECT sequence, observation_json, observation_hash
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
      .prepare(`SELECT sequence, observation_json, observation_hash
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

  recordIncident(incident: IntegrityIncident): void {
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
    return rows.map((row) => ({
      digest: row.digest,
      algorithm: row.algorithm,
      sizeBytes: safeNumber(row.size_bytes, "artifact size"),
      committedAtMs: safeNumber(row.committed_at_ms, "artifact commit time"),
      provenance: row.provenance,
    }));
  }

  listOpenAttempts(): readonly RetrievalAttempt[] {
    const rows = this.#database
      .prepare(`SELECT a.staging_id, a.attempt_json, a.attempt_hash
      FROM artifact_retrieval_attempts a
      LEFT JOIN artifact_retrieval_outcomes o ON o.attempt_id = a.attempt_id
      WHERE o.attempt_id IS NULL ORDER BY a.attempt_id`)
      .all() as AttemptRow[];
    return rows.map((row) =>
      parseCanonical<RetrievalAttempt>(
        row.attempt_json,
        row.attempt_hash,
        "peas/artifact-attempt/v1",
      ),
    );
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
    return observation;
  }
}
