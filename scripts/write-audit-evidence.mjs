import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJsonEvidence(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
  const bytes = readFileSync(path);
  const value = JSON.parse(bytes.toString("utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object`);
  }
  return { path, fileSha256: sha256(bytes), value };
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing required ${name}`);
  return value;
}

const candidateCommitSha = git("rev-parse", "HEAD");
const expectedSha = process.env.PEAS_CANDIDATE_SHA;
if (process.env.CI === "true" && expectedSha === undefined) {
  throw new Error("CI evidence must declare PEAS_CANDIDATE_SHA");
}
if (expectedSha !== undefined && candidateCommitSha !== expectedSha) {
  throw new Error(
    `Evidence SHA mismatch: expected ${expectedSha}, checked out ${candidateCommitSha}`,
  );
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const npmUserAgent = process.env.npm_config_user_agent ?? "unknown";
const goldenPath = "fixtures/earnings-cluster.v2.golden.json";
const capturePath = "fixtures/earnings-cluster.v2.captured.ndjson";
const packageLockPath = "package-lock.json";
const scalePolicyPath = "config/scale-policy.v1.json";
const artifactVaultPolicyPath = "config/artifact-vault-deployment-policy.v1.json";
const artifactPlatformCapabilitiesPath = "config/artifact-platform-capabilities.v1.json";
const artifactFaultBoundariesPath = "config/artifact-fault-boundaries.json";
const goldenBytes = readFileSync(goldenPath);
const captureBytes = readFileSync(capturePath);
const packageLockBytes = readFileSync(packageLockPath);
const scalePolicyBytes = readFileSync(scalePolicyPath);
const artifactVaultPolicyBytes = readFileSync(artifactVaultPolicyPath);
const artifactPlatformCapabilitiesBytes = readFileSync(artifactPlatformCapabilitiesPath);
const artifactFaultBoundariesBytes = readFileSync(artifactFaultBoundariesPath);
const scalePolicy = JSON.parse(scalePolicyBytes.toString("utf8"));
const artifactVaultPolicy = JSON.parse(artifactVaultPolicyBytes.toString("utf8"));
const artifactPlatformCapabilities = JSON.parse(artifactPlatformCapabilitiesBytes.toString("utf8"));
const artifactFaultBoundaries = JSON.parse(artifactFaultBoundariesBytes.toString("utf8"));
if (scalePolicy.policyVersion !== 1) throw new Error("Unsupported scale policy version");
if (
  artifactVaultPolicy.policyVersion !== 1 ||
  artifactPlatformCapabilities.inventoryVersion !== 1 ||
  artifactFaultBoundaries.schemaVersion !== 1
) {
  throw new Error("Unsupported artifact-vault policy or capability inventory");
}
const golden = JSON.parse(goldenBytes.toString("utf8"));
const npmVersion = npmUserAgent.match(/^npm\/([^\s]+)/u)?.[1] ?? "unknown";
if (process.env.CI === "true" && npmVersion === "unknown") {
  throw new Error("CI evidence could not identify the npm runtime");
}
const scaleMetrics = readdirSync(".")
  .filter((path) => /^scale-metrics-[^.]+\.json$/u.test(path))
  .sort()
  .map((path) => {
    const bytes = readFileSync(path);
    const metrics = JSON.parse(bytes.toString("utf8"));
    if (metrics.candidateCommitSha !== candidateCommitSha) {
      throw new Error(
        `${path} belongs to ${metrics.candidateCommitSha}, not ${candidateCommitSha}`,
      );
    }
    if (metrics.gateStatus !== "passed" || metrics.integrityCheck !== "ok") {
      throw new Error(`${path} is not passing, integrity-checked scale evidence`);
    }
    if (metrics.worktreeClean !== true) {
      throw new Error(`${path} was not measured from a clean worktree`);
    }
    return { ...metrics, path, fileSha256: sha256(bytes) };
  });
const githubRun =
  process.env.GITHUB_ACTIONS === "true"
    ? {
        eventName: requiredEnvironment("GITHUB_EVENT_NAME"),
        eventSha: requiredEnvironment("GITHUB_SHA"),
        workflow: requiredEnvironment("GITHUB_WORKFLOW"),
        workflowRef: requiredEnvironment("GITHUB_WORKFLOW_REF"),
        workflowSha: requiredEnvironment("GITHUB_WORKFLOW_SHA"),
        runId: requiredEnvironment("GITHUB_RUN_ID"),
        runAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
        job: requiredEnvironment("GITHUB_JOB"),
        repository: requiredEnvironment("GITHUB_REPOSITORY"),
        runUrl: `${requiredEnvironment("GITHUB_SERVER_URL")}/${requiredEnvironment("GITHUB_REPOSITORY")}/actions/runs/${requiredEnvironment("GITHUB_RUN_ID")}`,
      }
    : null;
const gateName =
  process.env.CI === "true"
    ? requiredEnvironment("PEAS_GATE_NAME")
    : (process.env.PEAS_GATE_NAME ?? "local");
const gateCommand =
  process.env.CI === "true"
    ? requiredEnvironment("PEAS_GATE_COMMAND")
    : (process.env.PEAS_GATE_COMMAND ?? "unspecified");
const triggerKind = process.env.PEAS_TRIGGER_KIND;
const trigger =
  triggerKind === undefined
    ? null
    : {
        kind: triggerKind,
        value: requiredEnvironment("PEAS_TRIGGER_VALUE"),
        actor: requiredEnvironment("PEAS_TRIGGER_ACTOR"),
      };
const requiresCheckResults = gateName.startsWith("check-") || gateName.startsWith("scale-100k");
const checkResults = requiresCheckResults
  ? {
      tests: readJsonEvidence("audit-test-results.json", "test and coverage results"),
      mutations: readJsonEvidence("audit-mutation-results.json", "mutation results"),
      hardKill: readJsonEvidence("audit-hard-kill-results.json", "hard-kill results"),
      platform: readJsonEvidence(
        `vault-platform-evidence-${gateName}.json`,
        "vault platform results",
      ),
    }
  : null;
if (checkResults !== null) {
  const testResult = checkResults.tests.value;
  if (
    testResult.resultVersion !== 1 ||
    testResult.status !== "passed" ||
    testResult.tests?.failed !== 0 ||
    !(testResult.tests?.tests > 0)
  ) {
    throw new Error("Test result is not a passing, non-empty audit gate");
  }
  for (const dimension of ["lines", "branches", "functions"]) {
    const metric = testResult.coverage?.[dimension];
    if (
      typeof metric?.percent !== "number" ||
      typeof metric?.threshold !== "number" ||
      metric.percent < metric.threshold
    ) {
      throw new Error(`Coverage ${dimension} did not satisfy its recorded threshold`);
    }
  }
  const mutationResult = checkResults.mutations.value;
  if (
    mutationResult.resultVersion !== 1 ||
    mutationResult.status !== "passed" ||
    !(mutationResult.total > 0) ||
    mutationResult.killed !== mutationResult.total
  ) {
    throw new Error("Mutation result is not a complete passing audit gate");
  }
  const hardKillResult = checkResults.hardKill.value;
  if (
    hardKillResult.resultVersion !== 1 ||
    hardKillResult.status !== "passed" ||
    hardKillResult.candidateCommitSha !== candidateCommitSha ||
    !Array.isArray(hardKillResult.boundaries) ||
    hardKillResult.boundaries.length === 0 ||
    hardKillResult.boundaries.some((boundary) => boundary.converged !== true)
  ) {
    throw new Error("Hard-kill result is not complete passing candidate evidence");
  }
  const platformResult = checkResults.platform.value;
  if (
    platformResult.schemaVersion !== 2 ||
    platformResult.candidateCommitSha !== candidateCommitSha ||
    platformResult.worktreeClean !== true ||
    platformResult.completeForGo !== true ||
    !Array.isArray(platformResult.unsupportedRequiredCapabilities) ||
    platformResult.unsupportedRequiredCapabilities.length !== 0
  ) {
    throw new Error("Platform result is not complete passing candidate evidence");
  }
}
const evidence = {
  evidenceVersion: 2,
  candidateCommitSha,
  worktreeClean: git("status", "--porcelain").length === 0,
  gate: {
    name: gateName,
    command: gateCommand,
    status: "passed",
    trigger,
  },
  githubRun,
  runner: {
    os:
      process.env.GITHUB_ACTIONS === "true"
        ? requiredEnvironment("RUNNER_OS")
        : (process.env.RUNNER_OS ?? process.platform),
    arch:
      process.env.GITHUB_ACTIONS === "true"
        ? requiredEnvironment("RUNNER_ARCH")
        : (process.env.RUNNER_ARCH ?? process.arch),
    environment: process.env.RUNNER_ENVIRONMENT ?? "local",
    imageOs: process.env.ImageOS ?? "unknown",
    imageVersion: process.env.ImageVersion ?? "unknown",
  },
  runtime: {
    node: process.versions.node,
    npm: npmVersion,
    expectedPackageManager: packageJson.packageManager,
  },
  golden: {
    path: goldenPath,
    fileSha256: sha256(goldenBytes),
    eventHead: golden.eventHead,
    stateHead: golden.stateHead,
    decisionHead: golden.decisionHead,
  },
  capturedStream: {
    path: capturePath,
    fileSha256: sha256(captureBytes),
    eventCount: captureBytes.toString("utf8").trim().split(/\r?\n/u).length,
  },
  sourceInputs: {
    packageLockPath,
    packageLockSha256: sha256(packageLockBytes),
    scalePolicyPath,
    scalePolicySha256: sha256(scalePolicyBytes),
    scalePolicyVersion: scalePolicy.policyVersion,
    artifactVaultPolicyPath,
    artifactVaultPolicySha256: sha256(artifactVaultPolicyBytes),
    artifactVaultPolicyVersion: artifactVaultPolicy.policyVersion,
    artifactPlatformCapabilitiesPath,
    artifactPlatformCapabilitiesSha256: sha256(artifactPlatformCapabilitiesBytes),
    artifactPlatformCapabilitiesVersion: artifactPlatformCapabilities.inventoryVersion,
    artifactFaultBoundariesPath,
    artifactFaultBoundariesSha256: sha256(artifactFaultBoundariesBytes),
    artifactFaultBoundariesVersion: artifactFaultBoundaries.schemaVersion,
  },
  checkResults,
  scaleMetrics,
};
if (!evidence.worktreeClean) throw new Error("Refusing evidence from a dirty worktree");

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
const outputPath = process.env.PEAS_EVIDENCE_PATH;
if (outputPath === undefined) process.stdout.write(serialized);
else writeFileSync(outputPath, serialized, "utf8");
