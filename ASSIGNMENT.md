# Summary

Implemented an automated validation suite for a Wallet Transfer Service with focus on correctness, reliability, and data consistency.

The solution includes:

* API validation using RestAssured
* Database validation using PostgreSQL and Testcontainers
* Idempotency verification
* Concurrency and race-condition testing
* Audit event validation
* Outbox event validation
* Schema validation utilities
* Minimal in-process wallet transfer fixture to support execution of the automated test suite

The fixture is intentionally lightweight and exists only to exercise the validation strategy described in the assignment.

---

# Test Strategy

The approach focuses on validating business invariants rather than only HTTP responses.

Key validation areas:

### API Validation

* Happy path transfer
* Invalid requests
* Missing fields
* Invalid amounts
* Unknown wallets
* Insufficient balance
* Idempotency conflict scenarios

### Business Workflow Validation

* Atomic debit/credit operations
* Balance conservation
* Transfer lifecycle validation
* Exactly-once semantics

### Database Validation

Validated persistence across:

* wallets
* transactions
* idempotency_keys
* audit_events
* outbox_events

Assertions verify both data correctness and side effects.

### Reliability & Concurrency

Validated:

* Same idempotency key + same payload
* Same idempotency key + different payload
* Concurrent duplicate requests
* Concurrent competing transfers
* Retry safety
* Double-debit prevention

---

# API Validation Approach

Tests use a dedicated WalletTransferClient built on RestAssured.

Validation includes:

* Status codes
* Response contract
* Required fields
* Transaction status
* Error handling
* Idempotency behavior

Tests avoid direct RestAssured calls and interact through reusable client abstractions.

---

# Database Validation Approach

Database assertions are performed using a dedicated JDBC-based DbClient and repository helpers.

Validated:

* Sender balance updates
* Receiver balance updates
* Transaction persistence
* Audit event creation
* Outbox event creation
* Idempotency record persistence

Business invariants such as balance conservation are verified after every successful transfer.

---

# Cross-Component Validation

Successful transfers are validated across multiple layers:

API Response
→ Transaction Record
→ Wallet Balances
→ Audit Event
→ Outbox Event

Tests verify that side effects occur exactly once.

---

# Reliability / Concurrency Coverage

Implemented scenarios:

### Same Key + Same Payload

* Returns original logical result
* No duplicate transaction rows
* No duplicate side effects

### Same Key + Different Payload

* Returns 409 Conflict
* No additional transaction created

### Concurrent Requests With Same Key

* Exactly one logical transfer created
* Single debit
* Single credit
* Single audit event
* Single outbox event

### Competing Transfers

Two concurrent transfers competing for limited balance.

Validation:

* No overdraft
* Exactly one successful transfer
* Balance consistency maintained

---

# Test Architecture

Technologies:

* Java 17
* JUnit 5
* RestAssured
* PostgreSQL
* Testcontainers
* JDBC

Structure:

* api/
* db/
* reliability/
* fixtures/
* support/

Reusable builders, repositories, and helper classes are used to keep tests readable and maintainable.

---

# Validation Steps

Executed validations include:

* Happy path transfer
* Validation failures
* Insufficient balance scenarios
* Idempotency verification
* Concurrency verification
* Database verification
* Audit verification
* Outbox verification
* Schema verification

---

# Known Limitations

* Minimal fixture implementation intended only to support automated validation scenarios.
* No performance/load testing.
* No authentication/authorization coverage.
* No broker delivery verification beyond outbox persistence.
* Single-currency validation only.

---

# Author Checklist

* [x] API validation implemented
* [x] Database validation implemented
* [x] Idempotency validation implemented
* [x] Concurrency validation implemented
* [x] Audit validation implemented
* [x] Outbox validation implemented
* [x] Schema validation implemented
* [x] Documentation updated
* [x] Minimal executable fixture included
* [x] Solution aligned with assignment requirements
