# Kulu SDET — Subscription & Billing Automation

A focused **TypeScript** backend test harness (hybrid approach): local HTTP service fixture + fake payment provider + isolated queryable repository + Node's built-in test runner. No production service was provided.

## Requirements
Node.js **22.10+** (uses TypeScript type stripping) and npm. No external dependency is needed to run tests; TypeScript/ESLint dev dependencies are needed for build/lint.

## Run
```bash
npm install
npm test
npm run build
npm run lint
npm run validate-schema
```

`npm test` can run without `npm install` on compatible Node versions.

## Architecture
- `src/domain.ts` — lifecycle transition table, entities, plan configurations
- `src/service.ts` — fixture business rules, charge handling, webhook idempotency
- `src/http.ts` — real HTTP server, signed webhook verification, JSON contracts
- `src/repository.ts` — queryable in-memory entities, audit and delivery logs
- `src/provider.ts` — payment interface and fake success/decline/timeout
- `src/client.ts` — typed HTTP API wrapper
- `src/builders.ts` — test-data builders
- `src/fixture.ts` — isolated test environment
- `tests/billing.test.ts` — API, state, persistence and integration scenarios

See `TEST_STRATEGY.md` for test matrix, assumptions, tradeoffs and invariants.

## Mock vs real
Real: HTTP requests, raw-body HMAC verification, domain logic, in-memory state mutations. Mocked: external payment provider. Simulated: billing scheduler/retry exhaustion via fixture-only endpoints. Tests do not connect to a real payment provider.

## Submission
Place this directory under `submission/<your-name>/` in your fork. Create branch `solution/<your-name>` and open an initial draft PR with the strategy first, then commit the implementation and complete `PR_DESCRIPTION.md` in the repository's PR template.
