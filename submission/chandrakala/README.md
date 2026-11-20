# Subscription & Billing validation assignment

A compact TypeScript automation framework around a minimal billing fixture. It verifies real HTTP behavior, an explicit lifecycle, real SQLite records, and an injected payment-provider mock. No UI, payment account, database server, credentials, or runtime package installation is required.

## Run

Requires **Node.js 22.16 or later in the Node 22 line**, the version verified here. Type transformation and SQLite emit experimental warnings on this version. Other Node majors have not been verified.

From this directory:

```sh
npm test
npm run test:coverage
```

If npm is unavailable or its local configuration interferes, run the exact dependency-free command:

```sh
node --experimental-transform-types --test tests/lifecycle.test.ts tests/contracts.test.ts tests/workflows.test.ts tests/webhooks.test.ts tests/persistence.test.ts
```

No `npm install` is needed to execute these tests. Optional **static type checking** requires the development dependencies:

```sh
npm install
npm run typecheck
```

Static type checking was **not run** in the authoring environment: registry requests timed out and no compiler was installed. Runtime execution of all TypeScript tests was verified. A lockfile cannot honestly be supplied until those optional packages are resolved; no failed install or fabricated lockfile is included.

## Architecture

```text
tests/*.test.ts                    readable behavior specifications
tests/support/harness.ts           isolated HTTP server, DB, clock, provider double
tests/support/client.ts            typed API client and signed-webhook simulator
tests/support/builders.ts          subscription and webhook Builders
tests/support/verifier.ts          API/DB, audit and provider assertions
src/app.ts                        real HTTP adapter and raw-byte HMAC verification
src/service.ts                    billing orchestration and reconciliation
src/domain.ts                     types, plan rules, lifecycle transition table
src/repository.ts                 SQL, constraints, queries and atomic transactions
docs/STRATEGY.md                   assumptions, contracts, scope and test strategy
docs/VALIDATION.md                 actual commands, test evidence and limitations
docs/PR_DESCRIPTION.md             ready-to-adapt submission description
```

The provider is the test double. HTTP handling, lifecycle rules and persistence are real fixture components. HTTP servers bind only to an ephemeral loopback port. A fresh database and mock are created for each test, then closed. File-backed durability tests create and remove their own temporary database. No existing workspace data is used.

## Important behavior choices

- Basic: USD 1900 cents / seven-day trial. Pro: USD 4900 cents / immediate charge.
- `/bill` is an explicit test scheduler trigger, not a time-based production scheduler. Each non-pending call represents a genuine new cycle/retry; it must not be blindly retried as an idempotent public API.
- A timeout means the charge result is unknown. Return 202, retain a pending invoice, and wait for webhook reconciliation. Repeated `/bill` while pending does not charge again.
- Paid invoices never regress to failed; older invoices cannot override the latest subscription state.
- Canceled subscriptions never reactivate. A late real settlement can still be recorded financially.
- Duplicate event IDs create delivery receipts, not duplicate payments or business audit actions. Conflicting content under the same event ID is rejected.
- Refunds preserve successful payment history and do not invent an unspecified subscription lifecycle transition.
- Plan changes affect the next invoice without proration or resetting a trial. Existing invoice prices are immutable snapshots.

See the strategy for complete API contracts and policies. Customers `cust_001` and `cust_002` are seeded by the harness. Payment methods are fixture strings beginning with `pm_test_`; no actual card numbers are used.

## Results and submission

**79 tests passed, 0 failed, 0 skipped** on Node 22.16.0. All seven specified transitions and nine forbidden state/trigger combinations are covered. Tests also prove transactional rollback and post-restart deduplication.

The folder is inside an unrelated SVN workspace and has no supplied Git repository/remote. No PR was published. Copy this folder into the intended assignment repository, run the tests and static checks, review the assumptions, and use `docs/PR_DESCRIPTION.md` for the PR. The AI-use section deliberately does not claim that the candidate performed a personal review that has not occurred.

## Tradeoffs

Built-in Node tooling was chosen after package-registry timeouts, keeping test execution reproducible without downloads. No real provider, production service, authorization, distributed queue/lock, taxes, proration, or scheduler is implemented. Single-process race tests do not prove multi-instance correctness. A crash between a remote charge and its local commit still needs gateway-side idempotency and reconciliation in a production implementation. This fixture does not claim exactly-once distributed delivery.

API clients use TypeScript types for convenience; runtime assertions, not those types, validate actual responses. The suite verifies this fixture's contract, not an unknown external service. Porting to a real service requires an external base URL adapter, repository adapter, and safe provider test seam.

Reference APIs: [Node test runner](https://nodejs.org/download/release/v22.16.0/docs/api/test.html), [Node SQLite](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html).
