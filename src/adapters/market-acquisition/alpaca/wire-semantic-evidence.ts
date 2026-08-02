import { isProxy } from "node:util/types";

import { canonicalHash } from "../../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../../core/json.js";
import type { FrozenSessionCalendarEntryV1 } from "../../../providers/market-reference/operations.js";
import {
  MarketAcquisitionLedger,
  validateJournalLedgerBindings,
  verifyCommittedArtifact,
} from "../artifact-integration.js";
import {
  type AcquisitionJournal,
  type JournalIdentityInput,
  deriveMarketAcquisitionJournalId,
  validateJournalEntries,
} from "../journal.js";
import {
  assertOwnedAcquisitionJournal,
  assertOwnedSqliteAcquisitionJournal,
} from "../owned-journal.js";
import {
  type RetentionEnforcedArtifactStore,
  assertRetentionEnforcedArtifactStore,
} from "../retention/artifact-access.js";
import type { SqliteDatabase } from "../../sqlite/database.js";

export type AlpacaWireSemanticEvidenceV1 = Readonly<{
  schemaVersion: 1;
  evidenceId: string;
  journalEntryHash: string;
  marketAcquisitionJournalId: string;
  artifactObservationId: string;
  artifactObservationHash: string;
  artifactDigest: string;
  artifactSizeBytes: number;
  stageLedgerFactId: string;
  clockDeclarationFactId: string;
  calendarEntries: readonly FrozenSessionCalendarEntryV1[];
  calendarVersion: string;
  durableClockBasisId: string;
  durablyRecordedAtMs: number;
  durableLogicalAtMs: number;
  primaryCorpusMember: boolean;
}>;

export type AlpacaWireSemanticEvidenceDraft = Omit<AlpacaWireSemanticEvidenceV1, "evidenceId">;

export interface AlpacaWireSemanticEvidenceStore {
  loadForJournalEntry(journalEntryHash: string): AlpacaWireSemanticEvidenceV1 | undefined;
}

const EVIDENCE_ID = /^wse1_[0-9a-f]{64}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const semanticEvidenceBoundaries = new WeakSet<object>();
const SEMANTIC_EVIDENCE_BOUNDARY_CONSTRUCTION_AUTHORITY = Object.freeze({});

