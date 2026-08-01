import { safeAcquisitionError, type SafeAcquisitionError } from "./redaction.js";

export const ALPACA_KEY_ID_ENV = "PEAS_ALPACA_API_KEY_ID";
export const ALPACA_SECRET_KEY_ENV = "PEAS_ALPACA_API_SECRET_KEY";
export const RESERVED_FMP_KEY_ENV = "PEAS_FMP_API_KEY";

export type CredentialReadName = typeof ALPACA_KEY_ID_ENV | typeof ALPACA_SECRET_KEY_ENV;

export interface RuntimeSecretSource {
  read(name: CredentialReadName): unknown;
}

export type CredentialPreflightPermit = Readonly<{
  kind: "p1-10-credential-preflight-passed";
  providerLane: "alpaca";
  nonSecretGatesPassed: true;
  retentionReady: true;
}>;

export type NonSecretCredentialPreflightProof = Readonly<{
  configurationAccepted: true;
  liveRunEnabled: true;
  authorityAccepted: true;
  identityAccepted: true;
  queryAndBoundsAccepted: true;
  zeroSpendAccepted: true;
  quotaAndDeadlinesAccepted: true;
  trustedTimeAccepted: true;
  requestStartedRecorded: true;
  retentionReady: true;
}>;

export type AlpacaAuthorizationHeaders = Readonly<{
  "APCA-API-KEY-ID": string;
  "APCA-API-SECRET-KEY": string;
}>;

export type CredentialAttemptResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: SafeAcquisitionError }>;

const issuedPermits = new WeakSet<object>();
const PROOF_KEYS = [
  "authorityAccepted",
  "configurationAccepted",
  "identityAccepted",
  "liveRunEnabled",
  "queryAndBoundsAccepted",
  "quotaAndDeadlinesAccepted",
  "requestStartedRecorded",
  "retentionReady",
  "trustedTimeAccepted",
  "zeroSpendAccepted",
] as const;

export function authorizeCredentialLoad(input: unknown): CredentialPreflightPermit {
  if (input === null || typeof input !== "object")
    throw new TypeError("Credential preflight proof is invalid");
  let descriptors: PropertyDescriptorMap;
  try {
    if (Object.getPrototypeOf(input) !== Object.prototype)
      throw new TypeError("Credential preflight proof must be a plain object");
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    throw new TypeError("Credential preflight proof is invalid");
  }
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key === "symbol") ||
    keys.length !== PROOF_KEYS.length ||
    !PROOF_KEYS.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && "value" in descriptor && descriptor.value === true;
    })
  )
    throw new TypeError("Every non-secret credential preflight gate must pass");
  const permit: CredentialPreflightPermit = Object.freeze({
    kind: "p1-10-credential-preflight-passed",
    providerLane: "alpaca",
    nonSecretGatesPassed: true,
    retentionReady: true,
  });
  issuedPermits.add(permit);
  return permit;
}

function credentialUnavailable<T>(): CredentialAttemptResult<T> {
  return {
    ok: false,
    error: safeAcquisitionError("credential-unavailable", "credential-load"),
  };
}

/**
 * Loads credentials only after the caller supplies the exact non-secret preflight permit. The
 * callback is the sole scope in which authorization headers exist.
 */
export async function withAlpacaAuthorization<T>(
  permit: CredentialPreflightPermit,
  source: RuntimeSecretSource,
  operation: (headers: AlpacaAuthorizationHeaders) => Promise<T>,
): Promise<CredentialAttemptResult<T>> {
  if (
    !issuedPermits.has(permit) ||
    permit.kind !== "p1-10-credential-preflight-passed" ||
    permit.providerLane !== "alpaca" ||
    permit.nonSecretGatesPassed !== true ||
    permit.retentionReady !== true
  )
    throw new TypeError("Credential boundary requires a completed non-secret preflight");

  let keyId: unknown;
  let secretKey: unknown;
  let mutableHeaders: Record<string, string> | undefined;
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
    mutableHeaders = Object.create(null) as Record<string, string>;
    mutableHeaders["APCA-API-KEY-ID"] = keyId;
    mutableHeaders["APCA-API-SECRET-KEY"] = secretKey;
    return { ok: true, value: await operation(mutableHeaders as AlpacaAuthorizationHeaders) };
  } catch {
    return credentialUnavailable();
  } finally {
    keyId = undefined;
    secretKey = undefined;
    if (mutableHeaders !== undefined) {
      delete mutableHeaders["APCA-API-KEY-ID"];
      delete mutableHeaders["APCA-API-SECRET-KEY"];
      mutableHeaders = undefined;
    }
  }
}

export function fmpLaneDisabled(): CredentialAttemptResult<never> {
  return {
    ok: false,
    error: safeAcquisitionError("lane-not-implemented", "authority"),
  };
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
