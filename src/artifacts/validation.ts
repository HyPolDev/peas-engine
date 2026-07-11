import { z } from "zod";

import type {
  ArtifactVaultConfig,
  RetrievalAttemptDraft,
  SafeHttpResponseMetadata,
} from "./artifact-store.js";

const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const identifier = z.string().min(1).max(512);
const epochMs = z.number().int().nonnegative().safe();
const safeSize = z.number().int().nonnegative().safe();
const nullableHeader = z.string().max(8_192).nullable();
const request = z
  .object({
    method: z
      .string()
      .regex(/^[A-Z]+$/u)
      .max(32),
    origin: z.string().url().max(2_048),
    pathHash: digest,
    routeLabel: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/u),
    identityHash: digest,
  })
  .strict();

const attempt = z
  .object({
    attemptId: identifier,
    provider: identifier,
    recordId: identifier,
    revisionId: identifier,
    startedAtMs: epochMs,
    request,
  })
  .strict();

const response = z
  .object({
    statusCode: z.number().int().min(100).max(599),
    etag: nullableHeader,
    lastModified: nullableHeader,
    mediaType: nullableHeader,
    contentEncoding: nullableHeader,
    declaredContentLength: safeSize.nullable(),
    transportDecoded: z.literal(true),
  })
  .strict();

export function assertArtifactDigest(value: string): void {
  digest.parse(value);
}

export function validateRetrievalAttempt(value: unknown): RetrievalAttemptDraft {
  return attempt.parse(value) as RetrievalAttemptDraft;
}

export function validateHttpResponseMetadata(value: unknown): SafeHttpResponseMetadata {
  return response.parse(value) as SafeHttpResponseMetadata;
}

export function validateVaultConfig(value: ArtifactVaultConfig): ArtifactVaultConfig {
  const parsed = z
    .object({
      runtimeRoot: z.string().min(1),
      maxArtifactBytes: safeSize,
      maxVaultBytes: safeSize,
      maxConcurrentWrites: z.number().int().min(1).max(1_024).safe(),
      streamHighWaterMarkBytes: z
        .number()
        .int()
        .min(1)
        .max(16 * 1_024 * 1_024)
        .safe(),
      stageExpiryMs: safeSize,
      writerLeaseBehavior: z.enum(["fail", "wait"]),
      writerLeaseWaitMs: safeSize,
    })
    .strict()
    .parse(value);
  if (parsed.maxArtifactBytes > parsed.maxVaultBytes) {
    throw new RangeError("maxArtifactBytes cannot exceed maxVaultBytes");
  }
  return parsed;
}

export function assertSafeByteAddition(current: number, increment: number): number {
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(increment) || increment < 0) {
    throw new RangeError("Artifact byte count must remain a nonnegative safe integer");
  }
  const next = current + increment;
  if (!Number.isSafeInteger(next)) throw new RangeError("Artifact byte count overflow");
  return next;
}
