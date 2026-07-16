import {
  assertJsonWithinLimits,
  deepFreezeJson,
  inertJsonSnapshot,
  type JsonObject,
  type JsonValue,
} from "../../core/json.js";
import {
  createProviderEvidenceBundle,
  type EvidenceReference,
  type ProviderEvidenceBundle,
  ProviderEvidenceBundleError,
  validateProviderEvidenceBundle,
} from "../evidence-bundle.js";

export const SEC_PROVIDER = "sec-edgar";
export const SEC_NORMALIZER_SOURCE = "sec:normalizer-v1";
export const SEC_REVISION_ID = "1";
export const SEC_EVIDENCE_ROLE_MAX_LENGTH = 64;
export const SEC_CIK_DIGITS = 10;
export const SEC_ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/u;
export const SEC_RECORD_ID_SUFFIXES = Object.freeze({
  sec_8k: "earnings-source-v2",
  filing: "periodic-source-v2",
} as const);

export const SEC_EVIDENCE_ROLES = Object.freeze([
  "sec.submissions",
  "sec.filing-index",
  "sec.primary-document",
  "sec.exhibit-99.1",
  "sec.periodic-report",
  "sec.xbrl-instance",
] as const);
export type SecEvidenceRole = (typeof SEC_EVIDENCE_ROLES)[number];

export const SEC_SOURCE_KINDS = Object.freeze(["sec_8k", "filing"] as const);
export type SecSourceKind = (typeof SEC_SOURCE_KINDS)[number];
export const SEC_CURRENT_FORMS = Object.freeze(["8-K", "8-K/A"] as const);
export const SEC_PERIODIC_FORMS = Object.freeze(["10-Q", "10-Q/A", "10-K", "10-K/A"] as const);
export type SecCurrentForm = (typeof SEC_CURRENT_FORMS)[number];
export type SecPeriodicForm = (typeof SEC_PERIODIC_FORMS)[number];
export const SEC_QUALIFYING_EXHIBIT_TYPE = "EX-99.1";

export const SEC_EVIDENCE_BUNDLE_MIN_MEMBERS = 1;
export const SEC_EVIDENCE_BUNDLE_MAX_MEMBERS = 16;
export const SEC_MAX_MEMBER_BYTES = 10 * 1024 * 1024;
export const SEC_MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
export const SEC_MAX_MARKUP_TOKENS = 250_000;
export const SEC_MAX_MARKUP_DEPTH = 256;
export const SEC_MAX_ATTRIBUTES_PER_TAG = 256;
export const SEC_MAX_EXTRACTED_TEXT_BYTES = 4 * 1024 * 1024;
export const SEC_MAX_TRANSCRIPT_BYTES = 256 * 1024;
export const SEC_DECODER_SNIFF_BYTES = 1_024;
export const SEC_MAX_TRANSCRIPT_MEMBERS = 16;

export const SEC_REASON_CODES = Object.freeze([
  "sec.not-earnings-related",
  "sec.fiscal-period-ambiguous",
  "sec.bundle-invalid",
  "sec.bundle-hash-mismatch",
  "sec.identity-mismatch",
  "sec.required-member-missing",
  "sec.observation-invalid",
  "sec.artifact-read-failed",
  "sec.member-limit-exceeded",
  "sec.bundle-byte-limit-exceeded",
  "sec.subject-cik-conflict",
  "sec.timestamp-conflict",
  "sec.timestamp-invalid",
  "sec.unsupported-encoding",
  "sec.parse-limit-exceeded",
  "sec.malformed-json",
  "sec.malformed-markup",
] as const);
export type SecReasonCode = (typeof SEC_REASON_CODES)[number];
export const SEC_PARSE_LIMIT_KINDS = Object.freeze([
  "markup-tokens",
  "markup-depth",
  "attributes-per-tag",
  "extracted-text-bytes",
] as const);
export type SecParseLimitKind = (typeof SEC_PARSE_LIMIT_KINDS)[number];

