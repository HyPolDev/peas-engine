import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  SEC_FIXTURE_CASES,
  SEC_GENERATED_BOUNDARY_VECTORS,
  type SecFixtureCase,
} from "../fixtures/sec/v1/manifest.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { createProviderEvidenceBundle } from "../src/providers/evidence-bundle.js";
import {
  SEC_MAX_ATTRIBUTES_PER_TAG,
  SEC_MAX_BUNDLE_BYTES,
  SEC_MAX_EXTRACTED_TEXT_BYTES,
  SEC_MAX_MARKUP_DEPTH,
  SEC_MAX_MARKUP_TOKENS,
  SEC_MAX_MEMBER_BYTES,
  SEC_MAX_TRANSCRIPT_BYTES,
} from "../src/providers/sec/contracts.js";
import {
  assertSecTranscriptSerializedWithinLimit,
  computeSecNormalizationTranscriptHash,
  convertSecEasternAcceptanceDateTime,
  normalizeSecBundle,
  parseSecRfc3339AcceptanceDateTime,
  SEC_NORMALIZED_DRAFT_HASH_DOMAIN,
  SEC_NORMALIZER_POLICY,
  type SecNormalizationResult,
  type VerifiedSecBundle,
  type VerifiedSecMember,
} from "../src/providers/sec/normalizer.js";
import {
  decodeSecMember,
  normalizeSecEncodingLabel,
  probeSecDecoderCapabilities,
} from "../src/providers/sec/parsers/decoder.js";
import { SecParserError } from "../src/providers/sec/parsers/errors.js";
import { parseSecMarkup, SEC_MARKUP_CHUNK_BYTES } from "../src/providers/sec/parsers/markup.js";

const FIXTURE_ROOT = path.resolve("fixtures/sec/v1");
const PINNED_OUTPUT_HASH = "719d48ac767090f829ffb93cd4b24c886e8c8c50183a95a9ea5fb4a701ccd3cc";
const PINNED_TRANSCRIPT_HASH = "54f94b3e09a7440c9969037b7e32321787487f49f05dfd4c334940311311ed48";
const PINNED_INDEPENDENT_DRAFT_HASH =
  "0017c1e94175e22bc51fcb4d121a5d970776332a25f52cafee0d643049a7f203";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture(caseId: string): SecFixtureCase {
  const found = SEC_FIXTURE_CASES.find((candidate) => candidate.caseId === caseId);
  assert.ok(found, `missing SEC fixture ${caseId}`);
  return found;
}

function body(relative: string): Buffer {
  return readFileSync(path.join(FIXTURE_ROOT, relative));
}

function verifiedFixtureBundle(fixtureCase: SecFixtureCase): VerifiedSecBundle {
  return {
    provider: fixtureCase.provider,
    source: fixtureCase.source,
    recordId: fixtureCase.recordId,
    revisionId: fixtureCase.revisionId,
    sourceKind: fixtureCase.sourceKind,
    accession: fixtureCase.accession,
    subjectCik: fixtureCase.subjectCik,
    fiscalPeriod: fixtureCase.fiscalPeriod,
    primaryArtifactHash: fixtureCase.expectedPrimaryArtifactHash,
    evidenceBundleHash: fixtureCase.expected.evidenceBundleHash,
    members: fixtureCase.members.map((member) => ({
      role: member.role,
      memberKey: member.memberKey,
      artifactHash: member.artifactHash,
      sizeBytes: member.sizeBytes,
      bytes: body(member.path),
    })),
  };
}

function expectParserLimit(operation: () => unknown, limitKind: string): void {
  assert.throws(operation, (error: unknown) => {
    assert.equal(error instanceof SecParserError, true);
    assert.equal((error as SecParserError).reasonCode, "sec.parse-limit-exceeded");
    assert.equal((error as SecParserError).limitKind, limitKind);
    return true;
  });
}

function tokenMarkup(count: number): string {
  const base = ["<?fixture?>", "<root>", "<!--comment-->", "<![CDATA[cdata]]>", "text"];
  let remaining = count - 6;
  const odd = remaining % 2;
  remaining -= odd;
  return `${base.join("")}${"<x></x>".repeat(remaining / 2)}${odd ? "<!--extra-->" : ""}</root>`;
}

function sizedCommentMarkup(size: number, prefix = "<!doctype html>"): Buffer {
  const overhead = Buffer.byteLength(`${prefix}<!---->`, "utf8");
  assert.ok(size >= overhead);
  return Buffer.from(`${prefix}<!--${"x".repeat(size - overhead)}-->`, "utf8");
}

function padJson(value: JsonValue, size: number): Buffer {
  const serialized = canonicalJson(value);
  assert.ok(Buffer.byteLength(serialized) <= size);
  return Buffer.from(serialized + " ".repeat(size - Buffer.byteLength(serialized)), "utf8");
}

