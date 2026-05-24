"""Competing transfers against a limited balance.

If the service has a race condition between "check balance" and "debit
balance", two concurrent transfers could both succeed and leave the wallet
negative. The CHECK(balance >= 0) constraint plus the write_lock should
prevent this.

We fire more requests than the balance can satisfy and assert:
    - no successful transfer ever pushes the balance negative
    - the number of successful transfers matches what the math allows
    - the balance change equals exactly `successes * amount`
    - balance conservation holds across all involved wallets
"""

import threading

import pytest

from tests.support.api_client import TransferClient
from tests.support.builders import TransferRequestBuilder


@pytest.mark.reliability
def test_concurrent_transfers_never_overdraw(app, db, seed_balances):
    """wallet_001 starts at 10_000. Fire 5 concurrent transfers of 3000 each.
    At most floor(10000/3000) = 3 can succeed; balance must stay >= 0.
    """
    statuses: list[int] = []
    lock = threading.Lock()
    payload = TransferRequestBuilder().with_amount(3000).build()

    def attempt() -> None:
        with app.test_client() as http:
            client = TransferClient(http)
            response = client.create_transfer(payload)
            with lock:
                statuses.append(response.status_code)

    threads = [threading.Thread(target=attempt) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    successes = statuses.count(201)
    rejections = statuses.count(422)

    assert successes + rejections == 5, f"unexpected statuses observed: {statuses}"
    assert (
        successes <= 3
    ), f"more transfers succeeded than the balance allows: {successes}"

    final_source = db.wallet_balance("wallet_001")
    final_dest = db.wallet_balance("wallet_002")

    assert final_source >= 0
    assert final_source == seed_balances["wallet_001"] - successes * 3000
    assert final_dest == seed_balances["wallet_002"] + successes * 3000

    # Balance conservation across both wallets
    moved = seed_balances["wallet_001"] - final_source
    received = final_dest - seed_balances["wallet_002"]
    assert moved == received


@pytest.mark.reliability
def test_concurrent_transfers_persist_one_row_per_success(app, db):
    payload = TransferRequestBuilder().with_amount(3000).build()
    statuses: list[int] = []
    lock = threading.Lock()

    def attempt() -> None:
        with app.test_client() as http:
            client = TransferClient(http)
            response = client.create_transfer(payload)
            with lock:
                statuses.append(response.status_code)

    threads = [threading.Thread(target=attempt) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    successes = statuses.count(201)
    assert db.transfers_by_status("completed") == successes
    assert db.outbox_count() == successes
    assert db.audit_event_count() == successes * 2
