# Test Strategy — Subscription & Billing Service

> Written before the automation, revised as the suite found things. Section 11 records what
> changed and why.

## 1. System under test

**Option 3 (hybrid).** No service was provided, so this repository contains a minimal
subscription/billing fixture (`src/`) plus test doubles for its external dependencies. The
fixture is deliberately small — it exists to give the suite a realistic, stateful target, not to
be a product.

Two decisions shaped it:

- **The lifecycle is data, not code paths.** A single transition table (`src/domain/subscription-state-machine.ts`)
  is the whole truth about what may happen to a subscription. It is enumerable, so the suite can
  *prove* it exercised every edge instead of claiming so.
- **Every non-deterministic dependency is a constructor parameter.** Payment provider, clock, id
  generator, notifier, plan catalog, webhook secret. The test harness builds the same object
  graph as production with two nodes swapped.

### Assumptions

| # | Assumption | Rationale |
|---|---|---|
| A1 | Billing is driven by a scheduled job, exposed here as `POST /billing/run-cycle`. | Trials and renewals need a time trigger; making it explicit lets tests own time instead of sleeping. |
| A2 | The provider is called synchronously on a charge **and** confirms asynchronously by webhook. Both paths must converge. | This is how real providers behave, and it is where the interesting bugs live. |
| A3 | A provider **timeout** is not a decline. The invoice stays `pending`, the state does not move, and no second charge is attempted until the outcome is known. | Treating a timeout as failure is how customers get double-charged. |
| A4 | A refund is an invoice-level fact and does **not** move the subscription. | The lifecycle diagram has no refund edge; inventing one would be a silent extension. `refunded_at` is recorded and `paid_at` is preserved. |
| A5 | Cancelling a `past_due` subscription is **rejected** (409). | The diagram shows `trialing → canceled` and `active → canceled` only. Anything not in the diagram is invalid, so the fixture follows the diagram rather than what feels convenient. |
| A6 | Events for unknown subscriptions/invoices return 404 and are **not** recorded. | Otherwise a genuinely mis-routed event would be swallowed as a "duplicate" on the provider's retry. |
| A7 | Only non-retryable business outcomes return 200 (`processed` / `ignored` / `duplicate`). Transport-level problems return 401/400/404. | Returning 500 or 4xx for a correctly-signed, correctly-shaped event would trigger provider retry storms. |

### Extensions to the given lifecycle (documented, not smuggled in)

The diagram omits two edges a working biller needs. Both are marked `origin: 'extension'` in the
table so they are visible in code review:

- `past_due --charge_failed(retries remain)--> past_due` — the mechanism by which
  "retries exhausted" eventually happens.
- `active --charge_succeeded--> active` — a successful renewal.

## 2. Scope

**In scope:** API contract and validation; the subscription lifecycle driven by both API calls
and webhooks; persistence of subscriptions, invoices, webhook events and the audit log;
interaction with the payment provider (count + arguments); idempotency, out-of-order delivery,
declines, timeouts, forged signatures; one concurrency scenario (bonus).

**Out of scope (deliberate):** proration, multi-currency, taxes, invoice PDFs, real provider
integration, performance/load, UI, authentication of the public API, monitoring, reporting
dashboards.

## 3. What is real vs. faked

| Component | In the suite | Why |
|---|---|---|
| HTTP API, routing, serialization, error mapping | **Real** (Express, driven by Supertest in-process) | The contract under test. In-process keeps runs fast and port-free; `ApiClientFactory.forBaseUrl` exists so the same specs could drive a deployed service. |
| Subscription service, billing engine, webhook processor, state machine | **Real** | This is the behaviour being validated. |
| Persistence | **Real logic, embedded store** (`InMemoryDatabase` + repositories) | Queryable from tests without provisioning anything. Because all access goes through repositories, moving to `better-sqlite3` changes the repository bodies only — no spec changes. |
| HMAC signature verification | **Real** (`node:crypto`) | Tests sign genuine payloads and deliberately corrupt them. |
| Payment provider | **Faked** (`FakePaymentProvider`) | It moves money. It is scripted per attempt (succeed / decline / timeout) and records every call for argument assertions. |
| Clock | **Faked** (`MutableClock`) | Trials, renewal periods and retry schedules must be reachable without waiting 14 days. |
| Ids | **Deterministic** (`SequentialIdGenerator`) | `sub_001` / `inv_001` make failures readable and let scenarios reference records. |
| Notifier | **Recording double** | Turns "a duplicate must not fire a side effect twice" into an assertion. |
| Provider→service network | **Simulated** by `WebhookApiClient` posting signed payloads | Matches how the provider actually reaches the service. |

No test makes a real network call. `HttpPaymentProvider` exists to show the mocked interface is
a genuine production seam, and is never exercised by the suite.

## 4. Design patterns, and the problem each one solved

