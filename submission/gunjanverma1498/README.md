# Subscription & Billing Service — Test Solution

An object-oriented test framework for a Subscription & Billing Service, together
with a minimal service fixture that it validates. The focus is test-engineering
design: a structurally-enforced lifecycle, a mockable payment-provider seam,
idempotent webhook handling, and persistence that is checked at every stage of
the lifecycle — not just at creation.

> I chose **Option 2** (build a minimal service fixture). No service was
> provided, so the suite needs something real to validate; the fixture is kept
> deliberately small and lives entirely behind the same seams a production
> service would expose.

## Requirements

- Node.js 18+ (uses `node:crypto`, `structuredClone`)
- npm

## Install & run

```bash
cd submission/gunjanverma1498
npm install

npm test            # run the full suite (Vitest)
npm run build       # type-check (tsc --noEmit)
npm run lint        # eslint
npm run test:coverage   # coverage report
npm run dev         # start the fixture on :3000 (manual poking, optional)
```

No database or external service is required — persistence is in-memory and the
payment provider is a test double.

## What's real vs mocked

| Layer | In this solution |
| --- | --- |
| Subscription/billing service | **Real** (the fixture under test) |
| Lifecycle state machine | **Real** — the actual code enforcing transitions |
| Persistence | **Real logic, in-memory store** behind repositories |
| HTTP API | **Real** Express app, driven in-process via Supertest |
| Webhook signing/verification | **Real** HMAC-SHA256 |
| Payment provider | **Mocked** — `FakePaymentProvider` implements the provider seam |
| Webhook delivery | **Simulated** — tests build signed/unsigned/malformed payloads |

## Project layout

```
src/                         # service fixture (system under test)
  domain/
    types.ts                 # entities (subscription, invoice, webhook event, audit)
    plans.ts                 # plan catalog (pricing/trial per plan)
    stateMachine.ts          # lifecycle transition table — the single authority
  payments/
    PaymentProvider.ts       # the provider seam (interface the service depends on)
    signature.ts             # webhook HMAC sign/verify
  persistence/
    InMemoryRepository.ts    # generic repository
    repositories.ts          # per-entity repositories + Database aggregate
  service/
    BillingService.ts        # orchestration (create/cancel/webhook)
    errors.ts                # typed domain errors -> HTTP status codes
  http/
    app.ts                   # Express transport
    serializers.ts           # domain <-> wire (snake_case) translation
  index.ts                   # composition root + dev server

tests/
  support/
    builders/                # SubscriptionRequestBuilder, WebhookEventBuilder
    clients/                 # BillingApiClient + ApiClientFactory
    doubles/                 # FakePaymentProvider
    fixtures/                # TestEnvironment (per-test wiring + seed + isolation)
    assertions/              # PersistenceVerifier, ProviderAssertions, verify() facade
  api/                       # request/response + webhook request-handling contracts
  state-machine/             # valid + invalid lifecycle transitions
  persistence/               # row-level + invariant checks
  provider/                  # mocked-provider call count/args, decline/timeout
  webhooks/                  # idempotency + out-of-order delivery
  e2e/                       # full flows through API/webhooks -> persistence
```

## Design patterns (and the problem each one solves)

- **Transition-table state machine** (`src/domain/stateMachine.ts`) — the lifecycle
  is enforced in one place. Nothing else mutates `status`; the service always asks
  the machine for the next state, so illegal transitions (e.g. `canceled -> active`)
  are structurally unreachable rather than guarded ad hoc.
- **Builder** (`tests/support/builders/*`) — subscription requests and signed
  webhook payloads read as intent; invalid variants are explicit named mutators
  (`unsigned()`, `withTamperedSignature()`, `withoutPlan()`).
- **Provider seam via dependency injection** (`src/payments/PaymentProvider.ts` +
  `FakePaymentProvider`) — the service depends only on the interface, so the test
  double can record calls and script success/decline/timeout with no network.
- **Repository** (`src/persistence/*`) — persistence access is encapsulated, which
  lets the suite assert on stored state through the same seam the service writes
  through, and would let the store be swapped for SQLite without touching callers.
- **Factory** (`tests/support/clients/ApiClientFactory.ts`) — centralizes client
  construction so the suite could target a deployed environment by changing only
  the factory.
- **Plan catalog / Strategy** (`src/domain/plans.ts`) — per-plan pricing and trial
  behavior live in data, not in `if (plan === 'pro')` branches.

See [`DESIGN.md`](./DESIGN.md) for the full test strategy, invariants, assumptions,
and limitations.
