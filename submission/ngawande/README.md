# Wallet Transfer Service — SDET Test Suite

## Overview

Automated test suite for a Wallet Transfer Service, validating behavior across
API, database, business workflow, and cross-component layers.

**Stack:** Python 3.11 + pytest + Flask + SQLite (in-memory)

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run all tests
pytest -v

# 3. Run reliability / concurrency tests only
pytest -v -m reliability

# 4. Validate database schema
python scripts/validate_schema.py

# 5. Lint checks
pip install ruff black
black --check .
ruff check .
```

## Project Structure

```
submission/ngawande/
├── UNDERSTANDING_AND_APPROACH.md   # Test strategy document
├── README.md                       # This file
├── requirements.txt                # Python dependencies
├── pyproject.toml                  # pytest, ruff, black config
├── service/
│   ├── __init__.py
│   └── app.py                      # Minimal wallet transfer service fixture
├── scripts/
│   └── validate_schema.py          # DB schema validation script
└── tests/
    ├── conftest.py                  # Shared fixtures (app, client, seeded wallets)
    ├── helpers/
    │   ├── __init__.py
    │   ├── api_client.py            # API call wrapper
    │   ├── db_helpers.py            # Direct DB query helpers
    │   └── builders.py              # Test data factories
    ├── test_happy_path.py           # Successful transfer (multi-layer)
    ├── test_validation.py           # Input rejection + no side effects
    ├── test_insufficient_balance.py # Balance guard + no mutation
    ├── test_idempotency.py          # Duplicate submission semantics
    ├── test_concurrency.py          # Threaded race/retry tests
    ├── test_persistence.py          # API-to-DB consistency
    └── test_cross_component.py      # Audit + outbox verification
```

## Test Categories

| File | Category | Marker | Count |
|---|---|---|---|
| `test_happy_path.py` | Happy path transfer | — | ~9 |
| `test_validation.py` | Validation failures | — | ~10 |
| `test_insufficient_balance.py` | Insufficient balance | — | ~7 |
| `test_idempotency.py` | Idempotency / duplicates | reliability | ~7 |
| `test_concurrency.py` | Concurrency / race conditions | reliability | ~3 |
| `test_persistence.py` | Persistence & auditability | — | ~5 |
| `test_cross_component.py` | Cross-component validation | — | ~5 |

## Design Decisions

- **In-memory SQLite** per test for complete isolation — no cleanup needed.
- **Flask test_client()** for in-process API calls — no server startup required.
- **Real service, no mocks** — higher confidence in end-to-end behavior.
- **Helpers layer** separates transport, DB queries, and data building from test logic.
- **`@pytest.mark.reliability`** on concurrency/idempotency tests for CI gate separation.

## Assumptions

See [UNDERSTANDING_AND_APPROACH.md](./UNDERSTANDING_AND_APPROACH.md) for full details.

