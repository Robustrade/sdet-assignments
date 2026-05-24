"""API happy-path: a valid transfer returns 201 with the expected body and
makes the API+DB state consistent.

These tests are deliberately API-focused. Deeper persistence and side-effect
checks live under tests/persistence/ and tests/cross_component/.
"""

from tests.support.builders import TransferRequestBuilder, new_idempotency_key


def test_valid_transfer_returns_201_completed(client):
    payload = TransferRequestBuilder().with_amount(2500).build()

    response = client.create_transfer(payload, idempotency_key=new_idempotency_key())

    assert response.status_code == 201
    body = response.get_json()
    assert body["status"] == "completed"
    assert body["amount"] == 2500
    assert body["currency"] == "AED"


def test_response_includes_idempotency_key_when_provided(client):
    key = new_idempotency_key()
    response = client.create_transfer(
        TransferRequestBuilder().build(), idempotency_key=key
    )
    assert response.get_json()["idempotency_key"] == key


def test_response_idempotency_key_is_null_when_header_absent(client):
    response = client.create_transfer(TransferRequestBuilder().build())
    assert response.get_json()["idempotency_key"] is None


def test_response_content_type_is_json(client):
    response = client.create_transfer(TransferRequestBuilder().build())
    assert response.headers["Content-Type"].startswith("application/json")


def test_get_transfer_returns_state_consistent_with_post(client):
    post_resp = client.create_transfer(TransferRequestBuilder().build())
    transfer_id = post_resp.get_json()["id"]

    get_resp = client.get_transfer(transfer_id)

    assert get_resp.status_code == 200
    assert get_resp.get_json()["id"] == transfer_id
    assert get_resp.get_json()["status"] == "completed"


def test_get_wallet_reflects_post_outcome(client):
    client.create_transfer(TransferRequestBuilder().with_amount(2500).build())

    resp = client.get_wallet("wallet_001")
    assert resp.status_code == 200
    assert resp.get_json()["balance"] == 7500


def test_get_transfer_not_found_returns_404(client):
    resp = client.get_transfer("does-not-exist")
    assert resp.status_code == 404
    assert "error" in resp.get_json()


def test_get_wallet_not_found_returns_404(client):
    resp = client.get_wallet("ghost-wallet")
    assert resp.status_code == 404
    assert "error" in resp.get_json()
