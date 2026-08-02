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
  type DurableAcquisitionWorkflowProducer,
  type JournalEntry,
  type JournalIdentityInput,
  createDurableAcquisitionWorkflowProducer,
  createJournalEntry,
  deriveMarketAcquisitionJournalId,
  journalEntryBody,
  validateJournalEntries,
} from "./journal.js";
import type { ObservationLedgerEntryV1 } from "../../providers/observation-ledger.js";
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
import { P1_10_TEST_AUTHORITY } from "../../internal-test-authority.js";
import { request as dispatchHttpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { assertOwnedAlpacaTransportRequest } from "./alpaca/request.js";

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

type DispatchBinding = PermitBinding &
  Readonly<{
    authorization: AuthorizationLeaseState;
    request: AlpacaTransportRequest;
    url: URL;
  }>;

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
  readonly #workflowProducer: DurableAcquisitionWorkflowProducer;

  constructor(
    journal: AcquisitionJournal,
    retentionJournal: ArtifactRetentionJournal,
    authority?: object,
  ) {
    assertOwnedAcquisitionJournal(journal);
    assertOwnedRetentionJournal(retentionJournal);
    this.#journal = journal;
    this.#retentionJournal = retentionJournal;
    this.#workflowProducer = createDurableAcquisitionWorkflowProducer(journal);
    if (authority === CREDENTIAL_BOUNDARY_CONSTRUCTION_AUTHORITY) {
      credentialAuthorizationBoundaries.add(this);
    }
  }

  async recordRequestStarted(
    input: CredentialAuthorizationRequest,
    ledgerEntries: readonly ObservationLedgerEntryV1[],
    journalEntries: readonly JournalEntry[],
  ): Promise<void> {
    assertOwnedDurableCredentialAuthorizationBoundary(this);
    validatePlan(input.plan);
    if (
      input.marketAcquisitionJournalId !== deriveMarketAcquisitionJournalId(input.journalIdentity)
    ) {
      throw new TypeError("credential-journal-identity-invalid");
    }
    validateJournalEntries(journalEntries, input.journalIdentity);
    validateJournalLedgerBindings(journalEntries, ledgerEntries);
    const latest = journalEntries.at(-1);
    const stage = ledgerEntries.find((entry) => entry.entryId === latest?.stageLedgerFactId);
    const declaration = ledgerEntries.find(
      (entry) =>
        stage?.parentEntryIds.includes(entry.entryId) === true &&
        entry.facts.kind === "acquisition.declared",
    );
    if (
      journalEntries.length !== 2 ||
      latest?.checkpointKind !== "request-started" ||
      latest.requestIdentityHash !== input.plan.requestIdentityHash ||
      latest.acquisitionConfigurationHash !== input.plan.acquisitionConfigurationHash ||
      latest.acquisitionObservationId !== input.acquisitionObservationId ||
      latest.retrievalAttemptId !== input.retrievalAttemptId ||
      stage?.facts.kind !== "request.started" ||
      stage.facts.acquisitionObservationId !== input.acquisitionObservationId ||
      declaration?.facts.kind !== "acquisition.declared" ||
      declaration.facts.acquisitionObservationId !== input.acquisitionObservationId ||
      declaration.facts.retrievalAttemptId !== input.retrievalAttemptId ||
      declaration.facts.sanitizedRequestIdentityHash !== input.plan.requestIdentityHash ||
      declaration.facts.provider !== "alpaca" ||
      declaration.facts.routeLabel !== input.plan.route.safeRouteLabel
    ) {
      throw new TypeError("credential-request-started-workflow-invalid");
    }
    await this.#workflowProducer.persist(ledgerEntries, journalEntries);
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
    const workflowProvenanceValid =
      latest !== undefined &&
      durableStage !== undefined &&
      durableDeclaration !== undefined &&
      (await this.#journal.isWorkflowProducedJournalEntry(latest.journalEntryHash)) &&
      (await this.#journal.isWorkflowProducedLedgerEntry(durableStage.entryId)) &&
      (await this.#journal.isWorkflowProducedLedgerEntry(durableDeclaration.entryId));
    if (
      !workflowProvenanceValid ||
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
  request: AlpacaTransportRequest,
  operation: (capability: AlpacaDispatchCapability) => Promise<T>,
): Promise<CredentialAttemptResult<T>> {
  const binding = issuedPermits.get(permit);
  if (binding === undefined) {
    throw new TypeError("credential-boundary-requires-durable-preconditions");
  }
  issuedPermits.delete(permit);
  try {
    assertOwnedAlpacaTransportRequest(request);
    if (
      request.method !== "GET" ||
      request.redirect !== "error" ||
      request.origin !== binding.plan.route.origin ||
      request.path !== binding.plan.route.path ||
      request.endpointChannelId !== binding.plan.route.endpointChannelId ||
      request.requestIdentityHash !== binding.plan.requestIdentityHash
    ) {
      throw new TypeError("alpaca-dispatch-destination-invalid");
    }
  } catch {
    throw new TypeError("alpaca-dispatch-destination-invalid");
  }
  const url = new URL(request.path, request.origin);
  for (const [name, value] of request.query) url.searchParams.append(name, value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "data.alpaca.markets" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("alpaca-dispatch-destination-invalid");
  }
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
    issuedDispatchCapabilities.set(
      capability,
      Object.freeze({ ...binding, authorization, request, url }),
    );
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

function resolveAlpacaDispatchCapability(capability: AlpacaDispatchCapability): Readonly<{
  headers: AlpacaAuthorizationHeaders;
  state: AuthorizationLeaseState;
  request: AlpacaTransportRequest;
  url: URL;
}> {
  const binding = issuedDispatchCapabilities.get(capability);
  if (binding === undefined) {
    throw new TypeError("alpaca-dispatch-capability-invalid");
  }
  issuedDispatchCapabilities.delete(capability);
  return Object.freeze({
    headers: leasedAuthorizationHeaders(binding.authorization),
    state: binding.authorization,
    request: binding.request,
    url: binding.url,
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
    async dispatch(authorization: AlpacaDispatchCapability): Promise<AlpacaTransportResponse> {
      const lease = resolveAlpacaDispatchCapability(authorization);
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
        return await dispatch(lease.request, headers);
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
  #response: IncomingMessage | null;
  readonly #released: () => void;

  constructor(response: IncomingMessage, released: () => void) {
    this.#response = response;
    this.#released = released;
  }

  #detach(response: IncomingMessage): void {
    if (this.#response === response) {
      this.#response = null;
      this.#released();
    }
  }

  async read(): Promise<AlpacaBodyRead> {
    const response = this.#response;
    if (response === null) return Object.freeze({ done: true as const });
    const available = response.read() as Buffer | null;
    if (available !== null) {
      return Object.freeze({ done: false as const, bytes: new Uint8Array(available) });
    }
    if (response.readableEnded) {
      this.#detach(response);
      return Object.freeze({ done: true as const });
    }
    return await new Promise<AlpacaBodyRead>((resolve, reject) => {
      const cleanup = (): void => {
        response.off("readable", onReadable);
        response.off("end", onEnd);
        response.off("error", onError);
      };
      const onReadable = (): void => {
        cleanup();
        const bytes = response.read() as Buffer | null;
        resolve(
          bytes === null
            ? Object.freeze({ done: true as const })
            : Object.freeze({ done: false as const, bytes: new Uint8Array(bytes) }),
        );
      };
      const onEnd = (): void => {
        cleanup();
        this.#detach(response);
        resolve(Object.freeze({ done: true as const }));
      };
      const onError = (error: Error): void => {
        cleanup();
        this.#detach(response);
        reject(error);
      };
      response.once("readable", onReadable);
      response.once("end", onEnd);
      response.once("error", onError);
    });
  }

  async abort(): Promise<void> {
    const response = this.#response;
    if (response !== null) this.#detach(response);
    response?.destroy();
  }
  async destroy(): Promise<void> {
    const response = this.#response;
    if (response !== null) this.#detach(response);
    response?.destroy();
  }
  async settle(): Promise<void> {
    const response = this.#response;
    if (response === null) return;
    try {
      if (!response.destroyed && !response.readableEnded) {
        await new Promise<void>((resolve) => response.once("close", resolve));
      }
    } finally {
      this.#detach(response);
    }
  }
}

type NativeRequestFunction = (
  url: URL,
  options: Readonly<{
    method: "GET";
    headers: Readonly<Record<string, string>>;
    signal: AbortSignal;
  }>,
) => ClientRequest;

type NativeTransportState = {
  activeRequest: ClientRequest | undefined;
  activeDispatch: Promise<unknown> | undefined;
  activeBodies: number;
};

const nativeTransportStates = new WeakMap<object, NativeTransportState>();

function constructNativeCredentialIsolatedAlpacaTransport(
  requestFunction: NativeRequestFunction,
): AlpacaTransport {
  const state: NativeTransportState = {
    activeRequest: undefined,
    activeDispatch: undefined,
    activeBodies: 0,
  };
  const transport: AlpacaTransport = Object.freeze({
    async dispatch(capability: AlpacaDispatchCapability): Promise<AlpacaTransportResponse> {
      const lease = resolveAlpacaDispatchCapability(capability);
      let authorizationHeaders: Readonly<Record<string, string>> | undefined;
      try {
        authorizationHeaders = Object.freeze({
          "APCA-API-KEY-ID": activeAuthorizationValue(lease.state.keyId, lease.state.active),
          "APCA-API-SECRET-KEY": activeAuthorizationValue(
            lease.state.secretKey,
            lease.state.active,
          ),
        });
        const dispatched = new Promise<IncomingMessage>((resolve, reject) => {
          const physical = requestFunction(lease.url, {
            method: "GET",
            headers: authorizationHeaders as Readonly<Record<string, string>>,
            signal: lease.request.signal,
          });
          state.activeRequest = physical;
          physical.once("response", resolve);
          physical.once("error", reject);
          physical.end();
        });
        state.activeDispatch = dispatched;
        const response = await dispatched;
        const declaredHeader = response.headers["content-length"];
        const declaredLength = Array.isArray(declaredHeader) ? null : (declaredHeader ?? null);
        const contentLength =
          declaredLength !== null && /^(?:0|[1-9][0-9]*)$/.test(declaredLength)
            ? Number(declaredLength)
            : null;
        state.activeBodies += 1;
        return Object.freeze({
          status: response.statusCode ?? 0,
          contentLength,
          retryAfter: Array.isArray(response.headers["retry-after"])
            ? null
            : (response.headers["retry-after"] ?? null),
          quotaClassification: "missing" as const,
          body: new NativeAlpacaResponseBody(response, () => {
            state.activeBodies -= 1;
          }),
          siblingResources: Object.freeze([]),
        });
      } finally {
        authorizationHeaders = undefined;
        revokeAuthorization(lease.state);
        state.activeRequest = undefined;
        state.activeDispatch = undefined;
      }
    },
    async abort(): Promise<void> {
      state.activeRequest?.destroy();
      state.activeRequest = undefined;
    },
    async settle(): Promise<void> {
      const active = state.activeDispatch;
      state.activeDispatch = undefined;
      try {
        await active;
      } catch {
        // The attempt boundary classifies dispatch failure.
      }
    },
  });
  nativeTransportStates.set(transport, state);
  credentialIsolatedTransports.add(transport);
  return transport;
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
  return constructNativeCredentialIsolatedAlpacaTransport(
    dispatchHttpsRequest as unknown as NativeRequestFunction,
  );
}

export function createTestNativeCredentialIsolatedAlpacaTransport(
  requestFunction: NativeRequestFunction,
): AlpacaTransport {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-native-alpaca-transport-unavailable");
  }
  return constructNativeCredentialIsolatedAlpacaTransport(requestFunction);
}

export function assertTestNativeAlpacaTransportReleased(transport: AlpacaTransport): void {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-native-alpaca-inspection-unavailable");
  }
  const state = nativeTransportStates.get(transport as object);
  if (
    state === undefined ||
    state.activeRequest !== undefined ||
    state.activeDispatch !== undefined ||
    state.activeBodies !== 0
  ) {
    throw new TypeError("native-alpaca-transport-owned-reference-retained");
  }
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
