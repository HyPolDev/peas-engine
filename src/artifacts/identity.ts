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
  kind: string;
  recordedAtMs: number;
  stagingId: string | null;
  claimedDigest: string | null;
  detailHash: string | null;
}): string {
  return canonicalHash("peas/artifact-incident-id/v1", parts);
}
