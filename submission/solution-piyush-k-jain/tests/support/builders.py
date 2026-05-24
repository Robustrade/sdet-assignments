"""Fluent builders for request payloads.

Keeps test bodies focused on the *behavior* being exercised, not the
boilerplate of dict construction. A builder always returns a fresh dict so
tests can mutate the result without affecting others.

Example:
    payload = TransferRequestBuilder().with_amount(2500).build()
    payload = TransferRequestBuilder().missing("currency").build()
"""

from __future__ import annotations

import uuid
from typing import Any


class TransferRequestBuilder:
    """Builds a valid POST /transfers payload by default; mutate via with_*."""

    _DEFAULTS: dict[str, Any] = {
        "source_wallet_id": "wallet_001",
        "destination_wallet_id": "wallet_002",
        "amount": 1000,
        "currency": "AED",
        "reference": "invoice_default",
    }

    def __init__(self) -> None:
        self._payload: dict[str, Any] = dict(self._DEFAULTS)

    def with_source(self, wallet_id: str) -> TransferRequestBuilder:
        self._payload["source_wallet_id"] = wallet_id
        return self

    def with_destination(self, wallet_id: str) -> TransferRequestBuilder:
        self._payload["destination_wallet_id"] = wallet_id
        return self

    def with_amount(self, amount: Any) -> TransferRequestBuilder:
        self._payload["amount"] = amount
        return self

    def with_currency(self, currency: Any) -> TransferRequestBuilder:
        self._payload["currency"] = currency
        return self

    def with_reference(self, reference: str | None) -> TransferRequestBuilder:
        self._payload["reference"] = reference
        return self

    def missing(self, field: str) -> TransferRequestBuilder:
        self._payload.pop(field, None)
        return self

    def build(self) -> dict[str, Any]:
        return dict(self._payload)


def new_idempotency_key(prefix: str = "key") -> str:
    """Unique key per call. Tests stay independent even when run repeatedly."""
    return f"{prefix}-{uuid.uuid4()}"
