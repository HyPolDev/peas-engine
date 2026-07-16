import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GENERATOR_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.dirname(GENERATOR_PATH);
const REPOSITORY_ROOT = path.resolve(DEFAULT_ROOT, "../../..");
const BIOME_ENTRY = path.join(REPOSITORY_ROOT, "node_modules/@biomejs/biome/bin/biome");
const TEST_HANDSHAKE = "sec-fixture-generator-test-v1";

function strictDescendant(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function samePath(left, right) {
  const normalized = (value) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalized(left) === normalized(right);
}

function parseInvocation(arguments_) {
  if (arguments_.length === 0) {
    return {
      mode: "normal",
      targetRoot: canonicalizePlainPath(DEFAULT_ROOT, "Default fixture root"),
      stagingParent: canonicalizePlainPath(os.tmpdir(), "Staging parent"),
      test: null,
    };
  }
  if (arguments_.length === 2 && arguments_[0] === "--output-root") {
    return {
      mode: "normal",
      targetRoot: canonicalizePlainPath(arguments_[1], "Output root"),
      stagingParent: canonicalizePlainPath(os.tmpdir(), "Staging parent"),
      test: null,
    };
  }
  if (
    arguments_.length === 7 &&
    arguments_[0] === "--test-mode" &&
    arguments_[1] === TEST_HANDSHAKE &&
    arguments_[2] === "--target-root" &&
    arguments_[4] === "--staging-parent" &&
    arguments_[3] !== "" &&
    arguments_[5] !== "" &&
    arguments_[6] === "--end-test-mode"
  ) {
    const temporaryRoot = canonicalizePlainPath(os.tmpdir(), "System temporary directory");
    const targetRoot = canonicalizePlainPath(arguments_[3], "Test target root");
    const stagingParent = canonicalizePlainPath(arguments_[5], "Test staging parent");
    const defaultRoot = canonicalizePlainPath(DEFAULT_ROOT, "Default fixture root");
    if (samePath(targetRoot, defaultRoot)) {
      throw new Error("Test target root cannot name the default fixture tree");
    }
    if (!strictDescendant(temporaryRoot, targetRoot)) {
      throw new Error("Test target root must be below the system temporary directory");
    }
    if (!strictDescendant(temporaryRoot, stagingParent)) {
      throw new Error("Test staging parent must be below the system temporary directory");
    }
    if (isWithinOrEqual(targetRoot, stagingParent) || isWithinOrEqual(stagingParent, targetRoot)) {
      throw new Error("Test target root and staging parent must be disjoint");
    }
    const optionalControl = (name) => {
      const value = process.env[name];
      return value === undefined || value === "" ? null : value;
    };
    const formatFailure = optionalControl("PEAS_SEC_FIXTURE_TEST_FORMAT_FAILURE");
    const rawForbidFormatRoot = optionalControl("PEAS_SEC_FIXTURE_TEST_FORBID_FORMAT_ROOT");
    if (rawForbidFormatRoot !== null && !path.isAbsolute(rawForbidFormatRoot)) {
      throw new Error("Test-mode forbidden formatter root must be below the temporary directory");
    }
    const forbidFormatRoot =
      rawForbidFormatRoot === null
        ? null
        : canonicalizePlainPath(rawForbidFormatRoot, "Test-mode forbidden formatter root");
    const promotionFailure = optionalControl("PEAS_SEC_FIXTURE_TEST_PROMOTION_FAILURE");
    if (formatFailure !== null && formatFailure !== "bodies" && formatFailure !== "manifest") {
      throw new Error("Malformed test-mode formatter failure control");
    }
    if (promotionFailure !== null && promotionFailure !== "after-first-write") {
      throw new Error("Malformed test-mode promotion failure control");
    }
    if (
      forbidFormatRoot !== null &&
      !strictDescendant(temporaryRoot, path.resolve(forbidFormatRoot))
    ) {
      throw new Error("Test-mode forbidden formatter root must be below the temporary directory");
    }
    return {
      mode: "test",
      targetRoot,
      stagingParent,
      test: {
        formatFailure,
        forbidFormatRoot,
        promotionFailure,
      },
    };
  }
  throw new Error(
    "Usage: generate-contract.mjs [--output-root <directory>] or the closed test-mode handshake",
  );
}

const INVOCATION = parseInvocation(process.argv.slice(2));
const TARGET_ROOT = INVOCATION.targetRoot;
const STAGING_PARENT = INVOCATION.stagingParent;
assertSafeStagingParent(STAGING_PARENT);
const ROOT = mkdtempSync(path.join(STAGING_PARENT, "peas-sec-fixture-stage-"));
const BODY_ROOT = path.join(ROOT, "bodies");
const cleanupStagingRoot = () => rmSync(ROOT, { recursive: true, force: true });
process.once("exit", cleanupStagingRoot);

function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort(codeUnitCompare)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function hashParts(domain, ...parts) {
  const hash = createHash("sha256");
  for (const part of [domain, ...parts]) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part, "utf8");
    const prefix = Buffer.alloc(8);
    prefix.writeBigUInt64BE(BigInt(bytes.byteLength));
    hash.update(prefix);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function canonicalHash(domain, value) {
  return hashParts(domain, canonicalJson(value));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedSourceHash() {
  const normalized = readFileSync(GENERATOR_PATH, "utf8").replaceAll("\r\n", "\n");
  return sha256(Buffer.from(normalized, "utf8"));
}

function formattedManifest(source) {
  if (INVOCATION.test?.formatFailure === "manifest") {
    throw new Error("Injected manifest formatter failure");
  }
  const result = spawnSync(
    process.execPath,
    [BIOME_ENTRY, "format", "--stdin-file-path", "fixtures/sec/v1/manifest.ts"],
    {
      cwd: REPOSITORY_ROOT,
      input: source,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      windowsHide: true,
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Biome failed to format generated manifest: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function formatGeneratedJsonBodies(files) {
  if (INVOCATION.test?.formatFailure === "bodies") {
    throw new Error("Injected body formatter failure");
  }
  const forbiddenRoot = INVOCATION.test?.forbidFormatRoot;
  if (
    forbiddenRoot !== undefined &&
    forbiddenRoot !== null &&
    forbiddenRoot !== "" &&
    files.some((file) => isWithinOrEqual(path.resolve(forbiddenRoot), path.resolve(file)))
  ) {
    throw new Error("Formatter received a promotion-target path");
  }
  const result = spawnSync(process.execPath, [BIOME_ENTRY, "format", "--write", ...files], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Biome failed to format generated JSON bodies: ${result.stderr.trim()}`);
  }
}

function isWithinOrEqual(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function lstatOrNull(candidate) {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function pathComponentsFrom(root, candidate) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(candidate);
  if (!isWithinOrEqual(absoluteRoot, absolute)) {
    throw new Error("Path components escape their canonical anchor");
  }
  const components = [absoluteRoot];
  let cursor = absoluteRoot;
  for (const part of path.relative(absoluteRoot, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    components.push(cursor);
  }
  return components;
}

function assertNoWindowsReparse(paths, label) {
  if (process.platform !== "win32" || paths.length === 0) return;
  const unique = [...new Set(paths.map((candidate) => path.resolve(candidate)))].sort(
    codeUnitCompare,
  );
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$paths = ConvertFrom-Json $env:PEAS_SEC_FIXTURE_REPARSE_PATHS",
    "foreach ($path in $paths) {",
    "  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop",
    '  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse point: $path" }',
    "}",
  ].join("\n");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, PEAS_SEC_FIXTURE_REPARSE_PATHS: JSON.stringify(unique) },
      windowsHide: true,
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} contains a Windows reparse point`);
  }
}

function canonicalizePlainPath(candidate, label) {
  const absolute = path.resolve(candidate);
  let anchor = absolute;
  while (lstatOrNull(anchor) === null) {
    const parent = path.dirname(anchor);
    if (parent === anchor) throw new Error(`${label} has no existing filesystem anchor`);
    anchor = parent;
  }
  const root = path.parse(anchor).root;
  const existingChain = pathComponentsFrom(root, anchor);
  for (const component of existingChain) {
    const stats = lstatSync(component);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`${label} contains a redirect or non-directory ancestor`);
    }
  }
  assertNoWindowsReparse(existingChain, label);
  const canonicalAnchor = realpathSync.native(anchor);
  return path.resolve(canonicalAnchor, path.relative(anchor, absolute));
}

function assertSafeStagingParent(stagingParent) {
  const absolute = path.resolve(stagingParent);
  const stats = lstatOrNull(absolute);
  if (stats === null) {
    throw new Error("Staging parent must already exist as a plain directory");
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Staging parent must be a plain directory");
  }
  assertNoWindowsReparse([absolute], "Staging parent");
  if (!samePath(realpathSync.native(absolute), absolute)) {
    throw new Error("Staging parent resolves through a redirected path");
  }
}

function createTargetGuard(targetRoot) {
  const absoluteTarget = path.resolve(targetRoot);
  let anchorPath = absoluteTarget;
  while (lstatOrNull(anchorPath) === null) {
    const parent = path.dirname(anchorPath);
    if (parent === anchorPath) throw new Error("Promotion target has no existing anchor");
    anchorPath = parent;
  }
  const anchorStats = lstatSync(anchorPath);
  if (!anchorStats.isDirectory() || anchorStats.isSymbolicLink()) {
    throw new Error("Promotion target anchor is redirected or not a directory");
  }
  assertNoWindowsReparse([anchorPath], "Promotion target");
  const anchorReal = realpathSync.native(anchorPath);
  if (!samePath(anchorReal, anchorPath)) {
    throw new Error("Promotion target anchor resolves through a redirected path");
  }
  const canonicalTarget = path.resolve(anchorReal, path.relative(anchorPath, absoluteTarget));
  return { targetRoot: absoluteTarget, anchorPath, anchorReal, canonicalTarget };
}

function expectedCanonicalPath(guard, candidate) {
  const absolute = path.resolve(candidate);
  if (!isWithinOrEqual(guard.anchorPath, absolute)) {
    throw new Error("Promotion path escapes its canonical target parent");
  }
  return path.resolve(guard.anchorReal, path.relative(guard.anchorPath, absolute));
}

function assertTargetMember(guard, candidate) {
  const absolute = path.resolve(candidate);
  if (!strictDescendant(guard.targetRoot, absolute)) {
    throw new Error("Generated member escapes the promotion target root");
  }
  const canonical = expectedCanonicalPath(guard, absolute);
  if (!strictDescendant(guard.canonicalTarget, canonical)) {
    throw new Error("Generated member resolves outside the canonical target root");
  }
}

function validateDirectoryChain(guard, directory, requireComplete) {
  const absolute = path.resolve(directory);
  expectedCanonicalPath(guard, absolute);
  const relative = path.relative(guard.anchorPath, absolute);
  const components = [
    guard.anchorPath,
    ...relative
      .split(path.sep)
      .filter(Boolean)
      .map((_, index, parts) => path.join(guard.anchorPath, ...parts.slice(0, index + 1))),
  ];
  let missingSeen = false;
  for (const component of components) {
    const stats = lstatOrNull(component);
    if (stats === null) {
      missingSeen = true;
      continue;
    }
    if (missingSeen) throw new Error("Promotion directory exists below a missing parent");
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Promotion directory path contains a redirect or non-directory");
    }
    if (!samePath(realpathSync.native(component), expectedCanonicalPath(guard, component))) {
      throw new Error("Promotion directory resolves outside its canonical identity");
    }
  }
  if (requireComplete && missingSeen) throw new Error("Promotion directory is missing");
  return !missingSeen;
}

function validateMemberPath(guard, memberPath) {
  const absolute = path.resolve(memberPath);
  assertTargetMember(guard, absolute);
  const parentExists = validateDirectoryChain(guard, path.dirname(absolute), false);
  const stats = lstatOrNull(absolute);
  if (!parentExists) {
    if (stats !== null) throw new Error("Generated member exists below a missing directory");
    return null;
  }
  if (stats === null) return null;
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Generated member target is redirected or not a regular file");
  }
  if (!samePath(realpathSync.native(absolute), expectedCanonicalPath(guard, absolute))) {
    throw new Error("Generated member resolves outside the canonical target root");
  }
  return stats;
}

