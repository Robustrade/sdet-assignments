# Subscription & Billing Service SDET Assignment

## Overview

This project is a lightweight testable backend fixture and automation suite for a stateful subscription and billing workflow. It exercises real HTTP handlers, business logic, and SQLite persistence with a deterministic mock payment provider. It is an assignment fixture, not a deployed billing service.

## Technology Stack

- **TypeScript:** typed application code and test utilities.
- **Vitest:** test execution, assertions, parameterized cases, and clock spies.
- **Express:** subscription and payment-webhook HTTP endpoints.
- **Supertest:** HTTP integration tests against the Express app.
- **better-sqlite3:** real, synchronous SQLite persistence in memory.

## How to Install

From the repository root, with Node.js and npm installed:

```sh
cd submission/ram-gawas
npm ci
```

`better-sqlite3` is a native dependency; installation needs a compatible Node.js runtime and either a prebuilt binary or local native build tools.

## How to Run Tests

Run from `submission/ram-gawas/`:

```sh
npm test
```

The suite contains 92 tests across 8 files. No external database or payment credentials are required. Supertest needs permission to open temporary local HTTP ports.

## Type Check

```sh
npm run typecheck
```

## Architecture

```text
Supertest -> Express API -> SubscriptionService
                                  |-- State Machine
                                  |-- Plan Registry
                                  |-- PaymentProvider -> MockPaymentProvider
                                  `-- Repositories -> in-memory SQLite

