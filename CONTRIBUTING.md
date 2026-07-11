# Contributing

Every change must preserve auditability and deterministic replay.

Before committing:

```powershell
npm.cmd run check
git diff --check
```

When changing an envelope, reducer rule, canonicalization rule, or persisted intent:

1. Version the affected schema or reducer.
2. Add a new fixture instead of rewriting historical captured inputs without explanation.
3. Review golden hash changes as behavioral changes, not snapshot churn.
4. Include migration and restart/rollback coverage for storage changes.
5. Keep nondeterministic operations in adapters and capture their results as events.

Never regenerate golden hashes merely to make a failing test pass. First explain which semantic
decision changed and why the new transcript is correct.
