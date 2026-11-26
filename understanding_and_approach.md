# Test Strategy — Subscription & Billing Service

**Author:** Harshwardhan Kapure
**Status:** Approach / design (written before implementation)
**Location:** `submission/harshwardhan-kapure/`

---

## 1. Goal

Build an object-oriented automated validation suite that proves the Subscription & Billing Service is correct across **API, state machine, persistence, and external-integration (payment provider)** layers. The suite focuses on correctness for a stateful, billed workflow: valid lifecycle transitions only, idempotent webhook handling, and persisted state that always agrees with what the API reports.

## 2. System Under Test — Approach

**Option 3 — Hybrid.** No service implementation is provided, so I will build:

- a **minimal Express service fixture** that implements the four endpoints and the subscription lifecycle, and
- **test doubles** for the external payment provider and webhook sender.

The fixture is deliberately small. It exists to make the test design demonstrable, not to be a product.

## 3. Assumptions

- Two plans exist: `basic` and `pro`, with different prices and trial lengths (e.g. basic: 1900 cents, 7-day trial; pro: 4900 cents, 14-day trial). A plan with 0 trial days is charged immediately on creation.
- Amounts are integer minor units (cents), single currency (`USD`).
- "Trial ends" is triggered explicitly (a test hook / billing-run call) rather than by wall-clock time, so tests are deterministic.
- Retries exhausted is modelled as a configurable max retry count (e.g. 3 failed charges while `past_due` → `canceled`).
- Webhooks are signed with HMAC-SHA256 over the raw request body using a shared secret, sent in `X-Provider-Signature`.
- Customers and payment methods are seeded; an unknown `customer_id` or `payment_method_id` is a validation error.
- Persistence is in-memory and is reset per test.

## 4. Scope

**In scope**
- API contract and validation: create, get, cancel, webhook endpoint.
- Every valid lifecycle transition, and at least two invalid ones proven impossible.
- Webhook idempotency (duplicate `event_id`), out-of-order and stale events.
- Webhook request handling: valid, missing, or forged signature; malformed payload.
- Payment provider interaction: call count, call arguments, success / decline / timeout.
- Persistence checks for subscriptions, invoices, webhook events, and audit log at every lifecycle stage.
- End-to-end flows from API call or webhook → service → persistence → provider.

**Out of scope** (per the non-goals)
- UI, real payment provider, performance/load testing, monitoring.
- Proration edge cases, multi-currency, taxes.
- Concurrent/racing webhook delivery. This is a stretch goal and is listed as a limitation if not reached.

## 5. Test Levels

| Level | What is verified | Driven by |
|---|---|---|
| API | Status codes, payload shape, validation errors, webhook request handling | Typed `ApiClient` over Supertest |
| State machine | Valid transitions occur, invalid ones are rejected or ignored | API calls + signed webhooks |
| Persistence | Rows match API result and business rules, with no duplicate or contradictory records | `Repository` queries |
| Integration (mocked) | Provider called exactly when a charge is genuinely needed, with correct args | `MockPaymentProvider` |
| End-to-end | Full path through service, DB, and provider | Scenario specs |

## 6. Real vs Mocked

| Component | Real / Double | Why |
|---|---|---|
| HTTP routes, validation, state machine, billing logic | **Real** (the fixture) | This is the behaviour under test |
| Persistence | **Real in-memory repository** | Queryable and fast; reset per test for isolation |
| Payment provider (outbound charge) | **Mock** (`MockPaymentProvider`, backed by `vi.fn()`) | External dependency; need deterministic success / decline / timeout and call recording |
| Payment provider (inbound webhooks) | **Simulated** (`WebhookBuilder` + signer) | Tests control event ordering, duplication, and signature validity |
| Clock / trial expiry | **Controlled** (explicit trigger) | Removes time-based flakiness |

## 7. Design Patterns (planned)

Patterns are only used where they solve a concrete problem.

| Pattern | Where | Problem it solves |
|---|---|---|
| **State machine (explicit transition table)** | `src/stateMachine.ts` | One source of truth for legal transitions. Status cannot be mutated ad hoc; illegal transitions are structurally rejected. |
| **Builder** | `tests/support/builders/` (`SubscriptionBuilder`, `CustomerBuilder`, `WebhookBuilder`) | Scenarios read as intent (`aWebhook().paymentFailed().forSub(id).signed()`) instead of repeated object literals. |
| **Dependency injection / Strategy (payment provider seam)** | `src/paymentProvider.ts` interface, injected into `createApp(deps)` | Lets tests substitute a mock with configurable outcomes; no real network calls. |
| **Strategy (plan pricing)** | `src/plans.ts` | Plan price/trial rules live in one place instead of branching across the codebase. |
| **Repository** | `src/repository.ts` | Tests verify persistence via named queries, not raw data access scattered through specs. |
| **Factory** | `createApp(deps)`, `TestContext.create()` | Builds an isolated app + repo + mock per test in one call. |

## 8. API Contracts

| Method & Path | Success | Failure cases tested |
|---|---|---|
| `POST /subscriptions` | `201` + `{ id, customer_id, plan, status, trial_ends_at }` | `400` unknown plan, missing fields, invalid payment method; `404`/`422` unknown customer |
| `GET /subscriptions/{id}` | `200` + subscription | `404` unknown id |
| `POST /subscriptions/{id}/cancel` | `200` + `status: canceled` | `409` already canceled; `404` unknown id |
| `POST /webhooks/payment-provider` | `200` processed, or `200` duplicate no-op | `401` missing/forged signature; `400` malformed payload |

