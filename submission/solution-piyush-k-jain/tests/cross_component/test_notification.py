"""Notification trigger: exactly once per successful transfer, never on
failure or rejection.

This is the third cross-component side effect (alongside outbox and DLQ) and
mirrors a downstream "notify recipient" hook that a real system would have.
The `NotificationRecorder` stub records every call so we can assert
count == 1 for happy paths and count == 0 for everything else.
"""

from tests.support.builders import TransferRequestBuilder, new_idempotency_key
from tests.support.invariants import assert_not_notified, assert_notified_once


def test_successful_transfer_triggers_one_notification(client, notifier):
    response = client.create_transfer(TransferRequestBuilder().build())
    transfer_id = response.get_json()["id"]
    assert_notified_once(notifier, transfer_id)


def test_notification_payload_includes_transfer_details(client, notifier):
    response = client.create_transfer(TransferRequestBuilder().with_amount(750).build())
    transfer_id = response.get_json()["id"]
    call = notifier.calls_for(transfer_id)[0]
    assert call["transfer_id"] == transfer_id
    assert call["payload"]["amount"] == 750
    assert call["payload"]["currency"] == "AED"


def test_failed_transfer_does_not_notify(client, notifier):
    response = client.create_transfer(TransferRequestBuilder().build(), force_fail=True)
    assert_not_notified(notifier, response.get_json()["id"])


def test_rejected_transfer_does_not_notify(client, notifier):
    """A pre-flight rejection (no transfer row created) must not notify anyone."""
    before = notifier.count()
    client.create_transfer(TransferRequestBuilder().with_amount(-1).build())
    assert notifier.count() == before


def test_idempotent_replay_does_not_renotify(client, notifier):
    key = new_idempotency_key()
    payload = TransferRequestBuilder().build()
    first = client.create_transfer(payload, idempotency_key=key)
    transfer_id = first.get_json()["id"]
    client.create_transfer(payload, idempotency_key=key)
    client.create_transfer(payload, idempotency_key=key)

    assert_notified_once(notifier, transfer_id)
    assert notifier.count() == 1


def test_two_independent_transfers_trigger_two_notifications(client, notifier):
    client.create_transfer(TransferRequestBuilder().build())
    client.create_transfer(TransferRequestBuilder().build())
    assert notifier.count() == 2
