import { createHash } from "node:crypto";

import type {
  ArtifactObservation,
  ArtifactStore,
  VerifiedArtifactRead,
} from "../../../artifacts/artifact-store.js";
import { deriveObservationId } from "../../../artifacts/identity.js";
import { validateHttpResponseMetadata } from "../../../artifacts/validation.js";
import { canonicalHash } from "../../../core/hash.js";
import {
  assertJsonWithinLimits,
  canonicalJson,
  inertJsonSnapshot,
  type JsonValue,
} from "../../../core/json.js";
import {
  NVIDIA_IR_PROVIDER,
  NVIDIA_IR_LIMITS,
  NVIDIA_IR_SOURCE,
  type NvidiaIrReasonCode,
  type NvidiaNormalizationResult,
} from "../../../providers/ir/nvidia/contracts.js";
import {
  assertNvidiaDeclaredLimit,
  normalizeRecordedNvidiaIr,
  parseNvidiaReference,
} from "../../../providers/ir/nvidia/normalizer.js";

const SHA256 = /^[0-9a-f]{64}$/u;
const PERSISTED_ATTEMPT_ID = /^att1_[0-9a-f]{64}$/u;
const PERSISTED_RECORD_ID = /^rec1_[0-9a-f]{64}$/u;
const PERSISTED_REVISION_ID = /^rev1_[0-9a-f]{64}$/u;
const OBSERVATION_JSON_LIMITS = Object.freeze({
  maxDepth: 3,
  maxNodes: 64,
  maxArrayLength: 1,
  maxObjectKeys: 16,
  maxStringBytes: 8_192,
  maxCanonicalBytes: 65_536,
});
const LOADER = "nvidia-recorded-fixture-loader-v2" as const;
const NVIDIA_PERSISTED_PROVIDER_ID = `prv1_${canonicalHash("peas/artifact-provider-identifier/v1", {
  value: NVIDIA_IR_PROVIDER,
})}`;
const RSS_POLICY = "peas/nvidia-ir-rss-item-projection/v1" as const;
const RELEASE_POLICY = "peas/nvidia-ir-release-visible-projection/v1" as const;
const MANIFEST_FIELDS = [
  "schemaVersion",
  "caseId",
  "provider",
  "source",
  "acquisitionVariant",
  "asOfMs",
  "selector",
  "route",
  "retrievedMembers",
  "derivedProofs",
  "expected",
  "provenance",
] as const;
const MEMBER_FIELDS = [
  "kind",
  "role",
  "artifactHash",
  "sizeBytes",
  "selectedObservationId",
] as const;
const ARTIFACT_OBSERVATION_FIELDS = [
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
] as const;
const REQUEST_FIELDS = ["identityHash", "method", "origin", "pathHash", "routeLabel"] as const;
const RESPONSE_FIELDS = [
  "contentEncoding",
  "declaredContentLength",
  "etag",
  "lastModified",
  "mediaType",
  "statusCode",
  "transportDecoded",
] as const;
const PROOF_FIELDS = [
  "kind",
  "role",
  "parentArtifactHash",
  "policy",
  "projectionHash",
  "projectionSizeBytes",
] as const;
const SELECTOR_FIELDS = ["selectionKey"] as const;
const ROUTE_FIELDS = [
  "classificationPolicy",
  "issuerCik",
  "symbol",
  "mappingAuthority",
  "mappingVersion",
] as const;
const EXPECTED_FIELDS = [
  "status",
  "reasonCode",
  "limitKind",
  "recordId",
  "revisionId",
  "issuerCik",
  "symbol",
  "fiscalPeriod",
  "sourceKind",
  "publishedAtMs",
  "timestampConfidence",
  "originalTimestamp",
  "primaryArtifactHash",
  "selectedProjectionHash",
  "routeHash",
  "candidateHash",
  "eventDraftHash",
] as const;
const PROVENANCE_FIELDS = ["classification", "note", "approvalReference"] as const;
const EXPECTED_REASON_CODES = new Set<NvidiaIrReasonCode>([
  "ir.not-financial-results",
  "ir.bundle-invalid",
  "ir.bundle-hash-mismatch",
  "ir.observation-invalid",
  "ir.artifact-read-failed",
  "ir.feed-malformed",
  "ir.item-limit-exceeded",
  "ir.item-invalid",
  "ir.record-family-ambiguous",
  "ir.duplicate-guid-conflict",
  "ir.link-invalid",
  "ir.canonical-conflict",
  "ir.timestamp-invalid",
  "ir.release-malformed",
  "ir.release-title-conflict",
  "ir.unsupported-encoding",
  "ir.member-limit-exceeded",
  "ir.bundle-byte-limit-exceeded",
  "ir.parser-limit-exceeded",
]);
const EXPECTED_LIMIT_KINDS = new Set([
  "xml-tokens",
  "xml-depth",
  "xml-attributes",
  "html-tokens",
  "html-depth",
  "html-attributes",
  "extracted-text-bytes",
  "categories",
]);

