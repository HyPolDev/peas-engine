import { types as utilityTypes } from "node:util";
import { canonicalHash } from "../core/hash.js";
import {
  assertJsonWithinLimits,
  deepFreezeJson,
  inertJsonSnapshot,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";

export const PROVIDER_EVIDENCE_BUNDLE_HASH_DOMAIN = "peas/provider-evidence-bundle/v1";
export const EVIDENCE_REFERENCE_ROLE_MAX_LENGTH = 64;
export const EVIDENCE_BUNDLE_MIN_MEMBERS = 1;
export const EVIDENCE_BUNDLE_MAX_MEMBERS = 16;

export type EvidenceReference = Readonly<{
  role: string;
  artifactHash: string;
}>;

export type ProviderEvidenceBundleInput = Readonly<{
  provider: string;
  source: string;
  recordId: string;
  revisionId: string;
  subject: string;
  issuerCik: string;
  fiscalPeriod: string;
  sourceKind: string;
  primaryArtifactHash: string;
  evidence: readonly EvidenceReference[];
}>;

export type ProviderEvidenceBundle = ProviderEvidenceBundleInput &
  Readonly<{
    evidenceBundleHash: string;
  }>;

export const PROVIDER_EVIDENCE_BUNDLE_ERROR_CODES = Object.freeze([
  "invalid-input",
  "identity-invalid",
  "membership-invalid",
  "member-limit-exceeded",
  "bundle-hash-mismatch",
] as const);
export type ProviderEvidenceBundleErrorCode = (typeof PROVIDER_EVIDENCE_BUNDLE_ERROR_CODES)[number];

export class ProviderEvidenceBundleError extends TypeError {
  constructor(
    readonly code: ProviderEvidenceBundleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderEvidenceBundleError";
  }
}

const ROLE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DOMAIN_IDENTIFIER = /^[A-Za-z0-9._:-]+$/u;
const FISCAL_PERIOD = /^\d{4}-(?:Q[1-4]|FY)$/u;

const INPUT_FIELDS = Object.freeze([
  "provider",
  "source",
  "recordId",
  "revisionId",
  "subject",
  "issuerCik",
  "fiscalPeriod",
  "sourceKind",
  "primaryArtifactHash",
  "evidence",
]);
const BUNDLE_FIELDS = Object.freeze([...INPUT_FIELDS, "evidenceBundleHash"]);
const REFERENCE_FIELDS = Object.freeze(["role", "artifactHash"]);

function fail(message: string, code: ProviderEvidenceBundleErrorCode = "invalid-input"): never {
  throw new ProviderEvidenceBundleError(code, message);
}

function providerBoundary<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ProviderEvidenceBundleError) throw error;
    throw new ProviderEvidenceBundleError(
      "invalid-input",
      "Provider evidence bundle input is not inert bounded JSON",
    );
  }
}

/** Detects the dedicated member ceiling without invoking Proxy traps or property accessors. */
function assertEvidenceMemberLimit(value: unknown, nested: boolean): void {
  let evidence = value;
  if (nested) {
    if (value === null || typeof value !== "object" || utilityTypes.isProxy(value)) return;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return;
    const descriptor = Object.getOwnPropertyDescriptor(value, "evidence");
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      return;
    }
    evidence = descriptor.value;
  }
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    utilityTypes.isProxy(evidence) ||
    !Array.isArray(evidence)
  ) {
    return;
  }
  const length = Object.getOwnPropertyDescriptor(evidence, "length")?.value;
  if (typeof length === "number" && length > EVIDENCE_BUNDLE_MAX_MEMBERS) {
    fail(`$.evidence exceeds ${EVIDENCE_BUNDLE_MAX_MEMBERS} members`, "member-limit-exceeded");
  }
}

function assertEvidenceRoleLimit(value: unknown): void {
  if (value === null || typeof value !== "object" || utilityTypes.isProxy(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  const descriptor = Object.getOwnPropertyDescriptor(value, "role");
  if (
    descriptor !== undefined &&
    descriptor.enumerable === true &&
    "value" in descriptor &&
    typeof descriptor.value === "string" &&
    descriptor.value.length > EVIDENCE_REFERENCE_ROLE_MAX_LENGTH
  ) {
    fail(
      `$.evidenceReference.role exceeds ${EVIDENCE_REFERENCE_ROLE_MAX_LENGTH} characters`,
      "membership-invalid",
    );
  }
}

function assertExactFields(value: JsonObject, fields: readonly string[], path: string): void {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(`${path} has unexpected or missing persisted fields`);
  }
}

function asObject(value: JsonValue, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value as JsonObject;
}

function asString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") fail(`${path} must be a string`);
  return value;
}

function assertArtifactHash(value: string, path: string): void {
  if (!SHA256.test(value)) {
    fail(`${path} must be a lowercase SHA-256 digest`, "membership-invalid");
  }
}

