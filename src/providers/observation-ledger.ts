import { canonicalHash } from "../core/hash.js";
import {
  assertJsonWithinLimits,
  canonicalJson,
  cloneJson,
  type JsonLimits,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";

export const OBSERVATION_LEDGER_ENTRY_DOMAIN = "peas/observation-ledger-entry/v1";
export const OBSERVATION_CLOCK_BASIS_DOMAIN = "peas/clock-basis/v1";
export const OBSERVATION_ISSUER_MAPPING_DOMAIN = "peas/issuer-mapping/v1";
export const OBSERVATION_ACQUISITION_DOMAIN = "peas/acquisition-observation/v1";
export const OBSERVATION_RAW_EVIDENCE_SET_DOMAIN = "peas/raw-evidence-set/v1";
export const OBSERVATION_PROJECTION_DIGEST_DOMAIN = "peas/provider-derived-content/v1";
export const OBSERVATION_PROJECTION_DOMAIN = "peas/provider-derived-projection/v1";
export const OBSERVATION_SOURCE_RECORD_DOMAIN = "peas/provider-source-record/v1";
export const OBSERVATION_SOURCE_VERSION_DOMAIN = "peas/provider-source-version/v1";
export const OBSERVATION_REVISION_FAMILY_DOMAIN = "peas/provider-revision-family/v1";
export const OBSERVATION_SOURCE_OBSERVATION_DOMAIN = "peas/normalized-source-observation/v1";
export const OBSERVATION_MARKET_JOIN_DOMAIN = "peas/market-reference-join/v1";
export const OBSERVATION_LEDGER_ENTRY_MAX_BYTES = 64 * 1024;
export const OBSERVATION_LEDGER_BUNDLE_MAX_BYTES = 64 * 1024 * 1024;
export const OBSERVATION_LEDGER_MAX_ENTRIES = 4_096;
export const OBSERVATION_LEDGER_MAX_EDGES = 12_279;
export const OBSERVATION_LEDGER_MAX_PARENTS = 32;
export const OBSERVATION_LEDGER_MAX_CAUSAL_DEPTH = 16;
export const OBSERVATION_LEDGER_MAX_CLOCK_BASES = 32;
export const OBSERVATION_LEDGER_MAX_RAW_LINKS = 16;
export const OBSERVATION_LEDGER_MAX_SYMBOLS = 8;
export const OBSERVATION_LEDGER_MAX_ENTRIES_PER_ACQUISITION = 32;
export const OBSERVATION_LEDGER_MAX_PROJECTIONS_PER_SUBJECT = 32;
export const OBSERVATION_LEDGER_PAGE_SIZE_MIN = 1;
export const OBSERVATION_LEDGER_PAGE_SIZE_MAX = 10_000;

const HASH = /^[0-9a-f]{64}$/u;
const ENTRY_ID = /^ole1_[0-9a-f]{64}$/u;
const CLOCK_ID = /^clk1_[0-9a-f]{64}$/u;
const CIK = /^\d{10}$/u;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,7}$/u;
const IDENTIFIER_MAX_BYTES = 512;

export const OBSERVATION_LEDGER_ENTRY_LIMITS = Object.freeze({
  maxDepth: 8,
  maxNodes: 512,
  maxArrayLength: 32,
  maxObjectKeys: 64,
  maxStringBytes: 4 * 1024,
  maxCanonicalBytes: OBSERVATION_LEDGER_ENTRY_MAX_BYTES,
}) satisfies JsonLimits;

export type ClockBasisV1 = Readonly<{
  clockBasisId: string;
  wallClock: "system-utc" | "recorded-fixture" | "replayed-original";
  synchronization: "verified-bound" | "operator-asserted" | "unspecified" | "not-applicable";
  maximumErrorMs: number | null;
  monotonicClock: "process-monotonic-us" | "none";
  monotonicSessionId: string | null;
}>;

export type ClockStampV1 =
  | Readonly<{ clockBasisId: null; wallTimeMs: null; monotonicTimeUs: null }>
  | Readonly<{ clockBasisId: string; wallTimeMs: number; monotonicTimeUs: number | null }>;

export type IssuerMappingV1 = Readonly<{
  issuerMappingId: string;
  issuerCik: string;
  symbols: readonly string[];
  selectedSymbol: string | null;
  mappingAuthority: string;
  mappingVersion: string;
  effectiveFromMs: number | null;
  effectiveToMs: number | null;
}>;

export type RawArtifactLinkV1 = Readonly<{
  role: string;
  acquisitionObservationId: string;
  vaultObservationId: string;
  vaultObservationHash: string;
  artifactDigest: string;
  sizeBytes: number;
}>;

export type SourceIdentityV1 = Readonly<{
  provider: string;
  source: string;
  sourceKind: "sec_8k" | "filing" | "fmp_release" | "issuer_release";
  providerRecordId: string;
  providerRevisionId: string;
  sourceRecordIdentity: string;
  sourceVersionIdentity: string;
  revisionFamilyIdentity: string;
  supersedesSourceVersionIdentity: string | null;
}>;

export type PublicationTimeV1 =
  | Readonly<{
      publishedAtMs: null;
      timestampConfidence: "unknown";
      originalTimestamp: null;
    }>
  | Readonly<{
      publishedAtMs: number;
      timestampConfidence: "exact" | "provider";
      originalTimestamp: string;
    }>
  | Readonly<{
      publishedAtMs: number;
      timestampConfidence: "inferred";
      originalTimestamp: string | null;
    }>;

export type TrustedObservationBasisV1 =
  | Readonly<{
      basisKind: "capture";
      eventId: string;
      receivedAtMs: number;
      logicalAtMs: number;
      clockBasisId: string;
    }>
  | Readonly<{
      basisKind: "retrieval";
      role: string;
      acquisitionObservationId: string;
      vaultObservationId: string;
      retrievedAtMs: number;
      clockBasisId: string;
    }>;

