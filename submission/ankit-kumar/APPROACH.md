# SDET Assignment – Subscription & Billing Service

# 1. Understanding of the Assignment

The objective of this assignment is to design and implement an automated test solution for a Subscription & Billing Service.

The system manages subscriptions through different stages: trialing, active, past_due and canceled. These status changes can happen through API requests or asynchronous payment webhook events.

My understanding is that testing individual APIs will not be sufficient. The tests should also verify the business logic, payment provider interactions and database records to make sure everything remains consistent throughout the subscription lifecycle.

# 2. Proposed Approach

Since the repository does not contain an existing service implementation, I plan to use Option 2 and build a minimal service fixture.

I will use the following technologies:

- TypeScript and Node.js for implementation.
- Express.js to expose the service APIs.
- Vitest as the test runner and mocking framework.
- Supertest for HTTP and API testing.
- SQLite in-memory database for persistence validation.

I will keep the implementation lightweight and focus on meaningful test coverage, object-oriented design and business logic rather than building a complete billing application.

# 3. Test Coverage Strategy

I plan to divide the test scenarios into the following areas.

**API Testing**
- Create and retrieve subscriptions.
- Cancel active and trial subscriptions.
- Test subscription plan changes and verify the updated plan and applicable pricing.
- Validate request and response structures.
- Test invalid plans, missing fields and unknown customers.
- Verify HTTP status codes and error responses.
- Validate webhook requests with valid and invalid signatures.

**API Contracts**

The service fixture will expose the following endpoints:

- POST /subscriptions – Create a subscription.
- GET /subscriptions/{id} – Retrieve subscription details.
- POST /subscriptions/{id}/cancel – Cancel a subscription.
- POST /webhooks/payment-provider – Receive payment provider webhook events.

Subscription creation will accept customer_id, plan and payment_method_id.

Webhook requests will contain event_id, event type, subscription_id, invoice_id, amount and currency. The X-Provider-Signature header will be used for signature validation.

**Subscription Lifecycle Testing**
- Verify all valid transitions between trialing, active, past_due and canceled.
- Verify that invalid state transitions are rejected or safely ignored.
- Test successful and failed payments.
- Verify retry success and cancellation after retry exhaustion.
- Check that canceled subscriptions cannot become active again through subsequent webhooks.

**Payment and Webhook Testing**
- Verify successful, declined and timed-out payment attempts.
- Test duplicate webhook delivery.
- Test webhooks arriving out of order.
- Validate payment signatures and malformed payloads.
- Verify payment provider call counts and arguments.

**Database Testing**
- Verify subscription, invoice and payment records.
- Validate webhook event processing, including duplicate events.
- Check subscription status and payment history.
- Ensure API responses match the persisted database state.
- Verify that invalid operations do not create unwanted records or payment attempts.

# 4. Proposed Test Architecture

I plan to keep the framework organised by separating test logic, business operations and database interactions.

The main components will be:

- **Test Fixtures:** Prepare the database, seed test data and configure dependencies before test execution.
- **API Client:** Provide reusable methods for sending HTTP requests to the service.
- **Subscription Service:** Handle subscription-related operations.
- **State Machine:** Control valid subscription status transitions.
- **Mock Payment Provider:** Simulate successful payments, declines and timeouts.
- **Webhook Simulator:** Generate signed and invalid webhook requests.
- **Repository Layer:** Handle database operations and provide access to persisted records.
- **Test Data Builders:** Create reusable customers, subscriptions and webhook payloads.
- **Verification Helpers:** Keep API, database and payment provider assertions reusable.
- **Test Specifications:** Organise scenarios into API, lifecycle, webhook and persistence tests.

This structure will help keep the test cases readable and avoid repeating the same setup and validation logic.

# 5. Design Patterns

I plan to use the following design patterns where they make the implementation easier to maintain.

**1. State Machine Pattern**

I will use this to manage subscription status changes such as trialing, active, past_due and canceled. It will help enforce the allowed transitions and prevent invalid status changes.

**2. Builder Pattern**

I will use builders to create test data such as customers, subscriptions and webhook events. This will reduce repeated object creation and make the test scenarios easier to read.

**3. Strategy Pattern**

I will use a common interface for the payment provider so that different payment outcomes can be simulated. For example, successful payments, declined payments and provider timeouts can be tested without connecting to an actual payment gateway.

**4. Repository Pattern**

I will keep database operations separate from the business logic. This will make database validation easier and avoid spreading database queries across the test cases.

# 6. Database Validation Strategy

Database validation will be an important part of the automation because a successful API response alone does not guarantee that the correct data has been stored.

I plan to validate the following entities:

- **Subscriptions:** Customer reference, selected plan, current status and relevant timestamps.
- **Invoices/Payments:** Invoice references, payment amounts, transaction status and billing attempts.
- **Webhook Events:** Event IDs, event types and processing status, including duplicate deliveries.
- **Audit History:** Subscription status changes and related events, where maintained separately.

I will also verify important business rules, such as:

- A subscription should not become active without a successful persisted payment record.
- A canceled subscription should not transition to another state.
- Duplicate events should not create duplicate invoices, payments or provider charges.
- The API-visible subscription state should match the database state.

Test data will be isolated between test runs using database setup, seeding and cleanup to avoid interference from previous executions.

# 7. Webhook and Idempotency Strategy

Webhook handling is one of the important areas I plan to focus on because payment providers may deliver the same event multiple times or deliver events in an unexpected order.

The following scenarios will be covered:

- Generate valid HMAC signatures and verify that unsigned or invalid requests are rejected.
- Send the same webhook event ID multiple times and verify that the business operation is processed only once.
- Verify that duplicate events are recorded appropriately without creating duplicate financial records.
- Send a payment failure event after a successful payment event for the same invoice and verify that the subscription does not incorrectly move back to past_due.
- Send a payment success event for an already canceled subscription and verify that it remains canceled.
- Validate payment failure, successful retry and refund event handling.
- Verify that webhook retries do not result in additional payment provider calls.

For refund events, I will validate the persisted refund information and audit history according to the business rules implemented in the fixture.

# 8. Assumptions and Limitations

For this implementation, I plan to use the following assumptions:

- A minimal subscription and billing service fixture will be created to support the automation.
- At least two subscription plans, such as BASIC and PRO, will be supported with different pricing and trial configurations.
- Plan pricing and trial durations will be configurable.
- The payment provider will be mocked rather than connected to a real payment gateway.
- Webhook delivery will be simulated through automated HTTP requests.
- SQLite in-memory storage will be used for database validation.
- The service will support the lifecycle transitions defined in the assignment.
- A canceled subscription will remain canceled even when additional webhook events are received.

The implementation will focus on core subscription and billing workflows. Production-level payment processing and unrelated billing features will remain outside the scope.

# 9. Execution Strategy

I plan to follow the Red, Blue, Green workflow mentioned in the assignment.

**Red:** Write automated tests for important business scenarios and verify that they fail when the expected behavior is not implemented.

**Blue:** Implement the minimum functionality required to make those tests pass.

**Green:** Refactor the implementation to improve readability, reusability and maintainability while keeping the test suite passing.

After implementation, I will run the automated tests and perform TypeScript type checking and linting to validate the solution.

# 10. Expected Outcome

The goal is to deliver a lightweight but maintainable automation solution that validates the subscription lifecycle across API, business logic, database and external payment integration layers.

The final solution should provide confidence that successful payments, payment failures, duplicate webhooks, invalid state transitions and database inconsistencies are handled correctly.

I will also document the implementation decisions, assumptions and limitations so that the solution is easy to understand and maintain.
