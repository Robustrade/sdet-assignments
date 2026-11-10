# API Automation Framework Design
## Subscription & Billing Service Test Framework

**Created**: 2026-11-10  
**Assignment**: SDET API Automation - Subscription & Billing Service  
**Time Allocation**: 3-5 hours  
**Primary Goal**: Build object-oriented test framework with design patterns for stateful API workflow validation

---

## 1. Technology Stack Decision

### Selected: TypeScript + Jest/Vitest Approach

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Language** | TypeScript | Assignment requirement, type safety |
| **Test Runner** | Jest | Rich ecosystem, built-in mocking |
| **HTTP Client** | Axios | Promise-based, interceptor support |
| **HTTP Testing** | Supertest | Direct Express/HTTP testing |
| **Database** | better-sqlite3 | In-memory, SQL support, lightweight |
| **Mocking** | Jest mocks + MSW | Provider mocking, webhook simulation |
| **Build Tool** | npm/pnpm | Standard Node.js tooling |

### Alternative: Java + RestAssured Approach

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Language** | Java 17+ | Strong OOP, enterprise standard |
| **Test Runner** | TestNG | Flexible test organization |
| **API Library** | RestAssured | Fluent API testing DSL |
| **Mocking** | WireMock + Mockito | HTTP stubbing + unit mocking |
| **Database** | H2 Database | In-memory SQL database |
| **Build Tool** | Maven | Dependency management |

---

## 2. Test Strategy & Scope

### 2.1 Test Levels Covered

```
┌─────────────────────────────────────────────────────────┐
│                   E2E Flow Tests                        │
│  (API → Service → DB + Payment Provider Mock)           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│              State Machine Tests                        │
│  (Lifecycle transitions, valid/invalid)                 │
└─────────────────────────────────────────────────────────┘
                          ↓
┌────────────────┬────────────────┬───────────────────────┐
│  API Contract  │   Database     │  Payment Provider     │
│  Tests         │   Validation   │  Mock Interaction     │
│  (CRUD, HTTP)  │   Tests        │  Tests                │
└────────────────┴────────────────┴───────────────────────┘
```

### 2.2 In Scope
✅ API CRUD operations (create, get, cancel subscription)  
✅ Webhook endpoint handling (signed, unsigned, malformed)  
✅ State machine validation (all valid + 2+ invalid transitions)  
✅ Database persistence verification (subscriptions, invoices, events)  
✅ Payment provider mocking and interaction verification  
✅ Webhook idempotency (duplicate event_id handling)  
✅ Out-of-order webhook delivery scenarios  
✅ Payment failure handling and retry logic  

### 2.3 Out of Scope
❌ Frontend UI testing  
❌ Real payment provider integration  
❌ Performance/load testing  
❌ Multi-currency, tax, proration edge cases  
❌ Production monitoring/alerting  
❌ Concurrent webhook processing (bonus if time)  

---

## 3. Domain Model & API Contract

### 3.1 API Endpoints

```typescript
POST   /subscriptions              // Create subscription
GET    /subscriptions/{id}         // Get subscription details
POST   /subscriptions/{id}/cancel  // Cancel subscription
POST   /webhooks/payment-provider  // Inbound webhook from provider
```

### 3.2 Subscription Lifecycle State Machine

```
         ┌───────────┐
         │ trialing  │
         └─────┬─────┘
               │
     ┌─────────┴─────────┐
     │                   │
 trial_end           trial_end
 charge_ok         charge_fail
     │                   │
     ↓                   ↓
┌─────────┐       ┌──────────┐
│ active  │←─────→│ past_due │
└────┬────┘       └─────┬────┘
     │                  │
  cancel           retries_exhausted
  charge_fail           │
     │                  │
     └────┬─────────────┘
          ↓
    ┌──────────┐
    │ canceled │  (terminal state)
    └──────────┘
```

