import { canonicalHash } from "../../core/hash.js";
import {
  assertJsonWithinLimits,
  canonicalJson,
  cloneJson,
  type JsonLimits,
  type JsonValue,
} from "../../core/json.js";
import { snapshotExactNormalizerInput } from "../normalizer-input.js";
import { deriveMarketReferenceJoinKey } from "../observation-ledger.js";
import { validatePrimaryResidualConfiguration, validateProviderCount } from "./bounds.js";
import {
  type CanonicalMarketReasonV1,
  type MarketIntervalDefinitionV1 as ContractMarketIntervalDefinitionV1,
  MARKET_BOUNDS,
  MARKET_CONTRACT_AUTHORITY_REGISTRY_ID,
  MARKET_REFERENCE_KINDS,
  type MarketCandidateOutcomeV1,
  MarketContractError,
  type MarketCorrectionPolicyV1,
  type MarketDiscrepancyPolicyV1,
  type MarketEligibilityPolicyV1,
  type MarketJoinEvidenceV1,
  type MarketProviderPriorityV1,
  type MarketResultAsOfBasisV1,
  type MarketSelectionPolicyPreimageV1,
  type MarketSourceKeyV1,
  type MarketSourcePolicyV1,
  type MarketStalenessPolicyV1,
  type MarketTieBreakPolicyV1,
  marketReason,
  type ProviderDiscrepancyComparisonV1,
  type RecordedCorpusCutoffV1,
  type RecordedCorpusSnapshotV1,
  type RecordedRevisionEvidenceV1,
  type TrustedObservationBasisV1,
  validateCanonicalMarketReason,
} from "./contracts.js";

const IDENTITY_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 250_000,
  maxArrayLength: 10_000,
  maxObjectKeys: MARKET_BOUNDS.sidecarKeysPerObject,
  maxStringBytes: 1_024,
  maxCanonicalBytes: 65_536,
}) satisfies JsonLimits;

const HEX64 = /^[0-9a-f]{64}$/u;
const PREFIXED_ID = /^[a-z][a-z0-9]*1_[0-9a-f]{64}$/u;

function reject(reason: CanonicalMarketReasonV1 = marketReason("market.input-invalid")): never {
  throw new MarketContractError(reason);
}

function snapshotPreimage<T>(value: T): T {
  try {
    assertJsonWithinLimits(value, IDENTITY_LIMITS, "$.marketIdentity");
    return cloneJson(value as unknown as JsonValue) as T;
  } catch (error) {
    if (error instanceof RangeError) {
      reject(
        marketReason("market.bound-exceeded", {
          limitKind: "canonicalRecordBytes",
        }),
      );
    }
    reject();
  }
}

function exactPreimage<T>(value: T, keys: readonly string[]): T {
  try {
    const exact = snapshotExactNormalizerInput(value, keys);
    return snapshotPreimage(exact) as T;
  } catch (error) {
    if (error instanceof MarketContractError) throw error;
    reject();
  }
}

function requirePrefixedId(value: string, prefix?: string): void {
  if (
    typeof value !== "string" ||
    !PREFIXED_ID.test(value) ||
    (prefix !== undefined && !value.startsWith(prefix))
  ) {
    reject(marketReason("market.identity-invalid"));
  }
}

function requireHash(value: string): void {
  if (!HEX64.test(value)) reject(marketReason("market.identity-invalid"));
}

function requireSortedUnique(values: readonly string[]): void {
  if (
    !values.every(
      (value, index) =>
        typeof value === "string" && (index === 0 || (values[index - 1] as string) < value),
    )
  ) {
    reject();
  }
}

function validateTimestampJson(value: JsonValue): void {
  const input = exactPreimage<Record<string, unknown>>(
    value as unknown as Record<string, unknown>,
    ["epochNs", "semantic", "precisionNs"],
  );
  if (
    typeof input["epochNs"] !== "string" ||
    !/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u.test(input["epochNs"]) ||
    typeof input["precisionNs"] !== "string" ||
    !/^[1-9][0-9]*$/u.test(input["precisionNs"]) ||
    ![
      "participant-publication",
      "member-execution",
      "sip-publication",
      "provider-documented-event",
      "provider-receive",
      "earnings-publication",
      "peas-retrieval",
      "peas-durable-capture",
      "correction-effective",
      "correction-arrival",
      "bar-start",
      "bar-end",
      "calendar-boundary",
      "replay-preserved",
    ].includes(input["semantic"] as string)
  ) {
    reject();
  }
}

function validateProviderSequenceJson(value: JsonValue | null): void {
  if (value === null) return;
  const input = exactPreimage<Record<string, unknown>>(
    value as unknown as Record<string, unknown>,
    ["value", "scope", "trustClass"],
  );
  if (
    typeof input["value"] !== "string" ||
    typeof input["scope"] !== "string" ||
    ![
      "native-gap-checked",
      "provider-stable-sequence",
      "native-unchecked",
      "deterministic-artifact-order",
      "none",
    ].includes(input["trustClass"] as string)
  ) {
    reject();
  }
}

function hashCanonicalId<T>(prefix: string, domain: string, value: T): string {
  if (!/^[a-z][a-z0-9]*1_$/u.test(prefix) || !/^peas\/[a-z0-9-]+\/v1$/u.test(domain)) reject();
  const snapshot = snapshotPreimage(value);
  return `${prefix}${canonicalHash(domain, snapshot as unknown as JsonValue)}`;
}

export type MarketIntervalDefinitionV1 = ContractMarketIntervalDefinitionV1;

/** Compatibility export restricted to the one historical external use: exact interval derivation. */
export function deriveCanonicalId(
  prefix: string,
  domain: string,
  value: MarketIntervalDefinitionV1,
): string {
  if (prefix !== "mik1_" || domain !== "peas/market-reference-interval/v1") reject();
  return deriveMarketIntervalKey(value);
}

export function deriveMarketIntervalKey(value: MarketIntervalDefinitionV1): string {
  const input = exactPreimage<MarketIntervalDefinitionV1>(value, [
    "intervalKind",
    "anchorKind",
    "offsetNs",
    "comparator",
    "sessionRule",
  ]);
  const expected = {
    "prior-close": [
      "previous-eligible-listing-session",
      null,
      "authoritative-prior-close",
      "prior-eligible-session",
    ],
    "publication-pre": ["earnings-publication", "0", "strictly-before", "cross-session-allowed"],
    t0: ["h001-selected-basis", "0", "at-or-before", "anchor-session"],
    t1: ["h001-selected-basis", "60000000000", "at-or-before", "same-session-as-t0"],
    t5: ["h001-selected-basis", "300000000000", "at-or-before", "same-session-as-t0"],
    t30: ["h001-selected-basis", "1800000000000", "at-or-before", "same-session-as-t0"],
  } as const;
  const row = expected[input.intervalKind];
  if (
    row === undefined ||
    input.anchorKind !== row[0] ||
    input.offsetNs !== row[1] ||
    input.comparator !== row[2] ||
    input.sessionRule !== row[3]
  ) {
    reject();
  }
  return hashCanonicalId("mik1_", "peas/market-reference-interval/v1", input);
}

export type MarketProviderPreimageV1 = Readonly<{
  providerCode: string;
  serviceOperatorCode: string;
}>;

