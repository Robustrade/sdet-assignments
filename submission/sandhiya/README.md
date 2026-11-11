# Subscription & Billing SDET Assignment

A small Node.js HTTP fixture and object-oriented integration test suite for a stateful subscription billing workflow. The implementation deliberately stays small so the tests and business invariants remain easy to inspect.

## Requirements

- Node.js 18 or later (uses native `fetch`, `node:test`, and `structuredClone`)
- No third-party npm dependencies

## Run

```bash
npm test
```

The suite starts an isolated HTTP server on an ephemeral localhost port for each test. Each fixture creates a fresh in-memory repository and mock provider; no external payment account, database, network service, or credentials are needed.

## Architecture and patterns

| Component | Responsibility / pattern |
|---|---|
| `SubscriptionStateMachine` | Explicit transition table. The service cannot update lifecycle status without asking the state machine. |
| `SubscriptionBuilder`, `WebhookBuilder` | Builder pattern keeps scenario intent readable and removes repeated test payload construction. |
| `PaymentProviderAdapter` + `MockPaymentProvider` | Adapter/port seam and dependency injection. Tests control success, decline, and timeout and inspect exact call arguments. |
| `InMemoryRepository` | Repository pattern keeps persistence operations out of service and test scenario code. |
| `BillingTestFixture` + `HttpApiClient` | Test fixture and client abstraction isolate setup, server lifecycle, signing, and HTTP transport. |

## Scope and assumptions

- This repository is the system under test: a minimal HTTP service fixture, not automation against a separately supplied production service.
- The plans are `basic` ($20.00 represented as 2000 cents, 7-day trial) and `pro` ($49.00 represented as 4900 cents, 14-day trial). Currency is USD. All plans begin in trial; `chargeOnCreate` is false.
- The in-memory customer registry is seeded with `cust_001`, `cust_007`, and `cust_998`. It exists to exercise known/unknown customer validation, not to model a full customer service.
- A payment-provider timeout is treated as an indeterminate (`unknown`) invoice attempt and moves a trialing subscription to `past_due`. It must never activate a subscription. A production implementation should reconcile the unknown attempt with the provider using the idempotency key before retrying.
- `payment.refunded` marks a previously paid invoice as refunded and records an audit event. It does not change subscription status because refund-to-subscription policy was not specified in the assignment.
- A late failure for an invoice already marked paid is ignored. A canceled subscription is terminal; later events are durably recorded as ignored and cannot change its status or create invoices.
- A webhook with a valid signature but invalid domain data is rejected before persistence. An authenticated event that is a valid no-op (duplicate, stale, or canceled-subscription event) is recorded for auditability.

## API contract

- `POST /subscriptions` — creates a `trialing` subscription; returns `201` and the subscription.
- `GET /subscriptions/{id}` — returns `200` or `404`.
- `POST /subscriptions/{id}/cancel` — transitions trialing/active/past_due to canceled; invalid repeat cancellation returns `400`.
- `POST /webhooks/payment-provider` — requires `X-Provider-Signature`, an HMAC-SHA256 hex digest of the exact raw request body. Invalid signatures return `401`; malformed JSON/domain payloads return `400`.

## Persistence model and invariants

`InMemoryRepository` models:

- `subscriptions`: current plan, customer, lifecycle status, amount, currency, trial, and timestamps.
- `invoices`: one record per invoice ID, including paid/failed/unknown/refunded state and provider reference.
- `webhookEvents`: one record per event ID, including processed/ignored status and delivery/duplicate counters.
- `auditLog`: append-only lifecycle and webhook processing history per subscription.

The tests check API-visible state against repository state, plan price/trial rules, invoice outcomes, event deduplication, terminal cancellation, audit history, and provider call count/arguments. Each test gets a new fixture/repository, preventing stale records from leaking between scenarios.

## Webhook ordering and idempotency

- The event ID is the primary idempotency key. A repeated event ID increments delivery and duplicate counters but cannot create another invoice or transition.
- Invoice IDs prevent contradictory invoice outcomes. A failure delivered after success for the same invoice is recorded as ignored and cannot regress an active subscription.
- Refunds require an existing paid invoice.
- Canceled subscriptions accept no further state mutation; incoming events are recorded as ignored.
- Provider charges occur only in `completeTrial`, never while processing an inbound webhook. Replayed/invalid webhook requests therefore cannot trigger a charge.

## Test coverage

The `node:test` suite covers API creation/retrieval/cancellation, required-field and customer/plan validation, signature and malformed-payload rejection, provider success/decline/timeout, exact provider request arguments, all lifecycle transitions, invalid transitions, duplicate delivery, out-of-order delivery, canceled-subscription webhook behavior, refund handling, persistence consistency, and audit records.

## Red / Blue / Green approach

The initial project tests exposed the important failure mode: provider exceptions could be translated inconsistently and allow a success transition despite a timeout. The service was changed so the actual provider result controls the event and invoice outcome; timeout is represented as unknown and cannot activate. Additional failing scenarios were then added for customer validation, duplicate delivery, out-of-order events, refunds, and persistence invariants, followed by refactoring into repository/state-machine/provider seams.

## Limitations and production follow-ups

- Persistence is in-memory; it does not prove SQL constraints, transaction isolation, restart durability, or multi-process idempotency. A production-grade version should use a transactional database with unique constraints on event and invoice IDs.
- The current in-memory handler is adequate for deterministic sequential tests, but a true concurrent webhook race test should run against a transactional database and verify unique-key/locking behavior.
- HMAC verification is implemented for the fixture; production should include provider-specific timestamp tolerance, secret rotation, replay windows, and raw-body middleware guarantees.
- No actual outbound HTTP payment integration, notification service, tax/proration, plan change, subscription renewal scheduler, or retry scheduler is implemented. Provider behavior is intentionally mocked.
- Retry exhaustion is represented by an explicit service operation for lifecycle testing; scheduling/retry policy itself is outside scope.
- JavaScript is used because the assignment permits it. TypeScript could add compile-time contract checking, but is not necessary to demonstrate the requested patterns in this compact fixture.
