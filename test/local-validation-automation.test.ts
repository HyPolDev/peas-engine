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
    const absent = runProbe(["execute", directory]);
    assert.notEqual(absent.status, 0);
    assert.match(absent.stderr, /outbound-network-denial-not-installed/u);
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory);
    const denied = spawnSync(
      process.execPath,
      ["--require", preload, "-e", "fetch('https://example.invalid')"],
      { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
    );
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /peas-outbound-network-denied/u);
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(corrupt, { recursive: true, force: true });
  }
});

test("memory and SQLite probes reconcile restarts, resources, orphans and exact zero effects", () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-lv-equivalence-"));
  try {
    const child = runProbe(["execute", directory], { preload: true });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout) as {
      executedCaseCount: number;
      checkpointExecutions: number;
      hardKillVectorsGenerated: number;
      sqliteIntegrity: string;
      effects: Record<string, number>;
      cleanup: Record<string, number>;
      caseResults: Array<{ memorySqliteEquivalent: boolean }>;
    };
    assert.equal(result.executedCaseCount, 2);
    assert.equal(result.checkpointExecutions, 40);
    assert.equal(result.hardKillVectorsGenerated, 24);
    assert.equal(result.sqliteIntegrity, "ok");
    assert.ok(result.caseResults.every(({ memorySqliteEquivalent }) => memorySqliteEquivalent));
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
      physicalKillCount: number;
      coveredVectorCount: number;
      results: Array<{ exit: { code: number | null; signal: string | null } }>;
    };
    assert.equal(result.status, "passed");
    assert.equal(result.physicalKillCount, 12);
    assert.equal(result.coveredVectorCount, 24);
    assert.ok(result.results.every(({ exit: { code, signal } }) => code !== 0 || signal !== null));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("evidence verification rejects changed and added files", () => {
  const root = mkdtempSync(join(tmpdir(), "peas-lv-evidence-"));
  try {
    writeFileSync(
      join(root, "automation-report.json"),
      canonicalBytes({ decision: "GO", corpusExecuted: false }),
      "utf8",
    );
    const reportBytes = readFileSync(join(root, "automation-report.json"));
    const inventory = [
      {
        path: "automation-report.json",
        sizeBytes: reportBytes.byteLength,
        sha256: sha256(reportBytes),
      },
    ];
    const manifestBytes = canonicalBytes({
      schemaVersion: 1,
      decision: "GO",
      candidate: { sha: "a".repeat(40), tree: "b".repeat(40), status: "" },
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
  assert.match(evidence, /process\.platform === "win32"/u);
  assert.match(gate, /windowsHide/u);
  assert.doesNotMatch(gate, /SIGKILL/u);
});
