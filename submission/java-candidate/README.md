# Wallet Transfer Service — Automated Test Suite

A production-quality, black-box automated test suite for a **Wallet Transfer Service**.  
The service under test is treated as an **existing external system** — no application code lives here.

---

## Project Structure

```
src/test/java/com/wallet/
├── config/
│   ├── TestConfig.java              # Central config (base URL, DB coords, timeouts)
│   └── TestContainersConfig.java    # Singleton PostgreSQL Testcontainer
│
├── model/
│   ├── TransferRequest.java         # API request DTO (test-side only)
│   ├── TransferResponse.java        # API response DTO
│   └── WalletResponse.java          # Wallet read DTO
│
├── client/
│   ├── TransferClient.java          # RestAssured wrapper for /transfers
│   └── WalletClient.java            # RestAssured wrapper for /wallets
│
├── db/
│   ├── DbClient.java                # Low-level JDBC helper
│   ├── WalletRepository.java        # Wallet table queries
│   ├── TransferRepository.java      # Transfers + events + outbox queries
│   └── IdempotencyRepository.java   # Idempotency key table queries
│
├── builders/
│   ├── TransferRequestBuilder.java  # Fluent transfer request builder
│   └── WalletBuilder.java           # Fluent wallet fixture creator
│
├── assertions/
│   ├── ApiAssertions.java           # HTTP status + response body assertions
│   ├── DatabaseAssertions.java      # DB-level invariant assertions
│   └── BusinessAssertions.java      # Economic/business invariants (conservation etc.)
│
├── fixtures/
│   ├── TestDataSeeder.java          # Seeds canonical wallets before each test
│   └── TestCleanup.java             # Tracks and rolls back test-created rows
│
├── utils/
│   ├── ParallelExecutor.java        # CyclicBarrier-based concurrent request runner
│   ├── RetryHelper.java             # Polling-based retry for async assertions
│   └── RequestHasher.java          # SHA-256 request hashing (idempotency validation)
│
└── tests/
    ├── BaseIntegrationTest.java      # Shared setup/teardown superclass
    ├── api/
    │   └── TransferApiTests.java    # 14 API contract & validation tests
    ├── e2e/
    │   └── TransferE2ETests.java    # 7 end-to-end full-flow tests (API + DB)
    ├── idempotency/
    │   └── IdempotencyTests.java    # 10 idempotency & exactly-once tests
    └── concurrency/
        └── TransferConcurrencyTests.java  # 6 race condition & safety tests
```

---

## How to Run

### Prerequisites

| Tool          | Version   |
|---------------|-----------|
| Java          | 17+       |
| Maven         | 3.9+      |
| Docker        | Running   |

Docker is required for Testcontainers (PostgreSQL container).

---

### Option A — Against Service + Testcontainers DB (default)

This mode starts a real PostgreSQL container for DB assertions and fires tests at a
running service on `localhost:8080`.

```bash
# Start the service under test (replace with actual start command)
./start-service.sh

# Run all tests
cd submission/java-candidate
mvn test
```

---

### Option B — Custom Service URL + External DB

Pass the service base URL and database coordinates via system properties:

```bash
mvn test \
  -Dservice.base.url=http://staging.internal:8080 \
  -Ddb.url=jdbc:postgresql://db-host:5432/wallet \
  -Ddb.user=wallet \
  -Ddb.password=secret
```

---

### Option C — Run a specific test category

```bash
# API tests only
mvn test -Dtest=TransferApiTests

# Idempotency tests only
mvn test -Dtest=IdempotencyTests

# Concurrency tests only
mvn test -Dtest=TransferConcurrencyTests

# E2E tests only
mvn test -Dtest=TransferE2ETests
```

---

## Test Strategy

### What is Real vs Stubbed

