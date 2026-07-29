# Summary

Implemented a Subscription & Billing Service in **TypeScript** with a comprehensive automated validation suite using **Jest** and **Supertest**. The solution validates the complete subscription lifecycle, including subscription creation, retrieval, cancellation, payment processing, webhook handling, database persistence, and lifecycle state transitions.

The project follows a modular architecture with clear separation between controllers, services, repositories, domain models, and payment provider implementations, making the solution maintainable, scalable, and easy to extend.

---

# Test Strategy

### Levels Covered

* API Testing
* Integration Testing
* State Machine Validation
* Database Validation

### In Scope

* Create subscription
* Retrieve subscription details
* Cancel subscription
* Payment success scenarios
* Payment failure scenarios
* Webhook processing
* Duplicate webhook handling (Idempotency)
* Subscription lifecycle validation
* Database persistence verification

### Out of Scope

* UI Automation
* Performance / Load Testing
* Security & Authentication Testing
* Real third-party payment gateway integration

### Real vs Stubbed / Mocked

**Real Components**

* Express application
* Business services
* Repository layer
* SQLite database
* Subscription state machine

**Mocked Components**

* Payment provider
* Webhook event simulation

The payment provider is intentionally mocked so that payment success and failure scenarios can be tested deterministically without relying on an external payment gateway.

---

# OOP & Design Pattern Choices

The project is designed using object-oriented principles with clear separation of responsibilities.

Design patterns and practices used include:

* Repository Pattern for database access.
* Strategy Pattern for subscription plans.
* State Pattern for subscription lifecycle management.
* Dependency Abstraction for payment provider implementation.
* Service layer to isolate business logic.
* Controller layer for request handling.

This structure improves maintainability, reusability, and future extensibility.

---

# API Validation Approach

The automated API tests validate:

* HTTP status codes
* Response payloads
* Required response fields
* Invalid requests
* Business rule validation
* Error handling
* Subscription CRUD operations

Both positive and negative scenarios are covered to verify expected API behaviour.

---

# Database Validation Approach

Database verification ensures that application state is persisted correctly after each operation.

The tests validate:

* Subscription records
* Invoice creation
* Webhook event persistence
* Subscription status updates
* Data consistency after payment processing

SQLite is used as the persistence layer and is verified as part of the integration tests.

---

# Payment Provider & Webhook Validation

A mock payment provider simulates both successful and failed payment scenarios.

Webhook tests validate:

* Successful payment events
* Failed payment events
* Duplicate webhook events (Idempotency)
* Invalid webhook payload handling
* Correct subscription state updates after webhook processing

This verifies that asynchronous payment notifications are processed correctly without depending on an external payment service.

---

# Subscription Lifecycle Validation

The automated tests validate subscription lifecycle behaviour through the implemented state machine.

Lifecycle states covered include:

* Trialing
* Active
* Past Due
* Cancelled

The suite verifies valid state transitions while ensuring invalid transitions are rejected according to business rules.

---

# Test Architecture

The solution is organized into reusable modules with clear responsibilities.

Application Structure

* Controllers
* Services
* Repositories
* Domain Models
* Payment Provider
* Database Layer

Test Structure

* API Tests
* Integration Tests
* State Machine Tests
* Webhook Tests
* Test Fixtures
* API Client
* Builders
* Webhook Simulator

This organization minimizes duplication and makes future test expansion straightforward.

---

# Validation

The solution has been validated by executing the complete Jest test suite, covering:

* Subscription APIs
* Payment provider behaviour
* Webhook processing
* Database persistence
* Subscription lifecycle transitions
* Integration between application layers

---

# Assumptions & Limitations

* A mock payment provider is used instead of a live payment gateway.
* SQLite is used for persistence during testing.
* Authentication and authorization are outside the scope of this assignment.
* Performance, load, and security testing are not included.
* The focus of the assignment is backend automation architecture, correctness, maintainability, and state validation.

---

# Overall Approach

The implementation emphasizes clean architecture, object-oriented design, reusable test components, and comprehensive validation of a stateful subscription billing workflow. The solution demonstrates API validation, persistence verification, lifecycle management through the State Pattern, webhook processing, repository abstraction, and deterministic integration testing using mocked external dependencies.
