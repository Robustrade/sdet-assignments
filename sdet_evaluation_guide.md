# Evaluation Guide — Subscription & Billing Service SDET Assignment

## Purpose of This Guide

This guide helps reviewers evaluate whether the candidate demonstrated senior-level **Software Developer in Test** judgment for a stateful, integration-heavy backend system.

The assignment is intentionally not about writing a large number of superficial tests. It is about whether the candidate can design and build an **object-oriented test framework** — with design patterns applied because they solve a real problem — that proves a subscription's lifecycle, its persisted state, and its interaction with a mocked external payment provider are all correct.

Use this rubric to assess both the implementation and the pull request description.

---

## Reviewer Mindset

Look for:

- confidence-building automation before volume
- real object-oriented structure, not functions with inline HTTP/persistence calls
- design patterns used because they solve a concrete problem in this codebase, not because the PR description names them
- validation of invariants and state transitions, not just status codes
- deliberate mocking of the payment provider, with interaction verified — not assumed
- maintainable test architecture
- clear scope and tradeoff explanations

Do not over-index on test framework/library choice if the automation strategy and design are strong.

---

## Originality Check — Similarity to `submission/sample-candidate-ts`

`submission/sample-candidate-ts/` is a full working reference solution that candidates are told to read before building their own submission. That makes it a legitimate learning aid, but also a possible shortcut — a candidate could rename and lightly reword the scaffold and submit it as original work.

Before scoring, diff the candidate's submission structure and code against `submission/sample-candidate-ts/`:

- Same domain vocabulary, same four endpoints, and general OOP-with-design-patterns shape are **expected** and not a signal of copying — the assignment prescribes all of that.
- Look instead for things a candidate would not independently reproduce: identical file/class/variable naming beyond the obvious (e.g. `FakePaymentProvider`, `SubscriptionRequestBuilder` matched exactly, including less-obvious internal helper names), matching comments, identical test scenario wording, or near-identical function bodies with only cosmetic renames.
- Distinguish "used the scaffold as a structural reference" (fine, even expected) from "copied and lightly reworded the scaffold" (an integrity concern).

If you find substantial unattributed copying, do not silently fold it into the OOP/design-pattern score — call it out explicitly as a separate flag in the report, with the specific file:line pairs compared side by side, and let the human reviewer decide how to weight it. Do not accuse a candidate of copying based on superficial similarity alone (shared endpoint names, shared lifecycle terms, or a Builder/Repository pattern used the same way the assignment asks for) — the bar is unattributed near-identical code, not convergent design.

---

## Scoring Rubric

You may score each category on a 1–4 scale:

- **1 — Weak**
- **2 — Mixed / Partial**
- **3 — Strong**
- **4 — Exceptional**

A strong submission will usually score mostly 3s, with one or two 4s in areas such as state-machine coverage, OOP/design-pattern quality, or mock provider validation.

---

## 1) Test Strategy and Scope

### What Reviewers Should Look For
- clear explanation of what is being tested and why
- realistic scope for the time box
- explicit distinction between what's real and what's a mock/test double
- focus on the most important correctness risks (state transitions, idempotency, provider interaction)

### Strong Signals
- candidate explains which layers are covered and why
- scope aligns with system risk, not random feature sampling
- assumptions (e.g. how trial-end billing is simulated) are stated clearly
- strategy targets correctness risks such as duplicate/out-of-order webhooks and invalid transitions

### Weak Signals
- strategy is vague or only implied by code
- scope is broad and shallow
- no explanation of what is real vs. mocked
- tests focus on basic CRUD-style checks only, ignoring the lifecycle

### Reviewer Questions
- Does the candidate know what confidence they are trying to create?
- Are the chosen scenarios the right ones for a stateful, webhook-driven billing system?

---

## 2) API Validation Quality

### What Reviewers Should Look For
- request/response validation for subscription creation, retrieval, cancellation
- validation failures covered (unknown plan, missing fields, double-cancel)
- webhook endpoint request handling covered (signature, malformed payload) as its own concern, separate from webhook business logic

### Strong Signals
- success and failure paths both covered
- webhook signature verification tested explicitly (missing header, wrong signature, valid signature)
- assertions cover response semantics, not only status code
- API abstractions (a client class) keep test code readable

