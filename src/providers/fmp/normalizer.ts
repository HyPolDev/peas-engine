import { createHash } from "node:crypto";

import { validateEventDraft } from "../../core/event.js";
import { canonicalHash } from "../../core/hash.js";
import {
  deepFreezeJson,
  inertJsonSnapshot,
  type JsonObject,
  type JsonValue,
} from "../../core/json.js";
import {
  FMP_MAX_ITEMS,
  FMP_MAX_RESPONSE_BYTES,
  FMP_PROJECTION_DOMAIN,
  FMP_PROVIDER,
  FMP_RECORD_DOMAIN,
  FMP_RECORDED_DIALECT,
  FMP_RECORDED_SOURCE,
  FMP_REVISION_DOMAIN,
  FMP_ROUTE_DOMAIN,
  RECORDED_CANDIDATE_DOMAIN,
  RECORDED_DRAFT_DOMAIN,
  type FmpLimitKind,
  type FmpNormalizationResult,
  type FmpReasonCode,
  type FmpRecordedRouteV1,
  type FmpSelectedProjectionV1,
  type FmpSelectorV1,
  type RecordedFmpEventDraftV1,
  type RecordedPressReleaseCandidateV1,
} from "./contracts.js";
import { FmpJsonError, parseFmpJson } from "./json.js";

const ITEM_FIELDS = Object.freeze([
  "image",
  "publishedDate",
  "site",
  "symbol",
  "text",
  "title",
  "url",
]);
const EXPLICIT_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u;
const NAIVE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u;
const HTML_COMMENT = /<!--[\s\S]*?-->/gu;
const URL_TOKEN = /\bhttps?:\/\/[^\s<>"'`]+/giu;
const SEMANTIC_SPACE = /\s+/gu;

type FmpItem = Readonly<{
  symbol: string;
  publishedDate: string | null;
  title: string;
  text: string;
  site: string | null;
  image: string | null;
  url: string | null;
}>;

type Publication = Readonly<{
  publishedAtMs: number | null;
  timestampConfidence: "provider" | "unknown";
  originalTimestamp: string | null;
}>;

export type DerivedFmpItem = Readonly<{
  projection: FmpSelectedProjectionV1;
  recordId: string;
  revisionId: string;
  selectedProjectionHash: string;
  publication: Publication;
}>;

class NormalizeFailure extends Error {
  constructor(
    readonly reasonCode: FmpReasonCode,
    readonly limitKind: FmpLimitKind | null = null,
  ) {
    super(reasonCode);
    this.name = "NormalizeFailure";
  }
}

function freeze<T>(value: T): T {
  return deepFreezeJson(inertJsonSnapshot(value as JsonValue)) as T;
}

function quarantine(
  reasonCode: FmpReasonCode,
  limitKind: FmpLimitKind | null,
  primaryArtifactHash: string | null,
): FmpNormalizationResult {
  return freeze({
    status: "quarantined",
    reasonCode,
    limitKind,
    primaryArtifactHash,
    candidate: null,
    draft: null,
  });
}

function ignored(
  reasonCode: "fmp.not-earnings-related" | "fmp.issuer-unmapped",
  primaryArtifactHash: string,
): FmpNormalizationResult {
  return freeze({
    status: "ignored",
    reasonCode,
    limitKind: null,
    primaryArtifactHash,
    candidate: null,
    draft: null,
  });
}

function byteBoundedString(value: JsonValue | undefined, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new NormalizeFailure("fmp.item-invalid");
  const size = Buffer.byteLength(value, "utf8");
  if (size < minimum) throw new NormalizeFailure("fmp.item-invalid");
  if (size > maximum) throw new NormalizeFailure("fmp.string-limit-exceeded");
  return value;
}

function nullableString(value: JsonValue | undefined, maximum: number): string | null {
  if (value === null) return null;
  return byteBoundedString(value, 0, maximum);
}

function semanticText(value: string): string {
  return value
    .replace(HTML_COMMENT, " ")
    .replace(URL_TOKEN, " ")
    .replace(SEMANTIC_SPACE, " ")
    .trim();
}

function parseItem(value: JsonValue): FmpItem {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new NormalizeFailure("fmp.item-invalid");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== ITEM_FIELDS.length || keys.some((key, index) => key !== ITEM_FIELDS[index])) {
    throw new NormalizeFailure("fmp.item-invalid", "object-keys");
  }
  const item = value as JsonObject;
  const symbol = byteBoundedString(item["symbol"], 1, 32);
  if (!/^[A-Z0-9][A-Z0-9.-]*$/u.test(symbol)) {
    throw new NormalizeFailure("fmp.identity-invalid");
  }
  const published = item["publishedDate"];
  if (published !== null && typeof published !== "string") {
    throw new NormalizeFailure("fmp.item-invalid");
  }
  if (typeof published === "string" && Buffer.byteLength(published, "utf8") > 128) {
    throw new NormalizeFailure("fmp.string-limit-exceeded");
  }
  return freeze({
    symbol,
    publishedDate: published,
    title: byteBoundedString(item["title"], 1, 4_096),
    text: byteBoundedString(item["text"], 1, 4 * 1024 * 1024),
    site: nullableString(item["site"], 1_024),
    image: nullableString(item["image"], 8 * 1_024),
    url: nullableString(item["url"], 8 * 1_024),
  });
}

