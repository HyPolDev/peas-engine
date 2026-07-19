# ADR 0008: Recorded FMP and NVIDIA issuer-IR normalization

- Status: Repaired implementation; fresh independent review required
- Date: 2026-07-16
- Target: PR 2C contract-and-fixture gate
- Base: PR #3 merge `41f19b83e104857ed32b45fa5838c8199f5467ab`

## Scope

PR 2C implements offline recorded-synthetic FMP and NVIDIA Newsroom dialects plus reducer
acceptance against the merged SEC path. It adds no live transport, polling, credentials, Docker,
LLM, market data, brokerage, portfolio, trading, or financial effects. Frozen kernel,
`ArtifactStore`, and SEC-only schema-V2 reducer contracts do not change.

FMP's public stable pages do not expose a complete response schema, timestamp timezone, provider
record/revision ID, or global coverage guarantee. Its source is therefore
`peas-recorded:fmp-press-release-synthetic-v1`. NVIDIA's Q4-powered IR page links to an
iPressroom-generated NVIDIA feed; its source is
`peas-recorded:nvidia-newsroom-press-release-synthetic-v1` and is not a reusable Q4 or live schema.

Only raw provider-shaped members are retrieval artifacts with selected observations. The closed
fixture-manifest V2 member is only `{kind,role,artifactHash,sizeBytes,selectedObservationId}`;
filesystem paths and acquisition preimages exist only in test seed descriptors used to populate an
`ArtifactStore`. Production loaders receive an existing `ArtifactStore` and may neither reconstruct
observations from a manifest nor discover evidence by path or history scan. Derived item projections
have no path, observation, retrieval time, or `ArtifactStore` call and cannot masquerade as
retrieved artifacts. Transcripts bind raw parent digest, authoritative observation, selector,
projection policy/digest, route, and outcome.

## Candidate and existing V1 mapping

An emitted candidate and its mapped draft are the following exact JSON types. The issuer symbol is
proven in routing/telemetry but is deliberately absent from the frozen V1 event payload. Ignored or
quarantined outcomes have no partial candidate or draft.

```ts
type RecordedPressReleasePublicationV1 =
  | Readonly<{ publishedAtMs: number; timestampConfidence: "provider"; originalTimestamp: string }>
  | Readonly<{ publishedAtMs: null; timestampConfidence: "unknown"; originalTimestamp: null }>;

type RecordedPressReleaseCandidateV1 = Readonly<{
  candidateVersion: 1;
  provider: "financial-modeling-prep";
  source: "peas-recorded:fmp-press-release-synthetic-v1";
  sourceKind: "fmp_release";
} | {
  candidateVersion: 1;
  provider: "nvidia-ir";
  source: "peas-recorded:nvidia-newsroom-press-release-synthetic-v1";
  sourceKind: "issuer_release";
}> & Readonly<{
  providerRecordId: string;
  providerRevisionId: string;
  issuerCik: string;
  symbol: string;
  fiscalPeriod: string;
  primaryArtifactHash: string;
  selectedProjectionHash: string;
  routeHash: string;
}> & RecordedPressReleasePublicationV1;

type RecordedPressReleaseEventDraftV1 = Readonly<{
  envelopeVersion: 2;
  type: "earnings.source.observed";
  schemaVersion: 1;
  source:
    | "peas-recorded:fmp-press-release-synthetic-v1"
    | "peas-recorded:nvidia-newsroom-press-release-synthetic-v1";
  subject: string;
  occurredAtMs: number | null;
  correlationId: string;
  provider: Readonly<{
    provider: "financial-modeling-prep" | "nvidia-ir";
    recordId: string;
    revisionId: string;
    artifactHash: string;
  }>;
  payload: Readonly<{
    issuerCik: string;
    fiscalPeriod: string;
    sourceKind: "fmp_release" | "issuer_release";
    artifactHash: string;
  } & RecordedPressReleasePublicationV1>;
}>;
```

For mapping, `subject = correlationId = "earnings:" + issuerCik + ":" + fiscalPeriod`;
`occurredAtMs = publishedAtMs`; draft provider IDs equal candidate provider IDs; both artifact
fields equal `primaryArtifactHash`; and every payload publication/source field equals its candidate
field. The draft has no causation or bundle field. No other field is synthesized.

