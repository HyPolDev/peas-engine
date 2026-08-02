import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { isProxy } from "node:util/types";

import type {
  StoreArtifactRequest,
  StoreArtifactResult,
} from "../../../artifacts/artifact-store.js";
import { deriveObservationId } from "../../../artifacts/identity.js";
import {
  type DurableArtifactStore,
  assertOwnedDurableArtifactStore,
} from "../../artifacts/durable-artifact-store.js";
import type { ArtifactRetentionController, RetentionOwnership } from "../retention/contracts.js";
import { assertOwnedArtifactRetentionController } from "../retention/controller.js";
import type { AlpacaArtifactCommitSink, AlpacaVerifiedPageSink } from "./contracts.js";

const retentionOwnedSinks = new WeakSet<object>();
const ownedArtifactCommitSinks = new WeakSet<object>();
const RETENTION_SINK_CONSTRUCTION_AUTHORITY = Object.freeze({});

type AlpacaDurableSinkInput = Readonly<{
  request: Omit<StoreArtifactRequest, "entityBytes">;
  ownership: Omit<
    RetentionOwnership,
    "ownershipId" | "artifactObservationId" | "artifactDigest" | "artifactSizeBytes"
  >;
}>;

class DurableAlpacaArtifactCommitSink implements AlpacaArtifactCommitSink<StoreArtifactResult> {
  readonly #store: DurableArtifactStore;
  readonly #input: AlpacaDurableSinkInput;
  readonly #chunks: Buffer[] = [];
  #settled = false;

  constructor(store: DurableArtifactStore, input: AlpacaDurableSinkInput) {
    this.#store = store;
    this.#input = input;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.#settled) throw new TypeError("alpaca-artifact-sink-settled");
    this.#chunks.push(Buffer.from(bytes));
  }

