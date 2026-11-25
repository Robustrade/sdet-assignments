
# Kulu Subscription Billing – Test Strategy

## 1. Objective

Build an object-oriented TypeScript automation framework to validate a Subscription & Billing Service.

The framework will validate API behavior, subscription lifecycle transitions, database persistence, payment provider interactions, and asynchronous webhook processing.

The focus is correctness, maintainability, and business-critical failure scenarios.

## 2. System Under Test

A minimal Subscription & Billing Service implemented using:

- Node.js and TypeScript
- Express REST API
- SQLite persistence
- Zod request validation
- Vitest and Supertest for automation

The service fixture represents the backend being tested.

## 3. Test Scope

### In Scope

- Subscription creation and retrieval
- Subscription cancellation
- Plan-based pricing and trial configuration
- Payment success and failure
- Subscription lifecycle validation
- Webhook signature validation
- Duplicate webhook delivery
- Out-of-order webhook processing
- Payment provider interaction
- Database persistence and consistency
- API request and response validation

### Out of Scope

- Real payment gateway integration
- Frontend testing
- Production deployment
- Real notification delivery
- Advanced tax and multi-currency calculations
- Performance and load testing

## 4. Test Levels

| Level | Validation |
|---|---|
| Unit | State machine and domain rules |
| API | HTTP requests, responses and validation |
| Integration | Services, repositories and provider interaction |
| Database | Persisted subscriptions, invoices and events |
| End-to-End | Complete subscription and payment workflows |

## 5. Real vs Mocked Components

| Component | Implementation |
|---|---|
| REST API | Real Express application |
| Business services | Real implementation |
| Database | Real SQLite database |
| Repositories | Real implementation |
| Payment provider | Mock implementation |
| Webhook delivery | Simulated HTTP requests |
| Signature verification | Real HMAC verification |
| Notifications | Not implemented |

## 6. Design Patterns

### State Pattern / Transition Table
Subscription lifecycle transitions are centralized to prevent invalid state changes.

### Builder Pattern
Dedicated builders construct customers, subscriptions and webhook payloads for readable test scenarios.

### Strategy / Adapter Pattern
PaymentProvider interface allows different payment provider implementations to be injected into the subscription service.

### Repository Pattern
Repositories centralize database operations and allow tests to verify persisted state without embedding SQL in test scenarios.

## 7. API Validation

Endpoints:

- POST /subscriptions
- GET /subscriptions/:id
- POST /subscriptions/:id/cancel
- POST /webhooks/payment-provider

Validation includes:

- Valid and invalid requests
- Missing required fields
- Unknown customers and plans
- Correct response codes and payloads
- Invalid webhook signatures
- Malformed webhook payloads

## 8. Database Validation

Entities:

- customers
- subscriptions
- invoices
- webhook_events
- audit_logs

Key invariants:

- Active subscriptions must have a successful persisted payment.
- Canceled subscriptions cannot be reactivated.
- Duplicate webhook events must not create duplicate payments.
- Subscription state must match API responses.
- Invoice and payment records must be consistent.

Tests will use isolated database state to avoid stale data and cross-test interference.

## 9. Webhook Strategy

Webhook requests will be signed using HMAC SHA-256.

Validation scenarios:

- Valid signature
- Invalid signature
- Missing signature
- Malformed payload
- Duplicate event ID
- Payment success
- Payment failure
- Out-of-order events
- Events received after cancellation

Webhook event processing will use transaction-safe persistence and unique event IDs for idempotency.

## 10. Payment Provider Mocking

A PaymentProvider interface will be injected into the service.

The mock will support:

- Successful payment
- Declined payment
- Timeout

Assertions will validate:

- Provider call count
- Customer ID
- Payment method ID
- Amount
- Idempotency key

## 11. Test Architecture

The framework is divided into:

- Builders: test data construction
- Clients: API communication
- Fixtures: environment initialization and cleanup
- Helpers: webhook signing and shared utilities
- Repositories: database verification
- Assertions: reusable business validations
- Scenarios: readable test specifications

## 12. Assumptions and Limitations

- The assignment does not provide an existing billing service.
- A minimal service fixture will be implemented.
- SQLite will be used for local persistence.
- Payment provider calls will be simulated.
- Refund behavior will be explicitly defined as an assumption.
- Concurrent webhook delivery is a future enhancement unless time permits.

## 13. Validation Commands

- npm run build
- npm run lint
- npm test

All validation commands will be executed before submission.
