# Wallet Transfer Service — SDET Test Suite (Java + RestAssured)

Automated validation suite for a transactional Wallet Transfer Service, covering API, persistence, idempotency, concurrency, and cross-component invariants.

## Test Strategy

### System Under Test

A minimal **Javalin + H2 in-memory** wallet transfer service fixture lives in `src/main/java/com/kulu/sdet/service/`. It mirrors the Python reference implementation (`submission/sample-candidate/service/app.py`) and is started automatically by the test harness — no external server required.

### Test Levels Covered

| Level | Approach |
|-------|----------|
| API | RestAssured HTTP calls against the Javalin fixture |
| Database | JDBC queries on the same H2 instance the service uses |
| Cross-component | `audit_events` and stubbed `outbox_events` row counts |
| Concurrency | `ExecutorService` threads in `TransferReliabilityTest` |

### What Is Real vs Stubbed

| Component | Status |
|-----------|--------|
| HTTP API (Javalin) | Real (in-process fixture) |
| H2 database | Real (in-memory per test) |
| Audit log (`audit_events`) | Real |
| Outbox (`outbox_events`) | Stubbed — DB row only, no message broker |
| Message queue / notifications | Not implemented (out of scope) |
| Separate `idempotency_keys` table | Not used — idempotency stored on `transfers.idempotency_key` + `payload_hash` (same as Python reference) |

### Seed Data (per test)

| Wallet | Balance | Currency |
|--------|---------|----------|
| wallet_001 | 10000 | AED |
| wallet_002 | 5000 | AED |
| wallet_003 | 0 | AED |

Each test gets a fresh H2 database and seeded wallets via the `TestEnvironment` JUnit extension.

### Idempotency Strategy

- Same `Idempotency-Key` + same payload → `201` on first call, `200` on replay, same transfer ID
- Same key + different payload → `409 Conflict`
- No key → independent transfers

### Concurrency Strategy

- `ExecutorService` + `CountDownLatch` for parallel transfer requests
- Invariants: balance never negative, same idempotency key debits exactly once

### Known Limitations

- No distributed transactions or real message broker
- Concurrency tests are in-process (not multi-node)
- Testcontainers/PostgreSQL deferred — H2 chosen for speed and CI simplicity

## Prerequisites

- Java 17+
- Maven 3.8+

## Run Commands

```bash
cd submission/nikhil-funde

# Format code
mvn spotless:apply

# Lint
mvn spotless:check

# Run full test suite (~36 tests)
mvn test

# Run reliability/concurrency tests only
mvn test -Dtest="*Reliability*"

# Validate database schema (CI check)
mvn exec:java
```

## Test Architecture

```
src/test/java/com/kulu/sdet/
├── support/
│   ├── TestEnvironment.java      # JUnit 5 extension: start server, seed DB
│   ├── TransferApiClient.java    # RestAssured wrapper
│   ├── DatabaseVerifier.java     # JDBC invariant assertions
│   └── TransferRequestBuilder.java
├── HappyPathTest.java
├── ValidationTest.java
├── InsufficientBalanceTest.java
├── IdempotencyTest.java
└── TransferReliabilityTest.java
```

## Test Categories

| Category | Test Class | Tests |
|----------|-----------|-------|
| A) Happy path | `HappyPathTest` | 9 |
| B) Validation failures | `ValidationTest` | 10 |
| C) Insufficient balance | `InsufficientBalanceTest` | 7 |
| D) Idempotency | `IdempotencyTest` | 7 |
| E) Concurrency | `TransferReliabilityTest` | 3 |