function preflightMutationPaths(guard, memberPaths, label) {
  const existing = new Set();
  for (const component of pathComponentsFrom(guard.anchorPath, guard.targetRoot)) {
    if (lstatOrNull(component) !== null) existing.add(component);
  }
  for (const memberPath of memberPaths) {
    assertTargetMember(guard, memberPath);
    for (const component of pathComponentsFrom(guard.anchorPath, memberPath)) {
      if (lstatOrNull(component) !== null) existing.add(component);
    }
  }
  assertNoWindowsReparse([...existing], label);
  for (const memberPath of memberPaths) validateMemberPath(guard, memberPath);
}

function ensureSafeDirectory(guard, directory, createdDirectories) {
  const absolute = path.resolve(directory);
  expectedCanonicalPath(guard, absolute);
  const relative = path.relative(guard.anchorPath, absolute);
  let cursor = guard.anchorPath;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    const parent = cursor;
    cursor = path.join(cursor, part);
    validateDirectoryChain(guard, parent, true);
    const existing = lstatOrNull(cursor);
    if (existing === null) {
      mkdirSync(cursor);
      createdDirectories.push(cursor);
    } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error("Promotion directory was replaced before creation");
    }
    validateDirectoryChain(guard, cursor, true);
  }
}

function rollbackPromotion(guard, written, createdDirectories) {
  const paths = written.map((item) => item.target);
  const existingRollbackPaths = new Set();
  for (const candidate of [...paths, ...createdDirectories]) {
    for (const component of pathComponentsFrom(guard.anchorPath, candidate)) {
      if (lstatOrNull(component) !== null) existingRollbackPaths.add(component);
    }
  }
  assertNoWindowsReparse([...existingRollbackPaths], "Rollback target");
  preflightMutationPaths(guard, paths, "Rollback target");
  for (const item of [...written].reverse()) {
    validateDirectoryChain(guard, path.dirname(item.target), true);
    const current = validateMemberPath(guard, item.target);
    if (item.previous === null) {
      if (current !== null) rmSync(item.target);
    } else {
      writeFileSync(item.target, item.previous);
    }
  }
  for (const directory of [...createdDirectories].reverse()) {
    validateDirectoryChain(guard, path.dirname(directory), true);
    validateDirectoryChain(guard, directory, true);
    if (readdirSync(directory).length !== 0) {
      throw new Error("Created promotion directory is not empty during rollback");
    }
    rmdirSync(directory);
  }
}

function enumerateGeneratedTree(root) {
  const files = [];
  const directories = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      const stats = lstatSync(absolute);
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) {
        throw new Error(`Generated staging entry cannot be a link: ${relative}`);
      }
      if (entry.isDirectory()) {
        directories.push(relative);
        pending.push(absolute);
      } else if (entry.isFile() && stats.isFile()) {
        files.push(relative);
      } else {
        throw new Error(`Generated staging entry must be regular: ${relative}`);
      }
    }
  }
  files.sort(codeUnitCompare);
  directories.sort(codeUnitCompare);
  return { files, directories };
}

function verifyGeneratedTree(root, generatedPaths) {
  const tree = enumerateGeneratedTree(root);
  if (canonicalJson(tree.directories) !== canonicalJson(["bodies"])) {
    throw new Error(`Unexpected generated directories: ${canonicalJson(tree.directories)}`);
  }
  if (canonicalJson(tree.files) !== canonicalJson(generatedPaths)) {
    throw new Error(`Unexpected generated files: ${canonicalJson(tree.files)}`);
  }
}

function promoteGeneratedTree(stagingRoot, targetRoot, generatedPaths) {
  const guard = createTargetGuard(targetRoot);
  const targets = generatedPaths.map((relative) => path.join(targetRoot, relative));
  preflightMutationPaths(guard, targets, "Promotion target");
  const promotion = generatedPaths
    .map((relative) => {
      const target = path.join(targetRoot, relative);
      const existing = validateMemberPath(guard, target);
      const previous = existing === null ? null : readFileSync(target);
      return {
        relative,
        target,
        bytes: readFileSync(path.join(stagingRoot, relative)),
        previous,
      };
    })
    .filter((item) => item.previous === null || !item.previous.equals(item.bytes));
  const written = [];
  const createdDirectories = [];
  try {
    for (const item of promotion) {
      ensureSafeDirectory(guard, path.dirname(item.target), createdDirectories);
      validateDirectoryChain(guard, path.dirname(item.target), true);
      validateMemberPath(guard, item.target);
      written.push(item);
      writeFileSync(item.target, item.bytes);
      validateMemberPath(guard, item.target);
      if (INVOCATION.test?.promotionFailure === "after-first-write" && written.length === 1) {
        throw new Error("Injected promotion failure after first write");
      }
    }
  } catch (error) {
    try {
      rollbackPromotion(guard, written, createdDirectories);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Promotion and contained rollback failed");
    }
    throw error;
  }
}

