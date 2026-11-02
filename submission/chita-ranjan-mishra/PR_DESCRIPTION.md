## Summary

Implemented a small TypeScript HTTP fixture and automated tests for subscription
creation, retrieval, plan changes, cancellation, payment outcomes, and signed
payment webhooks. The fixture uses an isolated in-memory repository and does not
connect to a real payment provider.

## Test Strategy

- **Levels covered:** API/contract, lifecycle/state machine, repository
  persistence, and end-to-end HTTP workflows.
- **In scope:** valid and invalid API requests, subscription transitions,
  provider success/decline/timeout, signed and malformed webhooks, duplicate
  delivery, and out-of-order events.
- **Out of scope:** production persistence, real provider integration,
  concurrent webhook delivery, taxes, multi-currency, and full proration.
- **Real vs. mocked:** the Node HTTP server and service logic are exercised;
  persistence is in-memory and the injected payment provider is a fake.

## OOP & Design Pattern Choices

- `SubscriptionLifecycle` centralizes allowed transitions, and `Subscription`
  owns status changes.
- `SubscriptionRequestBuilder` and `PaymentWebhookBuilder` keep test scenarios
  focused on intent.
- `PaymentProvider` is the injection seam; `FakePaymentProvider` records charge
  calls and returns configured outcomes.
- `BillingRepository` and `InMemoryBillingRepository` isolate persistence and
  provide query methods for assertions.

## API Validation Approach

HTTP tests cover create, retrieve, cancel, and plan-change endpoints. Request
validation checks required fields, known plans/customers, plan-change state
rules, webhook shape, amount/currency, malformed JSON, missing and forged
signatures, and HMAC-SHA256 verification over the raw webhook body.

## Database Validation Approach

Repository assertions cover subscriptions, invoices, unique webhook events,
individual webhook deliveries, and subscription audit records. Tests verify
API-visible state against persisted state, invoice status and amounts, retry
counts, duplicate delivery counts, and absence of records or provider calls for
rejected requests.

## Mock Payment Provider & Webhook Validation

The fake provider records each call's customer, payment method, amount, currency,
and invoice reference. Tests assert exact calls for immediate billing and no
extra calls for trials, rejected creation, plan changes, or webhook replays.
Duplicate `event_id` deliveries are recorded but do not repeat invoice or
business side effects. A failed event after a successful invoice is ignored.

## State-Machine / Lifecycle Coverage

Tests exercise trialing → active, trialing → past_due, active → past_due,
past_due → active, past_due → canceled after three failed attempts, and
trialing/active → canceled through the API. Invalid past_due cancellation,
canceled reactivation, and stale failure after success are also covered.

## Test Architecture

The suite separates the HTTP server, typed API client, fixture setup, builders,
fake payment provider, service, repository, and scenario tests. Each test gets
an isolated repository and ephemeral HTTP server.

## Validation

- `npm ci`
- `npm test` — passed; 21 tests including nested provider outcome cases.
- `npm run typecheck` — passed.
- No lint or external schema-validation script is configured.

## Known Limitations / Next Steps

The in-memory repository does not validate production database durability,
transaction isolation, or concurrency. Retry exhaustion is deterministic rather
than scheduled. Plan changes apply to future billing without proration or an
immediate charge. The documented refund behavior is a fixture assumption.

## Responsible AI Usage

AI tools assisted with interpreting the assignment, drafting the fixture,
automated tests, and documentation. The build, test suite, and type check were
run in the workspace. The candidate should review the final diff and replace
this sentence with any corrections or additional checks they personally
performed before submission; AI-assisted work should be disclosed accurately.
