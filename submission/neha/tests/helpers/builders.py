"""Request builders that keep scenario setup readable."""

from __future__ import annotations

import uuid
from typing import Any


def transfer_payload(
    *,
    source: str = "wallet_001",
    destination: str = "wallet_002",
    amount: int = 1000,
    currency: str = "AED",
    reference: str | None = "invoice_123",
    **overrides: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "source_wallet_id": source,
        "destination_wallet_id": destination,
        "amount": amount,
        "currency": currency,
    }
    if reference is not None:
        payload["reference"] = reference
    payload.update(overrides)
    return payload


def new_idempotency_key(prefix: str = "key") -> str:
    return f"{prefix}-{uuid.uuid4()}"
