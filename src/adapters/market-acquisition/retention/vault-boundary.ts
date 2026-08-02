import { lstat, opendir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isProxy } from "node:util/types";

import {
  type DurableArtifactStore,
  assertOwnedDurableArtifactStore,
} from "../../artifacts/durable-artifact-store.js";
import { artifactRuntimePaths, assertPathBelowRuntimeRoot } from "../../artifacts/runtime-root.js";
import { hashTrustedFile, safeChild, syncDirectory } from "../../artifacts/trusted-filesystem.js";
import { digestContentPath } from "../private-artifact-policy.js";
import type { ErasureCopyKind, ErasureResult, RetentionArtifactBoundary } from "./contracts.js";

const MAX_PRIVATE_DIRECTORY_ENTRIES = 1_024;
const ownedVaultBoundaries = new WeakSet<object>();
const vaultCoordinatorRoots = new WeakMap<object, DurableArtifactStore>();

async function directoryNames(path: string, device: number): Promise<readonly string[]> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== device)
    throw new Error("Retention scan directory is not trusted");
  const directory = await opendir(path);
  const names: string[] = [];
  try {
    for (;;) {
      const entry = await directory.read();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > MAX_PRIVATE_DIRECTORY_ENTRIES)
        throw new Error("Retention scan directory exceeds its reviewed bound");
    }
  } finally {
    await directory.close();
  }
  return names.sort();
}

export class VaultArtifactRetentionBoundary implements RetentionArtifactBoundary {
  readonly #store: DurableArtifactStore;
  readonly #runtimeRoot: string;
  readonly #device: number;
  readonly #settlementTimeoutMs: number;

  private constructor(
    store: DurableArtifactStore,
    runtimeRoot: string,
    device: number,
    settlementTimeoutMs: number,
  ) {
    this.#store = store;
    this.#runtimeRoot = runtimeRoot;
    this.#device = device;
    this.#settlementTimeoutMs = settlementTimeoutMs;
  }

  static async open(input: {
    store: DurableArtifactStore;
    runtimeRoot: string;
    settlementTimeoutMs?: number;
  }): Promise<VaultArtifactRetentionBoundary> {
    const runtimeRoot = resolve(input.runtimeRoot);
    assertOwnedDurableArtifactStore(input.store, runtimeRoot);
    const rootInfo = await lstat(runtimeRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new Error("Retention runtime root is not trusted");
    const boundary = new VaultArtifactRetentionBoundary(
      input.store,
      runtimeRoot,
      rootInfo.dev,
      input.settlementTimeoutMs ?? 30_000,
    );
    ownedVaultBoundaries.add(boundary);
    vaultCoordinatorRoots.set(boundary, input.store);
    Object.freeze(boundary);
    return boundary;
  }

  async settleActiveReadersAndWriters(): Promise<boolean> {
    this.#store.closeRetentionAdmission();
    try {
      return await this.#store.settleForRetention(this.#settlementTimeoutMs);
    } finally {
      this.#store.reopenRetentionAdmission();
    }
  }

  async eraseDigestCopies(digest: string): Promise<ErasureResult> {
    const paths = artifactRuntimePaths(this.#runtimeRoot);
    const counts: Record<ErasureCopyKind, number> = {
      content: 0,
      staging: 0,
      snapshot: 0,
      quarantine: 0,
    };
    type Candidate = Readonly<{ kind: ErasureCopyKind; path: string }>;
    const candidates: Candidate[] = [];
    const content = digestContentPath(this.#runtimeRoot, digest);
    try {
      await lstat(content);
      candidates.push({ kind: "content", path: content });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const [kind, directory] of [
      ["staging", paths.staging],
      ["snapshot", paths.snapshots],
      ["quarantine", paths.quarantine],
    ] as const) {
      for (const name of await directoryNames(directory, this.#device)) {
        candidates.push({ kind, path: safeChild(directory, name) });
      }
    }
    const groups = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      assertPathBelowRuntimeRoot(this.#runtimeRoot, candidate.path);
      const info = await lstat(candidate.path);
      if (!info.isFile() || info.isSymbolicLink() || info.dev !== this.#device || info.nlink < 1) {
        throw new Error("Retention scan encountered an unsafe private copy");
      }
      const key = `${info.dev}:${info.ino}`;
      const group = groups.get(key) ?? [];
      group.push(candidate);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const first = group[0] as Candidate;
      const initial = await lstat(first.path);
      if (initial.nlink !== group.length) {
        throw new Error("Retention scan encountered an unowned hard-link copy");
      }
      const verified = await hashTrustedFile(first.path, Number.MAX_SAFE_INTEGER, group.length);
      if (verified.digest !== digest) {
        if (group.some((candidate) => candidate.kind === "content")) {
          throw new Error("Retention content path contains conflicting bytes");
        }
        continue;
      }
      let remainingLinks = group.length;
      for (const candidate of group.sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      )) {
        const current = await lstat(candidate.path);
        if (
          current.dev !== initial.dev ||
          current.ino !== initial.ino ||
          current.nlink !== remainingLinks
        ) {
          throw new Error("Retention hard-link identity changed before erasure");
        }
        const currentBytes = await hashTrustedFile(
          candidate.path,
          Number.MAX_SAFE_INTEGER,
          remainingLinks,
        );
        if (currentBytes.digest !== digest) {
          throw new Error("Retention hard-link bytes changed before erasure");
        }
        await rm(candidate.path);
        await syncDirectory(dirname(candidate.path));
        counts[candidate.kind] += 1;
        remainingLinks -= 1;
      }
    }
    return {
      artifactDigest: digest,
      erasedCopies: counts,
      alreadyAbsent: Object.values(counts).every((value) => value === 0),
    };
  }

  async verifyDigestCopiesAbsent(digest: string): Promise<boolean> {
    const paths = artifactRuntimePaths(this.#runtimeRoot);
    try {
      await lstat(digestContentPath(this.#runtimeRoot, digest));
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const directory of [paths.staging, paths.snapshots, paths.quarantine]) {
      for (const name of await directoryNames(directory, this.#device)) {
        const path = safeChild(directory, name);
        assertPathBelowRuntimeRoot(this.#runtimeRoot, path);
        const verified = await hashTrustedFile(path);
        if (verified.digest === digest) return false;
      }
    }
    return true;
  }
}

/** Module-owned serialization key shared by every boundary opened over the same durable store. */
export function ownedVaultRetentionCoordinatorRoot(
  value: RetentionArtifactBoundary,
): DurableArtifactStore {
  assertOwnedVaultArtifactRetentionBoundary(value);
  const root = vaultCoordinatorRoots.get(value);
  if (root === undefined) throw new TypeError("owned-vault-retention-boundary-required");
  return root;
}

export function assertOwnedVaultArtifactRetentionBoundary(
  value: RetentionArtifactBoundary,
): asserts value is VaultArtifactRetentionBoundary {
  if (
    !ownedVaultBoundaries.has(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== VaultArtifactRetentionBoundary.prototype
  ) {
    throw new TypeError("owned-vault-retention-boundary-required");
  }
}
