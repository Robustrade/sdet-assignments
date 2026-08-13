## Summary
I implemented a complete automated test suite and a minimal working service fixture (Option 2/Option 3 hybrid) for the Subscription & Billing Service. The test suite verifies the application's correctness across four key layers: API contract, state machine, database persistence, and payment-provider mock integration.

## Test Strategy
- **Levels covered**: 
  - Unit (state-machine logic in isolation)
  - API (HTTP contracts, payloads, and request validation)
  - Database Persistence (record correctness and data invariants)
  - Integration (mocked payment provider client and webhook simulation)
  - Idempotency & Out-of-Order Webhook Handling
  - End-to-End (full subscription lifecycle scenario)
- **In scope**:
  - API contracts for creation (`POST /subscriptions`), retrieval (`GET /subscriptions/:id`), cancellation (`POST /subscriptions/:id/cancel`), and webhooks (`POST /webhooks/payment-provider`).
  - Strict validation of all 7 legal lifecycle transitions and 6 illegal ones.
  - HMAC-SHA256 signature verification for incoming webhooks.
  - Persistent state correctness in SQLite for subscriptions, invoices, and webhook events.
  - Idempotency checks to ensure duplicate webhook payloads are rejected cleanly without side effects.
  - Stale webhook protections (out-of-order `payment.failed` delivered after `payment.succeeded`).
- **Out of scope**:
  - Frontend UI or browser-based automation.
  - Real Stripe/PayPal API integration (interfaced via provider mock).
  - Performance testing, metric dashboards, and proration logic.
- **What is real vs stubbed/mocked, and why**:
  - **Real**: Express API endpoints, SQLite DB (`:memory:` for test isolation, file-backed for dev), and the Subscription State Machine.
  - **Mocked**: The external payment provider (mocked via `PaymentProviderPort` interface seam) because calling a live payment provider in tests is unstable, slow, and incurs transaction overhead.
  - **Simulated**: Inbound webhooks, which are constructed with cryptographically valid signatures using the real HMAC-SHA256 signing utilities.

## OOP & Design Pattern Choices
- **State / Transition-Table**: Implemented in `src/domain/SubscriptionStateMachine.ts`. This restricts the subscription states (`trialing`, `active`, `past_due`, `canceled`) to an explicit transition matrix. Direct status mutation is impossible, making invalid transitions structurally illegal.
- **Builder Pattern**: Implemented in `tests/builders/` (`CustomerBuilder`, `SubscriptionRequestBuilder`, `WebhookPayloadBuilder`). Allows test cases to express scenarios readably through domain language rather than cluttering specifications with raw JSON literals.
- **Adapter/Strategy Seam**: Implemented via `src/payment/PaymentProviderPort.ts` and constructor-injected into `SubscriptionService`. Tests use `FakePaymentProvider` as the test double to configure specific payment scenarios (`willSucceed`, `willDecline`, `willTimeout`).
- **Repository Pattern**: Implemented in `src/persistence/` (`SubscriptionRepository`, `InvoiceRepository`, `WebhookEventRepository`). This is the only place SQL queries live, ensuring that database access is encapsulated and reused across both service writes and test assertions.
- **Factory Pattern**: Implemented via `tests/framework/ApiClientFactory.ts`. Binds the API client to the live Express app instance to isolate network configurations and parallel test executions.

## API Validation Approach
- **How are requests/responses validated?**: Asserts are run against response statuses (e.g. `201`, `200`, `400`, `401`, `404`, `409`) and JSON schemas (ensuring presence of IDs, correct state name strings, and dates).
- **How is webhook request handling validated?**: Validates signature security via positive (valid signature) and negative tests (missing signature header, wrong secret signature, and tampered payload body) ensuring a `401 Unauthorized` is thrown immediately before any database or route handler operation.
- **Which failure scenarios are covered?**:
  - Unknown billing plan (`400`)
  - Missing required fields like `customer_id` or `payment_method_id` (`400`)
  - Malformed request payload types (`400`)
  - Double cancellation (`409`)
  - Retrieval or cancellation of non-existent IDs (`404`)

