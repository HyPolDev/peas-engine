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
  contractIds: readonly string[];
  sourceProfiles: readonly SyntheticMarketSourceProfileV1[];
  acquisition: SyntheticRecordedAcquisitionV1;
  instrumentVersions: readonly SyntheticInstrumentVersionV1[];
  calendarSnapshot: SyntheticCalendarSnapshotV1;
  retrievedMembers: readonly SyntheticRetrievedMemberV1[];
  parsedFactExpectations: readonly SyntheticParsedFactExpectationV1[];
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
  caseId,sourceProfiles,acquisition,instrumentVersions,calendarSnapshot,
  retrievedMembers,parsedFactExpectations,selectionRequests,provenance
})

expectedManifestId = "mfm1_" + H("peas/market-fixture-manifest/v1",
  manifestWithoutExpectedManifestId)
```

Displayed IDs are assertions, never authority. Validators recompute them from validated primitive
preimages using the repository canonical hash.

## Synthetic source and protocol-emulation identities

```ts
type SyntheticMarketSourceProfileV1 = Readonly<{
  profileId: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  protocolVersion: string;
  parserContractVersion: string;
  entitlementSnapshotId: string;
  fixtureAuthorizationClass: "synthetic-offline-v1";
  assetClass: "us-equity-synthetic";
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
  conditionMapId: string | null;
  emulationReferenceId: string;
}>;
```

All `providerId`, `datasetId`, `feedId`, and security values are explicitly fictional. A profile
may state that it emulates a bounded semantic subset of a named CTA/UTP/provider contract, but
`emulationReferenceId` points to the local versioned contract/source register rather than embedding
a URL or copying an example. Profiles modeling historical SIP, delayed SIP stream, latest delayed
SIP, IEX, overnight, FMP quote/trade/bar, and two independent providers remain distinct even when
their facts and body digests agree.

Empty, `default`, `auto`, null, or inferred source components reject. `entitlementSnapshotId` MUST
be a recomputed `ent1_` identity for a project-owned synthetic snapshot whose real-provider
acquisition capabilities are all `not-authorized`. `fixtureAuthorizationClass` permits only offline
fixture execution. It cannot satisfy or mutate P1-09 and cannot be reused by a live adapter or
study run.

## Recorded acquisition and ArtifactStore authority

```ts
type SyntheticRecordedAcquisitionV1 = Readonly<{
  acquisitionAttemptId: string;
  acquisitionObservationId: string;
  acquisitionMode: "recorded" | "replay";
  routePolicyId: string;
  requestedInstrumentIds: readonly string[];
  requestedStartNs: string;
  requestedEndNs: string;
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
  artifactDigest: string;
  sizeBytes: number;
  selectedObservationId: string;
  selectedObservationHash: string;
}>;
```

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
type SyntheticInstrumentVersionV1 = Readonly<{
  instrumentVersionId: string;
  instrumentId: string;
  issuerMappingId: string;
  issuerId: string;
  issueType: "common-share" | "adr";
  shareClass: string;
  primaryListingMarket: string;
  sourceIssueIdentity: string;
  roundLotSize: number;
  currency: "USD";
  validFromNs: string;
  validToNs: string | null;
  symbolAliases: readonly Readonly<{
    symbol: string;
    validFromNs: string;
    validToNs: string | null;
  }>[];
  mappingAuthority: string;
  mappingArtifactDigest: string;
  predecessorInstrumentVersionId: string | null;
  predecessorRelation: string | null;
}>;

type SyntheticCalendarSnapshotV1 = Readonly<{
  calendarId: string;
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
```

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
  providerObservationId: string;
  deliveryId: string;
  revisionId: string;
  normalizedMarketFactId: string;
  instrumentVersionId: string;
  sourceProfileId: string;
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
  canonicalFactDigest: string;
}>;
```

Quote, trade, bar, status, correction/cancellation, official value, corporate action, and instrument
reference are closed distinct fact kinds. A correction/cancellation has an immutable target and
revision edge; it does not rewrite or delete an earlier body or fact.

## Selection requests and H-001

```ts
type SyntheticSelectionRequestV1 = Readonly<{
  requestId: string;
  marketReferenceJoinKey: string;
  instrumentVersionId: string;
  sourcePolicyId: string;
  selectionPolicyId: string;
  correctionView: "as-recorded" | "later-corrected";
  correctionCutoffObservationId: string;
  observationBasis:
    | Readonly<{
        basisKind: "capture";
        eventId: string;
        receivedAtMs: number;
        logicalAtMs: number;
        clockBasisId: string;
      }>
    | Readonly<{
        basisKind: "retrieval";
        role: string;
        acquisitionObservationId: string;
        vaultObservationId: string;
        retrievedAtMs: number;
        clockBasisId: string;
      }>;
  anchorRole: "h001-primary-durable-capture" | "h001-mandatory-retrieval-sensitivity";
  targetKind: "publication-pre" | "t0" | "t1" | "t5" | "t30" | "prior-close";
  targetTimeNs: string;
  referenceKind: "nbbo-midpoint" | "last-eligible-trade" | "completed-bar" | "official-close";
}>;
```

H-001 is closed: durable capture is primary; the exact inherited retrieval basis is mandatory
sensitivity. `retrievedAtMs` is not renamed transport completion. Every point selector chooses the
last eligible fact with market event time `<= targetTimeNs`, subject to staleness and the frozen
view. The release-gap origin selects the last eligible quote with event time strictly `< Tpub`; its
destination is the as-of quote at durable-capture T0. A first-after target is forbidden.

## Expected outputs

```ts
type SyntheticExpectedResultV1 = Readonly<{
  requestId: string;
  status: "complete" | "degraded" | "missing" | "rejected";
  resultKind: "selected" | "missing";
  selectedReferenceId: string | null;
  missingReferenceId: string | null;
  selectedNormalizedMarketFactId: string | null;
  selectedRevisionId: string | null;
  candidateSetHash: string;
  exactPrice: Readonly<{ coefficient: string; scale: number }> | null;
  marketEventTimeNs: string | null;
  ageNs: string | null;
  primaryReason: string | null;
  diagnosticFlags: readonly string[];
}>;