function publication(value: string | null): Publication {
  if (value === null || NAIVE_TIME.test(value)) {
    return freeze({
      publishedAtMs: null,
      timestampConfidence: "unknown",
      originalTimestamp: null,
    });
  }
  const match = EXPLICIT_TIME.exec(value);
  if (match === null) throw new NormalizeFailure("fmp.timestamp-invalid");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const milliseconds = Number((match[7] ?? "").padEnd(3, "0"));
  const zone = match[8];
  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    zone === undefined
  ) {
    throw new NormalizeFailure("fmp.timestamp-invalid");
  }
  const local = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const check = new Date(local);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    throw new NormalizeFailure("fmp.timestamp-invalid");
  }
  let offset = 0;
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) {
      throw new NormalizeFailure("fmp.timestamp-invalid");
    }
    offset = (zoneHour * 60 + zoneMinute) * 60_000 * (zone[0] === "+" ? 1 : -1);
  }
  const publishedAtMs = local - offset;
  if (!Number.isSafeInteger(publishedAtMs) || publishedAtMs < 0) {
    throw new NormalizeFailure("fmp.timestamp-invalid");
  }
  return freeze({ publishedAtMs, timestampConfidence: "provider", originalTimestamp: value });
}

function decode(bytes: Uint8Array): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    if (decoded.startsWith("\uFEFF") || decoded.includes("\u0000")) {
      throw new Error("forbidden code point");
    }
    return decoded;
  } catch {
    throw new NormalizeFailure("fmp.unsupported-encoding");
  }
}

function validateRoute(value: FmpRecordedRouteV1): FmpRecordedRouteV1 {
  let route: FmpRecordedRouteV1;
  try {
    route = inertJsonSnapshot(value as unknown as JsonValue) as FmpRecordedRouteV1;
  } catch {
    throw new NormalizeFailure("fmp.identity-invalid");
  }
  if (
    route === null ||
    typeof route !== "object" ||
    Array.isArray(route) ||
    Object.keys(route).sort().join(",") !==
      "classification,issuerMapping,mappingAuthority,mappingVersion" ||
    (route.classification !== "earnings-release" &&
      route.classification !== "not-earnings-release") ||
    typeof route.mappingAuthority !== "string" ||
    route.mappingAuthority.length < 1 ||
    route.mappingAuthority.length > 512 ||
    typeof route.mappingVersion !== "string" ||
    route.mappingVersion.length < 1 ||
    route.mappingVersion.length > 512
  ) {
    throw new NormalizeFailure("fmp.identity-invalid");
  }
  if (route.issuerMapping !== null) {
    const mapping = route.issuerMapping;
    if (
      typeof mapping !== "object" ||
      Array.isArray(mapping) ||
      Object.keys(mapping).sort().join(",") !== "fiscalPeriod,issuerCik,symbol" ||
      !/^\d{10}$/u.test(mapping.issuerCik) ||
      !/^[A-Z0-9][A-Z0-9.-]{0,31}$/u.test(mapping.symbol) ||
      !/^\d{4}-(?:Q[1-4]|FY)$/u.test(mapping.fiscalPeriod)
    ) {
      throw new NormalizeFailure("fmp.identity-invalid");
    }
  }
  return freeze(route);
}

