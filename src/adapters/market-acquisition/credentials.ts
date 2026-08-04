import {
  ACCEPTED_PR_2E_CANDIDATE_SHA,
  AUTHORIZATION_MODE,
  MARKET_ACQUISITION_LIMITS,
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
  GENESIS_HASH,
  NO_TOKEN_HASH,
  TERMINAL_TOKEN_HASH,
  type JournalCheckpointBody,
  type JournalIdentityInput,
  createJournalEntry,
  deriveLogicalPageIdentityHash,
  deriveMarketAcquisitionJournalId,
  derivePrivateTokenHash,
  journalEntryBody,
  validateJournalEntries,
} from "./journal.js";
import { deriveAcquisitionObservationId } from "../../providers/observation-ledger.js";
import { safeAcquisitionError, type SafeAcquisitionError } from "./redaction.js";
import type { ArtifactRetentionJournal } from "./retention/contracts.js";
import type {
  AlpacaTransport,
  AlpacaBodyRead,
  AlpacaTransportRequest,
  AlpacaTransportResponse,
  AlpacaDeadlineHandle,
} from "./alpaca/contracts.js";
import { assertOwnedAcquisitionJournal, assertOwnedRetentionJournal } from "./owned-journal.js";
import { MarketAcquisitionLedger, validateJournalLedgerBindings } from "./artifact-integration.js";
import { P1_10_TEST_AUTHORITY } from "../../internal-test-authority.js";
import { P1_10_PROVISIONING_AUTHORITY } from "../../internal-provisioning-authority.js";
import { request as dispatchHttpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { performance } from "node:perf_hooks";
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { assertOwnedAlpacaTransportRequest } from "./alpaca/request.js";
import { canonicalHash } from "../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../core/json.js";
import {
  applyMigrations,
  openSqliteDatabase,
  protectSqliteDatabasePath,
  type Migration,
  type SqliteDatabase,
} from "../sqlite/database.js";
import { artifactRuntimePaths, configuredPeasRuntimeRoot } from "../artifacts/runtime-root.js";
import { createSqliteArtifactRetentionJournal } from "./retention/sqlite-journal.js";
import { createSqliteAcquisitionJournal, type SqliteAcquisitionJournal } from "./sqlite-journal.js";
import { AlpacaDeadlineElapsed } from "./alpaca/deadline.js";
import type { AcquisitionMachineSnapshot, AcquisitionTransitionPlan } from "./state-machine.js";

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
  attemptBudgetMs: number;
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
  attemptBudgetMs: number;
  attemptAdmittedAtMs: number;
  credentialUseDeadlineMs: number;
  request?: AlpacaTransportRequest;
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
    deadline: AlpacaDeadlineHandle;
  }>;

const issuedPermits = new WeakMap<object, PermitBinding>();
const issuedDispatchCapabilities = new WeakMap<object, DispatchBinding>();
const establishedEvidence = new WeakMap<object, PermitBinding>();
const credentialIsolatedTransports = new WeakSet<object>();
const credentialAuthorizationBoundaries = new WeakSet<object>();
const productionCredentialDatabases = new WeakMap<object, readonly SqliteDatabase[]>();
const productionCredentialPlans = new WeakMap<object, ValidatedMarketAcquisitionConfiguration>();
const ownedLiveCredentialDatabases = new WeakSet<object>();
const ownedLiveAcquisitionJournals = new WeakSet<object>();
const ownedLiveJournalBoundaries = new WeakMap<object, DurableCredentialAuthorizationBoundary>();
type CredentialWorkflowSeedBinding = Readonly<{
  journal: AcquisitionJournal;
  ledgerEntries: readonly import("../../providers/observation-ledger.js").ObservationLedgerEntryV1[];
  journalEntries: readonly import("./journal.js").JournalEntry[];
}>;
const credentialWorkflowSeeds = new WeakMap<object, CredentialWorkflowSeedBinding>();
const CREDENTIAL_BOUNDARY_CONSTRUCTION_AUTHORITY = Object.freeze({});
const LIVE_CREDENTIAL_DATABASE_FILENAME = "market-acquisition-authority.sqlite";
const LIVE_CREDENTIAL_ANCHOR_DATABASE_FILENAME = "market-acquisition-authority-anchor.sqlite";
const LIVE_CREDENTIAL_MIGRATIONS_HASH =
  "f2b2e8dd83f716c5bdb8ce79d314e12b9319e5867c451b76f369ac3de1f39f47";
let liveCredentialBoundaryOpened = false;
const trustedTimeOriginMs = performance.timeOrigin;
const trustedMonotonicNowMs = performance.now.bind(performance);
const trustedSystemNowMs = (): number => Math.trunc(trustedTimeOriginMs + trustedMonotonicNowMs());
const TEST_ONLY_UNBOUNDED_DEADLINE: AlpacaDeadlineHandle = Object.freeze({
  expired: new Promise<void>(() => {}),
  assertRemaining(): void {
    if (P1_10_TEST_AUTHORITY === undefined) {
      throw new TypeError("alpaca-deadline-required");
    }
  },
  cancel(): void {},
  async settle(): Promise<void> {},
});

function liveCredentialAuthorityPaths(
  databaseDirectory: string,
): Readonly<{ database: string; anchor: string }> {
  return Object.freeze({
    database: join(databaseDirectory, LIVE_CREDENTIAL_DATABASE_FILENAME),
    anchor: join(databaseDirectory, LIVE_CREDENTIAL_ANCHOR_DATABASE_FILENAME),
  });
}

function filesystemEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertLiveCredentialMigrations(migrations: readonly Migration[]): void {
  if (
    canonicalHash(
      "peas/market-acquisition-live-migrations/v1",
      migrations as unknown as JsonValue,
    ) !== LIVE_CREDENTIAL_MIGRATIONS_HASH
  ) {
    throw new TypeError("live-credential-migrations-invalid");
  }
}

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
  readonly #journal: AcquisitionJournal | undefined;
  readonly #retentionJournal: Pick<ArtifactRetentionJournal, "providerUseDenied">;
  readonly #productionStore: ProductionCredentialStore | undefined;

  constructor(
    journal: AcquisitionJournal | undefined,
    retentionJournal: Pick<ArtifactRetentionJournal, "providerUseDenied">,
    productionStore?: ProductionCredentialStore,
    authority?: object,
  ) {
    if (journal !== undefined) assertOwnedAcquisitionJournal(journal);
    if (authority !== CREDENTIAL_BOUNDARY_CONSTRUCTION_AUTHORITY) {
      assertOwnedRetentionJournal(retentionJournal as ArtifactRetentionJournal);
    }
    this.#journal = journal;
    this.#retentionJournal = retentionJournal;
    this.#productionStore = productionStore;
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
    if (this.#productionStore !== undefined) {
      const binding = await this.#productionStore.admit(input);
      const evidence = Object.freeze({
        kind: "p1-10-durable-credential-evidence" as const,
      });
      establishedEvidence.set(evidence, binding);
      return evidence;
    }
    if (this.#journal === undefined) throw new TypeError("credential-journal-unavailable");
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
    const attemptAdmittedAtMs = trustedSystemNowMs();
    establishedEvidence.set(
      evidence,
      Object.freeze({
        plan: input.plan,
        acquisitionObservationId: input.acquisitionObservationId,
        retrievalAttemptId: input.retrievalAttemptId,
        attemptBudgetMs: MARKET_ACQUISITION_LIMITS.attemptDeadlineMs,
        attemptAdmittedAtMs,
        credentialUseDeadlineMs: attemptAdmittedAtMs + MARKET_ACQUISITION_LIMITS.attemptDeadlineMs,
      }),
    );
    return evidence;
  }

  close(): void {
    assertOwnedDurableCredentialAuthorizationBoundary(this);
    const databases = productionCredentialDatabases.get(this);
    if (databases === undefined) throw new TypeError("production-credential-root-required");
    productionCredentialDatabases.delete(this);
    productionCredentialPlans.delete(this);
    for (const database of databases) database.close();
  }
}

