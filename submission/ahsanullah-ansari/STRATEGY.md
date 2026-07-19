# Wallet Transfer Service — Test Strategy

> Candidate: **Ahsanullah Ansari** · Branch: `solution/ahsanullah-ansari` · Status: **Draft / Understanding & Approach (Step 1)**
>
> This document is the "dummy PR" deliverable. It defines the validation strategy **before** significant automation code is written, per the assignment's documentation-first workflow. The full implementation will follow in this same PR as additional commits.

---

## 1. What I am trying to prove

A wallet transfer is money moving between two accounts. The single question the test suite must answer is:

> **After every request the API acknowledges — successful or failed, first-attempt or retried, sequential or concurrent — is the system in a state that is arithmetically correct, auditable, and free of duplicate side effects?**

Everything below is in service of answering that question with automation.

The bugs I am specifically trying to catch:

| # | Bug class | Failure mode |
|---|---|---|
| B1 | Double debit / double credit | A retried request debits the source twice |
| B2 | Torn transfer | Source is debited but destination is not credited (or vice versa) |
| B3 | Idempotency-key aliasing | Same key + different payload silently succeeds and mutates state |
| B4 | Lost-update on concurrent debits | Two parallel transfers each see enough balance and both succeed, overdrawing |
| B5 | Ghost transfer | API returns 201 but no row is persisted |
| B6 | Duplicate side effects | Outbox/audit row is written more than once for a single logical transfer |
| B7 | State-machine leaks | Rejected transfer somehow leaves persisted mutations |
| B8 | Response/DB divergence | API says `status=SETTLED` but DB says `PENDING` |

These are the invariants that drive the test scenarios — not endpoints.

---

## 2. System-Under-Test (SUT) assumptions

The assignment does not ship a service. I am taking **Option 2 (Hybrid)** from the assignment: I will build a **minimal FastAPI + Postgres fixture service** that is realistic enough to have the failure modes above, then wrap it in the automation suite. This lets me demonstrate multi-layer validation on something concrete, rather than mocking every layer into meaninglessness.

### 2.1 SUT surface

| Endpoint | Purpose |
|---|---|
| `POST /transfers` | Create a transfer. Requires `Idempotency-Key` header |
| `GET /transfers/{id}` | Read a transfer by id |
| `GET /wallets/{id}` | Read wallet metadata and current balance |
| `POST /wallets` *(test-only)* | Seed wallets for tests |

Request body:

```json
{
  "source_wallet_id": "wallet_001",
  "destination_wallet_id": "wallet_002",
  "amount": 2500,
  "currency": "AED",
  "reference": "invoice_123"
}
```

HTTP status-code convention the SUT will follow (also asserted by the suite):

| Code | Meaning in this service | Scenarios |
|---|---|---|
| `201 Created` | Transfer accepted and settled | #1, #8 (replay), #11 (concurrent-duplicate winners) |
| `400 Bad Request` | Malformed body / schema violation (missing field, non-positive amount, same source & destination, missing idempotency header) | #2, #3, #4, #6 |
| `404 Not Found` | Referenced transfer/wallet id does not exist | #13, #14 |
| `409 Conflict` | Idempotency-key reuse with a **different** payload — reserved exclusively for this case | #9 |
| `422 Unprocessable Entity` | Business-rule rejection — request is well-formed and wallets exist, but the transfer cannot be applied (insufficient balance, currency mismatch between the two referenced wallets) | #5, #7, #12 (losing debit) |

