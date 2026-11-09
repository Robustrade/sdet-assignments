# Test Strategy & Design

This document is the "documentation-first" part of the assignment: the intended
validation strategy and the design decisions behind it. It was written alongside
the fixture and suite, and reflects what the code actually does.

## 1. Assumptions about the system under test

No service was provided, so I built a minimal fixture (Option 2) that behaves
like a realistic subscription/billing backend and exposed it behind the same
seams a production service would. Concretely I assume:

- Two plans. `basic` has no trial and is **charged immediately** on creation;
  `pro` has a 14-day trial and **starts in `trialing`** with no charge yet.
- The service **initiates** a charge only when it genuinely bills a customer —
  in this fixture that is the immediate charge at creation. Recurring charges,
  trial-end charges and retries are driven by the provider and arrive as inbound
  webhooks (`payment.succeeded` / `payment.failed`), mirroring how Stripe-style
  providers work. So webhook processing never calls the provider.
- Webhooks are signed with HMAC-SHA256 over the raw body using a shared secret.
- Retry/dunning: a subscription in `past_due` is canceled once charges fail
  `maxRetries` (3) times in a row.
- Refunds are recorded against the invoice but do not themselves move the
  lifecycle (the diagram defines no refund transition).

## 2. Scope of automation

**In scope**

- API contract: creation, retrieval, cancellation, and webhook request handling.
- Lifecycle state machine: every valid transition, plus proven-impossible ones.
- Persistence: subscriptions, invoices, webhook events, and the audit log,
  checked at each lifecycle stage.
- Mocked provider interaction: call count, call arguments, success/decline/timeout.
- Webhook idempotency and out-of-order/stale delivery.
- End-to-end flows combining the above.

