## Summary

Implemented a TypeScript/Jest automated validation solution for a Subscription & Billing Service fixture. The submission includes a small Express application, application-layer services, in-memory persistence, a mock payment provider, signed webhook simulation, and tests covering API behavior, lifecycle rules, persistence side effects, webhook idempotency, and payment-provider interactions.

## Test Strategy

- Levels covered: API tests, application service tests, state-machine tests, persistence repository tests, and mock-provider tests.
- In scope: subscription creation, retrieval, cancellation, plan-specific immediate charging, payment success/decline/timeout behavior, multiple successful payments, wrong-amount webhook rejection, signed webhook validation, malformed webhook payloads, duplicate webhook delivery, out-of-order webhook delivery, refund handling, and persistence verification.
- Out of scope: real database setup, real payment-provider integration, frontend/UI, concurrency/racing webhook delivery, full customer-management service, duration-based pricing, taxation, proration, and production-grade observability.
- What is real vs stubbed/mocked: Express routes, lifecycle rules, HMAC-style validation, services, and repositories are real fixture code. The payment provider is mocked through `MockPaymentProvider`. Persistence is in-memory. Customer existence is simplified to non-empty `customer_id` validation.

## OOP & Design Pattern Choices

- State-machine representation: `src/domain/state/subscription-state.ts` contains `DefaultSubscriptionStateMachine`, which centralizes valid lifecycle transitions and rejects invalid transitions.
- Builder: `tests/builders/subscription-builder.ts` provides `SubscriptionBuilder` for readable subscription fixture creation.
- Dependency injection / Strategy seam: `DefaultSubscriptionService` depends on the `PaymentProvider` interface from `src/application/ports/payment-provider.ts`, allowing tests to inject `MockPaymentProvider`.
- Repository pattern: subscription, invoice, and webhook event storage are accessed through repository ports under `src/application/ports/`, with in-memory implementations under `src/infrastructure/persistence/`.
- Application service separation: `WebhookService` handles signature and payload validation, while `WebhookProcessingService` handles idempotency, invoice updates, subscription transitions, and event persistence.

The payment-provider seam is the `PaymentProvider` interface injected into `DefaultSubscriptionService`. Tests use `MockPaymentProvider` to configure success, decline, and timeout outcomes and assert exact call arguments.

## API Validation Approach

API validation is covered with Supertest in `tests/api/subscription-api.test.ts`.

Requests/responses validated:

- `POST /subscriptions`
- `GET /subscriptions/:id`
- `POST /subscriptions/:id/cancel`
- `POST /webhooks/payment-provider`

Webhook request handling is split from webhook business logic:

- `WebhookService` tests validate signatures, missing signatures, tampered payloads, malformed payload fields, invalid event types, invalid currencies, invalid amounts, and normalized webhook event creation.
- API tests verify HTTP status codes and response payloads for valid webhooks, invalid signatures, missing signatures, malformed payloads, and unknown subscriptions.
- `WebhookProcessingService` tests validate the business side effects after a webhook has already been authenticated and normalized.

Failure scenarios covered:

- Missing `customer_id`, `plan`, and `payment_method_id`
- Empty `customer_id`
- Unknown plan
- Unknown subscription lookup
- Cancel unknown subscription
- Cancel already canceled subscription
- Missing webhook signature
- Invalid webhook signature
- Missing `event_id`
- Invalid webhook type
- Invalid currency
- Invalid amount
- Validly signed webhook with an amount that does not match the subscription plan price
- Unknown subscription in a validly signed webhook

## Database Validation Approach

Persisted entities checked:

- `subscriptions`
- `invoices`
- `webhook_events`

The fixture uses repository interfaces and in-memory repository implementations rather than a real database. Tests validate persisted state by querying repositories, not by trusting API responses alone.

Invariants asserted:

- API-visible subscription state matches repository state.
- A `basic` subscription starts `trialing` and does not call the payment provider.
- A `pro` subscription charges with the expected amount and moves according to provider outcome.
- Multiple successful payments for the same subscription create separate paid invoices when they use different invoice IDs.
- Signed webhook payments are rejected when their amount/currency does not match the subscription plan price.
- Canceled subscriptions remain canceled after later webhooks.
- Duplicate webhook delivery does not reprocess the event.
- Paid invoices are not regressed by later failed events for the same invoice.
- Failed invoices can become paid when a later success event arrives.
- Refunded invoices remain refunded and do not add a new subscription state.
- Invalid webhook requests do not persist invoice or webhook event side effects.

