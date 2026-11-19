# Test Strategy — Subscription & Billing Service

**Status:** Implemented. Every must-have scenario below exists as a Jest test named with its ID (130 tests, all passing at the time of writing; see the README for the latest run).
**Framework:** TypeScript + Jest + Supertest (design decision; both are suggested by the assignment)
**System under test:** minimal Express fixture backed by SQLite, with a mocked payment provider
**Time box:** two working days (recruiter guidance). **Must-have** scenarios first; **optional** ones only after all must-haves pass.

## 1. Objectives

The suite must prove the behavior of a **transactional billing workflow**, not just endpoint availability:

1. API request/response contracts and validation.
2. Subscription lifecycle transitions and the rejection of invalid ones.
3. Payment-provider interaction: call count, exact arguments, success, decline and timeout.
4. Webhook authentication, idempotency and ordering.
5. Persistence, audit history and API/database consistency at every lifecycle stage.
6. Partial failures and retries across the provider/database boundary.
7. End-to-end workflows across the API, services, provider mock and database.

A high-value test checks **three things together**: the API-visible result, the persisted rows, and the provider call log, including the *absence* of side effects that should not happen.

## 2. Test levels

| Level | What is exercised | Purpose |
|---|---|---|
| Unit (domain) | Transition tables, signature helper | Prove the rules exhaustively and cheaply |
| API / component | Express routes + services + in-memory SQLite + mock provider, through Supertest | Request/response, validation, side effects |
| Persistence | Repositories, constraints, transactions, injected failures | Constraints, rollback, invariants |
| Integration / workflow | Time-driven billing (`BillingRunner`) + webhooks + API | Lifecycle transitions, retries, reconciliation |
| End-to-end | Multi-step business journeys through the public HTTP surface | Cross-layer transactional outcomes |

There is no UI automation, because there is no frontend.

## 3. What is real vs. mocked

| Component | Real or test double | Why |
|---|---|---|
| Express routes, services, transition tables | **Real** (fixture code under test) | This is the behavior being verified |
| SQLite database | **Real** (in-memory per test) | Real constraints and transactions; queryable |
| Payment provider (outbound) | **Mock** (`MockPaymentProvider` implementing `PaymentProvider`) | External dependency; the assignment requires mocking it |
| Provider webhooks (inbound) | **Simulated** by the test suite (signed, unsigned and tampered payloads posted over HTTP) | Assignment requirement |
| Clock | **Controllable fake** | Deterministic trial ends, periods and timestamps |
| Scheduler | **Replaced** by explicit `BillingRunner.runDue(now)` calls | Deterministic time-based transitions (assumption A-05) |

## 4. Test architecture

The structure follows the assignment's "Architecture Expectations" (§1–6). It is implemented as described below.

| Layer | Component | Responsibility |
|---|---|---|
| Fixtures / environment | `TestEnvironment` | Create the in-memory DB, schema and seed data; build the app; inject the mock provider and fake clock; expose repositories |
| API client | `SubscriptionApiClient` | Typed methods (`create`, `get`, `cancel`, `postWebhook`) wrapping Supertest; transport details stay out of tests |
| Mock provider / webhook simulator | `MockPaymentProvider`, `WebhookSimulator` | Scripted outcomes (success, decline, timeout); recorded calls; signed, unsigned and tampered payloads |
| Verification layer | `expectApiMatchesDb`, `expectedChargeRequest`, `expectNoDatabaseChanges`, `findInvariantViolations` (`tests/support/assertions/`) | Reusable API, DB, provider and invariant assertions with readable failure messages |
| Builders | `aCustomer()`, `aSubscriptionRequest()`, `aWebhook()` | Defaults plus intent-revealing overrides |
| Scenarios | `tests/{unit,api,lifecycle,webhooks,provider,persistence,e2e}` | Grouped by business concern, named in business language |

**Shared invariant checker.** An `afterEach` hook runs the persistence invariants (`DATABASE_DESIGN.md` §7) against the test's database. Consistency between the API and the DB is then enforced in **every** test, not only the ones that remember to check it.

## 5. Must-have scenarios

The legend for each mandatory scenario: ✔ = API response checked, DB = rows checked, P = provider call log checked.

### 5.1 Domain / unit

