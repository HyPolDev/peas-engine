import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalHash } from "../../../core/hash.js";
import {
  assertJsonWithinLimits,
  canonicalJson,
  inertJsonSnapshot,
  type JsonValue,
} from "../../../core/json.js";
import {
  NVIDIA_IR_PROVIDER,
  NVIDIA_IR_SOURCE,
  type NvidiaIrReasonCode,
  type NvidiaNormalizationResult,
} from "../../../providers/ir/nvidia/contracts.js";
import {
  assertNvidiaDeclaredLimit,
  normalizeRecordedNvidiaIr,
} from "../../../providers/ir/nvidia/normalizer.js";

const SHA256 = /^[0-9a-f]{64}$/u;
const LOADER = "nvidia-recorded-fixture-loader-v1" as const;
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
  "path",
  "artifactHash",
  "sizeBytes",
  "selectedObservationId",
  "observation",
] as const;
const OBSERVATION_FIELDS = [
  "provider",
  "artifactDigest",
  "retrievedAtMs",
  "observationHash",
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

export type NvidiaRetrievedMemberV1 = Readonly<{
  kind: "retrieved";
  role: "ir.rss-feed" | "ir.release-html";
  path: string;
  artifactHash: string;
  sizeBytes: number;
  selectedObservationId: string;
  observation: Readonly<{
    provider: "nvidia-ir";
    artifactDigest: string;
    retrievedAtMs: number;
    observationHash: string;
  }>;
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
export type NvidiaFixtureManifestV1 = Readonly<{
  schemaVersion: 1;
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
  retrievedMembers: readonly NvidiaRetrievedMemberV1[];
  derivedProofs: readonly NvidiaDerivedProofV1[];
  expected: NvidiaFixtureExpectedV1;
  provenance: Readonly<{
    classification: "synthetic" | "redistribution-approved";
    note: string;
    approvalReference: string | null;
  }>;
}>;
export type NvidiaLoaderTranscriptV1 = Readonly<{
  loader: typeof LOADER;
  caseId: string;
  observationIds: readonly string[];
  artifactHashes: readonly string[];
  projectionHashes: readonly string[];
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: NvidiaIrReasonCode | null;
}>;
export type NvidiaFixtureLoadResult = Readonly<{
  normalization: NvidiaNormalizationResult | null;
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: NvidiaIrReasonCode | null;
  transcript: NvidiaLoaderTranscriptV1;
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
function validateManifest(value: NvidiaFixtureManifestV1): NvidiaFixtureManifestV1 {
  try {
    assertJsonWithinLimits(value, {
      maxDepth: 8,
      maxNodes: 256,
      maxArrayLength: 8,
      maxObjectKeys: 32,
      maxStringBytes: 8_192,
      maxCanonicalBytes: 256 * 1_024,
    });
    const manifest = inertJsonSnapshot(value as unknown as JsonValue) as NvidiaFixtureManifestV1;
    exact(manifest, MANIFEST_FIELDS, "ir.bundle-invalid");
    exact(manifest.selector, SELECTOR_FIELDS, "ir.bundle-invalid");
    exact(manifest.route, ROUTE_FIELDS, "ir.bundle-invalid");
    exact(manifest.expected, EXPECTED_FIELDS, "ir.bundle-invalid");
    exact(manifest.provenance, PROVENANCE_FIELDS, "ir.bundle-invalid");
    if (
      manifest.schemaVersion !== 1 ||
      manifest.provider !== NVIDIA_IR_PROVIDER ||
      manifest.source !== NVIDIA_IR_SOURCE ||
      manifest.acquisitionVariant !== "rss" ||
      !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(manifest.caseId) ||
      !Number.isSafeInteger(manifest.asOfMs) ||
      manifest.asOfMs < 0 ||
      manifest.retrievedMembers.length !== 2 ||
      manifest.selector.selectionKey.length > 2_048 ||
      manifest.route.classificationPolicy !== "nvidia-financial-results-title-v1" ||
      manifest.route.issuerCik !== "0001045810" ||
      manifest.route.symbol !== "NVDA" ||
      manifest.route.mappingAuthority !== "peas-static-nvidia-v1" ||
      manifest.route.mappingVersion !== "1" ||
      manifest.provenance.classification !== "synthetic" ||
      manifest.provenance.approvalReference !== null
    )
      throw new LoaderFailure("ir.bundle-invalid");
    if (manifest.derivedProofs.length !== 2) throw new LoaderFailure("ir.bundle-hash-mismatch");
    const roles = new Set<string>();
    const observationIds = new Set<string>();
    for (const member of manifest.retrievedMembers) {
      exact(member, MEMBER_FIELDS, "ir.bundle-invalid");
      exact(member.observation, OBSERVATION_FIELDS, "ir.observation-invalid");
      if (
        member.kind !== "retrieved" ||
        !["ir.rss-feed", "ir.release-html"].includes(member.role) ||
        roles.has(member.role) ||
        !SHA256.test(member.artifactHash) ||
        !SHA256.test(member.selectedObservationId) ||
        observationIds.has(member.selectedObservationId) ||
        !Number.isSafeInteger(member.sizeBytes) ||
        member.sizeBytes < 0 ||
        member.observation.provider !== NVIDIA_IR_PROVIDER ||
        member.observation.artifactDigest !== member.artifactHash ||
        !SHA256.test(member.observation.observationHash) ||
        !Number.isSafeInteger(member.observation.retrievedAtMs) ||
        member.observation.retrievedAtMs < 0 ||
        member.observation.retrievedAtMs > manifest.asOfMs
      )
        throw new LoaderFailure("ir.observation-invalid");
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
        !SHA256.test(proof.projectionHash) ||
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
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
async function confined(root: string, fixturePath: string): Promise<string> {
  if (
    path.isAbsolute(fixturePath) ||
    path.win32.isAbsolute(fixturePath) ||
    path.posix.isAbsolute(fixturePath) ||
    fixturePath.includes("\\")
  )
    throw new LoaderFailure("ir.artifact-read-failed");
  const parts = fixturePath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new LoaderFailure("ir.artifact-read-failed");
  const rootReal = await realpath(root);
  let current = rootReal;
  for (const part of parts) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new LoaderFailure("ir.artifact-read-failed");
    current = await realpath(current);
    if (!inside(rootReal, current)) throw new LoaderFailure("ir.artifact-read-failed");
  }
  return current;
}
function finish(
  caseId: string,
  members: readonly NvidiaRetrievedMemberV1[],
  proofs: readonly NvidiaDerivedProofV1[],
  normalization: NvidiaNormalizationResult | null,
  reasonCode: NvidiaIrReasonCode | null,
): NvidiaFixtureLoadResult {
  const status = normalization?.status ?? "quarantined";
  const transcript: NvidiaLoaderTranscriptV1 = {
    loader: LOADER,
    caseId,
    observationIds: members.map((member) => member.selectedObservationId),
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
      "peas/nvidia-recorded-fixture-transcript/v1",
      transcript as unknown as JsonValue,
    ),
  };
}
function expectedMatches(
  manifest: NvidiaFixtureManifestV1,
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

/** Offline-only loader: confines two recorded paths, verifies observations/proofs, then normalizes. */
export async function loadRecordedNvidiaFixture(
  options: Readonly<{ fixtureRoot: string; manifest: NvidiaFixtureManifestV1 }>,
): Promise<NvidiaFixtureLoadResult> {
  let manifest: NvidiaFixtureManifestV1;
  try {
    manifest = validateManifest(options.manifest);
  } catch (error) {
    const reason = error instanceof LoaderFailure ? error.reasonCode : "ir.bundle-invalid";
    return finish("invalid-manifest", [], [], null, reason);
  }
  try {
    const loaded = await Promise.all(
      manifest.retrievedMembers.map(async (member) => {
        const bytes = await readFile(await confined(options.fixtureRoot, member.path));
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
      return finish(manifest.caseId, manifest.retrievedMembers, recomputedProofs, result, null);
    }
    if (!expectedMatches(manifest, result)) throw new LoaderFailure("ir.bundle-hash-mismatch");
    return finish(manifest.caseId, manifest.retrievedMembers, [], result, result.reasonCode);
  } catch (error) {
    const reason = error instanceof LoaderFailure ? error.reasonCode : "ir.artifact-read-failed";
    return finish(manifest.caseId, manifest.retrievedMembers, [], null, reason);
  }
}
