# Subscription & Billing Service — Test Strategy & Architecture

## Executive Summary

This test solution validates a subscription & billing service through a clean, object-oriented architecture that separates concerns into six distinct layers:

1. **Test Fixtures** — environment setup, seeding, and isolation
2. **API Client Layer** — typed HTTP interface to the service
3. **Mock Payment Provider** — test double implementing the external provider interface
4. **Assertion Layer** — repositories, DAOs, and verification helpers
5. **Test Scenarios** — organized test suites covering functional expectations
6. **Data Builders** — fluent, reusable test data construction

---

## Test Strategy

### Scope

**In Scope:**
- API contract validation (CRUD, cancellation, error handling)
- Subscription lifecycle state transitions (trialing → active → past_due → canceled)
- Webhook idempotency and duplicate delivery handling
- Persistence validation across subscriptions, invoices, and webhook events
- Mock payment provider interactions and call verification
- Business rule enforcement (no invalid transitions, correct pricing per plan)

**Out of Scope:**
- UI testing
- Real payment provider integration
- Performance/load testing
- Multi-currency, taxes, proration edge cases
- Concurrent webhook processing (bonus, if time allows)

### Test Levels

1. **API Contract Tests** — validate request/response shape, status codes, validation errors
2. **State Machine Tests** — verify every valid transition + at least 2 invalid ones
3. **Persistence Tests** — confirm subscription/invoice/event records match business logic
4. **Mock Provider Tests** — assert on call count, arguments, idempotency
5. **End-to-End Flow Tests** — full request → processing → persistence → provider interaction

---

## Real vs. Mocked/Stubbed

| Component | Real | Mocked | Reason |
|-----------|------|--------|--------|
| Subscription Service | ✓ (minimal fixture) | — | Core system under test |
| Payment Provider | — | ✓ (test double) | External dependency; we verify against contract |
| Database | ✓ (in-memory/SQLite) | — | We must validate persistence |
| Webhooks | Simulated | ✓ (test constructs payloads) | Allows controlled testing of signatures, duplicates |
| HTTP Transport | ✓ (Express/Supertest) | — | Real HTTP semantics for signature validation |

---

## Design Patterns Applied

### 1. State Pattern (Subscription Lifecycle)
**Problem:** Subscription state is complex; invalid transitions must be structurally hard to reach, not caught by runtime checks.

**Solution:** Each subscription state (Trialing, Active, PastDue, Canceled) is a class implementing the State interface, with allowed transitions defined on the state object, not scattered across the service.

**Location:** `src/domain/subscription-states.ts`

**Benefit:** Compiler + runtime enforcement; new states/transitions are explicit and localized.

---

### 2. Builder Pattern (Test Data Construction)
**Problem:** Tests need subscriptions, customers, webhook payloads with many optional fields. Constructing literals in every test is repetitive and obscures intent.

**Solution:** Fluent builders (`SubscriptionBuilder`, `CustomerBuilder`, `WebhookPayloadBuilder`) allow tests to express: "give me a basic pro subscription, but with a specific plan" in a single readable line.

**Location:** `src/test/builders/`

**Benefit:** Tests read as intent. Setup noise is eliminated. Changing defaults affects all tests automatically.

---

### 3. Adapter/Strategy Pattern (Payment Provider)
**Problem:** The real payment provider is external and non-deterministic. Tests need to control outcomes (success/decline/timeout) and verify call counts/arguments.

**Solution:** The service accepts a `PaymentProvider` interface. Tests inject `MockPaymentProvider` implementing the same interface with configurable behavior and call recording.

**Location:** `src/domain/payment-provider.ts` (interface), `src/test/mocks/mock-payment-provider.ts` (implementation)

**Benefit:** No real network calls; deterministic, fast tests. Interface is testable and swappable.

---

### 4. Repository/DAO Pattern (Persistence Access)
**Problem:** Tests should validate persistence without raw query strings scattered through test code. Queries are hard to maintain and hide database structure.

**Solution:** Repositories (`SubscriptionRepository`, `InvoiceRepository`, `WebhookEventRepository`) encapsulate all data access. Tests call `repo.findById()`, `repo.findByCustomerId()`, etc.

**Location:** `src/test/repositories/`

**Benefit:** Persistence validation is localized. Database schema changes affect only repositories. Tests remain readable.

---

### 5. Factory Pattern (Environment Setup)
**Problem:** Each test needs a fresh service instance with seeded data, a mock provider, and isolated database state.

**Solution:** `TestFixture` factory constructs the entire environment: service instance, mock provider, repositories, cleanup hooks.

**Location:** `src/test/fixtures/test-fixture.ts`

**Benefit:** Consistent setup across all tests. Isolation is enforced. Teardown is deterministic.

---

