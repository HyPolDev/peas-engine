import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const probe = "test/fixtures/local-validation-probe.mjs";
const preload = resolve("scripts/local-validation/network-deny.cjs");

function runProbe(
  args: readonly string[],
  options: { preload?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  return spawnSync(
    process.execPath,
    [...(options.preload === true ? ["--require", preload] : []), probe, ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PEAS_LOCAL_VALIDATION_CHECKOUT_ATTESTATION: checkoutAttestationJson,
        ...options.env,
      },
    },
  );
}

function sha256(bytes: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalBytes(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function runNodeTestSummaryParser(
  transcript: string,
  expectedDisposition = "executable-assertions-passed",
) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { parseNodeTestSummary } from './scripts/local-validation/runtime.mjs';
       let transcript = '';
       for await (const chunk of process.stdin) transcript += chunk;
       try {
         process.stdout.write(JSON.stringify(parseNodeTestSummary(transcript, process.argv[1])));
       } catch (error) {
         process.stderr.write(error instanceof Error ? error.message : String(error));
         process.exitCode = 1;
       }`,
      expectedDisposition,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      input: transcript,
    },
  );
}

function runCaseDispositionResolver(caseEntry: unknown, runtimePlatform: string) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { resolveCaseDisposition } from './scripts/local-validation/runtime.mjs';
       let input = '';
       for await (const chunk of process.stdin) input += chunk;
       try {
         process.stdout.write(resolveCaseDisposition(JSON.parse(input), process.argv[1]));
       } catch (error) {
         process.stderr.write(error instanceof Error ? error.message : String(error));
         process.exitCode = 1;
       }`,
      runtimePlatform,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      input: JSON.stringify(caseEntry),
    },
  );
}

function nodeTestSummary(values: {
  tests: number;
  pass: number;
  fail?: number;
  cancelled?: number;
  skipped?: number;
  todo?: number;
}): string {
  return [
    `ℹ tests ${values.tests}`,
    "ℹ suites 0",
    `ℹ pass ${values.pass}`,
    `ℹ fail ${values.fail ?? 0}`,
    `ℹ cancelled ${values.cancelled ?? 0}`,
    `ℹ skipped ${values.skipped ?? 0}`,
    `ℹ todo ${values.todo ?? 0}`,
    "ℹ duration_ms 1",
    "",
  ].join("\n");
}

const checkoutIdentity = {
  sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(),
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  status: "",
};
const checkoutAttestation = {
  schemaVersion: 1,
  kind: "peas-local-validation-verified-checkout",
  ...checkoutIdentity,
  origin: execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
};
const checkoutAttestationJson = canonicalBytes(checkoutAttestation).trimEnd();