export type ObservationLedgerFactsV1 = Readonly<
  | { kind: "clock-basis.declared"; clockBasis: ClockBasisV1 }
  | {
      kind: "acquisition.declared";
      acquisitionObservationId: string;
      provider: string;
      retrievalAttemptId: string;
      sanitizedRequestIdentityHash: string;
      routeLabel: string;
    }
  | { kind: "request.started"; acquisitionObservationId: string }
  | {
      kind: "request.succeeded";
      acquisitionObservationId: string;
      safeResponseMetadataHash: string;
    }
  | {
      kind: "artifact.committed";
      acquisitionObservationId: string;
      vaultObservationId: string;
      vaultObservationHash: string;
      artifactDigest: string;
      sizeBytes: number;
      acquisitionMode: "live" | "recorded" | "replay";
      retrievedAtMs: number | null;
    }
  | {
      kind: "artifact.verified";
      acquisitionObservationId: string;
      vaultObservationId: string;
      artifactDigest: string;
      metadataSizeBytes: number;
      consumedSizeBytes: number;
    }
  | {
      kind: "normalization.emitted";
      projectionId: string;
      projectionDigest: string;
      sourceObservationId: string;
      sourceIdentity: SourceIdentityV1;
      publicationTime: PublicationTimeV1;
      issuerMapping: IssuerMappingV1;
      subject: string;
      fiscalPeriod: string;
      evidenceBundleHash: string | null;
      primaryArtifactHash: string;
      primaryArtifactKind: "raw-artifact" | "derived-projection";
      rawArtifactLinks: readonly RawArtifactLinkV1[];
      loaderIdentity: string;
      selectionHash: string;
      loaderTranscriptHash: string;
      normalizerIdentity: string;
      normalizerTranscriptHash: string;
      eventDraftHash: string;
    }
  | {
      kind: "normalization.ignored";
      rawArtifactLinks: readonly RawArtifactLinkV1[];
      loaderIdentity: string;
      selectionHash: string;
      loaderTranscriptHash: string;
      normalizerIdentity: string;
      normalizerTranscriptHash: string;
      reasonCode: string;
    }
  | {
      kind: "normalization.quarantined";
      rawArtifactLinks: readonly RawArtifactLinkV1[];
      loaderIdentity: string;
      selectionHash: string;
      loaderTranscriptHash: string;
      normalizerIdentity: string | null;
      normalizerTranscriptHash: string | null;
      reasonCode: string;
    }
  | {
      kind: "capture.appended" | "capture.redelivered";
      sourceObservationId: string;
      sourceVersionIdentity: string;
      eventId: string;
      eventHash: string;
      position: number;
      receivedAtMs: number;
      logicalAtMs: number;
    }
  | {
      kind: "selection.recorded";
      purpose: "cluster-first-observation" | "analysis-branch-input" | "market-reference-anchor";
      selectionBasis: "capture" | "retrieval";
      trustedObservationBasis: TrustedObservationBasisV1;
      selectedSourceObservationId: string;
      selectedSourceVersionIdentity: string;
      subject: string;
      issuerMappingId: string;
      asOfMs: number;
      branchId: string | null;
      marketReferenceJoinKey: string | null;
    }
  | {
      kind: "failure.recorded";
      stage:
        | "request"
        | "artifact-store"
        | "verified-read"
        | "normalization"
        | "capture"
        | "selection";
      failedAfter:
        | "acquisition.declared"
        | "request.started"
        | "request.succeeded"
        | "artifact.committed"
        | "artifact.verified"
        | "normalization.emitted"
        | "capture.appended"
        | "capture.redelivered";
      acquisitionObservationId: string | null;
      sourceObservationId: string | null;
      reasonCode: string;
      detailHash: string | null;
    }
  | {
      kind: "clock.regression";
      priorEntryId: string;
      regressingEntryId: string;
      priorWallTimeMs: number;
      currentWallTimeMs: number;
      monotonicOrderPreserved: boolean;
    }
>;

export type ObservationLedgerEntryV1 = Readonly<{
  schemaVersion: 1;
  executionId: string;
  entryId: string;
  parentEntryIds: readonly string[];
  clock: ClockStampV1;
  facts: ObservationLedgerFactsV1;
  entryHash: string;
}>;

export type ObservationLedgerEntryInputV1 = Omit<ObservationLedgerEntryV1, "entryId" | "entryHash">;

export class ObservationLedgerContractError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = "ObservationLedgerContractError";
  }
}

function fail(reasonCode: string): never {
  throw new ObservationLedgerContractError(reasonCode);
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function safeInteger(value: unknown, nullable = false): value is number | null {
  return (nullable && value === null) || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function boundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= IDENTIFIER_MAX_BYTES
  );
}

function exactKeys(value: object, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("observation.entry-invalid");
  }
}

function sortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] as string) < value);
}

export function deriveClockBasisId(value: Omit<ClockBasisV1, "clockBasisId">): string {
  return `clk1_${canonicalHash(OBSERVATION_CLOCK_BASIS_DOMAIN, asJson(value))}`;
}

export function createClockBasis(value: Omit<ClockBasisV1, "clockBasisId">): ClockBasisV1 {
  const basis: ClockBasisV1 = { ...value, clockBasisId: deriveClockBasisId(value) };
  validateClockBasis(basis);
  return Object.freeze(basis);
}

export function deriveIssuerMappingId(value: Omit<IssuerMappingV1, "issuerMappingId">): string {
  return `imap1_${canonicalHash(OBSERVATION_ISSUER_MAPPING_DOMAIN, asJson(value))}`;
}

export function createIssuerMapping(
  value: Omit<IssuerMappingV1, "issuerMappingId">,
): IssuerMappingV1 {
  const mapping: IssuerMappingV1 = { ...value, issuerMappingId: deriveIssuerMappingId(value) };
  validateIssuerMapping(mapping);
  return Object.freeze(mapping);
}

export function deriveAcquisitionObservationId(value: {
  provider: string;
  retrievalAttemptId: string;
  sanitizedRequestIdentityHash: string;
  routeLabel: string;
}): string {
  return `aob1_${canonicalHash(OBSERVATION_ACQUISITION_DOMAIN, asJson(value))}`;
}

export function deriveProjectionDigest(canonicalProjection: JsonValue): string {
  return canonicalHash(OBSERVATION_PROJECTION_DIGEST_DOMAIN, canonicalProjection);
}

export function deriveRawEvidenceSetHash(rawArtifactLinks: readonly RawArtifactLinkV1[]): string {
  const members = rawArtifactLinks
    .map((link) => ({ role: link.role, artifactDigest: link.artifactDigest }))
    .sort((left, right) =>
      left.role === right.role
        ? left.artifactDigest < right.artifactDigest
          ? -1
          : left.artifactDigest > right.artifactDigest
            ? 1
            : 0
        : left.role < right.role
          ? -1
          : 1,
    );
  return canonicalHash(OBSERVATION_RAW_EVIDENCE_SET_DOMAIN, members);
}

export function deriveProjectionId(value: {
  loaderIdentity: string;
  normalizerIdentity: string;
  rawArtifactLinks: readonly RawArtifactLinkV1[];
  projectionDigest: string;
}): string {
  return `prj1_${canonicalHash(OBSERVATION_PROJECTION_DOMAIN, {
    loaderIdentity: value.loaderIdentity,
    normalizerIdentity: value.normalizerIdentity,
    rawEvidenceSetHash: deriveRawEvidenceSetHash(value.rawArtifactLinks),
    projectionDigest: value.projectionDigest,
  })}`;
}

export function deriveSourceRecordIdentity(value: {
  provider: string;
  source: string;
  providerRecordId: string;
}): string {
  return `src1_${canonicalHash(OBSERVATION_SOURCE_RECORD_DOMAIN, value)}`;
}

export function deriveSourceVersionIdentity(value: {
  sourceRecordIdentity: string;
  providerRevisionId: string;
  projectionDigest: string;
  evidenceBundleHash: string | null;
}): string {
  return `svr1_${canonicalHash(OBSERVATION_SOURCE_VERSION_DOMAIN, value)}`;
}

export function deriveRevisionFamilyIdentity(value: {
  provider: string;
  source: string;
  providerStableRecordFamily: string;
}): string {
  return `rvf1_${canonicalHash(OBSERVATION_REVISION_FAMILY_DOMAIN, value)}`;
}

export function deriveSourceObservationId(value: {
  sourceVersionIdentity: string;
  projectionId: string;
  rawArtifactLinks: readonly RawArtifactLinkV1[];
}): string {
  const sortedUniqueAcquisitionObservationIds = [
    ...new Set(value.rawArtifactLinks.map((link) => link.acquisitionObservationId)),
  ].sort();
  return `sob1_${canonicalHash(OBSERVATION_SOURCE_OBSERVATION_DOMAIN, {
    sourceVersionIdentity: value.sourceVersionIdentity,
    projectionId: value.projectionId,
    sortedUniqueAcquisitionObservationIds,
  })}`;
}

export function deriveMarketReferenceJoinKey(value: {
  subject: string;
  issuerMappingId: string;
  selectedSourceObservationId: string;
  selectedSourceVersionIdentity: string;
  trustedObservationBasis: TrustedObservationBasisV1;
}): string {
  return `mrj1_${canonicalHash(OBSERVATION_MARKET_JOIN_DOMAIN, value)}`;
}

