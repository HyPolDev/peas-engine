# Kernel V2 RC.2 go/no-go report

RC.1 is immutable historical evidence at
`f8764667970be2474e126ac8eab7ba7c92e66b5e` / `v0.2.0-kernel-rc.1`. Its post-audit disposition is
`CONDITIONAL GO`; it cannot be substituted for any RC.2 field below.

The second RC.2 audit disposition is `NO-GO`. This template does not clear that disposition. RC.2
remains `NO-GO` until the strict-shape, inert-JSON, stored-event parity, stored-output, migration,
canonical-state, resource-ordering, portable-identifier, dedupe, and mutation regressions pass in a
clean candidate. After every local and exact-SHA remote gate passes, the report may record
`CONDITIONAL GO` solely for the outstanding immutable-publication verification condition.

## Candidate identity

- Commit SHA: `<40-character SHA>`
- Candidate tag: `v0.2.0-kernel-rc.2`
- V1 archival ref: `archive/kernel-v1`
- Worktree clean: `<yes/no>`
- Node: `24.17.0`
- npm: `12.0.0`

Every link and artifact below must embed or report the candidate SHA above. Evidence from any other
revision is inadmissible.

- Reconciled workflow artifact: `<URL; temporary evidence only>`
- Reconciliation status: `<passed/failed>`
- CI run ID shared by Windows/Linux/10k: `<run ID>`
- Manual 100k run ID: `<run ID>`
- Manual 100k trigger: `<audit-100k PR label / workflow_dispatch>`

A `schedule` trigger is regression evidence and is inadmissible for a release decision.

## RC.2 operator procedure

Run this procedure from a clean RC.2 candidate checkout using PowerShell. Replace every
`REPLACE_*` value deliberately and retain the command output with the release record. Never move,
delete, recreate, or otherwise modify `v0.2.0-kernel-rc.1`; it remains historical evidence at
`f8764667970be2474e126ac8eab7ba7c92e66b5e`.

### 1. Freeze the candidate and identify the trusted runs

```powershell
$ErrorActionPreference = "Stop"
$repo = "HyPolDev/peas-engine"
$tag = "v0.2.0-kernel-rc.2"
$candidateSha = (git rev-parse HEAD).Trim()
$ciRunId = "REPLACE_CI_RUN_ID"
$run100kId = "REPLACE_MANUAL_100K_RUN_ID"
$decisionOwner = "REPLACE_DECISION_OWNER"
$decisionDate = "REPLACE_YYYY-MM-DD"
$decisionRationale = "REPLACE_EVIDENCE_BASED_RATIONALE"

if ((git status --porcelain).Length -ne 0) { throw "Candidate worktree is dirty" }
if ($candidateSha -notmatch '^[0-9a-f]{40}$') { throw "Invalid candidate SHA" }
if ($ciRunId -notmatch '^[1-9][0-9]*$') { throw "Invalid CI run ID" }
if ($run100kId -notmatch '^[1-9][0-9]*$') { throw "Invalid 100k run ID" }
if ($decisionOwner.StartsWith("REPLACE_") -or
    $decisionDate.StartsWith("REPLACE_") -or
    $decisionRationale.StartsWith("REPLACE_")) { throw "Decision metadata is incomplete" }

$rc1Sha = (git rev-parse 'refs/tags/v0.2.0-kernel-rc.1^{commit}').Trim()
if ($rc1Sha -ne 'f8764667970be2474e126ac8eab7ba7c92e66b5e') {
  throw "RC.1 moved; stop the release"
}
$remoteRc1Sha = (git ls-remote origin 'refs/tags/v0.2.0-kernel-rc.1^{}').Split("`t")[0]
if ($remoteRc1Sha -ne $rc1Sha) { throw "Remote RC.1 moved; stop the release" }

$ciRun = gh run view $ciRunId --repo $repo `
  --json databaseId,event,headSha,status,conclusion,workflowName,url | ConvertFrom-Json
$run100k = gh run view $run100kId --repo $repo `
  --json databaseId,event,headSha,status,conclusion,workflowName,url | ConvertFrom-Json

