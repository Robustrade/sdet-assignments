# Wallet Transfer Service — SDET Assignment

**Candidate**: Pratik Kakan
**Stack**: Playwright Test · TypeScript · Express.js · SQLite (better-sqlite3)
**Submission folder**: `submission/solution-pratikkakan/`

---

## How to Run

```bash
cd submission/solution-pratikkakan
npm ci
npm run lint                   # ESLint (TypeScript)
npm test                       # All tests + HTML report
npm run test:reliability       # @reliability-tagged tests only (idempotency + concurrency)
node scripts/validate_schema.js  # CI schema check
```

No Docker. No Postgres. No `.env` file. No external service to start. The entire suite is self-contained.

---

## What Was Built — Hybrid Approach

This is a **hybrid** solution (Assignment Option 3): a minimal but real service was built and the tests validate it end-to-end.

- The HTTP server is a real Express app — real TCP socket, real HTTP requests
- The database is a real SQLite file — real transactions, real schema, real rows
- Nothing is mocked at the service layer; every test assertion that queries the DB is reading what the API actually wrote

The test suite validates that backend at **five distinct layers**:

| Layer | File |
|---|---|
| API contract & validation | `src/tests/api/transfer.api.spec.ts`, `src/tests/api/validation.spec.ts` |
| End-to-end vertical slices | `src/tests/e2e/e2e.spec.ts` |
| Database / persistence | `src/tests/persistence/database.spec.ts` |
| Idempotency workflow | `src/tests/workflow/idempotency.spec.ts` |
| Concurrency / race conditions | `src/tests/workflow/concurrency.spec.ts` |

---

## How the Backend and Database Start

### Everything runs in the same Node.js process — no external service needed

The server boots as part of Playwright's lifecycle via `globalSetup` / `globalTeardown`, defined in `playwright.config.ts`:

```typescript
globalSetup: "./global-setup.ts",
globalTeardown: "./global-teardown.ts",
```

When `npm test` runs, the sequence is:

```
npm test
  └─ Playwright reads playwright.config.ts
       └─ global-setup.ts runs first (before any test)
            ├─ Creates a fresh SQLite file → /tmp/wallet-test-<timestamp>.db
            ├─ Runs full schema (wallets, transfers, idempotency_keys,
            │                    transfer_events, outbox_events)
            ├─ Starts Express server on port 0 (OS assigns a free port)
            ├─ Writes { baseURL, dbPath } to .test-env.json
            └─ Resolves → test suite begins
       └─ global-teardown.ts runs last (after all tests)
            ├─ Closes the HTTP server
            ├─ Deletes the SQLite file from /tmp
            └─ Deletes .test-env.json
```

### Why port 0?

`app.listen(0, ...)` tells the OS to assign any free port. This guarantees:
- No port conflicts on CI runners or developer machines
- No hardcoded port anywhere in the codebase
- Multiple test runs can exist in parallel without clashing

The actual port is captured immediately after `listen` fires and written to `.test-env.json`.

---

## How the baseURL Reaches Each Test

The flow: `global-setup writes .test-env.json` → `fixture reads it` → `ApiClient uses it`

### Step 1 — global-setup writes the live URL

```json
{ "baseURL": "http://127.0.0.1:54321", "dbPath": "/tmp/wallet-test-1716537600000.db" }
```

### Step 2 — the custom fixture reads it (`src/fixtures/index.ts`)

```typescript
export const test = base.extend<CustomFixtures>({
  apiClient: async ({}, use) => {
    const { baseURL } = loadTestEnv();           // reads .test-env.json
    const ctx = await request.newContext({ baseURL });
    await use(new ApiClient(ctx));
    await ctx.dispose();                         // cleaned up after each test
  },
  db: async ({}, use) => {
    const { dbPath } = loadTestEnv();
    const helpers = new DbHelpers(dbPath);
    await use(helpers);
    helpers.close();                             // connection closed after each test
  },
});
```

### Step 3 — every test imports the extended `test`

```typescript
import { test, expect } from '../../fixtures';
// apiClient and db are injected automatically — no URL or path ever in test bodies
```

No test ever hardcodes a URL, a port, or a file path. The fixture layer owns all of that.

---

## Architecture Overview

```
src/
├── service/               Express app + SQLite schema + route handlers
│   ├── db.ts              Schema SQL, domain types, DB factory (createDatabase)
│   ├── server.ts          App factory — createApp(db) wires routes to the DB
│   └── routes/
│       ├── transfers.ts   POST /transfers, GET /transfers/:id
│       └── wallets.ts     GET /wallets/:id
│
├── helpers/
│   ├── api-client.ts      Typed Playwright APIRequestContext wrapper (ApiClient)
│   ├── db-helpers.ts      Direct SQLite reads + per-test wallet seeding (DbHelpers)
│   └── builders.ts        buildTransferRequest() + generateIdempotencyKey()
│
├── fixtures/
│   └── index.ts           Custom `test` that injects apiClient + db per test
│
└── tests/
    ├── api/               HTTP contract + validation tests
    ├── workflow/          Idempotency + concurrency tests (@reliability)
    ├── persistence/       DB invariant verification
    └── e2e/               Full vertical-slice tests
```

