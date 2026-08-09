# Wallet Transfer Service — SDET Automation Suite

Submission for the Kulu SDET take-home. The deliverable is the automated
**validation suite**; the small Flask service in `service/` is a test fixture
that exists so the suite has a real, persistence-backed system to assert
against.

---

## TL;DR — what's here

```
solution-piyush-k-jain/
├── service/                       # SUT (test fixture) — minimal Flask app
│   ├── app.py                     # routes + state machine + side effects
│   ├── db.py                      # schema for 5 tables
│   └── outbox.py                  # stub publisher + notification recorder
├── scripts/
│   └── validate_schema.py         # CI: db-migration-or-schema-check
├── tests/
│   ├── conftest.py                # fresh app + seeded wallets per test
│   ├── support/                   # API client, DB verifier, builders, schemas, invariants
│   ├── api/                       # API contract & validation layer
│   ├── workflow/                  # lifecycle & idempotency semantics
│   ├── persistence/               # DB row & balance assertions
│   ├── cross_component/           # outbox / failure DLQ / notifications
│   └── reliability/               # @pytest.mark.reliability — concurrency & retry
├── requirements.txt
├── pyproject.toml
└── README.md  (this file)
```

---

## How to run

From inside this folder:

```bash
pip install -r requirements.txt

# Full suite
pytest -q

# Reliability / concurrency subset only
pytest -q -m reliability

# Schema validation (matches the CI job)
python scripts/validate_schema.py

# Lint (matches CI)
ruff check .
black --check .
```

No external services, no Docker, no network. Everything runs in-process with
SQLite-in-memory (a fresh DB per test).

---

## Test strategy

### Layers covered (1:1 with the assignment's "Required Validation Depth")

| Layer | Folder | Asserts |
|---|---|---|
| 1. API | `tests/api/` | status codes, response shape (jsonschema), validation errors, contract |
| 2. Business workflow | `tests/workflow/` | `pending → completed/failed` transitions, idempotency semantics |
| 3. Database | `tests/persistence/` | `transfers`, `wallets`, `idempotency_keys`, `transfer_events` rows |
| 4. Cross-component | `tests/cross_component/` | outbox exactly-once, failure DLQ-equivalent, notification trigger |
| (Mandatory) Reliability | `tests/reliability/` | concurrent transfers, concurrent same-key dedup, retry storms |

### Architecture (1:1 with the assignment's "Architecture Expectations")

| Expectation | File |
|---|---|
| Fixtures / Environment Setup | `tests/conftest.py` |
| API Client / Test Interface | `tests/support/api_client.py` |
| Assertion / Verification | `tests/support/db_verifier.py`, `tests/support/invariants.py`, `tests/support/schemas.py` |
| Scenarios / Specifications | `tests/api/`, `tests/workflow/`, `tests/persistence/`, `tests/cross_component/`, `tests/reliability/` |
| Utilities / Data Builders | `tests/support/builders.py` |

---

## What is real vs stubbed

| Component | Real / Stubbed | Why |
|---|---|---|
| Flask service routes | Real | The SUT |
| SQLite database (5 tables) | Real | Assertions need real persistence |
| Atomic state machine | Real | The invariant we're testing |
| Idempotency store (`idempotency_keys`) | Real | A real dedicated table, not just a column |
| Outbox table (`outbox_events`) | Real | Durable outbox pattern row |
| Outbox publisher | **Stubbed** (`StubPublisher`) | In-process list — proves exactly-once without Kafka |
| Notification trigger | **Stubbed** (`NotificationRecorder`) | Proves exactly-once trigger without an HTTP downstream |
| Async worker / background job | Skipped (sync state machine instead) | Same coverage in less time |
| Failure injection | `?force_fail=true` query param (test-only hook) | Lets us assert the failure path without a chaos harness |

The `?force_fail=true` query parameter is the only test-only seam in
`service/app.py`. It is documented at the top of the file and would not exist
in a production deployment of this service.

---

## Validation invariants asserted

- Source wallet balance decreases exactly once per success
- Destination wallet balance increases exactly once per success
- Total balance is conserved across the two wallets
- Rejected (422) requests leave the DB completely untouched
- Failed (in-flight) transfers persist a `failed` row + audit, but do not move money or emit events
- Same idempotency key + same payload → byte-equal replay body, single transfer, single outbox event, single notification
- Same idempotency key + different payload → 409, no second transfer
- Concurrent same-key requests → exactly one first-writer 201, others 200 or 409
- Internal fields (e.g., `payload_hash`) never appear in API responses

---

## Concurrency & idempotency strategy

- **Service**: a module-level `threading.Lock()` serializes the
  read-then-write section that decides idempotency + balance + state machine
  transitions. SQLite is in WAL mode for concurrent reads. The
  `CHECK(balance >= 0)` constraint is a belt-and-braces backstop.
- **Tests**: spawn 5–10 threads each with their own `app.test_client()` and a
  shared `app.db`, then assert post-conditions. Tests are deterministic in
  *outcome* (counts, totals) even though arrival order is non-deterministic.

---

## Test count summary

| Folder | Files | Approx. tests |
|---|---|---|
| `tests/api/` | 4 | ~40 |
| `tests/workflow/` | 2 | ~14 |
| `tests/persistence/` | 4 | ~17 |
| `tests/cross_component/` | 3 | ~17 |
| `tests/reliability/` | 3 | ~7 (each exercises many code paths under load) |

---

## Known limitations / things deliberately out of scope

- **No real message broker.** The outbox publisher is in-process. We assert
  exactly-once via row count + publisher count. Adding Kafka/RabbitMQ via
  Testcontainers would not strengthen the invariants we care about.
- **No real async worker.** The state machine is synchronous (pending →
  terminal within the same request). True async would add flake and start-up
  time without changing what we can prove.
- **No OpenAPI spec.** Contract is pinned by JSON Schemas in
  `tests/support/schemas.py`. Adding `schemathesis` or `pact-python` would
  burn the time budget without strengthening the most important invariants.
- **No multi-currency conversion.** Transfers must match wallet currency on
  both sides; FX is out of scope per the brief.
- **No auth/JWT.** Out of scope per the brief.
- **SQLite, not Postgres.** Same correctness signal for the invariants we
  test; would be a swap if integrating with a real deployment.

---

## Responsible AI usage

This solution was built with assistance from an AI coding agent (Claude).
What the AI helped with:

- proposing the layered test architecture (API client / DB verifier /
  invariants / builders / schemas)
- drafting the initial Flask state machine and the outbox/notification stubs
- generating the boilerplate of test files

What I reviewed and decided personally:

- the scope split between real components (DB, state machine) and stubs
  (publisher, notification, fault injection)
- which assignment requirements map to which test files
- the four architectural tradeoffs (sync state machine, SQLite, stub
  publisher, test-only fail hook) and their tradeoffs documented above
- the choice not to introduce Pact / schemathesis / Playwright / Postgres /
  async workers — each was considered and ruled out as scope-creep that
  would have stolen time from the rubric's higher-weighted areas
  (idempotency depth, concurrency, persistence)
- every assertion's intent (each test name is mine)
- the exact set of invariants documented above

If a reviewer wants to discuss any specific test or design choice, every
file has a docstring explaining its intent.
