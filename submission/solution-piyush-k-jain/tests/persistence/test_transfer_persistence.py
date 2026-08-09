"""`transfers` table persistence.

Pins what the row looks like end-to-end so a refactor that drops a column or
changes a status spelling fails noisily.
"""

from tests.support.builders import TransferRequestBuilder, new_idempotency_key


def test_transfer_row_persisted_with_expected_columns(client, db):
    payload = TransferRequestBuilder().with_amount(2500).with_reference("ref-1").build()
    response = client.create_transfer(payload, idempotency_key=new_idempotency_key())
    transfer_id = response.get_json()["id"]

    row = db.transfer(transfer_id)
    assert row is not None
    assert row["source_wallet_id"] == "wallet_001"
    assert row["destination_wallet_id"] == "wallet_002"
    assert row["amount"] == 2500
    assert row["currency"] == "AED"
    assert row["reference"] == "ref-1"
    assert row["status"] == "completed"
    assert row["created_at"] is not None
    assert row["updated_at"] is not None


def test_api_response_matches_persisted_row(client, db):
    response = client.create_transfer(TransferRequestBuilder().build())
    body = response.get_json()

    row = db.transfer(body["id"])
    assert row is not None
    for field in (
        "source_wallet_id",
        "destination_wallet_id",
        "amount",
        "currency",
        "reference",
        "status",
    ):
        assert (
            row[field] == body[field]
        ), f"DB and API disagree on '{field}': db={row[field]!r}, api={body[field]!r}"


def test_failed_transfer_row_persists_with_failed_status(client, db):
    response = client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    transfer_id = response.get_json()["id"]
    row = db.transfer(transfer_id)
    assert row is not None
    assert row["status"] == "failed"


def test_optional_reference_persisted_as_null_when_omitted(client, db):
    payload = TransferRequestBuilder().with_reference(None).build()
    response = client.create_transfer(payload)
    transfer_id = response.get_json()["id"]
    row = db.transfer(transfer_id)
    assert row is not None
    assert row["reference"] is None
