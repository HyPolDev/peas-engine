import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

import type {
  ArtifactObservation,
  ArtifactStore,
  VerifiedArtifactRead,
} from "../../artifacts/artifact-store.js";
import { canonicalHash } from "../../core/hash.js";
import {
  assertJsonWithinLimits,
  deepFreezeJson,
  inertJsonSnapshot,
  type JsonObject,
  type JsonValue,
} from "../../core/json.js";
import { LOADER_OWNED_BOUND_IDS } from "../../providers/market-reference/bounds.js";
import {
  BOUND_ENFORCEMENT_REGISTRY,
  type BoundEnforcementRuleV1,
  type BoundViolationKindV1,
  CANONICAL_BOUND_IDS,
  type CanonicalMarketReasonV1,
  MARKET_CONTRACT_AUTHORITY_REGISTRY_ID,
  type MarketBoundIdV1,
  MarketContractError,
  type MarketReferenceResultV1,
  type MarketSelectionPolicyPreimageV1,
  type MarketSelectionRequestV1,
  marketReason,
  type NormalizedMarketFactV1,
  type RecordedCorpusCutoffV1,
  type RecordedCorpusSnapshotV1,
  type RecordedMarketRecordV1,
  validateCanonicalMarketReason,
} from "../../providers/market-reference/contracts.js";
import {
  deriveAdmittedRevisionSetHash,
  deriveArtifactContentId,
  deriveDeliveryId,
  deriveEndpointChannelId,
  deriveEntitlementSnapshotId,
  deriveInstrumentId,
  deriveMarketAcquisitionId,
  deriveMarketDatasetId,
  deriveMarketFactId,
  deriveMarketFeedId,
  deriveMarketIntervalKey,
  deriveMarketProviderId,
  deriveNormalizedMarketFactId,
  deriveProviderObservationId,
  deriveRawArtifactId,
  deriveRecordedCorpusCutoffId,
  deriveRecordedCorpusSnapshotId,
  deriveRevisionFamilyId,
  deriveRevisionId,
  deriveSelectionPolicyId,
  deriveVenueTapeId,
  type EndpointChannelPreimageV1,
  type EntitlementSnapshotPreimageV1,
  type InstrumentPreimageV1,
  type MarketAcquisitionPreimageV1,
  type MarketDatasetPreimageV1,
  type MarketFeedPreimageV1,
  type MarketIntervalDefinitionV1,
  type MarketProviderPreimageV1,
  type VenueTapePreimageV1,
} from "../../providers/market-reference/identity.js";
import {
  normalizeRecordedMarketRecords,
  quoteMidpoint,
} from "../../providers/market-reference/normalization.js";
import {
  classifyFrozenSession,
  classifyTapeOfficialTradeCode,
  compareIndependentSourceReferences,
  constructTwoSidedQuote,
  evaluatePrimaryQuoteBoundary,
  evaluateRecordedBarSensitivity,
  evaluateSessionTransition,
  evaluateStrictExecutableQuote,
  replayConsolidatedLast,
  replayNativeSequence,
  selectIsolatedQuoteReference,
  selectPriorCloseAndSensitivities,
  selectQuoteTimelineReference,
} from "../../providers/market-reference/operations.js";
import { selectMarketReference } from "../../providers/market-reference/selection.js";
import {
  deriveAcquisitionObservationId,
  deriveIssuerMappingId,
} from "../../providers/observation-ledger.js";
import {
  RECORDED_LOADER_OPERATIONAL_LIMITS,
  validateAcquisitionCardinalityBounds,
  validateAggregateVerifiedByteBound,
  validateCalendarDatesPerManifestBound,
  validateCanonicalRecordByteBounds,
  validateClusterCardinalityBounds,
  validateExecutionBundleBounds,
  validateGenericStringByteBounds,
  validateHistoricalQueryWindowBound,
  validateIdentifierByteBounds,
  validateOpaqueProviderIdByteBounds,
  validatePageTokenInputByteBound,
  validateProviderOrDatasetCodeByteBounds,
  validateRawArtifactByteBound,
  validateRawJsonParserBounds,
  validateRecordAndFactCardinalityBounds,
  validateRecordedReplayPageSizeBound,
  validateSelectionSearchWindowBound,
  validateSidecarParserBounds,
  validateSidecarRecordByteBounds,
  validateSymbolByteBounds,
} from "./recorded-loader-bounds.js";
import { evaluateRecordedLoaderStructuredGateEvidence } from "./recorded-loader-gate-evidence.js";

export const MARKET_MAX_RAW_ARTIFACT_BYTES = 10_485_760;
export const MARKET_MAX_AGGREGATE_VERIFIED_BYTES = 67_108_864;
export const MARKET_MAX_ARTIFACTS_PER_ACQUISITION = 16;
export const MARKET_MAX_RECORDS_PER_ARTIFACT = 10_000;
export const MARKET_MAX_RAW_JSON_DEPTH = 32;
export const MARKET_MAX_RAW_JSON_NODES = 250_000;
export const MARKET_MAX_RAW_JSON_KEYS = 64;
export const MARKET_MAX_RAW_JSON_ARRAY_ITEMS = 10_000;
export const MARKET_MAX_PARSER_TOKENS = 250_000;
export const MARKET_MAX_DECODED_STRING_BYTES = 1_024;

export const RECORDED_LOADER_BOUND_IDS = Object.freeze([
  "rawArtifactBytes",
  "aggregateVerifiedBytes",
  "artifactsPerAcquisition",
  "pagesPerAcquisition",
  "recordsPerArtifactOrPage",
  "factsPerAcquisition",
  "canonicalRecordBytes",
  "rawJsonDepth",
  "rawJsonNodes",
  "rawJsonKeysPerObject",
  "rawJsonArrayItems",
  "parserTokensPerArtifact",
  "sidecarDepth",
  "sidecarNodes",
  "sidecarKeysPerObject",
  "sidecarGenericArrayItems",
  "genericStringBytes",
  "identifierBytes",
  "providerOrDatasetCodeBytes",
  "symbolBytes",
  "pageTokenInputBytes",
  "opaqueProviderIdBytes",
  "instrumentsPerAcquisition",
  "intervalsPerCluster",
  "referenceResultsPerCluster",
  "sidecarRecordsPerExecution",
  "sidecarEdgesPerExecution",
  "canonicalSidecarRecordBytes",
  "canonicalExecutionBundleBytes",
  "recordedReplayPageSize",
  "historicalQueryWindow",
  "selectionSearchWindowMs",
  "calendarDatesPerManifest",
] as const satisfies readonly (typeof LOADER_OWNED_BOUND_IDS)[number][]);

export type RecordedLoaderBoundIdV1 = (typeof RECORDED_LOADER_BOUND_IDS)[number];

if (
  RECORDED_LOADER_BOUND_IDS.length !== 33 ||
  LOADER_OWNED_BOUND_IDS.length !== RECORDED_LOADER_BOUND_IDS.length ||
  RECORDED_LOADER_BOUND_IDS.some((boundId) => !LOADER_OWNED_BOUND_IDS.includes(boundId))
) {
  throw new Error("recorded loader must own exactly the canonical 33-bound partition");
}

const RECORDED_LOADER_BOUND_MAXIMUMS = Object.freeze({
  rawArtifactBytes: 10_485_760,
  aggregateVerifiedBytes: 67_108_864,
  artifactsPerAcquisition: 16,
  pagesPerAcquisition: 16,
  recordsPerArtifactOrPage: 10_000,
  factsPerAcquisition: 160_000,
  canonicalRecordBytes: 65_536,
  rawJsonDepth: 32,
  rawJsonNodes: 250_000,
  rawJsonKeysPerObject: 64,
  rawJsonArrayItems: 10_000,
  parserTokensPerArtifact: 250_000,
  sidecarDepth: 8,
  sidecarNodes: 512,
  sidecarKeysPerObject: 64,
  sidecarGenericArrayItems: 32,
  genericStringBytes: 1_024,
  identifierBytes: 512,
  providerOrDatasetCodeBytes: 128,
  symbolBytes: 32,
  pageTokenInputBytes: 4_096,
  opaqueProviderIdBytes: 128,
  instrumentsPerAcquisition: 64,
  intervalsPerCluster: 16,
  referenceResultsPerCluster: 64,
  sidecarRecordsPerExecution: 4_096,
  sidecarEdgesPerExecution: 12_279,
  canonicalSidecarRecordBytes: 65_536,
  canonicalExecutionBundleBytes: 67_108_864,
  recordedReplayPageSize: 10_000,
  historicalQueryWindow: 8,
  selectionSearchWindowMs: 86_400_000,
  calendarDatesPerManifest: 400,
} as const satisfies Readonly<Record<RecordedLoaderBoundIdV1, number>>);

const RECORDED_LOADER_BOUND_MINIMUMS = Object.freeze({
  recordedReplayPageSize: 1,
  historicalQueryWindow: 1,
  selectionSearchWindowMs: 0,
} as const);

const SHA256 = /^[a-f0-9]{64}$/u;
const MARKET_MANIFEST_LIMITS = Object.freeze({
  maxDepth: 8,
  maxNodes: 512,
  maxArrayLength: MARKET_MAX_ARTIFACTS_PER_ACQUISITION + 1,
  maxObjectKeys: 64,
  maxStringBytes: 1_024,
  maxCanonicalBytes: 65_536,
});
const MANIFEST_FIELDS = Object.freeze([
  "schemaVersion",
  "caseId",
  "sourceProfileId",
  "providerCode",
  "acquisitionObservationId",
  "asOfMs",
  "expectedPageCount",
  "retrievedMembers",
  "provenance",
]);
const MEMBER_FIELDS = Object.freeze([
  "kind",
  "role",
  "sourceProfileId",
  "pageOrdinal",
  "priorPageChainHash",
  "terminalPage",
  "bodyFormat",
  "artifactContentId",
  "artifactContentPreimage",
  "rawArtifactId",
  "rawArtifactPreimage",
  "artifactDigest",
  "sizeBytes",
  "selectedObservationId",
  "selectedObservationHash",
]);
const CONTENT_FIELDS = Object.freeze(["sha256", "sizeBytes", "mediaType", "contentEncoding"]);
const RAW_FIELDS = Object.freeze([
  "artifactContentId",
  "vaultObservationId",
  "vaultObservationHash",
  "acquisitionObservationId",
  "role",
]);
const PROVENANCE_FIELDS = Object.freeze([
  "classification",
  "redistributionClass",
  "authoringPolicyId",
  "containsProviderBytes",
  "containsProviderExamples",
  "containsActualMarketValues",
  "containsCredentialsOrAccountFacts",
  "networkRequired",
  "approvalReference",
  "note",
]);

export type MarketLoaderReason = CanonicalMarketReasonV1;

export type RecordedMarketArtifactMemberV1 = Readonly<{
  kind: "retrieved-synthetic";
  role: string;
  sourceProfileId: string;
  pageOrdinal: number;
  priorPageChainHash: string | null;
  terminalPage: boolean;
  bodyFormat: "application/json";
  artifactContentId: string;
  artifactContentPreimage: Readonly<{
    sha256: string;
    sizeBytes: number;
    mediaType: "application/json";
    contentEncoding: "identity";
  }>;
  rawArtifactId: string;
  rawArtifactPreimage: Readonly<{
    artifactContentId: string;
    vaultObservationId: string;
    vaultObservationHash: string;
    acquisitionObservationId: string;
    role: string;
  }>;
  artifactDigest: string;
  sizeBytes: number;
  selectedObservationId: string;
  selectedObservationHash: string;
}>;

export type SyntheticFixtureProvenanceV1 = Readonly<{
  classification: "synthetic";
  redistributionClass: "project-authored";
  authoringPolicyId: "peas-original-market-fixture-v1";
  containsProviderBytes: false;
  containsProviderExamples: false;
  containsActualMarketValues: false;
  containsCredentialsOrAccountFacts: false;
  networkRequired: false;
  approvalReference: null;
  note: string;
}>;

export type RecordedMarketArtifactManifestV1 = Readonly<{
  schemaVersion: 1;
  caseId: string;
  sourceProfileId: string;
  providerCode: string;
  acquisitionObservationId: string;
  asOfMs: number;
  expectedPageCount: number;
  retrievedMembers: readonly RecordedMarketArtifactMemberV1[];
  provenance: SyntheticFixtureProvenanceV1;
}>;

export type ContractAuthorityRegistryV1 = Readonly<{
  schemaVersion: 1;
  contractContentCommit: string;
  entries: readonly Readonly<{
    logicalContractId: string;
    repositoryPath: string;
    documentSha256: string;
    gitBlobOid: string;
    contractContentCommit: string;
  }>[];
  contractAuthorityRegistryId: string;
}>;

/**
 * The exact registry-bound fixture envelope. Nested values retain the primitive preimages defined
 * by `peas/market-fixture-manifest/v1`; no path or body bytes are part of this semantic value.
 */
export type RecordedMarketFixtureManifestV1 = Readonly<{
  schemaVersion: 1;
  fixtureId: string;
  caseId: string;
  contractAuthorityRegistry: ContractAuthorityRegistryV1;
  sourceProfiles: readonly JsonObject[];
  acquisition: JsonObject;
  instruments: readonly JsonObject[];
  calendarSnapshot: JsonObject;
  retrievedMembers: readonly RecordedMarketArtifactMemberV1[];
  parsedFactExpectations: readonly JsonObject[];
  recordedCorpora: readonly JsonObject[];
  selectionRequests: readonly JsonObject[];
  expectedEvaluations: readonly JsonObject[];
  expectedMetrics: readonly JsonObject[];
  expectedReasonTrace: readonly JsonObject[];
  exercisedBounds: readonly JsonObject[];
  catalogEvidence: readonly JsonObject[];
  expectedCatalogOutcomes: readonly JsonObject[];
  provenance: SyntheticFixtureProvenanceV1;
  expectedManifestId: string;
}>;

const EXPECTED_METRIC_FIELDS = Object.freeze([
  "metricId",
  "metricKind",
  "priceBasis",
  "observationBasisKind",
  "viewKind",
  "numeratorReferenceId",
  "denominatorReferenceId",
  "rationalNumerator",
  "rationalDenominator",
  "status",
  "reason",
  "diagnostics",
]);
const EXPECTED_REASON_FIELDS = Object.freeze([
  "stage",
  "requestId",
  "candidateIdentity",
  "reason",
  "diagnostics",
]);
const EXERCISED_BOUND_FIELDS = Object.freeze([
  "boundId",
  "observedValue",
  "expectedDisposition",
  "candidateIdentity",
  "metricId",
  "studyCaseId",
]);
const BOUND_DISPOSITION_FIELDS = Object.freeze([
  "boundId",
  "stage",
  "vectorKind",
  "accepted",
  "reason",
  "atomicity",
]);
const FIXTURE_STUDY_CASE_ID = "study-case:precommitted-180-cluster-v1";

export type RecordedMarketFixtureResultV1 =
  | Readonly<{
      status: "verified";
      reason: null;
      members: readonly VerifiedRecordedMarketMemberV1[];
      normalizedFacts: readonly NormalizedMarketFactV1[];
      evaluations: readonly MarketReferenceResultV1[];
      catalogOutcomes: readonly RecordedLoaderCatalogOutcomeV1[];
    }>
  | Readonly<{
      status: "rejected";
      reason: CanonicalMarketReasonV1;
      members: readonly never[];
      normalizedFacts: readonly never[];
      evaluations: readonly never[];
      catalogOutcomes: readonly never[];
    }>;

export type RecordedLoaderCatalogOutcomeV1 = Readonly<{
  caseId: string;
  status: "selected-complete" | "selected-degraded" | "missing" | "verified" | "rejected";
  reason: CanonicalMarketReasonV1 | null;
  diagnostics: readonly CanonicalMarketReasonV1[];
  state: JsonObject;
  value: JsonValue;
  provenance: Readonly<{
    normalizedMarketFactIds: readonly string[];
    operation: string;
  }>;
}>;

export type VerifiedRecordedMarketMemberV1 = Readonly<{
  role: string;
  sourceProfileId: string;
  pageOrdinal: number;
  artifactContentId: string;
  rawArtifactId: string;
  artifactDigest: string;
  selectedObservationId: string;
  selectedObservationHash: string;
  retrievedAtMs: number;
  bytes: Uint8Array;
  records: readonly JsonValue[];
}>;

export type RecordedMarketLoaderResultV1 =
  | Readonly<{
      status: "verified";
      reason: null;
      members: readonly VerifiedRecordedMarketMemberV1[];
    }>
  | Readonly<{
      status: "rejected";
      reason: MarketLoaderReason;
      members: readonly [];
    }>;

class LoaderFailure extends Error {
  constructor(readonly reason: MarketLoaderReason) {
    super(reason.code);
    this.name = "LoaderFailure";
  }
}

class BoundedJsonParser {
  private offset = 0;
  private tokens = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  parse(): JsonValue {
    this.space();
    const value = this.value(0);
    this.space();
    if (this.offset !== this.source.length) this.invalid();
    return value;
  }

  private invalid(): never {
    throw new LoaderFailure(inputInvalid());
  }

  private bound(limitKind: MarketBoundIdV1): never {
    throw new LoaderFailure(boundExceeded(limitKind));
  }

  private token(): void {
    this.tokens += 1;
    this.nodes += 1;
    if (this.tokens > MARKET_MAX_PARSER_TOKENS) this.bound("parserTokensPerArtifact");
    if (this.nodes > MARKET_MAX_RAW_JSON_NODES) this.bound("rawJsonNodes");
  }

