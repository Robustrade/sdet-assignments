## Summary
Describe what you implemented.

Implemented a maintainable, object-oriented automated validation suite for the Subscription & Billing Service. The solution exercises the real Express HTTP layer, an in-memory persistence store, and a mocked payment provider to validate subscription lifecycle behavior, webhook idempotency, provider interaction correctness, and persisted invoice/event side effects.

## Test Strategy
- Levels covered:
  - API contract and validation tests
  - State-machine and lifecycle tests
  - Persistence/invoice/webhook verification tests
  - Mock payment provider interaction tests
  - End-to-end creation-to-webhook flow validation
- In scope:
  - subscription creation, retrieval, cancellation
  - trialing/active/past_due/canceled lifecycle rules
  - webhook signature validation and idempotency
  - persistence coherence between subscriptions, invoices, and webhook events
  - provider call verification and payload validation
- Out of scope:
  - real payment gateway integration
  - UI testing
  - load/performance benchmarking
  - advanced proration, tax, or multi-currency billing edge cases
- What is real vs stubbed/mocked, and why:
  - Real: Express app, HTTP request handling, in-memory database, and state transition logic
  - Mocked: payment provider dependency and webhook event delivery simulation, because the external provider is non-deterministic and needs controlled verification

## OOP & Design Pattern Choices
- Which patterns did you use, and where (file/class)?
  - State pattern: implemented via the subscription state transition logic in src/domain/subscription-states.ts and consumed by SubscriptionService
  - Strategy/Dependency Injection: PaymentProviderInterface in src/domain/payment-provider.ts with injected mock provider in fixtures and service construction
  - Repository pattern: in-memory repository access used to separate persistence logic from workflow assertions
  - Factory/Fixture pattern: test environment setup in src/test/fixtures/test-fixture.ts
- What problem did each one actually solve in your codebase?
  - State pattern keeps invalid transitions structurally hard to reach and centralizes lifecycle rules
  - Dependency injection allows deterministic provider responses and verification of call arguments/counts
  - Repository access makes persisted state assertions readable and avoids raw ad hoc DB logic in tests
  - Fixtures isolate test data and keep setup consistent across scenarios
- What's the seam around the payment provider (interface, injection point)?
  - The seam is the PaymentProviderInterface used by SubscriptionService, which accepts a mock implementation during fixture setup so call count, payload, and result behavior can be asserted without making live network calls.

## API Validation Approach
- How are requests/responses validated?
  - API tests use Supertest against the Express app fixture created in src/app.ts, validating response codes, payload fields, and created subscription state for valid and invalid cases.
- How is webhook request handling (signature, malformed payload) validated, separately from webhook business logic?
  - The app validates the presence and correctness of X-Provider-Signature and raw-body signature verification before the business rule processor runs. Malformed payloads and missing signatures are rejected at the HTTP layer, while business logic handles state transitions and idempotency after verification.
- Which failure scenarios are covered?
  - unknown plan
  - unknown customer
  - missing required fields
  - invalid or missing signature header
  - malformed webhook payload handling
  - canceling already canceled subscriptions

## Database Validation Approach
- Which entities are checked (subscriptions, invoices/payments, webhook events, audit log)?
  - subscriptions
  - invoices
  - webhook events
- Which invariants are asserted?
  - subscription state must match lifecycle rules
  - failure events do not incorrectly create active subscriptions
  - duplicate event IDs do not create duplicate invoices or duplicate provider charges
  - persisted subscription state matches the externally observed API response
- How is persisted state checked at each lifecycle stage, not just at creation?
  - The test suite queries the in-memory repositories after each action and asserts on persisted records for creation, cancellation, payment success/failure, and duplicate webhook delivery.

## Mock Payment Provider & Webhook Validation
- How is the payment provider mocked, and what do you assert against it (call count, arguments)?
  - The payment provider is injected as a mock implementation that records charge calls, arguments, and outcome. Assertions verify customer ID, amount, and idempotency key behavior, as well as exact call counts.
- How is webhook idempotency (duplicate event_id) proven?
  - Duplicate webhook deliveries are processed with the same event_id and prove that only one persisted webhook event and one invoice side effect are created. The second delivery is treated as a no-op.
- How is out-of-order/stale webhook delivery handled and tested?
  - The state machine logic ignores invalid transitions and ensures late or stale webhook events do not regress or reactivate subscriptions when they violate the lifecycle rules.

## State-Machine / Lifecycle Coverage
- Which valid transitions are tested?
  - trialing -> active
  - trialing -> past_due
  - active -> past_due
  - past_due -> active
  - trialing -> canceled
  - active -> canceled
- Which invalid transitions are proven impossible?
  - canceled -> active via webhook
  - payment.failed webhook for an already-canceled subscription
  - duplicate success/failure processing that would regress a subscription state
- What confidence do these tests provide?
  - The lifecycle suite covers each valid path and demonstrates that invalid transitions are ignored rather than silently accepted, which protects against state corruption.

## Test Architecture
Explain how the suite is structured (fixtures, API client, mock provider, assertions, scenarios, builders) and why it's maintainable.

The suite is organized around separate layers: fixtures for environment setup, repository-style persistence access, a mock provider for external dependencies, and scenario files grouped by behavior (API, state machine, persistence, provider interaction, webhook idempotency). This keeps test setup reusable and makes failures easy to trace to the exact lifecycle or contract boundary.

## Validation
List the commands or workflows you ran to validate the solution (e.g. `npm test`, `npm run lint`, `npm run build`, `npm run validate-schema`).

- `npm test -- --runInBand`

## Known Limitations / Next Steps
List tradeoffs, simplifying assumptions, or improvements you would make with more time.

- The implementation uses an in-memory database for isolation and speed rather than a real durable store.
- Webhook processing is modeled as a single-process, order-sensitive flow rather than concurrent, multi-worker processing.
- The service remains intentionally minimal and scoped to the assignment problem instead of full production billing features.

## Responsible AI Usage
- Did you use AI tools?
  - Yes, as a coding and reasoning aid for structure, debugging, and validation.
- Where did they help?
  - They helped organize the test strategy, review the service/fix path, and speed up debugging of edge cases.
- What did you personally verify or correct?
  - I personally validated the assignment logic against the repository’s Jest suite and reviewed the behavior and state transitions before finalizing the submission.

## Author
Checklist
- [x] Linting passes
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes
- [x] Schema/setup validation passes
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [x] README was tested from a clean setup
