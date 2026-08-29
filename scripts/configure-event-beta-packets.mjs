import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { prepareCalendarEvent } from "../dist/src/domain/calendar-event-preparation.js";

const CAPABILITY_CONFIG = path.resolve(
  "config/event-beta/2026-09-02-to-2026-09-03.provider-capabilities.json",
);
const ALIAS_CATALOG = path.resolve(
  "config/event-beta/2026-09-02-to-2026-09-03.alias-authority-catalog.json",
);

function parseArguments(values) {
  const options = { source: null, output: null };
  for (const value of values) {
    if (value.startsWith("--source=")) options.source = value.slice("--source=".length);
    else if (value.startsWith("--output=")) options.output = value.slice("--output=".length);
    else throw new Error("event-beta-provider-config.argument-invalid");
  }
  if (!options.source || !options.output)
    throw new Error("event-beta-provider-config.argument-missing");
  return options;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeExclusive(file, bytes) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes, { encoding: "utf8", flag: "wx" });
}

function configuredBinding(binding, candidate, providers, instrumentBySymbol) {
  if (binding.sourceId === "sec-submissions" || binding.sourceId === "sec-filing-exhibit") {
    return { ...binding, providerId: providers.sec.providerId };
  }
  if (["issuer-release", "issuer-presentation", "issuer-webcast"].includes(binding.sourceId)) {
    return { ...binding, providerId: providers.issuerOfficial.providerId };
  }
  if (binding.sourceId === "prepared-remarks" || binding.sourceId === "transcript") {
    return {
      ...binding,
      providerId: providers.transcript.providerId,
      configuredIdentityOrPath: null,
      officialHostPlaceholder: null,
      pathPlaceholder: null,
      available: false,
      credentialRequirement: "none",
      entitlementRequirement: "none",
      liveAccessRequired: false,
    };
  }
  if (binding.sourceId === "estimates-snapshot") {
    return {
      ...binding,
      providerId: providers.fmpEstimates.providerId,
      configuredIdentityOrPath: null,
      officialHostPlaceholder: null,
      pathPlaceholder: null,
      available: false,
      credentialRequirement: "separately-authorized",
      entitlementRequirement: "separately-authorized",
      liveAccessRequired: true,
    };
  }
  if (
    binding.sourceId === "issuer-market-bars" ||
    binding.sourceId === "spy-market-bars" ||
    binding.sourceId === "sector-market-bars"
  ) {
    const symbol =
      binding.sourceId === "issuer-market-bars"
        ? candidate.marketSymbol
        : binding.sourceId === "spy-market-bars"
          ? "SPY"
          : candidate.sectorSymbol;
    const instrumentId = instrumentBySymbol.get(symbol);
    if (instrumentId === undefined) {
      throw new Error(`event-beta-provider-config.instrument-mapping-missing:${symbol}`);
    }
    return {
      ...binding,
      providerId: providers.alpacaHistoricalSipBars.providerId,
      configuredIdentityOrPath: `${instrumentId}|ALPACA:SIP:${symbol}`,
      officialHostPlaceholder: "data.alpaca.markets",
      pathPlaceholder: `/v2/stocks/bars?symbols=${symbol}&timeframe=1Min&feed=sip&adjustment=raw`,
      available: true,
      credentialRequirement: "separately-authorized",
      entitlementRequirement: "separately-authorized",
      liveAccessRequired: true,
    };
  }
  return binding;
}

const options = parseArguments(process.argv.slice(2));
const sourceRoot = path.resolve(options.source);
const outputRoot = path.resolve(options.output);
const config = readJson(CAPABILITY_CONFIG);
const aliasCatalog = readJson(ALIAS_CATALOG);
if (aliasCatalog.catalogId !== config.providers.alpacaHistoricalSipBars.aliasAuthorityCatalogId) {
  throw new Error("event-beta-provider-config.alias-catalog-identity-mismatch");
}
const instrumentBySymbol = new Map(
  aliasCatalog.records.map((record) => [record.canonicalSymbol, record.instrumentId]),
);
const manifest = {
  schemaVersion: 1,
  authoritativeBase: config.authoritativeBase,
  capabilityCatalogDigest: digest(readFileSync(CAPABILITY_CONFIG)),
  aliasAuthorityCatalogId: aliasCatalog.catalogId,
  aliasAuthorityCatalogDigest: digest(readFileSync(ALIAS_CATALOG)),
  effects: {
    network: 0,
    provider: 0,
    credential: 0,
    account: 0,
    subscription: 0,
    spending: 0,
    broker: 0,
    order: 0,
    portfolio: 0,
    position: 0,
    fill: 0,
    financialEffect: 0,
  },
  candidates: [],
};

for (const candidate of [...config.candidates].sort(
  (left, right) => left.priority - right.priority,
)) {
  const originalPreparation = readJson(
    path.join(sourceRoot, candidate.slug, "generated", "event-preparation.json"),
  );
  if (
    originalPreparation.eventPlan.planId !== candidate.expectedOriginalPlanId ||
    originalPreparation.configurationDigest !== candidate.expectedOriginalConfigurationDigest
  ) {
    throw new Error(`event-beta-provider-config.original-identity-mismatch:${candidate.slug}`);
  }
  const input = readJson(path.join(sourceRoot, candidate.slug, "input.json"));
  if (
    input.ticker !== candidate.ticker ||
    input.cik !== candidate.cik ||
    input.exchange !== candidate.exchange ||
    input.instrumentId !== candidate.instrumentId ||
    input.sectorBenchmark !== candidate.sectorSymbol
  ) {
    throw new Error(`event-beta-provider-config.candidate-mapping-mismatch:${candidate.slug}`);
  }
  const configuredInput = {
    ...input,
    instrumentId: instrumentBySymbol.get(candidate.marketSymbol),
    sourceBindings: input.sourceBindings.map((binding) =>
      configuredBinding(binding, candidate, config.providers, instrumentBySymbol),
    ),
  };
  if (configuredInput.instrumentId === undefined) {
    throw new Error(
      `event-beta-provider-config.instrument-mapping-missing:${candidate.marketSymbol}`,
    );
  }
  const result = prepareCalendarEvent(configuredInput);
  const candidateRoot = path.join(outputRoot, candidate.slug);
  const inputBytes = pretty(configuredInput);
  writeExclusive(path.join(candidateRoot, "input.json"), inputBytes);
  writeExclusive(path.join(candidateRoot, "event-preparation.json"), result.preparationJson);
  writeExclusive(path.join(candidateRoot, "provider-readiness.md"), result.checklistMarkdown);
  manifest.candidates.push({
    slug: candidate.slug,
    priority: candidate.priority,
    ticker: candidate.ticker,
    planId: result.preparation.eventPlan.planId,
    configurationDigest: result.preparation.configurationDigest,
    revisionDigest: result.preparation.eventPlan.revisionDigest,
    inputDigest: digest(inputBytes),
    preparationDigest: digest(result.preparationJson),
    readinessDigest: digest(result.checklistMarkdown),
    windows: result.preparation.eventPlan.windows,
  });
}

writeExclusive(path.join(outputRoot, "manifest.json"), pretty(manifest));
process.stdout.write(`${pretty(manifest)}`);
