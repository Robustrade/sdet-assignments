# Subscription and Billing Service — Test Strategy

## 1. Purpose and scope

This submission uses **Option 2: a minimal service fixture**. The repository did
not provide a running subscription service, so a small TypeScript/Express
implementation was created to give the automation a real HTTP boundary,
business logic, and queryable persistence to exercise.

The test objective is to verify the behavior that matters for a stateful billing
workflow: subscription lifecycle changes, billing side effects, webhook
authenticity and idempotency, and consistency between API responses and stored
records. The implementation is intentionally a test fixture, not a production
billing platform.

### In scope

- Subscription creation, retrieval, and cancellation endpoints.
- Direct payment attempts through a replaceable provider interface.
- Signed payment-provider webhook handling for success, failure, and refund.
- SQLite persistence for subscriptions, invoices, payments, processed webhook
  IDs, and status audit records.
- State-machine transition rules and observable database effects.

### Out of scope or not implemented

- Plan changes, proration, configurable trial lengths, or immediate-charge
  subscription plans.
- Customer and payment-method registration/validation. The fixture accepts a
  customer ID as input; it does not maintain a customer directory or accept a
  payment method ID.
- Real payment-provider calls, external network behavior, notifications,
  authentication/authorization, or production deployment concerns.
- Concurrent webhook race testing.

These are explicit fixture limitations, not behaviors claimed as verified.

## 2. System under test and assumptions

The service is implemented in `src/` and exercised through Express routes using
Supertest. SQLite is an in-memory database initialized from
`src/database/schema.ts`; test code can query it to independently verify
persisted side effects.

The fixture's current assumptions are:

- Supported plans are `basic` and `pro`, priced at 1000 and 2500 minor units.
- A new subscription begins in `trialing`.
- Payment success activates a `trialing` or `past_due` subscription.
- Payment failure moves a `trialing` or `active` subscription to `past_due`.
- A customer can cancel a `trialing` or `active` subscription.
- Exhausted retries can cancel a `past_due` subscription through the service
  method; no HTTP retry-exhaustion endpoint is defined.
- Webhook requests are signed with HMAC-SHA256 over the raw JSON request body.
  The local default secret is for development/testing only and must be replaced
  by configuration in any deployed environment.

