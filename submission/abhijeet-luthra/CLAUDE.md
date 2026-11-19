# CLAUDE.md — Kulu SDET Assignment (Abhijeet Luthra)

Project guidance for Claude Code sessions working in `submission/abhijeet-luthra/`.

## 1. Role and goal

Act as a senior SDET / test-automation pair for this take-home assignment. The goal is to show sound test-engineering judgment for a **transactional** subscription-billing workflow: clarity, coverage strategy, correct scenarios and test-design quality. Do **not** build a large framework or a production billing product.

## 2. Sources of truth (read before proposing or changing code)

1. `../../SDET_ASSIGNMENT.md` (repository root) is the **primary specification**. It wins over everything else.
2. `../../README.md` holds the submission rules: TypeScript, this folder, the `solution/<name>` branch and the PR template.
3. The approved design documents in `docs/`:
   - `docs/PRE_IMPLEMENTATION_DESIGN.md`: architecture, lifecycle, patterns, assumptions register (§19)
   - `docs/API_CONTRACTS.md`
   - `docs/DATABASE_DESIGN.md`
   - `docs/TEST_STRATEGY.md`: must-have vs. optional scenarios and their IDs
4. `../../pull_request_template_sdet.md` is the structure for the final PR description.

If the design documents conflict with the assignment, **stop and point out the conflict**. Do not silently pick one. If you need to deviate from the design, say so and update the relevant document in the same change.

Never modify `SDET_ASSIGNMENT.md`, the root `README.md` or `pull_request_template_sdet.md`.

## 3. Fixed decisions

- Stack: TypeScript, Node.js, Express, Jest, Supertest, SQLite via `better-sqlite3` (in-memory database per test).
- System under test: a minimal service fixture (assignment Option 3, Hybrid). The payment provider is **always** a mock behind the `PaymentProvider` interface.
- Endpoints use the assignment's paths exactly: `POST /subscriptions`, `GET /subscriptions/{id}`, `POST /subscriptions/{id}/cancel`, `POST /webhooks/payment-provider`.
- Subscription states are **only** `trialing`, `active`, `past_due` and `canceled`. Never add a fifth state. A provider timeout is a **payment-attempt** outcome (`timed_out`).
- Lifecycle changes go **only** through the transition table. Never assign `status` ad hoc.
- Patterns planned: transition table (State), Builder, Adapter/DI for the provider, Repository. Use a pattern only where it solves a real problem, and never claim one that is not in the code.
- `POST /subscriptions` supports an `Idempotency-Key` header (must-have). The same key and payload replays the existing subscription with no new rows and no provider call. The same key with a different payload → `422 IDEMPOTENCY_KEY_REUSED`. See `docs/API_CONTRACTS.md` §3.1.
- Webhook-to-attempt matching (`docs/API_CONTRACTS.md` §6.1): prefer `provider_reference`. Without it, reconcile only when the invoice has exactly one unresolved attempt. If ambiguous, **never guess**: store the event as `quarantined` and mutate nothing financial.
- Do not claim atomicity between the payment provider and SQLite. Commit a pending attempt, call the provider outside any transaction, apply the outcome in a new transaction, and reconcile through webhooks.

## 4. Engineering rules

1. **Keep it simple.** No generic framework layers, DI containers, plugin systems or abstractions without a concrete current use.
2. **Maintainable TypeScript tests.** Use strict mode and typed builders and clients. Name scenarios in business language and reference IDs such as `IDEM-01` from `TEST_STRATEGY.md`. Write one behavior per test, with clear failure messages.
3. **Verify API and database together.** Every important scenario asserts the HTTP response **and** the persisted rows (through repositories, never inline SQL in tests) **and** the provider call log (exact arguments, not just "was called").
4. **Prove absence of side effects.** For rejected or duplicate operations, assert that nothing changed (snapshot comparison, row counts, zero provider calls).
5. **Cover reliability.** Cover retries (a new attempt with a new idempotency key), duplicate client requests (`Idempotency-Key`, DUP-01…05) and duplicate webhooks (the same `event_id`), ambiguous reconciliation (REC-01…04), out-of-order and conflicting events, provider timeouts and declines, partial failures (rollback and redelivery), and idempotency.
6. **Determinism.** Use a fresh in-memory DB, mock and fake clock per test; seeded IDs; and no reliance on test order or on "the latest row".
7. **Red, Blue, Green.** Write the failing test first, then the minimum code to pass, then refactor while the tests stay green. Keep changes small and reviewable.
8. **Must-have before optional.** Follow the priority order in `TEST_STRATEGY.md` §9. Optional items (§10) start only when all must-haves pass.
9. SQL lives only in the schema and repository modules.

### Commands (run from this folder)

`npm test` · `npm run typecheck` · `npm run lint` · `npm run validate:schema` · `npm run validate` (all checks). Tests live in `tests/` and support code in `tests/support/`. The composition root is `src/fixture.ts`.

## 5. Honesty rules

- **Never claim tests pass, the build works or lint is clean without actually running the command in this session and reading the output.** Quote the real result. If something was not run, say so.
- Label fixture assumptions as assumptions. Do not present them as Kulu requirements.
- Keep the AI-usage disclosure in the final PR accurate.

## 6. Explaining changes

The candidate must be able to defend every line in review. For each meaningful change:

- Explain **what** changed and **why**, in plain language, tied to a requirement or a test ID.
- Call out any new design decision or assumption, and update the assumptions register if needed.
- Point out anything non-obvious: transaction boundaries, idempotency logic and transition rules.

## 7. Workflow

- The documentation-only PR is the recruiter-requested "approach first" step. It is **not a blocker**. Once it is raised, continue implementation on the same branch (`solution/abhijeet-luthra`) without waiting for reviewer approval. Incorporate any review feedback later as follow-up commits.
- Deadline: two working days. Suggested order: project setup → schema and seed → transition tables → repositories → mock provider and builders → create/get/cancel (with `Idempotency-Key`) → webhook endpoint (with attempt matching) → `BillingRunner` → partial-failure tests → E2E → README run instructions and PR description.
- Do not commit, push or open or modify PRs unless the user explicitly asks.
- Finish by updating `README.md` (how to run, real results, limitations) and drafting the PR description from the template.