function json(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function text(value) {
  return Buffer.from(`${value}\n`, "utf8");
}

function htmlMeta(label, payloadByte = null) {
  const start = Buffer.from(`<!doctype html><meta charset="${label}"><p>`, "ascii");
  const payload =
    payloadByte === null ? Buffer.from("synthetic", "ascii") : Buffer.from([payloadByte]);
  return Buffer.concat([start, payload, Buffer.from("</p>\n", "ascii")]);
}

const bodies = new Map();
const addBody = (id, file, mediaType, bytes) => bodies.set(id, { id, file, mediaType, bytes });

const BASE_ACCESSION = "0000123456-26-000001";
const NEXT_ACCESSION = "0000123456-26-000003";
const TEN_K_ACCESSION = "0000123456-26-000004";
const TEN_QA_ACCESSION = "0000123456-26-000005";
const TEN_KA_ACCESSION = "0000123456-26-000006";
const PREFIX_ACCESSION = "0000999999-26-000001";
const AMENDMENT_ACCESSION = "0000123456-26-000002";

function submissions({
  accession = BASE_ACCESSION,
  cik = "123456",
  form = "8-K",
  items = ["2.02"],
  acceptanceDateTime = "2026-05-07T20:15:30-04:00",
  includeCik = true,
}) {
  const value = { accession };
  if (includeCik) value.cik = cik;
  value.form = form;
  value.items = items;
  if (acceptanceDateTime !== null) value.acceptanceDateTime = acceptanceDateTime;
  return json(value);
}

function filingIndex({
  accession = BASE_ACCESSION,
  cik = "0000123456",
  form = "8-K",
  items = ["2.02"],
  exhibits = [{ memberKey: "exhibit-a", type: "EX-99.1", sequence: 1 }],
  includeCik = true,
}) {
  const value = { accession, form, items };
  if (includeCik) value.subjectCik = cik;
  value.exhibits = exhibits;
  return json(value);
}

function primary({
  form = "8-K",
  cik = "0000123456",
  includeCik = true,
  acceptance = "20260507201530",
  filingDate = null,
  focus = null,
  malformed = false,
}) {
  const fields = [`<DOCUMENT-TYPE>${form}</DOCUMENT-TYPE>`];
  if (includeCik) fields.push(`<SUBJECT-CIK>${cik}</SUBJECT-CIK>`);
  if (acceptance !== null) fields.push(`<ACCEPTANCE-DATETIME>${acceptance}</ACCEPTANCE-DATETIME>`);
  if (filingDate !== null) fields.push(`<FILING-DATE>${filingDate}</FILING-DATE>`);
  if (focus !== null) {
    fields.push(
      `<ix:nonNumeric name="dei:DocumentFiscalYearFocus">${focus.year}</ix:nonNumeric>`,
      `<ix:nonNumeric name="dei:DocumentFiscalPeriodFocus">${focus.period}</ix:nonNumeric>`,
    );
  }
  return text(`<html><body>${fields.join("")}${malformed ? "<broken" : ""}</body></html>`);
}

function xbrl({
  cik = "0000123456",
  includeCik = true,
  focuses = [{ year: "2026", period: "Q1" }],
  malformed = false,
}) {
  const identity = includeCik
    ? `<dei:EntityCentralIndexKey>${cik}</dei:EntityCentralIndexKey>`
    : "";
  const focus = focuses
    .map(
      (item) =>
        `<dei:DocumentFiscalYearFocus>${item.year}</dei:DocumentFiscalYearFocus>` +
        `<dei:DocumentFiscalPeriodFocus>${item.period}</dei:DocumentFiscalPeriodFocus>`,
    )
    .join("");
  if (malformed) {
    return text(`<?xml version="1.0" encoding="UTF-8"?><xbrl>${identity}${focus}</wrong>`);
  }
  return text(`<?xml version="1.0" encoding="UTF-8"?><xbrl>${identity}${focus}</xbrl>`);
}

function periodic({
  form = "10-Q",
  cik = "0000123456",
  year = "2026",
  period = "Q1",
  acceptance = null,
}) {
  return primary({ form, cik, acceptance, focus: { year, period } });
}

addBody("sub-base", "submissions.json", "application/json", submissions({}));
addBody(
  "sub-padded",
  "submissions-padded.json",
  "application/json",
  submissions({ cik: "0000123456" }),
);
addBody(
  "sub-no-time",
  "submissions-no-time.json",
  "application/json",
  submissions({ acceptanceDateTime: null }),
);
addBody(
  "sub-no-item",
  "submissions-non-earnings.json",
  "application/json",
  submissions({ items: ["5.02"] }),
);
addBody(
  "sub-no-cik",
  "submissions-no-cik.json",
  "application/json",
  submissions({ includeCik: false }),
);
addBody(
  "sub-malformed-time",
  "submissions-malformed-time.json",
  "application/json",
  submissions({ acceptanceDateTime: "2026-02-30T09:15:00-05:00" }),
);
addBody(
  "sub-amendment",
  "submissions-8ka.json",
  "application/json",
  submissions({ accession: AMENDMENT_ACCESSION, form: "8-K/A" }),
);
addBody(
  "sub-prefix",
  "submissions-prefix-mismatch.json",
  "application/json",
  submissions({ accession: PREFIX_ACCESSION }),
);
addBody(
  "sub-10q-next",
  "submissions-10q.json",
  "application/json",
  submissions({
    accession: NEXT_ACCESSION,
    form: "10-Q",
    items: [],
    acceptanceDateTime: "2026-05-08T07:30:00-04:00",
  }),
);
addBody(
  "sub-10k",
  "submissions-10k.json",
  "application/json",
  submissions({
    accession: TEN_K_ACCESSION,
    form: "10-K",
    items: [],
    acceptanceDateTime: "2026-02-20T16:10:00-05:00",
  }),
);
addBody(
  "sub-10qa",
  "submissions-10qa.json",
  "application/json",
  submissions({
    accession: TEN_QA_ACCESSION,
    form: "10-Q/A",
    items: [],
    acceptanceDateTime: "2026-05-12T09:00:00-04:00",
  }),
);
addBody(
  "sub-10ka",
  "submissions-10ka.json",
  "application/json",
  submissions({
    accession: TEN_KA_ACCESSION,
    form: "10-K/A",
    items: [],
    acceptanceDateTime: "2026-02-25T09:00:00-05:00",
  }),
);

const exhibitsTwo = [
  { memberKey: "exhibit-a", type: "EX-99.1", sequence: 2 },
  { memberKey: "exhibit-b", type: "EX-99.1", sequence: 1 },
];
addBody("index-base", "filing-index.json", "application/json", filingIndex({}));
addBody(
  "index-two",
  "filing-index-two-exhibits.json",
  "application/json",
  filingIndex({ exhibits: exhibitsTwo }),
);
addBody(
  "index-tied",
  "filing-index-tied-sequence.json",
  "application/json",
  filingIndex({ exhibits: exhibitsTwo.map((item) => ({ ...item, sequence: 1 })) }),
);
addBody(
  "index-conflicting",
  "filing-index-conflicting-sequence.json",
  "application/json",
  filingIndex({
    exhibits: [
      { memberKey: "exhibit-a", type: "EX-99.1", sequence: 1 },
      { memberKey: "exhibit-a", type: "EX-99.1", sequence: 2 },
      { memberKey: "exhibit-b", type: "EX-99.1", sequence: 3 },
    ],
  }),
);
addBody(
  "index-no-item",
  "filing-index-non-earnings.json",
  "application/json",
  filingIndex({ items: ["5.02"] }),
);
addBody(
  "index-no-cik",
  "filing-index-no-cik.json",
  "application/json",
  filingIndex({ includeCik: false }),
);
addBody(
  "index-amendment",
  "filing-index-8ka.json",
  "application/json",
  filingIndex({ accession: AMENDMENT_ACCESSION, form: "8-K/A" }),
);
addBody(
  "index-prefix",
  "filing-index-prefix-mismatch.json",
  "application/json",
  filingIndex({ accession: PREFIX_ACCESSION }),
);
addBody(
  "index-10q-next",
  "filing-index-10q.json",
  "application/json",
  filingIndex({ accession: NEXT_ACCESSION, form: "10-Q", items: [], exhibits: [] }),
);
addBody(
  "index-10k",
  "filing-index-10k.json",
  "application/json",
  filingIndex({ accession: TEN_K_ACCESSION, form: "10-K", items: [], exhibits: [] }),
);
addBody(
  "index-10qa",
  "filing-index-10qa.json",
  "application/json",
  filingIndex({ accession: TEN_QA_ACCESSION, form: "10-Q/A", items: [], exhibits: [] }),
);
addBody(
  "index-10ka",
  "filing-index-10ka.json",
  "application/json",
  filingIndex({ accession: TEN_KA_ACCESSION, form: "10-K/A", items: [], exhibits: [] }),
);

addBody("primary-base", "primary.html", "text/html", primary({}));
addBody("primary-no-cik", "primary-no-cik.html", "text/html", primary({ includeCik: false }));
addBody("primary-no-time", "primary-no-time.html", "text/html", primary({ acceptance: null }));
addBody(
  "primary-standard",
  "primary-standard-time.html",
  "text/html",
  primary({ acceptance: "20260115103000" }),
);
addBody(
  "primary-conflict",
  "primary-conflicting-time.html",
  "text/html",
  primary({ acceptance: "20260507201630" }),
);
addBody(
  "primary-malformed-time",
  "primary-malformed-time.html",
  "text/html",
  primary({ acceptance: "20261301103000" }),
);
addBody(
  "primary-pre2007",
  "primary-pre-2007-time.html",
  "text/html",
  primary({ acceptance: "20061101103000" }),
);
addBody(
  "primary-filing-date",
  "primary-filing-date-only.html",
  "text/html",
  primary({ acceptance: null, filingDate: "20260507" }),
);
addBody(
  "primary-10q-next",
  "primary-10q-inline.html",
  "text/html",
  primary({ form: "10-Q", acceptance: "20260508073000", focus: { year: "2026", period: "Q1" } }),
);
addBody(
  "primary-10k",
  "primary-10k.html",
  "text/html",
  primary({ form: "10-K", acceptance: "20260220161000" }),
);
addBody(
  "primary-10qa",
  "primary-10qa-inline.html",
  "text/html",
  primary({ form: "10-Q/A", acceptance: "20260512090000", focus: { year: "2026", period: "Q1" } }),
);
addBody(
  "primary-10ka",
  "primary-10ka.html",
  "text/html",
  primary({ form: "10-K/A", acceptance: "20260225090000" }),
);

addBody("xbrl-q1", "xbrl.xml", "application/xml", xbrl({}));
addBody("xbrl-no-cik", "xbrl-no-cik.xml", "application/xml", xbrl({ includeCik: false }));
addBody(
  "xbrl-fy",
  "xbrl-fy.xml",
  "application/xml",
  xbrl({ focuses: [{ year: "2025", period: "FY" }] }),
);
addBody("xbrl-foreign", "xbrl-foreign-cik.xml", "application/xml", xbrl({ cik: "0000654321" }));
addBody("xbrl-no-focus", "xbrl-no-focus.xml", "application/xml", xbrl({ focuses: [] }));
addBody(
  "xbrl-conflict",
  "xbrl-conflicting-focus.xml",
  "application/xml",
  xbrl({
    focuses: [
      { year: "2026", period: "Q1" },
      { year: "2026", period: "Q2" },
    ],
  }),
);
addBody("xbrl-malformed", "xbrl-malformed.xml", "application/xml", xbrl({ malformed: true }));

addBody("periodic-match", "periodic.html", "text/html", periodic({}));
addBody(
  "periodic-foreign",
  "periodic-foreign-cik.html",
  "text/html",
  periodic({ cik: "0000654321" }),
);
addBody("periodic-q2", "periodic-different-period.html", "text/html", periodic({ period: "Q2" }));

addBody(
  "exhibit-a",
  "exhibit.html",
  "text/html",
  text('<!doctype html><p data-vector="a">synthetic exhibit A</p>'),
);
addBody(
  "exhibit-b",
  "exhibit-b.html",
  "text/html",
  text('<!doctype html><p data-vector="b">synthetic exhibit B</p>'),
);
addBody(
  "exhibit-conflict",
  "exhibit-conflicting-redelivery.html",
  "text/html",
  text('<!doctype html><p data-vector="changed">synthetic changed bytes</p>'),
);
for (let index = 1; index <= 13; index += 1) {
  addBody(
    `exhibit-limit-${index}`,
    `exhibit-limit-${String(index).padStart(2, "0")}.html`,
    "text/html",
    text(`<!doctype html><p data-limit="${String(index).padStart(2, "0")}">x</p>`),
  );
}

const decoderAliases = [
  "utf-8",
  "utf8",
  "unicode-1-1-utf-8",
  "windows-1252",
  "cp1252",
  "x-cp1252",
  "iso-8859-1",
  "iso8859-1",
  "latin1",
  "us-ascii",
];
for (const label of decoderAliases) {
  const isUtf8 = ["utf-8", "utf8", "unicode-1-1-utf-8"].includes(label);
  const file = label === "utf-8" ? "decoder-declared-utf8.html" : `decoder-alias-${label}.html`;
  addBody(`decoder-${label}`, file, "text/html", htmlMeta(label, isUtf8 ? null : 0x93));
}
addBody(
  "decoder-bom",
  "decoder-utf8-bom.html",
  "text/html",
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), htmlMeta("utf-8")]),
);
addBody(
  "decoder-undeclared-utf8",
  "decoder-undeclared-utf8.html",
  "text/html",
  Buffer.from("<!doctype html><p>caf\u00e9</p>\n", "utf8"),
);
addBody(
  "decoder-undeclared-1252",
  "decoder-undeclared-windows-1252.html",
  "text/html",
  Buffer.concat([
    Buffer.from("<!doctype html><p>", "ascii"),
    Buffer.from([0x93]),
    Buffer.from("</p>\n", "ascii"),
  ]),
);
addBody("decoder-unsupported", "decoder-unsupported.html", "text/html", htmlMeta("koi8-r"));
addBody(
  "decoder-bom-conflict",
  "decoder-bom-conflict.html",
  "text/html",
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), htmlMeta("windows-1252", 0x93)]),
);
const exactMeta = Buffer.from('<meta charset="utf-8">', "ascii");
addBody(
  "decoder-sniff-exact",
  "decoder-sniff-exact-1024.html",
  "text/html",
  Buffer.concat([Buffer.alloc(1024 - exactMeta.byteLength, 0x20), exactMeta]),
);
addBody(
  "decoder-sniff-crossing",
  "decoder-sniff-crossing-1024.html",
  "text/html",
  Buffer.concat([Buffer.alloc(1010, 0x20), exactMeta, Buffer.from("<p>x</p>", "ascii")]),
);
addBody(
  "markup-tolerated",
  "malformed-tolerated.html",
  "text/html",
  text("<html><body><p>synthetic<div>continued"),
);
addBody(
  "index-17",
  "filing-index-17-members.json",
  "application/json",
  filingIndex({
    exhibits: Array.from({ length: 13 }, (_, index) => ({
      memberKey: `exhibit-${String(index + 1).padStart(2, "0")}`,
      type: "EX-99.1",
      sequence: index + 1,
    })),
  }),
);