export function deriveMarketProviderId(value: MarketProviderPreimageV1): string {
  const input = exactPreimage<MarketProviderPreimageV1>(value, [
    "providerCode",
    "serviceOperatorCode",
  ]);
  if (
    typeof input.providerCode !== "string" ||
    typeof input.serviceOperatorCode !== "string" ||
    input.providerCode.length === 0 ||
    input.serviceOperatorCode.length === 0
  ) {
    reject();
  }
  return hashCanonicalId("mpv1_", "peas/market-provider/v1", input);
}

export type EntitlementCapabilityV1 = Readonly<{
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  use:
    | "acquire"
    | "private-retain"
    | "offline-replay"
    | "automated-research"
    | "retain-derived"
    | "publish-aggregate"
    | "redistribute-raw";
  status: "granted" | "pending" | "denied" | "not-authorized";
  maximumRawRetentionDays: number | null;
  survivesTermination: boolean | null;
}>;

export type EntitlementSnapshotPreimageV1 = Readonly<{
  providerId: string;
  productCode: string;
  accountClass: string;
  professionalStatus: string;
  effectiveFromMs: number;
  effectiveToMs: number | null;
  capabilities: readonly EntitlementCapabilityV1[];
  permissionEvidenceHash: string | null;
  humanApprovalId: string | null;
  zeroIncrementalSpend: boolean;
}>;

export function deriveEntitlementSnapshotId(value: EntitlementSnapshotPreimageV1): string {
  const input = exactPreimage<EntitlementSnapshotPreimageV1>(value, [
    "providerId",
    "productCode",
    "accountClass",
    "professionalStatus",
    "effectiveFromMs",
    "effectiveToMs",
    "capabilities",
    "permissionEvidenceHash",
    "humanApprovalId",
    "zeroIncrementalSpend",
  ]);
  requirePrefixedId(input.providerId, "mpv1_");
  if (
    typeof input.productCode !== "string" ||
    typeof input.accountClass !== "string" ||
    typeof input.professionalStatus !== "string" ||
    !Number.isSafeInteger(input.effectiveFromMs) ||
    input.effectiveFromMs < 0 ||
    (input.effectiveToMs !== null &&
      (!Number.isSafeInteger(input.effectiveToMs) ||
        input.effectiveToMs < input.effectiveFromMs)) ||
    typeof input.zeroIncrementalSpend !== "boolean"
  ) {
    reject();
  }
  const capabilities = input.capabilities.map((capability) => {
    const exact = exactPreimage<EntitlementCapabilityV1>(capability, [
      "datasetId",
      "feedId",
      "endpointChannelId",
      "use",
      "status",
      "maximumRawRetentionDays",
      "survivesTermination",
    ]);
    if (
      ![
        "acquire",
        "private-retain",
        "offline-replay",
        "automated-research",
        "retain-derived",
        "publish-aggregate",
        "redistribute-raw",
      ].includes(exact.use) ||
      !["granted", "pending", "denied", "not-authorized"].includes(exact.status) ||
      (exact.maximumRawRetentionDays !== null &&
        (!Number.isSafeInteger(exact.maximumRawRetentionDays) ||
          exact.maximumRawRetentionDays < 0)) ||
      (exact.survivesTermination !== null && typeof exact.survivesTermination !== "boolean")
    ) {
      reject();
    }
    return exact;
  });
  const keys = capabilities.map((capability) =>
    [capability.datasetId, capability.feedId, capability.endpointChannelId, capability.use].join(
      "\u0000",
    ),
  );
  requireSortedUnique(keys);
  if (input.permissionEvidenceHash !== null) requireHash(input.permissionEvidenceHash);
  if (input.humanApprovalId !== null && typeof input.humanApprovalId !== "string") reject();
  return hashCanonicalId("ent1_", "peas/market-entitlement-snapshot/v1", {
    ...input,
    capabilities,
  });
}

export type MarketDatasetPreimageV1 = Readonly<{
  providerId: string;
  assetClass: "us-equity";
  coverageRegion: string;
  productFamily: string;
  apiGeneration: string;
  recordFamily: string;
  datasetDocumentationVersion: string;
}>;

export function deriveMarketDatasetId(value: MarketDatasetPreimageV1): string {
  const input = exactPreimage<MarketDatasetPreimageV1>(value, [
    "providerId",
    "assetClass",
    "coverageRegion",
    "productFamily",
    "apiGeneration",
    "recordFamily",
    "datasetDocumentationVersion",
  ]);
  requirePrefixedId(input.providerId, "mpv1_");
  if (
    input.assetClass !== "us-equity" ||
    [
      input.coverageRegion,
      input.productFamily,
      input.apiGeneration,
      input.recordFamily,
      input.datasetDocumentationVersion,
    ].some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    reject();
  }
  return hashCanonicalId("mds1_", "peas/market-dataset/v1", input);
}

export type MarketFeedPreimageV1 = Readonly<{
  datasetId: string;
  providerFeedCode: string;
  consolidationKind:
    | "sip-consolidated"
    | "single-venue"
    | "provider-aggregate"
    | "derived"
    | "unknown";
  delayClass: "real-time" | "delayed-15m" | "historical" | "provider-defined" | "unknown";
  adjustmentMode:
    | "raw"
    | "split"
    | "dividend"
    | "spin-off"
    | "all"
    | "provider-defined"
    | "unknown";
  correctionRepresentation: "original-stream" | "revision-stream" | "final-corrected" | "unknown";
}>;

export function deriveMarketFeedId(value: MarketFeedPreimageV1): string {
  const input = exactPreimage<MarketFeedPreimageV1>(value, [
    "datasetId",
    "providerFeedCode",
    "consolidationKind",
    "delayClass",
    "adjustmentMode",
    "correctionRepresentation",
  ]);
  requirePrefixedId(input.datasetId, "mds1_");
  if (
    typeof input.providerFeedCode !== "string" ||
    !["sip-consolidated", "single-venue", "provider-aggregate", "derived", "unknown"].includes(
      input.consolidationKind,
    ) ||
    !["real-time", "delayed-15m", "historical", "provider-defined", "unknown"].includes(
      input.delayClass,
    ) ||
    !["raw", "split", "dividend", "spin-off", "all", "provider-defined", "unknown"].includes(
      input.adjustmentMode,
    ) ||
    !["original-stream", "revision-stream", "final-corrected", "unknown"].includes(
      input.correctionRepresentation,
    )
  )
    reject();
  return hashCanonicalId("mfd1_", "peas/market-feed/v1", input);
}

export type EndpointChannelPreimageV1 = Readonly<{
  feedId: string;
  channelKind:
    | "historical-rest"
    | "latest-rest"
    | "snapshot-rest"
    | "websocket"
    | "recorded-synthetic";
  methodKind: "get" | "stream" | "recorded";
  safeRouteLabel: string;
  endpointDocumentationVersion: string;
  paginationKind: "opaque-token" | "none-documented" | "stream-sequence" | "recorded-manifest";
  factKinds: readonly string[];
}>;