### 6. Observer/Event Pattern (Webhook Event Recording)
**Problem:** Tests must verify that webhooks are processed exactly once (idempotency). Duplicate webhook IDs must not create duplicate side effects.

**Solution:** `WebhookEventRepository` tracks processed `event_id` values. Before processing, the service checks if an event was already seen. If so, it returns idempotent result without repeating side effects.

**Location:** `src/domain/services/webhook-processor.ts`

**Benefit:** Idempotency is provable via assertions. Duplicates create no persistence corruption.

---

## API Validation Approach

### Endpoints Covered

```
POST   /subscriptions              → create subscription
GET    /subscriptions/{id}         → retrieve subscription
POST   /subscriptions/{id}/cancel  → cancel subscription
POST   /webhooks/payment-provider  → inbound webhook
```

### Validation Covered

- ✓ Successful creation with correct initial state (trialing or active per plan)
- ✓ Validation errors (unknown plan, invalid customer, missing fields)
- ✓ Correct HTTP status codes (200, 201, 400, 404, 422)
- ✓ Response payload shape matches contract
- ✓ Webhook signature validation (HMAC-SHA256)
- ✓ Invalid/missing signatures rejected
- ✓ Malformed webhook JSON handled gracefully
- ✓ Duplicate event IDs processed idempotently

### Assertion Strategy

Use `APIAssertions` helper to validate:
- `response.status()`
- `response.body()` shape via Jest matchers or schema validation
- `response.body().subscription.state` transition correctness
- Absence of duplicate provider calls after webhook replay

---

## Database Validation Approach

### Entities Checked

1. **subscriptions**
   - Invariant: state always matches lifecycle rules
   - Checked: `state`, `plan`, `customer_id`, `created_at`, `canceled_at`

2. **invoices**
   - Invariant: every successful charge has a persisted invoice
   - Checked: `subscription_id`, `amount`, `status` (succeeded/failed), `created_at`

3. **webhook_events**
   - Invariant: each `event_id` stored; processed only once
   - Checked: `event_id`, `subscription_id`, `processed_at`, `type`

### Verification Strategy

After each operation, tests use `SubscriptionRepository`, `InvoiceRepository`, and `WebhookEventRepository` to query persisted state and assert:

- Subscription record matches API response
- No ghost invoices from failed operations
- Webhook event recorded with correct timestamp
- No duplicate invoices for replayed webhooks
- Audit log (if modeled) shows all transitions in order

### Data Cleanup

Each test fixture calls `teardown()` to:
- Clear all tables
- Reset mock provider call history
- Close database connection

---

## Mock Payment Provider / Webhook Validation

### Provider Interface

```typescript
interface PaymentProvider {
  charge(customerId: string, amount: number, idempotencyKey: string): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }>;
}
```

### Mock Implementation

`MockPaymentProvider` records:
- Every call to `charge()` with arguments
- Call count per idempotency key (verifying only one real charge per key)
- Configurable outcomes: success, decline, timeout

### Webhook Payload Construction

`WebhookPayloadBuilder` constructs signed webhooks:
- Valid signatures via HMAC-SHA256 over raw body
- Deliberately invalid signatures for negative testing
- Malformed JSON for error handling
- Replay payloads with duplicate `event_id`

### Idempotency Verification

- Send same webhook twice with identical `event_id`
- Verify: second request returns same result (200 OK, no duplicate invoice)
- Verify: `MockPaymentProvider.charge()` called only once, not twice
- Confirm: `WebhookEventRepository` has exactly one record for that event ID

---

## Test Architecture

### Directory Structure

```
src/
├── domain/
│   ├── models/
│   │   ├── subscription.ts         # Subscription entity
│   │   ├── customer.ts              # Customer entity
│   │   ├── invoice.ts               # Invoice entity
│   │   └── plan.ts                  # Plan configuration
│   ├── payment-provider.ts           # PaymentProvider interface
│   ├── subscription-states.ts        # State pattern: Trialing, Active, PastDue, Canceled
│   └── services/
│       ├── subscription-service.ts   # Core business logic
│       └── webhook-processor.ts      # Webhook handling + idempotency
├── app.ts                            # Express fixture (minimal service)
├── test/
│   ├── fixtures/
│   │   └── test-fixture.ts           # Test environment factory
│   ├── repositories/
│   │   ├── subscription-repository.ts
│   │   ├── invoice-repository.ts
│   │   └── webhook-event-repository.ts
│   ├── mocks/
│   │   ├── mock-payment-provider.ts
│   │   └── mock-database.ts          # In-memory DB
│   ├── builders/
│   │   ├── subscription-builder.ts
│   │   ├── customer-builder.ts
│   │   ├── webhook-payload-builder.ts
│   │   └── invoice-builder.ts
│   ├── helpers/
│   │   ├── api-assertions.ts         # HTTP response validation
│   │   └── persistence-assertions.ts # Database state validation
│   └── specs/
│       ├── api-contract.spec.ts
│       ├── state-machine.spec.ts
│       ├── persistence.spec.ts
│       ├── webhook-idempotency.spec.ts
│       └── provider-interaction.spec.ts
└── types/
    └── index.ts                       # TypeScript interfaces
```

