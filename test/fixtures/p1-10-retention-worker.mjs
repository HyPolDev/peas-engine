import { join } from "node:path";

import { openSqliteDatabase, loadMigrations } from "../../dist/src/adapters/sqlite/database.js";
import { createArtifactRetentionController } from "../../dist/src/adapters/market-acquisition/retention/controller.js";
import { SqliteArtifactRetentionJournal } from "../../dist/src/adapters/market-acquisition/retention/sqlite-journal.js";
import { VaultArtifactRetentionBoundary } from "../../dist/src/adapters/market-acquisition/retention/vault-boundary.js";
import { DurableArtifactStore } from "../../dist/src/adapters/artifacts/durable-artifact-store.js";
import { SqliteArtifactRepository } from "../../dist/src/adapters/artifacts/sqlite-artifact-repository.js";
import { ManualClock } from "../../dist/src/core/clock.js";

const [databasePath, runtimeRoot, targetCheckpoint, digest] = process.argv.slice(2);
if (!databasePath || !runtimeRoot || !targetCheckpoint || !digest)
  throw new Error("Missing retention worker arguments");

const providerId = `mpv1_${"1".repeat(64)}`;
const captureMs = 1_700_000_000_000;
const effectiveAtMs = captureMs + 86_400_000;
const deadlineMs = effectiveAtMs + 30 * 86_400_000;
const database = openSqliteDatabase(
  databasePath,
  loadMigrations(join(process.cwd(), "migrations")),
);
const journal = new SqliteArtifactRetentionJournal(database);
const store = await DurableArtifactStore.open({
  repository: new SqliteArtifactRepository(database),
  clock: new ManualClock(effectiveAtMs),
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
});
const boundary = await VaultArtifactRetentionBoundary.open({
  store,
  runtimeRoot,
});
const controller = createArtifactRetentionController({
  journal,
  artifacts: boundary,
  nowMs: () => effectiveAtMs,
  faultBoundary: async (checkpoint) => {
    if (checkpoint !== targetCheckpoint) return;
    process.send?.({ type: "checkpoint", checkpoint });
    await new Promise(() => undefined);
  },
});

await controller.enforceStop({
  policyId: "p1-10-alpaca-private-retention-v1",
  providerLane: "alpaca",
  providerId,
  effectiveAtMs,
  deadlineMs,
  reason: "owner-revocation",
});
database.close();
process.send?.({ type: "complete" });
