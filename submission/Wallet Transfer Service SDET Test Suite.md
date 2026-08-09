# Wallet Transfer Service — Automated Validation Suite

## Summary

Built a focused integration test suite for the Wallet Transfer Service using **Java 17, JUnit 5, RestAssured, Selenium 4, and Maven**. No existing service implementation was provided, so a minimal Spring Boot stub backed by an H2 in-process database is included to make the suite immediately runnable. The stub uses the same schema as a production-grade transactional design: five tables covering wallets, transfers, idempotency keys, audit events, and outbox events.

The goal was not coverage volume but transactional correctness: proving that balance mutations happen exactly once, that retried requests are safe, and that every completed transfer leaves a coherent trail across all five tables. Tests are organised by concern — API contract, database state, concurrency, cross-component — and share reusable builder and assertion helpers so each test method reads like a plain description of business behaviour.

The suite follows a **Red → Blue → Green** workflow. Each meaningful invariant was written as a failing test first, then the minimum stub code or fixture was added to make it pass, then the test was refactored into a readable assertion method. This is visible in the git history as distinct commits.

---

## Test Strategy

* **Levels covered:**

  * **API** — HTTP status codes, response payload shape, header validation, error message structure
  * **Workflow** — transfer lifecycle (`PENDING → COMPLETED / REJECTED`), balance conservation invariant, idempotency replay semantics
  * **Database** — direct JDBC assertions against all five tables after every test scenario
  * **Cross-component** — outbox row written atomically with the transfer, audit event sequence verified, WireMock-captured webhook call count verified

* **In scope:**

  * `POST /transfers` — full lifecycle including validation errors, insufficient balance, idempotency, and concurrent submissions
  * `GET /transfers/{transfer_id}` and `GET /wallets/{wallet_id}` — contract correctness and read-after-write consistency
  * Balance debit/credit atomicity and the absence of partial writes
  * Outbox and audit table correctness as first-class assertions, not afterthoughts
  * Concurrency: two threads racing on limited balance, two threads submitting the same idempotency key simultaneously

* **Out of scope:**

  * Message broker relay — outbox row count is the proxy; the Kafka/Rabbit consumer is not started
  * Downstream notification delivery — WireMock verifies call count only, no Pact contract validation
  * Auth/authorisation flows
  * Performance or load testing

* **What is real vs stubbed/mocked:**

  | Component                      | Status            | Note                                              |
  | ------------------------------ | ----------------- | ------------------------------------------------- |
  | Wallet Transfer Service (HTTP) | Real              | Embedded Spring Boot stub, full HTTP              |
  | H2 in-process database         | Real              | Same schema as production; seeded per test        |
  | `idempotency_keys` table       | Real              | Unique constraint enforced; replay verified       |
  | `audit_events` table           | Real              | Row sequence asserted after every transfer        |
  | `outbox_events` table          | Real (write side) | Row count and payload verified; relay not running |
  | Message broker (Kafka/Rabbit)  | Stubbed           | Not started; outbox row is the intent proxy       |
  | Downstream webhook             | Stubbed           | WireMock captures calls; verify count = 1         |
  | Admin UI (Selenium)            | Real if present   | Headless Chrome, conditional on env flag          |

---

## API Validation Approach

* **How requests/responses are validated:**
  All HTTP interactions go through a `TransferApiClient` class that wraps RestAssured. Test methods never call RestAssured directly — they call named methods like `client.postTransfer(request, idempotencyKey)`. This keeps transport mechanics out of test logic. Responses are checked on three things: exact HTTP status code, mandatory field presence via JSON path, and field value semantics (amount echoed back correctly, wallet IDs match, status value is an expected enum). A `TransferResponseAssert` helper class chains these checks as domain-readable methods — `.isCompleted()`, `.hasAmountMinor(2500)`, `.hasSourceWallet("wallet_001")` — so the test body reads like a specification.

