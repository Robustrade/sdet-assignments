# Test Strategy — Subscription & Billing Service

## 1. Assumptions about the system under test
- No real service was provided, so a minimal fixture was built to the spec in `SDET_ASSIGNMENT.md`: the 4 endpoints, 2 plan tiers (`basic`: $9/mo, 7-day trial; `pro`: $49/mo, 14-day trial), and the exact 7-transition lifecycle given in the assignment.
- Customers are a dynamic entity with no dedicated onboarding endpoint in the assignment's API surface, so a small `CustomerRepository` + `FixtureSeeder` (see section 4a) pre-registers a couple of known customer IDs into every fresh test store. `SubscriptionRequestBuilder` defaults to one of them, so ordinary scenarios need no setup; "unknown customer" is tested against a deliberately unregistered ID instead.
- `payment.refunded` webhooks are accepted, recorded, and mark the subscription's latest invoice `refunded`, but never change lifecycle state — the assignment's lifecycle diagram has no refund-driven transition, so refund is modeled as an invoice-level event only.

## 2. Scope of automation
**In scope:** API contract/validation (including unknown-customer/unknown-plan and malformed/unparseable JSON bodies), webhook request handling (signature + shape) separately from webhook business logic, full lifecycle coverage (all 7 valid transitions + invalid/no-op cases, each proven both as a pure state-machine unit test AND driven through the real HTTP layer — see `tests/e2e/allTransitionsViaHttp.test.ts`), persistence of subscriptions/invoices/webhook_events/audit log, payment-provider mock call verification, idempotent + out-of-order (both general and same-invoice) webhook handling, end-to-end flows, and (bonus) concurrent/racing webhook delivery.

