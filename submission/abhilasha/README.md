# Wallet Transfer Service — Automated Test Suite

Java 17 integration test framework for a Wallet Transfer Service REST API.
Validates API contract, business workflow, database state, idempotency guarantees, and concurrency safety.

---

## Summary

This suite implements a full automated validation suite for the Wallet Transfer Service using Java 17, RestAssured, and Testcontainers (PostgreSQL).

---

## Test Strategy

### Levels Covered

| Layer | Coverage |
|---|---|
| API Contract | Response codes, payload shape, validation errors |
| Business Workflow | Transfer lifecycle, idempotency, retry safety |
| Database | Balance invariants, row correctness, audit trail |
| Cross-Component | Outbox events, transfer_events audit log |
| Concurrency | Parallel duplicate requests, competing transfers |

### What is Real vs Stubbed

| Component | Status |
|---|---|
| REST API (`/transfers`, `/wallets`) | Real — service under test via HTTP |
| PostgreSQL database | Real — spun up via Testcontainers (`postgres:15-alpine`) |
| Idempotency store (`idempotency_keys` table) | Real |
| Audit log (`transfer_events` table) | Real |
| Outbox (`outbox_events` table) | Real — row existence verified; broker dispatch not tested |
| Message broker (Kafka, SQS, etc.) | Stubbed — outbox pattern used instead |

---

## Approach: Option 1 — Testing an Existing Service

This suite tests a **real running service** over HTTP. No service is bundled.

The test suite is responsible for:
- spinning up a real PostgreSQL instance (via Testcontainers)
- seeding isolated test wallets directly into the database
- sending HTTP requests to the service under test
- asserting API responses AND database state after each operation

The **service under test** is responsible for:
- reading/writing to the same PostgreSQL instance
- enforcing business rules (balance checks, idempotency, currency validation)
- writing transfer records, events, and outbox rows

This separation means the suite validates the full path: HTTP request → service logic → persisted database state.

---

## API Validation Approach

- All requests go through a thin `WalletTransferApiClient` wrapper (transport details isolated from test logic)
- Assertions cover: status codes, response body fields, error codes, field-level error arrays
- Duplicate + conflict behavior explicitly tested (409 on same key + different payload; idempotency replay returns original `transfer_id`)

---

## Database Validation Approach

**Tables checked:**

| Table | What is asserted |
|---|---|
| `wallets` | Balance before/after debit and credit, conservation invariant |
| `transfers` | Row existence, all fields, status, idempotency_key linkage |
| `idempotency_keys` | Key stored exactly once, linked to correct transfer_id |
| `transfer_events` | At least one audit event per successful transfer |
| `outbox_events` | Exactly one outbox row per successful transfer, none on failure |

**Key invariants asserted:**

- `src.balance_after = src.balance_before − amount` (exactly once)
- `dst.balance_after = dst.balance_before + amount` (exactly once)
- `src.balance + dst.balance = constant` (conservation — no money created or destroyed)
- No transfer row on validation failure
- No balance mutation on rejected transfer
- No duplicate idempotency rows on replay

---

## Cross-Component Validation

- `outbox_events` checked after every successful transfer
- Verified: exactly 1 outbox row per transfer ID
- Verified: 0 outbox rows on failed/rejected transfers
- `transfer_events` audit trail verified for at least one event per completed transfer

---

## Concurrency & Reliability Coverage

| Scenario | Test |
|---|---|
| 10 parallel duplicate requests (same key) | Exactly 1 transfer created, balance moved once |
| 10 concurrent transfers exceeding balance | At most `floor(balance/amount)` succeed, balance ≥ 0 |
| N concurrent transfers (unique keys) | All succeed independently, final balance exact |
| Fan-in: multiple sources → one destination | No cross-wallet contamination, all credits applied |
| Concurrent balance conservation check | `source_delta + dest_delta = 0` holds under contention |

`CountDownLatch` synchronises all threads at the same moment before sending requests, maximising contention and making race conditions reproducible.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Java | 17+ | Temurin recommended |
| Maven | 3.8+ | |
| Docker | 24+ | Required for Testcontainers (PostgreSQL) |
| Service under test | any | Must expose `POST /transfers`, `GET /transfers/{id}`, `GET /wallets/{id}` |

