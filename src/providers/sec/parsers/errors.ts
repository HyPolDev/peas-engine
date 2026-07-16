import type { SecParseLimitKind, SecReasonCode } from "../contracts.js";

export class SecParserError extends Error {
  constructor(
    readonly reasonCode: SecReasonCode,
    message: string,
    readonly limitKind: SecParseLimitKind | null = null,
  ) {
    super(message);
    this.name = "SecParserError";
  }
}

export function secParserFailure(
  reasonCode: SecReasonCode,
  message: string,
  limitKind: SecParseLimitKind | null = null,
): never {
  throw new SecParserError(reasonCode, message, limitKind);
}
