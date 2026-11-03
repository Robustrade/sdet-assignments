# Test Strategy — Subscription & Billing Service

This document was written before the automation code. It is the contract the suite is built against.
Sections marked *(updated)* were adjusted while implementing; the original intent is kept where it differed.

## 1. System under test (Option 3 — Hybrid)

No service was provided, so this submission contains a **minimal service fixture** (`src/`) and a
**validation suite** (`test/`). The fixture is deliberately small, but its lifecycle and persistence
rules are real code paths the tests exercise end-to-end over HTTP.

| Component | Real or double | Why |
|---|---|---|
| HTTP API (Express) | **Real** | Status codes, payload shape, and body parsing are part of the contract. Driven via Supertest in-process (no ports). |
| Subscription lifecycle / state machine | **Real** | This is the behaviour under test. |
| Persistence (SQLite via `sql.js`, in-memory) | **Real** | Real SQL with `CHECK`, `UNIQUE`, partial indexes and triggers, so DB-level guarantees are tested, not assumed. WASM build: no native compile step on any OS. |
| Webhook signature verification (HMAC-SHA256) | **Real** | Tests sign payloads with their *own* HMAC implementation so a bug in the service's verifier cannot be masked by sharing code. |
| Payment provider (outbound charges) | **Test double** — `MockPaymentProvider` | External dependency. Implements the `PaymentProvider` interface; scripted outcomes: succeed / decline / pending / timeout / held (manually released). Records every request. |
| Payment provider (inbound webhooks) | **Simulated** — `WebhookSimulator` | The suite constructs signed, unsigned, wrongly-signed, tampered and malformed payloads and POSTs them. |
| Clock | **Test double** — `FakeClock` | Trial ends, renewals and retries are time-driven; tests move time explicitly instead of sleeping. |
| Billing scheduler | **Real logic, manual trigger** | `POST /internal/billing/run` stands in for a cron job. Tests call it after moving the clock. |

## 2. Assumptions about the domain

* **Plans** (Strategy objects in `src/plans`):

  | plan | price | trial | interval | retries after first failure | retry spacing |
  |---|---|---|---|---|---|
  | `basic` | 1900 USD | none — charged at creation | 30 days | 2 | 3 days |
  | `pro` | 4900 USD | 14 days | 30 days | 3 | 3 days |

* **Every subscription is born `trialing`.** A zero-trial plan's trial ends at the creation instant and
  the first charge runs inside the create request, so the only paths to `active`/`past_due` are the
  diagram's own edges (`trialing → active | past_due`). No extra `incomplete` state is invented.
* **Lifecycle triggers** (`src/domain/SubscriptionStateMachine.ts`):

  ```text
  trialing  --charge_succeeded-->   active
  trialing  --charge_failed----->   past_due
  trialing  --cancel_requested-->   canceled
  active    --charge_succeeded-->   active     (renewal: self-loop, no status change)
  active    --charge_failed----->   past_due
  active    --cancel_requested-->   canceled
  past_due  --charge_succeeded-->   active
  past_due  --retry_failed------>   past_due   (self-loop, retry_count + 1)
  past_due  --retries_exhausted->   canceled
  canceled  (terminal — no triggers)
  ```

  Anything else is illegal. Notably **`past_due → canceled` via the API is rejected (409)** because the
  diagram only allows it via exhausted retries. This is a literal reading of "any transition not shown
  is invalid"; in a real product I would raise it with the product owner.
* **Invoices** hold one billing period. Status: `open → paid → refunded`, or `open → uncollectible`
  (retries exhausted), or `open → void` (subscription canceled while a charge was outstanding).
  Retries reuse the same open invoice; each provider call is one `payment_attempts` row.
* **Charge outcome sources.** The synchronous provider response is applied when definitive
  (succeeded/declined). `pending` or a **timeout** leaves the attempt unresolved; the subscription does
  not move and is **not re-charged** until a webhook resolves the attempt (avoids double charging
  when the outcome is unknown). The first definitive outcome for an attempt wins; later contradicting
  signals are recorded and ignored.
* **Webhooks** for unknown invoices, mismatched subscription/amount, non-open invoices, or attempts
  already resolved return **200 with `outcome: "ignored"` and a reason** (non-2xx would make the
  provider redeliver forever). The event is still recorded so a redelivery is a duplicate.