**Out of scope** (per the assignment's non-goals)

- Real payment integration, UI, proration/tax/multi-currency edge cases,
  performance testing, monitoring/reporting dashboards.
- Concurrent/racing webhook delivery (bonus; see Limitations).

## 3. Test levels

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `state-machine/*` (pure machine) | transition correctness in isolation |
| API/contract | `api/*` | status codes, payload shape, validation, signature/malformed handling |
| Integration | `persistence/*`, `provider/*`, `webhooks/*` | service + store + provider behave together |
| End-to-end | `e2e/*` | full path API/webhook -> service -> persistence -> provider |

## 4. What is real vs mocked, and why

- **Real:** the service, the state machine, persistence logic, the HTTP layer,
  and signature verification. These are the behaviors under test — faking them
  would prove nothing.
- **In-memory store:** persistence *logic* is real, but rows live in memory behind
  repositories. This keeps setup frictionless and makes isolation trivial, while
  still being fully queryable for assertions. Swapping in SQLite would mean
  reimplementing the repositories only.
- **Mocked provider:** the external dependency. Faking it is the whole point of
  the seam — it lets us assert call count/arguments and force decline/timeout
  deterministically, with no network.
- **Simulated webhooks:** built and signed by the suite so we control the exact
  bytes (needed for signature tests) and can forge invalid variants.

## 5. Design patterns and where they earn their keep

| Pattern | Location | Problem it solves |
| --- | --- | --- |
| Transition-table state machine | `src/domain/stateMachine.ts` | one authority for lifecycle; illegal transitions unreachable |
| Builder | `tests/support/builders/*` | readable scenarios; explicit invalid variants |
| DI seam (Strategy/Adapter) | `src/payments/PaymentProvider.ts` + `FakePaymentProvider` | substitute a recordable fake for the provider |
| Repository | `src/persistence/*` | encapsulated, queryable persistence; store is swappable |
| Factory | `tests/support/clients/ApiClientFactory.ts` | one place to build clients (in-process now, remote later) |
| Plan catalog / Strategy | `src/domain/plans.ts` | per-plan pricing/trial in data, not scattered branches |

## 6. API contracts

| Method & path | Success | Error cases |
| --- | --- | --- |
| `POST /subscriptions` | 201 + subscription | 400 `validation_error` / `unknown_plan` / `invalid_payment_method`; 404 `customer_not_found` |
| `GET /subscriptions/{id}` | 200 + subscription | 404 `subscription_not_found` |
| `POST /subscriptions/{id}/cancel` | 200 + subscription | 404 `subscription_not_found`; 409 `already_canceled` |
| `POST /webhooks/payment-provider` | 200 `{status: processed\|duplicate_ignored\|ignored}` | 401 `invalid_signature`; 400 `malformed_payload`; 404 `subscription_not_found` |

The wire format is snake_case (matching the assignment's examples); the domain is
camelCase, translated in `src/http/serializers.ts`. A declined/timed-out charge on
an immediate-plan creation still returns **201** with the subscription in
`past_due` — the charge failing is a billing outcome, not a request error.

## 7. Database entities and invariants

Entities checked: `subscriptions`, `invoices`, `webhook_events` (processed
`event_id`s), and an append-only `audit log`.

Invariants asserted by `PersistenceVerifier`:

- an `active` subscription has **≥1 paid invoice** (`noContradictoryRecords`);
- a `canceled` subscription never transitions again, regardless of webhooks;
- a duplicate webhook produces **no** duplicate invoice/event/audit rows;
- the provider is called **at most once** per genuine billing attempt;
- the API-visible status equals the persisted status (`apiAndDbAgree`);
- plan price/currency are applied consistently (asserted on the provider call).

**Avoiding false positives:** every test builds a fresh `TestEnvironment`
(`beforeEach`), so there is no shared/stale state; repositories deep-clone on
read and write so a held reference can never mutate stored rows behind an
assertion; one test explicitly asserts the store starts empty.

## 8. Webhook / idempotency strategy

Two independent layers:

1. **Exact redelivery** — a `event_id` already present in `webhook_events` is a
   no-op (`duplicate_ignored`). The event is recorded *before* side effects, so
   even a no-op outcome is never reprocessed.
2. **Business idempotency / out-of-order** — keyed on **invoice state**, not the
   event id. An already-`paid` invoice cannot be re-paid or failed by a later
   event (even one with a fresh `event_id`), so a stale `payment.failed` arriving
   after `payment.succeeded` cannot regress an active subscription.

`canceled` subscriptions ignore all webhooks — cancellation is irreversible.

## 9. Lifecycle coverage

Valid transitions exercised (unit + e2e): `trialing→active`, `trialing→past_due`,
`trialing→canceled`, `active→past_due`, `active→canceled`, `active→active`
(recurring), `past_due→active`, `past_due→canceled` (retries exhausted),
`past_due→canceled` (cancel).

Proven impossible: `canceled→active` via stray `payment.succeeded`,
`canceled→past_due` via stray `payment.failed`, and re-cancelling a canceled
subscription (409).

## 10. Reliability / failure handling

- duplicate/redelivered webhooks — §8 layer 1, `webhooks/idempotency.spec.ts`
- out-of-order delivery — §8 layer 2, `webhooks/out-of-order.spec.ts`
- provider timeouts & declines — `provider/provider-interaction.spec.ts`
- forged/unsigned webhook signatures — `api/webhooks.contract.spec.ts`
- invalid transitions — `state-machine/invalid-transitions.spec.ts`
- subscription/invoice persistence mismatches — `noContradictoryRecords`

## 11. Known limitations / next steps

- **Concurrency:** the fixture is single-threaded, so the "claim event_id before
  side effects" ordering models idempotency but does not prove it under truly
  parallel delivery. With more time I'd add a repository-level unique constraint
  on `event_id` and a concurrent-delivery test that races two posts of the same
  event.
- **In-memory persistence** trades SQL realism (constraints, transactions) for
  setup speed; the Repository seam is there specifically so a SQLite-backed
  implementation could be dropped in and the suite reused.
- **Scheduler modeled as webhooks:** trial-end and recurring charges arrive as
  webhooks rather than from a real timer. This keeps the suite deterministic; a
  real service would also need tests around the scheduler itself.
- **Single currency / no proration:** intentionally out of scope.
