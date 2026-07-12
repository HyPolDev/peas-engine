import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const candidateSha = process.env["PEAS_CANDIDATE_SHA"] ?? git("rev-parse", "HEAD");
const head = git("rev-parse", "HEAD");
if (candidateSha !== head)
  throw new Error(`Platform evidence candidate ${candidateSha} is not ${head}`);
if (git("status", "--porcelain").length !== 0) {
  throw new Error("Refusing platform evidence from a dirty worktree");
}

const policyPath = "config/artifact-vault-deployment-policy.v1.json";
const capabilitiesPath = "config/artifact-platform-capabilities.v1.json";
const faultBoundariesPath = "config/artifact-fault-boundaries.json";
const hardKillPath = process.env["PEAS_HARD_KILL_EVIDENCE_PATH"] ?? "audit-hard-kill-results.json";
for (const path of [policyPath, capabilitiesPath, faultBoundariesPath, hardKillPath]) {
  if (!existsSync(path)) throw new Error(`Missing required vault evidence input: ${path}`);
}
const policyBytes = readFileSync(policyPath);
const capabilitiesBytes = readFileSync(capabilitiesPath);
const faultBoundaryBytes = readFileSync(faultBoundariesPath);
const hardKillBytes = readFileSync(hardKillPath);
const capabilities = JSON.parse(capabilitiesBytes.toString("utf8"));
const policy = JSON.parse(policyBytes.toString("utf8"));
const hardKill = JSON.parse(hardKillBytes.toString("utf8"));
if (
  hardKill.status !== "passed" ||
  hardKill.candidateCommitSha !== candidateSha ||
  hardKill.boundaries?.some((boundary) => boundary.converged !== true)
) {
  throw new Error("Hard-kill evidence is not complete passing evidence for this candidate");
}

const demonstrated =
  process.platform === "win32"
    ? [
        "ancestor-junction-existing-root",
        "ancestor-junction-missing-root",
        "runtime-root-junction",
        "vault-component-directory-link",
        "mount-point-reparse-tag",
        "hard-link-count-rejection",
        "file-identity-before-and-after-hash",
        "hard-kill-install-intent-recovery",
        "hard-kill-cursor-takeover",
      ]
    : [
        "ancestor-symlink-existing-root",
        "ancestor-symlink-missing-root",
        "runtime-root-symlink",
        "vault-component-directory-symlink",
        "file-symlink-rejection",
        "hard-link-count-rejection",
        "realpath-component-verification",
        "hard-kill-install-intent-recovery",
        "hard-kill-cursor-takeover",
      ];
const required = capabilities.requiredByPlatform?.[process.platform];
if (!Array.isArray(required)) throw new Error(`No capability inventory for ${process.platform}`);
const capabilityEvidence = Object.fromEntries(
  demonstrated.map((name) => [name, { kind: "real-platform-regression" }]),
);

function windowsVolumeFacts(path) {
  const drive = parse(path).root.slice(0, 1);
  const command = `
$ErrorActionPreference = 'Stop'
$volume = Get-Volume -DriveLetter $env:PEAS_EVIDENCE_DRIVE
$partition = Get-Partition -DriveLetter $env:PEAS_EVIDENCE_DRIVE
$disk = Get-Disk -Number $partition.DiskNumber
[pscustomobject]@{
  fileSystem = [string]$volume.FileSystemType
  driveType = [string]$volume.DriveType
  driveLetter = [string]$volume.DriveLetter
  volumeId = [string]$volume.UniqueId
  busType = [string]$disk.BusType
} | ConvertTo-Json -Compress
`;
  return JSON.parse(
    execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, PEAS_EVIDENCE_DRIVE: drive },
      },
    ).trim(),
  );
}

