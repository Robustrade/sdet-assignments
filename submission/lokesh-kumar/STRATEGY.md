# Test Strategy: Subscription & Billing Service

**Author:** Lokesh Kumar

## 1. Understanding of the problem

The Subscription & Billing Service is stateful. A subscription moves through `trialing`, `active`, `past_due` and `canceled`, driven by API calls and by asynchronous, signed webhooks from an external payment provider. The hard parts to validate are not the endpoints, but:

- duplicate and redelivered webhooks
- out-of-order webhooks
- illegal state transitions
- agreement between the API response, the database and the payment-provider calls

The goal is to prove those properties, not to build a large framework or product.

## 2. Assumptions about the system under test

- No service is provided, so I built a **minimal service fixture** (Option 2/3) in TypeScript on **Express 5**.
- Persistence is **in-memory** behind repository classes. It is queryable from tests and keeps setup to `npm install`.
- Plans: `basic` (1900 USD, no trial) and `pro` (4900 USD, 14-day trial).
- Every subscription is created in `trialing`. For a plan with no trial, the "trial ends" moment is creation, so the first charge is attempted immediately. This keeps the state machine identical to the lifecycle diagram, with no extra start state.
- Time-based billing (trial end, renewal, retry) is triggered by a test hook, `POST /internal/subscriptions/{id}/bill`, instead of a scheduler.
- Provider outcomes: **success** and **decline** are returned synchronously and settle the invoice. A **timeout** means the outcome is unknown, so the invoice stays `pending` and the provider's webhook settles it later.
- Retries are exhausted after 3 consecutive failed charges (configurable).
- Webhooks carry `X-Provider-Signature`, an HMAC-SHA256 hex digest of the raw body.
- Strict reading of the diagram: only `trialing` and `active` can be canceled through the API. Cancelling `past_due` is rejected (409).

## 3. Scope

**In scope:** API contract, state machine, persistence, payment-provider interaction (mocked), webhook handling (signature, idempotency, ordering, validation), end-to-end flows.

**Out of scope:** UI, real payment provider, performance, taxes, proration, multi-currency. Concurrent webhook delivery is not tested (bonus item, see limitations).

## 4. Test levels

| Level | What is proven |
|---|---|
| Unit (state machine) | Every valid transition works; every other state x event pair is rejected (exhaustive) |
| API | Status codes, payload shape, validation errors, webhook signature and malformed-payload handling |
| Workflow | All 7 lifecycle transitions, driven by billing/API and by webhooks; invalid transitions are impossible |
| Database | Subscriptions, invoices, webhook events and the audit log are correct and consistent with each other |
| Provider mock | Call count and exact arguments; behaviour on success, decline and timeout |
| End to end | Request or webhook, through the service, to persistence and the provider, re-verified after every step |

## 5. Real vs mocked

| Component | Real or test double | Why |
|---|---|---|
| Service (Express app, domain logic) | Real | This is the system under test; driven in-process through `supertest`, so requests go through the real HTTP stack without a network port |
| Persistence (in-memory tables, repositories) | Real | Persistence is part of what is validated |
| Payment provider | **Fake** (`FakePaymentProvider`) | External dependency; needs configurable outcomes and call recording |
| Webhook delivery | **Simulated** (`WebhookSimulator`) | Gives full control over signatures, duplicates and ordering |
| Clock | **Fake** (`SteppingClock`) | Deterministic, strictly increasing timestamps |

## 6. Design patterns (each one solves a concrete problem here)

| Pattern | Where | Problem solved |
|---|---|---|
| State machine (explicit transition table) | `SubscriptionStateMachine` returns a result (`ok` + new state, or `ok: false` + reason) instead of throwing; `SubscriptionService.transition()` is the only place status changes | Illegal transitions are structurally unreachable; no ad hoc `status = ...` |
| Builder | `CreateSubscriptionRequestBuilder`, `WebhookEventBuilder`, `SubscriptionBuilder` | Scenarios read as intent. `SubscriptionBuilder` reaches a target state through the real API, never by editing the DB |
| Interface + dependency injection (Strategy/Adapter seam) | `PaymentProvider` interface; `FakePaymentProvider` injected in `TestEnvironment` | The service never makes a network call; tests control outcomes and record calls |
| Repository | `src/persistence/repositories.ts` (service) and `tests/support/repositories` (read-only, for verification) | No raw table access in tests; rows are returned as copies |
| Factory | `TestEnvironment.create()` | One call gives an isolated app, DB, provider and clients |

