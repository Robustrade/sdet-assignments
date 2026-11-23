## Summary
Implemented a TypeScript subscription/billing fixture and a focused Vitest/Supertest suite. The solution covers HTTP contracts, lifecycle invariants, persistence, signed webhooks, idempotency, and provider interactions.

## Test Strategy
- Levels covered: API, state machine, in-memory persistence, external provider seam, and end-to-end fixture flows.
- In scope: creation/retrieval/cancellation, validation, lifecycle transitions, webhook signatures and malformed payloads, duplicate/stale delivery, and provider call verification.
- Out of scope: real payment processing, taxes/proration, external database setup, scheduled jobs, UI, and performance.
- What is real vs stubbed/mocked: Express, Supertest, and repository behavior are real within the fixture; the payment provider is a recording fake for repeatable tests.

## OOP & Design Pattern Choices
- State/transition table: `src/stateMachine.ts`; prevents ad hoc status mutation and rejects illegal transitions.
- Builder: `src/builders.ts`; keeps scenario payload intent readable.
- Strategy/adapter seam: `PaymentProvider` in `src/provider.ts`, injected into `BillingService`.
- Fixture/factory and repository: `src/testFixture.ts` and `src/repository.ts`; isolate tests and centralize verification.

## API Validation Approach
- Supertest validates status codes and response bodies for create/get/cancel endpoints.
- The API client constructs valid HMAC signatures and supports forged/unsigned payload checks separately from business processing.
- Cases cover invalid plans, missing fields, unknown customers, malformed webhooks, and canceled/unknown subscriptions.

## Database Validation Approach
- Checked entities: subscriptions, invoices, webhook events, and audit records.
- Tests assert status/payment consistency, invoice outcome, duplicate event no-op, cancellation terminality, stale delivery, and audit history.
- Fresh fixture state and repository clearing prevent stale false positives.

## Mock Payment Provider & Webhook Validation
- The fake provider records calls and supports configurable success/decline/timeout outcomes.
- Tests assert call count and customer, payment method, amount, currency, invoice, and idempotency key.
- Duplicate `event_id` delivery returns duplicate and creates no additional invoice, webhook event, or lifecycle side effect.
- Stale failure for a succeeded invoice and every webhook after cancellation are ignored.

## State-Machine / Lifecycle Coverage
- Covered: trial success/failure, trial and active cancellation, active failure to past due, retry success, and retry exhaustion/cancellation.
- Invalid: canceled subscriptions cannot reactivate, duplicate events cannot transition twice, and stale failures cannot replace success.
- Confidence: tests combine external status with persisted state and audit history.

## Test Architecture
The suite is grouped around scenario intent rather than raw transport calls. Builders remove fixture noise, `ApiClient` encapsulates HTTP, `TestFixture` composes isolation, and the repository/provider expose assertions clearly. This supports additional plans, transitions, or provider outcomes without scattered setup.

## Validation
- `npm install`
- `npm run lint`
- `npm test`
- `npm run build`

## Known Limitations / Next Steps
- In-memory persistence is non-concurrent.
- Scheduled trial expiry and retry exhaustion could use real clocks/schedulers in a broader integration environment.
- Concurrent redelivered webhook delivery is left as a bonus extension.

## Responsible AI Usage
- AI tools helped implement fixture scaffolding, tests, and documentation.
- I reviewed lifecycle rules, provider verification, signature handling, persistence assertions, and test failures, and corrected implementation/test mismatches directly.

## Author Checklist
- [x] Linting passes
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes
- [ ] Schema/setup validation passes
- [ ] Every listed lifecycle transition is exercised by at least one test
- [ ] At least two invalid transitions are proven impossible
- [ ] Webhook idempotency (duplicate `event_id`) is tested
- [ ] README was tested from a clean setup
