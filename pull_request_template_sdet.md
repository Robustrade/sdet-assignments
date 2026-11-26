## Summary
I built an automated test suite and a lightweight Express + TypeScript service fixture (Option 3 — Hybrid) for the Subscription & Billing Service under `submission/harshwardhan-kapure/`. Before writing any code, I documented the test strategy and domain assumptions in [`TEST_STRATEGY.md`](./TEST_STRATEGY.md).

## Test Strategy
- **Levels covered:**
  - **API contract & validation:** status codes, response shapes, request validation errors, `Idempotency-Key` handling, and webhook signature/JSON checks (`tests/specs/api.spec.ts`).
  - **State-machine & lifecycle:** all 7 valid transitions tested with `it.each`, plus invalid and out-of-order transition guards (`tests/specs/stateMachine.spec.ts`).
  - **Database / persistence:** verifying `subscriptions`, `invoices`, `webhook_events`, and `audit_log` at every step of the lifecycle, not just at creation (`tests/specs/persistence.spec.ts`).
  - **Mock payment provider integration:** checking call counts, exact arguments, and how the service behaves on `success`, `declined`, `timeout`, and thrown errors (`tests/specs/provider.spec.ts`).
  - **Webhook idempotency & end-to-end flows:** duplicate `event_id` replays (`tests/specs/idempotency.spec.ts`) and full customer billing journeys (`tests/specs/e2e.spec.ts`).
- **In scope:** subscription creation (`basic` with immediate charge, `pro` with a 14-day trial), retrieval, cancellation, retryable `POST /subscriptions` via `Idempotency-Key`, explicit billing runs (`POST /subscriptions/:id/bill`), signed webhooks (`payment.succeeded`, `payment.failed`, `payment.refunded`), duplicate `event_id` deduplication, out-of-order failure protection, and persistence invariants.
- **Out of scope:** UI, real payment gateway calls, load/performance testing, proration, taxes, multi-currency, and concurrent/racing webhook delivery.
- **What is real vs stubbed/mocked, and why:**
  - The Express routes, validation, HMAC-SHA256 verification (`src/signature.ts`), state machine (`src/stateMachine.ts`), billing orchestration (`src/billingService.ts`), plan pricing rules (`src/plans.ts`), and in-memory repository (`src/repository.ts`) are all **real** so the suite tests actual routing, guards, and persistence logic.
  - The external payment gateway is **mocked** (`MockPaymentProvider` in `tests/support/MockPaymentProvider.ts`) so tests can deterministically trigger `success`, `declined`, `timeout`, or thrown network errors and inspect the exact arguments sent to the provider.
  - Inbound webhooks are **simulated** using `WebhookBuilder` (`tests/support/builders/WebhookBuilder.ts`), and trial end / recurring billing cycles are triggered explicitly via `POST /subscriptions/:id/bill` instead of waiting on real clocks.

## OOP & Design Pattern Choices
- **Which patterns did you use, and where (file/class)?**
  - **State Machine (explicit transition table):** `SubscriptionStateMachine`, `ALLOWED_TRANSITIONS`, and `InvalidTransitionError` in `src/stateMachine.ts`.
  - **Strategy:** `PlanStrategy` and the `PLANS` map (`basic`, `pro`) in `src/plans.ts`.
  - **Dependency Injection / Interface Seam:** `PaymentProvider` in `src/paymentProvider.ts`, passed into `createApp(deps)` in `src/app.ts` and `BillingService` in `src/billingService.ts`.
  - **Repository:** `SubscriptionRepository` and `InMemoryRepository` in `src/repository.ts`.
  - **Factory:** `createApp(deps)` in `src/app.ts` and `TestContext.create()` in `tests/support/TestContext.ts`.
  - **Builder:** `CustomerBuilder`, `SubscriptionBuilder`, and `WebhookBuilder` under `tests/support/builders/`.
- **What problem did each one actually solve in your codebase?**
  - `SubscriptionStateMachine` keeps all 7 legal transitions in a single table. Nowhere else in the codebase mutates `status` directly, which makes illegal jumps structurally impossible.
  - `PlanStrategy` / `PLANS` avoids scattering `if (plan === 'pro')` checks across creation and billing whenever price (`1900` vs `4900`) or trial days (`0` vs `14`) are needed.
  - `InMemoryRepository` gives both the service and the test assertions clean domain methods and clones records on read/write so tests can't accidentally mutate internal state.
  - `TestContext.create()` spins up an isolated repository, mock provider, Express app, and `ApiClient` for every single test so state never leaks between runs.
  - The Builders keep tests readable (`aWebhook().paymentFailed().forSubscription(sub.id).forged()`) instead of repeating raw JSON payloads everywhere.
