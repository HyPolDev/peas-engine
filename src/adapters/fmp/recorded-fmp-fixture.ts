import { createHash } from "node:crypto";

import type {
  ArtifactObservation,
  ArtifactStore,
  VerifiedArtifactRead,
} from "../../artifacts/artifact-store.js";
import { deriveObservationId } from "../../artifacts/identity.js";
import { validateHttpResponseMetadata } from "../../artifacts/validation.js";
import { canonicalHash } from "../../core/hash.js";
import {
  assertJsonWithinLimits,
  canonicalJson,
  deepFreezeJson,
  inertJsonSnapshot,
  type JsonObject,
  type JsonValue,
} from "../../core/json.js";
import {
  FMP_MAX_DECODED_BYTES,
  FMP_MAX_RESPONSE_BYTES,
  FMP_MAX_TRANSCRIPT_BYTES,
  FMP_PROVIDER,
  FMP_REASON_CODES,
  FMP_RECORDED_DIALECT,
  FMP_RECORDED_SOURCE,
  type FmpLimitKind,
  type FmpNormalizationResult,
  type FmpReasonCode,
  type FmpRecordedRouteV1,
  type FmpSelectorV1,
} from "../../providers/fmp/contracts.js";
import { normalizeRecordedFmpCollection } from "../../providers/fmp/normalizer.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const PERSISTED_ATTEMPT_ID = /^att1_[a-f0-9]{64}$/u;
const PERSISTED_RECORD_ID = /^rec1_[a-f0-9]{64}$/u;
const PERSISTED_REVISION_ID = /^rev1_[a-f0-9]{64}$/u;
const OBSERVATION_JSON_LIMITS = Object.freeze({
  maxDepth: 3,
  maxNodes: 64,
  maxArrayLength: 1,
  maxObjectKeys: 16,
  maxStringBytes: 8_192,
  maxCanonicalBytes: 65_536,
});
const LOADER_ID = "fmp-recorded-fixture-loader-v2";
const TRANSCRIPT_DOMAIN = "peas/fmp-recorded-fixture-transcript/v2";
const FMP_PERSISTED_PROVIDER_ID = `prv1_${canonicalHash("peas/artifact-provider-identifier/v1", {
  value: FMP_PROVIDER,
})}`;
const MANIFEST_FIELDS = Object.freeze([
  "acquisitionVariant",
  "asOfMs",
  "caseId",
  "derivedProofs",
  "expected",
  "provenance",
  "provider",
  "retrievedMembers",
  "route",
  "schemaVersion",
  "selector",
  "source",
]);
const MEMBER_FIELDS = Object.freeze([
  "artifactHash",
  "kind",
  "role",
  "selectedObservationId",
  "sizeBytes",
]);
const ARTIFACT_OBSERVATION_FIELDS = Object.freeze([
  "artifactDigest",
  "attemptId",
  "observationHash",
  "observationId",
  "provider",
  "recordId",
  "request",
  "response",
  "retrievedAtMs",
  "revisionId",
]);
const REQUEST_FIELDS = Object.freeze([
  "identityHash",
  "method",
  "origin",
  "pathHash",
  "routeLabel",
]);
const RESPONSE_FIELDS = Object.freeze([
  "contentEncoding",
  "declaredContentLength",
  "etag",
  "lastModified",
  "mediaType",
  "statusCode",
  "transportDecoded",
]);
const PROOF_FIELDS = Object.freeze([
  "kind",
  "parentArtifactHash",
  "policy",
  "projectionHash",
  "projectionSizeBytes",
  "role",
]);
const SELECTOR_FIELDS = Object.freeze(["recordId", "revisionId"]);
const ROUTE_FIELDS = Object.freeze([
  "classification",
  "issuerMapping",
  "mappingAuthority",
  "mappingVersion",
]);
const ISSUER_MAPPING_FIELDS = Object.freeze(["fiscalPeriod", "issuerCik", "symbol"]);
const EXPECTED_FIELDS = Object.freeze([
  "status",
  "reasonCode",
  "limitKind",
  "recordId",
  "revisionId",
  "rawArtifactHash",
  "primaryArtifactHash",
  "selectedProjectionHash",
  "routeHash",
  "candidateHash",
  "eventDraftHash",
  "publishedAtMs",
  "timestampConfidence",
  "originalTimestamp",
]);
const PROVENANCE_FIELDS = Object.freeze(["approvalReference", "classification", "note"]);

