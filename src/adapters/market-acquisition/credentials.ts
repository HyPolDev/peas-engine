import {
  ACCEPTED_PR_2E_CANDIDATE_SHA,
  AUTHORIZATION_MODE,
  type ValidatedMarketAcquisitionConfiguration,
} from "./contracts.js";
import {
  ALPACA_ROUTE_REGISTRY,
  deriveMarketAcquisitionConfigurationIdentity,
  deriveMarketAcquisitionRequestIdentity,
  ZERO_SPEND_POLICY_ID,
} from "./identity.js";
import { assertValidatedMarketAcquisitionConfiguration } from "./configuration.js";
import {
  type AcquisitionJournal,
  type JournalIdentityInput,
  createJournalEntry,
  deriveMarketAcquisitionJournalId,
  journalEntryBody,
  validateJournalEntries,
} from "./journal.js";
import { safeAcquisitionError, type SafeAcquisitionError } from "./redaction.js";
import type { ArtifactRetentionJournal } from "./retention/contracts.js";
import type {
  AlpacaTransport,
  AlpacaBodyRead,
  AlpacaTransportRequest,
  AlpacaTransportResponse,
} from "./alpaca/contracts.js";
import {
  assertOwnedAcquisitionJournal,
  assertOwnedRetentionJournal,
  assertOwnedSqliteAcquisitionJournal,
  assertOwnedSqliteRetentionJournal,
} from "./owned-journal.js";
import { validateJournalLedgerBindings } from "./artifact-integration.js";
import { P1_10_TEST_AUTHORITY } from "#p1-10-test-authority";
import { request as dispatchHttpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";

export const ALPACA_KEY_ID_ENV = "PEAS_ALPACA_API_KEY_ID";
export const ALPACA_SECRET_KEY_ENV = "PEAS_ALPACA_API_SECRET_KEY";
export const RESERVED_FMP_KEY_ENV = "PEAS_FMP_API_KEY";

export type CredentialReadName = typeof ALPACA_KEY_ID_ENV | typeof ALPACA_SECRET_KEY_ENV;

export interface RuntimeSecretSource {
  read(name: CredentialReadName): unknown;
}

export type CredentialAuthorizationRequest = Readonly<{
  plan: ValidatedMarketAcquisitionConfiguration;
  acquisitionObservationId: string;
  retrievalAttemptId: string;
  journalIdentity: JournalIdentityInput;
  marketAcquisitionJournalId: string;
}>;

export type CredentialAuthorizationEvidence = Readonly<{
  kind: "p1-10-durable-credential-evidence";
}>;

export type CredentialPreflightPermit = Readonly<{
  kind: "p1-10-credential-capability";
  requestIdentityHash: string;
  acquisitionConfigurationHash: string;
  acquisitionObservationId: string;
  retrievalAttemptId: string;
}>;

export type AlpacaAuthorizationHeaders = Readonly<{
  "APCA-API-KEY-ID": string;
  "APCA-API-SECRET-KEY": string;
}>;

export type AlpacaDispatchCapability = Readonly<{
  kind: "p1-10-alpaca-dispatch-capability";
}>;

export type CredentialAttemptResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: SafeAcquisitionError }>;

type PermitBinding = Readonly<{
  plan: ValidatedMarketAcquisitionConfiguration;
  acquisitionObservationId: string;
  retrievalAttemptId: string;
}>;

type AuthorizationLeaseState = {
  keyId: string | undefined;
  secretKey: string | undefined;
  active: boolean;
};

type DispatchBinding = PermitBinding & Readonly<{ authorization: AuthorizationLeaseState }>;

const issuedPermits = new WeakMap<object, PermitBinding>();
const issuedDispatchCapabilities = new WeakMap<object, DispatchBinding>();
const establishedEvidence = new WeakMap<object, PermitBinding>();
const credentialIsolatedTransports = new WeakSet<object>();
const credentialAuthorizationBoundaries = new WeakSet<object>();
const CREDENTIAL_BOUNDARY_CONSTRUCTION_AUTHORITY = Object.freeze({});