- **What's the seam around the payment provider (interface, injection point)?**
  - `PaymentProvider` (`src/paymentProvider.ts`) exposes `charge(customerId, amount, paymentMethodId, idempotencyRef): Promise<ChargeOutcome>`. It is injected via `AppDependencies` into `createApp(deps)` and consumed by `BillingService`. In tests, `TestContext` passes in `MockPaymentProvider`.

## API Validation Approach
- All HTTP calls go through `ApiClient` (`tests/support/ApiClient.ts`), a typed wrapper around Supertest, keeping HTTP plumbing out of the spec files.
- On `POST /webhooks/payment-provider`, I mounted `express.raw({ type: '*/*' })` so `verifyWebhookSignature` (`src/signature.ts`) checks `X-Provider-Signature` with `crypto.timingSafeEqual` against the exact raw bytes *before* `JSON.parse` or any DB lookup runs. Missing or forged signatures return `401` with zero DB writes; signed malformed JSON or missing fields return `400` with zero DB writes.
- Failure cases covered: missing fields (`400`), unknown plan (`400`), invalid payment method for customer (`400`), unknown customer (`404`), `Idempotency-Key` reused with different parameters (`409`), unknown subscription ID (`404`), double cancel (`409`), canceling a `past_due` subscription (`409`), billing a `canceled` subscription (`409`), provider throwing an unexpected error (`502` without leaving a dangling `pending` invoice), bad webhook signature (`401`), and malformed webhook payload (`400`).

## Database Validation Approach
- **Entities checked:** `subscriptions`, `invoices`, `webhook_events`, and `audit_log` via `InMemoryRepository`.
- **Invariants asserted (`tests/support/assertions.ts`):**
  - `expectApiMatchesDb` confirms `GET /subscriptions/:id` matches the persisted row (`status`, `plan`, `customer_id`, `payment_method_id`, `trial_ends_at`, `retry_count`, `created_at`, `updated_at`) after every step.
  - `expectNeverActiveWithoutPaidInvoice` checks that no subscription is ever `active` without at least one `paid` invoice on record.
  - `expectNoDuplicateInvoices` verifies invoice IDs and `idempotency_ref` values are unique and match exact expected counts.
  - `expectAuditTrail` verifies the exact `from_status -> to_status` sequence and monotonic timestamps.
- Rather than only checking DB state right after creation, `tests/specs/persistence.spec.ts` and `tests/specs/e2e.spec.ts` assert DB parity across `trialing`, `past_due`, `active`, and `canceled`.

## Mock Payment Provider & Webhook Validation
- `MockPaymentProvider` wraps `vi.fn()` (`chargeSpy`), lets tests configure `respondWithSuccess()`, `respondWithDecline()`, `respondWithTimeout()`, `respondWithError()`, or `queueOutcomes(...)`, and records every call's arguments. `expectProviderCalledWith` checks the actual `customerId`, `amount`, `paymentMethodId`, and `idempotencyRef` passed in. `tests/specs/provider.spec.ts` also verifies the provider isn't called on rejected creations, cancellations, canceled subscriptions, or replayed webhooks.
- Webhook idempotency is proven in `tests/specs/idempotency.spec.ts` by sending the same signed `event_id` twice for `payment.succeeded`, `payment.failed`, and `payment.refunded`. The first returns `200 { status: "processed" }` and the second returns `200 { status: "duplicate" }`. Both are logged in `webhook_events` (`['processed', 'duplicate']`), while invoice count, `retry_count`, `audit_log`, and provider call count stay untouched. `payment.refunded` is also guarded so it's ignored if the invoice wasn't `paid`.
- Out-of-order delivery is tested in `tests/specs/stateMachine.spec.ts`: if a `payment.failed` webhook arrives after an invoice is already `paid` (either via an earlier `payment.succeeded` webhook or via `billSubscription`), it's marked `ignored` and never regresses `active` to `past_due`.

