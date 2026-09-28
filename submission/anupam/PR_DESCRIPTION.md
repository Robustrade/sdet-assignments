## Summary
Hybrid solution: a minimal TypeScript/Express service fixture for subscription billing, and an
object-oriented test framework on top of it. The framework has an isolated environment factory,
a typed API client, a strict mock payment provider, a signed-webhook simulator, builders, a
consistency verifier, and a global invariant checker. There are 99 tests across unit, API,
workflow, integration, persistence and E2E levels.

## Test Strategy
- **Levels covered:** unit (state table, plan strategies), API contract/validation, webhook
  endpoint security, state-machine workflow, persistence/audit, provider interaction,
  idempotency, one E2E journey.
- **In scope:** lifecycle correctness, webhook signature/shape/idempotency/ordering,
  decline/timeout handling, persisted-state correctness at every stage.
- **Out of scope:** proration, taxes, multi-currency, real scheduler, real DB, performance, concurrency (documented as next step).
- **Real vs mocked:** HTTP, services, state machine, repositories, DB and HMAC verification are
  real. The payment provider is mocked (it is external and costs money). Webhooks are sent by a
  simulator that signs independently of production code. The clock is fake so trials and
  renewals are deterministic. The scheduler is replaced by `env.runBilling()`.

## OOP & Design Pattern Choices
- **State machine (transition table)**, in `src/domain/SubscriptionStateMachine.ts`. It is the
  single source of legal moves. `LifecycleManager` is the only caller that persists a status, and
  `SubscriptionRepository.update()` cannot accept `status` at the type level. That makes an
  illegal transition structurally hard to write.
- **Strategy**, in `src/domain/plans.ts` (`BasicPlan`, `ProPlan`, `PlanCatalog`). Price, trial,
  retry budget and period are plan behaviour, so there is no plan branching in billing.
  Adding a plan means adding a class.
- **Port/Adapter seam + DI**, in `src/ports/PaymentProvider.ts` and `src/app/container.ts`. Tests
  inject `MockPaymentProvider`; production would inject an HTTP adapter. `Clock` and `Notifier`
  use the same approach.
- **Builder**, in `test/support/builders/*`. Scenarios read as intent, e.g.
  `paymentFailed().forLatestInvoiceOf(sub).withFailureReason('expired_card')`.
- **Repository**, in `src/persistence/repositories.ts`. The service and the verification layer
  share it; rows are cloned on read and write to avoid aliasing false positives.
- **Factory + Facade**, in `test/support/TestEnvironment.ts`. One call builds an isolated,
  fully wired world and exposes `api / webhooks / provider / verify / invariants / given`.

## API Validation Approach
- Every response is checked for status code and full payload shape (`toEqual` with matchers).
  Every rejection is also checked for **no persistence and no provider call**.
- Webhook transport concerns (forged, missing or tampered signatures; malformed JSON; bad field
  types) are in `webhook-endpoint.api.spec.ts`. They are kept separate from webhook business logic.

## Database Validation Approach
- Entities checked: subscriptions, invoices, payments, webhook_events and audit_log.
- `ConsistencyVerifier.expectSubscriptionIn()` asserts API = DB = expected after every step.
- `InvariantChecker` (I1–I13) runs after every test. It includes: `active` ⇒ a succeeded payment;
  no double-paid invoice; the audit trail is a legal path ending at the current status.
- `persistence.spec.ts` walks trialing → past_due → active → canceled and checks rows at each stage.

## Mock Payment Provider & Webhook Validation
- The mock records deep copies of every `ChargeRequest`. Tests assert the exact amount, customer,
  payment method, invoice and idempotency key (`inv_X:attempt-N`). The mock is strict: an
  unscripted charge fails, and unused scripted outcomes fail the teardown.
- Idempotency is proven by: the same `event_id` delivered 2–5× (one transition, one payment row,
  `deliveryCount` = N, one notification, zero provider calls), and by cross-channel duplicates
  (sync success plus a success webhook; sync decline plus a failed webhook).
- Out-of-order delivery is proven by: a failure arriving after a success on the same invoice
  being ignored, and a late success for an already-retried invoice being ignored.

## State-Machine / Lifecycle Coverage
- All 7 diagram transitions are exercised through real triggers. A coverage tracker in
  `lifecycle.spec.ts` fails the file if any transition is never observed in the audit log.
- Invalid cases proven impossible: canceled → active (stray success), canceled → past_due,
  past_due → canceled via the API, regression of active after a stale failure, charging before
  the trial ends, and billing after cancellation.
- Unit tests check every (state, event) pair. They assert the production table equals the
  hand-written spec table.

## Test Architecture
Specs contain only intent. Transport is in `SubscriptionApiClient` and `WebhookSimulator`;
setup is in `TestEnvironment` and `ScenarioDriver`; data is in builders; verification is in
`ConsistencyVerifier` and `InvariantChecker`. A new scenario is usually 5–10 lines.

## Validation
- `npm run lint`, `npm run build`, `npm test` all pass (99 tests).
- Manual mutation testing: I removed the duplicate-event check (4 failures), allowed
  canceled → active (4 failures), and allowed re-charging while pending (1 failure).

## Known Limitations / Next Steps
See `docs/INTERVIEW_PREP.md`. Items include: concurrent webhook tests, SQLite with transactions,
schema validation (zod), property-based state-machine tests, and a real HTTP provider adapter
tested with nock.

## Responsible AI Usage
- **Did you use AI tools?** Yes. I used Claude (Anthropic) extensively: it generated
  most of the service fixture, the test framework, the specs and the documentation.
- **Where did they help?** Scaffolding the TypeScript/Jest project, implementing the
  state machine, billing and webhook logic, writing the test support classes and specs,
  and drafting the README and this PR description.
- **What did I personally verify or correct?**
  - Ran `npm install` and `npm run validate` locally (lint, type check, 99 tests pass).
  - Read through the design decisions (timeout → pending, webhook dedupe rules,
    past_due cancel rejected) and confirmed I agree with them.
  - [add anything else you actually changed or checked]

## Author Checklist
- [x] Linting passes
- [x] Type check passes (`npm run build`)
- [x] Test suite passes
- [x] Schema/setup validation passes (no external setup required)
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [ ] README was tested from a clean setup  <!-- do: rm -rf node_modules && npm install && npm test -->
