import assert from "node:assert/strict";
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
import { draftFromStored } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonObject } from "../src/core/json.js";
import { computeAggregateCheckpointHash, DeterministicProcessor } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { captureScenario, makeManifest } from "./scenario.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const OUTPUT_DISPATCH_INDEX = "processing_outputs_dispatch_order";

type OutputRow = {
  sequence: bigint;
  output_id: string;
  run_id: string;
  input_event_id: string;
  input_position: bigint;
  aggregate_id: string;
  category: "decision" | "job" | "outbox";
  ordinal: bigint;
  dedupe_key: string | null;
  not_before_logical_ms: bigint | null;
  body_json: string;
  body_hash: string;
  envelope_hash: string;
};

async function seededLiveStore(context: test.TestContext, runId: string) {
  const scenario = await captureScenario();
  const event = scenario.events[0];
  assert.ok(event);
  const database = openSqliteDatabase(":memory:", migrations);
  context.after(() => database.close());
  const eventLog = new SqliteEventLog(database, {
    clock: new ManualClock(event.receivedAtMs),
  });
  const appended = await eventLog.append(draftFromStored(event));
  assert.equal(appended.disposition, "appended");
  const store = new SqliteProcessingStore<EarningsClusterState>(database);
  const manifest = makeManifest(runId, "live", true);
  await new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest,
  }).process(event);
  return { database, store, event, manifest };
}

function outputRow(
  database: SqliteDatabase,
  runId: string,
  category: OutputRow["category"],
): OutputRow {
  const row = database
    .prepare(
      `SELECT sequence, output_id, run_id, input_event_id, input_position, aggregate_id,
              category, ordinal, dedupe_key, not_before_logical_ms, body_json, body_hash,
              envelope_hash
       FROM processing_outputs
       WHERE run_id = ? AND category = ?
       ORDER BY ordinal
       LIMIT 1`,
    )
    .get(runId, category) as OutputRow | undefined;
  assert.ok(row, `Expected a ${category} output fixture`);
  return row;
}

function resealOutputBody(database: SqliteDatabase, row: OutputRow, body: JsonObject): string {
  const run = database
    .prepare("SELECT manifest_hash FROM run_manifests WHERE run_id = ?")
    .get(row.run_id) as { manifest_hash: string } | undefined;
  const event = database
    .prepare("SELECT event_hash FROM events WHERE position = ?")
    .get(row.input_position) as { event_hash: string } | undefined;
  assert.ok(run);
  assert.ok(event);
  const bodyHash = canonicalHash(`peas/output-body/${row.category}/v2`, body);
  const outputId = canonicalHash("peas/output-id/v2", {
    runId: row.run_id,
    manifestHash: run.manifest_hash,
    inputEventHash: event.event_hash,
    aggregateId: row.aggregate_id,
    category: row.category,
    ordinal: Number(row.ordinal),
    bodyHash,
  });
  const envelopeHash = canonicalHash("peas/output-relational-envelope/v2", {
    sequence: row.sequence.toString(),
    outputId,
    runId: row.run_id,
    inputEventId: row.input_event_id,
    inputPosition: row.input_position.toString(),
    aggregateId: row.aggregate_id,
    category: row.category,
    ordinal: row.ordinal.toString(),
    dedupeKey: row.dedupe_key,
    notBeforeLogicalMs: row.not_before_logical_ms?.toString() ?? null,
    bodyHash,
  });

  const deliveryTable =
    row.category === "job" ? "jobs" : row.category === "outbox" ? "outbox" : null;
  if (deliveryTable !== null) {
    database.prepare(`DELETE FROM ${deliveryTable} WHERE output_id = ?`).run(row.output_id);
  }
  database.exec("DROP TRIGGER processing_outputs_no_update");
  database
    .prepare(
      `UPDATE processing_outputs
       SET output_id = ?, body_json = ?, body_hash = ?, envelope_hash = ?
       WHERE output_id = ?`,
    )
    .run(outputId, canonicalJson(body), bodyHash, envelopeHash, row.output_id);
  if (deliveryTable !== null) {
    database.prepare(`INSERT INTO ${deliveryTable} (output_id) VALUES (?)`).run(outputId);
  }
  return outputId;
}

function schemaSnapshot(database: Database.Database): string {
  return JSON.stringify({
    schema: database
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
      )
      .all(),
    ledger: database
      .prepare(
        `SELECT CAST(version AS TEXT) AS version, name, checksum
         FROM schema_migrations ORDER BY version`,
      )
      .all(),
  });
}

