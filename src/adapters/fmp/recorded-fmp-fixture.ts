import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

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
const LOADER_ID = "fmp-recorded-fixture-loader-v1";
const TRANSCRIPT_DOMAIN = "peas/fmp-recorded-fixture-transcript/v1";
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
  "observation",
  "path",
  "role",
  "selectedObservationId",
  "sizeBytes",
]);
const OBSERVATION_FIELDS = Object.freeze([
  "artifactDigest",
  "observationHash",
  "provider",
  "retrievedAtMs",
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

export type RecordedFmpObservationV1 = Readonly<{
  provider: typeof FMP_PROVIDER;
  artifactDigest: string;
  retrievedAtMs: number;
  observationHash: string;
}>;

export type RecordedFmpRetrievedMemberV1 = Readonly<{
  kind: "retrieved";
  role: "fmp.collection-json";
  path: string;
  artifactHash: string;
  sizeBytes: number;
  selectedObservationId: string;
  observation: RecordedFmpObservationV1;
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

export type RecordedFmpFixtureManifestV1 = Readonly<{
  schemaVersion: 1;
  caseId: string;
  provider: typeof FMP_PROVIDER;
  source: typeof FMP_RECORDED_SOURCE;
  acquisitionVariant: "latest" | "search";
  asOfMs: number;
  selector: FmpSelectorV1;
  route: FmpRecordedRouteV1;
  retrievedMembers: readonly [RecordedFmpRetrievedMemberV1];
  derivedProofs: readonly RecordedFmpDerivedProofV1[];
  expected: RecordedFmpExpectedV1;
  provenance: RecordedFmpProvenanceV1;
}>;

export type FmpLoaderTranscriptV1 = Readonly<{
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
    transcript: FmpLoaderTranscriptV1;
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
  }) as FmpLoaderTranscriptV1;
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

function detachManifest(value: RecordedFmpFixtureManifestV1): RecordedFmpFixtureManifestV1 {
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
    ) as RecordedFmpFixtureManifestV1;
    exact(manifest as unknown as JsonObject, MANIFEST_FIELDS);
    exact(manifest.selector as unknown as JsonObject, SELECTOR_FIELDS);
    exact(manifest.route as unknown as JsonObject, ROUTE_FIELDS);
    exact(manifest.expected as unknown as JsonObject, EXPECTED_FIELDS);
    exact(manifest.provenance as unknown as JsonObject, PROVENANCE_FIELDS);
    if (
      manifest.schemaVersion !== 1 ||
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
      !/^fmp-recorded-synthetic:[a-f0-9]{64}$/u.test(manifest.selector.recordId) ||
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
        !/^\d{10}$/u.test(manifest.route.issuerMapping.issuerCik) ||
        !/^[A-Z0-9][A-Z0-9.-]{0,31}$/u.test(manifest.route.issuerMapping.symbol) ||
        !/^\d{4}-(?:Q[1-4]|FY)$/u.test(manifest.route.issuerMapping.fiscalPeriod)
      ) {
        throw new FixtureFailure("fmp.bundle-hash-mismatch");
      }
    }
    validateExpected(manifest.expected);
    validateProvenance(manifest.provenance);
    const member = manifest.retrievedMembers[0];
    exact(member as unknown as JsonObject, MEMBER_FIELDS);
    exact(member.observation as unknown as JsonObject, OBSERVATION_FIELDS);
    if (
      member.kind !== "retrieved" ||
      member.role !== "fmp.collection-json" ||
      typeof member.path !== "string" ||
      member.path.length < 1 ||
      member.path.length > 512 ||
      !SHA256.test(member.artifactHash) ||
      !Number.isSafeInteger(member.sizeBytes) ||
      member.sizeBytes < 0 ||
      !SHA256.test(member.selectedObservationId) ||
      member.observation.provider !== FMP_PROVIDER ||
      member.observation.artifactDigest !== member.artifactHash ||
      !Number.isSafeInteger(member.observation.retrievedAtMs) ||
      member.observation.retrievedAtMs < 0 ||
      member.observation.retrievedAtMs > manifest.asOfMs ||
      !SHA256.test(member.observation.observationHash)
    ) {
      throw new FixtureFailure("fmp.observation-invalid");
    }
    for (const proof of manifest.derivedProofs) {
      exact(proof as unknown as JsonObject, PROOF_FIELDS);
      if (
        proof.kind !== "derived-projection" ||
        proof.role !== "fmp.press-release-item" ||
        proof.parentArtifactHash !== member.artifactHash ||
        proof.policy !== FMP_RECORDED_DIALECT ||
        !SHA256.test(proof.projectionHash) ||
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

function nullableHash(value: string | null): boolean {
  return value === null || SHA256.test(value);
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

function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function confinedFixturePath(root: string, relativePath: string): Promise<string> {
  if (
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    throw new FixtureFailure("fmp.artifact-read-failed");
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new FixtureFailure("fmp.artifact-read-failed");
  }
  const rootReal = await realpath(root);
  let current = rootReal;
  for (const part of parts) {
    current = path.join(current, part);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) throw new FixtureFailure("fmp.artifact-read-failed");
    const currentReal = await realpath(current);
    if (!insideRoot(rootReal, currentReal)) throw new FixtureFailure("fmp.artifact-read-failed");
    current = currentReal;
  }
  return current;
}

/** Reads only a path-confined recorded member and verifies its full manifest evidence. */
export async function loadRecordedFmpFixture(
  options: Readonly<{
    fixtureRoot: string;
    manifest: RecordedFmpFixtureManifestV1;
  }>,
): Promise<RecordedFmpFixtureLoadResult> {
  let manifest: RecordedFmpFixtureManifestV1;
  try {
    manifest = detachManifest(options.manifest);
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
  const baseContext = {
    caseId: manifest.caseId,
    asOfMs: manifest.asOfMs,
    selectedObservationId: member.selectedObservationId,
    observationHash: member.observation.observationHash,
    artifactHash: member.artifactHash,
    projectionHash: manifest.derivedProofs[0]?.projectionHash ?? null,
  } as const;
  let bytes: Buffer;
  try {
    bytes = await readFile(await confinedFixturePath(options.fixtureRoot, member.path));
  } catch {
    return failed("fmp.artifact-read-failed", baseContext);
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
  } else if (result.status !== "quarantined" && manifest.derivedProofs.length !== 1) {
    return failed("fmp.bundle-hash-mismatch", baseContext);
  }
  if (!expectedMatches(manifest.expected, result)) {
    return failed("fmp.bundle-hash-mismatch", baseContext);
  }
  return withTranscript(result, baseContext);
}
