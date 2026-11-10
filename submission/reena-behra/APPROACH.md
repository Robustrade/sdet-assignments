# Test Approach: Subscription & Billing

## 1. What I am testing

A small **subscription billing** app (in `demo-app/`). It's simple on purpose, because the assignment is about the tests:

- A customer subscribes to a plan:
  - **basic**: free trial, no charge yet.
  - **pro**: charged $49.00 right away.
- Payments go through a **payment gateway**. In tests this is a **fake gateway**: the customer's test card decides the result, like Stripe test cards.

  | Card | Result |
  |---|---|
  | `card_ok` | succeeds |
  | `card_declined` | is declined |
  | `card_timeout` | gateway doesn't answer |

- The gateway can later send a **webhook** ("payment succeeded" or "payment failed"), signed with a shared secret.
- Everything is saved in a **SQLite database** with five tables: `customers`, `subscriptions`, `payments`, `webhook_events`, `status_history`.

### Subscription statuses

```
trialing ──► active ──► past_due ──► active
    │          │           │
    └──────────┴───────────┴──► canceled   (final: nothing can change it again)
```

- A declined payment moves the subscription to `past_due`.
- A successful payment moves it to `active`.
- 3 failed payments move it to `canceled`.
- The customer can cancel at any time.

### What is real and what is fake

| Part | Real or fake | Why |
|---|---|---|
| API (Express) | Real | We test real requests and responses |
| Database (SQLite) | Real | We check what is *actually* saved, not just what the API says |
| Payment gateway | **Fake** | Never charge real money; tests must control success, decline and timeout |
| Webhooks | **Sent by the tests** | So we can send duplicates, late events and fake signatures on purpose |

## 2. How I check things: three views must agree

For every important step, a test checks three things:

1. **API:** what the app returns.
2. **Database:** what is really saved. Tests read the DB directly through `tests/helpers/dbHelper.js`.
3. **Business rule:** what *should* happen. For example, "an active subscription must have a successful payment".

`expectApiAndDbToMatch()` does this in one call and is used after almost every step. It catches bugs where the API says one thing but the database says another.

## 3. Test scenarios

| # | Area | Scenario | What it proves |
|---|---|---|---|
| 1 | Create | Basic plan → trialing, no payment | No charge during a trial |
| 2 | Create | Pro plan → active, one payment of 4900 | Correct amount, gateway called once |
| 3 | Validation | Unknown plan, missing plan, unknown customer | Error returned, **nothing saved, nobody charged** |
| 4 | Duplicate request | Same `Idempotency-Key` sent twice | One subscription, one charge |
| 5 | Duplicate webhook | Same `eventId` sent twice | Processed once; second is recorded as a duplicate |
| 6 | Double click | Charge again while a payment is pending | Second call refused (409); no double charge |
| 7 | Failure | Declined card → past_due | Failed payment saved; no fake success |
| 8 | Retry | Card updated, retry → active | New attempt with its own key; history is correct |
| 9 | Retry limit | 3 declines → canceled | No more charges allowed |
| 10 | Partial failure | Gateway timeout → payment stays **pending**; webhook later completes it | We never guess the result; no double charge |
| 11 | Security | Webhook with wrong signature → 401 | Nothing saved |
| 12 | Validation | Webhook with missing fields → 400 | Nothing saved |
| 13 | Late event | Success webhook after cancel → ignored | Canceled stays canceled |
| 14 | Out of order | "failed" arrives after "succeeded" → ignored | A paid payment is never undone |
| 15 | Invalid action | Cancel twice → 409 | Status history unchanged |
| 16 | End to end | Declined → card updated → paid → duplicate webhook → canceled → late webhook | API and DB are checked after **every** step |

**Bonus (UI):** 3 Playwright UI tests on the public Sauce Demo shop (login, locked-out user, add to cart and checkout), using the Page Object Model.

## 4. How the app handles the tricky cases (and how tests prove it)

- **Duplicates**
  - Every webhook `eventId` is saved. If the same id arrives again, the app only increases `received_count`.
  - Create requests use an `Idempotency-Key` header, so sending the same request twice returns the first result.
- **Partial failure**
  - The payment row is saved as `pending` **before** the gateway is called.
  - If the gateway times out, the row stays `pending` and the status does not change. We don't know yet whether money was taken.
  - A later webhook settles it.
- **Out-of-order or late events**
  - A webhook only changes a payment that is still `pending`.
  - A canceled subscription ignores all later webhooks. Ignored events are still saved, for audit.
- **Transactions**
  - A payment update and its status change are saved together or not at all (`runInTransaction`).
  - Status changes go through one function, `changeStatus()`, which refuses changes the rules don't allow (for example canceled → active).

## 5. Test design

```
tests/
  helpers/
    apiHelper.js         calls the API (createCustomer, createSubscription, chargeSubscription ...)
    dbHelper.js          reads the database directly (read-only)
    webhookHelper.js     builds and signs webhook events, like the real gateway would
    consistencyCheck.js  expectApiAndDbToMatch(): API == DB == business rule
    testData.js          test cards and expected plan prices
  api/                   one file per topic: create, duplicates, failures, webhooks
  e2e/                   one full customer journey
  ui/                    bonus Sauce Demo UI tests (Page Object Model)
```

- **Independent tests:** every test creates its own customer, so tests can run in parallel and never depend on each other.
- **Clean start:** the database is recreated every time the app starts.
- **Readable:** tests use plain helper functions and `test.step`, so each test reads like a list of steps.
- **Expected values come from the requirements.** Prices are in `testData.js`, not copied from the app, so a wrong price in the app is caught.

## 6. How I checked that the tests work

I broke the app on purpose, one bug at a time, and ran the tests. Every bug was caught:

| Bug I added | Caught? |
|---|---|
| Removed the webhook duplicate check | ✅ |
| Let a canceled subscription be reactivated | ✅ |
| Let a late "failed" webhook overwrite a successful payment | ✅ |
| Removed the Idempotency-Key check | ✅ |
| Treated a gateway timeout as a decline | ✅ (6 tests failed) |

## 7. Limitations (what I would add with more time)

- The app runs as one process. I did not test two servers handling the same webhook at the same time.
- There is no real scheduler. "Charge now" is an API call, and trial end and renewal dates are not modelled.
- Webhooks have no timestamp, so very old replayed webhooks are not rejected.
- The test-only endpoint `/test-support/gateway-calls` exists only so tests can see what was sent to the fake gateway. A real app would not have it.
- Written in JavaScript to keep it simple and easy to read. TypeScript or JSDoc types would be the next step.
