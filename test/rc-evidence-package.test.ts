import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const repository = "HyPolDev/peas-engine";
const candidateTag = "v0.2.0-kernel-rc.test";
const otherTag = "v0.2.0-kernel-other.test";

function sha256(bytes: NodeJS.ArrayBufferView | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function copyRepositoryFile(repositoryRoot: string, relativePath: string): void {
  const destination = join(repositoryRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(process.cwd(), relativePath), destination);
}

function descriptor(path: string, value: unknown) {
  return { path, fileSha256: sha256(jsonBytes(value)), value };
}

const testResult = {
  resultVersion: 1,
  status: "passed",
  tests: { tests: 10, passed: 9, failed: 0, skipped: 1, cancelled: 0, todo: 0 },
  coverage: {
    lines: { percent: 92.5, threshold: 90 },
    branches: { percent: 82.5, threshold: 80 },
    functions: { percent: 97.5, threshold: 95 },
  },
};
const mutationResult = { resultVersion: 1, status: "passed", killed: 5, total: 5 };

type ScalePolicy = {
  policyVersion: 1;
  metricsVersion: 2;
  measurementModel: "event-processing-then-streaming-audit-scan";
  workload: {
    name: "sparse-single-source-per-issuer-v1";
    sourcesPerIssuer: 1;
    writerCount: 1;
  };
  budgets: Record<string, Record<string, number>>;
};

function checkoutIdentity(repositoryRoot: string) {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
    packageManager: string;
    engines: { node: string; npm: string };
  };
  const goldenPath = "fixtures/earnings-cluster.v2.golden.json";
  const capturePath = "fixtures/earnings-cluster.v2.captured.ndjson";
  const packageLockPath = "package-lock.json";
  const scalePolicyPath = "config/scale-policy.v1.json";
  const goldenBytes = readFileSync(join(repositoryRoot, goldenPath));
  const golden = JSON.parse(goldenBytes.toString("utf8")) as {
    eventHead: string;
    stateHead: string;
    decisionHead: string;
  };
  const captureBytes = readFileSync(join(repositoryRoot, capturePath));
  const scalePolicyBytes = readFileSync(join(repositoryRoot, scalePolicyPath));
  const scalePolicy = JSON.parse(scalePolicyBytes.toString("utf8")) as ScalePolicy;
  return {
    runtime: {
      node: packageJson.engines.node,
      npm: packageJson.engines.npm,
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
      packageLockSha256: sha256(readFileSync(join(repositoryRoot, packageLockPath))),
      scalePolicyPath,
      scalePolicySha256: sha256(scalePolicyBytes),
      scalePolicyVersion: scalePolicy.policyVersion,
    },
    scalePolicy,
    scalePolicyReference: {
      policyVersion: scalePolicy.policyVersion,
      path: scalePolicyPath,
      fileSha256: sha256(scalePolicyBytes),
    },
  };
}

function scaleMetric(
  clusterCount: number,
  candidateSha: string,
  identity: ReturnType<typeof checkoutIdentity>,
) {
  const budget = identity.scalePolicy.budgets[String(clusterCount)];
  if (budget === undefined) throw new Error(`Missing scale policy budget for ${clusterCount}`);
  return {
    metricsVersion: identity.scalePolicy.metricsVersion,
    measurementModel: identity.scalePolicy.measurementModel,
    scalePolicy: identity.scalePolicyReference,
    workload: {
      name: identity.scalePolicy.workload.name,
      eventCount: clusterCount,
      issuerCount: clusterCount,
      sourcesPerIssuer: identity.scalePolicy.workload.sourcesPerIssuer,
      writerCount: identity.scalePolicy.workload.writerCount,
    },
    gateStatus: "passed",
    integrityCheck: "ok",
    candidateCommitSha: candidateSha,
    worktreeClean: true,
    clusterCount,
    elapsedMs: clusterCount * 5,
    throughputPerSecond: 200,
    latencyMs: { p50: 1, p95: 2, p99: 3, max: 4, slopePerEvent: -0.001 },
    rssBytes: {
      before: 1_000,
      afterProcessing: 900,
      processingDelta: -100,
      afterAuditScan: 950,
      auditScanDelta: 50,
      after: 950,
      delta: -50,
    },
    auditScan: {
      pageSize: 1_000,
      elapsedMs: 25,
      aggregateCount: clusterCount,
      outputCount: clusterCount + 1,
    },
    storageBytes: { database: clusterCount * 100, wal: 4_000 },
    maxCheckpointBytes: 2_200,
    performanceBudget: budget,
  };
}

