import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

import {
  AUTHORIZATION_VALUE,
  acquireGateLock,
  assertCredentialAndAccountAbsence,
  canonicalBytes,
  platformIdentity,
  readJson,
  repositoryIdentity,
  safeTemporaryRuntime,
  verifyCandidate,
  verifyFrozenManifest,
} from "./contract.mjs";
import { executeHardKillMatrix } from "./hard-kill.mjs";

async function run() {
  const mode = process.argv[2];
  if (mode !== "corpus" && mode !== "integration") throw new Error("local-validation-mode-invalid");
  const identity =
    mode === "corpus" || process.env.PEAS_LOCAL_VALIDATION_CANDIDATE_SHA !== undefined
      ? verifyCandidate()
      : repositoryIdentity();
  if (
    mode === "corpus" &&
    process.env.PEAS_LOCAL_VALIDATION_AUTHORIZATION !== AUTHORIZATION_VALUE
  ) {
    return {
      output: {
        decision: "LOCAL_TEST_NO_GO",
        reason: "separate-corpus-authorization-required",
      },
      exitCode: 2,
    };
  }
  const lockPath =
    process.env.PEAS_LOCAL_VALIDATION_LOCK_PATH ??
    join(safeTemporaryRuntime(tmpdir()), "peas-local-validation-gate.v1.lock");
  const lock = acquireGateLock(lockPath);
  const parent = resolve(process.env.PEAS_LOCAL_VALIDATION_TEMP_PARENT ?? tmpdir());
  const workspace = mkdtempSync(join(parent, "peas-local-validation-"));
  const runtimeRoot = join(workspace, "runtime");
  const outputPath = join(workspace, "worker-result.json");
  const inputPath = join(workspace, "worker-input.json");
  mkdirSync(runtimeRoot, { recursive: true });
  try {
    assertCredentialAndAccountAbsence();
    const { manifest, digest } = verifyFrozenManifest();
    writeFileSync(
      inputPath,
      canonicalBytes({
        identity,
        manifest,
        runtimeRoot,
        outputPath,
        limit: mode === "integration" ? 2 : null,
      }),
      "utf8",
    );
    const preload = resolve("scripts/local-validation/network-deny.cjs");
    const child = spawnSync(
      process.execPath,
      ["--require", preload, "scripts/local-validation/worker.mjs"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          PEAS_LOCAL_VALIDATION_WORKER_INPUT: inputPath,
          PEAS_NETWORK_DENIAL_INHERITED: "1",
          PEAS_RUNTIME_ROOT: runtimeRoot,
        },
        timeout: mode === "integration" ? 5 * 60_000 : 24 * 60 * 60_000,
      },
    );
    if (child.status !== 0) {
      throw new Error(`local-validation-worker-failed:${child.status}:${child.stderr}`);
    }
    const result = readJson(outputPath);
    const hardKill =
      mode === "corpus"
        ? await executeHardKillMatrix(workspace, manifest)
        : {
            status: "not-executed-in-integration-probe",
            executableHardKillCaseCount: 0,
          };
    const zeroEffects = Object.values(result.effects).every((value) => value === 0);
    const zeroCleanup = Object.values(result.cleanup).every((value) => value === 0);
    const passed =
      result.status === "passed" &&
      zeroEffects &&
      zeroCleanup &&
      (mode === "integration" ||
        (result.executedCaseCount === manifest.caseCount &&
          result.executionCount === manifest.caseCount * manifest.orderPermutations.length &&
          result.orderPermutationCount === manifest.orderPermutations.length &&
          result.productionResourceProofs.length > 0 &&
          result.resourceBoundaryResults.length === Object.keys(manifest.resourceCeilings).length &&
          result.resourceBoundaryResults.every(
            ({ exactAccepted, oneOverRejected }) => exactAccepted && oneOverRejected,
          ) &&
          hardKill.status === "passed" &&
          hardKill.executableHardKillCaseCount === manifest.executableCoverage.hardKill.length));
    const decision =
      mode === "corpus" ? (passed ? "LOCAL_TEST_GO" : "LOCAL_TEST_NO_GO") : passed ? "GO" : "NO_GO";
    const report = {
      schemaVersion: 1,
      mode,
      decision,
      candidate: identity,
      manifestSha256: digest,
      platform: platformIdentity(),
      result,
      hardKill,
    };
    const requestedOutput = process.env.PEAS_LOCAL_VALIDATION_RESULT_PATH;
    if (requestedOutput !== undefined) {
      mkdirSync(dirname(resolve(requestedOutput)), { recursive: true });
      writeFileSync(requestedOutput, canonicalBytes(report), "utf8");
    }
    return { output: report, exitCode: passed ? 0 : 1 };
  } finally {
    lock.release();
    rmSync(workspace, { recursive: true, force: true });
  }
}

try {
  const outcome = await run();
  process.stdout.write(`${JSON.stringify(outcome.output)}\n`);
  process.exitCode = outcome.exitCode;
} catch (error) {
  const mode = process.argv[2];
  process.stdout.write(
    `${JSON.stringify({
      decision: mode === "corpus" ? "LOCAL_TEST_NO_GO" : "NO_GO",
      reason: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
}
