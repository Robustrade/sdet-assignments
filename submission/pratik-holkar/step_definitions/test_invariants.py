"""Invariants that must hold for any sequence of valid transfers.

These are the load-bearing properties of a wallet service. Most are
asserted with Hypothesis (random amounts, random retries) so they
exercise input space beyond hand-picked YAML cases.

Invariants checked here:
    1. Balance conservation: sum(all wallet balances) is constant for
       intra-currency transfers, regardless of how many succeed/fail.
    2. Ledger consistency: every completed transfer has exactly one
       debit and one credit, equal in amount, on the right wallets,
       and the balance_after on each entry matches the wallet row.
    3. Idempotency replay returns the original transfer id even under
       arbitrary numbers of replays with the same key+payload.
    4. created_at <= completed_at for every completed transfer.
    5. No partial state: if any transfer row exists for an idempotency
       key, exactly one row exists (no half-written replays).
"""

import uuid
from datetime import datetime

import pytest
from hypothesis import HealthCheck, given, settings as hsettings
from hypothesis import strategies as st

from utilities.soft_assert import SoftAssert

USD_WALLETS_TOTAL_MINOR = 50_000_00 + 25_000_00 + 0  # acc_alpha + beta + gamma


@pytest.mark.invariant
@pytest.mark.db
def test_ledger_consistency_for_happy_transfer(api, db, step_log):
    sa = SoftAssert(step_log)
    with step_log.step("post a normal transfer"):
        resp = api.create_transfer(
            {
                "source_wallet_id": "acc_alpha",
                "dest_wallet_id": "acc_beta",
                "amount_minor": 12_345,
                "currency": "USD",
            },
            idempotency_key="inv-ledger-1",
        )
    sa.equals(resp.status_code, 201, "transfer created")
    transfer_id = (resp.json() or {}).get("transfer_id")

    entries = db.ledger_for_transfer(transfer_id)
    sa.equals(len(entries), 2, "two ledger rows per transfer")

    debit = next(e for e in entries if e["direction"] == "debit")
    credit = next(e for e in entries if e["direction"] == "credit")

    sa.equals(debit["amount_minor"], credit["amount_minor"], "debit == credit amount")
    sa.equals(debit["wallet_id"], "acc_alpha", "debit on source")
    sa.equals(credit["wallet_id"], "acc_beta", "credit on destination")
    sa.equals(
        debit["balance_after_minor"],
        db.balance("acc_alpha"),
        "ledger balance_after matches wallet row (source)",
    )
    sa.equals(
        credit["balance_after_minor"],
        db.balance("acc_beta"),
        "ledger balance_after matches wallet row (destination)",
    )
    sa.assert_all()


@pytest.mark.invariant
@pytest.mark.db
def test_created_at_le_completed_at(api, db, step_log):
    sa = SoftAssert(step_log)
    resp = api.create_transfer(
        {
            "source_wallet_id": "acc_alpha",
            "dest_wallet_id": "acc_beta",
            "amount_minor": 1_00,
            "currency": "USD",
        },
        idempotency_key="inv-time-1",
    )
    sa.equals(resp.status_code, 201, "201")
    body = resp.json() or {}
    created = datetime.fromisoformat(body["created_at"])
    completed = datetime.fromisoformat(body["completed_at"])
    sa.check(created <= completed, f"created_at({created}) <= completed_at({completed})")
    sa.assert_all()


# --- Hypothesis property tests --------------------------------------------

# Keep amounts well below the source balance so we can fire many transfers
# without insufficient_balance kicking in.
_amount_strategy = st.integers(min_value=1, max_value=1_000)


@pytest.mark.invariant
@pytest.mark.property
@hsettings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(amounts=st.lists(_amount_strategy, min_size=1, max_size=10))
def test_balance_conservation_under_random_transfers(amounts, api, db):
    """No matter how many transfers we send, total USD balance is invariant."""
    before = db.total_balance()
    for i, amt in enumerate(amounts):
        api.create_transfer(
            {
                "source_wallet_id": "acc_alpha",
                "dest_wallet_id": "acc_beta",
                "amount_minor": int(amt),
                "currency": "USD",
            },
            idempotency_key=f"hyp-cons-{i}",
        )
    after = db.total_balance()
    assert before == after, f"total balance drifted: {before} -> {after}"


@pytest.mark.invariant
@pytest.mark.property
@hsettings(
    max_examples=15,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(replays=st.integers(min_value=2, max_value=8))
def test_idempotency_holds_under_random_replay_count(replays, api, db):
    """N random replays of the same key+payload yield exactly one transfer.

    Hypothesis reuses the function-scoped fixture across examples, so we
    measure deltas rather than absolute balances and use a unique key per
    example.
    """
    payload = {
        "source_wallet_id": "acc_alpha",
        "dest_wallet_id": "acc_beta",
        "amount_minor": 500,
        "currency": "USD",
    }
    key = f"hyp-replay-{uuid.uuid4().hex}"
    src_before = db.balance("acc_alpha")

    first = api.create_transfer(payload, idempotency_key=key)
    assert first.status_code == 201
    original_id = first.json()["transfer_id"]

    for _ in range(replays - 1):
        r = api.create_transfer(payload, idempotency_key=key)
        assert r.status_code == 200
        assert r.json()["transfer_id"] == original_id

    rows = db.transfers_for_key(key)
    assert len(rows) == 1, f"expected 1 transfer for key {key}, got {len(rows)}"
    assert db.balance("acc_alpha") == src_before - 500, "debited exactly once"
