## Summary

Built an automated test suite for the Wallet Transfer Service using Python + pytest. The tests check if transfers work correctly at multiple levels — API responses, database state, and side effects like audit logs.

Total: **63 tests**, all passing.

## Test Strategy

- **Levels covered:** API, Database, Business logic, Audit/Outbox events
- **In scope:** Successful transfers, bad input handling, insufficient balance, duplicate request handling (idempotency), race conditions (concurrency), and data consistency checks
- **Out of scope:** Performance testing, UI, real message queues, Docker setup
- **What is real vs stubbed:**
  - Real: Flask app, SQLite database (in-memory), all tables
  - Simulated: The outbox table represents what would normally go to a message queue — we just check the row exists
  - No mocking — everything is a real implementation running in-process

## API Validation Approach

- **How validated:** Check status codes (201, 200, 409, 422, 404) and response body fields (status, amount, id, error messages)
- **Failure scenarios covered:**
  - Missing fields (source wallet, destination, amount, currency)
  - Invalid currency, negative amount, zero amount
  - Same source and destination wallet
  - Non-existent wallets, currency mismatch
  - Insufficient balance
- **Duplicate behavior:**
  - Same idempotency key + same data → returns original result (200)
  - Same key + different data → rejected (409)
  - No key → each request creates a new transfer

## Database Validation Approach

- **Tables checked:** `wallets`, `transfers`, `audit_events`, `outbox_events`
- **What we assert:**
  - Source wallet balance goes down by exact amount
  - Destination wallet balance goes up by exact amount
  - Total money in system stays the same (no money created or lost)
  - Balance never goes below zero
  - Failed requests create zero records in any table
  - Duplicate requests create only 1 transfer row
  - What API returns matches what's actually in the database
- **How test data works:**
  - Each test gets a brand new in-memory database
  - 4 wallets are pre-loaded with known balances
  - After the test, database is automatically destroyed — no cleanup needed

## Cross-Component Validation

- **audit_events:** Check that exactly 1 audit row is created per successful transfer, none for failures, and the data inside is correct
- **outbox_events:** Same thing — exactly 1 outbox row per success, none for failures, not duplicated by retries
- **Exactly-once check:** 10 threads hit the same endpoint with same idempotency key — only 1 audit + 1 outbox row exists after

## Reliability / Concurrency Coverage

- **Duplicate requests:**
  - Send same request 5 times → only 1 transfer created, balance deducted once
  - Same key with different amount → rejected with 409
  - 10 threads with same key simultaneously → only 1 transfer created
- **Race conditions:**
  - 5 threads try to transfer 3000 each from a wallet with 10000 → max 3 succeed, balance never negative
  - Multiple threads transferring different amounts → total money in system stays constant
- **What this catches:**
  - Double-charging bugs
  - Negative balance bugs
  - Duplicate records from retries

## Test Architecture

```
tests/
├── conftest.py              ← Setup: creates fresh app + database for each test
├── helpers/
│   ├── api_client.py        ← Makes API calls (so tests don't repeat HTTP code)
│   ├── db_helpers.py        ← Queries database directly for assertions
│   └── builders.py          ← Creates test data (payloads, keys)
├── test_happy_path.py       ← Successful transfer tests (11 tests)
├── test_validation.py       ← Bad input tests (15 tests)
├── test_insufficient_balance.py ← Not enough money tests (9 tests)
├── test_idempotency.py      ← Duplicate request tests (8 tests)
├── test_concurrency.py      ← Race condition tests (4 tests)
├── test_persistence.py      ← API vs DB consistency tests (8 tests)
└── test_cross_component.py  ← Audit + outbox tests (8 tests)
```

**Why this structure works:**
- Each test is independent — runs fine alone or with others
- Helper functions avoid copy-pasting the same code everywhere
- Test names tell you what they're checking without reading the code
- Adding a new test is easy — just write a new function

## Validation

```bash
# Run all tests
python3 -m pytest -v

# Run only concurrency/reliability tests
python3 -m pytest -v -m reliability

# Check database schema is correct
python3 scripts/validate_schema.py
```

## Known Limitations / What I'd Do With More Time

- **Use a real database like PostgreSQL** instead of SQLite — SQLite doesn't have proper row-level locking, so concurrency tests aren't fully realistic
- **Add API response schema validation** — check that the JSON structure matches a defined contract
- **Test with a real HTTP server** running instead of Flask's test client — would catch network-related bugs
- **Add more edge cases** — like what happens if the service crashes mid-transfer
- **Set up Docker** so anyone can run the tests with one command regardless of their machine setup

## Responsible AI Usage

- **Did you use AI tools?** Yes — GitHub Copilot helped with writing code and docs.
- **Where did they help?** Setting up the project structure, writing helper functions, and drafting documentation.
- **What did I personally do?**
  - Decided the test strategy and what scenarios matter most
  - Ran all tests locally and verified they pass
  - Checked that the concurrency tests actually prove what they claim
  - Made sure the service fixture works correctly with the outbox extension
  - Verified the whole thing runs from a clean setup

## Author Checklist

- [x] Linting passes
- [x] Test suite passes (63/63)
- [x] Schema/setup validation passes
- [x] Reliability-focused tests pass (6/6)
- [x] README was tested from a clean setup
- [x] End-to-end transfer validation was run locally