function assertSafeTime(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label}-invalid`);
}

function assertCalendarEntry(value: FrozenSessionCalendarEntryV1): void {
  if (
    Object.getPrototypeOf(value) !== Object.prototype ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value.sessionDate) ||
    value.timeZone !== "America/New_York" ||
    (value.utcOffsetMinutes !== -300 && value.utcOffsetMinutes !== -240) ||
    typeof value.calendarVersion !== "string" ||
    value.calendarVersion.length === 0 ||
    typeof value.holiday !== "boolean"
  ) {
    throw new TypeError("wire-semantic-calendar-entry-invalid");
  }
  const boundaries = [
    value.extendedOpenNs,
    value.regularOpenNs,
    value.regularCloseNs,
    value.extendedCloseNs,
  ];
  if (value.holiday !== boundaries.every((member) => member === null)) {
    throw new TypeError("wire-semantic-calendar-entry-invalid");
  }
  if (!value.holiday) {
    if (boundaries.some((member) => typeof member !== "string" || !/^-?\d+$/u.test(member))) {
      throw new TypeError("wire-semantic-calendar-entry-invalid");
    }
    const extendedOpen = BigInt(boundaries[0] as string);
    const regularOpen = BigInt(boundaries[1] as string);
    const regularClose = BigInt(boundaries[2] as string);
    const extendedClose = BigInt(boundaries[3] as string);
    if (
      !(extendedOpen < regularOpen && regularOpen < regularClose && regularClose < extendedClose)
    ) {
      throw new TypeError("wire-semantic-calendar-entry-invalid");
    }
  }
}

export function deriveAlpacaWireSemanticEvidenceId(draft: AlpacaWireSemanticEvidenceDraft): string {
  return `wse1_${canonicalHash(
    "peas/alpaca-wire-semantic-evidence/v1",
    draft as unknown as JsonValue,
  )}`;
}

export function validateAlpacaWireSemanticEvidence(value: AlpacaWireSemanticEvidenceV1): void {
  if (
    value.schemaVersion !== 1 ||
    !EVIDENCE_ID.test(value.evidenceId) ||
    !HASH.test(value.journalEntryHash) ||
    !HASH.test(value.marketAcquisitionJournalId) ||
    !HASH.test(value.artifactObservationId) ||
    !HASH.test(value.artifactObservationHash) ||
    !HASH.test(value.artifactDigest) ||
    !Number.isSafeInteger(value.artifactSizeBytes) ||
    value.artifactSizeBytes < 0 ||
    !/^ole1_[0-9a-f]{64}$/u.test(value.stageLedgerFactId) ||
    !/^ole1_[0-9a-f]{64}$/u.test(value.clockDeclarationFactId) ||
    !/^clk1_[0-9a-f]{64}$/u.test(value.durableClockBasisId) ||
    typeof value.calendarVersion !== "string" ||
    value.calendarVersion.length === 0 ||
    typeof value.primaryCorpusMember !== "boolean" ||
    !Array.isArray(value.calendarEntries) ||
    value.calendarEntries.length === 0
  ) {
    throw new TypeError("wire-semantic-evidence-invalid");
  }
  assertSafeTime(value.durablyRecordedAtMs, "wire-semantic-recorded-time");
  assertSafeTime(value.durableLogicalAtMs, "wire-semantic-logical-time");
  const dates = new Set<string>();
  for (const entry of value.calendarEntries) {
    assertCalendarEntry(entry);
    if (entry.calendarVersion !== value.calendarVersion || dates.has(entry.sessionDate)) {
      throw new TypeError("wire-semantic-calendar-evidence-invalid");
    }
    dates.add(entry.sessionDate);
  }
  const { evidenceId: _evidenceId, ...draft } = value;
  if (deriveAlpacaWireSemanticEvidenceId(draft) !== value.evidenceId) {
    throw new TypeError("wire-semantic-evidence-identity-invalid");
  }
}

function sameEvidence(existing: AlpacaWireSemanticEvidenceV1, value: AlpacaWireSemanticEvidenceV1) {
  if (
    canonicalJson(existing as unknown as JsonValue) !== canonicalJson(value as unknown as JsonValue)
  ) {
    throw new TypeError("wire-semantic-evidence-conflict");
  }
}

export class MemoryAlpacaWireSemanticEvidenceStore implements AlpacaWireSemanticEvidenceStore {
  constructor() {
    memoryEvidence.set(this, new Map());
  }

  loadForJournalEntry(journalEntryHash: string): AlpacaWireSemanticEvidenceV1 | undefined {
    const value = memoryEvidence.get(this)?.get(journalEntryHash);
    if (value === undefined) return undefined;
    validateAlpacaWireSemanticEvidence(value);
    return structuredClone(value);
  }
}

export class SqliteAlpacaWireSemanticEvidenceStore implements AlpacaWireSemanticEvidenceStore {
  constructor(database: SqliteDatabase) {
    sqliteEvidenceDatabases.set(this, database);
  }

  loadForJournalEntry(journalEntryHash: string): AlpacaWireSemanticEvidenceV1 | undefined {
    const database = sqliteEvidenceDatabases.get(this);
    if (database === undefined) throw new TypeError("owned-wire-semantic-evidence-store-required");
    const row = database
      .prepare(`SELECT evidence_json AS json, evidence_hash AS hash
      FROM market_acquisition_wire_semantic_evidence WHERE journal_entry_hash = ?`)
      .get(journalEntryHash) as { json: string; hash: string } | undefined;
    if (row === undefined) return undefined;
    const value = JSON.parse(row.json) as AlpacaWireSemanticEvidenceV1;
    if (
      canonicalJson(value as unknown as JsonValue) !== row.json ||
      canonicalHash(
        "peas/alpaca-wire-semantic-evidence-record/v1",
        value as unknown as JsonValue,
      ) !== row.hash
    ) {
      throw new Error("wire-semantic-evidence-persistence-mismatch");
    }
    validateAlpacaWireSemanticEvidence(value);
    return value;
  }
}

const memoryEvidence = new WeakMap<
  MemoryAlpacaWireSemanticEvidenceStore,
  Map<string, AlpacaWireSemanticEvidenceV1>
>();
const sqliteEvidenceDatabases = new WeakMap<
  SqliteAlpacaWireSemanticEvidenceStore,
  SqliteDatabase
>();

function appendEvidence(
  store: AlpacaWireSemanticEvidenceStore,
  value: AlpacaWireSemanticEvidenceV1,
): void {
  validateAlpacaWireSemanticEvidence(value);
  if (Object.getPrototypeOf(store) === MemoryAlpacaWireSemanticEvidenceStore.prototype) {
    const values = memoryEvidence.get(store as MemoryAlpacaWireSemanticEvidenceStore);
    if (values === undefined) throw new TypeError("owned-wire-semantic-evidence-store-required");
    const existing = values.get(value.journalEntryHash);
    if (existing !== undefined) sameEvidence(existing, value);
    else values.set(value.journalEntryHash, structuredClone(value));
    return;
  }
  if (Object.getPrototypeOf(store) === SqliteAlpacaWireSemanticEvidenceStore.prototype) {
    const database = sqliteEvidenceDatabases.get(store as SqliteAlpacaWireSemanticEvidenceStore);
    if (database === undefined) throw new TypeError("owned-wire-semantic-evidence-store-required");
    const json = canonicalJson(value as unknown as JsonValue);
    const hash = canonicalHash(
      "peas/alpaca-wire-semantic-evidence-record/v1",
      value as unknown as JsonValue,
    );
    database
      .prepare(`INSERT OR IGNORE INTO market_acquisition_wire_semantic_evidence (
        evidence_id, journal_entry_hash, market_acquisition_journal_id, artifact_observation_id,
        artifact_digest, artifact_size_bytes, stage_ledger_fact_id, evidence_json, evidence_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        value.evidenceId,
        value.journalEntryHash,
        value.marketAcquisitionJournalId,
        value.artifactObservationId,
        value.artifactDigest,
        value.artifactSizeBytes,
        value.stageLedgerFactId,
        json,
        hash,
      );
    const existing = store.loadForJournalEntry(value.journalEntryHash);
    if (existing === undefined) throw new Error("wire-semantic-evidence-insert-failed");
    sameEvidence(existing, value);
    return;
  }
  throw new TypeError("owned-wire-semantic-evidence-store-required");
}

