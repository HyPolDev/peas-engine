import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import type {
  ArtifactObservation,
  ArtifactStore,
  RetrievalAttemptDraft,
  SafeHttpResponseMetadata,
  VerifiedArtifactRead,
} from "../src/artifacts/artifact-store.js";
import { RetentionEnforcedArtifactStore } from "../src/adapters/market-acquisition/retention/artifact-access.js";
import { DefaultArtifactRetentionController } from "../src/adapters/market-acquisition/retention/controller.js";
import { MemoryArtifactRetentionJournal } from "../src/adapters/market-acquisition/retention/memory-journal.js";
import { ALPACA_PRIVATE_ARTIFACT_POLICY } from "../src/adapters/market-acquisition/private-artifact-policy.js";
import { deriveObservationId } from "../src/artifacts/identity.js";
import { validateRetrievalAttempt } from "../src/artifacts/validation.js";
import { canonicalHash } from "../src/core/hash.js";
import type { JsonValue } from "../src/core/json.js";

export type RecordedFixtureSeedMember = Readonly<{
  role: string;
  path: string;
  artifactHash: string;
  sizeBytes: number;
  attempt: RetrievalAttemptDraft;
  response: SafeHttpResponseMetadata;
  retrievedAtMs: number;
}>;

export type FixtureStoreCounters = Readonly<{
  observationCalls: Map<string, number>;
  readCalls: Map<string, number>;
  streamStarts: Map<string, number>;
  streamSettles: Map<string, number>;
  streamCloses: Map<string, number>;
  streamedBytes: Map<string, number>;
}>;

export type FixtureStoreOptions = Readonly<{
  observation?: (
    observation: ArtifactObservation,
    seed: RecordedFixtureSeedMember,
  ) => ArtifactObservation | null;
  readError?: (seed: RecordedFixtureSeedMember) => Error | null;
  metadataSize?: (actualSize: number, seed: RecordedFixtureSeedMember) => number;
  stream?: (absolutePath: string, seed: RecordedFixtureSeedMember) => Readable;
  verifiedStream?: (
    instrumented: Readable,
    seed: RecordedFixtureSeedMember,
  ) => Readable | Promise<Readable>;
}>;

export function fixtureObservation(seed: RecordedFixtureSeedMember): ArtifactObservation {
  const attempt = validateRetrievalAttempt(seed.attempt);
  const observationWithoutHash = {
    observationId: deriveObservationId(attempt, seed.artifactHash, seed.response),
    attemptId: attempt.attemptId,
    artifactDigest: seed.artifactHash,
    provider: attempt.provider,
    recordId: attempt.recordId,
    revisionId: attempt.revisionId,
    retrievedAtMs: seed.retrievedAtMs,
    request: attempt.request,
    response: seed.response,
  };
  return {
    ...observationWithoutHash,
    observationHash: canonicalHash(
      "peas/artifact-observation/v1",
      observationWithoutHash as unknown as JsonValue,
    ),
  };
}