* **Which failure scenarios are covered:**

  | Scenario                               | Expected Status | DB Assertion                                            |
  | -------------------------------------- | --------------- | ------------------------------------------------------- |
  | Missing `source_wallet_id`             | 422             | No transfer row written                                 |
  | Missing `amount`                       | 422             | No balance change                                       |
  | Amount = 0 or negative                 | 422             | No transfer row written                                 |
  | Unsupported currency (e.g. `XYZ`)      | 422             | No row written                                          |
  | Source wallet == destination wallet    | 422             | No row written                                          |
  | Non-existent source wallet             | 404             | No row written                                          |
  | Non-existent destination wallet        | 404             | No row written                                          |
  | Malformed `Idempotency-Key` (non-UUID) | 422             | Request rejected before processing                      |
  | Insufficient balance                   | 422             | Transfer row with `status=REJECTED`; balances unchanged |

  For every failure case there is a secondary JDBC assertion confirming that the `transfers` and `outbox_events` tables were not written with unintended rows. Proving the API returned the right error code is not enough — the test also proves the service produced no invalid side-effects.

* **How duplicate behavior is verified:**
  A two-call pattern is used. Call 1: `POST /transfers` with `Idempotency-Key: <UUID>` — assert 201, record `transfer_id`. Call 2: identical body, same key — assert the response status and body are identical to Call 1. Then: `COUNT(*) FROM transfers WHERE idempotency_key = '<key>'` must be exactly 1. Source wallet balance after Call 2 must equal balance after Call 1 — no second debit. The conflicting-payload case sends the same key with a different `amount`, expects 409, and then confirms no new transfer row was created.

---

## Database Validation Approach

* **Which tables are checked:**

  * `wallets` — `balance_minor` before and after, `updated_at` advances only on mutation
  * `transfers` — row exists, `status`, `amount_minor`, `currency`, `source_wallet_id`, `destination_wallet_id`, `completed_at` populated on `COMPLETED`, `failure_reason` populated on `REJECTED`
  * `idempotency_keys` — row keyed by header value, `request_hash` (SHA-256 of canonical body), stored `response_body` matches original response
  * `audit_events` — four ordered rows per completed transfer: `TRANSFER_CREATED`, `BALANCE_DEBITED`, `BALANCE_CREDITED`, `TRANSFER_COMPLETED`; timestamps monotonically increasing
  * `outbox_events` — exactly one row per transfer, correct `event_type`, `published = 0`, no duplicate rows after replay

* **Which invariants are asserted:**

  * **Balance conservation** — `(source_before - source_after) == (destination_after - destination_before) == transfer_amount`. Checked with a SQL snapshot taken before and after each test.
  * **Exactly one debit and one credit** — source `balance_minor` decrements by exactly `amount`; destination increments by exactly `amount`. Both verified independently.
  * **No phantom records on rejection** — after any failure, `COUNT(*) FROM transfers WHERE status = 'COMPLETED'` does not increase. Wallet balances are byte-for-byte equal to their pre-test snapshot.
  * **Idempotency uniqueness** — `COUNT(*) FROM transfers WHERE idempotency_key = '<key>'` always returns 1 regardless of retry count.
  * **Outbox exactly-once** — `COUNT(*) FROM outbox_events WHERE transfer_id = '<id>'` returns 1 after any number of replays.
  * **Audit completeness** — no `BALANCE_DEBITED` without a corresponding `BALANCE_CREDITED` in the same transfer. The specific intent is catching partial-commit bugs.

* **How test data is seeded and cleaned:**
  A `@DatabaseTest` JUnit 5 extension runs `beforeEach` and `afterEach` callbacks. Setup creates wallet rows via direct JDBC INSERT — not through the API, so test setup does not depend on the endpoint under test. Teardown truncates all five tables in dependency order. A `WalletFixture` builder keeps seeding to one readable line: `WalletFixture.create("wallet_001").balance(10000).currency("AED").seed(db)`. `IdempotencyKeyFactory.fresh()` generates a UUID v4 per test and registers it for cleanup.

---

## Cross-Component Validation

The outbox pattern is treated as a first-class concern. The assertion is not “did an event get published” (the broker is not running) but “was the outbox row written in the same transaction as the balance mutation.” If the service writes the transfer and commits but the outbox row is missing, the test fails. This catches a common bug class where the outbox write sits outside the transaction boundary.

