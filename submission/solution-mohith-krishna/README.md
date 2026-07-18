# Wallet Transfer Service — SDET Assignment

Automated test suite validating a Wallet Transfer Service across API, database, workflow, and cross-component layers.

## Prerequisites

- Node.js 18+
- npm 9+

## Setup

```bash
npm install
```

If `better-sqlite3` install scripts need approval:

```bash
npm approve-scripts better-sqlite3
```

## Running Tests

```bash
# Run all tests
npm test

# Run reliability/concurrency tests only
npm run test:reliability

# Run linter
npm run lint

# Validate database schema
node scripts/validate_schema.js
```

## Project Structure

```
├── src/service/           # Minimal Express + SQLite service fixture
│   ├── app.ts             # App factory with seed data
│   ├── db.ts              # Database schema and helpers
│   ├── types.ts           # Shared TypeScript interfaces
│   └── routes/
│       ├── transfers.ts   # POST /transfers, GET /transfers/:id
│       └── wallets.ts     # GET /wallets/:id
├── tests/
│   ├── setup/fixtures.ts  # Per-test app + DB + helpers factory
│   ├── helpers/
│   │   ├── apiClient.ts   # Supertest wrapper (transport abstraction)
│   │   ├── dbHelpers.ts   # Direct DB query helpers for assertions
│   │   └── builders.ts    # Test data factories
│   ├── api/               # (A) Happy path, (B) Validation, (C) Insufficient balance
│   ├── idempotency/       # (D) Duplicate submission — mandatory
│   ├── reliability/       # (E) Concurrency/race conditions — mandatory
│   ├── persistence/       # (F) DB state matches API outcome
│   └── crossComponent/    # (G) Audit events, outbox, exactly-once
├── docs/
│   └── TEST_STRATEGY.md   # Document-first test strategy
└── scripts/
    └── validate_schema.js # CI schema validation
```

## Test Coverage Summary

| Suite | Tests | Layer |
|---|---|---|
| Happy Path | 11 | API + DB + cross-layer |
| Validation | 14 | API + DB (absence checks) |
| Insufficient Balance | 9 | API + DB + invariants |
| Idempotency | 12 | API + DB + workflow |
| Concurrency | 7 | HTTP + DB + invariants |
| Persistence | 10 | DB + cross-layer |
| Audit & Outbox | 14 | Cross-component |
| **Total** | **77** | |

## Design Decisions

- **Option 3 (Hybrid)**: Minimal service fixture + full test suite — keeps focus on test engineering
- **In-memory SQLite**: Fresh DB per test for isolation; no Docker required
- **Supertest for API tests**: In-process, fast, no server startup
- **Real HTTP server for concurrency**: Avoids ECONNRESET issues with high-concurrency supertest
- **Builder pattern**: `buildTransferPayload()` with overrides reduces noise in test code
- **Separate assertion layers**: `ApiClient` for transport, `DbHelpers` for persistence queries
