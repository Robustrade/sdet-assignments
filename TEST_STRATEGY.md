# Wallet Transfer Service - Test Strategy

## 1. Objective

The objective of this test solution is to validate the correctness, reliability, and data consistency of the Wallet Transfer Service.

The automation validates the transfer flow from API request through business processing to the final persisted database state.

The primary focus is:

* Transactional correctness
* Wallet balance accuracy
* Idempotency
* Retry-safe behavior
* Duplicate request handling
* Concurrent transfer handling
* API and database consistency
* Prevention of duplicate financial side effects
* Validation of negative and failure scenarios

---

## 2. Scope

### In Scope

* Successful wallet-to-wallet transfers
* API request and response validation
* Request validation and invalid input handling
* Insufficient balance scenarios
* Invalid/non-existent wallet scenarios
* Idempotency and duplicate request handling
* Retry-safe behavior
* Concurrent transfer attempts
* Transfer status validation
* Wallet balance validation
* Transfer persistence validation
* Database consistency with API results
* Prevention of duplicate financial side effects
* Transaction rollback behavior where supported by the service

### Out of Scope

* UI testing
* Performance/load testing
* Production-scale stress testing
* Full production monitoring and observability
* Exhaustive testing of every possible wallet feature
* Testing external systems that are not available in the provided environment
* Production-grade distributed-system chaos testing

---

## 3. Assumptions

The test solution assumes that the Wallet Transfer Service provides the transfer and wallet functionality required by the assignment.

Where applicable, the service exposes APIs such as:

* `POST /transfers`
* `GET /transfers/{transfer_id}`
* `GET /wallets/{wallet_id}`

The transfer API supports an `Idempotency-Key` header where required by the service contract.

The service uses a relational database for persistence.

The test environment uses an isolated database to prevent test execution from interfering with external or previously created data.

Where a supporting production component is not provided by the service, the corresponding behavior is documented as a limitation rather than assumed to exist.

---

## 4. Test Levels

The solution covers the following validation levels.

### API Level

The API tests validate:

* HTTP status codes
* Response payload
* Required response fields
* Request validation
* Error responses
* Transfer status
* Idempotency behavior
* Invalid request handling

### Business Workflow Level

The business workflow tests validate:

* Successful transfer workflow
* Source wallet debit
* Destination wallet credit
* Transfer status
* Insufficient balance behavior
* Invalid wallet behavior
* Retry behavior
* Idempotency
* Duplicate request handling
* Concurrent transfer behavior

### Database Level

The database tests validate the database state after relevant operations, including:

* Wallet balances
* Transfer records
* Transfer status
* Transfer amount
* Source and destination wallet references
* Absence of duplicate transfer records
* Consistency between API results and database state
* Rollback behavior where applicable

### Cross-Component Level

Where supporting components are available in the provided implementation, the test solution can validate:

* Audit/event records
* Outbox records
* Downstream side effects
* Retry-safe side effects

If these components are not part of the provided service, they are treated as limitations rather than assumed functionality.

---

## 5. API Validation Strategy

API requests are executed using RestAssured.

The tests validate both successful and unsuccessful responses.

Key validation scenarios include:

* Successful transfer
* Missing required fields
* Invalid currency
* Zero transfer amount
* Negative transfer amount
* Same source and destination wallet
* Invalid/non-existent source wallet
* Invalid/non-existent destination wallet
* Insufficient wallet balance
* Duplicate request using the same idempotency key
* Same idempotency key with a different request payload

The API response alone is not considered sufficient for critical financial scenarios.

Important operations are also verified against the database to ensure that the persisted state matches the API result.

---

## 6. Database Validation Strategy

Database state is validated after relevant API and business operations.

The tests validate the database tables and structures that are actually available in the provided service, such as:

* `wallets`
* `transfers`

The tests verify that:

