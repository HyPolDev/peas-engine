import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { isProxy } from "node:util/types";
import { P1_10_TEST_AUTHORITY } from "../../../internal-test-authority.js";
import { assertValidatedMarketAcquisitionConfiguration } from "../configuration.js";
import type { ValidatedMarketAcquisitionConfiguration } from "../contracts.js";
import { ALPACA_ROUTE_REGISTRY } from "../identity.js";
import {
  ALPACA_PRIVATE_ARTIFACT_POLICY,
  ALPACA_RETENTION_POLICY_ID,
  retentionExpiryMs,
} from "../private-artifact-policy.js";
import {
  consumeOwnedAlpacaArtifactCommitAuthority,
  type AlpacaArtifactCommitAuthority,
} from "../credentials.js";

import type {
  StoreArtifactRequest,
  StoreArtifactResult,
} from "../../../artifacts/artifact-store.js";
import { deriveObservationId, sanitizeRequestIdentity } from "../../../artifacts/identity.js";
import {
  validateHttpResponseMetadata,
  validateRetrievalAttempt,
} from "../../../artifacts/validation.js";
import {
  type DurableArtifactStore,
  assertOwnedDurableArtifactStore,
  ownedDurableArtifactStoreRuntimeIdentity,
} from "../../artifacts/durable-artifact-store.js";
import type { ArtifactRetentionController, RetentionOwnership } from "../retention/contracts.js";
import {
  assertOwnedArtifactRetentionController,
  ownedArtifactRetentionControllerRuntimeIdentity,
} from "../retention/controller.js";
import type {
  AlpacaArtifactCommitSink,
  AlpacaPreparedArtifactCommit,
  AlpacaVerifiedPageSink,
} from "./contracts.js";

const retentionOwnedSinks = new WeakSet<object>();
const ownedArtifactCommitSinks = new WeakSet<object>();
const artifactCommitSinkRoots = new WeakMap<object, object>();
const artifactCommitStores = new WeakMap<object, DurableArtifactStore>();
const retentionSinkCommitSinks = new WeakMap<object, AlpacaArtifactCommitSink<unknown>>();
const ownedCommittedPageResults = new WeakMap<
  object,
  Readonly<{ store: DurableArtifactStore; retention: ArtifactRetentionController }>
>();
const artifactCommitAuthorities = new WeakMap<
  object,
  Readonly<{
    plan: ValidatedMarketAcquisitionConfiguration;
    retrievalAttemptId: string;
    admittedAtMs: number;
  }>
>();
type PreparedArtifactCommitBinding<T> = Readonly<{
  prepared: AlpacaPreparedArtifactCommit<T>;
  runtimeIdentity?: object;
  dispose(): void;
}>;
const preparedArtifactCommits = new WeakMap<object, PreparedArtifactCommitBinding<unknown>>();
const RETENTION_SINK_CONSTRUCTION_AUTHORITY = Object.freeze({});

type AlpacaDurableSinkInput = Readonly<{
  request: Pick<StoreArtifactRequest, "response">;
  plan: ValidatedMarketAcquisitionConfiguration;
  retention: Pick<RetentionOwnership, "derivedIds">;
}>;

class DurableAlpacaArtifactCommitSink implements AlpacaArtifactCommitSink<StoreArtifactResult> {
  readonly #store: DurableArtifactStore;
  readonly #input: AlpacaDurableSinkInput;
  readonly #chunks: Buffer[] = [];
  #settled = false;

