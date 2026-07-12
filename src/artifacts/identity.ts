import { canonicalHash } from "../core/hash.js";
import type {
  ArtifactDigest,
  RetrievalAttemptDraft,
  SafeHttpResponseMetadata,
  SanitizedRequestIdentity,
} from "./artifact-store.js";

export function sanitizeRequestIdentity(input: {
  method: string;
  origin: string;
  path: string;
  routeLabel: string;
}): SanitizedRequestIdentity {
  const url = new URL(input.origin);
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Request origin must contain only scheme, host, and optional port");
  }
  const method = input.method.toUpperCase();
  const origin = url.origin;
  const sanitizedPath = new URL(input.path, "https://path.invalid").pathname;
  const pathHash = canonicalHash("peas/artifact-request-path/v1", { path: sanitizedPath });
  const identityHash = canonicalHash("peas/artifact-request-identity/v1", {
    method,
    origin,
    pathHash,
    routeLabel: input.routeLabel,
  });
  return { method, origin, pathHash, routeLabel: input.routeLabel, identityHash };
}

export function deriveObservationId(
  attempt: RetrievalAttemptDraft,
  digest: ArtifactDigest,
  response: SafeHttpResponseMetadata,
): string {
  return canonicalHash("peas/artifact-observation-id/v1", {
    attemptId: attempt.attemptId,
    artifactDigest: digest,
    response: { ...response },
  });
}

export function deriveIncidentId(parts: {
  actionKey: string;
  kind: string;
  facts: unknown;
}): string {
  return `inc1_${canonicalHash("peas/artifact-incident/v2", parts as never)}`;
}

export function deriveReconciliationRunId(runSeed: unknown): string {
  return `rr1_${canonicalHash("peas/artifact-reconciliation-run/v1", runSeed as never)}`;
}

export function deriveReconciliationCursor(cursorState: unknown): string {
  return `rc1_${canonicalHash("peas/artifact-reconciliation-cursor/v1", cursorState as never)}`;
}

export function deriveReconciliationCallKey(callInput: unknown): string {
  return `rcl1_${canonicalHash("peas/artifact-reconciliation-call/v1", callInput as never)}`;
}

export function deriveReconciliationWorkKey(workIdentity: unknown): string {
  return `wrk1_${canonicalHash("peas/artifact-reconciliation-work/v1", workIdentity as never)}`;
}

export function deriveReconciliationActionKey(actionPlan: unknown): string {
  return `act1_${canonicalHash("peas/artifact-reconciliation-action/v1", actionPlan as never)}`;
}

export function deriveQuarantineName(actionKey: string, incidentId: string): string {
  return `q1_${canonicalHash("peas/artifact-quarantine/v1", { actionKey, incidentId })}.quarantined`;
}

export function deriveInstallIntentId(immutableIntent: unknown): string {
  return `ins1_${canonicalHash("peas/artifact-install-intent/v1", immutableIntent as never)}`;
}

export function deriveInstallTransitionId(intentId: string, state: string): string {
  return `ist1_${canonicalHash("peas/artifact-install-transition/v1", { intentId, state })}`;
}
