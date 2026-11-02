# Subscription & Billing Service — Test Strategy

## Understanding

This assignment is to build a maintainable automated validation suite for a
stateful subscription-billing workflow, not a production billing product. The
suite should establish agreement between API behavior, lifecycle rules,
persisted records, and interactions with a mocked payment provider.

## Proposed approach and assumptions

- The repository contains the assignment brief but no existing service
  implementation, so I will build a small TypeScript service fixture (assignment
  option 2) rather than invent a production system.
- The fixture will expose the documented create, retrieve, cancel, and webhook
  operations through an HTTP app so tests can exercise real request handling.
- Persistence will be an isolated, queryable in-memory repository. This keeps
  setup small while allowing assertions against subscriptions, invoices,
  webhook deliveries/events, and audit history.
- The fixture uses `basic` at USD 49.00 with immediate billing and `pro` at
  USD 99.00 with a 14-day trial. Amounts are represented in cents.
- The payment provider will be an injected interface with a configurable test
  double; no real provider or network calls will be made.
- Creation returns `201` when the subscription is created even if the immediate
  charge is declined or times out; those outcomes leave it `past_due`. A timeout
  leaves the invoice `pending`, since the payment result is unknown.
- The fixture allows three consecutive failed attempts before transitioning
  `past_due` to `canceled`; a successful payment resets the failure count.
  API cancellation is allowed from `trialing` and `active`, but not `past_due`.
- `POST /subscriptions/{id}/plan` changes the plan for future billing without
  proration or an immediate charge. It preserves current lifecycle and trial
  end date; `past_due` and `canceled` subscriptions cannot change plans.
- Webhook signatures use `sha256=<hex HMAC-SHA256>` over the exact raw request
  body. A refund marks its invoice `refunded` and records an audit event without
  changing the subscription lifecycle.

## Scope

**In scope**

- Typed API request/response behavior and validation errors.
- Subscription lifecycle transitions and rejection/no-op behavior for invalid
  or stale events.
- Persistence consistency across subscription, invoice/payment, webhook, and
  audit records.
- Provider success, decline, and timeout outcomes, including call arguments and
  call counts.
- Signed, invalid-signature, malformed, duplicate, and out-of-order webhooks.
- End-to-end scenarios that verify API output, persisted state, and provider
  interactions together.

**Out of scope**

- A production-ready billing service or real payment-provider integration.
- Frontend, taxes, multi-currency, exhaustive proration, load/performance
  testing, and production monitoring.
- Concurrency/racing webhook tests unless the required scenarios are complete
  and time remains.

## Test levels and design

- **API/contract:** exercise the HTTP boundary for successful creation,
  retrieval, cancellation, plan changes, validation failures, and webhook
  signature/payload handling.
- **Workflow/state machine:** cover each lifecycle edge in the assignment and
  at least two invalid transitions. In particular, a canceled subscription
  must not reactivate, and a failed event for an already-paid invoice must not
  regress an active subscription.
- **Persistence:** query through repository methods and verify state, invoice
  outcomes, event identity, audit history, and absence of duplicate or
  contradictory records.
- **Integration/end-to-end:** drive representative API and webhook flows through
  the HTTP app and verify the resulting database and provider-double state.

Proposed patterns:

- **State machine / transition table:** centralize allowed lifecycle changes so
  state cannot be mutated ad hoc.
- **Builder:** build customers, subscriptions, and webhook payloads with
  scenario-focused defaults.
- **Provider interface plus injected fake (Strategy/Adapter seam):** configure
  success, decline, or timeout and inspect exact charge calls.
- **Repository pattern:** keep persistence queries and test assertions out of
  raw storage details.

The test architecture separates the HTTP app, typed API client, fake provider,
webhook signer/simulator, builders, in-memory repository, and scenario tests.
It uses TypeScript and Node's built-in HTTP and test modules.

## Key invariants and scenarios

- A subscription cannot be `active` without a successful persisted payment.
- The subscription state visible through the API matches persisted state after
  each lifecycle step.
- A canceled subscription is terminal, regardless of later webhook delivery.
- A duplicate `event_id` applies a business transition and side effects at most
  once; delivery/duplicate handling remains auditable.
- A failure arriving after success for the same invoice does not undo success.
- A rejected request or replayed webhook does not make an unintended provider
  call.
- Each genuine charge attempt calls the provider exactly once with the expected
  customer, amount, payment method, and reference/idempotency key.
- Invalid signatures and malformed payloads do not change business state.
- Declines and timeouts are recorded consistently and do not create a false
  successful payment.

The valid lifecycle paths to exercise are trialing → active, trialing →
past_due, active → past_due, past_due → active, past_due → canceled after
retries are exhausted, and active/trialing → canceled by API request.

## Validation and known limitations

Validation commands are `npm test` (build plus automated tests) and
`npm run typecheck`. There is no configured linter or external schema tool.

The in-memory fixture demonstrates test architecture and business invariants,
but cannot prove production database transaction isolation, durability, or
concurrent webhook behavior. It models retry exhaustion with a deterministic
consecutive-failure counter rather than a scheduler. The documented refund
behavior is a fixture assumption, not a claim about a production provider.
