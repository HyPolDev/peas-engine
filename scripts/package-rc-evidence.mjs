import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const PACKAGE_FORMAT_VERSION = 1;
const REPOSITORY = "HyPolDev/peas-engine";
const GOLDEN_PATH = "fixtures/earnings-cluster.v2.golden.json";
const CAPTURE_PATH = "fixtures/earnings-cluster.v2.captured.ndjson";
const PACKAGE_LOCK_PATH = "package-lock.json";
const SCALE_POLICY_PATH = "config/scale-policy.v1.json";
const REQUIRED_GATES = ["check-windows", "check-linux", "scale-10k-linux", "scale-100k-linux"];
const CHECK_GATES = ["check-windows", "check-linux", "scale-100k-linux"];
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DECISIONS = new Map([
  ["CONDITIONAL_GO", "CONDITIONAL GO"],
  ["NO_GO", "NO-GO"],
]);
const SCOPE_BOUNDARIES = [
  "This release candidate covers the deterministic Kernel V2 contracts only. The artifact vault, provider normalization, and live provider clients remain outside its scope.",
  "Brokerage connectivity, orders, portfolio mutation, credentials, and automated trading effects are structurally excluded.",
  "The audited SQLite topology is a single-writer design; this evidence does not claim horizontally scalable or multi-writer processing.",
  "Scheduled 100k runs are regression evidence only. Release evidence requires the explicit audit-100k label or a manual workflow dispatch.",
  "Local checksums establish asset integrity, not publisher identity. Publication attestation is provided by GitHub immutable releases once that repository feature is enabled.",
];

function usage() {
  return [
    "Usage: npm run package:rc-evidence --",
    "  --manifest <release-manifest.json>",
    "  --evidence-dir <downloaded-raw-evidence-directory>",
    "  --tag <annotated-candidate-tag>",
    "  --candidate-sha <40-character-sha>",
    "  --ci-run-id <trusted-ci-run-id>",
    "  --100k-run-id <trusted-manual-100k-run-id>",
    "  --decision <CONDITIONAL_GO|NO_GO>",
    "  --decision-owner <name>",
    "  --decision-date <YYYY-MM-DD>",
    "  --decision-rationale <single-line-rationale>",
    "  --output-dir <existing-directory>",
  ].join("\n");
}

function parseArguments(argv) {
  const allowed = new Set([
    "manifest",
    "evidence-dir",
    "tag",
    "candidate-sha",
    "ci-run-id",
    "100k-run-id",
    "decision",
    "decision-owner",
    "decision-date",
    "decision-rationale",
    "output-dir",
  ]);
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (typeof flag !== "string" || !flag.startsWith("--")) {
      throw new Error(`Expected an option at argument ${index + 1}\n${usage()}`);
    }
    const name = flag.slice(2);
    if (!allowed.has(name)) throw new Error(`Unknown option --${name}\n${usage()}`);
    if (parsed.has(name)) throw new Error(`Duplicate option --${name}`);
    if (typeof value !== "string" || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}\n${usage()}`);
    }
    parsed.set(name, value);
  }
  for (const name of allowed) {
    if (!parsed.has(name)) throw new Error(`Missing required --${name}\n${usage()}`);
  }
  return Object.fromEntries(parsed);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0 || /[\r\n\0]/u.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string`);
  }
  return value;
}

function requireSha256(value, label) {
  const digest = requireString(value, label);
  if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return digest;
}

function requireGitSha(value, label) {
  const digest = requireString(value, label);
  if (!GIT_SHA_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase Git SHA`);
  return digest;
}

function requireFiniteNumber(value, label, minimum = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be a finite number greater than or equal to ${minimum}`);
  }
  return value;
}

function requireSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value;
}

function requireSignedSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

function assertNoSymlinkComponents(path, label) {
  const components = [];
  let current = resolve(path);
  while (true) {
    components.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const component of components.reverse()) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
      throw new Error(`${label} traverses a symbolic link: ${component}`);
    }
  }
}

function requireRegularFile(path, label) {
  assertNoSymlinkComponents(path, label);
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`${label} is not a regular file: ${path}`);
  }
}

function requireDirectory(path, label) {
  assertNoSymlinkComponents(path, label);
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`${label} is not an existing directory: ${path}`);
  }
}

