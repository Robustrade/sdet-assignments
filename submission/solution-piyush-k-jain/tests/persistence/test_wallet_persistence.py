"""Wallet balance persistence + the balance-conservation invariant.

If the system ever quietly debits the source without crediting the destination
(or vice versa), the conservation test catches it across any amount.
"""

import pytest

from tests.support.builders import TransferRequestBuilder
from tests.support.invariants import assert_balance_conserved


def test_source_balance_decreases_by_amount(client, db):
    client.create_transfer(TransferRequestBuilder().with_amount(2500).build())
    assert db.wallet_balance("wallet_001") == 7500


def test_destination_balance_increases_by_amount(client, db):
    client.create_transfer(TransferRequestBuilder().with_amount(2500).build())
    assert db.wallet_balance("wallet_002") == 7500


@pytest.mark.parametrize("amount", [1, 100, 2500, 9999, 10_000])
def test_balance_conserved_across_amounts(client, db, amount):
    before = db.snapshot_balances("wallet_001", "wallet_002")
    client.create_transfer(TransferRequestBuilder().with_amount(amount).build())
    after = db.snapshot_balances("wallet_001", "wallet_002")
    assert_balance_conserved(before, after)


def test_failed_transfer_leaves_both_balances_untouched(client, db):
    before = db.snapshot_balances("wallet_001", "wallet_002")
    client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    after = db.snapshot_balances("wallet_001", "wallet_002")
    assert before == after


def test_unrelated_wallet_is_never_touched(client, db, seed_balances):
    client.create_transfer(TransferRequestBuilder().build())
    # wallet_003 / wallet_usd were not party to the transfer
    assert db.wallet_balance("wallet_003") == seed_balances["wallet_003"]
    assert db.wallet_balance("wallet_usd") == seed_balances["wallet_usd"]
