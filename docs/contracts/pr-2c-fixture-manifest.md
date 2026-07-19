# PR 2C fixture manifest specification

All FMP and NVIDIA bodies are minimal original synthetic data. Production loader manifests contain
neither filesystem paths nor acquisition/observation preimages. Test-only seed descriptors carry
those values solely to populate an existing `ArtifactStore`. Large exact/one-over cases are
generated in tests.

## Closed manifest

```ts
type RecordedMirrorFixtureManifestV2 = Readonly<{
  schemaVersion: 2;
  caseId: string;
  provider: "financial-modeling-prep" | "nvidia-ir";
  source:
    | "peas-recorded:fmp-press-release-synthetic-v1"
    | "peas-recorded:nvidia-newsroom-press-release-synthetic-v1";
  acquisitionVariant: "latest" | "search" | "rss";
  asOfMs: number;
  selector: FmpSelectorV1 | NvidiaSelectorV1;
  route: FmpRecordedRouteV1 | NvidiaRecordedRouteV1;
  retrievedMembers: readonly RetrievedFixtureMemberV2[];
  derivedProofs: readonly DerivedProjectionProofV1[];
  expected: RecordedFmpExpectedV1 | NvidiaFixtureExpectedV1;
  provenance: RecordedFixtureProvenanceV1;
}>;
```

Every object is exact inert data. Unknown/missing/inherited/accessor/symbol/sparse/proxy/cyclic
fields reject before recursive canonicalization. Identifiers are bounded portable ASCII; as-of is
a non-negative safe integer.

```ts
type FmpSelectorV1 = Readonly<{ recordId: string; revisionId: string }>;
type NvidiaSelectorV1 = Readonly<{ selectionKey: string }>;

type FmpRecordedRouteV1 = Readonly<{
  classification: "earnings-release" | "not-earnings-release";
  issuerMapping: null | {
    issuerCik: string;
    symbol: string;
    fiscalPeriod: string;
  };
  mappingAuthority: string;
  mappingVersion: string;
}>;

type NvidiaRecordedRouteV1 = Readonly<{
  classificationPolicy: "nvidia-financial-results-title-v1";
  issuerCik: "0001045810";
  symbol: "NVDA";
  mappingAuthority: string;
  mappingVersion: string;
}>;
```

FMP route hash uses `peas/fmp-recorded-synthetic-route/v1` over classification and issuer mapping.
NVIDIA route hash uses `peas/nvidia-ir-recorded-route/v1` over the exact route plus the fiscal
period derived by the ADR 0008 title grammar.

## Retrieved members cannot be derived proofs

```ts
type RetrievedFixtureMemberV2 = Readonly<{
  kind: "retrieved";
  role: "fmp.collection-json" | "ir.rss-feed" | "ir.release-html";
  artifactHash: string;
  sizeBytes: number;
  selectedObservationId: string;
}>;

type DerivedProjectionProofV1 = Readonly<{
  kind: "derived-projection";
  role: "fmp.press-release-item" | "ir.rss-item" | "ir.release-visible";
  parentArtifactHash: string;
  policy: string;
  projectionHash: string;
  projectionSizeBytes: number;
}>;
```

FMP has one retrieved collection and one derived selected-item proof only when the outcome emits.
Ignored and quarantined FMP outcomes have no derived proof. NVIDIA has retrieved feed and release
HTML plus exactly two unique derived proofs: one `ir.rss-item` and one `ir.release-visible`. A
derived proof has no path, observation, selected observation, retrieval time, or `ArtifactStore`
operation. Tests must reject any attempt to give it one. Each projection is independently
recomputed from fully consumed
verified parent bytes and exact selector/policy. Loaders compare supplied and recomputed proof maps
in both directions; a missing, duplicate, extra, parent-, policy-, hash-, or size-substituted role
is a stable bundle-hash mismatch. Terminal/failure transcripts carry no declared projection hash.

