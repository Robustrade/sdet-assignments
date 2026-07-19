# Dummy PR / Approach Outline — Wallet Transfer Service (Java)

> Status: Documentation-first step (before full implementation).  
> Candidate: Rupesh Detke  
> Candidate language: Java (Maven + JUnit 5 + RestAssured + H2)  
> Branch: solution/rupesh-detke  
> Submission path: submission/rupesh-detke/

This document is the required documentation-first deliverable: understanding, scope, and validation strategy before substantial automation code.

---

## 1. Understanding of the Assignment

This is not a basic CRUD API test exercise. The goal is to prove that a Wallet Transfer Service behaves correctly as a transactional system under:

| Risk | Why it matters |
|------|----------------|
| Duplicate / retried requests | Clients lose responses and retry; money must not move twice |
| Concurrent transfers | Two requests can race on limited balance |
| API ↔ DB mismatch | Status 200 with wrong balances is a critical failure |
| Side-effect duplication | Outbox/audit must stay exactly-once with the transfer |
| Invalid inputs / insufficient funds | Must reject and leave persistence clean |

We must automate validation across API → workflow → database → adjacent components, with depth over breadth (3–5 hour timebox).

---

## 2. Chosen Approach (Option 2 + Option 3 Hybrid)

No production service is provided, so we will:

1. Build a minimal Wallet Transfer Service fixture (real HTTP API + real JDBC persistence).
2. Use real database tables for wallets, transfers, idempotency, audit events, and outbox.
3. Treat the message broker as out-of-process / not required: we validate the outbox row (transactional outbox pattern) as the cross-component contract instead of a live Kafka/RabbitMQ.

| Component | Real or stubbed? |
|-----------|------------------|
| HTTP API (POST/GET transfers, GET wallets) | Real (embedded Javalin app) |
| Persistence (H2 file/mem DB, SQL schema) | Real |
| Idempotency store | Real table |
| Transfer audit / lifecycle events | Real transfer_events table |
| Outbox (downstream publish intent) | Real outbox_events table |
| Actual message broker / notification sender | Stubbed / not started — outbox presence + uniqueness stands in for publish |

This keeps the assignment focused on test engineering, while still exercising real transactional boundaries.

---

## 3. Assumed API Contract

### POST /transfers
Headers: Idempotency-Key: <uuid>  
Body:
json
{
  "source_wallet_id": "wallet_001",
  "destination_wallet_id": "wallet_002",
  "amount": 2500,
  "currency": "AED",
  "reference": "invoice_123"
}


| Outcome | HTTP | Notes |
|---------|------|-------|
| Success | 201 | Transfer created; balances updated |
| Idempotent replay (same key + same payload) | original status (e.g. 201) | Original logical result returned; no double side effects |
| Same key + different payload | 409 | Conflict |
| Validation error | 400 | Missing fields, zero/negative amount, same wallets, bad currency |
| Insufficient balance | 422 | No balance mutation; failure audit optional |
| Missing idempotency key | 400 | Rejected |

### Reads
- GET /transfers/{transfer_id} → 200 / 404
- GET /wallets/{wallet_id} → 200 / 404

Amounts are integer minor units (e.g. fils) to avoid float money bugs.

---

## 4. Database Entities & Invariants

### Tables
1. wallets — id, currency, balance, version (optimistic lock)
2. transfers — id, source, destination, amount, currency, reference, status, created_at
3. idempotency_keys — key, request_hash, transfer_id, response_code, response_body, created_at
4. transfer_events — audit trail (CREATED, COMPLETED, REJECTED_INSUFFICIENT_FUNDS, etc.)
5. outbox_events — exactly one TRANSFER_COMPLETED row per successful transfer

### Core invariants under test
- On success: source −amount, destination +amount, exactly once
- Total conserved across the two wallets for that transfer
- On reject: zero balance change; no success transfer / outbox
- Same idempotency key + payload → same transfer id; one transfer row; one outbox row
- Same key + different payload → conflict; no extra debit
- Concurrent competing transfers never drive a wallet balance negative
- Persisted transfer status matches API-visible result

---

## 5. Test Levels & Scenario Map

| Category | Layer focus | Example scenarios |
|----------|-------------|-------------------|
| A Happy path | API + DB + outbox | Successful transfer; balances; events |
| B Validation | API + absence in DB | Missing fields, negative amount, same wallet, bad currency |
| C Insufficient funds | API + DB | Reject; balances unchanged; no outbox |
| D Idempotency | API + DB + outbox | Replay; key collision; no double debit |
| E Concurrency | Reliability | Parallel same-key; competing limited balance |
| F Auditability | DB | Event rows coherent with transfer status |
| G Cross-component | Outbox | Exactly-once outbox on success; none on failure |

### Reliability suite (CI: *Reliability*)
- Concurrent duplicate submissions (same idempotency key)
- Two concurrent transfers competing for limited balance
- Client-retry simulation after “response loss” (replay key)

---

## 6. Test Architecture


submission/rupesh/
├── TEST_STRATEGY.md          ← this outline (dummy PR)
├── README.md                 ← how to run
├── pom.xml
├── src/main/java/...         ← minimal service fixture
├── src/main/resources/schema.sql
├── src/test/java/.../support ← client, DB helpers, builders, assertions
└── src/test/java/...         ← scenario specs by category


Layers:
1. Fixtures — seed wallets, reset schema per test class/method
2. API client — RestAssured wrapper (no HTTP noise in tests)
3. Assertions — API + DB + outbox invariants in one place
4. Builders — wallets, transfer requests, idempotency keys
5. Scenarios — readable JUnit tests grouped by risk

Red → Blue → Green: write failing invariant tests first, then minimal service behavior, then tidy structure.

---

## 7. Concurrency Strategy

- Service uses DB transactions + wallet row locking / version checks.
- Tests use ExecutorService / parallel HTTP calls.
- Assertions check final balances and row counts, not timing.
- We accept that concurrency tests are probabilistic under extreme load; we keep them small and invariant-focused for CI stability.

---

## 8. Scope / Non-Goals

In scope: multi-layer transfer correctness, idempotency, concurrency, persistence, outbox uniqueness.  
Out of scope: UI, load/perf suites, real broker, multi-currency FX, auth/JWT, monitoring dashboards.

---

## 9. Known Limitations (planned honesty)

- H2 instead of Postgres/Testcontainers (faster CI; document dialect differences).
- Outbox not drained to a real consumer (publish pipeline stubbed at the boundary).
- No distributed saga / multi-service compensation.
- Partial process-crash mid-transaction is hard to automate without fault injection; covered conceptually via transactional boundaries + retry tests.

---

## 10. Implementation Plan (next after this outline)

1. Schema + ValidateSchema main for CI db-migration-or-schema-check
2. Minimal service: transfer + idempotency + outbox in one transaction
3. Test support layer (client / DB / builders)
4. Scenario tests A–G, with *Reliability* classes for CI
5. README + Spotless + mvn test green

---

## 11. Responsible AI Usage (disclosure)

- AI tooling (Cursor) used to accelerate scaffolding, docs, and boilerplate.
- Candidate responsibility: review strategy, invariants, concurrency design, and verify tests locally against real failures/passes.

---

End of dummy PR outline. Full Java solution follows in this folder.
