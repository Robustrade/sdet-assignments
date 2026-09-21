# Billing API Validation Framework Blueprint
 
## 1. Purpose
This framework validates a billing service from an SDET perspective: API behavior, persisted state, workflow outcomes, retries, duplicate handling, and recovery behavior.
 
The goal is not to build a large framework or reimplement a billing platform. The goal is a focused, maintainable automation approach around the highest-risk business flows.
 
**No separate billing service was supplied for this exercise.** `src/` therefore implements a minimal Express + SQLite billing service so there is something concrete to validate. `tests/` treats that service as the system under test (SUT) via its HTTP API and persisted state only — specs must not reach into `src/application` or `src/domain` internals directly (the state machine spec, which tests the domain module in isolation, is the one intentional exception). If a real billing service is ever substituted, only `tests/clients` and `tests/repositories` should need to change.
 
The framework should not use browser automation. The primary testing surface is the billing API and its observable side effects (SQLite persistence, the mock payment provider, audit log).
 
Reviewers are evaluating **test engineering**, not the impressiveness of the billing application — `src/` should stay deliberately small. Effort goes into:
 
```text
SUT
 ↓
API
 ↓
Test framework
 ↓
DB verification
 ↓
Mock provider verification
 ↓
State/workflow verification
```
 
---
 
## 2. Domain assumptions
These assumptions define the fixed business behavior the framework validates.
 
### Plans
 
```ts
const plans = {
  basic: {
    price: 1900,
    trialDays: 14,
    immediateCharge: false,
  },
  pro: {
    price: 4900,
    trialDays: 0,
    immediateCharge: true,
  },
};
```
 
### Subscription states
 
```ts
type SubscriptionState =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';
```
 
### Webhook event types
 
```ts
type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';
```
 
### Invoice states
 
```ts
type InvoiceState =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded';
```
 
These assumptions should be treated as the canonical domain contract for builders, validators, and test data.
 
---
 
## 3. Core design principles
 
1. Integrate with the SUT (`src/`) through its HTTP API first; do not bypass it by calling application/domain code directly from specs.
2. Do not replace the SUT with a differently-shaped local implementation inside the test framework — the mock payment provider is the only intentionally-absent external dependency.
3. Make state explicit and domain-driven instead of free-form string checks.
4. Use Vitest as the test runner. This is an API/backend test solution, so browser automation is intentionally out of scope.
5. Let business-risk coverage drive the number of tests rather than a fixed target.
6. Treat the state machine as a first-class business concept.
7. Validate behavior across API response, persistence, workflow/state, and provider interaction layers.
8. Business-rule enforcement lives in the application (`src/`); the test framework verifies the rules were respected, it does not re-implement them.
9. Tests must be deterministic: control external dependencies (payment provider, clock, ids) wherever the real dependency would introduce nondeterminism.
10. Each scenario uses isolated customers, subscriptions, event IDs, and idempotency keys — an in-memory SQLite database is created per test via `BillingTestFixture` so tests never share state.
 
---
 
## 4. Recommended technology stack
 
```text
Vitest
TypeScript
Express
node:sqlite
supertest
```
 
Why this stack:
- Vitest is a fast, TypeScript-native test runner with no browser-automation baggage — appropriate for an API/backend-only assignment.
- Express is enough for a local billing app used in validation tests.
- SQLite provides realistic persistence without heavy infrastructure.
- The test target is API behavior, not browser behavior.
- Use supertest for HTTP calls against the local Express app.
- `node:sqlite` requires Node.js >= 22.5; `createDatabase()` asserts this at startup and throws a clear error on older Node instead of failing with a cryptic module-not-found error.
 
---
 
## 5. Architectural patterns
 
### Repository Pattern
Use repositories for raw persistence behavior only.
 
Examples:
- `SubscriptionRepository`
- `InvoiceRepository`
- `WebhookRepository`
- `AuditRepository`
 
