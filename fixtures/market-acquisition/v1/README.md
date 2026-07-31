# P1-10 synthetic acquisition contract fixtures

This directory is an original PEAS contract corpus. Its pre-amendment members remain deliberately
abstract: they contain invented colors and ordinals, not market symbols, prices, provider field
names, provider response shapes, endpoint material, pagination material, credentials, or provider
bytes.

The corpus exists only to prove deterministic page ordering, duplicate handling, conflict
quarantine, restart behavior, and replay page-size invariance. It is not evidence of provider
behavior and it is not authorized for use as a live request or response template.

`manifest.json` records the closed scenario inventory. `synthetic-pages.json` supplies three
abstract verified-page projections. `synthetic-alias-authority-catalog.json` is a literal,
original-synthetic authority root: it contains 65 invented issuer-mapping, instrument, and alias
preimages, their displayed identities, and one catalog identity. It contains no provider-derived
symbol or market fact. Tests construct all hostile and exact-limit values in memory so that no
credential-shaped value, raw pagination material, or provider-like payload is persisted.

`wire-grammar/` is the separately reviewed P1-10 wire-amendment corpus. It uses only field names
and types frozen from cited official Alpaca documentation. Every envelope, symbol, timestamp,
condition member, identifier, number, continuation value, ordering, duplicate, conflict, and fault
combination is an original PEAS construction. It neither copies nor structurally transcribes an
Alpaca example or response and is not evidence of undocumented provider behavior. See
`wire-grammar/README.md` for the closed provenance and safety rules. Hostile accessors, proxies,
and custom containers are stored only as inert constructor recipes and are created solely in test
memory; the fixture files contain no executable hostile value.
