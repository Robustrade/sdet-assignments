I understand this assignment as a billing workflow validation problem

The service will manage subscription lifecycles such as trialing, active, past_due, and canceled. These states will change through API calls and payment-provider webhook events. I also need to validate persistence, idempotency, invalid transitions, and the behavior of a mocked payment provider.

My approach:

I will build a minimal TypeScript/Node.js backend fixture that exposes the required subscription and webhook APIs. For automation, I will use Cypress with TypeScript to validate the API behavior, business rules, and persisted state.

The solution will focus on:

- creating and retrieving subscriptions
- canceling subscriptions
- validating plan-based billing rules
- verifying valid and invalid lifecycle transitions
- handling successful, failed, and duplicate webhook events
- asserting persisted records for subscriptions, invoices, and webhook events
- mocking the external payment provider and validating provider calls

This is intentionally a lightweight fixture to demonstrate the testing strategy and to validate the key billing invariants without building a full production billing platform.
