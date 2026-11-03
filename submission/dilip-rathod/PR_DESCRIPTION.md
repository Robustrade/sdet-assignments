## Summary
No service was provided, so I built a small subscription billing service and a test suite around it. The service is TypeScript and Express, with an in-memory SQLite database. The suite has 142 tests (Vitest).

I wrote the test strategy first ([docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md)) and then built against it. How to run everything is in the [README](README.md).

## Test Strategy
- **Levels covered:** a unit test of the state machine itself; API tests; lifecycle tests that drive every transition through the API, the billing job and webhooks; webhook tests (duplicates, wrong order, races); payment provider tests; database tests; and one end-to-end test that follows a subscription from sign-up to cancellation.
- **In scope:** creating, reading, cancelling and changing the plan of a subscription; billing at trial end, at renewal and on retries; the three webhook types (succeeded, failed, refunded); signature checks; the different rules for the `basic` and `pro` plans.
- **Out of scope:** a real payment provider, running several server instances at once, proration, taxes, other currencies, webhook replay windows, customer management, and API auth.
- **What's real and what's mocked:** the API, the lifecycle logic, the billing logic, the database (real SQL with real constraints) and the signature check are all real code. I only replaced things at the edges: the payment provider, incoming webhooks, and the clock. The point was to fake only what the service doesn't own, and test everything it does own for real.

## OOP & Design Pattern Choices
- **State machine (transition table):** `src/domain/SubscriptionStateMachine.ts`. Code never sets a status directly. It says what happened (for example "charge failed") and the table decides the new status. Only one method in the repository writes the status column, and it goes through the table. The same table also feeds a database trigger, so even a hand-written SQL update can't move a canceled subscription back to active.
- **Strategy:** `src/plans/PlanPolicy.ts`. Each plan is its own class with its price, trial length and retry limit. The billing code asks the plan for these instead of checking `if (plan === 'pro')`. Adding a plan means adding one class.
- **Interface around the payment provider (dependency injection):** `src/payments/PaymentProvider.ts`. The service only knows the `PaymentProvider` interface, and the real object is passed in through `buildContainer()` in `src/container.ts`. In tests I pass in `MockPaymentProvider`.
- **Builder:** `test/support/builders/builders.ts`. Test data reads like a sentence, e.g. `aSubscriptionRequest().forCustomer(c).onPlan('basic')`. It's just as easy to build a broken request (`.without('plan')`), which kept the many validation tests to one line each.
- **Repository:** `src/persistence/repositories/` on the service side, and `PersistenceInspector` on the test side. All SQL lives in these classes, and tests never write queries inline. The test-side inspector has its own queries on purpose, so a bug in the service's queries can't make the tests agree with it by accident.
- **Facade:** `test/support/env/TestEnvironment.ts`. One object sets up everything a test needs: a new database, the clock, the mock provider, the app, and the clients. A test just uses `env().api`, `env().db` and so on.

## API Validation Approach
- The API client has two versions of each call. The raw one returns the status and body, which I use for error tests. The checked one confirms the status and validates the body against a strict schema, so an extra or missing field fails the test.
- Every "this should be rejected" test also checks that nothing was written: row counts in every table are the same before and after, and the payment provider was not called.
- Webhook request handling is tested separately from what the webhook actually does (`test/specs/api/webhook-endpoint.api.spec.ts`). Missing, wrong or tampered signatures get 401. The signature is checked before the body is even parsed, so an unsigned garbage body is 401, not 400. Signed but broken JSON gets 400, and so does a payload with missing or wrong fields. None of these leave anything in the database.
- Error cases covered: missing or wrong-type fields, broken JSON, unknown plan, unknown customer, unknown payment method, using someone else's payment method, cancelling twice, cancelling a past-due subscription, changing plan on a past-due or canceled subscription, changing to the same plan, and unknown ids (404).

## Database Validation Approach
- **Tables checked:** `subscriptions`, `invoices`, `payment_attempts` (one row per call to the provider), `webhook_events`, `webhook_deliveries` (one row per delivery, with duplicates marked), `audit_log`, and `notifications` (stands in for emails sent to the customer).
- **Rules checked after every test** (`test/support/assertions/invariants.ts`):
  - An active subscription always has a successful payment behind it.
  - A canceled subscription has nothing scheduled and no open invoice.
  - A past-due subscription has exactly one open invoice.
  - No invoice is paid twice.
  - Every call to the provider has exactly one matching payment attempt row, and no idempotency key is reused.
  - Invoice amounts match the plan price.
  - The audit log tells a continuous story that ends at the current status.
  - Each webhook event was processed exactly once.
  - Timestamps make sense (nothing is paid before it was created, and so on).
  - What the API returns matches what's in the database.

  These run automatically after every test, so every scenario checks them, not just the tests written for them.
- **Checking the checker:** a few tests break the database on purpose and confirm the checker notices.
- **Every stage, not just creation:** after each step I check the status, retry count, invoice statuses (through both the API and the database) and the audit history together. The end-to-end test runs all the rules again after each of its five stages.
- **Database rules tested directly:** I tried to break the schema with raw SQL (illegal status changes, a second open invoice, duplicate keys, a paid invoice with no paid date) and checked that the database refuses each one.
- **Seeding and stale data:** every test gets a brand-new database, so there's nothing to clean up. Tests never insert subscriptions by hand. They reach each state through the API, the billing job and webhooks, so a test can't start from a state the real service could never produce.