test("the frozen local-validation manifest compiles deterministically with 200+ unique cases", () => {
  const first = runProbe(["manifest"]);
  const second = runProbe(["manifest"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  const result = JSON.parse(first.stdout) as { count: number; digest: string };
  assert.equal(result.count, 227);
  assert.match(result.digest, /^[0-9a-f]{64}$/u);
  const manifest = JSON.parse(readFileSync("config/local-validation/manifest.v1.json", "utf8")) as {
    cases: Array<{
      id: string;
      expectedTerminalDisposition: string;
      applicablePlatforms?: string[];
      executable: { testName: string };
      fixture: { sha256: string };
    }>;
    durableCheckpointPrefixes: string[];
    hardKillPoints: string[];
    restartBindings: Array<{ prefixes: string[] }>;
    hardKillBindings: Array<{ points: string[] }>;
    permutationBindings: Array<{ vectors: Record<string, unknown> }>;
  };
  assert.equal(new Set(manifest.cases.map(({ id }) => id)).size, 227);
  assert.ok(manifest.cases.every(({ fixture }) => /^[0-9a-f]{64}$/u.test(fixture.sha256)));
  const platformConditional = manifest.cases.filter(
    ({ expectedTerminalDisposition }) => expectedTerminalDisposition === "platform-conditional",
  );
  assert.deepEqual(
    platformConditional.map(({ applicablePlatforms, executable }) => ({
      applicablePlatforms,
      testName: executable.testName,
    })),
    [
      {
        applicablePlatforms: ["linux"],
        testName: "Linux file symlinks cannot replace committed content",
      },
    ],
  );
  assert.ok(
    manifest.cases.every(
      ({ expectedTerminalDisposition }) =>
        expectedTerminalDisposition === "executable-assertions-passed" ||
        expectedTerminalDisposition === "platform-conditional",
    ),
  );
  assert.equal(manifest.durableCheckpointPrefixes.length, 22);
  assert.equal(manifest.hardKillPoints.length, 52);
  assert.deepEqual(
    [...new Set(manifest.restartBindings.flatMap(({ prefixes }) => prefixes))].sort(),
    [...manifest.durableCheckpointPrefixes].sort(),
  );
  assert.deepEqual(
    [...new Set(manifest.hardKillBindings.flatMap(({ points }) => points))].sort(),
    [...manifest.hardKillPoints].sort(),
  );
  assert.ok(manifest.permutationBindings.length >= 4);
});

test("gate locking rejects overlap and recovers only a dead expired owner", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-lock-"));
  try {
    const path = join(directory, "gate.lock");
    const overlap = runProbe(["lock-overlap", path]);
    assert.notEqual(overlap.status, 0);
    assert.match(overlap.stderr, /local-validation-gate-overlap/u);
    assert.equal(existsSync(path), true);
    const crashed = runProbe(["lock-crash", path]);
    assert.equal(crashed.status, 0, crashed.stderr);
    const stale = runProbe(["lock-stale", path]);
    assert.equal(stale.status, 0, stale.stderr);
    assert.equal(stale.stdout.trim(), "recovered");
    assert.equal(existsSync(path), true);
    mkdirSync(`${path}.recovery`);
    const legacyRecoveryArtifact = runProbe(["lock-recover-once", path]);
    assert.equal(legacyRecoveryArtifact.status, 0, legacyRecoveryArtifact.stderr);
    assert.equal(legacyRecoveryArtifact.stdout.trim(), "recovered-on-retry");
    const releaseContention = runProbe(["lock-release-contention", path]);
    assert.equal(releaseContention.status, 0, releaseContention.stderr);
    assert.equal(releaseContention.stdout.trim(), "release-contention-settled");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent stale-lock recovery serializes and remains crash-recoverable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-lock-race-"));
  const lockPath = join(directory, "gate.lock");
  try {
    const crashed = runProbe(["lock-crash", lockPath]);
    assert.equal(crashed.status, 0, crashed.stderr);
    const run = () =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise) => {
        const child = spawn(process.execPath, [probe, "lock-recover-hold", lockPath], {
          cwd: process.cwd(),
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.setEncoding("utf8").on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("exit", (code) => resolvePromise({ code, stdout, stderr }));
      });
    const outcomes = await Promise.all([run(), run()]);
    const successCount = outcomes.filter(({ code }) => code === 0).length;
    assert.ok(successCount <= 1, JSON.stringify(outcomes));
    assert.ok(
      outcomes
        .filter(({ code }) => code !== 0)
        .every(({ stderr }) =>
          /local-validation-gate-(?:overlap|recovery-overlap|lock-changed-during-recovery)/u.test(
            stderr,
          ),
        ),
      JSON.stringify(outcomes),
    );
    const retry = runProbe(["lock-recover-once", lockPath]);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(retry.stdout.trim(), "recovered-on-retry");
    const crashedAgain = runProbe(["lock-crash", lockPath]);
    assert.equal(crashedAgain.status, 0, crashedAgain.stderr);
    const recoveryCrash = runProbe(["lock-recovery-crash", lockPath]);
    assert.equal(recoveryCrash.status, 0, recoveryCrash.stderr);
    assert.equal(recoveryCrash.stdout.trim(), "recovery-crash-recovered");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("candidate verification rejects a wrong SHA and dirty evidence source", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-candidate-"));
  try {
    execFileSync("git", ["init"], { cwd: directory, windowsHide: true });
    execFileSync("git", ["config", "user.email", "local@example.invalid"], {
      cwd: directory,
      windowsHide: true,
    });
    execFileSync("git", ["config", "user.name", "Local Validation"], {
      cwd: directory,
      windowsHide: true,
    });
    writeFileSync(join(directory, "tracked.txt"), "clean\n", "utf8");
    execFileSync("git", ["add", "tracked.txt"], { cwd: directory, windowsHide: true });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: directory, windowsHide: true });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    const wrong = spawnSync(process.execPath, [probe, "candidate", directory], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PEAS_LOCAL_VALIDATION_CANDIDATE_SHA: "0".repeat(40),
        PEAS_LOCAL_VALIDATION_CANDIDATE_TREE: tree,
      },
    });
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /candidate-sha-mismatch/u);
    writeFileSync(join(directory, "tracked.txt"), "dirty\n", "utf8");
    const dirty = spawnSync(process.execPath, [probe, "candidate", directory], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PEAS_LOCAL_VALIDATION_CANDIDATE_SHA: sha,
        PEAS_LOCAL_VALIDATION_CANDIDATE_TREE: tree,
      },
    });
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /candidate-worktree-dirty/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("network denial is mandatory and blocks outbound APIs before cases", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-network-"));
  try {
    const denied = spawnSync(
      process.execPath,
      ["--require", preload, "-e", "require('node:http2').connect('https://example.invalid')"],
      { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
    );
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /peas-outbound-network-denied/u);
    const escaped = spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        "-e",
        "require('node:child_process').spawn('curl',['https://example.invalid'])",
      ],
      { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
    );
    assert.notEqual(escaped.status, 0);
    assert.match(escaped.stderr, /peas-outbound-network-denied/u);
    const forbiddenExecutables = [
      ["git", ["--version"]],
      ["curl", ["--version"]],
      ...(process.platform === "win32"
        ? [
            ["fsutil", ["/?"]],
            ["cmd", ["/c", "exit", "0"]],
            ["powershell", ["-NoProfile", "-Command", "exit 0"]],
          ]
        : [["sh", ["-c", "true"]]]),
    ] as Array<[string, string[]]>;
    for (const [command, args] of forbiddenExecutables) {
      const blocked = spawnSync(
        process.execPath,
        [
          "--require",
          preload,
          "-e",
          `require('node:child_process').execFileSync(${JSON.stringify(command)},${JSON.stringify(args)})`,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, PEAS_NETWORK_DENIAL_INHERITED: "1" },
        },
      );
      assert.notEqual(blocked.status, 0, command);
      assert.match(blocked.stderr, /peas-outbound-network-denied/u, command);
    }
    const surfaces = spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        "-e",
        "console.log(JSON.stringify(globalThis.__PEAS_NETWORK_DENIAL__.deniedSurfaces))",
      ],
      { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
    );
    assert.equal(surfaces.status, 0, surfaces.stderr);
    const deniedSurfaces = JSON.parse(surfaces.stdout) as string[];
    for (const required of [
      "net.Socket.connect",
      "tls.connect",
      "http.request",
      "https.request",
      "http2.connect",
      "dgram.createSocket",
      "dns.lookup",
      "dns.promises.resolve",
      "fetch",
      "WebSocket",
      "child_process.exec",
      "child_process.execSync",
    ])
      assert.ok(deniedSurfaces.includes(required), required);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("checkout attestation is strict, case-bound, and immune to inherited spoofing", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-attestation-"));
  try {
    const workerInputPath = join(directory, "worker-input.json");
    const runWorker = (input: unknown) => {
      writeFileSync(workerInputPath, canonicalBytes(input), "utf8");
      return spawnSync(
        process.execPath,
        ["--require", preload, "scripts/local-validation/worker.mjs"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          windowsHide: true,
          env: {
            ...process.env,
            PEAS_LOCAL_VALIDATION_WORKER_INPUT: workerInputPath,
            PEAS_NETWORK_DENIAL_INHERITED: "1",
          },
        },
      );
    };
    const missing = runWorker({ identity: checkoutIdentity });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /local-validation-checkout-attestation-required/u);
    const malformed = runWorker({
      identity: checkoutIdentity,
      candidateAttestation: "not-an-attestation",
    });
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /local-validation-checkout-attestation-invalid/u);
    const mismatch = runWorker({
      identity: checkoutIdentity,
      candidateAttestation: { ...checkoutAttestation, sha: "0".repeat(40) },
    });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /local-validation-checkout-attestation-mismatch/u);

    const caseId = "lv-v1-052-753e5bc5e9c9cd20";
    const validAndSpoofed = spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        "--input-type=module",
        "-e",
        `import { attestedCaseEnvironment } from './scripts/local-validation/runtime.mjs';
         const attestation = ${JSON.stringify(checkoutAttestation)};
         const environment = attestedCaseEnvironment({
           PEAS_LOCAL_VALIDATION_CHECKOUT_ATTESTATION: 'spoofed',
           PEAS_LOCAL_VALIDATION_ATTESTED_CASE_ID: 'spoofed',
           PEAS_LOCAL_VALIDATION_CASE_ID: 'spoofed'
         }, attestation, ${JSON.stringify(caseId)});
         process.stdout.write(JSON.stringify(environment));`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, PEAS_NETWORK_DENIAL_INHERITED: "1" },
      },
    );
    assert.equal(validAndSpoofed.status, 0, validAndSpoofed.stderr);
    const environment = JSON.parse(validAndSpoofed.stdout) as Record<string, string>;
    const attested = JSON.parse(
      environment["PEAS_LOCAL_VALIDATION_CHECKOUT_ATTESTATION"] ?? "null",
    ) as Record<string, unknown>;
    assert.deepEqual(attested, { ...checkoutAttestation, caseId });
    assert.equal(environment["PEAS_LOCAL_VALIDATION_ATTESTED_CASE_ID"], caseId);
    assert.equal(environment["PEAS_LOCAL_VALIDATION_CASE_ID"], caseId);

    const runDeniedEvidenceCase = (
      attestationValue: string | undefined,
      attestedCaseId: string | undefined,
    ) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PEAS_NETWORK_DENIAL_INHERITED: "1",
      };
      delete env["PEAS_LOCAL_VALIDATION_CHECKOUT_ATTESTATION"];
      delete env["PEAS_LOCAL_VALIDATION_ATTESTED_CASE_ID"];
      delete env["PEAS_LOCAL_VALIDATION_CASE_ID"];
      delete env["NODE_TEST_CONTEXT"];
      if (attestationValue !== undefined) {
        env["PEAS_LOCAL_VALIDATION_CHECKOUT_ATTESTATION"] = attestationValue;
      }
      if (attestedCaseId !== undefined) {
        env["PEAS_LOCAL_VALIDATION_ATTESTED_CASE_ID"] = attestedCaseId;
        env["PEAS_LOCAL_VALIDATION_CASE_ID"] = attestedCaseId;
      }
      return spawnSync(
        process.execPath,
        [
          "--require",
          preload,
          "--test",
          "--test-name-pattern=^release reconciliation accepts label and dispatch evidence bound to the candidate$",
          "dist/test/evidence-reconciliation.test.js",
        ],
        { cwd: process.cwd(), encoding: "utf8", windowsHide: true, env },
      );
    };
    const missingDeniedCase = runDeniedEvidenceCase(undefined, undefined);
    assert.notEqual(
      missingDeniedCase.status,
      0,
      `${missingDeniedCase.stdout}${missingDeniedCase.stderr}`,
    );
    assert.match(
      `${missingDeniedCase.stdout}${missingDeniedCase.stderr}`,
      /local-validation-checkout-attestation-required/u,
    );
    assert.doesNotMatch(
      `${missingDeniedCase.stdout}${missingDeniedCase.stderr}`,
      /peas-outbound-network-denied/u,
    );
    const malformedDeniedCase = runDeniedEvidenceCase("{", caseId);
    assert.notEqual(malformedDeniedCase.status, 0);
    assert.match(
      `${malformedDeniedCase.stdout}${malformedDeniedCase.stderr}`,
      /local-validation-checkout-attestation-invalid/u,
    );
    assert.doesNotMatch(
      `${malformedDeniedCase.stdout}${malformedDeniedCase.stderr}`,
      /peas-outbound-network-denied/u,
    );
    const wrongCaseId = "lv-v1-053-400e1964e8c867bc";
    const mismatchedDeniedCase = runDeniedEvidenceCase(
      canonicalBytes({ ...checkoutAttestation, caseId: wrongCaseId }).trimEnd(),
      caseId,
    );
    assert.notEqual(mismatchedDeniedCase.status, 0);
    assert.match(
      `${mismatchedDeniedCase.stdout}${mismatchedDeniedCase.stderr}`,
      /local-validation-checkout-attestation-invalid/u,
    );
    assert.doesNotMatch(
      `${mismatchedDeniedCase.stdout}${mismatchedDeniedCase.stderr}`,
      /peas-outbound-network-denied/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime accepts passing nested subtests and rejects incomplete terminal summaries", () => {
  for (const count of [1, 6, 13]) {
    const accepted = runNodeTestSummaryParser(nodeTestSummary({ tests: count, pass: count }));
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.deepEqual(JSON.parse(accepted.stdout), {
      tests: count,
      pass: count,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
    });
  }

  const rejected = [
    nodeTestSummary({ tests: 0, pass: 0 }),
    nodeTestSummary({ tests: 6, pass: 5, fail: 1 }),
    nodeTestSummary({ tests: 6, pass: 5, cancelled: 1 }),
    nodeTestSummary({ tests: 6, pass: 5, skipped: 1 }),
    nodeTestSummary({ tests: 6, pass: 5, todo: 1 }),
    nodeTestSummary({ tests: 6, pass: 5 }),
    nodeTestSummary({ tests: 1, pass: 1 }).replace("ℹ todo 0\n", ""),
    `${nodeTestSummary({ tests: 1, pass: 1 })}ℹ pass 1\n`,
  ];
  for (const transcript of rejected) {
    const result = runNodeTestSummaryParser(transcript);
    assert.notEqual(result.status, 0, transcript);
    assert.match(result.stderr, /node-test-summary-(?:invalid|todo-ambiguous|pass-ambiguous)/u);
  }

  const inapplicable = runNodeTestSummaryParser(
    nodeTestSummary({ tests: 1, pass: 0, skipped: 1 }),
    "platform-inapplicable",
  );
  assert.equal(inapplicable.status, 0, inapplicable.stderr);
  assert.deepEqual(JSON.parse(inapplicable.stdout), {
    tests: 1,
    pass: 0,
    fail: 0,
    cancelled: 0,
    skipped: 1,
    todo: 0,
  });
  for (const transcript of [
    nodeTestSummary({ tests: 1, pass: 1 }),
    nodeTestSummary({ tests: 2, pass: 0, skipped: 2 }),
    nodeTestSummary({ tests: 1, pass: 0, fail: 1, skipped: 1 }),
  ]) {
    const result = runNodeTestSummaryParser(transcript, "platform-inapplicable");
    assert.notEqual(result.status, 0, transcript);
    assert.match(result.stderr, /node-test-summary-invalid/u);
  }
  const unknownDisposition = runNodeTestSummaryParser(
    nodeTestSummary({ tests: 1, pass: 0, skipped: 1 }),
    "skip-allowed",
  );
  assert.notEqual(unknownDisposition.status, 0);

  const universal = { expectedTerminalDisposition: "executable-assertions-passed" };
  const conditional = {
    expectedTerminalDisposition: "platform-conditional",
    applicablePlatforms: ["linux"],
  };
  assert.equal(
    runCaseDispositionResolver(universal, "win32").stdout,
    "executable-assertions-passed",
  );
  assert.equal(
    runCaseDispositionResolver(conditional, "linux").stdout,
    "executable-assertions-passed",
  );
  assert.equal(runCaseDispositionResolver(conditional, "win32").stdout, "platform-inapplicable");
  const invalidBinding = runCaseDispositionResolver(
    { ...universal, applicablePlatforms: ["linux"] },
    "win32",
  );
  assert.notEqual(invalidBinding.status, 0);
  assert.match(invalidBinding.stderr, /local-validation-platform-applicability-invalid/u);
});