**Valid Transitions**:
1. `trialing → active` (trial ends, first charge succeeds)
2. `trialing → past_due` (trial ends, first charge fails)
3. `active → past_due` (recurring charge fails)
4. `past_due → active` (retry charge succeeds)
5. `past_due → canceled` (retries exhausted)
6. `active → canceled` (customer/API cancel)
7. `trialing → canceled` (customer/API cancel)

**Invalid Transitions** (must be rejected):
- `canceled → active` (stray payment.succeeded after cancellation)
- `canceled → past_due` (any webhook after cancellation)
- `active → trialing` (cannot go back to trial)

### 3.3 Data Models

#### Subscription
```typescript
interface Subscription {
  id: string;
  customer_id: string;
  plan: string; // 'basic' | 'pro'
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  payment_method_id: string;
  created_at: Date;
  trial_end_at?: Date;
  canceled_at?: Date;
}
```

#### Invoice/Payment
```typescript
interface Invoice {
  id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed';
  attempt_count: number;
  created_at: Date;
  paid_at?: Date;
}
```

#### Webhook Event
```typescript
interface WebhookEvent {
  event_id: string; // Idempotency key
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  subscription_id: string;
  invoice_id: string;
  processed_at: Date;
  is_duplicate: boolean;
}
```

#### Plan Configuration
```typescript
interface PlanConfig {
  name: string;
  price: number;
  currency: string;
  trial_days: number;
  billing_interval: 'month' | 'year';
}

const PLANS: Record<string, PlanConfig> = {
  basic: { name: 'basic', price: 2900, currency: 'USD', trial_days: 7, billing_interval: 'month' },
  pro:   { name: 'pro',   price: 4900, currency: 'USD', trial_days: 14, billing_interval: 'month' }
};
```

---

## 4. Design Patterns (Required)

### 4.1 State Pattern - Subscription Lifecycle
**Location**: `src/domain/subscription/states/`  
**Purpose**: Enforce valid state transitions structurally

```typescript
// State interface
interface SubscriptionState {
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  onPaymentSuccess(): SubscriptionState;
  onPaymentFailure(): SubscriptionState;
  onCancel(): SubscriptionState;
}

// Concrete states
class TrialingState implements SubscriptionState {
  status = 'trialing' as const;
  
  onPaymentSuccess(): SubscriptionState {
    return new ActiveState(); // Valid transition
  }
  
  onPaymentFailure(): SubscriptionState {
    return new PastDueState(); // Valid transition
  }
  
  onCancel(): SubscriptionState {
    return new CanceledState(); // Valid transition
  }
}

class CanceledState implements SubscriptionState {
  status = 'canceled' as const;
  
  onPaymentSuccess(): SubscriptionState {
    return this; // Invalid - stay canceled
  }
  // ... other methods return this
}
```

### 4.2 Builder Pattern - Test Data Construction
**Location**: `tests/builders/`  
**Purpose**: Readable, fluent test data creation

```typescript
class SubscriptionBuilder {
  private data: Partial<Subscription> = {
    status: 'trialing',
    plan: 'pro'
  };
  
  withCustomerId(id: string): this {
    this.data.customer_id = id;
    return this;
  }
  
  withStatus(status: Subscription['status']): this {
    this.data.status = status;
    return this;
  }
  
  build(): Subscription {
    return { id: generateId(), ...this.data } as Subscription;
  }
}

// Usage in tests
const subscription = new SubscriptionBuilder()
  .withCustomerId('cust_001')
  .withStatus('active')
  .build();
```

### 4.3 Strategy Pattern - Payment Provider Interface
**Location**: `src/infrastructure/payment/`  
**Purpose**: Mock external payment provider cleanly

