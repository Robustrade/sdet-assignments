# Subscription & Billing Service — validation suite

A minimal subscription-billing service fixture (`src/`) and an object-oriented test framework
(`test/`) that validates it at the API, state-machine, persistence and provider-integration levels.

* Strategy, assumptions, contracts, invariants: **[docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md)** (written before the code)
* PR description: **[PR_DESCRIPTION.md](PR_DESCRIPTION.md)**

## Run it

Requires Node.js ≥ 20 (developed on 22). No database server, no native build step, no network.

```bash
npm ci
npm run verify          # lint + type check + schema validation + full test suite
```

Or individually:

```bash
npm test                # vitest run — 142 tests, ~5 s
npm run lint            # eslint
npm run build           # tsc --noEmit
npm run validate-schema # builds the schema in a scratch DB and checks tables/indexes/triggers vs. the state machine
npm run test:report     # runs the tests and writes an HTML report to reports/test-report.html
```

`test:report` writes the report even when tests fail (failed tests open automatically with their error
message) and exits with the test run's exit code. `reports/` is git-ignored.

## Persistence setup and seed data

There is nothing to set up. Each test calls `TestEnvironment.create()` (via `useTestEnvironment()`),
which opens a **new in-memory SQLite database** (sql.js / WASM), applies `src/persistence/schema.ts`,
and seeds `allowed_status_transitions` from the TypeScript state machine. Customers and payment methods
are seeded per test with `env().seed.customer(aCustomer()...)`; every other row is produced by driving the
service through its API, billing job and webhooks. The database is discarded after the test, so there is
no cleanup and no state shared between tests or files.

## Layout

```text
src/                                   service fixture (system under test)
  domain/SubscriptionStateMachine.ts   transition table — the only authority on status changes
  domain/SubscriptionLifecycle.ts      applies a trigger + audit entry + notification
  billing/                             BillingService (scheduler logic), PaymentOutcomeHandler (shared by sync + webhook paths)
  plans/PlanPolicy.ts                  Strategy per plan + PlanCatalog
  payments/PaymentProvider.ts          provider interface (the mock seam)
  persistence/                         schema, Database wrapper, repositories
  webhooks/WebhookService.ts           signature verification, payload schema, idempotent processing
  http/app.ts                          Express routes
test/support/                          the framework
  env/TestEnvironment.ts               Facade: fresh DB + FakeClock + MockPaymentProvider + app per test; invariants in afterEach
  api/                                 HttpClient (transport), SubscriptionApiClient (typed), strict zod contracts
  provider/MockPaymentProvider.ts      scripted outcomes (succeed/decline/pending/timeout/hold), call recording
  webhooks/WebhookSimulator.ts         signed / unsigned / wrong-secret / tampered / malformed deliveries
  builders/                            Customer, SubscriptionRequest, WebhookEvent builders
  scenarios/LifecycleDriver.ts         "given" steps that reach each state via the public API only
  persistence/PersistenceInspector.ts  read-only repository over the DB for assertions
  assertions/                          expectSubscriptionState (API + DB), expectCharges, invariant rules + checker
test/specs/                            api · lifecycle · webhooks · provider · persistence · e2e
```

## Writing a new scenario

```ts
const env = useTestEnvironment();

it('a refund does not change status', async () => {
  const active = await env().given.active();                                   // reach state via the API
  const invoice = await env().given.latestInvoice(active.id);
  await env().webhooks.deliverOk(WebhookEventBuilder.paymentRefunded(invoice)); // signed webhook
  await expectSubscriptionState(env(), active.id, { status: 'active', invoices: ['refunded'] }); // API and DB
});                                                                              // + all invariants, automatically
```
