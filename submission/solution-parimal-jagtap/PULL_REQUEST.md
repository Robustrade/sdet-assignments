## Summary

End-to-end test suite for a Wallet Transfer Service, implemented using TypeScript and Playwright Test. Includes a minimal in-memory service fixture so the tests run fully locally without external dependencies.

Covers: API contract validation, database invariant verification, E2E flow, concurrency/race conditions, and component interaction (outbox + audit).

---

## Test Strategy

- **Levels covered:** API, Database, E2E (full transfer path), Concurrency, Component (outbox/audit/idempotency store)
- **In scope:** Transfer creation, idempotency, balance conservation, duplicate prevention, race conditions, audit trail, outbox events
- **Out of scope:** UI testing, performance/load testing, authentication, real queue dispatch, exhaustive error permutations
- **What is real vs stubbed/mocked:**
  - Real: Transfer API, wallet balance store, idempotency key store, audit event table, outbox table, concurrency mutex
  - Stubbed: Outbox dispatch to external queue (written but not sent)

---

## API Validation Approach

- Requests/responses validated for shape, status codes, and field correctness on every test
- Failure scenarios covered: missing fields, invalid currency, zero/negative amount, same source/destination wallet, unknown wallet IDs
- Duplicate behavior: same idempotency key + same payload returns original result (200); same key + different payload rejected (422 idempotency_conflict)

---

## Database Validation Approach

- **Tables checked:** `wallets`, `transfers`, `idempotency_keys`, `transfer_events`, `outbox_events`
- **Invariants asserted:**
  - Source balance decreases by exact transfer amount
  - Destination balance increases by exact transfer amount
  - Total balance conservation (sum of all wallets unchanged)
  - No balance mutation on rejected transfers
  - Duplicate requests do not create duplicate DB records
  - DB transfer record matches API response on every field
- **Test data:** DB reset via `/test/reset` before each test — no stale data, no shared state

---

## Cross-Component Validation

- **Outbox events:** Written once per successful transfer, never duplicated on retry. Verified via `/test/db/outbox/:transfer_id`
- **Audit/transfer_events:** Written with correct event type and full transfer payload after every success
- **Idempotency store:** Verified that key is stored with correct transfer_id linkage after first request

---

## Reliability / Concurrency Coverage

- **Duplicate request scenarios:** 5 concurrent identical requests with same idempotency key → only 1 transfer created, 1 debit
- **Retry safety scenarios:** 3 sequential retries simulating response loss → same result, no double-debit
- **Concurrency/race scenarios:** 10 concurrent transfers competing for limited balance → no overdraft, total debits match successful transfers only
- **Confidence:** Tests use `Promise.all()` for true simultaneous firing. Wallet-pair mutex in service prevents race conditions at the balance update layer

---

## Test Architecture

```
tests/api/           — API contract and validation
tests/database/      — DB invariant verification
tests/e2e/           — Full path API → DB → audit → outbox
tests/concurrency/   — Race conditions and retry safety
tests/component/     — Outbox, audit, and idempotency store
helpers/             — API client, DB query helpers, test data factory
fixtures/            — Playwright fixtures with auto DB reset per test
config/              — Global setup/teardown (service lifecycle)
service/             — Minimal in-memory wallet transfer service
```

Maintainability rationale:
- Each test resets DB state — no ordering dependencies
- DB assertions are a first-class concern, not optional
- Test data factory generates isolated data per test
- Service can be replaced with a real service by changing `BASE_URL` env variable

---

## Validation

```bash
npm install
npx playwright install
npm test
```

All 5 test suites pass locally against the in-memory service fixture.

---

## Known Limitations / Next Steps

- Outbox events are written but not dispatched (no real queue in scope)
- Transfer status is always COMPLETED — no async processing or PENDING state simulated
- In-memory DB resets on service restart (by design for test isolation)
- With more time: add contract testing via OpenAPI schema validation, add property-based testing for balance invariants

---

## Responsible AI Usage

- AI tools (Claude) were used to accelerate code generation for boilerplate: API client wrapper, test data factory, fixture setup
- I personally reviewed and validated: all test assertions and invariants, the concurrency mutex logic in the service, the idempotency conflict detection, and the DB assertion strategy
- The test strategy, invariant selection, and concurrency approach reflect my own engineering judgment — not generated content
- All generated code was read, understood, and verified against the assignment spec before submission

---

## Author Checklist

- [x] Linting passes
- [x] Test suite passes
- [x] Schema/setup validation passes
- [x] Reliability-focused tests pass
- [x] README was tested from a clean setup
- [x] End-to-end transfer validation was run locally
