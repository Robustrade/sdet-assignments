"""Happy path: API + DB + ledger + outbox all check out for a successful transfer."""

import pytest

from utilities.data_loader import load_cases
from utilities.soft_assert import SoftAssert

CASES, _ = load_cases("happy_path.yaml")


@pytest.mark.happy
@pytest.mark.parametrize("case", CASES)
def test_happy_transfer(case, api, db, step_log):
    payload = case["request"]["payload"]
    idem = case["request"].get("idem")
    exp = case["expected"]
    sa = SoftAssert(step_log)

    with step_log.step(f"POST /transfers ({case['id']})"):
        resp = api.create_transfer(payload, idempotency_key=idem)

    sa.equals(resp.status_code, exp["status"], "API status")
    body = resp.json() or {}
    sa.equals(body.get("status"), exp["transfer_status"], "transfer status")
    sa.equals(body.get("amount_minor"), payload["amount_minor"], "response amount echoed")

    transfer_id = body.get("transfer_id")

    with step_log.step("source debited and destination credited"):
        sa.equals(db.balance(payload["source_wallet_id"]), exp["src_balance"], "source balance")
        sa.equals(db.balance(payload["dest_wallet_id"]), exp["dst_balance"], "dest balance")

    with step_log.step("transfer row persisted with consistent state"):
        row = db.transfer(transfer_id) if transfer_id else None
        sa.check(row is not None, "transfer row exists")
        if row:
            sa.equals(row["status"], exp["transfer_status"], "DB transfer status")
            sa.equals(row["amount_minor"], payload["amount_minor"], "DB amount matches request")
            sa.check(row["completed_at"] is not None, "completed_at populated")

    with step_log.step("ledger has exactly debit + credit entries"):
        entries = db.ledger_for_transfer(transfer_id) if transfer_id else []
        sa.equals(len(entries), exp["ledger_rows"], "ledger row count")
        if len(entries) == 2:
            debit = next((e for e in entries if e["direction"] == "debit"), None)
            credit = next((e for e in entries if e["direction"] == "credit"), None)
            sa.check(debit is not None and credit is not None, "one debit + one credit")
            if debit and credit:
                sa.equals(debit["amount_minor"], credit["amount_minor"], "debit and credit equal")
                sa.equals(debit["wallet_id"], payload["source_wallet_id"], "debit on source")
                sa.equals(credit["wallet_id"], payload["dest_wallet_id"], "credit on dest")

    with step_log.step("exactly one outbox row written"):
        sa.equals(db.outbox_count(transfer_id), exp["outbox_rows"], "outbox row count")

    with step_log.step("GET /transfers agrees with create response"):
        getr = api.get_transfer(transfer_id)
        sa.equals(getr.status_code, 200, "GET 200")
        sa.equals((getr.json() or {}).get("status"), exp["transfer_status"], "GET status agrees")

    sa.assert_all()
