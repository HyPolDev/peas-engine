import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "../src/core/json.js";
import {
  canonicalizeEvidenceReferences,
  computeProviderEvidenceBundleHash,
  createProviderEvidenceBundle,
  EVIDENCE_BUNDLE_MAX_MEMBERS,
  EVIDENCE_BUNDLE_MIN_MEMBERS,
  EVIDENCE_REFERENCE_ROLE_MAX_LENGTH,
  PROVIDER_EVIDENCE_BUNDLE_ERROR_CODES,
  PROVIDER_EVIDENCE_BUNDLE_HASH_DOMAIN,
  ProviderEvidenceBundleError,
  providerEvidenceBundleHashPreimage,
  validateEvidenceReference,
  validateProviderEvidenceBundle,
} from "../src/providers/evidence-bundle.js";
import {
  canonicalizeSecSubjectCik,
  deriveSecProviderEnvelope,
  deriveSecRecordId,
  SEC_ACCESSION_PATTERN,
  SEC_CIK_DIGITS,
  SEC_DECODER_SNIFF_BYTES,
  SEC_EVIDENCE_BUNDLE_MAX_MEMBERS,
  SEC_EVIDENCE_BUNDLE_MIN_MEMBERS,
  SEC_EVIDENCE_ROLE_CARDINALITY,
  SEC_EVIDENCE_ROLE_MAX_LENGTH,
  SEC_EVIDENCE_ROLES,
  SEC_MAX_ATTRIBUTES_PER_TAG,
  SEC_MAX_BUNDLE_BYTES,
  SEC_MAX_EXTRACTED_TEXT_BYTES,
  SEC_MAX_MARKUP_DEPTH,
  SEC_MAX_MARKUP_TOKENS,
  SEC_MAX_MEMBER_BYTES,
  SEC_MAX_TRANSCRIPT_BYTES,
  SEC_MAX_TRANSCRIPT_MEMBERS,
  SEC_NORMALIZER_SOURCE,
  SEC_PARSE_LIMIT_KINDS,
  SEC_PROVIDER,
  SEC_REASON_CODES,
  SEC_RECORD_ID_SUFFIXES,
  SEC_REPEATING_EVIDENCE_ROLES,
  SEC_REQUIRED_EVIDENCE_ROLES,
  SEC_REVISION_ID,
  SEC_SINGLETON_EVIDENCE_ROLES,
  SecContractError,
  type SecEvidenceValidationOptions,
  selectSec8kPrimaryArtifact,
  validateSecAccession,
  validateSecEvidenceBundle,
} from "../src/providers/sec/contracts.js";

const digest = (value: number): string => value.toString(16).padStart(64, "0");
const PRIMARY = digest(10);
const DOCUMENT = digest(11);
const INDEX = digest(12);
const SUBMISSIONS = digest(13);
const XBRL = digest(14);
const EXHIBIT_TWO = digest(15);

const PINNED_PREIMAGE =
  '{"evidence":[{"artifactHash":"000000000000000000000000000000000000000000000000000000000000000a","role":"sec.exhibit-99.1"},{"artifactHash":"000000000000000000000000000000000000000000000000000000000000000f","role":"sec.exhibit-99.1"},{"artifactHash":"000000000000000000000000000000000000000000000000000000000000000c","role":"sec.filing-index"},{"artifactHash":"000000000000000000000000000000000000000000000000000000000000000b","role":"sec.primary-document"},{"artifactHash":"000000000000000000000000000000000000000000000000000000000000000d","role":"sec.submissions"},{"artifactHash":"000000000000000000000000000000000000000000000000000000000000000e","role":"sec.xbrl-instance"}],"fiscalPeriod":"2024-Q1","issuerCik":"0000000123","primaryArtifactHash":"000000000000000000000000000000000000000000000000000000000000000a","provider":"sec-edgar","recordId":"sec:0000000123-24-000001:earnings-source-v2","revisionId":"1","source":"sec:normalizer-v1","sourceKind":"sec_8k","subject":"earnings:0000000123:2024-Q1"}';