## 7. Test architecture

`TestEnvironment` (fixtures) -> `ApiClient` / `WebhookSimulator` (transport, supertest) -> `FakePaymentProvider` (double) -> read repositories (persisted state) -> `ConsistencyVerifier` / `ProviderVerifier` (assertions) -> `specs` (scenarios) with builders for data. Each layer has one job, and specs contain intent only.

## 8. Webhook and idempotency strategy

- Order of checks: signature over the raw body (401), then JSON and shape (400), then business rules.
- Each `event_id` is stored in `webhook_events`. A redelivery increments `deliveryCount` and returns `200 {status:"duplicate"}`: no state change, no invoice, no provider call.
- The duplicate check, validation and state change run with no `await` in between, so two deliveries cannot interleave inside the process.
- A settled invoice (`paid` or `failed`) never changes again. A contradictory later event (for example `payment.failed` after `payment.succeeded`) is recorded as `ignored_stale` and changes nothing.
- Events for a `canceled` subscription are recorded as `ignored_canceled` and never modify anything.
- Unknown subscription, an invoice that belongs to another subscription (404), or an amount/currency mismatch (422) are rejected and **not** persisted.

## 9. API contracts under test

- `POST /subscriptions`: 201; 400 for validation and unknown plan; 404 for unknown customer
- `GET /subscriptions/{id}`: 200; 404
- `POST /subscriptions/{id}/cancel`: 200; 409 for an invalid transition; 404
- `POST /webhooks/payment-provider`: 200 (applied / ignored / duplicate); 401 bad or missing signature; 400 malformed; 404; 422
- `POST /internal/subscriptions/{id}/bill`: test hook; 409 if canceled

## 10. Database entities and invariants

**Entities:** `subscriptions`, `invoices`, `webhook_events`, audit log.

`ConsistencyVerifier` is run after every step of the lifecycle and end-to-end tests:

1. API view equals the persisted row (status, plan, customer).
2. An `active` subscription has at least one persisted payment that was actually collected.
3. No duplicate invoice ids or provider idempotency keys.
4. Each invoice is internally coherent (paid has `paidAt` and no failure reason; failed has a reason and no `paidAt`; pending has no `paidAt`).
5. The audit log is an unbroken chain from `created` to the current status, and every step is a legal transition (checked against a hand-written oracle, independent of the service).
6. `canceled` is terminal: nothing follows it in the audit log.
7. Timestamps are coherent.

Provider invariants: one charge per genuine billing attempt; no charge for rejected creation, cancellation, replayed webhooks, or webhooks in general; each attempt has a distinct idempotency key.

**Isolation / no stale data:** every test gets a new service, database and provider.

## 11. Workflow

Red, Blue, Green: write a failing test for an invariant, add the minimum fixture code, then refactor for readability. To check the tests can fail, I also injected eight deliberate bugs (duplicate events re-processed, canceled not protected, stale events applied, wrong charge amount, unsigned and forged webhooks accepted, an illegal transition added, retry limit ignored); every one was caught by at least one test.

## 12. Known limitations

- The service is a minimal fixture, not production code.
- Provider and webhook delivery are simulated; real network behaviour and signature header formats of a specific provider are not verified.
- A timed-out charge is treated as "unknown, wait for the webhook". There is no automatic reconciliation if the webhook never arrives.
- Invoices are terminal once settled, so a late `payment.succeeded` after a `payment.failed` for the same invoice is ignored. A real system might reconcile this.
- Concurrent (parallel) delivery of two webhooks is not tested. The handler is synchronous, which prevents interleaving in one process, but a multi-process deployment would need database-level uniqueness.
- Linting is ESLint (typescript-eslint recommended rules) and types are checked with strict `tsc`; there is no formatter or coverage gate.