export function deriveEndpointChannelId(value: EndpointChannelPreimageV1): string {
  const input = exactPreimage<EndpointChannelPreimageV1>(value, [
    "feedId",
    "channelKind",
    "methodKind",
    "safeRouteLabel",
    "endpointDocumentationVersion",
    "paginationKind",
    "factKinds",
  ]);
  requirePrefixedId(input.feedId, "mfd1_");
  requireSortedUnique(input.factKinds);
  const allowedFacts = new Set([
    "quote",
    "trade",
    "bar",
    "prior-close",
    "status",
    "luld",
    "corporate-action",
    "correction",
    "cancellation",
  ]);
  if (
    input.factKinds.length === 0 ||
    input.factKinds.some((fact) => !allowedFacts.has(fact)) ||
    ![
      "historical-rest",
      "latest-rest",
      "snapshot-rest",
      "websocket",
      "recorded-synthetic",
    ].includes(input.channelKind) ||
    !["get", "stream", "recorded"].includes(input.methodKind) ||
    typeof input.safeRouteLabel !== "string" ||
    typeof input.endpointDocumentationVersion !== "string" ||
    !["opaque-token", "none-documented", "stream-sequence", "recorded-manifest"].includes(
      input.paginationKind,
    )
  )
    reject();
  return hashCanonicalId("mec1_", "peas/market-endpoint-channel/v1", input);
}

export type VenueTapePreimageV1 = Readonly<{
  planCode: "cta" | "utp" | "finra" | "none" | "unknown";
  networkCode: "A" | "B" | "C" | null;
  participantCode: string | null;
  venueCode: string | null;
  protocolName: string;
  protocolVersion: string;
}>;

export function deriveVenueTapeId(value: VenueTapePreimageV1): string {
  const input = exactPreimage<VenueTapePreimageV1>(value, [
    "planCode",
    "networkCode",
    "participantCode",
    "venueCode",
    "protocolName",
    "protocolVersion",
  ]);
  if (
    !["cta", "utp", "finra", "none", "unknown"].includes(input.planCode) ||
    !["A", "B", "C", null].includes(input.networkCode) ||
    (input.participantCode !== null && typeof input.participantCode !== "string") ||
    (input.venueCode !== null && typeof input.venueCode !== "string") ||
    typeof input.protocolName !== "string" ||
    typeof input.protocolVersion !== "string"
  )
    reject();
  return hashCanonicalId("mvt1_", "peas/market-venue-tape/v1", input);
}

export type InstrumentPreimageV1 = Readonly<{
  issuerMappingId: string;
  securityAuthority: string;
  securityKey: string;
  issueType: string;
  shareClass: string;
  primaryListingVenueCode: string;
  currency: string;
  roundLotSize: number;
  effectiveFromNs: string;
  effectiveToNs: string | null;
  predecessorInstrumentId: string | null;
  transitionReason: string | null;
}>;

export function deriveInstrumentId(value: InstrumentPreimageV1): string {
  const input = exactPreimage<InstrumentPreimageV1>(value, [
    "issuerMappingId",
    "securityAuthority",
    "securityKey",
    "issueType",
    "shareClass",
    "primaryListingVenueCode",
    "currency",
    "roundLotSize",
    "effectiveFromNs",
    "effectiveToNs",
    "predecessorInstrumentId",
    "transitionReason",
  ]);
  requirePrefixedId(input.issuerMappingId, "imap1_");
  if (
    [
      input.securityAuthority,
      input.securityKey,
      input.issueType,
      input.shareClass,
      input.primaryListingVenueCode,
      input.currency,
      input.effectiveFromNs,
    ].some((entry) => typeof entry !== "string" || entry.length === 0) ||
    !Number.isSafeInteger(input.roundLotSize) ||
    input.roundLotSize <= 0 ||
    (input.effectiveToNs !== null && typeof input.effectiveToNs !== "string") ||
    (input.predecessorInstrumentId === null) !== (input.transitionReason === null) ||
    (input.transitionReason !== null &&
      ![
        "symbol-change",
        "name-change",
        "split",
        "reverse-split",
        "listing-transfer",
        "share-class-change",
        "merger",
        "spin-off",
        "conversion",
        "adr-ratio-change",
      ].includes(input.transitionReason))
  )
    reject();
  if (input.predecessorInstrumentId !== null)
    requirePrefixedId(input.predecessorInstrumentId, "min1_");
  return hashCanonicalId("min1_", "peas/market-instrument/v1", input);
}

export type MarketAcquisitionPreimageV1 = Readonly<{
  acquisitionObservationId: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  entitlementSnapshotId: string;
  instrumentIds: readonly string[];
  requestedFactKinds: readonly string[];
  queryStartNs: string;
  queryEndNs: string;
  sortOrder: string;
  routePolicyVersion: string;
}>;

