# Test Strategy

## Overview

This project implements an automated validation suite for a Subscription & Billing Service.

The goal of this solution is not to build a production-ready billing platform, but to demonstrate a maintainable, object-oriented automation framework capable of validating a stateful backend service across multiple layers.

The solution focuses on:

- API validation
- Subscription lifecycle validation using a state machine
- Database persistence validation
- Mocked payment provider interactions
- Webhook idempotency and duplicate event handling
- End-to-end workflow verification

---

## Assumptions

Since no implementation was provided, a minimal service fixture is built for testing purposes.

The fixture supports:

- Subscription creation
- Subscription cancellation
- Payment webhooks
- SQLite persistence
- Mock payment provider
- Event history tracking

The implementation is intentionally minimal and exists only to support automated validation.

---

## Test Levels

The solution validates the application at multiple levels.

### API Tests

Verify:

- Request validation
- Response codes
- Response payloads
- Invalid requests

### State Machine Tests

Verify:

- Valid lifecycle transitions
- Invalid transitions
- Subscription invariants

### Persistence Tests

Verify:

- Subscription records
- Invoice records
- Webhook events
- Audit history

### Integration Tests

Verify:

- Payment provider interaction
- Webhook processing
- Complete subscription workflow

---

## Mocking Strategy

The external payment provider is replaced by a configurable mock implementation.

The mock allows tests to simulate:

- Successful payment
- Failed payment
- Provider timeout

The mock also records:

- Number of calls
- Request arguments
- Idempotency behaviour

---

## Database Validation

Tests verify persisted state rather than relying only on API responses.

The following entities are validated:

- subscriptions
- invoices
- webhook_events

Database assertions verify that persisted state always matches business behaviour.

---

## Design Patterns

The following design patterns are intentionally used.

- State Pattern
- Builder Pattern
- Repository Pattern
- Strategy Pattern (Payment Provider)

Each pattern is used to reduce duplication and improve maintainability.

---

## Out of Scope

The following are intentionally excluded:

- Authentication
- Production deployment
- Multi-currency billing
- Taxes
- Performance testing
- Real payment provider integration