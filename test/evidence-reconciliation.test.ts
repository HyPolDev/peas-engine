import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  windowsHide: true,
}).trim();
const repository = "HyPolDev/peas-engine";
const script = join(process.cwd(), "scripts", "reconcile-audit-evidence.mjs");

function sha256(bytes: NodeJS.ArrayBufferView | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  packageManager: string;
  engines: { node: string; npm: string };
};
const goldenPath = "fixtures/earnings-cluster.v2.golden.json";
const capturePath = "fixtures/earnings-cluster.v2.captured.ndjson";
const packageLockPath = "package-lock.json";
const scalePolicyPath = "config/scale-policy.v1.json";
const artifactVaultPolicyPath = "config/artifact-vault-deployment-policy.v1.json";
const artifactPlatformCapabilitiesPath = "config/artifact-platform-capabilities.v1.json";
const artifactFaultBoundariesPath = "config/artifact-fault-boundaries.json";
const goldenBytes = readFileSync(goldenPath);
const goldenValue = JSON.parse(goldenBytes.toString("utf8")) as {
  eventHead: string;
  stateHead: string;
  decisionHead: string;
};
const captureBytes = readFileSync(capturePath);
const captureText = captureBytes.toString("utf8").trim();
const scalePolicyBytes = readFileSync(scalePolicyPath);
const artifactVaultPolicyBytes = readFileSync(artifactVaultPolicyPath);
const artifactPlatformCapabilitiesBytes = readFileSync(artifactPlatformCapabilitiesPath);
const artifactFaultBoundariesBytes = readFileSync(artifactFaultBoundariesPath);
const artifactVaultPolicy = JSON.parse(artifactVaultPolicyBytes.toString("utf8")) as {
  policyVersion: 1;
};
const artifactPlatformCapabilities = JSON.parse(
  artifactPlatformCapabilitiesBytes.toString("utf8"),
) as { inventoryVersion: 1; requiredByPlatform: Record<"win32" | "linux", string[]> };
const artifactFaultBoundaries = JSON.parse(artifactFaultBoundariesBytes.toString("utf8")) as {
  schemaVersion: 1;
  boundaries: Array<{ name: string; medium: string }>;
};
const scalePolicy = JSON.parse(scalePolicyBytes.toString("utf8")) as {
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
const expectedRuntime = {
  node: packageJson.engines.node,
  npm: packageJson.engines.npm,
  expectedPackageManager: packageJson.packageManager,
};
const expectedGolden = {
  path: goldenPath,
  fileSha256: sha256(goldenBytes),
  eventHead: goldenValue.eventHead,
  stateHead: goldenValue.stateHead,
  decisionHead: goldenValue.decisionHead,
};
const expectedCapturedStream = {
  path: capturePath,
  fileSha256: sha256(captureBytes),
  eventCount: captureText.length === 0 ? 0 : captureText.split(/\r?\n/u).length,
};
const expectedSourceInputs = {
  packageLockPath,
  packageLockSha256: sha256(readFileSync(packageLockPath)),
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
};

function serializedJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

const passingTestValue = {
  resultVersion: 1,
  status: "passed",
  tests: { tests: 50, failed: 0, passed: 50, skipped: 0 },
  coverage: {
    lines: { percent: 92, threshold: 90 },
    branches: { percent: 82, threshold: 80 },
    functions: { percent: 96, threshold: 95 },
  },
};
const passingMutationValue = { resultVersion: 1, status: "passed", killed: 5, total: 5 };
const passingHardKillValue = {
  resultVersion: 1,
  status: "passed",
  candidateCommitSha: candidateSha,
  childExitMode: "SIGKILL",
  faultBoundaryInventory: {
    path: artifactFaultBoundariesPath,
    sha256: sha256(artifactFaultBoundariesBytes),
  },
  boundaries: artifactFaultBoundaries.boundaries.map(({ name, medium }) => ({
    name,
    medium,
    restartCount: 2,
    converged: true,
  })),
};

function passingPlatformValue(gateName: string) {
  const platform = gateName === "check-windows" ? "win32" : "linux";
  const requiredCapabilities = artifactPlatformCapabilities.requiredByPlatform[platform];
  return {
    schemaVersion: 2,
    candidateCommitSha: candidateSha,
    worktreeClean: true,
    platform,
    arch: "x64",
    mode: "ci-temporary",
    policy: { path: artifactVaultPolicyPath, fileSha256: sha256(artifactVaultPolicyBytes) },
    capabilityInventory: {
      path: artifactPlatformCapabilitiesPath,
      fileSha256: sha256(artifactPlatformCapabilitiesBytes),
    },
    faultBoundaryInventory: {
      path: artifactFaultBoundariesPath,
      fileSha256: sha256(artifactFaultBoundariesBytes),
    },
    hardKill: {
      path: "audit-hard-kill-results.json",
      fileSha256: sha256(serializedJson(passingHardKillValue)),
    },
    configuredRuntimeRoot: null,
    requiredCapabilities,
    demonstratedCapabilities: requiredCapabilities,
    unsupportedRequiredCapabilities: [],
    completeForGo: true,
  };
}

function passingCheckResults(gateName: string) {
  const platformValue = passingPlatformValue(gateName);
  return {
    tests: {
      path: "audit-test-results.json",
      fileSha256: sha256(serializedJson(passingTestValue)),
      value: passingTestValue,
    },
    mutations: {
      path: "audit-mutation-results.json",
      fileSha256: sha256(serializedJson(passingMutationValue)),
      value: passingMutationValue,
    },
    hardKill: {
      path: "audit-hard-kill-results.json",
      fileSha256: sha256(serializedJson(passingHardKillValue)),
      value: passingHardKillValue,
    },
    platform: {
      path: `vault-platform-evidence-${gateName}.json`,
      fileSha256: sha256(serializedJson(platformValue)),
      value: platformValue,
    },
  };
}

function scaleMetric(clusterCount: number) {
  const budget = present(scalePolicy.budgets[String(clusterCount)], `budget ${clusterCount}`);
  const value = {
    metricsVersion: scalePolicy.metricsVersion,
    measurementModel: scalePolicy.measurementModel,
    scalePolicy: {
      policyVersion: scalePolicy.policyVersion,
      path: scalePolicyPath,
      fileSha256: sha256(scalePolicyBytes),
    },
    workload: {
      name: scalePolicy.workload.name,
      eventCount: clusterCount,
      issuerCount: clusterCount,
      sourcesPerIssuer: scalePolicy.workload.sourcesPerIssuer,
      writerCount: scalePolicy.workload.writerCount,
    },
    candidateCommitSha: candidateSha,
    clusterCount,
    gateStatus: "passed",
    integrityCheck: "ok",
    worktreeClean: true,
    performanceBudget: budget,
  };
  return {
    ...value,
    path: `scale-metrics-${clusterCount}.json`,
    fileSha256: sha256(serializedJson(value)),
  };
}

type ReleaseTrigger = "label" | "dispatch" | "schedule";

function evidence(
  gateName: string,
  options: {
    runId: string;
    runnerOs: "Linux" | "Windows";
    releaseTrigger?: ReleaseTrigger;
  },
) {
  const clusterCount = gateName === "scale-10k-linux" ? 10_000 : 100_000;
  const isScale = gateName.startsWith("scale-");
  const is100k = gateName === "scale-100k-linux";
  const releaseTrigger = is100k ? (options.releaseTrigger ?? "label") : null;
  const isNightly = releaseTrigger === "dispatch" || releaseTrigger === "schedule";
  const eventName =
    releaseTrigger === "dispatch"
      ? "workflow_dispatch"
      : releaseTrigger === "schedule"
        ? "schedule"
        : "pull_request";
  const workflow = isNightly ? "Nightly audit" : "CI";
  const workflowPath = isNightly ? "nightly-audit.yml" : "ci.yml";
  const job = gateName.startsWith("check-")
    ? "check"
    : gateName === "scale-10k-linux"
      ? "scale-10k"
      : "scale-100k";
  const trigger =
    releaseTrigger === "label"
      ? { kind: "pull_request_label", value: "audit-100k", actor: "audit-user" }
      : releaseTrigger === "dispatch"
        ? { kind: "workflow_dispatch", value: candidateSha, actor: "audit-user" }
        : releaseTrigger === "schedule"
          ? { kind: "schedule", value: "0 2 * * *", actor: "github-actions" }
          : null;
  return {
    evidenceVersion: 2,
    candidateCommitSha: candidateSha,
    worktreeClean: true,
    gate: {
      name: gateName,
      command: "synthetic audit regression",
      status: "passed",
      trigger,
    },
    githubRun: {
      eventName,
      eventSha: candidateSha,
      workflow,
      workflowRef: `${repository}/.github/workflows/${workflowPath}@refs/heads/candidate`,
      workflowSha: candidateSha,
      runId: options.runId,
      runAttempt: "1",
      job,
      repository,
      runUrl: `https://github.com/${repository}/actions/runs/${options.runId}`,
    },
    runner: {
      os: options.runnerOs,
      arch: "X64",
      environment: "github-hosted",
      imageOs: options.runnerOs === "Windows" ? "win25" : "ubuntu24",
      imageVersion: "synthetic",
    },
    runtime: { ...expectedRuntime },
    golden: { ...expectedGolden },
    capturedStream: { ...expectedCapturedStream },
    sourceInputs: { ...expectedSourceInputs },
    checkResults: gateName.startsWith("check-") || is100k ? passingCheckResults(gateName) : null,
    scaleMetrics: isScale ? [scaleMetric(clusterCount)] : [],
  };
}

type EvidenceRecord = ReturnType<typeof evidence>;

function itemAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing test fixture at index ${index}`);
  return value;
}

function present<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing test fixture ${label}`);
  return value;
}

