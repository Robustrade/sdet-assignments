# Test Strategy — Subscription & Billing Service

**Author:** Harshwardhan Kapure  
**Approach:** Option 3 — Hybrid (lightweight Express + TypeScript service fixture with an in-memory repository and mocked payment provider)  
**Location:** `submission/harshwardhan-kapure/`

---

## 1. Purpose

This document defines the validation strategy and test architecture for the **Subscription & Billing Service** before writing implementation or test code. The goal is to prove correctness across API contracts, lifecycle state transitions, persistence invariants, and external payment provider interactions for a stateful, billed workflow.

---

## 2. Assumptions About the System Under Test

1. **System Under Test (Option 3 — Hybrid):** Because no running service was provided, I will implement a minimal, clean Express + TypeScript service fixture in `src/` alongside an object-oriented test framework in `tests/support/` and scenario specifications in `tests/specs/`.
2. **Plans:** Two plans exist, configured via a Strategy/config mapping in `src/plans.ts` (no `if/else` branching):
   - `basic`: `1900` cents (`$19.00` USD), `0` trial days — charged immediately upon creation.
   - `pro`: `4900` cents (`$49.00` USD), `14` trial days — starts in `trialing` with `trial_ends_at` set to 14 days after creation, and is charged when the trial ends.
3. **Currency & Amounts:** All monetary amounts are integer minor units (cents) in `USD`.
4. **Customers & Payment Methods:** Customers and their payment methods are seeded in the repository. Creating a subscription with an unknown `customer_id` or invalid/unknown `payment_method_id` is rejected without calling the payment provider or writing subscription/invoice rows.
5. **Deterministic Time & Billing Triggers:** Trial expiry, recurring billing, and retries are triggered explicitly via `POST /subscriptions/:id/bill` rather than wall-clock timers, eliminating time-based flakiness.
6. **Retry Exhaustion:** A subscription in `past_due` has a configurable `maxRetries` threshold (default `3`). When failed charge attempts while `past_due` reach `maxRetries`, the subscription transitions `past_due -> canceled`.
7. **Webhook Security:** Inbound webhooks at `POST /webhooks/payment-provider` carry `X-Provider-Signature`, computed as HMAC-SHA256 hex digest over the exact raw request body bytes using a shared webhook secret.
8. **Persistence:** An in-memory `Repository` stores `subscriptions`, `invoices`, `webhook_events`, and `audit_log` per `TestContext` instance.

---

## 3. Scope

### In Scope
- **API contracts & validation:** `POST /subscriptions`, `GET /subscriptions/:id`, `POST /subscriptions/:id/cancel`, `POST /webhooks/payment-provider`, plus `POST /subscriptions/:id/bill` for deterministic billing runs.
- **State-machine lifecycle:** All 7 valid transitions and proof that invalid transitions (including `canceled -> active` via stray webhook, `active -> past_due` from out-of-order `payment.failed` after `payment.succeeded` for the same invoice, and canceling an already `canceled` subscription) are rejected or safely ignored.
- **Webhook security & idempotency:** Valid, missing, and forged HMAC-SHA256 signatures; malformed JSON/missing fields; duplicate `event_id` redelivery; out-of-order delivery (`payment.failed` after `payment.succeeded`); `payment.succeeded`, `payment.failed`, and `payment.refunded` event types.
- **Payment provider integration (mocked):** Call counts, exact arguments (`customerId`, `amount`, `paymentMethodId`, `idempotencyRef`), and service behavior under `success`, `declined`, and `timeout` outcomes.
- **Persistence & auditability:** Verification of `subscriptions`, `invoices`, `webhook_events`, and `audit_log` at every lifecycle stage, ensuring API responses always match persisted state.
- **End-to-end flows:** Full lifecycle journeys from subscription creation through billing, decline, retry recovery, cancellation, and webhook processing.

### Out of Scope
- Frontend UI, real external payment gateway calls, load/performance testing, and production monitoring/alerting.
- Proration math, multi-currency conversion, and tax calculation.
- Concurrent/racing webhook delivery (two webhooks for the same subscription processed simultaneously) — noted under Known Limitations.

---

## 4. Test Levels

