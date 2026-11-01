## Summary
Playwright + TypeScript test suite (53 tests) for a Subscription & Billing Service, with a small in-process
service fixture (Option 3: Hybrid). Run: `npm install && npm test`. Strategy: `APPROACH.md`.

## 1. Test strategy
- **Levels:** state-machine rules → API → webhooks → payment provider → database consistency → end-to-end journeys.
- **Real:** HTTP server, business logic, state machine, database rules, signature check. **Faked:** payment provider, clock. Database is in memory.
- **Out of scope:** plan changes, real database, multi-server concurrency, billing calendar.

## 2. OOP and design patterns
- **State machine table:** status changes only through `Database.applyEvent()`, which uses the table. A canceled subscription has no allowed moves.
- **Builder:** request and webhook builders keep tests short and focused.
- **Provider interface (DI):** `MockPaymentProvider` implements the same interface as a real provider.
- **Repository:** `Database` is the only data access and enforces unique event ids / idempotency keys.
- **Fixtures (factory):** a fresh server + database + mock per test.

## 3. API validation
Exact response bodies, status codes (201/200/400/401/404/409/422) and error codes. For rejected requests we also
check that nothing was saved and nothing was charged.

## 4. Database validation
API vs database compared at every step of a full lifecycle; invoices per attempt; audit history; stored webhook
events (including ignored ones with reasons). An automatic fixture checks business rules after **every** test
(active ⇒ has a successful payment, canceled_at ⇔ canceled, prices/trial follow the plan, audit history is a chain
of allowed moves). One test breaks data on purpose to prove this check can fail.

## 5. Payment provider and webhooks
The mock records every call; tests check the full charge (customer, card, amount, currency, invoice, idempotency key),
one call per attempt, and no calls for rejected requests or webhooks. Duplicates (2×, 3×, 5× in parallel) change
status once, create one invoice and one email. Wrong-order events cannot undo a paid invoice. A timeout leaves the
invoice pending and blocks re-charging (no double charge).
**Confidence check:** 9 bugs were injected into the service one at a time; the tests caught all 9.

## 6. Test architecture
`src/` (service) · `tests/fixtures.ts` (setup) · `tests/helpers/` (clients, mock, builders, scenarios, rules) ·
`tests/*.spec.ts` (tests grouped by concern). Tests read like sentences and only use helpers.

## 7. Responsible AI usage
<!-- Write this yourself, honestly: what AI generated, what you reviewed, ran, changed and understood. -->
