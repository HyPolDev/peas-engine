"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const dgram = require("node:dgram");
const dns = require("node:dns");
const http = require("node:http");
const http2 = require("node:http2");
const https = require("node:https");
const moduleApi = require("node:module");
const net = require("node:net");
const tls = require("node:tls");
const path = require("node:path");
const fs = require("node:fs");

const lifecycleEnvironmentName = "PEAS_LOCAL_VALIDATION_WORKER_LIFECYCLE_PATH";
const auditEnvironmentName = "PEAS_NETWORK_DENIAL_AUDIT_PATH";
const expectedParentEnvironmentName = "PEAS_LOCAL_VALIDATION_WORKER_EXPECTED_PARENT_PID";
const surfaceEnvironmentName = "PEAS_LOCAL_VALIDATION_WORKER_SURFACE";

const inheritedWorkerIdentity = {
  groupId: process.env.PEAS_LOCAL_VALIDATION_WORKER_GROUP_ID,
  token: process.env.PEAS_LOCAL_VALIDATION_WORKER_TOKEN,
  ownerToken: process.env.PEAS_LOCAL_VALIDATION_WORKER_OWNER_TOKEN,
};
const hasInheritedOwner =
  typeof inheritedWorkerIdentity.ownerToken === "string" &&
  inheritedWorkerIdentity.ownerToken.length > 0;
const hasCompleteInheritedIdentity =
  hasInheritedOwner &&
  typeof inheritedWorkerIdentity.groupId === "string" &&
  inheritedWorkerIdentity.groupId.length > 0 &&
  typeof inheritedWorkerIdentity.token === "string" &&
  inheritedWorkerIdentity.token.length > 0;
if (hasInheritedOwner && !hasCompleteInheritedIdentity) {
  throw new Error("worker-accounting-inherited-identity-invalid");
}
const workerGroupId = hasCompleteInheritedIdentity
  ? inheritedWorkerIdentity.groupId
  : crypto.randomUUID();
const workerToken = hasCompleteInheritedIdentity
  ? inheritedWorkerIdentity.token
  : crypto.randomUUID();