Event types handled: `payment.succeeded`, `payment.failed`, `payment.refunded`.

## 9. Lifecycle Under Test

```
trialing --(trial ends, charge succeeds)--> active
trialing --(trial ends, charge fails)-----> past_due
active   --(recurring charge fails)-------> past_due
past_due --(retry succeeds)---------------> active
past_due --(retries exhausted)------------> canceled
active   --(API cancel)-------------------> canceled
trialing --(API cancel)-------------------> canceled
```

- **All 7 valid transitions** are exercised (parameterised with `it.each`).
- **Invalid transitions proven impossible**, at minimum:
  1. `canceled → active` via a stray `payment.succeeded` webhook
  2. `payment.failed` arriving after `payment.succeeded` for the same invoice must not regress `active → past_due`
  3. Cancelling an already-canceled subscription is rejected

## 10. Database Entities & Invariants

**Entities checked:** `subscriptions`, `invoices` (with payment attempts), `webhook_events`, `audit_log`.

**Invariants asserted:**
1. A subscription is never `active` without at least one persisted successful payment.
2. A `canceled` subscription never transitions again, regardless of later webhooks.
3. Duplicate webhook delivery never creates duplicate invoices, payments, or provider charges.
4. The provider mock is called at most once per genuine billing attempt, and never for rejected creation or replayed webhooks.
5. Persisted subscription status always equals the status returned by the API, checked at every lifecycle step, not only at creation.
6. Plan price and trial rules are identical at creation and at billing.
7. No contradictory records exist (for example, an `active` subscription whose only invoice is failed).
8. Every state change has a matching `audit_log` entry with a coherent `from → to` and timestamp order.

**Seeding and cleanup:** each test gets a fresh `TestContext` (new repository, new mock, new app instance). There is no shared state between tests, so stale data cannot cause false positives. Tests also assert on exact row counts, not just existence.

## 11. Webhook & Idempotency Strategy

- Every inbound event is stored in `webhook_events` keyed by `event_id`, with outcome `processed`, `duplicate`, or `rejected`.
- The signature is verified **before** any parsing or business logic. Unsigned or forged requests return `401` and persist nothing.
- A repeated `event_id` returns `200` (so the provider stops retrying), is recorded as `duplicate`, and causes **no** state change, invoice write, audit entry, or provider call.
- Out-of-order or stale events are evaluated against the state machine and the invoice's current status. An event that would cause an illegal or regressive transition is safely ignored and recorded, not applied.

**How it is proven:** send the same signed event twice, then assert one transition, one invoice row, one processed plus one duplicate `webhook_events` row, and unchanged provider call count.

## 12. Payment Provider Mock

`MockPaymentProvider` implements the `PaymentProvider` interface, wraps `vi.fn()`, and supports:

- configurable outcome per call: `success`, `declined`, `timeout`
- call recording for `toHaveBeenCalledTimes` / `toHaveBeenCalledWith`

Assertions check the **arguments** (amount per plan, customer id, payment method, idempotency/reference id), not just that a call happened.

Timeout behaviour: no success record is written, the invoice is recorded as failed/pending, and the subscription does not become `active`.

## 13. Test Architecture

```
submission/harshwardhan-kapure/
├── src/                      # minimal service fixture
│   ├── app.ts                # createApp(deps) — Express routes
│   ├── stateMachine.ts       # transition table
│   ├── plans.ts              # plan strategy (price, trial)
│   ├── paymentProvider.ts    # provider interface (seam)
│   ├── repository.ts         # in-memory Repository
│   └── signature.ts          # HMAC sign/verify
└── tests/
    ├── support/
    │   ├── TestContext.ts    # fixtures / isolation
    │   ├── ApiClient.ts      # typed HTTP client
    │   ├── MockPaymentProvider.ts
    │   ├── builders/         # Subscription, Customer, Webhook builders
    │   └── assertions.ts     # expectApiMatchesDb, expectNoDuplicateInvoices, ...
    └── specs/
        ├── api.spec.ts
        ├── stateMachine.spec.ts
        ├── idempotency.spec.ts
        ├── provider.spec.ts
        ├── persistence.spec.ts
        └── e2e.spec.ts
```

Specs contain only intent: build data, perform an action, assert. Transport, signing, and persistence details live in the support layer.

## 14. Workflow

Red → Blue → Green: write a failing test for a behaviour or invariant, add the minimum fixture code to pass it, then refactor helpers and builders while keeping the suite green. Commit history will reflect this order.

**Tooling:** TypeScript, Vitest, Supertest, Express, in-memory persistence. Commands: `npm test`, `npm run build` (`tsc --noEmit`).

## 15. Known Limitations / Risks

- In-memory persistence does not exercise real DB transactions, constraints, or isolation levels.
- Concurrent/racing webhook processing is not covered unless time allows.
- Trial expiry and retries are triggered explicitly, so real scheduler behaviour is not tested.
- The payment provider is fully mocked, so real provider contract drift is not detected (contract tests would be the next step).
- Refund handling (`payment.refunded`) is validated for recording only; deeper refund business rules are out of scope.