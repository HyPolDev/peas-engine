import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, platform, release, tmpdir, type } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

export const MATRIX_PATH = "config/local-validation/matrix.v1.json";
export const MANIFEST_PATH = "config/local-validation/manifest.v1.json";
export const MANIFEST_DIGEST_PATH = "config/local-validation/manifest.v1.sha256";
export const AUTHORIZATION_VALUE = "EXECUTE_FROZEN_EFFECTS_DISABLED_LOCAL_VALIDATION_V1";
export const CREDENTIAL_ENVIRONMENT_NAMES = Object.freeze([
  "PEAS_ALPACA_API_KEY_ID",
  "PEAS_ALPACA_API_SECRET_KEY",
  "PEAS_FMP_API_KEY",
  "ALPACA_API_KEY",
  "ALPACA_SECRET_KEY",
  "FMP_API_KEY",
]);

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalize(value) {
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

export function canonicalBytes(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

export function repositoryIdentity(cwd = process.cwd()) {
  return Object.freeze({
    sha: git(cwd, "rev-parse", "HEAD"),
    tree: git(cwd, "rev-parse", "HEAD^{tree}"),
    status: git(cwd, "status", "--porcelain"),
  });
}

export function verifyCandidate(cwd = process.cwd(), environment = process.env) {
  const identity = repositoryIdentity(cwd);
  const expectedSha = environment.PEAS_LOCAL_VALIDATION_CANDIDATE_SHA;
  const expectedTree = environment.PEAS_LOCAL_VALIDATION_CANDIDATE_TREE;
  if (expectedSha === undefined || expectedTree === undefined) {
    throw new Error("candidate-identity-required");
  }
  if (identity.sha !== expectedSha) throw new Error("candidate-sha-mismatch");
  if (identity.tree !== expectedTree) throw new Error("candidate-tree-mismatch");
  if (identity.status !== "") throw new Error("candidate-worktree-dirty");
  return identity;
}

function deterministicNumber(seed, modulo) {
  return Number.parseInt(sha256(seed).slice(0, 12), 16) % modulo;
}

export function compileManifest(matrix) {
  if (matrix.schemaVersion !== 1 || matrix.categories.length * matrix.casesPerCategory < 200) {
    throw new Error("local-validation-matrix-invalid");
  }
  const cases = [];
  let ordinal = 0;
  for (const category of matrix.categories) {
    for (let variant = 0; variant < matrix.casesPerCategory; variant += 1) {
      ordinal += 1;
      const preimage = `${matrix.seed}:${category.id}:${variant}`;
      const fixture = {
        schemaVersion: 1,
        synthetic: true,
        source: "peas-original-synthetic-local-validation",
        category: category.id,
        variant,
        eventKey: sha256(`event:${preimage}`),
        artifactKey: sha256(`artifact:${preimage}`),
      };
      const fixtureBytes = canonicalBytes(fixture);
      cases.push({
        id: `lv-v1-${String(ordinal).padStart(3, "0")}-${category.id}-${String(variant + 1).padStart(2, "0")}`,
        identitySha256: sha256(`case:${preimage}`),
        category: category.id,
        expectedTerminalDisposition: category.disposition,
        fixture: {
          identity: fixture.artifactKey,
          sha256: sha256(fixtureBytes),
          sizeBytes: Buffer.byteLength(fixtureBytes),
          mediaType: "application/vnd.peas.synthetic+json",
        },
        deterministicSeed: sha256(`seed:${preimage}`),
        orderPermutation:
          matrix.orderPermutations[
            deterministicNumber(`order:${preimage}`, matrix.orderPermutations.length)
          ],
        pageSize:
          matrix.pageSizes[deterministicNumber(`page:${preimage}`, matrix.pageSizes.length)],
        duplicatePermutation: variant % 3 === 0 ? "redeliver-once" : "none",
        correctionPermutation: variant % 4 === 0 ? "correct-after-commit" : "none",
        terminalPermutation: variant % 2 === 0 ? "terminal-first" : "terminal-last",
        backends: ["memory", "sqlite"],
        restartPrefixes: matrix.durableCheckpointPrefixes,
      });
    }
  }
  return {
    schemaVersion: 1,
    manifestId: matrix.manifestId,
    corpusKind: "original-synthetic-software-validation",
    scientificStudy: false,
    providerAccessAuthorized: false,
    minimumCaseCount: matrix.minimumCaseCount,
    caseCount: cases.length,
    deterministicSeed: matrix.seed,
    sourceMatrix: { path: MATRIX_PATH, sha256: sha256(readFileSync(MATRIX_PATH)) },
    invariants: {
      firstBoot: "owned-explicit-first-boot-only-when-complete-runtime-layout-is-absent",
      authorityCorruption:
        "missing-authority-anchor-with-any-existing-primary-state-is-terminal-corruption",
      terminalDecision: ["LOCAL_TEST_GO", "LOCAL_TEST_NO_GO"],
      effectsDisabled: true,
    },
    orderPermutations: matrix.orderPermutations,
    pageSizes: matrix.pageSizes,
    durableCheckpointPrefixes: matrix.durableCheckpointPrefixes,
    hardKillPoints: matrix.hardKillPoints,
    resourceCeilings: matrix.resourceCeilings,
    resourceOneOverVectors: Object.fromEntries(
      Object.entries(matrix.resourceCeilings).map(([name, maximum]) => [name, maximum + 1]),
    ),
    effectsCeilings: matrix.effectsCeilings,
    cases,
  };
}

export function verifyFrozenManifest(cwd = process.cwd()) {
  const matrix = readJson(join(cwd, MATRIX_PATH));
  const compiled = canonicalBytes(compileManifest(matrix));
  const frozen = readFileSync(join(cwd, MANIFEST_PATH), "utf8");
  const recorded = readFileSync(join(cwd, MANIFEST_DIGEST_PATH), "utf8").trim();
  if (frozen !== compiled) throw new Error("local-validation-manifest-not-deterministic");
  const digest = sha256(frozen);
  if (recorded !== `${digest}  ${MANIFEST_PATH}`) {
    throw new Error("local-validation-manifest-digest-mismatch");
  }
  const manifest = JSON.parse(frozen);
  if (manifest.caseCount < manifest.minimumCaseCount || manifest.caseCount < 200) {
    throw new Error("local-validation-case-count-insufficient");
  }
  if (new Set(manifest.cases.map((entry) => entry.id)).size !== manifest.caseCount) {
    throw new Error("local-validation-case-identity-duplicate");
  }
  return Object.freeze({ manifest, digest });
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function acquireGateLock(lockPath, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? 6 * 60 * 60 * 1000;
  mkdirSync(dirname(lockPath), { recursive: true });
  try {
    const descriptor = openSync(lockPath, "wx");
    writeFileSync(
      descriptor,
      canonicalBytes({ schemaVersion: 1, pid: process.pid, createdAtMs: nowMs }),
    );
    closeSync(descriptor);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let existing;
    try {
      existing = readJson(lockPath);
    } catch {
      throw new Error("local-validation-gate-lock-corrupt");
    }
    if (processExists(existing.pid) || nowMs - existing.createdAtMs <= staleAfterMs) {
      throw new Error("local-validation-gate-overlap");
    }
    rmSync(lockPath);
    return acquireGateLock(lockPath, options);
  }
  let released = false;
  return Object.freeze({
    release() {
      if (released) return;
      released = true;
      rmSync(lockPath, { force: true });
    },
  });
}

export function assertCredentialAndAccountAbsence(environment = process.env) {
  const present = CREDENTIAL_ENVIRONMENT_NAMES.filter(
    (name) => typeof environment[name] === "string" && environment[name].length > 0,
  );
  if (present.length > 0)
    throw new Error(`credential-or-account-state-present:${present.join(",")}`);
  return Object.freeze({ checked: CREDENTIAL_ENVIRONMENT_NAMES, present: [] });
}

export function platformIdentity() {
  const packageJson = readJson("package.json");
  const sqlite = spawnSync(
    process.execPath,
    [
      "-e",
      "import('better-sqlite3').then(({default:D})=>{const d=new D(':memory:');console.log(d.prepare('select sqlite_version() v').get().v);d.close()})",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (sqlite.status !== 0) throw new Error(`sqlite-identity-unavailable:${sqlite.stderr}`);
  return Object.freeze({
    node: process.versions.node,
    npm: packageJson.engines.npm,
    sqlite: sqlite.stdout.trim(),
    platform: platform(),
    osType: type(),
    osRelease: release(),
    arch: arch(),
    logicalCpuCount: cpus().length,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    clockBasis: "performance.timeOrigin+performance.now; wall-time-diagnostic-only",
  });
}

export function listFiles(root) {
  const output = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error("evidence-symbolic-link-rejected");
      if (info.isDirectory()) visit(absolute);
      else if (info.isFile()) {
        output.push({
          path: relative(root, absolute).split(sep).join("/"),
          sizeBytes: info.size,
          sha256: sha256(readFileSync(absolute)),
        });
      } else throw new Error("evidence-non-regular-file-rejected");
    }
  }
  visit(resolve(root));
  return output;
}

export function safeTemporaryRuntime(parent = tmpdir()) {
  const resolvedParent = resolve(parent);
  if (!existsSync(resolvedParent) || !statSync(resolvedParent).isDirectory()) {
    throw new Error("runtime-parent-invalid");
  }
  return resolvedParent;
}
