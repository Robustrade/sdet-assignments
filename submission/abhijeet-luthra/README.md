# Subscription & Billing Service — SDET Submission (Abhijeet Luthra)

A minimal subscription-billing **service fixture** (TypeScript, Express, SQLite, mocked payment provider) and an **object-oriented automated validation suite** that proves its behavior at the API, state-machine, database and provider-integration levels.

## 1. How to run

Prerequisites: Node.js ≥ 20 (developed on Node 22) and npm. No database server or network access to a payment provider is needed. SQLite runs in memory and the provider is mocked.

```bash
cd submission/abhijeet-luthra
npm ci                    # install exact locked dependencies
npm test                  # run the full test suite
npm run validate          # typecheck + lint + schema validation + tests
```

| Script | What it does |
|---|---|
| `npm test` | Jest suite (unit, API, webhooks, lifecycle, provider, persistence, E2E) |
| `npm run typecheck` | `tsc --noEmit` over source and tests (strict mode) |
| `npm run lint` | ESLint (recommended JS + TypeScript rules) |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm run validate:schema` | Builds the schema in a fresh database, seeds it, and proves key constraints reject bad data |
| `npm run validate` | All of the above, in order |

**Seed and cleanup:** every test builds its own **in-memory** SQLite database, applies the schema and seeds two customers (`cust_001`, `cust_002`) and two plans. The plans are `basic` (USD 19.00, charged immediately) and `pro` (USD 49.00, 7-day trial); the prices are illustrative test data. The database is discarded after the test, so there is nothing to clean up and no shared state.

### Latest validation results (actual run)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ no errors |
| `npm run lint` | ✅ no findings |
| `npm run validate:schema` | ✅ 8/8 tables, foreign keys on, 5/5 constraint checks |
| `npm test` | ✅ **16 suites, 130 tests passed**. Also passed in random order (`--randomize`) and serially (`--runInBand`) |
| `npm run build` | ✅ |

`npm audit` reports a high-severity ReDoS advisory in `picomatch`, which reaches the project only through Jest's file-matching (a **dev-only** dependency, not in the service runtime). The suggested `--force` fix downgrades `ts-jest` to an incompatible major version, so it was not applied.

## 2. Understanding of the assignment

A subscription is always in one of four states, and it moves between them through a state machine, not in a straight line:

```text
trialing ──first charge succeeds──▶ active ◀──retry succeeds── past_due
trialing ──first charge fails─────────────────────────────────▶ past_due
active   ──recurring charge fails─────────────────────────────▶ past_due
past_due ──retries exhausted──▶ canceled
trialing / active ──customer cancels──▶ canceled   (terminal: never leaves)
```

API calls drive these moves, and so do **signed, possibly duplicated or out-of-order webhooks** from an external payment provider. The suite proves the following:

- Only these transitions ever happen.
- Duplicates have exactly one effect.
- Persisted state always matches the API.
- The payment provider is mocked and its calls are checked precisely.

## 3. What is real vs. mocked

| Component | Real or double |
|---|---|
| Express routes, services, transition tables, repositories | **Real**: the system under test (`src/`) |
| SQLite (`better-sqlite3`, in memory) | **Real**: constraints and transactions are exercised |
| Payment provider (outbound charges) | **Mock**: `tests/support/mocks/mock-payment-provider.ts` (scripted success, decline or timeout; records every call) |
| Provider webhooks (inbound) | **Simulated** by the suite: correctly signed, wrongly signed, unsigned and tampered payloads over HTTP |
| Time and scheduling | **Fake clock** plus an explicit `BillingRunner.runDue()` call instead of a scheduler |

## 4. Architecture

```text
src/
  domain/        types, subscription + payment transition tables, AppError
  db/            schema (CHECK/UNIQUE/FK constraints), seed data, schema validator
  repositories/  one class per table; ALL SQL lives here
  providers/     PaymentProvider interface (the seam the mock plugs into)
  services/      SubscriptionService, WebhookService, BillingService, BillingRunner,
                 Lifecycle (only writer of status), PaymentOutcomeApplier
  webhooks/      HMAC signature + payload validation
  http/          Express routes for the four required endpoints, validation, error mapping
  fixture.ts     composition root: wires everything with constructor injection
