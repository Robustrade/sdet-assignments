# Test Strategy for the Subscription & Billing Service

## Why Python instead of TypeScript

The repo's README asks for TypeScript. I built this whole thing in Python and pytest instead. I'm calling that out up front rather than letting a reviewer discover it on their own: if you're expecting a TS/Jest stack, what you'll find here is Python, and that was a deliberate choice on my part, not something I overlooked.

## Approach

No service implementation was given for this assignment, so I went with what the assignment calls Option 2. I built a small Subscription & Billing service fixture (`service/`) that runs in process, backed by an in memory SQLite database, and wrote a pytest suite (`tests/`) against it. Nothing here touches a real network. The Flask app is only ever exercised through its own test client, and the payment provider is always a fake.

What's actually real and what's mocked:

The Flask routing and request handling, the state machine, the SQLite persistence, and the HMAC signature verification are all real code doing real work. The one thing that's mocked is the payment provider (`utils/fake_payment_provider.py`). There's no real provider implementation here, and that's intentional. Building one was explicitly out of scope.

## Domain assumptions

A few calls I had to make since the spec leaves some of this open:

I picked two plans on purpose: `basic` has a 14 day trial and costs $19, `pro` has no trial and costs $49. That way one plan walks through the "starts trialing" path and the other walks through "charged immediately at creation."

I'm treating a billing attempt (the creation charge for a zero trial plan, hitting `/charge` once a trial ends, or `/retry-charge` for a past due retry) as synchronous. The mock's return value or exception (success, decline, or timeout) resolves the invoice and the lifecycle transition in the same request. That models a provider that authorizes synchronously, like a card auth would.

`/webhooks/payment-provider` is meant to model the asynchronous side of a real provider: notifications the service never asked for directly, like the provider's own retry schedule, a delayed settlement, or a refund. That endpoint never calls the payment provider client itself, it's purely inbound. `test_trial_end_can_be_driven_by_a_webhook_alone` in `test_e2e_flows.py` proves this path works entirely on its own, with zero synchronous provider calls involved.

`payment.refunded` gets recorded against the invoice but doesn't drive any lifecycle transition. The lifecycle diagram in the assignment doesn't define one for refunds, and I'd rather leave that gap explicit and documented than invent a business rule that might be wrong.

I also let a `past_due` subscription get canceled through the API, even though the lifecycle diagram only draws `active` and `trialing` going to `canceled`. Blocking a customer with a failing card from canceling felt like the worse default, and the assignment explicitly says extending assumptions for realism is fine, so I made that call deliberately and wrote it down here.

Provider timeouts and declines are treated the same for lifecycle purposes, both fire a `payment_failed` event. A real production system would probably want to retry sooner or page someone specifically on a timeout, but that's out of scope for this fixture.

`MAX_RETRIES` is set to 3. After three failed retries from `past_due`, the subscription gets canceled.

## Design patterns

This is the part of the submission I care most about getting right, so I want to walk through it properly rather than just naming patterns for the sake of it.

| Pattern | Where | Problem it solves |
|---|---|---|
| **State** | `service/state_machine.py` | Each status is its own class that only exposes the transitions legal from it. `Canceled` overrides nothing, so every event on it is a no op by construction. There's no `if status == "canceled": return` scattered around for someone to forget. |
| **Page Object Model (API)** | `api/endpoints/` (`SubscriptionsEndpoint`, `WebhooksEndpoint`) sitting on top of `api/client.py` (`HttpClient`) | This mirrors the UI POM already used in `ui_bonus`. `HttpClient` is the driver that knows the raw HTTP verbs and paths, basically the same job `WebInspector` does for the browser. The endpoint objects are the "pages," readable and reusable actions like `api.subscriptions.create(...)` that every test shares instead of each test knowing routes and methods by heart. |
| **Data driven runner over JSON test data** | `api/runner.py` (`ApiRunner`) plus `tests/api/vars/*.json`, typed through `data/*.py` | This keeps how a request gets run and validated (the runner) separate from what gets sent and expected (JSON, sitting right next to the test class that uses it). Adding a new validation scenario means adding a JSON entry, not writing new test code. |
| **JSON vars per test class** | `utils/data_driven.py` (`DataDrivenTestCase`, `load_class_json`) | A test class that needs data extends `DataDrivenTestCase`. Before every test method, pytest calls `setup_method`, which calls `_setup()`, which loads `vars/<ClassName>.json` from right next to the test file and hands it to the test as `self.data`. This is the same vars folder convention I use in qs-prospector-automation, brought over here so the data layer stays JSON and lives beside the test that owns it instead of inside the test body. |
| **Builder** | `utils/builders.py` | `SubscriptionRequestBuilder`, `WebhookPayloadBuilder`, and `CustomerBuilder` let a test read like intent, `.with_plan("pro").build()`, instead of a repeated dict literal, and they centralize the signing logic for webhook payloads in one place. |
| **Adapter / dependency injection** | `service/payment_provider.py` (the interface) with `utils/fake_payment_provider.py` (the test double) | `BillingService` only ever calls `PaymentProvider.charge(...)`. The concrete implementation gets injected at `create_app()` time, so tests can swap in a fake without touching any service code. |
| **Repository** | `service/repository.py` | All persistence goes through `SubscriptionRepository`, `InvoiceRepository`, `WebhookEventRepository`, and `AuditLogRepository`. Tests assert against these same repository objects (the `repos` fixture), using the reusable helpers in `db/queries.py`, instead of writing raw SQL or list comprehensions inline in every test.