function validateClockBasis(value: ClockBasisV1): void {
  exactKeys(value, [
    "clockBasisId",
    "wallClock",
    "synchronization",
    "maximumErrorMs",
    "monotonicClock",
    "monotonicSessionId",
  ]);
  if (
    !CLOCK_ID.test(value.clockBasisId) ||
    !["system-utc", "recorded-fixture", "replayed-original"].includes(value.wallClock) ||
    !["verified-bound", "operator-asserted", "unspecified", "not-applicable"].includes(
      value.synchronization,
    ) ||
    !["process-monotonic-us", "none"].includes(value.monotonicClock)
  ) {
    fail("observation.clock-basis-invalid");
  }
  const preimage = {
    wallClock: value.wallClock,
    synchronization: value.synchronization,
    maximumErrorMs: value.maximumErrorMs,
    monotonicClock: value.monotonicClock,
    monotonicSessionId: value.monotonicSessionId,
  } as const;
  if (deriveClockBasisId(preimage) !== value.clockBasisId) {
    fail("observation.clock-basis-invalid");
  }
  const recorded =
    value.wallClock === "recorded-fixture" || value.wallClock === "replayed-original";
  if (recorded !== (value.synchronization === "not-applicable")) {
    fail("observation.clock-basis-invalid");
  }
  if (
    (value.synchronization === "verified-bound") !==
    (safeInteger(value.maximumErrorMs) && value.maximumErrorMs !== null)
  ) {
    fail("observation.clock-basis-invalid");
  }
  if (
    (value.monotonicClock === "none" && value.monotonicSessionId !== null) ||
    (value.monotonicClock === "process-monotonic-us" &&
      !boundedIdentifier(value.monotonicSessionId))
  ) {
    fail("observation.clock-basis-invalid");
  }
}

function validateIssuerMapping(value: IssuerMappingV1): void {
  exactKeys(value, [
    "issuerMappingId",
    "issuerCik",
    "symbols",
    "selectedSymbol",
    "mappingAuthority",
    "mappingVersion",
    "effectiveFromMs",
    "effectiveToMs",
  ]);
  if (!CIK.test(value.issuerCik) || value.symbols.length < 1 || value.symbols.length > 8) {
    fail("observation.issuer-mapping-invalid");
  }
  if (!sortedUnique(value.symbols) || value.symbols.some((symbol) => !SYMBOL.test(symbol))) {
    fail("observation.issuer-mapping-invalid");
  }
  if (value.selectedSymbol !== null && !value.symbols.includes(value.selectedSymbol)) {
    fail("observation.issuer-mapping-invalid");
  }
  if (
    !boundedIdentifier(value.mappingAuthority) ||
    !boundedIdentifier(value.mappingVersion) ||
    !safeInteger(value.effectiveFromMs, true) ||
    !safeInteger(value.effectiveToMs, true) ||
    (value.effectiveFromMs !== null &&
      value.effectiveToMs !== null &&
      value.effectiveFromMs >= value.effectiveToMs)
  ) {
    fail("observation.issuer-mapping-invalid");
  }
  const { issuerMappingId: _, ...preimage } = value;
  if (deriveIssuerMappingId(preimage) !== value.issuerMappingId) {
    fail("observation.issuer-mapping-invalid");
  }
}

function validateClockStamp(value: ClockStampV1): void {
  exactKeys(value, ["clockBasisId", "wallTimeMs", "monotonicTimeUs"]);
  if (value.clockBasisId === null) {
    if (value.wallTimeMs !== null || value.monotonicTimeUs !== null) {
      fail("observation.clock-basis-invalid");
    }
    return;
  }
  if (
    !CLOCK_ID.test(value.clockBasisId) ||
    !safeInteger(value.wallTimeMs) ||
    !safeInteger(value.monotonicTimeUs, true)
  ) {
    fail("observation.clock-basis-invalid");
  }
}

function compareRawLinks(left: RawArtifactLinkV1, right: RawArtifactLinkV1): number {
  for (const field of ["role", "acquisitionObservationId", "vaultObservationId"] as const) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }
  return 0;
}

function validateRawArtifactLinks(value: readonly RawArtifactLinkV1[]): void {
  if (value.length < 1 || value.length > 16) fail("observation.entry-invalid");
  const roles = new Set<string>();
  for (const [index, link] of value.entries()) {
    exactKeys(link, [
      "role",
      "acquisitionObservationId",
      "vaultObservationId",
      "vaultObservationHash",
      "artifactDigest",
      "sizeBytes",
    ]);
    if (
      !boundedIdentifier(link.role) ||
      !/^aob1_[0-9a-f]{64}$/u.test(link.acquisitionObservationId) ||
      !HASH.test(link.vaultObservationId) ||
      !HASH.test(link.vaultObservationHash) ||
      !HASH.test(link.artifactDigest) ||
      !safeInteger(link.sizeBytes) ||
      roles.has(link.role) ||
      (index > 0 && compareRawLinks(value[index - 1] as RawArtifactLinkV1, link) >= 0)
    ) {
      fail("observation.entry-invalid");
    }
    roles.add(link.role);
  }
}

function validatePublicationTime(value: PublicationTimeV1): void {
  exactKeys(value, ["publishedAtMs", "timestampConfidence", "originalTimestamp"]);
  if (!["unknown", "exact", "provider", "inferred"].includes(value.timestampConfidence)) {
    fail("observation.entry-invalid");
  }
  if (value.timestampConfidence === "unknown") {
    if (value.publishedAtMs !== null || value.originalTimestamp !== null) {
      fail("observation.entry-invalid");
    }
    return;
  }
  if (!safeInteger(value.publishedAtMs)) fail("observation.entry-invalid");
  if (
    (value.timestampConfidence === "exact" || value.timestampConfidence === "provider") &&
    (typeof value.originalTimestamp !== "string" || value.originalTimestamp.length === 0)
  ) {
    fail("observation.entry-invalid");
  }
  if (
    value.originalTimestamp !== null &&
    Buffer.byteLength(value.originalTimestamp, "utf8") > 256
  ) {
    fail("observation.entry-invalid");
  }
}

function validateSourceIdentity(
  value: SourceIdentityV1,
  projectionDigest: string,
  evidenceBundleHash: string | null,
): void {
  exactKeys(value, [
    "provider",
    "source",
    "sourceKind",
    "providerRecordId",
    "providerRevisionId",
    "sourceRecordIdentity",
    "sourceVersionIdentity",
    "revisionFamilyIdentity",
    "supersedesSourceVersionIdentity",
  ]);
  if (
    !boundedIdentifier(value.provider) ||
    !boundedIdentifier(value.source) ||
    !boundedIdentifier(value.providerRecordId) ||
    !boundedIdentifier(value.providerRevisionId) ||
    !["sec_8k", "filing", "fmp_release", "issuer_release"].includes(value.sourceKind)
  ) {
    fail("observation.entry-invalid");
  }
  const sourceRecordIdentity = deriveSourceRecordIdentity({
    provider: value.provider,
    source: value.source,
    providerRecordId: value.providerRecordId,
  });
  const sourceVersionIdentity = deriveSourceVersionIdentity({
    sourceRecordIdentity,
    providerRevisionId: value.providerRevisionId,
    projectionDigest,
    evidenceBundleHash,
  });
  const revisionFamilyIdentity = deriveRevisionFamilyIdentity({
    provider: value.provider,
    source: value.source,
    providerStableRecordFamily: value.providerRecordId,
  });
  if (
    value.sourceRecordIdentity !== sourceRecordIdentity ||
    value.sourceVersionIdentity !== sourceVersionIdentity ||
    value.revisionFamilyIdentity !== revisionFamilyIdentity ||
    (value.supersedesSourceVersionIdentity !== null &&
      !/^svr1_[0-9a-f]{64}$/u.test(value.supersedesSourceVersionIdentity))
  ) {
    fail("observation.derived-identity-mismatch");
  }
}

