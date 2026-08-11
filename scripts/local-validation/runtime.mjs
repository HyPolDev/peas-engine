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

import Database from "better-sqlite3";

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

function regularFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const info = statSync(path);
    if (info.isDirectory()) files.push(...regularFiles(path));
    else if (info.isFile()) files.push(path);
  }
  return files;
}

function inspectDurableResidue(root) {
  const files = regularFiles(root);
  const sqliteFiles = files.filter((path) => /\.(?:db|sqlite|sqlite3)$/iu.test(path));
  let leaseRows = 0;
  let fenceRows = 0;
  let activeRetentionRows = 0;
  for (const databasePath of sqliteFiles) {
    const database = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      if (database.pragma("integrity_check", { simple: true }) !== "ok") {
        throw new Error(`runtime-residue-sqlite-integrity:${databasePath}`);
      }
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map(({ name }) => String(name));
      for (const table of tables) {
        const quotedTable = table.replaceAll('"', '""');
        const count = Number(
          database.prepare(`SELECT count(*) AS count FROM "${quotedTable}"`).get().count,
        );
        if (/lease/iu.test(table)) leaseRows += count;
        if (/fence/iu.test(table)) fenceRows += count;
        if (/retention.*(?:active|operation|reconciliation_state)/iu.test(table)) {
          activeRetentionRows += count;
        }
      }
    } finally {
      database.close();
    }
  }
  const lockFiles = files.filter((path) => /[\\/]locks[\\/]/u.test(path)).length;
  return {
    sqliteFileCount: sqliteFiles.length,
    leaseRows,
    fenceRows,
    activeRetentionRows,
    lockFiles,
  };
}

function seededOrder(cases, seed) {
  return [...cases].sort((left, right) =>
    sha256(`${seed}:${left.id}`).localeCompare(sha256(`${seed}:${right.id}`)),
  );
}

export function enforceResourceCeilings(resources, ceilings) {
  for (const [name, maximum] of Object.entries(ceilings)) {
    if (!Number.isFinite(resources[name]) || resources[name] < 0) {
      throw new Error(`resource-measurement-invalid:${name}`);
    }
    if (resources[name] > maximum) throw new Error(`resource-ceiling-exceeded:${name}`);
  }
}

export function executeResourceBoundaryVectors(ceilings) {
  const baseline = Object.fromEntries(Object.keys(ceilings).map((name) => [name, 0]));
  return Object.entries(ceilings).map(([name, maximum]) => {
    const exact = { ...baseline, [name]: maximum };
    enforceResourceCeilings(exact, ceilings);
    const oneOver = { ...baseline, [name]: maximum + 1 };
    let rejection = null;
    try {
      enforceResourceCeilings(oneOver, ceilings);
    } catch (error) {
      rejection = error instanceof Error ? error.message : String(error);
    }
    if (rejection !== `resource-ceiling-exceeded:${name}`) {
      throw new Error(`resource-one-over-not-rejected:${name}`);
    }
    return {
      name,
      exactAccepted: true,
      exactValue: maximum,
      oneOverRejected: true,
      oneOverValue: maximum + 1,
      rejection,
    };
  });
}

