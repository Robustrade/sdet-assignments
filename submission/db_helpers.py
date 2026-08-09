"""
Assertion / Verification Layer -- database side.

Every helper here re-queries the database directly (never trusts the API
response) so that tests genuinely prove persisted state, not just that the
API said the right words.
"""
from app.models import Wallet, Transfer, IdempotencyKey, TransferEvent, OutboxEvent


def get_wallet_balance(session, wallet_id: str) -> int:
    session.expire_all()
    wallet = session.get(Wallet, wallet_id)
    assert wallet is not None, f"wallet {wallet_id} not found in DB"
    return wallet.balance


def count_transfers_for_idempotency_key(session, idempotency_key: str) -> int:
    session.expire_all()
    return session.query(Transfer).filter_by(idempotency_key=idempotency_key).count()


def get_transfer_by_id(session, transfer_id: str) -> Transfer:
    session.expire_all()
    return session.get(Transfer, transfer_id)


def get_idempotency_record(session, key: str) -> IdempotencyKey:
    session.expire_all()
    return session.get(IdempotencyKey, key)


def get_events_for_transfer(session, transfer_id: str) -> list[TransferEvent]:
    session.expire_all()
    return (
        session.query(TransferEvent)
        .filter_by(transfer_id=transfer_id)
        .order_by(TransferEvent.created_at)
        .all()
    )


def get_outbox_events_for_transfer(session, transfer_id: str) -> list[OutboxEvent]:
    session.expire_all()
    return session.query(OutboxEvent).filter_by(transfer_id=transfer_id).all()


def count_all_transfers(session) -> int:
    session.expire_all()
    return session.query(Transfer).count()
