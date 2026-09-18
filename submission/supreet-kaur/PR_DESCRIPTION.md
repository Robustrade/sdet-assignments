# Subscription & Billing Service — Automated Validation Suite

## Summary
Implements an object-oriented automated test framework for a Subscription & Billing Service,
plus a minimal in-process TypeScript service fixture to validate it against (Option 2 in the
assignment — no real service was provided). 48 tests across 9 suites cover the API, the
lifecycle state machine, persistence, and mocked payment-provider interaction, including the two
mandatory categories (webhook idempotency and state-machine invariants).

## Test Strategy
- **Levels covered:** API contract & validation, state-machine (all 7 valid transitions +
  invalid ones), database/persistence, mocked external payment provider, plus a small
  cross-cutting end-to-end suite.
- **In scope:** everything under "Required Validation Depth" in the assignment.
- **Out of scope:** real payment provider integration, multi-currency/proration/tax, a UI,
  performance testing, concurrent/racing webhook delivery (explicit bonus, not attempted so the
  mandatory categories got full attention instead).
- **Real vs. mocked:** the lifecycle/state machine, HTTP API, and in-memory persistence are real
  code under test. The payment provider is a test double (`MockPaymentProvider`) satisfying the
  `PaymentProvider` interface — configurable per test to accept, decline, or time out, globally
  or per customer, with every call recorded for assertion. Inbound webhooks are constructed and
  signed by the test suite itself (`WebhookPayloadBuilder` + `WebhookSignature`) and posted to
  the real webhook route. Full detail in `DESIGN.md`.

## OOP & Design Pattern Choices

**State** — `src/domain/states/{State,TrialingState,ActiveState,PastDueState,CanceledState}.ts`.
`Subscription.currentState` holds one of four singleton state objects; every lifecycle-changing
event (`onPaymentSucceeded/Failed/Refunded/onCancel`) is a method call on that object. The
problem this solves: the assignment explicitly flags "a status string mutated ad hoc from six
call sites" as the anti-pattern to avoid. With the State pattern, `CanceledState` simply contains
no `transitionTo(...)` call anywhere in its body — there is no code path that reactivates a
canceled subscription, so "canceled → active via stray webhook" isn't validated against, it's
unreachable by construction. Proven in `test/state-machine/invalid-transitions.test.ts`.

**Builder** — `test/support/builders/{SubscriptionRequestBuilder,WebhookPayloadBuilder,
CustomerBuilder}.ts`. Solves repeated, mostly-identical object literals across ~40 test cases.
`.withPlan("pro").build()` reads as "everything default except the plan", and
`WebhookPayloadBuilder.forInvoice(...).succeeded().withEventId("evt_x")` makes idempotency tests
(which need two deliveries of the *same* payload) trivial to write correctly.

**Strategy/Adapter (seam around the payment provider)** — interface in
`src/providers/PaymentProvider.ts`; `SubscriptionService` takes a `PaymentProvider` via
constructor injection (see `test/support/TestFixture.ts`) and never imports a concrete
implementation. This is the seam the assignment requires explicitly: it's what makes "assert the
provider was called once, with these exact arguments" possible without a network call.

**Repository (the "one more pattern")** — `src/persistence/{Subscription,Invoice,WebhookEvent}
Repository.ts`, backed by `InMemoryDatabase`. Two consumers: `SubscriptionService` uses it
instead of touching storage directly, and the test suite's `test/support/assertions.ts` reads
persisted state through the *same* repositories instead of raw `Map` access scattered through
test files — directly satisfying the assignment's "validate persisted state via a repository/DAO,
not raw queries inline in tests."

