# Test & Design Strategy — Subscription & Billing Validation Suite

**Author:** Vedant Dalkari  
**Scope:** Automated validation framework and minimal hybrid service fixture (`submission/vedant-dalkari/`)

---

## 1. System Under Test (SUT) Assumptions

This submission uses **Option 3 (Hybrid)**: because no pre-built billing service exists in the repository, `src/` provides a minimal, structurally strict **Express + TypeScript + SQLite (`sql.js`)** service fixture, while `test/` implements an **object-oriented multi-layer validation framework** around it.

- **Real inside the fixture boundary:**
  - HTTP routing, validation, status codes, and JSON serialization (`express`).
  - Raw request body capture and `HMAC-SHA256` verification (`X-Provider-Signature`) using constant-time comparison (`crypto.timingSafeEqual`).
  - Relational SQLite persistence (`sql.js` WASM SQLite with `PRAGMA foreign_keys = ON`, `UNIQUE` constraints, and explicit transactions).
  - Plan policy evaluation (`PlanPolicy` strategy) and transition enforcement (`LifecycleEngine`).
- **Doubled at external boundaries:**
  - `BillingGateway` (external payment processor interface) — substituted with `RecordingBillingGateway` supporting scripted `approved`, `declined`, and `timeout` outcomes, plus call-count and argument capture.
  - `Clock` — substituted with `ControlledClock` so trial expiration, billing periods, and retry schedules run deterministically with zero `sleep` calls.
  - `Notifier` — substituted with `AuditSpyNotifier` to prove duplicate webhooks never trigger duplicate customer notifications.

---

## 2. Scope & Test Levels

| Level | Directory | What It Proves |
|---|---|---|
| **API & Transport Security** | `test/specs/api/` | Request/response schemas, HTTP status codes, validation rejections (`400`/`404`/`409`/`422`), and webhook transport checks (missing/forged signature `401`, invalid JSON/missing payload fields `400`) separated from business logic |
| **State Machine & Billing Lifecycle** | `test/specs/lifecycle/` | All 7 mandatory valid transitions, `>= 3` impossible transitions rejected (`409`), compile-time status mutation safety (`@ts-expect-error`), and plan-specific trial/immediate-charge policies |
| **Webhook Idempotency, Ordering & Refunds** | `test/specs/webhooks/` | Duplicate `event_id` returns `200` idempotent no-op with zero duplicate transitions/invoices/charges/notifications; stale `payment.failed` after `payment.succeeded` for the same invoice cannot regress `active`; `payment.refunded` behavior |
| **External Provider Seam** | `test/specs/provider/` | Exact call count (`1` per genuine billing attempt, `0` on invalid requests or replayed webhooks), exact arguments (`customerId`, `amountCents`, `currency`, `paymentMethodId`, `idempotencyKey`), and `approved` / `declined` / `timeout` behavior |
| **Database & Cross-Entity Invariants** | `test/specs/persistence/` | Stage-by-stage SQL verification via independent test-side `LedgerInspector` across `subscriptions`, `invoices`, `payment_attempts`, `webhook_events`, and `subscription_audit_log` |
| **End-to-End & Concurrency** | `test/specs/e2e/` | Complete customer journeys across API + scheduler + webhooks + DB invariants, plus concurrent duplicate/conflicting webhook races |

**Explicit Out-of-Scope / Non-Goals:** frontend UI, live third-party Stripe/PSP calls, multi-currency FX conversion, tax calculation, proration math on mid-cycle upgrades, and load/soak benchmarking.

---

## 3. Object-Oriented Design Patterns Applied

