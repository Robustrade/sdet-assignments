# SDET Assignment – Approach & Test Strategy

**Candidate:** Naveen Pavithran  
**Assignment:** Subscription & Billing Service  
**Language:** TypeScript

## 1. Understanding of the Assignment

The objective is to design and implement an automated validation solution for a Subscription & Billing Service.

The system manages subscription lifecycles driven by API operations and asynchronous payment provider webhooks.

The primary focus is to validate business workflows across multiple layers, ensuring that API responses, subscription states, payment records and persisted database data remain consistent.

The solution will prioritize correctness, reliability, maintainability and meaningful test coverage rather than the number of test cases.

## 2. Proposed Approach

I propose building a lightweight TypeScript-based service fixture with an automated API and integration testing layer.

Since an existing service implementation is not provided, the fixture will simulate the essential subscription and billing workflows required by the assignment.

The implementation will separate business logic, persistence, external dependencies and test automation to maintain clear responsibilities.

The following layers will be covered:

- API validation
- Subscription lifecycle and state transition validation
- Database and persistence validation
- External payment provider interaction
- End-to-end workflow validation

## 3. Technology Stack

| Component | Technology | Responsibility |
|---|---|---|
| Language | TypeScript | Application and test implementation |
| Runtime | Node.js | Application execution |
| HTTP framework | Express | API implementation |
| Test runner | Jest | Test execution, assertions and mocking |
| API testing | Supertest | HTTP request and response validation |
| Database | SQLite | Persistent storage and consistency checks |
| Mocking | Jest mocks | Simulating external dependencies |

### Why Jest and Supertest?

Jest will be used as the central test runner because it provides assertions, mocking, spies and lifecycle hooks in one framework.

Supertest will be used to exercise Express API endpoints without requiring a separately deployed server.

This combination allows API requests, business workflow validation, mock provider interactions and direct database verification to be performed within the same automated test suite.

## 4. Test Architecture

The solution will follow a modular, object-oriented structure.

Proposed components:

- **Test Fixtures:** Initialize the application, database, test data and mock dependencies.
- **API Client:** Encapsulate reusable HTTP requests and response handling using Supertest.
- **Subscription Service:** Handle subscription operations and business rules.
- **State Transition Handler:** Enforce valid subscription lifecycle transitions.
- **Payment Provider Interface:** Abstract external payment operations.
- **Mock Payment Provider:** Simulate successful payments, declines and timeouts.
- **Webhook Simulator:** Generate signed and invalid webhook requests.
- **Repository Layer:** Encapsulate database operations and persistence verification.
- **Test Data Builders:** Construct reusable customers, subscriptions and webhook payloads.
- **Test Specifications:** Organize scenarios by lifecycle, API validation, payment processing and webhook behavior.

## 5. API Validation Strategy

The following API operations will be covered:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /subscriptions | Create subscription |
| GET | /subscriptions/{id} | Retrieve subscription |
| POST | /subscriptions/{id}/cancel | Cancel subscription |
| POST | /webhooks/payment-provider | Process payment webhook |

Validation will include:

- Successful subscription creation and retrieval.
- Correct response status codes and payload structures.
- Invalid plans and missing or invalid request fields.
- Unknown customers and invalid payment methods.
- Valid and invalid webhook signatures.
- Malformed webhook payloads.
- Repeated cancellation requests.

Both successful and unsuccessful API operations will be verified against their expected persistence and provider-interaction side effects.

## 6. Subscription Lifecycle Validation

The subscription lifecycle will be represented using an explicit state transition model.

The following transitions will be validated:

| Current State | Trigger | Expected State |
|---|---|---|
| trialing | First payment succeeds | active |
| trialing | First payment fails | past_due |
| active | Recurring payment fails | past_due |
| past_due | Retry payment succeeds | active |
| past_due | Retries exhausted | canceled |
| active | Customer cancellation | canceled |
| trialing | Customer cancellation | canceled |

Invalid transitions must be rejected or safely ignored.

Particular attention will be given to ensuring that a canceled subscription cannot be reactivated by subsequent webhook events.

## 7. Payment Provider Mocking Strategy

