# Validation strategy (written before implementation)

## Scope and test oracle

Option 3: a minimal real Node HTTP service, real embedded SQLite persistence, and an injected mock payment provider. TypeScript, node:test, node:assert and fetch exercise actual loopback HTTP through routing, domain logic, persistence, and the provider seam. This is an assignment fixture, not evidence that a production billing system works. Tests have independent expected outcomes, not expectations derived from the implementation transition table.

Environment adjustment: the initial design used Express/Vitest/Supertest. The npm registry timed out, including an approved install retry, so the final runtime uses only Node built-ins. It preserves the original validation boundaries without an untested dependency installation. The TypeScript compiler and Node declarations are optional development dependencies for static checking; the tests run without installing them.

The host workspace is unrelated SVN/Java work. This solution is isolated in its own folder; no existing application files are modified. No Git remote was supplied. A PR body will be provided locally for submission to the intended repository.

## Assumptions / decisions

- USD integer cents only. Basic costs 1900 with a seven-day trial. Pro costs 4900 with no trial. New subscriptions begin trialing; Pro immediately attempts billing before creation returns.
- Injectable UTC clock, no sleeps or live scheduler. POST /subscriptions/:id/bill is a fixture-only scheduler seam. Before the Basic trial ends it returns 409 without a charge. After activation this explicit trigger represents the next billing cycle. It is not a public production API.
- Successful charge activates; decline sets past_due; third consecutive decline cancels. A success resets the counter. Provider timeouts represent unknown outcomes: keep an invoice pending and return 202; repeat billing reuses the pending attempt and does not charge again. A signed webhook later resolves it. Never turn an uncertain payment into a confirmed failure.
- All financial outcomes use the same reconciliation path. An invoice must already exist and belong to the subscription and match its snapshotted amount/currency. Each attempt gets a unique invoice reference and provider idempotency key.
- Pending/failed -> paid is allowed for a later success. Paid -> failed is ignored. Refunded is terminal for that invoice. For different invoices, only the latest attempt can change subscription lifecycle status; late older invoice outcomes may update that invoice but cannot regress current status.
- Canceled is terminal. Late financial settlement may still be recorded, but cannot reactivate the subscription; new billing attempts are forbidden. This separates financial truth from lifecycle state.
- Refunds require a previously paid invoice, change invoice status, and preserve the historical successful payment. Refunds do not change lifecycle state (the assignment provides no refund lifecycle edge). No outgoing refund API.
- API cancellation is valid from trialing or active only. Repeated cancellation and past_due cancellation return 409 under the supplied transition graph. Retry exhaustion uses a separate explicit transition.
- Plan changes: POST /subscriptions/:id/plan changes basic/pro while trialing or active, preserves existing trial expiry, does not charge/prorate, and takes effect on the next attempt. Existing invoices retain original prices. Pending attempts and canceled/past_due subscriptions reject plan changes. Proration and immediate plan-change billing are out of scope.
- Webhooks use lowercase hex HMAC-SHA256 over the exact raw UTF-8 bytes. Validate signature before parsing. Unknown resource: 404; malformed/unsupported event: 400; invoice mismatch or reused event ID with different content: 409. No production timestamp/replay window; event ID is durable deduplication.
- Trusted valid events are acknowledged synchronously after a SQLite transaction commits; provider delivery is asynchronous relative to the API workflow. No background queue is claimed.

## Contracts

| Route | Success | Failure |
| --- | --- | --- |
| POST /subscriptions | 201 subscription + invoice (or null); 202 if charge outcome unknown | 400 validation, 404 customer |
| GET /subscriptions/:id | 200 subscription | 404 |
| POST /subscriptions/:id/cancel | 200 canceled subscription | 404, 409 invalid transition |
| POST /subscriptions/:id/bill | 200 subscription + invoice; 202 pending | 404, 409 too early/terminal |
| POST /subscriptions/:id/plan | 200 subscription | 400 plan, 404, 409 |
| POST /webhooks/payment-provider | 200 {outcome: applied/ignored/duplicate} | 400 body, 401 signature, 404 reference, 409 conflicting content/amount |

