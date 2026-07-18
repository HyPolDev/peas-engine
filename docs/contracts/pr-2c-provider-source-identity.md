# PR 2C provider and source identity table

Provider and source identities are independent even when observations share one artifact digest or
describe the same earnings release. Cross-source correlation uses the earnings subject; it never
rewrites source provenance or revision lineage.

| Source | Provider | Adapter/source | Record identity | Revision identity | Publication policy |
| --- | --- | --- | --- | --- | --- |
| SEC 8-K | `sec-edgar` | `sec:normalizer-v1` | `sec:<accession>:earnings-source-v2` | `1`; amendments have a new accession | ADR 0007 RFC 3339 or frozen SEC Eastern policy |
| SEC periodic | `sec-edgar` | `sec:normalizer-v1` | `sec:<accession>:periodic-source-v2` | `1`; amendments have a new accession | ADR 0007 RFC 3339 or frozen SEC Eastern policy |
| FMP press release | `financial-modeling-prep` | `peas-recorded:fmp-press-release-synthetic-v1` | `fmp-recorded-synthetic:<H(symbol,publishedDate,semantic title)>` | `sha256:<H(closed semantic projection)>` | Explicit-offset RFC 3339 is `provider`; naive/null is `unknown` |
| NVIDIA Newsroom RSS | `nvidia-ir` | `peas-recorded:nvidia-newsroom-press-release-synthetic-v1` | `ir:nvidia:<H(CIK,title,itemPubDate)>` | `sha256:<H(RSS projection,visible projection)>` | Strict English RFC-822 GMT item `pubDate` is `provider`; missing is `unknown` |
| Future NVIDIA Q4 detail mirror | `nvidia-ir` | a new, separately reviewed source | Not defined in PR 2C | Not defined in PR 2C | Not defined in PR 2C |

`H` is SHA-256 over canonical JSON with the domain separator named in ADR 0008. NVIDIA exposes no
documented non-URL stable item identifier, so title or item-publication text changes create a new
record and supersession is not guessed. GUID/link/canonical are validation/telemetry only. Complete
URLs, queries, fragments, credentials, headers, retrieval times, observation IDs, collection pages,
and fixture paths never enter record, revision, or projection hashes.

FMP latest and search are acquisition variants of one source. Endpoint variant, page, limit, and
symbol filter are telemetry. FMP documents no stable record or revision ID; a title or publication
string change therefore becomes a new logical record rather than a heuristically linked revision.
Same logical tuple plus changed semantic title/body is a deterministic new revision. Site, image,
URL, HTML comments, and URL tokens in title/body are nonsemantic.

For NVIDIA, same non-URL record family plus changed retained semantics is a new revision. URL-only,
query-only, fragment-only, canonical/og/GUID, comment-only, and other nonsemantic markup changes
preserve revision and EventDraft identity. FMP/NVIDIA raw digests remain immutable acquisition and
ledger provenance but enter no record, revision, event, or evidence-bundle hash.
Provider-scoped supersession is recorded only with provider evidence; it is never inferred across
SEC, FMP, IR, or a future Q4 mirror.
