"""
Test Utilities / Data Builders layer.

Centralizes how wallets/transfers/idempotency keys/payloads are constructed
so individual test scenarios stay short and free of setup noise.
"""
import uuid

from app.models import Wallet


def make_wallet(session, balance: int = 10_000, currency: str = "AED", wallet_id: str = None) -> Wallet:
    wallet = Wallet(id=wallet_id or f"wallet_{uuid.uuid4().hex[:8]}", currency=currency, balance=balance)
    session.add(wallet)
    session.flush()
    return wallet


def transfer_payload(source, destination, amount: int = 1000, currency: str = "AED", reference: str = None):
    return {
        "source_wallet_id": source.id,
        "destination_wallet_id": destination.id,
        "amount": amount,
        "currency": currency,
        "reference": reference or f"ref_{uuid.uuid4().hex[:6]}",
    }


def new_idempotency_key() -> str:
    return str(uuid.uuid4())