| ID | Scenario | Expected |
|---|---|---|
| U-01 | Subscription transition table: all 16 `(from, to)` pairs | Exactly the 7 required transitions are allowed; the other 9 are rejected |
| U-02 | Payment-attempt transition table | `succeeded → failed` and `failed → succeeded` rejected; `timed_out → succeeded/failed` allowed |
| U-03 | Signature helper | Valid HMAC accepted; wrong secret, tampered body or missing header rejected |

### 5.2 API contract and validation (assignment §1, §A, §B)

| ID | Scenario | Expected | Checks |
|---|---|---|---|
| API-01 | Create on trial plan (`pro`) | 201 `trialing`, `trial_end` = now + 7 days | ✔ DB (subscription + audit, no invoice) P (0 calls) |
| API-02 | Create on immediate plan (`basic`), provider success | 201 `active` | ✔ DB (invoice `paid`, payment `succeeded`) P (1 call, exact args) |
| API-03 | Create on immediate plan, provider decline | 201 `past_due` | ✔ DB (invoice `open`, payment `failed`, no succeeded row) P (1 call) |
| API-04 | Missing `customer_id` / `plan` / `payment_method_id` (table-driven) | 400 `VALIDATION_ERROR` | ✔ DB (nothing written) P (0 calls) |
| API-05 | Unknown customer | 404 `CUSTOMER_NOT_FOUND` | ✔ DB P (0) |
| API-06 | Unknown plan | 422 `INVALID_PLAN` | ✔ DB P (0) |
| API-07 | Invalid payment method | 422 `INVALID_PAYMENT_METHOD` | ✔ DB P (0) |
| API-08 | Get existing subscription | 200; body equals the persisted row | ✔ DB |
| API-09 | Get unknown subscription | 404 | ✔ |
| API-10 | Cancel `active` | 200 `canceled`, `canceled_at` set | ✔ DB (audit, open invoices void) P (0) |
| API-11 | Cancel `trialing` | 200 `canceled` | ✔ DB P (0) |
| API-12 | Cancel already `canceled` | 409 `INVALID_TRANSITION` | ✔ DB (unchanged, no new audit) |
| API-13 | Cancel `past_due` | 409 (assumption A-07) | ✔ DB |
| API-14 | Cancel unknown subscription | 404 | ✔ |

### 5.2a Duplicate subscription-creation requests (recruiter: "duplicate requests"; contract in `API_CONTRACTS.md` §3.1)

| ID | Scenario | Expected | Checks |
|---|---|---|---|
| DUP-01 | Same `Idempotency-Key` and same payload sent twice, immediate plan (`basic`), provider success | Both 201 with the **same** `id`; second has `Idempotent-Replayed: true` | DB (1 subscription, 1 invoice, 1 payment, 1 key row) P (**exactly 1** call) |
| DUP-02 | Same key and same payload sent twice, trial plan (`pro`) | Same `id`; still `trialing` | DB (1 subscription) P (0 calls) |
| DUP-03 | Same key, **different** payload (e.g. other plan) | Second → 422 `IDEMPOTENCY_KEY_REUSED` | DB snapshot unchanged after the 2nd request; P (no new call) |
| DUP-04 | First request times out at the provider, client retries with the same key | Replay returns the original subscription (`trialing`, attempt `timed_out`) | DB (still 1 attempt) P (**no second charge**) |
| DUP-05 | Two requests with **different** keys and the same payload (control) | Two subscriptions | Proves de-duplication is scoped to the key, not to the customer |

### 5.3 Webhook request handling (assignment §1, reliability expectations)

| ID | Scenario | Expected | Checks |
|---|---|---|---|
| WH-01 | Correctly signed `payment.succeeded` | 200 `processed` | ✔ DB |
| WH-02 | Signature with the wrong secret | 401 | ✔ DB snapshot unchanged |
| WH-03 | Missing signature header | 401 | ✔ DB snapshot unchanged |
| WH-04 | Body modified after signing | 401 | ✔ DB snapshot unchanged |
| WH-05 | Malformed JSON (validly signed) | 400 | ✔ DB snapshot unchanged |
| WH-06 | Unsupported event `type` or missing field | 400 | ✔ DB snapshot unchanged |
| WH-07 | Unknown subscription or invoice; invoice of another subscription; amount mismatch | 404 / 422 | ✔ DB snapshot unchanged |

