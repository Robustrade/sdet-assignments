# Subscription & Billing Service — Test Solution (Python / pytest)

Automated test suite for a Subscription & Billing Service, plus a minimal
in-process service fixture built to exercise it (no service was provided, and
this repo is otherwise TypeScript-first — see `STRATEGY.md` for why this
submission is Python instead, and the full test/design strategy).

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run the tests

```bash
pytest -q
```

Run a specific category via markers (`state_machine`, `webhook`, `persistence`,
`provider`):

```bash
pytest -m webhook -q
```

No external services, database, or network access required — everything runs
in-process against an in-memory SQLite database created fresh per test.

## Layout

```
service/            minimal Subscription & Billing fixture under test

api/                API Page-Object-Model layer (reusable across all tests)
  client.py           HttpClient - the one place that knows HTTP verbs/paths
  endpoints/           SubscriptionsEndpoint, WebhooksEndpoint - one object per resource
  runner.py            ApiRunner - turns a data/*.py case into a request + validates it

db/                 reusable DB-assertion helpers built on service/repository.py
  queries.py

utils/              non-test-specific helpers (not a test module themselves)
  builders.py          test data builders (SubscriptionRequestBuilder, WebhookPayloadBuilder, CustomerBuilder)
  fake_payment_provider.py   mock payment provider test double

data/               schema only: dataclasses describing the shape of a case
  subscription_cases.py, webhook_cases.py, provider_cases.py, state_transitions.py

tests/              the pytest suite itself, grouped by module
  conftest.py          fixtures wiring the above together (db_conn, api, runner, ...)
  api/                 API-level tests (validation, state machine, webhooks, provider, e2e)
    vars/                JSON test data, one file per test class, named after the class
  db/                  DB/persistence-level tests
    vars/                JSON test data for DB-level test classes (currently unused, same convention)

ui_bonus/           optional Playwright + Page-Object-Model UI demo (not graded, see its README)

STRATEGY.md          test strategy, architecture, design patterns, assumptions, limitations
INTERVIEW_PREP.md    one-time reference doc: what's implemented and why, interview Q&A
```
