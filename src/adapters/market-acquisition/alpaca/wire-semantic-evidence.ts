import { isProxy } from "node:util/types";
import { P1_10_TEST_AUTHORITY } from "../../../internal-test-authority.js";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { canonicalHash } from "../../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../../core/json.js";
import type { FrozenSessionCalendarEntryV1 } from "../../../providers/market-reference/operations.js";
import {
  type CommittedArtifactExpectation,
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
import { assertOwnedSqliteDatabase, type SqliteDatabase } from "../../sqlite/database.js";
import type { ValidatedMarketAcquisitionConfiguration } from "../contracts.js";
import { assertValidatedMarketAcquisitionConfiguration } from "../configuration.js";
import {
  acceptedAlpacaWireCalendarEntries,
  ALPACA_PRIMARY_CORPUS_AUTHORITY_ID,
  ALPACA_WIRE_CALENDAR_VERSION,
} from "./wire-semantic-catalog.js";

export type AlpacaWireSemanticAuthorityV1 = Readonly<{
  schemaVersion: 1;
  authorityId: string;
  requestIdentityHash: string;
  pageArtifactObservationId: string;
  pageArtifactDigest: string;
  queryStartNs: string;
  queryEndNs: string;
  calendarVersion: string;
  calendarDigest: string;
  calendarEntries: readonly FrozenSessionCalendarEntryV1[];
  primaryCorpusMember: boolean;
  corpusAdmissionHash: string;
}>;

export type AlpacaWireSemanticAuthorityDraft = Pick<
  AlpacaWireSemanticAuthorityV1,
  | "schemaVersion"
  | "requestIdentityHash"
  | "pageArtifactObservationId"
  | "pageArtifactDigest"
  | "queryStartNs"
  | "queryEndNs"
>;

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
  semanticAuthorityId: string;
  semanticAuthorityStageLedgerFactId: string;
  semanticAuthorityObservationId: string;
  semanticAuthorityObservationHash: string;
  semanticAuthorityDigest: string;
  semanticAuthoritySizeBytes: number;
  calendarDigest: string;
  corpusAdmissionHash: string;
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
const ownedSemanticEvidenceStores = new WeakSet<object>();
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

function createAlpacaWireSemanticAuthority(
  draft: AlpacaWireSemanticAuthorityDraft,
): AlpacaWireSemanticAuthorityV1 {
  const calendarEntries = acceptedAlpacaWireCalendarEntries(draft.queryStartNs, draft.queryEndNs);
  const calendarDigest = canonicalHash("peas/alpaca-wire-calendar-authority/v1", {
    catalogVersion: ALPACA_WIRE_CALENDAR_VERSION,
    calendarEntries,
  } as unknown as JsonValue);
  const corpusAdmissionHash = canonicalHash("peas/alpaca-wire-corpus-admission/v1", {
    corpusAuthorityId: ALPACA_PRIMARY_CORPUS_AUTHORITY_ID,
    requestIdentityHash: draft.requestIdentityHash,
    pageArtifactObservationId: draft.pageArtifactObservationId,
    pageArtifactDigest: draft.pageArtifactDigest,
    primaryCorpusMember: true,
  });
  const body = Object.freeze({
    schemaVersion: 1 as const,
    requestIdentityHash: draft.requestIdentityHash,
    pageArtifactObservationId: draft.pageArtifactObservationId,
    pageArtifactDigest: draft.pageArtifactDigest,
    queryStartNs: draft.queryStartNs,
    queryEndNs: draft.queryEndNs,
    calendarVersion: ALPACA_WIRE_CALENDAR_VERSION,
    calendarDigest,
    calendarEntries,
    primaryCorpusMember: true,
    corpusAdmissionHash,
  });
  return Object.freeze({
    ...body,
    authorityId: `wsa1_${canonicalHash(
      "peas/alpaca-wire-semantic-authority/v1",
      body as unknown as JsonValue,
    )}`,
  });
}

/** Test-build-only fixture authority; live admission is issued by the owned durable boundary. */
export function createTestAlpacaWireSemanticAuthority(
  draft: AlpacaWireSemanticAuthorityDraft,
): AlpacaWireSemanticAuthorityV1 {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-wire-semantic-authority-unavailable");
  }
  return createAlpacaWireSemanticAuthority(draft);
}

