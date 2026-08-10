import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { sha256 } from "./contract.mjs";

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function executeHardKillMatrix(workspace, manifest) {
  const preload = resolve("scripts/local-validation/network-deny.cjs");
  const cases = manifest.cases.filter(({ executable }) => /hard.kill/iu.test(executable.testName));
  if (cases.length === 0) throw new Error("hard-kill-executable-cases-missing");
  const results = [];
  for (const caseEntry of cases) {
    if (sha256(readFileSync(caseEntry.executable.sourcePath)) !== caseEntry.fixture.sha256) {
      throw new Error(`hard-kill-source-digest-mismatch:${caseEntry.id}`);
    }
    const caseEnvironment = { ...process.env };
    delete caseEnvironment.NODE_TEST_CONTEXT;
    const auditPath = join(workspace, `${caseEntry.id}.hard-kill-boundary-audit.jsonl`);
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
        },
      },
    );
    const transcript = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
    if (child.status !== 0 || !/(?:ℹ pass 1|# pass 1)/u.test(transcript)) {
      throw new Error(
        `hard-kill-executable-case-failed:${caseEntry.id}:${child.status}:${transcript}`,
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
      throw new Error(`hard-kill-boundary-audit-invalid:${caseEntry.id}`);
    }
    results.push({
      boundaryAuditSha256: sha256(readFileSync(auditPath)),
      auditedProcessCount: boundaryAudits.length,
      caseId: caseEntry.id,
      sourcePath: caseEntry.executable.sourcePath,
      testName: caseEntry.executable.testName,
      exitCode: child.status,
      transcriptSha256: sha256(transcript),
    });
  }
  return Object.freeze({
    status: "passed",
    executableHardKillCaseCount: results.length,
    pointClaims: "none-derived-only-from-executed-source-assertions",
    results,
  });
}
