# Test Coverage & Design — Flow Diagrams and Layer Mapping

## 1. End-to-End Test Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TEST EXECUTION FLOW                                   │
└─────────────────────────────────────────────────────────────────────────────┘

  pytest starts
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  conftest.py │────▶│  Fresh App   │────▶│  Seed Data   │
│  (fixtures)  │     │  + DB        │     │  4 wallets   │
└──────────────┘     └──────────────┘     └──────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         TEST LAYERS VALIDATED                              │
│                                                                           │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐  │
│  │   API       │   │  Business   │   │  Database   │   │   Cross-    │  │
│  │   Layer     │   │  Workflow   │   │  Layer      │   │  Component  │  │
│  │             │   │  Layer      │   │             │   │  Layer      │  │
│  │ • Status    │   │ • Balance   │   │ • wallets   │   │ • audit_    │  │
│  │   codes     │   │   conserve  │   │ • transfers │   │   events    │  │
│  │ • Response  │   │ • Exactly-  │   │ • No orphan │   │ • outbox_   │  │
│  │   shape     │   │   once      │   │   records   │   │   events    │  │
│  │ • Error     │   │ • Retry     │   │ • Absence   │   │ • Exactly-  │  │
│  │   messages  │   │   safety    │   │   checks    │   │   once      │  │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘  │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│  RESULT:     │
│  63 passed   │
│  0 failed    │
└──────────────┘
```

---

## 2. Request Lifecycle — What Each Test Layer Validates

```
CLIENT REQUEST
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1: API VALIDATION (test_validation.py)                     │
│                                                                   │
│ Q: Is the request well-formed?                                    │
│                                                                   │
│ Tests:                                                            │
│  • Missing source_wallet_id        → 422 + error message         │
│  • Missing destination_wallet_id   → 422 + error message         │
│  • Missing amount                  → 422                          │
│  • Missing currency                → 422                          │
│  • Invalid currency "XYZ"          → 422 + "invalid currency"    │
│  • Negative amount                 → 422 + "must be positive"    │
│  • Zero amount                     → 422                          │
│  • Same source & destination       → 422 + "must differ"         │
│  • Non-existent wallet             → 422 + "not found"           │
│  • Currency mismatch               → 422                          │
│                                                                   │
│ ALSO VERIFIED: No DB writes on any rejection (0 rows everywhere) │
└─────────────────────────────────────────────────────────────────┘
     │ (valid request)
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2: IDEMPOTENCY CHECK (test_idempotency.py)                 │
│                                                                   │
│ Q: Have we seen this request before?                              │
│                                                                   │
│ Tests:                                                            │
│  • Same key + same payload         → 200 + original result       │
│  • Same key + different payload    → 409 conflict                │
│  • No key provided                 → creates new transfer        │
│  • Duplicate → single transfer row in DB                         │
│  • Duplicate → single debit only                                 │
│  • Duplicate → single audit event                                │
│  • Duplicate → single outbox event                               │
│                                                                   │
│ KEY INVARIANT: Retries are safe. Never double-charge.             │
└─────────────────────────────────────────────────────────────────┘
     │ (new request)
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3: BUSINESS LOGIC (test_insufficient_balance.py +          │
│                           test_happy_path.py)                     │
│                                                                   │
│ Q: Can this transfer execute?                                     │
│                                                                   │
│ Tests (insufficient balance):                                     │
│  • Amount > balance               → 422                           │
│  • Source balance unchanged        (DB check)                     │
│  • Destination balance unchanged   (DB check)                     │
│  • No transfer record created      (DB check)                     │
│  • No audit/outbox events          (cross-component check)        │
│  • Zero balance wallet rejected                                   │
│  • Exact balance succeeds (edge case)                             │
│                                                                   │
│ Tests (happy path):                                               │
│  • Returns 201 + correct body                                     │
│  • Source debited by exact amount                                 │
│  • Destination credited by exact amount                           │
│  • Net movement = transfer amount                                 │
│  • Total system balance conserved (money neither created/lost)    │
│                                                                   │
│ KEY INVARIANT: balance_before = balance_after + amount             │
└─────────────────────────────────────────────────────────────────┘
     │ (transfer executed)
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 4: PERSISTENCE (test_persistence.py)                        │
│                                                                   │
│ Q: Does the DB match what the API told the client?                │
│                                                                   │
│ Tests:                                                            │
│  • API response fields == DB transfer row fields                  │
│  • GET /wallets balance == direct DB query balance                │
│  • Audit event payload matches transfer amount/currency           │
│  • Audit event timestamp matches transfer timestamp               │
│  • No orphan audit events (all reference real transfers)          │
│  • No orphan outbox events                                        │
│  • GET /transfers/{id} returns correct persisted state            │
│  • GET non-existent resources → 404                               │
│                                                                   │
│ KEY INVARIANT: API state == DB state (no lies to the client)      │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 5: CROSS-COMPONENT (test_cross_component.py)                │
│                                                                   │
│ Q: Were downstream systems notified correctly?                    │
│                                                                   │
│ Tests:                                                            │
│  • Exactly 1 audit event per successful transfer                  │
│  • Exactly 1 outbox event per successful transfer                 │
│  • Outbox payload contains transfer_id, amount, currency, wallets │
│  • Outbox status = "pending" (ready for consumer)                 │
│  • Failed transfer → 0 audit events, 0 outbox events             │
│  • Idempotent retry → still exactly 1 of each                    │
│  • Audit and outbox reference the same transfer_id                │
│                                                                   │
│ KEY INVARIANT: Exactly-once side effects. No duplicates. No gaps. │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 6: CONCURRENCY (test_concurrency.py)                        │
│                                                                   │
│ Q: Does the system stay correct under simultaneous load?          │
│                                                                   │
│ Tests:                                                            │
│  • 5 threads × 3000 from wallet with 10000                       │
│    → max 3 succeed, balance ≥ 0, math exact                      │
│  • 10 threads × same idempotency key                             │
│    → exactly 1 transfer, 1 debit, 1 audit, 1 outbox              │
│  • 5 sequential retries                                           │
│    → first = 201, rest = 200, single debit                        │
│  • 5 threads × different amounts                                  │
│    → total system balance unchanged (conservation)                │
│                                                                   │
│ KEY INVARIANT: No double-spend. No lost money. No negative balance│
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Coverage Matrix — Test File × Validation Layer

