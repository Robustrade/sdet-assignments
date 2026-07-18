# Test Strategy — Wallet Transfer Service

Author: Kalpesh Patil

I wrote this document before writing the automation code, as the assignment
asks. It covers what I am validating, at which layers, what is real vs
simulated, and the limitations I am aware of.

Stack: Java 17, Maven, TestNG (groups: smoke, regression, api, reliability),
RestAssured, plain JDBC DAOs for DB verification, Log4j2, and Zonky embedded
PostgreSQL (real Postgres binaries).

---

## 1. System under test

No service was provided in the assignment repo, so I 
built a minimal wallet transfer service myself.

I built it in plain Java (JDK HttpServer + raw JDBC) instead of Spring Boot.
My reasoning: the whole assignment is about transactional correctness, so I
wanted the transaction boundaries, row locking and commit/rollback to be
visible in the code rather than hidden behind @Transactional. It also keeps
the fixture small (~700 lines), so review time goes to the test suite, which
is what is actually being evaluated.

One thing I had to handle explicitly: the JDK HttpServer is single-threaded
by default. If I left it like that, "concurrent" requests would quietly get
processed one at a time and my concurrency tests would pass for the wrong
reason. So the server is configured with a fixed thread pool, and the thing
that actually serializes competing transfers is the database row lock.

## 2. Database: real PostgreSQL, no Docker

Tests run against real PostgreSQL using Zonky embedded Postgres, which
downloads actual Postgres binaries and runs them in-process.

I did not use Testcontainers because my machine has no Docker, and embedded
Postgres behaves the same locally (Windows) and in the GitHub Actions runner
(Linux). I also ruled out H2, because the things I am testing (SELECT ... FOR
UPDATE, isolation behaviour) need real engine semantics — a concurrency suite
passing against an emulator would not convince me of anything.

Tradeoff: it is a single-node instance tied to the test JVM. Acceptable here,
since the invariants under test are transactional, not infrastructural.

## 3. Real vs stubbed

| Component         | Real / stubbed | Notes                                             |
| ----------------- | -------------- | ------------------------------------------------- |
| HTTP API          | Real           | Actual HTTP over localhost, called via RestAssured |
| PostgreSQL        | Real           | Embedded binaries, real locking semantics          |
| Transfer logic    | Real           | Explicit transactions, ordered row locking         |
| Idempotency store | Real           | idempotency_keys table, insert-first reservation   |
| Audit log         | Real           | transfer_events, written in the same transaction   |
| Outbox            | Real (table)   | outbox_events written transactionally              |
| Message broker    | Not built      | Only the outbox relay would talk to a broker; out of scope |
| Notifications     | Not built      | Same reasoning                                     |

The outbox is my cross-component boundary on purpose: "the event is recorded
exactly once, atomically with the transfer" is fully testable at the DB level
without standing up a broker. The relay side is listed as a limitation rather
than silently skipped.

## 4. API contract

Matches the assignment spec and the sample test in the repo (same field
names, 201 + status on success).

| Endpoint              | Success            | Failures                                            |
| --------------------- | ------------------ | --------------------------------------------------- |
| POST /transfers       | 201, COMPLETED     | 400 validation, 404 unknown wallet, 409 idempotency conflict, 422 insufficient balance |
| GET /transfers/{id}   | 200                | 404 unknown transfer                                |
| GET /wallets/{id}     | 200                | 404 unknown wallet                                  |

Idempotency behaviour (modeled on how Stripe does it):

- Idempotency-Key header is required on POST /transfers, 400 without it.
- Same key + same payload: replays the originally stored result, with an
  Idempotency-Replayed: true response header.
- Same key + different payload: 409, never processed.
- Concurrent duplicates on one key: exactly one request wins the reservation
  and executes; the rest wait and get the replay. Never two executions.

Amounts are integer minor units (fils/cents) everywhere. I will not put money
in floating point; the schema enforces this too (BIGINT, CHECK amount > 0).

## 5. Tables and invariants checked

Tables: wallets, transfers, idempotency_keys, transfer_events, outbox_events.

Invariants the suite asserts (each maps to at least one test):

1. Source wallet is debited exactly once per successful transfer.
2. Destination wallet is credited exactly once per successful transfer.
3. Total balance across the wallet pair is conserved.
4. Rejected transfers (validation or insufficient funds) change no balances.
5. One idempotency key maps to at most one transfer row, ever.
6. Duplicates add no extra transfers, transfer_events or outbox_events rows.
7. Persisted state matches the API-visible result (GET vs DB row).
8. transfer_events are coherent: REQUESTED first, exactly one terminal event.
9. Exactly one outbox row per completed transfer, zero for rejected ones.
10. A balance can never go negative (there is also a DB CHECK constraint, but
    the tests prove the service never even attempts it).

## 6. Seeding, isolation, stale data

- Embedded Postgres and the service start once per test JVM (startup costs a
  few seconds, so paying it per-test is not worth it).
- Every test method starts from truncated tables (TRUNCATE ... CASCADE in the
  base class @BeforeMethod) and seeds its own wallets with known balances.
  So any row a test sees, that test created — stale data cannot produce a
  false positive.
- Wallet ids and idempotency keys are generated per test, no shared ids.
- This is also what makes absence assertions (e.g. "no outbox row exists
  after a rejection") trustworthy.

## 7. Concurrency approach

The concurrency tests release all competing requests through a CountDownLatch
starting gate instead of just submitting them quickly one after another.
Scenarios:

1. Two transfers competing for a balance that can only fund one. Exactly one
   201, one 422, and the DB shows a single debit, never a negative balance.
2. Five concurrent requests with the same idempotency key. All get the same
   transfer_id back, and the DB has one transfer row and one debit.
3. A→B and B→A at the same time. This one exists to prove the ordered lock
   acquisition (both wallets locked in a single ORDER BY wallet_id query)
   prevents the classic transfer deadlock. Both must complete.

During development I verified these tests can actually fail: removing the FOR
UPDATE locking makes scenario 1 double-debit, which is my Red step evidence.
Every Future.get uses a timeout, so a real deadlock fails the run loudly
instead of hanging CI.

## 8. Retry / response-loss model

A client that never got a response cannot know if the server processed the
request. I model that as: send, ignore the response, resend with the same
key. The assertion is on server-side end state (one transfer, one debit) plus
the replay matching the original response — which is the guarantee a real
retry policy depends on.

## 9. Known limitations

- The outbox relay (poller that publishes rows to a broker) is not built, so
  at-least-once delivery and consumer dedupe are not tested.
- Single service instance only. Cross-instance races would be handled by the
  same DB row locks, but I only prove that at single-node level.
- No crash-recovery automation (killing the service mid-transaction).
  Postgres guarantees the rollback; automating the crash did not fit the
  time box.
- No performance/load testing — explicitly a non-goal in the assignment.
- Same-currency transfers only; a currency mismatch is rejected up front.
