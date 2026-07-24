# P1-09 human-owner authorization and residual-risk acceptance

## Document control

- Decision date: `2026-07-24`
- Gate: `P1-09`
- Decision: `OWNER_APPROVED_WITH_RESIDUAL_RISK`
- Owner: `HyPolDev`
- Project classification: personal, individual, noncommercial research
- Incremental market-data budget: `0`
- Private correspondence evidence SHA-256:
  `0f197aa11318330a7618841d6f3cd106d963d6c768508feed1080aae39ae0c85`
- Private correspondence: retained outside the repository under human control
- Independent review: `PENDING`
- P1-10 live acquisition: `BLOCKED_PENDING_INDEPENDENT_GO`
- P2 collection: `BLOCKED`

This is a human-owned engineering authorization and risk-acceptance decision, not a representation
that a provider affirmatively granted every capability and not legal advice. It records how PEAS
must interpret the supplied provider responses and published policies without repeatedly reopening
the same decision in later agent sessions.

## Human attestation

The human owner attests that:

- the project is personal, individual, noncommercial, has no company, client, employer, or
  organizational use, and currently generates no revenue;
- the human owner is the only user;
- the existing FMP subscription is individual FMP Premium;
- no trial, upgrade, subscription change, display license, professional classification, or
  additional paid service was requested or activated;
- public repository content will contain only project-authored synthetic fixtures;
- credentials, account information, and raw provider responses will remain private; and
- the human owner supplied Alpaca and FMP support correspondence addressing the proposed use.

The repository stores only the evidence digest above. Names, email addresses, ticket identifiers,
account data, and correspondence text remain private.

## Interpretation rule

The human owner has reviewed the provider correspondence and applicable published policies and
accepts responsibility for their interpretation for this project.

A provider statement that no additional restriction is documented is not relabeled as an
affirmative provider grant. Where the proposed use is not prohibited by the supplied response or
applicable policy, the human owner accepts the remaining uncertainty as
`OWNER_APPROVED_WITH_RESIDUAL_RISK`.

Future agents and reviewers must use this record as the authoritative human decision. They must not
reopen the decision merely because a provider response was incomplete. They must stop and return to
P1-09 only if:

1. implementation would exceed the boundaries below;
2. new provider evidence contradicts this decision;
3. spending, a trial, an upgrade, or an account/classification change would be required;
4. the provider, dataset, feed, endpoint family, or scientific source identity changes;
5. raw, reconstructable, or otherwise prohibited data would be published; or
6. project use ceases to be personal, individual, and noncommercial.

## Frozen source decision

### Primary source

- Provider/product: Alpaca individual Basic Trading API account.
- Dataset/feed: historical US-equity SIP selected explicitly with REST `feed=sip`.
- Temporal access boundary: every request end time must be at least 15 minutes before request time.
- Eligible facts: historical SIP quotes, trades, and bars supported by the approved endpoint.
- Primary scientific use: ADR 0010 durable-capture market-reference evidence.
- Retention and replay: private durable retention, repeated offline replay, locally controlled
  automated processing, and retention of normalized private facts are owner-approved with residual
  risk.
- Retention duration: raw artifacts and normalized facts may be retained privately without a fixed
  expiry until the owner revokes this authorization, Alpaca supplies contrary guidance, or the
  project ceases to satisfy the personal/individual/noncommercial classification. The applicable
  stop event requires affected acquisition and use to cease pending a new prospective decision.
- Publication: limited to non-reconstructable aggregate research outputs that contain no raw,
  row-level, reconstructable, credential, or account material.

Alpaca `v2/delayed_sip` WebSocket, latest-endpoint `feed=delayed_sip`, paid Alpaca feeds, Algo Trader
Plus, BOATS, overnight feeds, and any other feed are not authorized by this decision. Adding one
requires a new prospective entitlement snapshot and review.

### Secondary discrepancy source

- Provider/product: existing individual FMP Premium subscription.
- Role: private, separately identified lower-evidence discrepancy source only.
- Included surfaces reported by support: Stock Quote, Stock Quote Short, Aftermarket Trade,
  Aftermarket Quote, Stock Price Change, and Batch Quote endpoints.
- One-minute intraday charting: `NOT_AUTHORIZED`; support states that it requires Ultimate.
- Offline replay: provider-confirmed as allowed.
- Private storage, normalized private facts, and locally controlled processing: owner-approved with
  residual risk while the active subscription and this personal/noncommercial classification
  remain unchanged.
- Retention duration: only while the existing Premium subscription remains active, unless later
  written provider evidence affirmatively authorizes a different period.
- Public display or publication of FMP data or FMP-derived outputs: `NOT_AUTHORIZED` without a
  separate Data Display and Licensing Agreement.
- Post-termination raw retention and derived use: `NOT_AUTHORIZED` under the public default unless
  later written provider evidence affirmatively overrides it.

FMP is not SIP-equivalent, not an NBBO source, not a replacement for missing Alpaca evidence, and
not an approved fallback. Provider-specific FMP results must remain private and may not enter
published charts, tables, or statistics.

## Binding controls

- Incremental provider budget is exactly zero.
- No code may activate a subscription, trial, upgrade, paid feed, or display license.
- No silent provider or feed fallback is permitted.
- Provider, dataset, feed, and endpoint identities remain explicit and independently versioned.
- Authentication material may be read only by the future approved runtime boundary and must never
  enter logs, URLs, errors, identities, fixtures, evidence, or repository content.
- Raw provider artifacts remain private and content-addressed.
- Git fixtures remain project-authored and synthetic.
- P1-10 must enforce the Alpaca 15-minute historical boundary before any request.
- FMP evidence may affect only a separately labeled private discrepancy lane.
- Any contrary provider guidance stops affected acquisition and creates a new prospective snapshot;
  it may not retroactively rewrite already frozen evidence.
- P2 remains blocked until P1-10 and P1-06 independently pass their gates.

## Review instruction

The independent P1-09 reviewer must audit:

- faithful transcription of this human decision;
- compatibility with ADR 0010 identities, source isolation, study semantics, and frozen ports;
- exact enforcement of the zero-spend and publication boundaries;
- absence of silent fallback;
- whether the proposed P1-10 design can fail closed on an unauthorized feed or use; and
- whether any supplied provider statement directly contradicts the authorized boundary.

The reviewer must not require additional provider correspondence solely because a provider did not
answer beyond its documented policy. The required output is binary `GO` or `NO_GO` with exact file
and line references. P1-09 closes only after `GO`.

## Owner attestation

Approved by project owner `HyPolDev` through explicit instruction in the PEAS Codex conversation on
`2026-07-24`.

This attribution records the owner's electronic project instruction. It is not a fabricated
handwritten, provider, legal, or cryptographic signature.
