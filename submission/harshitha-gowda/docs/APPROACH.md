# Approach (written before implementation)

## Assumptions about the system under test
- No service was provided, so I build a small fixture (HTTP + SQLite) that implements the described endpoints and lifecycle. It exists to give the tests something real to prove; the deliverable is the test design.
- `pro` = 7-day trial, 4900 USD; `basic` = no trial, 2900 USD, charged at creation. Declined/timed-out charge at creation => nothing persisted.
- Trial end and dunning retries are scheduler-driven in real life. The fixture exposes `POST /admin/subscriptions/{id}/trial-end` and `/retry` as test seams for them.
- 3 failed attempts in `past_due` (counting the first failure) => `canceled` (retries exhausted).
- `past_due` is not cancelable via API (the lifecycle only lists active/trialing).

## Scope and test levels
| Level | What is proven |
|---|---|
| API | codes, payload shape, validation, webhook signature/malformed handling |
| State machine | all 7 transitions via API and webhook; exhaustive (status x trigger) matrix; canceled terminal |
| Database | subscriptions, invoices, webhook_events, audit log match API and business rules after every test |
| Provider | call count, exact args (amount/customer/payment method/idempotency key), success/decline/timeout |
| E2E | request -> service -> DB -> provider mock in one flow |

Out of scope: UI, real provider, performance, proration/tax/multi-currency, true multi-process concurrency.

## Real vs mocked
Real: HTTP server, routing, HMAC verification, business logic, SQLite. Mocked: only the payment provider (behind `PaymentProvider`). The webhook sender is simulated by the test suite with its own independent HMAC implementation.

## Patterns (only ones actually in the code)
- **State machine**: transition table + `SubscriptionStateMachine.next()` throws on illegal moves; status is never assigned elsewhere.
- **Builder**: `SubscriptionRequestBuilder`, `WebhookEventBuilder`.
- **Dependency injection / Strategy seam**: `PaymentProvider` interface; `MockPaymentProvider` injected.
- **Repository**: read-only repositories so specs never contain SQL.
- **Factory**: `TestEnvironment.subscriptionIn(status)` drives the real API to a given state.

## Idempotency strategy
`webhook_events` records every receipt. First receipt of an `event_id` is `applied` or `ignored`; later receipts are stored as `duplicate` and cause no side effects. Independently, invoice-level guards stop different events about the same invoice from duplicating or regressing it.

## DB invariants (asserted after every test)
1. `active` => at least one `paid`/`refunded` invoice. 2. Audit log is a gapless chain ending at current status. 3. Nothing recorded after `canceled`. 4. No duplicate invoice ids. 5. Each `event_id` has at most one non-duplicate row. API response == DB row (`expectApiMatchesDb`).

## Known limitations
- Single-process, in-memory: the concurrency test is a smoke check, not proof of cross-process safety (a real DB would need a unique constraint / row lock on `event_id`).
- Scheduler seams are admin endpoints, not a real clock.
