# PR 2D synthetic market-reference fixture manifest

## Status and authority

- Contract status: `PROPOSED`
- Schema: `RecordedMarketFixtureManifestV1`
- Fixture classification: original project-authored synthetic data only
- Execution mode: recorded/offline only
- P1-09: `PENDING`; no real provider, feed, endpoint, or fallback is authorized

This contract integrates the four PR 2D research reports and the approved H-001 decision in
[`pr-2d-orchestration.md`](../goals/pr-2d-orchestration.md). It is subordinate to accepted ADR 0010
once published and cross-links the provider/source, timestamp/trust, eligibility, reason, resource,
acceptance, and study-freeze contracts in this directory.

Every fixture body, issuer, symbol, security key, venue, sequence, price, size, condition
combination, schedule, release, corporate action, and timestamp is newly authored synthetic
material. A public protocol code may be named to test its documented semantics, but no provider
payload, provider documentation example, licensed record, actual market price, actual event body,
account fact, credential, private correspondence, or proprietary identifier may be copied.

## Closed manifest schema

Every public value is exact inert JSON. Missing/unknown keys, inherited keys, accessors, symbols,
proxies, sparse arrays, cycles, duplicate keys, unsafe integers, non-finite values, and noncanonical
decimal/timestamp text reject before hashing, sorting, recursion, or body reads.

```ts
type RecordedMarketFixtureManifestV1 = Readonly<{
  schemaVersion: 1;
  fixtureId: string;
  caseId: string;
  contractAuthorityRegistry: ContractAuthorityRegistryV1;
  sourceProfiles: readonly SyntheticMarketSourceProfileV1[];
  acquisition: SyntheticRecordedAcquisitionV1;
  instruments: readonly SyntheticInstrumentV1[];
  calendarSnapshot: SyntheticCalendarSnapshotV1;
  retrievedMembers: readonly SyntheticRetrievedMemberV1[];
  parsedFactExpectations: readonly SyntheticParsedFactExpectationV1[];
  recordedCorpora: readonly SyntheticRecordedCorpusV1[];
  selectionRequests: readonly SyntheticSelectionRequestV1[];
  expectedResults: readonly SyntheticExpectedResultV1[];
  expectedMetrics: readonly SyntheticExpectedMetricV1[];
  expectedReasonTrace: readonly SyntheticExpectedReasonV1[];
  exercisedBounds: readonly SyntheticExercisedBoundV1[];
  provenance: SyntheticFixtureProvenanceV1;
  expectedManifestId: string;
}>;
```

`expectedManifestId` is recomputed over the other fields:

```text
fixtureId = "mfx1_" + H("peas/market-fixture/v1", {
  caseId,contractAuthorityRegistry,sourceProfiles,acquisition,instruments,
  calendarSnapshot,retrievedMembers,parsedFactExpectations,recordedCorpora,
  selectionRequests,provenance
})

expectedManifestId = "mfm1_" + H("peas/market-fixture-manifest/v1",
  manifestWithoutExpectedManifestId)
```

Displayed IDs are assertions, never authority. Validators recompute them from validated primitive
preimages using the repository canonical hash. `contractAuthorityRegistry` must recompute the
exact `car1_` accepted repair checkpoint; logical contract names without its content digest/blob/
commit bindings reject.

## Synthetic source and protocol-emulation identities