---

## Service Contract Assumptions

The suite assumes the service under test exposes:

### `POST /transfers`

**Request headers:**
```
Content-Type: application/json
Idempotency-Key: <uuid>
```

**Request body:**
```json
{
  "source_wallet_id": "<uuid>",
  "destination_wallet_id": "<uuid>",
  "amount": 100.00,
  "currency": "USD",
  "reference": "optional-string"
}
```

**Success response (200):**
```json
{
  "transfer_id": "<uuid>",
  "status": "success",
  "source_wallet_id": "<uuid>",
  "destination_wallet_id": "<uuid>",
  "amount": 100.00,
  "currency": "USD",
  "reference": "optional-string",
  "idempotency_key": "<uuid>"
}
```

**Validation error response (422):**
```json
{
  "error_code": "VALIDATION_ERROR",
  "errors": [
    { "field": "amount", "message": "must be positive" }
  ]
}
```

**Idempotency conflict response (409):**
```json
{
  "error_code": "IDEMPOTENCY_CONFLICT",
  "message": "Request payload does not match original request for this idempotency key"
}
```

**Missing idempotency key (400):**
```json
{
  "error_code": "MISSING_IDEMPOTENCY_KEY"
}
```

### `GET /transfers/{transfer_id}`

Returns the same shape as the POST success response, or 404 if not found.

### `GET /wallets/{wallet_id}`

```json
{
  "wallet_id": "<uuid>",
  "balance": 900.00,
  "currency": "USD"
}
```

---

## Database Contract Assumptions

The service must connect to the same PostgreSQL instance the test suite provisions via Testcontainers.

**Connection string** passed to the service via `DATABASE_URL` environment variable:
```
postgresql://wallet_user:wallet_pass@localhost:<PORT>/wallet_test
```

The Testcontainers port is dynamic — the suite exposes it via `TESTCONTAINERS_DB_URL` system property printed to stdout at test start.

The service must read/write the schema defined in:
```
src/test/resources/db/schema.sql
```

---

## Running the Tests

### 1. Start your service

Point the service at the Testcontainers PostgreSQL instance.
The suite prints the JDBC URL to stdout during `@BeforeAll`. Alternatively, start the service after noting the port from a first run.

Override the service base URL:
```bash
export WALLET_SERVICE_URL=http://localhost:8080
```

### 2. Run the full suite

```bash
mvn test
```

### 3. Run by test group

```bash
# Happy path + validation (fast, ~30s)
mvn test -Dgroups="happy-path,validation"

# Idempotency contract tests
mvn test -Dgroups="idempotency"

# Concurrency / race condition tests
mvn test -Dgroups="concurrency"

# Reliability (idempotency + concurrency)
mvn test -Dgroups="idempotency,concurrency"
```

### 4. Run a single test class

```bash
mvn test -Dtest=HappyPathTransferTest
mvn test -Dtest=IdempotencyTest
mvn test -Dtest=ReliabilityTest
mvn test -Dtest=ValidationFailureTest
```

### 5. Schema validation only (no service needed)

```bash
mvn exec:java -Dexec.mainClass="com.wallet.ValidateSchema"
```

Or via Python (requires Docker + Python 3.10+):
```bash
pip install psycopg2-binary
python scripts/validate_schema.py
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WALLET_SERVICE_URL` | `http://localhost:8080` | Base URL of the service under test |
| `DATABASE_URL` | `jdbc:postgresql://localhost:5432/wallet_schema_check?user=...` | For `ValidateSchema` only |
| `DB_HOST` | `localhost` | For `validate_schema.py` only |
| `DB_PORT` | `5432` | For `validate_schema.py` only |
| `DB_NAME` | `wallet_schema_check` | For `validate_schema.py` only |
| `DB_USER` | `wallet_user` | For `validate_schema.py` only |
| `DB_PASSWORD` | `wallet_pass` | For `validate_schema.py` only |

