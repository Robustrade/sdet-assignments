# Wallet Transfer Service – Initial Solution Approach

## Objective

The objective of this assignment is to design an automated validation suite for a Wallet Transfer Service that verifies transactional correctness across multiple system layers. The focus is not only on API validation but also on ensuring data consistency, business workflow correctness, persistence validation, and reliability under real-world conditions such as retries, duplicate requests, and concurrent execution.

---

# Understanding of the Problem

A wallet transfer is a transactional operation involving multiple components. A successful transfer should:

- Debit the source wallet exactly once.
- Credit the destination wallet exactly once.
- Persist the transfer correctly.
- Record audit and idempotency information.
- Prevent duplicate side effects.
- Maintain consistency across API responses and database state.

The automation should validate the complete lifecycle from receiving an API request to verifying the final persisted state.

---

# Scope of Automation

The solution will validate the following layers:

## 1. API Validation

- Request and response validation
- HTTP status codes
- Response payload
- Validation failures
- Duplicate request handling
- Contract verification

---

## 2. Business Workflow Validation

- Successful transfer lifecycle
- Balance conservation
- Transfer status transitions
- Retry behaviour
- Exactly-once processing
- Business rule validation

---

## 3. Database Validation

The database verification will ensure that:

- Wallet balances are updated correctly.
- Transfer records are persisted accurately.
- Idempotency records are created correctly.
- Audit/Event records are generated.
- No duplicate side effects exist.

---

## 4. Cross-Component Validation

Where applicable, the solution will validate:

- Audit/Event generation
- Outbox/Event publishing
- Retry-safe downstream behaviour
- Exactly-once event creation

---

# Reliability Strategy

Special focus will be given to scenarios that commonly introduce failures in transactional systems:

- Duplicate API requests
- Client retries
- Concurrent transfers
- Race conditions
- Partial failures
- Persistence consistency

---

# Assumptions

- A lightweight Wallet Transfer Service will be implemented since no production service is provided.
- SQLite will be used for local persistence.
- External dependencies such as notifications or event publishing will be represented using lightweight test doubles where appropriate.

---

# Proposed Technology Stack

- JavaScript (Node.js)
- Express.js
- Jest
- SQLite

---

# Planned Test Architecture

```
tests/
│
├── api/
├── integration/
├── database/
├── concurrency/
├── fixtures/
└── utils/
```

The implementation will separate:

- Test scenarios
- API client helpers
- Database verification
- Test data builders
- Reusable assertions

to keep the suite maintainable and easy to extend.

---

# Initial Implementation Plan

1. Create a minimal Wallet Transfer Service.
2. Create the database schema and seed test data.
3. Implement reusable API helper functions.
4. Implement API validation scenarios.
5. Implement business workflow validation.
6. Add database verification.
7. Add idempotency and concurrency scenarios.
8. Document assumptions, limitations, and execution steps.

---

# Note

This document represents my initial understanding of the problem and the proposed implementation approach before development begins. The solution may evolve during implementation while maintaining the same overall validation strategy.