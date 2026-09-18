# Pull Request: Subscription & Billing Service Test Automation Solution

## Summary
Implemented a full TypeScript test automation solution and domain fixture for the **Subscription & Billing Service** assignment. The solution provides a stateful subscription billing engine (Express + Node.js), an in-memory DAO persistence layer, an HMAC signature validator, and an object-oriented test harness with 42 passing tests across 6 test suites.

---

## Test Strategy
- **Levels covered**: API level (HTTP endpoints), State-Machine level (lifecycle transitions), Database / Persistence level (audit logs & deep cloning), External Integration level (mocked payment provider).
- **In scope**: Subscription creation/cancellation, trial conversions, recurring renewals, card failures & retry budgets, payment provider timeouts, HMAC signature validation, inbound webhook deduplication, out-of-order webhook delivery, and audit logging.
- **Out of scope**: Production database engine integration (e.g. Postgres / SQLite, abstract DAOs ready for swap), real payment gateway API calls.
- **What is real vs stubbed/mocked, and why**:
  - **Real**: State machine transitions, Express HTTP router, serialization, HMAC signature verification, repository data structures, and billing engine business logic.
  - **Stubbed/Mocked**: `PaymentProvider` (`FakePaymentProvider` records charge history and controls outcomes) and `Clock` (`TestClock` enables instant time-warping in tests without real-world delays).

---

## OOP & Design Pattern Choices
- **State Pattern** (`SubscriptionStateMachine` in `src/domain/subscription-state-machine.ts`): Enforces explicit lifecycle transitions via an immutable table. Eliminates arbitrary state mutations across codebase.
- **Strategy & Catalog Pattern** (`PlanPolicy`, `PlanCatalog` in `src/domain/plan-policy.ts`): Encapsulates plan-specific pricing, trial lengths, and retry limits behind an interface (`StandardPlanPolicy`).
- **Repository Pattern** (`SubscriptionRepository`, `InvoiceRepository`, etc. in `src/persistence/repositories.ts`): Isolates storage from business logic and enforces defensive copying (`structuredClone`).
- **Builder Pattern** (`CustomerBuilder`, `SubscriptionRequestBuilder`, `WebhookEventBuilder` in `tests/framework/builders/`): Simplifies fixture setup for test specs.
- **Test Double Seam**: `PaymentProvider` interface in `src/payments/payment-provider.ts` allows injecting `FakePaymentProvider` cleanly without altering core service code.

---

## API Validation Approach
- **Request / Response Validation**: HTTP controllers validate required fields (`customer_id`, `plan`, `payment_method_id`) and return standard error JSON payloads (`400 BAD_REQUEST`, `404 NOT_FOUND`, `409 CONFLICT`).
- **Webhook Handling**: Validates `X-Provider-Signature` using `HmacSignatureVerifier` with constant-time byte comparisons (`timingSafeEqual`). Unsigned or invalid signatures return `401`. Malformed payloads return `400`.

---

## Database Validation Approach
- **Entities Checked**: `CustomerRecord`, `SubscriptionRecord`, `InvoiceRecord`, `WebhookEventRecord`, `SubscriptionEventRecord`.
- **Invariants Asserted**: `InvariantChecker` verifies no negative balances, correct sequence ordering, no double-paid invoices, and exact record counts at every lifecycle stage.

---

## Mock Payment Provider & Webhook Validation
- **Mock Payment Provider**: `FakePaymentProvider` tracks charge call counts, idempotency keys, and requested amounts.
- **Webhook Idempotency**: Duplicate webhook `event_id` deliveries return `duplicate` status, increment redelivery counters, and trigger zero side effects.
- **Out-of-Order Webhooks**: Webhooks referencing settled or invalid states are logged as `ignored` without altering subscription state.

---

## State-Machine / Lifecycle Coverage
- **Valid Transitions Tested**:
  - `trialing` ➔ `active` (trial ends, payment succeeds)
  - `trialing` ➔ `past_due` (trial ends, payment fails)
  - `trialing` / `active` ➔ `canceled` (user cancels)
  - `active` ➔ `past_due` (recurring payment fails)
  - `past_due` ➔ `active` (retry payment succeeds)
  - `past_due` ➔ `canceled` (retry budget exhausted)
- **Invalid Transitions Proven Impossible**:
  - Transition from terminal state `canceled` ➔ `active` (rejected).
  - Cancellation from `past_due` (rejected per domain model rules).

---

## Test Architecture
Organized clearly into separate layers:
- `tests/framework/harness/`: Virtual clock and test environment setup (`TestEnvironment`).
- `tests/framework/clients/`: Strongly-typed API client wrappers (`SubscriptionApiClient`, `WebhookApiClient`).
- `tests/framework/doubles/`: Mock implementations (`FakePaymentProvider`, `RecordingNotifier`).
- `tests/framework/assertions/`: Invariant checker and custom assertions.
- `tests/specs/`: Spec files split cleanly by concern (`api-contract`, `end-to-end`, `lifecycle-state-machine`, `persistence`, `provider-interaction`, `webhook-idempotency`).

---

## Validation
Commands executed cleanly:
- `npm test`: Runs Vitest runner (42 passed across 6 test suites).

---

## Known Limitations / Next Steps
- Production storage currently uses in-memory `Map` instances (abstracted via Repositories so SQLite or Postgres can be swapped in seamlessly).
- Concurrent HTTP webhooks rely on Node single-threaded event loop check-then-insert; SQL unique index constraints would be added for multi-instance deployments.

---

## Responsible AI Usage
- **Did you use AI tools?**: Yes.
- **Where did they help?**: Scaffolding boilerplates, domain state diagram visualization, and markdown documentation.
- **What did you personally verify or correct?**: Verified all 42 Vitest specs, state machine edge conditions, HMAC timing safety checks, and defensive memory cloning.

---

## Author Checklist
- [x] Linting passes
- [x] Type check passes (`tsc --noEmit`)
- [x] Test suite passes (`npm test` — 42/42 passing)
- [x] Schema/setup validation passes
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [x] README was tested from a clean setup
