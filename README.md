## System Guarantees Validated

This test suite validates critical financial system invariants:

- Money conservation across wallets
- No double debit or credit
- Exactly-once transfer creation under retries
- Idempotent behavior under duplicate requests

## Idempotency Strategy

- Same key + same payload → same response
- Same key + different payload → rejected
- Retry after failure → safe (no duplicate effects)

## Concurrency Strategy

- Parallel requests using ExecutorService
- Validation ensures no over-debit or inconsistent state

## Cross-Component Validation

- Audit/event table validated for transfer creation
- Ensures side effects occur exactly once