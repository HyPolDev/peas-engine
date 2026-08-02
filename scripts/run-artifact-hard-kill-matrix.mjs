import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const inventoryPath = join(process.cwd(), "config", "artifact-fault-boundaries.json");
const inventoryBytes = readFileSync(inventoryPath);
const inventory = JSON.parse(inventoryBytes.toString("utf8"));
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  windowsHide: true,
}).trim();
const expectedSha = process.env["PEAS_CANDIDATE_SHA"] ?? head;
if (expectedSha !== head) throw new Error(`Hard-kill candidate ${expectedSha} is not ${head}`);
const tested = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-reporter=tap",
    "--test-name-pattern=hard-kill boundar",
    join("dist", "test", "artifact-vault.test.js"),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PEAS_SKIP_HARD_KILL_MATRIX: "0",
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  },
);
process.stdout.write(tested.stdout ?? "");
process.stderr.write(tested.stderr ?? "");
const passed = tested.status === 0;
const report = {
  resultVersion: 1,
  status: passed ? "passed" : "failed",
  candidateCommitSha: expectedSha,
  faultBoundaryInventory: {
    path: "config/artifact-fault-boundaries.json",
    sha256: createHash("sha256").update(inventoryBytes).digest("hex"),
  },
  childExitMode: "SIGKILL",
  boundaries: inventory.boundaries.map(({ name, medium }) => ({
    name,
    medium,
    restartCount: 2,
    converged: passed,
  })),
};
writeFileSync(
  process.env["PEAS_HARD_KILL_EVIDENCE_PATH"] ?? "audit-hard-kill-results.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
if (!passed) process.exitCode = tested.status ?? 1;