```ts
type SyntheticProviderIdentityV1 = Readonly<{
  providerId: string;
  preimage: Readonly<{
    providerCode: string;
    serviceOperatorCode: string;
  }>;
}>;

type SyntheticDatasetIdentityV1 = Readonly<{
  datasetId: string;
  preimage: Readonly<{
    providerId: string;
    assetClass: "us-equity";
    coverageRegion: string;
    productFamily: string;
    apiGeneration: string;
    recordFamily: string;
    datasetDocumentationVersion: string;
  }>;
}>;

type SyntheticFeedIdentityV1 = Readonly<{
  feedId: string;
  preimage: Readonly<{
    datasetId: string;
    providerFeedCode: string;
    consolidationKind:
      | "sip-consolidated"
      | "single-venue"
      | "provider-aggregate"
      | "derived"
      | "unknown";
    delayClass: "real-time" | "delayed-15m" | "historical" | "provider-defined" | "unknown";
    adjustmentMode: "raw" | "split" | "dividend" | "spin-off" | "all" | "provider-defined" | "unknown";
    correctionRepresentation:
      | "original-stream"
      | "revision-stream"
      | "final-corrected"
      | "unknown";
  }>;
}>;

type SyntheticEndpointIdentityV1 = Readonly<{
  endpointChannelId: string;
  preimage: Readonly<{
    feedId: string;
    channelKind:
      | "historical-rest"
      | "latest-rest"
      | "snapshot-rest"
      | "websocket"
      | "recorded-synthetic";
    methodKind: "get" | "stream" | "recorded";
    safeRouteLabel: string;
    endpointDocumentationVersion: string;
    paginationKind: "opaque-token" | "none-documented" | "stream-sequence" | "recorded-manifest";
    factKinds: readonly string[];
  }>;
}>;

type SyntheticEntitlementIdentityV1 = Readonly<{
  entitlementSnapshotId: string;
  preimage: Readonly<{
    providerId: string;
    productCode: string;
    accountClass: "project-owned-synthetic";
    professionalStatus: "not-applicable";
    effectiveFromMs: number;
    effectiveToMs: number | null;
    capabilities: readonly EntitlementCapabilityV1[];
    permissionEvidenceHash: string;
    humanApprovalId: null;
    zeroIncrementalSpend: true;
  }>;
}>;

type SyntheticMarketSourceProfileV1 = Readonly<{
  profileId: string;
  provider: SyntheticProviderIdentityV1;
  dataset: SyntheticDatasetIdentityV1;
  feed: SyntheticFeedIdentityV1;
  endpoint: SyntheticEndpointIdentityV1;
  entitlement: SyntheticEntitlementIdentityV1;
  venueTapes: readonly Readonly<{
    venueTapeId: string;
    preimage: Readonly<{
      planCode: "cta" | "utp" | "finra" | "none" | "unknown";
      networkCode: "A" | "B" | "C" | null;
      participantCode: string | null;
      venueCode: string | null;
      protocolName: string;
      protocolVersion: string;
    }>;
  }>[];
  protocolVersion: string;
  parserContractVersion: string;
  fixtureAuthorizationClass: "synthetic-offline-v1";
  marketDataClass:
    | "consolidated-quote"
    | "consolidated-trade"
    | "bar"
    | "trading-status"
    | "luld"
    | "official-value"
    | "corporate-action"
    | "instrument-reference";
  consolidationKind: "sip-emulated" | "single-venue-emulated" | "provider-defined-emulated";
  correctionRepresentation:
    | "original-stream"
    | "revision-stream"
    | "final-corrected"
    | "unknown";
  conditionMap: Readonly<{
    conditionMapId: string;
    preimage: Readonly<{
      protocolName: string;
      protocolVersion: string;
      mapVersion: string;
      canonicalMappingsDigest: string;
    }>;
  }> | null;
  emulationReference: Readonly<{
    emulationReferenceId: string;
    preimage: Readonly<{
      contractAuthorityRegistryId: string;
      logicalContractId: ContractLogicalIdV1;
      sectionLabel: string;
      semanticSubset: string;
    }>;
  }>;
}>;

profileId = "mfp1_" + H("peas/market-fixture-source-profile/v1", {
  provider,dataset,feed,endpoint,entitlement,venueTapes,protocolVersion,
  parserContractVersion,fixtureAuthorizationClass,marketDataClass,
  consolidationKind,correctionRepresentation,conditionMap,emulationReference
})

conditionMapId = "mcm1_" + H("peas/market-condition-map/v1", {
  protocolName,protocolVersion,mapVersion,canonicalMappingsDigest
})

emulationReferenceId = "mer1_" + H("peas/market-emulation-reference/v1", {
  contractAuthorityRegistryId,logicalContractId,sectionLabel,semanticSubset
})
```

The validator recomputes `mpv1_`, `mds1_`, `mfd1_`, `mec1_`, `ent1_`, and every `mvt1_` from the complete nested
preimages, verifies every child reference equals the enclosing derived ID, then recomputes
`mfp1_`. Profiles are unique and sorted by `profileId`. A member/acquisition names exactly one
`sourceProfileId`; there is no array-position or first/default profile selection.

All provider, dataset, feed, endpoint, entitlement, and security values are explicitly fictional. A profile
may state that it emulates a bounded semantic subset of a named CTA/UTP/provider contract, but
`emulationReferenceId` points to the exact accepted contract registry rather than embedding
a URL or copying an example. Profiles modeling historical SIP, delayed SIP stream, latest delayed
SIP, IEX, overnight, FMP quote/trade/bar, and two independent providers remain distinct even when
their facts and body digests agree.

Empty, `default`, `auto`, null, or inferred source components reject. `entitlementSnapshotId` MUST
be a recomputed `ent1_` identity for a project-owned synthetic snapshot whose real-provider
acquisition capabilities are all `not-authorized`; only `offline-replay` of the synthetic dataset
may be `granted`. Capabilities are exact, unique, and sorted under the identity contract.
`fixtureAuthorizationClass` permits only offline
fixture execution. It cannot satisfy or mutate P1-09 and cannot be reused by a live adapter or
study run.

## Recorded acquisition and ArtifactStore authority

