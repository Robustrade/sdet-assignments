## Summary

Implements a Wallet Transfer Service fixture (plain Java, JDK `HttpServer` +
JDBC/H2, no framework) and a Java/RestAssured/TestNG automation suite that
validates it across the API, database, and workflow layers: happy path,
validation, insufficient balance, idempotent duplicate submissions,
concurrent requests, and multi-table component interaction/rollback.

## Test Strategy

- **Levels covered:** API (HTTP contract), database (direct SQL, independent
  of the app's own DAOs), full end-to-end flow (API -> wallets -> transfer
  row -> audit events -> outbox -> GET endpoints), concurrency/reliability,
  and cross-component/partial-failure behavior.
- **In scope:** everything described in `SDET_ASSIGNMENT.md` -- transfer
  creation, validation, insufficient balance, idempotency, concurrent
  requests, persistence/audit consistency.
- **Out of scope:** load/performance testing (excluded per the assignment),
  multi-currency conversion, a real message broker for the outbox pattern.
- **What is real vs stubbed/mocked:** everything is real -- a genuine
  embedded HTTP server, a real H2 database on disk, real JDBC transactions,
  real concurrent threads for the race-condition tests. Nothing in the test
  suite is mocked. The only simulated piece is the outbox "publisher": rows
  are marked `PUBLISHED` synchronously in the same transaction instead of
  being drained by a real message-broker consumer process (documented in
  `docs/TEST_STRATEGY.md`).

## API Validation Approach

- **How requests/responses are validated:** RestAssured against a live
  instance of the service; status codes and JSON body shape/values asserted
  per scenario (`ApiContractTests`).
- **Which failure scenarios are covered:** missing required fields, invalid
  currency code, zero/negative amount, source == destination, malformed JSON
  body, blank `Idempotency-Key` header, nonexistent wallet (404), insufficient
  balance (200 + REJECTED).
- **How duplicate behavior is verified:** same key + same payload returns the
  original response marked `replayed: true`; same key + different payload
  returns 409 -- both asserted at the API layer (`ApiContractTests`) and
  independently at the DB layer (`DatabaseVerificationTests`,
  `ConcurrencyReliabilityTests`).

## Database Validation Approach

- **Which tables are checked:** `wallets`, `transfers`, `idempotency_keys`,
  `transfer_events`, `outbox_events` -- via `DbVerifier`, which opens its own
  JDBC connection and runs raw SQL, deliberately independent of the
  service's own DAO/read-path code so a bug there can't make the app lie to
  itself and still pass.
- **Which invariants are asserted:** exact balance deltas after a transfer;
  exactly one transfer row per attempt; correct `status`/`rejection_reason`;
  no wallet mutation on a rejected transfer; exactly one idempotency row
  regardless of retry count; audit event counts/types; outbox row exists
  only for completed transfers.
- **How test data is seeded and cleaned:** `TestData` seeds wallets directly
  via JDBC (bypassing the API, since seeding is setup, not the thing under
  test) with a fresh random wallet id per call. `BaseTest` wipes all tables
  before each test **class** (`@BeforeClass`) so no class inherits stale rows
  from a previous one; within a class, every test seeds its own wallets so
  method order never matters.

## Cross-Component Validation

`ComponentInteractionTests` and `EndToEndFlowTests` verify that a single
transfer's effects across all five tables agree with each other and with the
API response: wallet balances, the transfer row, the audit trail
(`transfer_events`), the outbox row, and (when supplied) the idempotency
record. A dedicated test triggers a failure *after* both wallets are already
locked inside the transaction (currency mismatch, only detectable post
wallet-lookup) and asserts nothing partial was left anywhere -- not the
balances, not the transfer table, not the idempotency claim -- and that the
freed idempotency key can be reused successfully afterward.

## Reliability / Concurrency Coverage

- **Duplicate request scenarios:** same `Idempotency-Key` submitted multiple
  times sequentially (`DatabaseVerificationTests`) and concurrently
  (`ConcurrencyReliabilityTests`).
- **Retry safety scenarios:** a request that fails a business rule after
  claiming its idempotency key rolls back fully, freeing the key for a
  subsequent valid retry (`ComponentInteractionTests`).
- **Concurrency/race scenarios:** two genuinely concurrent transfers (real
  threads, released together via a `CountDownLatch`) competing for a wallet
  balance that can only satisfy one of them; three genuinely concurrent
  duplicate submissions under the same idempotency key.
- **What confidence these tests provide:** they exercise the actual
  concurrency-control mechanisms in `TransferService` -- `SELECT ... FOR
  UPDATE` row locking (deterministic lock order to prevent deadlock) and a
  claim-first idempotency insert that uses the database's own primary-key
  lock as a mutex -- rather than just asserting on sequential calls, which
  would pass even if the underlying logic had a race condition.

## Test Architecture

- `support/BaseTest` -- boots one real service instance per suite, wipes
  data per test class.
- `support/TransferApiClient` -- thin RestAssured wrapper, keeps raw HTTP
  detail out of test bodies.
- `support/DbVerifier` -- direct-SQL assertions, independent of the app.
- `support/TestData` -- wallet/request builders.
- `tests/` -- five classes, each targeting a distinct slice of the system
  (see `docs/TEST_STRATEGY.md` for the full rationale table).

This keeps each test method short and focused on one behavior, with all
plumbing (server lifecycle, HTTP calls, SQL assertions, data setup) isolated
in `support/` so it's reused rather than duplicated.

## Validation

```bash
mvn test
```

`mvn test` runs the full TestNG suite (`src/test/resources/testng.xml`)
against a freshly-started instance of the service and an isolated H2 file DB.

## Known Limitations / Next Steps

- With more time: add a dedicated malformed-idempotency-key format test
  (currently only blank-string is covered) and a test for very large/decimal
  precision edge cases in `amount`.
- The outbox "publisher" is simulated synchronously; a fuller solution would
  add a separate polling consumer and test its retry/backoff behavior
  against a real broker (or Testcontainers-based one).
- Wallet/transfer currency is single-currency-per-transfer only; no
  conversion logic, since the assignment doesn't call for it.
- This was developed with H2 for zero-setup portability; the design (plain
  JDBC, standard SQL, no H2-specific syntax beyond `FOR UPDATE`, which is
  ANSI-standard) should port to Postgres/MySQL with only the JDBC URL and
  driver changed.

## Responsible AI Usage

- **Did you use AI tools?** Yes -- I used Claude (Anthropic) to help design
  and write this solution.
- **Where did they help?** Drafting the service fixture (HTTP handlers,
  DAOs, `TransferService` logic), the test suite structure and test cases,
  and this documentation. I also used it to reason through the concurrency
  design (claim-first idempotency locking, wallet lock ordering) and to
  verify H2's actual locking semantics for concurrent duplicate-key inserts
  via web search, since that behavior is version-specific and I wanted to
  confirm it rather than assume it.
- **What did you personally verify or correct?** I reviewed every file for
  correctness before committing. Note: the environment used to draft this
  did not have access to Maven Central, so `mvn test` could not be run there
  to confirm a green build before this PR was opened -- I am running it
  locally myself as the first step, and will update this PR if anything
  needs fixing as a result.

## Author Checklist

- [ ] Linting passes
- [ ] Test suite passes
- [ ] Schema/setup validation passes
- [ ] Reliability-focused tests pass
- [ ] README was tested from a clean setup
- [ ] End-to-end transfer validation was run locally
