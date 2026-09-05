# Subscription & Billing Service — SDET Assignment

## 1. Test strategy

This submission uses an end-to-end oriented pytest suite against a minimal service fixture, because no service implementation was provided in the assignment.

### Covered levels

- **API:** subscription creation, retrieval, cancellation, and signed payment-provider webhooks.
- **Workflow/state-machine:** every documented valid lifecycle transition plus multiple invalid transitions.
- **Persistence:** subscription, invoice, payment, webhook-event, and audit-event records are queried and asserted after workflow actions.
- **External integration seam:** the outbound payment provider is replaced with an injected mock so provider requests and call counts can be verified deterministically.
- **Business workflows:** creation → billing attempt → webhook finalization, trial-end billing, payment failure → `past_due` → retry → recovery/exhaustion, cancellation, duplicate delivery, and out-of-order webhook handling.

### Real vs mocked

**Real:** FastAPI request handling, HMAC verification, service orchestration, state machine, repositories, SQLAlchemy/SQLite persistence, transaction handling, and audit records.

**Mocked:** only the outbound payment provider. `PaymentProvider` is a protocol and `MockPaymentProvider` records each charge request and returns configurable outcomes (`succeeded`, `declined`, `pending`, `timeout`). Webhooks are not mocked internally; the tests construct signed payloads and POST them through the real webhook endpoint.

### Scope boundaries

The minimal fixture intentionally does not implement a production scheduler, plan-management API, plan changes/proration, production provider adapter, or concurrent webhook simulation. Trial duration is represented in plan configuration, while `start_trial_billing()` explicitly models the billing operation performed when a trial ends.

## 2. OOP and design patterns

### Explicit State Machine

`SubscriptionStateMachine` contains the legal lifecycle transition table. This gives structural rejection of invalid transitions while avoiding a class-per-state hierarchy for a small, fixed state graph.

### Repository

Entity-specific repositories isolate SQLAlchemy persistence access from the API, service orchestration, and scenario tests. This also gives the test assertion layer a stable persistence-facing interface.

### Provider abstraction / dependency injection

`PaymentProvider` defines the provider seam and `MockPaymentProvider` is injected into `SubscriptionService`. This solves the problem of testing outbound billing behavior without a real network dependency while still allowing exact provider arguments and call counts to be asserted.

### Builder

Test builders construct subscriptions, invoices, customers, and signed webhook payloads. They centralize repeated structured setup and signing details so scenario tests read as business intent rather than HTTP/data boilerplate.

## 3. API validation approach

API-facing scenarios use `SubscriptionApiClient` rather than issuing raw HTTP requests throughout the suite. Tests verify successful response codes/payloads and validation failures for unknown customers/plans, invalid payment methods, unknown subscriptions, invalid cancellation transitions, malformed webhook payloads, unsupported events, and invalid signatures.

Webhook tests calculate the provider signature over the raw request body and send the payload through `POST /webhooks/payment-provider`. This verifies the real request boundary rather than only testing service methods directly.

## 4. Database validation approach

The fixture persists and verifies:

- `subscriptions`
- `invoices`
- `payments`
- `webhook_events`
- `audit_events`
- seeded `customers`

Key invariants include:

- an `active` subscription has a persisted successful payment;
- invoice amount/currency must match the webhook payload;
- provider references and payment records correspond to the billing attempt;
- duplicate webhook delivery produces no second payment/audit side effect;
- a late failure cannot regress an invoice that was already paid;
- cancellation is terminal and later payment/refund webhooks cannot reactivate it;
- API-visible subscription state matches the persisted subscription row.

Each test gets a fresh in-memory SQLite database, so scenarios are isolated and repeatable.

## 5. Mock payment provider / webhook validation

The provider is injected through the `PaymentProvider` protocol. Tests assert exact customer, payment method, amount, currency, and invoice-based idempotency key, as well as expected call counts.

The important asynchronous boundary is deliberate: trial-end and retry billing create a durable pending invoice and make exactly one provider call, but do not finalize the payment or subscription state synchronously. A signed provider webhook performs finalization. This models the external integration boundary and prevents a provider-call return value from being mistaken for final webhook confirmation.

Duplicate webhooks are identified by `event_id` and become no-ops. Out-of-order failure after a successful payment cannot regress the paid invoice/subscription. Replayed webhooks do not call the provider again.

## 6. Test architecture

```text
tests/
├── framework/
│   ├── assertions/     reusable persistence/provider invariants
│   ├── builders/       reusable test-data construction
│   └── clients/        typed API client
└── scenarios/          business-facing specifications
```

Application code follows:

```text
tests/scenarios
      ↓
tests/framework
      ↓
app/api
      ↓
app/services
      ↓
app/domain + app/repositories + app/providers
```

The suite is intentionally scenario-oriented because the assignment emphasizes end-to-end workflow correctness rather than endpoint smoke tests. Reusable setup/construction/assertion concerns stay in the framework layer, while business behavior remains visible in scenario names and test bodies.

## 7. Plan-specific behavior

The two configured plans have deliberately different billing behavior:

| Plan | Price | Trial | Creation behavior |
|---|---:|---:|---|
| `basic` | $29.00 | 7 days | Starts `trialing`; no provider charge at creation |
| `pro` | $49.00 | none | Starts `trialing` and makes an immediate billing attempt |

For `basic`, `start_trial_billing()` represents the billing operation at trial end. Its payment outcome is still finalized only through the signed webhook.

## 8. Test result

Final local run:

```text
50 passed in 1.66s
```

## 9. Deliberate Python deviation

The brief expects TypeScript/Node.js. This implementation deliberately uses Python 3.12, FastAPI, SQLAlchemy, SQLite, and pytest because Python is the primary development language and keeps the minimal fixture and verification suite compact. The deviation is documented rather than hidden; the testing architecture and required design patterns are preserved.

## 10. Responsible AI usage

AI tools were used as a development and review aid for brainstorming scenarios, reviewing architecture, identifying edge cases, and improving documentation. The implementation was not accepted blindly: the code and test behavior were personally reviewed and executed, and the retry workflow was specifically corrected so a provider call creates a pending attempt while the signed webhook remains responsible for final payment/state transition. The final suite was run locally, and the assignment requirements were reviewed against the resulting implementation.
