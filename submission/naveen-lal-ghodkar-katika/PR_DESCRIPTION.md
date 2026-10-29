## Summary

An automated test suite for a Subscription & Billing Service, in TypeScript with Jest and Supertest. The assignment gives no service, so this is **Option 3 (hybrid)**: a small in-memory Express service fixture (`src/`) plus a test framework (`tests/framework/`) and specs (`tests/specs/`). The effort is in the framework and the specs, not the product.

The service covers `POST /subscriptions`, `GET /subscriptions/{id}`, `POST /subscriptions/{id}/cancel` and `POST /webhooks/payment-provider`, plus a billing run (`BillingScheduler.runDue()`) for trial end, recurring charges and retries. There is no HTTP endpoint for the billing run: it is called by tests with a fake clock.

Full design, assumptions and the implementation log are in [`TEST_STRATEGY.md`](./TEST_STRATEGY.md). This description does not repeat them.

## Test Strategy

- **Levels:** API contract and validation, state machine, persistence, mocked provider interaction, webhook handling (signature, duplicates, out-of-order, concurrent delivery), end-to-end flows.
- **Real (system under test):** Express app, routes, HMAC signature check, services, state machine, in-memory repositories.
- **Test doubles:** `MockPaymentProvider` (success / decline / timeout, one-shot queues, recorded calls), `FakeClock`, deterministic ids. HTTP is real but in-process (Supertest, no ports).
- **Not tested:** a real database, a real payment provider, real network, a real scheduler (cron or queue). Storage is in-memory and the provider is a mock; nothing here claims otherwise.
- **Out of scope:** UI, performance, taxes, proration, multi-currency.

## OOP and Design Patterns (only those present in the code)

| Pattern | Where | Problem it solves |
|---|---|---|
| State machine (transition table) | `src/domain/SubscriptionStateMachine.ts` | API, webhooks and the billing run all change state through `Subscription.apply()`; `status` is read-only, so illegal transitions are unreachable. The table is also the oracle of the exhaustive (state x trigger) test |
| Builder | `tests/framework/builders/` (`SubscriptionRequestBuilder`, `WebhookEventBuilder`, `SubscriptionRecordBuilder`, `InvoiceRecordBuilder`) | Scenarios read as intent instead of repeated object literals |
| Dependency injection at the provider seam | `src/providers/PaymentProvider.ts` interface, injected through `createService({ paymentProvider })`; `MockPaymentProvider` in tests; `UnconfiguredPaymentProvider` as the fail-closed default | Tests substitute success / decline / timeout with no network and assert call count and arguments. `Clock` and `IdGenerator` use the same seam |
| Repository | `src/persistence/*Repository` + `InMemory*` | Service and tests share one query surface; tests read through `PersistenceAssertions`, never raw structures |
| Factory | `TestEnvironment.create()`, `createService()` | One place wires service, doubles and repositories, fresh per test, so there is no shared state or cleanup |

Also used, not named as patterns: a pure timing function (`decideBilling`), shared settlement rules for webhooks and the billing run (`chargeSettlement.ts`), and a per-subscription `KeyedMutex`.

## API Validation

Specs in `tests/specs/api/`: create (basic and pro, response shape, plan price and trial), every validation failure (unknown plan, unknown customer, missing / mistyped fields, bad payment method, malformed JSON, bad idempotency header), get, cancel, double cancel. Each failure also asserts that nothing was persisted and the provider was not called. Webhook request handling is tested separately from business logic (`specs/webhooks/signature`, `payloadValidation`): missing, wrong and tampered signature give 401, signed but malformed or unsupported payloads give 400, and nothing is persisted.

## Database Validation

All four stores are checked: subscriptions, invoices, webhook events, audit log. `PersistenceAssertions.expectCoherent()` runs after each step of the end-to-end flows. It checks, among others: API status equals stored status; `active` implies a paid (or refunded) invoice; `past_due` implies a failed invoice; invoice amounts and keys are consistent and unique; at most one pending invoice and only as the latest; the audit chain is contiguous, ends at the current status, and nothing follows `canceled`; timestamps never go backwards. Rejected requests are checked with before/after snapshots.

## Mock Provider and Webhook Validation