export const SEC_REQUIRED_EVIDENCE_ROLES = Object.freeze({
  sec_8k: Object.freeze([
    "sec.submissions",
    "sec.filing-index",
    "sec.primary-document",
    "sec.exhibit-99.1",
  ] as const),
  filing: Object.freeze(["sec.submissions", "sec.filing-index", "sec.primary-document"] as const),
});
export const SEC_SINGLETON_EVIDENCE_ROLES = Object.freeze([
  "sec.submissions",
  "sec.filing-index",
  "sec.primary-document",
  "sec.xbrl-instance",
  "sec.periodic-report",
] as const satisfies readonly SecEvidenceRole[]);
export const SEC_REPEATING_EVIDENCE_ROLES = Object.freeze([
  "sec.exhibit-99.1",
] as const satisfies readonly SecEvidenceRole[]);
export const SEC_EVIDENCE_ROLE_CARDINALITY = Object.freeze({
  "sec.submissions": "exactly-one",
  "sec.filing-index": "exactly-one",
  "sec.primary-document": "exactly-one",
  "sec.exhibit-99.1": "repeating",
  "sec.periodic-report": "zero-or-one",
  "sec.xbrl-instance": "zero-or-one",
} as const satisfies Record<SecEvidenceRole, "exactly-one" | "zero-or-one" | "repeating">);

export class SecContractError extends TypeError {
  constructor(
    readonly reasonCode: SecReasonCode,
    message: string,
  ) {
    super(message);
    this.name = "SecContractError";
  }
}

export type SecEvidenceValidationOptions = Readonly<{
  filingRequiresXbrlInstance?: boolean;
}>;

export type SecExhibitSequence = Readonly<{
  role: "sec.exhibit-99.1";
  artifactHash: string;
  sequence: number;
}>;

export type SecProviderEnvelope = Readonly<{
  source: typeof SEC_NORMALIZER_SOURCE;
  subject: string;
  correlationId: string;
  causationId: string;
  provider: Readonly<{
    provider: typeof SEC_PROVIDER;
    recordId: string;
    revisionId: typeof SEC_REVISION_ID;
    artifactHash: string;
  }>;
}>;

function contractFailure(reasonCode: SecReasonCode, message: string): never {
  throw new SecContractError(reasonCode, message);
}

function secBoundary<T>(reasonCode: SecReasonCode, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof SecContractError) throw error;
    throw new SecContractError(reasonCode, "SEC contract input is not inert bounded data");
  }
}

function translateProviderBundleError(error: ProviderEvidenceBundleError): never {
  switch (error.code) {
    case "member-limit-exceeded":
      return contractFailure(
        "sec.member-limit-exceeded",
        "SEC evidence exceeds the member ceiling",
      );
    case "bundle-hash-mismatch":
      return contractFailure("sec.bundle-hash-mismatch", "SEC evidence bundle hash does not match");
    case "identity-invalid":
      return contractFailure("sec.identity-mismatch", "SEC evidence bundle identity is malformed");
    case "membership-invalid":
    case "invalid-input":
      return contractFailure("sec.bundle-invalid", "SEC evidence bundle is malformed");
  }
}

function validateSecEvidenceOptions(value: unknown): boolean {
  if (value === undefined) return false;
  assertJsonWithinLimits(value, {
    maxDepth: 2,
    maxNodes: 2,
    maxArrayLength: 1,
    maxObjectKeys: 1,
    maxStringBytes: 64,
    maxCanonicalBytes: 128,
  });
  const snapshot = inertJsonSnapshot(value as JsonValue);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    contractFailure("sec.bundle-invalid", "SEC evidence options must be an object");
  }
  const optionObject = snapshot as JsonObject;
  const keys = Object.keys(optionObject);
  if (keys.length > 1 || (keys.length === 1 && keys[0] !== "filingRequiresXbrlInstance")) {
    contractFailure("sec.bundle-invalid", "SEC evidence options have unexpected fields");
  }
  const option = optionObject["filingRequiresXbrlInstance"];
  if (option !== undefined && typeof option !== "boolean") {
    contractFailure("sec.bundle-invalid", "SEC filingRequiresXbrlInstance option must be boolean");
  }
  return option === true;
}

