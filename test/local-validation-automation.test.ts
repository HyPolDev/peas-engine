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
        testName: "SQLite 1k-cluster scale gate records latency, memory, and storage metrics",
      },
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

test("case child environments ignore inherited skip, boundary, metrics, and worker controls", () => {
  const controls = [
    "NODE_OPTIONS",
    "PEAS_SKIP_HARD_KILL_MATRIX",
    "PEAS_TEST_BOUNDARY",
    "PEAS_SCALE_METRICS_PATH",
    "PEAS_LOCAL_VALIDATION_WORKER_GROUP_ID",
    "PEAS_LOCAL_VALIDATION_WORKER_TOKEN",
    "PEAS_LOCAL_VALIDATION_WORKER_OWNER_TOKEN",
    "PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH",
  ];
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { sanitizedLocalValidationChildEnvironment } from './scripts/local-validation/contract.mjs';
       const controls = ${JSON.stringify(controls)};
       const inherited = { PEAS_ALLOWED_SENTINEL: 'preserved' };
       for (const name of controls.flatMap((control) => [control, control.toLowerCase()])) {
         Object.defineProperty(inherited, name, {
           enumerable: true,
           get() { throw new Error('forbidden-control-value-read:' + name); }
         });
       }
       const sanitized = sanitizedLocalValidationChildEnvironment(inherited);
       process.stdout.write(JSON.stringify({ keys: Object.keys(sanitized).sort(), sanitized }));`,
    ],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    keys: ["PEAS_ALLOWED_SENTINEL"],
    sanitized: { PEAS_ALLOWED_SENTINEL: "preserved" },
  });
  for (const path of [
    "scripts/local-validation/gate.mjs",
    "scripts/local-validation/hard-kill.mjs",
    "scripts/local-validation/runtime.mjs",
  ]) {
    assert.match(
      readFileSync(path, "utf8"),
      /sanitizedLocalValidationChildEnvironment\(\)/u,
      `${path} must sanitize inherited controls before spawning a child`,
    );
  }
});

test("hard-kill launches bind exclusive worker lifecycle authority without executing cases", () => {
  const manifest = JSON.parse(readFileSync("config/local-validation/manifest.v1.json", "utf8")) as {
    hardKillBindings: Array<{ caseId: string; sourcePath: string; testName: string }>;
    cases: Array<{
      id: string;
      executable: { sourcePath: string; testName: string };
    }>;
  };
  const affectedCaseIds = [
    "lv-v1-003-8388b539c98a4348",
    "lv-v1-004-d9a85f5bda87dcfe",
    "lv-v1-005-d8084fa0ffd45309",
    "lv-v1-021-462cc45d40f58077",
    "lv-v1-026-967a494791b86694",
    "lv-v1-028-d4ce6f1282d8d92f",
    "lv-v1-035-1432b682087661fd",
    "lv-v1-036-8fe380c0fe464bbf",
    "lv-v1-037-3d3061d9e733cfde",
  ].sort();
  const boundCaseIds = [
    "lv-v1-003-8388b539c98a4348",
    "lv-v1-004-d9a85f5bda87dcfe",
    "lv-v1-005-d8084fa0ffd45309",
    "lv-v1-021-462cc45d40f58077",
    "lv-v1-026-967a494791b86694",
  ].sort();
  assert.deepEqual(manifest.hardKillBindings.map(({ caseId }) => caseId).sort(), boundCaseIds);
  for (const caseId of affectedCaseIds) {
    const caseEntry = manifest.cases.find(({ id }) => id === caseId);
    assert.ok(caseEntry, caseId);
    const source = readFileSync(caseEntry.executable.sourcePath, "utf8");
    assert.ok(source.includes(caseEntry.executable.testName), caseId);
  }
  for (const { sourcePath, testName } of manifest.hardKillBindings) {
    const source = readFileSync(sourcePath, "utf8");
    assert.ok(source.includes(testName), `${sourcePath}:${testName}`);
  }
  const hardKill = readFileSync("scripts/local-validation/hard-kill.mjs", "utf8");
  assert.match(hardKill, /hard-kill-worker-lifecycle\.jsonl/u);
  assert.match(hardKill, /PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH/u);
  assert.match(hardKill, /measureWorkerOwnership\(\{/u);
  assert.match(hardKill, /workerOwnership\.measuredWorkers !== 0/u);
  const gate = readFileSync("scripts/local-validation/gate.mjs", "utf8");
  assert.match(gate, /NODE_OPTIONS: ""/u);
});

test("hard-kill worker reconciliation excludes settled PID reuse and rejects live claims", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { validateHardKillWorkerEvidence } from './scripts/local-validation/hard-kill.mjs';
       const groupId = 'hard-kill-synthetic-group';
       const rootToken = 'hard-kill-synthetic-root';
       const rootPid = 100;
       const claim = (token, pid, state = 'settled') => ({
         schemaVersion: 1,
         groupId,
         ownerToken: rootToken,
         ownerPid: rootPid,
         childToken: token,
         pid,
         surface: 'child_process.spawn',
         state,
         exitCode: state === 'settled' ? 0 : null,
         signalCode: null,
         errorCode: null,
       });
       const lifecycle = (entry) => [
         {
           schemaVersion: 1, kind: 'worker-lifecycle', transition: 'spawn-intent',
           groupId, ownerToken: entry.ownerToken, ownerPid: entry.ownerPid,
           childToken: entry.childToken, pid: null, surface: entry.surface,
           exitCode: null, signalCode: null, errorCode: null,
         },
         {
           schemaVersion: 1, kind: 'worker-lifecycle', transition: 'claimed',
           groupId, ownerToken: entry.ownerToken, ownerPid: entry.ownerPid,
           childToken: entry.childToken, pid: entry.pid, surface: entry.surface,
           exitCode: null, signalCode: null, errorCode: null,
         },
         ...(entry.state === 'settled' ? [{
           schemaVersion: 1, kind: 'worker-lifecycle', transition: 'settled',
           groupId, ownerToken: entry.ownerToken, ownerPid: entry.ownerPid,
           childToken: entry.childToken, pid: entry.pid, surface: entry.surface,
           exitCode: entry.exitCode, signalCode: null, errorCode: null,
         }] : []),
       ];
       const childAudit = (entry) => ({
         schemaVersion: 1,
         pid: entry.pid,
         ppid: rootPid,
         nodeTestChild: false,
         childDenialInherited: true,
         successfulOutboundTransports: 0,
         workerOwnership: {
           schemaVersion: 1, groupId, token: entry.childToken, ownerToken: rootToken,
         },
         ownedChildClaims: [],
       });
       const first = claim('reuse-first', 2000);
       const second = claim('reuse-second', 2000);
       const reuse = validateHardKillWorkerEvidence({
         boundaryAudits: [childAudit(first), childAudit(second)],
         lifecycleEvents: [...lifecycle(first), ...lifecycle(second)],
         rootClaims: [first, second],
         rootOwnerToken: rootToken,
         rootOwnerPid: rootPid,
         platform: process.platform,
       });
       const live = claim('live-child', 2001, 'live');
       let liveFailure = '';
       try {
         validateHardKillWorkerEvidence({
           boundaryAudits: [childAudit(first), childAudit(second)],
           lifecycleEvents: [...lifecycle(first), ...lifecycle(second), ...lifecycle(live)],
           rootClaims: [first, second, live],
           rootOwnerToken: rootToken,
           rootOwnerPid: rootPid,
           platform: process.platform,
         });
       } catch (error) {
         liveFailure = error instanceof Error ? error.message : String(error);
       }
       let malformedFailure = '';
       try {
         validateHardKillWorkerEvidence({
           boundaryAudits: [childAudit(first), childAudit(second)],
           lifecycleEvents: [
             ...lifecycle(first), ...lifecycle(second), lifecycle(first)[0],
           ],
           rootClaims: [first, second],
           rootOwnerToken: rootToken,
           rootOwnerPid: rootPid,
           platform: process.platform,
         });
       } catch (error) {
         malformedFailure = error instanceof Error ? error.message : String(error);
       }
       process.stdout.write(JSON.stringify({
         reuseMeasuredWorkers: reuse.measuredWorkers,
         historicalPidReuseCount: reuse.historicalPidReuseCount,
         liveFailure,
         malformedFailure,
       }));`,
    ],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as {
    reuseMeasuredWorkers: number;
    historicalPidReuseCount: number;
    liveFailure: string;
    malformedFailure: string;
  };
  assert.equal(output.reuseMeasuredWorkers, 0);
  assert.equal(output.historicalPidReuseCount, 1);
  assert.match(output.liveFailure, /hard-kill-worker-residue/u);
  assert.match(output.liveFailure, /"measuredWorkers":1/u);
  assert.match(output.liveFailure, /"ownershipEvidenceSha256":"[0-9a-f]{64}"/u);
  assert.doesNotMatch(output.liveFailure, /live-child|hard-kill-synthetic-root/u);
  assert.match(output.malformedFailure, /worker-accounting-invalid:/u);
  assert.match(output.malformedFailure, /"measuredWorkers":0/u);
  assert.match(output.malformedFailure, /"issues":\[/u);
  assert.match(output.malformedFailure, /"ownershipEvidenceSha256":"[0-9a-f]{64}"/u);
  assert.doesNotMatch(output.malformedFailure, /reuse-first|hard-kill-synthetic-root/u);
});

