import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { types as utilityTypes } from "node:util";

import { type EventDraft, validateEventDraft } from "../../core/event.js";
import { canonicalHash } from "../../core/hash.js";
import {
  assertSchemaPrototypeSafety,
  canonicalJson,
  deepFreezeJson,
  inertJsonSnapshot,
  type JsonValue,
} from "../../core/json.js";
import { createProviderEvidenceBundle } from "../evidence-bundle.js";
import {
  canonicalizeSecSubjectCik,
  deriveSecProviderEnvelope,
  isSecCurrentForm,
  isSecPeriodicForm,
  SEC_EVIDENCE_ROLES,
  SEC_MAX_BUNDLE_BYTES,
  SEC_MAX_MEMBER_BYTES,
  SEC_MAX_TRANSCRIPT_BYTES,
  SEC_NORMALIZER_SOURCE,
  SEC_PROVIDER,
  SEC_QUALIFYING_EXHIBIT_TYPE,
  SEC_REVISION_ID,
  SecContractError,
  type SecEvidenceRole,
  type SecParseLimitKind,
  type SecReasonCode,
  type SecSourceKind,
  selectSec8kPrimaryArtifact,
} from "./contracts.js";
import {
  decodeSecMember,
  SEC_DECODER_POLICY,
  type SecCanonicalEncoding,
  type SecContentKind,
} from "./parsers/decoder.js";
import { SecParserError, secParserFailure } from "./parsers/errors.js";
import {
  parseSecFilingIndexJson,
  parseSecSubmissionsJson,
  type SecFilingIndex,
  type SecSubmissions,
} from "./parsers/json.js";
import { parseSecMarkup, SEC_MARKUP_PARSER, type SecMarkupExtraction } from "./parsers/markup.js";

export const SEC_NORMALIZER_IDENTITY = "sec-normalizer-v1";
export const SEC_EASTERN_POLICY = "sec-eastern-post-2007-v1";
export const SEC_NORMALIZED_DRAFT_HASH_DOMAIN = "peas/sec-normalized-event-draft/v1";
export const SEC_NORMALIZATION_TRANSCRIPT_HASH_DOMAIN = "peas/sec-normalization-transcript/v1";

export const SEC_NORMALIZER_POLICY = Object.freeze({
  normalizer: SEC_NORMALIZER_IDENTITY,
  decoder: SEC_DECODER_POLICY,
  markupParser: SEC_MARKUP_PARSER,
  timestampPolicy: SEC_EASTERN_POLICY,
});
export type SecNormalizerPolicy = typeof SEC_NORMALIZER_POLICY;

export type VerifiedSecMember = Readonly<{
  role: string;
  memberKey: string;
  artifactHash: string;
  sizeBytes: number;
  bytes: Uint8Array;
}>;

export type VerifiedSecBundle = Readonly<{
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
  members: readonly VerifiedSecMember[];
}>;

export type SecTranscriptEvidence = Readonly<{
  role: string;
  artifactHash: string;
  sizeBytes: number;
  contentKind: SecContentKind | null;
  encoding: SecCanonicalEncoding | null;
}>;

export type NormalizationTranscript = Readonly<{
  normalizer: typeof SEC_NORMALIZER_IDENTITY;
  decoder: typeof SEC_DECODER_POLICY;
  markupParser: typeof SEC_MARKUP_PARSER;
  timestampPolicy: typeof SEC_EASTERN_POLICY;
  bundleHash: string | null;
  selectedEvidence: readonly SecTranscriptEvidence[];
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: SecReasonCode | null;
  limitKind: SecParseLimitKind | null;
  outputHash: string | null;
}>;

export type SecNormalizationResult =
  | Readonly<{ status: "emitted"; draft: EventDraft; transcript: NormalizationTranscript }>
  | Readonly<{
      status: "ignored";
      reasonCode: SecReasonCode;
      transcript: NormalizationTranscript;
    }>
  | Readonly<{
      status: "quarantined";
      reasonCode: SecReasonCode;
      transcript: NormalizationTranscript;
    }>;

type DetachedMember = Omit<VerifiedSecMember, "role" | "bytes"> &
  Readonly<{ role: SecEvidenceRole; bytes: Uint8Array }>;
