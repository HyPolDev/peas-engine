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
const ATTRIBUTE =
  /([^\t\n\f\r />=]+)[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r "'=<>`]+))/gu;
const CONTENT_CHARSET = /(?:^|;)[\t\n\f\r ]*charset[\t\n\f\r ]*=[\t\n\f\r ]*([^;\t\n\f\r ]+)/giu;
const XML_DECLARATION = /^(?:<\?xml[\t\n\f\r ][^?]*\?>)/iu;
const HTML_TEXT_CONTAINERS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

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

function isTagNameCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2d ||
    code === 0x3a ||
    code === 0x5f
  );
}

function isTagBoundary(value: string | undefined): boolean {
  return value === undefined || value === ">" || value === "/" || /[\t\n\f\r ]/u.test(value);
}

function findTagEnd(value: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function tagNameAt(value: string, start: number): { name: string; end: number } | null {
  let end = start;
  while (end < value.length && isTagNameCode(value.charCodeAt(end))) end += 1;
  if (end === start) return null;
  return { name: asciiLower(value.slice(start, end)), end };
}

function afterRawTextContainer(value: string, start: number, name: string): number {
  const lower = asciiLower(value);
  const close = `</${name}`;
  let candidate = lower.indexOf(close, start);
  while (candidate >= 0) {
    const nameEnd = candidate + close.length;
    if (isTagBoundary(value[nameEnd])) {
      const tagEnd = findTagEnd(value, nameEnd);
      return tagEnd < 0 ? value.length : tagEnd + 1;
    }
    candidate = lower.indexOf(close, candidate + 1);
  }
  return value.length;
}

function appendMetaDeclarations(tag: string, declarations: string[]): void {
  const values = attributes(tag);
  const direct = values.get("charset");
  if (direct !== undefined) declarations.push(normalizeSecEncodingLabel(direct));
  if (asciiLower(values.get("http-equiv") ?? "") !== "content-type") return;
  const content = values.get("content");
  if (content === undefined) return;
  for (const charset of content.matchAll(CONTENT_CHARSET)) {
    const label = charset[1];
    if (label !== undefined) declarations.push(normalizeSecEncodingLabel(label));
  }
}

function htmlDeclarations(bytes: Uint8Array): string[] {
  const sniff = asciiSniff(bytes);
  const declarations: string[] = [];
  let cursor = 0;
  while (cursor < sniff.length) {
    const open = sniff.indexOf("<", cursor);
    if (open < 0) break;
    if (sniff.startsWith("<!--", open)) {
      const end = sniff.indexOf("-->", open + 4);
      if (end < 0) break;
      cursor = end + 3;
      continue;
    }
    const marker = sniff[open + 1];
    if (marker === "!" || marker === "?" || marker === "%") {
      const end = findTagEnd(sniff, open + 2);
      if (end < 0) break;
      cursor = end + 1;
      continue;
    }
    const closing = marker === "/";
    const nameStart = open + (closing ? 2 : 1);
    const tagName = tagNameAt(sniff, nameStart);
    if (tagName === null || !isTagBoundary(sniff[tagName.end])) {
      cursor = open + 1;
      continue;
    }
    const end = findTagEnd(sniff, tagName.end);
    if (end < 0) break;
    if (!closing && tagName.name === "meta") {
      appendMetaDeclarations(sniff.slice(open, end + 1), declarations);
    }
    cursor = end + 1;
    if (!closing && tagName.name === "plaintext") break;
    if (!closing && HTML_TEXT_CONTAINERS.has(tagName.name)) {
      cursor = afterRawTextContainer(sniff, cursor, tagName.name);
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
