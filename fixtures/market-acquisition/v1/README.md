# P1-10 synthetic acquisition contract fixtures

This directory is an original PEAS contract corpus. It is deliberately abstract: the fixture
members contain invented colors and ordinals, not market symbols, prices, provider field names,
provider response shapes, endpoint material, pagination material, credentials, or provider bytes.

The corpus exists only to prove deterministic page ordering, duplicate handling, conflict
quarantine, restart behavior, and replay page-size invariance. It is not evidence of provider
behavior and it is not authorized for use as a live request or response template.

`manifest.json` records the closed scenario inventory. `synthetic-pages.json` supplies three
abstract verified-page projections. Tests construct all hostile and exact-limit values in memory so
that no credential-shaped value, raw pagination material, or provider-like payload is persisted.