Retrieved members canonicalize by role/digest. Each loader receives the `ArtifactStore` as an
argument. For every raw member it performs exactly one
`getObservation(selectedObservationId)`—never a history scan—and validates the complete returned
`ArtifactObservation` before any body read. Validation recomputes both observation ID and
observation hash, requires the persisted provider identifier and declared artifact digest, enforces
`retrievedAtMs <= asOfMs`, and rejects missing, duplicate, forged, or inconsistent authority with
the stable provider observation-invalid reason. Invalid observation authority performs no
`ArtifactStore.read`.

After every required observation is valid, the loader performs exactly one
`ArtifactStore.read(artifactHash)` per raw member. Verified metadata must use SHA-256 and match the
declared digest and bounded size. A multi-member loader first acquires every read exactly once and
settles every acquisition call without consuming a stream. It validates the complete metadata set
and aggregate bounds atomically. Any acquisition or metadata failure destroys every acquired stream
and crosses a bounded cancellation-settlement barrier before return, so no sibling body starts,
survives the return, or emits later activity. Only after that gate passes does the loader consume
the streams sequentially, recompute actual byte count and SHA-256, and fail closed for underrun,
overrun, replacement/growth during read, or digest substitution. A consumption failure also cancels
and settles all acquired streams before return. A rejected observation or rejected read metadata
consumes zero body bytes. Production loaders do not stat, open, or resolve manifest paths and do not
call any other store operation. Filesystem paths, request/response preimages, and retrieval attempts
are test-only seed data outside the closed production manifest.

## Routing and classification

FMP route is the exact closed shape from ADR 0008: classification, nullable issuer mapping with
CIK/symbol/fiscal period, mapping authority, and version. No title/body fiscal inference exists.

NVIDIA route is fixed to CIK `0001045810`, symbol `NVDA`, and the exact financial-results title
grammar in ADR 0008. The title supplies Q1/Q2/Q3/FY only; nonmatch is ignored and RSS/H1 conflict
quarantines. Route hashes and mapping versions are transcript evidence.

## Expected output

```ts
type RecordedFmpExpectedV1 = Readonly<{
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: string | null;
  limitKind: string | null;
  recordId: string | null;
  revisionId: string | null;
  rawArtifactHash: string | null;
  primaryArtifactHash: string | null;
  selectedProjectionHash: string | null;
  routeHash: string | null;
  candidateHash: string | null;
  eventDraftHash: string | null;
  publishedAtMs: number | null;
  timestampConfidence: "provider" | "unknown" | null;
  originalTimestamp: string | null;
}>;

type NvidiaFixtureExpectedV1 = Readonly<{
  status: "emitted" | "ignored" | "quarantined";
  reasonCode: string | null;
  limitKind: string | null;
  recordId: string | null;
  revisionId: string | null;
  issuerCik: string | null;
  symbol: string | null;
  fiscalPeriod: string | null;
  sourceKind: "fmp_release" | "issuer_release" | null;
  publishedAtMs: number | null;
  timestampConfidence: "provider" | "unknown" | null;
  originalTimestamp: string | null;
  primaryArtifactHash: string | null;
  selectedProjectionHash: string | null;
  routeHash: string | null;
  candidateHash: string | null;
  eventDraftHash: string | null;
}>;

type RecordedFixtureProvenanceV1 = Readonly<{
  classification: "synthetic" | "redistribution-approved";
  note: string;
  approvalReference: string | null;
}>;
```

Emitted requires every identity/hash/route field and an exact schema-V1 EventDraft mapping.
Ignored/quarantined has no candidate or draft. Missing provider time may emit null/unknown. A
malformed present provider time quarantines.

FMP `expected` and `provenance` are exact inert bounded objects before any body can emit. Missing,
extra, inherited, accessor, symbol, proxy, sparse, cyclic, and over-limit values reject. Synthetic
provenance requires a null approval reference; redistribution-approved requires a bounded non-null
reference. The loader reconciles actual status/reason/limit, raw and semantic hashes, identities,
publication fields, candidate hash, and EventDraft hash to `expected` atomically. Any difference is
`fmp.bundle-hash-mismatch` and emits no candidate or draft.

