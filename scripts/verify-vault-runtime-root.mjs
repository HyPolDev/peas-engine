import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";

const policyPath = "config/artifact-vault-deployment-policy.v1.json";
const policyBytes = readFileSync(policyPath);
const policy = JSON.parse(policyBytes.toString("utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (policy.policyVersion !== 1 || policy.runtimeRootEnvironmentVariable !== "PEAS_RUNTIME_ROOT") {
  throw new Error("Unsupported artifact-vault deployment policy");
}
const configured = process.env.PEAS_RUNTIME_ROOT;
if (configured === undefined || configured.length === 0)
  throw new Error("PEAS_RUNTIME_ROOT is required");
if (configured !== configured.trim() || !isAbsolute(configured)) {
  throw new Error("PEAS_RUNTIME_ROOT must be a trimmed absolute path");
}
if (process.platform === "win32" && /^(?:\\\\|\\\\[?.]\\)/u.test(configured)) {
  throw new Error("PEAS_RUNTIME_ROOT must not be a UNC or device path");
}

const root = resolve(configured);
const rootInfo = lstatSync(root);
if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
  throw new Error("PEAS_RUNTIME_ROOT must be a plain directory");
}
const finalRoot = realpathSync.native(root);
if (resolve(finalRoot).toLowerCase() !== root.toLowerCase()) {
  throw new Error("PEAS_RUNTIME_ROOT resolves through a redirected path");
}

const layout = Object.fromEntries(
  Object.entries(policy.layout).map(([name, suffix]) => [
    name,
    resolve(root, ...suffix.split("/")),
  ]),
);
for (const [name, path] of Object.entries(layout)) {
  const rel = relative(root, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`Deployment layout ${name} escapes PEAS_RUNTIME_ROOT`);
  }
}

let volume;
if (process.platform === "win32") {
  const drive = parse(root).root.slice(0, 1);
  if (!/^[A-Za-z]$/u.test(drive)) throw new Error("Windows runtime root must use a drive letter");
  const probe = `
$ErrorActionPreference = 'Stop'
$drive = $env:PEAS_RUNTIME_PROBE_DRIVE
$root = [IO.Path]::GetFullPath($env:PEAS_RUNTIME_ROOT)
$volume = Get-Volume -DriveLetter $drive
$partition = Get-Partition -DriveLetter $drive
$disk = Get-Disk -Number $partition.DiskNumber
$reparse = @()
$cursor = Get-Item -LiteralPath $root -Force
while ($null -ne $cursor) {
  if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $reparse += $cursor.FullName }
  $parent = $cursor.Parent
  if ($null -eq $parent) { break }
  $cursor = $parent
}
[pscustomobject]@{
  fileSystem = [string]$volume.FileSystemType
  driveType = [string]$volume.DriveType
  volumeId = [string]$volume.UniqueId
  volumePath = [string]$volume.Path
  diskNumber = [int]$disk.Number
  diskId = [string]$disk.UniqueId
  busType = [string]$disk.BusType
  reparseAncestors = $reparse
} | ConvertTo-Json -Compress
`;
  const output = execFileSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", probe],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PEAS_RUNTIME_PROBE_DRIVE: drive },
    },
  ).trim();
  volume = JSON.parse(output);
  const windowsPolicy = policy.configuredLocalRoot.windows;
  if (!windowsPolicy.fileSystems.includes(volume.fileSystem)) {
    throw new Error(`Configured runtime filesystem ${volume.fileSystem} is not allowed`);
  }
  if (!windowsPolicy.driveTypes.includes(volume.driveType)) {
    throw new Error(`Configured runtime drive type ${volume.driveType} is not local fixed storage`);
  }
  if (!windowsPolicy.busTypes.includes(volume.busType)) {
    throw new Error(`Configured runtime bus type ${volume.busType} is not allowed`);
  }
  if (!Array.isArray(volume.reparseAncestors) || volume.reparseAncestors.length !== 0) {
    throw new Error("Configured runtime root has a reparse ancestor");
  }
} else if (process.platform === "linux") {
  const mountInfo = readFileSync("/proc/self/mountinfo", "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" "))
    .filter((fields) => fields.length > 8 && root.startsWith(fields[4]))
    .sort((left, right) => right[4].length - left[4].length)[0];
  if (mountInfo === undefined) throw new Error("Unable to identify runtime-root mount");
  const separator = mountInfo.indexOf("-");
  const fileSystem = separator >= 0 ? mountInfo[separator + 1] : undefined;
  if (!policy.configuredLocalRoot.linux.fileSystems.includes(fileSystem)) {
    throw new Error(`Configured runtime filesystem ${String(fileSystem)} is not allowed`);
  }
  volume = { fileSystem, mountPoint: mountInfo[4], device: mountInfo[2] };
} else {
  throw new Error(`Configured runtime roots are unsupported on ${process.platform}`);
}

const result = {
  schemaVersion: 1,
  runtimeRoot: root,
  rootDevice: String(rootInfo.dev),
  rootInode: String(rootInfo.ino),
  policyPath,
  policySha256: sha256(policyBytes),
  layout,
  volume,
  status: "passed",
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const output = process.env.PEAS_RUNTIME_VALIDATION_PATH;
if (output === undefined) process.stdout.write(serialized);
else {
  writeFileSync(output, serialized, "utf8");
  console.log(`Wrote ${output}`);
}
