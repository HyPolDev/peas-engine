"use strict";

const dgram = require("node:dgram");
const dns = require("node:dns");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");

let attempts = 0;
const deny = () => {
  attempts += 1;
  const error = new Error("peas-outbound-network-denied");
  error.code = "PEAS_NETWORK_DENIED";
  throw error;
};

net.connect = deny;
net.createConnection = deny;
tls.connect = deny;
http.request = deny;
http.get = deny;
https.request = deny;
https.get = deny;
dgram.createSocket = deny;
dns.lookup = deny;
dns.resolve = deny;
dns.promises.lookup = deny;
dns.promises.resolve = deny;
globalThis.fetch = deny;
if (typeof globalThis.WebSocket === "function") globalThis.WebSocket = deny;
globalThis.__PEAS_NETWORK_DENIAL__ = Object.freeze({
  installed: true,
  attempts: () => attempts,
});
