export const P1_03_SOURCE_IDS = Object.freeze(["sec", "fmp", "issuer-ir"] as const);

export type P103SourceId = (typeof P1_03_SOURCE_IDS)[number];

export const P1_03_EFFECTS_ZERO = Object.freeze({
  network: 0,
  provider: 0,
  credential: 0,
  account: 0,
  subscription: 0,
  spending: 0,
  broker: 0,
  order: 0,
  portfolio: 0,
  position: 0,
  fill: 0,
  financialEffect: 0,
} as const);

export const P1_03_LIMITS = Object.freeze({
  maxAllowlistEntries: 32,
  maxFixtures: 64,
  maxFixtureBytes: 2_097_152,
  maxRetainedBytes: 8_388_608,
  maxStringBytes: 512,
} as const);

export type P103ReasonCode =
  | "p1-03.input-invalid"
  | "p1-03.allowlist-limit"
  | "p1-03.fixture-limit"
  | "p1-03.fixture-byte-limit"
  | "p1-03.retained-byte-limit"
  | "p1-03.string-limit"
  | "p1-03.source-invalid"
  | "p1-03.timestamp-invalid"
  | "p1-03.duplicate-allowlist-entry"
  | "p1-03.duplicate-fixture-identity"
  | "p1-03.fixture-not-allowlisted"
  | "p1-03.capture-not-allowlisted"
  | "p1-03.fixture-missing"
  | "p1-03.digest-invalid";

export class P103CaptureContractError extends Error {
  constructor(readonly reasonCode: P103ReasonCode) {
    super(reasonCode);
    this.name = "P103CaptureContractError";
  }
}

export type P103AllowlistEntry = Readonly<{
  sourceId: P103SourceId;
  issuerId: string;
  resourceId: string;
}>;

export type P103Fixture = Readonly<{
  sourceId: P103SourceId;
  issuerId: string;
  resourceId: string;
  recordId: string;
  revisionId: string;
  publishedAtMs: number | null;
  retrievedAtMs: number;
  contentType: string;
  /** Each entry is one integer byte in the closed interval 0..255. */
  bytes: readonly number[];
}>;

export type P103CaptureRequest = Readonly<{
  sourceId: P103SourceId;
  issuerId: string;
  resourceId: string;
  recordId: string;
  revisionId: string;
}>;

export type P103CaptureReceipt = Readonly<{
  captureId: string;
  sourceId: P103SourceId;
  issuerId: string;
  resourceId: string;
  recordId: string;
  revisionId: string;
  publishedAtMs: number | null;
  retrievedAtMs: number;
  contentType: string;
  rawSha256: string;
  rawSizeBytes: number;
  duplicate: boolean;
  effects: typeof P1_03_EFFECTS_ZERO;
}>;

export type P103CaptureSnapshot = Readonly<{
  entitlementMode: "provider-free-local-fixture";
  receipts: readonly P103CaptureReceipt[];
  totalUniqueCaptures: number;
  uniqueRetainedDigests: number;
  retainedBytes: number;
  effects: typeof P1_03_EFFECTS_ZERO;
}>;

export type P103SessionInput = Readonly<{
  entitlementMode: "provider-free-local-fixture";
  allowlist: readonly P103AllowlistEntry[];
  fixtures: readonly P103Fixture[];
}>;

export interface ProviderFreeCaptureSession {
  readonly kind: "p1-03-provider-free-capture-session-v1";
  capture(request: P103CaptureRequest): P103CaptureReceipt;
  readRaw(digest: string): Uint8Array | undefined;
  snapshot(): P103CaptureSnapshot;
}