function validateNormalizationCommon(value: {
  rawArtifactLinks: readonly RawArtifactLinkV1[];
  loaderIdentity: string;
  selectionHash: string;
  loaderTranscriptHash: string;
}): void {
  validateRawArtifactLinks(value.rawArtifactLinks);
  if (
    !boundedIdentifier(value.loaderIdentity) ||
    !HASH.test(value.selectionHash) ||
    !HASH.test(value.loaderTranscriptHash)
  ) {
    fail("observation.entry-invalid");
  }
}

function validateFacts(value: ObservationLedgerFactsV1): void {
  if (!boundedIdentifier(value.kind)) fail("observation.entry-invalid");
  switch (value.kind) {
    case "clock-basis.declared":
      exactKeys(value, ["kind", "clockBasis"]);
      validateClockBasis(value.clockBasis);
      return;
    case "acquisition.declared":
      exactKeys(value, [
        "kind",
        "acquisitionObservationId",
        "provider",
        "retrievalAttemptId",
        "sanitizedRequestIdentityHash",
        "routeLabel",
      ]);
      if (
        !boundedIdentifier(value.provider) ||
        !boundedIdentifier(value.retrievalAttemptId) ||
        !HASH.test(value.sanitizedRequestIdentityHash) ||
        !boundedIdentifier(value.routeLabel)
      ) {
        fail("observation.entry-invalid");
      }
      if (
        value.acquisitionObservationId !==
        deriveAcquisitionObservationId({
          provider: value.provider,
          retrievalAttemptId: value.retrievalAttemptId,
          sanitizedRequestIdentityHash: value.sanitizedRequestIdentityHash,
          routeLabel: value.routeLabel,
        })
      ) {
        fail("observation.derived-identity-mismatch");
      }
      return;
    case "request.started":
      exactKeys(value, ["kind", "acquisitionObservationId"]);
      return;
    case "request.succeeded":
      exactKeys(value, ["kind", "acquisitionObservationId", "safeResponseMetadataHash"]);
      if (!HASH.test(value.safeResponseMetadataHash)) fail("observation.entry-invalid");
      return;
    case "artifact.committed":
      exactKeys(value, [
        "kind",
        "acquisitionObservationId",
        "vaultObservationId",
        "vaultObservationHash",
        "artifactDigest",
        "sizeBytes",
        "acquisitionMode",
        "retrievedAtMs",
      ]);
      if (
        !HASH.test(value.vaultObservationId) ||
        !HASH.test(value.vaultObservationHash) ||
        !HASH.test(value.artifactDigest) ||
        !safeInteger(value.sizeBytes) ||
        !safeInteger(value.retrievedAtMs, true) ||
        !["live", "recorded", "replay"].includes(value.acquisitionMode)
      ) {
        fail("observation.entry-invalid");
      }
      return;
    case "artifact.verified":
      exactKeys(value, [
        "kind",
        "acquisitionObservationId",
        "vaultObservationId",
        "artifactDigest",
        "metadataSizeBytes",
        "consumedSizeBytes",
      ]);
      if (
        !HASH.test(value.vaultObservationId) ||
        !HASH.test(value.artifactDigest) ||
        !safeInteger(value.metadataSizeBytes) ||
        value.metadataSizeBytes !== value.consumedSizeBytes
      ) {
        fail("observation.entry-invalid");
      }
      return;
    case "normalization.emitted": {
      exactKeys(value, [
        "kind",
        "projectionId",
        "projectionDigest",
        "sourceObservationId",
        "sourceIdentity",
        "publicationTime",
        "issuerMapping",
        "subject",
        "fiscalPeriod",
        "evidenceBundleHash",
        "primaryArtifactHash",
        "primaryArtifactKind",
        "rawArtifactLinks",
        "loaderIdentity",
        "selectionHash",
        "loaderTranscriptHash",
        "normalizerIdentity",
        "normalizerTranscriptHash",
        "eventDraftHash",
      ]);
      validateIssuerMapping(value.issuerMapping);
      validatePublicationTime(value.publicationTime);
      validateNormalizationCommon(value);
      if (
        !HASH.test(value.projectionDigest) ||
        !boundedIdentifier(value.subject) ||
        !boundedIdentifier(value.fiscalPeriod) ||
        (value.evidenceBundleHash !== null && !HASH.test(value.evidenceBundleHash)) ||
        !HASH.test(value.primaryArtifactHash) ||
        !["raw-artifact", "derived-projection"].includes(value.primaryArtifactKind) ||
        !boundedIdentifier(value.normalizerIdentity) ||
        !HASH.test(value.normalizerTranscriptHash) ||
        !HASH.test(value.eventDraftHash) ||
        (value.primaryArtifactKind === "raw-artifact" &&
          value.rawArtifactLinks.filter((link) => link.artifactDigest === value.primaryArtifactHash)
            .length !== 1) ||
        (value.primaryArtifactKind === "derived-projection" &&
          value.primaryArtifactHash !== value.projectionDigest)
      ) {
        fail("observation.entry-invalid");
      }
      validateSourceIdentity(
        value.sourceIdentity,
        value.projectionDigest,
        value.evidenceBundleHash,
      );
      const projectionId = deriveProjectionId(value);
      const sourceObservationId = deriveSourceObservationId({
        sourceVersionIdentity: value.sourceIdentity.sourceVersionIdentity,
        projectionId,
        rawArtifactLinks: value.rawArtifactLinks,
      });
      if (
        value.projectionId !== projectionId ||
        value.sourceObservationId !== sourceObservationId
      ) {
        fail("observation.derived-identity-mismatch");
      }
      return;
    }
    case "normalization.ignored":
      exactKeys(value, [
        "kind",
        "rawArtifactLinks",
        "loaderIdentity",
        "selectionHash",
        "loaderTranscriptHash",
        "normalizerIdentity",
        "normalizerTranscriptHash",
        "reasonCode",
      ]);
      validateNormalizationCommon(value);
      if (
        !boundedIdentifier(value.normalizerIdentity) ||
        !HASH.test(value.normalizerTranscriptHash) ||
        !boundedIdentifier(value.reasonCode)
      ) {
        fail("observation.entry-invalid");
      }
      return;
    case "normalization.quarantined":
      exactKeys(value, [
        "kind",
        "rawArtifactLinks",
        "loaderIdentity",
        "selectionHash",
        "loaderTranscriptHash",
        "normalizerIdentity",
        "normalizerTranscriptHash",
        "reasonCode",
      ]);
      validateNormalizationCommon(value);
      if (
        (value.normalizerIdentity === null) !== (value.normalizerTranscriptHash === null) ||
        (value.normalizerIdentity !== null && !boundedIdentifier(value.normalizerIdentity)) ||
        (value.normalizerTranscriptHash !== null && !HASH.test(value.normalizerTranscriptHash)) ||
        !boundedIdentifier(value.reasonCode)
      ) {
        fail("observation.entry-invalid");
      }
      return;
    case "capture.appended":
    case "capture.redelivered":
      exactKeys(value, [
        "kind",
        "sourceObservationId",
        "sourceVersionIdentity",
        "eventId",
        "eventHash",
        "position",
        "receivedAtMs",
        "logicalAtMs",
      ]);
      if (
        !HASH.test(value.eventId) ||
        !HASH.test(value.eventHash) ||
        !safeInteger(value.position) ||
        value.position < 1 ||
        !safeInteger(value.receivedAtMs) ||
        !safeInteger(value.logicalAtMs)
      ) {
        fail("observation.entry-invalid");
      }
      return;
    case "selection.recorded":
      exactKeys(value, [
        "kind",
        "purpose",
        "selectionBasis",
        "trustedObservationBasis",
        "selectedSourceObservationId",
        "selectedSourceVersionIdentity",
        "subject",
        "issuerMappingId",
        "asOfMs",
        "branchId",
        "marketReferenceJoinKey",
      ]);
      if (
        !safeInteger(value.asOfMs) ||
        !/^sob1_[0-9a-f]{64}$/u.test(value.selectedSourceObservationId) ||
        !/^svr1_[0-9a-f]{64}$/u.test(value.selectedSourceVersionIdentity) ||
        !/^imap1_[0-9a-f]{64}$/u.test(value.issuerMappingId) ||
        !boundedIdentifier(value.subject) ||
        !["cluster-first-observation", "analysis-branch-input", "market-reference-anchor"].includes(
          value.purpose,
        ) ||
        !["capture", "retrieval"].includes(value.selectionBasis) ||
        !["capture", "retrieval"].includes(value.trustedObservationBasis.basisKind) ||
        (value.purpose === "analysis-branch-input") !== (value.branchId !== null) ||
        (value.branchId !== null && !boundedIdentifier(value.branchId)) ||
        value.selectionBasis !== value.trustedObservationBasis.basisKind
      ) {
        fail("observation.entry-invalid");
      }
      if (value.trustedObservationBasis.basisKind === "capture") {
        exactKeys(value.trustedObservationBasis, [
          "basisKind",
          "eventId",
          "receivedAtMs",
          "logicalAtMs",
          "clockBasisId",
        ]);
        if (
          !HASH.test(value.trustedObservationBasis.eventId) ||
          !safeInteger(value.trustedObservationBasis.receivedAtMs) ||
          !safeInteger(value.trustedObservationBasis.logicalAtMs) ||
          !CLOCK_ID.test(value.trustedObservationBasis.clockBasisId) ||
          value.asOfMs < value.trustedObservationBasis.receivedAtMs
        ) {
          fail("observation.entry-invalid");
        }
      } else {
        exactKeys(value.trustedObservationBasis, [
          "basisKind",
          "role",
          "acquisitionObservationId",
          "vaultObservationId",
          "retrievedAtMs",
          "clockBasisId",
        ]);
        if (
          !boundedIdentifier(value.trustedObservationBasis.role) ||
          !/^aob1_[0-9a-f]{64}$/u.test(value.trustedObservationBasis.acquisitionObservationId) ||
          !HASH.test(value.trustedObservationBasis.vaultObservationId) ||
          !safeInteger(value.trustedObservationBasis.retrievedAtMs) ||
          !CLOCK_ID.test(value.trustedObservationBasis.clockBasisId) ||
          value.asOfMs < value.trustedObservationBasis.retrievedAtMs
        ) {
          fail("observation.entry-invalid");
        }
      }
      if (value.purpose === "market-reference-anchor") {
        if (
          value.marketReferenceJoinKey !==
          deriveMarketReferenceJoinKey({
            subject: value.subject,
            issuerMappingId: value.issuerMappingId,
            selectedSourceObservationId: value.selectedSourceObservationId,
            selectedSourceVersionIdentity: value.selectedSourceVersionIdentity,
            trustedObservationBasis: value.trustedObservationBasis,
          })
        ) {
          fail("observation.derived-identity-mismatch");
        }
      } else if (value.marketReferenceJoinKey !== null) {
        fail("observation.entry-invalid");
      }
      return;
    case "failure.recorded":
      exactKeys(value, [
        "kind",
        "stage",
        "failedAfter",
        "acquisitionObservationId",
        "sourceObservationId",
        "reasonCode",
        "detailHash",
      ]);
      if (
        !boundedIdentifier(value.reasonCode) ||
        (value.detailHash !== null && !HASH.test(value.detailHash))
      ) {
        fail("observation.entry-invalid");
      }
      return;
    case "clock.regression":
      exactKeys(value, [
        "kind",
        "priorEntryId",
        "regressingEntryId",
        "priorWallTimeMs",
        "currentWallTimeMs",
        "monotonicOrderPreserved",
      ]);
      if (
        !ENTRY_ID.test(value.priorEntryId) ||
        !ENTRY_ID.test(value.regressingEntryId) ||
        !safeInteger(value.priorWallTimeMs) ||
        !safeInteger(value.currentWallTimeMs) ||
        typeof value.monotonicOrderPreserved !== "boolean" ||
        value.currentWallTimeMs >= value.priorWallTimeMs
      ) {
        fail("observation.entry-invalid");
      }
      return;
    default:
      fail("observation.entry-invalid");
  }
}

