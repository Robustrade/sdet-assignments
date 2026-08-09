# PR: Wallet Transfer Service - Automation Suite

## Overview
This PR introduces a robust, end-to-end automated test suite for the Wallet Transfer Service. The framework is built using **Java, REST Assured, Cucumber (BDD), and TestNG**. It aims to validate not just surface-level HTTP codes, but the deep transactional integrity of the service.

## 1. Test Strategy
- **Levels Covered:** API contract, business workflow, database state verification, and cross-component interactions (outbox).
- **In Scope:** Idempotency handling, concurrent race conditions, safe state transitions, balance invariants, and validation failures.
- **Out of Scope:** Load/Performance testing, UI testing.
- **Test Doubles:** API endpoints and Database layers interact with realistic fixtures. Downstream systems (like actual Kafka queues) are verified via the database outbox pattern.

## 2. API Validation Approach
REST Assured is abstracted into reusable client classes. Tests cover:
- **Contract & Responses:** Ensures payload shapes and HTTP status codes (200, 400) adhere to strict contracts.
- **Idempotency (Duplicate Behavior):** By sending requests with identical `Idempotency-Key` headers, we assert that the system catches the duplication, does not double-process, and returns the exact logical response from the initial request.

## 3. Database Validation Approach
Persistence checks are treated as equal citizens to API checks. 
- **Tables Checked:** `wallets` (balances), `transfers` (state/metadata), `outbox_events`.
- **Invariants Asserted:** 
  - Net movement of money is zero-sum (Source Debit == Destination Credit).
  - No negative balances occur during concurrent exhaustion tests.
  - Rejected requests result in zero persistence of invalid transfer rows.

## 4. Cross-Component Validation
Verified the **Transactional Outbox Pattern**. The test asserts that upon a successful API transfer and DB write, exactly *one* event is written to the `outbox_events` table, ensuring exactly-once emission semantics for downstream services.

## 5. Concurrency and Reliability
Using Java's `ExecutorService`, the suite fires concurrent requests against the same wallet. We validate:
- **Overdraft Protection:** 5 simultaneous threads attempt to withdraw from a limited pool; the test asserts the final balance never drops below zero.
- **Data Integrity:** The total sum of both wallets before and after the concurrent race condition remains identical, proving database lock/transaction correctness.

## 6. Test Architecture
- **BDD Gherkin:** Scenarios are readable by product and engineering teams.
- **Separation of Concerns:** 
  - `TransferClient`: Handles HTTP transport.
  - `DatabaseHelper`: Handles JDBC persistence checks.
  - `TransferSteps`: Binds test data and assertions without exposing raw REST or SQL logic.
- **Maintainability:** Red, Blue, Green discipline was followed. Helper classes allow new scenarios to be added by writing purely Gherkin, with no new Java code needed.