export type RecordedFmpRetrievedMemberV2 = Readonly<{
  kind: "retrieved";
  role: "fmp.collection-json";
  artifactHash: string;
  sizeBytes: number;
  selectedObservationId: string;
}>;

export type RecordedFmpDerivedProofV1 = Readonly<{
  kind: "derived-projection";
  role: "fmp.press-release-item";
  parentArtifactHash: string;
  policy: typeof FMP_RECORDED_DIALECT;
  projectionHash: string;
  projectionSizeBytes: number;
}>;

export type RecordedFmpExpectedV1 = Readonly<{
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: FmpReasonCode | null;
  limitKind: FmpLimitKind | null;
  recordId: string | null;
  revisionId: string | null;
  rawArtifactHash: string | null;
  primaryArtifactHash: string | null;
  selectedProjectionHash: string | null;
  routeHash: string | null;
  candidateHash: string | null;
  eventDraftHash: string | null;
  publishedAtMs: number | null;
  timestampConfidence: "provider" | "unknown" | null;
  originalTimestamp: string | null;
}>;

export type RecordedFmpProvenanceV1 = Readonly<{
  classification: "synthetic" | "redistribution-approved";
  note: string;
  approvalReference: string | null;
}>;

export type RecordedFmpFixtureManifestV2 = Readonly<{
  schemaVersion: 2;
  caseId: string;
  provider: typeof FMP_PROVIDER;
  source: typeof FMP_RECORDED_SOURCE;
  acquisitionVariant: "latest" | "search";
  asOfMs: number;
  selector: FmpSelectorV1;
  route: FmpRecordedRouteV1;
  retrievedMembers: readonly [RecordedFmpRetrievedMemberV2];
  derivedProofs: readonly RecordedFmpDerivedProofV1[];
  expected: RecordedFmpExpectedV1;
  provenance: RecordedFmpProvenanceV1;
}>;

export type FmpLoaderTranscriptV2 = Readonly<{
  loader: typeof LOADER_ID;
  caseId: string;
  asOfMs: number;
  selectedObservationId: string | null;
  observationHash: string | null;
  artifactHash: string | null;
  projectionHash: string | null;
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: FmpReasonCode | null;
}>;

export type RecordedFmpFixtureLoadResult = FmpNormalizationResult &
  Readonly<{
    transcript: FmpLoaderTranscriptV2;
    transcriptHash: string;
  }>;

class FixtureFailure extends Error {
  constructor(readonly reasonCode: FmpReasonCode) {
    super(reasonCode);
    this.name = "FixtureFailure";
  }
}

function freeze<T>(value: T): T {
  return deepFreezeJson(inertJsonSnapshot(value as JsonValue)) as T;
}

function exact(value: JsonObject, fields: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new FixtureFailure("fmp.bundle-hash-mismatch");
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function validRequestIdentity(request: ArtifactObservation["request"]): boolean {
  try {
    const origin = new URL(request.origin);
    return (
      /^[A-Z]{1,32}$/u.test(request.method) &&
      request.origin.length <= 2_048 &&
      /^https?:$/u.test(origin.protocol) &&
      origin.username === "" &&
      origin.password === "" &&
      origin.pathname === "/" &&
      origin.search === "" &&
      origin.hash === "" &&
      origin.origin === request.origin &&
      isSha256(request.pathHash) &&
      /^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(request.routeLabel) &&
      request.identityHash ===
        canonicalHash("peas/artifact-request-identity/v1", {
          method: request.method,
          origin: request.origin,
          pathHash: request.pathHash,
          routeLabel: request.routeLabel,
        })
    );
  } catch {
    return false;
  }
}

/** The same byte gate used by every generated loader transcript. */
export function assertFmpTranscriptBytesWithinLimit(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > FMP_MAX_TRANSCRIPT_BYTES) {
    throw new RangeError(`FMP transcript exceeds ${FMP_MAX_TRANSCRIPT_BYTES} bytes`);
  }
}