### Layers and their responsibilities

**ApiClient** (`helpers/api-client.ts`) — all HTTP calls live here. Tests never call `ctx.post()` or `ctx.get()` directly. This keeps transport concerns out of test logic and makes the call sites read like business operations.

**DbHelpers** (`helpers/db-helpers.ts`) — all SQL queries live here. Tests never write raw SQL. Provides `seedWallet`, `seedTestWallets`, `getWallet`, `getTransfer`, `getTransferEvents`, `getOutboxEvents`, `getIdempotencyRecord`, and balance/count helpers.

**builders.ts** — `buildTransferRequest()` returns a valid payload with sensible defaults, letting tests override only the fields they care about. `generateIdempotencyKey()` returns a UUID.

---

## Service Implementation

### POST /transfers — transfer lifecycle

The handler executes these steps, with a SQLite transaction wrapping the mutation phase:

1. **Idempotency key must be present** — 400 `MISSING_IDEMPOTENCY_KEY` if header absent
2. **Body validation** — missing fields, invalid amount (must be a positive integer), unsupported currency, self-transfer
3. **Idempotency cache check** — if the key has been seen before:
   - Same SHA-256 payload hash → return 200 with the cached response body (replay)
   - Different payload hash → return 409 `IDEMPOTENCY_CONFLICT`
4. **Atomic transaction**:
   - Verify source wallet exists (422 if not)
   - Verify destination wallet exists (422 if not)
   - Verify source balance ≥ amount (422 `INSUFFICIENT_BALANCE` if not)
   - `UPDATE wallets SET balance = balance - amount` (source debit)
   - `UPDATE wallets SET balance = balance + amount` (destination credit)
   - `INSERT INTO transfers` (status = COMPLETED)
   - `INSERT INTO transfer_events` × 2 (TRANSFER_INITIATED, TRANSFER_COMPLETED)
   - `INSERT INTO outbox_events` (published=0)
   - `INSERT INTO idempotency_keys` with SHA-256 of request body + cached response
   - Return 201 with transfer body

If anything inside the transaction fails, SQLite rolls back all writes atomically — no partial state ever lands in the database.

### Database schema

| Table | Purpose |
|---|---|
| `wallets` | Wallet accounts — balance stored in minor units (integer) |
| `transfers` | One row per completed transfer |
| `idempotency_keys` | SHA-256 request hash + cached response body per key |
| `transfer_events` | TRANSFER_INITIATED + TRANSFER_COMPLETED audit rows |
| `outbox_events` | Exactly-once publish stub — `published=0` means pending |