function entryPreimage(value: ObservationLedgerEntryInputV1): JsonObject {
  return {
    schemaVersion: value.schemaVersion,
    executionId: value.executionId,
    parentEntryIds: value.parentEntryIds,
    clock: value.clock,
    facts: value.facts,
  } as unknown as JsonObject;
}

export function createObservationLedgerEntry(
  value: ObservationLedgerEntryInputV1,
): ObservationLedgerEntryV1 {
  try {
    assertJsonWithinLimits(value, OBSERVATION_LEDGER_ENTRY_LIMITS, "$.observationLedgerEntry");
  } catch {
    fail("observation.entry-limit-exceeded");
  }
  exactKeys(value, ["schemaVersion", "executionId", "parentEntryIds", "clock", "facts"]);
  if (
    value.schemaVersion !== 1 ||
    !boundedIdentifier(value.executionId) ||
    value.parentEntryIds.length > OBSERVATION_LEDGER_MAX_PARENTS ||
    !sortedUnique(value.parentEntryIds) ||
    value.parentEntryIds.some((parent) => !ENTRY_ID.test(parent))
  ) {
    fail("observation.entry-invalid");
  }
  validateClockStamp(value.clock);
  validateFacts(value.facts);
  const preimage = entryPreimage(value);
  const entryHash = canonicalHash(OBSERVATION_LEDGER_ENTRY_DOMAIN, preimage);
  const entry = {
    ...cloneJson(preimage),
    entryId: `ole1_${entryHash}`,
    entryHash,
  } as ObservationLedgerEntryV1;
  return Object.freeze(entry);
}

function requiredCausalKinds(facts: ObservationLedgerFactsV1): readonly string[] {
  switch (facts.kind) {
    case "clock-basis.declared":
    case "acquisition.declared":
      return [];
    case "request.started":
      return ["acquisition.declared"];
    case "request.succeeded":
      return ["request.started"];
    case "artifact.committed":
      return facts.acquisitionMode === "live"
        ? ["acquisition.declared", "request.succeeded"]
        : ["acquisition.declared"];
    case "artifact.verified":
      return ["artifact.committed"];
    case "normalization.emitted":
    case "normalization.ignored":
    case "normalization.quarantined":
      return facts.rawArtifactLinks.map(() => "artifact.verified");
    case "capture.appended":
    case "capture.redelivered":
      return ["normalization.emitted"];
    case "selection.recorded":
      return facts.selectionBasis === "capture"
        ? ["capture.appended|capture.redelivered"]
        : ["artifact.verified", "normalization.emitted"];
    case "failure.recorded":
      return [facts.failedAfter];
    case "clock.regression":
      return ["$regression"];
  }
}

function causalParents(
  entry: ObservationLedgerEntryV1,
  byId: ReadonlyMap<string, ObservationLedgerEntryV1>,
): readonly ObservationLedgerEntryV1[] {
  return entry.parentEntryIds
    .map((id) => byId.get(id))
    .filter((parent): parent is ObservationLedgerEntryV1 => parent !== undefined)
    .filter((parent) => parent.facts.kind !== "clock-basis.declared");
}

