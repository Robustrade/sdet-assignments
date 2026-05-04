## System Invariants Validated

- Total money is conserved across wallets
- No double debit or double credit occurs
- Exactly-once transfer creation is ensured
- Duplicate requests do not create duplicate side effects

## Idempotency Strategy

- Same key + same payload → same response
- Same key + different payload → rejected
- Retry after failure → safe (no duplicate transfer)

## Concurrency Strategy

- Parallel execution using ExecutorService
- Validation ensures no over-debit or inconsistent state

## Cross-Component Validation

- Audit/event table validated
- Ensures exactly-once event emission