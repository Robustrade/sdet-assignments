# Test Strategy — Subscription & Billing Service

Status: **design document plus implementation log.** Sections 1-10 are the up-front design; section 11 records what Phase 3 (payment provider integration) built; section 12 records what Phase 4 (webhook processing and persistence) built, including where it deliberately differs from the earlier design text; section 13 records what Phase 5 (billing run: trial end, recurring charges, retries, and the end-to-end flows) built. Section 14 records the Phase 5 review (mutation check and required-vs-optional findings); section 15 records the final verification. Plan change and a notifier are **not built**; everything below that refers to them is design that was not implemented (each such place is marked). Where sections 11 and 12 say the billing scheduler is not built, section 13 supersedes them. Where the early design text (sections 1-10) differs from the code, the implementation logs (11-14) and the file list in section 15 are authoritative.

## 1. Scope and Assumptions

**Approach:** Option 3 (hybrid). A small in-memory TypeScript service fixture (Express) plus test doubles for the payment provider and clock (a notifier double was designed but never built). The effort goes into the test framework, not the product.

**In scope:** API contract, lifecycle state machine, persistence (in-memory), provider interaction, webhook handling (signature, duplicates, out-of-order), and end-to-end flows.
**Out of scope:** UI, real provider, performance, taxes/proration/multi-currency. Concurrent webhooks are a bonus, covered last if time allows.

**Real vs. test double**

| Component | Real or double | Reason |
|---|---|---|
| Express app, routes, signature check, BillingService, state machine | Real (SUT) | This is what we verify |
| In-memory repositories | Real | Queryable by tests, a stand-in for the DB |
| `PaymentProvider` | **Mock** (`MockPaymentProvider`) | External dependency; need success/decline/timeout and call recording |
| `Notifier` (e.g. "payment failed" email) | **Not built** (design only) | Would prove duplicate webhooks fire no second side effect; the assignment makes this conditional ("if your fixture models one"), so the same property is asserted on state, invoices, audit, event rows and provider calls instead |
| `Clock`, `IdGenerator` | **Fake/deterministic** | Trial expiry without sleeping; stable IDs and timestamps |
| HTTP | Real, in-process via Supertest | No ports, no network |

**Assumptions (my interpretation of the spec, stated up front)**

- **Plans** (config table, not logic): `basic` = 1900 USD cents, 0-day trial; `pro` = 4900 USD cents, 14-day trial.
- **Initial state is always `trialing`.** A 0-day trial (`basic`) makes the first charge happen immediately during `POST /subscriptions`, so the response shows `active` or `past_due`. `pro` stays `trialing` until a billing run after `trial_ends_at`. This keeps the lifecycle diagram intact with no extra states.
- **Charge outcomes** are applied through the same state-machine path as webhooks. The provider's synchronous result: `succeeded` is treated like `payment.succeeded`, `declined` like `payment.failed`.
- **Timeout** means the outcome is *unknown*: the invoice stays `pending`, subscription state does not change, and a retry reuses the same idempotency key. If a timeout happens during `POST /subscriptions`, the response is `504`, and **no** subscription, invoice or audit row is persisted (creation is atomic). The provider may have charged; the idempotency key makes the retry safe.
- **Retries exhausted:** `maxChargeAttempts = 3` consecutive failed invoices while `past_due` triggers `retries_exhausted` and the subscription becomes `canceled`.
- **`payment.refunded`:** marks the invoice `refunded`; subscription state is unchanged (no refund transition exists in the lifecycle).
- **Invoice terminal states** (`paid`, `failed`, `refunded`) are never overwritten by later events. This single rule also handles most out-of-order cases.
- **Webhooks** are acknowledged with `200` when valid, even if the business outcome is "ignored", so the provider stops retrying. Rejections use 4xx.
- **Seeded customers:** `cust_001`, `cust_002`. Payment method IDs must match `pm_*`.

**Alignment review (assignment is the primary source)**

- The assignment lists "unknown customer" under *validation errors* (it is a body reference, not a missing URL resource), so it is now `422 customer_not_found`, not `404`.
- The assignment lets a plan be "trialing or charged immediately". The `trialing` + 0-day-trial model above is equivalent and keeps the lifecycle diagram unchanged. In phase 1 (no provider) a `basic` subscription stayed `trialing`; since Phase 3 the immediate charge is implemented and tested (section 11).
- "Plan changes" and a per-plan Strategy are suggestions, not requirements of "Core Operations"; neither is built.
- Provider-call assertions on rejected creation (spec section B/F) are implemented in Phase 3 (`specs/provider/rejectedRequests.test.ts`); the former `it.todo`s are gone.
- Implementation status is tracked by passing tests only; a requirement is not considered done until a test verifies it.

## 2. Framework Architecture and Folder Structure

```text
submission/naveen-lal-ghodkar-katika/
  TEST_STRATEGY.md
  src/                              # minimal service fixture (SUT)
    app.ts                          # createApp(deps) - composition entry point (keeps /health)
    domain/
      plans.ts                      # plan config table
      SubscriptionStateMachine.ts   # transition table + Subscription aggregate
    providers/PaymentProvider.ts    # interface, ChargeRequest/Result, ProviderTimeoutError
    persistence/                    # InMemory{Subscription,Invoice,WebhookEvent,AuditLog}Repository
    services/                       # BillingService, WebhookService, BillingScheduler (trial end/retries)
    http/                           # routes, raw-body capture, HMAC signature verification
  tests/
    setup.smoke.test.ts             # existing sample test (unchanged)
    framework/                      # reusable test infrastructure, no assertions about scenarios
      env/TestEnvironment.ts        # builds a fresh, isolated app + repos + doubles per test
      clients/BillingApiClient.ts   # typed Supertest wrapper (create/get/cancel/postWebhook)
      doubles/                      # MockPaymentProvider, FakeClock, withLatency (no notifier double was built)
      webhooks/WebhookSimulator.ts  # signs payloads; forged/unsigned/malformed variants
      builders/                     # SubscriptionRequestBuilder, WebhookEventBuilder, SubscriptionRecordBuilder, InvoiceRecordBuilder
      assertions/                   # BillingAssertions (API), PersistenceAssertions (repos), ProviderAssertions
    specs/
      api/                          # contract + validation
      lifecycle/                    # valid + invalid transitions
      webhooks/                     # signature, idempotency, out-of-order
      persistence/                  # row-level + coherence invariants
      provider/                     # call count + arguments, success/decline/timeout
      e2e/                          # full flows with a coherence check at each step
```

