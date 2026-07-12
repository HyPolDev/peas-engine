import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const testFiles = readdirSync(join(process.cwd(), "dist", "test"))
  .filter((name) => name.endsWith(".test.js") && name !== "evidence-reconciliation.test.js")
  .sort()
  .map((name) => join("dist", "test", name));

const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    "--experimental-test-coverage",
    "--test-coverage-lines=90",
    "--test-coverage-branches=80",
    "--test-coverage-functions=95",
    "--test-coverage-include=dist/src/**/*.js",
    "--test-reporter=spec",
    "--test-reporter=./scripts/audit-test-reporter.mjs",
    "--test-reporter-destination=stdout",
    "--test-reporter-destination=audit-test-results.json",
    ...testFiles,
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, PEAS_SKIP_HARD_KILL_MATRIX: "1" },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
