# Subscription & Billing: validation suite

An object-oriented test framework, plus a small service fixture, for a subscription billing workflow:
`trialing → active → past_due → canceled`, driven by API calls, a billing job, and payment-provider
webhooks that can arrive late, twice, out of order or forged.

The design notes written before implementation are in [APPROACH.md](./APPROACH.md).

## Run it

Requires Node 18.18+ (`.nvmrc` pins 18). No database or network needed: SQLite runs in-process (sql.js / WebAssembly).

```bash
npm ci
npm run lint                       # eslint (TS + JS)
npm run build                      # tsc --noEmit
npm test                           # full suite (117 tests, ~6s)
npm run test:reliability           # duplicates, ordering, timeouts, partial failures, concurrency, property test
node scripts/validate_schema.js    # schema loads and its constraints really fire
npm run test:mutation              # plants 18 known bugs, checks the suite catches them (~1.5 min)
```

Useful while developing:

```bash
npx jest tests/lifecycle                     # one area
npx jest -t "retries exhausted"              # one scenario by name
PROPERTY_RUNS=500 npx jest tests/properties  # longer random exploration
node scripts/mutation_check.js webhook       # only mutants whose id contains "webhook"
```

## What is real and what is a double

| Part | Status | Notes |
|---|---|---|
| HTTP API (Express) | real | driven in-process via Supertest, one listening server per test |
| Lifecycle, plan rules, webhook handling, billing job | real | the code under test (`src/`) |
| Database | real SQLite, in memory | fresh per test, built from `src/persistence/schema.sql` |
| Webhook signatures | real HMAC-SHA256 over raw bytes, constant-time compare | |
| Payment provider (outbound charges) | **test double** `ScriptedPaymentGateway` | scripted success / decline / timeout; records every call; honours idempotency keys like a real provider |
| Webhook delivery (inbound) | **simulated** `WebhookSender` | signs, forges, tampers, redelivers, reorders |
| Time | **fake** `FakeClock` | trial ends and retries without sleeping |

## Layout

```
src/                         service fixture (deliberately small)
  domain/                    lifecycle table, invoice lifecycle, plan strategies, types
  payments/PaymentGateway.ts the seam to the external provider
  persistence/               schema.sql, SqlDatabase wrapper, repositories
  services/                  SubscriptionService, BillingEngine, WebhookService, PaymentOutcomes
  http/app.ts                routes + error mapping
  container.ts               composition root (wires real or test implementations)

tests/framework/             the test framework
  TestHarness.ts             Factory: isolated world per test. env.api, env.webhooks (inbound), env.gateway
                             (outbound charges), env.given, env.stored(id), env.tablesChangedSince(snapshot)
  fixtures.ts                seed data, plan constants, date helpers (no magic numbers in specs)
  useHarness.ts              Jest wiring; runs the InvariantChecker after every test
  LifecycleDriver.ts         `env.given.*`: setup steps that reach each state through real behaviour only
  api/                       typed API client + webhook sender; every response contract-checked (zod)
  builders/                  Builders for customers, signup requests, webhook payloads
  doubles/                   ScriptedPaymentGateway, FakeClock, FailingAuditLog (fault injection)
  verify/                    InvariantChecker (one method per INV-n), SubscriptionRecord, DbSnapshot, expectError

tests/<area>/*.spec.ts       scenarios, grouped by concern (see matrix below)
scripts/                     validate_schema.js, mutation_check.js
```

## Design patterns, and the problem each one solves

| Pattern | Where | Problem it solves |
|---|---|---|
| State machine (transition table keyed by state + trigger) | `src/domain/lifecycle.ts` | One place decides legal moves. Its output (`ApprovedTransition`) is the only thing `SubscriptionRepository.applyTransition` accepts, so there is no way to write a status string directly. |
| Strategy | `src/domain/plans.ts` (`BasicPlan`, `ProPlan`) | Price, trial length, retry budget and back-off differ per plan; no `if (plan === 'pro')` anywhere. |
| Interface + dependency injection | `src/payments/PaymentGateway.ts`, `src/container.ts` | Service depends on an interface; tests inject `ScriptedPaymentGateway`. |
| Repository | `src/persistence/repositories.ts` | All reads and writes, for the service and for test verification, go through typed repositories. No SQL in specs. |
| Builder | `tests/framework/builders` | `aSignupRequest().onProPlan().forCustomer(...)`, `aWebhook().paymentFailed().forInvoice(...)`: scenarios read as intent. |
| Factory | `TestHarness.create()`, `buildBillingService()` | One call builds a fully isolated, correctly wired world; tests can swap a single part (e.g. a failing audit repository). |

## Invariants checked after every test

`InvariantChecker` reads every table through the repositories, plus the provider double's ledger:

| Id | Invariant |
|---|---|
| INV-1 | `active` only with at least one successful, persisted charge |
| INV-2 | `canceled` is terminal: no status change, attempt, provider call or open invoice afterwards |
| INV-3 | `past_due` has an open invoice with at least one failure |
| INV-4 | `trialing` has no paid invoice |
| INV-5 | plan price = subscription price = invoice amount = attempt amount |
| INV-6 | invoice status agrees with its attempts (paid ⇔ exactly one success; failure counter matches; uncollectible only after the full retry budget) |
| INV-7 | audit log is a gap-free SHA-256 hash chain that replays to the current status |
| INV-8 | every provider call maps to a persisted attempt with the same amount; captured money is never on a "declined" attempt |
| INV-9 | captured money sits on a paid/refunded invoice or is explicitly flagged for refund |
| INV-10 | no attempt left `pending` when nothing is in flight |
| INV-11 | every recorded transition is one of the 7 in the spec (list written independently of the service) |

`tests/persistence/invariant-checker.spec.ts` corrupts the database on purpose and checks the checker names
each problem, so a green run actually means something.

## Requirement → test traceability

| Requirement (SDET_ASSIGNMENT.md) | Where it is proven |
|---|---|
| API: create / get / cancel, codes, payload shape | `tests/api/*` (+ zod contracts on every response) |
| Validation: unknown plan, missing fields, unknown customer, bad payment method, double cancel | `tests/api/create-subscription.spec.ts`, `get-and-cancel.spec.ts` (each asserts no DB change and no provider call) |
| Webhook: valid / missing / forged / tampered signature, malformed payload | `tests/webhooks/request-handling.spec.ts` |
| All 7 valid transitions | `tests/lifecycle/transitions.spec.ts` (each via billing job, some also via webhook) |
| ≥2 invalid transitions impossible | 16-cell table in `tests/unit/domain-rules.spec.ts`; 16-cell stimulus × state matrix over HTTP in `tests/lifecycle/transitions.spec.ts` |
| Plan rules (trial length, price) | `tests/lifecycle/plan-rules.spec.ts` |
| Failed charge → past_due, failure recorded, no success record | `tests/provider/charge-interaction.spec.ts` › outcomes |
| Duplicate delivery: one transition, no duplicate rows, side effect once | `tests/reliability/duplicate-delivery.spec.ts` |
| `failed` after `succeeded` does not regress | `tests/reliability/out-of-order.spec.ts` |
| Provider called once per attempt, not for rejected / replayed / cancel; exact arguments | `tests/provider/charge-interaction.spec.ts` |
| Success / decline / timeout | `tests/provider/*`, `tests/reliability/timeouts-and-partial-failures.spec.ts` |
| Persistence matches API at every stage | `tests/e2e/customer-journeys.spec.ts`, `tests/persistence/stored-state.spec.ts`, property P4 |
| No contradictory records | InvariantChecker (every test) |
| Concurrent webhooks (bonus) | `tests/reliability/concurrency.spec.ts` |
| Partial failures | `tests/reliability/timeouts-and-partial-failures.spec.ts` |

## Assumptions

- `basic`: $19/month, 14-day trial, 3 attempts, retry every 3 days. `pro`: $49/month, no trial (charged at signup), 4 attempts, back-off 1/3/5 days. Months are 30 days.
- A no-trial plan is modelled as a zero-length trial, so its first charge uses the same `trialing → active | past_due` transitions as everyone else.
- A provider **timeout** leaves the outcome unknown: no state change, no retry budget spent. The next billing run re-sends with the **same** idempotency key; a webhook can settle it first.
- `payment.refunded` marks a paid invoice refunded but does not change subscription status (the spec defines no such transition).
- `past_due → canceled` happens only when retries run out. A customer cancel while `past_due` is rejected with 409, because the lifecycle diagram doesn't include it.
- Webhooks that are authentic but don't match our records (unknown invoice, amount mismatch, already-paid invoice, canceled subscription) get **200** so the provider stops retrying. They are stored as `ignored` with a reason.

## Known limitations

- One process and one SQLite connection. The concurrency tests prove correctness when async requests interleave on one instance. They say nothing about multiple instances sharing a database (that would need row locks or `SELECT … FOR UPDATE` on a server database).
- A webhook with no `charge_id`, for an invoice whose charge timed out, is assumed to be about that timed-out attempt. If the provider can send events without charge ids, that guess can be wrong. A real integration should match on a provider reference tied to our idempotency key.
- A charge captured after the customer canceled is flagged `refund_required` but not refunded automatically.
- No webhook timestamp or replay-window check: a validly signed old event is accepted once, then deduplicated.
- No proration, plan changes, taxes or multiple currencies.
