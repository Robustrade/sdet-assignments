# Test Strategy — Wallet Transfer Service

## 1. Approach chosen

**Option 2 — Minimal Service Fixture.** No implementation was provided, so a
small FastAPI + SQLAlchemy + SQLite wallet transfer service was built
(`app/`) specifically to give the test suite something real to validate.
The fixture is intentionally scoped to only the behaviors the assignment
calls out: idempotency, balance invariants, audit trail, outbox, and
concurrency-safe transfers. It is **not** a production candidate — see
Section 6 for what's simulated vs. real.

Building the fixture first, driven by the tests (Red → Blue → Green — see
Section 8), is what let the suite validate genuinely meaningful behavior
instead of testing against a mock that could quietly agree with whatever
the tests expected.

## 2. Scope

**In scope:**
- API contract validation (status codes, payload shape)
- Business workflow validation (lifecycle, invariants, idempotency)
- Database validation (transfers, wallets, idempotency_keys, transfer_events, outbox_events)
- Concurrency / race-condition validation
- Component interaction validation (outbox table as the downstream-publish contract)

**Out of scope (see Non-Goals in the assignment):**
- Frontend/UI
- Performance/load testing
- Multi-currency FX conversion
- Authentication/authorization
- A real message broker or notification system (outbox table stands in for this)
- Multi-instance/distributed deployment concerns

## 3. What is real vs. stubbed

| Component | Real or stubbed | Notes |
|---|---|---|
| HTTP API (`POST /transfers`, `GET /transfers/{id}`, `GET /wallets/{id}`) | Real | FastAPI, exercised via `TestClient` (in-process HTTP) |
| Database | Real | SQLite via SQLAlchemy ORM, real schema, real constraints (incl. a `UNIQUE(transfer_id, event_type)` constraint on outbox rows) |
| Idempotency store | Real | `idempotency_keys` table, checked before and after acquiring the concurrency lock |
| Audit/event log | Real | `transfer_events` table, append-only |
| Outbox | Real table, simulated publisher | The row is written transactionally with the transfer; nothing actually drains/publishes it to a broker. Tests validate the *contract* a publisher would depend on (exactly one row, correct event type), not an actual message delivery. |
| Message queue / downstream notification | Not implemented | Outbox row is the boundary we validate up to; a real broker was out of scope for a 3–5 hour assignment |
| Concurrency control | Real, but fixture-appropriate | In-process lock keyed by wallet pair, plus a global lock serializing access to the single SQLite connection (see Section 6) |

## 4. API contracts assumed

```
POST /transfers
  Header: Idempotency-Key (required, min length 8)
  Body: { source_wallet_id, destination_wallet_id, amount (int, minor units, >0),
          currency (3-letter uppercase), reference (optional) }
  -> 201 COMPLETED | 422 REJECTED (insufficient balance / validation) |
     404 (unknown wallet) | 409 (idempotency key reused with different payload) |
     400 (missing/malformed idempotency key)

GET /transfers/{transfer_id} -> 200 | 404
GET /wallets/{wallet_id}     -> 200 | 404
```

Design choice: insufficient balance returns `422` with a persisted
`REJECTED` transfer row (business rejection, auditable), whereas payload
validation errors (missing fields, bad currency, non-positive amount,
same source/destination) return `422` with **no** row persisted at all
(the request never became a real transfer attempt). This distinction is
deliberate and is asserted directly in `test_validation_failures.py` vs
`test_insufficient_balance.py`.

## 5. Database entities checked

| Table | Invariants asserted |
|---|---|
| `wallets` | balance decreases exactly once on a successful debit, increases exactly once on a successful credit, unchanged on rejection, never negative under concurrent contention, total balance across both wallets conserved |
| `transfers` | exactly one row per idempotency key regardless of retry count, status matches API-visible result, amount/currency/reference match the request, terminal status never mutated by replay |
| `idempotency_keys` | correct `request_hash` stored, correctly linked to the resulting `transfer_id`, second use with a different payload rejected without a new row |
| `transfer_events` | CREATED → COMPLETED (or REJECTED alone) ordering, non-decreasing timestamps, no COMPLETED event on a rejected transfer |
| `outbox_events` | exactly one row per (transfer, event_type) — enforced at both the app logic level and the DB schema level via a unique constraint — never duplicated by retried/racing requests |

**Avoiding false positives from stale data:** every test runs against a
freshly reset schema (`reset_db()` in an autouse `clean_db` fixture,
`tests/conftest.py`), so no test can pass or fail because of another
test's leftover rows. All DB assertions call `session.expire_all()` before
reading (`tests/db_helpers.py`) so verification never reads a stale
SQLAlchemy identity-map value — it always re-queries the actual persisted
state.

## 6. Concurrency strategy — and its honest limits

Two distinct locking concerns exist in this fixture, and it's important not
to conflate them:

1. **Domain concurrency control** (`app/main.py`, `_wallet_pair_locks`): a
   lock keyed by the *unordered pair* of wallets involved in a transfer.
   This is what makes "two competing transfers can't both succeed against
   insufficient shared balance" provable, while still letting transfers on
   unrelated wallets run in parallel (`test_concurrent_transfers_on_unrelated_wallets_both_succeed`).