function member(role: string, memberKey: string, bytes: Uint8Array): VerifiedSecMember {
  return { role, memberKey, artifactHash: sha256(bytes), sizeBytes: bytes.byteLength, bytes };
}

function assembleBundle(
  sourceKind: "sec_8k" | "filing",
  accession: string,
  subjectCik: string,
  fiscalPeriod: string,
  members: readonly VerifiedSecMember[],
  primaryArtifactHash: string,
): VerifiedSecBundle {
  const issuerCik = subjectCik.padStart(10, "0");
  const recordId = `sec:${accession}:${
    sourceKind === "sec_8k" ? "earnings-source-v2" : "periodic-source-v2"
  }`;
  const evidenceBundleHash = createProviderEvidenceBundle({
    provider: "sec-edgar",
    source: "sec:normalizer-v1",
    recordId,
    revisionId: "1",
    subject: `earnings:${issuerCik}:${fiscalPeriod}`,
    issuerCik,
    fiscalPeriod,
    sourceKind,
    primaryArtifactHash,
    evidence: members.map(({ role, artifactHash }) => ({ role, artifactHash })),
  }).evidenceBundleHash;
  return {
    provider: "sec-edgar",
    source: "sec:normalizer-v1",
    recordId,
    revisionId: "1",
    sourceKind,
    accession,
    subjectCik,
    fiscalPeriod,
    primaryArtifactHash,
    evidenceBundleHash,
    members,
  };
}

function customSec8k(exhibitBytes: Uint8Array, exhibitCount = 1): VerifiedSecBundle {
  const exhibits = Array.from({ length: exhibitCount }, (_, index) =>
    member(
      "sec.exhibit-99.1",
      `exhibit-${String(index + 1).padStart(2, "0")}`,
      index === 0 ? exhibitBytes : Buffer.from(`<p data-index="${index}">x</p>`, "utf8"),
    ),
  );
  const indexBytes = Buffer.from(
    JSON.stringify({
      accession: "0000123456-26-000099",
      form: "8-K",
      items: ["2.02"],
      subjectCik: "0000123456",
      exhibits: exhibits.map((entry, index) => ({
        memberKey: entry.memberKey,
        type: "EX-99.1",
        sequence: index + 1,
      })),
    }),
    "utf8",
  );
  const members = [
    member(
      "sec.submissions",
      "submissions",
      Buffer.from(
        JSON.stringify({
          accession: "0000123456-26-000099",
          cik: "123456",
          form: "8-K",
          items: ["2.02"],
          acceptanceDateTime: "2026-05-07T20:15:30-04:00",
        }),
        "utf8",
      ),
    ),
    member("sec.filing-index", "filing-index", indexBytes),
    member(
      "sec.primary-document",
      "primary-document",
      Buffer.from(
        "<html><DOCUMENT-TYPE>8-K</DOCUMENT-TYPE><SUBJECT-CIK>0000123456</SUBJECT-CIK><ACCEPTANCE-DATETIME>20260507201530</ACCEPTANCE-DATETIME></html>",
        "utf8",
      ),
    ),
    ...exhibits,
    member(
      "sec.xbrl-instance",
      "xbrl-instance",
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><xbrl><dei:EntityCentralIndexKey>0000123456</dei:EntityCentralIndexKey><dei:DocumentFiscalYearFocus>2026</dei:DocumentFiscalYearFocus><dei:DocumentFiscalPeriodFocus>Q1</dei:DocumentFiscalPeriodFocus></xbrl>',
        "utf8",
      ),
    ),
  ];
  return assembleBundle(
    "sec_8k",
    "0000123456-26-000099",
    "123456",
    "2026-Q1",
    members,
    exhibits[0]?.artifactHash ?? "",
  );
}

function customFiling(primaryFocus: string, xbrlFocus: string | null): VerifiedSecBundle {
  const accession = "0000123456-26-000101";
  const primary = member(
    "sec.primary-document",
    "primary-document",
    Buffer.from(
      "<html><DOCUMENT-TYPE>10-Q</DOCUMENT-TYPE>" +
        "<SUBJECT-CIK>0000123456</SUBJECT-CIK>" +
        "<ACCEPTANCE-DATETIME>20260508120000</ACCEPTANCE-DATETIME>" +
        `${primaryFocus}</html>`,
      "utf8",
    ),
  );
  const members: VerifiedSecMember[] = [
    member(
      "sec.submissions",
      "submissions",
      Buffer.from(
        JSON.stringify({
          accession,
          cik: "123456",
          form: "10-Q",
          items: [],
          acceptanceDateTime: "2026-05-08T12:00:00-04:00",
        }),
        "utf8",
      ),
    ),
    member(
      "sec.filing-index",
      "filing-index",
      Buffer.from(
        JSON.stringify({
          accession,
          form: "10-Q",
          items: [],
          subjectCik: "0000123456",
          exhibits: [],
        }),
        "utf8",
      ),
    ),
    primary,
  ];
  if (xbrlFocus !== null) {
    members.push(
      member(
        "sec.xbrl-instance",
        "xbrl-instance",
        Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?><xbrl>' +
            "<dei:EntityCentralIndexKey>0000123456</dei:EntityCentralIndexKey>" +
            `${xbrlFocus}</xbrl>`,
          "utf8",
        ),
      ),
    );
  }
  return assembleBundle("filing", accession, "123456", "2026-Q1", members, primary.artifactHash);
}

