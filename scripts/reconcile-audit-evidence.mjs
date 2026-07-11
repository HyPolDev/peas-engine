import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const REQUIRED_GATES = new Map([
  ["check-linux", null],
  ["check-windows", null],
  ["scale-10k-linux", 10_000],
  ["scale-100k-linux", 100_000],
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CHECK_RESULT_PATHS = {
  tests: "audit-test-results.json",
  mutations: "audit-mutation-results.json",
};
const GOLDEN_PATH = "fixtures/earnings-cluster.v2.golden.json";
const CAPTURE_PATH = "fixtures/earnings-cluster.v2.captured.ndjson";
const PACKAGE_LOCK_PATH = "package-lock.json";
const SCALE_POLICY_PATH = "config/scale-policy.v1.json";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function collectEvidencePaths(path, found) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) throw new Error(`Refusing symlinked evidence input: ${path}`);
  if (metadata.isDirectory()) {
    for (const child of readdirSync(path).sort()) collectEvidencePaths(join(path, child), found);
    return;
  }
  if (/^audit-evidence-.+\.json$/u.test(basename(path))) found.push(path);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing required ${name}`);
  return value;
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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
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

function requireExactIdentity(path, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} ${label} does not match the checked-out candidate`);
  }
}

function readBoundJsonFile(evidencePath, descriptorValue, label) {
  const descriptor = requireObject(descriptorValue, label);
  const relativePath = requireString(descriptor.path, `${label}.path`);
  if (basename(relativePath) !== relativePath || relativePath === "." || relativePath === "..") {
    throw new Error(`${label}.path must be a sibling basename without traversal`);
  }
  const expectedDigest = requireSha256(descriptor.fileSha256, `${label}.fileSha256`);
  const path = join(dirname(evidencePath), relativePath);
  if (!existsSync(path)) throw new Error(`${label} sibling file is missing`);
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} does not reference a regular sibling file`);
  }
  const bytes = readFileSync(path);
  const actualDigest = sha256(bytes);
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `${label} digest ${expectedDigest} does not match sibling bytes ${actualDigest}`,
    );
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} sibling file is not valid JSON`);
  }
  if (!isDeepStrictEqual(value, descriptor.value)) {
    throw new Error(`${label} embedded value does not match its sibling file`);
  }
}

function verifyScaleMetricFile(evidencePath, metric, label) {
  const { path, fileSha256, ...value } = metric;
  readBoundJsonFile(evidencePath, { path, fileSha256, value }, label);
}

function candidateIdentity() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const goldenBytes = readFileSync(GOLDEN_PATH);
  const golden = JSON.parse(goldenBytes.toString("utf8"));
  const captureBytes = readFileSync(CAPTURE_PATH);
  const captureLines = captureBytes.toString("utf8").trim();
  const scalePolicyBytes = readFileSync(SCALE_POLICY_PATH);
  const scalePolicy = JSON.parse(scalePolicyBytes.toString("utf8"));
  if (
    scalePolicy.policyVersion !== 1 ||
    scalePolicy.metricsVersion !== 2 ||
    scalePolicy.measurementModel !== "event-processing-then-streaming-audit-scan"
  ) {
    throw new Error("Checked-out scale policy has unsupported identity");
  }
  const scalePolicyReference = {
    policyVersion: scalePolicy.policyVersion,
    path: SCALE_POLICY_PATH,
    fileSha256: sha256(scalePolicyBytes),
  };
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
      eventCount: captureLines.length === 0 ? 0 : captureLines.split(/\r?\n/u).length,
    },
    sourceInputs: {
      packageLockPath: PACKAGE_LOCK_PATH,
      packageLockSha256: sha256(readFileSync(PACKAGE_LOCK_PATH)),
      scalePolicyPath: SCALE_POLICY_PATH,
      scalePolicySha256: scalePolicyReference.fileSha256,
      scalePolicyVersion: scalePolicy.policyVersion,
    },
    scalePolicy,
    scalePolicyReference,
  };
}

