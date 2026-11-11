# Subscription & Billing Service – Test Strategy

## 1. Objective

The objective is to design and implement an object-oriented automated test solution for a Subscription & Billing Service.

The solution validates API behavior, subscription lifecycle transitions, database consistency, payment provider interactions, webhook reliability, and critical billing invariants.

The focus is on business correctness, maintainability, test architecture, and reliable validation of stateful billing workflows.

## 2. System Under Test and Assumptions

Since no existing service implementation was provided, this submission uses a minimal TypeScript service fixture with an Express API and SQLite in-memory persistence.

The fixture implements subscription creation, retrieval, cancellation, payment processing through a mock provider, and webhook handling.

### Assumptions

- Two plans are configured: Basic and Pro.
- Basic is configured with an illustrative price of USD 1,000 and a 7-day trial.
- Pro is configured with an illustrative price of USD 4,900 and a 14-day trial.
- These prices and trial periods are implementation assumptions, not values prescribed by the assignment.
- Subscription states include `trialing`, `active`, `past_due`, and `canceled`.
- Subscription creation currently follows the trial-based flow.
- Payment operations use an injectable payment provider interface.
- Webhooks can be delivered more than once or out of order.
- SQLite repositories persist subscriptions, processed webhook events, and invoice payment statuses.
- Refund handling follows explicitly defined fixture-level rules.

## 3. Scope of Automation and API Contracts

### 3.1 API Testing

The implemented API endpoints are:

- `POST /subscriptions` – Create a subscription.
- `GET /subscriptions/:id` – Retrieve subscription details.
- `POST /subscriptions/:id/cancel` – Cancel a subscription.
- `POST /webhooks/payment-provider` – Process inbound payment provider events.

A plan-change endpoint is not implemented because its exact contract and business rules were not specified.

### 3.2 Request and Response Validation

Tests validate:

- Successful subscription creation and retrieval.
- Subscription cancellation.
- Correct HTTP status codes and response structures.
- Missing required request fields.
- Invalid plan values.
- Unknown subscription IDs.
- Malformed webhook payloads.
- Invalid and missing webhook signatures.
- Invalid webhook event types.

## 4. Subscription Lifecycle and Business Rules

Subscription lifecycle transitions are controlled through an explicit state machine.

### Supported transitions

- `trialing` → `active` after successful first payment.
- `trialing` → `past_due` after failed first payment.
- `active` → `past_due` after recurring payment failure.
- `past_due` → `active` after successful retry.
- `past_due` → `canceled` after retries are exhausted, as an allowed state-machine transition.
- `active` → `canceled` after customer/API cancellation.
- `trialing` → `canceled` after customer/API cancellation.

Invalid transitions are rejected.

### Additional business rules

- Canceled subscriptions cannot be reactivated through delayed webhooks.
- A failed event arriving after a successful event for the same invoice cannot downgrade the payment status.
- Duplicate webhook events must not produce duplicate processing side effects.
- Plan-specific prices and trial periods are configured centrally.
- Trial-end payment processing is exposed through a service operation.
- Automatic trial-expiry scheduling is not implemented.
- Immediate-charge subscription creation and plan changes are outside the implemented scope.

## 5. Test Architecture

The solution uses the following layers:

1. **Test Fixtures:** Initialize the database, inject dependencies, and isolate test execution.
2. **API Layer:** Express routes for subscription and webhook operations.
3. **Service Layer:** Implement subscription creation, retrieval, cancellation, and trial-end charging.
4. **State Machine:** Control valid subscription lifecycle transitions.
5. **Payment Provider:** Define a provider interface and mock implementation.
6. **Repository Layer:** Encapsulate SQLite persistence operations.
7. **Test Data Builder:** Build reusable webhook events with configurable fields.
8. **Webhook Signature Utility:** Generate and verify HMAC signatures using the raw request body.
9. **Verification Layer:** Validate API results, persisted records, provider interactions, and state transitions.
10. **Test Specifications:** Organize API, lifecycle, database, provider, webhook, and E2E scenarios.

## 6. Object-Oriented Design Patterns

### State Machine Pattern

Subscription lifecycle transitions are represented explicitly. Invalid transitions are rejected.

### Builder Pattern

The payment webhook event builder creates reusable test events with default values and configurable fields.

