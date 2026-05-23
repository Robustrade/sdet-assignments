# Wallet Transfer Service — SDET Assignment

**Candidate**: Pratik Kakan  
**Stack**: Playwright Test · TypeScript · Express.js · SQLite (better-sqlite3)  
**Submission folder**: `submission/solution-pratikkakan/`

---

## How to Run

```bash
cd submission/solution-pratikkakan
npm ci
npm run lint          # ESLint (TypeScript)
npm test              # All tests (Playwright)
npm run test:reliability   # @reliability-tagged tests only
node scripts/validate_schema.js  # CI schema check
```

No Docker, no Postgres, no `.env` file required. The test suite is fully self-contained.

---

## Architecture Overview

```
src/
├── service/               Express app + SQLite schema + route handlers
│   ├── db.ts              Schema SQL, types, DB factory
│   ├── server.ts          App factory (dependency-injected DB)
│   └── routes/
│       ├── transfers.ts   POST /transfers, GET /transfers/:id
│       └── wallets.ts     GET /wallets/:id
│
├── helpers/
│   ├── api-client.ts      Typed Playwright APIRequestContext wrapper
│   ├── db-helpers.ts      Direct SQLite reads + per-test wallet seeding
│   └── builders.ts        Immutable request factories + idempotency key gen
│
├── fixtures/
│   └── index.ts           Custom `test` that injects apiClient + db fixtures
│
└── tests/
    ├── api/               HTTP contract + validation tests
    ├── workflow/          Idempotency + concurrency tests  (@reliability)
    ├── persistence/       DB invariant verification
    └── e2e/               Full vertical-slice tests
```

---

## Test Strategy

### What is real vs stubbed

| Component | Status | Notes |
|---|---|---|
| HTTP server (Express) | Real | Starts on a random port per test run |
| Wallet balances | Real | SQLite `wallets` table |
| Transfer records | Real | SQLite `transfers` table |
| Idempotency store | Real | SQLite `idempotency_keys` table |
| Audit trail | Real | SQLite `transfer_events` table |
| Outbox events | Real table | `published=0` — publisher is stubbed |
| Message queue | Out of scope | Documented as known limitation |

### Test isolation

Every test seeds its own wallet pair using UUID-based IDs via `db.seedTestWallets()`.  
No shared state between tests — no `beforeEach` teardown needed.

### Concurrency tests

`Promise.all()` fires requests simultaneously. With Node.js (single-threaded) and `better-sqlite3` (synchronous), transactions execute serially inside the SQLite write-lock. This reliably catches double-debit bugs in non-transactional implementations without requiring a distributed test harness.

---

## Invariants Verified

| Invariant | Where tested |
|---|---|
| Source wallet debited exactly once on success | transfer.api.spec.ts |
| Destination wallet credited exactly once on success | transfer.api.spec.ts |
| Net balance conserved across all wallets | transfer.api.spec.ts, concurrency.spec.ts |
| No balance mutation on rejected transfers | transfer.api.spec.ts, validation.spec.ts |
| Duplicate key does not create second transfer row | idempotency.spec.ts |
| Duplicate key does not double-debit or double-credit | idempotency.spec.ts |
| Persisted transfer status matches API response | database.spec.ts |
| Audit events created for every COMPLETED transfer | database.spec.ts |
| Outbox event created exactly once (not on replay) | database.spec.ts, e2e.spec.ts |

---

## Known Limitations

1. **SQLite vs Postgres**: Production would use Postgres with `SELECT FOR UPDATE` row-level locking. SQLite serialises all writes at the DB level, which is correct but not identical to Postgres concurrency semantics.
2. **No real message queue**: The outbox table is populated but no publisher process runs. This is documented as out of scope.
3. **No network partition tests**: In-process failure simulation only.
4. **Concurrency via Promise.all()**: Adequate for catching double-debit bugs; not a true OS-level concurrent write simulation.
