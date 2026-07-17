# PR 2C fixture manifest specification

All FMP and NVIDIA bodies are minimal original synthetic data. Paths are loader instructions only.
Large exact/one-over cases are generated in tests.

## Closed manifest

```ts
type RecordedMirrorFixtureManifestV1 = Readonly<{
  schemaVersion: 1;
  caseId: string;
  provider: "financial-modeling-prep" | "nvidia-ir";
  source:
    | "peas-recorded:fmp-press-release-synthetic-v1"
    | "peas-recorded:nvidia-newsroom-press-release-synthetic-v1";
  acquisitionVariant: "latest" | "search" | "rss";
  asOfMs: number;
  selector: FmpSelectorV1 | NvidiaSelectorV1;
  route: FmpRecordedRouteV1 | NvidiaRecordedRouteV1;
  retrievedMembers: readonly RetrievedFixtureMemberV1[];
  derivedProofs: readonly DerivedProjectionProofV1[];
  expected: RecordedMirrorExpectedV1;
  provenance: {
    classification: "synthetic" | "redistribution-approved";
    note: string;
    approvalReference: string | null;
  };
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
type RetrievedFixtureMemberV1 = Readonly<{
  kind: "retrieved";
  role: "fmp.collection-json" | "ir.rss-feed" | "ir.release-html";
  path: string;
  artifactHash: string;
  sizeBytes: number;
  selectedObservationId: string;
  observation: {
    provider: "financial-modeling-prep" | "nvidia-ir";
    artifactDigest: string;
    retrievedAtMs: number;
    observationHash: string;
  };
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

FMP has one retrieved collection and one derived selected-item proof. NVIDIA has retrieved feed and
release HTML plus derived RSS-item and visible-release proofs. A derived proof has no path,
observation, selected observation, retrieval time, or `ArtifactStore` operation. Tests must reject
any attempt to give it one. Each projection is independently recomputed from fully consumed
verified parent bytes and exact selector/policy.

Retrieved members canonicalize by role/digest. Each selected observation exists, is unique, has
the declared provider/digest, and satisfies retrieval `<= asOfMs` unless the case intentionally
expects observation-invalid. Selection never scans history. Verified size/body/digest and
observation evidence agree. Paths resolve below the provider root and cannot escape through
absolute/traversal/link/junction/reparse paths.

## Routing and classification

FMP route is the exact closed shape from ADR 0008: classification, nullable issuer mapping with
CIK/symbol/fiscal period, mapping authority, and version. No title/body fiscal inference exists.

NVIDIA route is fixed to CIK `0001045810`, symbol `NVDA`, and the exact financial-results title
grammar in ADR 0008. The title supplies Q1/Q2/Q3/FY only; nonmatch is ignored and RSS/H1 conflict
quarantines. Route hashes and mapping versions are transcript evidence.

## Expected output

```ts
type RecordedMirrorExpectedV1 = Readonly<{
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
```

Emitted requires every identity/hash/route field and an exact schema-V1 EventDraft mapping.
Ignored/quarantined has no candidate or draft. Missing provider time may emit null/unknown. A
malformed present provider time quarantines.

The domain candidate/draft excludes path, URL/GUID/query/fragment, credentials, arbitrary headers,
observation/retrieval identity, page/limit/acquisition variant, sibling order, and clock. Raw
artifact digest remains the V1 primary provenance, so byte-different parent artifacts may change
revision and EventDraft identity even if selected semantic projection identity is unchanged.

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
schemas. Collection/fixture selectors are exact record/revision IDs for FMP and an exact bounded
canonical NVIDIA selection key for RSS. NVIDIA title and URL grammars and both timestamp grammars
are normative in ADR 0008.

## Synthetic provenance

`synthetic` requires original prose, fictitious FMP companies, invalid domains, and no copied
provider headline/body/image/media. `redistribution-approved` requires a durable non-null approval
reference. PR 2C contains no real provider body.

## Matrix

FMP: latest/search, duplicate, correction, null/naive/explicit/malformed time, every exact-field
mutation, duplicate key, identity collision, parent/projection substitution, semantic order
invariance, and generated exact/one-over bytes/items/tokens/depth/strings.

NVIDIA: valid RSS+HTML, identical/conflicting family, changed visible body, missing-time trap,
namespace/prefix, CDATA/escaped marker/entities/DTD, category normalization, URL-only changes,
malformed XML/HTML/title/canonical, chunk/whitespace invariance, and generated exact/one-over
bytes/items/tokens/depth/attributes/text.

Cross-source: all SEC/FMP/IR arrival orders, before/at/after mirror deadline, equal raw digest with
SEC non-null versus V1 null bundle, V1 mirror duplicate, byte-different revisions, redelivery/
conflict, and arrival during an active analysis lease.
