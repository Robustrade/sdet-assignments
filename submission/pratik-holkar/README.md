# Wallet Transfer - SDET Test Framework

A pytest framework for validating the wallet transfer service end to end:
API contract, persistence, double-entry ledger, idempotency, and concurrency.
Test data lives in YAML so adding a scenario is usually a YAML edit, not a
code change.

The system under test is a small Flask + SQLite app under `service/`. It is
intentionally not the toy fixture from the reference candidate folder; the
schema is different (separate `idempotency_keys`, a `ledger_entries`
double-entry table, explicit transfer states) and concurrency is handled by
real SQLite `BEGIN IMMEDIATE` locking with retry, not a Python mutex.

## Layout

```
submission/pratik-holkar/
  service/             Flask + SQLite SUT
  scripts/             schema gate for CI
  config/              env-specific .properties, no secrets in repo
  utilities/           api_client, db_client, soft_assert, step log, yaml loader
  plugins/             pytest plugin + Jinja2 HTML report template
  testcases/           YAML scenarios (feature-file analogue)
  step_definitions/    pytest functions that consume testcases/ (step defs)
  conftest.py          registers the report plugin
  requirements.txt
  pyproject.toml
  .gitlab-ci.yml
```

BDD analogy: `testcases/*.yaml` are the scenarios (like `*.feature` files);
`step_definitions/*.py` are the pytest functions that execute them (like
step-definition methods).

## Run it

### Windows PowerShell

```powershell
cd submission\pratik-holkar
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest -q
```

If `Activate.ps1` errors with an execution-policy message, either run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or skip
activation entirely and call the venv Python directly:

```powershell
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m pytest -q
```

### macOS / Linux / Git Bash

```bash
cd submission/pratik-holkar
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
```

Common commands:

```bash
# full suite, parallel (HTML report is written automatically)
pytest -n auto -q

# just the reliability / concurrency cases
pytest --incl_tests=reliability -q

# everything except reliability + property tests
pytest --excl_tests=reliability,property -q

# pin the report to a specific path (overrides the timestamped default)
pytest --html-report=reports/report.html -q

# skip report generation entirely
pytest --no-html-report -q

# switch env (same YAML runs against stg if base URL + token are set)
TEST_ENV=stg WALLET_STG_BASE_URL=https://wallet.stg.internal pytest -q

# schema gate (used by CI)
python scripts/validate_schema.py

# lint
ruff check . && black --check .
```

## Why these dependencies

Everything pinned in `requirements.txt`, and what each one is for.

| Library         | Why it is here                                                                                                                | Where it shows up                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `flask`         | Web framework that powers the SUT. Routing, request parsing, JSON responses, and the in-process test client used by tests.    | `service/app.py`, and the in-process branch of `utilities/api_client.py`                   |
| `pytest`        | The test runner itself. Fixtures, parametrize, markers, plugin hooks.                                                         | Everything in `step_definitions/`, `plugins/`, `conftest.py`                               |
| `pytest-xdist` | Parallel test execution via `pytest -n auto`. Splits the test items across CPU cores; each worker runs in its own process.    | Activated at runtime; the report plugin handles xdist worker-to-master serialisation       |
| `requests`      | HTTP client used when the framework points at a real environment (`TEST_ENV=stg|prd`, `use_inprocess_service=false`).         | The HTTP branch of `utilities/api_client.py`                                               |
| `PyYAML`        | Parses the YAML test-case files.                                                                                              | `utilities/data_loader.py`                                                                 |
| `Jinja2`        | Templating engine for the custom HTML report.                                                                                 | `plugins/report_plugin.py` renders `plugins/templates/report.html.j2`                      |
| `hypothesis`    | Property-based testing. Generates random inputs (lists of amounts, replay counts) so the invariants are checked across input space the hand-written YAML cannot cover. | `step_definitions/test_invariants.py` (balance conservation, idempotency replay safety)    |

### Version pinning convention