function assertScalePolicyBinding(path, metrics, expectedIdentity) {
  const budget = expectedIdentity.scalePolicy.budgets?.[String(metrics.clusterCount)];
  if (
    metrics.metricsVersion !== expectedIdentity.scalePolicy.metricsVersion ||
    metrics.measurementModel !== expectedIdentity.scalePolicy.measurementModel ||
    !isDeepStrictEqual(metrics.scalePolicy, expectedIdentity.scalePolicyReference) ||
    budget === undefined ||
    !isDeepStrictEqual(metrics.performanceBudget, budget)
  ) {
    throw new Error(`${path} does not match the checked-out scale policy`);
  }
  const workload = expectedIdentity.scalePolicy.workload;
  if (
    metrics.workload?.name !== workload.name ||
    metrics.workload?.eventCount !== metrics.clusterCount ||
    metrics.workload?.issuerCount !== metrics.clusterCount ||
    metrics.workload?.sourcesPerIssuer !== workload.sourcesPerIssuer ||
    metrics.workload?.writerCount !== workload.writerCount
  ) {
    throw new Error(`${path} does not identify the policy's sparse durability workload`);
  }
}

function assertRemoteEvidenceShape(path, evidence) {
  requireObject(evidence, path);
  requireGitSha(evidence.candidateCommitSha, `${path} candidateCommitSha`);
  const gate = requireObject(evidence.gate, `${path} gate`);
  requireString(gate.name, `${path} gate.name`);
  requireString(gate.command, `${path} gate.command`);
  requireString(gate.status, `${path} gate.status`);
  if (gate.trigger !== null) {
    const trigger = requireObject(gate.trigger, `${path} gate.trigger`);
    requireString(trigger.kind, `${path} gate.trigger.kind`);
    requireString(trigger.value, `${path} gate.trigger.value`);
    requireString(trigger.actor, `${path} gate.trigger.actor`);
  }

  const githubRun = requireObject(evidence.githubRun, `${path} githubRun`);
  for (const field of [
    "eventName",
    "workflow",
    "workflowRef",
    "runId",
    "runAttempt",
    "job",
    "repository",
    "runUrl",
  ]) {
    requireString(githubRun[field], `${path} githubRun.${field}`);
  }
  requireGitSha(githubRun.eventSha, `${path} githubRun.eventSha`);
  requireGitSha(githubRun.workflowSha, `${path} githubRun.workflowSha`);
  if (!/^[1-9]\d*$/u.test(githubRun.runId)) {
    throw new Error(`${path} githubRun.runId must be a positive integer`);
  }
  if (!/^[1-9]\d*$/u.test(githubRun.runAttempt)) {
    throw new Error(`${path} githubRun.runAttempt must be a positive integer`);
  }
  if (!/^[^/]+\/[^/]+$/u.test(githubRun.repository)) {
    throw new Error(`${path} githubRun.repository must identify an owner and repository`);
  }
  if (!githubRun.runUrl.endsWith(`/${githubRun.runId}`)) {
    throw new Error(`${path} githubRun.runUrl does not identify its recorded run`);
  }

  const runner = requireObject(evidence.runner, `${path} runner`);
  for (const field of ["os", "arch", "environment", "imageOs", "imageVersion"]) {
    requireString(runner[field], `${path} runner.${field}`);
  }
  if (runner.arch !== "X64" || runner.environment !== "github-hosted") {
    throw new Error(`${path} was not produced by the required GitHub-hosted X64 runner`);
  }
  if (runner.imageOs === "unknown" || runner.imageVersion === "unknown") {
    throw new Error(`${path} lacks hosted-runner image identity`);
  }

  requireObject(evidence.runtime, `${path} runtime`);
  const golden = requireObject(evidence.golden, `${path} golden`);
  requireSha256(golden.fileSha256, `${path} golden.fileSha256`);
  for (const field of ["eventHead", "stateHead", "decisionHead"]) {
    requireSha256(golden[field], `${path} golden.${field}`);
  }
  const capturedStream = requireObject(evidence.capturedStream, `${path} capturedStream`);
  requireSha256(capturedStream.fileSha256, `${path} capturedStream.fileSha256`);
  if (!Number.isSafeInteger(capturedStream.eventCount) || capturedStream.eventCount < 1) {
    throw new Error(`${path} capturedStream.eventCount must be a positive safe integer`);
  }
  const sourceInputs = requireObject(evidence.sourceInputs, `${path} sourceInputs`);
  requireSha256(sourceInputs.packageLockSha256, `${path} sourceInputs.packageLockSha256`);
  if (!Array.isArray(evidence.scaleMetrics)) {
    throw new Error(`${path} scaleMetrics must be an array`);
  }
}