const PINNED_BUNDLE_HASH = "eb52cbd12636d2a9d0e0a124b55c47cbb48f1a08b69e0f240ff6503bf46b9e35";

function sec8kInput() {
  return {
    provider: SEC_PROVIDER,
    source: SEC_NORMALIZER_SOURCE,
    recordId: "sec:0000000123-24-000001:earnings-source-v2",
    revisionId: SEC_REVISION_ID,
    subject: "earnings:0000000123:2024-Q1",
    issuerCik: "0000000123",
    fiscalPeriod: "2024-Q1",
    sourceKind: "sec_8k",
    primaryArtifactHash: PRIMARY,
    evidence: [
      { role: "sec.xbrl-instance", artifactHash: XBRL },
      { role: "sec.exhibit-99.1", artifactHash: EXHIBIT_TWO },
      { role: "sec.primary-document", artifactHash: DOCUMENT },
      { role: "sec.filing-index", artifactHash: INDEX },
      { role: "sec.exhibit-99.1", artifactHash: PRIMARY },
      { role: "sec.submissions", artifactHash: SUBMISSIONS },
    ],
  };
}

function filingInput(includeXbrl = false) {
  const evidence = [
    { role: "sec.primary-document", artifactHash: DOCUMENT },
    { role: "sec.filing-index", artifactHash: INDEX },
    { role: "sec.submissions", artifactHash: SUBMISSIONS },
  ];
  if (includeXbrl) evidence.push({ role: "sec.xbrl-instance", artifactHash: XBRL });
  return {
    ...sec8kInput(),
    recordId: "sec:9876543210-24-000002:periodic-source-v2",
    sourceKind: "filing",
    primaryArtifactHash: DOCUMENT,
    evidence,
  };
}

function maximumSec8kInput() {
  const input = sec8kInput();
  return {
    ...input,
    evidence: [
      ...input.evidence,
      ...Array.from({ length: 10 }, (_, index) => ({
        role: "sec.exhibit-99.1",
        artifactHash: digest(100 + index),
      })),
    ],
  };
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length < 2) return [[...values]];
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const selected = values[index];
    if (selected === undefined) continue;
    const remainder = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(remainder)) result.push([selected, ...suffix]);
  }
  return result;
}

function expectProviderCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => {
    assert.equal(error instanceof ProviderEvidenceBundleError, true);
    assert.equal((error as ProviderEvidenceBundleError).code, code);
    return true;
  });
}

function expectSecReason(operation: () => unknown, reasonCode: string): void {
  assert.throws(operation, (error: unknown) => {
    assert.equal(error instanceof SecContractError, true);
    assert.equal((error as SecContractError).reasonCode, reasonCode);
    return true;
  });
}

test("pins the exact canonical preimage, role-then-digest order, and bundle hash", () => {
  const input = sec8kInput();
  const preimage = providerEvidenceBundleHashPreimage(input);
  const bundle = createProviderEvidenceBundle(input);
  assert.equal(PROVIDER_EVIDENCE_BUNDLE_HASH_DOMAIN, "peas/provider-evidence-bundle/v1");
  assert.equal(canonicalJson(preimage), PINNED_PREIMAGE);
  assert.equal(computeProviderEvidenceBundleHash(input), PINNED_BUNDLE_HASH);
  assert.equal(bundle.evidenceBundleHash, PINNED_BUNDLE_HASH);
  assert.deepEqual(
    bundle.evidence.map(({ role, artifactHash }) => [role, artifactHash]),
    [
      ["sec.exhibit-99.1", PRIMARY],
      ["sec.exhibit-99.1", EXHIBIT_TWO],
      ["sec.filing-index", INDEX],
      ["sec.primary-document", DOCUMENT],
      ["sec.submissions", SUBMISSIONS],
      ["sec.xbrl-instance", XBRL],
    ],
  );
});