type ParsedMember = Readonly<{
  member: DetachedMember;
  contentKind: SecContentKind;
  encoding: SecCanonicalEncoding;
  submissions: SecSubmissions | null;
  filingIndex: SecFilingIndex | null;
  markup: SecMarkupExtraction | null;
}>;

class NormalizationFailure extends Error {
  constructor(
    readonly reasonCode: SecReasonCode,
    readonly limitKind: SecParseLimitKind | null = null,
  ) {
    super(reasonCode);
    this.name = "NormalizationFailure";
  }
}

const SHA256 = /^[0-9a-f]{64}$/u;
const MEMBER_KEY = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u;
const FISCAL_PERIOD = /^\d{4}-(?:Q[1-4]|FY)$/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const BUNDLE_FIELDS = Object.freeze([
  "provider",
  "source",
  "recordId",
  "revisionId",
  "sourceKind",
  "accession",
  "subjectCik",
  "fiscalPeriod",
  "primaryArtifactHash",
  "evidenceBundleHash",
  "members",
]);
const MEMBER_FIELDS = Object.freeze(["role", "memberKey", "artifactHash", "sizeBytes", "bytes"]);
const SEC_NORMALIZER_SCHEMA_FIELDS = Object.freeze([...BUNDLE_FIELDS, ...MEMBER_FIELDS]);

function failure(reasonCode: SecReasonCode, limitKind: SecParseLimitKind | null = null): never {
  throw new NormalizationFailure(reasonCode, limitKind);
}

function dataObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || utilityTypes.isProxy(value)) {
    return failure("sec.bundle-invalid");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return failure("sec.bundle-invalid");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) {
    return failure("sec.bundle-invalid");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      return failure("sec.bundle-invalid");
    }
    result[field] = descriptor.value;
  }
  return result;
}

function dataArray(value: unknown): unknown[] {
  if (
    value === null ||
    typeof value !== "object" ||
    utilityTypes.isProxy(value) ||
    !Array.isArray(value)
  ) {
    return failure("sec.bundle-invalid");
  }
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    return failure("sec.bundle-invalid");
  }
  if (length > 16) return failure("sec.member-limit-exceeded");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) return failure("sec.bundle-invalid");
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      return failure("sec.bundle-invalid");
    }
    result.push(descriptor.value);
  }
  if (keys.length !== length + 1) return failure("sec.bundle-invalid");
  return result;
}

function string(value: unknown, maxBytes = 512): string {
  if (
    typeof value !== "string" ||
    value.length > maxBytes ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    return failure("sec.bundle-invalid");
  }
  return value;
}

function contentKind(role: string): SecContentKind | null {
  if (role === "sec.submissions" || role === "sec.filing-index") return "json";
  if (role === "sec.xbrl-instance") return "xml";
  if (
    role === "sec.primary-document" ||
    role === "sec.exhibit-99.1" ||
    role === "sec.periodic-report"
  ) {
    return "html";
  }
  return null;
}