I'll be upfront about why the Page Object Model shows up for an API and not just a browser. POM as a pattern is really about separating a low level driver from a readable, resource scoped facade that tests actually use, and that idea doesn't care whether the driver is a browser page or an HTTP client. `HttpClient` and `WebInspector` play structurally the same role in this codebase. Once I had the UI bonus written that way, it made sense to build the API layer to match it, so the whole framework reads consistently no matter which module you're looking at.

## Test architecture

The suite is split into modules by concern, the same way the `ui_bonus` UI demo already separates `ui/` (page objects) from `tests_ui/` (the tests themselves). I applied that same separation to the API and DB layers here.

`service/` is the fixture under test. Models, the state machine, the repository layer, plan config, the payment provider interface, HMAC signing, and the Flask app itself, which is really just a thin HTTP layer translating JSON into `BillingService` calls.

`api/` is the API's Page Object Model layer, and it's reusable across every single test. `client.py` holds `HttpClient`, the HTTP driver. `endpoints/` holds `SubscriptionsEndpoint` and `WebhooksEndpoint`, one object per resource. `runner.py` holds `ApiRunner`, the data driven request runner and response validator.

`db/queries.py` has reusable read helpers over the repositories (`invoice_statuses`, `has_paid_invoice`, `status_history`) so test files aren't all rewriting the same list comprehension over `repos`.

`utils/` is everything that isn't a test itself but also isn't test logic. `builders.py` has the test data builders, `fake_payment_provider.py` is the mock provider that records every call (customer, amount, currency, payment method, idempotency key) and lets a test queue up per call outcomes like decline, timeout, or success.

`data/` is the schema for the data layer, not the data itself. Plain dataclasses describing the shape of a case, what fields it has and what they default to, with zero request or assertion logic of their own: `subscription_cases.py`, `webhook_cases.py`, `provider_cases.py`, and `state_transitions.py`. The actual values live as JSON, described next.

`tests/api/vars/` and `tests/db/vars/` hold the actual test data, as JSON, one file per test class, named after the class exactly. `TestCreateSubscription` reads from `vars/TestCreateSubscription.json`, `TestWebhookRequestHandling` reads from `vars/TestWebhookRequestHandling.json`, and so on. `utils/data_driven.py` is the helper that loads the right file for a class during `_setup()` and hands it back as `self.data`, and a test method turns one entry into a typed case with `self.case(SubscriptionCreationCase, "some_key")`.

`tests/conftest.py` builds a fresh in memory SQLite DB and a fresh fake provider per test, so there's full isolation, no shared state, and no cleanup step needed. It also wires up the `api` and `runner` fixtures that tie the POM and data driven layers together.

`tests/api/` holds the API level tests, grouped by concern: validation (which is data driven off JSON), the state machine, webhook idempotency, provider interaction, and end to end flows. `tests/db/` holds the DB and persistence level tests.

### Why I didn't force everything into a JSON file

I want to be honest about where I applied the data driven pattern and where I chose not to, because forcing it everywhere would have made the suite worse, not better.

Data driving genuinely fits a test that's just "request in, status and response out." `test_api_validation.py`'s `TestCreateSubscription` and `TestWebhookRequestHandling`, and `test_provider_interaction.py`'s `TestProviderCallCountByPlan`, are exactly that shape: one test method per named scenario, each pulling its own entry out of its class's JSON file. But the multi step flows in `test_e2e_flows.py`, the retries exhausted and out of order scenarios in `test_state_machine.py`, and the duplicate delivery checks in `test_webhook_idempotency.py` each assert a different invariant across a whole sequence of calls. Moving a stateful sequence into a JSON file either loses the story that test is telling, or the JSON secretly becomes a mini script anyway, at which point it's just a worse place to put code than Python is. Those stayed as focused, narrative tests on purpose, with no `vars/` file backing them.

The one place I use the vars convention a little differently is the state machine's transition table. `next_status()` in `service/state_machine.py` is genuinely pure input and output with no side effects, so `TestStateMachineTransitionTable` loads its whole JSON file (`vars/TestStateMachineTransitionTable.json`, all thirteen status and event rows) in `_setup()` and then loops over every row in a single test method, rather than one method per row. A flat matrix like that reads better as a loop than as thirteen nearly identical one line test methods would. That test runs independently of, and alongside, the slower HTTP level lifecycle tests in the rest of the file.

