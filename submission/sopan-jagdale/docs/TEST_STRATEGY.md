# Kulu SDET Assignment – Test Strategy & Technical Approach

**Author:** Sopan Jagdale  
**Role:** Software Development Engineer in Test (SDET)  
**Project:** Subscription & Billing Service  
**Language:** TypeScript  
**Status:** Initial Design / Approach Proposal

---

## 1. Understanding of the Assignment

The objective is to design and implement an object-oriented automation framework to validate a stateful Subscription & Billing Service.

The solution will validate the complete subscription lifecycle across multiple layers:

- REST API contract and request validation.
- Subscription lifecycle and state transitions.
- Database persistence and data consistency.
- External payment provider interactions.
- Webhook processing, idempotency and out-of-order delivery.
- End-to-end business workflows.

The primary focus is ensuring that API responses, subscription state, invoice records and payment events remain consistent throughout the billing lifecycle.

The solution will use a lightweight service fixture because no existing service implementation has been provided.

## 2. Proposed Technology Stack

| Component | Technology |
|---|---|
| Programming language | TypeScript |
| Runtime | Node.js |
| Test framework | Jest |
| API framework | Express.js |
| HTTP testing | Supertest |
| Database | SQLite |
| Database access | Repository classes |
| Mocking | Jest mocks / Mock Payment Provider |
| API validation | Typed request and response assertions |
| Webhook security | HMAC-SHA256 |
| Package management | npm |

The selected stack provides a lightweight environment while supporting realistic API, persistence and integration testing.

## 3. Scope of Automation

### In Scope

1. Subscription creation and retrieval.
2. Subscription cancellation.
3. Plan-specific pricing and trial configuration.
4. Payment success and failure workflows.
5. Subscription lifecycle validation.
6. Webhook signature validation.
7. Duplicate webhook processing.
8. Out-of-order webhook processing.
9. Payment provider mock interaction validation.
10. Database persistence and consistency.
11. Negative API and business validation scenarios.
12. Audit history and event traceability.

### Out of Scope

- Real payment gateway integration.
- Frontend and UI automation.
- Production deployment.
- Load and performance testing.
- Tax calculation.
- Complex multi-currency billing.
- Advanced subscription proration.
- Production notification infrastructure.

## 4. Proposed Architecture

The implementation will follow a layered architecture with clear separation of responsibilities.

### Application Layers

**Domain Layer**
- Subscription entity.
- Subscription lifecycle state machine.
- Plan configuration and business rules.

**Service Layer**
- Subscription creation.
- Cancellation.
- Payment processing.
- Webhook event orchestration.

**API Layer**
- REST endpoints.
- Request validation.
- Response handling.
- Webhook signature verification.

**Persistence Layer**
- Subscription repository.
- Invoice repository.
- Webhook event repository.
- Audit event repository.

**External Integration Layer**
- Payment provider interface.
- Mock payment provider.
- Configurable success, decline and timeout responses.

**Automation Layer**
- API client.
- Test fixtures.
- Test data builders.
- Assertion helpers.
- Test scenarios.

## 5. Object-Oriented Design and Design Patterns

The following patterns will be implemented based on their actual responsibilities.

| Design pattern | Proposed implementation | Purpose |
|---|---|---|
| State Machine / State Pattern | SubscriptionStateMachine | Centralize valid and invalid lifecycle transitions. |
| Builder Pattern | SubscriptionBuilder, WebhookEventBuilder | Construct reusable test data and readable scenarios. |
| Strategy / Dependency Injection | PaymentProvider interface | Replace external payment processing with configurable test doubles. |
| Repository Pattern | SubscriptionRepository, InvoiceRepository, WebhookRepository | Separate persistence operations from business and test logic. |
| Factory Pattern | TestEnvironmentFactory | Create isolated test environments and dependencies. |

The objective is to prevent business rules, database operations and test setup from becoming tightly coupled.

## 6. API Validation Strategy

The following API endpoints will be covered:

| Method | Endpoint | Validation |
|---|---|---|
| POST | /subscriptions | Create subscription |
| GET | /subscriptions/{id} | Retrieve subscription |
| POST | /subscriptions/{id}/cancel | Cancel subscription |
| POST | /webhooks/payment-provider | Process payment events |

