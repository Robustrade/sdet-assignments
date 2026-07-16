# Wallet Transfer Service Automation Framework

Senior SDET Assignment - Automated validation suite for a Wallet Transfer Service demonstrating end-to-end testing, transaction consistency, multi-layer verification, idempotency, retry handling, and concurrency testing.

## 🚀 Quick Start - Setup and Run

### Prerequisites
- **Java 21+** - Verify with `java -version`
- **Maven 3.9+** - Verify with `mvn -version`

### Step-by-Step Commands

```bash
# 1. Navigate to the project directory
cd submission/candidate-java

# 2. Clean and compile the project (downloads dependencies, compiles main & test code)
mvn clean compile

# 3. Verify code formatting (Spotless with Google Java Format)
mvn spotless:check

# 4. Auto-fix formatting if check fails
mvn spotless:apply

# 5. Run ALL tests (API, Workflow, Database, Concurrency) - starts embedded server on port 8081
mvn test

# 6. Run specific test categories:
mvn test -Dtest=*ApiTest          # API contract tests only
mvn test -Dtest=*WorkflowTest     # End-to-end workflow tests
mvn test -Dtest=*DatabaseTest     # Repository verification tests
mvn test -Dtest=*ConcurrencyTest  # Concurrency & race condition tests

# 7. Run tests with detailed console output
mvn test -Dsurefire.useFile=false
```

### Run Standalone Server (for manual API testing)
```bash
# Start the server on port 8080 (seeds wallets: wallet_001=10000 INR, wallet_002=5000 INR, wallet_003=2000 INR)
mvn exec:java -Dexec.mainClass="com.wallet.transfer.Main"
```
Then test manually:
```bash
curl -X POST http://localhost:8080/transfers \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"sourceWalletId":"wallet_001","destinationWalletId":"wallet_002","amount":1000,"currency":"INR","reference":"test_123"}'
```

### Expected Results
- **All tests pass**: 45 tests across 4 test suites
- **Build success**: `BUILD SUCCESS` message
- **No formatting issues**: `spotless:check` passes

---

## Architecture Overview

This is a **test-first, transaction-centric** automation framework. The backend is an intentionally lightweight in-memory fixture (ConcurrentHashMap + ArrayList) to focus on automation engineering quality rather than production infrastructure.

### Technology Stack
- **Language**: Java 21
- **Build**: Maven
- **Test Framework**: JUnit 5
- **API Automation**: RestAssured
- **Assertions**: AssertJ
- **Serialization**: Jackson
- **Formatting**: Spotless (Google Java Format)

### Project Structure
```
src/
├── main/
│   ├── api/           # RestAssured wrapper
│   ├── controller/    # REST endpoints
│   ├── dto/           # Request/Response DTOs
│   ├── model/         # Domain models
│   ├── repository/    # In-memory repositories
│   ├── service/       # Business logic
│   └── util/          # Utilities
└── test/
    ├── api/           # API contract tests
    ├── workflow/      # End-to-end transaction tests
    ├── database/      # Repository verification tests
    ├── concurrency/   # Concurrency & race condition tests
    ├── builders/      # Test data builders
    ├── fixtures/      # Test setup/teardown
    └── assertions/    # Multi-layer validation assertions
```

## Running the Project

### Prerequisites
- Java 21+
- Maven 3.9+

### Commands
```bash
# Compile project
mvn clean compile

# Run formatting check
mvn spotless:check

# Apply formatting
mvn spotless:apply

# Run tests
mvn test
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/transfers` | Create a wallet transfer |
| GET | `/transfers/{id}` | Retrieve transfer by ID |
| GET | `/wallets/{id}` | Retrieve wallet by ID |

### Transfer Request
```json
{
  "sourceWalletId": "wallet_001",
  "destinationWalletId": "wallet_002",
  "amount": 2500,
  "currency": "INR",
  "reference": "invoice_123"
}
```

**Header**: `Idempotency-Key: <uuid>`

## Test Strategy