* **Refunds** (`payment.refunded`) move a `paid` invoice to `refunded` and are audited, but do not
  change subscription status (not in the diagram). Full refunds only.
* **Plan change** (`POST /subscriptions/{id}/plan`) is allowed in `trialing`/`active`, takes effect on
  the next invoice, and does not prorate (proration is a non-goal).
* Customers and payment methods are seeded (no customer API — out of scope).

## 3. API contracts

All errors: `{ "error": { "code": string, "message": string, "details"?: [...] } }`.

| Method & path | Success | Failures |
|---|---|---|
| `POST /subscriptions` | `201` Subscription | `400 validation_error` (missing/mistyped fields), `400 malformed_json`, `422 unknown_plan`, `422 unknown_customer`, `422 invalid_payment_method` (unknown, or belongs to another customer) |
| `GET /subscriptions/{id}` | `200` Subscription | `404 subscription_not_found` |
| `GET /subscriptions/{id}/invoices` | `200 { data: Invoice[] }` | `404` |
| `POST /subscriptions/{id}/cancel` | `200` Subscription (`canceled`) | `404`, `409 invalid_transition` |
| `POST /subscriptions/{id}/plan` `{plan}` | `200` Subscription | `400`, `404`, `422 unknown_plan`, `409 plan_change_not_allowed`, `409 plan_unchanged` |
| `POST /internal/billing/run` | `200 { results: [...] }` | — |
| `POST /webhooks/payment-provider` | `200 { received, event_id, outcome: applied\|ignored\|duplicate, reason? }` | `401 missing_signature`, `401 invalid_signature`, `400 malformed_payload`, `400 invalid_payload` |

Webhook request handling order: **signature over raw bytes → JSON parse → schema → business logic**.
An unsigned malformed body is therefore `401`, not `400`: nothing about an unauthenticated body is trusted.

Response schemas live in `test/support/api/contracts.ts` as **strict** zod schemas — an unexpected or
missing field fails the contract test.

## 4. Test levels and scope

| Level | Spec folder | What it proves |
|---|---|---|
| Unit — state machine | `test/specs/lifecycle/state-machine.unit.spec.ts` | Transition table equals the diagram exactly; every (state, trigger) pair outside it throws. Exhaustive, cheap, the oracle for the rest. |
| API contract & validation | `test/specs/api/` | Codes, shapes, validation errors, webhook request handling — and **absence of persistence/provider calls** on rejection. |
| State-machine integration | `test/specs/lifecycle/` | Every diagram edge reached through API/billing/webhook triggers; illegal ones rejected; plan rules applied. |
| Webhooks | `test/specs/webhooks/` | Idempotency, duplicates, out-of-order and stale delivery, racing with in-flight charges. |
| Provider interaction | `test/specs/provider/` | Call counts and exact arguments; success/decline/pending/timeout behaviour. |
| Persistence | `test/specs/persistence/` | Rows per stage, DB-level constraints, zero side effects on rejected input. |
| End-to-end | `test/specs/e2e/` | One full journey with a persisted-state checkpoint after every step. |

**Out of scope:** real provider/network, multi-instance concurrency, performance, proration, taxes,
multi-currency, webhook timestamp/replay-window checks, customer management, authn/authz of the API.

## 5. Database entities and invariants

Entities: `subscriptions`, `invoices`, `payment_attempts`, `webhook_events`, `webhook_deliveries`,
`audit_log`, `notifications` (an outbox standing in for customer emails — the side effect that must not
repeat), plus `customers`, `payment_methods`, `allowed_status_transitions`.

**Enforced by the schema** (proven by tests that try to break them with raw SQL):
* status values / invoice status values (`CHECK`)
* status changes only along diagram edges (`BEFORE UPDATE` trigger fed from the TypeScript transition table — single source of truth)
* subscriptions inserted only as `trialing` (trigger)
* `canceled ⇔ canceled_at IS NOT NULL`; canceled ⇒ no `next_billing_at`
* at most one `open` invoice per subscription (partial unique index)
* one invoice per subscription period; unique attempt idempotency keys; unique `event_id`

