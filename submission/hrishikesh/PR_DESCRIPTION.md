# SDET submission — hrishikesh

A senior-SDET-grade automated test suite for the Wallet Transfer Service. Java 17 + Spring Boot
3 + JUnit 5 + RestAssured + JdbcTemplate + Flyway + H2 (PostgreSQL compatibility mode).

**Location:** `submission/hrishikesh/`
**How to run:** `cd submission/hrishikesh && mvn test` (38 tests, ~4s cold, ~1s warm)

## 1. Test strategy

The system under test is a real Spring Boot service that lives alongside the tests — not a mock.
Tests drive it over HTTP on a random port with RestAssured, then inspect its persisted state
directly with JdbcTemplate. That gives me one test harness that can, in a single assertion block,
verify: (a) the API response, (b) the database row that response was derived from, (c) every
side-effect table (audit, outbox), and (d) whether the downstream notifier was called the right
number of times.

Tests are grouped by intent, not by layer:

- **api/** — contract shape and validation (16 tests)
- **workflow/** — happy path and business errors end-to-end (5 tests)
- **idempotency/** — same-key/same-payload, same-key/different-payload, no-duplicate-side-effects (6 tests)
- **persistence/** — wallet state, audit exact-count, outbox exactly-once (7 tests)
- **reliability/** — concurrency, race conditions, retry safety (4 tests, matching CI's `*Reliability*` pattern)

Every test executes against a freshly-truncated schema so ordering cannot mask bugs.

## 2. API validation

`api/ContractTest` covers the happy 201, GET-by-id, GET wallet, and 404 cases with response-shape
assertions (id, source/destination, amount, currency, status, created_at, idempotency_key).

`api/ValidationTest` covers 12 rejection cases: missing fields, invalid currency (whitelist
enforced), zero/negative amount, same source and destination, unknown wallet, missing idempotency
header, malformed JSON body, and 405 on wrong method. Every rejection asserts both status code
and an error `code` field (machine-readable, not just a message).

Response replay for retried idempotency keys is asserted **byte-for-byte**, not by
re-serialization — the controller returns the stored response body as raw bytes so a client that
hashes the response across retries gets the same hash.

## 3. Database validation

`persistence/WalletStateTest` asserts exact-delta debit/credit and balance conservation:
`source.before - source.after == destination.after - destination.before == amount` for every
completed transfer, and no mutation on any 422.

`persistence/AuditEventsTest` asserts exactly one `transfer_completed` row in `transfer_events`
per transfer, with the correct payload JSON.

`persistence/OutboxExactlyOnceTest` asserts the outbox row exists with the right payload,
proves the `UNIQUE (aggregate_id, event_type)` index enforces exactly-once at write time, and
that `OutboxRelay.drain()` is safe to run repeatedly without double-delivery.

The schema itself (`db/migration/V1__init.sql`) uses `CHECK (balance >= 0)`, `CHECK (amount > 0)`,
foreign keys, and a unique index on outbox events — so even a bug in the service code cannot
persist a corrupt row.

## 4. Cross-component validation

`workflow/HappyPathTest` is one test that verifies all eight invariants at once from a single
transfer:

1. 201 response body matches DB row byte-for-byte
2. source balance decremented by exactly `amount`
3. destination balance incremented by exactly `amount`
4. one row in `transfers`
5. one row in `idempotency_keys` for the key
6. one `transfer_completed` row in `transfer_events`
7. one row in `outbox_events` for the transfer
8. after `OutboxRelay.drain()`, `NotifierStub` was called exactly once for that transfer/event

`idempotency/NoDuplicateSideEffectsTest` fires the same request three times against the same
key and asserts every one of those counts is still exactly 1 — the replays produce zero
additional rows anywhere in the system.

## 5. Concurrency / reliability coverage

Four tests under `reliability/*Reliability*` — matched by the CI script's
`mvn test -Dtest="*Reliability*"` invocation.

- **`ConcurrentDuplicateIdempotencyReliabilityTest`** — 10 threads gated on a `CountDownLatch`
  fire the same idempotency-keyed request simultaneously. Asserts: exactly one distinct transfer
  id across all 10 responses, exactly one row in each of `transfers`, `idempotency_keys`,
  `transfer_events`, `outbox_events`, and exactly one downstream delivery.

- **`ConcurrentTransfersRaceReliabilityTest`** — 10 threads with *different* idempotency keys
  compete for a source wallet with balance 5000, each requesting 1000. Asserts: exactly 5
  succeed with 201, exactly 5 fail with 422 `insufficient_balance`, wallet balances match the
  successful count exactly, and the wallet balance is never negative.

- **`RetrySafetyReliabilityTest`** (2 tests) — a request that is retried after simulated
  transport failure produces the same response and no duplicate side effects; `OutboxRelay.drain()`
  called repeatedly does not double-deliver.

### The race condition my own tests caught

An earlier iteration of `TransferService.execute()` did:
`find(idem_key) → validate → lock wallets → debit/credit → insertIfAbsent(idem_key)`.

That is the textbook idempotency race: two concurrent requests with the same key both pass the
`find`, both debit the wallet, and only the losing `insertIfAbsent` sees the conflict — after the
money has already moved twice. `ConcurrentDuplicateIdempotencyReliabilityTest` failed with 2
distinct transfer ids and duplicate outbox rows.

The fix (see `TransferService.execute()` in `service/TransferService.java`): insert a placeholder
idempotency row *first*, before any balance mutation, inside the main transaction. Concurrent
duplicates block on the unique-index insert until the winner commits or rolls back, then observe
the winner's persisted response and replay it verbatim. The loser never even enters the
balance-mutation path.

I ran the reliability suite 5 times in a row to confirm it is not flaky.

## 6. Test architecture

```
support/
  ApiTestBase         @SpringBootTest RANDOM_PORT, per-test truncation, seed helpers
  WalletApiClient     RestAssured wrapper (postTransfer, getTransfer, getWallet)
  DbAssertions        balanceOf, transferCountForIdempotencyKey, auditCount, outboxCount, ...
  Invariants          reusable INV-1..INV-8 checks
  builders/           fluent request + fresh idempotency key
```

- H2 in PostgreSQL compatibility mode was chosen because Docker was unavailable in my dev/CI
  environment. **Testcontainers Postgres is documented as the production path** — swap is a
  config change to `application.yml` + `pom.xml`, no test code touched. The Flyway migration and
  service code use only portable SQL (`SELECT ... FOR UPDATE`, unique indexes, `CHECK`
  constraints, `GENERATED BY DEFAULT AS IDENTITY`).
- Every reliability test drives the live HTTP server on a random port, not the in-JVM service,
  so the transaction boundary is exercised end-to-end.
- Concurrency uses `ExecutorService` + `CountDownLatch` gate so all N threads release in the
  same instant.
- Schema check is invoked exactly the way CI does (`mvn exec:java -Dexec.mainClass=ValidateSchema`
  — see the shim at `src/main/java/ValidateSchema.java`).

## 7. Responsible AI usage

This submission was co-authored with Claude (Sonnet 4.5, via OpenCode). I directed all design
decisions and reviewed every diff:

- I chose H2-in-Postgres-mode over Testcontainers given the no-Docker constraint, and I chose to
  document Testcontainers as the production path rather than pretend Docker was available.
- I wrote out the invariant list (INV-1 to INV-8) and the coverage matrix I wanted the harness to
  prove before any implementation.
- I chose the insert-idempotency-first ordering after seeing my own concurrency tests fail against
  the naive check-then-insert flow. The AI initially proposed serializable isolation, which caused
  H2 lock timeouts; I overrode that with the insert-first pattern and re-verified.
- I chose the byte-for-byte response replay pattern (return the stored body as raw bytes) to
  ensure the persistence guarantee is provable from the outside.
- I ran `mvn test` (38/38 passing), `mvn spotless:check` (clean), `mvn exec:java
  -Dexec.mainClass=ValidateSchema` (passing), and the CI reliability filter myself. Reliability
  suite ran 5 consecutive times without flake.

What I would flag to a reviewer: the code was drafted with AI assistance, so the mechanical parts
(RestAssured boilerplate, JdbcTemplate glue, DbAssertions helpers) went faster than I could have
written them from scratch. The *decisions* — invariant list, insert-idempotency-first,
byte-for-byte replay, H2-vs-Testcontainers trade-off, the specific concurrency scenarios worth
running, the fix for the race condition my tests surfaced — are mine, and I can defend each one
in a review.
