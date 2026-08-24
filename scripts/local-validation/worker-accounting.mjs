import { createHash } from "node:crypto";
import { constants as osConstants } from "node:os";

const VALID_SIGNAL_NAMES = new Set(Object.keys(osConstants.signals ?? {}));
const SAFE_IDENTITY = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_ERROR_CODE = /^[A-Za-z0-9._:-]{1,128}$/u;
const VALID_SURFACES = new Set([
  "child_process.spawn",
  "child_process.spawnSync",
  "child_process.execFile",
  "child_process.execFileSync",
  "child_process.fork",
]);
const CLAIM_KEYS = [
  "childToken",
  "errorCode",
  "exitCode",
  "groupId",
  "ownerPid",
  "ownerToken",
  "pid",
  "schemaVersion",
  "signalCode",
  "state",
  "surface",
];
const LIFECYCLE_KEYS = [
  "childToken",
  "errorCode",
  "exitCode",
  "groupId",
  "kind",
  "ownerPid",
  "ownerToken",
  "pid",
  "schemaVersion",
  "signalCode",
  "surface",
  "transition",
];
const AUDIT_REQUIRED_KEYS = [
  "nodeTestChild",
  "ownedChildClaims",
  "pid",
  "ppid",
  "schemaVersion",
  "workerOwnership",
];
const AUDIT_ALLOWED_KEYS = new Set([
  ...AUDIT_REQUIRED_KEYS,
  "activeHandleKinds",
  "childDenialInherited",
  "deniedBySurface",
  "deniedOutboundTransportAttempts",
  "memoryUsage",
  "outboundTransportAttempts",
  "resourceUsage",
  "successfulOutboundTransports",
]);
const AUDIT_OWNERSHIP_KEYS = ["groupId", "ownerToken", "schemaVersion", "token"];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalBytes(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex");
}

function positivePid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function safeIdentity(value) {
  return typeof value === "string" && SAFE_IDENTITY.test(value);
}

function safeErrorCode(value) {
  return typeof value === "string" && SAFE_ERROR_CODE.test(value);
}

function redactedString(value) {
  if (typeof value !== "string") return value ?? null;
  return Object.freeze({
    length: Math.min(value.length, 129),
    sha256: createHash("sha256").update(value).digest("hex"),
  });
}

function boundedEvidenceValue(value) {
  if (typeof value === "string") return redactedString(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (Array.isArray(value)) {
    return Object.freeze({ type: "array", length: Math.min(value.length, 17) });
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze({
      type: "object",
      entryCount: Math.min(Object.keys(value).length, 17),
    });
  }
  return null;
}

function validExitCode(value, platform) {
  const maximum = platform === "win32" ? 0xffff_ffff : 255;
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function hasExactKeys(value, keys) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys)
  );
}

function sameIdentity(left, right) {
  return (
    left.groupId === right.groupId &&
    left.ownerToken === right.ownerToken &&
    left.ownerPid === right.ownerPid &&
    left.childToken === right.childToken &&
    left.pid === right.pid &&
    left.surface === right.surface
  );
}

function boundedIssue(kind, value = {}) {
  return {
    kind,
    ...Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        typeof child === "string" ? `${key}Evidence` : key,
        boundedEvidenceValue(child),
      ]),
    ),
  };
}

function failure(reason, evidence) {
  const report = Object.freeze({
    reason,
    measuredWorkers: evidence.liveOwnedCount,
    settledHistoricalCount: evidence.settledHistoricalCount,
    forcedTerminationCount: evidence.forcedTerminationCount,
    orphanCount: evidence.orphanCount,
    unownedCount: evidence.unownedCount,
    ambiguousCount: evidence.ambiguousCount,
    accountingErrorCount: evidence.accountingErrorCount,
    liveOwnedEvidence: evidence.liveOwnedEvidence.slice(0, 8),
    issues: evidence.issues.slice(0, 16),
    ownershipEvidenceSha256: sha256(evidence),
  });
  throw new Error(`worker-accounting-invalid:${reason}:${JSON.stringify(report)}`);
}

