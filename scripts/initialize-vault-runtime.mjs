import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

const provisioningParent = resolve(process.cwd(), ".tmp-output-integrity");
mkdirSync(provisioningParent, { recursive: true });
const provisioningRoot = mkdtempSync(join(provisioningParent, "p1-10-provisioning-"));
const provisioningSourceRoot = join(provisioningRoot, "src");
const provisioningAuthorityPath = join(
  provisioningSourceRoot,
  "internal-provisioning-authority.js",
);
const activatedProvisioningAuthority = `
const boundRuntimeRoot = ${JSON.stringify(root)};
let available = true;
export const P1_10_PROVISIONING_AUTHORITY = Object.freeze({
  claim(runtimeRoot) {
    if (!available) throw new TypeError("credential-authority-provisioning-consumed");
    available = false;
    if (runtimeRoot !== boundRuntimeRoot) {
      throw new TypeError("credential-authority-provisioning-root-mismatch");
    }
  },
});
`;
let database;
try {
  cpSync(resolve(process.cwd(), "dist/src"), provisioningSourceRoot, { recursive: true });
  writeFileSync(provisioningAuthorityPath, activatedProvisioningAuthority, {
    encoding: "utf8",
    flag: "w",
  });
  const { provisionSqliteDurableCredentialAuthorityRuntime } = await import(
    pathToFileURL(join(provisioningSourceRoot, "adapters/market-acquisition/credentials.js")).href
  );
  const migrations = loadMigrations(join(process.cwd(), "migrations"));
  provisionSqliteDurableCredentialAuthorityRuntime(migrations);
  database = openSqliteDatabase(paths.databasePath, migrations);
  const journalMode = database.pragma("journal_mode", { simple: true });
  if (String(journalMode).toLowerCase() !== "wal")
    throw new Error("Vault SQLite is not in WAL mode");
  const migrationRows = database
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
        migrations: migrationRows,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  database?.close();
  rmSync(provisioningRoot, { recursive: true, force: true });
}