Layering rule: **specs** use the **API client**, **builders** and **assertions** only. They never touch Express, `supertest` or repository internals directly. Only `framework/` knows about transport and storage.

**Isolation / no stale data:** `TestEnvironment.create()` runs in `beforeEach` and builds new repositories, a new mock and a new clock. There is no module-level state and no shared singletons, so there is nothing to clean up and no cross-test leakage. Jest `clearMocks`/`restoreMocks` are already enabled.

**Seeding:** customers/plans come from `TestEnvironment` defaults. A subscription in an arbitrary state (e.g. `past_due` with 2 failed invoices) is seeded by `TestEnvironment.seedBilling(...)` (using `SubscriptionRecordBuilder` and `InvoiceRecordBuilder`) through the repositories, so webhook tests do not have to replay a long API history. The seed path is separate from the state machine, so it is only used for arranging, never for the behavior under test.

## 3. API Contract and Validation Tests

Errors use `{ "error": { "code": string, "message": string } }`.

| Endpoint | Success | Failures |
|---|---|---|
| `POST /subscriptions` `{customer_id, plan, payment_method_id}` | `201` `{id, customer_id, plan, status, price, currency, trial_ends_at, created_at}` | `400 validation_error` (missing/non-string field, malformed JSON); `422 customer_not_found`; `422 invalid_plan`; `422 invalid_payment_method`; `504 provider_timeout` (basic plan only) |
| `GET /subscriptions/{id}` | `200` same shape | `404 subscription_not_found` |
| `POST /subscriptions/{id}/cancel` | `200` with `status: "canceled"` | `404`; `409 invalid_transition` (already canceled) |
| `POST /webhooks/payment-provider` + `X-Provider-Signature` | `200` `{status: "processed" \| "duplicate" \| "ignored"}` | `401 invalid_signature` (missing/wrong); `400 malformed_payload` (signed but invalid JSON/schema); `404 subscription_not_found` |

Specs (`tests/specs/api`):
- Create happy path for `basic` and `pro`: status code, payload shape, price and trial from plan config.
- Each validation failure above, **plus** the side-effect assertions: no repository rows written, `provider.charge` not called.
- GET returns exactly what POST returned; unknown id gives 404.
- Cancel happy path; double cancel gives 409 and no extra audit entry.
- Webhook request handling in isolation from business logic: missing signature, wrong signature, valid signature over a tampered body, malformed JSON, missing fields, unknown `type`.

## 4. Subscription Lifecycle

The state machine is a **transition table keyed by `(state, trigger)`**. The aggregate exposes `apply(trigger)` as its only mutator and `status` is read-only, so no caller can assign a state directly.

Triggers: `charge_succeeded`, `charge_failed`, `retries_exhausted`, `cancel`.

**Valid transitions (each has at least one test, driven by API/webhook/scheduler as noted)**

| ID | Transition | Driven by |
|---|---|---|
| V1 | trialing -> active (trial ends, first charge succeeds) | `basic` creation w/ provider success; `pro` after clock advance + billing run |
| V2 | trialing -> past_due (trial ends, first charge fails) | provider decline at billing run; also `payment.failed` webhook |
| V3 | active -> past_due (recurring charge fails) | `payment.failed` webhook; recurring billing run w/ decline |
| V4 | past_due -> active (retry succeeds) | retry run w/ success; `payment.succeeded` webhook |
| V5 | past_due -> canceled (retries exhausted) | 3rd consecutive failed attempt |
| V6 | active -> canceled | `POST /cancel` |
| V7 | trialing -> canceled | `POST /cancel` |

**Invalid transitions (proven impossible, at API and webhook level)**

| ID | Attempt | Expected |
|---|---|---|
| I1 | `canceled` + `payment.succeeded` webhook | Stays `canceled`; event recorded as `ignored`; invoice and audit untouched |
| I2 | `canceled` + `payment.failed` / cancel again | Stays `canceled`; API cancel gives 409 |
| I3 | `active` + `payment.failed` for an invoice already `paid` (out-of-order) | Stays `active`; ignored |
| I4 | `retries_exhausted` trigger applied to a `trialing` or `active` subscription (state-machine level) | Rejected with `InvalidTransitionError`; no state change |
| I5 | `active` + `payment.succeeded` for a new event on an already `paid` invoice | No state change; no second invoice row |

Unit-level table test: iterate over **all** `(state x trigger)` pairs and assert that exactly the 7 valid ones succeed and the other pairs throw `InvalidTransitionError`. This makes the diagram itself the test oracle.

## 5. Mock Payment Provider

```ts
interface PaymentProvider { charge(req: ChargeRequest): Promise<ChargeResult>; }
// ChargeRequest: { customerId, paymentMethodId, amount, currency, idempotencyKey, reference }
// ChargeResult:  { status: 'succeeded' | 'declined', providerChargeId?, declineCode? }
// Timeout:       rejects with ProviderTimeoutError
```

`MockPaymentProvider` implements it with configurable behavior (`succeed()`, `decline(code)`, `timeout()`, and per-call queues like `succeed().then(decline())` for retry flows). It wraps `jest.fn()` and exposes `calls`. `ProviderAssertions` offers intent-level helpers (`expectCharged({amount, customerId, paymentMethodId})`, `expectNoCharges()`, `expectCallCount(n)`).

| Behavior | Verified |
|---|---|
| Success | Subscription `active`, invoice `paid`, one charge |
| Decline | `past_due`, invoice `failed` with decline code, no "paid" record (notifier assertion dropped: no notifier built) |
| Timeout | State unchanged, invoice `pending`, 504 on creation with nothing persisted; retry uses the **same** idempotency key |
| Call count | Exactly 1 call per real billing attempt; 0 for rejected creation, replayed webhook, canceled subscription, and trial not yet ended |
| Arguments | `amount` and `currency` from the plan, `customerId`, `paymentMethodId` as submitted, `idempotencyKey` stable per invoice attempt, `reference` links to subscription/invoice |

## 6. Webhooks: Signature, Duplicates, Idempotency, Out-of-Order