test("decoder policy pins capability, closed aliases, BOM precedence, fallback, and sniff edges", () => {
  assert.equal(probeSecDecoderCapabilities(), true);
  const aliases = new Map([
    ["utf-8", "utf-8"],
    ["utf8", "utf-8"],
    ["unicode-1-1-utf-8", "utf-8"],
    ["windows-1252", "windows-1252"],
    ["cp1252", "windows-1252"],
    ["x-cp1252", "windows-1252"],
    ["iso-8859-1", "windows-1252"],
    ["iso8859-1", "windows-1252"],
    ["latin1", "windows-1252"],
    ["us-ascii", "windows-1252"],
  ] as const);
  for (const [label, encoding] of aliases) {
    const file = label === "utf-8" ? "decoder-declared-utf8.html" : `decoder-alias-${label}.html`;
    assert.equal(decodeSecMember(body(`bodies/${file}`), "html").encoding, encoding, label);
  }
  for (const rejected of ["utf_8", "ascii", "iso-8859-15", "koi8-r", "\u0130SO-8859-1"]) {
    assert.throws(
      () => decodeSecMember(Buffer.from(`<meta charset="${rejected}">`, "utf8"), "html"),
      (error: unknown) =>
        error instanceof SecParserError && error.reasonCode === "sec.unsupported-encoding",
      rejected,
    );
  }
  assert.equal(normalizeSecEncodingLabel("\tUTF-8\r"), "utf-8");
  assert.equal(decodeSecMember(body("bodies/decoder-utf8-bom.html"), "html").encoding, "utf-8");
  assert.equal(
    decodeSecMember(body("bodies/decoder-undeclared-windows-1252.html"), "html").encoding,
    "windows-1252",
  );
  assert.throws(() => decodeSecMember(body("bodies/decoder-bom-conflict.html"), "html"));
  assert.equal(
    decodeSecMember(body("bodies/decoder-sniff-exact-1024.html"), "html").declaredLabel,
    "utf-8",
  );
  assert.equal(
    decodeSecMember(body("bodies/decoder-sniff-crossing-1024.html"), "html").declaredLabel,
    null,
  );
  assert.throws(() => decodeSecMember(Uint8Array.of(0xff), "json"));
  assert.throws(() =>
    decodeSecMember(Buffer.from('<?xml version="1.0" encoding="windows-1252"?><x/>'), "xml"),
  );
});

test("HTML decoder sniff ignores false meta declarations outside real markup", () => {
  const falseMetaContexts = [
    '<!-- <meta charset="utf-8"> -->',
    "<script>const fake = '<meta charset=\"utf-8\">';</script>",
    '<style>/* <meta charset="utf-8"> */</style>',
    '<?fixture value="<meta charset=utf-8>"?>',
    '<div data-fixture="<meta charset=utf-8>"></div>',
    '<textarea><meta charset="utf-8"></textarea>',
  ];
  for (const context of falseMetaContexts) {
    const decoded = decodeSecMember(
      Buffer.concat([Buffer.from(context, "ascii"), Buffer.from([0x93])]),
      "html",
    );
    assert.equal(decoded.encoding, "windows-1252", context);
    assert.equal(decoded.declaredLabel, null, context);
    assert.match(decoded.text, /\u201c/u, context);
  }
  const realAfterFalse = decodeSecMember(
    Buffer.from('<!-- <meta charset="koi8-r"> --><meta charset="utf-8"><p>caf\u00e9</p>'),
    "html",
  );
  assert.equal(realAfterFalse.encoding, "utf-8");
  assert.equal(realAfterFalse.declaredLabel, "utf-8");
});

