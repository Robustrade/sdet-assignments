"""
Category B -- Validation Failures.

For every case: assert the API rejects it AND assert nothing was persisted
(no transfer row, no balance change) -- a service that returns 4xx but still
writes a row is arguably worse than one that doesn't validate at all.
"""
import pytest

from tests.api_client import WalletTransferApiClient
from tests.data_builders import transfer_payload, new_idempotency_key
from tests.db_helpers import count_all_transfers, get_wallet_balance


def _assert_no_persistence_side_effects(db_session, source, destination, source_balance_before, dest_balance_before, transfers_before):
    assert count_all_transfers(db_session) == transfers_before
    assert get_wallet_balance(db_session, source.id) == source_balance_before
    assert get_wallet_balance(db_session, destination.id) == dest_balance_before


@pytest.mark.parametrize("missing_field", ["source_wallet_id", "destination_wallet_id", "amount", "currency"])
def test_missing_required_field_rejected(client, db_session, seeded_wallets, missing_field):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    transfers_before = count_all_transfers(db_session)
    s_bal, d_bal = source.balance, destination.balance

    payload = transfer_payload(source, destination)
    del payload[missing_field]

    resp = api.post_transfer_raw(payload, new_idempotency_key())

    assert resp.status_code == 422
    _assert_no_persistence_side_effects(db_session, source, destination, s_bal, d_bal, transfers_before)


@pytest.mark.parametrize("bad_currency", ["ae", "AE", "AEDX", "123", ""])
def test_invalid_currency_rejected(client, db_session, seeded_wallets, bad_currency):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    transfers_before = count_all_transfers(db_session)
    s_bal, d_bal = source.balance, destination.balance

    payload = transfer_payload(source, destination, currency=bad_currency)
    resp = api.post_transfer_raw(payload, new_idempotency_key())

    assert resp.status_code == 422
    _assert_no_persistence_side_effects(db_session, source, destination, s_bal, d_bal, transfers_before)


@pytest.mark.parametrize("bad_amount", [0, -1, -2500])
def test_non_positive_amount_rejected(client, db_session, seeded_wallets, bad_amount):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    transfers_before = count_all_transfers(db_session)
    s_bal, d_bal = source.balance, destination.balance

    payload = transfer_payload(source, destination, amount=bad_amount)
    resp = api.post_transfer_raw(payload, new_idempotency_key())

    assert resp.status_code == 422
    _assert_no_persistence_side_effects(db_session, source, destination, s_bal, d_bal, transfers_before)


def test_source_and_destination_same_wallet_rejected(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, _destination = seeded_wallets
    transfers_before = count_all_transfers(db_session)
    s_bal = source.balance

    payload = transfer_payload(source, source, amount=100)
    resp = api.post_transfer_raw(payload, new_idempotency_key())

    assert resp.status_code == 422
    assert count_all_transfers(db_session) == transfers_before
    assert get_wallet_balance(db_session, source.id) == s_bal


def test_missing_idempotency_key_header_rejected(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    transfers_before = count_all_transfers(db_session)

    resp = api.post_transfer_raw(transfer_payload(source, destination), idempotency_key=None)

    assert resp.status_code in (400, 422)
    assert count_all_transfers(db_session) == transfers_before


def test_malformed_idempotency_key_rejected(client, db_session, seeded_wallets):
    """Key shorter than a sane minimum length should be treated as malformed."""
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    transfers_before = count_all_transfers(db_session)

    resp = api.post_transfer(transfer_payload(source, destination), idempotency_key="short")

    assert resp.status_code == 400
    assert count_all_transfers(db_session) == transfers_before


def test_unknown_wallet_id_rejected(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    transfers_before = count_all_transfers(db_session)

    payload = transfer_payload(source, destination)
    payload["destination_wallet_id"] = "wallet_does_not_exist"
    resp = api.post_transfer_raw(payload, new_idempotency_key())

    assert resp.status_code == 404
    assert count_all_transfers(db_session) == transfers_before