function requireAvailableOutput(path, label) {
  assertNoSymlinkComponents(path, label);
  if (existsSync(path)) throw new Error(`${label} already exists: ${path}`);
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function repositoryFromOrigin() {
  const origin = git("remote", "get-url", "origin");
  if (origin.startsWith("https://")) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Origin is not a valid GitHub URL: ${origin}`);
    }
    const segments = parsed.pathname
      .replace(/^\//u, "")
      .replace(/\.git$/u, "")
      .split("/");
    if (
      parsed.hostname !== "github.com" ||
      segments.length !== 2 ||
      segments.some((part) => !part)
    ) {
      throw new Error(`Origin is not a two-part GitHub repository: ${origin}`);
    }
    return segments.join("/");
  }
  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(origin);
  if (sshMatch === null) throw new Error(`Origin is not a supported GitHub URL: ${origin}`);
  return `${sshMatch[1]}/${sshMatch[2]}`;
}

function checkoutIdentity() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const goldenBytes = readFileSync(GOLDEN_PATH);
  const golden = JSON.parse(goldenBytes.toString("utf8"));
  const captureBytes = readFileSync(CAPTURE_PATH);
  const captureText = captureBytes.toString("utf8").trim();
  const scalePolicyBytes = readFileSync(SCALE_POLICY_PATH);
  const scalePolicy = JSON.parse(scalePolicyBytes.toString("utf8"));
  if (
    scalePolicy.policyVersion !== 1 ||
    scalePolicy.metricsVersion !== 2 ||
    scalePolicy.measurementModel !== "event-processing-then-streaming-audit-scan"
  ) {
    throw new Error("Checked-out scale policy has unsupported identity");
  }
  const scalePolicySha256 = sha256(scalePolicyBytes);
  return {
    runtime: {
      node: packageJson.engines?.node,
      npm: packageJson.engines?.npm,
      expectedPackageManager: packageJson.packageManager,
    },
    golden: {
      path: GOLDEN_PATH,
      fileSha256: sha256(goldenBytes),
      eventHead: golden.eventHead,
      stateHead: golden.stateHead,
      decisionHead: golden.decisionHead,
    },
    capturedStream: {
      path: CAPTURE_PATH,
      fileSha256: sha256(captureBytes),
      eventCount: captureText.length === 0 ? 0 : captureText.split(/\r?\n/u).length,
    },
    sourceInputs: {
      packageLockPath: PACKAGE_LOCK_PATH,
      packageLockSha256: sha256(readFileSync(PACKAGE_LOCK_PATH)),
      scalePolicyPath: SCALE_POLICY_PATH,
      scalePolicySha256,
      scalePolicyVersion: scalePolicy.policyVersion,
    },
    scalePolicy,
    scalePolicyReference: {
      policyVersion: scalePolicy.policyVersion,
      path: SCALE_POLICY_PATH,
      fileSha256: scalePolicySha256,
    },
  };
}

function verifyAnnotatedTag(tag, candidateSha) {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error("Candidate tag contains unsupported characters or length");
  }
  try {
    git("check-ref-format", `refs/tags/${tag}`);
  } catch {
    throw new Error(`Candidate tag is not a valid Git tag: ${tag}`);
  }
  let objectType;
  let resolvedSha;
  try {
    objectType = git("cat-file", "-t", `refs/tags/${tag}`);
    resolvedSha = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
  } catch {
    throw new Error(`Candidate tag does not exist or cannot resolve to a commit: ${tag}`);
  }
  if (objectType !== "tag") throw new Error(`Candidate tag is not annotated: ${tag}`);
  if (resolvedSha !== candidateSha) {
    throw new Error(`Candidate tag ${tag} resolves to ${resolvedSha}, not ${candidateSha}`);
  }
}

function requireRunUrl(value, runId, repository, label) {
  const url = requireString(value, label);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (
    parsed.origin !== "https://github.com" ||
    parsed.pathname !== `/${repository}/actions/runs/${runId}`
  ) {
    throw new Error(`${label} must identify ${repository} GitHub Actions run ${runId}`);
  }
  return url;
}

function validateCheckResults(checkResults, label) {
  const results = requireObject(checkResults, label);
  const testsWrapper = requireObject(results.tests, `${label}.tests`);
  const mutationWrapper = requireObject(results.mutations, `${label}.mutations`);
  requireString(testsWrapper.path, `${label}.tests.path`);
  requireString(mutationWrapper.path, `${label}.mutations.path`);
  requireSha256(testsWrapper.fileSha256, `${label}.tests.fileSha256`);
  requireSha256(mutationWrapper.fileSha256, `${label}.mutations.fileSha256`);
  const tests = requireObject(testsWrapper.value, `${label}.tests.value`);
  const mutations = requireObject(mutationWrapper.value, `${label}.mutations.value`);
  if (tests.resultVersion !== 1 || tests.status !== "passed") {
    throw new Error(`${label} does not contain passing version-1 test results`);
  }
  const counts = requireObject(tests.tests, `${label}.tests.value.tests`);
  const total = requireSafeInteger(counts.tests, `${label}.tests.total`, 1);
  const passed = requireSafeInteger(counts.passed, `${label}.tests.passed`);
  const failed = requireSafeInteger(counts.failed, `${label}.tests.failed`);
  const skipped = requireSafeInteger(counts.skipped, `${label}.tests.skipped`);
  const cancelled = requireSafeInteger(counts.cancelled ?? 0, `${label}.tests.cancelled`);
  const todo = requireSafeInteger(counts.todo ?? 0, `${label}.tests.todo`);
  if (failed !== 0 || passed + failed + skipped + cancelled + todo !== total) {
    throw new Error(`${label} test counts are failed or internally inconsistent`);
  }
  const coverage = requireObject(tests.coverage, `${label}.tests.coverage`);
  for (const dimension of ["lines", "branches", "functions"]) {
    const metric = requireObject(coverage[dimension], `${label}.coverage.${dimension}`);
    const percent = requireFiniteNumber(metric.percent, `${label}.coverage.${dimension}.percent`);
    const threshold = requireFiniteNumber(
      metric.threshold,
      `${label}.coverage.${dimension}.threshold`,
    );
    if (percent > 100 || threshold > 100 || percent < threshold) {
      throw new Error(`${label} has failing or invalid ${dimension} coverage`);
    }
  }
  if (mutations.resultVersion !== 1 || mutations.status !== "passed") {
    throw new Error(`${label} does not contain passing version-1 mutation results`);
  }
  const mutationTotal = requireSafeInteger(mutations.total, `${label}.mutations.total`, 1);
  const killed = requireSafeInteger(mutations.killed, `${label}.mutations.killed`);
  if (killed !== mutationTotal) throw new Error(`${label} did not kill every recorded mutation`);
  return { tests, mutations };
}

function validateScaleMetric(metricValue, candidateSha, expectedIdentity, label) {
  const metric = requireObject(metricValue, label);
  if (
    metric.metricsVersion !== expectedIdentity.scalePolicy.metricsVersion ||
    metric.measurementModel !== expectedIdentity.scalePolicy.measurementModel ||
    metric.candidateCommitSha !== candidateSha ||
    metric.gateStatus !== "passed" ||
    metric.integrityCheck !== "ok" ||
    metric.worktreeClean !== true
  ) {
    throw new Error(
      `${label} is not version-2 passing clean integrity evidence for ${candidateSha}`,
    );
  }
  const clusterCount = requireSafeInteger(metric.clusterCount, `${label}.clusterCount`, 1);
  const workload = requireObject(metric.workload, `${label}.workload`);
  const policyWorkload = expectedIdentity.scalePolicy.workload;
  if (
    workload.name !== policyWorkload.name ||
    workload.eventCount !== clusterCount ||
    workload.issuerCount !== clusterCount ||
    workload.sourcesPerIssuer !== policyWorkload.sourcesPerIssuer ||
    workload.writerCount !== policyWorkload.writerCount
  ) {
    throw new Error(`${label} does not identify the sparse single-writer durability workload`);
  }
  requireFiniteNumber(metric.elapsedMs, `${label}.elapsedMs`);
  const throughput = requireFiniteNumber(
    metric.throughputPerSecond,
    `${label}.throughputPerSecond`,
  );
  const latency = requireObject(metric.latencyMs, `${label}.latencyMs`);
  for (const field of ["p50", "p95", "p99", "max"]) {
    requireFiniteNumber(latency[field], `${label}.latencyMs.${field}`);
  }
  const slope = requireFiniteNumber(
    latency.slopePerEvent,
    `${label}.latencyMs.slopePerEvent`,
    -Infinity,
  );
  const rss = requireObject(metric.rssBytes, `${label}.rssBytes`);
  for (const field of ["before", "afterProcessing", "afterAuditScan", "after"]) {
    requireSafeInteger(rss[field], `${label}.rssBytes.${field}`);
  }
  const processingDelta = requireSignedSafeInteger(
    rss.processingDelta,
    `${label}.rssBytes.processingDelta`,
  );
  requireSignedSafeInteger(rss.auditScanDelta, `${label}.rssBytes.auditScanDelta`);
  requireSignedSafeInteger(rss.delta, `${label}.rssBytes.delta`);
  if (
    rss.afterProcessing - rss.before !== processingDelta ||
    rss.afterAuditScan - rss.afterProcessing !== rss.auditScanDelta ||
    rss.after !== rss.afterAuditScan ||
    rss.after - rss.before !== rss.delta
  ) {
    throw new Error(`${label} has internally inconsistent RSS phase measurements`);
  }
  const auditScan = requireObject(metric.auditScan, `${label}.auditScan`);
  requireSafeInteger(auditScan.pageSize, `${label}.auditScan.pageSize`, 1);
  requireFiniteNumber(auditScan.elapsedMs, `${label}.auditScan.elapsedMs`);
  if (
    requireSafeInteger(auditScan.aggregateCount, `${label}.auditScan.aggregateCount`) !==
      clusterCount ||
    requireSafeInteger(auditScan.outputCount, `${label}.auditScan.outputCount`) < clusterCount
  ) {
    throw new Error(`${label} audit scan did not cover every cluster and expected output`);
  }
  const storage = requireObject(metric.storageBytes, `${label}.storageBytes`);
  for (const field of ["database", "wal"]) {
    requireSafeInteger(storage[field], `${label}.storageBytes.${field}`);
  }
  requireSafeInteger(metric.maxCheckpointBytes, `${label}.maxCheckpointBytes`);
  requireSha256(metric.fileSha256, `${label}.fileSha256`);
  if (!isDeepStrictEqual(metric.scalePolicy, expectedIdentity.scalePolicyReference)) {
    throw new Error(`${label} does not match the checked-out scale-policy identity`);
  }
  const budget = requireObject(metric.performanceBudget, `${label}.performanceBudget`);
  const policyBudget = expectedIdentity.scalePolicy.budgets?.[String(clusterCount)];
  if (policyBudget === undefined || !isDeepStrictEqual(budget, policyBudget)) {
    throw new Error(`${label} performance budget does not match the checked-out scale policy`);
  }
  const minThroughput = requireFiniteNumber(
    budget.minThroughputPerSecond,
    `${label}.performanceBudget.minThroughputPerSecond`,
  );
  const maxP95 = requireFiniteNumber(budget.maxP95Ms, `${label}.performanceBudget.maxP95Ms`);
  const maxP99 = requireFiniteNumber(budget.maxP99Ms, `${label}.performanceBudget.maxP99Ms`);
  const maxSlope = requireFiniteNumber(
    budget.maxSlopePerEvent,
    `${label}.performanceBudget.maxSlopePerEvent`,
  );
  const maxProcessingRss = requireSafeInteger(
    budget.maxProcessingRssDeltaBytes,
    `${label}.performanceBudget.maxProcessingRssDeltaBytes`,
  );
  const maxDatabase = requireSafeInteger(
    budget.maxDatabaseBytes,
    `${label}.performanceBudget.maxDatabaseBytes`,
  );
  const maxWal = requireSafeInteger(budget.maxWalBytes, `${label}.performanceBudget.maxWalBytes`);
  if (
    throughput < minThroughput ||
    latency.p95 > maxP95 ||
    latency.p99 > maxP99 ||
    slope > maxSlope ||
    processingDelta > maxProcessingRss ||
    storage.database > maxDatabase ||
    storage.wal > maxWal
  ) {
    throw new Error(`${label} violates its recorded performance budget`);
  }
  return metric;
}

function validateManifest(value, expectedSha, expectedIdentity) {
  const manifest = requireObject(value, "release manifest");
  if (manifest.manifestVersion !== 2) throw new Error("Unsupported release manifest version");
  if (manifest.reconciliationStatus !== "passed") {
    throw new Error("Release manifest reconciliationStatus is not passed");
  }
  const manifestSha = requireGitSha(manifest.candidateCommitSha, "manifest candidateCommitSha");
  if (manifestSha !== expectedSha) {
    throw new Error(`Release manifest belongs to ${manifestSha}, not ${expectedSha}`);
  }
  if (manifest.repository !== REPOSITORY) {
    throw new Error(`Release manifest repository must be ${REPOSITORY}`);
  }
  for (const [label, actual, expected] of [
    ["runtime", manifest.runtime, expectedIdentity.runtime],
    ["golden identity", manifest.golden, expectedIdentity.golden],
    ["captured-stream identity", manifest.capturedStream, expectedIdentity.capturedStream],
    ["locked source inputs", manifest.sourceInputs, expectedIdentity.sourceInputs],
  ]) {
    if (!isDeepStrictEqual(actual, expected)) {
      throw new Error(`Release manifest ${label} does not match the checked-out candidate`);
    }
  }

  const runtime = requireObject(manifest.runtime, "manifest runtime");
  for (const field of ["node", "npm", "expectedPackageManager"]) {
    requireString(runtime[field], `manifest runtime.${field}`);
  }
  const golden = requireObject(manifest.golden, "manifest golden");
  requireString(golden.path, "manifest golden.path");
  requireSha256(golden.fileSha256, "manifest golden.fileSha256");
  for (const field of ["eventHead", "stateHead", "decisionHead"]) {
    requireSha256(golden[field], `manifest golden.${field}`);
  }
  const capturedStream = requireObject(manifest.capturedStream, "manifest capturedStream");
  requireString(capturedStream.path, "manifest capturedStream.path");
  requireSha256(capturedStream.fileSha256, "manifest capturedStream.fileSha256");
  requireSafeInteger(capturedStream.eventCount, "manifest capturedStream.eventCount", 1);
  const sourceInputs = requireObject(manifest.sourceInputs, "manifest sourceInputs");
  requireString(sourceInputs.packageLockPath, "manifest sourceInputs.packageLockPath");
  requireSha256(sourceInputs.packageLockSha256, "manifest sourceInputs.packageLockSha256");

  const gates = requireObject(manifest.gates, "manifest gates");
  const gateNames = Object.keys(gates).sort();
  const requiredNames = [...REQUIRED_GATES].sort();
  if (JSON.stringify(gateNames) !== JSON.stringify(requiredNames)) {
    throw new Error(`Release manifest gates must be exactly: ${requiredNames.join(", ")}`);
  }

  for (const gateName of REQUIRED_GATES) {
    const gate = requireObject(gates[gateName], `manifest gate ${gateName}`);
    if (gate.status !== "passed") throw new Error(`Manifest gate ${gateName} is not passed`);
    requireString(gate.command, `manifest gate ${gateName}.command`);
    const runId = requireString(gate.runId, `manifest gate ${gateName}.runId`);
    if (!/^[1-9]\d*$/u.test(runId)) throw new Error(`Manifest gate ${gateName} has invalid runId`);
    const runAttempt = requireString(gate.runAttempt, `manifest gate ${gateName}.runAttempt`);
    if (!/^[1-9]\d*$/u.test(runAttempt)) {
      throw new Error(`Manifest gate ${gateName} has invalid runAttempt`);
    }
    requireRunUrl(gate.runUrl, runId, manifest.repository, `manifest gate ${gateName}.runUrl`);
    requireString(gate.workflowRef, `manifest gate ${gateName}.workflowRef`);
    requireGitSha(gate.workflowSha, `manifest gate ${gateName}.workflowSha`);
    requireString(gate.evidencePath, `manifest gate ${gateName}.evidencePath`);
    requireSha256(gate.evidenceFileSha256, `manifest gate ${gateName}.evidenceFileSha256`);
    const runner = requireObject(gate.runner, `manifest gate ${gateName}.runner`);
    for (const field of ["os", "arch", "environment", "imageOs", "imageVersion"]) {
      requireString(runner[field], `manifest gate ${gateName}.runner.${field}`);
    }
    const expectedOs = gateName === "check-windows" ? "Windows" : "Linux";
    if (
      runner.os !== expectedOs ||
      runner.arch !== "X64" ||
      runner.environment !== "github-hosted"
    ) {
      throw new Error(`Manifest gate ${gateName} has an invalid runner identity`);
    }
    if (gateName === "scale-100k-linux") {
      const trigger = requireObject(gate.trigger, `manifest gate ${gateName}.trigger`);
      for (const field of ["kind", "value", "actor"]) {
        requireString(trigger[field], `manifest gate ${gateName}.trigger.${field}`);
      }
      if (trigger.kind !== "pull_request_label" && trigger.kind !== "workflow_dispatch") {
        throw new Error(`Manifest gate ${gateName} was not manually triggered`);
      }
    } else if (gate.trigger !== null) {
      throw new Error(`Manifest gate ${gateName} has unexpected trigger provenance`);
    }
    if (CHECK_GATES.includes(gateName)) {
      validateCheckResults(gate.checkResults, `manifest gate ${gateName}.checkResults`);
    } else if (gate.checkResults !== null) {
      throw new Error(`Manifest gate ${gateName} has unexpected check results`);
    }
    if (!Array.isArray(gate.scaleMetrics)) {
      throw new Error(`Manifest gate ${gateName}.scaleMetrics must be an array`);
    }
    const seenCounts = new Set();
    for (const [index, metric] of gate.scaleMetrics.entries()) {
      const validated = validateScaleMetric(
        metric,
        expectedSha,
        expectedIdentity,
        `manifest gate ${gateName}.scaleMetrics[${index}]`,
      );
      if (seenCounts.has(validated.clusterCount)) {
        throw new Error(`Manifest gate ${gateName} duplicates ${validated.clusterCount} metrics`);
      }
      seenCounts.add(validated.clusterCount);
    }
  }

  for (const gateName of ["check-windows", "check-linux"]) {
    if (gates[gateName].scaleMetrics.length !== 0) {
      throw new Error(`Manifest gate ${gateName} has unexpected scale metrics`);
    }
  }
  for (const [gateName, counts] of [
    ["scale-10k-linux", [1_000, 10_000]],
    ["scale-100k-linux", [1_000, 100_000]],
  ]) {
    const actual = gates[gateName].scaleMetrics
      .map((metric) => metric.clusterCount)
      .sort((a, b) => a - b);
    if (JSON.stringify(actual) !== JSON.stringify(counts)) {
      throw new Error(
        `Manifest gate ${gateName} must contain exactly ${counts.join(" and ")} metrics`,
      );
    }
  }
  return manifest;
}

function metricFor(manifest, gateName, clusterCount) {
  return manifest.gates[gateName].scaleMetrics.find(
    (metric) => metric.clusterCount === clusterCount,
  );
}

function markdownCell(value) {
  return String(value)
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/gu, " ");
}

function coverageCell(metric) {
  return `${metric.percent}% (threshold ${metric.threshold}%)`;
}

function buildReport({
  manifest,
  manifestAssetName,
  manifestDigest,
  tag,
  decision,
  owner,
  date,
  rationale,
}) {
  const prepublicationCondition =
    decision === "CONDITIONAL GO"
      ? "This finalized report is mechanically `CONDITIONAL GO` until a draft GitHub pre-release has been populated with the reconciled manifest, this report, and `SHA256SUMS`, and is then published immutably."
      : "This finalized report records `NO-GO`; immutable publication preserves the evidence but cannot promote this decision. A new reconciled candidate and evidence package are required for reconsideration.";
  const lines = [
    "# Kernel V2 release-candidate go/no-go report",
    "",
    `- Evidence package format: \`${PACKAGE_FORMAT_VERSION}\``,
    `- Candidate commit: \`${manifest.candidateCommitSha}\``,
    `- Annotated candidate tag: \`${tag}\``,
    `- Repository: \`${manifest.repository}\``,
    `- Reconciliation status: \`${manifest.reconciliationStatus}\``,
    `- Reconciled manifest: \`${manifestAssetName}\``,
    `- Manifest SHA-256: \`${manifestDigest}\``,
    "",
    "## Gate evidence",
    "",
    "| Gate | Status | Run | Attempt | Workflow SHA | Runner image |",
    "| --- | --- | --- | ---: | --- | --- |",
  ];
  for (const gateName of REQUIRED_GATES) {
    const gate = manifest.gates[gateName];
    lines.push(
      `| ${gateName} | ${gate.status} | [${gate.runId}](${gate.runUrl}) | ${gate.runAttempt} | \`${gate.workflowSha}\` | ${markdownCell(`${gate.runner.imageOs} ${gate.runner.imageVersion}`)} |`,
    );
  }
  lines.push(
    "",
    "## Runtime and locked inputs",
    "",
    `- Node: \`${manifest.runtime.node}\``,
    `- npm: \`${manifest.runtime.npm}\``,
    `- Expected package manager: \`${manifest.runtime.expectedPackageManager}\``,
    `- Package-lock SHA-256: \`${manifest.sourceInputs.packageLockSha256}\``,
    `- Scale policy: \`${manifest.sourceInputs.scalePolicyPath}\` version \`${manifest.sourceInputs.scalePolicyVersion}\``,
    `- Scale-policy SHA-256: \`${manifest.sourceInputs.scalePolicySha256}\``,
    `- Captured stream SHA-256: \`${manifest.capturedStream.fileSha256}\` (${manifest.capturedStream.eventCount} events)`,
    "",
    "## Test, coverage, and mutation evidence",
    "",
    "| Gate | Tests | Passed | Failed | Skipped | Lines | Branches | Functions | Mutations |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |",
  );
  for (const gateName of CHECK_GATES) {
    const checkResults = manifest.gates[gateName].checkResults;
    const tests = checkResults.tests.value;
    const mutations = checkResults.mutations.value;
    lines.push(
      `| ${gateName} | ${tests.tests.tests} | ${tests.tests.passed} | ${tests.tests.failed} | ${tests.tests.skipped} | ${coverageCell(tests.coverage.lines)} | ${coverageCell(tests.coverage.branches)} | ${coverageCell(tests.coverage.functions)} | ${mutations.killed}/${mutations.total} |`,
    );
  }
  lines.push(
    "",
    "## Golden and replay identity",
    "",
    `- Golden file SHA-256: \`${manifest.golden.fileSha256}\``,
    `- Event head: \`${manifest.golden.eventHead}\``,
    `- State head: \`${manifest.golden.stateHead}\``,
    `- Decision head: \`${manifest.golden.decisionHead}\``,
    "",
    "## Scale evidence",
    "",
    "These measurements use workload `sparse-single-source-per-issuer-v1`: event count, issuer count, and cluster count are equal; each issuer has one source; and one writer processes the stream. This is a sparse sequential durability benchmark, not a dense cluster or full-pipeline benchmark. The canonical 1k result is the baseline from `scale-10k-linux`; the 100k job's repeated 1k baseline remains preserved in the manifest.",
    "",
    "| Clusters/events/issuers | Source gate | Integrity | Elapsed ms | Events/s | p50 ms | p95 ms | p99 ms | Max ms | Slope ms/event | Processing RSS before | Processing RSS after | Processing RSS delta | Audit-scan RSS after | Audit-scan RSS delta | Total RSS delta | Audit-scan ms | Page size | Aggregates | Outputs | DB bytes | WAL bytes | Max checkpoint bytes |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const [gateName, clusterCount] of [
    ["scale-10k-linux", 1_000],
    ["scale-10k-linux", 10_000],
    ["scale-100k-linux", 100_000],
  ]) {
    const metric = metricFor(manifest, gateName, clusterCount);
    lines.push(
      `| ${clusterCount} | ${gateName} | ${metric.integrityCheck} | ${metric.elapsedMs} | ${metric.throughputPerSecond} | ${metric.latencyMs.p50} | ${metric.latencyMs.p95} | ${metric.latencyMs.p99} | ${metric.latencyMs.max} | ${metric.latencyMs.slopePerEvent} | ${metric.rssBytes.before} | ${metric.rssBytes.afterProcessing} | ${metric.rssBytes.processingDelta} | ${metric.rssBytes.afterAuditScan} | ${metric.rssBytes.auditScanDelta} | ${metric.rssBytes.delta} | ${metric.auditScan.elapsedMs} | ${metric.auditScan.pageSize} | ${metric.auditScan.aggregateCount} | ${metric.auditScan.outputCount} | ${metric.storageBytes.database} | ${metric.storageBytes.wal} | ${metric.maxCheckpointBytes} |`,
    );
  }
  lines.push(
    "",
    "### Enforced performance budgets",
    "",
    "| Clusters | Min events/s | Max p95 ms | Max p99 ms | Max slope ms/event | Max processing RSS delta | Max DB bytes | Max WAL bytes |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const [gateName, clusterCount] of [
    ["scale-10k-linux", 1_000],
    ["scale-10k-linux", 10_000],
    ["scale-100k-linux", 100_000],
  ]) {
    const budget = metricFor(manifest, gateName, clusterCount).performanceBudget;
    lines.push(
      `| ${clusterCount} | ${budget.minThroughputPerSecond} | ${budget.maxP95Ms} | ${budget.maxP99Ms} | ${budget.maxSlopePerEvent} | ${budget.maxProcessingRssDeltaBytes} | ${budget.maxDatabaseBytes} | ${budget.maxWalBytes} |`,
    );
  }
  lines.push("", "## Known scope boundaries", "");
  for (const boundary of SCOPE_BOUNDARIES) lines.push(`- ${boundary}`);
  lines.push(
    "",
    "## Decision",
    "",
    `- Packaged pre-publication decision: **${decision}**`,
    `- Decision owner: ${owner}`,
    `- Decision date: \`${date}\``,
    `- Rationale: ${rationale}`,
    "",
    "## Publication and attestation",
    "",
    `${prepublicationCondition} \`SHA256SUMS\` lists the manifest and report but not itself, avoiding a circular self-digest; the immutable-release attestation covers \`SHA256SUMS\`.`,
    "",
    "Effective `GO` requires every command below to succeed after publication, with `isImmutable: true` and the expected tag/candidate identity:",
    "",
    "```text",
    `gh release view ${tag} --repo ${manifest.repository} --json isImmutable,tagName,targetCommitish`,
    `gh release verify ${tag} --repo ${manifest.repository}`,
    `gh release verify-asset ${tag} ${manifestAssetName} --repo ${manifest.repository}`,
    `gh release verify-asset ${tag} ${reportName} --repo ${manifest.repository}`,
    `gh release verify-asset ${tag} SHA256SUMS --repo ${manifest.repository}`,
    "```",
    "",
    decision === "CONDITIONAL GO"
      ? "The downloaded manifest and report must also match `SHA256SUMS`. Until all release and asset verifications succeed, the effective decision remains `CONDITIONAL GO`. If immutable releases are not enabled before publication or any verification fails, this package does not authorize `GO`."
      : "The downloaded manifest and report must also match `SHA256SUMS`. Successful verification authenticates this `NO-GO` evidence package but does not change its decision.",
    "",
  );
  return lines.join("\n");
}

