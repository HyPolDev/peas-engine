import { join } from "node:path";
import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

const databasePath = process.argv[2];
if (databasePath === undefined) throw new Error("Worker database path is required");
if (process.send === undefined) throw new Error("SQLite worker requires an IPC channel");

const importBuilt = async (relativePath) =>
  import(pathToFileURL(join(process.cwd(), "dist", ...relativePath)).href);

const databaseModule = await importBuilt(["src", "adapters", "sqlite", "database.js"]);
const eventLogModule = await importBuilt(["src", "adapters", "sqlite", "event-log.js"]);
const processingStoreModule = await importBuilt([
  "src",
  "adapters",
  "sqlite",
  "processing-store.js",
]);
const clockModule = await importBuilt(["src", "core", "clock.js"]);

const migrations = databaseModule.loadMigrations(join(process.cwd(), "migrations"));

let database;
try {
  database = databaseModule.openSqliteDatabase(databasePath, migrations);
} catch (error) {
  process.send({
    type: "fatal",
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
  process.exit(1);
}

function finish(message) {
  process.send(message, () => {
    database.close();
    process.exit(0);
  });
}

function failure(error) {
  finish({
    type: "result",
    ok: false,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
}

process.once("message", async (command) => {
  try {
    switch (command.operation) {
      case "append": {
        const clock = new clockModule.ManualClock(command.nowMs);
        const eventLog = new eventLogModule.SqliteEventLog(database, { clock });
        const result = await eventLog.append(command.draft);
        finish({ type: "result", ok: true, value: result });
        return;
      }
      case "claimJobs":
      case "claimOutbox": {
        const store = new processingStoreModule.SqliteProcessingStore(database);
        const method = command.operation === "claimJobs" ? "claimJobs" : "claimOutbox";
        const claims = await store[method](
          command.runId,
          command.workerId,
          command.nowMs,
          command.leaseMs,
          command.limit,
        );
        finish({ type: "result", ok: true, value: claims });
        return;
      }
      case "holdTransaction": {
        database.exec("BEGIN IMMEDIATE");
        for (const statement of command.statements) {
          if (statement.params === undefined) database.exec(statement.sql);
          else database.prepare(statement.sql).run(...statement.params);
        }
        process.send({ type: "staged" });
        setInterval(() => undefined, 60_000);
        return;
      }
      default:
        throw new Error(`Unsupported SQLite worker operation ${String(command.operation)}`);
    }
  } catch (error) {
    failure(error);
  }
});

process.send({ type: "ready", pid: process.pid });

// Keep the direct import exercised so packaging failures are visible before a crash probe starts.
if (typeof Database !== "function") throw new Error("better-sqlite3 failed to load");
