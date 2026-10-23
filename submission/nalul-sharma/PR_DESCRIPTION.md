## Summary
Implemented Kulu-Sdet-Assigmnent as a hybrid TypeScript subscription and billing test harness with local HTTP APIs, in-memory persistence, explicit lifecycle transition enforcement, signed webhook handling, and an injected fake payment gateway.

## Test Strategy
Levels: HTTP/API contracts, state machine, provider integration, persistence/audit and cross-layer workflows. In scope: creation/retrieval/cancel, simulated billing and retries, invalid input, duplicate/stale webhooks, signatures, declines/timeouts. Out of scope: real DB crash durability, parallel races, scheduler, proration and UI. Real: HTTP/domain/persistence logic. Mock: payment provider.

## OOP & Design Pattern Choices
Transition table: `src/domain.ts`, prevents illegal edges. Builders: `src/builders.ts`, readable test data. Dependency injection/Strategy seam: `PaymentGateway` interface injected into `SubscriptionBillingService`, `FakePaymentGateway` records exact arguments. Repository: `src/repository.ts`, separates persistence verification from transport.

## API Validation Approach
Typed `BillingApiClient` sends HTTP requests and tests assert status, shape and persisted state. Webhook HMAC is verified over raw bytes before JSON parse; forged signatures, malformed signed JSON, bad schema and mismatched invoice details are rejected.

## Database Validation Approach
In-memory repository exposes subscriptions, invoices, webhookEvents, webhookDeliveries and audit. Tests compare API results against stored rows, check invoice outcomes, event uniqueness, audit counts and absence of invalid side effects. Fresh fixture per test avoids stale data.

## Mock Payment Provider & Webhook Validation
Injected fake supports success, decline and timeout; tests assert exact charge count, customer, payment method, amount, invoice reference and idempotency key. Same event_id twice yields one canonical event and one state transition; a stale failure cannot overwrite a paid invoice; canceled subscriptions cannot be reactivated.

## State Machine / Lifecycle Coverage
trialing -> active/past_due/canceled, active -> past_due/canceled, past_due -> active/canceled. Invalid edges include canceled -> active and active -> active via charge_success. Tests also assert stale webhook behavior.

## Test Architecture
Isolated fixtures, API client, Builders, provider fake, explicit domain state machine and repository; tests describe behavior rather than transport implementation.

## Validation
Run `npm test`, `npm run build`, `npm run lint`, `npm run validate-schema` and paste your actual results here before submitting. Do not claim commands ran unless personally verified.

## Known Limitations / Next Steps
In-memory persistence does not survive process restart; no atomic multi-instance deduplication, concurrency guarantees, real provider, scheduler or full plan-change API. See `TEST_STRATEGY.md`.

## Responsible AI Usage
AI assisted with drafting the fixture, test scenarios, documentation and initial code structure. Before submission, personally review and verify domain assumptions, code, test results and claims; update this section to accurately reflect your own review and modifications.

## Author Checklist
- [ ] Lint passes
- [ ] Type check passes
- [ ] Test suite passes
- [ ] Schema validation passes
- [ ] All listed lifecycle transitions tested
- [ ] At least two invalid transitions tested
- [ ] Duplicate event_id tested
- [ ] README verified from clean setup