Responsibilities:
- read/write data
- query records by id or customer id
- return domain objects or raw records
- do not contain business validation logic
- `WebhookRepository.exists()` is a read-only, test-only inspection helper; production dedup always goes through the atomic `tryClaim()`.
 
### Builder Pattern
Use builders to create realistic domain objects in tests.
 
Examples:
- `SubscriptionBuilder`
- `CustomerBuilder`
- `WebhookEventBuilder`
 
Responsibilities:
- create valid default objects
- support edge-case overrides
- reduce repetitive setup in specs
 
### Factory Pattern
Used only where the SUT itself needs runtime selection (e.g. `src/factories/PlanPolicyFactory` for plan lookup, `src/factories/ApiClientFactory` for payment-provider selection). Do not introduce factories inside `tests/` — client/repository construction is simple enough that a factory would add ceremony without clarity.
 
### State Pattern / State Machine
This is the most important architectural addition.
 
The framework should model billing state as a domain state machine, not as loose strings.
 
```ts
type SubscriptionState =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';
```
 
### Trigger-driven state model
Use trigger-driven transitions rather than simple `from -> to` comparisons.
 
```ts
enum Trigger {
  PaymentSucceeded,
  PaymentFailed,
  CancelRequested,
  RetrySucceeded,
  RetriesExhausted,
}
```
 
Example function:
 
```ts
transition(currentState: SubscriptionState, trigger: Trigger): SubscriptionState
```
 
Invalid transitions must throw `InvalidTransitionError` and leave state unchanged; the audit log records the rejected attempt.
 
Complete transition matrix (state, trigger → resulting state or `invalid`):
 
```text
trialing + PaymentSucceeded = active
trialing + PaymentFailed = past_due
trialing + CancelRequested = canceled
trialing + RetrySucceeded = invalid
trialing + RetriesExhausted = invalid
 
active + PaymentSucceeded = invalid
active + PaymentFailed = past_due
active + CancelRequested = canceled
active + RetrySucceeded = invalid
active + RetriesExhausted = invalid
 
past_due + PaymentSucceeded = invalid
past_due + PaymentFailed = invalid
past_due + CancelRequested = canceled
past_due + RetrySucceeded = active
past_due + RetriesExhausted = canceled
 
canceled + any trigger = invalid (canceled is terminal)
```
 
`trialing + PaymentFailed = past_due` reflects the assignment's explicit contract (trial ends, first charge fails → `past_due`), not the earlier draft's `invalid`. Because a trial can now land directly in `past_due`, revisit whether `trialing + RetrySucceeded`/`RetriesExhausted` should stay `invalid` once retry counting is implemented — treat them as `invalid` for now (retries are defined as starting from `past_due`), but confirm against the actual SUT contract before finalizing.
 
Retry limits and timing will follow the SUT contract. If not explicitly defined, tests will use a deterministic fixture configuration rather than assuming production values.
 
This reflects real business events instead of a simplistic state graph.
 
### Validator Pattern
Use dedicated validators for each domain concern.
 
Examples:
- `SubscriptionValidator`
- `InvoiceValidator`
- `StateTransitionValidator`
- `ProviderInteractionValidator`
- `PersistenceValidator`
 
Responsibilities:
- compare API output with persisted state
- validate business invariants
- validate state transitions and provider behavior
- return structured mismatches for reporting and assertions
 
### Fixture Pattern
Use a central `BillingTestFixture` to expose all required dependencies.
 
```ts
export class BillingTestFixture {
  readonly subscriptionClient;
  readonly webhookClient;
  readonly paymentProviderMock;
  readonly subscriptionRepository;
  readonly invoiceRepository;
  readonly webhookRepository;
  readonly idempotencyKeyRepository;
  readonly auditRepository;
  readonly stateValidator;
  readonly persistenceValidator;
  readonly providerValidator;
}
```
 
This keeps test specs readable and consistent with enterprise automation frameworks.
 
---
 
