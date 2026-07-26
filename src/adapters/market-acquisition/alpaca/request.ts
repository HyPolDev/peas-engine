import { Buffer } from "node:buffer";
import { types as utilityTypes } from "node:util";

import { snapshotExactNormalizerInput } from "../../../providers/normalizer-input.js";
import {
  ACCEPTED_PR_2E_CANDIDATE_SHA,
  AUTHORIZATION_MODE,
  MARKET_ACQUISITION_LIMITS,
  ROUTE_POLICY_VERSION,
  type ValidatedMarketAcquisitionConfiguration,
} from "../contracts.js";
import type { AlpacaAuthorizationHeaders } from "../credentials.js";
import {
  deriveMarketAcquisitionConfigurationIdentity,
  deriveMarketAcquisitionRequestIdentity,
  ALPACA_ROUTE_REGISTRY,
  ZERO_SPEND_POLICY_ID,
} from "../identity.js";
import { validateContinuationAuthority } from "../journal.js";
import type {
  AlpacaPageAuthority,
  AlpacaQueryPair,
  AlpacaTransportRequest,
  AlpacaTransportRequestLease,
  VerifiedContinuationPage,
} from "./contracts.js";

const HASH = /^[0-9a-f]{64}$/u;
const AUTHORIZATION_HEADER_KEYS = Object.freeze(["APCA-API-KEY-ID", "APCA-API-SECRET-KEY"]);

function invalid(): never {
  throw new TypeError("alpaca-request-authority-invalid");
}

function validatePlan(plan: ValidatedMarketAcquisitionConfiguration): void {
  if (
    plan === null ||
    typeof plan !== "object" ||
    utilityTypes.isProxy(plan) ||
    !Object.isFrozen(plan) ||
    plan.acceptedContractCandidateSha !== ACCEPTED_PR_2E_CANDIDATE_SHA ||
    plan.lane !== "alpaca-historical-sip" ||
    plan.liveEnabled !== true ||
    plan.authorizationMode !== AUTHORIZATION_MODE ||
    plan.capability !== "historical-market-reference" ||
    plan.sourceRole !== "primary" ||
    plan.fallbackKind !== "none" ||
    plan.zeroIncrementalSpend !== true ||
    plan.costStatus !== "zero-incremental-spend-approved" ||
    plan.zeroSpendPolicyId !== ZERO_SPEND_POLICY_ID ||
    plan.runDecision !== "allow" ||
    plan.retentionPolicyReadiness !== "ready"
  ) {
    invalid();
  }
  const route = ALPACA_ROUTE_REGISTRY[plan.kind];
  if (
    plan.route !== route ||
    route.method !== "GET" ||
    route.origin !== "https://data.alpaca.markets" ||
    route.endpointChannelId !== plan.route.endpointChannelId ||
    !Object.isFrozen(plan.instruments) ||
    !Object.isFrozen(plan.queryFields) ||
    plan.instruments.length < 1 ||
    plan.instruments.length > MARKET_ACQUISITION_LIMITS.instruments
  ) {
    invalid();
  }
  const expectedRequestIdentityHash = deriveMarketAcquisitionRequestIdentity({
    route,
    entitlementSnapshotId: plan.entitlementSnapshotId,
    instruments: plan.instruments,
    factFamily: plan.kind,
    queryStartNs: plan.queryStartNs,
    queryEndNs: plan.queryEndNs,
    authorizationMode: AUTHORIZATION_MODE,
  });
  const expectedConfigurationHash = deriveMarketAcquisitionConfigurationIdentity({
    requestIdentityHash: expectedRequestIdentityHash,
    requestedPageLimit: Number(plan.queryFields.limit),
    liveEnabled: true,
    zeroSpendPolicyId: ZERO_SPEND_POLICY_ID,
    runDecision: "allow",
    aliasAuthorityCatalogId: plan.aliasAuthorityCatalogId,
    retentionPolicyReadiness: "ready",
  });
  if (
    plan.requestIdentityHash !== expectedRequestIdentityHash ||
    plan.acquisitionConfigurationHash !== expectedConfigurationHash ||
    plan.route.safeRouteLabel !== `alpaca-v2-historical-${plan.kind}`
  ) {
    invalid();
  }
  if (
    plan.queryFields.symbols !== plan.instruments.map(({ symbol }) => symbol).join(",") ||
    plan.queryFields.start.length === 0 ||
    plan.queryFields.end.length === 0 ||
    plan.queryFields.feed !== "sip" ||
    plan.queryFields.sort !== "asc" ||
    !/^[1-9]\d{0,4}$/u.test(plan.queryFields.limit) ||
    Number(plan.queryFields.limit) > MARKET_ACQUISITION_LIMITS.recordsPerPage ||
    (plan.kind === "bars"
      ? plan.queryFields.timeframe !== "1Min" || plan.queryFields.adjustment !== "raw"
      : plan.queryFields.timeframe !== undefined || plan.queryFields.adjustment !== undefined)
  ) {
    invalid();
  }
}