function exactObject(value: unknown, fields: readonly string[], path: string): JsonObject {
  assertJsonWithinLimits(value, {
    maxDepth: 2,
    maxNodes: fields.length + 1,
    maxArrayLength: 1,
    maxObjectKeys: fields.length,
    maxStringBytes: 512,
    maxCanonicalBytes: 2_048,
  });
  const snapshot = inertJsonSnapshot(value as JsonValue);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    contractFailure("sec.identity-mismatch", `${path} must be an object`);
  }
  const keys = Object.keys(snapshot).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    contractFailure("sec.identity-mismatch", `${path} has unexpected or missing fields`);
  }
  return snapshot as JsonObject;
}

function isRole(value: string): value is SecEvidenceRole {
  return (SEC_EVIDENCE_ROLES as readonly string[]).includes(value);
}

function roleCount(evidence: readonly EvidenceReference[], role: SecEvidenceRole): number {
  return evidence.filter((member) => member.role === role).length;
}

export function isSecSourceKind(value: unknown): value is SecSourceKind {
  return typeof value === "string" && (SEC_SOURCE_KINDS as readonly string[]).includes(value);
}

export function isSecCurrentForm(value: unknown): value is SecCurrentForm {
  return typeof value === "string" && (SEC_CURRENT_FORMS as readonly string[]).includes(value);
}

export function isSecPeriodicForm(value: unknown): value is SecPeriodicForm {
  return typeof value === "string" && (SEC_PERIODIC_FORMS as readonly string[]).includes(value);
}

/** Canonicalizes the subject-company CIK only; accession prefixes are never consulted. */
export function canonicalizeSecSubjectCik(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,10}$/u.test(value)) {
    contractFailure("sec.identity-mismatch", "SEC subject CIK must contain one through ten digits");
  }
  return value.padStart(SEC_CIK_DIGITS, "0");
}

export function validateSecAccession(value: unknown): string {
  if (typeof value !== "string" || !SEC_ACCESSION_PATTERN.test(value)) {
    contractFailure("sec.identity-mismatch", "SEC accession must use the canonical 10-2-6 form");
  }
  return value;
}

export function deriveSecRecordId(accession: unknown, sourceKind: unknown): string {
  const canonicalAccession = validateSecAccession(accession);
  if (!isSecSourceKind(sourceKind)) {
    contractFailure("sec.identity-mismatch", "SEC source kind is not supported by PR 2B");
  }
  const suffix = SEC_RECORD_ID_SUFFIXES[sourceKind];
  return `sec:${canonicalAccession}:${suffix}`;
}

function validateSecBundleIdentity(bundle: ProviderEvidenceBundle): SecSourceKind {
  if (bundle.provider !== SEC_PROVIDER || bundle.source !== SEC_NORMALIZER_SOURCE) {
    contractFailure("sec.identity-mismatch", "SEC bundle provider or source is invalid");
  }
  if (!isSecSourceKind(bundle.sourceKind)) {
    contractFailure("sec.identity-mismatch", "SEC bundle source kind is invalid");
  }
  if (bundle.revisionId !== SEC_REVISION_ID) {
    contractFailure("sec.identity-mismatch", "SEC bundle revision is invalid");
  }
  const expectedSubject = `earnings:${bundle.issuerCik}:${bundle.fiscalPeriod}`;
  if (bundle.subject !== expectedSubject) {
    contractFailure("sec.identity-mismatch", "SEC bundle earnings subject is invalid");
  }
  const recordMatch = /^sec:(\d{10}-\d{2}-\d{6}):(earnings-source-v2|periodic-source-v2)$/u.exec(
    bundle.recordId,
  );
  if (
    recordMatch === null ||
    recordMatch[1] === undefined ||
    recordMatch[2] !== SEC_RECORD_ID_SUFFIXES[bundle.sourceKind]
  ) {
    contractFailure("sec.identity-mismatch", "SEC bundle record identity is invalid");
  }
  validateSecAccession(recordMatch[1]);
  return bundle.sourceKind;
}