test("HTML decoder skips complete bounded declarations and DOCTYPE internal subsets atomically", () => {
  const fallback = (declaration: string) =>
    decodeSecMember(
      Buffer.concat([Buffer.from(declaration, "ascii"), Buffer.from([0x93])]),
      "html",
    );

  const internalSubset = fallback('<!DOCTYPE html [ <!ELEMENT x ANY> <meta charset="utf-8"> ]>');
  assert.equal(internalSubset.encoding, "windows-1252");
  assert.equal(internalSubset.declaredLabel, null);
  assert.match(internalSubset.text, /\u201c/u);

  const nestedAndQuoted = fallback(
    "<!DOCTYPE html [" +
      " <!ELEMENT x (a | b)>" +
      ' <!ATTLIST x note CDATA "quoted > ] [">' +
      " <!ENTITY fake '<meta charset=\"utf-8\">'>" +
      ' <!-- nested ] > [ <meta charset="utf-8"> -->' +
      " ]>",
  );
  assert.equal(nestedAndQuoted.encoding, "windows-1252");
  assert.equal(nestedAndQuoted.declaredLabel, null);

  const realAfterDoctype = decodeSecMember(
    Buffer.from(
      "<!DOCTYPE html [ <!ENTITY fake \"<meta charset='koi8-r'>\"> ]>" +
        '<meta charset="utf-8"><p>caf\u00e9</p>',
      "utf8",
    ),
    "html",
  );
  assert.equal(realAfterDoctype.encoding, "utf-8");
  assert.equal(realAfterDoctype.declaredLabel, "utf-8");

  const unclosed = fallback(
    "<!DOCTYPE html [ <!ELEMENT x ANY> <!ENTITY fake 'quoted > [ ]'> " + '<meta charset="utf-8">',
  );
  assert.equal(unclosed.encoding, "windows-1252");
  assert.equal(unclosed.declaredLabel, null);
});

test("RFC 3339 and post-2007 Eastern conversion are host-timezone independent at DST edges", () => {
  assert.equal(
    parseSecRfc3339AcceptanceDateTime("2026-05-07T20:15:30-04:00"),
    Date.UTC(2026, 4, 8, 0, 15, 30),
  );
  for (const malformed of [
    "2026-02-30T09:15:00-05:00",
    "2026-05-07T20:15:30",
    "2026-05-07t20:15:30z",
    "2026-05-07T20:15:30.0000-04:00",
  ]) {
    assert.equal(parseSecRfc3339AcceptanceDateTime(malformed), null, malformed);
  }
  assert.deepEqual(convertSecEasternAcceptanceDateTime("20061101103000"), {
    kind: "unsupported",
  });
  assert.deepEqual(convertSecEasternAcceptanceDateTime("20260308020000"), { kind: "invalid" });
  assert.deepEqual(convertSecEasternAcceptanceDateTime("20261101010000"), { kind: "invalid" });
  assert.deepEqual(convertSecEasternAcceptanceDateTime("20260308015959"), {
    kind: "valid",
    epochMs: Date.UTC(2026, 2, 8, 6, 59, 59),
  });
  assert.deepEqual(convertSecEasternAcceptanceDateTime("20260308030000"), {
    kind: "valid",
    epochMs: Date.UTC(2026, 2, 8, 7, 0, 0),
  });
  assert.deepEqual(convertSecEasternAcceptanceDateTime("20261101020000"), {
    kind: "valid",
    epochMs: Date.UTC(2026, 10, 1, 7, 0, 0),
  });
});

test("streaming callbacks count directives, comments, CDATA, coalesced text, and are chunk invariant", () => {
  const markup = '<?xml version="1.0"?><root a="1"><!--c--><![CDATA[x]]>a&amp;b</root>';
  const one = parseSecMarkup(markup, "xml", 1);
  const fixed = parseSecMarkup(markup, "xml");
  assert.deepEqual(one, fixed);
  assert.equal(fixed.semanticTokens, 7);
  assert.equal(fixed.extractedTextBytes, 4);
  assert.equal(fixed.maxDepth, 1);

  const html = parseSecMarkup("<html><body><p>synthetic<div>continued", "html", 2);
  assert.ok(html.semanticTokens > 0);
  const astralAcrossByteBoundary = `<x>${"a".repeat(SEC_MARKUP_CHUNK_BYTES - 4)}\ud83d\ude00</x>`;
  const astralFixed = parseSecMarkup(astralAcrossByteBoundary, "xml");
  assert.deepEqual(parseSecMarkup(astralAcrossByteBoundary, "xml", 1), astralFixed);
  assert.deepEqual(parseSecMarkup(astralAcrossByteBoundary, "xml", 17), astralFixed);
  assert.equal(astralFixed.extractedTextBytes, SEC_MARKUP_CHUNK_BYTES);
  assert.throws(
    () => parseSecMarkup(body("bodies/xbrl-malformed.xml").toString("utf8"), "xml"),
    (error: unknown) =>
      error instanceof SecParserError && error.reasonCode === "sec.malformed-markup",
  );
});