test("bundle hashing is sensitive to every preimage field", () => {
  const input = sec8kInput();
  const baseline = computeProviderEvidenceBundleHash(input);
  const mutations = new Map<string, unknown>([
    ["provider", { ...input, provider: "sec-edgar-v2" }],
    ["source", { ...input, source: "sec:normalizer-v2" }],
    ["recordId", { ...input, recordId: "sec:9999999999-24-000001:earnings-source-v2" }],
    ["revisionId", { ...input, revisionId: "2" }],
    ["subject", { ...input, subject: "earnings:0000000124:2024-Q1" }],
    ["issuerCik", { ...input, issuerCik: "0000000124" }],
    ["fiscalPeriod", { ...input, fiscalPeriod: "2024-Q2" }],
    ["sourceKind", { ...input, sourceKind: "filing" }],
    ["primaryArtifactHash", { ...input, primaryArtifactHash: EXHIBIT_TWO }],
    [
      "evidence.role",
      {
        ...input,
        evidence: input.evidence.map((member) =>
          member.artifactHash === XBRL ? { ...member, role: "sec.xbrl-instance-v2" } : member,
        ),
      },
    ],
    [
      "evidence.artifactHash",
      {
        ...input,
        evidence: input.evidence.map((member) =>
          member.artifactHash === XBRL ? { ...member, artifactHash: digest(16) } : member,
        ),
      },
    ],
  ]);
  for (const [field, mutation] of mutations) {
    assert.notEqual(computeProviderEvidenceBundleHash(mutation), baseline, field);
  }
});

test("all arbitrary member permutations have one canonical identity", () => {
  const input = sec8kInput();
  const expected = createProviderEvidenceBundle(input);
  const allPermutations = permutations(input.evidence);
  assert.equal(allPermutations.length, 720);
  for (const evidence of allPermutations) {
    const actual = createProviderEvidenceBundle({ ...input, evidence });
    assert.equal(actual.evidenceBundleHash, expected.evidenceBundleHash);
    assert.deepEqual(actual.evidence, expected.evidence);
  }
});

test("provider-neutral exact and one-over membership and role ceilings are structured", () => {
  const one = [{ role: "a".repeat(EVIDENCE_REFERENCE_ROLE_MAX_LENGTH), artifactHash: digest(1) }];
  assert.equal(canonicalizeEvidenceReferences(one).length, EVIDENCE_BUNDLE_MIN_MEMBERS);
  assert.equal(
    canonicalizeEvidenceReferences(
      Array.from({ length: EVIDENCE_BUNDLE_MAX_MEMBERS }, (_, index) => ({
        role: `r${index}`,
        artifactHash: digest(index + 1),
      })),
    ).length,
    EVIDENCE_BUNDLE_MAX_MEMBERS,
  );
  expectProviderCode(() => canonicalizeEvidenceReferences([]), "membership-invalid");
  expectProviderCode(
    () =>
      canonicalizeEvidenceReferences(
        Array.from({ length: EVIDENCE_BUNDLE_MAX_MEMBERS + 1 }, (_, index) => ({
          role: `r${index}`,
          artifactHash: digest(index + 1),
        })),
      ),
    "member-limit-exceeded",
  );
  assert.equal(validateEvidenceReference(one[0]).role.length, EVIDENCE_REFERENCE_ROLE_MAX_LENGTH);
  expectProviderCode(
    () => validateEvidenceReference({ role: "a".repeat(65), artifactHash: digest(1) }),
    "membership-invalid",
  );
});

test("provider-neutral malformed membership and persisted hashes fail with stable codes", () => {
  expectProviderCode(
    () => validateEvidenceReference({ role: "A", artifactHash: PRIMARY }),
    "membership-invalid",
  );
  expectProviderCode(
    () => validateEvidenceReference({ role: "sec.good", artifactHash: "A".repeat(64) }),
    "membership-invalid",
  );
  expectProviderCode(
    () =>
      canonicalizeEvidenceReferences([
        { role: "a", artifactHash: PRIMARY },
        { role: "b", artifactHash: PRIMARY },
      ]),
    "membership-invalid",
  );
  const bundle = createProviderEvidenceBundle(sec8kInput());
  assert.deepEqual(validateProviderEvidenceBundle(bundle), bundle);
  expectProviderCode(
    () => validateProviderEvidenceBundle({ ...bundle, evidenceBundleHash: digest(999) }),
    "bundle-hash-mismatch",
  );
  expectProviderCode(
    () => validateProviderEvidenceBundle({ ...bundle, url: "https://forbidden.invalid" }),
    "invalid-input",
  );
  assert.deepEqual(PROVIDER_EVIDENCE_BUNDLE_ERROR_CODES, [
    "invalid-input",
    "identity-invalid",
    "membership-invalid",
    "member-limit-exceeded",
    "bundle-hash-mismatch",
  ]);
});

