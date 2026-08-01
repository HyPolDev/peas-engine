import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALPACA_KEY_ID_ENV,
  ALPACA_SECRET_KEY_ENV,
  authorizeCredentialLoad,
  establishCredentialAuthorizationEvidence,
  fmpLaneDisabled,
  withAlpacaAuthorization,
  type RuntimeSecretSource,
} from "../src/adapters/market-acquisition/credentials.js";
import {
  ACCESSOR,
  BYTE_LIMIT,
  CYCLE,
  OPAQUE,
  REDACTED,
  isSafeAcquisitionError,
  projectHostileValue,
  safeAcquisitionError,
} from "../src/adapters/market-acquisition/redaction.js";
import { credentialAuthorizationInput, validatedRepairPlan } from "./p1-10-repair-fixtures.js";

const evidenceInput = credentialAuthorizationInput(validatedRepairPlan());
const evidence = establishCredentialAuthorizationEvidence(evidenceInput);
const permit = authorizeCredentialLoad(evidence);

test("Alpaca credentials load only into an immutable dispatch capability", async () => {
  const reads: string[] = [];
  const source: RuntimeSecretSource = {
    read(name) {
      reads.push(name);
      return name === ALPACA_KEY_ID_ENV ? "synthetic-key-id" : "synthetic-secret";
    },
  };
  const result = await withAlpacaAuthorization(permit, source, async (capability) => {
    assert.equal(Object.isFrozen(capability), true);
    assert.deepEqual(Object.keys(capability), ["kind"]);
    return "settled";
  });
  assert.deepEqual(result, { ok: true, value: "settled" });
  assert.deepEqual(reads, [ALPACA_KEY_ID_ENV, ALPACA_SECRET_KEY_ENV]);
});

test("missing credentials return a closed error and never invoke transport", async () => {
  let operations = 0;
  const reads: string[] = [];
  const result = await withAlpacaAuthorization(
    permit,
    {
      read(name) {
        reads.push(name);
        return name === ALPACA_KEY_ID_ENV ? "synthetic-key-id" : undefined;
      },
    },
    async () => {
      operations += 1;
      return "unreachable";
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Credential failure unexpectedly succeeded");
  assert.equal(isSafeAcquisitionError(result.error), true);
  assert.deepEqual(Object.keys(result.error).sort(), [
    "detailHash",
    "operationStage",
    "reasonCode",
  ]);
  assert.equal(result.error.reasonCode, "credential-unavailable");
  assert.equal(operations, 0);
  assert.deepEqual(reads, [ALPACA_KEY_ID_ENV, ALPACA_SECRET_KEY_ENV]);
});

test("a structurally forged permit and incomplete proof cannot read credentials", async () => {
  let reads = 0;
  await assert.rejects(
    () =>
      withAlpacaAuthorization(
        {
          kind: "p1-10-credential-capability",
          requestIdentityHash: evidenceInput.plan.requestIdentityHash,
          acquisitionConfigurationHash: evidenceInput.plan.acquisitionConfigurationHash,
          acquisitionObservationId: evidenceInput.acquisitionObservationId,
          retrievalAttemptId: evidenceInput.retrievalAttemptId,
        } as never,
        {
          read() {
            reads += 1;
            return "unreachable";
          },
        },
        async () => "unreachable",
      ),
    /durable-preconditions/u,
  );
  assert.equal(reads, 0);
  assert.throws(
    () =>
      establishCredentialAuthorizationEvidence({
        ...evidenceInput,
        acquisitionObservationId: "wrong-acquisition",
      }),
    /acquisition-identity/u,
  );
  assert.throws(
    () =>
      establishCredentialAuthorizationEvidence({
        ...evidenceInput,
        journal: [...evidenceInput.journal].reverse(),
      }),
    /journal|checkpoint|hash-chain/u,
  );
  assert.throws(
    () =>
      establishCredentialAuthorizationEvidence({
        ...evidenceInput,
        ledger: evidenceInput.ledger.slice(0, 2),
      }),
    /request-started/u,
  );
  assert.throws(
    () =>
      establishCredentialAuthorizationEvidence({
        ...evidenceInput,
        journal: evidenceInput.journal.slice(0, 1),
      }),
    /request-started|checkpoint/u,
  );
  assert.equal(reads, 0);
  assert.throws(
    () => authorizeCredentialLoad({ kind: "p1-10-durable-credential-evidence" } as never),
    /evidence-capability-invalid/u,
  );
});

test("the low-level attempt executor is not a caller-invocable module export", async () => {
  const module = await import("../src/adapters/market-acquisition/alpaca/adapter.js");
  assert.equal("executeAlpacaAttempt" in module, false);
});

test("FMP reservation is disabled and exposes no credential-reader capability", () => {
  const result = fmpLaneDisabled();
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Disabled FMP lane unexpectedly succeeded");
  assert.equal(result.error.reasonCode, "lane-not-implemented");
  assert.equal(result.error.operationStage, "authority");
});

test("recursive projection is descriptor-safe, cycle-safe, and collapses hostile values", () => {
  let getterReads = 0;
  const value: Record<string, unknown> = {
    safeCounter: 7,
    safeBoolean: true,
    harmlessText: "never emit these characters",
    credential: { nested: "secret" },
    requestHeaders: { arbitrary: "header" },
    bodySnippet: "provider bytes",
    nested: Object.create(null) as Record<string, unknown>,
  };
  Object.defineProperty(value, "hostileGetter", {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error("must not execute");
    },
  });
  (value["nested"] as Record<string, unknown>)["back"] = value;
  const projected = projectHostileValue(value) as Record<string, unknown>;
  assert.equal(getterReads, 0);
  assert.equal(projected["credential"], REDACTED);
  assert.equal(projected["requestHeaders"], REDACTED);
  assert.equal(projected["bodySnippet"], REDACTED);
  assert.equal(projected["hostileGetter"], ACCESSOR);
  assert.deepEqual(projected["safeCounter"], 7);
  assert.equal((projected["nested"] as Record<string, unknown>)["back"], CYCLE);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /never emit these characters|provider bytes|nested secret|arbitrary header/iu,
  );

  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("hostile proxy");
      },
    },
  );
  assert.equal(projectHostileValue(proxy), OPAQUE);
  assert.deepEqual(projectHostileValue(new Error("hostile")), OPAQUE);
});

test("redaction budgets are deterministic and safe-error detail never hashes hostile input", () => {
  const projected = projectHostileValue(
    { alpha: { beta: { gamma: 1 } }, delta: 2 },
    { maxDepth: 2, maxMembers: 10, maxOutputBytes: 24 },
  );
  assert.match(
    JSON.stringify(projected),
    new RegExp(`${BYTE_LIMIT.slice(1, -1)}|depth-limit`, "u"),
  );
  const first = safeAcquisitionError("retention-erasure-failed", "retention-erase");
  const second = safeAcquisitionError("retention-erasure-failed", "retention-erase");
  assert.deepEqual(first, second);
  assert.match(first.detailHash, /^[0-9a-f]{64}$/u);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.isFrozen(first), true);
});
