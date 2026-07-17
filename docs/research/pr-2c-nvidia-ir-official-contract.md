# PR 2C NVIDIA investor-relations RSS research

- Mode: official NVIDIA IR, NVIDIA Newsroom feed, and linked official release pages
- Fixture policy: synthetic only; no redistribution approval for real release bodies was found
- Adapter conclusion: NVIDIA-specific Newsroom RSS, not a reusable Q4 feed contract

## Official structure observed on 2026-07-16

The [NVIDIA IR RSS page](https://investor.nvidia.com/investor-resources/rss/default.aspx) says RSS
provides headlines, summaries, and links. Its Press Release link resolves to the official
[NVIDIA Newsroom press-release feed](https://nvidianews.nvidia.com/cats/press_release.xml).

The feed is RSS 2.0 with a Media RSS namespace and identifies its generator as iPressroom. Observed
channel fields include title, link, description, language, `pubDate`, `lastBuildDate`, and
generator. Observed item fields include title, link, `media:content`, `contentType`, subtitle,
content, categories/category, `modDate`, relatedPages, description, enclosure, guid, and `pubDate`.
Observed GUIDs have `isPermaLink=true` and equal the linked Newsroom URL. Item `pubDate` and
`modDate` use English RFC-822-style GMT strings. Media and enclosure references may use a
non-NVIDIA host and are never followed by this adapter.

An [official linked financial-results release](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2027)
has a Press Release label, heading, date-only page label, body, and matching `rel=canonical` and
`og:url`. The feed `pubDate`, not the page's date-only label, is the publication-time candidate.

The discovery page is powered by Q4, but the linked feed says iPressroom. A separate
[NVIDIA Q4-hosted release mirror](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Unveils-Vera-the-CPU-for-Agents/default.aspx)
has a different detail-page structure and is not the linked RSS item shape. Feed fields, GUID
behavior, extensions, and correction semantics must not be generalized to other Q4 issuers.

## Undocumented behavior

NVIDIA does not promise GUID immutability, correction linkage, retention depth, field completeness,
the semantics of `modDate`, or canonical redirect stability. PR 2C treats those as observed inputs
under a versioned NVIDIA adapter, not universal provider guarantees. It never infers an exact
publication instant from channel dates, `modDate`, retrieval time, HTTP metadata, or a page's
date-only label.
