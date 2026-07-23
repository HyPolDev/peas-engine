import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  loadRecordedMarketFixture,
  type RecordedMarketFixtureManifestV1,
} from "../src/adapters/market-reference/recorded-market-loader.js";
import {
  deriveAcquisitionObservationId,
  deriveIssuerMappingId,
} from "../src/providers/observation-ledger.js";
import type {
  MarketSelectionRequestV1,
  NormalizedMarketFactV1,
  RecordedMarketRecordV1,
  TrustedObservationBasisV1,
} from "../src/providers/market-reference/contracts.js";
import {
  MARKET_CONTRACT_AUTHORITY_REGISTRY_ID,
  MARKET_REFERENCE_KINDS,
} from "../src/providers/market-reference/contracts.js";
import {
  deriveArtifactContentId,
  deriveCanonicalId,
  deriveDurableRevisionEvidenceHash,
  deriveEndpointChannelId,
  deriveEntitlementSnapshotId,
  deriveInstrumentId,
  deriveMarketAcquisitionId,
  deriveMarketDatasetId,
  deriveMarketFeedId,
  deriveMarketProviderId,
  deriveRawArtifactId,
  deriveAdmittedRevisionSetHash,
  deriveRecordedCorpusCutoffId,
  deriveRecordedCorpusSnapshotId,
  deriveSelectionPolicyId,
  deriveValidatedMarketReferenceJoinKey,
  deriveVenueTapeId,
} from "../src/providers/market-reference/identity.js";
import {
  canonicalDecimalFromToken,
  deriveCanonicalProviderPayloadDigest,
  normalizeRecordedMarketRecord,
} from "../src/providers/market-reference/normalization.js";
import {
  type RecordedFixtureSeedMember,
  recordedFixtureArtifactStore,
} from "./recorded-fixture-artifact-store.js";

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const providerId = deriveMarketProviderId({
  providerCode: "peas-integration-synthetic",
  serviceOperatorCode: "peas-project",
});
const datasetId = deriveMarketDatasetId({
  providerId,
  assetClass: "us-equity",
  coverageRegion: "fictional-us",
  productFamily: "integration-synthetic",
  apiGeneration: "v1",
  recordFamily: "recorded",
  datasetDocumentationVersion: "synthetic-v1",
});
const feedId = deriveMarketFeedId({
  datasetId,
  providerFeedCode: "synthetic-sip",
  consolidationKind: "sip-consolidated",
  delayClass: "historical",
  adjustmentMode: "raw",
  correctionRepresentation: "revision-stream",
});
const endpointChannelId = deriveEndpointChannelId({
  feedId,
  channelKind: "recorded-synthetic",
  methodKind: "recorded",
  safeRouteLabel: "integration-synthetic-recorded",
  endpointDocumentationVersion: "synthetic-v1",
  paginationKind: "recorded-manifest",
  factKinds: ["quote", "trade"],
});
const entitlementSnapshotId = deriveEntitlementSnapshotId({
  providerId,
  productCode: "project-owned-synthetic",
  accountClass: "not-applicable",
  professionalStatus: "not-applicable",
  effectiveFromMs: 0,
  effectiveToMs: null,
  capabilities: [
    {
      datasetId,
      feedId,
      endpointChannelId,
      use: "offline-replay",
      status: "granted",
      maximumRawRetentionDays: null,
      survivesTermination: true,
    },
  ],
  permissionEvidenceHash: digest("project-authored-original-synthetic"),
  humanApprovalId: null,
  zeroIncrementalSpend: true,
});

export const MARKET_SOURCE = Object.freeze({
  providerId,
  datasetId,
  feedId,
  endpointChannelId,
  entitlementSnapshotId,
});

export const ISSUER_MAPPING_ID = deriveIssuerMappingId({
  issuerCik: "0000000001",
  symbols: ["PEAS"],
  selectedSymbol: "PEAS",
  mappingAuthority: "peas-synthetic-fixture",
  mappingVersion: "v1",
  effectiveFromMs: 0,
  effectiveToMs: null,
});