(A small **Factory**, `PlanCatalog` in `src/domain/Plan.ts`, also exists so plan pricing/trial
rules live in one place rather than as branching logic — the assignment suggests this directly —
but it isn't counted as one of the four required patterns to avoid overclaiming.)

## API Validation Approach
Requests/responses are validated through a typed `ApiClient` (`test/support/ApiClient.ts`) that
makes real HTTP calls (Node's global `fetch`) against a real `node:http` server
(`src/api/server.ts`) started on an ephemeral port per test — status codes and response shapes
are asserted end-to-end, not mocked at the transport layer.

Webhook **request handling** (signature verification, JSON/shape validation) is tested
separately from webhook **business logic** in `test/api/webhook-request-handling.test.ts`:
tampered signature, missing signature, invalid JSON, missing required fields, unknown event
type, unknown `subscription_id`/`invoice_id` — each gets its own test and the correct HTTP
status (401 for signature failures, 400 for shape failures, 404 for unknown references). Failure
scenarios for subscription creation (unknown plan, missing/unknown customer, missing payment
method, double-cancel) live in `test/api/validation-failures.test.ts` and additionally assert the
provider was never called and nothing was persisted.

## Database Validation Approach
Entities checked: `subscriptions`, `invoices`, `webhook_events` (a delivery log plus a
processed-event-id set for idempotency). An audit log is modeled on the `Subscription` aggregate
itself rather than a separate table.

Invariants asserted (`test/support/assertions.ts`, used throughout `test/database/`):
persisted status always matches the API-visible result; an `active` subscription always has at
least one `succeeded` invoice on record; invoice count only grows on genuine billing attempts,
never on webhook redelivery. Persisted state is checked at multiple points in the lifecycle
(creation, post-activation, post-cancel), not just at creation — see
`test/database/persistence.test.ts`, first test.

Data is seeded and cleaned via full isolation: every test gets a brand-new `InMemoryDatabase`
from `TestFixture.start()` (`beforeEach`), and the HTTP server is torn down in `afterEach`.
Nothing is shared between tests, so there's no truncate step to get wrong and no stale-data
source for false positives/negatives.

## Mock Payment Provider & Webhook Validation
`MockPaymentProvider` (`src/providers/MockPaymentProvider.ts`) implements the real
`PaymentProvider` interface. Tests configure it with `setDefaultOutcome` /
`setOutcomeForCustomer` (`accept` / `decline` / `timeout`) and assert against `calls` — full
request objects (customer, amount, currency, payment method, idempotency key), not just a call
count. See `test/provider/mock-provider-interaction.test.ts`.

**Idempotency** is proven in `test/webhooks/idempotency-and-ordering.test.ts` and reinforced in
`test/database/persistence.test.ts`: the same `event_id` delivered 2–3 times produces exactly one
state transition, exactly one invoice row, and the retry counter is not double-incremented; the
delivery log still records every delivery attempt (so a duplicate is auditable, not invisible).

**Out-of-order/stale delivery** is handled at the invoice level: once an invoice leaves
`pending`, no later event for that invoice can re-settle it. Proven directly: a
`payment.succeeded` followed by a *different-event-id* `payment.failed` for the same invoice does
not regress an active subscription, and the original `succeeded` invoice status is not
overwritten.

**Confidence these tests provide:** that redelivery and reordering — the two failure modes the
assignment calls out as mandatory — cannot corrupt subscription state or create duplicate
financial records, which is the actual risk in a webhook-driven billing system.

## State-Machine / Lifecycle Coverage
All 7 valid transitions from the assignment's lifecycle diagram are each covered by a dedicated,
named test in `test/state-machine/valid-transitions.test.ts` (trialing→active, trialing→past_due,
active→past_due, past_due→active, past_due→canceled via exhausted retries, active→canceled,
trialing→canceled).

At least two invalid transitions are proven impossible in
`test/state-machine/invalid-transitions.test.ts`, driven by **both** triggers as required: a
stray `payment.succeeded`/`payment.failed` webhook against a canceled subscription (webhook-driven)
and a second `cancel` call against an already-canceled subscription, which is rejected with 409
(API-driven).

**Confidence provided:** because `CanceledState` contains no transition-out code path at all,
these tests aren't just checking today's behavior — they're checking that the shape of the code
makes the bug class impossible to reintroduce without visibly adding a `transitionTo(...)` call
where none exists now.

## Test Architecture
```
src/            domain (entities + State pattern) → providers (Strategy/Adapter) →
                persistence (Repository) → service (orchestration) → api (HTTP)
test/support/   TestFixture (env setup + isolation), ApiClient (transport), builders/
                (test data), assertions.ts (verification layer over the repositories)
test/<area>/    scenarios, grouped by validation level (api, state-machine, database,
                provider, webhooks, e2e), one concern per file
```
Maintainability rationale: every cross-cutting concern (signing a webhook, building a
subscription request, reading back persisted state) has exactly one implementation, used by every
test file that needs it — changing how a webhook is signed, or how persistence is queried, means
editing one file, not forty. `SubscriptionService` is the only place that touches repositories
and the payment provider together, so "does the provider get called exactly once per real
billing attempt" is answerable by reading one file instead of auditing every call site.

## Validation
```
npm install
npm run build   # tsc --noEmit — passes, no type errors
npm test        # node --import tsx --test ... — 48/48 tests passing, 9/9 suites
```
Actually run locally before submitting: `tsc --noEmit` clean; full suite green (48 pass, 0 fail).

## Known Limitations / Next Steps
- Persistence is in-memory; swapping in `better-sqlite3` would mean new Repository
  implementations only — service and test code are already isolated from the storage engine.
- No concurrent/racing webhook test (explicit bonus in the assignment; skipped to protect time
  for the mandatory categories).
- "Trial ends" / "recurring charge due" are simulated by tests calling
  `SubscriptionService.attemptCharge` directly rather than a real scheduler — documented in
  `DESIGN.md`.
- Retry-limit (2), known customers, and the plan catalog are fixture constants, not a real
  configuration/customer system — appropriate for a test fixture, not for production.

## Responsible AI Usage
I used an AI assistant (Claude) to produce the majority of this solution — the project
structure, the domain/state-machine/service/API/persistence/provider implementation, and all 48
tests — based on the assignment's requirements. I ran the type checker and the full test suite
myself and confirmed it passes (48/48) before submitting.

I have not yet done a full line-by-line review of every design decision. I'm prepared to walk
through the parts I do understand (the overall architecture, the four required design patterns
and where they live, the webhook idempotency approach) in a follow-up conversation, and to be
upfront about any part I'd need to review further before extending it myself.

## Author Checklist
- [x] Linting passes (n/a — no linter configured; `tsc --noEmit` used as the strict-mode gate)
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes (48/48, `npm test`)
- [x] Schema/setup validation passes (n/a — in-memory store, no schema migration step)
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [ ] README was tested from a clean setup *(verify with `npm install && npm test` on your own machine before checking this — see note below)*
