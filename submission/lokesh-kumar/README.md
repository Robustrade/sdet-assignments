# Subscription & Billing Service: Test Automation (Kulu SDET assignment)

An object-oriented test framework, written in TypeScript, that validates a **Subscription & Billing Service** at four layers: API, state machine, database, and mocked payment provider. A minimal service fixture is included as the system under test.

See [STRATEGY.md](./STRATEGY.md) for the test strategy and design decisions.

## Requirements

- Node.js 20+ (developed on Node 26)
- npm

No database, Docker or open network port is needed. Persistence is in-memory, and the Express app is driven in-process by `supertest`.

## Run

```bash
npm install
npm test            # runs every spec (vitest)
npm run build       # strict type-check (tsc --noEmit)
npm run lint        # eslint
npm run validate    # lint + build + test
```

Each test builds its own Express app with a fresh in-memory database and its own fake payment provider, so tests are fully isolated and can run in parallel. There is nothing to seed or clean up by hand.

## Layout

```
src/                              system under test (minimal fixture)
  domain/SubscriptionStateMachine.ts   explicit transition table (the only way to change status; returns a Result)
  domain/plans.ts                      basic / pro plan config
  payment/PaymentProvider.ts           the seam: interface the service depends on
  persistence/                         in-memory tables + repositories
  webhook/                             payload validation + HMAC signature check
  SubscriptionService.ts               business logic
  app.ts                               Express app (routes, error handling, raw-body signature check)

tests/
  support/
    TestEnvironment.ts            factory: fresh app + DB + fake provider per test
    clients/ApiClient.ts          typed client built on supertest
    clients/WebhookSimulator.ts   signed / unsigned / forged / tampered deliveries
    doubles/FakePaymentProvider.ts  success / decline / timeout, records every call
    doubles/SteppingClock.ts      deterministic timestamps
    builders/                     test data builders (requests, webhooks, scenarios)
    repositories/                 read-only views of persisted state for verification
    assertions/                   ConsistencyVerifier, ProviderVerifier
  specs/
    stateMachine.spec.ts          every arrow, every rejected pair, exhaustive check
    api-contract.spec.ts          API shape, validation, webhook request handling
    lifecycle.spec.ts             all 7 transitions (API and webhook driven), invalid ones, plan rules
    webhook-idempotency.spec.ts   duplicates, out-of-order, rejected events, refunds
    provider-interaction.spec.ts  call count and arguments for success / decline / timeout
    e2e-flows.spec.ts             multi-step flows, verified after every step
```

## Fixture behaviour worth knowing

- Every subscription is created `trialing`. A plan with a trial (`pro`, 14 days) is billed when the trial ends. A plan without one (`basic`) is billed immediately at creation.
- `POST /internal/subscriptions/{id}/bill` is a **test hook** that runs one billing attempt (trial end, renewal or retry), standing in for a scheduler.
- Provider outcomes: `succeeded` and `declined` settle the invoice immediately. A **timeout** leaves the invoice `pending` (outcome unknown) and a later webhook settles it.
- A subscription moves to `canceled` after 3 consecutive failed charges (configurable).