export function deriveMarketAcquisitionId(value: MarketAcquisitionPreimageV1): string {
  const input = exactPreimage<MarketAcquisitionPreimageV1>(value, [
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
  requirePrefixedId(input.acquisitionObservationId, "aob1_");
  validateMarketSource({
    providerId: input.providerId,
    datasetId: input.datasetId,
    feedId: input.feedId,
    endpointChannelId: input.endpointChannelId,
    entitlementSnapshotId: input.entitlementSnapshotId,
  });
  requireSortedUnique(input.instrumentIds);
  requireSortedUnique(input.requestedFactKinds);
  if (
    input.instrumentIds.length === 0 ||
    input.instrumentIds.length > 64 ||
    input.instrumentIds.some((id) => !/^min1_[0-9a-f]{64}$/u.test(id)) ||
    input.requestedFactKinds.length === 0 ||
    [input.queryStartNs, input.queryEndNs, input.sortOrder, input.routePolicyVersion].some(
      (entry) => typeof entry !== "string",
    )
  )
    reject();
  return hashCanonicalId("maq1_", "peas/market-acquisition-attempt/v1", input);
}

export type ArtifactContentPreimageV1 = Readonly<{
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  contentEncoding: string;
}>;

export function deriveArtifactContentId(value: ArtifactContentPreimageV1): string {
  const input = exactPreimage<ArtifactContentPreimageV1>(value, [
    "sha256",
    "sizeBytes",
    "mediaType",
    "contentEncoding",
  ]);
  requireHash(input.sha256);
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes < 0 ||
    typeof input.mediaType !== "string" ||
    typeof input.contentEncoding !== "string"
  )
    reject();
  return hashCanonicalId("mac1_", "peas/market-artifact-content/v1", input);
}

export type RawArtifactPreimageV1 = Readonly<{
  artifactContentId: string;
  vaultObservationId: string;
  vaultObservationHash: string;
  acquisitionObservationId: string;
  role: string;
}>;

export function deriveRawArtifactId(value: RawArtifactPreimageV1): string {
  const input = exactPreimage<RawArtifactPreimageV1>(value, [
    "artifactContentId",
    "vaultObservationId",
    "vaultObservationHash",
    "acquisitionObservationId",
    "role",
  ]);
  requirePrefixedId(input.artifactContentId, "mac1_");
  requireHash(input.vaultObservationHash);
  requirePrefixedId(input.acquisitionObservationId, "aob1_");
  if (typeof input.vaultObservationId !== "string" || typeof input.role !== "string") reject();
  return hashCanonicalId("mar1_", "peas/market-raw-artifact/v1", input);
}

export type ProviderObservationPreimageV1 = Readonly<{
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  entitlementSnapshotId: string;
  instrumentId: string;
  venueTapeId: string | null;
  providerRecordKey: string | null;
  providerRevisionKey: string | null;
  eventKind: string;
  eventTime: JsonValue;
  providerSequence: JsonValue | null;
  sequenceSessionDate: string | null;
  canonicalProviderPayloadDigest: string;
}>;

export function deriveProviderObservationId(value: ProviderObservationPreimageV1): string {
  const input = exactPreimage<ProviderObservationPreimageV1>(value, [
    "providerId",
    "datasetId",
    "feedId",
    "endpointChannelId",
    "entitlementSnapshotId",
    "instrumentId",
    "venueTapeId",
    "providerRecordKey",
    "providerRevisionKey",
    "eventKind",
    "eventTime",
    "providerSequence",
    "sequenceSessionDate",
    "canonicalProviderPayloadDigest",
  ]);
  validateMarketSource({
    providerId: input.providerId,
    datasetId: input.datasetId,
    feedId: input.feedId,
    endpointChannelId: input.endpointChannelId,
    entitlementSnapshotId: input.entitlementSnapshotId,
  });
  requirePrefixedId(input.instrumentId, "min1_");
  if (input.venueTapeId !== null) requirePrefixedId(input.venueTapeId, "mvt1_");
  requireHash(input.canonicalProviderPayloadDigest);
  validateTimestampJson(input.eventTime);
  validateProviderSequenceJson(input.providerSequence);
  if (
    (input.providerRecordKey !== null && typeof input.providerRecordKey !== "string") ||
    (input.providerRevisionKey !== null && typeof input.providerRevisionKey !== "string") ||
    typeof input.eventKind !== "string" ||
    (input.sequenceSessionDate !== null && typeof input.sequenceSessionDate !== "string")
  )
    reject();
  return hashCanonicalId("mob1_", "peas/market-provider-observation/v1", input);
}

export type DeliveryPreimageV1 = Readonly<{
  providerObservationId: string;
  marketAcquisitionId: string;
  rawArtifactId: string;
  memberKey: string;
  occurrenceOrdinal: number;
}>;

export function deriveDeliveryId(value: DeliveryPreimageV1): string {
  const input = exactPreimage<DeliveryPreimageV1>(value, [
    "providerObservationId",
    "marketAcquisitionId",
    "rawArtifactId",
    "memberKey",
    "occurrenceOrdinal",
  ]);
  requirePrefixedId(input.providerObservationId, "mob1_");
  requirePrefixedId(input.marketAcquisitionId, "maq1_");
  requirePrefixedId(input.rawArtifactId, "mar1_");
  if (
    typeof input.memberKey !== "string" ||
    !Number.isSafeInteger(input.occurrenceOrdinal) ||
    input.occurrenceOrdinal < 0
  )
    reject();
  return hashCanonicalId("mdl1_", "peas/market-delivery/v1", input);
}

export type RevisionFamilyPreimageV1 = Readonly<{
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  instrumentId: string;
  eventKind: string;
  providerStableRecordFamily: string;
}>;

export function deriveRevisionFamilyId(value: RevisionFamilyPreimageV1): string {
  const input = exactPreimage<RevisionFamilyPreimageV1>(value, [
    "providerId",
    "datasetId",
    "feedId",
    "endpointChannelId",
    "instrumentId",
    "eventKind",
    "providerStableRecordFamily",
  ]);
  requirePrefixedId(input.providerId, "mpv1_");
  requirePrefixedId(input.datasetId, "mds1_");
  requirePrefixedId(input.feedId, "mfd1_");
  requirePrefixedId(input.endpointChannelId, "mec1_");
  requirePrefixedId(input.instrumentId, "min1_");
  if (typeof input.eventKind !== "string" || typeof input.providerStableRecordFamily !== "string")
    reject();
  return hashCanonicalId("mrf1_", "peas/market-revision-family/v1", input);
}

export type MarketFactPreimageV1 = Readonly<{
  instrumentId: string;
  eventKind: string;
  eventTime: JsonValue;
  venueTapeId: string | null;
  sessionKind: string;
  currency: string;
  canonicalPayload: JsonValue;
}>;

export function deriveMarketFactId(value: MarketFactPreimageV1): string {
  const input = exactPreimage<MarketFactPreimageV1>(value, [
    "instrumentId",
    "eventKind",
    "eventTime",
    "venueTapeId",
    "sessionKind",
    "currency",
    "canonicalPayload",
  ]);
  requirePrefixedId(input.instrumentId, "min1_");
  if (input.venueTapeId !== null) requirePrefixedId(input.venueTapeId, "mvt1_");
  if (
    typeof input.eventKind !== "string" ||
    typeof input.sessionKind !== "string" ||
    typeof input.currency !== "string"
  )
    reject();
  validateTimestampJson(input.eventTime);
  return hashCanonicalId("mft1_", "peas/market-fact/v1", input);
}

export type RevisionPreimageV1 = Readonly<{
  revisionFamilyId: string;
  revisionKind: "original" | "correction" | "cancellation";
  providerRevisionKey: string | null;
  supersedesRevisionId: string | null;
  effectiveEventTime: JsonValue | null;
  marketFactId: string | null;
}>;

export function deriveRevisionId(value: RevisionPreimageV1): string {
  const input = exactPreimage<RevisionPreimageV1>(value, [
    "revisionFamilyId",
    "revisionKind",
    "providerRevisionKey",
    "supersedesRevisionId",
    "effectiveEventTime",
    "marketFactId",
  ]);
  requirePrefixedId(input.revisionFamilyId, "mrf1_");
  if (!["original", "correction", "cancellation"].includes(input.revisionKind)) reject();
  if (input.providerRevisionKey !== null && typeof input.providerRevisionKey !== "string") reject();
  if (input.revisionKind === "original") {
    if (input.supersedesRevisionId !== null || input.marketFactId === null) reject();
  } else {
    if (input.supersedesRevisionId === null) reject();
    requirePrefixedId(input.supersedesRevisionId, "mrv1_");
    if (input.revisionKind === "cancellation" && input.marketFactId !== null) reject();
    if (input.revisionKind === "correction" && input.marketFactId === null) reject();
  }
  if (input.marketFactId !== null) requirePrefixedId(input.marketFactId, "mft1_");
  if (input.effectiveEventTime !== null) validateTimestampJson(input.effectiveEventTime);
  return hashCanonicalId("mrv1_", "peas/market-revision/v1", input);
}

export type NormalizedMarketFactPreimageV1 = Readonly<{
  marketFactId: string;
  providerObservationId: string;
  revisionId: string;
  normalizerVersion: string;
  conditionPolicyVersion: string;
  calendarVersion: string;
  parserContractVersion: string;
}>;

export function deriveNormalizedMarketFactId(value: NormalizedMarketFactPreimageV1): string {
  const input = exactPreimage<NormalizedMarketFactPreimageV1>(value, [
    "marketFactId",
    "providerObservationId",
    "revisionId",
    "normalizerVersion",
    "conditionPolicyVersion",
    "calendarVersion",
    "parserContractVersion",
  ]);
  requirePrefixedId(input.marketFactId, "mft1_");
  requirePrefixedId(input.providerObservationId, "mob1_");
  requirePrefixedId(input.revisionId, "mrv1_");
  if (
    [
      input.normalizerVersion,
      input.conditionPolicyVersion,
      input.calendarVersion,
      input.parserContractVersion,
    ].some((entry) => typeof entry !== "string")
  )
    reject();
  return hashCanonicalId("mnf1_", "peas/market-normalized-fact/v1", input);
}

export function deriveCandidateSetHash(candidates: readonly MarketCandidateOutcomeV1[]): string {
  const input = snapshotPreimage(candidates);
  if (!Array.isArray(input)) reject();
  const exact = input.map((candidate) => {
    const row = exactPreimage<MarketCandidateOutcomeV1>(candidate, [
      "providerObservationId",
      "revisionId",
      "normalizedMarketFactId",
      "eligibilityStatus",
      "reason",
      "diagnostics",
    ]);
    requirePrefixedId(row.providerObservationId, "mob1_");
    requirePrefixedId(row.revisionId, "mrv1_");
    requirePrefixedId(row.normalizedMarketFactId, "mnf1_");
    if (!["eligible", "degraded", "ineligible"].includes(row.eligibilityStatus)) reject();
    if (row.reason !== null) validateCanonicalMarketReason(row.reason);
    row.diagnostics.forEach(validateCanonicalMarketReason);
    return row;
  });
  requireSortedUnique(
    exact.map(
      (row) =>
        `${row.providerObservationId}\u0000${row.revisionId}\u0000${row.normalizedMarketFactId}`,
    ),
  );
  return canonicalHash("peas/market-candidate-set/v1", exact as unknown as JsonValue);
}

export type SelectedReferencePreimageV1 = Readonly<{
  marketReferenceJoinKey: string;
  intervalKey: string;
  referenceKind: string;
  selectionPolicyId: string;
  asOfBasis: MarketResultAsOfBasisV1;
  resultStatus: "selected-complete" | "selected-degraded";
  selectedNormalizedMarketFactId: string;
  selectedRevisionId: string;
  candidateSetHash: string;
  diagnostics: readonly CanonicalMarketReasonV1[];
}>;

export function deriveSelectedReferenceId(value: SelectedReferencePreimageV1): string {
  const input = exactPreimage<SelectedReferencePreimageV1>(value, [
    "marketReferenceJoinKey",
    "intervalKey",
    "referenceKind",
    "selectionPolicyId",
    "asOfBasis",
    "resultStatus",
    "selectedNormalizedMarketFactId",
    "selectedRevisionId",
    "candidateSetHash",
    "diagnostics",
  ]);
  requirePrefixedId(input.marketReferenceJoinKey, "mrj1_");
  requirePrefixedId(input.intervalKey, "mik1_");
  requirePrefixedId(input.selectionPolicyId, "msp1_");
  requirePrefixedId(input.selectedNormalizedMarketFactId, "mnf1_");
  requirePrefixedId(input.selectedRevisionId, "mrv1_");
  requireHash(input.candidateSetHash);
  if (
    !MARKET_REFERENCE_KINDS.includes(input.referenceKind as never) ||
    !["selected-complete", "selected-degraded"].includes(input.resultStatus)
  )
    reject();
  validateMarketResultAsOfBasis(input.asOfBasis);
  input.diagnostics.forEach(validateCanonicalMarketReason);
  return hashCanonicalId("msr1_", "peas/market-selected-reference/v1", input);
}

export type MissingReferencePreimageV1 = Readonly<{
  marketReferenceJoinKey: string;
  intervalKey: string;
  referenceKind: string;
  selectionPolicyId: string;
  asOfBasis: MarketResultAsOfBasisV1;
  resultStatus: "missing";
  reason: CanonicalMarketReasonV1;
  candidateSetHash: string;
}>;

export function deriveMissingReferenceId(value: MissingReferencePreimageV1): string {
  const input = exactPreimage<MissingReferencePreimageV1>(value, [
    "marketReferenceJoinKey",
    "intervalKey",
    "referenceKind",
    "selectionPolicyId",
    "asOfBasis",
    "resultStatus",
    "reason",
    "candidateSetHash",
  ]);
  requirePrefixedId(input.marketReferenceJoinKey, "mrj1_");
  requirePrefixedId(input.intervalKey, "mik1_");
  requirePrefixedId(input.selectionPolicyId, "msp1_");
  requireHash(input.candidateSetHash);
  if (
    !MARKET_REFERENCE_KINDS.includes(input.referenceKind as never) ||
    input.resultStatus !== "missing"
  )
    reject();
  validateMarketResultAsOfBasis(input.asOfBasis);
  validateCanonicalMarketReason(input.reason);
  return hashCanonicalId("mmr1_", "peas/market-missing-reference/v1", input);
}

export type ProviderDiscrepancyPreimageV1 = Readonly<{
  marketReferenceJoinKey: string;
  intervalKey: string;
  referenceKind: string;
  selectionPolicyId: string;
  providerResultIds: readonly string[];
  discrepancyPolicy: MarketDiscrepancyPolicyV1;
  comparisonResult: ProviderDiscrepancyComparisonV1;
}>;

export function deriveProviderDiscrepancyId(value: ProviderDiscrepancyPreimageV1): string {
  const input = exactPreimage<ProviderDiscrepancyPreimageV1>(value, [
    "marketReferenceJoinKey",
    "intervalKey",
    "referenceKind",
    "selectionPolicyId",
    "providerResultIds",
    "discrepancyPolicy",
    "comparisonResult",
  ]);
  requirePrefixedId(input.marketReferenceJoinKey, "mrj1_");
  requirePrefixedId(input.intervalKey, "mik1_");
  requirePrefixedId(input.selectionPolicyId, "msp1_");
  if (!MARKET_REFERENCE_KINDS.includes(input.referenceKind as never)) reject();
  requireSortedUnique(input.providerResultIds);
  if (input.providerResultIds.length < 2) reject();
  input.providerResultIds.forEach((id) => {
    if (!id.startsWith("msr1_") && !id.startsWith("mmr1_")) reject();
    requirePrefixedId(id);
  });
  validateDiscrepancyPolicy(input.discrepancyPolicy);
  if (!["agree", "disagree", "not-comparable"].includes(input.comparisonResult)) reject();
  return hashCanonicalId("mdp1_", "peas/market-provider-discrepancy/v1", input);
}

export function validateMarketSource(value: MarketSourceKeyV1): void {
  const input = exactPreimage<MarketSourceKeyV1>(value, [
    "providerId",
    "datasetId",
    "feedId",
    "endpointChannelId",
    "entitlementSnapshotId",
  ]);
  requirePrefixedId(input.providerId, "mpv1_");
  requirePrefixedId(input.datasetId, "mds1_");
  requirePrefixedId(input.feedId, "mfd1_");
  requirePrefixedId(input.endpointChannelId, "mec1_");
  requirePrefixedId(input.entitlementSnapshotId, "ent1_");
}

function requireExactArray(actual: readonly string[], expected: readonly string[]): void {
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    reject();
  }
}

