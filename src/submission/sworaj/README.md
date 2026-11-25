Subscription Billing Service Test Solution
Setup
Install dependencies:

npm install
Run Tests
npm test
Architecture
The solution uses:

State Machine Pattern
Repository Pattern
Builder Pattern
Strategy Pattern (Payment Provider)
Covered Areas
Subscription Lifecycle Validation
Subscription Persistence
Invoice Persistence
Audit Logging
API Validation
Webhook Signature Validation
Webhook Idempotency
Out-of-Order Webhook Handling
Mock Payment Provider Validation
Current Test Coverage
20 automated tests

Notes
This solution intentionally uses an in-memory persistence layer to focus on automation architecture, lifecycle validation, idempotency, and test design rather than database setup complexity.