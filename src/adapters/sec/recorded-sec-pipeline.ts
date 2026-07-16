import type {
  ArtifactObservation,
  ArtifactStore,
  VerifiedArtifactRead,
} from "../../artifacts/artifact-store.js";
import { validateEventDraft, type AppendResult, type EventLog } from "../../core/event.js";
import { canonicalHash } from "../../core/hash.js";
import {
  canonicalJson,
  deepFreezeJson,
  inertJsonSnapshot,
  type JsonValue,
} from "../../core/json.js";
import {
  SEC_MAX_BUNDLE_BYTES,
  SEC_MAX_MEMBER_BYTES,
  SEC_MAX_TRANSCRIPT_BYTES,
  SEC_NORMALIZER_SOURCE,
  SEC_PROVIDER,
  SEC_REVISION_ID,
  type SecParseLimitKind,
  type SecReasonCode,
  type SecSourceKind,
} from "../../providers/sec/contracts.js";
import {
  normalizeSecBundle,
  SEC_NORMALIZER_POLICY,
  type SecNormalizationResult,
  type SecNormalizerPolicy,
  type VerifiedSecBundle,
  type VerifiedSecMember,
} from "../../providers/sec/normalizer.js";

export const SEC_RECORDED_LOADER_IDENTITY = "sec-recorded-loader-v1";
export const SEC_LOADER_SELECTION_HASH_DOMAIN = "peas/sec-loader-selection/v1";
export const SEC_LOADER_TRANSCRIPT_HASH_DOMAIN = "peas/sec-loader-transcript/v1";
const SEC_PERSISTED_PROVIDER_ID = `prv1_${canonicalHash("peas/artifact-provider-identifier/v1", {
  value: SEC_PROVIDER,
})}`;

export type RecordedSecManifestMember = Readonly<{
  role: string;
  memberKey: string;
  artifactHash: string;
  selectedObservationId: string;
}>;

export type RecordedSecBundleManifest = Readonly<{
  asOfMs: number;
  provider: typeof SEC_PROVIDER;
  source: typeof SEC_NORMALIZER_SOURCE;
  recordId: string;
  revisionId: typeof SEC_REVISION_ID;
  sourceKind: SecSourceKind;
  accession: string;
  subjectCik: string;
  fiscalPeriod: string;
  primaryArtifactHash: string | null;
  evidenceBundleHash: string | null;
  members: readonly RecordedSecManifestMember[];
}>;

export type SecLoaderSelectedEvidence = Readonly<{
  role: string;
  artifactHash: string;
  selectedObservationId: string;
  observationHash: string | null;
  retrievedAtMs: number | null;
}>;

export type SecLoaderSelection = Readonly<{
  loader: typeof SEC_RECORDED_LOADER_IDENTITY;
  asOfMs: number;
  selectedEvidence: readonly SecLoaderSelectedEvidence[];
  selectionHash: string;
}>;

export type SecLoaderTranscript = Readonly<{
  loader: typeof SEC_RECORDED_LOADER_IDENTITY;
  selectionHash: string;
  bundleHash: string | null;
  status: "verified" | "quarantined";
  reasonCode: SecReasonCode | null;
  limitKind: SecParseLimitKind | null;
  outputHash: null;
}>;

export type VerifiedSecLoad = Readonly<{
  status: "verified";
  selection: SecLoaderSelection;
  transcript: SecLoaderTranscript;
  transcriptHash: string;
  bundle: VerifiedSecBundle;
}>;

export type QuarantinedSecLoad = Readonly<{
  status: "quarantined";
  reasonCode: SecReasonCode;
  selection: SecLoaderSelection;
  transcript: SecLoaderTranscript;
  transcriptHash: string;
}>;

export type RecordedSecLoadResult = VerifiedSecLoad | QuarantinedSecLoad;

export type RecordedSecPipelineResult =
  | Readonly<{
      status: "emitted";
      loader: VerifiedSecLoad;
      normalization: Extract<SecNormalizationResult, { status: "emitted" }>;
      capture: AppendResult;
    }>
  | Readonly<{
      status: "ignored" | "quarantined";
      loader: RecordedSecLoadResult;
      normalization: Exclude<SecNormalizationResult, { status: "emitted" }> | null;
      capture: null;
    }>;

