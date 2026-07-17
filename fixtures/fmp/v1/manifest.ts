import type { FmpRecordedRouteV1, FmpSelectorV1 } from "../../../src/providers/fmp/contracts.js";

export type FmpFixtureCase = Readonly<{
  schemaVersion: 1;
  caseId: string;
  provider: "financial-modeling-prep";
  source: "peas-recorded:fmp-press-release-synthetic-v1";
  acquisitionVariant: "latest" | "search";
  asOfMs: number;
  selector: FmpSelectorV1;
  route: FmpRecordedRouteV1;
  retrievedMembers: readonly [
    Readonly<{
      kind: "retrieved";
      role: "fmp.collection-json";
      path: string;
      artifactHash: string;
      sizeBytes: number;
      selectedObservationId: string;
      observation: Readonly<{
        provider: "financial-modeling-prep";
        artifactDigest: string;
        retrievedAtMs: number;
        observationHash: string;
      }>;
    }>,
  ];
  derivedProofs: readonly Readonly<{
    kind: "derived-projection";
    role: "fmp.press-release-item";
    parentArtifactHash: string;
    policy: "peas-fmp-press-release-synthetic-v1";
    projectionHash: string;
    projectionSizeBytes: number;
  }>[];
  expected: Readonly<{
    status: "emitted" | "quarantined";
    reasonCode: string | null;
    recordId: string | null;
    revisionId: string | null;
    primaryArtifactHash: string | null;
    selectedProjectionHash: string | null;
    candidateHash: string | null;
    eventDraftHash: string | null;
    publishedAtMs: number | null;
    timestampConfidence: "provider" | "unknown" | null;
  }>;
  provenance: Readonly<{
    classification: "synthetic";
    note: string;
    approvalReference: null;
  }>;
}>;

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
    observationId: string;
    observationHash: string;
    selector: FmpSelectorV1;
    route: FmpRecordedRouteV1;
    projectionHash: string | null;
    projectionSizeBytes: number | null;
    expected: FmpFixtureCase["expected"];
  }>,
): FmpFixtureCase {
  return {
    schemaVersion: 1,
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
        path: input.path,
        artifactHash: input.artifactHash,
        sizeBytes: input.sizeBytes,
        selectedObservationId: input.observationId,
        observation: {
          provider: "financial-modeling-prep",
          artifactDigest: input.artifactHash,
          retrievedAtMs: 1_778_201_999_000,
          observationHash: input.observationHash,
        },
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
    observationId: "2a01215585cb422c0f32ad11b39ec51329f4bece5330af242b16cb6ebf53b027",
    observationHash: "10bc82851455f8bb5604d56846ac892d2f974844d1ea376f6c53183370dbddd0",
    selector: {
      recordId: SYNX_RECORD,
      revisionId: "sha256:cc43824b44239244fd88670707dd9bf633de17de257233ce4b508a0302c76372",
    },
    route: ROUTE_SYNX,
    projectionHash: "335c172a65a41a64bf9660993eb4e04070dde3039d10bffa3264d51752cf0209",
    projectionSizeBytes: 335,
    expected: {
      status: "emitted",
      reasonCode: null,
      recordId: SYNX_RECORD,
      revisionId: "sha256:cc43824b44239244fd88670707dd9bf633de17de257233ce4b508a0302c76372",
      primaryArtifactHash: "6440ac3e4e0cff9079ce648e6105bfa7e3438f2223da43694eb0d45b647934b9",
      selectedProjectionHash: "335c172a65a41a64bf9660993eb4e04070dde3039d10bffa3264d51752cf0209",
      candidateHash: "668f3a79127061ff229d942e0ac0410fdca9223cfd442775951a3079a8581396",
      eventDraftHash: "57a9ed34e897517132c77873bb2f03bcc8b2a5116cc554fffe6426a4e059056d",
      publishedAtMs: 1_778_171_400_000,
      timestampConfidence: "provider",
    },
  }),
  fixture({
    caseId: "search-explicit-time",
    acquisitionVariant: "search",
    path: "bodies/search.json",
    artifactHash: "5bf78d0dc66edb370645e9c4bb37974aaa52752ee6066e05b4c0004865602fe7",
    sizeBytes: 428,
    observationId: "afa238bc2286d1e43996cd6b22ba8f4815b3584da8a6ba2a888a3230fb07f70f",
    observationHash: "19e00c9f1b6762d28ee1627bb33af569f5c2a3d4b935e8b93d39c1c18817b352",
    selector: {
      recordId: SYNX_RECORD,
      revisionId: "sha256:50500f066f6bb70372ac5fbde3695025bc49d72cde0614f7fe08e9da49d6c6c0",
    },
    route: ROUTE_SYNX,
    projectionHash: "335c172a65a41a64bf9660993eb4e04070dde3039d10bffa3264d51752cf0209",
    projectionSizeBytes: 335,
    expected: {
      status: "emitted",
      reasonCode: null,
      recordId: SYNX_RECORD,
      revisionId: "sha256:50500f066f6bb70372ac5fbde3695025bc49d72cde0614f7fe08e9da49d6c6c0",
      primaryArtifactHash: "5bf78d0dc66edb370645e9c4bb37974aaa52752ee6066e05b4c0004865602fe7",
      selectedProjectionHash: "335c172a65a41a64bf9660993eb4e04070dde3039d10bffa3264d51752cf0209",
      candidateHash: "d3003387d75915f3275cde071fe03c2a0de307b5e7a57e64c4589a0e4412fdf6",
      eventDraftHash: "eab598bd5b5bb97c1cf24191e532996a48803db5bead0e3afa8e09d88c71ec61",
      publishedAtMs: 1_778_171_400_000,
      timestampConfidence: "provider",
    },
  }),
  fixture({
    caseId: "duplicate-identical-item",
    acquisitionVariant: "latest",
    path: "bodies/duplicate.json",
    artifactHash: "b56824d52e46429030e38e5dce9fc75da7ef8904d93f59c6be41db5fe2c6a4c2",
    sizeBytes: 853,
    observationId: "5364239ce6ab4a72b36e896cf8a2c7e03146ce4fee2a79ea8cea59cf3ea9dc36",
    observationHash: "e531185c16fb0e2eeb435e11cd6b9a2bc3172373b60511d2158853c32f6ae8c8",
    selector: {
      recordId: SYNX_RECORD,
      revisionId: "sha256:c059c276b680a7209b383430ea755845dcac1f199923d63c0a7605bcaa2c6896",
    },
    route: ROUTE_SYNX,
    projectionHash: "335c172a65a41a64bf9660993eb4e04070dde3039d10bffa3264d51752cf0209",
    projectionSizeBytes: 335,
    expected: {
      status: "emitted",
      reasonCode: null,
      recordId: SYNX_RECORD,
      revisionId: "sha256:c059c276b680a7209b383430ea755845dcac1f199923d63c0a7605bcaa2c6896",
      primaryArtifactHash: "b56824d52e46429030e38e5dce9fc75da7ef8904d93f59c6be41db5fe2c6a4c2",
      selectedProjectionHash: "335c172a65a41a64bf9660993eb4e04070dde3039d10bffa3264d51752cf0209",
      candidateHash: "d88fb1c1e96e494c25f44e27b8f986a25a7eaf1efbe7999715a63c0451194b35",
      eventDraftHash: "79ca6bfc1b6087bb07cd068236c21e685491b8b7ceda1dc773a7b9c66c7a50b2",
      publishedAtMs: 1_778_171_400_000,
      timestampConfidence: "provider",
    },
  }),
  fixture({
    caseId: "byte-different-correction",
    acquisitionVariant: "search",
    path: "bodies/correction.json",
    artifactHash: "a7d4aaf59d17ff03b0d22295ced5ca1eb50b95e4f4e947f7edb032ee44530099",
    sizeBytes: 429,
    observationId: "6f85eee5eb9e054e18520d508737bed0ddb3fb7740b7aa0836bc8ce8dd94ef23",
    observationHash: "7133d5c92b53d47b1e6ff767141ac0447e07504c7fc409069b0872547f61bf01",
    selector: {
      recordId: SYNX_RECORD,
      revisionId: "sha256:b98df8d95bdd04bc098af311dad3601e23b3c56025531f127fa5983357a9554f",
    },
    route: ROUTE_SYNX,
    projectionHash: "97aa5347fdb8fd61580a8703bdef7296e2fad25c9a840a8c26c2c74b919b77e1",
    projectionSizeBytes: 336,
    expected: {
      status: "emitted",
      reasonCode: null,
      recordId: SYNX_RECORD,
      revisionId: "sha256:b98df8d95bdd04bc098af311dad3601e23b3c56025531f127fa5983357a9554f",
      primaryArtifactHash: "a7d4aaf59d17ff03b0d22295ced5ca1eb50b95e4f4e947f7edb032ee44530099",
      selectedProjectionHash: "97aa5347fdb8fd61580a8703bdef7296e2fad25c9a840a8c26c2c74b919b77e1",
      candidateHash: "0cff92f834f831f0febe7272684ec6024245d91a9cb174ab4a80f5e0f27d81d7",
      eventDraftHash: "73c2b5cb89642f1acbf9343cac9b2fb838a445a4a29b113422b630353ad55c24",
      publishedAtMs: 1_778_171_400_000,
      timestampConfidence: "provider",
    },
  }),
  fixture({
    caseId: "missing-provider-time",
    acquisitionVariant: "latest",
    path: "bodies/missing-time.json",
    artifactHash: "10d10235ed20a089b0f64bc9ecb799a9de79fa3ad4ec6c30bc444433ff8f1daf",
    sizeBytes: 322,
    observationId: "4d75d9a06d5425daca4977b9e68a3632ad35eca1bdea17dcd03013e6994c50ce",
    observationHash: "f8e3402c382457d17729644d1861bef62bf4488e0f41f38e1f6be47bd4fcd853",
    selector: {
      recordId:
        "fmp-recorded-synthetic:726b3c842790ac7208d5a4aa968e1b19eb63b2d3e43d572e55ca3dc3457957a9",
      revisionId: "sha256:826f9e643387a529972364930ba252ee1f4024e195292a87f095506a973cbca4",
    },
    route: ROUTE_NULLT,
    projectionHash: "9d317a8d70f31156e19e2825c2184224cfc3759f11f9aa0196da8839b49bca9e",
    projectionSizeBytes: 272,
    expected: {
      status: "emitted",
      reasonCode: null,
      recordId:
        "fmp-recorded-synthetic:726b3c842790ac7208d5a4aa968e1b19eb63b2d3e43d572e55ca3dc3457957a9",
      revisionId: "sha256:826f9e643387a529972364930ba252ee1f4024e195292a87f095506a973cbca4",
      primaryArtifactHash: "10d10235ed20a089b0f64bc9ecb799a9de79fa3ad4ec6c30bc444433ff8f1daf",
      selectedProjectionHash: "9d317a8d70f31156e19e2825c2184224cfc3759f11f9aa0196da8839b49bca9e",
      candidateHash: "54f039b81756b446b7c0fd0510af06b1205c8df2893ab52ffa623327f493a7eb",
      eventDraftHash: "9d23f4e97eef0f443a0bf1422a444fe8372e3f1184f6ed07f960a63933e0ce57",
      publishedAtMs: null,
      timestampConfidence: "unknown",
    },
  }),
  fixture({
    caseId: "malformed-json",
    acquisitionVariant: "latest",
    path: "bodies/malformed.json",
    artifactHash: "1e7d13a7087d52764e81fbd3a19ddc4465e4f36ff835aa26c292f26f4d296b97",
    sizeBytes: 256,
    observationId: "aa3f49ff434871e3cc27d74941a24b84f342d9cc41cf6e53da634650351d9307",
    observationHash: "9c7c6bc8862e861f025b165e1d484fa31f0dde7d617d2bbc7d39238ae095517b",
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
      recordId: null,
      revisionId: null,
      primaryArtifactHash: "1e7d13a7087d52764e81fbd3a19ddc4465e4f36ff835aa26c292f26f4d296b97",
      selectedProjectionHash: null,
      candidateHash: null,
      eventDraftHash: null,
      publishedAtMs: null,
      timestampConfidence: null,
    },
  }),
];

export const FMP_FIXTURE_MANIFEST = {
  version: "recorded-fmp-fixture-contract-v1",
  cases: FMP_FIXTURE_CASES,
  provenance: "synthetic-only",
  liveTransport: false,
} as const;