test("synthetic hard-kill launch reconciles exclusive audit and lifecycle evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-synthetic-hard-kill-"));
  try {
    const sourcePath = "test/fixtures/local-validation-worker-accounting-case.test.ts";
    const sourceBytes = readFileSync(sourcePath);
    const testName = "synthetic forced child remains parent-attributable";
    const caseEntry = {
      id: "lv-v1-999-1111111111111111",
      executable: {
        sourcePath,
        compiledPath: "dist/test/fixtures/local-validation-worker-accounting-case.test.js",
        testName,
        nodeTestNamePattern: `^${testName}$`,
      },
    };
    const manifest = {
      cases: [caseEntry],
      hardKillPoints: ["synthetic-forced-child"],
      hardKillBindings: [
        {
          caseId: caseEntry.id,
          sourcePath,
          sourceSha256: sha256(sourceBytes),
          testName,
          supportsPointFilter: false,
          points: ["synthetic-forced-child"],
        },
      ],
    };
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { executeHardKillMatrix } from './scripts/local-validation/hard-kill.mjs';
         const result = await executeHardKillMatrix(process.argv[1], JSON.parse(process.argv[2]));
         process.stdout.write(JSON.stringify(result));`,
        directory,
        JSON.stringify(manifest),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const output = JSON.parse(result.stdout) as {
      status: string;
      boundSelectorCount: number;
      executionCount: number;
      results: Array<{ workerOwnershipSha256: string }>;
    };
    assert.equal(output.status, "passed");
    assert.equal(output.boundSelectorCount, 1);
    assert.equal(output.executionCount, 1);
    assert.match(output.results[0]?.workerOwnershipSha256 ?? "", /^[0-9a-f]{64}$/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("gate worker replaces ambient NODE_OPTIONS with the exact authoritative preload", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-gate-node-options-"));
  try {
    const spoofPreload = join(directory, "spoof-network-deny.cjs");
    const markerPath = join(directory, "spoof-executed.txt");
    writeFileSync(
      spoofPreload,
      `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "executed");\n`,
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { spawnSync } from 'node:child_process';
         import { existsSync } from 'node:fs';
         import { sanitizedLocalValidationChildEnvironment } from './scripts/local-validation/contract.mjs';
         const [preload, spoofPreload, markerPath] = process.argv.slice(1);
         const inherited = {
           ...process.env,
           NODE_OPTIONS: '--require ' + JSON.stringify(spoofPreload),
         };
         const child = spawnSync(
           process.execPath,
           [
             '--require',
             preload,
             '-e',
             "if (globalThis.__PEAS_NETWORK_DENIAL__?.boundary !== 'node-process-capability-closure-v2' || process.env.NODE_OPTIONS !== '') process.exit(17);",
           ],
           {
             cwd: process.cwd(),
             encoding: 'utf8',
             windowsHide: true,
             env: {
               ...sanitizedLocalValidationChildEnvironment(inherited),
               NODE_OPTIONS: '',
               PEAS_NETWORK_DENIAL_INHERITED: '1',
             },
           },
         );
         process.stdout.write(JSON.stringify({
           childStatus: child.status,
           childStderr: child.stderr,
           spoofExecuted: existsSync(markerPath),
         }));`,
        preload,
        spoofPreload,
        markerPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: "" },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      childStatus: 0,
      childStderr: "",
      spoofExecuted: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("worker accounting is token-bound, PID-reuse safe, and fail-closed", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {
         measureWorkerOwnership,
       } from './scripts/local-validation/worker-accounting.mjs';
       import {
         enforceResourceCeilings,
         enforceWorkerCleanup,
       } from './scripts/local-validation/runtime.mjs';
       const groupId = 'synthetic-group';
       const rootOwnerToken = 'synthetic-root';
       const claim = (index, state = 'settled', ownerToken = rootOwnerToken) => ({
         schemaVersion: 1,
         groupId,
         ownerToken,
         ownerPid: ownerToken === rootOwnerToken ? 100 : 1000,
         childToken: 'child-' + index,
         pid: 1000 + (index % 266),
         surface: 'child_process.spawnSync',
         state,
         exitCode: state === 'settled' ? 0 : null,
         signalCode: null,
         errorCode: null,
       });
       const lifecycle = (entry) => [
         {
           schemaVersion: 1,
           kind: 'worker-lifecycle',
           transition: 'spawn-intent',
           groupId,
           ownerToken: entry.ownerToken,
           ownerPid: entry.ownerPid,
           childToken: entry.childToken,
           pid: null,
           surface: entry.surface,
           exitCode: null,
           signalCode: null,
           errorCode: null,
         },
         ...(entry.pid === null ? [] : [{
           schemaVersion: 1,
           kind: 'worker-lifecycle',
           transition: 'claimed',
           groupId,
           ownerToken: entry.ownerToken,
           ownerPid: entry.ownerPid,
           childToken: entry.childToken,
           pid: entry.pid,
           surface: entry.surface,
           exitCode: null,
           signalCode: null,
           errorCode: null,
         }]),
         ...(entry.state === 'live' ? [] : [{
           schemaVersion: 1,
           kind: 'worker-lifecycle',
           transition: entry.state === 'settled' ? 'settled' : 'accounting-error',
           groupId,
           ownerToken: entry.ownerToken,
           ownerPid: entry.ownerPid,
           childToken: entry.childToken,
           pid: entry.pid,
           surface: entry.surface,
           exitCode: entry.exitCode,
           signalCode: entry.signalCode,
           errorCode: entry.errorCode,
         }]),
       ];
       const audit = (entry, ownedChildClaims = []) => ({
         schemaVersion: 1,
         pid: entry.pid,
         ppid: entry.ownerPid,
         nodeTestChild: false,
         workerOwnership: {
           schemaVersion: 1,
           groupId,
           token: entry.childToken,
           ownerToken: entry.ownerToken,
         },
         ownedChildClaims,
       });
       const settled = (count, platform) => {
         const directClaims = Array.from({ length: count }, (_, index) => claim(index));
         return measureWorkerOwnership({
           groupId,
           rootOwnerToken,
           rootOwnerPid: 100,
           directClaims,
           audits: directClaims.map((entry) => audit(entry)),
           lifecycleEvents: directClaims.flatMap(lifecycle),
           platform,
         });
       };
       const windowsReuse = settled(681, 'win32');
       const linuxReuse = settled(681, 'linux');
       const largeCleanup = settled(2000, process.platform);
       const live = (count) => measureWorkerOwnership({
         groupId,
         rootOwnerToken,
         rootOwnerPid: 100,
         directClaims: Array.from({ length: count }, (_, index) => claim(index, 'live')),
         audits: [],
         lifecycleEvents: Array.from({ length: count }, (_, index) =>
           lifecycle(claim(index, 'live')),
         ).flat(),
         platform: process.platform,
       });
       const liveFour = live(4);
       enforceResourceCeilings({ workers: 4 }, { workers: 4 }, { workerOwnership: liveFour });
       let liveCleanupFailure = '';
       try {
         enforceWorkerCleanup(liveFour, 4);
       } catch (error) {
         liveCleanupFailure = error instanceof Error ? error.message : String(error);
       }
       const liveFive = live(5);
       let fiveFailure = '';
       try {
         enforceResourceCeilings({ workers: 5 }, { workers: 4 }, { workerOwnership: liveFive });
       } catch (error) {
         fiveFailure = error instanceof Error ? error.message : String(error);
       }
       const expectFailure = (directClaims, audits, lifecycleEvents, pattern) => {
         try {
           measureWorkerOwnership({
             groupId,
             rootOwnerToken,
             rootOwnerPid: 100,
             directClaims,
             audits,
             lifecycleEvents,
             platform: process.platform,
           });
           throw new Error('expected-worker-accounting-failure');
         } catch (error) {
           const message = error instanceof Error ? error.message : String(error);
           if (!pattern.test(message)) throw error;
           return message;
         }
       };
       const owner = claim(3001);
       const orphan = claim(3002, 'live', owner.childToken);
       orphan.ownerPid = owner.pid;
       const orphanFailure = expectFailure(
         [owner],
         [audit(owner, [orphan])],
         [...lifecycle(owner), ...lifecycle(orphan)],
         /orphan-child/u,
       );
       const unowned = claim(3003, 'settled', 'unknown-owner');
       const unownedContainer = {
         ...audit(unowned, [unowned]),
         pid: unowned.ownerPid,
         ppid: 100,
         workerOwnership: {
           schemaVersion: 1,
           groupId,
           token: unowned.ownerToken,
           ownerToken: rootOwnerToken,
         },
       };
       const unownedFailure = expectFailure(
         [],
         [unownedContainer, audit(unowned)],
         lifecycle(unowned),
         /unowned-child/u,
       );
       const duplicate = claim(3004);
       const ambiguousFailure = expectFailure(
         [duplicate],
         [audit(duplicate)],
         [...lifecycle(duplicate), lifecycle(duplicate)[0]],
         /ambiguous-ownership/u,
       );
       const broken = {
         ...claim(3005),
         state: 'accounting-error',
         pid: null,
         exitCode: null,
         errorCode: 'EFAIL',
       };
       const accountingFailure = expectFailure(
         [broken],
         [],
         lifecycle(broken),
         /accounting-error/u,
       );
       const forced = { ...claim(3006), exitCode: null, signalCode: 'SIGKILL' };
       const forcedTermination = measureWorkerOwnership({
         groupId,
         rootOwnerToken,
         rootOwnerPid: 100,
         directClaims: [forced],
         audits: [],
         lifecycleEvents: lifecycle(forced),
         platform: process.platform,
       });
       const gracefulWithoutAudit = claim(3012);
       const gracefulAuditMissingFailure = expectFailure(
         [gracefulWithoutAudit],
         [],
         lifecycle(gracefulWithoutAudit),
         /graceful-settlement-audit-missing/u,
       );
       const collisionLeft = claim(3007, 'live');
       const collisionRight = { ...claim(3008, 'live'), pid: collisionLeft.pid };
       const collisionFailure = expectFailure(
         [collisionLeft, collisionRight],
         [],
         [...lifecycle(collisionLeft), ...lifecycle(collisionRight)],
         /simultaneous-live-pid-collision/u,
       );
       const temporalLeft = claim(3013);
       const temporalRight = { ...claim(3014, 'live'), pid: temporalLeft.pid };
       const leftLifecycle = lifecycle(temporalLeft);
       const rightLifecycle = lifecycle(temporalRight);
       const temporalCollisionFailure = expectFailure(
         [temporalLeft, temporalRight],
         [audit(temporalLeft)],
         [
           leftLifecycle[0],
           leftLifecycle[1],
           rightLifecycle[0],
           rightLifecycle[1],
           leftLifecycle[2],
         ],
         /pid-lifecycle-overlap/u,
       );
       const duplicateSnapshot = claim(3015);
       const duplicateSnapshotFailure = expectFailure(
         [duplicateSnapshot, { ...duplicateSnapshot }],
         [audit(duplicateSnapshot)],
         lifecycle(duplicateSnapshot),
         /claim-snapshot-duplicate/u,
       );
       const invalidSignal = {
         ...claim(3016),
         exitCode: null,
         signalCode: 'NOT_A_SIGNAL',
       };
       const invalidSignalFailure = expectFailure(
         [invalidSignal],
         [],
         lifecycle(invalidSignal),
         /lifecycle-schema-invalid/u,
       );
       const killedOwner = {
         ...claim(3017),
         exitCode: null,
         signalCode: 'SIGKILL',
       };
       const synchronousChild = claim(3018, 'live', killedOwner.childToken);
       synchronousChild.ownerPid = killedOwner.pid;
       const synchronousChildLifecycle = lifecycle(synchronousChild);
       synchronousChildLifecycle[1] = {
         ...synchronousChildLifecycle[1],
         transition: 'child-started',
       };
       const synchronousOwnerKilledFailure = expectFailure(
         [killedOwner],
         [],
         [...lifecycle(killedOwner), ...synchronousChildLifecycle],
         /orphan-child/u,
       );
       const incompleteLive = claim(3019, 'live');
       const incompleteLifecycle = lifecycle(incompleteLive);
       incompleteLifecycle[1] = {
         ...incompleteLifecycle[1],
         transition: 'child-started',
       };
       const incompleteParentEvidenceFailure = expectFailure(
         [],
         [],
         incompleteLifecycle,
         /parent-claim-transition-missing/u,
       );
       const missingSnapshot = claim(3020, 'live');
       const missingParentSnapshotFailure = expectFailure(
         [],
         [],
         lifecycle(missingSnapshot),
         /parent-claim-snapshot-missing/u,
       );
       const cycleLeft = claim(3021, 'live', 'child-3022');
       const cycleRight = claim(3022, 'live', cycleLeft.childToken);
       cycleLeft.ownerPid = cycleRight.pid;
       cycleRight.ownerPid = cycleLeft.pid;
       const cyclicLineageFailure = expectFailure(
         [cycleLeft, cycleRight],
         [],
         [...lifecycle(cycleLeft), ...lifecycle(cycleRight)],
         /ownership-lineage-cycle/u,
       );
       const auditCycleOwner = claim(3024);
       const auditCycleChild = claim(3025, 'settled', auditCycleOwner.childToken);
       auditCycleChild.ownerPid = 200;
       const ownerAnchorAudit = audit(auditCycleOwner, [auditCycleChild]);
       const childAnchorAudit = audit(auditCycleChild);
       const auditCycleLeft = {
         ...audit(auditCycleOwner),
         pid: 200,
         ppid: 201,
         nodeTestChild: true,
       };
       const auditCycleRight = {
         ...audit(auditCycleOwner),
         pid: 201,
         ppid: 200,
         nodeTestChild: true,
       };
       const cyclicAuditLineageFailure = expectFailure(
         [auditCycleOwner],
         [ownerAnchorAudit, childAnchorAudit, auditCycleLeft, auditCycleRight],
         [...lifecycle(auditCycleOwner), ...lifecycle(auditCycleChild)],
         /implicit-audit-lineage-cycle/u,
       );
       const sensitiveValue = 'credential-looking-' + 'x'.repeat(4096);
       const oversizedRecord = {
         ...lifecycle(claim(3023, 'live'))[0],
         transition: { nested: [sensitiveValue, { value: sensitiveValue }] },
         childToken: { nested: [sensitiveValue] },
         surface: [sensitiveValue],
       };
       const boundedMalformedFailure = expectFailure(
         [],
         [],
         [oversizedRecord],
         /lifecycle-schema-invalid/u,
       );
       if (boundedMalformedFailure.includes(sensitiveValue)) {
         throw new Error('worker-accounting-sensitive-value-exposed');
       }
       if (boundedMalformedFailure.length > 4096) {
         throw new Error('worker-accounting-failure-evidence-unbounded');
       }
       const malformedTerminalFailures = [];
       const forcedTemplate = { ...claim(3026), exitCode: null, signalCode: 'SIGKILL' };
       for (const field of ['exitCode', 'signalCode', 'errorCode']) {
         const omittedLifecycle = lifecycle(forcedTemplate);
         delete omittedLifecycle[2][field];
         const omittedSnapshot = { ...forcedTemplate };
         delete omittedSnapshot[field];
         malformedTerminalFailures.push(expectFailure(
           [omittedSnapshot],
           [],
           omittedLifecycle,
           /lifecycle-schema-invalid/u,
         ));
         const fieldMarker = sensitiveValue + '-' + field;
         const malformedLifecycle = lifecycle(forcedTemplate);
         malformedLifecycle[2][field] = {
           nested: [fieldMarker, { value: fieldMarker }],
         };
         const malformedSnapshot = {
           ...forcedTemplate,
           [field]: [fieldMarker, { nested: fieldMarker }],
         };
         const malformedFieldFailure = expectFailure(
           [malformedSnapshot],
           [],
           malformedLifecycle,
           /lifecycle-schema-invalid/u,
         );
         if (malformedFieldFailure.includes(fieldMarker) || malformedFieldFailure.length > 4096) {
           throw new Error('worker-accounting-terminal-field-evidence-unbounded');
         }
         malformedTerminalFailures.push(malformedFieldFailure);
       }
       const wrongRootPid = claim(3027, 'live');
       wrongRootPid.ownerPid = 424242;
       const rootPidFailure = expectFailure(
         [wrongRootPid],
         [],
         lifecycle(wrongRootPid),
         /root-owner-pid-conflict/u,
       );
       const provenanceParent = claim(3028);
       const unrelatedParent = claim(3029);
       const misplacedChild = claim(3030, 'settled', provenanceParent.childToken);
       misplacedChild.ownerPid = provenanceParent.pid;
       const snapshotProvenanceFailure = expectFailure(
         [provenanceParent, unrelatedParent],
         [
           audit(provenanceParent),
           audit(unrelatedParent, [misplacedChild]),
           audit(misplacedChild),
         ],
         [
           ...lifecycle(provenanceParent),
           ...lifecycle(unrelatedParent),
           ...lifecycle(misplacedChild),
         ],
         /claim-containing-audit-owner-conflict/u,
       );
       const cyclicSnapshot = claim(3031);
       cyclicSnapshot.extra = cyclicSnapshot;
       const cyclicSnapshotFailure = expectFailure(
         [cyclicSnapshot],
         [],
         lifecycle(claim(3031)),
         /claim-schema-invalid/u,
       );
       if (cyclicSnapshotFailure.length > 4096 || /RangeError|Maximum call stack/u.test(cyclicSnapshotFailure)) {
         throw new Error('worker-accounting-cyclic-snapshot-unbounded');
       }
       const oversizedExit = { ...claim(3032), exitCode: Number.MAX_SAFE_INTEGER };
       const oversizedExitFailure = expectFailure(
         [oversizedExit],
         [],
         lifecycle(oversizedExit),
         /lifecycle-schema-invalid/u,
       );
       const cyclicGroupId = {};
       cyclicGroupId.self = cyclicGroupId;
       let cyclicInputFailure = '';
       try {
         measureWorkerOwnership({
           groupId: cyclicGroupId,
           rootOwnerToken,
           rootOwnerPid: 100,
           directClaims: [],
           audits: [],
           lifecycleEvents: [],
           platform: process.platform,
         });
         throw new Error('expected-cyclic-input-failure');
       } catch (error) {
         cyclicInputFailure = error instanceof Error ? error.message : String(error);
       }
       if (
         !/worker-accounting-invalid:schema-invalid/u.test(cyclicInputFailure) ||
         /RangeError|Maximum call stack/u.test(cyclicInputFailure) ||
         cyclicInputFailure.length > 4096
       ) {
         throw new Error('worker-accounting-cyclic-input-unbounded');
       }
       const reservedRootClaim = claim(3033, 'live');
       reservedRootClaim.childToken = rootOwnerToken;
       const reservedRootTokenFailure = expectFailure(
         [reservedRootClaim],
         [],
         lifecycle(reservedRootClaim),
         /lifecycle-schema-invalid/u,
       );
       const reservedRootPidClaim = claim(3036, 'live');
       reservedRootPidClaim.pid = 100;
       const reservedRootPidFailure = expectFailure(
         [reservedRootPidClaim],
         [],
         lifecycle(reservedRootPidClaim),
         /lifecycle-schema-invalid/u,
       );
       const nestedDirectOwner = claim(3037);
       const nestedDirectChild = claim(3038, 'settled', nestedDirectOwner.childToken);
       nestedDirectChild.ownerPid = nestedDirectOwner.pid;
       const nestedDirectClaimFailure = expectFailure(
         [nestedDirectOwner, nestedDirectChild],
         [audit(nestedDirectOwner), audit(nestedDirectChild)],
         [...lifecycle(nestedDirectOwner), ...lifecycle(nestedDirectChild)],
         /direct-claim-owner-conflict/u,
       );
       const historicalOwner = claim(3039);
       const lateHistoricalChild = claim(3040, 'settled', historicalOwner.childToken);
       lateHistoricalChild.ownerPid = historicalOwner.pid;
       const historicalLineageFailure = expectFailure(
         [historicalOwner],
         [audit(historicalOwner, [lateHistoricalChild]), audit(lateHistoricalChild)],
         [...lifecycle(historicalOwner), ...lifecycle(lateHistoricalChild)],
         /child-owner-lifecycle-disjoint/u,
       );
       const survivingOwner = claim(3041);
       const survivingChild = claim(3042, 'settled', survivingOwner.childToken);
       survivingChild.ownerPid = survivingOwner.pid;
       const survivingOwnerLifecycle = lifecycle(survivingOwner);
       const survivingChildLifecycle = lifecycle(survivingChild);
       const historicalSurvivorFailure = expectFailure(
         [survivingOwner],
         [audit(survivingOwner, [survivingChild]), audit(survivingChild)],
         [
           survivingOwnerLifecycle[0],
           survivingOwnerLifecycle[1],
           survivingChildLifecycle[0],
           survivingChildLifecycle[1],
           survivingOwnerLifecycle[2],
           survivingChildLifecycle[2],
         ],
         /child-owner-lifecycle-disjoint/u,
       );
       const extraAuditClaim = claim(3034);
       const extraAudit = audit(extraAuditClaim);
       extraAudit.unexplained = {};
       extraAudit.unexplained.self = extraAudit.unexplained;
       const extraAuditFailure = expectFailure(
         [extraAuditClaim],
         [extraAudit],
         lifecycle(extraAuditClaim),
         /audit-schema-invalid/u,
       );
       const extraOwnershipAudit = audit(extraAuditClaim);
       extraOwnershipAudit.workerOwnership.unexplained = [sensitiveValue];
       const extraAuditOwnershipFailure = expectFailure(
         [extraAuditClaim],
         [extraOwnershipAudit],
         lifecycle(extraAuditClaim),
         /audit-schema-invalid/u,
       );
       const deepAuditOwner = claim(3035);
       let deepParentPid = deepAuditOwner.pid;
       const deepAudits = [];
       for (let index = 0; index < 8000; index += 1) {
         const entry = {
           ...audit(deepAuditOwner),
           pid: 20000 + index,
           ppid: deepParentPid,
           nodeTestChild: true,
         };
         deepAudits.push(entry);
         deepParentPid = entry.pid;
       }
       const deepAuditLineage = measureWorkerOwnership({
         groupId,
         rootOwnerToken,
         rootOwnerPid: 100,
         directClaims: [deepAuditOwner],
         audits: [...deepAudits.reverse(), audit(deepAuditOwner)],
         lifecycleEvents: lifecycle(deepAuditOwner),
         platform: process.platform,
       });
       const missingFailure = expectFailure(
         [claim(3009)],
         [audit(claim(3009))],
         [],
         /claim-lifecycle-missing/u,
       );
       const conflict = claim(3010);
       const conflictEvents = lifecycle(conflict);
       conflictEvents[1] = { ...conflictEvents[1], pid: conflict.pid + 1 };
       const conflictFailure = expectFailure(
         [conflict],
         [audit(conflict)],
         conflictEvents,
         /lifecycle-identity-conflict/u,
       );
       const malformedFailure = expectFailure(
         [],
         [],
         [{ schemaVersion: 1, kind: 'worker-lifecycle', transition: 'settled' }],
         /lifecycle-schema-invalid/u,
       );
       const errorThenExit = claim(3011);
       const errorEvents = lifecycle(errorThenExit);
       errorEvents[2] = {
         ...errorEvents[2],
         transition: 'accounting-error',
         exitCode: null,
         errorCode: 'EFAIL',
       };
       errorEvents.push({ ...lifecycle(errorThenExit)[2] });
       const errorMaskingFailure = expectFailure(
         [],
         [],
         errorEvents,
         /lifecycle-transition-count-invalid/u,
       );
       process.stdout.write(JSON.stringify({
         windowsReuse,
         linuxReuse,
         largeCleanup,
         liveFour,
         liveFive,
         liveCleanupFailure,
         fiveFailure,
         orphanFailure,
         unownedFailure,
         ambiguousFailure,
         accountingFailure,
         forcedTermination,
         gracefulAuditMissingFailure,
         collisionFailure,
         temporalCollisionFailure,
         duplicateSnapshotFailure,
         invalidSignalFailure,
         synchronousOwnerKilledFailure,
         incompleteParentEvidenceFailure,
         missingParentSnapshotFailure,
         cyclicLineageFailure,
         cyclicAuditLineageFailure,
         boundedMalformedFailure,
         malformedTerminalFailures,
         rootPidFailure,
         snapshotProvenanceFailure,
         cyclicSnapshotFailure,
         oversizedExitFailure,
         cyclicInputFailure,
         reservedRootTokenFailure,
         reservedRootPidFailure,
         nestedDirectClaimFailure,
         historicalLineageFailure,
         historicalSurvivorFailure,
         extraAuditFailure,
         extraAuditOwnershipFailure,
         deepAuditLineageCount: deepAuditLineage.implicitlyOwnedSettledCount,
         missingFailure,
         conflictFailure,
         malformedFailure,
         errorMaskingFailure,
       }));`,
    ],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  type WorkerMetrics = {
    measuredWorkers: number;
    settledHistoricalCount: number;
    historicalPidReuseCount: number;
  };
  const evidence = JSON.parse(result.stdout) as {
    windowsReuse: WorkerMetrics;
    linuxReuse: WorkerMetrics;
    largeCleanup: WorkerMetrics;
    liveFour: WorkerMetrics;
    liveFive: WorkerMetrics;
    liveCleanupFailure: string;
    fiveFailure: string;
    orphanFailure: string;
    unownedFailure: string;
    ambiguousFailure: string;
    accountingFailure: string;
    forcedTermination: WorkerMetrics & { forcedTerminationCount: number };
    gracefulAuditMissingFailure: string;
    collisionFailure: string;
    temporalCollisionFailure: string;
    duplicateSnapshotFailure: string;
    invalidSignalFailure: string;
    synchronousOwnerKilledFailure: string;
    incompleteParentEvidenceFailure: string;
    missingParentSnapshotFailure: string;
    cyclicLineageFailure: string;
    cyclicAuditLineageFailure: string;
    boundedMalformedFailure: string;
    malformedTerminalFailures: string[];
    rootPidFailure: string;
    snapshotProvenanceFailure: string;
    cyclicSnapshotFailure: string;
    oversizedExitFailure: string;
    cyclicInputFailure: string;
    reservedRootTokenFailure: string;
    reservedRootPidFailure: string;
    nestedDirectClaimFailure: string;
    historicalLineageFailure: string;
    historicalSurvivorFailure: string;
    extraAuditFailure: string;
    extraAuditOwnershipFailure: string;
    deepAuditLineageCount: number;
    missingFailure: string;
    conflictFailure: string;
    malformedFailure: string;
    errorMaskingFailure: string;
  };
  for (const name of ["windowsReuse", "linuxReuse"] as const) {
    assert.equal(evidence[name].measuredWorkers, 0);
    assert.equal(evidence[name].settledHistoricalCount, 681);
    assert.ok(evidence[name].historicalPidReuseCount > 0);
  }
  assert.equal(evidence["largeCleanup"].measuredWorkers, 0);
  assert.equal(evidence["largeCleanup"].settledHistoricalCount, 2000);
  assert.equal(evidence["liveFour"].measuredWorkers, 4);
  assert.equal(evidence["liveFive"].measuredWorkers, 5);
  assert.match(
    evidence["liveCleanupFailure"],
    /runtime-durable-residue-detected:workers:.*"maximum":4.*"measured":4.*"liveOwnedEvidence":\[/u,
  );
  assert.match(
    evidence["fiveFailure"],
    /resource-ceiling-exceeded:workers:.*"maximum":4.*"measured":5.*"liveOwnedEvidence":\[.*"ownershipEvidenceSha256":"[0-9a-f]{64}"/u,
  );
  assert.match(evidence["orphanFailure"], /orphan-child/u);
  assert.match(evidence["unownedFailure"], /unowned-child/u);
  assert.match(evidence["ambiguousFailure"], /ambiguous-ownership/u);
  assert.match(evidence["accountingFailure"], /accounting-error/u);
  assert.equal(evidence["forcedTermination"].measuredWorkers, 0);
  assert.equal(evidence["forcedTermination"].forcedTerminationCount, 1);
  assert.match(evidence["gracefulAuditMissingFailure"], /graceful-settlement-audit-missing/u);
  assert.match(evidence["collisionFailure"], /simultaneous-live-pid-collision/u);
  assert.match(evidence["temporalCollisionFailure"], /pid-lifecycle-overlap/u);
  assert.match(evidence["duplicateSnapshotFailure"], /claim-snapshot-duplicate/u);
  assert.match(evidence["invalidSignalFailure"], /lifecycle-schema-invalid/u);
  assert.match(evidence["synchronousOwnerKilledFailure"], /orphan-child/u);
  assert.match(evidence["incompleteParentEvidenceFailure"], /parent-claim-transition-missing/u);
  assert.match(evidence["missingParentSnapshotFailure"], /parent-claim-snapshot-missing/u);
  assert.match(evidence["cyclicLineageFailure"], /ownership-lineage-cycle/u);
  assert.match(evidence["cyclicAuditLineageFailure"], /implicit-audit-lineage-cycle/u);
  assert.ok(evidence["boundedMalformedFailure"].length <= 4096);
  assert.equal(evidence["malformedTerminalFailures"].length, 6);
  for (const failure of evidence["malformedTerminalFailures"]) {
    assert.match(failure, /lifecycle-schema-invalid/u);
    assert.ok(failure.length <= 4096);
  }
  assert.match(evidence["rootPidFailure"], /root-owner-pid-conflict/u);
  assert.match(evidence["snapshotProvenanceFailure"], /claim-containing-audit-owner-conflict/u);
  assert.match(evidence["cyclicSnapshotFailure"], /claim-schema-invalid/u);
  assert.match(evidence["oversizedExitFailure"], /lifecycle-schema-invalid/u);
  assert.match(evidence["cyclicInputFailure"], /worker-accounting-invalid:schema-invalid/u);
  assert.match(evidence["reservedRootTokenFailure"], /lifecycle-schema-invalid/u);
  assert.match(evidence["reservedRootPidFailure"], /lifecycle-schema-invalid/u);
  assert.match(evidence["nestedDirectClaimFailure"], /direct-claim-owner-conflict/u);
  assert.match(evidence["historicalLineageFailure"], /child-owner-lifecycle-disjoint/u);
  assert.match(evidence["historicalSurvivorFailure"], /child-owner-lifecycle-disjoint/u);
  assert.match(evidence["extraAuditFailure"], /audit-schema-invalid/u);
  assert.match(evidence["extraAuditOwnershipFailure"], /audit-schema-invalid/u);
  assert.equal(evidence["deepAuditLineageCount"], 8000);
  assert.match(evidence["missingFailure"], /claim-lifecycle-missing/u);
  assert.match(evidence["conflictFailure"], /lifecycle-identity-conflict/u);
  assert.match(evidence["malformedFailure"], /lifecycle-schema-invalid/u);
  assert.match(evidence["errorMaskingFailure"], /lifecycle-transition-count-invalid/u);
});

test("network denial records settled owned children on the current process platform", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-worker-accounting-"));
  try {
    const auditPath = join(directory, "audit.jsonl");
    const lifecyclePath = join(directory, "lifecycle.jsonl");
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { spawn, spawnSync } from 'node:child_process';
         const synchronous = spawnSync(process.execPath, ['-e', ''], {
           windowsHide: true,
           stdio: 'ignore',
         });
         if (synchronous.status !== 0) throw new Error('synthetic-sync-child-failed');
         await new Promise((resolvePromise, rejectPromise) => {
           const child = spawn(process.execPath, ['-e', ''], {
             windowsHide: true,
             stdio: 'ignore',
           });
           child.once('error', rejectPromise);
           child.once('exit', (code, signal) => {
             if (code === 0 && signal === null) resolvePromise();
             else rejectPromise(new Error('synthetic-async-child-failed'));
           });
         });
         process.stdout.write(JSON.stringify({
           platform: process.platform,
           ownership: globalThis.__PEAS_NETWORK_DENIAL__.workerOwnership(),
         }));`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
          PEAS_NETWORK_DENIAL_INHERITED: "1",
          PEAS_NETWORK_DENIAL_AUDIT_PATH: auditPath,
          PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH: lifecyclePath,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      platform: string;
      ownership: { claims: Array<Record<string, unknown>> };
    };
    assert.equal(output.platform, process.platform);
    assert.equal(output.ownership.claims.length, 2);
    assert.ok(output.ownership.claims.every(({ state }) => state === "settled"));
    assert.equal(new Set(output.ownership.claims.map(({ childToken }) => childToken)).size, 2);
    const audits = readFileSync(auditPath, "utf8")
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(audits.length, 3);
    assert.ok(
      audits.every(
        (audit) =>
          typeof audit["workerOwnership"] === "object" && Array.isArray(audit["ownedChildClaims"]),
      ),
    );
    const lifecycleEvents = readFileSync(lifecyclePath, "utf8")
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(lifecycleEvents.length, 8);
    assert.equal(
      lifecycleEvents.filter(({ transition }) => transition === "spawn-intent").length,
      2,
    );
    assert.equal(
      lifecycleEvents.filter(({ transition }) => transition === "child-started").length,
      2,
    );
    assert.equal(lifecycleEvents.filter(({ transition }) => transition === "claimed").length, 2);
    assert.equal(lifecycleEvents.filter(({ transition }) => transition === "settled").length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("681 sequential provider-free children leave no live worker residue", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-worker-sequential-"));
  try {
    const auditPath = join(directory, "audit.jsonl");
    const lifecyclePath = join(directory, "lifecycle.jsonl");
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { spawnSync } from 'node:child_process';
         import { readFileSync } from 'node:fs';
         import { measureWorkerOwnership } from './scripts/local-validation/worker-accounting.mjs';
         for (let index = 0; index < 681; index += 1) {
           const child = spawnSync(process.execPath, ['-e', ''], {
             windowsHide: true,
             stdio: 'ignore',
           });
           if (child.status !== 0) throw new Error('sequential-child-failed:' + index);
         }
         const ownership = globalThis.__PEAS_NETWORK_DENIAL__.workerOwnership();
         const lifecycleEvents = readFileSync(process.env.PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH, 'utf8')
           .trim().split(/\\r?\\n/u).map(JSON.parse);
         const audits = readFileSync(process.env.PEAS_NETWORK_DENIAL_AUDIT_PATH, 'utf8')
           .trim().split(/\\r?\\n/u).map(JSON.parse);
         const measured = measureWorkerOwnership({
           groupId: ownership.groupId,
           rootOwnerToken: ownership.token,
           rootOwnerPid: ownership.pid,
           directClaims: ownership.claims,
           audits,
           lifecycleEvents,
           platform: process.platform,
         });
         process.stdout.write(JSON.stringify({
           claimCount: ownership.claims.length,
           lifecycleEventCount: lifecycleEvents.length,
           auditCount: audits.length,
           measured,
         }));`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        timeout: 300_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
          PEAS_NETWORK_DENIAL_INHERITED: "1",
          PEAS_NETWORK_DENIAL_AUDIT_PATH: auditPath,
          PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH: lifecyclePath,
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const output = JSON.parse(result.stdout) as {
      claimCount: number;
      lifecycleEventCount: number;
      auditCount: number;
      measured: {
        measuredWorkers: number;
        settledHistoricalCount: number;
        accountingErrorCount: number;
      };
    };
    assert.equal(output.claimCount, 681);
    assert.equal(output.lifecycleEventCount, 681 * 4);
    assert.equal(output.auditCount, 681);
    assert.equal(output.measured.measuredWorkers, 0);
    assert.equal(output.measured.settledHistoricalCount, 681);
    assert.equal(output.measured.accountingErrorCount, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("parent lifecycle evidence survives SIGKILL or Windows forced termination", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-worker-forced-"));
  try {
    const auditPath = join(directory, "audit.jsonl");
    const lifecyclePath = join(directory, "lifecycle.jsonl");
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { spawn } from 'node:child_process';
         import { readFileSync } from 'node:fs';
         import { measureWorkerOwnership } from './scripts/local-validation/worker-accounting.mjs';
         const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
           windowsHide: true,
           stdio: 'ignore',
         });
         await new Promise((resolvePromise, rejectPromise) => {
           child.once('spawn', resolvePromise);
           child.once('error', rejectPromise);
         });
         child.kill('SIGKILL');
         await new Promise((resolvePromise) => child.once('exit', resolvePromise));
         const ownership = globalThis.__PEAS_NETWORK_DENIAL__.workerOwnership();
         const lifecycleEvents = readFileSync(process.env.PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH, 'utf8')
           .trim().split(/\\r?\\n/u).map(JSON.parse);
         const measured = measureWorkerOwnership({
           groupId: ownership.groupId,
           rootOwnerToken: ownership.token,
           rootOwnerPid: ownership.pid,
           directClaims: ownership.claims,
           audits: [],
           lifecycleEvents,
           platform: process.platform,
         });
         process.stdout.write(JSON.stringify({ ownership, lifecycleEvents, measured }));`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
          PEAS_NETWORK_DENIAL_INHERITED: "1",
          PEAS_NETWORK_DENIAL_AUDIT_PATH: auditPath,
          PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH: lifecyclePath,
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const output = JSON.parse(result.stdout) as {
      ownership: { claims: Array<{ childToken: string; state: string; signalCode: string }> };
      lifecycleEvents: Array<{ transition: string; signalCode: string | null }>;
      measured: { measuredWorkers: number; forcedTerminationCount: number };
    };
    assert.equal(output.ownership.claims.length, 1);
    assert.equal(output.ownership.claims[0]?.state, "settled");
    assert.equal(typeof output.ownership.claims[0]?.signalCode, "string");
    assert.equal(
      output.lifecycleEvents.filter(({ transition }) => transition === "spawn-intent").length,
      1,
    );
    assert.equal(
      output.lifecycleEvents.filter(({ transition }) => transition === "claimed").length,
      1,
    );
    assert.equal(
      output.lifecycleEvents.filter(({ transition }) => transition === "settled").length,
      1,
    );
    assert.equal(output.measured.measuredWorkers, 0);
    assert.equal(output.measured.forcedTerminationCount, 1);
    const audits = readFileSync(auditPath, "utf8")
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as { workerOwnership: { token: string } });
    assert.ok(
      audits.every(
        ({ workerOwnership }) => workerOwnership.token !== output.ownership.claims[0]?.childToken,
      ),
      "the forcibly terminated child must not be credited with an exit audit",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("forcibly terminated parents expose live descendants as genuine orphans", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-worker-orphan-"));
  try {
    const auditPath = join(directory, "audit.jsonl");
    const lifecyclePath = join(directory, "lifecycle.jsonl");
    const spoofPreload = join(directory, "spoof-network-deny.cjs");
    writeFileSync(spoofPreload, '"use strict";\n', "utf8");
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        "--input-type=module",
        "-e",
        `import { spawn } from 'node:child_process';
         import { readFileSync } from 'node:fs';
         import { measureWorkerOwnership } from './scripts/local-validation/worker-accounting.mjs';
         const parentProgram = \`import { spawn } from 'node:child_process';
           if (globalThis.__PEAS_NETWORK_DENIAL__?.boundary !== 'node-process-capability-closure-v2' ||
               process.env.NODE_OPTIONS.includes('spoof-network-deny.cjs')) {
             throw new Error('authoritative-preload-not-inherited');
           }
           const descendantProgram = "if (globalThis.__PEAS_NETWORK_DENIAL__?.boundary !== 'node-process-capability-closure-v2' || process.env.NODE_OPTIONS.includes('spoof-network-deny.cjs')) throw new Error('descendant-authoritative-preload-missing'); setInterval(() => {}, 1000);";
           const stripped = spawn(process.execPath, ['-e', descendantProgram], {
             windowsHide: true,
             stdio: 'ignore',
             env: {},
           });
           const spoofed = spawn(process.execPath, ['-e', descendantProgram], {
             windowsHide: true,
             stdio: 'ignore',
             env: {
               NODE_OPTIONS: '--no-warnings',
               PEAS_NETWORK_DENIAL_INHERITED: '0',
               PEAS_NETWORK_DENIAL_AUDIT_PATH: 'spoof-audit',
               PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH: 'spoof-lifecycle',
             },
           });
           let spawned = 0;
           const report = () => {
             spawned += 1;
             if (spawned === 2) process.stdout.write(JSON.stringify([stripped.pid, spoofed.pid]) + '\\\\n');
           };
           stripped.once('spawn', report);
           spoofed.once('spawn', report);
           setInterval(() => {}, 1000);\`;
         const parent = spawn(process.execPath, ['--input-type=module', '-e', parentProgram], {
           windowsHide: true,
           stdio: ['ignore', 'pipe', 'inherit'],
           env: {
             PEAS_NETWORK_DENIAL_AUDIT_PATH: process.env.PEAS_NETWORK_DENIAL_AUDIT_PATH,
             PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH: process.env.PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH,
           },
         });
         let grandchildPids;
         await new Promise((resolvePromise, rejectPromise) => {
           let stdout = '';
           parent.stdout.setEncoding('utf8').on('data', (chunk) => {
             stdout += chunk;
             const line = stdout.match(/^(\\[\\d+,\\d+\\])\\r?\\n/u);
             if (line) { grandchildPids = JSON.parse(line[1]); resolvePromise(); }
           });
           parent.once('error', rejectPromise);
         });
         parent.kill('SIGKILL');
         await new Promise((resolvePromise) => parent.once('exit', resolvePromise));
         const ownership = globalThis.__PEAS_NETWORK_DENIAL__.workerOwnership();
         const lifecycleEvents = readFileSync(process.env.PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH, 'utf8')
           .trim().split(/\\r?\\n/u).map(JSON.parse);
         let failure = '';
         try {
           measureWorkerOwnership({
             groupId: ownership.groupId,
             rootOwnerToken: ownership.token,
             rootOwnerPid: ownership.pid,
             directClaims: ownership.claims,
             audits: [],
             lifecycleEvents,
             platform: process.platform,
           });
         } catch (error) {
           failure = error instanceof Error ? error.message : String(error);
         } finally {
           for (const grandchildPid of grandchildPids) {
             try { process.kill(grandchildPid, 'SIGKILL'); }
             catch (error) { if (error?.code !== 'ESRCH') throw error; }
           }
         }
         process.stdout.write(JSON.stringify({ failure, grandchildPids, lifecycleEvents }));`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${JSON.stringify(spoofPreload)}`,
          PEAS_NETWORK_DENIAL_INHERITED: "1",
          PEAS_NETWORK_DENIAL_AUDIT_PATH: auditPath,
          PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH: lifecyclePath,
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const output = JSON.parse(result.stdout) as {
      failure: string;
      grandchildPids: number[];
      lifecycleEvents: Array<{ transition: string }>;
    };
    assert.equal(output.grandchildPids.length, 2);
    assert.ok(output.grandchildPids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
    assert.match(output.failure, /worker-accounting-invalid:orphan-child/u);
    assert.equal(
      output.lifecycleEvents.filter(({ transition }) => transition === "spawn-intent").length,
      3,
    );
    assert.equal(
      output.lifecycleEvents.filter(({ transition }) => transition === "claimed").length,
      3,
    );
    assert.equal(
      output.lifecycleEvents.filter(({ transition }) => transition === "settled").length,
      1,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an asynchronous error cannot be overwritten by a later exit", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-worker-error-"));
  try {
    const auditPath = join(directory, "audit.jsonl");
    const lifecyclePath = join(directory, "lifecycle.jsonl");
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { spawn } from 'node:child_process';
         import { readFileSync } from 'node:fs';
         const controller = new AbortController();
         const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
           windowsHide: true,
           stdio: 'ignore',
           signal: controller.signal,
         });
         await new Promise((resolvePromise, rejectPromise) => {
           child.once('spawn', resolvePromise);
           child.once('error', rejectPromise);
         });
         const events = [];
         child.on('error', (error) => events.push(['error', error.code]));
         child.on('exit', (code, signal) => events.push(['exit', code, signal]));
         controller.abort();
         await new Promise((resolvePromise) => child.once('close', resolvePromise));
         const ownership = globalThis.__PEAS_NETWORK_DENIAL__.workerOwnership();
         const lifecycleEvents = readFileSync(process.env.PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH, 'utf8')
           .trim().split(/\\r?\\n/u).map(JSON.parse);
         process.stdout.write(JSON.stringify({ events, ownership, lifecycleEvents }));`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
          PEAS_NETWORK_DENIAL_INHERITED: "1",
          PEAS_NETWORK_DENIAL_AUDIT_PATH: auditPath,
          PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH: lifecyclePath,
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const output = JSON.parse(result.stdout) as {
      events: Array<[string, unknown, unknown?]>;
      ownership: { claims: Array<{ state: string; errorCode: string }> };
      lifecycleEvents: Array<{ transition: string }>;
    };
    assert.ok(output.events.some(([name]) => name === "error"));
    assert.ok(output.events.some(([name]) => name === "exit"));
    assert.equal(output.ownership.claims[0]?.state, "accounting-error");
    assert.equal(typeof output.ownership.claims[0]?.errorCode, "string");
    assert.equal(
      output.lifecycleEvents.filter(({ transition }) => transition === "spawn-intent").length,
      1,
    );
    assert.equal(
      output.lifecycleEvents.filter(({ transition }) => transition === "claimed").length,
      1,
    );
    assert.equal(
      output.lifecycleEvents.filter(({ transition }) => transition === "accounting-error").length,
      1,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime worker accounting closes a token-bound nested process graph", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-worker-runtime-"));
  try {
    const sourcePath = "test/fixtures/local-validation-worker-accounting-case.test.ts";
    const sourceBytes = readFileSync(sourcePath);
    const caseEntry = {
      id: "lv-v1-999-0000000000000000",
      expectedTerminalDisposition: "executable-assertions-passed",
      fixture: {
        path: sourcePath,
        sha256: sha256(sourceBytes),
        sizeBytes: sourceBytes.byteLength,
      },
      executable: {
        sourcePath,
        compiledPath: "dist/test/fixtures/local-validation-worker-accounting-case.test.js",
        testName: "synthetic token-bound child graph settles completely",
        nodeTestNamePattern: "^synthetic token-bound child graph settles completely$",
      },
    };
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { verifyFrozenManifest } from './scripts/local-validation/contract.mjs';
         import {
           executeSyntheticMatrix,
           provisionValidationRuntime,
         } from './scripts/local-validation/runtime.mjs';
         const { manifest } = verifyFrozenManifest();
         const syntheticManifest = {
           ...manifest,
           caseCount: 1,
           cases: [${JSON.stringify(caseEntry)}],
           restartBindings: [],
           permutationBindings: [],
           durableCheckpointPrefixes: [],
         };
         provisionValidationRuntime(process.argv[1], ${JSON.stringify(checkoutIdentity)});
         const result = await executeSyntheticMatrix(process.argv[1], syntheticManifest, {
           limit: 1,
           candidateAttestation: ${JSON.stringify(checkoutAttestation)},
         });
         process.stdout.write(JSON.stringify({
           status: result.status,
           executedCaseCount: result.executedCaseCount,
           executionCount: result.executionCount,
           resources: result.resources,
           cleanup: result.cleanup,
           workerOwnership: result.workerOwnership,
           activeHandleKinds: typeof process._getActiveHandles === 'function'
             ? process._getActiveHandles().map((handle) => handle?.constructor?.name ?? 'Unknown')
             : [],
         }));`,
        directory,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
          PEAS_NETWORK_DENIAL_INHERITED: "1",
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const output = JSON.parse(result.stdout) as {
      status: string;
      executedCaseCount: number;
      executionCount: number;
      resources: { workers: number };
      cleanup: { workers: number; orphanProcesses: number; extraHandles: number };
      workerOwnership: {
        measuredWorkers: number;
        settledHistoricalCount: number;
        auditCount: number;
      };
      activeHandleKinds: string[];
    };
    assert.equal(output.status, "passed");
    assert.equal(output.executedCaseCount, 1);
    assert.equal(output.executionCount, 1);
    assert.equal(output.resources.workers, 0);
    assert.equal(output.cleanup.workers, 0);
    assert.equal(output.cleanup.orphanProcesses, 0);
    assert.equal(output.cleanup.extraHandles, 0, JSON.stringify(output.activeHandleKinds));
    assert.equal(output.workerOwnership.measuredWorkers, 0);
    assert.ok(output.workerOwnership.settledHistoricalCount >= 3);
    assert.equal(output.workerOwnership.auditCount, output.workerOwnership.settledHistoricalCount);
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
    const executionOptions = {
      preload: true,
      env: { PEAS_NETWORK_DENIAL_INHERITED: "1" },
    } as const;
    const child = runProbe(["execute", directory], executionOptions);
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

    const credentialEffect = runProbe(["execute-credential-effect", directory], executionOptions);
    assert.notEqual(credentialEffect.status, 0);
    assert.match(credentialEffect.stderr, /effects-ceiling-exceeded:/u);

    const residue = runProbe(["execute-residue", directory], executionOptions);
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