Persisted state is checked at creation, cancellation, webhook success, webhook failure, refund, duplicate delivery, out-of-order delivery, and unknown-subscription webhook processing.

## Mock Payment Provider & Webhook Validation

`MockPaymentProvider` implements the `PaymentProvider` interface and supports configurable outcomes:

- `success`
- `decline`
- `timeout`

Tests assert:

- call count
- exact charge arguments
- customer ID
- amount
- currency
- payment method
- subscription ID
- outcome-specific return values

Webhook simulation is also provided by `MockPaymentProvider` through deterministic payload creation and signature generation. API and service tests use this to send validly signed payloads and intentionally invalid signatures.

Wrong-amount webhook validation is proven by sending a validly signed webhook with a numeric amount that does not match the subscription plan price and asserting:

- HTTP 400 at the API layer
- a meaningful amount mismatch message
- no invoice is persisted
- no webhook event is persisted
- subscription state remains unchanged

Webhook idempotency is proven by processing the same `event_id` twice and asserting:

- first request returns `processed: true`, `duplicate: false`
- second request returns `processed: false`, `duplicate: true`
- subscription state remains correct
- invoice state remains correct
- webhook event lookup resolves to the original event

Out-of-order/stale webhook behavior is tested by processing a successful event before a later failed event for the same invoice and asserting that the paid invoice and active subscription do not regress. The reverse recovery path, failed then succeeded, is covered at the processing-service level.

## State-Machine / Lifecycle Coverage

Valid transitions tested:

- `trialing -> active`
- `trialing -> past_due`
- `trialing -> canceled`
- `active -> past_due`
- `active -> canceled`
- `past_due -> active`
- `past_due -> canceled`

Invalid transitions tested include:

- `active -> trialing`
- `past_due -> trialing`
- `canceled -> trialing`
- `canceled -> active`
- `canceled -> past_due`
- `canceled -> canceled`
- `active -> active`
- `past_due -> past_due`
- `trialing -> trialing`

These tests assert both `canTransition()` and `transition()` behavior. Application and API tests add confidence that business events and webhooks do not bypass the state-machine contract, especially for canceled subscriptions.

## Test Architecture

The suite is organized by responsibility:

- API tests use Supertest for HTTP contract and end-to-end API-to-persistence flows.
- Integration tests exercise complete subscription, webhook, and persistence flows through the HTTP boundary.
- Application service tests validate subscription and webhook business workflows.
- State-machine tests validate lifecycle rules directly and compactly with parameterized test data.
- Persistence tests validate repository behavior in isolation.
- Payment tests validate mock-provider behavior, call recording, webhook payload creation, and signing.
- Builders and fixtures keep domain object setup readable.

This structure keeps transport concerns, business rules, persistence checks, and external-provider behavior separate while still allowing end-to-end confidence through API-level tests.

## Validation

Commands run:

```bash
npm test -- --runInBand
npm run build
```

Results:

```text
9 test suites passed
137 tests passed
TypeScript build passed
```

There is no separate lint script or schema validation script in this fixture.

## Known Limitations / Next Steps

- Replace in-memory repositories with a real or embedded database if the assignment needed durable storage beyond test-process lifetime.
- Add repository count/list methods for stronger duplicate-row assertions.
- Add a customer repository if strict unknown-customer validation is required.
- Persist invoice/payment records during direct `pro` creation charges if direct charge attempts should produce billing rows before webhooks arrive.
- Capture raw HTTP body bytes for production-grade webhook signature validation.
- Add concurrent webhook tests for racing duplicate or out-of-order delivery.
- Add API-level coverage for the failed-then-succeeded recovery ordering path; it is currently covered at service level.
- Model billing intervals only if monthly/yearly or duration-based pricing becomes part of the contract.

## Responsible AI Usage

- AI tools were used to help break down the assignment, plan implementation steps, generate prompts, review code structure, and identify coverage/documentation gaps.
- I reviewed the generated direction against the assignment requirements and adjusted scope where needed, especially around canceled subscriptions, trial restart behavior, out-of-order webhooks, and not inventing duration-based pricing.
- I personally verified the implementation by reviewing the code, running the Jest suite, running the TypeScript build, and checking git/submission hygiene before finalizing.

## Author Checklist

- [ ] Linting passes: no lint script is configured.
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes
- [ ] Schema/setup validation passes: no schema/setup validation script is configured.
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [ ] README was tested from a clean setup