test("runtime first boot is owned and missing authority with primary state is corruption", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-runtime-"));
  const corrupt = mkdtempSync(join(tmpdir(), "peas-lv-corrupt-"));
  try {
    const clean = runProbe(["runtime", directory]);
    assert.equal(clean.status, 0, clean.stderr);
    const value = JSON.parse(clean.stdout) as {
      first: { created: boolean };
      second: { created: boolean };
    };
    assert.equal(value.first.created, true);
    assert.equal(value.second.created, false);
    const rejected = runProbe(["runtime-corrupt", corrupt]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /authority-anchor-missing-terminal-corruption/u);
    rmSync(corrupt, { recursive: true, force: true });
    mkdirSync(corrupt);
    const stagingRejected = runProbe(["runtime-corrupt-staging", corrupt]);
    assert.notEqual(stagingRejected.status, 0);
    assert.match(stagingRejected.stderr, /authority-anchor-missing-terminal-corruption/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(corrupt, { recursive: true, force: true });
  }
});

test("memory and SQLite probes reconcile restarts, resources, orphans and exact zero effects", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-equivalence-"));
  try {
    const child = runProbe(["execute", directory]);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout) as {
      executedCaseCount: number;
      executionCount: number;
      executableProofSha256: string;
      resourceBoundaryResults: Array<{
        exactAccepted: boolean;
        oneOverRejected: boolean;
        rejection: string;
      }>;
      effects: Record<string, number>;
      cleanup: Record<string, number>;
      caseResults: Array<{ exitCode: number; sourcePath: string; testName: string }>;
    };
    assert.equal(result.executedCaseCount, 2);
    assert.equal(result.executionCount, 2);
    assert.match(result.executableProofSha256, /^[0-9a-f]{64}$/u);
    assert.ok(result.caseResults.every(({ exitCode }) => exitCode === 0));
    assert.ok(
      result.caseResults.every(({ sourcePath }) => sourcePath === "test/acceptance.test.ts"),
    );
    assert.equal(result.resourceBoundaryResults.length, 14);
    assert.ok(
      result.resourceBoundaryResults.every(
        ({ exactAccepted, oneOverRejected, rejection }) =>
          exactAccepted && oneOverRejected && /^resource-ceiling-exceeded:/u.test(rejection),
      ),
    );
    assert.deepEqual(new Set(Object.values(result.effects)), new Set([0]));
    for (const name of [
      "orphanProcesses",
      "extraHandles",
      "workers",
      "leases",
      "sqliteFences",
      "activeRetentionOperations",
    ])
      assert.equal(result.cleanup[name], 0, name);
    assert.ok((result.cleanup["cleanupLatencyMs"] ?? -1) >= 0);

    const credentialEffect = runProbe(["execute-credential-effect", directory]);
    assert.notEqual(credentialEffect.status, 0);
    assert.match(credentialEffect.stderr, /effects-ceiling-exceeded:/u);

    const residue = runProbe(["execute-residue", directory]);
    assert.notEqual(residue.status, 0);
    assert.match(residue.stderr, /runtime-durable-residue-detected/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("approved hard-kill points terminate owned processes and recover all case vectors", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-hard-kill-"));
  try {
    const child = runProbe(["hard-kill", directory]);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout) as {
      status: string;
      boundSelectorCount: number;
      executionCount: number;
      pointClaims: string[];
      results: Array<{
        exitCode: number;
        testName: string;
        auditedProcessCount: number;
        boundaryAuditSha256: string;
      }>;
    };
    assert.equal(result.status, "passed");
    assert.equal(result.boundSelectorCount, 1);
    assert.equal(result.executionCount, 1);
    assert.equal(result.pointClaims.length, 1);
    assert.ok(
      result.results.every(
        ({ exitCode, testName, auditedProcessCount, boundaryAuditSha256 }) =>
          exitCode === 0 &&
          /hard.kill/iu.test(testName) &&
          auditedProcessCount > 1 &&
          /^[0-9a-f]{64}$/u.test(boundaryAuditSha256),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("evidence verification rejects incomplete, forged, changed and added files", () => {
  const root = mkdtempSync(join(tmpdir(), "peas-lv-evidence-"));
  try {
    const forgedRoot = join(root, "forged");
    mkdirSync(forgedRoot);
    writeFileSync(
      join(forgedRoot, "automation-report.json"),
      canonicalBytes({ decision: "GO", corpusExecuted: false }),
      "utf8",
    );
    const forgedReport = readFileSync(join(forgedRoot, "automation-report.json"));
    const forgedInventory = [
      {
        path: "automation-report.json",
        sizeBytes: forgedReport.byteLength,
        sha256: sha256(forgedReport),
      },
    ];
    const forgedManifest = canonicalBytes({
      schemaVersion: 1,
      decision: "GO",
      candidate: { sha: "a".repeat(40), tree: "b".repeat(40), status: "" },
      inventory: forgedInventory,
      inventorySha256: sha256(canonicalBytes(forgedInventory)),
    });
    writeFileSync(join(forgedRoot, "bundle-manifest.json"), forgedManifest, "utf8");
    writeFileSync(
      join(forgedRoot, "bundle-manifest.sha256"),
      `${sha256(forgedManifest)}  bundle-manifest.json\n`,
      "utf8",
    );
    const forged = spawnSync(
      process.execPath,
      ["scripts/local-validation/evidence.mjs", "verify"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, PEAS_LOCAL_VALIDATION_EVIDENCE_ROOT: forgedRoot },
      },
    );
    assert.notEqual(forged.status, 0);
    assert.match(forged.stderr, /evidence-decision-invalid/u);
    rmSync(forgedRoot, { recursive: true, force: true });

    const identityProbe = runProbe(["evidence-fixture-identity"]);
    assert.equal(identityProbe.status, 0, identityProbe.stderr);
    const identity = JSON.parse(identityProbe.stdout) as {
      candidate: { sha: string; tree: string; status: string };
      manifest: { id: string; caseCount: number; sha256: string };
      migrations: unknown[];
      platform: unknown;
    };
    const effects = Object.fromEntries(
      [
        "network",
        "provider",
        "credential",
        "account",
        "broker",
        "order",
        "portfolio",
        "position",
        "fill",
        "spending",
        "financialEffect",
      ].map((name) => [name, 0]),
    );
    const commandNames = [
      ["manifest", "manifest:local-validation"],
      ["integration", "gate:integration"],
      ["format", "format:check"],
      ["lint", "lint"],
      ["typecheck", "typecheck"],
      ["build", "build"],
      ["unit-integration-restart", "test"],
      ["coverage", "test:coverage"],
      ["reconciliation", "test:evidence-reconciliation"],
      ["mutation", "test:mutation"],
      ["hard-kill", "test:hard-kill"],
      ["scale", "test:scale"],
      ["unchanged-check", "check"],
    ] as const;
    mkdirSync(join(root, "commands"));
    const commands = commandNames.map(([name, script]) => {
      const transcriptPath = `commands/${name}.log`;
      writeFileSync(
        join(root, transcriptPath),
        `command: npm run ${script}\nexitCode: 0\n`,
        "utf8",
      );
      return {
        name,
        command: `npm run ${script}`,
        exitCode: 0,
        signal: null,
        spawnError: null,
        elapsedMs: 1,
        transcriptPath,
      };
    });
    const report = {
      schemaVersion: 1,
      kind: "peas-local-validation-automation-evidence",
      decision: "GO",
      corpusExecuted: false,
      corpusAuthorizationRequired: true,
      candidate: identity.candidate,
      manifest: {
        ...identity.manifest,
        digestFileSha256: sha256(readFileSync("config/local-validation/manifest.v1.sha256")),
      },
      inputs: {
        matrix: {
          path: "config/local-validation/matrix.v1.json",
          sha256: sha256(readFileSync("config/local-validation/matrix.v1.json")),
        },
        packageLock: {
          path: "package-lock.json",
          sha256: sha256(readFileSync("package-lock.json")),
        },
        migrations: identity.migrations,
      },
      platform: identity.platform,
      commands,
      integrationProof: {
        decision: "GO",
        result: { status: "passed", executedCaseCount: 2, effects },
      },
      effects,
    };
    const reportPath = join(root, "automation-report.json");
    writeFileSync(reportPath, canonicalBytes(report), "utf8");
    const inventory = [
      ...commands.map(({ transcriptPath }) => {
        const bytes = readFileSync(join(root, transcriptPath));
        return { path: transcriptPath, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
      }),
      (() => {
        const bytes = readFileSync(reportPath);
        return {
          path: "automation-report.json",
          sizeBytes: bytes.byteLength,
          sha256: sha256(bytes),
        };
      })(),
    ].sort((left, right) => left.path.localeCompare(right.path));
    const manifestBytes = canonicalBytes({
      schemaVersion: 1,
      decision: "GO",
      candidate: identity.candidate,
      inventory,
      inventorySha256: sha256(canonicalBytes(inventory)),
    });
    writeFileSync(join(root, "bundle-manifest.json"), manifestBytes, "utf8");
    writeFileSync(
      join(root, "bundle-manifest.sha256"),
      `${sha256(manifestBytes)}  bundle-manifest.json\n`,
      "utf8",
    );
    const valid = spawnSync(process.execPath, ["scripts/local-validation/evidence.mjs", "verify"], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PEAS_LOCAL_VALIDATION_EVIDENCE_ROOT: root },
    });
    assert.equal(valid.status, 0, valid.stderr);
    const originalReport = readFileSync(reportPath);
    writeFileSync(reportPath, `${originalReport.toString("utf8")} `, "utf8");
    const changed = spawnSync(
      process.execPath,
      ["scripts/local-validation/evidence.mjs", "verify"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, PEAS_LOCAL_VALIDATION_EVIDENCE_ROOT: root },
      },
    );
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /evidence-inventory-tamper-detected/u);
    writeFileSync(reportPath, originalReport);
    writeFileSync(join(root, "added.txt"), "tamper\n", "utf8");
    const tampered = spawnSync(
      process.execPath,
      ["scripts/local-validation/evidence.mjs", "verify"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, PEAS_LOCAL_VALIDATION_EVIDENCE_ROOT: root },
      },
    );
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /evidence-inventory-tamper-detected/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("path and process fixtures remain valid with Windows and Linux separators", () => {
  const manifest = readFileSync("config/local-validation/manifest.v1.json", "utf8");
  assert.doesNotMatch(manifest, /[A-Za-z]:\\|\/home\//u);
  const gate = readFileSync("scripts/local-validation/gate.mjs", "utf8");
  const evidence = readFileSync("scripts/local-validation/evidence.mjs", "utf8");
  assert.match(evidence, /process\.env\.npm_execpath/u);
  assert.match(evidence, /spawnSync\(process\.execPath/u);
  assert.match(gate, /windowsHide/u);
  assert.doesNotMatch(gate, /SIGKILL/u);
});
