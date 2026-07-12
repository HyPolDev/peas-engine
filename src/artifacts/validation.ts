import { z } from "zod";

import type {
  ArtifactVaultConfig,
  RetrievalAttemptDraft,
  SafeHttpResponseMetadata,
} from "./artifact-store.js";
import { canonicalHash } from "../core/hash.js";

const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const epochMs = z.number().int().nonnegative().safe();
const safeSize = z.number().int().nonnegative().safe();
const opaqueHeader = z
  .string()
  .max(512)
  .regex(/^[\x20-\x7e]*$/u)
  .refine(
    (value) => !/[/?#@]/u.test(value) && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value),
    "unsafe persisted metadata",
  );
const httpDate = z
  .string()
  .max(64)
  .regex(
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/u,
  );
const mediaType = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[ A-Za-z0-9!#$&^_.+=-]+)*$/u);
const contentEncoding = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const safeOrigin = z
  .string()
  .max(2_048)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (
        !/^https?:$/u.test(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.origin !== value
      )
        context.addIssue({
          code: "custom",
          message: "origin must contain only HTTP(S) scheme, host, and optional port",
        });
    } catch {
      context.addIssue({ code: "custom", message: "invalid origin" });
    }
  });
const request = z
  .object({
    method: z
      .string()
      .regex(/^[A-Z]+$/u)
      .max(32),
    origin: safeOrigin,
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
    etag: opaqueHeader.nullable(),
    lastModified: httpDate.nullable(),
    mediaType: mediaType.nullable(),
    contentEncoding: contentEncoding.nullable(),
    declaredContentLength: safeSize.nullable(),
    transportDecoded: z.literal(true),
  })
  .strict();

export function assertArtifactDigest(value: string): void {
  digest.parse(value);
}

export function validateRetrievalAttempt(value: unknown): RetrievalAttemptDraft {
  const parsed = attempt.parse(value);
  return {
    ...parsed,
    attemptId: persistedIdentifier("attempt", parsed.attemptId),
    provider: persistedIdentifier("provider", parsed.provider),
    recordId: persistedIdentifier("record", parsed.recordId),
    revisionId: persistedIdentifier("revision", parsed.revisionId),
  } as RetrievalAttemptDraft;
}

export function persistedRetrievalAttemptId(value: string): string {
  return persistedIdentifier("attempt", identifier.parse(value));
}

function persistedIdentifier(
  kind: "attempt" | "provider" | "record" | "revision",
  value: string,
): string {
  return canonicalHash(`peas/artifact-${kind}-identifier/v1`, { value });
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
      writerLeaseDurationMs: z.number().int().min(2).safe(),
      writerLeaseRenewalMs: z.number().int().min(1).safe(),
    })
    .strict()
    .parse(value);
  if (parsed.maxArtifactBytes > parsed.maxVaultBytes) {
    throw new RangeError("maxArtifactBytes cannot exceed maxVaultBytes");
  }
  if (parsed.writerLeaseRenewalMs * 2 > parsed.writerLeaseDurationMs) {
    throw new RangeError("writerLeaseRenewalMs must be at most half writerLeaseDurationMs");
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