test("all four markup ceilings pass exact and fail one-over with stable limitKind", () => {
  const tokenExact = parseSecMarkup(tokenMarkup(SEC_MAX_MARKUP_TOKENS), "xml");
  assert.equal(tokenExact.semanticTokens, SEC_MAX_MARKUP_TOKENS);
  expectParserLimit(
    () => parseSecMarkup(tokenMarkup(SEC_MAX_MARKUP_TOKENS + 1), "xml"),
    "markup-tokens",
  );

  const depthExact = parseSecMarkup(
    `${"<x>".repeat(SEC_MAX_MARKUP_DEPTH)}${"</x>".repeat(SEC_MAX_MARKUP_DEPTH)}`,
    "xml",
  );
  assert.equal(depthExact.maxDepth, SEC_MAX_MARKUP_DEPTH);
  expectParserLimit(
    () =>
      parseSecMarkup(
        `${"<x>".repeat(SEC_MAX_MARKUP_DEPTH + 1)}${"</x>".repeat(SEC_MAX_MARKUP_DEPTH + 1)}`,
        "xml",
      ),
    "markup-depth",
  );

  const attributes = (count: number) =>
    `<x ${Array.from({ length: count }, (_, index) => `a${index}=""`).join(" ")}></x>`;
  assert.equal(
    parseSecMarkup(attributes(SEC_MAX_ATTRIBUTES_PER_TAG), "xml").semanticTokens,
    SEC_MAX_ATTRIBUTES_PER_TAG + 2,
  );
  expectParserLimit(
    () => parseSecMarkup(attributes(SEC_MAX_ATTRIBUTES_PER_TAG + 1), "xml"),
    "attributes-per-tag",
  );

  const astralExact = `<x>${"a".repeat(SEC_MAX_EXTRACTED_TEXT_BYTES - 4)}\ud83d\ude00</x>`;
  assert.equal(parseSecMarkup(astralExact, "xml").extractedTextBytes, SEC_MAX_EXTRACTED_TEXT_BYTES);
  expectParserLimit(
    () => parseSecMarkup(astralExact.replace("</x>", "a</x>"), "xml"),
    "extracted-text-bytes",
  );
});

test("filing with incomplete inline focus conditionally requires eligible XBRL focus", () => {
  const incompleteInline = '<ix:nonNumeric name="dei:DocumentFiscalYearFocus">2026</ix:nonNumeric>';
  const completeXbrl =
    "<dei:DocumentFiscalYearFocus>2026</dei:DocumentFiscalYearFocus>" +
    "<dei:DocumentFiscalPeriodFocus>Q1</dei:DocumentFiscalPeriodFocus>";

  const absent = normalizeSecBundle(customFiling(incompleteInline, null));
  assert.equal(absent.status, "quarantined");
  assert.equal(absent.reasonCode, "sec.required-member-missing");
  assert.equal(absent.transcript.outputHash, null);

  const incomplete = normalizeSecBundle(
    customFiling(
      incompleteInline,
      "<dei:DocumentFiscalPeriodFocus>Q1</dei:DocumentFiscalPeriodFocus>",
    ),
  );
  assert.equal(incomplete.status, "quarantined");
  assert.equal(incomplete.reasonCode, "sec.required-member-missing");
  assert.equal(incomplete.transcript.outputHash, null);

  const supplied = normalizeSecBundle(customFiling(incompleteInline, completeXbrl));
  assert.equal(supplied.status, "emitted");
  assert.equal(supplied.draft.payload["fiscalPeriod"], "2026-Q1");
});

test("fixture A-F normalization outcomes follow pure-normalizer boundaries", () => {
  const structurallyValid = SEC_FIXTURE_CASES.filter(
    (candidate) => candidate.expected.bundleValidity === "valid",
  );
  assert.equal(structurallyValid.length, 59);
  for (const fixtureCase of structurallyValid) {
    const declaredPrimaryMembers = fixtureCase.members.filter(
      (member) => member.artifactHash === fixtureCase.expectedPrimaryArtifactHash,
    );
    assert.equal(declaredPrimaryMembers.length, 1, fixtureCase.caseId);
    const bundle = verifiedFixtureBundle(fixtureCase);
    assert.equal(bundle.primaryArtifactHash, fixtureCase.expectedPrimaryArtifactHash);
    assert.equal(bundle.evidenceBundleHash, fixtureCase.expected.evidenceBundleHash);
  }
  assert.equal(
    SEC_FIXTURE_CASES.filter((candidate) => candidate.expected.timestampConfidence === "exact")
      .length,
    35,
  );

  const loaderFailures = SEC_FIXTURE_CASES.filter(
    (candidate) => candidate.expected.loaderStatus === "quarantined",
  );
  assert.deepEqual(
    loaderFailures.map((candidate) => candidate.area),
    ["D", "D", "D", "D", "D"],
  );
  const stateful = fixture("record-revision-conflicting-primary");
  assert.equal(stateful.expected.status, "quarantined");
  assert.equal(stateful.expected.reasonCode, "sec.identity-mismatch");

  for (const fixtureCase of SEC_FIXTURE_CASES.filter(
    (candidate) =>
      candidate.expected.loaderStatus === "verified" &&
      candidate.caseId !== "record-revision-conflicting-primary",
  )) {
    const result = normalizeSecBundle(verifiedFixtureBundle(fixtureCase));
    assert.equal(result.status, fixtureCase.expected.status, fixtureCase.caseId);
    if (result.status !== "emitted") {
      assert.equal(result.reasonCode, fixtureCase.expected.reasonCode, fixtureCase.caseId);
      assert.equal(result.transcript.outputHash, null, fixtureCase.caseId);
      assert.equal(result.transcript.limitKind, fixtureCase.expected.limitKind, fixtureCase.caseId);
      continue;
    }
    assert.equal(
      result.draft.payload["issuerCik"],
      fixtureCase.expected.issuerCik,
      fixtureCase.caseId,
    );
    assert.equal(
      result.draft.payload["fiscalPeriod"],
      fixtureCase.expected.fiscalPeriod,
      fixtureCase.caseId,
    );
    assert.equal(
      result.draft.payload["publishedAtMs"],
      fixtureCase.expected.publishedAtMs,
      fixtureCase.caseId,
    );
    assert.equal(
      result.draft.payload["timestampConfidence"],
      fixtureCase.expected.timestampConfidence,
      fixtureCase.caseId,
    );
    assert.equal(
      result.draft.payload["originalTimestamp"],
      fixtureCase.expected.originalTimestamp,
      fixtureCase.caseId,
    );
    assert.notEqual(result.transcript.outputHash, null, fixtureCase.caseId);
    assert.equal(result.transcript.reasonCode, null, fixtureCase.caseId);
  }
});