function assertDomainIdentifier(value: string, path: string): void {
  if (value.length < 1 || value.length > 512 || !DOMAIN_IDENTIFIER.test(value)) {
    fail(`${path} must be a 1-512 character domain identifier`, "identity-invalid");
  }
}

function compareReferences(left: EvidenceReference, right: EvidenceReference): number {
  if (left.role < right.role) return -1;
  if (left.role > right.role) return 1;
  if (left.artifactHash < right.artifactHash) return -1;
  if (left.artifactHash > right.artifactHash) return 1;
  return 0;
}

function frozen<T extends JsonValue>(value: T): Readonly<T> {
  return deepFreezeJson(inertJsonSnapshot(value));
}

/** Validates one inert provider-neutral membership reference and returns a detached snapshot. */
function validateEvidenceReferenceInternal(value: unknown): EvidenceReference {
  assertEvidenceRoleLimit(value);
  assertJsonWithinLimits(value, {
    maxDepth: 2,
    maxNodes: 3,
    maxArrayLength: 1,
    maxObjectKeys: 2,
    maxStringBytes: 64,
    maxCanonicalBytes: 192,
  });
  const reference = asObject(inertJsonSnapshot(value as JsonValue), "$.evidenceReference");
  assertExactFields(reference, REFERENCE_FIELDS, "$.evidenceReference");
  const role = asString(reference["role"], "$.evidenceReference.role");
  const artifactHash = asString(reference["artifactHash"], "$.evidenceReference.artifactHash");
  if (role.length < 1 || role.length > EVIDENCE_REFERENCE_ROLE_MAX_LENGTH || !ROLE.test(role)) {
    fail(
      "$.evidenceReference.role must use the provider-neutral ASCII role grammar",
      "membership-invalid",
    );
  }
  assertArtifactHash(artifactHash, "$.evidenceReference.artifactHash");
  return frozen({ role, artifactHash }) as EvidenceReference;
}

export function validateEvidenceReference(value: unknown): EvidenceReference {
  return providerBoundary(() => validateEvidenceReferenceInternal(value));
}

/** Sorts and validates membership without treating caller presentation order as semantic. */
export function canonicalizeEvidenceReferences(value: unknown): readonly EvidenceReference[] {
  return providerBoundary(() => {
    assertEvidenceMemberLimit(value, false);
    assertJsonWithinLimits(value, {
      maxDepth: 3,
      maxNodes: 1 + EVIDENCE_BUNDLE_MAX_MEMBERS * 3,
      maxArrayLength: EVIDENCE_BUNDLE_MAX_MEMBERS,
      maxObjectKeys: 2,
      maxStringBytes: 64,
      maxCanonicalBytes: 4_096,
    });
    const members = inertJsonSnapshot(value as JsonValue);
    if (!Array.isArray(members)) fail("$.evidence must be an array", "membership-invalid");
    if (members.length < EVIDENCE_BUNDLE_MIN_MEMBERS) {
      fail("$.evidence cannot be empty", "membership-invalid");
    }

    const canonical = members.map((member) => validateEvidenceReferenceInternal(member));
    canonical.sort(compareReferences);
    const digests = new Set<string>();
    for (const reference of canonical) {
      if (digests.has(reference.artifactHash)) {
        fail(
          "$.evidence cannot assign one artifact digest to multiple roles or members",
          "membership-invalid",
        );
      }
      digests.add(reference.artifactHash);
    }
    return frozen(canonical as unknown as JsonValue) as readonly EvidenceReference[];
  });
}