* A successful transfer creates the expected transfer record.
* The source wallet is debited by the correct amount.
* The destination wallet is credited by the correct amount.
* The transfer contains the expected source and destination wallets.
* The transfer amount is persisted correctly.
* The transfer reaches the expected status.
* Rejected transfers do not incorrectly modify wallet balances.
* Duplicate requests do not create duplicate financial transactions.
* API results are consistent with the persisted database state.
* Transaction rollback does not leave partial wallet balance updates.

Test data is seeded before execution and isolated between scenarios where possible to avoid false positives caused by stale or shared data.

---

## 7. Business Invariants

The following business invariants are explicitly validated.

### Successful Transfer

For a transfer amount `X`:

* Source wallet balance decreases by exactly `X`.
* Destination wallet balance increases by exactly `X`.
* The transfer is persisted with the correct amount.
* The correct source and destination wallets are associated with the transfer.
* The transfer reaches the expected final status.

### Rejected Transfer

For a rejected transfer:

* Source wallet balance remains unchanged.
* Destination wallet balance remains unchanged.
* No successful transfer side effect is created.
* No incorrect transfer record is created.

### Duplicate Request

For the same idempotency key:

* The operation is processed only once.
* The original logical result is safely replayed or returned according to the service contract.
* Wallet balances are not changed more than once.
* Duplicate transfer records are not created.

---

## 8. Idempotency Strategy

Idempotency is treated as a critical requirement for a financial transfer service.

The following scenarios are covered:

### 1. Same Idempotency Key + Same Payload

Expected behavior:

* The original logical result is returned or replayed.
* A second financial transfer is not created.
* Wallet balances are not changed again.

### 2. Same Idempotency Key + Different Payload

Expected behavior:

* The request is rejected according to the service contract.
* The original transaction is not modified.
* No additional financial side effect is created.

### 3. Multiple Requests With the Same Idempotency Key

Expected behavior:

* Only one logical transfer is created.
* Wallet balances are updated only once.
* Duplicate financial side effects are prevented.

### 4. Retry After a Lost Response

Expected behavior:

* Retrying the request with the same idempotency key does not create another transfer.
* The original transaction remains the single financial operation.

---

## 9. Concurrency and Reliability Strategy

Concurrency tests use multiple threads/tasks to submit requests approximately at the same time.

### Concurrent Duplicate Requests

Multiple requests with the same idempotency key are submitted concurrently.

The test verifies:

* Only one logical transfer is created.
* Wallet balances are updated only once.
* Duplicate transfer records are not created.
* No duplicate financial side effects occur.

### Competing Transfers

Two or more transfers compete for a limited wallet balance.

The test verifies that:

* The wallet cannot be incorrectly overdrawn.
* Only valid transfers are completed.
* Rejected transfers do not incorrectly modify balances.
* The final database state remains consistent.

### Retry Safety

A transfer is followed by a retry using the same idempotency key.

The test verifies that:

* The retry does not create another transfer.
* Wallet balances are not modified a second time.
* The original transfer remains consistent.

---

## 10. Test Data Strategy

Test data is created using reusable test data builders, fixtures, or helper methods.

Typical test data includes:

* Wallet with sufficient balance
* Wallet with insufficient balance
* Source wallet
* Destination wallet
* Transfer request
* Unique idempotency key
* Invalid wallet identifiers
* Valid and invalid transfer amounts

Each test should use isolated or uniquely identifiable data where possible to prevent tests from depending on execution order.

Test data should be deterministic so that failures can be reproduced easily.

---

## 11. Test Architecture

The automation separates API interaction, database access, test data creation, and test assertions.

A proposed structure is:

```text
src/test/java/

├── tests/
├── client/
├── database/
├── models/
├── builders/
└── assertions/
```

### Tests

Contain the business scenarios and overall test flow.

### API Client

Encapsulates RestAssured API calls and keeps HTTP implementation details outside the test cases.

### Database Layer

Provides reusable database connection, query, and validation methods.

