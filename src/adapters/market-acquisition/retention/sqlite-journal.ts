import { assertOwnedSqliteDatabase, type SqliteDatabase } from "../../sqlite/database.js";
import { canonicalHash } from "../../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../../core/json.js";
import {
  ALPACA_PRIVATE_ARTIFACT_POLICY,
  FMP_PRIVATE_ARTIFACT_POLICY,
  type PrivateArtifactPolicy,
} from "../private-artifact-policy.js";
import type {
  ArtifactRetentionJournal,
  RetentionCheckpoint,
  RetentionErasureAttempt,
  RetentionErasurePlan,
  RetentionOwnership,
  RetentionProviderLane,
  RetentionReceipt,
  RetentionStopEvent,
  RetentionTombstone,
} from "./contracts.js";

const ownedSqliteRetentionJournals = new WeakSet<object>();

type JsonRow = Readonly<{ json: string; hash: string }>;

function parseRecord<T>(row: JsonRow, domain: string): T {
  const value = JSON.parse(row.json) as JsonValue;
  if (canonicalJson(value) !== row.json || canonicalHash(domain, value) !== row.hash)
    throw new Error(`${domain} evidence mismatch`);
  return value as T;
}

function sameRecord(label: string, stored: unknown, value: unknown): void {
  if (canonicalJson(stored as JsonValue) !== canonicalJson(value as JsonValue))
    throw new Error(`${label} conflicts with immutable retention evidence`);
}