function constructCredentialAuthorizationBoundary(
  journal: AcquisitionJournal,
  retentionJournal: ArtifactRetentionJournal,
): DurableCredentialAuthorizationBoundary {
  const boundary = new DurableCredentialAuthorizationBoundary(
    journal,
    retentionJournal,
    undefined,
    CREDENTIAL_BOUNDARY_CONSTRUCTION_AUTHORITY,
  );
  Object.freeze(boundary);
  return boundary;
}

function exactJournalIdentity(plan: ValidatedMarketAcquisitionConfiguration): JournalIdentityInput {
  return Object.freeze({
    schemaVersion: 1,
    requestIdentityHash: plan.requestIdentityHash,
    providerId: plan.route.providerId,
    datasetId: plan.route.datasetId,
    feedId: plan.route.feedId,
    endpointChannelId: plan.route.endpointChannelId,
  });
}

type OwnedAttemptIdentity = Readonly<{
  acquisitionObservationId: string;
  retrievalAttemptId: string;
}>;

function deriveRequestStartedWorkflow(
  input: CredentialAuthorizationRequest,
  ownedAttempt: OwnedAttemptIdentity,
) {
  validatePlan(input.plan);
  const identity = exactJournalIdentity(input.plan);
  const journalId = deriveMarketAcquisitionJournalId(identity);
  if (
    input.marketAcquisitionJournalId !== journalId ||
    JSON.stringify(input.journalIdentity) !== JSON.stringify(identity)
  ) {
    throw new TypeError("credential-request-started-workflow-invalid");
  }
  const { acquisitionObservationId, retrievalAttemptId } = ownedAttempt;
  if (
    acquisitionObservationId !==
    deriveAcquisitionObservationId({
      provider: "alpaca",
      retrievalAttemptId,
      sanitizedRequestIdentityHash: input.plan.requestIdentityHash,
      routeLabel: input.plan.route.safeRouteLabel,
    })
  ) {
    throw new TypeError("credential-request-started-workflow-invalid");
  }
  const clock = input.plan.trustedClockEvidence;
  const ledger = new MarketAcquisitionLedger(
    `market-acquisition:${journalId}:${retrievalAttemptId}`,
    {
      clockBasisId: clock.basisId,
      wallClock: clock.wallClock,
      synchronization: clock.synchronization,
      maximumErrorMs: Number((clock.maximumErrorNs + 999_999n) / 1_000_000n),
      monotonicClock: clock.monotonicClock,
      monotonicSessionId: clock.monotonicSessionId,
    },
  );
  const stamp = (sample: typeof clock.currentSample) => ({
    clockBasisId: clock.basisId,
    wallTimeMs: Number(sample.wallNs / 1_000_000n),
    monotonicTimeUs: Number(sample.monotonicUs),
  });
  const declaration = ledger.declareAcquisition(
    {
      kind: "acquisition.declared",
      acquisitionObservationId,
      provider: "alpaca",
      retrievalAttemptId,
      sanitizedRequestIdentityHash: input.plan.requestIdentityHash,
      routeLabel: input.plan.route.safeRouteLabel,
    },
    stamp(clock.priorSample),
  );
  const started = ledger.requestStarted(
    declaration,
    { kind: "request.started", acquisitionObservationId },
    stamp(clock.currentSample),
  );
  const memberHash = canonicalHash("peas/market-acquisition-owned-workflow/v1", {
    journalId,
    acquisitionObservationId,
    retrievalAttemptId,
  });
  const logicalPageIdentityHash = deriveLogicalPageIdentityHash({
    requestIdentityHash: input.plan.requestIdentityHash,
    pageOrdinal: 0,
    currentTokenHash: NO_TOKEN_HASH,
  });
  const body = (stageLedgerFactId: string, causalParentFactIds: readonly string[]) =>
    Object.freeze({
      schemaVersion: 1 as const,
      runSessionNonce: `owned-${memberHash}`,
      acquisitionObservationId,
      marketAcquisitionId: `maq1_${memberHash}`,
      admittedMarketAcquisitionIds: Object.freeze([]),
      requestIdentityHash: input.plan.requestIdentityHash,
      acquisitionConfigurationHash: input.plan.acquisitionConfigurationHash,
      providerId: identity.providerId,
      datasetId: identity.datasetId,
      feedId: identity.feedId,
      endpointChannelId: identity.endpointChannelId,
      authorizationMode: AUTHORIZATION_MODE,
      logicalPageIdentityHash,
      pageOrdinal: 0,
      currentTokenHash: NO_TOKEN_HASH,
      currentResumableTokenMaterial: null,
      nextTokenHash: null,
      nextResumableTokenMaterial: null,
      currentContinuationBindingHash: null,
      nextContinuationBindingHash: null,
      attemptId: `mat1_${memberHash}`,
      retrievalAttemptId,
      attemptOrdinal: 0,
      artifactObservationId: null,
      artifactDigest: null,
      artifactSizeBytes: null,
      artifactObservationHash: null,
      artifactContentId: null,
      rawArtifactId: null,
      stageLedgerFactId,
      causalParentFactIds: Object.freeze([...causalParentFactIds]),
      pageRecordCount: null,
      pageNormalizedFactCount: null,
      pageChainHash: GENESIS_HASH,
      cumulativeSuccessfulPages: 0,
      cumulativeVerifiedBytes: 0,
      cumulativeRecords: 0,
      cumulativeNormalizedFacts: 0,
      cumulativeAttempts: 0,
      acquisitionDeadlineBasis: "offline-monotonic-basis-v1",
      quotaWindowEvidence: Object.freeze([]),
      terminalState: null,
      terminalReasonCode: null,
      incomplete: true,
    }) satisfies JournalCheckpointBody;
  const causal = (entry: typeof declaration) =>
    entry.parentEntryIds.filter((id) => id !== ledger.clockDeclaration.entryId);
  const declared = createJournalEntry(
    null,
    journalId,
    "acquisition-declared",
    body(declaration.entryId, causal(declaration)),
  );
  const requestStarted = createJournalEntry(
    declared,
    journalId,
    "request-started",
    body(started.entryId, causal(started)),
  );
  const journalEntries = Object.freeze([declared, requestStarted]);
  const workflowId = canonicalHash("peas/market-acquisition-owned-request-started/v1", {
    journalId,
    requestIdentityHash: input.plan.requestIdentityHash,
    retrievalAttemptId,
    acquisitionObservationId,
    journalEntries,
    ledgerEntries: ledger.entries,
  } as unknown as JsonValue);
  return Object.freeze({
    identity,
    journalId,
    workflowId,
    ledgerEntries: ledger.entries,
    journalEntries,
  });
}

type ProductionCredentialStore = Readonly<{
  admit(input: CredentialAuthorizationRequest): Promise<PermitBinding>;
}>;

type AttemptClaimRow = Readonly<{
  request_identity_hash: string;
  acquisition_configuration_hash: string;
  acquisition_started_ms: bigint;
  attempt_started_ms: bigint;
  attempt_ordinal: bigint;
}>;

const OWNED_ADMISSION_SCHEMA_OBJECTS = Object.freeze([
  "market_acquisition_owned_attempt_claims",
  "market_acquisition_owned_attempt_claims_acquisition",
  "market_acquisition_owned_attempt_claims_no_delete",
  "market_acquisition_owned_attempt_claims_no_update",
  "market_acquisition_owned_attempt_claims_rate_window",
  "market_acquisition_owned_request_started",
  "market_acquisition_owned_request_started_no_delete",
  "market_acquisition_owned_request_started_no_update",
  "market_acquisition_owned_state_transitions",
  "market_acquisition_owned_state_transitions_no_delete",
  "market_acquisition_owned_state_transitions_no_update",
  "market_acquisition_owned_transition_journal_links",
  "market_acquisition_owned_transition_journal_links_no_delete",
  "market_acquisition_owned_transition_journal_links_no_update",
] as const);
const OWNED_ADMISSION_SCHEMA_HASH =
  "5c045d52587b1bb0e56dda7dfaeacb5838395eab0d0b7f18ae9712fb24d99f98";