const workerOwnerToken = hasCompleteInheritedIdentity ? inheritedWorkerIdentity.ownerToken : null;
process.env.PEAS_LOCAL_VALIDATION_WORKER_GROUP_ID = workerGroupId;
process.env.PEAS_LOCAL_VALIDATION_WORKER_TOKEN = workerToken;
const ownedChildClaims = [];
const ownedChildHandles = new WeakMap();
const inheritedLifecyclePath = process.env[lifecycleEnvironmentName];
const inheritedExpectedParentPid = Number(process.env[expectedParentEnvironmentName]);
const inheritedSurface = process.env[surfaceEnvironmentName];
if (
  workerOwnerToken !== null &&
  Number.isSafeInteger(inheritedExpectedParentPid) &&
  inheritedExpectedParentPid > 0 &&
  process.ppid === inheritedExpectedParentPid &&
  typeof inheritedSurface === "string" &&
  inheritedSurface.length > 0 &&
  typeof inheritedLifecyclePath === "string" &&
  inheritedLifecyclePath.length > 0
) {
  fs.appendFileSync(
    inheritedLifecyclePath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "worker-lifecycle",
      transition: "child-started",
      groupId: workerGroupId,
      ownerToken: workerOwnerToken,
      ownerPid: process.ppid,
      childToken: workerToken,
      pid: process.pid,
      surface: inheritedSurface,
      exitCode: null,
      signalCode: null,
      errorCode: null,
    })}\n`,
    "utf8",
  );
}

let attempts = 0;
let outboundTransportAttempts = 0;
let deniedOutboundTransportAttempts = 0;
const deniedBySurface = Object.create(null);
const deniedSurfaces = [];
const deny = (surface) => {
  const blocked = () => {
    attempts += 1;
    if (!surface.startsWith("child_process.")) {
      outboundTransportAttempts += 1;
      deniedOutboundTransportAttempts += 1;
    }
    deniedBySurface[surface] = (deniedBySurface[surface] ?? 0) + 1;
    const error = new Error(`peas-outbound-network-denied:${surface}`);
    error.code = "PEAS_NETWORK_DENIED";
    throw error;
  };
  deniedSurfaces.push(surface);
  return blocked;
};

net.connect = deny("net.connect");
net.createConnection = deny("net.createConnection");
net.Socket.prototype.connect = deny("net.Socket.connect");
tls.connect = deny("tls.connect");
http.request = deny("http.request");
http.get = deny("http.get");
https.request = deny("https.request");
https.get = deny("https.get");
http2.connect = deny("http2.connect");
dgram.createSocket = deny("dgram.createSocket");
for (const name of [
  "lookup",
  "lookupService",
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse",
]) {
  if (typeof dns[name] === "function") dns[name] = deny(`dns.${name}`);
  if (typeof dns.promises[name] === "function") dns.promises[name] = deny(`dns.promises.${name}`);
}

// Child Node processes and worker threads inherit NODE_OPTIONS/execArgv and
// therefore this preload. Non-Node executable transports are denied.
const inheritedPreload = path.resolve(__filename);
const nodeOptions = String(process.env.NODE_OPTIONS ?? "");
const inheritedNodeOptions = `--require ${JSON.stringify(inheritedPreload)}`;
const childDenialInherited =
  (nodeOptions === inheritedNodeOptions || process.execArgv.includes(inheritedPreload)) &&
  process.env.PEAS_NETWORK_DENIAL_INHERITED === "1";
const withWorkerOwnership = (args, childToken) => {
  const prepared = [...args];
  const optionsIndex = Array.isArray(prepared[0]) ? 1 : 0;
  const current = prepared[optionsIndex];
  const options =
    current === undefined || typeof current === "function"
      ? {}
      : current !== null && typeof current === "object"
        ? { ...current }
        : null;
  if (options === null) throw new Error("worker-accounting-options-invalid");
  const childEnvironment = options.env === undefined ? process.env : options.env;
  if (childEnvironment === null || typeof childEnvironment !== "object") {
    throw new Error("worker-accounting-environment-invalid");
  }
  const lifecyclePath = hasCompleteInheritedIdentity
    ? process.env[lifecycleEnvironmentName]
    : childEnvironment[lifecycleEnvironmentName];
  const auditPath = hasCompleteInheritedIdentity
    ? process.env[auditEnvironmentName]
    : childEnvironment[auditEnvironmentName];
  if (typeof lifecyclePath !== "string" || lifecyclePath.length === 0) {
    throw new Error("worker-accounting-lifecycle-path-missing");
  }
  if (typeof auditPath !== "string" || auditPath.length === 0) {
    throw new Error("worker-accounting-audit-path-missing");
  }
  options.env = {
    ...childEnvironment,
    NODE_OPTIONS: inheritedNodeOptions,
    PEAS_NETWORK_DENIAL_INHERITED: "1",
    [auditEnvironmentName]: auditPath,
    [lifecycleEnvironmentName]: lifecyclePath,
    PEAS_LOCAL_VALIDATION_WORKER_GROUP_ID: workerGroupId,
    PEAS_LOCAL_VALIDATION_WORKER_TOKEN: childToken,
    PEAS_LOCAL_VALIDATION_WORKER_OWNER_TOKEN: workerToken,
    [expectedParentEnvironmentName]: String(process.pid),
  };
  if (typeof current === "function") prepared.splice(optionsIndex, 0, options);
  else prepared[optionsIndex] = options;
  return { prepared, lifecyclePath, childEnvironment: options.env };
};

const childClaim = (surface, childToken) => ({
  schemaVersion: 1,
  groupId: workerGroupId,
  ownerToken: workerToken,
  ownerPid: process.pid,
  childToken,
  pid: null,
  surface,
  state: "live",
  exitCode: null,
  signalCode: null,
  errorCode: null,
});

const lifecycleRecord = (claim, transition) => ({
  schemaVersion: 1,
  kind: "worker-lifecycle",
  transition,
  groupId: claim.groupId,
  ownerToken: claim.ownerToken,
  ownerPid: claim.ownerPid,
  childToken: claim.childToken,
  pid: claim.pid,
  surface: claim.surface,
  exitCode: claim.exitCode,
  signalCode: claim.signalCode,
  errorCode: claim.errorCode,
});

const appendLifecycle = (lifecyclePath, claim, transition) => {
  if (typeof lifecyclePath !== "string" || lifecyclePath.length === 0) return;
  fs.appendFileSync(
    lifecyclePath,
    `${JSON.stringify(lifecycleRecord(claim, transition))}\n`,
    "utf8",
  );
};

const markAccountingError = (claim, lifecyclePath, errorCode) => {
  if (claim.state === "accounting-error") return;
  claim.state = "accounting-error";
  claim.exitCode = null;
  claim.signalCode = null;
  claim.errorCode = typeof errorCode === "string" && errorCode.length > 0 ? errorCode : "unknown";
  appendLifecycle(lifecyclePath, claim, "accounting-error");
};

const recordSynchronousChild = (claim, result, lifecyclePath) => {
  claim.pid = Number.isSafeInteger(result?.pid) && result.pid > 0 ? result.pid : null;
  if (claim.pid === null) {
    markAccountingError(claim, lifecyclePath, result?.error?.code ?? "spawn-result-pid-missing");
    return;
  }
  appendLifecycle(lifecyclePath, claim, "claimed");
  const exitCode = Number.isInteger(result?.status) ? result.status : null;
  const signalCode = typeof result?.signal === "string" ? result.signal : null;
  const errorCode = typeof result?.error?.code === "string" ? result.error.code : null;
  if (errorCode !== null || (exitCode === null) === (signalCode === null)) {
    markAccountingError(claim, lifecyclePath, errorCode ?? "spawn-result-terminal-invalid");
    return;
  }
  claim.exitCode = exitCode;
  claim.signalCode = signalCode;
  claim.state = "settled";
  appendLifecycle(lifecyclePath, claim, "settled");
};

const recordAsynchronousChild = (claim, child, lifecyclePath) => {
  claim.pid = Number.isSafeInteger(child?.pid) && child.pid > 0 ? child.pid : null;
  if (claim.pid === null || typeof child?.once !== "function") {
    markAccountingError(claim, lifecyclePath, "spawn-result-pid-missing");
    return;
  }
  ownedChildHandles.set(child, claim);
  appendLifecycle(lifecyclePath, claim, "claimed");
  child.once("exit", (code, signal) => {
    if (claim.state !== "live") return;
    const exitCode = Number.isInteger(code) ? code : null;
    const signalCode = typeof signal === "string" ? signal : null;
    if ((exitCode === null) === (signalCode === null)) {
      markAccountingError(claim, lifecyclePath, "child-exit-terminal-invalid");
      return;
    }
    claim.exitCode = exitCode;
    claim.signalCode = signalCode;
    claim.state = "settled";
    appendLifecycle(lifecyclePath, claim, "settled");
  });
  child.once("error", (error) => {
    markAccountingError(claim, lifecyclePath, error?.code);
  });
};

const snapshotClaims = () => ownedChildClaims.map((claim) => ({ ...claim }));

const wrapExecutable = (name, original, synchronous) =>
  function guarded(command, ...args) {
    if (path.resolve(String(command)) !== path.resolve(process.execPath) || !childDenialInherited) {
      return deny(name)();
    }
    const childToken = crypto.randomUUID();
    const claim = childClaim(name, childToken);
    ownedChildClaims.push(claim);
    let lifecyclePath;
    try {
      const ownership = withWorkerOwnership(args, childToken);
      lifecyclePath = ownership.lifecyclePath;
      ownership.childEnvironment[surfaceEnvironmentName] = name;
      appendLifecycle(lifecyclePath, claim, "spawn-intent");
      const result = Reflect.apply(original, this, [command, ...ownership.prepared]);
      if (synchronous) recordSynchronousChild(claim, result, lifecyclePath);
      else recordAsynchronousChild(claim, result, lifecyclePath);
      return result;
    } catch (error) {
      markAccountingError(claim, lifecyclePath, error?.code);
      throw error;
    }
  };
childProcess.spawn = wrapExecutable("child_process.spawn", childProcess.spawn, false);
childProcess.spawnSync = wrapExecutable("child_process.spawnSync", childProcess.spawnSync, true);
childProcess.exec = deny("child_process.exec");
childProcess.execSync = deny("child_process.execSync");
childProcess.execFile = wrapExecutable("child_process.execFile", childProcess.execFile, false);
childProcess.execFileSync = wrapExecutable(
  "child_process.execFileSync",
  childProcess.execFileSync,
  true,
);
const originalFork = childProcess.fork;
childProcess.fork = function guardedFork(modulePath, ...args) {
  if (!childDenialInherited) return deny("child_process.fork")();
  const childToken = crypto.randomUUID();
  const claim = childClaim("child_process.fork", childToken);
  ownedChildClaims.push(claim);
  let lifecyclePath;
  try {
    const ownership = withWorkerOwnership(args, childToken);
    lifecyclePath = ownership.lifecyclePath;
    ownership.childEnvironment[surfaceEnvironmentName] = "child_process.fork";
    appendLifecycle(lifecyclePath, claim, "spawn-intent");
    const child = Reflect.apply(originalFork, this, [modulePath, ...ownership.prepared]);
    recordAsynchronousChild(claim, child, lifecyclePath);
    return child;
  } catch (error) {
    markAccountingError(claim, lifecyclePath, error?.code);
    throw error;
  }
};
globalThis.fetch = deny("fetch");
if (typeof globalThis.WebSocket === "function") globalThis.WebSocket = deny("WebSocket");
moduleApi.syncBuiltinESMExports();

globalThis.__PEAS_NETWORK_DENIAL__ = Object.freeze({
  installed: true,
  boundary: "node-process-capability-closure-v2",
  childDenialInherited,
  deniedSurfaces: Object.freeze([...deniedSurfaces]),
  attempts: () => attempts,
  outboundTransportAttempts: () => outboundTransportAttempts,
  deniedOutboundTransportAttempts: () => deniedOutboundTransportAttempts,
  successfulOutboundTransports: () => outboundTransportAttempts - deniedOutboundTransportAttempts,
  settledOwnedChildHandle: (handle) => {
    const claim =
      handle !== null && typeof handle === "object" ? ownedChildHandles.get(handle) : undefined;
    return (
      claim !== undefined &&
      claim.state === "settled" &&
      claim.pid === handle.pid &&
      claim.exitCode === handle.exitCode &&
      claim.signalCode === handle.signalCode &&
      ((Number.isInteger(handle.exitCode) && handle.signalCode === null) ||
        (handle.exitCode === null && typeof handle.signalCode === "string"))
    );
  },
  workerOwnership: () => ({
    schemaVersion: 1,
    groupId: workerGroupId,
    token: workerToken,
    ownerToken: workerOwnerToken,
    pid: process.pid,
    claims: snapshotClaims(),
  }),
});

const auditPath = process.env.PEAS_NETWORK_DENIAL_AUDIT_PATH;
if (auditPath) {
  process.once("exit", () => {
    const usage = process.resourceUsage();
    const handles =
      typeof process._getActiveHandles === "function" ? process._getActiveHandles() : [];
    fs.appendFileSync(
      auditPath,
      `${JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        ppid: process.ppid,
        nodeTestChild:
          typeof process.env.NODE_TEST_CONTEXT === "string" &&
          process.env.NODE_TEST_CONTEXT.length > 0,
        childDenialInherited,
        outboundTransportAttempts,
        deniedOutboundTransportAttempts,
        successfulOutboundTransports: outboundTransportAttempts - deniedOutboundTransportAttempts,
        deniedBySurface,
        resourceUsage: usage,
        memoryUsage: process.memoryUsage(),
        activeHandleKinds: handles.map((handle) => handle?.constructor?.name ?? "Unknown"),
        workerOwnership: {
          schemaVersion: 1,
          groupId: workerGroupId,
          token: workerToken,
          ownerToken: workerOwnerToken,
        },
        ownedChildClaims: snapshotClaims(),
      })}\n`,
      "utf8",
    );
  });
}