The API currently exposes:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/subscriptions` | Create a subscription |
| `GET` | `/subscriptions/:id` | Retrieve a subscription |
| `POST` | `/subscriptions/:id/cancel` | Cancel a subscription |
| `POST` | `/subscriptions/:id/pay` | Exercise a direct payment attempt |
| `POST` | `/webhooks/payment-provider` | Process a signed payment event |

`POST /subscriptions/:id/pay` is a fixture convenience for exercising provider
behavior; it is not one of the minimum domain routes in the assignment.

## 3. Test levels and evidence

The suite uses three complementary levels:

1. **API/workflow tests** send HTTP requests through the Express application and
   check response data and relevant database state.
2. **State-machine unit tests** check allowed and rejected status/event pairs.
3. **Repository tests** check persistence operations independently of the HTTP
   layer.

The current automated evidence is:

| Area | Current coverage |
|---|---|
| API contract | Create and retrieve subscriptions; missing subscription; cancel and reject repeated cancellation; missing customer and plan; unsupported plan |
| Payment workflow | Basic/pro success, decline, timeout, trialing-to-past_due-to-active retry path, and rejection of charge on canceled subscriptions |
| Lifecycle | Allowed transitions, invalid canceled transitions, cancellation, retries exhausted, and persisted direct-payment transitions |
| Webhooks | Success, failure after prior success, refund, duplicate event, canceled-subscription success, missing/invalid signature, malformed fields, unsupported event type |
| Persistence | Subscription, invoice, payment, webhook-event, and audit-log assertions; no persistence/provider side effects for invalid create/webhook requests |
| Provider interaction | Exact call count and request arguments for success, timeout, and retry; no provider call for rejected charge, webhook processing, duplicate delivery, or invalid creation |

These tests provide meaningful coverage of the assignment's core lifecycle,
idempotency, provider-seam, and persistence risks. Some domain details remain
outside the fixture scope, including customer/payment-method validation,
plan-change/proration behavior, plan-specific trial lengths, and concurrent
webhook races. The test suite also does not claim exhaustive malformed-JSON
parser behavior or production security/deployment validation.

## 4. Test architecture and design choices

The implementation applies a small number of patterns to concrete concerns:

- **State machine / transition table** — `src/state-machine/subscription-state.ts`
  maps a current state and event to a permitted next state. An absent mapping
  throws instead of silently accepting an invalid transition.
- **Builder** — `builders/subscription.builder.ts` provides configurable
  subscription model data, and `builders/webhook-event.builder.ts` provides
  readable webhook payload construction for workflow tests.
- **Strategy / dependency seam** — `src/providers/payment-provider.ts` defines
  the provider contract, and `MockPaymentProvider` supplies configurable
  success, decline, and timeout behavior while recording calls. The service
  depends on the interface rather than a real provider.
- **Repository pattern** — subscription, billing, and audit persistence are
  kept in repository classes. Database dependencies are injectable so tests can
  construct an isolated app/database fixture.

`tests/support/subscription-test-fixture.ts` provides a per-test in-memory
database, app, mock provider, typed API client, webhook signing helper, and
persistence verifier. The API workflow tests use this fixture for independent
state and explicit assertions. The original API scenarios retain the default
application instance for baseline coverage, but clear all database tables and
provider state before each test; individual tests create their own prerequisites
instead of relying on prior test execution order.

## 5. Persistence strategy and invariants

The database schema is defined in `src/database/schema.ts`.

| Entity | Purpose | Current test evidence |
|---|---|---|
| `subscriptions` | Subscription identity, plan, lifecycle status, timestamps | API response is compared with persisted status across payment transitions; validation and canceled-state behavior checked |
| `invoices` | Billing attempt amount and outcome | Success, decline, timeout, retry, and webhook outcomes are checked |
| `payments` | Payment outcome and transaction reference | Status and amount are checked for direct payments and webhook processing |
| `webhook_events` | Processed event IDs for idempotency | Processed event count is checked; duplicate delivery produces a single stored event |
| `audit_logs` | Subscription status transition history | Expected transition sequence and no duplicate transition record are asserted |

The intended invariants are:

- Invalid state transitions are rejected by the transition table.
- A repeated webhook `event_id` is acknowledged as a duplicate and is not
  processed a second time.
- A delayed failure for an invoice already marked successful does not regress
  the subscription or overwrite successful billing statuses.
- API-visible subscription status should agree with the persisted row.
- A successful activation should have a corresponding successful payment
  record.
- A canceled subscription should not be reactivated by later payment events.
- A real billing attempt should call the provider once with the plan amount and
  customer reference; invalid actions should not call it.

The tests directly assert these invariants in the covered workflows. The
activation invariant is demonstrated for successful direct payment and
successful payment webhook scenarios; it is not asserted as a global database
constraint.

### Test data and cleanup

Persistence is in-memory and discarded when the test database is closed.
Workflow tests construct and close a fresh database for each test. Webhook
preconditions are seeded through the persistence verifier with explicit IDs;
service-created records use generated IDs. The original API suite clears
foreign-key-dependent tables before each test. This combination prevents
cross-test state leakage while keeping test setup explicit and queryable.

## 6. External integration and webhook approach

No real payment service is contacted. `SubscriptionService` calls the
`PaymentProvider` interface, and `MockPaymentProvider` records each request and
returns a configured result. Tests cover success, decline, and timeout. They
assert call count and arguments on representative success, retry, and timeout
flows, and assert no provider call occurs for rejected charging or webhook
replay.

Webhook tests construct signed JSON requests using the test secret and send
them through the actual Express route. The route captures the raw body,
recomputes the HMAC, compares signatures using `timingSafeEqual`, validates
required identifiers and event type, and processes accepted events in a
database transaction. Tests verify success, missing/invalid signature,
malformed required fields, unsupported event type, duplicate delivery,
out-of-order failure, refund, and a success delivered after cancellation. For a
canceled subscription, the success webhook records the provider's successful
billing outcome but leaves the subscription canceled and does not add a status
transition audit record.

## 7. Running the checks

From `submission/chandana-ts`:

```bash
npm install
npm test -- --runInBand
npm run typecheck
npm run test:coverage
```

`npm test` runs Jest tests from `tests/**/*.test.ts`. Tests use the Node
environment configured in `jest.config.js`.

## 8. Test-first and improvement discipline

For behavior changes and new coverage, use the assignment's Red/Blue/Green
discipline:

1. **Red:** add a focused test that fails for the missing behavior or invariant.
2. **Blue:** make the smallest implementation or fixture change required to
   satisfy it.
3. **Green:** refactor setup/assertions into shared helpers where useful, then
   rerun focused tests and type-checking.

The submitted repository snapshot contains the resulting tests and
implementation; it does not preserve intermediate Red/Blue/Green history.

## 9. Risks and next priorities

Recommended next steps, ordered by remaining assignment relevance:

1. Add plan-specific trial duration and payment-method/customer validation only
   if expanding the fixture scope is preferred over documenting the current
   simplification.
2. Add plan-change/proration behavior only if the assignment is expected to
   assess that domain path.
3. Consider concurrent webhook delivery tests as a bonus; current SQLite
   transaction and unique event-ID behavior are not stress-tested under races.
4. If the suite grows, move the remaining direct SQL in legacy tests into the
   persistence verifier and expand invalid invoice/payment-reference coverage.