### 5.4 Lifecycle transitions (assignment §2, §E: every valid transition at least once)

| ID | Transition | Driven by | Checks |
|---|---|---|---|
| LC-01 | trialing → active | `BillingRunner` at trial end, provider success | ✔ DB (invoice `paid`, audit) P (amount 4900, idempotency key) |
| LC-01w | trialing → active | `payment.succeeded` webhook reconciling a timed-out first charge | ✔ DB |
| LC-02 | trialing → past_due | `BillingRunner` at trial end, provider decline | ✔ DB P |
| LC-03 | active → past_due | `BillingRunner` at period end, decline (new invoice, attempt 1) | ✔ DB P |
| LC-03w | active → past_due | `payment.failed` webhook reconciling a timed-out recurring attempt | ✔ DB |
| LC-04 | past_due → active | `BillingRunner` retry, success (attempt 2, new idempotency key) | ✔ DB P |
| LC-05 | past_due → canceled | Third failed attempt (retries exhausted, A-06) | ✔ DB (invoice `void`, `canceled_at`) P (3 calls total) |
| LC-06 | active → canceled | API cancel | covered by API-10 |
| LC-07 | trialing → canceled | API cancel | covered by API-11 |

Lifecycle tests are transitions driven by **both API calls and webhooks**, as the assignment requires.

### 5.5 Invalid transitions (assignment §E: at least two; the plan covers five)

| ID | Scenario | Expected |
|---|---|---|
| INV-01 | Canceled subscription receives `payment.succeeded` | 200 `ignored` (`subscription_canceled`); remains canceled; no payment/invoice/audit change |
| INV-02 | Canceled subscription receives `payment.failed` | Same; remains canceled |
| INV-03 | **`payment.failed` after `payment.succeeded` for the same invoice** (different `event_id`s) | 200 `ignored` (`invoice_already_paid`); payment stays `succeeded`; subscription stays `active` |
| INV-04 | Cancel twice | API-12 (409) |
| INV-05 | Cancel `past_due` | API-13 (409) |

U-01 additionally proves every unlisted pair is rejected at domain level.

### 5.6 Webhook idempotency and ordering (assignment §D: mandatory)

| ID | Scenario | Expected | Checks |
|---|---|---|---|
| IDEM-01 | Same `payment.succeeded` `event_id` delivered 5 times | 1st `processed`, then 4 × `duplicate`; transition applied once | DB: one event row with `delivery_count = 5`, one `succeeded` payment, one audit row for the change; P: no new calls |
| IDEM-02 | Same `payment.failed` `event_id` delivered twice | One transition to `past_due`, one failed outcome | DB |
| IDEM-03 | Synchronous charge success, then the provider's `payment.succeeded` webhook for the same attempt | Webhook 200 `ignored` (`invoice_already_paid`); no second payment row; no extra audit row | DB P (1 call) |
| IDEM-04 | `payment.failed` (attempt 1) then `payment.succeeded` (attempt 2) for the same invoice | Legitimate: past_due → active | DB (both attempts retained) |
| IDEM-05 | Duplicate delivery of a `payment.refunded` event | Refund recorded once; no state change (A-08) | DB |

### 5.6a Event-to-attempt reconciliation (`API_CONTRACTS.md` §6.1)

| ID | Scenario | Expected | Checks |
|---|---|---|---|
| REC-01 | Webhook **with** `provider_reference` that matches a stored attempt on the invoice | That attempt is updated (the preferred path) | DB (only that attempt changed) |
| REC-02 | Webhook **without** `provider_reference`; invoice has exactly one unresolved (`timed_out`) attempt | Attempt reconciled → `succeeded`; subscription `active` | DB P (no new call) |
| REC-03 | Webhook **without** `provider_reference`; invoice has **two** unresolved attempts (state seeded deliberately through the fixture) | 200 `quarantined` (`ambiguous_payment_attempt`) | DB: event row `quarantined`; **both attempts, the invoice, the subscription and the audit trail unchanged** (snapshot) |
| REC-04 | `provider_reference` belongs to an attempt on a **different** invoice | 422 `EVENT_REFERENCE_MISMATCH` | DB snapshot unchanged |

### 5.7 Mock provider interaction (assignment §4, §F)