| Pattern | Where | The actual problem |
|---|---|---|
| **State machine / State** | `src/domain/subscription-state-machine.ts` | `status` as a mutable string is unreviewable. A table makes illegal transitions structurally unreachable, makes guarded retry edges explicit, and — because it is enumerable — lets `lifecycle-state-machine.spec.ts` assert that *every declared edge* was exercised. |
| **Strategy + Registry** | `PlanPolicy` / `PlanCatalog` | Price, trial length, billing period and retry budget vary per plan. Without this, plan branches spread through creation, billing and validation and drift apart. `PlanCatalog` is also the single source of truth for "is this a legal plan", so validation and billing can't disagree. |
| **Port + Adapter + fake (DI)** | `PaymentProvider`, `HttpPaymentProvider`, `FakePaymentProvider` | The provider must be substitutable *and* observable. A hand-written fake beats a bare `vi.fn()` here because tests need a per-attempt outcome script, full argument capture, and a timeout modelled as a thrown error. |
| **Repository** | `src/persistence/repositories.ts` | Keeps raw store access out of both service and tests. Reads are defensively cloned, so a test mutating a returned record cannot corrupt service state and fake a green run — see the regression test in `persistence.spec.ts`. |
| **Builder** | `SubscriptionRequestBuilder`, `WebhookEventBuilder`, `CustomerBuilder` | Scenarios state only what they care about ("an event with a mismatched amount"). `WebhookEventBuilder` also owns the two things that are easy to get wrong by hand: unique event ids unless a replay is intended, and amounts that match the invoice unless forgery is intended. |
| **Factory** | `ApiClientFactory` | Builds the client set per environment (in-process vs base URL). Switching the whole suite to a deployed service is a one-line change with zero spec edits. |
| **Test fixture / composition root** | `TestEnvironment`, `useBillingSystem` | One place that wires the graph, seeds reference data and guarantees per-test isolation. |
| **Scenario director** | `SubscriptionScenarios` | `scenarios.pastDue({plan:'basic'})` instead of ten lines of arrange in every past_due test. |

## 5. API contracts validated

| Endpoint | Success | Failure modes asserted |
|---|---|---|
| `POST /subscriptions` | `201` + subscription resource; `trialing`, or `active` for a zero-trial plan | `400 MISSING_FIELD`, `400 INVALID_PLAN`, `400 UNKNOWN_CUSTOMER`, `400 UNKNOWN_PAYMENT_METHOD` — each also asserted to persist nothing and to call the provider zero times |
| `GET /subscriptions/{id}` | `200` + resource identical to creation response | `404 SUBSCRIPTION_NOT_FOUND` |
| `POST /subscriptions/{id}/cancel` | `200` + `canceled` + `canceled_at`; open invoices voided | `409 ILLEGAL_TRANSITION` (already canceled, or `past_due`), `404` |
| `POST /webhooks/payment-provider` | `200` + `{status: processed \| ignored \| duplicate, reason?}` | `401 INVALID_SIGNATURE` (bad / missing / tampered), `400 MALFORMED_PAYLOAD`, `400 INVALID_PAYLOAD`, `404` unknown subscription or invoice |
| `GET /subscriptions/{id}/invoices`, `/events` | `200` + collection | audit visibility through the API, not only the store |
| `POST /billing/run-cycle` | `200` + per-subscription attempt report | used by the end-to-end specs so the flows run entirely over HTTP |

Errors share one envelope: `{ error: { code, message, details } }`.

The signature is verified over the **raw bytes**, before parsing, which is why the webhook route
takes `express.text` rather than `express.json`.

## 6. Database entities and invariants

Entities checked: `subscriptions`, `invoices`, `webhook_events`, `subscription_events` (audit
log), plus seeded `customers`.

`assertSystemInvariants` runs in `afterEach` for **every** test, so a test written about one
behaviour also defends all of these:

| # | Invariant |
|---|---|
| I1 | Persisted state always equals the API-visible state, for every subscription. |
| I2 | No subscription is `active` without at least one invoice that actually succeeded (`paid_at` set). |
| I3 | A `trialing` subscription has never been successfully billed. |
| I4 | `canceled` is terminal: it is the last transition, it happened once, `canceled_at` is set, and no invoice is left `pending`. |
| I5 | The audit log per subscription is contiguous and ordered (`seq` = 1..n). |
| I6 | `updated_at >= created_at`. |
| I7 | Provider calls == invoice rows. Invoices are only opened immediately before a charge, so any drift is a double- or phantom-charge. |
| I8 | Idempotency keys sent to the provider are unique and never reused. |
| I9 | At most one provider call per invoice; `paid` invoices carry a charge id and `paid_at`; `failed` carry a failure code; `refunded` were paid first; `pending`/`void` are never marked paid. |
| I10 | Every invoice amount equals its plan's price. |
| I11 | Every recorded webhook event references a real subscription and invoice. |

Plus per-test assertions on exact invoice status sequences, attempt numbering, retry budget,
`next_retry_at` / `current_period_end` scheduling, webhook outcome + reason + delivery count, and
the transition trail.

### Seeding, cleanup and false positives

- Each test constructs a **new** `TestEnvironment`: new store, clock, ids, provider, notifier.
  There is no shared state and no teardown to forget, so tests are order-independent.
- Only reference data (two customers) is seeded; every subscription in a test is created through
  the API under test, not injected behind it.
