import type { ArtifactStore, StoreArtifactResult } from "../../artifacts/artifact-store.js";
import { createProviderEvidenceBundle } from "../../providers/evidence-bundle.js";
import {
  deriveSecRecordId,
  SEC_NORMALIZER_SOURCE,
  SEC_PROVIDER,
  SEC_REVISION_ID,
} from "../../providers/sec/contracts.js";
import type { RecordedSecBundleManifest } from "../sec/recorded-sec-pipeline.js";
import { retainSecSourceResult } from "./sec-artifact-bridge.js";
import type { SecFilingCandidate, SecForwardConfig, SecPlannedMember } from "./sec-forward-plan.js";
import type { ReadOnlySourceResult } from "./source-client.js";

export type SecOfflineBundleResult =
  | Readonly<{
      status: "missing";
      reasonCode: "sec-forward.member-missing";
      memberKey: string;
    }>
  | Readonly<{
      status: "complete";
      manifest: RecordedSecBundleManifest;
    }>;

export async function retainSecForwardOfflineBundle(
  options: Readonly<{
    config: SecForwardConfig;
    candidate: SecFilingCandidate;
    members: readonly SecPlannedMember[];
    results: ReadonlyMap<string, ReadOnlySourceResult>;
    artifactStore: ArtifactStore;
  }>,
): Promise<SecOfflineBundleResult> {
  const found: Array<Readonly<{ member: SecPlannedMember; result: ReadOnlySourceResult }>> = [];
  for (const member of options.members) {
    const result = options.results.get(member.url);
    if (result === undefined || result.status === "missing") {
      return Object.freeze({
        status: "missing",
        reasonCode: "sec-forward.member-missing",
        memberKey: member.memberKey,
      });
    }
    found.push(Object.freeze({ member, result }));
  }

  const recordId = deriveSecRecordId(options.candidate.accession, "sec_8k");
  const stored = new Map<string, StoreArtifactResult>();
  for (const [index, entry] of found.entries()) {
    const retained = await retainSecSourceResult({
      artifactStore: options.artifactStore,
      result: entry.result,
      attemptId: `sec-forward.${options.candidate.accession}.${index + 1}`,
      recordId: `sec-forward.${options.candidate.accession}`,
      revisionId: SEC_REVISION_ID,
      startedAtMs: Math.max(0, entry.result.retrievedAtMs - 1),
    });
    if (retained === undefined) throw new Error("sec-forward.unexpected-missing-member");
    stored.set(entry.member.memberKey, retained);
  }

  const primaryMember = options.members.find((member) => member.role === "sec.exhibit-99.1");
  if (primaryMember === undefined) throw new Error("sec-forward.primary-exhibit-missing");
  const primary = stored.get(primaryMember.memberKey);
  if (primary === undefined) throw new Error("sec-forward.primary-artifact-missing");
  const evidence = options.members.map((member) => {
    const result = stored.get(member.memberKey);
    if (result === undefined) throw new Error("sec-forward.stored-member-missing");
    return Object.freeze({ role: member.role, artifactHash: result.artifact.digest });
  });
  const bundle = createProviderEvidenceBundle({
    provider: SEC_PROVIDER,
    source: SEC_NORMALIZER_SOURCE,
    recordId,
    revisionId: SEC_REVISION_ID,
    subject: `earnings:${options.config.issuerCik}:${options.config.expectedFiscalPeriod}`,
    issuerCik: options.config.issuerCik,
    fiscalPeriod: options.config.expectedFiscalPeriod,
    sourceKind: "sec_8k",
    primaryArtifactHash: primary.artifact.digest,
    evidence,
  });
  const manifest: RecordedSecBundleManifest = Object.freeze({
    asOfMs: Math.max(...found.map((entry) => entry.result.retrievedAtMs)),
    provider: SEC_PROVIDER,
    source: SEC_NORMALIZER_SOURCE,
    recordId,
    revisionId: SEC_REVISION_ID,
    sourceKind: "sec_8k",
    accession: options.candidate.accession,
    subjectCik: options.config.issuerCik,
    fiscalPeriod: options.config.expectedFiscalPeriod,
    primaryArtifactHash: primary.artifact.digest,
    evidenceBundleHash: bundle.evidenceBundleHash,
    members: Object.freeze(
      options.members.map((member) => {
        const result = stored.get(member.memberKey);
        if (result === undefined) throw new Error("sec-forward.stored-member-missing");
        return Object.freeze({
          role: member.role,
          memberKey: member.memberKey,
          artifactHash: result.artifact.digest,
          selectedObservationId: result.observation.observationId,
        });
      }),
    ),
  });
  return Object.freeze({ status: "complete", manifest });
}
