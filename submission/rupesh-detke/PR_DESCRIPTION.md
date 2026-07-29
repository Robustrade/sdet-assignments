## Summary
Java SDET solution by Rupesh Detke for the Wallet Transfer Service: a minimal real API+DB fixture plus a multi-layer automation suite proving transfer correctness under validation failures, insufficient funds, idempotent retries, and concurrency. Includes a documentation-first strategy outline (TEST_STRATEGY.md).

## Test Strategy
- Levels covered: API contract, business workflow, database persistence, cross-component outbox/audit
- In scope: happy path, validation, insufficient funds, idempotency, concurrency, outbox exactly-once intent
- Out of scope: UI, load testing, real message broker consumer, auth
- What is real vs stubbed/mocked: real Javalin API + H2 JDBC tables; broker/notification delivery stubbed at the outbox boundary

## API Validation Approach
- How requests/responses are validated: RestAssured client asserts status codes and payload fields (transfer_id, status, amount, balances via GET)
- Which failure scenarios are covered: missing idempotency key, zero/negative amount, same wallets, unsupported currency, empty reference
- How duplicate behavior is verified: same key+payload returns original result (200 replay); same key+different payload returns 409; DB proves single transfer/outbox

## Database Validation Approach
- Which tables are checked: wallets, transfers, idempotency_keys, transfer_events, outbox_events
- Which invariants are asserted: exact once debit/credit, no mutation on reject/validation failure, balance conservation under contention, status/audit/outbox coherence
- How test data is seeded and cleaned: fresh in-memory H2 + schema migrate per test; wallets seeded explicitly; no shared mutable state across tests

## Cross-Component Validation
Outbox (TRANSFER_COMPLETED) and transfer_events audit rows are asserted for success; rejected transfers must not write outbox; idempotent replay must not create a second outbox row.

## Reliability / Concurrency Coverage
- Duplicate request scenarios: sequential replay + concurrent same-key flood
- Retry safety scenarios: assumed response-loss retry with same key/payload
- Concurrency/race scenarios: two competing transfers against limited balance (one completes, one rejects; never overdraw)
- What confidence these tests provide: catches double-debit and overdraft classes of bugs at API+DB level

## Test Architecture
Layered suite: support (client/builders/DB assertions/fixtures), api, workflow, reliability. Transport details stay out of scenario tests; invariants live in reusable DB assertions for maintainability.

## Validation
- mvn test
- mvn test -Dtest="*Reliability*"
- mvn -q exec:java -Dexec.mainClass="ValidateSchema"
- mvn spotless:check (after spotless:apply if needed)

## Known Limitations / Next Steps
- H2 instead of Postgres/Testcontainers
- Outbox not drained to a live consumer
- No fault-injection for mid-transaction process crash
- With more time: Testcontainers Postgres, contract schemas (JSON Schema/OpenAPI), richer failure injection

## Responsible AI Usage
- Did you use AI tools? Yes Chatgpt
- Where did they help? Intial Shapes
- What you personally verify or correct: strategy/invariants, concurrency locking + idempotency re-check, running the suite, PR completeness

## Author Checklist
Linting passes (mvn spotless:check after apply)
Test suite passes
Schema/setup validation passes
Reliability-focused tests pass
README was tested from a clean setup
End-to-end transfer validation was run locally