function validateParentTransition(
  entry: ObservationLedgerEntryV1,
  byId: ReadonlyMap<string, ObservationLedgerEntryV1>,
): void {
  const parents = causalParents(entry, byId);
  const expected = requiredCausalKinds(entry.facts);
  if (entry.facts.kind === "clock.regression") {
    const ids = [entry.facts.priorEntryId, entry.facts.regressingEntryId].sort();
    if (canonicalJson(parents.map((parent) => parent.entryId).sort()) !== canonicalJson(ids)) {
      fail("observation.parent-transition-invalid");
    }
    const prior = byId.get(entry.facts.priorEntryId);
    const regressing = byId.get(entry.facts.regressingEntryId);
    if (
      prior === undefined ||
      regressing === undefined ||
      prior.clock.clockBasisId === null ||
      regressing.clock.clockBasisId === null ||
      prior.clock.wallTimeMs === null ||
      regressing.clock.wallTimeMs === null ||
      prior.clock.clockBasisId !== regressing.clock.clockBasisId ||
      entry.clock.clockBasisId !== regressing.clock.clockBasisId ||
      entry.clock.wallTimeMs !== regressing.clock.wallTimeMs ||
      entry.clock.monotonicTimeUs !== regressing.clock.monotonicTimeUs ||
      entry.facts.priorWallTimeMs !== prior.clock.wallTimeMs ||
      entry.facts.currentWallTimeMs !== regressing.clock.wallTimeMs ||
      regressing.clock.wallTimeMs >= prior.clock.wallTimeMs
    ) {
      fail("observation.clock-regression-invalid");
    }
    if (
      prior.clock.monotonicTimeUs !== null &&
      regressing.clock.monotonicTimeUs !== null &&
      regressing.clock.monotonicTimeUs < prior.clock.monotonicTimeUs
    ) {
      fail("observation.clock-basis-invalid");
    }
    const monotonicOrderPreserved =
      prior.clock.monotonicTimeUs !== null &&
      regressing.clock.monotonicTimeUs !== null &&
      regressing.clock.monotonicTimeUs > prior.clock.monotonicTimeUs;
    if (entry.facts.monotonicOrderPreserved !== monotonicOrderPreserved) {
      fail("observation.clock-regression-invalid");
    }
    return;
  }
  const actualKinds = parents.map((parent) => parent.facts.kind).sort();
  const expectedKinds = [...expected].sort();
  if (
    actualKinds.length !== expectedKinds.length ||
    actualKinds.some((kind, index) => {
      const wanted = expectedKinds[index];
      return wanted?.includes("|") ? !wanted.split("|").includes(kind) : kind !== wanted;
    })
  ) {
    fail("observation.parent-transition-invalid");
  }
  const acquisitionId =
    "acquisitionObservationId" in entry.facts ? entry.facts.acquisitionObservationId : null;
  if (
    acquisitionId !== null &&
    parents.some(
      (parent) =>
        "acquisitionObservationId" in parent.facts &&
        parent.facts.acquisitionObservationId !== acquisitionId,
    )
  ) {
    fail("observation.parent-transition-invalid");
  }
  if (entry.facts.kind === "artifact.verified") {
    const committed = parents[0]?.facts;
    if (
      committed?.kind !== "artifact.committed" ||
      committed.vaultObservationId !== entry.facts.vaultObservationId ||
      committed.artifactDigest !== entry.facts.artifactDigest ||
      committed.sizeBytes !== entry.facts.metadataSizeBytes
    ) {
      fail("observation.parent-transition-invalid");
    }
  }
  if (
    entry.facts.kind === "normalization.emitted" ||
    entry.facts.kind === "normalization.ignored" ||
    entry.facts.kind === "normalization.quarantined"
  ) {
    for (const link of entry.facts.rawArtifactLinks) {
      const verifiedEntry = parents.find(
        (parent) =>
          parent.facts.kind === "artifact.verified" &&
          parent.facts.acquisitionObservationId === link.acquisitionObservationId &&
          parent.facts.vaultObservationId === link.vaultObservationId &&
          parent.facts.artifactDigest === link.artifactDigest,
      );
      const verified = verifiedEntry?.facts;
      const committed = verifiedEntry?.parentEntryIds
        .map((id) => byId.get(id))
        .find((parent) => parent?.facts.kind === "artifact.committed")?.facts;
      if (
        verified?.kind !== "artifact.verified" ||
        verified.vaultObservationId !== link.vaultObservationId ||
        verified.artifactDigest !== link.artifactDigest ||
        verified.metadataSizeBytes !== link.sizeBytes ||
        committed?.kind !== "artifact.committed" ||
        committed.acquisitionObservationId !== link.acquisitionObservationId ||
        committed.vaultObservationId !== link.vaultObservationId ||
        committed.vaultObservationHash !== link.vaultObservationHash ||
        committed.artifactDigest !== link.artifactDigest ||
        committed.sizeBytes !== link.sizeBytes
      ) {
        fail("observation.parent-transition-invalid");
      }
    }
  }
  if (entry.facts.kind === "capture.appended" || entry.facts.kind === "capture.redelivered") {
    const normalized = parents[0]?.facts;
    if (
      normalized?.kind !== "normalization.emitted" ||
      normalized.sourceObservationId !== entry.facts.sourceObservationId ||
      normalized.sourceIdentity.sourceVersionIdentity !== entry.facts.sourceVersionIdentity
    ) {
      fail("observation.parent-transition-invalid");
    }
  }
  if (entry.facts.kind === "selection.recorded") {
    const capture = parents.find(
      (parent) =>
        parent.facts.kind === "capture.appended" || parent.facts.kind === "capture.redelivered",
    );
    const normalization =
      entry.facts.selectionBasis === "capture"
        ? capture?.parentEntryIds
            .map((id) => byId.get(id))
            .find((parent) => parent?.facts.kind === "normalization.emitted")
        : parents.find((parent) => parent.facts.kind === "normalization.emitted");
    if (normalization?.facts.kind !== "normalization.emitted") {
      fail("observation.parent-transition-invalid");
    }
    if (
      entry.facts.selectedSourceObservationId !== normalization.facts.sourceObservationId ||
      entry.facts.selectedSourceVersionIdentity !==
        normalization.facts.sourceIdentity.sourceVersionIdentity ||
      entry.facts.subject !== normalization.facts.subject ||
      entry.facts.issuerMappingId !== normalization.facts.issuerMapping.issuerMappingId
    ) {
      fail("observation.parent-transition-invalid");
    }
    if (entry.facts.trustedObservationBasis.basisKind === "capture") {
      if (
        capture === undefined ||
        (capture.facts.kind !== "capture.appended" &&
          capture.facts.kind !== "capture.redelivered") ||
        entry.facts.trustedObservationBasis.eventId !== capture.facts.eventId ||
        entry.facts.trustedObservationBasis.receivedAtMs !== capture.facts.receivedAtMs ||
        entry.facts.trustedObservationBasis.logicalAtMs !== capture.facts.logicalAtMs ||
        entry.facts.trustedObservationBasis.clockBasisId !== capture.clock.clockBasisId
      ) {
        fail("observation.parent-transition-invalid");
      }
    } else {
      const basis = entry.facts.trustedObservationBasis;
      const normalizedFacts = normalization.facts;
      const link = normalizedFacts.rawArtifactLinks.find(
        (candidate) =>
          candidate.role === basis.role &&
          candidate.acquisitionObservationId === basis.acquisitionObservationId &&
          candidate.vaultObservationId === basis.vaultObservationId &&
          candidate.artifactDigest === normalizedFacts.primaryArtifactHash,
      );
      const verified = parents.find(
        (parent) =>
          parent.facts.kind === "artifact.verified" &&
          parent.facts.acquisitionObservationId === basis.acquisitionObservationId,
      );
      const commit = verified?.parentEntryIds
        .map((id) => byId.get(id))
        .find((parent) => parent?.facts.kind === "artifact.committed");
      if (
        link === undefined ||
        commit?.facts.kind !== "artifact.committed" ||
        commit.facts.retrievedAtMs === null ||
        commit.facts.retrievedAtMs !== basis.retrievedAtMs ||
        commit.clock.clockBasisId === null ||
        commit.clock.clockBasisId !== basis.clockBasisId
      ) {
        fail("observation.parent-transition-invalid");
      }
    }
  }
  if (entry.facts.kind === "failure.recorded") {
    const validStage =
      (entry.facts.stage === "request" &&
        (entry.facts.failedAfter === "acquisition.declared" ||
          entry.facts.failedAfter === "request.started")) ||
      (entry.facts.stage === "artifact-store" && entry.facts.failedAfter === "request.succeeded") ||
      (entry.facts.stage === "verified-read" && entry.facts.failedAfter === "artifact.committed") ||
      (entry.facts.stage === "normalization" && entry.facts.failedAfter === "artifact.verified") ||
      (entry.facts.stage === "capture" && entry.facts.failedAfter === "normalization.emitted") ||
      (entry.facts.stage === "selection" &&
        (entry.facts.failedAfter === "normalization.emitted" ||
          entry.facts.failedAfter === "capture.appended" ||
          entry.facts.failedAfter === "capture.redelivered"));
    const acquisitionFailure = [
      "request",
      "artifact-store",
      "verified-read",
      "normalization",
    ].includes(entry.facts.stage);
    const parent = parents[0]?.facts;
    const parentAcquisition =
      parent !== undefined && "acquisitionObservationId" in parent
        ? parent.acquisitionObservationId
        : null;
    const parentSource =
      parent?.kind === "normalization.emitted"
        ? parent.sourceObservationId
        : parent?.kind === "capture.appended" || parent?.kind === "capture.redelivered"
          ? parent.sourceObservationId
          : null;
    if (
      !validStage ||
      (acquisitionFailure &&
        (entry.facts.acquisitionObservationId === null ||
          entry.facts.acquisitionObservationId !== parentAcquisition ||
          entry.facts.sourceObservationId !== null)) ||
      (!acquisitionFailure &&
        (entry.facts.acquisitionObservationId !== null ||
          entry.facts.sourceObservationId === null ||
          entry.facts.sourceObservationId !== parentSource))
    ) {
      fail("observation.parent-transition-invalid");
    }
  }
}