export type NvidiaRetrievedMemberV2 = Readonly<{
  kind: "retrieved";
  role: "ir.rss-feed" | "ir.release-html";
  artifactHash: string;
  sizeBytes: number;
  selectedObservationId: string;
}>;
export type NvidiaDerivedProofV1 = Readonly<{
  kind: "derived-projection";
  role: "ir.rss-item" | "ir.release-visible";
  parentArtifactHash: string;
  policy: typeof RSS_POLICY | typeof RELEASE_POLICY;
  projectionHash: string;
  projectionSizeBytes: number;
}>;
export type NvidiaFixtureExpectedV1 = Readonly<{
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: string | null;
  limitKind: string | null;
  recordId: string | null;
  revisionId: string | null;
  issuerCik: string | null;
  symbol: string | null;
  fiscalPeriod: string | null;
  sourceKind: "issuer_release" | null;
  publishedAtMs: number | null;
  timestampConfidence: "provider" | "unknown" | null;
  originalTimestamp: string | null;
  primaryArtifactHash: string | null;
  selectedProjectionHash: string | null;
  routeHash: string | null;
  candidateHash: string | null;
  eventDraftHash: string | null;
}>;
export type NvidiaFixtureManifestV2 = Readonly<{
  schemaVersion: 2;
  caseId: string;
  provider: "nvidia-ir";
  source: typeof NVIDIA_IR_SOURCE;
  acquisitionVariant: "rss";
  asOfMs: number;
  selector: Readonly<{ selectionKey: string }>;
  route: Readonly<{
    classificationPolicy: "nvidia-financial-results-title-v1";
    issuerCik: "0001045810";
    symbol: "NVDA";
    mappingAuthority: string;
    mappingVersion: string;
  }>;
  retrievedMembers: readonly NvidiaRetrievedMemberV2[];
  derivedProofs: readonly NvidiaDerivedProofV1[];
  expected: NvidiaFixtureExpectedV1;
  provenance: Readonly<{
    classification: "synthetic" | "redistribution-approved";
    note: string;
    approvalReference: string | null;
  }>;
}>;
export type NvidiaLoaderTranscriptV2 = Readonly<{
  loader: typeof LOADER;
  caseId: string;
  observationIds: readonly string[];
  observationHashes: readonly string[];
  artifactHashes: readonly string[];
  projectionHashes: readonly string[];
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: NvidiaIrReasonCode | null;
}>;
export type NvidiaFixtureLoadResult = Readonly<{
  normalization: NvidiaNormalizationResult | null;
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: NvidiaIrReasonCode | null;
  transcript: NvidiaLoaderTranscriptV2;
  transcriptHash: string;
}>;

