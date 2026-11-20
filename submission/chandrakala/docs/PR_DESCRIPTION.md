# Validate subscription lifecycle, payments and persistence through a TypeScript API framework

## Problem and resulting behavior

Billing errors can hide behind successful HTTP responses: duplicate events can charge twice, late failures can undo a successful payment, and cancellation can be reversed accidentally. This submission adds a minimal service fixture and an object-oriented validation framework that checks API results against financial records, audit history, lifecycle rules and provider calls.

## 1. Test strategy

Option 3, hybrid fixture. Real loopback HTTP server and SQLite; mocked external payment provider. Coverage includes API contract/negative cases, state-machine unit tests, persistence integration tests, provider interaction tests and complete API/webhook-to-database flows. All seven required lifecycle transitions and nine forbidden state/trigger pairs are covered. No UI, live gateway, taxes, proration, production scheduler or distributed-performance testing.

## 2. Object orientation and patterns

- **Explicit state machine:** SubscriptionLifecycle is the sole authority for changing lifecycle status; invalid edges throw instead of allowing scattered status assignments.
- **Builder:** SubscriptionBuilder and WebhookBuilder make test intent visible and reduce repeated payloads.
- **Dependency injection / provider interface:** BillingService depends on PaymentProvider. MockPaymentProvider records cloned call arguments and supplies success, decline, timeout or deferred results.
- **Repository:** BillingRepository encapsulates SQL, queries and transactions; scenario files contain no raw SQL.
- API client, harness and verifier separate transport, environment ownership and business assertions.

## 3. API validation

Typed client calls exercise real HTTP parsing and routing. Runtime assertions check status codes, complete representative payloads, errors, plan validation and rejected requests. Webhooks verify HMAC-SHA256 over raw bytes before parsing; tests include absent/forged signatures, malformed data, invoice ownership/amount mismatch, unknown references and conflicting event IDs. `/bill` is explicitly a fixture scheduler seam.

## 4. Database validation

Checks cover subscriptions, invoices, immutable payment outcomes, webhook_events, webhook_deliveries and audit_log. Reusable verification compares fetched subscription state with database rows, checks payment prerequisites, invoice/payment coherence, references, timestamps and continuous audit transitions. Fresh per-test SQLite prevents stale-data false positives. A file-backed reopen test proves durability; fault injection after financial writes proves transaction rollback; a uniqueness test exercises a real database constraint.

## 5. Provider and webhook confidence

Assert exact amounts, customer/payment-method IDs, invoice references, idempotency keys and call counts. Rejected input, cancellation and webhook replay never cause extra charges. Timeouts leave a pending invoice and return 202 rather than inventing failure/success. Repeated billing while pending reuses the attempt. Signed callbacks resolve it. Duplicate delivery is auditable while financial effects occur once. Distinct event IDs cannot duplicate the same invoice outcome. Tests cover success-then-failure, old/new invoice ordering, refunds, terminal cancellation, parallel duplicate delivery and an in-flight provider request.

## 6. Architecture, assumptions and tradeoffs

The suite separates scenario specifications, builders, harness, typed HTTP client, webhook simulator, recording provider mock, verifier, domain, service and repository. All state is test-local; clock advancement avoids sleeps. Basic has a seven-day trial/1900-cent price; Pro charges immediately at 4900 cents. Plan changes apply to the next invoice without proration. Refunds retain successful history without an unspecified lifecycle change. Late settlement may update a canceled subscription's financial records but cannot reactivate it.

The final runtime uses Node's HTTP/fetch, test/assert and SQLite modules because registry downloads timed out. Tests need no runtime packages. This departs from the suggested Jest/Vitest/Supertest stack while retaining the requested boundaries and TypeScript. Node 22's transformation and SQLite are experimental. Single-process atomicity is not a distributed exactly-once guarantee. Remote-charge/local-commit crash recovery requires a production reconciliation mechanism. Creation and the fixture scheduler endpoint do not promise client-request idempotency.

## Validation

- 79 tests passed; 0 failed/skipped on Node 22.16.0.
- Source-only native coverage: 98.88% lines, 99.44% branches, 100% functions; transformation affects coverage accounting.
- Red regression was observed failing before implementation, then passing; full suite passed after fixing an integration defect. Details in `docs/VALIDATION.md`.
- Static TypeScript checking remains pending because compiler/declaration packages could not be downloaded. Before merge, run `npm install` and `npm run typecheck` in a network-enabled environment and address any errors.

## 7. Responsible AI usage

Codex assisted with strategy, code, test scenarios, documentation and execution. Automated checks exercised runtime behavior, exposed and corrected an SQL placeholder defect, and verified rollback, replay and persistence. This description does not claim candidate review or understanding on the candidate's behalf. Before submission, the candidate should personally inspect and run the solution, confirm the business assumptions and be prepared to explain the design and limitations.
