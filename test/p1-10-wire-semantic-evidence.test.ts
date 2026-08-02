import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  DurableAlpacaWireAdmissionBoundary,
  createTestDurableAlpacaWireAdmissionBoundary,
} from "../src/adapters/market-acquisition/alpaca/wire.js";
import {
  MemoryAlpacaWireSemanticEvidenceStore,
  appendTestAlpacaWireSemanticEvidence,
  createSqliteAlpacaWireSemanticEvidenceStore,
  deriveAlpacaWireSemanticEvidenceId,
  type AlpacaWireSemanticEvidenceDraft,
} from "../src/adapters/market-acquisition/alpaca/wire-semantic-evidence.js";
import {
  MemoryAcquisitionJournal,
  createMemoryAcquisitionJournal,
} from "../src/adapters/market-acquisition/memory-journal.js";
import { createSqliteAcquisitionJournal } from "../src/adapters/market-acquisition/sqlite-journal.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const hash = (nibble: string): string => nibble.repeat(64);

function identity() {
  return Object.freeze({
    schemaVersion: 1 as const,
    requestIdentityHash: hash("1"),
    providerId: `mpv1_${hash("2")}`,
    datasetId: `mds1_${hash("3")}`,
    feedId: `mfd1_${hash("4")}`,
    endpointChannelId: `mec1_${hash("5")}`,
  });
}

function evidenceDraft(): AlpacaWireSemanticEvidenceDraft {
  return Object.freeze({
    schemaVersion: 1,
    journalEntryHash: hash("6"),
    marketAcquisitionJournalId: hash("7"),
    artifactObservationId: hash("8"),
    artifactObservationHash: hash("9"),
    artifactDigest: hash("a"),
    artifactSizeBytes: 37,
    stageLedgerFactId: `ole1_${hash("b")}`,
    clockDeclarationFactId: `ole1_${hash("c")}`,
    semanticAuthorityId: `wsa1_${hash("0")}`,
    semanticAuthorityStageLedgerFactId: `ole1_${hash("1")}`,
    semanticAuthorityObservationId: hash("2"),
    semanticAuthorityObservationHash: hash("3"),
    semanticAuthorityDigest: hash("4"),
    semanticAuthoritySizeBytes: 128,
    calendarDigest: hash("5"),
    corpusAdmissionHash: hash("6"),
    calendarEntries: Object.freeze([
      Object.freeze({
        sessionDate: "2033-05-06",
        timeZone: "America/New_York" as const,
        utcOffsetMinutes: -240 as const,
        calendarVersion: "peas-original-synthetic-calendar-v1",
        holiday: false,
        extendedOpenNs: "1998976380000000000",
        regularOpenNs: "1998990000000000000",
        regularCloseNs: "1999013400000000000",
        extendedCloseNs: "1999027800000000000",
      }),
    ]),
    calendarVersion: "peas-original-synthetic-calendar-v1",
    durableClockBasisId: `clk1_${hash("d")}`,
    durablyRecordedAtMs: 1_998_976_380_000,
    durableLogicalAtMs: 1_998_976_380_001,
    primaryCorpusMember: true,
  });
}

test("wire semantic evidence is exact, immutable, and restart-identical in memory and SQLite", async (t) => {
  const draft = evidenceDraft();
  const value = Object.freeze({
    ...draft,
    evidenceId: deriveAlpacaWireSemanticEvidenceId(draft),
  });
  const memory = new MemoryAlpacaWireSemanticEvidenceStore();
  appendTestAlpacaWireSemanticEvidence(memory, value);
  appendTestAlpacaWireSemanticEvidence(memory, value);
  assert.deepEqual(memory.loadForJournalEntry(value.journalEntryHash), value);
  assert.throws(() =>
    appendTestAlpacaWireSemanticEvidence(memory, {
      ...value,
      primaryCorpusMember: false,
    } as typeof value),
  );

  const directory = await mkdtemp(join(tmpdir(), "peas-wire-semantics-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "wire.sqlite");
  let database = openSqliteDatabase(filename, migrations);
  appendTestAlpacaWireSemanticEvidence(
    createSqliteAlpacaWireSemanticEvidenceStore(database),
    value,
  );
  database.close();
  database = openSqliteDatabase(filename, migrations);
  const restarted = createSqliteAlpacaWireSemanticEvidenceStore(database);
  assert.deepEqual(restarted.loadForJournalEntry(value.journalEntryHash), value);
  const substitutedDraft = Object.freeze({
    ...draft,
    calendarVersion: "peas-original-synthetic-alternate-calendar-v1",
    calendarEntries: Object.freeze(
      draft.calendarEntries.map((entry) =>
        Object.freeze({
          ...entry,
          calendarVersion: "peas-original-synthetic-alternate-calendar-v1",
        }),
      ),
    ),
    primaryCorpusMember: false,
  });
  assert.throws(
    () =>
      appendTestAlpacaWireSemanticEvidence(
        restarted,
        Object.freeze({
          ...substitutedDraft,
          evidenceId: deriveAlpacaWireSemanticEvidenceId(substitutedDraft),
        }),
      ),
    /wire-semantic-evidence-conflict/u,
  );
  assert.doesNotThrow(() =>
    createTestDurableAlpacaWireAdmissionBoundary(
      createSqliteAcquisitionJournal(database, identity()),
      restarted,
    ),
  );
  assert.throws(() =>
    database
      .prepare("UPDATE market_acquisition_wire_semantic_evidence SET evidence_hash = ?")
      .run(hash("e")),
  );
  assert.throws(() =>
    database.prepare("DELETE FROM market_acquisition_wire_semantic_evidence").run(),
  );
  database.close();
});

test("wire authority rejects structural, subclassed, proxied, and direct roots", async () => {
  const journal = createMemoryAcquisitionJournal(identity());
  const evidence = new MemoryAlpacaWireSemanticEvidenceStore();
  class JournalSubclass extends MemoryAcquisitionJournal {}
  class EvidenceSubclass extends MemoryAlpacaWireSemanticEvidenceStore {}
  await assert.rejects(
    () => new DurableAlpacaWireAdmissionBoundary(journal, evidence).issue({} as never),
    /owned-durable-wire-admission-boundary-required/u,
  );

  for (const hostileJournal of [
    {} as never,
    new JournalSubclass(identity()),
    new Proxy(journal, {}),
  ]) {
    assert.throws(
      () => new DurableAlpacaWireAdmissionBoundary(hostileJournal, evidence),
      /owned-acquisition-journal-required/u,
    );
  }
  for (const hostileEvidence of [{} as never, new EvidenceSubclass(), new Proxy(evidence, {})]) {
    assert.throws(
      () => new DurableAlpacaWireAdmissionBoundary(journal, hostileEvidence),
      /owned-wire-semantic-evidence-store-required/u,
    );
  }
  const trusted = createTestDurableAlpacaWireAdmissionBoundary(journal, evidence);
  class AdmissionBoundarySubclass extends DurableAlpacaWireAdmissionBoundary {}
  await assert.rejects(
    () => new AdmissionBoundarySubclass(journal, evidence).issue({} as never),
    /owned-durable-wire-admission-boundary-required/u,
  );
  await assert.rejects(
    () => new Proxy(trusted, {}).issue({} as never),
    /owned-durable-wire-admission-boundary-required/u,
  );
});
