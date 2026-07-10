import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const REQUIRED_GATES = new Map([
  ["check-linux", null],
  ["check-windows", null],
  ["scale-10k-linux", 10_000],
  ["scale-100k-linux", 100_000],
]);

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

function assertPassingCheckResults(path, checkResults) {
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
}

const inputPaths = process.argv.slice(2);
if (inputPaths.length === 0) {
  throw new Error("Usage: npm run reconcile:evidence -- <evidence-file-or-directory> [...]");
}

const expectedSha = process.env.PEAS_CANDIDATE_SHA ?? git("rev-parse", "HEAD");
const evidencePaths = [];
for (const path of inputPaths) collectEvidencePaths(path, evidencePaths);
if (evidencePaths.length === 0) throw new Error("No audit-evidence-*.json files found");

const evidenceByGate = new Map();
for (const path of evidencePaths.sort()) {
  const bytes = readFileSync(path);
  const evidence = JSON.parse(bytes.toString("utf8"));
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
  if (gateName !== "scale-100k-linux" && evidence.githubRun.workflow !== "CI") {
    throw new Error(`${path} came from ${evidence.githubRun.workflow}, not CI`);
  }
  if (gateName.startsWith("check-") || gateName === "scale-100k-linux") {
    assertPassingCheckResults(path, evidence.checkResults);
  }

  const targetClusterCount = REQUIRED_GATES.get(gateName);
  if (
    targetClusterCount !== null &&
    !evidence.scaleMetrics?.some(
      (metrics) =>
        metrics.clusterCount === targetClusterCount &&
        metrics.candidateCommitSha === expectedSha &&
        metrics.gateStatus === "passed" &&
        metrics.integrityCheck === "ok" &&
        metrics.worktreeClean === true,
    )
  ) {
    throw new Error(`${path} lacks passing ${targetClusterCount}-cluster integrity evidence`);
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
    } else if (evidence.githubRun.eventName === "pull_request") {
      if (
        evidence.githubRun.workflow !== "CI" ||
        evidence.gate.trigger?.kind !== "pull_request_label" ||
        evidence.gate.trigger?.value !== "audit-100k"
      ) {
        throw new Error("The pre-merge 100k gate must be manually triggered by audit-100k");
      }
    } else {
      throw new Error("The release 100k gate was not manually triggered");
    }
  }

  evidenceByGate.set(gateName, {
    evidence,
    evidencePath: path,
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
const ciRunIds = new Set(
  ciGateNames.map((gateName) => evidenceByGate.get(gateName).evidence.githubRun.runId),
);
if (ciRunIds.size !== 1)
  throw new Error("Windows, Linux, and 10k evidence must come from one CI run");
const scale100k = evidenceByGate.get("scale-100k-linux").evidence;
if (
  scale100k.githubRun.eventName === "pull_request" &&
  scale100k.githubRun.runId !== [...ciRunIds][0]
) {
  throw new Error("A label-triggered 100k gate must share the reconciled CI run");
}

const manifest = {
  manifestVersion: 1,
  candidateCommitSha: expectedSha,
  reconciliationStatus: "passed",
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