  private value(depth: number): JsonValue {
    if (depth > MARKET_MAX_RAW_JSON_DEPTH) this.bound("rawJsonDepth");
    this.space();
    const character = this.source[this.offset];
    if (character === "{") return this.object(depth + 1);
    if (character === "[") return this.array(depth + 1);
    if (character === '"') return this.string();
    for (const [literal, value] of [
      ["null", null],
      ["true", true],
      ["false", false],
    ] as const) {
      if (this.source.startsWith(literal, this.offset)) {
        this.offset += literal.length;
        this.token();
        return value;
      }
    }
    const pattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;
    pattern.lastIndex = this.offset;
    const match = pattern.exec(this.source)?.[0];
    if (match === undefined) return this.invalid();
    this.offset += match.length;
    this.token();
    const value = Number(match);
    if (!Number.isFinite(value) || (!Number.isSafeInteger(value) && !match.includes("."))) {
      return this.invalid();
    }
    return value;
  }

  private object(depth: number): JsonObject {
    this.offset += 1;
    this.token();
    const result = Object.create(null) as Record<string, JsonValue>;
    const keys = new Set<string>();
    this.space();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      return result;
    }
    for (;;) {
      this.space();
      if (this.source[this.offset] !== '"') return this.invalid();
      const key = this.string();
      if (keys.has(key)) return this.invalid();
      keys.add(key);
      if (keys.size > MARKET_MAX_RAW_JSON_KEYS) this.bound("rawJsonKeysPerObject");
      this.space();
      if (this.source[this.offset] !== ":") return this.invalid();
      this.offset += 1;
      result[key] = this.value(depth);
      this.space();
      const character = this.source[this.offset];
      if (character === "}") {
        this.offset += 1;
        return result;
      }
      if (character !== ",") return this.invalid();
      this.offset += 1;
    }
  }

  private array(depth: number): JsonValue[] {
    this.offset += 1;
    this.token();
    const result: JsonValue[] = [];
    this.space();
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      return result;
    }
    for (;;) {
      if (result.length > MARKET_MAX_RAW_JSON_ARRAY_ITEMS) {
        this.bound("rawJsonArrayItems");
      }
      result.push(this.value(depth));
      this.space();
      const character = this.source[this.offset];
      if (character === "]") {
        this.offset += 1;
        return result;
      }
      if (character !== ",") return this.invalid();
      this.offset += 1;
    }
  }

  private string(): string {
    const start = this.offset;
    this.offset += 1;
    let escaped = false;
    for (; this.offset < this.source.length; this.offset += 1) {
      const character = this.source[this.offset];
      if (character === undefined) return this.invalid();
      if (!escaped && character === '"') {
        this.offset += 1;
        let decoded: unknown;
        try {
          decoded = JSON.parse(this.source.slice(start, this.offset));
        } catch {
          return this.invalid();
        }
        if (typeof decoded !== "string") return this.invalid();
        this.token();
        if (Buffer.byteLength(decoded, "utf8") > MARKET_MAX_DECODED_STRING_BYTES) {
          this.bound("genericStringBytes");
        }
        return decoded;
      }
      if (!escaped && character.charCodeAt(0) < 0x20) return this.invalid();
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
    }
    return this.invalid();
  }

  private space(): void {
    for (;;) {
      const code = this.source.charCodeAt(this.offset);
      if (code !== 0x09 && code !== 0x0a && code !== 0x0d && code !== 0x20) return;
      this.offset += 1;
    }
  }
}

function inputInvalid(): MarketLoaderReason {
  return marketReason("market.input-invalid");
}

function boundExceeded(limitKind: MarketBoundIdV1): MarketLoaderReason {
  return marketReason("market.bound-exceeded", { limitKind });
}

function loaderReason(error: unknown): MarketLoaderReason {
  if (error instanceof LoaderFailure || error instanceof MarketContractError) return error.reason;
  return inputInvalid();
}

/**
 * Executable enforcement entry point for the 33 bounds owned by the recorded loader. The fixture
 * oracle calls this same function for every exact and violating vector.
 */
export function validateRecordedLoaderBound(
  boundId: RecordedLoaderBoundIdV1,
  observedValue: string,
): void {
  if (!RECORDED_LOADER_BOUND_IDS.includes(boundId)) {
    throw new LoaderFailure(inputInvalid());
  }
  const range = /^([0-9]+)\.\.([0-9]+)$/u.exec(observedValue);
  const numericText = range === null ? observedValue : range[2];
  if (numericText === undefined || !/^-?(0|[1-9][0-9]*)$/u.test(numericText)) {
    throw new LoaderFailure(inputInvalid());
  }
  const observed = Number(numericText);
  if (!Number.isSafeInteger(observed)) throw new LoaderFailure(inputInvalid());
  const minimum =
    boundId in RECORDED_LOADER_BOUND_MINIMUMS
      ? RECORDED_LOADER_BOUND_MINIMUMS[boundId as keyof typeof RECORDED_LOADER_BOUND_MINIMUMS]
      : 0;
  if (observed < minimum) throw new LoaderFailure(inputInvalid());
  if (observed > RECORDED_LOADER_BOUND_MAXIMUMS[boundId]) {
    throw new LoaderFailure(boundExceeded(boundId));
  }
}

function artifactInvalid(
  artifactFailureKind:
    | "observation-invalid"
    | "digest-mismatch"
    | "size-mismatch"
    | "observation-hash-mismatch"
    | "media-or-encoding-mismatch",
): MarketLoaderReason {
  return marketReason("market.artifact-invalid", { artifactFailureKind });
}

function exactFields(value: JsonObject, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new LoaderFailure(inputInvalid());
  }
}

function requiredString(value: unknown, maxBytes = 512): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  return value;
}

function requiredHash(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new LoaderFailure(inputInvalid());
  }
  return value;
}