| Component              | Real or Stubbed                                             |
|------------------------|-------------------------------------------------------------|
| Wallet Transfer Service | **Real** — tests target existing running service           |
| PostgreSQL Database    | **Real** — Testcontainers PostgreSQL container             |
| Outbox / event tables  | **Real** — asserted directly via JDBC                      |
| Downstream consumers   | **Out of scope** — WireMock available if needed            |

---

### Test Levels Covered

| Level                     | Test Class                  | Coverage                                              |
|---------------------------|-----------------------------|-------------------------------------------------------|
| API Contract              | `TransferApiTests`          | Status codes, response shape, validation errors       |
| End-to-End Flow           | `TransferE2ETests`          | API → DB → events → outbox full path                 |
| Idempotency               | `IdempotencyTests`          | Replay safety, conflict detection, no double-debit    |
| Concurrency / Race Safety | `TransferConcurrencyTests`  | Competing requests, overdraft prevention, RAW-consistency |

---

### Invariants Validated

- Source wallet debited **exactly once** on success
- Destination wallet credited **exactly once** on success
- **Balance conservation**: `(source_before + dest_before) == (source_after + dest_after)`
- No balance mutation on rejected or invalid transfers
- No duplicate transfer rows for the same idempotency key
- Idempotency keys written to `idempotency_keys` table
- Exactly **one** outbox event per successful transfer
- Source wallet never goes negative (no overdraft)

---

### Concurrency Strategy

- `ParallelExecutor` fires N requests simultaneously using `ExecutorService` + `CyclicBarrier`
- All threads release at the same moment to maximise contention
- Assertions verify outcomes, not timing — tests are deterministic
- Service must use `SELECT … FOR UPDATE` row-level locking to pass these tests

---

### Idempotency Strategy

- Every test that creates a transfer passes a UUID v4 `Idempotency-Key` header
- Replays use the **same key + same payload** — expect original transfer id returned
- Conflict probes send **same key + different payload** — expect `409 Conflict`
- Use `RequestHasher.hash()` to verify stored SHA-256 hash in `idempotency_keys` table

---

### Data Isolation

- `TestDataSeeder.seedWallets()` upserts four canonical wallets before **each test**
- `TestDataSeeder.resetBalances()` restores canonical balances before each test
- `WalletBuilder` creates fresh test-scoped wallets for concurrency tests
- `TestCleanup` tracks and deletes any rows created during a test (rollback on `@AfterEach`)
- Transfers without idempotency keys are cleaned up by transfer id

---

## Database Tables Validated

| Table               | What is asserted                                                  |
|---------------------|-------------------------------------------------------------------|
| `wallets`           | Balance after debit/credit, no mutation on failure                |
| `transfers`         | Row exists with correct status, amount, wallet ids                |
| `idempotency_keys`  | Key stored, correct hash, status = COMPLETED after success        |
| `transfer_events`   | TRANSFER_INITIATED and TRANSFER_COMPLETED events present          |
| `outbox_events`     | Exactly one TRANSFER_COMPLETED outbox event per successful transfer|

---

## Known Assumptions & Limitations

1. **Service contract** — tests assume the JSON field names and status values documented in the assignment. If the service uses snake_case or different status strings, `TransferResponse` and `ApiAssertions` must be updated.

2. **DB access** — tests require direct JDBC access to the same DB the service writes to. In a cloud environment, this requires a jump host or VPN.

3. **Outbox async** — if outbox publishing is asynchronous (background thread), use `RetryHelper.waitUntil(...)` rather than immediate assertions. The current tests assume synchronous outbox writes inside the same transaction.

4. **Testcontainers schema** — `TestContainersConfig` applies `src/test/resources/db/schema.sql` to the container. This **must** match the actual service schema. If the service uses Flyway/Liquibase, reuse those migration scripts instead.

5. **WireMock** — dependency is included if downstream notification/webhook stubs are needed. Not used in the current suite.

6. **Concurrency test flakiness** — `CONC-04` uses random index selection which can occasionally hit the same wallet twice. For strict isolation replace with indexed thread allocation. Documented as a known tradeoff.

