"""Thin API client so transport details stay out of scenario tests."""

from __future__ import annotations

from typing import Any


class TransferApiClient:
    def __init__(self, client):
        self._client = client

    def create_transfer(
        self,
        payload: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ):
        headers = {}
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return self._client.post("/transfers", json=payload, headers=headers)

    def get_transfer(self, transfer_id: str):
        return self._client.get(f"/transfers/{transfer_id}")

    def get_wallet(self, wallet_id: str):
        return self._client.get(f"/wallets/{wallet_id}")
