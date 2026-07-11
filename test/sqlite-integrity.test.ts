import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  applyMigrations,
  loadMigrations,
  type Migration,
  openSqliteDatabase,
  type SqliteDatabase,
} from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import {
  computeContentHash,
  computeEventHash,
  type EventDraft,
  type StoredEvent,
} from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { DeterministicProcessor, type RunKind, type RunManifest } from "../src/core/processor.js";
import {
  type EarningsClusterConfig,
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const BASE_TIME_MS = 1_800_000_000_000;
const CONFIG: EarningsClusterConfig = {
  mirrorDebounceMs: 60_000,
  lifecycleMs: 6 * 60 * 60 * 1_000,
  maxSourcesPerCluster: 32,
  maxAnalysisBranches: 32,
  maxAnalysisResultBytes: 64_000,
};

function temporaryDatabase(context: test.TestContext): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "peas-sqlite-integrity-"));
  const database = openSqliteDatabase(join(directory, "kernel.sqlite"), migrations);
  context.after(() => {
    if (database.open) database.close();
    const prefix = join(tmpdir(), "peas-sqlite-integrity-");
    if (!directory.startsWith(prefix)) throw new Error("Unsafe SQLite test cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

function manifestFor(
  runId: string,
  kind: RunKind,
  effectsAllowed: boolean,
): RunManifest<EarningsClusterConfig> {
  const reducer = new EarningsClusterReducer();
  return {
    manifestVersion: 2,
    runId,
    kind,
    effectsAllowed,
    canonicalizationVersion: "peas-json-v1",
    behavior: {
      reducerName: reducer.name,
      reducerVersion: reducer.version,
      buildDigest: canonicalHash("peas/sqlite-integrity/build", { version: 1 }),
      schemaRegistryDigest: canonicalHash("peas/sqlite-integrity/schema", { version: 1 }),
      configuration: CONFIG,
      identities: {
        extractorVersion: "sqlite-integrity-extractor-v1",
        featureSetId: "sqlite-integrity-features-v1",
        modelId: "sqlite-integrity-model-v1",
        promptId: "sqlite-integrity-prompt-v1",
        datasetId: "sqlite-integrity-dataset-v1",
      },
    },
  };
}

async function captureEvents(
  database: SqliteDatabase,
): Promise<Readonly<{ eventLog: SqliteEventLog; events: readonly StoredEvent[] }>> {
  const clock = new ManualClock(BASE_TIME_MS);
  const eventLog = new SqliteEventLog(database, { clock });
  const events: StoredEvent[] = [];
  for (let index = 0; index < 2; index += 1) {
    const artifactHash = canonicalHash("peas/sqlite-integrity/artifact", { index });
    const draft: EventDraft = {
      envelopeVersion: 2,
      type: "earnings.source.observed",
      schemaVersion: 1,
      source: index === 0 ? "fixture:ir" : "fixture:sec",
      subject: "earnings:0000123456:2026-Q2",
      occurredAtMs: clock.nowMs(),
      correlationId: "sqlite-integrity-correlation",
      provider: {
        provider: index === 0 ? "issuer-ir" : "sec",
        recordId: `sqlite-integrity-${index}`,
        revisionId: "1",
        artifactHash,
      },
      payload: {
        issuerCik: "0000123456",
        fiscalPeriod: "2026-Q2",
        sourceKind: index === 0 ? "issuer_release" : "sec_8k",
        artifactHash,
        publishedAtMs: clock.nowMs(),
        timestampConfidence: "exact",
        originalTimestamp: null,
      },
    };
    events.push((await eventLog.append(draft)).event);
    clock.advanceBy(1_000);
  }
  return { eventLog, events };
}

async function withRejectedTamper(
  database: SqliteDatabase,
  mutate: () => number,
  probe: () => Promise<unknown>,
): Promise<void> {
  database.exec("SAVEPOINT rejected_tamper");
  try {
    assert.equal(mutate(), 1);
    await assert.rejects(probe, /mismatch|canonically encoded|invalid/iu);
  } finally {
    database.exec("ROLLBACK TO rejected_tamper");
    database.exec("RELEASE rejected_tamper");
  }
}

test("event reads reconcile every duplicated relational column with event_json", async (context) => {
  const database = temporaryDatabase(context);
  const { eventLog } = await captureEvents(database);
  database.exec("DROP TRIGGER events_no_update");

  const mutations: readonly Readonly<{
    sql: string;
    readPosition?: string;
  }>[] = [
    { sql: "UPDATE events SET position = 99 WHERE position = 1", readPosition: "99" },
    { sql: "UPDATE events SET event_id = event_id || '-tampered' WHERE position = 1" },
    { sql: "UPDATE events SET provider_key = provider_key || '-tampered' WHERE position = 1" },
    { sql: "UPDATE events SET provider = provider || '-tampered' WHERE position = 1" },
    {
      sql: "UPDATE events SET provider_record_id = provider_record_id || '-tampered' WHERE position = 1",
    },
    {
      sql: "UPDATE events SET provider_revision_id = provider_revision_id || '-tampered' WHERE position = 1",
    },
    { sql: "UPDATE events SET artifact_hash = printf('%064d', 0) WHERE position = 1" },
    { sql: "UPDATE events SET source = source || '-tampered' WHERE position = 1" },
    { sql: "UPDATE events SET subject = subject || '-tampered' WHERE position = 1" },
    { sql: "UPDATE events SET stream_version = 99 WHERE position = 1" },
    { sql: "UPDATE events SET received_at_ms = received_at_ms + 1 WHERE position = 1" },
    { sql: "UPDATE events SET logical_at_ms = logical_at_ms + 1 WHERE position = 1" },
    { sql: "UPDATE events SET event_json = '{}' WHERE position = 1" },
    { sql: "UPDATE events SET content_hash = printf('%064d', 0) WHERE position = 1" },
    { sql: "UPDATE events SET previous_event_hash = printf('%064d', 1) WHERE position = 1" },
    { sql: "UPDATE events SET event_hash = printf('%064d', 0) WHERE position = 1" },
  ];

  for (const mutation of mutations) {
    await withRejectedTamper(
      database,
      () => database.prepare(mutation.sql).run().changes,
      () => eventLog.get(mutation.readPosition ?? "1"),
    );
  }

  await withRejectedTamper(
    database,
    () =>
      database.prepare("UPDATE events SET event_hash = printf('%064d', 0) WHERE position = 1").run()
        .changes,
    () => eventLog.readAfter("0", 2),
  );
});

test("older no-ops are anchored through the persisted SQLite chain to the cursor head", async (context) => {
  const database = temporaryDatabase(context);
  const { eventLog, events } = await captureEvents(database);
  const first = events[0];
  const second = events[1];
  assert.ok(first);
  assert.ok(second);
  const store = new SqliteProcessingStore<EarningsClusterState>(database);
  const manifest = manifestFor("sqlite-older-event-forward-anchor", "research", false);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest,
  });
  await processor.process(first);
  const head = await processor.process(second);
  const before = await processor.snapshot();

  assert.deepEqual(await processor.process(first), head);
  assert.deepEqual(await processor.snapshot(), before);

  const changedContent = {
    ...first,
    payload: { ...first.payload, consistentlyRewrittenAfterProcessing: true },
  };
  const contentHash = computeContentHash(changedContent);
  const changedWithoutEventHash = { ...changedContent, contentHash };
  const rewritten: StoredEvent = {
    ...changedWithoutEventHash,
    eventHash: computeEventHash(changedWithoutEventHash),
  };
  database.exec("DROP TRIGGER events_no_update");
  assert.equal(
    database
      .prepare(
        `UPDATE events
         SET event_json = ?, content_hash = ?, event_hash = ?
         WHERE position = 1`,
      )
      .run(
        canonicalJson(rewritten as unknown as JsonValue),
        rewritten.contentHash,
        rewritten.eventHash,
      ).changes,
    1,
  );

  await assert.rejects(() => processor.process(rewritten), /Event chain mismatch/u);
  assert.deepEqual(await store.loadCursor(manifest.runId), head);
});

test("output audit reads and claims reconcile all duplicated delivery metadata", async (context) => {
  const database = temporaryDatabase(context);
  const { eventLog } = await captureEvents(database);
  const store = new SqliteProcessingStore<EarningsClusterState>(database);
  const manifest = manifestFor("sqlite-output-integrity-live", "live", true);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest,
  });
  const first = await eventLog.get("1");
  assert.ok(first);
  await processor.process(first);

  const otherManifest = manifestFor("sqlite-output-integrity-other", "live", false);
  const otherProcessor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest: otherManifest,
  });
  await otherProcessor.snapshot();

  const target = database
    .prepare(
      `SELECT output_id, ordinal
       FROM processing_outputs p
       WHERE run_id = ? AND category = 'job'
         AND NOT EXISTS (
           SELECT 1 FROM processing_outputs q
           WHERE q.run_id = p.run_id AND q.input_position = p.input_position
             AND q.category = 'outbox' AND q.ordinal = p.ordinal
         )
       ORDER BY ordinal DESC LIMIT 1`,
    )
    .get(manifest.runId) as { output_id: string; ordinal: bigint } | undefined;
  assert.ok(target, "fixture must emit a job whose ordinal is free in the outbox category");
  const secondEvent = await eventLog.get("2");
  assert.ok(secondEvent);
  database.exec("DROP TRIGGER processing_outputs_no_update");

  const readOriginalRun = () => store.readOutputsAfter(manifest.runId, "0", 100);
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare("UPDATE processing_outputs SET input_event_id = ? WHERE output_id = ?")
        .run(secondEvent.eventId, target.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare("UPDATE processing_outputs SET sequence = sequence + 1000 WHERE output_id = ?")
        .run(target.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare("UPDATE processing_outputs SET input_position = 2 WHERE output_id = ?")
        .run(target.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare(
          "UPDATE processing_outputs SET aggregate_id = aggregate_id || '-tampered' WHERE output_id = ?",
        )
        .run(target.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare("UPDATE processing_outputs SET category = 'outbox' WHERE output_id = ?")
        .run(target.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare("UPDATE processing_outputs SET ordinal = ordinal + 100 WHERE output_id = ?")
        .run(target.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare(
          "UPDATE processing_outputs SET dedupe_key = dedupe_key || '-tampered' WHERE output_id = ?",
        )
        .run(target.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare("UPDATE processing_outputs SET not_before_logical_ms = 0 WHERE output_id = ?")
        .run(target.output_id).changes,
    () => store.claimJobs(manifest.runId, "audit-worker", BASE_TIME_MS, 1_000, 100),
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare(
          "UPDATE processing_outputs SET not_before_logical_ms = not_before_logical_ms + 86400000 WHERE output_id = ?",
        )
        .run(target.output_id).changes,
    () =>
      store.claimJobs(manifest.runId, "audit-worker", BASE_TIME_MS + 2 * 86_400_000, 1_000, 100),
  );
  assert.equal(
    (
      database.prepare("SELECT status FROM jobs WHERE output_id = ?").get(target.output_id) as {
        status: string;
      }
    ).status,
    "pending",
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare("UPDATE processing_outputs SET body_json = '{}' WHERE output_id = ?")
        .run(target.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare(
          "UPDATE processing_outputs SET envelope_hash = printf('%064d', 0) WHERE output_id = ?",
        )
        .run(target.output_id).changes,
    readOriginalRun,
  );
  const decision = database
    .prepare(
      "SELECT output_id FROM processing_outputs WHERE run_id = ? AND category = 'decision' LIMIT 1",
    )
    .get(manifest.runId) as { output_id: string } | undefined;
  assert.ok(decision);
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare(
          "UPDATE processing_outputs SET output_id = output_id || '-tampered' WHERE output_id = ?",
        )
        .run(decision.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare("UPDATE processing_outputs SET body_hash = printf('%064d', 0) WHERE output_id = ?")
        .run(target.output_id).changes,
    readOriginalRun,
  );
  await withRejectedTamper(
    database,
    () =>
      database
        .prepare("UPDATE processing_outputs SET run_id = ? WHERE output_id = ?")
        .run(otherManifest.runId, target.output_id).changes,
    () => store.readOutputsAfter(otherManifest.runId, "0", 100),
  );
});

test("migration plan rejection and failed DDL are side-effect-free", () => {
  const database = new Database(":memory:");
  database.defaultSafeIntegers(true);
  const first: Migration = {
    version: 1,
    name: "001_base.sql",
    sql: "CREATE TABLE base (id INTEGER PRIMARY KEY) STRICT;",
  };
  applyMigrations(database, [first]);

  const snapshot = (): string =>
    JSON.stringify({
      schema: database
        .prepare(
          `SELECT type, name, tbl_name, sql FROM sqlite_master
           WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
        )
        .all(),
      ledger: database
        .prepare("SELECT CAST(version AS TEXT) AS version, name, checksum FROM schema_migrations")
        .all(),
    });
  const before = snapshot();
  const second: Migration = {
    version: 2,
    name: "002_must_not_apply.sql",
    sql: "CREATE TABLE must_not_exist (id INTEGER PRIMARY KEY) STRICT;",
  };
  assert.throws(() => applyMigrations(database, [second]), /contiguous/iu);
  assert.equal(snapshot(), before);

  const divergentFirst: Migration = {
    ...first,
    sql: `${first.sql}\n-- divergent repository history`,
  };
  assert.throws(() => applyMigrations(database, [divergentFirst, second]), /diverges/iu);
  assert.equal(snapshot(), before);

  const broken: Migration = {
    version: 2,
    name: "002_broken.sql",
    sql: "CREATE TABLE rolled_back (id INTEGER PRIMARY KEY) STRICT; INVALID SQL;",
  };
  assert.throws(() => applyMigrations(database, [first, broken]));
  assert.equal(snapshot(), before);
  database.close();
});

test("SQL permits dispatchable effects only for live runs", (context) => {
  const database = temporaryDatabase(context);
  const insert = database.prepare(
    `INSERT INTO run_manifests (
       run_id, run_kind, effects_allowed, manifest_json, manifest_hash, behavior_hash
     ) VALUES (?, ?, ?, '{}', ?, ?)`,
  );
  const kinds = ["live", "replay", "shadow", "research", "paper"] as const;
  for (const kind of kinds) {
    for (const effectsAllowed of [false, true]) {
      const operation = () =>
        insert.run(
          `${kind}-${effectsAllowed}`,
          kind,
          effectsAllowed ? 1n : 0n,
          `${kind}-${effectsAllowed}-manifest`,
          `${kind}-${effectsAllowed}-behavior`,
        );
      if (kind === "live" || !effectsAllowed) {
        assert.doesNotThrow(operation);
      } else {
        assert.throws(operation, /constraint/iu);
      }
    }
  }
});