function seedMigrationReferences(database: Database.Database): void {
  database
    .prepare(
      `INSERT INTO events (
        position, event_id, provider_key, provider, provider_record_id, provider_revision_id,
        artifact_hash, source, subject, stream_version, received_at_ms, logical_at_ms,
        event_json, content_hash, previous_event_hash, event_hash
      ) VALUES (1, 'event-1', 'provider-key-1', 'fixture', 'record-1', '1', 'artifact',
                'fixture:migration', 'subject-1', 1, 1, 1, '{}', 'content', 'previous', 'event-hash')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO run_manifests (
        run_id, run_kind, effects_allowed, manifest_json, manifest_hash, behavior_hash
      ) VALUES ('migration-run', 'replay', 0, '{}', 'manifest-hash', 'behavior-hash')`,
    )
    .run();
}

function insertMigrationOutput(
  database: Database.Database,
  values: {
    sequence: number;
    category: "decision" | "job" | "outbox";
    ordinal: number;
    dedupeKey: string | null;
    notBeforeLogicalMs: number | null;
    aggregateId?: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO processing_outputs (
        sequence, output_id, run_id, input_event_id, input_position, aggregate_id,
        category, ordinal, dedupe_key, not_before_logical_ms, body_json, body_hash, envelope_hash
      ) VALUES (?, ?, 'migration-run', 'event-1', 1, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    )
    .run(
      BigInt(values.sequence),
      `output-${values.sequence}`,
      values.aggregateId ?? "aggregate-1",
      values.category,
      BigInt(values.ordinal),
      values.dedupeKey,
      values.notBeforeLogicalMs === null ? null : BigInt(values.notBeforeLogicalMs),
      `body-hash-${values.sequence}`,
      `envelope-hash-${values.sequence}`,
    );
}

function assertRejectedUpgrade(
  seedInvalidRows: (database: Database.Database) => void,
  baselineMigrations: readonly Migration[],
): void {
  const database = new Database(":memory:");
  database.defaultSafeIntegers(true);
  database.pragma("foreign_keys = ON");
  try {
    applyMigrations(database, baselineMigrations);
    seedMigrationReferences(database);
    seedInvalidRows(database);
    const before = schemaSnapshot(database);
    assert.throws(() => applyMigrations(database, migrations), /CHECK constraint failed/iu);
    assert.equal(schemaSnapshot(database), before);
    assert.equal(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'processing_outputs_validate_insert'",
        )
        .get(),
      undefined,
      "failed upgrade must roll back the preceding migration too",
    );
  } finally {
    database.close();
  }
}

test("migration 004 validates every historical output before recording the upgrade", () => {
  assert.deepEqual(
    migrations.at(-1) && { version: migrations.at(-1)?.version, name: migrations.at(-1)?.name },
    { version: 4, name: "004_processing_output_upgrade_guards.sql" },
  );
  const baseline = migrations.slice(0, 2);

  assertRejectedUpgrade((database) => {
    insertMigrationOutput(database, {
      sequence: 0,
      category: "decision",
      ordinal: 0,
      dedupeKey: null,
      notBeforeLogicalMs: null,
    });
  }, baseline);
  assertRejectedUpgrade((database) => {
    database.pragma("ignore_check_constraints = ON");
    insertMigrationOutput(database, {
      sequence: 1,
      category: "bogus" as "decision",
      ordinal: 0,
      dedupeKey: null,
      notBeforeLogicalMs: null,
    });
    database.pragma("ignore_check_constraints = OFF");
  }, baseline);
  assertRejectedUpgrade((database) => {
    insertMigrationOutput(database, {
      sequence: 1,
      category: "decision",
      ordinal: 1,
      dedupeKey: null,
      notBeforeLogicalMs: null,
    });
  }, baseline);
  assertRejectedUpgrade((database) => {
    insertMigrationOutput(database, {
      sequence: 1,
      category: "decision",
      ordinal: 0,
      dedupeKey: "unexpected-delivery-metadata",
      notBeforeLogicalMs: null,
    });
  }, baseline);
  assertRejectedUpgrade((database) => {
    insertMigrationOutput(database, {
      sequence: 1,
      category: "decision",
      ordinal: 0,
      dedupeKey: null,
      notBeforeLogicalMs: null,
      aggregateId: "unicode-\uE000",
    });
  }, baseline);
  assertRejectedUpgrade((database) => {
    database
      .prepare(
        `INSERT INTO aggregate_checkpoints (
          run_id, aggregate_id, version, last_input_position,
          state_json, state_hash, checkpoint_hash
        ) VALUES ('migration-run', 'unicode-\uE000', 1, 1, '{}', 'state-hash', 'checkpoint-hash')`,
      )
      .run();
  }, baseline);
  for (const aggregateId of ["a".repeat(513), "safe\u0000bad"]) {
    assertRejectedUpgrade((database) => {
      insertMigrationOutput(database, {
        sequence: 1,
        category: "decision",
        ordinal: 0,
        dedupeKey: null,
        notBeforeLogicalMs: null,
        aggregateId,
      });
    }, baseline);
    assertRejectedUpgrade((database) => {
      database
        .prepare(
          `INSERT INTO aggregate_checkpoints (
            run_id, aggregate_id, version, last_input_position,
            state_json, state_hash, checkpoint_hash
          ) VALUES ('migration-run', ?, 1, 1, '{}', 'state-hash', 'checkpoint-hash')`,
        )
        .run(aggregateId);
    }, baseline);
  }
  assertRejectedUpgrade((database) => {
    insertMigrationOutput(database, {
      sequence: 1,
      category: "job",
      ordinal: 0,
      dedupeKey: "job-dedupe",
      notBeforeLogicalMs: 1,
    });
    insertMigrationOutput(database, {
      sequence: 2,
      category: "decision",
      ordinal: 0,
      dedupeKey: null,
      notBeforeLogicalMs: null,
    });
  }, baseline);
});

