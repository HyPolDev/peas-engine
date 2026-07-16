import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  SEC_FIXTURE_ARTIFACTS,
  SEC_FIXTURE_CASES,
  SEC_FIXTURE_GENERATED_PATHS,
  SEC_FIXTURE_GENERATOR_SOURCE_HASH,
  SEC_FIXTURE_MANIFEST,
  SEC_FIXTURE_MANIFEST_HASH,
  SEC_GENERATED_BOUNDARY_VECTORS,
  SEC_REQUIRED_CASE_IDS,
  type SecFixtureCase,
  type SecFixtureMember,
} from "../fixtures/sec/v1/manifest.js";
import { deriveObservationId, sanitizeRequestIdentity } from "../src/artifacts/identity.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";

const ROOT = path.resolve("fixtures/sec/v1");
const GENERATOR = path.join(ROOT, "generate-contract.mjs");
const GENERATOR_TEST_HANDSHAKE = "sec-fixture-generator-test-v1";
const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_MEMBER_BYTES = 10 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 256 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const VALID_ROLES = new Set([
  "sec.submissions",
  "sec.filing-index",
  "sec.primary-document",
  "sec.exhibit-99.1",
  "sec.periodic-report",
  "sec.xbrl-instance",
]);
const REQUEST = sanitizeRequestIdentity({
  method: "GET",
  origin: "https" + ":" + "//fixture.invalid",
  path: "/recorded",
  routeLabel: "recorded-sec-fixture",
});

type ExpectedCase = readonly [
  caseId: string,
  status: "emitted" | "ignored" | "quarantined",
  reasonCode: string | null,
];

const EXPECTED_CASE_MATRIX: Readonly<
  Record<"A" | "B" | "C" | "D" | "E" | "F", readonly ExpectedCase[]>
> = {
  A: [
    ["valid-item-202", "emitted", null],
    ["valid-two-exhibits", "emitted", null],
    ["valid-10q-inline-focus", "emitted", null],
    ["valid-10k-separate-xbrl", "emitted", null],
    ["valid-linked-periodic", "emitted", null],
    ["valid-next-morning-periodic", "emitted", null],
  ],
  B: [
    ["missing-submissions", "quarantined", "sec.required-member-missing"],
    ["missing-filing-index", "quarantined", "sec.required-member-missing"],
    ["missing-primary-document", "quarantined", "sec.required-member-missing"],
    ["missing-exhibit", "quarantined", "sec.required-member-missing"],
    ["missing-fiscal-evidence", "quarantined", "sec.required-member-missing"],
    ["duplicate-singleton", "quarantined", "sec.bundle-invalid"],
    ["duplicate-artifact-digest", "quarantined", "sec.bundle-invalid"],
    ["primary-absent", "quarantined", "sec.bundle-invalid"],
    ["primary-wrong-role", "quarantined", "sec.bundle-invalid"],
    ["tied-exhibit-sequence", "quarantined", "sec.bundle-invalid"],
    ["conflicting-exhibit-sequence", "quarantined", "sec.bundle-invalid"],
    ["more-than-16-members", "quarantined", "sec.member-limit-exceeded"],
    ["unknown-sec-role", "quarantined", "sec.bundle-invalid"],
  ],
  C: [
    ["non-earnings-8k", "ignored", "sec.not-earnings-related"],
    ["padded-cik", "emitted", null],
    ["unpadded-cik", "emitted", null],
    ["accession-prefix-different", "emitted", null],
    ["subject-cik-missing", "quarantined", "sec.identity-mismatch"],
    ["subject-cik-conflict", "quarantined", "sec.subject-cik-conflict"],
    ["linked-periodic-foreign-cik", "quarantined", "sec.subject-cik-conflict"],
    ["linked-periodic-different-period", "ignored", "sec.fiscal-period-ambiguous"],
    ["absent-fiscal-focus", "ignored", "sec.fiscal-period-ambiguous"],
    ["conflicting-fiscal-focus", "ignored", "sec.fiscal-period-ambiguous"],
    ["exact-provider-redelivery", "emitted", null],
    ["amendment-8ka-distinct-accession", "emitted", null],
    ["amendment-10qa-distinct-accession", "emitted", null],
    ["amendment-10ka-distinct-accession", "emitted", null],
    ["record-revision-conflicting-primary", "quarantined", "sec.identity-mismatch"],
  ],
  D: [
    ["observation-at-asof", "emitted", null],
    ["observation-after-asof", "quarantined", "sec.observation-invalid"],
    ["observation-missing-selected", "quarantined", "sec.observation-invalid"],
    ["observation-digest-mismatch", "quarantined", "sec.observation-invalid"],
    ["observation-wrong-provider", "quarantined", "sec.observation-invalid"],
    ["observation-id-reused", "quarantined", "sec.observation-invalid"],
    ["observation-identical-bytes-a", "emitted", null],
    ["observation-identical-bytes-b", "emitted", null],
  ],
  E: [
    ["timestamp-equivalent-rfc-and-eastern", "emitted", null],
    ["timestamp-rfc-only", "emitted", null],
    ["timestamp-header-standard", "emitted", null],
    ["timestamp-header-daylight", "emitted", null],
    ["timestamp-missing", "emitted", null],
    ["timestamp-conflict", "quarantined", "sec.timestamp-conflict"],
    ["timestamp-malformed", "quarantined", "sec.timestamp-invalid"],
    ["timestamp-pre-2007", "emitted", null],
    ["timestamp-filing-date-only", "emitted", null],
    ["timestamp-retrieval-excluded", "emitted", null],
    ["timestamp-linked-periodic-excluded", "emitted", null],
  ],
  F: [
    ["decoder-accepted-utf-8", "emitted", null],
    ["decoder-accepted-utf8", "emitted", null],
    ["decoder-accepted-unicode-1-1-utf-8", "emitted", null],
    ["decoder-accepted-windows-1252", "emitted", null],
    ["decoder-accepted-cp1252", "emitted", null],
    ["decoder-accepted-x-cp1252", "emitted", null],
    ["decoder-accepted-iso-8859-1", "emitted", null],
    ["decoder-accepted-iso8859-1", "emitted", null],
    ["decoder-accepted-latin1", "emitted", null],
    ["decoder-accepted-us-ascii", "emitted", null],
    ["decoder-utf8-bom", "emitted", null],
    ["decoder-undeclared-utf8", "emitted", null],
    ["decoder-undeclared-windows1252", "emitted", null],
    ["decoder-unsupported", "quarantined", "sec.unsupported-encoding"],
    ["decoder-bom-conflict", "quarantined", "sec.unsupported-encoding"],
    ["decoder-sniff-exact-boundary", "emitted", null],
    ["decoder-sniff-crossing-boundary", "emitted", null],
    ["markup-tolerated", "emitted", null],
    ["markup-quarantined", "quarantined", "sec.malformed-markup"],
  ],
};

const EXPECTED_BOUNDARY_MATRIX = [
  ["member-bytes-exact", "within-limit", null, null],
  ["member-bytes-one-over", "over-limit", "sec.member-limit-exceeded", null],
  ["semantic-tokens-exact", "within-limit", null, null],
  ["semantic-tokens-one-over", "over-limit", "sec.parse-limit-exceeded", "markup-tokens"],
  ["markup-depth-exact", "within-limit", null, null],
  ["markup-depth-one-over", "over-limit", "sec.parse-limit-exceeded", "markup-depth"],
  ["attributes-per-tag-exact", "within-limit", null, null],
  ["attributes-per-tag-one-over", "over-limit", "sec.parse-limit-exceeded", "attributes-per-tag"],
  ["extracted-text-bytes-exact", "within-limit", null, null],
  [
    "extracted-text-bytes-one-over",
    "over-limit",
    "sec.parse-limit-exceeded",
    "extracted-text-bytes",
  ],
  ["transcript-bytes-exact", "within-limit", null, null],
  ["transcript-bytes-one-over", "over-limit", null, null],
  ["bundle-bytes-exact", "within-limit", null, null],
  ["bundle-bytes-one-over", "over-limit", "sec.bundle-byte-limit-exceeded", null],
  ["member-count-exact-16", "within-limit", null, null],
  ["member-count-one-over-17", "over-limit", "sec.member-limit-exceeded", null],
] as const;

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function nonTemporaryStagingSentinel(): string {
  const temporaryRoot = path.resolve(os.tmpdir());
  const filesystemRoot = path.parse(temporaryRoot).root;
  const suffix = digest(Buffer.from(temporaryRoot, "utf8")).slice(0, 16);
  const sentinel = path.join(filesystemRoot, `__peas-sec-fixture-non-temp-${suffix}__`);
  assert.equal(insideRoot(temporaryRoot, sentinel), false);
  assert.notEqual(path.resolve(sentinel), temporaryRoot);
  return sentinel;
}

async function normalizedGeneratorSourceHash(): Promise<string> {
  const source = (await readFile(GENERATOR, "utf8")).replaceAll("\r\n", "\n");
  return digest(Buffer.from(source, "utf8"));
}

