import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  artifactRuntimePaths,
  configuredPeasRuntimeRoot,
} from "../dist/src/adapters/artifacts/runtime-root.js";
import { loadMigrations, openSqliteDatabase } from "../dist/src/adapters/sqlite/database.js";

const validationPath = process.env.PEAS_RUNTIME_VALIDATION_PATH;
if (validationPath === undefined || !existsSync(validationPath)) {
  throw new Error("PEAS_RUNTIME_VALIDATION_PATH must reference passing runtime-root validation");
}
const policyBytes = readFileSync("config/artifact-vault-deployment-policy.v1.json");
const policySha256 = createHash("sha256").update(policyBytes).digest("hex");
const validation = JSON.parse(readFileSync(validationPath, "utf8"));
const root = configuredPeasRuntimeRoot();
const paths = artifactRuntimePaths(root);
if (
  validation.status !== "passed" ||
  resolve(validation.runtimeRoot) !== root ||
  validation.policySha256 !== policySha256 ||
  resolve(validation.layout?.database ?? "") !== paths.databasePath
) {
  throw new Error("Runtime-root validation does not authorize this configured layout");
}

const database = openSqliteDatabase(
  paths.databasePath,
  loadMigrations(join(process.cwd(), "migrations")),
);
try {
  const journalMode = database.pragma("journal_mode", { simple: true });
  if (String(journalMode).toLowerCase() !== "wal")
    throw new Error("Vault SQLite is not in WAL mode");
  const migrations = database
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => ({ version: Number(row.version), name: row.name }));
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "passed",
        runtimeRoot: root,
        databasePath: paths.databasePath,
        journalMode: "wal",
        migrations,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  database.close();
}
