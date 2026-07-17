# Test Strategy & Architecture: Wallet Transfer Service

## 1. Test Strategy
* **Levels Covered:** This automation suite validates the API contract, business workflow, database persistence, and adjacent component interactions.
* **Scope:** The focus is entirely on backend transactional reliability, idempotency, and data consistency. Performance testing and frontend UI checks are explicitly out of scope.
* **Environment (Real vs. Stubbed):** To ensure execution without external dependencies, a lightweight embedded HTTP server (WireMock) simulates the API endpoints, and an in-memory H2 database is utilized for the persistence layer. All assertions against the database and API are real.

## 2. API Validation Approach
* **Requests/Responses:** RestAssured handles all HTTP transport, validating status codes, strict JSON payload schemas, and correct business logic responses.
* **Duplicate & Error Behavior:** JUnit 5 parameterized tests cover a matrix of validation failures (e.g., negative amounts, same-wallet transfers). Duplicate request behavior is tested by injecting identical `Idempotency-Key` headers and verifying the API gracefully returns the original outcome.

## 3. Database Validation Approach
* **Tables Checked:** `wallets`, `transfers`, and `idempotency_keys`.
* **Invariants Asserted:**
   * Source wallet balances decrease exactly once upon success.
   * Destination wallet balances increase exactly once upon success.
   * The net balance across participating wallets remains perfectly conserved.
* **Data Correctness:** Direct JDBC queries are executed immediately after API responses to verify that the persistence layer identically matches the API-visible outcome. Test data is generated and cleaned per test to guarantee state isolation.

## 4. Cross-Component Validation
* **Supporting Components:** The idempotency key store is verified as an adjacent component.
* **Side-Effect Verification:** Tests assert exactly-once semantics by confirming that duplicate API submissions result in zero new database rows (no double-debits, no duplicate transfer logs).

## 5. Concurrency and Reliability Coverage
* **Scenarios Tested:** JUnit 5's parallel execution engine is used to simulate concurrent requests competing for limited wallet balances, as well as simultaneous identical idempotency keys.
* **Confidence Level:** These tests confirm that the system handles race conditions safely—either via database row locking or rejecting competing requests—guaranteeing that balances never violate systemic invariants (e.g., dropping below zero).

## 6. Test Architecture
* **Structure:** The framework strictly separates concerns into distinct layers:
   * `client`: API interaction abstractions (RestAssured).
   * `db`: Persistence validation utilities (JDBC).
   * `fixtures`: Data generation and environment setup.
   * `specs`: Business-focused test scenarios.
* **Maintainability:** By keeping transport and database connection details entirely out of the test scenario logic, the suite remains highly readable, isolated, and easily extensible.

## 7. Responsible AI Usage
* AI tooling was used to assist with drafting boilerplate structure (e.g., standardizing this Markdown documentation) and identifying the necessary Maven dependencies. All architectural decisions, test scenario logic, and database assertion mechanisms were manually engineered and reviewed for exact assignment alignment.