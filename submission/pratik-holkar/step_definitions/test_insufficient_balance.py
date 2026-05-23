"""Insufficient balance: total rejection. No persistence, no side effects."""

import pytest

from utilities.data_loader import load_cases
from utilities.soft_assert import SoftAssert

CASES, _ = load_cases("insufficient_balance.yaml")


@pytest.mark.insufficient
@pytest.mark.parametrize("case", CASES)
def test_insufficient_balance(case, api, db, step_log):
    payload = case["request"]["payload"]
    exp = case["expected"]
    sa = SoftAssert(step_log)

    with step_log.step(f"POST /transfers ({case['id']})"):
        resp = api.create_transfer(payload, idempotency_key=case["request"].get("idem"))

    sa.equals(resp.status_code, exp["status"], "rejection status code")
    sa.equals((resp.json() or {}).get("error"), exp["error"], "error code in body")
    sa.equals(db.balance(payload["source_wallet_id"]), exp["src_balance"], "source unchanged")
    sa.equals(db.balance(payload["dest_wallet_id"]), exp["dst_balance"], "dest unchanged")
    sa.equals(db.transfer_count(), exp["transfer_count"], "no transfer rows")
    sa.equals(db.ledger_count(), exp["ledger_count"], "no ledger entries")
    sa.assert_all()