```ts
type SyntheticRecordedAcquisitionV1 = Readonly<{
  sourceProfileId: string;
  acquisitionObservationId: string;
  acquisitionObservationPreimage: Readonly<{
    provider: string;
    retrievalAttemptId: string;
    sanitizedRequestIdentityHash: string;
    routeLabel: string;
  }>;
  marketAcquisitionId: string;
  marketAcquisitionPreimage: Readonly<{
    acquisitionObservationId: string;
    providerId: string;
    datasetId: string;
    feedId: string;
    endpointChannelId: string;
    entitlementSnapshotId: string;
    instrumentIds: readonly string[];
    requestedFactKinds: readonly string[];
    queryStartNs: string;
    queryEndNs: string;
    sortOrder: string;
    routePolicyVersion: string;
  }>;
  acquisitionMode: "recorded" | "replay";
  declaredPageSize: number;
  expectedPageCount: number;
  completeWindowRequired: true;
}>;

type SyntheticRetrievedMemberV1 = Readonly<{
  kind: "retrieved-synthetic";
  role: string;
  sourceProfileId: string;
  pageOrdinal: number;
  priorPageChainHash: string | null;
  terminalPage: boolean;
  bodyFormat: string;
  artifactContentId: string;
  artifactContentPreimage: Readonly<{
    sha256: string;
    sizeBytes: number;
    mediaType: string;
    contentEncoding: string;
  }>;
  rawArtifactId: string;
  rawArtifactPreimage: Readonly<{
    artifactContentId: string;
    vaultObservationId: string;
    vaultObservationHash: string;
    acquisitionObservationId: string;
    role: string;
  }>;
  artifactDigest: string;
  sizeBytes: number;
  selectedObservationId: string;
  selectedObservationHash: string;
}>;
```

`sourceProfileId` resolves exactly one profile. Its five source IDs must equal the five IDs in
`marketAcquisitionPreimage`; the acquisition observation provider must equal that profile's
synthetic provider code. The validator derives `aob1_`, then derives `maq1_` from the exact
authoritative preimage. `instrumentIds` and `requestedFactKinds` are sorted unique; query bounds,
sort order, and `routePolicyVersion` are semantic. `declaredPageSize`, page count, tokens/order,
mode, and replay execution are excluded from `maq1_`.

Each member recomputes `mac1_` and `mar1_`. Its artifact content fields must equal the verified body
digest/actual bytes/media/encoding, and its raw-artifact fields must equal the selected
ArtifactStore observation and acquisition. `sourceProfileId` must equal the acquisition profile.

The existing `ArtifactStore` is authoritative. Before parsing any member, the recorded loader must:

1. recompute acquisition, fixture, source-profile, and displayed manifest identities;
2. perform exactly one `getObservation(selectedObservationId)` per member, never a history scan;
3. reconcile provider, selected observation/hash, artifact digest, size, acquisition observation,
   retrieval epoch, and requested as-of authority;
4. acquire exactly one bounded verified read per member;
5. settle the complete metadata set and aggregate bounds before consuming any body;
6. consume each stream completely while recomputing actual byte count and SHA-256; and
7. cancel and settle every acquired sibling before returning after any acquisition, metadata, or
   consumption failure.

A manifest declaration is not evidence that an artifact or observation exists. Missing, forged,
future, wrong-provider, digest/size-mismatched, under-read, over-read, replaced, growing, or failed
streams emit no partial normalized fact or selection.

Production manifests contain no path or body bytes. A test-only `SyntheticArtifactSeedV1` may map a
fixture ID/role to a workspace-contained file or generated byte sequence solely to populate an
isolated `ArtifactStore`; it is not accepted by production loaders and never enters semantic IDs.

## Synthetic instruments and calendars

```ts
type SyntheticInstrumentV1 = Readonly<{
  issuerMappingId: string;
  issuerMappingPreimage: Readonly<{
    issuerCik: string;
    symbols: readonly string[];
    selectedSymbol: string | null;
    mappingAuthority: string;
    mappingVersion: string;
    effectiveFromMs: number | null;
    effectiveToMs: number | null;
  }>;
  instrumentId: string;
  instrumentPreimage: Readonly<{
    issuerMappingId: string;
    securityAuthority: "peas-synthetic";
    securityKey: string;
    issueType: "common-share" | "adr";
    shareClass: string;
    primaryListingVenueCode: string;
    currency: "USD";
    roundLotSize: number;
    effectiveFromNs: string;
    effectiveToNs: string | null;
    predecessorInstrumentId: string | null;
    transitionReason:
      | "symbol-change"
      | "name-change"
      | "split"
      | "reverse-split"
      | "listing-transfer"
      | "share-class-change"
      | "merger"
      | "spin-off"
      | "conversion"
      | "adr-ratio-change"
      | null;
  }>;
  symbolAliases: readonly Readonly<{
    symbolAliasId: string;
    preimage: Readonly<{
      instrumentId: string;
      symbol: string;
      mappingAuthority: string;
      mappingVersion: string;
      mappingArtifactDigest: string;
      effectiveFromNs: string;
      effectiveToNs: string | null;
    }>;
  }>[];
}>;

type SyntheticCalendarSnapshotV1 = Readonly<{
  calendarSnapshotId: string;
  calendarVersion: string;
  calendarDigest: string;
  timezone: "America/New_York";
  tzdbVersion: string;
  tzdbDigest: string;
  dates: readonly Readonly<{
    localDate: string;
    sessionStatus: "open" | "holiday";
    regularOpenNs: string | null;
    regularCloseNs: string | null;
    extendedPreStartNs: string | null;
    extendedPostEndNs: string | null;
    earlyClose: boolean;
  }>[];
}>;

calendarSnapshotId = "mcal1_" + H("peas/market-calendar-snapshot/v1", {
  calendarVersion,calendarDigest,timezone,tzdbVersion,tzdbDigest,dates
})
```