const artifacts = {};
mkdirSync(BODY_ROOT, { recursive: true });
for (const body of bodies.values()) {
  writeFileSync(path.join(BODY_ROOT, body.file), body.bytes);
}
formatGeneratedJsonBodies(
  [...bodies.values()]
    .filter((body) => body.mediaType === "application/json")
    .map((body) => path.join(BODY_ROOT, body.file)),
);
for (const body of bodies.values()) {
  body.bytes = readFileSync(path.join(BODY_ROOT, body.file));
  artifacts[body.id] = {
    artifactId: body.id,
    path: `bodies/${body.file}`,
    mediaType: body.mediaType,
    sizeBytes: body.bytes.byteLength,
    artifactHash: sha256(body.bytes),
  };
}

const request = (() => {
  const method = "GET";
  const origin = "https" + ":" + "//fixture.invalid";
  const pathHash = canonicalHash("peas/artifact-request-path/v1", { path: "/recorded" });
  const routeLabel = "recorded-sec-fixture";
  return {
    method,
    origin,
    pathHash,
    routeLabel,
    identityHash: canonicalHash("peas/artifact-request-identity/v1", {
      method,
      origin,
      pathHash,
      routeLabel,
    }),
  };
})();

const responseFor = (artifact) => ({
  statusCode: 200,
  etag: null,
  lastModified: null,
  mediaType: artifact.mediaType,
  contentEncoding: null,
  declaredContentLength: artifact.sizeBytes,
  transportDecoded: true,
});

const m = (role, artifactId, memberKey = artifactId) => ({ role, artifactId, memberKey });
const common8k = (overrides = {}) => [
  m("sec.submissions", overrides.submissions ?? "sub-base", "submissions"),
  m("sec.filing-index", overrides.index ?? "index-base", "filing-index"),
  m("sec.primary-document", overrides.primary ?? "primary-base", "primary-document"),
  m("sec.exhibit-99.1", overrides.exhibit ?? "exhibit-a", overrides.exhibitKey ?? "exhibit-a"),
  m("sec.xbrl-instance", overrides.xbrl ?? "xbrl-q1", "xbrl-instance"),
];

const requiredCaseIds = {
  A: [
    "valid-item-202",
    "valid-two-exhibits",
    "valid-10q-inline-focus",
    "valid-10k-separate-xbrl",
    "valid-linked-periodic",
    "valid-next-morning-periodic",
  ],
  B: [
    "missing-submissions",
    "missing-filing-index",
    "missing-primary-document",
    "missing-exhibit",
    "missing-fiscal-evidence",
    "duplicate-singleton",
    "duplicate-artifact-digest",
    "primary-absent",
    "primary-wrong-role",
    "tied-exhibit-sequence",
    "conflicting-exhibit-sequence",
    "more-than-16-members",
    "unknown-sec-role",
  ],
  C: [
    "non-earnings-8k",
    "padded-cik",
    "unpadded-cik",
    "accession-prefix-different",
    "subject-cik-missing",
    "subject-cik-conflict",
    "linked-periodic-foreign-cik",
    "linked-periodic-different-period",
    "absent-fiscal-focus",
    "conflicting-fiscal-focus",
    "exact-provider-redelivery",
    "amendment-8ka-distinct-accession",
    "amendment-10qa-distinct-accession",
    "amendment-10ka-distinct-accession",
    "record-revision-conflicting-primary",
  ],
  D: [
    "observation-at-asof",
    "observation-after-asof",
    "observation-missing-selected",
    "observation-digest-mismatch",
    "observation-wrong-provider",
    "observation-id-reused",
    "observation-identical-bytes-a",
    "observation-identical-bytes-b",
  ],
  E: [
    "timestamp-equivalent-rfc-and-eastern",
    "timestamp-rfc-only",
    "timestamp-header-standard",
    "timestamp-header-daylight",
    "timestamp-missing",
    "timestamp-conflict",
    "timestamp-malformed",
    "timestamp-pre-2007",
    "timestamp-filing-date-only",
    "timestamp-retrieval-excluded",
    "timestamp-linked-periodic-excluded",
  ],
  F: [
    ...decoderAliases.map((label) => `decoder-accepted-${label}`),
    "decoder-utf8-bom",
    "decoder-undeclared-utf8",
    "decoder-undeclared-windows1252",
    "decoder-unsupported",
    "decoder-bom-conflict",
    "decoder-sniff-exact-boundary",
    "decoder-sniff-crossing-boundary",
    "markup-tolerated",
    "markup-quarantined",
  ],
};

const specs = [];
const addCase = (caseId, area, mutation, options = {}) => {
  specs.push({ caseId, area, mutation, ...options });
};

