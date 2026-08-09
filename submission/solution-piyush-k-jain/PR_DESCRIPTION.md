# Wallet Transfer Service — SDET Automation Suite

> Paste the body below into the PR description when opening the pull request.
> Drop this file from the final commit if you prefer.

## Summary

Adds a multi-layer SDET automation suite for a Wallet Transfer Service under
`submission/solution-piyush-k-jain/`. The deliverable is the test suite; the
small Flask service is a fixture so the suite has a real, persistence-backed
system to assert against. SQLite (in-memory), no Docker, no network.

## Test Strategy

- **Levels covered**: API, business workflow, database/persistence,
  cross-component (outbox + failure DLQ + notification), reliability
  (concurrency + retry).
- **In scope**: every requirement in `SDET_ASSIGNMENT.md` §A through §G,
  including mandatory §D (idempotency) and §E (concurrency).
- **Out of scope**: real broker (Kafka), real async worker, OpenAPI/Pact,
  multi-currency FX, auth — all documented in `README.md` "Known limitations".
- **Real vs stubbed**:
  - Real: Flask routes, SQLite DB (5 tables), state machine
    (`pending → completed/failed`), idempotency dedup, outbox row.
  - Stubbed: outbox publisher (`StubPublisher` in-process list),
    notification trigger (`NotificationRecorder`), failure injection
    (`?force_fail=true` test-only hook).

## API Validation Approach

- A thin `TransferClient` wraps the Flask test client so tests never touch
  HTTP plumbing.
- Response **shape** is pinned with JSON Schemas in
  `tests/support/schemas.py` (`additionalProperties: False` so internal
  fields like `payload_hash` can never silently leak to the API surface).
- Response **behavior** is asserted directly: status codes, byte-equal
  idempotent replay bodies, error envelope format.
- Validation failure scenarios: missing fields, invalid currency, non-positive
  amount, non-integer amount, same source/destination, unknown wallet,
  currency mismatch — each one verified to leave the DB untouched.
- Duplicate behavior: same key + same payload returns 200 with the original
  body; same key + different payload returns 409. Both verified against the
  schema and against persistence.

## Database Validation Approach

- Five tables checked: `wallets`, `transfers`, `idempotency_keys`,
  `transfer_events`, `outbox_events`.
- A `DbVerifier` helper exposes intent-revealing queries (`transfer()`,
  `wallet_balance()`, `outbox_rows_for()`, etc.); tests never write raw SQL.
- Invariants asserted (see `tests/support/invariants.py`):
  - `assert_exactly_one_debit` / `assert_exactly_one_credit`
  - `assert_balance_conserved` across both wallets
  - `assert_no_balance_movement` on rejected/failed flows
  - `assert_single_transfer_row`, `assert_no_transfer_rows`
  - `assert_audit_event_types` for full lifecycle traces
- Data seeding: `conftest.py` builds a fresh in-memory app + four seeded
  wallets per test. Zero state leakage between tests by construction.

## Cross-Component Validation

Three side-effect surfaces verified:

1. **Outbox** (`tests/cross_component/test_outbox_emission.py`): exactly one
   `outbox_events` row per successful transfer, `published=1` set only after
   the stub publisher recorded the call. No emission on failed or rejected
   transfers. Replays do not re-emit.
2. **Failure DLQ-equivalent** (`tests/cross_component/test_failure_dlq.py`):
   failed transfers persist as `status='failed'` with a `transfer_failed`
   audit row, queryable after the fact. No business event emitted. Replays
   stay failed (no silent "retry success" bug).
3. **Notification** (`tests/cross_component/test_notification.py`): the
   `NotificationRecorder` is called exactly once per success, never on
   failure or rejection, never re-called on replay.

## Reliability / Concurrency Coverage

All marked `@pytest.mark.reliability` so they run under the dedicated CI job.

- **Competing transfers** (`test_concurrent_transfers.py`): 5 concurrent
  3000-AED transfers from a 10000 balance → at most 3 succeed, balance never
  goes negative, balance conservation holds across both wallets.
- **Concurrent same-key dedup** (`test_concurrent_idempotency.py`): 10
  concurrent requests with the same idempotency key → exactly one `201`,
  rest are `200` replays, all share the same transfer id, exactly one row
  + one outbox emission + one notification.
- **Concurrent same-key / different payload race**: 5 concurrent requests
  with the same key but different payloads → exactly one `201`, four `409`,
  one transfer row.
- **Retry storm** (`test_retry_storm.py`): 5 sequential retries of the same
  request settle to one debit / one event / one notification.
- **Retry storm of a failed transfer**: 5 retries all return `failed`, no
  silent recovery.

Confidence these tests provide: any code change that breaks exactly-once
semantics — double debit, double event emission, missed audit row, lost
idempotency on race, or silent retry-success on a failure — fails the suite.

## Test Architecture

```
tests/
├── conftest.py            ── seeded app + DB + side-effect fixtures
├── support/               ── reusable plumbing (no test bodies here)
│   ├── api_client.py      ── HTTP details live here, not in tests
│   ├── db_verifier.py     ── domain queries, parameterized SQL only
│   ├── builders.py        ── fluent payload + key builders
│   ├── invariants.py      ── high-level domain assertions
│   └── schemas.py         ── JSON Schemas + assert_matches helper
└── <layer>/test_*.py      ── scenarios read as business behavior
```

This is the structure the assignment's "Architecture Expectations" section
asks for, applied 1:1.

## Validation

Commands run locally before submitting (all exit 0):

```bash
ruff check .
black --check .
python scripts/validate_schema.py
pytest -q
pytest -q -m reliability
bandit -r service
```

## Known Limitations / Next Steps

- No real broker / no async worker — see README "Known limitations" for
  rationale.
- Contract testing is JSON-Schema-based, not Pact/schemathesis (deliberate
  scope decision).
- SQLite, not Postgres (deliberate — same correctness signal for the
  invariants we test).

## Responsible AI Usage

Yes, AI assistance was used.

- **Where it helped**: proposing the layered architecture, drafting the
  Flask state machine + outbox/notification stubs, generating test
  boilerplate, formatting documentation.
- **What I personally reviewed, decided, and validated**:
  - scope split between real and stubbed components
  - the four architectural tradeoffs (sync state machine, SQLite, stub
    publisher, test-only fail hook) and the rationale documented in README
  - mapping of each assignment requirement to a test file
  - choice to *not* introduce Pact / schemathesis / Playwright / Postgres /
    async workers — each considered and ruled out as scope-creep relative
    to the time budget
  - every assertion's intent and every test name
  - the exact set of invariants asserted

## Author Checklist

- [x] Linting passes locally (`ruff check .` and `black --check .`)
- [x] Test suite passes locally (`pytest -q`)
- [x] Schema/setup validation passes (`python scripts/validate_schema.py`)
- [x] Reliability-focused tests pass (`pytest -q -m reliability`)
- [x] README/setup steps tested from a clean state
- [x] End-to-end transfer validation run locally
- [x] AI usage disclosed above
