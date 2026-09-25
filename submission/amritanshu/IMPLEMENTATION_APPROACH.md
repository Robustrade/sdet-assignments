# SDET Assignment - Implementation Approach

## 1. Understanding

The assignment requires an automated validation solution for a
Subscription and Billing Service.

The solution will validate the following areas:

- Subscription APIs
- Subscription lifecycle and state transitions
- Persistence and data integrity
- Payment provider interactions
- Webhook processing
- Webhook idempotency
- Invalid state transitions
- Error handling and validation

The implementation will focus on maintainable test architecture,
clear separation of responsibilities, and meaningful business
scenario coverage.

---

## 2. Technology Stack

The proposed solution will use:

- TypeScript
- Node.js
- Express
- Vitest
- Supertest
- In-memory persistence

The application and test code will follow an object-oriented
and modular design.

---

## 3. Proposed Architecture

The solution will separate business logic, persistence,
external dependencies, and API handling.

```text
                    API Layer
                       |
                       v
                Service Layer
                       |
                       v
              Domain / State Machine
                 /           \
                /             \
               v               v
        Repository        Payment Provider
               |               |
               v               v
        In-Memory DB      Mock Provider

                       |
                       v
                Webhook Handler



                Webhook processing follows a similar separation:

Webhook Request
      |
      v
Signature Validation
      |
      v
Webhook Service
      |
      +----> Idempotency Check
      |
      +----> State Transition
      |
      +----> Payment / Invoice Update
      |
      +----> Audit Event
      |
      v
Webhook Event Persistence




4. Test Architecture

The test solution is organized into reusable layers.

Domain

Contains subscription states and lifecycle transition rules.

Services

Contains subscription creation, cancellation, and webhook processing logic.

Repositories

Repository abstractions and in-memory implementations provide a persistence seam for validation.

Payment Provider

The payment provider is represented through an interface, allowing the external dependency to be replaced by a deterministic mock.

Builders

Builders provide reusable creation of:

Customers
Subscriptions
Webhook payloads
API Client

SubscriptionApiClient centralizes HTTP calls used by integration tests.

Webhook Simulator

WebhookSimulator creates signed webhook requests and keeps webhook scenarios reusable and readable.

Test Environment

The test environment creates isolated repositories, plans, customers, payment provider, services, and Express application instances for the test scenarios.

5. OOP and Design Pattern Choices
State Machine

Subscription lifecycle rules are represented explicitly using a transition map.

Supported states:

trialing
active
past_due
canceled

Supported lifecycle transitions include:

trialing  -> active
trialing  -> past_due
trialing  -> canceled

active    -> past_due
active    -> canceled

past_due  -> active
past_due  -> canceled

Invalid transitions are rejected or ignored according to the service behavior.

This keeps lifecycle rules centralized rather than scattering transition logic across tests.

Builder Pattern

Builders are used for:

Customers
Subscriptions
Webhook payloads

Builders provide reusable defaults while allowing individual tests to override only the fields relevant to a scenario.

Payment Provider Abstraction

The PaymentProvider interface creates a seam between subscription billing logic and the external payment provider.

The test suite uses MockPaymentProvider, which supports:

Successful charge
Declined payment
Provider timeout

The mock records provider calls so tests can verify invocation count and billing parameters.

Repository Pattern

Repositories abstract persistence operations from business logic.

The implementation uses in-memory repository implementations for:

Customers
Plans
Subscriptions
Invoices
Payments
Webhook events
Audit events

This allows persistence behavior to be validated without requiring an external database.

6. API Validation Strategy

The integration suite validates the main service APIs:

POST /subscriptions
GET /subscriptions/{id}
POST /subscriptions/{id}/cancel
POST /webhooks/payment-provider

Validation includes:

HTTP status codes
Response payloads
Subscription state
Invoice information
Payment information
Invalid input handling
Unknown resources
Cancellation behavior
Webhook signature validation
Malformed webhook requests

Supertest is used to exercise the Express application through HTTP-level tests.

7. State Machine and Lifecycle Validation

The lifecycle tests cover supported transitions and invalid transitions.

Important scenarios include:

Successful subscription creation
Payment failure resulting in past_due
past_due returning to active after payment success
Cancellation from supported states
Canceled subscriptions remaining terminal
Invalid lifecycle transitions
A late payment.failed webhook not regressing an already active subscription

The state-machine unit tests provide direct transition-level coverage, while integration tests validate lifecycle behavior through the service/API layer.

8. Persistence Validation

The test suite validates that API responses and persisted records remain consistent.

The in-memory persistence layer contains records for:

Subscriptions
Invoices
Payments
Webhook events
Audit events

Persistence tests verify:

Subscription state
Customer and plan association
Payment method
Invoice amount and currency
Payment status
Payment-to-invoice relationship
Payment-to-subscription relationship
Webhook event persistence
Audit event persistence

The tests also validate that duplicate webhook processing does not create duplicate successful payment records.

9. Payment Provider Validation

The mock payment provider validates the interaction between the subscription service and the external billing dependency.

The suite validates:

Provider invocation for a genuine billing attempt
Correct customer ID
Correct payment method
Correct amount
Correct currency
Idempotency key
Provider decline behavior
Provider timeout behavior
Provider call count

The provider should not be invoked for rejected subscription creation scenarios.

Provider calls are recorded and asserted directly in the tests.

Payment Failure

When the provider declines a payment:

Payment Provider
       |
       v
Payment Failed
       |
       v
Subscription -> past_due

A failed payment is persisted and the subscription moves to past_due when the transition is valid.

Payment Provider Timeout

The mock provider also supports timeout behavior.

When a provider timeout occurs during subscription creation, the provider exception is propagated and the already-created subscription/invoice records remain in their persisted pre-payment state.

This behavior is covered by a dedicated unit test.

10. Webhook Validation

Webhook requests contain an HMAC signature calculated from the raw request body.

The implementation validates:

Valid signatures
Invalid signatures
Missing signatures
Malformed webhook requests

Supported webhook event types include:

payment.succeeded
payment.failed
payment.refunded

Webhook processing updates the relevant payment, invoice, subscription, and audit records according to the event and current lifecycle state.

11. Webhook Idempotency

Webhook events are identified using event_id.

The webhook service checks whether an event has already been processed before applying its side effects.

The test suite verifies that replaying the same event:

Does not create another successful payment
Does not repeat the lifecycle transition
Does not create duplicate payment side effects
Persists the webhook event

This protects subscription state from duplicate delivery of the same provider event.

12. Audit and Event History

Audit events are persisted for important subscription lifecycle changes.

An audit record captures information such as:

Subscription ID
Event type
Previous state
Next state
Metadata
Creation timestamp

Tests validate audit persistence for lifecycle changes and duplicate webhook scenarios.

13. Test Coverage

The solution contains:

Unit Tests
Subscription state-machine tests
Builder tests
Repository tests
Payment-provider tests
Webhook signature tests
Subscription service tests
Webhook service tests
Integration Tests
Subscription API creation
Subscription retrieval
Subscription cancellation
Webhook processing
Persistence validation
Payment-provider validation
Webhook idempotency
State transitions
Invalid scenarios
Refund scenarios
Late/stale webhook behavior

Current validated test result:

Test Files: 11 passed
Tests:      73 passed

TypeScript type checking also passes successfully.

14. Reliability Scenarios

The implementation covers scenarios including:

Duplicate webhooks
Late/stale payment failure webhooks
Invalid webhook signatures
Malformed webhook requests
Payment declines
Payment-provider timeout
Invalid lifecycle transitions
Cancellation
Payment refunds
Persistence consistency

The late webhook scenario specifically verifies that an already active subscription is not regressed by a stale payment.failed event.

15. Assumptions and Scope

The solution uses in-memory persistence to keep the assignment self-contained and deterministic.

The payment provider is mocked through the PaymentProvider interface rather than calling a real external payment system.

The assignment implementation focuses on:

API validation
Domain/state validation
Persistence validation
Payment-provider interaction validation
Webhook validation
Idempotency validation

The following are outside the current scope:

UI testing
Real payment-provider integration
Production database infrastructure
Exhaustive performance/load testing
Production monitoring infrastructure
16. Known Limitations / Next Steps

Potential production extensions include:

Replace in-memory repositories with a real database implementation.
Add database-level integration tests.
Add concurrency-focused tests for simultaneous webhook delivery.
Add persistence transaction/rollback validation.
Add production-grade retry and observability mechanisms around external provider failures.
Expand contract testing against a real payment-provider contract.

These are intentionally outside the minimal assignment implementation.

17. How to Run

From the submission directory:

npm ci

Run TypeScript type checking:

npm run typecheck

Run the complete test suite:

npm test

Expected validation result:

Test Files  11 passed (11)
Tests       73 passed (73)
18. Validation Summary

The solution was validated using a clean dependency installation followed by TypeScript type checking and the complete Vitest suite.

Validation status:

Clean dependency installation: PASS
TypeScript typecheck: PASS
Unit tests: PASS
Integration/API tests: PASS
11 test files: PASS
73 tests: PASS
Dependency configuration committed: PASS
Working tree clean after final commit: PASS

### Now update the file

You're already inside `submission/amritanshu`.

Run:

```bash
code IMPLEMENTATION_APPROACH.md