### Strategy / Dependency Injection

The payment provider interface allows the service to use a mock provider without integrating with an external payment gateway.

### Repository Pattern

Repositories encapsulate database operations and separate persistence logic from business logic.

## 7. Payment Provider and Webhook Strategy

The payment provider is represented through an interface.

The mock provider supports:

- Payment success.
- Payment failure.
- Payment timeout.
- Provider call-count tracking.
- Idempotency-key validation.
- Rejection of conflicting requests using an existing idempotency key.

Webhook tests cover:

- Valid webhook processing.
- Invalid signature rejection.
- Malformed payload rejection.
- Duplicate event delivery.
- Out-of-order payment events for the same invoice.
- Delayed success events after cancellation.
- Refund event handling.
- Prevention of duplicate payment-status updates.

Webhook signatures use HMAC-SHA256 and a test secret.

## 8. Database Validation and Test Data Management

SQLite in-memory persistence is used to isolate test execution.

The implemented repositories manage:

- `subscriptions`
- `processed_webhook_events`
- `invoice_payment_status`

Validation includes:

- Subscription status and plan persistence.
- Trial start and end date persistence.
- Invoice payment status persistence.
- Processed webhook event tracking.
- Duplicate event protection.
- Consistency between API responses and persisted subscription state.
- Prevention of contradictory payment status transitions.

A separate invoice table and comprehensive subscription audit-history table are not implemented. The current persistence layer provides payment-status and processed-webhook records rather than a complete financial ledger.

## 9. Critical Business Invariants and Scenarios

The automated suite validates:

1. A subscription must not become active without a successful persisted payment record.
2. A canceled subscription must never become active again through a delayed webhook.
3. Duplicate webhook delivery must not create duplicate processing side effects.
4. The payment provider must be called only once for the same idempotency key and payment request.
5. Invalid subscription transitions must be rejected.
6. A failed event arriving after a successful event for the same invoice must not regress payment status.
7. API-visible subscription state must match persisted state.
8. Plan-specific price and trial configuration must be applied consistently.
9. Rejected requests and replayed webhooks must not trigger unintended payment processing.
10. Refund processing must not create contradictory invoice payment statuses.

## 10. Technology Stack and Test Execution

**Technology stack:**

- Language: TypeScript
- Runtime: Node.js
- API Framework: Express
- Test Runner: Jest
- HTTP Testing: Supertest
- Persistence: better-sqlite3
- Mocking: Mock payment provider
- Version Control: Git and GitHub

**Development workflow:**

- Write tests for important business behavior.
- Implement the minimum supporting service or fixture code.
- Refactor while keeping the automated suite passing.

### Test execution commands

Run the full suite:

`npx jest --runInBand`

Run TypeScript validation:

`npx tsc --noEmit`

Generate code coverage:

`npx jest --coverage --runInBand`

### Latest validation results

- Test suites: 12 passed.
- Individual tests: 71 passed.
- Statement coverage: 94.49%.
- Branch coverage: 90.62%.
- Function coverage: 97.87%.
- Line coverage: 94.47%.

These results reflect the latest local test execution and should be regenerated if the implementation changes.

## 11. Known Limitations, Risks, and Tradeoffs

- The implementation is a minimal test fixture, not a production billing platform.
- The external payment provider is mocked.
- SQLite in-memory persistence is used instead of production database infrastructure.
- Automatic trial-expiry scheduling is not implemented.
- Immediate-charge subscription creation is not implemented.
- Plan-change functionality is not implemented.
- A separate invoice ledger and comprehensive subscription audit-history mechanism are not implemented.
- Refund handling records payment status but does not implement a complete refund workflow.
- Provider timeout behavior is simulated; production timeout reconciliation and retry policies are outside the current implementation.
- Performance testing and frontend testing are outside the scope.
- Taxes, complex proration, and advanced billing features are excluded.

The implementation prioritizes lifecycle correctness, webhook idempotency, persistence consistency, and maintainable test design.

## 12. Responsible AI Usage

AI tools were used to assist with test strategy preparation, code structure, debugging, and documentation.

Generated code and test scenarios were reviewed, executed, and validated.

The candidate is responsible for understanding the implementation, design decisions, test results, and documented limitations.