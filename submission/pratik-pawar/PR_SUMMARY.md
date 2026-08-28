# PR Summary

This project implements a small subscription and billing service in TypeScript, backed by Express routes, service-layer logic, in-memory repositories, and a mock payment provider. The aim is to validate core business behavior around subscription lifecycle, webhook processing, invoice updates, and persistence without requiring a real external system.

## What was built

- Express-based subscription API with create, fetch, and cancel flows
- Domain logic for subscription state transitions
- In-memory repository implementations for subscriptions, invoices, and webhook events
- Payment provider abstraction with a mock implementation for success, decline, and timeout scenarios
- Webhook validation and idempotency handling for signed provider events
- JUnit and HTML test reporting for easier validation and review

## Design approach

The codebase follows a clean layered structure:

- Domain: models and state machine for subscription lifecycle rules
- Application: service layer for billing and webhook processing
- Infrastructure: repository implementations and mock payment provider
- API: Express routes and request validation

This keeps business rules independent from HTTP and persistence concerns while making the behavior easy to test in isolation.

## Coverage included

The tests cover:

- Subscription creation and validation
- Retrieval and cancellation flows
- Trial and active lifecycle transitions
- Invalid state transitions and retry protection
- Payment success, decline, and timeout handling
- Correct invoice and repository updates
- Signed webhook verification
- Duplicate webhook rejection
- Malformed payload handling
- Wrong-amount validation
- Persistence consistency across API and service flows

## Test strategy

The suite is organized by responsibility:

- API tests for HTTP behavior and integration flows
- Service tests for subscription and webhook business logic
- State machine tests for lifecycle rules
- Repository tests for in-memory persistence behavior
- Payment tests for provider contracts and payload/signature behavior

This structure gives good confidence without over-mocking or hiding important behavior.

## Validation

The following checks were run successfully:

```bash
npm test -- --runInBand
npm run build
npm run test:report
```

Verified results:

- 6 test suites passed
- 121 tests passed
- TypeScript build passed
- HTML report generated successfully

## Notes and limitations

- Persistence is intentionally in-memory rather than database-backed.
- Payment processing is mocked rather than connected to a real provider.
- The implementation is focused on assignment-style fixture behavior and does not cover production-grade observability, tax, proration, or customer-management features.

## Final outcome

The result is a working, test-backed subscription billing fixture with strong domain validation, robust webhook handling, and a clear reporting flow for reviewing test outcomes.