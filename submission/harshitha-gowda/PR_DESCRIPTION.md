## Summary
An object-oriented test framework for a Subscription & Billing Service (hybrid approach): a small TypeScript service fixture (HTTP + SQLite) and a layered suite of 56 tests covering API, state machine, database, mocked payment provider and end-to-end flows. Strategy was written first in `docs/APPROACH.md`.

## Test Strategy
- **Levels covered:** API contract/validation, state machine (unit + end to end), database, provider interaction, end-to-end flows.
- **In scope:** all 7 lifecycle transitions via API and webhook, idempotency, out-of-order delivery, refunds, forged/malformed webhooks, provider success/decline/timeout, audit log, plan price/trial rules, one concurrency smoke test (bonus).
- **Out of scope:** UI, real provider, performance, proration/tax/multi-currency, true multi-process concurrency.
- **Real vs mocked:** Real: HTTP server, routing, HMAC verification, business logic, SQLite. Mocked: only the payment provider, because it is the one external dependency. The webhook sender is simulated by the suite with its own independent HMAC, so a signing bug in the service can't hide.

## OOP & Design Pattern Choices
- **State machine** (`src/state-machine.ts`): explicit transition table; `next()` throws on illegal moves. Status is only changed through `BillingService.transition()`. Solves: illegal states are unreachable.
- **Builder** (`tests/framework/builders.ts`): `SubscriptionRequestBuilder`, `WebhookEventBuilder`. Solves: scenarios read as intent, no repeated literals.
- **DI seam / Strategy** (`src/payment-provider.ts`): `PaymentProvider` interface, injected via `BillingService` constructor deps; `MockPaymentProvider` implements it. Solves: no network, configurable outcomes, call recording.
- **Repository** (`tests/framework/repositories.ts`): read-only repos per table. Solves: no raw SQL in specs.
- **Factory** (`TestEnvironment.subscriptionIn(status)`): drives the real API to a target state. Solves: repeated multi-step setup.
- **Seam:** interface `PaymentProvider.charge()`; injection point is `new BillingService({ db, provider, ... })` in `TestEnvironment.start()`.

## API Validation Approach
- Typed `ApiClient` keeps transport out of specs. Responses are checked for status code, payload shape and error code.
- Webhook request handling is tested separately from business logic: valid, missing, forged and tampered signature (401); signed-but-malformed JSON, missing fields, unsupported type (400); unknown subscription (404). In every rejection case no event or invoice is persisted.
- Failure scenarios: unknown plan, missing/malformed fields, unknown customer, double cancel, provider decline/timeout at creation. Each asserts nothing persisted and no provider call.

## Database Validation Approach
- **Entities:** `subscriptions`, `invoices`, `webhook_events`, `subscription_events` (audit).
- **Invariants** (`TestEnvironment.verifyInvariants()`, run after every test for every subscription created): active implies a paid/refunded invoice; audit log is a gapless chain ending at current status; nothing recorded after `canceled`; no duplicate invoice rows; each `event_id` has at most one non-duplicate row.
- `expectApiMatchesDb()` compares API response and DB row at each stage. Specs assert DB state after every transition, not just creation. A fresh in-memory DB per test avoids stale data.

## Mock Payment Provider & Webhook Validation
- `MockPaymentProvider`: success/decline/timeout (default or one-shot), records every call. Asserted: exact call count, full arguments (customer, payment method, amount, currency, idempotency key equal to the invoice id), zero calls for rejected creates, replays, cancels and all webhooks.
- **Idempotency:** same `event_id` twice gives one transition, one invoice, event rows `applied` + `duplicate`, one audit entry, no provider call. Also: redelivered `payment.failed` doesn't double-count attempts; different event ids for the same invoice don't duplicate it; concurrent duplicates apply once.
- **Out of order:** `payment.failed` after `payment.succeeded` for the same invoice is ignored, leaving the subscription active and the invoice paid. Failed-then-succeeded (a provider retry) recovers to active. Refund before payment is ignored.

## State-Machine / Lifecycle Coverage
- **Valid:** trialing to active (scheduler and webhook), trialing to past_due, active to past_due, past_due to active (scheduler and webhook), past_due to canceled (retries exhausted), active to canceled, trialing to canceled.
- **Proven impossible:** canceled to active and canceled to past_due via stray webhooks; past_due cancel via API; active trial-end/retry; plus an exhaustive status x trigger matrix test.
- **Confidence:** the lifecycle table is verified exhaustively, and persisted state, provider calls and the audit log are verified for every transition. I also injected 4 bugs (removed canceled guard, disabled idempotency, allowed a late failure to overwrite a paid invoice, wrong charge amount); each made tests fail.

## Test Architecture
`tests/framework/` holds the reusable pieces: `TestEnvironment` (isolated world, factory, invariants), `ApiClient`, `MockPaymentProvider`, `WebhookSimulator`, builders, repositories. `tests/specs/` holds scenarios grouped by intent (api, lifecycle, webhooks, provider-interaction). New scenarios compose existing pieces without new plumbing, and the invariant check runs automatically after each test.

## Validation
- `npm install && npm test` (56 passing)
- Mutation checks described above, run manually.
- `npm run typecheck` (`tsc --noEmit`)

## Known Limitations / Next Steps
- Single-process in-memory DB: the concurrency test is a smoke check; a real DB needs a unique constraint or row lock on `event_id`.
- Trial end and retries are modelled as admin endpoints, not a real scheduler/clock.
- Requires Node >= 22.5 (`node:sqlite`, `node:test`). With more time: Vitest port, CI workflow, notification side-effect modelling, lint config.

## Responsible AI Usage
<!-- REWRITE IN YOUR OWN WORDS and keep only what is true for you. -->
- Yes, I used Claude (Anthropic).
- It helped draft the fixture, framework and specs, and the docs.
- I personally verified: [read every file / ran npm test on my machine / ran the mutation checks / changes I made: ...].

## Author Checklist
- [ ] Linting passes (no linter configured: N/A, or add one)
- [ ] Type check passes (`npm run typecheck`, run after `npm install`)
- [x] Test suite passes
- [ ] Schema/setup validation passes (N/A: no schema validation script)
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [ ] README was tested from a clean setup (do this on your machine)
