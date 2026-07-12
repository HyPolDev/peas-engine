import { randomUUID } from "node:crypto";

import type { SqliteDatabase } from "../sqlite/database.js";
import type {
  ArtifactMetadata,
  ArtifactObservation,
  ArtifactPage,
  IntegrityIncident,
  ReconciliationReport,
  RetrievalAttempt,
  RetrievalAttemptOutcome,
  SafeHttpResponseMetadata,
  StoreArtifactResult,
} from "../../artifacts/artifact-store.js";
import { ArtifactVaultError } from "../../artifacts/errors.js";
import {
  deriveReconciliationCallKey,
  deriveReconciliationCursor,
  deriveReconciliationRunId,
  deriveInstallIntentId,
  deriveInstallTransitionId,
  deriveIncidentId,
  deriveQuarantineName,
  deriveReconciliationActionKey,
  deriveReconciliationWorkKey,
} from "../../artifacts/identity.js";
import { canonicalHash } from "../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../core/json.js";
import { assertPersistedRetrievalAttempt } from "../../artifacts/validation.js";

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

export type InstallIntent = Readonly<{
  intentId: string;
  attemptId: string;
  stagingId: string;
  digest: string;
  sizeBytes: number;
  disposition: "new-content" | "preexisting-verified";
  createdWriterGeneration: number;
  createdAtMs: number;
  artifact: ArtifactMetadata;
  response: SafeHttpResponseMetadata;
  observation: ArtifactObservation;
}>;

export type ReconciliationActionKind =
  | "quarantine"
  | "remove-snapshot"
  | "expire-attempt"
  | "adopt-orphan"
  | "record-missing-content"
  | "clean-stage"
  | "abort-install";

export type ReconciliationActionPlan = Readonly<{
  actionKey: string;
  runId: string;
  workKey: string;
  actionKind: ReconciliationActionKind;
  sourceRelativePath: string | null;
  sourceIdentity: JsonValue | null;
  expectedDigest: string | null;
  expectedSizeBytes: number | null;
  incident: IntegrityIncident | null;
  quarantineName: string | null;
  plannedPhase: ReconciliationPhase;
  plannedShard: number;
  plannedAfterKey: string;
  recordedAtMs: number;
  payload: JsonValue | null;
}>;

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

export type ReconciliationPhase =
  | "attempts"
  | "outcomes"
  | "blobs"
  | "observations"
  | "incidents"
  | "install-intents"
  | "snapshots"
  | "staging"
  | "open-attempts"
  | "content"
  | "missing-content";

export type PersistedReconciliationState = Readonly<{
  generation: number;
  phase: ReconciliationPhase;
  shard: number;
  afterKey: string;
  cursorToken: string;
}>;

export type DurableReconciliationState = PersistedReconciliationState &
  Readonly<{
    runId: string;
    writerGeneration: number;
    runNonce: string;
    status: "active" | "terminal";
    pendingActionKey: string | null;
    activeCallKey: string | null;
    activeCallAcceptedToken: string | null;
    rowsVisited: number;
    itemsProcessed: number;
    bytesHashed: number;
    directoryEntriesRead: number;
  }>;

type ReconciliationStateRow = {
  run_id: string;
  writer_generation: bigint;
  generation: bigint;
  cursor_epoch: bigint;
  phase: ReconciliationPhase;
  shard: bigint;
  after_key: string;
  cursor_token: string;
  run_nonce: string;
  status: "active" | "terminal";
  pending_action_key: string | null;
  active_call_key: string | null;
  active_call_accepted_token: string | null;
  rows_visited: bigint;
  items_processed: bigint;
  bytes_hashed: bigint;
  directory_entries_read: bigint;
  state_json: string;
  state_hash: string;
};

export type ReconciliationOpenResult =
  | Readonly<{ kind: "state"; state: DurableReconciliationState }>
  | Readonly<{ kind: "receipt"; report: ReconciliationReport }>;

export class SqliteArtifactRepository {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  databasePath(): string {
    return this.#database.name;
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

  loadReconciliationState(
    expectedCursor: string | null,
    fence: WriterFence,
  ): DurableReconciliationState {
    const opened = this.openReconciliationCall(expectedCursor, false, null, fence);
    if (opened.kind === "receipt")
      throw new ArtifactVaultError(
        "reconciliation-cursor-invalid",
        "Reconciliation cursor has already produced a receipt",
      );
    return opened.state;
  }

