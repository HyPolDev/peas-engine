import { Readable } from "node:stream";

import type {
  ArtifactPage,
  ArtifactStore,
  ReconciliationBudget,
  ReconciliationReport,
  RetrievalAttempt,
  RetrievalAttemptId,
  StoreArtifactRequest,
  StoreArtifactResult,
  VerifiedArtifactRead,
  ArtifactMetadata,
  ArtifactObservation,
} from "../../../artifacts/artifact-store.js";
import type { ArtifactRetentionController, RetentionOperationLease } from "./contracts.js";
import { assertOwnedArtifactRetentionController } from "./controller.js";

export type RetentionUseLease = Readonly<{ kind: "retention-enforced-use-lease" }>;

type LeaseBinding = Readonly<{
  controller: ArtifactRetentionController;
  digests: ReadonlySet<string>;
}>;

const retentionStores = new WeakSet<object>();
const retentionLeases = new WeakMap<object, LeaseBinding>();

class RetentionGuardedReadable extends Readable {
  readonly #source: Readable;
  readonly #iterator: AsyncIterator<unknown>;
  readonly #digest: string;
  readonly #controller: ArtifactRetentionController;
  readonly #onSettled: () => void;
  #reading = false;

  constructor(
    source: Readable,
    digest: string,
    controller: ArtifactRetentionController,
    onSettled: () => void,
  ) {
    super();
    this.#source = source;
    this.#iterator = source[Symbol.asyncIterator]();
    this.#digest = digest;
    this.#controller = controller;
    this.#onSettled = onSettled;
  }

  override _read(): void {
    if (this.#reading || this.destroyed) return;
    this.#reading = true;
    void this.#pump();
  }

  async #pump(): Promise<void> {
    try {
      while (!this.destroyed) {
        const next = await this.#iterator.next();
        if (next.done === true) {
          this.#controller.assertArtifactUseAllowed(this.#digest);
          this.push(null);
          return;
        }
        this.#controller.assertArtifactUseAllowed(this.#digest);
        if (!this.push(next.value)) return;
      }
    } catch (error) {
      this.destroy(error instanceof Error ? error : new Error("retention-artifact-read-failed"));
    } finally {
      this.#reading = false;
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.#source.closed) {
      this.#onSettled();
      callback(error);
      return;
    }
    let completed = false;
    const ignoreSourceError = (): void => {};
    const complete = (): void => {
      if (completed) return;
      completed = true;
      this.#source.off("error", ignoreSourceError);
      this.#onSettled();
      callback(error);
    };
    this.#source.on("error", ignoreSourceError);
    this.#source.once("close", complete);
    this.#source.destroy();
    if (this.#source.closed) complete();
  }
}

function guardedStream(
  source: Readable,
  digest: string,
  controller: ArtifactRetentionController,
  onSettled: () => void,
): Readable {
  return new RetentionGuardedReadable(source, digest, controller, onSettled);
}

async function destroyAndSettle(stream: Readable): Promise<void> {
  if (stream.closed) return;
  await new Promise<void>((resolve) => {
    let completed = false;
    const ignoreError = (): void => {};
    const complete = (): void => {
      if (completed) return;
      completed = true;
      stream.off("error", ignoreError);
      resolve();
    };
    stream.on("error", ignoreError);
    stream.once("close", complete);
    stream.destroy();
  });
}

/** Unavoidable trusted-time guard for every artifact observation, metadata, and byte use. */
export class RetentionEnforcedArtifactStore implements ArtifactStore {
  readonly #store: ArtifactStore;
  readonly #controller: ArtifactRetentionController;

  constructor(store: ArtifactStore, controller: ArtifactRetentionController) {
    assertOwnedArtifactRetentionController(controller);
    this.#store = store;
    this.#controller = controller;
    retentionStores.add(this);
  }