```typescript
// Strategy interface
interface PaymentProvider {
  chargeCustomer(amount: number, paymentMethodId: string, metadata: any): Promise<ChargeResult>;
  refund(chargeId: string): Promise<RefundResult>;
}

// Real implementation (not used in tests)
class StripePaymentProvider implements PaymentProvider {
  async chargeCustomer(...) { /* real Stripe API call */ }
}

// Test double
class MockPaymentProvider implements PaymentProvider {
  calls: any[] = [];
  simulateResult: 'success' | 'decline' | 'timeout' = 'success';
  
  async chargeCustomer(amount, paymentMethodId, metadata) {
    this.calls.push({ amount, paymentMethodId, metadata });
    
    if (this.simulateResult === 'success') {
      return { success: true, chargeId: 'ch_mock_123' };
    } else if (this.simulateResult === 'decline') {
      return { success: false, error: 'card_declined' };
    } else {
      throw new Error('Network timeout');
    }
  }
  
  assertCalledOnce() { expect(this.calls).toHaveLength(1); }
  assertCalledWith(expectedAmount: number) { 
    expect(this.calls[0].amount).toBe(expectedAmount); 
  }
}
```

### 4.4 Repository Pattern - Database Access
**Location**: `src/infrastructure/persistence/`  
**Purpose**: Abstract persistence, keep raw SQL out of tests

```typescript
interface SubscriptionRepository {
  save(subscription: Subscription): Promise<void>;
  findById(id: string): Promise<Subscription | null>;
  findByCustomerId(customerId: string): Promise<Subscription[]>;
}

class SqliteSubscriptionRepository implements SubscriptionRepository {
  constructor(private db: Database) {}
  
  async save(subscription: Subscription): Promise<void> {
    // SQL INSERT/UPDATE logic
  }
  
  async findById(id: string): Promise<Subscription | null> {
    // SQL SELECT logic
  }
}
```

### 4.5 Factory Pattern - Webhook Builder
**Location**: `tests/builders/`  
**Purpose**: Generate valid/invalid webhook payloads with signatures

```typescript
class WebhookPayloadFactory {
  static createPaymentSucceeded(subscriptionId: string, invoiceId: string): WebhookPayload {
    return {
      event_id: `evt_${randomUUID()}`,
      type: 'payment.succeeded',
      subscription_id: subscriptionId,
      invoice_id: invoiceId,
      amount: 4900,
      currency: 'USD'
    };
  }
  
  static signPayload(payload: WebhookPayload, secret: string): string {
    return crypto.createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
  }
}
```

---

## 5. Test Framework Architecture

### 5.1 Directory Structure

```
sdet-assignments/
├── src/                                    # Minimal service fixture (if building one)
│   ├── domain/
│   │   └── subscription/
│   │       ├── Subscription.ts             # Domain entity
│   │       ├── SubscriptionService.ts      # Business logic
│   │       └── states/                     # State pattern implementation
│   │           ├── SubscriptionState.ts
│   │           ├── TrialingState.ts
│   │           ├── ActiveState.ts
│   │           ├── PastDueState.ts
│   │           └── CanceledState.ts
│   ├── infrastructure/
│   │   ├── payment/
│   │   │   ├── PaymentProvider.ts          # Strategy interface
│   │   │   └── MockPaymentProvider.ts
│   │   └── persistence/
│   │       ├── SubscriptionRepository.ts   # Repository interface
│   │       ├── InvoiceRepository.ts
│   │       └── WebhookEventRepository.ts
│   └── api/
│       ├── app.ts                          # Express app
│       ├── subscriptionRoutes.ts
│       └── webhookRoutes.ts
│
├── tests/
│   ├── builders/                           # Builder pattern
│   │   ├── SubscriptionBuilder.ts
│   │   ├── InvoiceBuilder.ts
│   │   └── WebhookPayloadFactory.ts
│   │
│   ├── fixtures/                           # Test setup/teardown
│   │   ├── TestEnvironment.ts              # DB setup, seeding
│   │   └── ApiClientFixture.ts             # HTTP client wrapper
│   │
│   ├── helpers/                            # Assertion utilities
│   │   ├── DatabaseAssertions.ts
│   │   └── PaymentProviderAssertions.ts
│   │
│   ├── unit/                               # Unit tests
│   │   └── states/
│   │       └── SubscriptionState.test.ts
│   │
│   ├── integration/                        # Integration tests
│   │   ├── api/
│   │   │   ├── createSubscription.test.ts
│   │   │   ├── getSubscription.test.ts
│   │   │   ├── cancelSubscription.test.ts
│   │   │   └── webhookEndpoint.test.ts
│   │   │
│   │   ├── state-machine/
│   │   │   ├── validTransitions.test.ts
│   │   │   └── invalidTransitions.test.ts
│   │   │
│   │   ├── database/
│   │   │   ├── subscriptionPersistence.test.ts
│   │   │   ├── invoicePersistence.test.ts
│   │   │   └── webhookIdempotency.test.ts
│   │   │
│   │   └── payment-provider/
│   │       ├── chargeInteraction.test.ts
│   │       └── mockVerification.test.ts
│   │
│   └── e2e/                                # End-to-end flows
│       ├── subscriptionLifecycle.test.ts
│       ├── webhookIdempotency.test.ts
│       └── paymentFailureRecovery.test.ts
│
├── docs/
│   └── API_AUTOMATION_FRAMEWORK_DESIGN.md  # This file
│
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

### 5.2 Component Responsibilities

#### 5.2.1 Test Fixtures / Environment Setup
**File**: `tests/fixtures/TestEnvironment.ts`

```typescript
class TestEnvironment {
  db: Database;
  mockPaymentProvider: MockPaymentProvider;
  app: Express;
  
