# Kulu Subscription & Billing — SDET Assignment

## Summary

Implemented a TypeScript-based subscription billing service and an automation framework to validate subscription lifecycle behavior across API, business logic, database persistence, payment-provider interactions, and webhook processing.

The solution focuses on correctness, maintainability, idempotency, and resilience against payment and webhook failures.

### Key capabilities

- Subscription creation, retrieval, and cancellation.
- Subscription lifecycle state-machine validation.
- Payment success, decline, timeout, and retry handling.
- HMAC-SHA256 webhook signature verification.
- Duplicate webhook event handling and stale-event protection.
- Payment idempotency using invoice-based idempotency keys.
- Database persistence and consistency validation.
- Reusable API clients, fixtures, builders, and assertion helpers.

## Test Strategy

### Levels covered

| Level | Coverage |
|---|---|
| Unit | State machine, payment provider, webhook signature |
| API | Request validation, responses, error handling |
| Integration | Services, repositories, SQLite persistence |
| Database | Subscription, invoice, webhook, and audit records |
| End-to-End | Subscription lifecycle and resilience workflows |

### In scope

- Subscription creation, retrieval, and cancellation.
- Valid and invalid lifecycle transitions.
- Payment success, decline, timeout, and retry scenarios.
- Webhook signature and payload validation.
- Duplicate and stale webhook handling.
- Payment idempotency.
- API and database consistency.
- Provider interaction assertions.

### Out of scope

- Real payment gateway integration.
- Frontend and browser testing.
- Production deployment.
- Real notification delivery.
- Advanced tax and multi-currency calculations.
- Performance and load testing.

### Real vs stubbed/mocked

| Component | Implementation |
|---|---|
| REST API | Real Express application |
| Business services | Real implementation |
| Database | SQLite |
| Repositories | Real implementation |
| Payment provider | Injected mock |
| Webhook delivery | Simulated HTTP requests |
| Signature verification | Real HMAC-SHA256 |
| Notifications | Not implemented |

## OOP & Design Pattern Choices

### State Machine

**Location:** `src/domain/subscription/SubscriptionStateMachine.ts`

Centralizes permitted subscription transitions and prevents unsupported lifecycle changes from being applied throughout the service layer.

### Repository Pattern

**Location:** `src/repositories/`

Encapsulates database operations for customers, plans, subscriptions, invoices, webhooks, and audit logs. This keeps persistence logic separate from business workflows.

### Strategy / Dependency Injection

**Location:** `src/payment/PaymentProvider.ts`

Defines the payment provider contract. The service receives its provider dependency through injection, allowing the mock implementation to be used without coupling business logic to a real gateway.

### Builder Pattern

**Location:** `tests/builders/`

Provides reusable construction of subscription and webhook test data, reducing duplication and improving scenario readability.

### Fixture / Factory

**Location:** `tests/fixtures/testContext.ts`

Creates and manages isolated test dependencies, including the application, database, repositories, and mock provider.

## API Validation Approach

The Express API uses Zod schemas to validate incoming requests.

Endpoints covered:

- `POST /subscriptions`
- `GET /subscriptions/:id`
- `POST /subscriptions/:id/cancel`
- `POST /webhooks/payment-provider`

Validation covers:

- Required and invalid request fields.
- Unknown customers and plans.
- Missing or invalid subscription identifiers.
- Expected HTTP status codes and response structures.
- Missing and invalid webhook signatures.
- Malformed webhook payloads.
- Duplicate webhook delivery.

Webhook transport validation is kept separate from webhook business processing so signature and payload failures can be tested independently of lifecycle behavior.

## Database Validation Approach

SQLite provides real persistence during automated tests.

The test suite validates persisted records for:

- Customers.
- Plans.
- Subscriptions.
- Invoices and payment outcomes.
- Webhook events.
- Audit logs.

Assertions compare API-visible state with persisted state and verify that repeated or stale events do not create unintended business side effects.

## Mock Payment Provider & Webhook Validation