```text
candidateHash = H("peas/recorded-press-release-candidate/v1", candidate)
draftHash = H("peas/recorded-press-release-event-draft/v1", validateEventDraft(draft))
```

Those are the complete hash preimages: the exact candidate object and the exact validated draft
object respectively. Unknown fields, aliases, inherited/accessor values, invalid CIK/symbol/period,
and any mapping inequality reject before hashing.

## FMP recorded-synthetic dialect

The public FMP normalizer input is an exact inert own-data object with only `bytes`, `selector`,
and `route`. Before any member read, hash, parse, or validation, it rejects proxies, accessors,
symbols, inherited/custom-prototype/non-enumerable/extra fields, cycles, and out-of-bound nested
JSON. Accepted bytes are copied once into a detached `Uint8Array`; accepted selector and route are
bounded inert snapshots. Hostile input is `fmp.response-invalid` with no partial candidate, draft,
or identity.

The top level is an array of exact seven-field items: `symbol`, nullable `publishedDate`, `title`,
`text`, nullable `site`, nullable `image`, and nullable `url`. Unknown/missing/inherited/accessor/
symbol/sparse/proxy/duplicate keys reject. Symbol/title/text are non-empty. Historical `date` is no
alias. Site/image/URL are transcript-only and excluded from projections and domain identities.
Before identity formation, title/text remove HTML comments and complete `http:`/`https:` URL tokens,
collapse ASCII whitespace, and reject an empty result. This semantic transform never follows or
parses a URL.

The selected projection is the following exact object; these are its only keys:

```ts
type FmpSelectedProjectionV1 = Readonly<{
  projectionVersion: 1;
  dialect: "peas-fmp-press-release-synthetic-v1";
  symbol: string;
  publishedDate: string | null;
  title: string;
  text: string;
}>;
```

```text
recordId = "fmp-recorded-synthetic:" + H(
  "peas/fmp-recorded-synthetic-press-release-record/v1",
  {symbol,publishedDate,title}
)
selectedProjectionHash = projectionDigest = H(
  "peas/provider-derived-content/v1", projection
)
revisionId = "sha256:" + H(
  "peas/fmp-recorded-synthetic-press-release-revision/v1",
  projection
)
```

Selection declares record/revision. Conflict detection first groups the bounded collection by
record family: identical projections collapse and two distinct projections in one family are
`fmp.duplicate-conflict`, independent of item order. The surviving projection must match the
declared revision. A later acquisition with a semantic correction forms a deterministic new
revision. Latest/search/page/limit/filter are acquisition telemetry only.

Classification/fiscal period are never inferred from prose. A closed route declares
earnings/not-earnings, nullable exact CIK/symbol/fiscal mapping, authority, and version.
Not-earnings is ignored; earnings without mapping is issuer-unmapped; emitted mapping requires exact
symbol, ten-digit CIK, and `YYYY-Q1..Q4|FY`. Route hash uses
`peas/fmp-recorded-synthetic-route/v1` over classification and mapping.

Explicit time grammar is `YYYY-MM-DDTHH:mm:ss[.1-3](Z|+/-HH:MM)`; naive grammar uses a space and no
offset. Both are ASCII Gregorian years 1970-9999, no leap seconds, valid clock, no surrounding
space. Naive values undergo the same Gregorian/calendar/clock validation as explicit values before
they map to null/unknown; malformed present naive values are `fmp.timestamp-invalid`. Offset is at
most 14:00. Explicit converts to safe epoch/provider confidence; valid naive and null remain
null/unknown; any other non-null value is timestamp-invalid. No timezone,
geography, locale, or retrieval inference exists.

FMP has one retrieved `fmp.collection-json` member and one separate derived
`fmp.press-release-item` proof. For the declared `selectedObservationId`, the loader performs
exactly one `ArtifactStore.getObservation` and, only after that observation passes, exactly one
`ArtifactStore.read(artifactHash)`. It recomputes the observation ID and observation hash from the
complete returned `ArtifactObservation`; requires the persisted FMP provider identifier, declared
artifact digest, and `retrievedAtMs <= asOfMs`; and rejects missing, forged, or inconsistent
authority as `fmp.observation-invalid` before a body read. The verified read metadata must declare
SHA-256, the same digest, and the declared bounded size. The stream is then fully consumed under
the declared ceiling, its actual byte count and SHA-256 are recomputed, and underrun, overrun,
growth/replacement, or digest substitution fails closed. The loader never calls attempt-history or
enumeration APIs and never stats or opens a manifest path.

