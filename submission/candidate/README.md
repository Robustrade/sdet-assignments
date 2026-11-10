# Subscription & Billing Service — SDET Assignment Solution

## Language Choice

This solution is implemented in Java because it is the candidate's current working language; this is a conscious deviation from the assignment's TypeScript/JavaScript preference. It is Java, not JavaScript.

## Prerequisites
- Java 17+
- Maven 3.8+

## Running the Tests

```bash
cd submission/candidate
mvn clean test
```

Run a specific test class:
```bash
mvn test -Dtest=StateMachineTest
mvn test -Dtest=ApiContractTest
mvn test -Dtest=DatabaseVerificationTest
mvn test -Dtest=MockProviderTest
mvn test -Dtest=EndToEndFlowTest
```

---

## Project Structure

```
src/
├── main/java/com/billing/
│   ├── domain/
│   │   ├── SubscriptionStatus.java          # Lifecycle states enum
│   │   ├── SubscriptionStateMachine.java    # State transition table
│   │   ├── IllegalStateTransitionException.java
│   │   ├── Plan.java                        # Plan pricing and trial config
│   │   ├── Subscription.java                # Plain Java model
│   │   ├── Invoice.java                     # Plain Java model
│   │   └── WebhookEvent.java                # Plain Java model (idempotency + audit)
│   ├── repository/
│   │   ├── CustomerRepository.java          # Seeded known-customer fixture
│   │   ├── SubscriptionRepository.java      # Repository Pattern — HashMap store
│   │   ├── InvoiceRepository.java
│   │   └── WebhookEventRepository.java
│   ├── service/
│   │   ├── PaymentProvider.java             # Interface (DI seam for mocking)
│   │   ├── PaymentProviderTimeoutException.java
│   │   ├── SubscriptionService.java         # Core business logic
│   │   ├── WebhookPayload.java
│   │   ├── WebhookSignatureVerifier.java    # HMAC-SHA256 signature validation
│   │   └── NotFoundException.java
│   └── api/
│       ├── BillingServer.java               # Javalin HTTP server
│       └── SubscriptionResponse.java        # API response DTO
│
└── test/java/com/billing/
    ├── context/
    │   └── AppContext.java                  # Singleton Pattern — shared server instance
    ├── pages/
    │   ├── SubscriptionsPage.java           # Page Object Model — /subscriptions
    │   └── WebhooksPage.java                # Page Object Model — /webhooks
    ├── builders/
    │   ├── SubscriptionRequestBuilder.java  # Builder Pattern
    │   └── WebhookPayloadBuilder.java       # Builder Pattern
    ├── mocks/
    │   ├── MockPaymentProvider.java         # Configurable test double with call recording
    │   └── WebhookSimulator.java            # Signed/unsigned payload construction
    ├── assertions/
    │   └── SubscriptionAssertions.java      # All assertion logic (API + DB + invariants)
    └── specs/
        ├── BaseTest.java                    # Shared wiring, @BeforeMethod reset
        ├── ApiContractTest.java
        ├── StateMachineTest.java
        ├── DatabaseVerificationTest.java
        ├── MockProviderTest.java
        └── EndToEndFlowTest.java
```

---

## Design Patterns — Quick Reference for Interview

| Pattern | Class | One-line explanation |
|---|---|---|
| Page Object Model | `SubscriptionsPage`, `WebhooksPage` | Each API group is a class; tests do not contain HTTP details |
| Builder | `SubscriptionRequestBuilder`, `WebhookPayloadBuilder` | Builds subscription requests and webhook payloads for tests |
| Singleton | `AppContext` | Shares the server and repositories across test classes |
| Repository | `SubscriptionRepository`, `InvoiceRepository`, `WebhookEventRepository` | Provides typed access to the in-memory stores |
| State machine | `SubscriptionStateMachine` | Defines the allowed subscription status transitions |

## Dependencies
- Java 17
- Javalin 6 for the HTTP server
- TestNG for the test runner
- RestAssured for HTTP requests
- AssertJ for assertions

`basic` and `pro` plans start with trials; the fixture's `immediate` plan charges during subscription creation so the injected provider is exercised through the HTTP/API path. A provider timeout leaves the invoice `PENDING` and the subscription `past_due`; a later signed payment webhook can resolve that invoice. The `retryPayment` service operation records another provider attempt after a confirmed failure, but no background scheduler invokes it. Three consecutive failed invoice attempts cancel a subscription, and a successful or refunded payment resets the failure streak.