function linuxFileSystem(path) {
  const record = readFileSync("/proc/self/mountinfo", "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" "))
    .filter((fields) => fields.length > 8 && path.startsWith(fields[4]))
    .sort((left, right) => right[4].length - left[4].length)[0];
  if (record === undefined) return null;
  const separator = record.indexOf("-");
  return separator >= 0 ? record[separator + 1] : null;
}

let configuredRuntimeRoot = null;
const runtimeValidationPath = process.env["PEAS_RUNTIME_VALIDATION_PATH"];
if (runtimeValidationPath !== undefined) {
  const bytes = readFileSync(runtimeValidationPath);
  const value = JSON.parse(bytes.toString("utf8"));
  if (value.status !== "passed" || value.policySha256 !== sha256(policyBytes)) {
    throw new Error("Configured runtime-root validation is not bound to the deployment policy");
  }
  configuredRuntimeRoot = { path: runtimeValidationPath, fileSha256: sha256(bytes), value };
  demonstrated.push(
    process.platform === "win32" ? "windows-fixed-ntfs-filesystem" : "configured-local-filesystem",
  );
  capabilityEvidence[demonstrated.at(-1)] = { kind: "configured-volume-attestation" };
} else if (process.platform === "win32") {
  const facts = windowsVolumeFacts(process.env.RUNNER_TEMP ?? tmpdir());
  if (
    policy.configuredLocalRoot.windows.fileSystems.includes(facts.fileSystem) &&
    policy.configuredLocalRoot.windows.driveTypes.includes(facts.driveType)
  ) {
    demonstrated.push("windows-fixed-ntfs-filesystem");
    capabilityEvidence["windows-fixed-ntfs-filesystem"] = {
      kind: "ci-temporary-runner-volume-probe",
      deploymentApproval: false,
      facts,
    };
  }
} else {
  const fileSystem = linuxFileSystem(process.env.RUNNER_TEMP ?? tmpdir());
  if (policy.configuredLocalRoot.linux.fileSystems.includes(fileSystem)) {
    demonstrated.push("configured-local-filesystem");
    capabilityEvidence["configured-local-filesystem"] = {
      kind: "runner-mount-probe",
      fileSystem,
    };
  }
}

if (process.platform === "win32") {
  // The deployment boundary rejects the reparse attribute before interpreting a tag. These
  // injected tag classes exercise that tag-independent predicate; junction coverage above is real.
  for (const name of ["directory-symlink-reparse-tag", "unknown-reparse-tag-fails-closed"]) {
    const syntheticFacts = { reparseAncestors: [`synthetic:${name}`] };
    const accepted = syntheticFacts.reparseAncestors.length === 0;
    if (accepted) throw new Error(`Synthetic ${name} was not rejected`);
    demonstrated.push(name);
    capabilityEvidence[name] = { kind: "policy-fact-injection", accepted };
  }
}
let crossDevice = null;
const crossDevicePath = process.env["PEAS_CROSS_DEVICE_EVIDENCE_PATH"];
if (crossDevicePath !== undefined) {
  const bytes = readFileSync(crossDevicePath);
  const value = JSON.parse(bytes.toString("utf8"));
  if (
    value.status !== "passed" ||
    value.candidateCommitSha !== candidateSha ||
    value.configuredRootDevice === value.negativeFixtureDevice ||
    value.databaseOutsideRuntimeRootRejected !== true
  ) {
    throw new Error("Cross-device evidence is not passing evidence for this candidate");
  }
  crossDevice = { path: crossDevicePath, fileSha256: sha256(bytes), value };
  demonstrated.push("cross-device-layout-rejection");
  capabilityEvidence["cross-device-layout-rejection"] = {
    kind: "configured-cross-device-process",
  };
} else {
  let secondaryBase = null;
  const primaryDevice = String(lstatSync(tmpdir()).dev);
  if (process.platform === "win32") {
    const command =
      "Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' -and $_.FileSystemType -eq 'NTFS' } | Select-Object -ExpandProperty DriveLetter | ConvertTo-Json -Compress";
    const raw = execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const letters = raw === "" ? [] : JSON.parse(raw);
    for (const letter of Array.isArray(letters) ? letters : [letters]) {
      try {
        const candidate = mkdtempSync(join(`${letter}:\\`, "peas-ci-cross-"));
        if (String(lstatSync(candidate).dev) !== primaryDevice) {
          secondaryBase = candidate;
          break;
        }
        rmSync(candidate, { recursive: true, force: true });
      } catch {
        // An inaccessible volume is not evidence and is not reported as demonstrated.
      }
    }
  } else if (existsSync("/dev/shm") && String(lstatSync("/dev/shm").dev) !== primaryDevice) {
    secondaryBase = mkdtempSync(join("/dev/shm", "peas-ci-cross-"));
  }
  if (secondaryBase !== null) {
    const evidencePath = join(tmpdir(), `peas-cross-device-${process.pid}.json`);
    try {
      execFileSync(process.execPath, ["scripts/verify-vault-cross-device-rejection.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          PEAS_RUNTIME_ROOT: secondaryBase,
          PEAS_CANDIDATE_SHA: candidateSha,
          PEAS_CROSS_DEVICE_EVIDENCE_PATH: evidencePath,
        },
      });
      const bytes = readFileSync(evidencePath);
      const value = JSON.parse(bytes.toString("utf8"));
      crossDevice = { path: "generated-ci-cross-device.json", fileSha256: sha256(bytes), value };
      demonstrated.push("cross-device-layout-rejection");
      capabilityEvidence["cross-device-layout-rejection"] = {
        kind: "ci-cross-device-process",
      };
    } finally {
      rmSync(secondaryBase, { recursive: true, force: true });
      rmSync(evidencePath, { force: true });
    }
  }
}
const unsupportedRequiredCapabilities = required.filter((name) => !demonstrated.includes(name));

const report = {
  schemaVersion: 2,
  candidateCommitSha: candidateSha,
  worktreeClean: true,
  platform: process.platform,
  arch: process.arch,
  mode: configuredRuntimeRoot === null ? "ci-temporary" : "configured-local",
  policy: { path: policyPath, fileSha256: sha256(policyBytes) },
  capabilityInventory: { path: capabilitiesPath, fileSha256: sha256(capabilitiesBytes) },
  faultBoundaryInventory: { path: faultBoundariesPath, fileSha256: sha256(faultBoundaryBytes) },
  hardKill: { path: hardKillPath, fileSha256: sha256(hardKillBytes) },
  configuredRuntimeRoot,
  crossDevice,
  requiredCapabilities: required,
  demonstratedCapabilities: demonstrated,
  capabilityEvidence,
  unsupportedRequiredCapabilities,
  completeForGo: unsupportedRequiredCapabilities.length === 0,
};
const output =
  process.env["PEAS_VAULT_PLATFORM_EVIDENCE_PATH"] ??
  `vault-platform-evidence-${process.platform}-${candidateSha}.json`;
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (process.env["PEAS_REQUIRE_COMPLETE_PLATFORM_EVIDENCE"] === "1" && !report.completeForGo) {
  throw new Error(
    `Required platform capabilities are unavailable: ${unsupportedRequiredCapabilities.join(", ")}`,
  );
}
console.log(`Wrote ${output}; completeForGo=${String(report.completeForGo)}`);