function withTranscript(
  result: FmpNormalizationResult,
  context: Readonly<{
    caseId: string;
    asOfMs: number;
    selectedObservationId: string | null;
    observationHash: string | null;
    artifactHash: string | null;
    projectionHash: string | null;
  }>,
): RecordedFmpFixtureLoadResult {
  const transcript = freeze({
    loader: LOADER_ID,
    ...context,
    status: result.status,
    reasonCode: result.reasonCode,
  }) as FmpLoaderTranscriptV2;
  const serialized = Buffer.from(canonicalJson(transcript as unknown as JsonValue), "utf8");
  assertFmpTranscriptBytesWithinLimit(serialized);
  return freeze({
    ...result,
    transcript,
    transcriptHash: canonicalHash(TRANSCRIPT_DOMAIN, transcript as unknown as JsonValue),
  });
}

function failed(
  reasonCode: FmpReasonCode,
  context: Parameters<typeof withTranscript>[1],
): RecordedFmpFixtureLoadResult {
  return withTranscript(
    freeze({
      status: "quarantined",
      reasonCode,
      limitKind: null,
      primaryArtifactHash: context.artifactHash,
      candidate: null,
      draft: null,
    }),
    context,
  );
}

function detachManifest(value: RecordedFmpFixtureManifestV2): RecordedFmpFixtureManifestV2 {
  try {
    assertJsonWithinLimits(value, {
      maxDepth: 8,
      maxNodes: 128,
      maxArrayLength: 4,
      maxObjectKeys: 32,
      maxStringBytes: 8_192,
      maxCanonicalBytes: FMP_MAX_TRANSCRIPT_BYTES,
    });
    const manifest = inertJsonSnapshot(
      value as unknown as JsonValue,
    ) as RecordedFmpFixtureManifestV2;
    exact(manifest as unknown as JsonObject, MANIFEST_FIELDS);
    exact(manifest.selector as unknown as JsonObject, SELECTOR_FIELDS);
    exact(manifest.route as unknown as JsonObject, ROUTE_FIELDS);
    exact(manifest.expected as unknown as JsonObject, EXPECTED_FIELDS);
    exact(manifest.provenance as unknown as JsonObject, PROVENANCE_FIELDS);
    if (
      manifest.schemaVersion !== 2 ||
      manifest.provider !== FMP_PROVIDER ||
      manifest.source !== FMP_RECORDED_SOURCE ||
      (manifest.acquisitionVariant !== "latest" && manifest.acquisitionVariant !== "search") ||
      typeof manifest.caseId !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(manifest.caseId) ||
      !Number.isSafeInteger(manifest.asOfMs) ||
      manifest.asOfMs < 0 ||
      !Array.isArray(manifest.retrievedMembers) ||
      manifest.retrievedMembers.length !== 1 ||
      !Array.isArray(manifest.derivedProofs) ||
      manifest.derivedProofs.length > 1
    ) {
      throw new FixtureFailure("fmp.bundle-hash-mismatch");
    }
    if (
      typeof manifest.selector.recordId !== "string" ||
      !/^fmp-recorded-synthetic:[a-f0-9]{64}$/u.test(manifest.selector.recordId) ||
      typeof manifest.selector.revisionId !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(manifest.selector.revisionId) ||
      (manifest.route.classification !== "earnings-release" &&
        manifest.route.classification !== "not-earnings-release") ||
      typeof manifest.route.mappingAuthority !== "string" ||
      manifest.route.mappingAuthority.length < 1 ||
      Buffer.byteLength(manifest.route.mappingAuthority, "utf8") > 512 ||
      typeof manifest.route.mappingVersion !== "string" ||
      manifest.route.mappingVersion.length < 1 ||
      Buffer.byteLength(manifest.route.mappingVersion, "utf8") > 512
    ) {
      throw new FixtureFailure("fmp.bundle-hash-mismatch");
    }
    if (manifest.route.issuerMapping !== null) {
      exact(manifest.route.issuerMapping as unknown as JsonObject, ISSUER_MAPPING_FIELDS);
      if (
        typeof manifest.route.issuerMapping.issuerCik !== "string" ||
        !/^\d{10}$/u.test(manifest.route.issuerMapping.issuerCik) ||
        typeof manifest.route.issuerMapping.symbol !== "string" ||
        !/^[A-Z0-9][A-Z0-9.-]{0,31}$/u.test(manifest.route.issuerMapping.symbol) ||
        typeof manifest.route.issuerMapping.fiscalPeriod !== "string" ||
        !/^\d{4}-(?:Q[1-4]|FY)$/u.test(manifest.route.issuerMapping.fiscalPeriod)
      ) {
        throw new FixtureFailure("fmp.bundle-hash-mismatch");
      }
    }
    validateExpected(manifest.expected);
    if (
      (manifest.expected.status === "emitted" && manifest.derivedProofs.length !== 1) ||
      (manifest.expected.status !== "emitted" && manifest.derivedProofs.length !== 0)
    ) {
      throw new FixtureFailure("fmp.bundle-hash-mismatch");
    }
    validateProvenance(manifest.provenance);
    const member = manifest.retrievedMembers[0];
    exact(member as unknown as JsonObject, MEMBER_FIELDS);
    if (
      member.kind !== "retrieved" ||
      member.role !== "fmp.collection-json" ||
      !isSha256(member.artifactHash) ||
      !Number.isSafeInteger(member.sizeBytes) ||
      member.sizeBytes < 0 ||
      !isSha256(member.selectedObservationId)
    ) {
      throw new FixtureFailure("fmp.observation-invalid");
    }
    if (member.sizeBytes > FMP_MAX_RESPONSE_BYTES) {
      throw new FixtureFailure("fmp.response-byte-limit-exceeded");
    }
    for (const proof of manifest.derivedProofs) {
      exact(proof as unknown as JsonObject, PROOF_FIELDS);
      if (
        proof.kind !== "derived-projection" ||
        proof.role !== "fmp.press-release-item" ||
        proof.parentArtifactHash !== member.artifactHash ||
        proof.policy !== FMP_RECORDED_DIALECT ||
        !isSha256(proof.projectionHash) ||
        !Number.isSafeInteger(proof.projectionSizeBytes) ||
        proof.projectionSizeBytes < 0 ||
        proof.projectionSizeBytes > FMP_MAX_DECODED_BYTES
      ) {
        throw new FixtureFailure("fmp.bundle-hash-mismatch");
      }
    }
    return freeze(manifest);
  } catch (error) {
    if (error instanceof FixtureFailure) throw error;
    throw new FixtureFailure("fmp.bundle-hash-mismatch");
  }
}