## Mock Payment Provider & Webhook Validation
- **The mock:** `MockPaymentProvider` is a `vi.fn`, and each test tells it what to do next: succeed, decline, stay pending, time out, or hold the call open until the test releases it. Holding the call open is how I test race conditions. Tests check the exact arguments sent (customer, payment method, amount, currency, idempotency key, invoice reference) and how many calls were made. I also check that the provider is **not** called when it shouldn't be: during a trial, on rejected requests, for webhooks, on cancel, when billing runs twice at the same moment, while a charge is still in flight, or for a canceled subscription over the following year.
- **Provider outcomes:** success makes the subscription active. A decline makes it past due and writes no success record anywhere. A timeout changes nothing and does **not** retry straight away (that could charge the customer twice); a webhook settles it later. Pending waits for the webhook.
- **Duplicate `event_id`:** the second delivery is acknowledged as a duplicate and only adds a delivery record. I check there's still one status change, one paid invoice, one notification and one audit entry. I also check that a duplicate failure doesn't use up two retries, a duplicate refund only refunds once, five deliveries at the same time are applied once, and the same `event_id` with a different body is still treated as a duplicate.
- **Out of order or stale:** order is decided per invoice, not by when a webhook arrives. A `payment.failed` that arrives after the payment already succeeded is ignored. So is a late failure for last month's invoice, a refund that arrives before the payment, and an event whose amount or subscription doesn't match. I also tested two races: a webhook arriving while the charge call is still waiting for a reply, and a customer cancelling while a charge is in flight. In both cases the late reply can't undo what already happened.

## State-Machine / Lifecycle Coverage
- **Valid transitions:** all 7 arrows in the diagram are tested, most of them twice (once through a direct provider reply and once through a webhook). There's also a test that compares the covered transitions against the diagram, so if one goes missing the build fails.
- **Invalid transitions:** the unit test tries all 11 combinations that aren't allowed. Through the API and webhooks I checked that a canceled subscription can't be revived by a late success, can't be moved by a late failure, and can't be cancelled again (409), and that a past-due subscription can't be cancelled through the API (409). At the database level, 5 illegal updates and one forged insert are all refused.
- **Plan rules:** pro has a 14-day trial at 4900; basic is charged straight away at 1900. Pro gets 3 retries, basic gets 2. A plan change is billed at the new price from the next invoice.
- **How confident I am:** to check the tests would actually catch bugs, I broke the service on purpose in 6 different ways. The suite caught 5 of them. The sixth removed a check that is also done in two other places, so behaviour didn't change. It did make me add the cancel-during-charge tests.

## Test Architecture
```text
test/support/
  env/          TestEnvironment: a fresh, isolated setup per test; runs the rules check after each test
  api/          HttpClient (only place that knows about HTTP), SubscriptionApiClient, response schemas
  provider/     MockPaymentProvider
  webhooks/     WebhookSimulator: signs webhooks with its own code, not the service's
  builders/     test data builders
  scenarios/    LifecycleDriver: "given an active subscription…" helpers that only use the public API
  persistence/  PersistenceInspector: read-only database queries for tests
  assertions/   state checks, provider checks, the shared rules and their checker
test/specs/     api · lifecycle · webhooks · provider · persistence · e2e
```
The test files only say what should happen. HTTP calls, SQL and payload details each live in one class, so changing one of them means editing one file. A new test gets its own clean setup and all ten rules for free. When something fails, the message says what broke: the status error prints the response body, the rules checker names the rule and the row, and the end-to-end test names the stage.

## Validation
I ran these from a clean install:
```bash
npm ci
npm run lint              # passes
npm run build             # tsc --noEmit, passes
npm run validate-schema   # "Schema OK: 10 tables, 2 indexes, 2 triggers, 7 allowed status transitions."
npm test                  # 11 files, 142 tests, all passing
npm run verify            # runs all of the above
```
I also did the "break it on purpose" check described above, restoring the file each time.

## Known Limitations / Next Steps
- Everything runs in one process, so parallel webhooks get handled one after another. My tests show the app logic is safe; across several servers, the unique `event_id` in the database would be the protection. I tested that constraint directly but not with multiple servers.
- A timed-out charge is never retried; it waits for a webhook. A real system would need a job that asks the provider about charges that never got an answer.
- If the provider takes money for an invoice that was already cancelled, I record it and ignore it. In real life that should trigger a refund or a manual review.
- Cancelling a past-due subscription through the API is rejected, because the diagram doesn't show that arrow. I'd check with the product team, since customers often do want to cancel when they're behind on payment.
- Not covered: webhook replay windows, partial refunds, proration.
- With more time I'd add property-based tests that fire random sequences of events and check the rules still hold, plus proper mutation testing with Stryker.

## Responsible AI Usage
- **Did you use AI tools?** Yes, Claude Code.
- **Where did they help?** Writing the first draft of the strategy doc, the service, the test framework and the tests, running the suite, and the "break it on purpose" check.
- **What did you personally verify or correct?** _[Fill this in yourself: what you read, what you changed, what you re-ran.]_

## Author Checklist
- [x] Linting passes
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes
- [x] Schema/setup validation passes
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [x] README was tested from a clean setup

🤖 Generated with [Claude Code](https://claude.com/claude-code)
