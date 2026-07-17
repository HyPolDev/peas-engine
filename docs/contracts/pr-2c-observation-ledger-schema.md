# PR 2C normative observation-ledger schema

This file closes the executable shapes and transitions summarized by ADR 0009. Every object is
exact inert JSON: unknown, inherited, accessor, symbol, sparse, proxy, duplicate, non-finite, and
unsafe-integer values reject. Hash strings are lowercase 64-hex unless a prefixed identity is
specified. Canonical JSON is RFC 8785 after these validations.

## Envelope, clock, and identity

```ts
type ClockStampV1 =
  | Readonly<{ clockBasisId: null; wallTimeMs: null; monotonicTimeUs: null }>
  | Readonly<{ clockBasisId: string; wallTimeMs: number; monotonicTimeUs: null }>
  | Readonly<{ clockBasisId: string; wallTimeMs: number; monotonicTimeUs: number }>;

type ClockBasisV1 = Readonly<{
  clockBasisId: string;
  wallClock: "system-utc" | "recorded-fixture" | "replayed-original";
  synchronization: "verified-bound" | "operator-asserted" | "unspecified" | "not-applicable";
  maximumErrorMs: number | null;
  monotonicClock: "process-monotonic-us" | "none";
  monotonicSessionId: string | null;
}>;

type ObservationLedgerEntryV1 = Readonly<{
  schemaVersion: 1;
  executionId: string;
  entryId: string;
  parentEntryIds: readonly string[];
  clock: ClockStampV1;
  facts: ObservationLedgerFactsV1;
  entryHash: string;
}>;
```

The exact entry preimage is the five-field value
`{schemaVersion:1,executionId,parentEntryIds,clock,facts}`. `parentEntryIds` is already unique and
sorted by unsigned UTF-8 bytes; the hasher performs no extra sorting or field substitution.

```text
entryHash = H("peas/observation-ledger-entry/v1", preimage)
entryId   = "ole1_" + entryHash
clockBasisId = "clk1_" + H("peas/clock-basis/v1", {
  wallClock,synchronization,maximumErrorMs,monotonicClock,monotonicSessionId
})
```

The golden-vector fixture serializes that exact preimage and pins its canonical bytes, entry hash,
and entry ID; an implementation that hashes `entryId`, `entryHash`, a renamed parent field, or a
resorted copy fails the vector.

Basis is null iff both time fields are null. Monotonic time implies wall time and basis.
`monotonicClock:"none"` requires a null session; `process-monotonic-us` requires a non-null session.
`maximumErrorMs` is non-null iff synchronization is `verified-bound`. Recorded/replayed bases
require `not-applicable`; system UTC permits only `verified-bound`, `operator-asserted`, or
`unspecified`. A basis declaration has an all-null clock. Every other entry with non-null
`clockBasisId` has the matching earlier `clock-basis.declared` entry as one additional direct
parent; an all-null clock has no clock-basis parent.

## Reusable exact types