export const INSTRUMENT_ID = deriveInstrumentId({
  issuerMappingId: ISSUER_MAPPING_ID,
  securityAuthority: "peas-synthetic",
  securityKey: "fictional-common-1",
  issueType: "common-share",
  shareClass: "A",
  primaryListingVenueCode: "XNAS",
  currency: "USD",
  roundLotSize: 100,
  effectiveFromNs: "0",
  effectiveToNs: null,
  predecessorInstrumentId: null,
  transitionReason: null,
});

const venueTapeId = deriveVenueTapeId({
  planCode: "utp",
  networkCode: "C",
  participantCode: "Q",
  venueCode: "XNAS",
  protocolName: "PEAS synthetic UTP subset",
  protocolVersion: "v1",
});
const acquisitionObservationId = deriveAcquisitionObservationId({
  provider: "peas-integration-synthetic",
  retrievalAttemptId: "integration-attempt-1",
  sanitizedRequestIdentityHash: digest("integration-request"),
  routeLabel: "integration-synthetic-recorded",
});
const marketAcquisitionId = deriveMarketAcquisitionId({
  acquisitionObservationId,
  ...MARKET_SOURCE,
  instrumentIds: [INSTRUMENT_ID],
  requestedFactKinds: ["quote", "trade"],
  queryStartNs: "0",
  queryEndNs: "1000000000000",
  sortOrder: "event-time-ascending",
  routePolicyVersion: "synthetic-v1",
});
const artifactContentId = deriveArtifactContentId({
  sha256: digest("integration synthetic bytes"),
  sizeBytes: 27,
  mediaType: "application/json",
  contentEncoding: "identity",
});
const rawArtifactId = deriveRawArtifactId({
  artifactContentId,
  vaultObservationId: digest("integration-vault-observation"),
  vaultObservationHash: digest("integration-vault-observation-hash"),
  acquisitionObservationId,
  role: "integration-synthetic-market-page",
});

export const CAPTURE_BASIS = Object.freeze({
  basisKind: "capture",
  eventId: digest("integration-event"),
  receivedAtMs: 105_000,
  logicalAtMs: 105_000,
  clockBasisId: `clk1_${digest("integration-capture-clock")}`,
} as const satisfies TrustedObservationBasisV1);

export const RETRIEVAL_BASIS = Object.freeze({
  basisKind: "retrieval",
  role: "integration-synthetic-market-page",
  acquisitionObservationId,
  vaultObservationId: digest("integration-vault-observation"),
  retrievedAtMs: 104_000,
  clockBasisId: `clk1_${digest("integration-retrieval-clock")}`,
} as const satisfies TrustedObservationBasisV1);

function decimal(value: string) {
  return canonicalDecimalFromToken(value);
}

export function quoteRecord(
  options: Readonly<{
    eventTimeNs?: string;
    bid?: string;
    ask?: string;
    family?: string;
    revisionKey?: string;
    occurrenceOrdinal?: number;
    memberKey?: string;
    revisionKind?: "original" | "correction" | "cancellation";
    supersedesRevisionId?: string | null;
    durablyRecordedAtMs?: number;
    durableLogicalAtMs?: number;
    durableClockBasisId?: string;
    primaryCorpusMember?: boolean;
  }> = {},
): RecordedMarketRecordV1 {
  const family = options.family ?? "integration-quote-family";
  const revisionKey = options.revisionKey ?? "revision-1";
  const revisionKind = options.revisionKind ?? "original";
  const payload =
    revisionKind === "cancellation"
      ? null
      : {
          kind: "quote" as const,
          quoteKind: "nbbo" as const,
          bidPrice: decimal(options.bid ?? "10.00"),
          askPrice: decimal(options.ask ?? "10.02"),
          bidSize: decimal("100"),
          askSize: decimal("200"),
          explicitConsolidatedNbbo: true,
          condition: "eligible" as const,
          slow: false,
          luldState: "executable" as const,
          halted: false,
        };
  return {
    source: MARKET_SOURCE,
    instrumentId: INSTRUMENT_ID,
    venueTapeId,
    providerRecordKey: family,
    providerRevisionKey: revisionKey,
    providerStableRecordFamily: family,
    eventKind: "quote",
    eventTime: {
      epochNs: options.eventTimeNs ?? "100000000000",
      semantic: "participant-publication",
      precisionNs: "1000000",
    },
    providerSequence: null,
    sequenceSessionDate: "2027-02-03",
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(payload),
    marketAcquisitionId,
    rawArtifactId,
    memberKey: options.memberKey ?? `${family}-${revisionKey}`,
    occurrenceOrdinal: options.occurrenceOrdinal ?? 0,
    revisionKind,
    supersedesRevisionId: options.supersedesRevisionId ?? null,
    effectiveEventTime: null,
    sessionKind: "regular-continuous",
    currency: "USD",
    payload,
    normalizerVersion: "market-normalizer-v1",
    conditionPolicyVersion: "synthetic-utp-v1",
    calendarVersion: "synthetic-calendar-v1",
    parserContractVersion: "synthetic-parser-v1",
    durablyRecordedAtMs: options.durablyRecordedAtMs ?? 105_000,
    durableLogicalAtMs: options.durableLogicalAtMs ?? options.durablyRecordedAtMs ?? 105_000,
    durableClockBasisId: options.durableClockBasisId ?? CAPTURE_BASIS.clockBasisId,
    primaryCorpusMember: options.primaryCorpusMember ?? true,
  };
}