  constructor(store: DurableArtifactStore, input: AlpacaDurableSinkInput) {
    this.#store = store;
    assertValidatedMarketAcquisitionConfiguration(input.plan);
    if (input.plan.route !== ALPACA_ROUTE_REGISTRY[input.plan.kind]) {
      throw new TypeError("alpaca-artifact-request-authority-invalid");
    }
    this.#input = Object.freeze({
      request: input.request,
      plan: input.plan,
      retention: Object.freeze({
        derivedIds: Object.freeze([...input.retention.derivedIds]),
      }),
    });
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
    try {
      const authority = artifactCommitAuthorities.get(this);
      if (authority === undefined || authority.plan !== this.#input.plan) {
        throw new TypeError("alpaca-artifact-commit-authority-required");
      }
      artifactCommitAuthorities.delete(this);
      const trustedCaptureMs = authority.admittedAtMs;
      const routeRequest = sanitizeRequestIdentity({
        method: this.#input.plan.route.method,
        origin: this.#input.plan.route.origin,
        path: this.#input.plan.route.path,
        routeLabel: this.#input.plan.route.safeRouteLabel,
      });
      const attempt = Object.freeze({
        attemptId: authority.retrievalAttemptId,
        provider: "alpaca",
        recordId: `acquisition-${this.#input.plan.requestIdentityHash}`,
        revisionId: `configuration-${this.#input.plan.acquisitionConfigurationHash}`,
        startedAtMs: trustedCaptureMs,
        request: Object.freeze({
          ...routeRequest,
          identityHash: this.#input.plan.requestIdentityHash,
        }),
      });
      const digest = createHash("sha256").update(snapshot).digest("hex");
      const observationId = deriveObservationId(
        validateRetrievalAttempt(attempt),
        digest,
        validateHttpResponseMetadata(this.#input.request.response),
      );
      const ownership = Object.freeze({
        policyId: ALPACA_RETENTION_POLICY_ID,
        providerLane: "alpaca" as const,
        providerId: this.#input.plan.route.providerId,
        datasetId: this.#input.plan.route.datasetId,
        feedId: this.#input.plan.route.feedId,
        endpointChannelId: this.#input.plan.route.endpointChannelId,
        ...this.#input.retention,
        trustedCaptureMs,
        expiresAtMs: retentionExpiryMs(ALPACA_PRIVATE_ARTIFACT_POLICY, trustedCaptureMs, null),
        artifactObservationId: observationId,
        artifactDigest: digest,
        artifactSizeBytes: snapshot.byteLength,
      });
      const prepared = Object.freeze({
        ownership,
        commit: async (): Promise<StoreArtifactResult> => {
          try {
            const result = await this.#store.store({
              attempt,
              response: this.#input.request.response,
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
      const runtimeIdentity = artifactCommitSinkRoots.get(this);
      preparedArtifactCommits.set(
        prepared,
        Object.freeze({
          prepared,
          ...(runtimeIdentity === undefined ? {} : { runtimeIdentity }),
          dispose(): void {
            snapshot.fill(0);
          },
        }),
      );
      return prepared;
    } catch (error) {
      snapshot.fill(0);
      throw error;
    }
  }

  async abort(): Promise<void> {
    artifactCommitAuthorities.delete(this);
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
  artifactCommitSinkRoots.set(sink, ownedDurableArtifactStoreRuntimeIdentity(store));
  artifactCommitStores.set(sink, store);
  Object.freeze(sink);
  return sink;
}

export function createTestAlpacaArtifactCommitSink<T>(
  sink: AlpacaArtifactCommitSink<T>,
): AlpacaArtifactCommitSink<T> {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-alpaca-artifact-sink-unavailable");
  }
  const facade: AlpacaArtifactCommitSink<T> = Object.freeze({
    write: sink.write.bind(sink),
    async prepareVerifiedCommit() {
      const source = await sink.prepareVerifiedCommit();
      const existingBinding = preparedArtifactCommits.get(source);
      const sourceBinding: PreparedArtifactCommitBinding<T> =
        existingBinding === undefined
          ? Object.freeze({ prepared: source, dispose(): void {} })
          : (existingBinding as PreparedArtifactCommitBinding<T>);
      preparedArtifactCommits.delete(source);
      const prepared = Object.freeze({
        ownership: source.ownership,
        commit: source.commit,
      });
      preparedArtifactCommits.set(
        prepared,
        Object.freeze({
          prepared,
          ...(sourceBinding.runtimeIdentity === undefined
            ? {}
            : { runtimeIdentity: sourceBinding.runtimeIdentity }),
          dispose: sourceBinding.dispose,
        }),
      );
      return prepared;
    },
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

function takePreparedAlpacaArtifactCommit<T>(
  value: AlpacaPreparedArtifactCommit<T>,
): PreparedArtifactCommitBinding<T> {
  const binding = preparedArtifactCommits.get(value as object) as
    | PreparedArtifactCommitBinding<T>
    | undefined;
  if (binding === undefined || isProxy(value as object)) {
    throw new TypeError("owned-alpaca-prepared-commit-required");
  }
  preparedArtifactCommits.delete(value as object);
  return binding;
}

function discardPreparedAlpacaArtifactCommit(value: AlpacaPreparedArtifactCommit<unknown>): void {
  const binding = preparedArtifactCommits.get(value as object);
  if (binding === undefined) return;
  preparedArtifactCommits.delete(value as object);
  binding.dispose();
}

export function consumePreparedAlpacaArtifactCommit<T>(
  value: AlpacaPreparedArtifactCommit<T>,
  expectedRuntimeIdentity?: object,
): PreparedArtifactCommitBinding<T> {
  const binding = takePreparedAlpacaArtifactCommit(value);
  if (
    expectedRuntimeIdentity !== undefined &&
    binding.runtimeIdentity !== expectedRuntimeIdentity
  ) {
    binding.dispose();
    throw new TypeError("retention-runtime-root-mismatch");
  }
  return binding;
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
    try {
      const digest = this.#hash.digest("hex");
      if (
        prepared.ownership.artifactDigest !== digest ||
        prepared.ownership.artifactSizeBytes !== this.#sizeBytes
      ) {
        throw new TypeError("alpaca-artifact-ownership-byte-mismatch");
      }
      const result = await this.#retention.commitArtifact(prepared);
      if (result !== null && typeof result === "object") {
        const commitSink = retentionSinkCommitSinks.get(this);
        const store =
          commitSink === undefined ? undefined : artifactCommitStores.get(commitSink as object);
        if (store !== undefined) {
          ownedCommittedPageResults.set(
            result as object,
            Object.freeze({ store, retention: this.#retention }),
          );
        }
      }
      return result;
    } catch (error) {
      discardPreparedAlpacaArtifactCommit(prepared);
      throw error;
    }
  }

  abort(): Promise<void> {
    const commitSink = retentionSinkCommitSinks.get(this);
    if (commitSink !== undefined) artifactCommitAuthorities.delete(commitSink as object);
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
  const sinkIdentity = artifactCommitSinkRoots.get(sink as object);
  if (
    P1_10_TEST_AUTHORITY === undefined &&
    (sinkIdentity === undefined ||
      sinkIdentity !== ownedArtifactRetentionControllerRuntimeIdentity(retention))
  ) {
    throw new TypeError("retention-runtime-root-mismatch");
  }
  const value = new RetentionOwnedAlpacaPageSink(
    sink,
    retention,
    RETENTION_SINK_CONSTRUCTION_AUTHORITY,
  );
  retentionOwnedSinks.add(value);
  retentionSinkCommitSinks.set(value, sink as AlpacaArtifactCommitSink<unknown>);
  Object.freeze(value);
  return value;
}

export function bindRetentionOwnedAlpacaPageSinkAttempt(
  sink: AlpacaVerifiedPageSink<unknown>,
  authority: AlpacaArtifactCommitAuthority,
): void {
  assertRetentionOwnedAlpacaPageSink(sink);
  const commitSink = retentionSinkCommitSinks.get(sink as object);
  if (commitSink === undefined) throw new TypeError("alpaca-retention-owned-sink-binding-missing");
  const binding = consumeOwnedAlpacaArtifactCommitAuthority(authority);
  if (artifactCommitSinkRoots.get(commitSink as object) === undefined) {
    if (P1_10_TEST_AUTHORITY === undefined) {
      throw new TypeError("owned-alpaca-artifact-commit-sink-required");
    }
    return;
  }
  if (artifactCommitAuthorities.has(commitSink as object)) {
    throw new TypeError("alpaca-artifact-commit-authority-already-bound");
  }
  artifactCommitAuthorities.set(commitSink as object, binding);
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

export function consumeOwnedAlpacaCommittedPageResult(
  value: object,
): Readonly<{ store: DurableArtifactStore; retention: ArtifactRetentionController }> {
  const binding = ownedCommittedPageResults.get(value);
  if (binding === undefined || isProxy(value)) {
    throw new TypeError("owned-alpaca-committed-page-result-required");
  }
  ownedCommittedPageResults.delete(value);
  return binding;
}

Object.freeze(DurableAlpacaArtifactCommitSink.prototype);
Object.freeze(RetentionOwnedAlpacaPageSink.prototype);