export type SecNormalizer = (
  bundle: VerifiedSecBundle,
  policy?: SecNormalizerPolicy,
) => SecNormalizationResult;

class LoaderFailure extends Error {
  constructor(readonly reasonCode: SecReasonCode) {
    super(reasonCode);
    this.name = "LoaderFailure";
  }
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freezeJson<T>(value: T): T {
  return deepFreezeJson(inertJsonSnapshot(value as JsonValue)) as T;
}

function freezeVerifiedBundle(bundle: VerifiedSecBundle): VerifiedSecBundle {
  const members = bundle.members.map((member) =>
    Object.freeze({
      role: member.role,
      memberKey: member.memberKey,
      artifactHash: member.artifactHash,
      sizeBytes: member.sizeBytes,
      bytes: Uint8Array.from(member.bytes),
    }),
  );
  return Object.freeze({
    provider: bundle.provider,
    source: bundle.source,
    recordId: bundle.recordId,
    revisionId: bundle.revisionId,
    sourceKind: bundle.sourceKind,
    accession: bundle.accession,
    subjectCik: bundle.subjectCik,
    fiscalPeriod: bundle.fiscalPeriod,
    primaryArtifactHash: bundle.primaryArtifactHash,
    evidenceBundleHash: bundle.evidenceBundleHash,
    members: Object.freeze(members),
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new LoaderFailure("sec.bundle-invalid");
  }
  return value;
}

function optionalHash(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new LoaderFailure("sec.bundle-invalid");
  }
  return value;
}

function requiredHash(value: unknown): string {
  const hash = optionalHash(value);
  if (hash === null) throw new LoaderFailure("sec.bundle-invalid");
  return hash;
}

function detachManifest(value: RecordedSecBundleManifest): RecordedSecBundleManifest {
  let detached: RecordedSecBundleManifest;
  try {
    detached = inertJsonSnapshot(value as unknown as JsonValue) as RecordedSecBundleManifest;
  } catch {
    throw new LoaderFailure("sec.bundle-invalid");
  }
  if (!Number.isSafeInteger(detached.asOfMs) || detached.asOfMs < 0) {
    throw new LoaderFailure("sec.bundle-invalid");
  }
  if (detached.provider !== SEC_PROVIDER || detached.source !== SEC_NORMALIZER_SOURCE) {
    throw new LoaderFailure("sec.bundle-invalid");
  }
  if (detached.revisionId !== SEC_REVISION_ID) throw new LoaderFailure("sec.bundle-invalid");
  if (detached.sourceKind !== "sec_8k" && detached.sourceKind !== "filing") {
    throw new LoaderFailure("sec.bundle-invalid");
  }
  requiredString(detached.recordId);
  requiredString(detached.accession);
  requiredString(detached.subjectCik);
  requiredString(detached.fiscalPeriod);
  optionalHash(detached.primaryArtifactHash);
  optionalHash(detached.evidenceBundleHash);
  if (
    !Array.isArray(detached.members) ||
    detached.members.length < 1 ||
    detached.members.length > 16
  ) {
    throw new LoaderFailure("sec.member-limit-exceeded");
  }
  const memberKeys = new Set<string>();
  for (const member of detached.members) {
    requiredString(member.role);
    const memberKey = requiredString(member.memberKey);
    if (memberKeys.has(memberKey)) throw new LoaderFailure("sec.bundle-invalid");
    memberKeys.add(memberKey);
    requiredHash(member.artifactHash);
    requiredHash(member.selectedObservationId);
  }
  return freezeJson({
    ...detached,
    members: [...detached.members].sort(
      (left, right) =>
        codeUnitCompare(left.role, right.role) ||
        codeUnitCompare(left.artifactHash, right.artifactHash),
    ),
  });
}

function selectionFor(
  manifest: RecordedSecBundleManifest,
  observations: readonly (ArtifactObservation | undefined)[],
): SecLoaderSelection {
  const selectedEvidence = manifest.members.map((member, index) => {
    const observation = observations[index];
    return {
      role: member.role,
      artifactHash: member.artifactHash,
      selectedObservationId: member.selectedObservationId,
      observationHash: observation?.observationHash ?? null,
      retrievedAtMs: observation?.retrievedAtMs ?? null,
    };
  });
  const preimage: Omit<SecLoaderSelection, "selectionHash"> = {
    loader: SEC_RECORDED_LOADER_IDENTITY,
    asOfMs: manifest.asOfMs,
    selectedEvidence,
  };
  return freezeJson({
    ...preimage,
    selectionHash: canonicalHash(SEC_LOADER_SELECTION_HASH_DOMAIN, preimage),
  });
}

function transcriptFor(
  selectionHash: string,
  bundleHash: string | null,
  status: SecLoaderTranscript["status"],
  reasonCode: SecReasonCode | null,
): Readonly<{ transcript: SecLoaderTranscript; transcriptHash: string }> {
  const transcript = freezeJson({
    loader: SEC_RECORDED_LOADER_IDENTITY,
    selectionHash,
    bundleHash,
    status,
    reasonCode,
    limitKind: null,
    outputHash: null,
  }) as SecLoaderTranscript;
  const serialized = canonicalJson(transcript as unknown as JsonValue);
  if (Buffer.byteLength(serialized, "utf8") > SEC_MAX_TRANSCRIPT_BYTES) {
    throw new LoaderFailure("sec.member-limit-exceeded");
  }
  return freezeJson({
    transcript,
    transcriptHash: canonicalHash(SEC_LOADER_TRANSCRIPT_HASH_DOMAIN, transcript),
  });
}

function quarantine(
  manifest: RecordedSecBundleManifest,
  selection: SecLoaderSelection,
  reasonCode: SecReasonCode,
): QuarantinedSecLoad {
  const { transcript, transcriptHash } = transcriptFor(
    selection.selectionHash,
    manifest.evidenceBundleHash,
    "quarantined",
    reasonCode,
  );
  return freezeJson({
    status: "quarantined",
    reasonCode,
    selection,
    transcript,
    transcriptHash,
  });
}

function validObservation(
  observation: ArtifactObservation | undefined,
  member: RecordedSecManifestMember,
  asOfMs: number,
  selectedIds: Set<string>,
): boolean {
  if (observation === undefined || selectedIds.has(member.selectedObservationId)) return false;
  selectedIds.add(member.selectedObservationId);
  return (
    observation.observationId === member.selectedObservationId &&
    observation.provider === SEC_PERSISTED_PROVIDER_ID &&
    observation.artifactDigest === member.artifactHash &&
    observation.retrievedAtMs <= asOfMs
  );
}

async function consumeVerifiedMember(
  store: ArtifactStore,
  member: RecordedSecManifestMember,
  currentTotal: number,
): Promise<Readonly<{ member: VerifiedSecMember; total: number }>> {
  let verified: VerifiedArtifactRead;
  try {
    verified = await store.read(member.artifactHash);
  } catch {
    throw new LoaderFailure("sec.artifact-read-failed");
  }
  if (verified.artifact.digest !== member.artifactHash) {
    verified.stream.destroy();
    throw new LoaderFailure("sec.artifact-read-failed");
  }
  if (
    !Number.isSafeInteger(verified.artifact.sizeBytes) ||
    verified.artifact.sizeBytes < 0 ||
    verified.artifact.sizeBytes > SEC_MAX_MEMBER_BYTES
  ) {
    verified.stream.destroy();
    throw new LoaderFailure("sec.member-limit-exceeded");
  }
  if (currentTotal > SEC_MAX_BUNDLE_BYTES - verified.artifact.sizeBytes) {
    verified.stream.destroy();
    throw new LoaderFailure("sec.bundle-byte-limit-exceeded");
  }
  const chunks: Buffer[] = [];
  let consumed = 0;
  try {
    for await (const chunk of verified.stream) {
      if (!(chunk instanceof Uint8Array)) throw new Error("Artifact stream emitted non-bytes");
      const bytes = Buffer.from(chunk);
      if (consumed > verified.artifact.sizeBytes - bytes.byteLength) {
        throw new Error("Artifact stream exceeded verified metadata size");
      }
      consumed += bytes.byteLength;
      chunks.push(bytes);
    }
  } catch {
    verified.stream.destroy();
    throw new LoaderFailure("sec.artifact-read-failed");
  }
  if (consumed !== verified.artifact.sizeBytes) {
    throw new LoaderFailure("sec.artifact-read-failed");
  }
  const bytes = Buffer.concat(chunks, consumed);
  return {
    member: {
      role: member.role,
      memberKey: member.memberKey,
      artifactHash: member.artifactHash,
      sizeBytes: consumed,
      bytes: Uint8Array.from(bytes),
    },
    total: currentTotal + consumed,
  };
}

export async function loadRecordedSecBundle(
  store: ArtifactStore,
  value: RecordedSecBundleManifest,
): Promise<RecordedSecLoadResult> {
  let manifest: RecordedSecBundleManifest;
  try {
    manifest = detachManifest(value);
  } catch (error) {
    const reasonCode = error instanceof LoaderFailure ? error.reasonCode : "sec.bundle-invalid";
    const fallback = freezeJson({
      loader: SEC_RECORDED_LOADER_IDENTITY,
      asOfMs: 0,
      selectedEvidence: [],
      selectionHash: canonicalHash(SEC_LOADER_SELECTION_HASH_DOMAIN, {
        loader: SEC_RECORDED_LOADER_IDENTITY,
        asOfMs: 0,
        selectedEvidence: [],
      }),
    }) as SecLoaderSelection;
    const { transcript, transcriptHash } = transcriptFor(
      fallback.selectionHash,
      null,
      "quarantined",
      reasonCode,
    );
    return freezeJson({
      status: "quarantined",
      reasonCode,
      selection: fallback,
      transcript,
      transcriptHash,
    });
  }

  const observations: (ArtifactObservation | undefined)[] = [];
  for (const member of manifest.members) {
    try {
      observations.push(await store.getObservation(member.selectedObservationId));
    } catch {
      observations.push(undefined);
    }
  }
  const selection = selectionFor(manifest, observations);
  const selectedIds = new Set<string>();
  if (
    manifest.members.some(
      (member, index) =>
        !validObservation(observations[index], member, manifest.asOfMs, selectedIds),
    )
  ) {
    return quarantine(manifest, selection, "sec.observation-invalid");
  }

  const members: VerifiedSecMember[] = [];
  let total = 0;
  try {
    for (const member of manifest.members) {
      const consumed = await consumeVerifiedMember(store, member, total);
      members.push(consumed.member);
      total = consumed.total;
    }
  } catch (error) {
    return quarantine(
      manifest,
      selection,
      error instanceof LoaderFailure ? error.reasonCode : "sec.artifact-read-failed",
    );
  }

  const bundle = freezeVerifiedBundle({
    provider: manifest.provider,
    source: manifest.source,
    recordId: manifest.recordId,
    revisionId: manifest.revisionId,
    sourceKind: manifest.sourceKind,
    accession: manifest.accession,
    subjectCik: manifest.subjectCik,
    fiscalPeriod: manifest.fiscalPeriod,
    primaryArtifactHash: manifest.primaryArtifactHash,
    evidenceBundleHash: manifest.evidenceBundleHash,
    members,
  }) as VerifiedSecBundle;
  const { transcript, transcriptHash } = transcriptFor(
    selection.selectionHash,
    manifest.evidenceBundleHash,
    "verified",
    null,
  );
  return Object.freeze({ status: "verified", selection, transcript, transcriptHash, bundle });
}

export async function runRecordedSecPipeline(options: {
  artifactStore: ArtifactStore;
  eventLog: EventLog;
  manifest: RecordedSecBundleManifest;
  normalizer?: SecNormalizer;
  policy?: SecNormalizerPolicy;
}): Promise<RecordedSecPipelineResult> {
  const loader = await loadRecordedSecBundle(options.artifactStore, options.manifest);
  if (loader.status === "quarantined") {
    return Object.freeze({
      status: "quarantined",
      loader,
      normalization: null,
      capture: null,
    });
  }
  const normalization = (options.normalizer ?? normalizeSecBundle)(
    loader.bundle,
    options.policy ?? SEC_NORMALIZER_POLICY,
  );
  if (normalization.status !== "emitted") {
    return Object.freeze({
      status: normalization.status,
      loader,
      normalization,
      capture: null,
    });
  }
  const draft = validateEventDraft(normalization.draft);
  const capture = await options.eventLog.append(draft);
  return Object.freeze({ status: "emitted", loader, normalization, capture });
}
