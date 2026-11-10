# Subscription & Billing – End-to-End Tests

Playwright + JavaScript tests for a small subscription billing app. They check the **API**, the **database** and the **workflows**: duplicate requests, payment failures, retries, timeouts, and late or out-of-order webhooks.

## Run

You need Node.js **22.13 or newer**. The database is Node's built-in SQLite, so there's nothing else to install.

```bash
npm ci
npm test
```

`npm test` starts the demo app on port 4000, runs the 22 tests (19 API + 3 browser), and stops the app. The browser tests use Chromium; if it isn't installed yet, run `npx playwright install chromium` once. If you started the app yourself (`npm run start:app`), stop it first.

## Files

```
demo-app/server.js          the app under test: API + SQLite database + fake payment gateway
demo-app/public/index.html  a small "Subscribe" web page, used by the end-to-end tests
pages/SubscriptionPage.js   page object: all locators for the web page
api/subscriptionApi.js      all API calls (create, subscribe, retry, cancel, send webhook)
db/dbHelper.js              reads the database directly (read-only)
test-data/testData.js       test cards, plan names, expected price
tests/subscription.spec.js  all 22 tests, in 5 groups:
                              create subscription · duplicate requests · payment failures and retry ·
                              late and wrong-order webhooks · end-to-end (UI → API → database)
```

## The system under test

There was no service to test, so I built a small one in `demo-app/server.js`:

- **Plans:** `basic` is a free trial, so no payment is taken. `pro` is charged 4900 cents right away.
- **Database (SQLite):** four tables: `customers`, `subscriptions`, `payments`, `webhook_events`.
- **Fake payment gateway:** the customer's test card decides the result, so no real money is involved.

  | Card | Result |
  |---|---|
  | `card_ok` | success |
  | `card_declined` | failed |
  | `card_timeout` | no answer |

- **Webhooks:** the gateway later sends "payment succeeded" or "payment failed". The tests play the gateway and send these themselves.
- **Statuses:** `trialing` (basic), `pending` (pro, waiting for payment), `active`, `past_due` (payment failed), `canceled`.

## Test approach

**Main idea: the API and the database must agree.** The tests don't trust the API response alone. `expectApiMatchesDb()` (top of the test file) reads the database directly and checks that it matches what the API returned. The tests also check the business result, for example "exactly one payment of 4900".

| Area | Test | What it proves |
|---|---|---|
| Create | basic plan → trialing, no payment | no charge during a trial |
| Create | pro plan → active, one payment of 4900 | correct amount, charged once |
| Create | unknown plan → 400 | nothing saved for a bad request |
| Create | unknown customer → 404 | nothing saved, no crash |
| Not found | charge or cancel an unknown subscription → 404 | clear error, no crash |
| Duplicates | same `Idempotency-Key` twice | one subscription, one payment |
| Duplicates | same webhook twice | processed once, second answered as "duplicate" |
| Duplicates | two customers send the same `Idempotency-Key` | each gets their own subscription (keys are per customer) |
| Failures | declined card → past_due | failed payment saved, no fake success |
| Retry | change card, retry → active | payments are `failed`, then `success` |
| Retry limit | 3 declined payments → canceled; 4th try → 409 | retries stop |
| Partial failure | timeout → payment stays `pending`; second charge refused; webhook later makes it active | we never guess, and never charge twice |
| Webhooks | success webhook after cancel → ignored | canceled stays canceled |
| Webhooks | "failed" after "succeeded" → ignored | a paid payment is never undone |
| Webhooks | webhook with another subscription's payment → ignored | one subscription can't settle another's payment |
| Webhooks | unknown subscription → ignored (200); missing fields → 400; unknown event type → ignored | bad webhooks never crash the app or change data |
| Cancel | cancel twice → 409 | a canceled subscription can't be canceled again |
| End-to-end | subscribe in the browser with a working card → page, API and DB all say `active` | the whole flow works from the user's click to the database |
| End-to-end | subscribe in the browser with a declined card → page shows `past_due`, failed payment saved | failures show correctly to the user and in the DB |
| End-to-end | cancel in the browser → `canceled` in page and DB | user actions are really saved |

### How the app handles the hard cases
- **Duplicate request:** the `Idempotency-Key` header. The same key from the same customer returns the first result.
- **Duplicate webhook:** each `eventId` is saved once. If it comes again, nothing is done.
- **Timeout (partial failure):** the payment is saved as `pending` *before* the gateway is called, and stays pending until the webhook arrives.
- **Late or out-of-order webhook:** a webhook only changes a payment that is still `pending`, belongs to that subscription, and is on a subscription that isn't canceled.
- **Retry limit:** after 3 failed payments the subscription is canceled.
- **Transactions:** the payment result, the subscription status and the webhook record are saved together (`saveTogether`, with rollback on error), so the data is never half-updated.

### How I checked the tests work
I broke the app on purpose, 11 times, one bug at a time. The tests caught every one:
- removed the duplicate-webhook check;
- let a canceled subscription be reactivated;
- let a late "failed" undo a success;
- treated a timeout as a failure;
- let a webhook use another subscription's payment;
- never ended retries;
- shared Idempotency-Keys between customers;
- processed unknown event types;
- removed the 404 on charge;
- removed the customer check;
- removed the webhook field check.

### Limitations
- One app process only. Two servers handling the same webhook at the same time are not tested.
- Webhooks are not signed. A real app must check the gateway's signature (HMAC) to reject fake webhooks.
- There is no scheduler for monthly renewals.