addCase("valid-item-202", "A", "item-202-one-exhibit-xbrl", {});
addCase("valid-two-exhibits", "A", "lowest-positive-sequence", {
  members: [
    m("sec.submissions", "sub-base", "submissions"),
    m("sec.filing-index", "index-two", "filing-index"),
    m("sec.primary-document", "primary-base", "primary-document"),
    m("sec.exhibit-99.1", "exhibit-a", "exhibit-a"),
    m("sec.exhibit-99.1", "exhibit-b", "exhibit-b"),
    m("sec.xbrl-instance", "xbrl-q1", "xbrl-instance"),
  ],
  primaryArtifactId: "exhibit-b",
});
addCase("valid-10q-inline-focus", "A", "form-10q-inline-focus", {
  sourceKind: "filing",
  accession: NEXT_ACCESSION,
  members: [
    m("sec.submissions", "sub-10q-next", "submissions"),
    m("sec.filing-index", "index-10q-next", "filing-index"),
    m("sec.primary-document", "primary-10q-next", "primary-document"),
  ],
  primaryArtifactId: "primary-10q-next",
  publishedAtMs: Date.parse("2026-05-08T07:30:00-04:00"),
  originalTimestamp: "2026-05-08T07:30:00-04:00",
});
addCase("valid-10k-separate-xbrl", "A", "form-10k-separate-focus", {
  sourceKind: "filing",
  accession: TEN_K_ACCESSION,
  fiscalPeriod: "2025-FY",
  members: [
    m("sec.submissions", "sub-10k", "submissions"),
    m("sec.filing-index", "index-10k", "filing-index"),
    m("sec.primary-document", "primary-10k", "primary-document"),
    m("sec.xbrl-instance", "xbrl-fy", "xbrl-instance"),
  ],
  primaryArtifactId: "primary-10k",
  publishedAtMs: Date.parse("2026-02-20T16:10:00-05:00"),
  originalTimestamp: "2026-02-20T16:10:00-05:00",
});
addCase("valid-linked-periodic", "A", "linked-periodic-matching-cik-period", {
  members: [...common8k(), m("sec.periodic-report", "periodic-match", "periodic-report")],
});
addCase("valid-next-morning-periodic", "A", "next-morning-independent-filing", {
  sourceKind: "filing",
  accession: NEXT_ACCESSION,
  asOfMs: Date.parse("2026-05-08T12:00:00Z"),
  members: [
    m("sec.submissions", "sub-10q-next", "submissions"),
    m("sec.filing-index", "index-10q-next", "filing-index"),
    m("sec.primary-document", "primary-10q-next", "primary-document"),
  ],
  primaryArtifactId: "primary-10q-next",
  publishedAtMs: Date.parse("2026-05-08T07:30:00-04:00"),
  originalTimestamp: "2026-05-08T07:30:00-04:00",
});

const baseMembers = common8k();
for (const [caseId, role] of [
  ["missing-submissions", "sec.submissions"],
  ["missing-filing-index", "sec.filing-index"],
  ["missing-primary-document", "sec.primary-document"],
  ["missing-exhibit", "sec.exhibit-99.1"],
  ["missing-fiscal-evidence", "sec.xbrl-instance"],
]) {
  addCase(caseId, "B", `missing-role:${role}`, {
    status: "quarantined",
    reasonCode: "sec.required-member-missing",
    bundleValidity: "invalid",
    members: baseMembers.filter((member) => member.role !== role),
    primaryArtifactId: role === "sec.exhibit-99.1" ? null : "exhibit-a",
  });
}
addCase("duplicate-singleton", "B", "duplicate-singleton:sec.submissions", {
  status: "quarantined",
  reasonCode: "sec.bundle-invalid",
  bundleValidity: "invalid",
  members: [...common8k(), m("sec.submissions", "sub-padded", "submissions-copy")],
});
addCase("duplicate-artifact-digest", "B", "duplicate-digest-across-roles", {
  status: "quarantined",
  reasonCode: "sec.bundle-invalid",
  bundleValidity: "invalid",
  members: [...common8k().slice(0, 4), m("sec.xbrl-instance", "exhibit-a", "xbrl-instance")],
});
addCase("primary-absent", "B", "primary-digest-absent", {
  status: "quarantined",
  reasonCode: "sec.bundle-invalid",
  bundleValidity: "invalid",
  primaryArtifactId: "exhibit-b",
});
addCase("primary-wrong-role", "B", "primary-digest-under-wrong-role", {
  status: "quarantined",
  reasonCode: "sec.bundle-invalid",
  bundleValidity: "invalid",
  members: [
    m("sec.submissions", "sub-base", "submissions"),
    m("sec.filing-index", "index-two", "filing-index"),
    m("sec.primary-document", "exhibit-a", "primary-document"),
    m("sec.exhibit-99.1", "exhibit-b", "exhibit-b"),
    m("sec.xbrl-instance", "xbrl-q1", "xbrl-instance"),
  ],
  primaryArtifactId: "exhibit-a",
});
addCase("tied-exhibit-sequence", "B", "tied-positive-sequence", {
  status: "quarantined",
  reasonCode: "sec.bundle-invalid",
  bundleValidity: "invalid",
  members: [
    m("sec.submissions", "sub-base", "submissions"),
    m("sec.filing-index", "index-tied", "filing-index"),
    m("sec.primary-document", "primary-base", "primary-document"),
    m("sec.exhibit-99.1", "exhibit-a", "exhibit-a"),
    m("sec.exhibit-99.1", "exhibit-b", "exhibit-b"),
    m("sec.xbrl-instance", "xbrl-q1", "xbrl-instance"),
  ],
  primaryArtifactId: null,
});
addCase("conflicting-exhibit-sequence", "B", "conflicting-sequence-for-member", {
  status: "quarantined",
  reasonCode: "sec.bundle-invalid",
  bundleValidity: "invalid",
  members: [
    m("sec.submissions", "sub-base", "submissions"),
    m("sec.filing-index", "index-conflicting", "filing-index"),
    m("sec.primary-document", "primary-base", "primary-document"),
    m("sec.exhibit-99.1", "exhibit-a", "exhibit-a"),
    m("sec.exhibit-99.1", "exhibit-b", "exhibit-b"),
    m("sec.xbrl-instance", "xbrl-q1", "xbrl-instance"),
  ],
  primaryArtifactId: null,
});
const limitExhibits = Array.from({ length: 13 }, (_, index) =>
  m(
    "sec.exhibit-99.1",
    `exhibit-limit-${index + 1}`,
    `exhibit-${String(index + 1).padStart(2, "0")}`,
  ),
);
addCase("more-than-16-members", "B", "seventeen-distinct-members", {
  status: "quarantined",
  reasonCode: "sec.member-limit-exceeded",
  bundleValidity: "invalid",
  members: [
    m("sec.submissions", "sub-base", "submissions"),
    m("sec.filing-index", "index-17", "filing-index"),
    m("sec.primary-document", "primary-base", "primary-document"),
    m("sec.xbrl-instance", "xbrl-q1", "xbrl-instance"),
    ...limitExhibits,
  ],
  primaryArtifactId: "exhibit-limit-1",
});
addCase("unknown-sec-role", "B", "unknown-role", {
  status: "quarantined",
  reasonCode: "sec.bundle-invalid",
  bundleValidity: "invalid",
  members: [...common8k().slice(0, 4), m("sec.unknown", "xbrl-q1", "xbrl-instance")],
});

addCase("non-earnings-8k", "C", "8k-without-item-202", {
  status: "ignored",
  reasonCode: "sec.not-earnings-related",
  members: common8k({ submissions: "sub-no-item", index: "index-no-item" }),
});
addCase("padded-cik", "C", "padded-cik-bytes", {
  members: common8k({ submissions: "sub-padded" }),
});
addCase("unpadded-cik", "C", "unpadded-cik-bytes", {});
addCase("accession-prefix-different", "C", "accession-prefix-not-subject", {
  accession: PREFIX_ACCESSION,
  members: common8k({ submissions: "sub-prefix", index: "index-prefix" }),
});
addCase("subject-cik-missing", "C", "subject-cik-absent-from-metadata", {
  status: "quarantined",
  reasonCode: "sec.identity-mismatch",
  members: common8k({
    submissions: "sub-no-cik",
    index: "index-no-cik",
    primary: "primary-no-cik",
    xbrl: "xbrl-no-cik",
  }),
});
addCase("subject-cik-conflict", "C", "xbrl-subject-cik-conflict", {
  status: "quarantined",
  reasonCode: "sec.subject-cik-conflict",
  members: common8k({ xbrl: "xbrl-foreign" }),
});
addCase("linked-periodic-foreign-cik", "C", "linked-periodic-foreign-cik", {
  status: "quarantined",
  reasonCode: "sec.subject-cik-conflict",
  members: [...common8k(), m("sec.periodic-report", "periodic-foreign", "periodic-report")],
});
addCase("linked-periodic-different-period", "C", "linked-periodic-conflicting-focus", {
  status: "ignored",
  reasonCode: "sec.fiscal-period-ambiguous",
  members: [...common8k(), m("sec.periodic-report", "periodic-q2", "periodic-report")],
});
addCase("absent-fiscal-focus", "C", "included-xbrl-missing-focus", {
  status: "ignored",
  reasonCode: "sec.fiscal-period-ambiguous",
  members: common8k({ xbrl: "xbrl-no-focus" }),
});
addCase("conflicting-fiscal-focus", "C", "included-xbrl-conflicting-focus", {
  status: "ignored",
  reasonCode: "sec.fiscal-period-ambiguous",
  members: common8k({ xbrl: "xbrl-conflict" }),
});
addCase("exact-provider-redelivery", "C", "exact-domain-redelivery", {
  relationCaseId: "valid-item-202",
});
addCase("amendment-8ka-distinct-accession", "C", "form-8ka-distinct-accession", {
  accession: AMENDMENT_ACCESSION,
  members: common8k({ submissions: "sub-amendment", index: "index-amendment" }),
});
addCase("amendment-10qa-distinct-accession", "C", "form-10qa-distinct-accession", {
  sourceKind: "filing",
  accession: TEN_QA_ACCESSION,
  members: [
    m("sec.submissions", "sub-10qa", "submissions"),
    m("sec.filing-index", "index-10qa", "filing-index"),
    m("sec.primary-document", "primary-10qa", "primary-document"),
  ],
  primaryArtifactId: "primary-10qa",
  publishedAtMs: Date.parse("2026-05-12T09:00:00-04:00"),
  originalTimestamp: "2026-05-12T09:00:00-04:00",
});
addCase("amendment-10ka-distinct-accession", "C", "form-10ka-distinct-accession", {
  sourceKind: "filing",
  accession: TEN_KA_ACCESSION,
  fiscalPeriod: "2025-FY",
  members: [
    m("sec.submissions", "sub-10ka", "submissions"),
    m("sec.filing-index", "index-10ka", "filing-index"),
    m("sec.primary-document", "primary-10ka", "primary-document"),
    m("sec.xbrl-instance", "xbrl-fy", "xbrl-instance"),
  ],
  primaryArtifactId: "primary-10ka",
  publishedAtMs: Date.parse("2026-02-25T09:00:00-05:00"),
  originalTimestamp: "2026-02-25T09:00:00-05:00",
});
addCase("record-revision-conflicting-primary", "C", "same-record-different-primary-bytes", {
  status: "quarantined",
  reasonCode: "sec.identity-mismatch",
  members: common8k({ exhibit: "exhibit-conflict" }),
  primaryArtifactId: "exhibit-conflict",
  relationCaseId: "valid-item-202",
});

