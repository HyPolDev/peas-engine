import type { EventDraft } from "../../core/event.js";

export const FMP_PROVIDER = "financial-modeling-prep";
export const FMP_RECORDED_SOURCE = "peas-recorded:fmp-press-release-synthetic-v1";
export const FMP_RECORDED_DIALECT = "peas-fmp-press-release-synthetic-v1";
export const FMP_RECORD_DOMAIN = "peas/fmp-recorded-synthetic-press-release-record/v1";
export const FMP_REVISION_DOMAIN = "peas/fmp-recorded-synthetic-press-release-revision/v1";
export const FMP_PROJECTION_DOMAIN = "peas/provider-derived-content/v1";
export const FMP_ROUTE_DOMAIN = "peas/fmp-recorded-synthetic-route/v1";
export const RECORDED_CANDIDATE_DOMAIN = "peas/recorded-press-release-candidate/v1";
export const RECORDED_DRAFT_DOMAIN = "peas/recorded-press-release-event-draft/v1";

export const FMP_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const FMP_MAX_ITEMS = 1_000;
export const FMP_MAX_JSON_TOKENS = 250_000;
export const FMP_MAX_JSON_DEPTH = 64;
export const FMP_MAX_DECODED_BYTES = 8 * 1024 * 1024;
export const FMP_MAX_TRANSCRIPT_BYTES = 256 * 1024;

export const FMP_REASON_CODES = Object.freeze([
  "fmp.not-earnings-related",
  "fmp.issuer-unmapped",
  "fmp.response-invalid",
  "fmp.item-invalid",
  "fmp.identity-invalid",
  "fmp.duplicate-conflict",
  "fmp.observation-invalid",
  "fmp.artifact-read-failed",
  "fmp.bundle-hash-mismatch",
  "fmp.response-byte-limit-exceeded",
  "fmp.item-limit-exceeded",
  "fmp.parse-limit-exceeded",
  "fmp.string-limit-exceeded",
  "fmp.unsupported-encoding",
  "fmp.malformed-json",
  "fmp.timestamp-invalid",
] as const);
export type FmpReasonCode = (typeof FMP_REASON_CODES)[number];
export type FmpLimitKind = "json-tokens" | "json-depth" | "object-keys" | "decoded-string-bytes";

export type FmpSelectedProjectionV1 = Readonly<{
  projectionVersion: 1;
  dialect: typeof FMP_RECORDED_DIALECT;
  symbol: string;
  publishedDate: string | null;
  title: string;
  text: string;
}>;

export type FmpSelectorV1 = Readonly<{ recordId: string; revisionId: string }>;

export type FmpRecordedRouteV1 = Readonly<{
  classification: "earnings-release" | "not-earnings-release";
  issuerMapping: null | Readonly<{
    issuerCik: string;
    symbol: string;
    fiscalPeriod: string;
  }>;
  mappingAuthority: string;
  mappingVersion: string;
}>;

export type RecordedPressReleaseCandidateV1 = Readonly<{
  candidateVersion: 1;
  provider: typeof FMP_PROVIDER;
  source: typeof FMP_RECORDED_SOURCE;
  sourceKind: "fmp_release";
  providerRecordId: string;
  providerRevisionId: string;
  issuerCik: string;
  symbol: string;
  fiscalPeriod: string;
  primaryArtifactHash: string;
  selectedProjectionHash: string;
  routeHash: string;
  publishedAtMs: number | null;
  timestampConfidence: "provider" | "unknown";
  originalTimestamp: string | null;
}>;

export type FmpEventPayloadV1 = Readonly<{
  issuerCik: string;
  fiscalPeriod: string;
  sourceKind: "fmp_release";
  artifactHash: string;
  publishedAtMs: number | null;
  timestampConfidence: "provider" | "unknown";
  originalTimestamp: string | null;
}>;

export type RecordedFmpEventDraftV1 = EventDraft<FmpEventPayloadV1> &
  Readonly<{
    envelopeVersion: 2;
    type: "earnings.source.observed";
    schemaVersion: 1;
    source: typeof FMP_RECORDED_SOURCE;
  }>;

export type FmpNormalizationResult =
  | Readonly<{
      status: "emitted";
      reasonCode: null;
      limitKind: null;
      primaryArtifactHash: string;
      recordId: string;
      revisionId: string;
      projection: FmpSelectedProjectionV1;
      selectedProjectionHash: string;
      routeHash: string;
      candidate: RecordedPressReleaseCandidateV1;
      candidateHash: string;
      draft: RecordedFmpEventDraftV1;
      eventDraftHash: string;
    }>
  | Readonly<{
      status: "ignored" | "quarantined";
      reasonCode: FmpReasonCode;
      limitKind: FmpLimitKind | null;
      primaryArtifactHash: string | null;
      candidate: null;
      draft: null;
    }>;
