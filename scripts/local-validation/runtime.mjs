import { spawn } from "node:child_process";
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

import { canonicalBytes, sanitizedLocalValidationChildEnvironment, sha256 } from "./contract.mjs";
import { measureWorkerOwnership, workerResourceFailureEvidence } from "./worker-accounting.mjs";

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
const ATTESTATION_KEYS = Object.freeze([
  "kind",
  "origin",
  "schemaVersion",
  "sha",
  "status",
  "tree",
]);
const CASE_ID_PATTERN = /^lv-v1-\d{3}-[0-9a-f]{16}$/u;

export const CHECKOUT_ATTESTATION_ENV = "PEAS_LOCAL_VALIDATION_CHECKOUT_ATTESTATION";
export const ATTESTED_CASE_ID_ENV = "PEAS_LOCAL_VALIDATION_ATTESTED_CASE_ID";

function recordValue(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function validateCheckoutAttestation(value, identity) {
  if (value === undefined || value === null) {
    throw new Error("local-validation-checkout-attestation-required");
  }
  const attestation = recordValue(value);
  if (attestation === null) throw new Error("local-validation-checkout-attestation-invalid");
  if (
    canonicalBytes(Object.keys(attestation).sort()) !== canonicalBytes(ATTESTATION_KEYS) ||
    attestation.schemaVersion !== 1 ||
    attestation.kind !== "peas-local-validation-verified-checkout" ||
    !/^[0-9a-f]{40}$/u.test(attestation.sha) ||
    !/^[0-9a-f]{40}$/u.test(attestation.tree) ||
    attestation.status !== "" ||
    typeof attestation.origin !== "string" ||
    attestation.origin.length === 0 ||
    /[\0\r\n]/u.test(attestation.origin)
  ) {
    throw new Error("local-validation-checkout-attestation-invalid");
  }
  if (
    identity !== undefined &&
    (attestation.sha !== identity?.sha ||
      attestation.tree !== identity?.tree ||
      attestation.status !== identity?.status)
  ) {
    throw new Error("local-validation-checkout-attestation-mismatch");
  }
  return Object.freeze({ ...attestation });
}

function environmentAttestation() {
  const raw = process.env[CHECKOUT_ATTESTATION_ENV];
  if (raw === undefined) throw new Error("local-validation-checkout-attestation-required");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("local-validation-checkout-attestation-invalid");
  }
  return validateCheckoutAttestation(parsed);
}

export function attestedCaseEnvironment(inherited, candidateAttestation, caseId) {
  const attestation = validateCheckoutAttestation(candidateAttestation);
  if (!CASE_ID_PATTERN.test(caseId)) throw new Error("local-validation-attested-case-id-invalid");
  return {
    ...inherited,
    [CHECKOUT_ATTESTATION_ENV]: canonicalBytes({ ...attestation, caseId }).trimEnd(),
    [ATTESTED_CASE_ID_ENV]: caseId,
    PEAS_LOCAL_VALIDATION_CASE_ID: caseId,
  };
}

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

function settledOwnedChildHandle(handle) {
  return globalThis.__PEAS_NETWORK_DENIAL__?.settledOwnedChildHandle?.(handle) === true;
}

function accountableActiveHandles() {
  const handles =
    typeof process._getActiveHandles === "function" ? process._getActiveHandles() : [];
  return handles.filter((handle) => !settledOwnedChildHandle(handle));
}

function activeHandleCount() {
  return accountableActiveHandles().length;
}

function activeHandleKinds() {
  return accountableActiveHandles().map((handle) => handle?.constructor?.name ?? "Unknown");
}

