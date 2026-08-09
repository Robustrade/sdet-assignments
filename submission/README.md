# Wallet Transfer Service — Automated Test Solution

An automated validation suite for a wallet transfer system, covering API,
business workflow, database, concurrency, and cross-component (outbox)
correctness — built together with a minimal service fixture since no
service implementation was provided for this assignment.

See **[docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md)** for the full test
strategy: scope, what's real vs. stubbed, invariants asserted, concurrency
approach and its limits, and known tradeoffs. Read that first.

## Requirements

- Python 3.11+

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Running the tests

```bash
pytest -v
```

No external database is required — each test run creates and tears down
its own local SQLite file (`wallet_transfer_test.db`) automatically; every
individual test resets the schema before it runs (see `clean_db` fixture in
`tests/conftest.py`), so tests are isolated from each other and safe to run
in any order.

Run a single category, e.g. concurrency:

```bash
pytest tests/test_concurrency.py -v
```

Run the concurrency suite repeatedly to convince yourself it's not flaky
(recommended — that's how a real bug in the fixture's SQLite handling was
caught during development, see Section 8 of the test strategy doc):

```bash
for i in $(seq 1 20); do pytest -q || break; done
```

## Project layout

```
app/            minimal Wallet Transfer Service fixture (system under test)
tests/          automated test suite (54 tests across 7 scenario files)
docs/           test strategy documentation
```

## Test count by category

| File | Category |
|---|---|
| `test_api_contract.py` | API contract & response shape |
| `test_happy_path.py` | Happy path, cross-layer (API → DB → audit → outbox) |
| `test_validation_failures.py` | Request validation errors |
| `test_insufficient_balance.py` | Business rejection (insufficient balance) |
| `test_idempotency.py` | Idempotency / duplicate submission (mandatory) |
| `test_concurrency.py` | Concurrency / race conditions (mandatory) |
| `test_persistence_audit.py` | Cross-record persistence consistency |
| `test_component_interaction.py` | Outbox / downstream-component contract |