### Weak Signals
- only happy-path requests tested
- webhook signature handling untested or conflated with business-logic tests
- transport details (raw HTTP calls) repeated inline in every test

### Reviewer Questions
- Would these tests catch a contract break?
- Is webhook authentication tested as its own concern?

---

## 3) State-Machine and Lifecycle Correctness

This is the category the assignment weights most heavily — it did not exist in this form in earlier versions of this rubric, and a submission that skips it should not score as "strong" overall regardless of other strengths.

### What Reviewers Should Look For
- every valid transition in the lifecycle diagram is exercised
- at least two invalid transitions are proven impossible, not just described
- correct handling of stale/out-of-order webhook delivery (a failure notification arriving after a success must not regress state)
- retry-exhaustion behavior (past_due → canceled) is tested, not just active/past_due toggling

### Strong Signals
- transitions are asserted against persisted state, not just the API response
- at least one test proves an illegal transition is rejected or safely ignored
- out-of-order delivery is explicitly tested, with a clear assertion of "no regression"
- the state representation in the candidate's own service code (if they built one) makes illegal states structurally hard to reach

### Weak Signals
- only the "happy" transitions are tested (creation → active)
- invalid/out-of-order scenarios are asserted only via status code, without checking persisted state
- retries-exhausted → canceled path is untested
- the service under test represents status as a bare string mutated from multiple places with no central transition logic

### Reviewer Questions
- Would this suite catch a bug that let a canceled subscription reactivate?
- Does it prove out-of-order webhook delivery is handled safely?

---

## 4) Database and Persistence Validation

### What Reviewers Should Look For
- verification that API-visible outcomes match persisted state, at every lifecycle stage — not just at creation
- validation of subscriptions, invoices/payments, and webhook-event idempotency records
- absence of invalid or duplicate side effects
- clear seeding and cleanup strategy

### Strong Signals
- tests verify subscription status and invoice status together, catching contradictions (e.g. "active" with no paid invoice)
- webhook idempotency is verified at the persistence layer (processed-event tracking), not only via a second HTTP response
- persistence is checked through a repository/DAO abstraction, not raw queries scattered through tests

### Weak Signals
- persistence not checked at all, or checked only immediately after creation
- database verification too shallow to catch a duplicate invoice or a missed status update
- raw queries/storage access duplicated across many test files

### Reviewer Questions
- Do the tests prove that persistence matches business behavior at every stage of the lifecycle, not just creation?
- Would a duplicate invoice from a redelivered webhook be caught?

---

## 5) OOP Design and Design Pattern Usage

### What Reviewers Should Look For
- real class-based structure in the test framework (and service fixture, if built): builders, an API client class, a mock provider class, a repository/assertion layer
- design patterns named in the PR description are actually present and solving a real problem
- the payment-provider dependency is behind an interface/seam, not hardcoded

### Strong Signals
- a Builder is used for request/webhook construction and demonstrably reduces duplication
- the payment provider is injected through an interface, and the mock implementation is a clean, purpose-built test double
- at least one additional pattern (Factory, Repository, State) is used where it clarifies intent
- the PR description explains *why* each pattern was chosen, not just that it exists

### Weak Signals
- "design patterns" are named in the PR description but not actually visible in the code
- test data is built with repeated object literals instead of a builder
- the payment provider is called directly/hardcoded, with no mockable seam
- patterns are used ornamentally, adding indirection without solving a real duplication or clarity problem

### Reviewer Questions
- If I removed the pattern, would the code get measurably worse (more duplication, less clarity)? If not, it wasn't earning its place.
- Is the payment-provider seam real, or is the "mock" actually still coupled to a concrete implementation?

---

## 6) Mock Payment Provider and Webhook Validation

### What Reviewers Should Look For
- the payment provider is mocked, with call count and call arguments verified — not just "was it called"
- coverage of success, decline, and timeout outcomes
- webhook idempotency (duplicate `event_id`) proven at the behavior level, not just described
- signed vs. unsigned vs. invalid-signature webhook requests are all tested

