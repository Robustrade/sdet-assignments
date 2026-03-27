# Wallet Transfer Service — Software Developer in Test Assignment

## Overview

Design and implement an automated test solution for a **Wallet Transfer Service**.

This assignment is intended to evaluate senior **Software Developer in Test / QA Automation Engineer** candidates on the kind of problems that matter in real backend systems:

- end-to-end test design across service boundaries
- API, persistence, and workflow validation
- correctness under retries, duplicates, and partial failures
- data consistency validation from API response to database state
- test architecture and maintainability
- automation depth over superficial UI-style checks
- ability to reason about transactional systems, not just endpoints

This is intentionally **not** a basic CRUD API testing exercise. The goal is to assess whether you can design an automation approach that validates a reliable transactional system end to end.

Focus on **clarity, coverage strategy, correctness, and test design quality** over building a huge framework.

---

## Problem Statement

You are given a backend service in the **wallet transfer domain**.

The service supports moving money from one wallet to another and is expected to handle:

- duplicate requests
- retries
- safe state transitions
- concurrency
- data consistency
- exactly-once semantics at the API level

Your task is **not** to build the service itself from scratch unless you choose to create a small stub or test fixture to support your tests.

Your task is to design and implement an **automated validation suite** for a Wallet Transfer Service that proves behavior at multiple levels:

1. **API level**
2. **service / workflow level**
3. **database level**
4. **cross-component level**, where applicable

The automation should validate the full path from **request received at the API** to **final persisted state in the database**, including any other relevant components in play such as:

- idempotency store
- outbox/event table
- message queue
- audit/event log
- notification or downstream hooks
- reconciliation artifacts

You may simulate some components if needed for local scope, but your design should make clear what is real, what is stubbed, and what is being verified.

---

## Time Expectation

Please spend **3–5 hours** on this assignment.

We do not expect a massive enterprise test platform. We care more about:

- sound test strategy
- meaningful automation depth
- ability to validate transactional correctness
- maintainable test architecture
- clear documentation of tradeoffs and risks

A smaller but deeply thoughtful solution is preferred over a wide but shallow one.

---

## Domain Context

Assume the Wallet Transfer Service has behavior roughly like the following.

### Core Operation

`POST /transfers`

Example request:

```json
{
  "source_wallet_id": "wallet_001",
  "destination_wallet_id": "wallet_002",
  "amount": 2500,
  "currency": "AED",
  "reference": "invoice_123"
}
```

Header:

```text
Idempotency-Key: 8c1f4f0b-8d5c-4d7c-bb55-123456789abc
```

### Example Read Endpoints

```text
GET /transfers/{transfer_id}
GET /wallets/{wallet_id}
```

### Expected Service Behaviors

At minimum, assume the system should support:

- successful transfer between wallets with sufficient balance
- insufficient balance rejection
- duplicate request replay using idempotency key
- prevention of duplicate side effects
- valid transfer state transitions
- consistent debit and credit behavior
- durable persisted transfer record
- auditability of transfer lifecycle

You may extend the assumptions slightly if your test solution needs additional realism, but keep the domain centered on wallet transfer reliability.

---

## What You Need to Build

Build an automated test solution that validates the Wallet Transfer Service at **multiple layers**.

### Required Validation Depth

Your test solution must validate behavior across the following layers.

#### 1) API Validation
Validate:
- request/response correctness
- response codes
- response payload shape
- duplicate request behavior
- validation errors
- contract assumptions

#### 2) Business Workflow Validation
Validate:
- transfer lifecycle
- status transitions
- invariants such as balance conservation
- idempotency semantics
- retry behavior
- partial failure expectations where applicable

#### 3) Database Validation
Validate:
- transfer row(s) written correctly
- wallet balances updated correctly
- idempotency records stored correctly
- audit/event rows written where applicable
- invalid or duplicate side effects are not persisted

Your tests should demonstrate that the **database state matches the API outcome** and the business rules.

#### 4) Cross-Component Validation
If the system has supporting components, validate them as part of the test flow.

Examples:
- outbox row created after successful transfer
- event published once
- notification trigger invoked once
- failure recorded in dead-letter or error table
- reconciliation/audit trail updated

