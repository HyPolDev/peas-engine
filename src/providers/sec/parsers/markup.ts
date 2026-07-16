import { Buffer } from "node:buffer";
import { Parser } from "htmlparser2";

import { deepFreezeJson, inertJsonSnapshot, type JsonValue } from "../../../core/json.js";
import {
  SEC_MAX_ATTRIBUTES_PER_TAG,
  SEC_MAX_EXTRACTED_TEXT_BYTES,
  SEC_MAX_MARKUP_DEPTH,
  SEC_MAX_MARKUP_TOKENS,
} from "../contracts.js";
import { SecParserError, secParserFailure } from "./errors.js";

export const SEC_MARKUP_PARSER = "htmlparser2@12.0.0-callbacks-v1";
export const SEC_MARKUP_CHUNK_BYTES = 32 * 1024;

export type SecMarkupMode = "html" | "xml";
export type SecMarkupExtraction = Readonly<{
  subjectCiks: readonly string[];
  documentTypes: readonly string[];
  acceptanceDateTimes: readonly string[];
  fiscalYears: readonly string[];
  fiscalPeriods: readonly string[];
  semanticTokens: number;
  maxDepth: number;
  extractedTextBytes: number;
}>;

type Target = "acceptance" | "cik" | "document-type" | "fiscal-period" | "fiscal-year";
type Frame = {
  readonly tag: string;
  nameAttribute: string | null;
  chunks: string[];
};

function asciiLower(value: string): string {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    normalized += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : value[index];
  }
  return normalized;
}

function localName(value: string): string {
  const normalized = asciiLower(value);
  const colon = normalized.lastIndexOf(":");
  return colon < 0 ? normalized : normalized.slice(colon + 1);
}

function trimAscii(value: string): string {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, "");
}

function frameTarget(frame: Frame): Target | null {
  const tag = localName(frame.tag);
  if (tag === "entitycentralindexkey" || tag === "subject-cik") return "cik";
  if (tag === "document-type") return "document-type";
  if (tag === "acceptance-datetime") return "acceptance";
  if (tag === "documentfiscalyearfocus") return "fiscal-year";
  if (tag === "documentfiscalperiodfocus") return "fiscal-period";
  if (tag !== "nonnumeric" || frame.nameAttribute === null) return null;
  const fact = localName(frame.nameAttribute);
  if (fact === "documentfiscalyearfocus") return "fiscal-year";
  if (fact === "documentfiscalperiodfocus") return "fiscal-period";
  if (fact === "entitycentralindexkey") return "cik";
  return null;
}

function frozen(value: SecMarkupExtraction): SecMarkupExtraction {
  return deepFreezeJson(inertJsonSnapshot(value as unknown as JsonValue)) as SecMarkupExtraction;
}

function utf8BytesForScalar(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function assertUnicodeScalars(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        secParserFailure("sec.malformed-markup", "SEC markup contains an unpaired surrogate");
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      secParserFailure("sec.malformed-markup", "SEC markup contains an unpaired surrogate");
    }
  }
}