function canonicalSource(source: MarketSourceKeyV1): string {
  validateMarketSource(source);
  return canonicalJson(source as unknown as JsonValue);
}

function validateSourcePolicy(value: MarketSourcePolicyV1): MarketSourcePolicyV1 {
  const input = exactPreimage<MarketSourcePolicyV1>(value, [
    "policyVersion",
    "authorizationMode",
    "primarySource",
    "comparisonSources",
    "fallbackKind",
    "selectionIsolation",
  ]);
  if (
    input.policyVersion !== "market-source-policy-v1" ||
    !["p1-09-approved", "synthetic-offline-only"].includes(input.authorizationMode) ||
    input.fallbackKind !== "none" ||
    input.selectionIsolation !== "per-source"
  ) {
    reject();
  }
  const primary = canonicalSource(input.primarySource);
  const comparisons = input.comparisonSources.map(canonicalSource);
  requireSortedUnique(comparisons);
  if (comparisons.includes(primary)) reject();
  return input;
}

function validateProviderPriority(value: MarketProviderPriorityV1): void {
  const input = exactPreimage<MarketProviderPriorityV1>(value, [
    "policyVersion",
    "entries",
    "missingPrimaryBehavior",
  ]);
  if (
    input.policyVersion !== "market-provider-priority-v1" ||
    input.missingPrimaryBehavior !== "typed-missing-no-fallback" ||
    input.entries.length === 0
  ) {
    reject();
  }
  validateProviderCount(input.entries.length);
  let primaryCount = 0;
  const sourceKeys: string[] = [];
  for (const [index, entry] of input.entries.entries()) {
    const exact = exactPreimage(entry, ["source", "role", "rank"]);
    const sourceKey = canonicalSource(exact.source);
    if (exact.rank !== index || !["primary", "discrepancy-only"].includes(exact.role)) {
      reject();
    }
    if (exact.role === "primary") primaryCount += 1;
    sourceKeys.push(sourceKey);
  }
  if (primaryCount !== 1 || new Set(sourceKeys).size !== sourceKeys.length) reject();
}

