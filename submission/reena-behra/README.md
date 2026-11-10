# Subscription & Billing – End-to-End Test Suite

Playwright + JavaScript tests for a small subscription billing app. They check the **API**, the **database** and the **workflows**: duplicates, retries, partial failures, and late or out-of-order webhooks.

The test strategy and the full scenario list are in **[APPROACH.md](./APPROACH.md)**.

## Requirements

- Node.js **22.13 or newer** (uses the built-in `node:sqlite`, so there's no database to install)
- For the bonus UI tests only: a Chromium browser, installed with `npx playwright install chromium`

## Run

```bash
npm ci
npm test            # API + DB + workflow tests (19 tests, about 2 seconds)
npm run test:ui     # bonus: Sauce Demo UI tests (needs internet)
npm run test:all    # everything
npm run report      # open the HTML report
```

`npm test` starts its own copy of the demo app on `http://localhost:4000` and stops it afterwards. If port 4000 is busy (for example you ran `npm run start:app`), stop that app or use another port: `PORT=4100 npm test`.

## Project layout

```
demo-app/                 the app under test (Express + SQLite)
  server.js               API routes, charging and webhook logic
  database.js             tables + runInTransaction()
  statusRules.js          which status changes are allowed
  plans.js                plan prices
  fakePaymentGateway.js   fake gateway driven by test cards
  signature.js            webhook signature (HMAC)
tests/
  helpers/                apiHelper, dbHelper, webhookHelper, consistencyCheck, testData
  api/                    01 create · 02 duplicates · 03 payment failures · 04 webhooks
  e2e/                    full customer journey
  ui/                     bonus Sauce Demo tests + page objects
```

## API of the demo app

| Method | Path | Purpose |
|---|---|---|
| POST | `/customers` | create a customer `{ name, card }` |
| PUT | `/customers/:id/card` | change the customer's card |
| POST | `/subscriptions` | subscribe `{ customerId, plan }`; optional `Idempotency-Key` header |
| GET | `/subscriptions/:id` | read a subscription |
| GET | `/subscriptions/:id/payments` | list its payments |
| POST | `/subscriptions/:id/charge` | charge now (trial end or retry) |
| POST | `/subscriptions/:id/cancel` | cancel |
| POST | `/webhooks/payment` | gateway webhook, header `x-signature` |
| GET | `/test-support/gateway-calls` | test-only: what was sent to the fake gateway |