function records(releaseTrigger: ReleaseTrigger = "label"): EvidenceRecord[] {
  const runId = releaseTrigger === "label" ? "100" : "200";
  return [
    evidence("check-linux", { runId: "100", runnerOs: "Linux" }),
    evidence("check-windows", { runId: "100", runnerOs: "Windows" }),
    evidence("scale-10k-linux", { runId: "100", runnerOs: "Linux" }),
    evidence("scale-100k-linux", {
      runId,
      runnerOs: "Linux",
      releaseTrigger,
    }),
  ];
}

type ReconciliationOptions = {
  expectedSha?: string;
  expectedRepository?: string;
  expectedCiRunId?: string;
  expected100kRunId?: string;
  rawOverrides?: Readonly<Record<string, string | null>>;
  prepare?: (directory: string) => void;
};

function inferred100kRunId(inputs: readonly unknown[]): string {
  for (const input of inputs) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) continue;
    const candidate = input as { gate?: { name?: unknown }; githubRun?: { runId?: unknown } };
    if (
      candidate.gate?.name === "scale-100k-linux" &&
      typeof candidate.githubRun?.runId === "string"
    ) {
      return candidate.githubRun.runId;
    }
  }
  return "100";
}

function canonicalRawFiles(): Map<string, string> {
  const files = new Map<string, string>([
    ["audit-test-results.json", serializedJson(passingTestValue)],
    ["audit-mutation-results.json", serializedJson(passingMutationValue)],
    ["audit-hard-kill-results.json", serializedJson(passingHardKillValue)],
  ]);
  for (const gateName of ["check-linux", "check-windows", "scale-100k-linux"]) {
    files.set(
      `vault-platform-evidence-${gateName}.json`,
      serializedJson(passingPlatformValue(gateName)),
    );
  }
  for (const count of [10_000, 100_000]) {
    const metric = scaleMetric(count);
    const { path, fileSha256: _digest, ...value } = metric;
    files.set(path, serializedJson(value));
  }
  return files;
}

