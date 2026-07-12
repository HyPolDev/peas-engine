import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";

import { ArtifactVaultError } from "../../artifacts/errors.js";
import type { Clock } from "../../core/clock.js";
import type { SqliteArtifactRepository, WriterFence } from "./sqlite-artifact-repository.js";

type LeaseRecord = Readonly<{
  pid: number;
  ownerToken: string;
  generation: number;
  expiresAtMs: number;
}>;
const NOOP_FAULT_BOUNDARY = (): void => undefined;

export class VaultWriterLease {
  readonly #path: string;
  readonly #repository: SqliteArtifactRepository;
  readonly #clock: Clock;
  readonly #durationMs: number;
  readonly #ownerToken: string;
  readonly #generation: number;
  readonly #faultBoundary: (checkpoint: string) => void | Promise<void>;
  readonly #heartbeat: NodeJS.Timeout;
  #held = true;

  private constructor(options: {
    path: string;
    repository: SqliteArtifactRepository;
    clock: Clock;
    durationMs: number;
    ownerToken: string;
    generation: number;
    renewalMs: number;
    faultBoundary: (checkpoint: string) => void | Promise<void>;
  }) {
    this.#path = options.path;
    this.#repository = options.repository;
    this.#clock = options.clock;
    this.#durationMs = options.durationMs;
    this.#ownerToken = options.ownerToken;
    this.#generation = options.generation;
    this.#faultBoundary = options.faultBoundary;
    this.#heartbeat = setInterval(() => {
      void this.renewAndAssert().catch(() => undefined);
    }, options.renewalMs);
    this.#heartbeat.unref();
  }

  static async acquire(options: {
    path: string;
    behavior: "fail" | "wait";
    waitMs: number;
    durationMs: number;
    renewalMs: number;
    repository: SqliteArtifactRepository;
    clock: Clock;
    faultBoundary?: (checkpoint: string) => void | Promise<void>;
  }): Promise<VaultWriterLease> {
    const deadline = Date.now() + options.waitMs;
    for (;;) {
      const ownerToken = randomUUID();
      const nowMs = options.clock.nowMs();
      try {
        const handle = await open(options.path, "wx", 0o600);
        try {
          await handle.writeFile(
            JSON.stringify({
              pid: process.pid,
              ownerToken,
              generation: 0,
              expiresAtMs: nowMs + options.durationMs,
            } satisfies LeaseRecord),
          );
          await handle.sync();
        } finally {
          await handle.close();
        }
        await options.faultBoundary?.("lease-file-installation");
        let generation: number;
        try {
          generation = options.repository.claimWriter(ownerToken, nowMs, options.durationMs);
          await options.faultBoundary?.("lease-sqlite-claim");
        } catch (error) {
          await rm(options.path, { force: true });
          throw error;
        }
        const lease = new VaultWriterLease({
          ...options,
          ownerToken,
          generation,
          faultBoundary: options.faultBoundary ?? NOOP_FAULT_BOUNDARY,
        });
        await lease.#writeRecord(nowMs + options.durationMs);
        await options.faultBoundary?.("lease-record-sync");
        return lease;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" &&
          !(error instanceof Error && error.message.includes("fence is held"))
        )
          throw error;
        try {
          const record = JSON.parse(await readFile(options.path, "utf8")) as LeaseRecord;
          if (!Number.isSafeInteger(record.expiresAtMs) || record.expiresAtMs <= nowMs) {
            const stale = `${options.path}.${randomUUID()}.expired`;
            await rename(options.path, stale);
            await rm(stale, { force: true });
            continue;
          }
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw new ArtifactVaultError(
            "writer-lease-unavailable",
            "Vault writer lease is invalid or held",
          );
        }
        if (options.behavior === "fail" || Date.now() >= deadline) {
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

  fence(): WriterFence {
    return {
      ownerToken: this.#ownerToken,
      generation: this.#generation,
      nowMs: () => this.#clock.nowMs(),
    };
  }

  async renewAndAssert(): Promise<void> {
    if (!this.#held)
      throw new ArtifactVaultError("writer-lease-unavailable", "Vault writer lease was lost");
    const nowMs = this.#clock.nowMs();
    try {
      this.#repository.renewWriter(this.#ownerToken, this.#generation, nowMs, this.#durationMs);
      await this.#faultBoundary("lease-sqlite-renewal");
      await this.#writeRecord(nowMs + this.#durationMs);
      await this.#faultBoundary("lease-file-renewal");
    } catch (error) {
      this.#held = false;
      clearInterval(this.#heartbeat);
      throw new ArtifactVaultError("writer-lease-unavailable", "Vault writer lease was lost", {
        cause: error,
      });
    }
  }

  async #writeRecord(expiresAtMs: number): Promise<void> {
    const existing = await readFile(this.#path, "utf8");
    if (existing !== "") {
      const record = JSON.parse(existing) as LeaseRecord;
      if (
        record.ownerToken !== this.#ownerToken ||
        (record.generation !== 0 && record.generation !== this.#generation)
      )
        throw new Error("Vault writer lease file was replaced");
    }
    const handle = await open(this.#path, "r+", 0o600);
    try {
      await handle.truncate(0);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          ownerToken: this.#ownerToken,
          generation: this.#generation,
          expiresAtMs,
        } satisfies LeaseRecord),
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async release(): Promise<void> {
    if (!this.#held) return;
    this.#held = false;
    clearInterval(this.#heartbeat);
    try {
      const record = JSON.parse(await readFile(this.#path, "utf8")) as LeaseRecord;
      if (record.ownerToken === this.#ownerToken && record.generation === this.#generation)
        await rm(this.#path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