function nullableHash(value: unknown): boolean {
  return value === null || isSha256(value);
}

function validateExpected(expected: RecordedFmpExpectedV1): void {
  const emitted = expected.status === "emitted";
  const terminal = expected.status === "ignored" || expected.status === "quarantined";
  if (
    (!emitted && !terminal) ||
    (expected.reasonCode !== null && !FMP_REASON_CODES.includes(expected.reasonCode)) ||
    (expected.limitKind !== null &&
      !["json-tokens", "json-depth", "object-keys", "decoded-string-bytes"].includes(
        expected.limitKind,
      )) ||
    (expected.limitKind !== null) !==
      (expected.reasonCode === "fmp.parse-limit-exceeded" ||
        (expected.reasonCode === "fmp.item-invalid" && expected.limitKind === "object-keys")) ||
    !nullableHash(expected.rawArtifactHash) ||
    !nullableHash(expected.primaryArtifactHash) ||
    !nullableHash(expected.selectedProjectionHash) ||
    !nullableHash(expected.routeHash) ||
    !nullableHash(expected.candidateHash) ||
    !nullableHash(expected.eventDraftHash) ||
    (expected.publishedAtMs !== null &&
      (!Number.isSafeInteger(expected.publishedAtMs) || expected.publishedAtMs < 0)) ||
    !["provider", "unknown", null].includes(expected.timestampConfidence) ||
    (expected.originalTimestamp !== null &&
      (typeof expected.originalTimestamp !== "string" ||
        expected.originalTimestamp.length < 1 ||
        Buffer.byteLength(expected.originalTimestamp, "utf8") > 128))
  ) {
    throw new FixtureFailure("fmp.bundle-hash-mismatch");
  }
  if (emitted) {
    if (
      expected.reasonCode !== null ||
      expected.limitKind !== null ||
      expected.recordId === null ||
      !/^fmp-recorded-synthetic:[a-f0-9]{64}$/u.test(expected.recordId) ||
      expected.revisionId === null ||
      !/^sha256:[a-f0-9]{64}$/u.test(expected.revisionId) ||
      expected.rawArtifactHash === null ||
      expected.primaryArtifactHash === null ||
      expected.selectedProjectionHash === null ||
      expected.routeHash === null ||
      expected.candidateHash === null ||
      expected.eventDraftHash === null ||
      (expected.timestampConfidence === "provider") !==
        (expected.publishedAtMs !== null && expected.originalTimestamp !== null) ||
      (expected.timestampConfidence === "unknown" &&
        (expected.publishedAtMs !== null || expected.originalTimestamp !== null)) ||
      expected.timestampConfidence === null
    ) {
      throw new FixtureFailure("fmp.bundle-hash-mismatch");
    }
    return;
  }
  if (
    expected.reasonCode === null ||
    expected.recordId !== null ||
    expected.revisionId !== null ||
    expected.primaryArtifactHash !== null ||
    expected.selectedProjectionHash !== null ||
    expected.routeHash !== null ||
    expected.candidateHash !== null ||
    expected.eventDraftHash !== null ||
    expected.publishedAtMs !== null ||
    expected.timestampConfidence !== null ||
    expected.originalTimestamp !== null
  ) {
    throw new FixtureFailure("fmp.bundle-hash-mismatch");
  }
}