foreach ($run in @($ciRun, $run100k)) {
  if ($run.headSha -ne $candidateSha) { throw "Run $($run.databaseId) used another SHA" }
  if ($run.status -ne "completed" -or $run.conclusion -ne "success") {
    throw "Run $($run.databaseId) is not a completed success"
  }
}
if ($ciRun.workflowName -ne "CI") { throw "CI run came from $($ciRun.workflowName)" }
$labelPath = (
  $run100kId -eq $ciRunId -and
  $run100k.workflowName -eq "CI" -and
  $run100k.event -eq "pull_request"
)
$dispatchPath = (
  $run100k.workflowName -eq "Nightly audit" -and
  $run100k.event -eq "workflow_dispatch"
)
if (-not ($labelPath -or $dispatchPath)) { throw "100k run was not manually triggered" }
```

Do not use a scheduled `Nightly audit` run. For the label path, the CI and 100k IDs are the same.
For the dispatch path, record the separate CI and `Nightly audit` IDs exactly as shown by GitHub.

### 2. Download raw artifacts without flattening them

Use a new empty directory. `gh run download` creates one subdirectory per artifact; preserve those
subdirectories because each evidence JSON is bound to raw sibling files. Do not copy all artifact
contents into one directory, use a merge option, or rename the raw files.

```powershell
$rawRoot = Join-Path $env:TEMP "peas-rc2-raw-$candidateSha"
$stageRoot = Join-Path $env:TEMP "peas-rc2-stage-$candidateSha"
if (Test-Path -LiteralPath $rawRoot) { throw "Raw evidence directory already exists" }
if (Test-Path -LiteralPath $stageRoot) { throw "Staging directory already exists" }
New-Item -ItemType Directory -Path $rawRoot, $stageRoot | Out-Null

$ciArtifactNames = @(
  "peas-check-linux-$candidateSha",
  "peas-check-windows-$candidateSha",
  "peas-scale-metrics-10k-$candidateSha"
)
if ($run100kId -eq $ciRunId) {
  $ciArtifactNames += "peas-scale-metrics-100k-$candidateSha"
}
$ciRunRoot = Join-Path $rawRoot "ci-run-$ciRunId"
New-Item -ItemType Directory -Path $ciRunRoot | Out-Null
foreach ($artifactName in $ciArtifactNames) {
  $artifactDirectory = Join-Path $ciRunRoot $artifactName
  New-Item -ItemType Directory -Path $artifactDirectory | Out-Null
  gh run download $ciRunId --repo $repo --name $artifactName --dir $artifactDirectory
}
if ($run100kId -ne $ciRunId) {
  $artifactName = "peas-scale-metrics-100k-$candidateSha"
  $run100kRoot = Join-Path $rawRoot "manual-100k-run-$run100kId"
  New-Item -ItemType Directory -Path $run100kRoot | Out-Null
  $artifactDirectory = Join-Path $run100kRoot $artifactName
  New-Item -ItemType Directory -Path $artifactDirectory | Out-Null
  gh run download $run100kId --repo $repo --name $artifactName --dir $artifactDirectory
}
```

### 3. Reconcile raw evidence before creating any RC.2 tag

```powershell
$manifestPath = Join-Path $stageRoot "release-manifest-$candidateSha.json"
$env:PEAS_CANDIDATE_SHA = $candidateSha
$env:PEAS_EXPECTED_REPOSITORY = $repo
$env:PEAS_EXPECTED_CI_RUN_ID = $ciRunId
$env:PEAS_EXPECTED_100K_RUN_ID = $run100kId
$env:PEAS_RELEASE_MANIFEST_PATH = $manifestPath

npm.cmd run reconcile:evidence -- $rawRoot
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.manifestVersion -ne 2 -or
    $manifest.reconciliationStatus -ne "passed" -or
    $manifest.candidateCommitSha -ne $candidateSha -or
    $manifest.repository -ne $repo) { throw "Reconciled manifest identity is invalid" }
