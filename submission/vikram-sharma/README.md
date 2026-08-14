# Subscription & Billing — Test Suite (Submission)

This README documents the test strategy, architecture, and how to run the automated validation suite included with this submission.

## Purpose and scope

- Goal: provide a maintainable, object-oriented automated test solution that validates subscription lifecycle, persistence, and webhook/provider interactions for a Subscription & Billing service.
- Scope: lightweight in-memory service fixture + tests exercising API, state-machine invariants, persistence (in-memory SQLite), webhook idempotency, and a mocked payment provider. Not a production service.

## What is real vs mocked

- Real: an in-process HTTP test fixture built with Express, in-memory SQLite via better-sqlite3 for durable-but-ephemeral persistence during tests.
- Mocked/Stubs: external payment provider is represented by a `PaymentProvider` interface and a `FakePaymentProvider` used in tests. Webhook deliveries are simulated by constructing signed JSON payloads.

## How to run tests

From the repository root run:

```bash
cd submission/vikram-sharma
npm install
npm test
```

Tests are implemented using Jest and Supertest. They run quickly because the database is in-memory and the payment provider is a local fake.

## Design and patterns used

- State (transition table): `src/state-machine/SubscriptionStateMachine.ts` — centralizes allowed transitions so invalid transitions are structurally guarded and testable.
- Builder: `src/builders/SubscriptionBuilder.ts` and `src/builders/WebhookBuilder.ts` — create test fixtures with intentful APIs to keep tests readable.
- Repository: `src/repositories/*` — Repository pattern isolates persistence access (subscriptions, invoices, webhook events), making database assertions explicit and centralized.
- Dependency Injection / Strategy: `src/payment/PaymentProvider.ts` (interface) and `FakePaymentProvider` — allows tests to substitute and assert on provider behavior.

These patterns reduce duplication and make the test intentions explicit.

## Test coverage (high level)

- API contract tests: creation validation, unknown-plan, missing-fields (tests in `tests/api`).
- State-machine tests: verify allowed and forbidden transitions (tests in `tests/state-machine`).
- Webhook tests: idempotency, invalid signature handling, ignoring webhooks for canceled subs (tests in `tests/webhook`).
- Persistence assertions: repositories are used to verify `subscriptions`, `invoices`, and `webhook_events` rows are created/updated according to business rules (tests in `tests/repositories`).
- Provider interaction: `FakePaymentProvider` records charge calls so tests assert call count and arguments.

## Important invariants asserted by tests

- A subscription only becomes `active` after a successful, persisted payment record.
- Duplicate webhook delivery (same `event_id`) is idempotent: event is recorded once and does not create duplicate invoices or state changes.
- `canceled` subscriptions ignore subsequent webhooks and will not transition back to `active`.
- The provider client is called exactly once per real billing attempt and not for rejected creations or replayed webhooks.

## Key files

- Router / fixture: `src/api/subscription.routes.ts`
- Service (business logic): `src/services/SubscriptionService.ts`
- State machine: `src/state-machine/SubscriptionStateMachine.ts`
- Payment interface + fake: `src/payment/PaymentProvider.ts`
- Repositories: `src/repositories/*.ts`
- Builders: `src/builders/*.ts`
- Tests: `tests/**` — see subfolders for API, state-machine, webhook, repositories

## Assumptions & limitations

- Simplified pricing and trial logic (two plans: `basic` and `pro`).
- In-memory SQLite permits durable queries within a test run but is not persisted across runs.
- No concurrency stress tests for parallel webhooks (possible extension).
- The fixture focuses on demonstrating test architecture, patterns, and invariants rather than a full production feature set.

## How tests validate mocked provider and webhooks

- Outbound charges go through `PaymentProvider.charge()` (in production this would wrap a real SDK). Tests inject `FakePaymentProvider` which records calls and can be configured to return success/failure.
- Webhook payloads are built in tests and signed using HMAC with the test secret; the service validates signatures and records processed `event_id` values in `webhook_events` to guarantee idempotency.

## Notes on review and next steps

- This submission is intentionally compact and focuses on maintainability and clear OOP design rather than a large code surface.
- If you want, I can:
  - add a PR description file summarizing test strategy for reviewers,
  - add more negative test cases (timeouts, out-of-order delivery),
  - add concurrency tests for racing webhooks.

## Responsible AI usage

- I used code-assistance tools to accelerate boilerplate and tests; I reviewed and adjusted all logic, tests, and assertions manually to ensure correctness with the required invariants.

----

File: [submission/vikram-sharma/README.md](submission/vikram-sharma/README.md)
