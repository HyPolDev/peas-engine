# SEC-first offline readiness

> Historical implementation packet. PR #13 merged this disabled-by-default path, but Costco is no
> longer an active observation target or fallback. Current product direction is the provider-free
> calendar-driven EventPlan/EventCluster beta in `docs/NEXT-STEPS-EVENT-CLUSTER.md`. Any future
> issuer and live provider window require a new exact authorization.

## Product outcome

Prepare one future read-only observation of a new Costco Wholesale Corporation filing after the
configured activation time. The narrow path is:

`static window -> bounded SEC submissions read -> filing member plan -> immutable artifact vault -> existing SEC normalizer -> SQLite event provenance`

This candidate is offline-only. Its committed configuration has `enabled: false`; it performs no
DNS or HTTP request unless a later exact-candidate live authorization changes the runtime gate.

## Proposed observation

- Issuer: Costco Wholesale Corporation
- CIK: `0000909832`
- Candidate event: fiscal 2026 fourth-quarter earnings, scheduled by Costco for September 24, 2026
- Proposed UTC observation window: `2026-09-24T20:00:00Z` through `2026-09-25T04:00:00Z`
- Qualifying filing: first post-activation `8-K` or `8-K/A` containing Item `2.02`
- Official destinations only: `https://data.sec.gov` and `https://www.sec.gov`
- Exact disabled configuration: `config/sec-first/costco-2026-09-24.disabled.json`

Costco is the lean first target because its investor calendar publishes a near-term earnings date
and its prior fiscal-year earnings release was filed as an Item 2.02 Form 8-K. The date is a
planning input, not proof that a future filing will occur inside the proposed window.

Research sources:

- <https://investor.costco.com/events-and-presentations/default.aspx>
- <https://www.sec.gov/Archives/edgar/data/909832/000090983225000093/0000909832-25-000093-index.htm>
- <https://www.sec.gov/about/developer-resources>

## Boundary and retention

The client allows only the exact issuer submissions path and archive paths rooted under Costco's
numeric CIK. It denies credentials, redirects, URL credentials, queries, fragments, other hosts,
other CIKs, malformed paths, oversized responses, unexpected statuses, and timeouts. A `404`
settles as stable missing rather than inventing an event. The request identity excludes the raw
path and is safe to persist.

Successful response bytes enter the existing content-addressed durable artifact store before the
existing recorded SEC loader and normalizer can append to the existing SQLite event log. Existing
deduplication makes identical delivery idempotent. A restart after raw storage can rebuild the
manifest from persisted observation identities; a restart after event append redelivers the same
provider identity without a second event. No new checkpoint, supervisor, evidence framework, or
retention subsystem is introduced.

## Minimum live-entry evidence

Before requesting any SEC access, freeze and verify:

1. exact SHA, tree, branch, PR head, and configuration digest;
2. targeted provider-free integration and boundary-denial tests;
3. raw artifact, existing normalizer, SQLite provenance, duplicate, restart, and stable-missing
   behavior;
4. successful Linux and Windows CI;
5. zero credential, account, subscription, spending, broker, order, portfolio, position, fill,
   trading, and financial effects; and
6. one fresh independent `SEC_FIRST_OFFLINE_REVIEW_GO`.

Merge and live SEC access are separate human gates. The later live request must identify the exact
merged candidate, configuration digest, issuer, observation window, and permitted SEC destinations.

## Stop and rollback

Stop before live entry on identity drift, a dirty worktree, configuration mismatch, a non-SEC
destination, credential access, unexpected redirect, incomplete artifact or SQLite provenance,
failed CI/review, or any prohibited effect. Offline rollback is removal of the new branch/draft PR;
the base main commit and PR #10 are untouched. After a live launch, preserve any committed raw
artifact and provenance and stop further polling; do not delete evidence to simulate rollback.