function validateEligibilityPolicy(value: MarketEligibilityPolicyV1): void {
  const input = exactPreimage<MarketEligibilityPolicyV1>(value, [
    "policyVersion",
    "referenceKinds",
    "primaryReferenceKind",
    "currency",
    "completeWindowRequired",
    "referenceSubstitution",
    "unknownConditionBehavior",
    "strictExecutableDiagnostics",
  ]);
  if (
    input.policyVersion !== "market-eligibility-v1" ||
    input.primaryReferenceKind !== "quote-nbbo-midpoint" ||
    input.currency !== "USD" ||
    input.completeWindowRequired !== true ||
    input.referenceSubstitution !== "forbidden" ||
    input.unknownConditionBehavior !== "ineligible"
  ) {
    reject();
  }
  requireExactArray(input.referenceKinds, MARKET_REFERENCE_KINDS);
  requireExactArray(input.strictExecutableDiagnostics, ["locked", "luld-limit-state", "slow"]);
}

function validateStalenessPolicy(value: MarketStalenessPolicyV1): void {
  const input = exactPreimage<MarketStalenessPolicyV1>(value, [
    "policyVersion",
    "regularQuoteAgeNs",
    "extendedQuoteAgeNs",
    "regularTradeAgeNs",
    "extendedTradeAgeNs",
    "completedBarAgeNs",
    "boundary",
    "negativeAgeBehavior",
    "overnightPrimaryAgeNs",
  ]);
  if (
    input.policyVersion !== "market-staleness-v1" ||
    input.regularQuoteAgeNs !== "5000000000" ||
    input.extendedQuoteAgeNs !== "30000000000" ||
    input.regularTradeAgeNs !== "5000000000" ||
    input.extendedTradeAgeNs !== "30000000000" ||
    input.completedBarAgeNs !== "60000000000" ||
    input.boundary !== "inclusive" ||
    input.negativeAgeBehavior !== "ineligible" ||
    input.overnightPrimaryAgeNs !== null
  ) {
    reject();
  }
}

function validateCorrectionPolicy(value: MarketCorrectionPolicyV1): void {
  const input = exactPreimage<MarketCorrectionPolicyV1>(value, [
    "policyVersion",
    "primaryCorpusSnapshotId",
    "corpusCutoffId",
    "viewKind",
    "admissionKind",
    "correctedOffsetNs",
    "finalCorrectedOnlyBehavior",
  ]);
  requirePrefixedId(input.primaryCorpusSnapshotId, "mcs1_");
  requirePrefixedId(input.corpusCutoffId, "mcc1_");
  if (
    input.policyVersion !== "market-correction-policy-v1" ||
    (input.viewKind === "recorded-primary"
      ? input.admissionKind !== "member-of-primary-recorded-corpus" ||
        input.correctedOffsetNs !== null ||
        input.finalCorrectedOnlyBehavior !== "recorded-primary-unavailable"
      : input.viewKind !== "recorded-corrected" ||
        input.admissionKind !== "member-of-primary-or-durably-recorded-by-corrected-cutoff" ||
        input.correctedOffsetNs !== "604800000000000" ||
        input.finalCorrectedOnlyBehavior !== "recorded-corrected-only-if-corpus-closed-by-cutoff")
  ) {
    reject();
  }
}

function validateTieBreakPolicy(value: MarketTieBreakPolicyV1): void {
  const input = exactPreimage<MarketTieBreakPolicyV1>(value, [
    "policyVersion",
    "trustedOrder",
    "identicalEconomicRepresentative",
    "unresolvedDifferingState",
    "forbiddenOrders",
  ]);
  if (
    input.policyVersion !== "market-tie-break-v1" ||
    input.identicalEconomicRepresentative !== "smallest-normalized-market-fact-id" ||
    input.unresolvedDifferingState !== "market.sequence-insufficient/equal-time-ambiguous"
  ) {
    reject();
  }
  requireExactArray(input.trustedOrder, [
    "source-native-total-order",
    "identical-economic-state",
    "missing",
  ]);
  requireExactArray(input.forbiddenOrders, [
    "arrival",
    "artifact",
    "hash",
    "page",
    "provider-priority",
    "row",
  ]);
}

function validateDiscrepancyPolicy(value: MarketDiscrepancyPolicyV1): void {
  const input = exactPreimage<MarketDiscrepancyPolicyV1>(value, [
    "policyVersion",
    "comparisonKind",
    "compareIndependentSources",
    "equalValueMergesProvenance",
    "missingBehavior",
    "disagreementChangesPrimary",
  ]);
  if (
    input.policyVersion !== "market-discrepancy-v1" ||
    input.comparisonKind !== "exact-reduced-rational" ||
    input.compareIndependentSources !== true ||
    input.equalValueMergesProvenance !== false ||
    input.missingBehavior !== "not-comparable" ||
    input.disagreementChangesPrimary !== false
  ) {
    reject();
  }
}

export function deriveSelectionPolicyId(value: MarketSelectionPolicyPreimageV1): string {
  const input = exactPreimage<MarketSelectionPolicyPreimageV1>(value, [
    "contractAuthorityRegistryId",
    "primaryAnchorKind",
    "alternateAnchorKind",
    "alternateAnchorRequired",
    "intervalDefinitions",
    "targetSelector",
    "publicationOriginSelector",
    "sourcePolicy",
    "providerPriority",
    "eligibilityPolicy",
    "stalenessPolicy",
    "correctionPolicy",
    "tieBreakPolicy",
    "discrepancyPolicy",
    "reasonCatalogId",
    "boundsPolicyId",
  ]);
  if (
    input.contractAuthorityRegistryId !== MARKET_CONTRACT_AUTHORITY_REGISTRY_ID ||
    input.primaryAnchorKind !== "capture" ||
    input.alternateAnchorKind !== "retrieval" ||
    input.alternateAnchorRequired !== true ||
    input.targetSelector !== "last-eligible-at-or-before" ||
    input.publicationOriginSelector !== "last-eligible-strictly-before-publication" ||
    input.reasonCatalogId !== "market-reasons-v1" ||
    input.boundsPolicyId !== "market-reference-bounds-v1"
  ) {
    reject();
  }
  const intervalIds = input.intervalDefinitions.map(deriveMarketIntervalKey);
  requireSortedUnique(intervalIds);
  if (intervalIds.length !== 6) reject();
  const residuals = input.intervalDefinitions
    .filter((definition) => ["t0", "t1", "t5", "t30"].includes(definition.intervalKind))
    .sort(
      (left, right) =>
        ["t0", "t1", "t5", "t30"].indexOf(left.intervalKind) -
        ["t0", "t1", "t5", "t30"].indexOf(right.intervalKind),
    );
  validatePrimaryResidualConfiguration(
    residuals.map((definition) => definition.intervalKind.toUpperCase()),
    BigInt(residuals.at(-1)?.offsetNs ?? "-1"),
  );
  validateSourcePolicy(input.sourcePolicy);
  validateProviderPriority(input.providerPriority);
  const primaryEntries = input.providerPriority.entries.filter((entry) => entry.role === "primary");
  const discrepancyEntries = input.providerPriority.entries.filter(
    (entry) => entry.role === "discrepancy-only",
  );
  if (
    primaryEntries.length !== 1 ||
    primaryEntries[0]?.rank !== 0 ||
    canonicalSource(primaryEntries[0].source) !== canonicalSource(input.sourcePolicy.primarySource)
  ) {
    reject();
  }
  const priorityDiscrepancySources = discrepancyEntries
    .map((entry) => canonicalSource(entry.source))
    .sort();
  const policyComparisonSources = input.sourcePolicy.comparisonSources.map(canonicalSource).sort();
  if (
    canonicalJson(priorityDiscrepancySources) !== canonicalJson(policyComparisonSources) ||
    discrepancyEntries.some((entry) => entry.rank === 0)
  ) {
    reject();
  }
  validateEligibilityPolicy(input.eligibilityPolicy);
  validateStalenessPolicy(input.stalenessPolicy);
  validateCorrectionPolicy(input.correctionPolicy);
  validateTieBreakPolicy(input.tieBreakPolicy);
  validateDiscrepancyPolicy(input.discrepancyPolicy);
  return hashCanonicalId("msp1_", "peas/market-selection-policy/v1", input);
}

