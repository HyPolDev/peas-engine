import type { AlpacaDispatchCapability } from "../credentials.js";
import type {
  MarketAcquisitionSafeError,
  ValidatedMarketAcquisitionConfiguration,
} from "../contracts.js";
import type { RetryFailure } from "../retry.js";
import type { RetentionOwnership } from "../retention/contracts.js";

export type AlpacaQueryFieldName =
  | "symbols"
  | "start"
  | "end"
  | "limit"
  | "page_token"
  | "feed"
  | "sort"
  | "timeframe"
  | "adjustment";

export type AlpacaQueryPair = readonly [AlpacaQueryFieldName, string];

export type AlpacaTransportRequestLease = Readonly<{
  request: AlpacaTransportRequest;
  release(): void;
}>;

export type VerifiedContinuationPage = Readonly<{
  kind: "verified-continuation";
  pageOrdinal: number;
  tokenMaterial: string;
  currentTokenHash: string;
  currentContinuationBindingHash: string;
  previouslyConsumedTokenHashes: readonly string[];
  preceding: Readonly<{
    marketAcquisitionId: string;
    requestIdentityHash: string;
    logicalPageIdentityHash: string;
    pageOrdinal: number;
    artifactObservationId: string;
    artifactDigest: string;
    pageChainHash: string;
    nextTokenHash: string;
    nextContinuationBindingHash: string;
  }>;
}>;

export type AlpacaPageAuthority =
  | Readonly<{ kind: "first-page"; pageOrdinal: 0 }>
  | VerifiedContinuationPage;

export type AlpacaTransportRequest = Readonly<{
  method: "GET";
  origin: "https://data.alpaca.markets";
  path: "/v2/stocks/quotes" | "/v2/stocks/trades" | "/v2/stocks/bars";
  redirect: "error";
  endpointChannelId: string;
  requestIdentityHash: string;
  pageOrdinal: number;
  query: readonly AlpacaQueryPair[];
  signal: AbortSignal;
}>;

export interface AlpacaAttemptResource {
  abort(): Promise<void>;
  destroy(): Promise<void>;
  settle(): Promise<void>;
}

export type AlpacaBodyRead =
  | Readonly<{ done: true }>
  | Readonly<{ done: false; bytes: Uint8Array }>;

export interface AlpacaResponseBody extends AlpacaAttemptResource {
  read(): Promise<AlpacaBodyRead>;
}

export type AlpacaQuotaClassification =
  | "temporary-throttling-proved"
  | "quota-exhausted"
  | "missing"
  | "ambiguous";

export type AlpacaTransportResponse = Readonly<{
  status: number;
  contentLength: number | null;
  retryAfter: string | null;
  quotaClassification: AlpacaQuotaClassification;
  body: AlpacaResponseBody;
  siblingResources: readonly AlpacaAttemptResource[];
}>;

export interface AlpacaTransport {
  dispatch(authorization: AlpacaDispatchCapability): Promise<AlpacaTransportResponse>;
  abort(): Promise<void>;
  settle(): Promise<void>;
}

export interface AlpacaVerifiedPageSink<T> extends AlpacaAttemptResource {
  write(bytes: Uint8Array): Promise<void>;
  /**
   * Atomically commits and verifies the artifact and registers its retention ownership against
   * the journal's active provider-stop state. A stop race must reject this operation and leave no
   * usable artifact result.
   */
  completeVerifyAndRegisterOwnership(): Promise<T>;
}

export type AlpacaPreparedArtifactCommit<T> = Readonly<{
  ownership: Omit<RetentionOwnership, "ownershipId">;
  commit(): Promise<T>;
}>;

/** Lower-level sink hidden behind the retention-owning production composition. */
export interface AlpacaArtifactCommitSink<T> extends AlpacaAttemptResource {
  write(bytes: Uint8Array): Promise<void>;
  prepareVerifiedCommit(): Promise<AlpacaPreparedArtifactCommit<T>>;
}

export interface AlpacaDeadlineHandle {
  readonly expired: Promise<void>;
  cancel(): void;
  settle(): Promise<void>;
}

export interface AlpacaDeadlineScheduler {
  arm(delayMs: number): AlpacaDeadlineHandle;
}

export type AlpacaAttemptInput<T> = Readonly<{
  plan: ValidatedMarketAcquisitionConfiguration;
  page: AlpacaPageAuthority;
  dispatchCapability: AlpacaDispatchCapability;
  transport: AlpacaTransport;
  artifactSink: AlpacaVerifiedPageSink<T>;
  deadlineScheduler: AlpacaDeadlineScheduler;
  attemptBudgetMs: number;
}>;

export type AlpacaAttemptSuccess<T> = Readonly<{
  ok: true;
  artifact: T;
  status: 200;
  declaredContentLength: number | null;
  consumedBytes: number;
  resourcesSettled: true;
}>;

export type AlpacaAttemptFailure = Readonly<{
  ok: false;
  error: MarketAcquisitionSafeError;
  retryFailure: RetryFailure;
  laneDisabled: boolean;
  resourcesSettled: boolean;
}>;

export type AlpacaAttemptResult<T> = AlpacaAttemptSuccess<T> | AlpacaAttemptFailure;