const CREDENTIAL_ANCHOR_SCHEMA_SQL = `
  CREATE TABLE credential_anchor.credential_authority_anchor_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    authority_namespace TEXT NOT NULL,
    runtime_root TEXT NOT NULL
  ) STRICT;

  CREATE TABLE credential_anchor.credential_authority_attempt_claims (
    workflow_id TEXT PRIMARY KEY,
    acquisition_id TEXT NOT NULL,
    request_identity_hash TEXT NOT NULL,
    acquisition_configuration_hash TEXT NOT NULL,
    acquisition_started_ms INTEGER NOT NULL CHECK (acquisition_started_ms >= 0),
    attempt_started_ms INTEGER NOT NULL CHECK (attempt_started_ms >= acquisition_started_ms),
    attempt_ordinal INTEGER NOT NULL CHECK (attempt_ordinal >= 0 AND attempt_ordinal < 48),
    attempt_budget_ms INTEGER NOT NULL CHECK (attempt_budget_ms >= 1 AND attempt_budget_ms <= 30000),
    retrieval_attempt_id TEXT NOT NULL UNIQUE,
    acquisition_observation_id TEXT NOT NULL UNIQUE,
    UNIQUE (acquisition_id, attempt_ordinal)
  ) STRICT;

  CREATE INDEX credential_anchor.credential_authority_attempt_claims_rate_window
  ON credential_authority_attempt_claims (attempt_started_ms);

  CREATE TRIGGER credential_anchor.credential_authority_attempt_claims_no_update
  BEFORE UPDATE ON credential_authority_attempt_claims
  BEGIN SELECT RAISE(ABORT, 'credential authority anchor is immutable'); END;

  CREATE TRIGGER credential_anchor.credential_authority_attempt_claims_no_delete
  BEFORE DELETE ON credential_authority_attempt_claims
  BEGIN SELECT RAISE(ABORT, 'credential authority anchor is immutable'); END;

  CREATE TRIGGER credential_anchor.credential_authority_anchor_metadata_no_update
  BEFORE UPDATE ON credential_authority_anchor_metadata
  BEGIN SELECT RAISE(ABORT, 'credential authority anchor metadata is immutable'); END;

  CREATE TRIGGER credential_anchor.credential_authority_anchor_metadata_no_delete
  BEFORE DELETE ON credential_authority_anchor_metadata
  BEGIN SELECT RAISE(ABORT, 'credential authority anchor metadata is immutable'); END;
`;
const CREDENTIAL_ANCHOR_SCHEMA_OBJECTS = Object.freeze([
  "credential_authority_anchor_metadata",
  "credential_authority_anchor_metadata_no_delete",
  "credential_authority_anchor_metadata_no_update",
  "credential_authority_attempt_claims",
  "credential_authority_attempt_claims_no_delete",
  "credential_authority_attempt_claims_no_update",
  "credential_authority_attempt_claims_rate_window",
] as const);
const CREDENTIAL_ANCHOR_SCHEMA_HASH =
  "be14a9c0fa7c5ea9e2b8d9b98d8e786a615d497f15aa36ad6ecac977a5623522";

function assertOwnedAdmissionSchema(database: SqliteDatabase): void {
  const rows = database
    .prepare(`SELECT name, type, sql FROM sqlite_schema
      WHERE name LIKE 'market_acquisition_owned_%'
      ORDER BY name`)
    .all() as Array<{
    name: string;
    type: string;
    sql: string | null;
  }>;
  if (
    rows.length !== OWNED_ADMISSION_SCHEMA_OBJECTS.length ||
    rows.some((row, index) => row.name !== OWNED_ADMISSION_SCHEMA_OBJECTS[index]) ||
    canonicalHash(
      "peas/market-acquisition-owned-admission-schema/v1",
      rows as unknown as JsonValue,
    ) !== OWNED_ADMISSION_SCHEMA_HASH
  ) {
    throw new TypeError("credential-admission-schema-invalid");
  }
}

function credentialAuthorityNamespace(databaseFilename: string): string {
  return canonicalHash("peas/market-acquisition-authority-namespace/v1", {
    databaseFilename: realpathSync(dirname(databaseFilename)),
  });
}

function anchorSchemaRows(database: SqliteDatabase): Array<{
  name: string;
  type: string;
  sql: string | null;
}> {
  return database
    .prepare(`SELECT name, type, sql FROM credential_anchor.sqlite_schema
      WHERE name LIKE 'credential_authority_%'
      ORDER BY name`)
    .all() as Array<{ name: string; type: string; sql: string | null }>;
}

function assertCredentialAuthorityAnchorSchema(database: SqliteDatabase): void {
  const rows = anchorSchemaRows(database);
  if (
    rows.length !== CREDENTIAL_ANCHOR_SCHEMA_OBJECTS.length ||
    rows.some((row, index) => row.name !== CREDENTIAL_ANCHOR_SCHEMA_OBJECTS[index]) ||
    canonicalHash(
      "peas/market-acquisition-authority-anchor-schema/v1",
      rows as unknown as JsonValue,
    ) !== CREDENTIAL_ANCHOR_SCHEMA_HASH
  ) {
    throw new TypeError("credential-admission-anchor-schema-invalid");
  }
}

function assertCredentialAuthorityAnchorState(
  database: SqliteDatabase,
  authorityNamespace: string,
  runtimeRoot: string,
): number {
  assertOwnedAdmissionSchema(database);
  assertCredentialAuthorityAnchorSchema(database);
  const metadata = database
    .prepare(`SELECT schema_version, authority_namespace, runtime_root
      FROM credential_anchor.credential_authority_anchor_metadata WHERE singleton = 1`)
    .get() as
    | { schema_version: bigint; authority_namespace: string; runtime_root: string }
    | undefined;
  if (metadata?.schema_version !== 1n || metadata.authority_namespace !== authorityNamespace) {
    throw new TypeError("credential-admission-anchor-state-invalid");
  }
  if (metadata.runtime_root !== runtimeRoot) {
    throw new TypeError("credential-authority-runtime-root-mismatch");
  }
  const mismatch = database
    .prepare(`SELECT
      (SELECT COUNT(*) FROM market_acquisition_owned_attempt_claims) AS primary_count,
      (SELECT COUNT(*) FROM credential_anchor.credential_authority_attempt_claims) AS anchor_count,
      (SELECT COUNT(*) FROM market_acquisition_owned_attempt_claims AS primary_claim
        LEFT JOIN credential_anchor.credential_authority_attempt_claims AS anchor_claim
          ON anchor_claim.workflow_id = primary_claim.workflow_id
        WHERE anchor_claim.workflow_id IS NULL
          OR anchor_claim.acquisition_id <> primary_claim.acquisition_id
          OR anchor_claim.request_identity_hash <> primary_claim.request_identity_hash
          OR anchor_claim.acquisition_configuration_hash <>
            primary_claim.acquisition_configuration_hash
          OR anchor_claim.acquisition_started_ms <> primary_claim.acquisition_started_ms
          OR anchor_claim.attempt_started_ms <> primary_claim.attempt_started_ms
          OR anchor_claim.attempt_ordinal <> primary_claim.attempt_ordinal
          OR anchor_claim.attempt_budget_ms <> primary_claim.attempt_budget_ms
          OR anchor_claim.retrieval_attempt_id <> primary_claim.retrieval_attempt_id
          OR anchor_claim.acquisition_observation_id <>
            primary_claim.acquisition_observation_id) AS differing_count`)
    .get() as { primary_count: bigint; anchor_count: bigint; differing_count: bigint };
  if (
    mismatch.primary_count !== mismatch.anchor_count ||
    mismatch.differing_count !== 0n ||
    mismatch.primary_count < 0n ||
    mismatch.primary_count > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new TypeError("credential-admission-state-invalid");
  }
  return Number(mismatch.primary_count);
}

