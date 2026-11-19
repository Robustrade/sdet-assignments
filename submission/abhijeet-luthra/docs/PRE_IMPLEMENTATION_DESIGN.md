# Kulu SDET Assignment — Pre-Implementation Design

**Candidate:** Abhijeet Luthra
**System:** Subscription & Billing Service
**Status:** Implemented. This document was the pre-implementation design; §23 lists where the implementation differs from or refines it.
**Selected approach:** Option 3 (Hybrid): a minimal TypeScript/Express service fixture, SQLite persistence and a mocked payment provider. Mandatory scope comes first.

## 1. Purpose

This document is the reference for the planned implementation. Before substantial code is written, it sets out what will be built, how it will be validated, which assumptions are being made and how the work is organised.

The assignment evaluates backend SDET judgment. It covers API behavior, lifecycle rules, transactional consistency, webhook reliability, persistence, isolation of external dependencies and maintainable object-oriented test design.

The solution is a **minimal service fixture plus an automated validation suite**. The fixture exists only to provide a controllable system under test. It is not meant to be a production billing product.

## 2. Sources and labelling convention

| Source | Role |
|---|---|
| `SDET_ASSIGNMENT.md` (repository root) | **Primary technical specification** |
| `README.md` (repository root) | Submission rules: TypeScript, `submission/<name>/` folder, `solution/<name>` branch, PR template |
| `pull_request_template_sdet.md` | Structure of the final PR description |
| Recruiter guidance (email) | Two-working-day deadline, a design PR raised first, and the evaluation focus areas listed in §3 |

Throughout these documents:

- **Requirement** means the assignment or recruiter guidance states it.
- **Design decision** means a choice made for this fixture. It is not demanded by the assignment.
- **Assumption** means behavior the assignment does not specify. A deterministic fixture policy is chosen and listed in §19 for review.

Nothing labelled a design decision or an assumption should be read as a confirmed Kulu product rule.

## 3. Recruiter expectations and how this design addresses them

| Expectation | Where it is addressed |
|---|---|
| Raise a dummy/initial PR outlining understanding and approach first | This documentation-only PR |
| Two working days | Time-boxed plan in §18. Must-have and optional scope are separated in `TEST_STRATEGY.md` |
| End-to-end scenarios across API, database and workflows | `TEST_STRATEGY.md` §8 (E2E) and the cross-layer assertions in §7 |
| Retries, duplicate requests, partial failures | Retry attempts (§9, §10); duplicate `POST /subscriptions` via `Idempotency-Key` (`TEST_STRATEGY.md` DUP-01…05); duplicate webhooks and duplicate cancels; partial-failure tests (`TEST_STRATEGY.md` PF-01…03) |
| API responses consistent with database state | Every scenario compares the API result with repository reads, and a shared invariant checker runs after each test (`TEST_STRATEGY.md` §5) |
| Clear, maintainable test design | Builders, fixtures, API client and verification layer (§7, §8) |
| Automation thinking beyond basic UI/API checks | State-machine tests, provider-interaction assertions, failure injection, invariant checks |
| Reason about transactional systems, not individual APIs | Explicit consistency boundaries (§11). No claim of atomicity across the provider and the database |
| Prefer clarity and correctness over a large framework | Four patterns only, each tied to a concrete problem. No generic framework layers |

## 4. Confirmed design decisions

| Decision | Selected approach | Rationale |
|---|---|---|
| Persistence | SQLite via `better-sqlite3` | Real relational constraints and transactions with low setup friction. An in-memory database per test gives isolation |
| System under test | Minimal TypeScript/Node.js Express fixture | No service implementation is supplied (assignment Option 2/3) |
| Test stack | Jest + Supertest | Both are suggested by the assignment. `jest.fn()`-style call recording is sufficient for the provider mock |
| Scope | Mandatory requirements first | Optional work starts only after all must-have tests pass |

## 5. Understanding of the domain

A customer subscribes to a plan. Depending on plan configuration, the subscription either begins with a trial or requires an immediate charge. The service creates invoices and payment attempts, calls an external payment provider through an interface, and receives asynchronous payment events through signed webhooks.

The service must behave correctly when payment outcomes are uncertain (timeouts), when webhook events are duplicated or arrive out of order, when local processing fails part-way, and when customers cancel.