async function runGenerator(
  outputRoot: string,
  environment: Readonly<{ TZ: string; LANG: string; LC_ALL: string }>,
): Promise<void> {
  await runGeneratorArguments(["--output-root", outputRoot], environment);
}

async function runGeneratorArguments(
  arguments_: readonly string[],
  extraEnvironment: Readonly<Record<string, string>> = {},
): Promise<void> {
  await execFileAsync(process.execPath, [GENERATOR, ...arguments_], {
    cwd: path.resolve("."),
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...extraEnvironment },
  });
}

async function windowsShortPath(candidate: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$fso = New-Object -ComObject Scripting.FileSystemObject; $fso.GetFolder($env:PEAS_SEC_FIXTURE_ALIAS_PATH).ShortPath",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PEAS_SEC_FIXTURE_ALIAS_PATH: candidate },
      windowsHide: true,
    },
  );
  const result = stdout.trim();
  assert.notEqual(result, "", "Windows did not return a short-path identity");
  return result;
}

async function runTestGenerator(
  targetRoot: string,
  stagingParent: string,
  extraEnvironment: Readonly<Record<string, string>> = {},
): Promise<void> {
  await runGeneratorArguments(
    [
      "--test-mode",
      GENERATOR_TEST_HANDSHAKE,
      "--target-root",
      targetRoot,
      "--staging-parent",
      stagingParent,
      "--end-test-mode",
    ],
    {
      TZ: "UTC",
      LANG: "C",
      LC_ALL: "C",
      PEAS_SEC_FIXTURE_TEST_FORMAT_FAILURE: "",
      PEAS_SEC_FIXTURE_TEST_FORBID_FORMAT_ROOT: "",
      PEAS_SEC_FIXTURE_TEST_PROMOTION_FAILURE: "",
      ...extraEnvironment,
    },
  );
}

async function copyGeneratedTree(sourceRoot: string, targetRoot: string): Promise<void> {
  for (const relative of SEC_FIXTURE_GENERATED_PATHS) {
    const target = path.join(targetRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(sourceRoot, relative), target);
  }
}

async function generatedTreeSnapshot(root: string): Promise<Array<readonly [string, string]>> {
  const tree = await enumerateFixtureTree(root);
  assert.deepEqual(tree.directories, ["bodies"]);
  assert.deepEqual(tree.files, [...SEC_FIXTURE_GENERATED_PATHS]);
  return declaredGeneratedSnapshot(root);
}

async function declaredGeneratedSnapshot(root: string): Promise<Array<readonly [string, string]>> {
  return Promise.all(
    SEC_FIXTURE_GENERATED_PATHS.map(
      async (relative) =>
        [relative, (await readFile(path.join(root, relative))).toString("base64")] as const,
    ),
  );
}

async function completeTreeSnapshot(root: string): Promise<{
  directories: string[];
  files: Array<readonly [string, string]>;
}> {
  const tree = await enumerateFixtureTree(root);
  return {
    directories: tree.directories,
    files: await Promise.all(
      tree.files.map(
        async (relative) =>
          [relative, (await readFile(path.join(root, relative))).toString("base64")] as const,
      ),
    ),
  };
}

async function assertGeneratedTreeMatches(outputRoot: string): Promise<void> {
  const generatedTree = await enumerateFixtureTree(outputRoot);
  assert.deepEqual(generatedTree.directories, ["bodies"]);
  assert.deepEqual(generatedTree.files, [...SEC_FIXTURE_GENERATED_PATHS]);
  for (const relative of SEC_FIXTURE_GENERATED_PATHS) {
    assert.deepEqual(
      await readFile(path.join(outputRoot, relative)),
      await readFile(path.join(ROOT, relative)),
      `regenerated ${relative} differs from the checked-in byte contract`,
    );
  }
}

function caseById(caseId: string): SecFixtureCase {
  const fixture = SEC_FIXTURE_CASES.find((candidate) => candidate.caseId === caseId);
  assert.ok(fixture, `missing fixture case ${caseId}`);
  return fixture;
}

function memberByRole(
  fixture: SecFixtureCase,
  role: string,
  memberSequence: readonly SecFixtureMember[] = fixture.members,
): SecFixtureMember {
  const matching = memberSequence.filter((member) => member.role === role);
  assert.equal(matching.length, 1, `${fixture.caseId} requires one ${role} for this assertion`);
  const member = matching[0];
  assert.ok(member);
  return member;
}

async function bytesFor(member: SecFixtureMember): Promise<Buffer> {
  return readFile(path.join(ROOT, member.path));
}

async function jsonFor(member: SecFixtureMember): Promise<Record<string, unknown>> {
  return JSON.parse((await bytesFor(member)).toString("utf8")) as Record<string, unknown>;
}

async function markupFor(member: SecFixtureMember): Promise<string> {
  return (await bytesFor(member)).toString("utf8");
}

async function positiveSubjectCiks(member: SecFixtureMember): Promise<string[]> {
  const bytes = await bytesFor(member);
  const text = bytes.toString("utf8");
  const found: string[] = [];
  if (member.response.mediaType === "application/json") {
    const value = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["cik", "subjectCik"] as const) {
      const candidate = value[key];
      if (typeof candidate === "string" && /^\d+$/u.test(candidate) && Number(candidate) > 0) {
        found.push(candidate);
      }
    }
  } else {
    for (const match of text.matchAll(
      /<(?:SUBJECT-CIK|(?:[A-Za-z_][\w.-]*:)?EntityCentralIndexKey)>\s*(\d+)\s*<\//gu,
    )) {
      const candidate = match[1];
      if (candidate !== undefined && Number(candidate) > 0) found.push(candidate);
    }
  }
  return found;
}

function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

async function resolveFixturePath(root: string, relative: string): Promise<string> {
  assert.notEqual(relative, "");
  assert.equal(path.isAbsolute(relative), false, `${relative} must not be host-absolute`);
  assert.equal(path.win32.isAbsolute(relative), false, `${relative} must not be Windows-absolute`);
  assert.equal(path.posix.isAbsolute(relative), false, `${relative} must not be POSIX-absolute`);
  const parts = relative.split(/[\\/]+/u);
  assert.equal(
    parts.some((part) => part === "" || part === "." || part === ".."),
    false,
  );
  const rootReal = await realpath(root);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stats = await lstat(current);
    assert.equal(
      stats.isSymbolicLink(),
      false,
      `${relative} cannot contain a link/junction/reparse escape`,
    );
    const currentReal = await realpath(current);
    assert.equal(
      insideRoot(rootReal, currentReal),
      true,
      `${relative} resolves outside fixture root`,
    );
  }
  const finalStats = await lstat(current);
  assert.equal(finalStats.isFile(), true, `${relative} must resolve to a regular file`);
  return realpath(current);
}

async function enumerateFixtureTree(
  root = ROOT,
): Promise<{ files: string[]; directories: string[] }> {
  const files: string[] = [];
  const directories: string[] = [];
  const rootReal = await realpath(root);
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    assert.ok(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => codeUnitCompare(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      const stats = await lstat(absolute);
      assert.equal(entry.isSymbolicLink(), false, `${relative} is a link/junction/reparse point`);
      assert.equal(stats.isSymbolicLink(), false, `${relative} is a link/junction/reparse point`);
      const resolved = await realpath(absolute);
      assert.equal(
        insideRoot(rootReal, resolved),
        true,
        `${relative} resolves outside fixture root`,
      );
      if (entry.isDirectory()) {
        directories.push(relative);
        pending.push(absolute);
      } else {
        assert.equal(entry.isFile(), true, `${relative} must be a directory or regular file`);
        files.push(relative);
      }
    }
  }
  files.sort(codeUnitCompare);
  directories.sort(codeUnitCompare);
  return { files, directories };
}

function assertNoReparseFacts(reparsePaths: readonly string[]): void {
  assert.deepEqual(
    reparsePaths,
    [],
    `fixture tree contains Windows reparse entries: ${reparsePaths.join(", ")}`,
  );
}

async function windowsReparsePaths(root: string): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const script = [
    "$root = (Get-Item -LiteralPath $env:PEAS_SEC_FIXTURE_REPARSE_ROOT -Force -ErrorAction Stop)",
    "$pending = [Collections.Generic.Queue[IO.DirectoryInfo]]::new()",
    "$found = [Collections.Generic.List[string]]::new()",
    "if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $found.Add($root.FullName) } else { $pending.Enqueue($root) }",
    "while ($pending.Count -gt 0) {",
    "  $directory = $pending.Dequeue()",
    "  foreach ($item in Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction Stop) {",
    "    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $found.Add($item.FullName); continue }",
    "    if ($item.PSIsContainer) { $pending.Enqueue($item) }",
    "  }",
    "}",
    "$found | ForEach-Object { [Console]::Out.WriteLine($_) }",
  ].join("\n");
  const result = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PEAS_SEC_FIXTURE_REPARSE_ROOT: root },
    },
  );
  return result.stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .sort(codeUnitCompare);
}

function canonicalEvidence(members: readonly SecFixtureMember[]) {
  return members
    .map((member) => ({ role: member.role, artifactHash: member.artifactHash }))
    .sort(
      (left, right) =>
        codeUnitCompare(left.role, right.role) ||
        codeUnitCompare(left.artifactHash, right.artifactHash),
    );
}