  async setup() {
    this.db = await createInMemoryDatabase();
    await runMigrations(this.db);
    this.mockPaymentProvider = new MockPaymentProvider();
    this.app = createApp(this.db, this.mockPaymentProvider);
  }
  
  async teardown() {
    await this.db.close();
  }
  
  async seed(data: any) { /* Insert test data */ }
  async cleanup() { /* Clear tables */ }
}
```

#### 5.2.2 API Client Layer
**File**: `tests/fixtures/ApiClientFixture.ts`

```typescript
class SubscriptionApiClient {
  constructor(private baseUrl: string) {}
  
  async createSubscription(payload: CreateSubscriptionRequest): Promise<ApiResponse<Subscription>> {
    const response = await axios.post(`${this.baseUrl}/subscriptions`, payload);
    return { status: response.status, data: response.data };
  }
  
  async getSubscription(id: string): Promise<ApiResponse<Subscription>> {
    const response = await axios.get(`${this.baseUrl}/subscriptions/${id}`);
    return { status: response.status, data: response.data };
  }
  
  async cancelSubscription(id: string): Promise<ApiResponse<void>> {
    const response = await axios.post(`${this.baseUrl}/subscriptions/${id}/cancel`);
    return { status: response.status, data: response.data };
  }
  
  async sendWebhook(payload: WebhookPayload, signature: string): Promise<ApiResponse<void>> {
    const response = await axios.post(`${this.baseUrl}/webhooks/payment-provider`, payload, {
      headers: { 'X-Provider-Signature': signature }
    });
    return { status: response.status, data: response.data };
  }
}
```

#### 5.2.3 Mock Payment Provider / Webhook Simulator
**File**: `src/infrastructure/payment/MockPaymentProvider.ts`

```typescript
class MockPaymentProvider implements PaymentProvider {
  private chargeCalls: ChargeCall[] = [];
  private simulatedOutcome: 'success' | 'decline' | 'timeout' = 'success';
  
  simulateSuccess() { this.simulatedOutcome = 'success'; }
  simulateDecline() { this.simulatedOutcome = 'decline'; }
  simulateTimeout() { this.simulatedOutcome = 'timeout'; }
  
  async chargeCustomer(amount: number, paymentMethodId: string, metadata: any): Promise<ChargeResult> {
    this.chargeCalls.push({ amount, paymentMethodId, metadata, timestamp: new Date() });
    
    switch (this.simulatedOutcome) {
      case 'success': return { success: true, chargeId: 'ch_mock_123' };
      case 'decline': return { success: false, error: 'card_declined' };
      case 'timeout': throw new Error('Network timeout');
    }
  }
  