### Main entities

Customer, Plan, Subscription, Invoice, Payment attempt, Webhook event, Subscription audit event.

### Main service responsibilities

1. Validate subscription requests and referenced customer and plan data.
2. Apply plan-specific price and trial configuration.
3. Create and retrieve subscriptions.
4. Process cancellation.
5. Initiate payment attempts through a mockable provider interface.
6. Receive and authenticate provider webhooks.
7. Apply valid lifecycle transitions only.
8. Persist invoices, payment attempts, webhook receipts and audit events.
9. Ensure duplicate or conflicting events create no duplicate or contradictory financial effects.

## 6. Scope

### In scope (mandatory)

- The four required endpoints: create, retrieve, cancel and the provider webhook.
- Duplicate subscription-creation protection through an `Idempotency-Key` header (A-16).
- Payment-provider interface and a configurable mock (success, decline, timeout).
- Trial and immediate-billing behavior.
- Successful and declined payments, and provider timeouts as an unknown payment-attempt outcome.
- `payment.succeeded`, `payment.failed` and `payment.refunded` webhooks.
- HMAC signature verification, and malformed or unsigned payloads.
- Duplicate webhook idempotency.
- Out-of-order and conflicting events for the same invoice.
- All required lifecycle transitions, plus invalid-transition rejection.
- SQLite persistence, transactional webhook processing and partial-failure behavior.
- Database/API consistency checks and an auditable event history.
- End-to-end scenarios across the API, the provider mock, webhooks and the database.

### Out of scope

- Frontend or UI.
- A real payment gateway or real money movement.
- Production deployment, monitoring or dashboards.
- A real scheduler. Billing is triggered deterministically by tests (§9).
- Tax, complex proration and multi-currency conversion.
- Performance and load testing.

### Optional (only after the mandatory scope is green)

These are listed in `TEST_STRATEGY.md` §10. They include concurrent duplicate delivery (the assignment marks it as a bonus), concurrent requests sharing one `Idempotency-Key`, a plan-change endpoint and a notification side-effect spy.

> **Requirement note:** The assignment's overview mentions "plan changes" at API level, but its listed core operations do not include a plan-change endpoint. The plan-change endpoint is therefore treated as optional. See the assumptions register (§19).

## 7. Planned architecture

The solution has two cooperating parts:

1. **Service fixture:** Express routes, application services, the subscription state machine, a payment-provider seam, a billing runner and SQLite repositories.
2. **Automation suite:** Jest scenarios that use builders, an environment fixture, a typed API client, a mock provider and webhook simulator, and a verification layer.

```text
Jest scenario (business language)
   |
   +--> Typed API client (Supertest) ----> Express routes
   |                                             |
   +--> Webhook simulator (signed payloads) -----+
   |                                             v
   +--> BillingRunner.runDue(clock.now)    Application services
                                            /       |        \
                              Transition table  PaymentProvider  Webhook processor
                              (state rules)     (interface)          |
                                                    |                |
                                              MockPaymentProvider    |
                                              (records calls)        |
                                                    \                /
                                                  Repositories (SQL lives here)
                                                         |
                                                 SQLite (in-memory per test)

Verification layer: API response + repository reads + provider call log + invariant checker
```

### Planned folder layout (illustrative; nothing exists yet)

```text
submission/abhijeet-luthra/
  src/            domain/ (states, transition table), services/, providers/, repositories/, http/, db/
  tests/
    support/      builders/, fixtures/, clients/, mocks/, assertions/
    unit/         transition table, signature verification
    api/          contract and validation tests
    lifecycle/    state transitions and invalid transitions
    webhooks/     signature, idempotency, ordering
    persistence/  invariants, partial failures
    e2e/          end-to-end workflows
```

### Module responsibilities

| Module | Responsibility |
|---|---|
| HTTP routes | Parse requests, validate them, map status codes and responses |
| Application services | Orchestrate the subscription, billing and webhook use cases |
| Domain / transition table | Hold the single authority on allowed subscription and payment transitions |
| PaymentProvider + mock | Provide the external-provider seam, with a configurable test double |
| BillingRunner | Run trial-end, recurring and retry charges deterministically when a test calls it |
| Repositories | Encapsulate all SQL and persistence operations |
| Clock | Provide controllable "now" for trial and period calculations |
| Builders | Construct customers, subscription requests and webhook payloads |
| Fixtures | Create an isolated database, seed it, build the app and inject the mock provider and clock |
| Verification layer | Provide reusable API, persistence, lifecycle, provider and invariant assertions |