const options = parseArguments(process.argv.slice(2));
const manifestPath = resolve(options.manifest);
const evidenceDirectory = resolve(options["evidence-dir"]);
const outputDirectory = resolve(options["output-dir"]);
const candidateSha = requireGitSha(options["candidate-sha"], "--candidate-sha");
const ciRunId = requireString(options["ci-run-id"], "--ci-run-id");
const scale100kRunId = requireString(options["100k-run-id"], "--100k-run-id");
for (const [label, runId] of [
  ["--ci-run-id", ciRunId],
  ["--100k-run-id", scale100kRunId],
]) {
  if (!/^[1-9]\d*$/u.test(runId)) throw new Error(`${label} must be a positive integer`);
}
const tag = requireString(options.tag, "--tag");
const decision = DECISIONS.get(options.decision);
if (options.decision === "GO") {
  throw new Error("Pre-publication evidence cannot declare GO; use CONDITIONAL_GO");
}
if (decision === undefined) throw new Error("--decision must be CONDITIONAL_GO or NO_GO");
const owner = requireString(options["decision-owner"], "--decision-owner");
if (!/^[\p{L}\p{N} ._@'-]{1,100}$/u.test(owner)) {
  throw new Error("--decision-owner contains unsupported characters or length");
}
const date = requireString(options["decision-date"], "--decision-date");
const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
const parsedDate =
  dateMatch === null
    ? null
    : new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
if (
  dateMatch === null ||
  parsedDate === null ||
  parsedDate.getUTCFullYear() !== Number(dateMatch[1]) ||
  parsedDate.getUTCMonth() + 1 !== Number(dateMatch[2]) ||
  parsedDate.getUTCDate() !== Number(dateMatch[3])
) {
  throw new Error("--decision-date must be a real ISO calendar date in YYYY-MM-DD form");
}
const rationale = requireString(options["decision-rationale"], "--decision-rationale");
if (rationale.length > 1_000) throw new Error("--decision-rationale exceeds 1000 characters");

requireRegularFile(manifestPath, "Manifest path");
requireDirectory(evidenceDirectory, "Evidence directory");
requireDirectory(outputDirectory, "Output directory");
const checkoutSha = git("rev-parse", "HEAD");
if (checkoutSha !== candidateSha) {
  throw new Error(`Checked-out commit ${checkoutSha} does not match candidate ${candidateSha}`);
}
if (git("status", "--porcelain").length !== 0) {
  throw new Error("Refusing to package RC evidence from a dirty worktree");
}
const originRepository = repositoryFromOrigin();
if (originRepository !== REPOSITORY) {
  throw new Error(`Origin repository ${originRepository} does not match ${REPOSITORY}`);
}
verifyAnnotatedTag(tag, candidateSha);
const expectedIdentity = checkoutIdentity();
const manifestBytes = readFileSync(manifestPath);
let manifestValue;
try {
  manifestValue = JSON.parse(manifestBytes.toString("utf8"));
} catch {
  throw new Error("Release manifest is not valid JSON");
}
const manifest = validateManifest(manifestValue, candidateSha, expectedIdentity);

const reconciliationDirectory = mkdtempSync(join(tmpdir(), "peas-rc-reconcile-"));
try {
  const regeneratedManifestPath = join(reconciliationDirectory, "release-manifest.json");
  try {
    execFileSync(
      process.execPath,
      [join(process.cwd(), "scripts", "reconcile-audit-evidence.mjs"), evidenceDirectory],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PEAS_CANDIDATE_SHA: candidateSha,
          PEAS_RELEASE_MANIFEST_PATH: regeneratedManifestPath,
          PEAS_EXPECTED_REPOSITORY: REPOSITORY,
          PEAS_EXPECTED_CI_RUN_ID: ciRunId,
          PEAS_EXPECTED_100K_RUN_ID: scale100kRunId,
        },
      },
    );
  } catch (error) {
    const detail =
      error !== null && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : String(error);
    throw new Error(`Raw release evidence did not reconcile: ${detail}`);
  }
  const regeneratedManifest = readFileSync(regeneratedManifestPath);
  if (!manifestBytes.equals(regeneratedManifest)) {
    throw new Error(
      "Supplied release manifest is not byte-identical to raw-evidence reconciliation",
    );
  }
} finally {
  rmSync(reconciliationDirectory, { recursive: true, force: true });
}