The framework validates every successful transaction across **all layers**:

1. **API Layer** - HTTP response codes, payload shape, contract validation
2. **Workflow Layer** - Business rules, balance updates, state transitions
3. **Repository Layer** - Wallet balances, transfer persistence, audit records, outbox events, idempotency keys
4. **Cross-Component** - Audit/outbox side effects, exactly-once semantics
5. **Business Invariants** - Conservation of value, no duplicate side effects, no money created/lost

## Quality Gates

Every phase must satisfy:
- `mvn clean compile` - Project compiles
- `mvn spotless:check` - Formatting passes
- Tests compile
- No TODOs
- No unused imports
- Documentation updated
- Transaction verification completed

## Transaction Verification

Every successful transfer verifies:
- ✅ HTTP response
- ✅ Business workflow execution
- ✅ Wallet balances updated correctly
- ✅ Transfer persisted
- ✅ Audit record created
- ✅ Outbox event created
- ✅ Idempotency record stored
- ✅ Business invariants preserved (money never created/lost)

---

# Test Strategy

## Wallet Transfer Service Automation Framework

### Document Information

| Item | Value |
|------|-------|
| Project | Wallet Transfer Service |
| Repository | sdet-assignments |
| Implementation Directory | `submission/candidate-java` |
| Language | Java 21 |
| Build Tool | Maven |
| Test Framework | JUnit 5 |
| API Automation | RestAssured |
| Formatting | Spotless |

## 1. Executive Summary

This document defines the testing strategy for the Wallet Transfer Service assignment.

The objective is not to build a production banking platform, but to demonstrate Senior SDET capabilities through a maintainable API automation framework that validates transactions across multiple system layers.

The framework validates:

- API correctness
- Business workflow correctness
- Repository consistency
- Audit and Outbox generation
- Idempotency
- Retry behaviour
- Concurrency
- Transaction integrity

A lightweight backend fixture using in-memory repositories, mocks and stubs is intentionally used so the focus remains on automation engineering.

## 2. Objectives

The automation framework aims to:

- Validate end-to-end transaction workflows.
- Ensure API responses match repository state.
- Verify transaction consistency.
- Validate retry and duplicate request handling.
- Verify idempotent behaviour.
- Validate audit and outbox side effects.
- Detect transactional defects beyond HTTP responses.
- Produce deterministic, maintainable and CI-ready automation.

## 3. Scope

### Included

- REST API testing
- Workflow validation
- Repository verification
- Audit verification
- Outbox verification
- Idempotency validation
- Retry scenarios
- Duplicate request handling
- Concurrency testing
- Error handling

### Out of Scope

- UI automation
- Performance testing
- Security penetration testing
- Authentication implementation
- Kafka
- Redis
- PostgreSQL
- Kubernetes
- Production infrastructure

## 4. Testing Philosophy

The assignment evaluates automation engineering rather than backend implementation.

The framework therefore prioritizes:

- Multi-layer validation
- Business rule verification
- Transaction consistency
- Readable and maintainable tests
- Reusable automation components
- Deterministic execution

## 5. Transactional Testing Strategy

Unlike traditional API testing, every successful transaction is validated across multiple system layers.

```
API Request
     │
     ▼
HTTP Response
     │
     ▼
Business Workflow
     │
     ▼
Repository State
     │
     ▼
Audit Records
     │
     ▼
Outbox Events
     │
     ▼
Business Invariant Verification
```

Every successful transfer is validated for:

- Exactly-once semantics
- Transaction integrity
- Multi-layer consistency
- Data consistency
- Business invariants
- Side-effect verification

## 6. Backend Implementation Strategy

The backend is intentionally lightweight.

Repositories use:

- ConcurrentHashMap
- ArrayList
- Mock Audit Store
- Mock Outbox Store
- Mock Idempotency Store

This enables realistic workflow validation without unnecessary infrastructure.

## 7. Test Levels

### API Tests

Validate:

- Request schema
- Response schema
- Status codes
- Error handling
- Contract validation

