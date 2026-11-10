# Subscription & Billing Service - API Automation Test Framework

## Overview

This is a comprehensive API automation test framework for a Subscription & Billing Service, demonstrating object-oriented test design, design patterns, and multi-layer validation.

**Assignment**: [SDET_ASSIGNMENT.md](./SDET_ASSIGNMENT.md)

## Quick Start

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test suites
npm test tests/unit/states              # State machine tests (✅ 23 passing)
npm test tests/integration/api          # API contract tests (✅ 21 passing)
npm test tests/integration/database     # Database validation tests (TODO)
npm test tests/e2e                      # End-to-end flow tests (TODO)

# Run with coverage
npm run test:coverage

# Watch mode (for development)
npm run test:watch
```

## Current Test Results

```
✅ ALL TESTS PASSING (44 tests)

PASS tests/unit/states/SubscriptionState.test.ts
  Subscription State Machine ✓ (23 tests)

PASS tests/integration/api/createSubscription.test.ts
  API Integration - POST /subscriptions ✓ (6 tests)

PASS tests/integration/api/getSubscription.test.ts
  API Integration - GET /subscriptions/:id ✓ (3 tests)

PASS tests/integration/api/cancelSubscription.test.ts
  API Integration - POST /subscriptions/:id/cancel ✓ (5 tests)

PASS tests/integration/api/webhookEndpoint.test.ts
  API Integration - POST /webhooks/payment-provider ✓ (7 tests)

Test Suites: 5 passed, 5 total
Tests:       44 passed, 44 total
Time:        ~8 seconds
```

## Project Structure

```
sdet-assignments/
├── src/                                    # Service implementation
│   ├── domain/
│   │   └── subscription/
│   │       ├── types.ts                    # Domain types & interfaces
│   │       ├── SubscriptionService.ts      # ✅ Business logic
│   │       └── states/                     # ✅ State Pattern implementation
│   │           ├── SubscriptionState.ts
│   │           ├── TrialingState.ts
│   │           ├── ActiveState.ts
│   │           ├── PastDueState.ts
│   │           └── CanceledState.ts
│   │
│   ├── api/                                # ✅ Express API
│   │   ├── app.ts
│   │   ├── subscriptionRoutes.ts
│   │   └── webhookRoutes.ts
│   │
│   └── infrastructure/
│       ├── payment/                        # ✅ Strategy Pattern
│       │   ├── PaymentProvider.ts
│       │   └── MockPaymentProvider.ts
│       │
│       └── persistence/                    # ✅ Repository Pattern
│           ├── SubscriptionRepository.ts
│           ├── InvoiceRepository.ts
│           ├── WebhookEventRepository.ts
│           ├── InMemoryDatabase.ts
│           ├── InMemorySubscriptionRepository.ts
│           ├── InMemoryInvoiceRepository.ts
│           └── InMemoryWebhookEventRepository.ts
│
├── tests/
│   ├── builders/                           # ✅ Builder + Factory Patterns
│   │   ├── SubscriptionBuilder.ts
│   │   ├── InvoiceBuilder.ts
│   │   └── WebhookPayloadFactory.ts
│   │
│   ├── helpers/
│   │   └── DatabaseAssertions.ts
│   │
│   ├── integration/
│   │   ├── setup.ts                        # ✅ Test environment setup
│   │   └── api/                            # ✅ 21 tests passing
│   │       ├── createSubscription.test.ts
│   │       ├── getSubscription.test.ts
│   │       ├── cancelSubscription.test.ts
│   │       └── webhookEndpoint.test.ts
│   │
│   ├── unit/
│   │   └── states/
│   │       └── SubscriptionState.test.ts   # ✅ 23 tests passing
│   │
│   ├── integration/ (database + provider - TODO)
│   │   ├── database/
│   │   └── payment-provider/
│   │
│   └── e2e/ (TODO)
│
├── docs/
│   ├── API_AUTOMATION_FRAMEWORK_DESIGN.md  # Complete design document
│   └── QUICK_START.md                      # Quick reference guide
│
└── README.md                               # This file
```

## Design Patterns Implemented

### 1. ✅ State Pattern - Subscription Lifecycle

**Purpose**: Enforce valid state transitions structurally, making invalid transitions impossible.

**Valid Transitions**:
```
trialing → active      (payment success)
trialing → past_due    (payment failure)
active   → past_due    (recurring charge fails)
past_due → active      (retry succeeds)
past_due → canceled    (retries exhausted)
active   → canceled    (API cancel)
trialing → canceled    (API cancel)
```

**Invalid Transitions** (enforced):
```
canceled → active      ❌ (stays canceled)
canceled → past_due    ❌ (stays canceled)
```

### 2. ✅ Builder Pattern - Test Data

Fluent API for readable test data creation:
```typescript
const subscription = new SubscriptionBuilder()
  .withCustomerId('cust_001')
  .withPlan('pro')
  .active()
  .build();
```

### 3. ✅ Strategy Pattern - Payment Provider

Mock external payment provider with interaction verification:
```typescript
mockProvider.simulateDecline();
await service.chargeCustomer(...);
expect(mockProvider.getCallCount()).toBe(1);
```

### 4. ✅ Repository Pattern - Database Access

Abstract persistence layer:
- `InMemorySubscriptionRepository`
- `InMemoryInvoiceRepository`
- `InMemoryWebhookEventRepository`

### 5. ✅ Factory Pattern - Webhook Payloads

Generate signed webhook payloads:
```typescript
const webhook = WebhookPayloadFactory.createPaymentSucceeded(subId, invId);
const signature = WebhookPayloadFactory.signPayload(webhook);
```

## Test Strategy

| Level | Purpose | Status |
|-------|---------|--------|
| **Unit Tests** | State machine logic | ✅ 23 passing |
| **API Integration Tests** | HTTP endpoints + validation | ✅ 21 passing |
| **Database Tests** | Persistence validation | 📋 Planned |
| **E2E Tests** | Full lifecycle flows | 📋 Planned |

## Key Invariants Validated

1. ✅ **Terminal state**: `canceled` subscriptions never transition
2. ✅ **State transitions**: All valid transitions work, invalid rejected
3. ✅ **Webhook idempotency**: Duplicate webhooks processed once
4. ✅ **Webhook security**: Invalid signatures rejected (401/403)
5. ✅ **API validation**: Missing/invalid data returns proper errors

## Documentation

- **Complete Design**: [API_AUTOMATION_FRAMEWORK_DESIGN.md](API_AUTOMATION_FRAMEWORK_DESIGN.md)
- **Quick Reference**: [QUICK_START.md](QUICK_START.md)
- **Assignment**: [SDET_ASSIGNMENT.md](SDET_ASSIGNMENT.md)

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript |
| Test Runner | Jest |
| HTTP Testing | Supertest |
| Database | In-Memory (Map) |
| Mocking | Jest + Custom |

## Implementation Progress

### Phase 1: ✅ Complete
- [x] Project setup
- [x] Design patterns implementation
- [x] State machine + unit tests (23 passing)

### Phase 2: ✅ Complete
- [x] API endpoints (Express)
- [x] Subscription service layer
- [x] Webhook handler with signature validation
- [x] API integration tests (21 passing)
- [x] Webhook security tests
- [x] Idempotency validation

### Phase 3: 📋 Optional Extensions
- [ ] Database-specific persistence tests
- [ ] Payment provider mock interaction tests
- [ ] End-to-end lifecycle flow tests
- [ ] Performance/load tests

---

**Built as part of SDET API Automation Assignment**
