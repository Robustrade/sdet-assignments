# Test Strategy

## 1. System Under Test

This solution validates a Subscription & Billing Service using a lightweight testable backend fixture.

The system supports subscription creation, retrieval, cancellation, payment-driven state changes, webhook processing, and persistence validation.

## 2. Scope

### In Scope

* Subscription creation
* Subscription retrieval
* Subscription cancellation
* Subscription lifecycle validation
* Payment success, decline, and timeout handling
* Webhook validation
* Duplicate webhook handling
* Out-of-order webhook handling
* Persistence validation
* Mock payment provider interaction

### Out of Scope

* Real payment gateway integration
* Performance testing
* Tax calculation
* Multi-currency handling
* Advanced proration
* Production monitoring

## 3. Test Levels

The solution will validate behavior at multiple levels:

* API validation
* State-machine / business workflow validation
* Database / persistence validation
* Mock payment provider interaction validation
* End-to-end backend workflow validation

## 4. Real vs Mocked Components

### Real

* HTTP API
* Subscription business logic
* Subscription state machine
* Persistence layer

### Mocked

* External payment provider

The payment provider is mocked so test scenarios can deterministically simulate success, decline, and timeout behavior.

## 5. Design Patterns

The solution will use:

* State Machine for subscription lifecycle transitions
* Builder for test data creation
* Dependency Injection / Strategy for the payment provider
* Repository for persistence access

These patterns are used to keep business rules explicit and test code maintainable.

## 6. Persistence Validation

The following entities will be validated:

* subscriptions
* invoices / payments
* webhook_events
* audit events, if modeled separately

Tests will verify that persisted state matches the API-visible state and business rules.

## 7. Important Invariants

* A canceled subscription must never become active again.
* An active subscription must have a successful persisted payment record.
* Duplicate webhook delivery must not create duplicate payments or invoices.
* The payment provider must be called at most once per genuine billing attempt.
* Persisted subscription state must match the API-visible state.
* Invalid state transitions must be rejected or ignored safely.

## 8. Webhook Strategy

Webhook tests will cover:

* valid signed payloads
* invalid signatures
* malformed payloads
* duplicate event IDs
* out-of-order delivery

Duplicate events must be idempotent and must not create duplicate side effects.

## 9. Test Isolation

Each test will prepare its own state and must not depend on data created by another test.

Test data will be seeded explicitly and cleaned or isolated between tests.

## 10. Known Limitations

The initial solution will use a lightweight embedded persistence layer and simplified billing rules.

Concurrent webhook race-condition testing is considered optional and will only be added if time permits.
