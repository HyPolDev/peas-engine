import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import type { ArtifactStore } from "../src/artifacts/artifact-store.js";
import { canonicalHash } from "../src/core/hash.js";
import { openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import {
  MarketAcquisitionLedger,
  decideAcquisitionRestart,
  validateJournalLedgerBindings,
} from "../src/adapters/market-acquisition/artifact-integration.js";
import { deriveAcquisitionObservationId } from "../src/providers/observation-ledger.js";
import {
  GENESIS_HASH,
  NO_TOKEN_HASH,
  TERMINAL_TOKEN_HASH,
  type JournalCheckpointBody,
  type JournalEntry,
  createJournalEntry,
  deriveLogicalPageIdentityHash,
  deriveMarketAcquisitionJournalId,
  journalEntryBody,
  appendTestAcquisitionJournalEntry,
} from "../src/adapters/market-acquisition/journal.js";
import { MemoryAcquisitionJournal } from "../src/adapters/market-acquisition/memory-journal.js";
import { canonicalJournalProjection } from "../src/adapters/market-acquisition/replay.js";
import { SqliteAcquisitionJournal } from "../src/adapters/market-acquisition/sqlite-journal.js";
import { retentionGuardedArtifactStore } from "./p1-10-repair-fixtures.js";

const hash = (member: string): string =>
  canonicalHash("peas/p1-10-persistence-equivalence-test/v1", { member });
const prefixed = (prefix: string, member: string): string => `${prefix}${hash(member)}`;
const REQUEST_HASH = hash("request");
const CONFIGURATION_HASH = hash("configuration");
const artifactBytes = Buffer.from('{"synthetic":"checkpoint-artifact"}', "utf8");
const artifactDigest = createHash("sha256").update(artifactBytes).digest("hex");
const artifactObservationId = hash("artifact-observation");
const artifactObservationHash = hash("artifact-observation-hash");
const retrievalAttemptId = prefixed("rat1_", "attempt");
const acquisitionObservationId = deriveAcquisitionObservationId({
  provider: "alpaca",
  retrievalAttemptId,
  sanitizedRequestIdentityHash: REQUEST_HASH,
  routeLabel: "alpaca-v2-historical-quotes",
});

const identity = {
  schemaVersion: 1,
  requestIdentityHash: REQUEST_HASH,
  providerId: prefixed("mpv1_", "provider"),
  datasetId: prefixed("mds1_", "dataset"),
  feedId: prefixed("mfd1_", "feed"),
  endpointChannelId: prefixed("mec1_", "channel"),
} as const;
const journalId = deriveMarketAcquisitionJournalId(identity);

function body(overrides: Partial<JournalCheckpointBody> = {}): JournalCheckpointBody {
  return {
    schemaVersion: 1,
    runSessionNonce: "offline-run-session-v1",
    acquisitionObservationId,
    marketAcquisitionId: prefixed("maq1_", "market-acquisition"),
    admittedMarketAcquisitionIds: [],
    requestIdentityHash: REQUEST_HASH,
    acquisitionConfigurationHash: CONFIGURATION_HASH,
    providerId: identity.providerId,
    datasetId: identity.datasetId,
    feedId: identity.feedId,
    endpointChannelId: identity.endpointChannelId,
    authorizationMode: "p1-09-approved",
    logicalPageIdentityHash: deriveLogicalPageIdentityHash({
      requestIdentityHash: REQUEST_HASH,
      pageOrdinal: 0,
      currentTokenHash: NO_TOKEN_HASH,
    }),
    pageOrdinal: 0,
    currentTokenHash: NO_TOKEN_HASH,
    currentResumableTokenMaterial: null,
    nextTokenHash: null,
    nextResumableTokenMaterial: null,
    currentContinuationBindingHash: null,
    nextContinuationBindingHash: null,
    attemptId: prefixed("mat1_", "attempt"),
    retrievalAttemptId,
    attemptOrdinal: 0,
    artifactObservationId: null,
    artifactDigest: null,
    artifactSizeBytes: null,
    artifactObservationHash: null,
    artifactContentId: null,
    rawArtifactId: null,
    stageLedgerFactId: null,
    causalParentFactIds: [],
    pageRecordCount: null,
    pageNormalizedFactCount: null,
    pageChainHash: GENESIS_HASH,
    cumulativeSuccessfulPages: 0,
    cumulativeVerifiedBytes: 0,
    cumulativeRecords: 0,
    cumulativeNormalizedFacts: 0,
    cumulativeAttempts: 0,
    acquisitionDeadlineBasis: "offline-monotonic-basis-v1",
    quotaWindowEvidence: [],
    terminalState: null,
    terminalReasonCode: null,
    incomplete: true,
    ...overrides,
  };
}

function ledgerHistory() {
  const ledger = new MarketAcquisitionLedger("p1-10-persistence-ledger-v1", {
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorMs: 0,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: "p1-10-persistence-session-v1",
  });
  const stamp = (offset: number) => ({
    clockBasisId: ledger.clockBasis.clockBasisId,
    wallTimeMs: 1_000 + offset,
    monotonicTimeUs: 10_000 + offset,
  });
  const acquisition = ledger.declareAcquisition(
    {
      kind: "acquisition.declared",
      acquisitionObservationId,
      provider: "alpaca",
      retrievalAttemptId,
      sanitizedRequestIdentityHash: REQUEST_HASH,
      routeLabel: "alpaca-v2-historical-quotes",
    },
    stamp(0),
  );
  const started = ledger.requestStarted(
    acquisition,
    { kind: "request.started", acquisitionObservationId },
    stamp(1),
  );
  const succeeded = ledger.requestSucceeded(
    started,
    {
      kind: "request.succeeded",
      acquisitionObservationId,
      safeResponseMetadataHash: hash("response-metadata"),
    },
    stamp(2),
  );
  const committed = ledger.artifactCommitted(
    acquisition,
    succeeded,
    {
      kind: "artifact.committed",
      acquisitionObservationId,
      vaultObservationId: artifactObservationId,
      vaultObservationHash: artifactObservationHash,
      artifactDigest,
      sizeBytes: artifactBytes.byteLength,
      acquisitionMode: "live",
      retrievedAtMs: 1_003,
    },
    stamp(3),
  );
  ledger.artifactVerified(
    committed,
    {
      kind: "artifact.verified",
      acquisitionObservationId,
      vaultObservationId: artifactObservationId,
      artifactDigest,
      metadataSizeBytes: artifactBytes.byteLength,
      consumedSizeBytes: artifactBytes.byteLength,
    },
    stamp(4),
  );
  return ledger;
}

function history(): Readonly<{
  rows: readonly JournalEntry[];
  ledger: Readonly<ReturnType<MarketAcquisitionLedger["entries"]["slice"]>>;
}> {
  const ledger = ledgerHistory();
  const stages = ledger.entries.slice(1);
  const rows: JournalEntry[] = [];
  let stageIndex = 0;
  const append = (
    kind: Parameters<typeof createJournalEntry>[2],
    checkpoint: JournalCheckpointBody,
  ): void => {
    const stage =
      kind === "page-checkpointed" || kind === "attempt-started" ? null : stages[stageIndex++];
    const evidence =
      stage === null || stage === undefined
        ? { ...checkpoint, stageLedgerFactId: null, causalParentFactIds: [] }
        : {
            ...checkpoint,
            stageLedgerFactId: stage.entryId,
            causalParentFactIds: stage.parentEntryIds.filter(
              (parent) => parent !== ledger.clockDeclaration.entryId,
            ),
          };
    rows.push(createJournalEntry(rows.at(-1) ?? null, journalId, kind, evidence));
  };
  append("acquisition-declared", body());
  append("request-started", body());
  append("attempt-started", body({ cumulativeAttempts: 1, quotaWindowEvidence: [1_000] }));
  append("request-succeeded", body({ cumulativeAttempts: 1, quotaWindowEvidence: [1_000] }));
  const artifact = {
    artifactObservationId,
    artifactDigest,
    artifactSizeBytes: artifactBytes.byteLength,
    artifactObservationHash,
    artifactContentId: prefixed("mac1_", "content"),
    rawArtifactId: prefixed("mar1_", "raw"),
    cumulativeAttempts: 1,
    quotaWindowEvidence: [1_000],
  } as const;
  append("artifact-committed", body(artifact));
  append("artifact-verified", body({ ...artifact, pageRecordCount: 2 }));
  append(
    "page-checkpointed",
    body({
      ...artifact,
      admittedMarketAcquisitionIds: [prefixed("maq1_", "market-acquisition")],
      nextTokenHash: TERMINAL_TOKEN_HASH,
      pageRecordCount: 2,
      pageChainHash: hash("page-chain"),
      cumulativeSuccessfulPages: 1,
      cumulativeVerifiedBytes: artifactBytes.byteLength,
      cumulativeRecords: 2,
    }),
  );
  return { rows: Object.freeze(rows), ledger: ledger.entries };
}

function artifactStoreDouble(): ArtifactStore {
  const request = {
    method: "GET",
    origin: "https://data.alpaca.markets",
    pathHash: hash("path"),
    routeLabel: "alpaca-v2-historical-quotes",
    identityHash: REQUEST_HASH,
  };
  const attempt = {
    attemptId: retrievalAttemptId,
    provider: "alpaca",
    recordId: "synthetic-record",
    revisionId: "synthetic-revision",
    startedAtMs: 1_000,
    request,
    stagingId: "synthetic-stage",
    recordedAtMs: 1_000,
  };
  const observation = {
    observationId: artifactObservationId,
    attemptId: retrievalAttemptId,
    artifactDigest,
    provider: "alpaca",
    recordId: "synthetic-record",
    revisionId: "synthetic-revision",
    retrievedAtMs: 1_001,
    request,
    response: {
      statusCode: 200,
      etag: null,
      lastModified: null,
      mediaType: "application/json",
      contentEncoding: null,
      declaredContentLength: artifactBytes.byteLength,
      transportDecoded: true,
    },
    observationHash: artifactObservationHash,
  };
  const metadata = {
    digest: artifactDigest,
    algorithm: "sha256",
    sizeBytes: artifactBytes.byteLength,
    committedAtMs: 1_002,
    provenance: "retrieval",
  };
  return {
    async store() {
      throw new Error("unexpected-store");
    },
    async stat(candidate: string) {
      return candidate === artifactDigest ? metadata : undefined;
    },
    async read(candidate: string) {
      if (candidate !== artifactDigest) throw new Error("unexpected-read");
      return { artifact: metadata, stream: Readable.from([artifactBytes]) };
    },
    async getAttempt(candidate: string) {
      return candidate === retrievalAttemptId ? attempt : undefined;
    },
    async getObservation(candidate: string) {
      return candidate === artifactObservationId ? observation : undefined;
    },
    async readObservations() {
      return { items: [observation], nextSequence: "1", hasMore: false };
    },
    async reconcile() {
      throw new Error("unexpected-reconcile");
    },
  } as unknown as ArtifactStore;
}

test("memory and SQLite journals make byte-identical append and rejection decisions", async () => {
  const memory = new MemoryAcquisitionJournal(identity);
  const database = openSqliteDatabase(":memory:", []);
  const sqlite = new SqliteAcquisitionJournal(database, identity);
  const { rows, ledger } = history();
  for (const row of rows) {
    await appendTestAcquisitionJournalEntry(memory, row);
    await appendTestAcquisitionJournalEntry(sqlite, row);
    const memoryRows = await memory.load(journalId);
    const sqliteRows = await sqlite.load(journalId);
    assert.equal(
      canonicalJournalProjection(memoryRows, identity),
      canonicalJournalProjection(sqliteRows, identity),
    );
    assert.doesNotThrow(() => validateJournalLedgerBindings(memoryRows, ledger));
    assert.doesNotThrow(() => validateJournalLedgerBindings(sqliteRows, ledger));
  }
  const forged = { ...(rows.at(-1) as JournalEntry), journalEntryHash: hash("forged") };
  await assert.rejects(
    () => appendTestAcquisitionJournalEntry(memory, forged),
    /journal-hash-chain-invalid/u,
  );
  await assert.rejects(
    () => appendTestAcquisitionJournalEntry(sqlite, forged),
    /journal-hash-chain-invalid/u,
  );
  assert.equal((await memory.load(journalId)).length, rows.length);
  assert.equal((await sqlite.load(journalId)).length, rows.length);
  database.close();
});

test("SQLite close/reopen preserves every exact durable prefix", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "peas-p1-10-journal-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "acquisition.sqlite");
  const { rows, ledger } = history();
  for (let prefix = 1; prefix <= rows.length; prefix += 1) {
    let database = openSqliteDatabase(filename, []);
    let journal = new SqliteAcquisitionJournal(database, identity);
    const existing = await journal.load(journalId);
    for (const row of rows.slice(existing.length, prefix)) {
      await appendTestAcquisitionJournalEntry(journal, row);
    }
    const beforeRows = await journal.load(journalId);
    const before = canonicalJournalProjection(beforeRows, identity);
    assert.doesNotThrow(() => validateJournalLedgerBindings(beforeRows, ledger));
    database.close();

    database = openSqliteDatabase(filename, []);
    journal = new SqliteAcquisitionJournal(database, identity);
    const afterRows = await journal.load(journalId);
    const after = canonicalJournalProjection(afterRows, identity);
    assert.doesNotThrow(() => validateJournalLedgerBindings(afterRows, ledger));
    assert.equal(after, before);
    database.close();
  }
});