## 8. Planned design patterns

These were planned before implementation. All four are now present in the code (file references in §23). The assignment explicitly says that naming an absent pattern is a red flag, so the wording below matches the code.

| Pattern | Where (planned) | Problem it solves |
|---|---|---|
| **State / explicit transition table** | `domain/` subscription lifecycle (and payment-attempt status) | Without it, `status` would be a string mutated from many call sites, and illegal transitions would be easy to write by accident. One table defines every legal `(from, trigger) → to` move. Every service asks the table, and unlisted moves are rejected in one place. It is also exhaustively unit-testable (all 4×4 pairs). |
| **Builder** | `tests/support/builders/` | Scenarios need many slightly different customers, subscription requests and webhook payloads, including deliberately invalid ones. Builders give sensible defaults plus intent-revealing overrides (`aWebhook().failed().forInvoice(invoice).without('event_id')`), which removes repeated object literals. Signature tampering is a mode of the `WebhookSimulator`. |
| **Interface seam + dependency injection** (planned as "Adapter / DI") | `PaymentProvider` interface, constructor-injected into `BillingService` via `src/fixture.ts` | The provider is external and must be mocked, not assumed. The service depends only on the interface. Tests inject `MockPaymentProvider` with scripted outcomes (success, decline, timeout) and inspect the recorded calls. **No real-provider adapter class exists** (there is no real provider), so the implemented pattern is named "interface + DI", one of the options the assignment lists. |
| **Repository** (the "one more pattern" required) | `repositories/` | Keeps raw SQL out of routes and test scenarios. The same repositories back both the service and the test verification layer, so persistence assertions read as business queries (`payments.findByInvoice(id)`). |

**Plan-specific behavior** (price, trial length) is planned to be **data-driven from the `plans` table** rather than `if (plan === 'pro')` branches. If plan behavior grows beyond configuration values, a Strategy per plan would be the next step, but it is not planned unless needed.

## 9. Lifecycle model

### States (requirement: exactly these four)

`trialing`, `active`, `past_due`, `canceled`

No fifth subscription state is introduced. **A provider timeout is a payment-attempt outcome (`timed_out`), not a subscription state.**

### Required transitions and how the fixture triggers them

| # | From | Trigger (assignment wording) | To | Fixture mechanism (design decision) |
|---|---|---|---|---|
| T1 | trialing | trial ends, first charge succeeds | active | `BillingRunner` charges at `trial_end` → provider success, **or** `payment.succeeded` webhook for that invoice |
| T2 | trialing | trial ends, first charge fails | past_due | `BillingRunner` → provider decline, **or** `payment.failed` webhook |
| T3 | active | recurring charge fails | past_due | `BillingRunner` at `current_period_end` → decline, **or** `payment.failed` webhook for the new invoice |
| T4 | past_due | retry charge succeeds | active | `BillingRunner` retry → success, **or** `payment.succeeded` webhook |
| T5 | past_due | retries exhausted | canceled | `BillingRunner` after the final allowed attempt fails |
| T6 | active | customer/API cancel | canceled | `POST /subscriptions/{id}/cancel` |
| T7 | trialing | customer/API cancel | canceled | `POST /subscriptions/{id}/cancel` |

**Why a `BillingRunner`?** The assignment's lifecycle depends on time-based events (trial end, recurring charge, retries), but its four endpoints include no billing trigger. A test-invoked, in-process `BillingRunner.runDue(now)` with a controllable clock makes these transitions deterministic without inventing a fifth endpoint. *(Assumption A-05.)*

**Synchronous result vs. webhook.** A charge returns a synchronous result from the provider, and the provider may also send a webhook about the same attempt. Whichever arrives first is applied. The later one agrees with it and is recorded as a no-op, or it contradicts a final outcome and is recorded as ignored (§10).

### Initial state on creation (assumption A-01)