export function recordedFixtureArtifactStore(
  fixtureRoot: string,
  seeds: readonly RecordedFixtureSeedMember[],
  options: FixtureStoreOptions = {},
): Readonly<{
  store: RetentionEnforcedArtifactStore;
  unsafeStore: ArtifactStore;
  counters: FixtureStoreCounters;
}> {
  const observationCalls = new Map<string, number>();
  const readCalls = new Map<string, number>();
  const streamStarts = new Map<string, number>();
  const streamSettles = new Map<string, number>();
  const streamCloses = new Map<string, number>();
  const streamedBytes = new Map<string, number>();
  const byObservationId = new Map(
    seeds.map((seed) => {
      const observation = fixtureObservation(seed);
      return [observation.observationId, { seed, observation }] as const;
    }),
  );
  const byDigest = new Map(seeds.map((seed) => [seed.artifactHash, seed] as const));

  const store: ArtifactStore = {
    async getObservation(id) {
      observationCalls.set(id, (observationCalls.get(id) ?? 0) + 1);
      const found = byObservationId.get(id);
      if (found === undefined) return undefined;
      const selected =
        options.observation === undefined
          ? found.observation
          : options.observation(found.observation, found.seed);
      return selected === null ? undefined : selected;
    },
    async read(digest): Promise<VerifiedArtifactRead> {
      readCalls.set(digest, (readCalls.get(digest) ?? 0) + 1);
      const seed = byDigest.get(digest);
      if (seed === undefined) throw new Error("missing fixture artifact");
      const readError = options.readError?.(seed);
      if (readError !== undefined && readError !== null) throw readError;
      const absolutePath = path.resolve(fixtureRoot, ...seed.path.split("/"));
      const relative = path.relative(path.resolve(fixtureRoot), absolutePath);
      if (
        relative === "" ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error("fixture seed escaped its root");
      }
      const actual = await stat(absolutePath);
      const instrumented = Readable.from(
        (async function* instrumentedStream() {
          streamStarts.set(digest, (streamStarts.get(digest) ?? 0) + 1);
          const source = options.stream?.(absolutePath, seed) ?? createReadStream(absolutePath);
          try {
            for await (const chunk of source) {
              const length = chunk instanceof Uint8Array ? chunk.byteLength : 0;
              streamedBytes.set(digest, (streamedBytes.get(digest) ?? 0) + length);
              yield chunk;
            }
          } finally {
            source.destroy();
            streamSettles.set(digest, (streamSettles.get(digest) ?? 0) + 1);
          }
        })(),
      );
      const selectedStream = options.verifiedStream?.(instrumented, seed);
      const stream = selectedStream === undefined ? instrumented : await selectedStream;
      stream.once("close", () => {
        streamCloses.set(digest, (streamCloses.get(digest) ?? 0) + 1);
      });
      return {
        artifact: {
          digest,
          algorithm: "sha256",
          sizeBytes: options.metadataSize?.(actual.size, seed) ?? actual.size,
          committedAtMs: seed.retrievedAtMs,
          provenance: "retrieval",
        },
        stream,
      };
    },
    async stat() {
      throw new Error("fixture loader must not call stat");
    },
    async store() {
      throw new Error("fixture store is read-only");
    },
    async getAttempt() {
      throw new Error("fixture loader must not look up attempts");
    },
    async readObservations() {
      throw new Error("fixture loader must not scan observations");
    },
    async reconcile() {
      throw new Error("fixture store does not reconcile");
    },
  };
  const retention = new DefaultArtifactRetentionController({
    journal: new MemoryArtifactRetentionJournal(),
    artifacts: {
      async settleActiveReadersAndWriters() {
        return true;
      },
      async eraseDigestCopies(artifactDigest) {
        return {
          artifactDigest,
          erasedCopies: { content: 0, staging: 0, snapshot: 0, quarantine: 0 },
          alreadyAbsent: true,
        };
      },
      async verifyDigestCopiesAbsent() {
        return true;
      },
    },
    nowMs: () => 0,
  });
  for (const seed of seeds) {
    const observation = fixtureObservation(seed);
    const authorityId = (prefix: string, member: string): string =>
      `${prefix}_${canonicalHash("peas/recorded-fixture-retention-authority/v1", { member })}`;
    retention.registerOwnership({
      policyId: ALPACA_PRIVATE_ARTIFACT_POLICY.policyId,
      providerLane: "alpaca",
      providerId: authorityId("mpv1", seed.attempt.provider),
      datasetId: authorityId("mds1", "dataset"),
      feedId: authorityId("mfd1", "feed"),
      endpointChannelId: authorityId("mec1", seed.role),
      artifactObservationId: authorityId("aob1", observation.observationId),
      artifactDigest: seed.artifactHash,
      artifactSizeBytes: seed.sizeBytes,
      derivedIds: [],
      trustedCaptureMs: seed.retrievedAtMs,
      expiresAtMs: seed.retrievedAtMs + ALPACA_PRIVATE_ARTIFACT_POLICY.maximumRetentionMs,
    });
  }
  return {
    store: new RetentionEnforcedArtifactStore(store, retention),
    unsafeStore: store,
    counters: {
      observationCalls,
      readCalls,
      streamStarts,
      streamSettles,
      streamCloses,
      streamedBytes,
    },
  };
}