**Signature:** HMAC-SHA256 (hex) over the **raw request body** with a shared secret, compared in constant time. `WebhookSimulator` provides `signed(event)`, `unsigned(event)`, `signedWithWrongSecret(event)`, `tamperedAfterSigning(event)` and `malformed()`. Signature/format failures are tested separately from business logic: they must return 401/400 and persist nothing, not even a `webhook_events` row.

**Idempotency strategy:** `webhook_events` is keyed by `event_id`. First delivery: processed, then stored with its outcome. Redelivery: found in the store, `delivery_count` incremented, response `{status: "duplicate"}`, **no** state change, invoice change, audit entry, provider call or notification.

| Scenario | Assertions |
|---|---|
| Same `event_id` twice | One transition; 1 invoice; 1 audit entry; `delivery_count == 2`; provider calls unchanged (notifier assertion dropped: no notifier built) |
| Same `event_id` ten times | Same as above (loop guards against off-by-one) |
| Different `event_id`, same invoice, same type | `ignored`; invoice and state unchanged |
| `payment.failed` after `payment.succeeded` (same invoice) | Stays `active`; invoice stays `paid` |
| `payment.succeeded` after `payment.failed` for same invoice | Documented behavior asserted (invoice `failed` is terminal -> ignored); noted as a limitation |
| `payment.succeeded` / `payment.failed` for a `canceled` subscription | `ignored`; stays `canceled`. (Phase 4 refinement: `payment.refunded` is still applied to the invoice, see section 12) |
| Event for unknown invoice on a known subscription | `ignored`, recorded |
| Event for unknown subscription | `404`, nothing persisted |

Bonus if time allows: two different events for the same subscription via `Promise.all`, asserting a legal final state and a coherent audit chain.

## 7. In-Memory Persistence Verification

Repositories: `subscriptions`, `invoices`, `webhook_events`, `audit_log`. Tests read through `PersistenceAssertions` (backed by the repositories), never through ad hoc inline queries.

| Entity | Key fields checked |
|---|---|
| subscription | `id`, `customer_id`, `plan`, `status`, `trial_ends_at` |
| invoice | `subscription_id`, `amount`, `currency`, `status` (`pending/paid/failed/refunded`), `attempt`, `idempotency_key` |
| webhook_event | `event_id` (unique), `type`, `outcome` (`processed/ignored`), `delivery_count` |
| audit_log | `subscription_id`, `from`, `to`, `trigger`, `source` (`api/webhook/scheduler`), `event_id?`, `at` |

**Invariants asserted by `expectCoherent(subscriptionId)` (originally designed as `assertCoherent`; the implemented list is in sections 12 and 13), run at every step of the e2e specs:**

1. API status equals persisted status.
2. `active` implies at least one `paid` invoice.
3. `past_due` implies the latest invoice is `failed`; consecutive failures never exceed `maxChargeAttempts`.
4. Every invoice amount/currency equals the plan price at the time.
5. The audit chain is contiguous (each `from` equals the previous `to`), starts at `trialing`, ends at the current status, and has no entries after `canceled`.
6. `event_id` is unique; a duplicate delivery changes only `delivery_count`.
7. Invoice `idempotency_key` is unique, so no double charge for one attempt.
8. Rejected requests (validation, bad signature) leave all four stores unchanged (compared with before/after snapshots).

## 8. End-to-End Scenarios and Commands

| ID | Flow |
|---|---|
| E1 | `basic` create -> charge success -> `active` -> webhook payment.succeeded (duplicate, ignored) -> cancel -> late payment.succeeded ignored |
| E2 | `pro` create (`trialing`, no charge) -> advance clock past 14 days -> billing run succeeds -> `active` |
| E3 | `pro` trial end declined -> `past_due` -> retry succeeds -> `active` (V2, V4) |
| E4 | `active` -> recurring decline -> `past_due` -> 3 failures -> `canceled`; later webhooks ignored (V3, V5, I1) |
| E5 | Provider timeout at billing run -> unchanged -> `payment.succeeded` webhook resolves it -> redelivered -> `duplicate` |
| E6 | Forged webhook rejected (401) at each point of a lifecycle; nothing persisted |

Each step ends with `expectCoherent`.

**Commands** (run from this folder)

```bash
npm install
npm test                                  # whole suite
npm run test:ci                           # CI mode (--ci --runInBand)
npm run test:coverage                     # with coverage
npm run typecheck                         # tsc --noEmit (same as `npm run build`)
npx jest tests/specs/lifecycle            # one area
npx jest -t "duplicate"                   # by test name
```

**Workflow (Red / Blue / Green):** for each area, write the failing spec first (Red), add the minimum service/framework code (Blue), then refactor while green (Green). Order: lifecycle table -> create API -> provider mock -> webhooks -> persistence invariants -> e2e. I will keep commits aligned to this order so the history shows the discipline.

## 9. Design Patterns (only where they solve a real problem)

| Pattern | Where | Problem solved |
|---|---|---|
| **State Machine** (transition table) | `SubscriptionStateMachine.ts` | API, webhooks and scheduler all change state; one table plus `apply()` means no ad hoc `status = ...`, and illegal transitions are unreachable. Also the oracle for the exhaustive transition test |
| **Builder** | `tests/framework/builders/*` | Scenarios read as intent (`aSubscription().onPlan('pro').withDeclinedCard()`), with no repeated object literals for requests, signed webhook payloads or seeded states |
| **Dependency injection + Strategy** (provider interface) | `PaymentProvider` -> `MockPaymentProvider`; same seam for `Clock` and `IdGenerator` (a `Notifier` seam was designed, not built) | Tests substitute the provider with success/decline/timeout behavior and record calls, with no network |
| **Repository** | `persistence/InMemory*Repository` | Service and tests share one query surface; swapping storage would not touch specs; assertions never use raw data structures |
| **Factory** (small) | `TestEnvironment.create()` and `createApp(deps)` | One place wires the service, doubles and repos fresh per test; avoids repeated setup and shared state |

I am deliberately **not** adding a Strategy per plan: plans differ only by data (price, trial days), so a config table is simpler. I would add the pattern only if plan-specific proration logic is introduced.

## 10. Limitations and Trade-offs