const manifestAssetName = `release-manifest-${candidateSha}.json`;
const reportName = `kernel-v2-go-no-go-${tag}.md`;
const checksumsName = "SHA256SUMS";
const manifestAssetPath = join(outputDirectory, manifestAssetName);
const reportPath = join(outputDirectory, reportName);
const checksumsPath = join(outputDirectory, checksumsName);
for (const [path, label] of [
  [manifestAssetPath, "Manifest asset"],
  [reportPath, "Go/no-go report"],
  [checksumsPath, "Checksum file"],
]) {
  requireAvailableOutput(path, label);
}

const manifestDigest = sha256(manifestBytes);
const report = buildReport({
  manifest,
  manifestAssetName,
  manifestDigest,
  tag,
  decision,
  owner,
  date,
  rationale,
});
const reportBytes = Buffer.from(report, "utf8");
const checksumEntries = [
  [manifestAssetName, manifestDigest],
  [reportName, sha256(reportBytes)],
].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
const checksums = `${checksumEntries.map(([name, digest]) => `${digest}  ${name}`).join("\n")}\n`;

writeFileSync(manifestAssetPath, manifestBytes, { flag: "wx" });
writeFileSync(reportPath, reportBytes, { flag: "wx" });
writeFileSync(checksumsPath, checksums, { encoding: "utf8", flag: "wx" });
process.stdout.write(
  `${JSON.stringify(
    {
      packageFormatVersion: PACKAGE_FORMAT_VERSION,
      candidateCommitSha: candidateSha,
      candidateTag: tag,
      manifest: manifestAssetName,
      report: reportName,
      checksums: checksumsName,
    },
    null,
    2,
  )}\n`,
);