```ts
type RawArtifactLinkV1 = Readonly<{
  role: string;
  acquisitionObservationId: string;
  vaultObservationId: string;
  vaultObservationHash: string;
  artifactDigest: string;
  sizeBytes: number;
}>;

type SourceIdentityV1 = Readonly<{
  provider: string;
  source: string;
  sourceKind: "sec_8k" | "filing" | "fmp_release" | "issuer_release";
  providerRecordId: string;
  providerRevisionId: string;
  sourceRecordIdentity: string;
  sourceVersionIdentity: string;
  revisionFamilyIdentity: string;
  supersedesSourceVersionIdentity: string | null;
}>;

type PublicationTimeV1 =
  | Readonly<{ publishedAtMs: null; timestampConfidence: "unknown"; originalTimestamp: null }>
  | Readonly<{ publishedAtMs: number; timestampConfidence: "exact" | "provider"; originalTimestamp: string }>
  | Readonly<{ publishedAtMs: number; timestampConfidence: "inferred"; originalTimestamp: string | null }>;

type TrustedObservationBasisV1 =
  | Readonly<{ basisKind:"capture"; eventId:string; receivedAtMs:number; logicalAtMs:number; clockBasisId:string }>
  | Readonly<{ basisKind:"retrieval"; role:string; acquisitionObservationId:string; vaultObservationId:string; retrievedAtMs:number; clockBasisId:string }>;

type IssuerMappingV1 = Readonly<{
  issuerMappingId: string;
  issuerCik: string;
  symbols: readonly string[];
  selectedSymbol: string | null;
  mappingAuthority: string;
  mappingVersion: string;
  effectiveFromMs: number | null;
  effectiveToMs: number | null;
}>;

type SelectionCommonV1 = Readonly<{
  kind:"selection.recorded";
  purpose:"cluster-first-observation"|"analysis-branch-input"|"market-reference-anchor";
  selectedSourceObservationId:string;
  selectedSourceVersionIdentity:string;
  subject:string;
  issuerMappingId:string;
  asOfMs:number;
  branchId:string|null;
  marketReferenceJoinKey:string|null;
}>;

type SelectionRecordedV1 =
  | (SelectionCommonV1 & Readonly<{ selectionBasis:"capture"; trustedObservationBasis:Extract<TrustedObservationBasisV1,{basisKind:"capture"}> }>)
  | (SelectionCommonV1 & Readonly<{ selectionBasis:"retrieval"; trustedObservationBasis:Extract<TrustedObservationBasisV1,{basisKind:"retrieval"}> }>);
```

CIK is exactly ten digits. `symbols` contains 1-8 unique `^[A-Z][A-Z0-9.-]{0,7}$` strings sorted
by unsigned UTF-8 bytes; selected symbol is null or a member. Effective bounds are null or safe
integers and, when both exist, `effectiveFromMs < effectiveToMs`. Mapping identity is derived:

```text
issuerMappingId = "imap1_" + H("peas/issuer-mapping/v1", {
  issuerCik,symbols,selectedSymbol,mappingAuthority,mappingVersion,
  effectiveFromMs,effectiveToMs
})
```

Every occurrence of a mapping ID equals that recomputation; reusing an ID for different fields is
`observation.issuer-mapping-invalid`.

Every derived identity in the fact union is validated, never accepted as caller authority. The
exact ADR 0009 formulas are normative with literal prefixes `aob1_`, `prj1_`, `src1_`, `svr1_`,
`rvf1_`, and `sob1_`. For PR 2C and merged SEC, `providerStableRecordFamily` is exactly
`providerRecordId`. Acquisition, projection, source record/version/family, and source-observation
fields must equal those recomputations; `sob1_` uses the sorted unique raw-link acquisition IDs.
Capture and selection identities equal their normalization ancestor. Any mismatch is
`observation.derived-identity-mismatch`.

Within an execution bundle, the exact key
`{provider,source,providerRecordId,providerRevisionId}` binds one projection digest,
evidence-bundle hash, source-version identity, and revision-family identity. Exact redelivery is
valid; changing any bound value is `observation.revision-conflict`, independent of fixture order.
Different providers or different provider revisions remain independent.

## Exact discriminated fact union