The `PaymentProvider` interface provides the seam between subscription business logic and external payment processing.

The mock provider supports:

- Successful payment.
- Declined payment.
- Timeout behavior.

Tests assert provider interactions, including invocation counts, payment arguments, and idempotency keys.

Webhook validation includes:

- HMAC-SHA256 signature verification.
- Invalid and missing signature handling.
- Malformed payload handling.
- Duplicate `event_id` handling.
- Stale and out-of-order event handling.
- Protection against a late failure reversing a successful payment outcome.

Payment idempotency uses the invoice ID as the provider idempotency key. The mock provider caches definitive outcomes by key; timeout outcomes are not cached so the same invoice can be retried.

## State-Machine / Lifecycle Coverage

The lifecycle model includes:

- `trialing` → `active`
- `trialing` → `past_due`
- `active` → `past_due`
- `past_due` → `active`
- `past_due` → `canceled`
- `active` → `canceled`
- `trialing` → `canceled`

Unsupported transitions include attempts to reactivate canceled subscriptions or move canceled subscriptions into other billing states.

The state-machine unit tests and lifecycle scenarios validate transition behavior. The final checklist below should be completed only after confirming every documented transition and at least two invalid transitions have explicit test coverage.

## Test Architecture

The automation framework is separated into reusable components:

| Component | Responsibility |
|---|---|
| `tests/clients/` | Encapsulates API communication |
| `tests/fixtures/` | Initializes isolated test dependencies |
| `tests/builders/` | Constructs reusable test data |
| `tests/helpers/` | Webhook simulation and reusable assertions |
| `tests/domain/` | Domain and state-machine validation |
| `tests/repositories/` | Persistence validation |
| `tests/services/` | Business-service validation |
| `tests/scenarios/` | Lifecycle and resilience workflows |
| `tests/api/` | HTTP API validation |

This separation keeps test scenarios focused on business behavior while allowing shared setup, data construction, and assertions to be maintained independently.

## Validation

Validation was performed locally from a clean dependency installation inside this submission directory.

Commands executed:

```bash
npm ci
npm run build
npm run lint
npm test
npm run test:coverage
```

### Results

| Validation | Result |
|---|---:|
| Clean dependency installation | Passed |
| TypeScript build | Passed |
| ESLint | Passed |
| Test files | 20 passed |
| Automated tests | 148 passed |
| Statement coverage | 89.04% |
| Branch coverage | 77.44% |
| Function coverage | 96.46% |
| Line coverage | 89.02% |

Coverage figures represent the complete reported coverage scope, including application and test-support code.

A GitHub Actions workflow is included to run installation, build, lint, tests, and coverage checks.

## Known Limitations / Next Steps

- The payment provider is mocked; no real gateway is contacted.
- Exactly-once external payment execution cannot be guaranteed by the mock. A production provider must support idempotency keys.
- Provider calls occur outside the database transaction. Concurrent payment processing relies on provider-side idempotency.
- Webhook ordering uses provider-supplied event timestamps. Equal timestamps do not provide a deterministic chronological order.
- Malformed historical webhook payloads are ignored.
- Production-grade concurrent webhook processing, observability, and real gateway contract testing would be valuable future improvements.

## Responsible AI Usage

AI tools were used as development assistance for architecture discussion, implementation guidance, debugging, test design, and documentation refinement.

The implementation was validated locally through clean dependency installation, TypeScript compilation, linting, automated tests, and coverage execution. AI-generated suggestions were not treated as proof of correctness; actual command output and test results were used for validation.

## Author Checklist

- [x] Linting passes.
- [x] Type check passes (`npm run build`).
- [x] Test suite passes.
- [x] Database schema and setup tests pass.
- [ ] Every listed lifecycle transition is explicitly exercised by at least one test.
- [ ] At least two invalid transitions are explicitly proven impossible.
- [x] Duplicate webhook `event_id` handling is tested.
- [x] README setup was validated after a clean `npm ci`.