test("SEC exact and one-over member limits use the dedicated reason", () => {
  const exact = maximumSec8kInput();
  assert.equal(exact.evidence.length, SEC_EVIDENCE_BUNDLE_MAX_MEMBERS);
  assert.equal(validateSecEvidenceBundle(exact).evidence.length, SEC_EVIDENCE_BUNDLE_MAX_MEMBERS);
  expectSecReason(
    () =>
      validateSecEvidenceBundle({
        ...exact,
        evidence: [...exact.evidence, { role: "sec.exhibit-99.1", artifactHash: digest(200) }],
      }),
    "sec.member-limit-exceeded",
  );
});

test("every SEC required role and structured-focus combination is enforced", () => {
  const sec8k = sec8kInput();
  for (const role of ["sec.submissions", "sec.filing-index", "sec.primary-document"] as const) {
    expectSecReason(
      () =>
        validateSecEvidenceBundle({
          ...sec8k,
          evidence: sec8k.evidence.filter((member) => member.role !== role),
        }),
      "sec.required-member-missing",
    );
  }
  expectSecReason(
    () =>
      validateSecEvidenceBundle({
        ...sec8k,
        evidence: sec8k.evidence
          .filter((member) => member.role !== "sec.exhibit-99.1")
          .concat({ role: "sec.periodic-report", artifactHash: PRIMARY }),
      }),
    "sec.required-member-missing",
  );
  expectSecReason(
    () =>
      validateSecEvidenceBundle({
        ...sec8k,
        evidence: sec8k.evidence.filter((member) => member.role !== "sec.xbrl-instance"),
      }),
    "sec.required-member-missing",
  );
  const filing = filingInput();
  for (const role of ["sec.submissions", "sec.filing-index"] as const) {
    expectSecReason(
      () =>
        validateSecEvidenceBundle({
          ...filing,
          evidence: filing.evidence.filter((member) => member.role !== role),
        }),
      "sec.required-member-missing",
    );
  }
  expectSecReason(
    () =>
      validateSecEvidenceBundle({
        ...filing,
        evidence: filing.evidence
          .filter((member) => member.role !== "sec.primary-document")
          .concat({ role: "sec.xbrl-instance", artifactHash: DOCUMENT }),
      }),
    "sec.required-member-missing",
  );
});

test("every SEC singleton and repeating-role cardinality is closed", () => {
  const input = sec8kInput();
  for (const [index, role] of SEC_SINGLETON_EVIDENCE_ROLES.entries()) {
    const existing = input.evidence.filter((member) => member.role === role);
    const additions = existing.length === 0 ? 2 : 1;
    expectSecReason(
      () =>
        validateSecEvidenceBundle({
          ...input,
          evidence: [
            ...input.evidence,
            ...Array.from({ length: additions }, (_, offset) => ({
              role,
              artifactHash: digest(300 + index * 2 + offset),
            })),
          ],
        }),
      "sec.bundle-invalid",
    );
  }
  assert.equal(
    validateSecEvidenceBundle(input).evidence.filter((m) => m.role === "sec.exhibit-99.1").length,
    2,
  );
  assert.equal(
    validateSecEvidenceBundle({
      ...input,
      evidence: [...input.evidence, { role: "sec.periodic-report", artifactHash: digest(400) }],
    }).evidence.length,
    input.evidence.length + 1,
  );
  expectSecReason(
    () =>
      validateSecEvidenceBundle({
        ...input,
        evidence: [...input.evidence, { role: "sec.unknown", artifactHash: digest(401) }],
      }),
    "sec.bundle-invalid",
  );
  expectSecReason(
    () =>
      validateSecEvidenceBundle({
        ...input,
        evidence: [...input.evidence, { role: "sec.exhibit-99.1", artifactHash: XBRL }],
      }),
    "sec.bundle-invalid",
  );
});

