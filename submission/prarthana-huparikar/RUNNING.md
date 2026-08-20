# Running this project

## Setup
```
npm install
```

## Run all tests
```
npm test
```

## Type-check only
```
npm run build
```

## What's covered (37 tests, 6 suites)
- `tests/stateMachine.test.ts` — every valid lifecycle transition + 3 proven-invalid transitions
- `tests/api.test.ts` — API contract and validation (creation, retrieval, cancellation, error paths)
- `tests/providerMock.test.ts` — payment provider mock call-count/argument assertions, decline & timeout behavior
- `tests/webhookIdempotency.test.ts` — signature validation, duplicate `event_id` handling, out-of-order delivery
- `tests/database.test.ts` — persistence invariants (no orphaned active state, no duplicate invoices, audit trail)
- `tests/e2e.test.ts` — full request/webhook → processing → persistence → provider flows

## Project structure
```
src/
  domain/         # types, State pattern (SubscriptionState.ts), PaymentProvider interface
  infra/          # MockPaymentProvider (Strategy/Adapter implementation)
  service/        # SubscriptionService (business logic) + Repository (persistence)
  api/            # Express app, webhook signature helper
  testing/builders/ # Builder pattern for test data (subscriptions, webhook payloads)
tests/            # the 6 suites listed above
```