- **Provider:** call count (exactly one per real billing attempt; zero for rejected creation, replayed webhook, canceled subscription, trial not yet ended) and exact arguments (amount, currency, customer, payment method, idempotency key, reference).
- **Duplicates:** the same `event_id` delivered twice or ten times gives one transition, one invoice, one audit entry, unchanged provider calls, and `deliveryCount` incremented.
- **Out of order and stale:** `payment.failed` after `payment.succeeded` does not regress an active subscription; early, echo and late webhooks for scheduler-created invoices are recorded as ignored; a timeout is resolved by a webhook (E5).
- **Concurrency:** overlapping runs, cancel vs run, webhook vs run, and concurrent duplicate deliveries use `slowStorage` so the lock actually matters.

## State-Machine Coverage

All seven valid transitions (trial end success / failure, recurring failure, retry success, retries exhausted, cancel from `active`, cancel from `trialing`) are exercised by API, webhook and billing-run specs. Invalid ones proven impossible include `canceled` + `payment.succeeded` / `payment.failed`, `canceled` + cancel (409), `past_due` + cancel (409), a failed event on a paid invoice, and the full (state x trigger) table.

## Test Architecture

`tests/framework/` (env, client, doubles, builders, assertions, webhook simulator) is separate from `tests/specs/` (api, lifecycle, webhooks, persistence, provider, billing, e2e). Specs use the client, builders and assertions only; they do not touch Express, Supertest or repository internals.

## Validation (actual results)

Run from `submission/naveen-lal-ghodkar-katika/`, Node v24.14.1, npm 11.11.0:

| Command | Result |
|---|---|
| `npm ci` on a clean copy (no `node_modules`) | installs; `npm test` there passes |
| `npm test` | 33 suites, 391 tests passed |
| `npm run test:ci` | 33 suites, 391 tests passed |
| `npm run typecheck` and `npm run build` (both `tsc --noEmit`) | clean |
| `npm run test:coverage` | passes; src only: 98.94% statements, 97.2% branches, 97.14% functions, 98.91% lines |
| Race specs repeated 10 times | 63 tests passed in each run |
| Mutation check (hand-run, one change at a time, each reverted; `src/` verified identical by hash afterwards) | 79 compiling mutations over scheduler timing, retry rules, provider request, webhook settlement, creation idempotency and cancellation. 78 were caught on the first pass; the survivor (a stale invoice `updatedAt` after a resend) led to new specs and is now caught |

The mutation sweep is a manual script that is not part of the repository; the result is a one-time check, not a CI gate.

## Key Assumptions

- Plans are data: `basic` 1900 USD cents, 0-day trial (charged at creation); `pro` 4900, 14-day trial. A subscription always starts `trialing`.
- A provider timeout means the outcome is unknown: state unchanged, invoice stays `pending`, the next run re-sends the same invoice with the same idempotency key. On creation a timeout returns 504 and persists nothing.
- Three consecutive failed invoices cancel a `past_due` subscription. Retry interval 1 day, billing period 30 days (fixed).
- Invoices in a terminal state (`paid`, `failed`, `refunded`) are never overwritten by later events. Webhooks never create invoices.
- Valid webhooks are acknowledged with 200 even when ignored.
- Cancel from `past_due` is rejected (409), following the lifecycle diagram literally.

## Known Limitations and Optional Gaps

None of these is required by the assignment text.

- A subscription canceled while a timed-out invoice is `pending` leaves it `pending` (not voided; the money may have been captured). Pinned by `timeoutAndCancellation.test.ts`.
- No cap on timeout resends; `runDue()` stops at the first unexpected provider error.
- No notifier, so "no duplicate notification" is asserted on state, invoices, audit, event rows and provider calls instead.
- No plan-change endpoint: the assignment lists "plan changes" once as an API area but defines no such endpoint in Core Operations.
- In-memory storage: no durability or transaction guarantees; writes are not atomic and a crash between them is not simulated. Locking is single-process.
- No linter or schema-validation script. No webhook replay window or secret rotation.
- `npm audit` reports a `deepmerge` advisory reachable only through the dev dependency `jest`.

## Responsible AI Usage

Cursor AI was used to assist with test-strategy drafting, implementation, test creation, debugging, mutation testing, and documentation. I reviewed the generated changes and test reports and used the assignment specification to assess the solution. Mutation testing identified a test-coverage blind spot, which was addressed by adding regression tests without changing the application source code.

I am responsible for reviewing the final submission and ensuring that the implementation, test results, assumptions, and limitations are accurately represented.
