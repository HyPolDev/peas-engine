import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const probe = "test/fixtures/local-validation-probe.mjs";
const preload = resolve("scripts/local-validation/network-deny.cjs");

function runProbe(args: readonly string[], options: { preload?: boolean } = {}) {
  return spawnSync(
    process.execPath,
    [...(options.preload === true ? ["--require", preload] : []), probe, ...args],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
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

test("the frozen local-validation manifest compiles deterministically with 200+ unique cases", () => {
  const first = runProbe(["manifest"]);
  const second = runProbe(["manifest"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  const result = JSON.parse(first.stdout) as { count: number; digest: string };
  assert.equal(result.count, 216);
  assert.match(result.digest, /^[0-9a-f]{64}$/u);
  const manifest = JSON.parse(readFileSync("config/local-validation/manifest.v1.json", "utf8")) as {
    cases: Array<{ id: string; fixture: { sha256: string } }>;
    durableCheckpointPrefixes: string[];
    hardKillPoints: string[];
  };
  assert.equal(new Set(manifest.cases.map(({ id }) => id)).size, 216);
  assert.ok(manifest.cases.every(({ fixture }) => /^[0-9a-f]{64}$/u.test(fixture.sha256)));
  assert.equal(manifest.durableCheckpointPrefixes.length, 20);
  assert.equal(manifest.hardKillPoints.length, 12);
});

test("gate locking rejects overlap and recovers only a dead expired owner", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-lock-"));
  try {
    const path = join(directory, "gate.lock");
    const overlap = runProbe(["lock-overlap", path]);
    assert.notEqual(overlap.status, 0);
    assert.match(overlap.stderr, /local-validation-gate-overlap/u);
    assert.equal(existsSync(path), false);
    const stale = runProbe(["lock-stale", path]);
    assert.equal(stale.status, 0, stale.stderr);
    assert.equal(stale.stdout.trim(), "recovered");
    assert.equal(existsSync(path), false);
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    assert.deepEqual(new Set(Object.values(result.effects)), new Set([0]));
    assert.deepEqual(new Set(Object.values(result.cleanup)), new Set([0]));
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
      executableHardKillCaseCount: number;
      results: Array<{ exitCode: number; testName: string }>;
    };
    assert.equal(result.status, "passed");
    assert.equal(result.executableHardKillCaseCount, 1);
    assert.ok(
      result.results.every(
        ({ exitCode, testName }) => exitCode === 0 && /hard.kill/iu.test(testName),
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
