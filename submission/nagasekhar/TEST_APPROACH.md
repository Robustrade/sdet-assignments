
# Test Approach — Subscription & Billing Service

## 1. Objective

The objective of this project is to build a maintainable automated test framework for a Subscription & Billing Service.

The framework validates:

- Subscription lifecycle and state transitions.
- REST API behavior and request validation.
- Invoice and payment persistence.
- Payment provider interactions through a mock implementation.
- Webhook signature validation and idempotent processing.
- Consistency between API responses and persisted state.

The primary focus is business correctness, reliability, and prevention of duplicate or invalid billing side effects.

## 2. Assumptions

- A minimal service implementation is included as part of the assignment.
- The service supports subscription creation, retrieval, plan changes, cancellation, and payment webhooks.
- Subscription states are `trialing`, `active`, `past_due`, and `canceled`.
- The payment provider is mocked; no real payments are made.
- Persistence uses a queryable in-memory repository.
- Invalid lifecycle transitions must be rejected.
- Duplicate webhook event IDs must not repeat business side effects.
- Canceled subscriptions must not become active again through later payment webhooks.

## 3. Scope

### In Scope

- Subscription creation and retrieval.
- Subscription plan changes and cancellation.
- API request validation and response verification.
- Subscription lifecycle transitions.
- Payment success, failure, decline, and timeout scenarios.
- Webhook signature validation.
- Malformed payload and invalid event handling.
- Duplicate and out-of-order webhook processing.
- Invoice, subscription, and webhook event persistence.
- Mock payment provider interaction verification.

### Out of Scope

- Real payment provider integration.
- Frontend testing.
- Production-scale performance testing.
- Tax calculations and complex billing proration.
- Production database durability and distributed transaction guarantees.

## 4. API Contracts

The implemented API endpoints are:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/subscriptions` | Create a subscription |
| GET | `/subscriptions/:id` | Retrieve a subscription |
| PATCH | `/subscriptions/:id/plan` | Change a subscription plan |
| POST | `/subscriptions/:id/cancel` | Cancel a subscription |
| POST | `/webhooks/payment` | Process payment provider events |

API tests validate successful responses, invalid requests, unknown resources, canceled subscription behavior, and webhook signature handling.

## 5. Test Architecture

The framework separates responsibilities into reusable components:

- **Test fixtures:** Reset the repository and seed isolated test data.
- **HTTP testing:** Supertest sends requests to the Express application.
- **Test data builders:** CustomerBuilder and PlanBuilder create reusable test data.
- **Payment provider mock:** Simulates success, decline, and timeout outcomes while recording calls.
- **Repository:** InMemoryRepository provides queryable persistence for customers, plans, subscriptions, invoices, and payment events.
- **Test specifications:** Organize scenarios by API, lifecycle, provider behavior, and webhooks.

## 6. Design Patterns

- **State Machine:** Defines permitted subscription transitions and rejects invalid transitions.
- **Builder:** Provides reusable and readable test data construction.
- **Dependency Injection / Strategy:** Allows the payment provider to be replaced with a configurable mock.
- **Repository:** Centralizes persistence access and keeps storage operations separate from business logic.

These patterns improve testability, maintainability, and separation of concerns.

## 7. Persistence Validation

The in-memory repository tracks:

- Customers.
- Plans.
- Subscriptions.
- Invoices.
- Payment events / webhook events.

Tests query persisted records directly to verify business outcomes.

Important validations include:

- Subscription status matches the expected API state.
- Invoice status reflects payment success, failure, or refund.
- Webhook event IDs are stored and duplicate events are not processed twice.
- A failed payment does not incorrectly activate a subscription.
- A refunded invoice is not changed back to paid by a late success event.
- Canceled subscriptions are not reactivated by later webhooks.

The repository is reset before each test to prevent state leakage between test cases.

## 8. Webhook and Idempotency Strategy

Webhook requests are validated using an HMAC SHA-256 signature.

The test suite covers:

- Valid webhook signatures.
- Invalid and missing signatures.
- Malformed webhook payloads.
- Duplicate delivery of the same event ID.
- Payment success followed by failure for the same invoice.
- Payment success received after subscription cancellation.
- Refund followed by a late payment success event.
- Persistence of successfully processed unique webhook events.

The implementation checks previously processed event IDs before applying business changes.

Out-of-order event scenarios verify that an older or conflicting event does not incorrectly reverse an already established invoice or subscription state.

## 9. Key Business Invariants

- A subscription must not become active without a successful persisted payment when a charge is required.
- A canceled subscription must never transition back to active through a payment webhook.
- Duplicate webhook events must not repeat business side effects.
- Invalid state transitions must be rejected.
- A failed payment must not overwrite an already paid or refunded invoice.
- A refunded invoice must not become paid due to a late success event.
- Provider calls must use the expected customer, amount, payment method, and idempotency key.
- Persisted subscription state must agree with the API-visible state.
- Plan pricing and trial configuration must be applied consistently.

## 10. Reliability Scenarios

The test suite includes:

- Duplicate webhook delivery.
- Out-of-order webhook events.
- Invalid signatures.
- Malformed payloads.
- Payment success and failure.
- Refund processing.
- Late success after refund.
- Canceled subscription webhook handling.
- Provider decline and timeout scenarios.
- Invalid subscription state transitions.

Concurrent webhook processing and production database transaction guarantees are not claimed by this in-memory implementation.

## 11. Test-First Workflow

The implementation follows the Red, Blue, Green approach:

1. **Red:** Write a test for an expected behavior and confirm it fails.
2. **Blue:** Implement the minimum code required to satisfy the test.
3. **Green:** Refactor while keeping the complete test suite passing.

The late-success-after-refund scenario was added as a regression test. It initially failed because the invoice was incorrectly changed to paid. The webhook implementation was then updated to preserve the refunded state.

## 12. Technology Stack

- TypeScript
- Node.js
- Express
- Vitest
- Supertest
- InMemoryRepository
- MockPaymentProvider

The in-memory repository provides queryable persistence without requiring an external database setup.

## 13. Limitations and Tradeoffs

- The implementation is a testable service fixture, not a complete production billing platform.
- The in-memory repository does not prove production database durability, transaction isolation, or crash recovery.
- Mock provider tests validate service-side interactions, not the behavior of a real payment provider.
- Webhook signature validation currently uses the JSON-serialized request body.
- Concurrent webhook processing and distributed idempotency guarantees require additional infrastructure and tests.
- Tax calculations, billing proration, and production payment integrations are outside the current scope.

## 14. Responsible AI Usage

AI assistance was used to help explore test scenarios, structure documentation, and review implementation approaches.

Generated code and design suggestions were reviewed and validated through local execution.

The final submission describes the implemented behavior and test results rather than treating unverified suggestions as completed work.

## 15. Test Execution

Install dependencies:

```bash
npm install
```

Run the complete test suite:

```bash
npm test
```

Run TypeScript compilation checks:

```bash
npx tsc --noEmit
```

The current local validation result is:

- 6 test files passed.
- 47 tests passed.
- TypeScript compilation passed.