Projection is recomputed from those fully consumed parent bytes. The loader outcome retains the raw
collection digest as immutable provenance; the candidate and EventDraft primary artifact is the
selected semantic projection hash. Raw-only byte differences, including URLs, queries, fragments,
comments, object order, siblings, and replay paging, cannot change
record/revision/candidate/EventDraft identity. They may change evidence/ledger acquisition
provenance. A semantic correction changes projection, revision, and EventDraft deterministically.

## NVIDIA recorded-synthetic dialect

NVIDIA record identity is non-URL:

```text
recordId = "ir:nvidia:" + H("peas/nvidia-ir-record-family/v1", {
  issuerCik:"0001045810", title,
  itemPubDateOriginal: rssProjection.pubDate?.originalTimestamp ?? null
})
revisionId = "sha256:" + H("peas/nvidia-ir-revision/v1", {
  rssItemProjectionHash, releaseVisibleProjectionHash
})
```

GUID/link/canonical/query/fragment/redirect/selector are validation/telemetry only and enter no
record/revision/projection hash. No non-URL stable provider ID is documented, so title or item time
change creates a new record; supersession is not guessed. Within one feed, duplicate family plus
identical projections collapses; conflicting projections are `ir.record-family-ambiguous`. Across
a later acquisition, changed retained semantics is a deterministic new revision; a raw-only change
preserves the revision and EventDraft.

The two hash-bearing NVIDIA projections and their retained token are exact:

```ts
type SemanticHtmlTokenV1 =
  | Readonly<{ kind:"start"; name:AllowedTagV1 }>
  | Readonly<{ kind:"text"; text:string }>
  | Readonly<{ kind:"end"; name:AllowedTagV1 }>;
type AllowedTagV1 = "article"|"section"|"div"|"h1"|"h2"|"h3"|"p"|"ul"|"ol"|"li"|"table"|"thead"|"tbody"|"tr"|"th"|"td"|"strong"|"em"|"blockquote"|"br";
type ParsedRssTimeV1 = Readonly<{ originalTimestamp:string; epochMs:number }>;
type NvidiaRssItemProjectionV1 = Readonly<{
  projectionVersion:1;
  dialect:"peas-nvidia-newsroom-rss-synthetic-v1";
  issuerCik:"0001045810";
  title:string;
  subtitle:string|null;
  contentType:"releases";
  contentTokens:readonly SemanticHtmlTokenV1[];
  description:string|null;
  categories:readonly string[];
  pubDate:ParsedRssTimeV1|null;
  modDate:ParsedRssTimeV1|null;
}>;
type NvidiaReleaseVisibleProjectionV1 = Readonly<{
  projectionVersion:1;
  dialect:"peas-nvidia-newsroom-release-visible-synthetic-v1";
  issuerCik:"0001045810";
  title:string;
  subtitle:string|null;
  dateText:string|null;
  bodyTokens:readonly SemanticHtmlTokenV1[];
}>;
type NvidiaSelectedCompositeProjectionV1 = Readonly<{
  projectionVersion:1;
  dialect:"peas-nvidia-newsroom-selected-composite-synthetic-v1";
  rssItemProjectionHash:string;
  releaseVisibleProjectionHash:string;
}>;
```

```text
rssItemProjectionHash = H("peas/nvidia-ir-rss-item-projection/v1", rssProjection)
releaseVisibleProjectionHash = H(
  "peas/nvidia-ir-release-visible-projection/v1", releaseVisibleProjection
)
selectedCompositeProjection = {
  projectionVersion:1,
  dialect:"peas-nvidia-newsroom-selected-composite-synthetic-v1",
  rssItemProjectionHash,
  releaseVisibleProjectionHash
}
selectedProjectionHash = projectionDigest = H(
  "peas/provider-derived-content/v1", selectedCompositeProjection
)
```