function runExecutableCase(caseEntry, runtimeRoot, preload, order, bindings) {
  if (!existsSync(caseEntry.executable.compiledPath)) {
    throw new Error(`compiled-case-missing:${caseEntry.executable.compiledPath}`);
  }
  const sourceBytes = readFileSync(caseEntry.executable.sourcePath);
  if (sha256(sourceBytes) !== caseEntry.fixture.sha256) {
    throw new Error(`executable-fixture-digest-mismatch:${caseEntry.id}`);
  }
  const started = performance.now();
  const caseTemporaryRoot = join(runtimeRoot, "case-runtime", order, caseEntry.id);
  mkdirSync(caseTemporaryRoot, { recursive: true });
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
        TEMP: caseTemporaryRoot,
        TMP: caseTemporaryRoot,
        TMPDIR: caseTemporaryRoot,
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
    claimedRestartPrefixes: bindings.restart.flatMap(({ prefixes }) => prefixes),
    claimedPermutationVectors: bindings.permutations.map(({ vectors, sourceSha256 }) => ({
      sourceSha256,
      vectors,
    })),
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
  const bindingsFor = (caseId) => ({
    restart: manifest.restartBindings.filter((binding) => binding.caseId === caseId),
    permutations: manifest.permutationBindings.filter((binding) => binding.caseId === caseId),
  });
  for (const [order, orderedCases] of orders) {
    for (const caseEntry of orderedCases) {
      executions.push({
        order,
        ...runExecutableCase(caseEntry, runtimeRoot, preload, order, bindingsFor(caseEntry.id)),
      });
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
  const childPeakHeapBytes = Math.max(
    ...childAudits.map(({ memoryUsage }) => memoryUsage.heapUsed),
  );
  options.beforeResidueInspection?.(join(runtimeRoot, "case-runtime"));
  const cleanupStarted = performance.now();
  const residue = inspectDurableResidue(join(runtimeRoot, "case-runtime"));
  const cleanupLatencyMs = Math.ceil(performance.now() - cleanupStarted);
  const resources = {
    processingCpuMs: childCpuMs,
    diagnosticWallMs: Math.max(...executions.map(({ elapsedMs }) => elapsedMs)),
    peakRssBytes: Math.max(
      childPeakRssBytes,
      process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
    ),
    peakHeapBytes: Math.max(childPeakHeapBytes, process.memoryUsage().heapUsed),
    runtimeStorageBytes: directoryBytes(runtimeRoot),
    openHandles: activeHandleCount(),
    workers: orphanPids.length,
    timers: handleKinds.filter((name) => name === "Timeout").length,
    streams: handleKinds.filter((name) => /Stream|Socket/u.test(name)).length,
    readers: handleKinds.filter((name) => /Watcher|Read/u.test(name)).length,
    leases: residue.leaseRows + residue.lockFiles,
    fences: residue.fenceRows,
    activeRetentionOperations: residue.activeRetentionRows,
    cleanupLatencyMs,
  };
  enforceResourceCeilings(resources, manifest.resourceCeilings);
  const resourceBoundaryResults = executeResourceBoundaryVectors(manifest.resourceCeilings);
  const productionResourceProofs = executions.filter(({ testName }) =>
    /(?:ceiling|one-over|bound)/iu.test(testName),
  );
  const successfulOutboundTransports = childAudits.reduce(
    (total, audit) => total + audit.successfulOutboundTransports,
    0,
  );
  const credentialPresence = options.credentialPresentCount ?? 0;
  const externalCapabilityActivity = successfulOutboundTransports + credentialPresence;
  const effects = {
    network: successfulOutboundTransports,
    provider: externalCapabilityActivity,
    credential: credentialPresence,
    account: credentialPresence,
    broker: successfulOutboundTransports,
    order: successfulOutboundTransports,
    portfolio: successfulOutboundTransports,
    position: successfulOutboundTransports,
    fill: successfulOutboundTransports,
    spending: successfulOutboundTransports,
    financialEffect: externalCapabilityActivity,
  };
  if (
    canonicalBytes(Object.keys(effects).sort()) !==
    canonicalBytes(Object.keys(manifest.effectsCeilings).sort())
  ) {
    throw new Error("effects-accounting-schema-mismatch");
  }
  for (const [name, maximum] of Object.entries(manifest.effectsCeilings)) {
    if (effects[name] > maximum) throw new Error(`effects-ceiling-exceeded:${name}`);
  }
  if (
    orphanPids.length > 0 ||
    residue.leaseRows + residue.lockFiles > 0 ||
    residue.fenceRows > 0 ||
    residue.activeRetentionRows > 0
  ) {
    throw new Error("runtime-durable-residue-detected");
  }
  const finalHandles = activeHandleCount();
  const restartClaims = [
    ...new Set(executions.flatMap(({ claimedRestartPrefixes }) => claimedRestartPrefixes)),
  ].sort();
  const expectedRestartClaims = [...manifest.durableCheckpointPrefixes].sort();
  const executedPermutationBindingCount = new Set(
    executions
      .filter(({ claimedPermutationVectors }) => claimedPermutationVectors.length > 0)
      .map(({ caseId }) => caseId),
  ).size;
  if (
    options.limit === undefined &&
    canonicalBytes(restartClaims) !== canonicalBytes(expectedRestartClaims)
  ) {
    throw new Error("restart-prefix-execution-coverage-incomplete");
  }
  return Object.freeze({
    status: "passed",
    executedCaseCount: cases.length,
    executionCount: executions.length,
    expectedCaseCount: manifest.caseCount,
    orderPermutationCount: orders.length,
    executableProofSha256: sha256(canonicalBytes(executions)),
    totalDiagnosticWallMs: Math.ceil(performance.now() - startedWall),
    resources,
    productionResourceProofs,
    resourceBoundaryResults,
    restartClaims,
    restartClaimsSha256: sha256(canonicalBytes(restartClaims)),
    executedPermutationBindingCount,
    effects,
    effectsBasis: {
      credentialPresence,
      deniedOutboundTransportAttempts: childAudits.reduce(
        (total, audit) => total + audit.deniedOutboundTransportAttempts,
        0,
      ),
      outboundTransportAttempts: childAudits.reduce(
        (total, audit) => total + audit.outboundTransportAttempts,
        0,
      ),
      successfulOutboundTransports,
    },
    durableResidue: residue,
    cleanup: {
      orphanProcesses: orphanPids.length,
      extraHandles: Math.max(0, finalHandles - baselineHandles),
      workers: orphanPids.length,
      leases: residue.leaseRows + residue.lockFiles,
      sqliteFences: residue.fenceRows,
      activeRetentionOperations: residue.activeRetentionRows,
      cleanupLatencyMs,
    },
    caseResults: executions,
  });
}