function writeEvidenceArtifact(options: {
  directory: string;
  gateName: string;
  candidateSha: string;
  identity: ReturnType<typeof checkoutIdentity>;
  metrics: readonly number[];
}): void {
  mkdirSync(options.directory, { recursive: true });
  const isCheck = options.gateName.startsWith("check-");
  const is100k = options.gateName === "scale-100k-linux";
  const checkResults =
    isCheck || is100k
      ? {
          tests: descriptor("audit-test-results.json", testResult),
          mutations: descriptor("audit-mutation-results.json", mutationResult),
        }
      : null;
  if (checkResults !== null) {
    writeFileSync(join(options.directory, checkResults.tests.path), jsonBytes(testResult));
    writeFileSync(join(options.directory, checkResults.mutations.path), jsonBytes(mutationResult));
  }
  const embeddedMetrics = options.metrics.map((clusterCount) => {
    const value = scaleMetric(clusterCount, options.candidateSha, options.identity);
    const path = `scale-metrics-${clusterCount}.json`;
    writeFileSync(join(options.directory, path), jsonBytes(value));
    return { ...value, path, fileSha256: sha256(jsonBytes(value)) };
  });
  const job = options.gateName.startsWith("check-")
    ? "check"
    : options.gateName === "scale-10k-linux"
      ? "scale-10k"
      : "scale-100k";
  const record = {
    evidenceVersion: 2,
    candidateCommitSha: options.candidateSha,
    worktreeClean: true,
    gate: {
      name: options.gateName,
      command: "synthetic audited command",
      status: "passed",
      trigger: is100k
        ? { kind: "pull_request_label", value: "audit-100k", actor: "audit-user" }
        : null,
    },
    githubRun: {
      eventName: "pull_request",
      eventSha: options.candidateSha,
      workflow: "CI",
      workflowRef: `${repository}/.github/workflows/ci.yml@refs/heads/candidate`,
      workflowSha: options.candidateSha,
      runId: "100",
      runAttempt: "1",
      job,
      repository,
      runUrl: `https://github.com/${repository}/actions/runs/100`,
    },
    runner: {
      os: options.gateName === "check-windows" ? "Windows" : "Linux",
      arch: "X64",
      environment: "github-hosted",
      imageOs: options.gateName === "check-windows" ? "win25" : "ubuntu24",
      imageVersion: "synthetic",
    },
    runtime: options.identity.runtime,
    golden: options.identity.golden,
    capturedStream: options.identity.capturedStream,
    sourceInputs: options.identity.sourceInputs,
    checkResults,
    scaleMetrics: embeddedMetrics,
  };
  writeFileSync(
    join(options.directory, `audit-evidence-${options.gateName}.json`),
    jsonBytes(record),
  );
}

type RepositoryFixture = {
  root: string;
  repositoryRoot: string;
  evidenceDirectory: string;
  manifestBytes: Buffer;
  manifest: Record<string, unknown>;
  candidateSha: string;
};

