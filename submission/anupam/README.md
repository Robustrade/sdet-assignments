# Subscription & Billing Service — SDET Submission

An object-oriented test framework plus a minimal service fixture (**Option 3 — Hybrid**)
for a subscription billing service with a mocked payment provider and signed webhooks.

## Run it

```bash
npm install
npm test            # 99 tests, ~5s
npm run build       # tsc --noEmit (strict)
npm run lint        # eslint
npm run validate    # all three
```

No database or network setup is needed. Persistence is an embedded in-memory DB that
is created fresh for every test (see "Seeding & isolation").

## Layout

```
src/                              SERVICE FIXTURE (system under test)
  domain/SubscriptionStateMachine.ts   transition table (State machine)
  domain/plans.ts                      Plan strategies + PlanCatalog
  ports/PaymentProvider.ts             provider interface (seam)
  persistence/repositories.ts          Repository pattern
  services/LifecycleManager.ts         the ONLY place status changes
  services/BillingEngine.ts            charges, settles outcomes
  services/WebhookService.ts           signature -> parse -> idempotency -> apply
  http/createApp.ts                    Express routes
  app/container.ts                     composition root (DI)

test/support/                     TEST FRAMEWORK
  TestEnvironment.ts        Factory/Facade: isolated world per test
  MockPaymentProvider.ts    scripted success/decline/timeout + call recording
  WebhookSimulator.ts       signed / forged / tampered / malformed deliveries
  SubscriptionApiClient.ts  typed HTTP client
  ConsistencyVerifier.ts    API == DB == expected
  InvariantChecker.ts       global business invariants (run after every test)
  ScenarioDriver.ts         "given" steps built from real flows
  builders/                 Customer, SubscriptionRequest, WebhookEvent builders

test/specs/
  unit/          state machine table, plan strategies
  api/           REST contract + validation, webhook endpoint security
  workflow/      every lifecycle transition + invalid transitions (with coverage tracker)
  integration/   webhook idempotency, provider interaction
  persistence/   DB at every stage, audit trail, invariant-checker self-tests
  e2e/           one full journey
```

## Test strategy (summary)

| Level | What is proven | Where |
|---|---|---|
| Unit | Transition table equals the spec diagram, and nothing else is allowed | `unit/state-machine.spec.ts` |
| API | Status codes, payload shape, 400/404/409/422 errors, no side effects on rejection | `api/*` |
| State machine | All 7 diagram transitions via real triggers, plus 6 invalid or stale cases | `workflow/lifecycle.spec.ts` |
| Persistence | Rows match the API at every stage; audit trail; ledger of duplicates | `persistence/*` |
| External integration | Call count, exact arguments, idempotency keys; decline and timeout behaviour | `integration/payment-provider.spec.ts` |
| Idempotency | Same `event_id` N times gives one effect; cross-channel duplicates | `integration/webhook-idempotency.spec.ts` |
| E2E | API + scheduler + provider + webhooks together | `e2e/*` |

### Real vs. fake

| Component | Real / Fake | Why |
|---|---|---|
| HTTP layer, services, state machine, repositories, DB | **Real** | This is what we're testing |
| HMAC signature verification | **Real** | Security logic must be exercised |
| Payment provider | **Mock** (`MockPaymentProvider`) | External, non-deterministic, costs money |
| Webhook sender | **Simulator** (signs independently with `node:crypto`) | Plays the provider's role |
| Clock | **Fake** (`FakeClock`) | Trials and renewals need controllable time |
| Scheduler/cron | `env.runBilling(id)` calls `BillingEngine.runDue` | No real scheduler in scope |
| Notifications | **Spy** (`RecordingNotifier`) | Proves side effects fire once |

## Assumptions

- Every subscription starts in `trialing`. The pro plan has a **0-day trial**, so it is charged
  at signup. This fits the diagram: "trial ends, first charge succeeds/fails".
- basic = $19.00, 14-day trial, 2 retries. pro = $49.00, no trial, 3 retries. Periods are 30 days.
- `failedAttempts` counts the first failure plus each failed retry. The subscription is
  canceled when `failedAttempts > maxRetries`.
