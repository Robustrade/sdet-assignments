# Test Strategy

## What's actually being tested

A wallet transfer touches five things at once: the source wallet's balance,
the destination wallet's balance, a persisted `transfer` record, an audit
trail (`transfer_events`), and (on success) an outbox row for downstream
systems. A test suite that only checks the HTTP response is checking one
fifth of the system. Every test class here targets a different slice of that
picture on purpose:

| Test class                     | Question it answers |
|---------------------------------|----------------------|
| `ApiContractTests`              | Does the API return the right status code and shape for every input? |
| `DatabaseVerificationTests`     | Does what's on disk actually match what the API claimed happened? |
| `EndToEndFlowTests`             | Do all five things (API, wallets, transfer, events, outbox) agree with each other for one scenario, start to finish? |
| `ConcurrencyReliabilityTests`   | Does the system behave correctly when two requests genuinely race? |
| `ComponentInteractionTests`     | When something fails partway through, is the rollback complete -- no half-written state anywhere? |

## How database verification stays honest

`DbVerifier` runs raw SQL through its own JDBC connection -- it does not reuse
the service's DAOs or read endpoints. If it did, a bug in `TransferDao` could
silently pass every test (the app would consistently lie to itself). Reading
the DB independently is what actually proves persistence, not just that the
app's internal read path is self-consistent.

## Isolation: why tests don't corrupt each other

- **Server:** one real instance boots for the whole suite (`BaseTest`,
  `@BeforeSuite`) -- tests are genuine HTTP calls, not in-process shortcuts.
- **Data:** `resetAllData()` wipes every table before each test **class**
  (`@BeforeClass`), so no class inherits stale rows from the previous one.
- **Within a class:** every test method seeds its own fresh wallet(s) with
  `testData.seedWallet(...)`, which generates a random wallet id per call.
  Tests never share a wallet, so they can safely run in any order and would
  even tolerate parallel execution within a class (not currently enabled, but
  the design doesn't fight it).

## Real-world reliability scenarios (the part that's easy to skip)

**Duplicate/retried requests.** A client that times out and retries a
transfer must not double-move money. This is tested twice, deliberately:
- Sequentially (`DatabaseVerificationTests#duplicateSubmission_neverDebitsTheWalletTwice`):
  three identical calls, same key, one after another -- proves the *logic* is
  idempotent.
- Concurrently (`ConcurrencyReliabilityTests#concurrentDuplicateSubmissions_sameIdempotencyKey_onlyProcessedOnce`):
  three identical calls fired at the same instant from separate threads --
  proves the idempotency guarantee holds *under a genuine race*, not just
  when requests happen to arrive one at a time. This is the test that would
  actually catch a "check-then-insert" race condition that looks correct in
  a sequential test but isn't safe concurrently.

**Partial failures.** `ComponentInteractionTests` deliberately triggers a
failure *after* both wallets are already locked inside the transaction
(mismatched currency, only detectable post-lookup), then asserts nothing
anywhere moved: not the balances, not the transfer table, not the idempotency
table. It then reuses the same idempotency key for a valid follow-up request
and asserts it succeeds normally -- proving the rollback didn't just leave
balances untouched but also didn't "burn" the idempotency key on a failed
attempt.

**Concurrent contention for limited funds.** Two transfers for 70 out of a
100-balance wallet, fired at the same instant: exactly one must complete and
the other must be cleanly rejected (never both completing, never both
rejected, never a 500). This is the test that exercises the `SELECT ... FOR
UPDATE` row locking directly.

## Assumptions made explicit (see also README's "Design decisions" section)

- Insufficient balance -> `200` + `REJECTED` (a recorded business decision),
  not an HTTP error code. Documented so a reviewer isn't surprised by the
  status code choice.
- Only requests accepted for business processing are idempotency-cached;
  basic (400-level) validation failures are not, since they're client bugs,
  not legitimate retries of a real attempt.
- Currency-mismatch between a wallet and the request is treated as a `400`,
  discovered only after locking (used deliberately as the partial-failure
  probe above).

## What's intentionally out of scope

- Load/performance testing (explicitly excluded by the assignment).
- Multi-currency conversion logic (transfers require matching currencies;
  conversion is a separate concern not described in the brief).
- A real message broker for the outbox pattern -- simulated as described in
  the README, with the "written in the same transaction" guarantee being the
  part actually worth testing here.
