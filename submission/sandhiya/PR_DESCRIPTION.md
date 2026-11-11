# PR: Subscription & Billing SDET validation suite

## 1. Test strategy

This PR provides a small executable subscription service fixture and a layered integration test suite. Coverage includes HTTP API contracts, lifecycle/state-machine behavior, in-memory persistence, webhook security/idempotency/ordering, provider interaction, and end-to-end API-to-persistence workflows.

In scope: subscription creation/retrieval/cancellation; plan-specific price and trial configuration; success, decline, timeout, and refund events; duplicate and out-of-order webhook delivery; invalid transitions; and auditability.

Out of scope: real payment-provider connectivity, production SQL durability/locking, UI, load testing, tax/proration, notification delivery, and a real retry scheduler.

Real in this fixture: HTTP server, service/domain logic, transition table, repository implementation, request signing/verification, and API client transport. Mocked: external payment provider. Persistence is intentionally in-memory and isolated per test.

## 2. OOP and design patterns

- **State machine / transition table** (`SubscriptionStateMachine`): centralizes allowed lifecycle changes and rejects unknown transitions.
- **Builder** (`SubscriptionBuilder`, `WebhookBuilder`): constructs test inputs with scenario-focused intent.
- **Adapter + dependency injection** (`PaymentProviderAdapter`, `MockPaymentProvider`): separates payment orchestration from provider implementation and enables deterministic success/decline/timeout behavior.
- **Repository** (`InMemoryRepository`): centralizes subscription, invoice, event, and audit persistence access.
- **Fixture/client abstraction** (`BillingTestFixture`, `HttpApiClient`): isolates server startup, ephemeral ports, signing, and test setup/teardown.

## 3. API validation

Tests exercise create/get/cancel endpoints, response codes and payload fields, missing inputs, unknown plans/customers, repeat cancellation, malformed JSON, invalid HMAC signatures, and valid signed webhooks. Signatures are computed over the exact raw body and compared using a timing-safe comparison.

## 4. Database validation

The repository models `subscriptions`, `invoices`, `webhookEvents`, and a per-subscription audit log. Tests compare API-visible state with repository state and assert plan amount/trial values, invoice status, unique invoice/event handling, duplicate counters, terminal cancellation, and absence of invalid records. Each test creates a fresh repository to avoid stale data.

## 5. Mock provider and webhook validation

The mock records every charge request and can return success/decline or throw a timeout. Tests assert exact customer, payment method, subscription, invoice, amount, currency, and idempotency key values. Webhooks are generated and signed by the fixture; invalid signatures and malformed payloads are sent separately. Duplicate event IDs cannot create another invoice or provider charge. A failure arriving after success for the same invoice is recorded as ignored and cannot regress the subscription.

## 6. Test architecture

Production-like domain classes live in `src/`; reusable builders, HTTP client, and fixture are in `src/testFixture.js`; behavior specifications are grouped in `tests/subscriptionBilling.test.js`. The suite uses Node's built-in test runner and requires no external dependencies. Run with `npm test` on Node 18+.

## 7. Responsible AI usage

AI assistance was used to review the assignment requirements, identify gaps in the original implementation, and help draft/refactor parts of the fixture, tests, and documentation. The resulting code was executed with the project's test command; test failures were investigated and corrected. The author should personally review every implementation choice, run the suite locally, and be prepared to explain the state machine, provider seam, webhook ordering/idempotency rules, and in-memory persistence limitations during the interview.

## Assumptions / tradeoffs

- `basic` and `pro` begin in trial and use USD cents; their trial lengths are 7 and 14 days.
- A provider timeout produces an `unknown` invoice attempt and a `past_due` subscription, never `active`; production must reconcile unknown attempts before retrying.
- Refund changes invoice state to refunded but not subscription status because the assignment does not define refund lifecycle policy.
- Canceled subscriptions are terminal; validly signed late webhooks are recorded as ignored.
- The in-memory repository proves test behavior but not real database transaction/concurrency guarantees. Production follow-up should add unique constraints and transaction-level concurrency tests.