| Pattern | Module(s) | Problem Solved |
|---|---|---|
| **State Machine + Branded Token** | `src/domain/LifecycleEngine.ts`, `src/persistence/SubscriptionRepo.ts` | Prevents ad-hoc `status = "active"` mutations across call sites. `LifecycleEngine.transition(current, trigger)` is the sole producer of a branded `ApprovedTransition` value required by `SubscriptionRepo.commitTransition(...)`. Bypassing it fails TypeScript compilation (verified via `@ts-expect-error`). |
| **Strategy** | `src/domain/PlanPolicy.ts`, `src/ports/BillingGateway.ts` | Eliminates scattered `if (plan === ...)` branches by encapsulating pricing, trial duration, immediate-vs-deferred billing, and retry caps behind `PlanPolicy` implementations (`StarterPlanPolicy`, `GrowthPlanPolicy`). Also decouples payment execution behind `BillingGateway`. |
| **Repository + Independent Inspector** | `src/persistence/*Repo.ts`, `test/framework/verify/LedgerInspector.ts` | Isolates SQL queries from business services in `src/`. In tests, `LedgerInspector` queries SQLite directly using independent SQL rather than calling SUT repositories so repository mapping bugs cannot mask themselves. |
| **Builder** | `test/framework/builders/*` | Constructs customers, subscription requests, and signed/unsigned webhook payloads with expressive defaults and intent-revealing overrides (`CustomerSpecBuilder`, `SignupPayloadBuilder`, `SignedWebhookBuilder`). |
| **Factory / Test Harness** | `test/framework/env/BillingTestHarness.ts` | Provisions an isolated per-test WASM SQLite DB, schema, seeded customer fixtures, `ControlledClock`, `RecordingBillingGateway`, `AuditSpyNotifier`, Express app, typed API/webhook clients, and automatic post-test `InvariantGuard` verification. |

---

## 4. API Contracts

### Plans Seeded / Registered
- **`starter`**: `1900` cents (`USD`), `trialDays: 0` (immediate first charge upon signup), `billingPeriodDays: 30`, `maxRetries: 2` (`+1 day` retry interval; initial fail sets `failed_attempts = 1`, retry 1 fail sets `2`, retry 2 fail sets `3` and exhausts to `canceled`).
- **`growth`**: `4900` cents (`USD`), `trialDays: 14` (starts in `trialing`, deferred first charge at `trial_ends_at = T0 + 14d`), `billingPeriodDays: 30`, `maxRetries: 2` (`+1 day` retry interval).

### Endpoints
1. **`POST /subscriptions`**
   - Request: `{ customer_id: string, plan: "starter" | "growth", payment_method_id: string }`
   - Responses:
     - `201 Created`: Subscription created (`trialing` for `growth`, `active` or `past_due` for `starter` depending on `BillingGateway` outcome) + initial invoice if billed immediately.
     - `400 Bad Request`: Missing/empty required fields or unknown `plan`.
     - `404 Not Found`: Unknown `customer_id`.
2. **`GET /subscriptions/:id`**
   - `200 OK`: Canonical subscription snapshot `{ id, customer_id, plan, status, current_period_start, current_period_end, trial_ends_at, failed_attempts, canceled_at, created_at, updated_at }`.
   - `404 Not Found`: Unknown subscription ID.
3. **`POST /subscriptions/:id/cancel`**
   - `200 OK`: Transitions `trialing` or `active` -> `canceled` (sets `canceled_at`, stops future billing, writes audit record). Zero provider charges.
   - `404 Not Found`: Unknown subscription ID.
   - `409 Conflict`: Already `canceled` or `past_due` (`past_due -> canceled` occurs strictly via `retries_exhausted` or `payment.refunded`).
4. **`POST /billing/run-due`** (hybrid scheduler trigger driven by injected `Clock`)
   - Evaluates due subscriptions (`trial_ends_at <= now` for `trialing`, or `current_period_end <= now` / retry due for `active` / `past_due`), calls `BillingGateway.charge(...)`, records invoice + payment attempt, and drives:
     - `trialing` + success -> `active`
     - `trialing` + decline/timeout -> `past_due`
     - `active` + decline/timeout -> `past_due`
     - `past_due` + success -> `active`
     - `past_due` + retries exhausted -> `canceled`
5. **`POST /webhooks/payment-provider`**
   - Header: `X-Provider-Signature: sha256=<hex_hmac_over_raw_utf8_body>`
   - Events handled: `payment.succeeded`, `payment.failed`, `payment.refunded`
   - Responses:
     - `401 Unauthorized`: Missing or invalid HMAC signature (recorded/rejected before parsing business transition; zero side effects).
     - `400 Bad Request`: Malformed JSON or invalid schema (`event_id`, `type`, `subscription_id`, `invoice_id`, `amount`, `currency`).
     - `200 OK` (`{ status: "duplicate_ignored", event_id }`): Already-processed `event_id` in `webhook_events` with matching payload hash -> strict no-op.
     - `409 Conflict` (`{ error: "webhook_payload_mismatch", event_id }`): Reused `event_id` with an altered payload hash -> zero state mutation.
     - `200 OK` (`{ status: "ignored_stale_or_invalid", outcome: "ignored_stale" | "ignored_invalid_transition" }`): Illegal/stale transitions (e.g., `canceled -> active`, `payment.failed` after `payment.succeeded` on same invoice) recorded once without triggering provider retries or mutating subscription/invoice/audit state.
     - `404 Not Found` / `422 Unprocessable Entity`: Unknown `subscription_id` (`404`) or plan-mismatched `amount`/`currency` (`422`).
     - `200 OK` (`{ status: "processed", ... }`): Valid transition + invoice/payment settlement record + audit log + webhook record written atomically in a SQL transaction.