After a completed transfer the suite asserts:

* `outbox_events` contains exactly one row with `event_type = 'TRANSFER_COMPLETED'` and a payload containing `source_wallet_id`, `destination_wallet_id`, `amount`, `currency`
* `published` column is `0` — relay has not run, which is expected in the test environment
* After an idempotency replay the row count stays at 1 — no second outbox row is produced

Audit event sequence is verified with `SELECT ... ORDER BY created_at ASC`. For a happy-path transfer the expected order is `TRANSFER_CREATED → BALANCE_DEBITED → BALANCE_CREDITED → TRANSFER_COMPLETED`. For an insufficient-balance rejection it is `TRANSFER_CREATED → TRANSFER_REJECTED`. Any deviation fails the test.

For the webhook, a WireMock server is started per test class and its base URL is injected into the service via environment variable. After a successful transfer, `WireMock.verify(1, postRequestedFor(urlEqualTo("/notify")))` confirms exactly one outbound call. After an idempotency replay the verify count stays at 1.

---

## Reliability / Concurrency Coverage

* **Duplicate request scenarios:**
  Same key + same payload sequential replay — second call returns identical 201, no new DB row, no second debit. Same key + different payload — 409 Conflict, no new row. Simulated response-loss retry — first response is deliberately discarded in the test (not stored), second call sent with same key — asserts single debit even when the client never received the original success.

* **Retry safety scenarios:**
  A fault-injected first attempt via WireMock `fault(CONNECTION_RESET_BY_PEER)` causes the client to retry. Second attempt succeeds. DB assertions confirm a single transfer row and a single balance debit despite the failed first attempt — representing a client that retried after a TCP drop.

* **Concurrency/race scenarios:**
  Two threads submit `POST /transfers` from `wallet_001` (balance: 2500 AED) each requesting 2500 AED, started simultaneously via `ExecutorService` with a `CountDownLatch` to align submission. Only one can succeed. Post-race assertions:

  * `wallet_001.balance_minor >= 0` — balance never goes negative
  * `SUM(amount_minor) FROM transfers WHERE source_wallet_id = 'wallet_001' AND status = 'COMPLETED'` = 2500, not 5000
  * `COUNT(*) FROM outbox_events WHERE event_type = 'TRANSFER_COMPLETED'` = 1

  A second concurrent scenario sends the same idempotency key from two threads simultaneously. Only one `idempotency_keys` row must exist after both threads complete — enforced by the DB unique constraint.

* **What confidence these tests provide:**
  These are regression guards, not formal proofs. They will catch: removing the balance check before debit, dropping the unique constraint on `idempotency_keys`, moving the outbox write outside the transaction, or breaking lock acquisition order. H2 serialises concurrent writes differently from PostgreSQL row-level locking — the `-Ppostgres` Testcontainer profile is the stronger signal and is listed as a next step.

---

## Test Architecture

```text
src/test/java/com/walletservice/
├── client/
│   └── TransferApiClient.java          # All RestAssured calls; base URI + headers here, nowhere else
├── fixtures/
│   ├── WalletFixture.java              # JDBC-seeded wallets, fluent builder
│   ├── TransferRequestBuilder.java     # Valid-by-default builder, single-field overrides per test
│   └── IdempotencyKeyFactory.java      # Fresh UUID v4 per test, registered for cleanup
├── db/
│   └── WalletRepository.java           # JDBC helpers: getBalance(), getAuditEvents(), getOutboxEvents()
├── assertions/
│   ├── TransferResponseAssert.java     # .isCompleted(), .hasAmountMinor(), .hasSourceWallet()
│   ├── WalletDbAssert.java             # .wasDebitedExactlyOnce(), .remainsUnchanged()
│   └── AuditAssert.java                # Sequence order and outbox count assertions
├── extensions/
│   ├── DatabaseTest.java               # @ExtendWith meta-annotation; seed + teardown lifecycle
│   └── WireMockExtension.java          # WireMock start/stop per test class
└── tests/
    ├── api/                            # ApiContractTest, ValidationFailuresTest, DuplicateReplayTest
    ├── workflow/                       # HappyPathTransferTest, InsufficientBalanceTest, StateTransitionTest
    ├── db/                             # BalanceInvariantTest, AuditTrailTest, OutboxEventTest
    ├── concurrency/                    # CompetingTransfersTest, ConcurrentDuplicateTest
    └── ui/                             # AdminDashboardTest — Selenium 4, headless, conditional
```