### Models

Represent API request and response objects where appropriate.

### Builders/Fixtures

Create reusable wallets, transfers, requests, and test data.

### Assertions

Provide reusable business-level assertions for API and database validation.

This separation improves readability, maintainability, and reusability.

---

## 12. Environment and Test Isolation

Testcontainers is used to provide an isolated PostgreSQL environment for integration testing.

The PostgreSQL container is created specifically for the automated test execution.

The test database is configured with the required:

* Database name
* Username
* Password

These credentials are test-only credentials used by the temporary PostgreSQL container.

The tests should not depend on an existing local PostgreSQL database.

The test environment is isolated so that the test suite can be executed consistently across different machines that have Docker available.

The database is initialized with the required schema and test data before the relevant tests execute.

Where possible, test data is recreated or cleaned between test scenarios to prevent state leakage between tests.

---

## 13. Red-Green-Refactor Approach

The implementation follows a behavior-first approach.

### Red

Create an automated test for an important business behavior or invariant.

Examples include:

* Successful transfer
* Insufficient balance
* Duplicate request
* Idempotent retry
* Concurrent transfer

The test initially fails when the required behavior is not yet implemented or verified.

### Green

Implement the minimum required service, fixture, database, or test support necessary for the test to pass.

### Refactor

Improve the implementation and test code for:

* Readability
* Reusability
* Maintainability
* Separation of concerns
* Reduced duplication

while keeping the tests passing.

Intermediate development steps are not required in the final submission, but the final solution follows the principles of behavior-driven test development and incremental validation.

---

## 14. Assumptions About Supporting Components

The core focus of this assignment is the wallet transfer transaction and its consistency across the API, business, and database layers.

If an audit, event, outbox, notification, or downstream component is available in the provided service, the relevant behavior can be validated.

If a supporting component is not available, the test solution does not assume that the component exists.

Instead, the expected testing approach is documented as a limitation.

This avoids treating unavailable production functionality as implemented functionality.

Any test double or fixture used to demonstrate an integration concept will be clearly identified.

---

## 15. Known Limitations

This assignment is intentionally focused on the wallet transfer service.

The solution does not attempt to provide:

* Production-scale performance testing
* Full distributed-system chaos testing
* Complete monitoring and observability validation
* Exhaustive downstream integration testing
* Every possible wallet business rule
* Independent production audit infrastructure
* Exactly-once Outbox processing where an Outbox implementation is not provided

Partial failure and invalid state-transition scenarios that cannot be fully simulated using the provided service are documented as limitations.

The test solution focuses on validating the behavior and consistency that can be reliably exercised within the supplied application and test environment.

---

## 16. Execution

The complete automated test suite can be executed using Maven:

```bash
mvn clean test
```

Docker Desktop must be running because Testcontainers is used to start the PostgreSQL test environment.

The test execution covers:

* Transfer API tests
* Database/Testcontainers integration tests
* Business workflow/service tests
* Validation and negative scenarios
* Idempotency tests
* Duplicate request tests
* Concurrency/retry scenarios where supported
* API-to-database consistency validation

---

## 17. Success Criteria

The test solution is considered successful when it demonstrates that:

* Valid transfers succeed correctly.
* Invalid transfers are rejected correctly.
* Insufficient balance does not cause incorrect balance mutations.
* Source wallet balances are debited correctly.
* Destination wallet balances are credited correctly.
* Transfer records are persisted correctly.
* Duplicate requests are handled safely.
* Idempotent retries do not create duplicate financial side effects.
* Concurrent requests are handled safely.
* Wallets cannot be incorrectly overdrawn.
* API results match the persisted database state.
* Rejected transactions do not leave incorrect partial state.
* Transfer records remain internally consistent.
* The test environment is isolated using Testcontainers.
* The automation is maintainable, reusable, and easy to extend.
* The complete test suite can be executed using `mvn clean test`.