The candidate `selectedProjectionHash`, ledger `projectionDigest`, and `projectionId` formula all
use that exact composite and no individual projection or raw document in its place. The revision
formula binds only those two component projection hashes. Candidate and EventDraft artifact fields
equal the selected composite projection hash.

RSS root/version are empty-namespace `rss`/`2.0`; core
fields are empty namespace; Media RSS is recognized only by expanded official URI. DTD/entity
declarations and external resolution are forbidden. Predefined/numeric references decode first.
Scalars reject child elements, concatenate text/CDATA chunk-invariantly, trim ASCII edge whitespace
only, and preserve internal text. Required singletons are title/link/guid/contentType/content/
categories; optional named fields are singleton; category repeats 1-32, rejects duplicates/empty,
requires `Press Releases`, and sorts by unsigned UTF-8 bytes. Escaped content unwraps exactly one
complete literal CDATA-marker pair; one-sided/nested markers reject.

The document has exactly one empty-namespace `rss` root and no non-ASCII-whitespace outside it. The
root has exactly `version="2.0"` plus optional `xmlns:media`; no other attributes. It has exactly
one direct empty-namespace `channel`, no other children, and no non-whitespace direct text.
`channel` has no attributes and accepts only: required singleton scalar `title`, `link`, and
`description`; optional singleton scalar `language`, `pubDate`, `lastBuildDate`, and `generator`;
and 1-256 direct `item` children. Channel scalars are empty-namespace, attribute-free, and contain
text/CDATA only. Unknown or duplicate channel scalars reject. Channel scalars are bounded selection
context and excluded from item projection/identity.

The only item path is `/rss/channel/item`; channel and item are direct empty-namespace children.
`item` has no attributes.
Each item accepts exactly these direct children: required singleton empty-namespace `title`, `link`,
`guid`, `contentType`, `content`, and `categories`; optional singleton empty-namespace `subtitle`,
`description`, `pubDate`, `modDate`, `relatedPages`, and `enclosure`; and optional singleton
qualified `media:content`. `categories` contains only 1-32 direct empty-namespace `category`
children. `contentType` text is exactly `releases`. Unknown direct item children, wrong nesting,
duplicate singleton fields, or child elements inside scalar fields reject.

The literal root attribute `xmlns:media` is optional; when `media:content` occurs it is required
exactly once with value `http://search.yahoo.com/mrss/`. Because the pinned parser is deliberately
not namespace-aware, recognition is the pair of that validated binding and literal qualified name
`media:content`; no other prefix or URI is equivalent. Core scalar fields and `category` are
attribute-free text/CDATA only; `categories` is attribute-free. The full subtrees rooted at
`media:content`, `relatedPages`, and `enclosure` are opaque: any parser-accepted names, bounded
attributes, and bounded text are permitted under the global byte/token/depth/attribute limits, but
none is decoded as a URL, selected, projected, hashed, or followed. Their only validation is
well-formed callback structure and those global bounds. Other channel items are parsed under the
same closed grammar and are bounded selection context; only the one selection-key match projects.

After that unwrap, RSS `content` is parsed as an HTML fragment by the exact retained-token grammar
defined below for release-visible content: identical `AllowedTag`, token union, entity decoding,
text coalescing/whitespace, dropped subtrees, transparent elements, and bounds. It does not run the
`.article`/title/subtitle/date/body selector phase; the entire fragment is the input root. Its
ordered token array is the `contentTokens` field of the RSS projection. No alternative sanitizer,
DOM serialization, platform parser normalization, or raw HTML string enters the projection hash.

Raw RSS and release HTML bytes must be UTF-8 without BOM, validated by Node 24.17.0
`TextDecoder("utf-8",{fatal:true,ignoreBOM:false})`; malformed bytes, a leading U+FEFF, or U+0000
reject. Parsing uses the repository-locked `htmlparser2@12.0.0` streaming `Parser`, whose locked
entity implementation is `entities@8.0.0`. XML uses exactly `{xmlMode:true,decodeEntities:true,
lowerCaseTags:false,lowerCaseAttributeNames:false,recognizeSelfClosing:true}`. HTML uses exactly
`{xmlMode:false,decodeEntities:true,lowerCaseTags:true,lowerCaseAttributeNames:true,
recognizeSelfClosing:false}`. No DOM/tree adapter or browser parser participates.

