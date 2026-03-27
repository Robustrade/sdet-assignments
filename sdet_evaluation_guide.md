# Evaluation Guide — Wallet Transfer Service SDET Assignment

## Purpose of This Guide

This guide helps reviewers evaluate whether the candidate demonstrated senior-level **Software Developer in Test** judgment for a reliable transactional backend system.

The assignment is intentionally not about writing a large number of superficial tests. It is about whether the candidate can design automation that gives real confidence in a wallet transfer workflow under duplication, retries, and persistence-sensitive behavior.

Use this rubric to assess both the implementation and the pull request description.

---

## Reviewer Mindset

Look for:

- confidence-building automation before volume
- validation of invariants, not just status codes
- end-to-end reasoning from API to database
- deliberate coverage of duplicates and concurrency
- thoughtful cross-component verification
- maintainable test architecture
- clear scope and tradeoff explanations

Do not over-index on test framework choice if the automation strategy is strong.

---

## Scoring Rubric

You may score each category on a 1–4 scale:

- **1 — Weak**
- **2 — Mixed / Partial**
- **3 — Strong**
- **4 — Exceptional**

A strong submission will usually score mostly 3s, with one or two 4s in areas such as end-to-end validation depth, reliability coverage, or suite design.

---

## 1) Test Strategy and Scope

### What Reviewers Should Look For

- clear explanation of what is being tested
- realistic scope for the time box
- explicit distinction between real components and stubs/fakes
- focus on the most important transactional risks

### Strong Signals

- candidate explains which layers are covered and why
- scope aligns with system risk, not random feature sampling
- assumptions are stated clearly
- time-box tradeoffs are thoughtful
- strategy targets correctness risks such as duplicates, retries, and data consistency

### Weak Signals

- strategy is vague or mostly implied by code
- scope is too broad and shallow
- no explanation of what is real vs simulated
- tests focus on basic CRUD-style checks only

### Reviewer Questions

- Does the candidate know what confidence they are trying to create?
- Are the chosen scenarios the right ones for a wallet transfer system?
- Is the test plan risk-based?

---

## 2) API Validation Quality

### What Reviewers Should Look For

- strong request/response validation
- validation failures covered
- duplicate request behavior covered
- contract-level checks are meaningful

### Strong Signals

- success and failure paths both covered
- duplicate replay behavior validated intentionally
- same key + different payload case considered
- tests assert important response semantics, not only status code
- API abstractions keep test code readable

### Weak Signals

- only happy-path requests tested
- duplicate/idempotency behavior omitted
- weak assertions on response payloads
- transport details leak into every test

### Reviewer Questions

- Would these tests catch a contract break?
- Do they validate duplicate submission behavior correctly?
- Are the API tests easy to read and maintain?

---

## 3) Database and Persistence Validation

### What Reviewers Should Look For

- verification that API-visible outcomes match persisted state
- validation of wallet balances, transfer rows, idempotency records, and audit data
- absence of invalid or duplicate side effects
- clear seeding and cleanup strategy

### Strong Signals

- tests verify source and destination wallet balances after transfer
- transfer row and status are checked in the database
- idempotency storage is validated
- audit or event rows are verified where modeled
- failure-path tests confirm no unintended persistence

### Weak Signals

- database not checked at all
- database verification is too shallow to catch correctness issues
- tests only inspect one table when several invariants depend on multiple tables
- stale data risk not accounted for

### Reviewer Questions

- Do the tests prove that persistence matches business behavior?
- Would duplicate or partial side effects be detected?
- Are database assertions specific and meaningful?

---

## 4) Cross-Component Validation

### What Reviewers Should Look For

- verification beyond the API and primary DB tables where relevant
- outbox/event/audit/downstream components checked thoughtfully
- exactly-once side-effect behavior considered

### Strong Signals

- candidate validates one or more supporting components intentionally
- side effects are checked for count and correctness, not just presence
- test doubles or stubs are used cleanly when needed
- verification shows understanding of distributed side effects

### Weak Signals

- no component interaction validation despite assignment emphasis
- side effects assumed rather than checked
- test doubles are confusing or too brittle
- exactly-once implications ignored

### Reviewer Questions

- Does the suite check what happens beyond the main transfer row?
- Would duplicate publishes or missing audit events be detected?
- Is the supporting-component coverage realistic?

---