function runReconciliation(inputs: readonly unknown[], options: ReconciliationOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "peas-evidence-reconcile-"));
  try {
    for (const [index, input] of inputs.entries()) {
      const serialized = typeof input === "string" ? input : `${JSON.stringify(input)}\n`;
      writeFileSync(join(directory, `audit-evidence-input-${index}.json`), serialized);
    }
    for (const [path, defaultBytes] of canonicalRawFiles()) {
      const hasOverride =
        options.rawOverrides !== undefined && Object.hasOwn(options.rawOverrides, path);
      const override = options.rawOverrides?.[path];
      const bytes = hasOverride ? (override ?? null) : defaultBytes;
      if (bytes !== null) writeFileSync(join(directory, path), bytes);
    }
    options.prepare?.(directory);
    const manifestPath = join(directory, "release-manifest.json");
    const result = spawnSync(process.execPath, [script, directory], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PEAS_CANDIDATE_SHA: options.expectedSha ?? candidateSha,
        PEAS_RELEASE_MANIFEST_PATH: manifestPath,
        PEAS_EXPECTED_REPOSITORY: options.expectedRepository ?? repository,
        PEAS_EXPECTED_CI_RUN_ID: options.expectedCiRunId ?? "100",
        PEAS_EXPECTED_100K_RUN_ID: options.expected100kRunId ?? inferred100kRunId(inputs),
      },
    });
    return {
      ...result,
      output: `${result.stdout}${result.stderr}`,
      manifest: existsSync(manifestPath)
        ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
            manifestVersion: number;
            candidateCommitSha: string;
            reconciliationStatus: string;
            repository: string;
            gates: Record<string, { trigger: { kind: string } | null }>;
          })
        : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function rejected(
  inputs: readonly unknown[],
  pattern: RegExp,
  options: ReconciliationOptions = {},
): void {
  const result = runReconciliation(inputs, options);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, pattern);
  assert.equal(result.manifest, null);
}