You do not need to implement every surrounding system fully, but your test design must show that you can validate system behavior beyond the API boundary.

---

## Functional Expectations

Your automation suite should cover the following categories.

### A) Happy Path Transfer
Validate that:

- transfer request succeeds
- source wallet is debited exactly once
- destination wallet is credited exactly once
- transfer status is correct
- persisted records are correct
- related components are updated consistently

### B) Validation Failures
Cover examples such as:

- missing required fields
- invalid currency
- negative or zero amount
- source and destination wallet same
- malformed idempotency key if you choose to validate it

These tests should verify both API response behavior and absence of invalid persistence.

### C) Insufficient Balance
Validate that:

- transfer is rejected
- balances remain unchanged
- no invalid success record is created
- any failure record, if applicable, is correct

### D) Idempotency / Duplicate Submission
This is mandatory.

Validate scenarios such as:

- same idempotency key + same payload returns original logical result
- same idempotency key + different payload is rejected
- duplicate submissions do not create duplicate transfer rows
- duplicate submissions do not double-debit or double-credit wallets
- retries remain safe after response loss assumptions

### E) Concurrency and Race Conditions
This is mandatory.

Validate scenarios such as:

- two concurrent transfer attempts competing for limited balance
- concurrent duplicate requests with same idempotency key
- race conditions around read-after-write consistency where relevant

These tests do not need to be massively complex, but they should demonstrate deliberate thinking about failure-prone behavior.

### F) Persistence and Auditability
Validate that:

- transfer records match the API-visible result
- wallet balances reflect the expected net movement
- audit/event tables are populated correctly
- timestamps / statuses / references are coherent
- no contradictory records exist

### G) Component Interaction Validation
Where supporting components exist, validate one or more of:

- outbox/event log behavior
- downstream publish attempt
- exactly-once event emission semantics
- error path recording
- retry-safe side effects

You may use stubs, fakes, interceptors, or local test doubles if needed.

---

## System Under Test Assumptions

You may choose one of the following approaches and document it clearly.

### Option 1 — Test an Existing Service
If a service implementation is provided, write automation around it.

### Option 2 — Build a Minimal Service Fixture
If no service is provided, create a minimal wallet transfer implementation or test harness sufficient to demonstrate your test strategy.

### Option 3 — Hybrid
Create a lightweight service plus test doubles for surrounding dependencies.

All options are acceptable, provided the assignment remains focused on **test engineering quality** rather than on building a full product.

---

## Architecture Expectations for the Test Solution

We expect a clean, maintainable automation structure.

A strong submission will usually make the following distinctions clear:

### 1) Test Fixtures / Environment Setup
Responsibilities:
- seed wallets and balances
- prepare database state
- configure test doubles
- isolate test runs where reasonable

### 2) API Client / Test Interface Layer
Responsibilities:
- encapsulate API calls
- keep transport details out of test logic
- support reusable request construction

### 3) Assertion / Verification Layer
Responsibilities:
- validate API responses
- validate database state
- validate side effects in dependent components
- express business expectations clearly

### 4) Test Scenarios / Specifications
Responsibilities:
- describe behavior in a readable way
- group related scenarios
- make failure intent obvious

### 5) Test Utilities / Data Builders
Responsibilities:
- create wallets, transfers, idempotency keys, and seed data
- avoid repetitive setup noise
- keep tests easy to read

The exact structure is your choice, but the suite should be easy to reason about and extend.

---

## Documentation-First Workflow

Before writing substantial automation code, document the intended validation strategy.

At minimum, include:

- assumptions about the system under test
- scope of automation
- test levels covered
- what is real vs mocked/stubbed
- API contracts
- database entities checked
- supporting components checked
- concurrency strategy
- idempotency validation strategy
- known limitations

We are intentionally looking for candidates who can define a **test strategy for a transactional system** before writing large amounts of code.

---

## Required Database Coverage

Your test suite must validate persistence, not just API responses.

At minimum, assume the following types of persisted artifacts exist and validate those relevant to your design:

- `wallets`
- `transfers`
- `idempotency_keys`
- `transfer_events` or audit log
- `outbox_events` or equivalent, if modeled

Document:

- which tables are checked
- which invariants are asserted
- how test data is seeded and cleaned
- how you avoid false positives from stale data

