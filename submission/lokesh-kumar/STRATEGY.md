\# Test Strategy: Subscription \& Billing Service



\*\*Author:\*\* Lokesh Kumar

\*\*Status:\*\* Approach document (dummy PR). Full implementation to follow in this PR.



\## 1. Understanding of the problem



The Subscription \& Billing Service is a stateful system. A subscription moves through a lifecycle (`trialing`, `active`, `past\_due`, `canceled`), driven by API calls and by asynchronous, signed webhooks from an external payment provider. The hard parts to validate are not the endpoints themselves, but:



\- duplicate and redelivered webhooks

\- out-of-order webhooks

\- illegal state transitions

\- agreement between API response, database state, and payment-provider calls



My goal is to prove those properties, not to build a large product or framework.



\## 2. Assumptions about the system under test



\- No service is provided, so I will build a \*\*minimal service fixture\*\* (Option 2/3) in TypeScript/Node with Express.

\- Persistence is an embedded database (SQLite via `better-sqlite3`) or an in-memory store, queryable from tests.

\- Plans: `basic` and `pro`, each with a price and trial length (`pro` starts in `trialing`, `basic` is charged immediately; this is configurable).

\- Webhooks carry `X-Provider-Signature`, an HMAC over the raw body using a shared secret.

\- Webhook event types: `payment.succeeded`, `payment.failed`, `payment.refunded`.

\- Retries-exhausted is modeled as a configurable maximum number of failed retries before `past\_due` becomes `canceled`.



\## 3. Scope



\*\*In scope:\*\* API contract, state machine, persistence, payment-provider interaction (mocked), webhook handling (signature, idempotency, ordering), end-to-end flows.



\*\*Out of scope:\*\* UI, real payment provider, performance testing, taxes, proration edge cases, multi-currency. Concurrent webhook delivery is a bonus if time allows.



\## 4. Test levels



| Level | What is proven |

|---|---|

| API | Status codes, payload shape, validation errors, webhook signature/malformed payload handling |

| State machine | Each valid transition occurs; invalid ones are rejected or ignored |

| Database | Subscriptions, invoices, webhook events and audit log are correct and mutually consistent |

| Provider mock | Call count, arguments (amount, customer, payment method, idempotency key), behavior on success/decline/timeout |

| End to end | Request or webhook, through service, to persistence and provider call |



\## 5. Real vs mocked



| Component | Real or test double | Why |

|---|---|---|

| Service fixture (Express app, domain logic) | Real | This is the system under test |

| Persistence (SQLite/in-memory) | Real | Persistence is part of what we validate |

| Payment provider | \*\*Fake\*\* (`FakePaymentProvider`) | External dependency; needs configurable outcomes and call recording |

| Webhook delivery | \*\*Simulated\*\* by `WebhookSimulator` posting signed/unsigned/malformed payloads over HTTP | Lets us control ordering and duplicates |



\## 4a. Design patterns (only where they solve a real problem)



| Pattern | Where | Problem solved |

|---|---|---|

| State machine (explicit transition table) | `SubscriptionStateMachine` | Illegal transitions are structurally unreachable; no ad hoc status mutation |

| Builder | `SubscriptionBuilder`, `WebhookPayloadBuilder` | Scenarios read as intent, with no repeated object literals |

| Interface + dependency injection | `PaymentProvider` / `FakePaymentProvider` | Tests substitute the provider and record calls |

| Repository | `SubscriptionRepository`, `InvoiceRepository`, `WebhookEventRepository` | Tests verify persisted state without raw SQL inline |



If any of these turns out not to earn its place in the code, I will remove it from this document rather than claim it.



\## 6. Test architecture (planned structure)



```

submission/lokesh-kumar/

&#x20; src/                      service fixture

&#x20; tests/support/

&#x20;   builders/               test data builders

&#x20;   clients/                typed API client

&#x20;   doubles/                FakePaymentProvider, WebhookSimulator

&#x20;   repositories/           DB verification access

&#x20;   assertions/             reusable verifiers

&#x20;   TestEnvironment.ts      fresh app + DB per test

&#x20; tests/specs/              api-contract, lifecycle, webhooks, invariants, provider, e2e

```



\## 7. Webhook and idempotency strategy



\- Every processed `event\_id` is stored in `webhook\_events` in the same transaction as the state change.

\- A repeated `event\_id` is recorded as a duplicate and is a no-op: no state change, no new invoice, no provider call.

\- Stale or out-of-order events (for example `payment.failed` arriving after `payment.succeeded` for the same invoice) are checked against the transition table and invoice state; they must not regress an `active` subscription.

\- Events for a `canceled` subscription are recorded but never change its state.

\- Invalid signature results in 401 and nothing is persisted. Malformed payload results in 400.



\## 8. API contracts under test



\- `POST /subscriptions` (201 on success; 400/404/422 for invalid plan, missing fields, unknown customer)

\- `GET /subscriptions/{id}`

\- `POST /subscriptions/{id}/cancel` (200; error on already-canceled)

\- `POST /webhooks/payment-provider` (200 on valid; 401 invalid signature; 400 malformed)



\## 9. Database entities and invariants



\*\*Entities:\*\* `subscriptions`, `invoices`, `webhook\_events`, audit log (`subscription\_events`).



\*\*Invariants asserted:\*\*



1\. A subscription is never `active` without at least one successful persisted payment record.

2\. A `canceled` subscription never transitions again.

3\. Duplicate webhooks never create duplicate invoices, payments, or provider charges.

4\. The provider is called at most once per genuine billing attempt, and never for rejected or replayed requests.

5\. Persisted state always matches the API-visible result.

6\. Plan price and trial rules are applied consistently between creation and billing.



\*\*Isolation:\*\* each test gets a fresh database through `TestEnvironment`, so there is no stale data and no false positives from earlier tests.



\## 10. Workflow



Red, Blue, Green: write a failing test for an invariant, add the minimum fixture code to pass, then refactor for readability.



\## 11. Known limitations



\- The service fixture is intentionally minimal and is not production code.

\- The provider and webhook delivery are simulated; no real network behavior is verified.

\- Concurrency/race scenarios may be limited to a bonus test or documented as future work.