export function validateObservationLedgerBundle(
  values: readonly ObservationLedgerEntryV1[],
): readonly ObservationLedgerEntryV1[] {
  if (values.length > OBSERVATION_LEDGER_MAX_ENTRIES) fail("observation.bundle-limit-exceeded");
  const totalBytes = Buffer.byteLength(canonicalJson(values as unknown as JsonValue), "utf8");
  if (totalBytes > OBSERVATION_LEDGER_BUNDLE_MAX_BYTES) fail("observation.bundle-limit-exceeded");
  const byId = new Map<string, ObservationLedgerEntryV1>();
  const depths = new Map<string, number>();
  const clockBases = new Map<string, ObservationLedgerEntryV1>();
  const lastMonotonic = new Map<string, number>();
  const lastWallEntry = new Map<string, ObservationLedgerEntryV1>();
  const requiredRegressions = new Set<string>();
  const witnessedRegressions = new Set<string>();
  const acquisitionEntryCounts = new Map<string, number>();
  const projectionCounts = new Map<string, number>();
  const blockedCommits = new Set<string>();
  const blockedNormalizations = new Set<string>();
  const recordedCommits = new Set<string>();
  const committedAcquisitions = new Map<string, string>();
  const committedVaultEvidence = new Map<string, string>();
  const providerRevisions = new Map<string, string>();
  let edges = 0;
  let executionId: string | null = null;
  for (const candidate of values) {
    const { entryId: _, entryHash: __, ...input } = candidate;
    const entry = createObservationLedgerEntry(input);
    if (entry.entryId !== candidate.entryId || entry.entryHash !== candidate.entryHash) {
      fail("observation.entry-hash-mismatch");
    }
    executionId ??= entry.executionId;
    if (entry.executionId !== executionId || byId.has(entry.entryId)) {
      fail("observation.parent-transition-invalid");
    }
    for (const parent of entry.parentEntryIds) {
      if (!byId.has(parent)) fail("observation.parent-transition-invalid");
    }
    edges += entry.parentEntryIds.length;
    if (edges > OBSERVATION_LEDGER_MAX_EDGES) fail("observation.bundle-limit-exceeded");
    const depth =
      entry.parentEntryIds.length === 0
        ? 1
        : 1 + Math.max(...entry.parentEntryIds.map((parent) => depths.get(parent) ?? 0));
    if (depth > OBSERVATION_LEDGER_MAX_CAUSAL_DEPTH) fail("observation.bundle-limit-exceeded");
    validateParentTransition(entry, byId);

    const acquisitionIds = new Set<string>();
    if (
      "acquisitionObservationId" in entry.facts &&
      entry.facts.acquisitionObservationId !== null
    ) {
      acquisitionIds.add(entry.facts.acquisitionObservationId);
    }
    if (
      entry.facts.kind === "normalization.emitted" ||
      entry.facts.kind === "normalization.ignored" ||
      entry.facts.kind === "normalization.quarantined"
    ) {
      for (const link of entry.facts.rawArtifactLinks) {
        acquisitionIds.add(link.acquisitionObservationId);
        if (blockedNormalizations.has(link.acquisitionObservationId)) {
          fail("observation.parent-transition-invalid");
        }
      }
    }
    for (const acquisitionId of acquisitionIds) {
      const count = (acquisitionEntryCounts.get(acquisitionId) ?? 0) + 1;
      if (count > OBSERVATION_LEDGER_MAX_ENTRIES_PER_ACQUISITION) {
        fail("observation.bundle-limit-exceeded");
      }
      acquisitionEntryCounts.set(acquisitionId, count);
    }
    if (entry.facts.kind === "request.started" || entry.facts.kind === "request.succeeded") {
      if (recordedCommits.has(entry.facts.acquisitionObservationId)) {
        fail("observation.parent-transition-invalid");
      }
    }
    if (entry.facts.kind === "artifact.committed") {
      const committedFacts = entry.facts;
      if (blockedCommits.has(entry.facts.acquisitionObservationId)) {
        fail("observation.parent-transition-invalid");
      }
      if (
        entry.facts.acquisitionMode !== "live" &&
        [...byId.values()].some(
          (prior) =>
            (prior.facts.kind === "request.started" || prior.facts.kind === "request.succeeded") &&
            prior.facts.acquisitionObservationId === committedFacts.acquisitionObservationId,
        )
      ) {
        fail("observation.parent-transition-invalid");
      }
      if (entry.facts.acquisitionMode !== "live") {
        recordedCommits.add(entry.facts.acquisitionObservationId);
      }
      const commitIdentity = canonicalJson({
        vaultObservationId: entry.facts.vaultObservationId,
        vaultObservationHash: entry.facts.vaultObservationHash,
        artifactDigest: entry.facts.artifactDigest,
        sizeBytes: entry.facts.sizeBytes,
      });
      const vaultEvidence = canonicalJson({
        vaultObservationHash: entry.facts.vaultObservationHash,
        artifactDigest: entry.facts.artifactDigest,
        sizeBytes: entry.facts.sizeBytes,
      });
      const priorCommit = committedAcquisitions.get(entry.facts.acquisitionObservationId);
      const priorVaultEvidence = committedVaultEvidence.get(entry.facts.vaultObservationId);
      if (
        (priorCommit !== undefined && priorCommit !== commitIdentity) ||
        (priorVaultEvidence !== undefined && priorVaultEvidence !== vaultEvidence)
      ) {
        fail("observation.parent-transition-invalid");
      }
      committedAcquisitions.set(entry.facts.acquisitionObservationId, commitIdentity);
      committedVaultEvidence.set(entry.facts.vaultObservationId, vaultEvidence);
    }
    if (entry.facts.kind === "normalization.emitted") {
      const revisionKey = canonicalJson({
        provider: entry.facts.sourceIdentity.provider,
        source: entry.facts.sourceIdentity.source,
        providerRecordId: entry.facts.sourceIdentity.providerRecordId,
        providerRevisionId: entry.facts.sourceIdentity.providerRevisionId,
      });
      const revisionValue = canonicalJson({
        projectionDigest: entry.facts.projectionDigest,
        evidenceBundleHash: entry.facts.evidenceBundleHash,
        sourceVersionIdentity: entry.facts.sourceIdentity.sourceVersionIdentity,
        revisionFamilyIdentity: entry.facts.sourceIdentity.revisionFamilyIdentity,
      });
      const priorRevision = providerRevisions.get(revisionKey);
      if (priorRevision !== undefined && priorRevision !== revisionValue) {
        fail("observation.revision-conflict");
      }
      providerRevisions.set(revisionKey, revisionValue);
      const count = (projectionCounts.get(entry.facts.subject) ?? 0) + 1;
      if (count > OBSERVATION_LEDGER_MAX_PROJECTIONS_PER_SUBJECT) {
        fail("observation.bundle-limit-exceeded");
      }
      projectionCounts.set(entry.facts.subject, count);
    }
    if (entry.facts.kind === "failure.recorded") {
      if (entry.facts.stage === "request" && entry.facts.acquisitionObservationId !== null) {
        blockedCommits.add(entry.facts.acquisitionObservationId);
      }
      if (
        (entry.facts.stage === "artifact-store" ||
          entry.facts.stage === "verified-read" ||
          entry.facts.stage === "normalization") &&
        entry.facts.acquisitionObservationId !== null
      ) {
        blockedNormalizations.add(entry.facts.acquisitionObservationId);
      }
    }

    if (entry.facts.kind === "clock-basis.declared") {
      if (entry.clock.clockBasisId !== null || entry.parentEntryIds.length !== 0) {
        fail("observation.clock-basis-invalid");
      }
      clockBases.set(entry.facts.clockBasis.clockBasisId, entry);
      if (clockBases.size > OBSERVATION_LEDGER_MAX_CLOCK_BASES) {
        fail("observation.bundle-limit-exceeded");
      }
    } else if (entry.clock.clockBasisId !== null) {
      const declaration = clockBases.get(entry.clock.clockBasisId);
      const basisParents = entry.parentEntryIds.filter(
        (parent) => byId.get(parent)?.facts.kind === "clock-basis.declared",
      );
      if (
        declaration === undefined ||
        basisParents.length !== 1 ||
        basisParents[0] !== declaration.entryId
      ) {
        fail("observation.clock-basis-invalid");
      }
      if (
        declaration.facts.kind !== "clock-basis.declared" ||
        (declaration.facts.clockBasis.monotonicClock === "none" &&
          entry.clock.monotonicTimeUs !== null)
      ) {
        fail("observation.clock-basis-invalid");
      }
      if (entry.clock.monotonicTimeUs !== null) {
        const prior = lastMonotonic.get(entry.clock.clockBasisId);
        if (prior !== undefined && entry.clock.monotonicTimeUs < prior) {
          fail("observation.clock-basis-invalid");
        }
        lastMonotonic.set(entry.clock.clockBasisId, entry.clock.monotonicTimeUs);
      }
      if (entry.facts.kind === "clock.regression") {
        const regressionKey = `${entry.facts.priorEntryId}:${entry.facts.regressingEntryId}`;
        if (!requiredRegressions.has(regressionKey) || witnessedRegressions.has(regressionKey)) {
          fail("observation.clock-regression-invalid");
        }
        witnessedRegressions.add(regressionKey);
        lastWallEntry.set(entry.clock.clockBasisId, entry);
      } else {
        const prior = lastWallEntry.get(entry.clock.clockBasisId);
        if (
          prior !== undefined &&
          prior.clock.wallTimeMs !== null &&
          entry.clock.wallTimeMs !== null &&
          entry.clock.wallTimeMs < prior.clock.wallTimeMs
        ) {
          requiredRegressions.add(`${prior.entryId}:${entry.entryId}`);
        }
        lastWallEntry.set(entry.clock.clockBasisId, entry);
      }
    } else if (
      entry.parentEntryIds.some((parent) => byId.get(parent)?.facts.kind === "clock-basis.declared")
    ) {
      fail("observation.clock-basis-invalid");
    }
    byId.set(entry.entryId, entry);
    depths.set(entry.entryId, depth);
  }
  if (
    requiredRegressions.size !== witnessedRegressions.size ||
    [...requiredRegressions].some((key) => !witnessedRegressions.has(key))
  ) {
    fail("observation.clock-regression-invalid");
  }
  return Object.freeze([...values]);
}