```
                        │ API  │ Business │  DB    │ Cross-  │ Concurrency│
                        │Layer │ Workflow │ Layer  │Component│            │
────────────────────────┼──────┼──────────┼────────┼─────────┼────────────┤
test_happy_path.py      │  ✅  │    ✅    │   ✅   │   ✅    │            │
test_validation.py      │  ✅  │          │   ✅   │   ✅    │            │
test_insufficient_      │  ✅  │    ✅    │   ✅   │   ✅    │            │
  balance.py            │      │          │        │         │            │
test_idempotency.py     │  ✅  │    ✅    │   ✅   │   ✅    │            │
test_concurrency.py     │  ✅  │    ✅    │   ✅   │   ✅    │     ✅     │
test_persistence.py     │  ✅  │          │   ✅   │   ✅    │            │
test_cross_component.py │      │    ✅    │   ✅   │   ✅    │            │
────────────────────────┼──────┼──────────┼────────┼─────────┼────────────┤
TOTAL TESTS             │  63 tests across all layers                     │
```

---

## 4. Real-World Challenges Addressed

### Retries
```
Problem:  Client sends payment, network drops, client retries.
          Without protection → customer charged twice.

How tested:
  ┌─────────────────────────────────────────────────┐
  │ test_retry_storm_does_not_double_debit          │
  │                                                 │
  │ Send same request 5 times (same idempotency key)│
  │                                                 │
  │ Assert:                                         │
  │   • 1st response = 201 (created)               │
  │   • 2nd-5th responses = 200 (replayed)          │
  │   • DB: 1 transfer row                          │
  │   • DB: balance debited once only               │
  │   • DB: 1 audit event, 1 outbox event           │
  └─────────────────────────────────────────────────┘
```