```ts
type ObservationLedgerFactsV1 =
  | Readonly<{ kind:"clock-basis.declared"; clockBasis:ClockBasisV1 }>
  | Readonly<{ kind:"acquisition.declared"; acquisitionObservationId:string; provider:string; retrievalAttemptId:string; sanitizedRequestIdentityHash:string; routeLabel:string }>
  | Readonly<{ kind:"request.started"; acquisitionObservationId:string }>
  | Readonly<{ kind:"request.succeeded"; acquisitionObservationId:string; safeResponseMetadataHash:string }>
  | Readonly<{ kind:"artifact.committed"; acquisitionObservationId:string; vaultObservationId:string; vaultObservationHash:string; artifactDigest:string; sizeBytes:number; acquisitionMode:"live"|"recorded"|"replay"; retrievedAtMs:number|null }>
  | Readonly<{ kind:"artifact.verified"; acquisitionObservationId:string; vaultObservationId:string; artifactDigest:string; metadataSizeBytes:number; consumedSizeBytes:number }>
  | Readonly<{ kind:"normalization.emitted"; projectionId:string; projectionDigest:string; sourceObservationId:string; sourceIdentity:SourceIdentityV1; publicationTime:PublicationTimeV1; issuerMapping:IssuerMappingV1; subject:string; fiscalPeriod:string; evidenceBundleHash:string|null; primaryArtifactHash:string; primaryArtifactKind:"raw-artifact"|"derived-projection"; rawArtifactLinks:readonly RawArtifactLinkV1[]; loaderIdentity:string; selectionHash:string; loaderTranscriptHash:string; normalizerIdentity:string; normalizerTranscriptHash:string; eventDraftHash:string }>
  | Readonly<{ kind:"normalization.ignored"; rawArtifactLinks:readonly RawArtifactLinkV1[]; loaderIdentity:string; selectionHash:string; loaderTranscriptHash:string; normalizerIdentity:string; normalizerTranscriptHash:string; reasonCode:string }>
  | Readonly<{ kind:"normalization.quarantined"; rawArtifactLinks:readonly RawArtifactLinkV1[]; loaderIdentity:string; selectionHash:string; loaderTranscriptHash:string; normalizerIdentity:string|null; normalizerTranscriptHash:string|null; reasonCode:string }>
  | Readonly<{ kind:"capture.appended"|"capture.redelivered"; sourceObservationId:string; sourceVersionIdentity:string; eventId:string; eventHash:string; position:number; receivedAtMs:number; logicalAtMs:number }>
  | SelectionRecordedV1
  | Readonly<{ kind:"failure.recorded"; stage:"request"|"artifact-store"|"verified-read"|"normalization"|"capture"|"selection"; failedAfter:"acquisition.declared"|"request.started"|"request.succeeded"|"artifact.committed"|"artifact.verified"|"normalization.emitted"|"capture.appended"|"capture.redelivered"; acquisitionObservationId:string|null; sourceObservationId:string|null; reasonCode:string; detailHash:string|null }>
  | Readonly<{ kind:"clock.regression"; priorEntryId:string; regressingEntryId:string; priorWallTimeMs:number; currentWallTimeMs:number; monotonicOrderPreserved:boolean }>;
```

Every union member has exactly the shown fields. Normalization raw links contain 1-16 members,
sorted by `(role,acquisitionObservationId,vaultObservationId)`, with unique roles. Quarantine
normalizer fields are both null or both non-null. Market join is non-null iff purpose is
`market-reference-anchor`; it equals `"mrj1_" + H("peas/market-reference-join/v1",
{subject,issuerMappingId,selectedSourceObservationId,selectedSourceVersionIdentity,
trustedObservationBasis})`. It is a future join surface only and performs no market-data work.
Capture basis values equal the capture parent. Retrieval basis identifies exactly one primary raw
link: its IDs/role equal that link, `retrievedAtMs` equals the corresponding commit fact, and
`clockBasisId` equals that commit entry's non-null clock basis. Retrieval selection is forbidden
when commit retrieval time or basis is null. Both variants equal normalization source/subject/
mapping facts and require `asOfMs` at least the received/retrieved time.
`branchId` is non-null exactly for `analysis-branch-input`; it is null for cluster-first and
market-reference purposes.
Failure legality is closed by the transition table below; raw exception text is forbidden.

Every raw link reconciles to its exact committed -> verified -> normalization chain. Its
`vaultObservationHash`, artifact digest, and size equal the commit; verified IDs/digest and both
verified sizes equal the same evidence. One acquisition cannot commit conflicting vault/hash/
digest/size tuples, and one vault observation ID cannot appear with multiple hashes, digests, or
sizes.

## Exact direct-parent transition matrix

The clock-basis parent rule above is additive to the causal parents in this table. No other direct
parents are allowed.

