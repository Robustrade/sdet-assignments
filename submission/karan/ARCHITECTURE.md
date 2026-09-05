# Architecture

## Structure

```text
app/
  api/routes.py                       HTTP request and response handling
  domain/models.py                    ORM entities and plan catalogue
  domain/states.py                    lifecycle values and transition error
  domain/state_machine.py             explicit legal-transition table
  services/subscription_service.py    workflow orchestration and transactions
  providers/                          provider protocol and mock implementation
  repositories/                       entity-specific persistence access
  database.py                         schema setup and repository composition
tests/
  framework/                          reusable builders, API client, assertions
  scenarios/                          business-facing specifications
  conftest.py                         isolated database and dependency wiring
docs/
  test-strategy.md                    test strategy entry point
  coverage-matrix.md                  concise assignment coverage map
```

## Dependency direction

`tests/scenarios → tests/framework → app/api → app/services → app/domain + app/repositories + app/providers`

Routes only translate HTTP concerns. The service coordinates the state machine, repositories, and provider abstraction. Individual repositories contain persistence queries; scenario tests do not access SQLAlchemy directly.

`tests/framework` is reusable automation infrastructure. It contains the data builders, typed HTTP client, and persistence assertion helper. `tests/scenarios` contains behavior-facing tests.

## Patterns and design rationale

### Explicit state machine

`SubscriptionStateMachine` is the exclusive definition of legal lifecycle transitions. An explicit transition table is used instead of a class-per-state hierarchy because the domain has four states and a small, fixed transition set. The table gives structural rejection of invalid transitions without adding unnecessary indirection.

### Repository

Separate repositories isolate subscription, invoice, payment, webhook, and audit persistence. This keeps SQLAlchemy details out of routes and scenario tests and gives the assertion layer a stable way to inspect persisted state.

### Provider abstraction / dependency injection

`PaymentProvider` is a protocol injected into `SubscriptionService`. Tests use `MockPaymentProvider`, which records every `ChargeRequest`. This makes provider behavior deterministic and lets tests assert exact amount, customer, payment method, and idempotency key without making network calls.

### Builders

Builders are used in the test framework where setup contains repeated structured data or signing rules. They keep scenario intent visible while centralizing construction details such as webhook HMAC signing.

## Billing workflow decisions

The two plans intentionally have different behavior:

- `basic`: 7-day trial; creation only persists the `trialing` subscription. No provider charge is made until the trial-end billing operation.
- `pro`: no trial; creation starts an immediate billing attempt.

For trial-end and retry billing, the provider call creates a durable pending invoice, but does **not** finalize the payment or subscription state. A signed provider webhook performs finalization. This separation models the asynchronous boundary explicitly and prevents `retry_payment()` from claiming success merely because a provider call returned successfully.

Creation of a non-trial plan retains the simpler synchronous handling already present in the minimal fixture: a direct provider decline records a failed payment and moves the subscription to `past_due`; a pending/timeout result remains pending for webhook completion.

## Persistence and idempotency invariants

The fixture persists customers, subscriptions, invoices, payments, webhook events, and audit events. Key invariants are:

- `active` requires a persisted successful payment.
- A duplicate `event_id` has no second business effect.
- A late failure for an already-paid invoice cannot regress the subscription.
- Cancellation is terminal; later payment/refund webhooks cannot reactivate it.
- API-visible subscription state agrees with the persisted subscription row.
- Provider idempotency keys are invoice IDs, so each real billing attempt has a distinct reference.

## Deliberate deviations and scope

Python is used instead of the brief's expected TypeScript stack; the rationale is recorded in `README.md`. This is a minimal fixture, so there is no production scheduler, plan-management API, proration, production provider adapter, or concurrent webhook simulation.
