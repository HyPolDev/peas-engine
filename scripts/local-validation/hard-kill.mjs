import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { canonicalBytes, readJson, sha256 } from "./contract.mjs";

function killAtPoint(inputPath, preload) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--require", preload, "scripts/local-validation/hard-kill-worker.mjs"],
      {
        cwd: process.cwd(),
        windowsHide: true,
        env: { ...process.env, PEAS_LOCAL_VALIDATION_HARD_KILL_INPUT: inputPath },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("hard-kill-ready-timeout"));
    }, 10_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("READY")) child.kill("SIGKILL");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (!stdout.includes("READY") || (code === 0 && signal === null)) {
        reject(new Error(`hard-kill-not-observed:${String(code)}:${String(signal)}:${stderr}`));
        return;
      }
      resolvePromise({ code, signal });
    });
  });
}

export async function executeHardKillMatrix(workspace, manifest) {
  const preload = resolve("scripts/local-validation/network-deny.cjs");
  const cases = manifest.cases.map(({ id }) => id);
  const results = [];
  for (const point of manifest.hardKillPoints) {
    const inputPath = join(workspace, `hard-kill-${point}-input.json`);
    const statePath = join(workspace, `hard-kill-${point}-state.json`);
    rmSync(statePath, { force: true });
    writeFileSync(inputPath, canonicalBytes({ point, caseIds: cases, statePath }), "utf8");
    const exit = await killAtPoint(inputPath, preload);
    if (!existsSync(statePath)) throw new Error(`hard-kill-durable-state-missing:${point}`);
    const recovered = readJson(statePath);
    if (
      recovered.point !== point ||
      recovered.cases.length !== cases.length ||
      recovered.cases.some(
        (entry, index) =>
          entry.caseId !== cases[index] ||
          entry.checkpointSha256 !== sha256(`${point}:${entry.caseId}`),
      )
    ) {
      throw new Error(`hard-kill-recovery-mismatch:${point}`);
    }
    results.push({ point, exit, recoveredCaseCount: recovered.cases.length });
  }
  return Object.freeze({
    status: "passed",
    physicalKillCount: results.length,
    coveredVectorCount: results.length * cases.length,
    results,
  });
}