function workerOwnershipBoundary() {
  const evidence = globalThis.__PEAS_NETWORK_DENIAL__?.workerOwnership?.();
  if (
    evidence?.schemaVersion !== 1 ||
    typeof evidence.groupId !== "string" ||
    evidence.groupId.length === 0 ||
    typeof evidence.token !== "string" ||
    evidence.token.length === 0 ||
    evidence.ownerToken !== null ||
    !Number.isSafeInteger(evidence.pid) ||
    evidence.pid <= 0 ||
    !Array.isArray(evidence.claims)
  ) {
    throw new Error("worker-accounting-boundary-unavailable");
  }
  return evidence;
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

export function enforceResourceCeilings(resources, ceilings, options = {}) {
  for (const [name, maximum] of Object.entries(ceilings)) {
    if (!Number.isFinite(resources[name]) || resources[name] < 0) {
      throw new Error(`resource-measurement-invalid:${name}`);
    }
    if (resources[name] > maximum) {
      const detail =
        name === "workers" && options.workerOwnership !== undefined
          ? `:${JSON.stringify(workerResourceFailureEvidence(options.workerOwnership, maximum))}`
          : "";
      throw new Error(`resource-ceiling-exceeded:${name}${detail}`);
    }
  }
}

export function enforceWorkerCleanup(workerOwnership, maximum) {
  if (workerOwnership.measuredWorkers > 0) {
    throw new Error(
      `runtime-durable-residue-detected:workers:${JSON.stringify(
        workerResourceFailureEvidence(workerOwnership, maximum),
      )}`,
    );
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

const NODE_TEST_SUMMARY_FIELDS = Object.freeze([
  "tests",
  "pass",
  "fail",
  "cancelled",
  "skipped",
  "todo",
]);

export function parseNodeTestSummary(
  transcript,
  expectedDisposition = "executable-assertions-passed",
) {
  if (typeof transcript !== "string") throw new Error("node-test-summary-invalid");
  const summary = {};
  for (const field of NODE_TEST_SUMMARY_FIELDS) {
    const pattern = new RegExp(`(?:^|\\r?\\n)(?:ℹ|#) ${field} (\\d+)(?=\\r?\\n|$)`, "gu");
    const matches = [...transcript.matchAll(pattern)];
    if (matches.length !== 1) throw new Error(`node-test-summary-${field}-ambiguous`);
    const value = Number(matches[0][1]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("node-test-summary-invalid");
    summary[field] = value;
  }
  const assertionsPassed =
    summary.tests >= 1 &&
    summary.pass === summary.tests &&
    summary.fail === 0 &&
    summary.cancelled === 0 &&
    summary.skipped === 0 &&
    summary.todo === 0;
  const platformInapplicable =
    summary.tests === 1 &&
    summary.pass === 0 &&
    summary.fail === 0 &&
    summary.cancelled === 0 &&
    summary.skipped === 1 &&
    summary.todo === 0;
  if (
    (expectedDisposition === "executable-assertions-passed" && !assertionsPassed) ||
    (expectedDisposition === "platform-inapplicable" && !platformInapplicable) ||
    !["executable-assertions-passed", "platform-inapplicable"].includes(expectedDisposition)
  ) {
    throw new Error("node-test-summary-invalid");
  }
  return Object.freeze(summary);
}

export function resolveCaseDisposition(caseEntry, runtimePlatform = process.platform) {
  if (caseEntry?.expectedTerminalDisposition === "executable-assertions-passed") {
    if (caseEntry.applicablePlatforms !== undefined) {
      throw new Error("local-validation-platform-applicability-invalid");
    }
    return "executable-assertions-passed";
  }
  const platforms = caseEntry?.applicablePlatforms;
  if (
    caseEntry?.expectedTerminalDisposition !== "platform-conditional" ||
    !Array.isArray(platforms) ||
    platforms.length === 0 ||
    new Set(platforms).size !== platforms.length ||
    platforms.some((platformName) => typeof platformName !== "string") ||
    typeof runtimePlatform !== "string" ||
    runtimePlatform.length === 0
  ) {
    throw new Error("local-validation-platform-applicability-invalid");
  }
  return platforms.includes(runtimePlatform)
    ? "executable-assertions-passed"
    : "platform-inapplicable";
}

function runBufferedChild(args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = { stdout: "", stderr: "", totalBytes: 0 };
    let bufferExceeded = false;
    let timedOut = false;
    const append = (name, chunk) => {
      output.totalBytes += Buffer.byteLength(chunk);
      if (output.totalBytes <= options.maxBuffer) output[name] += chunk;
      else if (!bufferExceeded) {
        bufferExceeded = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.setEncoding("utf8").on("data", (chunk) => append("stdout", chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => append("stderr", chunk));
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeout);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolvePromise({
        pid: child.pid,
        status,
        signal,
        stdout: output.stdout,
        stderr: output.stderr,
        failureReason: bufferExceeded
          ? "max-buffer-exceeded"
          : timedOut
            ? "timeout-exceeded"
            : null,
      });
    });
  });
}

async function runExecutableCase(
  caseEntry,
  runtimeRoot,
  preload,
  order,
  bindings,
  candidateAttestation,
) {
  if (!existsSync(caseEntry.executable.compiledPath)) {
    throw new Error(`compiled-case-missing:${caseEntry.executable.compiledPath}`);
  }
  const sourceBytes = readFileSync(caseEntry.executable.sourcePath);
  if (sha256(sourceBytes) !== caseEntry.fixture.sha256) {
    throw new Error(`executable-fixture-digest-mismatch:${caseEntry.id}`);
  }
  const disposition = resolveCaseDisposition(caseEntry);
  const started = performance.now();
  const caseTemporaryRoot = join(runtimeRoot, "case-runtime", order, caseEntry.id);
  mkdirSync(caseTemporaryRoot, { recursive: true });
  const auditPath = join(runtimeRoot, "evidence", `${order}-${caseEntry.id}.boundary-audit.jsonl`);
  const lifecyclePath = join(
    runtimeRoot,
    "evidence",
    `${order}-${caseEntry.id}.worker-lifecycle.jsonl`,
  );
  rmSync(auditPath, { force: true });
  rmSync(lifecyclePath, { force: true });
  const caseEnvironment = sanitizedLocalValidationChildEnvironment();
  delete caseEnvironment.NODE_TEST_CONTEXT;
  const ownershipBefore = workerOwnershipBoundary();
  const child = await runBufferedChild(
    [
      "--test",
      `--test-name-pattern=${caseEntry.executable.nodeTestNamePattern}`,
      caseEntry.executable.compiledPath,
    ],
    {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...attestedCaseEnvironment(caseEnvironment, candidateAttestation, caseEntry.id),
        NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
        PEAS_NETWORK_DENIAL_INHERITED: "1",
        PEAS_RUNTIME_ROOT: runtimeRoot,
        PEAS_EFFECTS_ALLOWED: "false",
        PEAS_NETWORK_DENIAL_AUDIT_PATH: auditPath,
        PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH: lifecyclePath,
        TEMP: caseTemporaryRoot,
        TMP: caseTemporaryRoot,
        TMPDIR: caseTemporaryRoot,
      },
    },
  );
  const ownershipAfter = workerOwnershipBoundary();
  if (
    ownershipAfter.groupId !== ownershipBefore.groupId ||
    ownershipAfter.token !== ownershipBefore.token ||
    ownershipAfter.claims.length !== ownershipBefore.claims.length + 1
  ) {
    throw new Error("worker-accounting-direct-claim-ambiguous");
  }
  const directClaims = ownershipAfter.claims.slice(ownershipBefore.claims.length);
  const transcript = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  if (child.status !== 0 || child.failureReason !== null) {
    throw new Error(
      `executable-case-failed:${caseEntry.id}:${child.status}:${child.failureReason}:${transcript}`,
    );
  }
  let nodeTestSummary;
  try {
    nodeTestSummary = parseNodeTestSummary(transcript, disposition);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `executable-case-failed:${caseEntry.id}:${child.status}:${reason}:${transcript}`,
    );
  }
  const boundaryAudits = readFileSync(auditPath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const workerLifecycleEvents = readFileSync(lifecyclePath, "utf8")
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
    workerDirectClaims: directClaims,
    workerLifecycleEvents,
    caseId: caseEntry.id,
    sourcePath: caseEntry.executable.sourcePath,
    testName: caseEntry.executable.testName,
    disposition,
    claimedRestartPrefixes: bindings.restart.flatMap(({ prefixes }) => prefixes),
    claimedPermutationVectors: bindings.permutations.map(({ vectors, sourceSha256 }) => ({
      sourceSha256,
      vectors,
    })),
    exitCode: child.status,
    nodeTestSummary,
    pid: child.pid,
    elapsedMs: Math.ceil(performance.now() - started),
    transcriptSha256: sha256(transcript),
  };
}