class LoaderFailure extends Error {
  constructor(readonly reasonCode: NvidiaIrReasonCode) {
    super(reasonCode);
  }
}
function exact(value: object, fields: readonly string[], reason: NvidiaIrReasonCode): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index]))
    throw new LoaderFailure(reason);
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
function isNullableSha256(value: unknown): value is string | null {
  return value === null || isSha256(value);
}
function validateExpected(expected: NvidiaFixtureExpectedV1): void {
  const emitted = expected.status === "emitted";
  const terminal = expected.status === "ignored" || expected.status === "quarantined";
  if (
    (!emitted && !terminal) ||
    (expected.reasonCode !== null &&
      !EXPECTED_REASON_CODES.has(expected.reasonCode as NvidiaIrReasonCode)) ||
    (expected.limitKind !== null &&
      (typeof expected.limitKind !== "string" || !EXPECTED_LIMIT_KINDS.has(expected.limitKind))) ||
    (expected.limitKind !== null) !== (expected.reasonCode === "ir.parser-limit-exceeded") ||
    !isNullableSha256(expected.primaryArtifactHash) ||
    !isNullableSha256(expected.selectedProjectionHash) ||
    !isNullableSha256(expected.routeHash) ||
    !isNullableSha256(expected.candidateHash) ||
    !isNullableSha256(expected.eventDraftHash) ||
    (expected.publishedAtMs !== null &&
      (!Number.isSafeInteger(expected.publishedAtMs) || expected.publishedAtMs < 0)) ||
    (expected.originalTimestamp !== null &&
      (typeof expected.originalTimestamp !== "string" ||
        expected.originalTimestamp.length < 1 ||
        Buffer.byteLength(expected.originalTimestamp, "utf8") > 128)) ||
    !["provider", "unknown", null].includes(expected.timestampConfidence)
  ) {
    throw new LoaderFailure("ir.bundle-invalid");
  }
  if (emitted) {
    if (
      expected.reasonCode !== null ||
      expected.limitKind !== null ||
      typeof expected.recordId !== "string" ||
      !/^ir:nvidia:[0-9a-f]{64}$/u.test(expected.recordId) ||
      typeof expected.revisionId !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(expected.revisionId) ||
      expected.issuerCik !== "0001045810" ||
      expected.symbol !== "NVDA" ||
      typeof expected.fiscalPeriod !== "string" ||
      !/^\d{4}-(?:Q[1-4]|FY)$/u.test(expected.fiscalPeriod) ||
      expected.sourceKind !== "issuer_release" ||
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
      throw new LoaderFailure("ir.bundle-invalid");
    }
    return;
  }
  if (
    expected.reasonCode === null ||
    expected.recordId !== null ||
    expected.revisionId !== null ||
    expected.issuerCik !== null ||
    expected.symbol !== null ||
    expected.fiscalPeriod !== null ||
    expected.sourceKind !== null ||
    expected.publishedAtMs !== null ||
    expected.timestampConfidence !== null ||
    expected.originalTimestamp !== null ||
    expected.primaryArtifactHash !== null ||
    expected.selectedProjectionHash !== null ||
    expected.routeHash !== null ||
    expected.candidateHash !== null ||
    expected.eventDraftHash !== null
  ) {
    throw new LoaderFailure("ir.bundle-invalid");
  }
}
function validateProvenance(provenance: NvidiaFixtureManifestV2["provenance"]): void {
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
    throw new LoaderFailure("ir.bundle-invalid");
  }
}
function validateManifest(value: NvidiaFixtureManifestV2): NvidiaFixtureManifestV2 {
  try {
    assertJsonWithinLimits(value, {
      maxDepth: 8,
      maxNodes: 256,
      maxArrayLength: 8,
      maxObjectKeys: 32,
      maxStringBytes: 8_192,
      maxCanonicalBytes: 256 * 1_024,
    });
    const manifest = inertJsonSnapshot(value as unknown as JsonValue) as NvidiaFixtureManifestV2;
    exact(manifest, MANIFEST_FIELDS, "ir.bundle-invalid");
    exact(manifest.selector, SELECTOR_FIELDS, "ir.bundle-invalid");
    exact(manifest.route, ROUTE_FIELDS, "ir.bundle-invalid");
    exact(manifest.expected, EXPECTED_FIELDS, "ir.bundle-invalid");
    exact(manifest.provenance, PROVENANCE_FIELDS, "ir.bundle-invalid");
    if (
      manifest.schemaVersion !== 2 ||
      manifest.provider !== NVIDIA_IR_PROVIDER ||
      manifest.source !== NVIDIA_IR_SOURCE ||
      manifest.acquisitionVariant !== "rss" ||
      typeof manifest.caseId !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(manifest.caseId) ||
      !Number.isSafeInteger(manifest.asOfMs) ||
      manifest.asOfMs < 0 ||
      !Array.isArray(manifest.retrievedMembers) ||
      manifest.retrievedMembers.length !== 2 ||
      !Array.isArray(manifest.derivedProofs) ||
      typeof manifest.selector.selectionKey !== "string" ||
      manifest.selector.selectionKey.length < 1 ||
      Buffer.byteLength(manifest.selector.selectionKey, "utf8") > 2_048 ||
      parseNvidiaReference(manifest.selector.selectionKey) !== manifest.selector.selectionKey ||
      manifest.route.classificationPolicy !== "nvidia-financial-results-title-v1" ||
      manifest.route.issuerCik !== "0001045810" ||
      manifest.route.symbol !== "NVDA" ||
      manifest.route.mappingAuthority !== "peas-static-nvidia-v1" ||
      manifest.route.mappingVersion !== "1"
    )
      throw new LoaderFailure("ir.bundle-invalid");
    validateExpected(manifest.expected);
    validateProvenance(manifest.provenance);
    if (manifest.derivedProofs.length !== 2) throw new LoaderFailure("ir.bundle-hash-mismatch");
    const declaredBundleBytes = manifest.retrievedMembers.reduce(
      (total, member) =>
        Number.isSafeInteger(member.sizeBytes) && member.sizeBytes >= 0
          ? total + member.sizeBytes
          : Number.NaN,
      0,
    );
    if (!Number.isSafeInteger(declaredBundleBytes) || declaredBundleBytes < 0) {
      throw new LoaderFailure("ir.observation-invalid");
    }
    if (declaredBundleBytes > NVIDIA_IR_LIMITS.bundleBytes) {
      throw new LoaderFailure("ir.bundle-byte-limit-exceeded");
    }
    const roles = new Set<string>();
    const observationIds = new Set<string>();
    for (const member of manifest.retrievedMembers) {
      exact(member, MEMBER_FIELDS, "ir.bundle-invalid");
      if (
        member.kind !== "retrieved" ||
        !["ir.rss-feed", "ir.release-html"].includes(member.role) ||
        roles.has(member.role) ||
        !isSha256(member.artifactHash) ||
        !isSha256(member.selectedObservationId) ||
        observationIds.has(member.selectedObservationId) ||
        !Number.isSafeInteger(member.sizeBytes) ||
        member.sizeBytes < 0
      )
        throw new LoaderFailure("ir.observation-invalid");
      if (member.sizeBytes > NVIDIA_IR_LIMITS.memberBytes) {
        throw new LoaderFailure("ir.member-limit-exceeded");
      }
      roles.add(member.role);
      observationIds.add(member.selectedObservationId);
    }
    const proofRoles = new Set<string>();
    for (const proof of manifest.derivedProofs) {
      exact(proof, PROOF_FIELDS, "ir.bundle-invalid");
      const expectedPolicy =
        proof.role === "ir.rss-item"
          ? RSS_POLICY
          : proof.role === "ir.release-visible"
            ? RELEASE_POLICY
            : null;
      const parentRole = proof.role === "ir.rss-item" ? "ir.rss-feed" : "ir.release-html";
      if (
        proof.kind !== "derived-projection" ||
        expectedPolicy === null ||
        proofRoles.has(proof.role) ||
        proof.policy !== expectedPolicy ||
        proof.parentArtifactHash !==
          manifest.retrievedMembers.find((member) => member.role === parentRole)?.artifactHash ||
        !isSha256(proof.projectionHash) ||
        !Number.isSafeInteger(proof.projectionSizeBytes) ||
        proof.projectionSizeBytes < 0
      )
        throw new LoaderFailure("ir.bundle-hash-mismatch");
      proofRoles.add(proof.role);
      assertNvidiaDeclaredLimit("projection-bytes", proof.projectionSizeBytes);
    }
    if (
      proofRoles.size !== 2 ||
      !proofRoles.has("ir.rss-item") ||
      !proofRoles.has("ir.release-visible")
    )
      throw new LoaderFailure("ir.bundle-hash-mismatch");
    return manifest;
  } catch (error) {
    if (error instanceof LoaderFailure) throw error;
    throw new LoaderFailure("ir.bundle-invalid");
  }
}
function validateArtifactObservation(
  value: ArtifactObservation | undefined,
  member: NvidiaRetrievedMemberV2,
  asOfMs: number,
): ArtifactObservation {
  try {
    if (value === undefined) throw new LoaderFailure("ir.observation-invalid");
    assertJsonWithinLimits(value, OBSERVATION_JSON_LIMITS, "$.artifactObservation");
    const observation = inertJsonSnapshot(value as unknown as JsonValue) as ArtifactObservation;
    exact(observation, ARTIFACT_OBSERVATION_FIELDS, "ir.observation-invalid");
    exact(observation.request, REQUEST_FIELDS, "ir.observation-invalid");
    exact(observation.response, RESPONSE_FIELDS, "ir.observation-invalid");
    if (
      observation.observationId !== member.selectedObservationId ||
      observation.provider !== NVIDIA_PERSISTED_PROVIDER_ID ||
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
      throw new LoaderFailure("ir.observation-invalid");
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
      throw new LoaderFailure("ir.observation-invalid");
    }
    return observation;
  } catch (error) {
    if (error instanceof LoaderFailure) throw error;
    throw new LoaderFailure("ir.observation-invalid");
  }
}
async function readBoundedNvidiaMember(
  store: ArtifactStore,
  member: NvidiaRetrievedMemberV2,
): Promise<Buffer> {
  let verified: VerifiedArtifactRead;
  try {
    verified = await store.read(member.artifactHash);
  } catch {
    throw new LoaderFailure("ir.artifact-read-failed");
  }
  if (verified.artifact.sizeBytes > NVIDIA_IR_LIMITS.memberBytes) {
    verified.stream.destroy();
    throw new LoaderFailure("ir.member-limit-exceeded");
  }
  if (
    verified.artifact.digest !== member.artifactHash ||
    verified.artifact.algorithm !== "sha256" ||
    verified.artifact.sizeBytes !== member.sizeBytes
  ) {
    verified.stream.destroy();
    throw new LoaderFailure("ir.bundle-hash-mismatch");
  }
  const bytes = Buffer.allocUnsafe(member.sizeBytes);
  const hash = createHash("sha256");
  let consumed = 0;
  try {
    for await (const chunk of verified.stream) {
      if (!(chunk instanceof Uint8Array)) throw new Error("artifact stream emitted non-bytes");
      if (chunk.byteLength > member.sizeBytes - consumed) {
        throw new LoaderFailure("ir.bundle-hash-mismatch");
      }
      bytes.set(chunk, consumed);
      hash.update(chunk);
      consumed += chunk.byteLength;
    }
  } catch (error) {
    verified.stream.destroy();
    if (error instanceof LoaderFailure) throw error;
    throw new LoaderFailure("ir.artifact-read-failed");
  }
  if (consumed !== member.sizeBytes || hash.digest("hex") !== member.artifactHash) {
    throw new LoaderFailure("ir.bundle-hash-mismatch");
  }
  return bytes;
}
function finish(
  caseId: string,
  members: readonly NvidiaRetrievedMemberV2[],
  observations: readonly ArtifactObservation[],
  proofs: readonly NvidiaDerivedProofV1[],
  normalization: NvidiaNormalizationResult | null,
  reasonCode: NvidiaIrReasonCode | null,
): NvidiaFixtureLoadResult {
  const status = normalization?.status ?? "quarantined";
  const transcript: NvidiaLoaderTranscriptV2 = {
    loader: LOADER,
    caseId,
    observationIds: members.map((member) => member.selectedObservationId),
    observationHashes: observations.map((observation) => observation.observationHash),
    artifactHashes: members.map((member) => member.artifactHash),
    projectionHashes: [...proofs]
      .sort((left, right) => left.role.localeCompare(right.role))
      .map((proof) => proof.projectionHash),
    status,
    reasonCode,
  };
  assertNvidiaDeclaredLimit(
    "transcript-bytes",
    Buffer.byteLength(canonicalJson(transcript as unknown as JsonValue), "utf8"),
  );
  return {
    normalization,
    status,
    reasonCode,
    transcript,
    transcriptHash: canonicalHash(
      "peas/nvidia-recorded-fixture-transcript/v2",
      transcript as unknown as JsonValue,
    ),
  };
}
function expectedMatches(
  manifest: NvidiaFixtureManifestV2,
  result: NvidiaNormalizationResult,
): boolean {
  const expected = manifest.expected;
  const reasonCode = result.status === "emitted" ? null : result.reasonCode;
  if (
    result.status !== expected.status ||
    reasonCode !== expected.reasonCode ||
    result.transcript.limitKind !== expected.limitKind
  )
    return false;
  if (result.status !== "emitted") return true;
  const candidate = result.candidate;
  return (
    expected.recordId === candidate.providerRecordId &&
    expected.revisionId === candidate.providerRevisionId &&
    expected.issuerCik === candidate.issuerCik &&
    expected.symbol === candidate.symbol &&
    expected.fiscalPeriod === candidate.fiscalPeriod &&
    expected.sourceKind === candidate.sourceKind &&
    expected.publishedAtMs === candidate.publishedAtMs &&
    expected.timestampConfidence === candidate.timestampConfidence &&
    expected.originalTimestamp === candidate.originalTimestamp &&
    expected.primaryArtifactHash === candidate.primaryArtifactHash &&
    expected.selectedProjectionHash === candidate.selectedProjectionHash &&
    expected.routeHash === candidate.routeHash &&
    expected.candidateHash === result.transcript.candidateHash &&
    expected.eventDraftHash === result.transcript.eventDraftHash
  );
}