---

## 5. Database Entities & Invariants Verified

### Tables (`src/persistence/schema.sql`)
1. `customers` (`id`, `email`, `name`, `created_at`)
2. `subscriptions` (`id`, `customer_id`, `plan`, `status`, `failed_attempts`, `trial_ends_at`, `current_period_start`, `current_period_end`, `canceled_at`, `created_at`, `updated_at`)
3. `invoices` (`id`, `subscription_id`, `amount_cents`, `currency`, `status` [`pending` | `paid` | `failed` | `refunded`], `period_start`, `period_end`, `created_at`, `updated_at`)
4. `payment_attempts` (`id`, `invoice_id`, `subscription_id`, `idempotency_key`, `amount_cents`, `currency`, `status` [`succeeded` | `declined` | `timeout`], `provider_reference`, `failure_reason`, `created_at`)
5. `webhook_events` (`event_id` PRIMARY KEY, `event_type`, `subscription_id`, `invoice_id`, `outcome` [`processed` | `ignored_invalid_transition` | `ignored_stale`], `payload_hash`, `received_at`)
6. `subscription_audit_log` (`id`, `subscription_id`, `from_status`, `to_status`, `trigger`, `actor`, `metadata_json`, `created_at`)

### Persistence & State-Machine Invariants (`InvariantGuard`)
- **`INV-1`**: An `active` subscription has at least one persisted `paid` (or previously `succeeded`) payment attempt and never exists with only failed attempts.
- **`INV-2`**: Once `canceled` is recorded in `subscription_audit_log`, no subsequent audit entry ever leaves `canceled`.
- **`INV-3`**: Every processed `webhook_events.event_id` appears at most once (`PRIMARY KEY`), and duplicate deliveries create zero additional invoices, payment attempts, audit rows, provider calls, or notifications.
- **`INV-4`**: `BillingGateway` call count equals the number of genuine billing attempts (never called on rejected requests or inbound webhooks).
- **`INV-5`**: `GET /subscriptions/:id` API state (`status`, `plan`, `failed_attempts`, `canceled_at`) matches `subscriptions` row in SQLite field-for-field at every stage.
- **`INV-6`**: Invoice amounts always match the subscription's `PlanPolicy` price (`1900` for `starter`, `4900` for `growth`).
- **`INV-7`**: A `paid` invoice never regresses to `failed`, and an `active` subscription never regresses to `past_due` when a stale `payment.failed` arrives for an already-settled invoice.
- **`INV-8`**: Every state change has a matching chronological entry in `subscription_audit_log` where `from_status -> to_status` is a legal edge in `LifecycleEngine`.

### Isolation & Freshness
Each test creates a brand-new in-memory `sql.js` SQLite database initialized directly from `schema.sql`, with deterministic customer seeding (`CustomerSpecBuilder`), eliminating stale-state leakage and ordering dependencies between tests.

---

## 6. Known Limitations & Tradeoffs
- **Embedded WASM SQLite (`sql.js`)**: Provides real relational SQL constraints, foreign keys, and transactional rollback across Node 20/22/24 without native C++ build requirements on Windows; trades off multi-process file-level lock contention testing (simulated instead via promise concurrency in the same Node process).
- **Simulated Billing Scheduler (`POST /billing/run-due`)**: Replaces an external cron daemon so trial expirations and retry exhaustion execute synchronously under `ControlledClock`.
- **Refund Policy**: `payment.refunded` on a `paid` invoice transitions `active`/`past_due` -> `canceled` (reason `payment_refunded`) and marks the invoice `refunded` while retaining the historical `succeeded` `payment_attempts` row for auditability.
