# Subscription & Billing Service
## SDET Automation Approach
**Candidate:** Prarthana Huparikar

---

## 1. Understanding of the System

The system under test is a Subscription & Billing Service where a subscription moves through multiple lifecycle states such as `trialing`, `active`, `past_due`, and `canceled`.

The state of a subscription can change through:
1. Direct API operations such as subscription creation or cancellation.
2. Asynchronous webhook events received from an external payment provider.

Because this is a stateful transactional system, my test strategy will focus not only on validating individual API responses but also on verifying the complete workflow across:
- API behavior
- Subscription state transitions
- Database persistence
- Payment provider interactions
- Webhook processing
- Idempotency and duplicate requests
- Failure and retry scenarios

The objective is to verify that the API-visible subscription state, persisted database state, and payment processing state remain consistent throughout the subscription lifecycle.

---

## 2. System Under Test Approach

I am choosing **Option 3 — Hybrid**: a lightweight subscription/billing service fixture (TypeScript/Node.js, in-memory or `better-sqlite3` persistence) plus a fully mocked payment provider.

Rationale:
- No real service is provided, so a minimal fixture is required to have something concrete to test against.
- A hybrid approach keeps the fixture just complex enough to expose real state-machine and persistence behavior, without spending assignment time building unrelated product features (auth, billing edge cases, multi-currency, etc. — explicitly out of scope per the assignment's Non-Goals).
- Keeping persistence embedded/queryable (in-memory store or `better-sqlite3`) means DB-level assertions can run directly in the test suite without external infrastructure.

**What is real vs. mocked:**
| Component | Real or Mocked | Why |
|---|---|---|
| Subscription/billing API | Real (fixture I build) | Needed to exercise actual request/response and state-machine logic |
| Database/persistence layer | Real (in-memory / better-sqlite3) | Needed to assert persisted state, not just API responses |
| Payment provider | Mocked (interface + fake implementation) | Assignment explicitly requires this be mocked, not a real network call, with configurable success/decline/timeout outcomes |
| Webhook delivery | Simulated by the test suite | Tests construct signed (and deliberately invalid) payloads and POST them to the webhook endpoint directly |

---

## 3. Scope of Automation

**In scope:**
- API contract and validation tests (creation, retrieval, cancellation, webhook endpoint)
- State-machine tests covering every valid transition in the lifecycle diagram, plus at least two proven-invalid transitions
- Database verification tests (subscriptions, invoices/payments, webhook_events)
- Mock payment provider interaction tests (call count, call arguments, success/decline/timeout behavior)
- Webhook idempotency and duplicate-delivery tests
- End-to-end flow tests (API/webhook → processing → persistence → provider interaction)

**Out of scope (per assignment Non-Goals):**
- Frontend/UI
- Real payment provider integration
- Performance/load testing
- Production monitoring/dashboards
- Proration, multi-currency, tax edge cases
- Concurrent/racing webhook delivery — treated as a bonus if time allows, not a mandatory category

---

## 4. Design Patterns Applied

| Pattern | Where | Problem It Solves |
|---|---|---|
| **State pattern / explicit transition table** | Subscription lifecycle (`trialing → active → past_due → canceled`) | Makes illegal transitions structurally unreachable instead of a `status` string mutated ad hoc from multiple call sites |
| **Builder** | Test data construction (subscriptions, customers, webhook payloads) | Lets scenarios read as intent ("a trialing pro-plan subscription with a failed first charge") instead of repeated object literals |
| **Strategy / Adapter (dependency injection)** | Payment provider client | Lets tests substitute a mock/fake implementation instead of making real network calls; the fixture depends on an interface, not a concrete provider |
| **Repository** | Persistence access layer | Centralizes DB reads/writes behind typed methods instead of raw queries scattered across test files, and is what the assertion/verification layer calls into |

I will only claim a pattern in the PR description if it's genuinely present in the code — the assignment flags this explicitly as a red flag otherwise.

---

## 5. API Contracts Covered

```
POST   /subscriptions              create a subscription for a customer + plan
GET    /subscriptions/{id}
POST   /subscriptions/{id}/cancel
POST   /webhooks/payment-provider  inbound event from the external payment provider
```

Validated per endpoint:
- success response shape and status codes
- validation errors (invalid plan, missing/invalid customer or payment method, unknown customer)
- cancellation of an already-canceled subscription (rejected, not silently accepted)
- webhook signature validation (`X-Provider-Signature` — valid, invalid, missing)
- malformed webhook payloads

---

## 6. Database Entities Checked

- `subscriptions` — current state, plan, timestamps
- `invoices` / `payments` — one record per genuine billing attempt, correct amount/status
- `webhook_events` — every processed `event_id`, used to prove idempotency (duplicate deliveries recorded but not double-processed)
- audit/event log per subscription (if modeled separately)

Invariants asserted:
- a subscription never reaches `active` without at least one successful, persisted payment record
- a `canceled` subscription never transitions again, regardless of subsequent webhooks
- duplicate webhook delivery never produces duplicate invoices, payments, or provider charges
- persisted state always matches the API-visible result at every stage — never just checked at creation

Test data is seeded per test run and isolated (fresh in-memory store or transaction rollback per test) to avoid false positives from stale data between runs.

---

## 7. Webhook / Idempotency Strategy

- Each inbound webhook is keyed by `event_id`. The `webhook_events` table is checked before applying any state change.
- If `event_id` has already been processed, the webhook is acknowledged but produces no state transition, no new invoice/payment row, and no duplicate side effect.
- Out-of-order delivery is explicitly tested: a `payment.failed` arriving after a `payment.succeeded` for the same invoice must not regress an already-active subscription.
- Signature validation happens before any business logic runs; invalid/missing signatures are rejected outright.

---

## 8. Known Limitations

- The service fixture is intentionally minimal — it exists to demonstrate test strategy, not to be production billing logic.
- Concurrent/racing webhook delivery is treated as a bonus per the assignment and may not be fully covered depending on time remaining after mandatory categories.
- Only two plan tiers (`basic`, `pro`) are modeled; broader plan/pricing logic is out of scope.
- Proration, multi-currency, and tax handling are explicitly excluded, per the assignment's Non-Goals.

---

## 9. Responsible AI Usage

*(To be filled in as the solution is built — will document which parts were AI-assisted, which were written/reviewed manually, and what was corrected from AI-generated output before the final PR is submitted.)*