### Duplicate Requests
```
Problem:  Two requests arrive with same idempotency key but different data.
          System must reject the second (potential key collision/reuse).

How tested:
  ┌─────────────────────────────────────────────────┐
  │ test_same_key_different_payload_rejected         │
  │                                                 │
  │ 1st request: key="abc", amount=1000 → 201      │
  │ 2nd request: key="abc", amount=2000 → 409      │
  │                                                 │
  │ Assert:                                         │
  │   • Only 1 transfer in DB (the first one)       │
  │   • Balance reflects only first transfer        │
  └─────────────────────────────────────────────────┘
```

### Partial Failures / Race Conditions
```
Problem:  5 users simultaneously transfer from the same wallet.
          Not enough balance for all. Some must fail cleanly.

How tested:
  ┌─────────────────────────────────────────────────┐
  │ test_concurrent_transfers_balance_never_negative │
  │                                                 │
  │ wallet_001 = 10,000                             │
  │ 5 threads × 3,000 simultaneously               │
  │                                                 │
  │ Assert:                                         │
  │   • At most 3 succeed (10000/3000 = 3.33)       │
  │   • Final balance ≥ 0 (never negative)          │
  │   • Final balance = 10000 - (successes × 3000)  │
  │   • transfer_rows == successes (no ghost rows)  │
  │                                                 │
  │ WHY THIS MATTERS:                               │
  │   Without locking, all 5 threads could read     │
  │   balance=10000, all think "enough money",      │
  │   all debit → balance = -5000 (CATASTROPHIC)    │
  └─────────────────────────────────────────────────┘
```

---

## 5. Test Design Quality — Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     TEST ARCHITECTURE                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1: TEST SCENARIOS (what behavior to validate)              │
│                                                                   │
│   test_happy_path.py   → "Transfer succeeds end-to-end"          │
│   test_validation.py   → "Bad input is rejected cleanly"         │
│   test_idempotency.py  → "Duplicates are handled safely"         │
│   test_concurrency.py  → "Races don't corrupt data"              │
│   ...                                                             │
│                                                                   │
│   Each test reads like a BUSINESS REQUIREMENT, not code details   │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ uses
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2: HELPERS (how to interact with the system)               │
│                                                                   │
│   ┌─────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│   │  api_client.py  │  │ db_helpers.py  │  │  builders.py   │   │
│   │                 │  │                │  │                │   │
│   │ create_transfer │  │ get_balance()  │  │ transfer_      │   │
│   │ get_transfer    │  │ get_count()    │  │   payload()    │   │
│   │ get_wallet      │  │ get_audit()    │  │ unique_idem_   │   │
│   │                 │  │ get_outbox()   │  │   key()        │   │
│   └─────────────────┘  └────────────────┘  └────────────────┘   │
│                                                                   │
│   Tests NEVER contain raw HTTP calls or SQL queries directly      │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ uses
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3: FIXTURES (test environment setup)                        │
│                                                                   │
│   conftest.py:                                                    │
│     • Creates fresh Flask app per test                            │
│     • Creates fresh in-memory SQLite DB                           │
│     • Seeds 4 wallets with known balances                         │
│     • Provides test client                                        │
│     • Auto-cleanup (DB destroyed after each test)                 │
│                                                                   │
│   GUARANTEES: Complete isolation. Deterministic. Repeatable.      │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ creates
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 4: SYSTEM UNDER TEST (the actual service)                   │
│                                                                   │
│   service/app.py:                                                 │
│     • Flask web app with 3 endpoints                              │
│     • SQLite with 4 tables                                        │
│     • Threading lock for concurrency safety                       │
│     • Idempotency key matching via payload hash                   │
│                                                                   │
│   THIS IS WHAT WE'RE TESTING (not mocked, real implementation)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Why This Goes Beyond Basic API Testing