```

The reconciliation command must succeed before the RC.2 tag exists. It verifies the checkout,
origin repository, trusted run IDs, exact run URLs, raw sibling bytes, scale policy, runtime,
lockfile, capture, golden heads, runners, triggers, and all four required gates.

### 4. Create and push the annotated RC.2 tag

```powershell
if ((git tag --list $tag).Length -ne 0) { throw "$tag already exists" }
git tag -a $tag $candidateSha -m "Kernel V2 RC.2 audit candidate"
if ((git rev-parse "refs/tags/$tag`^{commit}").Trim() -ne $candidateSha) {
  throw "Local RC.2 tag does not resolve to the candidate"
}
git push origin "refs/tags/$tag"
$remotePeeled = (git ls-remote origin "refs/tags/$tag`^{}").Split("`t")[0]
if ($remotePeeled -ne $candidateSha) { throw "Remote RC.2 tag does not resolve to the candidate" }
```

If any later pre-publication step fails, do not move or recreate the tag. Diagnose the failure and
produce a new candidate/tag rather than rewriting audit history.

### 5. Build the deterministic evidence package

The output directory must be new and empty. The packager independently requires a clean checkout
at the tagged SHA, reruns raw reconciliation, and requires the regenerated manifest bytes to equal
the supplied manifest exactly.

```powershell
$bundleRoot = Join-Path $env:TEMP "peas-rc2-bundle-$candidateSha"
if (Test-Path -LiteralPath $bundleRoot) { throw "Bundle directory already exists" }
New-Item -ItemType Directory -Path $bundleRoot | Out-Null

npm.cmd run package:rc-evidence -- `
  --manifest $manifestPath `
  --evidence-dir $rawRoot `
  --tag $tag `
  --candidate-sha $candidateSha `
  --ci-run-id $ciRunId `
  --100k-run-id $run100kId `
  --decision CONDITIONAL_GO `
  --decision-owner $decisionOwner `
  --decision-date $decisionDate `
  --decision-rationale $decisionRationale `
  --output-dir $bundleRoot

$manifestAsset = Join-Path $bundleRoot "release-manifest-$candidateSha.json"
$reportAsset = Join-Path $bundleRoot "kernel-v2-go-no-go-$tag.md"
$sumsAsset = Join-Path $bundleRoot "SHA256SUMS"
foreach ($asset in @($manifestAsset, $reportAsset, $sumsAsset)) {
  if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) { throw "Missing asset $asset" }
}

foreach ($line in Get-Content -LiteralPath $sumsAsset) {
  if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw "Malformed SHA256SUMS line" }
  $assetPath = Join-Path $bundleRoot $Matches[2]
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $assetPath).Hash.ToLowerInvariant()
  if ($actual -ne $Matches[1]) { throw "Checksum mismatch for $($Matches[2])" }
}
```

### 6. Populate a draft immutable prerelease, then publish

Before running these commands, enable **Immutable releases** in the GitHub repository settings.
Do not publish first and attempt to add assets later.

```powershell
gh release create $tag --repo $repo --verify-tag --target $candidateSha `
  --draft --prerelease --title "Kernel V2 RC.2" `
  --notes "Kernel V2 RC.2 evidence package; decision remains conditional until verification."
gh release upload $tag $manifestAsset $reportAsset $sumsAsset --repo $repo

$draft = gh release view $tag --repo $repo `
  --json isDraft,isPrerelease,tagName,targetCommitish,assets | ConvertFrom-Json
$expectedAssets = @(
  "release-manifest-$candidateSha.json",
  "kernel-v2-go-no-go-$tag.md",
  "SHA256SUMS"
)
$actualAssets = @($draft.assets | ForEach-Object { $_.name } | Sort-Object)
if (-not $draft.isDraft -or -not $draft.isPrerelease) { throw "Release is not a draft prerelease" }
if ($draft.tagName -ne $tag -or $draft.targetCommitish -ne $candidateSha) {
  throw "Draft release identity is wrong"
}
if ((Compare-Object ($expectedAssets | Sort-Object) $actualAssets).Length -ne 0) {
  throw "Draft asset set is incomplete or unexpected"
}

