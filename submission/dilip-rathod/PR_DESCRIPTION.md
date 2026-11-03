## Summary
A minimal Subscription & Billing Service fixture (TypeScript, Express, in-memory SQLite via `sql.js`) and an
object-oriented validation suite of **142 Vitest tests** across API, state-machine, persistence,
provider-mock, webhook and end-to-end levels. The strategy was written first
([`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md)) and the code follows it. Ten global invariants run
automatically after **every** test.

## Test Strategy
- **Levels covered:** unit (state machine, exhaustive) · API contract & validation · state-machine integration · webhook request handling · webhook business logic (idempotency, ordering, races) · provider interaction · persistence/schema · one end-to-end journey with checkpoints.
- **In scope:** create / get / list invoices / cancel / change plan; trial end, renewal and retry billing; `payment.succeeded|failed|refunded` webhooks; HMAC signatures; plan-specific price, trial and retry limits.
- **Out of scope:** real provider/network, multi-instance concurrency, proration, tax, multi-currency, webhook replay windows, customer CRUD, API auth.
- **Real vs. stubbed:**

  | Real | Test double | Why |
  |---|---|---|
  | HTTP layer (Supertest, in-process), lifecycle, billing logic, SQL schema with constraints/triggers, HMAC verification | `MockPaymentProvider` (outbound charges), `WebhookSimulator` (inbound events), `FakeClock` | Doubles only at the system's edges: the external provider and time. Everything whose correctness is being claimed is the real code. The DB is real SQL so `UNIQUE`/`CHECK`/trigger guarantees are tested, not assumed. |

## OOP & Design Pattern Choices
| Pattern | Where | Problem it solved here |
|---|---|---|
| **State machine as an explicit transition table** | `src/domain/SubscriptionStateMachine.ts` | Callers pass a *trigger* (`charge_failed`, `cancel_requested`…), never a target status. `SubscriptionRepository.applyTransition` is the only code that writes `status`, and it asks the table. The same table seeds the `allowed_status_transitions` table that a `BEFORE UPDATE` trigger checks, so even raw SQL cannot do `canceled → active`. |
| **Strategy** | `src/plans/PlanPolicy.ts` (`BasicPlan`, `ProPlan`, `PlanCatalog`) | Price, trial length, period and retry limit vary by plan. Billing code calls `plan.periodStartingAt()` / `plan.maxRetries` instead of branching on plan codes. A third plan is one class. |
| **Adapter seam + dependency injection** | `src/payments/PaymentProvider.ts`, injected by `buildContainer()` (`src/container.ts`) | The service never knows which provider it has. Tests inject `MockPaymentProvider`. |
| **Builder** | `test/support/builders/builders.ts` | `aSubscriptionRequest().forCustomer(c).onPlan('basic').without('plan')`, `WebhookEventBuilder.paymentFailed(invoice).withAmount(1)`. Invalid inputs are as easy to express as valid ones, and 30+ data-driven validation cases stay one line each. |
| **Repository** | `src/persistence/repositories/*` (service) and `test/support/persistence/PersistenceInspector.ts` (tests) | SQL lives in one place on each side. The inspector uses **its own SQL**, not the service's repositories, so a mapping bug in the service can't make the tests agree with it. |
| **Facade** | `test/support/env/TestEnvironment.ts` | One object wires a fresh DB, clock, mock, app, clients and inspector. Specs read `env().api`, `env().db`, `env().provider`, `env().given`. |

**Payment provider seam:** `interface PaymentProvider { charge(ChargeRequest): Promise<ChargeResult> }`, plus `ProviderTimeoutError`. Injection point: `buildContainer({ paymentProvider })`.

## API Validation Approach
- `SubscriptionApiClient` offers a raw method per endpoint (returns status + body, for failure tests) and a typed method that asserts the success status **and** parses the body against a **strict zod contract** (`test/support/api/contracts.ts`), so an extra or missing field fails. Error bodies are checked against the error contract and code.
- Every rejection test also asserts **zero side effects**: whole-table row-count deltas (`expectRowDeltas`) and `expectNoCharges(provider)`.
- **Webhook request handling** (`test/specs/api/webhook-endpoint.api.spec.ts`) is kept separate from webhook business logic: missing, empty, wrong-secret, non-hex and tampered-body signatures → 401; signature checked before parsing (unsigned garbage is 401, not 400); signed non-JSON → 400 `malformed_payload`; 8 schema violations → 400 `invalid_payload`. None of them write a row.
- Failure scenarios: missing/mistyped fields (7 cases), malformed JSON, unknown plan, unknown customer, unknown payment method, another customer's payment method, double cancel, cancel from `past_due`, plan change in `past_due`/`canceled`, same-plan change, 404s.

## Database Validation Approach
- **Entities checked:** `subscriptions`, `invoices`, `payment_attempts` (one row per provider call), `webhook_events`, `webhook_deliveries` (one row per delivery, duplicates flagged), `audit_log`, `notifications` (an outbox standing in for customer emails).
- **Invariants** (`test/support/assertions/invariants.ts`, run after every test): `active` ⇒ a succeeded attempt on a paid invoice · `canceled` ⇒ inert (canceled_at, nothing scheduled, no open invoice) · `past_due` ⇒ exactly one open invoice · no invoice collected twice · every provider call ⇔ exactly one attempt row (same key, amount, invoice) and no reused idempotency key · amounts match plan price · audit trail is an unbroken chain ending at the current status · one processing delivery per webhook event · coherent timestamps · **API response = DB row for every subscription**.
- **Testing the checker itself:** `persistence.spec.ts` corrupts the DB on purpose and asserts the checker reports it (active with only a declined payment; a provider charge with no attempt row; audit trail not ending at the current status).
- **Every lifecycle stage:** `expectSubscriptionState()` checks status, retry count, invoice statuses (API listing *and* DB) and audit history together. It is called after each step of each transition scenario. The e2e journey adds a checkpoint (state + all invariants) after each of its five stages.
- **Schema guarantees proven with raw SQL:** all 5 illegal status changes are aborted by the trigger, an insert that skips `trialing` is aborted, a second open invoice is rejected, duplicate idempotency key and duplicate `event_id` are rejected, `paid` without `paid_at` and `canceled` without `canceled_at` fail `CHECK`s.
- **Seeding/cleanup:** fresh in-memory DB per test, so there is nothing to clean. States are reached only through the API, billing job and webhooks (`LifecycleDriver`), never by inserting rows, which rules out tests that start from an impossible state. Assertions are scoped to the subscription under test, and "nothing written" is checked across every table.

## Mock Payment Provider & Webhook Validation
- **Mock:** `MockPaymentProvider.charge` is a `vi.fn` backed by a FIFO script: `willSucceed()`, `willDecline(code)`, `willReturnPending()`, `willTimeout()`, `alwaysRespond()`, and `holdNextCharge()`, which hands the test a promise for the in-flight request and a `respondWith()` so it can interleave events before the provider answers. Assertions cover **exact arguments** (`customerId`, `paymentMethodId`, `amount`, `currency`, `idempotencyKey = <invoice>:<attempt>`, `reference`) and **call counts**. Covered "not called" cases: trial creation, rejected creation, reads, cancel, webhooks/replays, a second billing run at the same instant, a billing run while a charge is in flight, a canceled subscription over 12 months.
- **Outcomes:** success → active; decline → past_due with no success record anywhere; timeout → no state change, **no blind retry** (it could double-charge), resolved later by webhook; pending → wait for webhook.
- **Idempotency (duplicate `event_id`):** the second delivery returns `outcome: duplicate` and writes **only** a `webhook_deliveries` row (asserted with table deltas). One transition, one paid invoice, one succeeded attempt, one notification, one audit entry, no extra provider call. Also covered: duplicate `payment.failed` doesn't use up two retries, duplicate refund refunds once, **5 parallel deliveries** apply once, same `event_id` with a different body is still a duplicate and the first payload is kept, and a raw duplicate insert is blocked by the primary key.
- **Out-of-order / stale:** ordering is enforced per invoice and per attempt, not by arrival time. Covered: `payment.failed` after `payment.succeeded` for the same invoice (async and sync success), `payment.succeeded` contradicting a recorded decline, a stale failure for last period's invoice while the current one is pending, refund before payment, mismatched subscription/amount/currency/invoice. **Races (bonus):** webhook success lands while the charge call is in flight and the late decline is discarded; cancel lands mid-charge and late success/decline can't move it.

## State-Machine / Lifecycle Coverage
- **Valid transitions:** all 7 diagram edges, most of them via **both** a synchronous provider response and a webhook (12 scenarios), plus the two self-loops (renewal keeps `active` with contiguous periods; a failed retry keeps `past_due` and increments). A meta-test asserts that the set of covered edges equals the hand-transcribed diagram (`test/specs/lifecycle/diagram.ts`), so a missing edge fails the build.
- **Invalid transitions proven impossible:** state-machine unit tests check all 11 illegal (state, trigger) pairs. At integration level: canceled + `payment.succeeded` (in-flight charge voided at cancel), canceled + `payment.succeeded` after retries are exhausted, canceled + `payment.failed`, double cancel → 409, `past_due` cancel → 409. At DB level: 5 illegal raw `UPDATE`s plus a forged insert.
- **Plan-specific:** pro trial 14 days / 4900; basic charged at creation / 1900; pro uses 3 retries, basic 2. A plan change is billed at the new price from the next invoice.
- **Confidence:** the table is the only writer of `status` and is tested exhaustively. Integration tests prove each real trigger reaches it correctly, and the DB trigger backs it up. **Mutation check:** I injected 6 bugs into `src/` one at a time. 5 were caught (skip duplicate check → 7 failures; allow canceled→active → 5; recharge while in flight → 2; off-by-one retry limit → 3; accept any signature → 3). The survivor removed a guard that the webhook pre-check and the state machine both duplicate, so it is an equivalent mutant. It still led to the in-flight-cancel race tests.

## Test Architecture
```text
test/support/
  env/          TestEnvironment (Facade, one isolated world per test) · FakeClock · useTestEnvironment() — invariants in afterEach
  api/          HttpClient (transport only) · SubscriptionApiClient (typed) · contracts (strict zod)
  provider/     MockPaymentProvider
  webhooks/     WebhookSimulator (own HMAC)
  builders/     CustomerBuilder · SubscriptionRequestBuilder · WebhookEventBuilder
  scenarios/    LifecycleDriver — "given" steps: trialing(), active(), pastDue(), awaitingRenewalOutcome()…
  persistence/  PersistenceInspector — read-only repository for assertions
  assertions/   expectSubscriptionState (API+DB), expectCharges, expectRowDeltas, invariants + InvariantChecker
test/specs/     api/ · lifecycle/ · webhooks/ · provider/ · persistence/ · e2e/
```
Why it stays maintainable: specs contain intent only. No HTTP, SQL or object literals; transport, SQL and payload shape each live in one class. A new scenario gets isolation and all ten invariants for free. Failures name what broke (`expectStatus` prints the body, the invariant checker names the rule and the row, e2e checkpoints name the stage).

## Validation
```bash
npm ci
npm run lint              # eslint — clean
npm run build             # tsc --noEmit — clean
npm run validate-schema   # "Schema OK: 10 tables, 2 indexes, 2 triggers, 7 allowed status transitions."
npm test                  # 11 files, 142 tests passed
npm run verify            # all of the above in one command
```
Plus the manual mutation run described above (bug injected, suite run, file restored with `git checkout`).

## Known Limitations / Next Steps
- **Single process.** Parallel webhook deliveries serialise in Node's event loop, so the concurrency tests prove application-level idempotency, not multi-instance safety. That would rest on the `event_id` primary key (tested directly) and would need a test against a real multi-connection database.
- **Timeouts are never re-tried.** The attempt stays unresolved until a webhook arrives. Production needs a reconciliation job that re-queries the provider (same idempotency key) after a deadline.
- **Money taken for a void/uncollectible invoice** (late success after cancel) is recorded as `ignored` and the attempt stays unresolved. It should trigger an automatic refund or a manual-review queue.
- **`past_due → canceled` via the API is rejected**, as a literal reading of the diagram. Worth confirming with product, since customers often want to cancel while past due.
- No webhook timestamp / replay-window check, no partial refunds, no proration.
- With more time: property-based tests (fast-check) generating random event sequences against the invariants; a contract test for a real provider adapter in sandbox mode; Stryker for systematic mutation testing.

## Responsible AI Usage
- **Did you use AI tools?** Yes. Claude Code (Anthropic) was used throughout.
- **Where did they help?** Drafting the strategy document, the service fixture, the test framework classes and the specs; running the suite; running the mutation check.
- **What did you personally verify or correct?** _<!-- AUTHOR: fill in honestly before submitting — e.g. which design decisions you changed, which tests you read line by line, what you re-ran yourself. -->_

## Author Checklist
- [x] Linting passes
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes
- [x] Schema/setup validation passes
- [x] Every listed lifecycle transition is exercised by at least one test (enforced by a meta-test)
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [x] README was tested from a clean setup (`rm -rf node_modules && npm ci && npm run verify`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
