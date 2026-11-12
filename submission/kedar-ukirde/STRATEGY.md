# Validation strategy

## System assumptions and scope

There is no service implementation in the supplied repository. This submission builds a deliberately small Express service fixture so the automation can exercise real HTTP parsing, validation, signature verification, lifecycle rules, and persistence boundaries. It is not intended as a production billing system.

The suite covers subscription creation/retrieval/cancellation, plan trial and price rules, payment success/decline/timeout outcomes, signed and malformed webhooks, duplicate and stale delivery, and persisted subscriptions, invoices, webhook receipts, and audit events. Tax, proration, external network integrations, and performance are out of scope.

## Test levels and doubles

- API/integration: Supertest sends HTTP requests to the actual Express application.
- Domain/state: an explicit transition table owns allowed state changes.
- Persistence: an isolated in-memory repository is queried through a repository facade after every meaningful stage.
- External provider: an injected provider interface is implemented by a configurable recording fake. No real payment network is called.
- Webhook simulator: tests construct raw JSON and HMAC signatures; malformed and unsigned requests are also sent through HTTP.

## Patterns and architecture

- State machine (`SubscriptionLifecycle`): centralizes legal transitions and prevents ad hoc status mutation.
- Builder (`SubscriptionRequestBuilder`, `WebhookBuilder`): keeps scenario intent readable while supporting invalid inputs.
- Strategy / dependency injection (`PaymentProvider`): the fake selects success, decline, or timeout and records exact charge arguments.
- Repository (`BillingRepository`): isolates storage and gives assertions queryable persisted state.
- Fixture (`BillingFixture`): creates fresh app, repository, provider, API client, and verification helpers for each test.

## Contracts and persistence invariants

`POST /subscriptions` accepts `{customer_id, plan, payment_method_id}`, returns 201 and a subscription. `GET /subscriptions/:id` returns the persisted subscription. `POST /subscriptions/:id/cancel` transitions trialing/active to canceled; repeated cancellation returns 409. `POST /webhooks/payment-provider` accepts payment.succeeded, payment.failed, and payment.refunded with `X-Provider-Signature` over the exact raw request bytes.

The repository stores subscriptions, invoices, webhook event receipts (including duplicate receipts marked ignored), and per-subscription audit events. Assertions require API state to match storage, active state to have successful payment evidence, duplicate delivery to have no duplicate invoice or transition, canceled state to remain terminal, and provider calls to correspond one-for-one with immediate billing attempts. Each test creates a fresh repository; there is no shared seed state to create stale-data false positives.

Webhook transport validation (raw body, signature, schema) is tested separately from business processing. Event IDs are unique; per-invoice status is monotonic so failure cannot overwrite a successful payment. Refund is recorded but does not reactivate or cancel in this deliberately narrow fixture.

## Validation and limitations

Run `npm install`, `npm run build`, `npm run lint`, `npm test`, and `npm run validate-schema`. Persistence is in-memory and process-local; repository operations are synchronous, so cross-process durability and true concurrent transaction races are not claimed. Timeout is represented as an indeterminate provider result and produces a past_due subscription plus a failed/unknown invoice record. AI assistance was used to scaffold and review this solution; the author should review the assumptions, run the commands from a clean checkout, and adjust the PR description to reflect any changes made during review.
