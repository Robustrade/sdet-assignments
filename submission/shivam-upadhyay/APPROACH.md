# QuarkSek (Kulu) SDET Take-Home — Approach Outline

**Candidate:** Shivam Upadhyay (GitHub: TheShivamUp)
**Repo:** https://github.com/Robustrade/sdet-assignments/ (Kulu SDET Take-Home Assignment)
**Assignment:** Subscription & Billing Service — SDET assignment (SDET_ASSIGNMENT.md)
**Deadline:** Wed 25 Nov 2026 (2 working days from Sushma's mail of 23 Nov)
**Status:** DRAFT for Mark's review — this doc goes into the dummy PR first (Sushma asked for approach before code), full solution follows in the same PR.

## 1. Understanding

A subscription & billing service with no provided implementation — the repo holds only
README.md, SDET_ASSIGNMENT.md and the PR template. So the candidate builds a minimal
service fixture and proves its behaviour at 4 levels: API, state machine, database,
mocked payment provider.

Endpoints: `POST /subscriptions` (create), `GET /subscriptions/{id}`,
`POST /subscriptions/{id}/cancel`, `POST /webhooks/payment-provider` (HMAC-signed,
`X-Provider-Signature` over the raw body). Plans: basic and pro (different price and
trial length). Webhook events: `payment.succeeded`, `payment.failed`, `payment.refunded`.

Lifecycle — only these transitions are valid, everything else is rejected or safely ignored:
- trialing → active (trial ends, first charge succeeds)
- trialing → past_due (trial ends, first charge fails)
- active → past_due (recurring charge fails)
- past_due → active (retry succeeds)
- past_due → canceled (retries exhausted)
- active → canceled, trialing → canceled (customer/API cancel)

Hard rules: cancellation stops future billing and is irreversible via later webhooks;
a `payment.succeeded` for an already-canceled subscription must NOT reactivate it;
a `payment.failed` arriving after `payment.succeeded` for the same invoice must NOT
regress an active subscription; webhook processing is idempotent on `event_id`.

## 2. System under test — Option 3 (Hybrid)

A lightweight TypeScript service fixture (Express-style HTTP, in-memory store that is
queryable) plus test doubles — the payment provider is a mock behind an interface.
In-memory persistence is a deliberate tradeoff: it keeps the fixture runnable anywhere
with no DB setup, and every invariant is still asserted against persisted state via the
repository. A `better-sqlite3` swap is a documented next step, not needed for this scope.

Stack: TypeScript, Node 22, Vitest, Supertest for the HTTP layer, `vi.fn()` for the
provider seam. No real payment provider, no UI, no performance testing.

## 3. Test strategy

Levels: (1) API contract/validation, (2) state machine, (3) database verification,
(4) mock provider + webhook interaction, (5) end-to-end (API/webhook → processing →
persistence/provider). In scope: all 7 valid transitions, at least 2 invalid transitions,
webhook idempotency, validation failures, provider success/decline/timeout.
Out of scope: proration edge cases, multi-currency, taxes, real provider integration,
concurrent/racing webhook delivery (bonus only), UI, dashboards.

Real vs mocked: the service fixture and its store are real (written for this exercise);
the payment provider is mocked (success/decline/timeout configurable, calls recorded);
webhooks are simulated with valid, unsigned and malformed signed payloads.

Order of work: mandatory items first — (D) webhook idempotency and (E) state-machine
invariants — then (A) creation/activation, (B) validation failures, (C) payment failure,
(F) mocked provider, (G) persistence/auditability. Red–Blue–Green throughout.

## 4. Design patterns (only patterns actually present in the code)

- **State machine as an explicit transition table** (+ State pattern where it earns its
  place): illegal transitions are structurally impossible, not just asserted against.
- **Builder** for test data: subscriptions, webhook payloads, customers.
- **Strategy / dependency-injection seam** around the payment provider: the service
  depends on a `PaymentProvider` interface; tests inject the mock/fake.
- **Repository** for persistence access: tests assert persisted state through the
  repository/DAO, never with raw queries inline in test logic.

## 5. API validation approach

Typed API client layer (transport kept out of test logic). Creation/retrieval/
cancellation: response codes, payload shape, validation errors (invalid plan, missing
fields, unknown customer/payment method), canceling an already-canceled subscription.
Webhook handling validated separately from webhook business logic: valid signature,
invalid/forged signature, malformed payload — each rejected before any state change.

## 6. Database validation approach

Entities checked: subscriptions, invoices/payments, webhook_events (processed event IDs
for idempotency), audit/event log per subscription. Invariants asserted at every
lifecycle stage, not just creation:
- never active without at least one successful persisted payment;
- canceled never transitions again, whatever webhook arrives;
- duplicate webhooks never produce duplicate invoices/payments/provider charges;
- mock provider called at most once per genuine billing attempt;
- persisted state always matches the API-visible result;
- plan price/trial rules applied consistently between creation and billing.
Seeding/cleaning per test run so stale data cannot cause false positives.

## 7. Mock provider & webhook validation

Provider mock records every call; assertions on call count AND arguments (amount,
customer, idempotency/reference) — not just "called". Not called for actions needing no
charge (rejected creation, replayed webhook). Webhook simulator builds signed, unsigned
and malformed payloads. Idempotency proven by delivering the same `event_id` twice and
asserting exactly one transition, one invoice/payment row, no duplicate side effect.
Out-of-order/stale delivery: a late `payment.failed` for an already-succeeded invoice
does not regress state.

## 8. Test architecture

```
submission/shivam-upadhyay/
  src/            # minimal service fixture (routes, lifecycle, store, provider seam)
  tests/
    fixtures/     # seed data, env setup, mock provider injection, run isolation
    api/          # typed client
    mocks/        # mock provider + webhook simulator
    assertions/   # API, persisted-state, mock-interaction, state-machine checks
    scenarios/    # lifecycle, webhooks, validation, provider interaction
    builders/     # test-data builders
  APPROACH.md     # this document
  README.md       # how to run
```

## 9. Validation

`npm test`, `npm run build` / `tsc --noEmit`, lint. Author checklist from the PR
template is verified before the final PR: every valid transition exercised, at least
two invalid transitions proven impossible, idempotency tested, README tested from a
clean setup.

## 10. Known limitations / next steps

In-memory store instead of a real DB; no proration/multi-currency/taxes; no real
provider; concurrency/racing webhooks not covered (bonus). With more time: swap in
`better-sqlite3`, add racing-webhook tests, contract tests for plan config.

## 11. Responsible AI usage (to be stated honestly in the PR)

AI tools helped draft this approach document and scaffold the fixture/tests. I
personally reviewed, corrected and validated the design, every test, and the final PR —
the test-engineering judgment (what to cover, what is in/out of scope, which
invariants matter) is mine.

## 12. Plan (3–5 hours, per side-chat plan)

1. Setup (30 min) — fork, clone, stack pick. 2. Dummy PR with this doc FIRST
(45–60 min). 3. Design decisions (30 min). 4. Fixture + skeleton (60 min).
5. Tests (90–120 min, D + E first). 6. Verify + final PR (60 min).