| Child | Exact causal direct parents |
| --- | --- |
| `clock-basis.declared`, `acquisition.declared` | none |
| `request.started` | its `acquisition.declared` |
| `request.succeeded` | its `request.started` |
| `artifact.committed`, mode `live` | its `acquisition.declared` and `request.succeeded` |
| `artifact.committed`, mode `recorded` or `replay` | its `acquisition.declared`; request facts for that acquisition are forbidden |
| `artifact.verified` | its `artifact.committed` |
| any normalization | exactly one `artifact.verified` per raw link, in raw-link order before parent sorting |
| capture | its `normalization.emitted` |
| selection, basis `capture` | the selected `capture.appended` or `capture.redelivered` |
| selection, basis `retrieval` | the selected `normalization.emitted` and selected primary raw link's `artifact.verified` |
| request failure after `acquisition.declared` or `request.started` | exactly that named acquisition entry |
| artifact-store failure after `request.succeeded` | exactly that request entry |
| verified-read failure after `artifact.committed` | exactly that commit entry |
| normalization failure after `artifact.verified` | exactly that verification entry |
| capture failure after `normalization.emitted` | exactly that normalization entry |
| selection failure after `normalization.emitted`, `capture.appended`, or `capture.redelivered` | exactly that named selected-source entry |
| `clock.regression` | exactly `priorEntryId` and `regressingEntryId` |

`failedAfter` must be one of the stage-specific rows; all other stage/failedAfter combinations
reject. Request, artifact-store, verified-read, and normalization failures require a non-null
`acquisitionObservationId` equal to their parent chain and null `sourceObservationId`. Capture and
selection failures require null acquisition and a non-null source observation equal to their
parent. No other nullability combination is valid. Acquisition/source/digest/version facts must
equal their parents. Request failure forbids a
later commit; store/read failure forbids normalization; ignored/quarantined forbids capture. A
clock regression entry is appended after the already-stored regressing entry and never repairs a
same-session monotonic regression, which fails `observation.clock-basis-invalid`. Immutable bundle
order determines each wall regression within a non-null basis. It requires exactly one matching
`clock.regression` fact: the fact's parents and IDs are the prior/regressing entries, its times equal
their wall stamps, its own clock equals the regressing stamp, and its exact boolean monotonic flag
equals their monotonic evidence. Missing, duplicate, fabricated, reordered, mismatched-time,
mismatched-basis, or null-clock claims fail `observation.clock-regression-invalid`.

## Bundle validation and bounds

```text
canonical entry / execution bundle bytes       64 KiB / 64 MiB
entry depth / nodes / keys / array items        8 / 512 / 64 / 32
string / identifier / original timestamp        4 KiB / 512 / 256 bytes
raw links / symbols / parents                    16 / 8 / 32
causal depth                                     16
entries per acquisition                         32
source projections per subject/execution        32
entries / edges per execution bundle             4,096 / 12,279
clock bases per bundle                           32
page size                                        1..10,000
```

All totals preflight before recursion, sorting, or hashing. Parents are unique, sorted, present,
and same-execution. Missing, self, cycle, cross-execution, depth/edge/entry/byte overflow fails
closed. Cross-execution replay re-emits original `acquisition.declared` facts unchanged, preserving
retrieval-attempt and acquisition IDs. It then adds a same-execution replay-mode
`artifact.committed` and `artifact.verified` chain for each original raw artifact. The replay
commit references the immutable original vault observation/hash/digest/size/retrieval epoch and
has no request facts. Original clock-basis declarations/stamps are re-emitted unchanged. Replay
normalization preserves projection/source/version/observation identities and parents the new
same-execution verifications. A capture-basis replay also re-emits its original capture fact after
normalization with original stored-event fields. Selection facts and market join keys therefore
remain stable; ledger entry IDs differ because execution ID differs. Replay remaps causal parents,
`priorEntryId`, and `regressingEntryId` to those new entry IDs while preserving wall times and
monotonic evidence. Original entry IDs are evidence values only, never causal parents.
Pagination uses immutable storage sequence plus entry-ID reconciliation. Golden tests cover the
entry preimage and every clock, parent, failure-stage, nullability, exact-bound, and one-over case.
