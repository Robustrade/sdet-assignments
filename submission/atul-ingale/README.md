
# Subscription and Billing Service

This project is a JavaScript/Playwright implementation of the Robustrade SDET
take-home assignment. JavaScript is used because the starter repository and its
existing automation are JavaScript-based; the code keeps the requested OO test
architecture and design patterns explicit.

## Setup and Commands

```bash
npm install
npm run test:api
npm run dev
```

Playwright starts the fixture automatically for `npm run test:api`.

## Scope and Assumptions

- Customers are seeded as `cust_001` by the test reset endpoint.
- Plans are in-memory: `basic` is USD 19.00 with a 14-day trial, and `pro` is
	USD 49.00 with a 7-day trial.
- Persistence is an in-memory repository, reset between scenarios.
- The payment provider is always a mock. It supports `success`, `decline`, and
	`timeout` outcomes through the test-only provider endpoint.
- No real payment network, frontend, authentication, taxes, or production
	database is included.

## API Contract

```text
POST /api/subscriptions
GET  /api/subscriptions/:id
POST /api/subscriptions/:id/cancel
PATCH /api/subscriptions/:id/plan
POST /api/subscriptions/:id/charge       # fixture-only billing trigger
POST /api/subscriptions/webhooks/payment-provider
```

Webhook requests use `X-Provider-Signature`, an HMAC-SHA256 signature over the
raw JSON body using `assignment-secret` by default.

## Test Architecture and Patterns

- `SubscriptionApiClient` is the API client layer, keeping transport details out
	of scenarios.
- `SubscriptionBuilder` and `WebhookBuilder` are test-data Builders.
- `SubscriptionService` uses an explicit transition table as the State pattern;
	invalid transitions fail with `409`.
- `MockPaymentProvider` is an injected Strategy/Adapter seam. Tests verify call
	count, arguments, declines, and timeouts.
- `BillingRepository` is a Repository for subscriptions, invoices, webhook
	events, and audit history.
- `BillingAssertions` is the verification layer for API-visible and persisted
	state.

## Required Coverage

The suite covers API validation, plan changes, every lifecycle transition including refunds,
invalid cancellation/reactivation, provider success/decline/timeout, signed and
malformed webhooks, duplicate event IDs, stale out-of-order events, invoice and
event persistence, audit history, and absence of duplicate provider calls.

The Red/Blue/Green workflow is represented by first specifying a behavior in a
scenario, implementing the smallest fixture support, and then extracting the
client/builders/assertions used by later scenarios.

## Validation

```bash
npm run test:api
```

The current suite contains nine end-to-end scenarios and validates the service
through HTTP rather than calling domain internals directly.
