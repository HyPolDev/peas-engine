import type { FmpRecordedRouteV1, FmpSelectorV1 } from "../../../src/providers/fmp/contracts.js";
import type { RecordedFmpFixtureManifestV2 } from "../../../src/adapters/fmp/recorded-fmp-fixture.js";
import type {
  RetrievalAttemptDraft,
  SafeHttpResponseMetadata,
  SanitizedRequestIdentity,
} from "../../../src/artifacts/artifact-store.js";
import { sanitizeRequestIdentity } from "../../../src/artifacts/identity.js";
import { canonicalHash } from "../../../src/core/hash.js";

export type FmpFixtureCase = RecordedFmpFixtureManifestV2;
export type FmpFixtureSeedMemberV1 = Readonly<{
  role: "fmp.collection-json";
  path: string;
  artifactHash: string;
  sizeBytes: number;
  attempt: RetrievalAttemptDraft;
  response: SafeHttpResponseMetadata;
  retrievedAtMs: number;
}>;

const FMP_FIXTURE_SEED_MAP = new Map<string, readonly [FmpFixtureSeedMemberV1]>();
export const FMP_FIXTURE_SEEDS: ReadonlyMap<string, readonly [FmpFixtureSeedMemberV1]> =
  FMP_FIXTURE_SEED_MAP;

const FIXTURE_REQUEST: SanitizedRequestIdentity = sanitizeRequestIdentity({
  method: "GET",
  origin: "https://fixture.invalid",
  path: "/recorded/fmp",
  routeLabel: "recorded-fmp-fixture",
});

function persistedId(kind: "attempt" | "provider" | "record" | "revision", value: string): string {
  const prefix = { attempt: "att1", provider: "prv1", record: "rec1", revision: "rev1" }[kind];
  return `${prefix}_${canonicalHash(`peas/artifact-${kind}-identifier/v1`, { value })}`;
}

function selectedObservationId(
  attempt: RetrievalAttemptDraft,
  artifactHash: string,
  response: SafeHttpResponseMetadata,
): string {
  return canonicalHash("peas/artifact-observation-id/v1", {
    attemptId: persistedId("attempt", attempt.attemptId),
    artifactDigest: artifactHash,
    response,
  });
}

const ROUTE_SYNX = {
  classification: "earnings-release",
  issuerMapping: { issuerCik: "0000000001", symbol: "SYNX", fiscalPeriod: "2026-Q1" },
  mappingAuthority: "peas-synthetic-fixture",
  mappingVersion: "1",
} as const;
const ROUTE_NULLT = {
  classification: "earnings-release",
  issuerMapping: { issuerCik: "0000000002", symbol: "NULLT", fiscalPeriod: "2026-FY" },
  mappingAuthority: "peas-synthetic-fixture",
  mappingVersion: "1",
} as const;

const SYNX_RECORD =
  "fmp-recorded-synthetic:c08d87be4da7598dc42f3c2461a601162a0f007c4ba015a7e459002bb850055e";