- **Trial plan (`trial_days > 0`):** the subscription is created as `trialing`, with `trial_end = now + trial_days`. There is no provider call.
- **Immediate-billing plan (`trial_days = 0`):** the subscription row is first created as `trialing` with `trial_end = now`, a zero-length trial. Its first invoice is charged immediately, in the same request. The outcome then drives T1 or T2, so the response is `active` or `past_due`. This uses only the required states and transitions. It also guarantees that every `active` subscription reached it through a successful payment.
- **Immediate-billing plan with a timeout:** the payment attempt is `timed_out` and the subscription remains `trialing` until a webhook reconciles it. The service does **not** automatically re-charge the same attempt.

### Invalid transitions (any move not listed above is rejected or ignored)

| Example | Driven by | Expected outcome |
|---|---|---|
| canceled → active | `payment.succeeded` webhook | Ignored; remains canceled; event recorded as `ignored` |
| canceled → past_due | `payment.failed` webhook | Ignored; remains canceled |
| canceled → canceled | second `POST …/cancel` | `409 INVALID_TRANSITION`; no new audit row |
| active → past_due for an already-**paid** invoice | late `payment.failed` after `payment.succeeded` | Ignored; payment stays `succeeded`; subscription stays active |
| past_due → canceled | `POST …/cancel` | `409 INVALID_TRANSITION`. The assignment lists cancel only from `active` and `trialing` (strict reading, assumption A-07) |
| active → trialing, past_due → trialing, etc. | none (domain level) | Rejected by the transition table (unit-tested over all 16 pairs) |

"Rejected" means an API returns `409`. "Ignored" means a webhook is acknowledged with `200` and recorded as ignored, and no business state changes. Rejected or ignored moves never mutate subscription, invoice or payment rows.

### Payment-attempt status (design decision)

Payment status is also governed by a small transition table so that stale events cannot overwrite a final outcome:

```text
pending   --> succeeded | failed | timed_out
timed_out --> succeeded | failed        (reconciled by a later webhook)
succeeded --> refunded
failed, refunded: final
```

## 10. Payment and webhook processing model

### Outbound payment

- The service calls the `PaymentProvider` interface with the amount, currency, customer, payment method, invoice and an **idempotency key per attempt** (planned format `<invoice_id>:<attempt_number>`, assumption A-09).
- The mock supports **success**, **decline** and **timeout** (the requirement), and records each call for assertions.
- A timeout means **unknown outcome**. The attempt is stored as `timed_out`, not `failed`. It does not count as a failed retry, and it is never automatically re-charged.
- A **genuine retry** is a new attempt row with the next `attempt_number` and a new idempotency key.
- Retry limit: a maximum of **3 attempts per invoice** (1 initial plus 2 retries) before T5 (assumption A-06). Each `BillingRunner.runDue` call makes at most one retry per past_due invoice, and never while that invoice still has an unresolved (`pending` or `timed_out`) attempt.
- Duplicate client requests: `POST /subscriptions` accepts an `Idempotency-Key`. The same key with the same payload replays the existing subscription, with no new rows and no provider call. The same key with a different payload is rejected with `422` (A-16, `API_CONTRACTS.md` §3.1).

### Inbound webhook

1. Read the **raw body** and verify `X-Provider-Signature` (HMAC over the raw body). If it is missing or invalid, return `401` with no DB access.
2. Parse JSON and validate the schema and supported `type`. If either fails, return `400` with no mutation.
3. Begin one SQLite transaction.
4. If `event_id` already exists, increment its `delivery_count`, commit and return `200 {"status":"duplicate"}`. There are no business side effects.
5. Validate references: subscription exists, invoice belongs to it, amount and currency match the invoice. If they do not, roll back and return `404` or `422` (assumption A-11).
6. Match the event to a payment attempt (A-17, `API_CONTRACTS.md` §6.1). Prefer `provider_reference` when it is present. Without it, reconcile only if the invoice has **exactly one** unresolved attempt. If more than one attempt could match, the service does not guess: the event is stored as `quarantined` and nothing financial changes.
7. Decide applicability using the transition tables. If the event is not applicable, record it as `ignored` with a reason, such as `subscription_canceled` or `invoice_already_paid`.
8. Otherwise, update the payment, invoice and subscription, and write the audit event.
9. Insert the `webhook_events` row with its processing status and commit. Return `200 {"status":"processed"|"ignored"|"quarantined"}`.