export function tradeRecord(eventTimeNs = "104000000000"): RecordedMarketRecordV1 {
  const payload = {
    kind: "trade" as const,
    tradeKind: "last-eligible" as const,
    price: decimal("10.51"),
    size: decimal("100"),
    updatesConsolidatedLast: true as const,
    oddLot: false,
  };
  return {
    ...quoteRecord({
      eventTimeNs,
      family: "integration-trade-family",
      revisionKey: "trade-revision-1",
    }),
    eventKind: "trade",
    canonicalProviderPayloadDigest: deriveCanonicalProviderPayloadDigest(payload),
    payload,
  };
}

export function normalizeQuote(
  options: Parameters<typeof quoteRecord>[0] = {},
): NormalizedMarketFactV1 {
  return normalizeRecordedMarketRecord(quoteRecord(options));
}

export function marketRequest(
  options: Readonly<{
    basis?: "capture" | "retrieval";
    viewKind?: "recorded-primary" | "recorded-corrected";
    referenceKind?: MarketSelectionRequestV1["referenceKind"];
    targetTimeNs?: string;
    comparator?: MarketSelectionRequestV1["asOfBasis"]["comparator"];
    facts?: readonly NormalizedMarketFactV1[];
  }> = {},
): MarketSelectionRequestV1 {
  const basis = options.basis === "retrieval" ? RETRIEVAL_BASIS : CAPTURE_BASIS;
  const anchorRole =
    options.basis === "retrieval"
      ? "h001-mandatory-retrieval-sensitivity"
      : "h001-primary-durable-capture";
  const join = deriveValidatedMarketReferenceJoinKey({
    subject: "fictional-integration-event",
    issuerMappingId: ISSUER_MAPPING_ID,
    selectedSourceObservationId: `sob1_${digest("integration-source-observation")}`,
    selectedSourceVersionIdentity: `svr1_${digest("integration-source-version")}`,
    trustedObservationBasis: basis,
  });
  const viewKind = options.viewKind ?? "recorded-primary";
  const comparator = options.comparator ?? "at-or-before";
  const facts = options.facts ?? [];
  const sourcePolicy = {
    policyVersion: "market-source-policy-v1" as const,
    authorizationMode: "synthetic-offline-only" as const,
    primarySource: MARKET_SOURCE,
    comparisonSources: [],
    fallbackKind: "none" as const,
    selectionIsolation: "per-source" as const,
  };
  const corpusClosedAtMs = Math.max(105_000, ...facts.map((fact) => fact.durablyRecordedAtMs));
  const recordedCorpus = {
    schemaVersion: 1 as const,
    marketReferenceJoinKey: join.marketReferenceJoinKey,
    sourcePolicy,
    marketAcquisitionIds: [...new Set(facts.map((fact) => fact.marketAcquisitionId))].sort(),
    rawArtifactIds: [...new Set(facts.map((fact) => fact.rawArtifactId))].sort(),
    providerObservationIds: [...new Set(facts.map((fact) => fact.providerObservationId))].sort(),
    revisionEvidence: [
      ...new Map(
        facts.map((fact) => {
          const evidence = {
            revisionId: fact.revisionId,
            deliveryId: fact.deliveryId,
            rawArtifactId: fact.rawArtifactId,
            durablyRecordedAtMs: fact.durablyRecordedAtMs,
            logicalAtMs: fact.durableLogicalAtMs,
            clockBasisId: fact.durableClockBasisId,
          };
          return [
            `${fact.revisionId}\u0000${fact.deliveryId}`,
            {
              ...evidence,
              durableEvidenceHash: deriveDurableRevisionEvidenceHash(evidence),
            },
          ];
        }),
      ).values(),
    ].sort((left, right) =>
      `${left.revisionId}\u0000${left.deliveryId}`.localeCompare(
        `${right.revisionId}\u0000${right.deliveryId}`,
      ),
    ),
    corpusClosedAtMs,
    corpusClosedLogicalAtMs: corpusClosedAtMs,
    corpusClockBasisId: CAPTURE_BASIS.clockBasisId,
    corpusClosureEvidenceHash: digest(`integration-corpus-closure:${corpusClosedAtMs}`),
  };
  const recordedCorpusSnapshotId = deriveRecordedCorpusSnapshotId(recordedCorpus);
  const admittedRevisionSetHash = deriveAdmittedRevisionSetHash(
    [...new Set(facts.map((fact) => fact.revisionId))].sort(),
  );
  const correctedCutoffNs =
    viewKind === "recorded-corrected"
      ? (BigInt(CAPTURE_BASIS.receivedAtMs) * 1_000_000n + 604_800_000_000_000n).toString()
      : null;
  const corpusCutoff = {
    corpusSnapshotId: recordedCorpusSnapshotId,
    cutoffObservationEvidenceHash: digest(`integration-cutoff-${viewKind}`),
    admittedRevisionSetHash,
    ...(viewKind === "recorded-primary"
      ? {
          viewKind: "recorded-primary" as const,
          cutoffKind: "primary-corpus-closure" as const,
          cutoffTargetNs: null,
        }
      : {
          viewKind: "recorded-corrected" as const,
          cutoffKind: "capture-t0-plus-seven-days" as const,
          cutoffTargetNs: correctedCutoffNs as string,
        }),
  };
  const corpusCutoffId = deriveRecordedCorpusCutoffId(corpusCutoff);
  const intervalDefinitions = [
    {
      intervalKind: "prior-close" as const,
      anchorKind: "previous-eligible-listing-session" as const,
      offsetNs: null,
      comparator: "authoritative-prior-close" as const,
      sessionRule: "prior-eligible-session" as const,
    },
    {
      intervalKind: "publication-pre" as const,
      anchorKind: "earnings-publication" as const,
      offsetNs: "0",
      comparator: "strictly-before" as const,
      sessionRule: "cross-session-allowed" as const,
    },
    {
      intervalKind: "t0" as const,
      anchorKind: "h001-selected-basis" as const,
      offsetNs: "0",
      comparator: "at-or-before" as const,
      sessionRule: "anchor-session" as const,
    },
    {
      intervalKind: "t1" as const,
      anchorKind: "h001-selected-basis" as const,
      offsetNs: "60000000000",
      comparator: "at-or-before" as const,
      sessionRule: "same-session-as-t0" as const,
    },
    {
      intervalKind: "t5" as const,
      anchorKind: "h001-selected-basis" as const,
      offsetNs: "300000000000",
      comparator: "at-or-before" as const,
      sessionRule: "same-session-as-t0" as const,
    },
    {
      intervalKind: "t30" as const,
      anchorKind: "h001-selected-basis" as const,
      offsetNs: "1800000000000",
      comparator: "at-or-before" as const,
      sessionRule: "same-session-as-t0" as const,
    },
  ].sort((left, right) =>
    deriveCanonicalId("mik1_", "peas/market-reference-interval/v1", left).localeCompare(
      deriveCanonicalId("mik1_", "peas/market-reference-interval/v1", right),
    ),
  );
  const selectionPolicy = {
    contractAuthorityRegistryId: MARKET_CONTRACT_AUTHORITY_REGISTRY_ID,
    primaryAnchorKind: "capture" as const,
    alternateAnchorKind: "retrieval" as const,
    alternateAnchorRequired: true as const,
    intervalDefinitions,
    targetSelector: "last-eligible-at-or-before" as const,
    publicationOriginSelector: "last-eligible-strictly-before-publication" as const,
    sourcePolicy,
    providerPriority: {
      policyVersion: "market-provider-priority-v1" as const,
      entries: [{ source: MARKET_SOURCE, role: "primary" as const, rank: 0 }],
      missingPrimaryBehavior: "typed-missing-no-fallback" as const,
    },
    eligibilityPolicy: {
      policyVersion: "market-eligibility-v1" as const,
      referenceKinds: MARKET_REFERENCE_KINDS,
      primaryReferenceKind: "quote-nbbo-midpoint" as const,
      currency: "USD" as const,
      completeWindowRequired: true as const,
      referenceSubstitution: "forbidden" as const,
      unknownConditionBehavior: "ineligible" as const,
      strictExecutableDiagnostics: ["locked", "luld-limit-state", "slow"] as const,
    },
    stalenessPolicy: {
      policyVersion: "market-staleness-v1" as const,
      regularQuoteAgeNs: "5000000000" as const,
      extendedQuoteAgeNs: "30000000000" as const,
      regularTradeAgeNs: "5000000000" as const,
      extendedTradeAgeNs: "30000000000" as const,
      completedBarAgeNs: "60000000000" as const,
      boundary: "inclusive" as const,
      negativeAgeBehavior: "ineligible" as const,
      overnightPrimaryAgeNs: null,
    },
    correctionPolicy: {
      policyVersion: "market-correction-policy-v1" as const,
      primaryCorpusSnapshotId: recordedCorpusSnapshotId,
      corpusCutoffId,
      ...(viewKind === "recorded-primary"
        ? {
            viewKind: "recorded-primary" as const,
            admissionKind: "member-of-primary-recorded-corpus" as const,
            correctedOffsetNs: null,
            finalCorrectedOnlyBehavior: "recorded-primary-unavailable" as const,
          }
        : {
            viewKind: "recorded-corrected" as const,
            admissionKind: "member-of-primary-or-durably-recorded-by-corrected-cutoff" as const,
            correctedOffsetNs: "604800000000000" as const,
            finalCorrectedOnlyBehavior:
              "recorded-corrected-only-if-corpus-closed-by-cutoff" as const,
          }),
    },
    tieBreakPolicy: {
      policyVersion: "market-tie-break-v1" as const,
      trustedOrder: ["source-native-total-order", "identical-economic-state", "missing"] as const,
      identicalEconomicRepresentative: "smallest-normalized-market-fact-id" as const,
      unresolvedDifferingState: "market.sequence-insufficient/equal-time-ambiguous" as const,
      forbiddenOrders: ["arrival", "artifact", "hash", "page", "provider-priority", "row"] as const,
    },
    discrepancyPolicy: {
      policyVersion: "market-discrepancy-v1" as const,
      comparisonKind: "exact-reduced-rational" as const,
      compareIndependentSources: true as const,
      equalValueMergesProvenance: false as const,
      missingBehavior: "not-comparable" as const,
      disagreementChangesPrimary: false as const,
    },
    reasonCatalogId: "market-reasons-v1" as const,
    boundsPolicyId: "market-reference-bounds-v1" as const,
  };
  const requestedInterval = intervalDefinitions.find(
    (definition) =>
      definition.comparator === comparator &&
      (comparator !== "at-or-before" || definition.intervalKind === "t0"),
  );
  if (requestedInterval === undefined) throw new Error("missing integration interval");
  const targetTimeNs =
    options.targetTimeNs ??
    (
      BigInt(basis.basisKind === "capture" ? basis.receivedAtMs : basis.retrievedAtMs) * 1_000_000n
    ).toString();
  return {
    marketReferenceJoinKey: join.marketReferenceJoinKey,
    intervalKey: deriveCanonicalId("mik1_", "peas/market-reference-interval/v1", requestedInterval),
    referenceKind: options.referenceKind ?? "quote-nbbo-midpoint",
    selectionPolicyId: deriveSelectionPolicyId(selectionPolicy),
    selectionPolicy,
    recordedCorpusSnapshotId,
    recordedCorpus,
    corpusCutoffId,
    corpusCutoff,
    context: {
      instrumentId: INSTRUMENT_ID,
      calendarSnapshotId: `cal1_${digest("integration-calendar")}`,
      targetSessionKind: "regular-continuous",
      targetWithinSession: true,
      symbolContinuity: "proved",
      corporateActionState: "none",
    },
    asOfBasis: {
      anchorRole,
      trustedObservationBasis: basis,
      targetTimeNs,
      comparator,
      viewKind,
      recordedCorpusSnapshotId,
      corpusCutoffId,
      admittedRevisionSetHash,
    },
    correctedCutoffNs,
  };
}

