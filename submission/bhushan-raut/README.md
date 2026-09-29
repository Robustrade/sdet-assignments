# Subscription & Billing Service: automated validation suite

A small Subscription & Billing Service fixture (Express + SQLite) and an object-oriented test framework that validates it at the API, state-machine, persistence and payment-provider levels.

The design, assumptions, invariants and scenario catalogue are in **[STRATEGY.md](STRATEGY.md)**. This file covers how to run it.

## Prerequisites

- **Node.js 24 or later.** Persistence uses Node's built-in `node:sqlite`, so there is no native module to compile and no database to install.
- npm (ships with Node).

## Setup and run

```bash
cd submission/bhushan-raut
npm ci
npm run validate      # lint + typecheck + full test suite
```

Individual commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the whole suite once (Vitest). Takes a few seconds, with no external services. |
| `npm run test:watch` | Re-runs tests on change. |
| `npm run typecheck` | `tsc --noEmit` in strict mode. This also proves the `@ts-expect-error` check that a `Transition` cannot be hand-built. |
| `npm run lint` | ESLint (typescript-eslint). |

Run one area: `npx vitest run test/specs/webhooks`.

## Persistence setup, seeding and cleanup

There is nothing to set up by hand.

- **Schema.** `src/persistence/schema.ts` is applied by `openDatabase()` to a fresh `:memory:` SQLite database.
- **One database per test.** `useTestEnvironment()` creates a new `TestEnvironment` in `beforeEach`: new database, mock provider, fake clock and notifier. It closes it in `afterEach`. Nothing is shared between tests, so there is no cleanup step and no stale data.
- **Seeding.** Customers and payment methods are reference data outside this service's API. They are inserted with `env().seedCustomer()`, using `CustomerBuilder` for unique IDs. Subscriptions, invoices and events are **never** inserted directly. `Given` drives them into a start state through the public API and the mock provider.
- **Teardown checks.** After every test, `InvariantChecker` runs the global invariants (INV-1 to INV-7) against the whole database. The test also fails if the mock provider was left holding a scripted outcome that was never used.

## What is real and what is a test double

| Real (the system under test) | Test double |
|---|---|
| Express routing and status codes (driven through Supertest), state machine, plan policies, SQLite persistence with real constraints, HMAC signature verification | `MockPaymentProvider` (scripted success, decline or timeout; records calls), `WebhookSimulator` (the provider's webhook sender), `FakeClock`, `SpyNotifier` |

## Layout

```text
src/                       service fixture (the SUT)
  domain/                  SubscriptionStateMachine (transition table), PlanCatalog (plan policies)
  provider/                PaymentProvider interface: the seam the mock replaces
  persistence/             schema + repositories
  services/  http/         business logic and the Express app
test/framework/            the test framework
  env/                     TestEnvironment (per-test factory), Given (start states via the API)
  clients/                 typed API and webhook clients
  doubles/                 mock provider, webhook simulator, fake clock, spy notifier
  builders/                customer, subscription request and webhook payload builders
  verify/                  DbInspector (independent SQL), SubscriptionAssertions, InvariantChecker
test/specs/                scenarios, grouped by concern
```

| Spec folder | Covers (brief section) |
|---|---|
| `api/` | Creation, retrieval, validation failures with no side effects (A, B) |
| `lifecycle/` | Every valid transition, all invalid pairs, billing rules, retries, cancel (C, E) |
| `webhooks/` | Signature and malformed-payload handling, idempotency, out-of-order and stray events, refunds (D, E, F) |
| `provider/` | Call count and exact arguments, and when the provider must **not** be called (F) |
| `e2e/` | Full journey with API = DB checked at every step (G) |
| `concurrency/` | Bonus: overlapping requests for one subscription, forced deterministically |
