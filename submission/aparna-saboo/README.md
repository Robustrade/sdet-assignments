# Subscription Billing SDET Assignment

This submission implements a TypeScript/Jest automation solution for a subscription and billing service fixture. The fixture is intentionally small, but it models the core behavior needed to test API contracts, subscription lifecycle rules, webhook processing, mock payment-provider behavior, and in-memory persistence.

## How To Run

From this directory:

```bash
npm ci
npm test -- --runInBand
npm run build
```

Useful optional command:

```bash
npm run test:coverage
```

## Project Structure

```text
src/
  api/
    clients/                 Typed API client used by tests
    routes/                  Express HTTP routes
  application/
    ports/                   Repository and payment-provider interfaces
    services/                Subscription, webhook validation, and webhook processing services
  domain/
    models/                  Subscription, invoice, webhook event models
    state/                   Subscription lifecycle state machine
  infrastructure/
    payment/                 Mock payment provider and webhook signer
    persistence/             In-memory repository implementations

tests/
  api/                       Supertest API and webhook endpoint tests
  application/               Service-level workflow tests
  builders/                  Test data builder
  fixtures/                  Test fixture helpers
  payment/                   Mock provider behavior tests
  persistence/               Repository tests
  state/                     State-machine transition tests
```

## Test Strategy

The suite validates behavior at multiple layers:

- API level: subscription creation, retrieval, cancellation, validation errors, webhook endpoint responses, signature handling, and malformed payload handling.
- State-machine level: all valid lifecycle transitions and invalid transitions such as canceled-to-active and active-to-trialing.
- Application workflow level: payment success, decline, timeout, cancellation, duplicate webhooks, stale webhook ordering, refund handling, and repository side effects.
- Persistence level: subscriptions, invoices, and webhook events are checked through repository interfaces.
- External-integration level: the payment provider is represented by a mockable `PaymentProvider` interface and `MockPaymentProvider` implementation.

The tests favor focused assertions over large end-to-end scripts. API tests use Supertest against the Express app without starting a network server.

## What Is Real Vs Mocked

Real in this fixture:

- Express routes and request handling
- Subscription lifecycle state machine
- Application services
- Repository interfaces and in-memory persistence
- HMAC-style webhook signature validation
- API-visible subscription state

Mocked or simplified:

- The external payment provider is mocked by `MockPaymentProvider`.
- Persistence is in-memory rather than a real database.
- Customer identity is treated as a required identifier string; there is no customer repository.
- Webhook signatures are generated over the fixture payload using `JSON.stringify`, not over an untouched raw HTTP body.

## Design Patterns Used

- State machine: `DefaultSubscriptionStateMachine` defines legal lifecycle transitions and rejects invalid ones.
- Builder: `SubscriptionBuilder` creates subscription test data without repeated literals.
- Dependency injection / Strategy seam: `DefaultSubscriptionService` depends on the `PaymentProvider` interface, so tests substitute `MockPaymentProvider`.
- Repository pattern: subscription, invoice, and webhook event persistence are accessed through repository interfaces instead of direct storage access from application services.
- Application service separation: webhook signature validation and webhook business processing are separated into `WebhookService` and `WebhookProcessingService`.

## Key Behaviors Covered

- `basic` subscriptions start in `trialing` and do not charge immediately.
- `pro` subscriptions charge immediately and become `active` on success.
- Payment declines and timeouts move immediate-charge subscriptions to `past_due`.
- Canceling `trialing`, `active`, and `past_due` subscriptions is supported.
- Canceling an already canceled subscription is rejected.
- A canceled subscription is terminal and cannot be reactivated by webhooks.
- Duplicate webhook delivery with the same `event_id` is idempotent.
- A later failed webhook for an already paid invoice does not regress invoice or subscription state.
- A failed invoice can later become paid when a valid success event arrives.
- Refunds update invoice state without inventing a refunded subscription state.
- Invalid signatures, missing signatures, malformed payloads, and unknown subscriptions do not persist invoice or webhook side effects.

## Known Limitations

- There is no real database; persistence is represented with isolated in-memory repositories.
- There is no customer repository, so "unknown customer" is documented as out of scope beyond validating that `customer_id` is present and non-empty.
- Direct provider charge attempts during `pro` subscription creation are verified through mock calls, but invoice records are modeled through webhook processing.
- Repository implementations expose lookup operations but not count/list operations, so duplicate checks assert stable IDs and idempotent outcomes rather than repository row counts.
- Concurrent webhook delivery is not implemented; duplicate and out-of-order delivery are covered sequentially.
- Plan duration or monthly/yearly pricing is not modeled. Current plan behavior is tier-based: `basic` and `pro`.

## Validation Run

Last verified commands:

```bash
npm test -- --runInBand
npm run build
```

Result:

```text
9 test suites passed
131 tests passed
TypeScript build passed
```