The public NVIDIA normalizer input is an exact inert own-data object with only `rssBytes`,
`releaseHtmlBytes`, and `selectionKey`; parser options are likewise exact inert own-data with only
optional bounded chunk sizes. Proxies, accessors, symbols, inherited/custom-prototype/
non-enumerable/extra fields, cycles, and invalid nested values reject as `ir.bundle-invalid` before
any caller member is read. Both accepted byte members are copied once into detached `Uint8Array`
instances. The normalizer then applies individual and aggregate member ceilings before a raw
digest, decode, or parse.
Each completed RSS-item and release-visible projection is measured as canonical UTF-8 JSON and must
fit the 4 MiB projection ceiling before its component hash is formed.

Each raw document and decoded RSS-content fragment starts a fresh parser with an empty element
stack; content is a top-level fragment with no synthetic context element. The ordered streaming
open/text/close callback sequence is authoritative, including the parser's HTML recovery and
named/numeric entity algorithm. Any parser error, processing instruction/declaration, forbidden
DTD/entity syntax, bound overflow, impossible close-stack transition, or selector-cardinality
failure rejects as malformed. At end, htmlparser2-implied close callbacks must leave the stack
empty. Chunk boundaries are varied in tests and cannot change projections.

Time grammar is exact case-sensitive ASCII `Day, DD Mon YYYY HH:mm:ss GMT`, years 1970-9999,
Gregorian-valid with matching weekday, no leap seconds/comments/folding/tabs/numeric zones/locale/
host parsing. Item pubDate alone supplies provider publication time; missing is null/unknown and
malformed present is timestamp-invalid. Mod/channel/page/HTTP/retrieval times never substitute.

Visible release projection selects exactly one `.article` root with one `h1.article-title`, at most
one subtitle, one date, and one body. RSS/H1 titles match. Element and attribute names are ASCII
lowercased by the HTML tokenizer. Class values split only on ASCII whitespace and selectors require
the exact lowercase tokens `article`, `article-title`, `article-subtitle`, `article-date`, and
`article-body`; token order and extra class tokens do not affect selection.

The retained projection token is exactly `SemanticHtmlTokenV1` above.
Attributes, namespaces, comments, and processing instructions never enter tokens. Complete
`http:`/`https:` URL tokens are removed from retained text. Remaining text/entity chunks are
decoded, coalesced, ASCII-whitespace-collapsed, and empty text is dropped before token
emission. `br` emits adjacent start/end tokens. Subtrees rooted at
`script|style|template|audio|video|svg|canvas|picture|img|iframe|object|embed` are dropped with all
descendants. All other non-allowlisted elements are transparent: their retained descendants remain
in order without wrapper tokens. Thus URL/style-only markup changes are non-semantic; visible
text/structure changes revise.

NVIDIA has retrieved `ir.rss-feed` and `ir.release-html` members plus derived `ir.rss-item` and
`ir.release-visible` proofs. For each raw member, the loader performs exactly one
`ArtifactStore.getObservation(selectedObservationId)` and validates both authoritative observations
before any body read. It recomputes each observation ID/hash; requires the persisted NVIDIA provider
identifier, matching artifact digest, and `retrievedAtMs <= asOfMs`; and rejects missing, forged,
duplicate, or inconsistent authority as `ir.observation-invalid`. It then performs exactly one
`ArtifactStore.read(artifactHash)` per raw member. Each verified read must declare SHA-256, the same
digest, and the declared bounded size. The loader first acquires both verified reads exactly once
without consuming either stream, settles both acquisition calls, and validates the complete
metadata set plus member and aggregate bounds. Any acquisition or metadata failure destroys every
acquired stream and crosses a bounded cancellation-settlement barrier before returning; no sibling
stream may start or remain active. Only after that atomic metadata gate passes are the streams
consumed sequentially under the 10 MiB member and 20 MiB aggregate ceilings while actual sizes and
digests are recomputed. Any consumption failure likewise cancels and settles all streams before
return. Underrun, overrun, growth/replacement, or substitution fails closed. The loader never calls
attempt-history or enumeration APIs and never stats or opens a manifest path. Derived proofs have
no observation or store operation.

