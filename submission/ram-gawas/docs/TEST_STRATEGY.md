# Test Strategy

## System Under Test and Assumptions

The system is a local subscription/billing fixture with an Express API, a coordinating service, a state transition table, a plan registry, and SQLite repositories. It models `trialing`, `active`, `past_due`, and `canceled` subscriptions. Basic/pro pricing and trial lengths are configuration; a trial end date does not initiate scheduled billing.

The payment gateway is simulated. Amounts have no currency field, webhook invoice IDs are payment primary keys, and the database exists only for the test environment's lifetime. These assumptions keep the suite focused on observable state changes and side effects.

For installation and execution commands, see the [README](../README.md).

## Scope and Test Levels

The current suite has 58 tests across 8 files. Tests are selected around state transitions, externally visible errors, persistence, and duplicate side effects rather than a target line-coverage percentage.

| Test file | Purpose |
| --- | --- |
| `subscription-state.spec.ts` | Legal lifecycle paths and selected forbidden transitions, including terminal cancellation. |
| `subscription-service.spec.ts` | Workflow orchestration, payment outcomes, default/override pricing, trial dates, webhook ordering, and provider interactions. |
| `api.spec.ts` | Real HTTP routing, validation, status codes, signatures, and consistency between responses and storage. |
| `subscription-repository.spec.ts` | Subscription round trips and state updates. |
| `persistence.spec.ts` | Payment storage and event-ID recording. |
| `mock-payment-provider.spec.ts` | Deterministic provider responses and recorded charge arguments. |
| `plan-registry.spec.ts` | Supported configurations and rejection of unknown or inherited object keys. |
| `builders.spec.ts` | Defaults, scenario overrides, and independence of constructed objects. |

API tests integrate the real backend layers with an injected mock gateway; they are not deployed-system or real-gateway end-to-end tests. Tax, multiple currencies, proration, production monitoring, performance, concurrency, and external gateway contracts are outside the implemented scope.

## Real and Mocked Components

Express, the service, transition table, plan registry, repositories, and SQLite are real. This catches integration errors that mocked repositories could hide, including SQL mapping and duplicate-key behavior.

Only the payment provider is replaced for workflow tests. Its explicit success, decline, and timeout controls make outcomes repeatable and its call history supports checks on arguments and unintended charges. Plan tests spy on `Date.now()` to assert exact trial end dates without waiting.

## Design Patterns and Test Support

- The **State Machine** gives lifecycle rules a small, directly testable surface.
- **Dependency Injection / Strategy** supplies `PaymentProvider` behavior without network variability.
- **Repositories** separate storage operations from workflows while permitting independent persistence checks.
- The **Configuration Registry** keeps plan rules in one place; parameterized tests exercise both configurations.
- **Builders** express relevant input differences while keeping malformed API payloads explicit. Assertions retain literal expected values rather than deriving expectations from the same builder under test.
- The shared **fixture helper** centralizes wiring. It is a factory for fresh environments, not a singleton or an additional production abstraction.

## API Validation Strategy

Supertest sends requests through the Express middleware and handlers. Tests assert status codes and response bodies, then query repositories where persistence matters. Covered rejection cases include missing subscription fields, unsupported plans, unknown subscription retrieval, repeat cancellation, missing/invalid webhook signatures, and an incomplete webhook payload.

Signed success/failure, replay, and stale-failure requests use `generateWebhookSignature`. This exercises acceptance through the actual handler, but using the same signing algorithm as production is not an independent cryptographic test vector or proof of compatibility with a provider's wire format. Payload validation is deliberately basic, and not every handler branch has a dedicated test.

## Persistence and Provider Strategy

Checks cover subscription state, trial dates, payment count/status/amount, and recorded event IDs. The stale-failure service test reads audit rows directly and verifies that success is marked processed and failure ignored. Audit data resides in `webhook_events`; there is no separate audit entity or invoice table.

Payment tests verify charge arguments and counts. A timeout leaves the tested subscription trialing with no payment record; webhook tests verify zero provider calls. Storage checks run against real in-memory SQLite, but do not test disk durability, migrations, foreign-key enforcement, or recovery after an interrupted sequence of writes.

## Webhook and Idempotency Strategy

The important sequences are:

1. A signed success or failure changes state and persists the corresponding payment.
2. Replaying the same event ID leaves one payment and does not call the provider.
3. Success followed by a distinct failure event for the same invoice leaves the subscription active and the single payment successful. Both event IDs remain recorded; the stale failure has `processed = 0`.
4. A success webhook for a canceled subscription is ignored without creating a payment or reactivating the subscription.

The implementation also marks invalid transitions as unprocessed. Signature/payload rejection happens before service processing and does not create audit rows. These tests establish sequential behavior for specific event sequences, not universal ordering reconciliation or exactly-once execution under concurrent delivery.

## Important Invariants

The suite protects these expectations in supported workflows:

- Cancellation is terminal.
- Activation has a successful persisted payment behind it.
- Duplicate event IDs do not duplicate payment side effects.
- A stale failure does not downgrade an already successful invoice.
- Incoming webhooks never trigger a new provider charge.
- Returned state and persisted state agree.

Direct repository writes can bypass lifecycle rules. “One provider call” assertions describe the tested payment attempt, not a system-wide retry or deduplication guarantee for direct charges.

## Isolation Strategy

Service/API `beforeEach` hooks construct independent environments. Their `afterEach` hooks restore spies and close the database, including after assertion failures. Each environment gets a new payment mock, so configured outcomes and call histories do not leak between tests. Builders copy their flat request objects on `build()`.

The two repository suites also allocate a fresh in-memory database per test but currently omit explicit close hooks. Pure state, plan, and builder tests do not need databases. Fixed identifiers are safe because database-backed tests do not share storage.

## Risks and Limitations

The largest remaining gap is write atomicity: event audit insertion, payment insertion, and state updates are separate operations. An error can leave partial data, and a recorded event ID can prevent a subsequent replay from completing the missing work. There are no fault-injection or race tests for this.

Payment records are insert-only. A failed invoice followed by success with a different event ID can encounter the same payment primary key; current ordering tests cover the reverse sequence only. Recurring successful invoices while already active are also outside the transition model (`active + PAYMENT_SUCCEEDED` has no transition).

Other gaps include timestamp-generated direct payment ID collisions, charging before checking transition legality, no automatic retry/trial-expiry execution, basic input validation, and no independent HMAC vectors or timestamp freshness checks. Tests do not establish production security, performance, or gateway compatibility. These gaps are documented rather than changing implementation to fit broader claims.

## Red / Blue / Green Workflow

The incremental behavior-first approach uses **Red** to identify a business rule and its test scenario, **Blue** to implement the required support, and **Green** to extract reusable setup and clarify abstractions while preserving assertions. Builders and the fixture were introduced after behavior coverage existed. This is a description of the development approach, not a verified commit-by-commit TDD history.

## Responsible AI Usage

AI assisted implementation, test scaffolding/refactoring, review suggestions, and documentation. Requirements and expected invariants came from the developer. Generated changes were checked through code inspection, retained assertions, local Vitest runs, and TypeScript compilation. Automated checks do not substitute for the submitter's final manual review; no blanket claim of independent human review of every change is made.
