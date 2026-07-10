import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  windowsHide: true,
}).trim();

const passingCheckResults = {
  tests: {
    path: "audit-test-results.json",
    fileSha256: "1".repeat(64),
    value: {
      resultVersion: 1,
      status: "passed",
      tests: { tests: 50, failed: 0, passed: 50, skipped: 0 },
      coverage: {
        lines: { percent: 92, threshold: 90 },
        branches: { percent: 82, threshold: 80 },
        functions: { percent: 96, threshold: 95 },
      },
    },
  },
  mutations: {
    path: "audit-mutation-results.json",
    fileSha256: "2".repeat(64),
    value: { resultVersion: 1, status: "passed", killed: 5, total: 5 },
  },
};

function evidence(gateName: string, options: { runId: string; runnerOs: "Linux" | "Windows" }) {
  const clusterCount = gateName === "scale-10k-linux" ? 10_000 : 100_000;
  const isScale = gateName.startsWith("scale-");
  const isManual100k = gateName === "scale-100k-linux";
  return {
    evidenceVersion: 2,
    candidateCommitSha: candidateSha,
    worktreeClean: true,
    gate: {
      name: gateName,
      command: "synthetic audit regression",
      status: "passed",
      trigger: isManual100k
        ? { kind: "pull_request_label", value: "audit-100k", actor: "audit-user" }
        : null,
    },
    githubRun: {
      eventName: "pull_request",
      eventSha: candidateSha,
      workflow: "CI",
      workflowRef: "HyPolDev/peas-engine/.github/workflows/ci.yml@refs/heads/candidate",
      workflowSha: candidateSha,
      runId: options.runId,
      runAttempt: "1",
      job: gateName,
      repository: "HyPolDev/peas-engine",
      runUrl: `https://github.com/HyPolDev/peas-engine/actions/runs/${options.runId}`,
    },
    runner: {
      os: options.runnerOs,
      arch: "X64",
      environment: "github-hosted",
      imageOs: options.runnerOs === "Windows" ? "win25" : "ubuntu24",
      imageVersion: "synthetic",
    },
    runtime: { node: "24.17.0", npm: "12.0.0", expectedPackageManager: "npm@12.0.0" },
    golden: { fileSha256: "3".repeat(64) },
    capturedStream: { fileSha256: "4".repeat(64), eventCount: 13 },
    sourceInputs: { packageLockSha256: "5".repeat(64) },
    checkResults: gateName.startsWith("check-") || isManual100k ? passingCheckResults : null,
    scaleMetrics: isScale
      ? [
          {
            candidateCommitSha: candidateSha,
            clusterCount,
            gateStatus: "passed",
            integrityCheck: "ok",
            worktreeClean: true,
          },
        ]
      : [],
  };
}

test("release evidence reconciliation requires four passing gates on one candidate", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "peas-evidence-reconcile-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const records = [
    evidence("check-linux", { runId: "100", runnerOs: "Linux" }),
    evidence("check-windows", { runId: "100", runnerOs: "Windows" }),
    evidence("scale-10k-linux", { runId: "100", runnerOs: "Linux" }),
    evidence("scale-100k-linux", { runId: "100", runnerOs: "Linux" }),
  ];
  for (const record of records) {
    writeFileSync(
      join(directory, `audit-evidence-${record.gate.name}.json`),
      `${JSON.stringify(record)}\n`,
    );
  }

  const manifestPath = join(directory, "release-manifest.json");
  const script = join(process.cwd(), "scripts", "reconcile-audit-evidence.mjs");
  const accepted = spawnSync(process.execPath, [script, directory], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      PEAS_CANDIDATE_SHA: candidateSha,
      PEAS_RELEASE_MANIFEST_PATH: manifestPath,
    },
  });
  assert.equal(accepted.status, 0, `${accepted.stdout}${accepted.stderr}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.candidateCommitSha, candidateSha);
  assert.equal(manifest.reconciliationStatus, "passed");
  assert.deepEqual(Object.keys(manifest.gates).sort(), [
    "check-linux",
    "check-windows",
    "scale-100k-linux",
    "scale-10k-linux",
  ]);

  const windowsRecord = records[1];
  assert.ok(windowsRecord);
  windowsRecord.githubRun.runId = "different-ci-run";
  writeFileSync(
    join(directory, "audit-evidence-check-windows.json"),
    `${JSON.stringify(windowsRecord)}\n`,
  );
  const rejected = spawnSync(process.execPath, [script, directory], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PEAS_CANDIDATE_SHA: candidateSha },
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /must come from one CI run/u);
});