test("SEC primary roles and filing XBRL policy true and false are exact", () => {
  const sec8k = sec8kInput();
  expectSecReason(
    () => validateSecEvidenceBundle({ ...sec8k, primaryArtifactHash: DOCUMENT }),
    "sec.bundle-invalid",
  );
  const filing = filingInput();
  assert.equal(validateSecEvidenceBundle(filing).primaryArtifactHash, DOCUMENT);
  assert.equal(
    validateSecEvidenceBundle(filing, { filingRequiresXbrlInstance: false }).primaryArtifactHash,
    DOCUMENT,
  );
  expectSecReason(
    () => validateSecEvidenceBundle(filing, { filingRequiresXbrlInstance: true }),
    "sec.required-member-missing",
  );
  assert.equal(
    validateSecEvidenceBundle(filingInput(true), { filingRequiresXbrlInstance: true }).evidence
      .length,
    4,
  );
  expectSecReason(
    () => validateSecEvidenceBundle({ ...filingInput(true), primaryArtifactHash: XBRL }),
    "sec.bundle-invalid",
  );
});

test("SEC durable identity is exact without comparing accession prefix to subject CIK", () => {
  const input = sec8kInput();
  assert.equal(
    validateSecEvidenceBundle({
      ...input,
      recordId: "sec:9999999999-24-000001:earnings-source-v2",
    }).issuerCik,
    "0000000123",
  );
  const badIdentity = [
    { ...input, provider: "other" },
    { ...input, source: "sec:normalizer-v2" },
    { ...input, revisionId: "2" },
    { ...input, subject: "earnings:9999999999:2024-Q1" },
    { ...input, issuerCik: "123" },
    { ...input, fiscalPeriod: "2024-Q5" },
    { ...input, recordId: "sec:0000000123-24-000001:periodic-source-v2" },
    { ...input, recordId: "sec:123-24-1:earnings-source-v2" },
    { ...input, recordId: "0000000123-24-000001:earnings-source-v2" },
    { ...input, sourceKind: "filing" },
  ];
  for (const bad of badIdentity) {
    expectSecReason(() => validateSecEvidenceBundle(bad), "sec.identity-mismatch");
  }
  assert.equal(canonicalizeSecSubjectCik("123"), "0000000123");
  assert.equal(validateSecAccession("0000000123-24-000001"), "0000000123-24-000001");
  assert.equal(
    deriveSecRecordId("0000000123-24-000001", "sec_8k"),
    "sec:0000000123-24-000001:earnings-source-v2",
  );
  assert.equal(
    deriveSecRecordId("9999999999-24-000002", "filing"),
    "sec:9999999999-24-000002:periodic-source-v2",
  );
});

test("stored hash failures map by discriminator rather than English messages", () => {
  const bundle = createProviderEvidenceBundle(sec8kInput());
  expectSecReason(
    () => validateSecEvidenceBundle({ ...bundle, evidenceBundleHash: digest(999) }),
    "sec.bundle-hash-mismatch",
  );
  expectSecReason(
    () => validateSecEvidenceBundle({ ...bundle, evidenceBundleHash: "not-a-hash" }),
    "sec.bundle-invalid",
  );
});