function validateRevisionEvidence(value: RecordedRevisionEvidenceV1): RecordedRevisionEvidenceV1 {
  const input = exactPreimage<RecordedRevisionEvidenceV1>(value, [
    "revisionId",
    "deliveryId",
    "rawArtifactId",
    "durablyRecordedAtMs",
    "logicalAtMs",
    "clockBasisId",
    "durableEvidenceHash",
  ]);
  requirePrefixedId(input.revisionId, "mrv1_");
  requirePrefixedId(input.deliveryId, "mdl1_");
  requirePrefixedId(input.rawArtifactId, "mar1_");
  if (
    !Number.isSafeInteger(input.durablyRecordedAtMs) ||
    input.durablyRecordedAtMs < 0 ||
    !Number.isSafeInteger(input.logicalAtMs) ||
    input.logicalAtMs < 0 ||
    typeof input.clockBasisId !== "string" ||
    input.clockBasisId.length === 0
  ) {
    reject();
  }
  if (
    input.durableEvidenceHash !==
    deriveDurableRevisionEvidenceHash({
      revisionId: input.revisionId,
      deliveryId: input.deliveryId,
      rawArtifactId: input.rawArtifactId,
      durablyRecordedAtMs: input.durablyRecordedAtMs,
      logicalAtMs: input.logicalAtMs,
      clockBasisId: input.clockBasisId,
    })
  ) {
    reject(marketReason("market.identity-invalid"));
  }
  return input;
}

export type DurableRevisionEvidencePreimageV1 = Omit<
  RecordedRevisionEvidenceV1,
  "durableEvidenceHash"
>;

export function deriveDurableRevisionEvidenceHash(
  value: DurableRevisionEvidencePreimageV1,
): string {
  const input = exactPreimage<DurableRevisionEvidencePreimageV1>(value, [
    "revisionId",
    "deliveryId",
    "rawArtifactId",
    "durablyRecordedAtMs",
    "logicalAtMs",
    "clockBasisId",
  ]);
  requirePrefixedId(input.revisionId, "mrv1_");
  requirePrefixedId(input.deliveryId, "mdl1_");
  requirePrefixedId(input.rawArtifactId, "mar1_");
  if (
    !Number.isSafeInteger(input.durablyRecordedAtMs) ||
    input.durablyRecordedAtMs < 0 ||
    !Number.isSafeInteger(input.logicalAtMs) ||
    input.logicalAtMs < 0 ||
    typeof input.clockBasisId !== "string" ||
    input.clockBasisId.length === 0
  ) {
    reject();
  }
  return canonicalHash("peas/market-durable-revision-evidence/v1", input as unknown as JsonValue);
}

export function deriveRecordedCorpusSnapshotId(value: RecordedCorpusSnapshotV1): string {
  const input = exactPreimage<RecordedCorpusSnapshotV1>(value, [
    "schemaVersion",
    "marketReferenceJoinKey",
    "sourcePolicy",
    "marketAcquisitionIds",
    "rawArtifactIds",
    "providerObservationIds",
    "revisionEvidence",
    "corpusClosedAtMs",
    "corpusClosedLogicalAtMs",
    "corpusClockBasisId",
    "corpusClosureEvidenceHash",
  ]);
  if (input.schemaVersion !== 1) reject();
  requirePrefixedId(input.marketReferenceJoinKey, "mrj1_");
  validateSourcePolicy(input.sourcePolicy);
  requireSortedUnique(input.marketAcquisitionIds);
  requireSortedUnique(input.rawArtifactIds);
  requireSortedUnique(input.providerObservationIds);
  input.marketAcquisitionIds.forEach((id) => {
    requirePrefixedId(id, "maq1_");
  });
  input.rawArtifactIds.forEach((id) => {
    requirePrefixedId(id, "mar1_");
  });
  input.providerObservationIds.forEach((id) => {
    requirePrefixedId(id, "mob1_");
  });
  const evidence = input.revisionEvidence.map(validateRevisionEvidence);
  requireSortedUnique(evidence.map((row) => `${row.revisionId}\u0000${row.deliveryId}`));
  if (
    !Number.isSafeInteger(input.corpusClosedAtMs) ||
    input.corpusClosedAtMs < 0 ||
    !Number.isSafeInteger(input.corpusClosedLogicalAtMs) ||
    input.corpusClosedLogicalAtMs < 0 ||
    typeof input.corpusClockBasisId !== "string" ||
    input.corpusClockBasisId.length === 0
  ) {
    reject();
  }
  requireHash(input.corpusClosureEvidenceHash);
  return hashCanonicalId("mcs1_", "peas/market-recorded-corpus/v1", input);
}

export function deriveAdmittedRevisionSetHash(revisionIds: readonly string[]): string {
  const input = snapshotPreimage(revisionIds);
  if (!Array.isArray(input)) reject();
  requireSortedUnique(input);
  input.forEach((id) => {
    requirePrefixedId(id, "mrv1_");
  });
  return canonicalHash("peas/market-admitted-revision-set/v1", input as unknown as JsonValue);
}

export function deriveRecordedCorpusCutoffId(value: RecordedCorpusCutoffV1): string {
  const input = exactPreimage<RecordedCorpusCutoffV1>(value, [
    "corpusSnapshotId",
    "cutoffObservationEvidenceHash",
    "admittedRevisionSetHash",
    "viewKind",
    "cutoffKind",
    "cutoffTargetNs",
  ]);
  requirePrefixedId(input.corpusSnapshotId, "mcs1_");
  requireHash(input.cutoffObservationEvidenceHash);
  requireHash(input.admittedRevisionSetHash);
  if (
    input.viewKind === "recorded-primary"
      ? input.cutoffKind !== "primary-corpus-closure" || input.cutoffTargetNs !== null
      : input.viewKind !== "recorded-corrected" ||
        input.cutoffKind !== "capture-t0-plus-seven-days" ||
        typeof input.cutoffTargetNs !== "string" ||
        !/^(?:0|[1-9][0-9]*)$/u.test(input.cutoffTargetNs)
  ) {
    reject();
  }
  return hashCanonicalId("mcc1_", "peas/market-corpus-cutoff/v1", input);
}