  openReconciliationCall(
    expectedCursor: string | null,
    startNew: boolean,
    completedRunId: string | null,
    fence: WriterFence,
  ): ReconciliationOpenResult {
    return this.#database
      .transaction(() => {
        this.assertWriter(fence);
        const row = this.#database
          .prepare("SELECT * FROM artifact_reconciliation_state WHERE singleton = 1")
          .get() as ReconciliationStateRow | undefined;
        if (row === undefined) {
          if (expectedCursor !== null || startNew)
            throw new ArtifactVaultError(
              "reconciliation-cursor-invalid",
              "Reconciliation cursor is stale",
            );
          const runNonce = randomUUID();
          const runId = deriveReconciliationRunId({ runNonce });
          const state = this.#insertReconciliationState({
            runId,
            writerGeneration: fence.generation,
            generation: 1,
            phase: "attempts",
            shard: 0,
            afterKey: "",
            runNonce,
            status: "active",
            pendingActionKey: null,
            activeCallKey: null,
            activeCallAcceptedToken: null,
            rowsVisited: 0,
            itemsProcessed: 0,
            bytesHashed: 0,
            directoryEntriesRead: 0,
          });
          return { kind: "state", state: this.#beginCall(state, null) } as const;
        }
        let state = this.#parseReconciliationState(row);

        if (startNew) {
          if (
            state.status !== "terminal" ||
            completedRunId === null ||
            completedRunId !== state.runId ||
            expectedCursor !== null
          )
            throw new ArtifactVaultError(
              "reconciliation-recovery-required",
              "A new reconciliation run must reference the completed run",
            );
          this.#database
            .prepare("DELETE FROM artifact_reconciliation_state WHERE singleton = 1")
            .run();
          const runNonce = randomUUID();
          state = this.#insertReconciliationState({
            runId: deriveReconciliationRunId({ runNonce }),
            writerGeneration: fence.generation,
            generation: 1,
            phase: "attempts",
            shard: 0,
            afterKey: "",
            runNonce,
            status: "active",
            pendingActionKey: null,
            activeCallKey: null,
            activeCallAcceptedToken: null,
            rowsVisited: 0,
            itemsProcessed: 0,
            bytesHashed: 0,
            directoryEntriesRead: 0,
          });
          return { kind: "state", state: this.#beginCall(state, null) } as const;
        }

        if (expectedCursor !== null) {
          const receipt = this.#readReceiptByAcceptedToken(expectedCursor);
          if (receipt !== undefined) {
            if (receipt.writerGeneration !== fence.generation)
              throw new ArtifactVaultError(
                "reconciliation-cursor-invalid",
                "Reconciliation cursor belongs to a stale writer generation",
              );
            return { kind: "receipt", report: receipt.report } as const;
          }
        }

        if (state.status === "terminal") {
          if (expectedCursor !== null)
            throw new ArtifactVaultError(
              "reconciliation-cursor-invalid",
              "Reconciliation cursor is stale or invalid",
            );
          const terminal = this.#readTerminalReceipt(state.runId);
          if (terminal === undefined) throw new Error("Terminal reconciliation receipt is missing");
          return { kind: "receipt", report: terminal.report } as const;
        }

        if (state.writerGeneration !== fence.generation) {
          if (expectedCursor !== null)
            throw new ArtifactVaultError(
              "reconciliation-cursor-invalid",
              "Reconciliation cursor belongs to a stale writer generation",
            );
          state = this.#rotateReconciliationWriter(state, fence.generation);
          return { kind: "state", state: this.#beginCall(state, null) } as const;
        }

        if (expectedCursor === null)
          throw new ArtifactVaultError(
            "reconciliation-cursor-required",
            "The active reconciliation run requires its continuation cursor",
          );
        if (expectedCursor === state.activeCallAcceptedToken && state.activeCallKey !== null)
          return { kind: "state", state } as const;
        if (expectedCursor !== state.cursorToken)
          throw new ArtifactVaultError(
            "reconciliation-cursor-invalid",
            "Reconciliation cursor is stale or invalid",
          );
        return { kind: "state", state: this.#beginCall(state, expectedCursor) } as const;
      })
      .immediate();
  }

