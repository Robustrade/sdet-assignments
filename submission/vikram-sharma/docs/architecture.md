# Architecture

## High-Level Design

The solution follows a layered architecture to keep business logic, persistence, API interactions and test logic independent.

```
Tests
   │
   ▼
API Layer
   │
   ▼
Subscription Service
   │
   ├──────────────┐
   ▼              ▼
State Machine   Payment Provider Interface
                     │
                     ▼
             Mock Payment Provider
                     │
                     ▼
             SQLite Repository Layer
```

---

## Components

### API Layer

Responsible for handling incoming HTTP requests.

Responsibilities:

- Create subscriptions
- Retrieve subscriptions
- Cancel subscriptions
- Process payment webhooks

The API layer contains no business logic.

---

### Service Layer

Contains the business rules for the Subscription & Billing domain.

Responsibilities:

- Subscription creation
- Cancellation
- Payment processing
- State transitions
- Invoice generation

The service coordinates repositories, state machine and payment provider.

---

### State Machine

The subscription lifecycle is implemented using an explicit state machine rather than directly modifying status values.

Supported states:

- trialing
- active
- past_due
- canceled

Only valid transitions are permitted.

Invalid transitions are rejected.

---

### Repository Layer

Repositories isolate database access from business logic.

Repositories include:

- SubscriptionRepository
- InvoiceRepository
- WebhookRepository

This avoids SQL statements being scattered throughout the application and tests.

---

### Payment Provider

The payment provider is accessed through an interface.

During testing a mock implementation replaces the external provider.

The mock supports:

- Success
- Failure
- Timeout

It also records every interaction for verification.

---

### Database

SQLite is used as an embedded persistence layer.

The following tables are maintained:

- subscriptions
- invoices
- webhook_events

Tests validate both API responses and persisted database state.

---

## Test Architecture

Tests are organised by responsibility.

```
tests/
│
├── api
├── state-machine
├── persistence
├── webhook
└── e2e
```

Each test suite validates one layer of the system while avoiding unnecessary duplication.

---

## Design Patterns

### State Pattern

Used to model the subscription lifecycle.

Benefit:

Illegal transitions become difficult to perform accidentally.

---

### Builder Pattern

Used to create:

- Customers
- Subscriptions
- Webhook payloads

Benefit:

Improves readability and avoids duplicated setup code.

---

### Repository Pattern

Used to isolate persistence logic.

Benefit:

Business logic is independent from database implementation.

---

### Strategy Pattern

Used for the payment provider interface.

Benefit:

Tests can replace the real provider with a configurable mock implementation.

---

## Reliability

The solution validates:

- Duplicate webhooks
- Out-of-order events
- Invalid signatures
- Payment failures
- Provider timeout
- Database consistency
- Subscription invariants