function validateProvenance(provenance: RecordedFmpProvenanceV1): void {
  if (
    (provenance.classification !== "synthetic" &&
      provenance.classification !== "redistribution-approved") ||
    typeof provenance.note !== "string" ||
    provenance.note.length < 1 ||
    Buffer.byteLength(provenance.note, "utf8") > 4_096 ||
    (provenance.classification === "synthetic" && provenance.approvalReference !== null) ||
    (provenance.classification === "redistribution-approved" &&
      (typeof provenance.approvalReference !== "string" ||
        provenance.approvalReference.length < 1 ||
        Buffer.byteLength(provenance.approvalReference, "utf8") > 512))
  ) {
    throw new FixtureFailure("fmp.bundle-hash-mismatch");
  }
}

function expectedMatches(expected: RecordedFmpExpectedV1, result: FmpNormalizationResult): boolean {
  if (
    expected.status !== result.status ||
    expected.reasonCode !== result.reasonCode ||
    expected.limitKind !== result.limitKind ||
    expected.rawArtifactHash !== result.primaryArtifactHash
  ) {
    return false;
  }
  if (result.status !== "emitted") return true;
  return (
    expected.recordId === result.recordId &&
    expected.revisionId === result.revisionId &&
    expected.primaryArtifactHash === result.candidate.primaryArtifactHash &&
    expected.selectedProjectionHash === result.selectedProjectionHash &&
    expected.routeHash === result.routeHash &&
    expected.candidateHash === result.candidateHash &&
    expected.eventDraftHash === result.eventDraftHash &&
    expected.publishedAtMs === result.candidate.publishedAtMs &&
    expected.timestampConfidence === result.candidate.timestampConfidence &&
    expected.originalTimestamp === result.candidate.originalTimestamp
  );
}