### Strong Signals
- tests assert exact charge arguments (amount, customer, reference) against the mock
- the mock provider is never called for actions that shouldn't trigger a charge (validation failures, duplicate webhooks)
- duplicate webhook delivery is proven to produce exactly one transition/persisted change
- webhook signature tests use a real HMAC (or equivalent) verification path, not a stubbed-out check

### Weak Signals
- "mocking" turns out to be a real network call to a fake local server with no verification of arguments
- provider call count/arguments never asserted
- idempotency is asserted only by checking the HTTP response, not the underlying state
- signature verification is untested or trivially bypassed in the test setup

### Reviewer Questions
- Does the test prove the provider was called with the right data, or just that something happened?
- Would a broken idempotency check (double-charging on redelivery) be caught?

---

## 7) Assertion Quality and Invariant Thinking

### What Reviewers Should Look For
- assertions reflect domain invariants (state + persisted record + provider interaction agree)
- negative and absence checks included where important
- tests read like business behaviors, not implementation trivia

### Strong Signals
- candidate asserts that an active subscription always has a corresponding paid invoice
- candidate verifies no persisted state change occurs for rejected/ignored webhooks
- invariants span multiple entities (subscription + invoice + audit) coherently

### Weak Signals
- assertions are shallow (status code only) or check a single field
- important invariants (e.g. "canceled never transitions again") are missing
- no explicit negative/absence checks

### Reviewer Questions
- Would a subtle state-machine or persistence bug escape these tests?
- Are the right invariants being enforced, or just the easy ones?

---

## 8) Test Architecture, Maintainability, and Documentation

### What Reviewers Should Look For
- clean suite structure: fixtures, API client, mock provider, assertions, and scenarios are separated
- setup and builders are reused, not copy-pasted
- PR description covers strategy, design pattern choices, API/DB/mock validation approach, and limitations, matching `pull_request_template_sdet.md`
- candid explanation of AI usage if any

### Strong Signals
- another engineer could add a new lifecycle scenario without touching unrelated files
- README/PR makes setup, scope, and design choices easy to understand
- limitations (e.g. simplifying assumptions about trial-end billing) are stated honestly
- PR description aligns with what the code actually does

### Weak Signals
- tests are repetitive and brittle; adding a scenario requires touching many files
- transport, setup, and assertions are mixed together throughout
- documentation is sparse or inconsistent with the implementation

### Reviewer Questions
- Could another engineer extend this suite safely?
- Does the PR description accurately reflect the code, including its simplifications?

---

## Suggested Overall Rating Bands

### Exceptional
The candidate designed a well-structured, genuinely object-oriented automation suite with full lifecycle coverage, deliberate and well-justified design patterns, and meaningful mock-provider/webhook verification. Persistence and invariant checks are deep, and the suite is maintainable.

### Strong
The solution is practical, reasonably well-structured, and confidence-building. There may be simplifications (fewer invalid-transition or out-of-order cases covered), but the core design and strategy are convincing.

### Mixed
There are good ideas, but one or more critical areas are underdeveloped — commonly: state-machine coverage stops at the happy path, the payment provider isn't genuinely mocked/verified, or the "design patterns" claimed in the PR aren't actually present in the code.

### Weak
The submission behaves like an endpoint smoke-test pack with a `status` field mutated ad hoc, no real mock-provider verification, and no evidence of intentional OOP or design-pattern use. Confidence in real system correctness remains low.

---

## Common Failure Patterns

Reviewers should watch for these:

- lifecycle tested only via the API response, never against persisted state
- no test proves an invalid transition is actually rejected
- out-of-order/stale webhook delivery not covered
- payment provider "mocked" but never asserted against (arguments, call count)
- duplicate webhook delivery not covered, or covered only by response code
- design patterns named in the PR description but absent from the code
- test data built from repeated object literals instead of a builder
- brittle, repetitive test structure with transport/assertions mixed everywhere

---

## What to Value Most

When in doubt, prioritize:

1. correct, well-tested state-machine behavior, including invalid and out-of-order cases
2. genuine mock-provider verification (arguments and call count, not just "was called")
3. real object-oriented structure and design patterns that solve an actual problem
4. persistence validation that matches business behavior at every lifecycle stage
5. maintainable suite architecture
6. breadth of tooling last

A smaller suite that proves the critical lifecycle and mocking behaviors should outrank a larger suite of shallow tests.