test("baseline draft and transcript hashes are independently pinned", () => {
  const result = normalizeSecBundle(verifiedFixtureBundle(fixture("valid-item-202")));
  assert.equal(result.status, "emitted");
  assert.equal(result.transcript.outputHash, PINNED_OUTPUT_HASH);
  assert.equal(
    canonicalHash(SEC_NORMALIZED_DRAFT_HASH_DOMAIN, result.draft as unknown as JsonValue),
    PINNED_OUTPUT_HASH,
  );
  assert.equal(computeSecNormalizationTranscriptHash(result.transcript), PINNED_TRANSCRIPT_HASH);
  assert.equal(
    canonicalHash("peas/test/sec-draft-pin/v1", result.draft as unknown as JsonValue),
    PINNED_INDEPENDENT_DRAFT_HASH,
  );
});

test("member permutations, repeated calls, and caller mutation preserve canonical detached output", () => {
  const input = verifiedFixtureBundle(fixture("valid-two-exhibits"));
  const baseline = normalizeSecBundle(input);
  const permutations = [
    [...input.members],
    [...input.members].reverse(),
    [...input.members.slice(1), input.members[0] as VerifiedSecMember],
  ];
  for (const members of permutations) {
    assert.equal(
      canonicalJson(normalizeSecBundle({ ...input, members }) as unknown as JsonValue),
      canonicalJson(baseline as unknown as JsonValue),
    );
  }
  assert.deepEqual(normalizeSecBundle(input), baseline);
  const mutable = input.members[0]?.bytes;
  assert.ok(mutable);
  const before = canonicalJson(baseline as unknown as JsonValue);
  mutable[0] = (mutable[0] ?? 0) ^ 0xff;
  assert.equal(canonicalJson(baseline as unknown as JsonValue), before);
  assert.equal(Object.isFrozen(baseline), true);
  assert.equal(Object.isFrozen(baseline.transcript), true);
});