function createFixture(context: test.TestContext): RepositoryFixture {
  const root = mkdtempSync(join(tmpdir(), "peas-package-fixture-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const repositoryRoot = join(root, "repository");
  mkdirSync(repositoryRoot);
  git(repositoryRoot, "init", "--initial-branch=main");
  git(repositoryRoot, "config", "user.name", "PEAS Test");
  git(repositoryRoot, "config", "user.email", "peas-test@example.invalid");
  git(repositoryRoot, "config", "core.autocrlf", "false");
  writeFileSync(join(repositoryRoot, "seed.txt"), "seed\n");
  git(repositoryRoot, "add", "seed.txt");
  git(repositoryRoot, "commit", "-m", "seed");
  const seedSha = git(repositoryRoot, "rev-parse", "HEAD");
  rmSync(join(repositoryRoot, "seed.txt"));
  for (const path of [
    ".gitignore",
    "package.json",
    "package-lock.json",
    "config/scale-policy.v1.json",
    "fixtures/earnings-cluster.v2.golden.json",
    "fixtures/earnings-cluster.v2.captured.ndjson",
    "scripts/reconcile-audit-evidence.mjs",
    "scripts/package-rc-evidence.mjs",
  ]) {
    copyRepositoryFile(repositoryRoot, path);
  }
  git(repositoryRoot, "add", "-A");
  git(repositoryRoot, "commit", "-m", "candidate");
  const candidateSha = git(repositoryRoot, "rev-parse", "HEAD");
  git(repositoryRoot, "tag", "-a", candidateTag, "-m", "candidate", candidateSha);
  git(repositoryRoot, "tag", "-a", otherTag, "-m", "other", seedSha);
  git(repositoryRoot, "remote", "add", "origin", `https://github.com/${repository}.git`);

  const identity = checkoutIdentity(repositoryRoot);
  const evidenceDirectory = join(root, "evidence");
  writeEvidenceArtifact({
    directory: join(evidenceDirectory, "check-linux"),
    gateName: "check-linux",
    candidateSha,
    identity,
    metrics: [],
  });
  writeEvidenceArtifact({
    directory: join(evidenceDirectory, "check-windows"),
    gateName: "check-windows",
    candidateSha,
    identity,
    metrics: [],
  });
  writeEvidenceArtifact({
    directory: join(evidenceDirectory, "scale-10k"),
    gateName: "scale-10k-linux",
    candidateSha,
    identity,
    metrics: [1_000, 10_000],
  });
  writeEvidenceArtifact({
    directory: join(evidenceDirectory, "scale-100k"),
    gateName: "scale-100k-linux",
    candidateSha,
    identity,
    metrics: [1_000, 100_000],
  });
  const manifestPath = join(root, "release-manifest.json");
  execFileSync(
    process.execPath,
    [join(repositoryRoot, "scripts", "reconcile-audit-evidence.mjs"), evidenceDirectory],
    {
      cwd: repositoryRoot,
      windowsHide: true,
      env: {
        ...process.env,
        PEAS_CANDIDATE_SHA: candidateSha,
        PEAS_RELEASE_MANIFEST_PATH: manifestPath,
        PEAS_EXPECTED_REPOSITORY: repository,
        PEAS_EXPECTED_CI_RUN_ID: "100",
        PEAS_EXPECTED_100K_RUN_ID: "100",
      },
    },
  );
  const manifestBytes = readFileSync(manifestPath);
  return {
    root,
    repositoryRoot,
    evidenceDirectory,
    manifestBytes,
    manifest: JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>,
    candidateSha,
  };
}

type InvokeOptions = {
  manifest?: unknown;
  rawManifest?: string | Buffer;
  tag?: string;
  candidateSha?: string;
  decision?: string;
  date?: string;
  ciRunId?: string;
  scale100kRunId?: string;
  mutateEvidence?: (directory: string) => void;
  prepareOutput?: (directory: string) => void;
};

function invoke(fixture: RepositoryFixture, options: InvokeOptions = {}) {
  const invocationRoot = mkdtempSync(join(fixture.root, "invoke-"));
  const evidenceDirectory = join(invocationRoot, "evidence");
  const outputDirectory = join(invocationRoot, "output");
  cpSync(fixture.evidenceDirectory, evidenceDirectory, { recursive: true });
  mkdirSync(outputDirectory);
  options.mutateEvidence?.(evidenceDirectory);
  options.prepareOutput?.(outputDirectory);
  const manifestPath = join(invocationRoot, "manifest.json");
  const manifestBytes =
    options.rawManifest ??
    (options.manifest === undefined ? fixture.manifestBytes : jsonBytes(options.manifest));
  writeFileSync(manifestPath, manifestBytes);
  const result = spawnSync(
    process.execPath,
    [
      join(fixture.repositoryRoot, "scripts", "package-rc-evidence.mjs"),
      "--manifest",
      manifestPath,
      "--evidence-dir",
      evidenceDirectory,
      "--tag",
      options.tag ?? candidateTag,
      "--candidate-sha",
      options.candidateSha ?? fixture.candidateSha,
      "--ci-run-id",
      options.ciRunId ?? "100",
      "--100k-run-id",
      options.scale100kRunId ?? "100",
      "--decision",
      options.decision ?? "CONDITIONAL_GO",
      "--decision-owner",
      "Kernel Audit Owner",
      "--decision-date",
      options.date ?? "2026-07-11",
      "--decision-rationale",
      "All gates passed; immutable publication remains required.",
      "--output-dir",
      outputDirectory,
    ],
    { cwd: fixture.repositoryRoot, encoding: "utf8", windowsHide: true },
  );
  const outputs = new Map<string, Buffer>();
  for (const name of readdirSync(outputDirectory).sort()) {
    outputs.set(name, readFileSync(join(outputDirectory, name)));
  }
  return { ...result, output: `${result.stdout}${result.stderr}`, outputs };
}

function rejected(
  fixture: RepositoryFixture,
  options: InvokeOptions,
  pattern: RegExp,
  expectedExistingOutputs = 0,
): void {
  const result = invoke(fixture, options);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, pattern);
  assert.equal(result.outputs.size, expectedExistingOutputs);
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = value[key];
  if (nested === null || typeof nested !== "object" || Array.isArray(nested)) {
    throw new Error(`Missing object ${key}`);
  }
  return nested as Record<string, unknown>;
}

test("RC package is deterministic and binds the raw reconciled evidence", (context) => {
  const fixture = createFixture(context);
  const first = invoke(fixture);
  const second = invoke(fixture);
  assert.equal(first.status, 0, first.output);
  assert.equal(second.status, 0, second.output);
  assert.deepEqual([...first.outputs.keys()], [...second.outputs.keys()]);
  for (const [name, bytes] of first.outputs) assert.deepEqual(bytes, second.outputs.get(name));

  const manifestName = `release-manifest-${fixture.candidateSha}.json`;
  const reportName = `kernel-v2-go-no-go-${candidateTag}.md`;
  const manifest = first.outputs.get(manifestName);
  const report = first.outputs.get(reportName);
  const sums = first.outputs.get("SHA256SUMS");
  assert.ok(manifest);
  assert.ok(report);
  assert.ok(sums);
  assert.deepEqual(sums.toString("utf8").trim().split(/\r?\n/u), [
    `${sha256(report)}  ${reportName}`,
    `${sha256(manifest)}  ${manifestName}`,
  ]);
  const markdown = report.toString("utf8");
  assert.match(markdown, /sparse-single-source-per-issuer-v1/u);
  assert.match(markdown, /Processing RSS delta/u);
  assert.match(markdown, /Audit-scan RSS delta/u);
  assert.match(markdown, /Packaged pre-publication decision: \*\*CONDITIONAL GO\*\*/u);
  assert.match(markdown, /gh release verify-asset/u);
  assert.match(markdown, /isImmutable: true/u);
  assert.doesNotMatch(markdown, new RegExp(sha256(report), "u"));
  const packageJson = JSON.parse(
    readFileSync(join(fixture.repositoryRoot, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["package:rc-evidence"], "node scripts/package-rc-evidence.mjs");
  const gitignore = readFileSync(join(fixture.repositoryRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^kernel-v2-go-no-go-\*\.md$/mu);
  assert.match(gitignore, /^SHA256SUMS$/mu);
});

test("RC package rejects fabricated manifests and raw-evidence drift", (context) => {
  const fixture = createFixture(context);
  const failed = structuredClone(fixture.manifest);
  failed["reconciliationStatus"] = "failed";
  rejected(fixture, { manifest: failed }, /reconciliationStatus is not passed/u);

  const wrongRuntime = structuredClone(fixture.manifest);
  nestedRecord(wrongRuntime, "runtime")["node"] = "0.0.0";
  rejected(
    fixture,
    { manifest: wrongRuntime },
    /runtime does not match the checked-out candidate/u,
  );

  const fabricated = structuredClone(fixture.manifest);
  const gates = nestedRecord(fabricated, "gates");
  nestedRecord(gates, "check-linux")["command"] = "fabricated but structurally valid";
  rejected(fixture, { manifest: fabricated }, /not byte-identical to raw-evidence reconciliation/u);

  const weakerBudget = structuredClone(fixture.manifest);
  const metrics = nestedRecord(nestedRecord(weakerBudget, "gates"), "scale-10k-linux")[
    "scaleMetrics"
  ];
  assert.ok(Array.isArray(metrics));
  nestedRecord(metrics[0] as Record<string, unknown>, "performanceBudget")[
    "minThroughputPerSecond"
  ] = 1;
  rejected(fixture, { manifest: weakerBudget }, /does not match the checked-out scale policy/u);

  rejected(
    fixture,
    {
      mutateEvidence: (directory) => {
        writeFileSync(join(directory, "check-linux", "audit-test-results.json"), "{}\n");
      },
    },
    /Raw release evidence did not reconcile/u,
  );
  rejected(fixture, { ciRunId: "999" }, /Raw release evidence did not reconcile/u);
});

test("RC package binds clean checkout, tag, metadata, and output safety", (context) => {
  const fixture = createFixture(context);
  rejected(fixture, { tag: otherTag }, /resolves to .* not/u);
  rejected(fixture, { tag: "v0.2.0-missing" }, /does not exist or cannot resolve/u);
  rejected(fixture, { decision: "GO" }, /cannot declare GO/u);
  rejected(fixture, { date: "2026-02-31" }, /real ISO calendar date/u);
  rejected(
    fixture,
    {
      prepareOutput: (directory) => writeFileSync(join(directory, "SHA256SUMS"), "occupied\n"),
    },
    /Checksum file already exists/u,
    1,
  );

  git(
    fixture.repositoryRoot,
    "remote",
    "set-url",
    "origin",
    "https://github.com/HyPolDev/other.git",
  );
  try {
    rejected(fixture, {}, /Origin repository HyPolDev\/other does not match/u);
  } finally {
    git(
      fixture.repositoryRoot,
      "remote",
      "set-url",
      "origin",
      `https://github.com/${repository}.git`,
    );
  }

  writeFileSync(join(fixture.repositoryRoot, "dirty.txt"), "dirty\n");
  try {
    rejected(fixture, {}, /dirty worktree/u);
  } finally {
    rmSync(join(fixture.repositoryRoot, "dirty.txt"));
  }
});