SQLite is configured with `PRAGMA journal_mode = WAL` (concurrent readers don't block writers) and `PRAGMA foreign_keys = ON`.

---

## What Is Real vs Stubbed

| Component | Status | Details |
|---|---|---|
| HTTP server (Express) | **Real** | Full Node.js HTTP server, real TCP port |
| SQLite database | **Real** | Physical file in `/tmp`, WAL mode, real transactions |
| Transfer routes | **Real** | All validation, balance checks, atomic writes |
| Wallet routes | **Real** | GET returns live DB rows |
| Idempotency store | **Real** | SHA-256 hash + cached response body persisted in DB |
| Transfer events (audit log) | **Real** | Written in the same transaction as the transfer |
| Outbox events | **Real table, stubbed publisher** | Row written (`published=0`); actual message dispatch is stubbed — tests verify the row exists and is unpublished, proving exactly-once write semantics |
| Message queue | Out of scope | Documented as known limitation |

---

## Test Strategy — Coverage Map

### A) Happy Path Transfer

- Returns 201 COMPLETED with correct payload shape
- Debits source wallet by exact transfer amount
- Credits destination wallet by exact transfer amount
- Persists a COMPLETED transfer record with all required fields
- GET /transfers/:id returns the persisted transfer (read-after-write)
- GET /wallets/:id reflects updated balances via the API surface
- GET /transfers/:id → 404 for unknown id
- GET /wallets/:id → 404 for unknown wallet
- Net balance across wallets is conserved after transfer

### B) Validation Failures

Every validation test asserts **two things**: the correct error response AND zero DB mutations.

- Missing source_wallet_id, destination_wallet_id, amount, or currency → 400 VALIDATION_ERROR
- amount = 0, amount < 0, float amount → 400 VALIDATION_ERROR
- Unsupported currency → 400 VALIDATION_ERROR
- Same source and destination wallet → 400 VALIDATION_ERROR
- Missing Idempotency-Key header → 400 MISSING_IDEMPOTENCY_KEY
- Multiple concurrent validation failures leave wallets completely untouched

### C) Insufficient Balance

- Returns 422 INSUFFICIENT_BALANCE
- Source balance unchanged after rejection
- Destination balance unchanged after rejection
- No transfer row created
- Exact-balance transfer succeeds (boundary condition — balance is not > amount, it is = amount)

### D) Idempotency / Duplicate Submission

- First request with new key → 201, idempotency record written
- Same key + same payload → 200 with original response body (replay)
- Duplicate does not create a second transfer row
- Duplicate does not double-debit source wallet
- Duplicate does not double-credit destination wallet
- idempotency_keys row references the correct transfer_id
- Same key + different payload → 409 IDEMPOTENCY_CONFLICT
- Conflict response does not mutate the original transfer or balances
- Multiple unique keys create independent transfer rows

### E) Concurrency / Race Conditions

- Two concurrent transfers within available balance → both succeed (201)
- Two concurrent transfers exceeding total balance → exactly one succeeds, one 422 (no double-spend)
- Concurrent same-key requests → only one transfer row regardless of race outcome
- 10 concurrent transfers → final balance = initial − (successes × amount), conserved exactly
- Two sources to same destination concurrently → both debits applied, no balance corruption

### F) Persistence / Database

- TRANSFER_INITIATED and TRANSFER_COMPLETED events written for every successful transfer
- Each event carries a valid payload and references the correct transfer_id
- Exactly one unpublished outbox_events row per transfer
- DB transfer status matches API response status (no disconnect)
- DB balance delta equals transfer amount — no phantom money
- idempotency_keys row present with correct transfer_id and response_status
- Insufficient balance: no transfer_events or outbox_events rows
- Duplicate replay: outbox row count stays at 1 (no re-publish triggered)

### G) End-to-End Vertical Slices

Three full scenarios touching all layers in sequence:

1. **Happy path** — POST → GET transfer → GET wallets (API) → DB transfer record → DB events → DB outbox → DB idempotency record (7 assertions, one test)
2. **Rejection path** — insufficient balance leaves all five tables clean
3. **Client retry simulation** — two requests with same key; only one transfer row, only one outbox row, balance debited exactly once

---

## Invariants Verified

| Invariant | Where tested |
|---|---|
| Source wallet debited exactly once on success | `transfer.api.spec.ts`, `database.spec.ts` |
| Destination wallet credited exactly once on success | `transfer.api.spec.ts`, `database.spec.ts` |
| Net balance conserved across all wallets | `transfer.api.spec.ts`, `concurrency.spec.ts` |
| No balance mutation on rejected or invalid transfers | `transfer.api.spec.ts`, `validation.spec.ts` |
| Duplicate key does not create second transfer row | `idempotency.spec.ts`, `concurrency.spec.ts` |
| Duplicate key does not double-debit or double-credit | `idempotency.spec.ts` |
| Persisted transfer status matches API response status | `database.spec.ts`, `e2e.spec.ts` |
| Audit events written for every COMPLETED transfer | `database.spec.ts` |
| Outbox event created exactly once, not on replay | `database.spec.ts`, `e2e.spec.ts` |
| No transfer row on validation failure | `validation.spec.ts` |
| Conflict response leaves original transfer unchanged | `idempotency.spec.ts` |

---

## Test Isolation

Every test calls `db.seedTestWallets(sourceBalance, destBalance)` which creates two wallets with UUID-based IDs. No two tests share wallet rows — a failure in one test cannot cause a false failure in another. No `beforeEach` cleanup is needed.

`workers: 1` in `playwright.config.ts` — SQLite write-lock is per-process. Concurrency testing is done _within_ individual tests using `Promise.all()`, not by running test files in parallel.

---

## Known Limitations

| Limitation | Reasoning |
|---|---|
| SQLite, not Postgres | Production would use Postgres with `SELECT FOR UPDATE` for true row-level locking. SQLite serialises all writes at the DB level — correct, but not identical to Postgres concurrency semantics. |
| Concurrency is rapid-succession, not true OS-level parallelism | Node.js single-threaded + better-sqlite3 synchronous writes. Still reliably catches double-debit bugs in non-transactional implementations. |
| Outbox publisher is stubbed | The outbox row is real; a real publisher would flip `published = 1`. Proving the broker receives the event would require a real or embedded broker (Kafka, Redis Streams) — out of scope. |
| No auth/authz on endpoints | Not part of the assignment domain. |
| No network partition simulation | In-process failure simulation only. |
