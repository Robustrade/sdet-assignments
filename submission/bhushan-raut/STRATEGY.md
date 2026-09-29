# Test Strategy — Subscription & Billing Service

**Author:** Bhushan Raut
**Status:** Implemented. This document was written first; it has since been updated so every file, class and method it names exists in the code.

This document says how I validate the Subscription & Billing Service before I write the automation. It covers the assumptions, what is real and what is mocked, the framework design and patterns, the persistence model, the invariants, and the scenario catalogue the tests implement.

---

## 1. Understanding of the problem

The service manages a **stateful, billed resource**. A subscription's status changes because of two independent inputs:

1. **Synchronous API calls**: create and cancel.
2. **Asynchronous webhooks** from an external payment provider. These can arrive **more than once**, **out of order**, or **forged**.

Most of the risk is not in the endpoints. It is in what happens across them:

- a stray or late webhook reactivating a canceled subscription
- a redelivered event charging or invoicing twice
- the API saying `active` while the database holds only a failed payment

So the suite focuses on **state-machine correctness, idempotency and persistence consistency**. Response codes are checked, but they are not the main target.

---

## 2. System under test: Option 3 (Hybrid)

No service is provided, so I will build a **minimal service fixture** and treat it strictly as the SUT. Around it sits an object-oriented test framework, and the payment provider is replaced by test doubles.

