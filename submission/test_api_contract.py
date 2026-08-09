"""
API Contract and Validation Tests.

Focused purely on the HTTP contract: status codes and response payload
shape, independent of database state (covered elsewhere).
"""
from tests.api_client import WalletTransferApiClient
from tests.data_builders import transfer_payload, new_idempotency_key


EXPECTED_TRANSFER_FIELDS = {
    "transfer_id", "source_wallet_id", "destination_wallet_id",
    "amount", "currency", "reference", "status", "failure_reason", "created_at",
}


def test_successful_response_payload_shape(client, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination), new_idempotency_key())

    assert resp.status_code == 201
    assert set(resp.json().keys()) == EXPECTED_TRANSFER_FIELDS


def test_get_wallet_response_shape(client, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, _ = seeded_wallets
    resp = api.get_wallet(source.id)

    assert resp.status_code == 200
    assert set(resp.json().keys()) == {"wallet_id", "currency", "balance"}


def test_get_nonexistent_transfer_returns_404(client):
    api = WalletTransferApiClient(client)
    resp = api.get_transfer("does-not-exist")
    assert resp.status_code == 404


def test_get_nonexistent_wallet_returns_404(client):
    api = WalletTransferApiClient(client)
    resp = api.get_wallet("does-not-exist")
    assert resp.status_code == 404


def test_validation_error_response_has_useful_detail(client, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    payload = transfer_payload(source, destination, amount=-5)
    resp = api.post_transfer_raw(payload, new_idempotency_key())

    assert resp.status_code == 422
    assert "detail" in resp.json()


def test_currency_mismatch_between_request_and_wallet_rejected(client, db_session, seeded_wallets):
    from tests.data_builders import make_wallet
    api = WalletTransferApiClient(client)
    source, _ = seeded_wallets
    usd_wallet = make_wallet(db_session, balance=1000, currency="USD")
    db_session.commit()

    payload = transfer_payload(source, usd_wallet, amount=100, currency="AED")
    resp = api.post_transfer_raw(payload, new_idempotency_key())

    assert resp.status_code == 422
