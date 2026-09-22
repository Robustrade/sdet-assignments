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
npm install
```

`better-sqlite3` is a native dependency; installation needs a compatible Node.js runtime and either a prebuilt binary or local native build tools.

## How to Run Tests

Run from `submission/ram-gawas/`:

```sh
npx vitest run
```

The suite contains 58 tests across 8 files. Use this command directly; the current `npm test` script is a placeholder. No external database or payment credentials are required. Supertest needs permission to open temporary local HTTP ports.

## Type Check

```sh
npx tsc --noEmit
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
- `src/subscription-service.ts` coordinates subscription creation, payments, cancellation, and webhook processing.
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

## Test Coverage

Coverage includes HTTP validation and response/persistence agreement; legal and selected illegal state transitions; repository storage and retrieval; provider charge arguments and call counts; payment success, decline, and timeout; signed webhooks and rejection of missing/invalid signatures or malformed payloads; duplicate event handling; success followed by stale failure for the same invoice; and plan pricing and trial dates. Builder tests check defaults, overrides, and independent results.

These are behavioral coverage areas, not a measured line-coverage percentage. See [Test Strategy](docs/TEST_STRATEGY.md) for rationale and gaps.

## Design Patterns

1. **State Machine:** a transition table centralizes legal lifecycle changes and prevents ad-hoc state mutation in service workflows.
2. **Builder:** `SubscriptionBuilder` and `WebhookBuilder` reduce repeated input setup and expose scenario-specific differences through fluent methods. They live only under `tests/`.
3. **Strategy / Dependency Injection:** the service accepts a `PaymentProvider` implementation through its constructor. `MockPaymentProvider` makes payment outcomes deterministic without a real gateway.
4. **Repository:** the three repositories hide SQL from service callers and most test scenarios. The stale-webhook test also queries audit rows directly to verify the persisted processing flag.
5. **Configuration Registry:** shared basic/pro configuration supplies pricing, trial duration, and plan lookup without scattered plan branches or a class hierarchy.

## Important Business Invariants

For supported service workflows, the tests verify that:

- Canceled subscriptions cannot reactivate.
- Activation is backed by a persisted successful payment.
- Replaying the same webhook event ID does not duplicate side effects.
- A stale failed event cannot overwrite a successful result for the same invoice or regress the subscription.
- Incoming webhook processing does not call the payment provider.
- Persisted subscription state agrees with the returned service/API state.

These are workflow guarantees exercised by the suite, not database constraints preventing arbitrary direct repository writes.

## Webhook Strategy

Requests use `X-Provider-Signature`. HMAC-SHA256 is computed over `JSON.stringify` of the parsed payload. Verification checks signature length and uses a timing-safe comparison. It does not authenticate the original raw HTTP bytes.

The payload's `eventId` maps to the unique `webhook_events.event_id`. A previously recorded ID returns the current subscription without repeating writes. After loading a subscription, the service checks the payment keyed by `invoiceId`: an existing success makes a later failure stale. The new failure event is recorded with `processed: false`; the payment and subscription remain unchanged. Invalid state transitions, including a success webhook for a canceled subscription, are also recorded as ignored. Accepted transitions are recorded with `processed: true`.

Ignored valid events return HTTP 200. Rejected signatures and malformed payloads are not stored as webhook audit events. The audit table stores event metadata and processing status, not full payloads or detailed ignore reasons.

## Test Isolation

Service and API suites call `createTestEnvironment()` before each test, receiving a fresh in-memory database, repositories, service, app, and payment mock. Their `afterEach` hooks restore spies and close the database. Builder `build()` calls return independent objects.

Repository suites also create fresh databases per test, so rows are not shared, but currently lack explicit `db.close()` teardown. No test relies on persisted state from a previous test.

## Assumptions

Only basic/pro plans are supported. Amounts are integers in a single unspecified unit; no currency model, taxes, proration, or production gateway is included. Webhook invoice IDs serve as payment primary keys rather than references to a separate invoice entity. Trial dates are metadata; time passing does not automatically charge or transition a subscription.

## Known Limitations

- There is no scheduler, retry orchestration, authentication layer for subscription endpoints, or standalone server startup script.
- Webhook ordering support is limited to the documented success-then-failure case. Failure-then-success for the same invoice is not implemented as a payment update; repeated invoices with different event IDs are not generally reconciled.
- Webhook audit, payment, and subscription writes are not transactional. Concurrency, race conditions, and partial-write recovery are untested. Direct payment IDs use `Date.now()` and can collide.
- A direct payment calls the provider before validating the resulting state transition. Repeated direct charges are not idempotent.
- Signature tests use the project's own signing helper. Raw-body provider compatibility, timestamp-based replay protection, exhaustive payload validation, load testing, and production secret management are outside current coverage. The default webhook secret is for tests.

## Red / Blue / Green Workflow

Development proceeded incrementally around requested behaviors: **Red** defines important scenarios and expected outcomes; **Blue** adds the minimum support needed; **Green** improves reusable test builders, fixtures, repositories, and abstractions while preserving behavior. This describes the working approach, not evidence that every commit followed strict test-first TDD or that every test was observed failing before implementation.

## Responsible AI Usage

AI tooling assisted with scaffolding, implementation and test changes, code review suggestions, and documentation. The developer supplied requirements and business invariants; generated work was checked against those requirements and the existing code. The full test suite and TypeScript compiler were run locally through the development tooling. These checks support verification but do not establish that every generated change received independent manual review; final review remains the submitter's responsibility.
