# Subscription Billing & Webhook Assignment

Hi,

This project is a small subscription billing API. I built it to handle the main subscription lifecycle, payment results, and payment provider webhooks.

I focused mainly on keeping the subscription state changes clear and safe, especially around duplicate and out-of-order webhook events.

## What this project does

The application supports:

- Creating a subscription
- Basic and Pro plans
- Initial payment processing
- Handling successful and failed payments
- Canceling a subscription
- Getting a subscription by ID
- Processing payment provider webhooks
- Webhook signature verification
- Duplicate webhook protection
- Out-of-order webhook protection
- Preventing canceled subscriptions from becoming active again
- Handling payment provider timeout
- Audit events for important webhook/state changes

## Subscription lifecycle

The subscription can have these states:

- `trialing`
- `active`
- `past_due`
- `canceled`

The main flow is:

```text
trialing
   |
   +-- first charge succeeds --> active
   |
   +-- first charge fails -----> past_due
   |
   +-- customer cancels -------> canceled

active
   |
   +-- recurring payment fails --> past_due
   |
   +-- customer cancels --------> canceled

past_due
   |
   +-- retry succeeds ----------> active
   |
   +-- retries exhausted -------> canceled

canceled
   |
   +-- no further lifecycle transition
```

I kept these transitions in a separate state machine so that invalid state changes are rejected instead of silently happening.

## Webhook handling

The webhook endpoint is:

`POST /webhooks/payment-provider`

The webhook supports:

- `payment.succeeded`
- `payment.failed`
- `payment.refunded`

### Webhook security

The provider sends an HMAC SHA-256 signature.

The application first verifies the signature using the **exact raw request body**.

The flow is:

```text
Request
  |
  v
Get raw body
  |
  v
Verify HMAC signature
  |
  +-- invalid --> 401
  |
  v
Validate payload with Zod
  |
  +-- invalid --> 400
  |
  v
Process webhook
```

This is important because changing the payload before signature verification could make the signature check incorrect.

## Duplicate webhook handling

Webhook events contain an `event_id`.

I store processed webhook IDs in the repository.

If the same event is received again:

```text
First request
    |
    +--> process event
    +--> save event_id

Second request with same event_id
    |
    +--> detect duplicate
    +--> do not process again
```

The API returns `duplicate: true` for the second request.

This helps prevent the same payment event from changing the subscription more than once.

## Out-of-order webhooks

Payment providers can send events out of order.

For example:

```text
payment.succeeded
        |
        v
     ACTIVE
        |
        | late payment.failed
        v
     ignored
```

If the same invoice has already been recorded as successful, a later failed webhook for that invoice is treated as stale.

The subscription stays `active`.

The stale webhook is still recorded as an audit event.

## Canceled subscription protection

A canceled subscription should not become active again just because a successful payment webhook arrives later.

For example:

```text
ACTIVE
  |
  | customer cancels
  v
CANCELED
  |
  | payment.succeeded
  v
409 Invalid subscription transition
```

This is handled by the state machine and the webhook processing logic.

## Payment provider

The project uses a `PaymentProvider` interface so that the billing service does not depend directly on a real payment provider.

For testing, I created a `FakePaymentProvider`.

It can simulate:

- Successful payment
- Declined payment
- Provider timeout

It also keeps the payment requests so the tests can verify that the provider was called correctly.

## API endpoints

### Create subscription

`POST /subscriptions`

Example request:

```json
{
  "customerId": "cus_001",
  "paymentMethodId": "pm_001",
  "plan": "basic"
}
```

Supported plans:

```text
basic
pro
```

### Get subscription

`GET /subscriptions/:id`

### Cancel subscription

`POST /subscriptions/:id/cancel`

### Payment provider webhook

`POST /webhooks/payment-provider`

The webhook requires the header:

`X-Provider-Signature`

## Validation and error handling

I used Zod for request validation.

Some important responses are:

| Situation | HTTP status |
|---|---:|
| Invalid subscription request | 400 |
| Invalid webhook payload | 400 |
| Missing webhook signature | 401 |
| Invalid webhook signature | 401 |
| Subscription not found | 404 |
| Invalid subscription transition | 409 |
| Payment provider timeout | 503 |
| Successful request | 200 / 201 |

## Project structure

```text
src/
├── domain/
│   ├── subscription.ts
│   └── types.ts
│
├── http/
│   └── app.ts
│
├── providers/
│   ├── fake-payment-provider.ts
│   └── payment-provider.ts
│
├── repositories/
│   └── in-memory.repository.ts
│
├── routes/
│   └── routes.ts
│
└── services/
    └── billing.service.ts

tests/
├── assertions/
│   └── subscription.assertions.ts
├── builders/
│   └── webhook.builder.ts
├── fixtures/
│   └── test-app.ts
├── support/
│   └── api-client.ts
├── lifecycle.test.ts
├── subscription-api.test.ts
└── webhook.test.ts
```

## Main design

I tried to keep the responsibilities separated:

- **Domain** - subscription states and allowed transitions
- **Billing service** - main business logic
- **Repository** - stores subscriptions, payments, webhook events and audit events
- **Payment provider** - payment provider contract
- **Fake payment provider** - used for testing different payment outcomes
- **Routes** - HTTP request validation and response handling
- **Tests** - verify lifecycle, API behavior and webhook behavior

## Running the project

Install dependencies:

```bash
npm install
```

Run the TypeScript check:

```bash
npm run build
```

Run all tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Start the application:

```bash
npm run dev
```

## Test result

The current test suite contains 28 tests.

I verified:

```text
Test Files  3 passed (3)
Tests       28 passed (28)
```

The test coverage includes subscription lifecycle, subscription API behavior, payment provider behavior, webhook security, duplicate events, stale events, and canceled subscription protection.

## A small note about the implementation

This project uses an in-memory repository because this assignment is focused on the application logic and testing rather than a real database.

For a production system, I would replace the in-memory repository with a database-backed repository and would also add things such as database transactions, stronger concurrency handling, persistent idempotency records, structured logging, metrics, and more integration tests.

For this assignment, I kept the implementation simple so the main business rules are easy to understand and test.

## Final verification

Before submitting, I run:

```bash
npm run build
npm test
```

Both should pass before the assignment is submitted.