- In-memory storage: no transactional or durability guarantees are tested. Atomicity of "create + charge" is simulated by write-after-success ordering, not a real DB transaction. SQLite is intentionally not used.
- Single-process, no real concurrency: races are only approximated with `Promise.all` (bonus).
- Timeout-then-late-webhook and `succeeded` after `failed` on the same invoice follow my own assumptions, since the spec is silent. A real system would need reconciliation or refunds for money captured on a `canceled` subscription; here it is only recorded as `ignored`.
- Plan changes are listed under API-level scope in the assignment, but no endpoint is defined in "Core Operations". Decision: **not implemented** (no change-plan endpoint); this is a known gap against the assignment's wording.
- Billing "scheduler" is a method called explicitly by tests with a fake clock, not a real timer. Real cron/queue behavior is not covered.
- HMAC verification uses a shared test secret; key rotation and replay-window (timestamp) checks are out of scope.
- No linter or schema validation script is configured yet; the PR template mentions them. I'd add ESLint if required.
- The mock encodes my understanding of the provider contract; there is no contract test against a real provider.

## 11. Phase 3 Implementation Log: Payment Provider Integration

**Built (all driven test-first, see "Red/Blue/Green record" below).**

| Piece | Location | Role |
|---|---|---|
| `PaymentProvider` interface, `ChargeRequest/ChargeResult`, `ProviderTimeoutError` | `src/providers/PaymentProvider.ts` | The injectable seam. Dependency injection through `createApp({ paymentProvider })` |
| `UnconfiguredPaymentProvider` | `src/providers/` | Default when nothing is injected. Throws (HTTP 500) instead of approving or declining, so missing wiring cannot look like a payment decision |
| `BillingService.chargeInitial` | `src/services/BillingService.ts` | Only code that calls the provider. Maps price to a `ChargeRequest` and the answer to a state-machine trigger. Never sets a status |
| `SubscriptionService.create` | `src/services/SubscriptionService.ts` | Validates, then (0-day-trial plans only) charges, then applies the trigger through `Subscription.apply`, then saves once |
| `IdempotencyRepository` (in-memory) | `src/persistence/` | Maps an `Idempotency-Key` to a reserved subscription id and a request fingerprint |
| `MockPaymentProvider`, `ProviderAssertions` | `tests/framework/` | Test double (success / decline / timeout, one-shot queue, recorded calls) and intent-level assertions |

**Behavior and assumptions (my interpretation where the assignment is silent).**

- **Charge trigger:** a plan with `trialDays == 0` (`basic`) is charged inside `POST /subscriptions`; `pro` is not charged at creation (no provider call). The recurring/trial-end charge for `pro` is a later phase.
- **Charge request:** `amount`/`currency` come from the plan price, `customerId` and `paymentMethodId` are exactly what the client sent, `reference` is the subscription id and `idempotencyKey` is `initial:<subscription id>`.
- **Success:** `trialing -> active`, response `201`, subscription saved once, already `active`. The row does not exist while the provider is being called, so nothing can be observed as `active` before payment succeeded (asserted).
- **Decline:** `trialing -> past_due`, response `201` with `status: "past_due"`. This follows section 1 ("response shows `active` or `past_due`") rather than a 402. The decline code is not exposed in the response.
- **Timeout:** the outcome is unknown, so nothing is activated and **no subscription is saved**; response `504 provider_timeout`. Chosen over saving a `pending` subscription because there is no invoice store yet and the lifecycle has no "pending" state.
- **Idempotency of creation:** optional `Idempotency-Key` header (non-blank, at most 255 chars, else `400`). First use reserves a subscription id for the key *before* charging. Replays and retries:
  - same key, same request, subscription exists: `200` with the stored subscription (current state, not a snapshot), **no provider call**;
  - same key, same request, earlier attempt timed out: the reserved id is reused, so the retry sends the **identical** `ChargeRequest` (same key and reference) and the provider can deduplicate;
  - same key, different customer/plan/payment method: `409 idempotency_conflict`, no provider call.
- **Without the header** a retry is indistinguishable from a new request: it gets a new subscription id and a new provider key. This is a documented limitation and a test pins the behavior down.
- **Rejected requests** (validation, unknown plan/customer, bad payment method, malformed JSON, bad header) are rejected before the provider is reachable; asserted with a valid-looking `basic` request deviating in one way.
- **Reads and cancels never charge:** repeated `GET` and `cancel` leave the call count unchanged.

**What this phase deliberately does not verify (gaps, not hidden):**

- *(Resolved in Phase 4, section 12.)* No invoice/payment rows exist, so "active implies a persisted successful payment" and "a failure is recorded as an invoice/event" are only checked through the provider call record and the subscription status. This arrives with the expanded persistence phase.
- *(Resolved in Phase 4: `paymentMethodId` is stored.)* The payment method is not stored on the subscription, so later billing runs cannot be implemented without a schema addition.
- A decline on creation is not retried or recorded for the later `retries_exhausted` count.
- *(Webhooks and audit log: built in Phase 4. Billing scheduler and notifier: still not built.)* Webhooks, billing scheduler, audit log and notifier are untouched.
- Concurrent identical requests (same `Idempotency-Key` at the same instant) are not guarded: reservation and charge are not atomic. Single-process in-memory only; documented rather than tested.
- A timeout that is later resolved by a webhook (E5) needs the webhook phase.

**Red/Blue/Green record (this phase).**

1. **Red (stage 1):** wrote `MockPaymentProvider`, `ProviderAssertions` and three provider specs first; 10 suites failed to compile because `src/providers/PaymentProvider` did not exist.
2. **Red (stage 2):** added only the interface and the `paymentProvider` injection point (no behavior); 26 new tests failed on real assertions (e.g. basic stayed `trialing`, provider never called), while the 71 pre-existing tests and the mock's own tests still passed.
3. **Blue:** `BillingService`, charge-on-create, idempotency reservation, `504`/`409` error mapping, header parsing.
4. **Green:** full suite green; mutation spot checks (amount to 0, decline mapped to success, timeout not mapped, charge on all plans, idempotency fingerprint ignored, header ignored) each made specs fail, so the specs do guard these behaviors.

## 12. Phase 4 Implementation Log: Webhook Processing and Persistence

**Built.**

