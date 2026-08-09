# PR: Wallet Transfer Service — Automated Test Suite

## Summary

This PR implements a full automated validation suite for a Wallet Transfer Service using **Playwright (JavaScript)** with a minimal **Express + SQLite** service fixture.

---

## Test Strategy

### Levels Covered

| Layer | Coverage |
|---|---|
| API Contract | Response codes, payload shape, validation errors |
| Business Workflow | Transfer lifecycle, idempotency, retry safety |
| Database | Balance invariants, row correctness, audit trail |
| Cross-Component | Outbox events, transfer_events audit log |
| Concurrency | Parallel duplicate requests, competing transfers |

### What is Real vs Stubbed

| Component | Status |
|---|---|
| REST API (`/transfers`, `/wallets`) | Real — Express service |
| SQLite database | Real — all DB assertions hit actual rows |
| Idempotency store (`idempotency_keys` table) | Real |
| Audit log (`transfer_events` table) | Real |
| Outbox (`outbox_events` table) | Real — simulated (not dispatched to a broker) |
| Message broker (Kafka, SQS, etc.) | Stubbed — outbox pattern used instead |

---

## API Validation Approach

- Every request goes through a thin `api-client.js` wrapper (transport details isolated)
- Assertions cover: status codes, response body shape, error codes
- Duplicate + conflict behavior explicitly tested (409, idempotency replay, conflict on different payload)

---

## Database Validation Approach

Tables checked:
- `wallets` — balance before/after, conservation invariant
- `transfers` — all fields, status, foreign keys
- `idempotency_keys` — key stored once, linked to correct transfer
- `transfer_events` — TRANSFER_COMPLETED event written
- `outbox_events` — one event per successful transfer, not duplicated

Key invariants asserted:
1. `src.balance_after = src.balance_before - amount` (exactly once)
2. `dst.balance_after = dst.balance_before + amount` (exactly once)
3. `src.balance + dst.balance = constant` (conservation)
4. No transfer row on validation failure
5. No balance mutation on rejected transfer
6. No duplicate idempotency rows on replay

---

## Cross-Component Validation

- `outbox_events` checked after every successful transfer
- Verified: exactly 1 outbox row per transfer ID
- Verified: 0 outbox rows on failed/rejected transfers
- `transfer_events` audit trail verified for TRANSFER_COMPLETED event

---

## Concurrency & Reliability Coverage

| Scenario | Test |
|---|---|
| 5 parallel duplicate requests (same key) | Exactly 1 transfer created, balance moved once |
| 6 concurrent transfers exceeding balance | At most floor(balance/amount) succeed, balance ≥ 0 |
| N concurrent transfers (unique keys) | All succeed, all independent rows, final balance exact |
| Two sources → one destination | No cross-wallet contamination |
| Read-after-write after concurrent writes | GET reflects correct final state |

SQLite's WAL mode + atomic transactions enforce serialization; the tests verify outcomes match transactional guarantees.

---

## Known Limitations & Tradeoffs

- **SQLite vs production DB**: Real systems use PostgreSQL with row-level locking. SQLite serializes writes via WAL. Concurrency behavior is equivalent for correctness checks but not for true parallel throughput testing.
- **Message broker not real**: Outbox pattern simulated; actual Kafka/SQS publish not tested (would require testcontainers or a broker stub).
- **No auth/TLS**: Not in scope for this assignment.
- **No load/performance tests**: Out of scope per assignment brief.
- **Status transitions**: Only COMPLETED modeled; PENDING → FAILED path not exercised (no async worker).

---

## How to Run

```bash
cd wallet-transfer-tests
npm install
npx playwright test --reporter=list
```

Run specific suites:
```bash
npx playwright test tests/api
npx playwright test tests/db
npx playwright test tests/e2e
npx playwright test tests/concurrency
```

---

## AI Usage

Claude (Anthropic) was used to scaffold boilerplate (server fixture, file structure). All test scenario design, invariant selection, concurrency strategy, and DB validation logic was reviewed, validated, and adjusted manually. The idempotency conflict handling, SQLite transaction approach, and outbox verification were specifically reasoned through, not just generated.