The validator recomputes inherited `imap1_`, `min1_`, every `msa1_`, and `mcal1_` in dependency
order. The direct `min1_` value is the effective instrument-version identity; no second wrapper or
predecessor-version alias exists. Predecessor and transition are both null or both non-null.
Symbol-alias rows are unique/sorted by `symbolAliasId`, and every alias instrument ID equals its
parent.

All identifiers are fictitious. Symbol is an effective-dated alias, not instrument identity.
Holiday, early-close, and DST cases are generated from fictional calendar entries whose expected
UTC boundaries model the accepted rules; no copied exchange dataset is required.

## Parsed-fact oracle

`parsedFactExpectations` is a test oracle, never normalization authority. The implementation must
derive each fact from verified bytes and compare the complete recomputed fact/identity map in both
directions.

```ts
type SyntheticParsedFactExpectationV1 = Readonly<{
  memberRole: string;
  recordOrdinal: number;
  sourceProfileId: string;
  instrumentId: string;
  providerObservationId: string;
  providerObservationPreimage: Readonly<{
    providerId: string;
    datasetId: string;
    feedId: string;
    endpointChannelId: string;
    entitlementSnapshotId: string;
    instrumentId: string;
    venueTapeId: string | null;
    providerRecordKey: string | null;
    providerRevisionKey: string | null;
    eventKind: string;
    eventTime: Readonly<{ epochNs: string; semantic: string; precisionNs: string }>;
    providerSequence: Readonly<{ value: string; scope: string; trustClass: string }> | null;
    sequenceSessionDate: string | null;
    canonicalProviderPayloadDigest: string;
  }>;
  deliveryId: string;
  deliveryPreimage: Readonly<{
    providerObservationId: string;
    marketAcquisitionId: string;
    rawArtifactId: string;
    memberKey: string;
    occurrenceOrdinal: number;
  }>;
  revisionFamilyId: string;
  revisionFamilyPreimage: Readonly<{
    providerId: string;
    datasetId: string;
    feedId: string;
    endpointChannelId: string;
    instrumentId: string;
    eventKind: string;
    providerStableRecordFamily: string;
  }>;
  revisionId: string;
  revisionPreimage: Readonly<{
    revisionFamilyId: string;
    revisionKind: "original" | "correction" | "cancellation";
    providerRevisionKey: string | null;
    supersedesRevisionId: string | null;
    effectiveEventTime: Readonly<{ epochNs: string; semantic: string; precisionNs: string }> | null;
    marketFactId: string | null;
  }>;
  marketFactId: string | null;
  marketFactPreimage: Readonly<{
    instrumentId: string;
    eventKind: string;
    eventTime: Readonly<{ epochNs: string; semantic: string; precisionNs: string }>;
    venueTapeId: string | null;
    sessionKind: string;
    currency: "USD";
    canonicalPayload: JsonValue;
  }> | null;
  normalizedMarketFactId: string | null;
  normalizedMarketFactPreimage: Readonly<{
    marketFactId: string;
    providerObservationId: string;
    revisionId: string;
    normalizerVersion: string;
    conditionPolicyVersion: string;
    calendarVersion: string;
    parserContractVersion: string;
  }> | null;
  factKind:
    | "quote"
    | "trade"
    | "bar"
    | "trading-action"
    | "luld"
    | "official-open"
    | "official-close"
    | "corrected-close"
    | "correction"
    | "cancellation"
    | "corporate-action"
    | "instrument-reference";
  marketEventTimeNs: string;
  sourceSequence: string | null;
  sourceNativeIdentity: string | null;
  canonicalFactDigest: string | null;
}>;
```