function changed(mutator: (values: EvidenceRecord[]) => void): EvidenceRecord[] {
  const values = structuredClone(records());
  mutator(values);
  return values;
}

test("nightly audit records dispatch and schedule provenance from the actual event", () => {
  const workflow = readFileSync(".github/workflows/nightly-audit.yml", "utf8");
  assert.match(workflow, /PEAS_TRIGGER_KIND: \$\{\{ github\.event_name \}\}/u);
  assert.match(
    workflow,
    /PEAS_TRIGGER_VALUE: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.candidate_sha \|\| github\.event\.schedule \}\}/u,
  );
  assert.doesNotMatch(workflow, /PEAS_TRIGGER_KIND: workflow_dispatch/u);
});

test("release reconciliation accepts label and dispatch evidence bound to the candidate", () => {
  for (const trigger of ["label", "dispatch"] as const) {
    const result = runReconciliation(records(trigger));
    assert.equal(result.status, 0, result.output);
    assert.equal(result.manifest?.candidateCommitSha, candidateSha);
    assert.equal(result.manifest?.manifestVersion, 3);
    assert.equal(result.manifest?.repository, repository);
    assert.equal(result.manifest?.reconciliationStatus, "passed");
    assert.deepEqual(Object.keys(result.manifest?.gates ?? {}).sort(), [
      "check-linux",
      "check-windows",
      "scale-100k-linux",
      "scale-10k-linux",
    ]);
    assert.equal(
      result.manifest?.gates["scale-100k-linux"]?.trigger?.kind,
      trigger === "label" ? "pull_request_label" : "workflow_dispatch",
    );
  }
});

test("release reconciliation rejects the wrong candidate SHA", () => {
  rejected(
    changed((values) => {
      itemAt(values, 0).candidateCommitSha = "0".repeat(40);
    }),
    /belongs to .* not/u,
  );
  rejected(records(), /is not checked out at/u, { expectedSha: "0".repeat(40) });
});

