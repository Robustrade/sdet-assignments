# Subscription & Billing Service — SDET Assignment

## 1. Objective

The objective of this assignment is to design and implement a maintainable, object-oriented automation solution for a Subscription and Billing Service.

The primary focus is validating business-critical workflows, subscription lifecycle transitions, payment processing, persistence consistency, webhook reliability and external payment provider interactions.

Since an existing backend service was not provided, a lightweight Express-based service fixture was implemented to support the automation strategy.

## 2. Technology Stack

| Technology | Purpose |
|---|---|
| TypeScript | Type-safe implementation and automation |
| Node.js | Runtime environment |
| Express | Lightweight backend service fixture |
| Jest | Test execution, mocking and assertions |
| Supertest | HTTP API validation |
| In-memory repositories | Queryable persistence layer |
| Git | Version control |

Environment used for validation:

- Node.js: v24.18.0
- npm: 11.16.0

## 3. Test Strategy

The automation solution validates the application at multiple levels rather than relying exclusively on API response codes.

### Unit Testing

- Subscription state-machine transitions
- Plan configuration and pricing
- Mock payment provider behavior
- Webhook signature verification
- Repository operations and data isolation

### API Testing

- Subscription creation and retrieval
- Subscription cancellation
- Plan changes
- Billing operations
- Request validation
- Webhook endpoint validation
- HTTP response codes and response payloads

### Integration Testing

- Subscription lifecycle management
- Successful and declined payments
- Payment provider timeouts
- Payment retry handling
- Webhook processing
- Invoice and subscription consistency

### End-to-End Workflow Testing

The tests exercise workflows through the HTTP API, business services, mock payment provider and persistence repositories.

The objective is to verify that externally observable results remain consistent with internal business rules and persisted records.

## 4. Scope of Automation

### In Scope

- Subscription creation and activation
- Basic and Pro plan behavior
- Trial period configuration
- Successful, declined and timed-out payments
- Subscription lifecycle transitions
- Payment retry handling
- Subscription cancellation
- Plan changes
- Billing idempotency
- Duplicate and out-of-order webhook handling
- Webhook signature validation
- Persistence consistency
- Webhook audit history
- Concurrent billing and webhook scenarios
- Selected persistence failure and recovery scenarios

### Out of Scope

- Real payment gateway integration
- Production database infrastructure
- Frontend UI automation
- Distributed transaction management
- Production billing scheduler
- Tax calculation
- Detailed proration calculations
- Multi-currency billing
- Large-scale performance testing

## 5. Framework Architecture

The project separates business logic, persistence, external dependencies and test automation responsibilities.

    src/
        domain/
        providers/
        repositories/
        services/
        app.ts

    tests/
        api/
        builders/
        clients/
        fixtures/
        lifecycle/
        plans/
        providers/
        repositories/
        services/
        webhooks/

### Domain Layer

Contains subscription, customer, plan, invoice and webhook event models, together with the subscription state machine.

### Service Layer

Contains subscription management, billing processing, webhook handling and signature verification.

### Repository Layer

Provides persistence abstractions and in-memory implementations for subscriptions, invoices and webhook events.

### API Client Layer

SubscriptionApiClient encapsulates HTTP request construction using Supertest.

This reduces repeated endpoint and transport-related logic within test scenarios.

### Test Fixture Layer

createAppFixture constructs an isolated application environment with repositories, a mock payment provider, an API client and a webhook signature verifier.

### Test Data Builders

SubscriptionBuilder and WebhookEventBuilder provide reusable and configurable test data construction.

## 6. Object-Oriented Design Patterns

### Explicit State Machine

Implemented through SubscriptionStateMachine.

The state machine centralizes valid lifecycle transitions and prevents unsupported transitions.

Supported subscription states:

- trialing
- active
- past_due
- canceled

Additional service-level validation ensures that activation requires evidence of a successful persisted payment.

### Builder Pattern

Implemented through SubscriptionBuilder and WebhookEventBuilder.

The builders reduce repetitive test data construction and allow individual request properties to be modified for positive and negative scenarios.

Customer identifiers are supplied through subscription requests and predefined customer data rather than a separate customer builder.

### Repository Pattern

Implemented through repository interfaces and their in-memory implementations.

This separates persistence operations from business logic and allows tests to query stored records directly.