Quote, trade, bar, status, correction/cancellation, official value, corporate action, and instrument
reference are closed distinct fact kinds. A correction/cancellation has an immutable target and
revision edge; it does not rewrite or delete an earlier body or fact. The validator resolves the
named source profile/member/instrument/venue and recomputes `mob1_`, `mdl1_`, `mrf1_`, `mft1_`,
`mrv1_`, and `mnf1_` in dependency order. Cancellation requires all fact/normalization fields null;
every other accepted fact requires them non-null. It compares the entire derived set with
expectations in both directions, so an unexpected or omitted fact fails.

## Recorded corpus oracle

```ts
type SyntheticRecordedCorpusV1 = Readonly<{
  recordedCorpusSnapshotId: string;
  snapshot: RecordedCorpusSnapshotV1;
  corpusCutoffId: string;
  cutoff: RecordedCorpusCutoffV1;
}>;
```

The fixture carries the complete `mcs1_`/`mcc1_` primitive preimages from the identity contract.
Every acquisition, artifact, provider observation, revision, delivery, wall/logical stamp, clock
basis, closure evidence hash, and admitted-revision hash must reconcile to this manifest. Corpus
rows are unique and sort by `{recordedCorpusSnapshotId,corpusCutoffId}`. Exactly one
`recorded-primary` row and, when the case exercises corrections, one `recorded-corrected` row exist
per market-reference join/source policy.

## Selection requests and H-001

```ts
type SyntheticSelectionRequestV1 = Readonly<{
  requestId: string;
  marketReferenceJoinKey: string;
  instrumentId: string;
  selectionPolicyId: string;
  selectionPolicyPreimage: MarketSelectionPolicyPreimageV1;
  intervalKey: string;
  intervalDefinition: MarketIntervalDefinitionV1;
  referenceKind: MarketReferenceKindV1;
  asOfBasis: MarketResultAsOfBasisV1;
}>;

requestId = "msq1_" + H("peas/market-selection-request/v1", {
  marketReferenceJoinKey,instrumentId,selectionPolicyId,
  intervalKey,referenceKind,asOfBasis
})
```

H-001 is closed: durable capture is primary; the exact inherited retrieval basis is mandatory
sensitivity. Both are present explicitly in `selectionPolicyPreimage`; omission or substitution
rejects. `retrievedAtMs` is not renamed transport completion. The validator recomputes `msp1_`,
`mik1_`, `msq1_`, the exact inherited basis inside `asOfBasis`, `mcs1_`, and `mcc1_`.

Every point selector chooses the last eligible fact with market event time
`<= asOfBasis.targetTimeNs`, subject to staleness and the named view. The release-gap origin selects
the last eligible quote with event time strictly `< Tpub`; its destination is the as-of quote at
durable-capture T0. A first-after target is forbidden.

## Expected outputs

```ts
type SyntheticExpectedCandidateV1 = Readonly<{
  providerObservationId: string;
  revisionId: string;
  normalizedMarketFactId: string;
  eligibilityStatus: "eligible" | "degraded" | "ineligible" | "rejected";
  reason: CanonicalMarketReasonV1 | null;
  diagnostics: readonly CanonicalMarketReasonV1[];
}>;

type SyntheticExpectedResultV1 = Readonly<{
  requestId: string;
  intervalKey: string;
  referenceKind: MarketReferenceKindV1;
  asOfBasis: MarketResultAsOfBasisV1;
  status: MarketReferenceResultStatusV1;
  resultKind: "selected" | "missing" | "rejected";
  candidateOutcomes: readonly SyntheticExpectedCandidateV1[];
  selectedReferenceId: string | null;
  missingReferenceId: string | null;
  selectedNormalizedMarketFactId: string | null;
  selectedRevisionId: string | null;
  candidateSetHash: string;
  exactPrice: CanonicalDecimalV1 | null;
  marketEventTimeNs: string | null;
  ageNs: string | null;
  reason: CanonicalMarketReasonV1 | null;
  diagnostics: readonly CanonicalMarketReasonV1[];
}>;

type SyntheticExpectedMetricV1 = Readonly<{
  metricId: string;
  metricKind:
    | "prior-close-movement-at-first"
    | "release-gap-movement"
    | "residual-1m"
    | "residual-5m"
    | "residual-30m";
  priceBasis:
    | "quote-nbbo-midpoint"
    | "trade-last-eligible-consolidated"
    | "bar-one-minute-completed-close";
  observationBasisKind: "capture" | "retrieval";
  viewKind: MarketViewKindV1;
  numeratorReferenceId: string | null;
  denominatorReferenceId: string | null;
  rationalNumerator: string | null;
  rationalDenominator: string | null;
  status: MarketReferenceResultStatusV1;
  reason: CanonicalMarketReasonV1 | null;
  diagnostics: readonly CanonicalMarketReasonV1[];
}>;

metricId = "mmm1_" + H("peas/market-movement-metric/v1", {
  metricKind,priceBasis,observationBasisKind,viewKind,
  numeratorReferenceId,denominatorReferenceId
})

type SyntheticExpectedReasonV1 = Readonly<{
  stage: "authority" | "parse" | "normalize" | "selection" | "metric";
  requestId: string | null;
  candidateIdentity: string | null;
  reason: CanonicalMarketReasonV1;
  diagnostics: readonly CanonicalMarketReasonV1[];
}>;

type SyntheticExercisedBoundV1 = Readonly<{
  boundId: string;
  observedValue: string;
  expectedDisposition: "exact-accepted" | "one-over-rejected";
  expectedReason: Readonly<{ code: "market.bound-exceeded"; detail: null }> | null;
  limitKind: string | null;
}>;
```