tests/
  support/       TestEnvironment, API client, mock provider, webhook simulator,
                 builders, given-helpers, invariant checker, expectations
  unit/ api/ webhooks/ lifecycle/ provider/ persistence/ e2e/
```

### Design patterns (each in the code, each solving a problem here)

| Pattern | Where | Problem it solves |
|---|---|---|
| **State / transition table** | `src/domain/subscription-state-machine.ts`; enforced by `src/services/lifecycle.ts` | Status is never assigned ad hoc. Every change asks one table, and illegal moves are rejected in one place. A unit test checks all 16 state pairs |
| **Builder** | `tests/support/builders/` | Readable scenarios: `aWebhook().failed().forInvoice(invoice).withEventId('evt_x')` instead of repeated object literals |
| **Interface + dependency injection** | `src/providers/payment-provider.ts`, wired in `src/fixture.ts` | The service depends only on an interface, so tests inject a mock and the real provider can never be called. There is no real-provider adapter class |
| **Repository** | `src/repositories/` | SQL stays out of services and tests. Assertions read as business queries (`payments.findByInvoice(id)`) |

### Key engineering decisions

- **One place applies payment outcomes** (`PaymentOutcomeApplier`), whether the result comes back synchronously from the provider or arrives later by webhook. That is why "sync success plus webhook" and "success then a late failure" are always consistent.
- **No atomicity is claimed across the provider and the database.** `better-sqlite3` transactions are synchronous, so they cannot span the provider call. The steps are: commit a `pending` attempt, call the provider outside any transaction, then apply the outcome in a new transaction. If that last step fails, the attempt stays `pending` and a provider webhook reconciles it (test PF-02).
- **A timeout is an unknown outcome**, recorded on the payment attempt as `timed_out`. It is never a subscription state, and it is never automatically re-charged.
- **Webhook matching never guesses.** The service prefers `provider_reference`. Without one, it matches only when the invoice has exactly one unresolved attempt. Anything ambiguous is stored as `quarantined` and changes nothing financial.

## 5. Test strategy at a glance

All must-have scenarios from [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md) are implemented. Each test name starts with its scenario ID.

| Area | IDs | Proves |
|---|---|---|
| State machine (unit) | U-01…03 | Exactly 7 of 16 transitions allowed; payment outcomes final; HMAC over the raw body |
| API contract | API-01…14 | Status codes, body shape, validation errors, **no side effects and no provider call on rejection** |
| Duplicate creation | DUP-01…05 | Same `Idempotency-Key` + payload: one subscription, one charge; different payload: 422 |
| Webhook handling | WH-01…07 | Wrong, missing or tampered signature: 401; malformed: 400; bad references: 404/422; database unchanged |
| Idempotency and ordering | IDEM-01…05 | Same `event_id` ×5 applied once (`delivery_count = 5`); late failure never regresses a success |
| Attempt matching | REC-01…04 | Match by reference or single unresolved attempt; ambiguous: quarantined with no mutation |
| Lifecycle | LC-01…07 | Every transition, driven by billing runner, webhooks and API |
| Invalid transitions | INV-01…05 | Canceled never reactivates; stale failure ignored; illegal cancels: 409 |
| Provider interaction | PAY-01…05 | Exact charge arguments; zero calls where no charge is due; retries use new keys; timeouts never re-charged |
| Persistence | DB-01…04 | API equals DB at every stage; complete audit history; constraints |
| Partial failures | PF-01…03 | A failure mid-webhook rolls back fully and redelivery applies once; provider success + local crash reconciles with no double charge |
| End-to-end | E2E-01…06 | Full journeys across HTTP, billing runner, provider mock and SQLite |

**Invariant checker:** after **every** test, `tests/support/assertions/invariant-checker.ts` checks the cross-table rules for the whole database. Examples: "active implies a successful payment", "at most one successful payment per invoice", "audit trail complete and ending at the current status" and "invoice amount equals plan price". A test that leaves contradictory data fails even if its own assertions passed.

**Mutation check:** key rules were deliberately broken to confirm the tests fail. This found one untested path, a re-charge of a timed-out *retry*, which test PAY-04b now covers. See `docs/TEST_STRATEGY.md` §8.

## 6. Assumptions and limitations

All fixture assumptions (A-01…A-17) are listed in [`docs/PRE_IMPLEMENTATION_DESIGN.md`](docs/PRE_IMPLEMENTATION_DESIGN.md) §19. The ones that most affect behavior:

- An immediate-billing plan starts as `trialing` with a zero-length trial (A-01).
- Cancelling a `past_due` subscription is rejected with 409 (A-07).
- A refund does not change the subscription state (A-08).
- At most 3 attempts per invoice (A-06).

Known limitations:

- Concurrent webhook or request delivery is not tested (optional scope). The fixture is single-threaded and synchronous around its key checks.
- Quarantined events and late money movement for canceled subscriptions are recorded but not reconciled. That would be a manual or refund workflow, which is out of scope.
- `POST /subscriptions` without an `Idempotency-Key` is not de-duplicated.
- There is no plan-change endpoint (optional, A-14), no authentication, and no real HTTP server entry point. The app is exercised in-process through Supertest.

## 7. Documentation map

| Document | Contents |
|---|---|
| [`docs/PRE_IMPLEMENTATION_DESIGN.md`](docs/PRE_IMPLEMENTATION_DESIGN.md) | Architecture, lifecycle, patterns, consistency boundaries, assumptions register, implementation notes (§23) |
| [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) | The four endpoints, Idempotency-Key, webhook outcomes and matching rules |
| [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md) | Eight tables, constraints, transaction boundaries, invariants |
| [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md) | Real vs. mocked, scenario IDs, traceability to the assignment |
| [`CLAUDE.md`](CLAUDE.md) | Guidance for AI-assisted sessions |

## 8. Responsible AI usage

Claude Code was used to review the design against the assignment, to implement the fixture and tests phase by phase, and to run the validation commands. The results above come from actual runs. Honest notes on process:

- The design came first and was submitted as its own PR.
- During implementation, tests were written **alongside** each component rather than strictly before it. To make sure the tests can actually fail (the "Red" step), key rules were deliberately broken and the failing tests confirmed. One gap was found and fixed this way (PAY-04b).

**What I personally decided, reviewed and verified**

- **AI wrote most of the code and tests.** I used Claude Code to write the fixture, the services and most of the test suite. My role was to set the rules, review the output and make sure the results were real.
- **Design and flow approval.** I reviewed and approved the overall design before any code was written: the end-to-end flow from the API request, to the database records (subscription, invoice, payment attempt, events), to the mock payment provider, to webhook confirmation. Implementation followed only after I signed off. I also approved the test architecture (environment, API client, mock provider, builders, shared assertions), which is organised so the suite can grow: new scenarios reuse the existing building blocks without rewriting existing tests.
- **Business rules I set.** I kept the subscription to exactly four states. A payment timeout is the outcome of a payment attempt, not a fifth subscription state. I reviewed the assumptions register and the state-transition rules before implementation started.
- **Process.** I raised the design PR first, as asked, but did not let it block implementation. Nothing was committed or pushed without my approval.
- **Verification.** I required every result in this README to come from an actual run, not an expectation. I ran the full validation and had it repeated from a clean install, as a reviewer would. Before committing, I had the submission checked for leftovers, which caught documentation that still described the architecture as "planned" after it was built, plus an internal note that was not meant for reviewers.
- **Bugs found during testing.** Two bugs were found while checking the work. A successful payment kept an old failure code, which surfaced when running the app against a real database; it is now fixed and checked in REC-02. A timed-out payment could be charged again on retry; it is now covered by PAY-04b. The AI found these during checks I asked for; I did not find them myself.
- **Understanding the code.** I am newer to TypeScript, so I walked through the code step by step: the business flow, how the tests are grouped and organised, and the duplicate-webhook test (IDEM-01) line by line. I am continuing this for the other key tests (INV-01, INV-03, PAY-04, WH-02) so I can explain and defend each one myself.