function attachCredentialAuthorityAnchor(
  database: SqliteDatabase,
  databaseFilename: string,
  anchorFilename: string,
  runtimeRoot: string,
  mode: "open-existing" | "provision-empty",
): string {
  database.prepare("ATTACH DATABASE ? AS credential_anchor").run(anchorFilename);
  database.pragma("credential_anchor.synchronous = FULL");
  database.pragma("credential_anchor.journal_mode = DELETE");
  const authorityNamespace = credentialAuthorityNamespace(databaseFilename);
  const existing = anchorSchemaRows(database);
  if (mode === "provision-empty") {
    const primaryState = database
      .prepare(`SELECT
        (SELECT COUNT(*) FROM market_acquisition_owned_request_started) AS request_count,
        (SELECT COUNT(*) FROM market_acquisition_owned_attempt_claims) AS claim_count`)
      .get() as { request_count: bigint; claim_count: bigint };
    if (
      existing.length !== 0 ||
      primaryState.request_count !== 0n ||
      primaryState.claim_count !== 0n
    ) {
      throw new TypeError("credential-authority-provisioning-layout-not-empty");
    }
    database
      .transaction(() => {
        assertOwnedAdmissionSchema(database);
        database.exec(CREDENTIAL_ANCHOR_SCHEMA_SQL);
        database
          .prepare(`INSERT INTO credential_anchor.credential_authority_anchor_metadata (
            singleton, schema_version, authority_namespace, runtime_root
          ) VALUES (1, 1, ?, ?)`)
          .run(authorityNamespace, runtimeRoot);
      })
      .immediate();
  } else if (existing.length === 0) {
    throw new TypeError("credential-authority-anchor-missing");
  }
  assertCredentialAuthorityAnchorState(database, authorityNamespace, runtimeRoot);
  return authorityNamespace;
}

class CredentialAdmissionDenied extends Error {
  readonly reason:
    | "acquisition-deadline"
    | "attempt-budget-exhausted"
    | "clock-regression"
    | "quota-exhausted";

  constructor(reason: CredentialAdmissionDenied["reason"]) {
    super(`credential-${reason}`);
    this.reason = reason;
  }
}

export type CredentialAttemptAdmissionPlan =
  | Readonly<{ kind: "admit"; attemptOrdinal: number; attemptBudgetMs: number }>
  | Readonly<{
      kind: "stop";
      reason:
        | "acquisition-deadline"
        | "attempt-budget-exhausted"
        | "clock-regression"
        | "quota-exhausted";
    }>;

/** Pure planner only; durable production authority remains inside the owned SQLite transaction. */
export function planCredentialAttemptAdmission(
  input: Readonly<{
    nowMs: number;
    acquisitionStartedMs: number | null;
    lastAttemptStartedMs: number | null;
    attemptsStarted: number;
    rollingProjectAttempts: number;
  }>,
): CredentialAttemptAdmissionPlan {
  for (const value of [input.nowMs, input.attemptsStarted, input.rollingProjectAttempts]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("credential-admission-input-invalid");
    }
  }
  if (
    (input.acquisitionStartedMs === null) !== (input.lastAttemptStartedMs === null) ||
    (input.acquisitionStartedMs !== null &&
      (!Number.isSafeInteger(input.acquisitionStartedMs) || input.acquisitionStartedMs < 0)) ||
    (input.lastAttemptStartedMs !== null &&
      (!Number.isSafeInteger(input.lastAttemptStartedMs) || input.lastAttemptStartedMs < 0))
  ) {
    throw new RangeError("credential-admission-input-invalid");
  }
  const acquisitionStartedMs = input.acquisitionStartedMs ?? input.nowMs;
  const lastAttemptStartedMs = input.lastAttemptStartedMs ?? acquisitionStartedMs;
  if (input.nowMs < acquisitionStartedMs || input.nowMs < lastAttemptStartedMs) {
    return Object.freeze({ kind: "stop", reason: "clock-regression" });
  }
  const elapsedMs = input.nowMs - acquisitionStartedMs;
  if (elapsedMs >= MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs) {
    return Object.freeze({ kind: "stop", reason: "acquisition-deadline" });
  }
  if (input.attemptsStarted >= MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition) {
    return Object.freeze({ kind: "stop", reason: "attempt-budget-exhausted" });
  }
  if (input.rollingProjectAttempts >= MARKET_ACQUISITION_LIMITS.rateAttempts) {
    return Object.freeze({ kind: "stop", reason: "quota-exhausted" });
  }
  return Object.freeze({
    kind: "admit",
    attemptOrdinal: input.attemptsStarted,
    attemptBudgetMs: Math.min(
      MARKET_ACQUISITION_LIMITS.attemptDeadlineMs,
      MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs - elapsedMs,
    ),
  });
}

export function credentialAuthorizationDenialReason(
  error: unknown,
): CredentialAdmissionDenied["reason"] | null {
  return error instanceof CredentialAdmissionDenied ? error.reason : null;
}

