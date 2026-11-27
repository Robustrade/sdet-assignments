# Approach — Subscription & Billing Service validation suite

Author: Shubham Ladhe
Status: written before implementation; section 11 records what changed once the code existed.
How to run and the final layout: see [README.md](./README.md).

---

## 1. My understanding of the problem

The thing under test is a small, stateful billing workflow. A subscription moves through
`trialing → active → past_due → canceled`, and those moves are triggered from two directions:

- synchronous API calls (create, cancel) and the billing job charging the customer, and
- asynchronous webhooks from a payment provider that can arrive late, twice, out of order, or forged.

The hard part is not the endpoints, it is keeping three things consistent with each other at every
step: what the API says, what is in the database, and what we actually asked the payment provider
to do. Most of the bugs that hurt in a real billing system live in the gaps between those three
(double charge on redelivery, a stale `failed` event downgrading a paid customer, a canceled
subscription quietly reactivated). The suite is designed around proving those gaps are closed.

## 2. System under test — approach chosen

No service is provided, so I am going with **Option 3 (hybrid)**:

- a deliberately small Express + TypeScript service fixture under `src/`, with real business rules,
  a real embedded SQL database and real HMAC signature verification;
- the payment provider replaced by a test double behind an interface;
- the test framework under `tests/` that drives the service over HTTP and verifies the database,
  the provider double and the audit trail.

The service is kept intentionally thin. It exists so the tests have something honest to fail
against, not to be a product.

### Real vs. test double

| Component | Real or double | Why |
|---|---|---|
| HTTP layer (Express routes, JSON parsing, status codes) | Real, in-process via Supertest | Contract and error handling are part of what is being validated; no network or ports needed |
| Lifecycle rules, plan rules, webhook handling | Real | This is the logic under test |
| Database | Real SQLite (sql.js, in memory, one fresh DB per test) | Constraints (`UNIQUE`, `CHECK`, FK) and transactions are part of the idempotency story; an in-memory Map can't prove those |
| Webhook signature verification | Real HMAC-SHA256 over the raw body, constant-time compare | Faking it would make the signature tests meaningless |
| Payment provider (outbound charge) | **Test double** implementing `PaymentGateway` | External dependency; tests must control success / decline / timeout and assert on exact calls |
| Webhook delivery (inbound) | **Simulated** by the test suite, signing payloads with the shared secret | Lets tests send valid, forged, malformed, duplicate and reordered events on purpose |
| Time | **Fake clock** injected into the service | Trial end and retry schedules become deterministic, no sleeps |

## 3. Domain assumptions

- Two plans, each defined in one place (Strategy):
  - `basic` — $19.00 / month (1900 cents), 14-day trial, up to 3 charge attempts per invoice.
  - `pro` — $49.00 / month (4900 cents), no trial, charged immediately at creation, up to 4 attempts.
- Amounts are integer cents, currency `USD` only.
- Customers and payment methods are seeded reference data. Creating a subscription for an unknown
  customer, or with a payment method that doesn't belong to that customer, is a 4xx with no side effects.
- Billing outside of creation (trial end, renewals, retries) is done by an internal `BillingRunner`
  job, not exposed over HTTP. Tests advance the fake clock and run the job, the same way a cron would.
- Every charge attempt sends the provider an idempotency key. A retry after a **decline** is a new
  attempt with a new key. A retry after a **timeout** reuses the same key, because we don't know if the
  first one went through. A timeout leaves the attempt in `unknown`; a later webhook settles it.
- Webhooks carry `event_id`, `type`, `subscription_id`, `invoice_id`, `amount`, `currency`, and the
  provider's `charge_id` when there is one.