| Piece | Location | Role |
|---|---|---|
| `InvoiceRecord`, `WebhookEventRecord`, `AuditEntry` | `src/domain/` | Persisted shapes. Invoice statuses `pending / paid / failed / refunded` |
| `Invoice/WebhookEvent/AuditLog` repository interfaces + `InMemory*` | `src/persistence/` | Repository pattern; rows are stored and returned as copies; audit log is append-only |
| `paymentMethodId` on `SubscriptionRecord` | `src/domain/Subscription.ts` | Stored for later billing; never returned by the API (asserted) |
| `Subscription.can(trigger)` | `src/domain/SubscriptionStateMachine.ts` | Read-only question to the transition table, so services never branch on status strings. Checked against `apply` for every (state, trigger) pair |
| `retryPolicy` | `src/domain/retryPolicy.ts` | `MAX_CHARGE_ATTEMPTS = 3`, "consecutive failed invoices" rule |
| `WebhookService` | `src/services/WebhookService.ts` | Idempotency, invoice rules, transitions, audit, event record |
| `webhookRoutes`, `webhookSignature`, `webhookPayload` | `src/http/` | Raw-body capture (mounted before `express.json()`), HMAC-SHA256 check in constant time, payload validation |
| `KeyedMutex` | `src/support/KeyedMutex.ts` | Serializes work per subscription id; shared by webhooks and API cancel |
| `BillingService.chargeInitial` now returns `ChargeOutcome` | `src/services/BillingService.ts` | Carries provider charge id / decline code so the invoice can record them |
| `SubscriptionService` | `src/services/SubscriptionService.ts` | Now also writes the first invoice and audit entry for a `basic` creation, and an audit entry on cancel |

**Request handling order (webhook).** `401 invalid_signature` (missing/invalid header, forged, altered body; also when the body is not JSON) -> `400 malformed_payload` (not a JSON object, missing/blank/mistyped field, `amount` not a positive integer, unsupported `type`) -> `404 subscription_not_found` (nothing persisted, event id not consumed) -> business handling, always `200` with `{status: processed | duplicate | ignored}`. If no secret is configured (`webhookSecret` / `PROVIDER_WEBHOOK_SECRET`), the endpoint answers `500` instead of accepting anything.

**Business rules implemented (assumptions where the assignment is silent are marked *assumption*).**

- **Duplicate `event_id`:** answered `duplicate`; only `deliveryCount` and `lastDeliveredAt` change. No state, invoice, audit or provider effect. The event id is the identity: a redelivery with different content is still a duplicate.
- **Invoice must be known:** it must exist, belong to the event's subscription and match `amount`/`currency` exactly, otherwise `ignored` (`invoice_not_found` / `amount_mismatch`). *Assumption:* webhooks never create invoices; the billing side owns them (pending invoices are seeded in tests until the scheduler phase exists).
- **`payment.succeeded`:** a `pending` invoice becomes `paid`. `trialing -> active` and `past_due -> active` through the state machine. For an `active` subscription (recurring payment) the invoice is paid with no transition, because the lifecycle has no `active + charge_succeeded` arrow.
- **`payment.failed`:** a `pending` invoice becomes `failed`. `trialing`/`active` -> `past_due`. While already `past_due`, a failed retry changes no status until `MAX_CHARGE_ATTEMPTS = 3` consecutive failed invoices, which applies `retries_exhausted` (`past_due -> canceled`). *Assumption:* "retries exhausted" is counted this way (strategy section 1).
- **`payment.refunded`:** a `paid` invoice becomes `refunded`; subscription status never changes. *Assumption:* partial refunds are not modeled (amount must equal the invoice).
- **Terminal invoices:** an invoice that is already `paid`, `failed` or `refunded` is never overwritten by `succeeded`/`failed` events (`invoice_already_*`). This is what makes `failed` after `succeeded` harmless.
- **Canceled subscriptions:** `succeeded`/`failed` are `ignored` (`subscription_canceled`) before any invoice is touched. **Deliberate deviation from section 6's earlier wording:** `payment.refunded` is still applied to the invoice (bookkeeping, no state change), because ignoring it would leave money refunded by the provider recorded as `paid`.
- **Audit log:** only real transitions are recorded (`from`, `to`, `trigger`, `source: api | webhook`, `eventId` for webhooks, `at`). A failed retry that leaves `past_due` unchanged, a recurring payment on an `active` subscription, and refunds create no audit entry.
- **API-created records:** a `basic` creation now persists one invoice (`paid` with the provider charge id, or `failed` with the decline code; idempotency key `initial:<subscription id>`) and one audit entry. A timeout still persists nothing in any store. `pro` creation writes no invoice and no audit entry. Cancel writes one audit entry.

**Persistence assertions (`PersistenceAssertions`, backed by the repositories).** Row-level helpers for all four stores, `snapshot()` / `expectUnchangedSince()` for "rejected requests leave no trace", and `expectCoherent(subscriptionId, apiBody?)`, run after each step of the e2e specs:

1. persisted status equals the API-visible status;
2. `active` implies a `paid` or `refunded` invoice;
3. `past_due` implies a `failed` invoice; trailing failed invoices never exceed 3 (the limit is written independently in the test oracle);
4. invoice amount/currency equal the subscription's price;
5. invoice attempts and idempotency keys are unique;
6. the audit chain is contiguous, ends at the current status, and nothing follows `canceled`;
7. every webhook-caused audit entry points at a stored event with outcome `processed`.

**Test framework additions.** `WebhookSimulator` (computes HMAC itself, independent of the service; `signed`, `signedRaw`, `unsigned`, `signedWithWrongSecret`, `tamperedAfterSigning`, `withSignatureHeader`), `WebhookEventBuilder`, `InvoiceRecordBuilder`, `TestEnvironment.seedBilling(status, invoiceStatuses)` (arrange-only seeding), `BillingApiClient.postWebhook` (sends the exact raw string), `BillingAssertions.expectWebhookAck`, and `withLatency` (a repository wrapper that yields to the event loop on every call, enabled with `TestEnvironment.create({ slowStorage: true })`).

**Specs added.** `specs/webhooks/` (signature, payloadValidation, paymentSucceeded, paymentFailed, paymentRefunded, idempotency, outOfOrder, canceledSubscription), `specs/persistence/` (billingRecords, inMemoryRepositories, keyedMutex), `specs/lifecycle/subscriptionCanApply`, `specs/e2e/webhookLifecycle` (E1, E3, E4, E6 in the form this phase can express).

**Lifecycle coverage through webhooks.** V1 trialing->active, V2 trialing->past_due, V3 active->past_due, V4 past_due->active, V5 past_due->canceled (retries exhausted) are all driven by webhook specs. V6/V7 (cancel) remain API-driven. Invalid: I1/I2 (canceled + succeeded/failed webhook), I3 (failed after succeeded), I5 (new event on a paid invoice).