/**
 * Applies the closed SEC role/cardinality policy to a hash-verified domain bundle.
 * Sequence selection remains a separate pure parser-to-contract input.
 */
export function validateSecEvidenceBundle(
  value: unknown,
  options?: SecEvidenceValidationOptions,
): ProviderEvidenceBundle {
  return secBoundary("sec.bundle-invalid", () => {
    const filingRequiresXbrlInstance = validateSecEvidenceOptions(options);
    let bundle: ProviderEvidenceBundle;
    try {
      bundle = validateProviderEvidenceBundle(value);
    } catch (error) {
      if (!(error instanceof ProviderEvidenceBundleError)) throw error;
      if (error.code !== "invalid-input") translateProviderBundleError(error);
      try {
        bundle = createProviderEvidenceBundle(value);
      } catch (inputError) {
        if (inputError instanceof ProviderEvidenceBundleError) {
          translateProviderBundleError(inputError);
        }
        throw inputError;
      }
    }
    const sourceKind = validateSecBundleIdentity(bundle);
    for (const member of bundle.evidence) {
      if (!isRole(member.role)) {
        contractFailure("sec.bundle-invalid", `Unknown SEC evidence role ${member.role}`);
      }
    }
    for (const role of SEC_SINGLETON_EVIDENCE_ROLES) {
      if (roleCount(bundle.evidence, role) > 1) {
        contractFailure("sec.bundle-invalid", `SEC singleton role ${role} appears more than once`);
      }
    }
    const required = SEC_REQUIRED_EVIDENCE_ROLES[sourceKind];
    for (const role of required) {
      if (roleCount(bundle.evidence, role) === 0) {
        contractFailure("sec.required-member-missing", `Required SEC role ${role} is missing`);
      }
    }
    if (
      sourceKind === "sec_8k" &&
      roleCount(bundle.evidence, "sec.xbrl-instance") === 0 &&
      roleCount(bundle.evidence, "sec.periodic-report") === 0
    ) {
      contractFailure(
        "sec.required-member-missing",
        "sec_8k requires structured fiscal-focus evidence",
      );
    }
    if (
      sourceKind === "filing" &&
      filingRequiresXbrlInstance &&
      roleCount(bundle.evidence, "sec.xbrl-instance") !== 1
    ) {
      contractFailure("sec.required-member-missing", "filing requires one sec.xbrl-instance");
    }
    const primary = bundle.evidence.find(
      (member) => member.artifactHash === bundle.primaryArtifactHash,
    );
    const expectedRole = sourceKind === "sec_8k" ? "sec.exhibit-99.1" : "sec.primary-document";
    if (primary === undefined || primary.role !== expectedRole) {
      contractFailure("sec.bundle-invalid", "Primary artifact is assigned to the wrong SEC role");
    }
    return bundle;
  });
}