test("hostile bundle containers never execute and only SecContractError crosses SEC boundaries", () => {
  const attacks: unknown[] = [];

  const hidden = sec8kInput();
  Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
  attacks.push(hidden);

  const symbol = sec8kInput() as Record<PropertyKey, unknown>;
  symbol[Symbol("hidden")] = true;
  attacks.push(symbol);

  const sparse = sec8kInput();
  delete sparse.evidence[1];
  attacks.push(sparse);

  const cyclic = sec8kInput();
  cyclic.evidence[0] = cyclic.evidence as unknown as (typeof cyclic.evidence)[number];
  attacks.push(cyclic);

  let accessorReads = 0;
  const nestedAccessor = sec8kInput();
  Object.defineProperty(nestedAccessor.evidence[0], "role", {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return "sec.xbrl-instance";
    },
  });
  attacks.push(nestedAccessor);

  let proxyExecutions = 0;
  attacks.push(
    new Proxy(sec8kInput(), {
      ownKeys: () => {
        proxyExecutions += 1;
        return [];
      },
    }),
  );
  const nestedProxy = sec8kInput();
  const proxiedMember = nestedProxy.evidence[0];
  assert.notEqual(proxiedMember, undefined);
  nestedProxy.evidence[0] = new Proxy(proxiedMember as { role: string; artifactHash: string }, {
    get: (target, property, receiver) => {
      proxyExecutions += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  attacks.push(nestedProxy);

  const surprisingPrototype = Object.assign(Object.create({ inherited: true }), sec8kInput());
  attacks.push(surprisingPrototype);

  for (const attack of attacks) {
    expectSecReason(() => validateSecEvidenceBundle(attack), "sec.bundle-invalid");
  }
  assert.equal(accessorReads, 0);
  assert.equal(proxyExecutions, 0);
});

test("SEC validation options are optional exact inert data with one boolean field", () => {
  const filing = filingInput();
  assert.equal(validateSecEvidenceBundle(filing, {}).evidence.length, 3);
  const nullPrototype = Object.assign(Object.create(null), {
    filingRequiresXbrlInstance: false,
  }) as SecEvidenceValidationOptions;
  assert.equal(validateSecEvidenceBundle(filing, nullPrototype).evidence.length, 3);

  const attacks: unknown[] = [
    null,
    [],
    { filingRequiresXbrlInstance: 1 },
    { filingRequiresXbrlInstance: false, extra: true },
    Object.assign(Object.create({ inherited: true }), { filingRequiresXbrlInstance: false }),
  ];
  const hidden = { filingRequiresXbrlInstance: false };
  Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
  attacks.push(hidden);
  const symbol = { filingRequiresXbrlInstance: false } as Record<PropertyKey, unknown>;
  symbol[Symbol("hidden")] = true;
  attacks.push(symbol);

  let accessorReads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "filingRequiresXbrlInstance", {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return false;
    },
  });
  attacks.push(accessor);
  const nestedAccessor = {
    filingRequiresXbrlInstance: Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return false;
      },
    }),
  };
  attacks.push(nestedAccessor);

  let proxyExecutions = 0;
  attacks.push(
    new Proxy(
      { filingRequiresXbrlInstance: false },
      {
        get: (target, property, receiver) => {
          proxyExecutions += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    ),
  );
  const cyclic: { filingRequiresXbrlInstance?: unknown } = {};
  cyclic.filingRequiresXbrlInstance = cyclic;
  attacks.push(cyclic);

  for (const attack of attacks) {
    expectSecReason(
      () => validateSecEvidenceBundle(filing, attack as SecEvidenceValidationOptions),
      "sec.bundle-invalid",
    );
  }
  assert.equal(accessorReads, 0);
  assert.equal(proxyExecutions, 0);
});

test("sequence and provider-envelope hostile input cannot leak raw traversal errors", () => {
  let reads = 0;
  const sequence = { artifactHash: PRIMARY, role: "sec.exhibit-99.1", sequence: 1 };
  Object.defineProperty(sequence, "sequence", {
    enumerable: true,
    get: () => {
      reads += 1;
      return 1;
    },
  });
  expectSecReason(() => selectSec8kPrimaryArtifact([sequence]), "sec.bundle-invalid");
  expectSecReason(
    () =>
      deriveSecProviderEnvelope(
        new Proxy(
          {
            accession: "0000000123-24-000001",
            sourceKind: "sec_8k",
            subjectCik: "123",
            fiscalPeriod: "2024-Q1",
            primaryArtifactHash: PRIMARY,
            evidenceBundleHash: digest(9),
          },
          {
            get: (target, property, receiver) => {
              reads += 1;
              return Reflect.get(target, property, receiver);
            },
          },
        ),
      ),
    "sec.identity-mismatch",
  );
  assert.equal(reads, 0);
});

