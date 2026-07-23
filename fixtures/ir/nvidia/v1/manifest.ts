import type {
  NvidiaFixtureManifestV2,
  NvidiaRetrievedMemberV2,
} from "../../../../src/adapters/ir/nvidia/recorded-nvidia-fixture.js";
import type {
  RetrievalAttemptDraft,
  SafeHttpResponseMetadata,
} from "../../../../src/artifacts/artifact-store.js";
import { sanitizeRequestIdentity } from "../../../../src/artifacts/identity.js";
import { canonicalHash } from "../../../../src/core/hash.js";

export type NvidiaFixtureSeedMemberV1 = Readonly<{
  role: NvidiaRetrievedMemberV2["role"];
  path: string;
  artifactHash: string;
  sizeBytes: number;
  attempt: RetrievalAttemptDraft;
  response: SafeHttpResponseMetadata;
  retrievedAtMs: number;
}>;

const FIXTURE_REQUEST = sanitizeRequestIdentity({
  method: "GET",
  origin: "https://fixture.invalid",
  path: "/recorded/nvidia",
  routeLabel: "recorded-nvidia-fixture",
});
const NVIDIA_FIXTURE_SEED_MEMBERS: NvidiaFixtureSeedMemberV1[] = [];
export const NVIDIA_FIXTURE_SEEDS: readonly NvidiaFixtureSeedMemberV1[] =
  NVIDIA_FIXTURE_SEED_MEMBERS;

function persistedId(kind: "attempt" | "provider" | "record" | "revision", value: string): string {
  const prefix = { attempt: "att1", provider: "prv1", record: "rec1", revision: "rev1" }[kind];
  return `${prefix}_${canonicalHash(`peas/artifact-${kind}-identifier/v1`, { value })}`;
}

function retrievedMember(input: {
  role: NvidiaRetrievedMemberV2["role"];
  path: string;
  artifactHash: string;
  sizeBytes: number;
  retrievedAtMs: number;
  mediaType: string;
}): NvidiaRetrievedMemberV2 {
  const attempt: RetrievalAttemptDraft = {
    attemptId: `nvidia-${input.role === "ir.rss-feed" ? "rss" : "html"}`,
    provider: "nvidia-ir",
    recordId: "fixture-nvidia-rss-baseline",
    revisionId: "v1",
    startedAtMs: input.retrievedAtMs - 1_000,
    request: FIXTURE_REQUEST,
  };
  const response: SafeHttpResponseMetadata = {
    statusCode: 200,
    etag: null,
    lastModified: null,
    mediaType: input.mediaType,
    contentEncoding: null,
    declaredContentLength: input.sizeBytes,
    transportDecoded: true,
  };
  const selectedObservationId = canonicalHash("peas/artifact-observation-id/v1", {
    attemptId: persistedId("attempt", attempt.attemptId),
    artifactDigest: input.artifactHash,
    response,
  });
  NVIDIA_FIXTURE_SEED_MEMBERS.push({
    role: input.role,
    path: input.path,
    artifactHash: input.artifactHash,
    sizeBytes: input.sizeBytes,
    attempt,
    response,
    retrievedAtMs: input.retrievedAtMs,
  });
  return {
    kind: "retrieved",
    role: input.role,
    artifactHash: input.artifactHash,
    sizeBytes: input.sizeBytes,
    selectedObservationId,
  };
}

/** Full, closed, original-synthetic evidence manifest for the accepted baseline recording. */
export const NVIDIA_BASELINE_MANIFEST: NvidiaFixtureManifestV2 = {
  schemaVersion: 2,
  caseId: "nvidia-rss-baseline",
  provider: "nvidia-ir",
  source: "peas-recorded:nvidia-newsroom-press-release-synthetic-v1",
  acquisitionVariant: "rss",
  asOfMs: 1_905_079_000_000,
  selector: {
    selectionKey: "https://nvidianews.nvidia.com/news/synthetic-fiscal-2030-q1",
  },
  route: {
    classificationPolicy: "nvidia-financial-results-title-v1",
    issuerCik: "0001045810",
    symbol: "NVDA",
    mappingAuthority: "peas-static-nvidia-v1",
    mappingVersion: "1",
  },
  retrievedMembers: [
    retrievedMember({
      role: "ir.rss-feed",
      path: "bodies/baseline.rss",
      artifactHash: "8f75463aaba9e1f535c82cc65c4d14f10864d199d2c87decc19cfb085e9b6c30",
      sizeBytes: 853,
      retrievedAtMs: 1_905_078_900_000,
      mediaType: "application/rss+xml",
    }),
    retrievedMember({
      role: "ir.release-html",
      path: "bodies/baseline.html",
      artifactHash: "7f77b5831efd61966acb2c1f3053fc34c3fdfd4513e125d50021fc10f9ff1e3e",
      sizeBytes: 665,
      retrievedAtMs: 1_905_078_901_000,
      mediaType: "text/html",
    }),
  ],
  derivedProofs: [
    {
      kind: "derived-projection",
      role: "ir.rss-item",
      parentArtifactHash: "8f75463aaba9e1f535c82cc65c4d14f10864d199d2c87decc19cfb085e9b6c30",
      policy: "peas/nvidia-ir-rss-item-projection/v1",
      projectionHash: "830c21f42e0ed8424df4790fc2737d4b1008815e85e234449c7427eaf5664e18",
      projectionSizeBytes: 619,
    },
    {
      kind: "derived-projection",
      role: "ir.release-visible",
      parentArtifactHash: "7f77b5831efd61966acb2c1f3053fc34c3fdfd4513e125d50021fc10f9ff1e3e",
      policy: "peas/nvidia-ir-release-visible-projection/v1",
      projectionHash: "51ff18fd65d615441c6751118764bc08f3f7bea5805672d730bcfc94e3f77a20",
      projectionSizeBytes: 637,
    },
  ],
  expected: {
    status: "emitted",
    reasonCode: null,
    limitKind: null,
    recordId: "ir:nvidia:fa317a4fdc44cb854bd1511f56fec5974f8821ac1d8f245fd98fab1d0b8b16bf",
    revisionId: "sha256:dca4f6d6551026cbd5e5365cacebdfb17f9fd5fcc49666983f654876c460fedb",
    issuerCik: "0001045810",
    symbol: "NVDA",
    fiscalPeriod: "2030-Q1",
    sourceKind: "issuer_release",
    publishedAtMs: 1_905_078_600_000,
    timestampConfidence: "provider",
    originalTimestamp: "Wed, 15 May 2030 12:30:00 GMT",
    primaryArtifactHash: "7ad99b59754288b6d19de425d12cc45e4766ae0c77c310f18a5b79ec242f07ce",
    selectedProjectionHash: "7ad99b59754288b6d19de425d12cc45e4766ae0c77c310f18a5b79ec242f07ce",
    routeHash: "6ad14e26b2ddf0b38c3eaa19e1ed0294bfd5c67fd2bab7ca49806d63be9ae383",
    candidateHash: "b2fe60644ef502e6995d292735c503bdce4a5f867d837f7da7ea99d074869e71",
    eventDraftHash: "32c6a5a54cc0975a10c09258226adfa0994fe3a2e932f09c597da856f8637284",
  },
  provenance: {
    classification: "synthetic",
    note: "Minimal original PEAS test data; no copied provider headline, body, image, or media.",
    approvalReference: null,
  },
};

export const NVIDIA_FIXTURE_CASES: readonly NvidiaFixtureManifestV2[] = [NVIDIA_BASELINE_MANIFEST];
