## Summary

Implemented a self-contained Java + RestAssured automated test suite for the Wallet Transfer Service in `submission/nikhil-funde/`. Includes a minimal Javalin + H2 service fixture and ~38 tests covering happy path, validation, insufficient balance, idempotency, concurrency, and cross-component (audit/outbox) invariants.

## Test Strategy

- **Levels covered:** API (RestAssured), database (JDBC), audit/outbox row counts, concurrency (ExecutorService)
- **In scope:** Transfer lifecycle, idempotency, balance invariants, validation failures, competing transfers, retry safety
- **Out of scope:** Real message broker, distributed transactions, performance testing
- **Real vs stubbed:** Javalin API and H2 DB are real (in-process); `outbox_events` is a DB stub (no MQ); idempotency stored on `transfers` table (not separate `idempotency_keys` table, matching Python reference)

## API Validation Approach

- RestAssured calls via `TransferApiClient` wrapper
- Success: 201 + payload fields (`status`, `amount`, `id`)
- Validation failures: 422 for missing fields, invalid currency, zero/negative amount, same source/dest
- Idempotency: 201 → 200 replay, 409 for same-key/different-payload conflict
- GET endpoints verified for transfer and wallet read-back

## Database Validation Approach

- **Tables checked:** `wallets`, `transfers`, `audit_events`, `outbox_events`
- **Invariants:** balance debit/credit exactly once on success, no rows on rejection, transfer count = 1 on idempotent replay, audit/outbox count = 1 per successful transfer
- **Seeding:** Fresh H2 DB per test via `TestEnvironment` extension; wallets seeded to 10000/5000/0 AED

## Cross-Component Validation

- `audit_events`: verified on happy path and idempotency (count and event_type)
- `outbox_events`: stub table written on success; count verified (exactly-once side effect semantics)

## Reliability / Concurrency Coverage

- **Competing transfers:** 5 concurrent 3000 AED transfers from 10000 balance → at most 3 succeed, balance never negative
- **Same idempotency key concurrent:** 10 threads → 1 transfer row, 1 debit
- **Retry storm:** 5 sequential retries → 1 transfer, balance debited once
- **Confidence:** Catches double-debit, negative balance, and duplicate transfer row bugs

## Test Architecture

```
support/          → TestEnvironment, TransferApiClient, DatabaseVerifier, TransferRequestBuilder
*Test.java        → Scenario specs grouped by category (readable, no transport leakage)
service/          → Minimal SUT fixture (Javalin + H2)
```

Separation keeps tests readable; adding a new scenario requires only a builder + client call + DB assertion.

## Validation

```bash
cd submission/nikhil-funde
mvn spotless:check    # lint — PASS
mvn test              # 38 tests — PASS
mvn exec:java         # schema validation — PASS
mvn test -Dtest="*Reliability*"  # 3 reliability tests — PASS
```

## Known Limitations / Next Steps

- Concurrency tests are in-process (single JVM), not multi-node
- Testcontainers/PostgreSQL deferred for CI speed; H2 used instead
- Outbox is DB-only stub; no real publish verification
- With more time: add contract/schema tests for API response shape, expand currency mismatch cases

## Responsible AI Usage

- **AI tools used:** Yes (Cursor AI for scaffolding, boilerplate generation, and porting Python reference patterns)
- **Where AI helped:** Initial project structure, boilerplate service setup from the Python reference, and basic code scaffolding for the Java/Maven layout
- **What I implemented myself:** Test strategy, service behavior decisions, architecture and test structure, business-rule logic, idempotency and concurrency assertions, and final validation of the solution
- **AI also helped with:** selecting technologies and tools (including Javalin and H2) for the implementation approach
- **Personally verified:** I reviewed the test logic and invariants against the Python reference, ran the full Maven suite locally (38/38 pass), and manually validated the idempotency and concurrency behavior in the final implementation

## Author Checklist

- [x] Linting passes
- [x] Test suite passes (38 tests)
- [x] Schema/setup validation passes
- [x] Reliability-focused tests pass (3 tests)
- [x] README was tested from a clean setup
- [x] End-to-end transfer validation was run locally
