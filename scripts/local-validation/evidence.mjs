import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

import {
  MANIFEST_DIGEST_PATH,
  MATRIX_PATH,
  acquireGateLock,
  canonicalBytes,
  listFiles,
  platformIdentity,
  readJson,
  sha256,
  verifyCandidate,
  verifyFrozenManifest,
} from "./contract.mjs";

const action = process.argv[2];
const npmCliPath = process.env.npm_execpath;
if (action === "bundle" && (npmCliPath === undefined || npmCliPath.trim() === "")) {
  throw new Error("npm-cli-identity-required");
}

const commandPlan = Object.freeze([
  ["manifest", ["run", "manifest:local-validation"]],
  ["integration", ["run", "gate:integration"]],
  ["format", ["run", "format:check"]],
  ["lint", ["run", "lint"]],
  ["typecheck", ["run", "typecheck"]],
  ["build", ["run", "build"]],
  ["unit-integration-restart", ["run", "test"]],
  ["coverage", ["run", "test:coverage"]],
  ["reconciliation", ["run", "test:evidence-reconciliation"]],
  ["mutation", ["run", "test:mutation"]],
  ["hard-kill", ["run", "test:hard-kill"]],
  ["scale", ["run", "test:scale"]],
  ["unchanged-check", ["run", "check"]],
]);

function migrationIdentity() {
  return listFiles(resolve("migrations"));
}

function bundle() {
  const identity = verifyCandidate();
  const { manifest, digest } = verifyFrozenManifest();
  const outputRoot = resolve(
    process.env.PEAS_LOCAL_VALIDATION_EVIDENCE_ROOT ??
      join(dirname(process.cwd()), "local-validation-evidence", identity.sha),
  );
  const outputToRepository = relative(outputRoot, resolve(process.cwd()));
  if (
    outputRoot === resolve(process.cwd()) ||
    (outputToRepository !== ".." && !outputToRepository.startsWith(`..${sep}`))
  ) {
    throw new Error("evidence-output-root-unsafe");
  }
  const lock = acquireGateLock(join(dirname(outputRoot), "evidence-bundle.v1.lock"));
  try {
    if (existsSync(outputRoot)) throw new Error("evidence-output-root-already-exists");
    mkdirSync(join(outputRoot, "commands"), { recursive: true });
    const commands = [];
    for (const [name, args] of commandPlan) {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      const child = spawnSync(process.execPath, [npmCliPath, ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          PEAS_LOCAL_VALIDATION_CANDIDATE_SHA: identity.sha,
          PEAS_LOCAL_VALIDATION_CANDIDATE_TREE: identity.tree,
        },
        timeout: 60 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });
      const transcriptPath = `commands/${name}.log`;
      writeFileSync(
        join(outputRoot, transcriptPath),
        `command: npm ${args.join(" ")}\nnpmCliPath: ${npmCliPath}\nstartedAt: ${startedAt}\nexitCode: ${String(child.status)}\n--- stdout ---\n${child.stdout ?? ""}\n--- stderr ---\n${child.stderr ?? ""}\n`,
        "utf8",
      );
      commands.push({
        name,
        command: `npm ${args.join(" ")}`,
        exitCode: child.status,
        signal: child.signal,
        spawnError: child.error?.message ?? null,
        elapsedMs: Math.ceil(performance.now() - started),
        transcriptPath,
      });
      if (child.status !== 0) break;
    }
    const allPassed =
      commands.length === commandPlan.length && commands.every((item) => item.exitCode === 0);
    const packageLockBytes = readFileSync("package-lock.json");
    const matrixBytes = readFileSync(MATRIX_PATH);
    const manifestDigestBytes = readFileSync(MANIFEST_DIGEST_PATH);
    const report = {
      schemaVersion: 1,
      kind: "peas-local-validation-automation-evidence",
      decision: allPassed ? "GO" : "NO_GO",
      corpusExecuted: false,
      corpusAuthorizationRequired: true,
      candidate: identity,
      manifest: {
        id: manifest.manifestId,
        caseCount: manifest.caseCount,
        sha256: digest,
        digestFileSha256: sha256(manifestDigestBytes),
      },
      inputs: {
        matrix: { path: MATRIX_PATH, sha256: sha256(matrixBytes) },
        packageLock: { path: "package-lock.json", sha256: sha256(packageLockBytes) },
        migrations: migrationIdentity(),
      },
      platform: platformIdentity(),
      commands,
      effects: {
        network: 0,
        provider: 0,
        credential: 0,
        account: 0,
        broker: 0,
        order: 0,
        portfolio: 0,
        position: 0,
        fill: 0,
        spending: 0,
        financialEffect: 0,
      },
    };
    writeFileSync(join(outputRoot, "automation-report.json"), canonicalBytes(report), "utf8");
    const inventory = listFiles(outputRoot);
    const bundleManifest = {
      schemaVersion: 1,
      decision: report.decision,
      candidate: identity,
      inventory,
      inventorySha256: sha256(canonicalBytes(inventory)),
    };
    const bundleManifestBytes = canonicalBytes(bundleManifest);
    writeFileSync(join(outputRoot, "bundle-manifest.json"), bundleManifestBytes, "utf8");
    writeFileSync(
      join(outputRoot, "bundle-manifest.sha256"),
      `${sha256(bundleManifestBytes)}  bundle-manifest.json\n`,
      "utf8",
    );
    process.stdout.write(
      `${JSON.stringify({ decision: report.decision, evidenceRoot: outputRoot, bundleSha256: sha256(bundleManifestBytes) })}\n`,
    );
    if (!allPassed) process.exitCode = 1;
  } finally {
    lock.release();
  }
}

function verify() {
  const configuredRoot = process.env.PEAS_LOCAL_VALIDATION_EVIDENCE_ROOT;
  if (configuredRoot === undefined || configuredRoot.trim() === "") {
    throw new Error("evidence-root-required");
  }
  const root = resolve(configuredRoot);
  const bundleManifestBytes = readFileSync(join(root, "bundle-manifest.json"));
  const recorded = readFileSync(join(root, "bundle-manifest.sha256"), "utf8").trim();
  const digest = sha256(bundleManifestBytes);
  if (recorded !== `${digest}  bundle-manifest.json`)
    throw new Error("evidence-root-digest-mismatch");
  const manifest = JSON.parse(bundleManifestBytes.toString("utf8"));
  const actual = listFiles(root).filter(
    ({ path }) => path !== "bundle-manifest.json" && path !== "bundle-manifest.sha256",
  );
  if (canonicalBytes(actual) !== canonicalBytes(manifest.inventory)) {
    throw new Error("evidence-inventory-tamper-detected");
  }
  if (sha256(canonicalBytes(actual)) !== manifest.inventorySha256) {
    throw new Error("evidence-inventory-digest-mismatch");
  }
  const report = readJson(join(root, "automation-report.json"));
  if (report.decision !== manifest.decision || report.corpusExecuted !== false) {
    throw new Error("evidence-decision-invalid");
  }
  process.stdout.write(
    `${JSON.stringify({ decision: manifest.decision, bundleSha256: digest })}\n`,
  );
  if (manifest.decision !== "GO") process.exitCode = 1;
}

if (action === "bundle") bundle();
else if (action === "verify") verify();
else throw new Error("evidence-action-invalid");
