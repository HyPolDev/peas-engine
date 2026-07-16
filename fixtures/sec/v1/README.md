# Recorded SEC fixture contract (v1)

This tree is wholly synthetic and redistribution-safe. No body was copied from, adapted from, or
downloaded from the SEC or another provider. The metadata values, markup, non-UTF-8 octets, accessions,
CIKs, timestamps, and limit payloads are invented solely to exercise ADR 0007. There are no real
request identities, provider filenames, URLs, query strings, credentials, secrets, arbitrary headers,
or live network paths.

`manifest.ts` is generated data, not executable normalization logic. It freezes literal body SHA-256
digests, selected observation IDs and hashes, valid evidence-bundle hashes, loader-selection hashes,
loader-transcript hashes, expected outcomes, and the canonical manifest hash. Every fixture member has
exactly one `selectedObservationId`; the lookup-failure vector deliberately selects a hash-shaped ID
whose observation is absent. Structurally valid ignored and quarantined semantic cases keep their
bundle identity.

## Required A-F matrix

| Area | Cases | Structural distinction |
| --- | ---: | --- |
| A | 6 | Item 2.02, two-exhibit primary selection, inline 10-Q focus, separate 10-K XBRL, matching linked periodic evidence, and independent next-morning filing |
| B | 13 | Every missing required role, duplicate singleton/digest, absent/wrong primary, tied/conflicting sequence, 17 members, and unknown role |
| C | 15 | Non-earnings 8-K, padded/unpadded/missing/conflicting CIK, accession-prefix mismatch, linked CIK/period conflict, absent/conflicting focus, redelivery, all allowed amendment forms, and conflicting same-record bytes |
| D | 8 | At/future as-of, unresolved selection, digest/provider/reuse failures, and two eligible observations over identical bytes |
| E | 11 | Equivalent/RFC/header timestamps, standard/daylight conversion, absence/conflict/malformed/pre-2007, filing/retrieval exclusion, and linked-periodic exclusion |
| F | 19 | All ten accepted aliases, BOM, undeclared UTF-8 and Windows-1252 fallback, unsupported/conflicting encoding, both sniff-window edges, and tolerated/quarantined malformed markup |

The 16 declared G vectors cover exact and one-over member bytes, a valid four-member 32 MiB bundle
and one-over total, semantic tokens including processing instructions/comments/CDATA/text, depth,
attributes, extracted text, transcript bytes, and exactly 16/17 distinct members. Large vector bytes
are generated in memory by the test and are not checked in.

## Reproduction and integrity

`generate-contract.mjs` deterministically materializes the small synthetic bodies and the literal
manifest. With no arguments it writes this tree; `--output-root <directory>` writes the same declared
generated tree to the selected directory. Generation and formatting always occur in an isolated
temporary staging root outside the force-ignored raw-body tree. The generator verifies the complete
staged file set and promotes exact final bytes only after every generation and formatting step
succeeds. Ordinary generation or formatter failures leave the target bytes unchanged, while caught
promotion-write failures restore prior files and remove directories created by that attempt. Target
components and members are containment-checked before promotion and rollback and revalidated before
each mutation. It formats JSON bodies and `manifest.ts` itself with the repository's pinned local
Biome executable, so reproduction requires no manual formatting step. It uses code-unit ordering and
local hashing only, records the normalized generator-source hash and complete generated path list, and
performs no network access.

Promotion is sequential rather than globally crash-atomic. A hard process termination or power loss
during promotion can leave a partial target or staging directory; rerun generation and remove any
abandoned `peas-sec-fixture-stage-*` temporary directory after such an interruption.

`test/sec-fixtures.test.ts` regenerates under distinct locale/timezone environments and byte-compares
every declared generated file, independently recomputes all hashes, parses the small structural
metadata, verifies ignored-target behavior, closed test-mode controls, containment, formatter-failure
atomicity, and caught-write directory rollback, derives primary exhibit selection from supplied member
permutations, enumerates every tree entry, rejects lexical and link/reparse escapes (including the
Windows reparse attribute), and scans the canonical manifest plus every checked-in fixture-tree file
for prohibited material.