function validateAuthorizationHeaders(
  value: AlpacaAuthorizationHeaders,
): AlpacaAuthorizationHeaders {
  let snapshot: Readonly<Record<string, unknown>>;
  try {
    snapshot = snapshotExactNormalizerInput(value, AUTHORIZATION_HEADER_KEYS);
  } catch {
    return invalid();
  }
  if (
    typeof snapshot["APCA-API-KEY-ID"] !== "string" ||
    snapshot["APCA-API-KEY-ID"].length === 0 ||
    typeof snapshot["APCA-API-SECRET-KEY"] !== "string" ||
    snapshot["APCA-API-SECRET-KEY"].length === 0
  ) {
    return invalid();
  }
  return value;
}

function validateHashList(values: readonly string[]): ReadonlySet<string> {
  if (
    !Array.isArray(values) ||
    utilityTypes.isProxy(values) ||
    values.length > MARKET_ACQUISITION_LIMITS.successfulPages ||
    values.some((value) => !HASH.test(value)) ||
    new Set(values).size !== values.length
  ) {
    return invalid();
  }
  return new Set(values);
}

function continuationToken(page: VerifiedContinuationPage, requestIdentityHash: string): string {
  if (
    !Number.isSafeInteger(page.pageOrdinal) ||
    page.pageOrdinal < 1 ||
    page.pageOrdinal >= MARKET_ACQUISITION_LIMITS.successfulPages ||
    page.preceding.requestIdentityHash !== requestIdentityHash ||
    Buffer.byteLength(page.tokenMaterial, "utf8") < 1 ||
    Buffer.byteLength(page.tokenMaterial, "utf8") > MARKET_ACQUISITION_LIMITS.opaquePageTokenBytes
  ) {
    return invalid();
  }
  try {
    validateContinuationAuthority(
      page.preceding,
      {
        requestIdentityHash,
        pageOrdinal: page.pageOrdinal,
        tokenMaterial: page.tokenMaterial,
        currentTokenHash: page.currentTokenHash,
        currentContinuationBindingHash: page.currentContinuationBindingHash,
      },
      validateHashList(page.previouslyConsumedTokenHashes),
    );
  } catch {
    return invalid();
  }
  return page.tokenMaterial;
}

function queryFor(
  plan: ValidatedMarketAcquisitionConfiguration,
  page: AlpacaPageAuthority,
): Readonly<{
  pairs: readonly AlpacaQueryPair[];
  release(): void;
}> {
  type MutablePair = [AlpacaQueryPair[0], string];
  const pairs: MutablePair[] = [
    ["symbols", plan.queryFields.symbols],
    ["start", plan.queryFields.start],
    ["end", plan.queryFields.end],
    ["limit", plan.queryFields.limit],
  ];
  if (page.kind === "first-page") {
    if (page.pageOrdinal !== 0) invalid();
  } else {
    pairs.push(["page_token", continuationToken(page, plan.requestIdentityHash)]);
  }
  pairs.push(["feed", "sip"], ["sort", "asc"]);
  if (plan.kind === "bars") pairs.push(["timeframe", "1Min"], ["adjustment", "raw"]);
  return Object.freeze({
    pairs: Object.freeze(pairs),
    release(): void {
      const pageToken = pairs.find(([field]) => field === "page_token");
      if (pageToken !== undefined) pageToken[1] = "";
    },
  });
}

export function buildAlpacaTransportRequest(
  plan: ValidatedMarketAcquisitionConfiguration,
  page: AlpacaPageAuthority,
  authorizationHeaders: AlpacaAuthorizationHeaders,
  signal: AbortSignal,
): AlpacaTransportRequestLease {
  validatePlan(plan);
  if (!(signal instanceof AbortSignal) || signal.aborted) invalid();
  const headers = validateAuthorizationHeaders(authorizationHeaders);
  const queryLease = queryFor(plan, page);
  const request: AlpacaTransportRequest = Object.freeze({
    method: "GET",
    origin: "https://data.alpaca.markets",
    path: plan.route.path as AlpacaTransportRequest["path"],
    redirect: "error",
    endpointChannelId: plan.route.endpointChannelId,
    requestIdentityHash: plan.requestIdentityHash,
    pageOrdinal: page.pageOrdinal,
    query: queryLease.pairs,
    authorizationHeaders: headers,
    signal,
  });
  return Object.freeze({ request, release: queryLease.release });
}

export const ALPACA_REQUEST_ROUTE_POLICY = ROUTE_POLICY_VERSION;
