# Subscription & Billing Service — Test Strategy

**Candidate:** Rinal Thakur  
**Language:** TypeScript  
**Status:** Initial Test Strategy / Approach

---

## 1. Objective

The objective of this test strategy is to validate the Subscription & Billing Service across:

- API behavior
- Subscription lifecycle and state transitions
- Persistence
- Payment provider interactions
- Webhook processing
- Webhook idempotency
- Invalid and out-of-order events

The solution will focus on deterministic, maintainable and isolated automated tests.

---

## 2. Test Approach

The test strategy will use multiple levels of automated testing:

1. Unit tests
2. API/component tests
3. Integration-style tests
4. End-to-end business-flow tests

The implementation will use TypeScript with Vitest.

A mock payment provider will be used instead of a real external payment service so that payment outcomes can be controlled and verified deterministically.

---

## 3. Scope

### In Scope

- Subscription creation
- Subscription retrieval
- Subscription cancellation
- Request and response validation
- Subscription state transitions
- Invalid state transitions
- Payment success/failure/timeout scenarios
- Payment provider interaction
- Persistence validation
- Webhook processing
- Webhook signature validation
- Duplicate webhook events
- Out-of-order/stale webhook events
- Idempotency validation
- Business invariant validation

### Out of Scope

- UI/frontend testing
- Real third-party payment gateway integration
- Performance/load testing
- Production infrastructure testing
- Monitoring infrastructure
- Advanced billing functionality not defined in the assignment

---

## 4. Test Levels

### 4.1 Unit Tests

Unit tests will validate isolated business logic such as:

- State transition rules
- Invalid transition handling
- Domain validation
- Builder behavior
- Webhook processing rules

These tests should be fast and deterministic.

### 4.2 API / Component Tests

API tests will validate:

- HTTP status codes
- Response payloads
- Request validation
- Subscription lifecycle behavior
- Webhook endpoint behavior

### 4.3 Integration-Style Tests

These tests will validate interactions between:

- API
- Service layer
- State machine
- Persistence layer
- Mock payment provider

### 4.4 End-to-End Scenarios

Representative subscription lifecycle flows will be validated from the API boundary through business logic and persistence.

Example:

Create Subscription
→ Payment Outcome
→ State Transition
→ Persistence Validation
→ Webhook Processing
→ Final State Validation

---

## 5. Subscription State Machine

The subscription lifecycle will be represented explicitly through a state machine.

### Valid States

- `trialing`
- `active`
- `past_due`
- `canceled`

### Valid Transitions

| Current State | Event | Expected State |
|---|---|---|
| `trialing` | Payment success | `active` |
| `trialing` | Payment failure | `past_due` |
| `active` | Recurring payment failure | `past_due` |
| `past_due` | Retry success | `active` |
| `past_due` | Retries exhausted | `canceled` |
| `active` | Customer cancellation | `canceled` |
| `trialing` | Customer cancellation | `canceled` |

Every documented valid transition will have automated coverage.

At least two invalid transitions will also be explicitly tested, for example:

- `canceled → active`
- `canceled → past_due`

Invalid transitions must not result in an unsupported persisted state.

---

## 6. API Validation Strategy

Each API scenario will validate both the HTTP contract and the resulting business behavior.

### HTTP-level assertions

- Status code
- Response body
- Required fields
- Error structure

### Business-level assertions

- Subscription state
- Payment behavior
- Persistence
- Relevant side effects

A successful API response alone will not be considered sufficient validation.

---

## 7. Persistence Validation

Persistence will be validated at important lifecycle stages.

Example:

Create Subscription
→ Persist initial state
→ Payment outcome
→ State transition
→ Persist updated state
→ Process webhook
→ Validate final persisted state

Relevant persisted information will be validated, including:

- Subscription state
- Payment/invoice information
- Webhook event information
- Audit/event information where applicable

---

## 8. Mock Payment Provider Strategy

The payment provider will be represented through an abstraction/interface.

The test implementation will provide deterministic outcomes such as:

- Success
- Decline/failure
- Timeout/error

Tests will verify:

- Whether the provider was called
- Number of calls
- Request arguments
- Amount
- Customer/payment information
- Result handling

This avoids dependence on a real external payment service.

---

## 9. Webhook Strategy

Webhook scenarios will cover:

### Valid webhook

A valid webhook should be processed and result in the appropriate state transition and persistence update.

### Invalid signature

An invalid or missing signature should be rejected without modifying business state.

### Duplicate webhook

The same `event_id` will be delivered multiple times.

Expected behavior:

First delivery:
- Event processed

Duplicate delivery:
- No duplicate side effect

The test will verify that duplicate processing does not create duplicate:

- Payments
- Invoices
- State transitions
- Other business side effects

### Out-of-order webhook

Stale/out-of-order events will be tested to ensure that an older event cannot incorrectly regress the subscription lifecycle.

---

## 10. Test Data Strategy

Reusable builders will be used to avoid duplicating large test-data objects.

Planned builders:

- `CustomerBuilder`
- `SubscriptionBuilder`
- `WebhookBuilder`

Builders will provide valid defaults while allowing individual tests to override only the fields required for a scenario.

---

## 11. OOP and Design Patterns

The implementation will use the following design approaches:

### State Pattern / State Machine

Used to centralize and enforce valid subscription lifecycle transitions.

### Builder Pattern

Used for reusable and readable test-data creation.

### Strategy / Adapter through PaymentProvider

A payment-provider abstraction will allow the application to work with different provider implementations and allow deterministic mocks during testing.

### Repository Pattern

Repositories will abstract persistence operations and keep business logic independent of the underlying storage implementation.

### Dependency Injection

Dependencies such as repositories and payment providers will be injected into services to improve testability and separation of concerns.

---

## 12. Test Architecture

The test architecture will separate test scenarios from implementation details.

```text
Tests / Scenarios
       |
       v
API Client / Application Boundary
       |
       v
Service Layer
       |
       v
State Machine
       |
       v
Repositories
       |
       v
In-Memory Persistence

Payment Provider
       ^
       |
Mock Payment Provider