### Dependency Injection

The PaymentProvider interface allows BillingService to use a configurable mock provider instead of a real external payment gateway.

Repositories and service dependencies are also injected to improve isolation and testability.

### Factory Approach

The createAppFixture function provides centralized construction of isolated application and test dependencies.

This reduces duplicated setup logic across API test suites.

## 7. API Contracts

The service fixture exposes the following endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /subscriptions | Create subscription |
| GET | /subscriptions/:id | Retrieve subscription |
| POST | /subscriptions/:id/cancel | Cancel subscription |
| POST | /subscriptions/:id/change-plan | Change subscription plan |
| POST | /subscriptions/:id/bill | Execute billing attempt |
| POST | /webhooks/payment | Process payment webhook |

Subscription creation uses customerId, planId and paymentMethodId where required.

Billing requests use paymentMethodId and idempotencyKey.

Webhook payloads contain event_id, type, subscription_id, invoice_id, amount and currency.

Webhook signatures are supplied through the x-webhook-signature header and validated against the raw request body.

These are the concrete contracts of the implemented fixture. Some endpoint and field names differ from the illustrative examples in the assignment.

## 8. Subscription Lifecycle and Business Rules

The automation validates lifecycle behavior including:

- Trialing to active after successful payment
- Trialing to past_due after failed payment
- Active to past_due after recurring payment failure
- Past_due to active after successful retry
- Past_due to canceled after billing retries are exhausted
- Cancellation through the subscription API
- Rejection of unsupported state transitions
- Prevention of canceled subscription reactivation

### Plan Configuration

| Plan | Price | Trial Period |
|---|---|---|
| Basic | USD 19 | 14 days |
| Pro | USD 49 | No free trial |

Amounts are represented in minor currency units.

The billing retry threshold is three failed payment attempts. Timeout handling is tested separately from payment declines.

## 9. Persistence Validation

An in-memory persistence approach was selected instead of the initially proposed SQLite implementation.

The assignment permits queryable in-memory persistence, and this approach reduces infrastructure and setup overhead while supporting business-level consistency assertions.

The following entities are validated:

### Subscriptions

- Subscription identifiers
- Customer and plan references
- Lifecycle status
- Trial expiry
- Failed payment attempts
- Creation and update timestamps

### Invoices

- Subscription and customer references
- Payment amount and currency
- Invoice status
- Idempotency key
- Transaction reference where applicable
- Creation and update timestamps

### Webhook Events and Audit History

- Processed event identifiers
- Event type
- Subscription and invoice references
- Processing outcome
- Duplicate and ignored deliveries
- Processing timestamps

Tests compare persisted records with API-visible outcomes and verify the absence of invalid or duplicate side effects.

Fresh repositories and mock dependencies are constructed for isolated test environments. Predefined customers and plans are used as deterministic seed data.

No external database setup or manual database cleanup is required.

## 10. Business Invariants

The automation validates important business invariants, including:

- Subscription activation requires a successful persisted payment.
- Canceled subscriptions cannot be reactivated by subsequent webhooks.
- Duplicate billing requests must not produce additional provider charges.
- Duplicate webhook deliveries must not produce duplicate invoice records.
- Payment failures must not create successful payment records.
- Subscription and invoice records must remain consistent with tested API outcomes.
- Plan-specific pricing and trial rules must be respected.
- Stale failure events must not regress an already-paid invoice.
- Previously completed successful payment events must not incorrectly reactivate a past-due subscription.

A refunded invoice is treated as evidence of a historically successful payment. Refund processing does not automatically cancel the subscription in this fixture.

## 11. Mock Payment Provider Strategy

The external payment provider is represented by a configurable MockPaymentProvider implementing the PaymentProvider interface.

The mock supports:

- Successful payments
- Declined payments
- Payment provider timeouts
- Recording provider calls for verification

Tests verify provider call counts, payment amounts, customer references, payment methods and idempotency-related behavior.

No real payment gateway or external financial transaction is involved.

## 12. Webhook Validation Strategy

Webhook events are generated using test data builders and signed using the webhook signature implementation.

The automation validates:

- Successful payment events
- Failed payment events
- Refund events
- Invalid signatures
- Malformed payloads
- Unsupported event types
- Unknown invoice references
- Subscription mismatches
- Amount and currency mismatches
- Duplicate event delivery
- Out-of-order event delivery
- Concurrent duplicate delivery
- Webhook audit history

