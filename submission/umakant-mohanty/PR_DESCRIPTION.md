## Summary
Implemented a TypeScript/Node.js hybrid SDET solution for the Subscription & Billing Service. The submission includes a lightweight executable service fixture, in-memory persistence, an injected mock payment provider, a state-machine implementation, builders, and layered automated tests.

## Test Strategy
- Levels covered: API contract/validation, lifecycle/state-machine, persistence, mocked provider interaction, webhook processing, end-to-end service flow.
- In scope: subscription create/retrieve/cancel, plan-specific behavior, payment success/failure/timeout, webhook signature validation, malformed payloads, idempotency, stale/out-of-order delivery, persistence/audit checks, provider call arguments/count.
- Out of scope: real payment provider integration, UI, performance/load testing, production observability, full tax/multi-currency/proration engine.
- What is real vs stubbed/mocked, and why: service behavior, HTTP endpoint, state machine, and in-memory repository are executable fixture code; the payment provider is explicitly mocked behind an interface because the assignment requires an external integration seam.

## OOP & Design Pattern Choices
- State machine: `src/domain/stateMachine.ts` — central transition table makes illegal transitions structurally difficult and provides one source of truth.
- Builder: `src/builders/testDataBuilders.ts` — reusable intent-focused creation of subscription and webhook data.
- Strategy/Dependency Injection: `PaymentProvider` interface plus `MockPaymentProvider` — clean provider seam with configurable outcomes and interaction recording.
- Repository: `src/infrastructure/repository.ts` — test/service code reads persisted entities through an abstraction instead of inline storage operations.
- Payment provider seam: `SubscriptionService` receives `PaymentProvider` in its constructor; tests inject `MockPaymentProvider`.

## API Validation Approach
- Requests are sent through a real local HTTP server using Node `fetch`.
- Tests validate HTTP status, response payloads, validation failures, creation/retrieval/cancellation, and absence of provider calls for invalid requests.
- Webhook handling is tested separately for missing/forged signature, malformed JSON, and malformed required fields before exercising business state changes.

## Database Validation Approach
- Entities checked: subscriptions, invoices/payments, webhook events, audit events.
- Invariants: subscription status agrees with persisted successful/failed payment, event IDs are idempotent, duplicate delivery does not duplicate invoices, canceled subscriptions do not reactivate, audit records reflect transitions, and stale invoice failures do not overwrite a prior success.
- Data isolation: `TestContext.reset()` clears all persistence and reseeds customers/plans before each scenario.

## Mock Payment Provider & Webhook Validation
- Provider calls are recorded with customer, payment method, amount, currency, and reference. Tests assert exact arguments and call count.
- Duplicate `event_id` is delivered twice and verified to cause exactly one processing path and one invoice.
- Out-of-order delivery is modeled as a `payment.failed` event arriving after a successful event for the same invoice; the stale event is ignored and the subscription remains active.

## State-Machine / Lifecycle Coverage
- Valid transitions tested: all seven transitions required by the assignment.
- Invalid transitions proven impossible: `canceled -> active` and `active -> retry success` are rejected by the state machine.
- Additional invalid behavior: cancellation is irreversible and payment success after cancellation produces no invoice side effect.

## Test Architecture
`tests/` contains behavior-oriented specifications; `TestContext` owns isolation; the HTTP server is a transport seam; `SubscriptionService` owns workflow behavior; `Repository` owns persistence access; `MockPaymentProvider` owns external dependency behavior; builders keep scenario setup readable. This structure lets a real DB or real HTTP provider adapter be substituted without rewriting the scenarios.

## Validation
```bash
npm run build
npm test
```

## Known Limitations / Next Steps
- A production implementation should use a transactional DB with uniqueness constraints and atomic event processing for concurrent webhook delivery.
- A real implementation would expose or schedule retry exhaustion rather than invoking that transition directly in a unit/state test.
- Schema validation could be added with JSON Schema/Ajv if the external API contract were supplied.

## Responsible AI Usage
- AI tools were used to accelerate scaffolding, test-case enumeration, and documentation drafting.
- The final design, assumptions, assertions, and implementation choices were reviewed against the assignment requirements; generated code was corrected where business semantics required stronger idempotency/stale-event handling.

## Author Checklist
- [x] Linting/checks represented in buildable TypeScript
- [x] Type check / build command documented
- [x] Test suite command documented
- [x] Persistence setup/seed is documented
- [x] Every listed lifecycle transition is exercised
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency tested
- [x] README contains clean setup/run instructions
