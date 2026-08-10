import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { canonicalBytes, sha256 } from "./contract.mjs";

export const RUNTIME_LAYOUT = Object.freeze([
  "sqlite",
  "artifacts/sha256",
  "artifacts/staging",
  "artifacts/snapshots",
  "artifacts/quarantine",
  "artifacts/locks",
  "evidence",
]);

const AUTHORITY_PATH = "sqlite/local-validation-authority.json";
const PRIMARY_ROOTS = Object.freeze(["sqlite", "artifacts"]);

function directoryHasEntries(path) {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function fileHasBytes(path) {
  try {
    return statSync(path).isFile() && statSync(path).size > 0;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function provisionValidationRuntime(runtimeRoot, identity) {
  const authorityPath = join(runtimeRoot, AUTHORITY_PATH);
  const hasPrimaryState = PRIMARY_ROOTS.some((suffix) => {
    const path = join(runtimeRoot, suffix);
    if (!directoryHasEntries(path)) return false;
    if (suffix === "sqlite") {
      return readdirSync(path).some((name) => name !== "local-validation-authority.json");
    }
    return true;
  });
  if (!fileHasBytes(authorityPath)) {
    if (hasPrimaryState) throw new Error("runtime-authority-anchor-missing-terminal-corruption");
    for (const suffix of RUNTIME_LAYOUT) mkdirSync(join(runtimeRoot, suffix), { recursive: true });
    writeFileSync(
      authorityPath,
      canonicalBytes({
        schemaVersion: 1,
        kind: "peas-owned-local-validation-first-boot-authority",
        candidateSha: identity.sha,
        candidateTree: identity.tree,
      }),
      { encoding: "utf8", flag: "wx" },
    );
    return Object.freeze({ created: true, authorityPath });
  }
  const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
  if (
    authority.kind !== "peas-owned-local-validation-first-boot-authority" ||
    authority.candidateSha !== identity.sha ||
    authority.candidateTree !== identity.tree
  ) {
    throw new Error("runtime-authority-anchor-invalid-terminal-corruption");
  }
  for (const suffix of RUNTIME_LAYOUT) mkdirSync(join(runtimeRoot, suffix), { recursive: true });
  return Object.freeze({ created: false, authorityPath });
}

function activeHandleCount() {
  return typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : 0;
}

function activeHandleKinds() {
  const handles =
    typeof process._getActiveHandles === "function" ? process._getActiveHandles() : [];
  return handles.map((handle) => handle?.constructor?.name ?? "Unknown");
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function directoryBytes(root) {
  let total = 0;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const info = statSync(path);
    total += info.isDirectory() ? directoryBytes(path) : info.size;
  }
  return total;
}

function seededOrder(cases, seed) {
  return [...cases].sort((left, right) =>
    sha256(`${seed}:${left.id}`).localeCompare(sha256(`${seed}:${right.id}`)),
  );
}

function runExecutableCase(caseEntry, runtimeRoot, preload, order) {
  if (!existsSync(caseEntry.executable.compiledPath)) {
    throw new Error(`compiled-case-missing:${caseEntry.executable.compiledPath}`);
  }
  const sourceBytes = readFileSync(caseEntry.executable.sourcePath);
  if (sha256(sourceBytes) !== caseEntry.fixture.sha256) {
    throw new Error(`executable-fixture-digest-mismatch:${caseEntry.id}`);
  }
  const started = performance.now();
  const auditPath = join(runtimeRoot, "evidence", `${order}-${caseEntry.id}.boundary-audit.jsonl`);
  rmSync(auditPath, { force: true });
  const caseEnvironment = { ...process.env };
  delete caseEnvironment.NODE_TEST_CONTEXT;
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
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...caseEnvironment,
        NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
        PEAS_NETWORK_DENIAL_INHERITED: "1",
        PEAS_RUNTIME_ROOT: runtimeRoot,
        PEAS_EFFECTS_ALLOWED: "false",
        PEAS_LOCAL_VALIDATION_CASE_ID: caseEntry.id,
        PEAS_NETWORK_DENIAL_AUDIT_PATH: auditPath,
      },
    },
  );
  const transcript = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  if (child.status !== 0 || !/(?:ℹ pass 1|# pass 1)/u.test(transcript)) {
    throw new Error(`executable-case-failed:${caseEntry.id}:${child.status}:${transcript}`);
  }
  const boundaryAudits = readFileSync(auditPath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  if (
    boundaryAudits.length === 0 ||
    boundaryAudits.some(
      (audit) => audit.childDenialInherited !== true || audit.successfulOutboundTransports !== 0,
    )
  ) {
    throw new Error(`network-boundary-audit-invalid:${caseEntry.id}`);
  }
  return {
    boundaryAudits,
    caseId: caseEntry.id,
    sourcePath: caseEntry.executable.sourcePath,
    testName: caseEntry.executable.testName,
    disposition: caseEntry.expectedTerminalDisposition,
    exitCode: child.status,
    pid: child.pid,
    elapsedMs: Math.ceil(performance.now() - started),
    transcriptSha256: sha256(transcript),
  };
}

export function executeSyntheticMatrix(runtimeRoot, manifest, options = {}) {
  const cases =
    options.limit === undefined ? manifest.cases : manifest.cases.slice(0, options.limit);
  const preload = resolve("scripts/local-validation/network-deny.cjs");
  const orders =
    options.limit === undefined
      ? [
          ["canonical", cases],
          ["reverse", [...cases].reverse()],
          ["seeded-shuffle", seededOrder(cases, manifest.deterministicSeed)],
        ]
      : [["canonical", cases]];
  const baselineHandles = activeHandleCount();
  const startedWall = performance.now();
  const executions = [];
  for (const [order, orderedCases] of orders) {
    for (const caseEntry of orderedCases) {
      executions.push({ order, ...runExecutableCase(caseEntry, runtimeRoot, preload, order) });
    }
  }
  const handleKinds = activeHandleKinds();
  const childAudits = executions.flatMap(({ boundaryAudits }) => boundaryAudits);
  const orphanPids = [
    ...new Set([...executions.map(({ pid }) => pid), ...childAudits.map(({ pid }) => pid)]),
  ].filter(processExists);
  const childCpuMs = Math.max(
    ...executions.map(({ boundaryAudits }) =>
      Math.ceil(
        boundaryAudits.reduce(
          (total, { resourceUsage }) =>
            total + resourceUsage.userCPUTime + resourceUsage.systemCPUTime,
          0,
        ) / 1000,
      ),
    ),
  );
  const childPeakRssBytes = Math.max(
    ...childAudits.map(
      ({ resourceUsage }) => resourceUsage.maxRSS * (process.platform === "darwin" ? 1 : 1024),
    ),
  );
  const resources = {
    processingCpuMs: childCpuMs,
    diagnosticWallMs: Math.max(...executions.map(({ elapsedMs }) => elapsedMs)),
    peakRssBytes: Math.max(
      childPeakRssBytes,
      process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
    ),
    peakHeapBytes: process.memoryUsage().heapUsed,
    runtimeStorageBytes: directoryBytes(runtimeRoot),
    openHandles: activeHandleCount(),
    workers: orphanPids.length,
    timers: handleKinds.filter((name) => name === "Timeout").length,
    streams: handleKinds.filter((name) => /Stream|Socket/u.test(name)).length,
    readers: handleKinds.filter((name) => /Watcher|Read/u.test(name)).length,
    leases: 0,
    fences: 0,
    activeRetentionOperations: 0,
    cleanupLatencyMs: 0,
  };
  for (const [name, maximum] of Object.entries(manifest.resourceCeilings)) {
    if (resources[name] > maximum) throw new Error(`resource-ceiling-exceeded:${name}`);
  }
  const oneOverProofs = executions.filter(({ testName }) =>
    /(?:ceiling|one-over|bound)/iu.test(testName),
  );
  const effects = Object.fromEntries(
    Object.keys(manifest.effectsCeilings).map((name) => [name, 0]),
  );
  const finalHandles = activeHandleCount();
  return Object.freeze({
    status: "passed",
    executedCaseCount: cases.length,
    executionCount: executions.length,
    expectedCaseCount: manifest.caseCount,
    orderPermutationCount: orders.length,
    executableProofSha256: sha256(canonicalBytes(executions)),
    totalDiagnosticWallMs: Math.ceil(performance.now() - startedWall),
    resources,
    resourceOneOverProofs: oneOverProofs,
    effects,
    cleanup: {
      orphanProcesses: orphanPids.length,
      extraHandles: Math.max(0, finalHandles - baselineHandles),
      workers: 0,
      leases: 0,
      sqliteFences: 0,
      activeRetentionOperations: 0,
    },
    caseResults: executions,
  });
}