function compareMembers(left: DetachedMember, right: DetachedMember): number {
  if (left.role !== right.role) return left.role < right.role ? -1 : 1;
  if (left.artifactHash !== right.artifactHash)
    return left.artifactHash < right.artifactHash ? -1 : 1;
  return 0;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function detachBundle(value: unknown): {
  bundle: Omit<VerifiedSecBundle, "members">;
  members: DetachedMember[];
} {
  const input = dataObject(value, BUNDLE_FIELDS);
  const rawMembers = dataArray(input["members"]);
  if (rawMembers.length < 1) return failure("sec.bundle-invalid");
  const members: DetachedMember[] = [];
  let totalBytes = 0;
  for (const rawMember of rawMembers) {
    const member = dataObject(rawMember, MEMBER_FIELDS);
    const role = string(member["role"], 64);
    if (!(SEC_EVIDENCE_ROLES as readonly string[]).includes(role))
      return failure("sec.bundle-invalid");
    const memberKey = string(member["memberKey"], 64);
    const artifactHash = string(member["artifactHash"], 64);
    const sizeBytes = member["sizeBytes"];
    const bytes = member["bytes"];
    if (!MEMBER_KEY.test(memberKey) || !SHA256.test(artifactHash))
      return failure("sec.bundle-invalid");
    if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      return failure("sec.bundle-invalid");
    }
    if (sizeBytes > SEC_MAX_MEMBER_BYTES) return failure("sec.member-limit-exceeded");
    if (
      bytes === null ||
      typeof bytes !== "object" ||
      utilityTypes.isProxy(bytes) ||
      !utilityTypes.isUint8Array(bytes)
    ) {
      return failure("sec.bundle-invalid");
    }
    const typedBytes = bytes as Uint8Array;
    const prototype = Object.getPrototypeOf(typedBytes);
    if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) {
      return failure("sec.bundle-invalid");
    }
    if (TYPED_ARRAY_BUFFER === undefined || TYPED_ARRAY_BYTE_LENGTH === undefined) {
      return failure("sec.bundle-invalid");
    }
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER, typedBytes, []) as ArrayBufferLike;
    const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, typedBytes, []) as number;
    if (buffer instanceof SharedArrayBuffer) return failure("sec.bundle-invalid");
    if (byteLength !== sizeBytes || byteLength > SEC_MAX_MEMBER_BYTES) {
      return byteLength > SEC_MAX_MEMBER_BYTES
        ? failure("sec.member-limit-exceeded")
        : failure("sec.bundle-invalid");
    }
    totalBytes += byteLength;
    if (totalBytes > SEC_MAX_BUNDLE_BYTES) return failure("sec.bundle-byte-limit-exceeded");
    const detached = new Uint8Array(typedBytes);
    if (digest(detached) !== artifactHash) return failure("sec.bundle-invalid");
    members.push({
      role: role as SecEvidenceRole,
      memberKey,
      artifactHash,
      sizeBytes,
      bytes: detached,
    });
  }
  members.sort(compareMembers);
  const digests = new Set<string>();
  const memberKeys = new Set<string>();
  const singletonRoles = new Set<string>();
  for (const member of members) {
    if (digests.has(member.artifactHash) || memberKeys.has(member.memberKey)) {
      return failure("sec.bundle-invalid");
    }
    digests.add(member.artifactHash);
    memberKeys.add(member.memberKey);
    if (member.role !== "sec.exhibit-99.1") {
      if (singletonRoles.has(member.role)) return failure("sec.bundle-invalid");
      singletonRoles.add(member.role);
    }
  }
  const sourceKind = input["sourceKind"];
  if (sourceKind !== "sec_8k" && sourceKind !== "filing") return failure("sec.identity-mismatch");
  const required =
    sourceKind === "sec_8k"
      ? ["sec.submissions", "sec.filing-index", "sec.primary-document", "sec.exhibit-99.1"]
      : ["sec.submissions", "sec.filing-index", "sec.primary-document"];
  if (required.some((role) => !members.some((member) => member.role === role))) {
    return failure("sec.required-member-missing");
  }
  if (
    sourceKind === "sec_8k" &&
    !members.some(
      (member) => member.role === "sec.xbrl-instance" || member.role === "sec.periodic-report",
    )
  ) {
    return failure("sec.required-member-missing");
  }
  const primaryArtifactHash = input["primaryArtifactHash"];
  const primary =
    typeof primaryArtifactHash === "string"
      ? members.find((member) => member.artifactHash === primaryArtifactHash)
      : undefined;
  const expectedPrimaryRole = sourceKind === "sec_8k" ? "sec.exhibit-99.1" : "sec.primary-document";
  if (primary === undefined || primary.role !== expectedPrimaryRole)
    return failure("sec.bundle-invalid");

  const evidenceBundleHash = input["evidenceBundleHash"];
  const bundle = {
    provider: string(input["provider"]),
    source: string(input["source"]),
    recordId: string(input["recordId"]),
    revisionId: string(input["revisionId"]),
    sourceKind,
    accession: string(input["accession"]),
    subjectCik: string(input["subjectCik"]),
    fiscalPeriod: string(input["fiscalPeriod"]),
    primaryArtifactHash,
    evidenceBundleHash: evidenceBundleHash === null ? null : string(evidenceBundleHash, 64),
  } as Omit<VerifiedSecBundle, "members">;
  if (bundle.evidenceBundleHash === null || !SHA256.test(bundle.evidenceBundleHash)) {
    return failure("sec.bundle-invalid");
  }
  if (
    bundle.provider !== SEC_PROVIDER ||
    bundle.source !== SEC_NORMALIZER_SOURCE ||
    bundle.revisionId !== SEC_REVISION_ID ||
    !FISCAL_PERIOD.test(bundle.fiscalPeriod)
  ) {
    return failure("sec.identity-mismatch");
  }
  let issuerCik: string;
  try {
    issuerCik = canonicalizeSecSubjectCik(bundle.subjectCik);
  } catch {
    return failure("sec.identity-mismatch");
  }
  const providerBundle = createProviderEvidenceBundle({
    provider: bundle.provider,
    source: bundle.source,
    recordId: bundle.recordId,
    revisionId: bundle.revisionId,
    subject: `earnings:${issuerCik}:${bundle.fiscalPeriod}`,
    issuerCik,
    fiscalPeriod: bundle.fiscalPeriod,
    sourceKind,
    primaryArtifactHash,
    evidence: members.map((member) => ({ role: member.role, artifactHash: member.artifactHash })),
  });
  if (providerBundle.evidenceBundleHash !== bundle.evidenceBundleHash) {
    return failure("sec.bundle-hash-mismatch");
  }
  return { bundle, members };
}