export function deriveFmpItemIdentity(item: FmpItem): DerivedFmpItem {
  const title = semanticText(item.title);
  const text = semanticText(item.text);
  if (title.length === 0 || text.length === 0) throw new NormalizeFailure("fmp.item-invalid");
  const projection = freeze({
    projectionVersion: 1,
    dialect: FMP_RECORDED_DIALECT,
    symbol: item.symbol,
    publishedDate: item.publishedDate,
    title,
    text,
  }) as FmpSelectedProjectionV1;
  const recordId = `fmp-recorded-synthetic:${canonicalHash(FMP_RECORD_DOMAIN, {
    symbol: item.symbol,
    publishedDate: item.publishedDate,
    title,
  })}`;
  const revisionId = `sha256:${canonicalHash(FMP_REVISION_DOMAIN, projection)}`;
  return freeze({
    projection,
    recordId,
    revisionId,
    selectedProjectionHash: canonicalHash(FMP_PROJECTION_DOMAIN, projection),
    publication: publication(item.publishedDate),
  });
}

export function inspectRecordedFmpCollection(bytes: Uint8Array): Readonly<{
  primaryArtifactHash: string;
  items: readonly DerivedFmpItem[];
}> {
  if (!(bytes instanceof Uint8Array)) throw new NormalizeFailure("fmp.response-invalid");
  if (bytes.byteLength > FMP_MAX_RESPONSE_BYTES) {
    throw new NormalizeFailure("fmp.response-byte-limit-exceeded");
  }
  const primaryArtifactHash = createHash("sha256").update(bytes).digest("hex");
  let parsed: JsonValue;
  try {
    parsed = parseFmpJson(decode(bytes));
  } catch (error) {
    if (error instanceof NormalizeFailure) throw error;
    if (error instanceof FmpJsonError) {
      throw new NormalizeFailure(error.reasonCode, error.limitKind);
    }
    throw new NormalizeFailure("fmp.malformed-json");
  }
  if (!Array.isArray(parsed)) throw new NormalizeFailure("fmp.response-invalid");
  if (parsed.length < 1) throw new NormalizeFailure("fmp.response-invalid");
  if (parsed.length > FMP_MAX_ITEMS) throw new NormalizeFailure("fmp.item-limit-exceeded");
  return freeze({
    primaryArtifactHash,
    items: parsed.map((raw) => deriveFmpItemIdentity(parseItem(raw))),
  });
}

function selector(value: FmpSelectorV1): FmpSelectorV1 {
  let snapshot: FmpSelectorV1;
  try {
    snapshot = inertJsonSnapshot(value as unknown as JsonValue) as FmpSelectorV1;
  } catch {
    throw new NormalizeFailure("fmp.identity-invalid");
  }
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    Object.keys(snapshot).sort().join(",") !== "recordId,revisionId" ||
    !/^fmp-recorded-synthetic:[a-f0-9]{64}$/u.test(snapshot.recordId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(snapshot.revisionId)
  ) {
    throw new NormalizeFailure("fmp.identity-invalid");
  }
  return freeze(snapshot);
}

