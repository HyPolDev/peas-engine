import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DurableArtifactStore } from "../dist/src/adapters/artifacts/durable-artifact-store.js";
import { configuredPeasRuntimeRoot } from "../dist/src/adapters/artifacts/runtime-root.js";
import { SqliteArtifactRepository } from "../dist/src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadMigrations, openSqliteDatabase } from "../dist/src/adapters/sqlite/database.js";
import { ManualClock } from "../dist/src/core/clock.js";

const root = configuredPeasRuntimeRoot();
const fixture = mkdtempSync(join(tmpdir(), "peas-cross-device-"));
const rootDevice = String(lstatSync(root).dev);
const fixtureDevice = String(lstatSync(fixture).dev);
if (rootDevice === fixtureDevice) throw new Error("A distinct second device is required");
const databasePath = join(fixture, "outside.sqlite");
const database = openSqliteDatabase(
  databasePath,
  loadMigrations(join(process.cwd(), "migrations")),
);
let rejected = false;
try {
  try {
    await DurableArtifactStore.open({
      repository: new SqliteArtifactRepository(database),
      clock: new ManualClock(1_800_000_000_000),
      config: {
        runtimeRootMode: "configured",
        runtimeRoot: root,
        maxArtifactBytes: 1_024,
        maxVaultBytes: 4_096,
        maxConcurrentWrites: 1,
        streamHighWaterMarkBytes: 64,
        stageExpiryMs: 1_000,
        writerLeaseBehavior: "fail",
        writerLeaseWaitMs: 0,
        writerLeaseDurationMs: 30_000,
        writerLeaseRenewalMs: 10_000,
      },
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/SQLite database, WAL, and artifact vault must share/u.test(error.message)
    ) {
      throw error;
    }
    rejected = true;
  }
} finally {
  database.close();
  rmSync(fixture, { recursive: true, force: true });
}
if (!rejected) throw new Error("Cross-device repository was not rejected");
const result = {
  schemaVersion: 1,
  candidateCommitSha:
    process.env.PEAS_CANDIDATE_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
  status: "passed",
  configuredRootDevice: rootDevice,
  negativeFixtureDevice: fixtureDevice,
  databaseOutsideRuntimeRootRejected: true,
  syntheticFixturesOnly: true,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const output = process.env.PEAS_CROSS_DEVICE_EVIDENCE_PATH;
if (output === undefined) process.stdout.write(serialized);
else {
  writeFileSync(output, serialized, "utf8");
  console.log(`Wrote ${output}`);
}
