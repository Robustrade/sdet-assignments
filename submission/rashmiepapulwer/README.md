# Wallet Transfer Service – Automation Test Framework

A Java 17 based end-to-end API automation framework for validating a Wallet Transfer Service.
The framework validates wallet transfers by combining API-level verification with direct database validation to ensure business correctness, data integrity, and repeatable test execution.
---

# Overview

This project implements an integration test framework for the Wallet Transfer Service assignment using:
- Java 17
- JUnit 5
- REST Assured
- Testcontainers
- PostgreSQL
- Maven

The framework follows a layered architecture to separate API communication, database validation, test data creation, assertions, and test execution, making it easy to extend with additional scenarios.

---

# Framework Architecture

```
src/test/java/com/wallet
│
├── base/
│   └── WalletTransferTestBase.java
│
├── client/
│   ├── WalletTransferApiClient.java
│   └── DatabaseVerificationClient.java
│
├── fixture/
│   ├── WalletFixture.java
│   └── TransferRequestBuilder.java
│
├── assertions/
│   ├── TransferAssertions.java
│   └── WalletAssertions.java
│
├── model/
│   ├── TransferRequest.java
│   ├── TransferResponse.java
│   ├── TransferRecord.java
│   └── WalletBalance.java
│
└── tests/
    ├── HappyPathTransferTest.java
    ├── ValidationFailureTest.java
    ├── IdempotencyTest.java
    └── ReliabilityTest.java
```

---

# Design Principles

The framework has been designed around the following principles:

## Separation of Concerns

Each layer has a single responsibility.

- API communication
- Database verification
- Test fixtures
- Assertions
- Test scenarios

are implemented independently.

---

## Reusability

Common functionality is centralized to avoid duplication.

Examples include:

- reusable API client
- reusable request builders
- reusable wallet fixtures
- fluent assertions
- shared test lifecycle

---

## Maintainability

Business scenarios remain concise because infrastructure code is abstracted away.

Adding a new scenario generally requires only:

- creating fixture data
- calling the API client
- writing assertions

without changing framework components.

---

## Test Isolation

Every test executes with independent data.

Wallets created during a test are tracked and removed during cleanup, allowing tests to execute independently and without side effects.

---

# Implementation Approach

The framework assumes an existing Wallet Transfer Service is already running.

Rather than testing internal implementation details, the framework validates observable system behaviour through:

- HTTP requests
- API responses
- persisted database state

This provides true integration testing across service boundaries.

---

# Validation Strategy

## API Validation

REST Assured is used to validate:

- HTTP status codes
- response payloads
- validation errors
- business responses
- idempotency behaviour

The API client encapsulates all HTTP communication so tests remain readable.

---

## Database Validation

Database verification is performed using JDBC after API execution.

Typical validations include:

- wallet balances
- transfer records
- persisted transaction data
- consistency between API response and stored data

This ensures the API response accurately reflects the persisted state.

---

# Test Coverage

The framework currently includes tests covering:

## Happy Path

- Successful wallet transfer
- Sender balance update
- Receiver balance update
- Database verification after transfer

---

## Validation

- Invalid requests
- Missing mandatory fields
- Invalid amounts
- Business rule validation

---

## Idempotency

- Duplicate requests
- Same idempotency key
- Replay behaviour

---

## Reliability

Concurrency scenarios validating behaviour under simultaneous requests.

These tests help verify consistency when multiple requests execute concurrently.

---

# Framework Components

## WalletTransferTestBase

Provides:

- Testcontainers lifecycle
- Rest Assured configuration
- shared API client
- database client
- test setup
- cleanup

---

## WalletTransferApiClient

Encapsulates all HTTP communication with the Wallet Transfer Service.

Tests interact with this client instead of directly using REST Assured.

---

## DatabaseVerificationClient

Provides reusable JDBC methods for verifying database state after API execution.

---

## WalletFixture

Creates reusable wallet data required for test execution.

This keeps scenarios independent from data creation logic.

---

## TransferRequestBuilder

Uses the Builder pattern to create readable request payloads for different scenarios.

---

## Custom Assertions

Fluent assertion classes improve readability by expressing business expectations directly instead of relying only on raw JUnit assertions.

---

# Test Execution

## Prerequisites

- Java 17
- Maven 3.8+
- Docker Desktop
- Running Wallet Transfer Service

---

## Configure Service URL

Default:

```
http://localhost:8080
```

Override if required:

```bash
export WALLET_SERVICE_URL=http://localhost:8080
```

---

## Run All Tests

```bash
mvn clean test
```

---

## Run Individual Test Classes

```bash
mvn test -Dtest=HappyPathTransferTest
mvn test -Dtest=ValidationFailureTest
mvn test -Dtest=IdempotencyTest
mvn test -Dtest=ReliabilityTest
```
---

# Technology Stack

- Java 17
- Maven
- JUnit 5
- REST Assured
- PostgreSQL
- Testcontainers
- JDBC

---

# Future Improvements

Potential enhancements include:
- Allure reporting
- CI/CD integration
- Performance testing
- Docker Compose support
- Additional negative scenarios
- Authentication and authorization coverage

---

# AI Usage
AI-assisted tooling was used to accelerate boilerplate generation, including project structure, builder patterns, and utility classes.
The overall framework design, test strategy, validation approach, concurrency scenarios, database verification, and architectural decisions were reviewed, adapted, and refined manually.
The final implementation reflects manual engineering decisions regarding framework structure, reusable components, business validations, and overall test design.