addCase("observation-at-asof", "D", "selected-observation-at-asof", { observationMode: "at-asof" });
addCase("observation-after-asof", "D", "selected-observation-one-ms-future", {
  status: "quarantined",
  reasonCode: "sec.observation-invalid",
  observationMode: "future",
});
addCase("observation-missing-selected", "D", "selected-id-unresolved", {
  status: "quarantined",
  reasonCode: "sec.observation-invalid",
  observationMode: "unresolved",
});
addCase("observation-digest-mismatch", "D", "selected-observation-digest-mismatch", {
  status: "quarantined",
  reasonCode: "sec.observation-invalid",
  observationMode: "digest-mismatch",
});
addCase("observation-wrong-provider", "D", "selected-observation-wrong-provider", {
  status: "quarantined",
  reasonCode: "sec.observation-invalid",
  observationMode: "wrong-provider",
});
addCase("observation-id-reused", "D", "selected-observation-id-reused", {
  status: "quarantined",
  reasonCode: "sec.observation-invalid",
  observationMode: "reused",
});
addCase("observation-identical-bytes-a", "D", "eligible-observation-a", {
  observationMode: "eligible-a",
  relationCaseId: "observation-identical-bytes-b",
});
addCase("observation-identical-bytes-b", "D", "eligible-observation-b", {
  observationMode: "eligible-b",
  relationCaseId: "observation-identical-bytes-a",
});

addCase("timestamp-equivalent-rfc-and-eastern", "E", "equivalent-rfc-and-header", {});
addCase("timestamp-rfc-only", "E", "rfc-only", {
  members: common8k({ primary: "primary-no-time" }),
});
addCase("timestamp-header-standard", "E", "header-standard-time", {
  members: common8k({ submissions: "sub-no-time", primary: "primary-standard" }),
  publishedAtMs: Date.parse("2026-01-15T10:30:00-05:00"),
  timestampConfidence: "provider",
  originalTimestamp: "20260115103000",
});
addCase("timestamp-header-daylight", "E", "header-daylight-time", {
  members: common8k({ submissions: "sub-no-time" }),
  publishedAtMs: Date.parse("2026-05-07T20:15:30-04:00"),
  timestampConfidence: "provider",
  originalTimestamp: "20260507201530",
});
addCase("timestamp-missing", "E", "timestamp-absent", {
  members: common8k({ submissions: "sub-no-time", primary: "primary-no-time" }),
  publishedAtMs: null,
  timestampConfidence: "unknown",
  originalTimestamp: null,
});
addCase("timestamp-conflict", "E", "valid-timestamp-candidates-conflict", {
  status: "quarantined",
  reasonCode: "sec.timestamp-conflict",
  members: common8k({ primary: "primary-conflict" }),
});
addCase("timestamp-malformed", "E", "malformed-rfc-and-header-candidates", {
  status: "quarantined",
  reasonCode: "sec.timestamp-invalid",
  members: common8k({
    submissions: "sub-malformed-time",
    primary: "primary-malformed-time",
  }),
});
for (const [caseId, mutation, primaryId] of [
  ["timestamp-pre-2007", "unsupported-pre-2007-header", "primary-pre2007"],
  ["timestamp-filing-date-only", "filing-date-excluded", "primary-filing-date"],
  ["timestamp-retrieval-excluded", "retrieval-time-excluded", "primary-no-time"],
]) {
  addCase(caseId, "E", mutation, {
    members: common8k({ submissions: "sub-no-time", primary: primaryId }),
    publishedAtMs: null,
    timestampConfidence: "unknown",
    originalTimestamp: null,
    observationMode: caseId === "timestamp-retrieval-excluded" ? "retrieval-distinct" : undefined,
  });
}
addCase("timestamp-linked-periodic-excluded", "E", "linked-periodic-time-excluded", {
  members: [...common8k(), m("sec.periodic-report", "primary-10q-next", "periodic-report")],
});

for (const label of decoderAliases) {
  addCase(`decoder-accepted-${label}`, "F", `accepted-decoder-alias:${label}`, {
    members: common8k({ exhibit: `decoder-${label}` }),
    primaryArtifactId: `decoder-${label}`,
    decoder: {
      vector: "declared",
      label,
      canonical: ["utf-8", "utf8", "unicode-1-1-utf-8"].includes(label) ? "utf-8" : "windows-1252",
    },
  });
}
addCase("decoder-utf8-bom", "F", "utf8-bom-precedence", {
  members: common8k({ exhibit: "decoder-bom" }),
  primaryArtifactId: "decoder-bom",
  decoder: { vector: "bom", label: "utf-8", canonical: "utf-8" },
});
addCase("decoder-undeclared-utf8", "F", "undeclared-fatal-utf8-success", {
  members: common8k({ exhibit: "decoder-undeclared-utf8" }),
  primaryArtifactId: "decoder-undeclared-utf8",
  decoder: { vector: "undeclared", label: null, canonical: "utf-8" },
});
addCase("decoder-undeclared-windows1252", "F", "undeclared-windows1252-fallback", {
  members: common8k({ exhibit: "decoder-undeclared-1252" }),
  primaryArtifactId: "decoder-undeclared-1252",
  decoder: { vector: "fallback", label: null, canonical: "windows-1252" },
});
addCase("decoder-unsupported", "F", "unsupported-declaration", {
  status: "quarantined",
  reasonCode: "sec.unsupported-encoding",
  members: common8k({ exhibit: "decoder-unsupported" }),
  primaryArtifactId: "decoder-unsupported",
  decoder: { vector: "unsupported", label: "koi8-r", canonical: null },
});
addCase("decoder-bom-conflict", "F", "bom-declaration-conflict", {
  status: "quarantined",
  reasonCode: "sec.unsupported-encoding",
  members: common8k({ exhibit: "decoder-bom-conflict" }),
  primaryArtifactId: "decoder-bom-conflict",
  decoder: { vector: "bom-conflict", label: "windows-1252", canonical: null },
});
addCase("decoder-sniff-exact-boundary", "F", "declaration-ends-at-byte-1024", {
  members: common8k({ exhibit: "decoder-sniff-exact" }),
  primaryArtifactId: "decoder-sniff-exact",
  decoder: { vector: "sniff-exact", label: "utf-8", canonical: "utf-8" },
});
addCase("decoder-sniff-crossing-boundary", "F", "declaration-crosses-byte-1024", {
  members: common8k({ exhibit: "decoder-sniff-crossing" }),
  primaryArtifactId: "decoder-sniff-crossing",
  decoder: { vector: "sniff-crossing", label: null, canonical: "utf-8" },
});
addCase("markup-tolerated", "F", "tolerated-html-recovery", {
  members: common8k({ exhibit: "markup-tolerated" }),
  primaryArtifactId: "markup-tolerated",
});
addCase("markup-quarantined", "F", "mismatched-required-xml", {
  status: "quarantined",
  reasonCode: "sec.malformed-markup",
  members: common8k({ xbrl: "xbrl-malformed" }),
});

