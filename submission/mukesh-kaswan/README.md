# Subscription & Billing Service – Test Automation (Playwright + JavaScript)

## Run it

```bash
cd submission/mukesh-kaswan
npm install
npm test            # 50 API tests, ~1s, no browser download needed
npm run lint
npm run test:report # open the HTML report
```

Requires Node 20+. Nothing else is needed: no database server, no Docker, no secrets.

## Approach: Option 3 (Hybrid)

| Part | Real or fake | Why |
|---|---|---|
| HTTP API (Express) in `src/` | **Real**, started on a random port per test | We test real HTTP status codes, headers and JSON |
| Business rules + state machine | **Real** | This is what we want confidence in |
| Persistence (`BillingRepository`) | **Real, in-memory** | Same role as a DB, without setup friction. Tests read it through the repository, never through raw data |
| Payment provider | **Fake** (`FakePaymentProvider`) | External dependency. Tests choose success / decline / timeout and check the calls |
| Webhooks | **Simulated** by `WebhookBuilder` | Tests build signed, forged, unsigned and malformed payloads |

**Language:** JavaScript, with Playwright Test's built-in API testing (`APIRequestContext`).
Reason for JavaScript instead of TypeScript: Playwright with JavaScript is the stack I use
day to day for UI and API automation, and it needs no build or compile step (`npm test` runs the
source directly). Type-safety gaps are covered by exact response-shape assertions
(`toEqual` on the full API payload) and lint.

## Folder structure

```
src/                         System under test (minimal service fixture)
  app.js                     HTTP routes, webhook signature check + JSON parsing
  billingService.js          Business logic; transition() is the ONLY place status changes
  stateMachine.js            Lifecycle transition table
  repository.js              In-memory "database" (Repository pattern)
  paymentProvider.js         Payment provider contract (the seam)
  plans.js, signature.js, errors.js

tests/
  helpers/
    fixtures.js              Playwright fixtures: fresh db + fake provider + server per test
    BillingApiClient.js      API client (keeps HTTP details out of tests)
    FakePaymentProvider.js   Test double: configurable outcome, records calls
    builders.js              aSubscription(), aWebhook() Builders
    BillingAssertions.js     verify.* checks + global invariants run after every test
    BillingScenarios.js      given.* steps: active / past_due / canceled subscriptions
  specs/
    api-contract.spec.js     Create/get/cancel contract + validation errors
    lifecycle.spec.js        Every valid transition + invalid transitions
    webhooks.spec.js         Signature, malformed payload, idempotency, ordering, refunds
    payment-provider.spec.js Mock provider: args, call count, success/decline/timeout
    e2e.spec.js              Full journey with test.step()
```

## Design patterns (and the problem each solves)

| Pattern | Where | Problem it solves |
|---|---|---|
| **State machine (transition table)** | `src/stateMachine.js`, used only by `BillingService.transition()` | Status is never assigned ad hoc. Illegal transitions return `null` and are rejected in one place |
| **Builder** | `tests/helpers/builders.js` | Tests say *what* is different (`aWebhook().paymentFailed(sub, { finalAttempt: true })`) instead of repeating JSON literals and signing logic |
| **Dependency injection / Strategy** | `BillingService({ repository, paymentProvider })` + `FakePaymentProvider` | Tests swap in a fake provider. No network, full control over the outcome |
| **Repository** | `src/repository.js` | One place for data access. Tests check stored state with `db.invoicesFor(id)` and not with inline queries |
| **Fixtures (Playwright)** | `tests/helpers/fixtures.js` | Each test gets a new db, fake provider and server automatically, so tests are isolated and run in parallel |

### Is this the Page Object Model?
There is no UI, so there are no pages. The API equivalent of POM is used instead:
`BillingApiClient` is an "API object" (tests call `api.cancelSubscription(id)` and never build URLs),
and `BillingAssertions` / `BillingScenarios` keep checks and setup out of the spec files.
If a UI were added, page objects would sit beside the API client and reuse the same fixtures.

## API contract (as implemented by the fixture)