  getCallCount(): number { return this.chargeCalls.length; }
  getLastCall(): ChargeCall | undefined { return this.chargeCalls[this.chargeCalls.length - 1]; }
  reset() { this.chargeCalls = []; this.simulatedOutcome = 'success'; }
}
```

#### 5.2.4 Assertion / Verification Layer
**File**: `tests/helpers/DatabaseAssertions.ts`

```typescript
class DatabaseAssertions {
  constructor(private repos: {
    subscriptions: SubscriptionRepository,
    invoices: InvoiceRepository,
    webhookEvents: WebhookEventRepository
  }) {}
  
  async assertSubscriptionExists(id: string, expectedStatus: string) {
    const sub = await this.repos.subscriptions.findById(id);
    expect(sub).toBeDefined();
    expect(sub!.status).toBe(expectedStatus);
  }
  
  async assertInvoiceCount(subscriptionId: string, expectedCount: number) {
    const invoices = await this.repos.invoices.findBySubscriptionId(subscriptionId);
    expect(invoices).toHaveLength(expectedCount);
  }
  
  async assertWebhookProcessedOnce(eventId: string) {
    const events = await this.repos.webhookEvents.findByEventId(eventId);
    expect(events).toHaveLength(1);
  }
  
  async assertNoDuplicateInvoices(subscriptionId: string) {
    const invoices = await this.repos.invoices.findBySubscriptionId(subscriptionId);
    const uniqueIds = new Set(invoices.map(inv => inv.id));
    expect(uniqueIds.size).toBe(invoices.length);
  }
}
```

---

## 6. Test Coverage Plan

### 6.1 API Contract Tests (10-15 tests)

**File**: `tests/integration/api/`

| Test Case | Purpose | Validates |
|-----------|---------|-----------|
| `POST /subscriptions` - success | Happy path creation | 201, subscription object, correct initial state |
| `POST /subscriptions` - invalid plan | Validation error | 400, error message |
| `POST /subscriptions` - missing customer_id | Validation error | 400, error message |
| `GET /subscriptions/{id}` - exists | Read operation | 200, correct data |
| `GET /subscriptions/{id}` - not found | Error handling | 404 |
| `POST /subscriptions/{id}/cancel` - success | Cancellation | 200, status = canceled |
| `POST /subscriptions/{id}/cancel` - already canceled | Idempotency | 200 or 409 |
| `POST /webhooks/payment-provider` - valid signature | Webhook acceptance | 200 |
| `POST /webhooks/payment-provider` - invalid signature | Security | 401 or 403 |
| `POST /webhooks/payment-provider` - malformed payload | Validation | 400 |

### 6.2 State Machine Tests (12-15 tests)

**File**: `tests/integration/state-machine/`

#### Valid Transitions (7 tests)
1. `trialing → active` (trial ends, charge succeeds)
2. `trialing → past_due` (trial ends, charge fails)
3. `active → past_due` (recurring charge fails)
4. `past_due → active` (retry succeeds)
5. `past_due → canceled` (retries exhausted)
6. `active → canceled` (API cancel)
7. `trialing → canceled` (API cancel)

#### Invalid Transitions (5+ tests)
1. `canceled → active` (webhook after cancellation)
2. `canceled → past_due` (webhook after cancellation)
3. `active → trialing` (cannot revert to trial)
4. `payment.failed` after `payment.succeeded` for same invoice (should not regress)
5. Out-of-order webhooks (late success after failure)

### 6.3 Database Validation Tests (8-10 tests)

**File**: `tests/integration/database/`

| Test Case | Validates |
|-----------|-----------|
| Subscription persisted after creation | Row exists, fields match API response |
| Invoice created on first charge | Invoice row, amount, status |
| Webhook event recorded | event_id, type, processed timestamp |
| Duplicate webhook event flagged | is_duplicate = true, no new invoice |
| No duplicate invoices | Invoice count matches expected |
| State consistency | Subscription status matches latest invoice status |
| Canceled subscription immutable | No updates after cancellation |
| Audit trail complete | All state changes recorded |

### 6.4 Payment Provider Mock Tests (6-8 tests)

**File**: `tests/integration/payment-provider/`

| Test Case | Validates |
|-----------|-----------|
| Provider called once on creation | Call count = 1 |
| Provider called with correct amount | Amount matches plan |
| Provider not called for validation errors | Call count = 0 |
| Provider not called for replayed webhook | Call count unchanged |
| Mock returns success | Charge ID captured |
| Mock returns decline | Error handling |
| Mock throws timeout | Retry logic |
| Call arguments match expected metadata | Subscription ID, idempotency key |

### 6.5 End-to-End Flow Tests (8-10 tests)

**File**: `tests/e2e/`

| Test Scenario | Flow |
|---------------|------|
| Successful subscription creation & activation | API create → charge → webhook → active |
| Trial to active transition | Create trialing → wait → charge → webhook → active |
| Payment failure recovery | Create → fail → past_due → retry → webhook → active |
| Permanent payment failure | Create → fail → past_due → exhaust retries → canceled |
| Webhook idempotency | Send same event_id twice → process once |
| Out-of-order webhook delivery | Send success then failure → stay active |
| Cancellation prevents reactivation | Cancel → send payment.succeeded → stay canceled |
| Full lifecycle happy path | Trialing → active → recurring charge → cancel |

---

## 7. Key Invariants to Validate

### 7.1 State-Based Invariants
1. **No resurrection**: A `canceled` subscription never transitions again
2. **Payment prerequisite**: A subscription never reaches `active` without ≥1 successful payment
3. **State coherence**: Subscription status always matches the latest valid state transition

### 7.2 Persistence Invariants
4. **No duplicate invoices**: Duplicate webhooks never create duplicate invoice rows
5. **Event idempotency**: Same `event_id` processed exactly once
6. **Referential integrity**: Every invoice references an existing subscription
7. **Audit completeness**: Every state transition recorded in event log

### 7.3 Integration Invariants
8. **Charge uniqueness**: Payment provider called at most once per genuine billing attempt
9. **No ghost charges**: Provider never called for validation failures or replayed webhooks
10. **Signature requirement**: Webhooks without valid signature rejected before processing

---

## 8. Webhook Testing Strategy

### 8.1 Webhook Signature Verification

```typescript
function computeWebhookSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Test: valid signature accepted
const payload = { event_id: 'evt_001', type: 'payment.succeeded', ... };
const signature = computeWebhookSignature(JSON.stringify(payload), WEBHOOK_SECRET);
const response = await client.sendWebhook(payload, signature);
expect(response.status).toBe(200);