function fixture(
  input: Readonly<{
    caseId: string;
    acquisitionVariant: "latest" | "search";
    path: string;
    artifactHash: string;
    sizeBytes: number;
    selector: FmpSelectorV1;
    route: FmpRecordedRouteV1;
    projectionHash: string | null;
    projectionSizeBytes: number | null;
    expected: FmpFixtureCase["expected"];
  }>,
): FmpFixtureCase {
  const attempt: RetrievalAttemptDraft = {
    attemptId: `fmp-${input.caseId}`,
    provider: "financial-modeling-prep",
    recordId: `fixture-${input.caseId}`,
    revisionId: "v1",
    startedAtMs: 1_778_201_998_000,
    request: FIXTURE_REQUEST,
  };
  const response: SafeHttpResponseMetadata = {
    statusCode: 200,
    etag: null,
    lastModified: null,
    mediaType: "application/json",
    contentEncoding: null,
    declaredContentLength: input.sizeBytes,
    transportDecoded: true,
  };
  const observationId = selectedObservationId(attempt, input.artifactHash, response);
  FMP_FIXTURE_SEED_MAP.set(input.caseId, [
    {
      role: "fmp.collection-json",
      path: input.path,
      artifactHash: input.artifactHash,
      sizeBytes: input.sizeBytes,
      attempt,
      response,
      retrievedAtMs: 1_778_201_999_000,
    },
  ]);
  return {
    schemaVersion: 2,
    caseId: input.caseId,
    provider: "financial-modeling-prep",
    source: "peas-recorded:fmp-press-release-synthetic-v1",
    acquisitionVariant: input.acquisitionVariant,
    asOfMs: 1_778_202_000_000,
    selector: input.selector,
    route: input.route,
    retrievedMembers: [
      {
        kind: "retrieved",
        role: "fmp.collection-json",
        artifactHash: input.artifactHash,
        sizeBytes: input.sizeBytes,
        selectedObservationId: observationId,
      },
    ],
    derivedProofs:
      input.projectionHash === null || input.projectionSizeBytes === null
        ? []
        : [
            {
              kind: "derived-projection",
              role: "fmp.press-release-item",
              parentArtifactHash: input.artifactHash,
              policy: "peas-fmp-press-release-synthetic-v1",
              projectionHash: input.projectionHash,
              projectionSizeBytes: input.projectionSizeBytes,
            },
          ],
    expected: input.expected,
    provenance: {
      classification: "synthetic",
      note: "Original fictional PEAS contract data; not copied from an FMP response.",
      approvalReference: null,
    },
  };
}