/** Offline-only loader: validates fixture declarations, verifies two members/proofs, then normalizes. */
export async function loadRecordedNvidiaFixture(
  store: ArtifactStore,
  value: NvidiaFixtureManifestV2,
): Promise<NvidiaFixtureLoadResult> {
  let manifest: NvidiaFixtureManifestV2;
  try {
    manifest = validateManifest(value);
  } catch (error) {
    const reason = error instanceof LoaderFailure ? error.reasonCode : "ir.bundle-invalid";
    return finish("invalid-manifest", [], [], [], null, reason);
  }
  const observations: ArtifactObservation[] = [];
  let observationInvalid = false;
  for (const member of manifest.retrievedMembers) {
    try {
      observations.push(
        validateArtifactObservation(
          await store.getObservation(member.selectedObservationId),
          member,
          manifest.asOfMs,
        ),
      );
    } catch {
      observationInvalid = true;
    }
  }
  if (observationInvalid) {
    return finish(manifest.caseId, [], [], [], null, "ir.observation-invalid");
  }
  try {
    const loaded = await Promise.all(
      manifest.retrievedMembers.map(async (member) => {
        const bytes = await readBoundedNvidiaMember(store, member);
        if (
          bytes.byteLength !== member.sizeBytes ||
          createHash("sha256").update(bytes).digest("hex") !== member.artifactHash
        )
          throw new LoaderFailure("ir.bundle-hash-mismatch");
        return { role: member.role, bytes };
      }),
    );
    const rssBytes = loaded.find((entry) => entry.role === "ir.rss-feed")?.bytes;
    const releaseHtmlBytes = loaded.find((entry) => entry.role === "ir.release-html")?.bytes;
    if (rssBytes === undefined || releaseHtmlBytes === undefined)
      throw new LoaderFailure("ir.bundle-invalid");
    const result = normalizeRecordedNvidiaIr({
      rssBytes,
      releaseHtmlBytes,
      selectionKey: manifest.selector.selectionKey,
    });
    if (result.status === "emitted") {
      const rssProjectionHash = result.transcript.rssItemProjectionHash;
      const releaseProjectionHash = result.transcript.releaseVisibleProjectionHash;
      if (rssProjectionHash === null || releaseProjectionHash === null)
        throw new LoaderFailure("ir.bundle-hash-mismatch");
      const actual = new Map<NvidiaDerivedProofV1["role"], { hash: string; size: number }>([
        [
          "ir.rss-item",
          {
            hash: rssProjectionHash,
            size: Buffer.byteLength(
              canonicalJson(result.projections.rssItem as unknown as JsonValue),
              "utf8",
            ),
          },
        ],
        [
          "ir.release-visible",
          {
            hash: releaseProjectionHash,
            size: Buffer.byteLength(
              canonicalJson(result.projections.releaseVisible as unknown as JsonValue),
              "utf8",
            ),
          },
        ],
      ]);
      const supplied = new Map<NvidiaDerivedProofV1["role"], { hash: string; size: number }>(
        manifest.derivedProofs.map((proof) => [
          proof.role,
          { hash: proof.projectionHash, size: proof.projectionSizeBytes },
        ]),
      );
      if (
        actual.size !== supplied.size ||
        [...actual].some(
          ([role, projection]) =>
            supplied.get(role)?.hash !== projection.hash ||
            supplied.get(role)?.size !== projection.size,
        ) ||
        [...supplied].some(
          ([role, projection]) =>
            actual.get(role)?.hash !== projection.hash ||
            actual.get(role)?.size !== projection.size,
        )
      )
        throw new LoaderFailure("ir.bundle-hash-mismatch");
      const recomputedProofs: NvidiaDerivedProofV1[] = [];
      for (const proof of manifest.derivedProofs) {
        const projection = actual.get(proof.role);
        if (projection === undefined) throw new LoaderFailure("ir.bundle-hash-mismatch");
        recomputedProofs.push({
          ...proof,
          projectionHash: projection.hash,
          projectionSizeBytes: projection.size,
        });
      }
      if (!expectedMatches(manifest, result)) throw new LoaderFailure("ir.bundle-hash-mismatch");
      return finish(
        manifest.caseId,
        manifest.retrievedMembers,
        observations,
        recomputedProofs,
        result,
        null,
      );
    }
    if (!expectedMatches(manifest, result)) throw new LoaderFailure("ir.bundle-hash-mismatch");
    return finish(
      manifest.caseId,
      manifest.retrievedMembers,
      observations,
      [],
      result,
      result.reasonCode,
    );
  } catch (error) {
    const reason = error instanceof LoaderFailure ? error.reasonCode : "ir.artifact-read-failed";
    return finish(manifest.caseId, manifest.retrievedMembers, observations, [], null, reason);
  }
}