test("restart journals reject partial and conflicting checkpoint artifact identities", async () => {
  const { rows } = history();
  const committed = rows.find((row) => row.checkpointKind === "artifact-committed");
  const verified = rows.find((row) => row.checkpointKind === "artifact-verified");
  assert.ok(committed);
  assert.ok(verified);
  for (const testCase of [
    {
      prefix: committed.journalSequence,
      kind: "artifact-committed" as const,
      mutation: { ...journalEntryBody(committed), artifactDigest: null },
    },
    {
      prefix: verified.journalSequence,
      kind: "artifact-verified" as const,
      mutation: {
        ...journalEntryBody(verified),
        retrievalAttemptId: prefixed("rat1_", "conflict"),
      },
    },
  ]) {
    const journal = new MemoryAcquisitionJournal(identity);
    for (const row of rows.slice(0, testCase.prefix)) {
      await appendTestAcquisitionJournalEntry(journal, row);
    }
    const prior = (await journal.load(journalId)).at(-1) ?? null;
    await assert.rejects(
      () =>
        appendTestAcquisitionJournalEntry(
          journal,
          createJournalEntry(prior, journalId, testCase.kind, testCase.mutation),
        ),
      /artifact-tuple/u,
    );
  }
});

test("restart decisions never re-request committed or verified pages", async () => {
  const { rows } = history();
  const expected = [
    "preflight",
    "load-credentials",
    "fresh-attempt",
    "fresh-attempt",
    "append-artifact-verification",
    "append-page-checkpoint",
    "close-chain",
  ];
  for (let prefix = 1; prefix <= rows.length; prefix += 1) {
    const journal = new MemoryAcquisitionJournal(identity);
    for (const row of rows.slice(0, prefix)) {
      await appendTestAcquisitionJournalEntry(journal, row);
    }
    const decision = await decideAcquisitionRestart({
      journal,
      journalId,
      expectedIdentity: identity,
      expectedConfigurationHash: CONFIGURATION_HASH,
      artifactStore: retentionGuardedArtifactStore(artifactStoreDouble(), [
        {
          artifactDigest,
          artifactSizeBytes: artifactBytes.byteLength,
          artifactObservationId,
        },
      ]),
    });
    assert.equal(decision.kind, expected[prefix - 1]);
    if (prefix === 2 || prefix >= 5) assert.equal(decision.transportAllowed, false);
  }
  const journal = new MemoryAcquisitionJournal(identity);
  for (const row of rows) await appendTestAcquisitionJournalEntry(journal, row);
  await assert.rejects(
    () =>
      decideAcquisitionRestart({
        journal,
        journalId,
        expectedIdentity: identity,
        expectedConfigurationHash: hash("changed-configuration"),
        artifactStore: retentionGuardedArtifactStore(artifactStoreDouble(), [
          {
            artifactDigest,
            artifactSizeBytes: artifactBytes.byteLength,
            artifactObservationId,
          },
        ]),
      }),
    /journal-conflict/u,
  );
});
