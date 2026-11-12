# Subscription & Billing – SDET Assignment

Sharmila Gajendran

A small Subscription & Billing service written in TypeScript, plus the test framework that validates it. The payment provider is the only thing that's mocked. My assumptions, scope and design choices are in [APPROACH.md](./APPROACH.md).

## How to run

You need Node.js 20, 22 or 24 (LTS). Nothing else needs to be installed: the database is in-memory SQLite.

```bash
cd submission/sharmila-gajendran
npm install
npm test                 # all tests
npm run build            # type check (tsc --noEmit)
npm run lint             # ESLint
npm run validate-schema  # database schema checks only
npm run validate         # lint + type check + tests
```

Every test builds its own fresh database, so there's no setup or cleanup step, and tests can run in any order.

## What's real and what's mocked

- **Real:** the Express API (called in-process through Supertest), the business logic and state machine, and the SQLite database.
- **Mocked:** the payment provider (`MockPaymentProvider`, plugged in through the `PaymentProvider` interface).
- **Simulated:** provider webhooks (`WebhookSimulator` signs them with the shared secret using its own HMAC code).
- **Fake:** the clock, so a trial can end or a renewal can come due without waiting.
- **Test-only endpoint:** `POST /internal/billing/run` stands in for a scheduler, so tests decide when billing happens.

## Folder structure

```
src/                         the service
  app.ts                     createApp(): wires everything together (dependency injection)
  domain/                    state machine, plans, errors, clock, ids
  services/                  subscription, billing, webhook, payment settlement, lifecycle
  persistence/               schema + one repository per table
  providers/                 PaymentProvider interface (the seam for the mock)
  http/                      request parsing, signature check, error mapping, response shape

tests/
  support/                   the framework
    testContext.ts           fresh DB + mock + clock + app per test; runs invariants after each test
    clients/                 typed API client (specs never build HTTP requests)
    mocks/                   MockPaymentProvider, WebhookSimulator, fault injection
    builders/                subscription request, webhook event, customer
    verifiers/               DbVerifier, ProviderVerifier, InvariantChecker
    steps/                   reusable "given" steps (activeBasic, pastDueBasic, ...)
    testData.ts              expected prices, trial lengths, seeded customers
    expectedLifecycle.ts     the 7 allowed transitions, written out independently
  unit/                      state machine, plans
  schema/                    database constraints
  api/                       create/get/cancel contract and validation, webhook security
  lifecycle/                 every valid transition, invalid transitions
  billing/                   declines, timeouts, renewals, refunds, retries
  webhooks/                  duplicates, out-of-order, partial failure
  provider/                  call count and arguments
  e2e/                       full journeys
```

## Where each scenario group is

| Group | What it covers | File |
|---|---|---|
| A | Creation and activation | `tests/api/createSubscription.spec.ts` |
| B | Validation failures | `tests/api/createSubscription.spec.ts`, `tests/lifecycle/invalidTransitions.spec.ts` |
| C | Payment failure, timeout, refund | `tests/billing/paymentOutcomes.spec.ts` |
| D | Duplicate webhooks | `tests/webhooks/idempotency.spec.ts` |
| E | State machine (valid and invalid) | `tests/lifecycle/*.spec.ts`, `tests/unit/subscriptionStateMachine.spec.ts`, `tests/webhooks/outOfOrder.spec.ts` |
| F | Provider interaction | `tests/provider/providerInteraction.spec.ts` |
| G | Database and audit, partial failure | `tests/e2e/journeys.spec.ts`, `tests/webhooks/partialFailure.spec.ts`, invariants after every test |
| S | Webhook signature and payload | `tests/api/webhookSecurity.spec.ts` |
| J | End-to-end journeys | `tests/e2e/journeys.spec.ts` |

## Checks that run after every test

`InvariantChecker` runs after every test, on every subscription the test created:

- an `active` subscription has at least one successful payment (paid, or paid and later refunded)
- `canceled_at` is set only when the status is `canceled`
- every invoice charges the plan's price
- the audit log starts at `trialing`, every entry follows on from the previous one, every status change is one of the 7 allowed transitions, and it ends at the current status
- the GET response matches the database row
- no duplicate webhook event ids or idempotency keys
- provider calls match invoices one to one

## Notes

- Expected prices, trial lengths and allowed transitions are written out in `tests/support`, not imported from `src/`. If the service had a wrong value, reusing it would hide the bug.
- The schema spec is the only place with raw SQL, because it tests the database constraints themselves.
- If `npm install` fails on `better-sqlite3`, you're probably on a Node version without a prebuilt binary. Switch to an LTS version (20, 22 or 24).
