import { SEC_DECODER_SNIFF_BYTES } from "../contracts.js";
import { secParserFailure } from "./errors.js";

export const SEC_DECODER_POLICY = "sec-decoder-v1";

export type SecContentKind = "html" | "json" | "xml";
export type SecCanonicalEncoding = "utf-8" | "windows-1252";
export type SecDecodedMember = Readonly<{
  text: string;
  encoding: SecCanonicalEncoding;
  declaredLabel: string | null;
  hadUtf8Bom: boolean;
}>;

const UTF8_LABELS = new Set(["utf-8", "utf8", "unicode-1-1-utf-8"]);
const WINDOWS_1252_LABELS = new Set([
  "windows-1252",
  "cp1252",
  "x-cp1252",
  "iso-8859-1",
  "iso8859-1",
  "latin1",
  "us-ascii",
]);
const ASCII_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu;
const META_TAG = /<meta(?:[\t\n\f\r ][^<>]*)?>/giu;
const ATTRIBUTE =
  /([^\t\n\f\r />=]+)[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r "'=<>`]+))/gu;
const CONTENT_CHARSET = /(?:^|;)[\t\n\f\r ]*charset[\t\n\f\r ]*=[\t\n\f\r ]*([^;\t\n\f\r ]+)/giu;
const XML_DECLARATION = /^(?:<\?xml[\t\n\f\r ][^?]*\?>)/iu;

function asciiLower(value: string): string {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    normalized += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : value[index];
  }
  return normalized;
}

export function normalizeSecEncodingLabel(value: string): string {
  return asciiLower(value.replace(ASCII_WHITESPACE, ""));
}

function canonicalEncoding(label: string): SecCanonicalEncoding | null {
  if (UTF8_LABELS.has(label)) return "utf-8";
  if (WINDOWS_1252_LABELS.has(label)) return "windows-1252";
  return null;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function asciiSniff(bytes: Uint8Array, offset = 0): string {
  const end = Math.min(bytes.byteLength, SEC_DECODER_SNIFF_BYTES);
  let result = "";
  for (let index = offset; index < end; index += 1) {
    const byte = bytes[index];
    result += String.fromCharCode(byte === undefined ? 0 : byte);
  }
  return result;
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const rawName = match[1];
    if (rawName === undefined) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    const name = asciiLower(rawName);
    if (!result.has(name)) result.set(name, value);
  }
  return result;
}

function htmlDeclarations(bytes: Uint8Array): string[] {
  const sniff = asciiSniff(bytes);
  const declarations: string[] = [];
  for (const match of sniff.matchAll(META_TAG)) {
    const tag = match[0];
    const values = attributes(tag);
    const direct = values.get("charset");
    if (direct !== undefined) declarations.push(normalizeSecEncodingLabel(direct));
    if (asciiLower(values.get("http-equiv") ?? "") !== "content-type") continue;
    const content = values.get("content");
    if (content === undefined) continue;
    for (const charset of content.matchAll(CONTENT_CHARSET)) {
      const label = charset[1];
      if (label !== undefined) declarations.push(normalizeSecEncodingLabel(label));
    }
  }
  return declarations;
}

function xmlDeclaration(bytes: Uint8Array, bom: boolean): string | null {
  const sniff = asciiSniff(bytes, bom ? 3 : 0);
  const declaration = XML_DECLARATION.exec(sniff)?.[0];
  if (declaration === undefined) return null;
  const encoding = attributes(declaration).get("encoding");
  return encoding === undefined ? null : normalizeSecEncodingLabel(encoding);
}

function decode(bytes: Uint8Array, encoding: SecCanonicalEncoding): string {
  try {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return secParserFailure(
      "sec.unsupported-encoding",
      "SEC member bytes are invalid under the selected decoder",
    );
  }
}

export function probeSecDecoderCapabilities(): true {
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    if (utf8.decode(Uint8Array.of(0x63, 0x61, 0x66, 0xc3, 0xa9)) !== "caf\u00e9") {
      throw new Error("fatal UTF-8 decode mismatch");
    }
    let rejected = false;
    try {
      utf8.decode(Uint8Array.of(0x80));
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("fatal UTF-8 did not reject malformed bytes");
    if (new TextDecoder("windows-1252", { fatal: true }).decode(Uint8Array.of(0x93)) !== "\u201c") {
      throw new Error("Windows-1252 decode mismatch");
    }
    return true;
  } catch {
    return secParserFailure(
      "sec.unsupported-encoding",
      "The runtime does not satisfy sec-decoder-v1 capabilities",
    );
  }
}

function resolveDeclaredEncoding(labels: readonly string[]): {
  label: string | null;
  encoding: SecCanonicalEncoding | null;
} {
  if (labels.length === 0) return { label: null, encoding: null };
  let selected: SecCanonicalEncoding | null = null;
  let selectedLabel: string | null = null;
  for (const label of labels) {
    const canonical = canonicalEncoding(label);
    if (canonical === null) {
      return secParserFailure(
        "sec.unsupported-encoding",
        "SEC encoding declaration is unsupported",
      );
    }
    if (selected !== null && selected !== canonical) {
      return secParserFailure("sec.unsupported-encoding", "SEC encoding declarations conflict");
    }
    selected = canonical;
    selectedLabel ??= label;
  }
  return { label: selectedLabel, encoding: selected };
}

export function decodeSecMember(bytes: Uint8Array, kind: SecContentKind): SecDecodedMember {
  probeSecDecoderCapabilities();
  const bom = hasUtf8Bom(bytes);

  if (kind === "json") {
    return Object.freeze({
      text: decode(bytes, "utf-8"),
      encoding: "utf-8" as const,
      declaredLabel: null,
      hadUtf8Bom: bom,
    });
  }

  const labels =
    kind === "xml"
      ? [xmlDeclaration(bytes, bom)].filter((v): v is string => v !== null)
      : htmlDeclarations(bytes);
  const declared = resolveDeclaredEncoding(labels);
  if (kind === "xml" && declared.encoding === "windows-1252") {
    return secParserFailure("sec.unsupported-encoding", "SEC XML must declare UTF-8");
  }
  if (bom && declared.encoding !== null && declared.encoding !== "utf-8") {
    return secParserFailure("sec.unsupported-encoding", "SEC UTF-8 BOM conflicts with declaration");
  }

  if (bom) {
    return Object.freeze({
      text: decode(bytes, "utf-8"),
      encoding: "utf-8" as const,
      declaredLabel: declared.label,
      hadUtf8Bom: true,
    });
  }
  if (declared.encoding !== null) {
    return Object.freeze({
      text: decode(bytes, declared.encoding),
      encoding: declared.encoding,
      declaredLabel: declared.label,
      hadUtf8Bom: false,
    });
  }
  if (kind === "xml") {
    return Object.freeze({
      text: decode(bytes, "utf-8"),
      encoding: "utf-8" as const,
      declaredLabel: null,
      hadUtf8Bom: false,
    });
  }
  try {
    return Object.freeze({
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf-8" as const,
      declaredLabel: null,
      hadUtf8Bom: false,
    });
  } catch {
    return Object.freeze({
      text: decode(bytes, "windows-1252"),
      encoding: "windows-1252" as const,
      declaredLabel: null,
      hadUtf8Bom: false,
    });
  }
}
