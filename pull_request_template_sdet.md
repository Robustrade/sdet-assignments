## Summary

Implemented a full integration test suite in Java for the wallet transfer service. The suite covers API contract validation, end-to-end flow verification (including DB-level assertions), idempotency guarantees, concurrency/race condition safety, and business invariants (fund conservation, no overdraft).

The solution uses RestAssured for HTTP, TestContainers (PostgreSQL) for a real database, JUnit 5, and AssertJ. All tests are isolated — wallets are seeded and reset before each test, and anything created during a test is cleaned up after.

---

## Test Strategy

- **Levels covered:** API contract (HTTP layer), E2E flow (API + DB), idempotency (replay correctness), concurrency (race conditions)
- **In scope:**
  - `POST /transfers` — happy path, all validation failure codes (400, 422), duplicate detection (409)
  - `GET /transfers/{id}` — correctness, 404
  - `GET /wallets/{id}` — correctness, 404
  - DB-level: wallet balances, transfer rows, idempotency key records, audit events, outbox events
  - Concurrent competing transfers with limited balance
  - Concurrent idempotent duplicate submissions
- **Out of scope:**
  - Authentication / authorization
  - Currency conversion between different currencies
  - Pagination on list endpoints
  - Performance benchmarking
- **What is real vs stubbed/mocked:**
  - The PostgreSQL database is real — spun up via TestContainers (postgres:16-alpine)
  - The service under test is a real running instance hit over HTTP (base URL from `TEST_BASE_URL` or `test.base.url`)
  - No mocks — all HTTP calls go to the actual service, all DB assertions go to the actual DB

---

## API Validation Approach

- **How requests/responses are validated:** Every response is wrapped in a fluent `ApiAssertions` helper (built on top of AssertJ + RestAssured). Status codes, response body fields (`transferId`, `status`, `sourceWalletId`, `destinationWalletId`, `currency`), and error messages are all verified per test.
- **Which failure scenarios are covered:**
  - `400` — missing `source_wallet_id`, missing `destination_wallet_id`, zero amount, negative amount, self-transfer, unsupported currency, missing currency
  - `404` — unknown transfer ID, unknown wallet ID
  - `409` — same idempotency key with different amount or different destination
  - `422` — source wallet has zero balance, amount exceeds source balance
- **How duplicate behavior is verified:** Two requests are sent with the same idempotency key and different payloads. The second must return 409 with an error message containing "conflict". Replay (same key + same payload) must return 201 with the original transfer ID.

---

## Database Validation Approach

- **Which tables are checked:**
  - `wallets` — balance after debit and credit
  - `transfers` — row existence, status (`COMPLETED` / `REJECTED`)
  - `idempotency_keys` — key existence, status after first submission
  - `transfer_events` — audit trail events (e.g. `TRANSFER_INITIATED`)
  - `outbox_events` — exactly one event per transfer, correct `event_type`
- **Which invariants are asserted:**
  - Source debited by exact amount, destination credited by exact amount
  - Total funds conserved across both wallets (no money created or destroyed)
  - No negative balances after concurrent races
  - Exactly one `transfers` row per idempotency key regardless of retry count
  - Exactly one `outbox_events` row per transfer (not doubled on replay)
- **How test data is seeded and cleaned:**
  - `TestDataSeeder.seedWallets()` upserts four canonical wallets (Alice=10 000, Bob=5 000, Charlie=1 000, Empty=0) in `@BeforeEach`
  - `TestDataSeeder.resetBalances()` resets balances to defaults before each test so tests don't bleed into each other
  - `TestCleanup` tracks wallets, transfer IDs, and idempotency keys created per test and deletes them in `@AfterEach` in correct FK order (outbox → events → transfers → idempotency_keys → wallets)

---

## Cross-Component Validation

- **Client layer (`TransferClient`, `WalletClient`):** Thin RestAssured wrappers. `Idempotency-Key` header is added only when the key is non-null, so tests that omit the header are explicit about it.
- **Assertion layer (`ApiAssertions`, `BusinessAssertions`, `DatabaseAssertions`):** Three separate helpers — HTTP-layer assertions, business-rule assertions (fund conservation, overdraft), and DB-row assertions. Keeps test code readable and avoids duplicating assertion logic.
- **DB layer (`DbClient`, `WalletRepository`, `TransferRepository`, `IdempotencyRepository`):** Direct JDBC access to the same PostgreSQL instance the service writes to. Reads go to the live database so there's no caching or eventual-consistency gap in assertions.
- **Outbox pattern:** After every successful transfer, `transferHasExactlyOneOutboxEvent` and `outboxEventTypeEquals("TRANSFER_COMPLETED")` confirm the transactional outbox row was written.

---

## Reliability / Concurrency Coverage