function parseMembers(
  members: readonly DetachedMember[],
  transcript: SecTranscriptEvidence[],
): ParsedMember[] {
  return members.map((member) => {
    const kind = contentKind(member.role);
    if (kind === null) return failure("sec.bundle-invalid");
    const decoded = decodeSecMember(member.bytes, kind);
    const index = transcript.findIndex((entry) => entry.artifactHash === member.artifactHash);
    if (index < 0) return failure("sec.bundle-invalid");
    transcript[index] = {
      role: member.role,
      artifactHash: member.artifactHash,
      sizeBytes: member.sizeBytes,
      contentKind: kind,
      encoding: decoded.encoding,
    };
    if (member.role === "sec.submissions") {
      return {
        member,
        contentKind: kind,
        encoding: decoded.encoding,
        submissions: parseSecSubmissionsJson(decoded.text),
        filingIndex: null,
        markup: null,
      };
    }
    if (member.role === "sec.filing-index") {
      return {
        member,
        contentKind: kind,
        encoding: decoded.encoding,
        submissions: null,
        filingIndex: parseSecFilingIndexJson(decoded.text),
        markup: null,
      };
    }
    return {
      member,
      contentKind: kind,
      encoding: decoded.encoding,
      submissions: null,
      filingIndex: null,
      markup: parseSecMarkup(decoded.text, kind === "xml" ? "xml" : "html"),
    };
  });
}

function only<T>(values: readonly (T | null)[]): T {
  const found = values.filter((value): value is T => value !== null);
  if (found.length !== 1) return failure("sec.bundle-invalid");
  return found[0] as T;
}

function selectPrimary(
  sourceKind: SecSourceKind,
  incomingPrimary: string,
  members: readonly DetachedMember[],
  index: SecFilingIndex,
): void {
  if (sourceKind === "filing") {
    const primary = only(
      members.map((member) => (member.role === "sec.primary-document" ? member : null)),
    );
    if (primary.artifactHash !== incomingPrimary) failure("sec.bundle-invalid");
    return;
  }
  const exhibits = members.filter((member) => member.role === "sec.exhibit-99.1");
  const sequences = exhibits.map((member) => {
    const entries = index.exhibits.filter(
      (entry) => entry.memberKey === member.memberKey && entry.type === SEC_QUALIFYING_EXHIBIT_TYPE,
    );
    if (entries.length !== 1) failure("sec.bundle-invalid");
    const entry = entries[0];
    if (entry === undefined || entry.sequence <= 0) failure("sec.bundle-invalid");
    return {
      role: "sec.exhibit-99.1" as const,
      artifactHash: member.artifactHash,
      sequence: entry.sequence,
    };
  });
  const qualifyingKeys = new Set(exhibits.map((member) => member.memberKey));
  if (
    index.exhibits.some(
      (entry) => entry.type === SEC_QUALIFYING_EXHIBIT_TYPE && !qualifyingKeys.has(entry.memberKey),
    )
  ) {
    failure("sec.bundle-invalid");
  }
  let selected: string;
  try {
    selected = selectSec8kPrimaryArtifact(sequences);
  } catch {
    failure("sec.bundle-invalid");
  }
  if (selected !== incomingPrimary) failure("sec.bundle-invalid");
}