function validateArtifactObservation(
  value: ArtifactObservation | undefined,
  member: RecordedFmpRetrievedMemberV2,
  asOfMs: number,
): ArtifactObservation {
  try {
    if (value === undefined) throw new FixtureFailure("fmp.observation-invalid");
    assertJsonWithinLimits(value, OBSERVATION_JSON_LIMITS, "$.artifactObservation");
    const observation = inertJsonSnapshot(value as unknown as JsonValue) as ArtifactObservation;
    exact(observation as unknown as JsonObject, ARTIFACT_OBSERVATION_FIELDS);
    exact(observation.request as unknown as JsonObject, REQUEST_FIELDS);
    exact(observation.response as unknown as JsonObject, RESPONSE_FIELDS);
    if (
      observation.observationId !== member.selectedObservationId ||
      observation.provider !== FMP_PERSISTED_PROVIDER_ID ||
      observation.artifactDigest !== member.artifactHash ||
      !PERSISTED_ATTEMPT_ID.test(observation.attemptId) ||
      !PERSISTED_RECORD_ID.test(observation.recordId) ||
      !PERSISTED_REVISION_ID.test(observation.revisionId) ||
      !validRequestIdentity(observation.request) ||
      !Number.isSafeInteger(observation.retrievedAtMs) ||
      observation.retrievedAtMs < 0 ||
      observation.retrievedAtMs > asOfMs ||
      !isSha256(observation.observationHash)
    ) {
      throw new FixtureFailure("fmp.observation-invalid");
    }
    validateHttpResponseMetadata(observation.response);
    const expectedId = deriveObservationId(
      {
        attemptId: observation.attemptId,
        provider: observation.provider,
        recordId: observation.recordId,
        revisionId: observation.revisionId,
        startedAtMs: 0,
        request: observation.request,
      },
      observation.artifactDigest,
      observation.response,
    );
    const { observationHash: _hash, ...preimage } = observation;
    const expectedHash = canonicalHash(
      "peas/artifact-observation/v1",
      preimage as unknown as JsonValue,
    );
    if (observation.observationId !== expectedId || observation.observationHash !== expectedHash) {
      throw new FixtureFailure("fmp.observation-invalid");
    }
    return observation;
  } catch (error) {
    if (error instanceof FixtureFailure) throw error;
    throw new FixtureFailure("fmp.observation-invalid");
  }
}

async function readBoundedFmpMember(
  store: ArtifactStore,
  member: RecordedFmpRetrievedMemberV2,
): Promise<Buffer> {
  let verified: VerifiedArtifactRead;
  try {
    verified = await store.read(member.artifactHash);
  } catch {
    throw new FixtureFailure("fmp.artifact-read-failed");
  }
  if (verified.artifact.sizeBytes > FMP_MAX_RESPONSE_BYTES) {
    verified.stream.destroy();
    throw new FixtureFailure("fmp.response-byte-limit-exceeded");
  }
  if (
    verified.artifact.digest !== member.artifactHash ||
    verified.artifact.algorithm !== "sha256" ||
    verified.artifact.sizeBytes !== member.sizeBytes
  ) {
    verified.stream.destroy();
    throw new FixtureFailure("fmp.bundle-hash-mismatch");
  }
  const bytes = Buffer.allocUnsafe(member.sizeBytes);
  const hash = createHash("sha256");
  let consumed = 0;
  try {
    for await (const chunk of verified.stream) {
      if (!(chunk instanceof Uint8Array)) throw new Error("artifact stream emitted non-bytes");
      if (chunk.byteLength > member.sizeBytes - consumed) {
        throw new FixtureFailure("fmp.bundle-hash-mismatch");
      }
      bytes.set(chunk, consumed);
      hash.update(chunk);
      consumed += chunk.byteLength;
    }
  } catch (error) {
    verified.stream.destroy();
    if (error instanceof FixtureFailure) throw error;
    throw new FixtureFailure("fmp.artifact-read-failed");
  }
  if (consumed !== member.sizeBytes || hash.digest("hex") !== member.artifactHash) {
    throw new FixtureFailure("fmp.bundle-hash-mismatch");
  }
  return bytes;
}

