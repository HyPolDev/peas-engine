# P1-10 original-synthetic Alpaca wire-grammar fixtures

## Provenance

Every JSON value in this directory was authored for the PEAS P1-10 contract amendment. The corpus:

- uses documented wire field names only after the amendment contract cites an official Alpaca
  source for the field and its type;
- uses invented `PEAS`-prefixed color symbols, invented timestamps, invented ordinals, and invented
  numeric values;
- contains no copied or structurally transcribed provider example, response, market observation,
  real symbol, price, trade identifier, continuation token, request ID, or error body;
- contains no URL, query string, header, credential, account, entitlement, subscription, or
  provider-call evidence; and
- is inert offline input and must never be interpreted as proof of undocumented provider behavior.

The fixtures intentionally preserve documented field names because their sole purpose is to prove
the closed parser and translation grammar. All other structure and content is project-authored.

## Closed conventions

- Invented symbols begin with `PEAS` and name a color.
- Times are original UTC instants selected for this corpus, not observed market times.
- Decimal JSON numbers are short, deliberately non-market values selected to exercise exact token
  parsing and canonical decimal translation.
- Synthetic opaque continuation material begins with `peas-synthetic-opaque-`; it is not provider
  material and must remain private test input.
- Case identifiers and ordinals are project metadata outside the wire value. They never enter a
  provider parser.
- A case marked `accept` is authorized only when every field and semantic is frozen by the
  amendment contract. A case marked `reject` identifies the single intended contract violation.
- No vector is added for an undocumented or ambiguous semantic. Such a gap is reported as a stop
  condition instead of being guessed.

## Fixture groups

The closed file inventory is declared by the parent `manifest.json`. Valid quote, trade, and raw
one-minute-bar pages are separated from envelope, field-shape, timestamp, pagination, and
delivery/revision fault vectors so that every rejection has one reviewable cause.
`hostile-atomicity-faults.json` contains inert, literal recipes for constructing runtime-only
accessors, proxies, custom prototypes, and extra array properties. It embeds no executable hostile
value. The valid-update-first recipes require one terminal `correction-unsupported` decision and
zero later hostile invocations or semantic effects; the hostile-container recipes require a typed
schema rejection before any getter, Proxy trap, record, quarantine, normalization, or selection.