**Red/Blue/Green record (this phase).**

1. **Red:** `billingRecords.test.ts` was written first with the repositories and framework scaffolding but no service behavior: 10 tests failed on real assertions (no invoice or audit rows, payment method not stored), 128 others passed (116 pre-existing).
2. **Blue:** invoice/audit writes on create and cancel, `paymentMethodId`, `KeyedMutex`. 138 tests green.
3. **Red:** all webhook specs, `subscriptionCanApply` and the e2e spec written before any webhook code: 114 failed (the endpoint did not exist; `can` did not compile).
4. **Blue:** `WebhookService`, routes, signature and payload parsing, `can()`, `retryPolicy`. 304 green on the first run; that is why the next step matters.
5. **Green / checking the specs:** mutations applied by hand to `src/` (each reverted afterwards) and the suite re-run; each of these made specs fail: signature check always true; signature computed over a whitespace-stripped body; duplicate detection removed; duplicate not counted; paid / failed invoice overwritten; canceled guard removed; amount/currency check removed; invoice of another subscription accepted; refund of an unpaid invoice allowed; retry limit 2 and 4; failure run not reset by a payment; `can()` ignored on `active + succeeded`; fractional amount accepted; unsupported type accepted; webhook transition without audit entry or without `eventId`; event row never written; `basic` invoice not stored or always `paid`; payment method not stored; cancel without audit entry; mutex removed from webhooks and from cancel.
   - **Finding:** with the plain in-memory repositories, removing the mutex made only the `KeyedMutex` unit test fail. The concurrent-delivery and cancel-race specs passed regardless, so they proved nothing about locking. They now run with `slowStorage: true`, and with the mutex removed they fail (the concurrent-duplicate spec and one of the two cancel/webhook orderings; I did not inspect the exact interleaving, only that the specs go red).

**Known gaps and limitations (not hidden).**

- **No billing scheduler:** nothing creates `pending` invoices, charges `pro` after the trial, or retries. Webhook specs seed pending invoices through the repositories. Trial end, recurring billing and the retry flow are untested. E2 and E5 are not covered; E3 and E4 only through webhooks and seeded invoices.
- **A timeout outcome later resolved by a webhook (E5)** is not covered: a timeout on creation persists nothing, so there is no invoice for a webhook to resolve.
- **`payment.succeeded` after `payment.failed`** on the same invoice is ignored (assumption); a real system would need reconciliation. **`payment.refunded` before `payment.succeeded`** is ignored and not replayed.
- **A `payment.succeeded` for a `canceled` subscription is only recorded as ignored:** money captured by the provider is not refunded or flagged beyond the event row.
- **`payment.succeeded` before the trial ends activates a `trialing` subscription** (the provider is the source of truth for charges); no trial-date check exists.
- **No notifier:** "no duplicate side effect" is asserted for state, invoices, audit, event rows and provider calls only.
- **Not atomic:** writes are separate repository calls; a crash between them is not simulated. The event row is written last, so a crash would lead to reprocessing on redelivery (mostly absorbed by the invoice rules, but unverified).
- **Locking** is a single-process in-memory mutex, keyed by subscription id. Duplicate event ids sent for different subscription ids are not serialized against each other. A real database would use row locks or optimistic versioning.
- **Webhook signature:** no timestamp/replay window, no secret rotation; the secret comes from `PROVIDER_WEBHOOK_SECRET` or the injected dependency. Oversized bodies and `Content-Encoding` are not handled specially (an oversized body would surface as a generic error).
- **Webhook `404` for unknown subscriptions** makes a real provider retry; chosen to keep nothing persisted.
- Plan change endpoint, notifier and linting remain unimplemented, as in earlier phases.

## 13. Phase 5 Implementation Log: Billing Run and End-to-End Flows

**Built.**

| Piece | Location | Role |
|---|---|---|
| `decideBilling(subscription, invoices, now)` | `src/domain/billingSchedule.ts` | Pure timing rules: `none`, `charge_new(attempt)` or `resume_pending(invoice)`. `BILLING_PERIOD_DAYS = 30`, `RETRY_INTERVAL_DAYS = 1` |
| `settleSuccess` / `settleFailure` | `src/domain/chargeSettlement.ts` | What a charge result does to the subscription (which trigger, when retries are exhausted). Used by **both** the billing run and `WebhookService`, so the two cannot count retries differently. Status still only changes through `Subscription.apply` |
| `BillingScheduler.runDue()` | `src/services/BillingScheduler.ts` | The billing run. Per subscription: lock, re-read, decide, save a `pending` invoice, charge, write invoice, subscription and audit entry |
| `BillingService.chargeInvoice`, `chargeKeyForAttempt` | `src/services/BillingService.ts` | Builds the provider request from the stored invoice (what is charged is what is recorded). Attempt 1 keeps `initial:<sub>`, later attempts use `attempt:<sub>:<n>` |
| `createService(deps)` | `src/app.ts` | Returns `{ app, billingScheduler }`; `createApp` is unchanged for callers (it returns `.app`) |
| `AuditSource` gains `'scheduler'` | `src/domain/AuditEntry.ts` | Transitions caused by a billing run are distinguishable from API and webhook ones |

**Decisions (the assignment is silent on these; all are assumptions).**

- **No HTTP endpoint for billing.** "Core Operations" lists none, and adding one would be an unrequested feature. The run is `runDue()` on an injected object; tests call it through `TestEnvironment.runBilling()` with the fake clock. A real system would call it from a cron or queue worker.
- **When is a charge due?** `trialing`: at `trial_ends_at` (inclusive), attempt 1 (key `initial:<sub>`). `active`: 30 days after the latest `paid` or `refunded` invoice's `createdAt` (a refund does not postpone the next charge). `past_due`: 1 day after the latest failed invoice's `updatedAt` (the time the failure was recorded, whether by run or webhook). `canceled`: never. A missed run is caught up, not skipped.
- **Timeout = unknown outcome.** The invoice is saved `pending` *before* the provider is called. On a timeout it stays `pending`, the subscription is unchanged, no audit entry is written, and the next run **re-sends the same invoice with the same idempotency key** (no second invoice, no second billing attempt). A webhook can also settle that pending invoice first (E5); then the run has nothing to resend. A timeout never counts toward retry exhaustion.
- **Retry exhaustion** is unchanged from Phase 4: three consecutive failed invoices cancel a `past_due` subscription. The creation-time decline of a `basic` subscription counts as the first. A successful payment resets the run.
- **Recurring payment on `active`** adds a paid invoice and no audit entry (the lifecycle has no `active + charge_succeeded` arrow), the same rule the webhook path already used. A recurring decline is `active -> past_due`.
- **Lifecycle gap, not fixed:** the transition table has no `past_due + cancel` arrow, so `POST /cancel` on a `past_due` subscription is `409`. Billing retries carry on. This follows the assignment's diagram literally; it is asserted in `paymentRetries.test.ts`.
- **Unexpected provider errors** (anything but `ProviderTimeoutError`) propagate out of `runDue()` and stop that run; the invoice stays `pending` and the next run resumes it.

