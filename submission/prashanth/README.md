# Subscription & Billing Service: Test Suite (Playwright + TypeScript)

## Run
```bash
npm install
npm test          # runs all 53 tests (~4 seconds), no browser needed
npm run report    # opens the HTML report
```
Reports: `playwright-report/index.html` (HTML) and `test-results/junit.xml` (for CI).

## Folder structure
```
src/                         the small billing service being tested
  stateMachine.ts            the table of allowed status changes
  plans.ts                   basic / pro prices and trial days
  paymentProvider.ts         interface for the payment company (faked in tests)
  database.ts                in-memory database + all data access (repository)
  billingService.ts          business logic: create, cancel, charge, webhooks
  server.ts                  HTTP routes + webhook signature check
tests/
  fixtures.ts                gives every test its own server, database, fake provider, clock
  helpers/
    clients.ts               ApiClient (calls the API), WebhookSender (signed webhooks)
    mockPaymentProvider.ts   fake payment company: succeed / decline / timeout, records calls
    builders.ts              test data builders
    given.ts                 ready-made starting states (active, past_due, canceled...)
    businessRules.ts         rules checked automatically after every test
    testClock.ts             fake time (end a trial instantly)
  1-api.spec.ts ... 6-end-to-end.spec.ts
```

## Where test data comes from
- **Customers:** `given.newCustomer()` adds one to the database.
- **Requests and webhooks:** builders, e.g. `aWebhook().paymentFailed().forInvoice(invoice)`.
- **Starting states:** `given.activePro()`, `given.pastDue()`... created through the real API.
- **Payment results:** `paymentProvider.willDecline()` / `willTimeout()`.
- **Time:** `clock.advanceDays(14)`.

Nothing needs cleaning up: each test's server and database are thrown away after it finishes.

See [APPROACH.md](./APPROACH.md) for the strategy, risks, assumptions and patterns.
