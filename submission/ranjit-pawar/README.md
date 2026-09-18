# Subscription & Billing Service — Automated Validation Suite

An object-oriented test framework for a stateful, billed subscription workflow, plus the
minimal service fixture it validates (assignment **Option 3 — hybrid**).

The point of this repository is the **test engineering**: the service exists so the suite has
something honest to prove things about.

```bash
npm install
npm test          # 42 tests, ~3s, no network, no database to provision
npm run typecheck
```

Focused runs: `npm run test:api` · `test:lifecycle` · `test:webhooks` · `test:provider` ·
`test:persistence` · `test:e2e`

## What is validated

| Level | Spec file | Covers |
|---|---|---|
| API contract & validation | `tests/specs/api-contract.spec.ts` | status codes, payload shape, validation errors, webhook signature/malformed/unknown-reference handling |
| State machine / workflow | `tests/specs/lifecycle-state-machine.spec.ts` | every transition in the table (proved by a coverage test), illegal transitions, plan-specific rules |
| Persistence & audit | `tests/specs/persistence.spec.ts` | subscription/invoice/webhook-event/audit rows at every lifecycle stage |
| Provider interaction | `tests/specs/provider-interaction.spec.ts` | call count, call arguments, success/decline/timeout behaviour |
| Webhook idempotency | `tests/specs/webhook-idempotency.spec.ts` | duplicate, relabelled, out-of-order and concurrent delivery |
| End-to-end | `tests/specs/end-to-end.spec.ts` | full journeys across API → service → persistence → provider |

Related cases (validation tables, signature modes, payload shapes) are asserted table-style
inside one test rather than as one test per row, so the count reflects distinct behaviours.

Eleven system-wide invariants are additionally asserted **after every single test** via
`assertSystemInvariants` (`tests/framework/assertions/invariant-checker.ts`).

## Layout

```
src/                              # system under test (minimal fixture)
  domain/        subscription-state-machine.ts   <- explicit transition table (State)
                 plan-policy.ts                  <- per-plan rules (Strategy + Registry)
                 clock.ts, ids.ts, errors.ts     <- injected seams
  payments/      payment-provider.ts             <- the port tests replace
                 http-payment-provider.ts        <- production Adapter (never called in tests)
  persistence/   repositories.ts                 <- Repository over an embedded store
  services/      billing-engine.ts               <- the only writer of subscription state
                 webhook-processor.ts            <- replay / staleness / state-machine guards
                 subscription-service.ts, billing-cycle-runner.ts, signature-verifier.ts
  http/app.ts, system.ts                         <- Express routes + composition root

tests/framework/
  harness/       test-environment.ts             <- fixture: real graph, faked provider + clock
                 subscription-scenarios.ts       <- "give me a past_due subscription"
                 suite.ts                        <- per-test isolation + invariant hook
  clients/       api-client-factory.ts           <- Factory (in-process vs deployed)
                 subscription-api-client.ts, webhook-api-client.ts, http-transport.ts
  builders/      subscription-request/webhook-event/customer builders
  doubles/       fake-payment-provider.ts, recording-notifier.ts
  assertions/    subscription-assertions.ts, provider-assertions.ts, invariant-checker.ts
```

## Documentation

- [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md) — strategy, contracts, invariants, patterns, limitations
- [`docs/PR_DESCRIPTION.md`](docs/PR_DESCRIPTION.md) — the PR write-up

## Service fixture in one paragraph

A subscription is created via `POST /subscriptions` and starts `trialing`; a plan with a
zero-day trial is charged immediately. A billing runner (`POST /billing/run-cycle`, driven by an
injected clock) charges trials that have ended, periods that have rolled over, and retries that
have come due. Every charge opens exactly one invoice and makes at most one provider call.
The provider also reports asynchronously via signed webhooks, which are idempotent by
`event_id`. All state changes go through one transition table; nothing else writes `state`.
