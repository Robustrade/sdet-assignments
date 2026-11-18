# SDET Assignment – Initial Approach

## 1. Understanding

The objective is to design and implement an automated test solution for a Subscription & Billing Service.

## 2. Proposed Technology

- TypeScript
- Jest
- Express
- Supertest
- SQLite

## 3. Testing Approach

The automation solution will cover:

- API contract and validation testing
- Subscription lifecycle testing
- Payment success and failure scenarios
- Payment retry mechanisms
- Duplicate and out-of-order webhook handling
- Webhook signature validation
- Database persistence and consistency
- External payment-provider mocking

## 4. Framework Design

I plan to use an object-oriented framework with the following design patterns:

- State Pattern for subscription lifecycle management
- Builder Pattern for reusable test data creation
- Strategy Pattern for payment-provider behavior
- Repository Pattern for persistence operations

## 5. Implementation Plan

1. Set up the TypeScript project structure.
2. Implement domain models and subscription lifecycle logic.
3. Create a mock payment provider.
4. Implement API and webhook functionality.
5. Develop API, integration, and persistence tests.
6. Document execution instructions and test coverage.

## 6. Quality Goals

The primary focus will be correctness, idempotency, database consistency, maintainability, and reliable end-to-end validation.

## 7. Assumption

Since an existing service implementation is not provided, I plan to create a minimal service fixture to demonstrate the required testing strategy.