export async function executeSyntheticMatrix(runtimeRoot, manifest, options = {}) {
  if (
    options.candidateAttestation === undefined &&
    globalThis.__PEAS_NETWORK_DENIAL__?.installed === true
  ) {
    throw new Error("local-validation-checkout-attestation-required");
  }
  const candidateAttestation = validateCheckoutAttestation(
    options.candidateAttestation ?? environmentAttestation(),
  );
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
        ...(await runExecutableCase(
          caseEntry,
          runtimeRoot,
          preload,
          order,
          bindingsFor(caseEntry.id),
          candidateAttestation,
        )),
      });
    }
  }
  // A ChildProcess emits "close" before libuv removes its settled process handle.
  // Measure cleanup on the next turn so historical children are excluded while
  // genuinely live handles remain visible to the unchanged resource ceilings.
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  const handleKinds = activeHandleKinds();
  const childAudits = executions.flatMap(({ boundaryAudits }) => boundaryAudits);
  const workerBoundary = workerOwnershipBoundary();
  const workerOwnership = measureWorkerOwnership({
    groupId: workerBoundary.groupId,
    rootOwnerToken: workerBoundary.token,
    rootOwnerPid: workerBoundary.pid,
    directClaims: executions.flatMap(({ workerDirectClaims }) => workerDirectClaims),
    audits: childAudits,
    lifecycleEvents: executions.flatMap(({ workerLifecycleEvents }) => workerLifecycleEvents),
    platform: process.platform,
  });
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
    workers: workerOwnership.measuredWorkers,
    timers: handleKinds.filter((name) => name === "Timeout").length,
    streams: handleKinds.filter((name) => /Stream|Socket/u.test(name)).length,
    readers: handleKinds.filter((name) => /Watcher|Read/u.test(name)).length,
    leases: residue.leaseRows + residue.lockFiles,
    fences: residue.fenceRows,
    activeRetentionOperations: residue.activeRetentionRows,
    cleanupLatencyMs,
  };
  enforceResourceCeilings(resources, manifest.resourceCeilings, { workerOwnership });
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
  enforceWorkerCleanup(workerOwnership, manifest.resourceCeilings.workers);
  if (
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
    workerOwnership,
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
      orphanProcesses: workerOwnership.orphanCount,
      extraHandles: Math.max(0, finalHandles - baselineHandles),
      workers: workerOwnership.measuredWorkers,
      leases: residue.leaseRows + residue.lockFiles,
      sqliteFences: residue.fenceRows,
      activeRetentionOperations: residue.activeRetentionRows,
      cleanupLatencyMs,
    },
    caseResults: executions,
  });
}