The external payment provider will be represented through an interface.

A configurable mock implementation will simulate:

- Successful payment.
- Payment decline.
- Provider timeout.

Tests will verify:

- Correct payment amount and customer details.
- Payment method and idempotency/reference information.
- Provider invocation count.
- No unnecessary provider calls for rejected requests or duplicate webhook deliveries.

No real payment provider or external financial transaction will be involved.

## 8. Webhook Reliability and Idempotency

Webhook processing will be one of the major focus areas.

### Duplicate delivery

- Deliver the same event multiple times.
- Verify that the business transition happens only once.
- Ensure duplicate invoices and payment records are not created.
- Verify that duplicate events do not trigger repeated side effects.

### Out-of-order delivery

- Deliver a successful payment event followed by a delayed failure event for the same invoice.
- Verify that the stale failure event does not incorrectly reverse the successful outcome.

### Invalid webhook requests

- Invalid signatures.
- Missing required fields.
- Malformed payloads.
- Unknown event identifiers.

### Failure handling

- Provider timeout.
- Payment decline.
- Retry exhaustion.
- Persistence failures where feasible.

Webhook event identifiers will be used to identify previously processed events. Processing and persistence will be designed to prevent duplicate side effects.

## 9. Database Validation Strategy

Database verification will be performed independently of API response assertions.

The following entities will be validated:

| Entity | Validation |
|---|---|
| subscriptions | Current state, plan and customer association |
| invoices | Amount, status and billing references |
| payments | Payment outcome and provider reference |
| webhook_events | Event identifiers and processing status |
| audit_events | Subscription lifecycle history, if modeled separately |

Important invariants:

1. A subscription must not become active without a successful persisted payment.
2. A canceled subscription must never be reactivated.
3. Duplicate webhooks must not create duplicate payment or invoice records.
4. Provider calls must occur at most once per genuine billing attempt.
5. API-visible subscription state must match persisted state.
6. Plan pricing and trial configuration must be applied consistently.

Tests will use isolated database state and controlled test data to avoid interference between scenarios.

## 10. Design Patterns

| Pattern | Application | Purpose |
|---|---|---|
| State Pattern / Transition Table | Subscription lifecycle | Enforce valid state transitions |
| Builder Pattern | Test data creation | Simplify and standardize test data |
| Strategy / Dependency Injection | Payment provider | Substitute configurable mock implementations |
| Repository Pattern | Database access | Separate persistence operations from business and test logic |

Each pattern will be used where it provides a clear architectural benefit rather than introducing unnecessary abstraction.

## 11. Test Execution Strategy

Testing will follow a Red, Blue, Green workflow:

- **Red:** Write a failing test for the required behavior or business invariant.
- **Blue:** Implement the minimum functionality needed to satisfy the test.
- **Green:** Refactor the implementation while keeping the tests passing.

The test suite will be organized into logical groups:

1. Subscription creation and lifecycle.
2. API validation and error handling.
3. Payment success and failure.
4. Webhook idempotency and ordering.
5. Database consistency.
6. Payment provider interactions.
7. End-to-end subscription workflows.

Jest will execute the automated suite, while Supertest will exercise the API endpoints and the test code will query SQLite directly to verify persisted state.

## 12. Assumptions and Limitations

- A minimal service fixture will be implemented because an existing service implementation is not supplied.
- SQLite will be used as the embedded persistence layer.
- Payment provider behavior will be simulated through a mock interface.
- Webhook signatures will be generated and verified using a shared test secret.
- The implementation will focus on the specified subscription lifecycle and billing workflows.
- Production payment integrations, frontend development and exhaustive performance testing are outside the scope.
- Refund behavior will be validated against an explicitly documented expected business rule in the fixture, since the assignment does not define a complete refund lifecycle.

## 13. Expected Outcome

The final solution will provide a maintainable, object-oriented automated validation suite demonstrating confidence in subscription lifecycle management, payment processing, webhook reliability and database consistency.

The emphasis will be on meaningful end-to-end scenarios, explicit business invariants, controlled external dependencies and clear documentation of architectural decisions and trade-offs.
