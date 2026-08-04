import {
  assertJsonWithinLimits,
  canonicalJson,
  parseJsonWithinLimits,
  type JsonLimits,
  type JsonValue,
} from "../../core/json.js";
import {
  validateObservationLedgerBundle,
  type ObservationLedgerEntryV1,
} from "../../providers/observation-ledger.js";
import Database from "better-sqlite3";
import { P1_10_TEST_AUTHORITY } from "../../internal-test-authority.js";
import { assertOwnedSqliteDatabase, type SqliteDatabase } from "../sqlite/database.js";
import {
  type AcquisitionJournal,
  type JournalEntry,
  type JournalIdentityInput,
  deriveMarketAcquisitionJournalId,
  assertAcquisitionWorkflowProducerAuthority,
  validateJournalEntries,
} from "./journal.js";
import { isOwnedLiveCredentialSqliteDatabase } from "./credentials.js";

const ownedSqliteAcquisitionJournals = new WeakSet<object>();
const workflowProofWriteScopes = new WeakMap<SqliteDatabase, Set<string>>();
const WORKFLOW_PROOF_AUTHORIZATION_FUNCTION = "peas_acquisition_workflow_proof_authorized";
const rawSqliteFunction = Database.prototype.function as unknown as (
  this: SqliteDatabase,
  name: string,
  options: Readonly<{ deterministic: boolean }>,
  implementation: (journalId: unknown) => number,
) => SqliteDatabase;

Object.defineProperty(Database.prototype, "function", {
  configurable: false,
  enumerable: false,
  writable: false,
  value(this: SqliteDatabase, name: string, ...args: readonly unknown[]): SqliteDatabase {
    if (name === WORKFLOW_PROOF_AUTHORIZATION_FUNCTION) {
      throw new TypeError("reserved-sqlite-function-registration-denied");
    }
    return Reflect.apply(
      rawSqliteFunction as (...values: readonly unknown[]) => SqliteDatabase,
      this,
      [name, ...args],
    );
  },
});

function workflowProofScope(database: SqliteDatabase): Set<string> {
  const existing = workflowProofWriteScopes.get(database);
  if (existing !== undefined) return existing;
  const scope = new Set<string>();
  rawSqliteFunction.call(
    database,
    WORKFLOW_PROOF_AUTHORIZATION_FUNCTION,
    { deterministic: false },
    (journalId: unknown) => (typeof journalId === "string" && scope.has(journalId) ? 1 : 0),
  );
  workflowProofWriteScopes.set(database, scope);
  return scope;
}

type JournalRow = Readonly<{
  journal_sequence: bigint;
  entry_json: string;
}>;

const JOURNAL_ENTRY_LIMITS = Object.freeze({
  maxDepth: 8,
  maxNodes: 512,
  maxArrayLength: 64,
  maxObjectKeys: 64,
  maxStringBytes: 8 * 1024,
  maxCanonicalBytes: 256 * 1024,
}) satisfies JsonLimits;

/**
 * The acquisition journal owns this additive private table. It does not alter migration 005,
 * ArtifactStore, or any vault row. All rows and the schema are append-only.
 */