/** Resolves one authoritative observation and fully consumes its verified artifact. */
export async function loadRecordedFmpFixture(
  store: ArtifactStore,
  value: RecordedFmpFixtureManifestV2,
): Promise<RecordedFmpFixtureLoadResult> {
  let manifest: RecordedFmpFixtureManifestV2;
  try {
    manifest = detachManifest(value);
  } catch (error) {
    const reasonCode =
      error instanceof FixtureFailure ? error.reasonCode : "fmp.bundle-hash-mismatch";
    return failed(reasonCode, {
      caseId: "invalid-manifest",
      asOfMs: 0,
      selectedObservationId: null,
      observationHash: null,
      artifactHash: null,
      projectionHash: null,
    });
  }
  const member = manifest.retrievedMembers[0];
  let observation: ArtifactObservation;
  try {
    observation = validateArtifactObservation(
      await store.getObservation(member.selectedObservationId),
      member,
      manifest.asOfMs,
    );
  } catch {
    return failed("fmp.observation-invalid", {
      caseId: manifest.caseId,
      asOfMs: manifest.asOfMs,
      selectedObservationId: member.selectedObservationId,
      observationHash: null,
      artifactHash: null,
      projectionHash: null,
    });
  }
  const baseContext = {
    caseId: manifest.caseId,
    asOfMs: manifest.asOfMs,
    selectedObservationId: member.selectedObservationId,
    observationHash: observation.observationHash,
    artifactHash: member.artifactHash,
    // A manifest claim is not transcript evidence. It becomes transcript evidence only
    // after the selected projection is recomputed from the verified member bytes.
    projectionHash: null,
  } as const;
  let bytes: Buffer;
  try {
    bytes = await readBoundedFmpMember(store, member);
  } catch (error) {
    return failed(
      error instanceof FixtureFailure ? error.reasonCode : "fmp.artifact-read-failed",
      baseContext,
    );
  }
  if (
    bytes.byteLength !== member.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== member.artifactHash
  ) {
    return failed("fmp.bundle-hash-mismatch", baseContext);
  }
  const result = normalizeRecordedFmpCollection({
    bytes,
    selector: manifest.selector,
    route: manifest.route,
  });
  if (result.status === "emitted") {
    const proof = manifest.derivedProofs[0];
    const projectionSize = Buffer.byteLength(
      canonicalJson(result.projection as unknown as JsonValue),
      "utf8",
    );
    if (
      proof === undefined ||
      proof.parentArtifactHash !== result.primaryArtifactHash ||
      proof.projectionHash !== result.selectedProjectionHash ||
      proof.projectionSizeBytes !== projectionSize
    ) {
      return failed("fmp.bundle-hash-mismatch", baseContext);
    }
  } else if (manifest.derivedProofs.length !== 0) {
    return failed("fmp.bundle-hash-mismatch", baseContext);
  }
  if (!expectedMatches(manifest.expected, result)) {
    return failed("fmp.bundle-hash-mismatch", baseContext);
  }
  return withTranscript(
    result,
    result.status === "emitted"
      ? { ...baseContext, projectionHash: result.selectedProjectionHash }
      : baseContext,
  );
}