test("release reconciliation binds runtime and source identities to the checkout", async (context) => {
  const cases: Array<{
    name: string;
    mutate: (record: EvidenceRecord) => void;
    pattern: RegExp;
  }> = [
    {
      name: "runtime",
      mutate: (record) => {
        record.runtime.node = "0.0.0";
      },
      pattern: /runtime does not match the checked-out candidate/u,
    },
    {
      name: "package-lock path",
      mutate: (record) => {
        record.sourceInputs.packageLockPath = "other-lock.json";
      },
      pattern: /locked source inputs does not match/u,
    },
    {
      name: "package-lock digest",
      mutate: (record) => {
        record.sourceInputs.packageLockSha256 = "6".repeat(64);
      },
      pattern: /locked source inputs does not match/u,
    },
    {
      name: "scale-policy digest",
      mutate: (record) => {
        record.sourceInputs.scalePolicySha256 = "6".repeat(64);
      },
      pattern: /locked source inputs does not match/u,
    },
    {
      name: "capture path",
      mutate: (record) => {
        record.capturedStream.path = "fixtures/other.ndjson";
      },
      pattern: /captured-stream evidence does not match/u,
    },
    {
      name: "capture digest",
      mutate: (record) => {
        record.capturedStream.fileSha256 = "7".repeat(64);
      },
      pattern: /captured-stream evidence does not match/u,
    },
    {
      name: "capture event count",
      mutate: (record) => {
        record.capturedStream.eventCount += 1;
      },
      pattern: /captured-stream evidence does not match/u,
    },
    {
      name: "golden path",
      mutate: (record) => {
        record.golden.path = "fixtures/other.golden.json";
      },
      pattern: /golden evidence does not match/u,
    },
    {
      name: "golden digest",
      mutate: (record) => {
        record.golden.fileSha256 = "8".repeat(64);
      },
      pattern: /golden evidence does not match/u,
    },
    ...(["eventHead", "stateHead", "decisionHead"] as const).map((field) => ({
      name: `golden ${field}`,
      mutate: (record: EvidenceRecord) => {
        record.golden[field] = "9".repeat(64);
      },
      pattern: /golden evidence does not match/u,
    })),
  ];

  for (const testCase of cases) {
    await context.test(testCase.name, () => {
      const values = changed((candidateRecords) => {
        for (const record of candidateRecords) testCase.mutate(record);
      });
      rejected(values, testCase.pattern);
    });
  }
});

test("release reconciliation rejects wrong runner identity", () => {
  rejected(
    changed((values) => {
      itemAt(values, 0).runner.os = "Windows";
    }),
    /check-linux ran on Windows, not Linux/u,
  );
  rejected(
    changed((values) => {
      itemAt(values, 0).runner.environment = "self-hosted";
    }),
    /required GitHub-hosted X64 runner/u,
  );
  rejected(
    changed((values) => {
      itemAt(values, 0).runner.imageVersion = "unknown";
    }),
    /lacks hosted-runner image identity/u,
  );
});

test("release reconciliation requires a genuine manual 100k trigger", () => {
  rejected(
    changed((values) => {
      itemAt(values, 3).gate.trigger = {
        kind: "pull_request_label",
        value: "not-audit-100k",
        actor: "audit-user",
      };
    }),
    /manually triggered by audit-100k/u,
  );

  const dispatched = structuredClone(records("dispatch"));
  itemAt(dispatched, 3).gate.trigger = {
    kind: "workflow_dispatch",
    value: "0".repeat(40),
    actor: "audit-user",
  };
  rejected(dispatched, /workflow-dispatch identity does not match/u);

  for (const field of ["eventSha", "workflowSha"] as const) {
    const wrongDispatchSha = structuredClone(records("dispatch"));
    itemAt(wrongDispatchSha, 3).githubRun[field] = "a".repeat(40);
    rejected(wrongDispatchSha, /manual 100k run ref and workflow definition must match/u);
  }

  rejected(records("schedule"), /regression-only and cannot satisfy a release gate/u);
  const falseScheduledProvenance = structuredClone(records("schedule"));
  itemAt(falseScheduledProvenance, 3).gate.trigger = {
    kind: "workflow_dispatch",
    value: candidateSha,
    actor: "github-actions",
  };
  rejected(falseScheduledProvenance, /does not record its schedule provenance/u);
});