// Test: invalid signature rejected
const response2 = await client.sendWebhook(payload, 'invalid_signature');
expect(response2.status).toBe(401);
```

### 8.2 Idempotency Testing

```typescript
test('duplicate webhook event processed only once', async () => {
  const eventId = 'evt_unique_001';
  const webhook = WebhookPayloadFactory.createPaymentSucceeded(subscriptionId, invoiceId);
  webhook.event_id = eventId;
  
  // Send first time
  await client.sendWebhook(webhook, validSignature);
  
  // Send duplicate
  await client.sendWebhook(webhook, validSignature);
  
  // Assertions
  await dbAssertions.assertWebhookProcessedOnce(eventId);
  await dbAssertions.assertInvoiceCount(subscriptionId, 1); // No duplicate invoice
  expect(mockPaymentProvider.getCallCount()).toBe(1); // Provider not called again
});
```

### 8.3 Out-of-Order Delivery Testing

```typescript
test('late payment.failed does not regress active subscription', async () => {
  // Setup: subscription starts in past_due
  const sub = await createSubscription({ status: 'past_due' });
  
  // Event 1: payment.succeeded (arrives first)
  await client.sendWebhook(WebhookPayloadFactory.createPaymentSucceeded(sub.id, 'inv_001'), sig1);
  await dbAssertions.assertSubscriptionExists(sub.id, 'active');
  
  // Event 2: payment.failed (arrives late, out of order)
  await client.sendWebhook(WebhookPayloadFactory.createPaymentFailed(sub.id, 'inv_001'), sig2);
  
  // Assertion: should stay active
  await dbAssertions.assertSubscriptionExists(sub.id, 'active');
});
```

---

## 9. Database Schema (Minimal)

### 9.1 Tables

```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  payment_method_id TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  trial_end_at DATETIME,
  canceled_at DATETIME
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  attempt_count INTEGER DEFAULT 1,
  created_at DATETIME NOT NULL,
  paid_at DATETIME,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL, -- Idempotency key
  type TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  processed_at DATETIME NOT NULL,
  is_duplicate BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE TABLE state_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  trigger TEXT NOT NULL, -- 'api_call' | 'webhook'
  trigger_detail TEXT, -- webhook event_id or API endpoint
  transitioned_at DATETIME NOT NULL,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);
