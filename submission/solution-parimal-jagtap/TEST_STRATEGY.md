# Test Strategy — Wallet Transfer Service

## System Under Test

This solution uses **Option 3 (Hybrid)**: a minimal in-memory wallet transfer service
built as a test fixture (`service/server.js`), with full business logic implemented
so the entire test suite runs locally without any external dependencies.

---

## What is Real vs Stubbed

| Component | Approach |
|---|---|
| Transfer API (`POST /transfers`, `GET /transfers/:id`) | Real — fully implemented |
| Wallet read API (`GET /wallets/:id`) | Real — fully implemented |
| Wallet balance store | Real in-memory DB (Map) |
| Transfer record persistence | Real in-memory DB |
| Idempotency key store | Real — enforces deduplication |
| Audit/event log (`transfer_events`) | Real in-memory |
| Outbox events table | Real in-memory |
| Concurrency control (wallet locks) | Real — mutex per wallet pair |
| Network/queue dispatch | Stubbed — outbox written but not dispatched |

---

## Test Levels Covered

| Level | File | What is Validated |
|---|---|---|
| API Contract | `tests/api/contract.test.ts` | Request/response shape, status codes, error handling, idempotency replay |
| Database | `tests/database/persistence.test.ts` | Balance updates, record correctness, audit trail, outbox, invariants |
| E2E Flow | `tests/e2e/transfer-flow.test.ts` | Full path API → DB → audit → outbox |
| Concurrency | `tests/concurrency/race-conditions.test.ts` | Duplicate in-flight, competing transfers, retry safety |
| Component | `tests/component/outbox-audit.test.ts` | Exactly-once outbox, audit event correctness, idempotency store |

---

## API Contract Assumptions

```
POST /transfers
  Body: { source_wallet_id, destination_wallet_id, amount, currency, reference }
  Header: Idempotency-Key (optional)
  Returns: 201 on success, 400 on validation failure, 422 on business rule failure

GET /transfers/:transfer_id
  Returns: 200 with transfer object, 404 if not found

GET /wallets/:wallet_id
  Returns: 200 with wallet object including balance, 404 if not found
```

---

## Database Tables Checked

- `wallets` — balance before/after every transfer
- `transfers` — record existence, field correctness, status
- `idempotency_keys` — deduplication store, linked transfer_id
- `transfer_events` — audit log, event type, payload correctness
- `outbox_events` — exactly-once write, not duplicated on retry

---

## Key Invariants Validated

1. Source wallet debited exactly once on success
2. Destination wallet credited exactly once on success
3. Total balance conservation — money neither created nor destroyed
4. No balance mutation on rejected transfers (insufficient balance, validation failure)
5. Duplicate requests with same idempotency key produce one transfer, one debit
6. DB state matches API response on every successful transfer
7. Outbox event written once per transfer, not per request
8. Audit event written with correct payload

---

## Concurrency Strategy

Race conditions tested using `Promise.all()` to fire simultaneous requests:
- Same idempotency key from 5 concurrent clients → only 1 transfer
- 10 concurrent transfers competing for limited balance → no overdraft
- 3 retries after assumed response loss → only 1 debit

The service uses a per-wallet-pair mutex to prevent race conditions at the balance update layer.

---

## Idempotency Validation Strategy

Three scenarios covered:
1. Same key + same payload → returns original result (200), no new transfer
2. Same key + different payload → rejected (422, idempotency_conflict)
3. No key → each request treated as independent

---

## Known Limitations

- Outbox events are written but not dispatched to a real queue (no Kafka/SQS in scope)
- Service is in-memory — state resets on restart (by design for test isolation)
- No authentication layer tested (out of scope per assignment)
- No performance/load testing (out of scope per assignment)
- Transfer status is always COMPLETED (no async processing simulation)

---

## How to Run

```bash
npm install
npx playwright install
npm test
```

See README.md for full setup instructions.
