import type { AlpacaAuthorizationHeaders } from "../credentials.js";
import type {
  MarketAcquisitionSafeError,
  ValidatedMarketAcquisitionConfiguration,
} from "../contracts.js";
import type { RetryFailure } from "../retry.js";

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
  authorizationHeaders: AlpacaAuthorizationHeaders;
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
  dispatch(request: AlpacaTransportRequest): Promise<AlpacaTransportResponse>;
  abort(): Promise<void>;
  settle(): Promise<void>;
}

export interface AlpacaVerifiedPageSink<T> extends AlpacaAttemptResource {
  write(bytes: Uint8Array): Promise<void>;
  completeAndVerify(): Promise<T>;
}

export interface AlpacaDeadlineHandle {
  readonly expired: Promise<void>;
  cancel(): void;
  settle(): Promise<void>;
}

export interface AlpacaDeadlineScheduler {
  arm(delayMs: 30_000): AlpacaDeadlineHandle;
}

export type AlpacaAttemptInput<T> = Readonly<{
  plan: ValidatedMarketAcquisitionConfiguration;
  page: AlpacaPageAuthority;
  authorizationHeaders: AlpacaAuthorizationHeaders;
  transport: AlpacaTransport;
  artifactSink: AlpacaVerifiedPageSink<T>;
  deadlineScheduler: AlpacaDeadlineScheduler;
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
