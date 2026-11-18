
# Subscription and Billing Service

A backend Subscription and Billing Service built using Node.js, TypeScript, Express, and SQLite. The project demonstrates subscription lifecycle management, payment processing, webhook handling, database consistency, and automated API testing.

## Tech Stack

- Node.js and TypeScript
- Express.js
- SQLite with better-sqlite3
- Jest
- Supertest
- HMAC-SHA256 webhook signature validation

## Features

- Create and retrieve subscriptions
- Support Basic and Pro plans
- Manage subscription lifecycle:
  - trialing
  - active
  - past_due
  - canceled
- Process payment success, failure, and timeout scenarios
- Cancel subscriptions
- Handle payment provider webhooks
- Validate webhook signatures
- Prevent duplicate webhook processing
- Handle out-of-order payment events
- Maintain invoices, payments, and audit logs

## Architecture and Design Patterns

- State Machine: Controls valid subscription lifecycle transitions.
- Builder Pattern: Creates subscription test data with configurable defaults.
- Strategy / Provider Interface: Separates payment processing from provider implementation.
- Repository Pattern: Separates database operations from business logic.

## Project Structure

```text
src/
  database/
  models/
  providers/
  repositories/
  services/
  state-machine/
  app.ts
  server.ts

builders/
  subscription.builder.ts
  webhook-event.builder.ts
tests/
  api/
  database/
  lifecycle/
  support/
```

## Installation

```bash
npm install
```

## Run the Application

```bash
npm run dev
```

## Run Tests

```bash
npm test
```

## Run Tests with Coverage

```bash
npm run test:coverage
```

## TypeScript Validation

```bash
npm run typecheck
```

## Testing Approach

The Jest/Supertest suite covers API contracts and validation, subscription
lifecycle transitions, provider success/decline/timeout outcomes, retries,
webhook signature and payload validation, duplicate and out-of-order delivery,
refunds, canceled-subscription behavior, and persisted invoice/payment/audit
state. Provider calls are asserted for count and arguments in key workflows.

The quality workflow tests create an isolated in-memory database, Express app,
and mock provider for each test. Existing API scenarios reset persisted tables
and provider state before each test. For exact scope, assumptions, coverage
mapping, and remaining limitations, see [the SDET test strategy](./docs/approach.md).

## Mocking and Scope

The payment provider is simulated using a mock implementation supporting
success, decline, and timeout outcomes. Tests check persisted billing statuses
and provider call details for representative flows.

Webhook requests are simulated through HTTP API tests. HMAC signatures are generated using a test secret.

No real external payment provider or frontend is integrated. This project focuses on backend implementation and automated verification.