| ID | Scenario | Assertions on the mock |
|---|---|---|
| PAY-01 | Every charging scenario | Exactly one call per genuine attempt with `{ amount, currency, customer_id, payment_method_id, invoice_id, idempotency_key }`. The **values** are asserted, not just that a call happened |
| PAY-02 | Rejected creation, trial creation, cancel, `GET`, any inbound webhook, idempotent replay of `POST /subscriptions` | **Zero** new calls |
| PAY-03 | Retry | New call with `attempt_number + 1` and a different idempotency key; same invoice and amount |
| PAY-04 | Timeout | One call; the attempt is not re-charged by the next `BillingRunner` run; a webhook reconciles it |
| PAY-04b | Timed-out **retry** on a `past_due` subscription | Not retried again. Added after mutation testing showed this path was unguarded by any test |
| PAY-05 | Canceled subscription at period end | `BillingRunner` makes zero calls |

### 5.8 Persistence and partial failures (assignment §3, §G; recruiter: partial failures)

| ID | Scenario | Expected |
|---|---|---|
| DB-01 | `GET` response equals the repository row at every stage of LC and E2E scenarios | Equal |
| DB-02 | Audit history is complete and ordered for a full journey (create → active → past_due → active → canceled) | One row per change, `sequence` without gaps |
| DB-03 | Invoice amount and currency match the plan (basic 1900, pro 4900) | Equal |
| DB-04 | Constraint tests: duplicate `event_id`, duplicate idempotency key, invalid status value | Rejected by the DB |
| PF-01 | Injected failure during webhook processing, then the same event is redelivered | First attempt 500 with **no** partial rows; redelivery `processed` exactly once |
| PF-02 | Provider succeeds, then the local update fails | Attempt stays `pending`; 1 provider call; later webhook → `succeeded`/`active`; still 1 call |
| PF-03 | Provider timeout | Attempt `timed_out`, subscription unchanged, no automatic re-charge (see PAY-04) |

### 5.9 End-to-end workflows

| ID | Journey | Verifies |
|---|---|---|
| E2E-01 | Trial signup → trial ends → charge succeeds → active | API, invoice/payment/audit, provider args (4900, key) |
| E2E-02 | Immediate signup (basic) → active → period ends → decline → past_due → retry succeeds → active | Retry with new attempt and key; both attempts retained |
| E2E-03 | Past-due journey → retries exhausted → canceled → late `payment.succeeded` webhook → still canceled | Terminal state, no reactivation, no new charge |
| E2E-04 | Active → duplicate and out-of-order webhooks (success ×3, then failure for the same invoice) | One outcome, no regression, event rows and `delivery_count` |
| E2E-05 | Immediate signup → provider timeout → `BillingRunner` (no re-charge) → `payment.succeeded` webhook → active | Timeout as an unknown outcome, reconciliation, one charge |
| E2E-06 | Cancel active → `BillingRunner` at period end → stray webhooks | No billing, no state change, API equals DB |

## 6. How key properties are proven

- **Idempotency.** The proof is absence: after N duplicate deliveries, row counts, audit rows and provider call counts equal those after one delivery, and `delivery_count = N`. The same proof applies to replayed `POST /subscriptions` requests carrying one `Idempotency-Key` (DUP-01…04).
- **No guessing on reconciliation.** If an event cannot be matched to exactly one payment attempt, the test asserts that nothing financial changed (REC-03).
- **Out-of-order / conflict handling.** A final payment status is never overwritten (INV-03, E2E-04). Ordering is decided by state monotonicity, not timestamps (A-12).
- **No mutation on rejection.** A `snapshot()` of all business tables is taken before the request and compared after it (WH-02…07, API-04…07, API-12/13).
- **API equals DB.** An explicit `expectApiMatchesDb(id)` runs in scenarios, and the `InvariantChecker` runs after every test.

## 7. Test data and isolation

| Seed | Value |
|---|---|
| Customers | `cust_001`, `cust_002` |
| Plans | `basic` (1900 USD, 0-day trial), `pro` (4900 USD, 7-day trial). Illustrative values only |

- A fresh in-memory database, mock provider and clock per test. There is no order dependence.
- Assertions look up records by the IDs created in the scenario, never "the latest row".
- Builders create scenario-specific data. Raw SQL appears only in repositories.

## 8. Execution

Commands (run from `submission/abhijeet-luthra/`):

