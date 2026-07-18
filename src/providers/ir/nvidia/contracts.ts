import type { EventDraft } from "../../../core/event.js";

export const NVIDIA_IR_PROVIDER = "nvidia-ir" as const;
export const NVIDIA_IR_SOURCE = "peas-recorded:nvidia-newsroom-press-release-synthetic-v1" as const;
export const NVIDIA_ISSUER_CIK = "0001045810" as const;
export const NVIDIA_SYMBOL = "NVDA" as const;

export const NVIDIA_IR_LIMITS = Object.freeze({
  memberBytes: 10 * 1_024 * 1_024,
  bundleBytes: 20 * 1_024 * 1_024,
  items: 256,
  xmlTokens: 250_000,
  htmlTokens: 250_000,
  xmlDepth: 64,
  htmlDepth: 256,
  xmlAttributes: 64,
  htmlAttributes: 256,
  categories: 32,
  extractedTextBytes: 4 * 1_024 * 1_024,
  projectionBytes: 4 * 1_024 * 1_024,
  transcriptBytes: 256 * 1_024,
  titleBytes: 4_096,
  subtitleBytes: 4_096,
  referenceBytes: 2_048,
});

export type NvidiaIrLimitKind =
  | "xml-tokens"
  | "xml-depth"
  | "xml-attributes"
  | "html-tokens"
  | "html-depth"
  | "html-attributes"
  | "extracted-text-bytes"
  | "categories";
export type NvidiaIrReasonCode =
  | "ir.not-financial-results"
  | "ir.bundle-invalid"
  | "ir.bundle-hash-mismatch"
  | "ir.observation-invalid"
  | "ir.artifact-read-failed"
  | "ir.feed-malformed"
  | "ir.item-limit-exceeded"
  | "ir.item-invalid"
  | "ir.record-family-ambiguous"
  | "ir.duplicate-guid-conflict"
  | "ir.link-invalid"
  | "ir.canonical-conflict"
  | "ir.timestamp-invalid"
  | "ir.release-malformed"
  | "ir.release-title-conflict"
  | "ir.unsupported-encoding"
  | "ir.member-limit-exceeded"
  | "ir.bundle-byte-limit-exceeded"
  | "ir.parser-limit-exceeded";
export type AllowedTagV1 =
  | "article"
  | "section"
  | "div"
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "ul"
  | "ol"
  | "li"
  | "table"
  | "thead"
  | "tbody"
  | "tr"
  | "th"
  | "td"
  | "strong"
  | "em"
  | "blockquote"
  | "br";
export type SemanticHtmlTokenV1 =
  | Readonly<{ kind: "start"; name: AllowedTagV1 }>
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "end"; name: AllowedTagV1 }>;
export type ParsedRssTimeV1 = Readonly<{ originalTimestamp: string; epochMs: number }>;
export type NvidiaRssItemProjectionV1 = Readonly<{
  projectionVersion: 1;
  dialect: "peas-nvidia-newsroom-rss-synthetic-v1";
  issuerCik: typeof NVIDIA_ISSUER_CIK;
  title: string;
  subtitle: string | null;
  contentType: "releases";
  contentTokens: readonly SemanticHtmlTokenV1[];
  description: string | null;
  categories: readonly string[];
  pubDate: ParsedRssTimeV1 | null;
  modDate: ParsedRssTimeV1 | null;
}>;
export type NvidiaReleaseVisibleProjectionV1 = Readonly<{
  projectionVersion: 1;
  dialect: "peas-nvidia-newsroom-release-visible-synthetic-v1";
  issuerCik: typeof NVIDIA_ISSUER_CIK;
  title: string;
  subtitle: string | null;
  dateText: string | null;
  bodyTokens: readonly SemanticHtmlTokenV1[];
}>;
export type NvidiaSelectedCompositeProjectionV1 = Readonly<{
  projectionVersion: 1;
  dialect: "peas-nvidia-newsroom-selected-composite-synthetic-v1";
  rssItemProjectionHash: string;
  releaseVisibleProjectionHash: string;
}>;
export type NvidiaRecordedCandidateV1 = Readonly<{
  candidateVersion: 1;
  provider: typeof NVIDIA_IR_PROVIDER;
  source: typeof NVIDIA_IR_SOURCE;
  sourceKind: "issuer_release";
  providerRecordId: string;
  providerRevisionId: string;
  issuerCik: typeof NVIDIA_ISSUER_CIK;
  symbol: typeof NVIDIA_SYMBOL;
  fiscalPeriod: string;
  primaryArtifactHash: string;
  selectedProjectionHash: string;
  routeHash: string;
  publishedAtMs: number | null;
  timestampConfidence: "provider" | "unknown";
  originalTimestamp: string | null;
}>;
export type NvidiaNormalizationTranscript = Readonly<{
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: NvidiaIrReasonCode | null;
  limitKind: NvidiaIrLimitKind | null;
  rssArtifactHash: string;
  releaseHtmlArtifactHash: string;
  rssItemProjectionHash: string | null;
  releaseVisibleProjectionHash: string | null;
  selectedProjectionHash: string | null;
  candidateHash: string | null;
  eventDraftHash: string | null;
}>;
export type NvidiaNormalizationResult =
  | Readonly<{
      status: "emitted";
      candidate: NvidiaRecordedCandidateV1;
      draft: EventDraft;
      projections: Readonly<{
        rssItem: NvidiaRssItemProjectionV1;
        releaseVisible: NvidiaReleaseVisibleProjectionV1;
      }>;
      transcript: NvidiaNormalizationTranscript;
    }>
  | Readonly<{
      status: "ignored" | "quarantined";
      reasonCode: NvidiaIrReasonCode;
      transcript: NvidiaNormalizationTranscript;
    }>;
export type NvidiaRecordedInput = Readonly<{
  rssBytes: Uint8Array;
  releaseHtmlBytes: Uint8Array;
  selectionKey: string;
}>;

export class NvidiaContractError extends Error {
  constructor(
    readonly reasonCode: NvidiaIrReasonCode,
    readonly limitKind: NvidiaIrLimitKind | null = null,
  ) {
    super(reasonCode);
    this.name = "NvidiaContractError";
  }
}
