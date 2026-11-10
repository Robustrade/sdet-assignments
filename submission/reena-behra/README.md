# Subscription & Billing – End-to-End Tests

Playwright + JavaScript tests for a small subscription billing app. They check the **API**, the **database** and the **workflows**: duplicate requests, payment failures, retries, timeouts, and late or out-of-order webhooks.

## Run

You need Node.js **22.13 or newer**. The database is Node's built-in SQLite, so there's nothing else to install.

```bash
npm ci
npm test
```

`npm test` starts the demo app on port 4000, runs the 11 tests, and stops the app. If you started the app yourself (`npm run start:app`), stop it first.

## Files

```
demo-app/server.js        the app under test: API + SQLite database + fake payment gateway
tests/helpers.js          helpers: call the API, read the database, send webhooks, compare API with DB
tests/api/
  1-create-subscription   basic trial, pro payment, unknown plan
  2-duplicate-requests    same request twice, same webhook twice
  3-payment-failures      declined card, retry, gateway timeout
  4-webhooks              late webhook, out-of-order webhook, cancel twice
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

**Main idea: the API and the database must agree.** The tests don't trust the API response alone. `expectApiMatchesDb()` reads the database directly and checks that it matches what the API returned. The tests also check the business result, for example "exactly one payment of 4900".

| Area | Test | What it proves |
|---|---|---|
| Create | basic plan → trialing, no payment | no charge during a trial |
| Create | pro plan → active, one payment of 4900 | correct amount, charged once |
| Create | unknown plan → 400 | nothing saved for a bad request |
| Duplicates | same `Idempotency-Key` twice | one subscription, one payment |
| Duplicates | same webhook twice | processed once, second answered as "duplicate" |
| Failures | declined card → past_due | failed payment saved, no fake success |
| Retry | change card, retry → active | payments are `failed`, then `success` |
| Partial failure | timeout → payment stays `pending`; second charge refused; webhook later makes it active | we never guess, and never charge twice |
| Webhooks | success webhook after cancel → ignored | canceled stays canceled |
| Webhooks | "failed" after "succeeded" → ignored | a paid payment is never undone |
| Cancel | cancel twice → 409 | a canceled subscription can't be canceled again |

### How the app handles the hard cases
- **Duplicate request:** the `Idempotency-Key` header. The same key returns the first result.
- **Duplicate webhook:** each `eventId` is saved once. If it comes again, nothing is done.
- **Timeout (partial failure):** the payment is saved as `pending` *before* the gateway is called, and stays pending until the webhook arrives.
- **Late or out-of-order webhook:** a webhook only changes a payment that is still `pending`, on a subscription that isn't canceled.
- **Transactions:** the payment result and the subscription status are saved together, with a rollback on error, so the data is never half-updated.

### How I checked the tests work
I broke the app on purpose, 7 times, one bug at a time. The tests caught every one:
- removed the duplicate-webhook check;
- let a canceled subscription be reactivated;
- let a late "failed" undo a success;
- removed the Idempotency-Key check;
- treated a timeout as a failure;
- allowed charging while a payment is pending;
- allowed canceling twice.

### Limitations
- One app process only. Two servers handling the same webhook at the same time are not tested.
- Webhooks are not signed. A real app must check the gateway's signature (HMAC) to reject fake webhooks.
- There is no scheduler for monthly renewals.