  createUseLease(digests: readonly string[]): RetentionUseLease {
    const unique = new Set(digests);
    for (const digest of unique) this.#controller.assertArtifactUseAllowed(digest);
    const lease = Object.freeze({ kind: "retention-enforced-use-lease" as const });
    retentionLeases.set(lease, { controller: this.#controller, digests: unique });
    return lease;
  }

  store(request: StoreArtifactRequest): Promise<StoreArtifactResult> {
    void request;
    throw new TypeError("retention-owned-artifact-sink-required");
  }

  async stat(digest: string): Promise<ArtifactMetadata | undefined> {
    const operation = this.#controller.beginUse([digest]);
    try {
      const result = await this.#store.stat(digest);
      operation.assertAllowed();
      return result;
    } finally {
      operation.release();
    }
  }

  async read(digest: string): Promise<VerifiedArtifactRead> {
    const operation = this.#controller.beginUse([digest]);
    let result: VerifiedArtifactRead | undefined;
    try {
      result = await this.#store.read(digest);
      operation.assertAllowed();
      const stream = guardedStream(result.stream, digest, this.#controller, operation.release);
      operation.onStop(() => stream.destroy());
      return Object.freeze({ artifact: result.artifact, stream });
    } catch (error) {
      if (result !== undefined) await destroyAndSettle(result.stream);
      operation.release();
      throw error;
    }
  }

  getAttempt(id: RetrievalAttemptId): Promise<RetrievalAttempt | undefined> {
    return this.#store.getAttempt(id);
  }

  async getObservation(id: string): Promise<ArtifactObservation | undefined> {
    const operation = this.#controller.beginUse();
    try {
      const result = await this.#store.getObservation(id);
      if (result !== undefined) this.#controller.assertArtifactUseAllowed(result.artifactDigest);
      operation.assertAllowed();
      return result;
    } finally {
      operation.release();
    }
  }

  async readObservations(
    digest: string,
    afterSequence: string,
    limit: number,
  ): Promise<ArtifactPage<ArtifactObservation>> {
    const operation = this.#controller.beginUse([digest]);
    try {
      const result = await this.#store.readObservations(digest, afterSequence, limit);
      operation.assertAllowed();
      for (const observation of result.items) {
        if (observation.artifactDigest !== digest) {
          throw new TypeError("retention-observation-digest-mismatch");
        }
      }
      return result;
    } finally {
      operation.release();
    }
  }

  async reconcile(budget?: Partial<ReconciliationBudget>): Promise<ReconciliationReport> {
    const operation = this.#controller.beginUse();
    try {
      const result = await this.#store.reconcile(budget);
      operation.assertAllowed();
      return result;
    } finally {
      operation.release();
    }
  }
}

export function assertRetentionEnforcedArtifactStore(store: RetentionEnforcedArtifactStore): void {
  if (!retentionStores.has(store)) throw new TypeError("retention-enforced-store-required");
}

export function assertRetentionUseLease(
  lease: RetentionUseLease,
  artifactDigests: readonly string[],
  derivedIds: readonly string[] = [],
): void {
  const binding = retentionLeases.get(lease);
  if (binding === undefined || artifactDigests.some((digest) => !binding.digests.has(digest))) {
    throw new TypeError("retention-use-lease-invalid");
  }
  for (const digest of artifactDigests) binding.controller.assertArtifactUseAllowed(digest);
  for (const derivedId of derivedIds) binding.controller.assertDerivedUseAllowed(derivedId);
}

export function registerRetentionDerivedLineage(
  lease: RetentionUseLease,
  derivedIds: readonly string[],
): void {
  const binding = retentionLeases.get(lease);
  if (binding === undefined) throw new TypeError("retention-use-lease-invalid");
  binding.controller.registerDerivedLineage([...binding.digests], derivedIds);
}

export function beginRetentionUse(
  lease: RetentionUseLease,
  artifactDigests: readonly string[],
  derivedIds: readonly string[] = [],
): RetentionOperationLease {
  const binding = retentionLeases.get(lease);
  if (binding === undefined || artifactDigests.some((digest) => !binding.digests.has(digest))) {
    throw new TypeError("retention-use-lease-invalid");
  }
  return binding.controller.beginUse(artifactDigests, derivedIds);
}