function makeObservation(spec, member, artifact, index, recordId, revisionId, asOfMs) {
  const mode = spec.observationMode ?? "normal";
  const attemptId = `attempt:${spec.caseId}:${index + 1}:${mode}`;
  const startedAtMs = asOfMs - 2_000 - index;
  let retrievedAtMs = asOfMs - 1_000 - index;
  if (mode === "at-asof" && index === 0) retrievedAtMs = asOfMs;
  if (mode === "future" && index === 0) retrievedAtMs = asOfMs + 1;
  if (mode === "retrieval-distinct" && index === 0) retrievedAtMs = asOfMs - 1;
  if (mode === "eligible-a") retrievedAtMs = asOfMs - 2_000 - index;
  if (mode === "eligible-b") retrievedAtMs = asOfMs - 1_000 - index;
  let artifactDigest = artifact.artifactHash;
  if (mode === "digest-mismatch" && index === 0) artifactDigest = "0".repeat(64);
  const response = responseFor(artifact);
  const observationId = canonicalHash("peas/artifact-observation-id/v1", {
    attemptId,
    artifactDigest,
    response,
  });
  if (mode === "unresolved" && index === 0) {
    return {
      retrievalAttempt: { attemptId, startedAtMs, requestIdentityHash: request.identityHash },
      selectedObservationId: canonicalHash("peas/sec-unresolved-observation/v1", {
        caseId: spec.caseId,
        memberKey: member.memberKey,
      }),
      selectedObservation: null,
      response,
    };
  }
  const provider = mode === "wrong-provider" && index === 0 ? "synthetic-other" : "sec-edgar";
  const raw = {
    observationId,
    attemptId,
    artifactDigest,
    provider,
    recordId,
    revisionId,
    retrievedAtMs,
    request,
    response,
  };
  return {
    retrievalAttempt: { attemptId, startedAtMs, requestIdentityHash: request.identityHash },
    selectedObservationId: observationId,
    selectedObservation: {
      observationId,
      provider,
      artifactDigest,
      retrievedAtMs,
      observationHash: canonicalHash("peas/artifact-observation/v1", raw),
    },
    response,
  };
}

function boundaryTokenMarkup(count) {
  const base = ["<?fixture?>", "<root>", "<!--comment-->", "<![CDATA[cdata]]>", "text"];
  let remaining = count - 6;
  const odd = remaining % 2;
  remaining -= odd;
  return Buffer.from(
    `${base.join("")}${"<x></x>".repeat(remaining / 2)}${odd ? "<!--extra-->" : ""}</root>`,
    "utf8",
  );
}

function boundaryPayload(kind, value) {
  switch (kind) {
    case "member-bytes":
      return Buffer.alloc(value, value % 251);
    case "semantic-tokens":
      return boundaryTokenMarkup(value);
    case "markup-depth":
      return Buffer.from(`${"<x>".repeat(value)}${"</x>".repeat(value)}`, "utf8");
    case "attributes-per-tag":
      return Buffer.from(
        `<x ${Array.from({ length: value }, (_, index) => `a${index}="v"`).join(" ")}>`,
        "utf8",
      );
    case "extracted-text-bytes":
      return Buffer.concat([
        Buffer.from("<r>", "ascii"),
        Buffer.alloc(value, 0x78),
        Buffer.from("</r>", "ascii"),
      ]);
    case "transcript-bytes": {
      const empty = canonicalJson({ entries: "" });
      return Buffer.from(
        canonicalJson({ entries: "x".repeat(value - Buffer.byteLength(empty)) }),
        "utf8",
      );
    }
    default:
      throw new Error(`Unknown boundary kind ${kind}`);
  }
}

function multiMemberBoundary(count, sizes, roleMode = "bundle") {
  const members = Array.from({ length: count }, (_, index) => {
    const bytes = Buffer.alloc(sizes[index] ?? sizes[0], 0x31 + index);
    const role =
      index === 0
        ? "sec.submissions"
        : index === 1
          ? "sec.filing-index"
          : index === 2
            ? "sec.primary-document"
            : index === 3 && roleMode === "bundle"
              ? "sec.xbrl-instance"
              : "sec.exhibit-99.1";
    return { role, sizeBytes: bytes.byteLength, artifactHash: sha256(bytes) };
  });
  return {
    members,
    hash: canonicalHash("peas/sec-generated-members/v1", members),
    totalBytes: members.reduce((total, member) => total + member.sizeBytes, 0),
  };
}

const boundarySpecs = [
  ["member-bytes-exact", "member-bytes", 10 * 1024 * 1024, "within-limit", null, null],
  [
    "member-bytes-one-over",
    "member-bytes",
    10 * 1024 * 1024 + 1,
    "over-limit",
    "sec.member-limit-exceeded",
    null,
  ],
  ["semantic-tokens-exact", "semantic-tokens", 250_000, "within-limit", null, null],
  [
    "semantic-tokens-one-over",
    "semantic-tokens",
    250_001,
    "over-limit",
    "sec.parse-limit-exceeded",
    "markup-tokens",
  ],
  ["markup-depth-exact", "markup-depth", 256, "within-limit", null, null],
  [
    "markup-depth-one-over",
    "markup-depth",
    257,
    "over-limit",
    "sec.parse-limit-exceeded",
    "markup-depth",
  ],
  ["attributes-per-tag-exact", "attributes-per-tag", 256, "within-limit", null, null],
  [
    "attributes-per-tag-one-over",
    "attributes-per-tag",
    257,
    "over-limit",
    "sec.parse-limit-exceeded",
    "attributes-per-tag",
  ],
  [
    "extracted-text-bytes-exact",
    "extracted-text-bytes",
    4 * 1024 * 1024,
    "within-limit",
    null,
    null,
  ],
  [
    "extracted-text-bytes-one-over",
    "extracted-text-bytes",
    4 * 1024 * 1024 + 1,
    "over-limit",
    "sec.parse-limit-exceeded",
    "extracted-text-bytes",
  ],
  ["transcript-bytes-exact", "transcript-bytes", 256 * 1024, "within-limit", null, null],
  ["transcript-bytes-one-over", "transcript-bytes", 256 * 1024 + 1, "over-limit", null, null],
];
const boundaryVectors = boundarySpecs.map(
  ([vectorId, generatorKind, value, status, reasonCode, limitKind]) => {
    const bytes = boundaryPayload(generatorKind, value);
    return {
      vectorId,
      generatorKind,
      value,
      expectedBytes: bytes.byteLength,
      expectedHash: sha256(bytes),
      expected: { status, reasonCode, limitKind },
    };
  },
);
for (const [vectorId, count, sizes, status, reasonCode, roleMode] of [
  ["bundle-bytes-exact", 4, [8 * 1024 * 1024], "within-limit", null, "bundle"],
  [
    "bundle-bytes-one-over",
    4,
    [8 * 1024 * 1024, 8 * 1024 * 1024, 8 * 1024 * 1024, 8 * 1024 * 1024 + 1],
    "over-limit",
    "sec.bundle-byte-limit-exceeded",
    "bundle",
  ],
  ["member-count-exact-16", 16, [32], "within-limit", null, "member-count"],
  ["member-count-one-over-17", 17, [32], "over-limit", "sec.member-limit-exceeded", "member-count"],
]) {
  const generated = multiMemberBoundary(count, sizes, roleMode);
  boundaryVectors.push({
    vectorId,
    generatorKind: roleMode === "bundle" ? "bundle-members" : "distinct-members",
    value: count,
    memberSizes: sizes,
    expectedBytes: generated.totalBytes,
    expectedHash: generated.hash,
    expectedMemberHashes: generated.members.map((member) => member.artifactHash),
    expected: { status, reasonCode, limitKind: null },
  });
}