Every line uses `>=X.Y,<MAJOR+1`. For example, `flask>=2.2,<4.0` means
"accept any 2.x or 3.x release at or above 2.2, refuse 4.x." This lets
CI pick up patch / minor releases (bug fixes) without breaking on a
future major version that changes the API.

### Not in `requirements.txt` (intentional)

- `ruff` and `black` are linters used only in CI and local dev. They
  are installed by the CI pipeline directly (`pip install ruff black`)
  to keep the runtime dependency set small. Add them to a
  `requirements-dev.txt` if you prefer a single install command.
- No mocking library (no `mock`, `responses`, etc.). The framework
  tests against the real in-process Flask app rather than mocking the
  HTTP layer, so there is nothing to mock.
- No `sqlalchemy` or any ORM. Schema and queries are raw SQL in
  `service/app.py` and `utilities/db_client.py`; an ORM would obscure
  the locking and isolation behaviour we are specifically trying to
  test.

## HTML report

Every run writes a fresh HTML report. By default it goes to:

```
output/custom_report_<YYYYMMDD_HHMMSS>/report.html
```

(timestamp is local time). Each run gets its own folder so previous
reports are preserved. The absolute path is printed at the end of the
run inside a visible banner, for example:

```
==============================================================================
  HTML REPORT  (passed=25, failed=0, skipped=0, total=25)
  file://C:\...\output\custom_report_20260523_165143\report.html
  C:\...\output\custom_report_20260523_165143\report.html
==============================================================================
```

The first line is a clickable `file://` URL in most terminals; the
second is a plain path for copy-paste.

What is in the report:
- totals (passed / failed / error / skipped / pass rate)
- one row per test with tags and duration
- click any test to expand its per-step list (name, status, duration,
  details) plus the full failure traceback if it failed

Override options:
- `--html-report=<path>` writes to that exact path instead of the
  timestamped default. Used by CI to put the report at a stable
  artifact location.
- `--no-html-report` skips report generation entirely. Useful for
  iterating quickly.

The `output/` folder is not checked into git; add it to `.gitignore`
if you set up version control.

### Tags for `--incl_tests` / `--excl_tests`

| tag           | meaning                                              |
| ------------- | ---------------------------------------------------- |
| happy         | successful transfers                                 |
| validation    | bad-input rejections                                 |
| insufficient  | insufficient-balance rejections                      |
| idempotency   | replay + same-key/different-payload                  |
| reliability   | concurrency + retry storms                           |
| concurrency   | subset of reliability that spawns threads            |
| invariant     | properties that must hold for any valid sequence     |
| property      | hypothesis-driven property tests                     |
| api / db      | scenarios that assert API contract / persistence     |
| boundary      | edge-of-balance cases                                |

## What the framework gives you

1. **YAML-driven cases.** Each file in `testcases/` lists scenarios with
   `id`, `tags`, `request`, `expected`. The loader turns each into a
   `pytest.param` and registers tags as markers, so tag filters work
   without per-file wiring.

2. **Single transport-agnostic API client.** `utilities/api_client.py`
   wraps either the in-process Flask test client or real HTTP, so tests
   never touch `flask.test_client` or `requests` directly.

3. **DB client over the schema.** `utilities/db_client.py` exposes
   typed helpers (`balance`, `transfer_count`, `ledger_for_transfer`,
   `outbox_count`, `transfers_for_key`, etc.). Tests do not embed SQL.

4. **Soft assertions.** `utilities/soft_assert.py` collects every failure
   in a test and raises once at the end, so one test can report every
   broken invariant (API status + source balance + destination balance +
   ledger consistency + outbox count) instead of stopping at the first.

5. **Step recorder + HTML report.** `utilities/steps.py` plus the plugin
   in `plugins/report_plugin.py` produce a Jinja2 HTML report with per-step
   status, timing, details, totals, and tag visibility. Triggered by
   `--html-report=path`. Steps survive xdist worker-to-master serialisation.

6. **Tag filters via CLI.** `--incl_tests=tag1,tag2` and
   `--excl_tests=tag3` are added by the plugin. Tags come from YAML
   `tags:` (which become markers).