- `payment.refunded` marks the invoice refunded and is recorded/audited, but does not change the
  subscription state (the spec does not define a refund transition; I won't invent one).
- Once an invoice is `paid`, a later `payment.failed` for that invoice is stale and is ignored
  (recorded as ignored, no state change).
- `canceled` is terminal. Any further webhook for that subscription is recorded and ignored.

## 4. Lifecycle model

The state machine is a single transition table keyed by **(current state, trigger)**, not just by
target state, so "which event is allowed to cause which move" is explicit:

| From | Trigger | To |
|---|---|---|
| trialing | trial ended + charge succeeded | active |
| trialing | trial ended + charge failed | past_due |
| trialing | cancel requested | canceled |
| active | renewal charge failed | past_due |
| active | cancel requested | canceled |
| past_due | retry charge succeeded | active |
| past_due | retries exhausted | canceled |

Every other (state, trigger) pair is invalid. Through the API it is rejected (e.g. 409 for cancel on
a canceled subscription); through a webhook it is acknowledged with 200 (so the provider stops
retrying) but recorded as `ignored` with a reason, and nothing else changes.

Status is only ever changed through the state machine; the repository will not accept a status
update that doesn't come from it. That makes an illegal transition hard to write, not just untested.

Invoices get their own small state machine (`open → paid | uncollectible`, `paid → refunded`),
which is what stops a late `failed` from overwriting a `paid`.

## 5. Design patterns and why

| Pattern | Where | Problem it solves here |
|---|---|---|
| State machine (transition table) | `src/domain/lifecycle` | One place that decides legal moves; API and webhook paths both go through it |
| Strategy | `src/domain/plans` | Price, trial length and retry budget per plan without `if (plan === 'pro')` branches |
| Interface + dependency injection (Adapter seam) | `src/payments/PaymentGateway` | Service depends on an interface; tests inject a scriptable double |
| Repository | `src/persistence` | All DB access, for the service and for test verification, goes through typed repositories, no raw SQL in tests |
| Builder | `tests/framework/builders` | Subscriptions, customers and webhook payloads built from readable defaults + overrides |
| Factory | `tests/framework/TestHarness` | One call builds an isolated app + DB + clock + gateway double + clients for each test |

I'll only list a pattern in the final PR if it's in the code and doing a job.

## 6. Persistence — entities and invariants

Tables: `customers`, `payment_methods`, `subscriptions`, `invoices`, `charge_attempts`,
`webhook_events`, `audit_log`.

Constraints doing real work:

- `webhook_events.event_id` is `UNIQUE` — a redelivered event cannot be stored twice.
- `charge_attempts.idempotency_key` is `UNIQUE` — the service cannot record two charges for one key.
- One open invoice per subscription per billing period (`UNIQUE(subscription_id, period_start)`).
- `CHECK` constraints on status enums and on `amount > 0`.
- `audit_log` has a per-subscription sequence number (`UNIQUE(subscription_id, seq)`).
- Webhook handling runs inside a transaction: event row, invoice update, subscription update and
  audit entry commit together or not at all.

Invariants checked **after every test**, by an `InvariantChecker` that reads through the repositories:

1. An `active` subscription has at least one `paid` invoice.
2. A `canceled` subscription has no audit entries (and no charge attempts) after its cancel entry.
3. No two charge attempts share an idempotency key; no event_id appears twice.
4. Every invoice amount matches the plan price of its subscription.
5. Every subscription status change has exactly one audit entry, and audit sequence numbers have no gaps.
6. The subscription's current status equals the `to` state of its last audit entry.
7. Number of calls the gateway double received equals the number of charge attempts persisted.

The checker itself is tested by deliberately corrupting rows and asserting it reports them, so a
green run means something.

Isolation: each test gets a new in-memory database built from `schema.sql` and seeded through
builders, so there's no shared or stale data to produce false positives, and no cleanup to forget.
Tests that assert on "nothing changed" snapshot row counts before the action and compare after.

## 7. Webhook strategy

Request-level (handled before any business logic, tested separately):

- missing `X-Provider-Signature` → 401
- signature computed with the wrong secret, or body changed after signing → 401
- malformed JSON / missing required fields / unknown `type` → 400
- none of the above writes a `webhook_events` row or touches any other table

Business-level:

- first delivery of an event → processed, `webhook_events` row with outcome `processed`
- same `event_id` again → 200, no state change, no new invoice/attempt/audit row, not reprocessed
- event that is valid but not applicable (e.g. `payment.succeeded` on a canceled subscription,
  `payment.failed` after the invoice is paid) → 200, stored with outcome `ignored` + reason, no other change

## 8. Test plan

Structure:

```
tests/
  framework/      harness (factory), API client, gateway double, webhook sender,
                  builders, repositories-backed verifiers, invariant checker
  api/            contract + validation (create / get / cancel), response schemas
  webhooks/       signature + payload handling (request level)
  lifecycle/      every valid transition, every invalid (state, trigger) pair
  provider/       call count + exact arguments, success / decline / timeout
  persistence/    DB state at each lifecycle stage, constraint enforcement
  reliability/    duplicates, out-of-order, timeout reconciliation, concurrent delivery
  e2e/            full journeys: create → trial end → fail → retry → active → cancel
  properties/     randomised event sequences vs. a reference model
```

Highlights beyond the basic checklist:

- **Full lifecycle matrix**: the 7 valid transitions and all invalid (state, trigger) pairs, generated
  from one table and driven through HTTP. Each case checks the stored row, the audit log and the
  gateway call log, not only the response.
- **Property-based test** (fast-check): random sequences of creates, cancels, billing runs and
  webhooks, including duplicates, reordering and stale events. After each step the service is
  compared with a tiny reference model and all invariants are checked.
- **Timeout reconciliation**: charge times out → attempt `unknown` → retry reuses the key → late
  webhook settles it → exactly one charge.
- **Concurrent delivery**: the same webhook delivered in parallel, and a success racing a failure;
  plus one test that shows the DB constraint, not timing luck, is what stops the duplicate.
- **Response contracts**: every response parsed against a schema inside the API client, so a
  contract break fails every test that touches it.

Red → Blue → Green: for each behaviour I write the scenario first against the client/verifiers,
watch it fail, add the minimum service support, then refactor the framework (builders, verifiers)
while keeping it green. The commit history should show that order.

## 9. Tooling and CI fit

TypeScript, Node 18+, Jest + ts-jest, Supertest, sql.js, zod, fast-check, ESLint.

Scripts the repository's PR checks expect, all of which will exist and pass:

- `npm run lint`
- `npm run build` (`tsc --noEmit`)
- `npm test`
- `npm run test:reliability` (the reliability + property suites)
- `node scripts/validate_schema.js` — loads `schema.sql` into a fresh database and checks the
  expected tables, columns, constraints and indexes are present

Also: `npm run test:mutation`. Originally planned with Stryker; replaced by a small dependency-free
script that plants 18 hand-picked billing bugs, one at a time, and checks the suite fails (see section 11).

## 10. Known limitations (expected)

- Single-process service; "concurrency" means concurrent async requests against one process and one
  SQLite connection, not multiple service instances. I'll call out what that does and doesn't prove.
- No real payment provider, no real network calls, no real scheduler.
- Billing scope is fixed monthly pricing: no proration, plan changes mid-cycle, tax, or multi-currency.
- Notifications are modelled only as a recorded side effect (to prove "fires once"), not sent anywhere.

## 11. What changed during implementation (test-first log)

The suite was built scenario by scenario: test first, then just enough service support, then tidy-up.
These are the cases where a test found something:

| Found by | What it found | Fix |
|---|---|---|
| `stored-state.spec` (cancel voids invoice) | After a customer canceled, the billing job still re-sent a charge whose outcome was unknown. Same idempotency key, so no double charge, but billing didn't stop. | Only chase unknown charges while their invoice is open. Added an invariant (no provider call after cancellation) and confirmed it fails on the old code. |
| `concurrency.spec` (cancel during signup charge) | A charge that succeeded after the customer canceled left the attempt `pending` forever: money taken, nothing recorded. | Record the result anyway and flag it `charge_requires_refund`. Added INV-9 and INV-10. |
| Partial-failure test | If saving the provider's answer failed, the attempt stayed `pending` and was never re-sent. | Mark it `unknown` so the next run reconciles it with the same key. |
| Property test (seed shrunk to 2 steps) | A failure webhook with no charge id, for a charge that timed out but was actually captured, was recorded as declined. | The generator now behaves like a real provider (it reports what really happened to our charges). The ambiguity is listed as a known limitation. |
| Mutation check | "Retry while a previous attempt is still in flight" survived: no test covered two billing runs overlapping on a retry. | Added a deterministic overlap test (the gateway double can pause a call mid-flight). |
| Mutation check | One race test relied on `setTimeout` timing and failed for unrelated mutants under load. | Rewrote the race tests to use the pause/release gate instead of sleeps. |

Mutation result: 17/17 bugs killed, plus 1 known-equivalent survivor (removing the in-code duplicate check
is harmless because `UNIQUE(event_id)` rolls the transaction back).

Other differences from the plan above:
- 11 invariants instead of 7 (INV-8 to INV-11 came from the findings above).
- Customer cancel while `past_due` returns 409, because the lifecycle diagram doesn't include it.
- The "reference model" in the property test is the set of spec transitions plus the invariants, not a
  second implementation of the service.

