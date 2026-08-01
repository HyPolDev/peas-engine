import { canonicalJson, type JsonValue } from "../../core/json.js";
import {
  type AcquisitionJournal,
  type JournalEntry,
  type JournalIdentityInput,
  deriveMarketAcquisitionJournalId,
  validateJournalEntries,
} from "./journal.js";

function cloneEntry(entry: JournalEntry): JournalEntry {
  return JSON.parse(canonicalJson(entry as unknown as JsonValue)) as JournalEntry;
}

/**
 * Test/offline journal with the same append-only and validation semantics as the SQLite backend.
 * It deliberately stores canonical snapshots rather than caller object references.
 */
export class MemoryAcquisitionJournal implements AcquisitionJournal {
  readonly #expectedIdentity: JournalIdentityInput;
  readonly #journalId: string;
  readonly #entries: JournalEntry[] = [];

  constructor(expectedIdentity: JournalIdentityInput) {
    this.#expectedIdentity = Object.freeze({ ...expectedIdentity });
    this.#journalId = deriveMarketAcquisitionJournalId(this.#expectedIdentity);
  }

  async load(marketAcquisitionJournalId: string): Promise<readonly JournalEntry[]> {
    if (marketAcquisitionJournalId !== this.#journalId) {
      throw new TypeError("journal-identity-mismatch");
    }
    if (this.#entries.length > 0) {
      validateJournalEntries(this.#entries, this.#expectedIdentity);
    }
    return Object.freeze(this.#entries.map(cloneEntry));
  }

  async append(entry: JournalEntry): Promise<void> {
    if (entry.marketAcquisitionJournalId !== this.#journalId) {
      throw new TypeError("journal-identity-mismatch");
    }
    const prospective = [...this.#entries, cloneEntry(entry)];
    validateJournalEntries(prospective, this.#expectedIdentity);
    this.#entries.push(prospective.at(-1) as JournalEntry);
  }

  async claimAttemptStarted(
    expectedRequestStartedHash: string,
    entry: JournalEntry,
  ): Promise<boolean> {
    const latest = this.#entries.at(-1);
    if (
      latest?.checkpointKind !== "request-started" ||
      latest.journalEntryHash !== expectedRequestStartedHash ||
      entry.checkpointKind !== "attempt-started"
    ) {
      return false;
    }
    const prospective = [...this.#entries, cloneEntry(entry)];
    validateJournalEntries(prospective, this.#expectedIdentity);
    this.#entries.push(prospective.at(-1) as JournalEntry);
    return true;
  }
}