export class SqliteArtifactRetentionJournal implements ArtifactRetentionJournal {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
    this.#registerPolicy(ALPACA_PRIVATE_ARTIFACT_POLICY);
    this.#registerPolicy(FMP_PRIVATE_ARTIFACT_POLICY);
  }

  registerOwnershipAndApplyActiveStop(value: RetentionOwnership): boolean {
    let allowed = true;
    this.#database
      .transaction(() => {
        const json = canonicalJson(value as unknown as JsonValue);
        const hash = canonicalHash(
          "peas/market-acquisition-retention-ownership-record/v1",
          value as unknown as JsonValue,
        );
        this.#database
          .prepare(`INSERT OR IGNORE INTO market_retention_ownership (
            ownership_id, policy_id, provider_lane, provider_id, dataset_id, feed_id,
            endpoint_channel_id, artifact_observation_id, artifact_digest, trusted_capture_ms,
            artifact_size_bytes, expires_at_ms, ownership_json, ownership_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            value.ownershipId,
            value.policyId,
            value.providerLane,
            value.providerId,
            value.datasetId,
            value.feedId,
            value.endpointChannelId,
            value.artifactObservationId,
            value.artifactDigest,
            value.trustedCaptureMs,
            value.artifactSizeBytes,
            value.expiresAtMs,
            json,
            hash,
          );
        const existing = this.#ownership(value.ownershipId);
        if (existing === undefined) throw new Error("Retention ownership insert failed");
        sameRecord("Ownership", existing, value);
        const insertDerived = this.#database.prepare(
          "INSERT OR IGNORE INTO market_retention_derivation_ownership (ownership_id, derived_id) VALUES (?, ?)",
        );
        for (const derivedId of value.derivedIds) insertDerived.run(value.ownershipId, derivedId);
        const persistedDerived = (
          this.#database
            .prepare(
              "SELECT derived_id FROM market_retention_derivation_ownership WHERE ownership_id = ? ORDER BY derived_id",
            )
            .all(value.ownershipId) as Array<{ derived_id: string }>
        ).map((row) => row.derived_id);
        if (value.derivedIds.some((derivedId) => !persistedDerived.includes(derivedId))) {
          throw new Error("Derivation ownership conflicts with immutable retention evidence");
        }
        const active = this.#database
          .prepare(`SELECT stop_event_id FROM market_retention_provider_denials
            WHERE provider_lane = ? AND provider_id = ?`)
          .get(value.providerLane, value.providerId) as { stop_event_id: string } | undefined;
        if (active !== undefined) {
          allowed = false;
          this.#database
            .prepare(
              "INSERT OR IGNORE INTO market_retention_digest_denials (stop_event_id, artifact_digest) VALUES (?, ?)",
            )
            .run(active.stop_event_id, value.artifactDigest);
          const denyDerived = this.#database.prepare(
            "INSERT OR IGNORE INTO market_retention_derivation_denials (stop_event_id, derived_id) VALUES (?, ?)",
          );
          for (const derivedId of value.derivedIds)
            denyDerived.run(active.stop_event_id, derivedId);
        }
      })
      .immediate();
    return allowed;
  }

  registerDerivedLineageAndApplyActiveStop(
    ownershipId: string,
    derivedIds: readonly string[],
  ): boolean {
    let allowed = true;
    this.#database
      .transaction(() => {
        const ownership = this.#ownership(ownershipId);
        if (ownership === undefined) throw new Error("Retention ownership is missing");
        const insert = this.#database.prepare(
          "INSERT OR IGNORE INTO market_retention_derivation_ownership (ownership_id, derived_id) VALUES (?, ?)",
        );
        for (const derivedId of derivedIds) insert.run(ownershipId, derivedId);
        const active = this.#database
          .prepare(`SELECT stop_event_id FROM market_retention_provider_denials
            WHERE provider_lane = ? AND provider_id = ?`)
          .get(ownership.providerLane, ownership.providerId) as
          | { stop_event_id: string }
          | undefined;
        if (active !== undefined) {
          allowed = false;
          const deny = this.#database.prepare(
            "INSERT OR IGNORE INTO market_retention_derivation_denials (stop_event_id, derived_id) VALUES (?, ?)",
          );
          for (const derivedId of derivedIds) deny.run(active.stop_event_id, derivedId);
        }
      })
      .immediate();
    return allowed;
  }

  listOwnership(lane: RetentionProviderLane, providerId: string): readonly RetentionOwnership[] {
    const rows = this.#database
      .prepare(`SELECT ownership_json AS json, ownership_hash AS hash
        FROM market_retention_ownership
        WHERE provider_lane = ? AND provider_id = ? ORDER BY ownership_id`)
      .all(lane, providerId) as JsonRow[];
    return rows.map((row) =>
      this.#withDerived(
        parseRecord<RetentionOwnership>(
          row,
          "peas/market-acquisition-retention-ownership-record/v1",
        ),
      ),
    );
  }

  ownershipForDigest(digest: string): readonly RetentionOwnership[] {
    const rows = this.#database
      .prepare(`SELECT ownership_json AS json, ownership_hash AS hash
        FROM market_retention_ownership WHERE artifact_digest = ? ORDER BY ownership_id`)
      .all(digest) as JsonRow[];
    return rows.map((row) =>
      this.#withDerived(
        parseRecord<RetentionOwnership>(
          row,
          "peas/market-acquisition-retention-ownership-record/v1",
        ),
      ),
    );
  }

  ownershipForDerivedId(derivedId: string): readonly RetentionOwnership[] {
    const rows = this.#database
      .prepare(`SELECT o.ownership_json AS json, o.ownership_hash AS hash
        FROM market_retention_ownership o
        JOIN market_retention_derivation_ownership d ON d.ownership_id = o.ownership_id
        WHERE d.derived_id = ? ORDER BY o.ownership_id`)
      .all(derivedId) as JsonRow[];
    return rows.map((row) =>
      this.#withDerived(
        parseRecord<RetentionOwnership>(
          row,
          "peas/market-acquisition-retention-ownership-record/v1",
        ),
      ),
    );
  }

  recordStopAndDenials(stop: RetentionStopEvent, derivedIds: readonly string[]): void {
    this.#database
      .transaction(() => {
        const json = canonicalJson(stop as unknown as JsonValue);
        const hash = canonicalHash(
          "peas/market-acquisition-retention-stop-record/v1",
          stop as unknown as JsonValue,
        );
        this.#database
          .prepare(`INSERT OR IGNORE INTO market_retention_stop_events (
            stop_event_id, policy_id, provider_lane, provider_id, effective_at_ms, deadline_ms,
            reason, stop_json, stop_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            stop.stopEventId,
            stop.policyId,
            stop.providerLane,
            stop.providerId,
            stop.effectiveAtMs,
            stop.deadlineMs,
            stop.reason,
            json,
            hash,
          );
        const row = this.#database
          .prepare(
            "SELECT stop_json AS json, stop_hash AS hash FROM market_retention_stop_events WHERE stop_event_id = ?",
          )
          .get(stop.stopEventId) as JsonRow | undefined;
        if (row === undefined) throw new Error("Retention stop insert failed");
        sameRecord(
          "Stop",
          parseRecord<RetentionStopEvent>(row, "peas/market-acquisition-retention-stop-record/v1"),
          stop,
        );
        this.#database
          .prepare(`INSERT OR IGNORE INTO market_retention_provider_denials
            (stop_event_id, provider_lane, provider_id, effective_at_ms) VALUES (?, ?, ?, ?)`)
          .run(stop.stopEventId, stop.providerLane, stop.providerId, stop.effectiveAtMs);
        const providerDenial = this.#database
          .prepare(`SELECT stop_event_id FROM market_retention_provider_denials
            WHERE provider_lane = ? AND provider_id = ?`)
          .get(stop.providerLane, stop.providerId) as { stop_event_id: string } | undefined;
        if (providerDenial?.stop_event_id !== stop.stopEventId)
          throw new Error("Provider already has a conflicting retention stop");
        const insertDigest = this.#database.prepare(
          "INSERT OR IGNORE INTO market_retention_digest_denials (stop_event_id, artifact_digest) VALUES (?, ?)",
        );
        for (const ownership of this.listOwnership(stop.providerLane, stop.providerId))
          insertDigest.run(stop.stopEventId, ownership.artifactDigest);
        const insertDerived = this.#database.prepare(
          "INSERT OR IGNORE INTO market_retention_derivation_denials (stop_event_id, derived_id) VALUES (?, ?)",
        );
        for (const derivedId of derivedIds) insertDerived.run(stop.stopEventId, derivedId);
      })
      .immediate();
  }

  providerUseDenied(lane: RetentionProviderLane, providerId: string): boolean {
    return (
      this.#database
        .prepare(
          "SELECT 1 present FROM market_retention_provider_denials WHERE provider_lane = ? AND provider_id = ?",
        )
        .get(lane, providerId) !== undefined
    );
  }

  reconciliationUseDenied(trustedNowMs: number): boolean {
    return (
      this.#database
        .prepare(`SELECT 1 AS denied FROM market_retention_provider_denials
          UNION ALL SELECT 1 AS denied FROM market_retention_ownership
          WHERE expires_at_ms <= ? LIMIT 1`)
        .get(trustedNowMs) !== undefined
    );
  }
  digestUseDenied(digest: string): boolean {
    return (
      this.#database
        .prepare(`SELECT 1 present FROM market_retention_digest_denials WHERE artifact_digest = ?
          UNION ALL SELECT 1 present FROM market_retention_artifact_tombstones
          WHERE artifact_digest = ? LIMIT 1`)
        .get(digest, digest) !== undefined
    );
  }
  derivedUseDenied(derivedId: string): boolean {
    return (
      this.#database
        .prepare("SELECT 1 present FROM market_retention_derivation_denials WHERE derived_id = ?")
        .get(derivedId) !== undefined
    );
  }

  recordPlan(value: RetentionErasurePlan): void {
    const json = canonicalJson(value as unknown as JsonValue);
    this.#database
      .prepare(`INSERT OR IGNORE INTO market_retention_erasure_plans (
        plan_id, plan_hash, policy_id, provider_lane, provider_id, stop_event_id, effective_at_ms,
        deadline_ms, predecessor_receipt_id, plan_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        value.planId,
        value.planHash,
        value.policyId,
        value.providerLane,
        value.providerId,
        value.stopEventId,
        value.effectiveAtMs,
        value.deadlineMs,
        value.predecessorReceiptId,
        json,
      );
    const existing = this.getPlan(value.planId);
    if (existing === undefined) throw new Error("Retention plan insert failed");
    sameRecord("Plan", existing, value);
  }
  getPlan(planId: string): RetentionErasurePlan | undefined {
    const row = this.#database
      .prepare("SELECT plan_json, plan_hash FROM market_retention_erasure_plans WHERE plan_id = ?")
      .get(planId) as { plan_json: string; plan_hash: string } | undefined;
    if (row === undefined) return undefined;
    const value = JSON.parse(row.plan_json) as RetentionErasurePlan;
    if (
      canonicalJson(value as unknown as JsonValue) !== row.plan_json ||
      value.planHash !== row.plan_hash
    )
      throw new Error("Retention plan evidence mismatch");
    return value;
  }

  recordAttempt(value: RetentionErasureAttempt): void {
    const json = canonicalJson(value as unknown as JsonValue);
    const hash = canonicalHash(
      "peas/market-acquisition-retention-attempt-record/v1",
      value as unknown as JsonValue,
    );
    this.#database
      .prepare(`INSERT OR IGNORE INTO market_retention_erasure_attempts (
        attempt_id, plan_id, artifact_digest, attempt_ordinal, started_at_ms, outcome,
        attempt_json, attempt_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        value.attemptId,
        value.planId,
        value.artifactDigest,
        value.attemptOrdinal,
        value.startedAtMs,
        value.outcome,
        json,
        hash,
      );
    const existing = this.#database
      .prepare(
        "SELECT attempt_json AS json, attempt_hash AS hash FROM market_retention_erasure_attempts WHERE attempt_id = ?",
      )
      .get(value.attemptId) as JsonRow | undefined;
    if (existing === undefined) throw new Error("Retention attempt insert failed");
    sameRecord(
      "Attempt",
      parseRecord<RetentionErasureAttempt>(
        existing,
        "peas/market-acquisition-retention-attempt-record/v1",
      ),
      value,
    );
  }
  attemptsFor(planId: string, digest: string): readonly RetentionErasureAttempt[] {
    const rows = this.#database
      .prepare(`SELECT attempt_json AS json, attempt_hash AS hash
        FROM market_retention_erasure_attempts WHERE plan_id = ? AND artifact_digest = ?
        ORDER BY attempt_ordinal, outcome`)
      .all(planId, digest) as JsonRow[];
    return rows.map((row) =>
      parseRecord<RetentionErasureAttempt>(
        row,
        "peas/market-acquisition-retention-attempt-record/v1",
      ),
    );
  }

  recordTombstone(value: RetentionTombstone): void {
    const json = canonicalJson(value as unknown as JsonValue);
    const hash = canonicalHash(
      "peas/market-acquisition-retention-tombstone-record/v1",
      value as unknown as JsonValue,
    );
    this.#database
      .prepare(`INSERT OR IGNORE INTO market_retention_artifact_tombstones (
        tombstone_id, plan_id, artifact_digest, recorded_at_ms, tombstone_json, tombstone_hash
      ) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(value.tombstoneId, value.planId, value.artifactDigest, value.recordedAtMs, json, hash);
    const existing = this.#database
      .prepare(`SELECT tombstone_json AS json, tombstone_hash AS hash
        FROM market_retention_artifact_tombstones WHERE artifact_digest = ?`)
      .get(value.artifactDigest) as JsonRow | undefined;
    if (existing === undefined) throw new Error("Retention tombstone insert failed");
    sameRecord(
      "Tombstone",
      parseRecord<RetentionTombstone>(
        existing,
        "peas/market-acquisition-retention-tombstone-record/v1",
      ),
      value,
    );
  }
  hasTombstone(digest: string): boolean {
    return (
      this.#database
        .prepare(
          "SELECT 1 present FROM market_retention_artifact_tombstones WHERE artifact_digest = ?",
        )
        .get(digest) !== undefined
    );
  }

  recordReceipt(value: RetentionReceipt): void {
    const json = canonicalJson(value as unknown as JsonValue);
    const hash = canonicalHash(
      "peas/market-acquisition-retention-receipt-record/v1",
      value as unknown as JsonValue,
    );
    this.#database
      .prepare(`INSERT OR IGNORE INTO market_retention_erasure_receipts (
        receipt_id, plan_id, plan_hash, prior_size_bytes, attempt_count, outcome, completed_at_ms,
        receipt_json, receipt_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        value.receiptId,
        value.planId,
        value.planHash,
        value.priorSizeBytes,
        value.attemptCount,
        value.outcome,
        value.completedAtMs,
        json,
        hash,
      );
    const existing = this.getReceiptForPlan(value.planId);
    if (existing === undefined) throw new Error("Retention receipt insert failed");
    sameRecord("Receipt", existing, value);
  }
  getReceiptForPlan(planId: string): RetentionReceipt | undefined {
    const row = this.#database
      .prepare(`SELECT receipt_json AS json, receipt_hash AS hash
        FROM market_retention_erasure_receipts WHERE plan_id = ?`)
      .get(planId) as JsonRow | undefined;
    return row === undefined
      ? undefined
      : parseRecord<RetentionReceipt>(row, "peas/market-acquisition-retention-receipt-record/v1");
  }

  recordCheckpoint(value: RetentionCheckpoint): void {
    const json = canonicalJson(value as unknown as JsonValue);
    const hash = canonicalHash(
      "peas/market-acquisition-retention-checkpoint-record/v1",
      value as unknown as JsonValue,
    );
    this.#database
      .prepare(`INSERT OR IGNORE INTO market_retention_checkpoints (
        checkpoint_id, plan_id, receipt_id, sequence, completed_at_ms, checkpoint_json,
        checkpoint_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        value.checkpointId,
        value.planId,
        value.receiptId,
        value.sequence,
        value.completedAtMs,
        json,
        hash,
      );
    const existing = this.getCheckpoint(value.planId);
    if (existing === undefined) throw new Error("Retention checkpoint insert failed");
    sameRecord("Checkpoint", existing, value);
  }
  getCheckpoint(planId: string): RetentionCheckpoint | undefined {
    const row = this.#database
      .prepare(`SELECT checkpoint_json AS json, checkpoint_hash AS hash
        FROM market_retention_checkpoints WHERE plan_id = ?`)
      .get(planId) as JsonRow | undefined;
    return row === undefined
      ? undefined
      : parseRecord<RetentionCheckpoint>(
          row,
          "peas/market-acquisition-retention-checkpoint-record/v1",
        );
  }

  #registerPolicy(policy: PrivateArtifactPolicy): void {
    const json = canonicalJson(policy as unknown as JsonValue);
    const hash = canonicalHash(
      "peas/market-acquisition-retention-policy-record/v1",
      policy as unknown as JsonValue,
    );
    this.#database
      .prepare(`INSERT OR IGNORE INTO market_retention_policies (
        policy_id, provider_lane, maximum_retention_ms, stop_grace_ms, enabled, policy_json,
        policy_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        policy.policyId,
        policy.providerLane,
        policy.maximumRetentionMs,
        policy.stopGraceMs,
        policy.enabled ? 1 : 0,
        json,
        hash,
      );
    const row = this.#database
      .prepare(
        "SELECT policy_json AS json, policy_hash AS hash FROM market_retention_policies WHERE policy_id = ?",
      )
      .get(policy.policyId) as JsonRow | undefined;
    if (row === undefined) throw new Error("Retention policy insert failed");
    sameRecord(
      "Policy",
      parseRecord<PrivateArtifactPolicy>(row, "peas/market-acquisition-retention-policy-record/v1"),
      policy,
    );
  }

  #ownership(id: string): RetentionOwnership | undefined {
    const row = this.#database
      .prepare(`SELECT ownership_json AS json, ownership_hash AS hash
        FROM market_retention_ownership WHERE ownership_id = ?`)
      .get(id) as JsonRow | undefined;
    return row === undefined
      ? undefined
      : parseRecord<RetentionOwnership>(
          row,
          "peas/market-acquisition-retention-ownership-record/v1",
        );
  }

  #withDerived(value: RetentionOwnership): RetentionOwnership {
    const derivedIds = (
      this.#database
        .prepare(
          "SELECT derived_id FROM market_retention_derivation_ownership WHERE ownership_id = ? ORDER BY derived_id",
        )
        .all(value.ownershipId) as Array<{ derived_id: string }>
    ).map((row) => row.derived_id);
    return { ...value, derivedIds };
  }
}

export function createSqliteArtifactRetentionJournal(
  database: SqliteDatabase,
): SqliteArtifactRetentionJournal {
  assertOwnedSqliteDatabase(database);
  const journal = new SqliteArtifactRetentionJournal(database);
  ownedSqliteRetentionJournals.add(journal);
  Object.freeze(journal);
  return journal;
}

export function isOwnedSqliteArtifactRetentionJournal(value: object): boolean {
  return (
    ownedSqliteRetentionJournals.has(value) &&
    Object.getPrototypeOf(value) === SqliteArtifactRetentionJournal.prototype &&
    Object.isFrozen(value) &&
    Reflect.ownKeys(value).length === 0
  );
}
