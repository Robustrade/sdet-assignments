# Understanding & Approach

## What is this service?

A simple backend that transfers money between wallets. It has 3 API endpoints:

- `POST /transfers` — send money from one wallet to another
- `GET /transfers/{id}` — check a transfer's details
- `GET /wallets/{id}` — check a wallet's balance

## What problems can go wrong?

- Someone sends the same payment request twice (duplicate) → should not charge twice
- Two people try to withdraw from the same wallet at the same time → balance should never go negative
- A transfer fails halfway → no partial records should be left in the database
- The API says "success" but the database doesn't actually save it → data must be consistent

## What I'm testing

| What | How |
|---|---|
| API works correctly | Check status codes and response body |
| Database is updated correctly | Query the DB directly after each API call |
| Bad input is rejected cleanly | Send invalid data, check 422 + zero DB changes |
| Duplicates are handled safely | Send same request twice, check only 1 transfer exists |
| Concurrency doesn't break things | Use threads to simulate multiple users at once |
| Audit trail is correct | Check that audit_events and outbox_events tables have the right rows |

## What is real vs fake

- **Real:** The Flask app, SQLite database, all 4 tables (wallets, transfers, audit_events, outbox_events)
- **Simulated:** The outbox table pretends to be a message queue — we just check the row is there
- **Not included:** Real message queue, Docker, external services

## How tests are organized

```
tests/
├── conftest.py          ← Creates fresh database before each test
├── helpers/
│   ├── api_client.py    ← Helper to make API calls without repeating code
│   ├── db_helpers.py    ← Helper to query database for assertions
│   └── builders.py      ← Helper to create test data quickly
├── test_happy_path.py   ← Transfer works correctly
├── test_validation.py   ← Bad input is rejected
├── test_insufficient_balance.py ← Not enough money
├── test_idempotency.py  ← Duplicate handling
├── test_concurrency.py  ← Race conditions
├── test_persistence.py  ← API matches database
└── test_cross_component.py ← Audit + outbox checks
```

## How idempotency testing works

| Scenario | What should happen |
|---|---|
| Same key + same data (retry) | Return original result, don't charge again |
| Same key + different data | Return 409 error, don't process |
| No key at all | Each request is treated as new |
| 10 threads with same key | Only 1 transfer created |

## How concurrency testing works

| Scenario | What should happen |
|---|---|
| 5 threads transfer 3000 from wallet with 10000 | Max 3 succeed, balance stays ≥ 0 |
| 10 threads with same idempotency key | Only 1 transfer, 1 debit |
| Multiple transfers at once | Total money in system stays the same |

## Limitations

- SQLite doesn't have real row-level locking like PostgreSQL — so concurrency tests use a Python lock instead
- No real message queue — we just check the outbox table has the right rows
- No network failure simulation — we can't test "what if the connection drops mid-transfer"
- Tests run in one process — in production you'd want multi-process testing

## Tradeoffs I made

- **Focused on important scenarios** rather than testing every possible edge case
- **Used real components** instead of mocks — slower but more trustworthy
- **In-memory database** for speed — each test gets a fresh DB in milliseconds
- **Added outbox table** to the service to demonstrate cross-component testing