| Level | Scope | Driver & Verification |
|---|---|---|
| **API Contract & Validation** | Status codes, response payloads, input validation, HMAC signature & malformed payload handling | `ApiClient` (typed wrapper over Supertest) |
| **State-Machine / Workflow** | All 7 valid transitions (`it.each`) and illegal/regressive transitions via API calls and webhooks | `SubscriptionStateMachine`, `ApiClient`, `WebhookBuilder` |
| **Database / Persistence** | Exact row state and counts across `subscriptions`, `invoices`, `webhook_events`, `audit_log`; zero orphan/contradictory rows | `Repository` queries + `assertions.ts` helpers |
| **External Integration (Mock)** | `PaymentProvider` seam call count, arguments, and behavior on `success`, `declined`, `timeout` | `MockPaymentProvider` (backed by `vi.fn()`) |
| **End-to-End** | Multi-step journeys combining API calls, billing triggers, signed webhooks, provider mocks, and DB assertions | `tests/specs/e2e.spec.ts` |

---

## 5. Real vs. Mocked Components

| Component | Real or Double | Rationale |
|---|---|---|
| Express HTTP app, routing, signature verification, validation, state machine, billing logic | **Real** (service fixture in `src/`) | Core behavior under test; must execute real validation, routing, and transition guards. |
| Persistence (`Repository`) | **Real** (in-memory store in `src/repository.ts`) | Fast, deterministic, queryable per entity, and reset cleanly per test without external DB setup friction. |
| Outbound Payment Provider (`PaymentProvider`) | **Mock** (`MockPaymentProvider` implementing `PaymentProvider`) | External third-party boundary; mocking enables deterministic `success`, `declined`, and `timeout` responses and strict verification of call counts and arguments. |
| Inbound Webhook Delivery | **Simulated** (`WebhookBuilder` + HMAC-SHA256 signer) | Allows deterministic testing of valid, unsigned, forged, malformed, duplicate, and out-of-order webhook deliveries. |
| Time / Trial Expiry | **Controlled** (explicit `POST /subscriptions/:id/bill` trigger) | Eliminates wall-clock flakiness while testing the exact billing execution path. |

---

## 6. Design Patterns & Where Applied

| Pattern | Location | Concrete Problem Solved |
|---|---|---|
| **State Machine (Explicit Transition Table)** | `src/stateMachine.ts` (`SubscriptionStateMachine`) | Centralizes all 7 legal transitions in one immutable table. Eliminates ad-hoc `status = ...` mutations across routes/services and structurally rejects illegal transitions. |
| **Strategy** | `src/plans.ts` (`PlanStrategy`, `PLANS` registry) | Encapsulates plan pricing, trial length, and immediate-charge behavior per tier without scattered `if/else` plan checks. |
| **Dependency Injection / Interface Seam** | `src/paymentProvider.ts` (`PaymentProvider`), `src/app.ts` (`createApp(deps)`) | Decouples billing logic from any concrete gateway so tests inject `MockPaymentProvider` with zero network calls. |
| **Repository** | `src/repository.ts` (`InMemoryRepository`) | Abstracts storage and query operations for `subscriptions`, `invoices`, `webhook_events`, `audit_log`, and `customers` behind typed methods used by both the service and test assertions. |
| **Factory** | `src/app.ts` (`createApp`), `tests/support/TestContext.ts` (`TestContext.create`) | Constructs a fresh, isolated service + repository + mock provider + API client graph per test case. |
| **Builder** | `tests/support/builders/` (`CustomerBuilder`, `SubscriptionBuilder`, `WebhookBuilder`) | Expresses test setup and signed/unsigned/forged/malformed webhook construction as readable domain intent rather than repetitive object literals. |

---

## 7. API Contracts

| Endpoint | Success Response | Error / Edge Responses |
|---|---|---|
| `POST /subscriptions` | `201 Created` — `{ id, customer_id, plan, status, trial_ends_at, retry_count, created_at, updated_at }` | `400` missing required fields, unknown `plan`, invalid `payment_method_id`; `404` unknown `customer_id` |
| `GET /subscriptions/:id` | `200 OK` — subscription resource | `404` unknown subscription id |
| `POST /subscriptions/:id/cancel` | `200 OK` — subscription with `status: "canceled"` | `404` unknown subscription id; `409` invalid transition (e.g., already `canceled` or `past_due`) |
| `POST /subscriptions/:id/bill` | `200 OK` — `{ subscription, invoice, outcome }` | `404` unknown subscription id; `409` cannot bill `canceled` subscription |
| `POST /webhooks/payment-provider` | `200 OK` — `{ status: "processed" \| "duplicate" \| "ignored", event_id }` | `401` missing or forged `X-Provider-Signature`; `400` malformed JSON or missing required fields |

---

## 8. Database Entities & Invariants Checked