function revokeAuthorization(state: AuthorizationLeaseState): void {
  state.active = false;
  state.keyId = undefined;
  state.secretKey = undefined;
}

function activeAuthorizationValue(value: string | undefined, active: boolean): string {
  if (!active || value === undefined) throw new TypeError("alpaca-authorization-lease-expired");
  return value;
}

function leasedAuthorizationHeaders(state: AuthorizationLeaseState): AlpacaAuthorizationHeaders {
  const headers = Object.create(null) as Record<string, unknown>;
  Object.defineProperties(headers, {
    "APCA-API-KEY-ID": {
      enumerable: true,
      configurable: false,
      get: () => activeAuthorizationValue(state.keyId, state.active),
    },
    "APCA-API-SECRET-KEY": {
      enumerable: true,
      configurable: false,
      get: () => activeAuthorizationValue(state.secretKey, state.active),
    },
  });
  return Object.freeze(headers) as AlpacaAuthorizationHeaders;
}

function validatePlan(plan: ValidatedMarketAcquisitionConfiguration): void {
  assertValidatedMarketAcquisitionConfiguration(plan);
  const route = ALPACA_ROUTE_REGISTRY[plan.kind];
  if (
    !Object.isFrozen(plan) ||
    plan.acceptedContractCandidateSha !== ACCEPTED_PR_2E_CANDIDATE_SHA ||
    plan.lane !== "alpaca-historical-sip" ||
    plan.authorizationMode !== AUTHORIZATION_MODE ||
    plan.liveEnabled !== true ||
    plan.runDecision !== "allow" ||
    plan.retentionPolicyReadiness !== "ready" ||
    plan.zeroIncrementalSpend !== true ||
    plan.zeroSpendPolicyId !== ZERO_SPEND_POLICY_ID ||
    plan.route !== route
  ) {
    throw new TypeError("credential-configuration-invalid");
  }
  const requestIdentityHash = deriveMarketAcquisitionRequestIdentity({
    route,
    entitlementSnapshotId: plan.entitlementSnapshotId,
    instruments: plan.instruments,
    factFamily: plan.kind,
    queryStartNs: plan.queryStartNs,
    queryEndNs: plan.queryEndNs,
    authorizationMode: AUTHORIZATION_MODE,
  });
  const configurationHash = deriveMarketAcquisitionConfigurationIdentity({
    requestIdentityHash,
    requestedPageLimit: Number(plan.queryFields.limit),
    liveEnabled: true,
    zeroSpendPolicyId: ZERO_SPEND_POLICY_ID,
    runDecision: "allow",
    aliasAuthorityCatalogId: plan.aliasAuthorityCatalogId,
    retentionPolicyReadiness: "ready",
  });
  if (
    requestIdentityHash !== plan.requestIdentityHash ||
    configurationHash !== plan.acquisitionConfigurationHash
  ) {
    throw new TypeError("credential-configuration-invalid");
  }
}

/**
 * Owned durable authorization composition. Callers provide identities, never journal or ledger
 * arrays; the boundary reloads and validates the committed request-started checkpoint itself.
 */
export class DurableCredentialAuthorizationBoundary {
  readonly #journal: AcquisitionJournal;
  readonly #retentionJournal: ArtifactRetentionJournal;

  constructor(
    journal: AcquisitionJournal,
    retentionJournal: ArtifactRetentionJournal,
    authority?: object,
  ) {
    assertOwnedAcquisitionJournal(journal);
    assertOwnedRetentionJournal(retentionJournal);
    this.#journal = journal;
    this.#retentionJournal = retentionJournal;
    if (authority === CREDENTIAL_BOUNDARY_CONSTRUCTION_AUTHORITY) {
      credentialAuthorizationBoundaries.add(this);
    }
  }

