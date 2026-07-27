# Understanding & Approach — Wallet Transfer SDET Assignment

> This document fulfills the email instruction to outline **understanding and approach before / alongside** the full solution (dummy-PR style design note).

Candidate: **Neha**  
Role: SDET – SDE3 — Robustrade (Viditech)  
Repo: https://github.com/Robustrade/sdet-assignments/

---

## My understanding of the problem

This is **not** a CRUD API smoke-test exercise.

The system under test moves money between wallets and must stay correct when:

- requests are duplicated
- clients retry after a lost response
- concurrent transfers compete for limited balance
- API success must match durable database state

So the automation must prove **transactional invariants** across:

1. API response  
2. wallet balances  
3. transfer persistence  
4. idempotency storage  
5. adjacent side effects (audit / outbox)

Building a full production service is **not** the goal. Designing a confidence-building test strategy is.

---

## Approach I chose

**Hybrid (Option 2/3 from the assignment):**

- Implement a **minimal Flask + SQLite fixture** under `service/` so tests have a real API + real persistence locally
- Keep surrounding broker systems out of scope; model publish-once behavior with an **`outbox_events`** table
- Structure tests in layers:
  - fixtures / seed data
  - API client
  - builders
  - DB assertion helpers
  - scenario specs by risk area

## Risk-based coverage plan

| Risk | How I validate it |
|------|-------------------|
| Happy path debit/credit | API 201 + balance deltas + transfer/audit/outbox rows |
| Bad input | 422 + zero side effects |
| Insufficient funds | 422 + balances unchanged |
| Duplicate same key | 200 replay, same transfer id, no double debit |
| Same key, different payload | 409 conflict, no extra mutation |
| Concurrent competing transfers | balance never negative; success count matches remaining funds |
| Concurrent same idempotency key | exactly one transfer + one side-effect set |
| Retry storm | 5 retries → one debit |

## Documentation-first note

Before coding the suite, the intended strategy is:

- assert **invariants**, not only status codes
- always compare **API outcome ↔ DB state**
- treat idempotency + concurrency as mandatory
- keep scope tight for a 3–5 hour take-home

Detailed strategy, assumptions, and limitations: [`TEST_STRATEGY.md`](./TEST_STRATEGY.md)  
How to run: [`README.md`](./README.md)

## What I will / did submit in the PR

- automation tests
- minimal service fixture
- schema validation script
- README + strategy docs
- PR description covering all required review sections (including AI disclosure)
