# Wallet Transfer Service — SDET Assignment Solution

**Candidate:** Parimal Jagtap
**Stack:** TypeScript + Playwright Test
**Approach:** Hybrid — minimal in-memory service fixture + full E2E test suite

---

## Quick Start

```bash
cd submission/solution-parimal-jagtap
npm install
npx playwright install
npm test
```

Tests start the service automatically, run all suites, and shut down cleanly.

---

## What's Inside

```
solution-parimal-jagtap/
├── service/
│   └── server.js              # Minimal wallet transfer service (in-memory)
├── tests/
│   ├── api/
│   │   └── contract.test.ts   # API contract, validation, idempotency replay
│   ├── database/
│   │   └── persistence.test.ts # DB invariants, balance conservation
│   ├── e2e/
│   │   └── transfer-flow.test.ts # Full path API → DB → audit → outbox
│   ├── concurrency/
│   │   └── race-conditions.test.ts # Duplicate in-flight, competing transfers
│   └── component/
│       └── outbox-audit.test.ts # Outbox exactly-once, audit trail
├── helpers/
│   ├── transfer-api-client.ts  # API wrapper
│   ├── db-assertions.ts        # Direct DB query helpers
│   └── test-data-factory.ts    # Isolated test data per test
├── fixtures/
│   └── base.ts                 # Shared Playwright fixtures (auto-reset DB)
├── config/
│   ├── global-setup.ts         # Starts service before tests
│   └── global-teardown.ts      # Stops service after tests
├── TEST_STRATEGY.md            # Full test strategy documentation
└── playwright.config.ts
```

---

## Running Specific Suites

```bash
npm run test:api          # API contract tests
npm run test:db           # Database persistence tests
npm run test:e2e          # End-to-end flow tests
npm run test:concurrency  # Race condition tests
npm run test:component    # Outbox and audit component tests
npm run report            # Open HTML test report
```

---

## Service Endpoints

The minimal service implements:

```
POST /transfers           — Create a wallet transfer
GET  /transfers/:id       — Get transfer by ID
GET  /wallets/:id         — Get wallet with current balance
POST /test/reset          — Reset DB between tests (test-only)
GET  /test/db/transfers/:id   — Direct DB read (test-only)
GET  /test/db/idempotency/:key — Idempotency store (test-only)
GET  /test/db/events/:id      — Audit log (test-only)
GET  /test/db/outbox/:id      — Outbox events (test-only)
```

---

## Seeded Test Wallets

| Wallet ID | Balance | Currency |
|---|---|---|
| wallet_001 | 10,000 | AED |
| wallet_002 | 5,000 | AED |
| wallet_003 | 0 | AED |

DB is reset before each test for full isolation.

---

## Design Decisions

1. **DB assertions are mandatory** — every test that changes state queries DB directly
2. **Full test isolation** — DB reset before each test, no shared state
3. **Concurrency tested with Promise.all()** — real simultaneous requests, not sequential
4. **Mutex per wallet pair** — prevents race conditions at balance update layer
5. **No fixed sleeps** — no async timing dependencies in this synchronous fixture