function validateClassification(
  sourceKind: SecSourceKind,
  submissions: SecSubmissions,
  index: SecFilingIndex,
): void {
  if (submissions.form !== index.form) failure("sec.identity-mismatch");
  if (sourceKind === "sec_8k") {
    if (!isSecCurrentForm(submissions.form)) failure("sec.identity-mismatch");
    if (!submissions.items.includes("2.02") || !index.items.includes("2.02")) {
      failure("sec.not-earnings-related");
    }
    return;
  }
  if (!isSecPeriodicForm(submissions.form)) failure("sec.identity-mismatch");
}

function canonicalCik(value: string): string {
  try {
    return canonicalizeSecSubjectCik(value);
  } catch {
    return failure("sec.identity-mismatch");
  }
}

function resolveIssuer(
  declared: string,
  submissions: SecSubmissions,
  index: SecFilingIndex,
  parsed: readonly ParsedMember[],
): string {
  const candidates = [submissions.cik, index.subjectCik];
  for (const member of parsed) {
    if (member.markup !== null && member.member.role !== "sec.exhibit-99.1") {
      if (member.member.role === "sec.periodic-report" && member.markup.subjectCiks.length === 0) {
        return failure("sec.identity-mismatch");
      }
      candidates.push(...member.markup.subjectCiks);
    }
  }
  const present = candidates.filter((value): value is string => value !== null);
  if (present.length === 0) return failure("sec.identity-mismatch");
  const canonical = present.map(canonicalCik);
  if (new Set(canonical).size !== 1) return failure("sec.subject-cik-conflict");
  const issuerCik = canonical[0];
  if (issuerCik === undefined || issuerCik !== canonicalCik(declared)) {
    return failure("sec.identity-mismatch");
  }
  return issuerCik;
}

type FiscalFocus =
  | Readonly<{ kind: "complete"; pairs: readonly string[] }>
  | Readonly<{ kind: "incomplete" }>
  | Readonly<{ kind: "invalid" }>;

function fiscalFocus(markup: SecMarkupExtraction): FiscalFocus {
  if (
    markup.fiscalYears.length === 0 ||
    markup.fiscalPeriods.length === 0 ||
    markup.fiscalYears.length !== markup.fiscalPeriods.length
  ) {
    return { kind: "incomplete" };
  }
  const pairs: string[] = [];
  for (let index = 0; index < markup.fiscalYears.length; index += 1) {
    const year = markup.fiscalYears[index];
    const period = markup.fiscalPeriods[index];
    if (
      year === undefined ||
      period === undefined ||
      !/^\d{4}$/u.test(year) ||
      !/^(?:Q[1-4]|FY)$/u.test(period)
    ) {
      return { kind: "invalid" };
    }
    pairs.push(`${year}-${period}`);
  }
  return { kind: "complete", pairs };
}

