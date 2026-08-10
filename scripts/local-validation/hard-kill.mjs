import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { canonicalBytes, sha256 } from "./contract.mjs";

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function executeBinding(workspace, manifest, binding, point) {
  const preload = resolve("scripts/local-validation/network-deny.cjs");
  const caseEntry = manifest.cases.find(({ id }) => id === binding.caseId);
  if (caseEntry === undefined) throw new Error(`hard-kill-bound-case-missing:${binding.caseId}`);
  if (
    sha256(readFileSync(caseEntry.executable.sourcePath)) !== binding.sourceSha256 ||
    caseEntry.executable.testName !== binding.testName
  ) {
    throw new Error(`hard-kill-source-binding-mismatch:${caseEntry.id}`);
  }
  const caseEnvironment = { ...process.env };
  delete caseEnvironment.NODE_TEST_CONTEXT;
  const executionId = `${caseEntry.id}-${sha256(point ?? "all-points").slice(0, 12)}`;
  const auditPath = join(workspace, `${executionId}.hard-kill-boundary-audit.jsonl`);
  rmSync(auditPath, { force: true });
  const child = spawnSync(
    process.execPath,
    [
      "--test",
      `--test-name-pattern=${caseEntry.executable.nodeTestNamePattern}`,
      caseEntry.executable.compiledPath,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...caseEnvironment,
        NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
        PEAS_NETWORK_DENIAL_INHERITED: "1",
        PEAS_EFFECTS_ALLOWED: "false",
        PEAS_LOCAL_VALIDATION_CASE_ID: caseEntry.id,
        PEAS_NETWORK_DENIAL_AUDIT_PATH: auditPath,
        ...(point === null ? {} : { PEAS_TEST_BOUNDARY: point }),
      },
    },
  );
  const transcript = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  if (child.status !== 0 || !/(?:ℹ pass 1|# pass 1)/u.test(transcript)) {
    throw new Error(
      `hard-kill-executable-case-failed:${caseEntry.id}:${point}:${child.status}:${transcript}`,
    );
  }
  const boundaryAudits = readFileSync(auditPath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  if (
    boundaryAudits.length < 2 ||
    boundaryAudits.some(
      ({ pid, childDenialInherited, successfulOutboundTransports }) =>
        childDenialInherited !== true || successfulOutboundTransports !== 0 || processExists(pid),
    )
  ) {
    throw new Error(`hard-kill-boundary-audit-invalid:${caseEntry.id}:${point}`);
  }
  return {
    auditedProcessCount: boundaryAudits.length,
    boundaryAuditSha256: sha256(readFileSync(auditPath)),
    caseId: caseEntry.id,
    claimedPoints: point === null ? binding.points : [point],
    exitCode: child.status,
    sourcePath: binding.sourcePath,
    sourceSha256: binding.sourceSha256,
    testName: binding.testName,
    transcriptSha256: sha256(transcript),
  };
}

export async function executeHardKillMatrix(workspace, manifest) {
  if (manifest.hardKillBindings.length === 0) {
    throw new Error("hard-kill-executable-bindings-missing");
  }
  const results = [];
  for (const binding of manifest.hardKillBindings) {
    if (binding.supportsPointFilter) {
      for (const point of binding.points) {
        results.push(executeBinding(workspace, manifest, binding, point));
      }
    } else {
      results.push(executeBinding(workspace, manifest, binding, null));
    }
  }
  const pointClaims = [...new Set(results.flatMap(({ claimedPoints }) => claimedPoints))].sort();
  const expected = [...manifest.hardKillPoints].sort();
  if (canonicalBytes(pointClaims) !== canonicalBytes(expected)) {
    throw new Error("hard-kill-point-coverage-incomplete");
  }
  return Object.freeze({
    status: "passed",
    boundSelectorCount: new Set(results.map(({ caseId }) => caseId)).size,
    executionCount: results.length,
    pointClaims,
    pointClaimsSha256: sha256(canonicalBytes(pointClaims)),
    results,
  });
}