---

## Test Architecture

```
src/test/java/com/wallet/
├── base/
│   └── WalletTransferTestBase.java       Testcontainers lifecycle, DB client wiring,
│                                          @BeforeEach isolation, @AfterEach cleanup
├── client/
│   ├── WalletTransferApiClient.java       RestAssured HTTP wrapper — no assertions here
│   └── DatabaseVerificationClient.java   Direct JDBC queries for post-execution verification
├── model/
│   ├── TransferRequest.java              Request payload builder target
│   ├── TransferResponse.java             Deserialized API response
│   ├── WalletBalance.java                DB wallet snapshot for delta assertions
│   └── TransferRecord.java               DB transfer row for assertion
├── assertions/
│   ├── TransferAssertions.java           Fluent HTTP + DB DSL (extends AbstractAssert)
│   ├── WalletAssertions.java             Balance delta + conservation law assertions
│   └── IdempotencyAssertions.java        Key uniqueness + conflict detection
├── fixture/
│   ├── WalletFixture.java                Named wallet archetypes (funded, empty, high-balance)
│   └── TransferRequestBuilder.java       Named constructors per scenario (missingAmount, etc.)
└── tests/
    ├── HappyPathTransferTest.java        11 tests — TC-HP-01..11
    ├── ValidationFailureTest.java        21 tests — TC-VF-01..21
    ├── IdempotencyTest.java              12 tests — TC-ID-01..12
    └── ReliabilityTest.java               6 tests — TC-CC-01..06
```

**Total: 50 tests across 4 classes.**

---

## Test Isolation Strategy

Every test:
1. Creates its own wallet(s) via direct DB insert with a unique `owner_id` (UUID-based)
2. Tracks created wallet IDs in `testWalletIds`
3. Cleans up all related rows in FK-safe order after the test via `@AfterEach`

Cleanup order:
```
balance_snapshots → transfer_events → outbox_events → idempotency_keys → transfers → wallets
```

No test shares wallet state. Tests can run in any order.

---

## CI/CD

CI is handled by the repository's own `.github/workflows/sdet-pr-checks-java.yml`. On every PR, it auto-detects the `submission/abhilasha/` folder and runs five checks:

| Check name | What it does |
|---|---|
| `lint` | Spotless format check + compile |
| `unit-and-integration-tests` | `mvn test` against full suite |
| `db-migration-or-schema-check` | Runs `ValidateSchema` via `mvn exec:java` |
| `reliability-tests` | `mvn test -Dtest="*Reliability*"` (picks up `ReliabilityTest`) |
| `security-and-secrets-scan` | gitleaks secrets scan |

No additional workflow files are needed in the submission.

---

## Known Limitations & Tradeoffs

- **No bundled service** — tests require a running service. This is Option 1 per the assignment.
- **Thread management** — raw `Thread` + `CountDownLatch` works; `ExecutorService` + `Future` would give cleaner per-thread exception propagation.
- **Async outbox not polled** — outbox assertions assume synchronous write within the transfer transaction. If the service dispatches asynchronously, add `Awaitility`-backed polling (dependency already in `pom.xml`).
- **Wallet creation via DB only** — `WalletFixture` inserts directly; if a wallet creation endpoint exists, the fixture should use it for higher-fidelity E2E coverage.
- **Schema sync** — `schema.sql` in test resources must be kept in sync with the service schema manually; Flyway integration would eliminate drift risk.
- **No auth/TLS** — not in scope for this assignment.
- **Status transitions** — only success path fully exercised; `PENDING → FAILED` async path not tested (no async worker).
- **`balance_snapshots` schema only** — table defined in schema, not asserted at runtime (service may or may not populate it).

---

## AI Usage

Claude (Anthropic) was used to scaffold boilerplate (project structure, builder patterns, JDBC repository methods). All test scenario design, invariant selection, concurrency strategy, and DB validation logic was reviewed, validated, and adjusted manually. The idempotency conflict handling, balance conservation math, FK-ordered cleanup sequence, and `CountDownLatch` synchronisation approach were specifically reasoned through, not just generated.
