import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { canonicalHash } from "../dist/src/core/hash.js";
import { deriveInstrumentId } from "../dist/src/providers/market-reference/identity.js";
import { deriveIssuerMappingId } from "../dist/src/providers/observation-ledger.js";

const MAPPING_AUTHORITY = "peas-event-beta-public-listing-research";
const MAPPING_VERSION = "2026-08-29-v1";
const CATALOG_DOMAIN = "peas/market-acquisition-alias-authority-catalog/v1";
const facts = [
  ["AVGO", "0001730168", "XNAS", "common-share", "https://investors.broadcom.com"],
  ["CIEN", "0000936395", "XNYS", "common-share", "https://investor.ciena.com"],
  ["DOCU", "0001261333", "XNAS", "common-share", "https://investor.docusign.com"],
  ["HPE", "0001645590", "XNYS", "common-share", "https://investors.hpe.com"],
  ["LULU", "0001397187", "XNAS", "common-share", "https://corporate.lululemon.com"],
  ["SPY", "0000884394", "ARCX", "exchange-traded-fund-share", "https://www.ssga.com/spy"],
  ["XLK", "0001064642", "ARCX", "exchange-traded-fund-share", "https://www.ssga.com/xlk"],
  ["XLY", "0001064642", "ARCX", "exchange-traded-fund-share", "https://www.ssga.com/xly"],
];

function recordFor([symbol, cik, venue, issueType, source]) {
  const issuerMappingPreimage = {
    issuerCik: cik,
    symbols: [symbol],
    selectedSymbol: symbol,
    mappingAuthority: MAPPING_AUTHORITY,
    mappingVersion: MAPPING_VERSION,
    effectiveFromMs: 0,
    effectiveToMs: null,
  };
  const issuerMappingId = deriveIssuerMappingId(issuerMappingPreimage);
  const instrumentPreimage = {
    issuerMappingId,
    securityAuthority: MAPPING_AUTHORITY,
    securityKey: `${cik}:${symbol}:${venue}:USD`,
    issueType,
    shareClass: "common",
    primaryListingVenueCode: venue,
    currency: "USD",
    roundLotSize: 100,
    effectiveFromNs: "0",
    effectiveToNs: null,
    predecessorInstrumentId: null,
    transitionReason: null,
  };
  const instrumentId = deriveInstrumentId(instrumentPreimage);
  const symbolAliasPreimage = {
    instrumentId,
    symbol,
    mappingAuthority: MAPPING_AUTHORITY,
    mappingVersion: MAPPING_VERSION,
    mappingArtifactDigest: createHash("sha256")
      .update(`event-beta-public-listing:${cik}:${symbol}:${venue}:${source}`, "utf8")
      .digest("hex"),
    effectiveFromNs: "0",
    effectiveToNs: null,
  };
  return {
    canonicalSymbol: symbol,
    issuerMappingPreimage,
    issuerMappingId,
    instrumentPreimage,
    instrumentId,
    symbolAliasPreimage,
    symbolAliasId: `msa1_${canonicalHash("peas/market-symbol-alias/v1", symbolAliasPreimage)}`,
  };
}

const preimage = {
  schemaVersion: "peas-event-beta-alias-authority-catalog-v1",
  classification: "project-authored-provider-free-public-mapping",
  providerEvidence: false,
  networkAuthorized: false,
  records: facts.map(recordFor),
};
const catalog = {
  ...preimage,
  catalogId: `maac1_${canonicalHash(CATALOG_DOMAIN, preimage)}`,
};
const output = path.resolve(
  process.argv[2] ?? "config/event-beta/2026-09-02-to-2026-09-03.alias-authority-catalog.json",
);
writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ catalogId: catalog.catalogId, output })}\n`);