### Workflow Tests

Validate:

- Business rule execution
- Wallet balance updates
- Transfer persistence
- Audit creation
- Outbox creation
- Response consistency

### Repository Verification

Verify:

- Wallet balances
- Transfer persistence
- Audit records
- Outbox records
- Idempotency records

### Concurrency Tests

Validate:

- Parallel transfers
- Duplicate requests
- Retry after timeout
- Same idempotency key
- Concurrent wallet updates
- Exactly-once execution

## 8. Business Invariants

Every successful transaction must satisfy:

- Source wallet debited exactly once.
- Destination wallet credited exactly once.
- One transfer record exists.
- One audit record exists.
- One outbox record exists.
- One idempotency record exists.

### Transaction Integrity Rules

- Money is never created.
- Money is never lost.
- Total wallet balance remains constant.
- Duplicate requests never create duplicate side effects.
- Retries never cause double debit.

Example:

```
Wallet A = 1000
Wallet B = 500
Transfer = 300

Result:
Wallet A = 700
Wallet B = 800
Total Balance = 1500 (unchanged)
```

## 9. Test Data Strategy

- Dynamic test data
- Reusable builders
- Independent execution
- No shared mutable state

## 10. Reporting Strategy

Each execution should include:

- Test summary
- Request logs
- Response logs
- Repository snapshot
- Audit snapshot
- Outbox snapshot
- Transaction trace
- Assertion summary

## 11. Continuous Integration Strategy

Pipeline:

1. Checkout
2. Build
3. Spotless Check
4. Compile
5. Execute Tests
6. Publish Reports

## 12. Success Criteria

The solution is successful when:

- API responses match repository state.
- Business invariants are preserved.
- Transaction integrity is maintained.
- No duplicate side effects occur.
- Exactly-once semantics are verified.
- Tests are deterministic.
- Code is maintainable.

## 13. Guiding Principles

- Transaction-first validation
- Multi-layer verification
- Repository Pattern
- Service Layer
- Builder Pattern
- Assertion Layer
- Fixtures
- Constructor Injection
- DRY
- KISS

## 14. Transactional Test Coverage Matrix

| Scenario | API | Workflow | Repository | Audit | Outbox |
|----------|-----|----------|------------|-------|--------|
| Successful Transfer | ✅ | ✅ | ✅ | ✅ | ✅ |
| Invalid Request | ✅ | ✅ | ❌ | ❌ | ❌ |
| Insufficient Balance | ✅ | ✅ | ✅ | ❌ | ❌ |
| Duplicate Request | ✅ | ✅ | ✅ | ✅ | ✅ |
| Retry | ✅ | ✅ | ✅ | ✅ | ✅ |
| Concurrent Transfer | ✅ | ✅ | ✅ | ✅ | ✅ |

## 15. Mapping to Assignment Evaluation Criteria

| Recruiter Evaluation | Framework Approach |
|---------------------|-------------------|
| End-to-End Testing | API → Workflow → Repository → Audit → Outbox validation |
| Data Consistency | Repository verification after every transaction |
| Retry Handling | Retry and idempotency scenarios |
| Duplicate Requests | Idempotency validation |
| Transactional Thinking | Business invariants and conservation of value |
| Maintainability | Layered design, builders, fixtures, assertions |
| Automation Depth | Multi-layer verification beyond HTTP responses |

## 16. Conclusion

This strategy emphasizes transaction-centric automation rather than simple endpoint validation. Every critical workflow is verified across API, business logic, repository state, audit records and outbox events to demonstrate robust automation design and transactional reasoning expected from a Senior SDET.

---

# Architecture

## Wallet Transfer Service Automation Framework

### Document Information

| Item | Value |
|------|-------|
| Project | Wallet Transfer Service |
| Repository | sdet-assignments |
| Implementation Directory | `submission/candidate-java` |
| Architecture Style | Lightweight Layered Architecture |
| Language | Java 21 |
| Build Tool | Maven |

