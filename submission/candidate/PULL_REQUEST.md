## Summary

This submission is a small Java 17 fixture and TestNG suite for a subscription billing API. It uses Javalin for HTTP, in-memory repositories for persistence, RestAssured for requests, and AssertJ for assertions. There is no real database or payment provider.

## Language note

The prompt specifies TypeScript or JavaScript; this implementation is Java.

## Coverage

- API requests for creating, retrieving, and canceling subscriptions, including validation failures.
- Webhook signature, invoice ownership, and amount validation.
- All lifecycle transitions, including cancellation after three consecutive failed invoice attempts.
- Duplicate and out-of-order webhook handling.
- Provider-backed retries after declines, timeout reconciliation by webhook, and retry exhaustion.
- Stored subscription, invoice, and webhook event state.
- Provider calls for immediate-charge success, decline, and timeout outcomes.
- End-to-end HTTP flows through the in-memory service fixture.

Each failed invoice ID represents one attempt. `retryPayment` calls the provider for a `past_due` subscription, records a new invoice, and cancels after the third consecutive failure. A paid or refunded invoice resets the count. If an invoice is still `PENDING` after a timeout, another charge is blocked until a signed payment webhook resolves it. The fixture provides no background retry scheduler; a caller must invoke `retryPayment`.

## Test Setup and Design

The tests start a local Javalin server and send real HTTP requests to it. Repositories are HashMap-backed and reset before each test. Service operations are synchronized so duplicate and conflicting requests are processed one at a time within this JVM. The payment provider is a `MockPaymentProvider` injected into the service; it records call arguments and can return success, decline, or timeout.

The test support is split into page objects for HTTP calls, builders for request and webhook data, repositories for stored records, and assertion helpers. `SubscriptionStateMachine` owns the allowed status transitions. `AppContext` shares the server and test dependencies across classes.

Webhook signatures are generated with HMAC-SHA256 and compared in constant time. Duplicate event IDs are ignored. Events with an invoice owned by another subscription or an unexpected amount are recorded as unprocessed. A failed webhook for an invoice already marked paid cannot change that invoice.

## Persistence Checks

The tests inspect subscriptions, invoices, and webhook events directly through their repositories. They check that API-visible status matches stored status, that duplicate deliveries do not create duplicate records, and that active subscriptions have a paid invoice.

A subscription can be `past_due` while retaining a paid invoice from an earlier billing period; a later failed attempt does not erase that history. Canceled subscriptions remain canceled when later webhooks arrive.

## Limitations

- Retry attempts require an explicit service call; no background scheduler or polling reconciliation worker is included.
- Concurrent duplicate delivery, cancellation-versus-success delivery, and success-versus-failure delivery for one invoice are tested within one process; simultaneous ordering across different invoice IDs is not covered.
- Synchronization only coordinates this process; it does not coordinate multiple server instances and serializes service operations.
- In-memory repositories are not thread-safe and do not provide durable storage.
- Proration, taxes, and multiple currencies are outside the fixture's scope.

## Running Tests

From `submission/candidate`:

```bash
mvn clean test
```
