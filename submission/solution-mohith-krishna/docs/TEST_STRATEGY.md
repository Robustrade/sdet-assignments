# Test Strategy — Wallet Transfer Service

## System Under Test Assumptions

The system is a **Wallet Transfer Service** that moves money between wallets via a REST API. It is expected to handle:

- Successful transfers between wallets with sufficient balance
- Input validation (missing fields, invalid currency, negative/zero amounts, same source/destination)
- Insufficient balance rejection without side effects
- Idempotent request handling via `Idempotency-Key` header
- Concurrent request safety
- Durable persistence of transfer records, audit events, and outbox events

### Approach: Option 3 — Hybrid

A **minimal Express + better-sqlite3 service fixture** is built in-process to serve as the system under test. This gives us:

- Full control over database state for seeding and assertion
- In-process testing via supertest (no network overhead for non-concurrent tests)
- Real HTTP server for concurrency tests (via Node.js `http.createServer`)
- No external dependencies (no Docker, no Postgres)

## Scope of Automation

### In Scope

| Layer | What is validated |
|---|---|
| API | Request/response correctness, status codes, payload shape, error messages |
| Business Workflow | Transfer lifecycle, balance conservation, idempotency semantics |
| Database | Wallet balances, transfer records, idempotency keys, audit events, outbox events |
| Cross-Component | Audit event count/content, outbox event count/content, exactly-once semantics |
| Reliability | Concurrent competing transfers, concurrent duplicate idempotency keys, retry storms |

### Out of Scope

- Performance/load testing
- UI testing
- Message queue consumption (outbox events are written but not consumed)
- Multi-currency transfers (only AED used in seeds)
- Distributed system failure modes (network partitions, service crashes mid-transaction)

## What is Real vs Stubbed

| Component | Real or Stubbed |
|---|---|
| Express HTTP service | Real (minimal fixture) |
| SQLite database | Real (in-memory, per-test isolation) |
| Wallet balance management | Real |
| Idempotency handling | Real (payload hash comparison) |
| Audit events | Real (persisted to `audit_events` table) |
| Outbox events | Real (persisted to `outbox_events` table) |
| Message broker / consumer | Not modeled (outbox pattern validates write-side only) |
| External notification service | Not modeled |

## Database Entities Checked

| Table | Invariants Asserted |
|---|---|
| `wallets` | Balance decremented/incremented exactly once per success; unchanged on failure; never negative; total balance conserved |
| `transfers` | One record per successful transfer; correct fields match API response; no records on failure; unique idempotency key |
| `audit_events` | Exactly one per successful transfer; correct event_type and payload; no orphans; none on failure |
| `outbox_events` | Exactly one per successful transfer with status "pending"; correct payload with transfer details; none on failure or duplicate |

## Data Seeding and Isolation

- Each test gets a **fresh in-memory SQLite database** via `beforeEach`
- Default seed wallets: `wallet_001` (10,000 AED), `wallet_002` (5,000 AED), `wallet_003` (0 AED)
- Database is closed in `afterEach` — no cross-test contamination
- No shared state between test files

## Invariants Validated

1. Source wallet balance decreases by exactly the transfer amount on success
2. Destination wallet balance increases by exactly the transfer amount on success
3. Total system balance is conserved (zero-sum) across all operations
4. No balance mutation occurs on rejected transfers
5. Duplicate requests with same idempotency key do not create duplicate side effects
6. Persisted transfer state matches API-visible result
7. Exactly one audit event per successful transfer
8. Exactly one outbox event per successful transfer
9. Balance never goes negative under concurrent competing transfers
10. Concurrent duplicate idempotency key requests produce exactly one transfer

## Concurrency Strategy

- High-concurrency tests use a **real HTTP server** (Node.js `http.createServer`) on a random port
- Concurrent requests are fired via `Promise.all` with raw `http.request` calls
- SQLite's transaction serialization provides the concurrency safety guarantee
- Tests validate invariants (balance non-negativity, single-transfer, zero-sum) after all concurrent requests complete

## Idempotency Validation Strategy

- Payload hashing (SHA-256 of canonical JSON) determines payload equivalence
- Same key + same payload: returns original result (HTTP 200), no new side effects
- Same key + different payload: returns 409 Conflict
- No key: each request creates an independent transfer
- Retry storm (5 sequential retries): exactly one debit, one transfer, one audit event

## Known Limitations

1. **SQLite vs Postgres**: Production would likely use Postgres; SQLite's single-writer model makes concurrency tests less realistic than row-level locking scenarios
2. **In-process concurrency**: Node.js event loop serialization means true parallel execution is limited compared to multi-process/multi-server scenarios
3. **No message broker testing**: Outbox events are validated at the write side only; consumption and delivery are not tested
4. **No partial failure simulation**: The service fixture does not simulate mid-transaction crashes or network failures
5. **Single currency**: All seeds use AED; cross-currency transfer validation is not covered
6. **No authentication/authorization**: The service has no auth layer; access control is not tested
