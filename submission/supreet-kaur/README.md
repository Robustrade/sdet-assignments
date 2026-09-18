# Subscription & Billing Service — SDET Take-Home Solution

Automated validation suite (and the minimal service fixture it validates) for the Kulu SDET
take-home assignment. See [`DESIGN.md`](./DESIGN.md) for the test strategy and
[`PR_DESCRIPTION.md`](./PR_DESCRIPTION.md) for the full write-up (this is what should become the
actual GitHub PR description).

> **Before you open a PR:** rename this `submission/candidate-name/` folder to
> `submission/<your-actual-name>/`, and use branch name `solution/<your-actual-name>` per the
> root [README.md](../../README.md).

## Requirements

- Node.js 20+ (uses the built-in `node:test` runner and global `fetch`)
- No database, Docker, or external services needed — persistence is in-memory.

## Install & run

```bash
npm install
npm run build   # type-check only (tsc --noEmit)
npm test        # runs the full suite (48 tests across 9 suites)
```

`npm test` uses Node's built-in test runner with the `tsx` loader for TypeScript — no Jest/Babel
config to go stale. See `DESIGN.md` §"What is real vs. mocked" and the comment at the top of
`src/api/server.ts` for why this stack was chosen over the suggested Jest/Supertest.

## Project layout

```
src/
  domain/            Subscription, Invoice, Plan, WebhookEventRecord, the State-pattern lifecycle
  domain/states/      TrialingState / ActiveState / PastDueState / CanceledState
  providers/          PaymentProvider interface + MockPaymentProvider test double
  persistence/        InMemoryDatabase + Subscription/Invoice/WebhookEvent repositories
  security/           HMAC webhook signature signing/verification
  service/            SubscriptionService - the orchestration seam
  api/                Plain node:http route handlers (POST/GET subscriptions, cancel, webhook)

test/
  support/            TestFixture (env setup + isolation), ApiClient, data Builders, assertions
  api/                 API contract + validation + webhook request-handling tests
  state-machine/       Every valid transition (1 test each) + invalid-transition tests
  database/             Persistence / invariant tests
  provider/              Mock payment provider interaction tests
  webhooks/               Idempotency + out-of-order delivery tests (mandatory category)
  e2e/                    Multi-step, cross-cutting customer journeys
```

## Running a single suite

```bash
node --import tsx --test test/webhooks/idempotency-and-ordering.test.ts
```
