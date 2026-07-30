"""Helper to create test data quickly without repeating the same dicts."""

from __future__ import annotations

import uuid


def transfer_payload(
    source: str = "wallet_001",
    destination: str = "wallet_002",
    amount: int = 1_000,
    currency: str = "AED",
    reference: str | None = None,
) -> dict:
    """Build a standard transfer request payload."""
    payload: dict = {
        "source_wallet_id": source,
        "destination_wallet_id": destination,
        "amount": amount,
        "currency": currency,
    }
    if reference is not None:
        payload["reference"] = reference
    return payload


def unique_idempotency_key(prefix: str = "idem") -> str:
    """Generate a unique idempotency key with an optional prefix."""
    return f"{prefix}-{uuid.uuid4().hex[:12]}"

