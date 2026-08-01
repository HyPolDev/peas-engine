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
  AlpacaTransportRequest,
  AlpacaTransportResponse,
} from "./alpaca/contracts.js";

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

type DispatchBinding = PermitBinding & Readonly<{ headers: AlpacaAuthorizationHeaders }>;

const issuedPermits = new WeakMap<object, PermitBinding>();
const issuedDispatchCapabilities = new WeakMap<object, DispatchBinding>();
const establishedEvidence = new WeakMap<object, PermitBinding>();
const credentialIsolatedTransports = new WeakSet<object>();

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

  constructor(journal: AcquisitionJournal, retentionJournal: ArtifactRetentionJournal) {
    this.#journal = journal;
    this.#retentionJournal = retentionJournal;
  }

  async establish(input: CredentialAuthorizationRequest): Promise<CredentialAuthorizationEvidence> {
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
    const latest = journal.at(-1);
    if (
      latest?.checkpointKind !== "request-started" ||
      latest.requestIdentityHash !== input.plan.requestIdentityHash ||
      latest.acquisitionConfigurationHash !== input.plan.acquisitionConfigurationHash ||
      latest.acquisitionObservationId !== input.acquisitionObservationId ||
      latest.retrievalAttemptId !== input.retrievalAttemptId ||
      latest.stageLedgerFactId === null ||
      latest.causalParentFactIds.length !== 1
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
    const headers = Object.freeze({
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secretKey,
    });
    capability = Object.freeze({ kind: "p1-10-alpaca-dispatch-capability" as const });
    issuedDispatchCapabilities.set(capability, Object.freeze({ ...binding, headers }));
    return { ok: true, value: await operation(capability) };
  } catch {
    return credentialUnavailable();
  } finally {
    if (capability !== undefined) issuedDispatchCapabilities.delete(capability);
    keyId = undefined;
    secretKey = undefined;
  }
}

function resolveAlpacaDispatchCapability(
  capability: AlpacaDispatchCapability,
  request: AlpacaTransportRequest,
): AlpacaAuthorizationHeaders {
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
  return binding.headers;
}

export type AlpacaCredentialIsolatedTransportDriver = Readonly<{
  dispatch(request: AlpacaTransportRequest): Promise<AlpacaTransportResponse>;
  abort(): Promise<void>;
  settle(): Promise<void>;
}>;

/**
 * Owns authorization consumption. The lower driver sees only the frozen non-secret request; the
 * exact frozen header record is validated and retained only inside this module for the capability
 * callback lifetime.
 */
export function createCredentialIsolatedAlpacaTransport(
  driver: AlpacaCredentialIsolatedTransportDriver,
): AlpacaTransport {
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
      const headers = resolveAlpacaDispatchCapability(authorization, request);
      if (
        !Object.isFrozen(headers) ||
        Object.keys(headers).length !== 2 ||
        headers["APCA-API-KEY-ID"].length === 0 ||
        headers["APCA-API-SECRET-KEY"].length === 0
      ) {
        throw new TypeError("alpaca-authorization-record-invalid");
      }
      return dispatch(request);
    },
    abort,
    settle,
  });
  credentialIsolatedTransports.add(transport);
  return transport;
}

export function assertCredentialIsolatedAlpacaTransport(value: AlpacaTransport): void {
  if (!credentialIsolatedTransports.has(value)) {
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