- `past_due → canceled` via the API is **rejected** (409) because it is not in the diagram.
  This is a deliberate reading of "any transition not shown is invalid".
- **Provider timeout = unknown outcome.** The service records a `pending` payment, makes no
  transition, and refuses to re-charge that invoice until a webhook resolves it.
- Webhooks **resolve** outcomes; they don't create new attempts:
  - `payment.succeeded` is authoritative for any unpaid invoice.
  - `payment.failed` only counts if it resolves a `pending` attempt. This stops a sync
    decline plus its echo webhook from counting as two failures.
- A paid invoice ignores all later success/failure events, which makes out-of-order delivery safe.
- Webhooks for canceled subscriptions are acknowledged (200) but ignored.
- A refund marks the invoice `refunded` and adds a refund row; it does **not** change lifecycle state.
- Unknown subscription or invoice, or an amount mismatch, returns **200 ignored**, recorded with a
  reason, so the provider stops redelivering. A bad signature returns 401; a malformed body returns 400.

## API contract

| Method | Path | Success | Errors |
|---|---|---|---|
| POST | `/subscriptions` | 201 `SubscriptionDto` | 400 `validation_error`, 422 `unknown_plan` / `unknown_customer` / `invalid_payment_method` |
| GET | `/subscriptions/:id` | 200 | 404 `not_found` |
| POST | `/subscriptions/:id/cancel` | 200 | 404, 409 `invalid_transition` |
| POST | `/webhooks/payment-provider` | 200 `{event_id, status: processed\|ignored\|duplicate, reason}` | 401 `invalid_signature`, 400 `malformed_payload` |

Error shape: `{ "error": { "code", "message", "details" } }`.

## Database entities & invariants

Entities: `subscriptions`, `invoices`, `payments`, `webhook_events` (idempotency ledger with
`deliveryCount`), and `audit_log`.

`InvariantChecker` runs after **every** test (`env.assertCleanTeardown()`):

| ID | Invariant |
|---|---|
| I1 | `active` ⇒ at least one succeeded payment |
| I2 | ≤ 1 succeeded payment per invoice (no double charge) |
| I3 | invoice paid/refunded ⇔ exactly one success, and `paidAt` is set |
| I4 | failed invoice ⇒ a failed payment row exists |
| I5 | invoice amount = plan price, and payment amount = invoice amount |
| I6 | audit trail is a legal, gap-free walk through the state machine ending at the current status (so `canceled` never moves again) |
| I8 | `canceledAt` is set ⇔ status is `canceled` |
| I10 | ≤ 1 pending attempt per invoice |
| I11 | no webhook event stuck in `processing` |
| I12 | `updatedAt ≥ createdAt` |
| I13 | the provider was never called twice for the same attempt (idempotency key) |

The checker is itself tested: `persistence.spec.ts` deliberately corrupts a scratch DB and
asserts the violations are reported.

## Seeding & isolation

`TestEnvironment.create()` in `beforeEach` gives each test a new DB, id sequence, clock,
mock and app. Nothing is shared, so there is no cleanup step and no stale data.
Subscriptions reach a given state only through real flows (`ScenarioDriver`), never through
direct row inserts. The one exception is the invariant-checker self-test, which corrupts
data on purpose.

The mock is **strict**: an unscripted charge throws, and leftover scripted outcomes fail the
teardown. This catches both hidden charges and tests that "expect" a charge that never happened.

## Webhook / idempotency strategy

The service processes a webhook in this order:

1. Verify HMAC-SHA256 over the **raw** body (constant-time compare). The route is registered
   before `express.json()` so the raw body is available.
2. Parse and validate the payload.
3. Look up `event_id` in `webhook_events`. If it exists, increment `deliveryCount`, audit
   `webhook.duplicate_ignored`, and return 200 `duplicate`.
4. Claim the event (`processing`), apply it, and store the outcome and reason. If an unexpected
   error happens, the claim is released so the provider's redelivery can succeed.
5. Business-level dedupe (invoice already paid, no outstanding attempt) covers duplicates that
   arrive with *different* event ids.

## Known limitations

See `docs/INTERVIEW_PREP.md` → "Optimisations / next steps".
