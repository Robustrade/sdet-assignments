# Subscription Billing Test Framework

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![NodeJS](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)
![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen?style=for-the-badge)

A TypeScript-based automated test framework and service simulation designed to validate subscription billing lifecycles, webhook processing, idempotency guarantees, and database state transitions.

---

## Table of Contents
- [Summary](#summary)
- [Project Structure](#project-structure)
- [Setup & Execution](#setup--execution)
- [Test Strategy](#test-strategy)
- [OOP & Design Pattern Choices](#oop--design-pattern-choices)
- [API Validation Approach](#api-validation-approach)
- [Database Validation Approach](#database-validation-approach)
- [Mock Payment Provider & Webhook Validation](#mock-payment-provider--webhook-validation)
- [State-Machine / Lifecycle Coverage](#state-machine--lifecycle-coverage)
- [Test Architecture](#test-architecture)
- [Validation](#validation)
- [Known Limitations / Next Steps](#known-limitations--next-steps)
- [Responsible AI Usage](#responsible-ai-usage)
- [Author Checklist](#author-checklist)

---

## Summary

Implemented an end-to-end subscription billing service and verification test suite using **TypeScript** and **Jest**. The solution models subscription plans, lifecycle state transitions, payment provider interactions, and asynchronous webhook event handling (`billing-flow.test.ts`, `idempotency.test.ts`, `state-machine.test.ts`). It enforces strict API boundary validation, webhook signature/payload verification, database persistence invariants, and out-of-order/duplicate event resilience.

---

## Project Structure

```text
subscription-billing-test-framework/
├── src/
│   ├── builders/
│   │   ├── subscription-builder.ts      # Fluent test data builder for subscriptions
│   │   └── webhook-payload-builder.ts   # Fluent builder for signed/malformed webhook payloads
│   ├── domain/
│   │   ├── plan.ts                      # Billing plan definitions and pricing rules
│   │   └── state-machine.ts             # Finite state machine enforcing valid lifecycle transitions
│   ├── payment/
│   │   ├── payment-provider.interface.ts # Abstraction seam for external payment gateways
│   │   └── mock-payment-provider.ts     # Controllable stub/spy implementation for testing
│   ├── persistence/
│   │   └── repository.ts                # Data access layer for subscriptions, invoices, events, and audit logs
│   └── service/
│       └── server.ts                    # HTTP API and webhook ingestion endpoints
├── tests/
│   ├── billing-flow.test.ts             # End-to-end lifecycle & API/DB integration scenarios
│   ├── idempotency.test.ts              # Duplicate event_id and out-of-order delivery tests
│   └── state-machine.test.ts            # Exhaustive valid/invalid state transition tests
├── jest.config.js
└── package.json
```

---

## Setup & Execution

### Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher

### Installation & Execution

```bash
# Clone repository
git clone https://github.com/your-username/subscription-billing-test-framework.git
cd subscription-billing-test-framework

# Install dependencies
npm install

# Type-check and compile TypeScript
npm run build

# Run the complete test suite
npm test
```

---

## Test Strategy

- **Levels Covered:**
  - **Unit Tests:** Isolated domain logic verification for the subscription finite state machine (`state-machine.test.ts`) and pricing plan rules.
  - **API & Integration Tests:** HTTP request/response handling, webhook ingestion, persistence state verification, and mock provider interactions (`billing-flow.test.ts`, `idempotency.test.ts`).

- **In Scope:**
  - Subscription creation, activation, recurring renewal, past-due handling, cancellation, and expiration lifecycles.
  - Webhook signature verification, schema/payload validation, idempotency (`event_id` deduplication), and stale/out-of-order event handling.
  - Multi-entity persistence consistency across subscriptions, payments/invoices, processed webhook events, and audit logs.

- **Out of Scope:**
  - Live network calls to third-party payment gateways (e.g., Stripe/Razorpay live sandboxes).
  - UI/frontend rendering, load/stress benchmarking, and multi-node distributed locking.

- **Real vs. Stubbed/Mocked Components:**
  - **Real:** HTTP server routing (`server.ts`), domain state machine (`state-machine.ts`), business rules, input validation layers, and repository persistence state transitions (`repository.ts`).
  - **Stubbed/Mocked:** External payment gateway (`MockPaymentProvider` implementing `PaymentProvider`). Mocking the gateway eliminates network flakiness, avoids external rate limits, and allows deterministic simulation of gateway declines, timeouts, and webhook callbacks.

---

## OOP & Design Pattern Choices

| Pattern / Principle | Implementation | Description |
| :--- | :--- | :--- |
| **Strategy / DIP** | `PaymentProvider` interface | Decouples core billing logic from specific payment gateway implementations. |
| **State Pattern** | `StateMachine` | Centralizes allowed subscription status transitions into an explicit transition table. |
| **Builder Pattern** | `SubscriptionBuilder`, `WebhookPayloadBuilder` | Encapsulates complex test object construction with fluent override methods. |
| **Repository Pattern** | `Repository` | Isolates storage operations from HTTP and domain layers for easy assertion inspection. |

### Seam Around Payment Provider
- **Interface:** `PaymentProvider` (`src/payment/payment-provider.interface.ts`) defines the contract for charging customers, managing mandates, and verifying webhook signatures.
- **Injection Point:** Injected via constructor dependency injection into the service layer (`src/service/server.ts`), allowing tests to supply `MockPaymentProvider` pre-configured per scenario.

---

## API Validation Approach

- **Request / Response Validation:** Incoming API requests are validated at the HTTP boundary (`server.ts`) for required fields, data types, valid plan identifiers, and positive monetary amounts. Responses return deterministic status codes (`200`, `201`, `400`, `401`, `409`, `422`) with standardized error schemas.
- **Webhook Security & Parsing:**
  1. **Transport Layer Security:** Validates the cryptographic signature header and timestamp freshness *before* parsing domain events. Invalid signatures (`401`) or malformed bodies (`400`) are rejected before hitting the database or state machine.
  2. **Domain Routing Layer:** Authenticated payloads undergo deduplication check (`event_id`) and state machine applicability validation.
- **Failure Scenarios Handled:**
  - Missing or invalid webhook signatures.
  - Malformed JSON body or missing mandatory event identifiers.
  - Non-existent subscription references or invalid plan codes.
  - Payment gateway charge failure / card decline handling.

---

## Database Validation Approach

- **Entities Asserted (`src/persistence/repository.ts`):**
  - **Subscriptions:** Status, current billing period start/end, plan ID, and version metadata.
  - **Invoices / Payments:** Amount, currency, payment status (`PENDING`, `PAID`, `FAILED`), and foreign-key relation to the subscription.
  - **Webhook Events:** Recorded `event_id`, event type, processing status, and timestamp for deduplication.
  - **Audit Log:** Chronological trail of state changes (`from_status`, `to_status`, `trigger`, `timestamp`).

- **Invariants Enforced:**
  - Every successful charge produces a corresponding `PAID` invoice record matching the plan amount.
  - Every valid state transition generates exactly one audit log entry.
  - Duplicate or rejected webhooks never write duplicate payment records or duplicate audit entries.
  - Intermediate states are verified and committed sequentially across multi-step lifecycles (Creation → Activation → Renewal → Cancellation).

---

## Mock Payment Provider & Webhook Validation

- **Mock Provider Spying (`src/payment/mock-payment-provider.ts`):**
  - `MockPaymentProvider` records call histories in-memory and supports configurable behavior (charge success, card decline, timeout).
  - Tests assert exact call counts and argument values (e.g., confirming no charge attempt occurs on canceled subscriptions).

- **Webhook Idempotency (`tests/idempotency.test.ts`):**
  - Tested by sending identical webhook payloads with the same `event_id` sequentially.
  - Verification ensures the first request executes the transition (`200 OK`), while duplicate requests return `200 OK` (acknowledgment) without re-executing side effects, creating duplicate invoices, or mutating subscription state.

- **Out-of-Order / Stale Webhooks:**
  - Tested by delivering stale events (e.g., receiving `payment.succeeded` *after* a subscription is `CANCELED`).
  - The state machine flags the event as inapplicable/stale, logging the event as ignored without regressing state.

---

## State-Machine / Lifecycle Coverage

### Valid Transitions Tested
- `PENDING` $\rightarrow$ `ACTIVE` *(initial payment succeeded)*
- `ACTIVE` $\rightarrow$ `ACTIVE` *(recurring renewal payment succeeded)*
- `ACTIVE` $\rightarrow$ `PAST_DUE` *(renewal payment failed / card declined)*
- `PAST_DUE` $\rightarrow$ `ACTIVE` *(retry payment succeeded)*
- `PAST_DUE` $\rightarrow$ `CANCELED` *(dunning grace period exhausted)*
- `ACTIVE` $\rightarrow$ `CANCELED` *(explicit user cancellation)*

### Invalid Transitions Proven Impossible
- `CANCELED` $\rightarrow$ `ACTIVE` *(cannot reactivate canceled subscription via payment webhook)*
- `CANCELED` $\rightarrow$ `PAST_DUE` *(cannot set canceled subscription to past due)*
- `PENDING` $\rightarrow$ `PAST_DUE` *(cannot transition to past-due prior to initial activation)*

---

## Test Architecture

- **Fixtures & Isolation:** Reset repository storage and instantiate fresh provider/server instances before each test (`beforeEach`).
- **HTTP Client Helper:** Lightweight test utility wrapping API calls to `server.ts` with signature headers and JSON handling.
- **Builders:** `SubscriptionBuilder` and `WebhookPayloadBuilder` keep test setup clean and readable.
- **Assertions:** Combined domain + DB assertion helpers check API responses, persistence records, and audit trails in single calls.

---

## Validation

```bash
# Type check TypeScript code
npm run build

# Execute Jest test suite
npm test

# Code quality check (if linter configured)
npm run lint
```

---

## Known Limitations & Next Steps

1. **In-Memory Store:** Persistence currently uses an in-memory repository for zero-dependency test execution. A PostgreSQL database driver with transactional row locking (`SELECT ... FOR UPDATE`) could be added to test database race conditions.
2. **Dunning Retries:** Fake timers (Jest fake timers) could be expanded to test multi-day retry backoff intervals (Day 1, Day 3, Day 7).
3. **Provider Contract Testing:** Adding JSON Schema validation against real Stripe/Razorpay event snapshots.

---

## Responsible AI Usage

- **AI Tools Used:** Yes, utilized for scaffolding markdown documentation and detailing edge-case scenarios.
- **Assistance Scope:** Structuring the GFM README, drafting test strategy sections, and defining builder pattern benefits.
- **Human Verification:** Verified TypeScript compilation (`npm run build`), ran all Jest test suites (`npm test`), confirmed state machine transitions, and validated database invariants manually.

---

## Author Checklist

- [x] Linting passes
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes (`npm test`)
- [x] Setup & build instructions verified from clean repository clone
- [x] Every listed lifecycle transition is exercised by test cases
- [x] Invalid transitions proven impossible in test suite
- [x] Webhook idempotency (`event_id` deduplication) tested
- [x] Markdown compatible with GitHub GFM standards