const cases = specs.map((spec, caseIndex) => {
  const sourceKind = spec.sourceKind ?? "sec_8k";
  const accession = spec.accession ?? BASE_ACCESSION;
  const subjectCik = spec.subjectCik ?? "0000123456";
  const fiscalPeriod = spec.fiscalPeriod ?? "2026-Q1";
  const asOfMs = spec.asOfMs ?? Date.parse("2026-05-08T01:00:00Z");
  const provider = "sec-edgar";
  const source = "sec:normalizer-v1";
  const recordId = `sec:${accession}:${sourceKind === "filing" ? "periodic-source" : "earnings-source"}-v2`;
  const revisionId = "1";
  const memberSpecs = spec.members ?? common8k();
  const members = memberSpecs.map((member, index) => {
    const artifact = artifacts[member.artifactId];
    if (artifact === undefined) throw new Error(`Unknown artifact ${member.artifactId}`);
    return {
      role: member.role,
      memberKey: member.memberKey,
      ...artifact,
      ...makeObservation(spec, member, artifact, index, recordId, revisionId, asOfMs),
    };
  });
  if (spec.observationMode === "reused" && members.length > 1) {
    members[1] = {
      ...members[1],
      selectedObservationId: members[0].selectedObservationId,
      selectedObservation: members[0].selectedObservation,
    };
  }
  const presentationOrder = members.map((_, index) => (index * 3 + 1) % members.length);
  if (new Set(presentationOrder).size !== members.length) {
    presentationOrder.splice(
      0,
      presentationOrder.length,
      ...members.map((_, index) => members.length - 1 - index),
    );
  }
  const primaryArtifactId =
    spec.primaryArtifactId === undefined
      ? sourceKind === "filing"
        ? memberSpecs.find((member) => member.role === "sec.primary-document")?.artifactId
        : "exhibit-a"
      : spec.primaryArtifactId;
  const expectedPrimaryArtifactHash =
    primaryArtifactId === null || primaryArtifactId === undefined
      ? null
      : artifacts[primaryArtifactId].artifactHash;
  const bundleValidity = spec.bundleValidity ?? "valid";
  const evidence = members
    .map((member) => ({ role: member.role, artifactHash: member.artifactHash }))
    .sort(
      (left, right) =>
        codeUnitCompare(left.role, right.role) ||
        codeUnitCompare(left.artifactHash, right.artifactHash),
    );
  const evidenceBundleHash =
    bundleValidity === "valid"
      ? canonicalHash("peas/provider-evidence-bundle/v1", {
          provider,
          source,
          recordId,
          revisionId,
          subject: `earnings:${subjectCik.padStart(10, "0")}:${fiscalPeriod}`,
          issuerCik: subjectCik.padStart(10, "0"),
          fiscalPeriod,
          sourceKind,
          primaryArtifactHash: expectedPrimaryArtifactHash,
          evidence,
        })
      : null;
  const selectedEvidence = [...members]
    .sort(
      (left, right) =>
        codeUnitCompare(left.role, right.role) ||
        codeUnitCompare(left.artifactHash, right.artifactHash),
    )
    .map((member) => ({
      role: member.role,
      artifactHash: member.artifactHash,
      selectedObservationId: member.selectedObservationId,
      observationHash: member.selectedObservation?.observationHash ?? null,
      retrievedAtMs: member.selectedObservation?.retrievedAtMs ?? null,
    }));
  const loaderSelectionHash = canonicalHash("peas/sec-loader-selection/v1", {
    loader: "sec-recorded-loader-v1",
    asOfMs,
    selectedEvidence,
  });
  const loaderFailed = spec.reasonCode === "sec.observation-invalid";
  const loaderStatus = loaderFailed ? "quarantined" : "verified";
  const loaderTranscriptHash = canonicalHash("peas/sec-loader-transcript/v1", {
    loader: "sec-recorded-loader-v1",
    selectionHash: loaderSelectionHash,
    bundleHash: evidenceBundleHash,
    status: loaderStatus,
    reasonCode: loaderFailed ? "sec.observation-invalid" : null,
    limitKind: null,
    outputHash: null,
  });
  const status = spec.status ?? "emitted";
  const publishedAtMs =
    spec.publishedAtMs === undefined ? Date.parse("2026-05-07T20:15:30-04:00") : spec.publishedAtMs;
  const timestampConfidence =
    spec.timestampConfidence ?? (publishedAtMs === null ? "unknown" : "exact");
  const originalTimestamp =
    spec.originalTimestamp === undefined
      ? publishedAtMs === null
        ? null
        : "2026-05-07T20:15:30-04:00"
      : spec.originalTimestamp;
  return {
    caseId: spec.caseId,
    area: spec.area,
    structuralMutation: spec.mutation,
    relationCaseId: spec.relationCaseId ?? null,
    sourceKind,
    accession,
    subjectCik,
    fiscalPeriod,
    asOfMs,
    provider,
    source,
    recordId,
    revisionId,
    members,
    presentationOrder,
    expectedPrimaryArtifactHash,
    decoder: spec.decoder ?? null,
    expected: {
      status,
      reasonCode: spec.reasonCode ?? null,
      limitKind: spec.limitKind ?? null,
      issuerCik: status === "emitted" ? subjectCik.padStart(10, "0") : null,
      fiscalPeriod: status === "emitted" ? fiscalPeriod : null,
      publishedAtMs: status === "emitted" ? publishedAtMs : null,
      timestampConfidence: status === "emitted" ? timestampConfidence : null,
      originalTimestamp: status === "emitted" ? originalTimestamp : null,
      bundleValidity,
      evidenceBundleHash,
      loaderStatus,
      loaderSelectionHash,
      loaderTranscriptHash,
      outputHash: status === "emitted" ? "required-non-null" : null,
    },
    ordinal: caseIndex + 1,
  };
});

const artifactList = Object.values(artifacts).sort((left, right) =>
  codeUnitCompare(left.artifactId, right.artifactId),
);
const generatedPaths = ["manifest.ts", ...artifactList.map((artifact) => artifact.path)].sort(
  codeUnitCompare,
);
const generatorSourceHash = normalizedSourceHash();
const manifest = {
  version: "sec-fixture-contract-v1",
  generatorSourceHash,
  generatedPaths,
  loaderIdentity: "sec-recorded-loader-v1",
  decoderPolicy: "sec-decoder-v1",
  sniffWindowBytes: 1024,
  artifacts: artifactList,
  requiredCaseIds,
  cases,
  generatedBoundaryVectors: boundaryVectors,
};
const manifestHash = canonicalHash("peas/sec-fixture-manifest/v1", manifest);

const source = `export type FixtureStatus = "emitted" | "ignored" | "quarantined";
export type FixtureArea = "A" | "B" | "C" | "D" | "E" | "F";
export type FixtureLimitKind =
  | "markup-tokens"
  | "markup-depth"
  | "attributes-per-tag"
  | "extracted-text-bytes"
  | null;

export type SecFixtureArtifact = Readonly<{
  artifactId: string;
  path: string;
  mediaType: string;
  sizeBytes: number;
  artifactHash: string;
}>;

export type SecFixtureObservation = Readonly<{
  observationId: string;
  provider: string;
  artifactDigest: string;
  retrievedAtMs: number;
  observationHash: string;
}>;

export type SecFixtureMember = SecFixtureArtifact & Readonly<{
  role: string;
  memberKey: string;
  retrievalAttempt: Readonly<{
    attemptId: string;
    startedAtMs: number;
    requestIdentityHash: string;
  }>;
  selectedObservationId: string;
  selectedObservation: SecFixtureObservation | null;
  response: Readonly<{
    statusCode: number;
    etag: null;
    lastModified: null;
    mediaType: string;
    contentEncoding: null;
    declaredContentLength: number;
    transportDecoded: true;
  }>;
}>;

export type SecFixtureCase = Readonly<{
  caseId: string;
  area: FixtureArea;
  structuralMutation: string;
  relationCaseId: string | null;
  sourceKind: "sec_8k" | "filing";
  accession: string;
  subjectCik: string;
  fiscalPeriod: string;
  asOfMs: number;
  provider: "sec-edgar";
  source: "sec:normalizer-v1";
  recordId: string;
  revisionId: "1";
  members: readonly SecFixtureMember[];
  presentationOrder: readonly number[];
  expectedPrimaryArtifactHash: string | null;
  decoder: Readonly<{
    vector: string;
    label: string | null;
    canonical: "utf-8" | "windows-1252" | null;
  }> | null;
  expected: Readonly<{
    status: FixtureStatus;
    reasonCode: string | null;
    limitKind: FixtureLimitKind;
    issuerCik: string | null;
    fiscalPeriod: string | null;
    publishedAtMs: number | null;
    timestampConfidence: "exact" | "provider" | "unknown" | null;
    originalTimestamp: string | null;
    bundleValidity: "valid" | "invalid";
    evidenceBundleHash: string | null;
    loaderStatus: "verified" | "quarantined";
    loaderSelectionHash: string;
    loaderTranscriptHash: string;
    outputHash: "required-non-null" | null;
  }>;
  ordinal: number;
}>;

export type SecGeneratedBoundaryVector = Readonly<{
  vectorId: string;
  generatorKind: string;
  value: number;
  memberSizes?: readonly number[];
  expectedBytes: number;
  expectedHash: string;
  expectedMemberHashes?: readonly string[];
  expected: Readonly<{
    status: "within-limit" | "over-limit";
    reasonCode: string | null;
    limitKind: FixtureLimitKind;
  }>;
}>;

export const SEC_FIXTURE_ARTIFACTS: readonly SecFixtureArtifact[] = ${JSON.stringify(artifactList, null, 2)} as const;

export const SEC_REQUIRED_CASE_IDS = ${JSON.stringify(requiredCaseIds, null, 2)} as const;

export const SEC_FIXTURE_CASES: readonly SecFixtureCase[] = ${JSON.stringify(cases, null, 2)} as const;

export const SEC_GENERATED_BOUNDARY_VECTORS: readonly SecGeneratedBoundaryVector[] = ${JSON.stringify(boundaryVectors, null, 2)} as const;

export const SEC_FIXTURE_GENERATOR_SOURCE_HASH = ${JSON.stringify(generatorSourceHash)};

export const SEC_FIXTURE_GENERATED_PATHS: readonly string[] = ${JSON.stringify(generatedPaths, null, 2)} as const;

export const SEC_FIXTURE_MANIFEST = {
  version: "sec-fixture-contract-v1",
  generatorSourceHash: SEC_FIXTURE_GENERATOR_SOURCE_HASH,
  generatedPaths: SEC_FIXTURE_GENERATED_PATHS,
  loaderIdentity: "sec-recorded-loader-v1",
  decoderPolicy: "sec-decoder-v1",
  sniffWindowBytes: 1024,
  artifacts: SEC_FIXTURE_ARTIFACTS,
  requiredCaseIds: SEC_REQUIRED_CASE_IDS,
  cases: SEC_FIXTURE_CASES,
  generatedBoundaryVectors: SEC_GENERATED_BOUNDARY_VECTORS,
} as const;

export const SEC_FIXTURE_MANIFEST_HASH = ${JSON.stringify(manifestHash)};
`;

writeFileSync(path.join(ROOT, "manifest.ts"), formattedManifest(source), "utf8");
verifyGeneratedTree(ROOT, generatedPaths);
promoteGeneratedTree(ROOT, TARGET_ROOT, generatedPaths);
cleanupStagingRoot();