Test classes never import RestAssured or write raw SQL. All HTTP calls go through `TransferApiClient` — if the base URL changes, one file changes. All DB queries go through `WalletRepository` — if a column is renamed, one file changes. `TransferRequestBuilder` defaults to a fully valid transfer, so a test that only needs a missing-field failure writes `.amount(null).build()` and nothing else. `@DatabaseTest` owns all setup and teardown — adding a new test class requires only that annotation. Assertion methods are named after the business rule they prove, not the implementation detail they check.

JUnit 5 `@Tag` groups allow selective test runs without editing any test code.

---

## Validation

```bash
# Full suite from clean checkout
mvn clean verify

# API contract tests only — fast feedback (~10s)
mvn test -Dgroups=api

# Database invariant tests only
mvn test -Dgroups=db

# Concurrency tests only
mvn test -Dgroups=concurrency

# Cross-component (outbox + audit) tests
mvn test -Dgroups=component

# Full suite against PostgreSQL Testcontainer (requires Docker)
mvn test -Ppostgres

# Selenium admin UI tests (requires Chrome + ChromeDriver on PATH)
mvn test -Dgroups=ui -DADMIN_UI_ENABLED=true
```

Expected output: `Tests run: 47, Failures: 0, Errors: 0, Skipped: 0 — BUILD SUCCESS`

| Tag                | Count  |
| ------------------ | ------ |
| `api`              | 14     |
| `workflow`         | 8      |
| `db`               | 10     |
| `concurrency`      | 6      |
| `component`        | 6      |
| `ui` (conditional) | 3      |
| **Total**          | **47** |

---

## Known Limitations / Next Steps

* **H2 vs PostgreSQL concurrency** — H2 serialises writes so real row-level locking races are not fully exercised in the default profile. The `-Ppostgres` Maven profile exists but is not the CI default. This is the most meaningful gap.
* **Broker relay untested** — the outbox row proves write intent; it does not prove the relay picks up the row, deduplicates it, or delivers it to the broker exactly once. A Testcontainers Kafka instance with a relay thread would close this gap.
* **Webhook payload contract** — WireMock checks call count and top-level field presence only. A Pact consumer contract test would catch breaking payload changes before downstream consumers are affected.
* **Concurrency test determinism** — `CountDownLatch` maximises race opportunity but cannot guarantee simultaneous kernel scheduling. Results are consistent across many runs but not formally deterministic.
* **Fault injection depth** — partial failures are simulated at the HTTP layer via WireMock faults, not at the DB transaction level. Crashing the DB mid-transaction would require a more invasive harness.
* **With more time** — add PITest mutation testing to measure which service conditionals the suite actually kills; parameterise currency and amount combinations with `@MethodSource` to broaden input coverage without duplication; promote PostgreSQL Testcontainer to the default CI profile.

---

## Responsible AI Usage

* **Did you use AI tools?** Yes — AI was used during the documentation phase of this submission.
* **Where did they help?** Drafting section prose and reviewing the document structure against the project requirements.
* **What did you personally verify or correct?** Every technical decision — which invariants to assert, lock ordering rationale, the five-table schema, outbox atomicity argument, concurrency test structure using `CountDownLatch` and `ExecutorService` — was reasoned independently. An early suggestion to handle idempotency at the HTTP client cache layer was rejected in favour of the DB unique-constraint approach because the former does not survive process restarts. The failure scenario table, concurrency section design, and the Real vs Stubbed breakdown were written without AI input. AI helped with wording; it did not contribute to test engineering decisions.

---