Builders -> scenario inputs
Test fixture -> fresh DB, repositories, provider, service, and Express app
```

- `src/app.ts` validates HTTP inputs and signatures and maps results to responses. Routes create, retrieve, and cancel subscriptions and accept payment webhooks. Payment charging is a service method, not an HTTP endpoint.
- `src/subscription-service.ts` coordinates subscription creation, payments, cancellation, retry exhaustion, and webhook processing. `exhaustRetries(id)` transitions only `past_due` subscriptions to `canceled`, without charging or adding a payment. Canceled subscriptions are rejected before any provider charge.
- `src/customer-validator.ts` provides an injected customer/payment-method lookup. The test fixture seeds `cust_001` with `pm_001` and `pm_test_visa_4242`, and `cust_002` with `pm_002`. Unknown customers and methods not belonging to the customer return HTTP 400 before persistence or charging.
- `src/subscription-state.ts` defines legal transitions between `trialing`, `active`, `past_due`, and `canceled`.
- `src/plans/` centralizes supported plans:

  | Plan | Price (integer units) | Trial days |
  | --- | ---: | ---: |
  | basic | 1900 | 7 |
  | pro | 4900 | 14 |

  Creation persists `trialEndsAt` as an ISO timestamp using elapsed 24-hour days. `processPayment(id)` uses plan pricing; `processPayment(id, amount)` permits an explicit override.
- `PaymentProvider` is injected into the service. Tests supply `tests/mocks/mock-payment-provider.ts` to record charges and simulate success, decline, or timeout.
- `src/repositories/` contains `SubscriptionRepository`, `PaymentRepository`, and `WebhookEventRepository`. `src/database.ts` creates the three tables in a fresh in-memory SQLite database.
- `tests/builders/` constructs subscription requests and webhook payloads. `tests/fixtures/test-environment.ts` wires real application components to the mock provider.

## API Contract

The fixture uses camelCase JSON and caller-supplied identifiers. Creation requires `id`, `customerId`, `plan`, and `paymentMethodId`; successful creation returns 201 with the subscription. Retrieval and cancellation return 200; unknown subscriptions return 404 and invalid cancellation returns 409. Missing fields, invalid plans, unknown customers, and invalid payment methods return 400 with an `error` message.

Webhooks require `eventId`, `type`, `subscriptionId`, `invoiceId`, and numeric `amount`, plus `X-Provider-Signature`. Supported types are `payment.succeeded`, `payment.failed`, and `payment.refunded`. Accepted or ignored valid events return 200; missing/invalid signatures return 401, incomplete payloads return 400, and unknown subscriptions return 404. No currency field or plan-change endpoint is modeled.

## Test Coverage

Coverage includes HTTP validation and response/persistence agreement; legal and selected illegal state transitions; repository storage and retrieval; provider charge arguments and call counts; payment success, decline, and timeout; signed webhooks and rejection of missing/invalid signatures or malformed payloads; duplicate event handling; success followed by stale failure for the same invoice; and plan pricing and trial dates. Builder tests check defaults, overrides, and independent results.

Integrated service/persistence tests cover all seven listed lifecycle transitions: trialing to active/past_due/canceled, active to past_due/canceled, and past_due to active/canceled. Recovery preserves initial success, recurring failure, and retry success as distinct payment attempts, with provider counts of one, two, and three. Direct payment IDs use Node’s `randomUUID()`; tests hold `Date.now()` fixed to avoid relying on elapsed time. Refund tests cover active and canceled subscriptions, unknown subscriptions, and signed duplicate delivery.

These are behavioral coverage areas, not a measured line-coverage percentage. See [Test Strategy](docs/TEST_STRATEGY.md) for rationale and gaps.

## Design Patterns

1. **State Machine:** a transition table centralizes legal lifecycle changes and prevents ad-hoc state mutation in service workflows.
2. **Builder:** `SubscriptionBuilder` and `WebhookBuilder` reduce repeated input setup and expose scenario-specific differences through fluent methods. They live only under `tests/`.
3. **Strategy / Dependency Injection:** the service accepts a `PaymentProvider` implementation through its constructor. `MockPaymentProvider` makes payment outcomes deterministic without a real gateway.
4. **Repository:** the three repositories hide SQL from service callers and most test scenarios. The stale-webhook test also queries audit rows directly to verify the persisted processing flag.
5. **Configuration Registry:** shared basic/pro configuration supplies pricing, trial duration, and plan lookup without scattered plan branches or a class hierarchy.

## Important Business Invariants

For supported service workflows, the tests verify that:

- Canceled subscriptions cannot reactivate or be billed; rejected billing creates no payment and calls no provider.
- Activation is backed by a persisted successful payment.
- Replaying the same webhook event ID does not duplicate side effects.
- A stale failed event cannot overwrite a successful result for the same invoice or regress the subscription.
- Incoming webhook processing does not call the payment provider.
- Persisted subscription state agrees with the returned service/API state.

These are workflow guarantees exercised by the suite, not database constraints preventing arbitrary direct repository writes.

## Webhook Strategy

Requests use `X-Provider-Signature`. Express’s JSON parser `verify` callback captures the body buffer before JSON parsing; HMAC-SHA256 is verified against that buffer before business processing. Helpers accept `Buffer | string`, check signature length, and use a timing-safe comparison. Tests send exactly the bytes they sign, including pretty-printed JSON, and reject altered content/whitespace, correct-length forged signatures, and wrong secrets without side effects.

The payload's `eventId` maps to the unique `webhook_events.event_id`. A previously recorded ID increments `delivery_count`, updates `last_received_at`, and returns the current subscription without repeating payment/state writes. First delivery stores a count of one and matching `created_at`/`last_received_at`; replay preserves the original creation timestamp. This also applies to refund and ignored-event replays. After loading a subscription, the service checks the payment keyed by `invoiceId`: an existing success makes a later failure stale. The new failure event is recorded with `processed: false`; the payment and subscription remain unchanged. Invalid state transitions, including a success webhook for a canceled subscription, are also recorded as ignored. Accepted transitions are recorded with `processed: true`.

A refund is an auditable payment event, not a lifecycle transition: `payment.refunded` preserves the subscription state, never calls the provider, and records a processed webhook plus a separate `refunded` payment. Its ID is `refund_${eventId}` and its `providerReference` stores the supplied invoice ID. This preserves the original successful payment, including when refund and success refer to the same invoice. Replaying the same refund event adds no record. The fixture requires an existing subscription, but does not reconcile refund amounts or require a stored original invoice.

Ignored valid events return HTTP 200. Rejected signatures and malformed payloads are not stored as webhook audit events. The audit table stores event metadata and processing status, not full payloads or detailed ignore reasons.

Webhook processing runs inside one synchronous `better-sqlite3` transaction on the shared database connection. Event, payment/refund, and applicable state writes commit together or roll back together. A deterministic test throws after the state write and verifies that the event, payment, and state change all roll back, then redelivers successfully. This protects the local SQLite fixture, not distributed systems or external provider calls.

Timestamp tests validate ISO-formatted subscription/payment creation and event receipt timestamps, coherent subscription/invoice references, and creation/receipt ordering with a controlled clock. Replay tests prove one state write, one payment, and a delivery count of two with an updated receipt time.

## Test Isolation

Service and API suites call `createTestEnvironment()` before each test, receiving a fresh in-memory database, repositories, service, app, and payment mock. Their `afterEach` hooks restore spies and close the database. Builder `build()` calls return independent objects.

Repository suites also create fresh databases per test, so rows are not shared, but currently lack explicit `db.close()` teardown. No test relies on persisted state from a previous test.

## Assumptions

Only basic/pro plans are supported. Amounts are assumed to be integers in a single unspecified unit (only numeric type is validated for webhooks); no currency model, taxes, proration, or production gateway is included. Success/failure webhook invoice IDs serve as payment primary keys rather than references to a separate invoice entity; refunds use separate event-derived IDs. The refund assumption avoids inventing a transition absent from the assignment diagram. Trial dates are metadata; time passing does not automatically charge or transition a subscription.

## Known Limitations

- There is no scheduler or automatic retry orchestration, authentication layer for subscription endpoints, or standalone server startup script.
- Webhook ordering support is limited to the documented success-then-failure case. Failure-then-success for the same invoice is not implemented as a payment update; repeated invoices with different event IDs are not generally reconciled.
- Local webhook writes are transactional; direct billing is outside that transaction boundary. Concurrency/race testing, crash recovery, and distributed transaction behavior are not implemented.
- Canceled subscriptions are guarded before charging. Other direct payment outcomes are checked against the transition table after the provider response; repeated direct charges are not idempotent.
- Security regression tests also sign directly with Node crypto. Timestamp-based replay protection, exhaustive payload validation, load testing, and production secret management are outside current coverage. The default webhook secret is for tests.
- Receipt metadata records total deliveries and the latest receipt time, not a separate row for every delivery. Non-webhook lifecycle changes have no separate audit log. Timestamp coverage targets representative persistence and replay workflows, not every temporal edge case.

## Red / Blue / Green Workflow

Development proceeded incrementally around requested behaviors: **Red** defines important scenarios and expected outcomes; **Blue** adds the minimum support needed; **Green** improves reusable test builders, fixtures, repositories, and abstractions while preserving behavior. This describes the working approach, not evidence that every commit followed strict test-first TDD or that every test was observed failing before implementation.

## Responsible AI Usage

AI tooling was used as a development assistant for scaffolding, reviewing implementation options, identifying assignment gaps, suggesting test cases, and supporting documentation. I personally reviewed the generated changes, validated the business rules and architecture, corrected implementation gaps found during review, and ran the full automated test suite and TypeScript compiler locally before submission.
