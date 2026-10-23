# Subscription & Billing Test Strategy

## Scope and SUT
Hybrid option: a real local Node HTTP server, real request parsing/signature validation, an in-memory repository, and an injected fake payment gateway. No production service was supplied. Tests exercise HTTP -> domain service -> repository and inspect gateway calls. The service is intentionally a **fixture**, not production billing software.

## API contracts
- `POST /subscriptions` accepts customer_id, plan, payment_method_id and returns 201 subscription; bad inputs 422.
- `GET /subscriptions/:id` returns 200 or 404.
- `POST /subscriptions/:id/cancel` returns 200 or 409 for invalid transition.
- `POST /webhooks/payment-provider` requires SHA-256 HMAC of **raw request bytes** in X-Provider-Signature. Invalid signature 401; malformed signed JSON/schema 400; mismatched invoice references 422.
- **Fixture-only controls**: `POST /subscriptions/:id/bill` and `/retry-exhausted` simulate billing scheduler/retry exhaustion. They are not part of the production API contract.

## Business assumptions
- basic = $19 / 7-day trial; pro = $49 / 14-day trial; both start trialing. Trial expiry is simulated by fixture billing control, not a clock-driven job.
- Known customers are seeded logically as cust_001/cust_002; payment methods start with pm_test_.
- Each billing attempt creates a pending invoice; success -> paid, decline -> failed, timeout -> pending/unknown. No automatic retry after timeout (avoid double charge).
- A later success for a failed invoice can reconcile it; a failure for a paid invoice is stale and ignored.
- A refund marks an invoice refunded but leaves subscription lifecycle unchanged because no refund transition is specified. In production this needs a documented policy.
- Cancellation is terminal. Replayed events are recorded as delivery attempts but do not reapply business changes.

## Test levels
API contract (status/payload/validation), state machine, integration (HTTP -> repository), provider interaction (count/args), webhook security and idempotency, persistence and audit. Out of scope: real payment gateway, real DB crash recovery, proration, taxes, scheduled jobs, distributed concurrency.

## Design patterns
- **Explicit transition table** (`src/domain.ts`): only listed transitions can be executed.
- **Builder** (`src/builders.ts`): expressive subscription and webhook test data.
- **Dependency injection / Strategy seam** (`src/provider.ts`, `src/service.ts`): `SubscriptionBillingService` accepts `PaymentGateway`, replaced with `FakePaymentGateway` recording charge calls and configurable outcomes.
- **Repository** (`src/repository.ts`): isolates persistence and allows assertions without SQL in test scenarios.
- **Typed API Client** (`src/client.ts`): `BillingApiClient` hides HTTP details from tests.

## Persistence checks and invariants
- `subscriptions`: plan/status/trial date match API response at creation and transitions.
- `invoices`: status, amount, references match the billing attempt and provider calls; paid means a successful charge or webhook.
- `webhookEvents`: unique by event_id; duplicates do not create new canonical records.
- `webhookDeliveries`: every authenticated accepted duplicate is logged with disposition duplicate.
- `audit`: creation and each applied transition recorded once.
- Terminal cancellation, no stale failure regression, no duplicate invoice or charge for replay, and provider at most once per fixture billing call.
- Each test starts a fresh server, repository and fake provider; there is no stale cross-test data.

## Red / Blue / Green
Start with a failing invariant test (e.g. duplicate webhook must not double-activate). Implement minimal event ID deduplication and transition enforcement. Refactor into StateMachine, Repository and Builder without changing observable behavior. The repository contains final green tests; individual intermediate commits are not required.

## Known limitations / next steps
- In-memory persistence is queryable but not durable across restarts; production tests should run against real transactional DB, test rollback/restart, uniqueness constraints and migrations.
- HTTP processing is synchronous; no queue/retry scheduler, transaction boundaries or parallel webhook race protection. A real implementation needs atomic event insert + state mutation and invoice-level ordering/version checks.
- Fixture's permissive failed -> paid reconciliation needs provider-specific semantics and event timestamps/sequence in production.
- No authentication, observability or external payment service; fake is injected and records calls. Webhook secret is for local tests only.
- No immediate-charge plan variant or plan-change API is modeled; would be added once the product contract specifies their rules.