**Out of scope (per the assignment's Non-Goals):** UI, a real payment provider integration, performance testing, monitoring/dashboards, proration/multi-currency/tax edge cases.

## 3. What is real vs. mocked/stubbed, and why
| Component | Real or mocked | Why |
|---|---|---|
| Subscription lifecycle, state machine, repositories | Real (fixture) | Needed something concrete to test against all three layers meaningfully |
| HTTP layer | Real Express app, exercised via Supertest | Proves actual request/response contracts, not just direct function calls |
| Persistence | Real in-memory repositories (Repository pattern), not a real DB | Zero setup friction while still proving persisted-state invariants; a `better-sqlite3` swap later touches only these classes, not the tests |
| Payment provider | **Mocked** — `MockPaymentProvider implements PaymentProviderClient` | Required by the assignment; it's the only implementation of the injected interface, and every charge is asserted against it (call count + arguments) |
| Webhook delivery | Simulated via signed HTTP payloads from `WebhookPayloadBuilder` | The assignment requires the suite to construct these itself, including invalid/malformed variants |

## 4. Design patterns applied
1. **State pattern (explicit transition table)** — `src/domain/stateMachine.ts`. `SubscriptionStateMachine.nextState(from, trigger)` looks up a `Record<SubscriptionState, Partial<Record<TriggerKey, SubscriptionState>>>`. Illegal transitions simply have no table entry — they can't be reached from any call site, instead of relying on a `status` string mutated ad hoc.
2. **Builder** — `src/testUtils/builders/*`. `SubscriptionRequestBuilder`, `WebhookPayloadBuilder`, `CustomerBuilder` let tests read as intent (e.g. `new WebhookPayloadBuilder().ofType('payment.failed').forSubscription(id).buildWithInvalidSignature()`) instead of repeated object literals — most valuable for webhook payloads, which need several structurally different variants (valid, unsigned, malformed) off one base shape.
3. **Interface/seam around the payment provider (dependency injection)** — `PaymentProviderClient` (`src/domain/paymentProvider.ts`) is the only thing `SubscriptionService` depends on. `MockPaymentProvider` is the sole test implementation, recording every call and letting tests dictate the next outcome (`succeeded`/`declined`/`timeout`).
4. **Repository pattern** — `src/persistence/repository.ts` + `inMemoryRepository.ts`. Tests never touch a raw store, only `CustomerRepository`/`SubscriptionRepository`/`InvoiceRepository`/`WebhookEventRepository`/`AuditLogRepository` interfaces; `createInMemoryStore()` (a small factory) assembles a fresh instance per test via `createTestContext()`.

## 4a. Test architecture — the six layers the assignment asks to keep distinct| Responsibility | Where |
|---|---|
| Test fixtures / environment setup | `createTestContext()` (`src/testUtils/testAppFactory.ts`) builds an isolated store/provider/service/app per test; `FixtureSeeder` (`src/testUtils/fixtureSeeder.ts`) then seeds known customers into it — kept as a separate step so a test can skip seeding when it specifically wants an environment with no known customers |
| **API client layer** | `SubscriptionApiClient` (`src/testUtils/apiClient.ts`) — the *only* file in the whole repo that imports `supertest`; every test calls typed methods (`api.createSubscription(...)`, `api.postWebhook(...)`) instead of embedding HTTP calls inline |
| Mock payment provider / webhook simulator | `MockPaymentProvider` (call recording + configurable outcomes) + `WebhookPayloadBuilder` (valid/invalid signed payload construction) |
| Assertion / verification layer | Direct repository-interface assertions in `tests/persistence/`, response assertions via the API client's return value, state-machine assertions via `SubscriptionStateMachine` directly |
| Test scenarios / specifications | `tests/*.test.ts`, grouped by level (`api/`, `stateMachine/`, `persistence/`, `provider/`, `e2e/`) |
| Test data builders | `src/testUtils/builders/*` |

## 5. API contracts
- `POST /subscriptions` → `201` + subscription object, or `400 { error }` for unknown plan / unknown customer / missing fields.
- `GET /subscriptions/:id` → `200` + subscription, or `404`.
- `POST /subscriptions/:id/cancel` → `200` + subscription (idempotent — canceling twice returns `200` both times).
- `POST /webhooks/payment-provider` → `200 { received, noop }` on valid signed + well-formed payloads, `401` on invalid/missing signature, `400` on valid signature + malformed shape.

## 6. Database entities checked
- **`customers`** — a small seeded set backs "known customer" creation; an unregistered ID is proven to be rejected before anything else runs.
- **`subscriptions`** — plan, state, timestamps checked against both the API response and business rules at every lifecycle stage, not only at creation.
- **`invoices`** — one row per genuine billing attempt (service-initiated) *and* per genuine webhook-notified payment event, with correct amount/currency/status (`paid`/`failed`/`refunded`). A redelivered webhook is proven to add zero extra rows for the same invoice_id; a webhook that has no real effect on the subscription (e.g. `payment.succeeded` against an already-canceled one) is proven to write no invoice at all.
- **`webhook_events`** — every processed `event_id` recorded with a `noop` flag; a redelivered `event_id` is itself recorded as a second, explicitly-`noop` row rather than silently dropped, so the trail shows the redelivery happened.
- **audit log** — one entry per meaningful action (`created`, `billing_attempt`, `webhook_event`, `api_cancel`, `retries_exhausted`, `webhook_duplicate_ignored`, `webhook_stale_ignored`), each with from/to state.

Test data is seeded deterministically per test via `createTestContext()` + `FixtureSeeder` — a brand-new in-memory store each time, no shared/global state, so no stale-data risk between tests.

## 7. Webhook / idempotency strategy
- **Idempotency key:** the provider's `event_id`. `WebhookEventRepository.hasProcessed(event_id)` is checked before any mutation; a hit short-circuits to `noop: true` and a second, flagged row.
- **Out-of-order/stale delivery, general case:** proven with a webhook that would be structurally valid in isolation but arrives against a subscription already past the state it applies to (e.g. `payment.succeeded` after cancellation) — the state machine's `null` return handles this as a safe ignore, never a reactivation, and no invoice is written for it either.
- **Out-of-order/stale delivery, same-invoice case (mandatory, section E):** `event_id` dedup alone doesn't catch a *different* event_id that refers to a charge attempt already resolved (e.g. a late `payment.failed` redelivery for an invoice a `payment.succeeded` already settled). `WebhookEventRecord` now carries `invoiceId`; `processWebhook` checks `invoiceAlreadyResolvedSuccessfully(subscriptionId, invoiceId)` before applying a `payment.failed`, and ignores it as stale (no state change, no invoice write) if that invoice already has a non-noop `payment.succeeded` on record. A `payment.failed` for a genuinely new invoice_id is unaffected and still transitions normally — see the contrast test in `tests/e2e/lifecycle.e2e.test.ts`.

## 8. Known limitations / next steps
- No real database — a `better-sqlite3` swap needs new repository implementations, no test changes, by design.
- Concurrent/racing webhook delivery **is** covered (`tests/e2e/concurrentWebhooks.test.ts`, bonus per the assignment), but honestly: this fixture's store is fully synchronous with no I/O yield points, so Node never actually interleaves two request handlers mid-function. The tests prove the *observable contract* holds under concurrent-style delivery (no duplicate transition, no double-processed event_id), not a true multi-thread/multi-process race. Real race coverage would need a datastore with row-level locking or transactions.
- Retry scheduling (when a `past_due` retry actually fires) isn't modeled; `runBillingAttempt` is exposed so tests can drive it deterministically instead of waiting on a scheduler.
- The seeded customer set is fixed and small (two IDs); there's no customer CRUD surface since the assignment doesn't specify one.

## 9. Required invariants — where each is proven
| Invariant | Proven in |
|---|---|
| Never reaches `active` without a persisted successful payment | `tests/e2e/lifecycle.e2e.test.ts` (happy path), `tests/provider/mockProvider.test.ts`, `tests/persistence/persistence.test.ts` (no-contradictory-records) |
| `canceled` never transitions again, regardless of webhooks | `tests/stateMachine/stateMachine.test.ts`, `tests/e2e/lifecycle.e2e.test.ts` (stale webhook, now also asserts zero invoice writes) |
| Duplicate webhook delivery never duplicates invoices/payments/charges | `tests/persistence/persistence.test.ts` (duplicate event_id test — non-trivial: the webhook path genuinely writes invoices, so this is a real proof, not one that's vacuously true) |
| A stale/out-of-order `payment.failed` for an already-resolved invoice never regresses an active subscription | `tests/e2e/lifecycle.e2e.test.ts`, with a contrast test proving a genuinely new invoice's failure still applies |
| Provider mock called at most once per genuine billing attempt, and never for rejected creations or replayed webhooks | `tests/provider/mockProvider.test.ts` |
| Persisted state always matches API-visible state | `tests/persistence/persistence.test.ts`, `tests/e2e/lifecycle.e2e.test.ts` |
| Plan price/trial rules applied consistently, creation vs. billing | `PlanCatalog` is the single source both call sites read from; price asserted in `tests/provider/mockProvider.test.ts`, trial length in `tests/api/subscriptions.api.test.ts` |