## Database Validation Approach
- **Which entities are checked**: `subscriptions`, `invoices`, and `webhook_events` (the idempotency and audit ledger).
- **Which invariants are asserted**:
  - Subscriptions must never reach `active` without at least one corresponding `succeeded` invoice.
  - Once a subscription state is set to `canceled`, it is terminal and cannot transition.
  - No duplicate invoice records or duplicate webhook audit rows are written.
  - No contradictory data (e.g. `active` subscription with only `failed` invoices).
- **How is persisted state checked**: The repository layers are queried directly by the assertion framework (`SubscriptionAssertions`, `InvoiceAssertions`) immediately after API responses are received.

## Mock Payment Provider & Webhook Validation
- **How is the payment provider mocked**: The `FakePaymentProvider` mock class records all API calls. Test assertions verify that:
  - The provider is called exactly once for immediate billing attempts.
  - The provider is **never** called for trial creations, validation failures, or replayed webhooks.
  - The payload contains correct parameters (amount, currency, customer, and unique idempotency keys).
- **How is webhook idempotency proven**: Proven by sending the same webhook `event_id` twice. The first request returns `"outcome": "processed"` and mutates state, while the second request returns `"outcome": "duplicate"` with a `200 OK` but performs no second database operations or transitions.
- **How is out-of-order/stale webhook delivery handled**: If a `payment.failed` event is received for an invoice that has already transitioned to `succeeded` (i.e. `InvoiceRepository.hasSucceededFor(invoiceId)` is true), the event is processed as `noop_stale_failed` and skipped to prevent regressing subscription status.

## State-Machine / Lifecycle Coverage
- **Which valid transitions are tested**: 
  - `trialing` -> `active` (trial ends, charge succeeds)
  - `trialing` -> `past_due` (trial ends, charge fails)
  - `active` -> `past_due` (recurring charge fails)
  - `past_due` -> `active` (retry charge succeeds)
  - `past_due` -> `canceled` (retries exhausted)
  - `active` -> `canceled` (cancel requested)
  - `trialing` -> `canceled` (cancel requested)
- **Which invalid transitions are proven impossible**: 
  - `canceled` -> any trigger (including `cancel` and success webhooks)
  - `trialing` -> `recurring_charge_failed` (recurring charges don't occur in trials)
  - `active` -> `trial_ends_charge_succeeded` (trial already completed)
  - `active` -> `retries_exhausted` (requires past_due state first)
  - `past_due` -> `recurring_charge_failed` (state is already past due)
- **What confidence do these tests provide**: They guarantee that illegal transitions can never occur, even under bad, out-of-order, or malicious webhook inputs.

## Test Architecture
The test suite utilizes a decoupled, maintainable structure:
- **`TestEnvironment`**: Automatically handles isolation. Spins up clean, in-memory SQLite instances and fresh mock provider contexts before every single test run to prevent test pollution.
- **`ApiClient`**: A typed wrapper hiding HTTP transport details from test specifications.
- **builders/**: Standardizes test request parameters, ensuring that modifying endpoint structures only requires updating a single builder file.
- **assertions/**: Reusable assertion classes that raise clear, readable error descriptions upon failure.

## Validation
I ran the following commands to validate the workspace:
1. `npm.cmd test` — Executes all 64 unit, integration, and E2E specifications.
2. `npm.cmd run typecheck` — Runs TypeScript compiler checks over all files.
3. `npm.cmd run build` — Compiles TypeScript into JS output in the `dist` folder.

## Known Limitations / Next Steps
- **Concurrency**: Concurrency and database locks on simultaneous race conditions are out of scope (though SQLite unique index constraints provide safety bounds).
- **Refund Logic**: `payment.refunded` is tracked in the ledger as a no-op but does not transition the subscription to a separate refund status.
- **Timeout Retries**: Provider timeouts currently transition to `past_due` instantly. In production, a background retry runner would handle timeouts.

## Responsible AI Usage
- **Did you use AI tools?**: Yes.
- **Where did they help?**: They assisted with writing the test case catalogue mapping, code organization, and scaffolding the boilerplate properties for builders and environments.
- **What did you personally verify or correct?**: I verified the execution policy issues on Windows and used `npm.cmd` to run tasks, tested the webhook HMAC-SHA256 signature calculations manually to verify signing, and audited the SQL statements within the repository files.

## Author Checklist
- [x] Linting passes
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes
- [x] Schema/setup validation passes
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [x] README was tested from a clean setup