export function parseSecMarkup(
  decoded: string,
  mode: SecMarkupMode,
  chunkSize = SEC_MARKUP_CHUNK_BYTES,
): SecMarkupExtraction {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > SEC_MARKUP_CHUNK_BYTES) {
    return secParserFailure("sec.malformed-markup", "SEC markup chunk size is invalid");
  }

  const frames: Frame[] = [];
  const subjectCiks: string[] = [];
  const documentTypes: string[] = [];
  const acceptanceDateTimes: string[] = [];
  const fiscalYears: string[] = [];
  const fiscalPeriods: string[] = [];
  let semanticTokens = 0;
  let maximumDepth = 0;
  let extractedTextBytes = 0;
  let attributesOnTag = 0;
  let pendingTextToken = false;
  let pendingHighSurrogate: number | null = null;
  let inCdata = false;
  let malformedXml = false;
  let ended = false;
  let parser: Parser;

  const token = (): void => {
    semanticTokens += 1;
    if (semanticTokens > SEC_MAX_MARKUP_TOKENS) {
      secParserFailure(
        "sec.parse-limit-exceeded",
        "SEC markup exceeds the semantic-token ceiling",
        "markup-tokens",
      );
    }
  };
  const finishTextScalar = (): void => {
    if (pendingHighSurrogate !== null) {
      secParserFailure("sec.malformed-markup", "SEC markup contains an unpaired surrogate");
    }
  };
  const boundary = (): void => {
    finishTextScalar();
    if (pendingTextToken) token();
    pendingTextToken = false;
  };
  const countExtractedText = (data: string): void => {
    let index = 0;
    if (pendingHighSurrogate !== null) {
      const low = data.charCodeAt(0);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        secParserFailure("sec.malformed-markup", "SEC markup contains an unpaired surrogate");
      }
      const codePoint = 0x10000 + ((pendingHighSurrogate - 0xd800) << 10) + (low - 0xdc00);
      extractedTextBytes += utf8BytesForScalar(codePoint);
      pendingHighSurrogate = null;
      index = 1;
      if (extractedTextBytes > SEC_MAX_EXTRACTED_TEXT_BYTES) {
        secParserFailure(
          "sec.parse-limit-exceeded",
          "SEC markup exceeds the extracted-text ceiling",
          "extracted-text-bytes",
        );
      }
    }
    for (; index < data.length; index += 1) {
      const code = data.charCodeAt(index);
      let bytes: number;
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = data.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          bytes = 4;
          index += 1;
        } else if (index + 1 === data.length) {
          pendingHighSurrogate = code;
          break;
        } else {
          secParserFailure("sec.malformed-markup", "SEC markup contains an unpaired surrogate");
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        secParserFailure("sec.malformed-markup", "SEC markup contains an unpaired surrogate");
      } else {
        bytes = utf8BytesForScalar(code);
      }
      extractedTextBytes += bytes;
      if (extractedTextBytes > SEC_MAX_EXTRACTED_TEXT_BYTES) {
        secParserFailure(
          "sec.parse-limit-exceeded",
          "SEC markup exceeds the extracted-text ceiling",
          "extracted-text-bytes",
        );
      }
    }
  };
  const retain = (target: Target, value: string): void => {
    const normalized = trimAscii(value);
    if (normalized === "") return;
    switch (target) {
      case "cik":
        subjectCiks.push(normalized);
        break;
      case "document-type":
        documentTypes.push(normalized);
        break;
      case "acceptance":
        acceptanceDateTimes.push(normalized);
        break;
      case "fiscal-year":
        fiscalYears.push(normalized);
        break;
      case "fiscal-period":
        fiscalPeriods.push(normalized);
        break;
    }
  };

  try {
    parser = new Parser(
      {
        onopentagname(name) {
          boundary();
          token();
          attributesOnTag = 0;
          frames.push({ tag: name, nameAttribute: null, chunks: [] });
          maximumDepth = Math.max(maximumDepth, frames.length);
          if (frames.length > SEC_MAX_MARKUP_DEPTH) {
            secParserFailure(
              "sec.parse-limit-exceeded",
              "SEC markup exceeds the depth ceiling",
              "markup-depth",
            );
          }
        },
        onattribute(name, value) {
          boundary();
          token();
          attributesOnTag += 1;
          if (attributesOnTag > SEC_MAX_ATTRIBUTES_PER_TAG) {
            secParserFailure(
              "sec.parse-limit-exceeded",
              "SEC markup exceeds the per-tag attribute ceiling",
              "attributes-per-tag",
            );
          }
          const frame = frames.at(-1);
          if (frame !== undefined && localName(name) === "name") {
            if (Buffer.byteLength(value, "utf8") > 256) {
              secParserFailure("sec.malformed-markup", "SEC retained attribute is oversized");
            }
            frame.nameAttribute = value;
          }
        },
        onclosetag(name, isImplied) {
          boundary();
          token();
          const frame = frames.pop();
          if (frame === undefined || localName(frame.tag) !== localName(name)) {
            if (mode === "xml") malformedXml = true;
            return;
          }
          if (mode === "xml" && isImplied) {
            const end = parser.endIndex;
            const selfClosing = end > 0 && decoded[end - 1] === "/" && decoded[end] === ">";
            if (!selfClosing) malformedXml = true;
          }
          const target = frameTarget(frame);
          if (target !== null) retain(target, frame.chunks.join(""));
        },
        ontext(data) {
          if (data === "") return;
          countExtractedText(data);
          if (!inCdata) pendingTextToken = true;
          const frame = frames.at(-1);
          if (frame !== undefined && frameTarget(frame) !== null) frame.chunks.push(data);
        },
        oncomment() {
          boundary();
          token();
        },
        onprocessinginstruction() {
          boundary();
          token();
        },
        oncdatastart() {
          boundary();
          token();
          inCdata = true;
        },
        oncdataend() {
          finishTextScalar();
          inCdata = false;
          pendingTextToken = false;
        },
        onerror() {
          secParserFailure("sec.malformed-markup", "SEC markup tokenizer failed");
        },
        onend() {
          boundary();
          ended = true;
        },
      },
      {
        xmlMode: mode === "xml",
        decodeEntities: true,
        lowerCaseTags: mode === "html",
        lowerCaseAttributeNames: mode === "html",
        recognizeCDATA: true,
        recognizeSelfClosing: true,
      },
    );
    assertUnicodeScalars(decoded);
    const encoded = Buffer.from(decoded, "utf8");
    const streamDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    for (let offset = 0; offset < encoded.byteLength; offset += chunkSize) {
      const emitted = streamDecoder.decode(encoded.subarray(offset, offset + chunkSize), {
        stream: true,
      });
      if (emitted !== "") parser.write(emitted);
    }
    const tail = streamDecoder.decode();
    if (tail !== "") parser.write(tail);
    parser.end();
  } catch (error) {
    if (error instanceof SecParserError) throw error;
    return secParserFailure("sec.malformed-markup", "SEC markup tokenizer failed");
  }
  if (!ended || (mode === "xml" && (malformedXml || frames.length !== 0))) {
    return secParserFailure("sec.malformed-markup", "SEC XML structure is malformed");
  }
  return frozen({
    subjectCiks,
    documentTypes,
    acceptanceDateTimes,
    fiscalYears,
    fiscalPeriods,
    semanticTokens,
    maxDepth: maximumDepth,
    extractedTextBytes,
  });
}
