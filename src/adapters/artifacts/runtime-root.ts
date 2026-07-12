import { isAbsolute, join, relative, resolve, sep, posix, win32 } from "node:path";

import { ArtifactVaultError } from "../../artifacts/errors.js";

export const PEAS_RUNTIME_ROOT_ENV = "PEAS_RUNTIME_ROOT";
export const ARTIFACT_DATABASE_FILENAME = "peas.sqlite";

export type ArtifactRuntimePaths = Readonly<{
  runtimeRoot: string;
  databaseDirectory: string;
  databasePath: string;
  artifactsRoot: string;
  content: string;
  staging: string;
  snapshots: string;
  quarantine: string;
  locks: string;
}>;

function rejectWindowsNamespace(path: string): void {
  if (/^(?:\\\\|\\\\[?.]\\)/u.test(path)) {
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "PEAS_RUNTIME_ROOT must be a local drive path, not a UNC or device path",
    );
  }
  const root = win32.parse(path).root;
  if (!/^[A-Za-z]:\\$/u.test(root)) {
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "PEAS_RUNTIME_ROOT must identify an absolute local Windows drive",
    );
  }
}

export function configuredPeasRuntimeRoot(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment[PEAS_RUNTIME_ROOT_ENV];
  if (configured === undefined || configured.trim() === "") {
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      `${PEAS_RUNTIME_ROOT_ENV} is required`,
    );
  }
  const pathFlavor = platform === "win32" ? win32 : posix;
  if (configured !== configured.trim() || !pathFlavor.isAbsolute(configured)) {
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      `${PEAS_RUNTIME_ROOT_ENV} must be a trimmed absolute path`,
    );
  }
  if (platform === "win32") rejectWindowsNamespace(configured);
  if (platform !== "win32" && platform !== "linux") {
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      `Configured artifact runtime roots are unsupported on ${platform}`,
    );
  }
  return pathFlavor.resolve(configured);
}

export function artifactRuntimePaths(runtimeRoot: string): ArtifactRuntimePaths {
  if (!isAbsolute(runtimeRoot)) {
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "Artifact runtime root must be absolute",
    );
  }
  if (process.platform === "win32") rejectWindowsNamespace(runtimeRoot);
  const root = resolve(runtimeRoot);
  const databaseDirectory = join(root, "sqlite");
  const artifactsRoot = join(root, "artifacts");
  return {
    runtimeRoot: root,
    databaseDirectory,
    databasePath: join(databaseDirectory, ARTIFACT_DATABASE_FILENAME),
    artifactsRoot,
    content: join(artifactsRoot, "sha256"),
    staging: join(artifactsRoot, "staging"),
    snapshots: join(artifactsRoot, "snapshots"),
    quarantine: join(artifactsRoot, "quarantine"),
    locks: join(artifactsRoot, "locks"),
  };
}

export function assertPathBelowRuntimeRoot(runtimeRoot: string, path: string): void {
  const root = resolve(runtimeRoot);
  const candidate = resolve(path);
  const rel = relative(root, candidate);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "Artifact path must remain below PEAS_RUNTIME_ROOT",
    );
  }
}

/** @deprecated Runtime roots are explicit; use configuredPeasRuntimeRoot. */
export const defaultPeasRuntimeRoot = configuredPeasRuntimeRoot;