export function normalizeRecordedFmpCollection(
  input: Readonly<{
    bytes: Uint8Array;
    selector: FmpSelectorV1;
    route: FmpRecordedRouteV1;
  }>,
): FmpNormalizationResult {
  let primaryArtifactHash: string | null = null;
  try {
    if (input.bytes instanceof Uint8Array && input.bytes.byteLength <= FMP_MAX_RESPONSE_BYTES) {
      primaryArtifactHash = createHash("sha256").update(input.bytes).digest("hex");
    }
    const inspected = inspectRecordedFmpCollection(input.bytes);
    primaryArtifactHash = inspected.primaryArtifactHash;
    const selected = selector(input.selector);
    const route = validateRoute(input.route);
    const family = inspected.items.filter((item) => item.recordId === selected.recordId);
    if (family.length < 1) throw new NormalizeFailure("fmp.item-invalid");
    const distinct = new Map(family.map((item) => [item.selectedProjectionHash, item]));
    if (distinct.size !== 1) throw new NormalizeFailure("fmp.duplicate-conflict");
    const item = family.find((candidate) => candidate.revisionId === selected.revisionId);
    if (item === undefined) throw new NormalizeFailure("fmp.item-invalid");
    if (route.classification === "not-earnings-release") {
      return ignored("fmp.not-earnings-related", primaryArtifactHash);
    }
    if (route.issuerMapping === null || route.issuerMapping.symbol !== item.projection.symbol) {
      return ignored("fmp.issuer-unmapped", primaryArtifactHash);
    }
    const routeHash = canonicalHash(FMP_ROUTE_DOMAIN, {
      classification: route.classification,
      issuerMapping: route.issuerMapping,
    });
    const candidate = freeze({
      candidateVersion: 1,
      provider: FMP_PROVIDER,
      source: FMP_RECORDED_SOURCE,
      sourceKind: "fmp_release",
      providerRecordId: item.recordId,
      providerRevisionId: item.revisionId,
      issuerCik: route.issuerMapping.issuerCik,
      symbol: route.issuerMapping.symbol,
      fiscalPeriod: route.issuerMapping.fiscalPeriod,
      primaryArtifactHash: item.selectedProjectionHash,
      selectedProjectionHash: item.selectedProjectionHash,
      routeHash,
      ...item.publication,
    }) as RecordedPressReleaseCandidateV1;
    const subject = `earnings:${candidate.issuerCik}:${candidate.fiscalPeriod}`;
    const draft = validateEventDraft({
      envelopeVersion: 2,
      type: "earnings.source.observed",
      schemaVersion: 1,
      source: FMP_RECORDED_SOURCE,
      subject,
      occurredAtMs: candidate.publishedAtMs,
      correlationId: subject,
      provider: {
        provider: FMP_PROVIDER,
        recordId: candidate.providerRecordId,
        revisionId: candidate.providerRevisionId,
        artifactHash: item.selectedProjectionHash,
      },
      payload: {
        issuerCik: candidate.issuerCik,
        fiscalPeriod: candidate.fiscalPeriod,
        sourceKind: candidate.sourceKind,
        artifactHash: item.selectedProjectionHash,
        publishedAtMs: candidate.publishedAtMs,
        timestampConfidence: candidate.timestampConfidence,
        originalTimestamp: candidate.originalTimestamp,
      },
    }) as RecordedFmpEventDraftV1;
    return freeze({
      status: "emitted",
      reasonCode: null,
      limitKind: null,
      primaryArtifactHash,
      recordId: item.recordId,
      revisionId: item.revisionId,
      projection: item.projection,
      selectedProjectionHash: item.selectedProjectionHash,
      routeHash,
      candidate,
      candidateHash: canonicalHash(RECORDED_CANDIDATE_DOMAIN, candidate as unknown as JsonValue),
      draft,
      eventDraftHash: canonicalHash(RECORDED_DRAFT_DOMAIN, draft as unknown as JsonValue),
    });
  } catch (error) {
    if (error instanceof NormalizeFailure) {
      return quarantine(error.reasonCode, error.limitKind, primaryArtifactHash);
    }
    return quarantine("fmp.response-invalid", null, primaryArtifactHash);
  }
}