**Specs added** (`tests/specs/billing/`, `tests/specs/e2e/billingLifecycle.test.ts`).

| Spec | Proves |
|---|---|
| `billingSchedule` | Every timing boundary of `decideBilling` (1 ms before / exactly at), per state; resume of pending; canceled never |
| `trialExpiration` | V1 and V2 at trial end; exact provider arguments; invoice, audit (`scheduler`, timestamp) and coherence; repeated runs charge once; timeout then identical resend; unexpected provider error; cancel during trial; `basic` is not charged again at day 14; only the due subscription is charged |
| `recurringBilling` | 30-day period (boundary), next period counted from the latest payment, V3 (recurring decline), timeout resend, cancellation stops billing, `pro` recurring price/keys |
| `paymentRetries` | 1-day interval (boundary), V4 retry success, failed retry leaves `past_due` silently, V5 exhaustion after three, no charge or revival afterwards, success resets the failure run, timeouts do not count, API cancel from `past_due` is `409` |
| `schedulerAndWebhooks` | Webhook settles a timed-out invoice (success and failure), redelivery and later run change nothing, stale `failed` after a run's success ignored, early webhook for a not-yet-created invoice ignored, refund does not shift the period, redelivered failure counts once, failures from webhooks and runs add up to one retry limit, late webhook after cancel ignored |
| `billingRaces` (slow storage) | Overlapping runs charge once, cancel vs run, webhook vs run |
| `e2e/billingLifecycle` | E2 (pro trial to cancel with recurring charge and echo webhooks), E3 (decline, retry, recurring resumes), E4 (recurring decline to canceled, later webhooks and runs inert), E5 (timeout resolved by webhook), E6 (forged webhooks at each step). `expectCoherent` after every step; at the end the provider's idempotency keys equal the invoices' keys |

**Framework additions.** `TestEnvironment.runBilling()`; `FakeClock.advanceMs`; `InvoiceRecordBuilder.at/createdAt/updatedAt`; `SubscriptionRecordBuilder.trialEndingAt`; `PersistenceAssertions.expectAuditPath / expectAuditEntryAt / expectInvoiceKeys / expectInvoiceWithoutProviderCharge`; `ProviderAssertions.idempotencyKeys`. `expectCoherent` gained two invariants: at most one `pending` invoice and only as the latest, and timestamps never go backwards (invoices, audit log, relative to the subscription).

**Valid transitions, where each is exercised.** V1 `trialExpiration` and E2; V2 `trialExpiration`, E3; V3 `recurringBilling`, E4; V4 `paymentRetries`, E3; V5 `paymentRetries`, E4; V6/V7 API cancel (`cancelFromState`, `recurringBilling`, `trialExpiration`). Each of V1-V5 is also driven through webhooks (Phase 4).

**Red/Blue/Green record (this phase).**

1. **Red (stage 1):** all new specs written first; 7 suites failed to compile (`decideBilling`, `runBilling`, `'scheduler'` source did not exist). 305 existing tests untouched.
2. **Red (stage 2):** added only the seams (a `decideBilling` that returns `none`, a `runDue` that returns `[]`, wiring): 63 tests failed on real assertions, 322 passed (305 existing plus 17 "nothing is due" cases that a no-op satisfies, which is expected).
3. **Blue:** `decideBilling`, `chargeSettlement`, `chargeInvoice`, `BillingScheduler`. **385 green on the first run.** As in Phase 4, a green first run proves nothing about the specs' strength by itself.
4. **Green:** `WebhookService` moved onto the shared `settleSuccess` / `settleFailure` (existing webhook specs unchanged and green); two coherence invariants added; two specs added after I noticed that nothing distinguished "interval counted from `updatedAt`" from "from `createdAt`" (retry-interval spec) or a period counted from the refund time (refund spec). Final: 32 suites, 386 tests.
5. **Mutation checks: NOT done this phase (superseded: done in the Phase 5 review, section 14).** I started a by-hand sweep (retry interval, period length, boundary operators, missing pending save, missing lock, key reuse, wrong amount / payment method / reference, exhaustion rule) and stopped at the first mutation when the test command was declined; the source was restored and verified. Treat the specs' sensitivity to those bugs as **unverified**, unlike Phase 4.

**Known gaps and limitations (not hidden).**

- ~~Mutation sensitivity unverified~~ (resolved in section 14: 79 mutations, all detected; removing the lock fails the `billingRaces` specs).
- **No notifier**, so "duplicate webhook fires no second notification" is still asserted for state, invoices, audit, event rows and provider calls only.
- **A pending invoice on a subscription that is then canceled** (timeout, then `POST /cancel`) stays `pending` forever; nothing voids it, and a late `payment.succeeded` for it is ignored. Money may have been captured. Needs a reconciliation or void step in a real system.
- **No cap on timeout resends:** a provider that always times out is re-sent on every run, indefinitely, and the subscription never leaves its state.
- **`runDue()` stops at the first unexpected provider error**; subscriptions after it in id order wait for the next run. No per-subscription isolation or error report.
- **`decideBilling` period model is simple:** a fixed 30 days from the last payment, no calendar months, anchors, proration or dunning schedule; `RETRY_INTERVAL_DAYS` is constant rather than escalating.
- **`past_due` cannot be canceled through the API** (diagram-faithful, see above); whether that is desired product behavior is a question for the spec owner.
- **Webhooks still never create invoices**; a `payment.*` event for an invoice the run has not created yet is ignored (asserted), so a provider-initiated charge outside the run is not modeled.
- **Not atomic:** invoice, subscription and audit writes are separate calls (a crash between them is not simulated). The `pending`-first write makes the common crash window safe (resend with the same key), but this is argued, not tested.
- **Concurrency** is the single-process mutex only; no cross-process or multi-run scheduler race is possible to test here.
- **Plan change endpoint** is still not implemented (no endpoint is defined in Core Operations).


