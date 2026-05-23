"""Validation failures: bad input must be rejected AND must not persist anything."""

import pytest

from utilities.data_loader import load_cases
from utilities.soft_assert import SoftAssert

CASES, _ = load_cases("validation.yaml")


@pytest.mark.validation
@pytest.mark.parametrize("case", CASES)
def test_validation_rejection(case, api, db, step_log):
    sa = SoftAssert(step_log)

    with step_log.step(f"POST /transfers ({case['id']})"):
        resp = api.create_transfer(case["request"]["payload"])

    sa.equals(resp.status_code, case["expected"]["status"], "rejection status code")
    if "error" in case["expected"]:
        body = resp.json() or {}
        sa.equals(body.get("error"), case["expected"]["error"], "error code in body")

    sa.equals(db.transfer_count(), 0, "no transfer row")
    sa.equals(db.ledger_count(), 0, "no ledger entries")
    sa.equals(db.outbox_count(), 0, "no outbox events")
    sa.equals(db.balance("acc_alpha"), 50_000_00, "acc_alpha balance unchanged")
    sa.equals(db.balance("acc_beta"), 25_000_00, "acc_beta balance unchanged")
    sa.assert_all()