## 6. Persistence model
The framework assumes a small relational model suitable for validation tests.
 
### Tables
 
```text
subscriptions
- id
- customer_id
- plan
- status
- created_at
- updated_at
 
invoices
- id
- subscription_id
- amount
- currency
- status
 
webhook_events
- event_id
- event_type
- processing_status
 
audit_log
- subscription_id
- old_state
- new_state
- event_type
- correlation_id
- created_at
 
idempotency_keys
- key
- subscription_id
- response_status
- response_body
- created_at
```
 
Notes:
- `webhook_events.event_id` must be unique.
- `idempotency_keys.key` must be unique.
- `subscriptions.status` must be a strict domain enum, not arbitrary text.
- `audit_log` records state changes and triggering events, tagged with the request's correlation ID for diagnostics.
 
---
 
## 7. Webhook idempotency strategy
This is mandatory and should be explicitly modeled.
 
Every webhook should carry:
 
```ts
interface WebhookPayload {
  event_id: string;
  event_type: string;
  payload: unknown;
}
```
 
### Processing flow
1. Validate signature. Signatures are HMAC-SHA256 of the raw body using a shared secret provided via env var `WEBHOOK_SECRET`. If signature validation fails, respond 401 and do not persist the event or mutate state.
2. Read `event_id`.
3. Attempt to atomically claim the event ID with a single `INSERT` into `webhook_events`. A `UNIQUE` constraint violation (not a prior `SELECT`) is what identifies a duplicate, closing the check-then-act race window under concurrent delivery.
4. If the claim fails (duplicate):
   - record duplicate delivery
   - do not execute business logic
   - do not create invoices
   - do not mutate subscription state
   - return success response
5. If it is new:
   - process once
   - persist the event id
   - apply the relevant billing change
   - create audit entries once
 
### Database enforcement
 
```sql
UNIQUE(event_id)
```
 
This prevents duplicate delivery from generating side effects.
 
### Idempotency invariants
A duplicate webhook must never:
- create invoices
- create payments
- create audit events
- trigger provider activity
- mutate subscription state
 
### Concurrent duplicate delivery
Duplicate webhooks are also tested concurrently (two simultaneous requests with the same `event_id`), not only sequentially. `WebhookRepository` claims an `event_id` with a single `INSERT`; a `UNIQUE(event_id)` constraint violation (not a prior `SELECT`) is what identifies the duplicate, so there is no check-then-act race window even under concurrent delivery.
 
### API idempotency keys
`POST /subscriptions` accepts an `Idempotency-Key` header. A correlation ID and an idempotency key are different concerns:
- a correlation ID traces one request through logs/audit entries.
- an idempotency key identifies one business operation that must not execute twice.
 
Behavior (claim-first, same atomicity guarantee as webhooks):
- the key is atomically claimed with a `pending` `INSERT` before any work starts; a `UNIQUE(key)` constraint violation (not a prior `SELECT`) is what identifies a concurrent or repeated use, closing the same check-then-act race window described above for webhooks.
- first request with a given key: claims it, processes normally, then marks the key `complete` with the stored response — no second subscription, invoice, provider call, or audit entry is ever created for that key.
- repeated request after completion: replays the stored response and status code verbatim.
- a request that arrives while the original is still in flight (claim fails, row still `pending`): rejected with `409` rather than blocking or duplicating work.
- a request that fails (e.g. `ProviderChargeReconciliationError`): its pending claim is released, so the key remains retryable — only successful responses are cached for replay.
 
---
 