test("release reconciliation requires exactly one of every gate", () => {
  rejected(records().slice(0, 3), /Missing required evidence for scale-100k-linux/u);
  const duplicate = records();
  duplicate.push(structuredClone(itemAt(duplicate, 0)));
  rejected(duplicate, /Duplicate evidence for check-linux/u);
  rejected(
    changed((values) => {
      itemAt(values, 0).gate.name = "unexpected";
    }),
    /unexpected gate unexpected/u,
  );
});

test("release reconciliation rejects failed gates, checks, and integrity", () => {
  rejected(
    changed((values) => {
      itemAt(values, 0).gate.status = "failed";
    }),
    /is not passing evidence/u,
  );
  rejected(
    changed((values) => {
      present(itemAt(values, 0).checkResults, "check results").tests.value.tests.failed = 1;
    }),
    /lacks passing test and coverage results/u,
  );
  rejected(
    changed((values) => {
      itemAt(itemAt(values, 2).scaleMetrics, 0).integrityCheck = "corrupt";
    }),
    /non-passing or malformed scale evidence/u,
  );
  rejected(
    changed((values) => {
      itemAt(itemAt(values, 3).scaleMetrics, 0).gateStatus = "failed";
    }),
    /non-passing or malformed scale evidence/u,
  );
});

test("release reconciliation rejects malformed evidence", () => {
  rejected(["{"], /SyntaxError|JSON/u);
  rejected([{}], /candidateCommitSha/u);
  rejected(
    changed((values) => {
      itemAt(values, 0).evidenceVersion = 99;
    }),
    /unsupported evidence version/u,
  );
  const noRemoteRun = changed((values) => {
    (values[0] as { githubRun: unknown }).githubRun = null;
  });
  rejected(noRemoteRun, /githubRun must be a JSON object/u);
});

test("release reconciliation binds the complete CI and label-run identity", async (context) => {
  const cases: Array<{
    name: string;
    mutate: (record: EvidenceRecord) => void;
    pattern: RegExp;
  }> = [
    {
      name: "run ID",
      mutate: (record) => {
        record.githubRun.runId = "101";
        record.githubRun.runUrl = `https://github.com/${repository}/actions/runs/101`;
      },
      pattern: /not trusted run 100/u,
    },
    {
      name: "run attempt",
      mutate: (record) => {
        record.githubRun.runAttempt = "2";
      },
      pattern: /share one complete CI run identity/u,
    },
    {
      name: "event SHA",
      mutate: (record) => {
        record.githubRun.eventSha = "a".repeat(40);
      },
      pattern: /share one complete CI run identity/u,
    },
    {
      name: "workflow SHA",
      mutate: (record) => {
        record.githubRun.workflowSha = "b".repeat(40);
      },
      pattern: /share one complete CI run identity/u,
    },
    {
      name: "workflow ref",
      mutate: (record) => {
        record.githubRun.workflowRef = `${repository}/.github/workflows/ci.yml@refs/heads/other`;
      },
      pattern: /share one complete CI run identity/u,
    },
  ];

  for (const testCase of cases) {
    await context.test(testCase.name, () => {
      rejected(
        changed((values) => {
          testCase.mutate(itemAt(values, 1));
        }),
        testCase.pattern,
      );
    });
  }

  rejected(
    changed((values) => {
      const scale100k = itemAt(values, 3);
      scale100k.githubRun.runId = "101";
      scale100k.githubRun.runUrl = `https://github.com/${repository}/actions/runs/101`;
    }),
    /label-triggered 100k gate must share the complete reconciled CI run identity/u,
  );

  const differentRepository = structuredClone(records("dispatch"));
  const scale100k = itemAt(differentRepository, 3);
  scale100k.githubRun.repository = "HyPolDev/other";
  scale100k.githubRun.workflowRef =
    "HyPolDev/other/.github/workflows/nightly-audit.yml@refs/heads/candidate";
  scale100k.githubRun.runUrl = "https://github.com/HyPolDev/other/actions/runs/200";
  rejected(differentRepository, /belongs to repository HyPolDev\/other/u);
});

