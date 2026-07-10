## Summary

Describe the behavior and why it belongs in the deterministic core or an adapter.

## Audit checklist

- [ ] `npm run check` passes.
- [ ] New external results are captured as events.
- [ ] Reducer code performs no I/O, wall-clock reads, or random generation.
- [ ] Schema, reducer, and migration versions are explicit.
- [ ] Golden hash changes are explained.
- [ ] Restart, retry, and rollback behavior is tested where relevant.
- [ ] Point-in-time job inputs and analysis-contract identities are immutable.
- [ ] Replay, shadow, research, and paper runs create zero dispatchable work.
- [ ] Duplicated SQL columns are reconciled with their immutable canonical source.
- [ ] Windows and Linux CI pass; scale/nightly evidence is linked when applicable.
- [ ] Every linked result names this exact commit SHA; release candidates include a passing
      four-gate release manifest.