test("outputs are detached frozen null-prototype data and resist caller mutation", () => {
  const input = sec8kInput();
  const bundle = createProviderEvidenceBundle(input);
  const originalHash = bundle.evidenceBundleHash;
  input.provider = "mutated";
  const mutableMember = input.evidence[0];
  if (mutableMember === undefined) throw new Error("test setup requires one evidence member");
  mutableMember.role = "mutated";
  input.evidence.push({ role: "mutated", artifactHash: digest(500) });
  assert.equal(bundle.provider, SEC_PROVIDER);
  assert.equal(bundle.evidenceBundleHash, originalHash);
  assert.equal(Object.getPrototypeOf(bundle), null);
  assert.equal(Object.getPrototypeOf(bundle.evidence[0]), null);
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.evidence), true);
  assert.equal(Object.isFrozen(bundle.evidence[0]), true);
  assert.throws(() => {
    (bundle as { provider: string }).provider = "attempted";
  }, TypeError);
  assert.throws(() => {
    (bundle.evidence as unknown as Array<unknown>).push({});
  }, TypeError);
  assert.equal(bundle.provider, SEC_PROVIDER);
  assert.equal(bundle.evidenceBundleHash, originalHash);

  const envelope = deriveSecProviderEnvelope({
    accession: "9999999999-24-000001",
    sourceKind: "sec_8k",
    subjectCik: "123",
    fiscalPeriod: "2024-Q1",
    primaryArtifactHash: PRIMARY,
    evidenceBundleHash: digest(9),
  });
  assert.equal(envelope.subject, "earnings:0000000123:2024-Q1");
  assert.equal(envelope.provider.recordId, "sec:9999999999-24-000001:earnings-source-v2");
  assert.equal(Object.getPrototypeOf(envelope), null);
  assert.equal(Object.getPrototypeOf(envelope.provider), null);
  assert.equal(Object.isFrozen(envelope.provider), true);
});

test("observation identity, time, randomness, and caller insertion order are non-semantic", () => {
  const assemble = (_observationId: string, _retrievedAtMs: number) =>
    createProviderEvidenceBundle(sec8kInput());
  const originalNow = Date.now;
  const originalRandom = Math.random;
  Date.now = () => {
    throw new Error("clock access is forbidden");
  };
  Math.random = () => {
    throw new Error("random access is forbidden");
  };
  try {
    const first = assemble("observation-a", 1);
    const second = assemble("observation-b", 9_999_999);
    assert.deepEqual(first, second);
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
  }
  expectSecReason(
    () => validateSecEvidenceBundle({ ...sec8kInput(), selectedObservationId: "forbidden" }),
    "sec.bundle-invalid",
  );
});

test("primary selection is positive, unique, deterministic, and bounded", () => {
  assert.equal(
    selectSec8kPrimaryArtifact([
      { role: "sec.exhibit-99.1", artifactHash: EXHIBIT_TWO, sequence: 2 },
      { role: "sec.exhibit-99.1", artifactHash: PRIMARY, sequence: 1 },
    ]),
    PRIMARY,
  );
  for (const invalid of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    expectSecReason(
      () =>
        selectSec8kPrimaryArtifact([
          { role: "sec.exhibit-99.1", artifactHash: PRIMARY, sequence: invalid },
        ]),
      "sec.bundle-invalid",
    );
  }
  expectSecReason(
    () =>
      selectSec8kPrimaryArtifact([
        { role: "sec.exhibit-99.1", artifactHash: PRIMARY, sequence: 1 },
        { role: "sec.exhibit-99.1", artifactHash: EXHIBIT_TWO, sequence: 1 },
      ]),
    "sec.bundle-invalid",
  );
});

