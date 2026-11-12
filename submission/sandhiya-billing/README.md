# Subscription & Billing Service Automation Exercise

This project is a compact, object-oriented TypeScript service and validation suite for subscription billing. It exercises API behavior, lifecycle transitions, persisted effects, and the payment-provider seam without calling an external provider.

## Architecture

- `app/domain.ts`: domain models, plan metadata, lifecycle state machine, and test-data builders.
- `app/payment.ts`: injectable payment-provider doubles for recording calls, declines, and timeouts.
- `app/repository.ts`: SQLite persistence through Node's built-in `node:sqlite` module.
- `app/service.ts`: business logic, webhook signature validation, idempotency, and state transitions.
- `app/api.ts`: HTTP API for subscription creation, retrieval, cancellation, and signed webhooks.
- `app/index.ts`: runnable service entry point.
- `tests/billing-service.test.ts`: API, workflow, persistence, and provider-seam tests using Node's built-in test runner.

## Patterns used

- State machine: `SubscriptionStateMachine` centralizes allowed lifecycle transitions.
- Builders: `SubscriptionBuilder` and `WebhookPayloadBuilder` make test scenarios readable.
- Repository: persistence is isolated in `SubscriptionRepository`.
- Provider adapter seam: `BillingService` receives a provider implementation, replaced by test doubles.

## Requirements and usage

Node.js 22.6 or later is required for the built-in SQLite module and native TypeScript type stripping. Install development tools with `npm install`, then run `npm run typecheck` to check the TypeScript sources.

```powershell
npm test
npm start
```

By default, the service listens on port `3000` and stores data in `billing.db`. Configure `PORT`, `BILLING_DB_PATH`, and `PROVIDER_SIGNATURE_SECRET` through environment variables as needed. The default signature secret is for local development only.

Webhook signatures are lowercase or uppercase hexadecimal HMAC-SHA256 digests of the exact request body, using the configured signature secret.