function assertPassingCheckResults(path, checkResults) {
  requireObject(checkResults, `${path} checkResults`);
  for (const [kind, expectedPath] of Object.entries(CHECK_RESULT_PATHS)) {
    const result = requireObject(checkResults[kind], `${path} checkResults.${kind}`);
    if (result.path !== expectedPath) {
      throw new Error(`${path} checkResults.${kind}.path is not ${expectedPath}`);
    }
    requireSha256(result.fileSha256, `${path} checkResults.${kind}.fileSha256`);
    requireObject(result.value, `${path} checkResults.${kind}.value`);
  }
  const tests = checkResults?.tests?.value;
  const mutations = checkResults?.mutations?.value;
  if (
    tests?.resultVersion !== 1 ||
    tests.status !== "passed" ||
    tests.tests?.failed !== 0 ||
    !(tests.tests?.tests > 0)
  ) {
    throw new Error(`${path} lacks passing test and coverage results`);
  }
  for (const dimension of ["lines", "branches", "functions"]) {
    const metric = tests.coverage?.[dimension];
    if (
      typeof metric?.percent !== "number" ||
      typeof metric?.threshold !== "number" ||
      metric.percent < metric.threshold
    ) {
      throw new Error(`${path} lacks passing ${dimension} coverage evidence`);
    }
  }
  if (
    mutations?.resultVersion !== 1 ||
    mutations.status !== "passed" ||
    !(mutations.total > 0) ||
    mutations.killed !== mutations.total
  ) {
    throw new Error(`${path} lacks complete mutation evidence`);
  }
  readBoundJsonFile(path, checkResults.tests, `${path} checkResults.tests`);
  readBoundJsonFile(path, checkResults.mutations, `${path} checkResults.mutations`);
}

const inputPaths = process.argv.slice(2);
if (inputPaths.length === 0) {
  throw new Error("Usage: npm run reconcile:evidence -- <evidence-file-or-directory> [...]");
}

