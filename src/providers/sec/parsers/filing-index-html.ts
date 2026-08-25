import { Parser } from "htmlparser2";

import {
  SEC_MAX_EXTRACTED_TEXT_BYTES,
  SEC_MAX_MARKUP_DEPTH,
  SEC_MAX_MARKUP_TOKENS,
} from "../contracts.js";
import { secParserFailure } from "./errors.js";

export type SecFilingIndexDocument = Readonly<{
  sequence: number;
  filename: string;
  type: string;
}>;

function fail(): never {
  return secParserFailure("sec.malformed-markup", "SEC filing index HTML is malformed");
}

function trim(value: string): string {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, "");
}

export function parseSecFilingIndexDocuments(
  serialized: string,
): readonly SecFilingIndexDocument[] {
  const documents: SecFilingIndexDocument[] = [];
  let tokens = 0;
  let depth = 0;
  let textBytes = 0;
  let row: string[] | null = null;
  let cell: string[] | null = null;
  let filename: string | null = null;

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        tokens += 1;
        depth += 1;
        if (tokens > SEC_MAX_MARKUP_TOKENS || depth > SEC_MAX_MARKUP_DEPTH) fail();
        if (name === "tr") row = [];
        if ((name === "td" || name === "th") && row !== null) cell = [];
        if (name === "a" && cell !== null && typeof attributes["href"] === "string") {
          const href = attributes["href"];
          const candidate = href.slice(href.lastIndexOf("/") + 1);
          if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(candidate)) filename = candidate;
        }
      },
      ontext(text) {
        tokens += 1;
        textBytes += Buffer.byteLength(text, "utf8");
        if (tokens > SEC_MAX_MARKUP_TOKENS || textBytes > SEC_MAX_EXTRACTED_TEXT_BYTES) fail();
        cell?.push(text);
      },
      onclosetag(name) {
        tokens += 1;
        if (tokens > SEC_MAX_MARKUP_TOKENS) fail();
        if ((name === "td" || name === "th") && row !== null && cell !== null) {
          row.push(trim(cell.join("")));
          cell = null;
        }
        if (name === "tr" && row !== null) {
          const sequence = Number.parseInt(row[0] ?? "", 10);
          const type = row[3];
          if (
            Number.isSafeInteger(sequence) &&
            sequence > 0 &&
            filename !== null &&
            type !== undefined &&
            type.length > 0 &&
            Buffer.byteLength(type, "utf8") <= 64
          ) {
            documents.push(Object.freeze({ sequence, filename, type }));
          }
          row = null;
          cell = null;
          filename = null;
        }
        depth -= 1;
        if (depth < 0) fail();
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  try {
    parser.end(serialized);
  } catch {
    return fail();
  }
  if (depth !== 0 || documents.length === 0 || documents.length > 256) return fail();
  const filenames = new Set(documents.map((document) => document.filename));
  if (filenames.size !== documents.length) return fail();
  return Object.freeze(documents);
}
