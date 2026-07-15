# Wallet Transfer Service — SDET Submission (hrishikesh)

A senior-SDET-grade test harness for a wallet transfer service. The suite exercises the service
end-to-end across API contract, request validation, workflow correctness, persistence, cross-
component integration (idempotency store, audit log, outbox, downstream notifier), and — most
importantly — **concurrency and race conditions** that a naive implementation silently corrupts.

Stack: **Java 17 · Spring Boot 3 · JUnit 5 · RestAssured · JdbcTemplate · Flyway · H2 (Postgres
compatibility mode)**.

---

## Running

```bash
cd submission/hrishikesh
mvn test                                # 38 tests, all layers
mvn test -Dtest="*Reliability*"         # 4 concurrency / reliability tests only
mvn spotless:check                      # google-java-format
mvn exec:java -Dexec.mainClass=ValidateSchema   # CI schema smoke test
```

No external services, no Docker, no manual setup. The Spring Boot app boots on a random port
per test class; Flyway migrates a fresh H2 schema; each test truncates state before executing.

---

## What is being tested

The system under test is a real service — not a mock — implemented in `src/main/java`. Tests
drive it over HTTP with RestAssured and inspect its persisted state directly with JdbcTemplate,
which lets a single test assert that:

1. the **API response** is correct,
2. the **database rows** match that response byte-for-byte,
3. **side-effect components** (audit log, outbox, downstream notifier) fired exactly the right
   number of times,
4. all of the above hold **under concurrent load**.

### Coverage matrix (38 tests)

| Layer | File | What it proves |
|---|---|---|
| API contract | `api/ContractTest` (4) | happy path 201, GET-by-id, GET wallet, 404 |
| API validation | `api/ValidationTest` (12) | missing/invalid fields, malformed JSON, same-wallet, currency whitelist, negative/zero amount |
| Workflow | `workflow/HappyPathTest` (1) | **single test asserts all 8 invariants** end-to-end |
| Workflow | `workflow/InsufficientBalanceTest` (2) | 422 + no mutation on rejected transfer |
| Workflow | `workflow/TransferLifecycleTest` (2) | transfer visible by id; deterministic timestamps |
| Idempotency | `idempotency/SameKeySamePayloadTest` (2) | replay returns identical body byte-for-byte |
| Idempotency | `idempotency/SameKeyDifferentPayloadTest` (3) | 409 on conflict; original response unaffected |
| Idempotency | `idempotency/NoDuplicateSideEffectsTest` (1) | replays produce zero additional rows anywhere |
| Persistence | `persistence/WalletStateTest` (2) | exact-delta debit/credit; balance conservation |
| Persistence | `persistence/AuditEventsTest` (2) | one `transfer_completed` event per transfer, correct payload |
| Persistence | `persistence/OutboxExactlyOnceTest` (3) | one outbox row per transfer, exactly-once delivery, unique index prevents duplicates |
| **Reliability** | `reliability/ConcurrentDuplicateIdempotencyReliabilityTest` (1) | 10 threads, same key → 1 transfer, 1 idempotency row, 1 audit row, 1 outbox row, 1 delivery |
| **Reliability** | `reliability/ConcurrentTransfersRaceReliabilityTest` (1) | 10 threads compete for balance of 5 → exactly 5 succeed, 5 rejected with 422, no overdraft |
| **Reliability** | `reliability/RetrySafetyReliabilityTest` (2) | retry after 500 injection is safe; outbox drain is safe to run repeatedly |

### Invariants asserted (explicit)

```
INV-1 balance conservation       source.debit == destination.credit for every completed transfer
INV-2 no overdraft               wallet.balance >= 0 at all times
INV-3 no mutation on rejection   422 responses cause zero row changes
INV-4 exactly-once transfer      one row in `transfers` per idempotency key, ever
INV-5 exactly-once audit         one `transfer_completed` event in `transfer_events` per transfer
INV-6 exactly-once outbox        one row in `outbox_events` per transfer (enforced by unique index)
INV-7 exactly-once delivery      NotifierStub called once per transfer per event type, ever
INV-8 API↔DB parity              JSON response body matches the persisted row field-for-field
```

Every reliability test asserts a superset of these under concurrency.

---

## Design decisions worth calling out

### Why H2 in Postgres mode instead of Testcontainers Postgres
The CI environment I built this against does not have Docker available. H2's PostgreSQL
compatibility mode supports the exact DDL, row-level `SELECT ... FOR UPDATE`, unique-index insert
blocking, and `CHECK` constraints this service depends on, so the concurrency guarantees the
tests are proving still hold. **In production I would swap this for Testcontainers Postgres by
changing only `application.yml` and the `pom.xml` driver dependency** — no test code changes.
The Flyway migration is standard SQL and portable.

### How the idempotency race is actually enforced
A naive implementation checks the idempotency store, does the transfer, then inserts the
idempotency row at the end. Two concurrent requests with the same key both pass the check, both
debit the wallet, and only the losing insert-race sees the conflict — after the money has already
moved twice. **This exact bug existed in an earlier iteration of this service and was caught by
`ConcurrentDuplicateIdempotencyReliabilityTest`.**