function recomputeBundleHash(fixture: SecFixtureCase): string {
  assert.equal(fixture.expected.bundleValidity, "valid");
  const fiscalPeriod = fixture.fiscalPeriod;
  return canonicalHash("peas/provider-evidence-bundle/v1", {
    provider: fixture.provider,
    source: fixture.source,
    recordId: fixture.recordId,
    revisionId: fixture.revisionId,
    subject: `earnings:${fixture.subjectCik.padStart(10, "0")}:${fiscalPeriod}`,
    issuerCik: fixture.subjectCik.padStart(10, "0"),
    fiscalPeriod,
    sourceKind: fixture.sourceKind,
    primaryArtifactHash: fixture.expectedPrimaryArtifactHash,
    evidence: canonicalEvidence(fixture.members),
  } as JsonValue);
}

function selectedEvidence(fixture: SecFixtureCase) {
  return [...fixture.members]
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
}

function recomputeLoaderSelectionHash(fixture: SecFixtureCase): string {
  return canonicalHash("peas/sec-loader-selection/v1", {
    loader: "sec-recorded-loader-v1",
    asOfMs: fixture.asOfMs,
    selectedEvidence: selectedEvidence(fixture),
  } as JsonValue);
}

function recomputeLoaderTranscriptHash(fixture: SecFixtureCase, selectionHash: string): string {
  return canonicalHash("peas/sec-loader-transcript/v1", {
    loader: "sec-recorded-loader-v1",
    selectionHash,
    bundleHash: fixture.expected.evidenceBundleHash,
    status: fixture.expected.loaderStatus,
    reasonCode: fixture.expected.loaderStatus === "quarantined" ? "sec.observation-invalid" : null,
    limitKind: null,
    outputHash: null,
  } as JsonValue);
}

function deterministicPermutations(length: number): number[][] {
  const identity = Array.from({ length }, (_, index) => index);
  const reverse = [...identity].reverse();
  const rotate = length === 0 ? [] : [...identity.slice(1), identity[0] as number];
  const evenOdd = [
    ...identity.filter((index) => index % 2 === 0),
    ...identity.filter((index) => index % 2 === 1),
  ];
  return [identity, reverse, rotate, evenOdd];
}

function declaredIndependentPermutations(fixture: SecFixtureCase): number[][] {
  const unique = new Map<string, number[]>();
  for (const permutation of [
    [...fixture.presentationOrder],
    ...deterministicPermutations(fixture.members.length),
  ]) {
    unique.set(permutation.join(","), permutation);
  }
  return [...unique.values()];
}

type IndexExhibit = Readonly<{ memberKey: string; type: string; sequence: number }>;

async function indexExhibits(
  fixture: SecFixtureCase,
  memberSequence: readonly SecFixtureMember[],
): Promise<IndexExhibit[]> {
  const index = await jsonFor(memberByRole(fixture, "sec.filing-index", memberSequence));
  assert.ok(Array.isArray(index["exhibits"]));
  return index["exhibits"] as IndexExhibit[];
}

async function recomputeExhibitPrimary(
  fixture: SecFixtureCase,
  memberSequence: readonly SecFixtureMember[],
): Promise<string | null> {
  const exhibits = (await indexExhibits(fixture, memberSequence)).filter(
    (entry) =>
      entry.type === "EX-99.1" && Number.isSafeInteger(entry.sequence) && entry.sequence > 0,
  );
  const sequences = new Map<string, Set<number>>();
  for (const exhibit of exhibits) {
    const found = sequences.get(exhibit.memberKey) ?? new Set<number>();
    found.add(exhibit.sequence);
    sequences.set(exhibit.memberKey, found);
  }
  if ([...sequences.values()].some((values) => values.size !== 1)) return null;
  const normalized = [...sequences].map(([memberKey, values]) => ({
    memberKey,
    sequence: [...values][0] as number,
  }));
  const minimum = Math.min(...normalized.map((entry) => entry.sequence));
  const selected = normalized.filter((entry) => entry.sequence === minimum);
  if (selected.length !== 1) return null;
  const member = memberSequence.find(
    (candidate) =>
      candidate.role === "sec.exhibit-99.1" && candidate.memberKey === selected[0]?.memberKey,
  );
  return member?.artifactHash ?? null;
}

function focusPairs(markup: string): string[] {
  const years = [...markup.matchAll(/DocumentFiscalYearFocus[^>]*>([^<]+)</gu)].map(
    (match) => match[1],
  );
  const periods = [...markup.matchAll(/DocumentFiscalPeriodFocus[^>]*>([^<]+)</gu)].map(
    (match) => match[1],
  );
  assert.equal(years.length, periods.length);
  return years.map((year, index) => `${year}-${periods[index]}`);
}

function parseStrictRfc3339(value: string): number {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  assert.ok(match, `${value} must be strict RFC 3339 with an explicit UTC offset`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number((fraction ?? "").padEnd(3, "0"));
  assert.ok(month >= 1 && month <= 12, value);
  assert.ok(hour <= 23 && minute <= 59 && second <= 59, value);
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const local = new Date(localEpoch);
  assert.deepEqual(
    [
      local.getUTCFullYear(),
      local.getUTCMonth() + 1,
      local.getUTCDate(),
      local.getUTCHours(),
      local.getUTCMinutes(),
      local.getUTCSeconds(),
      local.getUTCMilliseconds(),
    ],
    [year, month, day, hour, minute, second, millisecond],
    value,
  );
  if (zone === "Z") return localEpoch;
  assert.ok(zone);
  const sign = zone[0] === "+" ? 1 : -1;
  const offsetHour = Number(zone.slice(1, 3));
  const offsetMinute = Number(zone.slice(4, 6));
  assert.ok(offsetHour <= 23 && offsetMinute <= 59, value);
  return localEpoch - sign * (offsetHour * 60 + offsetMinute) * 60_000;
}

function boundaryTokenMarkup(count: number): Buffer {
  const base = ["<?fixture?>", "<root>", "<!--comment-->", "<![CDATA[cdata]]>", "text"];
  let remaining = count - 6;
  const odd = remaining % 2;
  remaining -= odd;
  return Buffer.from(
    `${base.join("")}${"<x></x>".repeat(remaining / 2)}${odd ? "<!--extra-->" : ""}</root>`,
    "utf8",
  );
}

function generateBoundaryPayload(kind: string, value: number): Buffer {
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
      const emptyBytes = Buffer.byteLength(canonicalJson({ entries: "" }));
      return Buffer.from(canonicalJson({ entries: "x".repeat(value - emptyBytes) }), "utf8");
    }
    default:
      throw new Error(`not a single-payload boundary: ${kind}`);
  }
}

function generatedMembers(count: number, sizes: readonly number[], bundle: boolean) {
  const defaultSize = sizes[0];
  if (defaultSize === undefined) throw new Error("generated member sizes cannot be empty");
  return Array.from({ length: count }, (_, index) => {
    const bytes = Buffer.alloc(sizes[index] ?? defaultSize, 0x31 + index);
    const role =
      index === 0
        ? "sec.submissions"
        : index === 1
          ? "sec.filing-index"
          : index === 2
            ? "sec.primary-document"
            : index === 3 && bundle
              ? "sec.xbrl-instance"
              : "sec.exhibit-99.1";
    return { role, sizeBytes: bytes.byteLength, artifactHash: digest(bytes) };
  });
}

test("the literal A-F case-ID and outcome matrix is exact", () => {
  const declaredIds = Object.fromEntries(
    Object.entries(SEC_REQUIRED_CASE_IDS).map(([area, ids]) => [area, [...ids]]),
  );
  const expectedIds = Object.fromEntries(
    Object.entries(EXPECTED_CASE_MATRIX).map(([area, entries]) => [
      area,
      entries.map(([caseId]) => caseId),
    ]),
  );
  assert.deepEqual(declaredIds, expectedIds);
  assert.deepEqual(
    SEC_FIXTURE_CASES.map((fixture) => [
      fixture.caseId,
      fixture.expected.status,
      fixture.expected.reasonCode,
    ]),
    Object.values(EXPECTED_CASE_MATRIX).flat(),
  );
  assert.equal(
    new Set(SEC_FIXTURE_CASES.map((fixture) => fixture.caseId)).size,
    SEC_FIXTURE_CASES.length,
  );
  assert.deepEqual(
    SEC_FIXTURE_CASES.map((fixture) => fixture.ordinal),
    Array.from({ length: SEC_FIXTURE_CASES.length }, (_, index) => index + 1),
  );
  assert.ok(SEC_FIXTURE_CASES.every((fixture) => fixture.structuralMutation.length > 0));
});