  async prepareVerifiedCommit() {
    if (this.#settled) throw new TypeError("alpaca-artifact-sink-settled");
    this.#settled = true;
    const snapshot = Buffer.concat(this.#chunks);
    for (const chunk of this.#chunks) chunk.fill(0);
    this.#chunks.length = 0;
    const digest = createHash("sha256").update(snapshot).digest("hex");
    const observationId = deriveObservationId(
      this.#input.request.attempt,
      digest,
      this.#input.request.response,
    );
    const ownership = Object.freeze({
      ...this.#input.ownership,
      artifactObservationId: observationId,
      artifactDigest: digest,
      artifactSizeBytes: snapshot.byteLength,
    });
    return Object.freeze({
      ownership,
      commit: async (): Promise<StoreArtifactResult> => {
        try {
          const result = await this.#store.store({
            ...this.#input.request,
            entityBytes: Readable.from([snapshot]),
          });
          if (
            result.artifact.digest !== digest ||
            result.artifact.sizeBytes !== snapshot.byteLength ||
            result.observation.observationId !== observationId ||
            result.observation.artifactDigest !== digest
          ) {
            throw new TypeError("alpaca-artifact-commit-evidence-mismatch");
          }
          return result;
        } finally {
          snapshot.fill(0);
        }
      },
    });
  }

  async abort(): Promise<void> {
    for (const chunk of this.#chunks) chunk.fill(0);
    this.#chunks.length = 0;
    this.#settled = true;
  }
  destroy(): Promise<void> {
    return this.abort();
  }
  async settle(): Promise<void> {}
}

export function createDurableAlpacaArtifactCommitSink(
  store: DurableArtifactStore,
  input: AlpacaDurableSinkInput,
): AlpacaArtifactCommitSink<StoreArtifactResult> {
  assertOwnedDurableArtifactStore(store);
  const sink = new DurableAlpacaArtifactCommitSink(store, input);
  ownedArtifactCommitSinks.add(sink);
  Object.freeze(sink);
  return sink;
}

export function createTestAlpacaArtifactCommitSink<T>(
  sink: AlpacaArtifactCommitSink<T>,
): AlpacaArtifactCommitSink<T> {
  if (process.env["NODE_TEST_CONTEXT"] === undefined) {
    throw new TypeError("test-alpaca-artifact-sink-unavailable");
  }
  const facade: AlpacaArtifactCommitSink<T> = Object.freeze({
    write: sink.write.bind(sink),
    prepareVerifiedCommit: sink.prepareVerifiedCommit.bind(sink),
    abort: sink.abort.bind(sink),
    destroy: sink.destroy.bind(sink),
    settle: sink.settle.bind(sink),
  });
  ownedArtifactCommitSinks.add(facade);
  return facade;
}

function assertOwnedArtifactCommitSink(value: AlpacaArtifactCommitSink<unknown>): void {
  if (!ownedArtifactCommitSinks.has(value) || isProxy(value)) {
    throw new TypeError("owned-alpaca-artifact-commit-sink-required");
  }
}

/**
 * Sole production artifact-completion composition. Ownership is durably admitted against the
 * active provider-stop state before physical commit; no artifact result is observable until both
 * ownership admission and commit succeed.
 */
export class RetentionOwnedAlpacaPageSink<T> implements AlpacaVerifiedPageSink<T> {
  readonly #sink: AlpacaArtifactCommitSink<T>;
  readonly #retention: ArtifactRetentionController;
  readonly #hash = createHash("sha256");
  #sizeBytes = 0;
  #prepared = false;

  constructor(
    sink: AlpacaArtifactCommitSink<T>,
    retention: ArtifactRetentionController,
    authority?: object,
  ) {
    assertOwnedArtifactCommitSink(sink);
    assertOwnedArtifactRetentionController(retention);
    this.#sink = sink;
    this.#retention = retention;
    if (authority === RETENTION_SINK_CONSTRUCTION_AUTHORITY) retentionOwnedSinks.add(this);
  }

  async write(bytes: Uint8Array): Promise<void> {
    const snapshot = Buffer.from(bytes);
    try {
      await this.#sink.write(snapshot);
      this.#hash.update(snapshot);
      this.#sizeBytes += snapshot.byteLength;
    } finally {
      snapshot.fill(0);
    }
  }

  async completeVerifyAndRegisterOwnership(): Promise<T> {
    if (this.#prepared) throw new TypeError("alpaca-artifact-commit-already-prepared");
    this.#prepared = true;
    const prepared = await this.#sink.prepareVerifiedCommit();
    const digest = this.#hash.digest("hex");
    if (
      prepared.ownership.artifactDigest !== digest ||
      prepared.ownership.artifactSizeBytes !== this.#sizeBytes
    ) {
      throw new TypeError("alpaca-artifact-ownership-byte-mismatch");
    }
    return this.#retention.commitArtifact(prepared.ownership, prepared.commit);
  }

  abort(): Promise<void> {
    return this.#sink.abort();
  }

  destroy(): Promise<void> {
    return this.#sink.destroy();
  }

  settle(): Promise<void> {
    return this.#sink.settle();
  }
}

export function createRetentionOwnedAlpacaPageSink<T>(
  sink: AlpacaArtifactCommitSink<T>,
  retention: ArtifactRetentionController,
): RetentionOwnedAlpacaPageSink<T> {
  assertOwnedArtifactCommitSink(sink);
  assertOwnedArtifactRetentionController(retention);
  const value = new RetentionOwnedAlpacaPageSink(
    sink,
    retention,
    RETENTION_SINK_CONSTRUCTION_AUTHORITY,
  );
  retentionOwnedSinks.add(value);
  Object.freeze(value);
  return value;
}

export function assertRetentionOwnedAlpacaPageSink(value: AlpacaVerifiedPageSink<unknown>): void {
  if (
    !retentionOwnedSinks.has(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== RetentionOwnedAlpacaPageSink.prototype ||
    !Object.isFrozen(value)
  ) {
    throw new TypeError("alpaca-retention-owned-sink-required");
  }
}
