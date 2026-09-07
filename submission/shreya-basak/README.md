# Subscription & Billing Service — Test Automation Solution

Solution for the Kulu SDET take-home assignment.

## What this is

This is a **test fixture + automated test framework**, not a production service. It includes:
- a minimal in-process Subscription & Billing service (`src/domain`, `src/persistence`, `src/http`, `src/webhooks`) built only as far as needed to give the test suite something real to validate
- a test suite (`tests/`) covering API, state-machine, persistence, mock-provider, and end-to-end levels

See `TEST_STRATEGY.md` for the full design write-up and `PR_DESCRIPTION.md` for the filled-out PR description.

## Setup

```bash
npm install
```

## Running the tests

```bash
npm test         # run the full suite
npm run build     # type-check only (tsc --noEmit)
npm run lint       # eslint
```

No database or external services are required — persistence is in-memory and rebuilt fresh per test via `createTestContext()`, so tests are isolated and order-independent by construction.

## Project layout

```
src/
  domain/          subscription lifecycle: state machine, plans, payment-provider interface, orchestrating service
  persistence/      repository interfaces + in-memory implementations (customers, subscriptions, invoices, webhook events, audit log)
  webhooks/         HMAC signature signing/verification
  http/             Express app exposing the 4 required endpoints
  testUtils/         API client, builders, mock payment provider, fixture seeder, test-context factory
tests/
  api/               subscription CRUD + webhook endpoint request handling (signature/shape)
  stateMachine/       pure state-machine transition unit tests
  persistence/         DB-level assertions (customers, subscriptions, invoices, webhook_events, audit log)
  provider/            mock payment provider call-count/argument/outcome tests
  e2e/                  full lifecycle flows, start to finish, plus bonus concurrent-delivery coverage
```