- One test asserts the store starts empty, so "passes because nothing happened" is visible.
- Repository reads are cloned, so a test cannot accidentally mutate service state into agreement.
- The suite is **mutation-checked** against five deliberate regressions, all caught: removing the
  replay guard (4 failures), making `canceled` non-terminal (3), removing the stale-invoice
  guards (4), treating a provider timeout as a decline (9), and reusing one idempotency key
  across billing attempts (10).
- **Granularity is deliberate.** 42 tests, not 84: lifecycle behaviour is tested as journeys
  rather than one test per edge, and related cases are asserted table-style inside one test (a
  failure still names the row). Coverage is proved by the transition-coverage test and the
  mutation check, not by the test count.

## 7. Webhook and idempotency strategy

Three independent guards, in order — each catches something the others cannot:

1. **Replay guard.** `webhook_events.event_id` is the idempotency key. A known id short-circuits
   before any observable effect and returns `duplicate`. The only write a duplicate makes is
   `delivery_count++`, so no-op'd redeliveries stay auditable rather than vanishing.
2. **Invoice-state guards.** Catch *relabelled* and *out-of-order* delivery, which the replay
   guard cannot see: a success for an already-paid invoice (`INVOICE_ALREADY_PAID`), a failure
   arriving after a success (`STALE_EVENT_INVOICE_ALREADY_PAID`), a voided invoice, an amount or
   currency that does not match (`AMOUNT_MISMATCH`).
3. **The state machine.** The final word. A transition that does not exist in the table cannot be
   reached from a webhook any more than from an API call.

Ignored events are recorded with their reason, so "nothing happened" is always explainable.

**Concurrency (bonus).** Four simultaneous deliveries of one event yield exactly one `processed`.
This holds because the fixture processes an event synchronously on Node's single-threaded event
loop, so its check-then-insert cannot interleave. **A real service would not get this for free** —
it needs a unique constraint on `webhook_events.event_id` (or a row lock / advisory lock) and to
treat the constraint violation as `duplicate`. The test documents the requirement; it does not
prove a distributed system safe.

## 8. Reliability and failure classes

| Class | Where it is covered |
|---|---|
| Duplicate / redelivered webhooks | `webhook-idempotency.spec.ts` (×2, ×5, relabelled, ignored-then-redelivered) |
| Out-of-order delivery | failure-after-success, success-for-failed-invoice |
| Provider declines | `provider-interaction.spec.ts`, dunning journey |
| Provider timeouts | invoice stays pending, no state change, no re-charge, resolved later by webhook |
| Forged / missing / tampered signatures | `api-contract.spec.ts` — 401 and nothing persisted |
| Invalid state transitions | `lifecycle-state-machine.spec.ts` — unit and integration |
| Persistence mismatches | invariants I1, I2, I7, I9, I10 on every test |
| Concurrent delivery (bonus) | one scenario, with the caveat above |

## 9. Red → Blue → Green

Behaviour-first: a spec was written for the behaviour, the fixture grew the minimum to satisfy
it, then the framework was refactored (builders, scenarios, assertion classes) while staying
green. The suite-wide invariant hook was added early, which is why it caught the two findings
below rather than a reviewer catching them later.

## 10. Known limitations

1. **The fixture is not a production biller.** No proration, no multi-currency, no tax, no
   partial refunds, no invoice numbering scheme, no dunning emails beyond the modelled notifier.
2. **Concurrency is only as strong as the store.** See §7 — the guarantee here comes from
   single-threaded synchronous processing, not from a database constraint.
3. **The store is in-memory.** Transactional rollback and crash-recovery are therefore untested:
   a failure *between* the invoice write and the provider call would be invisible here. Behind
   the repositories, `better-sqlite3` would let a follow-up suite cover that.
4. **The real adapter is untested.** `HttpPaymentProvider` has no coverage by design (no network
   in tests); a contract test against a provider sandbox, or `nock`/`msw`, would be the next step.
5. **Time is coarse.** The clock moves in whole days; sub-daily scheduling and timezone/DST
   effects on period boundaries are not modelled.
6. **No property-based or load testing.** The transition table is enumerable and would suit a
   generative model-based test; that is a natural extension, not present here.
7. **The public API has no authn/authz**, so nothing is asserted about tenant isolation.

## 11. What the suite found while it was being built

Both were caught by the `afterEach` invariant hook, not by a hand-written assertion:

1. **Refund erased the evidence of payment.** Marking a refunded invoice `refunded` left an
   `active` subscription with zero `paid` invoices, violating I2. The fix was in the model, not
   the assertion: invoices now carry `paid_at` and `refunded_at`, stamped centrally in
   `BillingEngine.settleInvoice`, so a refund records a new fact instead of destroying an old
   one. I2 now reads "was ever successfully paid", which is the rule that was actually meant.
2. **A test was weakening an invariant.** A spec called `clearCalls()` on the provider double to
   simplify a count, which broke I7 (provider calls == invoice rows). The double gained
   `mark()` / `callsSince()` instead, so tests can measure a window without discarding history.
   Worth noting as a category: *test helpers that make invariants unverifiable are a smell*.