### Persisted Entities (`src/repository.ts`)
1. **`subscriptions`** — `id`, `customer_id`, `plan`, `status`, `payment_method_id`, `trial_ends_at`, `retry_count`, `created_at`, `updated_at`
2. **`invoices`** — `id`, `subscription_id`, `customer_id`, `amount`, `currency`, `status` (`pending` | `paid` | `failed` | `refunded`), `provider_outcome`, `idempotency_ref`, `created_at`, `updated_at`
3. **`webhook_events`** — `id`, `event_id`, `type`, `subscription_id`, `invoice_id`, `processing_status` (`processed` | `duplicate` | `ignored`), `received_at`
4. **`audit_log`** — `id`, `subscription_id`, `from_status`, `to_status`, `trigger`, `created_at`

### Key Invariants Asserted (`tests/support/assertions.ts`)
- **API–DB parity:** `GET /subscriptions/:id` status and plan always equal the persisted `subscriptions` row at every lifecycle stage (`expectApiMatchesDb`).
- **No unpaid active state:** A subscription never reaches `active` without at least one persisted `invoices` row with `status === 'paid'`.
- **Terminal cancellation:** A `canceled` subscription never transitions to any other state regardless of subsequent webhooks or billing calls.
- **No duplicate billing artifacts:** Duplicate `event_id` delivery produces zero duplicate `invoices` rows (`expectNoDuplicateInvoices`), zero extra `audit_log` transitions, and zero provider calls.
- **Provider call discipline:** `MockPaymentProvider.charge` is called at most once per genuine billing attempt and never for rejected creation, cancellation, or replayed webhooks, with verified arguments (`expectProviderCalledWith`).
- **Plan consistency:** Charged invoice amounts match the plan strategy (`1900` for `basic`, `4900` for `pro`) at both creation and billing.
- **Audit coherence:** Every status change writes a matching `audit_log` entry recording `from_status`, `to_status`, and `trigger`.

---

## 9. Webhook Idempotency & Out-of-Order Strategy

1. **Signature-first middleware:** Raw request bytes are captured before JSON parsing. `X-Provider-Signature` (HMAC-SHA256 hex) is verified using timing-safe comparison. Invalid/missing signatures return `401` immediately with zero DB writes.
2. **Payload validation:** After signature verification, malformed JSON or missing required fields (`event_id`, `type`, `subscription_id`) return `400` with zero state changes.
3. **Deduplication by `event_id`:** Before executing any business logic, the handler checks `webhook_events` for an existing entry with the same `event_id`. If found, the service records a `duplicate` observation (or logs duplicate delivery without mutating business state), returns `200 OK { status: "duplicate" }`, and triggers **no** state transition, **no** invoice write, **no** audit log entry, and **no** payment provider call.
4. **Out-of-order & stale event guard:**
   - If a `payment.failed` webhook arrives for an `invoice_id` whose persisted status is already `paid`, it is rejected/ignored as stale (`processing_status: "ignored"`): the invoice stays `paid` and an `active` subscription does not regress to `past_due`.
   - If a `payment.succeeded` webhook arrives for a `canceled` subscription, the state machine rejects `canceled -> active`, the subscription remains `canceled`, and the webhook is recorded as `ignored`.

---

## 10. Data Seeding & Cleanup

- Each test initializes a fresh `TestContext` via `TestContext.create()`, which instantiates a brand-new `InMemoryRepository`, `MockPaymentProvider`, and Express `app` wrapped in `ApiClient`.
- Customers and payment methods are seeded explicitly per test using `CustomerBuilder` (`ctx.seedCustomer(...)`), and subscriptions are seeded either via API calls (`SubscriptionBuilder`) or repository helpers.
- Because no repository, mock, or app instance is shared across tests, tests cannot pollute one another or produce false positives from stale data. Assertions check exact row counts in addition to field values.

---

## 11. Known Limitations

1. **In-memory persistence:** Does not exercise real SQL transactions, unique constraint errors at the DB driver level, or connection failures.
2. **Concurrency / race conditions skipped:** Parallel/racing webhook deliveries for the same `event_id` or `subscription_id` (e.g., distributed locks / `INSERT ... ON CONFLICT DO NOTHING`) are out of scope for this submission.
3. **Explicit billing trigger:** Trial expiration and recurring billing are triggered synchronously via `POST /subscriptions/:id/bill` rather than background cron/job queues.
4. **Mocked payment provider:** Protects against logic/integration bugs against the defined `PaymentProvider` interface, but does not detect upstream third-party API schema drift.
5. **Refund scope:** `payment.refunded` records refund metadata on `invoices` and `webhook_events` without reversing subscription access or calculating prorated refund amounts.
