import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import { draftFromStored } from "../src/core/event.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { DeterministicProcessor } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { CONFIG, captureScenario, makeManifest } from "./scenario.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const workerPath = join(process.cwd(), "test", "fixtures", "sqlite-worker.mjs");

type SqlStatement = Readonly<{ sql: string; params?: readonly (string | number | null)[] }>;

function temporaryDatabasePath(context: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "peas-sqlite-crash-"));
  context.after(() => {
    const safePrefix = join(tmpdir(), "peas-sqlite-crash-");
    if (!directory.startsWith(safePrefix)) throw new Error("Unsafe crash-test cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, "kernel.sqlite");
}

function waitForMessage(child: ChildProcess, expectedType: "ready" | "staged"): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onMessage = (message: unknown): void => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        message.type !== expectedType
      ) {
        return;
      }
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(
        new Error(
          `Crash worker exited before ${expectedType} (code=${code}, signal=${String(signal)})`,
        ),
      );
    };
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
}

async function stageAndHardKill(
  databasePath: string,
  statements: readonly SqlStatement[],
): Promise<void> {
  const child = fork(workerPath, [databasePath], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  await waitForMessage(child, "ready");
  const staged = waitForMessage(child, "staged");
  child.send({ operation: "holdTransaction", statements });
  await staged;
  const killed = child.kill("SIGKILL");
  assert.equal(killed, true, "hard-kill signal was not delivered");
  await waitForExit(child);
}

function integrity(databasePath: string): void {
  const database = openSqliteDatabase(databasePath, migrations);
  try {
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    database.close();
  }
}

test("hard kills roll back append, commit, migration, lease, and completion transactions", {
  timeout: 60_000,
}, async (context) => {
  const databasePath = temporaryDatabasePath(context);
  const captured = await captureScenario();
  const first = captured.events[0];
  assert.ok(first);
  const manifest = makeManifest("crash-recovery-live", "live", true);

  const seed = openSqliteDatabase(databasePath, migrations);
  const seedLog = new SqliteEventLog(seed, { clock: new ManualClock(first.receivedAtMs) });
  await seedLog.append(draftFromStored(first));
  const seedStore = new SqliteProcessingStore<EarningsClusterState>(seed);
  const seedProcessor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: seedStore,
    eventLog: seedLog,
    manifest,
  });
  await seedProcessor.processAvailable(1);
  const baselineCursor = seed
    .prepare("SELECT * FROM run_cursors WHERE run_id = ?")
    .get(manifest.runId);
  const baselineEventCount = (
    seed.prepare("SELECT count(*) AS count FROM events").get() as { count: bigint }
  ).count;
  const pendingJob = seed
    .prepare("SELECT output_id, status, fencing_token, attempt_count FROM jobs ORDER BY output_id")
    .get() as
    | {
        output_id: string;
        status: string;
        fencing_token: bigint;
        attempt_count: bigint;
      }
    | undefined;
  assert.ok(pendingJob);
  seed.close();

  await stageAndHardKill(databasePath, [
    {
      sql: `INSERT INTO events (
          position, event_id, provider_key, provider, provider_record_id,
          provider_revision_id, artifact_hash, source, subject, stream_version,
          received_at_ms, logical_at_ms, event_json, content_hash,
          previous_event_hash, event_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        999,
        "crash-event-id",
        "crash-provider-key",
        "crash-provider",
        "crash-record",
        "1",
        "a".repeat(64),
        "crash-source",
        "crash-subject",
        1,
        first.receivedAtMs,
        first.logicalAtMs,
        "{}",
        "b".repeat(64),
        first.eventHash,
        "c".repeat(64),
      ],
    },
  ]);
  integrity(databasePath);
  let verification = openSqliteDatabase(databasePath, migrations);
  assert.equal(
    (verification.prepare("SELECT count(*) AS count FROM events").get() as { count: bigint }).count,
    baselineEventCount,
  );
  verification.close();

  await stageAndHardKill(databasePath, [
    {
      sql: "UPDATE run_cursors SET logical_at_ms = logical_at_ms + 1 WHERE run_id = ?",
      params: [manifest.runId],
    },
    {
      sql: "UPDATE aggregate_checkpoints SET state_json = '{}' WHERE run_id = ?",
      params: [manifest.runId],
    },
  ]);
  integrity(databasePath);
  verification = openSqliteDatabase(databasePath, migrations);
  assert.deepEqual(
    verification.prepare("SELECT * FROM run_cursors WHERE run_id = ?").get(manifest.runId),
    baselineCursor,
  );
  verification.close();

  await stageAndHardKill(databasePath, [
    { sql: "CREATE TABLE crash_migration_probe (id INTEGER PRIMARY KEY) STRICT" },
    {
      sql: `INSERT INTO schema_migrations (version, name, checksum)
              VALUES (999, '999_crash_probe.sql', 'uncommitted')`,
    },
  ]);
  integrity(databasePath);
  verification = openSqliteDatabase(databasePath, migrations);
  assert.equal(
    (
      verification
        .prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'crash_migration_probe'")
        .get() as { count: bigint }
    ).count,
    0n,
  );
  assert.equal(
    (
      verification
        .prepare("SELECT count(*) AS count FROM schema_migrations WHERE version = 999")
        .get() as { count: bigint }
    ).count,
    0n,
  );
  verification.close();

  await stageAndHardKill(databasePath, [
    {
      sql: `UPDATE jobs
              SET status = 'leased', lease_owner = 'crashed-claimer',
                  lease_expires_at_ms = ?, fencing_token = fencing_token + 1,
                  attempt_count = attempt_count + 1
              WHERE output_id = ?`,
      params: [first.logicalAtMs + CONFIG.lifecycleMs, pendingJob.output_id],
    },
  ]);
  integrity(databasePath);
  verification = openSqliteDatabase(databasePath, migrations);
  assert.deepEqual(
    verification
      .prepare(
        "SELECT output_id, status, fencing_token, attempt_count FROM jobs WHERE output_id = ?",
      )
      .get(pendingJob.output_id),
    pendingJob,
  );

  const verificationStore = new SqliteProcessingStore<EarningsClusterState>(verification);
  const claims = await verificationStore.claimJobs(
    manifest.runId,
    "completion-owner",
    first.logicalAtMs + CONFIG.lifecycleMs + 1,
    60_000,
    1,
  );
  const claimed = claims[0];
  assert.ok(claimed);
  const leasedBaseline = verification
    .prepare(
      `SELECT output_id, status, lease_owner, lease_expires_at_ms,
                fencing_token, attempt_count, last_error
         FROM jobs WHERE output_id = ?`,
    )
    .get(claimed.outputId);
  verification.close();

  await stageAndHardKill(databasePath, [
    {
      sql: `UPDATE jobs
              SET status = 'succeeded', lease_owner = NULL, lease_expires_at_ms = NULL,
                  last_error = NULL
              WHERE output_id = ? AND lease_owner = ? AND fencing_token = ?`,
      params: [claimed.outputId, "completion-owner", claimed.fencingToken],
    },
  ]);
  integrity(databasePath);
  verification = openSqliteDatabase(databasePath, migrations);
  assert.deepEqual(
    verification
      .prepare(
        `SELECT output_id, status, lease_owner, lease_expires_at_ms,
                  fencing_token, attempt_count, last_error
           FROM jobs WHERE output_id = ?`,
      )
      .get(claimed.outputId),
    leasedBaseline,
  );
  verification.close();

  // Continue capture and processing after every forced termination, then compare with replay.
  for (const expected of captured.events.slice(1)) {
    const database = openSqliteDatabase(databasePath, migrations);
    try {
      const eventLog = new SqliteEventLog(database, {
        clock: new ManualClock(expected.receivedAtMs),
      });
      const appended = await eventLog.append(draftFromStored(expected));
      assert.equal(
        canonicalJson(appended.event as unknown as JsonValue),
        canonicalJson(expected as unknown as JsonValue),
      );
      const processor = new DeterministicProcessor({
        reducer: new EarningsClusterReducer(),
        store: new SqliteProcessingStore<EarningsClusterState>(database),
        eventLog,
        manifest,
      });
      await processor.processAvailable(2);
    } finally {
      database.close();
    }
  }

  const recovered = openSqliteDatabase(databasePath, migrations);
  try {
    assert.equal(recovered.pragma("integrity_check", { simple: true }), "ok");
    const recoveredLog = new SqliteEventLog(recovered, { clock: new ManualClock(0) });
    const recoveredProcessor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: new SqliteProcessingStore<EarningsClusterState>(recovered),
      eventLog: recoveredLog,
      manifest,
    });
    const recoveredSnapshot = await recoveredProcessor.snapshot(2);

    const replayLog = new CapturedEventLog(captured.events);
    const replayProcessor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: new InMemoryProcessingStore<EarningsClusterState>(replayLog),
      eventLog: replayLog,
      manifest,
    });
    await replayProcessor.processAvailable(7);
    const replaySnapshot = await replayProcessor.snapshot(7);
    assert.equal(
      canonicalJson(recoveredSnapshot as unknown as JsonValue),
      canonicalJson(replaySnapshot as unknown as JsonValue),
    );
  } finally {
    recovered.close();
  }
});