2. **SQLite thread-safety** (`app/db.py`, `db_write_lock`): SQLite's
   underlying C connection is not safe for concurrent use from multiple
   threads, even with `check_same_thread=False` (that flag only disables
   Python's same-thread assertion, not actual thread-safety). The fixture
   uses `StaticPool` (one shared connection) plus a lock serializing all
   access to it. **This is a fixture-only workaround for SQLite, not a
   design pattern that would exist in a production service** — a real
   deployment would use Postgres/MySQL, real connection pooling, and
   `SELECT ... FOR UPDATE` or optimistic version columns for the domain
   lock instead of an in-process mutex.

Tests validated here: single-key races collapsing to one transfer
(`test_concurrent_requests_with_same_idempotency_key_produce_single_transfer`),
competing-balance races producing exactly one winner
(`test_two_concurrent_transfers_cannot_both_succeed...`), unrelated
transfers proceeding in parallel, and read-after-write consistency
following a concurrent burst.

**What this does *not* prove:** correctness under multi-process or
multi-instance deployment, or genuine database-level row locking under a
real RDBMS. If this fixture were swapped for a Postgres-backed service, the
same test *shapes* would still apply and would be worth re-running against
it, but the `db_write_lock` workaround would no longer be needed or valid —
that's called out explicitly in the concurrency test module's docstring so
it isn't mistaken for the intended production mechanism.

## 7. Idempotency validation strategy

- Same key + same payload → replay returns the original transfer, no new
  side effects (`test_same_key_same_payload_returns_identical_transfer_id`,
  `test_replay_after_simulated_response_loss_is_safe`).
- Same key + different payload → `409 Conflict`, original transfer
  untouched (`test_same_key_different_payload_is_rejected_as_conflict`).
- Idempotency check happens twice: once before acquiring the wallet-pair
  lock (fast path for the common case) and once again inside it, to close
  the race where two threads both pass the first check simultaneously.
  `test_concurrent_requests_with_same_idempotency_key_produce_single_transfer`
  is what actually proves this double-check is necessary and sufficient.

## 8. Red, Blue, Green — how this was actually built

Practically: for each behavior category, a test was written first against
the not-yet-existing endpoint/table, run to confirm it failed for the
*expected* reason (not a typo), then the minimum fixture code was added to
make it pass, then refactored. Two concrete examples worth mentioning
candidly:

- The first concurrency test run caught a real bug: SQLAlchemy expires
  object attributes after `commit()`, so a background thread touching
  `wallet.id` on a fixture object was triggering a lazy DB reload outside
  the write lock, intermittently raising `sqlite3.InterfaceError: bad
  parameter or other API misuse`. Fixed by setting
  `expire_on_commit=False` on the session factory (`app/db.py`) — documented
  there. This was caught by running the concurrency suite ~25 times in a
  row, not by a single green run.
- The outbox unique constraint (`UniqueConstraint("transfer_id",
  "event_type")`) was added specifically because an app-logic-only
  guarantee against duplicate outbox rows felt insufficient for a
  financial-adjacent system — the schema itself should refuse it too.
  `test_outbox_unique_constraint_prevents_duplicate_event_type_at_db_level`
  exercises this directly.

## 9. Test architecture

```
app/                       # minimal service fixture (system under test)
  models.py                # SQLAlchemy schema
  db.py                    # engine/session, concurrency-safety notes
  main.py                  # FastAPI endpoints + business logic

tests/
  conftest.py               # fixtures: clean DB per test, TestClient, seeded wallets
  api_client.py             # API Client layer — transport details isolated here
  db_helpers.py             # Assertion/Verification layer — DB-side
  data_builders.py          # Test Utilities/Data Builders — wallets, payloads, keys
  test_api_contract.py      # 1) API contract & shape
  test_happy_path.py        # A) happy path, cross-layer
  test_validation_failures.py # B) validation errors, DB-untouched proof
  test_insufficient_balance.py # C) business rejection
  test_idempotency.py       # D) idempotency (mandatory)
  test_concurrency.py       # E) concurrency (mandatory)
  test_persistence_audit.py # F) cross-record consistency
  test_component_interaction.py # G) outbox
```

**Why maintainable:** test scenarios never construct HTTP requests or SQL
directly — they call `api_client` / `db_helpers` / `data_builders`, so a
change to the transport (e.g., swapping `TestClient` for a real HTTP client
against a deployed instance) or schema only touches those three files, not
54 test functions. Every scenario file maps 1:1 to one of the assignment's
"Functional Expectations" categories, so coverage-vs-requirement is
traceable at a glance.

## 10. Known limitations

- SQLite + in-process locking stands in for real DB-level concurrency
  control (Section 6) — this is the single biggest thing to redo if this
  fixture were ever taken toward production.
- No real message broker; the outbox table is validated as a contract, not
  an end-to-end delivery.
- No multi-currency conversion, multi-instance deployment, or auth.
- Concurrency tests use a small, fixed number of threads (2–4) sufficient
  to reliably reproduce the races in question; this is not a load test and
  makes no throughput claims.
- The fixture's insufficient-balance and validation-error status codes
  (both `422`) are distinguished by response body (`status`/`failure_reason`
  vs `detail`) rather than by status code alone — documented here so it
  isn't mistaken for an inconsistency.

## 11. How to run

See `README.md`.