## 14. Phase 5 Review: Mutation Check, Required vs Optional Issues

Review done before final submission. Source files were mutated one behavior at a time by a script kept outside the submission (each mutation is restored in a `finally` block; afterwards every `src/` file was compared by hash with a copy taken before the first mutation: 37 files, 0 differences). Mutations that did not compile (unused imports/parameters under `noUnusedLocals`) were rewritten until they compiled; only compiling mutations count.

**Result: 78 compiling mutations, 77 detected on the first pass; the one survivor (S22 below) is now detected by the new specs. A 79th (X01, cancel silently voiding pending invoices) was added after the new specs and is detected as well.**

| Area | Mutations (each detected unless noted) |
|---|---|
| Scheduler timing | period 30 to 31 / 29 days; retry interval 1 to 0 / 2 days; `>=` to `>` at the due boundary; retry counted from `createdAt`; period counted from `updatedAt`; canceled subscription billed; trial end check removed; pending invoice not resumed (trialing, active, past_due); first charge repeated; attempt number always 1; refund no longer counts as a payment |
| Scheduler behavior | lock removed; pending invoice not saved before the charge; resumed invoice replaced by a new one; timeout recorded as failure; unexpected error swallowed; invoice always `paid`; subscription save / audit entry removed; audit source wrong; exhaustion history without the new failure; wrong run outcome. **S22 survived**: settled invoice keeps the old `updatedAt` after a resend |
| Provider request | key always the initial key; attempt keys reused; amount 0; reference, payment method or customer wrong; decline mapped to success; timeout mapped to decline; unexpected error mapped to decline or to timeout |
| Retry rules | limit 2 and 4; `>` instead of `>=`; failures counted as total instead of consecutive; exhaustion on first retry failure; exhaustion never applied; `settleSuccess` / `settleFailure` neutered; transition table edited (`past_due` + success, `retries_exhausted`) |
| Webhook settlement | duplicate detection off; delivery count not incremented; duplicate answered `processed`; event row not written; paid / failed invoice overwritten; canceled guard removed; amount mismatch accepted; foreign invoice accepted; no transition on success; failure missing from history; invoice not marked failed / not saved / `updatedAt` stale; audit entry removed; lock removed; refund of unpaid invoice; refund blocked on canceled |
| Creation idempotency | fingerprint ignores plan / payment method; replay charges again; reservation not saved; conflict check removed; retry after timeout gets a new subscription id; key format changed |
| Cancellation protection | cancel without lock, audit entry or save; `canceled` + `charge_succeeded` allowed; double cancel allowed; `past_due` + cancel allowed; `active` + cancel removed; cancel silently voids pending invoices (new X01) |

Lock removal (scheduler, webhook, API cancel) is caught only by the `slowStorage` race specs (`billingRaces`, `canceledSubscription`, `idempotency`), which is what they were built for.

**Added in this review:** `tests/specs/billing/timeoutAndCancellation.test.ts` (5 tests).

- **Required, fixed by test (S22):** a charge settled by a later resend must carry the time of the answer; the retry interval depends on it. The code was right, the suite was blind to it.
- **Pending invoice after cancel: not required, source not changed.** The assignment requires that cancellation stops future billing and that no webhook revives a canceled subscription; both hold and are asserted. It does not ask for voiding invoices, the model has no `void` status, and after a timeout the money may really have been captured, so voiding would hide that. The new specs pin the current behavior (invoice stays `pending`, no further charge, late `succeeded` / `failed` ignored and recorded, state coherent). Voiding or reconciling is an optional improvement.

**Required vs optional (against SDET_ASSIGNMENT.md):**

| Topic | Verdict |
|---|---|
| Retry limit 3, counted as consecutive failed invoices | Assignment gives no number; the lifecycle only requires "retries exhausted -> canceled". Documented assumption, tested from both sides (2 and 4 are caught). Not an open issue |
| Timeout resends | Required: correct under timeout, same key, one provider call per real attempt: done. A cap on resends is **optional** |
| Unexpected provider errors | Not required beyond "does not corrupt state": invoice stays `pending`, next run resumes. Isolating errors per subscription and reporting them is **optional** hardening |
| Cancel from `past_due` returns 409 | Follows the lifecycle diagram literally ("any transition not shown is invalid"); required behavior, tested |
| Plan change | **Not required.** "plan changes" appears once, in the list of API-level areas; "Core Operations" lists four endpoints and no plan-change endpoint, "Required Validation Depth" for the API covers creation, retrieval, cancellation and the webhook, and proration is a non-goal. Plan-specific price and trial rules are covered (plan table, creation and billing). Adding an endpoint would be an unrequested feature; the gap stays documented |

## 15. Final Verification (Phase 6)

Run from this folder on Node v24.14.1 / npm 11.11.0 (Windows); a clean copy (no `node_modules`, `coverage`, `dist`) was also installed with `npm ci` and tested.

| Command | Result |
|---|---|
| `npm test` | 33 suites, 391 tests passed, 0 failed, 0 skipped, 0 todo |
| `npm run test:ci` (`--ci --runInBand`) | 33 suites, 391 tests passed |
| `npm run typecheck` / `npm run build` (both `tsc --noEmit`; no emit, so `build` produces no artifacts) | clean |
| `npm run test:coverage` | all passing; src only: 98.94% statements, 97.2% branches, 97.14% functions, 98.91% lines |
| Race specs (billingRaces, canceledSubscription, idempotency, keyedMutex, duplicateCharges, timeoutAndCancellation) repeated 10 times | 63 tests passed in each of 10 runs |

Tests per area (391 total): webhooks 135, billing 81, lifecycle 53, provider 45, api 33, persistence 32, e2e 9, setup smoke 3.

What these results do **not** show: the storage is in-memory and the payment provider is a mock, so no real database, real network, real provider or real clock has been exercised. Coverage is a by-product (the uncovered lines are mostly the default `UnconfiguredPaymentProvider`, the system clock and id generator); it was not a goal. No linter is configured. `npm audit` reports an advisory in `deepmerge`, reached only through the dev dependency `jest`; it is not part of the service code.