## State-Machine / Lifecycle Coverage
- **Valid transitions tested:** All 7 transitions in `ALLOWED_TRANSITIONS` (`src/stateMachine.ts`) are tested with `it.each` in `tests/specs/stateMachine.spec.ts`, both at the unit level and through real API/billing flows (starting states are reached via real API calls, not seeded directly in the DB):
  - `trialing -> active` (`TRIAL_SUCCEEDED`)
  - `trialing -> past_due` (`TRIAL_FAILED`)
  - `active -> past_due` (`RECURRING_FAILED`)
  - `past_due -> active` (`RETRY_SUCCEEDED`)
  - `past_due -> canceled` (`RETRIES_EXHAUSTED`)
  - `active -> canceled` (`CANCEL`)
  - `trialing -> canceled` (`CANCEL`)
- **Invalid transitions proven impossible:**
  - `SubscriptionStateMachine.transition` throws `InvalidTransitionError` for `canceled + TRIAL_SUCCEEDED`, `canceled + RETRY_SUCCEEDED`, `canceled + CANCEL`, `past_due + CANCEL`, and `active + RETRIES_EXHAUSTED`.
  - Via HTTP/webhooks: stray `payment.succeeded` on a `canceled` subscription is `ignored`, double cancel returns `409`, `POST /subscriptions/:id/cancel` on `past_due` returns `409`, and stale `payment.failed` on a paid invoice is `ignored`.
- This gives confidence that neither API endpoints nor out-of-order webhooks can push a subscription into an illegal state.

## Test Architecture
I separated the suite into a support layer (`tests/support/`) and scenario specs (`tests/specs/`):
- `TestContext` wires a clean repo, mock provider, Express app, and `ApiClient` per test.
- `ApiClient` handles Supertest HTTP details.
- `MockPaymentProvider` stands in for the external gateway.
- `builders/` (`CustomerBuilder`, `SubscriptionBuilder`, `WebhookBuilder`) construct readable test data and signed/forged/malformed webhooks.
- `assertions.ts` holds reusable API–DB parity and invariant checks.
- `specs/` (`api`, `stateMachine`, `idempotency`, `provider`, `persistence`, `e2e`) stay focused on behavior and intent, which makes adding new scenarios straightforward without duplicating setup or transport code.

## Validation
Run inside `submission/harshwardhan-kapure/`:
- `npm run build` (`tsc --noEmit`) — passed with 0 errors
- `npm test` (`vitest run`) — all 6 spec files (47 tests) passed

## Known Limitations / Next Steps
- **In-memory store:** Doesn't test real SQL transactions, unique-index constraints, or connection drops. Swapping `InMemoryRepository` for a SQLite or Postgres `SubscriptionRepository` would be the next step.
- **Concurrency:** Racing/parallel webhooks for the same `event_id` or `subscription_id` aren't covered and would need DB-level locking or `INSERT ... ON CONFLICT DO NOTHING`.
- **Manual billing trigger:** `POST /subscriptions/:id/bill` replaces a background cron/scheduler so tests stay deterministic.
- **Mocked provider:** Verifies our integration against the `PaymentProvider` interface, not upstream third-party API changes.

## Responsible AI Usage
- **Did you use AI tools?** Yes, I used Antigravity to help generate the service fixture, test scaffolding, and documentation.
- **Where did they help?** Drafting `TEST_STRATEGY.md`, scaffolding the TypeScript Express fixture (`src/`), typed test helpers/builders (`tests/support/`), and the Vitest specs (`tests/specs/`), as well as extracting `BillingService` during refactoring.
- **What did you personally verify or correct?**
  - Checked that `SubscriptionStateMachine` enforces only the exact 7 transitions from the assignment and that no route mutates `status` outside it.
  - Checked that webhook HMAC verification runs on raw bytes before JSON parsing and rejects unsigned/forged payloads with `401` before touching persistence.
  - Reviewed failure/partial-failure paths—adding `Idempotency-Key` support on `POST /subscriptions`, `try/catch` cleanup on thrown provider errors so invoices don't get stuck in `pending`, `payment.refunded` paid-invoice checks, and real lifecycle setup instead of direct DB state seeding in `stateMachine.spec.ts`.
  - Ran `npm run build` and `npm test` to verify all 47 tests pass.

## Author Checklist
- [ ] Linting passes *(no linter script configured; `test` and `build` scripts provided)*
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes (`npm test` — 6 files, 47 tests)
- [ ] Schema/setup validation passes *(not applicable; in-memory TypeScript repository)*
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [x] README was tested from a clean setup