Webhook processing is serialized within the service instance to reduce concurrent duplicate-processing risks.

A lightweight in-memory recovery map distinguishes interrupted subscription activation from previously completed payment events.

Selected failure-injection tests verify that invoice persistence failures do not activate subscriptions and that interrupted activation can recover when the same webhook event is redelivered.

## 13. Red, Blue, Green Workflow

The implementation followed a behavior-first testing approach for selected business-critical scenarios.

### Red

Failing automated tests were introduced to reproduce defects or missing behavior.

Examples include:

- Activation without a successful payment
- Duplicate invoice persistence
- Interrupted webhook activation recovery
- Stale successful payment events

### Blue

The minimum necessary service fixture changes were introduced to address the identified behavior.

### Green

The affected tests and full regression suite were executed to verify the changes and detect regressions.

## 14. Test Execution Instructions

Navigate to the submission directory:

    cd submission/sethuram

Install dependencies using the committed package lock:

    npm ci

Validate TypeScript compilation:

    npm run typecheck

Execute the complete automation suite:

    npm test

Execute tests with coverage:

    npm run test:coverage

Execute an individual test suite:

    npm test -- tests/webhooks/WebhookService.test.ts

On Windows PowerShell, npm.cmd can be used instead of npm if script execution restrictions apply.

## 15. Test Execution Results

Latest verified regression results:

| Metric | Result |
|---|---|
| Test suites | 16 passed |
| Total tests | 201 |
| Passed tests | 201 |
| Failed tests | 0 |
| Pass percentage | 100% |
| Statement coverage | 97.22% |
| Branch coverage | 92.98% |
| Function coverage | 100% |
| Line coverage | 97.21% |
| Execution time | 10.553 seconds |

Execution time may vary depending on the environment.

Coverage is used as a supporting quality indicator rather than a substitute for meaningful business assertions.

## 16. Assumptions, Tradeoffs and Known Limitations

- The backend is a lightweight service fixture, not a production billing platform.
- In-memory persistence does not survive application restarts.
- Database transaction isolation, migrations and real database constraints are not validated.
- Webhook recovery information is maintained in memory and does not survive process restarts.
- Distributed transactions and complete atomic recovery across invoice, subscription and event repositories are not implemented.
- Concurrent processing across multiple application instances is not validated.
- Billing and webhook processing do not share a production-grade distributed locking mechanism.
- Webhook-driven payment outcomes do not fully share the billing retry-counter mechanism.
- An intervening newer payment failure during interrupted activation remains an unverified recovery scenario.
- Trial expiry billing is exercised explicitly through tests rather than an automated production scheduler.
- The webhook signature secret is intended for test environments.
- A dedicated customer builder and standalone assertion framework were not introduced. Tests use predefined customer data and Jest assertions.
- Full branch coverage has not been achieved.
- Clean dependency installation succeeded. The npm audit reported
  18 moderate-severity dependency vulnerabilities, which require
  further security review.
  - The dependency security audit reported zero vulnerabilities
  in production dependencies and 18 moderate-severity
  vulnerabilities in development dependencies associated with
  Jest, glob and minimatch. The existing dependency versions
  were retained to avoid a breaking Jest downgrade. Dependency
  remediation remains a follow-up activity.

These tradeoffs keep the assignment focused on automation design, business validation and maintainability rather than production infrastructure.

## 17. Responsible AI Usage

ChatGPT was used during this assignment to assist with framework design, TypeScript implementation, test scenario generation, debugging, regression analysis and documentation.

I executed the automation locally in VS Code, reviewed the reported failures, applied corrections and reran the tests to verify the results.

AI-generated suggestions were iteratively validated against the assignment requirements and observed test execution results.

The submitted implementation should be evaluated based on its actual behavior, test evidence and documented limitations rather than generated code volume.

## 18. Conclusion

The automation solution demonstrates a layered testing approach for a stateful Subscription and Billing Service.

The implementation focuses on business invariants, lifecycle correctness, payment provider interaction, persistence consistency, webhook idempotency and maintainable object-oriented test architecture.

The latest regression execution completed successfully with 201 passing tests across 16 test suites.