```
┌─────────────────────────────────────┬─────────────────────────────────────┐
│   BASIC API TEST (what juniors do)  │  OUR APPROACH (transactional SDET)  │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ POST /transfers → assert 201        │ POST /transfers → assert 201        │
│ Done. ✓                             │ + assert source balance decreased    │
│                                     │ + assert destination balance incr.   │
│                                     │ + assert transfer row in DB          │
│                                     │ + assert audit event written         │
│                                     │ + assert outbox event written        │
│                                     │ + assert API == DB (consistency)     │
│                                     │ + assert total balance conserved     │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ POST with bad data → assert 422     │ POST with bad data → assert 422     │
│ Done. ✓                             │ + assert 0 transfer rows             │
│                                     │ + assert balances unchanged          │
│                                     │ + assert 0 audit events              │
│                                     │ + assert 0 outbox events             │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ No duplicate testing                │ Same key + same payload → 200       │
│                                     │ Same key + diff payload → 409        │
│                                     │ Single DB row after duplicates       │
│                                     │ Single debit after duplicates        │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ No concurrency testing              │ 5 threads racing for limited balance │
│                                     │ 10 threads same idempotency key      │
│                                     │ Balance conservation under load      │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ No cross-component checks           │ Audit events: count + correctness    │
│                                     │ Outbox events: exactly-once          │
│                                     │ No orphan records                    │
└─────────────────────────────────────┴─────────────────────────────────────┘
```

---

## 7. Invariants Catalog — What Must ALWAYS Be True

| # | Invariant | Where Verified |
|---|---|---|
| 1 | Source balance decreases by exactly the transfer amount | `test_happy_path` |
| 2 | Destination balance increases by exactly the transfer amount | `test_happy_path` |
| 3 | Total system balance never changes (conservation of money) | `test_happy_path`, `test_concurrency` |
| 4 | Balance never goes negative | `test_concurrency` |
| 5 | Rejected transfers create zero DB records | `test_validation`, `test_insufficient_balance` |
| 6 | Rejected transfers leave all balances unchanged | `test_validation`, `test_insufficient_balance` |
| 7 | Duplicate requests create exactly 1 transfer row | `test_idempotency`, `test_concurrency` |
| 8 | Duplicate requests debit exactly once | `test_idempotency`, `test_concurrency` |
| 9 | Each successful transfer has exactly 1 audit event | `test_cross_component` |
| 10 | Each successful transfer has exactly 1 outbox event | `test_cross_component` |
| 11 | API response fields match DB row fields exactly | `test_persistence` |
| 12 | No orphan events (all reference real transfers) | `test_persistence` |
| 13 | Same key + different payload = 409 (no silent data loss) | `test_idempotency` |
| 14 | Concurrent competing transfers: successes × amount = total debited | `test_concurrency` |

---

## 8. Test Count Summary

| File | Tests | Primary Focus |
|---|---|---|
| `test_happy_path.py` | 11 | Multi-layer success validation |
| `test_validation.py` | 15 | Input rejection + zero side effects |
| `test_insufficient_balance.py` | 9 | Balance guard + zero mutation |
| `test_idempotency.py` | 8 | Duplicate semantics + exactly-once |
| `test_concurrency.py` | 4 | Threaded races + retry safety |
| `test_persistence.py` | 8 | API-to-DB consistency |
| `test_cross_component.py` | 8 | Audit + outbox verification |
| **TOTAL** | **63** | **End-to-end transactional correctness** |

---

## 9. How to Run

```bash
cd submission/ngawande

# All tests (CI Gate: unit-and-integration-tests)
python3 -m pytest -v

# Reliability only (CI Gate: reliability-tests)
python3 -m pytest -v -m reliability

# Schema check (CI Gate: db-migration-or-schema-check)
python3 scripts/validate_schema.py

# Single file
python3 -m pytest -v tests/test_concurrency.py
```

