## Invariants Validated

- No double debit or credit
- Balance conservation across wallets
- Exactly-once transfer creation
- Idempotent request handling

## Idempotency Strategy

- Same key → same response
- Same key + different payload → rejected
- Retry after failure → safe

## Concurrency Strategy

- Parallel execution using ExecutorService
- Validation of race conditions on wallet balance

## Cross-Component Validation

- Outbox/event table validated for exactly-once emission