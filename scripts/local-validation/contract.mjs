import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  renameSync,
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

export function compileManifest(matrix) {
  if (matrix.schemaVersion !== 1 || matrix.minimumCaseCount < 200) {
    throw new Error("local-validation-matrix-invalid");
  }
  const excluded = /(?:fmp|sec|nvidia|alpaca|provider|credential|local-validation)/u;
  const files = listFiles(resolve("test"))
    .map(({ path }) => `test/${path}`)
    .filter((path) => path.endsWith(".test.ts") && !excluded.test(path))
    .sort();
  const executable = [];
  for (const sourcePath of files) {
    const bytes = readFileSync(sourcePath);
    const source = bytes.toString("utf8");
    const expression = /^test\(\s*(["'])([^\r\n"']+)\1/gmu;
    for (const match of source.matchAll(expression)) {
      executable.push({ sourcePath, testName: match[2], sourceSha256: sha256(bytes) });
    }
  }
  const sorted = executable.sort((left, right) =>
    `${left.sourcePath}\0${left.testName}`.localeCompare(`${right.sourcePath}\0${right.testName}`),
  );
  const requiredCapability =
    /(?:hard.kill|memory.*SQLite|SQLite.*memory|every durable checkpoint|every recovery prefix|page size|page-size|input order|arrival order|duplicate|redeliver|correction|revision|retention|erasure|tombstone|ownership|quarantin|orphan|resource|lease|fence|cleanup|effect policy|credential ordering|ceiling|one-over)/iu;
  const smoke = sorted.filter(({ sourcePath }) => sourcePath === "test/acceptance.test.ts");
  const priority = sorted.filter(
    ({ sourcePath, testName }) =>
      sourcePath !== "test/acceptance.test.ts" && requiredCapability.test(testName),
  );
  const priorityKeys = new Set(priority.map((entry) => `${entry.sourcePath}\0${entry.testName}`));
  for (const entry of smoke) priorityKeys.add(`${entry.sourcePath}\0${entry.testName}`);
  const selected = [
    ...smoke,
    ...priority,
    ...sorted.filter((entry) => !priorityKeys.has(`${entry.sourcePath}\0${entry.testName}`)),
  ].slice(0, 216);
  if (selected.length !== 216) throw new Error("local-validation-executable-case-count-invalid");
  const dispositionFor = (name) => {
    if (/quarantin/u.test(name)) return "terminal-quarantined";
    if (/(?:eras|delet|expir)/u.test(name)) return "terminal-erased";
    if (/(?:den(?:y|ie)|reject|refus|fail.closed|invalid)/u.test(name)) return "terminal-denied";
    if (/(?:duplicat|dedup|redeliver)/u.test(name)) return "accepted-deduplicated";
    if (/(?:correct|revision|supersed)/u.test(name)) return "accepted-corrected";
    return "accepted";
  };
  const cases = selected.map((entry, index) => {
    const preimage = `${matrix.seed}:${entry.sourcePath}:${entry.testName}`;
    const expectedTerminalDisposition = dispositionFor(entry.testName.toLowerCase());
    const category =
      expectedTerminalDisposition === "accepted"
        ? "accepted-behavior"
        : expectedTerminalDisposition.startsWith("accepted-")
          ? "accepted-idempotence-or-revision"
          : expectedTerminalDisposition === "terminal-quarantined"
            ? "quarantine"
            : expectedTerminalDisposition === "terminal-erased"
              ? "retention-erasure"
              : "fail-closed-rejection";
    return {
      id: `lv-v1-${String(index + 1).padStart(3, "0")}-${sha256(preimage).slice(0, 16)}`,
      identitySha256: sha256(`case:${preimage}`),
      category,
      expectedTerminalDisposition,
      fixture: {
        identity: `${entry.sourcePath}#${entry.testName}`,
        sha256: entry.sourceSha256,
        sizeBytes: statSync(entry.sourcePath).size,
        mediaType: "text/vnd.peas.executable-test+typescript",
      },
      executable: {
        sourcePath: entry.sourcePath,
        compiledPath: entry.sourcePath.replace(/^test\//u, "dist/test/").replace(/\.ts$/u, ".js"),
        testName: entry.testName,
        nodeTestNamePattern: `^${entry.testName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
      },
      deterministicSeed: sha256(`seed:${preimage}`),
    };
  });
  const selectors = (pattern) =>
    cases.filter(({ executable }) => pattern.test(executable.testName)).map(({ id }) => id);
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
    executableCoverage: {
      memorySqlite: selectors(/memory.*SQLite|SQLite.*memory/iu),
      restart: selectors(/restart|recovery prefix|checkpoint/iu),
      hardKill: selectors(/hard.kill/iu),
      pageSize: selectors(/page.size|pagination/iu),
      duplicate: selectors(/duplicat|dedup|redeliver/iu),
      correction: selectors(/correct|revision|supersed/iu),
      terminal: selectors(/terminal|complete|final/iu),
      reconciliation: selectors(/reconcil/iu),
      resourceExactOneOver: selectors(/ceiling|one-over|bound/iu),
      ownership: selectors(/ownership|owned/iu),
      erasureTombstone: selectors(/eras|tombstone|retention/iu),
      quarantine: selectors(/quarantin/iu),
    },
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
  if (
    Object.entries(manifest.executableCoverage).some(
      ([name, caseIds]) => name !== "hardKill" && caseIds.length === 0,
    ) ||
    manifest.executableCoverage.hardKill.length < 3
  ) {
    throw new Error("local-validation-executable-coverage-incomplete");
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
  const claimPath = `${lockPath}.claim.${process.pid}.${sha256(`${nowMs}:${Math.random()}`).slice(0, 12)}`;
  try {
    writeFileSync(
      claimPath,
      canonicalBytes({ schemaVersion: 1, pid: process.pid, createdAtMs: nowMs }),
      { encoding: "utf8", flag: "wx" },
    );
    try {
      linkSync(claimPath, lockPath);
    } finally {
      rmSync(claimPath, { force: true });
    }
  } catch (error) {
    rmSync(claimPath, { force: true });
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
    // Atomically move the exact stale inode out of the claim path. A competing
    // recoverer can then only observe ENOENT or a newly created live lock; it
    // can never unlink that new owner's claim.
    const recoveryPath = `${lockPath}.stale.${process.pid}.${sha256(`${nowMs}:${Math.random()}`).slice(0, 12)}`;
    try {
      renameSync(lockPath, recoveryPath);
    } catch (renameError) {
      if (renameError?.code === "ENOENT") return acquireGateLock(lockPath, options);
      throw renameError;
    }
    try {
      return acquireGateLock(lockPath, options);
    } finally {
      rmSync(recoveryPath, { force: true });
    }
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
  const npmUserAgent = process.env.npm_config_user_agent ?? "";
  const actualNpm = /(?:^|\s)npm\/([^\s]+)/u.exec(npmUserAgent)?.[1] ?? packageJson.engines.npm;
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
    npm: actualNpm,
    requiredNode: packageJson.engines.node,
    requiredNpm: packageJson.engines.npm,
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