| Request | Success | Errors |
|---|---|---|
| `POST /subscriptions` `{customer_id, plan, payment_method_id}` | 201 + subscription | 400 `VALIDATION_ERROR` / `UNKNOWN_PLAN` / `INVALID_PAYMENT_METHOD` / `MALFORMED_JSON`, 404 `CUSTOMER_NOT_FOUND` |
| `GET /subscriptions/:id` | 200 | 404 `SUBSCRIPTION_NOT_FOUND` |
| `POST /subscriptions/:id/cancel` | 200 | 404, 409 `INVALID_TRANSITION` |
| `POST /webhooks/payment-provider` | 200 `{result}` where result = `processed`, `duplicate`, `ignored_stale`, `ignored_invalid_transition`, `ignored_no_paid_invoice`, `ignored_amount_mismatch`, `ignored_invoice_mismatch` | 401 `INVALID_SIGNATURE`, 400 `MALFORMED_PAYLOAD` / `INVALID_WEBHOOK_PAYLOAD` / `UNKNOWN_EVENT_TYPE`, 404 |

Plans: `basic` = $19.00 with a 14-day trial (no charge at creation). `pro` = $49.00 with no trial,
so it is charged immediately: success → `active`, decline or timeout → `past_due`.

## Persistence: entities and invariants

Entities checked: `subscriptions`, `invoices`, `webhook_events` (with `outcome` and `delivery_count`), and `audit_log`.

Checked inside tests (`verify.*`):
- the stored subscription row **equals** the API response, at every lifecycle step (`verify.subscriptionIs`)
- invoice rows and their statuses after each billing attempt (`verify.invoiceStatuses`)
- the audit trail records each transition exactly once (`verify.auditTrail`)
- duplicates and ignored webhooks are recorded in `webhook_events`, with no invoice or transition side effect

Checked automatically **after every test** (`assertGlobalInvariants`, auto fixture):
- an `active` subscription always has a successful (paid or refunded) invoice
- the subscription status equals the last audit entry (no status change without an audit record)
- `canceled_at` is set if and only if the status is `canceled`
- every invoice belongs to an existing subscription
- a paid (or refunded) invoice is for exactly the plan price
- the provider was never charged twice with the same idempotency key

**Seeding, cleanup and stale data:** each test builds a new repository, seeded only with
`cust_001` and `cust_002`. Nothing is shared between tests, so there is no cleanup step and
no stale data that could cause false positives.

## Webhook strategy

- **Request handling** (in `app.js`): HMAC-SHA256 over the *raw* body, compared in constant time.
  Tests cover a forged secret, a missing header, a body changed after signing, and malformed JSON.
- **Business handling** (in `BillingService.handleWebhook`):
  1. validate the payload
  2. if the `event_id` was already seen → increment `delivery_count` and return `duplicate` (no side effects)
  3. if the `invoice_id` belongs to a different subscription → `ignored_invoice_mismatch` (an invoice is never moved or overwritten)
  4. if the amount or currency differs from the plan price → `ignored_amount_mismatch` (an underpayment can't activate a subscription)
  5. if the invoice is already settled (paid or refunded) → `ignored_stale`. This covers out-of-order delivery in both directions: a late failure can't regress an active subscription, and a late success can't revive a `past_due` one
  6. if the state machine forbids the transition (e.g. anything on `canceled`) → `ignored_invalid_transition`
  7. otherwise write or update the invoice and transition the subscription

  Ignored events return **200**, so the provider stops redelivering them, and they are still recorded for audit.
- `payment.failed` with `final_attempt: true` while `past_due` means "retries exhausted" → `canceled`.
- `payment.refunded` marks the invoice `refunded` and does not change the subscription status (an assumption). Refunds skip the amount check (steps 4–5) because partial refunds are normal.

## Red → Blue → Green

Tests were written from the lifecycle diagram and the invariants list first (Red). The fixture
was then built to satisfy them (Blue), and repeated setup was refactored into Builders,
`given.*` steps and `verify.*` (Green). As a sanity check that the tests really catch bugs,
I temporarily removed the duplicate-`event_id` check, and separately allowed `canceled → active`.
Each change made 3 tests fail.

## Known limitations / next steps

- The in-memory store has no real DB constraints. The concurrency test passes because Node handles
  each webhook synchronously. A real DB would need a unique constraint on `event_id` or a row lock.
- No scheduler: renewals and retries arrive as provider webhooks. Retry counting is the provider's job (`final_attempt`).
- A `payment.succeeded` for a canceled subscription is ignored. A real system would also trigger a refund.
- No proration, plan changes, taxes or multi-currency (non-goals).
- Next steps: JSON-schema response validation (e.g. `ajv`) and a CI workflow.