export function assertOwnedAlpacaWireSemanticEvidenceStore(
  value: AlpacaWireSemanticEvidenceStore,
): void {
  if (
    isProxy(value as object) ||
    ![
      MemoryAlpacaWireSemanticEvidenceStore.prototype,
      SqliteAlpacaWireSemanticEvidenceStore.prototype,
    ].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("owned-wire-semantic-evidence-store-required");
  }
}

export function assertOwnedSqliteAlpacaWireSemanticEvidenceStore(
  value: AlpacaWireSemanticEvidenceStore,
): void {
  if (
    isProxy(value as object) ||
    Object.getPrototypeOf(value) !== SqliteAlpacaWireSemanticEvidenceStore.prototype
  ) {
    throw new TypeError("owned-sqlite-wire-semantic-evidence-store-required");
  }
}

/** Persists semantics only after exact durable journal, ledger, and artifact verification. */
export class DurableAlpacaWireSemanticEvidenceBoundary {
  readonly #journal: AcquisitionJournal;
  readonly #evidence: AlpacaWireSemanticEvidenceStore;
  readonly #artifacts: RetentionEnforcedArtifactStore;

  constructor(
    journal: AcquisitionJournal,
    evidence: AlpacaWireSemanticEvidenceStore,
    artifacts: RetentionEnforcedArtifactStore,
    authority?: object,
  ) {
    assertOwnedAcquisitionJournal(journal);
    assertOwnedAlpacaWireSemanticEvidenceStore(evidence);
    assertRetentionEnforcedArtifactStore(artifacts);
    this.#journal = journal;
    this.#evidence = evidence;
    this.#artifacts = artifacts;
    if (authority === SEMANTIC_EVIDENCE_BOUNDARY_CONSTRUCTION_AUTHORITY) {
      semanticEvidenceBoundaries.add(this);
    }
  }

