import { createHash } from "node:crypto";

import { canonicalJson, type JsonValue } from "./json.js";

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? Buffer.from(value, "utf8") : value;
}

function lengthPrefix(length: number): Buffer {
  const prefix = Buffer.allocUnsafe(8);
  prefix.writeBigUInt64BE(BigInt(length));
  return prefix;
}

/** Hashes unambiguous length-prefixed parts under an explicit domain tag. */
export function hashParts(domain: string, ...parts: readonly (string | Uint8Array)[]): string {
  const hash = createHash("sha256");
  for (const part of [domain, ...parts]) {
    const encoded = bytes(part);
    hash.update(lengthPrefix(encoded.byteLength));
    hash.update(encoded);
  }
  return hash.digest("hex");
}

export function canonicalHash(domain: string, value: JsonValue): string {
  return hashParts(domain, canonicalJson(value));
}