function resolveFiscalPeriod(
  sourceKind: SecSourceKind,
  declared: string,
  parsed: readonly ParsedMember[],
): string {
  const pairs: string[] = [];
  if (sourceKind === "filing") {
    const primary = only(
      parsed.map((member) =>
        member.member.role === "sec.primary-document" ? member.markup : null,
      ),
    );
    const inlineFocus = fiscalFocus(primary);
    const xbrl = parsed.find((member) => member.member.role === "sec.xbrl-instance")?.markup;
    if (inlineFocus.kind === "invalid") return failure("sec.fiscal-period-ambiguous");
    if (inlineFocus.kind === "incomplete") {
      if (xbrl === null || xbrl === undefined) {
        return failure("sec.required-member-missing");
      }
      const linkedFocus = fiscalFocus(xbrl);
      if (linkedFocus.kind !== "complete") return failure("sec.required-member-missing");
      pairs.push(...linkedFocus.pairs);
    } else {
      pairs.push(...inlineFocus.pairs);
      if (xbrl !== null && xbrl !== undefined) {
        const linkedFocus = fiscalFocus(xbrl);
        if (linkedFocus.kind !== "complete") return failure("sec.fiscal-period-ambiguous");
        pairs.push(...linkedFocus.pairs);
      }
    }
  }
  const structured = parsed.filter(
    (member) =>
      member.markup !== null &&
      (member.member.role === "sec.xbrl-instance" ||
        member.member.role === "sec.periodic-report") &&
      sourceKind === "sec_8k",
  );
  for (const member of structured) {
    const markup = member.markup;
    if (markup === null) continue;
    const found = fiscalFocus(markup);
    if (found.kind !== "complete") return failure("sec.fiscal-period-ambiguous");
    pairs.push(...found.pairs);
    if (member.member.role === "sec.periodic-report") {
      if (markup.documentTypes.length !== 1 || !isSecPeriodicForm(markup.documentTypes[0])) {
        return failure("sec.identity-mismatch");
      }
    }
  }
  const consensus = new Set(pairs);
  if (consensus.size !== 1) return failure("sec.fiscal-period-ambiguous");
  const fiscalPeriod = [...consensus][0];
  if (fiscalPeriod === undefined || fiscalPeriod !== declared)
    return failure("sec.identity-mismatch");
  return fiscalPeriod;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validCivil(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  return (
    year >= 1970 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilEpochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  return (daysFromCivil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second) * 1_000;
}

export function parseSecRfc3339AcceptanceDateTime(value: string): number | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    !validCivil(year, month, day, hour, minute, second)
  ) {
    return null;
  }
  const fraction = Number((match[7] ?? "").padEnd(3, "0"));
  const offset = match[8];
  if (offset === undefined) return null;
  let offsetMinutes = 0;
  if (offset !== "Z") {
    const offsetHours = Number(offset.slice(1, 3));
    const offsetRemainder = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetRemainder > 59) return null;
    offsetMinutes = (offsetHours * 60 + offsetRemainder) * (offset[0] === "+" ? 1 : -1);
  }
  const epoch =
    civilEpochMs(year, month, day, hour, minute, second) + fraction - offsetMinutes * 60_000;
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
}

function sundayOnOrAfter(year: number, month: number, day: number): number {
  const dayOfWeek = (((daysFromCivil(year, month, day) + 4) % 7) + 7) % 7;
  return day + ((7 - dayOfWeek) % 7);
}

export type SecEasternConversion =
  | Readonly<{ kind: "valid"; epochMs: number }>
  | Readonly<{ kind: "invalid" | "unsupported" }>;

export function convertSecEasternAcceptanceDateTime(value: string): SecEasternConversion {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/u.exec(value);
  if (match === null) return { kind: "invalid" };
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    !validCivil(year, month, day, hour, minute, second)
  ) {
    return { kind: "invalid" };
  }
  if (year < 2007 || (year === 2007 && (month < 3 || (month === 3 && day < 11)))) {
    return { kind: "unsupported" };
  }
  const startDay = sundayOnOrAfter(year, 3, 8);
  const endDay = sundayOnOrAfter(year, 11, 1);
  if (month === 3 && day === startDay && hour === 2) return { kind: "invalid" };
  if (month === 11 && day === endDay && hour === 1) return { kind: "invalid" };
  const afterStart =
    month > 3 || (month === 3 && (day > startDay || (day === startDay && hour >= 3)));
  const beforeEnd = month < 11 || (month === 11 && (day < endDay || (day === endDay && hour < 1)));
  const offsetHours = afterStart && beforeEnd ? 4 : 5;
  return {
    kind: "valid",
    epochMs: civilEpochMs(year, month, day, hour, minute, second) + offsetHours * 3_600_000,
  };
}

function resolveTimestamp(
  submissions: SecSubmissions,
  primary: SecMarkupExtraction,
): Readonly<{
  publishedAtMs: number | null;
  timestampConfidence: "exact" | "provider" | "unknown";
  originalTimestamp: string | null;
}> {
  const candidates: Array<{ epoch: number; source: "header" | "submissions"; original: string }> =
    [];
  if (submissions.acceptanceDateTime !== null) {
    const epoch = parseSecRfc3339AcceptanceDateTime(submissions.acceptanceDateTime);
    if (epoch === null) return failure("sec.timestamp-invalid");
    candidates.push({ epoch, source: "submissions", original: submissions.acceptanceDateTime });
  }
  for (const original of primary.acceptanceDateTimes) {
    const converted = convertSecEasternAcceptanceDateTime(original);
    if (converted.kind === "invalid") return failure("sec.timestamp-invalid");
    if (converted.kind === "valid") {
      candidates.push({ epoch: converted.epochMs, source: "header", original });
    }
  }
  if (candidates.length === 0) {
    return { publishedAtMs: null, timestampConfidence: "unknown", originalTimestamp: null };
  }
  if (new Set(candidates.map((candidate) => candidate.epoch)).size !== 1) {
    return failure("sec.timestamp-conflict");
  }
  const selected =
    candidates.find((candidate) => candidate.source === "submissions") ?? candidates[0];
  if (selected === undefined) return failure("sec.timestamp-invalid");
  return {
    publishedAtMs: selected.epoch,
    timestampConfidence: selected.source === "submissions" ? "exact" : "provider",
    originalTimestamp: selected.original,
  };
}

