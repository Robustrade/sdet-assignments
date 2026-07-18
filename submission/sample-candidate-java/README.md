# Wallet Transfer Service — SDET Automation Suite

## Summary
Implemented an automated test solution for the Wallet Transfer Service using Java, Cucumber (BDD), and Rest-Assured. The framework validates API endpoints, exact-once database persistence, and system behavior under concurrency and duplicates.

## Test Strategy
- **Levels covered:** API boundary, Business workflow, Database persistence, and Cross-component (outbox) validation.
- **In scope:** Happy path transfers, validation failures, idempotency guarantees, race conditions, and balance invariants.
- **Out of scope:** Full UI/Frontend checks, exhaustive load testing.
- **What is real vs stubbed/mocked:** The API calls simulate HTTP requests. The database asserts rely on direct DB connections reading actual `wallets`, `transfers`, and `outbox_events` tables. 

## API Validation Approach
- **How requests/responses are validated:** Handled via a robust `TransferApiClient` encapsulating Rest-Assured. Assertions validate status codes and JSON payload states (e.g., `"status": "SUCCESS"`).
- **Which failure scenarios are covered:** Negative amounts, missing fields, zero amounts, and identical source/destination wallets.
- **How duplicate behavior is verified:** Sending an exact identical request payload + `Idempotency-Key` header and validating that a 200 OK is returned, but the DB states remain unaffected by the second call.

## Database Validation Approach
- **Which tables are checked:** `wallets`, `transfers`, `outbox_events`.
- **Which invariants are asserted:** Source wallet decrements *exactly* by the payload amount, destination wallet increments *exactly* by the amount, and total balance movement is correct.
- **How test data is seeded and cleaned:** Uses `DatabaseHelper.java` to invoke TRUNCATE/DELETE statements before scenarios (`@Given the database is clean`) to prevent stale data false positives.

## Cross-Component Validation
Verified the existence of an emitted `outbox_events` record immediately following a successful transfer, confirming downstream systems will be safely triggered.

## Reliability / Concurrency Coverage
- **Duplicate request scenarios:** Verified using the same idempotency key.
- **Concurrency/race scenarios:** Validated using Java's `ExecutorService` triggering 5 simultaneous requests attempting to exceed balance limitations. Verified the system safely rejects requests that would push balances below 0.
- **What confidence these tests provide:** Confidence that the system does not double-debit under heavy load or duplicate network retries.

## Test Architecture
The test suite utilizes the Red, Blue, Green workflow and is split strictly into:
1. `TransferApiClient` (API transport)
2. `DatabaseHelper` (Persistence validation)
3. `WalletTransferSteps` (Business rules mapping)
4. `.feature` files (Human-readable BDD scenarios)

## Author Checklist
- [x] Linting passes locally
- [x] Test suite passes locally
- [x] Schema/setup validation passes
- [x] Reliability-focused tests pass
- [x] README/setup steps were tested from a clean state
- [x] End-to-end transfer validation was run locally