Note on currency mismatch (scenario #5): the request body is well-formed and both wallet ids resolve, so it is not a `400` (malformed) nor a `404` (not found). The service can only reject it after a DB lookup shows the two wallets are in different currencies — that is the same shape as insufficient-balance, so it is grouped under `422`.

Reserving `409` for the idempotency-conflict case and `422` for business-rule rejections means a caller can distinguish "your request is malformed vs. duplicated vs. impossible" from the status code alone. This is what scenario #12 asserts (`[201, 422]`), and it's what row 12 of the coverage matrix reflects.

### 2.2 Persistence model

Five tables, mirroring the assignment's required coverage:

| Table | Purpose |
|---|---|
| `wallets` | `id, currency, balance_minor_units, version` |
| `transfers` | `id, source_id, dest_id, amount, currency, status, reference, created_at` |
| `idempotency_keys` | `key, request_hash, response_body, transfer_id, created_at` (unique on `key`) |
| `transfer_events` | Append-only audit log: `id, transfer_id, event_type, payload, occurred_at` |
| `outbox_events` | `id, aggregate_id, event_type, payload, published_at NULL` — the transactional outbox |

Money is stored in **minor units (integer)** — floating-point currency is an anti-pattern that would itself be a bug worth catching.

### 2.3 Correctness mechanisms the SUT will implement

Just enough for the invariants above to be testable:

- Transfer creation runs inside a single DB transaction that: (a) inserts the idempotency-key row (`INSERT` with `UNIQUE (key)`; `response_body` starts `NULL` — see §7 for the full lifecycle), (b) `SELECT ... FOR UPDATE` on both wallets (ordered by id to avoid deadlock), (c) checks source balance, (d) updates both balances, (e) inserts the transfer row, (f) writes an event row, (g) writes an outbox row, (h) `UPDATE`s the idempotency-key row with the response body and `transfer_id`. Commit is atomic. The idempotency row is INSERT + UPDATE within one transaction, not an UPSERT — see §7.
- Idempotency-key row is inserted with a `UNIQUE` constraint on `key`. Second attempt with the same key returns the stored response verbatim. Second attempt with the same key but a **different payload hash** returns `409 Conflict`.
- Concurrency safety comes from row-level locks; I will not rely on optimistic-version retry.

### 2.4 What is real vs stubbed

| Component | In this suite | Rationale |
|---|---|---|
| API | Real FastAPI process (in-proc via `TestClient` for most tests; separate uvicorn process for concurrency tests) | Async races only reproduce under a real event loop with real HTTP |
| Database | Real Postgres 16 via Testcontainers | SQLite lacks `SELECT FOR UPDATE` semantics; the concurrency tests would silently pass and prove nothing |
| Idempotency store | Real DB table | Same reason — needs the UNIQUE constraint to be a real UNIQUE constraint |
| Outbox | Real DB table (`outbox_events`) written in the same tx as the transfer | The outbox pattern is exactly what enables exactly-once emission; testing it in-memory would defeat the point |
| Message broker consumer | **Stubbed** — I verify outbox rows are written correctly, not that a Kafka consumer picked them up | Out of scope for the time-box; the outbox is the contract |
| Notification / downstream webhooks | **Stubbed** — an in-process `WebhookRecorder` counts calls | Enough to prove exactly-once dispatch semantics without wiring a real webhook target |
| Clock | Injectable; frozen in most tests | Deterministic timestamps in audit assertions |

This is called out explicitly so a reviewer knows which claims are load-bearing.

---

## 3. Scope

### 3.1 In scope

- API contract validation (happy + failure paths)
- Idempotency semantics: replay, conflict, no-side-effects
- Concurrency: duplicate in-flight requests with same key; competing debits on same wallet
- DB-level invariants after every scenario
- Outbox exactly-once emission
- Audit event coherence with API-visible transfer state
- Data seeding + per-test isolation
- Red / Blue / Green discipline where the commit history reflects it

### 3.2 Explicitly out of scope

- UI or frontend
- Multi-currency FX conversion (single-currency wallets only; mismatched currency is rejected with `422` — see §2.1)
- Performance / load testing (the assignment excludes this)
- Real message broker (Kafka/RabbitMQ) — outbox table is the observable
- Distributed transactions across services
- Auth / authz — assumed present in production, not modelled here
- Production observability (metrics, tracing) — noted as a follow-up, not automated

Stating what I chose **not** to automate is a signal. A senior engineer's suite is defined as much by what it deliberately omits.

---

## 4. Coverage matrix

Each row is one behavior; each column is a layer that gets asserted for that behavior. `A` = API response, `D` = database, `E` = event/audit table, `O` = outbox, `S` = side-effect (webhook recorder).

| # | Scenario | A | D | E | O | S |
|---|---|:-:|:-:|:-:|:-:|:-:|
| 1 | Happy path — sufficient balance, single request | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2 | Missing required field (`amount`) | ✓ | ✓ (absence) | · | · | · |
| 3 | Amount ≤ 0 | ✓ | ✓ (absence) | · | · | · |
| 4 | Same source & destination wallet | ✓ | ✓ (absence) | · | · | · |
| 5 | Currency mismatch between wallets | ✓ (422) | ✓ (absence) | · | · | · |
| 6 | Missing `Idempotency-Key` header | ✓ | ✓ (absence) | · | · | · |
| 7 | Insufficient balance | ✓ | ✓ (no mutation) | ✓ (rejection logged) | ✓ (absence) | ✓ (absence) |
| 8 | Idempotent replay — same key, same payload | ✓ (byte-identical body) | ✓ (single row) | ✓ (single event) | ✓ (single row) | ✓ (single call) |
| 9 | Idempotency conflict — same key, different payload | ✓ (409) | ✓ (no mutation) | · | · | · |
| 10 | Retry after simulated response loss | ✓ (identical response) | ✓ (no new rows) | · | ✓ (no new rows) | · |
| 11 | Concurrent duplicate — N parallel requests, same key | ✓ (all responses identical) | ✓ (exactly one transfer) | ✓ (exactly one event) | ✓ (exactly one outbox row) | ✓ (exactly one call) |
| 12 | Concurrent competing debits — wallet has 100, two ×60 requests parallel | ✓ (one 201, one 422) | ✓ (balance = 40) | ✓ (one success + one rejection) | ✓ (one row) | ✓ (one call) |
| 13 | Not-found transfer id | ✓ (404) | · | · | · | · |
| 14 | Not-found wallet id | ✓ (404) | · | · | · | · |
| 15 | Outbox row is written inside the transfer tx (killed process before commit → no orphan outbox) | · | ✓ | · | ✓ | · |

15 scenarios × ~4 assertion layers ≈ 60 concrete invariants exercised. This is intentionally close to the ceiling of what fits in a 3–5 hour scope — no filler.

---

## 5. Invariants (the assertion vocabulary)

Every scenario resolves down to a small alphabet of invariants. Extracting these into a named helper module — rather than repeating them per test — is what keeps the suite maintainable.

```python
# tests/assertions/invariants.py
def assert_balance_conserved(before: Snapshot, after: Snapshot, amount: int):
    assert (before.source - after.source) == amount
    assert (after.dest - before.dest) == amount
    assert (before.source + before.dest) == (after.source + after.dest)

def assert_no_mutation(before: Snapshot, after: Snapshot):
    assert before == after

def assert_exactly_one_transfer(db, idempotency_key: str):
    # §2.2 keeps idempotency in a dedicated `idempotency_keys` table with an FK
    # to `transfers`, so we join through it rather than looking up a column on
    # `transfers` directly.
    rows = db.query(
        """
        SELECT t.*
        FROM transfers t
        JOIN idempotency_keys ik ON ik.transfer_id = t.id
        WHERE ik.key = %s
        """,
        (idempotency_key,),
    )
    assert len(rows) == 1, f"expected 1 transfer for key={idempotency_key}, got {len(rows)}"

def assert_outbox_emitted_once(db, transfer_id: str):
    rows = db.query(
        "SELECT * FROM outbox_events WHERE aggregate_id = %s",
        (transfer_id,),
    )
    assert len(rows) == 1, f"expected 1 outbox row for transfer={transfer_id}, got {len(rows)}"

def assert_response_matches_db(api_body, db_row):
    # explicit field-by-field, not deep-equal, so failures name the diverging field
    ...
```

Assertions read like domain sentences. A failure message says *"balance not conserved: source lost 60, dest gained 0"* — not *"expected 40, got 100"*.

---

## 6. Test architecture

```
submission/ahsanullah-ansari/
├── STRATEGY.md                  ← this document
├── README.md                    ← how to run
├── pyproject.toml
├── requirements.txt
├── scripts/
│   └── validate_schema.py       ← matches evaluation guide expectation
├── service/                     ← minimal SUT (FastAPI + SQLAlchemy)
│   ├── __init__.py
│   ├── app.py                   ← routes
│   ├── models.py                ← SQLAlchemy models
│   ├── repo.py                  ← DB access
│   ├── idempotency.py           ← key + payload-hash logic
│   └── outbox.py                ← outbox write helper
└── tests/
    ├── conftest.py              ← Testcontainers Postgres, seeded wallets, HTTP client
    ├── clients/
    │   └── wallet_api.py        ← thin API wrapper, keeps HTTP out of scenarios
    ├── builders/
    │   ├── wallets.py           ← wallet(id="w1", balance=1000, currency="AED")
    │   ├── transfers.py         ← transfer_request(...)
    │   └── keys.py              ← fresh_idempotency_key()
    ├── assertions/
    │   ├── api_asserts.py       ← response shape, status code + body
    │   ├── db_asserts.py        ← balance_of(), transfer_row(), outbox_rows(), events_for()
    │   └── invariants.py        ← domain-level assertions (see §5)
    └── scenarios/
        ├── test_happy_path.py
        ├── test_validation.py
        ├── test_insufficient_balance.py
        ├── test_idempotency.py
        ├── test_concurrency.py       ← marked @pytest.mark.reliability
        └── test_outbox_exactly_once.py
```

The **five-layer separation** the assignment requires:

| Layer | Where | Why |
|---|---|---|
| Fixtures / environment | `conftest.py` | One place to spin Postgres, seed wallets, hand back a clean HTTP client per test |
| API client | `tests/clients/` | Zero HTTP transport details leak into scenarios |
| Assertions / verification | `tests/assertions/` | Domain-level (`assert_balance_conserved`), not framework-level (`assert response.json()["balance"] == 40`) |
| Scenarios | `tests/scenarios/` | Reads like a specification; a reviewer can grep for "concurrent" and find the test |
| Data builders | `tests/builders/` | `wallet(balance=1000)` is a one-liner; setup noise doesn't drown the assertions |

Extending the suite = add a scenario file. That's the maintainability criterion.

---

## 7. Idempotency strategy

Idempotency is where wallet-transfer services most commonly leak money in production. The suite treats it as a first-class concern.

The DB is the source of truth: the `idempotency_keys` table has `UNIQUE (key)` and stores `request_hash` (SHA-256 of the canonicalised request body) plus the original response body.

The lifecycle:

```
POST /transfers with Idempotency-Key = K, payload P
  ├─ First arrival:
  │    BEGIN
  │    INSERT INTO idempotency_keys (key=K, request_hash=sha(P), response_body=NULL) ...
  │    ... execute transfer ...
  │    UPDATE idempotency_keys SET response_body = <body>, transfer_id = <id> WHERE key = K
  │    COMMIT
  │    return 201 <body>
  │
  ├─ Second arrival, same K, same P:
  │    SELECT response_body FROM idempotency_keys WHERE key = K
  │    → return stored 201 <body>, no state mutation
  │
  ├─ Second arrival, same K, different P:
  │    hash mismatch → return 409 Conflict, no state mutation
  │
  └─ Second arrival with K while first is still in flight:
       INSERT hits UNIQUE violation → wait / retry read → return the stored response once first commits
```

Tests **assert** each branch, including the "no state mutation" postcondition — because a bug where the conflict branch still touches wallets is a real one.

---

## 8. Concurrency strategy

Concurrency tests don't have to be complex to be meaningful — they have to actually race, and they have to fail loudly when they do.

Two concurrency scenarios, both required by the assignment:

### 8.1 Duplicate in-flight (scenario #11)

```python
def test_concurrent_duplicate_creates_exactly_one_transfer(client, db, wallets):
    key = fresh_idempotency_key()
    payload = transfer_request(src=wallets.a, dst=wallets.b, amount=50)

    with ThreadPoolExecutor(max_workers=10) as pool:
        responses = list(pool.map(
            lambda _: client.post_transfer(payload, idempotency_key=key),
            range(10),
        ))

    assert all(r.status_code == 201 for r in responses)
    assert len({r.text for r in responses}) == 1   # byte-identical bodies
    assert_exactly_one_transfer(db, idempotency_key=key)
    assert_outbox_emitted_once(db, transfer_id=extract_id(responses[0]))
    assert balance_of(db, wallets.a) == 950
    assert balance_of(db, wallets.b) == 1050
```

10 threads, 1 idempotency key, real DB, real HTTP. If the UNIQUE constraint isn't in place, this fails on `assert_exactly_one_transfer`.

### 8.2 Competing debits on the same wallet (scenario #12)

```python
def test_two_transfers_racing_for_limited_balance(client, db, wallets):
    seed_wallet(wallets.a, balance=100)
    payload = transfer_request(src=wallets.a, dst=wallets.b, amount=60)

    responses = parallel_post(client, [
        (payload, fresh_idempotency_key()),
        (payload, fresh_idempotency_key()),
    ])

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [201, 422]              # exactly one wins
    assert balance_of(db, wallets.a) == 40     # not -20, not 100
    assert len(transfers_for(db, wallets.a)) == 1
```

If row-locking is missing, `balance_of(db, wallets.a)` returns `-20` and the test fails hard. This is the "double debit" test.

Concurrency tests are `@pytest.mark.reliability` so they can be run in isolation via `pytest -m reliability`, and are part of the default suite in CI.

---

## 9. Data seeding & isolation

Per-test isolation is a cheap way to avoid an entire category of false positives.

- **Postgres via Testcontainers** at session scope — one container per pytest process, not per test (container startup is ~2s, per-test would dominate wall time). Only the container itself is session-scoped; the data inside it is reset every test.
- **Fresh state per test** (not per class) via a function-scoped fixture: `TRUNCATE ... RESTART IDENTITY CASCADE` on every table for concurrency tests, or a nested `SAVEPOINT` that is rolled back at teardown for single-connection tests. Class-scoped truncation would let two tests in the same class see each other's rows, which is exactly the kind of coupling this section is meant to prevent.
- **Wallet ids are generated per-test** (`wallet_{uuid[:8]}`) — no test hardcodes `wallet_001`. This makes accidental cross-test coupling impossible.
- **Idempotency keys are always fresh** unless a test is deliberately validating replay behavior.

This is how the suite avoids the "test A passed only because test B ran first" problem.

---

## 10. Cross-component validation

The assignment specifically calls out "beyond the API boundary." Two components are exercised beyond `transfers` and `wallets`:

1. **`outbox_events`** — asserted for exactly-once emission on success, and for **absence** on all failure paths. Any transfer failing validation, insufficient-balance, or idempotency-conflict must produce zero outbox rows. This is what proves a downstream consumer would not see phantom events.
2. **`transfer_events`** — the audit log. Asserted for internal consistency: for every persisted `transfers` row there is a `CREATED` event; for every settled transfer there is a `SETTLED` event; for every rejected transfer there is a `REJECTED` event with a reason. No orphan events, no missing events. This is what a compliance/reconciliation team would care about.

A `WebhookRecorder` fake is registered as a downstream subscriber in one scenario to prove exactly-once dispatch (call count = 1 for scenario #11's 10-parallel duplicate). Reviewers see the pattern without me having to stand up a real webhook target.

---

## 11. Test-first (Red / Blue / Green) discipline

The commit history will reflect this. For each scenario in §4:

1. **Red** — write the failing scenario against a stub API that returns `501 Not Implemented`, or against a service missing the invariant. Commit: `red: concurrent duplicate must produce exactly one transfer row`.
2. **Blue** — add just enough service code (or the UNIQUE constraint, or the `FOR UPDATE` lock) to make it pass. Commit: `blue: add UNIQUE(key) on idempotency_keys`.
3. **Green** — refactor: pull assertions into helpers, deduplicate builders, tighten naming. Commit: `green: extract assert_exactly_one_transfer helper`.

Not every scenario needs three commits — small ones combine — but the shape is visible in `git log`. This proves the tests actually failed at some point, which is the only way to know they can fail again.

---

## 12. Tech stack

| Choice | Rationale |
|---|---|
| **Python 3.11** | Readable pytest scenarios; the sample submission uses Python; short time-to-first-passing-test |
| **pytest** | `parametrize` compresses the validation matrix; fixtures compose cleanly; `-m reliability` marker for concurrency isolation |
| **FastAPI** | Fastest way to a real HTTP surface with declared request/response schemas |
| **SQLAlchemy 2.0 (Core)** | Explicit SQL where locking matters (`.with_for_update()`); less magic than ORM sessions in concurrency tests |
| **Testcontainers-Postgres** | Real Postgres, real UNIQUE constraint, real row locks — the alternative (SQLite) silently makes concurrency tests pass for the wrong reason |
| **httpx** | Sync `httpx.Client` throughout — the two concurrency scenarios drive parallelism with `ThreadPoolExecutor` (see §8.1) rather than an asyncio event loop; that keeps the tests readable and matches the concrete example without introducing async plumbing |
| **ruff + black** | Match the CI expectations already present in the repo |

Rejected alternatives:

- **SQLite in-memory** — no `FOR UPDATE`, no real UNIQUE-under-concurrency semantics. Would give false confidence.
- **Mocked DB / repository layer** — the whole point of the exercise is DB-truth verification; mocking it away defeats the assignment.
- **Java + Spring** — more boilerplate for equal signal in a 3–5 hour budget.

---

## 13. Risks, tradeoffs, and known limitations

Called out honestly, because the evaluation guide rewards this:

1. **The SUT is my own fixture.** A test suite validating a service you also wrote is at risk of only testing what you already thought of. I mitigate by writing scenarios first (Red step) against the invariants in §1 — the SUT's job is only to make those tests pass, not to define them.
2. **No real message broker.** Outbox rows are the observable; a real consumer's exactly-once behavior isn't proven. In a real engagement I'd add a Testcontainers-Kafka and an in-test consumer that asserts on `SELECT ... WHERE published_at IS NULL`.
3. **Clock is injectable but not exhaustive.** Time-based edge cases (idempotency key TTL, event ordering across DST) aren't automated. Noted, not automated.
4. **Concurrency tests are stochastic.** They will nearly always catch a lost-update bug on the first run, but a single passing run isn't proof of correctness under all interleavings. `pytest --count=20 -m reliability` is documented as the way to shake harder.
5. **No auth / rate-limiting / observability.** Real production concerns; out of the 3–5 hour scope.
6. **The service fixture is a fixture, not production code.** No connection pooling tuning, no graceful shutdown, no migrations tool. It exists to make the tests meaningful.

---

## 14. Delivery plan

| Phase | Deliverable | Commit(s) |
|---|---|---|
| 1 (done — this PR) | STRATEGY.md, empty submission scaffold, draft PR opened | `docs: add STRATEGY.md and submission scaffold` |
| 2 | Minimal FastAPI service, Testcontainers-Postgres fixture, first failing happy-path test | `red/blue/green: happy path end-to-end` |
| 3 | Validation + insufficient-balance scenarios | `red/blue/green: validation and insufficient balance` |
| 4 | Idempotency scenarios (replay, conflict, retry-after-loss) | `red/blue/green: idempotency` |
| 5 | Concurrency scenarios (duplicate in-flight, competing debits) | `red/blue/green: concurrency` |
| 6 | Outbox + audit exactly-once | `red/blue/green: outbox exactly-once` |
| 7 | README, run instructions, `scripts/validate_schema.py`, PR description filled in per template | `docs: README and PR description` |
| 8 | Convert draft PR → ready for review | — |

Time budget: **~5 hours** across two working days, per assignment guidance.

---

## 15. Responsible AI usage

I use Claude (Anthropic's coding assistant) as a pair-programmer during this assignment. Being explicit about what that means for this submission:

- **Used for**: structuring this strategy document, generating scaffolding boilerplate (SQLAlchemy models, pytest fixture wiring, FastAPI route stubs), and reviewing assertion helper names.
- **Not used for**: choosing the invariants in §1, deciding scope in §3, designing the concurrency scenarios in §8, or fabricating results. Those come from domain reasoning about wallet systems and my experience testing transactional flows.
- **What I personally verify**: every test that gets committed runs locally and I read its failure message before considering it done. Every invariant in §5 I can defend on its own merit. Every commit message is mine.

The suite would look substantially the same without AI assistance — AI accelerated the typing, not the thinking.

---

## Reviewer checklist for this dummy PR

- [x] Strategy stated **before** substantial automation code is written
- [x] Distinction between real and stubbed components made explicit (§2.4)
- [x] Scenario coverage matrix present (§4)
- [x] Invariants named, not just described (§5)
- [x] Concurrency approach concrete, with example code (§8)
- [x] Idempotency approach covers replay, conflict, and in-flight duplicate (§7)
- [x] Test architecture matches the five-layer separation in the assignment
- [x] Risks and limitations stated candidly (§13)
- [x] AI usage disclosed (§15)
- [ ] Full implementation — arriving in follow-up commits on this same branch