const expectedSha = process.env.PEAS_CANDIDATE_SHA ?? git("rev-parse", "HEAD");
const expectedRepository = requiredEnvironment("PEAS_EXPECTED_REPOSITORY");
const expectedCiRunId = requiredEnvironment("PEAS_EXPECTED_CI_RUN_ID");
const expected100kRunId = requiredEnvironment("PEAS_EXPECTED_100K_RUN_ID");
if (!/^[^/]+\/[^/]+$/u.test(expectedRepository)) {
  throw new Error("PEAS_EXPECTED_REPOSITORY must identify one owner and repository");
}
for (const [name, value] of [
  ["PEAS_EXPECTED_CI_RUN_ID", expectedCiRunId],
  ["PEAS_EXPECTED_100K_RUN_ID", expected100kRunId],
]) {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${name} must be a positive integer`);
}
const originRepository = repositoryFromOrigin();
if (originRepository !== expectedRepository) {
  throw new Error(`Origin repository ${originRepository} does not match ${expectedRepository}`);
}
const checkoutSha = git("rev-parse", "HEAD");
if (expectedSha !== checkoutSha) {
  throw new Error(`Reconciliation candidate ${expectedSha} is not checked out at ${checkoutSha}`);
}
const expectedIdentity = candidateIdentity();
const evidencePaths = [];
for (const path of inputPaths) collectEvidencePaths(path, evidencePaths);
if (evidencePaths.length === 0) throw new Error("No audit-evidence-*.json files found");

const evidenceByGate = new Map();
const logicalEvidenceNames = new Set();
for (const path of evidencePaths.sort()) {
  const logicalEvidenceName = basename(path);
  if (logicalEvidenceNames.has(logicalEvidenceName)) {
    throw new Error(`Duplicate logical evidence basename ${logicalEvidenceName}`);
  }
  logicalEvidenceNames.add(logicalEvidenceName);
  const bytes = readFileSync(path);
  const evidence = JSON.parse(bytes.toString("utf8"));
  assertRemoteEvidenceShape(path, evidence);
  if (evidence.evidenceVersion !== 2)
    throw new Error(`${path} has an unsupported evidence version`);
  if (evidence.candidateCommitSha !== expectedSha) {
    throw new Error(`${path} belongs to ${evidence.candidateCommitSha}, not ${expectedSha}`);
  }
  if (evidence.worktreeClean !== true)
    throw new Error(`${path} was produced from a dirty worktree`);
  if (evidence.gate?.status !== "passed") throw new Error(`${path} is not passing evidence`);
  if (evidence.githubRun === null || evidence.githubRun === undefined) {
    throw new Error(`${path} is not remote GitHub Actions evidence`);
  }
  const gateName = evidence.gate?.name;
  if (!REQUIRED_GATES.has(gateName)) throw new Error(`${path} has unexpected gate ${gateName}`);
  if (evidenceByGate.has(gateName)) throw new Error(`Duplicate evidence for ${gateName}`);
  const expectedRunId = gateName === "scale-100k-linux" ? expected100kRunId : expectedCiRunId;
  if (evidence.githubRun.repository !== expectedRepository) {
    throw new Error(
      `${path} belongs to repository ${evidence.githubRun.repository}, not ${expectedRepository}`,
    );
  }
  if (evidence.githubRun.runId !== expectedRunId) {
    throw new Error(
      `${path} belongs to run ${evidence.githubRun.runId}, not trusted run ${expectedRunId}`,
    );
  }
  let runUrl;
  try {
    runUrl = new URL(evidence.githubRun.runUrl);
  } catch {
    throw new Error(`${path} has an invalid GitHub Actions run URL`);
  }
  if (
    runUrl.origin !== "https://github.com" ||
    runUrl.pathname !== `/${expectedRepository}/actions/runs/${expectedRunId}` ||
    runUrl.search !== "" ||
    runUrl.hash !== ""
  ) {
    throw new Error(`${path} run URL does not match trusted repository and run identity`);
  }
  const expectedJob =
    gateName === "check-linux" || gateName === "check-windows"
      ? "check"
      : gateName === "scale-10k-linux"
        ? "scale-10k"
        : "scale-100k";
  if (evidence.githubRun.job !== expectedJob) {
    throw new Error(`${path} came from job ${evidence.githubRun.job}, not ${expectedJob}`);
  }
  if (gateName !== "scale-100k-linux" && evidence.githubRun.workflow !== "CI") {
    throw new Error(`${path} came from ${evidence.githubRun.workflow}, not CI`);
  }
  if (
    gateName !== "scale-100k-linux" &&
    evidence.githubRun.eventName !== "pull_request" &&
    evidence.githubRun.eventName !== "push"
  ) {
    throw new Error(`${path} has an invalid CI event ${evidence.githubRun.eventName}`);
  }
  if (gateName !== "scale-100k-linux" && evidence.gate.trigger !== null) {
    throw new Error(`${path} has unexpected manual-trigger provenance`);
  }
  if (gateName.startsWith("check-") || gateName === "scale-100k-linux") {
    assertPassingCheckResults(path, evidence.checkResults);
  } else if (evidence.checkResults !== null) {
    throw new Error(`${path} has unexpected check results`);
  }

  const targetClusterCount = REQUIRED_GATES.get(gateName);
  if (targetClusterCount === null && evidence.scaleMetrics.length !== 0) {
    throw new Error(`${path} has unexpected scale metrics`);
  }
  for (const metrics of evidence.scaleMetrics) {
    if (
      !isObject(metrics) ||
      !Number.isSafeInteger(metrics.clusterCount) ||
      metrics.clusterCount < 1 ||
      metrics.candidateCommitSha !== expectedSha ||
      metrics.gateStatus !== "passed" ||
      metrics.integrityCheck !== "ok" ||
      metrics.worktreeClean !== true
    ) {
      throw new Error(`${path} contains non-passing or malformed scale evidence`);
    }
    assertScalePolicyBinding(path, metrics, expectedIdentity);
    verifyScaleMetricFile(
      path,
      metrics,
      `${path} scaleMetrics[${metrics.clusterCount ?? "unknown"}]`,
    );
  }
  if (targetClusterCount !== null) {
    const targetMetrics = evidence.scaleMetrics.filter(
      (metrics) => metrics.clusterCount === targetClusterCount,
    );
    if (targetMetrics.length !== 1) {
      throw new Error(
        `${path} must contain exactly one passing ${targetClusterCount}-cluster integrity result`,
      );
    }
  }
  if (gateName === "scale-100k-linux") {
    if (evidence.githubRun.eventName === "workflow_dispatch") {
      if (evidence.githubRun.workflow !== "Nightly audit") {
        throw new Error("A dispatched 100k gate must come from the Nightly audit workflow");
      }
      if (
        evidence.githubRun.eventSha !== expectedSha ||
        evidence.githubRun.workflowSha !== expectedSha
      ) {
        throw new Error(
          "The manual 100k run ref and workflow definition must match the candidate SHA",
        );
      }
      if (evidence.gate.trigger?.kind !== "workflow_dispatch") {
        throw new Error("The 100k evidence lacks its workflow-dispatch identity");
      }
      if (evidence.gate.trigger.value !== expectedSha) {
        throw new Error("The 100k workflow-dispatch identity does not match the candidate SHA");
      }
    } else if (evidence.githubRun.eventName === "pull_request") {
      if (
        evidence.githubRun.workflow !== "CI" ||
        evidence.gate.trigger?.kind !== "pull_request_label" ||
        evidence.gate.trigger?.value !== "audit-100k"
      ) {
        throw new Error("The pre-merge 100k gate must be manually triggered by audit-100k");
      }
    } else if (evidence.githubRun.eventName === "schedule") {
      if (evidence.gate.trigger?.kind !== "schedule") {
        throw new Error("Scheduled 100k evidence does not record its schedule provenance");
      }
      throw new Error(
        "Scheduled 100k evidence is regression-only and cannot satisfy a release gate",
      );
    } else {
      throw new Error("The release 100k gate was not manually triggered");
    }
  }

  const expectedWorkflowPath =
    gateName === "scale-100k-linux" && evidence.githubRun.eventName !== "pull_request"
      ? ".github/workflows/nightly-audit.yml@"
      : ".github/workflows/ci.yml@";
  if (
    !evidence.githubRun.workflowRef.startsWith(
      `${evidence.githubRun.repository}/${expectedWorkflowPath}`,
    )
  ) {
    throw new Error(`${path} has a workflow ref that does not match its recorded gate`);
  }

  requireExactIdentity(path, "runtime", evidence.runtime, expectedIdentity.runtime);
  requireExactIdentity(path, "golden evidence", evidence.golden, expectedIdentity.golden);
  requireExactIdentity(
    path,
    "captured-stream evidence",
    evidence.capturedStream,
    expectedIdentity.capturedStream,
  );
  requireExactIdentity(
    path,
    "locked source inputs",
    evidence.sourceInputs,
    expectedIdentity.sourceInputs,
  );

  evidenceByGate.set(gateName, {
    evidence,
    evidencePath: logicalEvidenceName,
    evidenceFileSha256: sha256(bytes),
  });
}

for (const gateName of REQUIRED_GATES.keys()) {
  if (!evidenceByGate.has(gateName)) throw new Error(`Missing required evidence for ${gateName}`);
}

const records = [...evidenceByGate.entries()].sort(([left], [right]) => left.localeCompare(right));
const firstEvidence = records[0]?.[1].evidence;
const runtimeFingerprint = JSON.stringify(firstEvidence.runtime);
const goldenFingerprint = JSON.stringify(firstEvidence.golden);
const capturedStreamFingerprint = JSON.stringify(firstEvidence.capturedStream);
const sourceInputsFingerprint = JSON.stringify(firstEvidence.sourceInputs);
for (const [gateName, record] of records) {
  if (JSON.stringify(record.evidence.runtime) !== runtimeFingerprint) {
    throw new Error(`${gateName} used a different Node/npm runtime`);
  }
  if (JSON.stringify(record.evidence.golden) !== goldenFingerprint) {
    throw new Error(`${gateName} used different golden evidence`);
  }
  if (JSON.stringify(record.evidence.capturedStream) !== capturedStreamFingerprint) {
    throw new Error(`${gateName} used a different captured stream`);
  }
  if (JSON.stringify(record.evidence.sourceInputs) !== sourceInputsFingerprint) {
    throw new Error(`${gateName} used different locked source inputs`);
  }
  const expectedRunnerOs = gateName === "check-windows" ? "Windows" : "Linux";
  if (record.evidence.runner?.os !== expectedRunnerOs) {
    throw new Error(`${gateName} ran on ${record.evidence.runner?.os}, not ${expectedRunnerOs}`);
  }
}

const ciGateNames = ["check-linux", "check-windows", "scale-10k-linux"];
const ciIdentityFields = [
  "eventName",
  "eventSha",
  "workflow",
  "workflowRef",
  "workflowSha",
  "runId",
  "runAttempt",
  "repository",
  "runUrl",
];
const firstCiRun = evidenceByGate.get(ciGateNames[0]).evidence.githubRun;
for (const gateName of ciGateNames.slice(1)) {
  const githubRun = evidenceByGate.get(gateName).evidence.githubRun;
  if (ciIdentityFields.some((field) => githubRun[field] !== firstCiRun[field])) {
    throw new Error("Windows, Linux, and 10k evidence must share one complete CI run identity");
  }
}
const scale100k = evidenceByGate.get("scale-100k-linux").evidence;
if (scale100k.githubRun.repository !== firstCiRun.repository) {
  throw new Error("All release evidence must come from one GitHub repository");
}
if (
  scale100k.githubRun.eventName === "pull_request" &&
  ciIdentityFields.some((field) => scale100k.githubRun[field] !== firstCiRun[field])
) {
  throw new Error("A label-triggered 100k gate must share the complete reconciled CI run identity");
}

const manifest = {
  manifestVersion: 2,
  candidateCommitSha: expectedSha,
  reconciliationStatus: "passed",
  repository: firstCiRun.repository,
  runtime: firstEvidence.runtime,
  golden: firstEvidence.golden,
  capturedStream: firstEvidence.capturedStream,
  sourceInputs: firstEvidence.sourceInputs,
  gates: Object.fromEntries(
    records.map(([gateName, record]) => [
      gateName,
      {
        status: record.evidence.gate.status,
        command: record.evidence.gate.command,
        trigger: record.evidence.gate.trigger,
        runUrl: record.evidence.githubRun.runUrl,
        runId: record.evidence.githubRun.runId,
        runAttempt: record.evidence.githubRun.runAttempt,
        workflowRef: record.evidence.githubRun.workflowRef,
        workflowSha: record.evidence.githubRun.workflowSha,
        runner: record.evidence.runner,
        checkResults: record.evidence.checkResults,
        evidencePath: record.evidencePath,
        evidenceFileSha256: record.evidenceFileSha256,
        scaleMetrics: record.evidence.scaleMetrics,
      },
    ]),
  ),
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
const outputPath = process.env.PEAS_RELEASE_MANIFEST_PATH;
if (outputPath === undefined) process.stdout.write(serialized);
else writeFileSync(outputPath, serialized, "utf8");
