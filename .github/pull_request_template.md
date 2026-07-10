## Summary

Describe the behavior and why it belongs in the deterministic core or an adapter.

## Audit checklist

- [ ] `npm run check` passes.
- [ ] New external results are captured as events.
- [ ] Reducer code performs no I/O, wall-clock reads, or random generation.
- [ ] Schema, reducer, and migration versions are explicit.
- [ ] Golden hash changes are explained.
- [ ] Restart, retry, and rollback behavior is tested where relevant.
