# Wallet Transfer Service -- SDET Take-Home

A small Wallet Transfer Service (plain Java, JDK `HttpServer` + JDBC/H2, no
framework) plus a Java/RestAssured/TestNG automation suite that exercises it
end to end: API contract, database state, full request-to-persistence flows,
concurrency/idempotency safety, and multi-table component interaction.

## Stack

- **Service under test:** Java 17, `com.sun.net.httpserver.HttpServer` (JDK-built-in,
  no framework), plain JDBC against H2, Jackson for JSON only.
- **Test suite:** TestNG (runner) + RestAssured (HTTP client) + direct JDBC
  (independent DB verification).
- **Build:** Maven.

## Why no framework for the service?

This is deliberately framework-free (no Spring). The point of this exercise is
the test design, and every line of the service should be readable and
defensible without "the framework does that for me" as an answer. All routing,
JSON handling, and transaction management is explicit.

## Running it

```bash
# Run the service standalone on http://localhost:8080
mvn compile exec:java -Dexec.mainClass=com.robustrade.wallet.Main
# or, after packaging:
mvn package
java -jar target/wallet-transfer-sdet-1.0.0.jar
```

```bash
# Run the full test suite (starts its own isolated service instance internally)
mvn test
```

The test suite does **not** require the service to already be running --
`BaseTest` boots its own instance of `Main` against a dedicated H2 file
(`./data/test-walletdb`), separate from the one a manual `java -jar` run would
use (`./data/walletdb`).

> **Note on this sandbox:** this project was written and reviewed in an
> environment without access to Maven Central (only a small package-registry
> allowlist), so `mvn test` could not be executed here to confirm a green run.
> The code was reviewed line-by-line for compile correctness instead. Please
> run `mvn test` locally as the first step after pulling this branch.

## API

| Method | Path                  | Description                                  |
|--------|-----------------------|-----------------------------------------------|
| POST   | `/transfers`          | Create a transfer. Optional `Idempotency-Key` header. |
| GET    | `/transfers/{id}`     | Fetch a transfer by id.                      |
| GET    | `/wallets/{id}`       | Fetch a wallet's current balance.            |

**POST /transfers** body:
```json
{
  "source_wallet_id": "wallet_abc",
  "destination_wallet_id": "wallet_xyz",
  "amount": 25.00,
  "currency": "USD",
  "reference": "invoice-1042"
}
```

## Design decisions & assumptions (worth knowing before reading the tests)

1. **Insufficient balance is a business outcome, not an HTTP error.** A
   transfer that fails because the source wallet doesn't have enough funds
   returns `200 OK` with `status: "REJECTED"` and `rejection_reason:
   "INSUFFICIENT_BALANCE"`, and is persisted for audit. Malformed requests
   (missing fields, bad currency code, non-positive amount, wallet not found)
   are HTTP-level errors (`400`/`404`) and are **not** persisted as transfers.

2. **Idempotency-Key semantics.** If provided, the header must be non-blank.
   The same key + same payload replays the original response byte-for-byte
   (marked `"replayed": true`). The same key + a *different* payload returns
   `409`. Requests that fail *before* being accepted for business processing
   (basic validation, `400`) are not idempotency-cached -- only accepted
   outcomes (`COMPLETED` or `REJECTED`) are, since those are the outcomes a
   legitimate retry needs to see repeated exactly.

3. **Concurrency control uses the database, not application locks.**
   - Two transfers touching the same wallet(s): both wallets are locked with
     `SELECT ... FOR UPDATE`, always acquired in a deterministic (sorted-id)
     order, so concurrent transfers serialize correctly and can never deadlock
     each other.
   - Duplicate submissions under the same idempotency key: the key is
     "claimed" via `INSERT` into a primary-keyed table *before* any business
     logic runs. The primary-key constraint acts as a mutex -- a second
     concurrent insert of the same key blocks until the first transaction
     commits or rolls back, then either fails (first succeeded -> replay the
     stored result) or succeeds (first rolled back -> this request now owns
     processing). No polling, no application-level locks.
   - See `TransferService` and `IdempotencyDao` for the implementation, and
     `docs/TEST_STRATEGY.md` for how this is verified.

4. **Outbox pattern, simplified.** A `TRANSFER_COMPLETED` outbox row is
   written in the *same transaction* as the transfer, so "transfer succeeded"
   and "an event exists for downstream systems" can never disagree. This
   fixture marks the row `PUBLISHED` synchronously instead of running a real
   publisher process against a message broker -- documented as a
   simplification, not a gap in understanding of the real pattern.

## Project layout

```
src/main/java/com/robustrade/wallet/
  Main.java                 entry point, wires everything together
  http/                     HTTP handlers (routing, JSON in/out)
  service/                  TransferService (core logic), ReadService (GETs)
  dao/                      plain JDBC data access, one class per table
  model/                    plain data classes
  dto/                      request/response JSON shapes

src/test/java/com/robustrade/wallet/
  support/                  BaseTest (server lifecycle), TransferApiClient
                            (RestAssured wrapper), DbVerifier (direct-SQL
                            assertions), TestData (builders)
  tests/                    ApiContractTests, DatabaseVerificationTests,
                            EndToEndFlowTests, ConcurrencyReliabilityTests,
                            ComponentInteractionTests
```

See `docs/TEST_STRATEGY.md` for the full test design writeup.