### Duplicates vs. out-of-order vs. conflicting events

- **Same `event_id` again** means duplicate delivery. It is idempotent: `delivery_count` is incremented and nothing else happens.
- **Different `event_id`, same invoice, contradicting a final outcome** (for example, `payment.failed` after the invoice is `paid`) is stale or conflicting. It is recorded as `ignored`, and the earlier confirmed outcome stands.
- **`payment.failed` then `payment.succeeded` for the same invoice** is legitimate (a later attempt succeeded). It is applied as past_due → active.
- **Ordering rule:** the provider supplies no sequence number. Ordering is therefore decided by state monotonicity (the payment and invoice transition tables), not by timestamps (assumption A-12).

### Refunds (assumption A-08)

`payment.refunded` marks the payment as `refunded` and the invoice as `refunded`, and is recorded in history. The assignment lists refunds among the webhook-driven events but defines **no lifecycle transition** for them, so the subscription state is not changed. This is flagged for review.

## 11. Consistency boundaries (what is and is not atomic)

| Operation | Atomic? | How consistency is achieved |
|---|---|---|
| Create subscription (trial) | Yes, one SQLite transaction | Subscription, audit row and `Idempotency-Key` row together |
| Webhook processing | Yes, one SQLite transaction | Event claim, payment, invoice, subscription and audit commit or roll back together |
| Charge at the provider + local update | **No** | The provider is external. The sequence is: (1) commit a `pending` attempt with its idempotency key; (2) call the provider **outside** any DB transaction; (3) apply the outcome in a new local transaction. If step 3 fails, or the call times out, the attempt stays `pending` or `timed_out` and is reconciled later by the provider webhook, matched through the invoice and the provider reference. |

**This design does not claim atomicity across the payment provider and the local database.** `better-sqlite3` is synchronous, so a DB transaction physically cannot span the asynchronous provider call. This makes the boundary explicit in code.

## 12. Database strategy

Tables: `customers`, `plans`, `subscriptions`, `invoices`, `payments`, `webhook_events`, `subscription_events`, `idempotency_keys`. Constraints include primary keys, foreign keys, a unique `event_id`, a unique payment idempotency key, a unique client `Idempotency-Key`, a unique provider reference when present, status `CHECK`s and non-negative integer amounts. The full design is in `DATABASE_DESIGN.md`.

## 13. API contract strategy

The required endpoints use the **paths given in the assignment** (no `/api/v1` prefix):

| Method | Path | Purpose |
|---|---|---|
| POST | `/subscriptions` | Create a subscription |
| GET | `/subscriptions/{id}` | Retrieve a subscription |
| POST | `/subscriptions/{id}/cancel` | Cancel a subscription |
| POST | `/webhooks/payment-provider` | Receive a provider webhook |

The assignment gives example routes and payloads, but not status codes or error formats. Those are proposed in `API_CONTRACTS.md` and labelled as design decisions.

## 14. Test strategy (summary)

Tests are grouped by behavior: domain (transition tables), API contract and validation, lifecycle and invalid transitions, provider interaction, webhook reliability, persistence and partial failures, and end-to-end workflows. Each scenario is labelled **must-have** or **optional**. See `TEST_STRATEGY.md`.

Important scenarios verify more than the HTTP status. They check the API response, the persisted rows (subscription, invoice, payment, webhook event, audit), the provider call count and exact arguments, and the **absence** of invalid or duplicate side effects.

## 15. Core invariants

1. A subscription is only ever in one of the four required states.
2. A subscription never becomes `active` without at least one persisted `succeeded` payment.
3. `canceled` is terminal. No later webhook or API call changes it.
4. Duplicate webhook delivery never produces duplicate invoices, payments, transitions or provider charges.
5. One payment attempt is never both `succeeded` and `failed`, and a final outcome is never overwritten by a stale event.
6. Every payment references an invoice of the same subscription.
7. The provider is called at most once per genuine billing attempt, with the expected amount, currency, customer, payment method and idempotency key.
8. API-visible subscription state always equals persisted state.
9. Every subscription state change has exactly one audit row.
10. An invalid signature or malformed payload never mutates business data.
11. Plan price and trial rules are applied consistently between creation and billing.
12. A failed local webhook transaction leaves no partial local updates.
13. There are no contradictory records, such as an `active` subscription whose only invoice has only `failed` payments.