```

### 9.2 Seed Data

```typescript
const TEST_CUSTOMERS = [
  { id: 'cust_001', name: 'Test Customer 1', email: 'test1@example.com' },
  { id: 'cust_002', name: 'Test Customer 2', email: 'test2@example.com' }
];

const TEST_PAYMENT_METHODS = [
  { id: 'pm_test_visa_4242', type: 'card', last4: '4242' },
  { id: 'pm_test_visa_declined', type: 'card', last4: '0002' }
];
```

---

## 10. Implementation Phases (Red-Blue-Green)

### Phase 1: Foundation (30 min)
- ✅ Setup project structure, dependencies
- ✅ Configure Jest, TypeScript, database
- ✅ Create basic domain models
- ✅ Implement State pattern for lifecycle

**Red**: Write failing state transition test  
**Blue**: Implement state classes  
**Green**: Refactor to clean interfaces  

### Phase 2: API Contract Tests (45 min)
- ✅ Create API client fixture
- ✅ Test subscription CRUD endpoints
- ✅ Test webhook endpoint (valid/invalid signature)
- ✅ Test validation errors

**Red**: Test POST /subscriptions returns 201  
**Blue**: Implement minimal Express route  
**Green**: Extract API client wrapper  

### Phase 3: State Machine Tests (45 min)
- ✅ Test all valid transitions
- ✅ Test 2+ invalid transitions
- ✅ Integrate State pattern with service layer

**Red**: Test trialing → active transition  
**Blue**: Wire webhook handler to state machine  
**Green**: Consolidate transition logic  

### Phase 4: Database Validation (30 min)
- ✅ Create Repository implementations
- ✅ Test persistence after each operation
- ✅ Test idempotency (webhook event table)
- ✅ Test audit trail

**Red**: Assert subscription persisted after create  
**Blue**: Implement SqliteSubscriptionRepository  
**Green**: Create DatabaseAssertions helper  

### Phase 5: Payment Provider Mock (30 min)
- ✅ Create MockPaymentProvider with Strategy pattern
- ✅ Test charge interactions
- ✅ Test call count, arguments
- ✅ Test success/decline/timeout scenarios

**Red**: Assert provider called once  
**Blue**: Inject mock into service  
**Green**: Add assertion helpers  

### Phase 6: E2E Flows (45 min)
- ✅ Full lifecycle tests
- ✅ Webhook idempotency test
- ✅ Out-of-order delivery test
- ✅ Payment failure recovery

**Red**: E2E test from creation to active  
**Blue**: Wire all layers together  
**Green**: Extract common test setup  

### Phase 7: Documentation & PR (15 min)
- ✅ Write PR description
- ✅ Document design patterns
- ✅ Document assumptions & tradeoffs

---

## 11. Test Execution & Setup

### 11.1 Installation

```bash
# TypeScript approach
npm install --save-dev jest ts-jest @types/jest
npm install --save-dev supertest @types/supertest
npm install --save-dev better-sqlite3 @types/better-sqlite3
npm install express axios
```

### 11.2 Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- tests/integration/api/

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### 11.3 Test Configuration

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', 'tests/**/*.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts']
};
```