`candidateOutcomes` sorts exactly as the identity contract requires and recomputes
`candidateSetHash`. The oracle then recomputes `msr1_` or `mmr1_` from the matching request in both
directions. Selected status requires exactly one selected ID, null missing ID/reason, and
complete/degraded diagnostic cardinality. Missing requires exactly one missing ID/reason and null
selected fields. Rejected requires both IDs and all selected fields null and emits no result ID.

Reason/detail correspondence and diagnostic sorting use the one canonical identity/reason schema;
a detail required by the catalog cannot be null, including `qualityKind` for locked/slow/LULD
degradation. Bound one-over rows require `market.bound-exceeded`, null reason detail, and the exact
separate `limitKind`; exact rows require both null.

Quote, trade, bar, and official close IDs and metric names remain distinct. Exact rational
comparison is required; tests may not use approximate floating-point equality.

## Provenance

```ts
type SyntheticFixtureProvenanceV1 = Readonly<{
  classification: "synthetic";
  redistributionClass: "project-authored";
  authoringPolicyId: "peas-original-market-fixture-v1";
  containsProviderBytes: false;
  containsProviderExamples: false;
  containsActualMarketValues: false;
  containsCredentialsOrAccountFacts: false;
  networkRequired: false;
  approvalReference: null;
  note: string;
}>;
```

Any other value rejects. A `redistribution-approved` escape hatch is intentionally absent from V1.
If a future fixture is not original synthetic data, it requires a contract revision and explicit
permission; it cannot be smuggled through a note or approval string.

## Required schema and identity vectors

Executable fixture validation MUST include:

1. one golden RFC 8785 preimage/domain/prefix vector and one forged displayed-ID vector for
   `car1_`, `mfp1_`, every source child ID, `mvt1_`, `mcm1_`, `mer1_`, inherited `aob1_`/`imap1_`,
   `maq1_`, `mac1_`, `mar1_`, `min1_`, `msa1_`, `mcal1_`, `mob1_`, `mdl1_`, `mrf1_`, `mrv1_`,
   `mft1_`, `mnf1_`, `mcs1_`, `mcc1_`, `mik1_`, `msp1_`, `msq1_`, `msr1_`, `mmr1_`, `mmm1_`,
   `mfx1_`, and `mfm1_`;
2. missing, extra, null-substituted, reordered fixed-array, wrong-child, wrong-profile, and
   byte-different primitive preimages for each dependency edge;
3. two source profiles proving acquisition/member/profile resolution is by exact ID and that
   first/array/default selection is impossible;
4. complete candidate arrays with one omitted expected candidate and one unexpected actual
   candidate, plus tuple permutations that recompute the same canonical hash;
5. every detail-required reason with correct, null, wrong-field, wrong-value, and extra-detail
   variants, including locked/slow/LULD degradation;
6. selected-complete, selected-degraded, missing, and rejected cardinality in both directions,
   including forged candidate-set, selected, and missing IDs; and
7. first-corpus membership present/absent plus corrected durable evidence at cutoff-1ms, cutoff,
   and cutoff+1ms for original, correction, and cancellation revisions.

No vector may populate an expected ID by calling the production derivation under test and then
compare it to itself; golden bytes/digests are literal reviewed fixture expectations.

## Exact fixture bounds

These limits are part of fixture schema V1 and must reconcile with
[`pr-2d-resource-bounds.md`](pr-2d-resource-bounds.md). Any later integrated numeric change requires
the two files and exact/one-over matrix to change together before contract review.