test("all exported ceilings, role matrices, and stable reasons are pinned", () => {
  assert.deepEqual(
    {
      EVIDENCE_REFERENCE_ROLE_MAX_LENGTH,
      EVIDENCE_BUNDLE_MIN_MEMBERS,
      EVIDENCE_BUNDLE_MAX_MEMBERS,
      SEC_EVIDENCE_ROLE_MAX_LENGTH,
      SEC_EVIDENCE_BUNDLE_MIN_MEMBERS,
      SEC_EVIDENCE_BUNDLE_MAX_MEMBERS,
      SEC_MAX_MEMBER_BYTES,
      SEC_MAX_BUNDLE_BYTES,
      SEC_MAX_MARKUP_TOKENS,
      SEC_MAX_MARKUP_DEPTH,
      SEC_MAX_ATTRIBUTES_PER_TAG,
      SEC_MAX_EXTRACTED_TEXT_BYTES,
      SEC_MAX_TRANSCRIPT_BYTES,
      SEC_DECODER_SNIFF_BYTES,
      SEC_MAX_TRANSCRIPT_MEMBERS,
    },
    {
      EVIDENCE_REFERENCE_ROLE_MAX_LENGTH: 64,
      EVIDENCE_BUNDLE_MIN_MEMBERS: 1,
      EVIDENCE_BUNDLE_MAX_MEMBERS: 16,
      SEC_EVIDENCE_ROLE_MAX_LENGTH: 64,
      SEC_EVIDENCE_BUNDLE_MIN_MEMBERS: 1,
      SEC_EVIDENCE_BUNDLE_MAX_MEMBERS: 16,
      SEC_MAX_MEMBER_BYTES: 10 * 1024 * 1024,
      SEC_MAX_BUNDLE_BYTES: 32 * 1024 * 1024,
      SEC_MAX_MARKUP_TOKENS: 250_000,
      SEC_MAX_MARKUP_DEPTH: 256,
      SEC_MAX_ATTRIBUTES_PER_TAG: 256,
      SEC_MAX_EXTRACTED_TEXT_BYTES: 4 * 1024 * 1024,
      SEC_MAX_TRANSCRIPT_BYTES: 256 * 1024,
      SEC_DECODER_SNIFF_BYTES: 1_024,
      SEC_MAX_TRANSCRIPT_MEMBERS: 16,
    },
  );
  assert.equal(SEC_CIK_DIGITS, 10);
  assert.equal(SEC_ACCESSION_PATTERN.source, "^\\d{10}-\\d{2}-\\d{6}$");
  assert.deepEqual(SEC_RECORD_ID_SUFFIXES, {
    sec_8k: "earnings-source-v2",
    filing: "periodic-source-v2",
  });
  assert.deepEqual(SEC_EVIDENCE_ROLES, [
    "sec.submissions",
    "sec.filing-index",
    "sec.primary-document",
    "sec.exhibit-99.1",
    "sec.periodic-report",
    "sec.xbrl-instance",
  ]);
  assert.deepEqual(SEC_REQUIRED_EVIDENCE_ROLES, {
    sec_8k: ["sec.submissions", "sec.filing-index", "sec.primary-document", "sec.exhibit-99.1"],
    filing: ["sec.submissions", "sec.filing-index", "sec.primary-document"],
  });
  assert.deepEqual(SEC_SINGLETON_EVIDENCE_ROLES, [
    "sec.submissions",
    "sec.filing-index",
    "sec.primary-document",
    "sec.xbrl-instance",
    "sec.periodic-report",
  ]);
  assert.deepEqual(SEC_REPEATING_EVIDENCE_ROLES, ["sec.exhibit-99.1"]);
  assert.deepEqual(SEC_EVIDENCE_ROLE_CARDINALITY, {
    "sec.submissions": "exactly-one",
    "sec.filing-index": "exactly-one",
    "sec.primary-document": "exactly-one",
    "sec.exhibit-99.1": "repeating",
    "sec.periodic-report": "zero-or-one",
    "sec.xbrl-instance": "zero-or-one",
  });
  assert.deepEqual(SEC_PARSE_LIMIT_KINDS, [
    "markup-tokens",
    "markup-depth",
    "attributes-per-tag",
    "extracted-text-bytes",
  ]);
  assert.deepEqual(SEC_REASON_CODES, [
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
  ]);
});