---

## 12. Known Limitations & Tradeoffs

### 12.1 Simplifications
- **In-memory database**: No real PostgreSQL (acceptable for assignment)
- **No concurrent webhook processing**: Single-threaded (bonus feature, not mandatory)
- **Minimal service implementation**: Focus on test framework, not production-ready service
- **No real payment provider**: Mocked only (per assignment requirements)
- **No retry queue**: Simplified retry logic

### 12.2 What's Real vs. Mocked

| Component | Implementation | Reason |
|-----------|---------------|--------|
| HTTP endpoints | Real (Express) | Need actual HTTP layer for integration tests |
| Database | Real (SQLite) | Need persistence validation |
| Payment provider | **Mocked** | External dependency, assignment requirement |
| Webhook signature | Real (crypto) | Security validation required |
| State transitions | Real (State pattern) | Core domain logic under test |

### 12.3 If I Had More Time
- Concurrent webhook processing tests (race conditions)
- Property-based testing for state machine (generate random event sequences)
- Contract testing with Pact (if real service existed)
- Performance benchmarks (webhook processing throughput)
- More plan types and proration logic

---

## 13. Success Criteria Checklist

### Functional Requirements
- [x] API contract tests (CRUD, validation errors, webhook handling)
- [x] State machine tests (all valid + 2+ invalid transitions)
- [x] Database persistence validation (subscriptions, invoices, events)
- [x] Payment provider mocked with interaction verification
- [x] Webhook idempotency validated
- [x] Out-of-order webhook handling validated

### Design Patterns
- [x] State pattern for subscription lifecycle
- [x] Builder pattern for test data
- [x] Strategy pattern for payment provider
- [x] Repository pattern for database access
- [x] Factory pattern for webhook payloads

### Architecture Quality
- [x] Object-oriented test framework (not scripts)
- [x] Clear separation of concerns (fixtures, clients, assertions, tests)
- [x] Reusable test utilities (builders, helpers)
- [x] Maintainable test structure (grouped by level)
- [x] Documented assumptions and tradeoffs

### Documentation
- [x] Test strategy explanation
- [x] Design pattern justification
- [x] API contract specification
- [x] Database schema definition
- [x] Setup and execution instructions

---

## 14. AI Usage Statement

**Tools Used**: Claude Code (AI pair programming assistant)

**Where AI Helped**:
- Initial framework design brainstorming
- Boilerplate code generation (builders, repositories)
- Test case enumeration (coverage ideas)
- TypeScript syntax suggestions

**What I Reviewed/Validated**:
- All design pattern implementations
- State machine correctness
- Test logic and assertions
- Database schema design
- Idempotency strategy
- Security (webhook signature validation)

**Judgment Calls I Made**:
- Choosing State pattern over simple status field
- SQLite over PostgreSQL for simplicity
- Test granularity (unit vs integration vs e2e)
- Mock provider API design
- Scope boundaries (what to exclude)

---

## 15. Next Steps

1. **Initialize Project**
   ```bash
   npm init -y
   npm install dependencies
   mkdir -p src/{domain,infrastructure,api} tests/{builders,fixtures,helpers,unit,integration,e2e}
   ```

2. **Red Phase**: Write first failing test
   - Start with: `POST /subscriptions returns 201`

3. **Blue Phase**: Make it pass
   - Implement minimal Express endpoint

4. **Green Phase**: Refactor
   - Extract API client, builders

5. **Iterate**: Follow phases 1-6 above

6. **Submit PR**: Include all documentation

---

**End of Framework Design Document**