function validateSemanticAuthority(value: AlpacaWireSemanticAuthorityV1): void {
  const { authorityId, calendarDigest, corpusAdmissionHash, ...body } = value;
  const draft: AlpacaWireSemanticAuthorityDraft = {
    schemaVersion: body.schemaVersion,
    requestIdentityHash: body.requestIdentityHash,
    pageArtifactObservationId: body.pageArtifactObservationId,
    pageArtifactDigest: body.pageArtifactDigest,
    queryStartNs: body.queryStartNs,
    queryEndNs: body.queryEndNs,
  };
  const expected = createAlpacaWireSemanticAuthority(draft);
  if (
    value.schemaVersion !== 1 ||
    !/^wsa1_[0-9a-f]{64}$/u.test(authorityId) ||
    expected.authorityId !== authorityId ||
    expected.calendarDigest !== calendarDigest ||
    expected.corpusAdmissionHash !== corpusAdmissionHash ||
    canonicalJson(expected as unknown as JsonValue) !==
      canonicalJson(value as unknown as JsonValue) ||
    !HASH.test(value.requestIdentityHash) ||
    !HASH.test(value.pageArtifactObservationId) ||
    !HASH.test(value.pageArtifactDigest) ||
    !/^-?\d+$/u.test(value.queryStartNs) ||
    !/^-?\d+$/u.test(value.queryEndNs) ||
    BigInt(value.queryStartNs) > BigInt(value.queryEndNs) ||
    value.calendarEntries.length === 0 ||
    value.calendarEntries.some((entry) => {
      assertCalendarEntry(entry);
      return entry.calendarVersion !== value.calendarVersion;
    })
  ) {
    throw new TypeError("wire-semantic-authority-invalid");
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
    !/^wsa1_[0-9a-f]{64}$/u.test(value.semanticAuthorityId) ||
    !/^ole1_[0-9a-f]{64}$/u.test(value.semanticAuthorityStageLedgerFactId) ||
    !HASH.test(value.semanticAuthorityObservationId) ||
    !HASH.test(value.semanticAuthorityObservationHash) ||
    !HASH.test(value.semanticAuthorityDigest) ||
    !Number.isSafeInteger(value.semanticAuthoritySizeBytes) ||
    value.semanticAuthoritySizeBytes < 1 ||
    !HASH.test(value.calendarDigest) ||
    !HASH.test(value.corpusAdmissionHash) ||
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

export function assertAcceptedAlpacaWireSemanticEvidence(
  value: AlpacaWireSemanticEvidenceV1,
  requestIdentityHash: string,
  queryStartNs: string,
  queryEndNs: string,
): void {
  const calendarEntries = acceptedAlpacaWireCalendarEntries(queryStartNs, queryEndNs);
  const calendarDigest = canonicalHash("peas/alpaca-wire-calendar-authority/v1", {
    catalogVersion: ALPACA_WIRE_CALENDAR_VERSION,
    calendarEntries,
  });
  const corpusAdmissionHash = canonicalHash("peas/alpaca-wire-corpus-admission/v1", {
    corpusAuthorityId: ALPACA_PRIMARY_CORPUS_AUTHORITY_ID,
    requestIdentityHash,
    pageArtifactObservationId: value.artifactObservationId,
    pageArtifactDigest: value.artifactDigest,
    primaryCorpusMember: true,
  });
  if (
    value.calendarVersion !== ALPACA_WIRE_CALENDAR_VERSION ||
    value.calendarDigest !== calendarDigest ||
    canonicalJson(value.calendarEntries as unknown as JsonValue) !==
      canonicalJson(calendarEntries as unknown as JsonValue) ||
    value.primaryCorpusMember !== true ||
    value.corpusAdmissionHash !== corpusAdmissionHash
  ) {
    throw new TypeError("wire-semantic-accepted-authority-invalid");
  }
}

function sameEvidence(existing: AlpacaWireSemanticEvidenceV1, value: AlpacaWireSemanticEvidenceV1) {
  if (
    canonicalJson(existing as unknown as JsonValue) !== canonicalJson(value as unknown as JsonValue)
  ) {
    throw new TypeError("wire-semantic-evidence-conflict");
  }
}

async function loadSemanticAuthorityBytes(
  store: RetentionEnforcedArtifactStore,
  expected: CommittedArtifactExpectation,
): Promise<AlpacaWireSemanticAuthorityV1> {
  await verifyCommittedArtifact(store, expected);
  const read = await store.read(expected.artifactDigest);
  const chunks: Buffer[] = [];
  const digest = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of read.stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.byteLength;
      if (size > expected.artifactSizeBytes || size > 256 * 1024)
        throw new RangeError("wire-semantic-authority-size-invalid");
      digest.update(bytes);
      chunks.push(Buffer.from(bytes));
    }
    if (size !== expected.artifactSizeBytes)
      throw new TypeError("wire-semantic-authority-size-invalid");
    if (digest.digest("hex") !== expected.artifactDigest) {
      throw new TypeError("wire-semantic-authority-digest-invalid");
    }
    const value = JSON.parse(
      Buffer.concat(chunks).toString("utf8"),
    ) as AlpacaWireSemanticAuthorityV1;
    validateSemanticAuthority(value);
    return value;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

export class MemoryAlpacaWireSemanticEvidenceStore implements AlpacaWireSemanticEvidenceStore {
  constructor() {
    memoryEvidence.set(this, new Map());
    if (P1_10_TEST_AUTHORITY !== undefined) {
      ownedSemanticEvidenceStores.add(this);
      Object.freeze(this);
    }
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

export function createSqliteAlpacaWireSemanticEvidenceStore(
  database: SqliteDatabase,
): SqliteAlpacaWireSemanticEvidenceStore {
  assertOwnedSqliteDatabase(database);
  const store = new SqliteAlpacaWireSemanticEvidenceStore(database);
  ownedSemanticEvidenceStores.add(store);
  Object.freeze(store);
  return store;
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
    !ownedSemanticEvidenceStores.has(value as object) ||
    isProxy(value as object) ||
    !Object.isFrozen(value) ||
    Reflect.ownKeys(value as object).length !== 0 ||
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
    !ownedSemanticEvidenceStores.has(value as object) ||
    isProxy(value as object) ||
    !Object.isFrozen(value) ||
    Reflect.ownKeys(value as object).length !== 0 ||
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

  async issueAuthority(
    plan: ValidatedMarketAcquisitionConfiguration,
    pageArtifact: CommittedArtifactExpectation,
  ): Promise<AlpacaWireSemanticAuthorityV1> {
    assertOwnedDurableAlpacaWireSemanticEvidenceBoundary(this);
    assertValidatedMarketAcquisitionConfiguration(plan);
    if (
      pageArtifact.provider !== "alpaca" ||
      pageArtifact.requestIdentityHash !== plan.requestIdentityHash
    ) {
      throw new TypeError("wire-semantic-corpus-admission-invalid");
    }
    const verified = await verifyCommittedArtifact(this.#artifacts, pageArtifact);
    if (
      verified.observation.observationId !== pageArtifact.artifactObservationId ||
      verified.observation.artifactDigest !== pageArtifact.artifactDigest
    ) {
      throw new TypeError("wire-semantic-corpus-admission-invalid");
    }
    return createAlpacaWireSemanticAuthority({
      schemaVersion: 1,
      requestIdentityHash: plan.requestIdentityHash,
      pageArtifactObservationId: pageArtifact.artifactObservationId,
      pageArtifactDigest: pageArtifact.artifactDigest,
      queryStartNs: plan.queryStartNs.toString(),
      queryEndNs: plan.queryEndNs.toString(),
    });
  }

  async persist(
    input: Readonly<{
      expectedIdentity: JournalIdentityInput;
      marketAcquisitionJournalId: string;
      plan: ValidatedMarketAcquisitionConfiguration;
      semanticAuthority: CommittedArtifactExpectation & Readonly<{ stageLedgerFactId: string }>;
    }>,
  ): Promise<void> {
    assertOwnedDurableAlpacaWireSemanticEvidenceBoundary(this);
    assertValidatedMarketAcquisitionConfiguration(input.plan);
    if (
      input.marketAcquisitionJournalId !== deriveMarketAcquisitionJournalId(input.expectedIdentity)
    ) {
      throw new TypeError("page-semantic-evidence-invalid");
    }
    const journal = await this.#journal.load(input.marketAcquisitionJournalId);
    validateJournalEntries(journal, input.expectedIdentity);
    const ledger = await this.#journal.loadLedgerEntries();
    validateJournalLedgerBindings(journal, ledger);
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
    const byId = new Map(ledger.map((entry) => [entry.entryId, entry]));
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
    const authorityStage = byId.get(input.semanticAuthority.stageLedgerFactId);
    const authorityCommit = authorityStage?.parentEntryIds
      .map((id) => byId.get(id))
      .find((entry) => entry?.facts.kind === "artifact.committed");
    const authorityDeclaration = authorityCommit?.parentEntryIds
      .map((id) => byId.get(id))
      .find((entry) => entry?.facts.kind === "acquisition.declared");
    const workflowProvenance = await Promise.all([
      this.#journal.isWorkflowProducedJournalEntry(latest.journalEntryHash),
      this.#journal.isWorkflowProducedLedgerEntry(stage.entryId),
      clockDeclaration === undefined
        ? Promise.resolve(false)
        : this.#journal.isWorkflowProducedLedgerEntry(clockDeclaration.entryId),
      committed === undefined
        ? Promise.resolve(false)
        : this.#journal.isWorkflowProducedLedgerEntry(committed.entryId),
      authorityStage === undefined
        ? Promise.resolve(false)
        : this.#journal.isWorkflowProducedLedgerEntry(authorityStage.entryId),
      authorityCommit === undefined
        ? Promise.resolve(false)
        : this.#journal.isWorkflowProducedLedgerEntry(authorityCommit.entryId),
      authorityDeclaration === undefined
        ? Promise.resolve(false)
        : this.#journal.isWorkflowProducedLedgerEntry(authorityDeclaration.entryId),
    ]);
    if (
      workflowProvenance.some((produced) => !produced) ||
      authorityStage?.facts.kind !== "artifact.verified" ||
      authorityCommit?.facts.kind !== "artifact.committed" ||
      authorityDeclaration?.facts.kind !== "acquisition.declared" ||
      authorityStage.facts.vaultObservationId !== input.semanticAuthority.artifactObservationId ||
      authorityStage.facts.artifactDigest !== input.semanticAuthority.artifactDigest ||
      authorityStage.facts.metadataSizeBytes !== input.semanticAuthority.artifactSizeBytes ||
      authorityCommit.facts.vaultObservationHash !==
        input.semanticAuthority.artifactObservationHash ||
      authorityDeclaration.facts.provider !== "alpaca" ||
      authorityDeclaration.facts.retrievalAttemptId !==
        input.semanticAuthority.retrievalAttemptId ||
      authorityDeclaration.facts.sanitizedRequestIdentityHash !== input.plan.requestIdentityHash ||
      authorityDeclaration.facts.routeLabel !==
        `${input.plan.route.safeRouteLabel}:wire-semantic-authority`
    ) {
      throw new TypeError("page-semantic-authority-ledger-invalid");
    }
    const semantic = await loadSemanticAuthorityBytes(this.#artifacts, input.semanticAuthority);
    if (
      semantic.requestIdentityHash !== input.plan.requestIdentityHash ||
      semantic.pageArtifactObservationId !== latest.artifactObservationId ||
      semantic.pageArtifactDigest !== latest.artifactDigest ||
      semantic.queryStartNs !== input.plan.queryStartNs.toString() ||
      semantic.queryEndNs !== input.plan.queryEndNs.toString()
    ) {
      throw new TypeError("page-semantic-authority-binding-invalid");
    }
    const acceptedCalendar = acceptedAlpacaWireCalendarEntries(
      semantic.queryStartNs,
      semantic.queryEndNs,
    );
    if (
      canonicalJson(semantic.calendarEntries as unknown as JsonValue) !==
      canonicalJson(acceptedCalendar as unknown as JsonValue)
    ) {
      throw new TypeError("page-semantic-calendar-coverage-invalid");
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
      semanticAuthorityId: semantic.authorityId,
      semanticAuthorityStageLedgerFactId: authorityStage.entryId,
      semanticAuthorityObservationId: input.semanticAuthority.artifactObservationId,
      semanticAuthorityObservationHash: input.semanticAuthority.artifactObservationHash,
      semanticAuthorityDigest: input.semanticAuthority.artifactDigest,
      semanticAuthoritySizeBytes: input.semanticAuthority.artifactSizeBytes,
      calendarDigest: semantic.calendarDigest,
      corpusAdmissionHash: semantic.corpusAdmissionHash,
      calendarEntries: Object.freeze(structuredClone(semantic.calendarEntries)),
      calendarVersion: semantic.calendarVersion,
      durableClockBasisId: stage.clock.clockBasisId,
      durablyRecordedAtMs: committed.facts.retrievedAtMs,
      durableLogicalAtMs: stage.clock.wallTimeMs,
      primaryCorpusMember: semantic.primaryCorpusMember,
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
  if (P1_10_TEST_AUTHORITY === undefined) {
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
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-wire-semantic-evidence-ingress-unavailable");
  }
  assertOwnedAlpacaWireSemanticEvidenceStore(store);
  appendEvidence(store, value);
}