  async establish(input: CredentialAuthorizationRequest): Promise<CredentialAuthorizationEvidence> {
    assertOwnedDurableCredentialAuthorizationBoundary(this);
    validatePlan(input.plan);
    if (
      input.marketAcquisitionJournalId !== deriveMarketAcquisitionJournalId(input.journalIdentity)
    ) {
      throw new TypeError("credential-journal-identity-invalid");
    }
    if (this.#retentionJournal.providerUseDenied("alpaca", input.journalIdentity.providerId)) {
      throw new TypeError("credential-retention-denied");
    }
    const journal = await this.#journal.load(input.marketAcquisitionJournalId);
    validateJournalEntries(journal, input.journalIdentity);
    const ledger = await this.#journal.loadLedgerEntries();
    validateJournalLedgerBindings(journal, ledger);
    const latest = journal.at(-1);
    const durableStage = ledger.find((entry) => entry.entryId === latest?.stageLedgerFactId);
    const durableDeclaration = ledger.find(
      (entry) =>
        durableStage?.parentEntryIds.includes(entry.entryId) === true &&
        entry.facts.kind === "acquisition.declared",
    );
    if (
      latest?.checkpointKind !== "request-started" ||
      latest.requestIdentityHash !== input.plan.requestIdentityHash ||
      latest.acquisitionConfigurationHash !== input.plan.acquisitionConfigurationHash ||
      latest.acquisitionObservationId !== input.acquisitionObservationId ||
      latest.retrievalAttemptId !== input.retrievalAttemptId ||
      latest.stageLedgerFactId === null ||
      latest.causalParentFactIds.length !== 1 ||
      durableStage?.facts.kind !== "request.started" ||
      durableStage.facts.acquisitionObservationId !== input.acquisitionObservationId ||
      durableDeclaration?.facts.kind !== "acquisition.declared" ||
      durableDeclaration.facts.acquisitionObservationId !== input.acquisitionObservationId ||
      durableDeclaration.facts.retrievalAttemptId !== input.retrievalAttemptId ||
      durableDeclaration.facts.sanitizedRequestIdentityHash !== input.plan.requestIdentityHash ||
      durableDeclaration.facts.provider !== "alpaca" ||
      durableDeclaration.facts.routeLabel !== input.plan.route.safeRouteLabel
    ) {
      throw new TypeError("credential-request-started-evidence-invalid");
    }
    const attemptStarted = createJournalEntry(
      latest,
      input.marketAcquisitionJournalId,
      "attempt-started",
      Object.freeze({
        ...journalEntryBody(latest),
        cumulativeAttempts: latest.cumulativeAttempts + 1,
      }),
    );
    if (!(await this.#journal.claimAttemptStarted(latest.journalEntryHash, attemptStarted))) {
      throw new TypeError("credential-attempt-already-claimed");
    }
    const claimed = await this.#journal.load(input.marketAcquisitionJournalId);
    validateJournalEntries(claimed, input.journalIdentity);
    if (claimed.at(-1)?.journalEntryHash !== attemptStarted.journalEntryHash) {
      throw new TypeError("credential-attempt-claim-unprovable");
    }
    if (this.#retentionJournal.providerUseDenied("alpaca", input.journalIdentity.providerId)) {
      throw new TypeError("credential-retention-denied");
    }
    const evidence = Object.freeze({ kind: "p1-10-durable-credential-evidence" as const });
    establishedEvidence.set(
      evidence,
      Object.freeze({
        plan: input.plan,
        acquisitionObservationId: input.acquisitionObservationId,
        retrievalAttemptId: input.retrievalAttemptId,
      }),
    );
    return evidence;
  }
}

function constructCredentialAuthorizationBoundary(
  journal: AcquisitionJournal,
  retentionJournal: ArtifactRetentionJournal,
): DurableCredentialAuthorizationBoundary {
  const boundary = new DurableCredentialAuthorizationBoundary(
    journal,
    retentionJournal,
    CREDENTIAL_BOUNDARY_CONSTRUCTION_AUTHORITY,
  );
  Object.freeze(boundary);
  return boundary;
}

export function createDurableCredentialAuthorizationBoundary(
  journal: AcquisitionJournal,
  retentionJournal: ArtifactRetentionJournal,
): DurableCredentialAuthorizationBoundary {
  assertOwnedSqliteAcquisitionJournal(journal);
  assertOwnedSqliteRetentionJournal(retentionJournal);
  return constructCredentialAuthorizationBoundary(journal, retentionJournal);
}

export function createTestDurableCredentialAuthorizationBoundary(
  journal: AcquisitionJournal,
  retentionJournal: ArtifactRetentionJournal,
): DurableCredentialAuthorizationBoundary {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-credential-authorization-composition-unavailable");
  }
  assertOwnedAcquisitionJournal(journal);
  assertOwnedRetentionJournal(retentionJournal);
  return constructCredentialAuthorizationBoundary(journal, retentionJournal);
}

