import { P1_10_TEST_AUTHORITY } from "../../internal-test-authority.js";
import { canonicalJson, type JsonValue } from "../../core/json.js";
import {
  validateObservationLedgerBundle,
  type ObservationLedgerEntryV1,
} from "../../providers/observation-ledger.js";
import {
  type AcquisitionJournal,
  type JournalEntry,
  type JournalIdentityInput,
  deriveMarketAcquisitionJournalId,
  assertAcquisitionWorkflowProducerAuthority,
  validateJournalEntries,
} from "./journal.js";

const ownedMemoryAcquisitionJournals = new WeakSet<object>();

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
  readonly #ledgerEntries: ObservationLedgerEntryV1[] = [];
  readonly #producedJournalEntries = new Set<string>();
  readonly #producedLedgerEntries = new Set<string>();

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

  async append(entry: JournalEntry, workflowAuthority?: object): Promise<void> {
    assertAcquisitionWorkflowProducerAuthority(workflowAuthority);
    if (entry.marketAcquisitionJournalId !== this.#journalId) {
      throw new TypeError("journal-identity-mismatch");
    }
    const prospective = [...this.#entries, cloneEntry(entry)];
    validateJournalEntries(prospective, this.#expectedIdentity);
    this.#entries.push(prospective.at(-1) as JournalEntry);
    this.#producedJournalEntries.add(entry.journalEntryHash);
  }

  async claimAttemptStarted(
    expectedRequestStartedHash: string,
    entry: JournalEntry,
  ): Promise<boolean> {
    if (P1_10_TEST_AUTHORITY === undefined) {
      throw new TypeError("owned-attempt-claim-required");
    }
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

  async appendLedgerEntries(
    entries: readonly ObservationLedgerEntryV1[],
    workflowAuthority?: object,
  ): Promise<void> {
    assertAcquisitionWorkflowProducerAuthority(workflowAuthority);
    const prospective = validateObservationLedgerBundle(entries);
    if (this.#ledgerEntries.length > prospective.length)
      throw new TypeError("ledger-prefix-conflict");
    for (const [index, existing] of this.#ledgerEntries.entries()) {
      if (
        canonicalJson(existing as unknown as JsonValue) !==
        canonicalJson(prospective[index] as unknown as JsonValue)
      ) {
        throw new TypeError("ledger-prefix-conflict");
      }
    }
    for (const entry of prospective.slice(this.#ledgerEntries.length)) {
      this.#ledgerEntries.push(
        JSON.parse(canonicalJson(entry as unknown as JsonValue)) as ObservationLedgerEntryV1,
      );
      this.#producedLedgerEntries.add(entry.entryId);
    }
  }

  async isWorkflowProducedJournalEntry(journalEntryHash: string): Promise<boolean> {
    return this.#producedJournalEntries.has(journalEntryHash);
  }

  async isWorkflowProducedLedgerEntry(entryId: string): Promise<boolean> {
    return this.#producedLedgerEntries.has(entryId);
  }

  async loadLedgerEntries(): Promise<readonly ObservationLedgerEntryV1[]> {
    if (this.#ledgerEntries.length === 0) return Object.freeze([]);
    return Object.freeze(
      validateObservationLedgerBundle(this.#ledgerEntries).map(
        (entry) =>
          JSON.parse(canonicalJson(entry as unknown as JsonValue)) as ObservationLedgerEntryV1,
      ),
    );
  }
}

export function createMemoryAcquisitionJournal(
  expectedIdentity: JournalIdentityInput,
): MemoryAcquisitionJournal {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-memory-acquisition-journal-unavailable");
  }
  const journal = new MemoryAcquisitionJournal(expectedIdentity);
  ownedMemoryAcquisitionJournals.add(journal);
  Object.freeze(journal);
  return journal;
}

Object.freeze(MemoryAcquisitionJournal.prototype);

export function isOwnedMemoryAcquisitionJournal(value: object): boolean {
  return (
    ownedMemoryAcquisitionJournals.has(value) &&
    Object.getPrototypeOf(value) === MemoryAcquisitionJournal.prototype &&
    Object.isFrozen(value) &&
    Reflect.ownKeys(value).length === 0
  );
}
