
# Kulu Subscription & Billing Service – Test Approach

## 1. Objective
Design an object-oriented automation solution to validate subscription lifecycle, billing workflows, payment processing, webhook handling and database consistency.

## 2. Scope
- Subscription creation, retrieval and cancellation
- Valid and invalid lifecycle transitions
- Payment success, decline and timeout
- Duplicate and out-of-order webhook events
- Webhook signature validation
- Database persistence and audit history
- API and database consistency

## 3. Proposed Technology Stack
- TypeScript
- Vitest
- Node.js and Express
- Supertest
- SQLite
- Vitest mocks

## 4. Architecture
- API Client: handles HTTP requests and responses.
- Service Fixture: provides the minimal backend implementation.
- Payment Provider Adapter: isolates external payment interactions.
- Repository: handles database persistence and verification.
- Test Data Builders: generate customers, subscriptions and webhook events.
- Test Specifications: organize business scenarios.

## 5. Design Patterns
- State Pattern: controls subscription lifecycle transitions.
- Builder Pattern: creates reusable test data.
- Strategy/Adapter Pattern: supports mocked payment provider outcomes.
- Repository Pattern: centralizes database operations.

## 6. Core Business Invariants
- A subscription cannot become active without a successful payment.
- A canceled subscription cannot be reactivated by subsequent webhooks.
- Duplicate webhooks must not create duplicate invoices or payments.
- Payment provider calls must happen only for genuine billing attempts.
- API state must match persisted database state.

## 7. Failure and Edge Cases
- Payment decline and timeout.
- Duplicate webhook delivery.
- Out-of-order webhook events.
- Invalid webhook signatures.
- Invalid lifecycle transitions.
- Database persistence failures.

## 8. Validation Approach
Each scenario will verify:
1. API status and response payload.
2. Subscription state transition.
3. Invoice and payment records.
4. Webhook event history.
5. Payment provider call count and arguments.

## 9. Test Data Management
Use isolated fixtures, controlled test data and database cleanup to avoid cross-test contamination.

## 10. Assumptions and Limitations
A minimal service fixture will be implemented because no existing service implementation is supplied. The payment provider will be mocked. The solution will focus on test engineering rather than production-grade billing functionality.
