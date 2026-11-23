# Subscription Billing SDET Assessment

This repository contains a minimal in-memory subscription/billing service and an object-oriented Vitest/Supertest suite.

## Run

```powershell
npm install
npm run lint
npm test
npm run build
```

## Scope and assumptions

The fixture implements the documented HTTP API and lifecycle while isolating an external payment provider behind an interface. It uses real Express/Supertest HTTP behavior, an in-memory repository, a configurable fake payment provider, and HMAC SHA-256 webhook signatures.

Valid fixture customers are `cust_001` and `cust_002`. `basic` is 1000 USD and `pro` is 4900 USD. Both plans start in `trialing`; trial periods are plan configuration, while trial expiry is represented by explicit webhook triggers.

## Architecture

- `src/domain.ts`: domain types and plan configuration
- `src/stateMachine.ts`: explicit lifecycle transition table
- `src/builders.ts`: `SubscriptionBuilder` and `WebhookBuilder`
- `src/provider.ts`: payment-provider interface and recording fake
- `src/repository.ts`: repository-style in-memory persistence
- `src/service.ts`: HTTP fixture and business processing
- `src/apiClient.ts`: HTTP and signed-webhook transport seam
- `src/testFixture.ts`: isolated test fixture
- `tests/billing.test.ts`: API, lifecycle, persistence, webhook, and provider specifications

## Patterns

- **State/transition table:** makes cancellation terminal and illegal status mutations difficult.
- **Builder:** keeps test intent clear and centralizes payload construction.
- **Strategy/adapter seam:** `PaymentProvider` allows fake outcomes and call verification.
- **Fixture/factory:** `TestFixture` composes app, provider, repository, and API client per test.
- **Repository:** tests verify state through repositories instead of raw persistence access.

## Persistence and invariants

The repository stores subscriptions, invoices, processed webhook IDs, and audit records. Tests verify API/status agreement, successful and failed invoice state, duplicate event no-op behavior, terminal cancellation, stale deliveries, and provider call arguments. Every test starts with fresh state.

## Known limitations

- Persistence is process-local.
- Trial expiry and scheduled retries are represented by explicit triggers, not a scheduler.
- Refund behavior is recorded but does not model payout.
- Concurrent webhook processing is a bonus extension not implemented here.