  async persist(
    input: Readonly<{
      expectedIdentity: JournalIdentityInput;
      marketAcquisitionJournalId: string;
      ledger: MarketAcquisitionLedger;
      calendarEntries: readonly FrozenSessionCalendarEntryV1[];
      primaryCorpusMember: boolean;
    }>,
  ): Promise<void> {
    assertOwnedDurableAlpacaWireSemanticEvidenceBoundary(this);
    if (
      isProxy(input.ledger) ||
      Object.getPrototypeOf(input.ledger) !== MarketAcquisitionLedger.prototype ||
      input.marketAcquisitionJournalId !== deriveMarketAcquisitionJournalId(input.expectedIdentity)
    ) {
      throw new TypeError("page-semantic-evidence-invalid");
    }
    const journal = await this.#journal.load(input.marketAcquisitionJournalId);
    validateJournalEntries(journal, input.expectedIdentity);
    validateJournalLedgerBindings(journal, input.ledger.entries);
    const latest = journal.at(-1);
    if (
      latest?.checkpointKind !== "artifact-verified" ||
      latest.stageLedgerFactId === null ||
      latest.artifactObservationId === null ||
      latest.artifactObservationHash === null ||
      latest.artifactDigest === null ||
      latest.artifactSizeBytes === null
    ) {
      throw new TypeError("page-semantic-evidence-invalid");
    }
    const byId = new Map(input.ledger.entries.map((entry) => [entry.entryId, entry]));
    const stage = byId.get(latest.stageLedgerFactId);
    if (
      stage?.facts.kind !== "artifact.verified" ||
      stage.clock.clockBasisId === null ||
      stage.clock.wallTimeMs === null ||
      stage.facts.vaultObservationId !== latest.artifactObservationId ||
      stage.facts.artifactDigest !== latest.artifactDigest ||
      stage.facts.metadataSizeBytes !== latest.artifactSizeBytes
    ) {
      throw new TypeError("page-semantic-evidence-invalid");
    }
    const clockDeclaration = stage.parentEntryIds
      .map((id) => byId.get(id))
      .find((entry) => entry?.facts.kind === "clock-basis.declared");
    const committed = stage.parentEntryIds
      .map((id) => byId.get(id))
      .find((entry) => entry?.facts.kind === "artifact.committed");
    if (
      clockDeclaration?.facts.kind !== "clock-basis.declared" ||
      committed?.facts.kind !== "artifact.committed" ||
      clockDeclaration.facts.clockBasis.clockBasisId !== stage.clock.clockBasisId ||
      committed.facts.retrievedAtMs === null ||
      committed.facts.vaultObservationHash !== latest.artifactObservationHash
    ) {
      throw new TypeError("page-semantic-evidence-invalid");
    }
    const verified = await verifyCommittedArtifact(this.#artifacts, {
      artifactObservationId: latest.artifactObservationId,
      artifactDigest: latest.artifactDigest,
      artifactSizeBytes: latest.artifactSizeBytes,
      artifactObservationHash: latest.artifactObservationHash,
      retrievalAttemptId: latest.retrievalAttemptId,
      requestIdentityHash: latest.requestIdentityHash,
      provider: "alpaca",
    });
    if (verified.observation.retrievedAtMs !== committed.facts.retrievedAtMs) {
      throw new TypeError("page-semantic-evidence-invalid");
    }
    const draft = Object.freeze({
      schemaVersion: 1 as const,
      journalEntryHash: latest.journalEntryHash,
      marketAcquisitionJournalId: input.marketAcquisitionJournalId,
      artifactObservationId: latest.artifactObservationId,
      artifactObservationHash: latest.artifactObservationHash,
      artifactDigest: latest.artifactDigest,
      artifactSizeBytes: latest.artifactSizeBytes,
      stageLedgerFactId: stage.entryId,
      clockDeclarationFactId: clockDeclaration.entryId,
      calendarEntries: Object.freeze(structuredClone(input.calendarEntries)),
      calendarVersion: input.calendarEntries[0]?.calendarVersion ?? "",
      durableClockBasisId: stage.clock.clockBasisId,
      durablyRecordedAtMs: committed.facts.retrievedAtMs,
      durableLogicalAtMs: stage.clock.wallTimeMs,
      primaryCorpusMember: input.primaryCorpusMember,
    });
    appendEvidence(
      this.#evidence,
      Object.freeze({
        ...draft,
        evidenceId: deriveAlpacaWireSemanticEvidenceId(draft),
      }),
    );
  }
}

