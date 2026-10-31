# Test Approach — Subscription & Billing Service

## 1. Objective

The objective is to build a maintainable automated test framework that validates the Subscription & Billing Service API, subscription lifecycle, database persistence, and payment provider interactions.

The focus is on business correctness, webhook idempotency, and reliable verification of persisted state.

## 2. Assumptions

- No existing service implementation has been identified yet.
- A minimal service fixture will be built if no service is provided.
- The service will expose subscription creation, retrieval, cancellation, and payment webhook endpoints.
- Subscription states include `trialing`, `active`, `past_due`, and `canceled`.
- The payment provider will be mocked; no real payments will be made.
- Persistence will use a lightweight database or in-memory store.
- Invalid lifecycle transitions must be rejected or safely ignored.
- Duplicate webhook events must not produce duplicate business side effects.

## 3. Scope

### In Scope

- Subscription creation, retrieval, and cancellation.
- Request validation and API response verification.
- Subscription lifecycle transitions.
- Payment success, failure, and timeout scenarios.
- Webhook signature validation and malformed payload handling.
- Duplicate and out-of-order webhook processing.
- Database persistence and audit history.
- Mock payment provider interaction verification.

### Out of Scope

- Real payment provider integration.
- Frontend testing.
- Production-scale performance testing.
- Tax calculations and complex billing proration.

## 4. API Contracts

The following endpoints are proposed for the test fixture and will be adjusted if the implementation requires different contracts.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/subscriptions` | Create a subscription |
| GET | `/subscriptions/:id` | Retrieve a subscription |
| POST | `/subscriptions/:id/cancel` | Cancel a subscription |
| POST | `/webhooks/payment-provider` | Process payment provider events |

Creation requests will include a customer ID, plan, and payment method ID.

Tests will verify successful responses, response schemas, validation errors, unknown resources, and webhook signature handling.

Exact HTTP status codes and response payloads will be finalized when the service contract is implemented.

## 5. Test Architecture

The framework will separate responsibilities into reusable components:

- **Test fixtures:** Create isolated test environments and seed test data.
- **API client:** Encapsulate HTTP requests.
- **Test data builders:** Build customers, subscriptions, and webhook payloads.
- **Payment provider mock:** Simulate success, decline, and timeout outcomes while recording calls.
- **Repository:** Provide controlled access to persisted test data.
- **Verification helpers:** Check API results, database records, and provider interactions.
- **Test specifications:** Group scenarios by API, lifecycle, persistence, and webhooks.

## 6. Design Patterns

- **State Machine:** Define permitted subscription transitions and prevent invalid state changes.
- **Builder:** Construct reusable test data and readable webhook scenarios.
- **Strategy / Dependency Injection:** Substitute the payment provider with a configurable mock.
- **Repository:** Centralize persistence access and avoid database queries scattered across tests.

Each pattern will be implemented only where it provides a clear benefit.

## 7. Database Validation

The persistence layer will track the following entities:

- `subscriptions`: Current subscription state, customer, plan, and relevant timestamps.
- `invoices` or `payments`: Billing attempts, amounts, outcomes, and references.
- `webhook_events`: Received event IDs and processing outcomes.
- `audit_events`: Subscription lifecycle history, if modeled separately.

Tests will verify that database state agrees with the API response and business rules.

Each test will use isolated data or a resettable test store to avoid false positives from stale records.

## 8. Webhook and Idempotency Strategy

Tests will construct webhook payloads and submit them to the webhook endpoint.

Coverage will include:

- Valid and invalid signatures.
- Malformed payloads.
- Duplicate delivery of the same event ID.
- Success followed by failure for the same invoice.
- Payment success received after cancellation.
- Payment failure and retry success.
- Verification that duplicate events do not create duplicate records or repeat side effects.

Webhook processing will be checked through API-visible state, persisted records, and event history.

## 9. Key Invariants

- A subscription must not become active without a successful persisted payment when a charge is required.
- A canceled subscription must not become active again through later webhooks.
- A duplicate webhook must not repeat business side effects.
- Invalid transitions must not silently change subscription state.
- Rejected requests must not create invalid records or trigger unnecessary provider calls.
- Provider calls must use the correct customer, amount, payment method, and reference.
- Persisted subscription state must agree with the externally observed API state.
- Plan pricing and trial configuration must be applied consistently.

## 10. Reliability Scenarios

The test suite will cover duplicate and out-of-order webhook delivery, provider declines and timeouts, invalid signatures, malformed payloads, invalid state transitions, and persistence inconsistencies.

Concurrent webhook processing is a bonus scenario if time permits.

## 11. Test-First Workflow

The implementation will follow the assignment's Red, Blue, Green discipline:

1. **Red:** Write a test for an important behavior and confirm it fails.
2. **Blue:** Implement the minimum support code required to pass.
3. **Green:** Refactor the implementation and framework while keeping tests green.

## 12. Technology Choices

The planned stack is:

- TypeScript and Node.js.
- Vitest as the test runner.
- Supertest for HTTP-level API testing.
- A mockable payment provider interface.
- A lightweight, queryable persistence layer.

These choices will be confirmed against the repository and runtime setup before implementation.

## 13. Limitations and Tradeoffs

- The fixture is not intended to be a complete production billing platform.
- Mocked provider tests validate our service's interaction with the dependency, not the real provider's behavior.
- An in-memory store is suitable for focused tests but does not prove production database durability or transaction behavior.
- API status codes and detailed response schemas remain provisional until the service contract is implemented.
- Concurrency guarantees require additional tests if concurrent webhook processing is implemented.

## 14. Responsible AI Usage

AI assistance may be used to help structure documentation, explore test scenarios, and review implementation ideas. All generated code and design decisions will be reviewed, executed, and validated before submission. The final pull request will accurately describe the assistance used and the checks personally performed.