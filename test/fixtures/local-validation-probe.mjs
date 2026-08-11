import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";

import {
  acquireGateLock,
  canonicalBytes,
  compileManifest,
  listFiles,
  platformIdentity,
  readJson,
  repositoryIdentity,
  verifyCandidate,
  verifyFrozenManifest,
} from "../../scripts/local-validation/contract.mjs";
import {
  executeSyntheticMatrix,
  provisionValidationRuntime,
} from "../../scripts/local-validation/runtime.mjs";
import { executeHardKillMatrix } from "../../scripts/local-validation/hard-kill.mjs";

const [operation, argument] = process.argv.slice(2);

if (operation === "manifest") {
  const { manifest, digest } = verifyFrozenManifest();
  process.stdout.write(`${JSON.stringify({ count: manifest.caseCount, digest })}\n`);
} else if (operation === "compile") {
  process.stdout.write(canonicalBytes(compileManifest(readJson(argument))));
} else if (operation === "candidate") {
  process.stdout.write(`${JSON.stringify(verifyCandidate(argument))}\n`);
} else if (operation === "evidence-fixture-identity") {
  const { manifest, digest } = verifyFrozenManifest();
  process.stdout.write(
    canonicalBytes({
      candidate: repositoryIdentity(),
      manifest: { id: manifest.manifestId, caseCount: manifest.caseCount, sha256: digest },
      migrations: listFiles("migrations"),
      platform: platformIdentity(),
    }),
  );
} else if (operation === "lock-overlap") {
  const lock = acquireGateLock(argument);
  try {
    acquireGateLock(argument);
  } finally {
    lock.release();
  }
} else if (operation === "lock-stale") {
  const lock = acquireGateLock(argument, { nowMs: 30_000_000, staleAfterMs: 1 });
  lock.release();
  process.stdout.write("recovered\n");
} else if (operation === "lock-crash") {
  acquireGateLock(argument, { nowMs: 1, staleAfterMs: 1 });
  process.stdout.write("crashed-with-committed-claim\n");
} else if (operation === "lock-recover-hold") {
  const lock = acquireGateLock(argument, { nowMs: 30_000_000, staleAfterMs: 1 });
  process.stdout.write("acquired\n");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  lock.release();
} else if (operation === "lock-recover-once") {
  const lock = acquireGateLock(argument, { nowMs: 30_000_001, staleAfterMs: 1 });
  lock.release();
  process.stdout.write("recovered-on-retry\n");
} else if (operation === "lock-recovery-crash") {
  try {
    acquireGateLock(argument, {
      nowMs: 30_000_000,
      staleAfterMs: 1,
      onStaleObserved() {
        throw new Error("injected-recovery-crash");
      },
    });
    throw new Error("recovery-crash-unexpectedly-acquired");
  } catch (error) {
    if (!/injected-recovery-crash/u.test(String(error))) throw error;
  }
  const retry = acquireGateLock(argument, { nowMs: 30_000_001, staleAfterMs: 1 });
  retry.release();
  process.stdout.write("recovery-crash-recovered\n");
} else if (operation === "lock-hold-write-transaction") {
  const database = new Database(argument);
  database.pragma("busy_timeout = 0");
  database.exec("BEGIN IMMEDIATE");
  process.stdout.write("held\n");
  await new Promise((resolve) => setTimeout(resolve, 500));
  database.exec("ROLLBACK");
  database.close();
} else if (operation === "lock-release-contention") {
  const lock = acquireGateLock(argument);
  const contender = spawn(
    process.execPath,
    [process.argv[1], "lock-hold-write-transaction", argument],
    { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  contender.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const contenderExit = new Promise((resolve) => contender.once("exit", resolve));
  await new Promise((resolve, reject) => {
    let stdout = "";
    contender.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("held\n")) resolve();
    });
    contender.once("error", reject);
    contenderExit.then((code) => {
      if (!stdout.includes("held\n")) {
        reject(new Error(`contender-exited-before-lock:${code}:${stderr}`));
      }
    });
  });
  lock.release();
  const exitCode = await contenderExit;
  if (exitCode !== 0) throw new Error(`contender-failed:${exitCode}:${stderr}`);
  const retry = acquireGateLock(argument);
  retry.release();
  process.stdout.write("release-contention-settled\n");
} else if (operation === "runtime") {
  const root = argument;
  const identity = repositoryIdentity();
  const first = provisionValidationRuntime(root, identity);
  const second = provisionValidationRuntime(root, identity);
  process.stdout.write(`${JSON.stringify({ first, second })}\n`);
} else if (operation === "runtime-corrupt") {
  const root = argument;
  mkdirSync(join(root, "sqlite"), { recursive: true });
  writeFileSync(join(root, "sqlite", "peas.sqlite"), "primary-state", "utf8");
  process.stdout.write(
    `${JSON.stringify(provisionValidationRuntime(root, repositoryIdentity()))}\n`,
  );
} else if (operation === "runtime-corrupt-staging") {
  const root = argument;
  mkdirSync(join(root, "artifacts", "staging"), { recursive: true });
  writeFileSync(join(root, "artifacts", "staging", "existing.bin"), "primary-state", "utf8");
  process.stdout.write(
    `${JSON.stringify(provisionValidationRuntime(root, repositoryIdentity()))}\n`,
  );
} else if (operation === "execute") {
  const root = argument;
  const { manifest } = verifyFrozenManifest();
  provisionValidationRuntime(root, repositoryIdentity());
  const result = executeSyntheticMatrix(root, manifest, { limit: 2 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (operation === "execute-credential-effect") {
  const root = argument;
  const { manifest } = verifyFrozenManifest();
  provisionValidationRuntime(root, repositoryIdentity());
  executeSyntheticMatrix(root, manifest, { limit: 1, credentialPresentCount: 1 });
} else if (operation === "execute-residue") {
  const root = argument;
  const { manifest } = verifyFrozenManifest();
  provisionValidationRuntime(root, repositoryIdentity());
  executeSyntheticMatrix(root, manifest, {
    limit: 1,
    beforeResidueInspection(caseRoot) {
      const lockDirectory = join(caseRoot, "injected", "locks");
      mkdirSync(lockDirectory, { recursive: true });
      writeFileSync(join(lockDirectory, "leaked.lock"), "leak", "utf8");
    },
  });
} else if (operation === "hard-kill") {
  const { manifest } = verifyFrozenManifest();
  const binding = manifest.hardKillBindings[0];
  const point = binding.points[0];
  const result = await executeHardKillMatrix(argument, {
    ...manifest,
    hardKillPoints: [point],
    hardKillBindings: [{ ...binding, points: [point] }],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (operation === "read") {
  process.stdout.write(readFileSync(argument, "utf8"));
} else {
  throw new Error("probe-operation-invalid");
}