### Positive Scenarios

- Create a subscription using a valid customer and plan.
- Retrieve an existing subscription.
- Cancel an active subscription.
- Process a valid signed payment webhook.

### Negative Scenarios

- Unknown plan.
- Missing customer ID.
- Invalid payment method.
- Unknown customer.
- Unknown subscription.
- Cancel an already-canceled subscription.
- Invalid webhook signature.
- Malformed webhook payload.
- Invalid lifecycle transition.

Each API test will validate the HTTP status code, response structure, business result and relevant persistence side effects.

## 7. Subscription State-Machine Strategy

The subscription lifecycle will be represented through a centralized transition mechanism.

### Valid Transitions

| Current state | Trigger | Expected state |
|---|---|---|
| trialing | First payment succeeds | active |
| trialing | First payment fails | past_due |
| active | Recurring payment fails | past_due |
| past_due | Retry payment succeeds | active |
| past_due | Retry limit exhausted | canceled |
| active | Customer cancellation | canceled |
| trialing | Customer cancellation | canceled |

### Invalid Transition Coverage

- canceled → active through payment success webhook.
- canceled → past_due through payment failure webhook.
- active → active through a stale duplicate or contradictory event.
- Invalid transitions must not mutate subscription state or create contradictory financial records.

The state-machine implementation will be the single authority for lifecycle transitions.

## 8. Payment Provider Mocking Strategy

The payment provider will be represented by a TypeScript interface.

A MockPaymentProvider implementation will support:

- Successful payment.
- Declined payment.
- Provider timeout.

The mock will record:

- Number of charge attempts.
- Customer ID.
- Payment method ID.
- Amount.
- Currency.
- Idempotency/reference key.

Tests will verify both the provider response and the service's resulting behavior.

No real payment gateway or external network call will be required.

## 9. Webhook and Idempotency Strategy

Webhook events will be constructed by test builders and submitted through the actual HTTP webhook endpoint.

### Security Validation

- Generate a valid HMAC-SHA256 signature using the raw request body.
- Reject invalid signatures.
- Reject missing signatures.
- Reject malformed payloads.
- Ensure rejected requests do not create business side effects.

### Idempotency Validation

Each webhook event will have a unique event ID.

The webhook event repository will enforce uniqueness of event IDs.

The following scenarios will be validated:

1. First delivery processes the event.
2. Second delivery of the same event ID is treated as a duplicate.
3. Subscription state changes only once.
4. Invoice/payment records are not duplicated.
5. Provider interactions and other side effects are not repeated.

### Out-of-Order Event Handling

Idempotency and event ordering will be handled independently.

For the same invoice, a successful payment is treated as a terminal outcome against a subsequent contradictory failure event.

Event ordering will be determined using provider event timestamps or an equivalent sequence mechanism where applicable.

A stale event must not regress the subscription state.

A refund will be recorded as a separate financial event. Since the assignment does not define refund-driven lifecycle transitions, a refund will not automatically reactivate or cancel a subscription.

## 10. Database Validation Strategy

The test suite will validate the following entities:

| Entity | Validation |
|---|---|
| subscriptions | Customer, plan, status, timestamps |
| invoices | Amount, currency, status, subscription reference |
| webhook_events | Event ID, type, processing status, duplicate handling |
| subscription_events | Lifecycle transitions and audit history |

### Core Database Invariants

1. A subscription cannot become active without a persisted successful payment record, except where an explicit paid-through or other documented activation rule applies.
2. A canceled subscription cannot transition to another state.
3. Duplicate webhooks cannot create duplicate invoices or payment attempts.
4. Failed payment events must be persisted accurately.
5. API-visible state must match the database state.
6. Invoice amounts must match the configured plan pricing.
7. Every processed lifecycle transition must have an auditable record.

Test data will be isolated for each test using fresh environment setup and database cleanup or rollback.

Repository methods will be used for database assertions rather than scattering SQL queries across test cases.

## 11. Test Architecture

The proposed project structure is:

```text
src/
  domain/
  services/
  controllers/
  providers/
  repositories/
  models/

tests/
  fixtures/
  builders/
  clients/
  assertions/
  scenarios/
    subscription.spec.ts
    lifecycle.spec.ts
    webhook-idempotency.spec.ts
    payment-failure.spec.ts
    persistence.spec.ts
    validation.spec.ts

docs/
  TEST_STRATEGY.md
```

### Responsibilities

- Fixtures: initialize isolated test environments.
- API Client: encapsulate HTTP requests.
- Builders: construct customers, subscriptions and webhook events.
- Mock Provider: simulate payment outcomes and record interactions.
- Repositories: provide controlled database access.
- Assertions: centralize API, persistence and provider validations.
- Scenario Tests: express business behavior clearly.

## 12. End-to-End Validation Scenarios

The following business workflows will be implemented:

**Scenario 1: Successful Subscription Activation**
- Create a subscription.
- Verify initial state.
- Trigger successful payment.
- Validate API response.
- Verify active subscription and successful invoice in the database.
- Verify provider interaction arguments.

**Scenario 2: Payment Failure and Recovery**
- Create a subscription.
- Trigger a failed payment.
- Verify past_due state.
- Validate failed invoice persistence.
- Trigger a successful retry.
- Verify active state and successful retry record.

**Scenario 3: Cancellation**
- Create and activate a subscription.
- Cancel through the API.
- Verify canceled status.
- Deliver a subsequent payment success webhook.
- Verify the subscription remains canceled.

**Scenario 4: Duplicate Webhook**
- Deliver a valid payment success webhook.
- Deliver the same event again.
- Verify exactly-once business processing.
- Verify no duplicate invoice or payment record.
- Verify the audit history is not duplicated.

**Scenario 5: Out-of-Order Webhooks**
- Deliver payment success for an invoice.
- Deliver a distinct, older payment failure for the same invoice.
- Verify the subscription remains active.
- Verify the successful invoice is not overwritten.

**Scenario 6: Payment Provider Timeout**
- Configure the mock provider to time out.
- Trigger a billing attempt.
- Verify the service's documented retryable failure behavior.
- Validate persisted attempt status and absence of a false successful payment.

## 13. Test Execution and Quality Gates

The following commands will be configured:

```bash
npm install
npm run build
npm test
npm run lint
```

The implementation will be considered ready for submission when:

- All automated tests pass.
- TypeScript compilation succeeds.
- Linting succeeds.
- All valid lifecycle transitions are covered.
- At least two invalid transitions are proven impossible.
- Duplicate webhook processing is validated.
- Database consistency assertions pass.
- Mock provider interactions are verified.

## 14. Red, Blue, Green Development Approach

The implementation will follow the requested Red, Blue, Green discipline.

**Red**
- Write a failing test for an important business rule or invariant.

**Blue**
- Implement the minimum required service, state-machine or persistence behavior to pass the test.

**Green**
- Refactor the implementation for readability, reuse and maintainability without breaking existing tests.

## 15. Assumptions and Known Limitations

1. No existing subscription service implementation is supplied; therefore, a lightweight service fixture will be developed.
2. The service will use a local embedded database for deterministic persistence validation.
3. The payment provider will be simulated using dependency injection.
4. The provider webhook will use HMAC-SHA256 signature verification.
5. Webhook event IDs will have a unique database constraint.
6. Contradictory payment events for the same invoice will be resolved using invoice-level event ordering and terminal payment outcomes.
7. Provider timeouts will be represented as retryable payment attempts rather than successful transactions.
8. Refunds will be persisted separately, with lifecycle effects left outside scope until a business policy is defined.
9. Production-grade distributed locking and multi-instance concurrency are outside the initial implementation scope, but concurrent webhook delivery will be considered as an additional validation scenario.

## 16. Expected Outcome

The final solution will demonstrate a maintainable, object-oriented SDET automation framework capable of validating API behavior, business workflows, database consistency and external payment integration boundaries.

The emphasis will be on business correctness, reliable event processing, meaningful assertions and maintainable test architecture rather than the volume of test cases or unnecessary framework complexity.
