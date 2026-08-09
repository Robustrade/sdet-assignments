"""Reliability: concurrency invariants the brief calls out.

The SUT uses BEGIN IMMEDIATE + retry, no Python-level mutex, so these
tests exercise real DB locking. The brief only asks us to demonstrate
deliberate thinking about failure-prone behaviour; we assert invariants
(no overspend, single debit per key) rather than thread schedules.
"""

import threading

import pytest

from utilities.data_loader import load_cases
from utilities.soft_assert import SoftAssert

CASES, _ = load_cases("reliability.yaml")


def _fire(app, payload, idem, n):
    """Spawn n threads, each posting one transfer. Return list of status codes."""
    statuses = []
    lock = threading.Lock()
    barrier = threading.Barrier(n)

    def worker():
        # Barrier ensures threads start within a few ms of each other so we
        # actually contend, not just queue.
        barrier.wait()
        with app.test_client() as c:
            headers = {"Idempotency-Key": idem} if idem else {}
            resp = c.post("/transfers", json=payload, headers=headers)
            with lock:
                statuses.append(resp.status_code)

    threads = [threading.Thread(target=worker) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return statuses


@pytest.mark.reliability
@pytest.mark.parametrize("case", CASES)
def test_reliability(case, app, db, api, step_log):
    sa = SoftAssert(step_log)
    req = case["request"]
    exp = case["expected"]
    payload = req["payload"]

    if case["id"] == "competing_transfers_never_overspend":
        n = req["threads"]
        with step_log.step(f"fire {n} competing transfers"):
            statuses = _fire(app, payload, None, n)
        successes = statuses.count(201)
        rejections = statuses.count(422)
        with step_log.step(f"statuses observed: {statuses}"):
            sa.check(
                successes <= exp["max_successes"],
                f"at most {exp['max_successes']} succeed",
            )
            sa.equals(successes + rejections, n, "every request got a definitive answer")

        balance = db.balance(payload["source_wallet_id"])
        sa.check(balance >= exp["min_balance"], "balance never negative")
        sa.equals(
            balance,
            50_000_00 - successes * payload["amount_minor"],
            "balance == start - successes*amount (no lost updates)",
        )
        sa.equals(db.transfer_count(), successes, "transfer rows match successes")
        sa.equals(db.outbox_count(), successes, "outbox rows match successes")

    elif case["id"] == "same_idem_key_under_contention":
        n = req["threads"]
        with step_log.step(f"fire {n} requests sharing one idem key"):
            statuses = _fire(app, payload, req["idem"], n)
        sa.check(
            all(s in (200, 201) for s in statuses),
            f"every concurrent status is 200 or 201; got {statuses}",
        )
        sa.equals(db.transfer_count(), exp["transfer_count"], "exactly one transfer row")
        sa.equals(db.balance(payload["source_wallet_id"]), exp["src_balance"], "single debit")
        sa.equals(db.ledger_count(), exp["ledger_rows"], "exactly two ledger rows")
        sa.equals(db.outbox_count(), exp["outbox_rows"], "exactly one outbox row")

    elif case["id"] == "retry_storm_no_double_debit":
        for _ in range(req["replays"]):
            api.create_transfer(payload, idempotency_key=req["idem"])
        sa.equals(db.transfer_count(), exp["transfer_count"], "one transfer after N retries")
        sa.equals(db.balance(payload["source_wallet_id"]), exp["src_balance"], "debited once")
        sa.equals(db.ledger_count(), exp["ledger_rows"], "two ledger rows")
        sa.equals(db.outbox_count(), exp["outbox_rows"], "one outbox row")

    sa.assert_all()
