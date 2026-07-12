import { join } from "node:path";

import { DurableArtifactStore } from "../../dist/src/adapters/artifacts/durable-artifact-store.js";
import { SqliteArtifactRepository } from "../../dist/src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadMigrations, openSqliteDatabase } from "../../dist/src/adapters/sqlite/database.js";
import { ManualClock } from "../../dist/src/core/clock.js";

const [databasePath, runtimeRoot, initialNow, digest, targetCheckpoint] = process.argv.slice(2);
if (!databasePath || !runtimeRoot || !initialNow || !digest || !targetCheckpoint)
  throw new Error("Missing artifact read-worker arguments");
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
try {
  const verified = await store.read(digest);
  for await (const _chunk of verified.stream) {
    // Consume the verified snapshot so normal cleanup can complete.
  }
  process.send?.({ type: "result", status: "read" });
} catch (error) {
  process.send?.({
    type: "result",
    status: "rejected",
    message: error instanceof Error ? error.message : "unknown",
  });
}
