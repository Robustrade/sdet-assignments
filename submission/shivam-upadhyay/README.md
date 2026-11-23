# Subscription & Billing Service — Automated Test Solution

A test solution for the Kulu SDET take-home (QuarkSek Technologies). It tests a
Subscription & Billing Service across four layers — API, state machine, database
(in-memory store), and a mocked payment provider — with end-to-end scenarios,
retries/duplicates/partial failures, and API-vs-DB consistency.

**Author:** Shivam Upadhyay (GitHub: TheShivamUp)

## How to run

```bash
npm install
npm test        # 45 tests, Vitest + Supertest
npm run build   # tsc --noEmit (typecheck)
npm run lint    # ESLint (typescript-eslint recommended)
```

Verified from a clean checkout: fresh `npm install` → build, lint, and all 45 tests green.

## Design

- **State machine:** one explicit transition table (`src/lifecycle.ts`) is the only
  path that can move a subscription. Valid transitions: trialing→active (first
  charge succeeds), trialing→past_due (first charge fails), active→past_due
  (recurring charge fails), past_due→active (retry succeeds), past_due→canceled
  (retries exhausted, 3), active→canceled and trialing→canceled (API cancel).
  Anything else is rejected or safely ignored — including canceled→active,
  canceled→past_due, and a late `payment.failed` for an already-paid invoice.
- **Provider seam:** the service depends only on the `PaymentProvider` interface
  (`src/provider.ts`); tests inject a configurable mock that records every call
  (arguments + count). The mock is never called for rejected creations or
  replayed webhooks.
- **Webhooks:** HMAC-SHA256 over the raw body, timing-safe compare, verified
  before any business logic; invalid/missing signatures fail closed (401).
  Duplicate `event_id` deliveries are acknowledged and ignored — exactly one
  transition, one invoice, no duplicate side effects.
- **Persistence:** in-memory store behind Repository classes; tests assert
  through the store and an assertion layer, never raw inline queries. Every
  transition is written to a queryable audit log.
- **Plans:** basic $19/month (14-day trial), pro $49/month (7-day trial).
- **Builders:** `CreateSubscriptionBuilder`, `WebhookPayloadBuilder`, and a typed
  API client keep test data explicit and reusable.

## Test inventory (45 tests, 8 files)

| File | Area | Tests |
|---|---|---|
| `tests/scenarios/lifecycle.test.ts` | E — state-machine invariants | 10 |
| `tests/scenarios/webhooks.test.ts` | D — idempotency & webhook handling | 8 |
| `tests/scenarios/validation.test.ts` | B — validation failures | 8 |
| `tests/scenarios/creation.test.ts` | A — creation & activation | 6 |
| `tests/scenarios/provider.test.ts` | F — mocked provider | 5 |
| `tests/scenarios/persistence.test.ts` | G — persistence & auditability | 4 |
| `tests/scenarios/payment-failure.test.ts` | C — payment failure | 3 |
| `tests/scenarios/e2e.test.ts` | Full journey, all layers | 1 |

Mandatory areas (D) idempotency and (E) state-machine invariants are covered
first and most deeply; every valid transition has its own test, and at least two
invalid transitions are proven impossible.

## Assumptions worth knowing

- **Trial end is driven by the billing service** (`BillingService.processTrialEnds()`),
  not by an HTTP endpoint — the spec lists only four endpoints, so the fixture
  keeps its HTTP surface exactly to those. Tests advance a controllable clock.
- **Cancel is allowed only from trialing/active**, per the assignment's closed
  lifecycle list; cancel from past_due returns 409.
- **Webhook secret is test-only** (`whsec_test_secret`); real deployments must
  inject it from the environment.
- **Retries:** 3 attempts on past_due, then canceled.

## Responsible AI Usage

This solution was drafted with AI assistance (Muse): the AI wrote the fixture
and test drafts from the approved approach and design documents, and ran the
full verification (typecheck, lint, 45 tests, clean-setup check). The candidate
personally reviewed the code, the test design, and the results before
submission, and corrected what did not match his judgment.
