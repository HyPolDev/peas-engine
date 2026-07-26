import { join } from "node:path";

import { openSqliteDatabase, loadMigrations } from "../../dist/src/adapters/sqlite/database.js";
import { DefaultArtifactRetentionController } from "../../dist/src/adapters/market-acquisition/retention/controller.js";
import { SqliteArtifactRetentionJournal } from "../../dist/src/adapters/market-acquisition/retention/sqlite-journal.js";
import { VaultArtifactRetentionBoundary } from "../../dist/src/adapters/market-acquisition/retention/vault-boundary.js";

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
const boundary = await VaultArtifactRetentionBoundary.open({
  store: {
    async settleForRetention() {
      return true;
    },
  },
  runtimeRoot,
});
const controller = new DefaultArtifactRetentionController({
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
