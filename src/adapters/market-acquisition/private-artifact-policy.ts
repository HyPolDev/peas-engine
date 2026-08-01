import { resolve } from "node:path";

import { assertArtifactDigest } from "../../artifacts/validation.js";
import {
  artifactRuntimePaths,
  assertPathBelowRuntimeRoot,
  configuredPeasRuntimeRoot,
} from "../artifacts/runtime-root.js";
import { safeChild } from "../artifacts/trusted-filesystem.js";

export const ALPACA_RETENTION_POLICY_ID = "p1-10-alpaca-private-retention-v1";
export const FMP_RETENTION_POLICY_ID = "p1-10-fmp-private-retention-disabled-v1";
export const ALPACA_MAX_RETENTION_DAYS = 3_650;
export const ALPACA_STOP_GRACE_DAYS = 30;
export const UTC_DAY_MS = 86_400_000;

export type ProviderRetentionLane = "alpaca" | "fmp";

export type PrivateArtifactPolicy = Readonly<{
  policyId: string;
  providerLane: ProviderRetentionLane;
  maximumRetentionMs: number;
  stopGraceMs: number;
  enabled: boolean;
}>;

export const ALPACA_PRIVATE_ARTIFACT_POLICY: PrivateArtifactPolicy = Object.freeze({
  policyId: ALPACA_RETENTION_POLICY_ID,
  providerLane: "alpaca",
  maximumRetentionMs: ALPACA_MAX_RETENTION_DAYS * UTC_DAY_MS,
  stopGraceMs: ALPACA_STOP_GRACE_DAYS * UTC_DAY_MS,
  enabled: true,
});

export const FMP_PRIVATE_ARTIFACT_POLICY: PrivateArtifactPolicy = Object.freeze({
  policyId: FMP_RETENTION_POLICY_ID,
  providerLane: "fmp",
  maximumRetentionMs: ALPACA_MAX_RETENTION_DAYS * UTC_DAY_MS,
  stopGraceMs: 0,
  enabled: false,
});

export function retentionExpiryMs(
  policy: PrivateArtifactPolicy,
  trustedCaptureMs: number,
  earlierProviderDeadlineMs: number | null,
): number {
  if (!Number.isSafeInteger(trustedCaptureMs) || trustedCaptureMs < 0)
    throw new RangeError("Trusted capture time is invalid");
  if (
    earlierProviderDeadlineMs !== null &&
    (!Number.isSafeInteger(earlierProviderDeadlineMs) || earlierProviderDeadlineMs < 0)
  )
    throw new RangeError("Provider deadline is invalid");
  const maximum = trustedCaptureMs + policy.maximumRetentionMs;
  if (!Number.isSafeInteger(maximum)) throw new RangeError("Retention expiry exceeds safe time");
  return earlierProviderDeadlineMs === null
    ? maximum
    : Math.min(maximum, earlierProviderDeadlineMs);
}

export function retentionStopDeadlineMs(
  policy: PrivateArtifactPolicy,
  effectiveStopMs: number,
  earlierProviderDeadlineMs: number | null,
): number {
  if (!Number.isSafeInteger(effectiveStopMs) || effectiveStopMs < 0)
    throw new RangeError("Effective stop time is invalid");
  const graceDeadline = effectiveStopMs + policy.stopGraceMs;
  if (!Number.isSafeInteger(graceDeadline)) throw new RangeError("Stop deadline exceeds safe time");
  return earlierProviderDeadlineMs === null
    ? graceDeadline
    : Math.min(graceDeadline, earlierProviderDeadlineMs);
}

export function digestContentPath(runtimeRoot: string, digest: string): string {
  assertArtifactDigest(digest);
  const paths = artifactRuntimePaths(resolve(runtimeRoot));
  const result = safeChild(paths.content, digest.slice(0, 2), digest.slice(2, 4), digest);
  assertPathBelowRuntimeRoot(paths.runtimeRoot, result);
  return result;
}

export function configuredDigestContentPath(
  digest: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return digestContentPath(configuredPeasRuntimeRoot(process.platform, environment), digest);
}