| Component | Real / Double | Why |
|---|---|---|
| HTTP layer (Express) | **Real** | Tests go through real routing, JSON parsing and status codes via Supertest. |
| Domain: state machine, plan rules | **Real** | This is the behaviour under test. |
| Persistence (SQLite in-memory via Node's built-in `node:sqlite`) | **Real** | Real SQL, real `UNIQUE` constraints and real transactions. Tests query it directly. |
| Webhook signature verification (HMAC-SHA256) | **Real** | Forged and unsigned payloads must be rejected by real code. |
| Payment provider client | **Mock** (`MockPaymentProvider`) | External dependency. It is scripted to return success, decline or timeout, and it records every call. |
| Webhook delivery | **Simulated** (`WebhookSimulator`) | The test plays the provider: it builds signed or invalid payloads and posts them. |
| Clock | **Fake** (`FakeClock`) | Trial expiry and retries need deterministic time. |
| Notifier (e.g. "subscription activated" email) | **Spy** | Proves that side effects fire exactly once under duplicate delivery. |

The fixture is kept deliberately small. It exists so that the tests have something realistic to prove.

---

## 3. Assumptions

**Plans** (configured through `PlanCatalog`):

| Plan | Price | Trial |
|---|---|---|
| `basic` | 1900 USD cents / month | 14 days |
| `pro` | 4900 USD cents / month | 0 days (charged immediately) |

**Lifecycle.** Every subscription is created in `trialing`. A plan with a 0-day trial runs its first billing attempt within the create request. This keeps **one code path**: the first charge always goes through the `trialing → active | past_due` transitions. There is no hidden "created as active" shortcut.

**Billing trigger.** A billing run (trial end, renewal, retry) is triggered by `POST /internal/billing/run` with `{ subscription_id }`. This stands in for a scheduler, and tests call it after advancing `FakeClock`.

**Charge outcomes:**

| Provider result | Payment attempt | Subscription status |
|---|---|---|
| `succeeded` | `succeeded` | active |
| `declined` | `failed` | past_due |
| `timeout` | `pending` | unchanged |

A timeout leaves the outcome unknown, so the final result arrives by webhook. The provider is always called with an **idempotency key** `inv_<id>:attempt:<n>`, which makes a retry of a timed-out attempt safe.

**Retries.** A `past_due` subscription is retried up to **3 times**. After the last failure it moves to `canceled` (retries exhausted).

**`payment.refunded`.** This marks a `paid` invoice as `refunded`. It does **not** change subscription status, because the brief's lifecycle diagram defines no transition for it. The audit log records lifecycle transitions only, so a refund is traced through the invoice and its `webhook_events` row.

**Webhooks settle pending charges.** A `payment.succeeded` or `payment.failed` webhook is applied only if it settles a charge still marked `pending` on that invoice. If nothing is pending, the outcome is already known locally and the event is recorded as `ignored_stale`. This one rule handles late, reordered and re-sent events.

**Webhook response codes:**

| Case | Response | Effect |
|---|---|---|
| Valid event | `200` | Applied |
| Duplicate event | `200` | No-op |
| Stale event, or event that would be an invalid transition | `200` | Ignored |
| Invoice unknown, or belongs to a different subscription | `200` | Ignored (`ignored_unknown_reference`) |
| Amount or currency differs from the invoice | `200` | Ignored (`ignored_amount_mismatch`) |
| Bad signature | `401` | Nothing persisted |
| Malformed body | `400` | Nothing persisted |

Returning 200 on ignored events stops a real provider from redelivering forever. The outcome is still recorded on the event row, so tests can assert it.

**Cancel** stops future billing: the billing run refuses a `canceled` subscription. Canceling an already-canceled subscription returns `409`.

**Unknown customer** returns `422`. Customers and payment methods are seeded by fixtures, so there is no customer API.

---

## 4. Subscription state machine (the contract under test)

```text
trialing --TRIAL_CHARGE_SUCCEEDED--> active
trialing --TRIAL_CHARGE_FAILED-----> past_due
active   --RENEWAL_CHARGE_FAILED---> past_due
past_due --RETRY_SUCCEEDED---------> active
past_due --RETRIES_EXHAUSTED-------> canceled
active   --CANCEL_REQUESTED--------> canceled
trialing --CANCEL_REQUESTED--------> canceled
```

It is an **explicit transition table** (`Record<Status, Partial<Record<Trigger, Status>>>`). `SubscriptionStateMachine.apply(current, trigger)` returns either a frozen `Transition` or an `InvalidTransition` result. `Transition` is a **branded type**: only `apply()` can create one, and hand-building one is a compile error, which the spec proves with `@ts-expect-error`. `SubscriptionRepository.applyTransition` accepts only a `Transition`, so no call site can write a raw status string.

The spec keeps an **independent copy of the brief's diagram** as the source of expected results. It does not import the implementation's table, because a wrong entry there would then agree with itself. Tests are generated from that copy:

- All 7 valid `(from, trigger)` pairs are exercised end to end.
- Every pair not in the table is asserted invalid. This covers 17 invalid pairs (4 statuses × 6 triggers − 7 valid), well above the minimum of two. The highest-value ones also get full end-to-end tests:
  - `canceled` + `payment.succeeded` webhook: stays canceled.
  - `active` + a late `payment.failed` for an already-paid invoice: stays active.
  - `canceled` + cancel API: `409`, no audit row.

---

## 5. Persistence model and what is checked

| Table | Key columns | Invariants asserted |
|---|---|---|
| `subscriptions` | id, customer_id, plan, status, trial_ends_at, retry_count, canceled_at, updated_at | Matches the API `GET` at every stage. `canceled_at` is set if and only if status = canceled. |
| `invoices` | id, subscription_id, amount, currency, status (`open/paid/failed/refunded`), period | Amount and currency equal the plan price. At most one `paid` invoice per period. |
| `payment_attempts` | id, invoice_id, attempt_no, idempotency_key **UNIQUE**, provider_ref, status, created_at | One row per genuine provider call. There are never two rows for the same idempotency key. |
| `webhook_events` | event_id **PK**, type, subscription_id, invoice_id, delivery_count, outcome (`applied`, `ignored_stale`, `ignored_invalid_transition`, `ignored_unknown_reference`, `ignored_amount_mismatch`), first_received_at | One row per event_id, keeping the outcome of its first processing. Redeliveries increment `delivery_count` rather than inserting rows. |
| `subscription_audit_log` | id, subscription_id, from_status, to_status, trigger, source (`api/webhook/billing`), reference, at | Forms an unbroken chain: each `from_status` equals the previous `to_status`, and the last `to_status` equals the current status. |

**Independent read path.** Tests verify persistence through a test-side `DbInspector` with its own SQL. They do not reuse the SUT's repositories. If the SUT's repository has a bug, tests that read through it would inherit the same bug and still pass.

**Isolation and stale data:**

- Every test gets a **fresh in-memory database**, a new mock provider and a reset clock through `TestEnvironment.create()`.
- IDs come from builders with per-test unique suffixes.
- Assertions look up rows by the exact ID returned from the API, never by "latest row".

As a result, no test can pass because of data left over from an earlier test.

---

## 6. Global invariants (checked automatically after every test)

An `InvariantChecker` runs in `afterEach` against the whole database. This means every scenario, including ones written later, also proves the system-wide rules:

1. **INV-1**: No subscription is `active` without at least one `succeeded` payment attempt persisted.
2. **INV-2**: No audit entry exists for a `canceled` subscription after its `canceled_at`. Canceled is terminal.
3. **INV-3**: `payment_attempts.idempotency_key` is unique, so there are no duplicate charges. The mock provider's recorded call count equals the number of `payment_attempts` rows.
4. **INV-4**: Every audit entry caused by a webhook points to exactly one `event_id` recorded as `applied`, and no event produces more than one audit entry.
5. **INV-5**: The audit chain is unbroken and ends at the current status.
6. **INV-6**: Invoice amounts match the plan's price for the subscription's plan. The price rule used at creation and at billing is the same.
7. **INV-7**: There are no contradictory records:
   - a `paid` or `refunded` invoice has exactly one succeeded attempt, and any other invoice has none
   - a `past_due` subscription has at least one failed attempt
   - an invoice never has more than one charge in flight at once

`TestEnvironment` also fails a test if the mock provider received a charge that no test scripted, or if a scripted outcome was never used, so both unexpected and missing charges are caught.

An eighth invariant is checked per test, because it needs the API response:

- **INV-8**: The API `GET /subscriptions/{id}` response equals the persisted row. `expectConsistent(subId)` asserts this after each significant step.

---

## 7. Framework design and patterns

```text
submission/bhushan-raut/
  src/                              # SUT fixture
    domain/     SubscriptionStateMachine.ts (transition table + branded Transition), PlanCatalog.ts
    provider/   PaymentProvider.ts            (interface only: the seam)
    persistence/ schema.ts, database.ts, *Repository.ts
    services/   SubscriptionService.ts, BillingService.ts, WebhookProcessor.ts
    http/       app.ts, webhookSignature.ts
    clock.ts, notifier.ts
  test/
    framework/
      env/        TestEnvironment.ts          (fixture factory: wires DB, mocks, app, clock)
                  Given.ts                    (drives a subscription into a start state via the API)
      clients/    SubscriptionApiClient.ts, WebhookClient.ts
      doubles/    MockPaymentProvider.ts, WebhookSimulator.ts, SpyNotifier.ts, FakeClock.ts
      builders/   CustomerBuilder.ts, SubscriptionRequestBuilder.ts, WebhookEventBuilder.ts
      verify/     DbInspector.ts, SubscriptionAssertions.ts, InvariantChecker.ts
    specs/
      api/  lifecycle/  webhooks/  provider/  e2e/  concurrency/
```

| Pattern | Where | Problem it solves |
|---|---|---|
| **State (transition table)** | `src/domain/SubscriptionStateMachine.ts` | Makes illegal transitions structurally impossible. The branded `Transition` type means persistence code cannot receive a status change that skipped the state machine. |
| **Builder** | `test/framework/builders/*` | Scenarios read as intent, for example `aWebhook().paymentFailed().forCharge(charge).withEventId(sameId).build()`. This avoids repeating object literals and lets me build deliberately invalid payloads (`.without('invoice_id')`, `.ofType('payment.unknown')`, `.with('amount', 1)`). Signing is a separate concern handled by `WebhookSimulator`. |
| **Strategy / dependency injection** | `PaymentProvider` interface injected into `BillingService`; `MockPaymentProvider` in tests | Lets tests substitute scripted success, decline or timeout, and record arguments without any network. |
| **Strategy** | `PlanCatalog` returns a `PlanPolicy` (`price`, `trialDays`) per plan | Keeps plan branching out of the service code, and gives INV-6 a single rule to check against. |
| **Repository** | `src/persistence/*Repository.ts` in the SUT; `DbInspector` on the test side | No raw SQL scattered through services or specs. It also provides the independent read path from section 5. |
| **Factory** | `TestEnvironment.create()`, registered per test by `useTestEnvironment()` | One place wires DB, clock, mock provider, notifier and app for each test, so isolation is guaranteed rather than remembered. The same hook runs the invariant check on teardown. |

`Given` is a plain helper, not a named pattern. It reaches start states such as `pastDueSubscription()` through the public API and the mock provider, never by inserting rows, so every precondition is itself an invariant-checked path.

I will only name a pattern in the PR if it is present in the code as described here.

**Layer rule:** specs call only clients, builders, doubles and verification helpers. They never touch Express, SQL or `vi.fn()` internals directly. This keeps a failing test's intent obvious and keeps specs stable if the transport or database changes.

---

## 8. Mock provider and webhook strategy

**`MockPaymentProvider`** implements `PaymentProvider.charge({ customerId, paymentMethodId, amount, currency, idempotencyKey })`.

- Outcomes are scripted per call and queued in order: `.willSucceed()`, `.willDecline('card_declined')`, `.willTimeout()`, and `.willSucceedWhenReleased()` (holds the charge in flight until the test releases it; used by X1).
- An unscripted charge throws, and a scripted outcome left unused fails the test on teardown.
- It records every call in `provider.calls`. Specs assert the **exact arguments** with `toEqual`, including amount, currency, customer, payment method, idempotency key and invoice metadata, not only that a call happened.
- The negative case is `expect(provider.calls).toHaveLength(n)` with the count unchanged. It is used for rejected creations, replayed webhooks, billing before the trial ends, and billing runs on canceled subscriptions.

**`WebhookSimulator`** signs the **raw body** with the shared test secret, using the same HMAC-SHA256 scheme the SUT verifies. It has its own HMAC code rather than importing the SUT's signer, so a bug in the SUT's scheme cannot be mirrored by the tests. It can also produce:

- a missing signature, or one made with the wrong secret
- a body tampered with after signing
- malformed JSON
- a missing required field
- an unknown event type

**Proving idempotency:**

- Send the same signed event 2 or more times, including redelivery after a later event has already been processed.
- Assert all of the following:
  - exactly one status transition
  - exactly one audit entry
  - `delivery_count` equals N, with outcome `applied` on the single row
  - no new invoice or payment rows
  - the notifier was called once
  - the provider was called zero extra times
- This is also enforced at the database level by the `event_id` primary key, so the test proves the application check and the constraint together.

**Out-of-order and stale events:**

- A `payment.failed` for an invoice that is already `paid` is recorded as `ignored_stale`. Status is unchanged.
- A `payment.succeeded` for a canceled subscription is recorded as `ignored_invalid_transition`.

---

## 9. Scenario catalogue

| ID | Area | Scenario | Key assertions |
|---|---|---|---|
| A1 | Create | basic plan → `trialing`, trial_ends_at = now + 14d, no charge | API = DB, no provider call, audit `∅→trialing` |
| A2 | Create | pro plan + charge succeeds → `active` | provider called once with 4900/USD/pm/key, invoice paid, notifier ×1 |
| A3 | Create | pro plan + decline → `past_due` | attempt failed, no paid invoice, INV-1 |
| A4 | Create | pro plan + timeout → `trialing`, attempt pending; later `payment.succeeded` webhook → `active` | ambiguous outcome resolved by webhook |
| B1–B5 | Validation | unknown plan, missing customer_id, unknown customer, missing/invalid payment_method_id, cancel twice | 4xx + error shape, **no rows written**, no provider call |
| C1 | Payment failure | trial end + decline → `past_due` | failed attempt persisted, no success record |
| C2 | Payment failure | active renewal decline → `past_due` | as above |
| C3 | Retries | past_due retry succeeds → `active`; retry_count reset | attempt_no increments, new idempotency key |
| C4 | Retries | 3 failed retries → `canceled` | provider called exactly 3 retry times, then never again |
| D1 | Idempotency | same `payment.succeeded` event ×2 | single transition/audit/notification, delivery_count = 2 |
| D2 | Idempotency | same `payment.failed` event ×2 | retry_count incremented once |
| D3 | Idempotency | redelivery of an old event after newer events | no regression, no new rows |
| E1 | State machine | all 7 valid transitions (table-driven) | audit chain, API = DB |
| E2 | State machine | all 17 invalid pairs (generated) | rejected or ignored, status unchanged |
| E3 | State machine | `payment.succeeded` on canceled subscription | stays canceled, outcome `ignored_invalid_transition` |
| E4 | Out of order | `payment.failed` after `payment.succeeded` for the same invoice | stays active, outcome `ignored_stale` |
| E5 | Cancel | cancel stops billing: billing run after cancel | no provider call, 409 `subscription_canceled` |
| F1–F3 | Webhook HTTP | bad signature / tampered body / malformed JSON | 401/401/400, **nothing persisted** (not even a webhook_events row) |
| F4 | Refund | `payment.refunded` | invoice refunded, status unchanged, no audit entry |
| G1 | E2E | full journey: create basic → trial end decline → retry success → renewal → cancel → stray success webhook | API = DB at **every** step, invariants hold |
| X1 (bonus) | Concurrency | two different events for the same subscription posted in parallel with `Promise.all` | one valid final state, audit chain intact |

---

## 10. Workflow (Red → Blue → Green)

For each behaviour, in priority order (state machine → idempotency → failure handling → persistence consistency → API validation):

1. **Red**: write the spec using the framework API as I want it to read. It fails.
2. **Blue**: add the minimum fixture or SUT code needed to make it pass.
3. **Green**: refactor builders and assertions for reuse, keeping everything green.

The commit history on this branch shows that sequence for the core behaviours.

**Stack:**

- TypeScript (strict)
- Vitest
- Supertest
- Node 24 built-in `node:sqlite` (`:memory:`): no native build step, so nothing extra to install
- ESLint
- `tsc --noEmit`

`npm test` runs the whole suite in a few seconds with no external services.

---

## 11. Known limitations

- Single-process fixture. There is no real queue or scheduler; the billing run is triggered explicitly.
- SQLite serialises writes, so the concurrency tests (X1) prove application-level idempotency but not behaviour under true database-level races as in Postgres. X1 does not rely on timing: `MockPaymentProvider.willSucceedWhenReleased()` holds a charge inside the provider, so the test acts while that charge is provably in flight.
- No proration, plan changes mid-cycle, taxes or multi-currency. These are non-goals in the brief.
- Provider timeouts are modelled as a thrown `ProviderTimeoutError`. Real-world network partial failures are approximated rather than reproduced.
- If a subscription is canceled while a charge is in flight, and the provider later reports that charge as succeeded, the event is recorded as `ignored_invalid_transition` and the attempt stays `pending`. A production system would record the capture and issue a refund automatically. That is out of scope here.