The domain candidate/draft excludes path, URL/GUID/query/fragment, credentials, arbitrary headers,
observation/retrieval identity, page/limit/acquisition variant, sibling order, and clock. Raw
artifact digests remain immutable evidence/ledger provenance only. For FMP and NVIDIA the
candidate/EventDraft primary is the selected semantic projection hash; byte-different URL-, query-,
fragment-, comment-, canonical-, GUID-, or other nonsemantic raw changes preserve record/revision,
candidate, EventDraft, and evidence-bundle identity.

Candidate hash is `H("peas/recorded-press-release-candidate/v1",candidate)` and EventDraft hash is
`H("peas/recorded-press-release-event-draft/v1",validateEventDraft(draft))`.

## Exact field and parser limits

| Boundary | FMP | NVIDIA |
| --- | ---: | ---: |
| Raw members / derived proofs | 1 / 1 | 2 / 2 |
| Member / aggregate bytes | 10 / 10 MiB | 10 / 20 MiB |
| Items | 1-1,000 | 1-256 |
| Tokens | 250,000 JSON | 250,000 XML and 250,000 HTML |
| Depth | 64 | 64 XML / 256 HTML |
| Attributes | n/a | 64 XML / 256 HTML |
| Keys/categories | exactly 7 | 1-32 categories |
| Symbol | 1-32 ASCII bytes | `NVDA` |
| Timestamp/GUID/link | 128 / n/a | 128 / 2,048 / 2,048 ASCII bytes |
| Title/subtitle | 1-4,096 / n/a | 1-4,096 / 0-4,096 UTF-8 bytes |
| Body/site/image/URL | 1-4 MiB / 1 KiB / 8 KiB / 8 KiB | visible projection 4 MiB |
| Decoded/projection bytes | 8 MiB | 4 MiB per projection |
| Candidate/transcript | 256 KiB | 256 KiB |

Every maximum has exact and one-over generated coverage; zero/empty behavior follows the closed
schemas. Resource coverage includes an actual over-limit file despite an in-limit declaration,
growth/replacement during the read, and counters proving that rejected observation authority or
verified metadata reads no body bytes. Collection/fixture selectors are exact record/revision IDs
for FMP and an exact bounded canonical NVIDIA selection key for RSS. NVIDIA title and URL grammars
and both timestamp grammars are normative in ADR 0008.

## Synthetic provenance

`synthetic` requires original prose, fictitious FMP companies, invalid domains, no copied provider
headline/body/image/media, and a null approval reference. `redistribution-approved` requires a
bounded durable non-null approval reference. Every checked-in PR 2C fixture is synthetic and
contains no real provider body.

## Matrix

FMP: latest/search, identical/conflicting duplicate order, later correction, null/naive/explicit/
malformed time, every exact-field mutation, duplicate key, identity collision, parent/projection
substitution, URL/comment/raw-order invariance, strict expected/provenance hostility, authoritative
observation absence/forgery/substitution, exactly one lookup/read, actual over-limit and growing
streams, no-body-read rejection, and generated exact/one-over bytes/items/tokens/depth/strings.

NVIDIA: valid RSS+HTML, identical/conflicting family, changed visible body, missing-time trap,
namespace/prefix, CDATA/escaped marker/entities/DTD, category normalization, URL-only changes,
malformed XML/HTML/title/canonical, chunk/whitespace invariance, authoritative observation
absence/forgery/substitution, exactly one lookup/read per member, actual over-limit and growing
streams, same-length replacement, atomic two-member metadata failure for both roles, post-return
inactivity, symmetric thrown-read cleanup, no raw-error leakage, no-body-read rejection, and
generated exact/one-over bytes/items/tokens/depth/attributes/text.

Cross-source: real recorded SEC/FMP/IR loaders, every arrival order, equal and byte-different
mirrors, corrections/revisions, redelivery/conflict, arrival during an active analysis lease, and
processor reconstruction at minimum and representative larger page sizes on memory and SQLite.
