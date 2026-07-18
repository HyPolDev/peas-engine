import type { JsonValue } from "../../core/json.js";
import {
  FMP_MAX_DECODED_BYTES,
  FMP_MAX_JSON_DEPTH,
  FMP_MAX_JSON_TOKENS,
  type FmpLimitKind,
  type FmpReasonCode,
} from "./contracts.js";

export class FmpJsonError extends SyntaxError {
  constructor(
    readonly reasonCode: FmpReasonCode,
    readonly limitKind: FmpLimitKind | null = null,
  ) {
    super(reasonCode);
    this.name = "FmpJsonError";
  }
}

class Parser {
  private offset = 0;
  private tokens = 0;
  private decodedBytes = 0;

  constructor(private readonly source: string) {}

  parse(): JsonValue {
    this.space();
    const value = this.value(0);
    this.space();
    if (this.offset !== this.source.length) this.malformed();
    return value;
  }

  private malformed(): never {
    throw new FmpJsonError("fmp.malformed-json");
  }

  private token(): void {
    this.tokens += 1;
    if (this.tokens > FMP_MAX_JSON_TOKENS) {
      throw new FmpJsonError("fmp.parse-limit-exceeded", "json-tokens");
    }
  }

  private enter(depth: number): void {
    if (depth > FMP_MAX_JSON_DEPTH) {
      throw new FmpJsonError("fmp.parse-limit-exceeded", "json-depth");
    }
  }

  private space(): void {
    for (;;) {
      const code = this.source.charCodeAt(this.offset);
      if (code !== 0x09 && code !== 0x0a && code !== 0x0d && code !== 0x20) return;
      this.offset += 1;
    }
  }

  private value(depth: number): JsonValue {
    this.enter(depth);
    this.space();
    const character = this.source[this.offset];
    if (character === "[") return this.array(depth + 1);
    if (character === "{") return this.object(depth + 1);
    if (character === '"') return this.string();
    if (this.source.startsWith("null", this.offset)) return this.literal("null", null);
    if (this.source.startsWith("true", this.offset)) return this.literal("true", true);
    if (this.source.startsWith("false", this.offset)) return this.literal("false", false);
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;
    match.lastIndex = this.offset;
    const number = match.exec(this.source);
    if (number?.[0] === undefined) return this.malformed();
    this.offset = match.lastIndex;
    this.token();
    const parsed = Number(number[0]);
    if (!Number.isFinite(parsed)) return this.malformed();
    return parsed;
  }

  private literal<T extends JsonValue>(text: string, value: T): T {
    this.offset += text.length;
    this.token();
    return value;
  }

  private string(): string {
    const start = this.offset;
    this.offset += 1;
    let escaped = false;
    for (; this.offset < this.source.length; this.offset += 1) {
      const character = this.source[this.offset];
      if (character === undefined) return this.malformed();
      if (!escaped && character === '"') {
        this.offset += 1;
        let decoded: unknown;
        try {
          decoded = JSON.parse(this.source.slice(start, this.offset));
        } catch {
          return this.malformed();
        }
        if (typeof decoded !== "string") return this.malformed();
        this.token();
        this.decodedBytes += Buffer.byteLength(decoded, "utf8");
        if (this.decodedBytes > FMP_MAX_DECODED_BYTES) {
          throw new FmpJsonError("fmp.parse-limit-exceeded", "decoded-string-bytes");
        }
        return decoded;
      }
      if (!escaped && character.charCodeAt(0) < 0x20) return this.malformed();
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
    }
    return this.malformed();
  }

  private array(depth: number): JsonValue[] {
    this.offset += 1;
    this.token();
    const result: JsonValue[] = [];
    this.space();
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      this.token();
      return result;
    }
    for (;;) {
      result.push(this.value(depth));
      this.space();
      const character = this.source[this.offset];
      if (character === "]") {
        this.offset += 1;
        this.token();
        return result;
      }
      if (character !== ",") return this.malformed();
      this.offset += 1;
    }
  }

  private object(depth: number): Record<string, JsonValue> {
    this.offset += 1;
    this.token();
    const result = Object.create(null) as Record<string, JsonValue>;
    const keys = new Set<string>();
    this.space();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      this.token();
      return result;
    }
    for (;;) {
      this.space();
      if (this.source[this.offset] !== '"') return this.malformed();
      const key = this.string();
      if (keys.has(key)) return this.malformed();
      keys.add(key);
      this.space();
      if (this.source[this.offset] !== ":") return this.malformed();
      this.offset += 1;
      result[key] = this.value(depth);
      this.space();
      const character = this.source[this.offset];
      if (character === "}") {
        this.offset += 1;
        this.token();
        return result;
      }
      if (character !== ",") return this.malformed();
      this.offset += 1;
    }
  }
}

export function parseFmpJson(source: string): JsonValue {
  return new Parser(source).parse();
}
