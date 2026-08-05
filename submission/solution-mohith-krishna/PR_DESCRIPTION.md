## Summary

Automated test suite validating a Wallet Transfer Service across API, database, workflow, and cross-component layers. Built using TypeScript + Jest + supertest + better-sqlite3 with a minimal Express service fixture (Option 3 — Hybrid approach). 77 tests across 7 suites covering happy path, validation failures, insufficient balance, idempotency, concurrency, persistence, and cross-component behavior.

## Test Strategy

- **Levels covered**: API contract, business workflow, database persistence, cross-component (audit + outbox), reliability/concurrency
- **In scope**: Transfer lifecycle, balance conservation invariants, idempotency semantics, concurrent request safety, exactly-once side effects, absence-of-effect on failure
- **Out of scope**: Performance/load testing, UI, message broker consumption, multi-currency transfers, distributed failure modes (network partitions, mid-transaction crashes), authentication/authorization
- **What is real vs stubbed/mocked**:
  - **Real**: Express HTTP service, SQLite database (in-memory), wallet balance management, idempotency handling (payload hash), audit events, outbox events
  - **Not modeled**: Message broker/consumer, external notification service

## API Validation Approach

- **How requests/responses are validated**: Supertest wraps the Express app in-process via an `ApiClient` abstraction. Tests validate status codes, response payload shape (using `toMatchObject`), specific field values, and error messages.
- **Which failure scenarios are covered**: Missing required fields (source, destination, amount, currency), invalid currency, negative/zero amounts, same source and destination, non-existent wallets, insufficient balance, currency mismatch.
- **How duplicate behavior is verified**: Same idempotency key + same payload returns HTTP 200 with original transfer ID. Same key + different payload returns HTTP 409. No idempotency key creates independent transfers. Retry storm (5 sequential retries) settles to exactly one debit.

## Database Validation Approach

- **Which tables are checked**: `wallets`, `transfers`, `audit_events`, `outbox_events`
- **Which invariants are asserted**:
  1. Source wallet balance decreases by exactly the transfer amount on success
  2. Destination wallet balance increases by exactly the transfer amount on success
  3. Total system balance is conserved (zero-sum) across all operations
  4. No balance mutation occurs on rejected transfers
  5. Duplicate requests do not create duplicate side effects (transfers, audit, outbox)
  6. Persisted transfer state matches API-visible result
  7. Exactly one audit event per successful transfer
  8. Exactly one outbox event per successful transfer
  9. Balance never goes negative under concurrent competing transfers
  10. No orphan audit events without matching transfer records
- **How test data is seeded and cleaned**: Each test gets a fresh in-memory SQLite database via `beforeEach`. Default seed: wallet_001 (10,000 AED), wallet_002 (5,000 AED), wallet_003 (0 AED). Database is closed in `afterEach` — zero cross-test contamination.

## Cross-Component Validation

- **Audit events**: Validated for count (exactly one per success), event_type correctness, payload content (amount + currency parsed from JSON), transfer_id reference integrity, absence on failures
- **Outbox events**: Validated for count (exactly one per success), status ("pending"), payload content (transfer_id, amount, currency, source/destination wallet IDs), absence on failures and validation errors
- **Exactly-once semantics**: Idempotent replays (3x) produce no duplicate audit or outbox events
- **Cross-component consistency**: Transfer count = audit event count = outbox event count after mixed operations; timestamps consistent within 1000ms across all three tables

## Reliability / Concurrency Coverage

- **Duplicate request scenarios**: Same idempotency key + same payload (sequential and concurrent), same key + different payload, retry storm (5x sequential), 10 concurrent requests with same key
- **Retry safety scenarios**: 5 sequential retries produce exactly 1 transfer, 1 debit, consistent transfer ID across all responses
- **Concurrency/race scenarios**: 5 concurrent transfers competing for limited balance (10,000 AED / 3,000 each — at most 3 succeed), 10 concurrent duplicate idempotency key requests, concurrent transfers to same destination (no lost updates), zero-sum invariant under concurrency
- **What confidence these tests provide**: Strong confidence that the service handles duplicate and concurrent requests safely under SQLite's transaction serialization. The known limitation is that SQLite's single-writer model is less realistic than Postgres row-level locking for true production concurrency testing.

## Test Architecture

The suite is structured with clean separation of concerns:

- **`tests/helpers/apiClient.ts`** — Wraps supertest; keeps HTTP transport out of test logic (`createTransfer`, `getTransfer`, `getWallet`)
- **`tests/helpers/dbHelpers.ts`** — 11 direct-query methods for DB assertions (`getWalletBalance`, `getTransferCount`, `getAuditEvents`, `getOutboxEvents`, etc.)
- **`tests/helpers/builders.ts`** — Test data factories with defaults and overrides (`buildTransferPayload`, `buildIdempotencyKey`)
- **`tests/setup/fixtures.ts`** — Per-test context factory creating fresh app + DB + helpers in one call
- **Test suites organized by concern**: `api/`, `idempotency/`, `reliability/`, `persistence/`, `crossComponent/`

This structure is maintainable because adding a new scenario requires only writing the test — all setup, transport, and query infrastructure is reusable. Average test density is ~12 lines per test.

## Validation

Commands run to validate the solution:

```
npm run lint          # 0 errors, 0 warnings
npm test              # 77 passed, 7 suites, 0 failed
npm run test:reliability  # 7 concurrency tests passed
node scripts/validate_schema.js  # All 4 tables validated with correct columns
```

## Known Limitations / Next Steps

1. **SQLite vs Postgres**: Production would use Postgres; SQLite's single-writer model makes concurrency tests less realistic than row-level locking scenarios
2. **In-process concurrency**: Node.js event loop serialization limits true parallel execution compared to multi-process/multi-server scenarios
3. **No message broker testing**: Outbox events validated at write-side only; consumption and delivery not tested
4. **No partial failure simulation**: Service fixture does not simulate mid-transaction crashes or network failures
5. **Single currency**: All seeds use AED; cross-currency transfer validation not covered
6. **No authentication/authorization**: Service has no auth layer; access control not tested

With more time: Postgres via testcontainers, partial failure injection, multi-currency support, contract testing with schema validation against OpenAPI spec.

## Responsible AI Usage

- **Did you use AI tools?** Yes — Claude Code was used as an implementation assistant.
- **Where did they help?** Project scaffolding, service fixture implementation, test boilerplate generation, documentation drafting.
- **What did you personally verify or correct?**
  - Reviewed all test logic for correctness and meaningful assertions
  - Validated that tests cover the required invariants from the assignment
  - Fixed concurrency test approach (supertest ECONNRESET under high concurrency — switched to real HTTP server)
  - Verified all 77 tests pass, lint is clean, schema validation passes
  - Reviewed TEST_STRATEGY.md for accuracy against implementation
  - Ensured test architecture follows clean separation of concerns

## Author Checklist

- [x] Linting passes
- [x] Test suite passes (77/77)
- [x] Schema/setup validation passes
- [x] Reliability-focused tests pass (7/7)
- [x] README was tested from a clean setup
- [x] End-to-end transfer validation was run locally