test("member, bundle-byte, member-count, and transcript exact/one-over boundaries are enforced", () => {
  const memberExact = customSec8k(sizedCommentMarkup(SEC_MAX_MEMBER_BYTES));
  assert.equal(normalizeSecBundle(memberExact).status, "emitted");
  const oversizedBytes = sizedCommentMarkup(SEC_MAX_MEMBER_BYTES + 1);
  const oversizedMember = member("sec.exhibit-99.1", "exhibit-01", oversizedBytes);
  const memberOver = {
    ...memberExact,
    members: memberExact.members.map((entry) =>
      entry.role === "sec.exhibit-99.1" ? oversizedMember : entry,
    ),
  };
  const memberOverResult = normalizeSecBundle(memberOver);
  assert.equal(memberOverResult.status, "quarantined");
  assert.equal(memberOverResult.reasonCode, "sec.member-limit-exceeded");

  const submissionsValue = {
    accession: "0000123456-26-000100",
    cik: "123456",
    form: "10-K",
    items: [],
    acceptanceDateTime: "2026-02-20T16:10:00-05:00",
  } as const;
  const indexValue = {
    accession: "0000123456-26-000100",
    form: "10-K",
    items: [],
    subjectCik: "0000123456",
    exhibits: [],
  } as const;
  const primaryPrefix =
    "<html><DOCUMENT-TYPE>10-K</DOCUMENT-TYPE><SUBJECT-CIK>0000123456</SUBJECT-CIK>" +
    "<ACCEPTANCE-DATETIME>20260220161000</ACCEPTANCE-DATETIME>" +
    '<ix:nonNumeric name="dei:DocumentFiscalYearFocus">2025</ix:nonNumeric>' +
    '<ix:nonNumeric name="dei:DocumentFiscalPeriodFocus">FY</ix:nonNumeric>';
  const xbrlPrefix =
    '<?xml version="1.0" encoding="UTF-8"?><xbrl>' +
    "<dei:EntityCentralIndexKey>0000123456</dei:EntityCentralIndexKey>" +
    "<dei:DocumentFiscalYearFocus>2025</dei:DocumentFiscalYearFocus>" +
    "<dei:DocumentFiscalPeriodFocus>FY</dei:DocumentFiscalPeriodFocus>";
  const markupAtSize = (prefix: string, suffix: string, size: number) => {
    const overhead = Buffer.byteLength(`${prefix}<!---->${suffix}`);
    return Buffer.from(`${prefix}<!--${"x".repeat(size - overhead)}-->${suffix}`, "utf8");
  };
  const exactMembers = [
    member("sec.submissions", "submissions", padJson(submissionsValue, 10 * 1024 * 1024)),
    member("sec.filing-index", "filing-index", padJson(indexValue, 10 * 1024 * 1024)),
    member(
      "sec.primary-document",
      "primary-document",
      markupAtSize(primaryPrefix, "</html>", 10 * 1024 * 1024),
    ),
    member(
      "sec.xbrl-instance",
      "xbrl-instance",
      markupAtSize(xbrlPrefix, "</xbrl>", 2 * 1024 * 1024),
    ),
  ];
  assert.equal(
    exactMembers.reduce((total, entry) => total + entry.sizeBytes, 0),
    SEC_MAX_BUNDLE_BYTES,
  );
  const exactBundle = assembleBundle(
    "filing",
    "0000123456-26-000100",
    "123456",
    "2025-FY",
    exactMembers,
    exactMembers[2]?.artifactHash ?? "",
  );
  assert.equal(normalizeSecBundle(exactBundle).status, "emitted");
  const overXbrlBytes = markupAtSize(xbrlPrefix, "</xbrl>", 2 * 1024 * 1024 + 1);
  const totalOver = {
    ...exactBundle,
    members: exactBundle.members.map((entry) =>
      entry.role === "sec.xbrl-instance"
        ? member("sec.xbrl-instance", "xbrl-instance", overXbrlBytes)
        : entry,
    ),
  };
  const totalOverResult = normalizeSecBundle(totalOver);
  assert.equal(totalOverResult.status, "quarantined");
  assert.equal(totalOverResult.reasonCode, "sec.bundle-byte-limit-exceeded");

  const countExact = customSec8k(Buffer.from("<p>x</p>"), 12);
  assert.equal(countExact.members.length, 16);
  assert.equal(normalizeSecBundle(countExact).status, "emitted");
  const extra = member("sec.exhibit-99.1", "exhibit-13", Buffer.from("<p>extra</p>"));
  const countOverResult = normalizeSecBundle({
    ...countExact,
    members: [...countExact.members, extra],
  });
  assert.equal(countOverResult.status, "quarantined");
  assert.equal(countOverResult.reasonCode, "sec.member-limit-exceeded");

  assert.doesNotThrow(() =>
    assertSecTranscriptSerializedWithinLimit("x".repeat(SEC_MAX_TRANSCRIPT_BYTES)),
  );
  assert.throws(
    () => assertSecTranscriptSerializedWithinLimit("x".repeat(SEC_MAX_TRANSCRIPT_BYTES + 1)),
    RangeError,
  );
});

test("declared G vectors align with independently exercised ceilings", () => {
  const expected = new Map(
    SEC_GENERATED_BOUNDARY_VECTORS.map((vector) => [
      vector.vectorId,
      [vector.value, vector.expected.reasonCode, vector.expected.limitKind],
    ]),
  );
  assert.deepEqual(expected.get("semantic-tokens-exact"), [250_000, null, null]);
  assert.deepEqual(expected.get("semantic-tokens-one-over"), [
    250_001,
    "sec.parse-limit-exceeded",
    "markup-tokens",
  ]);
  assert.deepEqual(expected.get("markup-depth-one-over"), [
    257,
    "sec.parse-limit-exceeded",
    "markup-depth",
  ]);
  assert.deepEqual(expected.get("attributes-per-tag-one-over"), [
    257,
    "sec.parse-limit-exceeded",
    "attributes-per-tag",
  ]);
  assert.deepEqual(expected.get("extracted-text-bytes-one-over"), [
    4_194_305,
    "sec.parse-limit-exceeded",
    "extracted-text-bytes",
  ]);
  assert.equal(expected.size, 16);
});