export const FMP_FIXTURE_CASES: readonly FmpFixtureCase[] = [
  fixture({
    caseId: "latest-explicit-time",
    acquisitionVariant: "latest",
    path: "bodies/latest.json",
    artifactHash: "6440ac3e4e0cff9079ce648e6105bfa7e3438f2223da43694eb0d45b647934b9",
    sizeBytes: 716,
    selector: {
      recordId: SYNX_RECORD,
      revisionId: "sha256:981b30ba0401e2e5b0514a3ed7d4b129f812463f87a0282f15e2fa753fa36b63",
    },
    route: ROUTE_SYNX,
    projectionHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
    projectionSizeBytes: 310,
    expected: {
      status: "emitted",
      reasonCode: null,
      limitKind: null,
      recordId: SYNX_RECORD,
      revisionId: "sha256:981b30ba0401e2e5b0514a3ed7d4b129f812463f87a0282f15e2fa753fa36b63",
      rawArtifactHash: "6440ac3e4e0cff9079ce648e6105bfa7e3438f2223da43694eb0d45b647934b9",
      primaryArtifactHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
      selectedProjectionHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
      routeHash: "c2a9057f396d45453222bb8c78a5b3d05af58d553a177bb8fdffc886b8274ed5",
      candidateHash: "e8f4a5dfdcc1b2854507543eafae9da10b006b921aee9caac16951825030f4fd",
      eventDraftHash: "5985f9744062a30b23c6baed8e9d84672ec50fae92d56a85101875c4f9764c41",
      publishedAtMs: 1_778_171_400_000,
      timestampConfidence: "provider",
      originalTimestamp: "2026-05-07T16:30:00Z",
    },
  }),
  fixture({
    caseId: "search-explicit-time",
    acquisitionVariant: "search",
    path: "bodies/search.json",
    artifactHash: "5bf78d0dc66edb370645e9c4bb37974aaa52752ee6066e05b4c0004865602fe7",
    sizeBytes: 428,
    selector: {
      recordId: SYNX_RECORD,
      revisionId: "sha256:981b30ba0401e2e5b0514a3ed7d4b129f812463f87a0282f15e2fa753fa36b63",
    },
    route: ROUTE_SYNX,
    projectionHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
    projectionSizeBytes: 310,
    expected: {
      status: "emitted",
      reasonCode: null,
      limitKind: null,
      recordId: SYNX_RECORD,
      revisionId: "sha256:981b30ba0401e2e5b0514a3ed7d4b129f812463f87a0282f15e2fa753fa36b63",
      rawArtifactHash: "5bf78d0dc66edb370645e9c4bb37974aaa52752ee6066e05b4c0004865602fe7",
      primaryArtifactHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
      selectedProjectionHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
      routeHash: "c2a9057f396d45453222bb8c78a5b3d05af58d553a177bb8fdffc886b8274ed5",
      candidateHash: "e8f4a5dfdcc1b2854507543eafae9da10b006b921aee9caac16951825030f4fd",
      eventDraftHash: "5985f9744062a30b23c6baed8e9d84672ec50fae92d56a85101875c4f9764c41",
      publishedAtMs: 1_778_171_400_000,
      timestampConfidence: "provider",
      originalTimestamp: "2026-05-07T16:30:00Z",
    },
  }),
  fixture({
    caseId: "duplicate-identical-item",
    acquisitionVariant: "latest",
    path: "bodies/duplicate.json",
    artifactHash: "b56824d52e46429030e38e5dce9fc75da7ef8904d93f59c6be41db5fe2c6a4c2",
    sizeBytes: 853,
    selector: {
      recordId: SYNX_RECORD,
      revisionId: "sha256:981b30ba0401e2e5b0514a3ed7d4b129f812463f87a0282f15e2fa753fa36b63",
    },
    route: ROUTE_SYNX,
    projectionHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
    projectionSizeBytes: 310,
    expected: {
      status: "emitted",
      reasonCode: null,
      limitKind: null,
      recordId: SYNX_RECORD,
      revisionId: "sha256:981b30ba0401e2e5b0514a3ed7d4b129f812463f87a0282f15e2fa753fa36b63",
      rawArtifactHash: "b56824d52e46429030e38e5dce9fc75da7ef8904d93f59c6be41db5fe2c6a4c2",
      primaryArtifactHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
      selectedProjectionHash: "0ffe1c006be7e781542d3fc01c37fcc01384a5ac8c78942b05144c9745819bf9",
      routeHash: "c2a9057f396d45453222bb8c78a5b3d05af58d553a177bb8fdffc886b8274ed5",
      candidateHash: "e8f4a5dfdcc1b2854507543eafae9da10b006b921aee9caac16951825030f4fd",
      eventDraftHash: "5985f9744062a30b23c6baed8e9d84672ec50fae92d56a85101875c4f9764c41",
      publishedAtMs: 1_778_171_400_000,
      timestampConfidence: "provider",
      originalTimestamp: "2026-05-07T16:30:00Z",
    },
  }),
  fixture({
    caseId: "byte-different-correction",
    acquisitionVariant: "search",
    path: "bodies/correction.json",
    artifactHash: "a7d4aaf59d17ff03b0d22295ced5ca1eb50b95e4f4e947f7edb032ee44530099",
    sizeBytes: 429,
    selector: {
      recordId: SYNX_RECORD,
      revisionId: "sha256:231e38273a287c32015ba41b7d1f005347c0f1af3a716c3a5cd1278c1e480601",
    },
    route: ROUTE_SYNX,
    projectionHash: "d1d6a6e2ca606bf0748608556c28c9dee445d3bb6fb8df240034d56c8105237f",
    projectionSizeBytes: 311,
    expected: {
      status: "emitted",
      reasonCode: null,
      limitKind: null,
      recordId: SYNX_RECORD,
      revisionId: "sha256:231e38273a287c32015ba41b7d1f005347c0f1af3a716c3a5cd1278c1e480601",
      rawArtifactHash: "a7d4aaf59d17ff03b0d22295ced5ca1eb50b95e4f4e947f7edb032ee44530099",
      primaryArtifactHash: "d1d6a6e2ca606bf0748608556c28c9dee445d3bb6fb8df240034d56c8105237f",
      selectedProjectionHash: "d1d6a6e2ca606bf0748608556c28c9dee445d3bb6fb8df240034d56c8105237f",
      routeHash: "c2a9057f396d45453222bb8c78a5b3d05af58d553a177bb8fdffc886b8274ed5",
      candidateHash: "633e74398735e77b3f46fc3df394395f246f4cdaa7c52c5f479dfcec811bdc6f",
      eventDraftHash: "78154bca8f7163d9329c37dddae2c1f3284cd8dbc62dd8373533de1eb7fe2784",
      publishedAtMs: 1_778_171_400_000,
      timestampConfidence: "provider",
      originalTimestamp: "2026-05-07T16:30:00Z",
    },
  }),
  fixture({
    caseId: "missing-provider-time",
    acquisitionVariant: "latest",
    path: "bodies/missing-time.json",
    artifactHash: "10d10235ed20a089b0f64bc9ecb799a9de79fa3ad4ec6c30bc444433ff8f1daf",
    sizeBytes: 322,
    selector: {
      recordId:
        "fmp-recorded-synthetic:726b3c842790ac7208d5a4aa968e1b19eb63b2d3e43d572e55ca3dc3457957a9",
      revisionId: "sha256:5fdff5c791550bc255e9d9cac7fa532862c8467a91611ddcaf326612a3cb686b",
    },
    route: ROUTE_NULLT,
    projectionHash: "4c35bb60709d090defc7a1a980679d324ab0d5a83c5eee1c99276f5d8c835bfa",
    projectionSizeBytes: 260,
    expected: {
      status: "emitted",
      reasonCode: null,
      limitKind: null,
      recordId:
        "fmp-recorded-synthetic:726b3c842790ac7208d5a4aa968e1b19eb63b2d3e43d572e55ca3dc3457957a9",
      revisionId: "sha256:5fdff5c791550bc255e9d9cac7fa532862c8467a91611ddcaf326612a3cb686b",
      rawArtifactHash: "10d10235ed20a089b0f64bc9ecb799a9de79fa3ad4ec6c30bc444433ff8f1daf",
      primaryArtifactHash: "4c35bb60709d090defc7a1a980679d324ab0d5a83c5eee1c99276f5d8c835bfa",
      selectedProjectionHash: "4c35bb60709d090defc7a1a980679d324ab0d5a83c5eee1c99276f5d8c835bfa",
      routeHash: "ed1bd3dad463f0803632e5849737ed5025fb18f1b9037cddfe859c97ce7921e8",
      candidateHash: "ac08ca3a00e2eb173663c8696b2834aab010768ba56a5d3fc7622e9f65361983",
      eventDraftHash: "b795ccab4cee10b53c6a06553d44ca015efd70abf74e07c40a4f2f84a73546c7",
      publishedAtMs: null,
      timestampConfidence: "unknown",
      originalTimestamp: null,
    },
  }),
  fixture({
    caseId: "malformed-json",
    acquisitionVariant: "latest",
    path: "bodies/malformed.json",
    artifactHash: "1e7d13a7087d52764e81fbd3a19ddc4465e4f36ff835aa26c292f26f4d296b97",
    sizeBytes: 256,
    selector: {
      recordId: `fmp-recorded-synthetic:${"0".repeat(64)}`,
      revisionId: `sha256:${"0".repeat(64)}`,
    },
    route: ROUTE_SYNX,
    projectionHash: null,
    projectionSizeBytes: null,
    expected: {
      status: "quarantined",
      reasonCode: "fmp.malformed-json",
      limitKind: null,
      recordId: null,
      revisionId: null,
      rawArtifactHash: "1e7d13a7087d52764e81fbd3a19ddc4465e4f36ff835aa26c292f26f4d296b97",
      primaryArtifactHash: null,
      selectedProjectionHash: null,
      routeHash: null,
      candidateHash: null,
      eventDraftHash: null,
      publishedAtMs: null,
      timestampConfidence: null,
      originalTimestamp: null,
    },
  }),
];

export const FMP_FIXTURE_MANIFEST = {
  version: "recorded-fmp-fixture-contract-v2",
  cases: FMP_FIXTURE_CASES,
  provenance: "synthetic-only",
  liveTransport: false,
} as const;
