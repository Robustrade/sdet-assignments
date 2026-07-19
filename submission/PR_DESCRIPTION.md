# Wallet Transfer Service — Automated Test Solution

## Summary

Since no service implementation was provided, I built a minimal Wallet
Transfer Service fixture (FastAPI + SQLAlchemy + SQLite) alongside the test
suite, scoped only to the behaviors the assignment calls out. Full
reasoning is in `docs/TEST_STRATEGY.md` — this description summarizes the
required points.

## Test strategy

- **Levels covered:** API contract, business workflow/invariants, database
  persistence, concurrency, and one cross-component boundary (outbox).
- **In scope:** idempotency, balance invariants, audit trail, exactly-once
  outbox writes, concurrent competing transfers.
- **Out of scope:** UI, load/performance testing, auth, multi-currency FX,
  a real message broker, multi-instance deployment.
- **Real vs. stubbed:** the API, database, idempotency store, and audit log
  are real and exercised end-to-end. The outbox *table* is real and
  transactionally consistent with the transfer; there is no real message
  broker downstream of it — tests validate the contract a publisher would
  depend on (exactly-once rows), not actual delivery. Full breakdown in
  Section 3 of the strategy doc.

## API validation approach

Request/response shape and status codes are asserted directly
(`test_api_contract.py`). Duplicate/error behavior is asserted both at the
API layer (status codes: `201` success, `422` rejection/validation, `409`
idempotency conflict, `404` unknown resource, `400` malformed idempotency
key) and cross-checked against persisted state so a "correct-looking"
response can't mask a DB-side bug.

## Database validation approach

Tables checked: `wallets`, `transfers`, `idempotency_keys`,
`transfer_events`, `outbox_events`. Key invariants: balance moves exactly
once per successful transfer and never on a rejected one, total balance
across both wallets is conserved, exactly one transfer row per idempotency
key regardless of retry count, audit events are ordered and never
contradict the transfer's final status. Every test resets the schema first
and re-queries the DB directly (never trusts cached ORM state) to avoid
false positives from stale data — details in Section 5 of the strategy doc.

## Cross-component validation

The outbox table stands in for "downstream/adjacent component" per the
assignment's guidance that not every surrounding system needs to be fully
implemented. Verified: a row is written for both completed and rejected
transfers, exactly once, with a DB-level `UNIQUE(transfer_id, event_type)`
constraint as defense-in-depth against duplicates — not just an app-logic
promise.

## Concurrency and reliability coverage

Covered: two concurrent transfers competing for balance that can only
satisfy one of them (exactly one must win, balance must never go
negative), concurrent duplicate requests with the same idempotency key
collapsing to a single transfer, concurrent transfers on unrelated wallets
proceeding independently, and read-after-write consistency following a
concurrent burst. These tests give confidence the service's idempotency
and balance-locking logic hold up under genuine thread-level races, using
real threads against the same in-process app and DB — not simulated or
mocked concurrency. They do **not** give confidence about multi-process or
multi-instance deployment, since the fixture's locking is in-process by
necessity (SQLite constraint, documented in Section 6 of the strategy doc).

## Test architecture

Layered: `api_client.py` (transport), `db_helpers.py` (verification),
`data_builders.py` (test data), and one scenario file per functional
category from the assignment. Scenario tests never touch HTTP or SQL
directly, so the suite stays readable and a transport/schema change is a
one-file edit, not a 54-test rewrite. Details and full file layout in
Section 9 of the strategy doc.

## Responsible AI usage

I used Claude (Anthropic) to build this solution, including the service
fixture, the full test suite, and this documentation, given the assignment
explicitly permits AI assistance.

- **Where it helped:** generating the fixture and test code across all
  required categories, structuring the layered test architecture, and
  writing the strategy documentation.
- **What I reviewed/validated:** I ran the full suite repeatedly (~25
  consecutive runs) specifically to check the mandatory concurrency tests
  for flakiness rather than trusting a single green run. That process
  surfaced a real intermittent bug — SQLite connection attribute expiry
  causing a background thread to trigger an unsafe lazy DB reload outside
  the write lock — which was fixed by setting `expire_on_commit=False`,
  documented in `app/db.py` and Section 8 of the strategy doc. I reviewed
  the invariants each test asserts against the assignment's stated
  requirements to confirm coverage of every mandatory category
  (idempotency, concurrency) and cross-checked the API/DB status-code
  distinctions (validation error vs. business rejection) for consistency.

I'm being candid that AI did the initial generation; the verification pass
(repeated concurrency runs, bug fix, requirement-to-test traceability
check) is what I'd stand behind as the actual QA judgment applied here.

## How to run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -v
```

54 tests, all passing. See `README.md` for more.
