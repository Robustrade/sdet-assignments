# Wallet Transfer Service - API Test Automation

SDET take-home submission by Kalpesh Patil.

Test strategy, assumptions and limitations are in [STRATEGY.md](./STRATEGY.md).

## Tech Stack

- Java 17
- Maven
- TestNG
- Rest Assured
- JDBC (database validation)
- Log4j2
- Zonky Embedded PostgreSQL (real Postgres, no Docker needed)

## Prerequisites

- JDK 17 or above
- Maven 3.8+
- Internet connection on first run (downloads dependencies and Postgres binaries)

No Docker, no database installation, no environment setup needed.

## How to Execute Tests

Run all commands from this folder (`submission/kalpesh-patil`).

Run the full test suite (31 tests):

```
mvn test
```

Run only the reliability tests (idempotency + concurrency):

```
mvn test -Dtest="*Reliability*"
```

Run the schema validation check:

```
mvn compile exec:java
```

Run the wallet service standalone on http://localhost:8080 (for manual testing
with Postman/curl):

```
mvn compile exec:java -Dexec.mainClass=com.wallet.fixture.FixtureMain
```

### Run from Eclipse

1. File > Import > Maven > Existing Maven Projects > select this folder
2. Right click any test class (e.g. `HappyPathTransferTest`) > Run As > TestNG Test
3. Or right click `pom.xml` > Run As > Maven test for the full suite

`mvn test` handles everything by itself - it starts embedded PostgreSQL,
creates the schema, starts the wallet service in-process and cleans the
database before every test.

## Project Structure

```
src/main/java
    ValidateSchema.java              schema check entry point (used by CI)
    com.wallet.fixture               minimal wallet service under test
        db                           embedded Postgres + schema setup
        http                         HTTP endpoints (JDK HttpServer)
        service                      transfer logic, locking, idempotency
        model                        request/response records

src/test/java
    com.api.constant                 enums (TransferStatus, ErrorCode etc.)
    com.api.request.model            TransferPayload
    com.api.services                 TransferService (all API calls)
    com.api.utils                    ConfigManager, TestEnvironmentManager, DataGeneratorUtil
    com.api.tests                    test classes
    com.database                     DatabaseManager + DAOs for DB validation

src/test/resources
    config/config.properties         test config
    log4j2.xml                       logging config
```

## Test Classes

| Class                       | Covers                                          |
| --------------------------- | ----------------------------------------------- |
| HappyPathTransferTest       | successful transfer, debit/credit, balance      |
| TransferValidationTest      | invalid requests, missing fields, 404s          |
| InsufficientBalanceTest     | rejection, failure record, unchanged balances   |
| IdempotencyReliabilityTest  | duplicate submissions, same key different payload |
| ConcurrencyReliabilityTest  | race conditions, competing transfers, deadlock  |
| PersistenceAndAuditTest     | audit trail, outbox event, DB consistency       |

TestNG groups used: `smoke`, `regression`, `api`, `reliability`.