- `npm test`: the whole suite.
- `npm run typecheck`: `tsc --noEmit`.
- `npm run lint`: ESLint.
- `npm run validate:schema`: builds the schema in a fresh database and proves key constraints reject bad data.
- `npm run validate`: all of the above, in order.

Results are reported only from actual runs.

**Mutation check.** The tests were also checked by deliberately breaking rules in the service and confirming the matching tests fail. Broken on purpose: the duplicate `event_id` check, the ambiguous-match guard, the Idempotency-Key lookup, the stale-failure guard, and the no-re-charge-on-timeout guard. One mutant (re-charging a timed-out *retry*) initially survived; PAY-04b was added and now kills it.

## 9. Red, Blue, Green order (two-day plan)

1. U-01/U-02 transition tables (Red → Blue → Green).
2. API-01…14 and DUP-01…05 with the repositories, mock provider and builders.
3. WH-01…07 signature and payload handling.
4. IDEM-01…05, REC-01…04 and INV-01…05 (mandatory sections D and E).
5. LC-01…07 via `BillingRunner` and webhooks; PAY-01…05.
6. PF-01…03 partial failures.
7. E2E-01…06 and the invariant checker in `afterEach`.

**Cut line:** if time runs short, trim E2E breadth (keep E2E-02, E2E-03 and E2E-04) before touching any item in steps 1–6.

## 10. Optional enhancements (only after every must-have passes)

| ID | Enhancement | Why it is optional |
|---|---|---|
| OPT-01 | Concurrent in-flight `POST /subscriptions` requests sharing one `Idempotency-Key` | The sequential case is must-have (DUP-01…05). The unique key constraint guards the concurrent case |
| OPT-02 | Concurrent duplicate webhook delivery | The assignment marks it as a bonus |
| OPT-03 | `Notifier` seam and spy, proving duplicate webhooks fire a notification once | The assignment says "if your fixture models one" |
| OPT-04 | Provider "hard error" outcome, beyond success, decline and timeout | **Implemented**: treated as an unknown outcome (`timed_out`, `provider_error`) |
| OPT-05 | Plan-change endpoint | Mentioned in the overview, not among the core operations (A-14) |
| OPT-06 | JSON-schema validation of response shapes | Explicit field assertions already cover the shape |
| OPT-07 | Coverage report | Nice to have |

## 11. Requirement traceability

| Assignment requirement | Covered by |
|---|---|
| §1 API validation (creation, retrieval, cancel, validation errors, webhook handling) | API-01…14, WH-01…07 |
| §2 State machine (every transition, invalid ones, plan-specific behavior) | LC-01…07, INV-01…05, U-01, API-01/02, DB-03 |
| §3 Database (rows per attempt, duplicates recorded, no invalid side effects) | DB-01…04, IDEM-01…05, snapshot assertions, InvariantChecker |
| §4 Mock provider (interface, call count and args, success/decline/timeout) | PAY-01…05, API-02/03, PF-02/03 |
| A Creation & activation | API-01, API-02, E2E-01 |
| B Validation failures | API-04…07, API-12 |
| C Payment failure handling | API-03, LC-02, LC-03 |
| D Webhook idempotency (mandatory) | IDEM-01…05, REC-01…04, E2E-04 |
| E State-machine invariants (mandatory) | LC-*, INV-01…05, U-01 |
| F Provider interaction | PAY-01…05 |
| G Persistence and auditability | DB-01…03, InvariantChecker |
| Reliability: duplicates, out-of-order, timeouts/declines, forged signatures, invalid transitions, persistence mismatches | IDEM, INV-03, PAY-04/PF-03, WH-02…04, INV, InvariantChecker |
| Recruiter: retries, duplicate requests, partial failures | LC-04/05, PAY-03, DUP-01…05, IDEM, REC, API-12, PF-01…03 |
| Required invariants list | `PRE_IMPLEMENTATION_DESIGN.md` §15 ↔ `DATABASE_DESIGN.md` §7 |
| Red/Blue/Green | §9 order; visible in commit history |

## 12. Completion criteria

- Every must-have test passes in an actual run, and the output is recorded in the PR.
- The InvariantChecker passes after every test.
- The suite is repeatable from a clean checkout with one command.
- Each failure message names the business scenario and the violated rule.
- The final PR documents assumptions, limitations, real test results and AI usage.