/** Selects the lowest positive qualifying EX-99.1 SEC sequence without mutating parser output. */
export function selectSec8kPrimaryArtifact(value: unknown): string {
  return secBoundary("sec.bundle-invalid", () => {
    assertJsonWithinLimits(value, {
      maxDepth: 3,
      maxNodes: 49,
      maxArrayLength: SEC_EVIDENCE_BUNDLE_MAX_MEMBERS,
      maxObjectKeys: 3,
      maxStringBytes: 64,
      maxCanonicalBytes: 4_096,
    });
    const candidates = inertJsonSnapshot(value as JsonValue);
    if (!Array.isArray(candidates) || candidates.length < 1) {
      contractFailure("sec.bundle-invalid", "At least one EX-99.1 sequence is required");
    }
    const seenSequences = new Set<number>();
    const seenArtifacts = new Set<string>();
    let selected: SecExhibitSequence | undefined;
    for (const candidate of candidates) {
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        Object.keys(candidate).sort().join(",") !== "artifactHash,role,sequence"
      ) {
        contractFailure(
          "sec.bundle-invalid",
          "EX-99.1 sequence input must have an exact inert shape",
        );
      }
      const sequence = candidate as unknown as SecExhibitSequence;
      if (
        sequence.role !== "sec.exhibit-99.1" ||
        typeof sequence.artifactHash !== "string" ||
        !/^[0-9a-f]{64}$/u.test(sequence.artifactHash) ||
        !Number.isSafeInteger(sequence.sequence) ||
        sequence.sequence <= 0
      ) {
        contractFailure("sec.bundle-invalid", "EX-99.1 sequence input is invalid");
      }
      if (seenSequences.has(sequence.sequence) || seenArtifacts.has(sequence.artifactHash)) {
        contractFailure("sec.bundle-invalid", "EX-99.1 sequences cannot tie or conflict");
      }
      seenSequences.add(sequence.sequence);
      seenArtifacts.add(sequence.artifactHash);
      if (selected === undefined || sequence.sequence < selected.sequence) selected = sequence;
    }
    if (selected === undefined)
      contractFailure("sec.bundle-invalid", "No EX-99.1 sequence was selected");
    return selected.artifactHash;
  });
}

/** Builds only the provider/domain portion of a future EventDraft; capture owns local envelope data. */
export function deriveSecProviderEnvelope(value: unknown): SecProviderEnvelope {
  return secBoundary("sec.identity-mismatch", () => {
    const input = exactObject(
      value,
      [
        "accession",
        "sourceKind",
        "subjectCik",
        "fiscalPeriod",
        "primaryArtifactHash",
        "evidenceBundleHash",
      ],
      "$.secProviderEnvelope",
    );
    const accession = validateSecAccession(input["accession"]);
    const sourceKind = input["sourceKind"];
    if (!isSecSourceKind(sourceKind)) {
      contractFailure("sec.identity-mismatch", "SEC source kind is not supported by PR 2B");
    }
    const subjectCik = canonicalizeSecSubjectCik(input["subjectCik"]);
    const fiscalPeriod = input["fiscalPeriod"];
    if (typeof fiscalPeriod !== "string" || !/^\d{4}-(?:Q[1-4]|FY)$/u.test(fiscalPeriod)) {
      contractFailure("sec.identity-mismatch", "SEC fiscal period must be canonical");
    }
    const primaryArtifactHash = input["primaryArtifactHash"];
    if (typeof primaryArtifactHash !== "string" || !/^[0-9a-f]{64}$/u.test(primaryArtifactHash)) {
      contractFailure("sec.identity-mismatch", "SEC primary artifact hash is invalid");
    }
    const evidenceBundleHash = input["evidenceBundleHash"];
    if (typeof evidenceBundleHash !== "string" || !/^[0-9a-f]{64}$/u.test(evidenceBundleHash)) {
      contractFailure("sec.identity-mismatch", "SEC evidence bundle hash is invalid");
    }
    const subject = `earnings:${subjectCik}:${fiscalPeriod}`;
    return deepFreezeJson(
      inertJsonSnapshot({
        source: SEC_NORMALIZER_SOURCE,
        subject,
        correlationId: subject,
        causationId: evidenceBundleHash,
        provider: {
          provider: SEC_PROVIDER,
          recordId: deriveSecRecordId(accession, sourceKind),
          revisionId: SEC_REVISION_ID,
          artifactHash: primaryArtifactHash,
        },
      }),
    ) as SecProviderEnvelope;
  });
}
