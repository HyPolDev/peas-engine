import {
  assertJsonWithinLimits,
  canonicalJson,
  parseJsonWithinLimits,
  type JsonLimits,
  type JsonValue,
} from "../../core/json.js";
import type { SqliteDatabase } from "../sqlite/database.js";
import {
  type AcquisitionJournal,
  type JournalEntry,
  type JournalIdentityInput,
  deriveMarketAcquisitionJournalId,
  validateJournalEntries,
} from "./journal.js";

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
}
