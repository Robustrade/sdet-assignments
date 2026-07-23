# Subscription & Billing Service — Reference Scaffold

A minimal TypeScript service fixture plus automated test suite demonstrating
the object-oriented structure and design patterns expected by
[`SDET_ASSIGNMENT.md`](../../SDET_ASSIGNMENT.md). This is a reference
scaffold, not a full solution — read it for structure and patterns, then
build out further coverage as your own submission requires.

## Running it

```bash
npm install
npm test              # full suite
npx jest tests/stateMachine.test.ts   # single file
npx jest -t "retries are exhausted"   # single test by name
npm run lint
npm run build          # tsc --noEmit
npm run validate-schema
```

## Structure

- `src/domain/` — `types.ts` (entities, plan config) and
  `subscriptionStateMachine.ts` (the transition table every lifecycle
  change must go through).
- `src/payments/PaymentProvider.ts` — the interface production code depends
  on for charging a customer; `ConsolePaymentProvider` is the default,
  no-op-ish implementation. Tests inject `tests/support/FakePaymentProvider.ts`
  instead.
- `src/persistence/Repository.ts` — Repository pattern over an in-memory
  store for subscriptions, invoices, and the audit log. All persistence
  access — production and test-verification alike — goes through this
  class, never raw queries.
- `src/service/SubscriptionService.ts` — the workflow layer: validation,
  state-machine transitions, persistence, and payment-provider calls in one
  orchestrated place. This is what `tests/stateMachine.test.ts` and
  `tests/webhookIdempotency.test.ts` are really exercising.
- `src/app.ts` — a thin Express factory (`createApp()`) wiring the above
  together; the payment provider is an injectable dependency, which is the
  seam tests use to substitute a mock.
- `tests/support/` — the test framework itself: `builders.ts` (Builder
  pattern for requests/webhooks), `FakePaymentProvider.ts` (the mock/test
  double), `SubscriptionApiClient.ts` (Adapter over `supertest`), and
  `testApp.ts` (wires a fresh app + mock provider + client per test).

## Design patterns in this scaffold

- **State pattern (as an explicit transition table)** — `subscriptionStateMachine.ts`.
  Both the cancel API and the webhook handler call `transition()`; neither
  assigns `.status` directly.
- **Builder** — `SubscriptionRequestBuilder` / `WebhookEventBuilder` in
  `tests/support/builders.ts`.
- **Adapter/Strategy seam for the external dependency** — `PaymentProvider`
  interface, mocked in tests by `FakePaymentProvider`.
- **Repository** — `src/persistence/Repository.ts`.
- **Factory** — `createApp()` in `src/app.ts` wires collaborators and
  returns the assembled app + handles.

## Simplifying assumption worth knowing

All billing outcomes — including the very first charge for a plan with a
trial — are modeled as arriving via the `/webhooks/payment-provider`
endpoint, **except** for no-trial plans, where the first charge is
synchronous at creation time (there's no trial period to wait out). This
keeps a single code path (`SubscriptionService.handleWebhookEvent`) owning
every post-trial and recurring transition, while still giving the mock
payment provider a real, testable synchronous call site at creation.