test("release reconciliation binds repository and run IDs to trusted orchestration", () => {
  rejected(records(), /Missing required PEAS_EXPECTED_REPOSITORY/u, { expectedRepository: "" });
  rejected(records(), /Origin repository .* does not match HyPolDev\/other/u, {
    expectedRepository: "HyPolDev/other",
  });
  rejected(records(), /not trusted run 999/u, { expectedCiRunId: "999" });
  rejected(records(), /not trusted run 999/u, { expected100kRunId: "999" });
  rejected(
    changed((values) => {
      itemAt(values, 0).githubRun.runUrl = "https://github.com/HyPolDev/other/actions/runs/100";
    }),
    /run URL does not match trusted repository and run identity/u,
  );
});

test("release reconciliation recomputes every embedded evidence-file hash and value", () => {
  rejected(records(), /checkResults\.tests digest .* does not match sibling bytes/u, {
    rawOverrides: { "audit-test-results.json": "{}\n" },
  });
  rejected(
    changed((values) => {
      const tests = present(itemAt(values, 0).checkResults, "check results").tests.value;
      (tests as Record<string, unknown>)["unexpected"] = true;
    }),
    /checkResults\.tests embedded value does not match its sibling file/u,
  );
  rejected(records(), /scaleMetrics\[10000\] digest .* does not match sibling bytes/u, {
    rawOverrides: { "scale-metrics-10000.json": "{}\n" },
  });
  rejected(
    changed((values) => {
      itemAt(itemAt(values, 2).scaleMetrics, 0).path = "../scale-metrics-10000.json";
    }),
    /path must be a sibling basename without traversal/u,
  );
  rejected(records(), /checkResults\.mutations sibling file is missing/u, {
    rawOverrides: { "audit-mutation-results.json": null },
  });
});

test("release reconciliation binds scale metrics to the committed policy", () => {
  rejected(
    changed((values) => {
      const metric = itemAt(itemAt(values, 2).scaleMetrics, 0);
      (metric.workload as { sourcesPerIssuer: number }).sourcesPerIssuer = 2;
    }),
    /does not identify the policy's sparse durability workload/u,
  );
  rejected(
    changed((values) => {
      const metric = itemAt(itemAt(values, 2).scaleMetrics, 0);
      metric.performanceBudget["minThroughputPerSecond"] = 1;
    }),
    /does not match the checked-out scale policy/u,
  );
});

test("release reconciliation refuses symlinked raw evidence", (context) => {
  try {
    rejected(records(), /Refusing symlinked evidence input/u, {
      prepare: (directory) => {
        const rawPath = join(directory, "audit-test-results.json");
        const targetPath = join(directory, "real-audit-test-results.json");
        writeFileSync(targetPath, serializedJson(passingTestValue));
        rmSync(rawPath);
        symlinkSync(targetPath, rawPath, "file");
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      context.skip(`symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
});

test("release reconciliation requires unique location-independent evidence basenames", () => {
  rejected(records(), /Duplicate logical evidence basename audit-evidence-input-0\.json/u, {
    prepare: (directory) => {
      const nested = join(directory, "duplicate-artifact");
      mkdirSync(nested);
      copyFileSync(
        join(directory, "audit-evidence-input-0.json"),
        join(nested, "audit-evidence-input-0.json"),
      );
    },
  });
});