That settlement barrier relies on the trusted `ArtifactStore` postcondition that every returned
`VerifiedArtifactRead.stream` uses normal close emission: completing its destruction lifecycle after
`destroy()` produces one observable terminal `close` acknowledgement. `emitClose: false` and any
other non-acknowledging stream are contract-invalid and unsupported. This is an explicit statement
of the existing settle-before-return requirement, not an `ArtifactStore` interface change; a timer,
poll, or event-loop-turn fallback is not a terminal acknowledgement.

Both raw digests remain immutable evidence/ledger provenance; neither enters domain identity. The
selected composite projection hash is the candidate/EventDraft primary. Classification accepts
only exact NVIDIA financial-results titles: first/second/third quarter -> Q1/Q2/Q3; fourth quarter
and fiscal year -> FY, years 2000-9999. Nonmatch is ignored; RSS/H1 mismatch quarantines; issuer is
fixed CIK/symbol.

GUID is an empty-namespace XML element with the sole empty-namespace attribute
`isPermaLink="true"`; attribute and value comparison is case-sensitive. GUID text and link must
produce one selection key. A reference is accepted only when every input byte is visible ASCII,
the total is at most 2048 bytes, and a byte-oriented splitter yields: exact lowercase scheme
`https`; no userinfo; exact lowercase ASCII host `nvidianews.nvidia.com`; no port; and path exactly
`/news/<slug>` with `^[a-z0-9]+(?:-[a-z0-9]+)*$` and slug at most 256 bytes. Percent signs,
backslashes, repeated slashes, empty/dot/dot-dot path segments, non-ASCII/IDNA input, controls,
and ASCII whitespace reject. No percent decoding, dot-segment removal, host case-folding, IDNA,
redirect resolution, or platform URL normalization occurs.

An optional query begins at the first `?`, an optional fragment begins at the first `#`, and each
may contain only bytes `!` through `~` except backslash; `#` may occur only as the single fragment
delimiter. Both are discarded. The key is the literal `https://nvidianews.nvidia.com/news/<slug>`.
In parsed HTML, ASCII-lowercased attribute names are used; `rel` splits only on ASCII whitespace
and must contain exactly one lowercase `canonical` token, while `property` must equal lowercase
`og:url`. Exactly one matching `link[rel~=canonical][href]` and one `meta[property=og:url][content]`
must exist document-wide; duplicate matching elements reject even if equal. Their values obey the
same reference grammar and key. Off-host/ambiguous references, missing/duplicate canonical facts,
or key disagreement quarantines. Recorded code never follows redirects or any
media/enclosure/body/subresource link.

The exact title grammars are `^NVIDIA Announces Financial Results for (First|Second|Third) Quarter
Fiscal (20[0-9]{2}|[3-9][0-9]{3})$` and `^NVIDIA Announces Financial Results for Fourth Quarter and
Fiscal (20[0-9]{2}|[3-9][0-9]{3})$`. The exact FMP naive timestamp regex is
`^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?$`; the explicit regex is
the same date/time with `T` plus `(?:Z|[+-][0-9]{2}:[0-9]{2})`.

## Bounds, mirrors, and effects

FMP: 1 raw/1 derived, 10 MiB, 1-1000 items, 250k JSON tokens, depth 64, exactly 7 keys, 8 MiB
decoded/projection, 256 KiB transcript. NVIDIA: 2 raw/2 derived, 10 MiB each/20 MiB total, 1-256
items, 250k XML and HTML tokens, depths 64/256, attributes 64/256, 32 categories, 4 MiB projected
text, 256 KiB transcript. Field limits and every exact/one-over case are frozen in the fixture spec.

First source freezes a branch and mirror timer. A distinct SEC/FMP/IR release before deadline is
retained and mirror-debounced; timer creates confirmation. At/after deadline it confirms
immediately. SEC V2 non-null bundle versus V1 null can never satisfy exact mirror-duplicate even
with equal primary digest. FMP/IR V1 may exact-mirror only with equal semantic primary and both null
bundles. Later arrivals cannot mutate a leased branch. Redelivery is idempotent; the same provider
record/revision with conflicting semantic draft/evidence fails closed. All runs are non-live
`effectsAllowed:false` and offline.

All fixtures are original synthetic content; real bodies require per-artifact redistribution
approval and licensing. Required executable cases are the binding acceptance matrix.