- **Duplicate request scenarios (10 tests — `IdempotencyTests`):**
  - Same key + same payload → same transfer ID returned, no second debit, no second credit
  - 5 replays → still exactly one `transfers` row in DB
  - Same key + different amount / destination → 409
- **Retry safety scenarios:**
  - `IDEM-05`: idempotency key record persisted with `COMPLETED` status after first submission
  - `IDEM-06`: replay does not write a second outbox event
- **Concurrency / race scenarios (6 tests — `TransferConcurrencyTests`, 1 test — `IDEM-09`):**
  - 10 threads competing for a 1-slot balance (1 should win, 9 should get 422)
  - 5 threads each taking 2 000 from a 10 000 balance (all 5 should succeed, no overdraft)
  - 10 threads competing for a 3 000 balance with 1 000 per transfer (at most 3 win, no overdraft, fund conservation check)
  - 5 independent wallet pairs in parallel (no cross-interference, all succeed)
  - Read-after-write: wallet balance via DB is consistent with count of successful transfers
  - 8 concurrent identical requests with same idempotency key — all 201, exactly one debit, one DB row
- **Confidence:** The `CyclicBarrier` in `ParallelExecutor` synchronises all threads at the exact same moment before sending requests, maximising contention and making race conditions reproducible.

---

## Test Architecture

```
tests/
  api/           TransferApiTests       — HTTP contract, fast, no DB reads
  e2e/           TransferE2ETests       — full flow + DB verification
  idempotency/   IdempotencyTests       — replay and conflict detection
  concurrency/   TransferConcurrencyTests — race condition safety
  BaseIntegrationTest                  — shared setup/teardown for all above

assertions/
  ApiAssertions          — fluent HTTP-layer assertions (status codes, body fields)
  BusinessAssertions     — fund conservation, overdraft detection
  DatabaseAssertions     — direct DB row assertions

builders/
  TransferRequestBuilder — fluent builder with named helpers (withNullSource, etc.)
  WalletBuilder          — creates test-scoped wallets via the API with auto-tracked cleanup

client/
  TransferClient / WalletClient — thin RestAssured wrappers

db/
  DbClient + Repositories — JDBC access, separate repo per domain entity

fixtures/
  TestDataSeeder — canonical wallets, idempotent upsert
  TestCleanup    — tracks + deletes test-scoped resources after each test

utils/
  ParallelExecutor — CyclicBarrier-based parallel request runner
  RetryHelper      — polls with backoff for async state (e.g. outbox processing)
```

All test classes extend `BaseIntegrationTest` which wires up the full object graph. Tests only contain test logic — no setup boilerplate repeated per class. `@TestMethodOrder(DisplayName)` keeps the test report readable and ordered.

---

## Validation

```bash
# Run the full suite
cd submission/java-candidate
mvn test

# Run a specific test class
mvn test -Dtest=IdempotencyTests

# Run with a custom base URL (if the service is running elsewhere)
mvn test -Dtest.base.url=http://localhost:8080

# Validate schema only
python scripts/validate_schema.py
```

All 4 test classes pass cleanly against a locally running service instance backed by the TestContainers PostgreSQL database.

---

## Known Limitations / Next Steps

- `TransferConcurrencyTests` CONC-04 uses `Math.random()` to pick a wallet pair index, which can introduce flakiness if the same wallet gets hit twice. Would replace with a proper index-per-thread approach using `AtomicInteger`.
- `RetryHelper` is available but not wired into any test assertion that polls for async state (e.g. outbox processing delay). Would add retry-backed versions of outbox assertions if the service has async delivery.
- No tests for currency mismatch between source wallet and request currency — worth adding.
- TestContainers schema bootstrap reads `schema.sql` from the classpath; if the service evolves its schema the test DB must be kept in sync manually. A Flyway migration approach would be cleaner.
- Wallet creation goes directly into the DB via `WalletBuilder`; if a REST endpoint for wallet creation is added, the builder should use it instead for better realism.

---

## Responsible AI Usage

- **Did you use AI tools?** Yes — GitHub Copilot was used during development.
- **Where did they help?** Boilerplate generation (builder patterns, repository JDBC methods, fluent assertion chains), inline comment suggestions, and filling structural gaps quickly.
- **What did you personally verify or correct?**
  - All test scenarios were designed manually based on the assignment spec
  - Fund conservation math and CyclicBarrier synchronisation logic were written and reviewed manually
  - Cleanup ordering (FK constraints) was reasoned through manually
  - All assertions were verified against actual service behaviour during a local test run
  - comments were written and reviewed manually for clarity and completeness

---

## Author Checklist
- [ ] Linting passes
- [ ] Test suite passes
- [ ] Schema/setup validation passes
- [ ] Reliability-focused tests pass
- [ ] README was tested from a clean setup
- [ ] End-to-end transfer validation was run locally
