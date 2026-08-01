import { lstat, opendir } from "node:fs/promises";
import { resolve } from "node:path";

import type { DurableArtifactStore } from "../../artifacts/durable-artifact-store.js";
import { artifactRuntimePaths, assertPathBelowRuntimeRoot } from "../../artifacts/runtime-root.js";
import {
  eraseTrustedFileMatchingDigest,
  hashTrustedFile,
  safeChild,
} from "../../artifacts/trusted-filesystem.js";
import { digestContentPath } from "../private-artifact-policy.js";
import type { ErasureCopyKind, ErasureResult, RetentionArtifactBoundary } from "./contracts.js";

const MAX_PRIVATE_DIRECTORY_ENTRIES = 1_024;

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
    const rootInfo = await lstat(runtimeRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new Error("Retention runtime root is not trusted");
    return new VaultArtifactRetentionBoundary(
      input.store,
      runtimeRoot,
      rootInfo.dev,
      input.settlementTimeoutMs ?? 30_000,
    );
  }

  settleActiveReadersAndWriters(): Promise<boolean> {
    return this.#store.settleForRetention(this.#settlementTimeoutMs);
  }

  async eraseDigestCopies(digest: string): Promise<ErasureResult> {
    const paths = artifactRuntimePaths(this.#runtimeRoot);
    const counts: Record<ErasureCopyKind, number> = {
      content: 0,
      staging: 0,
      snapshot: 0,
      quarantine: 0,
    };
    const content = digestContentPath(this.#runtimeRoot, digest);
    const contentOutcome = await eraseTrustedFileMatchingDigest(
      paths.artifactsRoot,
      content,
      this.#device,
      digest,
    );
    if (contentOutcome === "different-content")
      throw new Error("Retention content path contains conflicting bytes");
    if (contentOutcome === "erased") counts.content += 1;

    for (const [kind, directory] of [
      ["staging", paths.staging],
      ["snapshot", paths.snapshots],
      ["quarantine", paths.quarantine],
    ] as const) {
      for (const name of await directoryNames(directory, this.#device)) {
        const path = safeChild(directory, name);
        assertPathBelowRuntimeRoot(this.#runtimeRoot, path);
        let verified: Awaited<ReturnType<typeof hashTrustedFile>>;
        try {
          verified = await hashTrustedFile(path);
        } catch {
          throw new Error("Retention scan encountered an unsafe private copy");
        }
        if (verified.digest !== digest) continue;
        const outcome = await eraseTrustedFileMatchingDigest(
          paths.artifactsRoot,
          path,
          this.#device,
          digest,
        );
        if (outcome === "erased") counts[kind] += 1;
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