function lifecycleSchemaValid(event, groupId, rootOwnerToken, rootOwnerPid) {
  return (
    hasExactKeys(event, LIFECYCLE_KEYS) &&
    event?.schemaVersion === 1 &&
    event?.kind === "worker-lifecycle" &&
    ["spawn-intent", "child-started", "claimed", "settled", "accounting-error"].includes(
      event?.transition,
    ) &&
    event?.groupId === groupId &&
    safeIdentity(event?.ownerToken) &&
    positivePid(event?.ownerPid) &&
    safeIdentity(event?.childToken) &&
    event.childToken !== rootOwnerToken &&
    (event.pid === null || event.pid !== rootOwnerPid) &&
    VALID_SURFACES.has(event?.surface) &&
    (["spawn-intent", "accounting-error"].includes(event.transition) || positivePid(event?.pid))
  );
}

function transitionFieldsValid(event, platform) {
  if (
    !Object.hasOwn(event, "exitCode") ||
    !Object.hasOwn(event, "signalCode") ||
    !Object.hasOwn(event, "errorCode")
  ) {
    return false;
  }
  const { exitCode, signalCode, errorCode } = event;
  if (["spawn-intent", "child-started", "claimed"].includes(event.transition)) {
    return exitCode === null && signalCode === null && errorCode === null;
  }
  if (event.transition === "settled") {
    return (
      errorCode === null &&
      ((validExitCode(exitCode, platform) && signalCode === null) ||
        (exitCode === null && typeof signalCode === "string" && VALID_SIGNAL_NAMES.has(signalCode)))
    );
  }
  return exitCode === null && signalCode === null && safeErrorCode(errorCode);
}

function claimSchemaValid(claim, groupId, rootOwnerToken, rootOwnerPid) {
  return (
    hasExactKeys(claim, CLAIM_KEYS) &&
    claim?.schemaVersion === 1 &&
    claim?.groupId === groupId &&
    safeIdentity(claim?.ownerToken) &&
    positivePid(claim?.ownerPid) &&
    safeIdentity(claim?.childToken) &&
    claim.childToken !== rootOwnerToken &&
    claim.pid !== rootOwnerPid &&
    VALID_SURFACES.has(claim?.surface) &&
    ["live", "settled", "accounting-error"].includes(claim?.state) &&
    (claim.state === "accounting-error" || positivePid(claim?.pid))
  );
}

function claimFieldsValid(claim, platform) {
  if (
    !Object.hasOwn(claim, "exitCode") ||
    !Object.hasOwn(claim, "signalCode") ||
    !Object.hasOwn(claim, "errorCode")
  ) {
    return false;
  }
  const { exitCode, signalCode, errorCode } = claim;
  if (claim.state === "live") {
    return exitCode === null && signalCode === null && errorCode === null;
  }
  if (claim.state === "settled") {
    return (
      errorCode === null &&
      ((validExitCode(exitCode, platform) && signalCode === null) ||
        (exitCode === null && typeof signalCode === "string" && VALID_SIGNAL_NAMES.has(signalCode)))
    );
  }
  return exitCode === null && signalCode === null && safeErrorCode(errorCode);
}

function finalClaimFromLifecycle(claimed, terminal) {
  return {
    schemaVersion: claimed.schemaVersion,
    groupId: claimed.groupId,
    ownerToken: claimed.ownerToken,
    ownerPid: claimed.ownerPid,
    childToken: claimed.childToken,
    pid: claimed.pid,
    surface: claimed.surface,
    state:
      terminal === undefined
        ? "live"
        : terminal.transition === "settled"
          ? "settled"
          : "accounting-error",
    exitCode: terminal?.exitCode ?? null,
    signalCode: terminal?.signalCode ?? null,
    errorCode: terminal?.errorCode ?? null,
  };
}

