# Subscription & Billing Service — SDET solution (gunjanverma1498)

## Summary
An object-oriented test framework for a Subscription & Billing Service, plus a
minimal service fixture under test (Option 2 — no service was provided). The
suite validates behavior at four levels — API contract, lifecycle state machine,
persistence, and mocked payment-provider interaction — and treats webhook
idempotency and out-of-order delivery as first-class concerns. 55 tests across 9
spec files; `build`, `lint`, and `test` all pass.

## Test Strategy
- **Levels covered:** unit (state machine), API/contract, integration
  (service + store + provider), end-to-end.
- **In scope:** creation/retrieval/cancellation, every lifecycle transition and
  proven-impossible ones, invoice/webhook-event/audit persistence, provider call
  count/arguments under success/decline/timeout, webhook idempotency and
  out-of-order/stale delivery.
- **Out of scope:** real payment integration, UI, proration/tax/multi-currency,
  performance, monitoring; concurrent webhook delivery (noted as a next step).
- **Real vs mocked:** the service, state machine, persistence logic, HTTP layer,
  and HMAC signatures are real. The store is in-memory behind repositories; the
  payment provider is a recordable fake; webhook delivery is simulated with
  signed/unsigned/malformed payloads. Full rationale in `DESIGN.md §4`.

## OOP & Design Pattern Choices
- **Transition-table state machine** (`src/domain/stateMachine.ts`): one authority
  for the lifecycle. Nothing else mutates `status`, so illegal transitions
  (`canceled → active`) are structurally unreachable instead of guarded ad hoc.
- **Builder** (`tests/support/builders/*`): readable scenarios; invalid variants
  are explicit (`unsigned()`, `withTamperedSignature()`, `withoutPlan()`).
- **Provider seam via DI** (`src/payments/PaymentProvider.ts` + `FakePaymentProvider`):
  the injection point is the `PaymentProvider` interface the service depends on;
  the fake records calls and scripts outcomes with no network.
- **Repository** (`src/persistence/*`): encapsulated, queryable persistence; lets
  the suite assert through the same seam the service writes through, and keeps the
  store swappable.
- **Factory** (`tests/support/clients/ApiClientFactory.ts`): single client
  construction point (in-process now, could target a deployed env later).
- **Plan catalog / Strategy** (`src/domain/plans.ts`): per-plan pricing/trial in
  data rather than scattered `if (plan === ...)` branches.

## API Validation Approach
Requests/responses are driven through a typed `BillingApiClient` over Supertest
and asserted on status code + payload shape. Webhook **request handling**
(signature valid/invalid/absent, malformed/missing-field payloads, unknown
subscription) is tested in `api/webhooks.contract.spec.ts`, separately from
webhook **business logic** (idempotency, transitions) which lives in the
`webhooks/` and `state-machine/` suites. Covered failures: missing/invalid field,
unknown plan, unknown customer, payment method not on file, already-canceled
cancel, 401 signature, 400 malformed, 404 unknown subscription.

## Database Validation Approach
Entities checked: `subscriptions`, `invoices`, `webhook_events`, audit log.
Invariants (via `PersistenceVerifier`): an `active` subscription has ≥1 paid
invoice; a `canceled` subscription never transitions again; duplicate webhooks add
no duplicate invoice/event/audit rows; API status equals persisted status at every
stage (`apiAndDbAgree`). Persisted state is checked after each lifecycle step, not
only at creation (see `e2e/full-flow.spec.ts`). False positives are avoided with a
fresh environment per test, deep-cloning repositories, and an explicit
"store starts empty" test.

## Mock Payment Provider & Webhook Validation
`FakePaymentProvider` implements the provider seam, records every call, and
returns a configurable/queued outcome. Tests assert it is called **exactly once**
on immediate-plan creation with the right customer/amount/currency/payment-method
and an idempotency key equal to the invoice id — and **not at all** for trial
creation, webhook processing, rejected creation, or replays. Idempotency is proven
on two axes: exact `event_id` redelivery (`duplicate_ignored`, single state change
and single row) and invoice-state-based protection against out-of-order/stale
events (a late `payment.failed` for a paid invoice does not regress an active
subscription).

## State-Machine / Lifecycle Coverage
Valid transitions tested (unit + e2e): `trialing→active/past_due/canceled`,
`active→past_due/canceled/active`, `past_due→active`, `past_due→canceled`
(retries exhausted / cancel). Proven impossible: `canceled→active` via stray
`payment.succeeded`, `canceled→past_due` via stray `payment.failed`, re-cancel
(409). Confidence: because the service routes *all* status changes through the
machine, the unit coverage of the table plus the e2e wiring tests give strong
assurance that no code path can reach an illegal state.

## Test Architecture
`TestEnvironment` wires a fresh DB + fake provider + fixed clock + service + app +
API client per test (isolation). Builders construct requests and signed webhooks;
`BillingApiClient`/`ApiClientFactory` hide transport; `PersistenceVerifier` and
`ProviderAssertions` express business invariants; specs are grouped by concern
(`api`, `state-machine`, `persistence`, `provider`, `webhooks`, `e2e`). Adding a
plan or a scenario touches data/builders, not the service branches — which is the
maintainability property the patterns were chosen for.

## Validation
```
npm run build      # tsc --noEmit — passes
npm run lint       # eslint — passes
npm test           # 55 tests, 9 files — all pass
```

## Known Limitations / Next Steps
- Single-threaded fixture: idempotency ordering is modeled but not proven under
  truly concurrent delivery; next step is a DB unique constraint on `event_id`
  plus a racing-delivery test.
- In-memory store trades SQL realism for speed; the Repository seam exists so a
  SQLite implementation could be dropped in and the suite reused.
- Trial-end/recurring charges are modeled as webhooks rather than a real
  scheduler (kept deterministic on purpose).

## Responsible AI Usage
I used an AI coding assistant (Claude Code) while building this. It helped
scaffold the project, draft boilerplate (repositories, builders, serializers),
and accelerate writing the spec files. I directed the design decisions — the
transition-table lifecycle, the provider seam, the two-layer idempotency strategy,
the invoice-state-based out-of-order protection, and the invariant set — and I
reviewed and ran everything: I verified each transition and invariant is actually
exercised, checked that the provider-call assertions match the billing model,
confirmed the suite passes from a clean install, and adjusted behavior where the
generated code didn't match the intended design. I can walk through any file and
explain why it is the way it is.

## Author Checklist
- [x] Linting passes
- [x] Type check passes (`npm run build` / `tsc --noEmit`)
- [x] Test suite passes
- [x] Schema/setup validation passes (in-memory; no external setup required)
- [x] Every listed lifecycle transition is exercised by at least one test
- [x] At least two invalid transitions are proven impossible
- [x] Webhook idempotency (duplicate `event_id`) is tested
- [x] README was tested from a clean setup
