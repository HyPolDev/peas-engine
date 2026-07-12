import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { ArtifactVaultError } from "../../artifacts/errors.js";
import { assertSafeByteAddition } from "../../artifacts/validation.js";
import type { JsonValue } from "../../core/json.js";

export async function ensurePlainDirectory(path: string): Promise<void> {
  const resolved = resolve(path);
  const ancestors: string[] = [];
  let cursor = resolved;
  for (;;) {
    ancestors.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const ancestor of ancestors.reverse()) {
    try {
      const info = await lstat(ancestor);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new ArtifactVaultError(
          "unsafe-filesystem-object",
          "Vault path contains an unsafe filesystem object",
        );
      if (process.platform !== "win32") {
        const final = await realpath(ancestor);
        if (resolve(final) !== resolve(ancestor))
          throw new ArtifactVaultError(
            "unsafe-filesystem-object",
            "Vault path resolves through a redirected filesystem object",
          );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await mkdir(ancestor, { mode: 0o700 });
      } catch (createError) {
        if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError;
      }
      const created = await lstat(ancestor);
      if (!created.isDirectory() || created.isSymbolicLink())
        throw new ArtifactVaultError(
          "unsafe-filesystem-object",
          "Vault directory creation was redirected",
        );
      if (process.platform !== "win32") {
        const final = await realpath(ancestor);
        if (resolve(final) !== resolve(ancestor))
          throw new ArtifactVaultError(
            "unsafe-filesystem-object",
            "Vault directory creation resolved through a redirected filesystem object",
          );
      }
    }
  }
}

export async function assertTrustedPath(root: string, path: string, device: number): Promise<void> {
  const trustedRoot = resolve(root);
  const candidate = resolve(path);
  const rel = relative(trustedRoot, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel === "")
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "Vault path escaped its configured root",
    );
  const rootInfo = await lstat(trustedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.dev !== device)
    throw new ArtifactVaultError("unsafe-filesystem-object", "Vault root identity changed");
  let cursor = trustedRoot;
  for (const part of rel.split(sep).filter(Boolean).slice(0, -1)) {
    cursor = join(cursor, part);
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== device)
      throw new ArtifactVaultError(
        "unsafe-filesystem-object",
        "Vault ancestor is not a trusted same-volume directory",
      );
    if (process.platform !== "win32") {
      const final = await realpath(cursor);
      if (resolve(final) !== resolve(cursor))
        throw new ArtifactVaultError(
          "unsafe-filesystem-object",
          "Vault ancestor resolves outside its verified identity",
        );
    }
  }
}

export function safeChild(root: string, ...parts: readonly string[]): string {
  const child = resolve(root, ...parts);
  const rel = relative(resolve(root), child);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`))
    throw new ArtifactVaultError(
      "unsafe-filesystem-object",
      "Vault path escaped its configured root",
    );
  return child;
}

export async function hashTrustedFile(
  path: string,
  maxBytes = Number.MAX_SAFE_INTEGER,
  maxLinkCount = 1,
): Promise<{ digest: string; sizeBytes: number }> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink < 1 || before.nlink > maxLinkCount)
      throw new ArtifactVaultError(
        "unsafe-filesystem-object",
        "Artifact content is not a trusted single-owner regular file",
      );
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const buffer = Buffer.allocUnsafe(64 * 1_024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      sizeBytes = assertSafeByteAddition(sizeBytes, bytesRead);
      if (sizeBytes > maxBytes)
        throw new ArtifactVaultError(
          "artifact-too-large",
          "Artifact exceeds reconciliation byte budget",
        );
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      after.nlink < 1 ||
      after.nlink > maxLinkCount
    )
      throw new ArtifactVaultError(
        "unsafe-filesystem-object",
        "Artifact identity changed during verification",
      );
    return { digest: hash.digest("hex"), sizeBytes };
  } finally {
    await handle.close();
  }
}

export async function filesystemIdentity(path: string): Promise<JsonValue> {
  const info = await lstat(path);
  return {
    device: String(info.dev),
    inode: String(info.ino),
    mode: info.mode,
    linkCount: info.nlink,
    sizeBytes: info.size,
    modifiedAtMs: Math.trunc(info.mtimeMs),
    isFile: info.isFile(),
    isDirectory: info.isDirectory(),
    isSymbolicLink: info.isSymbolicLink(),
  };
}

export async function syncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform !== "win32" ||
      (code !== "EPERM" && code !== "EACCES" && code !== "EINVAL")
    )
      throw error;
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // The primary sync error remains authoritative.
      }
    }
  }
}