test("SQLite audit reads and claims reject self-consistent category-body forgeries", async (context) => {
  await context.test("a job missing its immutable contract is never leased", async (subcontext) => {
    const { database, store, manifest } = await seededLiveStore(subcontext, "malformed-job-read");
    const row = outputRow(database, manifest.runId, "job");
    const outputId = resealOutputBody(database, row, {
      dedupeKey: row.dedupe_key,
      notBeforeLogicalMs: Number(row.not_before_logical_ms),
    });

    await assert.rejects(
      () => store.readOutputsAfter(manifest.runId, "0", 100),
      /job|Job|Output body/iu,
    );
    await assert.rejects(
      () =>
        store.claimJobs(
          manifest.runId,
          "malformed-worker",
          Number(row.not_before_logical_ms),
          1_000,
          100,
        ),
      /job|Job|Output body/iu,
    );
    assert.deepEqual(
      database
        .prepare("SELECT status, fencing_token, attempt_count FROM jobs WHERE output_id = ?")
        .get(outputId),
      { status: "pending", fencing_token: 0n, attempt_count: 0n },
    );
  });

  await context.test(
    "a job cannot self-attest a different deterministic job ID",
    async (subcontext) => {
      const { database, store, manifest } = await seededLiveStore(subcontext, "wrong-job-id-read");
      const row = outputRow(database, manifest.runId, "job");
      const body = {
        ...(JSON.parse(row.body_json) as JsonObject),
        jobId: "0".repeat(64),
      } satisfies JsonObject;
      resealOutputBody(database, row, body);
      await assert.rejects(
        () =>
          store.claimJobs(
            manifest.runId,
            "wrong-id-worker",
            Number(row.not_before_logical_ms),
            1_000,
            100,
          ),
        /Job ID integrity mismatch/u,
      );
    },
  );

  await context.test(
    "an outbox message cannot self-attest a different deterministic message ID",
    async (subcontext) => {
      const { database, store, event, manifest } = await seededLiveStore(
        subcontext,
        "wrong-message-id-read",
      );
      const row = outputRow(database, manifest.runId, "outbox");
      const body = {
        ...(JSON.parse(row.body_json) as JsonObject),
        messageId: "0".repeat(64),
      } satisfies JsonObject;
      resealOutputBody(database, row, body);
      await assert.rejects(
        () =>
          store.claimOutbox(manifest.runId, "wrong-message-worker", event.logicalAtMs, 1_000, 100),
        /Message ID integrity mismatch/u,
      );
    },
  );

  await context.test("decision bodies are strict category-specific objects", async (subcontext) => {
    const { database, store, manifest } = await seededLiveStore(
      subcontext,
      "malformed-decision-read",
    );
    const row = outputRow(database, manifest.runId, "decision");
    resealOutputBody(database, row, { type: "missing-payload" });
    await assert.rejects(
      () => store.readOutputsAfter(manifest.runId, "0", 100),
      /Decision|payload|Output body/iu,
    );
  });
});

