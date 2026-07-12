import { join } from "node:path";

import { DurableArtifactStore } from "../../dist/src/adapters/artifacts/durable-artifact-store.js";
import { SqliteArtifactRepository } from "../../dist/src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadMigrations, openSqliteDatabase } from "../../dist/src/adapters/sqlite/database.js";
import { ManualClock } from "../../dist/src/core/clock.js";

const [databasePath, runtimeRoot, initialNow, targetCheckpoint] = process.argv.slice(2);
if (!databasePath || !runtimeRoot || !initialNow)
  throw new Error("Missing reconciliation worker arguments");
const database = openSqliteDatabase(
  databasePath,
  loadMigrations(join(process.cwd(), "migrations")),
);
const store = await DurableArtifactStore.open({
  repository: new SqliteArtifactRepository(database),
  clock: new ManualClock(Number(initialNow)),
  config: {
    runtimeRootMode: "ci-temporary",
    runtimeRoot,
    maxArtifactBytes: 1_024,
    maxVaultBytes: 4_096,
    maxConcurrentWrites: 1,
    streamHighWaterMarkBytes: 17,
    stageExpiryMs: 1_000,
    writerLeaseBehavior: "fail",
    writerLeaseWaitMs: 0,
    writerLeaseDurationMs: 30_000,
    writerLeaseRenewalMs: 10_000,
  },
  faultBoundary: async (checkpoint) => {
    if (checkpoint !== targetCheckpoint) return;
    process.send?.({ type: "checkpoint", checkpoint });
    await new Promise(() => undefined);
  },
});
process.send?.({ type: "ready" });

process.on("message", (message) => {
  if (message?.type !== "reconcile") return;
  void store
    .reconcile({
      cursor: message.cursor ?? null,
      maxItems: message.maxItems ?? 1,
      maxElapsedMs: 10_000,
      maxBytes: message.maxBytes ?? 1_024,
    })
    .then((report) => process.send?.({ type: "result", cursor: report.continuationCursor }))
    .catch((error) =>
      process.send?.({ type: "result", error: error instanceof Error ? error.message : "unknown" }),
    );
});
