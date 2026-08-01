import type { ArtifactRetentionController } from "../retention/contracts.js";
import { assertOwnedArtifactRetentionController } from "../retention/controller.js";
import type { AlpacaArtifactCommitSink, AlpacaVerifiedPageSink } from "./contracts.js";

const retentionOwnedSinks = new WeakSet<object>();

/**
 * Sole production artifact-completion composition. Ownership is durably admitted against the
 * active provider-stop state before physical commit; no artifact result is observable until both
 * ownership admission and commit succeed.
 */
export class RetentionOwnedAlpacaPageSink<T> implements AlpacaVerifiedPageSink<T> {
  readonly #sink: AlpacaArtifactCommitSink<T>;
  readonly #retention: ArtifactRetentionController;
  #prepared = false;

  constructor(sink: AlpacaArtifactCommitSink<T>, retention: ArtifactRetentionController) {
    assertOwnedArtifactRetentionController(retention);
    this.#sink = sink;
    this.#retention = retention;
    retentionOwnedSinks.add(this);
  }

  write(bytes: Uint8Array): Promise<void> {
    return this.#sink.write(bytes);
  }

  async completeVerifyAndRegisterOwnership(): Promise<T> {
    if (this.#prepared) throw new TypeError("alpaca-artifact-commit-already-prepared");
    this.#prepared = true;
    const prepared = await this.#sink.prepareVerifiedCommit();
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

export function assertRetentionOwnedAlpacaPageSink(value: AlpacaVerifiedPageSink<unknown>): void {
  if (!retentionOwnedSinks.has(value)) {
    throw new TypeError("alpaca-retention-owned-sink-required");
  }
}