type SyntheticExpectedMetricV1 = Readonly<{
  metricId: string;
  metricKind:
    | "prior-close-movement-at-first"
    | "release-gap-movement"
    | "residual-1m"
    | "residual-5m"
    | "residual-30m";
  priceBasis: "nbbo-midpoint" | "last-eligible-trade" | "completed-bar";
  observationBasisKind: "capture" | "retrieval";
  numeratorReferenceId: string | null;
  denominatorReferenceId: string | null;
  rationalNumerator: string | null;
  rationalDenominator: string | null;
  status: "complete" | "degraded" | "missing" | "rejected";
  primaryReason: string | null;
}>;

type SyntheticExpectedReasonV1 = Readonly<{
  stage: "authority" | "parse" | "normalize" | "selection" | "metric";
  primaryReason: string;
  diagnosticFlags: readonly string[];
}>;

type SyntheticExercisedBoundV1 = Readonly<{
  boundId: string;
  observedValue: string;
  expectedDisposition: "exact-accepted" | "one-over-rejected";
}>;
```

Selected and missing results are mutually exclusive. Quote, trade, bar, and official close IDs and
metric names remain distinct. Exact rational comparison is required; tests may not use approximate
floating-point equality.

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
| `R-01` | correction before as-recorded cutoff | corrected revision selected |
| `R-02` | correction after first cutoff | original as-recorded; correction later-corrected |
| `R-03` | selected trade then cancellation | earlier view retains; later view removes |
| `R-04` | identical retransmission | one fact, two delivery observations |
| `R-05` | same native ID, different payload, no edge | `market.provider-observation-invalid` with `providerObservationFailureKind:conflicting-content` in every arrival order |
| `R-06` | orphan, fork, cycle, reused revision key | correction chain fails closed |
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
| `C-04` | action revision after first view | as-recorded/later-corrected results remain distinct |
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
