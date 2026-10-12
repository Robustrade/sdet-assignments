# Approach: Subscription & Billing Test Suite

Status: planning note (dummy PR). Full solution to follow on this branch.

## Understanding
Build an automated test suite for a Subscription & Billing Service
(trialing, active, past_due, canceled), driven by API calls and
signed webhooks from a payment provider.

## Approach
Option 2: build a small TypeScript service fixture (in-memory DB)
and put the test engineering effort into the suite around it.
Stack: TypeScript, Jest, Supertest.

## Test levels
1. API: create, get, cancel, validation errors, webhook signatures
2. State machine: every valid transition + invalid ones
3. Database: subscriptions, invoices, webhook_events, audit log
4. Mock provider: call count and arguments for success/decline/timeout
5. End-to-end: API/webhook -> service -> DB -> provider

## Real vs mocked
- Real: service fixture, state machine, in-memory DB, HTTP layer
- Mocked: payment provider (configurable success/decline/timeout)
- Simulated: signed and forged webhooks posted by the tests

## Design patterns planned
- State machine (transition table): blocks illegal transitions
- Builder: subscriptions, customers, webhook payloads
- Provider interface + dependency injection: swap in the mock
- Repository: DB checks live in one place, not inline in tests

## Key risks to cover
- Duplicate webhooks (same event_id processed once)
- Out-of-order webhooks (late payment.failed must not undo active)
- Canceled stays canceled
- Provider timeouts and declines
- Forged or malformed webhooks
- Subscription and invoice records disagreeing

## Idempotency strategy
Store each processed event_id. A repeated event is recorded as a
no-op: no new invoice, no state change, no provider call.

## Known limitations
No concurrency tests unless time allows (bonus item).
No real provider, no performance testing.