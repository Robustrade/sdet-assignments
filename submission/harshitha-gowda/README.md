# Subscription & Billing Service: SDET Assignment

A layered, object-oriented test framework for a Subscription & Billing Service, plus a minimal service fixture (Option 3, hybrid).

## Run

```bash
npm install
npm test          # 56 tests, ~2s
npm run typecheck
```

Requires Node >= 22.5 (uses the built-in `node:test` runner and `node:sqlite`; no Jest/Vitest, no native modules, so setup is `npm install` and go).
No seed step: every test starts a fresh in-memory SQLite DB, seeded with customers `cust_001`, `cust_002` by `TestEnvironment.start()`.

## Layout

```
src/                       Service fixture (system under test)
  state-machine.ts           Explicit transition table, the only way to change status
  plans.ts                   PlanPolicy / PlanCatalog (price + trial rules in one place)
  payment-provider.ts        PaymentProvider interface (the seam)
  billing-service.ts         Business logic, transactions, idempotency
  server.ts                  HTTP routes + HMAC signature check
  db.ts                      Schema: subscriptions, invoices, webhook_events, subscription_events
tests/framework/           Test framework (no assertions about business rules hidden here except invariants)
  TestEnvironment.ts         Isolated world per test + state Factory + cross-cutting invariants
  ApiClient.ts               Typed HTTP client
  MockPaymentProvider.ts     Test double: success/decline/timeout, call recording
  WebhookSimulator.ts        Signed / unsigned / forged / tampered / malformed requests
  builders.ts                SubscriptionRequestBuilder, WebhookEventBuilder
  repositories.ts            Read-only repositories over every table (no SQL in specs)
tests/specs/               Scenarios grouped by intent
  api.spec.ts                Contracts, validation, webhook request handling
  lifecycle.spec.ts          All 7 transitions + invalid ones + plan rules + timeouts
  webhooks.spec.ts           Idempotency, out-of-order, refunds, concurrency (bonus)
  provider-interaction.spec.ts  Call count/args, "no call when no charge due", success/decline/timeout matrix
docs/APPROACH.md           Strategy written BEFORE the implementation (dummy-PR content)
```
