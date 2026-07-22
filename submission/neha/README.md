# Wallet Transfer Service — SDET Automation Suite

Automated validation for a wallet transfer workflow across **API**, **persistence**, and **cross-component** (audit + outbox) layers.

## Approach

- **Option 2/3 hybrid**: a minimal Flask + SQLite service fixture under `service/`
- Real local persistence for wallets, transfers, idempotency keys, audit events, and outbox events
- No external broker; outbox rows model publish-once side effects

See [TEST_STRATEGY.md](./TEST_STRATEGY.md) for scope, invariants, and limitations.

## Project layout

```text
service/                 # minimal transfer API + SQLite schema
scripts/validate_schema.py
tests/
  helpers/               # API client, builders, DB assertions
  test_happy_path.py
  test_validation.py
  test_insufficient_balance.py
  test_idempotency.py
  test_reliability.py    # marked @pytest.mark.reliability
  test_cross_component.py
```

## Setup

Requires Python 3.11+ (CI uses 3.11; 3.9+ works locally).

```bash
cd submission/neha
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install ruff black   # for local lint parity with CI
```

## Run checks (same intent as CI)

```bash
# schema
python scripts/validate_schema.py

# full suite
pytest -q

# reliability / concurrency only
pytest -q -m reliability

# lint / format
ruff check .
black --check .
```

## Seed data

Each test gets a fresh in-memory database seeded with:

| Wallet ID   | Balance | Currency |
|-------------|---------|----------|
| wallet_001  | 10000   | AED      |
| wallet_002  | 5000    | AED      |
| wallet_003  | 0       | AED      |

## API surface exercised

- `POST /transfers` (optional `Idempotency-Key` header)
- `GET /transfers/{transfer_id}`
- `GET /wallets/{wallet_id}`