function validateInput(value: unknown): ProviderEvidenceBundleInput {
  assertEvidenceMemberLimit(value, true);
  assertJsonWithinLimits(value, {
    maxDepth: 4,
    maxNodes: 64,
    maxArrayLength: EVIDENCE_BUNDLE_MAX_MEMBERS,
    maxObjectKeys: INPUT_FIELDS.length,
    maxStringBytes: 512,
    maxCanonicalBytes: 16_384,
  });
  const input = asObject(inertJsonSnapshot(value as JsonValue), "$.providerEvidenceBundle");
  assertExactFields(input, INPUT_FIELDS, "$.providerEvidenceBundle");
  const provider = asString(input["provider"], "$.providerEvidenceBundle.provider");
  const source = asString(input["source"], "$.providerEvidenceBundle.source");
  const recordId = asString(input["recordId"], "$.providerEvidenceBundle.recordId");
  const revisionId = asString(input["revisionId"], "$.providerEvidenceBundle.revisionId");
  const subject = asString(input["subject"], "$.providerEvidenceBundle.subject");
  const issuerCik = asString(input["issuerCik"], "$.providerEvidenceBundle.issuerCik");
  const fiscalPeriod = asString(input["fiscalPeriod"], "$.providerEvidenceBundle.fiscalPeriod");
  const sourceKind = asString(input["sourceKind"], "$.providerEvidenceBundle.sourceKind");
  const primaryArtifactHash = asString(
    input["primaryArtifactHash"],
    "$.providerEvidenceBundle.primaryArtifactHash",
  );
  for (const [path, identifier] of [
    ["provider", provider],
    ["source", source],
    ["recordId", recordId],
    ["revisionId", revisionId],
    ["subject", subject],
    ["sourceKind", sourceKind],
  ] as const) {
    assertDomainIdentifier(identifier, `$.providerEvidenceBundle.${path}`);
  }
  if (!/^\d{10}$/u.test(issuerCik)) {
    fail("$.providerEvidenceBundle.issuerCik must be ten digits", "identity-invalid");
  }
  if (!FISCAL_PERIOD.test(fiscalPeriod)) {
    fail(
      "$.providerEvidenceBundle.fiscalPeriod must be a canonical fiscal period",
      "identity-invalid",
    );
  }
  assertArtifactHash(primaryArtifactHash, "$.providerEvidenceBundle.primaryArtifactHash");
  const evidence = canonicalizeEvidenceReferences(input["evidence"]);
  if (evidence.filter((reference) => reference.artifactHash === primaryArtifactHash).length !== 1) {
    fail(
      "$.providerEvidenceBundle.primaryArtifactHash must appear exactly once in evidence",
      "membership-invalid",
    );
  }
  return frozen({
    provider,
    source,
    recordId,
    revisionId,
    subject,
    issuerCik,
    fiscalPeriod,
    sourceKind,
    primaryArtifactHash,
    evidence,
  }) as ProviderEvidenceBundleInput;
}

/** Strictly validates the hash-covered shape, excluding the derived bundle hash itself. */
export function validateProviderEvidenceBundleInput(value: unknown): ProviderEvidenceBundleInput {
  return providerBoundary(() => validateInput(value));
}

/** Returns the exact ADR 0007 canonical preimage, with evidence sorted by role then digest. */
export function providerEvidenceBundleHashPreimage(value: unknown): JsonObject {
  return providerBoundary(() => {
    const input = validateInput(value);
    return frozen({
      provider: input.provider,
      source: input.source,
      recordId: input.recordId,
      revisionId: input.revisionId,
      subject: input.subject,
      issuerCik: input.issuerCik,
      fiscalPeriod: input.fiscalPeriod,
      sourceKind: input.sourceKind,
      primaryArtifactHash: input.primaryArtifactHash,
      evidence: input.evidence,
    }) as JsonObject;
  });
}

export function computeProviderEvidenceBundleHash(value: unknown): string {
  return providerBoundary(() =>
    canonicalHash(PROVIDER_EVIDENCE_BUNDLE_HASH_DOMAIN, providerEvidenceBundleHashPreimage(value)),
  );
}

/** Assembles a detached persisted bundle from the exact, closed input shape. */
export function createProviderEvidenceBundle(value: unknown): ProviderEvidenceBundle {
  return providerBoundary(() => {
    const input = validateInput(value);
    return frozen({
      ...input,
      evidenceBundleHash: computeProviderEvidenceBundleHash(input),
    }) as ProviderEvidenceBundle;
  });
}

/** Validates a persisted bundle and verifies that its stored hash is the exact derived identity. */
export function validateProviderEvidenceBundle(value: unknown): ProviderEvidenceBundle {
  return providerBoundary(() => {
    assertEvidenceMemberLimit(value, true);
    assertJsonWithinLimits(value, {
      maxDepth: 4,
      maxNodes: 65,
      maxArrayLength: EVIDENCE_BUNDLE_MAX_MEMBERS,
      maxObjectKeys: BUNDLE_FIELDS.length,
      maxStringBytes: 512,
      maxCanonicalBytes: 16_512,
    });
    const bundle = asObject(inertJsonSnapshot(value as JsonValue), "$.providerEvidenceBundle");
    assertExactFields(bundle, BUNDLE_FIELDS, "$.providerEvidenceBundle");
    const evidenceBundleHash = asString(
      bundle["evidenceBundleHash"],
      "$.providerEvidenceBundle.evidenceBundleHash",
    );
    assertArtifactHash(evidenceBundleHash, "$.providerEvidenceBundle.evidenceBundleHash");
    const { evidenceBundleHash: _ignored, ...input } = bundle;
    const canonical = createProviderEvidenceBundle(input);
    if (canonical.evidenceBundleHash !== evidenceBundleHash) {
      fail(
        "$.providerEvidenceBundle.evidenceBundleHash does not match the canonical preimage",
        "bundle-hash-mismatch",
      );
    }
    return canonical;
  });
}