test("delivery tables can reference only their matching immutable output category", async (context) => {
  const { database, manifest } = await seededLiveStore(context, "delivery-category-guards");
  const decision = outputRow(database, manifest.runId, "decision");
  const job = outputRow(database, manifest.runId, "job");
  const outbox = outputRow(database, manifest.runId, "outbox");

  assert.throws(
    () => database.prepare("INSERT INTO jobs (output_id) VALUES (?)").run(decision.output_id),
    /jobs row must reference a job output/u,
  );
  assert.throws(
    () => database.prepare("INSERT INTO outbox (output_id) VALUES (?)").run(decision.output_id),
    /outbox row must reference an outbox output/u,
  );
  assert.throws(
    () =>
      database
        .prepare("UPDATE jobs SET output_id = ? WHERE output_id = ?")
        .run(outbox.output_id, job.output_id),
    /jobs row must reference a job output/u,
  );
  assert.throws(
    () =>
      database
        .prepare("UPDATE outbox SET output_id = ? WHERE output_id = ?")
        .run(job.output_id, outbox.output_id),
    /outbox row must reference an outbox output/u,
  );
});

test("aggregate reads require canonical state encoding", async (context) => {
  const { database, store, manifest } = await seededLiveStore(context, "canonical-state-read");
  const row = database
    .prepare("SELECT aggregate_id, state_json FROM aggregate_checkpoints WHERE run_id = ?")
    .get(manifest.runId) as { aggregate_id: string; state_json: string } | undefined;
  assert.ok(row);
  database
    .prepare(
      "UPDATE aggregate_checkpoints SET state_json = ? WHERE run_id = ? AND aggregate_id = ?",
    )
    .run(` ${row.state_json}`, manifest.runId, row.aggregate_id);
  await assert.rejects(
    () => store.loadAggregate(manifest.runId, row.aggregate_id),
    /not canonically encoded/u,
  );
});

test("aggregate reads reject a self-consistent persisted zero-version checkpoint", async (context) => {
  const { database, store, manifest } = await seededLiveStore(context, "zero-version-read");
  const row = database
    .prepare(
      `SELECT aggregate_id, last_input_position, state_json, state_hash
       FROM aggregate_checkpoints WHERE run_id = ?`,
    )
    .get(manifest.runId) as
    | {
        aggregate_id: string;
        last_input_position: bigint;
        state_json: string;
        state_hash: string;
      }
    | undefined;
  assert.ok(row);
  const state = JSON.parse(row.state_json) as EarningsClusterState;
  const checkpointHash = computeAggregateCheckpointHash({
    runId: manifest.runId,
    aggregateId: row.aggregate_id,
    version: "0",
    lastInputPosition: row.last_input_position.toString(),
    state,
    stateHash: row.state_hash,
  });
  database
    .prepare(
      `UPDATE aggregate_checkpoints SET version = 0, checkpoint_hash = ?
       WHERE run_id = ? AND aggregate_id = ?`,
    )
    .run(checkpointHash, manifest.runId, row.aggregate_id);

  await assert.rejects(
    () => store.loadAggregate(manifest.runId, row.aggregate_id),
    /Invalid string|greater than or equal to 1|checkpoint/u,
  );
});

test("job claims filter and order on the relational dispatch index", async (context) => {
  const { database, store, event, manifest } = await seededLiveStore(context, "claim-query-plan");
  const plan = database
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT o.sequence, o.output_id, o.run_id, o.input_event_id, o.input_position,
              o.aggregate_id, o.category, o.ordinal, o.dedupe_key,
              o.not_before_logical_ms, o.body_json, o.body_hash, o.envelope_hash
       FROM processing_outputs o INDEXED BY processing_outputs_dispatch_order
       JOIN jobs d ON d.output_id = o.output_id
       JOIN run_manifests r ON r.run_id = o.run_id
       WHERE o.run_id = ?
         AND o.category = 'job'
         AND r.effects_allowed = 1
         AND r.run_kind = 'live'
         AND o.not_before_logical_ms <= ?
         AND (d.status = 'pending' OR (d.status = 'leased' AND d.lease_expires_at_ms <= ?))
       ORDER BY o.not_before_logical_ms, o.output_id
       LIMIT ?`,
    )
    .all(manifest.runId, BigInt(event.logicalAtMs), BigInt(event.logicalAtMs), 100n) as {
    detail: string;
  }[];
  assert.equal(
    plan.some(({ detail }) => detail.includes(OUTPUT_DISPATCH_INDEX)),
    true,
    JSON.stringify(plan.map(({ detail }) => detail)),
  );
  const claims = await store.claimJobs(
    manifest.runId,
    "indexed-claim-worker",
    event.logicalAtMs,
    1_000,
    100,
  );
  assert.ok(claims.length > 0);
});
