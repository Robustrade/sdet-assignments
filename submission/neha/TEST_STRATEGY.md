# Test Strategy — Wallet Transfer Automation

## Assumptions

- Transfers are synchronous within the service fixture: success means balances are updated and a `completed` transfer row exists before the HTTP response returns.
- Amounts are integer minor units.
- Exactly-once API semantics are keyed by `Idempotency-Key`.
- Surrounding systems (message bus, notifications) are represented by durable `outbox_events` rows, not a live broker.

## In scope

- API contract and validation errors
- Happy-path balance movement and transfer persistence
- Insufficient-balance rejection with zero side effects
- Idempotent replay and same-key/different-payload conflict
- Concurrent competing transfers and concurrent duplicate keys
- Audit + outbox consistency (count and content)

## Out of scope

- UI / browser automation
- Performance or soak testing
- Real Kafka/RabbitMQ/SNS publishing
- Multi-currency FX conversion
- AuthN/AuthZ

## What is real vs stubbed

| Component            | Status                                      |
|----------------------|---------------------------------------------|
| HTTP API             | Real (Flask test client)                    |
| SQLite persistence   | Real (in-memory, per-test)                  |
| Idempotency store    | Real (`idempotency_keys` table)             |
| Audit log            | Real (`audit_events`)                       |
| Outbox / publish     | Real table; broker consumer is stubbed/absent |

## Layers covered

1. **API** — status codes, payload fields, duplicate replay responses  
2. **Workflow** — debit/credit invariants, rejection paths, retry safety  
3. **Database** — wallets, transfers, idempotency_keys, audit_events, outbox_events  
4. **Cross-component** — one audit + one outbox per successful transfer; none on reject/replay  

## Tables and invariants

| Table              | Asserted invariants                                      |
|--------------------|----------------------------------------------------------|
| wallets            | balance changes exactly once on success; unchanged on reject |
| transfers          | one row per logical transfer; status matches API         |
| idempotency_keys   | key maps to one transfer; payload hash conflict → 409    |
| audit_events       | exactly one `transfer_completed` per success             |
| outbox_events      | exactly one `wallet.transfer.completed` per success      |

## Concurrency strategy

- Competing transfers use threads + shared app/DB lock semantics to prove no overdraft.
- Same-key storms assert a single debit and single side-effect set.
- These tests give confidence for process-local races; they do not prove distributed locking across multiple nodes.

## Seed / cleanup

- Fresh `:memory:` DB per test fixture; no shared mutable state across tests.
- Seed wallets inserted in `conftest.py`; connection closed after each test.

## Known limitations

- SQLite + process mutex models single-process concurrency, not multi-instance deployments.
- Outbox “publish” is not drained by a worker; we verify write-once durability only.
- No chaos injection for mid-transaction crashes (would need crash-harness tooling).
