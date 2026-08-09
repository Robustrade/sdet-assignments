"""Idempotency: safe replays and same-key/different-payload conflict."""

import pytest

from utilities.data_loader import load_cases
from utilities.soft_assert import SoftAssert

CASES, _ = load_cases("idempotency.yaml")


@pytest.mark.idempotency
@pytest.mark.parametrize("case", CASES)
def test_idempotency(case, api, db, step_log):
    sa = SoftAssert(step_log)
    req = case["request"]
    exp = case["expected"]
    key = req["idem"]

    if case["id"] == "replay_same_key_same_payload":
        with step_log.step("first POST creates the transfer"):
            first = api.create_transfer(req["payload"], idempotency_key=key)
        sa.equals(first.status_code, exp["first_status"], "first call 201")
        original_id = (first.json() or {}).get("transfer_id")

        for i in range(req.get("replays", 1)):
            with step_log.step(f"replay #{i + 1} returns same transfer"):
                r = api.create_transfer(req["payload"], idempotency_key=key)
                sa.equals(r.status_code, exp["replay_status"], f"replay #{i + 1} status")
                sa.equals(
                    (r.json() or {}).get("transfer_id"),
                    original_id,
                    f"replay #{i + 1} returns original id",
                )

    elif case["id"] == "same_key_different_payload_is_conflict":
        with step_log.step("first payload succeeds"):
            r1 = api.create_transfer(req["first"], idempotency_key=key)
            sa.equals(r1.status_code, exp["first_status"], "first call 201")
        with step_log.step("second payload with same key is 409"):
            r2 = api.create_transfer(req["second"], idempotency_key=key)
            sa.equals(r2.status_code, exp["second_status"], "second call 409")

    with step_log.step("exactly one transfer row for this key"):
        rows = db.transfers_for_key(key)
        sa.equals(len(rows), exp["transfer_count"], "transfer row count")

    with step_log.step("source debited exactly once"):
        src = (req.get("payload") or req.get("first"))["source_wallet_id"]
        sa.equals(db.balance(src), exp["src_balance"], "source balance")

    if "ledger_rows" in exp:
        sa.equals(db.ledger_count(), exp["ledger_rows"], "ledger row count")
    if "outbox_rows" in exp:
        sa.equals(db.outbox_count(), exp["outbox_rows"], "outbox row count")

    sa.assert_all()