### Why This Structure is Maintainable

1. **Domain layer** is independent of HTTP and database (ports & adapters concept)
2. **Test layer** is clearly separated; builders, repositories, and assertions are not mixed with test logic
3. **Fixtures** centralize environment setup; new tests don't repeat seeding
4. **Builders** make test intent obvious
5. **Assertions** are named methods, not raw expects (e.g., `assertion.shouldBeInTrialing()`)
6. **Specs** are organized by category (API, state, persistence, webhooks, provider)

Adding a new test:
1. Write spec in appropriate file (e.g., `state-machine.spec.ts`)
2. Use `testFixture.subscriptionBuilder().withPlan('pro').build()` for data
3. Call service via API client
4. Use `assertion.shouldHaveState('active')` to verify result
5. No database queries, setup noise, or builder boilerplate in the test itself

---

## Webhook & Idempotency Strategy

### Problem
Payment providers may redeliver the same webhook (network flakiness, timeout recovery). Service must process each unique event exactly once, even if the webhook arrives multiple times.

### Solution

1. **Incoming Webhook Tracking:**
   - `WebhookEventRepository` stores processed `event_id` values
   - Before processing webhook, service queries: "Have I seen this event_id before?"
   - If yes: return idempotent response (200 OK, no side effects)
   - If no: process and record event

2. **Signature Verification:**
   - Webhook includes `X-Provider-Signature` header (HMAC-SHA256 over raw body)
   - Service verifies signature using pre-shared secret
   - Invalid signature → 403 Forbidden, no processing

3. **Test Coverage:**
   - Send webhook, verify state change
   - Send identical webhook again (same event_id, valid signature)
   - Verify: response is same, no duplicate invoice created, provider.charge() not called again
   - Send webhook with invalid signature → 403
   - Send webhook with malformed JSON → 400

---

## Known Limitations & Tradeoffs

| Limitation | Reason | Mitigation |
|------------|--------|-----------|
| In-memory database (not durable across runs) | Keeps setup friction low; tests are fast | All persistence validated in-process before test ends |
| Single-threaded webhook processing | Concurrent webhooks are complex; time constraint | Can extend with queue + worker if needed |
| No production error handling (e.g., circuit breaker) | Out of scope per assignment | Test assumes provider always responds (timeout mocked) |
| Plans hardcoded (basic, pro) | Scope constraint | Extensible via `PlanRegistry` if needed |
| No multi-currency/taxes/proration | Explicitly out of scope | Base implementation provides pattern for extension |

---

## Functional Expectations Mapping

| Expectation | Test File | Coverage |
|-------------|-----------|----------|
| A) Subscription Creation & Activation | `api-contract.spec.ts`, `state-machine.spec.ts` | ✓ |
| B) Validation Failures | `api-contract.spec.ts` | ✓ |
| C) Payment Failure Handling | `state-machine.spec.ts`, `provider-interaction.spec.ts` | ✓ |
| D) Webhook Idempotency | `webhook-idempotency.spec.ts` | ✓ |
| E) State Machine Invariants | `state-machine.spec.ts` | ✓ |
| F) Mocked Provider Interaction | `provider-interaction.spec.ts` | ✓ |
| G) Persistence & Auditability | `persistence.spec.ts` | ✓ |

---

## How to Run Tests

```bash
npm install
npm test              # Run all tests
npm test -- --grep "state machine"  # Run specific suite
npm test -- --verbose                # Detailed output
```

---

## Required Invariants Validated

✓ Subscription never reaches `active` without persisted successful payment record
✓ Subscription in `canceled` never transitions again (webhooks ignored)
✓ Duplicate webhook delivery never produces duplicate invoices
✓ Payment provider mock called at most once per genuine billing attempt
✓ Persisted subscription state always matches API result
✓ Plan price/trial rules applied consistently between creation and billing
✓ Invalid state transitions rejected (e.g., `canceled` → `active`)
✓ Webhook signature validation prevents forged events

---

## AI Assistance & Review Notes

This solution was developed with AI assistance in:
- Code generation and refactoring suggestions
- Design pattern implementations
- Test scenario scaffolding

Personal review & validation:
- ✓ All business logic manually verified against assignment requirements
- ✓ Design patterns justified in context (not boilerplate)
- ✓ Test scenarios manually designed to cover functional expectations A–G
- ✓ Persistence validation reviewed for correctness
- ✓ Webhook idempotency logic verified
- ✓ State machine transitions manually validated against lifecycle diagram

---
