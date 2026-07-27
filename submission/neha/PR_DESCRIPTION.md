## Summary
Implemented a multi-layer automated test suite for a Wallet Transfer Service using a minimal Flask + SQLite fixture. Coverage includes API validation, persistence invariants, idempotency, concurrency, and audit/outbox side effects.

Understanding / approach (email requirement): see `submission/neha/UNDERSTANDING_AND_APPROACH.md`.

## Test Strategy
- Levels covered: API, workflow, database, cross-component (audit + outbox)
- In scope: happy path, validation failures, insufficient balance, idempotency, concurrency/retries, outbox/audit exactly-once writes
- Out of scope: UI, load testing, real message brokers, auth
- What is real vs stubbed/mocked: real HTTP API + SQLite tables; broker consumer stubbed (outbox rows only)

## API Validation Approach
- How requests/responses are validated: TransferApiClient + status/payload assertions
- Which failure scenarios are covered: missing fields, invalid currency, zero/negative amount, same source/destination, unknown wallet, insufficient balance
- How duplicate behavior is verified: same key/same payload → 200 replay with same transfer id; same key/different payload → 409 with no extra debit

## Database Validation Approach
- Which tables are checked: wallets, transfers, idempotency_keys, audit_events, outbox_events
- Which invariants are asserted: exact balance movement, no mutation on reject, single transfer/side-effect rows on replay
- How test data is seeded and cleaned: fresh in-memory DB + seeded wallets per test; connection closed after yield

## Cross-Component Validation
Audit and outbox rows are asserted for count, event type, and absence on rejected/replayed paths.

## Reliability / Concurrency Coverage
- Duplicate request scenarios: sequential and concurrent same-key storms
- Retry safety scenarios: five identical retries settle to one debit
- Concurrency/race scenarios: five competing 3000 transfers against 10000 balance
- What confidence these tests provide: process-local race safety and exactly-once side effects under the fixture’s locking model

## Test Architecture
Layered helpers keep scenarios readable: builders (payloads/keys), API client (transport), DB assertions (invariants). Scenario modules map 1:1 to risk categories.

## Validation
```bash
cd submission/neha
python scripts/validate_schema.py
pytest -q
pytest -q -m reliability
ruff check .
black --check .
```

## Known Limitations / Next Steps
- Single-process SQLite concurrency, not multi-node distributed locking
- Outbox not drained by a worker
- Would add crash/partial-commit harness and contract schema checks with more time

## Responsible AI Usage
- Did you use AI tools? Yes (Cursor)
- Where did they help? scaffolding service fixture, test helpers, and documentation drafts
- What you personally verify or correct: run full local CI-equivalent checks; review assertions for invariant correctness; adjust schema (separate idempotency_keys + outbox) and architecture layering beyond the sample

## Author Checklist
- [x] Linting passes
- [x] Test suite passes
- [x] Schema/setup validation passes
- [x] Reliability-focused tests pass
- [x] README was tested from a clean setup
- [x] End-to-end transfer validation was run locally
