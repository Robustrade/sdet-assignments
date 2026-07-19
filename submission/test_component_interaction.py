"""
Category G -- Component Interaction Validation.

Validates the outbox table as the stand-in for "a downstream/adjacent
component". In production a separate publisher would drain this table into
a broker; here we validate the contract the publisher would depend on:
exactly one outbox row per completed/rejected transfer, never duplicated by
retries.
"""
from app.models import OutboxEvent
from tests.api_client import WalletTransferApiClient
from tests.data_builders import transfer_payload, new_idempotency_key
from tests.db_helpers import get_outbox_events_for_transfer


def test_outbox_row_created_after_successful_transfer(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=100), new_idempotency_key())
    transfer_id = resp.json()["transfer_id"]

    rows = get_outbox_events_for_transfer(db_session, transfer_id)
    assert len(rows) == 1
    assert rows[0].event_type == "transfer.completed"
    assert rows[0].published is False, "publish step is a separate concern from persistence"


def test_outbox_row_created_after_rejected_transfer(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    resp = api.post_transfer(transfer_payload(source, destination, amount=999_999), new_idempotency_key())
    transfer_id = resp.json()["transfer_id"]

    rows = get_outbox_events_for_transfer(db_session, transfer_id)
    assert len(rows) == 1
    assert rows[0].event_type == "transfer.rejected"


def test_duplicate_submissions_never_produce_duplicate_outbox_rows(client, db_session, seeded_wallets):
    """
    Exactly-once event emission: hammering the same idempotency key must not
    fan out multiple outbox rows even though the client-visible response is
    returned every time.
    """
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    key = new_idempotency_key()
    payload = transfer_payload(source, destination, amount=250)

    responses = [api.post_transfer(payload, key) for _ in range(4)]
    transfer_id = responses[0].json()["transfer_id"]

    rows = get_outbox_events_for_transfer(db_session, transfer_id)
    assert len(rows) == 1


def test_outbox_unique_constraint_prevents_duplicate_event_type_at_db_level(db_session, seeded_wallets):
    """
    Defense in depth: even if application logic had a bug, the DB schema
    itself should refuse a second (transfer_id, event_type) row.
    """
    import pytest
    from sqlalchemy.exc import IntegrityError
    from app.models import Transfer

    source, destination = seeded_wallets
    transfer = Transfer(
        source_wallet_id=source.id, destination_wallet_id=destination.id,
        amount=100, currency="AED", idempotency_key=new_idempotency_key(), status="COMPLETED",
    )
    db_session.add(transfer)
    db_session.flush()
    db_session.add(OutboxEvent(transfer_id=transfer.id, event_type="transfer.completed"))
    db_session.commit()

    db_session.add(OutboxEvent(transfer_id=transfer.id, event_type="transfer.completed"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
