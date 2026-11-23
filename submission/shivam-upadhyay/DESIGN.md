# QuarkSek (Kulu) SDET Take-Home — Design Decisions (Phase 3)

**Candidate:** Shivam Upadhyay (GitHub: TheShivamUp)
**PR:** https://github.com/Robustrade/sdet-assignments/pull/118 (dummy PR, approach doc live)
**Status:** APPROVED by Mark 23 Nov 13:12 IST — assumptions confirmed (basic $19/14-day trial, pro $49/7-day trial, 3 retries then canceled, pro starts in trialing).
**Implemented:** 23 Nov 13:14–13:20 IST — fixture + test suite drafted per this doc (45 tests, all green). Awaiting Mark's review before push.
**Deadline:** Wed 25 Nov 2026.

## 1. Decisions already fixed (from the approach doc)

- SUT: **Option 3 (Hybrid)** — lightweight TypeScript service fixture + mocked payment provider.
- Stack: TypeScript, Node 22, Vitest, Supertest; in-memory queryable store (better-sqlite3 is a documented next step, not now).
- Patterns: explicit transition table (state machine), Builder, provider DI seam, Repository.
- Order: mandatory (D) idempotency + (E) state-machine invariants first, then A, B, C, F, G.

## 2. State machine — transition table (the single source of truth)

Valid transitions only; anything else is rejected or safely ignored:

| From | Event | To |
|---|---|---|
| trialing | trial ends, first charge succeeds | active |
| trialing | trial ends, first charge fails | past_due |
| active | recurring charge fails | past_due |
| past_due | retry charge succeeds | active |
| past_due | retries exhausted | canceled |
| active | cancel via API | canceled |
| trialing | cancel via API | canceled |

Invalid transitions to prove impossible (at least 2 required):
- canceled → active via a stray `payment.succeeded` webhook
- canceled → past_due via a stray `payment.failed` webhook
- active → trialing (no backward transition)
- `payment.failed` arriving after `payment.succeeded` for the same invoice must NOT regress active → past_due

Enforcement: one explicit transition table in the fixture; every state change goes
through a single `transition()` guard that rejects anything not in the table. Illegal
transitions are structurally impossible, not just asserted against in tests.

## 3. Plans (assumption — confirm)

- basic: $19/month, 14-day trial → starts in `trialing`.
- pro: $49/month (matches the assignment example amount 4900 cents), 7-day trial →
  starts in `trialing`; per plan config a plan may charge immediately instead.
- Trial end is simulated with an injectable clock / Vitest fake timers — no real waiting.

## 4. Payment provider seam

```ts
interface PaymentProvider {
  charge(req: ChargeRequest): Promise<ChargeResult>; // success | decline | timeout
}
interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}
```

The service depends only on the interface; tests inject a configurable fake
(success / decline / timeout) that records every call (arguments + count).
Assertions check call count AND arguments (amount, customer, idempotency key) —
never just "called". The mock is NOT called for rejected creations or replayed webhooks.

## 5. Webhooks

- Endpoint: `POST /webhooks/payment-provider`, header `X-Provider-Signature`
  (HMAC over the raw body, Node `crypto`, timing-safe compare).
- Signature validation happens BEFORE any business logic: valid → process;
  invalid/forged/malformed → reject, no state change, no persistence, no provider call.
- Idempotency: every processed `event_id` is recorded in `webhook_events`;
  a duplicate delivery is a no-op (exactly one transition, one invoice/payment row,
  no duplicate side effect). Check-before-process.
- Retry policy (assumption): 3 retries on `past_due`, then `canceled`.

## 6. Persistence — repositories (no raw queries in tests)

- `SubscriptionRepository`: save / find subscription by id.
- `InvoiceRepository`: save / find invoices by subscription.
- `WebhookEventRepository`: record + `hasProcessed(event_id)`.
- `AuditLog`: append + list events per subscription (queryable history).
- Invariants asserted at every stage: never active without a successful persisted
  payment; canceled never transitions again; persisted state always matches the
  API-visible result; plan price/trial rules consistent between creation and billing.
- Seeding + cleaning per test run so stale data cannot cause false positives.

## 7. Builders

- `SubscriptionBuilder`: customerId, plan, paymentMethodId, initial state.
- `WebhookPayloadBuilder`: eventId, type, subscriptionId, invoiceId, amount,
  currency; signature valid / invalid / absent.
- `CustomerBuilder` / plan fixtures as needed.

## 8. Module layout (matches the scaffold already built)

```
submission/shivam-upadhyay/
  src/
    app.ts                 # HTTP fixture: routes for subscriptions + webhooks
    lifecycle.ts           # transition table + guard
    store.ts               # in-memory store (subscriptions, invoices, events, audit)
    provider.ts            # PaymentProvider interface
    mockProvider.ts        # configurable fake (only used by tests)
    webhookVerify.ts       # HMAC signature verification
  tests/
    fixtures/ api/ mocks/ assertions/ scenarios/ builders/   # as scaffolded
```

## 9. Test inventory (names = what each test proves)

- **D — Idempotency (mandatory):** duplicate `payment.succeeded` (same `event_id`) →
  one transition, one invoice; duplicate `payment.failed` → no duplicate rows;
  replayed webhook → provider NOT called again.
- **E — State-machine invariants (mandatory):** one test per valid transition (7);
  canceled → active impossible; canceled → past_due impossible;
  failed-after-succeeded does not regress active.
- **A — Creation & activation:** basic starts trialing; pro per plan config; mock
  called with correct amount/customer/method; persisted records agree with API.
- **B — Validation failures:** unknown plan; missing fields; unknown customer /
  payment method; cancel already-canceled — correct response AND no invalid
  persistence or provider calls.
- **C — Payment failure:** failed charge → past_due (not active/canceled); no
  success record; failure recorded.
- **F — Mocked provider:** exactly once per genuine billing attempt; assert
  arguments; not called for rejected creation or replayed webhook.
- **G — Persistence / auditability:** records match API at every stage; no
  contradictory records (e.g. active with only a failed invoice).

## 10. Open points — CONFIRMED by Mark 23 Nov 13:12 IST

- Plans: basic $19/14-day trial, pro $49/7-day trial — confirmed.
- Retry policy: 3 retries then canceled — confirmed.
- Pro starts in trialing (not immediate charge) — confirmed.
