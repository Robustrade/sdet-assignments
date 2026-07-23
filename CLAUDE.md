# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

This is a **take-home SDET/QA-automation assignment shell**, not a product codebase. The actual task is defined in `SDET_ASSIGNMENT.md`: design and implement an automated test suite — with genuine object-oriented structure and deliberate design-pattern use — for a fictional **Subscription & Billing Service** (`POST /subscriptions`, `GET /subscriptions/{id}`, `POST /subscriptions/{id}/cancel`, `POST /webhooks/payment-provider`). Subscriptions move through a lifecycle (`trialing → active → past_due → canceled`) driven by API calls and by webhook events from an external payment provider that candidates must mock, not assume is real.

**TypeScript only** — plain JavaScript is acceptable only with a strong stated reason (see `SDET_ASSIGNMENT.md`). There is no Python or Java track in this repository; if you see references to those in older docs or memory, they're stale.

Candidates fork the repo, put their solution under `submission/<candidate-name>/`, and open a PR back to `main` from a branch named `solution/<your-name>`. `README.md` and `SDET_ASSIGNMENT.md` are the source of truth for submission requirements.

`submission/sample-candidate-ts/` is a **working reference scaffold** (not a stub) demonstrating the expected structure and design patterns — read it before building or evaluating a real submission.

## No CI — review is local, via an agent

This repository intentionally has **no GitHub Actions / CI workflows**. Submission PRs are reviewed locally using the `submission-reviewer` subagent defined in `.claude/agents/submission-reviewer.md`, which reads `SDET_ASSIGNMENT.md` + `sdet_evaluation_guide.md`, runs the candidate's lint/type-check/test/schema-validate commands itself, and produces a scored written report. It does not comment on, push to, or modify a PR — see `pr_review_guide.md` for the full process and the rationale for not using CI. Invoke it with something like "use the submission-reviewer agent to review PR #4."

## Commands (run from inside `submission/sample-candidate-ts/`, or any candidate's equivalent directory)

```bash
npm install
npm test                                # full Jest suite
npx jest tests/stateMachine.test.ts     # single file
npx jest -t "retries are exhausted"     # single test by name
npm run lint                            # eslint
npm run build                           # tsc --noEmit
npm run validate-schema                 # ts-node scripts/validateSchema.ts
```

## Reference scaffold architecture (`submission/sample-candidate-ts/`)

The scaffold is layered specifically to demonstrate the patterns the assignment asks for — read `submission/sample-candidate-ts/README.md` for the full breakdown. In brief:

- `src/domain/subscriptionStateMachine.ts` — the lifecycle transition table (State pattern). Both the cancel path and the webhook handler call `transition()`/`canTransition()`; neither assigns `.status` directly. This is the mechanism that makes illegal transitions structurally hard to reach, not just untested.
- `src/payments/PaymentProvider.ts` — the interface production code depends on for charging a customer; the injectable seam tests use to substitute a mock (`tests/support/FakePaymentProvider.ts`) instead of a real network call.
- `src/persistence/Repository.ts` — Repository pattern over an in-memory store; all persistence access (production and test-verification) goes through it, never raw storage access inline in tests.
- `src/service/SubscriptionService.ts` — the workflow layer orchestrating validation, state transitions, persistence, and the payment provider. `openNextInvoice()` simulates a new billing cycle becoming due (not exposed over HTTP — see the file's docstring) so recurring-billing/retry scenarios in tests don't have to reuse an already-resolved invoice.
- `src/app.ts` — a thin Express factory (`createApp()`) wiring the above together; a `Factory`-pattern entry point.
- `tests/support/` — the test framework itself: `builders.ts` (Builder pattern for requests/webhooks), `FakePaymentProvider.ts` (the mock/test double, records calls for assertion), `SubscriptionApiClient.ts` (Adapter over `supertest`), `testApp.ts` (wires a fresh app + mock + client per test).

One deliberate simplification worth knowing if you're extending this: all billing outcomes are webhook-driven **except** the very first charge for a no-trial plan, which is synchronous at creation (there's no trial period to wait out). This is documented in the scaffold's own README — don't "fix" it without reading that rationale first.

## Working on the assignment itself vs. the repo scaffolding

- If asked to *implement a solution* to the assignment, work inside a new `submission/<candidate-name>/` directory, following the required architecture (fixtures/env setup, API client layer, mock payment provider, assertion/verification layer, test scenarios, test data builders) and the mandatory design-pattern/mocking requirements in `SDET_ASSIGNMENT.md`.
- If asked to *modify repo infrastructure* (the review agent, docs, evaluation guide), remember there's no CI to keep in sync — the rubric lives entirely in `sdet_evaluation_guide.md` and the agent definition, so changes to one should usually be reflected in the other.
- `pull_request_template_sdet.md` is the PR description template; `pr_review_guide.md` documents the local-agent review process; `sdet_evaluation_guide.md` documents how submissions are scored — consult it if asked to evaluate or critique a candidate submission rather than write one.