Subscription fields: id, customer_id, payment_method_id, plan, status, trial_end, failures, created_at, updated_at. Invoice fields: id, subscription_id, sequence, amount, currency, status, created_at, updated_at. Errors use {error: string}. Fixture customers include cust_001; payment method format pm_test_* is validated locally.

## Patterns and responsibilities

- Explicit transition table + SubscriptionLifecycle class: sole lifecycle authority; illegal edges throw.
- Builders: SubscriptionBuilder and WebhookBuilder express scenario intent.
- PaymentProvider interface + dependency injection: service never invokes a real gateway; a configurable recording mock stores cloned arguments and supplies success, decline, timeout, and deferred responses.
- Repository: BillingRepository owns SQL and atomic transactions, offers domain queries to verifiers. No SQL in scenario files.
- SubscriptionApiClient hides HTTP mechanics; WebhookSimulator signs raw bodies; BillingVerifier compares independent API expectations with persisted rows and financial/audit invariants.
- BillingHarness owns per-test database, clock, seeded customers, service, client and mock. Tests dispose databases after each case. UUIDs and fresh SQLite eliminate stale-data false positives.

## Persistence and invariants

Real foreign keys, status checks and unique constraints. Entities: customers, subscriptions, invoices, payments (immutable outcomes), webhook_events (one canonical event), webhook_deliveries (each trusted delivery, including duplicates), audit_log (business operations).

Verify at each meaningful stage: API equals stored subscription; active requires a historical succeeded payment; invoice paid requires successful payment; failed invoice has no succeeded record; refunded requires prior success and refund; canceled never transitions; duplicate delivery changes neither invoices, payments, provider calls nor business audit. Event ID and invoice/outcome uniqueness guard accidental replay. All related webhook writes commit or roll back together. File-backed SQLite close/reopen test demonstrates actual durability.

## Coverage matrix to implement

- Contract: create/read/cancel, plan rules, shape/types, unknown IDs, missing fields, invalid plans/customer/payment method, malformed JSON.
- Lifecycle: all seven provided edges; canceled -> active/past_due and trialing -> canceled -> billing rejection; exhaustive independent transition matrix unit test.
- Provider: success/decline/timeout, exact call count and full argument/reference assertions; no calls after invalid requests, reads, cancellation or webhooks.
- Webhooks: raw-byte signature, absent/invalid signatures, malformed body, invoice ownership and amount, duplicate same ID, same ID conflicting payload, different IDs same financial outcome, success then late failure, reversed invoice order, refunded events.
- Persistence: verify both positive outcomes and unchanged snapshots for rejected actions; coherent timestamps, audit sequence, immutable payment outcomes, database reopen and transaction rollback.
- End to end: trial -> failure -> recovery -> cancel; timeout -> webhook resolution; retry exhaustion; plan change with invoice price snapshot.
- Bonus if practical: parallel duplicate delivery and simultaneous billing requests.

## Red / Blue / Green evidence

Start with the irreversible-cancellation regression and capture its failing run before service support exists. Implement the minimum lifecycle, then the service/harness required by scenarios, refactor shared business assertions, and retain passing results. Document actual commands/results, not a fabricated development history.

## Limits / risks

No real provider, production service, auth, distributed locks, webhook queue, taxes, currency conversion, scheduler or proration. Synchronous SQLite transactions prove atomicity in one process, not distributed correctness. The provider call and local commit cannot form a distributed transaction; a production adapter needs gateway-side idempotency and reconciliation after crashes. Pending unknown outcomes block more charges until reconciled. Node's built-in SQLite is experimental on the installed Node 22 runtime. No notifications are modeled. Coverage reports are supporting evidence, not proof of business correctness.
