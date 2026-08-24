import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { canonicalBytes, sanitizedLocalValidationChildEnvironment, sha256 } from "./contract.mjs";
import { measureWorkerOwnership } from "./worker-accounting.mjs";

export function validateHardKillWorkerEvidence({
  boundaryAudits,
  lifecycleEvents,
  rootClaims,
  rootOwnerToken,
  rootOwnerPid,
  platform,
}) {
  if (
    !Array.isArray(boundaryAudits) ||
    !Array.isArray(lifecycleEvents) ||
    !Array.isArray(rootClaims) ||
    rootClaims.length === 0
  ) {
    throw new Error("hard-kill-worker-evidence-schema-invalid");
  }
  if (boundaryAudits.length < 2) throw new Error("hard-kill-worker-audit-count-invalid");
  if (
    boundaryAudits.some(
      ({ childDenialInherited, successfulOutboundTransports }) =>
        childDenialInherited !== true || successfulOutboundTransports !== 0,
    )
  )
    throw new Error("hard-kill-worker-capability-audit-invalid");
  const workerOwnership = measureWorkerOwnership({
    groupId: rootClaims[0]?.groupId,
    rootOwnerToken,
    rootOwnerPid,
    directClaims: rootClaims,
    audits: boundaryAudits,
    lifecycleEvents,
    platform,
  });
  if (workerOwnership.measuredWorkers !== 0) {
    throw new Error(
      `hard-kill-worker-residue:${JSON.stringify({
        measuredWorkers: workerOwnership.measuredWorkers,
        liveOwnedCount: workerOwnership.liveOwnedCount,
        orphanCount: workerOwnership.orphanCount,
        unownedCount: workerOwnership.unownedCount,
        ambiguousCount: workerOwnership.ambiguousCount,
        accountingErrorCount: workerOwnership.accountingErrorCount,
        liveOwnedEvidence: workerOwnership.liveOwnedEvidence.slice(0, 8),
        issues: workerOwnership.issues.slice(0, 16),
        ownershipEvidenceSha256: workerOwnership.ownershipEvidenceSha256,
      })}`,
    );
  }
  return workerOwnership;
}

function appendParentLifecycle(lifecyclePath, claim, transition) {
  appendFileSync(
    lifecyclePath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "worker-lifecycle",
      transition,
      groupId: claim.groupId,
      ownerToken: claim.ownerToken,
      ownerPid: claim.ownerPid,
      childToken: claim.childToken,
      pid: claim.pid,
      surface: claim.surface,
      exitCode: claim.exitCode,
      signalCode: claim.signalCode,
      errorCode: claim.errorCode,
    })}\n`,
    "utf8",
  );
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
  const caseEnvironment = sanitizedLocalValidationChildEnvironment();
  delete caseEnvironment.NODE_TEST_CONTEXT;
  // Process-kill contracts deliberately refuse V8 coverage instrumentation.
  // A coverage parent must not turn an owned hard-kill execution into a skip.
  delete caseEnvironment.NODE_V8_COVERAGE;
  const executionId = `${caseEntry.id}-${sha256(point ?? "all-points").slice(0, 12)}`;
  const auditPath = join(workspace, `${executionId}.hard-kill-boundary-audit.jsonl`);
  const lifecyclePath = join(workspace, `${executionId}.hard-kill-worker-lifecycle.jsonl`);
  rmSync(auditPath, { force: true });
  rmSync(lifecyclePath, { force: true });
  const rootOwnerToken = randomUUID();
  const rootClaim = {
    schemaVersion: 1,
    groupId: randomUUID(),
    ownerToken: rootOwnerToken,
    ownerPid: process.pid,
    childToken: randomUUID(),
    pid: null,
    surface: "child_process.spawnSync",
    state: "live",
    exitCode: null,
    signalCode: null,
    errorCode: null,
  };
  appendParentLifecycle(lifecyclePath, rootClaim, "spawn-intent");
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
        PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH: lifecyclePath,
        PEAS_LOCAL_VALIDATION_WORKER_GROUP_ID: rootClaim.groupId,
        PEAS_LOCAL_VALIDATION_WORKER_TOKEN: rootClaim.childToken,
        PEAS_LOCAL_VALIDATION_WORKER_OWNER_TOKEN: rootOwnerToken,
        PEAS_LOCAL_VALIDATION_WORKER_EXPECTED_PARENT_PID: String(process.pid),
        PEAS_LOCAL_VALIDATION_WORKER_SURFACE: rootClaim.surface,
        ...(point === null ? {} : { PEAS_TEST_BOUNDARY: point }),
      },
    },
  );
  rootClaim.pid = Number.isSafeInteger(child.pid) && child.pid > 0 ? child.pid : null;
  if (rootClaim.pid !== null) appendParentLifecycle(lifecyclePath, rootClaim, "claimed");
  const childExitCode = Number.isInteger(child.status) ? child.status : null;
  const childSignalCode = typeof child.signal === "string" ? child.signal : null;
  const childErrorCode = typeof child.error?.code === "string" ? child.error.code : null;
  if (
    rootClaim.pid === null ||
    childErrorCode !== null ||
    (childExitCode === null) === (childSignalCode === null)
  ) {
    rootClaim.state = "accounting-error";
    rootClaim.exitCode = null;
    rootClaim.signalCode = null;
    rootClaim.errorCode = childErrorCode ?? "spawn-result-terminal-invalid";
    appendParentLifecycle(lifecyclePath, rootClaim, "accounting-error");
  } else {
    rootClaim.state = "settled";
    rootClaim.exitCode = childExitCode;
    rootClaim.signalCode = childSignalCode;
    appendParentLifecycle(lifecyclePath, rootClaim, "settled");
  }
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
  const lifecycleEvents = readFileSync(lifecyclePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  let workerOwnership;
  try {
    workerOwnership = validateHardKillWorkerEvidence({
      boundaryAudits,
      lifecycleEvents,
      rootClaims: [rootClaim],
      rootOwnerToken,
      rootOwnerPid: process.pid,
      platform: process.platform,
    });
  } catch (error) {
    const boundedReason =
      error instanceof Error ? error.message : "hard-kill-worker-evidence-unknown";
    throw new Error(`hard-kill-boundary-audit-invalid:${caseEntry.id}:${point}:${boundedReason}`, {
      cause: error,
    });
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
    workerOwnershipSha256: workerOwnership.ownershipEvidenceSha256,
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
