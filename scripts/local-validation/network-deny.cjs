"use strict";

const childProcess = require("node:child_process");
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

let attempts = 0;
const deniedBySurface = Object.create(null);
const deniedSurfaces = [];
const deny = (surface) => {
  const blocked = () => {
    attempts += 1;
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
const childDenialInherited =
  (nodeOptions.includes("network-deny.cjs") || process.execArgv.includes(inheritedPreload)) &&
  process.env.PEAS_NETWORK_DENIAL_INHERITED === "1";
const wrapExecutable = (name, original) =>
  function guarded(command, ...args) {
    if (path.resolve(String(command)) !== path.resolve(process.execPath) || !childDenialInherited) {
      return deny(name)();
    }
    return Reflect.apply(original, this, [command, ...args]);
  };
childProcess.spawn = wrapExecutable("child_process.spawn", childProcess.spawn);
childProcess.spawnSync = wrapExecutable("child_process.spawnSync", childProcess.spawnSync);
childProcess.exec = deny("child_process.exec");
childProcess.execSync = deny("child_process.execSync");
childProcess.execFile = wrapExecutable("child_process.execFile", childProcess.execFile);
childProcess.execFileSync = wrapExecutable("child_process.execFileSync", childProcess.execFileSync);
const originalFork = childProcess.fork;
childProcess.fork = function guardedFork(modulePath, ...args) {
  if (!childDenialInherited) return deny("child_process.fork")();
  return Reflect.apply(originalFork, this, [modulePath, ...args]);
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
        childDenialInherited,
        successfulOutboundTransports: 0,
        deniedBySurface,
        resourceUsage: usage,
        activeHandleKinds: handles.map((handle) => handle?.constructor?.name ?? "Unknown"),
      })}\n`,
      "utf8",
    );
  });
}
