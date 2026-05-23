# Understanding & Approach — Wallet Transfer Service SDET Assignment

## 1. Understanding of the System Under Test

The Wallet Transfer Service is a backend transactional system that moves money between
wallets. It exposes three HTTP endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/transfers` | POST | Create a wallet-to-wallet transfer |
| `/transfers/{id}` | GET | Retrieve transfer details |
| `/wallets/{id}` | GET | Retrieve wallet balance |

### Key Behaviors the System Must Guarantee

- **Exactly-once processing**: A transfer must debit the source and credit the
  destination exactly once, regardless of how many times the client retries.
- **Idempotency via header key**: The `Idempotency-Key` header ensures duplicate
  requests with the same payload return the original result; mismatched payloads
  are rejected with 409.
- **Balance safety**: A wallet balance must never go negative. Concurrent transfers
  competing for limited funds must be serialized safely.
- **Atomic persistence**: Transfer row, balance updates, audit event, and outbox
  event must all commit together or not at all.
- **Auditability**: Every successful transfer produces an audit trail entry.

---

## 2. Scope of Automation

### In Scope

| Layer | What is validated |
|---|---|
| **API** | Request/response contracts, status codes, payload shape, error messages |
| **Business Workflow** | Transfer lifecycle, balance conservation, idempotency semantics, retry safety |
| **Database** | `wallets`, `transfers`, `audit_events`, `outbox_events` — row counts, field values, absence of invalid records |
| **Cross-Component** | Audit event correctness, outbox event exactly-once semantics |
| **Concurrency** | Competing transfers for limited balance, concurrent duplicate idempotency keys, retry storms |

### Out of Scope

- Performance / load testing
- UI testing
- Real message queue or event bus integration
- Network failure injection (circuit breakers, timeouts)
- Production monitoring / alerting setup

---

## 3. What Is Real vs Stubbed

| Component | Real or Simulated | Rationale |
|---|---|---|
| Flask web service | **Real** | Lightweight, runs in-process via `test_client()` |
| SQLite database | **Real** (in-memory) | Full SQL behavior, zero setup, fresh per test |
| Wallet balances | **Real** | Seeded via fixture, queried directly |
| Audit events table | **Real** | Written by service, verified by tests |
| Outbox events table | **Real** | Written by service, verified by tests (simulates downstream publish trigger) |
| Message queue consumer | **Simulated** | We verify the outbox row exists; an actual consumer is out of scope |
| External notification service | **Not modeled** | Would be stubbed in a production test; omitted for focus |

---

## 4. API Contracts Assumed

### POST /transfers

**Request body:**
```json
{
  "source_wallet_id": "wallet_001",
  "destination_wallet_id": "wallet_002",
  "amount": 2500,
  "currency": "AED",
  "reference": "invoice_123"
}
```

**Headers:** `Idempotency-Key: <uuid>` (optional)

**Responses:**
| Code | Meaning |
|---|---|
| 201 | Transfer created successfully |
| 200 | Idempotent replay of existing transfer |
| 409 | Idempotency key conflict (same key, different payload) |
| 422 | Validation error (missing fields, invalid currency, insufficient balance, etc.) |

### GET /transfers/{id}
- 200 with transfer object | 404 if not found

### GET /wallets/{id}
- 200 with wallet object | 404 if not found

---

## 5. Database Entities Checked

| Table | Invariants Asserted |
|---|---|
| `wallets` | Balance decreases exactly once on success; unchanged on rejection; never negative |
| `transfers` | Exactly 1 row per idempotent transfer; status = "completed"; all fields match API response |
| `audit_events` | Exactly 1 row per successful transfer; `event_type` = "transfer_completed"; 0 rows on rejection |
| `outbox_events` | Exactly 1 row per successful transfer; 0 rows on rejection; not duplicated by retries |

---

## 6. Idempotency Validation Strategy

| Scenario | Expected Behavior | Verified At |
|---|---|---|
| Same key + same payload (retry) | Returns original transfer (200) | API + DB (1 row, 1 debit) |
| Same key + different payload | Returns 409 Conflict | API + DB (no 2nd row, no 2nd debit) |
| No key provided | Each request creates independent transfer | API + DB (N rows, N debits) |
| 10 concurrent threads, same key | Exactly 1 transfer created | API + DB + threading |
| 5 sequential retries, same key | Exactly 1 transfer, 1 debit | API + DB |

---

## 7. Concurrency Validation Strategy

| Scenario | Setup | Invariant |
|---|---|---|
| Competing transfers, limited balance | wallet_001 has 10000; 5 threads transfer 3000 each | ≤3 succeed; balance ≥ 0; balance = 10000 − (successes × 3000) |
| Concurrent idempotent duplicates | 10 threads, same key + payload | Exactly 1 transfer row; balance debited once |

**Mechanism:** Python `threading.Thread` for true concurrency against the shared Flask app and SQLite (with WAL mode + application-level mutex).

---

## 8. Test Architecture

```
tests/
├── conftest.py              ← Fixtures: fresh app + seeded wallets per test
├── helpers/
│   ├── api_client.py        ← Encapsulates POST/GET, hides transport
│   ├── db_helpers.py        ← Direct DB queries for assertions
│   └── builders.py          ← Transfer payload + idempotency key factories
├── test_happy_path.py       ← Category A — multi-layer success validation
├── test_validation.py       ← Category B — input rejection + no side effects
├── test_insufficient_balance.py ← Category C — balance guard + no mutation
├── test_idempotency.py      ← Category D — duplicate semantics
├── test_concurrency.py      ← Category E — threaded race tests (@reliability)
├── test_persistence.py      ← Category F — API-to-DB consistency
└── test_cross_component.py  ← Category G — audit + outbox verification
```

**Design principles:**
- **Isolation**: In-memory SQLite, fresh per test — no shared state.
- **Readability**: Test names describe business behavior, not implementation.
- **Reusability**: Helpers and builders eliminate repetition.
- **Separation**: API calls, DB queries, and assertions are in distinct layers.

---

## 9. Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| SQLite lacks row-level locking | Concurrency tests use app-level mutex, not DB-level locks | Document as known gap; would use PostgreSQL + Testcontainers in production |
| No real message queue | Cannot test consumer-side exactly-once delivery | Outbox table acts as a proxy; verify row count |
| No network failure simulation | Cannot test client timeout + retry scenarios with real HTTP | Use sequential retry simulation via test client |
| Single-process concurrency | Threading against in-memory SQLite is limited | Sufficient to prove invariants; real system would need multi-process tests |
| No schema migration tool | Schema is created directly via DDL | `validate_schema.py` confirms structure is reproducible |

---

## 10. Tradeoffs

- **Depth over breadth**: Focused on fewer scenarios with multi-layer assertions rather than many shallow status-code-only tests.
- **Real over mocked**: Used real Flask + SQLite rather than mocking, for higher confidence at the cost of slightly slower tests (still sub-second).
- **In-process over network**: Used Flask `test_client()` instead of starting a real HTTP server, trading network-layer fidelity for speed and simplicity.
- **Outbox as proxy**: Added an `outbox_events` table as a concrete cross-component artifact to verify, rather than integrating a real message broker.

