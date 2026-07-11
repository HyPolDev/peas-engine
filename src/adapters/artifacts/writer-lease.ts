import { open, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { ArtifactVaultError } from "../../artifacts/errors.js";

type LeaseRecord = Readonly<{ pid: number; token: string }>;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class VaultWriterLease {
  readonly #path: string;
  readonly #token: string;
  #held = true;

  private constructor(path: string, token: string) {
    this.#path = path;
    this.#token = token;
  }

  static async acquire(
    path: string,
    behavior: "fail" | "wait",
    waitMs: number,
  ): Promise<VaultWriterLease> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const token = randomUUID();
      try {
        const handle = await open(path, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, token } satisfies LeaseRecord));
        await handle.sync();
        await handle.close();
        return new VaultWriterLease(path, token);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const record = JSON.parse(await readFile(path, "utf8")) as LeaseRecord;
          if (!Number.isSafeInteger(record.pid) || !alive(record.pid)) await unlink(path);
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code !== "ENOENT") {
            throw new ArtifactVaultError(
              "writer-lease-unavailable",
              "Vault writer lease is invalid or held",
            );
          }
        }
        if (behavior === "fail" || Date.now() >= deadline) {
          throw new ArtifactVaultError(
            "writer-lease-unavailable",
            "Vault writer lease is held by another process",
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))),
        );
      }
    }
  }

  async release(): Promise<void> {
    if (!this.#held) return;
    this.#held = false;
    try {
      const record = JSON.parse(await readFile(this.#path, "utf8")) as LeaseRecord;
      if (record.token === this.#token) await unlink(this.#path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