export async function checkedRecordedMarketFixtureAuthority() {
  const fixtureRoot = path.resolve("fixtures", "market-reference");
  const manifest = JSON.parse(
    await readFile(path.join(fixtureRoot, "fixture-manifest.json"), "utf8"),
  ) as RecordedMarketFixtureManifestV1;
  const seedMap = JSON.parse(
    await readFile(path.join(fixtureRoot, "test-seed-map.json"), "utf8"),
  ) as {
    schemaVersion: 1;
    fixtureId: string;
    members: readonly {
      role: string;
      sourceProfileId: string;
      providerCode: string;
      artifactDigest: string;
      sizeBytes: number;
      relativeBodyPath: string;
      attempt: RecordedFixtureSeedMember["attempt"];
      response: RecordedFixtureSeedMember["response"];
      retrievedAtMs: number;
    }[];
  };
  if (seedMap.schemaVersion !== 1 || seedMap.fixtureId !== manifest.fixtureId) {
    throw new Error("checked market fixture seed map mismatch");
  }
  const providerCodeByProfileId = new Map<string, string>();
  for (const sourceProfile of manifest.sourceProfiles) {
    const profileId = sourceProfile["profileId"];
    const provider = sourceProfile["provider"];
    const providerObject =
      provider !== null && typeof provider === "object" && !Array.isArray(provider)
        ? (provider as Readonly<Record<string, unknown>>)
        : undefined;
    const providerPreimage = providerObject?.["preimage"];
    const providerCode =
      providerPreimage !== null &&
      typeof providerPreimage === "object" &&
      !Array.isArray(providerPreimage)
        ? (providerPreimage as Readonly<Record<string, unknown>>)["providerCode"]
        : undefined;
    if (typeof profileId !== "string" || typeof providerCode !== "string") {
      throw new Error("checked market fixture has an invalid source profile");
    }
    providerCodeByProfileId.set(profileId, providerCode);
  }
  const seeds = seedMap.members.map((mapping, index): RecordedFixtureSeedMember => {
    const member = manifest.retrievedMembers[index];
    if (
      member === undefined ||
      member.role !== mapping.role ||
      member.sourceProfileId !== mapping.sourceProfileId ||
      member.artifactDigest !== mapping.artifactDigest ||
      member.sizeBytes !== mapping.sizeBytes
    ) {
      throw new Error("checked market fixture member seed mismatch");
    }
    const providerCode = providerCodeByProfileId.get(member.sourceProfileId);
    if (
      providerCode === undefined ||
      mapping.providerCode !== providerCode ||
      mapping.attempt.provider !== providerCode
    ) {
      throw new Error("checked market fixture member provider is invalid");
    }
    return {
      role: mapping.role,
      path: mapping.relativeBodyPath,
      artifactHash: mapping.artifactDigest,
      sizeBytes: mapping.sizeBytes,
      attempt: mapping.attempt,
      response: mapping.response,
      retrievedAtMs: mapping.retrievedAtMs,
    };
  });
  return { fixtureRoot, manifest, seeds: Object.freeze(seeds) };
}

export async function loadCheckedRecordedMarketFixture() {
  const { fixtureRoot, manifest, seeds } = await checkedRecordedMarketFixtureAuthority();
  const authority = recordedFixtureArtifactStore(fixtureRoot, seeds);
  return {
    result: await loadRecordedMarketFixture(authority.store, manifest),
    counters: authority.counters,
    manifest,
  };
}