## API validation

Request and response shape and status codes are asserted directly on the Flask JSON responses, driven entirely by `tests/api/vars/TestCreateSubscription.json` and `tests/api/vars/TestWebhookRequestHandling.json` through `ApiRunner` (`tests/api/test_api_validation.py`). Webhook request handling (signature verification, malformed JSON, missing fields) is tested separately from webhook business logic (`tests/api/test_state_machine.py`, `tests/api/test_webhook_idempotency.py`), because a webhook can be perfectly well formed and correctly signed and still turn out to be a no op: stale, duplicate, or for a subscription that doesn't exist.

## Database validation

The entities checked are `subscriptions`, `invoices`, `webhook_events`, and `subscription_events` (the audit log), which covers all four tables the assignment asks about. Invariants get asserted directly against `SubscriptionRepository`, `InvoiceRepository`, `WebhookEventRepository`, and `AuditLogRepository`, using the reusable helpers in `db/queries.py`:

Persisted subscription status always matches the API response (`tests/db/test_persistence.py`). An `active` subscription always has at least one paid invoice on record. A rejected creation never leaves a subscription row behind. Duplicate webhook delivery persists exactly one invoice and one audit entry, never more (`tests/api/test_webhook_idempotency.py`).

Each test gets its own in memory SQLite connection through the `db_conn` fixture, so there's no stale data risk between tests and nothing to clean up afterward.

## Mock payment provider and webhook validation

`FakePaymentProvider` records both the call count and the full call arguments, and tests assert on both, never just "was it called" (`tests/api/test_provider_interaction.py`). The two plans that shouldn't reach the provider at all are a small JSON backed class (`TestProviderCallCountByPlan`, reading `vars/TestProviderCallCountByPlan.json`), while the richer per call argument checks and the decline and timeout handling stay as their own dedicated tests, since a call count alone doesn't capture what those verify.

Idempotency gets proven by sending the identical signed payload twice: the second delivery comes back reported as `"duplicate"`, the subscription transitions exactly once, and exactly one invoice and audit row exist afterward (`tests/api/test_webhook_idempotency.py`). Out of order delivery gets proven by sending a `payment.succeeded` webhook followed by a `payment.failed` webhook for the same `invoice_id`, and checking that the subscription never regresses from `active`.

## State machine coverage

Every transition in the lifecycle diagram gets exercised at two levels. There's a pure table test against `next_status()` directly, reading the whole matrix from `vars/TestStateMachineTransitionTable.json` (`TestStateMachineTransitionTable` in `tests/api/test_state_machine.py`), and there's the same transitions proven end to end through the real HTTP API and database, right below it in the same file. At both levels, at least two invalid transitions are proven structurally impossible: a canceled subscription ignores both `payment.succeeded` and `payment.failed` webhooks and just stays canceled, and a second cancel request against an already canceled subscription gets rejected with a 409.

## Known limitations and next steps

Concurrent or racing webhook delivery for the same subscription isn't covered. The assignment calls this out as a bonus, and the in memory SQLite connection here is single threaded anyway, so there's nothing meaningful to race against without changing the fixture significantly.

`payment.refunded` still doesn't drive a lifecycle transition, as noted above. Given more time I'd want an actual product decision on this rather than a guess.

Plan changes and proration aren't covered, and that's an explicit non goal for this submission.

The service fixture has no standalone run mode. It only exists to be exercised through `create_app()` inside tests. That's intentional scope control, not something I ran out of time for.

## AI usage on this submission

I used Claude Code to help write a lot of the boilerplate here: the initial service fixture, the repository layer, the Flask routes, and the first pass at the pytest suite all started from AI generated code against the assignment spec.

What's mine is the strategy behind it. The domain calls in the assumptions section above, particularly the synchronous versus webhook billing split, the past due cancel extension, and the decision to leave refunds as a documented gap rather than guessing at a rule, those were my calls, reviewed and made deliberately, not accepted as is. The framework architecture is also mine: splitting the codebase into `api/`, `db/`, `utils/`, and `data/`, building the API's Page Object Model layer to deliberately mirror the UI bonus's existing POM structure, and moving the test data out into JSON files under a `vars/` folder next to each test module, one file per test class, loaded through `_setup()`, the same convention I use in qs-prospector-automation. Those were all decisions I made and then had the AI help implement, not the other way around.

If I had to name the one assumption I'm least confident in, it's the refund handling. That's what I'd revisit first if this were a real system instead of a take home assignment.

I ran the full suite locally after the initial build, again after the framework restructure, and again after moving the data layer to JSON, `pytest -q`, all green each time, rather than trusting generated output at face value.