export function paginateObservationLedger(
  entries: readonly ObservationLedgerEntryV1[],
  pageSize: number,
): readonly (readonly ObservationLedgerEntryV1[])[] {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < OBSERVATION_LEDGER_PAGE_SIZE_MIN ||
    pageSize > OBSERVATION_LEDGER_PAGE_SIZE_MAX
  ) {
    throw new RangeError("Page size must be an integer from 1 through 10,000");
  }
  validateObservationLedgerBundle(entries);
  const pages: ObservationLedgerEntryV1[][] = [];
  for (let index = 0; index < entries.length; index += pageSize) {
    pages.push(entries.slice(index, index + pageSize));
  }
  return Object.freeze(pages.map((page) => Object.freeze(page)));
}

export function replayRecordedObservationLedger(
  entries: readonly ObservationLedgerEntryV1[],
  executionId: string,
): readonly ObservationLedgerEntryV1[] {
  validateObservationLedgerBundle(entries);
  if (!boundedIdentifier(executionId)) fail("observation.entry-invalid");
  const mapped = new Map<string, string>();
  const replayed: ObservationLedgerEntryV1[] = [];
  for (const original of entries) {
    if (original.facts.kind === "request.started" || original.facts.kind === "request.succeeded") {
      fail("observation.replay-incompatible");
    }
    const parents = original.parentEntryIds.map((parent) => {
      const mappedParent = mapped.get(parent);
      if (mappedParent === undefined) fail("observation.replay-incompatible");
      return mappedParent;
    });
    const facts =
      original.facts.kind === "artifact.committed"
        ? ({ ...original.facts, acquisitionMode: "replay" } as const)
        : original.facts.kind === "clock.regression"
          ? ({
              ...original.facts,
              priorEntryId:
                mapped.get(original.facts.priorEntryId) ?? fail("observation.replay-incompatible"),
              regressingEntryId:
                mapped.get(original.facts.regressingEntryId) ??
                fail("observation.replay-incompatible"),
            } as const)
          : original.facts;
    const entry = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId,
      parentEntryIds: [...parents].sort(),
      clock: original.clock,
      facts,
    });
    mapped.set(original.entryId, entry.entryId);
    replayed.push(entry);
  }
  return validateObservationLedgerBundle(replayed);
}

export function observationLedgerSemanticProjection(
  entries: readonly ObservationLedgerEntryV1[],
): JsonValue {
  validateObservationLedgerBundle(entries);
  return entries.map((entry) => ({ clock: entry.clock, facts: entry.facts })) as JsonValue;
}