export function assertOwnedDurableCredentialAuthorizationBoundary(
  value: DurableCredentialAuthorizationBoundary,
): void {
  if (
    !credentialAuthorizationBoundaries.has(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== DurableCredentialAuthorizationBoundary.prototype ||
    !Object.isFrozen(value)
  ) {
    throw new TypeError("owned-durable-credential-authorization-boundary-required");
  }
}

export function authorizeCredentialLoad(
  evidence: CredentialAuthorizationEvidence,
): CredentialPreflightPermit {
  const binding = establishedEvidence.get(evidence);
  if (binding === undefined) throw new TypeError("credential-evidence-capability-invalid");
  establishedEvidence.delete(evidence);
  const permit = Object.freeze({
    kind: "p1-10-credential-capability" as const,
    requestIdentityHash: binding.plan.requestIdentityHash,
    acquisitionConfigurationHash: binding.plan.acquisitionConfigurationHash,
    acquisitionObservationId: binding.acquisitionObservationId,
    retrievalAttemptId: binding.retrievalAttemptId,
  });
  issuedPermits.set(permit, binding);
  return permit;
}

function credentialUnavailable<T>(): CredentialAttemptResult<T> {
  return { ok: false, error: safeAcquisitionError("credential-unavailable", "credential-load") };
}

export async function withAlpacaAuthorization<T>(
  permit: CredentialPreflightPermit,
  source: RuntimeSecretSource,
  operation: (capability: AlpacaDispatchCapability) => Promise<T>,
): Promise<CredentialAttemptResult<T>> {
  const binding = issuedPermits.get(permit);
  if (binding === undefined) {
    throw new TypeError("credential-boundary-requires-durable-preconditions");
  }
  issuedPermits.delete(permit);
  let keyId: unknown;
  let secretKey: unknown;
  let capability: AlpacaDispatchCapability | undefined;
  let authorization: AuthorizationLeaseState | undefined;
  try {
    keyId = source.read(ALPACA_KEY_ID_ENV);
    secretKey = source.read(ALPACA_SECRET_KEY_ENV);
    if (
      typeof keyId !== "string" ||
      keyId.length === 0 ||
      typeof secretKey !== "string" ||
      secretKey.length === 0
    )
      return credentialUnavailable();
    authorization = { keyId, secretKey, active: true };
    capability = Object.freeze({ kind: "p1-10-alpaca-dispatch-capability" as const });
    issuedDispatchCapabilities.set(capability, Object.freeze({ ...binding, authorization }));
    return { ok: true, value: await operation(capability) };
  } catch {
    return credentialUnavailable();
  } finally {
    if (capability !== undefined) issuedDispatchCapabilities.delete(capability);
    if (authorization !== undefined) revokeAuthorization(authorization);
    keyId = undefined;
    secretKey = undefined;
  }
}

function resolveAlpacaDispatchCapability(
  capability: AlpacaDispatchCapability,
  request: AlpacaTransportRequest,
): Readonly<{ headers: AlpacaAuthorizationHeaders; state: AuthorizationLeaseState }> {
  const binding = issuedDispatchCapabilities.get(capability);
  if (
    binding === undefined ||
    binding.plan.requestIdentityHash !== request.requestIdentityHash ||
    binding.plan.route.path !== request.path ||
    binding.plan.route.endpointChannelId !== request.endpointChannelId
  ) {
    throw new TypeError("alpaca-dispatch-capability-invalid");
  }
  issuedDispatchCapabilities.delete(capability);
  return Object.freeze({
    headers: leasedAuthorizationHeaders(binding.authorization),
    state: binding.authorization,
  });
}

type AlpacaCredentialIsolatedTransportDriver = Readonly<{
  dispatch(
    request: AlpacaTransportRequest,
    authorizationHeaders: AlpacaAuthorizationHeaders,
  ): Promise<AlpacaTransportResponse>;
  abort(): Promise<void>;
  settle(): Promise<void>;
}>;

/**
 * Owns authorization consumption. The lower driver receives an exact frozen accessor record only
 * for the physical dispatch scope; every PEAS-owned plaintext reference is revoked on settlement.
 */
export function createTestCredentialIsolatedAlpacaTransport(
  driver: AlpacaCredentialIsolatedTransportDriver,
): AlpacaTransport {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-alpaca-transport-composition-unavailable");
  }
  if (
    typeof driver.dispatch !== "function" ||
    typeof driver.abort !== "function" ||
    typeof driver.settle !== "function"
  ) {
    throw new TypeError("alpaca-transport-driver-invalid");
  }
  const dispatch = driver.dispatch.bind(driver);
  const abort = driver.abort.bind(driver);
  const settle = driver.settle.bind(driver);
  const transport: AlpacaTransport = Object.freeze({
    async dispatch(
      request: AlpacaTransportRequest,
      authorization: AlpacaDispatchCapability,
    ): Promise<AlpacaTransportResponse> {
      const lease = resolveAlpacaDispatchCapability(authorization, request);
      const { headers } = lease;
      if (
        !Object.isFrozen(headers) ||
        Object.keys(headers).length !== 2 ||
        headers["APCA-API-KEY-ID"].length === 0 ||
        headers["APCA-API-SECRET-KEY"].length === 0
      ) {
        throw new TypeError("alpaca-authorization-record-invalid");
      }
      try {
        return await dispatch(request, headers);
      } finally {
        revokeAuthorization(lease.state);
      }
    },
    abort,
    settle,
  });
  credentialIsolatedTransports.add(transport);
  return transport;
}

