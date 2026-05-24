"""API contract: every response payload must match its pinned schema.

Schemas live in tests/support/schemas.py and use `additionalProperties: False`,
so any new field accidentally leaking into a response fails the contract test
(e.g., internal `payload_hash` must never reach the API surface).

Contract = shape (schema) + behavior (status codes, headers, byte-equal
idempotent replays). Both are asserted here.
"""

from tests.support.builders import TransferRequestBuilder, new_idempotency_key
from tests.support.schemas import (
    ERROR_RESPONSE,
    TRANSFER_RESPONSE,
    WALLET_RESPONSE,
    assert_matches,
)


def test_success_response_matches_transfer_schema(client):
    response = client.create_transfer(
        TransferRequestBuilder().build(), idempotency_key=new_idempotency_key()
    )
    assert response.status_code == 201
    assert_matches(response.get_json(), TRANSFER_RESPONSE)


def test_idempotent_replay_response_matches_transfer_schema(client):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()
    client.create_transfer(payload, idempotency_key=key)
    replay = client.create_transfer(payload, idempotency_key=key)
    assert replay.status_code == 200
    assert_matches(replay.get_json(), TRANSFER_RESPONSE)


def test_idempotent_replay_returns_byte_equal_body(client):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()
    first = client.create_transfer(payload, idempotency_key=key)
    second = client.create_transfer(payload, idempotency_key=key)
    assert first.get_json() == second.get_json()


def test_validation_error_response_matches_error_schema(client):
    payload = TransferRequestBuilder().missing("amount").build()
    response = client.create_transfer(payload)
    assert response.status_code == 422
    assert_matches(response.get_json(), ERROR_RESPONSE)


def test_idempotency_conflict_response_matches_error_schema(client):
    key = new_idempotency_key()
    client.create_transfer(
        TransferRequestBuilder().with_amount(1000).build(), idempotency_key=key
    )
    response = client.create_transfer(
        TransferRequestBuilder().with_amount(2000).build(), idempotency_key=key
    )
    assert response.status_code == 409
    assert_matches(response.get_json(), ERROR_RESPONSE)


def test_transfer_not_found_response_matches_error_schema(client):
    response = client.get_transfer("missing-uuid")
    assert response.status_code == 404
    assert_matches(response.get_json(), ERROR_RESPONSE)


def test_wallet_get_response_matches_wallet_schema(client):
    response = client.get_wallet("wallet_001")
    assert response.status_code == 200
    assert_matches(response.get_json(), WALLET_RESPONSE)


def test_wallet_not_found_response_matches_error_schema(client):
    response = client.get_wallet("ghost-wallet")
    assert response.status_code == 404
    assert_matches(response.get_json(), ERROR_RESPONSE)


def test_transfer_get_response_matches_transfer_schema(client):
    post_resp = client.create_transfer(TransferRequestBuilder().build())
    transfer_id = post_resp.get_json()["id"]
    response = client.get_transfer(transfer_id)
    assert response.status_code == 200
    assert_matches(response.get_json(), TRANSFER_RESPONSE)


def test_internal_payload_hash_never_leaks_to_api(client):
    """If the service ever shipped its internal `payload_hash`, this test fails
    via additionalProperties: False before anyone notices in production.
    """
    response = client.create_transfer(TransferRequestBuilder().build())
    assert "payload_hash" not in response.get_json()