---

## Required Invariants to Validate

A strong solution will validate explicit invariants such as:

- source wallet balance decreases exactly once on success
- destination wallet balance increases exactly once on success
- total balance movement is correct for the transfer amount
- no balance mutation occurs on rejected transfers
- duplicate requests do not create duplicate side effects
- persisted transfer state matches externally observed API result
- related event/audit records are internally consistent

You may define additional invariants if helpful.

---

## Reliability and Failure Expectations

Your test strategy should explicitly account for the following classes of problems:

- duplicate requests
- concurrent requests
- partial execution attempts
- response loss / client retry assumptions
- invalid state transitions
- persistence mismatches
- broken side-effect sequencing
- stale read or race-condition behavior where relevant

We are not testing whether you can enumerate every possible failure mode. We are testing whether you know how to automate the ones that matter most.

---

## Testing Requirements

We expect meaningful automation, not just endpoint smoke tests.

### Required Testing Categories

#### 1) API Contract and Validation Tests
Cover:
- success responses
- validation failures
- not-found or invalid resource scenarios where relevant
- duplicate replay behavior

#### 2) Database Verification Tests
Cover:
- wallet balance updates
- transfer persistence
- idempotency storage
- audit/event rows
- absence of duplicate side effects

#### 3) End-to-End Flow Tests
Cover the path from:
- API request
- service processing
- persistence
- side-effect verification

#### 4) Concurrency / Reliability Tests
Cover:
- duplicate in-flight requests
- competing transfers
- retry safety

#### 5) Component Interaction Tests
Cover one or more downstream/adjacent components where relevant.

Examples:
- outbox written once
- event emitted once
- audit trail consistent
- failure path recorded

### Red, Blue, Green Discipline

Please follow a **Red, Blue, Green** workflow:

- **Red**: write a failing automated test for an important behavior or invariant
- **Blue**: implement the minimum necessary support code or fixture to make it pass
- **Green**: refactor for readability, reusability, and maintainability while keeping tests green

You do not need to submit every intermediate step, but your approach should reflect disciplined test-first or behavior-first thinking.

---

## Technology Choices

You may use any language and automation stack you are comfortable with.

Examples:
- Java + RestAssured + Testcontainers
- TypeScript + Playwright API / supertest
- Python + pytest + requests / sqlalchemy
- Go + httptest / integration helpers

Please prefer a stack that makes your test logic and verification strategy easy to understand.

If you make simplifying assumptions, document them.

---

## Non-Goals

You do **not** need to build:

- a frontend UI
- exhaustive performance testing
- a full production monitoring setup
- elaborate test-report dashboards
- every possible wallet feature

Keep the scope tight. Depth is more important than breadth.

---

## Deliverables

Please submit your solution as a **Pull Request**.

Your PR should include:

- automation test code
- any minimal service fixture or test harness needed
- database setup/seed instructions
- documentation on how to run the tests
- a short design/test strategy explanation
- assumptions, tradeoffs, and limitations

### PR Description Requirements

Your PR description must explicitly explain:

1. **Test strategy**
   - what levels are covered
   - what is in scope vs out of scope
   - what is real vs stubbed/mocked

2. **API validation approach**
   - how requests/responses are validated
   - how duplicate and error behavior are covered

3. **Database validation approach**
   - which tables are checked
   - what invariants are asserted
   - how data correctness is confirmed

4. **Cross-component validation**
   - which supporting components are verified
   - how exactly-once or retry-safe side effects are asserted

5. **Concurrency and reliability coverage**
   - which race/retry scenarios are tested
   - what confidence those tests provide

6. **Test architecture**
   - how the suite is structured
   - why it is maintainable

7. **Responsible AI usage**
   - whether you used AI tools
   - where they helped
   - what you personally reviewed, validated, or corrected

Please be candid. AI usage is allowed, but we care about test engineering judgment, not generated volume.

---

## What We Are Optimizing For

A strong submission is one that:

- validates behavior across API, service flow, database, and adjacent components
- proves important invariants, not just status codes
- covers duplicate requests and concurrency meaningfully
- is easy to reason about and maintain
- documents assumptions and tradeoffs clearly

A smaller but robust automation solution is preferred over a broad but superficial one.