function frozen<T extends JsonValue>(value: T): Readonly<T> {
  return deepFreezeJson(inertJsonSnapshot(value));
}

function transcript(
  bundleHash: string | null,
  selectedEvidence: readonly SecTranscriptEvidence[],
  status: NormalizationTranscript["status"],
  reasonCode: SecReasonCode | null,
  limitKind: SecParseLimitKind | null,
  outputHash: string | null,
): NormalizationTranscript {
  const value = frozen({
    normalizer: SEC_NORMALIZER_IDENTITY,
    decoder: SEC_DECODER_POLICY,
    markupParser: SEC_MARKUP_PARSER,
    timestampPolicy: SEC_EASTERN_POLICY,
    bundleHash,
    selectedEvidence,
    status,
    reasonCode,
    limitKind,
    outputHash,
  }) as NormalizationTranscript;
  if (
    Buffer.byteLength(canonicalJson(value as unknown as JsonValue), "utf8") >
    SEC_MAX_TRANSCRIPT_BYTES
  ) {
    return secParserFailure(
      "sec.bundle-invalid",
      "SEC normalization transcript exceeds its ceiling",
    );
  }
  return value;
}

function validatePolicy(value: unknown): void {
  if (value !== SEC_NORMALIZER_POLICY) {
    const policy = dataObject(value, ["normalizer", "decoder", "markupParser", "timestampPolicy"]);
    if (
      policy["normalizer"] !== SEC_NORMALIZER_IDENTITY ||
      policy["decoder"] !== SEC_DECODER_POLICY ||
      policy["markupParser"] !== SEC_MARKUP_PARSER ||
      policy["timestampPolicy"] !== SEC_EASTERN_POLICY
    ) {
      failure("sec.bundle-invalid");
    }
  }
}

export function assertSecTranscriptSerializedWithinLimit(serialized: string): void {
  if (typeof serialized !== "string")
    throw new TypeError("SEC transcript serialization must be a string");
  if (Buffer.byteLength(serialized, "utf8") > SEC_MAX_TRANSCRIPT_BYTES) {
    throw new RangeError("SEC transcript exceeds the 256 KiB canonical UTF-8 ceiling");
  }
}

export function computeSecNormalizationTranscriptHash(value: NormalizationTranscript): string {
  return canonicalHash(SEC_NORMALIZATION_TRANSCRIPT_HASH_DOMAIN, value as unknown as JsonValue);
}