function productionCredentialStore(
  database: SqliteDatabase,
  authorityNamespace: string,
  runtimeRoot: string,
  rootPlan: ValidatedMarketAcquisitionConfiguration,
): ProductionCredentialStore {
  const acquisitionId = `maa1_${canonicalHash("peas/market-acquisition-owned-admission/v1", {
    requestIdentityHash: rootPlan.requestIdentityHash,
    acquisitionConfigurationHash: rootPlan.acquisitionConfigurationHash,
    trustedRequestStartedAtNs: rootPlan.trustedRequestStartedAtNs.toString(),
    clockSampleId: rootPlan.trustedClockEvidence.currentSample.sampleId,
  })}`;
  let durableHighWatermark = assertCredentialAuthorityAnchorState(
    database,
    authorityNamespace,
    runtimeRoot,
  );
  return Object.freeze({
    async admit(input) {
      if (input.plan !== rootPlan) {
        throw new TypeError("credential-production-plan-mismatch");
      }
      const nowMs = trustedSystemNowMs();
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
        throw new CredentialAdmissionDenied("clock-regression");
      }
      return database
        .transaction(() => {
          const durableCount = assertCredentialAuthorityAnchorState(
            database,
            authorityNamespace,
            runtimeRoot,
          );
          if (!Number.isSafeInteger(durableCount) || durableCount < durableHighWatermark) {
            throw new TypeError("credential-admission-state-invalid");
          }
          const claims = database
            .prepare(`SELECT request_identity_hash, acquisition_configuration_hash,
              acquisition_started_ms, attempt_started_ms, attempt_ordinal
              FROM market_acquisition_owned_attempt_claims
              WHERE acquisition_id = ? ORDER BY attempt_ordinal`)
            .all(acquisitionId) as AttemptClaimRow[];
          if (
            claims.some(
              (claim, index) =>
                claim.request_identity_hash !== rootPlan.requestIdentityHash ||
                claim.acquisition_configuration_hash !== rootPlan.acquisitionConfigurationHash ||
                claim.attempt_ordinal !== BigInt(index) ||
                (index > 0 && claim.acquisition_started_ms !== claims[0]?.acquisition_started_ms),
            )
          ) {
            throw new TypeError("credential-admission-state-invalid");
          }
          const acquisitionStartedMs =
            claims.length === 0 ? nowMs : Number(claims[0]?.acquisition_started_ms);
          const lastAttemptStartedMs =
            claims.length === 0 ? acquisitionStartedMs : Number(claims.at(-1)?.attempt_started_ms);
          const rolling = database
            .prepare(`SELECT COUNT(CASE WHEN attempt_started_ms > ? THEN 1 END) AS count,
              MAX(attempt_started_ms) AS latest
              FROM market_acquisition_owned_attempt_claims`)
            .get(nowMs - MARKET_ACQUISITION_LIMITS.rateWindowMs) as {
            count: bigint;
            latest: bigint | null;
          };
          if (rolling.latest !== null && rolling.latest > BigInt(nowMs)) {
            throw new CredentialAdmissionDenied("clock-regression");
          }
          const admission = planCredentialAttemptAdmission({
            nowMs,
            acquisitionStartedMs: claims.length === 0 ? null : acquisitionStartedMs,
            lastAttemptStartedMs: claims.length === 0 ? null : lastAttemptStartedMs,
            attemptsStarted: claims.length,
            rollingProjectAttempts: Number(rolling.count),
          });
          if (admission.kind === "stop") throw new CredentialAdmissionDenied(admission.reason);
          const { attemptOrdinal, attemptBudgetMs } = admission;
          const retrievalAttemptId = `rat1_${canonicalHash(
            "peas/market-acquisition-owned-retrieval-attempt/v1",
            { acquisitionId, attemptOrdinal, attemptStartedMs: nowMs },
          )}`;
          const acquisitionObservationId = deriveAcquisitionObservationId({
            provider: "alpaca",
            retrievalAttemptId,
            sanitizedRequestIdentityHash: rootPlan.requestIdentityHash,
            routeLabel: rootPlan.route.safeRouteLabel,
          });
          const value = deriveRequestStartedWorkflow(input, {
            retrievalAttemptId,
            acquisitionObservationId,
          });
          const journalJson = canonicalJson(value.journalEntries as unknown as JsonValue);
          const ledgerJson = canonicalJson(value.ledgerEntries as unknown as JsonValue);
          database
            .prepare(`INSERT INTO market_acquisition_owned_request_started (
              workflow_id, request_identity_hash, retrieval_attempt_id, acquisition_observation_id,
              journal_json, ledger_json, workflow_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(
              value.workflowId,
              value.identity.requestIdentityHash,
              value.journalEntries[1]?.retrievalAttemptId,
              value.journalEntries[1]?.acquisitionObservationId,
              journalJson,
              ledgerJson,
              value.workflowId,
            );
          database
            .prepare(`INSERT INTO market_acquisition_owned_attempt_claims (
              workflow_id, acquisition_id, request_identity_hash,
              acquisition_configuration_hash, acquisition_started_ms, attempt_started_ms,
              attempt_ordinal, attempt_budget_ms, retrieval_attempt_id,
              acquisition_observation_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
              value.workflowId,
              acquisitionId,
              rootPlan.requestIdentityHash,
              rootPlan.acquisitionConfigurationHash,
              acquisitionStartedMs,
              nowMs,
              attemptOrdinal,
              attemptBudgetMs,
              retrievalAttemptId,
              acquisitionObservationId,
            );
          database
            .prepare(`INSERT INTO credential_anchor.credential_authority_attempt_claims (
              workflow_id, acquisition_id, request_identity_hash,
              acquisition_configuration_hash, acquisition_started_ms, attempt_started_ms,
              attempt_ordinal, attempt_budget_ms, retrieval_attempt_id,
              acquisition_observation_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
              value.workflowId,
              acquisitionId,
              rootPlan.requestIdentityHash,
              rootPlan.acquisitionConfigurationHash,
              acquisitionStartedMs,
              nowMs,
              attemptOrdinal,
              attemptBudgetMs,
              retrievalAttemptId,
              acquisitionObservationId,
            );
          durableHighWatermark = durableCount + 1;
          return Object.freeze({
            plan: rootPlan,
            acquisitionObservationId,
            retrievalAttemptId,
            attemptBudgetMs,
            attemptAdmittedAtMs: nowMs,
            credentialUseDeadlineMs: nowMs + attemptBudgetMs,
          });
        })
        .immediate();
    },
  });
}

function openCredentialAuthorizationBoundaryAtPath(
  filename: string,
  anchorFilename: string,
  migrations: readonly Migration[],
  plan: ValidatedMarketAcquisitionConfiguration,
): DurableCredentialAuthorizationBoundary {
  const primaryExisted = existsSync(filename);
  const anchorExisted = existsSync(anchorFilename);
  if (!primaryExisted && anchorExisted) {
    throw new TypeError("credential-authority-layout-corrupt");
  }
  const database = openSqliteDatabase(filename, migrations);
  try {
    database.pragma("journal_mode = DELETE");
    const runtimeRoot = realpathSync(dirname(filename));
    const authorityNamespace = attachCredentialAuthorityAnchor(
      database,
      filename,
      anchorFilename,
      runtimeRoot,
      anchorExisted ? "open-existing" : "provision-empty",
    );
    const retention = createSqliteArtifactRetentionJournal(database);
    const store = productionCredentialStore(database, authorityNamespace, runtimeRoot, plan);
    const boundary = new DurableCredentialAuthorizationBoundary(
      undefined,
      retention,
      store,
      CREDENTIAL_BOUNDARY_CONSTRUCTION_AUTHORITY,
    );
    credentialAuthorizationBoundaries.add(boundary);
    Object.freeze(boundary);
    productionCredentialDatabases.set(boundary, Object.freeze([database]));
    productionCredentialPlans.set(boundary, plan);
    return boundary;
  } catch (error) {
    database.close();
    throw error;
  }
}

class LiveCredentialRetentionGuard {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
    Object.freeze(this);
  }

  providerUseDenied(lane: "alpaca" | "fmp", providerId: string): boolean {
    return (
      this.#database
        .prepare(`SELECT 1 AS present FROM market_retention_provider_denials
          WHERE provider_lane = ? AND provider_id = ?`)
        .get(lane, providerId) !== undefined
    );
  }
}

function openLiveCredentialDatabase(
  filename: string,
  migrations: readonly Migration[],
  journalMode: "DELETE" | "WAL",
): SqliteDatabase {
  const database = new Database(filename);
  try {
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    database.pragma("synchronous = FULL");
    database.pragma(`journal_mode = ${journalMode}`);
    database.defaultSafeIntegers(true);
    applyMigrations(database, migrations);
    Object.preventExtensions(database);
    ownedLiveCredentialDatabases.add(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function isOwnedLiveCredentialSqliteDatabase(database: SqliteDatabase): boolean {
  return ownedLiveCredentialDatabases.has(database as object);
}

function openLiveCredentialAuthorizationBoundaryAtPath(
  filename: string,
  anchorFilename: string,
  retentionFilename: string,
  runtimeRoot: string,
  migrations: readonly Migration[],
  plan: ValidatedMarketAcquisitionConfiguration,
): DurableCredentialAuthorizationBoundary {
  const primaryExists = existsSync(filename);
  const anchorExists = existsSync(anchorFilename);
  if (!primaryExists && !anchorExists) {
    throw new TypeError("credential-authority-not-provisioned");
  }
  if (primaryExists !== anchorExists) {
    throw new TypeError("credential-authority-layout-corrupt");
  }
  const database = openLiveCredentialDatabase(filename, migrations, "DELETE");
  let retentionDatabase: SqliteDatabase | undefined;
  try {
    const authorityNamespace = attachCredentialAuthorityAnchor(
      database,
      filename,
      anchorFilename,
      runtimeRoot,
      "open-existing",
    );
    retentionDatabase = openLiveCredentialDatabase(retentionFilename, migrations, "WAL");
    const store = productionCredentialStore(database, authorityNamespace, runtimeRoot, plan);
    const boundary = new DurableCredentialAuthorizationBoundary(
      undefined,
      new LiveCredentialRetentionGuard(retentionDatabase),
      store,
      CREDENTIAL_BOUNDARY_CONSTRUCTION_AUTHORITY,
    );
    credentialAuthorizationBoundaries.add(boundary);
    Object.freeze(boundary);
    productionCredentialDatabases.set(boundary, Object.freeze([database, retentionDatabase]));
    productionCredentialPlans.set(boundary, plan);
    return boundary;
  } catch (error) {
    retentionDatabase?.close();
    database.close();
    throw error;
  }
}

/**
 * Live credential root. It owns the SQLite handle and derives request-started evidence internally;
 * callers never receive a journal, producer, database, or workflow-write authority.
 */
export function openSqliteDurableCredentialAuthorizationBoundary(
  migrations: readonly Migration[],
  plan: ValidatedMarketAcquisitionConfiguration,
): DurableCredentialAuthorizationBoundary {
  validatePlan(plan);
  assertLiveCredentialMigrations(migrations);
  if (liveCredentialBoundaryOpened) {
    throw new TypeError("live-credential-authorization-root-already-opened");
  }
  const runtime = artifactRuntimePaths(configuredPeasRuntimeRoot());
  const authority = liveCredentialAuthorityPaths(runtime.databaseDirectory);
  const boundary = openLiveCredentialAuthorizationBoundaryAtPath(
    authority.database,
    authority.anchor,
    runtime.databasePath,
    runtime.runtimeRoot,
    migrations,
    plan,
  );
  protectSqliteDatabasePath(authority.database);
  protectSqliteDatabasePath(authority.anchor);
  liveCredentialBoundaryOpened = true;
  return boundary;
}

/**
 * Returns a read-safe owned journal rooted in the already-open canonical credential authority.
 * The first request-started workflow is hydrated only from the exact primary+anchor claim pair.
 */
export async function ownedLiveCredentialAcquisitionJournal(
  boundary: DurableCredentialAuthorizationBoundary,
  plan: ValidatedMarketAcquisitionConfiguration,
): Promise<SqliteAcquisitionJournal> {
  assertOwnedDurableCredentialAuthorizationBoundary(boundary);
  if (productionCredentialPlans.get(boundary) !== plan) {
    throw new TypeError("credential-production-plan-mismatch");
  }
  const databases = productionCredentialDatabases.get(boundary);
  const database = databases?.[0];
  if (database === undefined) throw new TypeError("production-credential-root-required");
  const journal = createSqliteAcquisitionJournal(database, exactJournalIdentity(plan));
  ownedLiveAcquisitionJournals.add(journal);
  ownedLiveJournalBoundaries.set(journal, boundary);
  const journalId = deriveMarketAcquisitionJournalId(exactJournalIdentity(plan));
  const current = await journal.load(journalId);
  const row = database
    .prepare(`SELECT request.journal_json, request.ledger_json
      FROM market_acquisition_owned_attempt_claims AS claim
      JOIN credential_anchor.credential_authority_attempt_claims AS anchor
        ON anchor.workflow_id = claim.workflow_id
       AND anchor.acquisition_id = claim.acquisition_id
       AND anchor.request_identity_hash = claim.request_identity_hash
       AND anchor.acquisition_configuration_hash = claim.acquisition_configuration_hash
       AND anchor.attempt_started_ms = claim.attempt_started_ms
       AND anchor.attempt_ordinal = claim.attempt_ordinal
       AND anchor.retrieval_attempt_id = claim.retrieval_attempt_id
       AND anchor.acquisition_observation_id = claim.acquisition_observation_id
      JOIN market_acquisition_owned_request_started AS request
        ON request.workflow_id = claim.workflow_id
      WHERE claim.request_identity_hash = ? AND claim.attempt_ordinal = 0`)
    .get(plan.requestIdentityHash) as { journal_json: string; ledger_json: string } | undefined;
  if (row === undefined) throw new TypeError("credential-workflow-seed-missing");
  const journalEntries = JSON.parse(row.journal_json) as import("./journal.js").JournalEntry[];
  const ledgerEntries = JSON.parse(
    row.ledger_json,
  ) as import("../../providers/observation-ledger.js").ObservationLedgerEntryV1[];
  validateJournalEntries(journalEntries, exactJournalIdentity(plan));
  validateJournalLedgerBindings(journalEntries, ledgerEntries);
  if (current.length === 0) {
    const seed = Object.freeze({ kind: "owned-credential-workflow-seed" as const });
    credentialWorkflowSeeds.set(seed, {
      journal,
      ledgerEntries: Object.freeze(ledgerEntries),
      journalEntries: Object.freeze(journalEntries),
    });
    const { persistOwnedCredentialWorkflowSeed } = await import("./journal.js");
    await persistOwnedCredentialWorkflowSeed(seed);
  } else {
    const expectedPrefix = canonicalJson(journalEntries as unknown as JsonValue);
    const actualPrefix = canonicalJson(
      current.slice(0, journalEntries.length) as unknown as JsonValue,
    );
    if (actualPrefix !== expectedPrefix) throw new TypeError("credential-workflow-seed-conflict");
  }
  return journal;
}

export function assertOwnedLiveCredentialAcquisitionJournal(journal: AcquisitionJournal): void {
  if (!ownedLiveAcquisitionJournals.has(journal as object)) {
    throw new TypeError("owned-live-acquisition-journal-required");
  }
}

export function isOwnedLiveCredentialAcquisitionJournal(journal: AcquisitionJournal): boolean {
  return ownedLiveAcquisitionJournals.has(journal as object);
}

export function consumeOwnedCredentialWorkflowSeed(seed: object): CredentialWorkflowSeedBinding {
  const binding = credentialWorkflowSeeds.get(seed);
  if (binding === undefined) throw new TypeError("owned-credential-workflow-seed-required");
  credentialWorkflowSeeds.delete(seed);
  assertOwnedLiveCredentialAcquisitionJournal(binding.journal);
  return binding;
}

function stateTransitionRows(
  database: SqliteDatabase,
  journalId: string,
): readonly Readonly<{
  transition_sequence: bigint;
  transition_hash: string;
  event_kind: string;
  event_json: string;
  from_state: string;
  to_state: string;
  checkpoint_kind: string | null;
  next_snapshot_json: string;
}>[] {
  return database
    .prepare(`SELECT transition_sequence, transition_hash, event_kind, event_json,
        from_state, to_state, checkpoint_kind, next_snapshot_json
      FROM market_acquisition_owned_state_transitions
      WHERE market_acquisition_journal_id = ? ORDER BY transition_sequence`)
    .all(journalId) as readonly Readonly<{
    transition_sequence: bigint;
    transition_hash: string;
    event_kind: string;
    event_json: string;
    from_state: string;
    to_state: string;
    checkpoint_kind: string | null;
    next_snapshot_json: string;
  }>[];
}

export function assertOwnedAcquisitionStateSnapshot(
  boundary: DurableCredentialAuthorizationBoundary,
  snapshot: AcquisitionMachineSnapshot,
): void {
  assertOwnedDurableCredentialAuthorizationBoundary(boundary);
  const plan = productionCredentialPlans.get(boundary);
  const database = productionCredentialDatabases.get(boundary)?.[0];
  if (plan === undefined || database === undefined) {
    throw new TypeError("production-credential-root-required");
  }
  if (
    snapshot.requestIdentityHash !== plan.requestIdentityHash ||
    snapshot.acquisitionConfigurationHash !== plan.acquisitionConfigurationHash ||
    snapshot.marketAcquisitionJournalId !==
      deriveMarketAcquisitionJournalId(exactJournalIdentity(plan))
  ) {
    throw new TypeError("owned-acquisition-state-identity-invalid");
  }
  const rows = stateTransitionRows(database, snapshot.marketAcquisitionJournalId);
  if (rows.some((row, index) => row.transition_sequence !== BigInt(index))) {
    throw new TypeError("owned-acquisition-state-sequence-invalid");
  }
  const latest = rows.at(-1);
  if (latest === undefined) {
    if (snapshot.currentState !== "declared") {
      throw new TypeError("owned-acquisition-state-restart-invalid");
    }
  } else if (latest.next_snapshot_json !== canonicalJson(snapshot as unknown as JsonValue)) {
    throw new TypeError("owned-acquisition-state-restart-invalid");
  }
}

export async function persistOwnedAcquisitionTransition(
  boundary: DurableCredentialAuthorizationBoundary,
  receipt: object,
): Promise<void> {
  assertOwnedDurableCredentialAuthorizationBoundary(boundary);
  const { consumeOwnedAcquisitionTransitionReceipt } = await import("./state-machine.js");
  const binding = consumeOwnedAcquisitionTransitionReceipt(receipt);
  const transition: AcquisitionTransitionPlan = binding.plan;
  const plan = productionCredentialPlans.get(boundary);
  const database = productionCredentialDatabases.get(boundary)?.[0];
  if (plan === undefined || database === undefined) {
    throw new TypeError("production-credential-root-required");
  }
  if (
    transition.next.requestIdentityHash !== plan.requestIdentityHash ||
    transition.next.acquisitionConfigurationHash !== plan.acquisitionConfigurationHash
  ) {
    throw new TypeError("owned-acquisition-state-identity-invalid");
  }
  database
    .transaction(() => {
      const rows = stateTransitionRows(database, transition.next.marketAcquisitionJournalId);
      const latest = rows.at(-1);
      if (
        (latest === undefined && transition.fromState !== "declared") ||
        (latest !== undefined && latest.to_state !== transition.fromState)
      ) {
        throw new TypeError("owned-acquisition-state-transition-conflict");
      }
      const nextJson = canonicalJson(transition.next as unknown as JsonValue);
      const eventJson = canonicalJson(binding.event as unknown as JsonValue);
      const transitionHash = canonicalHash("peas/owned-acquisition-state-transition/v1", {
        sequence: rows.length,
        eventKind: transition.eventKind,
        fromState: transition.fromState,
        toState: transition.toState,
        checkpointKind: transition.checkpointKind,
        next: transition.next,
      } as unknown as JsonValue);
      database
        .prepare(`INSERT INTO market_acquisition_owned_state_transitions (
          market_acquisition_journal_id, transition_sequence, request_identity_hash,
          acquisition_configuration_hash, event_kind, event_json, from_state, to_state,
          checkpoint_kind, next_snapshot_json, transition_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          transition.next.marketAcquisitionJournalId,
          rows.length,
          plan.requestIdentityHash,
          plan.acquisitionConfigurationHash,
          transition.eventKind,
          eventJson,
          transition.fromState,
          transition.toState,
          transition.checkpointKind,
          nextJson,
          transitionHash,
        );
    })
    .immediate();
}

type WorkflowJournalLink = Readonly<{ transitionHash: string; journalEntryHash: string }>;

function assertCheckpointMatchesTransition(
  entry: import("./journal.js").JournalEntry,
  row: ReturnType<typeof stateTransitionRows>[number],
): void {
  const snapshot = JSON.parse(row.next_snapshot_json) as AcquisitionMachineSnapshot;
  const event = JSON.parse(row.event_json) as import("./state-machine.js").AcquisitionEvent;
  if (
    row.checkpoint_kind !== entry.checkpointKind ||
    row.event_kind !== event.kind ||
    snapshot.requestIdentityHash !== entry.requestIdentityHash ||
    snapshot.acquisitionConfigurationHash !== entry.acquisitionConfigurationHash ||
    snapshot.marketAcquisitionJournalId !== entry.marketAcquisitionJournalId ||
    snapshot.pageOrdinal !== entry.pageOrdinal ||
    snapshot.currentTokenHash !== entry.currentTokenHash ||
    snapshot.currentContinuationBindingHash !== entry.currentContinuationBindingHash ||
    snapshot.pageChainHash !== entry.pageChainHash ||
    snapshot.budgets.successfulPages !== entry.cumulativeSuccessfulPages ||
    snapshot.budgets.verifiedBytes !== entry.cumulativeVerifiedBytes ||
    snapshot.budgets.records !== entry.cumulativeRecords ||
    snapshot.budgets.normalizedFacts !== entry.cumulativeNormalizedFacts ||
    snapshot.budgets.attempts !== entry.cumulativeAttempts ||
    canonicalJson(snapshot.quotaWindowEvidence as unknown as JsonValue) !==
      canonicalJson(entry.quotaWindowEvidence as unknown as JsonValue)
  ) {
    throw new TypeError("owned-workflow-checkpoint-transition-mismatch");
  }
  if (event.kind === "page-checkpointed") {
    const page = event.pageChainInput;
    const nextTokenHash =
      event.nextTokenMaterial === null
        ? TERMINAL_TOKEN_HASH
        : derivePrivateTokenHash(event.nextTokenMaterial);
    if (
      page.artifactObservationId !== entry.artifactObservationId ||
      page.artifactDigest !== entry.artifactDigest ||
      page.artifactSizeBytes !== entry.artifactSizeBytes ||
      page.artifactObservationHash !== entry.artifactObservationHash ||
      page.pageRecordCount !== entry.pageRecordCount ||
      nextTokenHash !== entry.nextTokenHash
    ) {
      throw new TypeError("owned-workflow-page-transition-mismatch");
    }
  }
}

export function prepareOwnedWorkflowJournalLinks(
  journal: AcquisitionJournal,
  entries: readonly import("./journal.js").JournalEntry[],
): readonly WorkflowJournalLink[] {
  assertOwnedLiveCredentialAcquisitionJournal(journal);
  const boundary = ownedLiveJournalBoundaries.get(journal as object);
  const database =
    boundary === undefined ? undefined : productionCredentialDatabases.get(boundary)?.[0];
  if (database === undefined) throw new TypeError("production-credential-root-required");
  const rows = stateTransitionRows(database, entries[0]?.marketAcquisitionJournalId ?? "");
  const linked = new Set(
    (
      database
        .prepare("SELECT transition_hash FROM market_acquisition_owned_transition_journal_links")
        .all() as Array<{ transition_hash: string }>
    ).map((row) => row.transition_hash),
  );
  let skippedDeclared = false;
  let skippedRequest = false;
  const available = rows.filter((row) => {
    if (linked.has(row.transition_hash) || row.checkpoint_kind === null) return false;
    if (!skippedDeclared && row.checkpoint_kind === "acquisition-declared") {
      skippedDeclared = true;
      return false;
    }
    if (!skippedRequest && row.checkpoint_kind === "request-started") {
      skippedRequest = true;
      return false;
    }
    return true;
  });
  if (available.length < entries.length) {
    throw new TypeError("owned-workflow-transition-missing");
  }
  return Object.freeze(
    entries.map((entry, index) => {
      const row = available[index];
      if (row === undefined) throw new TypeError("owned-workflow-transition-missing");
      assertCheckpointMatchesTransition(entry, row);
      return Object.freeze({
        transitionHash: row.transition_hash,
        journalEntryHash: entry.journalEntryHash,
      });
    }),
  );
}

export function commitOwnedWorkflowJournalLinks(
  journal: AcquisitionJournal,
  links: readonly WorkflowJournalLink[],
): void {
  assertOwnedLiveCredentialAcquisitionJournal(journal);
  const boundary = ownedLiveJournalBoundaries.get(journal as object);
  const database =
    boundary === undefined ? undefined : productionCredentialDatabases.get(boundary)?.[0];
  if (database === undefined) throw new TypeError("production-credential-root-required");
  database
    .transaction(() => {
      const insert = database.prepare(`INSERT OR IGNORE INTO
        market_acquisition_owned_transition_journal_links
        (transition_hash, journal_entry_hash) VALUES (?, ?)`);
      for (const link of links) {
        insert.run(link.transitionHash, link.journalEntryHash);
        const row = database
          .prepare(`SELECT journal_entry_hash FROM market_acquisition_owned_transition_journal_links
            WHERE transition_hash = ?`)
          .get(link.transitionHash) as { journal_entry_hash: string } | undefined;
        if (row?.journal_entry_hash !== link.journalEntryHash) {
          throw new TypeError("owned-workflow-transition-link-conflict");
        }
      }
    })
    .immediate();
}

export function isOwnedLiveWorkflowJournalEntryTrusted(
  journal: AcquisitionJournal,
  entry: import("./journal.js").JournalEntry,
): boolean {
  if (!isOwnedLiveCredentialAcquisitionJournal(journal)) return false;
  const boundary = ownedLiveJournalBoundaries.get(journal as object);
  const database =
    boundary === undefined ? undefined : productionCredentialDatabases.get(boundary)?.[0];
  if (database === undefined) return false;
  const seedRows = database
    .prepare("SELECT journal_json FROM market_acquisition_owned_request_started")
    .all() as Array<{ journal_json: string }>;
  if (
    seedRows.some((row) =>
      (JSON.parse(row.journal_json) as import("./journal.js").JournalEntry[]).some(
        (seed) => seed.journalEntryHash === entry.journalEntryHash,
      ),
    )
  ) {
    return true;
  }
  return (
    database
      .prepare(`SELECT 1 present FROM market_acquisition_owned_transition_journal_links
        WHERE journal_entry_hash = ?`)
      .get(entry.journalEntryHash) !== undefined
  );
}

/**
 * Explicit owned deployment-only first boot. Ordinary production artifacts carry an inert
 * authority stub, so application callers cannot initialize or reconstruct this root.
 */
export function provisionSqliteDurableCredentialAuthorityRuntime(
  migrations: readonly Migration[],
): void {
  if (P1_10_PROVISIONING_AUTHORITY === undefined) {
    throw new TypeError("credential-authority-provisioning-unavailable");
  }
  assertLiveCredentialMigrations(migrations);
  const runtime = artifactRuntimePaths(configuredPeasRuntimeRoot());
  P1_10_PROVISIONING_AUTHORITY.claim(runtime.runtimeRoot);
  const authority = liveCredentialAuthorityPaths(runtime.databaseDirectory);
  if (
    filesystemEntryExists(runtime.databaseDirectory) ||
    filesystemEntryExists(runtime.artifactsRoot) ||
    filesystemEntryExists(authority.database) ||
    filesystemEntryExists(authority.anchor) ||
    filesystemEntryExists(runtime.databasePath)
  ) {
    throw new TypeError("credential-authority-provisioning-layout-not-empty");
  }
  mkdirSync(runtime.databaseDirectory, { recursive: false });
  const database = openLiveCredentialDatabase(authority.database, migrations, "DELETE");
  try {
    attachCredentialAuthorityAnchor(
      database,
      authority.database,
      authority.anchor,
      runtime.runtimeRoot,
      "provision-empty",
    );
  } finally {
    database.close();
  }
}

export function openTestSqliteDurableCredentialAuthorizationBoundary(
  filename: string,
  migrations: readonly Migration[],
  plan: ValidatedMarketAcquisitionConfiguration,
): DurableCredentialAuthorizationBoundary {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-credential-authorization-composition-unavailable");
  }
  validatePlan(plan);
  return openCredentialAuthorizationBoundaryAtPath(
    filename,
    `${filename}.credential-anchor.sqlite`,
    migrations,
    plan,
  );
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
  request?: AlpacaTransportRequest,
): CredentialPreflightPermit {
  const binding = establishedEvidence.get(evidence);
  if (binding === undefined) throw new TypeError("credential-evidence-capability-invalid");
  establishedEvidence.delete(evidence);
  if (request === undefined) {
    if (P1_10_TEST_AUTHORITY === undefined) {
      throw new TypeError("credential-request-binding-required");
    }
  } else {
    assertOwnedAlpacaTransportRequest(request, binding.plan);
  }
  const permit = Object.freeze({
    kind: "p1-10-credential-capability" as const,
    requestIdentityHash: binding.plan.requestIdentityHash,
    acquisitionConfigurationHash: binding.plan.acquisitionConfigurationHash,
    acquisitionObservationId: binding.acquisitionObservationId,
    retrievalAttemptId: binding.retrievalAttemptId,
    attemptBudgetMs: binding.attemptBudgetMs,
  });
  issuedPermits.set(
    permit,
    request === undefined ? binding : Object.freeze({ ...binding, request }),
  );
  return permit;
}

export function discardCredentialPreflightPermit(permit: CredentialPreflightPermit): void {
  issuedPermits.delete(permit);
}

export function remainingCredentialAttemptBudgetMs(permit: CredentialPreflightPermit): number {
  const binding = issuedPermits.get(permit);
  if (binding === undefined) throw new TypeError("credential-capability-invalid");
  const nowMs = trustedSystemNowMs();
  if (!Number.isSafeInteger(nowMs) || nowMs < binding.attemptAdmittedAtMs) {
    throw new CredentialAdmissionDenied("clock-regression");
  }
  const remainingMs = binding.credentialUseDeadlineMs - nowMs;
  if (remainingMs < 1) throw new CredentialAdmissionDenied("acquisition-deadline");
  return Math.min(binding.attemptBudgetMs, remainingMs);
}

function credentialUnavailable<T>(): CredentialAttemptResult<T> {
  return { ok: false, error: safeAcquisitionError("credential-unavailable", "credential-load") };
}

export async function withAlpacaAuthorization<T>(
  permit: CredentialPreflightPermit,
  source: RuntimeSecretSource,
  request: AlpacaTransportRequest,
  operation: (capability: AlpacaDispatchCapability) => Promise<T>,
  deadline?: AlpacaDeadlineHandle,
): Promise<CredentialAttemptResult<T>> {
  const binding = issuedPermits.get(permit);
  if (binding === undefined) {
    throw new TypeError("credential-boundary-requires-durable-preconditions");
  }
  issuedPermits.delete(permit);
  const deadlineGuard = deadline ?? TEST_ONLY_UNBOUNDED_DEADLINE;
  if (deadline === undefined && P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("alpaca-deadline-required");
  }
  try {
    assertOwnedAlpacaTransportRequest(request, binding.plan);
    if (
      (binding.request !== undefined && request !== binding.request) ||
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
  const credentialUseNowMs = trustedSystemNowMs();
  if (
    !Number.isSafeInteger(credentialUseNowMs) ||
    credentialUseNowMs < binding.attemptAdmittedAtMs ||
    credentialUseNowMs >= binding.credentialUseDeadlineMs
  ) {
    return credentialUnavailable();
  }
  let keyId: unknown;
  let secretKey: unknown;
  let capability: AlpacaDispatchCapability | undefined;
  let authorization: AuthorizationLeaseState | undefined;
  try {
    deadlineGuard.assertRemaining();
    keyId = source.read(ALPACA_KEY_ID_ENV);
    deadlineGuard.assertRemaining();
    secretKey = source.read(ALPACA_SECRET_KEY_ENV);
    deadlineGuard.assertRemaining();
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
      Object.freeze({ ...binding, authorization, request, url, deadline: deadlineGuard }),
    );
    return { ok: true, value: await operation(capability) };
  } catch (error) {
    if (error instanceof AlpacaDeadlineElapsed) throw error;
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
  assertRemaining(): void;
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
    assertRemaining: () => binding.deadline.assertRemaining(),
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
      lease.assertRemaining();
      if (
        !Object.isFrozen(headers) ||
        Object.keys(headers).length !== 2 ||
        headers["APCA-API-KEY-ID"].length === 0 ||
        headers["APCA-API-SECRET-KEY"].length === 0
      ) {
        throw new TypeError("alpaca-authorization-record-invalid");
      }
      try {
        lease.assertRemaining();
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
        lease.assertRemaining();
        authorizationHeaders = Object.freeze({
          "APCA-API-KEY-ID": activeAuthorizationValue(lease.state.keyId, lease.state.active),
          "APCA-API-SECRET-KEY": activeAuthorizationValue(
            lease.state.secretKey,
            lease.state.active,
          ),
        });
        const dispatched = new Promise<IncomingMessage>((resolve, reject) => {
          lease.assertRemaining();
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

Object.freeze(DurableCredentialAuthorizationBoundary.prototype);
import { isProxy } from "node:util/types";