class NativeAlpacaResponseBody {
  readonly #response: IncomingMessage;

  constructor(response: IncomingMessage) {
    this.#response = response;
  }

  async read(): Promise<AlpacaBodyRead> {
    const available = this.#response.read() as Buffer | null;
    if (available !== null) {
      return Object.freeze({ done: false as const, bytes: new Uint8Array(available) });
    }
    if (this.#response.readableEnded) return Object.freeze({ done: true as const });
    return await new Promise<AlpacaBodyRead>((resolve, reject) => {
      const cleanup = (): void => {
        this.#response.off("readable", onReadable);
        this.#response.off("end", onEnd);
        this.#response.off("error", onError);
      };
      const onReadable = (): void => {
        cleanup();
        const bytes = this.#response.read() as Buffer | null;
        resolve(
          bytes === null
            ? Object.freeze({ done: true as const })
            : Object.freeze({ done: false as const, bytes: new Uint8Array(bytes) }),
        );
      };
      const onEnd = (): void => {
        cleanup();
        resolve(Object.freeze({ done: true as const }));
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      this.#response.once("readable", onReadable);
      this.#response.once("end", onEnd);
      this.#response.once("error", onError);
    });
  }

  async abort(): Promise<void> {
    this.#response.destroy();
  }
  async destroy(): Promise<void> {
    this.#response.destroy();
  }
  async settle(): Promise<void> {
    if (this.#response.destroyed || this.#response.readableEnded) return;
    await new Promise<void>((resolve) => this.#response.once("close", resolve));
  }
}

/**
 * Sole live transport composition. No caller-supplied callback or structural driver crosses the
 * credential boundary: plaintext values are applied only to the platform HTTP implementation.
 */
export function createProductionCredentialIsolatedAlpacaTransport(
  ...callerArguments: never[]
): AlpacaTransport {
  if (callerArguments.length !== 0)
    throw new TypeError("alpaca-production-transport-takes-no-driver");
  let activeRequest: ClientRequest | undefined;
  let activeDispatch: Promise<unknown> | undefined;
  const transport: AlpacaTransport = Object.freeze({
    async dispatch(
      request: AlpacaTransportRequest,
      capability: AlpacaDispatchCapability,
    ): Promise<AlpacaTransportResponse> {
      const lease = resolveAlpacaDispatchCapability(capability, request);
      let authorizationHeaders: Readonly<Record<string, string>> | undefined;
      try {
        authorizationHeaders = Object.freeze({
          "APCA-API-KEY-ID": activeAuthorizationValue(lease.state.keyId, lease.state.active),
          "APCA-API-SECRET-KEY": activeAuthorizationValue(
            lease.state.secretKey,
            lease.state.active,
          ),
        });
        const url = new URL(request.path, request.origin);
        for (const [name, value] of request.query) url.searchParams.append(name, value);
        const dispatched = new Promise<IncomingMessage>((resolve, reject) => {
          const physical = dispatchHttpsRequest(url, {
            method: "GET",
            headers: authorizationHeaders,
            signal: request.signal,
          });
          activeRequest = physical;
          physical.once("response", resolve);
          physical.once("error", reject);
          physical.end();
        });
        activeDispatch = dispatched;
        const response = await dispatched;
        const declaredHeader = response.headers["content-length"];
        const declaredLength = Array.isArray(declaredHeader) ? null : (declaredHeader ?? null);
        const contentLength =
          declaredLength !== null && /^(?:0|[1-9][0-9]*)$/.test(declaredLength)
            ? Number(declaredLength)
            : null;
        return Object.freeze({
          status: response.statusCode ?? 0,
          contentLength,
          retryAfter: Array.isArray(response.headers["retry-after"])
            ? null
            : (response.headers["retry-after"] ?? null),
          quotaClassification: "missing" as const,
          body: new NativeAlpacaResponseBody(response),
          siblingResources: Object.freeze([]),
        });
      } finally {
        authorizationHeaders = undefined;
        revokeAuthorization(lease.state);
        activeRequest = undefined;
        activeDispatch = undefined;
      }
    },
    async abort(): Promise<void> {
      activeRequest?.destroy();
    },
    async settle(): Promise<void> {
      try {
        await activeDispatch;
      } catch {
        // The attempt boundary classifies dispatch failure.
      }
    },
  });
  credentialIsolatedTransports.add(transport);
  return transport;
}

export function assertCredentialIsolatedAlpacaTransport(value: AlpacaTransport): void {
  if (!credentialIsolatedTransports.has(value) || isProxy(value) || !Object.isFrozen(value)) {
    throw new TypeError("credential-isolated-alpaca-transport-required");
  }
}

export function fmpLaneDisabled(): CredentialAttemptResult<never> {
  return { ok: false, error: safeAcquisitionError("lane-not-implemented", "authority") };
}

export function processEnvironmentSecretSource(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeSecretSource {
  return {
    read(name): unknown {
      return environment[name];
    },
  };
}
import { isProxy } from "node:util/types";