export function normalizeSecBundle(
  value: unknown,
  policy: SecNormalizerPolicy = SEC_NORMALIZER_POLICY,
): SecNormalizationResult {
  assertSchemaPrototypeSafety(SEC_NORMALIZER_SCHEMA_FIELDS);
  let bundleHash: string | null = null;
  let selectedEvidence: SecTranscriptEvidence[] = [];
  try {
    validatePolicy(policy);
    const detached = detachBundle(value);
    bundleHash = detached.bundle.evidenceBundleHash;
    selectedEvidence = detached.members.map((member) => ({
      role: member.role,
      artifactHash: member.artifactHash,
      sizeBytes: member.sizeBytes,
      contentKind: contentKind(member.role),
      encoding: null,
    }));
    const parsedJson = parseMembers(
      detached.members.filter(
        (member) => member.role === "sec.submissions" || member.role === "sec.filing-index",
      ),
      selectedEvidence,
    );
    const submissions = only(parsedJson.map((member) => member.submissions));
    const filingIndex = only(parsedJson.map((member) => member.filingIndex));
    validateClassification(detached.bundle.sourceKind, submissions, filingIndex);
    if (
      submissions.accession !== filingIndex.accession ||
      submissions.accession !== detached.bundle.accession
    ) {
      return failure("sec.identity-mismatch");
    }
    const parsedMarkup = parseMembers(
      detached.members.filter(
        (member) => member.role !== "sec.submissions" && member.role !== "sec.filing-index",
      ),
      selectedEvidence,
    );
    const parsed = [...parsedJson, ...parsedMarkup];
    const primaryHash = detached.bundle.primaryArtifactHash;
    if (primaryHash === null) return failure("sec.bundle-invalid");
    selectPrimary(detached.bundle.sourceKind, primaryHash, detached.members, filingIndex);
    const issuerCik = resolveIssuer(detached.bundle.subjectCik, submissions, filingIndex, parsed);
    const fiscalPeriod = resolveFiscalPeriod(
      detached.bundle.sourceKind,
      detached.bundle.fiscalPeriod,
      parsed,
    );
    const primaryMarkup = only(
      parsed.map((member) =>
        member.member.role === "sec.primary-document" ? member.markup : null,
      ),
    );
    const allowedDocumentType =
      primaryMarkup.documentTypes.length === 1 &&
      (detached.bundle.sourceKind === "sec_8k"
        ? isSecCurrentForm(primaryMarkup.documentTypes[0])
        : isSecPeriodicForm(primaryMarkup.documentTypes[0]));
    if (!allowedDocumentType) return failure("sec.identity-mismatch");
    const timestamp = resolveTimestamp(submissions, primaryMarkup);
    if (
      detached.bundle.recordId !==
      `sec:${detached.bundle.accession}:${
        detached.bundle.sourceKind === "sec_8k" ? "earnings-source-v2" : "periodic-source-v2"
      }`
    ) {
      return failure("sec.identity-mismatch");
    }
    const envelope = deriveSecProviderEnvelope({
      accession: detached.bundle.accession,
      sourceKind: detached.bundle.sourceKind,
      subjectCik: issuerCik,
      fiscalPeriod,
      primaryArtifactHash: primaryHash,
      evidenceBundleHash: bundleHash,
    });
    const draft = validateEventDraft({
      envelopeVersion: 2,
      type: "earnings.source.observed",
      schemaVersion: 2,
      source: envelope.source,
      subject: envelope.subject,
      occurredAtMs: timestamp.publishedAtMs,
      correlationId: envelope.correlationId,
      causationId: envelope.causationId,
      provider: envelope.provider,
      payload: {
        issuerCik,
        fiscalPeriod,
        sourceKind: detached.bundle.sourceKind,
        primaryArtifactHash: primaryHash,
        evidenceBundleHash: bundleHash,
        evidence: detached.members.map((member) => ({
          role: member.role,
          artifactHash: member.artifactHash,
        })),
        publishedAtMs: timestamp.publishedAtMs,
        timestampConfidence: timestamp.timestampConfidence,
        originalTimestamp: timestamp.originalTimestamp,
      },
    });
    const acceptedDraft = frozen(draft as unknown as JsonValue) as EventDraft;
    const outputHash = canonicalHash(
      SEC_NORMALIZED_DRAFT_HASH_DOMAIN,
      validateEventDraft(acceptedDraft) as unknown as JsonValue,
    );
    const normalizationTranscript = transcript(
      bundleHash,
      selectedEvidence,
      "emitted",
      null,
      null,
      outputHash,
    );
    return frozen({
      status: "emitted",
      draft: acceptedDraft,
      transcript: normalizationTranscript,
    } as unknown as JsonValue) as SecNormalizationResult;
  } catch (error) {
    let reasonCode: SecReasonCode = "sec.bundle-invalid";
    let limitKind: SecParseLimitKind | null = null;
    if (error instanceof NormalizationFailure || error instanceof SecParserError) {
      reasonCode = error.reasonCode;
      limitKind = error.limitKind;
    } else if (error instanceof SecContractError) {
      reasonCode = error.reasonCode;
    }
    const status =
      reasonCode === "sec.not-earnings-related" || reasonCode === "sec.fiscal-period-ambiguous"
        ? "ignored"
        : "quarantined";
    const normalizationTranscript = transcript(
      bundleHash,
      selectedEvidence,
      status,
      reasonCode,
      limitKind,
      null,
    );
    return frozen({
      status,
      reasonCode,
      transcript: normalizationTranscript,
    } as unknown as JsonValue) as SecNormalizationResult;
  }
}
