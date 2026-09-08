# Subscription & Billing SDET Assignment — Umakant Mohanty

## Approach
This submission uses the allowed **hybrid** approach: a deliberately small TypeScript/Node.js service fixture plus an object-oriented automation suite. The fixture exists only to make the test strategy executable and to provide queryable persistence; it is not intended as a production billing service.

## Architecture

```text
               +--------------------+
               |  Test Scenarios    |
               +---------+----------+
                         |
               +---------v----------+
               |     TestContext    |  <- fixture / isolation
               +----+----+----+-----+
                    |    |    |
          +---------+    |    +----------------+
          |              |                     |
+---------v--------+ +---v----------------+ +--v------------------+
| Typed HTTP layer | | SubscriptionService| | MockPaymentProvider|
+------------------+ +----+-----------+---+ +---------------------+
                          |           |
                   +------v--+    +---v----------------+
                   | State   |    | InMemoryRepository |
                   | Machine |    | subscriptions      |
                   +---------+    | invoices/payments  |
                                  | webhook_events     |
                                  | audit_events       |
                                  +--------------------+
```

## Design patterns

* **State Machine / State pattern:** `SubscriptionStateMachine` contains the only legal transition table. Tests cannot silently mutate status strings.
* **Builder:** `SubscriptionRequestBuilder` and `WebhookBuilder` remove repetitive object construction and make scenario intent obvious.
* **Strategy / Dependency Injection:** `PaymentProvider` is an interface; `MockPaymentProvider` is injected into `SubscriptionService` and records calls plus configurable success/decline/timeout outcomes.
* **Repository:** `Repository` abstracts persistence access from tests and service code, avoiding raw storage access scattered through scenarios.

## Validation covered

### API
* Create and retrieve subscriptions.
* Immediate-charge and trial-plan behavior.
* Unknown plan, unknown customer, missing payment method.
* Plan changes and repeat-cancel conflict.
* Webhook signature, malformed JSON, malformed payload.

### Lifecycle
Every required valid transition is exercised either through the service or the explicit state-machine test:

* `trialing -> active`
* `trialing -> past_due`
* `active -> past_due`
* `past_due -> active`
* `past_due -> canceled`
* `active -> canceled`
* `trialing -> canceled`

At least two invalid transitions are proven impossible through the state-machine seam, including `canceled -> active` and `active -> active` via an unsupported retry trigger.

### Persistence / invariants
The suite checks:

* subscription status and plan;
* invoice/payment status, amount and reference;
* webhook event processing and unique `event_id` handling;
* audit events on status transitions;
* no duplicate invoice on webhook replay;
* canceled subscriptions do not reactivate or receive new invoice side effects;
* a stale failure for an invoice that already succeeded cannot regress an active subscription.

### Provider / webhook interaction
* exact provider call count and arguments;
* decline and timeout behavior;
* replayed webhooks never call the provider;
* webhooks are constructed and signed in the test suite.

## Assumptions and tradeoffs

* In-memory persistence is intentional to keep the assignment fast, deterministic, and self-contained.
* The HTTP fixture uses Node's built-in `http` module and `fetch`, avoiding a large dependency footprint.
* The production service is represented by a compact fixture. A real system would use a transactional database and unique constraints for event IDs/invoice IDs, plus concurrency controls.
* `payment.refunded` is modeled as an invoice status transition where an invoice exists; refund-specific subscription lifecycle semantics were not specified by the assignment. A simple plan-change endpoint was added as a narrow extension because the assignment explicitly calls plan changes part of API validation.
* Retry exhaustion is represented at the state-machine layer because no retry scheduler/API was mandated by the fixture contract.

## Run

Requirements: Node.js 20+ and npm 10+.

```bash
cd submission/umakant-mohanty
npm run build
npm test
```

The tests use Node's built-in test runner (`node:test`) and the compiled TypeScript output. No real payment provider or external database is contacted.

## Red / Blue / Green discipline

The implementation was developed around the highest-risk behaviors first: state transition safety, idempotency, provider interaction, and persistence invariants. The final branch contains the refactored green implementation; intermediate red/blue commits are intentionally not required by the assignment.
