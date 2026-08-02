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
import type { SqliteDatabase } from "../sqlite/database.js";
import {
  type AcquisitionJournal,
  type JournalEntry,
  type JournalIdentityInput,
  deriveMarketAcquisitionJournalId,
  validateJournalEntries,
} from "./journal.js";

const ownedSqliteAcquisitionJournals = new WeakSet<object>();

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

  async append(entry: JournalEntry): Promise<void> {
    const entryJson = canonicalJson(entry as unknown as JsonValue);
    assertJsonWithinLimits(entry as unknown as JsonValue, JOURNAL_ENTRY_LIMITS);
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
      })
      .immediate();
  }

  async claimAttemptStarted(
    expectedRequestStartedHash: string,
    entry: JournalEntry,
  ): Promise<boolean> {
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

  async appendLedgerEntries(entries: readonly ObservationLedgerEntryV1[]): Promise<void> {
    const validated = validateObservationLedgerBundle(entries);
    const executionId = validated[0]?.executionId;
    if (executionId === undefined) throw new TypeError("ledger-empty");
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
        }
      })
      .immediate();
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
}

export function createSqliteAcquisitionJournal(
  database: SqliteDatabase,
  expectedIdentity: JournalIdentityInput,
): SqliteAcquisitionJournal {
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
