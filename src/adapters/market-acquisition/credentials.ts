import {
  validateObservationLedgerBundle,
  type ObservationLedgerEntryV1,
} from "../../providers/observation-ledger.js";
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
import { type JournalEntry, type JournalIdentityInput, validateJournalEntries } from "./journal.js";
import { safeAcquisitionError, type SafeAcquisitionError } from "./redaction.js";
import type { ArtifactRetentionJournal } from "./retention/contracts.js";

export const ALPACA_KEY_ID_ENV = "PEAS_ALPACA_API_KEY_ID";
export const ALPACA_SECRET_KEY_ENV = "PEAS_ALPACA_API_SECRET_KEY";
export const RESERVED_FMP_KEY_ENV = "PEAS_FMP_API_KEY";

export type CredentialReadName = typeof ALPACA_KEY_ID_ENV | typeof ALPACA_SECRET_KEY_ENV;

export interface RuntimeSecretSource {
  read(name: CredentialReadName): unknown;
}

export type CredentialAuthorizationInput = Readonly<{
  plan: ValidatedMarketAcquisitionConfiguration;
  acquisitionObservationId: string;
  retrievalAttemptId: string;
  journalIdentity: JournalIdentityInput;
  journal: readonly JournalEntry[];
  ledger: readonly ObservationLedgerEntryV1[];
  retentionJournal: ArtifactRetentionJournal;
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

function validatePlan(plan: ValidatedMarketAcquisitionConfiguration): void {
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

export function establishCredentialAuthorizationEvidence(
  input: CredentialAuthorizationInput,
): CredentialAuthorizationEvidence {
  validatePlan(input.plan);
  if (input.retentionJournal.providerUseDenied("alpaca", input.journalIdentity.providerId)) {
    throw new TypeError("credential-retention-denied");
  }
  validateJournalEntries(input.journal, input.journalIdentity);
  const ledger = validateObservationLedgerBundle(input.ledger);
  const declaration = ledger.find(
    (entry) =>
      entry.facts.kind === "acquisition.declared" &&
      entry.facts.acquisitionObservationId === input.acquisitionObservationId,
  );
  if (
    declaration?.facts.kind !== "acquisition.declared" ||
    declaration.facts.provider !== "alpaca" ||
    declaration.facts.retrievalAttemptId !== input.retrievalAttemptId ||
    declaration.facts.sanitizedRequestIdentityHash !== input.plan.requestIdentityHash
  ) {
    throw new TypeError("credential-acquisition-identity-invalid");
  }
  const started = ledger.find(
    (entry) =>
      entry.facts.kind === "request.started" &&
      entry.facts.acquisitionObservationId === input.acquisitionObservationId &&
      entry.parentEntryIds.includes(declaration.entryId),
  );
  const latest = input.journal.at(-1);
  if (
    started === undefined ||
    latest?.checkpointKind !== "request-started" ||
    latest.requestIdentityHash !== input.plan.requestIdentityHash ||
    latest.acquisitionConfigurationHash !== input.plan.acquisitionConfigurationHash ||
    latest.acquisitionObservationId !== input.acquisitionObservationId ||
    latest.retrievalAttemptId !== input.retrievalAttemptId ||
    latest.stageLedgerFactId !== started.entryId ||
    !latest.causalParentFactIds.includes(declaration.entryId)
  ) {
    throw new TypeError("credential-request-started-evidence-invalid");
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

export function authorizeCredentialLoad(
  evidence: CredentialAuthorizationEvidence,
): CredentialPreflightPermit {
  const binding = establishedEvidence.get(evidence);
  if (binding === undefined) throw new TypeError("credential-evidence-capability-invalid");
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
  let keyId: unknown;
  let secretKey: unknown;
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
    const capability = Object.freeze({ kind: "p1-10-alpaca-dispatch-capability" as const });
    issuedDispatchCapabilities.set(capability, Object.freeze({ ...binding, headers }));
    return { ok: true, value: await operation(capability) };
  } catch {
    return credentialUnavailable();
  } finally {
    keyId = undefined;
    secretKey = undefined;
  }
}

export function resolveAlpacaDispatchCapability(
  capability: AlpacaDispatchCapability,
  plan: ValidatedMarketAcquisitionConfiguration,
): AlpacaAuthorizationHeaders {
  const binding = issuedDispatchCapabilities.get(capability);
  if (
    binding === undefined ||
    binding.plan !== plan ||
    binding.plan.requestIdentityHash !== plan.requestIdentityHash ||
    binding.plan.acquisitionConfigurationHash !== plan.acquisitionConfigurationHash
  ) {
    throw new TypeError("alpaca-dispatch-capability-invalid");
  }
  return binding.headers;
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
