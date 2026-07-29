# Wallet Transfer Service — Java SDET Solution

**Candidate:** Rupesh Detke  
**Branch:** `solution/rupesh-detke`  
**Submission path:** `submission/rupesh-detke/`

Automated multi-layer validation suite for a Wallet Transfer Service (Kulu SDET take-home).

## What this submission contains

| Path | Purpose |
|------|---------|
| TEST_STRATEGY.md | Documentation-first outline (dummy PR / approach) |
| src/main/java | Minimal service fixture (Javalin + H2 + JDBC) |
| src/main/resources/schema.sql | Persistence schema |
| src/test/java | API, workflow, reliability, and cross-component tests |
| ValidateSchema | CI schema validation entrypoint |

## Approach in one sentence

Build a small but real transfer API with transactional persistence, then prove correctness from HTTP response → DB balances → audit/outbox under duplicates and concurrency.

## Stack

- Java 17, Maven
- Javalin (HTTP), H2 (DB), Jackson
- JUnit 5, RestAssured, AssertJ
- Spotless (Google Java Format)

## Prerequisites

- JDK 17+
- Maven 3.9+

## Run locally

bash
cd submission/rupesh

# Full suite
mvn test

# Reliability-focused suite (CI job name match)
mvn test -Dtest="*Reliability*"

# Schema validation (CI db-migration-or-schema-check)
# PowerShell: quote -D args
mvn -q exec:java "-Dexec.mainClass=ValidateSchema"

# Formatting check
mvn spotless:check

# Optional: apply formatting
mvn spotless:apply

# Optional: run the fixture service on port 8080
mvn -q exec:java -Dexec.mainClass="com.kulu.wallet.api.WalletTransferApp"


## API surface

- POST /transfers + header Idempotency-Key
- GET /transfers/{transfer_id}
- GET /wallets/{wallet_id}

## Tables validated

wallets, transfers, idempotency_keys, transfer_events, outbox_events

## Test layout

- api/ — contract, validation, happy path
- workflow/ — insufficient funds, idempotency, outbox
- reliability/ — concurrent duplicates + competing balance
- support/ — API client, builders, DB assertions, fixtures

## Real vs stubbed

- Real: HTTP API, JDBC persistence, idempotency store, audit events, outbox rows
- Stubbed: downstream broker/consumer (outbox is the verified publish boundary)

See TEST_STRATEGY.md for full strategy, invariants, and limitations.