export function measureWorkerOwnership({
  groupId,
  rootOwnerToken,
  rootOwnerPid,
  directClaims,
  audits,
  lifecycleEvents,
  platform,
}) {
  const evidence = {
    schemaVersion: 2,
    platform: ["darwin", "linux", "win32"].includes(platform) ? platform : null,
    groupId: safeIdentity(groupId) ? groupId : null,
    rootOwnerToken: safeIdentity(rootOwnerToken) ? rootOwnerToken : null,
    rootOwnerPid: positivePid(rootOwnerPid) ? rootOwnerPid : null,
    directClaimCount: Array.isArray(directClaims) ? directClaims.length : 0,
    auditCount: Array.isArray(audits) ? audits.length : 0,
    lifecycleEventCount: Array.isArray(lifecycleEvents) ? lifecycleEvents.length : 0,
    totalClaimCount: 0,
    settledHistoricalCount: 0,
    forcedTerminationCount: 0,
    liveOwnedCount: 0,
    orphanCount: 0,
    unownedCount: 0,
    ambiguousCount: 0,
    accountingErrorCount: 0,
    historicalPidReuseCount: 0,
    implicitlyOwnedSettledCount: 0,
    liveOwnedEvidence: [],
    issues: [],
  };
  if (
    !safeIdentity(groupId) ||
    !safeIdentity(rootOwnerToken) ||
    !positivePid(rootOwnerPid) ||
    !["darwin", "linux", "win32"].includes(platform) ||
    !Array.isArray(directClaims) ||
    !Array.isArray(audits) ||
    !Array.isArray(lifecycleEvents)
  ) {
    evidence.accountingErrorCount += 1;
    failure("schema-invalid", evidence);
  }

  const lifecycleByToken = new Map();
  for (const [index, event] of lifecycleEvents.entries()) {
    if (
      !lifecycleSchemaValid(event, groupId, rootOwnerToken, rootOwnerPid) ||
      !transitionFieldsValid(event, platform)
    ) {
      evidence.accountingErrorCount += 1;
      evidence.issues.push(
        boundedIssue("lifecycle-schema-invalid", {
          index,
          transition: event?.transition ?? null,
          token: event?.childToken ?? null,
          pid: event?.pid ?? null,
        }),
      );
      continue;
    }
    const events = lifecycleByToken.get(event.childToken) ?? [];
    events.push({ ...event, recordIndex: index });
    lifecycleByToken.set(event.childToken, events);
  }

  const finalClaims = new Map();
  const lifecycleIntervals = new Map();
  const provisionalTokens = new Set();
  for (const [childToken, events] of lifecycleByToken) {
    const intentEvents = events.filter(({ transition }) => transition === "spawn-intent");
    const startedEvents = events.filter(({ transition }) => transition === "child-started");
    const claimedEvents = events.filter(({ transition }) => transition === "claimed");
    const terminalEvents = events.filter(({ transition }) =>
      ["settled", "accounting-error"].includes(transition),
    );
    if (
      intentEvents.length !== 1 ||
      startedEvents.length > 1 ||
      claimedEvents.length > 1 ||
      terminalEvents.length > 1
    ) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("lifecycle-transition-count-invalid", {
          token: childToken,
          intentCount: intentEvents.length,
          startedCount: startedEvents.length,
          claimedCount: claimedEvents.length,
          terminalCount: terminalEvents.length,
        }),
      );
      continue;
    }
    const intent = intentEvents[0];
    const started = startedEvents[0];
    const claimed = claimedEvents[0];
    const terminal = terminalEvents[0];
    const basis = claimed ?? started ?? intent;
    const intentMatches =
      intent.pid === null &&
      intent.groupId === basis.groupId &&
      intent.ownerToken === basis.ownerToken &&
      intent.ownerPid === basis.ownerPid &&
      intent.childToken === basis.childToken &&
      intent.surface === basis.surface;
    const startAndClaimMatch =
      started === undefined || claimed === undefined || sameIdentity(started, claimed);
    const terminalMatches = terminal === undefined || sameIdentity(basis, terminal);
    const successfulEvidence = started !== undefined || claimed !== undefined;
    const terminalOrderFloor = Math.max(
      intent.recordIndex,
      started?.recordIndex ?? -1,
      claimed?.recordIndex ?? -1,
    );
    if (
      !intentMatches ||
      !startAndClaimMatch ||
      !terminalMatches ||
      intent.recordIndex >=
        Math.min(started?.recordIndex ?? Infinity, claimed?.recordIndex ?? Infinity) ||
      (terminal !== undefined && terminal.recordIndex <= terminalOrderFloor) ||
      (!successfulEvidence && terminal?.transition !== "accounting-error")
    ) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(boundedIssue("lifecycle-identity-conflict", { token: childToken }));
      continue;
    }
    const finalClaim = finalClaimFromLifecycle(basis, terminal);
    if (
      !claimSchemaValid(finalClaim, groupId, rootOwnerToken, rootOwnerPid) ||
      !claimFieldsValid(finalClaim, platform)
    ) {
      evidence.accountingErrorCount += 1;
      evidence.issues.push(
        boundedIssue("derived-claim-schema-invalid", {
          token: childToken,
          pid: finalClaim.pid,
        }),
      );
      continue;
    }
    finalClaims.set(childToken, finalClaim);
    if (claimed === undefined) {
      provisionalTokens.add(childToken);
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("parent-claim-transition-missing", {
          token: childToken,
          pid: finalClaim.pid,
        }),
      );
    }
    if (positivePid(finalClaim.pid)) {
      lifecycleIntervals.set(childToken, {
        pid: finalClaim.pid,
        claimIndex: Math.min(started?.recordIndex ?? Infinity, claimed?.recordIndex ?? Infinity),
        terminalIndex: terminal?.recordIndex,
      });
    }
    if (finalClaim.state === "accounting-error") {
      evidence.accountingErrorCount += 1;
      evidence.issues.push(
        boundedIssue("lifecycle-accounting-error", {
          token: childToken,
          pid: finalClaim.pid,
          errorCode: finalClaim.errorCode,
        }),
      );
    }
  }
  evidence.totalClaimCount = finalClaims.size;

  const supplementaryClaims = [
    ...directClaims.map((claim) => ({ claim, containingAudit: null, source: "direct" })),
    ...audits.flatMap((audit) =>
      Array.isArray(audit?.ownedChildClaims)
        ? audit.ownedChildClaims.map((claim) => ({
            claim,
            containingAudit: audit,
            source: "audit",
          }))
        : [],
    ),
  ];
  const supplementaryByToken = new Map();
  for (const { claim, containingAudit, source } of supplementaryClaims) {
    if (
      !claimSchemaValid(claim, groupId, rootOwnerToken, rootOwnerPid) ||
      !claimFieldsValid(claim, platform)
    ) {
      evidence.accountingErrorCount += 1;
      evidence.issues.push(
        boundedIssue("claim-schema-invalid", {
          token: claim?.childToken ?? null,
          pid: claim?.pid ?? null,
        }),
      );
      continue;
    }
    if (
      source === "direct" &&
      (claim.ownerToken !== rootOwnerToken || claim.ownerPid !== rootOwnerPid)
    ) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("direct-claim-owner-conflict", {
          token: claim.childToken,
          pid: claim.pid,
          ownerPid: claim.ownerPid,
          rootOwnerPid,
        }),
      );
      continue;
    }
    if (
      containingAudit !== null &&
      (claim.ownerToken !== containingAudit?.workerOwnership?.token ||
        claim.ownerPid !== containingAudit?.pid)
    ) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("claim-containing-audit-owner-conflict", {
          token: claim.childToken,
          pid: claim.pid,
          ownerPid: claim.ownerPid,
          auditPid: containingAudit?.pid ?? null,
        }),
      );
      continue;
    }
    const existing = supplementaryByToken.get(claim.childToken);
    if (existing !== undefined) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue(
          canonicalBytes(existing) === canonicalBytes(claim)
            ? "claim-snapshot-duplicate"
            : "claim-snapshot-conflict",
          { token: claim.childToken, pid: claim.pid },
        ),
      );
      continue;
    }
    supplementaryByToken.set(claim.childToken, claim);
  }
  for (const [token, claim] of supplementaryByToken) {
    const lifecycleClaim = finalClaims.get(token);
    if (lifecycleClaim === undefined) {
      evidence.accountingErrorCount += 1;
      evidence.issues.push(
        boundedIssue("claim-lifecycle-missing", { token: claim.childToken, pid: claim.pid }),
      );
    } else if (canonicalBytes(lifecycleClaim) !== canonicalBytes(claim)) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("claim-lifecycle-conflict", { token: claim.childToken, pid: claim.pid }),
      );
    }
  }
  for (const [token, claim] of finalClaims) {
    if (!supplementaryByToken.has(token) && !provisionalTokens.has(token)) {
      evidence.accountingErrorCount += 1;
      evidence.issues.push(
        boundedIssue("parent-claim-snapshot-missing", {
          token,
          pid: claim.pid,
        }),
      );
    }
  }

  const auditByIdentity = new Map();
  const auditsByToken = new Map();
  for (const audit of audits) {
    const ownership = audit?.workerOwnership;
    if (
      typeof audit !== "object" ||
      audit === null ||
      Array.isArray(audit) ||
      AUDIT_REQUIRED_KEYS.some((key) => !Object.hasOwn(audit, key)) ||
      Object.keys(audit).some((key) => !AUDIT_ALLOWED_KEYS.has(key)) ||
      audit?.schemaVersion !== 1 ||
      !positivePid(audit?.pid) ||
      !positivePid(audit?.ppid) ||
      typeof audit?.nodeTestChild !== "boolean" ||
      ownership?.schemaVersion !== 1 ||
      !hasExactKeys(ownership, AUDIT_OWNERSHIP_KEYS) ||
      ownership?.groupId !== groupId ||
      !safeIdentity(ownership?.token) ||
      !safeIdentity(ownership?.ownerToken) ||
      !Array.isArray(audit?.ownedChildClaims)
    ) {
      evidence.accountingErrorCount += 1;
      evidence.issues.push(boundedIssue("audit-schema-invalid", { pid: audit?.pid ?? null }));
      continue;
    }
    const identity = `${ownership.token}\0${audit.pid}`;
    if (auditByIdentity.has(identity)) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("audit-identity-duplicate", { token: ownership.token, pid: audit.pid }),
      );
      continue;
    }
    auditByIdentity.set(identity, audit);
    const matchingToken = auditsByToken.get(ownership.token) ?? [];
    matchingToken.push(audit);
    auditsByToken.set(ownership.token, matchingToken);
  }

  const claimedAuditIdentities = new Set();
  for (const claim of finalClaims.values()) {
    const matchingAudits = (auditsByToken.get(claim.childToken) ?? []).filter(
      (audit) => audit.pid === claim.pid,
    );
    if (matchingAudits.length > 1) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("claim-audit-count-ambiguous", {
          token: claim.childToken,
          pid: claim.pid,
          matchingAuditCount: matchingAudits.length,
        }),
      );
    } else if (matchingAudits.length === 1) {
      const audit = matchingAudits[0];
      if (
        claim.ownerPid !== audit.ppid ||
        claim.ownerToken !== audit.workerOwnership.ownerToken ||
        claim.state === "live"
      ) {
        evidence.ambiguousCount += 1;
        evidence.issues.push(
          boundedIssue("claim-audit-mismatch", {
            token: claim.childToken,
            pid: claim.pid,
            ownerPid: claim.ownerPid,
            auditParentPid: audit.ppid,
            state: claim.state,
          }),
        );
      } else {
        claimedAuditIdentities.add(`${audit.workerOwnership.token}\0${audit.pid}`);
      }
    } else if (claim.state === "settled" && claim.signalCode === null) {
      evidence.accountingErrorCount += 1;
      evidence.issues.push(
        boundedIssue("graceful-settlement-audit-missing", {
          token: claim.childToken,
          pid: claim.pid,
        }),
      );
    }

    if (claim.state === "settled") {
      evidence.settledHistoricalCount += 1;
      if (claim.signalCode !== null && matchingAudits.length === 0) {
        evidence.forcedTerminationCount += 1;
      }
    }
  }

  const rootedAuditIdentities = new Set(claimedAuditIdentities);
  const auditResolution = new Map([...claimedAuditIdentities].map((identity) => [identity, true]));
  const resolveAuditLineage = (startIdentity) => {
    const chain = [];
    const positions = new Map();
    let identity = startIdentity;
    let isRooted = false;
    while (true) {
      const resolved = auditResolution.get(identity);
      if (resolved !== undefined) {
        isRooted = resolved;
        break;
      }
      const audit = auditByIdentity.get(identity);
      if (audit === undefined) break;
      if (positions.has(identity)) {
        evidence.ambiguousCount += 1;
        evidence.issues.push(
          boundedIssue("implicit-audit-lineage-cycle", {
            token: audit.workerOwnership.token,
            pid: audit.pid,
          }),
        );
        break;
      }
      positions.set(identity, chain.length);
      chain.push(identity);
      const parentIdentity = `${audit.workerOwnership.token}\0${audit.ppid}`;
      const parent = auditByIdentity.get(parentIdentity);
      if (
        audit.nodeTestChild !== true ||
        parent === undefined ||
        parent.workerOwnership.ownerToken !== audit.workerOwnership.ownerToken
      ) {
        evidence.unownedCount += 1;
        evidence.issues.push(
          boundedIssue("implicit-audit-lineage-disconnected", {
            token: audit.workerOwnership.token,
            pid: audit.pid,
            ppid: audit.ppid,
          }),
        );
        break;
      }
      identity = parentIdentity;
    }
    for (const childIdentity of chain) {
      auditResolution.set(childIdentity, isRooted);
      if (isRooted) rootedAuditIdentities.add(childIdentity);
    }
    return isRooted;
  };
  for (const identity of auditByIdentity.keys()) {
    if (claimedAuditIdentities.has(identity)) continue;
    if (resolveAuditLineage(identity)) {
      evidence.implicitlyOwnedSettledCount += 1;
      evidence.settledHistoricalCount += 1;
    }
  }

  for (const claim of finalClaims.values()) {
    const ownerIsRoot = claim.ownerToken === rootOwnerToken;
    const ownerClaim = finalClaims.get(claim.ownerToken);
    const implicitOwnerIdentity = `${claim.ownerToken}\0${claim.ownerPid}`;
    const implicitOwnerAudit = auditByIdentity.get(implicitOwnerIdentity);
    const implicitOwnerRooted =
      rootedAuditIdentities.has(implicitOwnerIdentity) &&
      implicitOwnerAudit?.workerOwnership.ownerToken === ownerClaim?.ownerToken;
    if (ownerIsRoot && claim.ownerPid !== rootOwnerPid) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("root-owner-pid-conflict", {
          token: claim.childToken,
          ownerPid: claim.ownerPid,
          rootOwnerPid,
        }),
      );
    } else if (!ownerIsRoot && ownerClaim === undefined) {
      evidence.unownedCount += 1;
      evidence.issues.push(boundedIssue("claim-owner-unknown", { token: claim.childToken }));
    } else if (
      !ownerIsRoot &&
      ((claim.ownerPid !== ownerClaim.pid && !implicitOwnerRooted) ||
        ownerClaim.groupId !== claim.groupId)
    ) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("claim-parent-lineage-conflict", {
          token: claim.childToken,
          ownerToken: claim.ownerToken,
          ownerPid: claim.ownerPid,
          recordedOwnerPid: ownerClaim.pid,
        }),
      );
    }
  }

  const lineageByToken = new Map();
  for (const claim of finalClaims.values()) {
    const visited = new Set([claim.childToken]);
    const ancestors = [];
    let ownerToken = claim.ownerToken;
    let rooted = false;
    let cycle = false;
    while (ownerToken !== rootOwnerToken) {
      if (visited.has(ownerToken)) {
        cycle = true;
        evidence.ambiguousCount += 1;
        evidence.issues.push(
          boundedIssue("ownership-lineage-cycle", {
            token: claim.childToken,
            ownerToken,
          }),
        );
        break;
      }
      visited.add(ownerToken);
      const owner = finalClaims.get(ownerToken);
      if (owner === undefined) break;
      ancestors.push(owner);
      ownerToken = owner.ownerToken;
    }
    if (ownerToken === rootOwnerToken) rooted = true;
    lineageByToken.set(claim.childToken, { ancestors, rooted });
    if (!rooted && !cycle) {
      evidence.unownedCount += 1;
      evidence.issues.push(
        boundedIssue("ownership-lineage-disconnected", {
          token: claim.childToken,
          ownerToken,
        }),
      );
    }
  }

  const intervalsByPid = new Map();
  for (const [token, interval] of lifecycleIntervals) {
    const intervals = intervalsByPid.get(interval.pid) ?? [];
    intervals.push({ token, ...interval });
    intervalsByPid.set(interval.pid, intervals);
  }
  for (const [pid, intervals] of intervalsByPid) {
    intervals.sort((left, right) => left.claimIndex - right.claimIndex);
    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1];
      const current = intervals[index];
      if (previous.terminalIndex === undefined || previous.terminalIndex >= current.claimIndex) {
        evidence.ambiguousCount += 1;
        evidence.issues.push(
          boundedIssue("pid-lifecycle-overlap", {
            pid,
            firstToken: previous.token,
            secondToken: current.token,
          }),
        );
      }
    }
  }

  for (const [token, interval] of lifecycleIntervals) {
    const claim = finalClaims.get(token);
    if (claim?.ownerToken === rootOwnerToken) continue;
    const ownerInterval = lifecycleIntervals.get(claim?.ownerToken);
    if (
      ownerInterval !== undefined &&
      (interval.claimIndex < ownerInterval.claimIndex ||
        (ownerInterval.terminalIndex !== undefined &&
          (interval.claimIndex >= ownerInterval.terminalIndex ||
            interval.terminalIndex === undefined ||
            interval.terminalIndex > ownerInterval.terminalIndex)))
    ) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("child-owner-lifecycle-disjoint", {
          token,
          ownerToken: claim.ownerToken,
          childClaimIndex: interval.claimIndex,
          ownerClaimIndex: ownerInterval.claimIndex,
          ownerTerminalIndex: ownerInterval.terminalIndex ?? null,
        }),
      );
    }
  }

  const liveClaims = [...finalClaims.values()].filter(({ state }) => state === "live");
  const livePids = new Map();
  for (const claim of liveClaims) {
    const collision = livePids.get(claim.pid);
    if (collision !== undefined && collision !== claim.childToken) {
      evidence.ambiguousCount += 1;
      evidence.issues.push(
        boundedIssue("simultaneous-live-pid-collision", {
          pid: claim.pid,
          firstToken: collision,
          secondToken: claim.childToken,
        }),
      );
    }
    livePids.set(claim.pid, claim.childToken);
    const lineage = lineageByToken.get(claim.childToken);
    const settledAncestor = lineage?.ancestors.find(({ state }) => state !== "live");
    if (lineage?.rooted === true && settledAncestor === undefined) {
      evidence.liveOwnedCount += 1;
      if (evidence.liveOwnedEvidence.length < 8) {
        evidence.liveOwnedEvidence.push({
          tokenSha256: redactedString(claim.childToken).sha256,
          pid: claim.pid,
          ownerTokenSha256: redactedString(claim.ownerToken).sha256,
          ownerPid: claim.ownerPid,
          surface: claim.surface,
        });
      }
    } else if (lineage?.rooted === true && settledAncestor !== undefined) {
      evidence.orphanCount += 1;
      evidence.issues.push(
        boundedIssue("live-child-of-settled-owner", {
          token: claim.childToken,
          ownerToken: settledAncestor.childToken,
          ownerState: settledAncestor.state,
        }),
      );
    }
  }

  const historicalPids = new Set(
    [...finalClaims.values()].filter(({ state }) => state === "settled").map(({ pid }) => pid),
  );
  evidence.historicalPidReuseCount = Math.max(
    0,
    [...finalClaims.values()].filter(({ state }) => state === "settled").length -
      historicalPids.size,
  );

  if (evidence.orphanCount > 0) failure("orphan-child", evidence);
  if (evidence.ambiguousCount > 0) failure("ambiguous-ownership", evidence);
  if (evidence.accountingErrorCount > 0) failure("accounting-error", evidence);
  if (evidence.unownedCount > 0) failure("unowned-child", evidence);

  return Object.freeze({
    ...evidence,
    measuredWorkers: evidence.liveOwnedCount,
    ownershipEvidenceSha256: sha256(evidence),
  });
}

export function workerResourceFailureEvidence(workerOwnership, maximum) {
  return Object.freeze({
    maximum,
    measured: workerOwnership.measuredWorkers,
    groupIdSha256: redactedString(workerOwnership.groupId).sha256,
    platform: workerOwnership.platform,
    liveOwnedCount: workerOwnership.liveOwnedCount,
    settledHistoricalCount: workerOwnership.settledHistoricalCount,
    forcedTerminationCount: workerOwnership.forcedTerminationCount,
    historicalPidReuseCount: workerOwnership.historicalPidReuseCount,
    liveOwnedEvidence: workerOwnership.liveOwnedEvidence.slice(0, 8),
    ownershipEvidenceSha256: workerOwnership.ownershipEvidenceSha256,
  });
}