**Asserted by the suite after every test** (`InvariantChecker`, runs in `afterEach`):
1. `active` ⇒ at least one succeeded payment attempt on a paid/refunded invoice of that subscription.
2. `canceled` ⇒ `canceled_at` set, nothing scheduled, no open invoice.
3. `past_due` ⇒ exactly one open invoice.
4. No invoice has more than one succeeded attempt; `paid`/`refunded` invoices have exactly one.
5. Every provider call ↔ exactly one attempt row (same idempotency key, amount, invoice reference). No idempotency key reused across calls.
6. Invoice amount = price of the invoice's plan; attempt amount = invoice amount.
7. Audit trail is a coherent chain: starts `created → trialing`, each status change starts where the last ended, and ends at the subscription's current status.
8. Each `webhook_events` row has exactly one non-duplicate delivery; every delivery points to an event.
9. Timestamps are coherent (`period_end > period_start`, `paid_at ≥ created_at`, `resolved_at ≥ created_at`, `updated_at ≥ created_at`).
10. **API ⇔ DB**: for every subscription row, `GET /subscriptions/{id}` returns the same state.

Running these globally means *every* scenario, including ones written for an unrelated reason, also
proves the invariants — and a new scenario gets them for free.

**Seeding and cleanup.** Each test gets a brand-new in-memory database, clock, mock provider and app
(`useTestEnvironment()`); there is nothing to clean and no shared state between tests. States are reached
**through the public API and webhooks** (`LifecycleDriver`), never by inserting rows, so a test can never
start from a state the service could not have produced.

**Avoiding false positives from stale data.** Fresh DB per test; random IDs; assertions scoped to the
subscription under test; "nothing was written" checks compare whole-table row counts before/after.

## 6. Webhook and idempotency strategy

* Processing is one DB transaction: look up `event_id` → if seen, record a duplicate delivery and stop;
  else apply business logic, record the event with its outcome, record the delivery. A crash rolls back
  everything, so the provider's redelivery is processed cleanly.
* `event_id` is the primary key of `webhook_events`; the DB is the backstop if the application check is bypassed.
* A redelivery with the same `event_id` but a different body is still a duplicate — the first payload is
  the one stored.
* Ordering is handled per **invoice** and per **attempt**, not by event timestamps: a `payment.failed`
  for an already-`paid` invoice, or for an attempt already resolved, cannot move the subscription.
* Tests prove: one transition, one invoice/attempt state change, one notification, one audit entry,
  zero extra provider calls — for 2 sequential and 5 parallel deliveries.

## 7. Design patterns (planned → where they ended up)

| Pattern | Where | Problem it solves |
|---|---|---|
| **Explicit transition table (state machine)** | `src/domain/SubscriptionStateMachine.ts`, used only by `SubscriptionRepository.applyTransition` | Status is never assigned directly; callers pass a *trigger* and the table decides. Same table feeds the DB trigger. |
| **Strategy** | `PlanPolicy` + `PlanCatalog` (`src/plans`) | Price, trial, period and retry rules vary by plan without `if (plan === 'pro')` branches in billing code. |
| **Adapter seam / DI** | `PaymentProvider` interface (`src/payments`), injected via `buildContainer` | Tests swap in `MockPaymentProvider`; no network. |
| **Builder** | `test/support/builders/*` | Requests, customers and webhook payloads read as intent; invalid variants (`.without('plan')`) without object-literal noise. |
| **Repository** | `src/persistence/repositories/*` (service) and `PersistenceInspector` (tests, read-only, independent SQL) | SQL lives in one place per side; tests never inline queries. |
| **Facade** | `TestEnvironment` | One object wires DB, clock, provider, app, clients and inspector; specs read `env.api`, `env.db`, `env.provider`. |

## 8. Risks and known limitations

* Single-process: webhook handling is synchronous inside a transaction, so parallel deliveries in the
  tests serialise in the event loop. That proves application-level idempotency but not multi-instance
  races; the `event_id` primary key is what would protect those, and it is tested directly.
* No retry of timed-out charges with the same idempotency key — outcome is left to the webhook. A
  production system also needs a reconciliation job for attempts that never get a webhook.
* Webhooks that report money taken for a canceled/void invoice are recorded as `ignored`; a real
  system would trigger an automatic refund or manual review.
