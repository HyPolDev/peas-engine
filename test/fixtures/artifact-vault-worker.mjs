import { Readable } from "node:stream";
import { join } from "node:path";

import { DurableArtifactStore } from "../../dist/src/adapters/artifacts/durable-artifact-store.js";
import { SqliteArtifactRepository } from "../../dist/src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadMigrations, openSqliteDatabase } from "../../dist/src/adapters/sqlite/database.js";
import { sanitizeRequestIdentity } from "../../dist/src/artifacts/identity.js";
import { ManualClock } from "../../dist/src/core/clock.js";

const [databasePath, runtimeRoot, initialNow, targetCheckpoint] = process.argv.slice(2);
if (!databasePath || !runtimeRoot || !initialNow)
  throw new Error("Missing artifact worker arguments");

const database = openSqliteDatabase(
  databasePath,
  loadMigrations(join(process.cwd(), "migrations")),
);
const repository = new SqliteArtifactRepository(database);
const clock = new ManualClock(Number(initialNow));
const store = await DurableArtifactStore.open({
  repository,
  clock,
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
    if (targetCheckpoint === "failure-abort-transaction" && checkpoint === "install-intent-commit")
      throw new Error("Injected post-intent failure");
    if (checkpoint !== targetCheckpoint) return;
    process.send?.({ type: "checkpoint", checkpoint });
    await new Promise(() => undefined);
  },
});

let resume;
const resumed = new Promise((resolve) => {
  resume = resolve;
});

process.on("message", (message) => {
  if (message?.type === "resume") resume();
  if (message?.type === "close") {
    void store.close().finally(() => {
      database.close();
      process.exit(0);
    });
  }
});

async function* pausedEntity() {
  yield Buffer.from("cross-process-stale");
  process.send?.({ type: "staged" });
  await resumed;
}

const pending = store.store({
  attempt: {
    attemptId: "cross-process-stale",
    provider: "fixture-provider",
    recordId: "cross-process-record",
    revisionId: "1",
    startedAtMs: clock.nowMs(),
    request: sanitizeRequestIdentity({
      method: "GET",
      origin: "https://example.test",
      path: "/cross-process",
      routeLabel: "fixture.cross-process",
    }),
  },
  response: {
    statusCode: 200,
    etag: null,
    lastModified: null,
    mediaType: "application/octet-stream",
    contentEncoding: null,
    declaredContentLength: 19,
    transportDecoded: true,
  },
  entityBytes: Readable.from(pausedEntity()),
});

try {
  await pending;
  process.send?.({ type: "result", status: "committed" });
} catch (error) {
  process.send?.({
    type: "result",
    status: "rejected",
    message: error instanceof Error ? error.message : "unknown",
  });
}