The fix (see `TransferService.execute()`, `service/TransferService.java:105`):
1. Read the idempotency row; if present, replay.
2. **Insert a placeholder idempotency row first**, inside the main transaction, before any
   balance mutation. Concurrent duplicates block on the unique-index insert until the winner
   commits or rolls back, at which point the losers observe the winner's persisted response and
   replay it verbatim.
3. Perform the transfer (lock wallets in deterministic order, debit, credit, insert transfer,
   append audit, enqueue outbox).
4. UPDATE the idempotency row with the final response body — all in the same transaction.

This is why the concurrent-duplicate test is deterministic: the loser never even *tries* to move
money, because the unique-index insert blocks it from reaching `performTransfer()`.

### How the balance race is enforced
Two competing transfers with *different* idempotency keys against the same source wallet:
`SELECT ... FOR UPDATE` on wallet rows in a deterministic (lexicographic) order serializes them,
and each transaction re-reads the freshly-locked balance before comparing it against the
requested amount. A wallet with balance 5000 receiving ten concurrent 1000-transfers yields
exactly five 201s and five 422s. Verified across five consecutive runs.

### Response replay is byte-for-byte
The controller returns replayed responses as raw byte arrays (`TransferController.java`), not by
re-serializing the stored view. This proves that the persisted response body is what the
original caller received — a client that hashes the response body across retries will get the
same hash.

### The outbox is exactly-once at write time, not delivery time
The `outbox_events` table has a `UNIQUE (aggregate_id, event_type)` index. Even if the transfer
transaction somehow retried, the outbox row insert is idempotent by construction. The
`OutboxRelay` then reads unpublished rows, invokes `NotifierStub`, and marks published. Running
`drain()` repeatedly must not double-deliver — that is one of the assertions in
`OutboxExactlyOnceTest` and `RetrySafetyReliabilityTest`.

### What is real vs. stubbed
| Component | Real or stub |
|---|---|
| HTTP layer (Spring MVC, Jackson, validators) | real |
| Business logic (`TransferService`) | real |
| Persistence (JdbcTemplate, Flyway) | real |
| DB (H2 Postgres compatibility mode) | real, in-process |
| Outbox relay | real |
| Downstream notifier (`NotifierStub`) | in-memory counter — no network |

The notifier is a stub only because the assignment scope is testing the service, not integrating
with a real message broker. Swapping it for a Kafka/SNS publisher would not change any test.

---

## Test architecture

```
support/
  ApiTestBase          Spring Boot @SpringBootTest RANDOM_PORT, per-test schema truncation,
                       seed helpers, direct access to NotifierStub + OutboxRelay + JdbcTemplate.
  WalletApiClient      Thin RestAssured wrapper (postTransfer, getTransfer, getWallet).
  DbAssertions         Query helpers: balanceOf, transferCountForIdempotencyKey, auditCount,
                       outboxCount, idempotencyRowCount.
  Invariants           Cross-check helpers for INV-1..INV-8.
  builders/IdemKey     Fresh UUIDs per test.
  builders/TransferRequestBuilder  Fluent request builder.
```

Concurrency tests use `ExecutorService` + `CountDownLatch` gate to fan out N threads that all
release simultaneously, driving the *live HTTP server* (not the in-JVM service) so we exercise
the entire request path including the transaction boundary.

---

## Limitations & what I would add with more time

1. **Testcontainers Postgres profile** — a `@Profile("pg")` config that swaps the datasource so
   the exact same tests run against Postgres 15 in CI. Trivial once Docker is available.
2. **Multi-JVM idempotency test** — the current in-JVM setup can't prove behavior when two
   service instances contend for the same key. The unique index still enforces correctness, but a
   real distributed test would spin up two Spring contexts on different ports pointing at a shared
   Postgres.
3. **Property-based tests** — jqwik driving randomized amounts / wallets / interleavings against
   INV-1..INV-8 as executable oracles.
4. **Chaos hooks** — a `FaultInjector` bean that randomly throws mid-transaction to prove
   rollback semantics under all failure points. `RetrySafetyReliabilityTest` covers this at one
   point manually.
5. **Latency SLOs** — record p50/p95 per endpoint and fail the build on regression.

---

## Responsible AI usage

This submission was co-authored with Claude (Sonnet 4.5 via OpenCode). I directed the design
decisions — H2-in-Postgres-mode over Testcontainers given the no-Docker constraint, the invariant
list, the insert-idempotency-first ordering, the response-byte-array replay pattern, the specific
concurrency scenarios worth exercising — and reviewed every file that landed in the diff. The
race condition documented above was surfaced by *my own concurrency tests failing*, which I then
fixed by rewriting `TransferService.execute()`. The `mvn test` output, five consecutive
reliability runs, and the `ValidateSchema` output are all real and reproducible on any machine
with Java 17 + Maven.

More detail in the PR description.