## 7a. Consistency and transactional thinking
- A successful synchronous mutation must not return before the required durable state has been committed. `SubscriptionService.createSubscription` performs its provider charge (if any) first, then writes the subscription, invoice, and audit entry inside a single manually-managed `BEGIN`/`COMMIT`/`ROLLBACK` transaction (`runInTransaction`, since `node:sqlite`'s `DatabaseSync` has no built-in `.transaction()` helper), so the API response only reflects state that is already durable.
- If persistence fails after a provider charge has already succeeded, the transaction rolls back (no partial subscription/invoice/audit rows), the request fails with a 500, and a `ProviderChargeReconciliationError` is logged with the provider charge id — this is the documented recovery boundary: the customer may have been charged but no local record exists, and it is flagged for manual reconciliation rather than silently invented recovery logic.
- After any workflow reaches its terminal state (webhook processed, cancellation applied), API-visible state and persisted state must converge to the same value — this is what `PersistenceValidator`/`StateTransitionValidator` prove.
 
---
 
## 8. Business invariants
These are core business rules the framework must enforce.
 
1. Active subscriptions must have at least one successful invoice.
2. Canceled subscriptions can never transition again.
3. Duplicate webhook delivery cannot create invoices, payments, audit events, or provider calls.
4. Persisted subscription state must always equal API-visible state.
5. Provider must be called at most once per genuine billing attempt.
6. Plan pricing used during billing must match plan configuration.
7. A synchronous mutation never reports success without the corresponding durable state committed (see §7a).
8. A replayed `Idempotency-Key` never creates a second business effect.
 
These invariants must be enforced in validators and proven by end-to-end flow tests.
 
---
 
## 9. Local test backend
Because no billing service was supplied for this exercise, `src/` implements a minimal backend for validation to serve as the SUT.
 
### Required stack
- Express
- TypeScript
- SQLite
 
### Required endpoints
 
```text
POST /subscriptions
GET /subscriptions/:id
POST /subscriptions/:id/cancel
POST /webhooks/payment-provider
```
 
This is enough to test:
- creation
- fetch
- cancel
- webhook-based payment processing
- persistence verification
 
---
 
## 10. Project structure
 
```text
src/
  app/
    server.ts
    app.ts
    db.ts
 
  domain/
    Subscription.ts
    Invoice.ts
    Customer.ts
    WebhookEvent.ts
    SubscriptionState.ts
    SubscriptionStateMachine.ts
 
  application/
    SubscriptionService.ts
    WebhookProcessor.ts
    InvoiceService.ts
 
  infrastructure/
    repositories/
      SubscriptionRepository.ts
      InvoiceRepository.ts
      WebhookRepository.ts
      AuditRepository.ts
      IdempotencyKeyRepository.ts
    payment-provider/
      PaymentProvider.ts
      MockPaymentProvider.ts
    sqlite/
      schema.sql
      db.ts
 
  factories/
    ApiClientFactory.ts
    PlanPolicyFactory.ts
 
  routes/
    subscriptions.ts
    webhooks.ts
 
  shared/
    correlationId.ts
 
tests/
  fixtures/
    BillingTestFixture.ts
 
  clients/
    SubscriptionApiClient.ts
    WebhookApiClient.ts
 
  repositories/
    SubscriptionRepository.ts
    InvoiceRepository.ts
    WebhookRepository.ts
    AuditRepository.ts
    IdempotencyKeyRepository.ts
 
  builders/
    SubscriptionBuilder.ts
    CustomerBuilder.ts
    WebhookEventBuilder.ts
 
  validators/
    SubscriptionValidator.ts
    InvoiceValidator.ts
    StateTransitionValidator.ts
    ProviderInteractionValidator.ts
    PersistenceValidator.ts
 
  mocks/
    MockPaymentProvider.ts
 
  specs/
    subscription.creation.spec.ts
    subscription.validation.spec.ts
    state.machine.spec.ts
    webhook.idempotency.spec.ts
    retry.duplicate-handling.spec.ts
    provider.interaction.spec.ts
    lifecycle.e2e.spec.ts
```
 
Specs are grouped by business capability, not by endpoint. `retry.duplicate-handling.spec.ts` covers `Idempotency-Key` replay on `POST /subscriptions` and concurrent duplicate webhook delivery; `webhook.idempotency.spec.ts` covers sequential webhook duplicate handling and signature validation.
 
---
 
## 11. Test coverage strategy
Spec count is fixed by business capability (see §10); test count within each spec is driven by business-risk coverage rather than a fixed target.
 
### Coverage goals
- happy path and failure path
- invalid state transitions verified across all layers (API rejection, DB unchanged, no invoice/provider/audit side effects)
- sequential and concurrent duplicate webhook delivery
- `Idempotency-Key` replay on `POST /subscriptions`
- partial-failure/recovery behavior at the provider/persistence boundary
- provider retries and failures
- persistence validation and API/DB convergence
- end-to-end lifecycle verification
 
---
 
## 12. Failure diagnostics
When a cross-layer test fails, the assertion message should make the failing layer obvious rather than reporting a bare value mismatch. Validators return a `mismatches: string[]` array so specs can attach it directly to `expect(...).toHaveLength(0)` failures, and `BillingTestFixture` exposes the correlation ID, event ID, and idempotency key used by a scenario so they can be included in failure output, e.g.:
 
```text
Expected state: active
API state: active
DB state: past_due
Correlation ID: corr-789
Idempotency Key: idem-123
Failure: API/DB state divergence after workflow terminal state
```
 
---
 
## 13. BillingTestFixture shape
 
```ts
export class BillingTestFixture {
  readonly subscriptionClient;
  readonly webhookClient;
  readonly paymentProviderMock;
  readonly subscriptionRepository;
  readonly invoiceRepository;
  readonly webhookRepository;
  readonly idempotencyKeyRepository;
  readonly auditRepository;
  readonly stateValidator;
  readonly persistenceValidator;
  readonly providerValidator;
}
```
 
This is the shared test harness for all scenarios. Every test gets a fresh in-memory SQLite database and app instance, so customers, subscriptions, event IDs, and idempotency keys are naturally isolated per test without manual cleanup.
 
---
 
## 14. Validation layers
This framework should validate across five explicit layers:
 
- API response validation
- state machine validation
- persistence validation
- provider interaction validation
- end-to-end lifecycle validation
 
Example:
 
```ts
const apiResult = await fixture.subscriptionClient.createSubscription(payload);
const persisted = await fixture.subscriptionRepository.getById(apiResult.id);
 
const stateResult = fixture.stateValidator.validate(apiResult.state, persisted.status);
const persistenceResult = fixture.persistenceValidator.validate(apiResult, persisted);
const providerResult = fixture.providerValidator.validate(apiResult.providerCall);
 
expect(stateResult.mismatches).toHaveLength(0);
expect(persistenceResult.mismatches).toHaveLength(0);
expect(providerResult.mismatches).toHaveLength(0);
```
 
---
 
## 15. Final design rules
1. Tests use fixtures and never instantiate classes directly.
2. Business state is explicit and modeled as a typed domain state machine.
3. Repositories are for persistence only.
4. Validators own comparison logic.
5. Builders create realistic data.
6. Factories are only used inside `src/` for runtime selection; `tests/` construct clients/repositories directly.
7. No browser automation is used for this framework.
8. Coverage favors deep scenario testing (invalid transitions, concurrent duplicates, partial failure) over shallow breadth.
9. Every synchronous mutation is atomic: durable state is either fully committed or fully rolled back before the response is sent.
 
---
 
## 16. Final recommendation
For this billing API project, use a backend-led validation framework built around:
 
- explicit subscription state machine
- repository-based persistence layer
- factory-based runtime selection (kept inside `src/`, not the test framework)
- domain builders for realistic inputs
- mock provider for external payment behavior
- dedicated validators for state, persistence, and provider actions
- API `Idempotency-Key` replay and concurrent webhook duplicate-delivery coverage
- documented partial-failure/recovery behavior at the provider/persistence boundary
- cross-layer failure diagnostics (correlation ID, idempotency key, event ID)
- a small number of business-capability-oriented spec files
 
This gives a stable, enterprise-style framework that is clear, reusable, and aligned with billing-domain requirements.