| Bound ID | Exact limit |
| --- | ---: |
| `fixture.manifest-bytes` | 32 MiB |
| `fixture.member-bytes` | 10,485,760 bytes |
| `fixture.aggregate-member-bytes` | 67,108,864 bytes |
| `fixture.members` | 16 |
| `fixture.source-profiles` | 8 |
| `fixture.records-per-member` | 10,000 |
| `fixture.record-bytes` | 65,536 bytes |
| `fixture.fields-per-record` | 64 |
| `fixture.generic-string-bytes` | 1,024 UTF-8 bytes |
| `fixture.identity-bytes` | 512 UTF-8 bytes |
| `fixture.conditions-per-fact` | 8 |
| `fixture.decimal-coefficient-digits` | 20 |
| `fixture.source-decimal-scale` | 6 |
| `fixture.midpoint-scale` | 7 |
| `fixture.correction-depth` | 16 |
| `fixture.deliveries-per-native-id` | 32 |
| `fixture.instruments` | 64 |
| `fixture.calendar-dates` | 400 |
| `fixture.active-market-centers-per-instrument` | 64 |
| `fixture.selection-requests` | 64 |
| `fixture.expected-results` | 64 |
| `fixture.expected-metrics` | 32 |
| `fixture.reason-traces` | 64 |
| `fixture.page-size` | 1..10,000 inclusive |
| `fixture.primary-target-set` | exactly `T0,T1,T5,T30` |
| `fixture.maximum-horizon-ns` | 1,800,000,000,000 |
| `fixture.regular-quote-age-ns` | 5,000,000,000 inclusive |
| `fixture.extended-quote-age-ns` | 30,000,000,000 inclusive |

Every maximum has a generated exact-limit success and one-unit-over `market.bound-exceeded` failure
with the exact bounded `limitKind`.
Actual read bytes override an in-limit size declaration. Bounds preflight before recursion,
allocation, sorting, hashing, or partial output; over-limit input cannot be truncated.

## Required fixture catalog

### Quotes, sessions, and market state

| Case | Synthetic arrangement | Required result |
| --- | --- | --- |
| `Q-01` | bid `10.000000`, ask `10.020000` | exact midpoint `10.01` |
| `Q-02` | bid `1.000000`, ask `1.000001` | exact scale-7 midpoint `1.0000005` |
| `Q-03` | eligible quote at target and another 1 ns after | target quote selected; future ignored |
| `Q-04` | age 5 s and 5 s + 1 ns | exact eligible; one-over `market.quote-stale` |
| `Q-05` | missing/zero side | `market.quote-one-sided`; no trade/bar substitution |
| `Q-06` | locked NBBO | primary degraded `market.quote-quality-degraded` with `qualityKind:locked`; strict sensitivity missing |
| `Q-07` | crossed NBBO | `market.quote-crossed` |
| `Q-08` | pinned eligible slow condition | primary degraded `market.quote-quality-degraded` with `qualityKind:slow`; strict sensitivity missing |
| `Q-09` | unknown/over-limit condition set | `market.condition-unknown` / `market.bound-exceeded` |
| `Q-10` | executable, limit-state, and non-executable LULD sides | complete, degraded, and missing respectively |
| `Q-11` | quote, cross-SRO halt, quote resume, trade resume | halt target missing; no post-resume backfill |
| `Q-12` | native sequence gap then authoritative reset | missing through reset; deterministic recovery |
| `Q-13` | equal-time conflict without trusted tie-break | `market.sequence-insufficient` with `sequenceFailureKind:equal-time-ambiguous` |
| `Q-14` | BOLO improves price | protected NBBO unchanged; BOLO separate |
| `Q-15` | identical values from two providers/feeds | separate observation/selection identities |
| `S-01` | weekday holiday | `market.session-closed` |
| `S-02` | fact at early close -1 ns and at close | first regular; second outside regular |
| `S-03` | both DST transition regimes | pinned UTC intervals and offsets |
| `S-04` | T0 premarket, T30 regular | primary `market.session-transition` |
| `S-05` | overnight/BOATS-like fact plus regular fact | overnight excluded; regular state unchanged |

### Trades, bars, closes, corrections, and ordering

| Case | Synthetic arrangement | Required result |
| --- | --- | --- |
| `T-01` | regular condition updates consolidated Last | separately labeled trade result |
| `T-02` | Sold Last in qualifying/nonqualifying day state | pinned full-matrix behavior |
| `T-03` | Prior Reference Price first/only then after normal Last | conditional update only with complete state |
| `T-04` | odd-lot trade at distinct price | never selected for consolidated Last |
| `T-05` | out-of-sequence conditions and two time semantics | no timestamp rewriting; exact matrix result |
| `T-06` | official open/close, opening/reopening/closing trade, corrected close | every fact separately typed |
| `B-01` | completed 60-second unadjusted bar | separately labeled completed-bar close |
| `B-02` | target inside open bar | `market.bar-interval-future` |
| `B-03` | adjusted and unadjusted bars with same close | distinct facts; only unadjusted point sensitivity |
| `PCL-01` | corrected consolidated close present | selected before listing official close |
| `PCL-02` | listing official close only | selected as prior close |
| `PCL-03` | final trade/bar only | primary prior close missing; labeled sensitivities only |
| `R-01` | correction is a valid member of first immutable corpus | correction present in `recorded-primary` |
| `R-02` | revision absent from first corpus, durably recorded before/at corrected cutoff | original in `recorded-primary`; revision in `recorded-corrected` |
| `R-03` | selected trade then cancellation admitted only by corrected cutoff | `recorded-primary` retains; `recorded-corrected` removes |
| `R-04` | identical retransmission | one fact, two delivery observations |
| `R-05` | same native ID, different payload, no edge | `market.provider-observation-invalid` with `providerObservationFailureKind:conflicting-content` in every arrival order |
| `R-06` | orphan, fork, cycle, reused revision key | correction chain fails closed |
| `R-07` | additional correction durable evidence at cutoff-1ms, cutoff, cutoff+1ms | first two admitted only to `recorded-corrected`; +1ms excluded and annotated |
| `R-08` | final-corrected-only corpus closes before/at/after corrected cutoff | no `recorded-primary`; first two may support `recorded-corrected`, after is `market.correction-view-unknown` |
| `O-01` | shuffled artifacts/records/pages | canonical fact/result identity unchanged |
| `O-02` | trusted sequence contradicts arrival order | source sequence controls; arrival preserved as evidence |
| `O-03` | page token loop/gap/query substitution | atomic page-chain rejection |