## 16. Test data and isolation

Illustrative fixture plans (test data only, not real Kulu prices):

| Plan | Price | Trial |
|---|---:|---:|
| basic | USD 19.00 (1900) | 0 days → immediate charge |
| pro | USD 49.00 (4900) | 7 days |

The `pro` price of 4900 matches the assignment's example webhook amount.

Isolation:

- A fresh in-memory SQLite database per test: schema plus seed customers and plans.
- Deterministic IDs and a controllable clock.
- A fresh mock provider (empty call log) per test.
- No dependence on test order or on data from other tests, which avoids false positives from stale data.

## 17. Red, Blue, Green workflow (requirement)

- **Red:** write a failing test for a business rule or invariant.
- **Blue:** implement the minimum fixture behavior needed to pass.
- **Green:** refactor for readability and maintainability while keeping tests green.

The commit history should show test-first progression for the core rules: the transition table, idempotency and invariants.

## 18. Execution plan (two working days)

| When | Work | Output |
|---|---|---|
| Day 1, start | Raise this documentation-only PR, then **continue immediately** (no waiting for review) | Initial PR |
| Day 1 | Project setup (TS, Jest, Express, Supertest, better-sqlite3); schema and seed fixture; transition tables plus unit tests; repositories; mock provider; builders; create, retrieve and cancel endpoints with API tests | Runnable core with green tests |
| Day 2 | Webhook endpoint (signature, idempotency, ordering); `BillingRunner` and lifecycle tests; partial-failure tests; invariant checker; E2E flows | All must-have tests |
| Day 2, end | Run the full suite and record real results; README run instructions; PR description from the template; AI-usage disclosure | Final PR update |

The assignment's 3–5 hour estimate is a guide to keeping scope tight. If time runs short, optional items are dropped first. Mandatory sections D (idempotency) and E (state-machine invariants) are never dropped.

## 19. Assumptions register (for review)

| ID | Assumption | Why it is needed |
|---|---|---|
| A-01 | An immediate-billing plan starts as `trialing` with a zero-length trial; the first charge drives T1 or T2 | The assignment says "trialing or charged immediately" but lists no transition into `active` other than from trialing or past_due |
| A-02 | Trial subscriptions still require `payment_method_id` | The assignment's example request includes it, and it is needed at trial end |
| A-03 | Immediate-charge decline still returns `201` with status `past_due` | The resource was created, and the failure is a billing outcome |
| A-04 | A timeout leaves the attempt `timed_out` and the subscription unchanged until a webhook reconciles it | The assignment requires timeout handling but not its semantics |
| A-05 | Time-based billing is triggered by a test-invoked `BillingRunner` (not an HTTP endpoint) | There is no billing trigger among the four required endpoints |
| A-06 | Maximum of 3 attempts per invoice | The assignment says "retries exhausted" without a number |
| A-07 | Cancelling a `past_due` subscription returns `409` | Strict reading: cancel is listed only from `trialing` and `active` |
| A-08 | A refund is recorded and does not change the subscription state | No refund transition is defined |
| A-09 | Idempotency key format `<invoice_id>:<attempt_number>` | Needed for retries vs. duplicates |
| A-10 | HMAC-SHA256, hex digest, in `X-Provider-Signature` (no prefix) | The assignment says "hmac signature over the raw body" without naming the algorithm |
| A-11 | Unknown subscription or invoice → `404`; mismatched invoice, amount or currency → `422`; neither is persisted | Not specified |
| A-12 | Event order is resolved by state monotonicity, not timestamps | The provider payload has no sequence number |
| A-13 | `provider_reference` is an **optional** extra webhook field (the mock always sends it) | The assignment's example payload does not include it, so it must not be required |
| A-14 | Plan change is optional and is not among the four required endpoints | The overview mentions it, but the core operations do not list it |
| A-15 | No authentication or authorization on the fixture API | Not in the assignment's scope |
| A-16 | `POST /subscriptions` accepts an optional `Idempotency-Key`. Same key and same payload replays the existing subscription (201, `Idempotent-Replayed: true`). Same key and a different payload → `422 IDEMPOTENCY_KEY_REUSED`. Requests without the header are not de-duplicated | The recruiter highlighted duplicate requests; the assignment defines no mechanism. The header stays optional so the assignment's example request remains valid |
| A-17 | A webhook is matched to a payment attempt by `provider_reference` when present. Otherwise only if the invoice has exactly one unresolved attempt. If more than one attempt could match, the event is acknowledged as `quarantined` with no financial mutation | `provider_reference` is optional (A-13); guessing could mark the wrong attempt as paid |