export function installSqliteAcquisitionJournalSchema(database: SqliteDatabase): void {
  workflowProofScope(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS market_acquisition_journal_entries (
      market_acquisition_journal_id TEXT NOT NULL,
      journal_sequence INTEGER NOT NULL CHECK (journal_sequence >= 0),
      prior_journal_entry_hash TEXT NOT NULL,
      journal_entry_hash TEXT NOT NULL UNIQUE,
      checkpoint_kind TEXT NOT NULL,
      entry_json TEXT NOT NULL,
      PRIMARY KEY (market_acquisition_journal_id, journal_sequence)
    ) STRICT;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_journal_entries_no_update
    BEFORE UPDATE ON market_acquisition_journal_entries
    BEGIN
      SELECT RAISE(ABORT, 'market acquisition journal is immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_journal_entries_no_delete
    BEFORE DELETE ON market_acquisition_journal_entries
    BEGIN
      SELECT RAISE(ABORT, 'market acquisition journal is immutable');
    END;

    CREATE TABLE IF NOT EXISTS market_acquisition_ledger_entries (
      market_acquisition_journal_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      ledger_sequence INTEGER NOT NULL CHECK (ledger_sequence >= 0),
      entry_id TEXT NOT NULL,
      entry_json TEXT NOT NULL,
      entry_hash TEXT NOT NULL,
      PRIMARY KEY (market_acquisition_journal_id, ledger_sequence),
      UNIQUE (market_acquisition_journal_id, entry_id)
    ) STRICT;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_ledger_entries_no_update
    BEFORE UPDATE ON market_acquisition_ledger_entries
    BEGIN SELECT RAISE(ABORT, 'market acquisition ledger is immutable'); END;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_ledger_entries_no_delete
    BEFORE DELETE ON market_acquisition_ledger_entries
    BEGIN SELECT RAISE(ABORT, 'market acquisition ledger is immutable'); END;

    CREATE TABLE IF NOT EXISTS market_acquisition_workflow_journal_proofs (
      market_acquisition_journal_id TEXT NOT NULL,
      journal_entry_hash TEXT NOT NULL,
      PRIMARY KEY (market_acquisition_journal_id, journal_entry_hash)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS market_acquisition_workflow_ledger_proofs (
      market_acquisition_journal_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      PRIMARY KEY (market_acquisition_journal_id, entry_id)
    ) STRICT;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_workflow_journal_proofs_owned_insert
    BEFORE INSERT ON market_acquisition_workflow_journal_proofs
    WHEN peas_acquisition_workflow_proof_authorized(NEW.market_acquisition_journal_id) <> 1
    BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof write denied'); END;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_workflow_journal_entries_owned_insert
    BEFORE INSERT ON market_acquisition_journal_entries
    WHEN NEW.checkpoint_kind <> 'attempt-started'
      AND peas_acquisition_workflow_proof_authorized(NEW.market_acquisition_journal_id) <> 1
    BEGIN SELECT RAISE(ABORT, 'acquisition workflow journal write denied'); END;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_workflow_ledger_entries_owned_insert
    BEFORE INSERT ON market_acquisition_ledger_entries
    WHEN peas_acquisition_workflow_proof_authorized(NEW.market_acquisition_journal_id) <> 1
    BEGIN SELECT RAISE(ABORT, 'acquisition workflow ledger write denied'); END;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_workflow_ledger_proofs_owned_insert
    BEFORE INSERT ON market_acquisition_workflow_ledger_proofs
    WHEN peas_acquisition_workflow_proof_authorized(NEW.market_acquisition_journal_id) <> 1
    BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof write denied'); END;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_workflow_journal_proofs_no_update
    BEFORE UPDATE ON market_acquisition_workflow_journal_proofs
    BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof is immutable'); END;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_workflow_journal_proofs_no_delete
    BEFORE DELETE ON market_acquisition_workflow_journal_proofs
    BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof is immutable'); END;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_workflow_ledger_proofs_no_update
    BEFORE UPDATE ON market_acquisition_workflow_ledger_proofs
    BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof is immutable'); END;

    CREATE TRIGGER IF NOT EXISTS market_acquisition_workflow_ledger_proofs_no_delete
    BEFORE DELETE ON market_acquisition_workflow_ledger_proofs
    BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof is immutable'); END;
  `);
}

function parseEntry(serialized: string): JournalEntry {
  const parsed = parseJsonWithinLimits(serialized, JOURNAL_ENTRY_LIMITS, "acquisition journal");
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("journal-entry-shape-invalid");
  }
  return parsed as unknown as JournalEntry;
}

export class SqliteAcquisitionJournal implements AcquisitionJournal {
  readonly #database: SqliteDatabase;
  readonly #expectedIdentity: JournalIdentityInput;
  readonly #journalId: string;

  constructor(database: SqliteDatabase, expectedIdentity: JournalIdentityInput) {
    this.#database = database;
    this.#expectedIdentity = Object.freeze({ ...expectedIdentity });
    this.#journalId = deriveMarketAcquisitionJournalId(this.#expectedIdentity);
    installSqliteAcquisitionJournalSchema(database);
  }

  async load(marketAcquisitionJournalId: string): Promise<readonly JournalEntry[]> {
    if (marketAcquisitionJournalId !== this.#journalId) {
      throw new TypeError("journal-identity-mismatch");
    }
    const rows = this.#database
      .prepare(
        `SELECT journal_sequence, entry_json
         FROM market_acquisition_journal_entries
         WHERE market_acquisition_journal_id = ?
         ORDER BY journal_sequence`,
      )
      .all(this.#journalId) as JournalRow[];
    const entries = rows.map((row, index) => {
      if (row.journal_sequence !== BigInt(index)) throw new TypeError("journal-sequence-gap");
      return parseEntry(row.entry_json);
    });
    if (entries.length > 0) validateJournalEntries(entries, this.#expectedIdentity);
    return Object.freeze(entries);
  }

  async append(entry: JournalEntry, workflowAuthority?: object): Promise<void> {
    assertAcquisitionWorkflowProducerAuthority(workflowAuthority);
    const entryJson = canonicalJson(entry as unknown as JsonValue);
    assertJsonWithinLimits(entry as unknown as JsonValue, JOURNAL_ENTRY_LIMITS);
    const proofScope = workflowProofScope(this.#database);
    if (proofScope.has(this.#journalId)) throw new TypeError("workflow-proof-write-reentrant");
    proofScope.add(this.#journalId);
    try {
      this.#database
        .transaction(() => {
          const rows = this.#database
            .prepare(
              `SELECT journal_sequence, entry_json
             FROM market_acquisition_journal_entries
             WHERE market_acquisition_journal_id = ?
             ORDER BY journal_sequence`,
            )
            .all(this.#journalId) as JournalRow[];
          const current = rows.map((row, index) => {
            if (row.journal_sequence !== BigInt(index)) throw new TypeError("journal-sequence-gap");
            return parseEntry(row.entry_json);
          });
          const prospective = [...current, parseEntry(entryJson)];
          validateJournalEntries(prospective, this.#expectedIdentity);
          this.#database
            .prepare(
              `INSERT INTO market_acquisition_journal_entries (
              market_acquisition_journal_id,
              journal_sequence,
              prior_journal_entry_hash,
              journal_entry_hash,
              checkpoint_kind,
              entry_json
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              this.#journalId,
              BigInt(entry.journalSequence),
              entry.priorJournalEntryHash,
              entry.journalEntryHash,
              entry.checkpointKind,
              entryJson,
            );
          this.#database
            .prepare(`INSERT INTO market_acquisition_workflow_journal_proofs
            (market_acquisition_journal_id, journal_entry_hash) VALUES (?, ?)`)
            .run(this.#journalId, entry.journalEntryHash);
        })
        .immediate();
    } finally {
      proofScope.delete(this.#journalId);
    }
  }

  async claimAttemptStarted(
    expectedRequestStartedHash: string,
    entry: JournalEntry,
  ): Promise<boolean> {
    if (P1_10_TEST_AUTHORITY === undefined) {
      throw new TypeError("owned-attempt-claim-required");
    }
    if (entry.checkpointKind !== "attempt-started") return false;
    const entryJson = canonicalJson(entry as unknown as JsonValue);
    assertJsonWithinLimits(entry as unknown as JsonValue, JOURNAL_ENTRY_LIMITS);
    return this.#database
      .transaction(() => {
        const rows = this.#database
          .prepare(
            `SELECT journal_sequence, entry_json
             FROM market_acquisition_journal_entries
             WHERE market_acquisition_journal_id = ?
             ORDER BY journal_sequence`,
          )
          .all(this.#journalId) as JournalRow[];
        const current = rows.map((row, index) => {
          if (row.journal_sequence !== BigInt(index)) throw new TypeError("journal-sequence-gap");
          return parseEntry(row.entry_json);
        });
        const latest = current.at(-1);
        if (
          latest?.checkpointKind !== "request-started" ||
          latest.journalEntryHash !== expectedRequestStartedHash
        ) {
          return false;
        }
        const claimed = parseEntry(entryJson);
        validateJournalEntries([...current, claimed], this.#expectedIdentity);
        this.#database
          .prepare(
            `INSERT INTO market_acquisition_journal_entries (
              market_acquisition_journal_id,
              journal_sequence,
              prior_journal_entry_hash,
              journal_entry_hash,
              checkpoint_kind,
              entry_json
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.#journalId,
            BigInt(entry.journalSequence),
            entry.priorJournalEntryHash,
            entry.journalEntryHash,
            entry.checkpointKind,
            entryJson,
          );
        return true;
      })
      .immediate();
  }

  async appendLedgerEntries(
    entries: readonly ObservationLedgerEntryV1[],
    workflowAuthority?: object,
  ): Promise<void> {
    assertAcquisitionWorkflowProducerAuthority(workflowAuthority);
    const validated = validateObservationLedgerBundle(entries);
    const proofScope = workflowProofScope(this.#database);
    if (proofScope.has(this.#journalId)) throw new TypeError("workflow-proof-write-reentrant");
    proofScope.add(this.#journalId);
    const executionId = validated[0]?.executionId;
    if (executionId === undefined) throw new TypeError("ledger-empty");
    try {
      this.#database
        .transaction(() => {
          const rows = this.#database
            .prepare(`SELECT ledger_sequence, entry_json FROM market_acquisition_ledger_entries
            WHERE market_acquisition_journal_id = ? AND execution_id = ? ORDER BY ledger_sequence`)
            .all(this.#journalId, executionId) as Array<{
            ledger_sequence: bigint;
            entry_json: string;
          }>;
          if (rows.length > validated.length) throw new TypeError("ledger-prefix-conflict");
          for (const [index, row] of rows.entries()) {
            if (
              row.ledger_sequence !== BigInt(index) ||
              row.entry_json !== canonicalJson(validated[index] as unknown as JsonValue)
            ) {
              throw new TypeError("ledger-prefix-conflict");
            }
          }
          const insert = this.#database.prepare(`INSERT INTO market_acquisition_ledger_entries
          (market_acquisition_journal_id, execution_id, ledger_sequence, entry_id, entry_json, entry_hash)
          VALUES (?, ?, ?, ?, ?, ?)`);
          for (let index = rows.length; index < validated.length; index += 1) {
            const entry = validated[index] as ObservationLedgerEntryV1;
            insert.run(
              this.#journalId,
              executionId,
              BigInt(index),
              entry.entryId,
              canonicalJson(entry as unknown as JsonValue),
              entry.entryHash,
            );
            this.#database
              .prepare(`INSERT INTO market_acquisition_workflow_ledger_proofs
              (market_acquisition_journal_id, entry_id) VALUES (?, ?)`)
              .run(this.#journalId, entry.entryId);
          }
        })
        .immediate();
    } finally {
      proofScope.delete(this.#journalId);
    }
  }

  async loadLedgerEntries(): Promise<readonly ObservationLedgerEntryV1[]> {
    const rows = this.#database
      .prepare(
        `SELECT entry_json FROM market_acquisition_ledger_entries
         WHERE market_acquisition_journal_id = ? ORDER BY ledger_sequence`,
      )
      .all(this.#journalId) as Array<{ entry_json: string }>;
    if (rows.length === 0) return Object.freeze([]);
    return Object.freeze(
      validateObservationLedgerBundle(
        rows.map((row) => JSON.parse(row.entry_json) as ObservationLedgerEntryV1),
      ),
    );
  }

  async isWorkflowProducedJournalEntry(journalEntryHash: string): Promise<boolean> {
    return (
      this.#database
        .prepare(`SELECT 1 present FROM market_acquisition_workflow_journal_proofs
          WHERE market_acquisition_journal_id = ? AND journal_entry_hash = ?`)
        .get(this.#journalId, journalEntryHash) !== undefined
    );
  }

  async isWorkflowProducedLedgerEntry(entryId: string): Promise<boolean> {
    return (
      this.#database
        .prepare(`SELECT 1 present FROM market_acquisition_workflow_ledger_proofs
          WHERE market_acquisition_journal_id = ? AND entry_id = ?`)
        .get(this.#journalId, entryId) !== undefined
    );
  }
}

export function createSqliteAcquisitionJournal(
  database: SqliteDatabase,
  expectedIdentity: JournalIdentityInput,
): SqliteAcquisitionJournal {
  try {
    assertOwnedSqliteDatabase(database);
  } catch (error) {
    if (!isOwnedLiveCredentialSqliteDatabase(database)) throw error;
  }
  const journal = new SqliteAcquisitionJournal(database, expectedIdentity);
  ownedSqliteAcquisitionJournals.add(journal);
  Object.freeze(journal);
  return journal;
}

export function isOwnedSqliteAcquisitionJournal(value: object): boolean {
  return (
    ownedSqliteAcquisitionJournals.has(value) &&
    Object.getPrototypeOf(value) === SqliteAcquisitionJournal.prototype &&
    Object.isFrozen(value) &&
    Reflect.ownKeys(value).length === 0
  );
}

Object.freeze(SqliteAcquisitionJournal.prototype);
