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
  repositoryIdentity,
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

function lastJsonLine(text) {
  for (const line of String(text ?? "")
    .trim()
    .split(/\r?\n/u)
    .reverse()) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  throw new Error("integration-proof-json-missing");
}

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
    const integrationCommand = commands.find(({ name }) => name === "integration");
    const integrationTranscript = readFileSync(
      join(outputRoot, integrationCommand.transcriptPath),
      "utf8",
    );
    const integrationProof = lastJsonLine(
      integrationTranscript.split("--- stdout ---\n")[1]?.split("--- stderr ---\n")[0],
    );
    if (integrationProof.decision !== "GO" || integrationProof.result?.status !== "passed") {
      throw new Error("integration-proof-invalid");
    }
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
      integrationProof,
      effects: integrationProof.result.effects,
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
  const identity = repositoryIdentity();
  const { manifest: frozenManifest, digest: manifestDigest } = verifyFrozenManifest();
  const requiredNames = commandPlan.map(([name]) => name);
  const actualNames = report.commands?.map(({ name }) => name);
  const completeCommands =
    canonicalBytes(actualNames) === canonicalBytes(requiredNames) &&
    report.commands.every(
      (entry, index) =>
        entry.command === `npm ${commandPlan[index][1].join(" ")}` &&
        entry.exitCode === 0 &&
        entry.signal === null &&
        entry.spawnError === null &&
        entry.transcriptPath === `commands/${entry.name}.log`,
    );
  const transcriptsExact = report.commands?.every((entry) => {
    const transcript = readFileSync(join(root, entry.transcriptPath), "utf8");
    return (
      transcript.startsWith(`command: ${entry.command}\n`) &&
      transcript.includes(`exitCode: ${entry.exitCode}\n`)
    );
  });
  const effects = report.effects ?? {};
  const expectedEffectNames = Object.keys(frozenManifest.effectsCeilings);
  const zeroEffects =
    canonicalBytes(Object.keys(effects).sort()) === canonicalBytes(expectedEffectNames.sort()) &&
    Object.values(effects).every((value) => value === 0);
  const candidateExact =
    report.candidate?.sha === identity.sha &&
    report.candidate?.tree === identity.tree &&
    identity.status === "" &&
    canonicalBytes(report.candidate) === canonicalBytes(manifest.candidate);
  const inputsExact =
    report.manifest?.sha256 === manifestDigest &&
    report.manifest?.caseCount === frozenManifest.caseCount &&
    report.inputs?.matrix?.sha256 === sha256(readFileSync(MATRIX_PATH)) &&
    report.inputs?.packageLock?.sha256 === sha256(readFileSync("package-lock.json")) &&
    canonicalBytes(report.inputs?.migrations) === canonicalBytes(migrationIdentity());
  const integrationExact =
    report.integrationProof?.decision === "GO" &&
    report.integrationProof?.result?.status === "passed" &&
    report.integrationProof?.result?.executedCaseCount === 2 &&
    canonicalBytes(report.integrationProof?.result?.effects) === canonicalBytes(effects);
  if (
    report.decision !== manifest.decision ||
    report.decision !== "GO" ||
    report.corpusExecuted !== false ||
    report.corpusAuthorizationRequired !== true ||
    !completeCommands ||
    !transcriptsExact ||
    !zeroEffects ||
    !candidateExact ||
    !inputsExact ||
    !integrationExact ||
    canonicalBytes(report.platform) !== canonicalBytes(platformIdentity())
  ) {
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