## 20. Risks and known limitations

- The SQLite fixture proves design and test strategy, not production database concurrency behavior.
- Late provider successes for a **canceled** subscription are ignored at state level. A real system would also reconcile money (for example, by issuing a refund), and this is not modelled.
- Concurrency (parallel duplicate webhooks) relies on the unique `event_id` constraint. Testing it is optional.
- The provider mock is deterministic and does not reproduce real provider retry schedules.
- Quarantined (ambiguous) webhook events are stored but not resolved. Manual reconciliation is out of scope.
- `POST /subscriptions` requests without an `Idempotency-Key` are not de-duplicated.

## 21. Responsible AI usage

AI tools (Claude Code) are used to analyse the requirements, review these documents for gaps and contradictions, and later assist with implementation and review. The candidate reviews and decides the business rules, assumptions, architecture and assertions. Test results will only be reported from actual runs. The final PR will disclose AI assistance candidly, as the template requires.

## 22. Definition of done

- Every required lifecycle transition (T1–T7) is exercised by at least one test.
- At least two invalid transitions are proven impossible. The plan covers more (§9).
- A duplicate `event_id` produces exactly one transition and no duplicate rows or charges.
- Success followed by failure for the same invoice does not regress state.
- An invalid signature or malformed payload is rejected without mutation.
- Provider success, decline and timeout are covered, with exact call-argument assertions.
- Subscription, invoice, payment, webhook-event and audit persistence are verified at each lifecycle stage.
- API and database state agree, and the invariant checker passes after every test.
- Partial-failure (rollback and reconciliation) scenarios pass.
- Tests run with one documented command from a clean checkout. Setup, seed, assumptions, limitations and AI usage are documented.

---

**Workflow note:** This documentation PR is the recruiter-requested "approach first" step. It is **not a gate**: implementation continues right after the PR is raised. Reviewer feedback, when it arrives, is incorporated as follow-up commits on the same branch.

## 23. Implementation notes (added after implementation)

Where each design element lives:

| Design element | Implementation |
|---|---|
| Transition table (State) | `src/domain/subscription-state-machine.ts`, `src/domain/payment-state-machine.ts`. `src/services/lifecycle.ts` is the only code that writes a subscription status, and it always asks the table and writes an audit row |
| One place that applies payment outcomes | `src/services/payment-outcome-applier.ts`, shared by synchronous provider results and webhooks |
| Consistency boundary (Tx A, provider call, Tx B) | `src/services/billing-service.ts` (`createAttempt`, `executeCharge`) |
| BillingRunner (A-05) | `src/services/billing-runner.ts` |
| Idempotency-Key (A-16) | `src/services/subscription-service.ts` |
| Webhook matching and quarantine (A-17) | `src/services/webhook-service.ts` (`matchAttempt`) |
| Interface + DI provider seam | `src/providers/payment-provider.ts`, wired in `src/fixture.ts` |
| Repository | `src/repositories/*` |
| Builders | `tests/support/builders/*` |

Refinements made during implementation (none changes documented business behavior):

- **Provider errors other than a timeout** (e.g. a connection reset) are also recorded as `timed_out`, with `failure_code = provider_error`. We cannot know whether money moved, so treating them as a decline would be unsafe. This was OPT-04 and is now tested.
- **Canceled subscriptions** are checked in two places: the webhook service and the outcome applier (defense in depth). Mutation testing showed the second check is unreachable today, because cancelling also voids open invoices. It is kept deliberately.
- **Partial-failure injection** uses `jest.spyOn` on real repository instances in tests. No failure hooks exist in the service code.
- **Concurrency:** `better-sqlite3` is synchronous and the fixture runs on one Node.js thread. The idempotency-key lookup and the Tx A insert therefore cannot interleave between two requests. Concurrent delivery remains untested (optional scope).

