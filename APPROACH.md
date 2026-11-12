

## 1. Assumptions

System under test
- The repo has no service, so I'm building a small Subscription & Billing service in TypeScript (option 3, hybrid). Only the payment provider is mocked.

Plans
- basic: 1900 cents, no trial. pro: 4900 cents, 14-day trial. Both bill every 30 days, USD only.
- Similar to the SaaS product I test at work: trial = trialing status, paid = basic or pro, free tier = no active subscription after cancel. Free is not a plan or a status, because canceled is final and active always needs a successful payment.

Lifecycle (only these 7 transitions are allowed, anything else is rejected)
- trialing to active: first charge succeeded
- trialing to past_due: first charge failed
- active to past_due: renewal charge failed
- past_due to active: retry succeeded
- past_due to canceled: retries exhausted
- active to canceled: cancel through API
- trialing to canceled: cancel through API

Rules
- Every subscription starts in trialing. Basic has a 0-day trial, so it's charged on create and returns active or past_due.
- Each billing attempt creates one invoice, and its id is the idempotency key sent to the provider.
- On timeout or pending, the invoice stays pending, the status doesn't change, and the webhook decides the result. No second charge.
- 3 failed attempts in a row cancel the subscription, counted from invoice rows so a duplicate webhook can't count twice.
- The API can cancel only from trialing or active. Cancelling past_due returns 409.
- A successful renewal keeps active and just extends the period end date.
- A refund marks the invoice refunded and is logged in the audit, with no status change.
- There's no real scheduler. Tests trigger billing with POST /internal/billing/run and a fake clock.

## 2. Scope

In scope: the 4 endpoints, the lifecycle and its 7 transitions, webhook signature, duplicate and out-of-order webhooks, provider success / decline / timeout, database and audit checks.

Out of scope: UI, performance, a real payment provider, notifications, proration, taxes, multi-currency.

## 3. Test levels

- Unit: state machine and plan rules
- API: request and response contract, validation errors, webhook signature and bad payloads
- State machine: all 7 valid transitions and at least 2 invalid ones
- Database: subscription, invoice, webhook event and audit rows after each step
- External integration: calls to the mocked provider and webhooks coming back from it
- End to end: full journeys from create to cancel

## 4. Real vs mocked

- Real: API (Express, called with Supertest), business logic, state machine, database (in-memory SQLite). These are what's under test, and the database gives real unique keys and transactions.
- Mocked: payment provider (MockPaymentProvider behind a PaymentProvider interface). There's no real provider, and I need to control success, decline, timeout and pending, and record every call.
- Simulated: webhooks (WebhookSimulator signs them with the shared secret), so the real signature check runs.
- Fake: clock, so a trial can end without waiting.

## 5. Design patterns

- State machine (transition table): illegal transitions can't happen by accident. Status only changes through it.
- Strategy for the payment provider: tests swap in the mock and set each charge result.
- Strategy for plans: price and trial rules live inside each plan, no if-else on plan names.
- Repository: one per table. The service and the tests use the same data access, no raw SQL in tests.
- Builder: for create requests, webhooks and customers, so test data is short and readable.

## 6. API contracts

POST /subscriptions with customer_id, plan, payment_method_id
- 201 with the subscription
- 400 missing or wrong field
- 422 unknown plan, unknown customer, or payment method not belonging to the customer

GET /subscriptions/{id}
- 200 with the subscription
- 404 if not found

POST /subscriptions/{id}/cancel
- 200 with status canceled
- 404 if not found
- 409 if already canceled or past_due

POST /webhooks/payment-provider (events: payment.succeeded, payment.failed, payment.refunded)
- 200 with outcome: processed, duplicate, ignored_stale, ignored_invalid_transition or ignored_unknown_reference
- 401 missing or wrong X-Provider-Signature
- 400 bad JSON, missing fields or unknown event type

The signature is HMAC-SHA256 of the raw body, checked before anything else. If it fails, nothing is saved.

Ignored webhooks still get 200 so the provider stops retrying. They're logged and nothing else changes.

## 7. Database

Tables checked
- subscriptions: status, plan and dates match the API after every step
- invoices: amount matches the plan price, one row per billing attempt, no duplicates
- webhook_events: one row per event_id, with its outcome
- subscription_events (audit log): full history, every step is an allowed transition
- customers and payment_methods: seed data only

Invariants checked after every test
- active always has at least one paid invoice
- nothing happens after canceled
- no duplicate event ids or idempotency keys
- provider calls equal the number of invoices
- invoice amount equals the plan price
- the API response equals the database row

Seed and cleanup
- Each test gets a fresh in-memory database with two customers (cust_001 with pm_test_visa_4242, cust_002 with pm_test_mc_5555).
- Everything else is created through the API, never inserted directly.
- The database is thrown away after each test, so there's no leftover data.
- Tests only look up their own subscription ids and use a fixed clock, so old data can't give a false pass.

## 8. Webhook and idempotency strategy

- Same event_id twice: caught by a unique key, returns duplicate, nothing changes.
- Same invoice with a new event_id, or payment.failed arriving after payment.succeeded: the invoice is already settled, so it returns ignored_stale and nothing changes.
- Each webhook is saved in one transaction (event, invoice, status, audit). If any step fails, all of it rolls back and the provider's resend works normally.

## 9. Known limitations

- Single process, so webhooks arriving at the exact same time aren't tested (bonus item).
- No real scheduler or payment provider; the provider's behaviour is assumed.
