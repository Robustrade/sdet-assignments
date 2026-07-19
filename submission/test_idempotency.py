"""
Category D -- Idempotency / Duplicate Submission (mandatory).

Proves exactly-once semantics at the API level: replays return the original
logical result without redoing side effects, and a reused key with a
different payload is treated as a conflict rather than silently accepted.
"""
from tests.api_client import WalletTransferApiClient
from tests.data_builders import transfer_payload, new_idempotency_key
from tests.db_helpers import (
    get_wallet_balance,
    count_transfers_for_idempotency_key,
    get_idempotency_record,
    count_all_transfers,
)


def test_same_key_same_payload_returns_identical_transfer_id(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    key = new_idempotency_key()
    payload = transfer_payload(source, destination, amount=1000)

    first = api.post_transfer(payload, key)
    second = api.post_transfer(payload, key)

    assert first.status_code == 201
    assert second.status_code == 201  # replay returns the original outcome, not a new one
    assert first.json()["transfer_id"] == second.json()["transfer_id"]


def test_duplicate_submission_does_not_create_duplicate_transfer_rows(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    key = new_idempotency_key()
    payload = transfer_payload(source, destination, amount=1000)

    api.post_transfer(payload, key)
    api.post_transfer(payload, key)
    api.post_transfer(payload, key)

    assert count_transfers_for_idempotency_key(db_session, key) == 1


def test_duplicate_submission_does_not_double_debit_or_double_credit(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    s_bal, d_bal = source.balance, destination.balance
    key = new_idempotency_key()
    payload = transfer_payload(source, destination, amount=1000)

    for _ in range(5):
        api.post_transfer(payload, key)

    assert get_wallet_balance(db_session, source.id) == s_bal - 1000
    assert get_wallet_balance(db_session, destination.id) == d_bal + 1000


def test_same_key_different_payload_is_rejected_as_conflict(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    key = new_idempotency_key()

    first = api.post_transfer(transfer_payload(source, destination, amount=1000), key)
    second = api.post_transfer(transfer_payload(source, destination, amount=2000), key)

    assert first.status_code == 201
    assert second.status_code == 409
    # only the original amount should ever have moved money
    assert count_transfers_for_idempotency_key(db_session, key) == 1


def test_conflicting_key_reuse_does_not_mutate_balances_further(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    key = new_idempotency_key()

    api.post_transfer(transfer_payload(source, destination, amount=1000), key)
    s_bal_after_first = get_wallet_balance(db_session, source.id)

    api.post_transfer(transfer_payload(source, destination, amount=2000), key)  # rejected as 409

    assert get_wallet_balance(db_session, source.id) == s_bal_after_first


def test_idempotency_record_persisted_with_correct_transfer_link(client, db_session, seeded_wallets):
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    key = new_idempotency_key()

    resp = api.post_transfer(transfer_payload(source, destination, amount=1000), key)
    transfer_id = resp.json()["transfer_id"]

    record = get_idempotency_record(db_session, key)
    assert record is not None
    assert record.transfer_id == transfer_id


def test_replay_after_simulated_response_loss_is_safe(client, db_session, seeded_wallets):
    """
    Simulates the classic 'client sent the request, response was lost on the
    network, client retries' scenario. The client doesn't know the first
    attempt actually succeeded -- it must be safe to retry blindly.
    """
    api = WalletTransferApiClient(client)
    source, destination = seeded_wallets
    key = new_idempotency_key()
    payload = transfer_payload(source, destination, amount=1500)

    first = api.post_transfer(payload, key)
    assert first.status_code == 201
    # ...pretend the client never saw this response and retries with the same key...
    retry = api.post_transfer(payload, key)

    assert retry.status_code == 201
    assert retry.json()["transfer_id"] == first.json()["transfer_id"]
    assert count_all_transfers(db_session) == 1