7. **Parallel execution via pytest-xdist.** `pytest -n auto`. Each test
   gets its own in-memory database (unique URI per app), so xdist
   workers do not collide.

8. **Env-agnostic config.** `config/<env>.properties` files use
   `${VAR:-default}` placeholders and resolve from `os.environ`.
   No credential ever lives in the repo. Switch env with `TEST_ENV`.

9. **Property-based invariants.** Hypothesis tests in
   `step_definitions/test_invariants.py` exercise random amounts and
   replay counts to check balance conservation and idempotency safety
   across input space the hand-written YAML cases do not cover.

## How the SUT handles concurrency

The service opens one SQLite connection per request against a shared
in-memory database (URI `file:<unique>?mode=memory&cache=shared`). The
write path:

```
BEGIN IMMEDIATE          # take RESERVED lock, retry on SQLITE_BUSY
  re-check balance
  update wallets
  insert transfer + ledger debit + ledger credit
  insert outbox row
  insert idempotency key   (UNIQUE - second writer hits IntegrityError)
COMMIT
```

This means the reliability tests in `step_definitions/test_reliability.py`
actually contend on a real lock. The "5 competing transfers of $150 from a
$500 wallet" case can produce 1, 2, or 3 successes depending on scheduling,
and the test asserts the *invariants* (final balance == start - successes *
amount, balance never negative, transfer rows == successes), not a specific
schedule.

## Invariants the suite asserts

- Source debited exactly once per successful transfer (across N replays
  with same idempotency key).
- Destination credited exactly once.
- Total balance across same-currency wallets is invariant
  (`test_invariants.py` Hypothesis test, random transfers).
- Every completed transfer writes exactly two ledger rows, one debit
  on the source and one credit on the destination, equal in amount,
  whose `balance_after_minor` matches the wallet row.
- `created_at <= completed_at` on every completed transfer.
- Exactly one row in `transfers`, `idempotency_keys`, and `outbox` per
  successful logical transfer, even under retries and contention.
- Rejected transfers (validation, insufficient balance, currency
  mismatch) leave zero rows in `transfers`, `ledger_entries`, `outbox`.

## What is real vs stubbed

Real: the Flask service, the SQLite database, the ledger and outbox
tables, all locking and retry logic. The same YAML runs against a real
HTTP endpoint when `TEST_ENV=stg|prd` and `use_inprocess_service=false`.

Stubbed: there is no actual message broker. The `outbox` table is the
boundary, and "exactly-once emission" is asserted as "exactly one outbox
row, never marked published twice." Producing the row in the same
transaction as the wallet update is the standard transactional outbox
pattern.

Out of scope: dead-letter queues, downstream consumers, FX, KYC, fees.

## CI

`.gitlab-ci.yml` runs four stages: `lint`, `schema`, `test`, `reliability`.
The existing GitHub Actions workflow in `.github/workflows/` already
auto-detects this candidate folder and runs `pytest -q` + the schema
validator against it; the lint job runs `ruff check` + `black --check`.

For the one design decision behind the SUT (single-transaction outbox +
ledger + idempotency under `BEGIN IMMEDIATE`), see `ARCHITECTURE.md`.

For a plain-English walk-through of the assignment brief (what the
reviewers are actually looking for, what each invariant means, common
interview questions), see `ASSIGNMENT_GUIDE.md`.

For a file-by-file walk-through of this framework (how a YAML scenario
becomes a passing test, soft-assert internals, plugin hooks, etc.), see
`FRAMEWORK_GUIDE.md`.

## Known limitations

- The remote-env path (`use_inprocess_service=false`) skips the `db`
  fixture, because real envs need a configured DB connector. Pure API
  cases still run, balance-level invariants do not.
- SQLite in-memory shared cache is per-process. xdist parallelism still
  works because each test gets a unique URI, but you cannot inspect the
  DB from outside the test process.
- Reliability tests use threads, not processes. Cross-process testing
  would need a file-backed DB or a real backend.