test("generator source and all declared outputs reproduce byte-for-byte across locale and timezone", async () => {
  assert.equal(await normalizedGeneratorSourceHash(), SEC_FIXTURE_GENERATOR_SOURCE_HASH);
  assert.deepEqual(
    [...SEC_FIXTURE_GENERATED_PATHS].sort(codeUnitCompare),
    ["manifest.ts", ...SEC_FIXTURE_ARTIFACTS.map((artifact) => artifact.path)].sort(
      codeUnitCompare,
    ),
  );

  const temporary = await mkdtemp(path.join(os.tmpdir(), "peas-sec-fixture-generation-"));
  const utcRoot = path.join(temporary, "utc-c");
  const alternateRoot = path.join(temporary, "alternate-locale-timezone");
  try {
    await runGenerator(utcRoot, { TZ: "UTC", LANG: "C", LC_ALL: "C" });
    await runGenerator(alternateRoot, {
      TZ: "Pacific/Kiritimati",
      LANG: "tr_TR.UTF-8",
      LC_ALL: "tr_TR.UTF-8",
    });
    await assertGeneratedTreeMatches(utcRoot);
    await assertGeneratedTreeMatches(alternateRoot);
    for (const relative of SEC_FIXTURE_GENERATED_PATHS) {
      assert.deepEqual(
        await readFile(path.join(utcRoot, relative)),
        await readFile(path.join(alternateRoot, relative)),
        `${relative} depends on locale or timezone`,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("staged generation avoids ignored targets and formatter failures are byte-atomic", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "peas-sec-fixture-transaction-"));
  const targetRoot = path.join(temporary, "ignored-target", "fixtures", "sec", "v1");
  const stagingParent = path.join(temporary, "staging");
  await mkdir(stagingParent, { recursive: true });
  try {
    await copyGeneratedTree(ROOT, targetRoot);
    const current = await generatedTreeSnapshot(targetRoot);
    await runTestGenerator(targetRoot, stagingParent, {
      PEAS_SEC_FIXTURE_TEST_FORBID_FORMAT_ROOT: targetRoot,
    });
    assert.deepEqual(await generatedTreeSnapshot(targetRoot), current);
    assert.deepEqual(await readdir(stagingParent), []);

    await writeFile(path.join(targetRoot, "manifest.ts"), "stale target must survive failure\n");
    const beforeFailure = await generatedTreeSnapshot(targetRoot);
    for (const [failure, message] of [
      ["bodies", /Injected body formatter failure/u],
      ["manifest", /Injected manifest formatter failure/u],
    ] as const) {
      await assert.rejects(
        runTestGenerator(targetRoot, stagingParent, {
          PEAS_SEC_FIXTURE_TEST_FORBID_FORMAT_ROOT: targetRoot,
          PEAS_SEC_FIXTURE_TEST_FORMAT_FAILURE: failure,
        }),
        message,
      );
      assert.deepEqual(await generatedTreeSnapshot(targetRoot), beforeFailure);
      assert.deepEqual(await readdir(stagingParent), []);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("normal no-argument and output-root generation ignore hostile inherited test controls", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "peas-sec-fixture-hostile-env-"));
  const outputRoot = path.join(temporary, "normal-output");
  const hostileEnvironment = {
    PEAS_SEC_FIXTURE_TEST_DEFAULT_ROOT: path.join(temporary, "hostile-default"),
    PEAS_SEC_FIXTURE_TEST_STAGING_PARENT: path.join(temporary, "hostile-staging"),
    PEAS_SEC_FIXTURE_TEST_FORMAT_FAILURE: "bodies",
    PEAS_SEC_FIXTURE_TEST_FORBID_FORMAT_ROOT: os.tmpdir(),
    PEAS_SEC_FIXTURE_TEST_PROMOTION_FAILURE: "after-first-write",
  };
  try {
    const checkedIn = await declaredGeneratedSnapshot(ROOT);
    await runGeneratorArguments([], hostileEnvironment);
    assert.deepEqual(await declaredGeneratedSnapshot(ROOT), checkedIn);

    await runGeneratorArguments(["--output-root", outputRoot], hostileEnvironment);
    await assertGeneratedTreeMatches(outputRoot);
    assert.equal(await lstat(path.join(temporary, "hostile-default")).catch(() => null), null);
    assert.equal(await lstat(path.join(temporary, "hostile-staging")).catch(() => null), null);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("generator rejects unknown flags, malformed handshakes, and unconfined test roots", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "peas-sec-fixture-cli-"));
  const targetRoot = path.join(temporary, "target");
  const stagingParent = path.join(temporary, "staging");
  await mkdir(stagingParent);
  try {
    for (const arguments_ of [
      ["--unknown"],
      ["--output-root", targetRoot, "--extra"],
      ["--test-mode", GENERATOR_TEST_HANDSHAKE],
      [
        "--test-mode",
        "wrong-handshake",
        "--target-root",
        targetRoot,
        "--staging-parent",
        stagingParent,
        "--end-test-mode",
      ],
    ]) {
      await assert.rejects(runGeneratorArguments(arguments_), /closed test-mode handshake|Usage/u);
    }

    await assert.rejects(
      runTestGenerator(ROOT, stagingParent),
      /Test target root cannot name the default fixture tree/u,
    );
    const nonTemporaryStaging = nonTemporaryStagingSentinel();
    await assert.rejects(
      runTestGenerator(targetRoot, nonTemporaryStaging),
      /system temporary directory/u,
    );
    assert.equal(await lstat(targetRoot).catch(() => null), null);
    assert.deepEqual(await readdir(stagingParent), []);
    await assert.rejects(
      runTestGenerator(targetRoot, path.join(targetRoot, "stage")),
      /must be disjoint/u,
    );
    await assert.rejects(
      runTestGenerator(targetRoot, stagingParent, {
        PEAS_SEC_FIXTURE_TEST_FORMAT_FAILURE: "unknown",
      }),
      /Malformed test-mode formatter failure control/u,
    );
    await assert.rejects(
      runTestGenerator(targetRoot, stagingParent, {
        PEAS_SEC_FIXTURE_TEST_PROMOTION_FAILURE: "unknown",
      }),
      /Malformed test-mode promotion failure control/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Windows short-path generator identity cannot bypass the default-root guard", {
  skip: process.platform !== "win32" ? "Windows 8.3 path evidence" : false,
}, async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "peas-sec-fixture-short-alias-"));
  const copiedRoot = path.join(temporary, "generator-copy", "fixtures", "sec", "v1");
  const copiedGenerator = path.join(copiedRoot, "generate-contract.mjs");
  const stagingParent = path.join(temporary, "staging");
  try {
    await mkdir(copiedRoot, { recursive: true });
    await mkdir(stagingParent);
    await copyFile(GENERATOR, copiedGenerator);
    const shortRoot = await windowsShortPath(copiedRoot);
    const canonicalRoot = await realpath(copiedRoot);
    if (shortRoot.toLowerCase() === canonicalRoot.toLowerCase()) {
      context.skip("8.3 aliases are disabled on this volume");
      return;
    }
    const shortGenerator = path.join(shortRoot, "generate-contract.mjs");
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "--preserve-symlinks-main",
          shortGenerator,
          "--test-mode",
          GENERATOR_TEST_HANDSHAKE,
          "--target-root",
          canonicalRoot,
          "--staging-parent",
          stagingParent,
          "--end-test-mode",
        ],
        {
          cwd: path.resolve("."),
          encoding: "utf8",
          env: { ...process.env, TZ: "UTC", LANG: "C", LC_ALL: "C" },
          windowsHide: true,
        },
      ),
      /Test target root cannot name the default fixture tree/u,
    );
    assert.deepEqual(await readdir(stagingParent), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("promotion rejects a bodies junction or symlink before target or outside writes", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "peas-sec-fixture-promotion-link-"));
  const targetRoot = path.join(temporary, "target");
  const outside = path.join(temporary, "outside");
  const stagingParent = path.join(temporary, "staging");
  await mkdir(targetRoot);
  await mkdir(outside);
  await mkdir(stagingParent);
  const sentinel = Buffer.from("target must remain unchanged\n", "utf8");
  await writeFile(path.join(targetRoot, "manifest.ts"), sentinel);
  const link = path.join(targetRoot, "bodies");
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    if (process.platform === "win32") {
      const evidence = await execFileAsync("fsutil.exe", ["reparsepoint", "query", link], {
        encoding: "utf8",
        windowsHide: true,
      });
      assert.match(evidence.stdout, /0xa0000003/iu);
    }
    await assert.rejects(
      runTestGenerator(targetRoot, stagingParent),
      /reparse point|redirect|canonical/u,
    );
    assert.deepEqual(await readFile(path.join(targetRoot, "manifest.ts")), sentinel);
    assert.deepEqual(await readdir(outside), []);
    assert.deepEqual(await readdir(stagingParent), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("caught promotion failure removes every directory created for an absent target", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "peas-sec-fixture-dir-rollback-"));
  const targetRoot = path.join(temporary, "created", "nested", "target");
  const stagingParent = path.join(temporary, "staging");
  await mkdir(stagingParent);
  try {
    assert.equal(await lstat(targetRoot).catch(() => null), null);
    await assert.rejects(
      runTestGenerator(targetRoot, stagingParent, {
        PEAS_SEC_FIXTURE_TEST_PROMOTION_FAILURE: "after-first-write",
      }),
      /Injected promotion failure after first write/u,
    );
    assert.equal(await lstat(path.join(temporary, "created")).catch(() => null), null);
    assert.deepEqual(await readdir(stagingParent), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("caught promotion failure exactly restores an existing target and unrelated sentinel", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "peas-sec-fixture-existing-rollback-"));
  const targetRoot = path.join(temporary, "target");
  const stagingParent = path.join(temporary, "staging");
  await mkdir(stagingParent);
  try {
    await copyGeneratedTree(ROOT, targetRoot);
    const changedRelative = SEC_FIXTURE_GENERATED_PATHS.find((relative) =>
      relative.startsWith("bodies/"),
    );
    assert.ok(changedRelative);
    await writeFile(path.join(targetRoot, changedRelative), "existing modified bytes\n");
    const sentinel = path.join(targetRoot, "sentinel", "keep.bin");
    await mkdir(path.dirname(sentinel));
    await writeFile(sentinel, Buffer.from([0x00, 0xff, 0x53, 0x45, 0x43]));
    const beforeFailure = await completeTreeSnapshot(targetRoot);

    await assert.rejects(
      runTestGenerator(targetRoot, stagingParent, {
        PEAS_SEC_FIXTURE_TEST_PROMOTION_FAILURE: "after-first-write",
      }),
      /Injected promotion failure after first write/u,
    );

    assert.deepEqual(await completeTreeSnapshot(targetRoot), beforeFailure);
    assert.deepEqual(await readdir(stagingParent), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("the complete fixture tree is regular, contained, and exactly catalogued", async () => {
  const tree = await enumerateFixtureTree();
  const expectedFiles = [
    "README.md",
    "generate-contract.mjs",
    "manifest.ts",
    ...SEC_FIXTURE_ARTIFACTS.map((artifact) => artifact.path),
  ].sort(codeUnitCompare);
  assert.deepEqual(tree.directories, ["bodies"]);
  assert.deepEqual(tree.files, expectedFiles);
  assert.equal(new Set(expectedFiles).size, expectedFiles.length);
  assertNoReparseFacts(await windowsReparsePaths(ROOT));

  const referencedArtifacts = new Set(
    SEC_FIXTURE_CASES.flatMap((fixture) => fixture.members.map((member) => member.artifactId)),
  );
  assert.deepEqual(
    [...referencedArtifacts].sort(codeUnitCompare),
    SEC_FIXTURE_ARTIFACTS.map((artifact) => artifact.artifactId).sort(codeUnitCompare),
  );
});

test("fixture path resolution rejects traversal, absolute, symlink, junction, and reparse escapes", async () => {
  for (const hostile of [
    "../outside",
    "bodies/../../outside",
    "bodies\\..\\outside",
    "/absolute",
    "C:\\absolute",
    "\\\\server\\share\\outside",
    "bodies/./submissions.json",
  ]) {
    await assert.rejects(resolveFixturePath(ROOT, hostile));
  }
  for (const artifact of SEC_FIXTURE_ARTIFACTS) {
    await resolveFixturePath(ROOT, artifact.path);
  }

  const temporary = await mkdtemp(path.join(os.tmpdir(), "peas-sec-fixture-link-"));
  const localRoot = path.join(temporary, "root");
  const outside = path.join(temporary, "outside");
  await mkdir(localRoot);
  await mkdir(outside);
  try {
    let linkCreated = false;
    try {
      await symlink(
        outside,
        path.join(localRoot, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
      linkCreated = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "ENOSYS") throw error;
    }
    if (linkCreated) await assert.rejects(resolveFixturePath(localRoot, "escape/file"));

    // The repository's platform evidence uses injected unknown tags when privileged creation is
    // unavailable. The fixture predicate likewise fails closed on any reported reparse class.
    assert.throws(() => assertNoReparseFacts([["synthetic", "unknown-reparse-tag"].join(":")]));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("artifact, observation, bundle, loader-selection, transcript, and manifest identities are frozen", async () => {
  const serialized = canonicalJson(SEC_FIXTURE_MANIFEST as unknown as JsonValue);
  assert.ok(Buffer.byteLength(serialized) <= MAX_MANIFEST_BYTES);
  assert.equal(
    canonicalHash("peas/sec-fixture-manifest/v1", SEC_FIXTURE_MANIFEST as unknown as JsonValue),
    SEC_FIXTURE_MANIFEST_HASH,
  );

  const artifacts = new Map(
    SEC_FIXTURE_ARTIFACTS.map((artifact) => [artifact.artifactId, artifact]),
  );
  for (const artifact of SEC_FIXTURE_ARTIFACTS) {
    assert.match(artifact.artifactHash, SHA256);
    const body = await readFile(await resolveFixturePath(ROOT, artifact.path));
    assert.equal(body.byteLength, artifact.sizeBytes, artifact.artifactId);
    assert.equal(digest(body), artifact.artifactHash, artifact.artifactId);
  }

  for (const fixture of SEC_FIXTURE_CASES) {
    assert.match(fixture.accession, /^\d{10}-\d{2}-\d{6}$/u);
    assert.match(fixture.subjectCik, /^\d{10}$/u);
    assert.match(fixture.fiscalPeriod, /^\d{4}-(?:Q[1-4]|FY)$/u);
    assert.equal(fixture.provider, "sec-edgar");
    assert.equal(fixture.source, "sec:normalizer-v1");
    assert.equal(fixture.revisionId, "1");
    assert.deepEqual(
      [...fixture.presentationOrder].sort((left, right) => left - right),
      fixture.members.map((_, index) => index),
    );
    assert.ok(fixture.members.every((member) => member.selectedObservationId.length === 64));

    const uniqueObservationOwners = new Map<string, SecFixtureMember>();
    for (const member of fixture.members) {
      const artifact = artifacts.get(member.artifactId);
      assert.ok(artifact);
      assert.equal(member.path, artifact.path);
      assert.equal(member.artifactHash, artifact.artifactHash);
      assert.equal(member.sizeBytes, artifact.sizeBytes);
      assert.equal(member.response.mediaType, artifact.mediaType);
      assert.equal(member.response.declaredContentLength, artifact.sizeBytes);
      assert.equal(member.retrievalAttempt.requestIdentityHash, REQUEST.identityHash);
      assert.match(member.selectedObservationId, SHA256);
      if (!uniqueObservationOwners.has(member.selectedObservationId)) {
        uniqueObservationOwners.set(member.selectedObservationId, member);
      }
    }

    for (const owner of uniqueObservationOwners.values()) {
      const selected = owner.selectedObservation;
      if (selected === null) {
        assert.equal(fixture.caseId, "observation-missing-selected");
        continue;
      }
      const attempt = {
        attemptId: owner.retrievalAttempt.attemptId,
        provider: "sec-edgar",
        recordId: fixture.recordId,
        revisionId: "1",
        startedAtMs: owner.retrievalAttempt.startedAtMs,
        request: REQUEST,
      };
      assert.equal(
        deriveObservationId(attempt, selected.artifactDigest, owner.response),
        selected.observationId,
      );
      const raw = {
        observationId: selected.observationId,
        attemptId: attempt.attemptId,
        artifactDigest: selected.artifactDigest,
        provider: selected.provider,
        recordId: fixture.recordId,
        revisionId: "1",
        retrievedAtMs: selected.retrievedAtMs,
        request: REQUEST,
        response: owner.response,
      };
      assert.equal(
        canonicalHash("peas/artifact-observation/v1", raw as JsonValue),
        selected.observationHash,
      );
    }

    if (fixture.expected.bundleValidity === "valid") {
      assert.match(fixture.expected.evidenceBundleHash ?? "", SHA256);
      assert.equal(recomputeBundleHash(fixture), fixture.expected.evidenceBundleHash);
    } else {
      assert.equal(fixture.expected.evidenceBundleHash, null);
    }
    const selectionHash = recomputeLoaderSelectionHash(fixture);
    assert.equal(selectionHash, fixture.expected.loaderSelectionHash);
    assert.equal(
      recomputeLoaderTranscriptHash(fixture, selectionHash),
      fixture.expected.loaderTranscriptHash,
    );
    if (fixture.expected.status === "emitted") {
      assert.equal(fixture.expected.outputHash, "required-non-null");
    } else {
      assert.equal(fixture.expected.outputHash, null);
    }
  }
});

test("structurally valid ignored and quarantined semantics retain bundle identity", () => {
  const semanticCases = SEC_FIXTURE_CASES.filter(
    (fixture) => fixture.area !== "B" && fixture.expected.status !== "emitted",
  );
  assert.ok(semanticCases.length > 0);
  for (const fixture of semanticCases) {
    assert.equal(fixture.expected.bundleValidity, "valid", fixture.caseId);
    assert.match(fixture.expected.evidenceBundleHash ?? "", SHA256, fixture.caseId);
  }
  for (const fixture of SEC_FIXTURE_CASES.filter((candidate) => candidate.area === "B")) {
    assert.equal(fixture.expected.bundleValidity, "invalid", fixture.caseId);
  }
});

test("every structurally valid case declares one present primary digest under its source role", () => {
  for (const fixture of SEC_FIXTURE_CASES.filter(
    (candidate) => candidate.expected.bundleValidity === "valid",
  )) {
    assert.match(fixture.expectedPrimaryArtifactHash ?? "", SHA256, fixture.caseId);
    const declaredPrimaryMembers = fixture.members.filter(
      (member) => member.artifactHash === fixture.expectedPrimaryArtifactHash,
    );
    assert.equal(declaredPrimaryMembers.length, 1, fixture.caseId);
    assert.equal(
      declaredPrimaryMembers[0]?.role,
      fixture.sourceKind === "sec_8k" ? "sec.exhibit-99.1" : "sec.primary-document",
      fixture.caseId,
    );
  }
});

test("exact expected timestamps independently parse selected RFC3339 evidence", async () => {
  const exactCases = SEC_FIXTURE_CASES.filter(
    (fixture) => fixture.expected.timestampConfidence === "exact",
  );
  assert.ok(exactCases.length > 0);
  for (const fixture of exactCases) {
    const submissions = memberByRole(fixture, "sec.submissions");
    assert.notEqual(submissions.selectedObservation, null, fixture.caseId);
    assert.equal(
      submissions.selectedObservation?.artifactDigest,
      submissions.artifactHash,
      fixture.caseId,
    );
    const acceptanceDateTime = (await jsonFor(submissions))["acceptanceDateTime"];
    assert.ok(typeof acceptanceDateTime === "string", fixture.caseId);
    assert.equal(fixture.expected.originalTimestamp, acceptanceDateTime, fixture.caseId);
    assert.equal(
      fixture.expected.publishedAtMs,
      parseStrictRfc3339(acceptanceDateTime),
      fixture.caseId,
    );
  }
});

test("every case member has one selected ID and the lookup failure stays selected but unresolved", () => {
  const unresolved: Array<{ fixture: SecFixtureCase; member: SecFixtureMember }> = [];
  for (const fixture of SEC_FIXTURE_CASES) {
    for (const member of fixture.members) {
      assert.match(member.selectedObservationId, SHA256);
      if (member.selectedObservation === null) unresolved.push({ fixture, member });
      else assert.equal(member.selectedObservation.observationId, member.selectedObservationId);
    }
  }
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0]?.fixture.caseId, "observation-missing-selected");
  assert.match(unresolved[0]?.member.selectedObservationId ?? "", SHA256);
});

test("independent member permutations preserve canonical membership and primary selection", async () => {
  for (const fixture of SEC_FIXTURE_CASES) {
    const expected = canonicalEvidence(fixture.members);
    for (const permutation of declaredIndependentPermutations(fixture)) {
      const permuted = permutation.map((index) => fixture.members[index] as SecFixtureMember);
      assert.deepEqual(canonicalEvidence(permuted), expected, `${fixture.caseId}/${permutation}`);
    }
  }

  const selected = caseById("valid-two-exhibits");
  for (const permutation of declaredIndependentPermutations(selected)) {
    const members = permutation.map((index) => selected.members[index] as SecFixtureMember);
    assert.equal(
      await recomputeExhibitPrimary(selected, members),
      selected.expectedPrimaryArtifactHash,
      `primary selection changed for ${permutation}`,
    );
  }
  for (const caseId of ["tied-exhibit-sequence", "conflicting-exhibit-sequence"]) {
    const invalid = caseById(caseId);
    for (const permutation of declaredIndependentPermutations(invalid)) {
      const members = permutation.map((index) => invalid.members[index] as SecFixtureMember);
      assert.equal(await recomputeExhibitPrimary(invalid, members), null);
    }
  }
});

test("A bytes independently encode 8-K, 10-Q/10-K, inline/separate focus, linkage, and next-morning identity", async () => {
  const item = caseById("valid-item-202");
  const itemSubmissions = await jsonFor(memberByRole(item, "sec.submissions"));
  const itemIndex = await jsonFor(memberByRole(item, "sec.filing-index"));
  assert.equal(itemSubmissions["form"], "8-K");
  assert.deepEqual(itemSubmissions["items"], ["2.02"]);
  assert.deepEqual(itemIndex["items"], ["2.02"]);
  assert.deepEqual(focusPairs(await markupFor(memberByRole(item, "sec.xbrl-instance"))), [
    "2026-Q1",
  ]);

  const tenQ = caseById("valid-10q-inline-focus");
  assert.equal((await jsonFor(memberByRole(tenQ, "sec.submissions")))["form"], "10-Q");
  assert.deepEqual(focusPairs(await markupFor(memberByRole(tenQ, "sec.primary-document"))), [
    "2026-Q1",
  ]);
  assert.equal(
    tenQ.members.some((member) => member.role === "sec.xbrl-instance"),
    false,
  );

  const tenK = caseById("valid-10k-separate-xbrl");
  assert.equal((await jsonFor(memberByRole(tenK, "sec.submissions")))["form"], "10-K");
  assert.deepEqual(focusPairs(await markupFor(memberByRole(tenK, "sec.primary-document"))), []);
  assert.deepEqual(focusPairs(await markupFor(memberByRole(tenK, "sec.xbrl-instance"))), [
    "2025-FY",
  ]);

  const linked = caseById("valid-linked-periodic");
  const periodic = await markupFor(memberByRole(linked, "sec.periodic-report"));
  assert.match(periodic, /<DOCUMENT-TYPE>10-Q<\/DOCUMENT-TYPE>/u);
  assert.match(periodic, /<SUBJECT-CIK>0000123456<\/SUBJECT-CIK>/u);
  assert.deepEqual(focusPairs(periodic), ["2026-Q1"]);

  const next = caseById("valid-next-morning-periodic");
  assert.equal(next.sourceKind, "filing");
  assert.notEqual(next.accession, item.accession);
  assert.ok(next.asOfMs > item.asOfMs);
  assert.notEqual(next.recordId, item.recordId);
});

test("B bytes and references independently encode every membership and sequence failure", async () => {
  const missingRoles = new Map([
    ["missing-submissions", "sec.submissions"],
    ["missing-filing-index", "sec.filing-index"],
    ["missing-primary-document", "sec.primary-document"],
    ["missing-exhibit", "sec.exhibit-99.1"],
    ["missing-fiscal-evidence", "sec.xbrl-instance"],
  ]);
  for (const [caseId, role] of missingRoles) {
    assert.equal(
      caseById(caseId).members.some((member) => member.role === role),
      false,
    );
  }

  const duplicateSingleton = caseById("duplicate-singleton");
  assert.equal(
    duplicateSingleton.members.filter((member) => member.role === "sec.submissions").length,
    2,
  );
  const duplicateDigest = caseById("duplicate-artifact-digest");
  assert.notEqual(
    new Set(duplicateDigest.members.map((member) => member.artifactHash)).size,
    duplicateDigest.members.length,
  );

  const absent = caseById("primary-absent");
  assert.equal(
    absent.members.some((member) => member.artifactHash === absent.expectedPrimaryArtifactHash),
    false,
  );
  const wrongRole = caseById("primary-wrong-role");
  assert.equal(
    wrongRole.members.find(
      (member) => member.artifactHash === wrongRole.expectedPrimaryArtifactHash,
    )?.role,
    "sec.primary-document",
  );
  assert.equal(
    await recomputeExhibitPrimary(wrongRole, wrongRole.members),
    wrongRole.members.find((member) => member.role === "sec.exhibit-99.1")?.artifactHash,
  );
  assert.notEqual(
    await recomputeExhibitPrimary(wrongRole, wrongRole.members),
    wrongRole.expectedPrimaryArtifactHash,
  );

  const tied = caseById("tied-exhibit-sequence");
  const tiedEntries = await indexExhibits(tied, tied.members);
  assert.deepEqual(
    tiedEntries.map((entry) => entry.sequence),
    [1, 1],
  );
  const conflicting = caseById("conflicting-exhibit-sequence");
  const conflictingEntries = await indexExhibits(conflicting, conflicting.members);
  assert.deepEqual(
    conflictingEntries
      .filter((entry) => entry.memberKey === "exhibit-a")
      .map((entry) => entry.sequence),
    [1, 2],
  );
  const over = caseById("more-than-16-members");
  assert.equal(over.members.length, 17);
  assert.equal(new Set(over.members.map((member) => member.artifactHash)).size, 17);
  // ADR 0007 Decision 5 assigns the same reason to either member-count overflow or one
  // member exceeding its byte ceiling.
  assert.equal(over.expected.reasonCode, "sec.member-limit-exceeded");
  assert.ok(caseById("unknown-sec-role").members.some((member) => !VALID_ROLES.has(member.role)));
});

test("C bytes independently encode classification, CIK, focus, amendment, and redelivery distinctions", async () => {
  const nonEarnings = caseById("non-earnings-8k");
  assert.deepEqual((await jsonFor(memberByRole(nonEarnings, "sec.submissions")))["items"], [
    "5.02",
  ]);
  assert.deepEqual((await jsonFor(memberByRole(nonEarnings, "sec.filing-index")))["items"], [
    "5.02",
  ]);

  assert.equal(
    (await jsonFor(memberByRole(caseById("padded-cik"), "sec.submissions")))["cik"],
    "0000123456",
  );
  assert.equal(
    (await jsonFor(memberByRole(caseById("unpadded-cik"), "sec.submissions")))["cik"],
    "123456",
  );
  const prefix = caseById("accession-prefix-different");
  assert.equal(prefix.accession.slice(0, 10), "0000999999");
  assert.equal((await jsonFor(memberByRole(prefix, "sec.submissions")))["cik"], "123456");

  const missingCik = caseById("subject-cik-missing");
  assert.equal("cik" in (await jsonFor(memberByRole(missingCik, "sec.submissions"))), false);
  assert.equal(
    "subjectCik" in (await jsonFor(memberByRole(missingCik, "sec.filing-index"))),
    false,
  );
  for (const member of missingCik.members) {
    assert.notEqual(member.selectedObservation, null, member.memberKey);
    assert.deepEqual(
      await positiveSubjectCiks(member),
      [],
      `${member.memberKey} selected evidence retains a positive subject CIK`,
    );
  }
  assert.match(
    await markupFor(memberByRole(caseById("subject-cik-conflict"), "sec.xbrl-instance")),
    /0000654321/u,
  );
  assert.match(
    await markupFor(memberByRole(caseById("linked-periodic-foreign-cik"), "sec.periodic-report")),
    /<SUBJECT-CIK>0000654321<\/SUBJECT-CIK>/u,
  );
  assert.deepEqual(
    focusPairs(
      await markupFor(
        memberByRole(caseById("linked-periodic-different-period"), "sec.periodic-report"),
      ),
    ),
    ["2026-Q2"],
  );
  assert.deepEqual(
    focusPairs(await markupFor(memberByRole(caseById("absent-fiscal-focus"), "sec.xbrl-instance"))),
    [],
  );
  assert.deepEqual(
    focusPairs(
      await markupFor(memberByRole(caseById("conflicting-fiscal-focus"), "sec.xbrl-instance")),
    ),
    ["2026-Q1", "2026-Q2"],
  );

  for (const [caseId, form] of [
    ["amendment-8ka-distinct-accession", "8-K/A"],
    ["amendment-10qa-distinct-accession", "10-Q/A"],
    ["amendment-10ka-distinct-accession", "10-K/A"],
  ] as const) {
    const fixture = caseById(caseId);
    assert.equal((await jsonFor(memberByRole(fixture, "sec.submissions")))["form"], form);
    assert.equal((await jsonFor(memberByRole(fixture, "sec.filing-index")))["form"], form);
    assert.notEqual(fixture.accession, caseById("valid-item-202").accession);
  }

  const baseline = caseById("valid-item-202");
  const exact = caseById("exact-provider-redelivery");
  assert.deepEqual(canonicalEvidence(exact.members), canonicalEvidence(baseline.members));
  assert.equal(exact.expected.evidenceBundleHash, baseline.expected.evidenceBundleHash);
  const conflicting = caseById("record-revision-conflicting-primary");
  assert.equal(conflicting.recordId, baseline.recordId);
  assert.equal(conflicting.revisionId, baseline.revisionId);
  assert.notEqual(conflicting.expectedPrimaryArtifactHash, baseline.expectedPrimaryArtifactHash);
  assert.notEqual(conflicting.expected.evidenceBundleHash, baseline.expected.evidenceBundleHash);
});

test("D observations independently encode as-of, lookup, digest, provider, reuse, and transcript identity", () => {
  const atAsOf = caseById("observation-at-asof");
  assert.ok(
    atAsOf.members.some((member) => member.selectedObservation?.retrievedAtMs === atAsOf.asOfMs),
  );
  const future = caseById("observation-after-asof");
  assert.ok(
    future.members.some(
      (member) => member.selectedObservation?.retrievedAtMs === future.asOfMs + 1,
    ),
  );
  const unresolved = caseById("observation-missing-selected");
  assert.ok(
    unresolved.members.some(
      (member) => member.selectedObservationId.length === 64 && member.selectedObservation === null,
    ),
  );
  const mismatch = caseById("observation-digest-mismatch");
  assert.ok(
    mismatch.members.some(
      (member) => member.selectedObservation?.artifactDigest !== member.artifactHash,
    ),
  );
  const wrongProvider = caseById("observation-wrong-provider");
  assert.ok(
    wrongProvider.members.some((member) => member.selectedObservation?.provider !== "sec-edgar"),
  );
  const reused = caseById("observation-id-reused");
  assert.notEqual(
    new Set(reused.members.map((member) => member.selectedObservationId)).size,
    reused.members.length,
  );

  const eligibleA = caseById("observation-identical-bytes-a");
  const eligibleB = caseById("observation-identical-bytes-b");
  assert.deepEqual(canonicalEvidence(eligibleA.members), canonicalEvidence(eligibleB.members));
  assert.equal(eligibleA.expected.evidenceBundleHash, eligibleB.expected.evidenceBundleHash);
  assert.notEqual(eligibleA.expected.loaderSelectionHash, eligibleB.expected.loaderSelectionHash);
  assert.notEqual(eligibleA.expected.loaderTranscriptHash, eligibleB.expected.loaderTranscriptHash);
});

test("E bytes independently encode publication candidate presence, equality, exclusion, and errors", async () => {
  const submissionsTime = async (caseId: string) =>
    (await jsonFor(memberByRole(caseById(caseId), "sec.submissions")))["acceptanceDateTime"];
  const primaryMarkup = async (caseId: string) =>
    markupFor(memberByRole(caseById(caseId), "sec.primary-document"));

  assert.equal(
    await submissionsTime("timestamp-equivalent-rfc-and-eastern"),
    "2026-05-07T20:15:30-04:00",
  );
  assert.match(
    await primaryMarkup("timestamp-equivalent-rfc-and-eastern"),
    /<ACCEPTANCE-DATETIME>20260507201530<\/ACCEPTANCE-DATETIME>/u,
  );
  assert.doesNotMatch(await primaryMarkup("timestamp-rfc-only"), /ACCEPTANCE-DATETIME/u);

  const standard = caseById("timestamp-header-standard");
  assert.equal(standard.expected.publishedAtMs, Date.parse("2026-01-15T10:30:00-05:00"));
  assert.match(await primaryMarkup(standard.caseId), /20260115103000/u);
  const daylight = caseById("timestamp-header-daylight");
  assert.equal(daylight.expected.publishedAtMs, Date.parse("2026-05-07T20:15:30-04:00"));
  assert.match(await primaryMarkup(daylight.caseId), /20260507201530/u);

  for (const caseId of ["timestamp-missing", "timestamp-retrieval-excluded"]) {
    assert.equal(await submissionsTime(caseId), undefined);
    assert.doesNotMatch(await primaryMarkup(caseId), /ACCEPTANCE-DATETIME/u);
    assert.equal(caseById(caseId).expected.publishedAtMs, null);
  }
  assert.match(await primaryMarkup("timestamp-conflict"), /20260507201630/u);
  assert.equal(await submissionsTime("timestamp-malformed"), "2026-02-30T09:15:00-05:00");
  assert.match(await primaryMarkup("timestamp-malformed"), /20261301103000/u);
  assert.match(await primaryMarkup("timestamp-pre-2007"), /20061101103000/u);
  assert.equal(caseById("timestamp-pre-2007").expected.publishedAtMs, null);
  assert.match(
    await primaryMarkup("timestamp-filing-date-only"),
    /<FILING-DATE>20260507<\/FILING-DATE>/u,
  );
  assert.doesNotMatch(await primaryMarkup("timestamp-filing-date-only"), /ACCEPTANCE-DATETIME/u);

  const linked = caseById("timestamp-linked-periodic-excluded");
  assert.match(
    await markupFor(memberByRole(linked, "sec.periodic-report")),
    /<ACCEPTANCE-DATETIME>20260508073000<\/ACCEPTANCE-DATETIME>/u,
  );
  assert.equal(linked.expected.originalTimestamp, "2026-05-07T20:15:30-04:00");
});

test("F bytes independently pin aliases, BOM, fallback, unsupported/conflict, sniff window, and malformed outcomes", async () => {
  const aliasLabels = [
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
  for (const label of aliasLabels) {
    const fixture = caseById(`decoder-accepted-${label}`);
    const bytes = await bytesFor(memberByRole(fixture, "sec.exhibit-99.1"));
    assert.notEqual(bytes.indexOf(Buffer.from(`<meta charset="${label}">`, "ascii")), -1, label);
    assert.equal(fixture.decoder?.label, label);
    const canonical = ["utf-8", "utf8", "unicode-1-1-utf-8"].includes(label)
      ? "utf-8"
      : "windows-1252";
    assert.equal(fixture.decoder?.canonical, canonical);
  }

  const bom = await bytesFor(memberByRole(caseById("decoder-utf8-bom"), "sec.exhibit-99.1"));
  assert.deepEqual([...bom.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const undeclaredUtf8 = await bytesFor(
    memberByRole(caseById("decoder-undeclared-utf8"), "sec.exhibit-99.1"),
  );
  assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(undeclaredUtf8));
  assert.doesNotMatch(undeclaredUtf8.toString("utf8"), /charset=/u);
  const fallback = await bytesFor(
    memberByRole(caseById("decoder-undeclared-windows1252"), "sec.exhibit-99.1"),
  );
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(fallback));
  assert.doesNotThrow(() => new TextDecoder("windows-1252", { fatal: true }).decode(fallback));

  const unsupported = await bytesFor(
    memberByRole(caseById("decoder-unsupported"), "sec.exhibit-99.1"),
  );
  assert.notEqual(unsupported.indexOf(Buffer.from('charset="koi8-r"', "ascii")), -1);
  const conflict = await bytesFor(
    memberByRole(caseById("decoder-bom-conflict"), "sec.exhibit-99.1"),
  );
  assert.deepEqual([...conflict.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.notEqual(conflict.indexOf(Buffer.from('charset="windows-1252"', "ascii")), -1);

  const declaration = Buffer.from('<meta charset="utf-8">', "ascii");
  const exact = await bytesFor(
    memberByRole(caseById("decoder-sniff-exact-boundary"), "sec.exhibit-99.1"),
  );
  const exactStart = exact.indexOf(declaration);
  assert.ok(exactStart >= 0);
  assert.equal(exactStart + declaration.byteLength, 1024);
  const crossing = await bytesFor(
    memberByRole(caseById("decoder-sniff-crossing-boundary"), "sec.exhibit-99.1"),
  );
  const crossingStart = crossing.indexOf(declaration);
  assert.ok(crossingStart >= 0 && crossingStart < 1024);
  assert.ok(crossingStart + declaration.byteLength > 1024);

  const tolerated = await markupFor(memberByRole(caseById("markup-tolerated"), "sec.exhibit-99.1"));
  assert.match(tolerated, /<p>synthetic<div>continued/u);
  assert.doesNotMatch(tolerated, /<\/div>/u);
  const quarantined = await markupFor(
    memberByRole(caseById("markup-quarantined"), "sec.xbrl-instance"),
  );
  assert.match(quarantined, /<xbrl>/u);
  assert.match(quarantined, /<\/wrong>/u);
  assert.doesNotMatch(quarantined, /<\/xbrl>/u);
});

test("declared deterministic G vectors freeze hashes and exact/one-over outcomes", () => {
  assert.deepEqual(
    SEC_GENERATED_BOUNDARY_VECTORS.map((vector) => [
      vector.vectorId,
      vector.expected.status,
      vector.expected.reasonCode,
      vector.expected.limitKind,
    ]),
    EXPECTED_BOUNDARY_MATRIX,
  );

  for (const vector of SEC_GENERATED_BOUNDARY_VECTORS) {
    assert.match(vector.expectedHash, SHA256);
    if (vector.generatorKind === "bundle-members" || vector.generatorKind === "distinct-members") {
      const sizes = vector.memberSizes;
      assert.ok(sizes);
      const members = generatedMembers(
        vector.value,
        sizes,
        vector.generatorKind === "bundle-members",
      );
      assert.equal(
        members.reduce((total, member) => total + member.sizeBytes, 0),
        vector.expectedBytes,
      );
      assert.deepEqual(
        members.map((member) => member.artifactHash),
        vector.expectedMemberHashes,
      );
      assert.equal(
        canonicalHash("peas/sec-generated-members/v1", members as unknown as JsonValue),
        vector.expectedHash,
      );
      assert.equal(new Set(members.map((member) => member.artifactHash)).size, members.length);
      continue;
    }
    const bytes = generateBoundaryPayload(vector.generatorKind, vector.value);
    assert.equal(bytes.byteLength, vector.expectedBytes, vector.vectorId);
    assert.equal(digest(bytes), vector.expectedHash, vector.vectorId);
    if (vector.generatorKind === "semantic-tokens") {
      assert.notEqual(bytes.indexOf(Buffer.from("<?fixture?>")), -1);
      assert.notEqual(bytes.indexOf(Buffer.from("<!--comment-->")), -1);
      assert.notEqual(bytes.indexOf(Buffer.from("<![CDATA[cdata]]>")), -1);
      assert.notEqual(bytes.indexOf(Buffer.from(">text<")), -1);
      const markup = bytes.toString("utf8");
      const semanticTokens =
        (markup.match(/<\?fixture\?>/gu) ?? []).length +
        (markup.match(/<root>/gu) ?? []).length +
        (markup.match(/<!--comment-->/gu) ?? []).length +
        (markup.match(/<!\[CDATA\[cdata\]\]>/gu) ?? []).length +
        (markup.match(/>text</gu) ?? []).length +
        (markup.match(/<x>/gu) ?? []).length +
        (markup.match(/<\/x>/gu) ?? []).length +
        (markup.match(/<!--extra-->/gu) ?? []).length +
        (markup.match(/<\/root>/gu) ?? []).length;
      assert.equal(semanticTokens, vector.value);
    } else if (vector.generatorKind === "markup-depth") {
      const markup = bytes.toString("utf8");
      assert.equal((markup.match(/<x>/gu) ?? []).length, vector.value);
      assert.equal((markup.match(/<\/x>/gu) ?? []).length, vector.value);
    } else if (vector.generatorKind === "attributes-per-tag") {
      assert.equal((bytes.toString("utf8").match(/=/gu) ?? []).length, vector.value);
    } else if (vector.generatorKind === "extracted-text-bytes") {
      assert.equal(bytes.subarray(3, bytes.byteLength - 4).byteLength, vector.value);
    } else if (vector.generatorKind === "transcript-bytes") {
      const parsed = JSON.parse(bytes.toString("utf8")) as { entries: string };
      assert.equal(Buffer.byteLength(parsed.entries), vector.value - 14);
    }
  }

  const vector = (id: string) => {
    const found = SEC_GENERATED_BOUNDARY_VECTORS.find((candidate) => candidate.vectorId === id);
    assert.ok(found);
    return found;
  };
  assert.equal(vector("member-bytes-exact").expectedBytes, MAX_MEMBER_BYTES);
  assert.equal(vector("member-bytes-one-over").expectedBytes, MAX_MEMBER_BYTES + 1);
  assert.equal(vector("bundle-bytes-exact").expectedBytes, MAX_BUNDLE_BYTES);
  assert.equal(vector("bundle-bytes-one-over").expectedBytes, MAX_BUNDLE_BYTES + 1);
  assert.equal(vector("transcript-bytes-exact").expectedBytes, MAX_TRANSCRIPT_BYTES);
  assert.equal(vector("transcript-bytes-one-over").expectedBytes, MAX_TRANSCRIPT_BYTES + 1);
  assert.equal(vector("member-count-exact-16").value, 16);
  assert.equal(vector("member-count-one-over-17").value, 17);
  assert.equal(vector("member-count-one-over-17").expected.reasonCode, "sec.member-limit-exceeded");
  assert.equal(vector("bundle-bytes-exact").expectedMemberHashes?.length, 4);
});

test("canonical manifest and every fixture-tree file exclude request identity, provider filenames, arbitrary headers, and secrets", async () => {
  const canonicalManifest = canonicalJson(SEC_FIXTURE_MANIFEST as unknown as JsonValue);
  const tree = await enumerateFixtureTree();
  const scanned = [
    { name: "canonical manifest", text: canonicalManifest },
    ...(await Promise.all(
      tree.files.map(async (relative) => ({
        name: relative,
        text: (await readFile(path.join(ROOT, relative))).toString("latin1"),
      })),
    )),
  ];
  const prohibitedPatterns = [
    /(?:https?|ftp):\/\//iu,
    /www\./iu,
    /\?[a-z0-9_.~-]+=/iu,
    /authorization/iu,
    /proxy-authorization/iu,
    /set-cookie/iu,
    /\bcookie\b/iu,
    /bearer[ \t]+/iu,
    /api[_-]?key/iu,
    /password/iu,
    /private[_-]?key/iu,
    /client[_-]?secret/iu,
    /BEGIN [A-Z ]+ PRIVATE KEY/u,
    /AKIA[0-9A-Z]{16}/u,
    /\/Archives\/edgar\/data\//iu,
    /"filename"\s*:/iu,
    /\d{10}-\d{2}-\d{6}[^"\s]*\.(?:html?|txt|xml)/iu,
    /HTTP\/1\.[01]/iu,
    /(?:^|[\r\n])(?:Date|Last-Modified|User-Agent|Referer|Origin|Host):/imu,
  ];
  for (const source of scanned) {
    for (const prohibited of prohibitedPatterns) {
      assert.doesNotMatch(source.text, prohibited, `${source.name}: ${prohibited}`);
    }
  }

  const responseKeys = [
    "contentEncoding",
    "declaredContentLength",
    "etag",
    "lastModified",
    "mediaType",
    "statusCode",
    "transportDecoded",
  ];
  for (const fixture of SEC_FIXTURE_CASES) {
    for (const member of fixture.members) {
      assert.deepEqual(Object.keys(member.response).sort(codeUnitCompare), responseKeys);
      assert.equal(member.response.etag, null);
      assert.equal(member.response.lastModified, null);
      assert.equal(member.response.contentEncoding, null);
      assert.equal(path.basename(member.path).includes(fixture.accession), false);
    }
  }
});
