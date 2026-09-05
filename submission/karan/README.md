# Subscription & Billing Service — SDET Assignment

## Deliberate stack choice

The brief expects TypeScript, but this submission uses **Python 3.12, FastAPI, SQLAlchemy, SQLite, and pytest**. This is a deliberate choice: it keeps the executable fixture and the verification suite compact while preserving the assignment's focus on stateful workflow correctness, persistence assertions, and a mockable provider boundary. It is not intended to claim Python is a required production stack.

## Strategy and scope

No implementation was supplied, so this repository uses the permitted minimal service-fixture approach. The implemented scope covers:

`POST /subscriptions` → plan-specific billing behavior → SQLite records → signed provider webhooks → valid lifecycle transitions → audit records.

The tests assert API-visible state, repository-observed persistence, and provider call arguments. They use fresh in-memory SQLite databases and a fresh mock provider per test.

### Plan-specific behavior

The fixture intentionally gives the two plans different behavior rather than only different prices:

| Plan | Price | Trial | Creation behavior |
|---|---:|---:|---|
| `basic` | $29.00 | 7 days | Starts `trialing`; no provider charge is made at creation |
| `pro` | $49.00 | none | Starts `trialing` and creates an immediate billing attempt |

For a trial plan, the minimal fixture does not implement a scheduler. `SubscriptionService.start_trial_billing()` represents the billing operation performed when the trial ends: it creates the first invoice and calls the provider, while the signed webhook remains the source of truth for payment finalization and the lifecycle transition. This keeps the fixture focused on billing correctness without introducing a separate scheduler subsystem.

### API and workflow boundary

The fixture deliberately exposes only the assignment's core endpoints: creation, retrieval, cancellation, and signed provider webhooks. A creation request validates the customer, plan, and payment method before any billing side effect. Non-trial creation invokes the injected provider; trial creation waits until the trial-end billing operation. Webhooks are authenticated over their raw body, validated against the referenced invoice amount/currency, and persisted exactly once by `event_id`.

The service owns transaction boundaries and orchestration; the repository owns persistence access; the API layer maps expected validation and transition failures to HTTP responses. Tests interact through a typed API client and repository/assertion helpers rather than inline HTTP or SQL.

### What is real vs mocked

- **Real:** FastAPI request handling, HMAC validation, SQLite persistence, state machine, repositories, and service orchestration.
- **Mocked:** the outbound payment provider, behind a protocol and injected into `SubscriptionService`. Its call history is asserted.

### Patterns used

- **Explicit state-machine table:** the only place lifecycle transitions are declared; invalid transitions raise an error.
- **Repository:** keeps SQLAlchemy data access out of routes and tests.
- **Provider interface / dependency injection:** replaces network billing with a controllable provider double.
- **Builder (tests):** makes subscription requests, invoices, and signed webhook inputs intention-revealing.

### Persisted entities and current invariants

The fixture persists customers, subscriptions, invoices, payments, webhook events, and audit events. It proves that a subscription becomes active only with a persisted successful payment; cancellation is terminal; duplicate deliveries have one business effect; and API-visible state agrees with persistence and audit history.

The lifecycle suite exercises every documented transition. The webhook suite additionally covers forged signatures, malformed invoice values, retries, duplicate delivery, out-of-order failure after success, refunds, and terminal cancellation.

### Assumptions and known limitations

- Plan catalogue is static configuration rather than a plan-management table.
- Trial duration is represented in plan configuration; the minimal fixture does not implement wall-clock trial expiration or a scheduler. The explicit `start_trial_billing()` operation models the billing action at trial end.
- `payment.refunded` is recorded as a webhook/audit event without inventing an undefined subscription transition.
- Plan changes, proration, and a production provider adapter are deliberately out of scope for this minimal fixture.
- Concurrent webhook delivery is out of scope (bonus in the brief).

### Coverage

See [`docs/coverage-matrix.md`](docs/coverage-matrix.md) for the concise scenario-to-requirement map.

## Run

```powershell
python -m venv .venv
cd submission\karan && .venv\Scripts\activate
python -m pip install -r requirements.txt
python -m pytest
```