## 5) Concurrency and Reliability Coverage

### What Reviewers Should Look For

- tests for duplicate in-flight requests
- tests for competing transfers or limited balances
- retry safety coverage
- awareness of race conditions and partial-failure risks

### Strong Signals

- concurrency tests exist and target meaningful invariants
- candidate covers same-idempotency-key duplicates
- candidate covers competing transfers against constrained balances
- tests demonstrate understanding of non-deterministic failure risks
- reliability coverage is proportionate to the assignment

### Weak Signals

- no concurrency tests
- duplicate/retry scenarios only described but not automated
- tests assume sequential behavior only
- reliability claims unsupported by automation

### Reviewer Questions

- Would this suite catch double-debit bugs?
- Does it exercise the failure-prone paths the assignment cares about?
- Are concurrency tests meaningful, even if minimal?

---

## 6) Assertion Quality and Invariant Thinking

### What Reviewers Should Look For

- assertions reflect domain invariants
- tests check what must always be true
- negative and absence checks included where important

### Strong Signals

- candidate asserts balance movement exactly once
- candidate verifies no persistence on rejected transfers
- transfer status, balances, idempotency, and events are checked coherently
- tests read like business behaviors rather than implementation trivia

### Weak Signals

- assertions are shallow or incomplete
- tests only assert status codes or single fields
- important invariants are missing
- no explicit negative checks

### Reviewer Questions

- Do the assertions prove correctness, or only that something happened?
- Are the right invariants being enforced?
- Would a subtle transactional bug escape these tests?

---

## 7) Test Architecture and Maintainability

### What Reviewers Should Look For

- clean suite structure
- reusable setup and builders
- separation of API calls, assertions, and scenario definitions
- low noise and high readability

### Strong Signals

- API client or helpers encapsulate request details
- database helpers are reusable and clear
- fixtures/builders reduce duplication
- scenarios remain readable without too much indirection
- repository structure makes the suite easy to extend

### Weak Signals

- tests are repetitive and brittle
- transport, setup, and assertions are mixed everywhere
- helpers exist but obscure intent
- adding a new scenario would be unnecessarily difficult

### Reviewer Questions

- Could another engineer extend this suite safely?
- Is the structure deliberate and maintainable?
- Does the code optimize for readability of behavior?

---

## 8) Documentation and Communication

### What Reviewers Should Look For

- clear explanation of strategy, assumptions, setup, and limitations
- realistic tradeoff discussion
- execution instructions that match the repository
- candid explanation of AI usage if any

### Strong Signals

- README/PR makes setup and scope easy to understand
- candidate explains what they chose not to automate and why
- limitations are honest and technically grounded
- PR description aligns with the code

### Weak Signals

- documentation sparse or inconsistent with implementation
- setup difficult to follow
- no explanation of tradeoffs
- PR description does not address the required review dimensions

### Reviewer Questions

- Can a reviewer understand the confidence story quickly?
- Are assumptions and gaps clear?
- Does the candidate communicate like a senior engineer?

---

## Suggested Overall Rating Bands

### Exceptional
The candidate designed a strong transactional automation suite with clear end-to-end reasoning from API to database and adjacent components.  
The reliability coverage is targeted, the assertions are deep, and the suite is maintainable.

### Strong
The solution is practical, well-structured, and confidence-building.  
There may be simplifications, but the core automation strategy is convincing.

### Mixed
There are good ideas, but one or more critical areas are underdeveloped, such as persistence verification, idempotency, or concurrency coverage.

### Weak
The submission behaves more like an endpoint smoke-test pack than an SDET-grade transactional validation suite.  
Confidence in real system correctness remains low.

---

## Common Failure Patterns

Reviewers should watch for these:

- tests stop at API response and never verify database state
- duplicate request behavior not covered
- no same-key/different-payload case
- no concurrency coverage
- wallet balances checked superficially or not at all
- side effects assumed rather than validated
- brittle, repetitive test structure
- no clear strategy for seeded data and cleanup

---

## What to Value Most

When in doubt, prioritize:

1. end-to-end validation from API to persistence
2. duplicate and retry safety coverage
3. meaningful invariants and assertions
4. concurrency and reliability coverage
5. maintainable suite architecture
6. breadth of tooling last

A smaller suite that proves the critical behaviors should outrank a larger suite of shallow tests.