function constructAlpacaWireSemanticEvidenceBoundary(
  journal: AcquisitionJournal,
  evidence: AlpacaWireSemanticEvidenceStore,
  artifacts: RetentionEnforcedArtifactStore,
): DurableAlpacaWireSemanticEvidenceBoundary {
  const boundary = new DurableAlpacaWireSemanticEvidenceBoundary(
    journal,
    evidence,
    artifacts,
    SEMANTIC_EVIDENCE_BOUNDARY_CONSTRUCTION_AUTHORITY,
  );
  Object.freeze(boundary);
  return boundary;
}

export function createDurableAlpacaWireSemanticEvidenceBoundary(
  journal: AcquisitionJournal,
  evidence: AlpacaWireSemanticEvidenceStore,
  artifacts: RetentionEnforcedArtifactStore,
): DurableAlpacaWireSemanticEvidenceBoundary {
  assertOwnedSqliteAcquisitionJournal(journal);
  assertOwnedSqliteAlpacaWireSemanticEvidenceStore(evidence);
  assertRetentionEnforcedArtifactStore(artifacts);
  return constructAlpacaWireSemanticEvidenceBoundary(journal, evidence, artifacts);
}

export function createTestDurableAlpacaWireSemanticEvidenceBoundary(
  journal: AcquisitionJournal,
  evidence: AlpacaWireSemanticEvidenceStore,
  artifacts: RetentionEnforcedArtifactStore,
): DurableAlpacaWireSemanticEvidenceBoundary {
  if (process.env["NODE_TEST_CONTEXT"] === undefined) {
    throw new TypeError("test-wire-semantic-evidence-composition-unavailable");
  }
  assertOwnedAcquisitionJournal(journal);
  assertOwnedAlpacaWireSemanticEvidenceStore(evidence);
  assertRetentionEnforcedArtifactStore(artifacts);
  return constructAlpacaWireSemanticEvidenceBoundary(journal, evidence, artifacts);
}

export function assertOwnedDurableAlpacaWireSemanticEvidenceBoundary(
  value: DurableAlpacaWireSemanticEvidenceBoundary,
): void {
  if (
    !semanticEvidenceBoundaries.has(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== DurableAlpacaWireSemanticEvidenceBoundary.prototype ||
    !Object.isFrozen(value)
  ) {
    throw new TypeError("owned-durable-wire-semantic-evidence-boundary-required");
  }
}

/** Explicit synthetic-fixture ingress; unavailable outside the Node test runner. */
export function appendTestAlpacaWireSemanticEvidence(
  store: AlpacaWireSemanticEvidenceStore,
  value: AlpacaWireSemanticEvidenceV1,
): void {
  if (process.env["NODE_TEST_CONTEXT"] === undefined) {
    throw new TypeError("test-wire-semantic-evidence-ingress-unavailable");
  }
  assertOwnedAlpacaWireSemanticEvidenceStore(store);
  appendEvidence(store, value);
}
