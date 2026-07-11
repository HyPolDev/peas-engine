# ADR 0005: Release evidence is bound and reconciled by candidate commit

- Status: Accepted
- Date: 2026-07-10
- Amended: 2026-07-11 (RC.2 durability and attestation)

## Context

A passing Windows check, Linux check, 10k scale run, and 100k scale run are not one release gate if
they were executed against different revisions. Artifact names and human-readable logs alone also
do not prove the tested source, dependency lockfile, golden vector, runtime, or integrity result.
Failed scale runs must not leave metrics that can be mistaken for release evidence.

## Decision

Every audit job checks out `PEAS_CANDIDATE_SHA`, verifies that it equals `git rev-parse HEAD`, and
requires a clean worktree before execution. The manually dispatched 100k workflow additionally
requires the dispatch ref SHA and workflow-definition SHA to equal the candidate. Checkout
credentials are not persisted.

Windows and Linux checks emit machine-readable test counts, coverage percentages and thresholds,
and mutation results. Scale metrics derive their SHA from Git, run correctness and
`PRAGMA integrity_check` assertions before writing, and explicitly record `gateStatus: passed`,
`integrityCheck: ok`, the complete latency/RSS/storage measurements, and worktree cleanliness.

Each gate evidence record contains:

- candidate, event, and workflow SHAs;
- workflow/run/attempt identity and URL;
- fixed runner OS label plus observed hosted-image identity;
- exact Node/npm versions and package-lock hash;
- captured-stream and golden-file hashes and golden heads;
- the complete relevant check and scale results.

Before the workflow exists on the default branch, adding the `audit-100k` label to the candidate PR
is the manual trigger. That labeled run repeats Windows, Linux, and 10k, executes 100k, and
reconciles all four artifacts within one CI run. After merge, `workflow_dispatch` is the manual
release trigger, while `schedule` produces regression evidence only. Scheduled evidence records
its actual `schedule` trigger and cannot satisfy a release gate. The standalone release-evidence
workflow can reconcile separate CI and manually triggered 100k run IDs. Release paths fail unless
all records use one candidate, runtime, lockfile, capture, and golden vector. Only then is a passing
release manifest emitted. The RC tag may point only to the reconciled candidate SHA.

GitHub actions are referenced by immutable commit SHA. Hosted runners use explicit OS labels
(`ubuntu-24.04` and `windows-2025`) instead of moving `-latest` aliases. Because hosted image builds
still receive updates, their `ImageOS` and `ImageVersion` values are recorded rather than claiming
bit-for-bit runner reproducibility.

### RC.1 disposition and RC.2 immutable-release evidence

`v0.2.0-kernel-rc.1` remains an immutable historical audit ref at
`f8764667970be2474e126ac8eab7ba7c92e66b5e`. Its same-SHA gates are valid evidence for that
revision, but its completed report exists in mutable pull-request text and its reconciled workflow
artifact is retention-limited. The post-audit decision is therefore `CONDITIONAL GO`: RC.1 may be
used for design and offline audit comparison, but it is not the frozen V2 kernel and must not be
merged as the final candidate. The tag must never be moved, replaced, or deleted.

RC.2 may receive `GO` only when all of the following are durable and mutually consistent:

- GitHub release immutability is enabled for the repository before the RC.2 release is published;
- the RC.2 release is created as a draft, and the completed go/no-go report, reconciled release
  manifest, and `SHA256SUMS` are attached before publication;
- the draft is published as a prerelease only after all assets are present and their digests have
  been independently checked;
- the published release reports `isImmutable: true`, so its tag and assets are locked;
- each asset embeds the exact candidate commit, tag, workflow run identity, and evidence links;
- `SHA256SUMS` publishes the SHA-256 digest of every other attached asset (it does not list itself);
  and
- GitHub's automatically generated, cryptographically signed immutable-release attestation verifies
  the release tag, candidate commit, and every attached asset.

For RC.2, **attested** means GitHub's immutable-release attestation, generated automatically when
the fully populated draft is published. Verification must run all of the following against
`HyPolDev/peas-engine` after publication:

```text
gh release view v0.2.0-kernel-rc.2 --json isImmutable,tagName,targetCommitish
gh release verify v0.2.0-kernel-rc.2
gh release verify-asset v0.2.0-kernel-rc.2 <downloaded-report-path>
gh release verify-asset v0.2.0-kernel-rc.2 <downloaded-manifest-path>
gh release verify-asset v0.2.0-kernel-rc.2 <downloaded-SHA256SUMS-path>
```

The first command must report `isImmutable: true`; the tag and attested commit must equal the RC.2
candidate; `gh release verify` must succeed; and `gh release verify-asset` must succeed for every
attached asset, not only the three required evidence files. The downloaded report and manifest
must also match their entries in `SHA256SUMS`. Pull-request approval, an unsigned checksum, an
annotated tag, or a retention-limited workflow artifact does not meet this definition. If release
immutability was not enabled before publication or any verification fails, the decision remains
`CONDITIONAL GO`.

The report cannot embed its own final digest or post-publication command output: doing so would
either create a circular hash or require mutation of a locked asset. Before publication, the
finalized report records the expected tag, candidate commit, asset filenames, and a mechanically
evaluable condition that keeps the decision conditional until the commands above succeed.
`SHA256SUMS` is generated only after the report and manifest are finalized. Successful immutable
release and asset verification satisfies the recorded condition without changing any release
asset. GitHub's release attestation covers `SHA256SUMS` itself, and the verification commands remain
rerunnable against GitHub as the verification record.

## Consequences

An older passing 100k artifact cannot be reused for a newer candidate, and a failed integrity gate
cannot publish canonical passing metrics. Release evidence is self-describing enough to populate
the go/no-go report without scraping console formatting. Reconciliation remains a deliberate
manual release step because candidate 100k execution requires either the explicit PR label or a
post-merge workflow dispatch. A scheduled nightly run measures regression only and can never be
promoted into release evidence. Passing ephemeral gates alone is insufficient for RC.2: the
report, manifest, digests, and attestations are part of the release gate.

## References

- [GitHub: Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [GitHub: Verifying the integrity of a release](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity)