## 1. Executive Summary

This document describes the architecture of the Wallet Transfer Service automation solution.

The architecture is intentionally designed to support **transaction-centric automation testing** rather than a production banking platform. The backend is a lightweight service fixture that enables realistic API, workflow, repository and transactional validation.

The primary design goals are:

- Simplicity
- Maintainability
- Reusability
- Transaction integrity
- Multi-layer verification
- Deterministic execution

## 2. Architectural Principles

The framework follows these principles:

- Single Responsibility Principle
- Separation of Concerns
- Transaction-first validation
- Multi-layer verification
- Reusable automation components
- Constructor Injection
- KISS
- DRY

Only abstractions that provide value for this assignment are implemented.

## 3. Technology Stack

- Java 21
- Maven
- JUnit 5
- RestAssured
- AssertJ
- Jackson
- SLF4J
- Spotless

## 4. High-Level Architecture

```
API Tests
    │
    ▼
TransferApi
    │
    ▼
TransferController
    │
    ▼
TransferService
    │
 ┌──┼──────────────┬──────────────┐
 ▼  ▼              ▼              ▼
WalletRepo   TransferRepo   AuditRepo   OutboxRepo
                  │
                  ▼
         IdempotencyRepository
```

Each layer has a single responsibility and is independently testable.

## 5. Transaction Flow

Every transaction follows the same lifecycle.

```
Receive Request
      │
      ▼
Request Validation
      │
      ▼
Business Rules
      │
      ▼
Debit Source Wallet
      │
      ▼
Credit Destination Wallet
      │
      ▼
Persist Transfer
      │
      ▼
Persist Audit
      │
      ▼
Persist Outbox
      │
      ▼
Store Idempotency Key
      │
      ▼
Return Response
      │
      ▼
Repository Verification
```

## 6. Verification Architecture

Every successful API call is verified across multiple layers.

| Layer | Verification |
|-------|--------------|
| API | Status code, response payload |
| Workflow | Business rules executed |
| Repository | Wallets and transfer persisted |
| Audit | Audit record created once |
| Outbox | Event created once |
| Idempotency | Duplicate request handled correctly |

A transaction is considered successful only when every applicable layer passes validation.

## 7. Project Structure

```
src/
├── main/
│   ├── api/
│   ├── config/
│   ├── controller/
│   ├── dto/
│   ├── model/
│   ├── repository/
│   ├── service/
│   └── util/
└── test/
    ├── api/
    ├── workflow/
    ├── database/
    ├── concurrency/
    ├── builders/
    ├── fixtures/
    └── assertions/
```

## 8. Core Components

### TransferApi

Facade over RestAssured. Responsible for request execution and response parsing.

### TransferController

Exposes REST endpoints and delegates to the service layer.

### TransferService

Implements all business rules:

- Validate request
- Check balances
- Debit/Credit wallets
- Persist transfer
- Create audit
- Create outbox
- Store idempotency key

### Repositories

- WalletRepository
- TransferRepository
- AuditRepository
- OutboxRepository
- IdempotencyRepository

Repositories encapsulate persistence using in-memory collections.

## 9. Persistence Strategy

Storage uses:

- ConcurrentHashMap
- ArrayList

The lightweight persistence layer supports deterministic testing while avoiding unnecessary infrastructure.

## 10. Design Patterns

Only patterns that directly improve maintainability are used.

- Repository Pattern
- Service Layer
- Builder Pattern
- Assertion Layer
- Fixture Pattern
- Constructor Injection

Patterns intentionally **not** used:

- Strategy
- Template Method
- Generic Repository
- Factory Hierarchies
- Service Interfaces

## 11. Failure Handling Strategy

The framework validates realistic transactional failures:

- Invalid requests
- Insufficient balance
- Duplicate requests
- Retry after timeout
- Concurrent requests
- Mocked partial persistence failures

The focus is verifying that the transaction remains consistent even during failures.

## 12. Dependency Rules

Allowed:

```
Tests
  ↓
Assertions
  ↓
TransferApi
  ↓
TransferService
  ↓
Repositories
```

Forbidden:

- Tests → Repository
- Tests → Storage
- Repository → Tests

## 13. Class Responsibility Matrix

| Class | Responsibility |
|-------|----------------|
| TransferApi | REST interactions |
| TransferController | HTTP endpoints |
| TransferService | Business workflow |
| WalletRepository | Wallet persistence |
| TransferRepository | Transfer persistence |
| AuditRepository | Audit persistence |
| OutboxRepository | Outbox persistence |
| IdempotencyRepository | Duplicate request tracking |
| Builders | Test data generation |
| Fixtures | Setup/Cleanup |
| Assertions | Multi-layer validation |

## 14. Transactional Architecture Principles

The architecture ensures:

- API responses match repository state.
- Repository state matches business rules.
- Audit and outbox side effects are verified.
- Duplicate requests never create duplicate side effects.
- Exactly-once semantics are preserved.
- Total monetary value remains consistent.

## 15. Mapping to Assignment Evaluation Criteria

| Recruiter Evaluation | Architectural Support |
|---------------------|----------------------|
| End-to-End Testing | Layered validation from API to repositories |
| Data Consistency | Repository verification after every workflow |
| Retry Handling | Idempotency repository and retry scenarios |
| Duplicate Requests | Exactly-once design |
| Transactional Thinking | Transaction flow and business invariants |
| Maintainability | Layered architecture and reusable components |

## 16. Architecture Summary

The architecture deliberately minimizes backend complexity while maximizing automation quality. Every transaction is validated across API, workflow, repository, audit and outbox layers, demonstrating transactional reasoning, data consistency and maintainable test design expected from a Senior SDET assessment.

---

# Assumptions and Trade-offs

## Wallet Transfer Service Automation Framework

### Document Information

| Item | Value |
|------|-------|
| Repository | sdet-assignments |
| Implementation | `submission/candidate-java` |

## 1. Purpose

This document explains the engineering assumptions and trade-offs made while implementing the assignment.

The decisions prioritise automation quality and maintainability over building a production-ready backend.

## 2. Primary Assumption

The assignment evaluates the quality of automated validation rather than the completeness of a banking platform.

Therefore the implementation focuses on demonstrating:

- API automation
- Business validation
- Persistence verification
- Idempotency
- Concurrency
- Engineering judgement

## 3. Backend Trade-off

### Decision

Implement a lightweight backend fixture.

### Why?

A production backend would require significant infrastructure that is outside the scope of the assignment.

The lightweight fixture is sufficient to validate all required scenarios.

## 4. Storage Trade-off

Instead of:

- PostgreSQL
- Redis

Use:

- ConcurrentHashMap
- ArrayList

Benefits:

- Fast
- Deterministic
- Easy to reset
- CI friendly

## 5. Messaging Trade-off

Instead of Kafka or RabbitMQ:

- Mock Outbox Store
- Mock Audit Store

These allow verification of side effects without external infrastructure.

## 6. Authentication

Authentication is intentionally excluded because it is not required to validate transfer behaviour.

## 7. Design Decisions

The framework intentionally keeps only the abstractions that add value:

- Repository Pattern
- Service Layer
- Builder Pattern
- Assertion Layer
- Fixtures
- Constructor Injection

Patterns that would increase complexity without improving this assignment were intentionally omitted.

## 8. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| No real database | Verify repository state after every workflow |
| No message broker | Validate mock outbox contents |
| In-memory storage | Reset state before each test |
| Parallel execution | Use ConcurrentHashMap and isolated fixtures |

## 9. Limitations

This implementation is not intended to represent a production banking platform.

It intentionally excludes:

- Horizontal scaling
- Distributed transactions
- Event streaming
- Database replication
- Authentication
- Authorization

## 10. Conclusion

The selected trade-offs keep the implementation focused on what the assignment measures: high-quality automation, clean architecture, deterministic execution and maintainable code.