  advanceReconciliationState(
    current: PersistedReconciliationState,
    next: Readonly<{
      phase: ReconciliationPhase;
      shard: number;
      afterKey: string;
      rowsVisited?: number;
      itemsProcessed?: number;
      bytesHashed?: number;
      directoryEntriesRead?: number;
    }>,
    fence: WriterFence,
  ): DurableReconciliationState {
    return this.#database
      .transaction(() => {
        this.assertWriter(fence);
        const durable = current as DurableReconciliationState;
        if (durable.runId === undefined)
          throw new Error("Reconciliation cursor generation was lost");
        return this.#replaceReconciliationState(durable, {
          ...durable,
          generation: durable.generation + 1,
          phase: next.phase,
          shard: next.shard,
          afterKey: next.afterKey,
          rowsVisited: durable.rowsVisited + (next.rowsVisited ?? 0),
          itemsProcessed: durable.itemsProcessed + (next.itemsProcessed ?? 0),
          bytesHashed: durable.bytesHashed + (next.bytesHashed ?? 0),
          directoryEntriesRead: durable.directoryEntriesRead + (next.directoryEntriesRead ?? 0),
        });
      })
      .immediate();
  }

  completeReconciliation(current: DurableReconciliationState, fence: WriterFence): void {
    this.#database
      .transaction(() => {
        this.assertWriter(fence);
        this.#replaceReconciliationState(current, { ...current, status: "terminal" });
      })
      .immediate();
  }

  commitReconciliationReceipt(
    current: DurableReconciliationState,
    report: ReconciliationReport,
    terminal: boolean,
    fence: WriterFence,
  ): void {
    this.#database
      .transaction(() => {
        this.assertWriter(fence);
        if (current.activeCallKey === null) throw new Error("Reconciliation call is not active");
        const json = canonicalJson(report as unknown as JsonValue);
        const hash = canonicalHash(
          "peas/artifact-reconciliation-report/v1",
          report as unknown as JsonValue,
        );
        this.#database
          .prepare(`INSERT INTO artifact_reconciliation_receipts (
            call_key, run_id, accepted_token, response_token, terminal, writer_generation,
            report_json, report_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            current.activeCallKey,
            current.runId,
            current.activeCallAcceptedToken,
            terminal ? null : current.cursorToken,
            terminal ? 1 : 0,
            fence.generation,
            json,
            hash,
          );
        this.#replaceReconciliationState(current, {
          ...current,
          status: terminal ? "terminal" : "active",
          activeCallKey: null,
          activeCallAcceptedToken: null,
        });
      })
      .immediate();
  }

  planReconciliationAction(
    current: DurableReconciliationState,
    input: Readonly<{
      actionKind: ReconciliationActionKind;
      sourceRelativePath: string | null;
      sourceIdentity: JsonValue | null;
      expectedDigest: string | null;
      expectedSizeBytes: number | null;
      incident: Readonly<{
        kind: IntegrityIncident["kind"];
        stagingId: string | null;
        claimedDigest: string | null;
        expectedSizeBytes: number | null;
        actualSizeBytes: number | null;
        detailHash: string | null;
        facts: JsonValue;
      }> | null;
      identity: JsonValue;
      payload: JsonValue | null;
      recordedAtMs: number;
    }>,
    fence: WriterFence,
  ): Readonly<{ state: DurableReconciliationState; plan: ReconciliationActionPlan }> {
    return this.#database
      .transaction(() => {
        this.assertWriter(fence);
        const workKey = deriveReconciliationWorkKey({
          runId: current.runId,
          phase: current.phase,
          shard: current.shard,
          afterKey: current.afterKey,
          actionKind: input.actionKind,
          sourceRelativePath: input.sourceRelativePath,
        });
        const actionKey = deriveReconciliationActionKey({
          workKey,
          actionKind: input.actionKind,
          identity: input.identity,
        });
        if (current.pendingActionKey !== null && current.pendingActionKey !== actionKey)
          throw new Error("Reconciliation head has a conflicting pending action");
        const existing = this.#readReconciliationActionPlan(actionKey);
        if (existing !== undefined) {
          relationalMismatch("Reconciliation action plan replay", [
            [existing.runId, current.runId],
            [existing.workKey, workKey],
            [existing.actionKind, input.actionKind],
            [existing.sourceRelativePath, input.sourceRelativePath],
            [existing.expectedDigest, input.expectedDigest],
            [existing.expectedSizeBytes, input.expectedSizeBytes],
          ]);
          return { state: current, plan: existing };
        }
        const incidentId =
          input.incident === null
            ? null
            : deriveIncidentId({
                actionKey,
                kind: input.incident.kind,
                facts: input.incident.facts,
              });
        const incident: IntegrityIncident | null =
          input.incident === null
            ? null
            : {
                incidentId: incidentId as string,
                actionKey,
                kind: input.incident.kind,
                recordedAtMs: input.recordedAtMs,
                stagingId: input.incident.stagingId,
                claimedDigest: input.incident.claimedDigest,
                expectedSizeBytes: input.incident.expectedSizeBytes,
                actualSizeBytes: input.incident.actualSizeBytes,
                detailHash: input.incident.detailHash,
              };
        const quarantineName =
          input.actionKind === "quarantine" && incidentId !== null
            ? deriveQuarantineName(actionKey, incidentId)
            : null;
        const plan: ReconciliationActionPlan = {
          actionKey,
          runId: current.runId,
          workKey,
          actionKind: input.actionKind,
          sourceRelativePath: input.sourceRelativePath,
          sourceIdentity: input.sourceIdentity,
          expectedDigest: input.expectedDigest,
          expectedSizeBytes: input.expectedSizeBytes,
          incident,
          quarantineName,
          plannedPhase: current.phase,
          plannedShard: current.shard,
          plannedAfterKey: current.afterKey,
          recordedAtMs: input.recordedAtMs,
          payload: input.payload,
        };
        const json = canonicalJson(plan as unknown as JsonValue);
        this.#database
          .prepare(`INSERT INTO artifact_reconciliation_action_plans (
            action_key, run_id, work_key, action_kind, source_relative_path,
            source_identity_json, expected_digest, expected_size_bytes, incident_id,
            quarantine_name, planned_phase, planned_shard, planned_after_key,
            recorded_at_ms, plan_json, plan_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            plan.actionKey,
            plan.runId,
            plan.workKey,
            plan.actionKind,
            plan.sourceRelativePath,
            plan.sourceIdentity === null ? null : canonicalJson(plan.sourceIdentity),
            plan.expectedDigest,
            plan.expectedSizeBytes,
            plan.incident?.incidentId ?? null,
            plan.quarantineName,
            plan.plannedPhase,
            plan.plannedShard,
            plan.plannedAfterKey,
            plan.recordedAtMs,
            json,
            canonicalHash(
              "peas/artifact-reconciliation-action-plan/v1",
              plan as unknown as JsonValue,
            ),
          );
        if (incident !== null) this.#insertIncident(incident);
        const state = this.#replaceReconciliationState(current, {
          ...current,
          generation: current.generation + 1,
          pendingActionKey: actionKey,
        });
        return { state, plan };
      })
      .immediate();
  }

  applyReconciliationAction(
    current: DurableReconciliationState,
    actionKey: string,
    next: Readonly<{
      phase: ReconciliationPhase;
      shard: number;
      afterKey: string;
      rowsVisited?: number;
      itemsProcessed?: number;
      bytesHashed?: number;
      directoryEntriesRead?: number;
    }>,
    result: Readonly<{
      resultingIdentity: JsonValue | null;
      resultingDigest: string | null;
      resultingSizeBytes: number | null;
    }>,
    fence: WriterFence,
  ): DurableReconciliationState {
    return this.#database
      .transaction(() => {
        this.assertWriter(fence);
        if (current.pendingActionKey !== actionKey)
          throw new Error("Reconciliation action is not pending at the durable head");
        const plan = this.#readReconciliationActionPlan(actionKey);
        if (plan === undefined) throw new Error("Reconciliation action plan is missing");
        if (plan.actionKind === "adopt-orphan") {
          const payload = plan.payload as unknown as Record<string, unknown>;
          const artifact = (
            "artifact" in payload ? payload["artifact"] : payload
          ) as ArtifactMetadata;
          const existing = this.stat(artifact.digest);
          if (existing === undefined) {
            this.#database
              .prepare(`INSERT INTO artifact_blobs (
                digest, algorithm, size_bytes, committed_at_ms, provenance, blob_json, blob_hash
              ) VALUES (?, 'sha256', ?, ?, 'recovered-orphan', ?, ?)`)
              .run(
                artifact.digest,
                artifact.sizeBytes,
                artifact.committedAtMs,
                canonicalJson(artifact as unknown as JsonValue),
                canonicalHash("peas/artifact-blob/v1", artifact as unknown as JsonValue),
              );
          } else
            relationalMismatch("Recovered orphan replay", [
              [existing.digest, artifact.digest],
              [existing.sizeBytes, artifact.sizeBytes],
              [existing.provenance, artifact.provenance],
            ]);
        } else if (plan.actionKind === "expire-attempt") {
          const payload = plan.payload as unknown as Record<string, unknown>;
          const outcome = (
            "outcome" in payload ? payload["outcome"] : payload
          ) as RetrievalAttemptOutcome;
          const existing = this.#getOutcome(outcome.attemptId);
          if (existing === undefined) this.#insertOutcome(outcome);
          else
            relationalMismatch("Expired attempt replay", [
              [existing.outcome, outcome.outcome],
              [existing.reasonCode, outcome.reasonCode],
              [existing.detailHash, outcome.detailHash],
            ]);
        }
        if (
          plan.actionKind === "quarantine" &&
          plan.payload !== null &&
          typeof plan.payload === "object" &&
          !Array.isArray(plan.payload) &&
          "outcome" in plan.payload
        ) {
          const outcome = plan.payload["outcome"] as unknown as RetrievalAttemptOutcome;
          const existing = this.#getOutcome(outcome.attemptId);
          if (existing === undefined) this.#insertOutcome(outcome);
          else
            relationalMismatch("Quarantine outcome replay", [
              [existing.outcome, outcome.outcome],
              [existing.reasonCode, outcome.reasonCode],
              [existing.detailHash, outcome.detailHash],
            ]);
        }
        const application = {
          actionKey,
          writerGeneration: fence.generation,
          appliedAtMs: fence.nowMs(),
          resultingIdentity: result.resultingIdentity,
          resultingDigest: result.resultingDigest,
          resultingSizeBytes: result.resultingSizeBytes,
        };
        const applicationJson = canonicalJson(application as unknown as JsonValue);
        this.#database
          .prepare(`INSERT INTO artifact_reconciliation_action_applications (
            action_key, writer_generation, applied_at_ms, resulting_identity_json,
            resulting_digest, resulting_size_bytes, application_json, application_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            actionKey,
            fence.generation,
            application.appliedAtMs,
            result.resultingIdentity === null ? null : canonicalJson(result.resultingIdentity),
            result.resultingDigest,
            result.resultingSizeBytes,
            applicationJson,
            canonicalHash(
              "peas/artifact-reconciliation-action-application/v1",
              application as unknown as JsonValue,
            ),
          );
        if (plan.actionKind === "quarantine") {
          if (
            plan.quarantineName === null ||
            result.resultingIdentity === null ||
            result.resultingDigest === null ||
            result.resultingSizeBytes === null
          )
            throw new Error("Quarantine action receipt is incomplete");
          const receipt = {
            actionKey,
            targetName: plan.quarantineName,
            targetIdentity: result.resultingIdentity,
            digest: result.resultingDigest,
            sizeBytes: result.resultingSizeBytes,
          };
          this.#database
            .prepare(`INSERT INTO artifact_quarantine_receipts (
              action_key, target_name, target_identity_json, digest, size_bytes,
              receipt_json, receipt_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(
              actionKey,
              plan.quarantineName,
              canonicalJson(result.resultingIdentity),
              result.resultingDigest,
              result.resultingSizeBytes,
              canonicalJson(receipt as unknown as JsonValue),
              canonicalHash("peas/artifact-quarantine-receipt/v1", receipt as unknown as JsonValue),
            );
        }
        return this.#replaceReconciliationState(current, {
          ...current,
          generation: current.generation + 1,
          phase: next.phase,
          shard: next.shard,
          afterKey: next.afterKey,
          pendingActionKey: null,
          rowsVisited: current.rowsVisited + (next.rowsVisited ?? 0),
          itemsProcessed: current.itemsProcessed + (next.itemsProcessed ?? 0),
          bytesHashed: current.bytesHashed + (next.bytesHashed ?? 0),
          directoryEntriesRead: current.directoryEntriesRead + (next.directoryEntriesRead ?? 0),
        });
      })
      .immediate();
  }

  readPendingReconciliationAction(
    state: DurableReconciliationState,
  ): ReconciliationActionPlan | undefined {
    return state.pendingActionKey === null
      ? undefined
      : this.#readReconciliationActionPlan(state.pendingActionKey);
  }

  verifyEvidencePage(
    phase: "attempts" | "outcomes" | "blobs" | "observations" | "incidents",
    afterKey: string,
    limit: number,
  ): Readonly<{ visited: number; lastKey: string; done: boolean }> {
    if (phase === "attempts") {
      const rows = this.#database
        .prepare(`SELECT attempt_id FROM artifact_retrieval_attempts
          WHERE attempt_id > ? ORDER BY attempt_id LIMIT ?`)
        .all(afterKey, limit) as Array<{ attempt_id: string }>;
      for (const row of rows.slice(0, limit)) this.getAttempt(row.attempt_id);
      return this.#pageResult(
        rows.map((row) => row.attempt_id),
        afterKey,
        limit,
      );
    }
    if (phase === "outcomes") {
      const rows = this.#database
        .prepare(`SELECT sequence, attempt_id FROM artifact_retrieval_outcomes
          WHERE sequence > ? ORDER BY sequence LIMIT ?`)
        .all(BigInt(afterKey || "0"), limit) as Array<{ sequence: bigint; attempt_id: string }>;
      for (const row of rows.slice(0, limit)) this.#getOutcome(row.attempt_id);
      return this.#pageResult(
        rows.map((row) => row.sequence.toString()),
        afterKey,
        limit,
      );
    }
    if (phase === "blobs") {
      const rows = this.#database
        .prepare(`SELECT digest FROM artifact_blobs WHERE digest > ? ORDER BY digest LIMIT ?`)
        .all(afterKey, limit) as Array<{ digest: string }>;
      for (const row of rows.slice(0, limit)) this.stat(row.digest);
      return this.#pageResult(
        rows.map((row) => row.digest),
        afterKey,
        limit,
      );
    }
    if (phase === "observations") {
      const rows = this.#database
        .prepare(`SELECT * FROM artifact_observations WHERE sequence > ? ORDER BY sequence LIMIT ?`)
        .all(BigInt(afterKey || "0"), limit) as ObservationRow[];
      for (const row of rows.slice(0, limit)) this.#parseObservation(row);
      return this.#pageResult(
        rows.map((row) => row.sequence.toString()),
        afterKey,
        limit,
      );
    }
    const rows = this.#database
      .prepare(
        `SELECT * FROM artifact_integrity_incidents WHERE sequence > ? ORDER BY sequence LIMIT ?`,
      )
      .all(BigInt(afterKey || "0"), limit) as Array<Record<string, unknown>>;
    for (const row of rows.slice(0, limit)) this.#parseIncident(row);
    return this.#pageResult(
      rows.map((row) => (row["sequence"] as bigint).toString()),
      afterKey,
      limit,
    );
  }

  getAttemptByStagingId(stagingId: string): RetrievalAttempt | undefined {
    const row = this.#database
      .prepare("SELECT attempt_id FROM artifact_retrieval_attempts WHERE staging_id = ?")
      .get(stagingId) as { attempt_id: string } | undefined;
    return row === undefined ? undefined : this.getAttempt(row.attempt_id);
  }

  readOpenAttemptsPage(afterAttemptId: string, limit: number): readonly RetrievalAttempt[] {
    const rows = this.#database
      .prepare(`SELECT a.attempt_id FROM artifact_retrieval_attempts a
        LEFT JOIN artifact_retrieval_outcomes o ON o.attempt_id = a.attempt_id
        WHERE o.attempt_id IS NULL AND a.attempt_id > ?
        ORDER BY a.attempt_id LIMIT ?`)
      .all(afterAttemptId, limit) as Array<{ attempt_id: string }>;
    return rows.map((row) => this.getAttempt(row.attempt_id) as RetrievalAttempt);
  }

  readArtifactsPage(afterDigest: string, limit: number): readonly ArtifactMetadata[] {
    const rows = this.#database
      .prepare("SELECT digest FROM artifact_blobs WHERE digest > ? ORDER BY digest LIMIT ?")
      .all(afterDigest, limit) as Array<{ digest: string }>;
    return rows.map((row) => this.stat(row.digest) as ArtifactMetadata);
  }

  recordAttempt(attempt: RetrievalAttempt, fence: WriterFence): void {
    assertPersistedRetrievalAttempt(attempt);
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

  getOutcome(attemptId: string): RetrievalAttemptOutcome | undefined {
    return this.#getOutcome(attemptId);
  }

  prepareInstallIntent(
    input: Readonly<{
      attempt: RetrievalAttempt;
      artifact: ArtifactMetadata;
      observation: ArtifactObservation;
      response: SafeHttpResponseMetadata;
      disposition: "new-content" | "preexisting-verified";
      createdAtMs: number;
    }>,
    fence: WriterFence,
  ): InstallIntent {
    return this.#database
      .transaction(() => {
        this.assertWriter(fence);
        const persistedAttempt = this.getAttempt(input.attempt.attemptId);
        if (persistedAttempt === undefined) throw new Error("Install intent attempt is missing");
        relationalMismatch("Install intent attempt", [
          [input.attempt.stagingId, persistedAttempt.stagingId],
          [input.observation.attemptId, persistedAttempt.attemptId],
          [input.observation.artifactDigest, input.artifact.digest],
          [input.artifact.sizeBytes, input.artifact.sizeBytes],
        ]);
        const identity = {
          attemptId: input.attempt.attemptId,
          stagingId: input.attempt.stagingId,
          digest: input.artifact.digest,
          sizeBytes: input.artifact.sizeBytes,
          disposition: input.disposition,
          observationId: input.observation.observationId,
          responseHash: canonicalHash(
            "peas/artifact-install-response/v1",
            input.response as unknown as JsonValue,
          ),
        };
        const intent: InstallIntent = {
          intentId: deriveInstallIntentId(identity),
          attemptId: input.attempt.attemptId,
          stagingId: input.attempt.stagingId,
          digest: input.artifact.digest,
          sizeBytes: input.artifact.sizeBytes,
          disposition: input.disposition,
          createdWriterGeneration: fence.generation,
          createdAtMs: input.createdAtMs,
          artifact: input.artifact,
          response: input.response,
          observation: input.observation,
        };
        const existing = this.#readInstallIntent(intent.intentId);
        if (existing !== undefined) {
          relationalMismatch("Artifact install intent replay", [
            [
              canonicalJson(identity as unknown as JsonValue),
              canonicalJson({
                attemptId: existing.attemptId,
                stagingId: existing.stagingId,
                digest: existing.digest,
                sizeBytes: existing.sizeBytes,
                disposition: existing.disposition,
                observationId: existing.observation.observationId,
                responseHash: canonicalHash(
                  "peas/artifact-install-response/v1",
                  existing.response as unknown as JsonValue,
                ),
              } as unknown as JsonValue),
            ],
          ]);
          return existing;
        }
        const observationValue = { ...intent.observation } as Record<string, unknown>;
        delete observationValue["observationHash"];
        const intentJson = canonicalJson(intent as unknown as JsonValue);
        this.#database
          .prepare(`INSERT INTO artifact_install_intents (
            intent_id, attempt_id, staging_id, digest, size_bytes, disposition,
            created_writer_generation, created_at_ms, artifact_json, artifact_hash,
            response_json, response_hash, observation_json, observation_hash,
            intent_json, intent_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            intent.intentId,
            intent.attemptId,
            intent.stagingId,
            intent.digest,
            intent.sizeBytes,
            intent.disposition,
            intent.createdWriterGeneration,
            intent.createdAtMs,
            canonicalJson(intent.artifact as unknown as JsonValue),
            canonicalHash("peas/artifact-blob/v1", intent.artifact as unknown as JsonValue),
            canonicalJson(intent.response as unknown as JsonValue),
            canonicalHash(
              "peas/artifact-install-response/v1",
              intent.response as unknown as JsonValue,
            ),
            canonicalJson(observationValue as unknown as JsonValue),
            intent.observation.observationHash,
            intentJson,
            canonicalHash("peas/artifact-install-intent-record/v1", intent as unknown as JsonValue),
          );
        return intent;
      })
      .immediate();
  }

  markIntentContentInstalled(intentId: string, fence: WriterFence): void {
    this.#database
      .transaction(() => {
        this.assertWriter(fence);
        if (this.#readInstallIntent(intentId) === undefined)
          throw new Error("Artifact install intent is missing");
        this.#insertInstallTransition(intentId, "content-installed", fence);
      })
      .immediate();
  }

  markIntentStageCleaned(intentId: string, fence: WriterFence): void {
    this.#database
      .transaction(() => {
        this.assertWriter(fence);
        if (this.#readInstallIntent(intentId) === undefined)
          throw new Error("Artifact install intent is missing");
        this.#insertInstallTransition(intentId, "stage-cleaned", fence);
      })
      .immediate();
  }

  commitIntentSuccess(intentId: string, fence: WriterFence): StoreArtifactResult {
    return this.#database
      .transaction(() => {
        this.assertWriter(fence);
        const intent = this.#readInstallIntent(intentId);
        if (intent === undefined) throw new Error("Artifact install intent is missing");
        if (this.#hasInstallTransition(intentId, "aborted"))
          throw new Error("Artifact install intent was aborted");
        const completed = this.getCompletedResult(intent.attemptId);
        if (completed !== undefined) {
          relationalMismatch("Artifact install intent committed result", [
            [completed.artifact.digest, intent.digest],
            [completed.artifact.sizeBytes, intent.sizeBytes],
            [completed.observation.observationId, intent.observation.observationId],
          ]);
          this.#insertInstallTransition(intentId, "evidence-committed", fence);
          return completed;
        }
        const disposition = this.#insertSuccessEvidence(
          intent.artifact,
          intent.observation,
          intent.response,
        );
        this.#insertInstallTransition(intentId, "evidence-committed", fence);
        return {
          artifact: this.stat(intent.digest) as ArtifactMetadata,
          observation: intent.observation,
          disposition,
        };
      })
      .immediate();
  }

  abortIntent(intentId: string, outcome: RetrievalAttemptOutcome, fence: WriterFence): void {
    this.#database
      .transaction(() => {
        this.assertWriter(fence);
        const intent = this.#readInstallIntent(intentId);
        if (intent === undefined) throw new Error("Artifact install intent is missing");
        if (this.#hasInstallTransition(intentId, "evidence-committed"))
          throw new Error("Committed artifact install intent cannot be aborted");
        relationalMismatch("Artifact install abort", [[outcome.attemptId, intent.attemptId]]);
        const existing = this.#getOutcome(outcome.attemptId);
        if (existing === undefined) this.#insertOutcome(outcome);
        else
          relationalMismatch("Artifact install abort outcome", [
            [outcome.outcome, existing.outcome],
            [outcome.reasonCode, existing.reasonCode],
            [outcome.detailHash, existing.detailHash],
          ]);
        this.#insertInstallTransition(intentId, "aborted", fence);
      })
      .immediate();
  }

  readPendingIntentPage(afterIntentId: string, limit: number): readonly InstallIntent[] {
    const rows = this.#database
      .prepare(`SELECT i.intent_id FROM artifact_install_intents i
        LEFT JOIN artifact_install_transitions cleaned
          ON cleaned.intent_id = i.intent_id AND cleaned.state = 'stage-cleaned'
        LEFT JOIN artifact_install_transitions aborted
          ON aborted.intent_id = i.intent_id AND aborted.state = 'aborted'
        WHERE cleaned.intent_id IS NULL AND aborted.intent_id IS NULL AND i.intent_id > ?
        ORDER BY i.intent_id LIMIT ?`)
      .all(afterIntentId, limit) as Array<{ intent_id: string }>;
    return rows.map((row) => this.#readInstallIntent(row.intent_id) as InstallIntent);
  }

  hasInstallTransition(intentId: string, state: string): boolean {
    return this.#hasInstallTransition(intentId, state);
  }

  finishAttempt(outcome: RetrievalAttemptOutcome, fence: WriterFence): void {
    this.#database
      .transaction(() => {
        this.assertWriter(fence);
        this.#assertPersistedOutcome(outcome);
        const existing = this.#getOutcome(outcome.attemptId);
        if (existing === undefined) this.#insertOutcome(outcome);
        else
          relationalMismatch("Artifact terminal outcome", [
            [outcome.outcome, existing.outcome],
            [outcome.reasonCode, existing.reasonCode],
            [outcome.detailHash, existing.detailHash],
          ]);
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

  #assertPersistedOutcome(outcome: RetrievalAttemptOutcome): void {
    if (!/^att1_[0-9a-f]{64}$/u.test(outcome.attemptId))
      throw new TypeError("Persisted attempt identity is invalid");
    if (this.getAttempt(outcome.attemptId) === undefined)
      throw new Error("Artifact outcome attempt is missing");
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
        const attempt = this.getAttempt(observation.attemptId);
        if (attempt === undefined) throw new Error("Artifact observation attempt is missing");
        relationalMismatch("Artifact observation attempt", [
          [observation.provider, attempt.provider],
          [observation.recordId, attempt.recordId],
          [observation.revisionId, attempt.revisionId],
          [observation.request.method, attempt.request.method],
          [observation.request.origin, attempt.request.origin],
          [observation.request.pathHash, attempt.request.pathHash],
          [observation.request.routeLabel, attempt.request.routeLabel],
          [observation.request.identityHash, attempt.request.identityHash],
        ]);
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
    const existingRow = this.#database
      .prepare("SELECT * FROM artifact_integrity_incidents WHERE incident_id = ?")
      .get(incident.incidentId) as Record<string, unknown> | undefined;
    if (existingRow !== undefined) {
      const existing = this.#parseIncident(existingRow);
      relationalMismatch("Artifact incident replay", [
        [incident.actionKey ?? null, existing.actionKey ?? null],
        [incident.kind, existing.kind],
        [incident.stagingId, existing.stagingId],
        [incident.claimedDigest, existing.claimedDigest],
        [incident.expectedSizeBytes, existing.expectedSizeBytes],
        [incident.actualSizeBytes, existing.actualSizeBytes],
        [incident.detailHash, existing.detailHash],
      ]);
      return;
    }
    const json = canonicalJson(incident as unknown as JsonValue);
    const hash = canonicalHash("peas/artifact-incident/v2", incident as unknown as JsonValue);
    this.#database
      .prepare(`INSERT INTO artifact_integrity_incidents (
      incident_id, action_key, kind, recorded_at_ms, staging_id, claimed_digest, expected_size_bytes,
      actual_size_bytes, detail_hash, incident_json, incident_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        incident.incidentId,
        incident.actionKey ?? null,
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
      .all() as Array<Record<string, unknown>>)
      this.#parseIncident(row);
    this.listArtifacts();
  }

  #insertReconciliationState(
    state: Omit<DurableReconciliationState, "cursorToken">,
  ): DurableReconciliationState {
    const cursorToken = this.#cursorFor(state);
    const value = { ...state, cursorToken };
    const json = canonicalJson(value as unknown as JsonValue);
    const hash = canonicalHash(
      "peas/artifact-reconciliation-state/v1",
      value as unknown as JsonValue,
    );
    this.#database
      .prepare(`INSERT INTO artifact_reconciliation_state (
      singleton, run_id, writer_generation, generation, cursor_epoch, phase, shard, after_key,
      pending_action_key, active_call_key, active_call_accepted_token, cursor_token, run_nonce,
      status, rows_visited, items_processed, bytes_hashed, directory_entries_read,
      state_json, state_hash
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        state.runId,
        state.writerGeneration,
        state.generation,
        state.generation,
        state.phase,
        state.shard,
        state.afterKey,
        state.pendingActionKey,
        state.activeCallKey,
        state.activeCallAcceptedToken,
        cursorToken,
        state.runNonce,
        state.status,
        state.rowsVisited,
        state.itemsProcessed,
        state.bytesHashed,
        state.directoryEntriesRead,
        json,
        hash,
      );
    return value;
  }

  #replaceReconciliationState(
    current: DurableReconciliationState,
    next: Omit<DurableReconciliationState, "cursorToken"> | DurableReconciliationState,
  ): DurableReconciliationState {
    const withoutCursor = { ...next } as DurableReconciliationState;
    const cursorToken = this.#cursorFor(withoutCursor);
    const value = { ...withoutCursor, cursorToken };
    const json = canonicalJson(value as unknown as JsonValue);
    const hash = canonicalHash(
      "peas/artifact-reconciliation-state/v1",
      value as unknown as JsonValue,
    );
    const result = this.#database
      .prepare(`UPDATE artifact_reconciliation_state SET
        run_id = ?, writer_generation = ?, generation = ?, cursor_epoch = ?, phase = ?,
        shard = ?, after_key = ?, pending_action_key = ?, active_call_key = ?,
        active_call_accepted_token = ?, cursor_token = ?, run_nonce = ?, status = ?,
        rows_visited = ?, items_processed = ?, bytes_hashed = ?, directory_entries_read = ?,
        state_json = ?, state_hash = ?
        WHERE singleton = 1 AND run_id = ? AND generation = ? AND writer_generation = ?
          AND cursor_token = ?`)
      .run(
        value.runId,
        value.writerGeneration,
        value.generation,
        value.generation,
        value.phase,
        value.shard,
        value.afterKey,
        value.pendingActionKey,
        value.activeCallKey,
        value.activeCallAcceptedToken,
        value.cursorToken,
        value.runNonce,
        value.status,
        value.rowsVisited,
        value.itemsProcessed,
        value.bytesHashed,
        value.directoryEntriesRead,
        json,
        hash,
        current.runId,
        current.generation,
        current.writerGeneration,
        current.cursorToken,
      );
    if (result.changes !== 1) throw new Error("Reconciliation cursor generation was lost");
    return value;
  }

  #cursorFor(state: Omit<DurableReconciliationState, "cursorToken">): string {
    return deriveReconciliationCursor({
      runId: state.runId,
      cursorEpoch: state.generation,
      writerGeneration: state.writerGeneration,
      phase: state.phase,
      shard: state.shard,
      afterKey: state.afterKey,
      pendingActionKey: state.pendingActionKey,
      runNonce: state.runNonce,
    });
  }

  #beginCall(
    state: DurableReconciliationState,
    acceptedToken: string | null,
  ): DurableReconciliationState {
    const activeCallKey = deriveReconciliationCallKey({
      runId: state.runId,
      acceptedToken,
      cursorEpoch: state.generation,
      writerGeneration: state.writerGeneration,
    });
    return this.#replaceReconciliationState(state, {
      ...state,
      activeCallKey,
      activeCallAcceptedToken: acceptedToken,
    });
  }

  #rotateReconciliationWriter(
    state: DurableReconciliationState,
    writerGeneration: number,
  ): DurableReconciliationState {
    return this.#replaceReconciliationState(state, {
      ...state,
      writerGeneration,
      generation: state.generation + 1,
      activeCallKey: null,
      activeCallAcceptedToken: null,
    });
  }

  #readReceiptByAcceptedToken(
    token: string,
  ): Readonly<{ report: ReconciliationReport; writerGeneration: number }> | undefined {
    const row = this.#database
      .prepare(`SELECT report_json, report_hash, writer_generation
        FROM artifact_reconciliation_receipts WHERE accepted_token = ?`)
      .get(token) as
      | { report_json: string; report_hash: string; writer_generation: bigint }
      | undefined;
    if (row === undefined) return undefined;
    return {
      report: parseCanonical<ReconciliationReport>(
        row.report_json,
        row.report_hash,
        "peas/artifact-reconciliation-report/v1",
      ),
      writerGeneration: safeNumber(row.writer_generation, "receipt writer generation"),
    };
  }

  #readTerminalReceipt(
    runId: string,
  ): Readonly<{ report: ReconciliationReport; writerGeneration: number }> | undefined {
    const row = this.#database
      .prepare(`SELECT report_json, report_hash, writer_generation
        FROM artifact_reconciliation_receipts WHERE run_id = ? AND terminal = 1
        ORDER BY rowid DESC LIMIT 1`)
      .get(runId) as
      | { report_json: string; report_hash: string; writer_generation: bigint }
      | undefined;
    if (row === undefined) return undefined;
    return {
      report: parseCanonical<ReconciliationReport>(
        row.report_json,
        row.report_hash,
        "peas/artifact-reconciliation-report/v1",
      ),
      writerGeneration: safeNumber(row.writer_generation, "receipt writer generation"),
    };
  }

  #parseReconciliationState(row: ReconciliationStateRow): DurableReconciliationState {
    const value = parseCanonical<DurableReconciliationState>(
      row.state_json,
      row.state_hash,
      "peas/artifact-reconciliation-state/v1",
    );
    relationalMismatch("Artifact reconciliation state", [
      [value.runId, row.run_id],
      [
        value.writerGeneration,
        safeNumber(row.writer_generation, "reconciliation writer generation"),
      ],
      [value.generation, safeNumber(row.generation, "reconciliation generation")],
      [value.generation, safeNumber(row.cursor_epoch, "reconciliation cursor epoch")],
      [value.phase, row.phase],
      [value.shard, safeNumber(row.shard, "reconciliation shard")],
      [value.afterKey, row.after_key],
      [value.cursorToken, row.cursor_token],
      [value.runNonce, row.run_nonce],
      [value.status, row.status],
      [value.pendingActionKey, row.pending_action_key],
      [value.activeCallKey, row.active_call_key],
      [value.activeCallAcceptedToken, row.active_call_accepted_token],
      [value.rowsVisited, safeNumber(row.rows_visited, "reconciliation rows visited")],
      [value.itemsProcessed, safeNumber(row.items_processed, "reconciliation items processed")],
      [value.bytesHashed, safeNumber(row.bytes_hashed, "reconciliation bytes hashed")],
      [
        value.directoryEntriesRead,
        safeNumber(row.directory_entries_read, "reconciliation directory entries"),
      ],
    ]);
    if (this.#cursorFor(value) !== row.cursor_token)
      throw new Error("Artifact reconciliation cursor relationship mismatch");
    return value;
  }

  #pageResult(
    keys: readonly string[],
    afterKey: string,
    limit: number,
  ): Readonly<{
    visited: number;
    lastKey: string;
    done: boolean;
  }> {
    const selected = keys.slice(0, limit);
    return {
      visited: keys.length,
      lastKey: selected.at(-1) ?? afterKey,
      done: keys.length < limit,
    };
  }

  #parseIncident(row: Record<string, unknown>): IntegrityIncident {
    const incident = parseCanonical<IntegrityIncident>(
      row["incident_json"] as string,
      row["incident_hash"] as string,
      "peas/artifact-incident/v2",
    );
    const numberOrNull = (value: unknown, label: string): number | null =>
      value === null ? null : safeNumber(value as bigint, label);
    relationalMismatch("Artifact incident", [
      [incident.incidentId, row["incident_id"]],
      [incident.actionKey ?? null, row["action_key"]],
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
    return incident;
  }

  #readInstallIntent(intentId: string): InstallIntent | undefined {
    const row = this.#database
      .prepare("SELECT * FROM artifact_install_intents WHERE intent_id = ?")
      .get(intentId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    const intent = parseCanonical<InstallIntent>(
      row["intent_json"] as string,
      row["intent_hash"] as string,
      "peas/artifact-install-intent-record/v1",
    );
    const artifact = parseCanonical<ArtifactMetadata>(
      row["artifact_json"] as string,
      row["artifact_hash"] as string,
      "peas/artifact-blob/v1",
    );
    const response = parseCanonical<SafeHttpResponseMetadata>(
      row["response_json"] as string,
      row["response_hash"] as string,
      "peas/artifact-install-response/v1",
    );
    const observationRaw = parseCanonical<Omit<ArtifactObservation, "observationHash">>(
      row["observation_json"] as string,
      row["observation_hash"] as string,
      "peas/artifact-observation/v1",
    );
    const observation = {
      ...observationRaw,
      observationHash: row["observation_hash"] as string,
    };
    relationalMismatch("Artifact install intent", [
      [intent.intentId, row["intent_id"]],
      [intent.attemptId, row["attempt_id"]],
      [intent.stagingId, row["staging_id"]],
      [intent.digest, row["digest"]],
      [intent.sizeBytes, safeNumber(row["size_bytes"] as bigint, "install intent size")],
      [intent.disposition, row["disposition"]],
      [
        intent.createdWriterGeneration,
        safeNumber(row["created_writer_generation"] as bigint, "install intent generation"),
      ],
      [intent.createdAtMs, safeNumber(row["created_at_ms"] as bigint, "install intent time")],
      [
        canonicalJson(intent.artifact as unknown as JsonValue),
        canonicalJson(artifact as unknown as JsonValue),
      ],
      [
        canonicalJson(intent.response as unknown as JsonValue),
        canonicalJson(response as unknown as JsonValue),
      ],
      [
        canonicalJson(intent.observation as unknown as JsonValue),
        canonicalJson(observation as unknown as JsonValue),
      ],
      [intent.digest, artifact.digest],
      [intent.digest, observation.artifactDigest],
      [intent.attemptId, observation.attemptId],
    ]);
    return intent;
  }

  #readReconciliationActionPlan(actionKey: string): ReconciliationActionPlan | undefined {
    const row = this.#database
      .prepare("SELECT * FROM artifact_reconciliation_action_plans WHERE action_key = ?")
      .get(actionKey) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    const plan = parseCanonical<ReconciliationActionPlan>(
      row["plan_json"] as string,
      row["plan_hash"] as string,
      "peas/artifact-reconciliation-action-plan/v1",
    );
    relationalMismatch("Artifact reconciliation action plan", [
      [plan.actionKey, row["action_key"]],
      [plan.runId, row["run_id"]],
      [plan.workKey, row["work_key"]],
      [plan.actionKind, row["action_kind"]],
      [plan.sourceRelativePath, row["source_relative_path"]],
      [plan.expectedDigest, row["expected_digest"]],
      [
        plan.expectedSizeBytes,
        row["expected_size_bytes"] === null
          ? null
          : safeNumber(row["expected_size_bytes"] as bigint, "action expected size"),
      ],
      [plan.incident?.incidentId ?? null, row["incident_id"]],
      [plan.quarantineName, row["quarantine_name"]],
      [plan.plannedPhase, row["planned_phase"]],
      [plan.plannedShard, safeNumber(row["planned_shard"] as bigint, "action shard")],
      [plan.plannedAfterKey, row["planned_after_key"]],
      [plan.recordedAtMs, safeNumber(row["recorded_at_ms"] as bigint, "action record time")],
      [
        plan.sourceIdentity === null ? null : canonicalJson(plan.sourceIdentity),
        row["source_identity_json"],
      ],
    ]);
    return plan;
  }

  #hasInstallTransition(intentId: string, state: string): boolean {
    return (
      this.#database
        .prepare(
          "SELECT 1 present FROM artifact_install_transitions WHERE intent_id = ? AND state = ?",
        )
        .get(intentId, state) !== undefined
    );
  }

  #insertInstallTransition(
    intentId: string,
    state: "content-installed" | "evidence-committed" | "stage-cleaned" | "aborted",
    fence: WriterFence,
  ): void {
    const transitionId = deriveInstallTransitionId(intentId, state);
    const existing = this.#database
      .prepare(
        "SELECT transition_json, transition_hash FROM artifact_install_transitions WHERE intent_id = ? AND state = ?",
      )
      .get(intentId, state) as { transition_json: string; transition_hash: string } | undefined;
    if (existing !== undefined) {
      const parsed = parseCanonical<{ transitionId: string; intentId: string; state: string }>(
        existing.transition_json,
        existing.transition_hash,
        "peas/artifact-install-transition-record/v1",
      );
      relationalMismatch("Artifact install transition replay", [
        [parsed.transitionId, transitionId],
        [parsed.intentId, intentId],
        [parsed.state, state],
      ]);
      return;
    }
    const value = {
      transitionId,
      intentId,
      state,
      writerGeneration: fence.generation,
      transitionedAtMs: fence.nowMs(),
    };
    this.#database
      .prepare(`INSERT INTO artifact_install_transitions (
        transition_id, intent_id, state, writer_generation, transitioned_at_ms,
        transition_json, transition_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        transitionId,
        intentId,
        state,
        fence.generation,
        value.transitionedAtMs,
        canonicalJson(value as unknown as JsonValue),
        canonicalHash("peas/artifact-install-transition-record/v1", value as unknown as JsonValue),
      );
  }

  #insertSuccessEvidence(
    artifact: ArtifactMetadata,
    observation: ArtifactObservation,
    response: SafeHttpResponseMetadata,
  ): "created" | "deduplicated" {
    const attempt = this.getAttempt(observation.attemptId);
    if (attempt === undefined) throw new Error("Artifact observation attempt is missing");
    relationalMismatch("Artifact observation attempt", [
      [observation.provider, attempt.provider],
      [observation.recordId, attempt.recordId],
      [observation.revisionId, attempt.revisionId],
      [observation.request.method, attempt.request.method],
      [observation.request.origin, attempt.request.origin],
      [observation.request.pathHash, attempt.request.pathHash],
      [observation.request.routeLabel, attempt.request.routeLabel],
      [observation.request.identityHash, attempt.request.identityHash],
    ]);
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
    const jsonValue = { ...observation } as unknown as Record<string, JsonValue>;
    delete jsonValue["observationHash"];
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
        canonicalJson(jsonValue),
        observation.observationHash,
      );
    return disposition;
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