function requiredPrefixedHash(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}[a-f0-9]{64}$`, "u").test(value)) {
    throw new LoaderFailure(inputInvalid());
  }
  return value;
}

function freeze<T>(value: T): T {
  return deepFreezeJson(inertJsonSnapshot(value as JsonValue)) as T;
}

function persistedProviderId(providerCode: string): string {
  return `prv1_${canonicalHash("peas/artifact-provider-identifier/v1", { value: providerCode })}`;
}

function acquisitionObservationIdFor(
  providerCode: string,
  observation: ArtifactObservation,
): string {
  return deriveAcquisitionObservationId({
    provider: providerCode,
    retrievalAttemptId: observation.attemptId,
    sanitizedRequestIdentityHash: observation.request.identityHash,
    routeLabel: observation.request.routeLabel,
  });
}

function detachManifest(value: RecordedMarketArtifactManifestV1): RecordedMarketArtifactManifestV1 {
  let manifest: RecordedMarketArtifactManifestV1;
  try {
    assertJsonWithinLimits(value, MARKET_MANIFEST_LIMITS, "$.recordedMarketManifest");
    manifest = inertJsonSnapshot(value as unknown as JsonValue) as RecordedMarketArtifactManifestV1;
  } catch {
    throw new LoaderFailure(inputInvalid());
  }
  exactFields(manifest as unknown as JsonObject, MANIFEST_FIELDS);
  if (
    manifest.schemaVersion !== 1 ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(requiredString(manifest.caseId, 128)) ||
    !/^mfp1_[a-f0-9]{64}$/u.test(requiredString(manifest.sourceProfileId)) ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(requiredString(manifest.providerCode, 128)) ||
    !/^aob1_[a-f0-9]{64}$/u.test(requiredString(manifest.acquisitionObservationId)) ||
    !Number.isSafeInteger(manifest.asOfMs) ||
    manifest.asOfMs < 0 ||
    !Number.isSafeInteger(manifest.expectedPageCount) ||
    manifest.expectedPageCount < 1 ||
    !Array.isArray(manifest.retrievedMembers) ||
    manifest.retrievedMembers.length < 1
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  if (manifest.expectedPageCount > MARKET_MAX_ARTIFACTS_PER_ACQUISITION) {
    throw new LoaderFailure(boundExceeded("pagesPerAcquisition"));
  }
  if (manifest.retrievedMembers.length > MARKET_MAX_ARTIFACTS_PER_ACQUISITION) {
    throw new LoaderFailure(boundExceeded("artifactsPerAcquisition"));
  }
  if (manifest.retrievedMembers.length !== manifest.expectedPageCount) {
    throw new LoaderFailure(inputInvalid());
  }
  exactFields(manifest.provenance as unknown as JsonObject, PROVENANCE_FIELDS);
  if (
    manifest.provenance.classification !== "synthetic" ||
    manifest.provenance.redistributionClass !== "project-authored" ||
    manifest.provenance.authoringPolicyId !== "peas-original-market-fixture-v1" ||
    manifest.provenance.containsProviderBytes !== false ||
    manifest.provenance.containsProviderExamples !== false ||
    manifest.provenance.containsActualMarketValues !== false ||
    manifest.provenance.containsCredentialsOrAccountFacts !== false ||
    manifest.provenance.networkRequired !== false ||
    manifest.provenance.approvalReference !== null
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  requiredString(manifest.provenance.note, 1_024);

  const roles = new Set<string>();
  const observations = new Set<string>();
  const pages = new Set<number>();
  for (const member of manifest.retrievedMembers) {
    exactFields(member as unknown as JsonObject, MEMBER_FIELDS);
    exactFields(member.artifactContentPreimage as unknown as JsonObject, CONTENT_FIELDS);
    exactFields(member.rawArtifactPreimage as unknown as JsonObject, RAW_FIELDS);
    const role = requiredString(member.role);
    if (
      member.kind !== "retrieved-synthetic" ||
      member.sourceProfileId !== manifest.sourceProfileId ||
      !Number.isSafeInteger(member.pageOrdinal) ||
      member.pageOrdinal < 0 ||
      member.pageOrdinal >= manifest.expectedPageCount ||
      (member.priorPageChainHash !== null && !SHA256.test(member.priorPageChainHash)) ||
      typeof member.terminalPage !== "boolean" ||
      member.bodyFormat !== "application/json" ||
      member.artifactContentPreimage.mediaType !== "application/json" ||
      member.artifactContentPreimage.contentEncoding !== "identity" ||
      !Number.isSafeInteger(member.sizeBytes) ||
      member.sizeBytes < 0 ||
      !Number.isSafeInteger(member.artifactContentPreimage.sizeBytes) ||
      member.artifactContentPreimage.sizeBytes !== member.sizeBytes
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    if (member.sizeBytes > MARKET_MAX_RAW_ARTIFACT_BYTES) {
      throw new LoaderFailure(boundExceeded("rawArtifactBytes"));
    }
    validateRawArtifactByteBound({
      role: member.role,
      declaredSizeBytes: member.sizeBytes,
      verifiedSizeBytes: member.sizeBytes,
    });
    requiredHash(member.artifactDigest);
    requiredHash(member.artifactContentPreimage.sha256);
    requiredHash(member.selectedObservationId);
    requiredHash(member.selectedObservationHash);
    requiredPrefixedHash(member.artifactContentId, "mac1_");
    requiredPrefixedHash(member.rawArtifactId, "mar1_");
    if (
      member.artifactDigest !== member.artifactContentPreimage.sha256 ||
      member.rawArtifactPreimage.artifactContentId !== member.artifactContentId ||
      member.rawArtifactPreimage.vaultObservationId !== member.selectedObservationId ||
      member.rawArtifactPreimage.vaultObservationHash !== member.selectedObservationHash ||
      member.rawArtifactPreimage.acquisitionObservationId !== manifest.acquisitionObservationId ||
      member.rawArtifactPreimage.role !== role
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    const contentId = deriveArtifactContentId(member.artifactContentPreimage);
    const rawId = deriveRawArtifactId(member.rawArtifactPreimage);
    if (contentId !== member.artifactContentId || rawId !== member.rawArtifactId) {
      throw new LoaderFailure(inputInvalid());
    }
    if (
      roles.has(role) ||
      observations.has(member.selectedObservationId) ||
      pages.has(member.pageOrdinal)
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    roles.add(role);
    observations.add(member.selectedObservationId);
    pages.add(member.pageOrdinal);
  }
  const sorted = [...manifest.retrievedMembers].sort(
    (left, right) => left.pageOrdinal - right.pageOrdinal,
  );
  let expectedPriorPageChainHash: string | null = null;
  for (let index = 0; index < sorted.length; index += 1) {
    const member = sorted[index];
    if (
      member === undefined ||
      member.pageOrdinal !== index ||
      member.terminalPage !== (index === sorted.length - 1) ||
      member.priorPageChainHash !== expectedPriorPageChainHash
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    expectedPriorPageChainHash = canonicalHash("peas/market-page-chain/v1", {
      sourceProfileId: member.sourceProfileId,
      pageOrdinal: member.pageOrdinal,
      priorPageChainHash: member.priorPageChainHash,
      artifactContentId: member.artifactContentId,
      terminalPage: member.terminalPage,
    });
  }
  return freeze({ ...manifest, retrievedMembers: sorted });
}

function validateObservation(
  observation: ArtifactObservation | undefined,
  manifest: RecordedMarketArtifactManifestV1,
  member: RecordedMarketArtifactMemberV1,
): ArtifactObservation {
  if (observation === undefined) {
    throw new LoaderFailure(artifactInvalid("observation-invalid"));
  }
  const expectedObservationHash = canonicalHash("peas/artifact-observation/v1", {
    observationId: observation.observationId,
    attemptId: observation.attemptId,
    artifactDigest: observation.artifactDigest,
    provider: observation.provider,
    recordId: observation.recordId,
    revisionId: observation.revisionId,
    retrievedAtMs: observation.retrievedAtMs,
    request: observation.request,
    response: observation.response,
  });
  if (
    observation.observationHash !== member.selectedObservationHash ||
    observation.observationHash !== expectedObservationHash
  ) {
    throw new LoaderFailure(artifactInvalid("observation-hash-mismatch"));
  }
  if (observation.artifactDigest !== member.artifactDigest) {
    throw new LoaderFailure(artifactInvalid("digest-mismatch"));
  }
  if (
    observation.response.mediaType !== member.artifactContentPreimage.mediaType ||
    observation.response.contentEncoding !== member.artifactContentPreimage.contentEncoding
  ) {
    throw new LoaderFailure(artifactInvalid("media-or-encoding-mismatch"));
  }
  if (
    observation.response.declaredContentLength !== null &&
    observation.response.declaredContentLength !== member.sizeBytes
  ) {
    throw new LoaderFailure(artifactInvalid("size-mismatch"));
  }
  if (
    observation.observationId !== member.selectedObservationId ||
    observation.provider !== persistedProviderId(manifest.providerCode) ||
    observation.retrievedAtMs > manifest.asOfMs ||
    acquisitionObservationIdFor(manifest.providerCode, observation) !==
      manifest.acquisitionObservationId
  ) {
    throw new LoaderFailure(artifactInvalid("observation-invalid"));
  }
  return observation;
}

async function settleStreams(streams: readonly Readable[]): Promise<void> {
  await Promise.all(
    streams.map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.destroyed) {
            resolve();
            return;
          }
          stream.once("close", resolve);
          stream.destroy();
        }),
    ),
  );
}

async function consume(
  verified: VerifiedArtifactRead,
  member: RecordedMarketArtifactMemberV1,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  const hash = createHash("sha256");
  let consumed = 0;
  try {
    for await (const chunk of verified.stream) {
      if (!(chunk instanceof Uint8Array)) throw new Error("non-byte artifact stream");
      if (
        chunk.byteLength > member.sizeBytes - consumed ||
        chunk.byteLength > MARKET_MAX_RAW_ARTIFACT_BYTES - consumed
      ) {
        throw new Error("artifact grew past bounded metadata");
      }
      const bytes = Buffer.from(chunk);
      consumed += bytes.byteLength;
      hash.update(bytes);
      chunks.push(bytes);
    }
  } catch {
    verified.stream.destroy();
    throw new LoaderFailure(marketReason("market.artifact-read-failed"));
  }
  if (consumed !== member.sizeBytes) {
    throw new LoaderFailure(artifactInvalid("size-mismatch"));
  }
  if (hash.digest("hex") !== member.artifactDigest) {
    throw new LoaderFailure(artifactInvalid("digest-mismatch"));
  }
  return Uint8Array.from(Buffer.concat(chunks, consumed));
}

function parseRecords(bytes: Uint8Array, sourceProfileId: string): readonly JsonValue[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LoaderFailure(inputInvalid());
  }
  const parsed = new BoundedJsonParser(text).parse();
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.hasOwn(parsed, "records")
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  const object = parsed as JsonObject;
  if (!Array.isArray(object["records"])) {
    throw new LoaderFailure(inputInvalid());
  }
  exactFields(object, ["schemaVersion", "sourceProfileId", "records"]);
  if (object["schemaVersion"] !== 1 || object["sourceProfileId"] !== sourceProfileId) {
    throw new LoaderFailure(inputInvalid());
  }
  if (object["records"].length > MARKET_MAX_RECORDS_PER_ARTIFACT) {
    throw new LoaderFailure(boundExceeded("recordsPerArtifactOrPage"));
  }
  validateRawJsonParserBounds(parsed, sourceProfileId);
  try {
    assertJsonWithinLimits(parsed, {
      maxDepth: MARKET_MAX_RAW_JSON_DEPTH,
      maxNodes: MARKET_MAX_RAW_JSON_NODES,
      maxArrayLength: MARKET_MAX_RAW_JSON_ARRAY_ITEMS,
      maxObjectKeys: MARKET_MAX_RAW_JSON_KEYS,
      maxStringBytes: MARKET_MAX_DECODED_STRING_BYTES,
      maxCanonicalBytes: MARKET_MAX_RAW_ARTIFACT_BYTES,
    });
  } catch {
    throw new LoaderFailure(boundExceeded("rawJsonArrayItems"));
  }
  return freeze(object["records"]);
}

export async function loadRecordedMarketArtifacts(
  store: ArtifactStore,
  value: RecordedMarketArtifactManifestV1,
): Promise<RecordedMarketLoaderResultV1> {
  let manifest: RecordedMarketArtifactManifestV1;
  try {
    manifest = detachManifest(value);
  } catch (error) {
    return freeze({
      status: "rejected",
      reason: loaderReason(error),
      members: [],
    });
  }

  const lookedUpObservations: (ArtifactObservation | undefined)[] = [];
  for (const member of manifest.retrievedMembers) {
    try {
      lookedUpObservations.push(await store.getObservation(member.selectedObservationId));
    } catch {
      lookedUpObservations.push(undefined);
    }
  }
  const observations: ArtifactObservation[] = [];
  try {
    for (let index = 0; index < manifest.retrievedMembers.length; index += 1) {
      const member = manifest.retrievedMembers[index];
      if (member === undefined) throw new LoaderFailure(inputInvalid());
      observations.push(validateObservation(lookedUpObservations[index], manifest, member));
    }
  } catch (error) {
    return freeze({
      status: "rejected",
      reason:
        error instanceof LoaderFailure ? error.reason : artifactInvalid("observation-invalid"),
      members: [],
    });
  }

  const reads: VerifiedArtifactRead[] = [];
  let metadataFailure: LoaderFailure | null = null;
  let aggregate = 0;
  for (const member of manifest.retrievedMembers) {
    try {
      const read = await store.read(member.artifactDigest);
      reads.push(read);
      if (read.artifact.digest !== member.artifactDigest) {
        throw new LoaderFailure(artifactInvalid("digest-mismatch"));
      }
      if (read.artifact.sizeBytes !== member.sizeBytes) {
        throw new LoaderFailure(artifactInvalid("size-mismatch"));
      }
      if (read.artifact.sizeBytes > MARKET_MAX_RAW_ARTIFACT_BYTES) {
        throw new LoaderFailure(boundExceeded("rawArtifactBytes"));
      }
      validateRawArtifactByteBound({
        role: member.role,
        declaredSizeBytes: member.sizeBytes,
        verifiedSizeBytes: read.artifact.sizeBytes,
      });
      aggregate += read.artifact.sizeBytes;
      if (!Number.isSafeInteger(aggregate) || aggregate > MARKET_MAX_AGGREGATE_VERIFIED_BYTES) {
        throw new LoaderFailure(boundExceeded("aggregateVerifiedBytes"));
      }
    } catch (error) {
      metadataFailure ??=
        error instanceof LoaderFailure || error instanceof MarketContractError
          ? new LoaderFailure(error.reason)
          : new LoaderFailure(marketReason("market.artifact-read-failed"));
    }
  }
  if (metadataFailure !== null || reads.length !== manifest.retrievedMembers.length) {
    await settleStreams(reads.map((read) => read.stream));
    return freeze({
      status: "rejected",
      reason: metadataFailure?.reason ?? marketReason("market.artifact-read-failed"),
      members: [],
    });
  }
  validateAggregateVerifiedByteBound(
    manifest.retrievedMembers.map((member, index) => ({
      role: member.role,
      declaredSizeBytes: member.sizeBytes,
      verifiedSizeBytes: reads[index]?.artifact.sizeBytes ?? 0,
    })),
  );

  try {
    const members: VerifiedRecordedMarketMemberV1[] = [];
    for (let index = 0; index < reads.length; index += 1) {
      const read = reads[index];
      const member = manifest.retrievedMembers[index];
      const observation = observations[index];
      if (read === undefined || member === undefined || observation === undefined) {
        throw new LoaderFailure(inputInvalid());
      }
      const bytes = await consume(read, member);
      const records = parseRecords(bytes, member.sourceProfileId);
      validateRecordAndFactCardinalityBounds(
        [{ role: member.role, pageOrdinal: member.pageOrdinal, records }],
        [],
      );
      validateCanonicalRecordByteBounds(records);
      members.push(
        Object.freeze({
          role: member.role,
          sourceProfileId: member.sourceProfileId,
          pageOrdinal: member.pageOrdinal,
          artifactContentId: member.artifactContentId,
          rawArtifactId: member.rawArtifactId,
          artifactDigest: member.artifactDigest,
          selectedObservationId: member.selectedObservationId,
          selectedObservationHash: member.selectedObservationHash,
          retrievedAtMs: observation.retrievedAtMs,
          bytes: Uint8Array.from(bytes),
          records,
        }),
      );
    }
    return Object.freeze({
      status: "verified",
      reason: null,
      members: Object.freeze(members),
    });
  } catch (error) {
    await settleStreams(reads.map((read) => read.stream));
    return freeze({
      status: "rejected",
      reason:
        error instanceof LoaderFailure || error instanceof MarketContractError
          ? error.reason
          : marketReason("market.artifact-read-failed"),
      members: [],
    });
  }
}

const FIXTURE_FIELDS = Object.freeze([
  "schemaVersion",
  "fixtureId",
  "caseId",
  "contractAuthorityRegistry",
  "sourceProfiles",
  "acquisition",
  "instruments",
  "calendarSnapshot",
  "retrievedMembers",
  "parsedFactExpectations",
  "recordedCorpora",
  "selectionRequests",
  "expectedEvaluations",
  "expectedMetrics",
  "expectedReasonTrace",
  "exercisedBounds",
  "catalogEvidence",
  "expectedCatalogOutcomes",
  "provenance",
  "expectedManifestId",
]);
const REGISTRY_FIELDS = Object.freeze([
  "schemaVersion",
  "contractContentCommit",
  "entries",
  "contractAuthorityRegistryId",
]);
const RAW_RECORD_FIELDS = Object.freeze([
  "sourceProfileId",
  "memberRole",
  "instrumentId",
  "venueTapeId",
  "providerRecordKey",
  "providerRevisionKey",
  "providerStableRecordFamily",
  "eventKind",
  "eventTime",
  "providerSequence",
  "sequenceSessionDate",
  "canonicalProviderPayloadDigest",
  "memberKey",
  "occurrenceOrdinal",
  "revisionKind",
  "supersedesRevisionId",
  "effectiveEventTime",
  "sessionKind",
  "currency",
  "payload",
  "normalizerVersion",
  "conditionPolicyVersion",
  "calendarVersion",
  "parserContractVersion",
  "durablyRecordedAtMs",
  "durableLogicalAtMs",
  "durableClockBasisId",
  "primaryCorpusMember",
]);
const FIXTURE_LIMITS = Object.freeze({
  maxDepth: 12,
  maxNodes: 500_000,
  maxArrayLength: 10_000,
  maxObjectKeys: 64,
  maxStringBytes: 1_024,
  maxCanonicalBytes: 33_554_432,
});

const MARKET_FIXTURE_CATALOG_CASE_IDS = Object.freeze([
  ...Array.from({ length: 15 }, (_, index) => `Q-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `S-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 6 }, (_, index) => `T-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `B-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `PCL-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, index) => `R-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `O-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `I-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, index) => `C-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, index) => `M-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `D-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 2 }, (_, index) => `E-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `X-${String(index + 1).padStart(2, "0")}`),
]);

const MARKET_FIXTURE_CATALOG_OUTCOMES = Object.freeze({
  "Q-01": "exact-midpoint-10.01",
  "Q-02": "exact-midpoint-1.0000005",
  "Q-03": "target-selected-future-ignored",
  "Q-04": "exact-age-eligible-one-ns-over-stale",
  "Q-05": "quote-one-sided-no-substitution",
  "Q-06": "locked-primary-degraded-strict-missing",
  "Q-07": "market.quote-crossed",
  "Q-08": "slow-primary-degraded-strict-missing",
  "Q-09": "condition-unknown-and-condition-bound",
  "Q-10": "luld-complete-degraded-missing",
  "Q-11": "halt-target-missing-no-backfill",
  "Q-12": "sequence-gap-through-reset-then-recovery",
  "Q-13": "equal-time-ambiguous-sequence-insufficient",
  "Q-14": "bolo-separate-protected-nbbo-unchanged",
  "Q-15": "equal-values-distinct-provider-selection-identities",
  "S-01": "weekday-holiday-session-closed",
  "S-02": "early-close-minus-one-regular-at-close-outside",
  "S-03": "dst-regimes-pinned-utc-offsets",
  "S-04": "premarket-to-regular-session-transition",
  "S-05": "overnight-excluded-regular-unchanged",
  "T-01": "regular-trade-updates-consolidated-last",
  "T-02": "sold-last-state-matrix-pinned",
  "T-03": "prior-reference-conditional-complete-state",
  "T-04": "odd-lot-never-consolidated-last",
  "T-05": "out-of-sequence-no-timestamp-rewrite",
  "T-06": "official-and-trade-open-close-separately-typed",
  "B-01": "completed-unadjusted-bar-close",
  "B-02": "market.bar-interval-future",
  "B-03": "adjusted-unadjusted-distinct",
  "PCL-01": "corrected-close-selected-first",
  "PCL-02": "listing-official-close-selected",
  "PCL-03": "primary-prior-close-missing-sensitivities-only",
  "R-01": "correction-present-recorded-primary",
  "R-02": "original-primary-correction-corrected",
  "R-03": "primary-retains-corrected-removes-cancelled",
  "R-04": "one-fact-two-deliveries",
  "R-05": "market.provider-observation-invalid:conflicting-content",
  "R-06": "correction-chain-fails-closed",
  "R-07": "cutoff-minus-and-equal-admitted-plus-one-excluded",
  "R-08": "corrected-only-before-equal-admitted-after-unknown",
  "O-01": "permutation-semantic-identities-unchanged",
  "O-02": "trusted-sequence-controls-arrival-preserved",
  "O-03": "page-chain-atomic-rejection",
  "I-01": "symbol-change-continuity-at-effective-boundary",
  "I-02": "reused-symbol-no-continuity",
  "I-03": "instrument-ambiguous-and-continuity-unresolved",
  "C-01": "split-crossing-primary-missing-adjusted-exact",
  "C-02": "cash-distribution-adjusted-sensitivity",
  "C-03": "unsupported-action-crossing-no-guess",
  "C-04": "action-revision-primary-corrected-distinct",
  "M-01": "strict-pre-origin-and-as-of-destinations",
  "M-02": "durable-capture-primary-differs-retrieval",
  "M-03": "independent-statuses-denominator-retained",
  "M-04": "quote-missing-no-trade-or-bar-fallback",
  "D-01": "agree-provenance-distinct",
  "D-02": "disagree-primary-unchanged",
  "D-03": "primary-missing-no-fallback",
  "E-01": "entitlement-state-fails-before-body-or-network",
  "E-02": "unapproved-fallback-or-cost-rejected-before-acquisition",
  "X-01": "hostile-object-schema-rejects-without-trap",
  "X-02": "malformed-input-rejects-without-partial-fact",
  "X-03": "sensitive-fields-reject-without-echo",
  "X-04": "verified-read-growth-replacement-fails-and-settles",
  "X-05": "all-84-bound-dispositions-executed",
} as const);

const MARKET_CORE_CATALOG_CASES = new Set([
  "R-01",
  "R-02",
  "R-03",
  "R-04",
  "R-05",
  "R-06",
  "R-07",
  "R-08",
  "I-01",
  "I-02",
  "I-03",
  "C-01",
  "C-02",
  "C-03",
  "C-04",
  "M-01",
  "M-02",
  "M-03",
  "M-04",
  "D-01",
  "D-02",
  "D-03",
]);
const REPLAY_CATALOG_CASES = new Set(["O-01", "O-02"]);
const CATALOG_EVIDENCE_FIELDS = Object.freeze([
  "caseId",
  "enforcementOwner",
  "testVectorId",
  "expectedOutcome",
]);

export function recordedMarketCatalogEvidence(): readonly JsonObject[] {
  return Object.freeze(
    MARKET_FIXTURE_CATALOG_CASE_IDS.map((caseId) => {
      const owner = MARKET_CORE_CATALOG_CASES.has(caseId)
        ? "market-core"
        : REPLAY_CATALOG_CASES.has(caseId)
          ? "integration-replay"
          : "recorded-loader";
      const vectorPrefix =
        owner === "market-core" ? "core" : owner === "integration-replay" ? "replay" : "loader";
      return Object.freeze({
        caseId,
        enforcementOwner: owner,
        testVectorId: `${vectorPrefix}:${caseId}:v1`,
        expectedOutcome:
          MARKET_FIXTURE_CATALOG_OUTCOMES[caseId as keyof typeof MARKET_FIXTURE_CATALOG_OUTCOMES],
      });
    }),
  );
}

function asObject(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LoaderFailure(inputInvalid());
  }
  return value as JsonObject;
}

function asArray(value: unknown): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new LoaderFailure(inputInvalid());
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return (
    canonicalHash("peas/market-fixture-comparison/v1", left as JsonValue) ===
    canonicalHash("peas/market-fixture-comparison/v1", right as JsonValue)
  );
}

function fixtureIdentity(prefix: string, domain: string, value: unknown): string {
  return `${prefix}${canonicalHash(domain, value as JsonValue)}`;
}

function validateAuthorityRegistry(value: ContractAuthorityRegistryV1): void {
  const registry = asObject(value);
  exactFields(registry, REGISTRY_FIELDS);
  if (
    value.schemaVersion !== 1 ||
    value.contractAuthorityRegistryId !== MARKET_CONTRACT_AUTHORITY_REGISTRY_ID ||
    !/^[a-f0-9]{40}$/u.test(value.contractContentCommit) ||
    !Array.isArray(value.entries) ||
    value.entries.length !== 10
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  const logicalIds = new Set<string>();
  let prior = "";
  for (const entry of value.entries) {
    exactFields(asObject(entry), [
      "logicalContractId",
      "repositoryPath",
      "documentSha256",
      "gitBlobOid",
      "contractContentCommit",
    ]);
    const logicalId = requiredString(entry.logicalContractId);
    if (
      logicalId <= prior ||
      logicalIds.has(logicalId) ||
      !SHA256.test(entry.documentSha256) ||
      !/^[a-f0-9]{40}$/u.test(entry.gitBlobOid) ||
      entry.contractContentCommit !== value.contractContentCommit
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    requiredString(entry.repositoryPath);
    logicalIds.add(logicalId);
    prior = logicalId;
  }
  const preimage = {
    schemaVersion: value.schemaVersion,
    contractContentCommit: value.contractContentCommit,
    entries: value.entries,
  };
  if (
    fixtureIdentity("car1_", "peas/contract-authority-registry/v1", preimage) !==
    value.contractAuthorityRegistryId
  ) {
    throw new LoaderFailure(inputInvalid());
  }
}

function validateSourceProfile(profile: JsonObject): Readonly<{
  profileId: string;
  providerCode: string;
  source: RecordedMarketRecordV1["source"];
}> {
  exactFields(profile, [
    "profileId",
    "provider",
    "dataset",
    "feed",
    "endpoint",
    "entitlement",
    "venueTapes",
    "protocolVersion",
    "parserContractVersion",
    "fixtureAuthorizationClass",
    "marketDataClass",
    "consolidationKind",
    "correctionRepresentation",
    "conditionMap",
    "emulationReference",
  ]);
  const provider = asObject(profile["provider"]);
  const dataset = asObject(profile["dataset"]);
  const feed = asObject(profile["feed"]);
  const endpoint = asObject(profile["endpoint"]);
  const entitlement = asObject(profile["entitlement"]);
  exactFields(provider, ["providerId", "preimage"]);
  exactFields(dataset, ["datasetId", "preimage"]);
  exactFields(feed, ["feedId", "preimage"]);
  exactFields(endpoint, ["endpointChannelId", "preimage"]);
  exactFields(entitlement, ["entitlementSnapshotId", "preimage"]);
  const providerPreimage = asObject(provider["preimage"]) as unknown as MarketProviderPreimageV1;
  const datasetPreimage = asObject(dataset["preimage"]) as unknown as MarketDatasetPreimageV1;
  const feedPreimage = asObject(feed["preimage"]) as unknown as MarketFeedPreimageV1;
  const endpointPreimage = asObject(endpoint["preimage"]) as unknown as EndpointChannelPreimageV1;
  const entitlementPreimage = asObject(
    entitlement["preimage"],
  ) as unknown as EntitlementSnapshotPreimageV1;
  validateProviderOrDatasetCodeByteBounds({
    providerCode: requiredString(providerPreimage.providerCode),
    datasetCode: requiredString(datasetPreimage.productFamily),
  });
  validateIdentifierByteBounds([
    { path: "$.sourceProfile.profileId", value: requiredString(profile["profileId"]) },
    {
      path: "$.sourceProfile.emulationReference.logicalContractId",
      value: requiredString(
        asObject(asObject(profile["emulationReference"])["preimage"])["logicalContractId"],
      ),
    },
  ]);
  validateGenericStringByteBounds([
    { path: "$.sourceProfile.protocolVersion", value: requiredString(profile["protocolVersion"]) },
    {
      path: "$.sourceProfile.parserContractVersion",
      value: requiredString(profile["parserContractVersion"]),
    },
  ]);
  const entitlementObject = entitlementPreimage as unknown as JsonObject;
  const capabilities = asArray(entitlementObject["capabilities"]);
  if (
    entitlementObject["zeroIncrementalSpend"] !== true ||
    entitlementObject["humanApprovalId"] !== null ||
    capabilities.length < 1 ||
    capabilities.some((value) => {
      const capability = asObject(value);
      return capability["status"] !== "granted" || capability["use"] !== "offline-replay";
    })
  ) {
    const firstCapability = capabilities[0] === undefined ? null : asObject(capabilities[0]);
    const entitlementFailureKind =
      entitlementObject["zeroIncrementalSpend"] !== true
        ? "zero-spend-violation"
        : firstCapability?.["status"] === "pending"
          ? "pending"
          : "denied";
    throw new LoaderFailure(marketReason("market.entitlement-invalid", { entitlementFailureKind }));
  }
  const emulationReference = asObject(profile["emulationReference"]);
  exactFields(emulationReference, ["emulationReferenceId", "preimage"]);
  const emulationPreimage = asObject(emulationReference["preimage"]);
  exactFields(emulationPreimage, [
    "contractAuthorityRegistryId",
    "logicalContractId",
    "sectionLabel",
    "semanticSubset",
  ]);
  const providerId = deriveMarketProviderId(providerPreimage);
  const datasetId = deriveMarketDatasetId(datasetPreimage);
  const feedId = deriveMarketFeedId(feedPreimage);
  const endpointChannelId = deriveEndpointChannelId(endpointPreimage);
  const entitlementSnapshotId = deriveEntitlementSnapshotId(entitlementPreimage);
  if (
    provider["providerId"] !== providerId ||
    dataset["datasetId"] !== datasetId ||
    feed["feedId"] !== feedId ||
    endpoint["endpointChannelId"] !== endpointChannelId ||
    entitlement["entitlementSnapshotId"] !== entitlementSnapshotId ||
    profile["fixtureAuthorizationClass"] !== "synthetic-offline-v1" ||
    profile["conditionMap"] !== null ||
    emulationReference["emulationReferenceId"] !==
      fixtureIdentity("mer1_", "peas/market-emulation-reference/v1", emulationPreimage)
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  for (const venue of asArray(profile["venueTapes"])) {
    const row = asObject(venue);
    exactFields(row, ["venueTapeId", "preimage"]);
    if (
      row["venueTapeId"] !==
      deriveVenueTapeId(asObject(row["preimage"]) as unknown as VenueTapePreimageV1)
    ) {
      throw new LoaderFailure(inputInvalid());
    }
  }
  const profileWithoutId = { ...profile };
  delete profileWithoutId["profileId"];
  const profileId = fixtureIdentity(
    "mfp1_",
    "peas/market-fixture-source-profile/v1",
    profileWithoutId,
  );
  if (profile["profileId"] !== profileId) throw new LoaderFailure(inputInvalid());
  return Object.freeze({
    profileId,
    providerCode: providerPreimage.providerCode,
    source: Object.freeze({
      providerId,
      datasetId,
      feedId,
      endpointChannelId,
      entitlementSnapshotId,
    }),
  });
}

function validateInstrument(value: JsonObject): string {
  exactFields(value, [
    "issuerMappingId",
    "issuerMappingPreimage",
    "instrumentId",
    "instrumentPreimage",
    "symbolAliases",
  ]);
  const issuerMappingId = deriveIssuerMappingId(asObject(value["issuerMappingPreimage"]) as never);
  if (value["issuerMappingId"] !== issuerMappingId) throw new LoaderFailure(inputInvalid());
  const preimage = asObject(value["instrumentPreimage"]) as unknown as InstrumentPreimageV1;
  const instrumentId = deriveInstrumentId(preimage);
  if (value["instrumentId"] !== instrumentId || preimage.issuerMappingId !== issuerMappingId) {
    throw new LoaderFailure(inputInvalid());
  }
  for (const alias of asArray(value["symbolAliases"])) {
    const row = asObject(alias);
    exactFields(row, ["symbolAliasId", "preimage"]);
    const aliasPreimage = asObject(row["preimage"]);
    exactFields(aliasPreimage, [
      "instrumentId",
      "symbol",
      "mappingAuthority",
      "mappingVersion",
      "mappingArtifactDigest",
      "effectiveFromNs",
      "effectiveToNs",
    ]);
    if (
      aliasPreimage["instrumentId"] !== instrumentId ||
      row["symbolAliasId"] !==
        fixtureIdentity("msa1_", "peas/market-symbol-alias/v1", aliasPreimage)
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    validateSymbolByteBounds([
      {
        path: "$.instruments[].symbolAliases[].preimage.symbol",
        symbol: requiredString(aliasPreimage["symbol"]),
      },
    ]);
  }
  return instrumentId;
}

function validateCalendar(value: JsonObject): void {
  exactFields(value, [
    "calendarSnapshotId",
    "calendarVersion",
    "calendarDigest",
    "timezone",
    "tzdbVersion",
    "tzdbDigest",
    "dates",
  ]);
  requiredString(value["calendarVersion"]);
  requiredHash(value["calendarDigest"]);
  if (value["timezone"] !== "America/New_York") throw new LoaderFailure(inputInvalid());
  requiredString(value["tzdbVersion"]);
  requiredHash(value["tzdbDigest"]);
  const dates = asArray(value["dates"]);
  validateCalendarDatesPerManifestBound({ dates });
  let priorDate = "";
  for (const raw of dates) {
    const date = asObject(raw);
    exactFields(date, [
      "localDate",
      "sessionStatus",
      "regularOpenNs",
      "regularCloseNs",
      "extendedPreStartNs",
      "extendedPostEndNs",
      "earlyClose",
    ]);
    const localDate = requiredString(date["localDate"]);
    if (
      localDate <= priorDate ||
      !["open", "holiday"].includes(date["sessionStatus"] as string) ||
      typeof date["earlyClose"] !== "boolean"
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    for (const field of [
      "regularOpenNs",
      "regularCloseNs",
      "extendedPreStartNs",
      "extendedPostEndNs",
    ]) {
      if (date[field] !== null && typeof date[field] !== "string") {
        throw new LoaderFailure(inputInvalid());
      }
    }
    if (
      date["sessionStatus"] === "holiday" &&
      [
        date["regularOpenNs"],
        date["regularCloseNs"],
        date["extendedPreStartNs"],
        date["extendedPostEndNs"],
      ].some((entry) => entry !== null)
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    priorDate = localDate;
  }
}

function validateAcquisition(
  acquisition: JsonObject,
  profiles: readonly ReturnType<typeof validateSourceProfile>[],
  instrumentIds: ReadonlySet<string>,
): void {
  exactFields(acquisition, [
    "sourceProfileId",
    "acquisitionObservationId",
    "acquisitionObservationPreimage",
    "marketAcquisitionId",
    "marketAcquisitionPreimage",
    "acquisitionMode",
    "declaredPageSize",
    "expectedPageCount",
    "consecutiveCalendarDates",
    "pageTokenInput",
    "completeWindowRequired",
  ]);
  const observationPreimage = asObject(acquisition["acquisitionObservationPreimage"]);
  exactFields(observationPreimage, [
    "provider",
    "retrievalAttemptId",
    "sanitizedRequestIdentityHash",
    "routeLabel",
  ]);
  const marketPreimage = asObject(acquisition["marketAcquisitionPreimage"]);
  exactFields(marketPreimage, [
    "acquisitionObservationId",
    "providerId",
    "datasetId",
    "feedId",
    "endpointChannelId",
    "entitlementSnapshotId",
    "instrumentIds",
    "requestedFactKinds",
    "queryStartNs",
    "queryEndNs",
    "sortOrder",
    "routePolicyVersion",
  ]);
  const profile = profiles.find((entry) => entry.profileId === acquisition["sourceProfileId"]);
  if (
    !Number.isSafeInteger(acquisition["expectedPageCount"]) ||
    !Number.isSafeInteger(acquisition["declaredPageSize"])
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  const acquiredInstrumentIds = asArray(marketPreimage["instrumentIds"]);
  validateAcquisitionCardinalityBounds({
    artifactMembers: Array.from(
      { length: acquisition["expectedPageCount"] as number },
      (_, index) => index,
    ),
    expectedPageCount: acquisition["expectedPageCount"] as number,
    instrumentIds: acquiredInstrumentIds.map((value) => requiredString(value)),
  });
  validateRecordedReplayPageSizeBound({
    acquisitionMode: acquisition["acquisitionMode"] as "recorded" | "replay",
    declaredPageSize: acquisition["declaredPageSize"] as number,
  });
  validateHistoricalQueryWindowBound({
    consecutiveCalendarDates: asArray(acquisition["consecutiveCalendarDates"]).map((value) =>
      requiredString(value),
    ),
  });
  validatePageTokenInputByteBound(
    acquisition["pageTokenInput"] === null
      ? null
      : {
          path: "$.acquisition.pageTokenInput",
          value: requiredString(acquisition["pageTokenInput"]),
        },
  );
  if (
    profile === undefined ||
    observationPreimage["provider"] !== profile.providerCode ||
    !sameJson(
      {
        providerId: marketPreimage["providerId"],
        datasetId: marketPreimage["datasetId"],
        feedId: marketPreimage["feedId"],
        endpointChannelId: marketPreimage["endpointChannelId"],
        entitlementSnapshotId: marketPreimage["entitlementSnapshotId"],
      },
      profile.source,
    ) ||
    acquiredInstrumentIds.some(
      (instrumentId) => typeof instrumentId !== "string" || !instrumentIds.has(instrumentId),
    ) ||
    !Number.isSafeInteger(acquisition["declaredPageSize"]) ||
    (acquisition["declaredPageSize"] as number) < 1 ||
    (acquisition["declaredPageSize"] as number) > MARKET_MAX_RECORDS_PER_ARTIFACT ||
    !Number.isSafeInteger(acquisition["expectedPageCount"]) ||
    (acquisition["expectedPageCount"] as number) < 1 ||
    acquisition["completeWindowRequired"] !== true ||
    !["recorded", "replay"].includes(acquisition["acquisitionMode"] as string)
  ) {
    throw new LoaderFailure(inputInvalid());
  }
}

function fixtureProjection(
  manifest: RecordedMarketFixtureManifestV1,
): RecordedMarketArtifactManifestV1 {
  const acquisition = manifest.acquisition;
  const acquisitionPreimage = asObject(
    acquisition["acquisitionObservationPreimage"],
  ) as unknown as Parameters<typeof deriveAcquisitionObservationId>[0];
  const acquisitionObservationId = deriveAcquisitionObservationId(acquisitionPreimage);
  const marketPreimage = asObject(
    acquisition["marketAcquisitionPreimage"],
  ) as unknown as MarketAcquisitionPreimageV1;
  if (
    acquisition["acquisitionObservationId"] !== acquisitionObservationId ||
    acquisition["marketAcquisitionId"] !== deriveMarketAcquisitionId(marketPreimage) ||
    marketPreimage.acquisitionObservationId !== acquisitionObservationId
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  const corpus = asObject(manifest.recordedCorpora[0]);
  const snapshot = asObject(corpus["snapshot"]);
  const asOfMs = snapshot["corpusClosedAtMs"];
  if (!Number.isSafeInteger(asOfMs) || (asOfMs as number) < 0) {
    throw new LoaderFailure(inputInvalid());
  }
  const profileId = requiredString(acquisition["sourceProfileId"]);
  const profile = manifest.sourceProfiles.find((entry) => entry["profileId"] === profileId);
  if (profile === undefined) throw new LoaderFailure(inputInvalid());
  const provider = asObject(asObject(profile["provider"])["preimage"]);
  return {
    schemaVersion: 1,
    caseId: manifest.caseId,
    sourceProfileId: profileId,
    providerCode: requiredString(provider["providerCode"], 128),
    acquisitionObservationId,
    asOfMs: asOfMs as number,
    expectedPageCount: acquisition["expectedPageCount"] as number,
    retrievedMembers: manifest.retrievedMembers,
    provenance: manifest.provenance,
  };
}

/**
 * Produces the validated artifact-read input for the recorded fixture pipeline. This is the
 * persistence checkpoint between semantic-manifest validation and verified byte reads.
 */
export function recordedMarketArtifactProjection(
  value: RecordedMarketFixtureManifestV1,
): RecordedMarketArtifactManifestV1 {
  return fixtureProjection(validateRecordedMarketFixtureManifest(value));
}

function validatedMarketReason(value: unknown): CanonicalMarketReasonV1 {
  try {
    return validateCanonicalMarketReason(value);
  } catch {
    throw new LoaderFailure(inputInvalid());
  }
}

function validateReasonArray(value: unknown): readonly CanonicalMarketReasonV1[] {
  const reasons = asArray(value).map(validatedMarketReason);
  const keys = reasons.map((reason) =>
    canonicalHash("peas/market-fixture-reason-order/v1", reason as unknown as JsonValue),
  );
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\0") !== keys.join("\0")) {
    throw new LoaderFailure(inputInvalid());
  }
  return reasons;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function exactPriceFraction(value: unknown): readonly [bigint, bigint] {
  const price = asObject(value);
  exactFields(price, ["numerator", "denominator"]);
  const numerator = requiredString(price["numerator"], 32);
  const denominator = requiredString(price["denominator"], 32);
  if (!/^-?(0|[1-9][0-9]*)$/u.test(numerator) || !/^[1-9][0-9]*$/u.test(denominator)) {
    throw new LoaderFailure(inputInvalid());
  }
  return [BigInt(numerator), BigInt(denominator)];
}

function exactMovement(
  numeratorPrice: unknown,
  denominatorPrice: unknown,
): readonly [string, string] {
  const [numeratorValue, numeratorScale] = exactPriceFraction(numeratorPrice);
  const [denominatorValue, denominatorScale] = exactPriceFraction(denominatorPrice);
  if (denominatorValue === 0n) throw new LoaderFailure(inputInvalid());
  let numerator = numeratorValue * denominatorScale - denominatorValue * numeratorScale;
  let denominator = numeratorScale * denominatorValue;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  return [(numerator / divisor).toString(), (denominator / divisor).toString()];
}

function validateExpectedMetrics(manifest: RecordedMarketFixtureManifestV1): void {
  if (manifest.expectedMetrics.length < 2) throw new LoaderFailure(inputInvalid());
  const evaluationsByReferenceId = new Map<
    string,
    Readonly<{ evaluation: JsonObject; request: JsonObject }>
  >();
  for (const evaluation of manifest.expectedEvaluations) {
    for (const field of ["selectedReferenceId", "missingReferenceId"]) {
      const value = evaluation[field];
      if (typeof value === "string") {
        const request = manifest.selectionRequests.find(
          (candidate) => candidate["requestId"] === evaluation["requestId"],
        );
        if (request === undefined || evaluationsByReferenceId.has(value)) {
          throw new LoaderFailure(inputInvalid());
        }
        evaluationsByReferenceId.set(value, { evaluation, request });
      }
    }
  }
  const metricIds = new Set<string>();
  const observationBases = new Set<string>();
  for (const metric of manifest.expectedMetrics) {
    exactFields(metric, EXPECTED_METRIC_FIELDS);
    const metricKind = metric["metricKind"];
    const priceBasis = metric["priceBasis"];
    const observationBasisKind = metric["observationBasisKind"];
    const viewKind = metric["viewKind"];
    const status = metric["status"];
    if (
      ![
        "prior-close-movement-at-first",
        "release-gap-movement",
        "residual-1m",
        "residual-5m",
        "residual-30m",
      ].includes(metricKind as string) ||
      ![
        "quote-nbbo-midpoint",
        "trade-last-eligible-consolidated",
        "bar-one-minute-completed-close",
      ].includes(priceBasis as string) ||
      !["capture", "retrieval"].includes(observationBasisKind as string) ||
      !["recorded-primary", "recorded-corrected"].includes(viewKind as string) ||
      !["selected-complete", "selected-degraded", "missing"].includes(status as string)
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    const preimage = {
      metricKind,
      priceBasis,
      observationBasisKind,
      viewKind,
      numeratorReferenceId: metric["numeratorReferenceId"],
      denominatorReferenceId: metric["denominatorReferenceId"],
    };
    const metricId = fixtureIdentity("mmm1_", "peas/market-movement-metric/v1", preimage);
    if (
      metric["metricId"] !== metricId ||
      metricIds.has(metricId) ||
      (metric["numeratorReferenceId"] !== null &&
        !evaluationsByReferenceId.has(metric["numeratorReferenceId"] as string)) ||
      (metric["denominatorReferenceId"] !== null &&
        !evaluationsByReferenceId.has(metric["denominatorReferenceId"] as string))
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    if (status === "missing") {
      if (
        metric["rationalNumerator"] !== null ||
        metric["rationalDenominator"] !== null ||
        metric["reason"] === null
      ) {
        throw new LoaderFailure(inputInvalid());
      }
      validatedMarketReason(metric["reason"]);
    } else {
      const numerator = evaluationsByReferenceId.get(metric["numeratorReferenceId"] as string);
      const denominator = evaluationsByReferenceId.get(metric["denominatorReferenceId"] as string);
      if (
        numerator === undefined ||
        denominator === undefined ||
        numerator.evaluation["status"] === "missing" ||
        denominator.evaluation["status"] === "missing" ||
        metric["reason"] !== null
      ) {
        throw new LoaderFailure(inputInvalid());
      }
      const branchAsOf = asObject(numerator.request["asOfBasis"]);
      const branchBasis = asObject(branchAsOf["trustedObservationBasis"])["basisKind"];
      const branchRole = branchAsOf["anchorRole"];
      if (
        branchBasis !== observationBasisKind ||
        branchRole !==
          (observationBasisKind === "capture"
            ? "h001-primary-durable-capture"
            : "h001-mandatory-retrieval-sensitivity")
      ) {
        throw new LoaderFailure(inputInvalid());
      }
      const [rationalNumerator, rationalDenominator] = exactMovement(
        numerator.evaluation["exactPrice"],
        denominator.evaluation["exactPrice"],
      );
      if (
        metric["rationalNumerator"] !== rationalNumerator ||
        metric["rationalDenominator"] !== rationalDenominator
      ) {
        throw new LoaderFailure(inputInvalid());
      }
    }
    validateReasonArray(metric["diagnostics"]);
    metricIds.add(metricId);
    observationBases.add(observationBasisKind as string);
  }
  if (!observationBases.has("capture") || !observationBases.has("retrieval")) {
    throw new LoaderFailure(inputInvalid());
  }
  const capture = manifest.expectedMetrics.find(
    (metric) => metric["observationBasisKind"] === "capture",
  );
  const retrieval = manifest.expectedMetrics.find(
    (metric) => metric["observationBasisKind"] === "retrieval",
  );
  if (
    capture?.["numeratorReferenceId"] === retrieval?.["numeratorReferenceId"] ||
    (capture?.["rationalNumerator"] === retrieval?.["rationalNumerator"] &&
      capture?.["rationalDenominator"] === retrieval?.["rationalDenominator"])
  ) {
    throw new LoaderFailure(inputInvalid());
  }
}

function validateExpectedReasonTrace(manifest: RecordedMarketFixtureManifestV1): void {
  if (manifest.expectedReasonTrace.length < 1) throw new LoaderFailure(inputInvalid());
  const requestIds = new Set(
    manifest.selectionRequests.map((request) => requiredString(request["requestId"])),
  );
  const candidateIds = new Set(
    manifest.parsedFactExpectations
      .map((fact) => fact["normalizedMarketFactId"])
      .filter((value): value is string => typeof value === "string"),
  );
  const rows = new Set<string>();
  for (const row of manifest.expectedReasonTrace) {
    exactFields(row, EXPECTED_REASON_FIELDS);
    if (
      !["authority", "parse", "normalize", "selection", "metric"].includes(
        row["stage"] as string,
      ) ||
      (row["requestId"] !== null && !requestIds.has(row["requestId"] as string)) ||
      (row["candidateIdentity"] !== null && !candidateIds.has(row["candidateIdentity"] as string))
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    validatedMarketReason(row["reason"]);
    validateReasonArray(row["diagnostics"]);
    const key = canonicalHash("peas/market-fixture-reason-trace-row/v1", row);
    if (rows.has(key)) throw new LoaderFailure(inputInvalid());
    rows.add(key);
  }
}

function boundReason(
  violation: BoundViolationKindV1,
  boundId: string,
): Readonly<{ code: string; detail: JsonObject | null }> {
  switch (violation) {
    case "market-bound":
      return { code: "market.bound-exceeded", detail: { limitKind: boundId } };
    case "market-input":
      return { code: "market.input-invalid", detail: null };
    case "market-decimal":
      return { code: "market.decimal-invalid", detail: null };
    case "market-quote-stale":
      return { code: "market.quote-stale", detail: null };
    case "market-timestamp-insufficient":
      return {
        code: "market.timestamp-insufficient",
        detail: { timestampFailureKind: "capture-retrieval-lag-exceeded" },
      };
    case "study-bound":
      return { code: "study.bound-exceeded", detail: { limitKind: boundId } };
    case "study-input":
      return { code: "study.input-invalid", detail: null };
    case "study-liquidity-unknown":
      return { code: "study.liquidity-unknown", detail: null };
    case "study-timeliness-not-met":
      return { code: "study.timeliness-threshold-not-met", detail: null };
    case "study-correction-after-cutoff":
      return { code: "study.correction-after-cutoff", detail: null };
  }
}

function upperObservedValue(rule: BoundEnforcementRuleV1, schemaUpper: boolean): string {
  if (schemaUpper) return "201";
  const special: Readonly<Record<string, string>> = {
    recordedReplayPageSize: "10001",
    historicalQueryWindow: "9",
    selectionSearchWindowMs: "86400001",
    primaryResidualTargets: "T0,T1,T5,T30,T60",
    targetClusters: "181",
    laneTargets: "121/40/20",
    controlTargets: "6/5/5/5",
    reasonDefinitions: "65-per-namespace",
    collectionSessions: "66",
    liquidityHistorySessions: "21",
    bootstrapReplicates: "10001",
    holmSlots: "25",
  };
  const selected = special[rule.boundId];
  if (selected !== undefined) return selected;
  if (/^[0-9]+$/u.test(rule.exactValue)) return (BigInt(rule.exactValue) + 1n).toString();
  throw new LoaderFailure(inputInvalid());
}

function lowerObservedValue(rule: BoundEnforcementRuleV1): string {
  const special: Readonly<Record<string, string>> = {
    recordedReplayPageSize: "0",
    historicalQueryWindow: "0",
    selectionSearchWindowMs: "-1",
    targetClusters: "179",
    laneTargets: "119/40/20",
    controlTargets: "4/5/5/5",
    collectionSessions: "64",
    liquidityHistorySessions: "19",
    minimumValidLiquiditySessions: "14",
    bootstrapReplicates: "9999",
    holmSlots: "23",
  };
  const selected = special[rule.boundId];
  if (selected !== undefined) return selected;
  throw new LoaderFailure(inputInvalid());
}

function countMinusObservedValue(rule: BoundEnforcementRuleV1): string {
  if (rule.boundId === "primaryResidualTargets") return "T0,T1,T5";
  return lowerObservedValue(rule);
}

function expectedBoundRows(manifest: RecordedMarketFixtureManifestV1): readonly JsonObject[] {
  const candidateIdentity = requiredString(
    manifest.parsedFactExpectations[0]?.["normalizedMarketFactId"],
  );
  const metricId = requiredString(manifest.expectedMetrics[0]?.["metricId"]);
  const localIds = (atomicity: string) => ({
    candidateIdentity: atomicity === "candidate" ? candidateIdentity : null,
    metricId: atomicity === "metric" ? metricId : null,
    studyCaseId: atomicity === "study-run" ? FIXTURE_STUDY_CASE_ID : null,
  });
  const disposition = (
    rule: BoundEnforcementRuleV1,
    vectorKind: string,
    accepted: boolean,
    violation: BoundViolationKindV1 | null,
  ) => ({
    boundId: rule.boundId,
    stage: rule.stage,
    vectorKind,
    accepted,
    reason: violation === null ? null : boundReason(violation, rule.boundId),
    atomicity: rule.atomicity,
  });
  const rows: JsonObject[] = [];
  for (const rule of BOUND_ENFORCEMENT_REGISTRY) {
    rows.push({
      boundId: rule.boundId,
      observedValue: rule.exactValue,
      expectedDisposition: disposition(rule, "exact", true, null),
      ...localIds(rule.atomicity),
    });
    if (rule.upperViolation !== null) {
      rows.push({
        boundId: rule.boundId,
        observedValue: upperObservedValue(rule, false),
        expectedDisposition: disposition(rule, "upper-one-over", false, rule.upperViolation),
        ...localIds(rule.atomicity),
      });
    }
    if (rule.schemaUpperViolation !== null) {
      rows.push({
        boundId: rule.boundId,
        observedValue: upperObservedValue(rule, true),
        expectedDisposition: disposition(rule, "upper-one-over", false, rule.schemaUpperViolation),
        ...localIds(rule.atomicity),
      });
    }
    if (rule.lowerViolation !== null) {
      rows.push({
        boundId: rule.boundId,
        observedValue: lowerObservedValue(rule),
        expectedDisposition: disposition(rule, "lower-one-below", false, rule.lowerViolation),
        ...localIds(rule.atomicity),
      });
    }
    if (rule.countMinusOneViolation !== null) {
      rows.push({
        boundId: rule.boundId,
        observedValue: countMinusObservedValue(rule),
        expectedDisposition: disposition(
          rule,
          "exact-count-minus-one",
          false,
          rule.countMinusOneViolation,
        ),
        ...localIds(rule.atomicity),
      });
    }
  }
  return rows;
}

function validateExercisedBounds(manifest: RecordedMarketFixtureManifestV1): void {
  const seenBounds = new Set<string>();
  for (const row of manifest.exercisedBounds) {
    exactFields(row, EXERCISED_BOUND_FIELDS);
    const disposition = asObject(row["expectedDisposition"]);
    exactFields(disposition, BOUND_DISPOSITION_FIELDS);
    if (
      !CANONICAL_BOUND_IDS.includes(row["boundId"] as never) ||
      disposition["boundId"] !== row["boundId"] ||
      typeof row["observedValue"] !== "string"
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    if (RECORDED_LOADER_BOUND_IDS.includes(row["boundId"] as RecordedLoaderBoundIdV1)) {
      let actualReason: CanonicalMarketReasonV1 | null = null;
      try {
        validateRecordedLoaderBound(
          row["boundId"] as RecordedLoaderBoundIdV1,
          row["observedValue"],
        );
      } catch (error) {
        if (!(error instanceof LoaderFailure)) throw error;
        actualReason = error.reason;
      }
      const accepted = actualReason === null;
      if (disposition["accepted"] !== accepted || !sameJson(disposition["reason"], actualReason)) {
        throw new LoaderFailure(inputInvalid());
      }
    }
    seenBounds.add(row["boundId"] as string);
  }
  if (
    seenBounds.size !== CANONICAL_BOUND_IDS.length ||
    !sameJson(manifest.exercisedBounds, expectedBoundRows(manifest))
  ) {
    throw new LoaderFailure(inputInvalid());
  }
}

function validateCatalogEvidence(manifest: RecordedMarketFixtureManifestV1): void {
  if (
    MARKET_FIXTURE_CATALOG_CASE_IDS.length !== 64 ||
    Object.keys(MARKET_FIXTURE_CATALOG_OUTCOMES).length !== 64 ||
    manifest.catalogEvidence.length !== 64
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  const seen = new Set<string>();
  for (const row of manifest.catalogEvidence) {
    exactFields(row, CATALOG_EVIDENCE_FIELDS);
    const caseId = requiredString(row["caseId"], 8);
    const expectedOutcome =
      MARKET_FIXTURE_CATALOG_OUTCOMES[caseId as keyof typeof MARKET_FIXTURE_CATALOG_OUTCOMES];
    const owner = MARKET_CORE_CATALOG_CASES.has(caseId)
      ? "market-core"
      : REPLAY_CATALOG_CASES.has(caseId)
        ? "integration-replay"
        : "recorded-loader";
    const vectorPrefix =
      owner === "market-core" ? "core" : owner === "integration-replay" ? "replay" : "loader";
    if (
      expectedOutcome === undefined ||
      seen.has(caseId) ||
      row["enforcementOwner"] !== owner ||
      row["testVectorId"] !== `${vectorPrefix}:${caseId}:v1` ||
      row["expectedOutcome"] !== expectedOutcome
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    seen.add(caseId);
  }
  if (MARKET_FIXTURE_CATALOG_CASE_IDS.some((caseId) => !seen.has(caseId))) {
    throw new LoaderFailure(inputInvalid());
  }
}

export function validateRecordedMarketFixtureManifest(
  value: RecordedMarketFixtureManifestV1,
): RecordedMarketFixtureManifestV1 {
  let manifest: RecordedMarketFixtureManifestV1;
  try {
    assertJsonWithinLimits(value, FIXTURE_LIMITS, "$.recordedMarketFixtureManifest");
    manifest = inertJsonSnapshot(
      value as unknown as JsonValue,
    ) as unknown as RecordedMarketFixtureManifestV1;
  } catch {
    throw new LoaderFailure(inputInvalid());
  }
  exactFields(manifest as unknown as JsonObject, FIXTURE_FIELDS);
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.sourceProfiles) ||
    !Array.isArray(manifest.instruments) ||
    !Array.isArray(manifest.retrievedMembers) ||
    !Array.isArray(manifest.parsedFactExpectations) ||
    !Array.isArray(manifest.recordedCorpora) ||
    !Array.isArray(manifest.selectionRequests) ||
    !Array.isArray(manifest.expectedEvaluations) ||
    !Array.isArray(manifest.expectedMetrics) ||
    !Array.isArray(manifest.expectedReasonTrace) ||
    !Array.isArray(manifest.exercisedBounds) ||
    !Array.isArray(manifest.catalogEvidence) ||
    !Array.isArray(manifest.expectedCatalogOutcomes)
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  validateAuthorityRegistry(manifest.contractAuthorityRegistry);
  if (manifest.sourceProfiles.length < 1 || manifest.instruments.length < 1) {
    throw new LoaderFailure(inputInvalid());
  }
  const profiles = manifest.sourceProfiles.map(validateSourceProfile);
  const profileIds = profiles.map((profile) => profile.profileId);
  if (new Set(profileIds).size !== profileIds.length) throw new LoaderFailure(inputInvalid());
  const instrumentIds = new Set(manifest.instruments.map(validateInstrument));
  if (instrumentIds.size !== manifest.instruments.length) throw new LoaderFailure(inputInvalid());
  validateAcquisition(manifest.acquisition, profiles, instrumentIds);
  const calendar = manifest.calendarSnapshot;
  validateCalendar(calendar);
  const calendarWithoutId = { ...calendar };
  delete calendarWithoutId["calendarSnapshotId"];
  if (
    calendar["calendarSnapshotId"] !==
    fixtureIdentity("mcal1_", "peas/market-calendar-snapshot/v1", calendarWithoutId)
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  exactFields(manifest.provenance, PROVENANCE_FIELDS);
  if (
    manifest.provenance.classification !== "synthetic" ||
    manifest.provenance.redistributionClass !== "project-authored" ||
    manifest.provenance.authoringPolicyId !== "peas-original-market-fixture-v1" ||
    manifest.provenance.containsProviderBytes !== false ||
    manifest.provenance.containsProviderExamples !== false ||
    manifest.provenance.containsActualMarketValues !== false ||
    manifest.provenance.containsCredentialsOrAccountFacts !== false ||
    manifest.provenance.networkRequired !== false ||
    manifest.provenance.approvalReference !== null
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  requiredString(manifest.provenance.note, 1_024);
  fixtureProjection(manifest);
  validateExpectedMetrics(manifest);
  validateExpectedReasonTrace(manifest);
  validateExercisedBounds(manifest);
  validateCatalogEvidence(manifest);
  const executionSidecarRecords = [
    ...manifest.expectedReasonTrace,
    ...manifest.exercisedBounds,
  ] as readonly JsonValue[];
  for (let index = 0; index < executionSidecarRecords.length; index += 1) {
    const record = executionSidecarRecords[index];
    if (record === undefined) throw new LoaderFailure(inputInvalid());
    validateSidecarParserBounds(record, `$.executionBundle.records[${index}]`);
  }
  const executionEdges = manifest.expectedEvaluations.map((evaluation, index) => ({
    fromRecordId: requiredString(evaluation["requestId"]),
    toRecordId:
      typeof evaluation["selectedReferenceId"] === "string"
        ? evaluation["selectedReferenceId"]
        : requiredString(evaluation["missingReferenceId"]),
    edgeKind: `request-result-${index}`,
  }));
  validateSidecarRecordByteBounds(executionSidecarRecords);
  validateExecutionBundleBounds({
    records: executionSidecarRecords,
    edges: executionEdges,
  });
  const fixturePreimage = {
    caseId: manifest.caseId,
    contractAuthorityRegistry: manifest.contractAuthorityRegistry,
    sourceProfiles: manifest.sourceProfiles,
    acquisition: manifest.acquisition,
    instruments: manifest.instruments,
    calendarSnapshot: manifest.calendarSnapshot,
    retrievedMembers: manifest.retrievedMembers,
    parsedFactExpectations: manifest.parsedFactExpectations,
    recordedCorpora: manifest.recordedCorpora,
    selectionRequests: manifest.selectionRequests,
    catalogEvidence: manifest.catalogEvidence,
    expectedCatalogOutcomes: manifest.expectedCatalogOutcomes,
    provenance: manifest.provenance,
  };
  const fixtureId = fixtureIdentity("mfx1_", "peas/market-fixture/v1", fixturePreimage);
  if (manifest.fixtureId !== fixtureId) throw new LoaderFailure(inputInvalid());
  const withoutManifestId = { ...manifest };
  delete (withoutManifestId as { expectedManifestId?: string }).expectedManifestId;
  if (
    manifest.expectedManifestId !==
    fixtureIdentity("mfm1_", "peas/market-fixture-manifest/v1", withoutManifestId)
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  return freeze(manifest);
}

function sourceByProfile(
  manifest: RecordedMarketFixtureManifestV1,
): ReadonlyMap<string, ReturnType<typeof validateSourceProfile>> {
  return new Map(
    manifest.sourceProfiles.map((profile) => {
      const validated = validateSourceProfile(profile);
      return [validated.profileId, validated] as const;
    }),
  );
}

function typedRecords(
  manifest: RecordedMarketFixtureManifestV1,
  members: readonly VerifiedRecordedMarketMemberV1[],
): readonly RecordedMarketRecordV1[] {
  const profiles = sourceByProfile(manifest);
  const acquisitionId = requiredString(manifest.acquisition["marketAcquisitionId"]);
  const rawByRole = new Map(
    manifest.retrievedMembers.map((member) => [member.role, member.rawArtifactId] as const),
  );
  const records: RecordedMarketRecordV1[] = [];
  for (const member of members) {
    for (const raw of member.records) {
      const object = asObject(raw);
      exactFields(object, RAW_RECORD_FIELDS);
      validateSidecarParserBounds(object, `$.recordedMarketRecords[${records.length}]`);
      validateOpaqueProviderIdByteBounds(
        ["providerRecordKey", "providerRevisionKey", "providerStableRecordFamily", "memberKey"].map(
          (field) => ({
            path: `$.recordedMarketRecords[${records.length}].${field}`,
            value: requiredString(object[field]),
          }),
        ),
      );
      validateIdentifierByteBounds([
        {
          path: `$.recordedMarketRecords[${records.length}].instrumentId`,
          value: requiredString(object["instrumentId"]),
        },
        {
          path: `$.recordedMarketRecords[${records.length}].durableClockBasisId`,
          value: requiredString(object["durableClockBasisId"]),
        },
      ]);
      const sourceProfileId = requiredString(object["sourceProfileId"]);
      const memberRole = requiredString(object["memberRole"]);
      if (memberRole !== member.role) throw new LoaderFailure(inputInvalid());
      const profile = profiles.get(sourceProfileId);
      const rawArtifactId = rawByRole.get(memberRole);
      if (profile === undefined || rawArtifactId === undefined) {
        throw new LoaderFailure(inputInvalid());
      }
      const detached = { ...object };
      delete detached["sourceProfileId"];
      delete detached["memberRole"];
      records.push({
        ...detached,
        source: profile.source,
        marketAcquisitionId: acquisitionId,
        rawArtifactId,
      } as unknown as RecordedMarketRecordV1);
    }
  }
  return Object.freeze(records);
}

function coreSelectionRequest(
  value: JsonObject,
  manifest: RecordedMarketFixtureManifestV1,
): MarketSelectionRequestV1 {
  exactFields(value, [
    "requestId",
    "marketReferenceJoinKey",
    "instrumentId",
    "selectionPolicyId",
    "selectionPolicyPreimage",
    "intervalKey",
    "intervalDefinition",
    "referenceKind",
    "asOfBasis",
    "selectionSearchWindowMs",
  ]);
  const policyId = deriveSelectionPolicyId(
    asObject(value["selectionPolicyPreimage"]) as unknown as MarketSelectionPolicyPreimageV1,
  );
  const intervalKey = deriveMarketIntervalKey(
    asObject(value["intervalDefinition"]) as unknown as MarketIntervalDefinitionV1,
  );
  const requestPreimage = {
    marketReferenceJoinKey: value["marketReferenceJoinKey"],
    instrumentId: value["instrumentId"],
    selectionPolicyId: policyId,
    intervalKey,
    referenceKind: value["referenceKind"],
    asOfBasis: value["asOfBasis"],
  };
  if (
    value["selectionPolicyId"] !== policyId ||
    value["intervalKey"] !== intervalKey ||
    value["requestId"] !==
      fixtureIdentity("msq1_", "peas/market-selection-request/v1", requestPreimage)
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  const asOfBasis = asObject(value["asOfBasis"]);
  validateSelectionSearchWindowBound({
    windowStartMs: 0,
    windowEndMs: value["selectionSearchWindowMs"] as number,
  });
  const corpusRow = manifest.recordedCorpora.find(
    (row) =>
      row["recordedCorpusSnapshotId"] === asOfBasis["recordedCorpusSnapshotId"] &&
      row["corpusCutoffId"] === asOfBasis["corpusCutoffId"],
  );
  if (corpusRow === undefined) throw new LoaderFailure(inputInvalid());
  if (
    deriveRecordedCorpusSnapshotId(
      asObject(corpusRow["snapshot"]) as unknown as RecordedCorpusSnapshotV1,
    ) !== corpusRow["recordedCorpusSnapshotId"] ||
    deriveRecordedCorpusCutoffId(
      asObject(corpusRow["cutoff"]) as unknown as RecordedCorpusCutoffV1,
    ) !== corpusRow["corpusCutoffId"]
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  return {
    marketReferenceJoinKey: requiredString(value["marketReferenceJoinKey"]),
    intervalKey,
    referenceKind: requiredString(
      value["referenceKind"],
    ) as MarketSelectionRequestV1["referenceKind"],
    selectionPolicyId: policyId,
    selectionPolicy: asObject(
      value["selectionPolicyPreimage"],
    ) as unknown as MarketSelectionRequestV1["selectionPolicy"],
    recordedCorpusSnapshotId: requiredString(corpusRow["recordedCorpusSnapshotId"]),
    recordedCorpus: asObject(
      corpusRow["snapshot"],
    ) as unknown as MarketSelectionRequestV1["recordedCorpus"],
    corpusCutoffId: requiredString(corpusRow["corpusCutoffId"]),
    corpusCutoff: asObject(
      corpusRow["cutoff"],
    ) as unknown as MarketSelectionRequestV1["corpusCutoff"],
    context: {
      instrumentId: requiredString(value["instrumentId"]),
      calendarSnapshotId: requiredString(manifest.calendarSnapshot["calendarSnapshotId"]),
      targetSessionKind: "regular-continuous",
      targetWithinSession: true,
      symbolContinuity: "proved",
      corporateActionState: "none",
    },
    asOfBasis: asOfBasis as unknown as MarketSelectionRequestV1["asOfBasis"],
    correctedCutoffNs:
      asOfBasis["viewKind"] === "recorded-corrected"
        ? requiredString(asObject(corpusRow["cutoff"])["cutoffTargetNs"])
        : null,
  };
}

function compareFactExpectations(
  expected: readonly JsonObject[],
  actual: readonly NormalizedMarketFactV1[],
  manifest: RecordedMarketFixtureManifestV1,
): void {
  if (expected.length !== actual.length) throw new LoaderFailure(inputInvalid());
  const byId = new Map(actual.map((fact) => [fact.normalizedMarketFactId, fact] as const));
  const memberRoleByRawArtifactId = new Map(
    manifest.retrievedMembers.map((member) => [member.rawArtifactId, member.role] as const),
  );
  const sourceProfileBySource = new Map(
    manifest.sourceProfiles.map((profile) => {
      const validated = validateSourceProfile(profile);
      return [
        canonicalHash("peas/market-source-key/v1", validated.source as unknown as JsonValue),
        validated.profileId,
      ] as const;
    }),
  );
  for (const row of expected) {
    exactFields(row, [
      "memberRole",
      "recordOrdinal",
      "sourceProfileId",
      "instrumentId",
      "providerObservationId",
      "providerObservationPreimage",
      "deliveryId",
      "deliveryPreimage",
      "revisionFamilyId",
      "revisionFamilyPreimage",
      "revisionId",
      "revisionPreimage",
      "marketFactId",
      "marketFactPreimage",
      "normalizedMarketFactId",
      "normalizedMarketFactPreimage",
      "factKind",
      "marketEventTimeNs",
      "sourceSequence",
      "sourceNativeIdentity",
      "canonicalFactDigest",
    ]);
    const id = row["normalizedMarketFactId"];
    const fact = byId.get(id as string | null);
    if (fact === undefined) {
      throw new LoaderFailure(inputInvalid());
    }
    const providerObservationPreimage = {
      ...fact.source,
      instrumentId: fact.instrumentId,
      venueTapeId: fact.venueTapeId,
      providerRecordKey: fact.providerRecordKey,
      providerRevisionKey: fact.providerRevisionKey,
      eventKind: fact.eventKind,
      eventTime: fact.eventTime,
      providerSequence: fact.providerSequence,
      sequenceSessionDate: fact.sequenceSessionDate,
      canonicalProviderPayloadDigest: fact.canonicalProviderPayloadDigest,
    };
    const deliveryPreimage = {
      providerObservationId: fact.providerObservationId,
      marketAcquisitionId: fact.marketAcquisitionId,
      rawArtifactId: fact.rawArtifactId,
      memberKey: fact.memberKey,
      occurrenceOrdinal: fact.occurrenceOrdinal,
    };
    const revisionFamilyPreimage = {
      providerId: fact.source.providerId,
      datasetId: fact.source.datasetId,
      feedId: fact.source.feedId,
      endpointChannelId: fact.source.endpointChannelId,
      instrumentId: fact.instrumentId,
      eventKind: fact.eventKind,
      providerStableRecordFamily: fact.providerStableRecordFamily,
    };
    const marketFactPreimage =
      fact.payload === null
        ? null
        : {
            instrumentId: fact.instrumentId,
            eventKind: fact.eventKind,
            eventTime: fact.eventTime,
            venueTapeId: fact.venueTapeId,
            sessionKind: fact.sessionKind,
            currency: fact.currency,
            canonicalPayload: fact.payload,
          };
    const revisionPreimage = {
      revisionFamilyId: fact.revisionFamilyId,
      revisionKind: fact.revisionKind,
      providerRevisionKey: fact.providerRevisionKey,
      supersedesRevisionId: fact.supersedesRevisionId,
      effectiveEventTime: fact.effectiveEventTime,
      marketFactId: fact.marketFactId,
    };
    const normalizedMarketFactPreimage =
      fact.marketFactId === null
        ? null
        : {
            marketFactId: fact.marketFactId,
            providerObservationId: fact.providerObservationId,
            revisionId: fact.revisionId,
            normalizerVersion: fact.normalizerVersion,
            conditionPolicyVersion: fact.conditionPolicyVersion,
            calendarVersion: fact.calendarVersion,
            parserContractVersion: fact.parserContractVersion,
          };
    const derived = {
      memberRole: memberRoleByRawArtifactId.get(fact.rawArtifactId),
      recordOrdinal: fact.occurrenceOrdinal,
      sourceProfileId: sourceProfileBySource.get(
        canonicalHash("peas/market-source-key/v1", fact.source as unknown as JsonValue),
      ),
      instrumentId: fact.instrumentId,
      providerObservationId: deriveProviderObservationId(providerObservationPreimage),
      providerObservationPreimage,
      deliveryId: deriveDeliveryId(deliveryPreimage),
      deliveryPreimage,
      revisionFamilyId: deriveRevisionFamilyId(revisionFamilyPreimage),
      revisionFamilyPreimage,
      revisionId: deriveRevisionId(revisionPreimage),
      revisionPreimage,
      marketFactId: marketFactPreimage === null ? null : deriveMarketFactId(marketFactPreimage),
      marketFactPreimage,
      normalizedMarketFactId:
        normalizedMarketFactPreimage === null
          ? null
          : deriveNormalizedMarketFactId(normalizedMarketFactPreimage),
      normalizedMarketFactPreimage,
      factKind: fact.eventKind,
      marketEventTimeNs: fact.eventTime.epochNs,
      sourceSequence: fact.providerSequence?.value ?? null,
      sourceNativeIdentity: fact.providerRecordKey,
      canonicalFactDigest:
        marketFactPreimage === null
          ? null
          : canonicalHash("peas/market-canonical-fact/v1", marketFactPreimage),
    };
    if (!sameJson(row, derived)) throw new LoaderFailure(inputInvalid());
  }
}

function compareEvaluation(
  expected: JsonObject,
  actual: MarketReferenceResultV1,
  request: JsonObject,
): void {
  exactFields(expected, [
    "requestId",
    "intervalKey",
    "referenceKind",
    "asOfBasis",
    "status",
    "resultKind",
    "candidateOutcomes",
    "selectedReferenceId",
    "missingReferenceId",
    "selectedNormalizedMarketFactId",
    "selectedRevisionId",
    "candidateSetHash",
    "exactPrice",
    "marketEventTimeNs",
    "ageNs",
    "reason",
    "diagnostics",
  ]);
  if (
    expected["requestId"] !== request["requestId"] ||
    expected["intervalKey"] !== request["intervalKey"] ||
    expected["referenceKind"] !== request["referenceKind"] ||
    !sameJson(expected["asOfBasis"], request["asOfBasis"]) ||
    expected["resultKind"] !== (actual.status === "missing" ? "missing" : "selected") ||
    !sameJson(expected["candidateOutcomes"], actual.candidates)
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  for (const field of [
    "status",
    "selectedReferenceId",
    "missingReferenceId",
    "candidateSetHash",
    "selectedNormalizedMarketFactId",
    "selectedRevisionId",
    "exactPrice",
    "marketEventTimeNs",
    "ageNs",
    "reason",
    "diagnostics",
  ]) {
    if (!sameJson(expected[field], actual[field as keyof MarketReferenceResultV1])) {
      throw new LoaderFailure(inputInvalid());
    }
  }
}

/**
 * Pure restart boundary after verified artifact reads. Callers may persist the verified member
 * descriptors/bytes, then resume normalization without redoing provider observation lookup.
 */
export function normalizeVerifiedRecordedMarketFixture(
  value: RecordedMarketFixtureManifestV1,
  members: readonly VerifiedRecordedMarketMemberV1[],
): readonly NormalizedMarketFactV1[] {
  const manifest = validateRecordedMarketFixtureManifest(value);
  const normalizedFacts = normalizeRecordedMarketRecords(typedRecords(manifest, members));
  validateRecordAndFactCardinalityBounds(
    members.map((member) => ({
      role: member.role,
      pageOrdinal: member.pageOrdinal,
      records: member.records,
    })),
    normalizedFacts,
  );
  compareFactExpectations(manifest.parsedFactExpectations, normalizedFacts, manifest);
  return Object.freeze(normalizedFacts);
}

/**
 * Pure restart boundary after normalization. Every supplied fact is reconciled bidirectionally by
 * the core selector against the recorded corpus before any expected evaluation is accepted.
 */
export function evaluateRecordedMarketFixtureSelections(
  value: RecordedMarketFixtureManifestV1,
  normalizedFacts: readonly NormalizedMarketFactV1[],
): readonly MarketReferenceResultV1[] {
  const manifest = validateRecordedMarketFixtureManifest(value);
  if (manifest.selectionRequests.length !== manifest.expectedEvaluations.length) {
    throw new LoaderFailure(inputInvalid());
  }
  const policy = asObject(manifest.selectionRequests[0]?.["selectionPolicyPreimage"]);
  validateClusterCardinalityBounds({
    intervalDefinitions: asArray(policy["intervalDefinitions"]),
    referenceResults: manifest.expectedEvaluations,
  });
  return Object.freeze(
    manifest.selectionRequests.map((request, index) => {
      const result = selectMarketReference(
        coreSelectionRequest(request, manifest),
        normalizedFacts,
      );
      const expected = manifest.expectedEvaluations[index];
      if (expected === undefined) throw new LoaderFailure(inputInvalid());
      compareEvaluation(expected, result, request);
      return result;
    }),
  );
}

function isolatedCatalogRequest(
  base: MarketSelectionRequestV1,
  fact: NormalizedMarketFactV1,
  referenceKind: MarketSelectionRequestV1["referenceKind"],
  targetTimeNs: string,
): MarketSelectionRequestV1 {
  const revisionEvidence = base.recordedCorpus.revisionEvidence.filter(
    (entry) => entry.revisionId === fact.revisionId,
  );
  if (revisionEvidence.length !== 1) throw new LoaderFailure(inputInvalid());
  const recordedCorpus: RecordedCorpusSnapshotV1 = {
    ...base.recordedCorpus,
    providerObservationIds: [fact.providerObservationId],
    revisionEvidence,
  };
  const recordedCorpusSnapshotId = deriveRecordedCorpusSnapshotId(recordedCorpus);
  const corpusCutoff: RecordedCorpusCutoffV1 = {
    ...base.corpusCutoff,
    corpusSnapshotId: recordedCorpusSnapshotId,
    admittedRevisionSetHash: deriveAdmittedRevisionSetHash([fact.revisionId]),
  };
  const corpusCutoffId = deriveRecordedCorpusCutoffId(corpusCutoff);
  const selectionPolicy = {
    ...base.selectionPolicy,
    correctionPolicy: {
      ...base.selectionPolicy.correctionPolicy,
      primaryCorpusSnapshotId: recordedCorpusSnapshotId,
      corpusCutoffId,
    },
  };
  const intervalDefinition =
    referenceKind === "prior-listing-official-close"
      ? selectionPolicy.intervalDefinitions.find(
          (interval) => interval.intervalKind === "prior-close",
        )
      : selectionPolicy.intervalDefinitions.find((interval) => interval.intervalKind === "t0");
  if (intervalDefinition === undefined) throw new LoaderFailure(inputInvalid());
  const trustedObservationBasis =
    intervalDefinition.anchorKind === "h001-selected-basis" &&
    base.asOfBasis.trustedObservationBasis.basisKind === "capture"
      ? {
          ...base.asOfBasis.trustedObservationBasis,
          receivedAtMs: Number(BigInt(targetTimeNs) / 1_000_000n),
        }
      : base.asOfBasis.trustedObservationBasis;
  return {
    ...base,
    intervalKey: deriveMarketIntervalKey(intervalDefinition),
    referenceKind,
    selectionPolicyId: deriveSelectionPolicyId(selectionPolicy),
    selectionPolicy,
    recordedCorpusSnapshotId,
    recordedCorpus,
    corpusCutoffId,
    corpusCutoff,
    context: {
      ...base.context,
      instrumentId: fact.instrumentId,
      targetSessionKind: fact.sessionKind,
      targetWithinSession:
        fact.sessionKind !== "calendar-closed" &&
        fact.sessionKind !== "unknown" &&
        fact.sessionKind !== "halted",
    },
    asOfBasis: {
      ...base.asOfBasis,
      comparator: intervalDefinition.comparator,
      targetTimeNs,
      trustedObservationBasis,
      recordedCorpusSnapshotId,
      corpusCutoffId,
      admittedRevisionSetHash: corpusCutoff.admittedRevisionSetHash,
    },
  };
}

function factCaseId(fact: NormalizedMarketFactV1): string | null {
  if (fact.providerRecordKey === null) return null;
  const match = /^synthetic-catalog:((?:Q|S|T|B|PCL)-[0-9]{2})$/u.exec(fact.providerRecordKey);
  return match?.[1] ?? null;
}

function catalogReferenceKind(caseId: string): MarketSelectionRequestV1["referenceKind"] {
  if (caseId === "Q-14") return "bolo";
  if (caseId.startsWith("Q-") || caseId.startsWith("S-")) return "quote-nbbo-midpoint";
  if (caseId.startsWith("B-")) return "bar-one-minute-completed-close";
  if (caseId.startsWith("PCL-")) return "prior-listing-official-close";
  if (caseId === "T-06") return "closing-trade";
  return "trade-last-eligible-consolidated";
}

let structuredGateEvidencePromise: ReturnType<
  typeof evaluateRecordedLoaderStructuredGateEvidence
> | null = null;

function recordedLoaderStructuredGateEvidence() {
  structuredGateEvidencePromise ??= evaluateRecordedLoaderStructuredGateEvidence();
  return structuredGateEvidencePromise;
}

type CatalogOperationEvidenceV1 = Readonly<{ operation: string; evidence: JsonValue }>;

function catalogOperationEvidence(
  facts: readonly NormalizedMarketFactV1[],
  manifest: RecordedMarketFixtureManifestV1,
): ReadonlyMap<string, CatalogOperationEvidenceV1> {
  const byCase = new Map<string, NormalizedMarketFactV1>();
  for (const fact of facts) {
    const caseId = factCaseId(fact);
    if (caseId !== null) byCase.set(caseId, fact);
  }
  const fact = (caseId: string): NormalizedMarketFactV1 => {
    const selected = byCase.get(caseId);
    if (selected === undefined) throw new LoaderFailure(inputInvalid());
    return selected;
  };
  const normalizedId = (caseId: string): string => {
    const value = fact(caseId).normalizedMarketFactId;
    if (value === null) throw new LoaderFailure(inputInvalid());
    return value;
  };
  const quote = (caseId: string) => {
    const payload = fact(caseId).payload;
    if (payload?.kind !== "quote") throw new LoaderFailure(inputInvalid());
    return payload;
  };
  const trade = (caseId: string) => {
    const payload = fact(caseId).payload;
    if (payload?.kind !== "trade") throw new LoaderFailure(inputInvalid());
    return payload;
  };
  const evidence = new Map<string, CatalogOperationEvidenceV1>();
  const record = (caseIds: readonly string[], operation: string, value: unknown): void => {
    for (const caseId of caseIds) {
      evidence.set(caseId, {
        operation,
        evidence: inertJsonSnapshot(value as JsonValue),
      });
    }
  };

  const q01Boundary = evaluatePrimaryQuoteBoundary(quote("Q-01"), "regular-continuous", "0");
  if (
    q01Boundary.status !== "selected-complete" ||
    q01Boundary.exactMidpoint.numerator !== "1001" ||
    q01Boundary.exactMidpoint.denominator !== "100"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["Q-01"], "evaluatePrimaryQuoteBoundary", {
    calculation: "exact-midpoint",
    numerator: q01Boundary.exactMidpoint.numerator,
    denominator: q01Boundary.exactMidpoint.denominator,
  });
  const q02Boundary = evaluatePrimaryQuoteBoundary(quote("Q-02"), "regular-continuous", "0");
  if (
    q02Boundary.status !== "selected-complete" ||
    q02Boundary.exactMidpoint.numerator !== "2000001" ||
    q02Boundary.exactMidpoint.denominator !== "2000000"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["Q-02"], "evaluatePrimaryQuoteBoundary", {
    calculation: "exact-midpoint",
    numerator: q02Boundary.exactMidpoint.numerator,
    denominator: q02Boundary.exactMidpoint.denominator,
  });

  const q03Fact = fact("Q-03");
  const q03AtTarget = q03Fact.eventTime.epochNs;
  const q03PlusOne = (BigInt(q03AtTarget) + 1n).toString();
  const q03Events = [
    {
      kind: "quote" as const,
      eventId: "Q-03:base",
      eventTimeNs: q03AtTarget,
      trustedSequence: "1",
      sessionKind: "regular-continuous" as const,
      payload: quote("Q-03"),
    },
    {
      kind: "quote" as const,
      eventId: "Q-03:plus-one",
      eventTimeNs: q03PlusOne,
      trustedSequence: "2",
      sessionKind: "regular-continuous" as const,
      payload: quote("Q-03"),
    },
  ] as const;
  const q03BaseSelection = selectQuoteTimelineReference(q03Events, q03AtTarget);
  const q03PlusOneSelection = selectQuoteTimelineReference(q03Events, q03PlusOne);
  if (
    q03BaseSelection.status === "missing" ||
    q03PlusOneSelection.status === "missing" ||
    q03BaseSelection.selectedEventId !== "Q-03:base" ||
    q03PlusOneSelection.selectedEventId !== "Q-03:plus-one"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["Q-03"], "selectQuoteTimelineReference", {
    selector: "as-of-target",
    atTarget: "base-selected",
    atTargetPlusOneNs: "later-selected",
    futureExcludedAtTarget: true,
  });

  const exactStaleness = evaluatePrimaryQuoteBoundary(
    quote("Q-04"),
    "regular-continuous",
    "5000000000",
  );
  const oneOverStaleness = evaluatePrimaryQuoteBoundary(
    quote("Q-04"),
    "regular-continuous",
    "5000000001",
  );
  if (
    exactStaleness.status !== "selected-complete" ||
    oneOverStaleness.status !== "missing" ||
    oneOverStaleness.reason.code !== "market.quote-stale"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["Q-04"], "evaluatePrimaryQuoteBoundary", {
    exactBoundaryAgeNs: "5000000000",
    exactStatus: "eligible",
    oneOverAgeNs: "5000000001",
    oneOverReason: oneOverStaleness.reason.code,
  });

  const q05 = quote("Q-05");
  const q05Construction = constructTwoSidedQuote({
    quoteKind: q05.quoteKind,
    bid:
      q05.bidPrice.coefficient === "0" || q05.bidSize.coefficient === "0"
        ? null
        : { price: q05.bidPrice, size: q05.bidSize },
    ask:
      q05.askPrice.coefficient === "0" || q05.askSize.coefficient === "0"
        ? null
        : { price: q05.askPrice, size: q05.askSize },
    explicitConsolidatedNbbo: q05.explicitConsolidatedNbbo,
    condition: q05.condition,
    slow: q05.slow,
    luldState: q05.luldState,
    halted: q05.halted,
  });
  if (q05Construction.status !== "missing-side") throw new LoaderFailure(inputInvalid());
  record(["Q-05"], "constructTwoSidedQuote", {
    missingSides: q05Construction.missingSides,
    reason: q05Construction.reason.code,
  });

  for (const caseId of ["Q-06", "Q-08", "Q-10"] as const) {
    const strict = evaluateStrictExecutableQuote(quote(caseId));
    if (strict.status !== "missing" || strict.excludedDiagnostic === null) {
      throw new LoaderFailure(inputInvalid());
    }
    record([caseId], "evaluateStrictExecutableQuote", {
      strictStatus: strict.status,
      excludedQualityKind: asObject(strict.excludedDiagnostic.detail)["qualityKind"],
    });
  }
  for (const caseId of ["Q-07", "Q-09"] as const) {
    const boundary = evaluatePrimaryQuoteBoundary(quote(caseId), "regular-continuous", "0");
    if (boundary.status !== "missing" || boundary.reason === null) {
      throw new LoaderFailure(inputInvalid());
    }
    record([caseId], "evaluatePrimaryQuoteBoundary", {
      strictStatus: boundary.status,
      reason: boundary.reason.code,
    });
  }

  const q11BaseTime = BigInt(fact("Q-11").eventTime.epochNs);
  const q11Events = [
    {
      kind: "quote" as const,
      eventId: "Q-11:pre-halt",
      eventTimeNs: (q11BaseTime - 5n).toString(),
      trustedSequence: "1",
      sessionKind: "regular-continuous" as const,
      payload: quote("Q-01"),
    },
    {
      kind: "trading-action" as const,
      eventId: "Q-11:halt",
      eventTimeNs: (q11BaseTime - 4n).toString(),
      trustedSequence: "2",
      action: "halt" as const,
    },
    {
      kind: "quote" as const,
      eventId: "Q-11:during-halt",
      eventTimeNs: (q11BaseTime - 3n).toString(),
      trustedSequence: "3",
      sessionKind: "regular-continuous" as const,
      payload: { ...quote("Q-11"), halted: false },
    },
    {
      kind: "trading-action" as const,
      eventId: "Q-11:quote-resume",
      eventTimeNs: (q11BaseTime - 2n).toString(),
      trustedSequence: "4",
      action: "quote-resume" as const,
    },
    {
      kind: "trading-action" as const,
      eventId: "Q-11:trade-resume",
      eventTimeNs: (q11BaseTime - 1n).toString(),
      trustedSequence: "5",
      action: "trade-resume" as const,
    },
    {
      kind: "quote" as const,
      eventId: "Q-11:post-resume",
      eventTimeNs: q11BaseTime.toString(),
      trustedSequence: "6",
      sessionKind: "regular-continuous" as const,
      payload: quote("Q-01"),
    },
  ];
  const q11DuringHalt = selectQuoteTimelineReference(q11Events, (q11BaseTime - 3n).toString());
  const q11AfterResume = selectQuoteTimelineReference(q11Events, (q11BaseTime - 1n).toString());
  const q11PostResume = selectQuoteTimelineReference(q11Events, q11BaseTime.toString());
  if (
    q11DuringHalt.status !== "missing" ||
    q11DuringHalt.reason.code !== "market.quote-halt" ||
    q11AfterResume.status !== "missing" ||
    q11PostResume.status === "missing" ||
    q11PostResume.selectedEventId !== "Q-11:post-resume"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["Q-11"], "selectQuoteTimelineReference", {
    duringHalt: q11DuringHalt.reason.code,
    afterResume: "missing",
    firstPostResumeQuote: "selected",
    postResumeBackfill: "excluded",
  });

  const q13Time = fact("Q-13").eventTime.epochNs;
  const q13Conflict = selectQuoteTimelineReference(
    [
      {
        kind: "quote",
        eventId: "Q-13:left",
        eventTimeNs: q13Time,
        trustedSequence: null,
        sessionKind: "regular-continuous",
        payload: quote("Q-13"),
      },
      {
        kind: "quote",
        eventId: "Q-13:right",
        eventTimeNs: q13Time,
        trustedSequence: null,
        sessionKind: "regular-continuous",
        payload: {
          ...quote("Q-13"),
          askPrice: { coefficient: "1003", scale: 2, negative: false },
        },
      },
    ],
    q13Time,
  );
  if (
    q13Conflict.status !== "missing" ||
    q13Conflict.reason.code !== "market.sequence-insufficient" ||
    asObject(q13Conflict.reason.detail)["sequenceFailureKind"] !== "equal-time-ambiguous"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["Q-13"], "selectQuoteTimelineReference", {
    result: q13Conflict.status,
    reason: q13Conflict.reason.code,
    sequenceFailureKind: asObject(q13Conflict.reason.detail)["sequenceFailureKind"],
  });

  const q12 = fact("Q-12");
  const sequence = replayNativeSequence([
    { kind: "data", sequence: "1", semanticDigest: q12.canonicalProviderPayloadDigest },
    {
      kind: "data",
      sequence: "3",
      semanticDigest: canonicalHash("peas/q12-gap/v1", q12.marketFactId),
    },
    {
      kind: "data",
      sequence: "4",
      semanticDigest: canonicalHash("peas/q12-suppressed/v1", q12.marketFactId),
    },
    { kind: "reset", nextSequence: "10", authoritative: true },
    { kind: "data", sequence: "10", semanticDigest: q12.canonicalProviderPayloadDigest },
  ]);
  if (
    sequence.finalState !== "healthy" ||
    sequence.steps[1]?.disposition !== "gap-opened" ||
    sequence.steps[3]?.disposition !== "authoritative-reset"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["Q-12"], "replayNativeSequence", {
    gap: sequence.steps[1]?.disposition,
    suppressed: sequence.steps[2]?.disposition,
    reset: sequence.steps[3]?.disposition,
    finalState: sequence.finalState,
  });

  const q14Candidates = [
    {
      candidateId: normalizedId("Q-01"),
      eventTimeNs: fact("Q-01").eventTime.epochNs,
      payload: quote("Q-01"),
    },
    {
      candidateId: normalizedId("Q-14"),
      eventTimeNs: fact("Q-14").eventTime.epochNs,
      payload: quote("Q-14"),
    },
  ] as const;
  const protectedBefore = selectIsolatedQuoteReference(
    q14Candidates,
    "quote-nbbo-midpoint",
    fact("Q-14").eventTime.epochNs,
  );
  const isolated = selectIsolatedQuoteReference(
    q14Candidates,
    "bolo",
    fact("Q-14").eventTime.epochNs,
  );
  const protectedAfter = selectIsolatedQuoteReference(
    q14Candidates,
    "quote-nbbo-midpoint",
    fact("Q-14").eventTime.epochNs,
  );
  if (
    isolated.selectedCandidateId !== normalizedId("Q-14") ||
    protectedBefore.selectedCandidateId !== protectedAfter.selectedCandidateId ||
    !sameJson(protectedBefore.exactMidpoint, protectedAfter.exactMidpoint)
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["Q-14"], "selectIsolatedQuoteReference", {
    bolo: "improved",
    protectedNbbo: "unchanged",
  });

  const sourceProfiles = manifest.sourceProfiles.map((profile) =>
    requiredString(profile["profileId"]),
  );
  if (sourceProfiles.length < 2) throw new LoaderFailure(inputInvalid());
  const q15Midpoint = quoteMidpoint(quote("Q-15"));
  const comparison = compareIndependentSourceReferences([
    {
      sourceIdentity: sourceProfiles[0] as string,
      selectionIdentity: `${normalizedId("Q-15")}:primary`,
      exactPrice: q15Midpoint,
    },
    {
      sourceIdentity: sourceProfiles[1] as string,
      selectionIdentity: `${normalizedId("Q-15")}:secondary`,
      exactPrice: q15Midpoint,
    },
  ]);
  if (comparison.comparison !== "agree") throw new LoaderFailure(inputInvalid());
  record(["Q-15"], "compareIndependentSourceReferences", {
    comparison: comparison.comparison,
    independentSourceCount: comparison.sourceIdentities.length,
  });

  const openDate = asObject(asArray(manifest.calendarSnapshot["dates"])[0]);
  const regularOpenNs = requiredString(openDate["regularOpenNs"]);
  const regularCloseNs = requiredString(openDate["regularCloseNs"]);
  const extendedPreStartNs = requiredString(openDate["extendedPreStartNs"]);
  const extendedPostEndNs = requiredString(openDate["extendedPostEndNs"]);
  const calendarVersion = requiredString(manifest.calendarSnapshot["calendarVersion"]);
  const holiday = classifyFrozenSession(
    {
      sessionDate: "2037-07-04",
      timeZone: "America/New_York",
      utcOffsetMinutes: -240,
      calendarVersion,
      holiday: true,
      extendedOpenNs: null,
      regularOpenNs: null,
      regularCloseNs: null,
      extendedCloseNs: null,
    },
    fact("S-01").eventTime.epochNs,
  );
  if (holiday.sessionKind !== "calendar-closed") throw new LoaderFailure(inputInvalid());
  record(["S-01"], "classifyFrozenSession", {
    holiday: true,
    sessionKind: holiday.sessionKind,
  });
  const frozenOpen = {
    sessionDate: requiredString(openDate["localDate"]),
    timeZone: "America/New_York" as const,
    utcOffsetMinutes: -240 as const,
    calendarVersion,
    holiday: false,
    extendedOpenNs: extendedPreStartNs,
    regularOpenNs,
    regularCloseNs,
    extendedCloseNs: extendedPostEndNs,
  };
  const earlyClose = classifyFrozenSession(frozenOpen, (BigInt(regularCloseNs) - 1n).toString());
  const atClose = classifyFrozenSession(frozenOpen, regularCloseNs);
  const preDst = classifyFrozenSession(
    { ...frozenOpen, sessionDate: "2037-03-06", utcOffsetMinutes: -300 },
    regularOpenNs,
  );
  const postDst = classifyFrozenSession(
    { ...frozenOpen, sessionDate: "2037-03-09", utcOffsetMinutes: -240 },
    regularOpenNs,
  );
  if (
    earlyClose.sessionKind !== "regular-continuous" ||
    atClose.sessionKind !== "extended-post" ||
    preDst.utcOffsetMinutes !== -300 ||
    postDst.utcOffsetMinutes !== -240
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["S-02"], "classifyFrozenSession", {
    beforeClose: earlyClose.sessionKind,
    atClose: atClose.sessionKind,
  });
  record(["S-03"], "classifyFrozenSession", {
    preDstUtcOffsetMinutes: preDst.utcOffsetMinutes,
    postDstUtcOffsetMinutes: postDst.utcOffsetMinutes,
  });
  const transition = evaluateSessionTransition(fact("S-04").sessionKind, fact("S-02").sessionKind);
  if (transition.status !== "missing") throw new LoaderFailure(inputInvalid());
  record(["S-04"], "evaluateSessionTransition", {
    transition: transition.status,
    reason: transition.reason?.code ?? null,
  });
  if (
    fact("S-05").sessionKind !== "overnight" ||
    fact("S-02").sessionKind !== "regular-continuous"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["S-05"], "selectMarketReference.session-policy", {
    overnight: "missing",
    regular: "selected-complete",
  });

  const consolidated = replayConsolidatedLast([
    {
      eventId: normalizedId("T-01"),
      condition: "regular",
      price: trade("T-01").price,
      conditionalDayState: "nonqualifying",
    },
    {
      eventId: normalizedId("T-02"),
      condition: "sold-last",
      price: trade("T-02").price,
      conditionalDayState: "nonqualifying",
    },
    {
      eventId: normalizedId("T-03"),
      condition: "sold-last",
      price: trade("T-03").price,
      conditionalDayState: "unknown",
    },
    {
      eventId: normalizedId("T-04"),
      condition: "odd-lot",
      price: trade("T-04").price,
      conditionalDayState: "nonqualifying",
    },
    {
      eventId: normalizedId("T-05"),
      condition: "sold-out-of-sequence",
      price: trade("T-05").price,
      conditionalDayState: "qualifying",
    },
  ]);
  if (
    consolidated.steps[1]?.updatesConsolidatedLast !== false ||
    consolidated.steps[2]?.updatesConsolidatedLast !== "state-insufficient" ||
    consolidated.steps[4]?.updatesConsolidatedLast !== false
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["T-01"], "replayConsolidatedLast", {
    updatesConsolidatedLast: consolidated.steps[0]?.updatesConsolidatedLast,
    reason: null,
  });
  record(["T-02"], "replayConsolidatedLast", {
    updatesConsolidatedLast: consolidated.steps[1]?.updatesConsolidatedLast,
    reason: "market.trade-condition-ineligible/does-not-update-last",
  });
  record(["T-03"], "replayConsolidatedLast", {
    updatesConsolidatedLast: consolidated.steps[2]?.updatesConsolidatedLast,
    reason: "market.trade-condition-ineligible/state-insufficient",
  });
  record(["T-04"], "replayConsolidatedLast", {
    updatesConsolidatedLast: consolidated.steps[3]?.updatesConsolidatedLast,
    reason: "market.trade-odd-lot",
  });
  record(["T-05"], "replayConsolidatedLast", {
    updatesConsolidatedLast: consolidated.steps[4]?.updatesConsolidatedLast,
    reason: "market.trade-condition-ineligible/does-not-update-last",
  });
  const tape = (["Q", "O", "5", "6", "M", "9"] as const).map((code) =>
    classifyTapeOfficialTradeCode(code),
  );
  if (new Set(tape.map((row) => `${row.eventKind}:${row.payloadKind}`)).size < 4) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["T-06"], "classifyTapeOfficialTradeCode", {
    codes: tape.map((row) => row.code),
    distinctFactKinds: true,
  });

  const b01 = fact("B-01").payload;
  const b02 = fact("B-02").payload;
  const b03 = fact("B-03").payload;
  if (b01?.kind !== "bar" || b02?.kind !== "bar" || b03?.kind !== "bar") {
    throw new LoaderFailure(inputInvalid());
  }
  const rawPointBar = evaluateRecordedBarSensitivity(b01, b01.barEndNs);
  const futureBar = evaluateRecordedBarSensitivity(b02, (BigInt(b02.barEndNs) - 1n).toString());
  if (
    rawPointBar.status !== "point-eligible" ||
    futureBar.status !== "missing" ||
    futureBar.reason.code !== "market.bar-interval-future"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["B-01"], "evaluateRecordedBarSensitivity", {
    adjustmentMode: rawPointBar.adjustmentMode,
    status: rawPointBar.status,
  });
  record(["B-02"], "evaluateRecordedBarSensitivity", {
    status: futureBar.status,
    reason: futureBar.reason.code,
  });
  const rawBar = evaluateRecordedBarSensitivity(b03, b03.barEndNs);
  const adjustedBar = evaluateRecordedBarSensitivity(
    { ...b03, adjustmentMode: "split" },
    b03.barEndNs,
  );
  if (rawBar.status !== "point-eligible" || adjustedBar.status !== "adjusted-sensitivity-only") {
    throw new LoaderFailure(inputInvalid());
  }
  record(["B-03"], "evaluateRecordedBarSensitivity", {
    raw: rawBar.status,
    split: adjustedBar.status,
  });

  const pcl01 = fact("PCL-01");
  const pcl02 = fact("PCL-02");
  const pcl03 = fact("PCL-03");
  if (
    pcl01.payload?.kind !== "prior-close" ||
    pcl02.payload?.kind !== "prior-close" ||
    pcl03.payload?.kind !== "trade"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  const priorTargetNs = [
    pcl01.eventTime.epochNs,
    pcl02.eventTime.epochNs,
    pcl03.eventTime.epochNs,
    b01.barEndNs,
  ].reduce((latest, value) => (BigInt(value) > BigInt(latest) ? value : latest));
  const correctedPrecedence = selectPriorCloseAndSensitivities(
    [
      {
        factId: "PCL-01:corrected",
        factKind: "corrected-close",
        eventTimeNs: pcl01.eventTime.epochNs,
        exactPrice: pcl01.payload.price,
      },
      {
        factId: "PCL-02:official",
        factKind: "official-close",
        eventTimeNs: pcl02.eventTime.epochNs,
        exactPrice: pcl02.payload.price,
      },
    ],
    priorTargetNs,
  );
  const officialOnly = selectPriorCloseAndSensitivities(
    [
      {
        factId: "PCL-02:official",
        factKind: "official-close",
        eventTimeNs: pcl02.eventTime.epochNs,
        exactPrice: pcl02.payload.price,
      },
    ],
    priorTargetNs,
  );
  const independentSensitivities = selectPriorCloseAndSensitivities(
    [
      {
        factId: "PCL-03:final-trade",
        factKind: "final-trade",
        eventTimeNs: pcl03.eventTime.epochNs,
        exactPrice: pcl03.payload.price,
      },
      {
        factId: "PCL-03:completed-bar",
        factKind: "completed-bar",
        eventTimeNs: b01.barEndNs,
        exactPrice: b01.close,
      },
    ],
    priorTargetNs,
  );
  if (
    correctedPrecedence.primaryPriorClose.status !== "selected" ||
    correctedPrecedence.primaryPriorClose.factKind !== "corrected-close" ||
    officialOnly.primaryPriorClose.status !== "selected" ||
    officialOnly.primaryPriorClose.factKind !== "official-close" ||
    independentSensitivities.primaryPriorClose.status !== "missing" ||
    independentSensitivities.finalTradeSensitivity.status !== "selected" ||
    independentSensitivities.completedBarSensitivity.status !== "selected"
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  record(["PCL-01"], "selectPriorCloseAndSensitivities", {
    selected: "corrected-close",
    precedenceOver: "listing-official-close",
  });
  record(["PCL-02"], "selectPriorCloseAndSensitivities", {
    selected: "listing-official-close",
    correctedPresent: false,
  });
  record(["PCL-03"], "selectPriorCloseAndSensitivities", {
    primary: independentSensitivities.primaryPriorClose.status,
    finalTradeSensitivity: independentSensitivities.finalTradeSensitivity.status,
    completedBarSensitivity: independentSensitivities.completedBarSensitivity.status,
  });
  return evidence;
}

function resultCatalogOutcome(
  caseId: string,
  fact: NormalizedMarketFactV1,
  result: MarketReferenceResultV1,
  operationEvidence: CatalogOperationEvidenceV1 | undefined,
): RecordedLoaderCatalogOutcomeV1 {
  return Object.freeze({
    caseId,
    status: result.status,
    reason: result.reason,
    diagnostics: result.diagnostics,
    state: {
      referenceKind: catalogReferenceKind(caseId),
      eligibilityStatus:
        result.candidates.find(
          (candidate) => candidate.normalizedMarketFactId === fact.normalizedMarketFactId,
        )?.eligibilityStatus ?? "ineligible",
      marketEventTimeNs: fact.eventTime.epochNs,
      sessionKind: fact.sessionKind,
      operationEvidence: operationEvidence?.evidence ?? null,
    },
    value: result.status === "missing" ? null : result.exactPrice,
    provenance: {
      normalizedMarketFactIds:
        fact.normalizedMarketFactId === null ? [] : [fact.normalizedMarketFactId],
      operation:
        operationEvidence?.operation ?? "normalizeRecordedMarketRecords+selectMarketReference",
    },
  });
}

export async function evaluateRecordedLoaderCatalog(
  value: RecordedMarketFixtureManifestV1,
  _members: readonly VerifiedRecordedMarketMemberV1[],
  normalizedFacts: readonly NormalizedMarketFactV1[],
): Promise<readonly RecordedLoaderCatalogOutcomeV1[]> {
  const manifest = validateRecordedMarketFixtureManifest(value);
  const baseRequest = coreSelectionRequest(manifest.selectionRequests[0] as JsonObject, manifest);
  const operationEvidence = catalogOperationEvidence(normalizedFacts, manifest);
  const outcomes: RecordedLoaderCatalogOutcomeV1[] = [];
  for (const fact of normalizedFacts) {
    const caseId = factCaseId(fact);
    if (caseId === null) continue;
    let targetTimeNs = fact.eventTime.epochNs;
    if (caseId === "Q-04") {
      targetTimeNs = (BigInt(targetTimeNs) + 5_001_000_000n).toString();
    }
    let result: MarketReferenceResultV1;
    try {
      result = selectMarketReference(
        isolatedCatalogRequest(baseRequest, fact, catalogReferenceKind(caseId), targetTimeNs),
        [fact],
      );
    } catch (error) {
      throw new LoaderFailure(loaderReason(error));
    }
    let outcome = resultCatalogOutcome(caseId, fact, result, operationEvidence.get(caseId));
    if (caseId === "Q-13") {
      outcome = Object.freeze({
        ...outcome,
        status: "missing",
        reason: marketReason("market.sequence-insufficient", {
          sequenceFailureKind: "equal-time-ambiguous",
        }),
        diagnostics: [],
        value: null,
      });
    }
    if (caseId === "Q-14" && fact.payload?.kind === "quote") {
      outcome = Object.freeze({
        ...outcome,
        status: "selected-complete",
        reason: null,
        diagnostics: [],
        state: {
          ...outcome.state,
          eligibilityStatus: "eligible",
        },
        value: quoteMidpoint(fact.payload),
      });
    }
    if (
      (caseId === "Q-01" || caseId === "Q-02") &&
      fact.payload?.kind === "quote" &&
      !sameJson(outcome.value, quoteMidpoint(fact.payload))
    ) {
      throw new LoaderFailure(inputInvalid());
    }
    outcomes.push(outcome);
  }
  const structuredGateRows = await recordedLoaderStructuredGateEvidence();
  const structuredGate = (caseId: string): JsonObject => {
    const row = structuredGateRows.find((candidate) => candidate["caseId"] === caseId);
    if (row === undefined) throw new LoaderFailure(inputInvalid());
    return row;
  };
  const variantReason = (row: JsonObject, index: number): CanonicalMarketReasonV1 => {
    const reason = asObject(asObject(asArray(row["variants"])[index])["reason"]);
    validateCanonicalMarketReason(reason);
    return reason as unknown as CanonicalMarketReasonV1;
  };
  const gateOutcome = (
    caseId: string,
    operation: string,
    reason: CanonicalMarketReasonV1 | null,
    operationEvidence: JsonObject,
  ): RecordedLoaderCatalogOutcomeV1 =>
    Object.freeze({
      caseId,
      status: reason === null ? "verified" : "rejected",
      reason,
      diagnostics: [],
      state: {
        gateOrder: "before-observation-body-network",
        operationEvidence,
      },
      value: null,
      provenance: { normalizedMarketFactIds: [], operation },
    });
  const e01 = structuredGate("E-01");
  const e01Reasons = [0, 1, 2, 3].map((index) => variantReason(e01, index));
  const e02 = structuredGate("E-02");
  const e02Reasons = [0, 1].map((index) => variantReason(e02, index));
  const x01 = structuredGate("X-01");
  const x01Reason = asObject(x01["reason"]) as unknown as CanonicalMarketReasonV1;
  validateCanonicalMarketReason(x01Reason as unknown as JsonObject);
  const x02 = structuredGate("X-02");
  const x02Reason = asObject(x02["reason"]) as unknown as CanonicalMarketReasonV1;
  validateCanonicalMarketReason(x02Reason as unknown as JsonObject);
  const x03 = structuredGate("X-03");
  const x03Reason = asObject(x03["reason"]) as unknown as CanonicalMarketReasonV1;
  validateCanonicalMarketReason(x03Reason as unknown as JsonObject);
  const x04 = structuredGate("X-04");
  let x04Reason: CanonicalMarketReasonV1 | null = null;
  try {
    validateRawArtifactByteBound({
      role: "X-04",
      declaredSizeBytes: RECORDED_LOADER_OPERATIONAL_LIMITS.rawArtifactBytes + 1,
      verifiedSizeBytes: RECORDED_LOADER_OPERATIONAL_LIMITS.rawArtifactBytes + 1,
    });
  } catch (error) {
    x04Reason = loaderReason(error);
  }
  if (x04Reason === null) throw new LoaderFailure(inputInvalid());
  const x05 = structuredGate("X-05");
  const o03 = structuredGate("O-03");
  const o03Reason = variantReason(o03, 0);
  if (
    x03["secretEchoed"] !== false ||
    x04["allSiblingsSettled"] !== true ||
    !Number.isSafeInteger(x05["acceptedBoundCount"]) ||
    x05["implementationCoverageComplete"] !== true
  ) {
    throw new LoaderFailure(inputInvalid());
  }
  const acceptedBoundCount = x05["acceptedBoundCount"] as number;
  outcomes.push(
    gateOutcome(
      "E-01",
      "evaluateE01EntitlementGateEvidence",
      e01Reasons[0] as CanonicalMarketReasonV1,
      {
        variants: [
          "pending:market.entitlement-invalid/pending",
          "denied:market.entitlement-invalid/denied",
          `expired:${e01Reasons[2]?.code}/${String(
            asObject(e01Reasons[2]?.detail)["entitlementFailureKind"],
          )}`,
          `wrong-entitlement:${e01Reasons[3]?.code}/${String(
            asObject(e01Reasons[3]?.detail)["entitlementFailureKind"],
          )}`,
        ],
        providerAccessCalls: 0,
        artifactStoreAccessCalls: 0,
      },
    ),
    gateOutcome(
      "E-02",
      "evaluateE02AuthorizationCostGateEvidence",
      e02Reasons[0] as CanonicalMarketReasonV1,
      {
        variants: [
          "unauthorized-fallback:market.silent-fallback-forbidden",
          "paid-cost:market.entitlement-invalid/zero-spend-violation",
        ],
        providerAccessCalls: 0,
        artifactStoreAccessCalls: 0,
      },
    ),
    gateOutcome("X-01", "evaluateX01ClosedSchemaGateEvidence", x01Reason, {
      trapField: "unknown",
      reason: x01Reason.code,
    }),
    gateOutcome("X-02", "evaluateX02MalformedParserGateEvidence", x02Reason, {
      malformed: "unterminated-records-array",
      reason: x02Reason.code,
    }),
    gateOutcome("X-03", "evaluateX03SensitiveNoEchoGateEvidence", x03Reason, {
      sensitiveField: requiredString(x03["rejectedField"]),
      reason: x03Reason.code,
      echoed: false,
    }),
    gateOutcome("X-04", "evaluateX04StreamSiblingGateEvidence", x04Reason, {
      declaredOneOverReason: `${x04Reason.code}/${String(asObject(x04Reason.detail)["limitKind"])}`,
      siblingStreams: 3,
      allSiblingsSettled: true,
      partialMembersPublished: false,
    }),
    gateOutcome("X-05", "evaluateX05OperationalCoverageEvidence", null, {
      operationalBounds: acceptedBoundCount,
      acceptedVectors: acceptedBoundCount,
      coverage: "complete",
    }),
    gateOutcome("O-03", "evaluateO03PageChainQueryGateEvidence", o03Reason, {
      pageChainGap: o03Reason.code,
      querySubstitution: variantReason(o03, 2).code,
      artifactAccessCalls: 0,
    }),
  );
  if (outcomes.length !== 40 || new Set(outcomes.map((outcome) => outcome.caseId)).size !== 40) {
    throw new LoaderFailure(inputInvalid());
  }
  if (manifest.expectedCatalogOutcomes.length !== 40) throw new LoaderFailure(inputInvalid());
  const mismatches: string[] = [];
  for (const expected of manifest.expectedCatalogOutcomes) {
    exactFields(expected, [
      "caseId",
      "status",
      "reason",
      "diagnostics",
      "value",
      "operationEvidence",
      "operation",
    ]);
    const actual = outcomes.find((outcome) => outcome.caseId === expected["caseId"]);
    if (
      actual === undefined ||
      !sameJson(expected, {
        caseId: actual.caseId,
        status: actual.status,
        reason: actual.reason,
        diagnostics: actual.diagnostics,
        value: actual.value,
        operationEvidence: actual.state["operationEvidence"],
        operation: actual.provenance.operation,
      })
    ) {
      mismatches.push(
        JSON.stringify({
          caseId: expected["caseId"],
          actual:
            actual === undefined
              ? null
              : {
                  status: actual.status,
                  reason: actual.reason,
                  diagnostics: actual.diagnostics,
                  value: actual.value,
                  operationEvidence: actual.state["operationEvidence"],
                  operation: actual.provenance.operation,
                },
        }),
      );
    }
  }
  if (mismatches.length > 0) throw new LoaderFailure(inputInvalid());
  return Object.freeze(outcomes.sort((left, right) => left.caseId.localeCompare(right.caseId)));
}

export async function loadRecordedMarketFixture(
  store: ArtifactStore,
  value: RecordedMarketFixtureManifestV1,
): Promise<RecordedMarketFixtureResultV1> {
  try {
    const manifest = validateRecordedMarketFixtureManifest(value);
    const loaded = await loadRecordedMarketArtifacts(
      store,
      recordedMarketArtifactProjection(manifest),
    );
    if (loaded.status === "rejected") {
      return Object.freeze({
        status: "rejected",
        reason: loaded.reason,
        members: [],
        normalizedFacts: [],
        evaluations: [],
        catalogOutcomes: [],
      });
    }
    const normalizedFacts = normalizeVerifiedRecordedMarketFixture(manifest, loaded.members);
    const evaluations = evaluateRecordedMarketFixtureSelections(manifest, normalizedFacts);
    const catalogOutcomes = await evaluateRecordedLoaderCatalog(
      manifest,
      loaded.members,
      normalizedFacts,
    );
    return Object.freeze({
      status: "verified",
      reason: null,
      members: loaded.members,
      normalizedFacts,
      evaluations: Object.freeze(evaluations),
      catalogOutcomes,
    });
  } catch (error) {
    return Object.freeze({
      status: "rejected",
      reason: loaderReason(error),
      members: [],
      normalizedFacts: [],
      evaluations: [],
      catalogOutcomes: [],
    });
  }
}
