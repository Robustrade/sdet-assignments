"""Cross-component validation: audit trail and outbox event verification.

Validates:
- exactly-once audit event emission
- exactly-once outbox event emission
- outbox event payload correctness
- no side-effects from failed transfers
- side-effect count consistency across idempotent retries
"""

import json

from tests.helpers.api_client import TransferAPIClient
from tests.helpers.builders import unique_idempotency_key
from tests.helpers.db_helpers import (
    get_audit_event_count,
    get_audit_events_for_transfer,
    get_outbox_event_count,
    get_outbox_event_payload,
    get_outbox_events_for_transfer,
)


def test_exactly_one_audit_event_per_transfer(client, app):
    """Each successful transfer produces exactly one audit_events row."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=500)
    api.create_transfer(amount=700)

    assert get_audit_event_count(app.db) == 2


def test_exactly_one_outbox_event_per_transfer(client, app):
    """Each successful transfer produces exactly one outbox_events row."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=500)
    api.create_transfer(amount=700)

    assert get_outbox_event_count(app.db) == 2


def test_outbox_event_payload_contains_transfer_details(client, app):
    """Outbox event payload must include transfer_id, amount, currency, wallets."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=3000, currency="AED")
    transfer_id = resp.get_json()["id"]

    payload = get_outbox_event_payload(app.db, transfer_id)
    assert payload is not None
    assert payload["transfer_id"] == transfer_id
    assert payload["amount"] == 3000
    assert payload["currency"] == "AED"
    assert payload["source_wallet_id"] == "wallet_001"
    assert payload["destination_wallet_id"] == "wallet_002"


def test_outbox_event_status_is_pending(client, app):
    """Newly created outbox event should have status 'pending'."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=500)
    transfer_id = resp.get_json()["id"]

    outbox = get_outbox_events_for_transfer(app.db, transfer_id)
    assert len(outbox) == 1
    assert outbox[0]["status"] == "pending"


def test_failed_transfer_no_audit_or_outbox(client, app):
    """Rejected transfer must produce zero audit and zero outbox events."""
    api = TransferAPIClient(client)
    api.create_transfer(amount=99_999)  # insufficient balance

    assert get_audit_event_count(app.db) == 0
    assert get_outbox_event_count(app.db) == 0


def test_idempotent_retry_does_not_duplicate_outbox(client, app):
    """Replayed idempotent request must not create a second outbox row."""
    api = TransferAPIClient(client)
    key = unique_idempotency_key()

    api.create_transfer(amount=1000, idempotency_key=key)
    api.create_transfer(amount=1000, idempotency_key=key)  # replay
    api.create_transfer(amount=1000, idempotency_key=key)  # replay again

    assert get_outbox_event_count(app.db) == 1


def test_idempotent_retry_does_not_duplicate_audit(client, app):
    """Replayed idempotent request must not create a second audit row."""
    api = TransferAPIClient(client)
    key = unique_idempotency_key()

    api.create_transfer(amount=1000, idempotency_key=key)
    api.create_transfer(amount=1000, idempotency_key=key)

    assert get_audit_event_count(app.db) == 1


def test_audit_and_outbox_reference_same_transfer(client, app):
    """Audit and outbox events must reference the same transfer_id."""
    api = TransferAPIClient(client)
    resp = api.create_transfer(amount=500)
    transfer_id = resp.get_json()["id"]

    audit = get_audit_events_for_transfer(app.db, transfer_id)
    outbox = get_outbox_events_for_transfer(app.db, transfer_id)

    assert len(audit) == 1
    assert len(outbox) == 1
    assert audit[0]["transfer_id"] == outbox[0]["transfer_id"] == transfer_id

