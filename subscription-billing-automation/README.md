# Subscription Billing Automation

This directory is a self-contained TypeScript/Jest validation harness for a minimal subscription billing service. The service is a local fixture, not an external production system: its API dispatcher and in-memory repositories are real test code; the payment provider is an injectable mock adapter.

## Validation strategy

- **Unit:** state-object transitions and rejected terminal-state transitions.
- **Integration:** API contracts and validation, HMAC webhook request checks, provider outcomes/interactions, persistence, duplicate delivery, and out-of-order events.
- **End-to-end:** trialing through payment success/failure/retry/exhaustion, API cancellation, and agreement between API-visible and persisted state.
- **Entities and invariants:** subscription snapshots include transition history; invoice records retain payment outcomes; webhook records retain event ID and delivery count. An active subscription must have a successful (or subsequently refunded) payment record. Canceled subscriptions are terminal. A webhook event ID is applied once, while repeat delivery increments its delivery counter only.
- **Isolation:** each test creates a fresh service, provider adapter, repositories, client, and verifier. No external database or network state can leak between tests.

### API fixture contract

The typed client supports `POST /subscriptions`, `GET /subscriptions/{id}`, `POST /subscriptions/{id}/cancel`, and signed `POST /webhooks/payment-provider`. The `basic` plan has a 14-day trial and costs USD 19.00; `pro` has no trial and charges USD 49.00 immediately. Creation requires a known seeded customer and valid `pm_` payment method. Webhooks accept `payment.succeeded`, `payment.failed`, and `payment.refunded` with an HMAC-SHA256 signature over the exact raw request body. API cancellation is valid from trialing or active states; other lifecycle transitions not in the assignment's transition list are rejected.

### Patterns and boundaries

- **State pattern:** state objects own legal lifecycle transitions; the subscription model delegates rather than changing status ad hoc.
- **Builder:** subscription request/model and webhook builders make scenarios readable and consistent.
- **Adapter/Strategy seam:** `PaymentProvider` is injected into the service; `MockPaymentProviderAdapter` supplies success, decline, and timeout outcomes while capturing arguments.
- **Repository:** in-memory repositories isolate persistence access and the `PersistenceVerifier` checks stored state without reaching into test-specific raw storage.
- **Client/dispatcher:** `BillingApiClient` keeps route and signature construction out of scenario code. It calls an in-process service fixture, not a network server.

## Scope, assumptions, and limitations

There was no existing service to test, so this solution uses the assignment's permitted minimal fixture option. Customer data is seeded in memory (`cust_001` by default); plans and price are fixture configuration. HMAC validation and business processing are tested separately through the client, with malformed and forged requests. Events for unknown subscriptions are rejected; valid stale/duplicate events are acknowledged without reapplying effects. A timeout is represented as a pending invoice and past-due subscription because the provider's final result is unknown. Refunds update invoice status but do not define a lifecycle transition. Persistence is process-local and not transactional or concurrency-safe; real transport, database durability, authentication, proration, notification delivery, concurrent webhook races, and production retry scheduling remain out of scope.

## Run

From this directory:

```sh
npm test
npm run build
npm run validate
```

The root assignment's installed development dependencies are sufficient in the provided workspace. In a clean standalone checkout, run `npm install` first.

## Responsible AI usage

An AI coding assistant helped draft the fixture, framework structure, and scenario tests. The implementation was checked against the assignment's lifecycle rules, and the recorded validation (`npm run validate`) type-checks the project and runs all Jest suites. Review remains appropriate before treating this intentionally in-memory fixture as a production service or connecting it to real payment systems.
