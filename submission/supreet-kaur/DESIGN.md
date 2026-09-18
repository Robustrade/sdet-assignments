# Design & Test Strategy

This document is written **before** the bulk of the automation code, per the assignment's
"Documentation-First Workflow" requirement.

## 1. Approach chosen

**Option 2 — Build a Minimal Service Fixture.** No real Subscription & Billing Service was
provided, so this repo contains both:

- a small, in-process TypeScript fixture (`src/`) implementing just enough subscription/billing
  behaviour to be worth testing, and
- the automated validation suite around it (`test/`).

The fixture is not the deliverable — the **test design, architecture, and coverage** around it
are. The fixture is intentionally thin.

## 2. Assumptions about the system under test

- Two plans exist: `basic` ($9.00, 0-day trial — charged on creation) and `pro` ($49.00, 14-day
  trial). Defined once in `src/domain/Plan.ts`.
- **Settlement is webhook-driven, not synchronous.** Calling the payment provider (`charge()`)
  only submits an attempt and gets back an acceptance/decline/timeout *at the transport level*
  (mirrors how Stripe's `charges.create` can be accepted but the real success/failure is
  communicated asynchronously). Final success/failure of an *accepted* attempt always arrives
  via `payment.succeeded` / `payment.failed` on `/webhooks/payment-provider`. A synchronous
  **decline or timeout** (the provider couldn't even accept the attempt) is handled immediately
  by the service, without waiting for a webhook. This split is what lets the suite test
  "provider call outcome" and "webhook-driven settlement" as two genuinely different things
  instead of conflating them.
- There is no scheduler/cron in this fixture. In production, something would call "charge the
  customer" when a trial ends or a renewal is due. Here, `SubscriptionService.attemptCharge(id)`
  stands in for that trigger and is invoked directly by tests to simulate "time passing". This
  is documented, not hidden — see the comment at the top of `attemptCharge` in
  `SubscriptionService.ts`.
- A `past_due` subscription is canceled after 2 consecutive failed retry attempts
  (`MAX_RETRIES` in `src/domain/states/PastDueState.ts`). Not specified in the assignment; added
  for lifecycle completeness and documented as an assumption.
- A refund on an `active` subscription moves it to `past_due` rather than leaving it silently
  active with money returned. A refund with no prior success (still `trialing`/`past_due`) is
  a no-op — there's nothing valid to refund. Both are modeling choices, not requirements.
- 5 known `customer_id`s exist for test purposes (`cust_001`..`cust_003`, plus two persona IDs);
  anything else is a validation error. There is no real customer database — out of scope.

## 3. Scope of automation

**In scope:** everything under "Required Validation Depth" in the assignment — API contract,
state-machine correctness (all 7 valid transitions + invalid ones), persistence, and mocked
provider interaction, including the two mandatory categories (webhook idempotency, state-machine
invariants).

**Out of scope (per the assignment's Non-Goals, honored as-is):** a real payment provider
integration, multi-currency/proration/tax edge cases, performance testing, a UI, concurrent/
racing webhook delivery (explicitly a bonus — not attempted here to protect time spent on the
mandatory categories).

## 4. What is real vs. mocked/stubbed, and why

| Component | Real or test double | Why |
|---|---|---|
| Subscription lifecycle / state machine | Real | This is the thing under test. |
| HTTP API (`src/api/server.ts`) | Real (plain `node:http`) | Exercises actual request/response cycles, not in-process function calls, so API-shape and status-code assertions mean something. |
| Persistence (`src/persistence/`) | Real, but in-memory | Queryable synchronously in tests, zero external services to stand up. An in-memory store is explicitly allowed by the assignment's Technology Choices. |
| Payment provider | **Test double** (`MockPaymentProvider`) | The assignment requires this: "you must mock it, not assume it." Configurable per-test (accept/decline/timeout, globally or per customer), and every call is recorded for assertion. |
| Webhook delivery | Simulated by the test suite | Tests construct and sign payloads themselves (`WebhookPayloadBuilder` + `WebhookSignature`) and POST them to the real webhook route, exactly as the assignment specifies. |

## 5. Test levels covered

1. **API** — `test/api/` (creation/activation, validation failures, webhook request handling).
2. **State machine** — `test/state-machine/` (all 7 valid transitions individually, plus invalid
   transitions driven by both webhook and API).
3. **Database** — `test/database/` (subscription/invoice/webhook_event persistence, duplicate
   side-effect prevention, contradictory-record prevention).
4. **External integration (mock)** — `test/provider/` (call count, call arguments, all three
   outcomes).
5. **Webhook idempotency & ordering** — `test/webhooks/` (mandatory category, isolated into its
   own suite because of how much the assignment weights it).
6. **End-to-end** — `test/e2e/` (multi-step customer journeys through every seam at once).

## 6. Design patterns applied, and where

See the PR description (`PR_DESCRIPTION.md`) for the full writeup. Summary:

- **State** — `src/domain/states/*.ts`. Illegal transitions are structurally unreachable, not
  just rejected by a check (`CanceledState` literally contains no `transitionTo(...)` call).
- **Builder** — `test/support/builders/*.ts`. Subscription requests and webhook payloads are
  built with sane defaults, so a scenario overrides only what it's testing.
- **Strategy/Adapter + DI** — `src/providers/PaymentProvider.ts`. `SubscriptionService` depends
  only on the interface; `MockPaymentProvider` is injected via the constructor in
  `test/support/TestFixture.ts`.
- **Repository** (the "one more pattern") — `src/persistence/*Repository.ts`. Both the service
  and the test suite's assertion layer (`test/support/assertions.ts`) read/write through
  repositories, never raw `Map` access.
- Also present but not counted as one of the four required: a small **Factory**
  (`PlanCatalog.find/require` in `src/domain/Plan.ts`) so plan-specific pricing/trial rules live
  in exactly one place, per the assignment's own suggestion.

## 7. Database entities checked, invariants, and how correctness is confirmed

Entities: `subscriptions`, `invoices`, `webhook_events` (delivery log + processed-event-id set).
An audit log is modeled as part of the `Subscription` aggregate rather than a separate table
(`Subscription.auditLog`), since in this fixture it's derived data with no independent lifecycle.

Invariants asserted (see `test/support/assertions.ts` and the tests that use it):
- Persisted status always matches the API-visible result (`assertApiAndPersistenceAgree`).
- An `active` subscription always has at least one `succeeded` invoice
  (`assertNoContradictoryInvoice`).
- Invoice count only grows on genuine billing attempts, never on webhook redelivery
  (`assertInvoiceCount` + the idempotency suite).

**Test data seeding/cleanup:** each test gets a brand-new `InMemoryDatabase` via
`TestFixture.start()` in a `beforeEach`, and the HTTP server is closed in `afterEach`. There is
nothing to truncate and nothing to leak — isolation comes from not sharing storage, not from
cleanup discipline, which is the most reliable way to avoid stale-data false positives/negatives
in a test suite like this.

## 8. Webhook / idempotency strategy

- Every inbound webhook is checked for a valid HMAC-SHA256 signature over the **raw body bytes**
  (never a re-serialized object) before anything else happens.
- Every delivery (including rejected and duplicate ones) is recorded in a delivery log for
  audit. Only successfully-shape-validated, signature-valid events are checked against a
  `processed event_id` set; a hit there short-circuits to a 200 no-op.
- Out-of-order settlement is guarded at the **invoice** level: once an invoice's status leaves
  `pending`, no later event for that invoice can change it again — this is what stops a delayed
  `payment.failed` from undoing an earlier `payment.succeeded` for the same invoice.

## 9. Known limitations

- No real database — swapping `InMemoryDatabase` for e.g. `better-sqlite3` would need new
  Repository implementations, but the service and tests wouldn't change (that's the point of
  the Repository seam).
- No concurrency/race testing (explicit bonus in the assignment, not attempted here).
- The "trial ends" / "recurring charge due" trigger is a direct test-only method call rather
  than a real scheduled job, documented above.
- Plan catalog, customer allow-list, and retry-limit are hard-coded constants appropriate for a
  test fixture, not a production configuration system.