export function admittedRevisionIds(
  corpus: RecordedCorpusSnapshotV1,
  cutoff: RecordedCorpusCutoffV1,
): readonly string[] {
  const corpusId = deriveRecordedCorpusSnapshotId(corpus);
  if (cutoff.corpusSnapshotId !== corpusId) reject(marketReason("market.identity-invalid"));
  const target =
    cutoff.viewKind === "recorded-primary" ? null : BigInt(cutoff.cutoffTargetNs) / 1_000_000n;
  const ids = [
    ...new Set(
      corpus.revisionEvidence
        .filter((row) => target === null || BigInt(row.durablyRecordedAtMs) <= target)
        .map((row) => row.revisionId),
    ),
  ].sort();
  const hash = deriveAdmittedRevisionSetHash(ids);
  if (hash !== cutoff.admittedRevisionSetHash) reject(marketReason("market.identity-invalid"));
  deriveRecordedCorpusCutoffId(cutoff);
  return Object.freeze(ids);
}

export type ValidatedMarketSelectionAuthorityV1 = Readonly<{
  selectionPolicyId: string;
  recordedCorpusSnapshotId: string;
  corpusCutoffId: string;
  admittedRevisionSetHash: string;
}>;

export function deriveValidatedMarketSelectionAuthority(value: {
  selectionPolicy: MarketSelectionPolicyPreimageV1;
  recordedCorpus: RecordedCorpusSnapshotV1;
  corpusCutoff: RecordedCorpusCutoffV1;
}): ValidatedMarketSelectionAuthorityV1 {
  const input = exactPreimage<{
    selectionPolicy: MarketSelectionPolicyPreimageV1;
    recordedCorpus: RecordedCorpusSnapshotV1;
    corpusCutoff: RecordedCorpusCutoffV1;
  }>(value, ["selectionPolicy", "recordedCorpus", "corpusCutoff"]);
  const recordedCorpusSnapshotId = deriveRecordedCorpusSnapshotId(input.recordedCorpus);
  const corpusCutoffId = deriveRecordedCorpusCutoffId(input.corpusCutoff);
  admittedRevisionIds(input.recordedCorpus, input.corpusCutoff);
  if (
    input.corpusCutoff.corpusSnapshotId !== recordedCorpusSnapshotId ||
    input.selectionPolicy.correctionPolicy.primaryCorpusSnapshotId !== recordedCorpusSnapshotId ||
    input.selectionPolicy.correctionPolicy.corpusCutoffId !== corpusCutoffId ||
    input.selectionPolicy.correctionPolicy.viewKind !== input.corpusCutoff.viewKind ||
    canonicalJson(input.selectionPolicy.sourcePolicy as unknown as JsonValue) !==
      canonicalJson(input.recordedCorpus.sourcePolicy as unknown as JsonValue)
  ) {
    reject(marketReason("market.identity-invalid"));
  }
  return Object.freeze({
    selectionPolicyId: deriveSelectionPolicyId(input.selectionPolicy),
    recordedCorpusSnapshotId,
    corpusCutoffId,
    admittedRevisionSetHash: input.corpusCutoff.admittedRevisionSetHash,
  });
}

function validateTrustedObservationBasis(
  value: TrustedObservationBasisV1,
): TrustedObservationBasisV1 {
  if (value.basisKind === "capture") {
    const input = exactPreimage(value, [
      "basisKind",
      "eventId",
      "receivedAtMs",
      "logicalAtMs",
      "clockBasisId",
    ]);
    if (
      typeof input.eventId !== "string" ||
      input.eventId.length === 0 ||
      !Number.isSafeInteger(input.receivedAtMs) ||
      input.receivedAtMs < 0 ||
      !Number.isSafeInteger(input.logicalAtMs) ||
      input.logicalAtMs < 0 ||
      typeof input.clockBasisId !== "string" ||
      input.clockBasisId.length === 0
    ) {
      reject();
    }
    return input;
  }
  if (value.basisKind === "retrieval") {
    const input = exactPreimage(value, [
      "basisKind",
      "role",
      "acquisitionObservationId",
      "vaultObservationId",
      "retrievedAtMs",
      "clockBasisId",
    ]);
    if (
      [
        input.role,
        input.acquisitionObservationId,
        input.vaultObservationId,
        input.clockBasisId,
      ].some((entry) => typeof entry !== "string" || entry.length === 0) ||
      !Number.isSafeInteger(input.retrievedAtMs) ||
      input.retrievedAtMs < 0
    ) {
      reject();
    }
    return input;
  }
  reject();
}

export function validateMarketResultAsOfBasis(
  value: MarketResultAsOfBasisV1,
): MarketResultAsOfBasisV1 {
  const input = exactPreimage<MarketResultAsOfBasisV1>(value, [
    "anchorRole",
    "trustedObservationBasis",
    "targetTimeNs",
    "comparator",
    "viewKind",
    "recordedCorpusSnapshotId",
    "corpusCutoffId",
    "admittedRevisionSetHash",
  ]);
  const basis = validateTrustedObservationBasis(input.trustedObservationBasis);
  if (
    !/^(?:0|[1-9][0-9]*)$/u.test(input.targetTimeNs) ||
    !["authoritative-prior-close", "strictly-before", "at-or-before"].includes(input.comparator) ||
    !["recorded-primary", "recorded-corrected"].includes(input.viewKind) ||
    (input.anchorRole === "h001-primary-durable-capture"
      ? basis.basisKind !== "capture"
      : input.anchorRole !== "h001-mandatory-retrieval-sensitivity" ||
        basis.basisKind !== "retrieval")
  ) {
    reject(marketReason("market.anchor-policy-invalid"));
  }
  requirePrefixedId(input.recordedCorpusSnapshotId, "mcs1_");
  requirePrefixedId(input.corpusCutoffId, "mcc1_");
  requireHash(input.admittedRevisionSetHash);
  return Object.freeze({ ...input, trustedObservationBasis: basis });
}

export function validateMarketJoinEvidence(value: MarketJoinEvidenceV1): MarketJoinEvidenceV1 {
  const snapshot = exactPreimage<MarketJoinEvidenceV1>(value, [
    "subject",
    "issuerMappingId",
    "selectedSourceObservationId",
    "selectedSourceVersionIdentity",
    "trustedObservationBasis",
    "marketReferenceJoinKey",
  ]);
  const actual = deriveMarketReferenceJoinKey({
    subject: snapshot.subject,
    issuerMappingId: snapshot.issuerMappingId,
    selectedSourceObservationId: snapshot.selectedSourceObservationId,
    selectedSourceVersionIdentity: snapshot.selectedSourceVersionIdentity,
    trustedObservationBasis: snapshot.trustedObservationBasis,
  });
  if (actual !== snapshot.marketReferenceJoinKey) {
    reject(marketReason("market.identity-invalid"));
  }
  return Object.freeze(snapshot);
}

export function deriveValidatedMarketReferenceJoinKey(value: {
  subject: string;
  issuerMappingId: string;
  selectedSourceObservationId: string;
  selectedSourceVersionIdentity: string;
  trustedObservationBasis: TrustedObservationBasisV1;
}): MarketJoinEvidenceV1 {
  const marketReferenceJoinKey = deriveMarketReferenceJoinKey(value);
  return validateMarketJoinEvidence({ ...value, marketReferenceJoinKey });
}