### Instruments, corporate actions, metrics, providers, and hostile input

| Case | Synthetic arrangement | Required result |
| --- | --- | --- |
| `I-01` | authoritative same-share-class symbol change | continuity only at exact effective boundary |
| `I-02` | symbol reused by unrelated instrument | no continuity |
| `I-03` | ambiguous share class/CUSIP-like change | `market.instrument-invalid` with exact `instrumentFailureKind:ambiguous` or `symbol-continuity-unresolved` |
| `C-01` | pure 2-for-1 split between metric endpoints | primary crossing missing; exact adjusted sensitivity |
| `C-02` | cash distribution under frozen convention | separate exact adjusted sensitivity |
| `C-03` | merger/spin/ADR-ratio/combined action | unsupported primary crossing, no guessed adjustment |
| `C-04` | action revision after first corpus | `recorded-primary`/`recorded-corrected` results remain distinct |
| `M-01` | quotes at Tpub-1ns, Tpub, T0, T1, T5, T30 | strict-pre release origin; every destination as-of target |
| `M-02` | retrieval before quote update, durable capture after | durable primary/retrieval sensitivity differ as H-001 requires |
| `M-03` | Q0 present, Q5 stale, Q30 absent | independent metric statuses; denominator retained |
| `M-04` | quote missing while trade and completed bar exist | primary missing; two separately labeled sensitivities |
| `D-01` | equal independent provider results | provenance remains distinct; comparison `agree` |
| `D-02` | disagreeing provider results | deterministic discrepancy; primary never replaced |
| `D-03` | primary missing, secondary present | primary missing; no fallback |
| `E-01` | pending/denied/expired/wrong entitlement | fail closed without body/network/provider access |
| `E-02` | unapproved FMP-like fallback/incremental cost | rejected before acquisition |
| `X-01` | unknown/missing/extra/inherited/accessor/symbol/sparse/cyclic fields | stable schema rejection with zero trap execution |
| `X-02` | malformed UTF-8/JSON, duplicate key, deep/wide/nested input | exact parser reason, no partial fact |
| `X-03` | credential, URL, header, account, path, provider body/example marker | reject without echoing value |
| `X-04` | declared size in limit, actual stream one byte over/grows/replaces | fail verified read; settle siblings |
| `X-05` | every named bound exact and one over | exact accepted; one-over `market.bound-exceeded` with exact `limitKind` |

### Replay and integration invariance

The same synthetic corpus must produce byte-identical provider observations, normalized facts,
revisions, candidate-set hashes, selected/missing results, metrics, fixture manifest ID, and study
entry IDs across:

- fixture and object order;
- arrival order where source order is equivalent;
- duplicate redelivery and correction-arrival permutations;
- restart before/after observation lookup, verified read, normalization, and selection;
- page sizes `1`, `2`, `7`, and `10,000`;
- memory and SQLite persistence;
- repeated execution and replay remapping; and
- active analysis lease with later evidence.

Replay may change execution-scoped ledger entry IDs only; semantic identities and the existing
`marketReferenceJoinKey` remain stable.

## Prohibited fixture behavior

No fixture, generator, loader, or test may:

- contact DNS, HTTP, HTTPS, WebSocket, a browser, a provider SDK, or another live surface;
- read environment credentials, cookies, account directories, dashboards, invoices, or private
  correspondence;
- contain or derive from provider bytes/examples or real market/event records;
- activate a trial, subscription, entitlement, fallback, or spend;
- put URL, credential, path, page token, wall clock, or provider error text in semantic identity;
- mutate a frozen port, migration, EventDraft, reducer, evidence-bundle identity, or PR 2C ledger
  fact union; or
- create an order, broker call, position, portfolio mutation, dispatchable row, or financial effect.

Tests must install a fail-fast network witness and prove zero attempted network/effect calls.