gh release edit $tag --repo $repo --draft=false --prerelease
```

Do not attach additional RC.2 assets under this procedure. A changed asset set requires a reviewed
package-format update that checksums every additional asset before publication.

### 7. Verify the published immutable release and every asset

Download into a new empty directory, recheck the checksums, then verify the release attestation and
each asset. The effective decision remains `CONDITIONAL GO` unless every assertion and command
succeeds.

```powershell
$verifyRoot = Join-Path $env:TEMP "peas-rc2-verify-$candidateSha"
if (Test-Path -LiteralPath $verifyRoot) { throw "Verification directory already exists" }
New-Item -ItemType Directory -Path $verifyRoot | Out-Null
gh release download $tag --repo $repo --dir $verifyRoot

$published = gh release view $tag --repo $repo `
  --json isImmutable,isDraft,isPrerelease,tagName,targetCommitish | ConvertFrom-Json
if (-not $published.isImmutable -or $published.isDraft -or -not $published.isPrerelease) {
  throw "Published release is not an immutable prerelease"
}
if ($published.tagName -ne $tag -or $published.targetCommitish -ne $candidateSha) {
  throw "Published release identity is wrong"
}

gh release verify $tag --repo $repo --format json
gh release verify-asset $tag (Join-Path $verifyRoot "release-manifest-$candidateSha.json") --repo $repo
gh release verify-asset $tag (Join-Path $verifyRoot "kernel-v2-go-no-go-$tag.md") --repo $repo
gh release verify-asset $tag (Join-Path $verifyRoot "SHA256SUMS") --repo $repo

$downloadedSums = Join-Path $verifyRoot "SHA256SUMS"
foreach ($line in Get-Content -LiteralPath $downloadedSums) {
  if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw "Malformed downloaded SHA256SUMS" }
  $assetPath = Join-Path $verifyRoot $Matches[2]
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $assetPath).Hash.ToLowerInvariant()
  if ($actual -ne $Matches[1]) { throw "Downloaded checksum mismatch for $($Matches[2])" }
}

if ((git rev-parse 'refs/tags/v0.2.0-kernel-rc.1^{commit}').Trim() -ne $rc1Sha) {
  throw "RC.1 changed during the RC.2 procedure"
}
$remoteRc1After = (git ls-remote origin 'refs/tags/v0.2.0-kernel-rc.1^{}').Split("`t")[0]
if ($remoteRc1After -ne $remoteRc1Sha) { throw "Remote RC.1 changed during RC.2" }
```

Retain the two run JSON records, reconciliation output, package output, draft asset inventory,
published release JSON, verification JSON, asset-verification output, and checksum verification as
the operator audit trail.

## Immutable release evidence and attestation

Repository release immutability must be enabled before publication. Create RC.2 as a draft, attach
the completed report, reconciled manifest, and `SHA256SUMS`, independently check the digests, and
only then publish it as a prerelease. The report and manifest must not exist only as mutable PR text
or retention-limited workflow artifacts.

The finalized report cannot contain its own final digest or observed post-publication output.
Finalize the report and manifest first, generate `SHA256SUMS` from those exact bytes, then attach
all three to the draft. `SHA256SUMS` must list every other attached asset but not itself; GitHub's
release attestation covers the checksum file. Do not mutate any asset after checksumming.

| Required asset | Exact release filename | Finalized before checksum | Attached to draft |
| --- | --- | --- | --- |
| Completed go/no-go report | `<filename>` | `<yes/no>` | `<yes/no>` |
| Reconciled release manifest | `<filename>` | `<yes/no>` | `<yes/no>` |
| `SHA256SUMS` | `SHA256SUMS` | `<generated last>` | `<yes/no>` |
| Every additional asset | `<filename(s)>` | `<yes/no>` | `<yes/no>` |

- Expected prerelease tag: `v0.2.0-kernel-rc.2`
- Expected attested commit: `<candidate SHA>`
- Release immutability enabled before publication: `<yes/no plus evidence>`

Run and retain the output from:

```text
gh release view v0.2.0-kernel-rc.2 --json isImmutable,tagName,targetCommitish
gh release verify v0.2.0-kernel-rc.2 --format json
gh release verify-asset v0.2.0-kernel-rc.2 <downloaded-report-path>
gh release verify-asset v0.2.0-kernel-rc.2 <downloaded-manifest-path>
gh release verify-asset v0.2.0-kernel-rc.2 <downloaded-SHA256SUMS-path>
```

Repeat `verify-asset` for every additional attached asset. For this report, `attested` means
GitHub's automatically generated, cryptographically signed immutable-release attestation. The
release must report `isImmutable: true`; the attested tag and commit must match the candidate; the
release verification and every asset verification must succeed; and the report/manifest must match
`SHA256SUMS`. A typed approver name, PR approval, unsigned checksum, or annotated tag is not a
substitute.

The decision recorded below remains conditional until these post-publication commands succeed.
Their success satisfies the condition without editing this report or any immutable release asset;
their output is derived evidence that can be reproduced from GitHub at any time.

## Required remote evidence

| Gate | Result | Candidate SHA | Evidence link |
| --- | --- | --- | --- |
| Windows `npm run check` | `<pass/fail>` | `<SHA>` | `<URL>` |
| Linux `npm run check` | `<pass/fail>` | `<SHA>` | `<URL>` |
| Linux SQLite 10k | `<pass/fail>` | `<SHA>` | `<URL>` |
| Linux SQLite 100k | `<pass/fail>` | `<SHA>` | `<URL>` |

## Correctness evidence

- Tests: `<passed/skipped/failed>`
- Line/branch/function coverage: `<percentages>`
- Targeted boundary mutations killed: `<count/total; minimum 14/14>`
- `PRAGMA integrity_check`: `<result>`
- Event head: `<hash>`
- State head: `<hash>`
- Decision head: `<hash>`
- Captured fixture SHA-256: `<hash>`
- Golden file SHA-256: `<hash>`

### Golden-head explanation

Explain every changed event, state, or decision head by reducer, schema, manifest, canonicalization,
or fixture behavior. Never approve a golden update whose only rationale is making CI pass.

## Performance evidence

| Scale | Throughput | p50 | p95 | p99 | RSS delta | DB size | WAL size | Slope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k | | | | | | | | |
| 10k | | | | | | | | |
| 100k | | | | | | | | |

## Finding-to-regression map

| Audit finding | Resolution | Regression test | Result |
| --- | --- | --- | --- |
| Older/duplicate envelope bypassed verification | Strict envelope validation plus exact persisted predecessor/suffix-to-cursor verification before no-op | `processor-integrity.test.ts`, `sqlite-integrity.test.ts`, `stored-event-validation.test.ts` | |
| In-flight analysis used mutable cluster inputs | Frozen branch input snapshot | `reducer-contracts.test.ts` | |
| Non-live run could enable effects | Runtime/store/SQL effect matrix | `run-policy.test.ts`, `sqlite-integrity.test.ts` | |
| Analysis provenance was self-attested | Manifest-bound five-field contract and hash | `reducer-contracts.test.ts` | |
| SQL relational columns were unaudited | Relational envelope and claim reconciliation | `sqlite-integrity.test.ts` | |
| Rejected migration left side effects | One validated `IMMEDIATE` plan transaction | `sqlite-integrity.test.ts` | |
| Aggregate could grow quadratically | Hard 32-source/32-branch limits and byte-identical capacity rejection | `reducer-contracts.test.ts`, `persistence-scale.test.ts` | |
| Timer/cap/CIK/UTF-8/mirror edge cases | Deterministic lifecycle and bounded-state corrections | `reducer-contracts.test.ts`, `property.test.ts` | |
| Persistence/concurrency/crash uncertainty | Differential, process contention, and SIGKILL recovery | persistence/SQLite audit suites | |
| Direct store commit could skip event positions | Prior-cursor-bound contiguity, predecessor, logical-time, state-head, and decision-head verification in both stores | `processing-store-boundary.test.ts` | |
| Manifest versions/hashes were trusted at runtime boundary | Strict V2 schema plus store-side manifest and behavior hash recomputation | `processing-store-boundary.test.ts` and manifest tests | |
| Scheduled audit recorded release-trigger provenance | Actual trigger captured; schedule classified as regression-only | `evidence-reconciliation.test.ts` | |
| Run-scoped output paging lacked matching index | Immutable migration adds `(run_id, sequence)` and late-page interleaved-run regression | `sqlite-output-pagination.test.ts` | |
| Untrusted EventDrafts lacked resource budgets | Versioned UTF-8/depth/node/array/object/string limits before provider normalization | `event-bounds.test.ts` | |
| Evidence reconciler accepted insufficient adversarial coverage | Wrong SHA/runtime/lockfile/golden/runner/trigger, missing/duplicate gate, integrity failure, and malformed evidence cases | `evidence-reconciliation.test.ts` | |
| Hidden/accessor/unknown properties could change a commit after verification | Exact inert own-property validation rejects accessors, non-enumerable and symbol properties, `__proto__`, Proxies, unsupported array properties, and prototype-polluted schemas; strict schemas create one detached canonical commit snapshot for verification and persistence | `json-inert-boundary.test.ts`, `processing-store-boundary.test.ts` | |
| Memory accepted a malformed stored event that SQLite rejected | Shared strict stored-event validation and hash verification at the commit boundary in both adapters | `processing-store-boundary.test.ts`, `stored-event-validation.test.ts` | |
| A semantically invalid job body could become leased work | Shared category-specific output-body validation on commit, audit read, and claim; category-filtered indexed claims plus job/outbox reference guards | `sqlite-output-contracts.test.ts`, `processing-store-boundary.test.ts` | |
| Migration 003 did not validate historical rows | Atomic migration 004 preflights existing identifiers, relational transcript rules, and delivery category references before recording the upgrade | `sqlite-output-contracts.test.ts` | |
| Aggregate state reads accepted noncanonical serialized state | SQLite requires canonical `state_json` before checkpoint/hash admission | `sqlite-output-contracts.test.ts` | |
| Resource guards ran after key sorting, JSON parsing, or reducer parsing | Object-key limits precede sorting, serialized-byte limits precede `JSON.parse`, and iterative state bounds precede `parseState` | `json-inert-boundary.test.ts`, `processing-store-boundary.test.ts` | |
| Memory and SQLite disagreed on aggregate-ID ordering | Aggregate IDs are limited to 1--512 characters from `[A-Za-z0-9._:-]`, yielding portable JavaScript/SQLite `BINARY` order | `processing-store-boundary.test.ts` | |
| NUL-delimited output dedupe identities could collide | Domain-separated hash of the canonical `(runId, category, dedupeKey)` tuple | `processing-store-boundary.test.ts` | |
| RC.2 boundaries were absent from mutation evidence | Gate expanded from five legacy mutants to 14, covering inert properties, strict commit shape, memory stored events, stored-output bodies, migration preflight, canonical state, aggregate IDs, tuple dedupe, and serialized-byte preflight | `mutation-gate.mjs` with its focused regression suites | |

## Known limitations and accepted risks

- `better-sqlite3` is synchronous. Live SQLite requires a dedicated single writer with bounded
  batches, a bounded queue, and backpressure. Owner/review condition: `<owner and evidence>`.
- The sparse 100k test is a durability/throughput gate, not proof of dense clusters, analysis,
  timers, reopens, multiple research runs, or end-to-end provider capacity.
- `snapshot()` intentionally materializes the complete audit and is not the production large-run
  read API.
- Retained immutable outputs scale approximately with `events x runs`; database rotation, archive,
  retention, and restore verification are required before large research sweeps.
- `<additional limitation, owner, expiry/review condition>`

## Decision

Choose exactly one and justify it:

- `GO`
- `CONDITIONAL GO`
- `NO-GO`

Decision owner: `<name>`  
Decision date: `<ISO date>`  
Rationale: `<evidence-based rationale>`

Before publication, `GO` is invalid if any required RC.2 regression, remote gate, finalized asset,
or placeholder above is incomplete. The current disposition remains `NO-GO` until every local
regression and the 14/14 mutation gate pass in a clean candidate and all exact-SHA remote gates are
reconciled. Only then record `CONDITIONAL GO` while immutable publication remains outstanding. It
becomes effective `GO` only when `isImmutable` is true and release plus every asset verification
succeeds against the exact RC.2 SHA; no report mutation is permitted afterward.
