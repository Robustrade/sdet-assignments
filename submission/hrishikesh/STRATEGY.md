# Test strategy — Wallet Transfer Service

_This document was written before the implementation to fix the shape of the harness. It is kept
alongside the code so a reviewer can see the reasoning that produced the invariants and the test
grouping._

## 1. What is under test, and what is not

**Under test:** a money-moving HTTP service with a persistent state machine. The exposed surface
is one write endpoint (`POST /transfers`) plus two read endpoints. Behind that surface sit five
tables (wallets, transfers, idempotency_keys, transfer_events, outbox_events) and a downstream
notifier reached indirectly through the transactional outbox.

**Not under test:** the notifier itself (stubbed), the retry policy of a real message broker
(the outbox pattern is exercised, but no Kafka/SQS is involved), or performance under sustained
load (functional and race-condition correctness only).

## 2. Threat model

For a service that moves money, the failure modes that matter most are the ones that violate
conservation:

| Threat                                            | Consequence                                     | Priority |
| ------------------------------------------------- | ----------------------------------------------- | -------- |
| Double-debit on a retried request                 | Customer charged twice                          | P0       |
| Debit without corresponding credit (or reverse)   | Money vanishes / appears from nowhere           | P0       |
| Balance goes negative under concurrent load       | Overdraft, downstream reconciliation break      | P0       |
| Duplicate downstream notification                 | Duplicate emails / duplicate ledger entries     | P1       |
| Partial mid-transfer failure not rolled back      | Ghost transfer row, orphaned idempotency key    | P1       |
| Silent replay divergence (different response)     | Client SDK hash mismatch, corrupted receipts    | P1       |
| Currency mismatch accepted                        | Cross-currency contamination                    | P1       |
| Same-payload retry treated as new transfer        | Same as double-debit                            | P0       |
| Different-payload retry silently succeeds         | Undetected key reuse, ambiguous audit trail     | P1       |
| Wallet not found silently returns 201             | Corrupt state, undebuggable                     | P2       |

Every P0 and P1 threat maps to at least one dedicated test. This is documented in the coverage
matrix at the top of `README.md`.

## 3. Invariants the harness must prove

Instead of enumerating request/response scenarios, the harness proves eight invariants. Every
test asserts at least one of these; the reliability tests assert several at once.

- **INV-1 Conservation.** For every completed transfer:
  `source.balance_before − source.balance_after == destination.balance_after − destination.balance_before == amount`.
- **INV-2 Non-negativity.** No wallet balance is ever negative at any observable point.
- **INV-3 Response=DB.** The 201 response body matches the persisted `transfers` row field-for-field.
- **INV-4 Idempotency exactly-once.** For any given idempotency key, at most one row in `transfers`
  and at most one set of side effects (audit + outbox) exists, regardless of how many times the
  request is submitted or how many threads submit it concurrently.
- **INV-5 Replay determinism.** A retry with the same key and same payload returns the same
  status and byte-identical body as the original response.
- **INV-6 Replay conflict detection.** A retry with the same key but a different payload returns
  409 and does not alter state.
- **INV-7 Audit exactness.** Exactly one `transfer_completed` row per completed transfer with a
  payload matching the transfer.
- **INV-8 Outbox exactly-once → delivery exactly-once.** Exactly one outbox row per transfer,
  enforced by a unique index. After `OutboxRelay.drain()`, the downstream notifier is called
  exactly once per transfer regardless of how many times drain runs.

## 4. Coverage philosophy

- **Full-stack, no mocks between the client and the DB.** Every test drives the real Spring Boot
  service over HTTP on a random port and reads state back with JdbcTemplate. This is the only way
  to catch the class of bugs where the service code is correct in isolation but the SQL, the
  transaction boundary, or the HTTP mapping is wrong. Unit tests would have missed the specific
  race condition described in the Red-Blue-Green section of `PR_DESCRIPTION.md`.
- **Assertions read from the persisted state.** Every test that mutates state asserts (a) the API
  response, (b) the resulting DB rows, and (c) the downstream side effects. A test that only
  asserts (a) can be satisfied by a bug that returns the right JSON but doesn't persist anything.
- **Freshly-truncated schema per test.** No `@DirtiesContext`, no ordering dependency. Truncation
  runs in FK order in `ApiTestBase.setUpBase()`.
- **One reason per test.** Each test asserts a small named invariant. Cross-cutting checks live in
  `HappyPathTest` (all 8 invariants at once from one transfer) and the reliability tests.
- **Concurrency tests must be non-flaky.** The reliability suite is run 5 times in a row locally
  before every push.

## 5. Test grouping

```
api/           16   contract shape + input validation
workflow/       5   business flows end-to-end (happy, insufficient balance, lifecycle)
idempotency/    6   same-key/same-payload, same-key/different-payload, no-duplicate-effects
persistence/    7   wallet state, audit exactness, outbox exactly-once
reliability/    5   concurrent duplicates, balance race, retry safety, partial-failure rollback
```

Grouping is by **intent**, not by layer. A test that spans HTTP + service + DB + notifier lives
under whichever intent it primarily proves. This means a reviewer skimming the tree can find the
proof of any given invariant in seconds.

## 6. Concurrency test design

Concurrency tests use an `ExecutorService` + `CountDownLatch` gate so that N workers release in
the same instant against the live HTTP server (not the in-JVM bean). The gate matters: without
it, thread startup jitter serializes the requests and hides the race.

Two scenarios cover the two classes of race:

- **Same-key duplicates** — 10 workers submit the *same* idempotency key. The invariant is that
  the persisted state must be identical to a single-worker submission. This is the test that
  caught the naive check-then-insert bug documented in `PR_DESCRIPTION.md` § "The race condition
  my own tests caught".
- **Different-key competition** — 10 workers submit *different* idempotency keys but compete for
  the same source wallet with a balance that admits only some of them. The invariant is that the
  number of successes exactly matches what the balance allows, no request produces a negative
  balance, and every failure returns a proper 422.

## 7. Partial-failure rollback

A single reliability test forces an exception from the last write inside the transaction (outbox
enqueue) via a Mockito spy and asserts every table is unchanged and the idempotency key is *not*
persisted — so a retry can safely proceed. This is the only test that touches Mockito; every
other test drives real components.

## 8. Non-goals

- **Property-based / fuzzing.** Explicitly out of scope for this submission; the invariant list
  is small enough to cover exhaustively with focused tests, and property tests are hard to make
  non-flaky under concurrency.
- **Performance testing.** No throughput or latency assertions.
- **Real message broker.** The outbox pattern is proven by the row/side-effect invariants; a real
  Kafka/SQS wiring is a deployment concern.

## 9. Environment trade-off

H2 in PostgreSQL compatibility mode was chosen because Docker is unavailable in the local dev
environment. This is documented as a limitation in `README.md`; the migration and service code
use only portable SQL (`SELECT ... FOR UPDATE`, unique indexes, `CHECK` constraints, identity
columns), so promoting to a Testcontainers Postgres profile is a configuration change with no
test-code impact. The trade-off is deliberate: H2 in Postgres mode covers the specific SQL
features the service relies on, and running under real Postgres in CI is a follow-up we would do
before shipping.