test("hostile containers, accessors, Proxy, cycles, shared bytes, and malformed bytes fail closed", () => {
  const valid = verifiedFixtureBundle(fixture("valid-item-202"));
  let executions = 0;
  const rootProxy = new Proxy(valid, {
    ownKeys() {
      executions += 1;
      return [];
    },
  });
  const proxyResult = normalizeSecBundle(rootProxy);
  assert.equal(proxyResult.status, "quarantined");
  assert.equal(proxyResult.reasonCode, "sec.bundle-invalid");

  const accessor = { ...valid } as Record<string, unknown>;
  Object.defineProperty(accessor, "provider", {
    enumerable: true,
    get() {
      executions += 1;
      return "sec-edgar";
    },
  });
  assert.equal(normalizeSecBundle(accessor).status, "quarantined");

  const cyclic = { ...valid, members: [...valid.members] } as Record<string, unknown>;
  cyclic["members"] = [cyclic];
  assert.equal(normalizeSecBundle(cyclic).status, "quarantined");

  const proxiedBytes = new Proxy(valid.members[0]?.bytes ?? new Uint8Array(), {});
  const bytesAttack = {
    ...valid,
    members: valid.members.map((entry, index) =>
      index === 0 ? { ...entry, bytes: proxiedBytes } : entry,
    ),
  };
  assert.equal(normalizeSecBundle(bytesAttack).status, "quarantined");

  if (typeof SharedArrayBuffer !== "undefined") {
    const shared = new Uint8Array(new SharedArrayBuffer(valid.members[0]?.sizeBytes ?? 0));
    const sharedAttack = {
      ...valid,
      members: valid.members.map((entry, index) =>
        index === 0 ? { ...entry, bytes: shared } : entry,
      ),
    };
    assert.equal(normalizeSecBundle(sharedAttack).status, "quarantined");
  }
  assert.equal(executions, 0);

  const malformed = verifiedFixtureBundle(fixture("valid-item-202"));
  const badBytes = Uint8Array.of(0xff);
  const malformedMember = member("sec.submissions", "submissions", badBytes);
  const malformedInput = {
    ...malformed,
    members: malformed.members.map((entry) =>
      entry.role === "sec.submissions" ? malformedMember : entry,
    ),
  };
  const malformedResult = normalizeSecBundle(malformedInput);
  assert.equal(malformedResult.status, "quarantined");
  assert.ok(
    malformedResult.reasonCode === "sec.bundle-hash-mismatch" ||
      malformedResult.reasonCode === "sec.unsupported-encoding",
  );
});

test("indexed Array prototype pollution fails before inherited code can execute", () => {
  const valid = verifiedFixtureBundle(fixture("valid-item-202"));
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let executions = 0;
  let thrown: unknown;
  Object.defineProperty(Array.prototype, "0", {
    configurable: true,
    set() {
      executions += 1;
    },
  });
  try {
    normalizeSecBundle(valid);
  } catch (error) {
    thrown = error;
  } finally {
    if (previous === undefined) delete (Array.prototype as unknown as Record<string, unknown>)["0"];
    else Object.defineProperty(Array.prototype, "0", previous);
  }
  assert.equal(executions, 0);
  assert.match(String(thrown), /Array\.prototype contains indexed schema property 0/u);
});

test("normalization has no clock, randomness, locale, or environment dependency", async () => {
  const input = verifiedFixtureBundle(fixture("valid-item-202"));
  const baseline = canonicalJson(normalizeSecBundle(input) as unknown as JsonValue);
  const originalNow = Date.now;
  const originalRandom = Math.random;
  Date.now = () => {
    throw new Error("clock access is forbidden");
  };
  Math.random = () => {
    throw new Error("random access is forbidden");
  };
  try {
    assert.equal(canonicalJson(normalizeSecBundle(input) as unknown as JsonValue), baseline);
    assert.deepEqual(normalizeSecBundle(input, SEC_NORMALIZER_POLICY), normalizeSecBundle(input));
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
  }
  const source = await new Promise<string>((resolve, reject) => {
    readFile(path.resolve("src/providers/sec/normalizer.ts"), "utf8", (error, data) =>
      error === null ? resolve(data) : reject(error),
    );
  });
  assert.doesNotMatch(
    source,
    /\b(?:Intl|process\.env|fetch|ArtifactStore|setTimeout|setInterval)\b/u,
  );
});

test("all non-emitted outcomes have null outputHash and no partial draft", () => {
  const cases = [
    "non-earnings-8k",
    "absent-fiscal-focus",
    "timestamp-conflict",
    "decoder-unsupported",
  ];
  for (const caseId of cases) {
    const result: SecNormalizationResult = normalizeSecBundle(
      verifiedFixtureBundle(fixture(caseId)),
    );
    assert.notEqual(result.status, "emitted", caseId);
    assert.equal(result.transcript.outputHash, null, caseId);
    assert.equal("draft" in result, false, caseId);
  }
});
